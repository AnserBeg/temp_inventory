import { ensureDatabase, first, getD1, newId, nextDocumentNumber } from "./inventory-db";
import { normalizeProductQuantity, ProductQuantityError } from "./product-quantities";
import { prepareApprovedPurchaseCostStatements } from "./catalog-pricing";

export type CreateOrderLine = {
  kind?: "item" | "charge";
  productId?: string;
  quantity?: number;
  uomId?: string;
  unitCostCents?: number;
  unitPriceCents?: number;
  discountCents?: number;
  taxable?: boolean;
  taxRateBps?: number;
  taxCode?: string;
  chargeType?: string;
  description?: string;
  amountCents?: number;
  direction?: "add" | "subtract";
  refundable?: boolean;
  fulfillmentRoute?: "stock" | "special_order" | "drop_ship";
  projectReference?: string;
  sourceSalesOrderLineId?: string;
  supplyAllocations?: Array<{ salesOrderLineId?: string; quantity?: number }>;
  linkedPurchaseOrderLineId?: string;
  configurationSnapshot?: string;
};

export type CreateOrderInput = {
  type: "purchaseOrder" | "salesOrder";
  idempotencyKey: string;
  vendorId?: string;
  customerId?: string;
  productId?: string;
  quantity?: number;
  unitCostCents?: number;
  unitPriceCents?: number;
  lines?: CreateOrderLine[];
  expectedDate?: string;
  requestedDate?: string;
  actor?: string;
  actorId?: string;
  actorEmail?: string;
  projectReference?: string;
  currency?: string;
  exchangeRateToBase?: number;
  paymentTerms?: string;
  dueDate?: string;
  shipToName?: string;
  shipToAddressLine1?: string;
  shipToAddressLine2?: string;
  shipToCity?: string;
  shipToRegion?: string;
  shipToPostalCode?: string;
  shipToCountry?: string;
  deliveryInstructions?: string;
  freightCents?: number;
  feeCents?: number;
  refundableDepositCents?: number;
  /** Internal context used while replacing an existing purchase-order draft. */
  editingPurchaseOrderId?: string;
  /** Supplied by the workflow envelope so both layers persist the same idempotency fingerprint. */
  requestHash?: string;
  /**
   * Internal, server-authorized fast-track context. The workflow layer only supplies this after
   * checking that the actor can both author and approve the document.
   */
  fastTrackApprovalReason?: string;
};

type CreateOrderResult = {
  recordId: string;
  /** Returned so the caller can put the caller straight onto the document it just created. */
  number: string;
  message: string;
  impact: {
    physical: string;
    commercial: string;
    financial: string;
    onHandDelta: number;
    incomingDelta: number;
    reservedDelta: number;
    availableDelta: number;
  };
};

export type NormalizedItem = {
  productId: string;
  productName: string;
  quantity: number;
  enteredQuantity: number;
  uomId: string;
  uomCode: string;
  factorToBase: number;
  unitAmountCents: number;
  enteredUnitAmountCents: number;
  discountCents: number;
  taxable: boolean;
  taxCode: string;
  taxRateBps: number;
  fulfillmentRoute: "stock" | "special_order" | "drop_ship";
  projectReference: string | null;
  configurationSnapshot: string | null;
  sourceSalesOrderLineId: string | null;
  supplyAllocations: Array<{ salesOrderLineId: string; quantity: number; enteredQuantity: number }>;
  linkedPurchaseOrderLineId: string | null;
};

export type NormalizedCharge = {
  chargeType: string;
  description: string;
  amountCents: number;
  direction: "add" | "subtract";
  taxable: boolean;
  refundable: boolean;
  taxRateBps: number;
  taxCode: string | null;
};

const supportedChargeTypes = new Set(["freight", "fee", "handling_fee", "fuel_surcharge", "environmental_fee", "handling", "customs", "brokerage", "discount", "tax_adjustment", "core_deposit", "empty_deposit", "returnable_deposit", "other"]);
const refundableChargeTypes = new Set(["core_deposit", "empty_deposit", "returnable_deposit"]);

export class RecordValidationError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

function requiredText(value: unknown, field: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new RecordValidationError("VALIDATION_ERROR", `${field} is required.`);
  return normalized;
}

function positiveNumber(value: unknown, field: string) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) throw new RecordValidationError("VALIDATION_ERROR", `${field} must be greater than zero.`);
  return normalized;
}

function cents(value: unknown, field: string, allowZero = false) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < (allowZero ? 0 : 1)) {
    throw new RecordValidationError("VALIDATION_ERROR", `${field} must be ${allowZero ? "a non-negative" : "a positive"} whole number of cents.`);
  }
  return normalized;
}

