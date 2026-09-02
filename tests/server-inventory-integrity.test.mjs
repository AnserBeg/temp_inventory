import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const domain = readFileSync(new URL("../lib/server/inventory-domain.ts", import.meta.url), "utf8");
const advanced = readFileSync(new URL("../lib/server/advanced-domain.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../drizzle/0007_slow_thor_girl.sql", import.meta.url), "utf8");

test("all outbound legacy postings couple stock, layers, and immutable value entries", () => {
  for (const entryType of ["receipt_reversal", "vendor_return", "shipment"]) {
    assert.ok(domain.includes(`entryType: "${entryType}"`), `${entryType} must have an immutable value entry`);
  }
  assert.match(domain, /entryType: openingBalance \? "opening_balance" : delta > 0 \? "inventory_adjustment_gain" : "inventory_adjustment_loss"/);
  assert.match(domain, /layerClaimPredicate\(valuation\.layers\)/);
  assert.match(domain, /layerConsumptionPrepared\(input, valuation\.layers\)/);
  // Balance claims compare with a one-millionth tolerance and mutations round to six places so
  // precision-3 products cannot drift into the non-negative triggers (0.3-0.1-0.2 = -2.8e-17).
  assert.match(domain, /qtyAtLeast\("on_hand_qty - reserved_qty"\)/);
  assert.match(domain, /const qtyMinus = \(column: string\) => `ROUND\(\$\{column\} - \?, 6\)`/);
  assert.match(domain, /const qtyAtLeast = \(expression: string\) => `\$\{expression\} >= \? - \$\{QTY_EPSILON\}`/);
  assert.doesNotMatch(domain, /SET on_hand_qty = on_hand_qty - \?/);
  assert.doesNotMatch(domain, /SET on_hand_qty=on_hand_qty-\?/);
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
  assert.match(reversal, /ownLayerQuantity === layer\.remainingQty/);
  // A consumed receipt layer no longer blocks the reversal: the remainder is funded from the
  // product's other open layers and the difference is posted as a balancing cost variance.
  assert.match(reversal, /openLayersForIssue\(source\.productId, otherLayerQuantity, layer\.id\)/);
  assert.match(reversal, /entryType: "cost_variance"/);
  assert.match(reversal, /costVarianceCents = otherAtReceiptCostCents - otherLayers\.valueCents/);
  assert.match(reversal, /RECEIPT_LAYER_CONSUMED/);
  assert.match(reversal, /RECEIPT_REVERSAL_AP_CONFLICT/);
  assert.match(reversal, /vb\.match_status='matched'/);
  assert.match(reversal, /Correct or credit the vendor bill first/);
  assert.match(reversal, /apIntegrityChecked: true/);
});

test("shipment fulfillment is net of explicit reversals", () => {
  assert.match(domain, /sm\.movement_type = 'shipment_reversal' THEN -sm\.quantity/);
  // Shipment reversal has exactly one implementation: the workflow dispatcher, which also
  // restores lot/serial identity. The legacy /api/commands alias was an incomplete duplicate.
  assert.doesNotMatch(domain, /case "reverseshipment"/);
  assert.doesNotMatch(domain, /async function reverseShipment/);
  assert.doesNotMatch(domain, /reverseShipment: "operationalWrite"/);
  assert.match(advanced, /case "reverseshipment": return reverseShipment\(command\)/);
  assert.match(advanced, /INVOICED_SHIPMENT/);
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
    "inventory.customer_return_received",
    "inventory.count_posted",
  ]) assert.match(domain, new RegExp(event.replaceAll(".", "\\.")));
  assert.match(advanced, /outboxStatement\(command, "shipment\.reversed"/);
  assert.match(domain, /actor_id, actor_email/);
});

test("receipt and customer-return postings require active status-compatible locations", () => {
  const receiptStart = domain.indexOf("async function postReceipt");
  const returnStart = domain.indexOf("async function postCustomerReturn");
  const receipt = domain.slice(receiptStart, domain.indexOf("async function closeRemainder", receiptStart));
  const customerReturn = domain.slice(returnStart, domain.indexOf("async function postInventoryAdjustment", returnStart));
  for (const block of [receipt, customerReturn]) {
    assert.match(block, /requireActiveLocation/);
    assert.match(block, /EXISTS \(SELECT 1 FROM locations WHERE id=\? AND active=1/);
  }
  assert.match(schema, /inventoryBalances[\s\S]*productId: text\("product_id"\)\.notNull\(\)\.references\(\(\) => products\.id\)/);
  assert.match(schema, /inventoryBalances[\s\S]*locationId: text\("location_id"\)\.notNull\(\)\.references\(\(\) => locations\.id\)/);
  assert.match(migration, /__inventory_balance_fk_guard/);
  assert.match(migration, /PRAGMA foreign_key_check/);
});

test("snapshot reconciliation exposes orphaned balances, movements, and value", () => {
  for (const field of ["orphanedBalanceRows", "orphanedBalanceUnits", "orphanedMovementCount", "orphanedInventoryValueCents"]) {
    assert.match(domain, new RegExp(field));
  }
});

test("receiving supports one-document batches and line-level optimistic locking", () => {
  assert.match(domain, /async function postReceiptBatch/);
  assert.match(domain, /inventory\.batch_receipt_posted/);
  assert.match(domain, /purchase_order_lines SET version=version\+1/);
  assert.match(domain, /case "postreceiptbatch": return postReceiptBatch\(input\)/);
  assert.match(schema, /purchaseOrderLines[\s\S]*version: integer\("version"\)\.notNull\(\)\.default\(1\)/);
});
