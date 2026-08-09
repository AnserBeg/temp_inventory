import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateLandedCost,
  amendApprovedRecord,
  calculateDocumentTotals,
  createApprovalRecord,
  createReturnableLedger,
  createValuationLedger,
  decideApproval,
  evaluateThreeWayMatch,
  issueValuation,
  postReturnableEvent,
  receiveValuation,
  submitForApproval,
} from "../lib/domain/index.js";

function domainError(code) {
  return (error) => error?.code === code;
}

function command(idempotencyKey, extra = {}) {
  return { idempotencyKey, ...extra };
}

test("document totals keep item, charge, deposit, tax, and physical effects separate", () => {
  const result = calculateDocumentTotals({
    taxRateBps: 500,
    lines: [
      {
        id: "WINDOW",
        quantity: 2,
        unitAmountCents: 10_000,
        discountCents: 1_000,
      },
      {
        id: "SCREEN",
        quantity: 1,
        unitAmountCents: 5_000,
        taxable: false,
      },
    ],
    charges: [
      { kind: "freight", amountCents: 2_000, taxable: true },
      { kind: "core_charge", amountCents: 5_000 },
      { kind: "discount", amountCents: 1_000, taxable: true },
    ],
  });

  assert.deepEqual(
    {
      itemSubtotalCents: result.itemSubtotalCents,
      chargeTotalCents: result.chargeTotalCents,
      refundableDepositCents: result.refundableDepositCents,
      taxableSubtotalCents: result.taxableSubtotalCents,
      taxCents: result.taxCents,
      subtotalCents: result.subtotalCents,
      totalCents: result.totalCents,
      physicalInventoryDelta: result.physicalInventoryDelta,
    },
    {
      itemSubtotalCents: 24_000,
      chargeTotalCents: 6_000,
      refundableDepositCents: 5_000,
      taxableSubtotalCents: 20_000,
      taxCents: 1_000,
      subtotalCents: 30_000,
      totalCents: 31_000,
      physicalInventoryDelta: 0,
    },
  );
  assert.deepEqual(result.chargeTotalsByKind, {
    freight: 2_000,
    core_charge: 5_000,
    discount: -1_000,
  });
  assert.equal(result.lines[0].grossCents, 20_000);
  assert.equal(result.lines[0].netCents, 19_000);
  assert.equal(result.charges[1].refundable, true);
  assert.equal(Object.isFrozen(result), true);

  assert.throws(
    () =>
      calculateDocumentTotals({
        lines: [{ quantity: 1, unitAmountCents: 500, discountCents: 501 }],
      }),
    domainError("INVALID_DISCOUNT"),
  );
});
test("three-way match accepts supported tolerances without moving inventory", () => {
  const result = evaluateThreeWayMatch({
    purchaseLines: [{ id: "PO-L1", quantity: 10, unitCostCents: 1_000 }],
    receiptLines: [{ purchaseOrderLineId: "PO-L1", quantity: 10 }],
    billLines: [
      { purchaseOrderLineId: "PO-L1", quantity: 10, unitCostCents: 1_000 },
    ],
    billCharges: [{ kind: "freight", amountCents: 500 }],
    tolerances: {
      allowedChargeKinds: ["freight"],
      totalCents: 500,
    },
  });

  assert.deepEqual(result, {
    status: "matched",
    payable: true,
    authorizedCents: 10_000,
    receivedValueCents: 10_000,
    billedCents: 10_500,
    varianceCents: 500,
    exceptions: [],
    physicalInventoryDelta: 0,
  });
});

