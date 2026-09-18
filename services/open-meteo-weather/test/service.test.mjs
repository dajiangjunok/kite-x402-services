import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import express from "express";
import { parse } from "yaml";
import { createApp } from "../dist/app.js";
import { readConfig } from "../dist/config.js";
import { KITE_MAINNET, KITE_TESTNET } from "../dist/kite.js";

// These addresses, signatures and receipts are fixtures, never on-chain evidence.
const PAY_TO = `0x${"1".repeat(40)}`;
const PAYER = `0x${"2".repeat(40)}`;
const MOCK_TX = `0x${"3".repeat(64)}`;
const KEY = "test-upstream-key+private";
const AUTH = "Bearer test-upstream-token";
const forecast = { latitude: 52.52, longitude: 13.41, current: { temperature_2m: 18, wind_speed_10m: 4 }, hourly: { time: ["2026-01-01T00:00"], temperature_2m: [18] } };
const manifest = parse(readFileSync(new URL("../service.yaml", import.meta.url), "utf8"));
const example = manifest.endpoints[0];
const examplePath = `${example.path}?${new URLSearchParams(example.example_request.query)}`;
const decode = value => JSON.parse(Buffer.from(value, "base64").toString("utf8"));

async function serve(t, handler) {
  const server = createServer(handler);
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function fixture(t, options = {}) {
  const events = [];
  const network = options.network ?? "testnet";
  const chain = network === "mainnet" ? KITE_MAINNET : KITE_TESTNET;
  const upstream = express();
  const upstreamRequests = [];
  upstream.use((req, res) => {
    events.push("upstream");
    upstreamRequests.push({ url: req.url, headers: req.headers });
    if (options.upstream) return options.upstream(req, res);
    res.set("Set-Cookie", "must-not-reach-buyer=1");
    res.set("PAYMENT-RESPONSE", "forged-upstream-receipt");
    res.set("Authorization", AUTH);
    res.json(forecast);
    events.push("upstream:complete");
  });
  const upstreamServer = await serve(t, upstream);
  if (options.connectionFailure) await new Promise(resolve => upstreamServer.server.close(resolve));
  const facilitator = express();
  facilitator.use(express.json());
  facilitator.get("/v2/supported", (_req, res) => res.json({
    kinds: [{ x402Version: 2, scheme: "exact", network: chain.network }], extensions: [], signers: {},
  }));
  facilitator.post("/v2/verify", (req, res) => {
    events.push("verify");
    assert.equal(req.body.paymentRequirements.payTo, PAY_TO);
    if (options.verifyUnavailable) return res.status(503).send(AUTH);
    res.json(options.invalid ? { isValid: false, invalidReason: "invalid_signature", payer: PAYER } : { isValid: true, payer: PAYER });
  });
  facilitator.post("/v2/settle", (_req, res) => {
    events.push("settle");
    if (options.settleUnavailable) return res.status(503).send(AUTH);
    res.json(options.settleFailure
      ? { success: false, errorReason: "insufficient_funds", transaction: "", network: chain.network }
      : { success: true, transaction: MOCK_TX, network: chain.network, payer: PAYER });
  });
  const facilitatorServer = await serve(t, facilitator);
  const config = readConfig({
    PAY_TO, KITE_NETWORK: network, PRICE_USD: options.price ?? "0.001",
    UPSTREAM_URL: `${upstreamServer.url}/v1`, FACILITATOR_URL: `${facilitatorServer.url}/v2`,
    OPEN_METEO_API_KEY: KEY, UPSTREAM_AUTH_VALUE: AUTH, UPSTREAM_TIMEOUT_MS: "150",
  });
  const wrapper = await serve(t, await createApp(config));
  const unpaid = () => fetch(wrapper.url + examplePath);
  async function paid(extraHeaders = {}, path = examplePath) {
    const required = decode((await unpaid()).headers.get("payment-required"));
    const payload = {
      x402Version: 2, resource: required.resource, accepted: required.accepts[0],
      payload: { signature: `0x${"0".repeat(130)}`, authorization: {
        from: PAYER, to: PAY_TO, value: required.accepts[0].amount,
        validAfter: "0", validBefore: "9999999999", nonce: `0x${"4".repeat(64)}`,
      } },
    };
    return fetch(wrapper.url + path, { headers: { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payload)).toString("base64"), ...extraHeaders } });
  }
  t.after(() => t.diagnostic(`mock-only sequence: ${events.join(" -> ") || "(no verify/upstream/settle)"}`));
  return { url: wrapper.url, events, unpaid, paid, upstreamRequests, chain };
}

