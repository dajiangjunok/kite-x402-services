import express from "express";
import { ExpressAdapter } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server";
import { encodePaymentResponseHeader } from "@x402/core/http";
import { kiteMoneyParser } from "./kite.js";
import type { ServiceConfig } from "./config.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ATTRIBUTION = '<https://open-meteo.com/>; rel="attribution", <https://creativecommons.org/licenses/by/4.0/>; rel="license"';

/** Read the entire response before settlement; a truncated or oversized body is a failure. */
async function readBody(response: globalThis.Response): Promise<string> {
  if (!response.body) throw new Error("missing upstream body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new Error("upstream body too large");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function createApp(config: ServiceConfig) {
  const { chain } = config;
  // Pass integer token units to the SDK. Its Money parser can coerce a decimal
  // to floating point, losing precision for the testnet's 18-decimal token.
  const price = await kiteMoneyParser(chain)(config.price, chain.network);
  if (!price) throw new Error("Unable to resolve Kite price");
  const facilitator = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const server = new x402ResourceServer(facilitator)
    .register(chain.network, new ExactEvmScheme());
  const payments = new x402HTTPResourceServer(server, {
    "GET /v1/forecast": {
      accepts: { scheme: "exact", price, network: chain.network, payTo: config.payTo, maxTimeoutSeconds: 60 },
      description: config.description,
      mimeType: "application/json",
    },
  });
  await payments.initialize();

  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  app.enable("strict routing");
  app.enable("case sensitive routing");
  app.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, network: chain.network, asset: chain.assetSymbol, price: config.price });
  });

  app.all("/v1/forecast", async (req, res) => {
    // Express also routes HEAD through GET handlers; gate explicitly before payment.
    if (req.method !== "GET") {
      res.set("Allow", "GET").status(405).json({ error: "method_not_allowed" });
      return;
    }
    const adapter = new ExpressAdapter(req);
    const context = { adapter, path: req.path, method: req.method, paymentHeader: req.get("payment-signature") || req.get("x-payment") };
    let verified;
    try {
      verified = await payments.processHTTPRequest(context);
    } catch {
      res.status(502).json({ error: "payment_verification_unavailable" });
      return;
    }
    if (verified.type === "payment-error") {
      // Only protocol headers are exposed, never facilitator exception details.
      const required = verified.response.headers["PAYMENT-REQUIRED"];
      if (required) res.set("PAYMENT-REQUIRED", required);
      res.status(verified.response.status).json({ error: "payment_required" });
      return;
    }
    if (verified.type !== "payment-verified") {
      res.status(500).json({ error: "payment_configuration_error" });
      return;
    }

    // Strip the wrapper /v1 prefix, then append to the configured upstream base
    // path. Open-Meteo itself needs /v1/forecast, hence UPSTREAM_URL ends in /v1.
    // A fixed route prevents buyer-controlled hosts, paths and redirects.
    const target = new URL(config.upstream);
    target.pathname = `${target.pathname.replace(/\/$/, "")}${req.path.slice(3)}`;
    target.search = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    target.searchParams.delete("apikey");
    if (config.apiKey) target.searchParams.set("apikey", config.apiKey);
    const headers = new Headers({ Accept: "application/json" });
    if (config.authValue) headers.set(config.authHeader, config.authValue);
    const signal = AbortSignal.timeout(config.upstreamTimeoutMs);
    let body: string;
    let status: number;
    try {
      const upstream = await fetch(target, { headers, signal, redirect: "error" });
      status = upstream.status;
      if (status >= 400) {
        await upstream.body?.cancel();
        res.status(status).json({ error: "upstream_error", upstream_status: status });
        return;
      }
      const parsed: unknown = JSON.parse(await readBody(upstream));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
          !("latitude" in parsed) || typeof parsed.latitude !== "number" || !Number.isFinite(parsed.latitude) ||
          !("longitude" in parsed) || typeof parsed.longitude !== "number" || !Number.isFinite(parsed.longitude) ||
          ("error" in parsed && parsed.error)) {
        throw new Error("unexpected forecast response");
      }
      // Refuse reflected credentials, including URL-encoded and JSON-escaped
      // forms, instead of exposing upstream error pages or diagnostic fields.
      body = JSON.stringify(parsed);
      const authToken = config.authValue.match(/^(?:Bearer|Basic)\s+(.+)$/i)?.[1] ?? "";
      for (const secret of [config.apiKey, config.authValue, authToken].filter(Boolean)) {
        if ([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]
          .some(value => body.includes(value))) throw new Error("upstream reflected a credential");
      }
    } catch {
      res.status(signal.aborted ? 504 : 502).json({ error: signal.aborted ? "upstream_timeout" : "upstream_unavailable" });
      return;
    }
    if (res.destroyed) return;

    // Only this point can settle: verification passed and the whole upstream
    // response was received successfully. No response is released before settle.
    try {
      // Use the SDK transport directly: processSettlement converts some lost
      // transport replies into ordinary failures and can retry pending charges.
      const settled = await facilitator.settle(verified.paymentPayload, verified.paymentRequirements);
      if (!settled.success) {
        res.status(402).json({ error: "payment_settlement_failed" });
        return;
      }
      if (settled.network !== chain.network || !/^0x[0-9a-fA-F]{64}$/.test(settled.transaction)) {
        throw new Error("invalid settlement receipt");
      }
      res.set("PAYMENT-RESPONSE", encodePaymentResponseHeader(settled))
        .set("Link", ATTRIBUTION).type("application/json").status(status).send(body);
    } catch {
      // A lost settlement reply can mean it settled on-chain. Never retry or
      // claim "not charged"; the buyer must check the facilitator/chain first.
      res.status(502).json({ error: "payment_settlement_unknown" });
    }
  });
  app.use((_req, res) => { res.status(404).json({ error: "not_found" }); });
  return app;
}