function basisPoints(value: unknown, field: string) {
  const normalized = value == null ? 0 : Number(value);
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 10000) {
    throw new RecordValidationError("VALIDATION_ERROR", `${field} must be between 0 and 10000 basis points.`);
  }
  return normalized;
}

function normalizedTaxCode(value: unknown, taxable: boolean, taxRateBps: number) {
  const supplied = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (supplied) return supplied === "ZERO" ? "ZERO" : supplied === "EXEMPT" ? "EXEMPT" : supplied;
  return taxable && taxRateBps > 0 ? "GST" : taxable ? "ZERO" : "EXEMPT";
}

function validDate(value: unknown, field: string) {
  const normalized = requiredText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new RecordValidationError("VALIDATION_ERROR", `${field} must use YYYY-MM-DD format.`);
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new RecordValidationError("VALIDATION_ERROR", `${field} is not a valid calendar date.`);
  }
  return normalized;
}



async function replay(idempotencyKey: string, requestHash?: string) {
  const prior = await first<{ responseJson: string; requestHash: string | null }>("SELECT response_json AS responseJson, request_hash AS requestHash FROM command_log WHERE idempotency_key = ?", idempotencyKey);
  if (prior?.requestHash && requestHash && prior.requestHash !== requestHash) throw new RecordValidationError("IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different order request.", 409);
  return prior ? JSON.parse(prior.responseJson) as CreateOrderResult : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function hashOrderInput(input: CreateOrderInput) {
  const normalized = { ...input, actor: undefined, actorId: undefined, actorEmail: undefined, editingPurchaseOrderId: undefined, requestHash: undefined };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(normalized)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function normalizeOrderLines(input: CreateOrderInput) {
  const source: CreateOrderLine[] = input.lines?.length ? [...input.lines] : [{
    kind: "item", productId: input.productId, quantity: input.quantity,
    unitCostCents: input.unitCostCents, unitPriceCents: input.unitPriceCents,
    projectReference: input.projectReference,
  }];
  if ((input.freightCents ?? 0) > 0) source.push({ kind: "charge", chargeType: "freight", description: "Freight", amountCents: input.freightCents, taxable: true });
  if ((input.feeCents ?? 0) > 0) source.push({ kind: "charge", chargeType: "handling_fee", description: "Order fee", amountCents: input.feeCents, taxable: true });
  if ((input.refundableDepositCents ?? 0) > 0) source.push({ kind: "charge", chargeType: "returnable_deposit", description: "Refundable deposit", amountCents: input.refundableDepositCents, taxable: false, refundable: true });
  const items: NormalizedItem[] = [];
  const charges: NormalizedCharge[] = [];
  for (const [index, line] of source.entries()) {
    if (line.kind === "charge") {
      const chargeType = requiredText(line.chargeType, `lines[${index}].chargeType`).toLowerCase();
      if (!supportedChargeTypes.has(chargeType)) throw new RecordValidationError("INVALID_CHARGE_TYPE", `lines[${index}].chargeType is not supported.`);
      const direction = line.direction === "subtract" ? "subtract" : "add";
      if (chargeType === "discount" && direction !== "subtract") throw new RecordValidationError("INVALID_CHARGE_DIRECTION", "Discount charges must subtract from the order total.");
      if (refundableChargeTypes.has(chargeType) && direction !== "add") throw new RecordValidationError("INVALID_CHARGE_DIRECTION", "Refundable deposit charges must add to the order total.");
      const refundable = line.refundable === true;
      if (refundable !== refundableChargeTypes.has(chargeType)) throw new RecordValidationError("INVALID_REFUNDABLE_CHARGE", refundableChargeTypes.has(chargeType) ? `${chargeType} must be marked refundable.` : "Only core, empty, and returnable deposits may be marked refundable.");
      charges.push({
        chargeType,
        description: requiredText(line.description, `lines[${index}].description`),
        amountCents: cents(line.amountCents, `lines[${index}].amountCents`),
        direction,
        taxable: line.taxable === true,
        refundable,
        taxRateBps: basisPoints(line.taxRateBps, `lines[${index}].taxRateBps`),
        taxCode: typeof line.taxCode === "string" && line.taxCode.trim() ? line.taxCode.trim() : null,
      });
      continue;
    }
    const productId = requiredText(line.productId, `lines[${index}].productId`);
    const product = await first<{ name: string; active: number; dimensions: string | null; finish: string | null; material: string | null }>("SELECT name, active, dimensions, finish, material FROM products WHERE id = ?", productId);
    if (!product?.active) throw new RecordValidationError("INVALID_PRODUCT", `Line ${index + 1} must reference an active product.`, 404);
    const route = line.fulfillmentRoute ?? "stock";
    if (!(["stock", "special_order", "drop_ship"] as const).includes(route)) {
      throw new RecordValidationError("VALIDATION_ERROR", `lines[${index}].fulfillmentRoute is invalid.`);
    }
    const enteredUnitAmount = input.type === "purchaseOrder"
      ? cents(line.unitCostCents, `lines[${index}].unitCostCents`, true)
      : cents(line.unitPriceCents, `lines[${index}].unitPriceCents`, true);
    const enteredQuantity = positiveNumber(line.quantity, `lines[${index}].quantity`);
    let normalizedQuantity: Awaited<ReturnType<typeof normalizeProductQuantity>>;
    try {
      normalizedQuantity = await normalizeProductQuantity({
        productId,
        quantity: enteredQuantity,
        uomId: typeof line.uomId === "string" ? line.uomId : undefined,
        usage: input.type === "purchaseOrder" ? "purchase" : "sales",
        field: `lines[${index}].quantity`,
      });
    } catch (error) {
      if (error instanceof ProductQuantityError) throw new RecordValidationError(error.code, error.message, error.status);
      throw error;
    }
    const quantity = normalizedQuantity.baseQuantity;
    const unitAmount = enteredUnitAmount / normalizedQuantity.factorToBase;
    const discountCents = cents(line.discountCents ?? 0, `lines[${index}].discountCents`, true);
    if (discountCents > Math.round(enteredQuantity * enteredUnitAmount)) throw new RecordValidationError("VALIDATION_ERROR", `Line ${index + 1} discount exceeds its gross amount.`);
    const legacySourceSalesOrderLineId=typeof line.sourceSalesOrderLineId==="string"&&line.sourceSalesOrderLineId.trim()?line.sourceSalesOrderLineId.trim():null;
    const linkedPurchaseOrderLineId=typeof line.linkedPurchaseOrderLineId==="string"&&line.linkedPurchaseOrderLineId.trim()?line.linkedPurchaseOrderLineId.trim():null;
    const rawAllocations = Array.isArray(line.supplyAllocations) && line.supplyAllocations.length
      ? line.supplyAllocations
      : legacySourceSalesOrderLineId
        ? [{ salesOrderLineId: legacySourceSalesOrderLineId, quantity: enteredQuantity }]
        : [];
    const supplyAllocations: NormalizedItem["supplyAllocations"] = [];
    for (const [allocationIndex, allocation] of rawAllocations.entries()) {
      const salesOrderLineId = requiredText(allocation.salesOrderLineId, `lines[${index}].supplyAllocations[${allocationIndex}].salesOrderLineId`);
      const allocationEnteredQuantity = positiveNumber(allocation.quantity, `lines[${index}].supplyAllocations[${allocationIndex}].quantity`);
      let allocationQuantity: Awaited<ReturnType<typeof normalizeProductQuantity>>;
      try {
        allocationQuantity = await normalizeProductQuantity({
          productId,
          quantity: allocationEnteredQuantity,
          uomId: normalizedQuantity.fromUomId,
          usage: "purchase",
          field: `lines[${index}].supplyAllocations[${allocationIndex}].quantity`,
        });
      } catch (error) {
        if (error instanceof ProductQuantityError) throw new RecordValidationError(error.code, error.message, error.status);
        throw error;
      }
      supplyAllocations.push({ salesOrderLineId, quantity: allocationQuantity.baseQuantity, enteredQuantity: allocationEnteredQuantity });
    }
    const sourceSalesOrderLineId = supplyAllocations[0]?.salesOrderLineId ?? null;
    if (input.type === "purchaseOrder") {
      if (linkedPurchaseOrderLineId) throw new RecordValidationError("SUPPLY_LINK_NOT_ALLOWED", `Line ${index + 1} cannot use linkedPurchaseOrderLineId on a purchase order.`);
      if (route === "stock" && supplyAllocations.length) throw new RecordValidationError("SUPPLY_LINK_NOT_ALLOWED", `Line ${index + 1} cannot allocate stock replenishment to customer demand.`);
      if (route !== "stock") {
        if (!supplyAllocations.length) throw new RecordValidationError("SUPPLY_LINK_REQUIRED", `Line ${index + 1} requires at least one quantity allocation for ${route}.`);
        if (new Set(supplyAllocations.map((allocation) => allocation.salesOrderLineId)).size !== supplyAllocations.length) {
          throw new RecordValidationError("DUPLICATE_SUPPLY_ALLOCATION", `Line ${index + 1} cannot allocate twice to the same sales-order line.`, 409);
        }
        const allocated = supplyAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
        if (allocated > quantity + 0.000001) throw new RecordValidationError("OVER_ALLOCATION", `Line ${index + 1} allocates ${allocated} base units from only ${quantity} ordered units.`, 409);
        if (route === "drop_ship" && supplyAllocations.length !== 1) throw new RecordValidationError("DROP_SHIP_ALLOCATION_AMBIGUOUS", "A drop-ship PO line must allocate to exactly one sales-order line.", 409);
      }
    }
    if (input.type === "salesOrder") {
      if (legacySourceSalesOrderLineId || supplyAllocations.length) throw new RecordValidationError("SUPPLY_LINK_NOT_ALLOWED", `Line ${index + 1} cannot define supply allocations on a sales order.`);
      if (linkedPurchaseOrderLineId) throw new RecordValidationError("SUPPLY_LINK_NOT_ALLOWED", `Line ${index + 1} cannot link supply from the sales-order side. Save the demand first, then create the dedicated purchase order from that sales line.`, 409);
    }
    const taxable = line.taxable !== false;
    const taxRateBps = basisPoints(line.taxRateBps, `lines[${index}].taxRateBps`);
    items.push({
      productId, productName: product.name, quantity, enteredQuantity, uomId: normalizedQuantity.fromUomId,
      uomCode: normalizedQuantity.fromUomCode, factorToBase: normalizedQuantity.factorToBase,
      unitAmountCents: unitAmount, enteredUnitAmountCents: enteredUnitAmount,
      discountCents, taxable, taxCode: normalizedTaxCode(line.taxCode, taxable, taxRateBps),
      taxRateBps,
      fulfillmentRoute: route,
      projectReference: typeof line.projectReference === "string" && line.projectReference.trim() ? line.projectReference.trim() : input.projectReference?.trim() || null,
      // The composer sends the product's physical attributes; when it cannot (the product was not on the
      // page it had loaded), derive the same text here so an edited draft never loses its configuration.
      configurationSnapshot: typeof line.configurationSnapshot === "string" && line.configurationSnapshot.trim() ? line.configurationSnapshot.trim()
        : [product.dimensions, product.finish, product.material].map((value) => typeof value === "string" ? value.trim() : "").filter((value) => value && !/^unspecified$/i.test(value)).join(" · ") || null,
      sourceSalesOrderLineId,supplyAllocations,linkedPurchaseOrderLineId,
    });
  }
  if (!items.length) throw new RecordValidationError("VALIDATION_ERROR", "At least one item line is required.");
  if (input.type === "purchaseOrder") {
    const requestedByDemand = new Map<string, { quantity: number; productId: string; route: NormalizedItem["fulfillmentRoute"] }>();
    for (const line of items) for (const allocation of line.supplyAllocations) {
      const requested = requestedByDemand.get(allocation.salesOrderLineId);
      requestedByDemand.set(allocation.salesOrderLineId, {
        quantity: (requested?.quantity ?? 0) + allocation.quantity,
        productId: line.productId,
        route: line.fulfillmentRoute,
      });
    }
    const editingId = input.editingPurchaseOrderId?.trim() ?? "";
    for (const [salesOrderLineId, requested] of requestedByDemand) {
      const demand = await first<{ productId: string; route: string; lifecycleStatus: string; demandQty: number; allocatedQty: number }>(`SELECT
          sol.product_id AS productId,sol.fulfillment_route AS route,so.lifecycle_status AS lifecycleStatus,
          sol.ordered_qty-sol.canceled_qty AS demandQty,
          COALESCE((SELECT SUM(sa.allocated_qty) FROM supply_allocations sa
            JOIN purchase_order_lines existing_line ON existing_line.id=sa.purchase_order_line_id
            WHERE sa.sales_order_line_id=sol.id AND sa.status='active' AND existing_line.purchase_order_id<>?),0) AS allocatedQty
        FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id WHERE sol.id=?`, editingId, salesOrderLineId);
      if (!demand || demand.productId !== requested.productId || demand.route !== requested.route || demand.lifecycleStatus === "canceled") {
        throw new RecordValidationError("SUPPLY_LINK_MISMATCH", `Allocation target ${salesOrderLineId} does not match the PO product and fulfillment route.`, 409);
      }
      if (demand.allocatedQty + requested.quantity > demand.demandQty + 0.000001) {
        throw new RecordValidationError("OVER_ALLOCATION", `Allocation target ${salesOrderLineId} has only ${Math.max(demand.demandQty - demand.allocatedQty, 0)} unallocated base units remaining.`, 409);
      }
      if (requested.route === "drop_ship" && demand.allocatedQty > 0) {
        throw new RecordValidationError("DROP_SHIP_ALLOCATION_AMBIGUOUS", "Drop-ship demand can be supplied by only one PO line.", 409);
      }
    }
  }
  return { items, charges };
}

export async function prepareOrderDraft(input: CreateOrderInput) {
  const { items, charges } = await normalizeOrderLines(input);
  const itemSubtotalCents = items.reduce((sum, line) => sum + Math.round(line.enteredQuantity * line.enteredUnitAmountCents) - line.discountCents, 0);
  const chargeSubtotalCents = charges.reduce((sum, charge) => sum + (charge.direction === "subtract" ? -charge.amountCents : charge.amountCents), 0);
  const taxCents = items.reduce((sum, line) => sum + (line.taxable ? Math.round(((line.enteredQuantity * line.enteredUnitAmountCents - line.discountCents) * line.taxRateBps) / 10000) : 0), 0)
    + charges.reduce((sum, charge) => sum + (charge.taxable ? (charge.direction === "subtract" ? -1 : 1) * Math.round((charge.amountCents * charge.taxRateBps) / 10000) : 0), 0);
  const totalCents = itemSubtotalCents + chargeSubtotalCents + taxCents;
  if (totalCents < 0) throw new RecordValidationError("VALIDATION_ERROR", "Charges and discounts cannot produce a negative order total.");
  return { items, charges, itemSubtotalCents, chargeSubtotalCents, taxCents, totalCents, quantity: items.reduce((sum, line) => sum + line.quantity, 0) };
}

export async function createOrderRecord(input: CreateOrderInput): Promise<CreateOrderResult> {
  await ensureDatabase();
  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
  const requestHash = input.requestHash ?? await hashOrderInput(input);
  const claimToken = crypto.randomUUID();
  const prior = await replay(idempotencyKey, requestHash);
  if (prior) return prior;
  if (input.type !== "purchaseOrder" && input.type !== "salesOrder") throw new RecordValidationError("VALIDATION_ERROR", "type must be purchaseOrder or salesOrder.");

  const actor = requiredText(input.actor, "server actor");
  const actorId = requiredText(input.actorId, "server actor id");
  const actorEmail = requiredText(input.actorEmail, "server actor email");
  const fastTrackApprovalReason = typeof input.fastTrackApprovalReason === "string" && input.fastTrackApprovalReason.trim()
    ? input.fastTrackApprovalReason.trim()
    : null;
  const fastTrack = fastTrackApprovalReason !== null;
  const projectReference = typeof input.projectReference === "string" && input.projectReference.trim() ? input.projectReference.trim() : null;
  const currency = typeof input.currency === "string" && input.currency.trim() ? input.currency.trim().toUpperCase() : "CAD";
  if (!/^[A-Z]{3}$/.test(currency)) throw new RecordValidationError("VALIDATION_ERROR", "currency must be a three-letter ISO code.");
  if (currency !== "CAD" && input.exchangeRateToBase == null) throw new RecordValidationError("EXCHANGE_RATE_REQUIRED", `Enter the ${currency}-to-CAD exchange rate.`);
  const exchangeRateToBase = input.exchangeRateToBase == null ? 1 : Number(input.exchangeRateToBase);
  if (!Number.isFinite(exchangeRateToBase) || exchangeRateToBase <= 0) throw new RecordValidationError("VALIDATION_ERROR", "exchangeRateToBase must be greater than zero.");
  if (currency === "CAD" && exchangeRateToBase !== 1) throw new RecordValidationError("EXCHANGE_RATE_MISMATCH", "CAD documents must use an exchange rate of 1.");
  const paymentTerms = typeof input.paymentTerms === "string" && input.paymentTerms.trim() ? input.paymentTerms.trim() : null;
  const dueDate = input.dueDate == null ? null : validDate(input.dueDate, "dueDate");
  const { items, charges, taxCents, totalCents, quantity } = await prepareOrderDraft(input);
  const baseTotalCents = Math.round(totalCents * exchangeRateToBase);
  const recordId = newId(input.type === "purchaseOrder" ? "po" : "so");
  const now = new Date().toISOString();
  const db = getD1();
  let result: CreateOrderResult;
  let statements: D1PreparedStatement[];

  if (input.type === "purchaseOrder") {
    const vendorId = requiredText(input.vendorId, "vendorId");
    const expectedDate = validDate(input.expectedDate, "expectedDate");
    const vendor = await first("SELECT id FROM business_partners WHERE id = ? AND partner_type IN ('vendor','both') AND active=1", vendorId);
    if (!vendor) throw new RecordValidationError("INVALID_VENDOR", "Select a valid vendor.", 404);
    const number = await nextDocumentNumber("PO");
    result = {
      recordId,
      number,
      message: fastTrack
        ? `${number} created and approved by its author with ${items.length} item line${items.length === 1 ? "" : "s"}; its ${quantity}-unit purchasing commitment is active incoming supply.`
        : `${number} saved as a draft with ${items.length} item line${items.length === 1 ? "" : "s"}; approval is required before its ${quantity}-unit purchasing commitment becomes incoming supply.`,
      impact: { physical: "On-hand inventory and the immutable movement ledger are unchanged.", commercial: fastTrack ? "Approved lines increase the incoming forecast immediately." : "Draft lines do not increase incoming forecast until approval.", financial: "Charges and tax are planned only; no vendor bill or payment was created.", onHandDelta: 0, incomingDelta: fastTrack ? quantity : 0, reservedDelta: 0, availableDelta: 0 },
    };
    const allocationDemand = new Map<string, { quantity: number; productId: string; route: string }>();
    for (const line of items) for (const allocation of line.supplyAllocations) {
      const current = allocationDemand.get(allocation.salesOrderLineId);
      allocationDemand.set(allocation.salesOrderLineId, { quantity: (current?.quantity ?? 0) + allocation.quantity, productId: line.productId, route: line.fulfillmentRoute });
    }
    const allocationClaims = [...allocationDemand.entries()].map(() => ` AND EXISTS (SELECT 1 FROM sales_order_lines sol
      JOIN sales_orders so ON so.id=sol.sales_order_id
      WHERE sol.id=? AND sol.product_id=? AND sol.fulfillment_route=? AND so.lifecycle_status<>'canceled'
        AND sol.ordered_qty-sol.canceled_qty-COALESCE((SELECT SUM(sa.allocated_qty) FROM supply_allocations sa WHERE sa.sales_order_line_id=sol.id AND sa.status='active'),0)>=?)`).join("");
    const allocationClaimValues = [...allocationDemand.entries()].flatMap(([salesOrderLineId, allocation]) => [salesOrderLineId, allocation.productId, allocation.route, allocation.quantity]);
    statements = [
      db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key, command, entity_id, response_json, request_hash, claim_token, created_at)
        SELECT ?, 'create_purchase_order', ?, ?, ?, ?, ? WHERE 1=1${allocationClaims}`).bind(idempotencyKey, recordId, JSON.stringify(result), requestHash, claimToken, now, ...allocationClaimValues),
      db.prepare(`INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,payment_terms,due_date,total_cents,buyer_name,project_reference,revision_number,version,created_at)
        SELECT ?,?,?,?,'not_billed',?,?,?,?,?,?,?,?,?,1,1,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
        .bind(recordId, number, vendorId, fastTrack ? "approved" : "draft", expectedDate, currency, exchangeRateToBase, baseTotalCents, paymentTerms, dueDate, totalCents, actor, projectReference, now, idempotencyKey, recordId, claimToken),
    ];
    const purchaseLines = items.map((line) => ({ line, lineId: newId("po-line") }));
    purchaseLines.forEach(({ line, lineId }) => {
      statements.push(db.prepare(`INSERT INTO purchase_order_lines
        (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,configuration_snapshot,fulfillment_route,source_sales_order_line_id,discount_cents,taxable,tax_code,tax_rate_bps)
        SELECT ?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
        .bind(lineId, recordId, line.productId, line.quantity, line.unitAmountCents, line.uomId, line.enteredQuantity, line.enteredUnitAmountCents, line.configurationSnapshot, line.fulfillmentRoute,line.sourceSalesOrderLineId,line.discountCents,line.taxable ? 1 : 0,line.taxCode,line.taxRateBps, idempotencyKey, recordId, claimToken));
      for (const allocation of line.supplyAllocations) {
        statements.push(db.prepare(`INSERT INTO supply_allocations
          (id,purchase_order_line_id,sales_order_line_id,allocated_qty,received_qty,status,created_at,updated_at,version)
          SELECT ?,?,?,?,0,'active',?,?,1 WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
          .bind(newId("allocation"), lineId, allocation.salesOrderLineId, allocation.quantity, now, now, idempotencyKey, recordId, claimToken));
        statements.push(db.prepare(`UPDATE sales_order_lines SET linked_purchase_order_line_id=COALESCE(linked_purchase_order_line_id,?)
          WHERE id=? AND product_id=? AND EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
          .bind(lineId, allocation.salesOrderLineId, line.productId, idempotencyKey, recordId, claimToken));
      }
    });
    statements.push(db.prepare(`INSERT INTO purchase_order_revisions (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
      SELECT ?,?,1,?,?,?, ?,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
      .bind(newId("revision"), recordId, fastTrack ? "approved" : "draft", JSON.stringify({ number, vendorId, expectedDate, items, charges, totalCents, currency, exchangeRateToBase }), fastTrackApprovalReason ?? "Initial draft", actor, now, idempotencyKey, recordId, claimToken));
    if (fastTrack) statements.push(db.prepare(`INSERT INTO approvals
      (id,entity_type,entity_id,request_type,status,requested_by,requested_reason,requested_at,decided_by,decision_reason,decided_at,metadata_json,version)
      SELECT ?,'purchase_order',?,'purchase_order_fast_track','approved',?,?,?,?,?,?,?,1
      WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
      .bind(newId("approval"), recordId, actor, fastTrackApprovalReason, now, actor, fastTrackApprovalReason, now, JSON.stringify({ selfAuthorized: true, actorId, actorEmail }), idempotencyKey, recordId, claimToken));
    if (fastTrack) statements.push(...await prepareApprovedPurchaseCostStatements({
      claim: { idempotencyKey, claimToken },
      actor: { label: actor, id: actorId, email: actorEmail },
      purchaseOrderId: recordId,
      purchaseOrderNumber: number,
      purchaseOrderRevision: 1,
      vendorId,
      currency,
      exchangeRateToBase,
      effectiveAt: now,
      eventType: "purchase_order_fast_track_approved",
      lines: purchaseLines.map(({ line, lineId }) => ({ id: lineId, productId: line.productId, quantity: line.quantity, unitCostCents: line.unitAmountCents, discountCents: line.discountCents })),
    }));
  } else {
    const customerId = requiredText(input.customerId, "customerId");
    const requestedDate = validDate(input.requestedDate, "requestedDate");
    const customer = await first<{ name: string; addressLine1: string | null; addressLine2: string | null; city: string | null; region: string | null; postalCode: string | null; country: string | null; partnerCurrency: string; creditLimitCents: number; creditHold: number; outstandingBaseCents: number }>(`SELECT bp.name,bp.address_line_1 AS addressLine1,bp.address_line_2 AS addressLine2,bp.city,bp.region,bp.postal_code AS postalCode,bp.country,
      bp.currency AS partnerCurrency,bp.credit_limit_cents AS creditLimitCents,bp.credit_hold AS creditHold,
      COALESCE((SELECT SUM(MAX(ci.base_total_cents-ROUND(ci.paid_cents*ci.exchange_rate_to_base)-
        COALESCE((SELECT SUM(cc.base_amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0),0))
        FROM customer_invoices ci WHERE ci.customer_id=bp.id AND ci.status<>'void'),0) AS outstandingBaseCents
      FROM business_partners bp WHERE bp.id = ? AND bp.partner_type IN ('customer','both') AND bp.active=1`, customerId);
    if (!customer) throw new RecordValidationError("INVALID_CUSTOMER", "Select a valid customer.", 404);
    const shipToName = typeof input.shipToName === "string" && input.shipToName.trim() ? input.shipToName.trim() : customer.name;
    const shipToAddressLine1 = typeof input.shipToAddressLine1 === "string" && input.shipToAddressLine1.trim() ? input.shipToAddressLine1.trim() : customer.addressLine1;
    const shipToAddressLine2 = typeof input.shipToAddressLine2 === "string" && input.shipToAddressLine2.trim() ? input.shipToAddressLine2.trim() : customer.addressLine2;
    const shipToCity = typeof input.shipToCity === "string" && input.shipToCity.trim() ? input.shipToCity.trim() : customer.city;
    const shipToRegion = typeof input.shipToRegion === "string" && input.shipToRegion.trim() ? input.shipToRegion.trim() : customer.region;
    const shipToPostalCode = typeof input.shipToPostalCode === "string" && input.shipToPostalCode.trim() ? input.shipToPostalCode.trim() : customer.postalCode;
    const shipToCountry = typeof input.shipToCountry === "string" && input.shipToCountry.trim() ? input.shipToCountry.trim().toUpperCase() : customer.country ?? "CA";
    const deliveryInstructions = typeof input.deliveryInstructions === "string" && input.deliveryInstructions.trim() ? input.deliveryInstructions.trim() : null;
    if (!shipToAddressLine1 || !shipToCity || !shipToRegion || !shipToPostalCode || !shipToCountry) throw new RecordValidationError("SHIP_TO_REQUIRED", "A complete ship-to address is required on the sales-order draft.");
    if (fastTrack) {
      if (Boolean(customer.creditHold)) throw new RecordValidationError("CREDIT_HOLD", "This customer is on credit hold. Remove the hold before confirming the sales order.", 409);
      if (customer.creditLimitCents > 0 && currency !== customer.partnerCurrency) {
        throw new RecordValidationError("CREDIT_CURRENCY_MISMATCH", `This customer's credit limit is denominated in ${customer.partnerCurrency}; use that currency for a credit-controlled sales order.`, 409);
      }
      const outstandingCreditCents = Math.round(customer.outstandingBaseCents / exchangeRateToBase);
      if (customer.creditLimitCents > 0 && outstandingCreditCents + totalCents > customer.creditLimitCents) {
        const exceededBy = (outstandingCreditCents + totalCents - customer.creditLimitCents) / 100;
        throw new RecordValidationError("CREDIT_LIMIT_EXCEEDED", `Confirming this order would exceed the customer's credit limit by ${exceededBy.toFixed(2)} ${customer.partnerCurrency}.`, 409);
      }
    }
    const number = await nextDocumentNumber("SO");
    result = {
      recordId,
      number,
      message: fastTrack
        ? `${number} created and confirmed by its author with ${items.length} item line${items.length === 1 ? "" : "s"}; its ${quantity} unit${quantity === 1 ? "" : "s"} are active customer demand.`
        : `${number} saved as a draft with ${items.length} item line${items.length === 1 ? "" : "s"}; confirmation is required before its ${quantity} unit${quantity === 1 ? "" : "s"} become${quantity === 1 ? "s" : ""} customer demand.`,
      impact: { physical: "On-hand inventory and the immutable movement ledger are unchanged.", commercial: fastTrack ? "Confirmed lines create active demand immediately; stock is not reserved automatically." : "Draft lines do not create active demand or reserve stock.", financial: "Charges and tax are planned only; no customer invoice or revenue posting was created.", onHandDelta: 0, incomingDelta: 0, reservedDelta: 0, availableDelta: 0 },
    };
    statements = [
      db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key, command, entity_id, response_json, request_hash, claim_token, created_at) VALUES (?, 'create_sales_order', ?, ?, ?, ?, ?)").bind(idempotencyKey, recordId, JSON.stringify(result), requestHash, claimToken, now),
      db.prepare(`INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,payment_terms,due_date,total_cents,owner_name,project_reference,ship_to_name,ship_to_address_line_1,ship_to_address_line_2,ship_to_city,ship_to_region,ship_to_postal_code,ship_to_country,delivery_instructions,version,created_at)
        SELECT ?,?,?,?,'not_invoiced',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
        .bind(recordId, number, customerId, fastTrack ? "confirmed" : "draft", requestedDate, currency, exchangeRateToBase, baseTotalCents, paymentTerms, dueDate, totalCents, actor, projectReference, shipToName, shipToAddressLine1, shipToAddressLine2, shipToCity, shipToRegion, shipToPostalCode, shipToCountry, deliveryInstructions, now, idempotencyKey, recordId, claimToken),
    ];
    items.forEach((line) => statements.push(db.prepare(`INSERT INTO sales_order_lines
      (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_price_cents,configuration_snapshot,fulfillment_route,project_reference,linked_purchase_order_line_id,discount_cents,taxable,tax_code,tax_rate_bps)
      SELECT ?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
      .bind(newId("so-line"), recordId, line.productId, line.quantity, line.unitAmountCents, line.uomId, line.enteredQuantity, line.enteredUnitAmountCents, line.configurationSnapshot, line.fulfillmentRoute, line.projectReference,line.linkedPurchaseOrderLineId, line.discountCents, line.taxable ? 1 : 0, line.taxCode, line.taxRateBps, idempotencyKey, recordId, claimToken)));
  }

  charges.forEach((charge) => statements.push(db.prepare(`INSERT INTO document_charges
    (id,document_type,document_id,charge_type,description,amount_cents,direction,taxable,refundable,tax_code,tax_rate_bps,tax_amount_cents,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
    .bind(newId("charge"), input.type === "purchaseOrder" ? "purchase_order" : "sales_order", recordId, charge.chargeType, charge.description, charge.amountCents, charge.direction, charge.taxable ? 1 : 0, charge.refundable ? 1 : 0, charge.taxCode, charge.taxRateBps, charge.taxable ? Math.round((charge.amountCents * charge.taxRateBps) / 10000) : 0, now, idempotencyKey, recordId, claimToken)));
  statements.push(
    db.prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
      SELECT ?,?,?,?, ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
      .bind(newId("audit"), input.type === "purchaseOrder" ? "purchase_order" : "sales_order", recordId, fastTrack ? input.type === "purchaseOrder" ? "purchase_order_fast_track_approved" : "sales_order_fast_track_confirmed" : input.type === "purchaseOrder" ? "purchase_order_draft_created" : "sales_order_draft_created", result.message, actor, actorId, actorEmail, JSON.stringify({ items, charges, totalCents, taxCents, projectReference, currency, exchangeRateToBase, paymentTerms, dueDate, fastTrack, approvalReason: fastTrackApprovalReason }), now, idempotencyKey, recordId, claimToken),
    db.prepare(`INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at)
      SELECT ?,?,?,?,?,'pending',0,?,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
      .bind(newId("outbox"), fastTrack ? input.type === "purchaseOrder" ? "purchase_order.approved" : "sales_order.confirmed" : input.type === "purchaseOrder" ? "purchase_order.draft_created" : "sales_order.draft_created", input.type === "purchaseOrder" ? "purchase_order" : "sales_order", recordId, JSON.stringify({ recordId, itemCount: items.length, totalCents, fastTrack }), now, now, idempotencyKey, recordId, claimToken)
  );

  await db.batch(statements);
  const committed = await replay(idempotencyKey, requestHash);
  if (!committed) throw new RecordValidationError("CREATE_CONFLICT", "The order could not be created. Retry with a new idempotency key.", 409);
  return committed;
}
