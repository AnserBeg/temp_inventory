import {
  DomainError,
  assertAtMost,
  createMovement,
  executeCommand,
  requireQuantity,
  requireText,
} from "./common.js";

export function createPurchaseOrderLine({
  id,
  productId,
  orderedQuantity,
  warehouseLocationId = "MAIN",
}) {
  return {
    kind: "purchase-order-line",
    id: requireText(id, "id"),
    productId: requireText(productId, "productId"),
    warehouseLocationId: requireText(warehouseLocationId, "warehouseLocationId"),
    lifecycle: "draft",
    effectiveOrderedQuantity: requireQuantity(
      orderedQuantity,
      "orderedQuantity",
    ),
    grossReceivedQuantity: 0,
    receiptReversedQuantity: 0,
    vendorReturnedQuantity: 0,
    notExpectedQuantity: 0,
    billedQuantity: 0,
    creditedQuantity: 0,
    priceOnlyCreditCents: 0,
    revision: 0,
    expectedDate: null,
    version: 0,
    commandLog: {},
  };
}

export function derivePurchaseOrderQuantities(line) {
  const netRetainedQuantity =
    line.grossReceivedQuantity -
    line.receiptReversedQuantity -
    line.vendorReturnedQuantity;
  const openToReceiveQuantity = Math.max(
    line.effectiveOrderedQuantity -
      netRetainedQuantity -
      line.notExpectedQuantity,
    0,
  );
  const overReceivedQuantity = Math.max(
    netRetainedQuantity - line.effectiveOrderedQuantity,
    0,
  );

  let fulfillmentStatus = "not_received";
  if (line.lifecycle === "canceled") fulfillmentStatus = "canceled";
  else if (overReceivedQuantity > 0) fulfillmentStatus = "over_received";
  else if (openToReceiveQuantity === 0 && line.notExpectedQuantity > 0) {
    fulfillmentStatus = "closed_short";
  } else if (netRetainedQuantity >= line.effectiveOrderedQuantity) {
    fulfillmentStatus = "fully_received";
  } else if (netRetainedQuantity > 0) fulfillmentStatus = "partially_received";

  return {
    effectiveOrderedQuantity: line.effectiveOrderedQuantity,
    grossReceivedQuantity: line.grossReceivedQuantity,
    receiptReversedQuantity: line.receiptReversedQuantity,
    vendorReturnedQuantity: line.vendorReturnedQuantity,
    netRetainedQuantity,
    notExpectedQuantity: line.notExpectedQuantity,
    openToReceiveQuantity,
    incomingQuantity: line.lifecycle === "approved" ? openToReceiveQuantity : 0,
    overReceivedQuantity,
    billedQuantity: line.billedQuantity,
    creditedQuantity: line.creditedQuantity,
    fulfillmentStatus,
  };
}

function requireApproved(line) {
  if (line.lifecycle !== "approved") {
    throw new DomainError(
      "PURCHASE_ORDER_NOT_APPROVED",
      "The purchase order must be approved before quantities can be processed.",
      { lifecycle: line.lifecycle },
    );
  }
}

export function approvePurchaseOrder(line, command) {
  return executeCommand(line, "approve-purchase-order", command, () => {
    if (line.lifecycle !== "draft") {
      throw new DomainError(
        "INVALID_PURCHASE_ORDER_STATE",
        "Only a draft purchase order can be approved.",
        { lifecycle: line.lifecycle },
      );
    }
    return {
      state: { ...line, lifecycle: "approved", revision: line.revision + 1 },
      movements: [],
      impact: {
        onHandDelta: 0,
        incomingDelta: line.effectiveOrderedQuantity,
        message: "Approval creates incoming supply but does not change on-hand inventory.",
      },
    };
  });
}

