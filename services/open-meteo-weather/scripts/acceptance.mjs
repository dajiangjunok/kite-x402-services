// Default: health + unpaid 402 only. --paid explicitly authorizes one payment
// per manifest endpoint using the contributor's locally configured wallet.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, parseEventLogs } from "viem";
import assert from "node:assert/strict";
import { chainFor, deploymentOrigin, validateOffer, validateForecast } from "./acceptance-lib.mjs";

const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => !["--paid", "--allow-mainnet"].includes(flag))) throw new Error("Usage: npm run acceptance -- [--paid] [--allow-mainnet]");
const paid = flags.has("--paid");
const started = new Date().toISOString();
const dir = new URL("../evidence/", import.meta.url);
mkdirSync(dir, { recursive: true });
const file = new URL(`online-${started.replaceAll(":", "-")}.json`, dir);
const evidence = { kind: paid ? "deployed-paid-acceptance" : "deployed-unpaid-check", started_at: started, outcome: "incomplete", endpoints: [] };
const save = () => writeFileSync(file, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
let stage = "configuration";
try {
  const source = readFileSync(new URL("../service.yaml", import.meta.url), "utf8");
  const manifest = parse(source);
  const base = deploymentOrigin(manifest.base_url);
  const chain = chainFor(manifest.network);
  assert.ok(!paid || chain.network === "eip155:2368" || flags.has("--allow-mainnet"), "Mainnet requires --allow-mainnet");
  assert.notEqual(manifest.pay_to, `0x${"0".repeat(40)}`);
  assert.ok(manifest.endpoints.length === 1 && manifest.endpoints[0].method === "GET" && manifest.endpoints[0].path === "/v1/forecast");
  evidence.service = manifest.name;
  evidence.base_url = base;
  evidence.network = chain.network;
  evidence.pay_to = manifest.pay_to;
  evidence.manifest_sha256 = createHash("sha256").update(source).digest("hex");
  evidence.operator_supplied_deployed_commit = process.env.DEPLOYED_COMMIT_SHA || null;
  let account;
  let client;
  if (paid) {
    assert.match(process.env.BUYER_PRIVATE_KEY || "", /^0x[0-9a-fA-F]{64}$/);
    account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY);
    client = new x402Client().register(chain.network, new ExactEvmScheme(account, { rpcUrl: chain.rpcUrl }));
    evidence.payer = account.address;
  }
  stage = "health";
  const health = await fetch(`${base}/healthz`, { redirect: "error", signal: AbortSignal.timeout(30000) });
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.network, chain.network);
  evidence.health = { status: health.status, body: healthBody };
  for (const endpoint of manifest.endpoints) {
    const url = new URL(endpoint.path, base);
    assert.equal(url.origin, base);
    for (const [key, value] of Object.entries(endpoint.example_request.query)) url.searchParams.set(key, String(value));
    const record = { method: endpoint.method, url: url.href, price_usd: endpoint.price_usd, started_at: new Date().toISOString() };
    evidence.endpoints.push(record);
    stage = "unpaid_challenge";
    const unpaid = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
    assert.equal(unpaid.status, 402);
    const rawRequired = unpaid.headers.get("payment-required");
    const required = decodePaymentRequiredHeader(rawRequired);
    const offer = await validateOffer(required, manifest, endpoint);
    // No server-provided extensions are needed for this exact EIP-3009 service.
    record.unpaid = { status: unpaid.status, payment_required_header: rawRequired, payment_required: required };
    record.amount_units = offer.amount;
    save();
    if (!paid) continue;
    stage = "signing";
    const payload = await client.createPaymentPayload({ x402Version: 2, accepts: [offer], resource: { url: url.href, description: endpoint.summary, mimeType: "application/json" } });
    stage = "paid_request";
    // Exactly one attempt. A timeout may have settled; inspect the chain before rerunning.
    const response = await fetch(url, {
      method: endpoint.method, redirect: "error", signal: AbortSignal.timeout(90000),
      headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) },
    });
    record.paid = { status: response.status, completed_at: new Date().toISOString() };
    const rawReceipt = response.headers.get("payment-response");
    if (rawReceipt) record.paid.settlement = decodePaymentResponseHeader(rawReceipt);
    save();
    assert.ok(response.status >= 200 && response.status < 300);
    const settlement = record.paid.settlement;
    assert.equal(settlement?.success, true);
    assert.equal(settlement.network, chain.network);
    assert.match(settlement.transaction, /^0x[0-9a-fA-F]{64}$/);
    const body = await response.json();
    validateForecast(body, endpoint.example_request.query);
    record.paid.body = body;
    save();
    stage = "onchain_receipt";
    const rpc = createPublicClient({ transport: http(chain.rpcUrl) });
    assert.equal(await rpc.getChainId(), Number(chain.network.split(":")[1]));
    const receipt = await rpc.waitForTransactionReceipt({ hash: settlement.transaction, timeout: 90000 });
    assert.equal(receipt.status, "success");
    const transfers = parseEventLogs({
      abi: [{ type: "event", name: "Transfer", inputs: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false }] }],
      logs: receipt.logs.filter(log => log.address.toLowerCase() === chain.assetAddress.toLowerCase()),
    });
    const transfer = transfers.find(log => log.args.from.toLowerCase() === account.address.toLowerCase() && log.args.to.toLowerCase() === manifest.pay_to.toLowerCase() && log.args.value === BigInt(offer.amount));
    assert.ok(transfer, "No matching token transfer in transaction receipt");
    record.onchain = { status: receipt.status, transaction: receipt.transactionHash, block_number: receipt.blockNumber.toString(), asset: chain.assetAddress, payer: account.address, pay_to: manifest.pay_to, amount_units: offer.amount };
    save();
  }
  evidence.outcome = paid ? "paid_acceptance_passed" : "unpaid_check_passed";
  evidence.completed_at = new Date().toISOString();
  save();
  console.log(`${evidence.outcome}: ${file.pathname}`);
} catch {
  evidence.outcome = "failed_or_incomplete";
  evidence.failure_stage = stage;
  evidence.completed_at = new Date().toISOString();
  save();
  // SDK errors can contain signed payloads. Keep raw exceptions out of evidence/logs.
  console.error(`Acceptance incomplete at ${stage}; see ${file.pathname}. No payment is retried automatically.`);
  process.exitCode = 1;
}
