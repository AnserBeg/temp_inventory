/**
 * Unwrap the two response envelopes returned by /api/workflows.
 *
 * GET returns { snapshot: core, advanced } while POST returns
 * { ...result, snapshot: { snapshot: core, advanced } }. Keeping this small
 * adapter outside React makes the wire contract independently testable.
 *
 * @param {unknown} input
 * @returns {{ advanced: unknown, core: unknown }}
 */
export function workflowSnapshotParts(input) {
  if (!input || typeof input !== "object") return { advanced: undefined, core: undefined };
  const envelope = /** @type {Record<string, unknown>} */ (input);

  if (envelope.advanced && typeof envelope.advanced === "object") {
    return { advanced: envelope.advanced, core: envelope.snapshot };
  }

  const nested = envelope.snapshot;
  if (nested && typeof nested === "object") {
    const snapshot = /** @type {Record<string, unknown>} */ (nested);
    if (snapshot.advanced && typeof snapshot.advanced === "object") {
      return { advanced: snapshot.advanced, core: snapshot.snapshot };
    }
  }

  if (envelope.state && typeof envelope.state === "object") {
    return { advanced: envelope.state, core: envelope.snapshot };
  }

  return { advanced: envelope, core: undefined };
}

/**
 * Build the server-scoped approval request for an inventory count variance.
 * The five scope values are repeated when the count is retried, preventing an
 * approval for one product/location/count from authorizing a different change.
 *
 * @param {{ productId: string, locationId: string, recordedQuantity: number, countedQuantity: number, reason: string }} input
 */
export function inventoryCountApprovalPayload(input) {
  return {
    entityType: "product",
    requestType: "inventory_count_variance",
    reason: input.reason,
    metadata: {
      productId: input.productId,
      locationId: input.locationId,
      recordedQuantity: input.recordedQuantity,
      countedQuantity: input.countedQuantity,
      absoluteVariance: Math.abs(input.countedQuantity - input.recordedQuantity),
    },
  };
}

/**
 * Build a workflow write envelope with the version of the document selected in
 * the form. Financial creation commands are authoritative on their source PO,
 * SO, invoice, or bill; a placeholder version must never be sent for them.
 *
 * @param {{ command: string, kind: string, payload: Record<string, unknown>, record?: { id?: string, version?: number }, options: Record<string, Array<{ id: string, version?: number }>>, idempotencyKey: string }} input
 */
export function workflowCommandEnvelope(input) {
  let entityId = input.record?.id;
  let version = input.record?.version;
  let option;

  if (input.kind === "createVendorBill") {
    entityId = String(input.payload.purchaseOrderId ?? "");
    option = input.options.purchaseOrders?.find((item) => item.id === entityId);
  } else if (input.kind === "createCustomerInvoice") {
    entityId = String(input.payload.salesOrderId ?? "");
    option = input.options.salesOrders?.find((item) => item.id === entityId);
  } else if (["issueCustomerCredit", "recordCustomerPayment"].includes(input.kind)) {
    entityId = String(input.payload.documentId ?? "");
    option = input.options.customerInvoices?.find((item) => item.id === entityId);
  } else if (input.kind === "postDropShipDelivery") {
    entityId = String(input.payload.salesOrderLineId ?? "");
    option = input.options.salesOrderLines?.find((item) => item.id === entityId);
  }

  if (option) version = option.version;
  if (["createVendorBill", "createCustomerInvoice", "issueCustomerCredit", "recordCustomerPayment", "postDropShipDelivery"].includes(input.kind)
      && (!entityId || !option || !Number.isFinite(version))) {
    throw new Error("Refresh the source document before posting so its current version can be checked.");
  }

  return {
    command: input.command,
    ...(entityId ? { entityId } : {}),
    ...(Number.isFinite(version) ? { version } : {}),
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
  };
}
