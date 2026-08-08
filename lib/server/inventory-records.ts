import { ensureDatabase, first, getD1, newId } from "./inventory-db";

export type CreateOrderInput = {
  type: "purchaseOrder" | "salesOrder";
  idempotencyKey: string;
  vendorId?: string;
  customerId?: string;
  productId: string;
  quantity: number;
  unitCostCents?: number;
  unitPriceCents?: number;
  expectedDate?: string;
  requestedDate?: string;
  actor?: string;
  projectReference?: string;
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

export class RecordValidationError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

function requiredText(value: unknown, field: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new RecordValidationError("VALIDATION_ERROR", `${field} is required.`);
  return normalized;
}

function positiveNumber(value: unknown, field: string) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new RecordValidationError("VALIDATION_ERROR", `${field} must be greater than zero.`);
  }
  return normalized;
}

function positiveCents(value: unknown, field: string) {
  const normalized = positiveNumber(value, field);
  if (!Number.isInteger(normalized)) {
    throw new RecordValidationError("VALIDATION_ERROR", `${field} must be a whole number of cents.`);
  }
  return normalized;
}

function validDate(value: unknown, field: string) {
  const normalized = requiredText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new RecordValidationError("VALIDATION_ERROR", `${field} must use YYYY-MM-DD format.`);
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new RecordValidationError("VALIDATION_ERROR", `${field} is not a valid calendar date.`);
  }
  return normalized;
}

function orderNumber(prefix: "PO" | "SO") {
  const date = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  const suffix = crypto.randomUUID().slice(0, 6).toUpperCase();
  return `${prefix}-${date}-${suffix}`;
}

async function replay(idempotencyKey: string) {
  const prior = await first<{ responseJson: string }>(
    "SELECT response_json AS responseJson FROM command_log WHERE idempotency_key = ?",
    idempotencyKey
  );
  return prior ? JSON.parse(prior.responseJson) as CreateOrderResult : null;
}