test("three-way match reports quantity, return, price, and unexpected-charge exceptions", () => {
  const result = evaluateThreeWayMatch({
    purchaseLines: [{ id: "PO-L1", quantity: 10, unitCostCents: 1_000 }],
    receiptLines: [{ purchaseOrderLineId: "PO-L1", quantity: 10 }],
    returnLines: [{ purchaseOrderLineId: "PO-L1", quantity: 2 }],
    billLines: [
      { purchaseOrderLineId: "PO-L1", quantity: 10, unitCostCents: 1_100 },
    ],
    billCharges: [{ kind: "fuel_surcharge", amountCents: 500 }],
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.payable, false);
  assert.equal(result.authorizedCents, 10_000);
  assert.equal(result.receivedValueCents, 8_000);
  assert.equal(result.billedCents, 11_500);
  assert.equal(result.varianceCents, 1_500);
  assert.deepEqual(
    result.exceptions.map(({ code, severity }) => ({ code, severity })),
    [
      { code: "BILLED_ABOVE_RECEIVED", severity: "blocking" },
      { code: "UNIT_PRICE_VARIANCE", severity: "approval" },
      { code: "UNEXPECTED_CHARGE", severity: "approval" },
    ],
  );
  assert.equal(result.physicalInventoryDelta, 0);

  const unlinked = evaluateThreeWayMatch({
    billLines: [
      { purchaseOrderLineId: "MISSING", quantity: 1, unitCostCents: 500 },
    ],
  });
  assert.equal(unlinked.status, "blocked");
  assert.equal(unlinked.exceptions[0].code, "NO_PURCHASE_ORDER_LINE");
});

test("core and empty events maintain separate obligations and deposit balances", () => {
  let ledger = createReturnableLedger();
  const events = [
    command("core-issue", {
      type: "issue_to_partner",
      partnerId: "CUSTOMER-1",
      assetType: "core",
      quantity: 5,
      unitDepositCents: 2_000,
      actor: "Morgan",
      reason: "Five replacement assemblies supplied",
    }),
    command("core-return", {
      type: "return_from_partner",
      partnerId: "CUSTOMER-1",
      assetType: "core",
      quantity: 2,
      unitDepositCents: 2_000,
      actor: "Morgan",
      reason: "Two original assemblies returned",
    }),
    command("core-forfeit", {
      type: "forfeit_by_partner",
      partnerId: "CUSTOMER-1",
      assetType: "core",
      quantity: 1,
      unitDepositCents: 2_000,
      actor: "Avery",
      reason: "Customer confirmed one core was lost",
    }),
    command("empty-receive", {
      type: "receive_from_partner",
      partnerId: "VENDOR-1",
      assetType: "empty_crate",
      quantity: 4,
      unitDepositCents: 1_500,
      actor: "Morgan",
      reason: "Returnable crates arrived with shipment",
    }),
    command("empty-return", {
      type: "return_to_partner",
      partnerId: "VENDOR-1",
      assetType: "empty_crate",
      quantity: 1,
      unitDepositCents: 1_500,
      actor: "Morgan",
      reason: "One empty crate returned on vendor truck",
    }),
    command("empty-forfeit", {
      type: "forfeit_by_company",
      partnerId: "VENDOR-1",
      assetType: "empty_crate",
      quantity: 2,
      unitDepositCents: 1_500,
      actor: "Avery",
      reason: "Two damaged crates cannot be returned",
    }),
  ];

  for (const event of events) {
    const result = postReturnableEvent(ledger, event);
    assert.equal(result.movements.length, 0);
    assert.equal(result.impact.onHandDelta, 0);
    assert.equal(result.impact.sellableInventoryDelta, 0);
    ledger = result.state;
  }

  assert.deepEqual(ledger.balances["CUSTOMER-1:core"], {
    partnerId: "CUSTOMER-1",
    assetType: "core",
    heldByPartner: 2,
    heldByCompany: 0,
    customerDepositLiabilityCents: 4_000,
    vendorDepositReceivableCents: 0,
    forfeitedRevenueCents: 2_000,
    forfeitedExpenseCents: 0,
  });
  assert.deepEqual(ledger.balances["VENDOR-1:empty_crate"], {
    partnerId: "VENDOR-1",
    assetType: "empty_crate",
    heldByPartner: 0,
    heldByCompany: 1,
    customerDepositLiabilityCents: 0,
    vendorDepositReceivableCents: 1_500,
    forfeitedRevenueCents: 0,
    forfeitedExpenseCents: 3_000,
  });
  assert.equal(ledger.events.length, 6);
  assert.equal(ledger.auditTrail.length, 6);
  assert.equal(ledger.version, 6);

  const replay = postReturnableEvent(ledger, events[0]);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.state.events.length, 6);
  assert.equal(replay.movements.length, 0);
  assert.throws(
    () =>
      postReturnableEvent(ledger, command("core-over-return", {
        ...events[1],
        idempotencyKey: "core-over-return",
        quantity: 3,
      })),
    domainError("RETURN_EXCEEDS_OUTSTANDING"),
  );
});

