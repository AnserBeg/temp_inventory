import {
  DomainError,
  assertAtMost,
  createMovement,
  executeCommand,
  requireQuantity,
  requireText,
} from "./common.js";

export function createSalesOrderLine({
  id,
  productId,
  orderedQuantity,
  warehouseLocationId = "MAIN",
}) {
  return {
    kind: "sales-order-line",
    id: requireText(id, "id"),
    productId: requireText(productId, "productId"),
    warehouseLocationId: requireText(warehouseLocationId, "warehouseLocationId"),
    lifecycle: "draft",
    orderedQuantity: requireQuantity(orderedQuantity, "orderedQuantity"),
    grossShippedQuantity: 0,
    shipmentReversedQuantity: 0,
    canceledRemainderQuantity: 0,
    authorizedReplacementQuantity: 0,
    returnedQuantity: 0,
    reservedQuantity: 0,
    version: 0,
    commandLog: {},
  };
}

export function deriveSalesOrderQuantities(line) {
  const netShippedQuantity =
    line.grossShippedQuantity - line.shipmentReversedQuantity;
  const openToShipQuantity = Math.max(
    line.orderedQuantity +
      line.authorizedReplacementQuantity -
      netShippedQuantity -
      line.canceledRemainderQuantity,
    0,
  );
  return {
    orderedQuantity: line.orderedQuantity,
    grossShippedQuantity: line.grossShippedQuantity,
    shipmentReversedQuantity: line.shipmentReversedQuantity,
    netShippedQuantity,
    canceledRemainderQuantity: line.canceledRemainderQuantity,
    authorizedReplacementQuantity: line.authorizedReplacementQuantity,
    returnedQuantity: line.returnedQuantity,
    reservedQuantity: line.reservedQuantity,
    openToShipQuantity,
    outgoingDemandQuantity: line.lifecycle === "confirmed" ? openToShipQuantity : 0,
  };
}

function requireConfirmed(line) {
  if (line.lifecycle !== "confirmed") {
    throw new DomainError(
      "SALES_ORDER_NOT_CONFIRMED",
      "The sales order must be confirmed before fulfillment.",
      { lifecycle: line.lifecycle },
    );
  }
}

export function confirmSalesOrder(line, command) {
  return executeCommand(line, "confirm-sales-order", command, () => {
    if (line.lifecycle !== "draft") {
      throw new DomainError(
        "INVALID_SALES_ORDER_STATE",
        "Only a draft sales order can be confirmed.",
      );
    }
    return {
      state: { ...line, lifecycle: "confirmed" },
      movements: [],
      impact: {
        onHandDelta: 0,
        outgoingDemandDelta: line.orderedQuantity,
        message: "Confirmation creates demand but does not move inventory.",
      },
    };
  });
}

export function reserveSalesOrderStock(line, command) {
  return executeCommand(line, "reserve-sales-order-stock", command, () => {
    requireConfirmed(line);
    const quantity = requireQuantity(command.quantity);
    const availableNowQuantity = requireQuantity(
      command.availableNowQuantity,
      "availableNowQuantity",
      { allowZero: true },
    );
    const quantities = deriveSalesOrderQuantities(line);
    const unreservedDemand = Math.max(
      quantities.openToShipQuantity - line.reservedQuantity,
      0,
    );
    assertAtMost(
      quantity,
      availableNowQuantity,
      "INSUFFICIENT_AVAILABLE_INVENTORY",
      "Reservation exceeds inventory available now.",
    );
    assertAtMost(
      quantity,
      unreservedDemand,
      "RESERVATION_EXCEEDS_OPEN_DEMAND",
      "Reservation exceeds unreserved open demand.",
    );
    return {
      state: { ...line, reservedQuantity: line.reservedQuantity + quantity },
      movements: [],
      impact: {
        onHandDelta: 0,
        reservedDelta: quantity,
        availableNowDelta: -quantity,
      },
    };
  });
}

export function releaseSalesOrderReservation(line, command) {
  return executeCommand(line, "release-sales-order-reservation", command, () => {
    requireConfirmed(line);
    const quantity = requireQuantity(command.quantity);
    requireText(command.reason, "reason");
    assertAtMost(
      quantity,
      line.reservedQuantity,
      "RELEASE_EXCEEDS_RESERVATION",
      "Cannot release more than the active reservation.",
    );
    return {
      state: { ...line, reservedQuantity: line.reservedQuantity - quantity },
      movements: [],
      impact: { onHandDelta: 0, reservedDelta: -quantity, availableNowDelta: quantity },
    };
  });
}

