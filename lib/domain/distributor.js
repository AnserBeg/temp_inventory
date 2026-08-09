import {
  DomainError,
  executeCommand,
  requireQuantity,
  requireText,
} from "./common.js";

const CHARGE_KINDS = new Set([
  "freight",
  "fuel_surcharge",
  "environmental_fee",
  "handling_fee",
  "core_charge",
  "empty_deposit",
  "returnable_deposit",
  "customs",
  "brokerage",
  "tax",
  "discount",
  "other",
]);

const RETURNABLE_EVENTS = new Set([
  "issue_to_partner",
  "return_from_partner",
  "receive_from_partner",
  "return_to_partner",
  "forfeit_by_partner",
  "forfeit_by_company",
]);

function requireInteger(value, field, { allowZero = true } = {}) {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new DomainError(
      "INVALID_MONEY",
      `${field} must be a ${allowZero ? "non-negative " : "positive "}integer number of cents.`,
      { field, value },
    );
  }
  return value;
}
function requireRate(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new DomainError(
      "INVALID_RATE",
      `${field} must be an integer between 0 and 10000 basis points.`,
      { field, value },
    );
  }
  return value;
}

function moneyMultiply(quantity, unitAmountCents) {
  const amount = Math.round(quantity * unitAmountCents);
  if (!Number.isSafeInteger(amount)) {
    throw new DomainError("INVALID_MONEY", "Calculated amount exceeds the supported range.");
  }
  return amount;
}

function auditEvent(action, actor, summary, metadata = {}) {
  return Object.freeze({
    action: requireText(action, "audit.action"),
    actor: requireText(actor, "audit.actor"),
    summary: requireText(summary, "audit.summary"),
    metadata: Object.freeze({ ...metadata }),
  });
}

/**
 * Calculates a document without allowing financial charges to masquerade as
 * inventory lines. Amounts are integer cents and charge taxability is explicit.
 */
export function calculateDocumentTotals({ lines = [], charges = [], taxRateBps = 0 }) {
  requireRate(taxRateBps, "taxRateBps");
  if (!Array.isArray(lines) || !Array.isArray(charges)) {
    throw new DomainError("INVALID_DOCUMENT", "lines and charges must be arrays.");
  }

  let itemSubtotalCents = 0;
  let taxableItemSubtotalCents = 0;
  const normalizedLines = lines.map((line, index) => {
    const quantity = requireQuantity(line.quantity, `lines[${index}].quantity`);
    const unitAmountCents = requireInteger(line.unitAmountCents, `lines[${index}].unitAmountCents`);
    const discountCents = requireInteger(line.discountCents ?? 0, `lines[${index}].discountCents`);
    const grossCents = moneyMultiply(quantity, unitAmountCents);
    if (discountCents > grossCents) {
      throw new DomainError("INVALID_DISCOUNT", "A line discount cannot exceed its gross amount.", { index });
    }
    const netCents = grossCents - discountCents;
    itemSubtotalCents += netCents;
    if (line.taxable !== false) taxableItemSubtotalCents += netCents;
    return Object.freeze({ ...line, quantity, unitAmountCents, discountCents, grossCents, netCents });
  });

  let chargeTotalCents = 0;
  let taxableChargeTotalCents = 0;
  let refundableDepositCents = 0;
  const byKind = {};
  const normalizedCharges = charges.map((charge, index) => {
    const kind = requireText(charge.kind, `charges[${index}].kind`);
    if (!CHARGE_KINDS.has(kind)) {
      throw new DomainError("INVALID_CHARGE_KIND", `Unsupported charge kind: ${kind}.`, { kind });
    }
    const amountCents = requireInteger(charge.amountCents, `charges[${index}].amountCents`);
    const direction = charge.direction ?? (kind === "discount" ? "subtract" : "add");
    if (!new Set(["add", "subtract"]).has(direction)) {
      throw new DomainError("INVALID_CHARGE_DIRECTION", "Charge direction must be add or subtract.");
    }
    const signedAmountCents = direction === "subtract" ? -amountCents : amountCents;
    chargeTotalCents += signedAmountCents;
    if (charge.taxable === true) taxableChargeTotalCents += signedAmountCents;
    const refundable = charge.refundable === true || new Set(["core_charge", "empty_deposit", "returnable_deposit"]).has(kind);
    if (refundable && direction === "add") refundableDepositCents += amountCents;
    byKind[kind] = (byKind[kind] ?? 0) + signedAmountCents;
    return Object.freeze({ ...charge, kind, amountCents, direction, signedAmountCents, refundable });
  });

  const taxableSubtotalCents = taxableItemSubtotalCents + taxableChargeTotalCents;
  if (taxableSubtotalCents < 0) {
    throw new DomainError("INVALID_DOCUMENT_TOTAL", "Taxable discounts cannot exceed taxable charges and items.");
  }
  const taxCents = Math.round((taxableSubtotalCents * taxRateBps) / 10000);
  const subtotalCents = itemSubtotalCents + chargeTotalCents;
  if (subtotalCents < 0) {
    throw new DomainError("INVALID_DOCUMENT_TOTAL", "Document charges and discounts produce a negative subtotal.");
  }

  return Object.freeze({
    lines: Object.freeze(normalizedLines),
    charges: Object.freeze(normalizedCharges),
    itemSubtotalCents,
    chargeTotalCents,
    chargeTotalsByKind: Object.freeze(byKind),
    refundableDepositCents,
    taxableSubtotalCents,
    taxCents,
    subtotalCents,
    totalCents: subtotalCents + taxCents,
    physicalInventoryDelta: 0,
  });
}

