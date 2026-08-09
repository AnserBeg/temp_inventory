import { ensureDatabase, first, getD1, newId } from "./inventory-db";

export type CreateOrderLine = {
  kind?: "item" | "charge";
  productId?: string;
  quantity?: number;
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
  freightCents?: number;
  feeCents?: number;
  refundableDepositCents?: number;
};

type CreateOrderResult = {
  recordId: string;
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

type NormalizedItem = {
  productId: string;
  productName: string;
  quantity: number;
  unitAmountCents: number;
  discountCents: number;
  taxable: boolean;
  taxRateBps: number;
  fulfillmentRoute: "stock" | "special_order" | "drop_ship";
  projectReference: string | null;
  configurationSnapshot: string | null;
  sourceSalesOrderLineId: string | null;
  linkedPurchaseOrderLineId: string | null;
};

type NormalizedCharge = {
  chargeType: string;
  description: string;
  amountCents: number;
  direction: "add" | "subtract";
  taxable: boolean;
  refundable: boolean;
  taxRateBps: number;
  taxCode: string | null;
};

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

function validDate(value: unknown, field: string) {
  const normalized = requiredText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new RecordValidationError("VALIDATION_ERROR", `${field} must use YYYY-MM-DD format.`);
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new RecordValidationError("VALIDATION_ERROR", `${field} is not a valid calendar date.`);
  }
  return normalized;
}

