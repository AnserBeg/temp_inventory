import assert from "node:assert/strict";
import test from "node:test";

import {
  approveInventoryCount,
  approvePurchaseOrder,
  closePurchaseOrderRemainder,
  confirmSalesOrder,
  createInventoryCount,
  createInventoryLedger,
  createMovement,
  createPurchaseOrderLine,
  createSalesOrderLine,
  deriveInventoryCount,
  derivePurchaseOrderQuantities,
  deriveSalesOrderQuantities,
  getInventoryMetrics,
  getLocationBalance,
  movementBalance,
  postInventoryMovements,
  postPriceOnlyVendorCredit,
  receivePurchaseOrder,
  reopenPurchaseOrderQuantity,
  reserveSalesOrderStock,
  returnFromCustomer,
  returnToVendor,
  reversePurchaseOrderReceipt,
  shipSalesOrder,
} from "../lib/domain/index.js";

function domainError(code) {
  return (error) => error?.code === code;
}

function postResult(ledger, result, key) {
  if (result.movements.length === 0) return ledger;
  return postInventoryMovements(ledger, {
    idempotencyKey: key,
    movements: result.movements,
  }).state;
}

test("PO sequence keeps commitments separate from physical inventory", () => {
  let line = createPurchaseOrderLine({
    id: "PO-100:1",
    productId: "WIN-3648",
    orderedQuantity: 100,
    warehouseLocationId: "RACK-A",
  });
  let ledger = createInventoryLedger({
    locations: [{ id: "RACK-A", kind: "internal" }],
  });

  const approved = approvePurchaseOrder(line, { idempotencyKey: "approve-100" });
  line = approved.state;
  assert.equal(approved.movements.length, 0);
  assert.equal(approved.impact.onHandDelta, 0);
  assert.equal(derivePurchaseOrderQuantities(line).incomingQuantity, 100);
  assert.equal(getInventoryMetrics(ledger, line.productId).onHandQuantity, 0);

  const firstReceiptCommand = {
    idempotencyKey: "receive-60",
    quantity: 60,
  };
  const firstReceipt = receivePurchaseOrder(line, firstReceiptCommand);
  line = firstReceipt.state;
  ledger = postResult(ledger, firstReceipt, "ledger-receive-60");
  assert.deepEqual(
    {
      net: derivePurchaseOrderQuantities(line).netRetainedQuantity,
      incoming: derivePurchaseOrderQuantities(line).incomingQuantity,
      onHand: getInventoryMetrics(ledger, line.productId).onHandQuantity,
    },
    { net: 60, incoming: 40, onHand: 60 },
  );
  const receiptRetry = receivePurchaseOrder(line, firstReceiptCommand);
  assert.equal(receiptRetry.duplicate, true);
  assert.equal(receiptRetry.movements.length, 0);
  assert.equal(
    derivePurchaseOrderQuantities(receiptRetry.state).grossReceivedQuantity,
    60,
  );

  const closed = closePurchaseOrderRemainder(line, {
    idempotencyKey: "close-40",
    quantity: 40,
    reason: "Vendor cannot complete the backorder",
  });
  line = closed.state;
  assert.equal(closed.movements.length, 0);
  assert.equal(closed.impact.onHandDelta, 0);
  assert.deepEqual(
    {
      closed: derivePurchaseOrderQuantities(line).notExpectedQuantity,
      incoming: derivePurchaseOrderQuantities(line).incomingQuantity,
      onHand: getInventoryMetrics(ledger, line.productId).onHandQuantity,
    },
    { closed: 40, incoming: 0, onHand: 60 },
  );

  const reopened = reopenPurchaseOrderQuantity(line, {
    idempotencyKey: "reopen-20",
    quantity: 20,
    reason: "Vendor reconfirmed partial supply",
    expectedDate: "2026-08-20",
  });
  line = reopened.state;
  assert.equal(reopened.movements.length, 0);
  assert.equal(reopened.impact.onHandDelta, 0);
  assert.deepEqual(
    {
      closed: derivePurchaseOrderQuantities(line).notExpectedQuantity,
      incoming: derivePurchaseOrderQuantities(line).incomingQuantity,
      onHand: getInventoryMetrics(ledger, line.productId).onHandQuantity,
    },
    { closed: 20, incoming: 20, onHand: 60 },
  );

  const secondReceipt = receivePurchaseOrder(line, {
    idempotencyKey: "receive-20",
    quantity: 20,
  });
  line = secondReceipt.state;
  ledger = postResult(ledger, secondReceipt, "ledger-receive-20");
  assert.equal(getInventoryMetrics(ledger, line.productId).onHandQuantity, 80);
  assert.equal(derivePurchaseOrderQuantities(line).incomingQuantity, 0);

  const reversed = reversePurchaseOrderReceipt(line, {
    idempotencyKey: "reverse-10",
    quantity: 10,
    reason: "Receiver entered ten too many",
    remainingExpected: true,
  });
  line = reversed.state;
  ledger = postResult(ledger, reversed, "ledger-reverse-10");
  assert.deepEqual(
    {
      net: derivePurchaseOrderQuantities(line).netRetainedQuantity,
      open: derivePurchaseOrderQuantities(line).openToReceiveQuantity,
      incoming: derivePurchaseOrderQuantities(line).incomingQuantity,
      onHand: getInventoryMetrics(ledger, line.productId).onHandQuantity,
    },
    { net: 70, open: 10, incoming: 10, onHand: 70 },
  );
});