function groupQuantity(rows, key) {
  return rows.reduce((totals, row) => {
    const id = requireText(row.purchaseOrderLineId, `${key}.purchaseOrderLineId`);
    totals[id] = (totals[id] ?? 0) + requireQuantity(row.quantity, `${key}.quantity`, { allowZero: true });
    return totals;
  }, {});
}

/**
 * Produces stable three-way-match exceptions without posting a bill or moving stock.
 */
export function evaluateThreeWayMatch({
  purchaseLines = [],
  receiptLines = [],
  returnLines = [],
  billLines = [],
  billCharges = [],
  tolerances = {},
}) {
  const received = groupQuantity(receiptLines, "receiptLines");
  const returned = groupQuantity(returnLines, "returnLines");
  const quantityTolerance = requireQuantity(tolerances.quantity ?? 0, "tolerances.quantity", { allowZero: true });
  const priceToleranceCents = requireInteger(tolerances.unitPriceCents ?? 0, "tolerances.unitPriceCents");
  const totalToleranceCents = requireInteger(tolerances.totalCents ?? 0, "tolerances.totalCents");
  const allowedChargeKinds = new Set(tolerances.allowedChargeKinds ?? []);
  const poById = Object.fromEntries(purchaseLines.map((line) => [requireText(line.id, "purchaseLine.id"), line]));
  const exceptions = [];
  let authorizedCents = 0;
  let receivedValueCents = 0;
  let billedCents = 0;

  for (const [index, line] of billLines.entries()) {
    const poLineId = requireText(line.purchaseOrderLineId, `billLines[${index}].purchaseOrderLineId`);
    const poLine = poById[poLineId];
    const billedQuantity = requireQuantity(line.quantity, `billLines[${index}].quantity`);
    const billUnitCostCents = requireInteger(line.unitCostCents, `billLines[${index}].unitCostCents`);
    billedCents += moneyMultiply(billedQuantity, billUnitCostCents);
    if (!poLine) {
      exceptions.push({ code: "NO_PURCHASE_ORDER_LINE", severity: "blocking", lineId: poLineId, message: "Bill line is not linked to an authorized purchase-order line." });
      continue;
    }
    const orderedQuantity = requireQuantity(poLine.quantity, "purchaseLine.quantity");
    const poUnitCostCents = requireInteger(poLine.unitCostCents, "purchaseLine.unitCostCents");
    const netReceivedQuantity = Math.max((received[poLineId] ?? 0) - (returned[poLineId] ?? 0), 0);
    authorizedCents += moneyMultiply(billedQuantity, poUnitCostCents);
    receivedValueCents += moneyMultiply(Math.min(billedQuantity, netReceivedQuantity), poUnitCostCents);

    if (billedQuantity > orderedQuantity + quantityTolerance) {
      exceptions.push({ code: "BILLED_ABOVE_ORDERED", severity: "blocking", lineId: poLineId, variance: billedQuantity - orderedQuantity, message: "Billed quantity exceeds the authorized purchase quantity." });
    }
    if (billedQuantity > netReceivedQuantity + quantityTolerance) {
      exceptions.push({ code: netReceivedQuantity === 0 ? "BILL_BEFORE_RECEIPT" : "BILLED_ABOVE_RECEIVED", severity: "blocking", lineId: poLineId, variance: billedQuantity - netReceivedQuantity, message: "Billed quantity exceeds net goods received." });
    }
    const priceVarianceCents = billUnitCostCents - poUnitCostCents;
    if (priceVarianceCents > priceToleranceCents) {
      exceptions.push({ code: "UNIT_PRICE_VARIANCE", severity: "approval", lineId: poLineId, varianceCents: priceVarianceCents, message: "Vendor unit price exceeds the purchase-order tolerance." });
    }
  }

  for (const charge of billCharges) {
    const kind = requireText(charge.kind, "billCharge.kind");
    const amountCents = requireInteger(charge.amountCents, "billCharge.amountCents");
    billedCents += amountCents;
    if (!allowedChargeKinds.has(kind)) {
      exceptions.push({ code: "UNEXPECTED_CHARGE", severity: "approval", kind, varianceCents: amountCents, message: `Unexpected ${kind.replaceAll("_", " ")} charge on vendor bill.` });
    }
  }

  const totalVarianceCents = billedCents - authorizedCents;
  if (totalVarianceCents > totalToleranceCents && !exceptions.some((item) => item.code === "UNIT_PRICE_VARIANCE" || item.code === "UNEXPECTED_CHARGE")) {
    exceptions.push({ code: "TOTAL_VARIANCE", severity: "approval", varianceCents: totalVarianceCents, message: "Vendor bill total exceeds the configured tolerance." });
  }
  return Object.freeze({
    status: exceptions.some((item) => item.severity === "blocking") ? "blocked" : exceptions.length ? "approval_required" : "matched",
    payable: exceptions.length === 0,
    authorizedCents,
    receivedValueCents,
    billedCents,
    varianceCents: totalVarianceCents,
    exceptions: Object.freeze(exceptions.map(Object.freeze)),
    physicalInventoryDelta: 0,
  });
}