export function shipSalesOrder(line, command) {
  return executeCommand(line, "post-sales-shipment", command, () => {
    requireConfirmed(line);
    const quantity = requireQuantity(command.quantity);
    const usableOnHandQuantity = requireQuantity(
      command.usableOnHandQuantity,
      "usableOnHandQuantity",
      { allowZero: true },
    );
    const before = deriveSalesOrderQuantities(line);
    assertAtMost(
      quantity,
      before.openToShipQuantity,
      "SHIPMENT_EXCEEDS_OPEN_DEMAND",
      "Shipment exceeds the quantity open to ship.",
    );
    if (quantity > usableOnHandQuantity && !command.allowNegative) {
      throw new DomainError(
        "NEGATIVE_INVENTORY_BLOCKED",
        "Shipment would reduce usable inventory below zero.",
        { usableOnHandQuantity, requestedQuantity: quantity },
      );
    }
    if (command.allowNegative && !command.negativeOverrideReason) {
      throw new DomainError(
        "NEGATIVE_OVERRIDE_REASON_REQUIRED",
        "A reason is required to override negative inventory.",
      );
    }
    if (command.requireReservation) {
      assertAtMost(
        quantity,
        line.reservedQuantity,
        "SHIPMENT_EXCEEDS_RESERVATION",
        "Shipment exceeds the reserved quantity.",
      );
    }
    const releasedReservation = Math.min(quantity, line.reservedQuantity);
    const state = {
      ...line,
      grossShippedQuantity: line.grossShippedQuantity + quantity,
      reservedQuantity: line.reservedQuantity - releasedReservation,
    };
    const after = deriveSalesOrderQuantities(state);
    const movement = createMovement({
      id: command.movementId ?? `shipment:${command.idempotencyKey}`,
      type: "sales-shipment",
      productId: line.productId,
      quantity,
      source: {
        id: command.sourceLocationId ?? line.warehouseLocationId,
        kind: command.sourceKind ?? "internal",
      },
      destination: { id: command.customerLocationId ?? "CUSTOMER", kind: "customer" },
      reference: { type: "sales-order-line", id: line.id },
    });
    return {
      state,
      movements: [movement],
      impact: {
        onHandDelta: -quantity,
        usableOnHandDelta: -quantity,
        reservedDelta: -releasedReservation,
        outgoingDemandDelta:
          after.outgoingDemandQuantity - before.outgoingDemandQuantity,
        negativeOverride: Boolean(command.allowNegative),
      },
    };
  });
}

export function returnFromCustomer(line, command) {
  return executeCommand(line, "post-customer-return", command, () => {
    requireConfirmed(line);
    const quantity = requireQuantity(command.quantity);
    requireText(command.reason, "reason");
    if (!new Set(["refund", "replacement"]).has(command.resolution)) {
      throw new DomainError(
        "INVALID_CUSTOMER_RETURN_RESOLUTION",
        "Customer return resolution must be refund or replacement.",
      );
    }
    const before = deriveSalesOrderQuantities(line);
    const physicallyReturnable = before.netShippedQuantity - line.returnedQuantity;
    assertAtMost(
      quantity,
      physicallyReturnable,
      "CUSTOMER_RETURN_EXCEEDS_SHIPPED",
      "Cannot return more than the shipped quantity not already returned.",
    );
    const state = {
      ...line,
      returnedQuantity: line.returnedQuantity + quantity,
      authorizedReplacementQuantity:
        line.authorizedReplacementQuantity +
        (command.resolution === "replacement" ? quantity : 0),
    };
    const after = deriveSalesOrderQuantities(state);
    const movement = createMovement({
      id: command.movementId ?? `customer-return:${command.idempotencyKey}`,
      type: "customer-return",
      productId: line.productId,
      quantity,
      source: { id: command.customerLocationId ?? "CUSTOMER", kind: "customer" },
      destination: {
        id: command.destinationLocationId ?? "RETURNS",
        kind: command.destinationKind ?? "returns",
      },
      reference: { type: "sales-order-line", id: line.id },
    });
    return {
      state,
      movements: [movement],
      impact: {
        onHandDelta: quantity,
        usableOnHandDelta: command.destinationKind === "internal" ? quantity : 0,
        outgoingDemandDelta:
          after.outgoingDemandQuantity - before.outgoingDemandQuantity,
        replacementDemandCreated: command.resolution === "replacement",
      },
    };
  });
}

export function reverseSalesShipment(line, command) {
  return executeCommand(line, "reverse-sales-shipment", command, () => {
    requireConfirmed(line);
    const quantity = requireQuantity(command.quantity);
    requireText(command.reason, "reason");
    const before = deriveSalesOrderQuantities(line);
    const reversible = before.netShippedQuantity - line.returnedQuantity;
    assertAtMost(
      quantity,
      reversible,
      "SHIPMENT_REVERSAL_EXCEEDS_SHIPPED",
      "Cannot reverse more than the shipped quantity still at the customer.",
    );
    const state = {
      ...line,
      shipmentReversedQuantity: line.shipmentReversedQuantity + quantity,
    };
    const after = deriveSalesOrderQuantities(state);
    const movement = createMovement({
      id: command.movementId ?? `shipment-reversal:${command.idempotencyKey}`,
      type: "sales-shipment-reversal",
      productId: line.productId,
      quantity,
      source: { id: command.customerLocationId ?? "CUSTOMER", kind: "customer" },
      destination: {
        id: command.destinationLocationId ?? line.warehouseLocationId,
        kind: command.destinationKind ?? "internal",
      },
      reference: { type: "sales-order-line", id: line.id },
    });
    return {
      state,
      movements: [movement],
      impact: {
        onHandDelta: quantity,
        outgoingDemandDelta:
          after.outgoingDemandQuantity - before.outgoingDemandQuantity,
      },
    };
  });
}