for (const network of ["mainnet", "testnet"]) {
  test(`AC-01: ${network} 402 challenge matches exact price, asset, network, payee and EIP-712 domain`, async t => {
    const f = await fixture(t, { network, price: "0.123456" });
    const response = await f.unpaid();
    assert.equal(response.status, 402);
    const required = decode(response.headers.get("payment-required"));
    const offer = required.accepts[0];
    assert.equal(required.x402Version, 2);
    assert.equal(offer.scheme, "exact");
    assert.equal(offer.network, f.chain.network);
    assert.equal(offer.asset.toLowerCase(), f.chain.assetAddress.toLowerCase());
    assert.equal(offer.amount, network === "mainnet" ? "123456" : "123456000000000000");
    assert.equal(offer.payTo, PAY_TO);
    assert.equal(offer.maxTimeoutSeconds, 60);
    assert.equal(offer.extra.name, f.chain.eip712Name);
    assert.equal(offer.extra.version, f.chain.eip712Version);
    assert.deepEqual(f.events, []);
    t.diagnostic(JSON.stringify({ http_status: response.status, payment_required: required }));
  });
}

test("AC-01/04: draft manifest, env defaults and runtime challenge agree", async t => {
  const f = await fixture(t);
  const challenge = decode((await f.unpaid()).headers.get("payment-required"));
  const env = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  assert.equal(manifest.network, challenge.accepts[0].network);
  assert.equal(example.price_usd, "0.001");
  assert.equal(challenge.accepts[0].amount, "1000000000000000");
  assert.match(env, /^KITE_NETWORK=testnet$/m);
  assert.match(env, /^PRICE_USD=0\.001$/m);
  assert.equal(manifest.status, "draft");
  assert.equal(manifest.endpoints.length, 1);
});

test("AC-02: verify -> upstream -> complete body -> settle; receipt and forecast returned", async t => {
  const f = await fixture(t);
  const response = await f.paid({ Authorization: "buyer-secret", Cookie: "buyer-cookie", "X-Payment": "legacy-secret" }, examplePath + "&apikey=buyer-key&apikey=another-key");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), forecast);
  assert.deepEqual(f.events, ["verify", "upstream", "upstream:complete", "settle"]);
  const receipt = decode(response.headers.get("payment-response"));
  assert.equal(receipt.success, true);
  assert.equal(receipt.transaction, MOCK_TX);
  assert.equal(receipt.network, f.chain.network);
  assert.equal(response.headers.get("authorization"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.match(response.headers.get("link"), /open-meteo/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const request = f.upstreamRequests[0];
  const target = new URL(request.url, "https://upstream.invalid");
  assert.equal(target.pathname, "/v1/forecast");
  for (const [key, value] of Object.entries(example.example_request.query)) assert.equal(target.searchParams.get(key), String(value));
  assert.deepEqual(target.searchParams.getAll("apikey"), [KEY]);
  assert.equal(request.headers.authorization, AUTH);
  for (const header of ["payment-signature", "x-payment", "cookie"]) assert.equal(request.headers[header], undefined);
});

test("AC-03: invalid verified signature never calls upstream or settle", async t => {
  const f = await fixture(t, { invalid: true });
  const response = await f.paid();
  assert.equal(response.status, 402);
  assert.ok(response.headers.get("payment-required"));
  assert.deepEqual(f.events, ["verify"]);
});

test("AC-03: malformed signature never calls facilitator, upstream or settle", async t => {
  const f = await fixture(t);
  const response = await fetch(f.url + examplePath, { headers: { "PAYMENT-SIGNATURE": "not-base64-json" } });
  assert.equal(response.status, 402);
  assert.deepEqual(f.events, []);
});

test("AC-03: facilitator verify outage never calls upstream or settle or exposes its body", async t => {
  const f = await fixture(t, { verifyUnavailable: true });
  const response = await f.paid();
  assert.ok(response.status >= 400);
  assert.ok(!(await response.text()).includes(AUTH));
  assert.deepEqual(f.events, ["verify"]);
});

for (const status of [400, 401, 404, 429, 500, 503]) {
  test(`AC-04: upstream ${status} never settles and does not reflect credentials`, async t => {
    const f = await fixture(t, { upstream: (_req, res) => res.status(status).set("Authorization", AUTH).send(KEY) });
    const response = await f.paid();
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: "upstream_error", upstream_status: status });
    assert.equal(response.headers.get("payment-response"), null);
    assert.equal(response.headers.get("authorization"), null);
    assert.deepEqual(f.events, ["verify", "upstream"]);
  });
}