export function createReturnableLedger() {
  return {
    kind: "returnable-ledger",
    balances: {},
    events: [],
    auditTrail: [],
    version: 0,
    commandLog: {},
  };
}

function returnableBalanceKey(partnerId, assetType) {
  return `${partnerId}:${assetType}`;
}

/**
 * Tracks cores, empties, crates, cylinders, pallets, and other reusable assets.
 * Quantity obligations and deposit money are explicit and never alter sellable stock.
 */
export function postReturnableEvent(state, command) {
  return executeCommand(state, "post-returnable-event", command, () => {
    const type = requireText(command.type, "type");
    if (!RETURNABLE_EVENTS.has(type)) {
      throw new DomainError("INVALID_RETURNABLE_EVENT", `Unsupported returnable event: ${type}.`);
    }
    const partnerId = requireText(command.partnerId, "partnerId");
    const assetType = requireText(command.assetType, "assetType");
    const actor = requireText(command.actor, "actor");
    const reason = requireText(command.reason, "reason");
    const quantity = requireQuantity(command.quantity);
    const unitDepositCents = requireInteger(command.unitDepositCents ?? 0, "unitDepositCents");
    const key = returnableBalanceKey(partnerId, assetType);
    const before = state.balances[key] ?? {
      partnerId,
      assetType,
      heldByPartner: 0,
      heldByCompany: 0,
      customerDepositLiabilityCents: 0,
      vendorDepositReceivableCents: 0,
      forfeitedRevenueCents: 0,
      forfeitedExpenseCents: 0,
    };
    const next = { ...before };
    const amountCents = moneyMultiply(quantity, unitDepositCents);
    if (type === "issue_to_partner") {
      next.heldByPartner += quantity;
      next.customerDepositLiabilityCents += amountCents;
    } else if (type === "return_from_partner") {
      if (quantity > next.heldByPartner) throw new DomainError("RETURN_EXCEEDS_OUTSTANDING", "Returned cores or empties exceed the quantity held by this partner.");
      next.heldByPartner -= quantity;
      next.customerDepositLiabilityCents = Math.max(next.customerDepositLiabilityCents - amountCents, 0);
    } else if (type === "receive_from_partner") {
      next.heldByCompany += quantity;
      next.vendorDepositReceivableCents += amountCents;
    } else if (type === "return_to_partner") {
      if (quantity > next.heldByCompany) throw new DomainError("RETURN_EXCEEDS_OUTSTANDING", "Returned cores or empties exceed the quantity held by the company.");
      next.heldByCompany -= quantity;
      next.vendorDepositReceivableCents = Math.max(next.vendorDepositReceivableCents - amountCents, 0);
    } else if (type === "forfeit_by_partner") {
      if (quantity > next.heldByPartner) throw new DomainError("FORFEIT_EXCEEDS_OUTSTANDING", "Forfeited quantity exceeds the quantity held by this partner.");
      next.heldByPartner -= quantity;
      next.customerDepositLiabilityCents = Math.max(next.customerDepositLiabilityCents - amountCents, 0);
      next.forfeitedRevenueCents += amountCents;
    } else {
      if (quantity > next.heldByCompany) throw new DomainError("FORFEIT_EXCEEDS_OUTSTANDING", "Forfeited quantity exceeds the quantity held by the company.");
      next.heldByCompany -= quantity;
      next.vendorDepositReceivableCents = Math.max(next.vendorDepositReceivableCents - amountCents, 0);
      next.forfeitedExpenseCents += amountCents;
    }
    const event = Object.freeze({ type, partnerId, assetType, quantity, unitDepositCents, amountCents, reason, actor });
    const audit = auditEvent(type, actor, `${quantity} ${assetType} recorded for ${partnerId}.`, { reason, amountCents });
    return {
      state: {
        ...state,
        balances: { ...state.balances, [key]: Object.freeze(next) },
        events: [...state.events, event],
        auditTrail: [...state.auditTrail, audit],
      },
      movements: [],
      impact: {
        onHandDelta: 0,
        sellableInventoryDelta: 0,
        returnableQuantityDelta: quantity,
        depositDeltaCents: amountCents,
        eventType: type,
      },
    };
  });
}