function orderNumber(prefix: "PO" | "SO") {
  const date = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  return `${prefix}-${date}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
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
  const normalized = { ...input, actor: undefined, actorId: undefined, actorEmail: undefined };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(normalized)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function normalizeLines(input: CreateOrderInput) {
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
      charges.push({
        chargeType: requiredText(line.chargeType, `lines[${index}].chargeType`),
        description: requiredText(line.description, `lines[${index}].description`),
        amountCents: cents(line.amountCents, `lines[${index}].amountCents`, true),
        direction: line.direction === "subtract" ? "subtract" : "add",
        taxable: line.taxable === true,
        refundable: line.refundable === true,
        taxRateBps: basisPoints(line.taxRateBps, `lines[${index}].taxRateBps`),
        taxCode: typeof line.taxCode === "string" && line.taxCode.trim() ? line.taxCode.trim() : null,
      });
      continue;
    }
    const productId = requiredText(line.productId, `lines[${index}].productId`);
    const product = await first<{ name: string; active: number }>("SELECT name, active FROM products WHERE id = ?", productId);
    if (!product?.active) throw new RecordValidationError("INVALID_PRODUCT", `Line ${index + 1} must reference an active product.`, 404);
    const route = line.fulfillmentRoute ?? "stock";
    if (!(["stock", "special_order", "drop_ship"] as const).includes(route)) {
      throw new RecordValidationError("VALIDATION_ERROR", `lines[${index}].fulfillmentRoute is invalid.`);
    }
    const unitAmount = input.type === "purchaseOrder"
      ? cents(line.unitCostCents, `lines[${index}].unitCostCents`)
      : cents(line.unitPriceCents, `lines[${index}].unitPriceCents`);
    const quantity = positiveNumber(line.quantity, `lines[${index}].quantity`);
    const discountCents = cents(line.discountCents ?? 0, `lines[${index}].discountCents`, true);
    if (discountCents > Math.round(quantity * unitAmount)) throw new RecordValidationError("VALIDATION_ERROR", `Line ${index + 1} discount exceeds its gross amount.`);
    const sourceSalesOrderLineId=typeof line.sourceSalesOrderLineId==="string"&&line.sourceSalesOrderLineId.trim()?line.sourceSalesOrderLineId.trim():null;
    const linkedPurchaseOrderLineId=typeof line.linkedPurchaseOrderLineId==="string"&&line.linkedPurchaseOrderLineId.trim()?line.linkedPurchaseOrderLineId.trim():null;
    if(input.type==="purchaseOrder"&&route!=="stock"){if(!sourceSalesOrderLineId)throw new RecordValidationError("SUPPLY_LINK_REQUIRED",`Line ${index+1} requires sourceSalesOrderLineId for ${route}.`);const demand=await first("SELECT id FROM sales_order_lines WHERE id=? AND product_id=? AND fulfillment_route=?",sourceSalesOrderLineId,productId,route);if(!demand)throw new RecordValidationError("SUPPLY_LINK_MISMATCH",`Line ${index+1} source sales line does not match product and route.`,409);}
    if(input.type==="salesOrder"&&linkedPurchaseOrderLineId){const supply=await first("SELECT id FROM purchase_order_lines WHERE id=? AND product_id=?",linkedPurchaseOrderLineId,productId);if(!supply)throw new RecordValidationError("SUPPLY_LINK_MISMATCH",`Line ${index+1} linked purchase line does not match the product.`,409);}
    items.push({
      productId, productName: product.name, quantity, unitAmountCents: unitAmount,
      discountCents, taxable: line.taxable !== false,
      taxRateBps: basisPoints(line.taxRateBps, `lines[${index}].taxRateBps`),
      fulfillmentRoute: route,
      projectReference: typeof line.projectReference === "string" && line.projectReference.trim() ? line.projectReference.trim() : input.projectReference?.trim() || null,
      configurationSnapshot: typeof line.configurationSnapshot === "string" && line.configurationSnapshot.trim() ? line.configurationSnapshot : null,
      sourceSalesOrderLineId,linkedPurchaseOrderLineId,
    });
  }
  if (!items.length) throw new RecordValidationError("VALIDATION_ERROR", "At least one item line is required.");
  return { items, charges };
}

export async function createOrderRecord(input: CreateOrderInput): Promise<CreateOrderResult> {
  await ensureDatabase();
  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
  const requestHash = await hashOrderInput(input);
  const claimToken = crypto.randomUUID();
  const prior = await replay(idempotencyKey, requestHash);
  if (prior) return prior;
  if (input.type !== "purchaseOrder" && input.type !== "salesOrder") throw new RecordValidationError("VALIDATION_ERROR", "type must be purchaseOrder or salesOrder.");

  const actor = requiredText(input.actor, "server actor");
  const actorId = requiredText(input.actorId, "server actor id");
  const actorEmail = requiredText(input.actorEmail, "server actor email");
  const projectReference = typeof input.projectReference === "string" && input.projectReference.trim() ? input.projectReference.trim() : null;
  const currency = typeof input.currency === "string" && /^[A-Z]{3}$/.test(input.currency.trim().toUpperCase()) ? input.currency.trim().toUpperCase() : "CAD";
  const exchangeRateToBase = input.exchangeRateToBase == null ? 1 : Number(input.exchangeRateToBase);
  if (!Number.isFinite(exchangeRateToBase) || exchangeRateToBase <= 0) throw new RecordValidationError("VALIDATION_ERROR", "exchangeRateToBase must be greater than zero.");
  const paymentTerms = typeof input.paymentTerms === "string" && input.paymentTerms.trim() ? input.paymentTerms.trim() : null;
  const dueDate = input.dueDate == null ? null : validDate(input.dueDate, "dueDate");
  const { items, charges } = await normalizeLines(input);
  const itemSubtotalCents = items.reduce((sum, line) => sum + Math.round(line.quantity * line.unitAmountCents) - line.discountCents, 0);
  const chargeSubtotalCents = charges.reduce((sum, charge) => sum + (charge.direction === "subtract" ? -charge.amountCents : charge.amountCents), 0);
  const taxCents = items.reduce((sum, line) => sum + (line.taxable ? Math.round(((line.quantity * line.unitAmountCents - line.discountCents) * line.taxRateBps) / 10000) : 0), 0)
    + charges.reduce((sum, charge) => sum + (charge.taxable ? (charge.direction === "subtract" ? -1 : 1) * Math.round((charge.amountCents * charge.taxRateBps) / 10000) : 0), 0);
  const totalCents = itemSubtotalCents + chargeSubtotalCents + taxCents;
  const baseTotalCents = Math.round(totalCents * exchangeRateToBase);
  if (totalCents < 0) throw new RecordValidationError("VALIDATION_ERROR", "Charges and discounts cannot produce a negative order total.");
  const quantity = items.reduce((sum, line) => sum + line.quantity, 0);
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
    const number = orderNumber("PO");
    result = {
      recordId,
      message: `${number} saved as a draft with ${items.length} item line${items.length === 1 ? "" : "s"}; approval is required before its ${quantity}-unit purchasing commitment becomes incoming supply.`,
      impact: { physical: "On-hand inventory and the immutable movement ledger are unchanged.", commercial: "Draft lines do not increase incoming forecast until approval.", financial: "Charges and tax are planned only; no vendor bill or payment was created.", onHandDelta: 0, incomingDelta: 0, reservedDelta: 0, availableDelta: 0 },
    };
    statements = [
      db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key, command, entity_id, response_json, request_hash, claim_token, created_at) VALUES (?, 'create_purchase_order', ?, ?, ?, ?, ?)").bind(idempotencyKey, recordId, JSON.stringify(result), requestHash, claimToken, now),
      db.prepare(`INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,payment_terms,due_date,total_cents,buyer_name,project_reference,revision_number,version,created_at)
        SELECT ?,?,?,'draft','not_billed',?,?,?,?,?,?,?,?,?,1,1,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
        .bind(recordId, number, vendorId, expectedDate, currency, exchangeRateToBase, baseTotalCents, paymentTerms, dueDate, totalCents, actor, projectReference, now, idempotencyKey, recordId, claimToken),
    ];
    items.forEach((line) => {const lineId=newId("po-line");statements.push(db.prepare(`INSERT INTO purchase_order_lines
      (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,configuration_snapshot,fulfillment_route,source_sales_order_line_id)
      SELECT ?,?,?,?,0,?,?,?,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
      .bind(lineId, recordId, line.productId, line.quantity, line.unitAmountCents, line.configurationSnapshot, line.fulfillmentRoute,line.sourceSalesOrderLineId, idempotencyKey, recordId, claimToken));if(line.sourceSalesOrderLineId)statements.push(db.prepare(`UPDATE sales_order_lines SET linked_purchase_order_line_id=? WHERE id=? AND product_id=? AND linked_purchase_order_line_id IS NULL AND EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`).bind(lineId,line.sourceSalesOrderLineId,line.productId,idempotencyKey,recordId,claimToken));});
    statements.push(db.prepare(`INSERT INTO purchase_order_revisions (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
      SELECT ?,?,1,'draft',?,'Initial draft',?,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
      .bind(newId("revision"), recordId, JSON.stringify({ number, vendorId, expectedDate, items, charges, totalCents, currency, exchangeRateToBase }), actor, now, idempotencyKey, recordId, claimToken));
  } else {
    const customerId = requiredText(input.customerId, "customerId");
    const requestedDate = validDate(input.requestedDate, "requestedDate");
    const customer = await first("SELECT id FROM business_partners WHERE id = ? AND partner_type IN ('customer','both') AND active=1", customerId);
    if (!customer) throw new RecordValidationError("INVALID_CUSTOMER", "Select a valid customer.", 404);
    const number = orderNumber("SO");
    result = {
      recordId,
      message: `${number} saved as a draft with ${items.length} item line${items.length === 1 ? "" : "s"}; confirmation is required before its ${quantity} units become customer demand.`,
      impact: { physical: "On-hand inventory and the immutable movement ledger are unchanged.", commercial: "Draft lines do not create active demand or reserve stock.", financial: "Charges and tax are planned only; no customer invoice or revenue posting was created.", onHandDelta: 0, incomingDelta: 0, reservedDelta: 0, availableDelta: 0 },
    };
    statements = [
      db.prepare("INSERT OR IGNORE INTO command_log (idempotency_key, command, entity_id, response_json, request_hash, claim_token, created_at) VALUES (?, 'create_sales_order', ?, ?, ?, ?, ?)").bind(idempotencyKey, recordId, JSON.stringify(result), requestHash, claimToken, now),
      db.prepare(`INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,payment_terms,due_date,total_cents,owner_name,project_reference,version,created_at)
        SELECT ?,?,?,'draft','not_invoiced',?,?,?,?,?,?,?,?,?,1,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
        .bind(recordId, number, customerId, requestedDate, currency, exchangeRateToBase, baseTotalCents, paymentTerms, dueDate, totalCents, actor, projectReference, now, idempotencyKey, recordId, claimToken),
    ];
    items.forEach((line) => statements.push(db.prepare(`INSERT INTO sales_order_lines
      (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,configuration_snapshot,fulfillment_route,project_reference,linked_purchase_order_line_id,discount_cents,taxable,tax_rate_bps)
      SELECT ?,?,?,?,0,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
      .bind(newId("so-line"), recordId, line.productId, line.quantity, line.unitAmountCents, line.configurationSnapshot, line.fulfillmentRoute, line.projectReference,line.linkedPurchaseOrderLineId, line.discountCents, line.taxable ? 1 : 0, line.taxRateBps, idempotencyKey, recordId, claimToken)));
  }

  charges.forEach((charge) => statements.push(db.prepare(`INSERT INTO document_charges
    (id,document_type,document_id,charge_type,description,amount_cents,direction,taxable,refundable,tax_code,tax_rate_bps,tax_amount_cents,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
    .bind(newId("charge"), input.type === "purchaseOrder" ? "purchase_order" : "sales_order", recordId, charge.chargeType, charge.description, charge.amountCents, charge.direction, charge.taxable ? 1 : 0, charge.refundable ? 1 : 0, charge.taxCode, charge.taxRateBps, charge.taxable ? Math.round((charge.amountCents * charge.taxRateBps) / 10000) : 0, now, idempotencyKey, recordId, claimToken)));
  statements.push(
    db.prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
      SELECT ?,?,?,?, ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
      .bind(newId("audit"), input.type === "purchaseOrder" ? "purchase_order" : "sales_order", recordId, input.type === "purchaseOrder" ? "purchase_order_draft_created" : "sales_order_draft_created", result.message, actor, actorId, actorEmail, JSON.stringify({ items, charges, totalCents, taxCents, projectReference, currency, exchangeRateToBase, paymentTerms, dueDate }), now, idempotencyKey, recordId, claimToken),
    db.prepare(`INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at)
      SELECT ?,?,?,?,?,'pending',0,?,? WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key=? AND entity_id=? AND claim_token=?)`)
      .bind(newId("outbox"), input.type === "purchaseOrder" ? "purchase_order.draft_created" : "sales_order.draft_created", input.type === "purchaseOrder" ? "purchase_order" : "sales_order", recordId, JSON.stringify({ recordId, itemCount: items.length, totalCents }), now, now, idempotencyKey, recordId, claimToken)
  );

  await db.batch(statements);
  const committed = await replay(idempotencyKey, requestHash);
  if (!committed) throw new RecordValidationError("CREATE_CONFLICT", "The order could not be created. Retry with a new idempotency key.", 409);
  return committed;
}
