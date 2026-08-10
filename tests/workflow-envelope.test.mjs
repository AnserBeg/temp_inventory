import assert from "node:assert/strict";
import test from "node:test";

import { inventoryCountApprovalPayload, workflowCommandEnvelope, workflowCommandForAction, workflowSnapshotParts } from "../lib/domain/workflow-envelope.js";

const core = {
  purchaseOrders: [{ id: "po-1", number: "PO-1", lines: [{ id: "line-1" }] }],
  products: [{ id: "product-1", sku: "WIN-1" }],
};
const advanced = {
  approvals: [{ id: "approval-1", requestType: "inventory_count_variance", status: "pending", version: 1 }],
  permissions: { canApprove: true, actions: { approveApproval: true } },
};

test("normalizes the actual GET /api/workflows envelope", () => {
  assert.deepEqual(workflowSnapshotParts({ snapshot: core, advanced }), { advanced, core });
});

test("normalizes the actual POST /api/workflows envelope", () => {
  const response = { message: "Approval requested", recordId: "approval-1", snapshot: { snapshot: core, advanced } };
  assert.deepEqual(workflowSnapshotParts(response), { advanced, core });
});

test("retains compatibility with a direct state response", () => {
  assert.deepEqual(workflowSnapshotParts({ state: advanced, snapshot: core }), { advanced, core });
  assert.deepEqual(workflowSnapshotParts(null), { advanced: undefined, core: undefined });
});

test("builds the exact scope-locked inventory count approval contract", () => {
  assert.deepEqual(inventoryCountApprovalPayload({
    productId: "product-1",
    locationId: "loc-a01",
    recordedQuantity: 20,
    countedQuantity: 13,
    reason: "Unrecorded damage",
  }), {
    entityType: "product",
    requestType: "inventory_count_variance",
    reason: "Unrecorded damage",
    metadata: {
      productId: "product-1",
      locationId: "loc-a01",
      recordedQuantity: 20,
      countedQuantity: 13,
      absoluteVariance: 7,
    },
  });
});

test("routes each match-exception decision to the intended durable command", () => {
  assert.equal(workflowCommandForAction("resolveMatchException", "approve-variance"), "approveVendorBill");
  assert.equal(workflowCommandForAction("resolveMatchException", "request-credit"), "createVendorCredit");
  assert.equal(workflowCommandForAction("recordVendorPayment"), "recordPayment");
});

test("financial workflow envelopes use the selected source document and its current version", () => {
  const options = {
    purchaseOrders: [{ id: "po-1", version: 7 }],
    salesOrders: [{ id: "so-1", version: 4 }],
    customerInvoices: [{ id: "invoice-1", version: 3 }],
    salesOrderLines: [{ id: "so-line-drop", version: 4 }],
  };
  assert.deepEqual(workflowCommandEnvelope({ command: "createVendorBill", kind: "createVendorBill", payload: { purchaseOrderId: "po-1", lines: [] }, options, idempotencyKey: "bill-1" }), {
    command: "createVendorBill", entityId: "po-1", version: 7, payload: { purchaseOrderId: "po-1", lines: [] }, idempotencyKey: "bill-1",
  });
  assert.deepEqual(workflowCommandEnvelope({ command: "createCustomerInvoice", kind: "createCustomerInvoice", payload: { salesOrderId: "so-1" }, options, idempotencyKey: "invoice-1" }), {
    command: "createCustomerInvoice", entityId: "so-1", version: 4, payload: { salesOrderId: "so-1" }, idempotencyKey: "invoice-1",
  });
  assert.deepEqual(workflowCommandEnvelope({ command: "recordPayment", kind: "recordCustomerPayment", payload: { documentId: "invoice-1", amountCents: 100 }, options, idempotencyKey: "payment-1" }), {
    command: "recordPayment", entityId: "invoice-1", version: 3, payload: { documentId: "invoice-1", amountCents: 100 }, idempotencyKey: "payment-1",
  });
  assert.deepEqual(workflowCommandEnvelope({ command: "postDropShipDelivery", kind: "postDropShipDelivery", payload: { salesOrderLineId: "so-line-drop", quantity: 2 }, options, idempotencyKey: "drop-1" }), {
    command: "postDropShipDelivery", entityId: "so-line-drop", version: 4, payload: { salesOrderLineId: "so-line-drop", quantity: 2 }, idempotencyKey: "drop-1",
  });
  assert.throws(() => workflowCommandEnvelope({ command: "createVendorBill", kind: "createVendorBill", payload: { purchaseOrderId: "stale-po" }, options, idempotencyKey: "stale" }), /Refresh the source document/);
});

test("server-searched sources can carry their current version outside snapshot page one", () => {
  const envelope = workflowCommandEnvelope({
    command: "createVendorBill",
    kind: "createVendorBill",
    payload: { purchaseOrderId: "po-beyond-page-one", sourceVersion: 17 },
    options: { purchaseOrders: [] },
    idempotencyKey: "remote-source",
  });
  assert.equal(envelope.entityId, "po-beyond-page-one");
  assert.equal(envelope.version, 17);
});

test("shipment reversal targets the displayed shipment line instead of an arbitrary line", () => {
  const payload = { shipmentId: "shipment-1", lineId: "shipment-line-2", quantity: 3, postingDate: "2026-08-10", reason: "Wrong quantity" };
  assert.deepEqual(workflowCommandEnvelope({
    command: "reverseShipment",
    kind: "reverseShipment",
    record: { id: "shipment-1:shipment-line-2", version: 6 },
    payload,
    options: {},
    idempotencyKey: "reverse-shipment-line-2",
  }), {
    command: "reverseShipment",
    entityId: "shipment-1",
    version: 6,
    payload,
    idempotencyKey: "reverse-shipment-line-2",
  });
});
