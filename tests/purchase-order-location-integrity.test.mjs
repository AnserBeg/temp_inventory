import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../lib/server/advanced-domain.ts", import.meta.url), "utf8");
const operationsSource = await readFile(new URL("../app/components/operations-suite.tsx", import.meta.url), "utf8");

const functionSource = (name, nextName) => {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end);
};

test("purchase-order amendment rejection restores the prior approved commitment atomically", () => {
  const decide = functionSource("decidePurchaseOrder", "amendPurchaseOrder");
  assert.match(decide, /requestType === "purchase_order_amendment"/);
  assert.match(decide, /parsed\.previous/);
  assert.match(decide, /REVISION_RESTORE_MISSING/);
  assert.match(decide, /SET lifecycle_status='approved',revision_number=\?,total_cents=\?,base_total_cents=\?/);
  assert.match(decide, /UPDATE purchase_order_lines SET ordered_qty=\?,unit_cost_cents=\?/);
  assert.match(decide, /amendment_rejected_restored/);
  assert.match(decide, /EXISTS \(SELECT 1 FROM approvals WHERE id=\? AND version=\? AND status='pending'\)/);
});

test("purchase-order amendments retain received, closed, and drop-ship quantities", () => {
  const amend = functionSource("amendPurchaseOrder", "decideApproval");
  assert.match(amend, /pol\.fulfillment_route='drop_ship'/);
  assert.match(amend, /SUM\(d\.quantity-d\.reversed_qty\)/);
  assert.match(amend, /line\.retained \+ line\.closed/);
  assert.match(amend, /lines: amendedLines, charges, previous/);
  assert.match(amend, /MAX\(revision_number\)/);
  assert.match(amend, /NOT EXISTS \(SELECT 1 FROM purchase_order_revisions WHERE purchase_order_id=\? AND revision_number=\?\)/);
  assert.doesNotMatch(amend, /Math\.max\(line\.retained, line\.closed\)/);
});

test("inter-warehouse transfers use an active configured transit location", () => {
  const move = functionSource("moveInventory", "scrapInventory");
  assert.match(move, /optionalText\(payload, "inTransitLocationId"\)/);
  assert.match(move, /location_type='in_transit' AND inventory_status='in_transit' AND active=1/);
  assert.match(move, /TRANSIT_LOCATION_REQUIRED/);
  assert.match(move, /EXISTS \(SELECT 1 FROM locations transit/);
  assert.match(move, /inTransitLocationId: interWarehouse \? destinationId : null/);
  assert.doesNotMatch(move, /loc-interwarehouse-transit/);
  assert.match(operationsSource, /<option value="in_transit">In transit<\/option>/);
  assert.match(operationsSource, /detail === "in_transit" \? "in_transit" : "usable"/);
});

test("locations with stock cannot be reclassified or deactivated", () => {
  const save = functionSource("saveLocation", "deactivateLocation");
  const deactivate = functionSource("deactivateLocation", "saveReturnableAssetType");
  for (const block of [save, deactivate]) {
    assert.match(block, /LOCATION_HAS_STOCK/);
    assert.match(block, /on_hand_qty<>0 OR reserved_qty<>0/);
    assert.match(block, /inventory_units WHERE location_id=\? AND lifecycle_status='on_hand'/);
    assert.match(block, /NOT EXISTS \(SELECT 1 FROM inventory_balances/);
    assert.match(block, /NOT EXISTS \(SELECT 1 FROM inventory_units/);
  }
  assert.match(source, /case "deactivatelocation": return deactivateLocation\(command\)/);
});
