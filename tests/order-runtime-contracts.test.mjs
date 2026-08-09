import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const recordsSource = readFileSync(new URL("../lib/server/inventory-records.ts", import.meta.url), "utf8");
const uiSource = readFileSync(new URL("../app/inventory-app.tsx", import.meta.url), "utf8");
const inventorySource = readFileSync(new URL("../lib/server/inventory-domain.ts", import.meta.url), "utf8");

test("purchase-order insert projects exactly one value per persisted column", () => {
  const match = recordsSource.match(/INSERT INTO purchase_orders \(([^)]+)\)\s*\n\s*SELECT ([\s\S]*?) WHERE EXISTS/);
  assert.ok(match, "purchase-order insert contract must remain discoverable");
  const columns = match[1].split(",").map((value) => value.trim());
  const values = match[2].split(",").map((value) => value.trim());
  assert.equal(values.length, columns.length, `purchase_orders has ${columns.length} columns but ${values.length} projected values`);
});

test("multi-line physical commands post an explicit durable line id", () => {
  assert.match(uiSource, /Purchase order line/);
  assert.match(uiSource, /Sales order line/);
  assert.match(uiSource, /\{ lineId \}/);
  assert.match(uiSource, /selectedPoLine\?\.id/);
  assert.match(uiSource, /selectedSoLine\?\.id/);
});

test("invoice eligibility is cumulative and comes from posted invoice lines", () => {
  assert.match(inventorySource, /AS invoicedQuantity/);
  assert.match(inventorySource, /ci\.status<>'void'/);
  assert.match(uiSource, /so\.invoiced \?\? 0/);
  assert.match(uiSource, /Math\.max\(so\.shipped - invoiced, 0\)/);
});
