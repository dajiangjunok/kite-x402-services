import { FACILITATOR_URL, kiteChainByName } from "./kite.js";

export function readConfig(source: NodeJS.ProcessEnv = process.env) {
  const env = (key: string, fallback = "") => source[key]?.trim() || fallback;
  const payTo = env("PAY_TO");
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo) || /^0x0{40}$/.test(payTo)) {
    throw new Error("PAY_TO must be a nonzero EVM wallet address");
  }
  const price = env("PRICE_USD", "0.001");
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(price) || Number(price) <= 0) {
    throw new Error("PRICE_USD must be a positive decimal string with at most 6 decimal places");
  }
  const parseUrl = (key: string, fallback: string) => {
    let url: URL;
    try { url = new URL(env(key, fallback)); } catch { throw new Error(`${key} must be a valid URL`); }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
        url.username || url.password || url.search || url.hash) {
      throw new Error(`${key} requires HTTPS (HTTP only on loopback), without credentials, query or fragment`);
    }
    return url;
  };
  const upstream = parseUrl("UPSTREAM_URL", "https://customer-api.open-meteo.com/v1");
  if (upstream.hostname === "api.open-meteo.com") {
    throw new Error("The free Open-Meteo API does not permit commercial use; configure a licensed upstream");
  }
  const apiKey = env("OPEN_METEO_API_KEY");
  if (upstream.hostname === "customer-api.open-meteo.com" && !apiKey) {
    throw new Error("OPEN_METEO_API_KEY is required for the commercial Open-Meteo endpoint");
  }
  const facilitatorUrl = parseUrl("FACILITATOR_URL", FACILITATOR_URL);
  if (!facilitatorUrl.pathname.replace(/\/$/, "").endsWith("/v2")) {
    throw new Error("FACILITATOR_URL must retain the /v2 suffix");
  }
  const authHeader = env("UPSTREAM_AUTH_HEADER", "Authorization");
  const authValue = env("UPSTREAM_AUTH_VALUE");
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(authHeader) || /[\r\n]/.test(authValue)) {
    throw new Error("Invalid upstream authentication header configuration");
  }
  try { new Headers().set(authHeader, authValue); } catch {
    throw new Error("Invalid upstream authentication header configuration");
  }
  const integer = (key: string, fallback: string, max: number) => {
    const raw = env(key, fallback);
    if (!/^[1-9][0-9]*$/.test(raw) || Number(raw) > max) throw new Error(`${key} must be an integer from 1 to ${max}`);
    return Number(raw);
  };
  return {
    payTo,
    chain: kiteChainByName(env("KITE_NETWORK", "testnet")),
    price,
    upstream,
    apiKey,
    authHeader,
    authValue,
    facilitatorUrl: facilitatorUrl.href.replace(/\/$/, ""),
    upstreamTimeoutMs: integer("UPSTREAM_TIMEOUT_MS", "15000", 120000),
    port: integer("PORT", "8080", 65535),
    description: env("SERVICE_DESCRIPTION", "Open-Meteo weather forecast for a coordinate"),
  };
}

export type ServiceConfig = ReturnType<typeof readConfig>;