test("approval decisions and amendments preserve a revision audit trail", () => {
  let record = createApprovalRecord({
    entityId: "PO-2034",
    entityType: "purchase_order",
    totalCents: 100_000,
  });
  assert.equal(record.status, "draft");

  const submitted = submitForApproval(record, command("approval-submit-1", {
    actor: "Buyer Taylor",
    reason: "Initial vendor commitment",
  }));
  record = submitted.state;
  assert.equal(record.status, "pending_approval");
  assert.equal(record.auditTrail[0].action, "submitted_for_approval");
  assert.equal(submitted.impact.onHandDelta, 0);

  const approved = decideApproval(record, command("approval-decide-1", {
    decision: "approved",
    actor: "Manager Casey",
    reason: "Within project budget",
  }));
  record = approved.state;
  assert.equal(record.status, "approved");
  assert.equal(record.decisionBy, "Manager Casey");
  assert.equal(record.auditTrail[1].action, "approved");

  const amended = amendApprovedRecord(record, command("approval-amend-2", {
    actor: "Buyer Taylor",
    reason: "Vendor-confirmed freight increase",
    totalCents: 110_000,
    changes: [
      { field: "freightCents", before: 0, after: 10_000 },
    ],
  }));
  record = amended.state;
  assert.equal(record.revision, 2);
  assert.equal(record.totalCents, 110_000);
  assert.equal(record.status, "pending_approval");
  assert.equal(record.decisionBy, null);
  assert.equal(record.decisionReason, null);
  assert.equal(record.auditTrail[2].action, "amended");
  assert.deepEqual(record.auditTrail[2].metadata.changes, [
    { field: "freightCents", before: 0, after: 10_000 },
  ]);
  assert.equal(Object.isFrozen(record.auditTrail[2]), true);
  assert.equal(amended.impact.revisionDelta, 1);
  assert.equal(amended.movements.length, 0);

  const revisionApproved = decideApproval(record, command("approval-decide-2", {
    decision: "approved",
    actor: "Manager Casey",
    reason: "Freight evidence reviewed",
  }));
  assert.equal(revisionApproved.state.status, "approved");
  assert.equal(revisionApproved.state.revision, 2);
  assert.equal(revisionApproved.state.auditTrail.length, 4);

  assert.throws(
    () =>
      amendApprovedRecord(revisionApproved.state, command("empty-amendment", {
        actor: "Buyer Taylor",
        reason: "No actual difference",
        changes: [],
      })),
    domainError("CHANGES_REQUIRED"),
  );
});

test("FIFO valuation consumes the oldest cost layers", () => {
  let ledger = createValuationLedger({ method: "fifo" });
  ledger = receiveValuation(ledger, command("fifo-receive-a", {
    quantity: 10,
    unitCostCents: 1_000,
    actor: "Receiver Morgan",
    reference: "RCPT-1",
    layerId: "LAYER-A",
  })).state;
  ledger = receiveValuation(ledger, command("fifo-receive-b", {
    quantity: 5,
    unitCostCents: 1_400,
    actor: "Receiver Morgan",
    reference: "RCPT-2",
    layerId: "LAYER-B",
  })).state;

  const issued = issueValuation(ledger, command("fifo-issue", {
    quantity: 12,
    actor: "Shipper Riley",
    reference: "SHIP-1",
  }));
  assert.deepEqual(
    {
      quantityOnHand: issued.state.quantityOnHand,
      inventoryValueCents: issued.state.inventoryValueCents,
      cogsCents: issued.state.cogsCents,
      remainingLayers: issued.state.layers.map((layer) => layer.remainingQuantity),
    },
    {
      quantityOnHand: 3,
      inventoryValueCents: 4_200,
      cogsCents: 12_800,
      remainingLayers: [0, 3],
    },
  );
  assert.equal(issued.impact.cogsDeltaCents, 12_800);
  assert.equal(issued.impact.onHandDelta, 0);
});