test("vendor replacement and refund returns have distinct commitment effects", () => {
  let base = createPurchaseOrderLine({
    id: "PO-RET:1",
    productId: "WIN-RET",
    orderedQuantity: 10,
  });
  base = approvePurchaseOrder(base, { idempotencyKey: "ret-approve" }).state;
  base = receivePurchaseOrder(base, {
    idempotencyKey: "ret-receive",
    quantity: 10,
  }).state;

  const replacement = returnToVendor(base, {
    idempotencyKey: "return-replace",
    quantity: 2,
    reason: "Damaged on arrival",
    disposition: "replacement",
  });
  assert.equal(replacement.impact.onHandDelta, -2);
  assert.deepEqual(
    {
      retained: derivePurchaseOrderQuantities(replacement.state).netRetainedQuantity,
      open: derivePurchaseOrderQuantities(replacement.state).openToReceiveQuantity,
      closed: derivePurchaseOrderQuantities(replacement.state).notExpectedQuantity,
    },
    { retained: 8, open: 2, closed: 0 },
  );

  const refund = returnToVendor(base, {
    idempotencyKey: "return-refund",
    quantity: 2,
    reason: "Customer canceled; refund agreed",
    disposition: "refund",
  });
  assert.equal(refund.impact.onHandDelta, -2);
  assert.deepEqual(
    {
      retained: derivePurchaseOrderQuantities(refund.state).netRetainedQuantity,
      open: derivePurchaseOrderQuantities(refund.state).openToReceiveQuantity,
      closed: derivePurchaseOrderQuantities(refund.state).notExpectedQuantity,
    },
    { retained: 8, open: 0, closed: 2 },
  );
});

test("a price-only credit is financial only and idempotent", () => {
  let line = createPurchaseOrderLine({
    id: "PO-CREDIT:1",
    productId: "WIN-CREDIT",
    orderedQuantity: 5,
  });
  line = approvePurchaseOrder(line, { idempotencyKey: "credit-approve" }).state;
  line = receivePurchaseOrder(line, {
    idempotencyKey: "credit-receive",
    quantity: 5,
  }).state;
  const quantitiesBefore = derivePurchaseOrderQuantities(line);
  const command = {
    idempotencyKey: "price-credit-500",
    amountCents: 50_000,
    reason: "Packaging allowance; goods retained",
  };
  const credited = postPriceOnlyVendorCredit(line, command);
  assert.equal(credited.movements.length, 0);
  assert.equal(credited.impact.onHandDelta, 0);
  assert.deepEqual(derivePurchaseOrderQuantities(credited.state), quantitiesBefore);
  assert.equal(credited.state.priceOnlyCreditCents, 50_000);

  const replay = postPriceOnlyVendorCredit(credited.state, command);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.movements.length, 0);
  assert.equal(replay.state.priceOnlyCreditCents, 50_000);
  assert.equal(replay.state.version, credited.state.version);
  assert.throws(
    () =>
      postPriceOnlyVendorCredit(credited.state, {
        ...command,
        amountCents: 60_000,
      }),
    domainError("IDEMPOTENCY_KEY_REUSED"),
  );
});

test("inventory movements are double-sided, balanced, and cannot post twice", () => {
  const movement = createMovement({
    id: "MOVE-1",
    type: "opening-balance",
    productId: "WIN-BAL",
    quantity: 12,
    source: { id: "ADJUSTMENT", kind: "adjustment" },
    destination: { id: "RACK-A", kind: "internal" },
  });
  assert.deepEqual(movementBalance([movement]), {
    debits: 12,
    credits: 12,
    net: 0,
    netByProduct: { "WIN-BAL": 0 },
    balanced: true,
  });

  const command = { idempotencyKey: "post-move-1", movements: [movement] };
  const posted = postInventoryMovements(createInventoryLedger(), command);
  assert.equal(getLocationBalance(posted.state, "WIN-BAL", "RACK-A"), 12);
  assert.equal(posted.state.movements.length, 1);

  const replay = postInventoryMovements(posted.state, command);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.movements.length, 0);
  assert.equal(replay.state.movements.length, 1);
  assert.equal(getLocationBalance(replay.state, "WIN-BAL", "RACK-A"), 12);
});