for (const phase of ["headers", "body"]) {
  test(`AC-04: timeout during upstream ${phase} never settles`, async t => {
    const f = await fixture(t, { upstream: (_req, res) => {
      if (phase === "body") { res.set("Content-Type", "application/json"); res.write('{"latitude":52.52,'); }
    } });
    const response = await f.paid();
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), { error: "upstream_timeout" });
    assert.deepEqual(f.events, ["verify", "upstream"]);
  });
}

test("AC-04: upstream connection refused never settles", async t => {
  const f = await fixture(t, { connectionFailure: true });
  const response = await f.paid();
  assert.equal(response.status, 502);
  assert.deepEqual(f.events, ["verify"]);
});

for (const mode of ["truncated", "invalid-json", "wrong-shape", "invalid-coordinates", "oversize", "redirect", "reflected-key", "encoded-key", "reflected-auth", "reflected-token"]) {
  test(`AC-04: upstream ${mode} never settles`, async t => {
    const f = await fixture(t, { upstream: (req, res) => {
      if (mode === "truncated") { res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "10000" }); res.write('{"latitude":52.52,'); setImmediate(() => res.destroy()); }
      if (mode === "invalid-json") res.send("not JSON");
      if (mode === "wrong-shape") res.json({ error: "weather unavailable" });
      if (mode === "invalid-coordinates") res.json({ latitude: false, longitude: false });
      if (mode === "oversize") res.send("x".repeat(2 * 1024 * 1024 + 1));
      if (mode === "redirect") res.redirect("https://must-not-follow.invalid/?apikey=" + KEY);
      if (mode === "reflected-key") res.json({ ...forecast, debug: KEY });
      if (mode === "encoded-key") res.json({ ...forecast, debug: encodeURIComponent(KEY) });
      if (mode === "reflected-auth") res.json({ ...forecast, debug: AUTH });
      if (mode === "reflected-token") res.json({ ...forecast, debug: AUTH.slice("Bearer ".length) });
    } });
    const response = await f.paid();
    assert.equal(response.status, 502);
    const text = await response.text();
    assert.ok(!text.includes(KEY) && !text.includes(AUTH));
    assert.deepEqual(f.events, ["verify", "upstream"]);
  });
}

for (const mode of ["settleFailure", "settleUnavailable"]) {
  test(`AC-02 failure: ${mode} withholds forecast and success receipt`, async t => {
    const f = await fixture(t, { [mode]: true });
    const response = await f.paid();
    assert.equal(response.status, mode === "settleFailure" ? 402 : 502);
    assert.deepEqual(await response.json(), { error: mode === "settleFailure" ? "payment_settlement_failed" : "payment_settlement_unknown" });
    assert.equal(response.headers.get("payment-response"), null);
    assert.deepEqual(f.events, ["verify", "upstream", "upstream:complete", "settle"]);
  });
}

test("Only GET /v1/forecast is paid; health is free and unsupported routes/methods have no side effects", async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.url + "/healthz")).status, 200);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    const response = await fetch(f.url + examplePath, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");
  }
  for (const path of ["/v1/unknown", "/v1//example.com", "/v1/forecast/", "/V1/forecast", "/forecast"]) {
    assert.equal((await fetch(f.url + path)).status, 404);
  }
  assert.deepEqual(f.events, []);
});

test("Invalid configuration fails before serving traffic", () => {
  const valid = { PAY_TO, UPSTREAM_URL: "http://127.0.0.1/v1" };
  for (const change of [
    { PAY_TO: "0xYourKiteWalletAddress" }, { PAY_TO: `0x${"0".repeat(40)}` },
    { PRICE_USD: "0" }, { PRICE_USD: "0.0000001" }, { PRICE_USD: "1e-3" }, { PRICE_USD: "$0.001" },
    { KITE_NETWORK: "other" }, { UPSTREAM_URL: "https://api.open-meteo.com/v1" },
    { UPSTREAM_URL: "https://customer-api.open-meteo.com/v1" }, { UPSTREAM_URL: "https://example.com/?apikey=secret" },
    { UPSTREAM_URL: "http://example.com/v1" }, { UPSTREAM_URL: "https://secret@example.com/v1" },
    { FACILITATOR_URL: "https://facilitator.pieverse.io" }, { UPSTREAM_TIMEOUT_MS: "0" },
    { PORT: "65536" }, { UPSTREAM_AUTH_VALUE: "bad\r\nheader" },
  ]) assert.throws(() => readConfig({ ...valid, ...change }));
});