export async function createOrderRecord(input: CreateOrderInput): Promise<CreateOrderResult> {
  await ensureDatabase();
  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
  const prior = await replay(idempotencyKey);
  if (prior) return prior;

  if (input.type !== "purchaseOrder" && input.type !== "salesOrder") {
    throw new RecordValidationError("VALIDATION_ERROR", "type must be purchaseOrder or salesOrder.");
  }
  const productId = requiredText(input.productId, "productId");
  const quantity = positiveNumber(input.quantity, "quantity");
  const actor = typeof input.actor === "string" && input.actor.trim() ? input.actor.trim() : "Avery Morgan";
  const projectReference = typeof input.projectReference === "string" && input.projectReference.trim()
    ? input.projectReference.trim()
    : null;

  const product = await first<{ id: string; sku: string; name: string; active: number }>(
    "SELECT id, sku, name, active FROM products WHERE id = ?",
    productId
  );
  if (!product || !product.active) {
    throw new RecordValidationError("INVALID_PRODUCT", "Select an active product.", 404);
  }

  const recordId = newId(input.type === "purchaseOrder" ? "po" : "so");
  const lineId = newId(input.type === "purchaseOrder" ? "po-line" : "so-line");
  const now = new Date().toISOString();
  const db = getD1();
  let result: CreateOrderResult;
  let statements: D1PreparedStatement[];

  if (input.type === "purchaseOrder") {
    const vendorId = requiredText(input.vendorId, "vendorId");
    const unitCostCents = positiveCents(input.unitCostCents, "unitCostCents");
    const expectedDate = validDate(input.expectedDate, "expectedDate");
    const vendor = await first<{ id: string; name: string }>(
      "SELECT id, name FROM business_partners WHERE id = ? AND partner_type = 'vendor'",
      vendorId
    );
    if (!vendor) throw new RecordValidationError("INVALID_VENDOR", "Select a valid vendor.", 404);
    const number = orderNumber("PO");
    const totalCents = Math.round(quantity * unitCostCents);
    result = {
      recordId,
      message: `${number} approved: a purchasing commitment for ${quantity} ${product.name} unit${quantity === 1 ? "" : "s"} was created; no physical inventory movement occurred.`,
      impact: {
        physical: "On-hand inventory and the immutable movement ledger are unchanged.",
        commercial: `Incoming forecast increased by ${quantity}.`,
        financial: "No vendor bill or payment was created.",
        onHandDelta: 0,
        incomingDelta: quantity,
        reservedDelta: 0,
        availableDelta: 0,
      },
    };
    const responseJson = JSON.stringify(result);
    statements = [
      db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key, command, entity_id, response_json, created_at)
                  VALUES (?, 'create_purchase_order', ?, ?, ?)`)
        .bind(idempotencyKey, recordId, responseJson, now),
      db.prepare(`INSERT INTO purchase_orders
        (id, number, vendor_id, lifecycle_status, billing_status, expected_date, currency, total_cents,
         buyer_name, project_reference, version, created_at)
        SELECT ?, ?, ?, 'approved', 'not_billed', ?, 'CAD', ?, ?, ?, 1, ?
         WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key = ? AND entity_id = ?)`)
        .bind(recordId, number, vendorId, expectedDate, totalCents, actor, projectReference, now, idempotencyKey, recordId),
      db.prepare(`INSERT INTO purchase_order_lines
        (id, purchase_order_id, product_id, ordered_qty, closed_qty, unit_cost_cents, configuration_snapshot)
        SELECT ?, ?, ?, ?, 0, ?, NULL
         WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key = ? AND entity_id = ?)`)
        .bind(lineId, recordId, productId, quantity, unitCostCents, idempotencyKey, recordId),
      db.prepare(`INSERT INTO audit_events (id, entity_type, entity_id, action, summary, actor, metadata_json, created_at)
        SELECT ?, 'purchase_order', ?, 'purchase_order_created', ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key = ? AND entity_id = ?)`)
        .bind(newId("audit"), recordId, result.message, actor, JSON.stringify({ vendorId, productId, quantity, unitCostCents, expectedDate, projectReference }), now, idempotencyKey, recordId),
    ];
  } else {
    const customerId = requiredText(input.customerId, "customerId");
    const unitPriceCents = positiveCents(input.unitPriceCents, "unitPriceCents");
    const requestedDate = validDate(input.requestedDate, "requestedDate");
    const customer = await first<{ id: string; name: string }>(
      "SELECT id, name FROM business_partners WHERE id = ? AND partner_type = 'customer'",
      customerId
    );
    if (!customer) throw new RecordValidationError("INVALID_CUSTOMER", "Select a valid customer.", 404);
    const number = orderNumber("SO");
    const totalCents = Math.round(quantity * unitPriceCents);
    result = {
      recordId,
      message: `${number} confirmed: customer demand for ${quantity} ${product.name} unit${quantity === 1 ? "" : "s"} was created; no physical inventory movement occurred.`,
      impact: {
        physical: "On-hand inventory and the immutable movement ledger are unchanged.",
        commercial: `Customer demand increased by ${quantity}; stock is not reserved automatically.`,
        financial: "No customer invoice or revenue posting was created.",
        onHandDelta: 0,
        incomingDelta: 0,
        reservedDelta: 0,
        availableDelta: 0,
      },
    };
    const responseJson = JSON.stringify(result);
    statements = [
      db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key, command, entity_id, response_json, created_at)
                  VALUES (?, 'create_sales_order', ?, ?, ?)`)
        .bind(idempotencyKey, recordId, responseJson, now),
      db.prepare(`INSERT INTO sales_orders
        (id, number, customer_id, lifecycle_status, billing_status, requested_date, currency, total_cents,
         owner_name, project_reference, version, created_at)
        SELECT ?, ?, ?, 'confirmed', 'not_invoiced', ?, 'CAD', ?, ?, ?, 1, ?
         WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key = ? AND entity_id = ?)`)
        .bind(recordId, number, customerId, requestedDate, totalCents, actor, projectReference, now, idempotencyKey, recordId),
      db.prepare(`INSERT INTO sales_order_lines
        (id, sales_order_id, product_id, ordered_qty, canceled_qty, unit_price_cents, configuration_snapshot)
        SELECT ?, ?, ?, ?, 0, ?, NULL
         WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key = ? AND entity_id = ?)`)
        .bind(lineId, recordId, productId, quantity, unitPriceCents, idempotencyKey, recordId),
      db.prepare(`INSERT INTO audit_events (id, entity_type, entity_id, action, summary, actor, metadata_json, created_at)
        SELECT ?, 'sales_order', ?, 'sales_order_created', ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM command_log WHERE idempotency_key = ? AND entity_id = ?)`)
        .bind(newId("audit"), recordId, result.message, actor, JSON.stringify({ customerId, productId, quantity, unitPriceCents, requestedDate, projectReference }), now, idempotencyKey, recordId),
    ];
  }

  await db.batch(statements);
  const committed = await replay(idempotencyKey);
  if (!committed) throw new RecordValidationError("CREATE_CONFLICT", "The order could not be created. Retry with a new idempotency key.", 409);
  return committed;
}
