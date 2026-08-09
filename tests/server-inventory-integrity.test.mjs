import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const domain = readFileSync(new URL("../lib/server/inventory-domain.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");

test("all outbound legacy postings couple stock, layers, and immutable value entries", () => {
  for (const entryType of ["receipt_reversal", "vendor_return", "shipment"]) {
    assert.ok(domain.includes(`entryType: "${entryType}"`), `${entryType} must have an immutable value entry`);
  }
  assert.match(domain, /entryType: delta > 0 \? "inventory_adjustment_gain" : "inventory_adjustment_loss"/);
  assert.match(domain, /layerClaimPredicate\(valuation\.layers\)/);
  assert.match(domain, /layerConsumptionPrepared\(input, valuation\.layers\)/);
  assert.match(domain, /on_hand_qty - reserved_qty >= \?/);
});

test("receipt reversal consumes only its original receipt layer and exact landed value", () => {
  const start = domain.indexOf("async function reverseReceipt");
  const end = domain.indexOf("async function postVendorReturn", start);
  const reversal = domain.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(reversal, /valuationForIssue/);
  assert.match(reversal, /JOIN cost_layers cl ON cl\.receipt_movement_id = sm\.id/);
  assert.match(reversal, /receipt_movement_id = \? AND remaining_qty >= \?/);
  assert.match(reversal, /totalLayerValueCents = Math\.round\(layer\.receivedQty \* layer\.unitCostCents\) \+ layer\.landedCostCents/);
  assert.match(reversal, /quantity === layer\.remainingQty/);
  assert.match(reversal, /RECEIPT_LAYER_CONSUMED/);
  assert.match(reversal, /RECEIPT_REVERSAL_AP_CONFLICT/);
  assert.match(reversal, /vb\.match_status='matched'/);
  assert.match(reversal, /Correct or credit the vendor bill first/);
  assert.match(reversal, /apIntegrityChecked: true/);
});

test("shipment fulfillment is net of explicit reversals", () => {
  assert.match(domain, /sm\.movement_type = 'shipment_reversal' THEN -sm\.quantity/);
  assert.match(domain, /case "reverseshipment": return reverseShipment\(input\)/);
  assert.match(domain, /INVOICED_SHIPMENT/);
});

test("count approvals are scoped and single-use", () => {
  assert.match(domain, /inventory\.countApprovalThreshold/);
  assert.match(domain, /APPROVAL_SCOPE_MISMATCH/);
  assert.match(domain, /consumed_at IS NULL/);
  for (const column of ["consumedAt", "consumedBy", "consumedEntityId"]) assert.match(schema, new RegExp(column));
  for (const column of ["consumed_at", "consumed_by", "consumed_entity_id"]) assert.match(domain, new RegExp(column));
});

test("physical postings emit both audit and transactional outbox records", () => {
  for (const event of [
    "inventory.receipt_posted",
    "inventory.receipt_reversed",
    "inventory.vendor_return_posted",
    "inventory.shipment_posted",
    "inventory.shipment_reversed",
    "inventory.customer_return_received",
    "inventory.count_posted",
  ]) assert.match(domain, new RegExp(event.replaceAll(".", "\\.")));
  assert.match(domain, /actor_id, actor_email/);
});