export function receivePurchaseOrder(line, command) {
  return executeCommand(line, "post-receipt", command, () => {
    requireApproved(line);
    const quantity = requireQuantity(command.quantity);
    const before = derivePurchaseOrderQuantities(line);
    if (!command.allowOverReceipt) {
      assertAtMost(
        quantity,
        before.openToReceiveQuantity,
        "OVER_RECEIPT_BLOCKED",
        "Receipt quantity exceeds the quantity open to receive.",
      );
    }
    const state = {
      ...line,
      grossReceivedQuantity: line.grossReceivedQuantity + quantity,
    };
    const after = derivePurchaseOrderQuantities(state);
    const destinationId = command.destinationLocationId ?? line.warehouseLocationId;
    const movement = createMovement({
      id: command.movementId ?? `receipt:${command.idempotencyKey}`,
      type: "purchase-receipt",
      productId: line.productId,
      quantity,
      source: { id: command.supplierLocationId ?? "SUPPLIER", kind: "supplier" },
      destination: { id: destinationId, kind: command.destinationKind ?? "internal" },
      reference: { type: "purchase-order-line", id: line.id },
    });
    return {
      state,
      movements: [movement],
      impact: {
        onHandDelta: quantity,
        incomingDelta: after.incomingQuantity - before.incomingQuantity,
        openToReceiveBefore: before.openToReceiveQuantity,
        openToReceiveAfter: after.openToReceiveQuantity,
      },
    };
  });
}

export function closePurchaseOrderRemainder(line, command) {
  return executeCommand(line, "close-purchase-order-remainder", command, () => {
    requireApproved(line);
    requireText(command.reason, "reason");
    const before = derivePurchaseOrderQuantities(line);
    const quantity = command.quantity ?? before.openToReceiveQuantity;
    requireQuantity(quantity);
    assertAtMost(
      quantity,
      before.openToReceiveQuantity,
      "CLOSE_QUANTITY_EXCEEDS_OPEN",
      "Cannot close more than the quantity open to receive.",
    );
    const state = {
      ...line,
      notExpectedQuantity: line.notExpectedQuantity + quantity,
      revision: line.revision + 1,
    };
    const after = derivePurchaseOrderQuantities(state);
    return {
      state,
      movements: [],
      impact: {
        onHandDelta: 0,
        incomingDelta: after.incomingQuantity - before.incomingQuantity,
        closedQuantity: quantity,
        message: "Closing stops expected supply and does not change on-hand inventory.",
      },
    };
  });
}

export function reopenPurchaseOrderQuantity(line, command) {
  return executeCommand(line, "reopen-purchase-order-quantity", command, () => {
    requireApproved(line);
    const quantity = requireQuantity(command.quantity);
    requireText(command.reason, "reason");
    const expectedDate = requireText(command.expectedDate, "expectedDate");
    assertAtMost(
      quantity,
      line.notExpectedQuantity,
      "REOPEN_QUANTITY_EXCEEDS_CLOSED",
      "Cannot reopen more than the quantity closed without receipt.",
    );
    const before = derivePurchaseOrderQuantities(line);
    const state = {
      ...line,
      notExpectedQuantity: line.notExpectedQuantity - quantity,
      revision: line.revision + 1,
      expectedDate,
    };
    const after = derivePurchaseOrderQuantities(state);
    return {
      state,
      movements: [],
      impact: {
        onHandDelta: 0,
        incomingDelta: after.incomingQuantity - before.incomingQuantity,
        reopenedQuantity: quantity,
        message: "Reopening restores incoming supply and does not change on-hand inventory.",
      },
    };
  });
}

