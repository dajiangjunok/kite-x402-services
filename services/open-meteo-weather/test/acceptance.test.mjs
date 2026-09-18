import test from "node:test";
import assert from "node:assert/strict";
import { deploymentOrigin, validateOffer, validateForecast } from "../scripts/acceptance-lib.mjs";
import { KITE_TESTNET, kiteMoneyParser } from "../dist/kite.js";

const payTo = `0x${"1".repeat(40)}`;
const endpoint = { price_usd: "0.001" };
const manifest = { pay_to: payTo, network: "eip155:2368" };
const asset = await kiteMoneyParser(KITE_TESTNET)(endpoint.price_usd, manifest.network);
const offer = { scheme: "exact", network: manifest.network, payTo, maxTimeoutSeconds: 60, ...asset };

test("Acceptance refuses signing changed amount, recipient, network, asset, domain or upfront flow", async () => {
  assert.equal(await validateOffer({ x402Version: 2, accepts: [offer] }, manifest, endpoint), offer);
  for (const change of [
    { amount: "1000000000000001" }, { payTo: `0x${"2".repeat(40)}` }, { network: "eip155:2366" },
    { asset: `0x${"2".repeat(40)}` }, { scheme: "other" }, { maxTimeoutSeconds: 6000 },
    { extra: { ...offer.extra, name: "other" } }, { extra: { ...offer.extra, version: "other" } },
    { extra: { ...offer.extra, paymentFlow: "upfront" } }, { extra: { ...offer.extra, assetTransferMethod: "permit2" } },
  ]) await assert.rejects(validateOffer({ x402Version: 2, accepts: [{ ...offer, ...change }] }, manifest, endpoint));
  await assert.rejects(validateOffer({ x402Version: 2, accepts: [offer] }, { ...manifest, pay_to: `0x${"0".repeat(40)}` }, endpoint));
});

test("Acceptance requires a public HTTPS origin without URL credentials, paths or queries", () => {
  assert.equal(deploymentOrigin("https://weather.example.com"), "https://weather.example.com");
  for (const value of ["http://weather.example.com", "https://localhost", "https://127.0.0.1", "https://weather.example.com/v1", "https://weather.example.com/", "https://secret@weather.example.com", "https://weather.example.com?x=1"]) assert.throws(() => deploymentOrigin(value));
});

test("Acceptance verifies requested forecast fields rather than trusting HTTP 200", () => {
  const body = { latitude: 52.52, longitude: 13.41, current: { temperature_2m: 20 }, hourly: { time: ["2026-01-01T00:00"], temperature_2m: [19] } };
  const query = { latitude: 52.52, longitude: 13.41, current: "temperature_2m", hourly: "temperature_2m" };
  validateForecast(body, query);
  assert.throws(() => validateForecast({ ...body, latitude: 0 }, query));
  assert.throws(() => validateForecast({ ...body, current: { temperature_2m: null } }, query));
  assert.throws(() => validateForecast({ ...body, hourly: { temperature_2m: [] } }, query));
});