export function createApprovalRecord({ entityId, entityType, revision = 1, totalCents = 0 }) {
  return {
    kind: "approval-record",
    entityId: requireText(entityId, "entityId"),
    entityType: requireText(entityType, "entityType"),
    revision: requireInteger(revision, "revision", { allowZero: false }),
    totalCents: requireInteger(totalCents, "totalCents"),
    status: "draft",
    submittedBy: null,
    decisionBy: null,
    decisionReason: null,
    auditTrail: [],
    version: 0,
    commandLog: {},
  };
}

export function submitForApproval(state, command) {
  return executeCommand(state, "submit-for-approval", command, () => {
    if (!new Set(["draft", "rejected"]).has(state.status)) {
      throw new DomainError("INVALID_APPROVAL_STATE", "Only draft or rejected revisions can be submitted.");
    }
    const actor = requireText(command.actor, "actor");
    const reason = requireText(command.reason, "reason");
    return {
      state: {
        ...state,
        status: "pending_approval",
        submittedBy: actor,
        auditTrail: [...state.auditTrail, auditEvent("submitted_for_approval", actor, `Revision ${state.revision} submitted for approval.`, { reason })],
      },
      movements: [],
      impact: { onHandDelta: 0, approvalStatus: "pending_approval" },
    };
  });
}