export function reversePurchaseOrderReceipt(line, command) {
  return executeCommand(line, "reverse-purchase-receipt", command, () => {
    requireApproved(line);
    const quantity = requireQuantity(command.quantity);
    requireText(command.reason, "reason");
    const before = derivePurchaseOrderQuantities(line);
    assertAtMost(
      quantity,
      before.netRetainedQuantity,
      "RECEIPT_REVERSAL_EXCEEDS_RETAINED",
      "Cannot reverse more than the net quantity retained.",
    );

    let state = {
      ...line,
      receiptReversedQuantity: line.receiptReversedQuantity + quantity,
    };
    let after = derivePurchaseOrderQuantities(state);
    if (command.remainingExpected === false) {
      const newlyOpen = after.openToReceiveQuantity - before.openToReceiveQuantity;
      state = {
        ...state,
        notExpectedQuantity: state.notExpectedQuantity + Math.max(newlyOpen, 0),
      };
      after = derivePurchaseOrderQuantities(state);
    }

    const movement = createMovement({
      id: command.movementId ?? `receipt-reversal:${command.idempotencyKey}`,
      type: "purchase-receipt-reversal",
      productId: line.productId,
      quantity,
      source: {
        id: command.sourceLocationId ?? line.warehouseLocationId,
        kind: command.sourceKind ?? "internal",
      },
      destination: {
        id: command.adjustmentLocationId ?? "RECEIPT-CORRECTION",
        kind: "adjustment",
      },
      reference: { type: "purchase-order-line", id: line.id },
    });
    return {
      state,
      movements: [movement],
      impact: {
        onHandDelta: -quantity,
        incomingDelta: after.incomingQuantity - before.incomingQuantity,
        openToReceiveAfter: after.openToReceiveQuantity,
      },
    };
  });
}

export function returnToVendor(line, command) {
  return executeCommand(line, "return-to-vendor", command, () => {
    requireApproved(line);
    const quantity = requireQuantity(command.quantity);
    requireText(command.reason, "reason");
    if (!new Set(["replacement", "refund"]).has(command.disposition)) {
      throw new DomainError(
        "INVALID_RETURN_DISPOSITION",
        "Vendor return disposition must be replacement or refund.",
      );
    }
    const before = derivePurchaseOrderQuantities(line);
    assertAtMost(
      quantity,
      before.netRetainedQuantity,
      "VENDOR_RETURN_EXCEEDS_RETAINED",
      "Cannot return more than the net quantity retained.",
    );
    let state = {
      ...line,
      vendorReturnedQuantity: line.vendorReturnedQuantity + quantity,
    };
    let after = derivePurchaseOrderQuantities(state);
    if (command.disposition === "refund") {
      const newlyOpen = after.openToReceiveQuantity - before.openToReceiveQuantity;
      state = {
        ...state,
        notExpectedQuantity: state.notExpectedQuantity + Math.max(newlyOpen, 0),
      };
      after = derivePurchaseOrderQuantities(state);
    }
    const movement = createMovement({
      id: command.movementId ?? `vendor-return:${command.idempotencyKey}`,
      type: "vendor-return",
      productId: line.productId,
      quantity,
      source: {
        id: command.sourceLocationId ?? line.warehouseLocationId,
        kind: command.sourceKind ?? "internal",
      },
      destination: { id: command.supplierLocationId ?? "SUPPLIER", kind: "supplier" },
      reference: { type: "purchase-order-line", id: line.id },
    });
    return {
      state,
      movements: [movement],
      impact: {
        onHandDelta: -quantity,
        incomingDelta: after.incomingQuantity - before.incomingQuantity,
        creditExpected: true,
        replacementExpected: command.disposition === "replacement",
      },
    };
  });
}

export function postPriceOnlyVendorCredit(line, command) {
  return executeCommand(line, "post-price-only-vendor-credit", command, () => {
    requireApproved(line);
    const amountCents = requireQuantity(command.amountCents, "amountCents");
    requireText(command.reason, "reason");
    return {
      state: {
        ...line,
        priceOnlyCreditCents: line.priceOnlyCreditCents + amountCents,
      },
      movements: [],
      impact: {
        onHandDelta: 0,
        incomingDelta: 0,
        financialCreditCents: amountCents,
        message: "The credit changes financial value only; goods remain in stock.",
      },
    };
  });
}