test("moving-average valuation issues at the current weighted average", () => {
  let ledger = createValuationLedger({ method: "average" });
  ledger = receiveValuation(ledger, command("avg-receive-a", {
    quantity: 10,
    unitCostCents: 1_000,
    actor: "Receiver Morgan",
    reference: "RCPT-3",
    layerId: "AVG-A",
  })).state;
  ledger = receiveValuation(ledger, command("avg-receive-b", {
    quantity: 10,
    unitCostCents: 2_000,
    actor: "Receiver Morgan",
    reference: "RCPT-4",
    layerId: "AVG-B",
  })).state;

  const issued = issueValuation(ledger, command("avg-issue", {
    quantity: 4,
    actor: "Shipper Riley",
    reference: "SHIP-2",
  }));
  assert.deepEqual(
    {
      quantityOnHand: issued.state.quantityOnHand,
      inventoryValueCents: issued.state.inventoryValueCents,
      cogsCents: issued.state.cogsCents,
    },
    { quantityOnHand: 16, inventoryValueCents: 24_000, cogsCents: 6_000 },
  );
  assert.equal(issued.impact.cogsDeltaCents, 6_000);
});

test("standard valuation uses standard cost while retaining actual receipt cost", () => {
  let ledger = createValuationLedger({
    method: "standard",
    standardCostCents: 1_200,
  });
  const received = receiveValuation(ledger, command("std-receive", {
    quantity: 10,
    unitCostCents: 1_000,
    actor: "Receiver Morgan",
    reference: "RCPT-5",
    layerId: "STD-A",
  }));
  ledger = received.state;
  assert.equal(ledger.inventoryValueCents, 12_000);
  assert.equal(ledger.layers[0].unitCostCents, 1_200);
  assert.equal(ledger.layers[0].actualUnitCostCents, 1_000);

  const issued = issueValuation(ledger, command("std-issue", {
    quantity: 4,
    actor: "Shipper Riley",
    reference: "SHIP-3",
  }));
  assert.deepEqual(
    {
      quantityOnHand: issued.state.quantityOnHand,
      inventoryValueCents: issued.state.inventoryValueCents,
      cogsCents: issued.state.cogsCents,
    },
    { quantityOnHand: 6, inventoryValueCents: 7_200, cogsCents: 4_800 },
  );
  assert.throws(
    () =>
      issueValuation(issued.state, command("std-over-issue", {
        quantity: 7,
        actor: "Shipper Riley",
        reference: "SHIP-4",
      })),
    domainError("NEGATIVE_INVENTORY_BLOCKED"),
  );
});

test("landed costs allocate deterministically across every supported basis", () => {
  const lines = [
    {
      id: "LINE-A",
      quantity: 10,
      unitCostCents: 1_000,
      weight: 20,
      volume: 5,
    },
    {
      id: "LINE-B",
      quantity: 5,
      unitCostCents: 2_000,
      weight: 10,
      volume: 10,
    },
  ];
  const amounts = (basis, total = 300) =>
    allocateLandedCost(lines, total, basis).map((item) => item.amountCents);

  assert.deepEqual(amounts("quantity"), [200, 100]);
  assert.deepEqual(amounts("weight"), [200, 100]);
  assert.deepEqual(amounts("volume"), [100, 200]);
  assert.deepEqual(amounts("purchase_value"), [150, 150]);
  assert.deepEqual(amounts("equal", 301), [151, 150]);

  for (const basis of ["quantity", "weight", "volume", "purchase_value", "equal"]) {
    const allocation = allocateLandedCost(lines, 301, basis);
    assert.equal(
      allocation.reduce((total, item) => total + item.amountCents, 0),
      301,
    );
    assert.equal(allocation.every((item) => item.physicalInventoryDelta === 0), true);
    assert.equal(allocation.every((item) => item.basis === basis), true);
  }

  assert.throws(
    () => allocateLandedCost([], 100, "equal"),
    domainError("LINES_REQUIRED"),
  );
});