export function decideApproval(state, command) {
  return executeCommand(state, "decide-approval", command, () => {
    if (state.status !== "pending_approval") {
      throw new DomainError("INVALID_APPROVAL_STATE", "Only a pending revision can be approved or rejected.");
    }
    const decision = requireText(command.decision, "decision");
    if (!new Set(["approved", "rejected"]).has(decision)) {
      throw new DomainError("INVALID_APPROVAL_DECISION", "Decision must be approved or rejected.");
    }
    const actor = requireText(command.actor, "actor");
    const reason = requireText(command.reason, "reason");
    return {
      state: {
        ...state,
        status: decision,
        decisionBy: actor,
        decisionReason: reason,
        auditTrail: [...state.auditTrail, auditEvent(decision, actor, `Revision ${state.revision} ${decision}.`, { reason })],
      },
      movements: [],
      impact: { onHandDelta: 0, approvalStatus: decision },
    };
  });
}

export function amendApprovedRecord(state, command) {
  return executeCommand(state, "amend-approved-record", command, () => {
    if (state.status !== "approved") {
      throw new DomainError("INVALID_APPROVAL_STATE", "Only an approved revision can be amended.");
    }
    const actor = requireText(command.actor, "actor");
    const reason = requireText(command.reason, "reason");
    const changes = Array.isArray(command.changes) ? command.changes : [];
    if (!changes.length) throw new DomainError("CHANGES_REQUIRED", "At least one amendment change is required.");
    const totalCents = command.totalCents == null ? state.totalCents : requireInteger(command.totalCents, "totalCents");
    return {
      state: {
        ...state,
        revision: state.revision + 1,
        totalCents,
        status: "pending_approval",
        submittedBy: actor,
        decisionBy: null,
        decisionReason: null,
        auditTrail: [...state.auditTrail, auditEvent("amended", actor, `Revision ${state.revision + 1} created and submitted.`, { reason, changes })],
      },
      movements: [],
      impact: { onHandDelta: 0, approvalStatus: "pending_approval", revisionDelta: 1 },
    };
  });
}

export function createValuationLedger({ method = "fifo", standardCostCents = 0 } = {}) {
  if (!new Set(["fifo", "average", "standard"]).has(method)) {
    throw new DomainError("INVALID_COST_METHOD", "Cost method must be fifo, average, or standard.");
  }
  return {
    kind: "valuation-ledger",
    method,
    standardCostCents: requireInteger(standardCostCents, "standardCostCents"),
    layers: [],
    quantityOnHand: 0,
    inventoryValueCents: 0,
    cogsCents: 0,
    entries: [],
    auditTrail: [],
    version: 0,
    commandLog: {},
  };
}

export function receiveValuation(state, command) {
  return executeCommand(state, "receive-valuation", command, () => {
    const quantity = requireQuantity(command.quantity);
    const actualUnitCostCents = requireInteger(command.unitCostCents, "unitCostCents");
    const actor = requireText(command.actor, "actor");
    const reference = requireText(command.reference, "reference");
    const unitCostCents = state.method === "standard" ? state.standardCostCents : actualUnitCostCents;
    const valueCents = moneyMultiply(quantity, unitCostCents);
    const layer = Object.freeze({ id: requireText(command.layerId, "layerId"), quantity, remainingQuantity: quantity, unitCostCents, actualUnitCostCents, reference });
    const entry = Object.freeze({ type: "receipt", quantity, valueCents, reference });
    return {
      state: {
        ...state,
        layers: [...state.layers, layer],
        quantityOnHand: state.quantityOnHand + quantity,
        inventoryValueCents: state.inventoryValueCents + valueCents,
        entries: [...state.entries, entry],
        auditTrail: [...state.auditTrail, auditEvent("valuation_receipt", actor, `${quantity} units valued from ${reference}.`, { valueCents })],
      },
      movements: [],
      impact: { onHandDelta: 0, valuationQuantityDelta: quantity, inventoryValueDeltaCents: valueCents },
    };
  });
}

