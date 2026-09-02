import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const data = JSON.parse(await readFile(new URL("../data/max-green-inventory.json", import.meta.url), "utf8"));

// Every location type the import emits must be one saveLocation accepts, or the imported bins can
// never be edited once they hold stock (the Outside yard is created as 'yard' with on-hand units).
const acceptedLocationTypes = ["storage", "yard", "receiving", "shipping", "quarantine", "in_transit", "scrap"];

test("Max Green import preserves the workbook's two physical locations", () => {
  assert.equal(data.company.name, "Max Green");
  assert.deepEqual(data.company.warehouse.locations.map((location) => location.name), ["Inside", "Outside"]);
  assert.deepEqual(data.company.warehouse.locations.map((location) => location.locationType), ["storage", "yard"]);
  assert.ok(data.company.warehouse.locations.every((location) => acceptedLocationTypes.includes(location.locationType)));
  assert.equal(data.summary.productCount, 154);
  assert.equal(data.summary.insideUnits, 556);
  assert.equal(data.summary.outsideUnits, 62);
  assert.equal(data.summary.openingOnHandUnits, 618);
  assert.equal(data.products.reduce((sum, product) => sum + product.insideQty + product.outsideQty, 0), 618);
});

test("catalog identities and source rows remain unique and auditable", () => {
  assert.equal(new Set(data.products.map((product) => product.id)).size, data.products.length);
  assert.equal(new Set(data.products.map((product) => product.sku)).size, data.products.length);
  assert.ok(data.products.every((product) => product.sourceRow >= 2 && product.name.length > 0));
  assert.equal(data.summary.missingPriceAndCostProducts, 32);
  assert.deepEqual(data.discrepancies.map((item) => item.sourceRow), [6, 44]);
});

test("incoming quantities become purchase commitments, never opening on-hand", () => {
  const productIncoming = data.products.reduce((sum, product) => sum + product.totalOrderedQty, 0);
  const orderIncoming = data.purchaseOrders.reduce(
    (sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.quantity, 0),
    0,
  );
  assert.equal(productIncoming, 488);
  assert.equal(orderIncoming, 488);
  assert.equal(data.purchaseOrders.length, 45);
  assert.ok(data.purchaseOrders.every((order) => order.totalCents === order.lines.reduce((sum, line) => sum + line.quantity * line.unitCostCents, 0)));
});
