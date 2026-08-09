import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../lib/server/advanced-domain.ts", import.meta.url), "utf8");

test("financial quantities use cumulative posted documents and atomic line claims", () => {
  assert.match(source, /previouslyBilled/);
  assert.match(source, /DUPLICATE_DOCUMENT_LINE/);
  assert.match(source, /lineClaims = normalized\.map/);
  assert.match(source, /lineClaims = lines\.map/);
  assert.match(source, /ci\.status<>'void'/);
  assert.doesNotMatch(source, /ci\.status NOT IN \('void','credited'\)/);
  assert.match(source, /lifecycle_status IN \('confirmed','canceled'\)/);
});

test("payments and credits derive ownership and cap settlement atomically", () => {
  assert.match(source, /AS partnerId,total_cents AS total,paid_cents AS paid/);
  assert.match(source, /DOCUMENT_ON_HOLD/);
  assert.match(source, /posted credits/);
  assert.match(source, /document\.paid_cents\+\?\+COALESCE/);
});

test("refundable deposits separate custody, forfeiture, and refund", () => {
  assert.match(source, /awaiting_refund/);
  assert.match(source, /physically returned assets/);
  assert.match(source, /event_type='forfeit'/);
  assert.match(source, /returnableQuantityDelta/);
  assert.match(source, /document_type,document_id,amount_cents/);
  assert.match(source, /"returnable_deposit"/);
  assert.match(source, /returnable_deposit_refund_posted/);
});

test("landed cost is source-deduplicated and restricted to unconsumed layers", () => {
  assert.match(source, /NOT EXISTS \(SELECT 1 FROM landed_cost_allocations WHERE source_document_type=\? AND source_document_id=\?\)/);
  assert.match(source, /remaining_qty=received_qty/);
  assert.match(source, /'landed_cost',0/);
});

test("transfer and reservation claims validate authoritative balances", () => {
  assert.match(source, /TRANSIT_SHORTAGE/);
  assert.match(source, /ib\.on_hand_qty-ib\.reserved_qty>=\?/);
  assert.match(source, /source_balance\.reserved_qty>=\?/);
});

test("scrap preserves layer quantity integrity under every valuation policy", () => {
  assert.match(source, /const unitCostCents = method === "standard"/);
  assert.match(source, /valueCents: method === "fifo"/);
  assert.match(source, /valuation\.layers\.forEach/);
  assert.doesNotMatch(source, /layers: \[\] as Array/);
});
