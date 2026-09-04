import { hasCapability, type ActorIdentity, type AppCapability } from "./auth";
import { all, commandD1, commandGuardSql, ensureDatabase, first, newId, nextDocumentNumber, roundQuantity } from "./inventory-db";
import { createOrderRecord, prepareOrderDraft, RecordValidationError, type CreateOrderInput } from "./inventory-records";
import { getInventorySnapshot, normalizeSnapshotPage, type SnapshotPage } from "./inventory-domain";
import { assertPeriodOpen } from "./policy";
import { normalizeProductQuantity, ProductQuantityError, validateBaseProductQuantity } from "./product-quantities";
import { prepareCanceledPurchaseCostStatements, prepareExistingApprovedPurchaseCostStatements, repriceAutomaticProducts, suggestedPriceForProduct } from "./catalog-pricing";

const unpagedAll = all;

export type WorkflowCommand = {
  command: string;
  entityId?: string;
  version?: number;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  actor: ActorIdentity;
  claimToken?: string;
  requestHash?: string;
  /** Trusted request origin used only for links in server-generated notifications. */
  appOrigin?: string;
};

export class WorkflowError extends Error {
  constructor(public code: string, message: string, public status = 400, public currentVersion?: number) { super(message); }
}

async function baseQuantity(productId: string, quantity: number, field = "quantity", allowZero = false) {
  try {
    return (await validateBaseProductQuantity(productId, quantity, field, allowZero)).baseQuantity;
  } catch (error) {
    if (error instanceof ProductQuantityError) throw new WorkflowError(error.code, error.message, error.status);
    throw error;
  }
}

type WorkflowResult = { message: string; impact: Record<string, unknown>; recordId?: string };

const normalize = (value: string) => value.toLowerCase().replaceAll(/[_\s-]/g, "");
const today = () => new Date().toISOString().slice(0, 10);
const timestampOnDate = (postingDate: string, recordedAt = new Date().toISOString()) => `${postingDate}${recordedAt.slice(10)}`;

export const workflowCapabilities = {
  // Draft authoring and submission create no stock or financial posting. Every authenticated
  // user with read access may prepare a purchasing request; approval remains manager-gated.
  createPurchaseOrderDraft: "read",
  createApprovedPurchaseOrder: "approve",
  updatePurchaseOrderDraft: "read",
  cancelPurchaseOrder: "operationalWrite",
  createSalesOrderDraft: "operationalWrite",
  createConfirmedSalesOrder: "approve",
  updateSalesOrderDraft: "operationalWrite",
  confirmSalesOrder: "operationalWrite",
  cancelSalesOrder: "operationalWrite",
  submitPurchaseOrder: "read",
  approvePurchaseOrder: "approve",
  rejectPurchaseOrder: "approve",
  markPurchaseOrderOrdered: "operationalWrite",
  amendPurchaseOrder: "operationalWrite",
  requestOverReceiptApproval: "operationalWrite",
  requestApproval: "operationalWrite",
  approveApproval: "approve",
  rejectApproval: "approve",
  transferInventory: "operationalWrite",
  receiveTransfer: "operationalWrite",
  changeInventoryStatus: "operationalWrite",
  scrapInventory: "operationalWrite",
  releaseReservation: "operationalWrite",
  reallocateReservation: "operationalWrite",
  reverseShipment: "operationalWrite",
  registerInventoryIdentity: "operationalWrite",
  postDropShipDelivery: "operationalWrite",
  reverseDropShipDelivery: "operationalWrite",
  createVendorBill: "financialWrite",
  createApprovedVendorBill: "approve",
  approveVendorBill: "approve",
  createVendorCredit: "financialWrite",
  voidVendorBill: "financialWrite",
  createCustomerInvoice: "financialWrite",
  createCustomerCredit: "financialWrite",
  voidCustomerInvoice: "financialWrite",
  recordPayment: "financialWrite",
  addDocumentCharge: "financialWrite",
  issueReturnable: "operationalWrite",
  returnReturnable: "operationalWrite",
  forfeitReturnable: "operationalWrite",
  refundReturnableDeposit: "financialWrite",
  updatePolicy: "administer",
  lockPeriod: "administer",
  unlockPeriod: "administer",
  setValuationPolicy: "administer",
  allocateLandedCost: "financialWrite",
  updateUserRole: "administer",
  createPartnerAddress: "operationalWrite",
  updatePartnerAddress: "operationalWrite",
  deactivatePartnerAddress: "operationalWrite",
  createBusinessPartner: "approve",
  updateBusinessPartner: "approve",
  deactivateBusinessPartner: "approve",
  createSalesPerson: "approve",
  updateSalesPerson: "approve",
  mergeBusinessPartners: "administer",
  createProduct: "approve",
  updateProduct: "approve",
  deactivateProduct: "approve",
  addProductAlias: "approve",
  removeProductAlias: "approve",
  setProductDefaultLocation: "approve",
  mergeProducts: "administer",
  mergePurchaseOrders: "operationalWrite",
  createUnitOfMeasure: "administer",
  createUomConversion: "administer",
  configureProductPurchaseUnit: "administer",
  createPriceList: "administer",
  updatePriceList: "administer",
  deactivatePriceList: "administer",
  assignPriceList: "administer",
  updatePriceListAssignment: "administer",
  deactivatePriceListAssignment: "administer",
  createPriceListEntry: "administer",
  updatePriceListEntry: "administer",
  deactivatePriceListEntry: "administer",
  createMarginRule: "administer",
  updateMarginRule: "administer",
  deactivateMarginRule: "administer",
  adoptMarginMatrixForCatalog: "administer",
  updateProductPricing: "approve",
  createWarehouse: "approve",
  updateWarehouse: "approve",
  deactivateWarehouse: "approve",
  createLocation: "approve",
  updateLocation: "approve",
  deactivateLocation: "approve",
  restoreLegacyLocation: "administer",
  createReturnableAssetType: "approve",
  updateReturnableAssetType: "approve",
  deactivateReturnableAssetType: "approve",
} as const satisfies Record<string, AppCapability>;

const workflowCapabilityByCommand = new Map(
  Object.entries(workflowCapabilities).map(([command, capability]) => [normalize(command), capability] as const),
);

export function workflowCapability(command: string): AppCapability | undefined {
  return workflowCapabilityByCommand.get(normalize(command));
}

function textValue(payload: Record<string, unknown>, key: string, fallback?: string) {
  const value = typeof payload[key] === "string" ? payload[key].trim() : "";
  if (!value && fallback == null) throw new WorkflowError("VALIDATION_ERROR", `${key} is required.`);
  return value || fallback!;
}

function numberValue(payload: Record<string, unknown>, key: string, { positive = true, integer = false } = {}) {
  const value = Number(payload[key]);
  if (!Number.isFinite(value) || (positive && value <= 0) || (integer && !Number.isSafeInteger(value))) {
    throw new WorkflowError("VALIDATION_ERROR", `${key} must be ${positive ? "positive" : "numeric"}${integer ? " whole-number" : ""}.`);
  }
  return value;
}

function dateValue(payload: Record<string, unknown>, key: string, fallback?: string) {
  const value = textValue(payload, key, fallback);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new WorkflowError("VALIDATION_ERROR", `${key} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

function optionalDateValue(payload: Record<string, unknown>, key: string) {
  const value = typeof payload[key] === "string" ? payload[key].trim() : "";
  return value ? dateValue({ [key]: value }, key) : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function hashCommand(command: WorkflowCommand) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson({ command: normalize(command.command), entityId: command.entityId, version: command.version, payload: command.payload })));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function replay(command: WorkflowCommand) {
  const stored = await first<{ responseJson: string; requestHash: string | null }>("SELECT response_json AS responseJson, request_hash AS requestHash FROM command_log WHERE idempotency_key=?", command.idempotencyKey);
  if (!stored) return null;
  if (stored.requestHash && command.requestHash && stored.requestHash !== command.requestHash) throw new WorkflowError("IDEMPOTENCY_CONFLICT", "This idempotency key belongs to a different workflow request.", 409);
  return JSON.parse(stored.responseJson) as WorkflowResult;
}

function marker(command: WorkflowCommand) {
  void command;
  return commandGuardSql();
}

function auditStatement(command: WorkflowCommand, entityType: string, entityId: string, action: string, summary: string, metadata: unknown, when = new Date().toISOString()) {
  return commandD1(command).prepare(`INSERT INTO audit_events
    (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${marker(command)}`)
    .bind(newId("audit"), entityType, entityId, action, summary, command.actor.label, command.actor.id, command.actor.email, JSON.stringify(metadata), when);
}

function outboxStatement(command: WorkflowCommand, eventType: string, aggregateType: string, aggregateId: string, payload: unknown, when = new Date().toISOString()) {
  return commandD1(command).prepare(`INSERT INTO outbox_events
    (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at)
    SELECT ?,?,?,?,?,'pending',0,?,? WHERE ${marker(command)}`)
    .bind(newId("outbox"), eventType, aggregateType, aggregateId, JSON.stringify(payload), when, when);
}

function claimValues(command: WorkflowCommand, result: WorkflowResult, entityId: string) {
  return [command.idempotencyKey, command.command, entityId, JSON.stringify(result), command.requestHash ?? null, command.claimToken ?? null, new Date().toISOString()] as const;
}

async function finish(command: WorkflowCommand) {
  const result = await replay(command);
  if (!result) throw new WorkflowError("VERSION_CONFLICT", "The record changed before this workflow command could commit.", 409);
  return result;
}

async function setting<T>(key: string, fallback: T): Promise<T> {
  const row = await first<{ valueJson: string }>("SELECT value_json AS valueJson FROM system_settings WHERE key=?", key);
  if (!row) return fallback;
  try { return JSON.parse(row.valueJson) as T; } catch { return fallback; }
}

type NormalizedCharge = {
  chargeType: string;
  description: string;
  amount: number;
  direction: "add" | "subtract";
  taxable: boolean;
  refundable: boolean;
  taxCode: string | null;
  taxRate: number;
  taxAmount: number;
  subtotalDelta: number;
  taxDelta: number;
  totalDelta: number;
};

const supportedChargeTypes = new Set([
  "freight",
  "fee",
  "handling_fee",
  "fuel_surcharge",
  "environmental_fee",
  "handling",
  "customs",
  "brokerage",
  "discount",
  "tax_adjustment",
  "core_deposit",
  "empty_deposit",
  "returnable_deposit",
  "other",
]);
const refundableChargeTypes = new Set(["core_deposit", "empty_deposit", "returnable_deposit"]);

function normalizeChargePayload(payload: Record<string, unknown>): NormalizedCharge {
  const chargeType = textValue(payload, "chargeType").toLowerCase();
  if (!supportedChargeTypes.has(chargeType)) {
    throw new WorkflowError("INVALID_CHARGE_TYPE", `chargeType must be one of: ${[...supportedChargeTypes].join(", ")}.`);
  }
  const description = textValue(payload, "description");
  const amount = numberValue(payload, "amountCents", { integer: true });
  const direction = payload.direction === "subtract" ? "subtract" : "add";
  if (chargeType === "discount" && direction !== "subtract") {
    throw new WorkflowError("INVALID_CHARGE_DIRECTION", "Discount charges must subtract from the document total.");
  }
  if (refundableChargeTypes.has(chargeType) && direction !== "add") {
    throw new WorkflowError("INVALID_CHARGE_DIRECTION", "Refundable deposit charges must add to the document total; use a credit or refund to reduce them.");
  }
  const refundable = payload.refundable === true;
  if (refundable !== refundableChargeTypes.has(chargeType)) {
    throw new WorkflowError(
      "INVALID_REFUNDABLE_CHARGE",
      refundableChargeTypes.has(chargeType)
        ? `${chargeType} must be marked refundable.`
        : "Only core, empty, and returnable deposits may be marked refundable."
    );
  }
  const taxable = payload.taxable === true;
  const taxRate = payload.taxRateBps == null ? 0 : numberValue(payload, "taxRateBps", { positive: false, integer: true });
  if (taxRate < 0 || taxRate > 10_000) throw new WorkflowError("VALIDATION_ERROR", "taxRateBps must be 0-10000.");
  if (!taxable && taxRate !== 0) throw new WorkflowError("VALIDATION_ERROR", "A non-taxable charge must use a zero tax rate.");
  const sign = direction === "subtract" ? -1 : 1;
  const taxAmount = taxable ? Math.round(amount * taxRate / 10_000) : 0;
  return {
    chargeType,
    description,
    amount,
    direction,
    taxable,
    refundable,
    taxCode: optionalText(payload, "taxCode"),
    taxRate,
    taxAmount,
    subtotalDelta: sign * amount,
    taxDelta: sign * taxAmount,
    totalDelta: sign * (amount + taxAmount),
  };
}

function validateDocumentCurrency(value: unknown, expected: string) {
  if (value == null || value === "") return expected;
  const currency = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new WorkflowError("VALIDATION_ERROR", "currency must be a three-letter ISO code.");
  if (currency !== expected) {
    throw new WorkflowError("CURRENCY_MISMATCH", `The document currency must remain ${expected}; use exchangeRateToBase for base-currency conversion.`, 409);
  }
  return currency;
}

function validateDocumentExchange(value: unknown, expected: number) {
  if (value == null || value === "") return expected;
  const exchange = Number(value);
  if (!Number.isFinite(exchange) || exchange <= 0) throw new WorkflowError("VALIDATION_ERROR", "exchangeRateToBase must be greater than zero.");
  if (Math.abs(exchange - expected) > 0.000000001) throw new WorkflowError("EXCHANGE_RATE_MISMATCH", "Financial documents and their settlements must retain the source document exchange rate.", 409);
  return expected;
}

function validateOrderExchange(currency: string, value: unknown) {
  if (currency !== "CAD" && (value == null || value === "")) throw new WorkflowError("EXCHANGE_RATE_REQUIRED", `Enter the ${currency}-to-CAD exchange rate.`);
  const exchange = value == null || value === "" ? 1 : Number(value);
  if (!Number.isFinite(exchange) || exchange <= 0) throw new WorkflowError("VALIDATION_ERROR", "exchangeRateToBase must be greater than zero.");
  if (currency === "CAD" && exchange !== 1) throw new WorkflowError("EXCHANGE_RATE_MISMATCH", "CAD documents must use an exchange rate of 1.");
  return exchange;
}

function assertFastTrackAuthority(command: WorkflowCommand, authorCapability: "operationalWrite" | "financialWrite") {
  if (!hasCapability(command.actor, authorCapability) || !hasCapability(command.actor, "approve")) {
    throw new WorkflowError("FAST_TRACK_FORBIDDEN", "Fast-track creation requires both document-authoring and approval authority.", 403);
  }
}

async function createDraft(command: WorkflowCommand, type: "purchaseOrder" | "salesOrder", fastTrack = false) {
  const payload = command.payload ?? {};
  if (fastTrack) assertFastTrackAuthority(command, "operationalWrite");
  const fastTrackApprovalReason = fastTrack ? textValue(payload, "approvalReason") : undefined;
  try {
    return await createOrderRecord({
      ...(payload as Omit<CreateOrderInput, "type" | "idempotencyKey">),
      type,
      idempotencyKey: command.idempotencyKey,
      actor: command.actor.label,
      actorId: command.actor.id,
      actorEmail: command.actor.email,
      requestHash: command.requestHash,
      fastTrackApprovalReason,
      appOrigin: command.appOrigin,
    } as CreateOrderInput);
  } catch (error) {
    if (error instanceof RecordValidationError) throw new WorkflowError(error.code, error.message, error.status);
    throw error;
  }
}

async function updateSalesOrderDraft(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const payload = command.payload ?? {};
  const version = command.version ?? 0;
  const current = await first<{ status: string; version: number; number: string }>("SELECT lifecycle_status AS status,version,number FROM sales_orders WHERE id=?", id);
  if (!current) throw new WorkflowError("NOT_FOUND", "Sales order was not found.", 404);
  if (current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Sales order changed; refresh before editing the draft.", 409, current.version);
  if (current.status !== "draft") throw new WorkflowError("INVALID_STATE", "Only draft sales orders can be edited.", 409, current.version);
  if (await first(`SELECT sol.id FROM sales_order_lines sol
    WHERE sol.sales_order_id=? AND EXISTS (SELECT 1 FROM supply_allocations sa WHERE sa.sales_order_line_id=sol.id AND sa.status='active') LIMIT 1`, id)) {
    throw new WorkflowError("SUPPLY_COMMITMENT_EXISTS", "Cancel the linked purchase order before replacing sales-order lines that have dedicated supply.", 409, current.version);
  }
  const customerId = textValue(payload, "customerId");
  const customer = await first<{ name: string; addressLine1: string | null; addressLine2: string | null; city: string | null; region: string | null; postalCode: string | null; country: string | null }>("SELECT name,address_line_1 AS addressLine1,address_line_2 AS addressLine2,city,region,postal_code AS postalCode,country FROM business_partners WHERE id=? AND partner_type IN ('customer','both') AND active=1", customerId);
  if (!customer) throw new WorkflowError("INVALID_CUSTOMER", "Select a valid active customer.", 404);
  const salesPersonId = optionalText(payload, "salesPersonId");
  const salesPerson = salesPersonId ? await first<{ name: string }>("SELECT name FROM sales_people WHERE id=? AND active=1", salesPersonId) : null;
  if (salesPersonId && !salesPerson) throw new WorkflowError("INVALID_SALES_PERSON", "Select a valid active salesperson.", 404);
  const requestedDate = dateValue(payload, "requestedDate");
  const currency = textValue(payload, "currency", "CAD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new WorkflowError("VALIDATION_ERROR", "currency must be a three-letter ISO code.");
  const exchangeRateToBase = validateOrderExchange(currency, payload.exchangeRateToBase);
  const paymentTerms = optionalText(payload, "paymentTerms");
  const dueDate = payload.dueDate == null || payload.dueDate === "" ? null : dateValue(payload, "dueDate");
  const projectReference = optionalText(payload, "projectReference");
  const notes = documentNotes(payload);
  const shipToName = optionalText(payload, "shipToName") ?? customer.name;
  const shipToAddressLine1 = optionalText(payload, "shipToAddressLine1") ?? customer.addressLine1 ?? "";
  const shipToAddressLine2 = optionalText(payload, "shipToAddressLine2") ?? customer.addressLine2 ?? "";
  const shipToCity = optionalText(payload, "shipToCity") ?? customer.city ?? "";
  const shipToRegion = optionalText(payload, "shipToRegion") ?? customer.region ?? "";
  const shipToPostalCode = optionalText(payload, "shipToPostalCode") ?? customer.postalCode ?? "";
  const shipToCountry = (optionalText(payload, "shipToCountry") ?? customer.country ?? "CA").toUpperCase();
  const deliveryInstructions = optionalText(payload, "deliveryInstructions");
  if (!shipToAddressLine1 || !shipToCity || !shipToRegion || !shipToPostalCode || !shipToCountry) throw new WorkflowError("SHIP_TO_REQUIRED", "A complete ship-to address is required on the sales-order draft.");
  let prepared: Awaited<ReturnType<typeof prepareOrderDraft>>;
  try {
    prepared = await prepareOrderDraft({ ...(payload as Omit<CreateOrderInput, "type" | "idempotencyKey">), type: "salesOrder", idempotencyKey: command.idempotencyKey });
  } catch (error) {
    if (error instanceof RecordValidationError) throw new WorkflowError(error.code, error.message, error.status);
    throw error;
  }
  // Charges the composer does not manage (added with addDocumentCharge) survive a line edit and
  // keep counting toward the order total; only composer-owned kinds are rebuilt from the payload.
  const composerChargeKinds = [...new Set(["freight", "fee", "handling_fee", "returnable_deposit", ...prepared.charges.map((charge) => charge.chargeType)])];
  const retainedCharges = (await all<{ chargeType: string; amount: number; direction: string; taxAmount: number }>(
    "SELECT charge_type AS chargeType,amount_cents AS amount,direction,tax_amount_cents AS taxAmount FROM document_charges WHERE document_type='sales_order' AND document_id=?", id,
  )).filter((charge) => !composerChargeKinds.includes(charge.chargeType));
  const retainedChargeCents = retainedCharges.reduce((sum, charge) => sum + (charge.direction === "subtract" ? -1 : 1) * (Number(charge.amount) + Math.abs(Number(charge.taxAmount))), 0);
  const totalCents = prepared.totalCents + retainedChargeCents;
  if (totalCents < 0) throw new WorkflowError("INVALID_DOCUMENT_TOTAL", "Order charges and discounts cannot make the sales-order total negative.");
  const baseTotalCents = Math.round(totalCents * exchangeRateToBase);
  const result: WorkflowResult = {
    recordId: id,
    message: `${current.number} draft updated with ${prepared.items.length} item line${prepared.items.length === 1 ? "" : "s"}.`,
    impact: { physical: "No stock movement.", commercial: "Draft demand remains inactive until confirmation.", financial: "Draft pricing changed; no invoice or revenue posting was created.", onHandDelta: 0 },
  };
  const db = commandD1(command);
  const when = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM sales_orders so WHERE so.id=? AND so.version=? AND so.lifecycle_status='draft'
      AND NOT EXISTS (SELECT 1 FROM reservations r JOIN sales_order_lines sol ON sol.id=r.sales_order_line_id WHERE sol.sales_order_id=so.id AND r.status='active')
      AND NOT EXISTS (SELECT 1 FROM shipments sh WHERE sh.sales_order_id=so.id)
      AND NOT EXISTS (SELECT 1 FROM customer_invoices ci WHERE ci.sales_order_id=so.id AND ci.status<>'void')
      AND NOT EXISTS (SELECT 1 FROM sales_order_lines sol WHERE sol.sales_order_id=so.id
        AND EXISTS (SELECT 1 FROM supply_allocations sa WHERE sa.sales_order_line_id=sol.id AND sa.status='active'))`)
      .bind(...claimValues(command, result, id), id, version),
    db.prepare(`UPDATE sales_orders SET customer_id=?,sales_person_id=?,owner_name=?,requested_date=?,currency=?,exchange_rate_to_base=?,base_total_cents=?,payment_terms=?,due_date=?,total_cents=?,project_reference=?,ship_to_name=?,ship_to_address_line_1=?,ship_to_address_line_2=?,ship_to_city=?,ship_to_region=?,ship_to_postal_code=?,ship_to_country=?,delivery_instructions=?,notes=?,version=version+1
      WHERE id=? AND version=? AND lifecycle_status='draft' AND ${marker(command)}`)
      .bind(customerId, salesPersonId, salesPerson?.name ?? command.actor.label, requestedDate, currency, exchangeRateToBase, baseTotalCents, paymentTerms, dueDate, totalCents, projectReference, shipToName, shipToAddressLine1, shipToAddressLine2, shipToCity, shipToRegion, shipToPostalCode, shipToCountry, deliveryInstructions, notes, id, version),
    db.prepare(`DELETE FROM document_charges WHERE document_type='sales_order' AND document_id=? AND charge_type IN (SELECT value FROM json_each(?)) AND ${marker(command)}`).bind(id, JSON.stringify(composerChargeKinds)),
    db.prepare(`DELETE FROM sales_order_lines WHERE sales_order_id=? AND ${marker(command)}`).bind(id),
  ];
  for (const line of prepared.items) statements.push(db.prepare(`INSERT INTO sales_order_lines
    (id,sales_order_id,product_id,bin_location_id,ordered_qty,canceled_qty,unit_price_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_price_cents,configuration_snapshot,fulfillment_route,project_reference,linked_purchase_order_line_id,discount_cents,taxable,tax_code,tax_rate_bps)
    SELECT ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${marker(command)}`)
    .bind(newId("so-line"), id, line.productId, line.binLocationId, line.quantity, line.unitAmountCents, line.uomId, line.enteredQuantity, line.enteredUnitAmountCents, line.configurationSnapshot, line.fulfillmentRoute, line.projectReference, line.linkedPurchaseOrderLineId, line.discountCents, line.taxable ? 1 : 0, line.taxCode, line.taxRateBps));
  for (const charge of prepared.charges) statements.push(db.prepare(`INSERT INTO document_charges
    (id,document_type,document_id,charge_type,description,amount_cents,direction,taxable,refundable,tax_code,tax_rate_bps,tax_amount_cents,created_at)
    SELECT ?,'sales_order',?,?,?,?,?,?,?,?,?,?,? WHERE ${marker(command)}`)
    .bind(newId("charge"), id, charge.chargeType, charge.description, charge.amountCents, charge.direction, charge.taxable ? 1 : 0, charge.refundable ? 1 : 0, charge.taxCode, charge.taxRateBps, charge.taxable ? Math.round(charge.amountCents * charge.taxRateBps / 10_000) : 0, when));
  statements.push(
    auditStatement(command, "sales_order", id, "draft_updated", result.message, { customerId, salesPersonId, requestedDate, notes, itemCount: prepared.items.length, totalCents, retainedChargeCount: retainedCharges.length, currency }, when),
    outboxStatement(command, "sales_order.draft_updated", "sales_order", id, { itemCount: prepared.items.length, totalCents }, when),
  );
  await db.batch(statements);
  return finish(command);
}

async function updatePurchaseOrderDraft(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const payload = command.payload ?? {};
  const version = command.version ?? 0;
  const current = await first<{ status: string; version: number; number: string; revision: number }>(
    "SELECT lifecycle_status AS status,version,number,revision_number AS revision FROM purchase_orders WHERE id=?",
    id,
  );
  if (!current) throw new WorkflowError("NOT_FOUND", "Purchase order was not found.", 404);
  if (current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Purchase order changed; refresh before editing the draft.", 409, current.version);
  // A rejected order is edited like a draft: the rejected revision stays on file and the edit
  // becomes the next revision, so resubmission carries the reviewer's history forward.
  if (current.status !== "draft" && current.status !== "rejected") throw new WorkflowError("INVALID_STATE", "Only draft or rejected purchase orders can be edited.", 409, current.version);
  const reopeningRejected = current.status === "rejected";

  const vendorId = textValue(payload, "vendorId");
  if (!await first("SELECT id FROM business_partners WHERE id=? AND partner_type IN ('vendor','both') AND active=1", vendorId)) {
    throw new WorkflowError("INVALID_VENDOR", "Select a valid active vendor.", 404);
  }
  const expectedDate = dateValue(payload, "expectedDate");
  const currency = textValue(payload, "currency", "CAD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new WorkflowError("VALIDATION_ERROR", "currency must be a three-letter ISO code.");
  const exchangeRateToBase = validateOrderExchange(currency, payload.exchangeRateToBase);
  const paymentTerms = optionalText(payload, "paymentTerms");
  const dueDate = payload.dueDate == null || payload.dueDate === "" ? null : dateValue(payload, "dueDate");
  const projectReference = optionalText(payload, "projectReference");
  const notes = documentNotes(payload);
  let prepared: Awaited<ReturnType<typeof prepareOrderDraft>>;
  try {
    prepared = await prepareOrderDraft({ ...(payload as Omit<CreateOrderInput, "type" | "idempotencyKey">), type: "purchaseOrder", idempotencyKey: command.idempotencyKey, editingPurchaseOrderId: id });
  } catch (error) {
    if (error instanceof RecordValidationError) throw new WorkflowError(error.code, error.message, error.status);
    throw error;
  }
  // The composer only ever owns freight, fee, and refundable-deposit charges (plus whatever kinds it
  // is sending now). Charges of other kinds were added deliberately with addDocumentCharge and must
  // survive a line edit and still count toward the order total.
  const composerChargeKinds = [...new Set(["freight", "fee", "handling_fee", "returnable_deposit", ...prepared.charges.map((charge) => charge.chargeType)])];
  const retainedCharges = (await all<{ chargeType: string; amount: number; direction: string; taxAmount: number }>(
    "SELECT charge_type AS chargeType,amount_cents AS amount,direction,tax_amount_cents AS taxAmount FROM document_charges WHERE document_type='purchase_order' AND document_id=?", id,
  )).filter((charge) => !composerChargeKinds.includes(charge.chargeType));
  const retainedChargeCents = retainedCharges.reduce((sum, charge) => sum + (charge.direction === "subtract" ? -1 : 1) * (Number(charge.amount) + Math.abs(Number(charge.taxAmount))), 0);
  const totalCents = prepared.totalCents + retainedChargeCents;
  if (totalCents < 0) throw new WorkflowError("INVALID_DOCUMENT_TOTAL", "Order charges and discounts cannot make the purchase-order total negative.");
  const baseTotalCents = Math.round(totalCents * exchangeRateToBase);
  const revisionHead = reopeningRejected ? await first<{ revision: number }>("SELECT COALESCE(MAX(revision_number),0) AS revision FROM purchase_order_revisions WHERE purchase_order_id=?", id) : null;
  const revisionNumber = reopeningRejected ? Math.max(current.revision, Number(revisionHead?.revision ?? 0)) + 1 : current.revision;
  const result: WorkflowResult = {
    recordId: id,
    message: `${current.number} draft updated with ${prepared.items.length} item line${prepared.items.length === 1 ? "" : "s"}${reopeningRejected ? ` as revision ${revisionNumber}` : ""}.`,
    impact: { physical: "No stock movement.", commercial: "Draft supply remains inactive until approval.", financial: "Draft pricing changed; no payable was created.", onHandDelta: 0 },
  };
  const db = commandD1(command);
  const when = new Date().toISOString();
  const allocationDemand = new Map<string, { quantity: number; productId: string; route: string }>();
  for (const line of prepared.items) for (const allocation of line.supplyAllocations) {
    const currentAllocation = allocationDemand.get(allocation.salesOrderLineId);
    allocationDemand.set(allocation.salesOrderLineId, { quantity: (currentAllocation?.quantity ?? 0) + allocation.quantity, productId: line.productId, route: line.fulfillmentRoute });
  }
  const allocationClaims = [...allocationDemand].map(() => ` AND EXISTS (SELECT 1 FROM sales_order_lines sol
    JOIN sales_orders so ON so.id=sol.sales_order_id
    WHERE sol.id=? AND sol.product_id=? AND sol.fulfillment_route=? AND so.lifecycle_status<>'canceled'
      AND sol.ordered_qty-sol.canceled_qty-COALESCE((SELECT SUM(sa.allocated_qty) FROM supply_allocations sa
        JOIN purchase_order_lines other_line ON other_line.id=sa.purchase_order_line_id
        WHERE sa.sales_order_line_id=sol.id AND sa.status='active' AND other_line.purchase_order_id<>?),0)>=?)`).join("");
  const allocationClaimValues = [...allocationDemand].flatMap(([salesOrderLineId, allocation]) => [salesOrderLineId, allocation.productId, allocation.route, id, allocation.quantity]);
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM purchase_orders po WHERE po.id=? AND po.version=? AND po.lifecycle_status=?
      AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.purchase_order_id=po.id)
      AND NOT EXISTS (SELECT 1 FROM vendor_bills vb WHERE vb.purchase_order_id=po.id AND vb.status<>'void')
      AND NOT EXISTS (SELECT 1 FROM purchase_order_revisions rev WHERE rev.purchase_order_id=po.id AND rev.revision_number=? AND rev.lifecycle_status<>?)${allocationClaims}`)
      .bind(...claimValues(command, result, id), id, version, current.status, revisionNumber, current.status, ...allocationClaimValues),
    db.prepare(`UPDATE purchase_orders SET vendor_id=?,expected_date=?,currency=?,exchange_rate_to_base=?,base_total_cents=?,payment_terms=?,due_date=?,total_cents=?,project_reference=?,notes=?,lifecycle_status='draft',revision_number=?,version=version+1
      WHERE id=? AND version=? AND lifecycle_status=? AND ${marker(command)}`)
      .bind(vendorId, expectedDate, currency, exchangeRateToBase, baseTotalCents, paymentTerms, dueDate, totalCents, projectReference, notes, revisionNumber, id, version, current.status),
    db.prepare(`UPDATE sales_order_lines SET linked_purchase_order_line_id=NULL WHERE linked_purchase_order_line_id IN (SELECT id FROM purchase_order_lines WHERE purchase_order_id=?) AND ${marker(command)}`).bind(id),
    db.prepare(`DELETE FROM document_charges WHERE document_type='purchase_order' AND document_id=? AND charge_type IN (SELECT value FROM json_each(?)) AND ${marker(command)}`).bind(id, JSON.stringify(composerChargeKinds)),
    db.prepare(`DELETE FROM purchase_order_lines WHERE purchase_order_id=? AND ${marker(command)}`).bind(id),
  ];
  for (const line of prepared.items) {
    const lineId = newId("po-line");
    statements.push(db.prepare(`INSERT INTO purchase_order_lines
      (id,purchase_order_id,product_id,bin_location_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,configuration_snapshot,fulfillment_route,source_sales_order_line_id,discount_cents,taxable,tax_code,tax_rate_bps)
      SELECT ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${marker(command)}`)
      .bind(lineId, id, line.productId, line.binLocationId, line.quantity, line.unitAmountCents, line.uomId, line.enteredQuantity, line.enteredUnitAmountCents, line.configurationSnapshot, line.fulfillmentRoute, line.sourceSalesOrderLineId, line.discountCents, line.taxable ? 1 : 0, line.taxCode, line.taxRateBps));
    for (const allocation of line.supplyAllocations) {
      statements.push(db.prepare(`INSERT INTO supply_allocations
        (id,purchase_order_line_id,sales_order_line_id,allocated_qty,received_qty,status,created_at,updated_at,version)
        SELECT ?,?,?,?,0,'active',?,?,1 WHERE ${marker(command)}`)
        .bind(newId("allocation"), lineId, allocation.salesOrderLineId, allocation.quantity, when, when));
      statements.push(db.prepare(`UPDATE sales_order_lines SET linked_purchase_order_line_id=COALESCE(linked_purchase_order_line_id,?) WHERE id=? AND product_id=? AND ${marker(command)}`)
        .bind(lineId, allocation.salesOrderLineId, line.productId));
    }
  }
  for (const charge of prepared.charges) statements.push(db.prepare(`INSERT INTO document_charges
    (id,document_type,document_id,charge_type,description,amount_cents,direction,taxable,refundable,tax_code,tax_rate_bps,tax_amount_cents,created_at)
    SELECT ?,'purchase_order',?,?,?,?,?,?,?,?,?,?,? WHERE ${marker(command)}`)
    .bind(newId("charge"), id, charge.chargeType, charge.description, charge.amountCents, charge.direction, charge.taxable ? 1 : 0, charge.refundable ? 1 : 0, charge.taxCode, charge.taxRateBps, charge.taxable ? Math.round(charge.amountCents * charge.taxRateBps / 10_000) : 0, when));
  const revisionSnapshot = JSON.stringify({ number: current.number, vendorId, expectedDate, notes, items: prepared.items, charges: prepared.charges, retainedCharges, totalCents, currency, exchangeRateToBase, previousRevision: reopeningRejected ? current.revision : null });
  statements.push(
    reopeningRejected
      ? db.prepare(`INSERT INTO purchase_order_revisions (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
          SELECT ?,?,?,'draft',?,'Draft edited after rejection',?,? WHERE ${marker(command)}`)
        .bind(newId("revision"), id, revisionNumber, revisionSnapshot, command.actor.label, when)
      : db.prepare(`UPDATE purchase_order_revisions SET snapshot_json=?,reason='Draft edited',created_by=?,created_at=?
          WHERE purchase_order_id=? AND revision_number=? AND lifecycle_status='draft' AND ${marker(command)}`)
        .bind(revisionSnapshot, command.actor.label, when, id, current.revision),
    auditStatement(command, "purchase_order", id, "draft_updated", result.message, { vendorId, expectedDate, notes, itemCount: prepared.items.length, totalCents, retainedChargeCount: retainedCharges.length, currency, previousStatus: current.status, revisionNumber }, when),
    outboxStatement(command, "purchase_order.draft_updated", "purchase_order", id, { itemCount: prepared.items.length, totalCents, previousStatus: current.status, revisionNumber }, when),
  );
  await db.batch(statements);
  return finish(command);
}

async function cancelPurchaseOrder(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const version = command.version ?? 0;
  const reason = textValue(command.payload ?? {}, "reason");
  const current = await first<{ version: number; status: string; number: string; revision: number; hasReceipts: number; hasBills: number; hasDeliveries: number }>(`SELECT po.version,po.lifecycle_status AS status,po.number,po.revision_number AS revision,
      EXISTS (SELECT 1 FROM receipts r WHERE r.purchase_order_id=po.id) AS hasReceipts,
      EXISTS (SELECT 1 FROM vendor_bills vb WHERE vb.purchase_order_id=po.id AND vb.status<>'void') AS hasBills,
      EXISTS (SELECT 1 FROM drop_ship_deliveries d JOIN purchase_order_lines pol ON pol.id=d.purchase_order_line_id WHERE pol.purchase_order_id=po.id) AS hasDeliveries
    FROM purchase_orders po WHERE po.id=?`, id);
  if (!current) throw new WorkflowError("NOT_FOUND", "Purchase order was not found.", 404);
  if (current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Purchase order changed; refresh before canceling.", 409, current.version);
  if (!["draft", "rejected", "pending_approval", "approved"].includes(current.status)) throw new WorkflowError("INVALID_STATE", "Only an open purchase order can be canceled.", 409, current.version);
  if (current.hasReceipts) throw new WorkflowError("RECEIPT_HISTORY_EXISTS", "This purchase order has receipt history. Close its remaining quantity or post corrections instead of canceling it.", 409, current.version);
  if (current.hasBills) throw new WorkflowError("VENDOR_BILL_EXISTS", "Void or settle the linked vendor bill before canceling this purchase order.", 409, current.version);
  if (current.hasDeliveries) throw new WorkflowError("DELIVERY_HISTORY_EXISTS", "This drop-ship purchase order has delivery history and cannot be canceled.", 409, current.version);
  const result: WorkflowResult = {
    recordId: id,
    message: `${current.number} canceled; open incoming supply and dedicated customer-demand links were released.`,
    impact: { physical: "No stock movement.", commercial: "The purchasing commitment is canceled and no longer contributes incoming supply.", financial: "No payable was created or changed.", onHandDelta: 0 },
  };
  const db = commandD1(command);
  const when = new Date().toISOString();
  const pricingStatements = current.status === "approved"
    ? await prepareCanceledPurchaseCostStatements({ claim: command, actor: command.actor, purchaseOrderId: id, effectiveAt: when })
    : [];
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM purchase_orders po WHERE po.id=? AND po.version=? AND po.lifecycle_status IN ('draft','rejected','pending_approval','approved')
        AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.purchase_order_id=po.id)
        AND NOT EXISTS (SELECT 1 FROM vendor_bills vb WHERE vb.purchase_order_id=po.id AND vb.status<>'void')
        AND NOT EXISTS (SELECT 1 FROM drop_ship_deliveries d JOIN purchase_order_lines pol ON pol.id=d.purchase_order_line_id WHERE pol.purchase_order_id=po.id)`)
      .bind(...claimValues(command, result, id), id, version),
    db.prepare(`UPDATE supply_allocations SET status='released',updated_at=?,version=version+1
      WHERE purchase_order_line_id IN (SELECT id FROM purchase_order_lines WHERE purchase_order_id=?) AND status='active' AND ${marker(command)}`).bind(when, id),
    db.prepare(`UPDATE sales_order_lines SET linked_purchase_order_line_id=(SELECT sa.purchase_order_line_id FROM supply_allocations sa
        WHERE sa.sales_order_line_id=sales_order_lines.id AND sa.status='active' ORDER BY sa.created_at,sa.id LIMIT 1)
      WHERE linked_purchase_order_line_id IN (SELECT id FROM purchase_order_lines WHERE purchase_order_id=?) AND ${marker(command)}`).bind(id),
    db.prepare(`UPDATE purchase_orders SET lifecycle_status='canceled',version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(id, version),
    db.prepare(`UPDATE purchase_order_revisions SET lifecycle_status='canceled' WHERE purchase_order_id=? AND revision_number=? AND ${marker(command)}`).bind(id, current.revision),
    db.prepare(`UPDATE approvals SET status='rejected',decided_by=?,decision_reason=?,decided_at=?,version=version+1
      WHERE entity_type='purchase_order' AND entity_id=? AND status='pending' AND ${marker(command)}`).bind(command.actor.label, `Purchase order canceled: ${reason}`, when, id),
    ...pricingStatements,
    auditStatement(command, "purchase_order", id, "purchase_order_canceled", result.message, { reason, previousStatus: current.status, revision: current.revision }, when),
    outboxStatement(command, "purchase_order.canceled", "purchase_order", id, { reason, previousStatus: current.status }, when),
  ]);
  return finish(command);
}

async function submitPurchaseOrder(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const reason = optionalText(command.payload ?? {}, "reason") ?? "";
  const version = command.version ?? 0;
  const current = await first<{ lifecycleStatus: string; version: number; number: string }>("SELECT lifecycle_status AS lifecycleStatus, version, number FROM purchase_orders WHERE id=?", id);
  if (!current) throw new WorkflowError("NOT_FOUND", "Purchase order was not found.", 404);
  if (current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Purchase order changed; refresh before submitting.", 409, current.version);
  if (!["draft", "rejected"].includes(current.lifecycleStatus)) throw new WorkflowError("INVALID_STATE", "Only draft or rejected purchase orders can be submitted.", 409, current.version);
  const approvalId = newId("approval");
  const result: WorkflowResult = { message: "Purchase order submitted for approval; inventory is unchanged.", impact: { physical: "No stock movement.", commercial: "Commitment remains inactive until approval.", financial: "No bill created.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM purchase_orders WHERE id=? AND version=?`).bind(...claimValues(command, result, id), id, version),
    db.prepare(`UPDATE purchase_orders SET lifecycle_status='pending_approval',version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(id, version),
    db.prepare(`UPDATE purchase_order_revisions SET lifecycle_status='pending_approval'
      WHERE purchase_order_id=? AND revision_number=(SELECT revision_number FROM purchase_orders WHERE id=?)
        AND lifecycle_status IN ('draft','rejected') AND ${marker(command)}`).bind(id, id),
    db.prepare(`INSERT INTO approvals (id,entity_type,entity_id,request_type,status,requested_by,requested_reason,requested_at,metadata_json,version)
      SELECT ?,'purchase_order',?,'purchase_order_approval','pending',?,?,?,'{}',1 WHERE ${marker(command)}`).bind(approvalId, id, command.actor.label, reason, when),
    auditStatement(command, "purchase_order", id, "submitted_for_approval", result.message, { reason, approvalId }, when),
    outboxStatement(command, "purchase_order.approval_requested", "purchase_order", id, { approvalId }, when),
  ];
  const recipient = (await setting<string>("email.purchaseOrderApprovalRecipient", "")).trim().toLowerCase();
  let appOrigin = "";
  try {
    const origin = new URL(command.appOrigin ?? "");
    if (/^https?:$/u.test(origin.protocol)) appOrigin = origin.origin;
  } catch { /* A missing request origin must not block submission. */ }
  if (recipient.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/u.test(recipient) && appOrigin) {
    statements.push(outboxStatement(command, "purchase_order.approval_email_requested", "purchase_order", id, {
      recordId: id, number: current.number, recipient, appOrigin,
    }, when));
  }
  await db.batch(statements);
  return finish(command);
}

async function decidePurchaseOrder(command: WorkflowCommand, decision: "approved" | "rejected") {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const reason = optionalText(command.payload ?? {}, "reason") ?? "";
  const version = command.version ?? 0;
  const current = await first<{ version: number; status: string; revision: number; number: string }>("SELECT version, lifecycle_status AS status, revision_number AS revision, number FROM purchase_orders WHERE id=?", id);
  if (!current) throw new WorkflowError("NOT_FOUND", "Purchase order was not found.", 404);
  if (current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Purchase order changed; refresh before deciding.", 409, current.version);
  if (current.status !== "pending_approval") throw new WorkflowError("INVALID_STATE", "Only pending purchase orders can be approved or rejected.", 409);
  const approval = await first<{ id: string; requestType: string; version: number }>(
    "SELECT id,request_type AS requestType,version FROM approvals WHERE entity_type='purchase_order' AND entity_id=? AND status='pending' ORDER BY requested_at DESC,id DESC LIMIT 1",
    id
  );
  if (!approval) throw new WorkflowError("APPROVAL_STATE_MISSING", "The pending purchase-order approval record is missing.", 409);
  const amendmentDecision = approval.requestType === "purchase_order_amendment";
  let restoration: { revision: number; total: number; baseTotal: number; lines: Array<{ id: string; ordered: number; unitCost: number; orderedUomQty: number | null; orderedUomUnitCost: number | null }> } | null = null;
  if (amendmentDecision && decision === "rejected") {
    const revision = await first<{ snapshotJson: string }>(
      "SELECT snapshot_json AS snapshotJson FROM purchase_order_revisions WHERE purchase_order_id=? AND revision_number=? AND lifecycle_status='pending_approval'",
      id, current.revision
    );
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(revision?.snapshotJson ?? "{}") as Record<string, unknown>; } catch { /* handled below */ }
    const previous = parsed.previous as { order?: Record<string, unknown>; lines?: Array<Record<string, unknown>> } | undefined;
    const previousRevision = Number(previous?.order?.revisionNumber);
    const previousTotal = Number(previous?.order?.totalCents);
    const previousBaseTotal = Number(previous?.order?.baseTotalCents);
    const previousLines = Array.isArray(previous?.lines) ? previous.lines.map((line) => ({
      id: String(line.id ?? ""), ordered: Number(line.ordered), unitCost: Number(line.unitCost),
      orderedUomQty: line.orderedUomQty == null ? null : Number(line.orderedUomQty),
      orderedUomUnitCost: line.orderedUomUnitCost == null ? null : Number(line.orderedUomUnitCost),
    })) : [];
    if (!Number.isSafeInteger(previousRevision) || previousRevision < 1 || !Number.isSafeInteger(previousTotal)
        || previousTotal < 0 || !Number.isSafeInteger(previousBaseTotal) || previousBaseTotal < 0
        || !previousLines.length || previousLines.some((line) => !line.id || !Number.isFinite(line.ordered)
          || line.ordered <= 0 || !Number.isFinite(line.unitCost) || line.unitCost < 0
          || (line.orderedUomQty != null && !(line.orderedUomQty > 0)) || (line.orderedUomUnitCost != null && !(line.orderedUomUnitCost >= 0)))) {
      throw new WorkflowError("REVISION_RESTORE_MISSING", "The prior approved purchase-order snapshot cannot be restored safely; approval decision was blocked.", 409);
    }
    restoration = { revision: previousRevision, total: previousTotal, baseTotal: previousBaseTotal, lines: previousLines };
  }
  const message = amendmentDecision
    ? decision === "approved"
      ? "Purchase-order amendment approved; place the revised order with the vendor before receiving."
      : "Purchase-order amendment rejected; the prior approved commitment was restored without moving inventory."
    : decision === "approved"
      ? "Purchase order approved and awaiting placement with the vendor."
      : "Purchase order rejected; no purchasing commitment or inventory movement was created.";
  const result: WorkflowResult = { message, impact: { physical: "No stock movement.", commercial: restoration ? "Prior approved commitment restored." : decision === "approved" ? "Approved for ordering; fulfillment stays locked until marked ordered." : "Commitment remains inactive.", financial: "No vendor bill created.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  let approvedEmailPayload: { recordId: string; number: string; recipients: string[]; appOrigin: string } | null = null;
  if (decision === "approved" && !amendmentDecision) {
    const creator = await first<{ actorId: string | null }>(`SELECT actor_id AS actorId FROM audit_events
      WHERE entity_type='purchase_order' AND entity_id=? AND action='purchase_order_draft_created'
      ORDER BY created_at,id LIMIT 1`, id);
    const creatorAccount = creator?.actorId
      ? await first<{ email: string }>("SELECT email FROM app_users WHERE user_id=? AND active=1", creator.actorId)
      : null;
    const additional = await setting<string>("email.purchaseOrderApprovedRecipients", "");
    const candidates = [creatorAccount?.email ?? "", ...additional.split(/[;,]/u)];
    const recipients = [...new Set(candidates.map((email) => email.trim().toLowerCase()).filter((email) => email.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/u.test(email)))];
    let appOrigin = "";
    try {
      const origin = new URL(command.appOrigin ?? "");
      if (/^https?:$/u.test(origin.protocol)) appOrigin = origin.origin;
    } catch { /* A missing request origin must not block the approval transaction. */ }
    if (recipients.length && appOrigin) approvedEmailPayload = { recordId: id, number: current.number, recipients, appOrigin };
  }
  const pricingStatements = decision === "approved"
    ? await prepareExistingApprovedPurchaseCostStatements({
        claim: command,
        actor: command.actor,
        purchaseOrderId: id,
        effectiveAt: when,
        eventType: amendmentDecision ? "purchase_order_amendment_approved" : "purchase_order_approved",
      })
    : [];
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM purchase_orders WHERE id=? AND version=? AND lifecycle_status='pending_approval'
        AND EXISTS (SELECT 1 FROM approvals WHERE id=? AND version=? AND status='pending')`)
      .bind(...claimValues(command, result, id), id, version, approval.id, approval.version),
    restoration
      ? db.prepare(`UPDATE purchase_orders SET lifecycle_status='approved',revision_number=?,total_cents=?,base_total_cents=?,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`)
        .bind(restoration.revision, restoration.total, restoration.baseTotal, id, version)
      : db.prepare(`UPDATE purchase_orders SET lifecycle_status=?,ordered_at=CASE WHEN ?='approved' THEN NULL ELSE ordered_at END,
          ordered_by=CASE WHEN ?='approved' THEN NULL ELSE ordered_by END,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`)
        .bind(decision, decision, decision, id, version),
    db.prepare(`UPDATE approvals SET status=?,decided_by=?,decision_reason=?,decided_at=?,version=version+1 WHERE id=? AND version=? AND status='pending' AND ${marker(command)}`)
      .bind(decision, command.actor.label, reason, when, approval.id, approval.version),
    db.prepare(`UPDATE purchase_order_revisions SET lifecycle_status=? WHERE purchase_order_id=? AND revision_number=? AND lifecycle_status='pending_approval' AND ${marker(command)}`)
      .bind(decision, id, current.revision),
  ];
  if (restoration) {
    for (const line of restoration.lines) {
      statements.push(db.prepare(`UPDATE purchase_order_lines SET ordered_qty=?,unit_cost_cents=?,ordered_uom_qty=COALESCE(?,ordered_uom_qty),ordered_uom_unit_cost_cents=COALESCE(?,ordered_uom_unit_cost_cents) WHERE id=? AND purchase_order_id=? AND ${marker(command)}`)
        .bind(line.ordered, line.unitCost, line.orderedUomQty, line.orderedUomUnitCost, line.id, id));
    }
  }
  statements.push(...pricingStatements);
  statements.push(
    auditStatement(command, "purchase_order", id, restoration ? "amendment_rejected_restored" : decision, message,
      { reason, approvalId: approval.id, requestType: approval.requestType, proposalRevision: current.revision, restoredRevision: restoration?.revision ?? null }, when),
    outboxStatement(command, restoration ? "purchase_order.amendment_rejected_restored" : `purchase_order.${decision}`,
      "purchase_order", id, { reason, approvalId: approval.id, restoredRevision: restoration?.revision ?? null }, when),
  );
  if (approvedEmailPayload) {
    statements.push(outboxStatement(command, "purchase_order.approved_email_requested", "purchase_order", id, approvedEmailPayload, when));
  }
  await db.batch(statements);
  return finish(command);
}

async function amendPurchaseOrder(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const payload = command.payload ?? {};
  const reason = textValue(payload, "reason");
  const changes = Array.isArray(payload.lines) ? payload.lines as Array<Record<string, unknown>> : [];
  if (!changes.length) throw new WorkflowError("VALIDATION_ERROR", "lines must contain at least one amendment.");
  const version = command.version ?? 0;
  const order = await first<{ version: number; status: string; revision: number; number: string; vendorId: string; currency: string; exchange: number; total: number; baseTotal: number; expectedDate: string; paymentTerms: string | null; dueDate: string | null; buyerName: string | null; projectReference: string | null }>("SELECT version,lifecycle_status AS status,revision_number AS revision,number,vendor_id AS vendorId,currency,exchange_rate_to_base AS exchange,total_cents AS total,base_total_cents AS baseTotal,expected_date AS expectedDate,payment_terms AS paymentTerms,due_date AS dueDate,buyer_name AS buyerName,project_reference AS projectReference FROM purchase_orders WHERE id=?", id);
  if (!order) throw new WorkflowError("NOT_FOUND", "Purchase order was not found.", 404);
  if (order.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Purchase order changed; refresh before amending.", 409, order.version);
  if (order.status !== "approved") throw new WorkflowError("INVALID_STATE", "Only approved purchase orders can be amended.", 409);
  const changeIds = changes.map((change) => textValue(change, "lineId"));
  if (new Set(changeIds).size !== changeIds.length) throw new WorkflowError("DUPLICATE_DOCUMENT_LINE", "Each purchase-order line may be amended only once.");
  const existingLines = await all<{ id: string; productId: string; ordered: number; closed: number; unitCost: number; orderedUomId: string | null; orderedUomQty: number | null; orderedUomUnitCost: number | null; configuration: string | null; route: string; sourceSalesLineId: string | null; discountCents: number; taxable: number; taxRateBps: number; retained: number; allocated: number }>(`SELECT pol.id,pol.product_id AS productId,pol.ordered_qty AS ordered,pol.closed_qty AS closed,pol.unit_cost_cents AS unitCost,
      pol.ordered_uom_id AS orderedUomId,pol.ordered_uom_qty AS orderedUomQty,pol.ordered_uom_unit_cost_cents AS orderedUomUnitCost,
      pol.configuration_snapshot AS configuration,pol.fulfillment_route AS route,pol.source_sales_order_line_id AS sourceSalesLineId,pol.discount_cents AS discountCents,pol.taxable,pol.tax_rate_bps AS taxRateBps,
      CASE WHEN pol.fulfillment_route='drop_ship'
        THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0)
        ELSE MAX(COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0),0) END AS retained,
      COALESCE((SELECT SUM(sa.allocated_qty) FROM supply_allocations sa WHERE sa.purchase_order_line_id=pol.id AND sa.status='active'),0) AS allocated
    FROM purchase_order_lines pol WHERE pol.purchase_order_id=? ORDER BY pol.id`, id);
  if (changeIds.some((lineId) => !existingLines.some((line) => line.id === lineId))) throw new WorkflowError("INVALID_PO_LINE", "Every amendment line must belong to this purchase order.", 409);
  const amendedLines: typeof existingLines = [];
  for (const line of existingLines) {
    const change = changes.find((row) => row.lineId === line.id);
    if (!change) { amendedLines.push(line); continue; }
    // Amended quantities and unit costs are entered in the line's ordered UOM, exactly as the draft
    // was, and go through the same conversion and precision validation as every other entry point.
    const enteredQuantity = numberValue(change, "orderedQuantity");
    let normalizedQuantity: Awaited<ReturnType<typeof normalizeProductQuantity>>;
    try {
      normalizedQuantity = await normalizeProductQuantity({ productId: line.productId, quantity: enteredQuantity, uomId: line.orderedUomId, usage: line.orderedUomId ? "purchase" : "base", field: "orderedQuantity" });
    } catch (error) {
      if (error instanceof ProductQuantityError) throw new WorkflowError(error.code, error.message, error.status);
      throw error;
    }
    const ordered = normalizedQuantity.baseQuantity;
    const enteredUnitCost = change.unitCostCents == null
      ? (line.orderedUomUnitCost ?? Math.round(line.unitCost * normalizedQuantity.factorToBase))
      : numberValue(change, "unitCostCents", { integer: true });
    const unitCost = enteredUnitCost / normalizedQuantity.factorToBase;
    const amendmentFloor = roundQuantity(Math.max(line.retained + line.closed, line.allocated + line.closed));
    if (ordered < amendmentFloor) throw new WorkflowError("BELOW_RETAINED_OR_CLOSED", `Line ${line.id} cannot be amended below ${amendmentFloor}: ${line.retained} retained plus ${line.closed} closed.`, 409);
    amendedLines.push({ ...line, ordered, unitCost, orderedUomQty: enteredQuantity, orderedUomUnitCost: enteredUnitCost });
  }
  const charges = await all<{ chargeType: string; description: string; amount: number; direction: string; taxable: number; refundable: number; taxCode: string | null; taxRate: number; taxAmount: number }>("SELECT charge_type AS chargeType,description,amount_cents AS amount,direction,taxable,refundable,tax_code AS taxCode,tax_rate_bps AS taxRate,tax_amount_cents AS taxAmount FROM document_charges WHERE document_type='purchase_order' AND document_id=? ORDER BY created_at,id", id);
  const itemSubtotal = amendedLines.reduce((sum, line) => {
    const net = Math.max(Math.round(line.ordered * line.unitCost) - line.discountCents, 0);
    return sum + net + (line.taxable ? Math.round(net * line.taxRateBps / 10_000) : 0);
  }, 0);
  const chargeSubtotal = charges.reduce((sum, charge) => sum + (charge.direction === "subtract" ? -charge.amount : charge.amount), 0);
  const chargeTax = charges.reduce((sum, charge) => sum + (charge.direction === "subtract" ? -Math.abs(charge.taxAmount) : Math.abs(charge.taxAmount)), 0);
  const total = itemSubtotal + chargeSubtotal + chargeTax;
  if (total < 0) throw new WorkflowError("INVALID_DOCUMENT_TOTAL", "Amendment cannot make the purchase-order total negative.");
  const baseTotal = Math.round(total * order.exchange);
  const revisionHead = await first<{ revision: number }>("SELECT COALESCE(MAX(revision_number),0) AS revision FROM purchase_order_revisions WHERE purchase_order_id=?", id);
  const nextRevision = Math.max(order.revision, Number(revisionHead?.revision ?? 0)) + 1;
  const result: WorkflowResult = { message: `Revision ${nextRevision} created and submitted for approval; on-hand inventory is unchanged.`, impact: { physical: "No stock movement.", commercial: "Revised commitment awaits approval.", financial: "Existing bills are unchanged.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM purchase_orders WHERE id=? AND version=?
        AND NOT EXISTS (SELECT 1 FROM purchase_order_revisions WHERE purchase_order_id=? AND revision_number=?)`)
      .bind(...claimValues(command, result, id), id, version, id, nextRevision),
    db.prepare(`UPDATE purchase_orders SET lifecycle_status='pending_approval',revision_number=?,total_cents=?,base_total_cents=?,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(nextRevision, total, baseTotal, id, version),
  ];
  for (const change of changes) {
    const lineId = textValue(change, "lineId");
    const amended = amendedLines.find((line) => line.id === lineId)!;
    statements.push(db.prepare(`UPDATE purchase_order_lines SET ordered_qty=?,unit_cost_cents=?,ordered_uom_qty=?,ordered_uom_unit_cost_cents=? WHERE id=? AND purchase_order_id=? AND ${marker(command)}`)
      .bind(amended.ordered, amended.unitCost, amended.orderedUomQty, amended.orderedUomUnitCost, lineId, id));
  }
  const previous = {
    order: { id, number: order.number, vendorId: order.vendorId, lifecycleStatus: "approved", revisionNumber: order.revision,
      currency: order.currency, exchangeRateToBase: order.exchange, expectedDate: order.expectedDate,
      paymentTerms: order.paymentTerms, dueDate: order.dueDate, buyerName: order.buyerName,
      projectReference: order.projectReference, totalCents: order.total, baseTotalCents: order.baseTotal },
    lines: existingLines,
    charges,
  };
  const snapshot = { order: { id, number: order.number, vendorId: order.vendorId, lifecycleStatus: "pending_approval", revisionNumber: nextRevision, currency: order.currency, exchangeRateToBase: order.exchange, expectedDate: order.expectedDate, paymentTerms: order.paymentTerms, dueDate: order.dueDate, buyerName: order.buyerName, projectReference: order.projectReference, itemSubtotalCents: itemSubtotal, chargeSubtotalCents: chargeSubtotal, chargeTaxCents: chargeTax, totalCents: total, baseTotalCents: baseTotal }, lines: amendedLines, charges, previous };
  statements.push(
    db.prepare(`INSERT INTO purchase_order_revisions (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
      SELECT ?,?,?,'pending_approval',?,?,?,? WHERE ${marker(command)}`).bind(newId("revision"), id, nextRevision, JSON.stringify(snapshot), reason, command.actor.label, when),
    db.prepare(`INSERT INTO approvals (id,entity_type,entity_id,request_type,status,requested_by,requested_reason,requested_at,metadata_json,version)
      SELECT ?,'purchase_order',?,'purchase_order_amendment','pending',?,?,?, ?,1 WHERE ${marker(command)}`).bind(newId("approval"), id, command.actor.label, reason, when, JSON.stringify({ revision: nextRevision })),
    auditStatement(command, "purchase_order", id, "amended", result.message, { reason, changes }, when),
    outboxStatement(command, "purchase_order.amended", "purchase_order", id, { revision: nextRevision }, when)
  );
  await db.batch(statements);
  return finish(command);
}

async function requestApproval(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const entityType = textValue(payload, "entityType");
  const entityId = command.entityId ?? textValue(payload, "entityId");
  const requestType = textValue(payload, "requestType");
  const reason = textValue(payload, "reason");
  const allowed:Record<string,{entityType:string;table:string}>={over_receipt:{entityType:"purchase_order_line",table:"purchase_order_lines"},inventory_count_variance:{entityType:"product",table:"products"},scrap:{entityType:"product",table:"products"},price_variance:{entityType:"vendor_bill",table:"vendor_bills"}};
  const rule=allowed[requestType];
  if(!rule||entityType!==rule.entityType) throw new WorkflowError("INVALID_APPROVAL_TYPE","requestType/entityType is not an allowed approval workflow.");
  if(!await first(`SELECT id FROM ${rule.table} WHERE id=?`,entityId)) throw new WorkflowError("NOT_FOUND","Approval target was not found.",404);
  const metadata=payload.metadata&&typeof payload.metadata==="object"?payload.metadata as Record<string,unknown>:{};
  if(requestType==="over_receipt"&&(!Number.isFinite(Number(metadata.maxExcessQuantity))||Number(metadata.maxExcessQuantity)<=0)) throw new WorkflowError("VALIDATION_ERROR","over_receipt approval metadata.maxExcessQuantity must be positive.");
  if(requestType==="scrap"&&(!Number.isSafeInteger(Number(metadata.maxValueCents))||Number(metadata.maxValueCents)<=0)) throw new WorkflowError("VALIDATION_ERROR","scrap approval metadata.maxValueCents must be a positive whole number of cents.");
  const approvalId = newId("approval");
  const result: WorkflowResult = { message: "Approval request created; no inventory or financial posting occurred.", impact: { physical: "No stock movement.", financial: "No posting.", onHandDelta: 0 }, recordId: approvalId };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) VALUES (?,?,?,?,?,?,?)`).bind(...claimValues(command, result, approvalId)),
    db.prepare(`INSERT INTO approvals (id,entity_type,entity_id,request_type,status,requested_by,requested_reason,requested_at,metadata_json,version)
      SELECT ?,?,?,?,'pending',?,?,?, ?,1 WHERE ${marker(command)}`).bind(approvalId, entityType, entityId, requestType, command.actor.label, reason, when, JSON.stringify(metadata)),
    auditStatement(command, entityType, entityId, "approval_requested", result.message, { approvalId, requestType, reason }, when),
    outboxStatement(command, "approval.requested", entityType, entityId, { approvalId, requestType }, when),
  ]);
  return finish(command);
}

async function decideApproval(command: WorkflowCommand, decision: "approved" | "rejected") {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const reason = optionalText(command.payload ?? {}, "reason") ?? "";
  const version = command.version ?? 0;
  const approval = await first<{ version: number; status: string; entityType: string; entityId: string }>("SELECT version,status,entity_type AS entityType,entity_id AS entityId FROM approvals WHERE id=?", id);
  if (!approval) throw new WorkflowError("NOT_FOUND", "Approval was not found.", 404);
  if (approval.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Approval changed; refresh before deciding.", 409, approval.version);
  if (approval.status !== "pending") throw new WorkflowError("INVALID_STATE", "Only pending approvals can be decided.", 409);
  const result: WorkflowResult = { message: `Approval ${decision}; no inventory moved.`, impact: { physical: "No stock movement.", approvalStatus: decision, onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM approvals WHERE id=? AND version=? AND status='pending'`).bind(...claimValues(command, result, id), id, version),
    db.prepare(`UPDATE approvals SET status=?,decided_by=?,decision_reason=?,decided_at=?,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(decision, command.actor.label, reason, when, id, version),
    auditStatement(command, approval.entityType, approval.entityId, `approval_${decision}`, result.message, { approvalId: id, reason }, when),
    outboxStatement(command, `approval.${decision}`, approval.entityType, approval.entityId, { approvalId: id }, when),
  ]);
  return finish(command);
}

type TrackingSelection = {
  policy: "quantity" | "lot" | "serial";
  productId: string;
  lotId: string | null;
  unitId: string | null;
  unitVersion: number | null;
  sourceStatus: string;
};

async function requireSourceTracking(
  productId: string,
  locationId: string,
  quantity: number,
  payload: Record<string, unknown>,
  fixed?: { lotId?: string | null; unitId?: string | null }
): Promise<TrackingSelection> {
  const product = await first<{ policy: string; active: number }>("SELECT tracking_policy AS policy,active FROM products WHERE id=?", productId);
  if (!product || !product.active) throw new WorkflowError("INVALID_PRODUCT", "An active product is required.", 404);
  if (!["quantity", "lot", "serial"].includes(product.policy)) throw new WorkflowError("TRACKING_CONFIGURATION_ERROR", "The product tracking policy is invalid.", 500);
  const location = await first<{ status: string; active: number }>("SELECT inventory_status AS status,active FROM locations WHERE id=?", locationId);
  if (!location || !location.active) throw new WorkflowError("INVALID_LOCATION", "Traceable inventory requires an active source location.", 409);
  const suppliedLotId = fixed?.lotId ?? optionalText(payload, "lotId");
  const suppliedUnitId = fixed?.unitId ?? optionalText(payload, "inventoryUnitId");
  if (product.policy === "quantity") {
    if (suppliedLotId || suppliedUnitId) throw new WorkflowError("TRACKING_POLICY_MISMATCH", "Quantity-tracked products cannot post lot or serial identities.", 409);
    return { policy: "quantity", productId, lotId: null, unitId: null, unitVersion: null, sourceStatus: location.status };
  }
  if (product.policy === "lot") {
    if (!suppliedLotId || suppliedUnitId) throw new WorkflowError("LOT_ASSIGNMENT_REQUIRED", "A valid lotId, and no serial unit, is required for this lot-tracked product.", 409);
    const lot = await first<{ productId: string; status: string }>("SELECT product_id AS productId,status FROM inventory_lots WHERE id=?", suppliedLotId);
    if (!lot || lot.productId !== productId || lot.status !== "active") throw new WorkflowError("INVALID_LOT", "The lot is not active for this product.", 409);
    const balance = await first<{ quantity: number }>(`SELECT COALESCE(SUM(CASE WHEN sm.to_location_id=? THEN ma.quantity WHEN sm.from_location_id=? THEN -ma.quantity ELSE 0 END),0) AS quantity
      FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id
      WHERE sm.product_id=? AND ma.lot_id=?`, locationId, locationId, productId, suppliedLotId);
    if (roundQuantity(Number(balance?.quantity ?? 0)) < quantity) throw new WorkflowError("LOT_QUANTITY_SHORTAGE", "The selected lot does not have enough identified on-hand quantity at the source location.", 409);
    return { policy: "lot", productId, lotId: suppliedLotId, unitId: null, unitVersion: null, sourceStatus: location.status };
  }
  if (quantity !== 1) throw new WorkflowError("SERIAL_QUANTITY_INVALID", "Serial-tracked postings must have a quantity of exactly one.", 409);
  if (!suppliedUnitId) throw new WorkflowError("SERIAL_ASSIGNMENT_REQUIRED", "inventoryUnitId is required for this serial-tracked product.", 409);
  const unit = await first<{ productId: string; lotId: string | null; locationId: string; inventoryStatus: string; lifecycleStatus: string; allocated: string | null; version: number }>(`SELECT product_id AS productId,lot_id AS lotId,location_id AS locationId,inventory_status AS inventoryStatus,lifecycle_status AS lifecycleStatus,allocated_sales_order_line_id AS allocated,version FROM inventory_units WHERE id=?`, suppliedUnitId);
  if (!unit || unit.productId !== productId || unit.locationId !== locationId || unit.inventoryStatus !== location.status || unit.lifecycleStatus !== "on_hand") {
    throw new WorkflowError("INVALID_SERIAL_STATE", "The serial unit is not on hand for this product, location, and inventory status.", 409);
  }
  if (unit.allocated) throw new WorkflowError("SERIAL_ALLOCATED", "The selected serial is allocated to demand and cannot be moved by this workflow.", 409);
  if (suppliedLotId && unit.lotId !== suppliedLotId) throw new WorkflowError("SERIAL_LOT_MISMATCH", "The selected serial does not belong to the supplied lot.", 409);
  return { policy: "serial", productId, lotId: unit.lotId, unitId: suppliedUnitId, unitVersion: unit.version, sourceStatus: location.status };
}

function trackingClaim(trace: TrackingSelection, locationId: string, quantity: number) {
  if (trace.policy === "quantity") return { sql: "1=1", bindings: [] as unknown[] };
  if (trace.policy === "lot") return {
    sql: `(SELECT COALESCE(SUM(CASE WHEN sm.to_location_id=? THEN ma.quantity WHEN sm.from_location_id=? THEN -ma.quantity ELSE 0 END),0) FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id WHERE sm.product_id=? AND ma.lot_id=?)>=?`,
    bindings: [locationId, locationId, trace.productId, trace.lotId, quantity] as unknown[],
  };
  return {
    sql: "EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.id=? AND iu.product_id=? AND iu.location_id=? AND iu.inventory_status=? AND iu.lifecycle_status='on_hand' AND iu.allocated_sales_order_line_id IS NULL AND iu.version=?)",
    bindings: [trace.unitId, trace.productId, locationId, trace.sourceStatus, trace.unitVersion] as unknown[],
  };
}

function assignmentStatement(command: WorkflowCommand, movementId: string, trace: TrackingSelection, quantity: number) {
  if (trace.policy === "quantity") return null;
  return commandD1(command).prepare(`INSERT INTO movement_assignments (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${marker(command)}`)
    .bind(newId("assignment"), movementId, trace.lotId, trace.unitId, quantity);
}

async function moveInventory(command: WorkflowCommand, movementType: "internal_transfer" | "status_change") {
  const payload = command.payload ?? {};
  const productId = command.entityId ?? textValue(payload, "productId");
  const fromLocationId = textValue(payload, "fromLocationId");
  const requestedTo = textValue(payload, "toLocationId");
  if (fromLocationId === requestedTo) throw new WorkflowError("SAME_LOCATION", "Source and destination locations must differ.");
  const quantity = await baseQuantity(productId, numberValue(payload, "quantity"));
  const reason = textValue(payload, "reason");
  const postingDate = dateValue(payload, "postingDate", today());
  await assertPeriodOpen("inventory", postingDate);
  const locations = await all<{ id: string; warehouseId: string; status: string; active: number }>("SELECT id,warehouse_id AS warehouseId,inventory_status AS status,active FROM locations WHERE id IN (?,?)", fromLocationId, requestedTo);
  if (locations.length !== 2 || locations.some((location) => !location.active)) throw new WorkflowError("INVALID_LOCATION", "Both source and destination locations must be active.", 404);
  const from = locations.find((row) => row.id === fromLocationId)!;
  const to = locations.find((row) => row.id === requestedTo)!;
  const interWarehouse = from.warehouseId !== to.warehouseId;
  const requestedTransitLocationId = optionalText(payload, "inTransitLocationId");
  const transitLocation = interWarehouse
    ? requestedTransitLocationId
      ? await first<{ id: string }>(`SELECT id FROM locations WHERE id=? AND warehouse_id=? AND location_type='in_transit' AND inventory_status='in_transit' AND active=1`, requestedTransitLocationId, from.warehouseId)
      : await first<{ id: string }>(`SELECT id FROM locations WHERE warehouse_id=? AND location_type='in_transit' AND inventory_status='in_transit' AND active=1 ORDER BY code,id LIMIT 1`, from.warehouseId)
    : null;
  if (interWarehouse && !transitLocation) throw new WorkflowError("TRANSIT_LOCATION_REQUIRED", "Configure an active in-transit location in the source warehouse, or select one explicitly, before dispatching an inter-warehouse transfer.", 409);
  const destinationId = transitLocation?.id ?? requestedTo;
  const destinationStatus = interWarehouse ? "in_transit" : to.status;
  const balance = await first<{ available: number }>("SELECT on_hand_qty-reserved_qty AS available FROM inventory_balances WHERE product_id=? AND location_id=?", productId, fromLocationId);
  if (!balance || balance.available < quantity) throw new WorkflowError("NEGATIVE_INVENTORY_BLOCKED", "Not enough unreserved stock exists at the source location.", 409);
  const trace = await requireSourceTracking(productId, fromLocationId, quantity, payload);
  const traceClaim = trackingClaim(trace, fromLocationId, quantity);
  const locationClaimSql = `AND EXISTS (SELECT 1 FROM locations source WHERE source.id=? AND source.warehouse_id=? AND source.inventory_status=? AND source.active=1)
    AND EXISTS (SELECT 1 FROM locations destination WHERE destination.id=? AND destination.warehouse_id=? AND destination.inventory_status=? AND destination.active=1)
    ${interWarehouse ? "AND EXISTS (SELECT 1 FROM locations transit WHERE transit.id=? AND transit.warehouse_id=? AND transit.location_type='in_transit' AND transit.inventory_status='in_transit' AND transit.active=1)" : ""}`;
  const locationClaimBindings = [fromLocationId, from.warehouseId, from.status, requestedTo, to.warehouseId, to.status,
    ...(interWarehouse ? [destinationId, from.warehouseId] : [])];
  const transferId = newId("transfer"); const transferNumber = await nextDocumentNumber("TRF");
  const result: WorkflowResult = { message: interWarehouse ? `${transferNumber} dispatched to in-transit inventory.` : `${transferNumber} posted between warehouse locations.`, impact: { physical: `${quantity} units moved; total company on-hand is unchanged.`, commercial: "Orders are unchanged.", financial: "No invoice or bill created.", onHandDelta: 0, trackingPolicy: trace.policy, transferType: interWarehouse ? "inter_warehouse" : "intra_warehouse", destinationStatus }, recordId: transferId };
  const db = commandD1(command); const when = new Date().toISOString(); const postedAt = timestampOnDate(postingDate, when); const sourceMovement = newId("movement"); const destinationMovement = newId("movement");
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM inventory_balances WHERE product_id=? AND location_id=? AND on_hand_qty-reserved_qty>=? AND ${traceClaim.sql} ${locationClaimSql}`).bind(...claimValues(command, result, transferId), productId, fromLocationId, quantity, ...traceClaim.bindings, ...locationClaimBindings),
    db.prepare(`UPDATE inventory_balances SET on_hand_qty=on_hand_qty-?,version=version+1 WHERE product_id=? AND location_id=? AND on_hand_qty-reserved_qty>=? AND ${marker(command)}`).bind(quantity, productId, fromLocationId, quantity),
    db.prepare(`INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) SELECT ?,?,?,0,1 WHERE ${marker(command)} ON CONFLICT(product_id,location_id) DO UPDATE SET on_hand_qty=on_hand_qty+excluded.on_hand_qty,version=version+1`).bind(productId, destinationId, quantity),
    db.prepare(`INSERT INTO inventory_transfers (id,number,transfer_type,status,from_warehouse_id,to_warehouse_id,in_transit_location_id,posted_at,posted_by,version)
      SELECT ?,?,?,?, ?,?,?,?, ?,1 WHERE ${marker(command)}`).bind(transferId, transferNumber, interWarehouse ? "inter_warehouse" : "intra_warehouse", interWarehouse ? "in_transit" : "posted", from.warehouseId, to.warehouseId, interWarehouse ? destinationId : null, postedAt, command.actor.label),
    db.prepare(`INSERT INTO inventory_transfer_lines (id,transfer_id,product_id,from_location_id,to_location_id,quantity,lot_id,inventory_unit_id)
      SELECT ?,?,?,?,?,?,?,? WHERE ${marker(command)}`).bind(newId("transfer-line"), transferId, productId, fromLocationId, requestedTo, quantity, trace.lotId, trace.unitId),
    db.prepare(`INSERT INTO stock_movements (id,movement_type,product_id,quantity,from_location_id,inventory_status,source_document_type,source_document_id,posted_at,posted_by,idempotency_key,lot_id,inventory_unit_id)
      SELECT ?,?,?,-?,?,?,'inventory_transfer',?,?,?,?,?,? WHERE ${marker(command)}`).bind(sourceMovement, interWarehouse ? "interwarehouse_dispatch" : movementType, productId, quantity, fromLocationId, trace.sourceStatus, transferId, postedAt, command.actor.label, command.idempotencyKey, trace.lotId, trace.unitId),
    db.prepare(`INSERT INTO stock_movements (id,movement_type,product_id,quantity,to_location_id,inventory_status,source_document_type,source_document_id,posted_at,posted_by,idempotency_key,lot_id,inventory_unit_id)
      SELECT ?,?,?,?,?,?,'inventory_transfer',?,?,?,?,?,? WHERE ${marker(command)}`).bind(destinationMovement, interWarehouse ? "interwarehouse_in_transit" : movementType, productId, quantity, destinationId, destinationStatus, transferId, postedAt, command.actor.label, command.idempotencyKey, trace.lotId, trace.unitId),
    auditStatement(command, "inventory_transfer", transferId, movementType, result.message, { productId, quantity, fromLocationId, toLocationId: requestedTo, inTransitLocationId: interWarehouse ? destinationId : null, reason }, when),
    outboxStatement(command, "inventory.transfer_posted", "inventory_transfer", transferId, { productId, quantity, interWarehouse, inTransitLocationId: interWarehouse ? destinationId : null }, when),
  ];
  const sourceAssignment = assignmentStatement(command, sourceMovement, trace, quantity);
  const destinationAssignment = assignmentStatement(command, destinationMovement, trace, quantity);
  if (sourceAssignment) statements.push(sourceAssignment);
  if (destinationAssignment) statements.push(destinationAssignment);
  if (trace.policy === "serial") statements.push(db.prepare(`UPDATE inventory_units SET location_id=?,inventory_status=?,version=version+1 WHERE id=? AND product_id=? AND location_id=? AND inventory_status=? AND lifecycle_status='on_hand' AND allocated_sales_order_line_id IS NULL AND version=? AND ${marker(command)}`).bind(destinationId, destinationStatus, trace.unitId, productId, fromLocationId, trace.sourceStatus, trace.unitVersion));
  await db.batch(statements);
  return finish(command);
}

async function scrapInventory(command: WorkflowCommand) {
  const payload = command.payload ?? {}; const productId = command.entityId ?? textValue(payload, "productId");
  const locationId = textValue(payload, "locationId"); const quantity = await baseQuantity(productId, numberValue(payload, "quantity"));
  const reason = textValue(payload, "reason"); const postingDate = dateValue(payload, "postingDate", today());
  await assertPeriodOpen("inventory", postingDate);
  const balance = await first<{ available: number }>("SELECT on_hand_qty-reserved_qty AS available FROM inventory_balances WHERE product_id=? AND location_id=?", productId, locationId);
  if (!balance || balance.available < quantity) throw new WorkflowError("NEGATIVE_INVENTORY_BLOCKED", "Scrap quantity exceeds unreserved on-hand stock.", 409);
  const trace = await requireSourceTracking(productId, locationId, quantity, payload);
  const traceClaim = trackingClaim(trace, locationId, quantity);
  const movementId = newId("movement"); const result: WorkflowResult = { message: `${quantity} units scrapped with an immutable value and movement record.`, impact: { physical: `${quantity} units removed from on-hand.`, commercial: "Orders unchanged.", financial: "Inventory value reduced; no invoice created.", trackingPolicy: trace.policy, onHandDelta: -quantity }, recordId: movementId };
  const valuation = await valuationForIssue(productId, quantity);
  const threshold = await setting<number>("inventory.scrapApprovalThresholdCents", 50_000);
  const approvalId = optionalText(payload, "approvalId");
  let approval: { id: string; version: number } | null = null;
  if (valuation.valueCents > threshold) {
    if (!approvalId) throw new WorkflowError("APPROVAL_REQUIRED", `Scrap value ${valuation.valueCents} cents exceeds the ${threshold}-cent approval threshold.`, 409);
    const row = await first<{ id: string; version: number; metadataJson: string }>("SELECT id,version,metadata_json AS metadataJson FROM approvals WHERE id=? AND entity_type='product' AND entity_id=? AND request_type='scrap' AND status='approved' AND consumed_at IS NULL", approvalId, productId);
    if (!row) throw new WorkflowError("APPROVAL_REQUIRED", "An unused manager-approved scrap request for this product is required.", 409);
    let metadata: Record<string, unknown>; try { metadata = JSON.parse(row.metadataJson) as Record<string, unknown>; } catch { throw new WorkflowError("APPROVAL_SCOPE_MISMATCH", "Scrap approval metadata is invalid.", 409); }
    if (Number(metadata.maxValueCents) < valuation.valueCents || (metadata.locationId != null && String(metadata.locationId) !== locationId)) throw new WorkflowError("APPROVAL_SCOPE_MISMATCH", "The scrap approval does not cover this value and location.", 409);
    approval = row;
  }
  const layerClaimSql = valuation.layers.map(() => "AND EXISTS (SELECT 1 FROM cost_layers cl WHERE cl.id=? AND cl.remaining_qty>=?)").join(" ");
  const layerClaimBindings = valuation.layers.flatMap((layer) => [layer.id, layer.quantity]);
  const approvalClaimSql = approval ? "AND EXISTS (SELECT 1 FROM approvals a WHERE a.id=? AND a.version=? AND a.status='approved' AND a.consumed_at IS NULL)" : "";
  const approvalClaimBindings = approval ? [approval.id, approval.version] : [];
  const db = commandD1(command); const when = new Date().toISOString(); const postedAt = timestampOnDate(postingDate, when);
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM inventory_balances WHERE product_id=? AND location_id=? AND on_hand_qty-reserved_qty>=? AND ${traceClaim.sql} ${layerClaimSql} ${approvalClaimSql}`).bind(...claimValues(command, result, movementId), productId, locationId, quantity, ...traceClaim.bindings, ...layerClaimBindings, ...approvalClaimBindings),
    db.prepare(`UPDATE inventory_balances SET on_hand_qty=on_hand_qty-?,version=version+1 WHERE product_id=? AND location_id=? AND on_hand_qty-reserved_qty>=? AND ${marker(command)}`).bind(quantity, productId, locationId, quantity),
    db.prepare(`INSERT INTO stock_movements (id,movement_type,product_id,quantity,from_location_id,inventory_status,source_document_type,source_document_id,posted_at,posted_by,unit_cost_cents,idempotency_key,lot_id,inventory_unit_id)
      SELECT ?,'scrap',?,-?,?,?,'scrap',?,?,?, ?,?,?,? WHERE ${marker(command)}`).bind(movementId, productId, quantity, locationId, trace.sourceStatus, movementId, postedAt, command.actor.label, valuation.unitCostCents, command.idempotencyKey, trace.lotId, trace.unitId),
    db.prepare(`INSERT INTO inventory_value_entries (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
      SELECT ?,?,?,'scrap',-?,?,?,?,'scrap',?,?,? WHERE ${marker(command)}`).bind(newId("value"), productId, movementId, quantity, valuation.unitCostCents, -valuation.valueCents, valuation.method, movementId, postedAt, command.actor.label),
    auditStatement(command, "stock_movement", movementId, "inventory_scrapped", result.message, { productId, locationId, quantity, reason }, when),
    outboxStatement(command, "inventory.scrapped", "stock_movement", movementId, { productId, quantity, valueCents: valuation.valueCents }, when),
  ];
  const assignment = assignmentStatement(command, movementId, trace, quantity);
  if (assignment) statements.push(assignment);
  if (trace.policy === "serial") statements.push(db.prepare(`UPDATE inventory_units SET inventory_status='scrapped',lifecycle_status='scrapped',allocated_sales_order_line_id=NULL,version=version+1 WHERE id=? AND product_id=? AND location_id=? AND inventory_status=? AND lifecycle_status='on_hand' AND allocated_sales_order_line_id IS NULL AND version=? AND ${marker(command)}`).bind(trace.unitId, productId, locationId, trace.sourceStatus, trace.unitVersion));
  valuation.layers.forEach((layer) => statements.push(db.prepare(`UPDATE cost_layers SET remaining_qty=remaining_qty-?,status=CASE WHEN remaining_qty-?=0 THEN 'consumed' ELSE status END WHERE id=? AND remaining_qty>=? AND ${marker(command)}`).bind(layer.quantity, layer.quantity, layer.id, layer.quantity)));
  if (approval) statements.push(db.prepare(`UPDATE approvals SET consumed_at=?,consumed_by=?,consumed_entity_id=?,version=version+1 WHERE id=? AND version=? AND status='approved' AND consumed_at IS NULL AND ${marker(command)}`).bind(when, command.actor.label, movementId, approval.id, approval.version));
  await db.batch(statements); return finish(command);
}

async function valuationForIssue(productId: string, quantity: number) {
  const policy = await first<{ method: string; standardCost: number; averageCost: number }>("SELECT method,standard_cost_cents AS standardCost,average_cost_cents AS averageCost FROM valuation_policies WHERE product_id=?", productId);
  const method = policy?.method ?? "fifo";
  const layers = await all<{ id: string; remaining: number; unitCost: number }>("SELECT id,remaining_qty AS remaining,unit_cost_cents + CASE WHEN received_qty>0 THEN ROUND(landed_cost_cents/received_qty) ELSE 0 END AS unitCost FROM cost_layers WHERE product_id=? AND remaining_qty>0 ORDER BY received_at,id", productId);
  let remaining = quantity; let valueCents = 0; const consumed: Array<{ id: string; quantity: number }> = [];
  for (const layer of layers) {
    if (remaining <= 0) break; const used = Math.min(remaining, layer.remaining); remaining = roundQuantity(remaining - used); valueCents += Math.round(used * layer.unitCost); consumed.push({ id: layer.id, quantity: used });
  }
  if (remaining > 0) throw new WorkflowError("VALUATION_LAYER_SHORTAGE", "Cost layers do not reconstruct sufficient on-hand quantity.", 409);
  const unitCostCents = method === "standard" ? policy?.standardCost ?? 0 : method === "average" ? policy?.averageCost ?? 0 : quantity ? Math.round(valueCents / quantity) : 0;
  return { method, unitCostCents, valueCents: method === "fifo" ? valueCents : Math.round(quantity * unitCostCents), layers: consumed };
}

async function releaseReservation(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId"); const payload = command.payload ?? {};
  const reservation = await first<{ quantity: number; status: string; productId: string; locationId: string; salesLineId: string }>("SELECT quantity,status,product_id AS productId,location_id AS locationId,sales_order_line_id AS salesLineId FROM reservations WHERE id=?", id);
  if (!reservation) throw new WorkflowError("NOT_FOUND", "Reservation was not found.", 404);
  const quantity = await baseQuantity(reservation.productId, numberValue(payload, "quantity")); const reason = textValue(payload, "reason");
  if (reservation.status !== "active" || quantity > reservation.quantity) throw new WorkflowError("INVALID_QUANTITY", "Release exceeds the active reservation.", 409);
  const result: WorkflowResult = { message: `${quantity} reserved units released back to availability.`, impact: { physical: "On-hand inventory unchanged.", reservedDelta: -quantity, availableDelta: quantity, onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM reservations r WHERE r.id=? AND r.status='active' AND r.quantity>=?
        AND EXISTS (SELECT 1 FROM inventory_balances ib WHERE ib.product_id=r.product_id AND ib.location_id=r.location_id AND ib.reserved_qty>=?)`)
      .bind(...claimValues(command, result, id), id, quantity, quantity),
    db.prepare(`UPDATE reservations SET quantity=quantity-?,status=CASE WHEN quantity-?<=0 THEN 'released' ELSE 'active' END WHERE id=? AND status='active' AND quantity>=? AND ${marker(command)}`).bind(quantity, quantity, id, quantity),
    db.prepare(`UPDATE inventory_balances SET reserved_qty=reserved_qty-?,version=version+1 WHERE product_id=? AND location_id=? AND reserved_qty>=? AND ${marker(command)}`).bind(quantity, reservation.productId, reservation.locationId, quantity),
    auditStatement(command, "reservation", id, "reservation_released", result.message, { quantity, reason }, when),
    outboxStatement(command, "reservation.released", "reservation", id, { quantity }, when),
  ]);
  return finish(command);
}

async function reallocateReservation(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId"); const payload = command.payload ?? {};
  const targetLineId = textValue(payload, "targetSalesOrderLineId"); const targetLocationId = textValue(payload, "targetLocationId");
  const source = await first<{ quantity: number; productId: string; locationId: string; salesLineId: string; status: string }>("SELECT quantity,product_id AS productId,location_id AS locationId,sales_order_line_id AS salesLineId,status FROM reservations WHERE id=?", id);
  if (!source) throw new WorkflowError("NOT_FOUND", "Source reservation was not found.", 404);
  const quantity = await baseQuantity(source.productId, numberValue(payload, "quantity")); const reason = textValue(payload, "reason");
  if (source.status !== "active" || source.quantity < quantity) throw new WorkflowError("INVALID_RESERVATION", "Source reservation cannot supply this reallocation.", 409);
  if (source.salesLineId === targetLineId) throw new WorkflowError("INVALID_RESERVATION", "Select a different sales-order demand line for reallocation.", 409);
  const target = await first<{ productId: string; route: string; allocated: string | null; remainingDemand: number; orderStatus: string }>(`SELECT sol.product_id AS productId,sol.fulfillment_route AS route,sol.linked_purchase_order_line_id AS allocated,
      sol.ordered_qty-sol.canceled_qty
        -COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol.id),0)
        -COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.sales_order_line_id=sol.id AND r.status='active'),0) AS remainingDemand,
      so.lifecycle_status AS orderStatus
    FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id WHERE sol.id=?`, targetLineId);
  if (!target || target.productId !== source.productId) throw new WorkflowError("PRODUCT_MISMATCH", "Target demand must use the same product.", 409);
  if (target.orderStatus !== "confirmed") throw new WorkflowError("INVALID_STATE", "Target demand must belong to a confirmed sales order.", 409);
  if (target.route === "drop_ship") throw new WorkflowError("INVALID_FULFILLMENT_ROUTE", "Drop-ship demand cannot reserve internal inventory.", 409);
  if (target.route === "special_order" && target.allocated) throw new WorkflowError("SPECIAL_ORDER_ALLOCATED", "This special-order demand already has dedicated supply and cannot take another allocation.", 409);
  if (target.remainingDemand < quantity) throw new WorkflowError("OVER_ALLOCATION", "Reallocation exceeds the target line's remaining unreserved demand.", 409);
  const targetLocation = await first<{ status: string; active: number }>("SELECT inventory_status AS status,active FROM locations WHERE id=?", targetLocationId);
  if (!targetLocation || !targetLocation.active || targetLocation.status !== "usable") throw new WorkflowError("INVALID_LOCATION", "Target reservations require an active usable location.", 409);
  if (targetLocationId !== source.locationId) {
    const targetBalance = await first<{ available: number }>("SELECT on_hand_qty-reserved_qty AS available FROM inventory_balances WHERE product_id=? AND location_id=?", source.productId, targetLocationId);
    if (!targetBalance || targetBalance.available < quantity) throw new WorkflowError("INSUFFICIENT_AVAILABILITY", "Target location lacks available stock.", 409);
  }
  const targetReservationId = newId("reservation"); const result: WorkflowResult = { message: `${quantity} units reallocated to the selected demand.`, impact: { physical: "On-hand unchanged.", commercial: "Allocation moved between demands.", reservedDelta: 0, availableDelta: 0, onHandDelta: 0 }, recordId: targetReservationId };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM reservations r WHERE r.id=? AND r.status='active' AND r.quantity>=?
        AND EXISTS (SELECT 1 FROM inventory_balances source_balance WHERE source_balance.product_id=r.product_id AND source_balance.location_id=r.location_id AND source_balance.reserved_qty>=?)
        AND (?=? OR EXISTS (SELECT 1 FROM inventory_balances target_balance WHERE target_balance.product_id=? AND target_balance.location_id=? AND target_balance.on_hand_qty-target_balance.reserved_qty>=?))
        AND EXISTS (SELECT 1 FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id WHERE sol.id=? AND so.lifecycle_status='confirmed'
          AND sol.ordered_qty-sol.canceled_qty
            -COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol.id),0)
            -COALESCE((SELECT SUM(target_res.quantity) FROM reservations target_res WHERE target_res.sales_order_line_id=sol.id AND target_res.status='active'),0)>=?)`)
      .bind(...claimValues(command, result, targetReservationId), id, quantity, quantity, source.locationId, targetLocationId, source.productId, targetLocationId, quantity, targetLineId, quantity),
    db.prepare(`UPDATE reservations SET quantity=quantity-?,status=CASE WHEN quantity-?<=0 THEN 'released' ELSE 'active' END WHERE id=? AND status='active' AND quantity>=? AND ${marker(command)}`).bind(quantity, quantity, id, quantity),
    db.prepare(`UPDATE inventory_balances SET reserved_qty=reserved_qty-?,version=version+1 WHERE product_id=? AND location_id=? AND reserved_qty>=? AND ${marker(command)}`).bind(quantity, source.productId, source.locationId, quantity),
    db.prepare(`UPDATE inventory_balances SET reserved_qty=reserved_qty+?,version=version+1 WHERE product_id=? AND location_id=? AND on_hand_qty-reserved_qty>=? AND ${marker(command)}`).bind(quantity, source.productId, targetLocationId, quantity),
    db.prepare(`INSERT INTO reservations (id,sales_order_line_id,product_id,location_id,quantity,status,created_at) SELECT ?,?,?,?,?,'active',? WHERE ${marker(command)}`).bind(targetReservationId, targetLineId, source.productId, targetLocationId, quantity, when),
    auditStatement(command, "reservation", id, "reservation_reallocated", result.message, { targetReservationId, targetLineId, quantity, reason }, when),
    outboxStatement(command, "reservation.reallocated", "reservation", id, { targetReservationId, quantity }, when),
  ]);
  return finish(command);
}

async function reverseShipment(command: WorkflowCommand) {
  const shipmentId = textValue({ entityId: command.entityId }, "entityId");
  const payload = command.payload ?? {};
  const quantity = roundQuantity(numberValue(payload, "quantity"));
  const reason = textValue(payload, "reason");
  const lineId = optionalText(payload, "lineId");
  const postingDate = dateValue(payload, "postingDate", today());
  await assertPeriodOpen("inventory", postingDate);
  const source = await first<{
    movementId: string; productId: string; locationId: string; inventoryStatus: string; salesLineId: string;
    shipped: number; reversed: number; shipmentVersion: number; salesOrderId: string; orderVersion: number;
    orderStatus: string; invoiced: number; returned: number; trackingPolicy: string; lotId: string | null; unitId: string | null; assignedQuantity: number;
  }>(`SELECT sm.id AS movementId,sm.product_id AS productId,sm.from_location_id AS locationId,sm.inventory_status AS inventoryStatus,
      sm.sales_order_line_id AS salesLineId,-sm.quantity AS shipped,
      COALESCE((SELECT SUM(r.quantity) FROM stock_movements r WHERE r.reversal_of_movement_id=sm.id AND r.movement_type='shipment_reversal'),0) AS reversed,
      s.version AS shipmentVersion,so.id AS salesOrderId,so.version AS orderVersion,so.lifecycle_status AS orderStatus,
      COALESCE((SELECT SUM(cil.quantity) FROM customer_invoice_lines cil JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id WHERE cil.sales_order_line_id=sm.sales_order_line_id AND ci.status<>'void'),0) AS invoiced,
      COALESCE((SELECT SUM(cr.quantity) FROM customer_returns cr WHERE cr.sales_order_line_id=sm.sales_order_line_id),0) AS returned,
      p.tracking_policy AS trackingPolicy,
      COALESCE(sm.lot_id,(SELECT ma.lot_id FROM movement_assignments ma WHERE ma.movement_id=sm.id AND ma.lot_id IS NOT NULL LIMIT 1)) AS lotId,
      COALESCE(sm.inventory_unit_id,(SELECT ma.inventory_unit_id FROM movement_assignments ma WHERE ma.movement_id=sm.id AND ma.inventory_unit_id IS NOT NULL LIMIT 1)) AS unitId,
      COALESCE((SELECT SUM(ma.quantity) FROM movement_assignments ma WHERE ma.movement_id=sm.id),0) AS assignedQuantity
    FROM stock_movements sm
    JOIN shipments s ON s.id=sm.source_document_id
    JOIN sales_orders so ON so.id=s.sales_order_id
    JOIN products p ON p.id=sm.product_id
    WHERE sm.source_document_type='shipment' AND sm.movement_type='sales_shipment' AND sm.source_document_id=?
      AND (? IS NULL OR sm.source_line_id=?)
    ORDER BY sm.posted_at DESC,sm.id LIMIT 1`, shipmentId, lineId, lineId);
  if (!source) throw new WorkflowError("NOT_FOUND", "Posted shipment movement was not found.", 404);
  if (command.version !== source.shipmentVersion) throw new WorkflowError("VERSION_CONFLICT", "Shipment changed; refresh before reversal.", 409, source.shipmentVersion);
  if (!["confirmed", "canceled"].includes(source.orderStatus)) throw new WorkflowError("INVALID_STATE", "Only shipments for confirmed or canceled sales orders can be reversed.", 409);
  if (quantity > source.shipped - source.reversed) throw new WorkflowError("INVALID_QUANTITY", "Reversal exceeds the unreversed shipment quantity.", 409);
  if (source.trackingPolicy === "lot" && (!source.lotId || source.assignedQuantity < quantity)) throw new WorkflowError("LOT_ASSIGNMENT_REQUIRED", "The original tracked shipment does not contain enough immutable lot assignment to reverse.", 409);
  if (source.trackingPolicy === "serial") {
    if (quantity !== 1 || !source.unitId || source.assignedQuantity < 1) throw new WorkflowError("SERIAL_ASSIGNMENT_REQUIRED", "The original serial-tracked shipment is missing its unit assignment.", 409);
    const unit = await first<{ lifecycleStatus: string; version: number }>("SELECT lifecycle_status AS lifecycleStatus,version FROM inventory_units WHERE id=? AND product_id=?", source.unitId, source.productId);
    if (!unit || unit.lifecycleStatus !== "shipped") throw new WorkflowError("INVALID_SERIAL_STATE", "The shipped serial is not in a reversible shipped lifecycle state.", 409);
  }
  const netShipped = await first<{ quantity: number }>(`SELECT COALESCE(SUM(CASE WHEN movement_type='sales_shipment' THEN -quantity WHEN movement_type='shipment_reversal' THEN -quantity ELSE 0 END),0) AS quantity FROM stock_movements WHERE sales_order_line_id=?`, source.salesLineId);
  if (Number(netShipped?.quantity ?? 0) - quantity < source.invoiced) {
    throw new WorkflowError("INVOICED_SHIPMENT", "Credit or reverse the related customer invoice before reversing this shipped quantity.", 409);
  }
  if (Number(netShipped?.quantity ?? 0) - quantity < source.returned) {
    throw new WorkflowError("RETURNED_SHIPMENT", "This shipped quantity has already been received through a customer return and cannot also be reversed as a shipment correction.", 409);
  }
  const historical = await first<{ quantity: number; value: number; restored: number; method: string }>(`SELECT COALESCE(SUM(-quantity),0) AS quantity,COALESCE(SUM(-value_cents),0) AS value,
      COALESCE((SELECT SUM(reversal_value.value_cents) FROM inventory_value_entries reversal_value JOIN stock_movements reversal_movement ON reversal_movement.id=reversal_value.movement_id WHERE reversal_movement.reversal_of_movement_id=? AND reversal_movement.movement_type='shipment_reversal'),0) AS restored,
      MAX(cost_method) AS method FROM inventory_value_entries WHERE movement_id=? AND quantity<0`, source.movementId, source.movementId);
  const historicalQuantity = Number(historical?.quantity ?? 0);
  if (historicalQuantity <= 0) throw new WorkflowError("VALUATION_HISTORY_MISSING", "The shipment has no immutable value entry to reverse.", 409);
  const unitCost = Math.round(Number(historical?.value ?? 0) / historicalQuantity);
  const remainingReversible = source.shipped - source.reversed;
  const valueCents = quantity === remainingReversible ? Number(historical?.value ?? 0) - Number(historical?.restored ?? 0) : Math.round(quantity * unitCost);
  const policy = await first<{ method: string; averageCost: number; version: number }>("SELECT method,average_cost_cents AS averageCost,version FROM valuation_policies WHERE product_id=?", source.productId);
  const totalOnHand = await first<{ quantity: number }>("SELECT COALESCE(SUM(on_hand_qty),0) AS quantity FROM inventory_balances WHERE product_id=?", source.productId);
  const nextAverage = Math.round(((Number(totalOnHand?.quantity ?? 0) * Number(policy?.averageCost ?? unitCost)) + valueCents) / (Number(totalOnHand?.quantity ?? 0) + quantity));
  const movementId = newId("movement");
  const result: WorkflowResult = { message: `${quantity} shipped units reversed into usable stock.`, impact: { physical: `${quantity} units restored to on-hand.`, commercial: source.orderStatus === "canceled" ? `${quantity} units were removed from fulfillment history; canceled demand remains closed.` : `${quantity} units reopened for fulfillment.`, financial: `COGS was reversed by ${valueCents} cents; customer invoices remain separate.`, onHandDelta: quantity }, recordId: movementId };
  const serialUnit = source.unitId ? await first<{ version: number }>("SELECT version FROM inventory_units WHERE id=?", source.unitId) : null;
  const reverseTrackingClaim = source.trackingPolicy === "quantity"
    ? { sql: "1=1", bindings: [] as unknown[] }
    : source.trackingPolicy === "lot"
      ? { sql: "EXISTS (SELECT 1 FROM movement_assignments ma WHERE ma.movement_id=? AND ma.lot_id=? AND ma.quantity>=?)", bindings: [source.movementId, source.lotId, quantity] as unknown[] }
      : { sql: "EXISTS (SELECT 1 FROM movement_assignments ma JOIN inventory_units iu ON iu.id=ma.inventory_unit_id WHERE ma.movement_id=? AND ma.inventory_unit_id=? AND ma.quantity>=1 AND iu.product_id=? AND iu.lifecycle_status='shipped' AND iu.version=?)", bindings: [source.movementId, source.unitId, source.productId, serialUnit?.version ?? 0] as unknown[] };
  const db = commandD1(command); const when = new Date().toISOString(); const postedAt = timestampOnDate(postingDate, when);
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM shipments s WHERE s.id=? AND s.version=?
        AND EXISTS (SELECT 1 FROM sales_orders so WHERE so.id=? AND so.version=? AND so.lifecycle_status IN ('confirmed','canceled'))
        AND EXISTS (SELECT 1 FROM stock_movements original WHERE original.id=? AND -original.quantity-COALESCE((SELECT SUM(r.quantity) FROM stock_movements r WHERE r.reversal_of_movement_id=original.id AND r.movement_type='shipment_reversal'),0)>=?)
        AND COALESCE((SELECT SUM(CASE WHEN movement_type='sales_shipment' THEN -quantity WHEN movement_type='shipment_reversal' THEN -quantity ELSE 0 END) FROM stock_movements WHERE sales_order_line_id=?),0)-?
          >=COALESCE((SELECT SUM(cil.quantity) FROM customer_invoice_lines cil JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id WHERE cil.sales_order_line_id=? AND ci.status<>'void'),0)
        AND COALESCE((SELECT SUM(CASE WHEN movement_type='sales_shipment' THEN -quantity WHEN movement_type='shipment_reversal' THEN -quantity ELSE 0 END) FROM stock_movements WHERE sales_order_line_id=?),0)-?
          >=COALESCE((SELECT SUM(cr.quantity) FROM customer_returns cr WHERE cr.sales_order_line_id=?),0)
        AND COALESCE((SELECT version FROM valuation_policies WHERE product_id=?),0)=? AND ${reverseTrackingClaim.sql}`)
      .bind(...claimValues(command, result, movementId), shipmentId, source.shipmentVersion, source.salesOrderId, source.orderVersion, source.movementId, quantity, source.salesLineId, quantity, source.salesLineId, source.salesLineId, quantity, source.salesLineId, source.productId, policy?.version ?? 0, ...reverseTrackingClaim.bindings),
    db.prepare(`UPDATE shipments SET version=version+1,status=CASE WHEN NOT EXISTS (
      SELECT 1 FROM stock_movements original WHERE original.source_document_type='shipment' AND original.source_document_id=shipments.id AND original.movement_type='sales_shipment'
        AND -original.quantity-COALESCE((SELECT SUM(reversal.quantity) FROM stock_movements reversal WHERE reversal.reversal_of_movement_id=original.id AND reversal.movement_type='shipment_reversal'),0)
          -CASE WHEN original.id=? THEN ? ELSE 0 END>0
      ) THEN 'reversed' ELSE 'partially_reversed' END WHERE id=? AND version=? AND ${marker(command)}`).bind(source.movementId, quantity, shipmentId, source.shipmentVersion),
    db.prepare(`UPDATE sales_orders SET version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(source.salesOrderId, source.orderVersion),
    db.prepare(`INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) SELECT ?,?,?,0,1 WHERE ${marker(command)} ON CONFLICT(product_id,location_id) DO UPDATE SET on_hand_qty=on_hand_qty+excluded.on_hand_qty,version=version+1`).bind(source.productId, source.locationId, quantity),
    db.prepare(`INSERT INTO stock_movements (id,movement_type,product_id,quantity,to_location_id,inventory_status,source_document_type,source_document_id,sales_order_line_id,reversal_of_movement_id,posted_at,posted_by,unit_cost_cents,idempotency_key)
      SELECT ?,'shipment_reversal',?,?,?,?, 'shipment_reversal',?,?,?, ?,?,?,? WHERE ${marker(command)}`).bind(movementId, source.productId, quantity, source.locationId, source.inventoryStatus, shipmentId, source.salesLineId, source.movementId, postedAt, command.actor.label, unitCost, command.idempotencyKey),
    db.prepare(`INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
      SELECT ?,?,?,?,?,?,0,?,'open' WHERE ${marker(command)}`).bind(newId("layer"), source.productId, movementId, quantity, quantity, unitCost, postedAt),
    db.prepare(`INSERT INTO inventory_value_entries (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
      SELECT ?,?,?,'shipment_reversal',?,?,?,?, 'shipment',?,?,? WHERE ${marker(command)}`).bind(newId("value"), source.productId, movementId, quantity, unitCost, valueCents, historical?.method ?? policy?.method ?? "fifo", shipmentId, postedAt, command.actor.label),
    auditStatement(command, "shipment", shipmentId, "shipment_reversed", result.message, { quantity, reason, movementId, originalMovementId: source.movementId, cogsReversedCents: valueCents }, when),
    outboxStatement(command, "shipment.reversed", "shipment", shipmentId, { quantity, movementId, cogsReversedCents: valueCents }, when),
  ];
  if (source.orderStatus === "canceled") statements.push(
    db.prepare(`UPDATE sales_order_lines SET canceled_qty=MIN(ordered_qty,canceled_qty+?) WHERE id=? AND ${marker(command)}`).bind(quantity, source.salesLineId),
  );
  if (policy?.method === "average") {
    statements.push(db.prepare(`UPDATE valuation_policies SET average_cost_cents=?,version=version+1,updated_at=?,updated_by=? WHERE product_id=? AND version=? AND method='average' AND ${marker(command)}`).bind(nextAverage, when, command.actor.label, source.productId, policy.version));
  }
  if (source.trackingPolicy !== "quantity") {
    statements.push(db.prepare(`INSERT INTO movement_assignments (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${marker(command)}`).bind(newId("assignment"), movementId, source.lotId, source.unitId, quantity));
  }
  if (source.trackingPolicy === "serial") {
    statements.push(db.prepare(`UPDATE inventory_units SET location_id=?,inventory_status=?,lifecycle_status='on_hand',allocated_sales_order_line_id=NULL,version=version+1 WHERE id=? AND product_id=? AND lifecycle_status='shipped' AND version=? AND ${marker(command)}`).bind(source.locationId, source.inventoryStatus, source.unitId, source.productId, serialUnit?.version ?? 0));
  }
  await db.batch(statements);
  return finish(command);
}

async function registerIdentity(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const productId = command.entityId ?? textValue(payload, "productId");
  const locationId = textValue(payload, "locationId");
  const sourceMovementId = optionalText(payload, "sourceMovementId");
  const lotNumber = optionalText(payload, "lotNumber") ?? "";
  const serialNumber = optionalText(payload, "serialNumber") ?? "";
  const product = await first<{ policy: string; active: number }>("SELECT tracking_policy AS policy,active FROM products WHERE id=?", productId);
  if (!product || !product.active) throw new WorkflowError("INVALID_PRODUCT", "An active product is required.", 404);
  if (product.policy === "quantity") throw new WorkflowError("TRACKING_POLICY_MISMATCH", "Quantity-tracked products do not use lot or serial identity registration.", 409);
  if (product.policy === "lot" && (!lotNumber || serialNumber)) throw new WorkflowError("LOT_ASSIGNMENT_REQUIRED", "A lot-tracked product requires lotNumber and cannot register a serial.", 409);
  if (product.policy === "serial" && !serialNumber) throw new WorkflowError("SERIAL_ASSIGNMENT_REQUIRED", "A serial-tracked product requires serialNumber.", 409);
  const quantity = product.policy === "serial" ? 1 : roundQuantity(numberValue(payload, "quantity"));
  const location = await first<{ status: string; active: number }>("SELECT inventory_status AS status,active FROM locations WHERE id=?", locationId);
  if (!location || !location.active) throw new WorkflowError("INVALID_LOCATION", "An active location is required.", 409);
  const requestedStatus = textValue(payload, "inventoryStatus", location.status);
  if (requestedStatus !== location.status) throw new WorkflowError("INVENTORY_STATUS_MISMATCH", "Identity status must match the physical location status.", 409);
  const balance = await first<{ onHand: number; identified: number }>(`SELECT ib.on_hand_qty AS onHand,
      COALESCE((SELECT SUM(CASE WHEN sm.to_location_id=? THEN ma.quantity WHEN sm.from_location_id=? THEN -ma.quantity ELSE 0 END) FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id WHERE sm.product_id=?),0) AS identified
    FROM inventory_balances ib WHERE ib.product_id=? AND ib.location_id=?`, locationId, locationId, productId, productId, locationId);
  if (!balance || roundQuantity(balance.identified + quantity) > roundQuantity(balance.onHand)) throw new WorkflowError("UNIDENTIFIED_QUANTITY_SHORTAGE", "This location does not have enough unassigned physical on-hand quantity for the identity.", 409);
  const source = await first<{ id: string; quantity: number; assigned: number; inventoryStatus: string }>(`SELECT sm.id,sm.quantity,sm.inventory_status AS inventoryStatus,COALESCE(SUM(ma.quantity),0) AS assigned
    FROM stock_movements sm LEFT JOIN movement_assignments ma ON ma.movement_id=sm.id
    WHERE sm.product_id=? AND sm.to_location_id=? AND sm.quantity>0 AND (? IS NULL OR sm.id=?)
    GROUP BY sm.id HAVING sm.quantity-COALESCE(SUM(ma.quantity),0)>=?
    ORDER BY sm.posted_at,sm.id LIMIT 1`, productId, locationId, sourceMovementId, sourceMovementId, quantity);
  if (!source || source.inventoryStatus !== location.status) throw new WorkflowError("SOURCE_MOVEMENT_REQUIRED", "Select a positive, unassigned source movement at this product, location, and status.", 409);
  const existingLot = lotNumber ? await first<{ id: string; status: string }>("SELECT id,status FROM inventory_lots WHERE product_id=? AND lot_number=?", productId, lotNumber) : null;
  if (existingLot && existingLot.status !== "active") throw new WorkflowError("INVALID_LOT", "The existing lot is not active.", 409);
  const requestedLotId = optionalText(payload, "lotId");
  if (requestedLotId && lotNumber) throw new WorkflowError("VALIDATION_ERROR", "Provide lotId or lotNumber, not both.");
  const referencedLot = requestedLotId ? await first<{ id: string; status: string }>("SELECT id,status FROM inventory_lots WHERE id=? AND product_id=?", requestedLotId, productId) : null;
  if (requestedLotId && (!referencedLot || referencedLot.status !== "active")) throw new WorkflowError("INVALID_LOT", "lotId is not active for this product.", 409);
  const lotId = referencedLot?.id ?? existingLot?.id ?? (lotNumber ? newId("lot") : null);
  if (product.policy === "lot" && !lotId) throw new WorkflowError("LOT_ASSIGNMENT_REQUIRED", "A lot identity is required.", 409);
  if (serialNumber && await first("SELECT id FROM inventory_units WHERE product_id=? AND serial_number=?", productId, serialNumber)) throw new WorkflowError("DUPLICATE_SERIAL", "This serial number is already registered for the product.", 409);
  const unitId = serialNumber ? newId("unit") : null;
  const recordId = unitId ?? lotId!;
  const result: WorkflowResult = { message: serialNumber ? `Serial ${serialNumber} registered against existing on-hand movement ${source.id}.` : `${quantity} units assigned to lot ${lotNumber || lotId}.`, impact: { physical: "Identity assignment only; on-hand is unchanged.", trackingPolicy: product.policy, assignedQuantity: quantity, onHandDelta: 0 }, recordId };
  const db = commandD1(command); const when = new Date().toISOString();
  const serialClaim = serialNumber ? "AND NOT EXISTS (SELECT 1 FROM inventory_units WHERE product_id=? AND serial_number=?)" : "";
  const claimBindings = serialNumber ? [productId, serialNumber] : [];
  const statements: D1PreparedStatement[] = [db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
    SELECT ?,?,?,?,?,?,? FROM stock_movements sm WHERE sm.id=? AND sm.product_id=? AND sm.to_location_id=? AND sm.quantity>0 AND sm.inventory_status=?
      AND sm.quantity-COALESCE((SELECT SUM(ma.quantity) FROM movement_assignments ma WHERE ma.movement_id=sm.id),0)>=? ${serialClaim}`)
    .bind(...claimValues(command, result, recordId), source.id, productId, locationId, location.status, quantity, ...claimBindings)];
  if (lotId && !existingLot && !referencedLot) statements.push(db.prepare(`INSERT INTO inventory_lots (id,product_id,lot_number,vendor_id,manufactured_date,expiry_date,status,created_at) SELECT ?,?,?,?,?,?,'active',? WHERE ${marker(command)}`).bind(lotId, productId, lotNumber, payload.vendorId ?? null, payload.manufacturedDate ?? null, payload.expiryDate ?? null, when));
  if (unitId) statements.push(db.prepare(`INSERT INTO inventory_units (id,product_id,serial_number,lot_id,location_id,inventory_status,lifecycle_status,allocated_sales_order_line_id,version,created_at) SELECT ?,?,?,?,?,?,'on_hand',NULL,1,? WHERE ${marker(command)}`).bind(unitId, productId, serialNumber, lotId, locationId, location.status, when));
  statements.push(
    db.prepare(`INSERT INTO movement_assignments (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${marker(command)}`).bind(newId("assignment"), source.id, lotId, unitId, quantity),
    auditStatement(command, "product", productId, "inventory_identity_registered", result.message, { lotId, unitId, locationId, sourceMovementId: source.id, quantity }, when),
    outboxStatement(command, "inventory.identity_registered", "product", productId, { lotId, unitId, sourceMovementId: source.id, quantity }, when)
  );
  await db.batch(statements); return finish(command);
}

async function updatePolicy(command: WorkflowCommand) {
  const payload = command.payload ?? {}; const key = textValue(payload, "key"); const reason = textValue(payload, "reason");
  if (!("value" in payload)) throw new WorkflowError("VALIDATION_ERROR", "value is required.");
  const allowedKeys = new Set(["receiving.overReceiptPolicy","inventory.countApprovalThreshold","inventory.scrapApprovalThresholdCents","inventory.reorderPointRule","matching.tolerances","tax.defaultRateBps","valuation.defaultMethod","inventory.negativeAllowed","security.defaultRole"]);
  if(!allowedKeys.has(key)) throw new WorkflowError("INVALID_SETTING","This setting is not supported by the transaction engine.",400);
  const value = payload.value;
  const policyObject = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const nonNegative = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0;
  if(key==="inventory.negativeAllowed"&&value!==false) throw new WorkflowError("UNSUPPORTED_SETTING","Negative inventory cannot be enabled because transaction guards require non-negative on-hand and reserved balances.",409);
  if(key==="tax.defaultRateBps"&&(!Number.isInteger(payload.value)||Number(payload.value)<0||Number(payload.value)>10000)) throw new WorkflowError("VALIDATION_ERROR","tax.defaultRateBps must be a whole number from 0 to 10000.");
  if(key==="valuation.defaultMethod"&&!['fifo','average','standard'].includes(String(payload.value))) throw new WorkflowError("VALIDATION_ERROR","valuation.defaultMethod must be fifo, average, or standard.");
  if(key==="security.defaultRole"&&!['viewer','operator','accounting'].includes(String(payload.value))) throw new WorkflowError("VALIDATION_ERROR","security.defaultRole must be viewer, operator, or accounting; managerial and administrator access require explicit assignment.");
  if(["inventory.scrapApprovalThresholdCents"].includes(key)&&(!Number.isSafeInteger(payload.value)||Number(payload.value)<0)) throw new WorkflowError("VALIDATION_ERROR",`${key} must be a non-negative whole number.`);
  if (key === "receiving.overReceiptPolicy" && (!policyObject || !nonNegative(policyObject.tolerancePct) || policyObject.toleranceQuantity != null && !nonNegative(policyObject.toleranceQuantity))) throw new WorkflowError("VALIDATION_ERROR", "receiving.overReceiptPolicy requires a non-negative tolerancePct and optional toleranceQuantity.");
  if (key === "inventory.countApprovalThreshold" && (!policyObject || !nonNegative(policyObject.absoluteQuantity) || !Number.isSafeInteger(policyObject.absoluteValueCents) || Number(policyObject.absoluteValueCents) < 0)) throw new WorkflowError("VALIDATION_ERROR", "inventory.countApprovalThreshold requires non-negative absoluteQuantity and whole-cent absoluteValueCents values.");
  if (key === "inventory.reorderPointRule" && (!policyObject || typeof policyObject.percent !== "number" || !Number.isFinite(policyObject.percent) || policyObject.percent <= 0 || policyObject.percent > 100 || typeof policyObject.applyToAllStocked !== "boolean")) throw new WorkflowError("VALIDATION_ERROR", "The reorder point rule requires a percentage greater than 0 and no more than 100, plus a valid application scope.");
  if (key === "matching.tolerances") {
    const kinds = policyObject?.allowedChargeKinds;
    if (!policyObject || !nonNegative(policyObject.quantity) || !Number.isSafeInteger(policyObject.unitPriceCents) || Number(policyObject.unitPriceCents) < 0 || !Number.isSafeInteger(policyObject.totalCents) || Number(policyObject.totalCents) < 0 || !Array.isArray(kinds) || kinds.some((kind) => typeof kind !== "string" || !supportedChargeTypes.has(kind))) throw new WorkflowError("VALIDATION_ERROR", "matching.tolerances requires non-negative quantity, whole-cent unitPriceCents/totalCents, and supported allowedChargeKinds.");
  }
  const current = await first<{ version: number; description: string }>("SELECT version,description FROM system_settings WHERE key=?", key);
  const version = command.version ?? 0;
  if (current && current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Setting changed; refresh before updating.", 409, current.version);
  const isReorderRule = key === "inventory.reorderPointRule";
  const applyToAllStocked = isReorderRule && policyObject!.applyToAllStocked === true;
  const affected = isReorderRule ? Number((await first<{ count: number }>(`SELECT COUNT(*) AS count FROM products WHERE active=1 AND inventory_policy='stocked' AND (?=1 OR reorder_rule_mode='global')`, applyToAllStocked ? 1 : 0))?.count ?? 0) : 0;
  const result: WorkflowResult = { message: isReorderRule ? `Company reorder rule updated; ${affected} stocked part${affected === 1 ? "" : "s"} now use ${policyObject!.percent}% of maximum stock.` : `${key} updated for future transactions; existing posted records are unchanged.`, impact: { physical: "No stock quantity moved.", financial: "No posting.", onHandDelta: 0, ...(isReorderRule ? { productMasterRecordsUpdated: affected } : {}) }, recordId: key };
  const db = commandD1(command); const when = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    current ? db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM system_settings WHERE key=? AND version=?").bind(...claimValues(command, result, key),key,version) : db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) VALUES (?,?,?,?,?,?,?)").bind(...claimValues(command, result, key)),
    current
      ? db.prepare(`UPDATE system_settings SET value_json=?,version=version+1,updated_by=?,updated_at=? WHERE key=? AND version=? AND ${marker(command)}`)
        .bind(JSON.stringify(value), command.actor.label, when, key, version)
      : db.prepare(`INSERT INTO system_settings (key,value_json,description,version,updated_by,updated_at) SELECT ?,?,?,1,?,? WHERE ${marker(command)}`)
        .bind(key, JSON.stringify(value), textValue(payload, "description", "Operational setting"), command.actor.label, when),
  ];
  if (isReorderRule) statements.push(db.prepare(`UPDATE products SET reorder_point=ROUND(max_stock_level*?/100,3),reorder_rule_mode='global',reorder_rule_percent=?,version=version+1 WHERE active=1 AND inventory_policy='stocked' AND (?=1 OR reorder_rule_mode='global') AND ${marker(command)}`).bind(policyObject!.percent, policyObject!.percent, applyToAllStocked ? 1 : 0));
  statements.push(
    auditStatement(command, "system_setting", key, "setting_updated", result.message, { reason, value }, when),
    outboxStatement(command, "setting.updated", "system_setting", key, { reason }, when),
  );
  await db.batch(statements); return finish(command);
}

async function setPeriodLock(command: WorkflowCommand, active: boolean) {
  const payload = command.payload ?? {}; const reason = textValue(payload, "reason");
  const current = active ? null : await first<{ module: string; lockedThrough: string; active: number; version: number }>("SELECT module,locked_through AS lockedThrough,active,version FROM period_locks WHERE id=?", command.entityId ?? "");
  if (!active && !current) throw new WorkflowError("NOT_FOUND", "Period lock was not found.", 404);
  if (!active && !current!.active) throw new WorkflowError("INVALID_STATE", "Period lock is already inactive.", 409);
  if (!active && current!.version !== (command.version ?? 0)) throw new WorkflowError("VERSION_CONFLICT", "Period lock changed; refresh before unlocking.", 409, current!.version);
  const moduleName = active ? textValue(payload, "module") : current!.module;
  if (!["accounting", "inventory", "purchasing", "sales", "all"].includes(moduleName)) throw new WorkflowError("VALIDATION_ERROR", "module must be accounting, inventory, purchasing, sales, or all.");
  const lockedThrough = active ? dateValue(payload, "lockedThrough") : current!.lockedThrough;
  const id = command.entityId ?? newId("period-lock"); const result: WorkflowResult = { message: active ? `${moduleName} locked through ${lockedThrough}.` : `${moduleName} period lock released.`, impact: { physical: "No posting.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  const claim = active
    ? db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) VALUES (?,?,?,?,?,?,?)").bind(...claimValues(command, result, id))
    : db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM period_locks WHERE id=? AND version=? AND active=1`).bind(...claimValues(command, result, id), id, current!.version);
  const write = active
    ? db.prepare(`INSERT INTO period_locks (id,module,locked_through,reason,active,version,created_by,created_at) SELECT ?,?,?,?,1,1,?,? WHERE ${marker(command)}`).bind(id, moduleName, lockedThrough, reason, command.actor.label, when)
    : db.prepare(`UPDATE period_locks SET active=0,reason=?,version=version+1 WHERE id=? AND version=? AND active=1 AND ${marker(command)}`).bind(reason, id, current!.version);
  const statements: D1PreparedStatement[] = [
    claim,
    write,
    auditStatement(command, "period_lock", id, active ? "period_locked" : "period_unlocked", result.message, { moduleName, lockedThrough, reason }, when),
    outboxStatement(command, active ? "period.locked" : "period.unlocked", "period_lock", id, { moduleName, lockedThrough }, when),
  ];
  await db.batch(statements); return finish(command);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function addCharge(command: WorkflowCommand) {
  const payload = command.payload ?? {}; const documentType = textValue(payload, "documentType"); const documentId = command.entityId ?? textValue(payload, "documentId");
  const chargeType = textValue(payload, "chargeType"); const description = textValue(payload, "description"); const amountCents = numberValue(payload, "amountCents", { integer: true });
  const taxRateBps = payload.taxRateBps == null ? 0 : numberValue(payload, "taxRateBps", { positive: false, integer: true }); if (taxRateBps < 0 || taxRateBps > 10000) throw new WorkflowError("VALIDATION_ERROR", "taxRateBps must be 0–10000.");
  const chargeId = newId("charge"); const result: WorkflowResult = { message: `${description} added separately from inventory item lines.`, impact: { physical: "No stock movement.", financial: `${amountCents} cents added to document charges.`, onHandDelta: 0 }, recordId: chargeId };
  const db = commandD1(command); const when = new Date().toISOString(); const taxable = payload.taxable === true;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) VALUES (?,?,?,?,?,?,?)").bind(...claimValues(command, result, chargeId)),
    db.prepare(`INSERT INTO document_charges (id,document_type,document_id,charge_type,description,amount_cents,direction,taxable,refundable,tax_code,tax_rate_bps,tax_amount_cents,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${marker(command)}`).bind(chargeId, documentType, documentId, chargeType, description, amountCents, payload.direction === "subtract" ? "subtract" : "add", taxable ? 1 : 0, payload.refundable === true ? 1 : 0, payload.taxCode ?? null, taxRateBps, taxable ? Math.round(amountCents*taxRateBps/10000) : 0, when),
    auditStatement(command, documentType, documentId, "document_charge_added", result.message, { chargeId, chargeType, amountCents }, when),
    outboxStatement(command, "document.charge_added", documentType, documentId, { chargeId }, when),
  ]); return finish(command);
}

async function issueReturnable(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const partnerId = textValue(payload, "partnerId");
  const assetTypeId = textValue(payload, "assetTypeId");
  const quantity = numberValue(payload, "quantity", { integer: true });
  const direction = textValue(payload, "direction", "customer_holds");
  const reason = textValue(payload, "reason");
  const postingDate = dateValue(payload, "postingDate", today());
  if (!['customer_holds', 'vendor_holds'].includes(direction)) throw new WorkflowError("VALIDATION_ERROR", "direction must be customer_holds or vendor_holds.");
  const partner = await first<{ type: string }>("SELECT partner_type AS type FROM business_partners WHERE id=? AND active=1", partnerId);
  if (!partner || (direction === "customer_holds" && !["customer", "both"].includes(partner.type)) || (direction === "vendor_holds" && !["vendor", "both"].includes(partner.type))) {
    throw new WorkflowError("INVALID_PARTNER", "The active partner type does not match the returnable custody direction.", 409);
  }
  const asset = await first<{ unitDeposit: number }>("SELECT unit_deposit_cents AS unitDeposit FROM returnable_asset_types WHERE id=? AND active=1", assetTypeId); if (!asset) throw new WorkflowError("NOT_FOUND", "Returnable asset type was not found.", 404);
  await assertPeriodOpen("inventory", postingDate);
  if (asset.unitDeposit > 0) await assertPeriodOpen("accounting", postingDate);
  const deposit = Math.round(quantity*asset.unitDeposit);
  const paymentMethod = deposit > 0 ? textValue(payload, "paymentMethod").toLowerCase() : "none";
  const paymentReference = deposit > 0 ? textValue(payload, "paymentReference") : "No deposit";
  if (deposit > 0 && !/^[a-z][a-z0-9_-]{1,39}$/.test(paymentMethod)) throw new WorkflowError("VALIDATION_ERROR", "paymentMethod must be a short method code such as bank_transfer, credit_card, cheque, or cash.");
  const obligationId = newId("returnable");
  const paymentId = deposit > 0 ? newId("payment") : null;
  const paymentNumber = deposit > 0 ? await nextDocumentNumber("PAY") : null;
  const result: WorkflowResult = { message: `${quantity} returnable assets issued; ${deposit} CAD cents of refundable deposit ${deposit > 0 ? "collected and posted" : "recorded"}.`, impact: { physical: "Sellable inventory unchanged.", returnableQuantityDelta: quantity, depositDeltaCents: deposit, paymentId, onHandDelta: 0 }, recordId: obligationId };
  const db = commandD1(command); const when = new Date().toISOString(); const postedAt = timestampOnDate(postingDate, when);
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM business_partners WHERE id=? AND active=1 AND partner_type IN (?, 'both'))
        AND EXISTS (SELECT 1 FROM returnable_asset_types WHERE id=? AND active=1 AND unit_deposit_cents=?)`)
      .bind(...claimValues(command, result, obligationId), partnerId, direction === "customer_holds" ? "customer" : "vendor", assetTypeId, asset.unitDeposit),
    db.prepare(`INSERT INTO returnable_obligations (id,partner_id,asset_type_id,direction,issued_qty,returned_qty,forfeited_qty,deposit_charged_cents,deposit_refunded_cents,status,version,created_at) SELECT ?,?,?,?, ?,0,0,?,0,'open',1,? WHERE ${marker(command)}`).bind(obligationId, partnerId, assetTypeId, direction, quantity, deposit, postedAt),
    db.prepare(`INSERT INTO returnable_events (id,obligation_id,event_type,quantity,amount_cents,reason,posted_at,posted_by) SELECT ?,?,'issue',?,?,?,?,? WHERE ${marker(command)}`).bind(newId("returnable-event"), obligationId, quantity, deposit, reason, postedAt, command.actor.label),
    auditStatement(command, "returnable_obligation", obligationId, "returnable_issued", result.message, { partnerId, assetTypeId, quantity, deposit, paymentId, paymentMethod, paymentReference }, when),
    outboxStatement(command, "returnable.issued", "returnable_obligation", obligationId, { quantity, deposit, paymentId }, when),
  ];
  if (paymentId && paymentNumber) statements.push(
    db.prepare(`INSERT INTO payments (id,number,direction,partner_id,document_type,document_id,amount_cents,payment_date,method,reference,posted_at,posted_by,currency,exchange_rate_to_base,base_amount_cents)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,1,? WHERE ${marker(command)}`)
      .bind(paymentId,paymentNumber,direction==="customer_holds"?"inbound":"outbound",partnerId,"returnable_deposit_collection",obligationId,deposit,postingDate,paymentMethod,paymentReference,when,command.actor.label,"CAD",deposit),
    auditStatement(command,"payment",paymentId,"returnable_deposit_collection_posted",`${paymentNumber} linked to returnable obligation ${obligationId}.`,{obligationId,partnerId,direction,amount:deposit,paymentMethod,paymentReference},when),
  );
  await db.batch(statements); return finish(command);
}

async function updateReturnable(command: WorkflowCommand, eventType: "return" | "forfeit" | "deposit_refund") {
  const id = textValue({ entityId: command.entityId }, "entityId"); const payload = command.payload ?? {}; const reason = textValue(payload, "reason"); const version = command.version ?? 0;
  const postingDate = dateValue(payload, "postingDate", today());
  await assertPeriodOpen(eventType === "deposit_refund" ? "accounting" : "inventory", postingDate);
  const obligation = await first<{ issued: number; returned: number; forfeited: number; charged: number; refunded: number; unitDeposit: number; version: number; partnerId: string; direction: string }>(`SELECT ro.issued_qty AS issued,ro.returned_qty AS returned,ro.forfeited_qty AS forfeited,ro.deposit_charged_cents AS charged,ro.deposit_refunded_cents AS refunded,CASE WHEN ro.issued_qty>0 THEN ROUND(ro.deposit_charged_cents/ro.issued_qty) ELSE 0 END AS unitDeposit,ro.version,ro.partner_id AS partnerId,ro.direction FROM returnable_obligations ro WHERE ro.id=?`, id);
  if (!obligation) throw new WorkflowError("NOT_FOUND", "Returnable obligation was not found.", 404); if (obligation.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Returnable obligation changed.", 409, obligation.version);
  const quantity = eventType === "deposit_refund" ? 0 : numberValue(payload, "quantity"); const outstanding = obligation.issued-obligation.returned-obligation.forfeited; if (quantity>outstanding) throw new WorkflowError("INVALID_QUANTITY", "Quantity exceeds the outstanding returnable obligation.",409);
  const refundableCents = Math.max(Math.min(obligation.charged, Math.round(obligation.returned * obligation.unitDeposit)) - obligation.refunded, 0);
  const amount = eventType === "deposit_refund" ? numberValue(payload,"amountCents",{integer:true}) : eventType === "forfeit" ? Math.round(quantity*obligation.unitDeposit) : 0; if (eventType === "deposit_refund" && amount>refundableCents) throw new WorkflowError("INVALID_AMOUNT","Refund exceeds the deposit attributable to physically returned assets.",409);
  if (eventType === "deposit_refund" && refundableCents <= 0) throw new WorkflowError("NOTHING_TO_REFUND", "No returned-asset deposit remains refundable.", 409);
  const result: WorkflowResult = { message: eventType === "return" ? `${quantity} returnables received; any refundable deposit remains pending an explicit refund.` : eventType === "forfeit" ? `${quantity} returnables forfeited and ${amount} cents removed from the refundable deposit balance.` : `${amount} cents of deposit refunded with a linked payment record.`, impact: { physical: "Sellable inventory unchanged.", returnableQuantityDelta: eventType === "deposit_refund" ? 0 : -quantity, depositDeltaCents: eventType === "deposit_refund" ? -amount : eventType === "forfeit" ? -amount : 0, onHandDelta: 0 }, recordId: id };
  const db=commandD1(command); const when=new Date().toISOString(); const postedAt=timestampOnDate(postingDate,when); const paymentId=eventType==="deposit_refund"?newId("payment"):null; const paymentNumber=eventType==="deposit_refund"?await nextDocumentNumber("PAY"):null;
  const statements:D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM returnable_obligations ro WHERE ro.id=? AND ro.version=?
        AND ro.issued_qty-ro.returned_qty-ro.forfeited_qty>=?
        AND (?<>'deposit_refund' OR ?<=MAX(MIN(ro.deposit_charged_cents,ROUND(ro.returned_qty*?))-ro.deposit_refunded_cents,0))`)
      .bind(...claimValues(command,result,id),id,version,quantity,eventType,amount,obligation.unitDeposit),
    db.prepare(`UPDATE returnable_obligations SET returned_qty=returned_qty+?,forfeited_qty=forfeited_qty+?,deposit_refunded_cents=deposit_refunded_cents+?,
      status=CASE
        WHEN issued_qty-(returned_qty+?)-(forfeited_qty+?)>0 THEN 'open'
        WHEN MIN(deposit_charged_cents,ROUND((returned_qty+?)*?))-(deposit_refunded_cents+?)>0 THEN 'awaiting_refund'
        ELSE 'closed' END,
      version=version+1 WHERE id=? AND version=? AND ${marker(command)}`)
      .bind(eventType==="return"?quantity:0,eventType==="forfeit"?quantity:0,eventType==="deposit_refund"?amount:0,eventType==="return"?quantity:0,eventType==="forfeit"?quantity:0,eventType==="return"?quantity:0,obligation.unitDeposit,eventType==="deposit_refund"?amount:0,id,version),
    db.prepare(`INSERT INTO returnable_events (id,obligation_id,event_type,quantity,amount_cents,reason,posted_at,posted_by) SELECT ?,?,?,?,?,?,?,? WHERE ${marker(command)}`).bind(newId("returnable-event"),id,eventType,quantity,amount,reason,postedAt,command.actor.label),
    auditStatement(command,"returnable_obligation",id,`returnable_${eventType}`,result.message,{quantity,amount,reason,paymentId},when),outboxStatement(command,`returnable.${eventType}`,"returnable_obligation",id,{quantity,amount,paymentId},when),
  ];
  if (paymentId && paymentNumber) statements.push(
    db.prepare(`INSERT INTO payments (id,number,direction,partner_id,document_type,document_id,amount_cents,payment_date,method,reference,posted_at,posted_by,currency,exchange_rate_to_base,base_amount_cents) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,1,? WHERE ${marker(command)}`).bind(paymentId,paymentNumber,obligation.direction==="customer_holds"?"outbound":"inbound",obligation.partnerId,"returnable_deposit_refund",id,amount,postingDate,"returnable_deposit_refund",reason,when,command.actor.label,"CAD",amount),
    auditStatement(command,"payment",paymentId,"returnable_deposit_refund_posted",`${paymentNumber} linked to returnable obligation ${id}.`,{obligationId:id,partnerId:obligation.partnerId,direction:obligation.direction,amount},when),
  );
  await db.batch(statements); return finish(command);
}

async function createVendorBill(command: WorkflowCommand, fastTrack = false) {
  const payload = command.payload ?? {};
  if (fastTrack) assertFastTrackAuthority(command, "financialWrite");
  const approvalReason = fastTrack ? textValue(payload, "approvalReason") : null;
  const purchaseOrderId = command.entityId ?? textValue(payload, "purchaseOrderId");
  const vendorInvoiceNumber = textValue(payload, "vendorInvoiceNumber");
  const invoiceDate = dateValue(payload, "invoiceDate", today());
  const dueDate = dateValue(payload, "dueDate", invoiceDate);
  if (dueDate < invoiceDate) throw new WorkflowError("VALIDATION_ERROR", "dueDate cannot be before invoiceDate.");
  await assertPeriodOpen("accounting", invoiceDate);
  const order = await first<{ vendorId: string; currency: string; exchange: number; version: number }>("SELECT vendor_id AS vendorId,currency,exchange_rate_to_base AS exchange,version FROM purchase_orders WHERE id=? AND lifecycle_status='approved' AND ordered_at IS NOT NULL", purchaseOrderId);
  if (!order) throw new WorkflowError("NOT_FOUND", "An ordered purchase order was not found. Mark the approved PO as ordered before creating its bill.", 404);
  if (command.version != null && command.version !== order.version) throw new WorkflowError("VERSION_CONFLICT", "Purchase order changed; refresh before billing.", 409, order.version);
  if (await first("SELECT id FROM vendor_bills WHERE vendor_id=? AND vendor_invoice_number=?", order.vendorId, vendorInvoiceNumber)) {
    throw new WorkflowError("DUPLICATE_VENDOR_INVOICE", "This vendor invoice number already exists for the vendor.", 409);
  }
  const requestedLines = Array.isArray(payload.lines) ? payload.lines as Array<Record<string, unknown>> : [];
  if (!requestedLines.length) throw new WorkflowError("VALIDATION_ERROR", "At least one vendor bill line is required.");
  const requestedLineIds = requestedLines.map((line) => textValue(line, "purchaseOrderLineId"));
  if (new Set(requestedLineIds).size !== requestedLineIds.length) throw new WorkflowError("DUPLICATE_DOCUMENT_LINE", "Each purchase-order line may appear only once on a vendor bill.");
  const tolerances = await setting<{ quantity: number; unitPriceCents: number; totalCents: number; allowedChargeKinds: string[] }>("matching.tolerances", { quantity: 0, unitPriceCents: 0, totalCents: 0, allowedChargeKinds: [] });
  const normalized: Array<{ poLineId: string; productId: string; quantity: number; unitCost: number; poCost: number; lineTotal: number; status: string; aheadOfReceipt: boolean; details: unknown }> = [];
  const exceptions: Array<Record<string, unknown>> = [];
  for (const [index, line] of requestedLines.entries()) {
    const poLineId = requestedLineIds[index];
    const quantity = roundQuantity(numberValue(line, "quantity"));
    const unitCost = numberValue(line, "unitCostCents", { integer: true });
    const poLine = await first<{ productId: string; ordered: number; poCost: number; received: number; billed: number; route: string }>(`SELECT pol.product_id AS productId,pol.ordered_qty AS ordered,pol.unit_cost_cents AS poCost,pol.fulfillment_route AS route,
        CASE WHEN pol.fulfillment_route='drop_ship'
          THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0)
          ELSE COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0) END AS received,
        COALESCE((SELECT SUM(vbl.quantity) FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id WHERE vbl.purchase_order_line_id=pol.id AND vb.status<>'void'),0) AS billed
      FROM purchase_order_lines pol WHERE pol.id=? AND pol.purchase_order_id=?`, poLineId, purchaseOrderId);
    if (!poLine) throw new WorkflowError("INVALID_PO_LINE", `Bill line ${index + 1} is not linked to this PO.`, 409);
    const lineExceptions: Array<Record<string, unknown>> = [];
    const remainingReceived = roundQuantity(poLine.received - poLine.billed);
    const remainingOrdered = roundQuantity(poLine.ordered - poLine.billed);
    // Billing more than the vendor was asked to supply is a hard stop that needs a PO amendment.
    // Billing ahead of the goods is ordinary invoice-before-receipt: the bill posts on hold with the
    // exception recorded and the hold is released once the receipt exists.
    if (quantity > remainingOrdered + tolerances.quantity) {
      throw new WorkflowError("BILLED_ABOVE_ORDERED", `Bill line ${index + 1} bills ${quantity} against ${remainingOrdered} unbilled ordered unit${remainingOrdered === 1 ? "" : "s"}${tolerances.quantity ? ` (tolerance ${tolerances.quantity})` : ""}. Amend the purchase order before billing above it.`, 409);
    }
    const aheadOfReceipt = quantity > remainingReceived + tolerances.quantity;
    if (aheadOfReceipt) lineExceptions.push({ code: poLine.route === "drop_ship" ? "BILL_BEFORE_DELIVERY" : "BILL_BEFORE_RECEIPT", severity: "blocking", variance: roundQuantity(quantity - remainingReceived) });
    if (Math.abs(unitCost - poLine.poCost) > tolerances.unitPriceCents) lineExceptions.push({ code: "UNIT_PRICE_VARIANCE", severity: "approval", varianceCents: unitCost - poLine.poCost });
    exceptions.push(...lineExceptions.map((item) => ({ ...item, lineId: poLineId })));
    normalized.push({ poLineId, productId: poLine.productId, quantity, unitCost, poCost: poLine.poCost, lineTotal: Math.round(quantity * unitCost), status: lineExceptions.length ? "exception" : "matched", aheadOfReceipt, details: { exceptions: lineExceptions, ordered: poLine.ordered, netReceived: poLine.received, previouslyBilled: poLine.billed, remainingReceived, poUnitCostCents: poLine.poCost } });
  }
  const charges = (Array.isArray(payload.charges) ? payload.charges as Array<Record<string, unknown>> : []).map(normalizeChargePayload);
  for (const charge of charges) if (!tolerances.allowedChargeKinds.includes(charge.chargeType)) exceptions.push({ code: "UNEXPECTED_CHARGE", severity: "approval", kind: charge.chargeType });
  const itemSubtotal = normalized.reduce((sum, line) => sum + line.lineTotal, 0);
  const expectedItemSubtotal = normalized.reduce((sum, line) => sum + Math.round(line.quantity * line.poCost), 0);
  if (Math.abs(itemSubtotal - expectedItemSubtotal) > tolerances.totalCents) exceptions.push({ code: "TOTAL_PRICE_VARIANCE", severity: "approval", varianceCents: itemSubtotal - expectedItemSubtotal });
  const taxRate = payload.taxRateBps == null ? 0 : numberValue(payload, "taxRateBps", { positive: false, integer: true });
  if (taxRate < 0 || taxRate > 10_000) throw new WorkflowError("VALIDATION_ERROR", "taxRateBps must be 0-10000.");
  const subtotal = itemSubtotal + charges.reduce((sum, charge) => sum + charge.subtotalDelta, 0);
  const tax = Math.round(itemSubtotal * taxRate / 10_000) + charges.reduce((sum, charge) => sum + charge.taxDelta, 0);
  const total = subtotal + tax;
  if (subtotal < 0 || total < 0) throw new WorkflowError("INVALID_DOCUMENT_TOTAL", "Vendor bill charges and discounts cannot make subtotal or total negative.");
  if (payload.invoiceTotalCents != null && numberValue(payload, "invoiceTotalCents", { positive: false, integer: true }) !== total) throw new WorkflowError("INVOICE_TOTAL_MISMATCH", "Calculated vendor bill total does not match invoiceTotalCents.", 409);
  const currency = validateDocumentCurrency(payload.currency, order.currency);
  const exchange = validateDocumentExchange(payload.exchangeRateToBase, order.exchange);
  const baseTotal = Math.round(total * exchange);
  const hold = exceptions.length > 0 && !fastTrack;
  const matchStatus = exceptions.length > 0 ? fastTrack ? "approved_variance" : "exception" : "matched";
  const billId = newId("vendor-bill");
  const number = await nextDocumentNumber("VB");
  const result: WorkflowResult = { message: fastTrack
    ? `${number} posted and approved by its author${exceptions.length ? ` with ${exceptions.length} authorized three-way-match exception${exceptions.length === 1 ? "" : "s"}` : " after a successful three-way match"}.`
    : hold ? `${number} posted on hold with ${exceptions.length} three-way-match exception${exceptions.length === 1 ? "" : "s"}.` : `${number} posted and matched to PO and cumulative receipts.`, impact: { physical: "No stock movement.", financial: `Payable ${total} ${currency} cents recorded${hold ? " on hold" : fastTrack ? " and author-approved" : ""}.`, matchStatus, exceptions, onHandDelta: 0 }, recordId: billId };
  const db = commandD1(command); const when = new Date().toISOString();
  // The claim re-checks exactly what the hold decision relied on: ordered quantity is always a hard
  // bound; received quantity only guards lines the decision treated as covered by a receipt.
  const lineClaims = normalized.map((line) => `EXISTS (SELECT 1 FROM purchase_order_lines pol WHERE pol.id=? AND pol.purchase_order_id=?
    AND pol.ordered_qty-COALESCE((SELECT SUM(vbl.quantity) FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id WHERE vbl.purchase_order_line_id=pol.id AND vb.status<>'void'),0)+?>=?${line.aheadOfReceipt ? "" : `
    AND (CASE WHEN pol.fulfillment_route='drop_ship'
      THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0)
      ELSE COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0) END)
      -COALESCE((SELECT SUM(vbl.quantity) FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id WHERE vbl.purchase_order_line_id=pol.id AND vb.status<>'void'),0)+?>=?`})`).join(" AND ");
  const lineClaimBindings = normalized.flatMap((line) => [line.poLineId, purchaseOrderId, tolerances.quantity, line.quantity, ...(line.aheadOfReceipt ? [] : [tolerances.quantity, line.quantity])]);
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM purchase_orders WHERE id=? AND version=? AND lifecycle_status='approved' AND ordered_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM vendor_bills WHERE vendor_id=? AND vendor_invoice_number=?) AND ${lineClaims}`)
      .bind(...claimValues(command, result, billId), purchaseOrderId, order.version, order.vendorId, vendorInvoiceNumber, ...lineClaimBindings),
    db.prepare(`INSERT INTO vendor_bills (id,number,vendor_id,purchase_order_id,status,match_status,total_cents,due_date,currency,vendor_invoice_number,invoice_date,posted_at,approved_at,approved_by,subtotal_cents,tax_cents,paid_cents,hold_reason,exchange_rate_to_base,base_total_cents,tax_rate_bps,tax_code,payment_terms,version)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,1 WHERE ${marker(command)}`)
      .bind(billId, number, order.vendorId, purchaseOrderId, hold ? "on_hold" : "approved", matchStatus, total, dueDate, currency, vendorInvoiceNumber, invoiceDate, when, fastTrack ? when : null, fastTrack ? command.actor.label : null, subtotal, tax, hold ? JSON.stringify(exceptions) : null, exchange, baseTotal, taxRate, optionalText(payload, "taxCode"), optionalText(payload, "paymentTerms")),
  ];
  normalized.forEach((line) => statements.push(db.prepare(`INSERT INTO vendor_bill_lines (id,vendor_bill_id,purchase_order_line_id,product_id,quantity,unit_cost_cents,line_total_cents,match_status,match_details_json) SELECT ?,?,?,?,?,?,?,?,? WHERE ${marker(command)}`).bind(newId("vendor-bill-line"), billId, line.poLineId, line.productId, line.quantity, line.unitCost, line.lineTotal, line.status, JSON.stringify(line.details))));
  charges.forEach((charge) => statements.push(db.prepare(`INSERT INTO document_charges (id,document_type,document_id,charge_type,description,amount_cents,direction,taxable,refundable,tax_code,tax_rate_bps,tax_amount_cents,created_at) SELECT ?,'vendor_bill',?,?,?,?,?,?,?,?,?,?,? WHERE ${marker(command)}`).bind(newId("charge"), billId, charge.chargeType, charge.description, charge.amount, charge.direction, charge.taxable ? 1 : 0, charge.refundable ? 1 : 0, charge.taxCode, charge.taxRate, charge.taxAmount, when)));
  if (hold) statements.push(db.prepare(`INSERT INTO approvals (id,entity_type,entity_id,request_type,status,requested_by,requested_reason,requested_at,metadata_json,version) SELECT ?,'vendor_bill',?,'vendor_bill_match_exception','pending',?,?,?, ?,1 WHERE ${marker(command)}`).bind(newId("approval"), billId, command.actor.label, "Three-way match exception", when, JSON.stringify({ exceptions })));
  if (fastTrack) statements.push(db.prepare(`INSERT INTO approvals
    (id,entity_type,entity_id,request_type,status,requested_by,requested_reason,requested_at,decided_by,decision_reason,decided_at,consumed_at,consumed_by,consumed_entity_id,metadata_json,version)
    SELECT ?,'vendor_bill',?,?, 'approved',?,?,?,?,?,?,?,?,?,?,1 WHERE ${marker(command)}`)
    .bind(newId("approval"), billId, exceptions.length ? "vendor_bill_match_exception" : "vendor_bill_fast_track", command.actor.label, approvalReason, when, command.actor.label, approvalReason, when, when, command.actor.label, billId, JSON.stringify({ selfAuthorized: true, exceptions })));
  statements.push(
    db.prepare(`UPDATE purchase_orders SET billing_status=CASE WHEN NOT EXISTS (
      SELECT 1 FROM purchase_order_lines pol WHERE pol.purchase_order_id=purchase_orders.id
        AND COALESCE((SELECT SUM(vbl.quantity) FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id WHERE vbl.purchase_order_line_id=pol.id AND vb.status<>'void'),0)
          < MAX(pol.ordered_qty-pol.closed_qty,0)
      ) THEN 'fully_billed' ELSE 'partially_billed' END,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(purchaseOrderId, order.version),
    auditStatement(command, "vendor_bill", billId, fastTrack ? "vendor_bill_fast_track_approved" : "vendor_bill_posted", result.message, { purchaseOrderId, exceptions, total, currency, exchange, lineCount: normalized.length, chargeCount: charges.length, fastTrack, approvalReason }, when),
    outboxStatement(command, "vendor_bill.posted", "vendor_bill", billId, { status: hold ? "on_hold" : "approved", total, baseTotal }, when)
  );
  await db.batch(statements);
  return finish(command);
}

async function approveVendorBill(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const reason = optionalText(command.payload ?? {}, "reason") ?? "";
  const version = command.version ?? 0;
  const bill = await first<{ version: number; status: string; holdReason: string | null }>("SELECT version,status,hold_reason AS holdReason FROM vendor_bills WHERE id=?", id);
  if (!bill) throw new WorkflowError("NOT_FOUND", "Vendor bill not found.", 404);
  if (bill.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Vendor bill changed.", 409, bill.version);
  if (bill.status !== "on_hold") throw new WorkflowError("INVALID_STATE", "Only held bills require approval.", 409);
  // An invoice-before-goods hold is blocking, not discretionary: it clears only once cumulative
  // receipts (net of every other live bill) cover each billed line within the quantity tolerance.
  let holdExceptions: Array<Record<string, unknown>> = [];
  try { const parsed = JSON.parse(bill.holdReason ?? "[]") as unknown; holdExceptions = Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : []; } catch { holdExceptions = []; }
  const awaitingReceipt = holdExceptions.some((exception) => exception.code === "BILL_BEFORE_RECEIPT" || exception.code === "BILL_BEFORE_DELIVERY" || exception.code === "BILLED_ABOVE_RECEIVED");
  const tolerances = awaitingReceipt ? await setting<{ quantity: number }>("matching.tolerances", { quantity: 0 }) : { quantity: 0 };
  const unreceivedLineSql = `EXISTS (SELECT 1 FROM vendor_bill_lines vbl JOIN purchase_order_lines pol ON pol.id=vbl.purchase_order_line_id
    WHERE vbl.vendor_bill_id=vendor_bills.id AND vbl.quantity>(CASE WHEN pol.fulfillment_route='drop_ship'
        THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0)
        ELSE COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0) END)
      -COALESCE((SELECT SUM(other.quantity) FROM vendor_bill_lines other JOIN vendor_bills ob ON ob.id=other.vendor_bill_id
        WHERE other.purchase_order_line_id=pol.id AND ob.status<>'void' AND ob.id<>vendor_bills.id),0)+?)`;
  if (awaitingReceipt && await first(`SELECT 1 AS unreceived FROM vendor_bills WHERE id=? AND ${unreceivedLineSql}`, id, tolerances.quantity)) {
    throw new WorkflowError("RECEIPT_REQUIRED", "Post the missing supplier fulfillment (warehouse receipt or drop-ship delivery), or void/correct the bill, before releasing the hold.", 409, bill.version);
  }
  const result: WorkflowResult = { message: "Vendor bill hold approved; payable released without moving inventory.", impact: { physical: "No stock movement.", financial: "Payable released.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM vendor_bills WHERE id=? AND version=? AND status='on_hold'${awaitingReceipt ? ` AND NOT ${unreceivedLineSql}` : ""}`)
      .bind(...claimValues(command, result, id), id, version, ...(awaitingReceipt ? [tolerances.quantity] : [])),
    db.prepare(`UPDATE vendor_bills SET status='approved',match_status='approved_variance',hold_reason=NULL,approved_at=?,approved_by=?,version=version+1 WHERE id=? AND version=? AND status='on_hold' AND ${marker(command)}`).bind(when, command.actor.label, id, version),
    db.prepare(`UPDATE approvals SET status='approved',decided_by=?,decision_reason=?,decided_at=?,consumed_at=?,consumed_by=?,consumed_entity_id=?,version=version+1 WHERE entity_type='vendor_bill' AND entity_id=? AND request_type='vendor_bill_match_exception' AND status='pending' AND ${marker(command)}`).bind(command.actor.label, reason, when, when, command.actor.label, id, id),
    auditStatement(command, "vendor_bill", id, "vendor_bill_approved", result.message, { reason }, when),
    outboxStatement(command, "vendor_bill.approved", "vendor_bill", id, { reason }, when),
  ]);
  return finish(command);
}

async function voidVendorBill(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const reason = textValue(command.payload ?? {}, "reason");
  const bill = await first<{ version: number; status: string; paid: number; credited: number; purchaseOrderId: string | null; purchaseVersion: number | null; invoiceDate: string }>(`SELECT vb.version,vb.status,vb.paid_cents AS paid,vb.purchase_order_id AS purchaseOrderId,vb.invoice_date AS invoiceDate,
      po.version AS purchaseVersion,COALESCE((SELECT SUM(vc.amount_cents) FROM vendor_credits vc WHERE vc.vendor_bill_id=vb.id AND vc.status='posted'),0) AS credited
    FROM vendor_bills vb LEFT JOIN purchase_orders po ON po.id=vb.purchase_order_id WHERE vb.id=?`, id);
  if (!bill) throw new WorkflowError("NOT_FOUND", "Vendor bill was not found.", 404);
  if (bill.version !== (command.version ?? 0)) throw new WorkflowError("VERSION_CONFLICT", "Vendor bill changed; refresh before voiding.", 409, bill.version);
  if (bill.status === "void") throw new WorkflowError("INVALID_STATE", "Vendor bill is already void.", 409);
  if (bill.paid !== 0 || bill.credited !== 0) throw new WorkflowError("BILL_CORRECTION_REQUIRED", "Only an entirely unpaid and uncredited vendor bill can be voided; reverse settlement or retain the bill and its credit history.", 409);
  await assertPeriodOpen("accounting", bill.invoiceDate);
  const result: WorkflowResult = { message: "Vendor bill voided; its quantities no longer block supplier-fulfillment correction.", impact: { physical: "No stock movement.", financial: "The unpaid payable was voided.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  const purchaseClaim = bill.purchaseOrderId ? " AND EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id=vb.purchase_order_id AND po.version=?)" : "";
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM vendor_bills vb WHERE vb.id=? AND vb.version=? AND vb.status<>'void' AND vb.paid_cents=0
        AND NOT EXISTS (SELECT 1 FROM vendor_credits vc WHERE vc.vendor_bill_id=vb.id AND vc.status='posted')${purchaseClaim}`)
      .bind(...claimValues(command, result, id), id, bill.version, ...(bill.purchaseOrderId ? [bill.purchaseVersion ?? 0] : [])),
    db.prepare(`UPDATE vendor_bills SET status='void',hold_reason=NULL,version=version+1 WHERE id=? AND version=? AND paid_cents=0 AND ${marker(command)}`).bind(id, bill.version),
    db.prepare(`UPDATE approvals SET status='rejected',decided_by=?,decision_reason=?,decided_at=?,version=version+1 WHERE entity_type='vendor_bill' AND entity_id=? AND status='pending' AND ${marker(command)}`).bind(command.actor.label, `Bill voided: ${reason}`, when, id),
    auditStatement(command, "vendor_bill", id, "vendor_bill_voided", result.message, { reason, purchaseOrderId: bill.purchaseOrderId }, when),
    outboxStatement(command, "vendor_bill.voided", "vendor_bill", id, { reason, purchaseOrderId: bill.purchaseOrderId }, when),
  ];
  if (bill.purchaseOrderId) statements.splice(2, 0,
    db.prepare(`UPDATE purchase_orders SET billing_status=CASE
      WHEN NOT EXISTS (SELECT 1 FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id WHERE vb.purchase_order_id=purchase_orders.id AND vb.status<>'void') THEN 'not_billed'
      WHEN NOT EXISTS (SELECT 1 FROM purchase_order_lines pol WHERE pol.purchase_order_id=purchase_orders.id
        AND COALESCE((SELECT SUM(vbl.quantity) FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id WHERE vbl.purchase_order_line_id=pol.id AND vb.status<>'void'),0)<MAX(pol.ordered_qty-pol.closed_qty,0)) THEN 'fully_billed'
      ELSE 'partially_billed' END,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(bill.purchaseOrderId, bill.purchaseVersion ?? 0),
  );
  await db.batch(statements);
  return finish(command);
}

async function markPurchaseOrderOrdered(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const version = command.version ?? 0;
  const supplierReference = optionalText(command.payload ?? {}, "supplierReference");
  const current = await first<{ version: number; status: string; orderedAt: string | null; number: string }>(
    "SELECT version,lifecycle_status AS status,ordered_at AS orderedAt,number FROM purchase_orders WHERE id=?", id
  );
  if (!current) throw new WorkflowError("NOT_FOUND", "Purchase order was not found.", 404);
  if (current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Purchase order changed; refresh before marking it ordered.", 409, current.version);
  if (current.status !== "approved") throw new WorkflowError("INVALID_STATE", "Only an approved purchase order can be marked as ordered.", 409, current.version);
  if (current.orderedAt) throw new WorkflowError("INVALID_STATE", "This purchase order is already marked as ordered.", 409, current.version);
  const when = new Date().toISOString();
  const result: WorkflowResult = {
    message: `${current.number} marked as ordered. Receiving is now available.`,
    impact: { physical: "No stock movement.", commercial: "The approved order has been placed with the vendor.", financial: "No vendor bill created.", onHandDelta: 0 },
    recordId: id,
  };
  const db = commandD1(command);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM purchase_orders WHERE id=? AND version=? AND lifecycle_status='approved' AND ordered_at IS NULL`)
      .bind(...claimValues(command, result, id), id, version),
    db.prepare(`UPDATE purchase_orders SET ordered_at=?,ordered_by=?,supplier_reference=COALESCE(NULLIF(?,''),supplier_reference),version=version+1
      WHERE id=? AND version=? AND lifecycle_status='approved' AND ordered_at IS NULL AND ${marker(command)}`)
      .bind(when, command.actor.label, supplierReference ?? "", id, version),
    auditStatement(command, "purchase_order", id, "purchase_order_marked_ordered", result.message, { supplierReference }, when),
    outboxStatement(command, "purchase_order.ordered", "purchase_order", id, { supplierReference }, when),
  ]);
  return finish(command);
}

async function setValuationPolicy(command: WorkflowCommand) {
  const productId = command.entityId ?? textValue(command.payload ?? {}, "productId");
  const payload = command.payload ?? {};
  const method = textValue(payload, "method");
  if (!["fifo", "average", "standard"].includes(method)) throw new WorkflowError("VALIDATION_ERROR", "method must be fifo, average, or standard.");
  const standard = payload.standardCostCents == null ? 0 : numberValue(payload, "standardCostCents", { positive: false, integer: true });
  if (standard < 0) throw new WorkflowError("VALIDATION_ERROR", "standardCostCents cannot be negative.");
  if (!await first("SELECT id FROM products WHERE id=? AND active=1", productId)) throw new WorkflowError("INVALID_PRODUCT", "Select an active product for valuation policy changes.", 409);
  const version = command.version ?? 0;
  const current = await first<{ version: number; average: number }>("SELECT version,average_cost_cents AS average FROM valuation_policies WHERE product_id=?", productId);
  if (current && current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Valuation policy changed.", 409, current.version);
  const result: WorkflowResult = { message: `${method} valuation selected for future postings; prior value entries remain immutable.`, impact: { physical: "No stock movement.", financial: "Future valuation method changed.", onHandDelta: 0 }, recordId: productId };
  const db = commandD1(command); const when = new Date().toISOString();
  const claim = current
    ? db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM valuation_policies WHERE product_id=? AND version=?").bind(...claimValues(command, result, productId), productId, version)
    : db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM products WHERE id=? AND active=1) AND NOT EXISTS (SELECT 1 FROM valuation_policies WHERE product_id=?)").bind(...claimValues(command, result, productId), productId, productId);
  const write = current
    ? db.prepare(`UPDATE valuation_policies SET method=?,standard_cost_cents=?,version=version+1,updated_at=?,updated_by=? WHERE product_id=? AND version=? AND ${marker(command)}`).bind(method, standard, when, command.actor.label, productId, version)
    : db.prepare(`INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by) SELECT ?,?,?,?,1,?,? WHERE ${marker(command)}`).bind(productId, method, standard, standard, when, command.actor.label);
  await db.batch([claim, write, auditStatement(command, "product", productId, "valuation_policy_updated", result.message, { method, standard }, when), outboxStatement(command, "valuation.policy_updated", "product", productId, { method }, when)]);
  return finish(command);
}
async function allocateLandedCost(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const amount = numberValue(payload, "amountCents", { integer: true });
  const basis = textValue(payload, "allocationBasis", "purchase_value");
  if (!["quantity", "purchase_value"].includes(basis)) throw new WorkflowError("VALIDATION_ERROR", "allocationBasis must be quantity or purchase_value.");
  const sourceDocumentType = textValue(payload, "sourceDocumentType");
  const sourceDocumentId = textValue(payload, "sourceDocumentId");
  if (sourceDocumentType !== "vendor_bill") throw new WorkflowError("UNSUPPORTED_LANDED_COST_SOURCE", "Landed-cost allocations currently require an approved vendor bill source.", 409);
  const source = await first<{ status: string; baseTotal: number; invoiceDate: string; purchaseOrderId: string | null; exchange: number; eligibleCharges: number }>(`SELECT vb.status,vb.base_total_cents AS baseTotal,vb.invoice_date AS invoiceDate,vb.purchase_order_id AS purchaseOrderId,vb.exchange_rate_to_base AS exchange,
      COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='vendor_bill' AND dc.document_id=vb.id AND dc.refundable=0 AND dc.charge_type IN ('freight','fuel_surcharge','handling','customs','brokerage')),0) AS eligibleCharges
    FROM vendor_bills vb WHERE vb.id=?`, sourceDocumentId);
  if (!source) throw new WorkflowError("NOT_FOUND", "Landed-cost source vendor bill was not found.", 404);
  if (await first("SELECT id FROM landed_cost_allocations WHERE source_document_type=? AND source_document_id=?", sourceDocumentType, sourceDocumentId)) {
    throw new WorkflowError("LANDED_COST_ALREADY_ALLOCATED", "This vendor bill's landed cost has already been allocated; each source document can be allocated once.", 409);
  }
  if (!["approved", "partially_paid", "paid"].includes(source.status)) throw new WorkflowError("INVALID_STATE", "The landed-cost source vendor bill must be approved and off hold.", 409);
  if (!source.purchaseOrderId) throw new WorkflowError("LANDED_COST_SOURCE_UNRELATED", "The source vendor bill must be linked to a purchase order.", 409);
  const eligibleBaseCents = Math.round(source.eligibleCharges * source.exchange);
  if (eligibleBaseCents <= 0 || amount > eligibleBaseCents) throw new WorkflowError("LANDED_COST_EXCEEDS_ELIGIBLE_CHARGES", `Allocation cannot exceed ${eligibleBaseCents} base-currency cents of eligible freight, fuel, handling, customs, and brokerage charges.`, 409);
  const postingDate = dateValue(payload, "postingDate", source.invoiceDate || today());
  await assertPeriodOpen("accounting", postingDate);
  await assertPeriodOpen("inventory", postingDate);
  const layerIds = Array.isArray(payload.costLayerIds) ? payload.costLayerIds.map(String) : [];
  if (!layerIds.length) throw new WorkflowError("VALIDATION_ERROR", "costLayerIds is required.");
  const uniqueLayerIds = lineIdsUnique(layerIds);
  if (uniqueLayerIds.length !== layerIds.length) throw new WorkflowError("DUPLICATE_COST_LAYER", "Each cost layer may appear only once in an allocation.");
  // D1 caps a statement at 100 bound parameters, so the selected layers travel as one JSON value.
  const layerIdsJson = JSON.stringify(layerIds);
  const fetched = await all<{ id: string; productId: string; received: number; remaining: number; unitCost: number; purchaseOrderId: string | null }>(`SELECT cl.id,cl.product_id AS productId,cl.received_qty AS received,cl.remaining_qty AS remaining,cl.unit_cost_cents AS unitCost,pol.purchase_order_id AS purchaseOrderId
    FROM cost_layers cl JOIN stock_movements sm ON sm.id=cl.receipt_movement_id LEFT JOIN purchase_order_lines pol ON pol.id=sm.purchase_order_line_id
    WHERE cl.id IN (SELECT value FROM json_each(?))`, layerIdsJson);
  if (fetched.length !== layerIds.length) throw new WorkflowError("NOT_FOUND", "One or more cost layers were not found.", 404);
  const byId = new Map(fetched.map((layer) => [layer.id, layer]));
  const layers = layerIds.map((id) => byId.get(id)!);
  if (layers.some((layer) => layer.purchaseOrderId !== source.purchaseOrderId)) throw new WorkflowError("LANDED_COST_LAYER_UNRELATED", "Every selected cost layer must originate from the purchase order linked to the landed-cost vendor bill.", 409);
  if (layers.some((layer) => layer.remaining !== layer.received || layer.remaining <= 0)) throw new WorkflowError("CONSUMED_COST_LAYER", "Landed cost can only be allocated before any selected receipt layer is consumed.", 409);
  const weights = layers.map((layer) => basis === "quantity" ? layer.received : layer.received * layer.unitCost);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) throw new WorkflowError("INVALID_ALLOCATION", "Allocation weights must be positive.");
  const rawShares = layers.map((layer, index) => ({ layer, index, exact: amount * weights[index] / totalWeight }));
  const shares = rawShares.map(({ layer, exact }) => ({ layerId: layer.id, productId: layer.productId, received: layer.received, cents: Math.floor(exact), fraction: exact - Math.floor(exact) }));
  let remainder = amount - shares.reduce((sum, share) => sum + share.cents, 0);
  for (const share of [...shares].sort((a, b) => b.fraction - a.fraction || a.layerId.localeCompare(b.layerId))) {
    if (remainder-- <= 0) break;
    share.cents += 1;
  }
  const postedShares = shares.map((share) => ({ layerId: share.layerId, productId: share.productId, received: share.received, cents: share.cents }));
  const id = newId("landed-cost"); const number = await nextDocumentNumber("LC");
  const result: WorkflowResult = { message: `${number} allocated ${amount} base-currency cents across ${layers.length} unconsumed cost layers without changing quantity.`, impact: { physical: "No stock movement.", financial: `Inventory value increased by ${amount} base-currency cents.`, inventoryValueDeltaCents: amount, onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString(); const postedAt = timestampOnDate(postingDate, when);
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM landed_cost_allocations WHERE source_document_type=? AND source_document_id=?)
        AND EXISTS (SELECT 1 FROM vendor_bills vb WHERE vb.id=? AND vb.status IN ('approved','partially_paid','paid') AND vb.purchase_order_id=?
          AND ROUND(COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='vendor_bill' AND dc.document_id=vb.id AND dc.refundable=0 AND dc.charge_type IN ('freight','fuel_surcharge','handling','customs','brokerage')),0)*vb.exchange_rate_to_base)>=?)
        AND (SELECT COUNT(*) FROM cost_layers cl JOIN stock_movements sm ON sm.id=cl.receipt_movement_id JOIN purchase_order_lines pol ON pol.id=sm.purchase_order_line_id WHERE cl.id IN (SELECT value FROM json_each(?)) AND cl.remaining_qty=cl.received_qty AND cl.remaining_qty>0 AND pol.purchase_order_id=?)=?`)
      .bind(...claimValues(command, result, id), sourceDocumentType, sourceDocumentId, sourceDocumentId, source.purchaseOrderId, amount, layerIdsJson, source.purchaseOrderId, layerIds.length),
    db.prepare(`INSERT INTO landed_cost_allocations (id,number,source_document_type,source_document_id,amount_cents,allocation_basis,posted_at,posted_by) SELECT ?,?,?,?,?,?,?,? WHERE ${marker(command)}`).bind(id, number, sourceDocumentType, sourceDocumentId, amount, basis, postedAt, command.actor.label),
  ];
  shares.forEach((share) => {
    statements.push(
      db.prepare(`INSERT INTO landed_cost_allocation_lines (id,allocation_id,cost_layer_id,allocated_cents) SELECT ?,?,?,? WHERE ${marker(command)}`).bind(newId("landed-line"), id, share.layerId, share.cents),
      db.prepare(`UPDATE cost_layers SET landed_cost_cents=landed_cost_cents+? WHERE id=? AND remaining_qty=received_qty AND remaining_qty>0 AND ${marker(command)}`).bind(share.cents, share.layerId),
      db.prepare(`INSERT INTO inventory_value_entries (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
        SELECT ?,?,NULL,'landed_cost',0,?,?,COALESCE((SELECT method FROM valuation_policies WHERE product_id=?),'fifo'),'landed_cost',?,?,? WHERE ${marker(command)}`)
        .bind(newId("value"), share.productId, share.received > 0 ? Math.round(share.cents / share.received) : 0, share.cents, share.productId, id, postedAt, command.actor.label)
    );
  });
  statements.push(
    auditStatement(command, "landed_cost", id, "landed_cost_allocated", result.message, { sourceDocumentType, sourceDocumentId, shares: postedShares, amount, basis }, when),
    outboxStatement(command, "valuation.landed_cost_allocated", "landed_cost", id, { sourceDocumentType, sourceDocumentId, amount, shares: postedShares }, when)
  );
  await db.batch(statements);
  return finish(command);
}

function lineIdsUnique(values:string[]){return [...new Set(values)];}

async function receiveTransfer(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const payload = command.payload ?? {};
  const requestedLineId = optionalText(payload, "lineId");
  const line = await first<{ lineId: string; productId: string; fromLocation: string; toLocation: string; destinationStatus: string; quantity: number; received: number; transitLocation: string; version: number; status: string; lotId: string | null; unitId: string | null }>(`SELECT itl.id AS lineId,itl.product_id AS productId,itl.from_location_id AS fromLocation,itl.to_location_id AS toLocation,destination.inventory_status AS destinationStatus,
      itl.quantity,itl.received_qty AS received,it.in_transit_location_id AS transitLocation,it.version,it.status,itl.lot_id AS lotId,itl.inventory_unit_id AS unitId
    FROM inventory_transfers it JOIN inventory_transfer_lines itl ON itl.transfer_id=it.id JOIN locations destination ON destination.id=itl.to_location_id
    WHERE it.id=? AND (? IS NULL OR itl.id=?) ORDER BY itl.id LIMIT 1`, id, requestedLineId, requestedLineId);
  if (!line) throw new WorkflowError("NOT_FOUND", "Inter-warehouse transfer or transfer line was not found.", 404);
  if (line.status !== "in_transit" && line.status !== "partially_received") throw new WorkflowError("INVALID_STATE", "Only in-transit transfers can be received.", 409);
  if (line.version !== (command.version ?? 0)) throw new WorkflowError("VERSION_CONFLICT", "Transfer changed.", 409, line.version);
  const quantity = await baseQuantity(line.productId, payload.quantity == null ? roundQuantity(line.quantity - line.received) : numberValue(payload, "quantity"));
  if (quantity <= 0 || quantity > line.quantity - line.received) throw new WorkflowError("INVALID_QUANTITY", "Receipt exceeds the remaining in-transit quantity.", 409);
  const postingDate = dateValue(payload, "postingDate", today());
  await assertPeriodOpen("inventory", postingDate);
  const transit = await first<{ available: number }>("SELECT on_hand_qty-reserved_qty AS available FROM inventory_balances WHERE product_id=? AND location_id=?", line.productId, line.transitLocation);
  if (!transit || transit.available < quantity) throw new WorkflowError("TRANSIT_SHORTAGE", "In-transit balance is insufficient.", 409);
  const trace = await requireSourceTracking(line.productId, line.transitLocation, quantity, payload, { lotId: line.lotId, unitId: line.unitId });
  const traceClaim = trackingClaim(trace, line.transitLocation, quantity);
  const result: WorkflowResult = { message: `${quantity} in-transit units received at the destination warehouse.`, impact: { physical: "Inventory moved from transit to destination; company on-hand unchanged.", trackingPolicy: trace.policy, onHandDelta: 0, inTransitDelta: -quantity }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString(); const postedAt = timestampOnDate(postingDate, when); const sm1 = newId("movement"); const sm2 = newId("movement");
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM inventory_transfers it WHERE it.id=? AND it.version=? AND it.status IN ('in_transit','partially_received')
        AND EXISTS (SELECT 1 FROM inventory_transfer_lines itl WHERE itl.id=? AND itl.transfer_id=it.id AND itl.received_qty+?<=itl.quantity)
        AND EXISTS (SELECT 1 FROM inventory_balances ib WHERE ib.product_id=? AND ib.location_id=? AND ib.on_hand_qty-ib.reserved_qty>=?) AND ${traceClaim.sql}`)
      .bind(...claimValues(command, result, id), id, line.version, line.lineId, quantity, line.productId, line.transitLocation, quantity, ...traceClaim.bindings),
    db.prepare(`UPDATE inventory_balances SET on_hand_qty=on_hand_qty-?,version=version+1 WHERE product_id=? AND location_id=? AND on_hand_qty-reserved_qty>=? AND ${marker(command)}`).bind(quantity, line.productId, line.transitLocation, quantity),
    db.prepare(`INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) SELECT ?,?,?,0,1 WHERE ${marker(command)} ON CONFLICT(product_id,location_id) DO UPDATE SET on_hand_qty=on_hand_qty+excluded.on_hand_qty,version=version+1`).bind(line.productId, line.toLocation, quantity),
    db.prepare(`UPDATE inventory_transfer_lines SET received_qty=received_qty+? WHERE id=? AND received_qty+?<=quantity AND ${marker(command)}`).bind(quantity, line.lineId, quantity),
    db.prepare(`UPDATE inventory_transfers SET status=CASE WHEN NOT EXISTS (SELECT 1 FROM inventory_transfer_lines itl WHERE itl.transfer_id=inventory_transfers.id AND itl.received_qty<itl.quantity) THEN 'received' ELSE 'partially_received' END,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(id, line.version),
    db.prepare(`INSERT INTO stock_movements (id,movement_type,product_id,quantity,from_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,idempotency_key,lot_id,inventory_unit_id) SELECT ?,'interwarehouse_receive',?,-?,?,'in_transit','inventory_transfer',?,?,?,?,?,?,? WHERE ${marker(command)}`).bind(sm1, line.productId, quantity, line.transitLocation, id, line.lineId, postedAt, command.actor.label, command.idempotencyKey, line.lotId, line.unitId),
    db.prepare(`INSERT INTO stock_movements (id,movement_type,product_id,quantity,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,idempotency_key,lot_id,inventory_unit_id) SELECT ?,'interwarehouse_receive',?,?,?,?,'inventory_transfer',?,?,?,?,?,?,? WHERE ${marker(command)}`).bind(sm2, line.productId, quantity, line.toLocation, line.destinationStatus, id, line.lineId, postedAt, command.actor.label, command.idempotencyKey, line.lotId, line.unitId),
    auditStatement(command, "inventory_transfer", id, "interwarehouse_received", result.message, { quantity, lineId: line.lineId, productId: line.productId, destinationStatus: line.destinationStatus }, when),
    outboxStatement(command, "inventory.transfer_received", "inventory_transfer", id, { quantity, lineId: line.lineId }, when),
  ];
  const sourceAssignment = assignmentStatement(command, sm1, trace, quantity);
  const destinationAssignment = assignmentStatement(command, sm2, trace, quantity);
  if (sourceAssignment) statements.push(sourceAssignment);
  if (destinationAssignment) statements.push(destinationAssignment);
  if (trace.policy === "serial") statements.push(db.prepare(`UPDATE inventory_units SET location_id=?,inventory_status=?,version=version+1 WHERE id=? AND product_id=? AND location_id=? AND inventory_status='in_transit' AND lifecycle_status='on_hand' AND allocated_sales_order_line_id IS NULL AND version=? AND ${marker(command)}`).bind(line.toLocation, line.destinationStatus, trace.unitId, line.productId, line.transitLocation, trace.unitVersion));
  await db.batch(statements);
  return finish(command);
}

async function updateUserRole(command: WorkflowCommand) {
  const userId = textValue({ entityId: command.entityId }, "entityId");
  const payload = command.payload ?? {};
  const role = textValue(payload, "role");
  if (!["viewer", "operator", "accounting", "manager", "administrator"].includes(role)) throw new WorkflowError("VALIDATION_ERROR", "role must be viewer, operator, accounting, manager, or administrator.");
  const active = payload.active !== false;
  const reason = textValue(payload, "reason");
  const version = command.version ?? 0;
  const user = await first<{ version: number; email: string; role: string; active: number }>(`SELECT tm.version,u.email,tm.role,tm.active
    FROM tenant_memberships tm JOIN app_users u ON u.user_id=tm.user_id WHERE tm.user_id=?`, userId);
  if (!user) throw new WorkflowError("NOT_FOUND", "User was not found.", 404);
  if (user.version !== version) throw new WorkflowError("VERSION_CONFLICT", "User mapping changed.", 409, user.version);
  const removesActiveAdministrator = Boolean(user.active) && user.role === "administrator" && (!active || role !== "administrator");
  if (removesActiveAdministrator) {
    const admins = await first<{ count: number }>("SELECT COUNT(*) AS count FROM tenant_memberships WHERE role='administrator' AND active=1");
    if (Number(admins?.count ?? 0) <= 1) throw new WorkflowError("LAST_ADMIN", "The last active administrator cannot lose administration access.", 409);
  }
  const result: WorkflowResult = { message: `${user.email} updated to ${role}${active ? "" : " (disabled)"}.`, impact: { physical: "No inventory effect.", securityRole: role, active, onHandDelta: 0 }, recordId: userId };
  const db = commandD1(command); const when = new Date().toISOString();
  const adminGuard = removesActiveAdministrator ? "AND (SELECT COUNT(*) FROM tenant_memberships WHERE role='administrator' AND active=1)>1" : "";
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM tenant_memberships WHERE user_id=? AND version=? ${adminGuard}`).bind(...claimValues(command, result, userId), userId, version),
    db.prepare(`UPDATE tenant_memberships SET role=?,active=?,version=version+1,updated_at=? WHERE user_id=? AND version=? AND ${marker(command)}`).bind(role, active ? 1 : 0, when, userId, version),
    auditStatement(command, "app_user", userId, "user_role_updated", result.message, { role, active, reason }, when),
    outboxStatement(command, "security.user_role_updated", "app_user", userId, { role, active }, when),
  ]);
  return finish(command);
}

function optionalText(payload:Record<string,unknown>,key:string){return typeof payload[key]==="string"&&payload[key].trim()?payload[key].trim():null;}
function documentNotes(payload:Record<string,unknown>){const notes=optionalText(payload,"notes");if(notes&&notes.length>4000)throw new WorkflowError("VALIDATION_ERROR","Notes must be 4,000 characters or fewer.");return notes;}
function activeFor(command:WorkflowCommand){return !normalize(command.command).startsWith("deactivate")&&command.payload?.active!==false;}

async function deactivateMaster(command:WorkflowCommand,table:"products"|"business_partners"|"warehouses"|"locations"|"returnable_asset_types",entityType:string){const id=textValue({entityId:command.entityId},"entityId"),version=command.version??0,reason=textValue(command.payload??{},"reason");const current=await first<{version:number;active:number}>(`SELECT version,active FROM ${table} WHERE id=?`,id);if(!current)throw new WorkflowError("NOT_FOUND",`${entityType} not found.`,404);if(current.version!==version)throw new WorkflowError("VERSION_CONFLICT",`${entityType} changed.`,409,current.version);if(!current.active)throw new WorkflowError("INVALID_STATE",`${entityType} is already inactive.`,409,current.version);
  if(table==="products"){
    const dependency=await first<{stock:number;openPurchasing:number;openSales:number}>(`SELECT
      COALESCE((SELECT SUM(ABS(on_hand_qty)+ABS(reserved_qty)) FROM inventory_balances WHERE product_id=?),0) AS stock,
      (SELECT COUNT(*) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id WHERE pol.product_id=? AND po.lifecycle_status IN ('draft','pending_approval','approved') AND pol.ordered_qty-pol.closed_qty-COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0)>0) AS openPurchasing,
      (SELECT COUNT(*) FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id WHERE sol.product_id=? AND so.lifecycle_status IN ('draft','confirmed') AND sol.ordered_qty-sol.canceled_qty-COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol.id),0)>0) AS openSales`,id,id,id);
    if(Number(dependency?.stock??0)>0||Number(dependency?.openPurchasing??0)>0||Number(dependency?.openSales??0)>0)throw new WorkflowError("MASTER_DATA_IN_USE","A product with stock, reservations, or open order quantities cannot be deactivated.",409);
  }
  if(table==="warehouses"){
    const locations=await first<{count:number}>("SELECT COUNT(*) AS count FROM locations WHERE warehouse_id=? AND active=1",id);
    if(Number(locations?.count??0)>0)throw new WorkflowError("MASTER_DATA_IN_USE","Deactivate or reassign every active warehouse location before deactivating the warehouse.",409);
  }
  if(table==="business_partners"){
    const dependencies=await first<{count:number}>(`SELECT
      (SELECT COUNT(*) FROM purchase_orders WHERE vendor_id=? AND lifecycle_status IN ('draft','pending_approval','approved'))
      +(SELECT COUNT(*) FROM sales_orders WHERE customer_id=? AND lifecycle_status IN ('draft','confirmed'))
      +(SELECT COUNT(*) FROM vendor_bills WHERE vendor_id=? AND status NOT IN ('void','paid','credited'))
      +(SELECT COUNT(*) FROM customer_invoices WHERE customer_id=? AND status NOT IN ('void','paid','credited'))
      +(SELECT COUNT(*) FROM returnable_obligations WHERE partner_id=? AND status<>'closed') AS count`,id,id,id,id,id);
    if(Number(dependencies?.count??0)>0)throw new WorkflowError("MASTER_DATA_IN_USE","A partner with open orders, unsettled documents, or returnable obligations cannot be deactivated.",409);
  }
  if(table==="returnable_asset_types"){
    const obligations=await first<{count:number}>("SELECT COUNT(*) AS count FROM returnable_obligations WHERE asset_type_id=? AND status<>'closed'",id);
    if(Number(obligations?.count??0)>0)throw new WorkflowError("MASTER_DATA_IN_USE","A returnable asset type with open custody or refund obligations cannot be deactivated.",409);
  }
  const dependencyClaim = table==="products" ? `AND NOT EXISTS (SELECT 1 FROM inventory_balances WHERE product_id=? AND (on_hand_qty<>0 OR reserved_qty<>0))
      AND NOT EXISTS (SELECT 1 FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id WHERE pol.product_id=? AND po.lifecycle_status IN ('draft','pending_approval','approved') AND pol.ordered_qty-pol.closed_qty-COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0)>0)
      AND NOT EXISTS (SELECT 1 FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id WHERE sol.product_id=? AND so.lifecycle_status IN ('draft','confirmed') AND sol.ordered_qty-sol.canceled_qty-COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol.id),0)>0)`
    : table==="warehouses" ? "AND NOT EXISTS (SELECT 1 FROM locations WHERE warehouse_id=? AND active=1)"
    : table==="returnable_asset_types" ? "AND NOT EXISTS (SELECT 1 FROM returnable_obligations WHERE asset_type_id=? AND status<>'closed')"
    : table==="business_partners" ? `AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE vendor_id=? AND lifecycle_status IN ('draft','pending_approval','approved'))
      AND NOT EXISTS (SELECT 1 FROM sales_orders WHERE customer_id=? AND lifecycle_status IN ('draft','confirmed'))
      AND NOT EXISTS (SELECT 1 FROM vendor_bills WHERE vendor_id=? AND status NOT IN ('void','paid','credited'))
      AND NOT EXISTS (SELECT 1 FROM customer_invoices WHERE customer_id=? AND status NOT IN ('void','paid','credited'))
      AND NOT EXISTS (SELECT 1 FROM returnable_obligations WHERE partner_id=? AND status<>'closed')` : "";
  const dependencyBindings = table==="products" ? [id,id,id] : table==="business_partners" ? [id,id,id,id,id] : table==="warehouses"||table==="returnable_asset_types" ? [id] : [];
  const result:WorkflowResult={message:`${entityType} deactivated; historical records remain available.`,impact:{physical:"No inventory posting.",onHandDelta:0},recordId:id};const db=commandD1(command),when=new Date().toISOString();await db.batch([db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM ${table} WHERE id=? AND version=? AND active=1 ${dependencyClaim}`).bind(...claimValues(command,result,id),id,version,...dependencyBindings),db.prepare(`UPDATE ${table} SET active=0,version=version+1 WHERE id=? AND version=? AND active=1 AND ${marker(command)}`).bind(id,version),auditStatement(command,entityType,id,"deactivated",result.message,{reason},when),outboxStatement(command,"master.deactivated",entityType,id,{reason},when)]);return finish(command);}

/**
 * Ship-to addresses belong to the customer, not to one order. Distributors deliver the same
 * account's orders to many job sites, so the address book is the durable record and each
 * order snapshots the address it shipped to.
 */
async function savePartnerAddress(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const creating = normalize(command.command).startsWith("create");
  const id = creating ? newId("partner-address") : textValue({ entityId: command.entityId }, "entityId");
  const requestedPartnerId = optionalText(payload, "partnerId");
  const label = textValue(payload, "label");
  const addressLine1 = textValue(payload, "addressLine1");
  const city = textValue(payload, "city");
  const region = textValue(payload, "region");
  const postalCode = textValue(payload, "postalCode");
  const country = textValue(payload, "country", "CA").toUpperCase();
  const addressLine2 = optionalText(payload, "addressLine2");
  const contactName = optionalText(payload, "contactName");
  const deliveryInstructions = optionalText(payload, "deliveryInstructions");
  const isDefault = payload.isDefault === true;
  const version = command.version ?? 0;
  const current = creating ? null : await first<{ version: number; partnerId: string }>("SELECT version,partner_id AS partnerId FROM partner_addresses WHERE id=?", id);
  if (!creating && !current) throw new WorkflowError("NOT_FOUND", "Ship-to address not found.", 404);
  // An address belongs to the partner it was created under. The single-default rule is scoped to
  // that partner, never to whichever partnerId the request happened to carry.
  if (creating && !requestedPartnerId) throw new WorkflowError("VALIDATION_ERROR", "partnerId is required.");
  if (current && requestedPartnerId && requestedPartnerId !== current.partnerId) throw new WorkflowError("VALIDATION_ERROR", "A ship-to address cannot be moved to another partner; create it under that partner instead.");
  const partnerId = current?.partnerId ?? requestedPartnerId!;
  const partner = await first("SELECT id FROM business_partners WHERE id=? AND active=1", partnerId);
  if (!partner) throw new WorkflowError("NOT_FOUND", "Select an active business partner.", 404);
  if (current && current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Ship-to address changed.", 409, current.version);
  if (await first("SELECT id FROM partner_addresses WHERE partner_id=? AND label=? AND id<>?", partnerId, label, id)) throw new WorkflowError("DUPLICATE_PARTNER_ADDRESS", "This partner already has an address with that label.", 409);
  const result: WorkflowResult = { message: `${label} ${creating ? "added" : "updated"}.`, impact: { physical: "No inventory posting.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command);
  const when = new Date().toISOString();
  const statements: D1PreparedStatement[] = [creating
    ? db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM business_partners WHERE id=? AND active=1) AND NOT EXISTS (SELECT 1 FROM partner_addresses WHERE partner_id=? AND label=?)").bind(...claimValues(command, result, id), partnerId, partnerId, label)
    : db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM partner_addresses WHERE id=? AND version=? AND EXISTS (SELECT 1 FROM business_partners WHERE id=? AND active=1) AND NOT EXISTS (SELECT 1 FROM partner_addresses WHERE partner_id=? AND label=? AND id<>?)").bind(...claimValues(command, result, id), id, version, partnerId, partnerId, label, id)];
  // Exactly one default per partner, cleared before the new default is written.
  if (isDefault) statements.push(db.prepare(`UPDATE partner_addresses SET is_default=0,version=version+1 WHERE partner_id=? AND id<>? AND is_default=1 AND ${marker(command)}`).bind(partnerId, id));
  if (creating) statements.push(db.prepare(`INSERT INTO partner_addresses (id,partner_id,label,contact_name,address_line_1,address_line_2,city,region,postal_code,country,delivery_instructions,is_default,active,version,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,? WHERE ${marker(command)}`).bind(id, partnerId, label, contactName, addressLine1, addressLine2, city, region, postalCode, country, deliveryInstructions, isDefault ? 1 : 0, when, when));
  else statements.push(db.prepare(`UPDATE partner_addresses SET label=?,contact_name=?,address_line_1=?,address_line_2=?,city=?,region=?,postal_code=?,country=?,delivery_instructions=?,is_default=?,updated_at=?,version=version+1
    WHERE id=? AND version=? AND ${marker(command)}`).bind(label, contactName, addressLine1, addressLine2, city, region, postalCode, country, deliveryInstructions, isDefault ? 1 : 0, when, id, version));
  statements.push(
    auditStatement(command, "partner_address", id, creating ? "created" : "updated", result.message, { partnerId, label, city, region, isDefault }, when),
    outboxStatement(command, creating ? "master.partner_address_created" : "master.partner_address_updated", "partner_address", id, { partnerId, label }, when),
  );
  await db.batch(statements);
  return finish(command);
}

async function deactivatePartnerAddress(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const version = command.version ?? 0;
  const reason = textValue(command.payload ?? {}, "reason");
  const current = await first<{ version: number }>("SELECT version FROM partner_addresses WHERE id=? AND active=1", id);
  if (!current) throw new WorkflowError("NOT_FOUND", "Ship-to address not found.", 404);
  if (current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Ship-to address changed.", 409, current.version);
  const result: WorkflowResult = { message: "Ship-to address removed; orders already shipped keep their recorded address.", impact: { physical: "No inventory posting.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command);
  const when = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM partner_addresses WHERE id=? AND version=? AND active=1").bind(...claimValues(command, result, id), id, version),
    db.prepare(`UPDATE partner_addresses SET active=0,is_default=0,version=version+1 WHERE id=? AND version=? AND active=1 AND ${marker(command)}`).bind(id, version),
    auditStatement(command, "partner_address", id, "deactivated", result.message, { reason }, when),
    outboxStatement(command, "master.partner_address_deactivated", "partner_address", id, { reason }, when),
  ]);
  return finish(command);
}

async function saveBusinessPartner(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const creating = normalize(command.command).startsWith("create");
  const id = creating ? newId("partner") : textValue({ entityId: command.entityId }, "entityId");
  const code = textValue(payload, "code").toUpperCase();
  const name = textValue(payload, "name");
  const partnerType = textValue(payload, "partnerType");
  if (!["vendor", "customer", "both"].includes(partnerType)) throw new WorkflowError("VALIDATION_ERROR", "partnerType must be vendor, customer, or both.");
  const currency = textValue(payload, "currency", "CAD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new WorkflowError("VALIDATION_ERROR", "currency must be a three-letter ISO code.");
  const addressLine1 = optionalText(payload, "addressLine1");
  const addressLine2 = optionalText(payload, "addressLine2");
  const city = optionalText(payload, "city");
  const region = optionalText(payload, "region");
  const postalCode = optionalText(payload, "postalCode");
  const country = (optionalText(payload, "country") ?? "CA").toUpperCase();
  const creditLimitCents = payload.creditLimitCents == null ? 0 : numberValue(payload, "creditLimitCents", { positive: false, integer: true });
  if (creditLimitCents < 0) throw new WorkflowError("VALIDATION_ERROR", "creditLimitCents cannot be negative.");
  const creditHold = payload.creditHold === true;
  const version = command.version ?? 0;
  const current = creating ? null : await first<{ version: number }>("SELECT version FROM business_partners WHERE id=?", id);
  if (!creating && !current) throw new WorkflowError("NOT_FOUND", "Business partner not found.", 404);
  if (current && current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Business partner changed.", 409, current.version);
  if (await first("SELECT id FROM business_partners WHERE code=? AND id<>?", code, id)) throw new WorkflowError("DUPLICATE_PARTNER_CODE", `Partner code ${code} already exists.`, 409);
  const active = activeFor(command);
  const result: WorkflowResult = { message: `${name} ${creating ? "created" : "updated"}${active ? "" : " and deactivated"}.`, impact: { physical: "No inventory posting.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command);
  const when = new Date().toISOString();
  const statements: D1PreparedStatement[] = [creating
    ? db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM business_partners WHERE code=?)").bind(...claimValues(command, result, id), code)
    : db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM business_partners WHERE id=? AND version=? AND NOT EXISTS (SELECT 1 FROM business_partners WHERE code=? AND id<>?)").bind(...claimValues(command, result, id), id, version, code, id)];
  if (creating) statements.push(db.prepare(`INSERT INTO business_partners (id,code,name,partner_type,email,phone,address_line_1,address_line_2,city,region,postal_code,country,payment_terms,currency,credit_limit_cents,credit_hold,active,version,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,? WHERE ${marker(command)}`).bind(id, code, name, partnerType, optionalText(payload, "email"), optionalText(payload, "phone"), addressLine1, addressLine2, city, region, postalCode, country, optionalText(payload, "paymentTerms"), currency, creditLimitCents, creditHold ? 1 : 0, active ? 1 : 0, when));
  else statements.push(db.prepare(`UPDATE business_partners SET code=?,name=?,partner_type=?,email=?,phone=?,address_line_1=?,address_line_2=?,city=?,region=?,postal_code=?,country=?,payment_terms=?,currency=?,credit_limit_cents=?,credit_hold=?,active=?,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`)
    .bind(code, name, partnerType, optionalText(payload, "email"), optionalText(payload, "phone"), addressLine1, addressLine2, city, region, postalCode, country, optionalText(payload, "paymentTerms"), currency, creditLimitCents, creditHold ? 1 : 0, active ? 1 : 0, id, version));
  statements.push(
    auditStatement(command, "business_partner", id, creating ? "created" : "updated", result.message, { code, partnerType, currency, active, creditLimitCents, creditHold, city, region, country }, when),
    outboxStatement(command, creating ? "master.business_partner_created" : "master.business_partner_updated", "business_partner", id, { code, active, creditHold }, when),
  );
  await db.batch(statements);
  return finish(command);
}

async function saveSalesPerson(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const creating = normalize(command.command).startsWith("create");
  const id = creating ? newId("sales-person") : textValue({ entityId: command.entityId }, "entityId");
  const code = textValue(payload, "code").toUpperCase();
  const name = textValue(payload, "name");
  const email = optionalText(payload, "email");
  const phone = optionalText(payload, "phone");
  if (code.length > 32) throw new WorkflowError("VALIDATION_ERROR", "Salesperson code must be 32 characters or fewer.");
  if (name.length > 120) throw new WorkflowError("VALIDATION_ERROR", "Salesperson name must be 120 characters or fewer.");
  if (email && (!email.includes("@") || email.length > 254)) throw new WorkflowError("VALIDATION_ERROR", "Enter a valid salesperson email address.");
  const version = command.version ?? 0;
  const current = creating ? null : await first<{ version: number }>("SELECT version FROM sales_people WHERE id=?", id);
  if (!creating && !current) throw new WorkflowError("NOT_FOUND", "Salesperson not found.", 404);
  if (current && current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Salesperson changed; refresh and try again.", 409, current.version);
  if (await first("SELECT id FROM sales_people WHERE code=? AND id<>?", code, id)) throw new WorkflowError("DUPLICATE_SALES_PERSON_CODE", `Salesperson code ${code} already exists.`, 409);
  const active = activeFor(command);
  const result: WorkflowResult = { message: `${name} ${creating ? "added to" : "updated on"} the sales team.`, impact: { physical: "No inventory posting.", commercial: "Sales orders can be attributed to this salesperson.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command);
  const when = new Date().toISOString();
  const statements: D1PreparedStatement[] = [creating
    ? db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM sales_people WHERE code=?)").bind(...claimValues(command, result, id), code)
    : db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM sales_people WHERE id=? AND version=? AND NOT EXISTS (SELECT 1 FROM sales_people WHERE code=? AND id<>?)").bind(...claimValues(command, result, id), id, version, code, id)];
  if (creating) statements.push(db.prepare(`INSERT INTO sales_people (id,code,name,email,phone,active,version,created_at,updated_at)
    SELECT ?,?,?,?,?,?,1,?,? WHERE ${marker(command)}`).bind(id, code, name, email, phone, active ? 1 : 0, when, when));
  else statements.push(db.prepare(`UPDATE sales_people SET code=?,name=?,email=?,phone=?,active=?,version=version+1,updated_at=? WHERE id=? AND version=? AND ${marker(command)}`)
    .bind(code, name, email, phone, active ? 1 : 0, when, id, version));
  statements.push(
    auditStatement(command, "sales_person", id, creating ? "created" : "updated", result.message, { code, name, active }, when),
    outboxStatement(command, creating ? "sales_person.created" : "sales_person.updated", "sales_person", id, { code, name, active }, when),
  );
  await db.batch(statements);
  return finish(command);
}

async function createUnitOfMeasure(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const code = textValue(payload, "code").toUpperCase();
  const name = textValue(payload, "name");
  const dimension = textValue(payload, "dimension", "quantity").toLowerCase();
  const precision = payload.precision == null ? 0 : numberValue(payload, "precision", { positive: false, integer: true });
  if (precision < 0 || precision > 3) throw new WorkflowError("INVALID_UOM_PRECISION", "UOM precision must be a whole number from 0 through 3.");
  if (await first("SELECT id FROM units_of_measure WHERE code=?", code)) throw new WorkflowError("DUPLICATE_UOM", `${code} already exists.`, 409);
  const id = newId("uom");
  const result: WorkflowResult = { message: `${code} created and available for product configuration.`, impact: { physical: "No quantity changed.", commercial: "Products can use this unit after a valid conversion is configured.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM units_of_measure WHERE code=?)").bind(...claimValues(command, result, id), code),
    db.prepare(`INSERT INTO units_of_measure (id,code,name,dimension,precision,active) SELECT ?,?,?,?,?,1 WHERE ${marker(command)}`).bind(id, code, name, dimension, precision),
    auditStatement(command, "unit_of_measure", id, "created", result.message, { code, name, dimension, precision }, when),
    outboxStatement(command, "master.uom_created", "unit_of_measure", id, { code, dimension, precision }, when),
  ]);
  return finish(command);
}

async function createUomConversion(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const productId = optionalText(payload, "productId");
  const fromUomId = textValue(payload, "fromUomId");
  const toUomId = textValue(payload, "toUomId");
  const numerator = numberValue(payload, "numerator", { positive: true, integer: true });
  const denominator = numberValue(payload, "denominator", { positive: true, integer: true });
  const roundingMode = textValue(payload, "roundingMode", "nearest");
  if (fromUomId === toUomId) throw new WorkflowError("INVALID_UOM_CONVERSION", "Conversion source and destination units must be different.");
  if (!["nearest", "down", "up"].includes(roundingMode)) throw new WorkflowError("INVALID_UOM_CONVERSION", "Rounding mode must be nearest, down, or up.");
  const units = await all<{ id: string; dimension: string; active: number }>("SELECT id,dimension,active FROM units_of_measure WHERE id IN (?,?)", fromUomId, toUomId);
  if (units.length !== 2 || units.some((unit) => !unit.active)) throw new WorkflowError("INVALID_UOM", "Select two active units of measure.", 409);
  if (units[0].dimension !== units[1].dimension) throw new WorkflowError("UOM_DIMENSION_MISMATCH", "Conversions can only connect units in the same dimension.", 409);
  if (productId) {
    const product = await first<{ baseDimension: string }>("SELECT u.dimension AS baseDimension FROM products p JOIN units_of_measure u ON u.id=p.base_uom_id WHERE p.id=? AND p.active=1", productId);
    if (!product) throw new WorkflowError("INVALID_PRODUCT", "Select an active product for a product-specific conversion.", 409);
    if (product.baseDimension !== units[0].dimension) throw new WorkflowError("UOM_DIMENSION_MISMATCH", "The conversion dimension must match the product base unit.", 409);
  }
  const duplicate = await first("SELECT id FROM uom_conversions WHERE from_uom_id=? AND to_uom_id=? AND (product_id=? OR (product_id IS NULL AND ? IS NULL))", fromUomId, toUomId, productId ?? null, productId ?? null);
  if (duplicate) throw new WorkflowError("DUPLICATE_UOM_CONVERSION", "That conversion already exists for the selected scope.", 409);
  const id = newId("uom-conversion");
  const scope = productId ? "product-specific" : "global";
  const result: WorkflowResult = { message: `${scope} UOM conversion created.`, impact: { physical: "No existing quantity changed.", commercial: "Future order and inventory quantities can use this conversion.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM uom_conversions WHERE from_uom_id=? AND to_uom_id=? AND (product_id=? OR (product_id IS NULL AND ? IS NULL)))").bind(...claimValues(command, result, id), fromUomId, toUomId, productId ?? null, productId ?? null),
    db.prepare(`INSERT INTO uom_conversions (id,product_id,from_uom_id,to_uom_id,numerator,denominator,rounding_mode) SELECT ?,?,?,?,?,?,? WHERE ${marker(command)}`).bind(id, productId ?? null, fromUomId, toUomId, numerator, denominator, roundingMode),
    auditStatement(command, "uom_conversion", id, "created", result.message, { productId, fromUomId, toUomId, numerator, denominator, roundingMode }, when),
    outboxStatement(command, "master.uom_conversion_created", "uom_conversion", id, { productId, fromUomId, toUomId, numerator, denominator }, when),
  ]);
  return finish(command);
}

/**
 * Configure the common "buy a package, stock the contents" case in one transaction. The
 * generic conversion editor remains useful for global and fractional conversions, but making
 * an administrator create a product conversion and then separately edit the product left a
 * half-configured state in which purchase orders could not use the new unit.
 */
async function configureProductPurchaseUnit(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const productId = textValue({ productId: command.entityId ?? payload.productId }, "productId");
  const purchaseUomId = textValue(payload, "purchaseUomId");
  const unitsPerPurchaseUom = numberValue(payload, "unitsPerPurchaseUom", { positive: true, integer: true });
  const version = command.version ?? 0;
  const product = await first<{
    id: string; sku: string; version: number; active: number; trackingPolicy: string;
    baseUomId: string; baseUomCode: string; baseDimension: string;
  }>(`SELECT p.id,p.sku,p.version,p.active,p.tracking_policy AS trackingPolicy,
      p.base_uom_id AS baseUomId,base.code AS baseUomCode,base.dimension AS baseDimension
    FROM products p JOIN units_of_measure base ON base.id=p.base_uom_id WHERE p.id=?`, productId);
  if (!product) throw new WorkflowError("NOT_FOUND", "Product was not found.", 404);
  if (!product.active) throw new WorkflowError("INVALID_PRODUCT", "Purchase packaging can only be configured for an active product.", 409, product.version);
  if (product.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Product changed; refresh before saving its purchase packaging.", 409, product.version);
  const purchaseUom = await first<{ id: string; code: string; dimension: string; active: number }>(
    "SELECT id,code,dimension,active FROM units_of_measure WHERE id=?", purchaseUomId,
  );
  if (!purchaseUom?.active) throw new WorkflowError("INVALID_UOM", "Select an active purchasing unit.", 409);
  if (purchaseUom.dimension !== product.baseDimension) throw new WorkflowError("UOM_DIMENSION_MISMATCH", "The purchasing and base inventory units must have the same dimension.", 409);
  if (purchaseUomId === product.baseUomId && unitsPerPurchaseUom !== 1) {
    throw new WorkflowError("INVALID_UOM_CONVERSION", `The base unit ${product.baseUomCode} must convert to itself at 1:1.`);
  }
  if (product.trackingPolicy === "serial" && unitsPerPurchaseUom !== 1) {
    throw new WorkflowError("SERIAL_PACKAGE_UNSUPPORTED", "Serial-tracked products must be received one serial at a time, so their purchasing unit must convert 1:1.", 409);
  }

  // Purchase lines retain both the entered package quantity and its base quantity. Do not
  // reinterpret those durable documents by allowing the same UOM code to acquire a different
  // pack size later; a genuinely different pack size should have its own UOM (for example CASE24).
  const conflictingHistoricalLine = await first<{ orderNumber: string }>(`SELECT po.number AS orderNumber
    FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id
    WHERE pol.product_id=? AND pol.ordered_uom_id=? AND pol.ordered_uom_qty>0
      AND ABS(pol.ordered_qty/pol.ordered_uom_qty-?)>0.000001
    ORDER BY po.created_at,pol.id LIMIT 1`, productId, purchaseUomId, unitsPerPurchaseUom);
  if (conflictingHistoricalLine) {
    throw new WorkflowError("UOM_CONVERSION_IN_USE", `Purchase order ${conflictingHistoricalLine.orderNumber} used a different pack size for ${purchaseUom.code}. Create a new unit code for the new pack size so receipt history stays accurate.`, 409, product.version);
  }

  const currentConversion = purchaseUomId === product.baseUomId ? null : await first<{ id: string }>(
    "SELECT id FROM uom_conversions WHERE product_id=? AND from_uom_id=? AND to_uom_id=?",
    productId, purchaseUomId, product.baseUomId,
  );
  const conversionId = currentConversion?.id ?? newId("uom-conversion");
  const message = `${product.sku} now purchases in ${purchaseUom.code}; receiving 1 ${purchaseUom.code} adds ${unitsPerPurchaseUom} ${product.baseUomCode} to inventory.`;
  const result: WorkflowResult = {
    message,
    impact: { physical: "Existing stock was not changed.", commercial: "Future purchase-order lines use the configured package unit and conversion.", onHandDelta: 0 },
    recordId: productId,
  };
  const db = commandD1(command);
  const when = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM products p WHERE p.id=? AND p.version=? AND p.active=1
        AND EXISTS (SELECT 1 FROM units_of_measure u WHERE u.id=? AND u.active=1 AND u.dimension=?)
        AND NOT EXISTS (SELECT 1 FROM purchase_order_lines pol WHERE pol.product_id=p.id AND pol.ordered_uom_id=?
          AND pol.ordered_uom_qty>0 AND ABS(pol.ordered_qty/pol.ordered_uom_qty-?)>0.000001)`)
      .bind(...claimValues(command, result, productId), productId, version, purchaseUomId, product.baseDimension, purchaseUomId, unitsPerPurchaseUom),
    db.prepare(`UPDATE products SET purchase_uom_id=?,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`)
      .bind(purchaseUomId, productId, version),
  ];
  if (purchaseUomId !== product.baseUomId) {
    statements.push(currentConversion
      ? db.prepare(`UPDATE uom_conversions SET numerator=?,denominator=1,rounding_mode='nearest' WHERE id=? AND product_id=? AND ${marker(command)}`)
          .bind(unitsPerPurchaseUom, conversionId, productId)
      : db.prepare(`INSERT INTO uom_conversions (id,product_id,from_uom_id,to_uom_id,numerator,denominator,rounding_mode)
          SELECT ?,?,?,?,?,1,'nearest' WHERE ${marker(command)}`)
          .bind(conversionId, productId, purchaseUomId, product.baseUomId, unitsPerPurchaseUom));
  }
  statements.push(
    auditStatement(command, "product", productId, "purchase_unit_configured", message,
      { purchaseUomId, purchaseUomCode: purchaseUom.code, baseUomId: product.baseUomId, baseUomCode: product.baseUomCode, unitsPerPurchaseUom }, when),
    outboxStatement(command, "master.product_purchase_unit_configured", "product", productId,
      { purchaseUomId, baseUomId: product.baseUomId, unitsPerPurchaseUom }, when),
  );
  await db.batch(statements);
  return finish(command);
}

async function saveProduct(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const creating = normalize(command.command).startsWith("create");
  const id = creating ? newId("product") : textValue({ entityId: command.entityId }, "entityId");
  const sku = textValue(payload, "sku").toUpperCase();
  const name = textValue(payload, "name");
  const tracking = textValue(payload, "trackingPolicy", "quantity");
  const policy = textValue(payload, "inventoryPolicy", "stocked");
  if (!["quantity", "lot", "serial"].includes(tracking) || !["stocked", "special_order", "drop_ship"].includes(policy)) throw new WorkflowError("VALIDATION_ERROR", "Invalid trackingPolicy or inventoryPolicy.");
  const standard = numberValue(payload, "standardCostCents", { positive: false, integer: true });
  const enteredPrice = numberValue(payload, "sellingPriceCents", { positive: false, integer: true });
  if (standard < 0 || enteredPrice < 0) throw new WorkflowError("VALIDATION_ERROR", "Costs cannot be negative.");

  const baseUomId = optionalText(payload, "baseUomId");
  const purchaseUomId = optionalText(payload, "purchaseUomId") ?? baseUomId;
  const salesUomId = optionalText(payload, "salesUomId") ?? baseUomId;
  if (!baseUomId || !purchaseUomId || !salesUomId) throw new WorkflowError("UOM_REQUIRED", "Select an active base unit of measure for the product.", 409);
  const uoms = await all<{ id: string; dimension: string; precision: number; active: number }>("SELECT id,dimension,precision,active FROM units_of_measure WHERE id IN (?,?,?)", baseUomId, purchaseUomId, salesUomId);
  const byId = new Map(uoms.map((uom) => [uom.id, uom]));
  const base = byId.get(baseUomId);
  if (!base?.active || !byId.get(purchaseUomId)?.active || !byId.get(salesUomId)?.active) throw new WorkflowError("INVALID_UOM", "Base, purchasing, and sales UOMs must all be active.", 409);
  if (byId.get(purchaseUomId)?.dimension !== base.dimension || byId.get(salesUomId)?.dimension !== base.dimension) throw new WorkflowError("UOM_DIMENSION_MISMATCH", "Product UOMs must share the same measurement dimension.", 409);
  if (tracking === "serial" && base.precision !== 0) throw new WorkflowError("SERIAL_UOM_PRECISION", "Serial-tracked products require a whole-unit base UOM.", 409);

  const version = command.version ?? 0;
  const current = creating ? null : await first<{ version: number; trackingPolicy: string; baseUomId: string | null; category: string; lastUnitCostCents: number | null; sellingPriceCents: number; pricingMode: string; manualPriceReason: string | null; reorderPoint: number; maxStockLevel: number; reorderRuleMode: string; reorderRulePercent: number | null }>(
    "SELECT version,tracking_policy AS trackingPolicy,base_uom_id AS baseUomId,category,last_unit_cost_cents AS lastUnitCostCents,selling_price_cents AS sellingPriceCents,pricing_mode AS pricingMode,manual_price_reason AS manualPriceReason,reorder_point AS reorderPoint,max_stock_level AS maxStockLevel,reorder_rule_mode AS reorderRuleMode,reorder_rule_percent AS reorderRulePercent FROM products WHERE id=?", id);
  if (!creating && !current) throw new WorkflowError("NOT_FOUND", "Product not found.", 404);
  if (current && current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Product changed.", 409, current.version);
  const requestedReorder = payload.reorderPoint == null ? current?.reorderPoint ?? 0 : numberValue(payload, "reorderPoint", { positive: false });
  const maxStock = payload.maxStockLevel == null ? current?.maxStockLevel ?? requestedReorder : numberValue(payload, "maxStockLevel", { positive: false });
  const reorderRuleMode = optionalText(payload, "reorderRuleMode") ?? current?.reorderRuleMode ?? "manual";
  if (!["manual", "global", "custom"].includes(reorderRuleMode)) throw new WorkflowError("VALIDATION_ERROR", "reorderRuleMode must be manual, global, or custom.");
  let reorderRulePercent: number | null = null;
  if (reorderRuleMode === "global") {
    const companyRule = await setting<{ percent?: unknown }>("inventory.reorderPointRule", { percent: 70 });
    reorderRulePercent = Number(companyRule.percent ?? 70);
  } else if (reorderRuleMode === "custom") {
    reorderRulePercent = payload.reorderRulePercent == null && current?.reorderRuleMode === "custom"
      ? Number(current.reorderRulePercent)
      : numberValue(payload, "reorderRulePercent");
  }
  if (reorderRulePercent != null && (!Number.isFinite(reorderRulePercent) || reorderRulePercent <= 0 || reorderRulePercent > 100)) throw new WorkflowError("VALIDATION_ERROR", "Reorder percentages must be greater than 0 and no more than 100.");
  const reorder = reorderRulePercent == null ? requestedReorder : Math.round(maxStock * reorderRulePercent * 10) / 1000;
  if (reorder < 0 || maxStock < 0) throw new WorkflowError("VALIDATION_ERROR", "Replenishment levels cannot be negative.");
  if (policy === "stocked" && maxStock < reorder) throw new WorkflowError("VALIDATION_ERROR", "The maximum stock level must be at least the reorder point.");
  if (await first("SELECT id FROM products WHERE sku=? AND id<>?", sku, id)) throw new WorkflowError("DUPLICATE_PRODUCT_SKU", `SKU ${sku} already exists.`, 409);
  for (const identifier of [sku, optionalText(payload, "manufacturerSku"), name].filter((value): value is string => Boolean(value))) {
    if (await first("SELECT id FROM product_aliases WHERE normalized_alias=? AND product_id<>?", normalizedAlias(identifier), id)) {
      throw new WorkflowError("DUPLICATE_PRODUCT_ALIAS", `“${identifier}” is already an alias for another product.`, 409);
    }
  }
  const requestedPricingMode = optionalText(payload, "pricingMode") ?? current?.pricingMode ?? "automatic";
  if (!["automatic", "manual"].includes(requestedPricingMode)) throw new WorkflowError("VALIDATION_ERROR", "pricingMode must be automatic or manual.");
  const pricingMode = requestedPricingMode as "automatic" | "manual";
  const costBasisCents = Number(current?.lastUnitCostCents ?? standard);
  const pricing = await suggestedPriceForProduct({ productId: id, category: textValue(payload, "category"), costBasisCents });
  const price = pricingMode === "automatic" ? pricing.suggestedSellingPriceCents : enteredPrice;
  const manualPriceReason = pricingMode === "manual" ? optionalText(payload, "manualPriceReason") ?? current?.manualPriceReason ?? (creating ? "Initial catalog price" : "Manual product maintenance") : null;
  const changesImmutableInventoryIdentity = Boolean(current && (current.trackingPolicy !== tracking || current.baseUomId !== baseUomId));
  if (changesImmutableInventoryIdentity) {
    const history = await first<{ count: number }>(`SELECT
      (SELECT COUNT(*) FROM stock_movements WHERE product_id=?)
      +(SELECT COUNT(*) FROM purchase_order_lines WHERE product_id=?)
      +(SELECT COUNT(*) FROM sales_order_lines WHERE product_id=?)
      +(SELECT COUNT(*) FROM inventory_balances WHERE product_id=? AND (on_hand_qty<>0 OR reserved_qty<>0)) AS count`, id, id, id, id);
    if (Number(history?.count ?? 0) > 0) throw new WorkflowError("MASTER_DATA_IN_USE", "Tracking policy and base inventory UOM cannot change after a product has transaction history.", 409);
  }
  const active = activeFor(command);
  const result: WorkflowResult = { message: `${sku} ${creating ? "created" : "updated"}${active ? "" : " and deactivated"}.`, impact: { physical: "No inventory posting.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command);
  const when = new Date().toISOString();
  const immutableHistoryGuard = changesImmutableInventoryIdentity
    ? `AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id=?)
       AND NOT EXISTS (SELECT 1 FROM purchase_order_lines WHERE product_id=?)
       AND NOT EXISTS (SELECT 1 FROM sales_order_lines WHERE product_id=?)
       AND NOT EXISTS (SELECT 1 FROM inventory_balances WHERE product_id=? AND (on_hand_qty<>0 OR reserved_qty<>0))`
    : "";
  const claim = creating
    ? db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM products WHERE sku=?)").bind(...claimValues(command, result, id), sku)
    : db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
        SELECT ?,?,?,?,?,?,? FROM products WHERE id=? AND version=? AND NOT EXISTS (SELECT 1 FROM products WHERE sku=? AND id<>?) ${immutableHistoryGuard}`)
      .bind(...claimValues(command, result, id), id, version, sku, id, ...(changesImmutableInventoryIdentity ? [id, id, id, id] : []));
  const values = [sku, optionalText(payload, "manufacturerSku"), name, textValue(payload, "category"), textValue(payload, "material"), textValue(payload, "dimensions"), textValue(payload, "finish"), tracking, policy, standard, price, pricing.suggestedSellingPriceCents, pricingMode, pricing.rule.id, manualPriceReason, when, reorder, maxStock, reorderRuleMode, reorderRulePercent, baseUomId, purchaseUomId, salesUomId, active ? 1 : 0] as const;
  const write = creating
    ? db.prepare(`INSERT INTO products (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,applied_margin_rule_id,manual_price_reason,pricing_updated_at,reorder_point,max_stock_level,reorder_rule_mode,reorder_rule_percent,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,? WHERE ${marker(command)}`).bind(id, ...values, when)
    : db.prepare(`UPDATE products SET sku=?,manufacturer_sku=?,name=?,category=?,material=?,dimensions=?,finish=?,tracking_policy=?,inventory_policy=?,standard_cost_cents=?,selling_price_cents=?,suggested_selling_price_cents=?,pricing_mode=?,applied_margin_rule_id=?,manual_price_reason=?,pricing_updated_at=?,reorder_point=?,max_stock_level=?,reorder_rule_mode=?,reorder_rule_percent=?,base_uom_id=?,purchase_uom_id=?,sales_uom_id=?,active=?,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(...values, id, version);
  const statements: D1PreparedStatement[] = [claim, write];
  if (creating) {
    const configuredMethod = await setting<string>("valuation.defaultMethod", "fifo");
    const method = ["fifo", "average", "standard"].includes(configuredMethod) ? configuredMethod : "fifo";
    statements.push(db.prepare(`INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
      SELECT ?,?,?,?,1,?,? WHERE ${marker(command)}`).bind(id, method, standard, standard, when, command.actor.label));
  }
  statements.push(
    db.prepare(`INSERT INTO catalog_price_history
      (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
      SELECT ?,?,?,?,?,?,?,?,?,NULL,?,?,? WHERE ${marker(command)}`)
      .bind(newId("catalog-price"), id, creating ? "product_created" : "product_master_updated", costBasisCents, current?.sellingPriceCents ?? price, pricing.suggestedSellingPriceCents, price, pricingMode, pricing.rule.id, manualPriceReason, when, command.actor.label),
    auditStatement(command, "product", id, creating ? "created" : "updated", result.message, { sku, tracking, policy, reorderPoint: reorder, maxStockLevel: maxStock, reorderRuleMode, reorderRulePercent, baseUomId, purchaseUomId, salesUomId, active, pricingMode, suggestedSellingPriceCents: pricing.suggestedSellingPriceCents, sellingPriceCents: price }, when),
    outboxStatement(command, creating ? "master.product_created" : "master.product_updated", "product", id, { sku, active, pricingMode, sellingPriceCents: price }, when),
  );
  await db.batch(statements);
  return finish(command);
}

function normalizedAlias(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-CA").replaceAll(/\s+/g, " ");
}

async function addProductAlias(command: WorkflowCommand) {
  const productId = textValue({ entityId: command.entityId }, "entityId");
  const version = command.version ?? 0;
  const alias = textValue(command.payload ?? {}, "alias");
  const normalized = normalizedAlias(alias);
  const product = await first<{ version: number; active: number; sku: string; name: string; manufacturerSku: string | null }>(
    "SELECT version,active,sku,name,manufacturer_sku AS manufacturerSku FROM products WHERE id=?", productId,
  );
  if (!product) throw new WorkflowError("NOT_FOUND", "Product not found.", 404);
  if (!product.active) throw new WorkflowError("INVALID_STATE", "Aliases can only be added to an active product.", 409, product.version);
  if (product.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Product changed; refresh before adding an alias.", 409, product.version);
  if ([product.sku, product.name, product.manufacturerSku ?? ""].some((value) => value && normalizedAlias(value) === normalized)) {
    throw new WorkflowError("DUPLICATE_PRODUCT_ALIAS", "That value already identifies this product.", 409, product.version);
  }
  const collision = await first<{ productId: string }>(`SELECT product_id AS productId FROM product_aliases WHERE normalized_alias=?
    UNION ALL SELECT id FROM products WHERE active=1 AND (lower(trim(sku))=? OR lower(trim(name))=? OR lower(trim(COALESCE(manufacturer_sku,'')))=?) LIMIT 1`,
    normalized, normalized, normalized, normalized);
  if (collision) throw new WorkflowError("DUPLICATE_PRODUCT_ALIAS", "That alias already belongs to a product.", 409, product.version);
  const id = newId("product-alias");
  const result: WorkflowResult = { recordId: productId, message: `Alias “${alias}” added to ${product.sku}.`, impact: { physical: "No inventory changed.", commercial: "The part can now be found by this alternate name or number.", onHandDelta: 0 } };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM products p WHERE p.id=? AND p.version=? AND p.active=1
        AND NOT EXISTS (SELECT 1 FROM product_aliases WHERE normalized_alias=?)
        AND NOT EXISTS (SELECT 1 FROM products other WHERE other.active=1 AND (lower(trim(other.sku))=? OR lower(trim(other.name))=? OR lower(trim(COALESCE(other.manufacturer_sku,'')))=?))`)
      .bind(...claimValues(command, result, productId), productId, version, normalized, normalized, normalized, normalized),
    db.prepare(`INSERT INTO product_aliases (id,product_id,alias,normalized_alias,alias_type,created_at,created_by)
      SELECT ?,?,?,?,'alternate',?,? WHERE ${marker(command)}`).bind(id, productId, alias, normalized, when, command.actor.label),
    db.prepare(`UPDATE products SET version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(productId, version),
    auditStatement(command, "product", productId, "alias_added", result.message, { alias, aliasId: id }, when),
    outboxStatement(command, "master.product_alias_added", "product", productId, { alias, aliasId: id }, when),
  ]);
  return finish(command);
}

async function removeProductAlias(command: WorkflowCommand) {
  const productId = textValue({ entityId: command.entityId }, "entityId");
  const version = command.version ?? 0;
  const aliasId = textValue(command.payload ?? {}, "aliasId");
  const row = await first<{ alias: string; aliasType: string; version: number }>(`SELECT pa.alias,pa.alias_type AS aliasType,p.version FROM product_aliases pa JOIN products p ON p.id=pa.product_id
    WHERE pa.id=? AND pa.product_id=? AND p.active=1`, aliasId, productId);
  if (!row) throw new WorkflowError("NOT_FOUND", "Product alias not found.", 404);
  if (row.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Product changed; refresh before removing the alias.", 409, row.version);
  if (row.aliasType === "merged_record") throw new WorkflowError("MERGED_ALIAS_REQUIRED", "Aliases retained from a merged product are permanent audit identifiers.", 409, row.version);
  const result: WorkflowResult = { recordId: productId, message: `Alias “${row.alias}” removed.`, impact: { physical: "No inventory changed.", commercial: "This alternate search term no longer resolves to the product.", onHandDelta: 0 } };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM products p JOIN product_aliases pa ON pa.product_id=p.id WHERE p.id=? AND p.version=? AND p.active=1 AND pa.id=?`)
      .bind(...claimValues(command, result, productId), productId, version, aliasId),
    db.prepare(`DELETE FROM product_aliases WHERE id=? AND product_id=? AND ${marker(command)}`).bind(aliasId, productId),
    db.prepare(`UPDATE products SET version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(productId, version),
    auditStatement(command, "product", productId, "alias_removed", result.message, { alias: row.alias, aliasId }, when),
    outboxStatement(command, "master.product_alias_removed", "product", productId, { alias: row.alias, aliasId }, when),
  ]);
  return finish(command);
}

async function setProductDefaultLocation(command: WorkflowCommand) {
  const productId = textValue({ entityId: command.entityId }, "entityId");
  const version = command.version ?? 0;
  const payload = command.payload ?? {};
  const warehouseId = textValue(payload, "warehouseId");
  const locationId = textValue(payload, "locationId");
  const current = await first<{ version: number; sku: string }>("SELECT version,sku FROM products WHERE id=? AND active=1", productId);
  if (!current) throw new WorkflowError("NOT_FOUND", "Active product not found.", 404);
  if (current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Product changed; refresh before changing its preferred bin.", 409, current.version);
  const location = await first<{ code: string; name: string }>(`SELECT code,name FROM locations
    WHERE id=? AND warehouse_id=? AND active=1 AND inventory_status='usable'`, locationId, warehouseId);
  if (!location) throw new WorkflowError("INVALID_DEFAULT_LOCATION", "Select an active usable bin in the chosen warehouse.", 409, current.version);
  const result: WorkflowResult = { recordId: productId, message: `${current.sku} will default to ${location.code} in this warehouse.`, impact: { physical: "Existing inventory did not move.", commercial: "Future purchase, sales, counter-sale, and invoice lines default to the selected bin.", onHandDelta: 0 } };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM products p WHERE p.id=? AND p.version=? AND p.active=1
        AND EXISTS (SELECT 1 FROM locations l WHERE l.id=? AND l.warehouse_id=? AND l.active=1 AND l.inventory_status='usable')`)
      .bind(...claimValues(command, result, productId), productId, version, locationId, warehouseId),
    db.prepare(`INSERT INTO product_default_locations (product_id,warehouse_id,location_id,version,updated_at,updated_by)
      SELECT ?,?,?,1,?,? WHERE ${marker(command)}
      ON CONFLICT(product_id,warehouse_id) DO UPDATE SET location_id=excluded.location_id,version=product_default_locations.version+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
      .bind(productId, warehouseId, locationId, when, command.actor.label),
    db.prepare(`UPDATE products SET version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(productId, version),
    auditStatement(command, "product", productId, "default_location_set", result.message, { warehouseId, locationId }, when),
    outboxStatement(command, "master.product_default_location_set", "product", productId, { warehouseId, locationId }, when),
  ]);
  return finish(command);
}

async function mergeProducts(command: WorkflowCommand) {
  const targetId = textValue({ entityId: command.entityId }, "entityId");
  const sourceId = textValue(command.payload ?? {}, "sourceProductId");
  if (targetId === sourceId) throw new WorkflowError("INVALID_MERGE", "Choose a different product to merge.");
  const version = command.version ?? 0;
  const products = await all<{ id: string; sku: string; name: string; manufacturerSku: string | null; trackingPolicy: string; baseUomId: string; version: number; active: number }>(
    `SELECT id,sku,name,manufacturer_sku AS manufacturerSku,tracking_policy AS trackingPolicy,base_uom_id AS baseUomId,version,active FROM products WHERE id IN (?,?)`, targetId, sourceId,
  );
  const target = products.find((product) => product.id === targetId);
  const source = products.find((product) => product.id === sourceId);
  if (!target || !source) throw new WorkflowError("NOT_FOUND", "Both products must exist.", 404);
  if (!target.active || !source.active) throw new WorkflowError("INVALID_STATE", "Only two active products can be merged.", 409);
  if (target.version !== version) throw new WorkflowError("VERSION_CONFLICT", "The surviving product changed; refresh before merging.", 409, target.version);
  if (target.baseUomId !== source.baseUomId) throw new WorkflowError("MERGE_UOM_MISMATCH", "Products must use the same base unit before their quantities can be combined.", 409);
  if (target.trackingPolicy !== source.trackingPolicy) throw new WorkflowError("MERGE_TRACKING_MISMATCH", "Products must use the same tracking policy before they can be merged.", 409);
  const openCount = await first<{ number: string }>(`SELECT session.number FROM inventory_count_session_lines line
    JOIN inventory_count_sessions session ON session.id=line.session_id
    WHERE line.product_id IN (?,?) AND session.status IN ('draft','counting','review','awaiting_approval') LIMIT 1`, targetId, sourceId);
  if (openCount) throw new WorkflowError("ACTIVE_COUNT_EXISTS", `Finish or cancel inventory count ${openCount.number} before merging these products.`, 409);
  const serialCollision = await first<{ serial: string }>(`SELECT source.serial_number AS serial FROM inventory_units source
    JOIN inventory_units target ON target.product_id=? AND target.serial_number=source.serial_number WHERE source.product_id=? LIMIT 1`, targetId, sourceId);
  if (serialCollision) throw new WorkflowError("MERGE_SERIAL_COLLISION", `Serial ${serialCollision.serial} exists on both products. Resolve that identity before merging.`, 409);
  const aliasCandidates = [source.sku, source.name, source.manufacturerSku].filter((value): value is string => Boolean(value?.trim()));
  for (const alias of aliasCandidates) {
    const normalized = normalizedAlias(alias);
    const collision = await first<{ productId: string }>(`SELECT product_id AS productId FROM product_aliases WHERE normalized_alias=? AND product_id NOT IN (?,?)
      UNION ALL SELECT id FROM products WHERE active=1 AND id NOT IN (?,?) AND (lower(trim(sku))=? OR lower(trim(name))=? OR lower(trim(COALESCE(manufacturer_sku,'')))=?) LIMIT 1`,
      normalized, targetId, sourceId, targetId, sourceId, normalized, normalized, normalized);
    if (collision) throw new WorkflowError("DUPLICATE_PRODUCT_ALIAS", `The merged identifier “${alias}” already belongs to another product.`, 409);
  }
  const duplicateLots = await all<{ sourceLotId: string; targetLotId: string }>(`SELECT source.id AS sourceLotId,target.id AS targetLotId FROM inventory_lots source
    JOIN inventory_lots target ON target.product_id=? AND target.lot_number=source.lot_number WHERE source.product_id=?`, targetId, sourceId);
  const sourceBalance = await first<{ onHand: number; reserved: number }>("SELECT COALESCE(SUM(on_hand_qty),0) AS onHand,COALESCE(SUM(reserved_qty),0) AS reserved FROM inventory_balances WHERE product_id=?", sourceId);
  const result: WorkflowResult = {
    recordId: targetId,
    message: `${source.sku} merged into ${target.sku}; aliases and ${Number(sourceBalance?.onHand ?? 0)} on-hand units were consolidated.`,
    impact: { physical: "On-hand and reserved balances were summed by bin; no movement posting was created.", commercial: "Open order, allocation, pricing, and product references now use the surviving item.", financial: "Inventory value and cost layers now report under the surviving item.", onHandDelta: 0 },
  };
  const db = commandD1(command); const when = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM products target JOIN products source ON source.id=?
      WHERE target.id=? AND target.version=? AND target.active=1 AND source.active=1
        AND target.base_uom_id=source.base_uom_id AND target.tracking_policy=source.tracking_policy
        AND NOT EXISTS (SELECT 1 FROM inventory_units su JOIN inventory_units tu ON tu.product_id=target.id AND tu.serial_number=su.serial_number WHERE su.product_id=source.id)`)
      .bind(...claimValues(command, result, targetId), sourceId, targetId, version),
    db.prepare(`INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
      SELECT ?,location_id,on_hand_qty,reserved_qty,1 FROM inventory_balances WHERE product_id=? AND ${marker(command)}
      ON CONFLICT(product_id,location_id) DO UPDATE SET on_hand_qty=inventory_balances.on_hand_qty+excluded.on_hand_qty,reserved_qty=inventory_balances.reserved_qty+excluded.reserved_qty,version=inventory_balances.version+1`).bind(targetId, sourceId),
    db.prepare(`DELETE FROM inventory_balances WHERE product_id=? AND ${marker(command)}`).bind(sourceId),
  ];
  for (const lot of duplicateLots) statements.push(
    db.prepare(`UPDATE movement_assignments SET lot_id=? WHERE lot_id=? AND ${marker(command)}`).bind(lot.targetLotId, lot.sourceLotId),
    db.prepare(`UPDATE inventory_units SET lot_id=? WHERE lot_id=? AND ${marker(command)}`).bind(lot.targetLotId, lot.sourceLotId),
    db.prepare(`DELETE FROM inventory_lots WHERE id=? AND ${marker(command)}`).bind(lot.sourceLotId),
  );
  const productTables = [
    "purchase_order_lines", "receipt_lines", "sales_order_lines", "drop_ship_deliveries", "reservations", "shipment_lines",
    "vendor_returns", "customer_returns", "inventory_counts", "inventory_units",
    "vendor_bill_lines", "customer_invoice_lines", "cost_layers", "inventory_value_entries", "margin_rules",
    "catalog_price_history", "inventory_transfer_lines",
  ];
  statements.push(db.prepare(`UPDATE inventory_lots SET product_id=? WHERE product_id=? AND ${marker(command)}`).bind(targetId, sourceId));
  for (const table of productTables) statements.push(db.prepare(`UPDATE ${table} SET product_id=? WHERE product_id=? AND ${marker(command)}`).bind(targetId, sourceId));
  statements.push(
    db.prepare(`DELETE FROM uom_conversions WHERE product_id=? AND EXISTS (SELECT 1 FROM uom_conversions target WHERE target.product_id=? AND target.from_uom_id=uom_conversions.from_uom_id AND target.to_uom_id=uom_conversions.to_uom_id) AND ${marker(command)}`).bind(sourceId, targetId),
    db.prepare(`UPDATE uom_conversions SET product_id=? WHERE product_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`DELETE FROM price_list_entries WHERE product_id=? AND EXISTS (SELECT 1 FROM price_list_entries target WHERE target.product_id=? AND target.price_list_id=price_list_entries.price_list_id AND target.uom_id=price_list_entries.uom_id AND target.minimum_quantity=price_list_entries.minimum_quantity) AND ${marker(command)}`).bind(sourceId, targetId),
    db.prepare(`UPDATE price_list_entries SET product_id=? WHERE product_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`DELETE FROM product_cost_history WHERE product_id=? AND EXISTS (SELECT 1 FROM product_cost_history target WHERE target.product_id=? AND target.source_purchase_order_id=product_cost_history.source_purchase_order_id AND target.purchase_order_revision=product_cost_history.purchase_order_revision) AND ${marker(command)}`).bind(sourceId, targetId),
    db.prepare(`UPDATE product_cost_history SET product_id=? WHERE product_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE valuation_policies SET product_id=? WHERE product_id=? AND NOT EXISTS (SELECT 1 FROM valuation_policies WHERE product_id=?) AND ${marker(command)}`).bind(targetId, sourceId, targetId),
    db.prepare(`DELETE FROM valuation_policies WHERE product_id=? AND ${marker(command)}`).bind(sourceId),
    db.prepare(`DELETE FROM product_default_locations WHERE product_id=? AND EXISTS (SELECT 1 FROM product_default_locations target WHERE target.product_id=? AND target.warehouse_id=product_default_locations.warehouse_id) AND ${marker(command)}`).bind(sourceId, targetId),
    db.prepare(`UPDATE product_default_locations SET product_id=? WHERE product_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE product_aliases SET product_id=? WHERE product_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE attachments SET document_id=? WHERE document_type='product' AND document_id=? AND deleted_at IS NULL AND ${marker(command)}`).bind(targetId, sourceId),
  );
  for (const alias of aliasCandidates) statements.push(db.prepare(`INSERT OR IGNORE INTO product_aliases
    (id,product_id,alias,normalized_alias,alias_type,created_at,created_by) SELECT ?,?,?,?,'merged_record',?,? WHERE ${marker(command)}`)
    .bind(newId("product-alias"), targetId, alias, normalizedAlias(alias), when, command.actor.label));
  statements.push(
    db.prepare(`UPDATE approvals SET entity_id=? WHERE entity_type='product' AND entity_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE qbo_entity_links SET status='inactive',last_error='Local product merged into another master record' WHERE local_entity_type='product' AND local_entity_id=? AND ${marker(command)}`).bind(sourceId),
    db.prepare(`UPDATE master_record_merges SET target_id=? WHERE entity_type='product' AND target_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`INSERT INTO master_record_merges (id,entity_type,source_id,target_id,source_label,merged_at,merged_by)
      SELECT ?,'product',?,?,?,?,? WHERE ${marker(command)}`).bind(newId("merge"), sourceId, targetId, `${source.sku} · ${source.name}`, when, command.actor.label),
    db.prepare(`UPDATE products SET active=0,version=version+1 WHERE id=? AND active=1 AND ${marker(command)}`).bind(sourceId),
    db.prepare(`UPDATE products SET
      last_unit_cost_cents=COALESCE((SELECT last_unit_cost_cents FROM product_cost_history WHERE product_id=? ORDER BY effective_at DESC,id DESC LIMIT 1),last_unit_cost_cents),
      last_unit_cost_source_po_id=COALESCE((SELECT source_purchase_order_id FROM product_cost_history WHERE product_id=? ORDER BY effective_at DESC,id DESC LIMIT 1),last_unit_cost_source_po_id),
      last_unit_cost_source_po_line_id=(SELECT source_purchase_order_line_id FROM product_cost_history WHERE product_id=? ORDER BY effective_at DESC,id DESC LIMIT 1),
      last_unit_cost_vendor_id=COALESCE((SELECT vendor_id FROM product_cost_history WHERE product_id=? ORDER BY effective_at DESC,id DESC LIMIT 1),last_unit_cost_vendor_id),
      last_unit_cost_at=COALESCE((SELECT effective_at FROM product_cost_history WHERE product_id=? ORDER BY effective_at DESC,id DESC LIMIT 1),last_unit_cost_at),version=version+1
      WHERE id=? AND version=? AND ${marker(command)}`).bind(targetId, targetId, targetId, targetId, targetId, targetId, version),
    auditStatement(command, "product", targetId, "products_merged", result.message, { sourceProductId: sourceId, sourceSku: source.sku, sourceOnHand: Number(sourceBalance?.onHand ?? 0), sourceReserved: Number(sourceBalance?.reserved ?? 0) }, when),
    outboxStatement(command, "master.products_merged", "product", targetId, { sourceProductId: sourceId, sourceSku: source.sku }, when),
  );
  await db.batch(statements);
  return finish(command);
}

async function mergeBusinessPartners(command: WorkflowCommand) {
  const targetId = textValue({ entityId: command.entityId }, "entityId");
  const sourceId = textValue(command.payload ?? {}, "sourcePartnerId");
  if (targetId === sourceId) throw new WorkflowError("INVALID_MERGE", "Choose a different vendor or customer to merge.");
  const version = command.version ?? 0;
  const partners = await all<{ id: string; code: string; name: string; type: string; version: number; active: number }>(
    "SELECT id,code,name,partner_type AS type,version,active FROM business_partners WHERE id IN (?,?)", targetId, sourceId,
  );
  const target = partners.find((partner) => partner.id === targetId);
  const source = partners.find((partner) => partner.id === sourceId);
  if (!target || !source) throw new WorkflowError("NOT_FOUND", "Both business partners must exist.", 404);
  if (!target.active || !source.active) throw new WorkflowError("INVALID_STATE", "Only two active business partners can be merged.", 409);
  if (target.version !== version) throw new WorkflowError("VERSION_CONFLICT", "The surviving partner changed; refresh before merging.", 409, target.version);
  const mergedType = target.type === source.type ? target.type : "both";
  const targetAddresses = await all<{ label: string }>("SELECT label FROM partner_addresses WHERE partner_id=?", targetId);
  const sourceAddresses = await all<{ id: string; label: string }>("SELECT id,label FROM partner_addresses WHERE partner_id=?", sourceId);
  const usedLabels = new Set(targetAddresses.map((row) => row.label));
  const renamedAddresses = sourceAddresses.map((row) => {
    let label = row.label;
    if (usedLabels.has(label)) {
      label = `${row.label} (${source.code})`;
      let suffix = 2;
      while (usedLabels.has(label)) label = `${row.label} (${source.code} ${suffix++})`;
    }
    usedLabels.add(label);
    return { ...row, label };
  });
  const result: WorkflowResult = { recordId: targetId, message: `${source.code} merged into ${target.code}; orders, billing, addresses, and history now use ${target.name}.`, impact: { physical: "No inventory quantity changed.", commercial: "Vendor and customer documents now reference the surviving account.", financial: "Open receivables, payables, credits, and payments remain intact under the surviving account.", onHandDelta: 0 } };
  const db = commandD1(command); const when = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM business_partners target JOIN business_partners source ON source.id=?
      WHERE target.id=? AND target.version=? AND target.active=1 AND source.active=1`)
      .bind(...claimValues(command, result, targetId), sourceId, targetId, version),
  ];
  for (const address of renamedAddresses) if (address.label !== sourceAddresses.find((row) => row.id === address.id)?.label) {
    statements.push(db.prepare(`UPDATE partner_addresses SET label=?,updated_at=?,version=version+1 WHERE id=? AND partner_id=? AND ${marker(command)}`).bind(address.label, when, address.id, sourceId));
  }
  statements.push(
    db.prepare(`UPDATE products SET last_unit_cost_vendor_id=? WHERE last_unit_cost_vendor_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE purchase_orders SET vendor_id=? WHERE vendor_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE sales_orders SET customer_id=? WHERE customer_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE vendor_bills SET vendor_id=? WHERE vendor_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE inventory_lots SET vendor_id=? WHERE vendor_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE vendor_credits SET vendor_id=? WHERE vendor_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE customer_invoices SET customer_id=? WHERE customer_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE customer_credits SET customer_id=? WHERE customer_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE payments SET partner_id=? WHERE partner_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE returnable_obligations SET partner_id=? WHERE partner_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE product_cost_history SET vendor_id=? WHERE vendor_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`DELETE FROM price_list_assignments WHERE partner_id=? AND EXISTS (SELECT 1 FROM price_list_assignments target WHERE target.partner_id=? AND target.price_list_id=price_list_assignments.price_list_id) AND ${marker(command)}`).bind(sourceId, targetId),
    db.prepare(`UPDATE price_list_assignments SET partner_id=? WHERE partner_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE partner_addresses SET is_default=0 WHERE partner_id=? AND is_default=1 AND EXISTS (SELECT 1 FROM partner_addresses target WHERE target.partner_id=? AND target.is_default=1 AND target.active=1) AND ${marker(command)}`).bind(sourceId, targetId),
    db.prepare(`UPDATE partner_addresses SET partner_id=?,updated_at=?,version=version+1 WHERE partner_id=? AND ${marker(command)}`).bind(targetId, when, sourceId),
    db.prepare(`UPDATE qbo_entity_links SET status='inactive',last_error='Local partner merged into another master record' WHERE local_entity_type='business_partner' AND local_entity_id=? AND ${marker(command)}`).bind(sourceId),
    db.prepare(`UPDATE master_record_merges SET target_id=? WHERE entity_type='business_partner' AND target_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`INSERT INTO master_record_merges (id,entity_type,source_id,target_id,source_label,merged_at,merged_by)
      SELECT ?,'business_partner',?,?,?,?,? WHERE ${marker(command)}`).bind(newId("merge"), sourceId, targetId, `${source.code} · ${source.name}`, when, command.actor.label),
    db.prepare(`UPDATE business_partners SET active=0,version=version+1 WHERE id=? AND active=1 AND ${marker(command)}`).bind(sourceId),
    db.prepare(`UPDATE business_partners SET partner_type=?,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(mergedType, targetId, version),
    auditStatement(command, "business_partner", targetId, "business_partners_merged", result.message, { sourcePartnerId: sourceId, sourceCode: source.code, previousTargetType: target.type, mergedType }, when),
    outboxStatement(command, "master.business_partners_merged", "business_partner", targetId, { sourcePartnerId: sourceId, sourceCode: source.code, mergedType }, when),
  );
  await db.batch(statements);
  return finish(command);
}

async function mergePurchaseOrders(command: WorkflowCommand) {
  const targetId = textValue({ entityId: command.entityId }, "entityId");
  const sourceId = textValue(command.payload ?? {}, "sourcePurchaseOrderId");
  if (targetId === sourceId) throw new WorkflowError("INVALID_MERGE", "Choose a different purchase order to merge.");
  const version = command.version ?? 0;
  const orders = await all<{ id: string; number: string; vendorId: string; status: string; currency: string; exchange: number; total: number; baseTotal: number; revision: number; version: number }>(
    `SELECT id,number,vendor_id AS vendorId,lifecycle_status AS status,currency,exchange_rate_to_base AS exchange,total_cents AS total,base_total_cents AS baseTotal,revision_number AS revision,version
      FROM purchase_orders WHERE id IN (?,?)`, targetId, sourceId,
  );
  const target = orders.find((order) => order.id === targetId);
  const source = orders.find((order) => order.id === sourceId);
  if (!target || !source) throw new WorkflowError("NOT_FOUND", "Both purchase orders must exist.", 404);
  if (target.version !== version) throw new WorkflowError("VERSION_CONFLICT", "The surviving purchase order changed; refresh before merging.", 409, target.version);
  if (target.status !== "draft" || source.status !== "draft") throw new WorkflowError("INVALID_STATE", "Only draft purchase orders that have not been submitted can be merged.", 409);
  if (target.vendorId !== source.vendorId) throw new WorkflowError("MERGE_VENDOR_MISMATCH", "Purchase orders must use the same vendor.", 409);
  if (target.currency !== source.currency || Math.abs(target.exchange - source.exchange) > 0.000000001) throw new WorkflowError("MERGE_CURRENCY_MISMATCH", "Purchase orders must use the same currency and exchange rate.", 409);
  const posting = await first<{ id: string }>(`SELECT id FROM (
    SELECT id FROM receipts WHERE purchase_order_id IN (?,?) UNION ALL
    SELECT id FROM vendor_bills WHERE purchase_order_id IN (?,?) AND status<>'void' UNION ALL
    SELECT d.id FROM drop_ship_deliveries d JOIN purchase_order_lines pol ON pol.id=d.purchase_order_line_id WHERE pol.purchase_order_id IN (?,?) UNION ALL
    SELECT id FROM document_email_deliveries WHERE document_type='purchase_order' AND document_id IN (?,?)
  ) LIMIT 1`, targetId, sourceId, targetId, sourceId, targetId, sourceId, targetId, sourceId);
  if (posting) throw new WorkflowError("PURCHASE_ORDER_ALREADY_USED", "A sent, received, delivered, or billed purchase order cannot be merged.", 409);
  const lines = await all<Record<string, unknown>>(`SELECT id,product_id AS productId,ordered_qty AS quantity,unit_cost_cents AS unitAmountCents,
    ordered_uom_id AS uomId,ordered_uom_qty AS enteredQuantity,ordered_uom_unit_cost_cents AS enteredUnitAmountCents,configuration_snapshot AS configurationSnapshot,
    fulfillment_route AS fulfillmentRoute,source_sales_order_line_id AS sourceSalesOrderLineId,discount_cents AS discountCents,taxable,tax_code AS taxCode,tax_rate_bps AS taxRateBps
    FROM purchase_order_lines WHERE purchase_order_id IN (?,?) ORDER BY purchase_order_id,id`, targetId, sourceId);
  const charges = await all<Record<string, unknown>>(`SELECT charge_type AS chargeType,description,amount_cents AS amountCents,direction,taxable,refundable,tax_code AS taxCode,tax_rate_bps AS taxRateBps,tax_amount_cents AS taxAmountCents
    FROM document_charges WHERE document_type='purchase_order' AND document_id IN (?,?) ORDER BY document_id,id`, targetId, sourceId);
  const mergedTotal = target.total + source.total;
  const mergedBaseTotal = target.baseTotal + source.baseTotal;
  const result: WorkflowResult = { recordId: targetId, message: `${source.number} merged into ${target.number}; ${lines.length} draft lines are now on one order.`, impact: { physical: "No inventory changed.", commercial: "Only the surviving draft can be submitted to the vendor.", financial: `Draft total is now ${mergedTotal} ${target.currency} cents; no payable was created.`, onHandDelta: 0 } };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM purchase_orders target JOIN purchase_orders source ON source.id=?
      WHERE target.id=? AND target.version=? AND target.lifecycle_status='draft' AND source.lifecycle_status='draft'
        AND target.vendor_id=source.vendor_id AND target.currency=source.currency AND target.exchange_rate_to_base=source.exchange_rate_to_base
        AND NOT EXISTS (SELECT 1 FROM receipts WHERE purchase_order_id IN (target.id,source.id))
        AND NOT EXISTS (SELECT 1 FROM vendor_bills WHERE purchase_order_id IN (target.id,source.id) AND status<>'void')
        AND NOT EXISTS (SELECT 1 FROM drop_ship_deliveries d JOIN purchase_order_lines pol ON pol.id=d.purchase_order_line_id WHERE pol.purchase_order_id IN (target.id,source.id))
        AND NOT EXISTS (SELECT 1 FROM document_email_deliveries WHERE document_type='purchase_order' AND document_id IN (target.id,source.id))`)
      .bind(...claimValues(command, result, targetId), sourceId, targetId, version),
    db.prepare(`UPDATE purchase_order_lines SET purchase_order_id=? WHERE purchase_order_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE document_charges SET document_id=? WHERE document_type='purchase_order' AND document_id=? AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE attachments SET document_id=? WHERE document_type='purchase_order' AND document_id=? AND deleted_at IS NULL AND ${marker(command)}`).bind(targetId, sourceId),
    db.prepare(`UPDATE purchase_orders SET total_cents=?,base_total_cents=?,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(mergedTotal, mergedBaseTotal, targetId, version),
    db.prepare(`UPDATE purchase_order_revisions SET snapshot_json=?,reason=?,created_by=?,created_at=? WHERE purchase_order_id=? AND revision_number=? AND lifecycle_status='draft' AND ${marker(command)}`)
      .bind(JSON.stringify({ number: target.number, vendorId: target.vendorId, items: lines, charges, totalCents: mergedTotal, currency: target.currency, exchangeRateToBase: target.exchange }), `Merged draft ${source.number}`, command.actor.label, when, targetId, target.revision),
    db.prepare(`UPDATE purchase_order_revisions SET lifecycle_status='canceled',reason=? WHERE purchase_order_id=? AND lifecycle_status='draft' AND ${marker(command)}`).bind(`Merged into ${target.number}`, sourceId),
    db.prepare(`UPDATE purchase_orders SET lifecycle_status='canceled',total_cents=0,base_total_cents=0,version=version+1 WHERE id=? AND lifecycle_status='draft' AND ${marker(command)}`).bind(sourceId),
    db.prepare(`INSERT INTO purchase_order_merges (source_purchase_order_id,target_purchase_order_id,merged_at,merged_by) SELECT ?,?,?,? WHERE ${marker(command)}`).bind(sourceId, targetId, when, command.actor.label),
    db.prepare(`UPDATE qbo_entity_links SET status='inactive',last_error='Draft purchase order merged before submission' WHERE local_entity_type='purchase_order' AND local_entity_id=? AND ${marker(command)}`).bind(sourceId),
    auditStatement(command, "purchase_order", targetId, "draft_purchase_orders_merged", result.message, { sourcePurchaseOrderId: sourceId, sourceNumber: source.number, sourceTotalCents: source.total, lineCount: lines.length }, when),
    outboxStatement(command, "purchase_order.drafts_merged", "purchase_order", targetId, { sourcePurchaseOrderId: sourceId, sourceNumber: source.number, totalCents: mergedTotal }, when),
  ]);
  return finish(command);
}

async function saveMarginRule(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const creating = normalize(command.command).startsWith("create");
  const id = creating ? newId("margin-rule") : textValue({ entityId: command.entityId }, "entityId");
  const code = textValue(payload, "code").toUpperCase();
  const name = textValue(payload, "name");
  const productId = optionalText(payload, "productId");
  const category = optionalText(payload, "category");
  if (productId && category) throw new WorkflowError("VALIDATION_ERROR", "A margin rule can target either one product or one category, not both.");
  if (productId && !await first("SELECT id FROM products WHERE id=? AND active=1", productId)) throw new WorkflowError("INVALID_PRODUCT", "Select an active product for the margin rule.", 409);
  const minimumCostCents = payload.minimumCostCents == null ? 0 : numberValue(payload, "minimumCostCents", { positive: false, integer: true });
  const maximumCostCents = payload.maximumCostCents == null || payload.maximumCostCents === "" ? null : numberValue(payload, "maximumCostCents", { integer: true });
  const targetMarginBps = numberValue(payload, "targetMarginBps", { positive: false, integer: true });
  const minimumGrossProfitCents = payload.minimumGrossProfitCents == null ? 0 : numberValue(payload, "minimumGrossProfitCents", { positive: false, integer: true });
  const roundingIncrementCents = payload.roundingIncrementCents == null ? 100 : numberValue(payload, "roundingIncrementCents", { integer: true });
  const priority = payload.priority == null ? 0 : numberValue(payload, "priority", { positive: false, integer: true });
  if (minimumCostCents < 0 || (maximumCostCents != null && maximumCostCents <= minimumCostCents)) throw new WorkflowError("INVALID_COST_RANGE", "Maximum cost must be greater than minimum cost.");
  if (targetMarginBps < 0 || targetMarginBps >= 10_000) throw new WorkflowError("INVALID_MARGIN", "Target gross margin must be at least 0% and less than 100%.");
  if (minimumGrossProfitCents < 0) throw new WorkflowError("VALIDATION_ERROR", "Minimum gross profit cannot be negative.");
  const validFrom = optionalDateValue(payload, "validFrom");
  const validTo = optionalDateValue(payload, "validTo");
  if (validFrom && validTo && validFrom > validTo) throw new WorkflowError("VALIDATION_ERROR", "Valid-to date must be on or after valid-from.");
  const version = command.version ?? 0;
  const current = creating ? null : await first<{ version: number; active: number }>("SELECT version,active FROM margin_rules WHERE id=?", id);
  if (!creating && !current) throw new WorkflowError("NOT_FOUND", "Margin rule was not found.", 404);
  if (current && current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Margin rule changed; refresh before saving.", 409, current.version);
  if (await first("SELECT id FROM margin_rules WHERE code=? AND id<>?", code, id)) throw new WorkflowError("DUPLICATE_MARGIN_RULE", `Margin rule ${code} already exists.`, 409);
  const high = 9_007_199_254_740_000;
  // The seeded catch-all is an intentional fallback. It may overlap explicit global bands;
  // priority and the narrower lower bound decide which rule wins. User-authored rules within
  // the same scope still cannot overlap one another.
  const overlap = id === "margin-default-32" ? null : await first(`SELECT id FROM margin_rules WHERE active=1 AND id<>? AND id<>'margin-default-32'
    AND COALESCE(product_id,'')=COALESCE(?,'') AND COALESCE(category,'')=COALESCE(?,'')
    AND minimum_cost_cents<? AND ?<COALESCE(maximum_cost_cents,?)
    AND (valid_to IS NULL OR ? IS NULL OR valid_to>=?) AND (? IS NULL OR valid_from IS NULL OR valid_from<=?)
    LIMIT 1`, id, productId, category, maximumCostCents ?? high, minimumCostCents, high, validFrom, validFrom, validTo, validTo);
  if (overlap) throw new WorkflowError("OVERLAPPING_MARGIN_RULE", "This cost band overlaps another active rule in the same product/category scope.", 409);
  const result: WorkflowResult = { message: `${code} ${creating ? "created" : "updated"}; automatic catalog items were recalculated.`, impact: { physical: "No inventory posting.", commercial: "Automatic catalog prices may change; manual and contract prices remain unchanged.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  const claim = creating
    ? db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
        SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM margin_rules WHERE code=?)`).bind(...claimValues(command, result, id), code)
    : db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
        SELECT ?,?,?,?,?,?,? FROM margin_rules WHERE id=? AND version=?`).bind(...claimValues(command, result, id), id, version);
  const write = creating
    ? db.prepare(`INSERT INTO margin_rules
        (id,code,name,product_id,category,minimum_cost_cents,maximum_cost_cents,target_margin_bps,minimum_gross_profit_cents,rounding_increment_cents,priority,valid_from,valid_to,active,version,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,? WHERE ${marker(command)}`)
      .bind(id, code, name, productId, category, minimumCostCents, maximumCostCents, targetMarginBps, minimumGrossProfitCents, roundingIncrementCents, priority, validFrom, validTo, when, when)
    : db.prepare(`UPDATE margin_rules SET code=?,name=?,product_id=?,category=?,minimum_cost_cents=?,maximum_cost_cents=?,target_margin_bps=?,
        minimum_gross_profit_cents=?,rounding_increment_cents=?,priority=?,valid_from=?,valid_to=?,active=1,version=version+1,updated_at=?
        WHERE id=? AND version=? AND ${marker(command)}`)
      .bind(code, name, productId, category, minimumCostCents, maximumCostCents, targetMarginBps, minimumGrossProfitCents, roundingIncrementCents, priority, validFrom, validTo, when, id, version);
  await db.batch([
    claim, write,
    auditStatement(command, "margin_rule", id, creating ? "created" : "updated", result.message, { code, productId, category, minimumCostCents, maximumCostCents, targetMarginBps, minimumGrossProfitCents, roundingIncrementCents, priority, validFrom, validTo }, when),
    outboxStatement(command, creating ? "pricing.margin_rule_created" : "pricing.margin_rule_updated", "margin_rule", id, { code }, when),
  ]);
  await repriceAutomaticProducts(command.actor, `${code} ${creating ? "created" : "updated"}`);
  return finish(command);
}

async function deactivateMarginRule(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const reason = textValue(command.payload ?? {}, "reason");
  const version = command.version ?? 0;
  const current = await first<{ code: string; version: number; active: number }>("SELECT code,version,active FROM margin_rules WHERE id=?", id);
  if (!current) throw new WorkflowError("NOT_FOUND", "Margin rule was not found.", 404);
  if (!current.active) throw new WorkflowError("INACTIVE_MARGIN_RULE", "Margin rule is already inactive.", 409, current.version);
  if (current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Margin rule changed; refresh before deactivating.", 409, current.version);
  const result: WorkflowResult = { message: `${current.code} deactivated; automatic catalog items were recalculated.`, impact: { physical: "No inventory posting.", commercial: "The next eligible margin rule now applies.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM margin_rules WHERE id=? AND version=? AND active=1`).bind(...claimValues(command, result, id), id, version),
    db.prepare(`UPDATE margin_rules SET active=0,version=version+1,updated_at=? WHERE id=? AND version=? AND active=1 AND ${marker(command)}`).bind(when, id, version),
    auditStatement(command, "margin_rule", id, "deactivated", result.message, { reason }, when),
    outboxStatement(command, "pricing.margin_rule_deactivated", "margin_rule", id, { reason }, when),
  ]);
  await repriceAutomaticProducts(command.actor, `${current.code} deactivated: ${reason}`);
  return finish(command);
}

async function updateProductPricing(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const payload = command.payload ?? {};
  const pricingMode = textValue(payload, "pricingMode") as "automatic" | "manual";
  if (!["automatic", "manual"].includes(pricingMode)) throw new WorkflowError("VALIDATION_ERROR", "pricingMode must be automatic or manual.");
  const reason = textValue(payload, "reason");
  const version = command.version ?? 0;
  const product = await first<{ sku: string; category: string; standardCostCents: number; lastUnitCostCents: number | null; sellingPriceCents: number; version: number }>(
    `SELECT sku,category,standard_cost_cents AS standardCostCents,last_unit_cost_cents AS lastUnitCostCents,
      selling_price_cents AS sellingPriceCents,version FROM products WHERE id=? AND active=1`, id);
  if (!product) throw new WorkflowError("NOT_FOUND", "Active product was not found.", 404);
  if (product.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Product changed; refresh before changing pricing.", 409, product.version);
  const costBasisCents = Number(product.lastUnitCostCents ?? product.standardCostCents);
  const { rule, suggestedSellingPriceCents } = await suggestedPriceForProduct({ productId: id, category: product.category, costBasisCents });
  const sellingPriceCents = pricingMode === "automatic"
    ? suggestedSellingPriceCents
    : numberValue(payload, "sellingPriceCents", { positive: false, integer: true });
  if (sellingPriceCents < 0) throw new WorkflowError("VALIDATION_ERROR", "Selling price cannot be negative.");
  const result: WorkflowResult = { message: `${product.sku} set to ${pricingMode} pricing at ${(sellingPriceCents / 100).toFixed(2)} CAD.`, impact: { physical: "No inventory posting.", commercial: pricingMode === "automatic" ? "Future catalog-priced sales lines use the margin matrix." : "Future catalog-priced sales lines use the manual price.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM products WHERE id=? AND version=? AND active=1`).bind(...claimValues(command, result, id), id, version),
    db.prepare(`UPDATE products SET pricing_mode=?,selling_price_cents=?,suggested_selling_price_cents=?,applied_margin_rule_id=?,manual_price_reason=?,pricing_updated_at=?,version=version+1
      WHERE id=? AND version=? AND active=1 AND ${marker(command)}`)
      .bind(pricingMode, sellingPriceCents, suggestedSellingPriceCents, rule.id, pricingMode === "manual" ? reason : null, when, id, version),
    db.prepare(`INSERT INTO catalog_price_history
      (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
      SELECT ?,?,'pricing_mode_changed',?,?,?,?,?,?,?,?,?,? WHERE ${marker(command)}`)
      .bind(newId("catalog-price"), id, costBasisCents, product.sellingPriceCents, suggestedSellingPriceCents, sellingPriceCents, pricingMode, rule.id, null, reason, when, command.actor.label),
    auditStatement(command, "product", id, "pricing_mode_changed", result.message, { costBasisCents, suggestedSellingPriceCents, sellingPriceCents, pricingMode, marginRuleId: rule.id, reason }, when),
    outboxStatement(command, "pricing.product_mode_changed", "product", id, { sellingPriceCents, suggestedSellingPriceCents, pricingMode, marginRuleId: rule.id }, when),
  ]);
  return finish(command);
}

async function adoptMarginMatrixForCatalog(command: WorkflowCommand) {
  const products = await all<{
    id: string; sku: string; category: string; standardCostCents: number; lastUnitCostCents: number | null;
    sellingPriceCents: number; lastUnitCostSourcePoId: string | null; version: number;
  }>(`SELECT id,sku,category,standard_cost_cents AS standardCostCents,last_unit_cost_cents AS lastUnitCostCents,
      selling_price_cents AS sellingPriceCents,last_unit_cost_source_po_id AS lastUnitCostSourcePoId,version
    FROM products
    WHERE active=1 AND pricing_mode='manual' AND (manual_price_reason IS NULL OR manual_price_reason IN (
      'Existing catalog price preserved during automatic-pricing rollout',
      'Imported from Max Green inventory count sheet',
      'Initial catalog price'
    ))
    ORDER BY id`);
  const count = products.length;
  const result: WorkflowResult = {
    message: count
      ? `${count} catalog item${count === 1 ? "" : "s"} now use the automatic margin matrix; specific manual overrides were preserved.`
      : "The catalog already uses the automatic margin matrix; specific manual overrides were preserved.",
    impact: {
      physical: "No inventory posting.",
      commercial: count ? "Eligible catalog prices were recalculated from last unit cost (or standard cost until a PO cost exists)." : "No catalog prices changed.",
      onHandDelta: 0,
    },
    recordId: "catalog",
  };
  const db = commandD1(command);
  const when = new Date().toISOString();
  const reason = "Automatic margin matrix adopted as the catalog default";
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      VALUES (?,?,?,?,?,?,?)`).bind(...claimValues(command, result, "catalog")),
  ];
  for (const product of products) {
    const costBasisCents = Number(product.lastUnitCostCents ?? product.standardCostCents);
    const { rule, suggestedSellingPriceCents } = await suggestedPriceForProduct({ productId: product.id, category: product.category, costBasisCents });
    statements.push(
      db.prepare(`UPDATE products SET pricing_mode='automatic',selling_price_cents=?,suggested_selling_price_cents=?,
          applied_margin_rule_id=?,manual_price_reason=NULL,pricing_updated_at=?,version=version+1
        WHERE id=? AND version=? AND active=1 AND pricing_mode='manual'
          AND (manual_price_reason IS NULL OR manual_price_reason IN (
            'Existing catalog price preserved during automatic-pricing rollout',
            'Imported from Max Green inventory count sheet',
            'Initial catalog price'
          )) AND ${marker(command)}`)
        .bind(suggestedSellingPriceCents, suggestedSellingPriceCents, rule.id, when, product.id, product.version),
      db.prepare(`INSERT INTO catalog_price_history
        (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
        SELECT ?,?,'catalog_matrix_adopted',?,?,?,?,?,?,?,?,?,?
        WHERE EXISTS (SELECT 1 FROM products WHERE id=? AND version=? AND pricing_mode='automatic' AND pricing_updated_at=?)
          AND ${marker(command)}`)
        .bind(newId("catalog-price"), product.id, costBasisCents, product.sellingPriceCents, suggestedSellingPriceCents, suggestedSellingPriceCents, "automatic", rule.id, product.lastUnitCostSourcePoId, reason, when, command.actor.label, product.id, product.version + 1, when),
    );
  }
  statements.push(
    auditStatement(command, "catalog_pricing", "catalog", "margin_matrix_adopted", result.message, { productCount: count }, when),
    outboxStatement(command, "pricing.catalog_matrix_adopted", "catalog_pricing", "catalog", { productCount: count }, when),
  );
  await db.batch(statements);
  return finish(command);
}

async function savePriceList(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const creating = normalize(command.command).startsWith("create");
  const id = creating ? newId("price-list") : textValue({ entityId: command.entityId }, "entityId");
  const code = textValue(payload, "code").toUpperCase();
  const name = textValue(payload, "name");
  const currency = textValue(payload, "currency", "CAD").toUpperCase();
  const priority = payload.priority == null ? 0 : numberValue(payload, "priority", { positive: false, integer: true });
  if (!/^[A-Z]{3}$/.test(currency)) throw new WorkflowError("VALIDATION_ERROR", "currency must be a three-letter ISO code.");
  const validFrom = optionalDateValue(payload, "validFrom");
  const validTo = optionalDateValue(payload, "validTo");
  if (validFrom && validTo && validFrom > validTo) throw new WorkflowError("VALIDATION_ERROR", "Price-list valid-to date must be on or after valid-from.");
  const version = command.version ?? 0;
  const current = creating ? null : await first<{ version: number; currency: string }>("SELECT version,currency FROM price_lists WHERE id=?", id);
  if (!creating && !current) throw new WorkflowError("NOT_FOUND", "Price list not found.", 404);
  if (current && current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Price list changed.", 409, current.version);
  if (await first("SELECT id FROM price_lists WHERE code=? AND id<>?", code, id)) throw new WorkflowError("DUPLICATE_PRICE_LIST_CODE", `Price-list code ${code} already exists.`, 409);
  const changesCurrency = Boolean(current && current.currency !== currency);
  if (changesCurrency && await first("SELECT 1 FROM price_list_entries WHERE price_list_id=? LIMIT 1", id)) throw new WorkflowError("PRICE_LIST_CURRENCY_IN_USE", "Create a new price list instead of changing the currency of existing contract prices.", 409);
  const result: WorkflowResult = { message: `${code} ${creating ? "created" : "updated"}.`, impact: { physical: "No inventory posting.", commercial: "Future eligible sales-order pricing may change.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  const claim = creating
    ? db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM price_lists WHERE code=?)").bind(...claimValues(command, result, id), code)
    : db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
        SELECT ?,?,?,?,?,?,? FROM price_lists WHERE id=? AND version=? AND NOT EXISTS (SELECT 1 FROM price_lists WHERE code=? AND id<>?)
          ${changesCurrency ? "AND NOT EXISTS (SELECT 1 FROM price_list_entries WHERE price_list_id=?)" : ""}`)
      .bind(...claimValues(command, result, id), id, version, code, id, ...(changesCurrency ? [id] : []));
  const write = creating
    ? db.prepare(`INSERT INTO price_lists (id,code,name,currency,priority,valid_from,valid_to,active,version,created_at,updated_at) SELECT ?,?,?,?,?,?,?,1,1,?,? WHERE ${marker(command)}`).bind(id, code, name, currency, priority, validFrom, validTo, when, when)
    : db.prepare(`UPDATE price_lists SET code=?,name=?,currency=?,priority=?,valid_from=?,valid_to=?,version=version+1,updated_at=? WHERE id=? AND version=? AND ${marker(command)}`).bind(code, name, currency, priority, validFrom, validTo, when, id, version);
  await db.batch([claim, write, auditStatement(command, "price_list", id, creating ? "created" : "updated", result.message, { code, currency, priority, validFrom, validTo }, when), outboxStatement(command, creating ? "pricing.list_created" : "pricing.list_updated", "price_list", id, { code }, when)]);
  return finish(command);
}

async function assignPriceList(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const priceListId = textValue(payload, "priceListId");
  const partnerId = textValue(payload, "partnerId");
  const priority = payload.priority == null ? 0 : numberValue(payload, "priority", { positive: false, integer: true });
  const validFrom = optionalDateValue(payload, "validFrom"); const validTo = optionalDateValue(payload, "validTo");
  if (validFrom && validTo && validFrom > validTo) throw new WorkflowError("VALIDATION_ERROR", "Assignment valid-to date must be on or after valid-from.");
  const eligible = await first("SELECT pl.id FROM price_lists pl JOIN business_partners bp ON bp.id=? WHERE pl.id=? AND pl.active=1 AND bp.active=1 AND bp.partner_type IN ('customer','both')", partnerId, priceListId);
  if (!eligible) throw new WorkflowError("INVALID_PRICE_LIST_ASSIGNMENT", "Select an active price list and active customer.", 409);
  const existing = await first<{ id: string; active: number; version: number }>("SELECT id,active,version FROM price_list_assignments WHERE price_list_id=? AND partner_id=?", priceListId, partnerId);
  if (existing?.active) throw new WorkflowError("DUPLICATE_PRICE_LIST_ASSIGNMENT", "This customer already has an active assignment to the price list.", 409);
  const id = existing?.id ?? newId("price-assignment"); const when = new Date().toISOString();
  const reactivating = Boolean(existing);
  const result: WorkflowResult = { message: `Customer price-list assignment ${reactivating ? "reactivated" : "created"}.`, impact: { physical: "No inventory posting.", commercial: "Eligible sales-order lines now resolve this contract price list.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command);
  const claim = existing
    ? db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM price_list_assignments WHERE id=? AND version=? AND active=0").bind(...claimValues(command, result, id), id, existing.version)
    : db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM price_lists WHERE id=? AND active=1) AND EXISTS (SELECT 1 FROM business_partners WHERE id=? AND active=1 AND partner_type IN ('customer','both')) AND NOT EXISTS (SELECT 1 FROM price_list_assignments WHERE price_list_id=? AND partner_id=?)`).bind(...claimValues(command, result, id), priceListId, partnerId, priceListId, partnerId);
  const write = existing
    ? db.prepare(`UPDATE price_list_assignments SET priority=?,valid_from=?,valid_to=?,active=1,version=version+1 WHERE id=? AND version=? AND active=0 AND ${marker(command)}`).bind(priority, validFrom, validTo, id, existing.version)
    : db.prepare(`INSERT INTO price_list_assignments (id,price_list_id,partner_id,priority,valid_from,valid_to,active,version,created_at) SELECT ?,?,?,?,?,?,1,1,? WHERE ${marker(command)}`).bind(id, priceListId, partnerId, priority, validFrom, validTo, when);
  await db.batch([
    claim, write,
    auditStatement(command, "price_list_assignment", id, reactivating ? "reactivated" : "created", result.message, { priceListId, partnerId, priority, validFrom, validTo }, when),
    outboxStatement(command, reactivating ? "pricing.assignment_reactivated" : "pricing.assignment_created", "price_list_assignment", id, { priceListId, partnerId }, when),
  ]);
  return finish(command);
}

async function updatePriceListAssignment(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const id = textValue({ entityId: command.entityId }, "entityId"); const version = command.version ?? 0;
  const priceListId = textValue(payload, "priceListId"); const partnerId = textValue(payload, "partnerId");
  const priority = payload.priority == null ? 0 : numberValue(payload, "priority", { positive: false, integer: true });
  const validFrom = optionalDateValue(payload, "validFrom"); const validTo = optionalDateValue(payload, "validTo");
  if (validFrom && validTo && validFrom > validTo) throw new WorkflowError("VALIDATION_ERROR", "Assignment valid-to date must be on or after valid-from.");
  const current = await first<{ version: number; active: number }>("SELECT version,active FROM price_list_assignments WHERE id=?", id);
  if (!current) throw new WorkflowError("NOT_FOUND", "Price-list assignment not found.", 404);
  if (!current.active) throw new WorkflowError("INACTIVE_ASSIGNMENT", "Reactivate the assignment before editing it.", 409);
  if (current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Price-list assignment changed.", 409, current.version);
  const eligible = await first("SELECT pl.id FROM price_lists pl JOIN business_partners bp ON bp.id=? WHERE pl.id=? AND pl.active=1 AND bp.active=1 AND bp.partner_type IN ('customer','both')", partnerId, priceListId);
  if (!eligible) throw new WorkflowError("INVALID_PRICE_LIST_ASSIGNMENT", "Select an active price list and active customer.", 409);
  if (await first("SELECT id FROM price_list_assignments WHERE price_list_id=? AND partner_id=? AND active=1 AND id<>?", priceListId, partnerId, id)) throw new WorkflowError("DUPLICATE_PRICE_LIST_ASSIGNMENT", "This customer already has an active assignment to the price list.", 409);
  const when = new Date().toISOString(); const db = commandD1(command);
  const result: WorkflowResult = { message: "Customer price-list assignment updated.", impact: { physical: "No inventory posting.", commercial: "Future eligible sales-order pricing uses the revised assignment.", onHandDelta: 0 }, recordId: id };
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM price_list_assignments WHERE id=? AND version=? AND active=1
        AND EXISTS (SELECT 1 FROM price_lists WHERE id=? AND active=1)
        AND EXISTS (SELECT 1 FROM business_partners WHERE id=? AND active=1 AND partner_type IN ('customer','both'))
        AND NOT EXISTS (SELECT 1 FROM price_list_assignments WHERE price_list_id=? AND partner_id=? AND id<>?)`)
      .bind(...claimValues(command, result, id), id, version, priceListId, partnerId, priceListId, partnerId, id),
    db.prepare(`UPDATE price_list_assignments SET price_list_id=?,partner_id=?,priority=?,valid_from=?,valid_to=?,version=version+1 WHERE id=? AND version=? AND active=1 AND ${marker(command)}`).bind(priceListId, partnerId, priority, validFrom, validTo, id, version),
    auditStatement(command, "price_list_assignment", id, "updated", result.message, { priceListId, partnerId, priority, validFrom, validTo }, when),
    outboxStatement(command, "pricing.assignment_updated", "price_list_assignment", id, { priceListId, partnerId }, when),
  ]);
  return finish(command);
}

async function deactivatePriceListAssignment(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId"); const version = command.version ?? 0;
  const reason = textValue(command.payload ?? {}, "reason");
  const current = await first<{ version: number; active: number }>("SELECT version,active FROM price_list_assignments WHERE id=?", id);
  if (!current) throw new WorkflowError("NOT_FOUND", "Price-list assignment not found.", 404);
  if (!current.active) throw new WorkflowError("INACTIVE_ASSIGNMENT", "Price-list assignment is already inactive.", 409);
  if (current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Price-list assignment changed.", 409, current.version);
  const when = new Date().toISOString(); const db = commandD1(command);
  const result: WorkflowResult = { message: "Customer price-list assignment deactivated.", impact: { physical: "No inventory posting.", commercial: "The assignment is excluded from future price resolution.", onHandDelta: 0 }, recordId: id };
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM price_list_assignments WHERE id=? AND version=? AND active=1").bind(...claimValues(command, result, id), id, version),
    db.prepare(`UPDATE price_list_assignments SET active=0,version=version+1 WHERE id=? AND version=? AND active=1 AND ${marker(command)}`).bind(id, version),
    auditStatement(command, "price_list_assignment", id, "deactivated", result.message, { reason }, when),
    outboxStatement(command, "pricing.assignment_deactivated", "price_list_assignment", id, { reason }, when),
  ]);
  return finish(command);
}

async function savePriceListEntry(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const creating = normalize(command.command).startsWith("create");
  const id = creating ? newId("price-entry") : textValue({ entityId: command.entityId }, "entityId");
  const priceListId = textValue(payload, "priceListId"); const productId = textValue(payload, "productId"); const uomId = textValue(payload, "uomId");
  const minimumQuantity = payload.minimumQuantity == null ? 0 : numberValue(payload, "minimumQuantity", { positive: false });
  const unitPriceCents = numberValue(payload, "unitPriceCents", { positive: false, integer: true });
  if (minimumQuantity <= 0 || unitPriceCents < 0) throw new WorkflowError("VALIDATION_ERROR", "Minimum quantity must be greater than zero and unit price cannot be negative.");
  const priceUom = await first("SELECT id FROM units_of_measure WHERE id=? AND active=1", uomId);
  if (!priceUom || !await first("SELECT id FROM price_lists WHERE id=? AND active=1", priceListId)) throw new WorkflowError("INVALID_PRICE_ENTRY", "Select an active price list and UOM.", 409);
  try { await normalizeProductQuantity({ productId, quantity: minimumQuantity, uomId, usage: "sales", field: "minimum quantity" }); } catch (error) { if (error instanceof ProductQuantityError) throw new WorkflowError(error.code, error.message, error.status); throw error; }
  const version = command.version ?? 0;
  const current = creating ? null : await first<{ version: number }>("SELECT version FROM price_list_entries WHERE id=?", id);
  if (!creating && !current) throw new WorkflowError("NOT_FOUND", "Price-list entry not found.", 404);
  if (current && current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Price-list entry changed.", 409, current.version);
  if (await first("SELECT id FROM price_list_entries WHERE price_list_id=? AND product_id=? AND uom_id=? AND minimum_quantity=? AND id<>?", priceListId, productId, uomId, minimumQuantity, id)) throw new WorkflowError("DUPLICATE_PRICE_LIST_ENTRY", "That price list already has this product, UOM, and minimum-quantity break.", 409);
  const validFrom = optionalDateValue(payload, "validFrom"); const validTo = optionalDateValue(payload, "validTo");
  if (validFrom && validTo && validFrom > validTo) throw new WorkflowError("VALIDATION_ERROR", "Contract-price valid-to date must be on or after valid-from.");
  const result: WorkflowResult = { message: "Contract price saved.", impact: { physical: "No inventory posting.", commercial: "Future eligible sales-order lines use this price by quantity break.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  const entryReferenceGuard = `EXISTS (SELECT 1 FROM price_lists WHERE id=? AND active=1)
    AND EXISTS (SELECT 1 FROM products WHERE id=? AND active=1)
    AND EXISTS (SELECT 1 FROM units_of_measure WHERE id=? AND active=1)
    AND NOT EXISTS (SELECT 1 FROM price_list_entries WHERE price_list_id=? AND product_id=? AND uom_id=? AND minimum_quantity=? AND id<>?)`;
  const entryReferenceBindings = [priceListId, productId, uomId, priceListId, productId, uomId, minimumQuantity, id];
  const claim = creating
    ? db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? WHERE ${entryReferenceGuard}`).bind(...claimValues(command, result, id), ...entryReferenceBindings)
    : db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM price_list_entries WHERE id=? AND version=? AND ${entryReferenceGuard}`).bind(...claimValues(command, result, id), id, version, ...entryReferenceBindings);
  const write = creating ? db.prepare(`INSERT INTO price_list_entries (id,price_list_id,product_id,uom_id,minimum_quantity,unit_price_cents,valid_from,valid_to,active,version,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,1,1,?,? WHERE ${marker(command)}`).bind(id, priceListId, productId, uomId, minimumQuantity, unitPriceCents, validFrom, validTo, when, when) : db.prepare(`UPDATE price_list_entries SET price_list_id=?,product_id=?,uom_id=?,minimum_quantity=?,unit_price_cents=?,valid_from=?,valid_to=?,version=version+1,updated_at=? WHERE id=? AND version=? AND ${marker(command)}`).bind(priceListId, productId, uomId, minimumQuantity, unitPriceCents, validFrom, validTo, when, id, version);
  await db.batch([claim, write, auditStatement(command, "price_list_entry", id, creating ? "created" : "updated", result.message, { priceListId, productId, uomId, minimumQuantity, unitPriceCents }, when), outboxStatement(command, creating ? "pricing.entry_created" : "pricing.entry_updated", "price_list_entry", id, { priceListId, productId }, when)]);
  return finish(command);
}

async function deactivatePriceListEntry(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId"); const version = command.version ?? 0;
  const reason = textValue(command.payload ?? {}, "reason");
  const current = await first<{ version: number; active: number }>("SELECT version,active FROM price_list_entries WHERE id=?", id);
  if (!current) throw new WorkflowError("NOT_FOUND", "Price-list entry not found.", 404);
  if (!current.active) throw new WorkflowError("INACTIVE_PRICE_ENTRY", "Contract price is already inactive.", 409);
  if (current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Price-list entry changed.", 409, current.version);
  const when = new Date().toISOString(); const db = commandD1(command);
  const result: WorkflowResult = { message: "Contract price deactivated.", impact: { physical: "No inventory posting.", commercial: "This quantity break is excluded from future price resolution.", onHandDelta: 0 }, recordId: id };
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM price_list_entries WHERE id=? AND version=? AND active=1").bind(...claimValues(command, result, id), id, version),
    db.prepare(`UPDATE price_list_entries SET active=0,version=version+1,updated_at=? WHERE id=? AND version=? AND active=1 AND ${marker(command)}`).bind(when, id, version),
    auditStatement(command, "price_list_entry", id, "deactivated", result.message, { reason }, when),
    outboxStatement(command, "pricing.entry_deactivated", "price_list_entry", id, { reason }, when),
  ]);
  return finish(command);
}

async function deactivatePriceList(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId"); const version = command.version ?? 0; const reason = textValue(command.payload ?? {}, "reason");
  const current = await first<{ version: number; code: string }>("SELECT version,code FROM price_lists WHERE id=?", id);
  if (!current) throw new WorkflowError("NOT_FOUND", "Price list not found.", 404);
  if (current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Price list changed.", 409, current.version);
  const result: WorkflowResult = { message: `${current.code} deactivated; existing order prices remain unchanged.`, impact: { physical: "No inventory posting.", commercial: "The list is excluded from future price resolution.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM price_lists WHERE id=? AND version=? AND active=1").bind(...claimValues(command, result, id), id, version), db.prepare(`UPDATE price_lists SET active=0,version=version+1,updated_at=? WHERE id=? AND version=? AND active=1 AND ${marker(command)}`).bind(when, id, version), auditStatement(command, "price_list", id, "deactivated", result.message, { reason }, when), outboxStatement(command, "pricing.list_deactivated", "price_list", id, { reason }, when)]);
  return finish(command);
}

async function restoreLegacyLocation(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const id = command.entityId ?? textValue(payload, "locationId");
  const warehouseId = textValue(payload, "warehouseId"); const code = textValue(payload, "code").toUpperCase(); const name = textValue(payload, "name");
  const inventoryStatus = textValue(payload, "inventoryStatus", "usable"); const locationType = textValue(payload, "locationType", inventoryStatus === "quarantine" ? "quarantine" : "storage");
  if (!await first("SELECT id FROM warehouses WHERE id=? AND active=1", warehouseId)) throw new WorkflowError("INVALID_WAREHOUSE", "Select an active warehouse for the restored location.", 409);
  if (await first("SELECT id FROM locations WHERE id=?", id)) throw new WorkflowError("LOCATION_ALREADY_EXISTS", "This location ID already exists.", 409);
  const referenced = await first("SELECT 1 AS referenced WHERE EXISTS (SELECT 1 FROM inventory_balances WHERE location_id=?) OR EXISTS (SELECT 1 FROM stock_movements WHERE from_location_id=? OR to_location_id=?)", id, id, id);
  if (!referenced) throw new WorkflowError("UNREFERENCED_LEGACY_LOCATION", "Only a location ID currently referenced by legacy inventory may be restored through reconciliation.", 409);
  if (!["usable", "quarantine", "damaged", "in_transit", "return_pending"].includes(inventoryStatus)) throw new WorkflowError("VALIDATION_ERROR", "Select a supported inventory status.");
  const result: WorkflowResult = { message: `${code} restored with legacy ID ${id}; immutable inventory references now resolve.`, impact: { physical: "No quantity changed.", commercial: "Legacy inventory is visible at a governed location.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM locations WHERE id=?) AND (EXISTS (SELECT 1 FROM inventory_balances WHERE location_id=?) OR EXISTS (SELECT 1 FROM stock_movements WHERE from_location_id=? OR to_location_id=?))`).bind(...claimValues(command, result, id), id, id, id, id),
    db.prepare(`INSERT INTO locations (id,warehouse_id,code,name,location_type,inventory_status,parent_location_id,active,version) SELECT ?,?,?,?,?,?,NULL,1,1 WHERE ${marker(command)}`).bind(id, warehouseId, code, name, locationType, inventoryStatus),
    auditStatement(command, "location", id, "legacy_location_restored", result.message, { warehouseId, code, name, inventoryStatus }, when),
    outboxStatement(command, "inventory.legacy_location_restored", "location", id, { warehouseId, code, inventoryStatus }, when),
  ]);
  return finish(command);
}

async function saveWarehouse(command: WorkflowCommand) {
  const payload = command.payload ?? {}; const creating = normalize(command.command).startsWith("create");
  const id = creating ? newId("warehouse") : textValue({ entityId: command.entityId }, "entityId");
  const code = textValue(payload, "code").toUpperCase(); const name = textValue(payload, "name"); const timezone = textValue(payload, "timezone", "UTC");
  try { new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date()); } catch { throw new WorkflowError("INVALID_TIMEZONE", "timezone must be a valid IANA time-zone name."); }
  const active = activeFor(command); const version = command.version ?? 0;
  const current = creating ? null : await first<{ version: number }>("SELECT version FROM warehouses WHERE id=?", id);
  if (!creating && !current) throw new WorkflowError("NOT_FOUND", "Warehouse not found.", 404);
  if (current && current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Warehouse changed.", 409, current.version);
  if (await first("SELECT id FROM warehouses WHERE code=? AND id<>?", code, id)) throw new WorkflowError("DUPLICATE_WAREHOUSE_CODE", `Warehouse code ${code} already exists.`, 409);
  const result: WorkflowResult = { message: `Warehouse ${code} ${creating ? "created" : "updated"}.`, impact: { physical: "No inventory posting.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  const claim = creating
    ? db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE code=?)").bind(...claimValues(command, result, id), code)
    : db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM warehouses WHERE id=? AND version=? AND NOT EXISTS (SELECT 1 FROM warehouses WHERE code=? AND id<>?)").bind(...claimValues(command, result, id), id, version, code, id);
  const write = creating
    ? db.prepare(`INSERT INTO warehouses (id,code,name,timezone,active,version) SELECT ?,?,?,?,?,1 WHERE ${marker(command)}`).bind(id, code, name, timezone, active ? 1 : 0)
    : db.prepare(`UPDATE warehouses SET code=?,name=?,timezone=?,active=?,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(code, name, timezone, active ? 1 : 0, id, version);
  await db.batch([claim, write, auditStatement(command, "warehouse", id, creating ? "created" : "updated", result.message, { code, active, timezone }, when), outboxStatement(command, "master.warehouse_saved", "warehouse", id, { code, active, timezone }, when)]);
  return finish(command);
}

/** Location types that hold stock the same way: a bin and an outdoor yard are both storage. */
const storageClassLocationTypes = ["storage", "yard"];

async function saveLocation(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const creating = normalize(command.command).startsWith("create");
  const id = creating ? newId("location") : textValue({ entityId: command.entityId }, "entityId");
  const code = textValue(payload, "code").toUpperCase();
  const name = textValue(payload, "name");
  const locationType = textValue(payload, "locationType");
  const status = textValue(payload, "inventoryStatus", "usable");
  const warehouseId = textValue(payload, "warehouseId");
  const parent = optionalText(payload, "parentLocationId");
  if (!storageClassLocationTypes.includes(locationType) && !["receiving", "shipping", "quarantine", "in_transit", "scrap"].includes(locationType)
      || !["usable", "quarantine", "damaged", "in_transit", "return_pending"].includes(status)) {
    throw new WorkflowError("VALIDATION_ERROR", "Invalid locationType or inventoryStatus.");
  }
  if ((locationType === "in_transit") !== (status === "in_transit")) {
    throw new WorkflowError("VALIDATION_ERROR", "An in-transit location must use both the in_transit location type and inventory status.");
  }
  if (!await first("SELECT id FROM warehouses WHERE id=? AND active=1", warehouseId)) throw new WorkflowError("NOT_FOUND", "Active warehouse not found.", 404);
  if (parent === id) throw new WorkflowError("INVALID_LOCATION_PARENT", "A location cannot be its own parent.");
  if (parent) {
    const parentLocation = await first<{ warehouseId: string; active: number }>("SELECT warehouse_id AS warehouseId,active FROM locations WHERE id=?", parent);
    if (!parentLocation?.active || parentLocation.warehouseId !== warehouseId) throw new WorkflowError("INVALID_LOCATION_PARENT", "The parent location must be active and belong to the same warehouse.", 409);
    if (!creating && await first(`WITH RECURSIVE ancestors(id,parentId) AS (
        SELECT id,parent_location_id FROM locations WHERE id=?
        UNION SELECT l.id,l.parent_location_id FROM locations l JOIN ancestors a ON l.id=a.parentId
      ) SELECT 1 AS found FROM ancestors WHERE id=? LIMIT 1`, parent, id)) {
      throw new WorkflowError("LOCATION_PARENT_CYCLE", "This parent would create a cycle in the location hierarchy.", 409);
    }
  }
  const active = activeFor(command);
  const version = command.version ?? 0;
  const current = creating ? null : await first<{ version: number; locationType: string; status: string; warehouseId: string; active: number }>(
    "SELECT version,location_type AS locationType,inventory_status AS status,warehouse_id AS warehouseId,active FROM locations WHERE id=?", id
  );
  if (!creating && !current) throw new WorkflowError("NOT_FOUND", "Location not found.", 404);
  if (current && current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Location changed.", 409, current.version);
  if (await first("SELECT id FROM locations WHERE code=? AND id<>?", code, id)) throw new WorkflowError("DUPLICATE_LOCATION_CODE", `Location code ${code} already exists.`, 409);
  // Reclassifying between storage-class types (a bin becoming a yard) does not move stock; every
  // other type, status, warehouse, or activation change does and therefore needs an empty location.
  const typeChanged = current != null && current.locationType !== locationType
    && !(storageClassLocationTypes.includes(current.locationType) && storageClassLocationTypes.includes(locationType));
  const stockSensitiveChange = current != null && (typeChanged || current.status !== status
    || current.warehouseId !== warehouseId || (current.active === 1 && !active));
  if (stockSensitiveChange) {
    const balance = await first<{ onHand: number; reserved: number }>(
      "SELECT COALESCE(SUM(on_hand_qty),0) AS onHand,COALESCE(SUM(reserved_qty),0) AS reserved FROM inventory_balances WHERE location_id=?", id
    );
    const units = await first<{ count: number }>("SELECT COUNT(*) AS count FROM inventory_units WHERE location_id=? AND lifecycle_status='on_hand'", id);
    if (Number(balance?.onHand ?? 0) !== 0 || Number(balance?.reserved ?? 0) !== 0 || Number(units?.count ?? 0) !== 0) {
      throw new WorkflowError("LOCATION_HAS_STOCK", "Move all on-hand and reserved inventory out of this location before changing its warehouse, type, inventory status, or active state.", 409);
    }
  }
  const result: WorkflowResult = { message: `Location ${code} ${creating ? "created" : "updated"}.`, impact: { physical: "No inventory posting.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command);
  const when = new Date().toISOString();
  const emptyLocationClaim = stockSensitiveChange
    ? "AND NOT EXISTS (SELECT 1 FROM inventory_balances WHERE location_id=? AND (on_hand_qty<>0 OR reserved_qty<>0)) AND NOT EXISTS (SELECT 1 FROM inventory_units WHERE location_id=? AND lifecycle_status='on_hand')"
    : "";
  const referenceGuard = `NOT EXISTS (SELECT 1 FROM locations WHERE code=? AND id<>?)
    AND EXISTS (SELECT 1 FROM warehouses WHERE id=? AND active=1)
    AND (? IS NULL OR EXISTS (SELECT 1 FROM locations WHERE id=? AND warehouse_id=? AND active=1))`;
  const cycleGuard = creating ? "" : `AND (? IS NULL OR NOT EXISTS (
    WITH RECURSIVE ancestors(id,parentId) AS (
      SELECT id,parent_location_id FROM locations WHERE id=?
      UNION SELECT l.id,l.parent_location_id FROM locations l JOIN ancestors a ON l.id=a.parentId
    ) SELECT 1 FROM ancestors WHERE id=?))`;
  const referenceBindings = [code, id, warehouseId, parent, parent, warehouseId, ...(creating ? [] : [parent, parent, id])];
  const claim = creating
    ? db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
        SELECT ?,?,?,?,?,?,? WHERE ${referenceGuard}`).bind(...claimValues(command, result, id), ...referenceBindings)
    : db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
        SELECT ?,?,?,?,?,?,? FROM locations WHERE id=? AND version=? ${emptyLocationClaim} AND ${referenceGuard} ${cycleGuard}`)
      .bind(...claimValues(command, result, id), id, version, ...(stockSensitiveChange ? [id, id] : []), ...referenceBindings);
  const write = creating
    ? db.prepare(`INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,parent_location_id,active,version) SELECT ?,?,?,?,?,?,?,?,1 WHERE ${marker(command)}`)
      .bind(id, code, name, locationType, status, warehouseId, parent, active ? 1 : 0)
    : db.prepare(`UPDATE locations SET code=?,name=?,location_type=?,inventory_status=?,warehouse_id=?,parent_location_id=?,active=?,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`)
      .bind(code, name, locationType, status, warehouseId, parent, active ? 1 : 0, id, version);
  const before = current ? { locationType: current.locationType, status: current.status, warehouseId: current.warehouseId, active: Boolean(current.active) } : null;
  const after = { locationType, status, warehouseId, active };
  await db.batch([
    claim,
    write,
    auditStatement(command, "location", id, creating ? "created" : "updated", result.message, { code, before, after }, when),
    outboxStatement(command, "master.location_saved", "location", id, { code, before, after }, when),
  ]);
  return finish(command);
}

async function deactivateLocation(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const version = command.version ?? 0;
  const reason = textValue(command.payload ?? {}, "reason");
  const current = await first<{ version: number; code: string; active: number }>("SELECT version,code,active FROM locations WHERE id=?", id);
  if (!current) throw new WorkflowError("NOT_FOUND", "Location not found.", 404);
  if (current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Location changed.", 409, current.version);
  if (!current.active) throw new WorkflowError("INVALID_STATE", "Location is already inactive.", 409, current.version);
  const balance = await first<{ onHand: number; reserved: number }>(
    "SELECT COALESCE(SUM(on_hand_qty),0) AS onHand,COALESCE(SUM(reserved_qty),0) AS reserved FROM inventory_balances WHERE location_id=?", id
  );
  const units = await first<{ count: number }>("SELECT COUNT(*) AS count FROM inventory_units WHERE location_id=? AND lifecycle_status='on_hand'", id);
  if (Number(balance?.onHand ?? 0) !== 0 || Number(balance?.reserved ?? 0) !== 0 || Number(units?.count ?? 0) !== 0) {
    throw new WorkflowError("LOCATION_HAS_STOCK", "Move all on-hand and reserved inventory out of this location before deactivating it.", 409);
  }
  const result: WorkflowResult = { message: `Location ${current.code} deactivated; historical records remain available.`, impact: { physical: "No inventory posting.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command);
  const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM locations WHERE id=? AND version=? AND active=1
        AND NOT EXISTS (SELECT 1 FROM inventory_balances WHERE location_id=? AND (on_hand_qty<>0 OR reserved_qty<>0))
        AND NOT EXISTS (SELECT 1 FROM inventory_units WHERE location_id=? AND lifecycle_status='on_hand')`)
      .bind(...claimValues(command, result, id), id, version, id, id),
    db.prepare(`UPDATE locations SET active=0,version=version+1 WHERE id=? AND version=? AND active=1 AND ${marker(command)}`).bind(id, version),
    auditStatement(command, "location", id, "deactivated", result.message, { reason, code: current.code, before: { active: true }, after: { active: false } }, when),
    outboxStatement(command, "master.deactivated", "location", id, { reason, code: current.code }, when),
  ]);
  return finish(command);
}

async function saveReturnableAssetType(command: WorkflowCommand) {
  const payload = command.payload ?? {}; const creating = normalize(command.command).startsWith("create");
  const id = creating ? newId("asset-type") : textValue({ entityId: command.entityId }, "entityId");
  const code = textValue(payload, "code").toUpperCase(); const name = textValue(payload, "name"); const assetClass = textValue(payload, "assetClass");
  const deposit = numberValue(payload, "unitDepositCents", { positive: false, integer: true }); if (deposit < 0) throw new WorkflowError("VALIDATION_ERROR", "unitDepositCents cannot be negative.");
  const active = activeFor(command); const version = command.version ?? 0;
  const current = creating ? null : await first<{ version: number }>("SELECT version FROM returnable_asset_types WHERE id=?", id);
  if (!creating && !current) throw new WorkflowError("NOT_FOUND", "Returnable asset type not found.", 404);
  if (current && current.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Returnable asset type changed.", 409, current.version);
  if (await first("SELECT id FROM returnable_asset_types WHERE code=? AND id<>?", code, id)) throw new WorkflowError("DUPLICATE_ASSET_TYPE_CODE", `Returnable asset code ${code} already exists.`, 409);
  const result: WorkflowResult = { message: `Returnable asset ${code} ${creating ? "created" : "updated"}.`, impact: { physical: "No inventory posting.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  const claim = creating
    ? db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM returnable_asset_types WHERE code=?)").bind(...claimValues(command, result, id), code)
    : db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM returnable_asset_types WHERE id=? AND version=? AND NOT EXISTS (SELECT 1 FROM returnable_asset_types WHERE code=? AND id<>?)").bind(...claimValues(command, result, id), id, version, code, id);
  const write = creating
    ? db.prepare(`INSERT INTO returnable_asset_types (id,code,name,asset_class,unit_deposit_cents,active,version) SELECT ?,?,?,?,?,?,1 WHERE ${marker(command)}`).bind(id, code, name, assetClass, deposit, active ? 1 : 0)
    : db.prepare(`UPDATE returnable_asset_types SET code=?,name=?,asset_class=?,unit_deposit_cents=?,active=?,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(code, name, assetClass, deposit, active ? 1 : 0, id, version);
  await db.batch([claim, write, auditStatement(command, "returnable_asset_type", id, creating ? "created" : "updated", result.message, { code, deposit, active }, when), outboxStatement(command, "master.returnable_asset_type_saved", "returnable_asset_type", id, { code, active }, when)]);
  return finish(command);
}

async function setSalesOrderLifecycle(command: WorkflowCommand, target: "confirmed" | "canceled") {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const version = command.version ?? 0;
  const openDedicatedSupplySql = `EXISTS (SELECT 1 FROM sales_order_lines demand
    JOIN supply_allocations allocation ON allocation.sales_order_line_id=demand.id AND allocation.status='active'
    JOIN purchase_order_lines supply ON supply.id=allocation.purchase_order_line_id
    JOIN purchase_orders source_po ON source_po.id=supply.purchase_order_id
    WHERE demand.sales_order_id=so.id AND source_po.lifecycle_status IN ('draft','pending_approval','approved')
      AND allocation.allocated_qty-allocation.received_qty>0)`;
  const outstandingBaseSql = `COALESCE((SELECT SUM(MAX(ci.base_total_cents-ROUND(ci.paid_cents*ci.exchange_rate_to_base)-
    COALESCE((SELECT SUM(cc.base_amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0),0))
    FROM customer_invoices ci WHERE ci.customer_id=so.customer_id AND ci.status<>'void'),0)`;
  const order = await first<{
    version: number; status: string; customerId: string; totalCents: number; currency: string; exchange: number; partnerCurrency: string;
    shipToAddressLine1: string | null; shipToCity: string | null; shipToRegion: string | null;
    shipToPostalCode: string | null; shipToCountry: string | null;
    creditLimitCents: number; creditHold: number; outstandingBaseCents: number;
  }>(`SELECT so.version,so.lifecycle_status AS status,so.customer_id AS customerId,so.total_cents AS totalCents,so.currency,so.exchange_rate_to_base AS exchange,
      so.ship_to_address_line_1 AS shipToAddressLine1,so.ship_to_city AS shipToCity,so.ship_to_region AS shipToRegion,
      so.ship_to_postal_code AS shipToPostalCode,so.ship_to_country AS shipToCountry,
      bp.currency AS partnerCurrency,bp.credit_limit_cents AS creditLimitCents,bp.credit_hold AS creditHold,
      ${outstandingBaseSql} AS outstandingBaseCents
    FROM sales_orders so JOIN business_partners bp ON bp.id=so.customer_id WHERE so.id=?`, id);
  if (!order) throw new WorkflowError("NOT_FOUND", "Sales order not found.", 404);
  if (order.version !== version) throw new WorkflowError("VERSION_CONFLICT", "Sales order changed.", 409, order.version);
  if (target === "confirmed" && order.status !== "draft") throw new WorkflowError("INVALID_STATE", "Only a draft sales order can be confirmed.", 409);
  if (target === "canceled" && !["draft", "confirmed"].includes(order.status)) throw new WorkflowError("INVALID_STATE", "Only a draft or confirmed sales order can be canceled.", 409);
  if (target === "canceled" && await first(`SELECT 1 FROM sales_orders so WHERE so.id=? AND ${openDedicatedSupplySql}`, id)) {
    throw new WorkflowError("SUPPLY_COMMITMENT_EXISTS", "Cancel or close the linked purchase order before canceling customer demand that still has open dedicated supply.", 409, order.version);
  }
  if (target === "confirmed") {
    if (!order.shipToAddressLine1 || !order.shipToCity || !order.shipToRegion || !order.shipToPostalCode || !order.shipToCountry) {
      throw new WorkflowError("SHIP_TO_REQUIRED", "Add a complete ship-to address before confirming the sales order.", 409, order.version);
    }
    if (Boolean(order.creditHold)) throw new WorkflowError("CREDIT_HOLD", "This customer is on credit hold. Remove the hold before confirming the sales order.", 409, order.version);
    if (order.creditLimitCents > 0 && order.currency !== order.partnerCurrency) {
      throw new WorkflowError("CREDIT_CURRENCY_MISMATCH", `This customer's credit limit is denominated in ${order.partnerCurrency}; use that currency for a credit-controlled sales order.`, 409, order.version);
    }
    const outstandingCreditCents = Math.round(order.outstandingBaseCents / order.exchange);
    if (order.creditLimitCents > 0 && outstandingCreditCents + order.totalCents > order.creditLimitCents) {
      const exceededBy = (outstandingCreditCents + order.totalCents - order.creditLimitCents) / 100;
      throw new WorkflowError("CREDIT_LIMIT_EXCEEDED", `Confirming this order would exceed the customer's credit limit by ${exceededBy.toFixed(2)} ${order.partnerCurrency}.`, 409, order.version);
    }
  }
  const reason = textValue(command.payload ?? {}, "reason");
  const reservations = target === "canceled" ? await all<{ id: string; productId: string; locationId: string; quantity: number }>("SELECT r.id,r.product_id AS productId,r.location_id AS locationId,r.quantity FROM reservations r JOIN sales_order_lines sol ON sol.id=r.sales_order_line_id WHERE sol.sales_order_id=? AND r.status='active'", id) : [];
  const reservationClaims = reservations.map(() => "AND EXISTS (SELECT 1 FROM reservations r JOIN inventory_balances ib ON ib.product_id=r.product_id AND ib.location_id=r.location_id WHERE r.id=? AND r.status='active' AND r.quantity=? AND ib.reserved_qty>=r.quantity)").join(" ");
  const reservationClaimBindings = reservations.flatMap((reservation) => [reservation.id, reservation.quantity]);
  const result: WorkflowResult = { message: target === "confirmed" ? "Sales order confirmed; open stock lines now contribute demand." : "Sales order canceled; remaining demand and reservations were released.", impact: { physical: "No stock movement.", commercial: target, onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM sales_orders so JOIN business_partners bp ON bp.id=so.customer_id
      WHERE so.id=? AND so.version=?
        AND ((?='confirmed' AND so.lifecycle_status='draft') OR (?='canceled' AND so.lifecycle_status IN ('draft','confirmed')))
        AND (?<>'confirmed' OR (
          so.lifecycle_status='draft' AND so.ship_to_address_line_1 IS NOT NULL AND so.ship_to_address_line_1<>''
          AND so.ship_to_city IS NOT NULL AND so.ship_to_city<>'' AND so.ship_to_region IS NOT NULL AND so.ship_to_region<>''
          AND so.ship_to_postal_code IS NOT NULL AND so.ship_to_postal_code<>'' AND so.ship_to_country IS NOT NULL AND so.ship_to_country<>''
          AND bp.credit_hold=0 AND (bp.credit_limit_cents=0 OR (so.currency=bp.currency AND bp.credit_limit_cents>=so.total_cents+
            ROUND(${outstandingBaseSql}/so.exchange_rate_to_base)))))
        AND (?<>'canceled' OR NOT ${openDedicatedSupplySql})
        ${reservationClaims}`)
      .bind(...claimValues(command, result, id), id, version, target, target, target, target, ...reservationClaimBindings),
    db.prepare(`UPDATE sales_orders SET lifecycle_status=?,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(target, id, version),
  ];
  if (target === "canceled") {
    for (const reservation of reservations) statements.push(
      db.prepare(`UPDATE inventory_balances SET reserved_qty=reserved_qty-?,version=version+1 WHERE product_id=? AND location_id=? AND reserved_qty>=? AND ${marker(command)}`).bind(reservation.quantity, reservation.productId, reservation.locationId, reservation.quantity),
      db.prepare(`UPDATE reservations SET status='released' WHERE id=? AND status='active' AND quantity=? AND ${marker(command)}`).bind(reservation.id, reservation.quantity)
    );
    statements.push(db.prepare(`UPDATE sales_order_lines SET canceled_qty=MAX(0,ordered_qty-CASE WHEN fulfillment_route='drop_ship'
      THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.sales_order_line_id=sales_order_lines.id),0)
      ELSE COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sales_order_lines.id),0) END) WHERE sales_order_id=? AND ${marker(command)}`).bind(id));
  }
  statements.push(auditStatement(command, "sales_order", id, `sales_order_${target}`, result.message, { reason }, when), outboxStatement(command, `sales_order.${target}`, "sales_order", id, { reason }, when));
  await db.batch(statements);
  return finish(command);
}

async function postDropShipDelivery(command: WorkflowCommand) {
  const payload = command.payload ?? {};
  const salesLineId = command.entityId ?? textValue(payload, "salesOrderLineId");
  const quantity = roundQuantity(numberValue(payload, "quantity"));
  const deliveryDate = dateValue(payload, "deliveryDate", today());
  await assertPeriodOpen("sales", deliveryDate);
  await assertPeriodOpen("purchasing", deliveryDate);
  const externalReference = textValue(payload, "externalReference");
  const source = await first<{
    productId: string; salesOrderId: string; salesVersion: number; salesStatus: string; salesOrdered: number; salesCanceled: number;
    purchaseLineId: string; purchaseOrderId: string; purchaseVersion: number; purchaseStatus: string; purchaseOrderedAt: string | null; purchaseOrdered: number;
    allocationId: string; allocationVersion: number; allocationQuantity: number; allocationReceived: number; deliveredSales: number; deliveredPurchase: number;
  }>(`SELECT sol.product_id AS productId,sol.sales_order_id AS salesOrderId,so.version AS salesVersion,so.lifecycle_status AS salesStatus,
      sol.ordered_qty AS salesOrdered,sol.canceled_qty AS salesCanceled,pol.id AS purchaseLineId,pol.purchase_order_id AS purchaseOrderId,
      po.version AS purchaseVersion,po.lifecycle_status AS purchaseStatus,po.ordered_at AS purchaseOrderedAt,pol.ordered_qty AS purchaseOrdered,
      sa.id AS allocationId,sa.version AS allocationVersion,sa.allocated_qty AS allocationQuantity,sa.received_qty AS allocationReceived,
      COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.sales_order_line_id=sol.id),0) AS deliveredSales,
      COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0) AS deliveredPurchase
    FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id
    JOIN purchase_order_lines pol ON pol.id=sol.linked_purchase_order_line_id
    JOIN purchase_orders po ON po.id=pol.purchase_order_id
    JOIN supply_allocations sa ON sa.purchase_order_line_id=pol.id AND sa.sales_order_line_id=sol.id AND sa.status='active'
    WHERE sol.id=? AND sol.fulfillment_route='drop_ship' AND pol.fulfillment_route='drop_ship'
      AND pol.source_sales_order_line_id=sol.id AND pol.product_id=sol.product_id`, salesLineId);
  if (!source) throw new WorkflowError("DROP_SHIP_LINK_REQUIRED", "A symmetric drop-ship PO/SO line link is required.", 409);
  if (source.salesStatus !== "confirmed" || source.purchaseStatus !== "approved") throw new WorkflowError("INVALID_STATE", "Drop-ship delivery requires a confirmed sales order and approved purchase order.", 409);
  if (!source.purchaseOrderedAt) throw new WorkflowError("INVALID_STATE", "Mark the approved purchase order as ordered before posting a supplier delivery.", 409);
  if (command.version != null && command.version !== source.salesVersion) throw new WorkflowError("VERSION_CONFLICT", "Sales order changed; refresh before posting delivery.", 409, source.salesVersion);
  const salesRemaining = roundQuantity(source.salesOrdered - source.salesCanceled - source.deliveredSales);
  const purchaseRemaining = roundQuantity(Math.min(source.purchaseOrdered - source.deliveredPurchase, source.allocationQuantity - source.allocationReceived));
  if (quantity > Math.min(salesRemaining, purchaseRemaining)) throw new WorkflowError("OVER_DELIVERY", "Drop-ship delivery exceeds linked open sales or purchase quantity.", 409);
  const id = newId("drop-delivery");
  const number = await nextDocumentNumber("DSD");
  const result: WorkflowResult = { message: `${number} posted for ${quantity} externally delivered units.`, impact: { physical: "No internal stock or valuation movement.", commercial: `${quantity} drop-ship units are now customer-invoice and vendor-bill eligible.`, financial: "No invoice, bill, or payment was created.", onHandDelta: 0, deliveredDelta: quantity }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString(); const postedAt = timestampOnDate(deliveryDate, when);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM sales_orders so JOIN sales_order_lines sol ON sol.sales_order_id=so.id
      JOIN purchase_order_lines pol ON pol.id=sol.linked_purchase_order_line_id JOIN purchase_orders po ON po.id=pol.purchase_order_id
      JOIN supply_allocations sa ON sa.purchase_order_line_id=pol.id AND sa.sales_order_line_id=sol.id
      WHERE sol.id=? AND sol.fulfillment_route='drop_ship' AND pol.fulfillment_route='drop_ship' AND pol.source_sales_order_line_id=sol.id
        AND so.lifecycle_status='confirmed' AND so.version=? AND po.lifecycle_status='approved' AND po.ordered_at IS NOT NULL AND po.version=?
        AND sa.status='active' AND sa.version=? AND sa.allocated_qty-sa.received_qty>=?
        AND sol.ordered_qty-sol.canceled_qty-COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.sales_order_line_id=sol.id),0)>=?
        AND pol.ordered_qty-COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0)>=?`)
      .bind(...claimValues(command, result, id), salesLineId, source.salesVersion, source.purchaseVersion, source.allocationVersion, quantity, quantity, quantity),
    db.prepare(`INSERT INTO drop_ship_deliveries (id,number,purchase_order_id,purchase_order_line_id,sales_order_id,sales_order_line_id,product_id,quantity,reversed_qty,status,delivery_date,external_reference,posted_at,posted_by,version)
      SELECT ?,?,?,?,?,?,?,?,0,'posted',?,?,?,?,1 WHERE ${marker(command)}`).bind(id, number, source.purchaseOrderId, source.purchaseLineId, source.salesOrderId, salesLineId, source.productId, quantity, deliveryDate, externalReference, postedAt, command.actor.label),
    db.prepare(`UPDATE sales_orders SET version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(source.salesOrderId, source.salesVersion),
    db.prepare(`UPDATE purchase_orders SET version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(source.purchaseOrderId, source.purchaseVersion),
    db.prepare(`UPDATE supply_allocations SET received_qty=received_qty+?,updated_at=?,version=version+1 WHERE id=? AND version=? AND allocated_qty-received_qty>=? AND ${marker(command)}`)
      .bind(quantity, when, source.allocationId, source.allocationVersion, quantity),
    auditStatement(command, "drop_ship_delivery", id, "drop_ship_delivery_posted", result.message, { number, quantity, deliveryDate, externalReference, salesOrderId: source.salesOrderId, salesOrderLineId: salesLineId, purchaseOrderId: source.purchaseOrderId, purchaseOrderLineId: source.purchaseLineId }, when),
    outboxStatement(command, "drop_ship.delivery_posted", "drop_ship_delivery", id, { quantity, salesOrderId: source.salesOrderId, purchaseOrderId: source.purchaseOrderId }, when),
  ]);
  return finish(command);
}

async function reverseDropShipDelivery(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const payload = command.payload ?? {};
  const quantity = roundQuantity(numberValue(payload, "quantity"));
  const reason = textValue(payload, "reason");
  const postingDate = dateValue(payload, "postingDate", today());
  await assertPeriodOpen("sales", postingDate);
  await assertPeriodOpen("purchasing", postingDate);
  const delivery = await first<{ version: number; quantity: number; reversed: number; salesOrderId: string; salesLineId: string; salesVersion: number; salesStatus: string; purchaseOrderId: string; purchaseLineId: string; purchaseVersion: number; allocationId: string; allocationVersion: number; allocationQuantity: number; allocationReceived: number; netDelivered: number; netDeliveredPurchase: number; invoiced: number; vendorBilled: number }>(`SELECT d.version,d.quantity,d.reversed_qty AS reversed,d.sales_order_id AS salesOrderId,d.sales_order_line_id AS salesLineId,so.version AS salesVersion,so.lifecycle_status AS salesStatus,
      d.purchase_order_id AS purchaseOrderId,d.purchase_order_line_id AS purchaseLineId,po.version AS purchaseVersion,
      sa.id AS allocationId,sa.version AS allocationVersion,sa.allocated_qty AS allocationQuantity,sa.received_qty AS allocationReceived,
      COALESCE((SELECT SUM(other.quantity-other.reversed_qty) FROM drop_ship_deliveries other WHERE other.sales_order_line_id=d.sales_order_line_id),0) AS netDelivered,
      COALESCE((SELECT SUM(other.quantity-other.reversed_qty) FROM drop_ship_deliveries other WHERE other.purchase_order_line_id=d.purchase_order_line_id),0) AS netDeliveredPurchase,
      COALESCE((SELECT SUM(cil.quantity) FROM customer_invoice_lines cil JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id WHERE cil.sales_order_line_id=d.sales_order_line_id AND ci.status<>'void'),0) AS invoiced,
      COALESCE((SELECT SUM(vbl.quantity) FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id WHERE vbl.purchase_order_line_id=d.purchase_order_line_id AND vb.status<>'void'),0) AS vendorBilled
    FROM drop_ship_deliveries d JOIN sales_orders so ON so.id=d.sales_order_id JOIN purchase_orders po ON po.id=d.purchase_order_id
    JOIN supply_allocations sa ON sa.purchase_order_line_id=d.purchase_order_line_id AND sa.sales_order_line_id=d.sales_order_line_id WHERE d.id=?`, id);
  if (!delivery) throw new WorkflowError("NOT_FOUND", "Drop-ship delivery was not found.", 404);
  if (delivery.version !== (command.version ?? 0)) throw new WorkflowError("VERSION_CONFLICT", "Drop-ship delivery changed; refresh before reversing.", 409, delivery.version);
  if (quantity > delivery.quantity - delivery.reversed) throw new WorkflowError("INVALID_QUANTITY", "Reversal exceeds the delivery's remaining quantity.", 409);
  if (delivery.netDelivered - quantity < delivery.invoiced) throw new WorkflowError("INVOICED_DELIVERY", "Credit or void the related customer invoice quantity before reversing this delivery.", 409);
  if (delivery.netDeliveredPurchase - quantity < delivery.vendorBilled) throw new WorkflowError("BILLED_DELIVERY", "Void or correct the related vendor bill before reversing this supplier delivery.", 409);
  const result: WorkflowResult = { message: `${quantity} drop-ship delivery units reversed.`, impact: { physical: "No internal stock or valuation movement.", commercial: delivery.salesStatus === "canceled" ? `${quantity} externally delivered units were removed from fulfillment history; canceled demand remains closed.` : `${quantity} externally delivered units are no longer billable or invoiceable.`, financial: "Posted invoices and bills remain separate.", onHandDelta: 0, deliveredDelta: -quantity }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM drop_ship_deliveries d WHERE d.id=? AND d.version=? AND d.quantity-d.reversed_qty>=?
        AND COALESCE((SELECT SUM(other.quantity-other.reversed_qty) FROM drop_ship_deliveries other WHERE other.sales_order_line_id=d.sales_order_line_id),0)-?
          >=COALESCE((SELECT SUM(cil.quantity) FROM customer_invoice_lines cil JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id WHERE cil.sales_order_line_id=d.sales_order_line_id AND ci.status<>'void'),0)
        AND COALESCE((SELECT SUM(other.quantity-other.reversed_qty) FROM drop_ship_deliveries other WHERE other.purchase_order_line_id=d.purchase_order_line_id),0)-?
          >=COALESCE((SELECT SUM(vbl.quantity) FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id WHERE vbl.purchase_order_line_id=d.purchase_order_line_id AND vb.status<>'void'),0)
        AND EXISTS (SELECT 1 FROM sales_orders so WHERE so.id=d.sales_order_id AND so.version=? AND so.lifecycle_status IN ('confirmed','canceled'))
        AND EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id=d.purchase_order_id AND po.version=?)
        AND EXISTS (SELECT 1 FROM supply_allocations sa WHERE sa.id=? AND sa.version=? AND sa.received_qty>=? AND (?<>'canceled' OR sa.allocated_qty=sa.received_qty))`)
      .bind(...claimValues(command, result, id), id, delivery.version, quantity, quantity, quantity, delivery.salesVersion, delivery.purchaseVersion, delivery.allocationId, delivery.allocationVersion, quantity, delivery.salesStatus),
    db.prepare(`UPDATE drop_ship_deliveries SET reversed_qty=reversed_qty+?,status=CASE WHEN reversed_qty+?=quantity THEN 'reversed' ELSE 'partially_reversed' END,version=version+1 WHERE id=? AND version=? AND quantity-reversed_qty>=? AND ${marker(command)}`).bind(quantity, quantity, id, delivery.version, quantity),
    db.prepare(`UPDATE sales_orders SET version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(delivery.salesOrderId, delivery.salesVersion),
    db.prepare(`UPDATE sales_order_lines SET canceled_qty=MIN(ordered_qty,canceled_qty+?) WHERE id=? AND EXISTS (SELECT 1 FROM sales_orders so WHERE so.id=sales_order_lines.sales_order_id AND so.lifecycle_status='canceled') AND ${marker(command)}`).bind(quantity, delivery.salesLineId),
    db.prepare(`UPDATE purchase_orders SET version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(delivery.purchaseOrderId, delivery.purchaseVersion),
    db.prepare(delivery.salesStatus === "canceled"
      ? `UPDATE supply_allocations SET received_qty=received_qty-?,allocated_qty=CASE WHEN received_qty-?>0 THEN allocated_qty-? ELSE allocated_qty END,status=CASE WHEN received_qty-?>0 THEN status ELSE 'released' END,updated_at=?,version=version+1 WHERE id=? AND version=? AND received_qty>=? AND allocated_qty=received_qty AND ${marker(command)}`
      : `UPDATE supply_allocations SET received_qty=received_qty-?,updated_at=?,version=version+1 WHERE id=? AND version=? AND received_qty>=? AND ${marker(command)}`)
      .bind(...(delivery.salesStatus === "canceled" ? [quantity, quantity, quantity, quantity, when, delivery.allocationId, delivery.allocationVersion, quantity] : [quantity, when, delivery.allocationId, delivery.allocationVersion, quantity])),
    auditStatement(command, "drop_ship_delivery", id, "drop_ship_delivery_reversed", result.message, { quantity, reason, postingDate, salesOrderLineId: delivery.salesLineId, purchaseOrderLineId: delivery.purchaseLineId }, when),
    outboxStatement(command, "drop_ship.delivery_reversed", "drop_ship_delivery", id, { quantity, reason }, when),
  ]);
  return finish(command);
}

async function addChargeV2(command:WorkflowCommand){
  const payload = command.payload ?? {};
  const documentType = textValue(payload, "documentType");
  const documentId = command.entityId ?? textValue(payload, "documentId");
  const config: Record<string, { table: string; status: string; financial: boolean; postingDateColumn: string | null }> = {
    purchase_order: { table: "purchase_orders", status: "lifecycle_status", financial: false, postingDateColumn: null },
    sales_order: { table: "sales_orders", status: "lifecycle_status", financial: false, postingDateColumn: null },
    vendor_bill: { table: "vendor_bills", status: "status", financial: true, postingDateColumn: "invoice_date" },
    customer_invoice: { table: "customer_invoices", status: "status", financial: true, postingDateColumn: "invoice_date" },
  };
  const kind = config[documentType];
  if (!kind) throw new WorkflowError("VALIDATION_ERROR", "Unsupported documentType for charges.");
  const creditTable = documentType === "vendor_bill" ? "vendor_credits" : "customer_credits";
  const creditColumn = documentType === "vendor_bill" ? "vendor_bill_id" : "customer_invoice_id";
  const document = await first<{ version: number; status: string; exchange: number; total: number; paid: number; credited: number; postingDate: string | null; holdReason: string | null }>(`SELECT version,${kind.status} AS status,exchange_rate_to_base AS exchange,total_cents AS total,${kind.postingDateColumn ?? "NULL"} AS postingDate,
      ${kind.financial ? "paid_cents" : "0"} AS paid,
      ${kind.financial ? `COALESCE((SELECT SUM(amount_cents) FROM ${creditTable} WHERE ${creditColumn}=? AND status='posted'),0)` : "0"} AS credited,
      ${documentType === "vendor_bill" ? "hold_reason" : "NULL"} AS holdReason
    FROM ${kind.table} WHERE id=?`, ...(kind.financial ? [documentId, documentId] : [documentId]));
  if (!document) throw new WorkflowError("NOT_FOUND", "Charge document not found.", 404);
  if (command.version != null && command.version !== document.version) throw new WorkflowError("VERSION_CONFLICT", "Document changed.", 409, document.version);
  if ((documentType === "purchase_order" && !["draft", "rejected"].includes(document.status)) ||
      (documentType === "sales_order" && document.status !== "draft") ||
      (kind.financial && ["void", "paid", "credited"].includes(document.status))) {
    throw new WorkflowError("INVALID_STATE", "Charges cannot be changed in this document state.", 409);
  }
  if (kind.financial) await assertPeriodOpen("accounting", document.postingDate!);
  const charge = normalizeChargePayload(payload);
  if (document.total + charge.totalDelta < document.paid + document.credited) throw new WorkflowError("SETTLED_BALANCE_CONFLICT", "This charge would reduce the document below payments and posted credits.", 409);
  const id = newId("charge");
  const tolerances = documentType === "vendor_bill"
    ? await setting<{ allowedChargeKinds: string[] }>("matching.tolerances", { allowedChargeKinds: [] })
    : null;
  const matchException = documentType === "vendor_bill" && !tolerances?.allowedChargeKinds.includes(charge.chargeType)
    ? { code: "UNEXPECTED_CHARGE", severity: "approval", kind: charge.chargeType, chargeId: id }
    : null;
  let previousExceptions: unknown[] = [];
  if (matchException && document.holdReason) {
    try {
      const parsed = JSON.parse(document.holdReason) as unknown;
      previousExceptions = Array.isArray(parsed) ? parsed : [{ code: "EXISTING_MATCH_EXCEPTION", detail: document.holdReason }];
    } catch {
      previousExceptions = [{ code: "EXISTING_MATCH_EXCEPTION", detail: document.holdReason }];
    }
  }
  const nextHoldReason = matchException ? JSON.stringify([...previousExceptions, matchException]) : null;
  const result: WorkflowResult = {
    message: matchException
      ? `${charge.description} added; the unplanned charge placed the vendor bill on match hold.`
      : `${charge.description} added and document totals recalculated.`,
    impact: { physical: "No stock movement.", financial: `Document total changed by ${charge.totalDelta} cents${matchException ? "; payable placed on approval hold" : ""}.`, matchException, onHandDelta: 0 },
    recordId: id,
  };
  const db = commandD1(command); const when = new Date().toISOString();
  const matchHoldUpdate = matchException ? "status='on_hold',match_status='exception',hold_reason=?," : "";
  const settlementUpdate = kind.financial && !matchException
    ? `status=CASE WHEN total_cents+?=${document.paid + document.credited} THEN CASE WHEN paid_cents>0 THEN 'paid' ELSE 'credited' END ELSE status END,`
    : "";
  const totalUpdate = kind.financial
    ? `${matchHoldUpdate}${settlementUpdate}subtotal_cents=subtotal_cents+?,tax_cents=tax_cents+?,total_cents=total_cents+?,base_total_cents=ROUND((total_cents+?)*exchange_rate_to_base),version=version+1`
    : `total_cents=total_cents+?,base_total_cents=ROUND((total_cents+?)*exchange_rate_to_base),version=version+1`;
  const binds = kind.financial
    ? [...(matchException ? [nextHoldReason] : []), ...(!matchException ? [charge.totalDelta] : []), charge.subtotalDelta, charge.taxDelta, charge.totalDelta, charge.totalDelta]
    : [charge.totalDelta, charge.totalDelta];
  const mutableStateSql = documentType === "purchase_order" ? "lifecycle_status IN ('draft','rejected')"
    : documentType === "sales_order" ? "lifecycle_status='draft'"
    : "status NOT IN ('void','paid','credited')";
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM ${kind.table} WHERE id=? AND version=? AND ${mutableStateSql} AND total_cents+?>=${document.paid + document.credited}`)
      .bind(...claimValues(command, result, id), documentId, document.version, charge.totalDelta),
    db.prepare(`INSERT INTO document_charges (id,document_type,document_id,charge_type,description,amount_cents,direction,taxable,refundable,tax_code,tax_rate_bps,tax_amount_cents,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${marker(command)}`)
      .bind(id, documentType, documentId, charge.chargeType, charge.description, charge.amount, charge.direction, charge.taxable ? 1 : 0, charge.refundable ? 1 : 0, charge.taxCode, charge.taxRate, charge.taxAmount, when),
    db.prepare(`UPDATE ${kind.table} SET ${totalUpdate} WHERE id=? AND version=? AND ${mutableStateSql} AND total_cents+?>=${document.paid + document.credited} AND ${marker(command)}`)
      .bind(...binds, documentId, document.version, charge.totalDelta),
    auditStatement(command, documentType, documentId, "document_charge_added", result.message, { chargeId: id, chargeType: charge.chargeType, amount: charge.amount, direction: charge.direction, taxAmount: charge.taxAmount, refundable: charge.refundable, postingDate: document.postingDate, matchException }, when),
    outboxStatement(command, "document.charge_added", documentType, documentId, { chargeId: id, delta: charge.totalDelta, matchException }, when),
  ];
  if (matchException) statements.push(
    db.prepare(`INSERT INTO approvals (id,entity_type,entity_id,request_type,status,requested_by,requested_reason,requested_at,metadata_json,version)
      SELECT ?,'vendor_bill',?,'vendor_bill_match_exception','pending',?,?,?, ?,1
      WHERE NOT EXISTS (SELECT 1 FROM approvals WHERE entity_type='vendor_bill' AND entity_id=? AND request_type='vendor_bill_match_exception' AND status='pending') AND ${marker(command)}`)
      .bind(newId("approval"), documentId, command.actor.label, "Unplanned vendor-bill charge", when, JSON.stringify({ exceptions: [matchException] }), documentId)
  );
  await db.batch(statements);
  return finish(command);
}

async function recordPaymentV2(command:WorkflowCommand){
  const payload = command.payload ?? {};
  const documentType = textValue(payload, "documentType");
  if (!["vendor_bill", "customer_invoice"].includes(documentType)) throw new WorkflowError("VALIDATION_ERROR", "documentType must be vendor_bill or customer_invoice.");
  const documentId = command.entityId ?? textValue(payload, "documentId");
  const amount = numberValue(payload, "amountCents", { integer: true });
  const paymentDate = dateValue(payload, "paymentDate", today());
  await assertPeriodOpen("accounting", paymentDate);
  const customer = documentType === "customer_invoice";
  const table = customer ? "customer_invoices" : "vendor_bills";
  const creditsTable = customer ? "customer_credits" : "vendor_credits";
  const creditsColumn = customer ? "customer_invoice_id" : "vendor_bill_id";
  const row = await first<{ partnerId: string; total: number; paid: number; version: number; currency: string; exchange: number; status: string; credits: number; invoiceDate: string }>(`SELECT ${customer ? "customer_id" : "vendor_id"} AS partnerId,total_cents AS total,paid_cents AS paid,version,currency,exchange_rate_to_base AS exchange,status,invoice_date AS invoiceDate,
      COALESCE((SELECT SUM(amount_cents) FROM ${creditsTable} WHERE ${creditsColumn}=? AND status='posted'),0) AS credits FROM ${table} WHERE id=?`, documentId, documentId);
  if (!row || row.status === "void") throw new WorkflowError("NOT_FOUND", "Payable or receivable document not found.", 404);
  if (paymentDate < row.invoiceDate) throw new WorkflowError("VALIDATION_ERROR", "paymentDate cannot be before the document invoice date.");
  if (!customer && row.status === "on_hold") throw new WorkflowError("DOCUMENT_ON_HOLD", "Approve the vendor bill match exception before recording payment.", 409);
  if (["paid", "credited"].includes(row.status)) throw new WorkflowError("NOTHING_OUTSTANDING", "The financial document is already settled.", 409);
  if (command.version != null && command.version !== row.version) throw new WorkflowError("VERSION_CONFLICT", "Financial document changed.", 409, row.version);
  const outstanding = row.total - row.paid - row.credits;
  if (outstanding <= 0) throw new WorkflowError("NOTHING_OUTSTANDING", "The financial document has no outstanding balance.", 409);
  if (amount > outstanding) throw new WorkflowError("OVERPAYMENT", "Payment exceeds the outstanding balance after posted credits.", 409);
  const exchange = validateDocumentExchange(payload.exchangeRateToBase, row.exchange);
  const base = Math.round(amount * exchange);
  const method = textValue(payload, "method").toLowerCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(method)) throw new WorkflowError("VALIDATION_ERROR", "method must be a recognizable payment-method code.");
  const reference = textValue(payload, "reference");
  const id = newId("payment"); const number = await nextDocumentNumber("PAY");
  const result: WorkflowResult = { message: `${number} posted for ${amount} ${row.currency} cents.`, impact: { physical: "No stock movement.", financial: `Document balance reduced to ${outstanding - amount} ${row.currency} cents.`, onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM ${table} document WHERE document.id=? AND document.version=?
        AND document.status NOT IN ('void','paid','credited'${customer ? "" : ",'on_hold'"})
        AND document.paid_cents+?+COALESCE((SELECT SUM(amount_cents) FROM ${creditsTable} WHERE ${creditsColumn}=document.id AND status='posted'),0)<=document.total_cents`)
      .bind(...claimValues(command, result, id), documentId, row.version, amount),
    db.prepare(`INSERT INTO payments (id,number,direction,partner_id,document_type,document_id,amount_cents,payment_date,method,reference,posted_at,posted_by,currency,exchange_rate_to_base,base_amount_cents) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${marker(command)}`)
      .bind(id, number, customer ? "inbound" : "outbound", row.partnerId, documentType, documentId, amount, paymentDate, method, reference, when, command.actor.label, row.currency, exchange, base),
    db.prepare(`UPDATE ${table} SET paid_cents=paid_cents+?,status=CASE WHEN paid_cents+?+COALESCE((SELECT SUM(amount_cents) FROM ${creditsTable} WHERE ${creditsColumn}=${table}.id AND status='posted'),0)>=total_cents THEN 'paid' ELSE 'partially_paid' END,version=version+1
      WHERE id=? AND version=? AND paid_cents+?+COALESCE((SELECT SUM(amount_cents) FROM ${creditsTable} WHERE ${creditsColumn}=${table}.id AND status='posted'),0)<=total_cents AND ${marker(command)}`)
      .bind(amount, amount, documentId, row.version, amount),
    auditStatement(command, "payment", id, "payment_posted", result.message, { documentType, documentId, partnerId: row.partnerId, currency: row.currency, amount, base, paymentDate }, when),
    outboxStatement(command, "payment.posted", "payment", id, { documentType, documentId, amount, base }, when),
  ]);
  return finish(command);
}

async function createFinancialCreditV2(command:WorkflowCommand,type:"vendor"|"customer"){
  const payload=command.payload??{},documentId=command.entityId??textValue(payload,"documentId"),amount=numberValue(payload,"amountCents",{integer:true}),reason=textValue(payload,"reason"),postingDate=dateValue(payload,"postingDate",today());await assertPeriodOpen("accounting",postingDate);
  const document=type==="vendor"?await first<{partnerId:string;orderId:string|null;currency:string;exchange:number;total:number;paid:number;version:number;status:string;credited:number;invoiceDate:string}>(`SELECT vb.vendor_id AS partnerId,vb.purchase_order_id AS orderId,vb.currency,vb.exchange_rate_to_base AS exchange,vb.total_cents AS total,vb.paid_cents AS paid,vb.version,vb.status,vb.invoice_date AS invoiceDate,COALESCE((SELECT SUM(vc.amount_cents) FROM vendor_credits vc WHERE vc.vendor_bill_id=vb.id AND vc.status='posted'),0) AS credited FROM vendor_bills vb WHERE vb.id=?`,documentId):await first<{partnerId:string;orderId:string|null;currency:string;exchange:number;total:number;paid:number;version:number;status:string;credited:number;invoiceDate:string}>(`SELECT ci.customer_id AS partnerId,ci.sales_order_id AS orderId,ci.currency,ci.exchange_rate_to_base AS exchange,ci.total_cents AS total,ci.paid_cents AS paid,ci.version,ci.status,ci.invoice_date AS invoiceDate,COALESCE((SELECT SUM(cc.amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0) AS credited FROM customer_invoices ci WHERE ci.id=?`,documentId);
  if(!document||document.status==="void")throw new WorkflowError("NOT_FOUND","Active financial document not found.",404);if(postingDate<document.invoiceDate)throw new WorkflowError("VALIDATION_ERROR","postingDate cannot be before the document invoice date.");if(type==="vendor"&&document.status==="on_hold")throw new WorkflowError("DOCUMENT_ON_HOLD","Approve the vendor bill match exception before posting a credit.",409);if(["paid","credited"].includes(document.status))throw new WorkflowError("NOTHING_OUTSTANDING","The financial document is already settled.",409);if(command.version!=null&&command.version!==document.version)throw new WorkflowError("VERSION_CONFLICT","Financial document changed.",409,document.version);const remaining=Math.max(document.total-document.paid-document.credited,0);if(remaining<=0)throw new WorkflowError("NOTHING_OUTSTANDING","The financial document has no outstanding balance.",409);if(amount>remaining)throw new WorkflowError("CREDIT_EXCEEDS_BALANCE","Credit exceeds the document's remaining uncredited balance.",409);
  validateDocumentCurrency(payload.currency,document.currency);const exchange=validateDocumentExchange(payload.exchangeRateToBase,document.exchange),base=Math.round(amount*exchange),id=newId(`${type}-credit`),number=await nextDocumentNumber(type==="vendor"?"VC":"CM"),result:WorkflowResult={message:`${number} posted for ${amount} ${document.currency} cents.`,impact:{physical:"No stock movement.",financial:`Outstanding document balance reduced to ${remaining-amount} ${document.currency} cents.`,onHandDelta:0},recordId:id},db=commandD1(command),when=new Date().toISOString(),postedAt=timestampOnDate(postingDate,when),table=type==="vendor"?"vendor_credits":"customer_credits",documentTable=type==="vendor"?"vendor_bills":"customer_invoices",partnerCol=type==="vendor"?"vendor_id":"customer_id",documentCol=type==="vendor"?"vendor_bill_id":"customer_invoice_id",orderCol=type==="vendor"?"purchase_order_id":"sales_order_id";
  await db.batch([db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
    SELECT ?,?,?,?,?,?,? FROM ${documentTable} document WHERE document.id=? AND document.version=?
      AND document.status NOT IN ('void','paid','credited'${type==="vendor"?",'on_hold'":""})
      AND document.paid_cents+?+COALESCE((SELECT SUM(amount_cents) FROM ${table} WHERE ${documentCol}=document.id AND status='posted'),0)<=document.total_cents`)
    .bind(...claimValues(command,result,id),documentId,document.version,amount),db.prepare(`INSERT INTO ${table} (id,number,${partnerCol},${documentCol},${orderCol},amount_cents,reason,status,posted_at,posted_by,version,currency,exchange_rate_to_base,base_amount_cents) SELECT ?,?,?,?,?,?,?,'posted',?,?,1,?,?,? WHERE ${marker(command)}`).bind(id,number,document.partnerId,documentId,document.orderId,amount,reason,postedAt,command.actor.label,document.currency,exchange,base),db.prepare(`UPDATE ${documentTable} SET status=CASE WHEN paid_cents+COALESCE((SELECT SUM(amount_cents) FROM ${table} WHERE ${documentCol}=${documentTable}.id AND status='posted'),0)>=total_cents THEN 'credited' WHEN paid_cents>0 THEN 'partially_paid' ELSE status END,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(documentId,document.version),auditStatement(command,`${type}_credit`,id,`${type}_credit_posted`,result.message,{documentId,partnerId:document.partnerId,currency:document.currency,amount,base,reason,postingDate},when),outboxStatement(command,`${type}_credit.posted`,`${type}_credit`,id,{documentId,amount,base,postingDate},when)]);return finish(command);
}

async function voidCustomerInvoice(command: WorkflowCommand) {
  const id = textValue({ entityId: command.entityId }, "entityId");
  const payload = command.payload ?? {};
  const reason = textValue(payload, "reason");
  const invoice = await first<{ version: number; status: string; paid: number; credited: number; salesOrderId: string; salesVersion: number; invoiceDate: string }>(`SELECT ci.version,ci.status,ci.paid_cents AS paid,ci.sales_order_id AS salesOrderId,so.version AS salesVersion,ci.invoice_date AS invoiceDate,
      COALESCE((SELECT SUM(cc.amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0) AS credited
    FROM customer_invoices ci JOIN sales_orders so ON so.id=ci.sales_order_id WHERE ci.id=?`, id);
  if (!invoice) throw new WorkflowError("NOT_FOUND", "Customer invoice was not found.", 404);
  if (invoice.version !== (command.version ?? 0)) throw new WorkflowError("VERSION_CONFLICT", "Customer invoice changed; refresh before voiding.", 409, invoice.version);
  if (invoice.status === "void") throw new WorkflowError("INVALID_STATE", "Customer invoice is already void.", 409);
  if (invoice.paid !== 0 || invoice.credited !== 0) throw new WorkflowError("INVOICE_CORRECTION_REQUIRED", "Only an entirely unpaid and uncredited invoice can be voided; reverse payments or use a credit memo first.", 409);
  await assertPeriodOpen("accounting", invoice.invoiceDate);
  const result: WorkflowResult = { message: "Customer invoice voided; its quantities no longer block shipment or drop-ship delivery reversal.", impact: { physical: "No stock movement.", financial: "The unpaid receivable was voided.", onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM customer_invoices ci WHERE ci.id=? AND ci.version=? AND ci.status<>'void' AND ci.paid_cents=0
        AND NOT EXISTS (SELECT 1 FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted')
        AND EXISTS (SELECT 1 FROM sales_orders so WHERE so.id=ci.sales_order_id AND so.version=?)`)
      .bind(...claimValues(command, result, id), id, invoice.version, invoice.salesVersion),
    db.prepare(`UPDATE customer_invoices SET status='void',version=version+1 WHERE id=? AND version=? AND paid_cents=0 AND ${marker(command)}`).bind(id, invoice.version),
    db.prepare(`UPDATE sales_orders SET billing_status=CASE
      WHEN NOT EXISTS (SELECT 1 FROM customer_invoice_lines cil JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id WHERE ci.sales_order_id=sales_orders.id AND ci.status<>'void') THEN 'not_invoiced'
      ELSE 'partially_invoiced' END,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(invoice.salesOrderId, invoice.salesVersion),
    auditStatement(command, "customer_invoice", id, "customer_invoice_voided", result.message, { reason, salesOrderId: invoice.salesOrderId }, when),
    outboxStatement(command, "customer_invoice.voided", "customer_invoice", id, { reason, salesOrderId: invoice.salesOrderId }, when),
  ]);
  return finish(command);
}

async function createCustomerInvoiceV2(command:WorkflowCommand){
  const payload = command.payload ?? {};
  const salesOrderId = command.entityId ?? textValue(payload, "salesOrderId");
  const invoiceDate = dateValue(payload, "invoiceDate", today());
  const dueDate = dateValue(payload, "dueDate", invoiceDate);
  if (dueDate < invoiceDate) throw new WorkflowError("VALIDATION_ERROR", "dueDate cannot be before invoiceDate.");
  await assertPeriodOpen("accounting", invoiceDate);
  const order = await first<{ customerId: string; currency: string; exchange: number; status: string; version: number }>("SELECT customer_id AS customerId,currency,exchange_rate_to_base AS exchange,lifecycle_status AS status,version FROM sales_orders WHERE id=?", salesOrderId);
  if (!order || !["confirmed", "canceled"].includes(order.status)) throw new WorkflowError("INVALID_STATE", "A confirmed order, or a canceled order with shipped quantity, is required.", 409);
  if (command.version != null && command.version !== order.version) throw new WorkflowError("VERSION_CONFLICT", "Sales order changed; refresh before invoicing.", 409, order.version);
  validateDocumentCurrency(payload.currency, order.currency);
  const requested = Array.isArray(payload.lines) ? payload.lines as Array<Record<string, unknown>> : null;
  if (requested) {
    const requestedIds = requested.map((row) => textValue(row, "salesOrderLineId"));
    if (new Set(requestedIds).size !== requestedIds.length) throw new WorkflowError("DUPLICATE_DOCUMENT_LINE", "Each sales-order line may appear only once on an invoice.");
  }
  const sourceLines = await all<{ id: string; productId: string; binLocationId: string | null; ordered: number; unitPrice: number; taxable: number; taxRate: number; discount: number; shipped: number; invoiced: number; invoicedDiscount: number }>(`SELECT sol.id,sol.product_id AS productId,sol.bin_location_id AS binLocationId,sol.ordered_qty AS ordered,sol.unit_price_cents AS unitPrice,sol.taxable,sol.tax_rate_bps AS taxRate,sol.discount_cents AS discount,
      CASE WHEN sol.fulfillment_route='drop_ship'
        THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.sales_order_line_id=sol.id),0)
        ELSE COALESCE(SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END),0) END AS shipped,
      COALESCE((SELECT SUM(cil.quantity) FROM customer_invoice_lines cil JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id WHERE cil.sales_order_line_id=sol.id AND ci.status<>'void'),0) AS invoiced,
      COALESCE((SELECT SUM(ROUND(cil.quantity*cil.unit_price_cents)-cil.line_total_cents) FROM customer_invoice_lines cil JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id WHERE cil.sales_order_line_id=sol.id AND ci.status<>'void'),0) AS invoicedDiscount
    FROM sales_order_lines sol LEFT JOIN stock_movements sm ON sm.sales_order_line_id=sol.id WHERE sol.sales_order_id=? GROUP BY sol.id`, salesOrderId);
  const lines: Array<{ id: string; productId: string; binLocationId: string | null; quantity: number; unitPrice: number; discount: number; total: number; tax: number; taxRate: number }> = [];
  for (const source of sourceLines) {
    const selected = requested?.find((row) => row.salesOrderLineId === source.id);
    if (requested && !selected) continue;
    const available = roundQuantity(source.shipped - source.invoiced);
    const quantity = selected ? roundQuantity(numberValue(selected, "quantity")) : available;
    if (quantity <= 0) continue;
    if (quantity > available) throw new WorkflowError("INVOICE_EXCEEDS_SHIPPED", `Invoice quantity exceeds shipped-not-invoiced quantity on line ${source.id}.`, 409);
    const cumulativeDiscount = source.ordered > 0 ? Math.round(source.discount * Math.min(source.invoiced + quantity, source.ordered) / source.ordered) : 0;
    const gross = Math.round(quantity * source.unitPrice);
    const discount = Math.max(Math.min(cumulativeDiscount - source.invoicedDiscount, gross), 0);
    const total = gross - discount;
    lines.push({ id: source.id, productId: source.productId, binLocationId: source.binLocationId, quantity, unitPrice: source.unitPrice, discount, total, tax: source.taxable ? Math.round(total * source.taxRate / 10_000) : 0, taxRate: source.taxable ? source.taxRate : 0 });
  }
  if (!lines.length) throw new WorkflowError("NOTHING_TO_INVOICE", "No selected shipped-not-yet-invoiced quantity remains.", 409);
  const previous = await first<{ count: number }>("SELECT COUNT(*) AS count FROM customer_invoices WHERE sales_order_id=? AND status<>'void'", salesOrderId);
  const orderCharges = Number(previous?.count ?? 0) === 0 ? await all<{ chargeType: string; description: string; amount: number; direction: string; taxable: number; refundable: number; taxCode: string | null; taxRate: number; taxAmount: number }>("SELECT charge_type AS chargeType,description,amount_cents AS amount,direction,taxable,refundable,tax_code AS taxCode,tax_rate_bps AS taxRate,tax_amount_cents AS taxAmount FROM document_charges WHERE document_type='sales_order' AND document_id=?", salesOrderId) : [];
  const itemSubtotal = lines.reduce((sum, row) => sum + row.total, 0);
  const chargeSubtotal = orderCharges.reduce((sum, row) => sum + (row.direction === "subtract" ? -row.amount : row.amount), 0);
  const subtotal = itemSubtotal + chargeSubtotal;
  const tax = lines.reduce((sum, row) => sum + row.tax, 0) + orderCharges.reduce((sum, row) => sum + (row.direction === "subtract" ? -Math.abs(row.taxAmount) : Math.abs(row.taxAmount)), 0);
  const total = subtotal + tax;
  if (subtotal < 0 || total < 0) throw new WorkflowError("INVALID_DOCUMENT_TOTAL", "Order charges and discounts cannot make the invoice subtotal or total negative.");
  const exchange = validateDocumentExchange(payload.exchangeRateToBase, order.exchange);
  const base = Math.round(total * exchange);
  const appliedTaxRates = [...new Set(lines.map((line) => line.taxRate).filter((rate) => rate > 0).concat(orderCharges.filter((charge) => charge.taxable).map((charge) => charge.taxRate)))];
  const headerTaxRate = appliedTaxRates.length === 1 ? appliedTaxRates[0] : 0;
  const headerTaxCode = appliedTaxRates.length > 1 ? "MIXED" : appliedTaxRates.length === 1 ? "GST" : null;
  const id = newId("customer-invoice"); const number = await nextDocumentNumber("INV");
  const result: WorkflowResult = { message: `${number} posted for ${lines.reduce((sum, row) => sum + row.quantity, 0)} shipped units.`, impact: { physical: "No stock movement.", financial: `Receivable ${total} ${order.currency} cents posted.`, onHandDelta: 0 }, recordId: id };
  const db = commandD1(command); const when = new Date().toISOString();
  const lineClaims = lines.map(() => `EXISTS (SELECT 1 FROM sales_order_lines sol WHERE sol.id=? AND sol.sales_order_id=?
    AND (CASE WHEN sol.fulfillment_route='drop_ship'
      THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.sales_order_line_id=sol.id),0)
      ELSE COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol.id),0) END)
      -COALESCE((SELECT SUM(cil.quantity) FROM customer_invoice_lines cil JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id WHERE cil.sales_order_line_id=sol.id AND ci.status<>'void'),0)>=?)`).join(" AND ");
  const lineClaimBindings = lines.flatMap((line) => [line.id, salesOrderId, line.quantity]);
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at) SELECT ?,?,?,?,?,?,? FROM sales_orders WHERE id=? AND version=? AND lifecycle_status IN ('confirmed','canceled') AND ${lineClaims}`).bind(...claimValues(command, result, id), salesOrderId, order.version, ...lineClaimBindings),
    db.prepare(`INSERT INTO customer_invoices (id,number,customer_id,sales_order_id,status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,tax_rate_bps,tax_code,payment_terms,posted_at,posted_by,version) SELECT ?,?,?,?,'posted',?,?,?,?,?,0,?,?,?,?,?,?,?, ?,1 WHERE ${marker(command)}`).bind(id, number, order.customerId, salesOrderId, invoiceDate, dueDate, subtotal, tax, total, order.currency, exchange, base, headerTaxRate, headerTaxCode, optionalText(payload, "paymentTerms"), when, command.actor.label),
  ];
  lines.forEach((row) => statements.push(db.prepare(`INSERT INTO customer_invoice_lines (id,customer_invoice_id,sales_order_line_id,product_id,bin_location_id,quantity,unit_price_cents,line_total_cents) SELECT ?,?,?,?,?,?,?,? WHERE ${marker(command)}`).bind(newId("invoice-line"), id, row.id, row.productId, row.binLocationId, row.quantity, row.unitPrice, row.total)));
  orderCharges.forEach((row) => statements.push(db.prepare(`INSERT INTO document_charges (id,document_type,document_id,charge_type,description,amount_cents,direction,taxable,refundable,tax_code,tax_rate_bps,tax_amount_cents,created_at) SELECT ?,'customer_invoice',?,?,?,?,?,?,?,?,?,?,? WHERE ${marker(command)}`).bind(newId("charge"), id, row.chargeType, row.description, row.amount, row.direction, row.taxable, row.refundable, row.taxCode, row.taxRate, Math.abs(row.taxAmount), when)));
  statements.push(
    // "invoiced" means nothing is left to bill: every open ordered unit (or, on a canceled order,
    // every shipped unit) is invoiced. Fully invoicing what has shipped so far while lines remain
    // unshipped is only partial.
    db.prepare(`UPDATE sales_orders SET billing_status=CASE WHEN NOT EXISTS (SELECT 1 FROM sales_order_lines sol WHERE sol.sales_order_id=sales_orders.id AND
      (CASE WHEN sales_orders.lifecycle_status='canceled' THEN
        (CASE WHEN sol.fulfillment_route='drop_ship' THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.sales_order_line_id=sol.id),0)
          ELSE COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol.id),0) END)
        ELSE sol.ordered_qty-sol.canceled_qty END)
      >COALESCE((SELECT SUM(cil.quantity) FROM customer_invoice_lines cil JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id WHERE cil.sales_order_line_id=sol.id AND ci.status<>'void'),0)) THEN 'invoiced' ELSE 'partially_invoiced' END,version=version+1 WHERE id=? AND version=? AND ${marker(command)}`).bind(salesOrderId, order.version),
    auditStatement(command, "customer_invoice", id, "customer_invoice_posted", result.message, { salesOrderId, total, base, charges: orderCharges.length, lines: lines.map(({ id: salesOrderLineId, quantity, discount }) => ({ salesOrderLineId, quantity, discount })) }, when),
    outboxStatement(command, "customer_invoice.posted", "customer_invoice", id, { total, base }, when)
  );
  await db.batch(statements);
  return finish(command);
}

export async function getAdvancedSnapshot(actor?:ActorIdentity,input:SnapshotPage={}){await ensureDatabase();const {page,pageSize,offset}=normalizeSnapshotPage(input);const all=<T>(sql:string)=>unpagedAll<T>(`${sql}\nLIMIT ? OFFSET ?`,pageSize,offset);const workflowScope = ["purchasing", "sales", "inventory", "vendor-billing", "customer-billing", "controls"].includes(String(input.scope ?? "")) ? String(input.scope) : "";const include = (...scopes: string[]) => !workflowScope || scopes.includes(workflowScope);const scopedAll=<T>(scopes:string[],sql:string)=>include(...scopes)?all<T>(sql):Promise.resolve([] as T[]);const [settings,approvals,periodLocks,revisions,warehouses,locations,lots,units,transfers,dropShipDeliveries,reservations,shipments,vendorBills,vendorCredits,customerInvoices,customerCredits,payments,charges,assetTypes,obligations,returnableEvents,valuationPolicies,costLayers,valueEntries,landedCosts,outbox,attachments,users,uoms,uomConversions,,products]=await Promise.all([
  scopedAll<Record<string,unknown>>(["controls"],"SELECT key,value_json AS valueJson,description,version,updated_by AS updatedBy,updated_at AS updatedAt FROM system_settings ORDER BY key"),
  scopedAll<Record<string,unknown>>(["inventory","controls"],"SELECT id,entity_type AS entityType,entity_id AS entityId,request_type AS requestType,status,requested_by AS requestedBy,requested_reason AS requestedReason,requested_at AS requestedAt,decided_by AS decidedBy,decision_reason AS decisionReason,decided_at AS decidedAt,metadata_json AS metadataJson,version FROM approvals ORDER BY requested_at DESC"),
  scopedAll<Record<string,unknown>>(["controls"],"SELECT id,module,locked_through AS lockedThrough,reason,active,version,created_by AS createdBy,created_at AS createdAt FROM period_locks ORDER BY locked_through DESC"),
  scopedAll<Record<string,unknown>>(["purchasing"],"SELECT id,purchase_order_id AS purchaseOrderId,revision_number AS revisionNumber,lifecycle_status AS lifecycleStatus,snapshot_json AS snapshotJson,reason,created_by AS createdBy,created_at AS createdAt FROM purchase_order_revisions ORDER BY created_at DESC"),
  scopedAll<Record<string,unknown>>(["inventory","controls"],"SELECT id,code,name,timezone,active,version FROM warehouses ORDER BY code"),
  scopedAll<Record<string,unknown>>(["inventory","controls"],"SELECT l.id,l.code,l.name,l.location_type AS locationType,l.inventory_status AS inventoryStatus,l.warehouse_id AS warehouseId,w.name AS warehouseName,l.parent_location_id AS parentLocationId,l.active,l.version FROM locations l LEFT JOIN warehouses w ON w.id=l.warehouse_id ORDER BY w.code,l.code"),
  scopedAll<Record<string,unknown>>(["inventory"],`SELECT il.id,il.product_id AS productId,p.sku,p.name AS productName,il.lot_number AS lotNumber,il.vendor_id AS vendorId,il.manufactured_date AS manufacturedDate,il.expiry_date AS expiryDate,il.status,il.created_at AS createdAt,
    lb.locationId,l.code AS locationCode,lb.quantity AS currentQuantity
    FROM inventory_lots il JOIN products p ON p.id=il.product_id
    LEFT JOIN (SELECT lotId,locationId,SUM(delta) AS quantity FROM (
      SELECT ma.lot_id AS lotId,sm.to_location_id AS locationId,ma.quantity AS delta FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id WHERE ma.lot_id IS NOT NULL AND sm.to_location_id IS NOT NULL
      UNION ALL SELECT ma.lot_id,sm.from_location_id,-ma.quantity FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id WHERE ma.lot_id IS NOT NULL AND sm.from_location_id IS NOT NULL
    ) GROUP BY lotId,locationId HAVING ABS(SUM(delta))>0.000001) lb ON lb.lotId=il.id
    LEFT JOIN locations l ON l.id=lb.locationId ORDER BY il.created_at DESC,il.id,l.code`),
  scopedAll<Record<string,unknown>>(["inventory"],`SELECT iu.id,iu.product_id AS productId,p.sku,p.name AS productName,iu.serial_number AS serialNumber,iu.lot_id AS lotId,il.lot_number AS lotNumber,iu.location_id AS locationId,l.code AS locationCode,iu.inventory_status AS inventoryStatus,iu.lifecycle_status AS lifecycleStatus,iu.allocated_sales_order_line_id AS allocatedSalesOrderLineId,iu.version,iu.created_at AS createdAt,
    (SELECT sm.source_document_type||' · '||sm.source_document_id FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id WHERE ma.inventory_unit_id=iu.id ORDER BY sm.posted_at,sm.id LIMIT 1) AS sourceDocument
    FROM inventory_units iu JOIN products p ON p.id=iu.product_id JOIN locations l ON l.id=iu.location_id LEFT JOIN inventory_lots il ON il.id=iu.lot_id ORDER BY iu.created_at DESC`),
  scopedAll<Record<string,unknown>>(["inventory"],"SELECT it.id,it.number,it.transfer_type AS transferType,it.status,it.from_warehouse_id AS fromWarehouseId,it.to_warehouse_id AS toWarehouseId,it.in_transit_location_id AS inTransitLocationId,it.posted_at AS postedAt,it.posted_by AS postedBy,it.version,itl.id AS lineId,itl.product_id AS productId,itl.from_location_id AS fromLocationId,itl.to_location_id AS toLocationId,itl.quantity,itl.received_qty AS receivedQuantity FROM inventory_transfers it JOIN inventory_transfer_lines itl ON itl.transfer_id=it.id ORDER BY it.posted_at DESC"),
  scopedAll<Record<string,unknown>>(["sales"],"SELECT d.id,d.number,d.purchase_order_id AS purchaseOrderId,po.number AS purchaseOrderNumber,d.purchase_order_line_id AS purchaseOrderLineId,d.sales_order_id AS salesOrderId,so.number AS salesOrderNumber,d.sales_order_line_id AS salesOrderLineId,d.product_id AS productId,p.sku,p.name AS productName,d.quantity,d.reversed_qty AS reversedQuantity,d.quantity-d.reversed_qty AS netDeliveredQuantity,d.status,d.delivery_date AS deliveryDate,d.external_reference AS externalReference,d.posted_at AS postedAt,d.posted_by AS postedBy,d.version FROM drop_ship_deliveries d JOIN purchase_orders po ON po.id=d.purchase_order_id JOIN sales_orders so ON so.id=d.sales_order_id JOIN products p ON p.id=d.product_id WHERE d.quantity-d.reversed_qty>0 AND so.lifecycle_status IN ('confirmed','canceled') ORDER BY d.posted_at DESC"),
  scopedAll<Record<string,unknown>>(["sales"],"SELECT r.id,r.sales_order_line_id AS salesOrderLineId,sol.sales_order_id AS salesOrderId,so.number AS salesOrderNumber,r.product_id AS productId,p.sku,p.name AS productName,r.location_id AS locationId,l.code AS locationCode,r.quantity,r.status,r.created_at AS createdAt,so.version AS orderVersion FROM reservations r JOIN sales_order_lines sol ON sol.id=r.sales_order_line_id JOIN sales_orders so ON so.id=sol.sales_order_id JOIN products p ON p.id=r.product_id JOIN locations l ON l.id=r.location_id WHERE r.status='active' AND r.quantity>0 AND so.lifecycle_status='confirmed' ORDER BY r.created_at DESC"),
  scopedAll<Record<string,unknown>>(["sales"],`SELECT s.id,s.number,s.sales_order_id AS salesOrderId,so.number AS salesOrderNumber,bp.name AS customerName,s.status,s.posted_at AS postedAt,s.version,sl.id AS lineId,sl.sales_order_line_id AS salesOrderLineId,sl.product_id AS productId,p.sku,p.name AS productName,sl.location_id AS locationId,l.code AS locationCode,
    MIN(
      MAX(-original.quantity-COALESCE((SELECT SUM(reversal.quantity) FROM stock_movements reversal WHERE reversal.reversal_of_movement_id=original.id AND reversal.movement_type='shipment_reversal'),0),0),
      MAX(COALESCE((SELECT SUM(CASE WHEN line_movement.movement_type='sales_shipment' THEN -line_movement.quantity WHEN line_movement.movement_type='shipment_reversal' THEN -line_movement.quantity ELSE 0 END) FROM stock_movements line_movement WHERE line_movement.sales_order_line_id=sl.sales_order_line_id),0)
        -MAX(COALESCE((SELECT SUM(invoice_line.quantity) FROM customer_invoice_lines invoice_line JOIN customer_invoices invoice ON invoice.id=invoice_line.customer_invoice_id WHERE invoice_line.sales_order_line_id=sl.sales_order_line_id AND invoice.status<>'void'),0),
             COALESCE((SELECT SUM(cr.quantity) FROM customer_returns cr WHERE cr.sales_order_line_id=sl.sales_order_line_id),0)),0)
    ) AS quantity
    FROM shipments s JOIN shipment_lines sl ON sl.shipment_id=s.id JOIN sales_orders so ON so.id=s.sales_order_id JOIN business_partners bp ON bp.id=so.customer_id JOIN products p ON p.id=sl.product_id JOIN locations l ON l.id=sl.location_id
    JOIN stock_movements original ON original.source_document_type='shipment' AND original.source_document_id=s.id AND original.source_line_id=sl.id AND original.movement_type='sales_shipment'
    WHERE so.lifecycle_status IN ('confirmed','canceled')
    GROUP BY s.id,sl.id
    HAVING MIN(
      MAX(-original.quantity-COALESCE((SELECT SUM(reversal.quantity) FROM stock_movements reversal WHERE reversal.reversal_of_movement_id=original.id AND reversal.movement_type='shipment_reversal'),0),0),
      MAX(COALESCE((SELECT SUM(CASE WHEN line_movement.movement_type='sales_shipment' THEN -line_movement.quantity WHEN line_movement.movement_type='shipment_reversal' THEN -line_movement.quantity ELSE 0 END) FROM stock_movements line_movement WHERE line_movement.sales_order_line_id=sl.sales_order_line_id),0)
        -MAX(COALESCE((SELECT SUM(invoice_line.quantity) FROM customer_invoice_lines invoice_line JOIN customer_invoices invoice ON invoice.id=invoice_line.customer_invoice_id WHERE invoice_line.sales_order_line_id=sl.sales_order_line_id AND invoice.status<>'void'),0),
             COALESCE((SELECT SUM(cr.quantity) FROM customer_returns cr WHERE cr.sales_order_line_id=sl.sales_order_line_id),0)),0)
    )>0
    ORDER BY s.posted_at DESC,sl.id`),
  scopedAll<Record<string,unknown>>(["vendor-billing"],"SELECT vb.*,bp.name AS vendorName,po.number AS purchaseOrderNumber,(SELECT COUNT(*) FROM vendor_bill_lines WHERE vendor_bill_id=vb.id) AS lineCount,COALESCE((SELECT SUM(vc.amount_cents) FROM vendor_credits vc WHERE vc.vendor_bill_id=vb.id AND vc.status='posted'),0) AS credited_cents FROM vendor_bills vb JOIN business_partners bp ON bp.id=vb.vendor_id LEFT JOIN purchase_orders po ON po.id=vb.purchase_order_id WHERE vb.status='on_hold' OR MAX(vb.total_cents-vb.paid_cents-COALESCE((SELECT SUM(vc.amount_cents) FROM vendor_credits vc WHERE vc.vendor_bill_id=vb.id AND vc.status='posted'),0),0)>0 ORDER BY COALESCE(vb.posted_at,vb.due_date) DESC"),
  scopedAll<Record<string,unknown>>(["vendor-billing"],"SELECT vc.*,bp.name AS vendorName FROM vendor_credits vc JOIN business_partners bp ON bp.id=vc.vendor_id ORDER BY vc.posted_at DESC"),
  // Posted invoices are the durable document register, not merely an open-receivables queue.
  // Paid counter-sale invoices must remain visible so the operator can open or resend them.
  scopedAll<Record<string,unknown>>(["sales","customer-billing"],`SELECT ci.*,bp.name AS customerName,so.number AS salesOrderNumber,COALESCE(sp.name,so.owner_name) AS salesPersonName,
    (SELECT COUNT(*) FROM customer_invoice_lines WHERE customer_invoice_id=ci.id) AS lineCount,
    COALESCE((SELECT SUM(cc.amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0) AS credited_cents,
    (SELECT qsd.status FROM qbo_sync_deliveries qsd WHERE qsd.local_entity_type='customer_invoice' AND qsd.local_entity_id=ci.id ORDER BY qsd.created_at DESC,qsd.id DESC LIMIT 1) AS qboStatus,
    (SELECT qsd.qbo_entity_id FROM qbo_sync_deliveries qsd WHERE qsd.local_entity_type='customer_invoice' AND qsd.local_entity_id=ci.id ORDER BY qsd.created_at DESC,qsd.id DESC LIMIT 1) AS qboEntityId
    FROM customer_invoices ci JOIN business_partners bp ON bp.id=ci.customer_id LEFT JOIN sales_orders so ON so.id=ci.sales_order_id LEFT JOIN sales_people sp ON sp.id=so.sales_person_id
    WHERE ci.status<>'void' ORDER BY ci.posted_at DESC`),
  scopedAll<Record<string,unknown>>(["sales","customer-billing"],"SELECT cc.*,bp.name AS customerName FROM customer_credits cc JOIN business_partners bp ON bp.id=cc.customer_id ORDER BY cc.posted_at DESC"),
  scopedAll<Record<string,unknown>>(["vendor-billing","sales","customer-billing"],"SELECT * FROM payments ORDER BY posted_at DESC"),scopedAll<Record<string,unknown>>(["vendor-billing","sales","customer-billing"],"SELECT * FROM document_charges ORDER BY created_at DESC"),scopedAll<Record<string,unknown>>(["inventory","controls"],"SELECT id,code,name,asset_class AS assetClass,unit_deposit_cents AS unitDepositCents,active,version FROM returnable_asset_types ORDER BY name"),
  scopedAll<Record<string,unknown>>(["inventory"],"SELECT ro.*,bp.name AS partnerName,rat.code AS assetCode,rat.name AS assetName,ro.issued_qty-ro.returned_qty-ro.forfeited_qty AS outstandingQuantity,MAX(ro.deposit_charged_cents-ro.deposit_refunded_cents-COALESCE((SELECT SUM(re.amount_cents) FROM returnable_events re WHERE re.obligation_id=ro.id AND re.event_type='forfeit'),0),0) AS depositBalanceCents,MAX(MIN(ro.deposit_charged_cents,CASE WHEN ro.issued_qty>0 THEN ROUND(ro.returned_qty*ro.deposit_charged_cents/ro.issued_qty) ELSE 0 END)-ro.deposit_refunded_cents,0) AS refundableDepositCents FROM returnable_obligations ro JOIN business_partners bp ON bp.id=ro.partner_id JOIN returnable_asset_types rat ON rat.id=ro.asset_type_id ORDER BY ro.created_at DESC"),
  scopedAll<Record<string,unknown>>(["inventory"],"SELECT * FROM returnable_events ORDER BY posted_at DESC"),scopedAll<Record<string,unknown>>(["inventory"],"SELECT vp.*,p.sku,p.name AS productName FROM valuation_policies vp JOIN products p ON p.id=vp.product_id ORDER BY p.name"),scopedAll<Record<string,unknown>>(["inventory"],"SELECT cl.*,p.sku,p.name AS productName FROM cost_layers cl JOIN products p ON p.id=cl.product_id WHERE cl.remaining_qty>0 ORDER BY cl.received_at DESC"),scopedAll<Record<string,unknown>>([],"SELECT ive.*,p.sku,p.name AS productName FROM inventory_value_entries ive JOIN products p ON p.id=ive.product_id ORDER BY ive.posted_at DESC"),scopedAll<Record<string,unknown>>(["inventory"],"SELECT lca.*,COALESCE(SUM(lcal.allocated_cents),0) AS allocatedCents FROM landed_cost_allocations lca LEFT JOIN landed_cost_allocation_lines lcal ON lcal.allocation_id=lca.id GROUP BY lca.id ORDER BY lca.posted_at DESC"),scopedAll<Record<string,unknown>>(["controls"],"SELECT id,event_type AS eventType,aggregate_type AS aggregateType,aggregate_id AS aggregateId,status,attempts,available_at AS availableAt,last_error AS lastError,created_at AS createdAt,processed_at AS processedAt FROM outbox_events ORDER BY created_at DESC"),scopedAll<Record<string,unknown>>(["purchasing","controls"],"SELECT id,document_type AS documentType,document_id AS documentId,file_name AS fileName,content_type AS contentType,size_bytes AS sizeBytes,category,owner_id AS ownerId,owner_email AS ownerEmail,uploaded_at AS uploadedAt,version FROM attachments WHERE deleted_at IS NULL ORDER BY uploaded_at DESC"),scopedAll<Record<string,unknown>>(["controls"],"SELECT u.user_id AS userId,u.email,u.full_name AS fullName,tm.role,tm.active,tm.version FROM tenant_memberships tm JOIN app_users u ON u.user_id=tm.user_id ORDER BY u.full_name"),scopedAll<Record<string,unknown>>(["controls"],"SELECT id,code,name,dimension,precision,active FROM units_of_measure ORDER BY code"),scopedAll<Record<string,unknown>>(["controls"],"SELECT id,product_id AS productId,from_uom_id AS fromUomId,to_uom_id AS toUomId,numerator,denominator,rounding_mode AS roundingMode FROM uom_conversions ORDER BY id"),scopedAll<Record<string,unknown>>(["controls"],"SELECT id,code,name,partner_type AS partnerType,email,phone,payment_terms AS paymentTerms,currency,active,version FROM business_partners ORDER BY code"),scopedAll<Record<string,unknown>>(["inventory","controls"],`SELECT p.id,p.sku,p.manufacturer_sku AS manufacturerSku,p.name,p.category,p.material,p.dimensions,p.finish,p.tracking_policy AS trackingPolicy,p.inventory_policy AS inventoryPolicy,
    p.standard_cost_cents AS standardCostCents,p.last_unit_cost_cents AS lastUnitCostCents,p.last_unit_cost_source_po_id AS lastUnitCostSourcePoId,p.last_unit_cost_source_po_line_id AS lastUnitCostSourcePoLineId,
    p.last_unit_cost_vendor_id AS lastUnitCostVendorId,p.last_unit_cost_at AS lastUnitCostAt,source_po.number AS lastUnitCostSourcePoNumber,source_vendor.name AS lastUnitCostVendorName,
    p.selling_price_cents AS sellingPriceCents,p.suggested_selling_price_cents AS suggestedSellingPriceCents,p.pricing_mode AS pricingMode,p.applied_margin_rule_id AS appliedMarginRuleId,
    mr.code AS appliedMarginRuleCode,p.manual_price_reason AS manualPriceReason,p.pricing_updated_at AS pricingUpdatedAt,p.reorder_point AS reorderPoint,p.max_stock_level AS maxStockLevel,
    p.reorder_rule_mode AS reorderRuleMode,p.reorder_rule_percent AS reorderRulePercent,
    p.base_uom_id AS baseUomId,p.purchase_uom_id AS purchaseUomId,p.sales_uom_id AS salesUomId,p.active,p.version
    FROM products p LEFT JOIN purchase_orders source_po ON source_po.id=p.last_unit_cost_source_po_id LEFT JOIN business_partners source_vendor ON source_vendor.id=p.last_unit_cost_vendor_id
    LEFT JOIN margin_rules mr ON mr.id=p.applied_margin_rule_id ORDER BY p.sku`)
]);
  const [priceLists, priceListAssignments, priceListEntries] = await Promise.all([
    scopedAll<Record<string, unknown>>(["controls"],`SELECT id,code,name,currency,priority,valid_from AS validFrom,valid_to AS validTo,active,version,updated_at AS updatedAt FROM price_lists ORDER BY active DESC,priority DESC,code`),
    scopedAll<Record<string, unknown>>(["controls"],`SELECT pla.id,pla.price_list_id AS priceListId,pl.code AS priceListCode,pla.partner_id AS partnerId,bp.name AS partnerName,pla.priority,pla.valid_from AS validFrom,pla.valid_to AS validTo,pla.active,pla.version FROM price_list_assignments pla JOIN price_lists pl ON pl.id=pla.price_list_id JOIN business_partners bp ON bp.id=pla.partner_id ORDER BY pla.active DESC,pl.code,bp.name`),
    scopedAll<Record<string, unknown>>(["controls"],`SELECT ple.id,ple.price_list_id AS priceListId,pl.code AS priceListCode,pl.currency,ple.product_id AS productId,p.sku,p.name AS productName,ple.uom_id AS uomId,u.code AS uomCode,ple.minimum_quantity AS minimumQuantity,ple.unit_price_cents AS unitPriceCents,ple.valid_from AS validFrom,ple.valid_to AS validTo,ple.active,ple.version FROM price_list_entries ple JOIN price_lists pl ON pl.id=ple.price_list_id JOIN products p ON p.id=ple.product_id JOIN units_of_measure u ON u.id=ple.uom_id ORDER BY pl.code,p.sku,ple.minimum_quantity DESC`),
  ]);
  const marginRules = include("controls") ? await unpagedAll<Record<string, unknown>>(`SELECT mr.id,mr.code,mr.name,mr.product_id AS productId,p.sku,
      mr.category,mr.minimum_cost_cents AS minimumCostCents,mr.maximum_cost_cents AS maximumCostCents,mr.target_margin_bps AS targetMarginBps,
      mr.minimum_gross_profit_cents AS minimumGrossProfitCents,mr.rounding_increment_cents AS roundingIncrementCents,mr.priority,
      mr.valid_from AS validFrom,mr.valid_to AS validTo,mr.active,mr.version,mr.updated_at AS updatedAt
    FROM margin_rules mr LEFT JOIN products p ON p.id=mr.product_id
    ORDER BY mr.active DESC,CASE WHEN mr.product_id IS NOT NULL THEN 3 WHEN mr.category IS NOT NULL THEN 2 ELSE 1 END DESC,mr.priority DESC,mr.minimum_cost_cents,mr.code
    LIMIT ? OFFSET ?`, pageSize, offset) : [];
  const partnerMasterData = include("controls") ? await unpagedAll<Record<string,unknown>>(`SELECT id,code,name,partner_type AS partnerType,email,phone,
    address_line_1 AS addressLine1,address_line_2 AS addressLine2,city,region,postal_code AS postalCode,country,
    payment_terms AS paymentTerms,currency,credit_limit_cents AS creditLimitCents,credit_hold AS creditHold,active,version
    FROM business_partners ORDER BY code LIMIT ? OFFSET ?`, pageSize, offset) : [];
  const workflowPurchaseOrders = include("purchasing") ? await unpagedAll<Record<string, unknown>>(`SELECT po.id,po.number,po.lifecycle_status AS lifecycleStatus,po.expected_date AS expectedDate,
      po.total_cents AS totalCents,po.currency,po.version,po.revision_number AS revisionNumber,bp.name AS vendorName,
      -- An approver decides on this row alone, so it has to carry who raised the order, any
      -- optional note they supplied, and what is actually being bought.
      po.buyer_name AS buyerName,po.created_at AS orderDate,po.project_reference AS projectReference,
      po.supplier_quote_number AS supplierQuoteNumber,po.supplier_reference AS supplierReference,
      (SELECT por.reason FROM purchase_order_revisions por WHERE por.purchase_order_id=po.id
        AND por.revision_number=po.revision_number ORDER BY por.rowid DESC LIMIT 1) AS submissionNote,
      (SELECT json_group_array(json_object('id',l.id,'sku',l.sku,'productName',l.productName,
         'orderedQuantity',l.orderedQuantity,'orderedUomQuantity',l.orderedUomQuantity,
         'unitCostCents',l.unitCostCents,'orderedUomUnitCostCents',l.orderedUomUnitCostCents,'discountCents',l.discountCents))
       FROM (SELECT line.id,p.sku,p.name AS productName,line.ordered_qty AS orderedQuantity,
               line.ordered_uom_qty AS orderedUomQuantity,line.unit_cost_cents AS unitCostCents,
               line.ordered_uom_unit_cost_cents AS orderedUomUnitCostCents,line.discount_cents AS discountCents
             FROM purchase_order_lines line JOIN products p ON p.id=line.product_id
             WHERE line.purchase_order_id=po.id ORDER BY line.id LIMIT 50) l) AS linesJson,
      COALESCE(SUM(pol.ordered_qty),0) AS orderedQuantity
    FROM purchase_orders po JOIN business_partners bp ON bp.id=po.vendor_id LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id=po.id
    WHERE po.lifecycle_status IN ('draft','rejected','pending_approval') OR (po.lifecycle_status='approved' AND EXISTS (
      SELECT 1 FROM purchase_order_lines open_line WHERE open_line.purchase_order_id=po.id
        AND open_line.ordered_qty-open_line.closed_qty-COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=open_line.id),0)>0))
    GROUP BY po.id ORDER BY CASE po.lifecycle_status WHEN 'pending_approval' THEN 0 WHEN 'draft' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,po.expected_date,po.number
    LIMIT ? OFFSET ?`, pageSize, offset) : [];
  const workflowSalesOrders = include("sales") ? await unpagedAll<Record<string, unknown>>(`SELECT so.id,so.number,so.lifecycle_status AS lifecycleStatus,so.requested_date AS requestedDate,
      so.total_cents AS totalCents,so.currency,so.version,bp.name AS customerName,so.project_reference AS projectReference,so.sales_person_id AS salesPersonId,COALESCE(sp.name,so.owner_name) AS salesPersonName,
      COALESCE(SUM(sol.ordered_qty-sol.canceled_qty),0) AS orderedQuantity
    FROM sales_orders so JOIN business_partners bp ON bp.id=so.customer_id LEFT JOIN sales_people sp ON sp.id=so.sales_person_id LEFT JOIN sales_order_lines sol ON sol.sales_order_id=so.id
    WHERE so.lifecycle_status='draft' OR (so.lifecycle_status='confirmed' AND EXISTS (
      SELECT 1 FROM sales_order_lines open_line WHERE open_line.sales_order_id=so.id
        AND open_line.ordered_qty-open_line.canceled_qty-COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=open_line.id),0)>0))
    GROUP BY so.id ORDER BY CASE so.lifecycle_status WHEN 'draft' THEN 0 ELSE 1 END,so.requested_date,so.number
    LIMIT ? OFFSET ?`, pageSize, offset) : [];
  const auditEvents = include("controls") ? await unpagedAll<Record<string, unknown>>(`SELECT id,entity_type AS entityType,entity_id AS entityId,action,summary,actor,actor_id AS actorId,actor_email AS actorEmail,created_at AS createdAt
    FROM audit_events ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`, pageSize, offset) : [];
  const summaryTotals=await first<Record<string,unknown>>(`SELECT
    (SELECT COUNT(*) FROM approvals WHERE status='pending') AS pendingApprovals,
    (SELECT COUNT(*) FROM vendor_bills WHERE status='on_hold') AS heldVendorBills,
    (SELECT COALESCE(SUM(MAX(base_total_cents-ROUND(paid_cents*exchange_rate_to_base)-COALESCE((SELECT SUM(cc.base_amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0),0)),0) FROM customer_invoices ci WHERE status<>'void') AS outstandingReceivablesBaseCents,
    (SELECT COUNT(*) FROM returnable_obligations WHERE status='open') AS openReturnables,
    (SELECT COUNT(*) FROM inventory_transfers WHERE status IN ('in_transit','partially_received')) AS inTransitTransfers,
    (SELECT COUNT(*) FROM drop_ship_deliveries WHERE quantity-reversed_qty>0) AS openDropShipDeliveries,
    (SELECT COALESCE(SUM(value_cents),0) FROM inventory_value_entries) AS inventoryValueCents,
    (SELECT COALESCE(SUM(amount_cents),0) FROM landed_cost_allocations) AS landedCostAllocatedCents,
    (SELECT COUNT(*) FROM landed_cost_allocations) AS landedCostAllocationCount,
    (SELECT COALESCE(ABS(SUM(value_cents)),0) FROM inventory_value_entries WHERE entry_type='scrap' AND posted_at>=date('now','start of month')) AS scrapValueCents,
    (SELECT COUNT(*) FROM inventory_value_entries WHERE entry_type='scrap' AND posted_at>=date('now','start of month')) AS scrapEntryCount,
    (SELECT COUNT(*) FROM outbox_events WHERE status IN ('pending','failed')) AS pendingOutbox`);
  const safeParse=(value:unknown)=>{try{return JSON.parse(String(value??"{}"));}catch{return{};}};
  const parse=(rows:Array<Record<string,unknown>>)=>rows.map(row=>({...row,...("valueJson" in row?{value:safeParse(row.valueJson)}:{}),...("metadataJson" in row?{metadata:safeParse(row.metadataJson)}:{})}));
  const isAdmin=!!actor&&hasCapability(actor,"administer");
  const canOperate=!!actor&&hasCapability(actor,"operationalWrite");
  const canFinance=!!actor&&hasCapability(actor,"financialWrite");
  const canApprove=!!actor&&hasCapability(actor,"approve");
  const actions=Object.fromEntries(Object.entries(workflowCapabilities).map(([command,capability])=>[command,!!actor&&hasCapability(actor,capability)]));
  const permissions={canRead:!!actor,canExport:!!actor,canOperate,canPostFinancial:canFinance,canApprove,canAdminister:isAdmin,actions};
  const safeOutbox=isAdmin?outbox:[];
  const summary=Object.fromEntries(Object.entries(summaryTotals??{}).map(([key,value])=>[key,Number(value??0)]));
  if(!isAdmin)summary.pendingOutbox=0;
  return {
    settings: include("controls") ? parse(settings) : [],
    approvals: include("inventory", "controls") ? parse(approvals) : [],
    periodLocks: include("controls") && isAdmin ? periodLocks : [],
    purchaseRevisions: include("purchasing") ? revisions : [],
    purchaseOrders: workflowPurchaseOrders,
    warehouses: include("inventory", "controls") ? warehouses : [],
    locations: include("inventory", "controls") ? locations : [],
    businessPartners: include("controls") ? partnerMasterData : [],
    masterProducts: include("controls") ? products : [],
    products: include("inventory", "controls") ? products : [],
    lots: include("inventory") ? lots : [],
    units: include("inventory") ? units : [],
    transfers: include("inventory") ? transfers : [],
    dropShipDeliveries: include("sales") ? dropShipDeliveries : [],
    reservations: include("sales") ? reservations : [],
    salesOrders: workflowSalesOrders,
    shipments: include("sales") ? shipments : [],
    vendorBills: include("vendor-billing") ? vendorBills : [],
    vendorCredits: include("vendor-billing") ? vendorCredits : [],
    customerInvoices: include("sales", "customer-billing") ? customerInvoices : [],
    customerCredits: include("sales", "customer-billing") ? customerCredits : [],
    payments: include("vendor-billing", "sales", "customer-billing") ? payments : [],
    charges: include("vendor-billing", "sales", "customer-billing") ? charges : [],
    returnableAssetTypes: include("inventory", "controls") ? assetTypes : [],
    returnableObligations: include("inventory") ? obligations : [],
    returnableEvents: include("inventory") ? returnableEvents : [],
    valuationPolicies: include("inventory") ? valuationPolicies : [],
    costLayers: include("inventory") ? costLayers : [],
    valueEntries: workflowScope ? [] : valueEntries,
    landedCosts: include("inventory") ? landedCosts : [],
    outbox: include("controls") ? safeOutbox : [],
    attachments: include("purchasing", "controls") ? attachments : [],
    users: include("controls") && isAdmin ? users : [],
    uoms: include("controls") ? uoms : [],
    uomConversions: include("controls") ? uomConversions : [],
    priceLists: include("controls") && isAdmin ? priceLists : [],
    priceListAssignments: include("controls") && isAdmin ? priceListAssignments : [],
    priceListEntries: include("controls") && isAdmin ? priceListEntries : [],
    marginRules: include("controls") && isAdmin ? marginRules : [],
    auditEvents,
    currentUser: actor ? {id:actor.id,email:actor.email,name:actor.name,role:actor.role} : null,
    permissions,summary,pagination:{page,pageSize}
  };
}

export async function getWorkflowSnapshot(actor?:ActorIdentity,input:SnapshotPage={}){
  // Advanced snapshots already carry their own totals, permissions, reference options, and
  // scoped records. The lightweight core companion only supplies product rows for inventory
  // and orphaned-location reconciliation; recomputing the global operational summary here made
  // every workflow request pay the app-shell's largest analytical query a second time.
  // Purchasing and sales queues need the full order lifecycle, fulfillment, connected financial
  // documents, and QBO delivery state. The narrow advanced queues intentionally omit completed
  // orders, so use the richer order registers as their classification sources.
  const workflowCoreScope: Record<string,string> = { purchasing:"purchase-orders", sales:"sales-orders", inventory:"workflow-products", "vendor-billing":"workflow-empty", "customer-billing":"workflow-empty", controls:"workflow-empty" };
  const coreInput = workflowCoreScope[String(input.scope ?? "")] ? { ...input, scope: workflowCoreScope[String(input.scope)] } : input;
  const [core,advanced]=await Promise.all([getInventorySnapshot(coreInput),getAdvancedSnapshot(actor,input)]);return{snapshot:core,advanced};}

export async function executeWorkflow(command: WorkflowCommand): Promise<WorkflowResult> {
  await ensureDatabase();
  if (!command.command?.trim()) throw new WorkflowError("VALIDATION_ERROR", "command is required.");
  if (!command.idempotencyKey?.trim()) throw new WorkflowError("VALIDATION_ERROR", "idempotencyKey is required.");
  command.claimToken = crypto.randomUUID(); command.requestHash = await hashCommand(command);
  const prior = await replay(command); if (prior) return prior;
  switch (normalize(command.command)) {
    case "createpurchaseorderdraft": return createDraft(command, "purchaseOrder");
    case "createapprovedpurchaseorder": return createDraft(command, "purchaseOrder", true);
    case "updatepurchaseorderdraft": return updatePurchaseOrderDraft(command);
    case "cancelpurchaseorder": return cancelPurchaseOrder(command);
    case "createsalesorderdraft": return createDraft(command, "salesOrder");
    case "createconfirmedsalesorder": return createDraft(command, "salesOrder", true);
    case "updatesalesorderdraft": return updateSalesOrderDraft(command);
    case "confirmsalesorder": return setSalesOrderLifecycle(command, "confirmed");
    case "cancelsalesorder": return setSalesOrderLifecycle(command, "canceled");
    case "submitpurchaseorder": return submitPurchaseOrder(command);
    case "approvepurchaseorder": return decidePurchaseOrder(command, "approved");
    case "rejectpurchaseorder": return decidePurchaseOrder(command, "rejected");
    case "markpurchaseorderordered": return markPurchaseOrderOrdered(command);
    case "amendpurchaseorder": return amendPurchaseOrder(command);
    case "requestoverreceiptapproval": case "requestapproval": return requestApproval(command);
    case "approveapproval": return decideApproval(command, "approved");
    case "rejectapproval": return decideApproval(command, "rejected");
    case "transferinventory": return moveInventory(command, "internal_transfer");
    case "changeinventorystatus": return moveInventory(command, "status_change");
    case "receivetransfer": return receiveTransfer(command);
    case "scrapinventory": return scrapInventory(command);
    case "releasereservation": return releaseReservation(command);
    case "reallocatereservation": return reallocateReservation(command);
    case "reverseshipment": return reverseShipment(command);
    case "registerinventoryidentity": return registerIdentity(command);
    case "postdropshipdelivery": return postDropShipDelivery(command);
    case "reversedropshipdelivery": return reverseDropShipDelivery(command);
    case "createvendorbill": return createVendorBill(command);
    case "createapprovedvendorbill": return createVendorBill(command, true);
    case "approvevendorbill": return approveVendorBill(command);
    case "voidvendorbill": return voidVendorBill(command);
    case "createvendorcredit": return createFinancialCreditV2(command, "vendor");
    case "createcustomerinvoice": return createCustomerInvoiceV2(command);
    case "createcustomercredit": return createFinancialCreditV2(command, "customer");
    case "voidcustomerinvoice": return voidCustomerInvoice(command);
    case "recordpayment": return recordPaymentV2(command);
    case "adddocumentcharge": return addChargeV2(command);
    case "issuereturnable": return issueReturnable(command);
    case "returnreturnable": return updateReturnable(command, "return");
    case "forfeitreturnable": return updateReturnable(command, "forfeit");
    case "refundreturnabledeposit": return updateReturnable(command, "deposit_refund");
    case "updatepolicy": return updatePolicy(command);
    case "lockperiod": return setPeriodLock(command, true);
    case "unlockperiod": return setPeriodLock(command, false);
    case "setvaluationpolicy": return setValuationPolicy(command);
    case "allocatelandedcost": return allocateLandedCost(command);
    case "updateuserrole": return updateUserRole(command);
    case "createpartneraddress": case "updatepartneraddress": return savePartnerAddress(command);
    case "deactivatepartneraddress": return deactivatePartnerAddress(command);
    case "createbusinesspartner": case "updatebusinesspartner": return saveBusinessPartner(command);
    case "deactivatebusinesspartner": return deactivateMaster(command,"business_partners","business_partner");
    case "createsalesperson": case "updatesalesperson": return saveSalesPerson(command);
    case "mergebusinesspartners": return mergeBusinessPartners(command);
    case "createproduct": case "updateproduct": return saveProduct(command);
    case "deactivateproduct": return deactivateMaster(command,"products","product");
    case "addproductalias": return addProductAlias(command);
    case "removeproductalias": return removeProductAlias(command);
    case "setproductdefaultlocation": return setProductDefaultLocation(command);
    case "mergeproducts": return mergeProducts(command);
    case "mergepurchaseorders": return mergePurchaseOrders(command);
    case "createunitofmeasure": return createUnitOfMeasure(command);
    case "createuomconversion": return createUomConversion(command);
    case "configureproductpurchaseunit": return configureProductPurchaseUnit(command);
    case "createpricelist": case "updatepricelist": return savePriceList(command);
    case "deactivatepricelist": return deactivatePriceList(command);
    case "assignpricelist": return assignPriceList(command);
    case "updatepricelistassignment": return updatePriceListAssignment(command);
    case "deactivatepricelistassignment": return deactivatePriceListAssignment(command);
    case "createpricelistentry": case "updatepricelistentry": return savePriceListEntry(command);
    case "deactivatepricelistentry": return deactivatePriceListEntry(command);
    case "createmarginrule": case "updatemarginrule": return saveMarginRule(command);
    case "deactivatemarginrule": return deactivateMarginRule(command);
    case "adoptmarginmatrixforcatalog": return adoptMarginMatrixForCatalog(command);
    case "updateproductpricing": return updateProductPricing(command);
    case "createwarehouse": case "updatewarehouse": return saveWarehouse(command);
    case "deactivatewarehouse": return deactivateMaster(command,"warehouses","warehouse");
    case "createlocation": case "updatelocation": return saveLocation(command);
    case "deactivatelocation": return deactivateLocation(command);
    case "restorelegacylocation": return restoreLegacyLocation(command);
    case "createreturnableassettype": case "updatereturnableassettype": return saveReturnableAssetType(command);
    case "deactivatereturnableassettype": return deactivateMaster(command,"returnable_asset_types","returnable_asset_type");
    default: throw new WorkflowError("UNKNOWN_COMMAND", `Unsupported workflow command: ${command.command}.`);
  }
}