test("sales confirmation/reservation do not move stock; shipment does; return is explicit", () => {
  let ledger = createInventoryLedger({
    locations: [
      { id: "MAIN", kind: "internal" },
      { id: "RETURNS", kind: "returns" },
    ],
    openingBalances: [{ productId: "WIN-SALE", locationId: "MAIN", quantity: 6 }],
  });
  let line = createSalesOrderLine({
    id: "SO-1:1",
    productId: "WIN-SALE",
    orderedQuantity: 10,
  });

  const confirmed = confirmSalesOrder(line, { idempotencyKey: "so-confirm" });
  line = confirmed.state;
  assert.equal(confirmed.movements.length, 0);
  assert.equal(deriveSalesOrderQuantities(line).outgoingDemandQuantity, 10);
  assert.equal(getInventoryMetrics(ledger, line.productId).onHandQuantity, 6);

  const reserved = reserveSalesOrderStock(line, {
    idempotencyKey: "so-reserve-6",
    quantity: 6,
    availableNowQuantity: 6,
  });
  line = reserved.state;
  assert.equal(reserved.movements.length, 0);
  assert.equal(line.reservedQuantity, 6);
  assert.equal(getInventoryMetrics(ledger, line.productId).onHandQuantity, 6);

  const shipped = shipSalesOrder(line, {
    idempotencyKey: "so-ship-4",
    quantity: 4,
    usableOnHandQuantity: 6,
    requireReservation: true,
  });
  line = shipped.state;
  ledger = postResult(ledger, shipped, "ledger-ship-4");
  assert.equal(getInventoryMetrics(ledger, line.productId).onHandQuantity, 2);
  assert.equal(deriveSalesOrderQuantities(line).netShippedQuantity, 4);
  assert.equal(line.reservedQuantity, 2);

  assert.throws(
    () =>
      shipSalesOrder(line, {
        idempotencyKey: "so-ship-too-many",
        quantity: 3,
        usableOnHandQuantity: 2,
      }),
    domainError("NEGATIVE_INVENTORY_BLOCKED"),
  );

  const customerReturn = returnFromCustomer(line, {
    idempotencyKey: "so-return-1",
    quantity: 1,
    reason: "Damaged in transit",
    resolution: "replacement",
  });
  line = customerReturn.state;
  ledger = postResult(ledger, customerReturn, "ledger-return-1");
  const metrics = getInventoryMetrics(ledger, line.productId, line.reservedQuantity);
  assert.equal(metrics.onHandQuantity, 3);
  assert.equal(metrics.usableOnHandQuantity, 2);
  assert.equal(deriveSalesOrderQuantities(line).netShippedQuantity, 4);
  assert.equal(deriveSalesOrderQuantities(line).returnedQuantity, 1);
  assert.equal(deriveSalesOrderQuantities(line).authorizedReplacementQuantity, 1);
  assert.equal(deriveSalesOrderQuantities(line).openToShipQuantity, 7);
});

test("the inventory ledger independently blocks negative location stock", () => {
  const ledger = createInventoryLedger({
    locations: [{ id: "MAIN", kind: "internal" }],
    openingBalances: [{ productId: "WIN-NEG", locationId: "MAIN", quantity: 2 }],
  });
  const movement = createMovement({
    id: "SHIP-NEG",
    type: "sales-shipment",
    productId: "WIN-NEG",
    quantity: 3,
    source: { id: "MAIN", kind: "internal" },
    destination: { id: "CUSTOMER", kind: "customer" },
  });
  assert.throws(
    () =>
      postInventoryMovements(ledger, {
        idempotencyKey: "post-negative",
        movements: [movement],
      }),
    domainError("NEGATIVE_INVENTORY_BLOCKED"),
  );
});

test("inventory count approval posts the variance instead of overwriting balance", () => {
  let ledger = createInventoryLedger({
    locations: [{ id: "RACK-C", kind: "internal" }],
    openingBalances: [{ productId: "WIN-COUNT", locationId: "RACK-C", quantity: 10 }],
  });
  let count = createInventoryCount({
    id: "COUNT-1",
    productId: "WIN-COUNT",
    locationId: "RACK-C",
    bookQuantity: 10,
    countedQuantity: 7,
  });
  assert.equal(deriveInventoryCount(count).varianceQuantity, -3);

  const approved = approveInventoryCount(count, {
    idempotencyKey: "approve-count-1",
    reason: "Three damaged units were previously missed",
  });
  count = approved.state;
  assert.equal(count.bookQuantity, 10);
  assert.equal(count.countedQuantity, 7);
  assert.equal(approved.movements.length, 1);
  assert.equal(approved.impact.onHandDelta, -3);

  ledger = postResult(ledger, approved, "ledger-count-1");
  assert.equal(getLocationBalance(ledger, "WIN-COUNT", "RACK-C"), 7);
  assert.equal(ledger.movements.at(-1).type, "inventory-count-adjustment");
});