function consumeFifo(layers, quantity) {
  let remaining = quantity;
  let valueCents = 0;
  const nextLayers = [];
  for (const layer of layers) {
    if (remaining <= 0 || layer.remainingQuantity <= 0) {
      nextLayers.push(layer);
      continue;
    }
    const consumed = Math.min(layer.remainingQuantity, remaining);
    valueCents += moneyMultiply(consumed, layer.unitCostCents);
    remaining -= consumed;
    nextLayers.push(Object.freeze({ ...layer, remainingQuantity: layer.remainingQuantity - consumed }));
  }
  return { remaining, valueCents, layers: nextLayers };
}

export function issueValuation(state, command) {
  return executeCommand(state, "issue-valuation", command, () => {
    const quantity = requireQuantity(command.quantity);
    const actor = requireText(command.actor, "actor");
    const reference = requireText(command.reference, "reference");
    if (quantity > state.quantityOnHand) {
      throw new DomainError("NEGATIVE_INVENTORY_BLOCKED", "Valuation issue exceeds quantity on hand.", { quantityOnHand: state.quantityOnHand, quantity });
    }
    let valueCents;
    let layers = state.layers;
    if (state.method === "fifo") {
      const consumed = consumeFifo(state.layers, quantity);
      if (consumed.remaining > 0) throw new DomainError("VALUATION_LAYER_SHORTAGE", "FIFO layers do not reconstruct quantity on hand.");
      valueCents = consumed.valueCents;
      layers = consumed.layers;
    } else if (state.method === "average") {
      valueCents = state.quantityOnHand === 0 ? 0 : Math.round((state.inventoryValueCents / state.quantityOnHand) * quantity);
    } else {
      valueCents = moneyMultiply(quantity, state.standardCostCents);
    }
    const entry = Object.freeze({ type: "issue", quantity: -quantity, valueCents: -valueCents, reference });
    return {
      state: {
        ...state,
        layers,
        quantityOnHand: state.quantityOnHand - quantity,
        inventoryValueCents: state.inventoryValueCents - valueCents,
        cogsCents: state.cogsCents + valueCents,
        entries: [...state.entries, entry],
        auditTrail: [...state.auditTrail, auditEvent("valuation_issue", actor, `${quantity} units issued to ${reference}.`, { valueCents })],
      },
      movements: [],
      impact: { onHandDelta: 0, valuationQuantityDelta: -quantity, inventoryValueDeltaCents: -valueCents, cogsDeltaCents: valueCents },
    };
  });
}

export function allocateLandedCost(lines, totalCostCents, basis = "purchase_value") {
  requireInteger(totalCostCents, "totalCostCents");
  if (!Array.isArray(lines) || lines.length === 0) throw new DomainError("LINES_REQUIRED", "At least one receipt line is required for landed-cost allocation.");
  if (!new Set(["quantity", "weight", "volume", "purchase_value", "equal"]).has(basis)) {
    throw new DomainError("INVALID_ALLOCATION_BASIS", "Unsupported landed-cost allocation basis.");
  }
  const weights = lines.map((line, index) => {
    if (basis === "equal") return 1;
    if (basis === "purchase_value") {
      return moneyMultiply(requireQuantity(line.quantity, `lines[${index}].quantity`), requireInteger(line.unitCostCents, `lines[${index}].unitCostCents`));
    }
    return requireQuantity(line[basis], `lines[${index}].${basis}`);
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (totalWeight <= 0) throw new DomainError("INVALID_ALLOCATION", "Allocation weights must total more than zero.");
  let allocated = 0;
  const result = lines.map((line, index) => {
    const amountCents = index === lines.length - 1 ? totalCostCents - allocated : Math.round((totalCostCents * weights[index]) / totalWeight);
    allocated += amountCents;
    return Object.freeze({ lineId: requireText(line.id, `lines[${index}].id`), amountCents, basis, physicalInventoryDelta: 0 });
  });
  return Object.freeze(result);
}
