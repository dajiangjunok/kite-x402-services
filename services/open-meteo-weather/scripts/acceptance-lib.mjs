import assert from "node:assert/strict";
import { kiteMoneyParser, KITE_MAINNET, KITE_TESTNET } from "../dist/kite.js";

export function deploymentOrigin(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "https:", "Public HTTPS is required");
  assert.equal(url.origin, value, "base_url must be an origin without path, query or credentials");
  assert.ok(!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "A public deployment is required");
  return url.origin;
}

export function chainFor(network) {
  const chain = [KITE_MAINNET, KITE_TESTNET].find(value => value.network === network);
  assert.ok(chain, "Unsupported payment network");
  return chain;
}

export async function validateOffer(required, manifest, endpoint) {
  const chain = chainFor(manifest.network);
  assert.match(manifest.pay_to, /^0x[0-9a-fA-F]{40}$/);
  assert.notEqual(manifest.pay_to, `0x${"0".repeat(40)}`, "Replace the draft pay_to placeholder before acceptance");
  assert.match(endpoint.price_usd, /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/);
  const expected = await kiteMoneyParser(chain)(endpoint.price_usd, chain.network);
  assert.equal(required.x402Version, 2);
  assert.equal(required.accepts.length, 1, "Expected one exact offer");
  const offer = required.accepts[0];
  assert.equal(offer.scheme, "exact");
  assert.equal(offer.network, chain.network);
  assert.equal(offer.payTo.toLowerCase(), manifest.pay_to.toLowerCase());
  assert.equal(offer.asset.toLowerCase(), chain.assetAddress.toLowerCase());
  assert.equal(offer.amount, expected.amount, "Price differs from manifest");
  assert.equal(offer.extra?.name, chain.eip712Name);
  assert.equal(offer.extra?.version, chain.eip712Version);
  assert.ok(!offer.extra?.assetTransferMethod || offer.extra.assetTransferMethod === "eip3009");
  assert.ok(!offer.extra?.paymentFlow || offer.extra.paymentFlow === "authorization");
  assert.equal(offer.maxTimeoutSeconds, 60);
  return offer;
}

export function validateForecast(body, query) {
  assert.equal(typeof body?.latitude, "number");
  assert.equal(typeof body?.longitude, "number");
  // Coordinates describe the selected model grid cell, so allow small offsets.
  assert.ok(Math.abs(body.latitude - Number(query.latitude)) < 1);
  assert.ok(Math.abs(body.longitude - Number(query.longitude)) < 1);
  for (const group of ["current", "hourly", "daily"]) {
    if (!query[group]) continue;
    assert.ok(body[group], `Missing ${group} forecast`);
    for (const variable of String(query[group]).split(",")) {
      const values = group === "current" ? [body[group][variable]] : body[group][variable];
      assert.ok(Array.isArray(values) && values.length > 0, `Missing ${group}.${variable}`);
      assert.ok(values.some(value => typeof value === "number" && Number.isFinite(value)), `No numeric data for ${variable}`);
    }
    if (group !== "current") assert.ok(body[group].time?.length > 0);
  }
}
