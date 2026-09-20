import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync("supabase/functions/send-push-notifications/worker.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { dispatchNotifications, pollNotificationReceipts } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const tickets = [];
const client = { rpc: async (name, args) => {
  if (name === "claim_notification_deliveries") return { data: [{ id: "a", lease_id: "la" }, { id: "b", lease_id: "lb" }, { id: "c", lease_id: "lc" }, { id: "d", lease_id: "ld" }], error: null };
  if (name === "prepare_notification_delivery") return { data: args.delivery_id === "d" ? null : { to: args.delivery_id }, error: null };
  if (name === "finish_notification_ticket") { tickets.push(args); return { data: null, error: null }; }
  throw new Error(name);
} };
const fetcher = async (_url, options) => {
  const [{ to }] = JSON.parse(options.body);
  if (to === "a") return Response.json({ data: [{ status: "ok", id: "ticket-a" }] });
  if (to === "b") return Response.json({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] });
  throw new TypeError("network response lost");
};
const result = await dispatchNotifications(client, { fetcher });
assert.deepEqual(result, { processed: 4, ticket_accepted: 1, failed: 2, suppressed: 1 });
assert.equal(tickets.find(row => row.delivery_id === "a").ticket, "ticket-a");
assert.equal(tickets.find(row => row.delivery_id === "b").error_code, "DeviceNotRegistered");
assert.equal(tickets.find(row => row.delivery_id === "c").error_code, "send_outcome_unknown");
const updates = [];
const pending = [
  { id: "a", device_id: "da", ticket_id: "ta", ticket_at: "2026-09-10T00:00Z", event_id: "ea", attempts: 1 },
  { id: "b", device_id: "db", ticket_id: "tb", ticket_at: "2026-09-10T00:00Z", event_id: "eb", attempts: 1 },
  { id: "c", device_id: "dc", ticket_id: "tc", ticket_at: "2026-09-10T00:00Z", event_id: "ec", attempts: 1 },
];
const receiptClient = { from: table => {
  let select = ""; let update = null; const filters = {};
  const chain = {
    select(value) { select = value; return chain; }, update(value) { update = value; return chain; },
    eq(key, value) { filters[key] = value; return chain; }, lte() { return chain; }, order() { return chain; }, limit() { return chain; },
    then(resolve) {
      if (update) { updates.push({ table, update, filters }); return Promise.resolve({ data: null, error: null }).then(resolve); }
      return Promise.resolve({ data: select === "status" ? [{ status: "receipt_ok" }] : pending, error: null }).then(resolve);
    },
  }; return chain;
} };
let receiptCalls = 0;
const receipts = await pollNotificationReceipts(receiptClient, { now: () => Date.parse("2026-09-11T01:00Z"), fetcher: async (url, options) => {
  receiptCalls++; assert.ok(url.endsWith("getReceipts")); assert.deepEqual(JSON.parse(options.body).ids, ["ta", "tb", "tc"]);
  return Response.json({ data: { ta: { status: "ok" }, tb: { status: "error", details: { error: "DeviceNotRegistered" } } } });
} });
assert.equal(receiptCalls, 1);
assert.deepEqual(receipts, { checked: 3, receipt_ok: 1, unknown: 1 });
assert.ok(updates.some(row => row.filters.id === "a" && row.update.status === "receipt_ok"));
assert.ok(updates.some(row => row.filters.id === "b" && row.update.status === "failed"));
assert.ok(updates.some(row => row.filters.id === "db" && row.table === "device_push_tokens" && row.update.enabled === false));
assert.ok(updates.some(row => row.filters.id === "c" && row.update.status === "receipt_unknown"));
assert.ok(updates.every(row => row.update.status !== "delivered"));
console.log("PASS notification worker: per-device tickets/errors, suppressed delivery, unknown HTTP outcome, receipt polling, invalid-token revocation, 24h receipt unknown; no actual provider or device calls.");
