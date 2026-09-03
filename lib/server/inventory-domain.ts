import { all, commandD1, commandGuardSql, ensureDatabase, first, newId, nextDocumentNumber, roundQuantity, statement } from "./inventory-db";
import { assertPeriodOpen } from "./policy";
import type { AppCapability } from "./auth";
import { normalizeProductQuantity, ProductQuantityError, validateBaseProductQuantity } from "./product-quantities";
import { effectivePricesForProducts } from "./pricing";
import { prepareOrderDraft, RecordValidationError, type CreateOrderLine, type NormalizedItem } from "./inventory-records";

type CommandPayload = Record<string, unknown>;

export type InventoryCommand = {
  command: string;
  entityId: string;
  payload?: CommandPayload;
  idempotencyKey: string;
  version: number;
  claimToken?: string;
  requestHash?: string;
};

export type CommandResult = {
  message: string;
  countId?: string;
  countNumber?: string;
  shipmentId?: string;
  shipmentNumber?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  salesOrderId?: string;
  salesOrderNumber?: string;
  paymentId?: string;
  paymentNumber?: string;
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

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public currentVersion?: number
  ) {
    super(message);
  }
}

async function normalizedQuantity(input: {
  productId: string;
  quantity: number;
  uomId?: string | null;
  usage: "base" | "purchase" | "sales";
  field?: string;
  allowZero?: boolean;
}) {
  try {
    return await normalizeProductQuantity(input);
  } catch (error) {
    if (error instanceof ProductQuantityError) throw new DomainError(error.code, error.message, error.status);
    throw error;
  }
}

async function normalizedBaseQuantity(productId: string, quantity: number, field: string, allowZero = false) {
  try {
    return await validateBaseProductQuantity(productId, quantity, field, allowZero);
  } catch (error) {
    if (error instanceof ProductQuantityError) throw new DomainError(error.code, error.message, error.status);
    throw error;
  }
}

function asNumber(payload: CommandPayload, key: string) {
  const value = Number(payload[key]);
  if (!Number.isFinite(value)) throw new DomainError("VALIDATION_ERROR", `${key} must be a number.`);
  return value;
}

function positive(payload: CommandPayload, key = "quantity") {
  const value = roundQuantity(asNumber(payload, key));
  if (value <= 0) throw new DomainError("VALIDATION_ERROR", `${key} must be greater than zero.`);
  return value;
}

function requiredText(payload: CommandPayload, key: string) {
  const value = typeof payload[key] === "string" ? payload[key].trim() : "";
  if (!value) throw new DomainError("VALIDATION_ERROR", `${key} is required.`);
  return value;
}

function optionalText(payload: CommandPayload, key: string, fallback: string) {
  const value = typeof payload[key] === "string" ? payload[key].trim() : "";
  return value || fallback;
}

type ActiveLocation = { id: string; code: string; inventoryStatus: string };

async function requireActiveLocation(locationId: string, allowedStatuses: string[], purpose: string) {
  const location = await first<ActiveLocation>(
    "SELECT id,code,inventory_status AS inventoryStatus FROM locations WHERE id=? AND active=1",
    locationId,
  );
  if (!location) throw new DomainError("INVALID_LOCATION", `${purpose} must reference an active inventory location.`, 404);
  if (!allowedStatuses.includes(location.inventoryStatus)) {
    throw new DomainError("LOCATION_STATUS_MISMATCH", `${location.code} cannot be used for ${purpose}; its inventory status is ${location.inventoryStatus}.`, 409);
  }
  return location;
}

/** Receipts may omit a destination when the product has a preferred usable bin in the
 * selected warehouse. The server resolves it again at posting time so imports and API
 * clients get the same behavior as the browser. */
async function receiptLocation(productId: string, payload: CommandPayload, purpose: string) {
  const requested = typeof payload.locationId === "string" ? payload.locationId.trim() : "";
  if (requested) {
    await requireActiveLocation(requested, ["usable"], purpose);
    return requested;
  }
  const warehouseId = requiredText(payload, "warehouseId");
  const preferred = await first<{ id: string }>(`SELECT l.id FROM product_default_locations pdl
    JOIN locations l ON l.id=pdl.location_id
    WHERE pdl.product_id=? AND pdl.warehouse_id=? AND l.warehouse_id=pdl.warehouse_id
      AND l.active=1 AND l.inventory_status='usable'`, productId, warehouseId);
  if (!preferred) {
    throw new DomainError("RECEIPT_LOCATION_REQUIRED", "Select a usable destination, or set this product's preferred bin for the warehouse.", 409);
  }
  return preferred.id;
}

/** Strict YYYY-MM-DD calendar-date validation shared by every dated payload field. */
function validDateText(value: unknown, field: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new DomainError("VALIDATION_ERROR", `${field} must use YYYY-MM-DD format.`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new DomainError("VALIDATION_ERROR", `${field} must be a valid calendar date.`);
  }
  return text;
}

function postingDateValue(payload: CommandPayload) {
  const value = typeof payload.postingDate === "string" && payload.postingDate.trim()
    ? validDateText(payload.postingDate, "postingDate")
    : new Date().toISOString().slice(0, 10);
  // A posting date is the business date the goods or money actually moved. The caller's own
  // calendar day (asOf) plus one day of timezone slack is the latest date that can be true.
  const callerToday = typeof payload.asOf === "string" && payload.asOf.trim() ? validDateText(payload.asOf, "asOf") : new Date().toISOString().slice(0, 10);
  const latest = new Date(`${callerToday}T00:00:00.000Z`);
  latest.setUTCDate(latest.getUTCDate() + 1);
  if (value > latest.toISOString().slice(0, 10)) {
    throw new DomainError("POSTING_DATE_IN_FUTURE", `postingDate ${value} is in the future; postings cannot be dated later than ${latest.toISOString().slice(0, 10)}.`);
  }
  return value;
}

/**
 * Quantities are stored as REAL with at most three decimals, but SQLite arithmetic on them
 * drifts (0.3-0.1-0.2 = -2.8e-17), which the non-negative balance triggers reject as a raw
 * failure. Every balance/layer/reservation mutation rounds to six places and every claim
 * compares with a one-millionth tolerance so precision-3 products never trip the invariant.
 */
const QTY_EPSILON = "0.000001";
const qtyMinus = (column: string) => `ROUND(${column} - ?, 6)`;
const qtyPlus = (column: string) => `ROUND(${column} + ?, 6)`;
const qtyAtLeast = (expression: string) => `${expression} >= ? - ${QTY_EPSILON}`;
const qtyDrained = (column: string) => `ROUND(${column} - ?, 6) <= ${QTY_EPSILON}`;

function postingTimestamp(payload: CommandPayload) {
  return `${postingDateValue(payload)}${new Date().toISOString().slice(10)}`;
}

function auditMetadata(payload: CommandPayload, metadata: Record<string, unknown>) {
  return JSON.stringify({
    ...metadata,
    actorId: optionalText(payload, "actorId", "unknown"),
    actorEmail: optionalText(payload, "actorEmail", "unknown"),
  });
}

type ValuationMethod = "fifo" | "average" | "standard";

type ValuationPolicyState = {
  method: ValuationMethod;
  standardCostCents: number;
  averageCostCents: number;
  version: number;
  exists: boolean;
};

type CostLayerAllocation = { id: string; quantity: number; unitCostCents: number };

type IssueValuation = {
  method: ValuationMethod;
  unitCostCents: number;
  valueCents: number;
  layers: CostLayerAllocation[];
};

function actorDetails(payload: CommandPayload) {
  return {
    label: optionalText(payload, "actor", "Unknown user"),
    id: optionalText(payload, "actorId", "unknown"),
    email: optionalText(payload, "actorEmail", "unknown"),
  };
}

type IncomingTracking = {
  policy: "quantity" | "lot" | "serial";
  lotId: string | null;
  unitId: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  createLot: boolean;
  claimSql: string;
  claimBindings: Array<string | number>;
};

type OutgoingTracking = {
  policy: "quantity" | "lot" | "serial";
  lotId: string | null;
  unitId: string | null;
  unitVersion: number | null;
  claimSql: string;
  claimBindings: Array<string | number>;
};

async function outgoingTracking(productId: string, locationId: string, quantity: number, payload: CommandPayload, inventoryStatus = "usable"): Promise<OutgoingTracking> {
  const product = await first<{ policy: string }>("SELECT tracking_policy AS policy FROM products WHERE id=? AND active=1", productId);
  if (!product || !["quantity", "lot", "serial"].includes(product.policy)) throw new DomainError("TRACKING_CONFIGURATION_ERROR", "The product tracking policy is missing or invalid.", 409);
  const lotId = typeof payload.lotId === "string" && payload.lotId.trim() ? payload.lotId.trim() : null;
  const unitId = typeof payload.inventoryUnitId === "string" && payload.inventoryUnitId.trim() ? payload.inventoryUnitId.trim() : null;
  if (product.policy === "quantity") {
    if (lotId || unitId) throw new DomainError("TRACKING_POLICY_MISMATCH", "Quantity-tracked products cannot ship a lot or serial identity.", 409);
    return { policy: "quantity", lotId: null, unitId: null, unitVersion: null, claimSql: "", claimBindings: [] };
  }
  if (product.policy === "lot") {
    if (!lotId || unitId) throw new DomainError("LOT_ASSIGNMENT_REQUIRED", "lotId is required when shipping a lot-tracked product.", 409);
    const lot = await first<{ productId: string; status: string }>("SELECT product_id AS productId,status FROM inventory_lots WHERE id=?", lotId);
    if (!lot || lot.productId !== productId || lot.status !== "active") throw new DomainError("INVALID_LOT", "The selected lot is not active for the product.", 409);
    const identified = await first<{ quantity: number }>(`SELECT COALESCE(SUM(CASE WHEN sm.to_location_id=? THEN ma.quantity WHEN sm.from_location_id=? THEN -ma.quantity ELSE 0 END),0) AS quantity FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id WHERE sm.product_id=? AND ma.lot_id=?`, locationId, locationId, productId, lotId);
    if (Number(identified?.quantity ?? 0) < quantity) throw new DomainError("LOT_QUANTITY_SHORTAGE", "The selected lot does not have enough identified stock at the reservation location.", 409);
    return { policy: "lot", lotId, unitId: null, unitVersion: null, claimSql: ` AND (SELECT COALESCE(SUM(CASE WHEN sm.to_location_id=? THEN ma.quantity WHEN sm.from_location_id=? THEN -ma.quantity ELSE 0 END),0) FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id WHERE sm.product_id=? AND ma.lot_id=?)>=?`, claimBindings: [locationId, locationId, productId, lotId, quantity] };
  }
  if (quantity !== 1 || !unitId) throw new DomainError("SERIAL_ASSIGNMENT_REQUIRED", "Serial-tracked shipments require inventoryUnitId and quantity exactly one.", 409);
  const unit = await first<{ lotId: string | null; version: number }>("SELECT lot_id AS lotId,version FROM inventory_units WHERE id=? AND product_id=? AND location_id=? AND inventory_status=? AND lifecycle_status='on_hand' AND allocated_sales_order_line_id IS NULL", unitId, productId, locationId, inventoryStatus);
  if (!unit) throw new DomainError("INVALID_SERIAL_STATE", `The selected serial is not ${inventoryStatus}, unallocated on-hand stock at the selected location.`, 409);
  if (lotId && lotId !== unit.lotId) throw new DomainError("SERIAL_LOT_MISMATCH", "The serial does not belong to the selected lot.", 409);
  return { policy: "serial", lotId: unit.lotId, unitId, unitVersion: unit.version, claimSql: " AND EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.id=? AND iu.product_id=? AND iu.location_id=? AND iu.inventory_status=? AND iu.lifecycle_status='on_hand' AND iu.allocated_sales_order_line_id IS NULL AND iu.version=?)", claimBindings: [unitId, productId, locationId, inventoryStatus, unit.version] };
}

/**
 * A receipt correction must reverse the immutable identity on its source movement. Asking the
 * operator to re-enter that identity allowed a different lot to be supplied and made the UI
 * impossible to use for quarantined serials. Derive it from the receipt instead and claim its
 * current state atomically with the correction.
 */
async function receiptReversalTracking(sourceMovementId: string, productId: string, locationId: string, inventoryStatus: string, quantity: number): Promise<OutgoingTracking> {
  const product = await first<{ policy: string }>("SELECT tracking_policy AS policy FROM products WHERE id=? AND active=1", productId);
  if (!product || !["quantity", "lot", "serial"].includes(product.policy)) throw new DomainError("TRACKING_CONFIGURATION_ERROR", "The product tracking policy is missing or invalid.", 409);
  if (product.policy === "quantity") return { policy: "quantity", lotId: null, unitId: null, unitVersion: null, claimSql: "", claimBindings: [] };
  const assignment = await first<{ lotId: string | null; unitId: string | null; quantity: number }>(
    `SELECT MAX(lot_id) AS lotId,MAX(inventory_unit_id) AS unitId,COALESCE(SUM(quantity),0) AS quantity
       FROM movement_assignments WHERE movement_id=?`, sourceMovementId
  );
  if (product.policy === "lot") {
    if (!assignment?.lotId || assignment.quantity < quantity) throw new DomainError("RECEIPT_ASSIGNMENT_MISMATCH", "The original receipt does not contain enough immutable lot assignment to reverse.", 409);
    const identified = await first<{ quantity: number }>(`SELECT COALESCE(SUM(CASE WHEN sm.to_location_id=? THEN ma.quantity WHEN sm.from_location_id=? THEN -ma.quantity ELSE 0 END),0) AS quantity
      FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id
      WHERE sm.product_id=? AND ma.lot_id=?`, locationId, locationId, productId, assignment.lotId);
    if (Number(identified?.quantity ?? 0) < quantity) throw new DomainError("LOT_QUANTITY_SHORTAGE", "The original receipt lot no longer has enough identified stock at its receipt location.", 409);
    return { policy: "lot", lotId: assignment.lotId, unitId: null, unitVersion: null,
      claimSql: ` AND (SELECT COALESCE(SUM(CASE WHEN sm.to_location_id=? THEN ma.quantity WHEN sm.from_location_id=? THEN -ma.quantity ELSE 0 END),0) FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id WHERE sm.product_id=? AND ma.lot_id=?)>=?`,
      claimBindings: [locationId, locationId, productId, assignment.lotId, quantity] };
  }
  if (quantity !== 1 || !assignment?.unitId || assignment.quantity < 1) throw new DomainError("SERIAL_ASSIGNMENT_REQUIRED", "The original serial-tracked receipt does not contain one reversible serial assignment.", 409);
  const unit = await first<{ lotId: string | null; version: number }>(`SELECT lot_id AS lotId,version FROM inventory_units
    WHERE id=? AND product_id=? AND location_id=? AND inventory_status=? AND lifecycle_status='on_hand' AND allocated_sales_order_line_id IS NULL`,
    assignment.unitId, productId, locationId, inventoryStatus);
  if (!unit) throw new DomainError("INVALID_SERIAL_STATE", "The originally received serial is no longer unallocated on hand at its receipt location.", 409);
  return { policy: "serial", lotId: unit.lotId, unitId: assignment.unitId, unitVersion: unit.version,
    claimSql: " AND EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.id=? AND iu.product_id=? AND iu.location_id=? AND iu.inventory_status=? AND iu.lifecycle_status='on_hand' AND iu.allocated_sales_order_line_id IS NULL AND iu.version=?)",
    claimBindings: [assignment.unitId, productId, locationId, inventoryStatus, unit.version] };
}

async function returnTracking(productId: string, salesLineId: string, quantity: number, payload: CommandPayload): Promise<OutgoingTracking> {
  const product = await first<{ policy: string }>("SELECT tracking_policy AS policy FROM products WHERE id=? AND active=1", productId);
  if (!product || !["quantity", "lot", "serial"].includes(product.policy)) throw new DomainError("TRACKING_CONFIGURATION_ERROR", "The product tracking policy is missing or invalid.", 409);
  const lotId = typeof payload.lotId === "string" && payload.lotId.trim() ? payload.lotId.trim() : null;
  const unitId = typeof payload.inventoryUnitId === "string" && payload.inventoryUnitId.trim() ? payload.inventoryUnitId.trim() : null;
  if (product.policy === "quantity") {
    if (lotId || unitId) throw new DomainError("TRACKING_POLICY_MISMATCH", "Quantity-tracked returns cannot carry lot or serial identities.", 409);
    return { policy: "quantity", lotId: null, unitId: null, unitVersion: null, claimSql: "", claimBindings: [] };
  }
  if (product.policy === "lot") {
    if (!lotId || unitId) throw new DomainError("LOT_ASSIGNMENT_REQUIRED", "lotId is required for a lot-tracked customer return.", 409);
    const available = await first<{ quantity: number }>(`SELECT COALESCE(SUM(CASE WHEN sm.movement_type='sales_shipment' THEN ma.quantity WHEN sm.movement_type='customer_return' THEN -ma.quantity ELSE 0 END),0) AS quantity FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id WHERE sm.sales_order_line_id=? AND sm.product_id=? AND ma.lot_id=?`, salesLineId, productId, lotId);
    if (Number(available?.quantity ?? 0) < quantity) throw new DomainError("LOT_RETURN_EXCEEDS_SHIPPED", "The selected lot does not have enough shipped-not-returned quantity.", 409);
    return { policy: "lot", lotId, unitId: null, unitVersion: null, claimSql: " AND (SELECT COALESCE(SUM(CASE WHEN sm.movement_type='sales_shipment' THEN ma.quantity WHEN sm.movement_type='customer_return' THEN -ma.quantity ELSE 0 END),0) FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id WHERE sm.sales_order_line_id=? AND sm.product_id=? AND ma.lot_id=?)>=?", claimBindings: [salesLineId, productId, lotId, quantity] };
  }
  if (quantity !== 1 || !unitId) throw new DomainError("SERIAL_ASSIGNMENT_REQUIRED", "Serial-tracked returns require inventoryUnitId and quantity exactly one.", 409);
  const unit = await first<{ lotId: string | null; version: number }>(`SELECT iu.lot_id AS lotId,iu.version FROM inventory_units iu WHERE iu.id=? AND iu.product_id=? AND iu.lifecycle_status='shipped'
    AND EXISTS (SELECT 1 FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id WHERE ma.inventory_unit_id=iu.id AND sm.sales_order_line_id=? AND sm.movement_type='sales_shipment')`, unitId, productId, salesLineId);
  if (!unit) throw new DomainError("INVALID_SERIAL_STATE", "The serial was not shipped on this sales-order line or was already returned.", 409);
  return { policy: "serial", lotId: unit.lotId, unitId, unitVersion: unit.version, claimSql: " AND EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.id=? AND iu.product_id=? AND iu.lifecycle_status='shipped' AND iu.version=? AND EXISTS (SELECT 1 FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id WHERE ma.inventory_unit_id=iu.id AND sm.sales_order_line_id=? AND sm.movement_type='sales_shipment'))", claimBindings: [unitId, productId, unit.version, salesLineId] };
}

async function incomingTracking(productId: string, quantity: number, payload: CommandPayload): Promise<IncomingTracking> {
  const product = await first<{ policy: string }>("SELECT tracking_policy AS policy FROM products WHERE id=? AND active=1", productId);
  if (!product || !["quantity", "lot", "serial"].includes(product.policy)) throw new DomainError("TRACKING_CONFIGURATION_ERROR", "The product tracking policy is missing or invalid.", 409);
  if (product.policy === "quantity") {
    if (payload.lotNumber || payload.lotId || payload.serialNumber || payload.inventoryUnitId) throw new DomainError("TRACKING_POLICY_MISMATCH", "Quantity-tracked products cannot receive a lot or serial identity.", 409);
    return { policy: "quantity", lotId: null, unitId: null, lotNumber: null, serialNumber: null, createLot: false, claimSql: "", claimBindings: [] };
  }
  const lotNumber = typeof payload.lotNumber === "string" ? payload.lotNumber.trim() : "";
  const serialNumber = typeof payload.serialNumber === "string" ? payload.serialNumber.trim() : "";
  if (product.policy === "lot" && !lotNumber) throw new DomainError("LOT_ASSIGNMENT_REQUIRED", "lotNumber is required when receiving a lot-tracked product.", 409);
  if (product.policy === "lot" && serialNumber) throw new DomainError("TRACKING_POLICY_MISMATCH", "A lot-tracked product cannot receive a serial identity.", 409);
  if (product.policy === "serial" && (!serialNumber || quantity !== 1)) throw new DomainError("SERIAL_ASSIGNMENT_REQUIRED", "Serial-tracked receipts require serialNumber and quantity exactly one.", 409);
  const existingLot = lotNumber ? await first<{ id: string; status: string }>("SELECT id,status FROM inventory_lots WHERE product_id=? AND lot_number=?", productId, lotNumber) : null;
  if (existingLot && existingLot.status !== "active") throw new DomainError("INVALID_LOT", "The existing lot is inactive.", 409);
  const lotId = existingLot?.id ?? (lotNumber ? newId("lot") : null);
  if (serialNumber && await first("SELECT id FROM inventory_units WHERE product_id=? AND serial_number=?", productId, serialNumber)) throw new DomainError("DUPLICATE_SERIAL", "This serial number is already registered for the product.", 409);
  return {
    policy: product.policy as "lot" | "serial",
    lotId,
    unitId: serialNumber ? newId("unit") : null,
    lotNumber: lotNumber || null,
    serialNumber: serialNumber || null,
    createLot: !!lotId && !existingLot,
    claimSql: serialNumber ? " AND NOT EXISTS (SELECT 1 FROM inventory_units WHERE product_id=? AND serial_number=?)" : "",
    claimBindings: serialNumber ? [productId, serialNumber] : [],
  };
}

function auditPrepared(
  input: InventoryCommand,
  entityType: string,
  entityId: string,
  action: string,
  summary: string,
  metadata: Record<string, unknown>,
  when: string
) {
  const payload = input.payload ?? {};
  const actor = actorDetails(payload);
  return commandD1(input).prepare(`INSERT INTO audit_events
    (id, entity_type, entity_id, action, summary, actor, actor_id, actor_email, metadata_json, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${commandExistsPrepared(input)}`)
    .bind(newId("audit"), entityType, entityId, action, summary, actor.label, actor.id, actor.email, auditMetadata(payload, metadata), when);
}

function outboxPrepared(
  input: InventoryCommand,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
  when: string
) {
  return commandD1(input).prepare(`INSERT INTO outbox_events
    (id, event_type, aggregate_type, aggregate_id, payload_json, status, attempts, available_at, created_at)
    SELECT ?, ?, ?, ?, ?, 'pending', 0, ?, ? WHERE ${commandExistsPrepared(input)}`)
    .bind(newId("outbox"), eventType, aggregateType, aggregateId, JSON.stringify(payload), when, when);
}

async function valuationPolicy(productId: string): Promise<ValuationPolicyState> {
  const row = await first<{ method: string; standardCostCents: number; averageCostCents: number; version: number }>(
    `SELECT vp.method, vp.standard_cost_cents AS standardCostCents,
            vp.average_cost_cents AS averageCostCents, vp.version
       FROM valuation_policies vp WHERE vp.product_id = ?`,
    productId
  );
  if (row) {
    return {
      method: row.method as ValuationMethod,
      standardCostCents: Number(row.standardCostCents),
      averageCostCents: Number(row.averageCostCents),
      version: Number(row.version),
      exists: true,
    };
  }
  const product = await first<{ standardCostCents: number }>(
    "SELECT standard_cost_cents AS standardCostCents FROM products WHERE id = ?",
    productId
  );
  if (!product) throw new DomainError("NOT_FOUND", "Product was not found.", 404);
  return {
    method: "fifo",
    standardCostCents: Number(product.standardCostCents),
    averageCostCents: Number(product.standardCostCents),
    version: 0,
    exists: false,
  };
}

async function valuationForReceipt(productId: string, quantity: number, actualUnitCostCents: number) {
  const policy = await valuationPolicy(productId);
  const quantityRow = await first<{ onHandQty: number }>(
    "SELECT COALESCE(SUM(on_hand_qty), 0) AS onHandQty FROM inventory_balances WHERE product_id = ?",
    productId
  );
  const priorQuantity = Number(quantityRow?.onHandQty ?? 0);
  const nextAverageCostCents = quantity > 0
    ? Math.round(((priorQuantity * policy.averageCostCents) + (quantity * actualUnitCostCents)) / (priorQuantity + quantity))
    : policy.averageCostCents;
  const unitCostCents = policy.method === "standard"
    ? policy.standardCostCents
    : actualUnitCostCents;
  return { ...policy, unitCostCents, nextAverageCostCents, valueCents: Math.round(quantity * unitCostCents) };
}

async function valuationForIssue(productId: string, quantity: number): Promise<IssueValuation> {
  const policy = await valuationPolicy(productId);
  const rows = await all<{ id: string; remainingQty: number; unitCostCents: number }>(
    `SELECT id, remaining_qty AS remainingQty,
            unit_cost_cents + CASE WHEN received_qty > 0 THEN ROUND(landed_cost_cents / received_qty) ELSE 0 END AS unitCostCents
       FROM cost_layers
      WHERE product_id = ? AND remaining_qty > 0
      ORDER BY received_at, id`,
    productId
  );
  let remaining = quantity;
  let fifoValueCents = 0;
  const layers: CostLayerAllocation[] = [];
  for (const row of rows) {
    if (remaining <= 0) break;
    const used = Math.min(remaining, Number(row.remainingQty));
    layers.push({ id: row.id, quantity: used, unitCostCents: Number(row.unitCostCents) });
    fifoValueCents += Math.round(used * Number(row.unitCostCents));
    remaining = roundQuantity(remaining - used);
  }
  if (remaining > 0) {
    throw new DomainError("VALUATION_LAYER_SHORTAGE", "Cost layers do not reconstruct enough on-hand quantity for this posting.", 409);
  }
  const unitCostCents = policy.method === "standard"
    ? policy.standardCostCents
    : policy.method === "average"
      ? policy.averageCostCents
      : Math.round(fifoValueCents / quantity);
  const valueCents = policy.method === "fifo" ? fifoValueCents : Math.round(quantity * unitCostCents);
  return { method: policy.method, unitCostCents, valueCents, layers };
}

async function historicalShipmentUnitCost(salesOrderLineId: string, productId: string) {
  const row = await first<{ quantity: number; valueCents: number }>(
    `SELECT COALESCE(SUM(-ive.quantity), 0) AS quantity,
            COALESCE(SUM(-ive.value_cents), 0) AS valueCents
       FROM inventory_value_entries ive
       JOIN stock_movements sm ON sm.id = ive.movement_id
      WHERE sm.sales_order_line_id = ? AND ive.entry_type = 'shipment' AND ive.quantity < 0`,
    salesOrderLineId
  );
  const quantity = Number(row?.quantity ?? 0);
  if (quantity > 0) return Math.round(Number(row?.valueCents ?? 0) / quantity);
  const policy = await valuationPolicy(productId);
  return policy.method === "standard" ? policy.standardCostCents : policy.averageCostCents || policy.standardCostCents;
}

/**
 * One bound JSON document claims every consumed layer at once. D1 caps a statement at 100
 * bound parameters, so a FIFO issue across many small layers cannot be claimed with two
 * placeholders per layer.
 */
function layerClaimPredicate(layers: CostLayerAllocation[]) {
  if (!layers.length) return "";
  return `AND NOT EXISTS (SELECT 1 FROM json_each(?) claimed LEFT JOIN cost_layers cl ON cl.id = json_extract(claimed.value, '$.id')
    WHERE cl.id IS NULL OR cl.remaining_qty < json_extract(claimed.value, '$.quantity') - ${QTY_EPSILON})`;
}

function layerClaimBindings(layers: CostLayerAllocation[]) {
  if (!layers.length) return [] as string[];
  return [JSON.stringify(layers.map((layer) => ({ id: layer.id, quantity: layer.quantity })))];
}

function layerConsumptionPrepared(input: InventoryCommand, layers: CostLayerAllocation[]) {
  const marker = commandExistsPrepared(input);
  return layers.map((layer) => commandD1(input).prepare(`UPDATE cost_layers
    SET remaining_qty = MAX(${qtyMinus("remaining_qty")}, 0),
        status = CASE WHEN ${qtyDrained("remaining_qty")} THEN 'consumed' ELSE 'open' END
    WHERE id = ? AND ${qtyAtLeast("remaining_qty")} AND ${marker}`)
    .bind(layer.quantity, layer.quantity, layer.id, layer.quantity));
}

/** Open FIFO layers for a product, optionally skipping one layer that is claimed separately. */
async function openLayersForIssue(productId: string, quantity: number, excludeLayerId: string | null) {
  const rows = await all<{ id: string; remainingQty: number; unitCostCents: number }>(
    `SELECT id, remaining_qty AS remainingQty,
            unit_cost_cents + CASE WHEN received_qty > 0 THEN ROUND(landed_cost_cents / received_qty) ELSE 0 END AS unitCostCents
       FROM cost_layers
      WHERE product_id = ? AND remaining_qty > 0 AND (? IS NULL OR id <> ?)
      ORDER BY received_at, id`,
    productId, excludeLayerId, excludeLayerId,
  );
  let remaining = quantity;
  let valueCents = 0;
  const layers: CostLayerAllocation[] = [];
  for (const row of rows) {
    if (remaining <= 0) break;
    const used = roundQuantity(Math.min(remaining, Number(row.remainingQty)));
    if (used <= 0) continue;
    layers.push({ id: row.id, quantity: used, unitCostCents: Number(row.unitCostCents) });
    valueCents += Math.round(used * Number(row.unitCostCents));
    remaining = roundQuantity(remaining - used);
  }
  return { layers, valueCents, shortfall: remaining };
}

function valueEntryPrepared(
  input: InventoryCommand,
  values: {
    productId: string;
    movementId: string;
    entryType: string;
    quantity: number;
    unitCostCents: number;
    valueCents: number;
    method: ValuationMethod;
    referenceType: string;
    referenceId: string;
    postedAt: string;
    postedBy: string;
  }
) {
  return commandD1(input).prepare(`INSERT INTO inventory_value_entries
    (id, product_id, movement_id, entry_type, quantity, unit_cost_cents, value_cents, cost_method,
     reference_type, reference_id, posted_at, posted_by)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${commandExistsPrepared(input)}`)
    .bind(newId("value"), values.productId, values.movementId, values.entryType, values.quantity,
      values.unitCostCents, values.valueCents, values.method, values.referenceType, values.referenceId,
      values.postedAt, values.postedBy);
}

type CountApprovalState = { id: string; version: number } | null;

async function countApprovalForVariance(
  input: InventoryCommand,
  locationId: string,
  recordedQuantity: number,
  countedQuantity: number,
  estimatedValueCents: number
): Promise<CountApprovalState> {
  const setting = await first<{ valueJson: string }>(
    "SELECT value_json AS valueJson FROM system_settings WHERE key = 'inventory.countApprovalThreshold'"
  );
  const policy = { absoluteQuantity: 5, absoluteValueCents: 100_000 };
  if (setting) {
    try {
      const parsed = JSON.parse(setting.valueJson) as Partial<typeof policy>;
      if (Number.isFinite(Number(parsed.absoluteQuantity))) policy.absoluteQuantity = Number(parsed.absoluteQuantity);
      if (Number.isFinite(Number(parsed.absoluteValueCents))) policy.absoluteValueCents = Number(parsed.absoluteValueCents);
    } catch {
      throw new DomainError("POLICY_CONFIGURATION_ERROR", "Inventory count approval policy is invalid.", 500);
    }
  }
  const absoluteVariance = Math.abs(roundQuantity(countedQuantity - recordedQuantity));
  const requiresApproval = absoluteVariance > policy.absoluteQuantity || Math.abs(estimatedValueCents) > policy.absoluteValueCents;
  if (!requiresApproval) return null;
  const approvalId = typeof input.payload?.approvalId === "string" ? input.payload.approvalId.trim() : "";
  if (!approvalId) {
    throw new DomainError("APPROVAL_REQUIRED", "This count variance exceeds policy. Request manager approval, then post it with the approval ID.", 409);
  }
  const approval = await first<{
    id: string;
    version: number;
    status: string;
    consumedAt: string | null;
    entityType: string;
    entityId: string;
    requestType: string;
    metadataJson: string;
  }>(`SELECT id, version, status, consumed_at AS consumedAt, entity_type AS entityType,
             entity_id AS entityId, request_type AS requestType, metadata_json AS metadataJson
        FROM approvals WHERE id = ?`, approvalId);
  if (!approval || approval.status !== "approved" || approval.consumedAt || approval.entityType !== "product"
      || approval.entityId !== input.entityId || approval.requestType !== "inventory_count_variance") {
    throw new DomainError("APPROVAL_REQUIRED", "This count variance requires an unused manager-approved inventory count request.", 409);
  }
  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(approval.metadataJson) as Record<string, unknown>;
  } catch {
    throw new DomainError("APPROVAL_SCOPE_MISMATCH", "The count approval has invalid scope metadata.", 409);
  }
  const exact = String(metadata.productId ?? approval.entityId) === input.entityId
    && String(metadata.locationId ?? "") === locationId
    && Number(metadata.recordedQuantity) === recordedQuantity
    && Number(metadata.countedQuantity) === countedQuantity
    && Number(metadata.absoluteVariance) === absoluteVariance;
  if (!exact) throw new DomainError("APPROVAL_SCOPE_MISMATCH", "The approved variance does not match this product, location, book quantity, and count.", 409);
  return { id: approval.id, version: approval.version };
}

function validateEnvelope(input: InventoryCommand) {
  if (!input.command?.trim()) throw new DomainError("VALIDATION_ERROR", "command is required.");
  if (!input.entityId?.trim()) throw new DomainError("VALIDATION_ERROR", "entityId is required.");
  if (!input.idempotencyKey?.trim()) throw new DomainError("VALIDATION_ERROR", "idempotencyKey is required.");
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new DomainError("VALIDATION_ERROR", "version must be a positive integer.");
  }
}

function normalizeCommand(command: string) {
  return command.trim().toLowerCase().replaceAll(/[_\s-]/g, "");
}

export const inventoryCommandCapabilities = {
  receive: "operationalWrite",
  postReceipt: "operationalWrite",
  postReceiptBatch: "operationalWrite",
  closeRemainder: "operationalWrite",
  closePurchaseOrder: "operationalWrite",
  reopenRemainder: "operationalWrite",
  reopenPurchaseOrder: "operationalWrite",
  reverseReceipt: "operationalWrite",
  vendorReturn: "operationalWrite",
  postVendorReturn: "operationalWrite",
  priceOnlyCredit: "financialWrite",
  vendorPriceAllowance: "financialWrite",
  reserve: "operationalWrite",
  reserveSale: "operationalWrite",
  ship: "operationalWrite",
  shipSale: "operationalWrite",
  postShipment: "operationalWrite",
  immediateSale: "financialWrite",
  shipAndInvoice: "financialWrite",
  postImmediateSale: "financialWrite",
  counterSale: "financialWrite",
  postCounterSale: "financialWrite",
  // Shipment reversal lives only in the workflow dispatcher (advanced-domain), which also
  // restores lot/serial identity and guards invoiced quantity. The legacy alias here was an
  // incomplete duplicate and now answers UNKNOWN_COMMAND.
  customerReturn: "operationalWrite",
  postCustomerReturn: "operationalWrite",
  inventoryAdjustment: "operationalWrite",
  postInventoryAdjustment: "operationalWrite",
  postOpeningBalance: "administer",
} as const satisfies Record<string, AppCapability>;

const inventoryCapabilityByCommand = new Map(
  Object.entries(inventoryCommandCapabilities).map(([command, capability]) => [normalizeCommand(command), capability] as const),
);

export function inventoryCommandCapability(command: string): AppCapability | undefined {
  return inventoryCapabilityByCommand.get(normalizeCommand(command));
}

function logPrepared(input: InventoryCommand, result: CommandResult, entityTable: "purchase_orders" | "purchase_order_lines" | "receipts" | "sales_orders" | "inventory_balances", extraPredicate = "", extraBindings: Array<string | number | null> = []) {
  const now = new Date().toISOString();
  let predicate: string;
  let bindings: Array<string | number | null>;
  if (entityTable === "inventory_balances") {
    const locationId = String(input.payload?.locationId ?? "");
    predicate = `product_id = ? AND location_id = ? AND version = ? ${extraPredicate}`;
    bindings = [input.entityId, locationId, input.version];
  } else if (entityTable === "purchase_order_lines") {
    predicate = `id = ? AND version = ? AND purchase_order_id = ? ${extraPredicate}`;
    bindings = [String(input.payload?.lineId ?? ""), input.version, input.entityId];
  } else {
    predicate = `id = ? AND version = ? ${extraPredicate}`;
    bindings = [input.entityId, input.version];
  }
  return statement(
    `INSERT OR IGNORE INTO command_log (idempotency_key, command, entity_id, response_json, request_hash, claim_token, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ? FROM ${entityTable} WHERE ${predicate}`,
    input.idempotencyKey,
    input.command,
    input.entityId,
    JSON.stringify(result),
    input.requestHash ?? null,
    input.claimToken ?? null,
    now,
    ...bindings,
    ...extraBindings
  );
}

function commandExistsPrepared(input: InventoryCommand) {
  void input;
  return commandGuardSql();
}

async function currentOrConflict(input: InventoryCommand) {
  const saved = await first<{ responseJson: string; requestHash: string | null }>(
    "SELECT response_json AS responseJson, request_hash AS requestHash FROM command_log WHERE idempotency_key = ?",
    input.idempotencyKey
  );
  if (saved) {
    if (saved.requestHash && input.requestHash && saved.requestHash !== input.requestHash) {
      throw new DomainError("IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different request.", 409);
    }
    return JSON.parse(saved.responseJson) as CommandResult;
  }
  return null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function requestHash(input: InventoryCommand) {
  const payload = { ...(input.payload ?? {}) };
  delete payload.actor;
  delete payload.actorId;
  delete payload.actorEmail;
  const bytes = new TextEncoder().encode(stableJson({ command: normalizeCommand(input.command), entityId: input.entityId, version: input.version, payload }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requireLogged(input: InventoryCommand, fallback: string) {
  const saved = await currentOrConflict(input);
  if (saved) return saved;
  throw new DomainError("VERSION_CONFLICT", fallback, 409);
}

type PurchaseLineState = {
  id: string;
  purchaseOrderId: string;
  productId: string;
  orderedQty: number;
  closedQty: number;
  unitCostCents: number;
  version: number;
  expectedDate: string | null;
  lifecycleStatus: string;
  netReceivedQty: number;
  openToReceiveQty: number;
  fulfillmentRoute: string;
  sourceSalesOrderLineId: string | null;
  lineVersion: number;
};

type ReceiptSupplyAllocation = {
  id: string;
  version: number;
  salesOrderLineId: string;
  salesOrderId: string;
  salesOrderVersion: number;
  receiptQuantity: number;
  usableReceiptQuantity: number;
  damagedReceiptQuantity: number;
  reserveQuantity: number;
  reservationId: string | null;
  usableLineageId: string | null;
  damagedLineageId: string | null;
};

/**
 * Peg the whole receipt to active commercial allocations in customer-date order. Usable
 * quantity is assigned first and can create a reservation. Quarantined quantity still advances
 * the allocation's received state so it agrees with the PO, but never becomes customer-available.
 */
async function planReceiptSupplyAllocations(purchaseOrderLineId: string, usableQuantity: number, damagedQuantity = 0) {
  if (usableQuantity + damagedQuantity <= 0) return [] as ReceiptSupplyAllocation[];
  const rows = await all<{
    id: string; version: number; salesOrderLineId: string; salesOrderId: string; salesOrderVersion: number;
    allocationRemaining: number; demandRemaining: number;
  }>(`SELECT sa.id,sa.version,sa.sales_order_line_id AS salesOrderLineId,sol.sales_order_id AS salesOrderId,
      so.version AS salesOrderVersion,sa.allocated_qty-sa.received_qty AS allocationRemaining,
      MAX(sol.ordered_qty-sol.canceled_qty
        -COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END)
          FROM stock_movements sm WHERE sm.sales_order_line_id=sol.id),0)
        -COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.sales_order_line_id=sol.id AND r.status='active'),0),0) AS demandRemaining
    FROM supply_allocations sa
    JOIN sales_order_lines sol ON sol.id=sa.sales_order_line_id
    JOIN sales_orders so ON so.id=sol.sales_order_id
    WHERE sa.purchase_order_line_id=? AND sa.status='active' AND sa.allocated_qty>sa.received_qty
      AND so.lifecycle_status<>'canceled'
    ORDER BY so.requested_date,so.created_at,sa.created_at,sa.id`, purchaseOrderLineId);
  let receiptRemaining = roundQuantity(usableQuantity + damagedQuantity);
  let usableRemaining = roundQuantity(usableQuantity);
  const demandRemaining = new Map<string, number>();
  const planned: ReceiptSupplyAllocation[] = [];
  for (const row of rows) {
    if (receiptRemaining <= 0) break;
    const receiptQuantity = roundQuantity(Math.min(receiptRemaining, Number(row.allocationRemaining)));
    if (receiptQuantity <= 0) continue;
    const usableReceiptQuantity = roundQuantity(Math.min(receiptQuantity, usableRemaining));
    const damagedReceiptQuantity = roundQuantity(receiptQuantity - usableReceiptQuantity);
    const currentDemand = demandRemaining.get(row.salesOrderLineId) ?? Math.max(Number(row.demandRemaining), 0);
    const reserveQuantity = roundQuantity(Math.min(usableReceiptQuantity, currentDemand));
    demandRemaining.set(row.salesOrderLineId, roundQuantity(currentDemand - reserveQuantity));
    planned.push({
      id: row.id,
      version: Number(row.version),
      salesOrderLineId: row.salesOrderLineId,
      salesOrderId: row.salesOrderId,
      salesOrderVersion: Number(row.salesOrderVersion),
      receiptQuantity,
      usableReceiptQuantity,
      damagedReceiptQuantity,
      reserveQuantity,
      reservationId: reserveQuantity > 0 ? newId("reservation") : null,
      usableLineageId: usableReceiptQuantity > 0 ? newId("allocation-receipt") : null,
      damagedLineageId: damagedReceiptQuantity > 0 ? newId("allocation-receipt") : null,
    });
    receiptRemaining = roundQuantity(receiptRemaining - receiptQuantity);
    usableRemaining = roundQuantity(usableRemaining - usableReceiptQuantity);
  }
  return planned;
}

async function getPurchaseLine(orderId: string, lineId?: string) {
  const line = await first<PurchaseLineState>(
    `SELECT pol.id, pol.purchase_order_id AS purchaseOrderId, pol.product_id AS productId,
            pol.ordered_qty AS orderedQty, pol.closed_qty AS closedQty,
            pol.unit_cost_cents AS unitCostCents,pol.fulfillment_route AS fulfillmentRoute,pol.version AS lineVersion,
            pol.source_sales_order_line_id AS sourceSalesOrderLineId,po.version, po.expected_date AS expectedDate,
            po.lifecycle_status AS lifecycleStatus,
            CASE WHEN pol.fulfillment_route='drop_ship'
              THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0)
              ELSE MAX(COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0),0) END AS netReceivedQty,
            MAX(pol.ordered_qty - pol.closed_qty - CASE WHEN pol.fulfillment_route='drop_ship'
              THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0)
              ELSE MAX(COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0),0) END, 0) AS openToReceiveQty
       FROM purchase_order_lines pol
       JOIN purchase_orders po ON po.id = pol.purchase_order_id
      WHERE po.id = ? AND (? IS NULL OR pol.id = ?)
      ORDER BY pol.id LIMIT 1`,
    orderId,
    lineId ?? null,
    lineId ?? null
  );
  if (!line) throw new DomainError("NOT_FOUND", "Purchase order line was not found.", 404);
  return line;
}

type OverReceiptApprovalState = { id: string; version: number } | null;

async function approvalForOverReceipt(input:InventoryCommand,line:PurchaseLineState,quantity:number):Promise<OverReceiptApprovalState>{
  const excess=roundQuantity(quantity-line.openToReceiveQty);if(excess<=0)return null;
  const setting=await first<{valueJson:string}>("SELECT value_json AS valueJson FROM system_settings WHERE key='receiving.overReceiptPolicy'");
  let tolerancePct=0,toleranceQuantity=0;
  if(setting){try{const parsed=JSON.parse(setting.valueJson) as Record<string,unknown>;tolerancePct=Number(parsed.tolerancePct??0);toleranceQuantity=Number(parsed.toleranceQuantity??0);}catch{throw new DomainError("POLICY_CONFIGURATION_ERROR","Over-receipt policy is invalid.",500);}}
  if(!Number.isFinite(tolerancePct)||tolerancePct<0||!Number.isFinite(toleranceQuantity)||toleranceQuantity<0)throw new DomainError("POLICY_CONFIGURATION_ERROR","Over-receipt tolerance must be non-negative.",500);
  const tolerated=Math.max(toleranceQuantity,roundQuantity(line.orderedQty*tolerancePct/100));if(excess<=tolerated)return null;
  const approvalId=typeof input.payload?.approvalId==="string"?input.payload.approvalId.trim():"";if(!approvalId)throw new DomainError("APPROVAL_REQUIRED",`Receipt exceeds the ${tolerancePct}% tolerance by ${excess} units. Request manager approval and retry with approvalId.`,409,line.lineVersion);
  const approval=await first<{id:string;version:number;status:string;consumedAt:string|null;entityType:string;entityId:string;requestType:string;metadataJson:string}>(`SELECT id,version,status,consumed_at AS consumedAt,entity_type AS entityType,entity_id AS entityId,request_type AS requestType,metadata_json AS metadataJson FROM approvals WHERE id=?`,approvalId);
  if(!approval||approval.status!=="approved"||approval.consumedAt||approval.entityType!=="purchase_order_line"||approval.entityId!==line.id||approval.requestType!=="over_receipt")throw new DomainError("APPROVAL_REQUIRED","This over-receipt requires an unused manager-approved request for the exact purchase-order line.",409,line.lineVersion);
  let metadata:Record<string,unknown>;try{metadata=JSON.parse(approval.metadataJson) as Record<string,unknown>;}catch{throw new DomainError("APPROVAL_SCOPE_MISMATCH","Over-receipt approval metadata is invalid.",409,line.lineVersion);}
  if(Number(metadata.maxExcessQuantity)<excess||metadata.purchaseOrderId!=null&&String(metadata.purchaseOrderId)!==line.purchaseOrderId)throw new DomainError("APPROVAL_SCOPE_MISMATCH","Approved over-receipt scope does not cover this order, line, and excess quantity.",409,line.lineVersion);
  return{id:approval.id,version:approval.version};
}

async function postReceipt(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const requestedLineId = typeof payload.lineId === "string" && payload.lineId.trim() ? payload.lineId.trim() : "";
  const line = await getPurchaseLine(input.entityId, requestedLineId || undefined);
  if (!requestedLineId) {
    // The claim is keyed by lineId. Without one the claim silently failed after the RCV number
    // had already been consumed; resolve a single-line order here and refuse anything else.
    const lineCount = await first<{ count: number }>("SELECT COUNT(*) AS count FROM purchase_order_lines WHERE purchase_order_id=?", input.entityId);
    if (Number(lineCount?.count ?? 0) !== 1) throw new DomainError("LINE_REQUIRED", "lineId is required: this purchase order has more than one line, so choose the line being received.", 400, line.lineVersion);
    payload.lineId = line.id;
    input.payload = payload;
  } else if (line.id !== requestedLineId) {
    throw new DomainError("NOT_FOUND", "Purchase order line was not found on this purchase order.", 404);
  }
  const enteredQuantity = positive(payload);
  const enteredDamagedQuantity = payload.damagedQuantity == null ? 0 : roundQuantity(asNumber(payload, "damagedQuantity"));
  if (enteredDamagedQuantity < 0 || enteredDamagedQuantity > enteredQuantity) {
    throw new DomainError("VALIDATION_ERROR", "damagedQuantity must be between zero and the received quantity.");
  }
  const quantityState = await normalizedQuantity({ productId: line.productId, quantity: enteredQuantity, uomId: typeof payload.uomId === "string" ? payload.uomId : null, usage: "purchase", field: "quantity" });
  const damagedState = await normalizedQuantity({ productId: line.productId, quantity: enteredDamagedQuantity, uomId: quantityState.fromUomId, usage: "purchase", field: "damagedQuantity", allowZero: true });
  const quantity = quantityState.baseQuantity;
  const damagedQuantity = damagedState.baseQuantity;
  const usableQuantity = roundQuantity(quantity - damagedQuantity);
  if (line.lifecycleStatus !== "approved") throw new DomainError("INVALID_STATE", "Only approved purchase orders can be received.", 409, line.lineVersion);
  if(line.fulfillmentRoute==="drop_ship")throw new DomainError("FULFILLMENT_ROUTE_BLOCKED","Drop-ship lines cannot be received into internal inventory; use the external delivery workflow.",409,line.lineVersion);
  if(line.fulfillmentRoute==="special_order"&&!line.sourceSalesOrderLineId)throw new DomainError("SUPPLY_LINK_REQUIRED","Special-order receipts require an explicit source sales-order-line link.",409,line.lineVersion);
  if (line.lineVersion !== input.version) {
    throw new DomainError("VERSION_CONFLICT", "The purchase-order line changed. Refresh it before receiving.", 409, line.lineVersion);
  }
  const overReceiptApproval=await approvalForOverReceipt(input,line,quantity);
  const excessQuantity=Math.max(roundQuantity(quantity-line.openToReceiveQty),0);
  const locationId = await receiptLocation(line.productId, payload, "accepted receipt inventory");
  const quarantineLocationId = damagedQuantity > 0 ? requiredText(payload, "quarantineLocationId") : locationId;
  if (damagedQuantity > 0) await requireActiveLocation(quarantineLocationId, ["quarantine", "damaged"], "quarantined receipt inventory");
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const receiptId = newId("receipt");
  const receiptNumber = await nextDocumentNumber("RCV");
  const usableLineId = newId("receipt-line");
  const damagedLineId = newId("receipt-line");
  const usableMovementId = newId("movement");
  const damagedMovementId = newId("movement");
  const now = postingTimestamp(payload);
  const valuation = await valuationForReceipt(line.productId, quantity, line.unitCostCents);
  const tracking = await incomingTracking(line.productId, quantity, payload);
  if (tracking.policy === "serial" && damagedQuantity !== 0 && damagedQuantity !== 1) throw new DomainError("SERIAL_CONDITION_SPLIT", "A serial-tracked unit must be entirely usable or entirely damaged.", 409);
  const supplyAllocations = await planReceiptSupplyAllocations(line.id, usableQuantity, damagedQuantity);
  const automaticallyReserved = roundQuantity(supplyAllocations.reduce((sum, allocation) => sum + allocation.reserveQuantity, 0));
  const usableValueCents = Math.round(usableQuantity * valuation.unitCostCents);
  const damagedValueCents = valuation.valueCents - usableValueCents;
  const result: CommandResult = {
    message: `${receiptNumber} posted for ${enteredQuantity} ${quantityState.fromUomCode} (${quantity} ${quantityState.baseUomCode}).`,
    impact: {
      physical: `${quantity} units added to on-hand inventory${damagedQuantity ? `; ${damagedQuantity} routed to quarantine` : ""}.`,
      commercial: `Open incoming decreased by ${Math.min(quantity,line.openToReceiveQty)}${automaticallyReserved ? `; ${automaticallyReserved} usable units auto-reserved to allocated sales demand` : ""}${excessQuantity?`; ${excessQuantity} excess units received under tolerance or approval`:""}.`,
      financial: "No vendor bill or payment was created.",
      onHandDelta: quantity,
      incomingDelta: -Math.min(quantity,line.openToReceiveQty),
      reservedDelta: automaticallyReserved,
      availableDelta: roundQuantity(usableQuantity - automaticallyReserved),
    },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  const locationClaimSql = ` AND EXISTS (SELECT 1 FROM locations WHERE id=? AND active=1 AND inventory_status='usable')${damagedQuantity > 0 ? " AND EXISTS (SELECT 1 FROM locations WHERE id=? AND active=1 AND inventory_status IN ('quarantine','damaged'))" : ""}`;
  const locationClaimBindings = damagedQuantity > 0 ? [locationId, quarantineLocationId] : [locationId];
  const allocationClaimSql = supplyAllocations.map(() => " AND EXISTS (SELECT 1 FROM supply_allocations sa JOIN sales_order_lines sol ON sol.id=sa.sales_order_line_id JOIN sales_orders so ON so.id=sol.sales_order_id WHERE sa.id=? AND sa.version=? AND sa.status='active' AND sa.allocated_qty-sa.received_qty>=? AND so.lifecycle_status<>'canceled')").join("");
  const allocationClaimBindings = supplyAllocations.flatMap((allocation) => [allocation.id, allocation.version, allocation.receiptQuantity]);
  const reservationTargets = supplyAllocations.filter((allocation) => allocation.reserveQuantity > 0);
  const reservationClaimSql = reservationTargets.map(() => ` AND EXISTS (SELECT 1 FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id
    WHERE sol.id=? AND so.id=? AND so.version=? AND so.lifecycle_status<>'canceled'
      AND sol.ordered_qty-sol.canceled_qty
        -COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol.id),0)
        -COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.sales_order_line_id=sol.id AND r.status='active'),0)>=?)`).join("");
  const reservationClaimBindings = reservationTargets.flatMap((allocation) => [allocation.salesOrderLineId, allocation.salesOrderId, allocation.salesOrderVersion, allocation.reserveQuantity]);
  const commands: D1PreparedStatement[] = [
    logPrepared(input, result, "purchase_order_lines", `AND COALESCE((SELECT version FROM valuation_policies WHERE product_id = ?), 0) = ?${overReceiptApproval?" AND EXISTS (SELECT 1 FROM approvals WHERE id=? AND version=? AND status='approved' AND consumed_at IS NULL)":""}${tracking.claimSql}${locationClaimSql}${allocationClaimSql}${reservationClaimSql}`, [line.productId, valuation.version,...(overReceiptApproval?[overReceiptApproval.id,overReceiptApproval.version]:[]),...tracking.claimBindings,...locationClaimBindings,...allocationClaimBindings,...reservationClaimBindings]),
    db.prepare(`UPDATE purchase_order_lines SET version=version+1 WHERE id=? AND version=? AND ${exists}`).bind(line.id, line.lineVersion),
    db.prepare(`UPDATE purchase_orders SET version = version + 1 WHERE id = ? AND ${exists}`).bind(input.entityId),
    db.prepare(`INSERT INTO receipts (id, number, purchase_order_id, status, posted_at, packing_slip_number, version)
                SELECT ?, ?, ?, 'posted', ?, ?, 1 WHERE ${exists}`).bind(receiptId, receiptNumber, input.entityId, now, optionalText(input.payload ?? {}, "packingSlipNumber", "") || null),
    db.prepare(`INSERT INTO valuation_policies
      (product_id, method, standard_cost_cents, average_cost_cents, version, updated_at, updated_by)
      SELECT ?, ?, ?, ?, 1, ?, ? WHERE ${exists}
      ON CONFLICT(product_id) DO NOTHING`)
      .bind(line.productId, valuation.method, valuation.standardCostCents, valuation.averageCostCents, now, actor),
  ];
  if (tracking.createLot) commands.push(db.prepare(`INSERT INTO inventory_lots (id,product_id,lot_number,vendor_id,manufactured_date,expiry_date,status,created_at)
    SELECT ?,?,?,?, ?,?,'active',? WHERE ${exists}`).bind(tracking.lotId, line.productId, tracking.lotNumber, payload.vendorId ?? null, payload.manufacturedDate ?? null, payload.expiryDate ?? null, now));
  if (tracking.policy === "serial") {
    const serialLocation = damagedQuantity === 1 ? quarantineLocationId : locationId;
    const serialStatus = damagedQuantity === 1 ? "quarantine" : "usable";
    commands.push(db.prepare(`INSERT INTO inventory_units (id,product_id,serial_number,lot_id,location_id,inventory_status,lifecycle_status,allocated_sales_order_line_id,version,created_at)
      SELECT ?,?,?,?,?,?,'on_hand',NULL,1,? WHERE ${exists}`).bind(tracking.unitId, line.productId, tracking.serialNumber, tracking.lotId, serialLocation, serialStatus, now));
  }
  if (valuation.method === "average") {
    commands.push(db.prepare(`UPDATE valuation_policies
      SET average_cost_cents = ?, version = version + 1, updated_at = ?, updated_by = ?
      WHERE product_id = ? AND method = 'average'
        AND ((? = 0 AND version = 1) OR version = ?) AND ${exists}`)
      .bind(valuation.nextAverageCostCents, now, actor, line.productId, valuation.version, valuation.version));
  }
  if (usableQuantity > 0) {
    commands.push(
      db.prepare(`INSERT INTO receipt_lines (id, receipt_id, purchase_order_line_id, product_id, location_id, quantity, condition)
                  SELECT ?, ?, ?, ?, ?, ?, 'usable' WHERE ${exists}`).bind(usableLineId, receiptId, line.id, line.productId, locationId, usableQuantity),
      db.prepare(`INSERT INTO stock_movements
        (id, movement_type, product_id, quantity, to_location_id, inventory_status, source_document_type,
         source_document_id, source_line_id, purchase_order_line_id, posted_at, posted_by, unit_cost_cents, idempotency_key)
        SELECT ?, 'purchase_receipt', ?, ?, ?, 'usable', 'receipt', ?, ?, ?, ?, ?, ?, ? WHERE ${exists}`)
        .bind(usableMovementId, line.productId, usableQuantity, locationId, receiptId, usableLineId, line.id, now, actor, line.unitCostCents, input.idempotencyKey),
      db.prepare(`INSERT INTO inventory_balances (product_id, location_id, on_hand_qty, reserved_qty, version)
                  SELECT ?, ?, ?, 0, 1 WHERE ${exists}
                  ON CONFLICT(product_id, location_id) DO UPDATE SET on_hand_qty = ROUND(on_hand_qty + excluded.on_hand_qty, 6), version = version + 1`)
        .bind(line.productId, locationId, usableQuantity),
      db.prepare(`INSERT INTO cost_layers
        (id, product_id, receipt_movement_id, received_qty, remaining_qty, unit_cost_cents, landed_cost_cents, received_at, status)
        SELECT ?, ?, ?, ?, ?, ?, 0, ?, 'open' WHERE ${exists}`)
        .bind(newId("layer"), line.productId, usableMovementId, usableQuantity, usableQuantity, line.unitCostCents, now),
      valueEntryPrepared(input, { productId: line.productId, movementId: usableMovementId, entryType: "receipt",
        quantity: usableQuantity, unitCostCents: valuation.unitCostCents, valueCents: usableValueCents,
        method: valuation.method, referenceType: "receipt", referenceId: receiptId, postedAt: now, postedBy: actor }),
      ...(tracking.policy === "quantity" ? [] : [db.prepare(`INSERT INTO movement_assignments (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${exists}`).bind(newId("assignment"), usableMovementId, tracking.lotId, tracking.unitId, usableQuantity)])
    );
  }
  for (const allocation of supplyAllocations) {
    commands.push(db.prepare(`UPDATE supply_allocations SET received_qty=received_qty+?,updated_at=?,version=version+1
      WHERE id=? AND version=? AND status='active' AND allocated_qty-received_qty>=? AND ${exists}`)
      .bind(allocation.receiptQuantity, now, allocation.id, allocation.version, allocation.receiptQuantity));
    if (allocation.reserveQuantity > 0 && allocation.reservationId) commands.push(
      db.prepare(`INSERT INTO reservations (id,sales_order_line_id,product_id,location_id,quantity,status,created_at)
        SELECT ?,?,?,?,?, 'active',? WHERE ${exists}`)
        .bind(allocation.reservationId, allocation.salesOrderLineId, line.productId, locationId, allocation.reserveQuantity, now),
      db.prepare(`UPDATE inventory_balances SET reserved_qty=${qtyPlus("reserved_qty")},version=version+1
        WHERE product_id=? AND location_id=? AND ${qtyAtLeast("on_hand_qty-reserved_qty")} AND ${exists}`)
        .bind(allocation.reserveQuantity, line.productId, locationId, allocation.reserveQuantity),
    );
    if (allocation.usableReceiptQuantity > 0 && allocation.usableLineageId) commands.push(db.prepare(`INSERT INTO supply_allocation_receipts
      (id,supply_allocation_id,receipt_movement_id,reservation_id,quantity,reserved_quantity,reversed_qty,created_at)
      SELECT ?,?,?,?,?,?,0,? WHERE ${exists}`)
      .bind(allocation.usableLineageId, allocation.id, usableMovementId, allocation.reservationId, allocation.usableReceiptQuantity, allocation.reserveQuantity, now));
  }
  const salesOrderVersions = new Map<string, number>();
  for (const allocation of reservationTargets) salesOrderVersions.set(allocation.salesOrderId, allocation.salesOrderVersion);
  for (const [salesOrderId, salesOrderVersion] of salesOrderVersions) commands.push(
    db.prepare(`UPDATE sales_orders SET version=version+1 WHERE id=? AND version=? AND ${exists}`).bind(salesOrderId, salesOrderVersion),
  );
  if (damagedQuantity > 0) {
    commands.push(
      db.prepare(`INSERT INTO receipt_lines (id, receipt_id, purchase_order_line_id, product_id, location_id, quantity, condition)
                  SELECT ?, ?, ?, ?, ?, ?, 'damaged' WHERE ${exists}`).bind(damagedLineId, receiptId, line.id, line.productId, quarantineLocationId, damagedQuantity),
      db.prepare(`INSERT INTO stock_movements
        (id, movement_type, product_id, quantity, to_location_id, inventory_status, source_document_type,
         source_document_id, source_line_id, purchase_order_line_id, posted_at, posted_by, unit_cost_cents, idempotency_key)
        SELECT ?, 'purchase_receipt', ?, ?, ?, 'quarantine', 'receipt', ?, ?, ?, ?, ?, ?, ? WHERE ${exists}`)
        .bind(damagedMovementId, line.productId, damagedQuantity, quarantineLocationId, receiptId, damagedLineId, line.id, now, actor, line.unitCostCents, input.idempotencyKey),
      db.prepare(`INSERT INTO inventory_balances (product_id, location_id, on_hand_qty, reserved_qty, version)
                  SELECT ?, ?, ?, 0, 1 WHERE ${exists}
                  ON CONFLICT(product_id, location_id) DO UPDATE SET on_hand_qty = ROUND(on_hand_qty + excluded.on_hand_qty, 6), version = version + 1`)
        .bind(line.productId, quarantineLocationId, damagedQuantity),
      db.prepare(`INSERT INTO cost_layers
        (id, product_id, receipt_movement_id, received_qty, remaining_qty, unit_cost_cents, landed_cost_cents, received_at, status)
        SELECT ?, ?, ?, ?, ?, ?, 0, ?, 'open' WHERE ${exists}`)
        .bind(newId("layer"), line.productId, damagedMovementId, damagedQuantity, damagedQuantity, line.unitCostCents, now),
      valueEntryPrepared(input, { productId: line.productId, movementId: damagedMovementId, entryType: "receipt",
        quantity: damagedQuantity, unitCostCents: valuation.unitCostCents, valueCents: damagedValueCents,
        method: valuation.method, referenceType: "receipt", referenceId: receiptId, postedAt: now, postedBy: actor }),
      ...(tracking.policy === "quantity" ? [] : [db.prepare(`INSERT INTO movement_assignments (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${exists}`).bind(newId("assignment"), damagedMovementId, tracking.lotId, tracking.unitId, damagedQuantity)])
    );
    for (const allocation of supplyAllocations) if (allocation.damagedReceiptQuantity > 0 && allocation.damagedLineageId) commands.push(
      db.prepare(`INSERT INTO supply_allocation_receipts
        (id,supply_allocation_id,receipt_movement_id,reservation_id,quantity,reserved_quantity,reversed_qty,created_at)
        SELECT ?,?,?,NULL,?,0,0,? WHERE ${exists}`)
        .bind(allocation.damagedLineageId, allocation.id, damagedMovementId, allocation.damagedReceiptQuantity, now),
    );
  }
  commands.push(
    auditPrepared(input, "purchase_order", input.entityId, "receipt_posted", result.message,
      { ...result.impact, receiptId, inventoryValueCents: valuation.valueCents, costMethod: valuation.method, automaticallyReserved }, now),
    outboxPrepared(input, "inventory.receipt_posted", "receipt", receiptId,
      { purchaseOrderId: input.entityId, productId: line.productId, quantity, automaticallyReserved, inventoryValueCents: valuation.valueCents }, now)
  );
  if(overReceiptApproval){commands.push(db.prepare(`UPDATE approvals SET consumed_at=?,consumed_by=?,consumed_entity_id=?,version=version+1 WHERE id=? AND version=? AND status='approved' AND consumed_at IS NULL AND ${exists}`).bind(now,actor,receiptId,overReceiptApproval.id,overReceiptApproval.version));}
  await db.batch(commands);
  return requireLogged(input, "The purchase order changed before the receipt could be posted.");
}

type BatchReceiptLine = {
  line: PurchaseLineState;
  lineVersion: number;
  quantity: number;
  damagedQuantity: number;
  usableQuantity: number;
  locationId: string;
  quarantineLocationId: string;
  valuation: Awaited<ReturnType<typeof valuationForReceipt>>;
  tracking: IncomingTracking;
  approval: OverReceiptApprovalState;
  supplyAllocations: ReceiptSupplyAllocation[];
  payload: CommandPayload;
};

async function postReceiptBatch(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const requestedLines = Array.isArray(payload.lines) ? payload.lines.filter((entry): entry is CommandPayload => Boolean(entry) && typeof entry === "object") : [];
  if (!requestedLines.length || requestedLines.length > 100) throw new DomainError("VALIDATION_ERROR", "lines must contain between 1 and 100 receipt lines.");
  const lineIds = requestedLines.map((entry) => requiredText(entry, "lineId"));
  if (new Set(lineIds).size !== lineIds.length) throw new DomainError("DUPLICATE_RECEIPT_LINE", "Each purchase-order line can appear only once in a batch receipt.");

  const states: BatchReceiptLine[] = [];
  for (const [index, requested] of requestedLines.entries()) {
    const line = await getPurchaseLine(input.entityId, lineIds[index]);
    const lineVersion = Number(requested.lineVersion);
    if (!Number.isInteger(lineVersion) || lineVersion < 1) throw new DomainError("VALIDATION_ERROR", `lines[${index}].lineVersion must be a positive integer.`);
    if (line.lineVersion !== lineVersion) throw new DomainError("VERSION_CONFLICT", `Purchase-order line ${line.id} changed. Refresh before receiving.`, 409, line.lineVersion);
    if (line.lifecycleStatus !== "approved") throw new DomainError("INVALID_STATE", "Only approved purchase orders can be received.", 409, line.lineVersion);
    if (line.fulfillmentRoute === "drop_ship") throw new DomainError("FULFILLMENT_ROUTE_BLOCKED", "Drop-ship lines cannot be received into internal inventory; use the external delivery workflow.", 409, line.lineVersion);
    if (line.fulfillmentRoute === "special_order" && !line.sourceSalesOrderLineId) throw new DomainError("SUPPLY_LINK_REQUIRED", "Special-order receipts require an explicit source sales-order-line link.", 409, line.lineVersion);
    const linePayload: CommandPayload = { ...payload, ...requested };
    delete linePayload.lines;
    const enteredQuantity = positive(linePayload);
    const enteredDamagedQuantity = linePayload.damagedQuantity == null ? 0 : roundQuantity(asNumber(linePayload, "damagedQuantity"));
    if (enteredDamagedQuantity < 0 || enteredDamagedQuantity > enteredQuantity) throw new DomainError("VALIDATION_ERROR", `lines[${index}].damagedQuantity must be between zero and quantity.`);
    const quantityState = await normalizedQuantity({ productId: line.productId, quantity: enteredQuantity, uomId: typeof linePayload.uomId === "string" ? linePayload.uomId : null, usage: "purchase", field: `lines[${index}].quantity` });
    const damagedState = await normalizedQuantity({ productId: line.productId, quantity: enteredDamagedQuantity, uomId: quantityState.fromUomId, usage: "purchase", field: `lines[${index}].damagedQuantity`, allowZero: true });
    const quantity = quantityState.baseQuantity;
    const damagedQuantity = damagedState.baseQuantity;
    const usableQuantity = roundQuantity(quantity - damagedQuantity);
    const locationId = await receiptLocation(line.productId, { ...payload, ...linePayload }, `lines[${index}] accepted inventory`);
    const quarantineLocationId = damagedQuantity > 0 ? requiredText(linePayload, "quarantineLocationId") : locationId;
    if (damagedQuantity > 0) await requireActiveLocation(quarantineLocationId, ["quarantine", "damaged"], `lines[${index}] quarantined inventory`);
    const lineInput: InventoryCommand = { ...input, version: lineVersion, payload: linePayload };
    const approval = await approvalForOverReceipt(lineInput, line, quantity);
    const valuation = await valuationForReceipt(line.productId, quantity, line.unitCostCents);
    const tracking = await incomingTracking(line.productId, quantity, linePayload);
    if (tracking.policy === "serial" && damagedQuantity !== 0 && damagedQuantity !== 1) throw new DomainError("SERIAL_CONDITION_SPLIT", "A serial-tracked unit must be entirely usable or entirely damaged.", 409);
    const supplyAllocations = await planReceiptSupplyAllocations(line.id, usableQuantity, damagedQuantity);
    states.push({ line, lineVersion, quantity, damagedQuantity, usableQuantity, locationId, quarantineLocationId, valuation, tracking, approval, supplyAllocations, payload: linePayload });
  }
  // The same SKU on two PO lines is ordinary (two prices, two delivery dates). FIFO and
  // standard costing value each line independently, so those receipts are safe together.
  // Only a moving average must advance once per product, and that pair is named so the
  // receiver knows exactly which lines to split into a second receipt.
  for (const [index, state] of states.entries()) {
    const earlier = states.findIndex((candidate, candidateIndex) => candidateIndex < index && candidate.line.productId === state.line.productId);
    if (earlier === -1 || state.valuation.method !== "average") continue;
    throw new DomainError("DUPLICATE_PRODUCT_RECEIPT", `Lines ${earlier + 1} and ${index + 1} both receive ${state.line.productId} (PO lines ${states[earlier].line.id} and ${state.line.id}); an average-cost product must advance its valuation once per receipt, so post those lines as separate receipts.`, 409);
  }

  const actor = optionalText(payload, "actor", "Avery Morgan");
  const receiptId = newId("receipt");
  const receiptNumber = await nextDocumentNumber("RCV");
  const now = postingTimestamp(payload);
  const totalQuantity = roundQuantity(states.reduce((sum, state) => sum + state.quantity, 0));
  const totalUsable = roundQuantity(states.reduce((sum, state) => sum + state.usableQuantity, 0));
  const automaticallyReserved = roundQuantity(states.reduce((sum, state) => sum + state.supplyAllocations.reduce((allocationSum, allocation) => allocationSum + allocation.reserveQuantity, 0), 0));
  const totalValueCents = states.reduce((sum, state) => sum + state.valuation.valueCents, 0);
  const result: CommandResult = {
    message: `${receiptNumber} posted ${states.length} line${states.length === 1 ? "" : "s"} and ${totalQuantity} unit${totalQuantity === 1 ? "" : "s"} as one receipt.`,
    impact: {
      physical: `${totalQuantity} units added to on-hand inventory; ${roundQuantity(totalQuantity - totalUsable)} routed to quarantine.`,
      commercial: `Each purchase-order line advanced independently; open incoming decreased by the retained receipt quantities${automaticallyReserved ? ` and ${automaticallyReserved} usable units were auto-reserved to allocated sales demand` : ""}.`,
      financial: `No vendor bill or payment was created. Inventory value increased by ${totalValueCents} cents.`,
      onHandDelta: totalQuantity,
      incomingDelta: -roundQuantity(states.reduce((sum, state) => sum + Math.min(state.quantity, state.line.openToReceiveQty), 0)),
      reservedDelta: automaticallyReserved,
      availableDelta: roundQuantity(totalUsable - automaticallyReserved),
    },
  };
  // D1 caps a statement at 100 bound parameters. The per-line preconditions that every receipt
  // line carries (line version, valuation version, destination bins) are bound as one JSON array
  // and checked with json_each, so a long truck receipt does not grow the claim by six parameters
  // per line. Only the conditional predicates (approvals, tracking, supply allocations) still bind
  // per line.
  const lineClaimJson = JSON.stringify(states.map((state) => ({
    lineId: state.line.id, lineVersion: state.lineVersion, productId: state.line.productId, valuationVersion: state.valuation.version,
    locationId: state.locationId, quarantineLocationId: state.damagedQuantity > 0 ? state.quarantineLocationId : null,
  })));
  const lineClaimSql = `AND NOT EXISTS (SELECT 1 FROM json_each(?) lc
    WHERE NOT EXISTS (SELECT 1 FROM purchase_order_lines pol WHERE pol.id=json_extract(lc.value,'$.lineId') AND pol.purchase_order_id=po.id AND pol.version=json_extract(lc.value,'$.lineVersion'))
       OR COALESCE((SELECT version FROM valuation_policies WHERE product_id=json_extract(lc.value,'$.productId')),0)<>json_extract(lc.value,'$.valuationVersion')
       OR NOT EXISTS (SELECT 1 FROM locations WHERE id=json_extract(lc.value,'$.locationId') AND active=1 AND inventory_status='usable')
       OR (json_extract(lc.value,'$.quarantineLocationId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations WHERE id=json_extract(lc.value,'$.quarantineLocationId') AND active=1 AND inventory_status IN ('quarantine','damaged'))))`;
  const claimSql = states.map((state) => `
    ${state.approval ? "AND EXISTS (SELECT 1 FROM approvals WHERE id=? AND version=? AND status='approved' AND consumed_at IS NULL)" : ""}
    ${state.tracking.claimSql}
    ${state.supplyAllocations.map(() => "AND EXISTS (SELECT 1 FROM supply_allocations sa JOIN sales_order_lines sol ON sol.id=sa.sales_order_line_id JOIN sales_orders so ON so.id=sol.sales_order_id WHERE sa.id=? AND sa.version=? AND sa.status='active' AND sa.allocated_qty-sa.received_qty>=? AND so.lifecycle_status<>'canceled')").join("\n")}
    ${state.supplyAllocations.filter((allocation) => allocation.reserveQuantity > 0).map(() => `AND EXISTS (SELECT 1 FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id
      WHERE sol.id=? AND so.id=? AND so.version=? AND so.lifecycle_status<>'canceled'
        AND sol.ordered_qty-sol.canceled_qty
          -COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol.id),0)
          -COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.sales_order_line_id=sol.id AND r.status='active'),0)>=?)`).join("\n")}`).join("\n");
  const claimBindings = states.flatMap((state) => [
    ...(state.approval ? [state.approval.id, state.approval.version] : []),
    ...state.tracking.claimBindings,
    ...state.supplyAllocations.flatMap((allocation) => [allocation.id, allocation.version, allocation.receiptQuantity]),
    ...state.supplyAllocations.filter((allocation) => allocation.reserveQuantity > 0).flatMap((allocation) => [allocation.salesOrderLineId, allocation.salesOrderId, allocation.salesOrderVersion, allocation.reserveQuantity]),
  ]);
  const db = commandD1(input);
  const exists = commandExistsPrepared(input);
  const commands: D1PreparedStatement[] = [
    statement(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM purchase_orders po WHERE po.id=? AND po.lifecycle_status='approved' ${lineClaimSql} ${claimSql}`,
      input.idempotencyKey, input.command, input.entityId, JSON.stringify(result), input.requestHash ?? null, input.claimToken ?? null, now, input.entityId, lineClaimJson, ...claimBindings),
    db.prepare(`INSERT INTO receipts (id,number,purchase_order_id,status,posted_at,packing_slip_number,version) SELECT ?,?,?,'posted',?,?,1 WHERE ${exists}`).bind(receiptId, receiptNumber, input.entityId, now, optionalText(input.payload ?? {}, "packingSlipNumber", "") || null),
    db.prepare(`UPDATE purchase_orders SET version=version+1 WHERE id=? AND ${exists}`).bind(input.entityId),
  ];

  for (const state of states) {
    const { line, damagedQuantity, usableQuantity, locationId, quarantineLocationId, valuation, tracking } = state;
    const usableLineId = newId("receipt-line");
    const damagedLineId = newId("receipt-line");
    const usableMovementId = newId("movement");
    const damagedMovementId = newId("movement");
    const usableValueCents = Math.round(usableQuantity * valuation.unitCostCents);
    const damagedValueCents = valuation.valueCents - usableValueCents;
    commands.push(
      db.prepare(`UPDATE purchase_order_lines SET version=version+1 WHERE id=? AND version=? AND ${exists}`).bind(line.id, state.lineVersion),
      db.prepare(`INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
        SELECT ?,?,?,?,?,?,? WHERE ${exists} ON CONFLICT(product_id) DO NOTHING`).bind(line.productId, valuation.method, valuation.standardCostCents, valuation.averageCostCents, 1, now, actor),
    );
    if (tracking.createLot) commands.push(db.prepare(`INSERT INTO inventory_lots (id,product_id,lot_number,vendor_id,manufactured_date,expiry_date,status,created_at)
      SELECT ?,?,?,?, ?,?,'active',? WHERE ${exists}`).bind(tracking.lotId, line.productId, tracking.lotNumber, state.payload.vendorId ?? null, state.payload.manufacturedDate ?? null, state.payload.expiryDate ?? null, now));
    if (tracking.policy === "serial") {
      const serialLocation = damagedQuantity === 1 ? quarantineLocationId : locationId;
      const serialStatus = damagedQuantity === 1 ? "quarantine" : "usable";
      commands.push(db.prepare(`INSERT INTO inventory_units (id,product_id,serial_number,lot_id,location_id,inventory_status,lifecycle_status,allocated_sales_order_line_id,version,created_at)
        SELECT ?,?,?,?,?,?,'on_hand',NULL,1,? WHERE ${exists}`).bind(tracking.unitId, line.productId, tracking.serialNumber, tracking.lotId, serialLocation, serialStatus, now));
    }
    if (valuation.method === "average") commands.push(db.prepare(`UPDATE valuation_policies SET average_cost_cents=?,version=version+1,updated_at=?,updated_by=?
      WHERE product_id=? AND method='average' AND ((?=0 AND version=1) OR version=?) AND ${exists}`).bind(valuation.nextAverageCostCents, now, actor, line.productId, valuation.version, valuation.version));
    if (usableQuantity > 0) commands.push(
      db.prepare(`INSERT INTO receipt_lines (id,receipt_id,purchase_order_line_id,product_id,location_id,quantity,condition) SELECT ?,?,?,?,?,?,'usable' WHERE ${exists}`).bind(usableLineId, receiptId, line.id, line.productId, locationId, usableQuantity),
      db.prepare(`INSERT INTO stock_movements (id,movement_type,product_id,quantity,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,purchase_order_line_id,posted_at,posted_by,unit_cost_cents,idempotency_key)
        SELECT ?,'purchase_receipt',?,?,?,'usable','receipt',?,?,?,?,?,?,? WHERE ${exists}`).bind(usableMovementId, line.productId, usableQuantity, locationId, receiptId, usableLineId, line.id, now, actor, line.unitCostCents, input.idempotencyKey),
      db.prepare(`INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) SELECT ?,?,?,0,1 WHERE ${exists} ON CONFLICT(product_id,location_id) DO UPDATE SET on_hand_qty=ROUND(on_hand_qty+excluded.on_hand_qty,6),version=version+1`).bind(line.productId, locationId, usableQuantity),
      db.prepare(`INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status) SELECT ?,?,?,?,?,?,0,?,'open' WHERE ${exists}`).bind(newId("layer"), line.productId, usableMovementId, usableQuantity, usableQuantity, line.unitCostCents, now),
      valueEntryPrepared(input, { productId: line.productId, movementId: usableMovementId, entryType: "receipt", quantity: usableQuantity, unitCostCents: valuation.unitCostCents, valueCents: usableValueCents, method: valuation.method, referenceType: "receipt", referenceId: receiptId, postedAt: now, postedBy: actor }),
    );
    if (usableQuantity > 0 && tracking.policy !== "quantity") commands.push(db.prepare(`INSERT INTO movement_assignments (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${exists}`).bind(newId("assignment"), usableMovementId, tracking.lotId, tracking.unitId, usableQuantity));
    for (const allocation of state.supplyAllocations) {
      commands.push(db.prepare(`UPDATE supply_allocations SET received_qty=received_qty+?,updated_at=?,version=version+1
        WHERE id=? AND version=? AND status='active' AND allocated_qty-received_qty>=? AND ${exists}`)
        .bind(allocation.receiptQuantity, now, allocation.id, allocation.version, allocation.receiptQuantity));
      if (allocation.reserveQuantity > 0 && allocation.reservationId) commands.push(
        db.prepare(`INSERT INTO reservations (id,sales_order_line_id,product_id,location_id,quantity,status,created_at) SELECT ?,?,?,?,?,'active',? WHERE ${exists}`)
          .bind(allocation.reservationId, allocation.salesOrderLineId, line.productId, locationId, allocation.reserveQuantity, now),
        db.prepare(`UPDATE inventory_balances SET reserved_qty=${qtyPlus("reserved_qty")},version=version+1 WHERE product_id=? AND location_id=? AND ${qtyAtLeast("on_hand_qty-reserved_qty")} AND ${exists}`)
          .bind(allocation.reserveQuantity, line.productId, locationId, allocation.reserveQuantity),
      );
      if (allocation.usableReceiptQuantity > 0 && allocation.usableLineageId) commands.push(db.prepare(`INSERT INTO supply_allocation_receipts
        (id,supply_allocation_id,receipt_movement_id,reservation_id,quantity,reserved_quantity,reversed_qty,created_at)
        SELECT ?,?,?,?,?,?,0,? WHERE ${exists}`)
        .bind(allocation.usableLineageId, allocation.id, usableMovementId, allocation.reservationId, allocation.usableReceiptQuantity, allocation.reserveQuantity, now));
    }
    if (damagedQuantity > 0) commands.push(
      db.prepare(`INSERT INTO receipt_lines (id,receipt_id,purchase_order_line_id,product_id,location_id,quantity,condition) SELECT ?,?,?,?,?,?,'damaged' WHERE ${exists}`).bind(damagedLineId, receiptId, line.id, line.productId, quarantineLocationId, damagedQuantity),
      db.prepare(`INSERT INTO stock_movements (id,movement_type,product_id,quantity,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,purchase_order_line_id,posted_at,posted_by,unit_cost_cents,idempotency_key)
        SELECT ?,'purchase_receipt',?,?,?,'quarantine','receipt',?,?,?,?,?,?,? WHERE ${exists}`).bind(damagedMovementId, line.productId, damagedQuantity, quarantineLocationId, receiptId, damagedLineId, line.id, now, actor, line.unitCostCents, input.idempotencyKey),
      db.prepare(`INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) SELECT ?,?,?,0,1 WHERE ${exists} ON CONFLICT(product_id,location_id) DO UPDATE SET on_hand_qty=ROUND(on_hand_qty+excluded.on_hand_qty,6),version=version+1`).bind(line.productId, quarantineLocationId, damagedQuantity),
      db.prepare(`INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status) SELECT ?,?,?,?,?,?,0,?,'open' WHERE ${exists}`).bind(newId("layer"), line.productId, damagedMovementId, damagedQuantity, damagedQuantity, line.unitCostCents, now),
      valueEntryPrepared(input, { productId: line.productId, movementId: damagedMovementId, entryType: "receipt", quantity: damagedQuantity, unitCostCents: valuation.unitCostCents, valueCents: damagedValueCents, method: valuation.method, referenceType: "receipt", referenceId: receiptId, postedAt: now, postedBy: actor }),
    );
    for (const allocation of state.supplyAllocations) if (allocation.damagedReceiptQuantity > 0 && allocation.damagedLineageId) commands.push(
      db.prepare(`INSERT INTO supply_allocation_receipts
        (id,supply_allocation_id,receipt_movement_id,reservation_id,quantity,reserved_quantity,reversed_qty,created_at)
        SELECT ?,?,?,NULL,?,0,0,? WHERE ${exists}`)
        .bind(allocation.damagedLineageId, allocation.id, damagedMovementId, allocation.damagedReceiptQuantity, now),
    );
    if (damagedQuantity > 0 && tracking.policy !== "quantity") commands.push(db.prepare(`INSERT INTO movement_assignments (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${exists}`).bind(newId("assignment"), damagedMovementId, tracking.lotId, tracking.unitId, damagedQuantity));
    if (state.approval) commands.push(db.prepare(`UPDATE approvals SET consumed_at=?,consumed_by=?,consumed_entity_id=?,version=version+1 WHERE id=? AND version=? AND status='approved' AND consumed_at IS NULL AND ${exists}`).bind(now, actor, receiptId, state.approval.id, state.approval.version));
  }
  const salesOrderVersions = new Map<string, number>();
  for (const state of states) for (const allocation of state.supplyAllocations) {
    if (allocation.reserveQuantity > 0) salesOrderVersions.set(allocation.salesOrderId, allocation.salesOrderVersion);
  }
  for (const [salesOrderId, salesOrderVersion] of salesOrderVersions) commands.push(
    db.prepare(`UPDATE sales_orders SET version=version+1 WHERE id=? AND version=? AND ${exists}`).bind(salesOrderId, salesOrderVersion),
  );
  commands.push(
    auditPrepared(input, "purchase_order", input.entityId, "batch_receipt_posted", result.message, { receiptId, lineCount: states.length, totalQuantity, totalUsable, automaticallyReserved, inventoryValueCents: totalValueCents }, now),
    outboxPrepared(input, "inventory.batch_receipt_posted", "receipt", receiptId, { purchaseOrderId: input.entityId, lineCount: states.length, totalQuantity, automaticallyReserved, inventoryValueCents: totalValueCents }, now),
  );
  await db.batch(commands);
  return requireLogged(input, "One or more purchase-order lines changed before the batch receipt could post.");
}

async function closeRemainder(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const line = await getPurchaseLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  if (line.lifecycleStatus !== "approved") throw new DomainError("INVALID_STATE", "Only approved purchase-order commitments can be closed.", 409, line.version);
  const quantity = payload.quantity == null ? line.openToReceiveQty : (await normalizedQuantity({ productId: line.productId, quantity: positive(payload), uomId: typeof payload.uomId === "string" ? payload.uomId : null, usage: "purchase", field: "quantity" })).baseQuantity;
  const allocations = await all<{ id: string; version: number; allocated: number; received: number; salesOrderLineId: string; salesOrderId: string; salesOrderVersion: number }>(`SELECT sa.id,sa.version,sa.allocated_qty AS allocated,sa.received_qty AS received,
      sa.sales_order_line_id AS salesOrderLineId,sol.sales_order_id AS salesOrderId,so.version AS salesOrderVersion
    FROM supply_allocations sa JOIN sales_order_lines sol ON sol.id=sa.sales_order_line_id
    JOIN sales_orders so ON so.id=sol.sales_order_id
    WHERE sa.purchase_order_line_id=? AND sa.status='active' AND sa.allocated_qty-sa.received_qty>0
    ORDER BY sa.created_at,sa.id`, line.id);
  const allocatedOpen = roundQuantity(allocations.reduce((sum, allocation) => sum + allocation.allocated - allocation.received, 0));
  const unallocatedOpen = Math.max(roundQuantity(line.openToReceiveQty - allocatedOpen), 0);
  const reason = requiredText(payload, "reason");
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The purchase order changed. Refresh before closing the remainder.", 409, line.version);
  if (quantity > line.openToReceiveQty) throw new DomainError("INVALID_QUANTITY", `Only ${line.openToReceiveQty} units can be closed.`, 409, line.version);
  let allocationReleaseRemaining = roundQuantity(Math.max(quantity - unallocatedOpen, 0));
  const allocationPlans: Array<typeof allocations[number] & { release: number; nextAllocated: number; fullyReleased: boolean }> = [];
  for (const allocation of allocations) {
    if (allocationReleaseRemaining <= 0) break;
    const release = roundQuantity(Math.min(allocationReleaseRemaining, allocation.allocated - allocation.received));
    if (release <= 0) continue;
    const nextAllocated = roundQuantity(allocation.allocated - release);
    allocationPlans.push({ ...allocation, release, nextAllocated, fullyReleased: nextAllocated <= 0 });
    allocationReleaseRemaining = roundQuantity(allocationReleaseRemaining - release);
  }
  if (allocationReleaseRemaining > 0) throw new DomainError("VERSION_CONFLICT", "Dedicated supply changed. Refresh before closing the remainder.", 409, line.version);
  const releasedDedicated = roundQuantity(allocationPlans.reduce((sum, allocation) => sum + allocation.release, 0));
  const result: CommandResult = {
    message: `${quantity} unit${quantity === 1 ? "" : "s"} closed without receipt.`,
    impact: { physical: "On-hand inventory is unchanged.", commercial: `Incoming forecast decreased by ${quantity}.${releasedDedicated ? ` ${releasedDedicated} unit${releasedDedicated === 1 ? "" : "s"} of dedicated customer supply were released for re-sourcing or cancellation.` : ""}`, financial: "No financial posting was created.", onHandDelta: 0, incomingDelta: -quantity, reservedDelta: 0, availableDelta: 0 },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  const now = new Date().toISOString();
  const allocationClaims = allocationPlans.map(() => `AND EXISTS (SELECT 1 FROM supply_allocations sa WHERE sa.id=? AND sa.version=? AND sa.status='active' AND sa.allocated_qty=? AND sa.received_qty=?)`).join(" ");
  const allocationClaimBindings = allocationPlans.flatMap((allocation) => [allocation.id, allocation.version, allocation.allocated, allocation.received]);
  const salesOrderVersions = new Map(allocationPlans.map((allocation) => [allocation.salesOrderId, allocation.salesOrderVersion]));
  const salesOrderClaims = [...salesOrderVersions].map(() => `AND EXISTS (SELECT 1 FROM sales_orders so WHERE so.id=? AND so.version=?)`).join(" ");
  const salesOrderClaimBindings = [...salesOrderVersions].flatMap(([salesOrderId, version]) => [salesOrderId, version]);
  const commands: D1PreparedStatement[] = [
    logPrepared(input, result, "purchase_orders", `AND EXISTS (SELECT 1 FROM purchase_order_lines pol WHERE pol.id=? AND pol.purchase_order_id=purchase_orders.id AND pol.ordered_qty-pol.closed_qty-(CASE WHEN pol.fulfillment_route='drop_ship' THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0) ELSE MAX(COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0),0) END)>=?) ${allocationClaims} ${salesOrderClaims}`, [line.id, quantity, ...allocationClaimBindings, ...salesOrderClaimBindings]),
    db.prepare(`UPDATE purchase_order_lines SET closed_qty = closed_qty + ? WHERE id = ? AND ${exists}`).bind(quantity, line.id),
    db.prepare(`UPDATE purchase_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`).bind(input.entityId, input.version),
    auditPrepared(input, "purchase_order", input.entityId, "remainder_closed", result.message,
      { reason, quantity, lineId: line.id }, now),
    outboxPrepared(input, "purchase_order.remainder_closed", "purchase_order", input.entityId,
      { quantity, lineId: line.id, reason }, now),
  ];
  for (const allocation of allocationPlans) {
    if (allocation.fullyReleased) {
      commands.push(db.prepare(`UPDATE supply_allocations SET status='released',updated_at=?,version=version+1 WHERE id=? AND version=? AND status='active' AND received_qty=0 AND ${exists}`).bind(now, allocation.id, allocation.version));
    } else {
      commands.push(db.prepare(`UPDATE supply_allocations SET allocated_qty=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status='active' AND allocated_qty-received_qty>=? AND ${exists}`).bind(allocation.nextAllocated, now, allocation.id, allocation.version, allocation.release));
    }
    commands.push(db.prepare(`UPDATE sales_order_lines SET linked_purchase_order_line_id=(SELECT active.purchase_order_line_id FROM supply_allocations active WHERE active.sales_order_line_id=sales_order_lines.id AND active.status='active' ORDER BY active.created_at,active.id LIMIT 1) WHERE id=? AND linked_purchase_order_line_id=? AND ${exists}`).bind(allocation.salesOrderLineId, line.id));
  }
  for (const [salesOrderId, version] of salesOrderVersions) commands.push(
    db.prepare(`UPDATE sales_orders SET version=version+1 WHERE id=? AND version=? AND ${exists}`).bind(salesOrderId, version),
  );
  await db.batch(commands);
  return requireLogged(input, "The purchase order changed before the remainder could be closed.");
}

async function reopenRemainder(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const reason = requiredText(payload, "reason");
  const expectedDate = validDateText(requiredText(payload, "expectedDate"), "expectedDate");
  const line = await getPurchaseLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  const quantity = (await normalizedQuantity({ productId: line.productId, quantity: positive(payload), uomId: typeof payload.uomId === "string" ? payload.uomId : null, usage: "purchase", field: "quantity" })).baseQuantity;
  if (line.lifecycleStatus !== "approved") throw new DomainError("INVALID_STATE", "Only approved purchase-order commitments can be reopened.", 409, line.version);
  if (line.fulfillmentRoute !== "stock") throw new DomainError("FULFILLMENT_ROUTE_BLOCKED", "Closed dedicated-supply quantity cannot be reopened without restoring its customer allocation. Create a new linked purchase-order line instead.", 409, line.version);
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The purchase order changed. Refresh before reopening quantity.", 409, line.version);
  if (quantity > line.closedQty) throw new DomainError("INVALID_QUANTITY", `Only ${line.closedQty} closed units can be reopened.`, 409, line.version);
  const result: CommandResult = {
    message: `${quantity} unit${quantity === 1 ? "" : "s"} reopened for receipt.`,
    impact: { physical: "On-hand inventory is unchanged.", commercial: `Incoming forecast increased by ${quantity}.`, financial: "No financial posting was created.", onHandDelta: 0, incomingDelta: quantity, reservedDelta: 0, availableDelta: 0 },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  const now = new Date().toISOString();
  const commands: D1PreparedStatement[] = [
    logPrepared(input, result, "purchase_orders"),
    db.prepare(`UPDATE purchase_order_lines SET closed_qty = closed_qty - ? WHERE id = ? AND ${exists}`).bind(quantity, line.id),
    db.prepare(`UPDATE purchase_orders SET version = version + 1, expected_date = ? WHERE id = ? AND version = ? AND ${exists}`).bind(expectedDate, input.entityId, input.version),
    auditPrepared(input, "purchase_order", input.entityId, "remainder_reopened", result.message,
      { reason, expectedDate, quantity, lineId: line.id }, now),
    outboxPrepared(input, "purchase_order.remainder_reopened", "purchase_order", input.entityId,
      { quantity, lineId: line.id, reason, expectedDate }, now),
  ];
  await db.batch(commands);
  return requireLogged(input, "The purchase order changed before quantity could be reopened.");
}

async function reverseReceipt(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const enteredQuantity = positive(payload);
  const reason = requiredText(payload, "reason");
  const disposition = optionalText(payload, "disposition", "reopen");
  if (!["reopen", "close"].includes(disposition)) throw new DomainError("VALIDATION_ERROR", "disposition must be reopen or close.");
  const receipt = await first<{ id: string; purchaseOrderId: string; version: number }>(
    "SELECT id, purchase_order_id AS purchaseOrderId, version FROM receipts WHERE id = ?",
    input.entityId
  );
  if (!receipt) throw new DomainError("NOT_FOUND", "Receipt was not found.", 404);
  if (receipt.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The receipt changed. Refresh before reversing it.", 409, receipt.version);
  // A split receipt posts one movement per condition (usable bin, quarantine bin). The caller
  // may target the movement by inventoryStatus and/or receiptLineId; otherwise the movement
  // with the most physically reversible stock is chosen, which is what the snapshot advertises.
  const requestedStatus = typeof payload.inventoryStatus === "string" && payload.inventoryStatus.trim() ? payload.inventoryStatus.trim().toLowerCase() : null;
  if (requestedStatus && !["usable", "quarantine", "damaged"].includes(requestedStatus)) throw new DomainError("VALIDATION_ERROR", "inventoryStatus must be usable, quarantine, or damaged.");
  const requestedReceiptLineId = typeof payload.receiptLineId === "string" && payload.receiptLineId.trim() ? payload.receiptLineId.trim() : null;
  const requestedLineId = typeof payload.lineId === "string" && payload.lineId.trim() ? payload.lineId.trim() : null;
  const source = await first<{ movementId: string; receiptLineId: string; poLineId: string; productId: string; locationId: string; inventoryStatus: string; unitCostCents: number; remainingQty: number; availableQty: number }>(
    `SELECT sm.id AS movementId, sm.source_line_id AS receiptLineId, sm.purchase_order_line_id AS poLineId,
            sm.product_id AS productId, sm.to_location_id AS locationId, sm.inventory_status AS inventoryStatus,
            sm.unit_cost_cents AS unitCostCents,
            sm.quantity + COALESCE(SUM(rev.quantity), 0) AS remainingQty,
            COALESCE((SELECT ib.on_hand_qty - ib.reserved_qty FROM inventory_balances ib
                       WHERE ib.product_id = sm.product_id AND ib.location_id = sm.to_location_id), 0)
            + COALESCE((SELECT SUM(MIN(r.quantity, sar.quantity - sar.reversed_qty)) FROM supply_allocation_receipts sar
                         JOIN reservations r ON r.id = sar.reservation_id AND r.status = 'active'
                        WHERE sar.receipt_movement_id = sm.id), 0) AS availableQty
       FROM stock_movements sm
       LEFT JOIN stock_movements rev ON rev.reversal_of_movement_id = sm.id AND rev.movement_type = 'receipt_reversal'
      WHERE sm.source_document_type = 'receipt' AND sm.source_document_id = ?
        AND (? IS NULL OR sm.source_line_id = ? OR sm.purchase_order_line_id = ?)
        AND (? IS NULL OR sm.inventory_status = ? OR EXISTS (SELECT 1 FROM locations l WHERE l.id = sm.to_location_id AND l.inventory_status = ?))
        AND (? IS NULL OR sm.source_line_id = ?)
      GROUP BY sm.id HAVING remainingQty > 0
      ORDER BY MIN(remainingQty, availableQty) DESC, remainingQty DESC, sm.id LIMIT 1`,
    input.entityId,
    requestedLineId, requestedLineId, requestedLineId,
    requestedStatus, requestedStatus, requestedStatus,
    requestedReceiptLineId, requestedReceiptLineId,
  );
  if (!source) throw new DomainError("NOT_REVERSIBLE", requestedStatus || requestedReceiptLineId ? "No remaining receipt quantity matches the requested inventory status or receipt line." : "This receipt has no remaining quantity to reverse.", 409, receipt.version);
  const quantity = (await normalizedQuantity({ productId: source.productId, quantity: enteredQuantity, uomId: typeof payload.uomId === "string" ? payload.uomId : null, usage: "purchase", field: "quantity" })).baseQuantity;
  if (quantity > source.remainingQty) throw new DomainError("INVALID_QUANTITY", `Only ${source.remainingQty} units remain reversible${requestedStatus ? ` in ${requestedStatus} condition` : ""}.`, 409, receipt.version);
  const allocationReceiptRows = await all<{
    id: string; allocationId: string; allocationVersion: number; quantity: number; reversedQty: number;
    reservationId: string | null; reservationQuantity: number; reservationStatus: string | null;
    salesOrderId: string; salesOrderVersion: number;
  }>(`SELECT sar.id,sar.supply_allocation_id AS allocationId,sa.version AS allocationVersion,
      sar.quantity,sar.reversed_qty AS reversedQty,sar.reservation_id AS reservationId,
      COALESCE(r.quantity,0) AS reservationQuantity,r.status AS reservationStatus,
      sol.sales_order_id AS salesOrderId,so.version AS salesOrderVersion
    FROM supply_allocation_receipts sar
    JOIN supply_allocations sa ON sa.id=sar.supply_allocation_id
    JOIN sales_order_lines sol ON sol.id=sa.sales_order_line_id
    JOIN sales_orders so ON so.id=sol.sales_order_id
    LEFT JOIN reservations r ON r.id=sar.reservation_id
    WHERE sar.receipt_movement_id=? AND sar.quantity>sar.reversed_qty
    ORDER BY sar.created_at DESC,sar.id DESC`, source.movementId);
  const allocatedRemaining = roundQuantity(allocationReceiptRows.reduce((sum, row) => sum + Number(row.quantity) - Number(row.reversedQty), 0));
  const unallocatedRemaining = Math.max(roundQuantity(source.remainingQty - allocatedRemaining), 0);
  let allocatedReversalRemaining = Math.max(roundQuantity(quantity - unallocatedRemaining), 0);
  const allocationReversals: Array<typeof allocationReceiptRows[number] & { reverseQuantity: number; releaseQuantity: number }> = [];
  for (const row of allocationReceiptRows) {
    if (allocatedReversalRemaining <= 0) break;
    const rowRemaining = roundQuantity(Number(row.quantity) - Number(row.reversedQty));
    const reverseQuantity = roundQuantity(Math.min(rowRemaining, allocatedReversalRemaining));
    const activeReservation = row.reservationStatus === "active" ? Math.min(Number(row.reservationQuantity), rowRemaining) : 0;
    const unreservedQuantity = Math.max(roundQuantity(rowRemaining - activeReservation), 0);
    const releaseQuantity = roundQuantity(Math.min(activeReservation, Math.max(reverseQuantity - unreservedQuantity, 0)));
    allocationReversals.push({ ...row, reverseQuantity, releaseQuantity });
    allocatedReversalRemaining = roundQuantity(allocatedReversalRemaining - reverseQuantity);
  }
  if (allocatedReversalRemaining > 0) throw new DomainError("SUPPLY_ALLOCATION_LINEAGE_MISMATCH", "Receipt allocation lineage cannot account for the requested reversal.", 409, receipt.version);
  const automaticallyReleased = roundQuantity(allocationReversals.reduce((sum, reversal) => sum + reversal.releaseQuantity, 0));
  const layer = await first<{
    id: string;
    receivedQty: number;
    remainingQty: number;
    unitCostCents: number;
    landedCostCents: number;
    costMethod: string;
    priorReversedQty: number;
    priorReversedValueCents: number;
  }>(`SELECT cl.id, cl.received_qty AS receivedQty, cl.remaining_qty AS remainingQty,
             cl.unit_cost_cents AS unitCostCents, cl.landed_cost_cents AS landedCostCents,
             COALESCE((SELECT ive.cost_method FROM inventory_value_entries ive
                        WHERE ive.movement_id = sm.id AND ive.entry_type = 'receipt' LIMIT 1), 'fifo') AS costMethod,
             COALESCE((SELECT SUM(-rev.quantity) FROM stock_movements rev
                        WHERE rev.reversal_of_movement_id = sm.id AND rev.movement_type = 'receipt_reversal'), 0) AS priorReversedQty,
             COALESCE((SELECT SUM(-ive.value_cents) FROM stock_movements rev
                        JOIN inventory_value_entries ive ON ive.movement_id = rev.id
                       WHERE rev.reversal_of_movement_id = sm.id AND rev.movement_type = 'receipt_reversal'
                         AND ive.entry_type = 'receipt_reversal'), 0) AS priorReversedValueCents
        FROM stock_movements sm
        JOIN cost_layers cl ON cl.receipt_movement_id = sm.id
       WHERE sm.id = ?
       ORDER BY cl.id LIMIT 1`, source.movementId);
  if (!layer) throw new DomainError("VALUATION_LINEAGE_MISSING", "The original receipt cost layer is missing; reversal is blocked to protect valuation integrity.", 409);
  // Units physically on the shelf can always come back off it. When FIFO already spent this
  // receipt's own layer on a shipment elsewhere, the remainder is funded from the product's
  // other open layers and the cost difference is posted as a variance, so the value ledger
  // and the layer ledger move by the same amount.
  const ownLayerQuantity = roundQuantity(Math.min(quantity, Math.max(Number(layer.remainingQty), 0)));
  const otherLayerQuantity = roundQuantity(quantity - ownLayerQuantity);
  const otherLayers = otherLayerQuantity > 0
    ? await openLayersForIssue(source.productId, otherLayerQuantity, layer.id)
    : { layers: [] as CostLayerAllocation[], valueCents: 0, shortfall: 0 };
  if (otherLayers.shortfall > 0) {
    throw new DomainError("RECEIPT_LAYER_CONSUMED", `Only ${layer.remainingQty} units remain in this receipt's original cost layer and the product's other open layers cannot fund the remaining ${otherLayers.shortfall}; reverse a smaller quantity.`, 409);
  }
  const blockingBill = await first<{ number: string; status: string; matchStatus: string }>(`SELECT vb.number,vb.status,vb.match_status AS matchStatus
      FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id
     WHERE vbl.purchase_order_line_id=? AND vb.status<>'void'
       AND (vb.match_status='matched' OR vb.status IN ('approved','partially_paid','paid'))
     LIMIT 1`, source.poLineId);
  if (blockingBill) throw new DomainError("RECEIPT_REVERSAL_AP_CONFLICT", `Receipt reversal is blocked by ${blockingBill.number} (${blockingBill.status}/${blockingBill.matchStatus}). Correct or credit the vendor bill first.`, 409, receipt.version);
  const balance = await first<{ onHandQty: number; reservedQty: number }>("SELECT on_hand_qty AS onHandQty, reserved_qty AS reservedQty FROM inventory_balances WHERE product_id = ? AND location_id = ?", source.productId, source.locationId);
  if (!balance || balance.onHandQty - balance.reservedQty + automaticallyReleased < quantity) throw new DomainError("INSUFFICIENT_STOCK", "The source location no longer holds enough stock outside unrelated reservations for this reversal.", 409, receipt.version);
  const tracking = await receiptReversalTracking(source.movementId, source.productId, source.locationId, source.inventoryStatus, quantity);
  if (tracking.policy !== "quantity") {
    const assigned = await first<{ quantity: number }>(`SELECT COALESCE((SELECT SUM(ma.quantity) FROM movement_assignments ma WHERE ma.movement_id=? AND ((? IS NOT NULL AND ma.lot_id=?) OR (? IS NOT NULL AND ma.inventory_unit_id=?))),0)
        -COALESCE((SELECT SUM(reversal_assignment.quantity) FROM stock_movements reversal JOIN movement_assignments reversal_assignment ON reversal_assignment.movement_id=reversal.id WHERE reversal.reversal_of_movement_id=? AND reversal.movement_type='receipt_reversal' AND ((? IS NOT NULL AND reversal_assignment.lot_id=?) OR (? IS NOT NULL AND reversal_assignment.inventory_unit_id=?))),0) AS quantity`, source.movementId, tracking.lotId, tracking.lotId, tracking.unitId, tracking.unitId, source.movementId, tracking.lotId, tracking.lotId, tracking.unitId, tracking.unitId);
    if (Number(assigned?.quantity ?? 0) < quantity) throw new DomainError("RECEIPT_ASSIGNMENT_MISMATCH", "The selected lot or serial was not received on this exact receipt movement, or has already been reversed.", 409);
  }
  const totalLayerValueCents = Math.round(layer.receivedQty * layer.unitCostCents) + layer.landedCostCents;
  const consumedByOtherPostingsQty = roundQuantity(layer.receivedQty - layer.remainingQty - layer.priorReversedQty);
  const consumedByOtherPostingsValueCents = Math.round(totalLayerValueCents * consumedByOtherPostingsQty / layer.receivedQty);
  const remainingLayerValueCents = totalLayerValueCents - consumedByOtherPostingsValueCents - layer.priorReversedValueCents;
  // The reversal itself is always valued at the original receipt cost (including landed cost).
  const ownLayerValueCents = ownLayerQuantity <= 0 ? 0
    : ownLayerQuantity === layer.remainingQty ? remainingLayerValueCents
    : Math.round(totalLayerValueCents * ownLayerQuantity / layer.receivedQty);
  const otherAtReceiptCostCents = Math.round(totalLayerValueCents * otherLayerQuantity / layer.receivedQty);
  const valueCents = ownLayerValueCents + otherAtReceiptCostCents;
  if (valueCents < 0) throw new DomainError("VALUATION_LINEAGE_INVALID", "The original receipt layer has inconsistent reversal value history.", 409);
  // What the layer ledger actually gives up, and the balancing variance between that and the
  // receipt-cost reversal entry. Reversal + variance always equals the layer value removed.
  const layerValueRemovedCents = ownLayerValueCents + otherLayers.valueCents;
  const costVarianceCents = otherAtReceiptCostCents - otherLayers.valueCents;
  const unitCostCents = quantity > 0 ? Math.round(valueCents / quantity) : 0;
  const costMethod = (["fifo", "average", "standard"].includes(layer.costMethod) ? layer.costMethod : "fifo") as ValuationMethod;
  const policy = await valuationPolicy(source.productId);
  const totalBalance = await first<{ onHandQty: number }>(
    "SELECT COALESCE(SUM(on_hand_qty), 0) AS onHandQty FROM inventory_balances WHERE product_id = ?",
    source.productId
  );
  const totalOnHandQty = Number(totalBalance?.onHandQty ?? 0);
  const nextAverageCostCents = policy.method === "average"
    ? totalOnHandQty - quantity > 0
      ? Math.max(0, Math.round(((totalOnHandQty * policy.averageCostCents) - layerValueRemovedCents) / (totalOnHandQty - quantity)))
      : 0
    : policy.averageCostCents;
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const movementId = newId("movement");
  const result: CommandResult = {
    message: `${quantity} unit${quantity === 1 ? "" : "s"} reversed from the posted receipt.`,
    impact: { physical: `${quantity} units removed from ${source.inventoryStatus} on-hand inventory.`, commercial: `${disposition === "reopen" ? `Open incoming increased by ${quantity}.` : `${quantity} units were closed without replacement supply.`}${automaticallyReleased ? ` ${automaticallyReleased} linked reservation units were released.` : ""}`, financial: `Inventory value decreased by ${layerValueRemovedCents} cents (${valueCents} cents at the original receipt cost including landed cost${costVarianceCents ? `, ${costVarianceCents > 0 ? "plus" : "less"} a ${Math.abs(costVarianceCents)} cent cost variance because ${otherLayerQuantity} units were funded from other cost layers` : ""}); AP compatibility was verified before posting.`, onHandDelta: -quantity, incomingDelta: disposition === "reopen" ? quantity : 0, reservedDelta: -automaticallyReleased, availableDelta: roundQuantity(-quantity + automaticallyReleased) },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  const now = postingTimestamp(payload);
  const allocationReversalClaimSql = allocationReversals.map(() => `
       AND EXISTS (SELECT 1 FROM supply_allocation_receipts sar WHERE sar.id=? AND sar.quantity-sar.reversed_qty>=?)
       AND EXISTS (SELECT 1 FROM supply_allocations sa WHERE sa.id=? AND sa.version=? AND sa.received_qty>=?)`).join("");
  const reservationReleaseClaimSql = allocationReversals.filter((reversal) => reversal.releaseQuantity > 0).map(() => `
       AND EXISTS (SELECT 1 FROM reservations r WHERE r.id=? AND r.status='active' AND r.quantity>=?)`).join("");
  const salesOrderReleaseClaimSql = [...new Map(allocationReversals.filter((reversal) => reversal.releaseQuantity > 0)
    .map((reversal) => [reversal.salesOrderId, reversal.salesOrderVersion])).entries()].map(() => `
       AND EXISTS (SELECT 1 FROM sales_orders so WHERE so.id=? AND so.version=?)`).join("");
  const salesOrderReleaseClaimBindings = [...new Map(allocationReversals.filter((reversal) => reversal.releaseQuantity > 0)
    .map((reversal) => [reversal.salesOrderId, reversal.salesOrderVersion])).entries()].flatMap(([salesOrderId, salesOrderVersion]) => [salesOrderId, salesOrderVersion]);
  const commands: D1PreparedStatement[] = [
    logPrepared(input, result, "receipts",
      `AND EXISTS (SELECT 1 FROM inventory_balances WHERE product_id = ? AND location_id = ? AND on_hand_qty - reserved_qty + ? >= ? - ${QTY_EPSILON})
       AND EXISTS (SELECT 1 FROM cost_layers WHERE id = ? AND receipt_movement_id = ? AND remaining_qty >= ? - ${QTY_EPSILON})
       ${layerClaimPredicate(otherLayers.layers)}
       AND NOT EXISTS (SELECT 1 FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id WHERE vbl.purchase_order_line_id=? AND vb.status<>'void' AND (vb.match_status='matched' OR vb.status IN ('approved','partially_paid','paid')))
       AND (SELECT COALESCE(SUM(on_hand_qty), 0) FROM inventory_balances WHERE product_id = ?) = ?
        AND COALESCE((SELECT version FROM valuation_policies WHERE product_id = ?), 0) = ?${tracking.claimSql}
        ${tracking.policy === "quantity" ? "" : "AND COALESCE((SELECT SUM(ma.quantity) FROM movement_assignments ma WHERE ma.movement_id=? AND ((? IS NOT NULL AND ma.lot_id=?) OR (? IS NOT NULL AND ma.inventory_unit_id=?))),0)-COALESCE((SELECT SUM(ra.quantity) FROM stock_movements rev JOIN movement_assignments ra ON ra.movement_id=rev.id WHERE rev.reversal_of_movement_id=? AND rev.movement_type='receipt_reversal' AND ((? IS NOT NULL AND ra.lot_id=?) OR (? IS NOT NULL AND ra.inventory_unit_id=?))),0)>=?"}${allocationReversalClaimSql}${reservationReleaseClaimSql}${salesOrderReleaseClaimSql}`,
      [source.productId, source.locationId, automaticallyReleased, quantity, layer.id, source.movementId, ownLayerQuantity, ...layerClaimBindings(otherLayers.layers), source.poLineId,
        source.productId, totalOnHandQty, source.productId, policy.version, ...tracking.claimBindings,
        ...(tracking.policy === "quantity" ? [] : [source.movementId, tracking.lotId, tracking.lotId, tracking.unitId, tracking.unitId, source.movementId, tracking.lotId, tracking.lotId, tracking.unitId, tracking.unitId, quantity]),
        ...allocationReversals.flatMap((reversal) => [reversal.id, reversal.reverseQuantity, reversal.allocationId, reversal.allocationVersion, reversal.reverseQuantity]),
        ...allocationReversals.filter((reversal) => reversal.releaseQuantity > 0).flatMap((reversal) => [reversal.reservationId, reversal.releaseQuantity]),
        ...salesOrderReleaseClaimBindings]),
    db.prepare(`UPDATE receipts SET version = version + 1, status = CASE WHEN NOT EXISTS (
      SELECT 1 FROM stock_movements original
      WHERE original.source_document_type='receipt' AND original.source_document_id=receipts.id AND original.movement_type='purchase_receipt'
        AND original.quantity + COALESCE((SELECT SUM(reversal.quantity) FROM stock_movements reversal
          WHERE reversal.reversal_of_movement_id=original.id AND reversal.movement_type='receipt_reversal'),0)
          - CASE WHEN original.id=? THEN ? ELSE 0 END > 0
      ) THEN 'reversed' ELSE 'partially_reversed' END
                WHERE id = ? AND version = ? AND ${exists}`).bind(source.movementId, quantity, input.entityId, input.version),
    db.prepare(`UPDATE purchase_orders SET version = version + 1 WHERE id = ? AND ${exists}`).bind(receipt.purchaseOrderId),
    ...(disposition === "close" ? [db.prepare(`UPDATE purchase_order_lines SET closed_qty=closed_qty+? WHERE id=? AND ${exists}`).bind(quantity, source.poLineId)] : []),
    ...allocationReversals.flatMap((reversal) => [
      ...(reversal.releaseQuantity > 0 && reversal.reservationId ? [
        db.prepare(`UPDATE reservations SET quantity=MAX(${qtyMinus("quantity")},0),status=CASE WHEN ${qtyDrained("quantity")} THEN 'released' ELSE 'active' END
          WHERE id=? AND status='active' AND ${qtyAtLeast("quantity")} AND ${exists}`)
          .bind(reversal.releaseQuantity, reversal.releaseQuantity, reversal.reservationId, reversal.releaseQuantity),
        db.prepare(`UPDATE inventory_balances SET reserved_qty=MAX(${qtyMinus("reserved_qty")},0),version=version+1
          WHERE product_id=? AND location_id=? AND ${qtyAtLeast("reserved_qty")} AND ${exists}`)
          .bind(reversal.releaseQuantity, source.productId, source.locationId, reversal.releaseQuantity),
      ] : []),
      db.prepare(`UPDATE supply_allocation_receipts SET reversed_qty=reversed_qty+?
        WHERE id=? AND quantity-reversed_qty>=? AND ${exists}`)
        .bind(reversal.reverseQuantity, reversal.id, reversal.reverseQuantity),
      db.prepare(`UPDATE supply_allocations SET received_qty=received_qty-?,updated_at=?,version=version+1
        WHERE id=? AND version=? AND received_qty>=? AND ${exists}`)
        .bind(reversal.reverseQuantity, now, reversal.allocationId, reversal.allocationVersion, reversal.reverseQuantity),
    ]),
    ...[...new Map(allocationReversals.filter((reversal) => reversal.releaseQuantity > 0)
      .map((reversal) => [reversal.salesOrderId, reversal.salesOrderVersion])).entries()].map(([salesOrderId, salesOrderVersion]) =>
      db.prepare(`UPDATE sales_orders SET version=version+1 WHERE id=? AND version=? AND ${exists}`).bind(salesOrderId, salesOrderVersion)),
    db.prepare(`UPDATE inventory_balances SET on_hand_qty = ${qtyMinus("on_hand_qty")}, version = version + 1
                WHERE product_id = ? AND location_id = ? AND ${qtyAtLeast("on_hand_qty - reserved_qty")} AND ${exists}`).bind(quantity, source.productId, source.locationId, quantity),
    db.prepare(`INSERT INTO stock_movements
      (id, movement_type, product_id, quantity, from_location_id, inventory_status, source_document_type,
       source_document_id, source_line_id, purchase_order_line_id, reversal_of_movement_id,
       posted_at, posted_by, unit_cost_cents, idempotency_key)
       SELECT ?, 'receipt_reversal', ?, ?, ?, ?, 'receipt_reversal', ?, ?, ?, ?, ?, ?, ?, ? WHERE ${exists}`)
      .bind(movementId, source.productId, -quantity, source.locationId, source.inventoryStatus, input.entityId, source.receiptLineId, source.poLineId, source.movementId, now, actor, unitCostCents, input.idempotencyKey),
    valueEntryPrepared(input, { productId: source.productId, movementId, entryType: "receipt_reversal",
      quantity: -quantity, unitCostCents, valueCents: -valueCents,
      method: costMethod, referenceType: "receipt", referenceId: input.entityId, postedAt: now, postedBy: actor }),
    ...(costVarianceCents !== 0 ? [valueEntryPrepared(input, { productId: source.productId, movementId, entryType: "cost_variance",
      quantity: 0, unitCostCents: 0, valueCents: costVarianceCents,
      method: costMethod, referenceType: "receipt", referenceId: input.entityId, postedAt: now, postedBy: actor })] : []),
    ...(ownLayerQuantity > 0 ? [db.prepare(`UPDATE cost_layers
      SET remaining_qty = MAX(${qtyMinus("remaining_qty")}, 0), status = CASE WHEN ${qtyDrained("remaining_qty")} THEN 'consumed' ELSE 'open' END
      WHERE id = ? AND receipt_movement_id = ? AND ${qtyAtLeast("remaining_qty")} AND ${exists}`)
      .bind(ownLayerQuantity, ownLayerQuantity, layer.id, source.movementId, ownLayerQuantity)] : []),
    ...layerConsumptionPrepared(input, otherLayers.layers),
    auditPrepared(input, "receipt", input.entityId, "receipt_reversed", result.message,
      { reason, disposition, quantity, movementId, sourceMovementId: source.movementId, costLayerId: layer.id, inventoryStatus: source.inventoryStatus,
        baseCostCents: Math.round(quantity * layer.unitCostCents), landedCostIncludedCents: valueCents - Math.round(quantity * layer.unitCostCents),
        inventoryValueCents: -layerValueRemovedCents, receiptCostValueCents: -valueCents, costVarianceCents,
        otherLayerQuantity, otherLayerIds: otherLayers.layers.map((other) => other.id),
        costMethod, automaticallyReleased, apIntegrityChecked: true }, now),
    outboxPrepared(input, "inventory.receipt_reversed", "receipt", input.entityId,
      { movementId, sourceMovementId: source.movementId, costLayerId: layer.id, productId: source.productId, inventoryStatus: source.inventoryStatus,
        disposition, quantity, automaticallyReleased, inventoryValueCents: -layerValueRemovedCents, costVarianceCents }, now),
  ];
  if (policy.method === "average") {
    commands.push(db.prepare(`UPDATE valuation_policies
      SET average_cost_cents = ?, version = version + 1, updated_at = ?, updated_by = ?
      WHERE product_id = ? AND version = ? AND method = 'average' AND ${exists}`)
      .bind(nextAverageCostCents, now, actor, source.productId, policy.version));
  }
  if (tracking.policy !== "quantity") commands.push(db.prepare(`INSERT INTO movement_assignments (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${exists}`).bind(newId("assignment"), movementId, tracking.lotId, tracking.unitId, quantity));
  if (tracking.policy === "serial") commands.push(db.prepare(`UPDATE inventory_units SET lifecycle_status='receipt_reversed',version=version+1 WHERE id=? AND product_id=? AND location_id=? AND lifecycle_status='on_hand' AND version=? AND ${exists}`).bind(tracking.unitId, source.productId, source.locationId, tracking.unitVersion));
  await db.batch(commands);
  return requireLogged(input, "The receipt changed before it could be reversed.");
}

async function postVendorReturn(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const reason = requiredText(payload, "reason");
  const disposition = optionalText(payload, "disposition", payload.replacementExpected === true ? "replacement" : "refund");
  if (!["replacement", "refund", "repair"].includes(disposition)) throw new DomainError("VALIDATION_ERROR", "disposition must be replacement, refund, or repair.");
  const replacementExpected = disposition === "replacement" || disposition === "repair";
  const line = await getPurchaseLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  const quantity = (await normalizedQuantity({ productId: line.productId, quantity: positive(payload), uomId: typeof payload.uomId === "string" ? payload.uomId : null, usage: "purchase", field: "quantity" })).baseQuantity;
  if (line.lifecycleStatus !== "approved") throw new DomainError("INVALID_STATE", "Vendor returns require an approved purchase order with posted receipts.", 409, line.version);
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The purchase order changed. Refresh before posting the vendor return.", 409, line.version);
  if (quantity > line.netReceivedQty) throw new DomainError("INVALID_QUANTITY", `Only ${line.netReceivedQty} net received units can be returned.`, 409, line.version);
  const locationId = requiredText(payload, "locationId");
  // Damaged receipts sit in quarantine or damaged bins, and those are exactly the units that go
  // back to the vendor, so every stock-holding status except in-transit is a valid source.
  const location = await requireActiveLocation(locationId, ["usable", "quarantine", "damaged"], "vendor-return inventory");
  const inventoryStatus = location.inventoryStatus;
  // Serial units record quarantine and damaged stock alike as 'quarantine'.
  const unitStatus = inventoryStatus === "usable" ? "usable" : "quarantine";
  const balance = await first<{ onHandQty: number; reservedQty: number }>("SELECT on_hand_qty AS onHandQty, reserved_qty AS reservedQty FROM inventory_balances WHERE product_id = ? AND location_id = ?", line.productId, locationId);
  if (!balance || balance.onHandQty - balance.reservedQty + 0.000001 < quantity) throw new DomainError("INSUFFICIENT_STOCK", "Not enough unreserved stock exists at the selected location.", 409, line.version);
  const tracking = await outgoingTracking(line.productId, locationId, quantity, payload, unitStatus);
  const valuation = await valuationForIssue(line.productId, quantity);
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const returnId = newId("vendor-return");
  const movementId = newId("movement");
  const returnNumber = await nextDocumentNumber("VRT");
  const now = postingTimestamp(payload);
  const result: CommandResult = {
    message: `${returnNumber} posted for ${quantity} unit${quantity === 1 ? "" : "s"}.`,
    impact: {
      physical: `${quantity} units removed from ${inventoryStatus} on-hand inventory at ${location.code}.`,
      commercial: disposition === "repair" ? `${quantity} units are open to receive back after repair.` : replacementExpected ? `${quantity} units are open to receive as replacement.` : `${quantity} units marked not expected; no replacement incoming.`,
      financial: `${replacementExpected ? "No credit assumed; replacement or repaired stock is expected." : "Vendor credit is expected but not yet posted."} Inventory value decreased by ${valuation.valueCents} cents.`,
      onHandDelta: -quantity,
      incomingDelta: replacementExpected ? quantity : 0,
      reservedDelta: 0,
      availableDelta: -quantity,
    },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  const commands: D1PreparedStatement[] = [
    logPrepared(input, result, "purchase_orders",
      `AND EXISTS (SELECT 1 FROM inventory_balances WHERE product_id = ? AND location_id = ? AND ${qtyAtLeast("on_hand_qty - reserved_qty")})
       AND EXISTS (SELECT 1 FROM locations WHERE id = ? AND active = 1 AND inventory_status = ?) ${layerClaimPredicate(valuation.layers)}${tracking.claimSql}`,
      [line.productId, locationId, quantity, locationId, inventoryStatus, ...layerClaimBindings(valuation.layers), ...tracking.claimBindings]),
    db.prepare(`UPDATE purchase_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`).bind(input.entityId, input.version),
  ];
  if (!replacementExpected) commands.push(db.prepare(`UPDATE purchase_order_lines SET closed_qty = closed_qty + ? WHERE id = ? AND ${exists}`).bind(quantity, line.id));
  commands.push(
    db.prepare(`UPDATE inventory_balances SET on_hand_qty = ${qtyMinus("on_hand_qty")}, version = version + 1
                WHERE product_id = ? AND location_id = ? AND ${qtyAtLeast("on_hand_qty - reserved_qty")} AND ${exists}`).bind(quantity, line.productId, locationId, quantity),
    db.prepare(`INSERT INTO vendor_returns
      (id, number, purchase_order_id, purchase_order_line_id, product_id, location_id, quantity, disposition, posted_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${exists}`)
      .bind(returnId, returnNumber, input.entityId, line.id, line.productId, locationId, quantity, disposition, now),
    db.prepare(`INSERT INTO stock_movements
      (id, movement_type, product_id, quantity, from_location_id, inventory_status, source_document_type,
       source_document_id, purchase_order_line_id, posted_at, posted_by, unit_cost_cents, idempotency_key)
      SELECT ?, 'vendor_return', ?, ?, ?, ?, 'vendor_return', ?, ?, ?, ?, ?, ? WHERE ${exists}`)
      .bind(movementId, line.productId, -quantity, locationId, inventoryStatus, returnId, line.id, now, actor, valuation.unitCostCents, input.idempotencyKey),
    valueEntryPrepared(input, { productId: line.productId, movementId, entryType: "vendor_return",
      quantity: -quantity, unitCostCents: valuation.unitCostCents, valueCents: -valuation.valueCents,
      method: valuation.method, referenceType: "vendor_return", referenceId: returnId, postedAt: now, postedBy: actor }),
    ...layerConsumptionPrepared(input, valuation.layers),
    auditPrepared(input, "purchase_order", input.entityId, "vendor_return_posted", result.message,
      { reason, disposition, replacementExpected, quantity, returnId, inventoryValueCents: -valuation.valueCents, costMethod: valuation.method }, now),
    outboxPrepared(input, "inventory.vendor_return_posted", "vendor_return", returnId,
      { purchaseOrderId: input.entityId, productId: line.productId, quantity, replacementExpected, inventoryValueCents: -valuation.valueCents }, now)
  );
  if (tracking.policy !== "quantity") commands.push(db.prepare(`INSERT INTO movement_assignments (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${exists}`).bind(newId("assignment"), movementId, tracking.lotId, tracking.unitId, quantity));
  if (tracking.policy === "serial") commands.push(db.prepare(`UPDATE inventory_units SET lifecycle_status='returned_to_vendor',version=version+1 WHERE id=? AND product_id=? AND location_id=? AND lifecycle_status='on_hand' AND version=? AND ${exists}`).bind(tracking.unitId, line.productId, locationId, tracking.unitVersion));
  await db.batch(commands);
  return requireLogged(input, "The purchase order changed before the vendor return could be posted.");
}

async function postPriceOnlyCredit(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const reason = requiredText(payload, "reason");
  const amountCents = payload.amountCents == null ? 0 : Math.round(asNumber(payload, "amountCents"));
  if (amountCents < 0) throw new DomainError("VALIDATION_ERROR", "amountCents cannot be negative.");
  const order = await first<{ version: number; currency: string }>(
    "SELECT version, currency FROM purchase_orders WHERE id = ?",
    input.entityId
  );
  if (!order) throw new DomainError("NOT_FOUND", "Purchase order was not found.", 404);
  if (order.version !== input.version) {
    throw new DomainError("VERSION_CONFLICT", "The purchase order changed. Refresh before recording the price allowance.", 409, order.version);
  }
  const formatAmount = () => {
    // A malformed currency code on the order must not turn an allowance into a 500.
    try { return new Intl.NumberFormat("en-CA", { style: "currency", currency: order.currency }).format(amountCents / 100); }
    catch { return `${(amountCents / 100).toFixed(2)} ${order.currency}`; }
  };
  const amountLabel = amountCents > 0 ? formatAmount() : "An unvalued allowance";
  const result: CommandResult = {
    message: `${amountLabel} price-only vendor allowance recorded.`,
    impact: {
      physical: "On-hand inventory and the movement ledger are unchanged.",
      commercial: "Ordered, received, closed, and incoming quantities are unchanged.",
      financial: amountCents > 0 ? `Expected vendor credit: ${amountLabel}.` : "A vendor credit is expected; amount is pending.",
      onHandDelta: 0,
      incomingDelta: 0,
      reservedDelta: 0,
      availableDelta: 0,
    },
  };
  const db = commandD1(input);
  const now = postingTimestamp(payload);
  await db.batch([
    logPrepared(input, result, "purchase_orders"),
    auditPrepared(input, "purchase_order", input.entityId, "price_only_credit_recorded", result.message,
      { reason, amountCents, currency: order.currency }, now),
    outboxPrepared(input, "purchase_order.price_allowance_recorded", "purchase_order", input.entityId,
      { reason, amountCents, currency: order.currency }, now),
  ]);
  return requireLogged(input, "The purchase order changed before the price allowance could be recorded.");
}

type SalesLineState = {
  id: string; salesOrderId: string; productId: string; orderedQty: number; canceledQty: number;
  version: number; lifecycleStatus: string; shippedQty: number; returnedQty: number; reservedQty: number;
  fulfillmentRoute: string; linkedPurchaseOrderLineId: string | null;
  shipToName: string | null; shipToAddressLine1: string | null; shipToAddressLine2: string | null;
  shipToCity: string | null; shipToRegion: string | null; shipToPostalCode: string | null; shipToCountry: string | null;
};

async function getSalesLine(orderId: string, lineId?: string) {
  const line = await first<SalesLineState>(
    `SELECT sol.id, sol.sales_order_id AS salesOrderId, sol.product_id AS productId,
             sol.ordered_qty AS orderedQty, sol.canceled_qty AS canceledQty,sol.fulfillment_route AS fulfillmentRoute,
             sol.linked_purchase_order_line_id AS linkedPurchaseOrderLineId,so.version, so.lifecycle_status AS lifecycleStatus,
             COALESCE(so.ship_to_name,bp.name) AS shipToName,COALESCE(so.ship_to_address_line_1,bp.address_line_1) AS shipToAddressLine1,
             COALESCE(so.ship_to_address_line_2,bp.address_line_2) AS shipToAddressLine2,COALESCE(so.ship_to_city,bp.city) AS shipToCity,
             COALESCE(so.ship_to_region,bp.region) AS shipToRegion,COALESCE(so.ship_to_postal_code,bp.postal_code) AS shipToPostalCode,COALESCE(so.ship_to_country,bp.country) AS shipToCountry,
            COALESCE(SUM(CASE WHEN sm.movement_type = 'sales_shipment' THEN -sm.quantity
                              WHEN sm.movement_type = 'shipment_reversal' THEN -sm.quantity ELSE 0 END), 0) AS shippedQty,
            COALESCE(SUM(CASE WHEN sm.movement_type = 'customer_return' THEN sm.quantity ELSE 0 END), 0) AS returnedQty,
            COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.sales_order_line_id = sol.id AND r.status = 'active'), 0) AS reservedQty
       FROM sales_order_lines sol JOIN sales_orders so ON so.id = sol.sales_order_id
       JOIN business_partners bp ON bp.id=so.customer_id
       LEFT JOIN stock_movements sm ON sm.sales_order_line_id = sol.id
      WHERE so.id = ? AND (? IS NULL OR sol.id = ?)
      GROUP BY sol.id ORDER BY sol.id LIMIT 1`,
    orderId,
    lineId ?? null,
    lineId ?? null
  );
  if (!line) throw new DomainError("NOT_FOUND", "Sales order line was not found.", 404);
  return line;
}

async function reserveSale(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const line = await getSalesLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  const quantity = (await normalizedQuantity({ productId: line.productId, quantity: positive(payload), uomId: typeof payload.uomId === "string" ? payload.uomId : null, usage: "sales", field: "quantity" })).baseQuantity;
  if (line.lifecycleStatus !== "confirmed") throw new DomainError("INVALID_STATE", "Only confirmed sales orders can reserve stock.", 409, line.version);
  if(line.fulfillmentRoute==="drop_ship")throw new DomainError("FULFILLMENT_ROUTE_BLOCKED","Drop-ship demand does not reserve internal inventory.",409,line.version);
  if(line.fulfillmentRoute==="special_order"&&!await first("SELECT 1 FROM supply_allocations WHERE sales_order_line_id=? AND status='active' LIMIT 1",line.id))throw new DomainError("SUPPLY_LINK_REQUIRED","Special-order reservation requires an active quantity supply allocation.",409,line.version);
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The sales order changed. Refresh before reserving stock.", 409, line.version);
  const openToReserve = roundQuantity(line.orderedQty - line.canceledQty - line.shippedQty - line.reservedQty);
  if (quantity > openToReserve) throw new DomainError("INVALID_QUANTITY", `Only ${Math.max(openToReserve, 0)} units remain to reserve.`, 409, line.version);
  const requestedLocation = typeof payload.locationId === "string" && payload.locationId.trim() ? payload.locationId.trim() : null;
  const requestedWarehouse = typeof payload.warehouseId === "string" && payload.warehouseId.trim() ? payload.warehouseId.trim() : null;
  // The worklist shows product-wide availability, so a reservation without a location spreads
  // the demand across usable bins (largest available first, one reservation row per bin) and
  // only fails when the whole product cannot cover it. A named location keeps the old rule:
  // that one bin must hold the entire quantity.
  const balances = await all<{ locationId: string; availableQty: number }>(
    `SELECT ib.location_id AS locationId, ib.on_hand_qty - ib.reserved_qty AS availableQty
       FROM inventory_balances ib JOIN locations l ON l.id = ib.location_id
      WHERE ib.product_id = ? AND l.active = 1 AND l.inventory_status = 'usable'
        AND (? IS NULL OR ib.location_id = ?) AND (? IS NULL OR l.warehouse_id = ?)
        AND ib.on_hand_qty - ib.reserved_qty > ${QTY_EPSILON}
      ORDER BY ib.on_hand_qty - ib.reserved_qty DESC, ib.location_id`,
    line.productId, requestedLocation, requestedLocation, requestedWarehouse, requestedWarehouse,
  );
  const allocations: Array<{ locationId: string; quantity: number; reservationId: string }> = [];
  let remaining = quantity;
  for (const balance of balances) {
    if (remaining <= 0) break;
    const available = roundQuantity(Number(balance.availableQty));
    const allocated = requestedLocation ? (available + 0.000001 >= quantity ? quantity : 0) : roundQuantity(Math.min(available, remaining));
    if (allocated <= 0) continue;
    allocations.push({ locationId: balance.locationId, quantity: allocated, reservationId: newId("reservation") });
    remaining = roundQuantity(remaining - allocated);
  }
  if (remaining > 0 || !allocations.length) {
    throw new DomainError("INSUFFICIENT_AVAILABILITY", requestedLocation
      ? "There is not enough usable, unreserved stock at the selected location."
      : `Only ${roundQuantity(quantity - remaining)} of ${quantity} units are usable and unreserved${requestedWarehouse ? " in the selected warehouse" : ""}.`, 409, line.version);
  }
  const now = new Date().toISOString();
  const spread = allocations.length === 1 ? "" : ` across ${allocations.length} locations`;
  const result: CommandResult = {
    message: `${quantity} unit${quantity === 1 ? "" : "s"} reserved for this sales order${spread}.`,
    impact: { physical: "On-hand inventory is unchanged.", commercial: `${quantity} units allocated to customer demand${spread}.`, financial: "No invoice was created.", onHandDelta: 0, incomingDelta: 0, reservedDelta: quantity, availableDelta: -quantity },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  const primary = allocations[0];
  const claimedBalances = JSON.stringify(allocations.map((allocation) => ({ locationId: allocation.locationId, quantity: allocation.quantity })));
  await db.batch([
    // One JSON document claims every bin at once, so the claim stays within D1's parameter cap
    // however many bins the product is spread across.
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key, command, entity_id, response_json, request_hash, claim_token, created_at)
                SELECT ?, ?, ?, ?, ?, ?, ? FROM sales_orders so
                 WHERE so.id = ? AND so.version = ?
                   AND NOT EXISTS (SELECT 1 FROM json_each(?) claimed
                     LEFT JOIN inventory_balances ib ON ib.product_id = ? AND ib.location_id = json_extract(claimed.value, '$.locationId')
                     LEFT JOIN locations l ON l.id = ib.location_id
                     WHERE ib.location_id IS NULL OR l.active <> 1 OR l.inventory_status <> 'usable'
                        OR ib.on_hand_qty - ib.reserved_qty < json_extract(claimed.value, '$.quantity') - ${QTY_EPSILON})`)
      .bind(input.idempotencyKey, input.command, input.entityId, JSON.stringify(result), input.requestHash ?? null, input.claimToken ?? null, now, input.entityId, input.version, claimedBalances, line.productId),
    ...allocations.flatMap((allocation) => [
      db.prepare(`INSERT INTO reservations (id, sales_order_line_id, product_id, location_id, quantity, status, created_at)
                  SELECT ?, ?, ?, ?, ?, 'active', ? WHERE ${exists}`).bind(allocation.reservationId, line.id, line.productId, allocation.locationId, allocation.quantity, now),
      db.prepare(`UPDATE inventory_balances SET reserved_qty = ${qtyPlus("reserved_qty")}, version = version + 1
                  WHERE product_id = ? AND location_id = ? AND ${qtyAtLeast("on_hand_qty - reserved_qty")} AND ${exists}`).bind(allocation.quantity, line.productId, allocation.locationId, allocation.quantity),
    ]),
    db.prepare(`UPDATE sales_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`).bind(input.entityId, input.version),
    auditPrepared(input, "sales_order", input.entityId, "stock_reserved", result.message,
      { quantity, locationId: allocations.length === 1 ? primary.locationId : null, reservationId: allocations.length === 1 ? primary.reservationId : null, allocations }, now),
    outboxPrepared(input, "sales_order.stock_reserved", "reservation", primary.reservationId,
      { salesOrderId: input.entityId, productId: line.productId, quantity, locationId: allocations.length === 1 ? primary.locationId : null, allocations }, now),
  ]);
  return requireLogged(input, "Availability or the sales order changed before stock could be reserved.");
}

async function shipSale(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const carrier = requiredText(payload, "carrier");
  const serviceLevel = optionalText(payload, "serviceLevel", "");
  const trackingNumber = optionalText(payload, "trackingNumber", "");
  const billOfLadingNumber = optionalText(payload, "billOfLadingNumber", "");
  if (!trackingNumber && !billOfLadingNumber) throw new DomainError("SHIPPING_REFERENCE_REQUIRED", "Enter a tracking number or bill of lading before posting the shipment.");
  const line = await getSalesLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  const quantity = (await normalizedQuantity({ productId: line.productId, quantity: positive(payload), uomId: typeof payload.uomId === "string" ? payload.uomId : null, usage: "sales", field: "quantity" })).baseQuantity;
  if (!line.shipToAddressLine1 || !line.shipToCity || !line.shipToRegion || !line.shipToPostalCode || !line.shipToCountry) {
    throw new DomainError("SHIP_TO_REQUIRED", "Add a complete customer ship-to address before posting the shipment.", 409, line.version);
  }
  if (line.lifecycleStatus !== "confirmed") throw new DomainError("INVALID_STATE", "Only confirmed sales orders can ship.", 409, line.version);
  if(line.fulfillmentRoute==="drop_ship")throw new DomainError("FULFILLMENT_ROUTE_BLOCKED","Drop-ship lines cannot post an internal stock shipment.",409,line.version);
  if(line.fulfillmentRoute==="special_order"&&!await first("SELECT 1 FROM supply_allocations WHERE sales_order_line_id=? AND status='active' LIMIT 1",line.id))throw new DomainError("SUPPLY_LINK_REQUIRED","Special-order shipment requires an active quantity supply allocation.",409,line.version);
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The sales order changed. Refresh before shipping.", 409, line.version);
  const activeReservations = await all<{ id: string; locationId: string; quantity: number }>(
    `SELECT id, location_id AS locationId, quantity FROM reservations
      WHERE sales_order_line_id = ? AND status = 'active' AND quantity > 0
      ORDER BY created_at, id`, line.id
  );
  let remaining = quantity;
  const reservationDraws = activeReservations.flatMap((reservation) => {
    if (remaining <= 0) return [];
    const allocated = roundQuantity(Math.min(reservation.quantity, remaining));
    remaining = roundQuantity(remaining - allocated);
    return allocated > 0 ? [{ ...reservation, allocated }] : [];
  });
  if (remaining > 0) throw new DomainError("NOT_RESERVED", "Reserve the requested quantity before posting shipment.", 409, line.version);
  // Two reservation rows in the same bin are one physical pick. Merge them by location before
  // the tracked-product check so a lot or serial shipment is not refused as "split-location".
  const allocationsByLocation = new Map<string, { locationId: string; allocated: number; reservations: Array<{ id: string; allocated: number }> }>();
  for (const draw of reservationDraws) {
    const merged = allocationsByLocation.get(draw.locationId) ?? { locationId: draw.locationId, allocated: 0, reservations: [] };
    merged.allocated = roundQuantity(merged.allocated + draw.allocated);
    merged.reservations.push({ id: draw.id, allocated: draw.allocated });
    allocationsByLocation.set(draw.locationId, merged);
  }
  const allocations = [...allocationsByLocation.values()];
  const trackingPolicy = await first<{ policy: string }>("SELECT tracking_policy AS policy FROM products WHERE id=?", line.productId);
  if (allocations.length > 1 && trackingPolicy?.policy !== "quantity") {
    throw new DomainError("TRACKING_SELECTION_REQUIRED", "Split-location shipments for lot- or serial-tracked products require separate tracked shipment commands.", 409, line.version);
  }
  const trackedAllocations = await Promise.all(allocations.map(async (allocation) => ({
    ...allocation,
    tracking: await outgoingTracking(line.productId, allocation.locationId, allocation.allocated, payload),
    shipmentLineId: newId("shipment-line"),
    movementId: newId("movement"),
  })));
  const valuation = await valuationForIssue(line.productId, quantity);
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const shipmentId = newId("shipment");
  const shipmentNumber = await nextDocumentNumber("SHP");
  const now = postingTimestamp(payload);
  const result: CommandResult = {
    message: `${shipmentNumber} posted for ${quantity} unit${quantity === 1 ? "" : "s"}.`,
    impact: { physical: `${quantity} units removed from on-hand inventory.`, commercial: `${quantity} reserved units fulfilled.`, financial: `COGS of ${valuation.valueCents} cents was recorded; no customer invoice was created.`, onHandDelta: -quantity, incomingDelta: 0, reservedDelta: -quantity, availableDelta: 0 },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  const reservationClaims = trackedAllocations.flatMap((allocation) => [
    ...allocation.reservations.map(() => `EXISTS (SELECT 1 FROM reservations r WHERE r.id = ? AND r.status = 'active' AND ${qtyAtLeast("r.quantity")})`),
    `EXISTS (SELECT 1 FROM inventory_balances ib WHERE ib.product_id = ? AND ib.location_id = ? AND ${qtyAtLeast("ib.on_hand_qty")} AND ${qtyAtLeast("ib.reserved_qty")})`,
  ]).join(" AND ");
  const reservationClaimBindings = trackedAllocations.flatMap((allocation) => [
    ...allocation.reservations.flatMap((reservation) => [reservation.id, reservation.allocated]),
    line.productId, allocation.locationId, allocation.allocated, allocation.allocated,
  ]);
  const trackingClaimSql = trackedAllocations.map((allocation) => allocation.tracking.claimSql).join("");
  const trackingClaimBindings = trackedAllocations.flatMap((allocation) => allocation.tracking.claimBindings);
  const commands: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key, command, entity_id, response_json, request_hash, claim_token, created_at)
                SELECT ?, ?, ?, ?, ?, ?, ? FROM sales_orders so
                 WHERE so.id = ? AND so.version = ?
                    AND ${reservationClaims}${layerClaimPredicate(valuation.layers)}${trackingClaimSql}`)
      .bind(input.idempotencyKey, input.command, input.entityId, JSON.stringify(result), input.requestHash ?? null, input.claimToken ?? null, now, input.entityId, input.version, ...reservationClaimBindings, ...layerClaimBindings(valuation.layers), ...trackingClaimBindings),
    db.prepare(`UPDATE sales_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`).bind(input.entityId, input.version),
    db.prepare(`INSERT INTO shipments
      (id,number,sales_order_id,status,carrier,service_level,tracking_number,bill_of_lading_number,
       ship_to_name,ship_to_address_line_1,ship_to_address_line_2,ship_to_city,ship_to_region,ship_to_postal_code,ship_to_country,posted_at,version)
      SELECT ?,?,?,'posted',?,?,?,?,?,?,?,?,?,?,?,?,1 WHERE ${exists}`)
      .bind(shipmentId, shipmentNumber, input.entityId, carrier, serviceLevel, trackingNumber, billOfLadingNumber,
        line.shipToName, line.shipToAddressLine1, line.shipToAddressLine2, line.shipToCity, line.shipToRegion,
        line.shipToPostalCode, line.shipToCountry, now),
  ];
  let allocatedValue = 0;
  trackedAllocations.forEach((allocation, index) => {
    const valueCents = index === trackedAllocations.length - 1
      ? valuation.valueCents - allocatedValue
      : Math.round(valuation.valueCents * allocation.allocated / quantity);
    allocatedValue += valueCents;
    commands.push(
      ...allocation.reservations.map((reservation) => db.prepare(`UPDATE reservations SET quantity = MAX(${qtyMinus("quantity")}, 0), status = CASE WHEN ${qtyDrained("quantity")} THEN 'consumed' ELSE 'active' END
                  WHERE id = ? AND ${exists}`).bind(reservation.allocated, reservation.allocated, reservation.id)),
      db.prepare(`UPDATE inventory_balances SET on_hand_qty = ${qtyMinus("on_hand_qty")}, reserved_qty = ${qtyMinus("reserved_qty")}, version = version + 1
                  WHERE product_id = ? AND location_id = ? AND ${exists}`).bind(allocation.allocated, allocation.allocated, line.productId, allocation.locationId),
      db.prepare(`INSERT INTO shipment_lines (id, shipment_id, sales_order_line_id, product_id, location_id, quantity)
                  SELECT ?, ?, ?, ?, ?, ? WHERE ${exists}`).bind(allocation.shipmentLineId, shipmentId, line.id, line.productId, allocation.locationId, allocation.allocated),
      db.prepare(`INSERT INTO stock_movements
        (id, movement_type, product_id, quantity, from_location_id, inventory_status, source_document_type,
         source_document_id, source_line_id, sales_order_line_id, posted_at, posted_by, unit_cost_cents, idempotency_key)
        SELECT ?, 'sales_shipment', ?, ?, ?, 'usable', 'shipment', ?, ?, ?, ?, ?, ?, ? WHERE ${exists}`)
        .bind(allocation.movementId, line.productId, -allocation.allocated, allocation.locationId, shipmentId, allocation.shipmentLineId, line.id, now, actor, valuation.unitCostCents, input.idempotencyKey),
      valueEntryPrepared(input, { productId: line.productId, movementId: allocation.movementId, entryType: "shipment",
        quantity: -allocation.allocated, unitCostCents: valuation.unitCostCents, valueCents: -valueCents,
        method: valuation.method, referenceType: "shipment", referenceId: shipmentId, postedAt: now, postedBy: actor }),
    );
    if (allocation.tracking.policy !== "quantity") commands.push(db.prepare(`INSERT INTO movement_assignments (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${exists}`).bind(newId("assignment"), allocation.movementId, allocation.tracking.lotId, allocation.tracking.unitId, allocation.allocated));
    if (allocation.tracking.policy === "serial") commands.push(db.prepare(`UPDATE inventory_units SET lifecycle_status='shipped',version=version+1 WHERE id=? AND product_id=? AND location_id=? AND inventory_status='usable' AND lifecycle_status='on_hand' AND allocated_sales_order_line_id IS NULL AND version=? AND ${exists}`).bind(allocation.tracking.unitId, line.productId, allocation.locationId, allocation.tracking.unitVersion));
  });
  commands.push(
    ...layerConsumptionPrepared(input, valuation.layers),
    auditPrepared(input, "sales_order", input.entityId, "shipment_posted", result.message,
      { quantity, shipmentId, carrier, serviceLevel, trackingNumber, billOfLadingNumber, shipToPostalCode: line.shipToPostalCode, allocations: trackedAllocations.map(({ locationId, allocated, movementId }) => ({ locationId, quantity: allocated, movementId })), cogsCents: valuation.valueCents, costMethod: valuation.method }, now),
    outboxPrepared(input, "inventory.shipment_posted", "shipment", shipmentId,
      { salesOrderId: input.entityId, productId: line.productId, quantity, carrier, serviceLevel, trackingNumber, billOfLadingNumber, cogsCents: valuation.valueCents }, now),
  );
  await db.batch(commands);
  return requireLogged(input, "Reservation, inventory, or the sales order changed before shipment could be posted.");
}

type CounterSalePostingLine = NormalizedItem & {
  orderLineId: string;
  shipmentLineId: string;
  movementId: string;
  locationId: string;
  tracking: OutgoingTracking;
  cogsCents: number;
  cogsUnitCents: number;
};

const WALK_IN_CUSTOMER_ID = "customer-walk-in";
const WALK_IN_CUSTOMER_CODE = "WALK-IN";

/**
 * A counter sale deliberately hides the internal document chain without bypassing it. The order,
 * shipment, invoice, and optional full payment are all created behind one command claim and one
 * D1 batch, so a till failure cannot leave stock shipped but not billed (or billed but not paid).
 */
async function postCounterSale(input: InventoryCommand): Promise<CommandResult> {
  if (input.version !== 1) throw new DomainError("VERSION_CONFLICT", "A new counter sale must start at version 1.", 409, 1);
  const payload = input.payload ?? {};
  const rawLines = Array.isArray(payload.lines) ? payload.lines.filter((line): line is Record<string, unknown> => Boolean(line) && typeof line === "object") : [];
  const rawItems = rawLines.filter((line) => line.kind !== "charge");
  let draft: Awaited<ReturnType<typeof prepareOrderDraft>>;
  try {
    draft = await prepareOrderDraft({
      type: "salesOrder",
      idempotencyKey: input.idempotencyKey,
      lines: rawLines as CreateOrderLine[],
      projectReference: typeof payload.projectReference === "string" ? payload.projectReference : undefined,
    });
  } catch (error) {
    if (error instanceof RecordValidationError) throw new DomainError(error.code, error.message, error.status);
    throw error;
  }
  if (rawItems.length !== draft.items.length) throw new DomainError("VALIDATION_ERROR", "Every counter-sale item must be a valid product line.");
  if (draft.totalCents <= 0) throw new DomainError("INVALID_DOCUMENT_TOTAL", "A counter sale total must be greater than zero.");
  if (draft.items.some((line) => line.fulfillmentRoute !== "stock")) {
    throw new DomainError("FULFILLMENT_ROUTE_BLOCKED", "Counter sales can contain only stock lines. Use a sales order for special-order or drop-ship products.", 409);
  }

  const requestedCustomerId = requiredText(payload, "customerId");
  const isWalkIn = requestedCustomerId === WALK_IN_CUSTOMER_ID;
  const storedCustomer = await first<{
    id: string; name: string; addressLine1: string | null; addressLine2: string | null; city: string | null; region: string | null;
    postalCode: string | null; country: string | null; currency: string; paymentTerms: string | null;
    creditLimitCents: number; creditHold: number; outstandingBaseCents: number;
  }>(`SELECT bp.id,bp.name,bp.address_line_1 AS addressLine1,bp.address_line_2 AS addressLine2,bp.city,bp.region,
      bp.postal_code AS postalCode,bp.country,bp.currency,bp.payment_terms AS paymentTerms,
      bp.credit_limit_cents AS creditLimitCents,bp.credit_hold AS creditHold,
      COALESCE((SELECT SUM(MAX(ci.base_total_cents-ROUND(ci.paid_cents*ci.exchange_rate_to_base)-
        COALESCE((SELECT SUM(cc.base_amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0),0))
        FROM customer_invoices ci WHERE ci.customer_id=bp.id AND ci.status<>'void'),0) AS outstandingBaseCents
      FROM business_partners bp
      WHERE (bp.id=? OR (?=1 AND bp.code=?)) AND bp.partner_type IN ('customer','both') AND bp.active=1
      ORDER BY CASE WHEN bp.id=? THEN 0 ELSE 1 END LIMIT 1`, requestedCustomerId, isWalkIn ? 1 : 0, WALK_IN_CUSTOMER_CODE, requestedCustomerId);
  if (!storedCustomer && !isWalkIn) throw new DomainError("INVALID_CUSTOMER", "Select an active customer for the counter sale.", 404);
  const createWalkIn = isWalkIn && !storedCustomer;
  const customer = storedCustomer ?? {
    id: WALK_IN_CUSTOMER_ID, name: "Walk-in Customer", addressLine1: null, addressLine2: null, city: null, region: null,
    postalCode: null, country: "CA", currency: "CAD", paymentTerms: "Due on receipt",
    creditLimitCents: 0, creditHold: 0, outstandingBaseCents: 0,
  };
  const customerId = customer.id;

  const settlement = optionalText(payload, "settlement", "pay_now").toLowerCase();
  if (!['pay_now', 'on_account'].includes(settlement)) throw new DomainError("VALIDATION_ERROR", "settlement must be pay_now or on_account.");
  const payNow = settlement === "pay_now";
  if (isWalkIn && !payNow) throw new DomainError("WALK_IN_PAYMENT_REQUIRED", "Walk-in sales must be paid now. Select a customer account to offer payment terms.", 409);
  const postingDate = postingDateValue(payload);
  const currency = optionalText(payload, "currency", customer.currency || "CAD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new DomainError("VALIDATION_ERROR", "currency must be a three-letter ISO code.");
  const exchangeRateToBase = payload.exchangeRateToBase == null ? 1 : Number(payload.exchangeRateToBase);
  if (!Number.isFinite(exchangeRateToBase) || exchangeRateToBase <= 0) throw new DomainError("VALIDATION_ERROR", "exchangeRateToBase must be greater than zero.");
  if (currency === "CAD" && exchangeRateToBase !== 1) throw new DomainError("EXCHANGE_RATE_MISMATCH", "CAD counter sales must use an exchange rate of 1.");
  if (currency !== "CAD" && payload.exchangeRateToBase == null) throw new DomainError("EXCHANGE_RATE_REQUIRED", `Enter the ${currency}-to-CAD exchange rate.`);
  const paymentTerms = payNow ? "Due on receipt" : optionalText(payload, "paymentTerms", customer.paymentTerms || "Due on receipt");
  const dueDate = payNow ? postingDate : optionalText(payload, "dueDate", postingDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(new Date(`${dueDate}T00:00:00.000Z`).valueOf())) {
    throw new DomainError("VALIDATION_ERROR", "dueDate must be a valid YYYY-MM-DD date.");
  }
  if (dueDate < postingDate) throw new DomainError("VALIDATION_ERROR", "dueDate cannot be before the sale date.");
  const baseTotalCents = Math.round(draft.totalCents * exchangeRateToBase);
  if (!payNow) {
    if (Boolean(customer.creditHold)) throw new DomainError("CREDIT_HOLD", "This customer is on credit hold. Take payment now or remove the hold before charging the account.", 409);
    if (customer.creditLimitCents > 0 && currency !== customer.currency) {
      throw new DomainError("CREDIT_CURRENCY_MISMATCH", `This customer's credit limit is denominated in ${customer.currency}; use that currency to charge the account.`, 409);
    }
    const outstandingCreditCents = Math.round(customer.outstandingBaseCents / exchangeRateToBase);
    if (customer.creditLimitCents > 0 && outstandingCreditCents + draft.totalCents > customer.creditLimitCents) {
      const exceededBy = (outstandingCreditCents + draft.totalCents - customer.creditLimitCents) / 100;
      throw new DomainError("CREDIT_LIMIT_EXCEEDED", `This counter sale would exceed the customer's credit limit by ${exceededBy.toFixed(2)} ${customer.currency}.`, 409);
    }
  }

  const paymentMethod = payNow ? requiredText(payload, "paymentMethod").toLowerCase() : "";
  const paymentReference = payNow ? requiredText(payload, "paymentReference") : "";
  if (payNow && !/^[a-z0-9_-]{2,40}$/.test(paymentMethod)) throw new DomainError("VALIDATION_ERROR", "Select a recognizable payment method.");

  const postingLines: CounterSalePostingLine[] = [];
  const stockGroups = new Map<string, { productId: string; locationId: string; quantity: number }>();
  const lotGroups = new Map<string, { productId: string; locationId: string; lotId: string; quantity: number }>();
  const serialIds = new Set<string>();
  for (const [index, item] of draft.items.entries()) {
    const source = rawItems[index];
    const locationId = requiredText(source, "locationId");
    await requireActiveLocation(locationId, ["usable"], `Counter-sale line ${index + 1}`);
    const tracking = await outgoingTracking(item.productId, locationId, item.quantity, source);
    if (tracking.unitId) {
      if (serialIds.has(tracking.unitId)) throw new DomainError("DUPLICATE_SERIAL", "The same serial number cannot appear twice on a counter sale.", 409);
      serialIds.add(tracking.unitId);
    }
    const stockKey = `${item.productId}\u0000${locationId}`;
    const stock = stockGroups.get(stockKey) ?? { productId: item.productId, locationId, quantity: 0 };
    stock.quantity = roundQuantity(stock.quantity + item.quantity);
    stockGroups.set(stockKey, stock);
    if (tracking.policy === "lot" && tracking.lotId) {
      const lotKey = `${item.productId}\u0000${locationId}\u0000${tracking.lotId}`;
      const lot = lotGroups.get(lotKey) ?? { productId: item.productId, locationId, lotId: tracking.lotId, quantity: 0 };
      lot.quantity = roundQuantity(lot.quantity + item.quantity);
      lotGroups.set(lotKey, lot);
    }
    postingLines.push({ ...item, orderLineId: newId("so-line"), shipmentLineId: newId("shipment-line"), movementId: newId("movement"), locationId, tracking, cogsCents: 0, cogsUnitCents: 0 });
  }

  for (const stock of stockGroups.values()) {
    const balance = await first<{ available: number }>(`SELECT ib.on_hand_qty-ib.reserved_qty AS available
      FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id
      WHERE ib.product_id=? AND ib.location_id=? AND l.active=1 AND l.inventory_status='usable'`, stock.productId, stock.locationId);
    if (!balance || Number(balance.available) < stock.quantity) throw new DomainError("INSUFFICIENT_AVAILABILITY", "There is not enough usable, unreserved stock at one of the selected locations.", 409);
  }
  for (const lot of lotGroups.values()) {
    const identified = await first<{ quantity: number }>(`SELECT COALESCE(SUM(CASE WHEN sm.to_location_id=? THEN ma.quantity WHEN sm.from_location_id=? THEN -ma.quantity ELSE 0 END),0) AS quantity
      FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id WHERE sm.product_id=? AND ma.lot_id=?`, lot.locationId, lot.locationId, lot.productId, lot.lotId);
    if (Number(identified?.quantity ?? 0) < lot.quantity) throw new DomainError("LOT_QUANTITY_SHORTAGE", "A selected lot does not have enough identified stock at its location.", 409);
  }

  const productGroups = new Map<string, { quantity: number; lineIndexes: number[]; valuation?: IssueValuation }>();
  postingLines.forEach((line, index) => {
    const group = productGroups.get(line.productId) ?? { quantity: 0, lineIndexes: [] };
    group.quantity = roundQuantity(group.quantity + line.quantity);
    group.lineIndexes.push(index);
    productGroups.set(line.productId, group);
  });
  for (const [productId, group] of productGroups) {
    const valuation = await valuationForIssue(productId, group.quantity);
    group.valuation = valuation;
    let assignedValue = 0;
    group.lineIndexes.forEach((lineIndex, allocationIndex) => {
      const line = postingLines[lineIndex];
      const value = allocationIndex === group.lineIndexes.length - 1
        ? valuation.valueCents - assignedValue
        : Math.round(valuation.valueCents * line.quantity / group.quantity);
      line.cogsCents = value;
      line.cogsUnitCents = Math.round(value / line.quantity);
      assignedValue += value;
    });
  }
  const allLayers = [...productGroups.values()].flatMap((group) => group.valuation?.layers ?? []);
  const cogsCents = postingLines.reduce((sum, line) => sum + line.cogsCents, 0);
  const quantity = postingLines.reduce((sum, line) => roundQuantity(sum + line.quantity), 0);
  const subtotalCents = draft.itemSubtotalCents + draft.chargeSubtotalCents;
  const appliedTaxRates = [...new Set(draft.items.filter((line) => line.taxable && line.taxRateBps > 0).map((line) => line.taxRateBps)
    .concat(draft.charges.filter((charge) => charge.taxable && charge.taxRateBps > 0).map((charge) => charge.taxRateBps)))];
  const headerTaxRate = appliedTaxRates.length === 1 ? appliedTaxRates[0] : 0;
  const headerTaxCode = appliedTaxRates.length > 1 ? "MIXED" : appliedTaxRates.length === 1
    ? (draft.items.find((line) => line.taxable && line.taxRateBps === headerTaxRate)?.taxCode ?? draft.charges.find((charge) => charge.taxable && charge.taxRateBps === headerTaxRate)?.taxCode ?? "GST")
    : null;

  const salesOrderId = newId("so");
  const shipmentId = newId("shipment");
  const invoiceId = newId("customer-invoice");
  const paymentId = payNow ? newId("payment") : undefined;
  const salesOrderNumber = await nextDocumentNumber("SO");
  const shipmentNumber = await nextDocumentNumber("SHP");
  const invoiceNumber = await nextDocumentNumber("INV");
  const paymentNumber = payNow ? await nextDocumentNumber("PAY") : undefined;
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const now = postingTimestamp(payload);
  const shipToName = optionalText(payload, "shipToName", customer.name);
  const shipToAddressLine1 = optionalText(payload, "shipToAddressLine1", customer.addressLine1 ?? "");
  const shipToAddressLine2 = optionalText(payload, "shipToAddressLine2", customer.addressLine2 ?? "");
  const shipToCity = optionalText(payload, "shipToCity", customer.city ?? "");
  const shipToRegion = optionalText(payload, "shipToRegion", customer.region ?? "");
  const shipToPostalCode = optionalText(payload, "shipToPostalCode", customer.postalCode ?? "");
  const shipToCountry = optionalText(payload, "shipToCountry", customer.country ?? "CA").toUpperCase();
  const projectReference = optionalText(payload, "projectReference", "");
  const deliveryInstructions = optionalText(payload, "deliveryInstructions", "Counter pickup");
  const result: CommandResult = {
    message: payNow
      ? `${invoiceNumber} paid and ${shipmentNumber} posted. Internal order ${salesOrderNumber} was created automatically.`
      : `${invoiceNumber} posted on account and ${shipmentNumber} posted. Internal order ${salesOrderNumber} was created automatically.`,
    salesOrderId, salesOrderNumber, shipmentId, shipmentNumber, invoiceId, invoiceNumber, paymentId, paymentNumber,
    impact: {
      physical: `${quantity} unit${quantity === 1 ? "" : "s"} removed from usable, unreserved inventory.`,
      commercial: `${salesOrderNumber} was created confirmed and fulfilled without a reservation step.`,
      financial: payNow ? `${draft.totalCents} ${currency} cents invoiced and paid; ${cogsCents} cents of COGS posted.` : `${draft.totalCents} ${currency} cents posted to receivables; ${cogsCents} cents of COGS posted.`,
      onHandDelta: -quantity, incomingDelta: 0, reservedDelta: 0, availableDelta: -quantity,
    },
  };

  const stockClaims = [...stockGroups.values()].map(() => ` AND EXISTS (SELECT 1 FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id
    WHERE ib.product_id=? AND ib.location_id=? AND l.active=1 AND l.inventory_status='usable' AND ${qtyAtLeast("ib.on_hand_qty-ib.reserved_qty")})`).join("");
  const stockClaimBindings = [...stockGroups.values()].flatMap((stock) => [stock.productId, stock.locationId, stock.quantity]);
  const lotClaims = [...lotGroups.values()].map(() => ` AND (SELECT COALESCE(SUM(CASE WHEN sm.to_location_id=? THEN ma.quantity WHEN sm.from_location_id=? THEN -ma.quantity ELSE 0 END),0)
    FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id WHERE sm.product_id=? AND ma.lot_id=?)>=?`).join("");
  const lotClaimBindings = [...lotGroups.values()].flatMap((lot) => [lot.locationId, lot.locationId, lot.productId, lot.lotId, lot.quantity]);
  const serialLines = postingLines.filter((line) => line.tracking.policy === "serial");
  const serialClaims = serialLines.map((line) => line.tracking.claimSql).join("");
  const serialClaimBindings = serialLines.flatMap((line) => line.tracking.claimBindings);
  const creditClaim = payNow ? "" : ` AND bp.credit_hold=0 AND (bp.credit_limit_cents=0 OR (bp.currency=? AND
    ROUND(COALESCE((SELECT SUM(MAX(ci.base_total_cents-ROUND(ci.paid_cents*ci.exchange_rate_to_base)-
      COALESCE((SELECT SUM(cc.base_amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0),0))
      FROM customer_invoices ci WHERE ci.customer_id=bp.id AND ci.status<>'void'),0)/?)+?<=bp.credit_limit_cents))`;
  const creditClaimBindings = payNow ? [] : [currency, exchangeRateToBase, draft.totalCents];
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  const claim = createWalkIn
    ? db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
        SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM business_partners WHERE id=? OR code=?)
          ${stockClaims}${layerClaimPredicate(allLayers)}${lotClaims}${serialClaims}`)
      .bind(input.idempotencyKey, input.command, input.entityId, JSON.stringify(result), input.requestHash ?? null, input.claimToken ?? null, now,
        WALK_IN_CUSTOMER_ID, WALK_IN_CUSTOMER_CODE, ...stockClaimBindings, ...layerClaimBindings(allLayers), ...lotClaimBindings, ...serialClaimBindings)
    : db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
        SELECT ?,?,?,?,?,?,? FROM business_partners bp WHERE bp.id=? AND bp.partner_type IN ('customer','both') AND bp.active=1
          ${creditClaim}${stockClaims}${layerClaimPredicate(allLayers)}${lotClaims}${serialClaims}`)
      .bind(input.idempotencyKey, input.command, input.entityId, JSON.stringify(result), input.requestHash ?? null, input.claimToken ?? null, now,
        customerId, ...creditClaimBindings, ...stockClaimBindings, ...layerClaimBindings(allLayers), ...lotClaimBindings, ...serialClaimBindings);
  const statements: D1PreparedStatement[] = [
    claim,
    db.prepare(`INSERT INTO sales_orders
      (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,payment_terms,due_date,total_cents,owner_name,project_reference,
       ship_to_name,ship_to_address_line_1,ship_to_address_line_2,ship_to_city,ship_to_region,ship_to_postal_code,ship_to_country,delivery_instructions,version,created_at)
      SELECT ?,?,?,'confirmed','invoiced',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,? WHERE ${exists}`)
      .bind(salesOrderId, salesOrderNumber, customerId, postingDate, currency, exchangeRateToBase, baseTotalCents, paymentTerms, dueDate, draft.totalCents, actor, projectReference || null,
        shipToName, shipToAddressLine1 || null, shipToAddressLine2 || null, shipToCity || null, shipToRegion || null, shipToPostalCode || null, shipToCountry, deliveryInstructions, now),
    db.prepare(`INSERT INTO shipments
      (id,number,sales_order_id,status,carrier,service_level,ship_to_name,ship_to_address_line_1,ship_to_address_line_2,ship_to_city,ship_to_region,ship_to_postal_code,ship_to_country,posted_at,version)
      SELECT ?,?,?,'posted','Customer pickup','Counter sale',?,?,?,?,?,?,?,?,1 WHERE ${exists}`)
      .bind(shipmentId, shipmentNumber, salesOrderId, shipToName, shipToAddressLine1 || null, shipToAddressLine2 || null, shipToCity || null, shipToRegion || null, shipToPostalCode || null, shipToCountry, now),
    db.prepare(`INSERT INTO customer_invoices
      (id,number,customer_id,sales_order_id,status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,tax_rate_bps,tax_code,payment_terms,posted_at,posted_by,version)
      SELECT ?,?,?,?,${payNow ? "'paid'" : "'posted'"},?,?,?,?,?,?,?,?,?,?,?,?,?,?,1 WHERE ${exists}`)
      .bind(invoiceId, invoiceNumber, customerId, salesOrderId, postingDate, dueDate, subtotalCents, draft.taxCents, draft.totalCents, payNow ? draft.totalCents : 0,
        currency, exchangeRateToBase, baseTotalCents, headerTaxRate, headerTaxCode, paymentTerms, now, actor),
  ];
  if (createWalkIn) statements.splice(1, 0, db.prepare(`INSERT INTO business_partners
    (id,code,name,partner_type,country,payment_terms,currency,credit_limit_cents,credit_hold,active,version,created_at)
    SELECT ?,?,'Walk-in Customer','customer','CA','Due on receipt','CAD',0,0,1,1,? WHERE ${exists}`)
    .bind(WALK_IN_CUSTOMER_ID, WALK_IN_CUSTOMER_CODE, now));
  postingLines.forEach((line) => {
    const lineTotal = Math.round(line.enteredQuantity * line.enteredUnitAmountCents) - line.discountCents;
    statements.push(
      db.prepare(`INSERT INTO sales_order_lines
        (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_price_cents,configuration_snapshot,fulfillment_route,project_reference,discount_cents,taxable,tax_code,tax_rate_bps)
        SELECT ?,?,?,?,0,?,?,?,?,?,'stock',?,?,?,?,? WHERE ${exists}`)
        .bind(line.orderLineId, salesOrderId, line.productId, line.quantity, line.unitAmountCents, line.uomId, line.enteredQuantity, line.enteredUnitAmountCents,
          line.configurationSnapshot, line.projectReference, line.discountCents, line.taxable ? 1 : 0, line.taxCode, line.taxRateBps),
      db.prepare(`INSERT INTO shipment_lines (id,shipment_id,sales_order_line_id,product_id,location_id,quantity)
        SELECT ?,?,?,?,?,? WHERE ${exists}`).bind(line.shipmentLineId, shipmentId, line.orderLineId, line.productId, line.locationId, line.quantity),
      db.prepare(`INSERT INTO stock_movements
        (id,movement_type,product_id,quantity,from_location_id,inventory_status,source_document_type,source_document_id,source_line_id,sales_order_line_id,posted_at,posted_by,unit_cost_cents,idempotency_key)
        SELECT ?,'sales_shipment',?,? ,?,'usable','shipment',?,?,?,?,?,?,? WHERE ${exists}`)
        .bind(line.movementId, line.productId, -line.quantity, line.locationId, shipmentId, line.shipmentLineId, line.orderLineId, now, actor, line.cogsUnitCents, input.idempotencyKey),
      valueEntryPrepared(input, { productId: line.productId, movementId: line.movementId, entryType: "shipment", quantity: -line.quantity,
        unitCostCents: line.cogsUnitCents, valueCents: -line.cogsCents, method: productGroups.get(line.productId)!.valuation!.method,
        referenceType: "shipment", referenceId: shipmentId, postedAt: now, postedBy: actor }),
      db.prepare(`INSERT INTO customer_invoice_lines (id,customer_invoice_id,sales_order_line_id,product_id,quantity,unit_price_cents,line_total_cents)
        SELECT ?,?,?,?,?,?,? WHERE ${exists}`).bind(newId("invoice-line"), invoiceId, line.orderLineId, line.productId, line.quantity, line.unitAmountCents, lineTotal),
    );
    if (line.tracking.policy !== "quantity") statements.push(db.prepare(`INSERT INTO movement_assignments
      (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${exists}`)
      .bind(newId("assignment"), line.movementId, line.tracking.lotId, line.tracking.unitId, line.quantity));
    if (line.tracking.policy === "serial") statements.push(db.prepare(`UPDATE inventory_units SET lifecycle_status='shipped',version=version+1
      WHERE id=? AND product_id=? AND location_id=? AND inventory_status='usable' AND lifecycle_status='on_hand'
        AND allocated_sales_order_line_id IS NULL AND version=? AND ${exists}`)
      .bind(line.tracking.unitId, line.productId, line.locationId, line.tracking.unitVersion));
  });
  for (const stock of stockGroups.values()) statements.push(db.prepare(`UPDATE inventory_balances SET on_hand_qty=${qtyMinus("on_hand_qty")},version=version+1
    WHERE product_id=? AND location_id=? AND ${qtyAtLeast("on_hand_qty-reserved_qty")} AND ${exists}`)
    .bind(stock.quantity, stock.productId, stock.locationId, stock.quantity));
  statements.push(...layerConsumptionPrepared(input, allLayers));
  for (const documentType of ["sales_order", "customer_invoice"] as const) {
    const documentId = documentType === "sales_order" ? salesOrderId : invoiceId;
    draft.charges.forEach((charge) => statements.push(db.prepare(`INSERT INTO document_charges
      (id,document_type,document_id,charge_type,description,amount_cents,direction,taxable,refundable,tax_code,tax_rate_bps,tax_amount_cents,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${exists}`)
      .bind(newId("charge"), documentType, documentId, charge.chargeType, charge.description, charge.amountCents, charge.direction,
        charge.taxable ? 1 : 0, charge.refundable ? 1 : 0, charge.taxCode, charge.taxRateBps,
        Math.round(charge.amountCents * charge.taxRateBps / 10_000), now)));
  }
  if (payNow && paymentId && paymentNumber) statements.push(
    db.prepare(`INSERT INTO payments
      (id,number,direction,partner_id,document_type,document_id,amount_cents,payment_date,method,reference,posted_at,posted_by,currency,exchange_rate_to_base,base_amount_cents)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${exists}`)
      .bind(paymentId, paymentNumber, "inbound", customerId, "customer_invoice", invoiceId, draft.totalCents, postingDate, paymentMethod, paymentReference, now, actor, currency, exchangeRateToBase, baseTotalCents),
    auditPrepared(input, "payment", paymentId, "payment_posted", `${paymentNumber} posted with the counter sale.`,
      { invoiceId, invoiceNumber, customerId, amountCents: draft.totalCents, currency, method: paymentMethod, reference: paymentReference }, now),
    outboxPrepared(input, "payment.posted", "payment", paymentId, { invoiceId, amount: draft.totalCents, base: baseTotalCents }, now),
  );
  statements.push(
    auditPrepared(input, "sales_order", salesOrderId, "counter_sale_posted", result.message,
      { salesOrderNumber, shipmentId, shipmentNumber, invoiceId, invoiceNumber, paymentId: paymentId ?? null, paymentNumber: paymentNumber ?? null, lineCount: postingLines.length, quantity, totalCents: draft.totalCents, cogsCents }, now),
    auditPrepared(input, "customer_invoice", invoiceId, "customer_invoice_posted", result.message,
      { salesOrderId, shipmentId, quantity, total: draft.totalCents, base: baseTotalCents, paid: payNow }, now),
    outboxPrepared(input, "sales_order.confirmed", "sales_order", salesOrderId, { customerId, counterSale: true, total: draft.totalCents }, now),
    outboxPrepared(input, "inventory.shipment_posted", "shipment", shipmentId, { salesOrderId, counterSale: true, quantity, cogsCents }, now),
    outboxPrepared(input, "customer_invoice.posted", "customer_invoice", invoiceId, { salesOrderId, shipmentId, total: draft.totalCents, base: baseTotalCents, paid: payNow }, now),
  );
  await db.batch(statements);
  return requireLogged(input, "Customer credit, inventory, lot/serial identity, or valuation changed before the counter sale could post.");
}

type CustomerCreditState = { id: string; name: string; currency: string; paymentTerms: string | null; creditLimitCents: number; creditHold: number; outstandingBaseCents: number };

/** The customer's live credit position: hold flag, limit, and open receivables in base CAD. */
async function customerCreditState(customerId: string) {
  return first<CustomerCreditState>(`SELECT bp.id,bp.name,bp.currency,bp.payment_terms AS paymentTerms,
      bp.credit_limit_cents AS creditLimitCents,bp.credit_hold AS creditHold,
      COALESCE((SELECT SUM(MAX(ci.base_total_cents-ROUND(ci.paid_cents*ci.exchange_rate_to_base)-
        COALESCE((SELECT SUM(cc.base_amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0),0))
        FROM customer_invoices ci WHERE ci.customer_id=bp.id AND ci.status<>'void'),0) AS outstandingBaseCents
      FROM business_partners bp WHERE bp.id=? AND bp.partner_type IN ('customer','both') AND bp.active=1`, customerId);
}

/**
 * The same account rules the counter sale applies before charging on account: no credit hold,
 * the document currency must match a credit-controlled customer's limit currency, and the new
 * receivable plus open receivables must fit under the limit.
 */
function assertCustomerCreditAllows(customer: CustomerCreditState, sale: { currency: string; exchangeRateToBase: number; totalCents: number; context: string }) {
  if (Boolean(customer.creditHold)) throw new DomainError("CREDIT_HOLD", `This customer is on credit hold. Remove the hold before posting this ${sale.context} on account.`, 409);
  if (customer.creditLimitCents > 0 && sale.currency !== customer.currency) {
    throw new DomainError("CREDIT_CURRENCY_MISMATCH", `This customer's credit limit is denominated in ${customer.currency}; use that currency for a credit-controlled ${sale.context}.`, 409);
  }
  const outstandingCreditCents = Math.round(customer.outstandingBaseCents / sale.exchangeRateToBase);
  if (customer.creditLimitCents > 0 && outstandingCreditCents + sale.totalCents > customer.creditLimitCents) {
    const exceededBy = (outstandingCreditCents + sale.totalCents - customer.creditLimitCents) / 100;
    throw new DomainError("CREDIT_LIMIT_EXCEEDED", `This ${sale.context} would exceed the customer's credit limit by ${exceededBy.toFixed(2)} ${customer.currency}.`, 409);
  }
}

/** Claim fragment re-checking the credit rules atomically; binds [currency, exchangeRateToBase, totalCents]. Expects alias bp. */
const customerCreditClaimSql = ` AND bp.credit_hold=0 AND (bp.credit_limit_cents=0 OR (bp.currency=? AND
    ROUND(COALESCE((SELECT SUM(MAX(ci.base_total_cents-ROUND(ci.paid_cents*ci.exchange_rate_to_base)-
      COALESCE((SELECT SUM(cc.base_amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0),0))
      FROM customer_invoices ci WHERE ci.customer_id=bp.id AND ci.status<>'void'),0)/?)+?<=bp.credit_limit_cents))`;

/**
 * Counter and immediate sales are one business event: goods leave usable stock and the customer
 * receives a posted invoice. Keeping both documents in this one D1 batch prevents an inventory
 * movement without its receivable (or an invoice for goods that never left). This path consumes
 * only free stock and deliberately leaves the reservation ledger untouched.
 */
async function postImmediateSale(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const line = await getSalesLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  const quantity = (await normalizedQuantity({ productId: line.productId, quantity: positive(payload), uomId: typeof payload.uomId === "string" ? payload.uomId : null, usage: "sales", field: "quantity" })).baseQuantity;
  if (line.lifecycleStatus !== "confirmed") throw new DomainError("INVALID_STATE", "Only confirmed sales orders can be sold immediately.", 409, line.version);
  if (line.fulfillmentRoute !== "stock") throw new DomainError("FULFILLMENT_ROUTE_BLOCKED", "Immediate sale is available only for stock lines. Drop-ship and special-order lines must follow their linked fulfillment workflow.", 409, line.version);
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The sales order changed. Refresh before posting the immediate sale.", 409, line.version);
  if (!line.shipToAddressLine1 || !line.shipToCity || !line.shipToRegion || !line.shipToPostalCode || !line.shipToCountry) {
    throw new DomainError("SHIP_TO_REQUIRED", "Add a complete customer ship-to address before posting the immediate sale.", 409, line.version);
  }
  const unreservedOpen = roundQuantity(line.orderedQty - line.canceledQty - line.shippedQty - line.reservedQty);
  if (quantity > unreservedOpen) throw new DomainError("INVALID_QUANTITY", `Only ${Math.max(unreservedOpen, 0)} unreserved units can use immediate sale. Ship reserved units through the normal shipment path.`, 409, line.version);

  const requestedLocation = typeof payload.locationId === "string" && payload.locationId.trim() ? payload.locationId.trim() : null;
  const requestedWarehouse = typeof payload.warehouseId === "string" && payload.warehouseId.trim() ? payload.warehouseId.trim() : null;
  const trackingPolicy = await first<{ policy: string }>("SELECT tracking_policy AS policy FROM products WHERE id=? AND active=1", line.productId);
  if (!trackingPolicy || !["quantity", "lot", "serial"].includes(trackingPolicy.policy)) throw new DomainError("TRACKING_CONFIGURATION_ERROR", "The product tracking policy is missing or invalid.", 409);
  if (trackingPolicy.policy !== "quantity" && !requestedLocation) throw new DomainError("LOCATION_REQUIRED", "Select the usable location holding the lot or serial before posting this immediate sale.", 409, line.version);
  const balance = await first<{ locationId: string; onHandQty: number; reservedQty: number }>(
    `SELECT ib.location_id AS locationId,ib.on_hand_qty AS onHandQty,ib.reserved_qty AS reservedQty
       FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id
      WHERE ib.product_id=? AND l.active=1 AND l.inventory_status='usable'
        AND (? IS NULL OR ib.location_id=?) AND (? IS NULL OR l.warehouse_id=?)
        AND ib.on_hand_qty-ib.reserved_qty>=?
      ORDER BY ib.on_hand_qty-ib.reserved_qty DESC,ib.location_id LIMIT 1`,
    line.productId, requestedLocation, requestedLocation, requestedWarehouse, requestedWarehouse, quantity,
  );
  if (!balance) throw new DomainError("INSUFFICIENT_AVAILABILITY", "There is not enough usable, unreserved stock at the selected location for this immediate sale.", 409, line.version);
  const tracking = await outgoingTracking(line.productId, balance.locationId, quantity, payload);
  const valuation = await valuationForIssue(line.productId, quantity);

  const source = await first<{
    customerId: string; currency: string; exchange: number; paymentTerms: string | null; dueDate: string | null;
    ordered: number; unitPrice: number; taxable: number; taxRate: number; discount: number;
    invoiced: number; invoicedDiscount: number;
  }>(`SELECT so.customer_id AS customerId,so.currency,so.exchange_rate_to_base AS exchange,
             so.payment_terms AS paymentTerms,so.due_date AS dueDate,sol.ordered_qty AS ordered,
             sol.unit_price_cents AS unitPrice,sol.taxable,sol.tax_rate_bps AS taxRate,sol.discount_cents AS discount,
             COALESCE((SELECT SUM(cil.quantity) FROM customer_invoice_lines cil JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id WHERE cil.sales_order_line_id=sol.id AND ci.status<>'void'),0) AS invoiced,
             COALESCE((SELECT SUM(ROUND(cil.quantity*cil.unit_price_cents)-cil.line_total_cents) FROM customer_invoice_lines cil JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id WHERE cil.sales_order_line_id=sol.id AND ci.status<>'void'),0) AS invoicedDiscount
        FROM sales_orders so JOIN sales_order_lines sol ON sol.sales_order_id=so.id
       WHERE so.id=? AND sol.id=?`, input.entityId, line.id);
  if (!source) throw new DomainError("NOT_FOUND", "The sales order pricing source was not found.", 404);

  const postingDate = postingDateValue(payload);
  const requestedDueDate = optionalText(payload, "dueDate", "");
  const dueDate = requestedDueDate || (source.dueDate && source.dueDate >= postingDate ? source.dueDate : postingDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(new Date(`${dueDate}T00:00:00.000Z`).valueOf())) throw new DomainError("VALIDATION_ERROR", "dueDate must be a valid YYYY-MM-DD date.");
  if (dueDate < postingDate) throw new DomainError("VALIDATION_ERROR", "dueDate cannot be before the immediate-sale posting date.");
  const previous = await first<{ count: number }>("SELECT COUNT(*) AS count FROM customer_invoices WHERE sales_order_id=? AND status<>'void'", input.entityId);
  const orderCharges = Number(previous?.count ?? 0) === 0 ? await all<{
    chargeType: string; description: string; amount: number; direction: string; taxable: number;
    refundable: number; taxCode: string | null; taxRate: number; taxAmount: number;
  }>("SELECT charge_type AS chargeType,description,amount_cents AS amount,direction,taxable,refundable,tax_code AS taxCode,tax_rate_bps AS taxRate,tax_amount_cents AS taxAmount FROM document_charges WHERE document_type='sales_order' AND document_id=?", input.entityId) : [];
  const cumulativeDiscount = source.ordered > 0 ? Math.round(source.discount * Math.min(source.invoiced + quantity, source.ordered) / source.ordered) : 0;
  const gross = Math.round(quantity * source.unitPrice);
  const discount = Math.max(Math.min(cumulativeDiscount - source.invoicedDiscount, gross), 0);
  const lineTotal = gross - discount;
  const lineTax = source.taxable ? Math.round(lineTotal * source.taxRate / 10_000) : 0;
  const chargeSubtotal = orderCharges.reduce((sum, charge) => sum + (charge.direction === "subtract" ? -charge.amount : charge.amount), 0);
  const subtotal = lineTotal + chargeSubtotal;
  const tax = lineTax + orderCharges.reduce((sum, charge) => sum + (charge.direction === "subtract" ? -Math.abs(charge.taxAmount) : Math.abs(charge.taxAmount)), 0);
  const total = subtotal + tax;
  if (subtotal < 0 || total < 0) throw new DomainError("INVALID_DOCUMENT_TOTAL", "Order charges and discounts cannot make the invoice subtotal or total negative.");
  const baseTotal = Math.round(total * source.exchange);
  // An immediate sale posts a receivable on account, so it is subject to exactly the customer
  // checks a counter sale applies before charging the account.
  const customer = await customerCreditState(source.customerId);
  if (!customer) throw new DomainError("INVALID_CUSTOMER", "The customer on this sales order is inactive or not a customer account; reactivate it before posting an immediate sale.", 409, line.version);
  assertCustomerCreditAllows(customer, { currency: source.currency, exchangeRateToBase: source.exchange, totalCents: total, context: "immediate sale" });
  const appliedTaxRates = [...new Set((source.taxable && source.taxRate > 0 ? [source.taxRate] : []).concat(orderCharges.filter((charge) => charge.taxable).map((charge) => charge.taxRate)))];
  const headerTaxRate = appliedTaxRates.length === 1 ? appliedTaxRates[0] : 0;
  const headerTaxCode = appliedTaxRates.length > 1 ? "MIXED" : appliedTaxRates.length === 1 ? "GST" : null;

  const actor = optionalText(payload, "actor", "Avery Morgan");
  const carrier = optionalText(payload, "carrier", "Customer pickup");
  const serviceLevel = optionalText(payload, "serviceLevel", "Immediate sale");
  const trackingNumber = optionalText(payload, "trackingNumber", "");
  const billOfLadingNumber = optionalText(payload, "billOfLadingNumber", "");
  const shipmentId = newId("shipment");
  const shipmentLineId = newId("shipment-line");
  const movementId = newId("movement");
  const invoiceId = newId("customer-invoice");
  const shipmentNumber = await nextDocumentNumber("SHP");
  const invoiceNumber = await nextDocumentNumber("INV");
  const now = postingTimestamp(payload);
  const result: CommandResult = {
    message: `${shipmentNumber} posted and ${invoiceNumber} is ready for the customer.`,
    shipmentId, shipmentNumber, invoiceId, invoiceNumber,
    impact: {
      physical: `${quantity} unit${quantity === 1 ? "" : "s"} removed from unreserved on-hand inventory.`,
      commercial: `${quantity} unit${quantity === 1 ? "" : "s"} sold without creating a reservation.`,
      financial: `Customer receivable ${total} ${source.currency} cents and COGS ${valuation.valueCents} cents posted together.`,
      onHandDelta: -quantity, incomingDelta: 0, reservedDelta: 0, availableDelta: -quantity,
    },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM sales_orders so WHERE so.id=? AND so.version=? AND so.lifecycle_status='confirmed'
        AND EXISTS (SELECT 1 FROM business_partners bp WHERE bp.id=so.customer_id AND bp.partner_type IN ('customer','both') AND bp.active=1${customerCreditClaimSql})
        AND EXISTS (SELECT 1 FROM sales_order_lines sol WHERE sol.id=? AND sol.sales_order_id=so.id AND sol.fulfillment_route='stock'
          AND sol.ordered_qty-sol.canceled_qty
            -COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol.id),0)
            -COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.sales_order_line_id=sol.id AND r.status='active'),0)>=?)
        AND EXISTS (SELECT 1 FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE ib.product_id=? AND ib.location_id=? AND l.active=1 AND l.inventory_status='usable' AND ${qtyAtLeast("ib.on_hand_qty-ib.reserved_qty")})
        ${layerClaimPredicate(valuation.layers)}${tracking.claimSql}`)
      .bind(input.idempotencyKey, input.command, input.entityId, JSON.stringify(result), input.requestHash ?? null, input.claimToken ?? null, now,
        input.entityId, input.version, source.currency, source.exchange, total, line.id, quantity, line.productId, balance.locationId, quantity,
        ...layerClaimBindings(valuation.layers), ...tracking.claimBindings),
    db.prepare(`INSERT INTO shipments
      (id,number,sales_order_id,status,carrier,service_level,tracking_number,bill_of_lading_number,
       ship_to_name,ship_to_address_line_1,ship_to_address_line_2,ship_to_city,ship_to_region,ship_to_postal_code,ship_to_country,posted_at,version)
      SELECT ?,?,?,'posted',?,?,?,?,?,?,?,?,?,?,?,?,1 WHERE ${exists}`)
      .bind(shipmentId, shipmentNumber, input.entityId, carrier, serviceLevel, trackingNumber, billOfLadingNumber,
        line.shipToName, line.shipToAddressLine1, line.shipToAddressLine2, line.shipToCity, line.shipToRegion,
        line.shipToPostalCode, line.shipToCountry, now),
    db.prepare(`INSERT INTO shipment_lines (id,shipment_id,sales_order_line_id,product_id,location_id,quantity)
      SELECT ?,?,?,?,?,? WHERE ${exists}`).bind(shipmentLineId, shipmentId, line.id, line.productId, balance.locationId, quantity),
    db.prepare(`UPDATE inventory_balances SET on_hand_qty=${qtyMinus("on_hand_qty")},version=version+1
      WHERE product_id=? AND location_id=? AND ${qtyAtLeast("on_hand_qty-reserved_qty")} AND ${exists}`)
      .bind(quantity, line.productId, balance.locationId, quantity),
    db.prepare(`INSERT INTO stock_movements
      (id,movement_type,product_id,quantity,from_location_id,inventory_status,source_document_type,
       source_document_id,source_line_id,sales_order_line_id,posted_at,posted_by,unit_cost_cents,idempotency_key)
      SELECT ?,'sales_shipment',?,? ,?,'usable','shipment',?,?,?,?,?,?,? WHERE ${exists}`)
      .bind(movementId, line.productId, -quantity, balance.locationId, shipmentId, shipmentLineId, line.id, now, actor, valuation.unitCostCents, input.idempotencyKey),
    valueEntryPrepared(input, { productId: line.productId, movementId, entryType: "shipment", quantity: -quantity,
      unitCostCents: valuation.unitCostCents, valueCents: -valuation.valueCents, method: valuation.method,
      referenceType: "shipment", referenceId: shipmentId, postedAt: now, postedBy: actor }),
    ...layerConsumptionPrepared(input, valuation.layers),
    db.prepare(`INSERT INTO customer_invoices
      (id,number,customer_id,sales_order_id,status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,
       currency,exchange_rate_to_base,base_total_cents,tax_rate_bps,tax_code,payment_terms,posted_at,posted_by,version)
      SELECT ?,?,?,?,'posted',?,?,?,?,?,0,?,?,?,?,?,?,?,?,1 WHERE ${exists}`)
      .bind(invoiceId, invoiceNumber, source.customerId, input.entityId, postingDate, dueDate, subtotal, tax, total,
        source.currency, source.exchange, baseTotal, headerTaxRate, headerTaxCode, source.paymentTerms, now, actor),
    db.prepare(`INSERT INTO customer_invoice_lines
      (id,customer_invoice_id,sales_order_line_id,product_id,quantity,unit_price_cents,line_total_cents)
      SELECT ?,?,?,?,?,?,? WHERE ${exists}`).bind(newId("invoice-line"), invoiceId, line.id, line.productId, quantity, source.unitPrice, lineTotal),
  ];
  orderCharges.forEach((charge) => statements.push(db.prepare(`INSERT INTO document_charges
    (id,document_type,document_id,charge_type,description,amount_cents,direction,taxable,refundable,tax_code,tax_rate_bps,tax_amount_cents,created_at)
    SELECT ?,'customer_invoice',?,?,?,?,?,?,?,?,?,?,? WHERE ${exists}`)
    .bind(newId("charge"), invoiceId, charge.chargeType, charge.description, charge.amount, charge.direction,
      charge.taxable, charge.refundable, charge.taxCode, charge.taxRate, Math.abs(charge.taxAmount), now)));
  if (tracking.policy !== "quantity") statements.push(db.prepare(`INSERT INTO movement_assignments
    (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${exists}`)
    .bind(newId("assignment"), movementId, tracking.lotId, tracking.unitId, quantity));
  if (tracking.policy === "serial") statements.push(db.prepare(`UPDATE inventory_units SET lifecycle_status='shipped',version=version+1
    WHERE id=? AND product_id=? AND location_id=? AND inventory_status='usable' AND lifecycle_status='on_hand'
      AND allocated_sales_order_line_id IS NULL AND version=? AND ${exists}`)
    .bind(tracking.unitId, line.productId, balance.locationId, tracking.unitVersion));
  statements.push(
    db.prepare(`UPDATE sales_orders SET billing_status=CASE WHEN NOT EXISTS (SELECT 1 FROM sales_order_lines sol WHERE sol.sales_order_id=sales_orders.id AND
      MAX(sol.ordered_qty-sol.canceled_qty,0)
      >COALESCE((SELECT SUM(cil.quantity) FROM customer_invoice_lines cil JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id WHERE cil.sales_order_line_id=sol.id AND ci.status<>'void'),0))
      THEN 'invoiced' ELSE 'partially_invoiced' END,version=version+1 WHERE id=? AND version=? AND ${exists}`)
      .bind(input.entityId, input.version),
    auditPrepared(input, "sales_order", input.entityId, "immediate_sale_posted", result.message,
      { quantity, locationId: balance.locationId, shipmentId, shipmentNumber, invoiceId, invoiceNumber, totalCents: total,
        cogsCents: valuation.valueCents, costMethod: valuation.method }, now),
    auditPrepared(input, "customer_invoice", invoiceId, "customer_invoice_posted", result.message,
      { salesOrderId: input.entityId, shipmentId, quantity, total: total, base: baseTotal, discount, charges: orderCharges.length }, now),
    outboxPrepared(input, "inventory.shipment_posted", "shipment", shipmentId,
      { salesOrderId: input.entityId, productId: line.productId, quantity, carrier, serviceLevel, cogsCents: valuation.valueCents }, now),
    outboxPrepared(input, "customer_invoice.posted", "customer_invoice", invoiceId,
      { salesOrderId: input.entityId, shipmentId, total, base: baseTotal }, now),
  );
  await db.batch(statements);
  return requireLogged(input, "Inventory, pricing, or the sales order changed before the immediate sale could post.");
}

async function postCustomerReturn(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const reason = requiredText(payload, "reason");
  const line = await getSalesLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  const quantity = (await normalizedQuantity({ productId: line.productId, quantity: positive(payload), uomId: typeof payload.uomId === "string" ? payload.uomId : null, usage: "sales", field: "quantity" })).baseQuantity;
  if (!["confirmed", "canceled"].includes(line.lifecycleStatus)) throw new DomainError("INVALID_STATE", "Customer returns require a confirmed or canceled sales order with posted shipment history.", 409, line.version);
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The sales order changed. Refresh before receiving the return.", 409, line.version);
  const remainingReturnable = roundQuantity(line.shippedQty - line.returnedQty);
  if (quantity > remainingReturnable) throw new DomainError("INVALID_QUANTITY", `Only ${Math.max(remainingReturnable, 0)} shipped units remain returnable.`, 409, line.version);
  const condition = optionalText(payload, "condition", "quarantine");
  if (!["usable", "quarantine", "damaged"].includes(condition)) throw new DomainError("VALIDATION_ERROR", "condition must be usable, quarantine, or damaged.");
  const locationId = requiredText(payload, "locationId");
  await requireActiveLocation(locationId, condition === "usable" ? ["usable"] : ["quarantine", "damaged"], "customer-return inventory");
  const tracking = await returnTracking(line.productId, line.id, quantity, payload);
  const historicalUnitCostCents = await historicalShipmentUnitCost(line.id, line.productId);
  const valuation = await valuationForReceipt(line.productId, quantity, historicalUnitCostCents);
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const returnId = newId("customer-return");
  const movementId = newId("movement");
  const returnNumber = await nextDocumentNumber("RMA");
  const now = postingTimestamp(payload);
  const result: CommandResult = {
    message: `${returnNumber} received for ${quantity} unit${quantity === 1 ? "" : "s"}.`,
    impact: { physical: `${quantity} units added to ${condition === "usable" ? "usable" : "quarantine"} on-hand inventory.`, commercial: "Original shipped quantity remains fulfilled; replacement demand is separate.", financial: `Inventory value increased by ${valuation.valueCents} cents; refund or credit remains a separate financial decision.`, onHandDelta: quantity, incomingDelta: 0, reservedDelta: 0, availableDelta: condition === "usable" ? quantity : 0 },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  const commands: D1PreparedStatement[] = [
    logPrepared(input, result, "sales_orders", `AND COALESCE((SELECT version FROM valuation_policies WHERE product_id = ?), 0) = ?${tracking.claimSql} AND EXISTS (SELECT 1 FROM locations WHERE id=? AND active=1 AND inventory_status ${condition === "usable" ? "='usable'" : "IN ('quarantine','damaged')"})`, [line.productId, valuation.version, ...tracking.claimBindings, locationId]),
    db.prepare(`UPDATE sales_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`).bind(input.entityId, input.version),
    db.prepare(`INSERT INTO valuation_policies
      (product_id, method, standard_cost_cents, average_cost_cents, version, updated_at, updated_by)
      SELECT ?, ?, ?, ?, 1, ?, ? WHERE ${exists}
      ON CONFLICT(product_id) DO NOTHING`)
      .bind(line.productId, valuation.method, valuation.standardCostCents, valuation.averageCostCents, now, actor),
    db.prepare(`INSERT INTO customer_returns
      (id, number, sales_order_id, sales_order_line_id, product_id, location_id, quantity, condition, financial_resolution, posted_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ? WHERE ${exists}`)
      .bind(returnId, returnNumber, input.entityId, line.id, line.productId, locationId, quantity, condition, now),
    db.prepare(`INSERT INTO inventory_balances (product_id, location_id, on_hand_qty, reserved_qty, version)
                SELECT ?, ?, ?, 0, 1 WHERE ${exists}
                ON CONFLICT(product_id, location_id) DO UPDATE SET on_hand_qty = ROUND(on_hand_qty + excluded.on_hand_qty, 6), version = version + 1`)
      .bind(line.productId, locationId, quantity),
    db.prepare(`INSERT INTO stock_movements
      (id, movement_type, product_id, quantity, to_location_id, inventory_status, source_document_type,
       source_document_id, sales_order_line_id, posted_at, posted_by, unit_cost_cents, idempotency_key)
      SELECT ?, 'customer_return', ?, ?, ?, ?, 'customer_return', ?, ?, ?, ?, ?, ? WHERE ${exists}`)
      .bind(movementId, line.productId, quantity, locationId, condition === "usable" ? "usable" : "quarantine", returnId, line.id, now, actor, valuation.unitCostCents, input.idempotencyKey),
    db.prepare(`INSERT INTO cost_layers
      (id, product_id, receipt_movement_id, received_qty, remaining_qty, unit_cost_cents, landed_cost_cents, received_at, status)
      SELECT ?, ?, ?, ?, ?, ?, 0, ?, 'open' WHERE ${exists}`)
      .bind(newId("layer"), line.productId, movementId, quantity, quantity, historicalUnitCostCents, now),
    valueEntryPrepared(input, { productId: line.productId, movementId, entryType: "customer_return",
      quantity, unitCostCents: valuation.unitCostCents, valueCents: valuation.valueCents,
      method: valuation.method, referenceType: "customer_return", referenceId: returnId, postedAt: now, postedBy: actor }),
    auditPrepared(input, "sales_order", input.entityId, "customer_return_received", result.message,
      { reason, condition, quantity, returnId, movementId, inventoryValueCents: valuation.valueCents, costMethod: valuation.method }, now),
    outboxPrepared(input, "inventory.customer_return_received", "customer_return", returnId,
      { salesOrderId: input.entityId, productId: line.productId, quantity, inventoryValueCents: valuation.valueCents }, now),
  ];
  if (tracking.policy !== "quantity") commands.push(db.prepare(`INSERT INTO movement_assignments (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${exists}`).bind(newId("assignment"), movementId, tracking.lotId, tracking.unitId, quantity));
  if (tracking.policy === "serial") commands.push(db.prepare(`UPDATE inventory_units SET location_id=?,inventory_status=?,lifecycle_status='on_hand',version=version+1 WHERE id=? AND product_id=? AND lifecycle_status='shipped' AND version=? AND ${exists}`).bind(locationId, condition === "usable" ? "usable" : "quarantine", tracking.unitId, line.productId, tracking.unitVersion));
  if (valuation.method === "average") {
    commands.push(db.prepare(`UPDATE valuation_policies SET average_cost_cents = ?, version = version + 1, updated_at = ?, updated_by = ?
        WHERE product_id = ? AND method = 'average' AND ((? = 0 AND version = 1) OR version = ?) AND ${exists}`)
        .bind(valuation.nextAverageCostCents, now, actor, line.productId, valuation.version, valuation.version));
  }
  await db.batch(commands);
  return requireLogged(input, "The sales order changed before the customer return could be received.");
}

async function postInventoryAdjustment(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const locationId = requiredText(payload, "locationId");
  const countedQuantity = (await normalizedBaseQuantity(input.entityId, asNumber(payload, "countedQuantity"), "countedQuantity", true)).baseQuantity;
  const reason = requiredText(payload, "reason");
  const openingBalance = normalizeCommand(input.command) === "postopeningbalance";
  const existingBalance = await first<{ onHandQty: number; reservedQty: number; version: number }>(
    "SELECT on_hand_qty AS onHandQty, reserved_qty AS reservedQty, version FROM inventory_balances WHERE product_id = ? AND location_id = ?",
    input.entityId, locationId
  );
  // A first count or opening balance for a product/location pair has no balance row yet. Create
  // it (0 on hand, 0 reserved, version 1) inside the same batch instead of refusing the posting.
  const creatingBalance = !existingBalance;
  const product = await first<{ inventoryPolicy: string; trackingPolicy: string }>("SELECT inventory_policy AS inventoryPolicy, tracking_policy AS trackingPolicy FROM products WHERE id = ? AND active = 1", input.entityId);
  if (!product) throw new DomainError("NOT_FOUND", "Product was not found or is inactive.", 404);
  if (creatingBalance) {
    if (!["stocked", "special_order"].includes(product.inventoryPolicy)) throw new DomainError("NOT_STOCKED", `This product's inventory policy is ${product.inventoryPolicy}; only stocked products can hold a counted balance.`, 409);
    if (input.version !== 1) throw new DomainError("VERSION_CONFLICT", "No inventory balance exists yet for this product and location; post the count at version 1.", 409, 1);
  }
  const balance = existingBalance ?? { onHandQty: 0, reservedQty: 0, version: 1 };
  if (balance.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The inventory balance changed. Refresh before posting the count.", 409, balance.version);
  if (countedQuantity < balance.reservedQty) throw new DomainError("RESERVATION_CONFLICT", `Counted quantity cannot be below ${balance.reservedQty} actively reserved units.`, 409, balance.version);
  if (openingBalance && (balance.onHandQty !== 0 || balance.reservedQty !== 0)) throw new DomainError("OPENING_BALANCE_EXISTS", "Opening inventory can only be posted to an empty, unreserved product/location balance.", 409, balance.version);
  const location = await requireActiveLocation(locationId, ["usable", "quarantine", "damaged", "return_pending", "in_transit"], openingBalance ? "opening inventory" : "inventory count");
  const delta = roundQuantity(countedQuantity - balance.onHandQty);
  // Lot- and serial-tracked stock is identified unit by unit. A quantity-only count would put
  // anonymous units on hand that nothing can ship, so the identity ledger has to be corrected
  // through registration or scrap of the specific lot or serial instead.
  if (delta !== 0 && product.trackingPolicy !== "quantity") {
    const identity = product.trackingPolicy === "lot" ? "lot" : "serial number";
    throw new DomainError("TRACKED_PRODUCT_COUNT", `This product is ${product.trackingPolicy}-tracked, so a count cannot ${delta > 0 ? "add" : "remove"} ${Math.abs(delta)} anonymous unit${Math.abs(delta) === 1 ? "" : "s"}. Register the specific ${identity} (registerInventoryIdentity) or scrap it (scrapInventory) so the balance and the identity ledger agree.`, 409, balance.version);
  }
  const lossValuation = delta < 0 ? await valuationForIssue(input.entityId, Math.abs(delta)) : null;
  const policy = delta > 0 ? await valuationPolicy(input.entityId) : null;
  const gainActualUnitCostCents = delta > 0
    ? payload.unitCostCents == null
      ? (policy?.averageCostCents || policy?.standardCostCents || 0)
      : Math.round(asNumber(payload, "unitCostCents"))
    : 0;
  if (gainActualUnitCostCents < 0) throw new DomainError("VALIDATION_ERROR", "unitCostCents cannot be negative.");
  if (openingBalance && delta > 0 && payload.unitCostCents == null) throw new DomainError("VALIDATION_ERROR", "Opening inventory requires unitCostCents.");
  const gainValuation = delta > 0 ? await valuationForReceipt(input.entityId, delta, gainActualUnitCostCents) : null;
  const inventoryValueDeltaCents = lossValuation ? -lossValuation.valueCents : gainValuation?.valueCents ?? 0;
  const approval = openingBalance ? null : await countApprovalForVariance(input, locationId, balance.onHandQty, countedQuantity, inventoryValueDeltaCents);
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const countId = newId("count");
  const movementId = newId("movement");
  const countNumber = await nextDocumentNumber("CNT");
  const now = postingTimestamp(payload);
  const result: CommandResult = {
    message: openingBalance
      ? delta === 0 ? `${countNumber} posted with no opening quantity.` : `${countNumber} posted ${delta} opening units.`
      : delta === 0 ? `${countNumber} posted with no variance.` : `${countNumber} posted with a ${delta > 0 ? "+" : ""}${delta} unit variance.`,
    countId,
    countNumber,
    impact: { physical: delta === 0 ? "Ledger and physical count agree; no movement created." : `${Math.abs(delta)} unit ${delta > 0 ? "gain" : "loss"} posted.`, commercial: "Orders and commitments are unchanged.", financial: `Inventory value changed by ${inventoryValueDeltaCents} cents; no invoice or bill was created.`, onHandDelta: delta, incomingDelta: 0, reservedDelta: 0, availableDelta: delta },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  let claimPredicate = creatingBalance ? "" : "AND on_hand_qty >= reserved_qty";
  const claimBindings: Array<string | number> = [];
  if (lossValuation) {
    claimPredicate += ` ${layerClaimPredicate(lossValuation.layers)}`;
    claimBindings.push(...layerClaimBindings(lossValuation.layers));
  }
  if (gainValuation) {
    claimPredicate += " AND COALESCE((SELECT version FROM valuation_policies WHERE product_id = ?), 0) = ?";
    claimBindings.push(input.entityId, gainValuation.version);
  }
  if (approval) {
    claimPredicate += " AND EXISTS (SELECT 1 FROM approvals WHERE id = ? AND version = ? AND status = 'approved' AND consumed_at IS NULL)";
    claimBindings.push(approval.id, approval.version);
  }
  const commands: D1PreparedStatement[] = [
    creatingBalance
      // No balance row exists to claim against, so the claim is anchored on the active product
      // and location and on the row still being absent when the batch runs.
      ? statement(`INSERT OR IGNORE INTO command_log (idempotency_key, command, entity_id, response_json, request_hash, claim_token, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ? FROM products p WHERE p.id = ? AND p.active = 1
            AND EXISTS (SELECT 1 FROM locations l WHERE l.id = ? AND l.active = 1)
            AND NOT EXISTS (SELECT 1 FROM inventory_balances ib WHERE ib.product_id = ? AND ib.location_id = ?) ${claimPredicate}`,
          input.idempotencyKey, input.command, input.entityId, JSON.stringify(result), input.requestHash ?? null, input.claimToken ?? null, new Date().toISOString(),
          input.entityId, locationId, input.entityId, locationId, ...claimBindings)
      : logPrepared(input, result, "inventory_balances", claimPredicate, claimBindings),
    ...(creatingBalance ? [db.prepare(`INSERT OR IGNORE INTO inventory_balances (product_id, location_id, on_hand_qty, reserved_qty, version)
        SELECT ?, ?, 0, 0, 1 WHERE ${exists}`).bind(input.entityId, locationId)] : []),
    db.prepare(`UPDATE inventory_balances SET on_hand_qty = ?, version = version + 1
                WHERE product_id = ? AND location_id = ? AND version = ? AND ? >= reserved_qty AND ${exists}`)
      .bind(countedQuantity, input.entityId, locationId, input.version, countedQuantity),
    db.prepare(`INSERT INTO inventory_counts
      (id, number, product_id, location_id, recorded_qty, counted_qty, variance_qty, status, reason, counted_at, counted_by,count_session_id,count_session_line_id)
      SELECT ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?,?,? WHERE ${exists}`)
      .bind(countId, countNumber, input.entityId, locationId, balance.onHandQty, countedQuantity, delta, reason, now, actor,
        typeof payload.countSessionId === "string" ? payload.countSessionId : null,
        typeof payload.countSessionLineId === "string" ? payload.countSessionLineId : null),
  ];
  if (delta !== 0) {
    commands.push(
      db.prepare(`INSERT INTO stock_movements
        (id, movement_type, product_id, quantity, from_location_id, to_location_id, inventory_status,
         source_document_type, source_document_id, posted_at, posted_by, unit_cost_cents, idempotency_key)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${exists}`)
        .bind(movementId, openingBalance ? "opening_balance" : delta > 0 ? "inventory_adjustment_gain" : "inventory_adjustment_loss", input.entityId, delta,
          delta < 0 ? locationId : null, delta > 0 ? locationId : null, location.inventoryStatus,
          openingBalance ? "opening_balance" : "inventory_count", countId, now, actor,
          lossValuation?.unitCostCents ?? gainValuation?.unitCostCents ?? 0, input.idempotencyKey),
      valueEntryPrepared(input, { productId: input.entityId, movementId,
        entryType: openingBalance ? "opening_balance" : delta > 0 ? "inventory_adjustment_gain" : "inventory_adjustment_loss", quantity: delta,
        unitCostCents: lossValuation?.unitCostCents ?? gainValuation?.unitCostCents ?? 0,
        valueCents: inventoryValueDeltaCents,
        method: lossValuation?.method ?? gainValuation?.method ?? "fifo",
        referenceType: openingBalance ? "opening_balance" : "inventory_count", referenceId: countId, postedAt: now, postedBy: actor })
    );
  }
  if (lossValuation) commands.push(...layerConsumptionPrepared(input, lossValuation.layers));
  if (gainValuation) {
    commands.push(
      db.prepare(`INSERT INTO valuation_policies
        (product_id, method, standard_cost_cents, average_cost_cents, version, updated_at, updated_by)
        SELECT ?, ?, ?, ?, 1, ?, ? WHERE ${exists} ON CONFLICT(product_id) DO NOTHING`)
        .bind(input.entityId, gainValuation.method, gainValuation.standardCostCents, gainValuation.averageCostCents, now, actor),
      db.prepare(`INSERT INTO cost_layers
        (id, product_id, receipt_movement_id, received_qty, remaining_qty, unit_cost_cents, landed_cost_cents, received_at, status)
        SELECT ?, ?, ?, ?, ?, ?, 0, ?, 'open' WHERE ${exists}`)
        .bind(newId("layer"), input.entityId, movementId, delta, delta, gainActualUnitCostCents, now)
    );
    if (gainValuation.method === "average") {
      commands.push(db.prepare(`UPDATE valuation_policies SET average_cost_cents = ?, version = version + 1, updated_at = ?, updated_by = ?
        WHERE product_id = ? AND method = 'average' AND ((? = 0 AND version = 1) OR version = ?) AND ${exists}`)
        .bind(gainValuation.nextAverageCostCents, now, actor, input.entityId, gainValuation.version, gainValuation.version));
    }
  }
  if (approval) {
    commands.push(db.prepare(`UPDATE approvals
      SET consumed_at = ?, consumed_by = ?, consumed_entity_id = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = 'approved' AND consumed_at IS NULL AND ${exists}`)
      .bind(now, actor, countId, approval.id, approval.version));
  }
  commands.push(
    auditPrepared(input, "product", input.entityId, openingBalance ? "opening_inventory_posted" : "inventory_count_posted", result.message,
      { reason, locationId, recordedQuantity: balance.onHandQty, countedQuantity, approvalId: approval?.id ?? null,
        movementId: delta === 0 ? null : movementId, inventoryValueDeltaCents }, now),
    outboxPrepared(input, openingBalance ? "inventory.opening_balance_posted" : "inventory.count_posted", "inventory_count", countId,
      { productId: input.entityId, locationId, recordedQuantity: balance.onHandQty, countedQuantity,
        varianceQuantity: delta, inventoryValueDeltaCents, approvalId: approval?.id ?? null }, now)
  );
  await db.batch(commands);
  return requireLogged(input, "The inventory balance changed before the count could be posted.");
}

export async function executeInventoryCommand(input: InventoryCommand): Promise<CommandResult> {
  await ensureDatabase();
  validateEnvelope(input);
  input.claimToken = crypto.randomUUID();
  input.requestHash = await requestHash(input);
  const prior = await currentOrConflict(input);
  if (prior) return prior;
  const normalizedCommand = normalizeCommand(input.command);
  const postingDate = postingDateValue(input.payload ?? {});
  if (["receive", "postreceipt", "postreceiptbatch", "reversereceipt", "vendorreturn", "postvendorreturn", "ship", "shipsale", "postshipment", "immediatesale", "shipandinvoice", "postimmediatesale", "countersale", "postcountersale", "customerreturn", "postcustomerreturn", "inventoryadjustment", "postinventoryadjustment", "postopeningbalance"].includes(normalizedCommand)) {
    await assertPeriodOpen("inventory", postingDate);
  }
  if (["receive", "postreceipt", "postreceiptbatch", "reversereceipt", "vendorreturn", "postvendorreturn", "priceonlycredit", "vendorpriceallowance"].includes(normalizedCommand)) await assertPeriodOpen("purchasing", postingDate);
  if (["ship", "shipsale", "postshipment", "immediatesale", "shipandinvoice", "postimmediatesale", "countersale", "postcountersale", "customerreturn", "postcustomerreturn"].includes(normalizedCommand)) await assertPeriodOpen("sales", postingDate);
  if (["priceonlycredit", "vendorpriceallowance", "immediatesale", "shipandinvoice", "postimmediatesale", "countersale", "postcountersale"].includes(normalizedCommand)) await assertPeriodOpen("accounting", postingDate);
  switch (normalizedCommand) {
    case "receive":
    case "postreceipt": return postReceipt(input);
    case "postreceiptbatch": return postReceiptBatch(input);
    case "closeremainder":
    case "closepurchaseorder": return closeRemainder(input);
    case "reopenremainder":
    case "reopenpurchaseorder": return reopenRemainder(input);
    case "reversereceipt": return reverseReceipt(input);
    case "vendorreturn":
    case "postvendorreturn": return postVendorReturn(input);
    case "priceonlycredit":
    case "vendorpriceallowance": return postPriceOnlyCredit(input);
    case "reserve":
    case "reservesale": return reserveSale(input);
    case "ship":
    case "shipsale":
    case "postshipment": return shipSale(input);
    case "immediatesale":
    case "shipandinvoice":
    case "postimmediatesale": return postImmediateSale(input);
    case "countersale":
    case "postcountersale": return postCounterSale(input);
    case "customerreturn":
    case "postcustomerreturn": return postCustomerReturn(input);
    case "inventoryadjustment":
    case "postinventoryadjustment": return postInventoryAdjustment(input);
    case "postopeningbalance": return postInventoryAdjustment(input);
    default: throw new DomainError("UNKNOWN_COMMAND", `Unsupported command: ${input.command}.`);
  }
}

export type SnapshotPage = {
  page?: number; pageSize?: number; search?: string; scope?: string; status?: string; sort?: string; warehouseId?: string;
  /** The viewer's local calendar date (YYYY-MM-DD). "Late" and every other "today" comparison use it instead of UTC now. */
  asOf?: string;
};

export function normalizeSnapshotPage(input: SnapshotPage = {}) {
  const page = Number.isInteger(input.page) && Number(input.page) > 0 ? Number(input.page) : 1;
  const pageSize = Number.isInteger(input.pageSize) ? Math.min(Math.max(Number(input.pageSize), 1), 100) : 50;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * "Still owes goods" predicates, shared by the worklist filters and the partner reference
 * lookups. Lifecycle alone cannot answer this: a purchase order stays `approved` and a sales
 * order stays `confirmed` long after the last unit moved, so both must be measured against the
 * quantity remaining on their lines. The fragments carry no bindings, so any query can splice
 * them in without disturbing its positional parameters.
 */
const purchaseLineFulfilledQuantity = (line: string) => `(CASE WHEN ${line}.fulfillment_route='drop_ship'
  THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=${line}.id),0)
  ELSE COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=${line}.id),0) END)`;
const salesLineFulfilledQuantity = (line: string) => `(CASE WHEN ${line}.fulfillment_route='drop_ship'
  THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.sales_order_line_id=${line}.id),0)
  ELSE COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity
    WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=${line}.id),0) END)`;
export const purchaseOpenLines = (order: string) => `EXISTS (SELECT 1 FROM purchase_order_lines pl WHERE pl.purchase_order_id=${order}.id
  AND pl.ordered_qty-pl.closed_qty-${purchaseLineFulfilledQuantity("pl")}>0)`;
const purchaseReceiptOpenLines = (order: string) => `EXISTS (SELECT 1 FROM purchase_order_lines pl WHERE pl.purchase_order_id=${order}.id
  AND pl.fulfillment_route<>'drop_ship' AND pl.ordered_qty-pl.closed_qty-${purchaseLineFulfilledQuantity("pl")}>0)`;
export const salesOpenLines = (order: string) => `EXISTS (SELECT 1 FROM sales_order_lines sl WHERE sl.sales_order_id=${order}.id
  AND sl.ordered_qty-sl.canceled_qty-${salesLineFulfilledQuantity("sl")}>0)`;

/**
 * The default ("priority") worklist order for orders: still-open approved/confirmed documents
 * first, then by date and number. The worklist page query and the global search's page
 * calculation must use exactly this expression or search lands on the wrong page. Callers pass
 * the SQL for the order's open quantity, since each query derives it from different CTEs.
 */
export const purchaseOrderPriorityOrder = (order: string, openQuantity: string) =>
  `CASE WHEN ${order}.lifecycle_status='approved' AND ${openQuantity} > 0 THEN 0 ELSE 1 END,${order}.expected_date,${order}.number`;
export const salesOrderPriorityOrder = (order: string, openQuantity: string) =>
  `CASE WHEN ${order}.lifecycle_status='draft' THEN 0
              WHEN ${order}.lifecycle_status='confirmed' AND ${openQuantity} > 0 THEN 0
              ELSE 1 END,${order}.requested_date,${order}.number`;
/** Open-quantity expressions for queries that have no line CTEs to draw on. */
export const purchaseOpenQuantity = (order: string) => `(SELECT COALESCE(SUM(pl.ordered_qty-pl.closed_qty-${purchaseLineFulfilledQuantity("pl")}),0)
  FROM purchase_order_lines pl WHERE pl.purchase_order_id=${order}.id)`;
export const salesOpenQuantity = (order: string) => `(SELECT COALESCE(SUM(sl.ordered_qty-sl.canceled_qty-${salesLineFulfilledQuantity("sl")}),0)
  FROM sales_order_lines sl WHERE sl.sales_order_id=${order}.id)`;

/**
 * Stock movements store the internal id of whatever document created them. These fragments
 * resolve that id to the number an operator can look up, for every source_document_type the
 * server writes, and resolve the related order even for reversal rows (which carry the
 * original document's id) so the worklist can both display and search by those numbers.
 */
const movementDocumentNumber = (sm: string) => `CASE ${sm}.source_document_type
        WHEN 'receipt' THEN (SELECT r.number FROM receipts r WHERE r.id=${sm}.source_document_id)
        WHEN 'receipt_reversal' THEN (SELECT r.number FROM receipts r WHERE r.id=${sm}.source_document_id)
        WHEN 'shipment' THEN (SELECT s.number FROM shipments s WHERE s.id=${sm}.source_document_id)
        WHEN 'shipment_reversal' THEN (SELECT s.number FROM shipments s WHERE s.id=${sm}.source_document_id)
        WHEN 'vendor_return' THEN (SELECT vr.number FROM vendor_returns vr WHERE vr.id=${sm}.source_document_id)
        WHEN 'customer_return' THEN (SELECT cr.number FROM customer_returns cr WHERE cr.id=${sm}.source_document_id)
        WHEN 'inventory_count' THEN (SELECT ic.number FROM inventory_counts ic WHERE ic.id=${sm}.source_document_id)
        WHEN 'opening_balance' THEN COALESCE((SELECT ic.number FROM inventory_counts ic WHERE ic.id=${sm}.source_document_id),${sm}.source_document_id)
        WHEN 'inventory_transfer' THEN (SELECT it.number FROM inventory_transfers it WHERE it.id=${sm}.source_document_id)
        WHEN 'drop_ship_delivery' THEN (SELECT d.number FROM drop_ship_deliveries d WHERE d.id=${sm}.source_document_id)
        WHEN 'drop_ship' THEN (SELECT d.number FROM drop_ship_deliveries d WHERE d.id=${sm}.source_document_id)
      END`;
const movementPurchaseLineId = (sm: string) => `COALESCE(${sm}.purchase_order_line_id,(SELECT o.purchase_order_line_id FROM stock_movements o WHERE o.id=${sm}.reversal_of_movement_id))`;
const movementSalesLineId = (sm: string) => `COALESCE(${sm}.sales_order_line_id,(SELECT o.sales_order_line_id FROM stock_movements o WHERE o.id=${sm}.reversal_of_movement_id))`;
const movementPurchaseOrderId = (sm: string) => `COALESCE((SELECT pl.purchase_order_id FROM purchase_order_lines pl WHERE pl.id=${movementPurchaseLineId(sm)}),
        CASE WHEN ${sm}.source_document_type IN ('receipt','receipt_reversal') THEN (SELECT r.purchase_order_id FROM receipts r WHERE r.id=${sm}.source_document_id)
             WHEN ${sm}.source_document_type='vendor_return' THEN (SELECT vr.purchase_order_id FROM vendor_returns vr WHERE vr.id=${sm}.source_document_id) END)`;
const movementSalesOrderId = (sm: string) => `COALESCE((SELECT sl.sales_order_id FROM sales_order_lines sl WHERE sl.id=${movementSalesLineId(sm)}),
        CASE WHEN ${sm}.source_document_type IN ('shipment','shipment_reversal') THEN (SELECT s.sales_order_id FROM shipments s WHERE s.id=${sm}.source_document_id)
             WHEN ${sm}.source_document_type='customer_return' THEN (SELECT cr.sales_order_id FROM customer_returns cr WHERE cr.id=${sm}.source_document_id) END)`;
const movementRelatedOrderId = (sm: string) => `COALESCE(${movementPurchaseOrderId(sm)},${movementSalesOrderId(sm)})`;
const movementRelatedOrderNumber = (sm: string) => `COALESCE((SELECT po.number FROM purchase_orders po WHERE po.id=${movementPurchaseOrderId(sm)}),
        (SELECT so.number FROM sales_orders so WHERE so.id=${movementSalesOrderId(sm)}))`;
const movementRelatedOrderKind = (sm: string) => `CASE WHEN ${movementPurchaseOrderId(sm)} IS NOT NULL THEN 'purchase' WHEN ${movementSalesOrderId(sm)} IS NOT NULL THEN 'sales' END`;

/**
 * Per-movement reversible quantity for the latest receipt on a PO line: what is physically
 * still on hand from that movement (net of prior reversals, capped by the bin's unreserved
 * stock). Cost-layer remainder is deliberately not a cap any more; a consumed layer is funded
 * from other layers with a variance at reversal time.
 */
const latestReceiptMovementFilter = (line: string) => `receipt_movement.purchase_order_line_id=${line}.id AND receipt_movement.movement_type='purchase_receipt'
          AND receipt_movement.source_document_type='receipt'
          AND receipt_movement.source_document_id=(SELECT latest_receipt.id FROM receipts latest_receipt
            WHERE latest_receipt.purchase_order_id=${line}.purchase_order_id ORDER BY latest_receipt.posted_at DESC,latest_receipt.id DESC LIMIT 1)`;
const receiptMovementRemaining = `receipt_movement.quantity + COALESCE((SELECT SUM(reversal.quantity)
        FROM stock_movements reversal WHERE reversal.reversal_of_movement_id=receipt_movement.id AND reversal.movement_type='receipt_reversal'),0)`;
// Unreserved stock in the receipt's bin plus the reservation quantity the reversal itself can
// release through the receipt's supply-allocation lineage (auto-reserved special orders).
const receiptMovementAvailable = `COALESCE((SELECT MAX(balance.on_hand_qty-balance.reserved_qty) FROM inventory_balances balance
          WHERE balance.product_id=receipt_movement.product_id AND balance.location_id=receipt_movement.to_location_id),0)
        + COALESCE((SELECT SUM(MIN(r.quantity,sar.quantity-sar.reversed_qty)) FROM supply_allocation_receipts sar
          JOIN reservations r ON r.id=sar.reservation_id AND r.status='active' WHERE sar.receipt_movement_id=receipt_movement.id),0)`;
const receiptMovementReversible = `MAX(MIN(${receiptMovementRemaining},${receiptMovementAvailable}),0)`;

export async function getInventorySnapshot(input: SnapshotPage = {}) {
  await ensureDatabase();
  const { page, pageSize, offset } = normalizeSnapshotPage(input);
  // Empty means "all active locations"; a value scopes physical balances to one warehouse.
  const warehouseScope = typeof input.warehouseId === "string" ? input.warehouseId.trim() : "";
  const pageAll = <T>(sql: string, ...bindings: Array<string | number | null>) => all<T>(`${sql}\nLIMIT ? OFFSET ?`, ...bindings, pageSize, offset);
  const referenceAll = <T>(sql: string) => all<T>(`${sql}\nLIMIT ?`, 250);
  const childLimit = Math.min(pageSize * 20, 1000);
  const term = input.search?.trim() ?? "";
  const like = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  // The viewer's local calendar date. It is admitted only as a strict YYYY-MM-DD calendar date,
  // so it can be spliced as a literal into the binding-free worklist fragments; anything else
  // falls back to the database clock (UTC today).
  const requestedAsOf = typeof input.asOf === "string" ? input.asOf.trim() : "";
  const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedAsOf) && new Date(`${requestedAsOf}T00:00:00.000Z`).toISOString().slice(0, 10) === requestedAsOf ? requestedAsOf : "";
  const todaySql = asOfDate ? `'${asOfDate}'` : "date(" + "'now')";
  const status = input.status?.trim() ?? "";
  const scope = input.scope?.trim() ?? "";
  const sort = input.sort?.trim() ?? "priority";
  const requestedColumnSort = /^([A-Za-z][A-Za-z0-9]*):(asc|desc)$/.exec(sort);
  /** Column names and directions arrive from the browser, but SQL expressions never do. Each
   *  worklist selects from a fixed expression map and the direction is reduced to two literals. */
  const columnOrder = (columns: Record<string, string>, fallback: string, tieBreaker: string) => {
    if (!requestedColumnSort) return fallback;
    const expression = columns[requestedColumnSort[1]];
    if (!expression) return fallback;
    const direction = requestedColumnSort[2] === "desc" ? "DESC" : "ASC";
    return `${expression} ${direction},${tieBreaker} ${direction}`;
  };
  const requestedPurchaseStatus = ["purchase-orders", "expected-receipts", "vendor-returns"].includes(scope) ? status : "";
  const requestedSalesStatus = ["sales-orders", "fulfillment", "customer-returns", "customer-invoices"].includes(scope) ? status : "";

  /**
   * Purchase orders retain their commercial lifecycle after the physical work is finished, so
   * the completed filters must derive the same quantity state displayed in the worklist. These
   * totals include receipt reversals and vendor returns through the signed movement ledger.
   */
  const purchaseCompletionQuantities = (order: string) => ({
    ordered: `(SELECT COALESCE(SUM(pl.ordered_qty),0) FROM purchase_order_lines pl WHERE pl.purchase_order_id=${order}.id)`,
    closed: `(SELECT COALESCE(SUM(pl.closed_qty),0) FROM purchase_order_lines pl WHERE pl.purchase_order_id=${order}.id)`,
    fulfilled: `(SELECT COALESCE(SUM(${purchaseLineFulfilledQuantity("pl")}),0) FROM purchase_order_lines pl WHERE pl.purchase_order_id=${order}.id)`,
  });
  const purchaseCompletionFilter = (order: string, completion: "closed" | "fully_received" | "closed_short") => {
    const quantity = purchaseCompletionQuantities(order);
    const eligible = `${order}.lifecycle_status NOT IN ('draft','pending_approval','rejected') AND EXISTS (SELECT 1 FROM purchase_order_lines pl WHERE pl.purchase_order_id=${order}.id)`;
    const fullyReceived = `(${eligible} AND ${quantity.fulfilled}=${quantity.ordered})`;
    const closedShort = `(${eligible} AND ${quantity.fulfilled}<${quantity.ordered} AND ${quantity.closed}>0 AND ${quantity.ordered}-${quantity.fulfilled}-${quantity.closed}<=0)`;
    return completion === "fully_received" ? fullyReceived : completion === "closed_short" ? closedShort : `(${fullyReceived} OR ${closedShort})`;
  };

  /**
   * "Open to receive"/"Open to ship"/"Late" are worklist states rather than lifecycle
   * columns, so they resolve to a SQL predicate instead of a bound lifecycle value. The
   * fragments are picked from this fixed set — never interpolated from the request — and
   * carry no bindings, so every query that filters by status can splice them in without
   * disturbing its positional parameters.
   */
  const purchaseWorklistFilter = (order: string) =>
    requestedPurchaseStatus === "open" ? ` AND ${order}.lifecycle_status='approved' AND ${scope === "expected-receipts" ? purchaseReceiptOpenLines(order) : purchaseOpenLines(order)}`
      : requestedPurchaseStatus === "late" ? ` AND ${order}.lifecycle_status='approved' AND ${order}.expected_date<${todaySql} AND ${scope === "expected-receipts" ? purchaseReceiptOpenLines(order) : purchaseOpenLines(order)}`
      : ["closed", "fully_received", "closed_short"].includes(requestedPurchaseStatus) ? ` AND ${purchaseCompletionFilter(order, requestedPurchaseStatus as "closed" | "fully_received" | "closed_short")}`
      : requestedPurchaseStatus === "returnable" ? ` AND EXISTS (SELECT 1 FROM purchase_order_lines pl JOIN stock_movements sm ON sm.purchase_order_line_id=pl.id WHERE pl.purchase_order_id=${order}.id AND sm.movement_type='purchase_receipt')`
      : "";
  const salesBlockedSupply = (order: string) => `EXISTS (
    SELECT 1 FROM (
      SELECT line_demand.product_id,SUM(line_demand.open_qty) open_qty,
             SUM(MIN(line_demand.open_qty,line_demand.reserved_qty)) reserved_qty
        FROM (
          SELECT sl.product_id,
                 MAX(sl.ordered_qty-sl.canceled_qty-${salesLineFulfilledQuantity("sl")},0) open_qty,
                 COALESCE((SELECT SUM(rv.quantity) FROM reservations rv WHERE rv.sales_order_line_id=sl.id AND rv.status='active'),0) reserved_qty
            FROM sales_order_lines sl WHERE sl.sales_order_id=${order}.id AND sl.fulfillment_route<>'drop_ship'
        ) line_demand GROUP BY line_demand.product_id
    ) demand
    WHERE demand.open_qty>demand.reserved_qty
      + COALESCE((SELECT SUM(ib.on_hand_qty-ib.reserved_qty) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE ib.product_id=demand.product_id AND l.active=1 AND l.inventory_status='usable'),0)
      + COALESCE((SELECT SUM(MAX(pol.ordered_qty-pol.closed_qty-
          CASE WHEN pol.fulfillment_route='drop_ship' THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0)
               ELSE COALESCE((SELECT SUM(sm2.quantity) FROM stock_movements sm2 WHERE sm2.purchase_order_line_id=pol.id),0) END
          -COALESCE((SELECT SUM(sa.allocated_qty-sa.received_qty) FROM supply_allocations sa WHERE sa.purchase_order_line_id=pol.id AND sa.status='active'),0),0))
        FROM purchase_order_lines pol JOIN purchase_orders po2 ON po2.id=pol.purchase_order_id
        WHERE pol.product_id=demand.product_id AND po2.lifecycle_status='approved' AND po2.expected_date<=${order}.requested_date),0)
      + COALESCE((SELECT SUM(own_sa.allocated_qty-own_sa.received_qty) FROM supply_allocations own_sa
        JOIN sales_order_lines own_sol ON own_sol.id=own_sa.sales_order_line_id
        JOIN purchase_order_lines own_pol ON own_pol.id=own_sa.purchase_order_line_id
        JOIN purchase_orders own_po ON own_po.id=own_pol.purchase_order_id
        WHERE own_sol.sales_order_id=${order}.id AND own_sol.product_id=demand.product_id AND own_sa.status='active'
          AND own_po.lifecycle_status='approved' AND own_po.expected_date<=${order}.requested_date),0)
  )`;
  const invoiceableSalesLines = (order: string) => `EXISTS (SELECT 1 FROM sales_order_lines invoiceable_line
    WHERE invoiceable_line.sales_order_id=${order}.id
      AND (CASE WHEN invoiceable_line.fulfillment_route='drop_ship'
        THEN COALESCE((SELECT SUM(delivery.quantity-delivery.reversed_qty) FROM drop_ship_deliveries delivery WHERE delivery.sales_order_line_id=invoiceable_line.id),0)
        ELSE COALESCE((SELECT SUM(CASE WHEN movement.movement_type='sales_shipment' THEN -movement.quantity WHEN movement.movement_type='shipment_reversal' THEN -movement.quantity ELSE 0 END) FROM stock_movements movement WHERE movement.sales_order_line_id=invoiceable_line.id),0) END)
      > COALESCE((SELECT SUM(invoice_line.quantity) FROM customer_invoice_lines invoice_line JOIN customer_invoices invoice ON invoice.id=invoice_line.customer_invoice_id WHERE invoice_line.sales_order_line_id=invoiceable_line.id AND invoice.status<>'void'),0))`;
  const salesWorklistFilter = (order: string) =>
    // Customer billing's overview is an action queue, not sales-order history. Keeping fully
    // invoiced counter sales here made a zero-quantity row look like work that still needed posting.
    scope === "customer-invoices" ? ` AND ${invoiceableSalesLines(order)}`
      : requestedSalesStatus === "open" ? ` AND ${order}.lifecycle_status='confirmed' AND ${salesOpenLines(order)}`
      // Active reservation quantities are decremented as shipments post, so any positive
      // remainder is ready to ship. Comparing that remainder with cumulative shipped units
      // hid the last part of a partially shipped reservation.
      : requestedSalesStatus === "reserved" ? ` AND ${order}.lifecycle_status='confirmed'
        AND EXISTS (SELECT 1 FROM sales_order_lines sl JOIN reservations rv ON rv.sales_order_line_id=sl.id
          WHERE sl.sales_order_id=${order}.id AND rv.status='active' AND rv.quantity>0)`
      : requestedSalesStatus === "shipped" ? ` AND EXISTS (SELECT 1 FROM sales_order_lines sl WHERE sl.sales_order_id=${order}.id
          AND COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sl.id),0)
            - COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.sales_order_line_id=sl.id AND sm.movement_type='customer_return'),0) > 0)`
      // Reservations cover their own order before unallocated stock and purchase orders due
      // by the requested date. Grouping lines by product prevents one free unit from covering
      // two separate lines for the same SKU.
      : requestedSalesStatus === "blocked" ? ` AND ${order}.lifecycle_status='confirmed' AND ${salesBlockedSupply(order)}`
      : "";
  /** Sales-order page ordering uses the same fixed column map for the parent page and its
   *  child-line page. That keeps lines attached to the orders selected after any header click. */
  const salesOrderOrder = (order: string, partner: string, totals: string, movements: string, reserved: string, invoiced: string, supply: string) => {
    const open = `CASE WHEN ${order}.lifecycle_status='confirmed' THEN MAX(COALESCE(${totals}.ordered_qty,0)-COALESCE(${totals}.canceled_qty,0)-COALESCE(${totals}.fulfilled_qty,0),0) ELSE 0 END`;
    const committed = `COALESCE(${reserved}.reserved_qty,0)`;
    const available = `COALESCE(${supply}.available_now_qty,0)`;
    const incoming = `COALESCE(${supply}.incoming_supply_qty,0)`;
    const fulfillment = `CASE WHEN ${order}.lifecycle_status='draft' THEN 'draft' WHEN ${order}.lifecycle_status!='confirmed' THEN ${order}.lifecycle_status WHEN COALESCE(${totals}.fulfilled_qty,0)>=COALESCE(${totals}.ordered_qty,0)-COALESCE(${totals}.canceled_qty,0) THEN 'fully_fulfilled' WHEN COALESCE(${totals}.fulfilled_qty,0)>0 THEN 'partially_fulfilled' WHEN COALESCE(${reserved}.reserved_qty,0)>0 THEN 'reserved' ELSE 'unfulfilled' END`;
    if (requestedColumnSort) return columnOrder({
      exception: `MAX(${open}-${committed}-${available}-${incoming},0)`,
      number: `${order}.number COLLATE NOCASE`,
      customer: `${partner}.name COLLATE NOCASE`,
      requested: `${order}.requested_date`,
      availability: `${available}+${incoming}`,
      fulfillment,
      billing: `${order}.billing_status COLLATE NOCASE`,
      total: `${order}.total_cents`,
      ordered: `COALESCE(${totals}.ordered_qty,0)`,
      shipped: `COALESCE(${totals}.fulfilled_qty,0)`,
      invoiced: `COALESCE(${invoiced}.invoiced_qty,0)`,
      availableToInvoice: `MAX(COALESCE(${totals}.fulfilled_qty,0)-COALESCE(${invoiced}.invoiced_qty,0),0)`,
    }, `${order}.number`, `${order}.number`);
    return sort === "newest" ? `${order}.created_at DESC,${order}.number`
      : sort === "name" ? `${partner}.name,${order}.number`
      : scope === "fulfillment" ? `CASE WHEN COALESCE(${reserved}.reserved_qty,0) > COALESCE(${movements}.shipped_qty,0) THEN 0 ELSE 1 END,${order}.requested_date,${order}.number`
      : scope === "customer-returns" ? `CASE WHEN COALESCE(${movements}.shipped_qty,0) > 0 THEN 0 ELSE 1 END,${order}.requested_date DESC,${order}.number`
      : salesOrderPriorityOrder(order, `COALESCE(${totals}.ordered_qty,0)-COALESCE(${totals}.canceled_qty,0)-COALESCE(${totals}.fulfilled_qty,0)`);
  };

  const productOrder = (product: string, balance: string, incoming: string, demand: string, baseUom: string) => {
    if (scope === "home") return `projected,${product}.name,${product}.id`;
    if (requestedColumnSort) return columnOrder({
      product: `${product}.name COLLATE NOCASE`,
      configuration: `COALESCE(${product}.dimensions,'') COLLATE NOCASE`,
      policy: `${product}.inventory_policy COLLATE NOCASE`,
      units: `${baseUom}.code COLLATE NOCASE`,
      standardCost: `${product}.standard_cost_cents`,
      lastUnitCost: `COALESCE(${product}.last_unit_cost_cents,${product}.standard_cost_cents)`,
      sellingPrice: `${product}.selling_price_cents`,
      margin: `CASE WHEN ${product}.selling_price_cents>0 THEN (${product}.selling_price_cents-COALESCE(${product}.last_unit_cost_cents,${product}.standard_cost_cents))*1.0/${product}.selling_price_cents ELSE -1 END`,
      reorderPoint: `${product}.reorder_point`,
      maxStockLevel: `${product}.max_stock_level`,
      location: `primaryLocationCode COLLATE NOCASE`,
      onHand: `COALESCE(${balance}.on_hand_qty,0)`,
      usable: `COALESCE(${balance}.usable_qty,0)`,
      reserved: `COALESCE(${balance}.reserved_qty,0)`,
      available: `COALESCE(${balance}.usable_qty-${balance}.reserved_qty,0)`,
      incoming: `COALESCE(${incoming}.incoming_qty,0)`,
      demand: `COALESCE(${demand}.demand_qty,0)`,
      projected: `COALESCE(${balance}.usable_qty,0)+COALESCE(${incoming}.incoming_qty,0)-COALESCE(${demand}.demand_qty,0)`,
      exception: `CASE WHEN ${product}.inventory_policy='stocked' AND COALESCE(${balance}.usable_qty,0)+COALESCE(${incoming}.incoming_qty,0)-COALESCE(${demand}.demand_qty,0)<=${product}.reorder_point AND COALESCE(${balance}.usable_qty,0)+COALESCE(${incoming}.incoming_qty,0)-COALESCE(${demand}.demand_qty,0)<${product}.max_stock_level THEN 1 ELSE 0 END`,
    }, `${product}.name`, `${product}.id`);
    return sort === "sku" ? `${product}.sku,${product}.id`
      : sort === "availability" ? `COALESCE(${balance}.usable_qty-${balance}.reserved_qty,0) DESC,${product}.name`
      : `${product}.name,${product}.id`;
  };

  // A synthetic worklist state is not a lifecycle value, so the bound lifecycle filter clears.
  const purchaseStatus = purchaseWorklistFilter("po") ? "" : requestedPurchaseStatus;
  const salesStatus = salesWorklistFilter("so") ? "" : requestedSalesStatus;
  const movementStatus = scope === "movements" ? status : "";
  /**
   * "Match exception" is a worklist state, not a stored value: the exception rows carry
   * match_status 'price_variance', 'quantity_variance', and so on. Comparing the literal
   * "exception" against the column matched nothing, so the one filter this screen exists for
   * returned an empty table while the dashboard counted 28. Defined as the complement of
   * 'matched', exactly like the matchExceptions summary metric.
   */
  const billOutstanding = (bill: string) => `MAX(${bill}.total_cents-${bill}.paid_cents-COALESCE((SELECT SUM(vc.amount_cents) FROM vendor_credits vc WHERE vc.vendor_bill_id=${bill}.id AND vc.status='posted'),0),0)`;
  const billWorklistFilter = (bill: string) => scope !== "vendor-bills" ? ""
    : status === "exception" ? ` AND ${bill}.match_status='exception'`
    : status === "matched" ? ` AND ${bill}.match_status='matched'`
    : status === "outstanding" ? ` AND ${bill}.status<>'void' AND ${billOutstanding(bill)}>0`
    : status === "settled" ? ` AND ${bill}.status<>'void' AND ${billOutstanding(bill)}=0`
    : "";
  const billStatus = scope === "vendor-bills" && !billWorklistFilter("vb") ? status : "";
  const productStatus = ["stock", "products", "counts"].includes(scope) ? status : "";
  // Home only consumes products for the special-order watchlist. Filtering before paging
  // keeps a committed SKU on page one even when thousands of ordinary catalog rows sort
  // ahead of it.
  const homeProductFilter = scope === "home"
    ? " AND p.inventory_policy IN ('special_order','drop_ship') AND (COALESCE(i.incoming_qty,0)>0 OR COALESCE(d.demand_qty,0)>0)"
    : "";

  /**
   * Purchase-order page ordering. The parent query and the child line query must sort
   * identically or the lines fetched belong to a different page than the orders shown.
   */
  const purchaseOrderOrder = (order: string, partner: string, totals: string, movements: string) =>
    requestedColumnSort ? columnOrder({
      exception: `CASE WHEN ${order}.lifecycle_status='approved' AND ${order}.expected_date<${todaySql} AND COALESCE(${totals}.ordered_qty,0)-COALESCE(${totals}.fulfilled_qty,0)-COALESCE(${totals}.closed_qty,0)>0 THEN 1 ELSE 0 END`,
      number: `${order}.number COLLATE NOCASE`,
      vendor: `${partner}.name COLLATE NOCASE`,
      status: `CASE
        WHEN ${order}.lifecycle_status IN ('draft','pending_approval','rejected','canceled') THEN ${order}.lifecycle_status
        WHEN COALESCE(${totals}.ordered_qty,0)-COALESCE(${totals}.fulfilled_qty,0)-COALESCE(${totals}.closed_qty,0)>0
          THEN CASE WHEN COALESCE(${totals}.fulfilled_qty,0)>0 THEN 'partially_fulfilled' ELSE 'open_fulfillment' END
        WHEN ${order}.billing_status='partially_billed' THEN 'partially_billed'
        WHEN ${order}.billing_status IN ('fully_billed','billed') THEN 'fully_billed'
        ELSE 'awaiting_vendor_bill' END COLLATE NOCASE`,
      expected: `${order}.expected_date`,
      ordered: `COALESCE(${totals}.ordered_qty,0)`,
      received: `COALESCE(${totals}.fulfilled_qty,0)`,
      closed: `COALESCE(${totals}.closed_qty,0)`,
      open: `CASE WHEN ${order}.lifecycle_status='approved' THEN MAX(COALESCE(${totals}.ordered_qty,0)-COALESCE(${totals}.fulfilled_qty,0)-COALESCE(${totals}.closed_qty,0),0) ELSE 0 END`,
      billing: `${order}.billing_status COLLATE NOCASE`,
      total: `${order}.total_cents`,
    }, `${order}.number`, `${order}.number`)
      : sort === "newest" ? `${order}.created_at DESC,${order}.number`
      : sort === "name" ? `${partner}.name,${order}.number`
      : scope === "vendor-returns" ? `CASE WHEN COALESCE(${movements}.net_received_qty,0) > 0 THEN 0 ELSE 1 END,${order}.expected_date DESC,${order}.number`
      : purchaseOrderPriorityOrder(order, `COALESCE(${totals}.ordered_qty,0)-COALESCE(${totals}.fulfilled_qty,0)-COALESCE(${totals}.closed_qty,0)`);

  /**
   * Only the datasets the requested view actually renders are queried. Each of these reads
   * is an analytical scan, and running all of them for every page made the snapshot take
   * seconds once the database held a real distributor's history.
   */
  const scopeDatasets: Record<string, string[]> = {
    home: ["purchaseOrders", "purchaseLines", "salesOrders", "products", "bills", "activities"],
    "purchase-orders": ["purchaseOrders", "purchaseLines"],
    "expected-receipts": ["purchaseOrders", "purchaseLines"],
    "vendor-returns": ["purchaseOrders", "purchaseLines"],
    "sales-orders": ["salesOrders", "salesLines"],
    fulfillment: ["salesOrders", "salesLines"],
    "customer-returns": ["salesOrders", "salesLines"],
    "customer-invoices": ["salesOrders", "salesLines"],
    stock: ["products", "inventoryBalances"],
    products: ["products", "inventoryBalances"],
    // Cycle counting is a list of balances, not of products. Paging the catalog and then
    // keeping whichever page rows happened to hold stock in the selected warehouse produced
    // pages of three and five rows across eleven pages of mostly nothing.
    counts: ["countBalances", "counts"],
    movements: ["movements"],
    "vendor-bills": ["bills"],
    partners: [],
    reports: ["products"],
    "workflow-empty": [],
    "workflow-products": ["products", "inventoryBalances"],
    warehouse: ["purchaseOrders", "purchaseLines", "salesOrders", "salesLines", "products", "inventoryBalances"],
  };
  const requested = scopeDatasets[input.scope ?? ""];
  const needs = (dataset: string) => !requested || requested.includes(dataset);


  /**
   * One page of countable balances, joined to their product. Ordered by warehouse and location
   * so a counter walks the racks in order rather than in catalog order.
   */
  const countBalanceFrom = `FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id
      JOIN warehouses w ON w.id=l.warehouse_id JOIN products p ON p.id=ib.product_id
     WHERE l.active=1 AND w.active=1 AND p.active=1 AND ib.on_hand_qty>0 AND (?='' OR w.id=?)
       AND (?='' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR COALESCE(p.manufacturer_sku,'') LIKE ? ESCAPE '\\' OR l.code LIKE ? ESCAPE '\\'
         OR EXISTS (SELECT 1 FROM product_aliases pa WHERE pa.product_id=p.id AND pa.alias LIKE ? ESCAPE '\\'))
       AND (?='' OR p.inventory_policy=? OR p.tracking_policy=?)`;
  const countBalanceBindings = [warehouseScope, warehouseScope, term, like, like, like, like, like, productStatus, productStatus, productStatus];

  const [purchaseOrders, purchaseLineRows, products, salesOrders, salesLineRows, movements, bills, activities, counts, locations, partners, inventoryBalanceRows, countBalances, aggregate] = await Promise.all([
    needs("purchaseOrders") ? (pageAll<Record<string, unknown>>(`WITH line_totals AS (
      SELECT pol.purchase_order_id, SUM(pol.ordered_qty) ordered_qty, SUM(pol.closed_qty) closed_qty,
             SUM(${purchaseLineFulfilledQuantity("pol")}) fulfilled_qty,
             SUM(CASE WHEN pol.fulfillment_route='drop_ship' THEN ${purchaseLineFulfilledQuantity("pol")} ELSE 0 END) delivered_qty,
             SUM(CASE WHEN pol.fulfillment_route<>'drop_ship' THEN MAX(pol.ordered_qty-pol.closed_qty-${purchaseLineFulfilledQuantity("pol")},0) ELSE 0 END) open_receipt_qty,
             SUM(CASE WHEN pol.fulfillment_route='drop_ship' THEN MAX(pol.ordered_qty-pol.closed_qty-${purchaseLineFulfilledQuantity("pol")},0) ELSE 0 END) open_delivery_qty
        FROM purchase_order_lines pol GROUP BY pol.purchase_order_id
    ), movement_totals AS (
      SELECT pol.purchase_order_id, SUM(sm.quantity) net_received_qty,
             SUM(CASE WHEN sm.movement_type = 'purchase_receipt' THEN sm.quantity ELSE 0 END) gross_received_qty,
             SUM(CASE WHEN sm.movement_type = 'vendor_return' THEN -sm.quantity ELSE 0 END) returned_qty,
             SUM(CASE WHEN sm.movement_type = 'receipt_reversal' THEN -sm.quantity ELSE 0 END) reversed_qty
        FROM purchase_order_lines pol LEFT JOIN stock_movements sm ON sm.purchase_order_line_id = pol.id
       GROUP BY pol.purchase_order_id
    )
    SELECT po.id, po.number, po.lifecycle_status AS lifecycleStatus, po.billing_status AS billingStatus,
           po.expected_date AS expectedDate, po.currency, po.exchange_rate_to_base AS exchangeRateToBase,
           po.payment_terms AS paymentTerms, po.due_date AS dueDate, po.total_cents AS totalCents, po.buyer_name AS buyerName,
           po.created_at AS orderDate, po.project_reference AS projectReference,
           po.supplier_quote_number AS supplierQuoteNumber, po.supplier_reference AS supplierReference,
           -- The commercial revision, which only a renegotiated order advances. Distinct from
           -- po.version, the optimistic-lock counter that every state change bumps.
           po.revision_number AS revisionNumber,
           -- The note the buyer had to type to submit the current revision. An approver who
           -- cannot read it is approving a number.
           (SELECT por.reason FROM purchase_order_revisions por WHERE por.purchase_order_id=po.id
             AND por.revision_number=po.revision_number ORDER BY por.rowid DESC LIMIT 1) AS submissionNote,
           COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='purchase_order' AND dc.document_id=po.id AND dc.charge_type='freight'),0) AS freightCents,
           COALESCE((SELECT MAX(dc.tax_rate_bps) FROM document_charges dc WHERE dc.document_type='purchase_order' AND dc.document_id=po.id AND dc.charge_type='freight'),0) AS freightTaxRateBps,
           COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='purchase_order' AND dc.document_id=po.id AND dc.charge_type IN ('fee','handling_fee')),0) AS feeCents,
           COALESCE((SELECT MAX(dc.tax_rate_bps) FROM document_charges dc WHERE dc.document_type='purchase_order' AND dc.document_id=po.id AND dc.charge_type IN ('fee','handling_fee')),0) AS feeTaxRateBps,
           COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='purchase_order' AND dc.document_id=po.id AND dc.charge_type='returnable_deposit'),0) AS depositCents,
           po.version, bp.id AS vendorId, bp.name AS vendorName,
           lr.id AS latestReceiptId, lr.version AS latestReceiptVersion,
           lr.number AS latestReceiptNumber, lr.posted_at AS latestReceiptPostedAt,
           lr.packing_slip_number AS latestReceiptPackingSlip,
           (SELECT json_group_array(json_object('id',r.id,'number',r.number,'postedAt',r.postedAt,'status',r.status,
              'packingSlipNumber',r.packingSlipNumber,'quantity',r.quantity))
            FROM (SELECT rc.id,rc.number,rc.posted_at AS postedAt,rc.status,
                    COALESCE(rc.packing_slip_number,'') AS packingSlipNumber,
                    COALESCE((SELECT SUM(rl.quantity) FROM receipt_lines rl WHERE rl.receipt_id=rc.id),0) AS quantity
                  FROM receipts rc WHERE rc.purchase_order_id=po.id
                  ORDER BY rc.posted_at DESC,rc.number DESC) r) AS receiptsJson,
           (SELECT json_group_array(json_object('id',d.id,'number',d.number,'postedAt',d.postedAt,'deliveryDate',d.deliveryDate,
              'status',d.status,'externalReference',d.externalReference,'quantity',d.quantity))
            FROM (SELECT dd.id,dd.number,dd.posted_at AS postedAt,dd.delivery_date AS deliveryDate,dd.status,
                    dd.external_reference AS externalReference,dd.quantity-dd.reversed_qty AS quantity
                  FROM drop_ship_deliveries dd WHERE dd.purchase_order_id=po.id
                  ORDER BY dd.posted_at DESC,dd.number DESC) d) AS purchaseDeliveriesJson,
           (SELECT json_group_array(json_object('id',b.id,'number',b.number,'status',b.status,'matchStatus',b.matchStatus,
              'issuedOn',b.issuedOn,'dueOn',b.dueOn,'amountCents',b.amountCents,'paidCents',b.paidCents,
              'creditedCents',b.creditedCents,'currency',b.currency,'externalReference',b.externalReference))
            FROM (SELECT vb.id,vb.number,vb.status,vb.match_status AS matchStatus,
                    COALESCE(vb.invoice_date,vb.posted_at,'') AS issuedOn,COALESCE(vb.due_date,'') AS dueOn,
                    vb.total_cents AS amountCents,vb.paid_cents AS paidCents,vb.currency,
                    COALESCE(vb.vendor_invoice_number,'') AS externalReference,
                    COALESCE((SELECT SUM(vc.amount_cents) FROM vendor_credits vc WHERE vc.vendor_bill_id=vb.id AND vc.status='posted'),0) AS creditedCents
                  FROM vendor_bills vb WHERE vb.purchase_order_id=po.id
                  ORDER BY COALESCE(vb.invoice_date,vb.posted_at) DESC,vb.number DESC) b) AS vendorBillsJson,
           (SELECT json_group_array(json_object('id',s.id,'number',s.number,'kind',s.kind,'postedAt',s.postedAt,
              'amountCents',s.amountCents,'currency',s.currency,'appliedTo',s.appliedTo))
            FROM (SELECT vc.id,vc.number,'credit' AS kind,vc.posted_at AS postedAt,vc.amount_cents AS amountCents,
                    vc.currency,COALESCE(vb.number,po.number) AS appliedTo
                  FROM vendor_credits vc LEFT JOIN vendor_bills vb ON vb.id=vc.vendor_bill_id
                  WHERE COALESCE(vb.purchase_order_id,vc.purchase_order_id)=po.id AND vc.status='posted'
                  UNION ALL
                  SELECT pay.id,pay.number,'payment' AS kind,pay.posted_at AS postedAt,pay.amount_cents AS amountCents,
                    pay.currency,vb.number AS appliedTo
                  FROM payments pay JOIN vendor_bills vb ON pay.document_type='vendor_bill' AND pay.document_id=vb.id
                  WHERE vb.purchase_order_id=po.id
                  ORDER BY 4 DESC,2 DESC) s) AS vendorSettlementsJson,
           COALESCE(lt.ordered_qty, 0) AS orderedQuantity, COALESCE(mt.gross_received_qty, 0) AS grossReceivedQuantity,
           COALESCE(mt.reversed_qty, 0) AS receiptReversedQuantity, COALESCE(mt.returned_qty, 0) AS vendorReturnedQuantity,
           COALESCE(mt.net_received_qty, 0) AS netReceivedQuantity, COALESCE(lt.closed_qty, 0) AS closedWithoutReceiptQuantity,
           COALESCE(lt.fulfilled_qty,0) AS supplierFulfilledQuantity, COALESCE(lt.delivered_qty,0) AS dropShipDeliveredQuantity,
           CASE WHEN po.lifecycle_status='approved' THEN COALESCE(lt.open_receipt_qty,0) ELSE 0 END AS openToReceiveQuantity,
           CASE WHEN po.lifecycle_status='approved' THEN COALESCE(lt.open_delivery_qty,0) ELSE 0 END AS openToDeliverQuantity,
           CASE WHEN po.lifecycle_status='approved' THEN COALESCE(lt.open_receipt_qty,0)+COALESCE(lt.open_delivery_qty,0) ELSE 0 END AS openToFulfillQuantity,
           CASE WHEN po.lifecycle_status='draft' THEN 'draft'
                WHEN po.lifecycle_status='pending_approval' THEN 'pending_approval'
                WHEN po.lifecycle_status='rejected' THEN 'rejected'
                WHEN COALESCE(lt.fulfilled_qty,0) > COALESCE(lt.ordered_qty,0) THEN 'over_fulfilled'
                WHEN COALESCE(lt.fulfilled_qty,0) = COALESCE(lt.ordered_qty,0) THEN CASE WHEN COALESCE(lt.delivered_qty,0)>0 THEN 'fully_fulfilled' ELSE 'fully_received' END
                WHEN COALESCE(lt.fulfilled_qty,0) > 0 AND COALESCE(lt.open_receipt_qty,0)+COALESCE(lt.open_delivery_qty,0) > 0 THEN CASE WHEN COALESCE(lt.delivered_qty,0)>0 THEN 'partially_fulfilled' ELSE 'partially_received' END
                WHEN COALESCE(lt.closed_qty,0) > 0 AND COALESCE(lt.open_receipt_qty,0)+COALESCE(lt.open_delivery_qty,0) <= 0 THEN 'closed_short'
                ELSE CASE WHEN COALESCE(lt.delivered_qty,0)>0 THEN 'not_fulfilled' ELSE 'not_received' END END AS fulfillmentStatus
      FROM purchase_orders po JOIN business_partners bp ON bp.id = po.vendor_id
      LEFT JOIN line_totals lt ON lt.purchase_order_id = po.id LEFT JOIN movement_totals mt ON mt.purchase_order_id = po.id
      LEFT JOIN receipts lr ON lr.id = (
        SELECT r2.id FROM receipts r2 WHERE r2.purchase_order_id = po.id
        ORDER BY r2.posted_at DESC, r2.id DESC LIMIT 1
      )
      WHERE (?='' OR po.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(po.project_reference,'') LIKE ? ESCAPE '\\'
        OR COALESCE(po.supplier_quote_number,'') LIKE ? ESCAPE '\\' OR COALESCE(po.supplier_reference,'') LIKE ? ESCAPE '\\')
        AND (?='' OR po.lifecycle_status=?)${purchaseWorklistFilter('po')}
      ORDER BY ${purchaseOrderOrder("po", "bp", "lt", "mt")}`, term, like, like, like, like, like, purchaseStatus, purchaseStatus)) : Promise.resolve([]),
    Promise.resolve([] as Array<Record<string, unknown>>),
    needs("products") ? (pageAll<Record<string, unknown>>(`WITH balance AS (
      SELECT ib.product_id, SUM(ib.on_hand_qty) on_hand_qty, SUM(ib.reserved_qty) reserved_qty,
             SUM(CASE WHEN l.inventory_status='usable' THEN ib.on_hand_qty ELSE 0 END) usable_qty,
             SUM(CASE WHEN l.inventory_status!='usable' THEN ib.on_hand_qty ELSE 0 END) quarantine_qty,
             MAX(ib.version) balance_version
        FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id
       WHERE (?='' OR l.warehouse_id=?)
       GROUP BY ib.product_id
    ), line_net AS (
      SELECT pol.id, pol.product_id, pol.ordered_qty, pol.closed_qty, COALESCE(SUM(sm.quantity),0) net_received
        FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id
        LEFT JOIN stock_movements sm ON sm.purchase_order_line_id=pol.id
       WHERE po.lifecycle_status='approved' AND pol.fulfillment_route<>'drop_ship' GROUP BY pol.id
    ), incoming AS (
      SELECT product_id, SUM(MAX(ordered_qty-closed_qty-net_received,0)) incoming_qty FROM line_net GROUP BY product_id
    ), sales_line_net AS (
      SELECT sol.id,sol.product_id,sol.ordered_qty,sol.canceled_qty,
             COALESCE(SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity
                               WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END),0) shipped_qty
        FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id
        LEFT JOIN stock_movements sm ON sm.sales_order_line_id=sol.id
       WHERE so.lifecycle_status='confirmed' AND sol.fulfillment_route<>'drop_ship' GROUP BY sol.id
    ), demand AS (
      SELECT product_id,SUM(MAX(ordered_qty-canceled_qty-shipped_qty,0)) demand_qty FROM sales_line_net GROUP BY product_id
    )
    SELECT p.id, p.sku, p.manufacturer_sku AS manufacturerSku, p.name, p.category, p.material, p.dimensions,
           p.finish, p.tracking_policy AS trackingPolicy, p.inventory_policy AS inventoryPolicy,
           p.standard_cost_cents AS standardCostCents,p.last_unit_cost_cents AS lastUnitCostCents,
           p.last_unit_cost_source_po_id AS lastUnitCostSourcePoId,p.last_unit_cost_at AS lastUnitCostAt,
           (SELECT po.number FROM purchase_orders po WHERE po.id=p.last_unit_cost_source_po_id) AS lastUnitCostSourcePoNumber,
           (SELECT bp.name FROM business_partners bp WHERE bp.id=p.last_unit_cost_vendor_id) AS lastUnitCostVendorName,
           p.selling_price_cents AS sellingPriceCents,p.suggested_selling_price_cents AS suggestedSellingPriceCents,
           p.pricing_mode AS pricingMode,p.applied_margin_rule_id AS appliedMarginRuleId,
           (SELECT mr.code FROM margin_rules mr WHERE mr.id=p.applied_margin_rule_id) AS appliedMarginRuleCode,
           p.manual_price_reason AS manualPriceReason,p.pricing_updated_at AS pricingUpdatedAt,
           p.base_uom_id AS baseUomId,p.purchase_uom_id AS purchaseUomId,p.sales_uom_id AS salesUomId,
           bu.code AS baseUomCode,pu.code AS purchaseUomCode,su.code AS salesUomCode,bu.precision AS quantityPrecision,
           COALESCE((SELECT json_group_array(json_object('alias',pa.alias)) FROM product_aliases pa WHERE pa.product_id=p.id),'[]') AS aliasesJson,
           COALESCE((SELECT json_group_array(json_object(
             'warehouseId',pdl.warehouse_id,'warehouseCode',dw.code,'warehouseName',dw.name,
             'locationId',pdl.location_id,'locationCode',dl.code,'locationName',dl.name))
             FROM product_default_locations pdl JOIN warehouses dw ON dw.id=pdl.warehouse_id
             JOIN locations dl ON dl.id=pdl.location_id WHERE pdl.product_id=p.id),'[]') AS defaultLocationsJson,
           -- The version column below is the balance version used for count concurrency;
           -- editing the catalog row needs the product row's own optimistic-lock value.
           p.version AS productVersion,
           p.reorder_point AS reorderPoint,p.max_stock_level AS maxStockLevel,p.reorder_rule_mode AS reorderRuleMode,p.reorder_rule_percent AS reorderRulePercent,COALESCE(b.on_hand_qty,0) AS onHand,
           COALESCE(b.usable_qty,0) AS usable, COALESCE(b.quarantine_qty,0) AS quarantine,
           COALESCE(b.reserved_qty,0) AS reserved, COALESCE(b.usable_qty-b.reserved_qty,0) AS available,
           COALESCE(i.incoming_qty,0) AS incoming, COALESCE(d.demand_qty,0) AS demand,
           COALESCE(b.usable_qty,0)+COALESCE(i.incoming_qty,0)-COALESCE(d.demand_qty,0) AS projected,
           COALESCE(b.balance_version,1) AS version,
           COALESCE(v.inventory_value_cents,0) AS inventoryValueCents,
           COALESCE((SELECT l.code FROM inventory_balances pb JOIN locations l ON l.id=pb.location_id WHERE pb.product_id=p.id AND pb.on_hand_qty<>0 AND (?='' OR l.warehouse_id=?) ORDER BY pb.on_hand_qty DESC,l.code LIMIT 1),'No stock') AS primaryLocationCode,
           COALESCE((SELECT l.name FROM inventory_balances pb JOIN locations l ON l.id=pb.location_id WHERE pb.product_id=p.id AND pb.on_hand_qty<>0 AND (?='' OR l.warehouse_id=?) ORDER BY pb.on_hand_qty DESC,l.code LIMIT 1),'No stocked location') AS primaryLocationName,
           (SELECT COUNT(*) FROM inventory_balances lb JOIN locations ll ON ll.id=lb.location_id WHERE lb.product_id=p.id AND lb.on_hand_qty<>0 AND (?='' OR ll.warehouse_id=?)) AS stockedLocationCount
      FROM products p LEFT JOIN balance b ON b.product_id=p.id LEFT JOIN incoming i ON i.product_id=p.id
      LEFT JOIN demand d ON d.product_id=p.id
      LEFT JOIN units_of_measure bu ON bu.id=p.base_uom_id LEFT JOIN units_of_measure pu ON pu.id=p.purchase_uom_id LEFT JOIN units_of_measure su ON su.id=p.sales_uom_id
      LEFT JOIN (SELECT product_id, SUM(value_cents) AS inventory_value_cents
                   FROM inventory_value_entries GROUP BY product_id) v ON v.product_id=p.id
       WHERE p.active=1
         ${homeProductFilter}
         AND (?='' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR COALESCE(p.manufacturer_sku,'') LIKE ? ESCAPE '\\' OR p.dimensions LIKE ? ESCAPE '\\' OR p.material LIKE ? ESCAPE '\\'
           OR EXISTS (SELECT 1 FROM product_aliases pa WHERE pa.product_id=p.id AND pa.alias LIKE ? ESCAPE '\\'))
         AND (?='' OR p.inventory_policy=? OR p.tracking_policy=?)
       ORDER BY ${productOrder("p", "b", "i", "d", "bu")}`,
      warehouseScope, warehouseScope, warehouseScope, warehouseScope, warehouseScope, warehouseScope, warehouseScope, warehouseScope,
      term, like, like, like, like, like, like, productStatus, productStatus, productStatus)) : Promise.resolve([]),
    needs("salesOrders") ? (pageAll<Record<string, unknown>>(`WITH sales_line_movements AS (
      SELECT sales_order_line_id,
             SUM(CASE WHEN movement_type='sales_shipment' THEN -quantity
                      WHEN movement_type='shipment_reversal' THEN -quantity ELSE 0 END) shipped_qty,
             SUM(CASE WHEN movement_type='customer_return' THEN quantity ELSE 0 END) returned_qty
        FROM stock_movements WHERE sales_order_line_id IS NOT NULL GROUP BY sales_order_line_id
    ), line_totals AS (
      SELECT sol.sales_order_id, SUM(sol.ordered_qty) ordered_qty, SUM(sol.canceled_qty) canceled_qty,
             SUM(${salesLineFulfilledQuantity("sol")}) fulfilled_qty,
             SUM(CASE WHEN sol.fulfillment_route='drop_ship' THEN ${salesLineFulfilledQuantity("sol")} ELSE 0 END) delivered_qty,
             SUM(CASE WHEN sol.fulfillment_route<>'drop_ship' THEN MAX(sol.ordered_qty-sol.canceled_qty-${salesLineFulfilledQuantity("sol")},0) ELSE 0 END) open_shipment_qty,
             SUM(CASE WHEN sol.fulfillment_route='drop_ship' THEN MAX(sol.ordered_qty-sol.canceled_qty-${salesLineFulfilledQuantity("sol")},0) ELSE 0 END) open_delivery_qty
        FROM sales_order_lines sol GROUP BY sol.sales_order_id
    ), movement_totals AS (
      SELECT sol.sales_order_id, SUM(COALESCE(slm.shipped_qty,0)) shipped_qty, SUM(COALESCE(slm.returned_qty,0)) returned_qty
        FROM sales_order_lines sol LEFT JOIN sales_line_movements slm ON slm.sales_order_line_id=sol.id GROUP BY sol.sales_order_id
    ), reserved_line AS (
      SELECT sales_order_line_id,SUM(quantity) reserved_qty FROM reservations
       WHERE status='active' GROUP BY sales_order_line_id
    ), reserved AS (
      SELECT sol.sales_order_id,SUM(COALESCE(rl.reserved_qty,0)) reserved_qty
        FROM sales_order_lines sol LEFT JOIN reserved_line rl ON rl.sales_order_line_id=sol.id
       GROUP BY sol.sales_order_id
    ), invoiced AS (
      SELECT sol.sales_order_id, SUM(cil.quantity) invoiced_qty FROM sales_order_lines sol
      JOIN customer_invoice_lines cil ON cil.sales_order_line_id=sol.id
      JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id AND ci.status<>'void'
      GROUP BY sol.sales_order_id
    ), usable_product AS (
      SELECT ib.product_id, SUM(ib.on_hand_qty-ib.reserved_qty) usable_qty
        FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id
       WHERE l.active=1 AND l.inventory_status='usable' GROUP BY ib.product_id
    ), purchase_line_net AS (
      SELECT pol.id,pol.product_id,po2.expected_date,
             MAX(pol.ordered_qty-pol.closed_qty-
               CASE WHEN pol.fulfillment_route='drop_ship'
                 THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0)
                 ELSE COALESCE(SUM(sm.quantity),0) END,0) incoming_qty,
             MAX(pol.ordered_qty-pol.closed_qty-
               CASE WHEN pol.fulfillment_route='drop_ship'
                 THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0)
                 ELSE COALESCE(SUM(sm.quantity),0) END
               -COALESCE((SELECT SUM(sa.allocated_qty-sa.received_qty) FROM supply_allocations sa
                 WHERE sa.purchase_order_line_id=pol.id AND sa.status='active'),0),0) unallocated_incoming_qty
        FROM purchase_order_lines pol JOIN purchase_orders po2 ON po2.id=pol.purchase_order_id
        LEFT JOIN stock_movements sm ON sm.purchase_order_line_id=pol.id
       WHERE po2.lifecycle_status='approved' AND pol.fulfillment_route<>'drop_ship' GROUP BY pol.id
    ), incoming_product_date AS (
      SELECT product_id,expected_date,SUM(unallocated_incoming_qty) incoming_qty
      FROM purchase_line_net GROUP BY product_id,expected_date
    ), allocated_sales_product_date AS (
      SELECT sol.sales_order_id,sol.product_id,po2.expected_date,SUM(sa.allocated_qty-sa.received_qty) incoming_qty
        FROM supply_allocations sa
        JOIN sales_order_lines sol ON sol.id=sa.sales_order_line_id
        JOIN purchase_order_lines pol ON pol.id=sa.purchase_order_line_id
        JOIN purchase_orders po2 ON po2.id=pol.purchase_order_id
       WHERE sa.status='active' AND po2.lifecycle_status='approved' AND sa.allocated_qty>sa.received_qty
       GROUP BY sol.sales_order_id,sol.product_id,po2.expected_date
    ), sales_line_demand AS (
      SELECT sol.sales_order_id,sol.product_id,sol.fulfillment_route,so.requested_date,
             MAX(sol.ordered_qty-sol.canceled_qty-${salesLineFulfilledQuantity("sol")},0) open_qty,
             MIN(MAX(sol.ordered_qty-sol.canceled_qty-${salesLineFulfilledQuantity("sol")},0),COALESCE(rl.reserved_qty,0)) reserved_qty
        FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id
        LEFT JOIN sales_line_movements slm ON slm.sales_order_line_id=sol.id
        LEFT JOIN reserved_line rl ON rl.sales_order_line_id=sol.id
    ), sales_product_demand AS (
      SELECT sales_order_id,product_id,fulfillment_route,requested_date,SUM(open_qty) open_qty,SUM(reserved_qty) reserved_qty
        FROM sales_line_demand GROUP BY sales_order_id,product_id,fulfillment_route,requested_date
    ), sales_product_supply AS (
      SELECT spd.sales_order_id,spd.product_id,spd.open_qty,spd.reserved_qty,
             CASE WHEN spd.fulfillment_route='stock' THEN COALESCE(up.usable_qty,0) ELSE 0 END usable_qty,
             CASE WHEN spd.fulfillment_route='stock' THEN COALESCE((SELECT SUM(ipd.incoming_qty) FROM incoming_product_date ipd
               WHERE ipd.product_id=spd.product_id AND ipd.expected_date<=spd.requested_date),0) ELSE 0 END
             +COALESCE((SELECT SUM(aspd.incoming_qty) FROM allocated_sales_product_date aspd
               WHERE aspd.sales_order_id=spd.sales_order_id AND aspd.product_id=spd.product_id AND aspd.expected_date<=spd.requested_date),0) incoming_qty
        FROM sales_product_demand spd LEFT JOIN usable_product up ON up.product_id=spd.product_id
    ), order_supply AS (
      SELECT sps.sales_order_id,
             SUM(MIN(MAX(sps.open_qty-sps.reserved_qty,0),sps.usable_qty)) available_now_qty,
             SUM(MIN(
               MAX(sps.open_qty-sps.reserved_qty-MIN(MAX(sps.open_qty-sps.reserved_qty,0),sps.usable_qty),0),
               sps.incoming_qty
             )) incoming_supply_qty
        FROM sales_product_supply sps GROUP BY sps.sales_order_id
    )
    SELECT so.id, so.number, so.lifecycle_status AS lifecycleStatus, so.billing_status AS billingStatus,
           so.requested_date AS requestedDate, so.currency,so.exchange_rate_to_base AS exchangeRateToBase,so.payment_terms AS paymentTerms,so.due_date AS dueDate, so.total_cents AS totalCents, so.owner_name AS ownerName,
           so.created_at AS orderDate,
           -- Carrier, service level, tracking and bill of lading are captured on every posted
           -- shipment and were previously written but never readable anywhere in the product.
           (SELECT json_group_array(json_object('number',s.number,'postedAt',s.postedAt,'status',s.status,
              'carrier',s.carrier,'serviceLevel',s.serviceLevel,
              'trackingNumber',s.trackingNumber,'billOfLadingNumber',s.billOfLading))
            FROM (SELECT sh.number,sh.posted_at AS postedAt,sh.status,COALESCE(sh.carrier,'') AS carrier,
                    COALESCE(sh.service_level,'') AS serviceLevel,COALESCE(sh.tracking_number,'') AS trackingNumber,
                    COALESCE(sh.bill_of_lading_number,'') AS billOfLading
                  FROM shipments sh WHERE sh.sales_order_id=so.id
                  ORDER BY sh.posted_at DESC,sh.number DESC) s) AS shipmentsJson,
           (SELECT json_group_array(json_object('id',d.id,'number',d.number,'postedAt',d.postedAt,'deliveryDate',d.deliveryDate,
              'status',d.status,'externalReference',d.externalReference,'quantity',d.quantity))
            FROM (SELECT dd.id,dd.number,dd.posted_at AS postedAt,dd.delivery_date AS deliveryDate,dd.status,
                    dd.external_reference AS externalReference,dd.quantity-dd.reversed_qty AS quantity
                  FROM drop_ship_deliveries dd WHERE dd.sales_order_id=so.id
                  ORDER BY dd.posted_at DESC,dd.number DESC) d) AS salesDeliveriesJson,
           (SELECT json_group_array(json_object('id',i.id,'number',i.number,'status',i.status,
              'issuedOn',i.issuedOn,'dueOn',i.dueOn,'amountCents',i.amountCents,'paidCents',i.paidCents,
              'creditedCents',i.creditedCents,'currency',i.currency))
            FROM (SELECT ci.id,ci.number,ci.status,ci.invoice_date AS issuedOn,ci.due_date AS dueOn,
                    ci.total_cents AS amountCents,ci.paid_cents AS paidCents,ci.currency,
                    COALESCE((SELECT SUM(cc.amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0) AS creditedCents
                  FROM customer_invoices ci WHERE ci.sales_order_id=so.id
                  ORDER BY ci.invoice_date DESC,ci.number DESC) i) AS customerInvoicesJson,
           (SELECT json_group_array(json_object('id',s.id,'number',s.number,'kind',s.kind,'postedAt',s.postedAt,
              'amountCents',s.amountCents,'currency',s.currency,'appliedTo',s.appliedTo))
            FROM (SELECT cc.id,cc.number,'credit' AS kind,cc.posted_at AS postedAt,cc.amount_cents AS amountCents,
                    cc.currency,COALESCE(ci.number,so.number) AS appliedTo
                  FROM customer_credits cc LEFT JOIN customer_invoices ci ON ci.id=cc.customer_invoice_id
                  WHERE COALESCE(ci.sales_order_id,cc.sales_order_id)=so.id AND cc.status='posted'
                  UNION ALL
                  SELECT pay.id,pay.number,'payment' AS kind,pay.posted_at AS postedAt,pay.amount_cents AS amountCents,
                    pay.currency,ci.number AS appliedTo
                  FROM payments pay JOIN customer_invoices ci ON pay.document_type='customer_invoice' AND pay.document_id=ci.id
                  WHERE ci.sales_order_id=so.id
                  ORDER BY 4 DESC,2 DESC) s) AS customerSettlementsJson,
           COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='sales_order' AND dc.document_id=so.id AND dc.charge_type='freight'),0) AS freightCents,
           COALESCE((SELECT MAX(dc.tax_rate_bps) FROM document_charges dc WHERE dc.document_type='sales_order' AND dc.document_id=so.id AND dc.charge_type='freight'),0) AS freightTaxRateBps,
           COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='sales_order' AND dc.document_id=so.id AND dc.charge_type IN ('fee','handling_fee')),0) AS feeCents,
           COALESCE((SELECT MAX(dc.tax_rate_bps) FROM document_charges dc WHERE dc.document_type='sales_order' AND dc.document_id=so.id AND dc.charge_type IN ('fee','handling_fee')),0) AS feeTaxRateBps,
           COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='sales_order' AND dc.document_id=so.id AND dc.charge_type='returnable_deposit'),0) AS depositCents,
           so.project_reference AS projectReference,COALESCE(so.ship_to_name,bp.name) AS shipToName,
           COALESCE(so.ship_to_address_line_1,bp.address_line_1) AS shipToAddressLine1,COALESCE(so.ship_to_address_line_2,bp.address_line_2) AS shipToAddressLine2,
           COALESCE(so.ship_to_city,bp.city) AS shipToCity,COALESCE(so.ship_to_region,bp.region) AS shipToRegion,COALESCE(so.ship_to_postal_code,bp.postal_code) AS shipToPostalCode,
           COALESCE(so.ship_to_country,bp.country) AS shipToCountry,so.delivery_instructions AS deliveryInstructions,
           so.version, bp.id AS customerId, bp.name AS customerName,
           COALESCE(lt.ordered_qty,0) AS orderedQuantity, COALESCE(mt.shipped_qty,0) AS shippedQuantity,
           COALESCE(mt.returned_qty,0) AS returnedQuantity, COALESCE(r.reserved_qty,0) AS reservedQuantity,
           COALESCE(inv.invoiced_qty,0) AS invoicedQuantity,
           COALESCE(lt.fulfilled_qty,0) AS fulfilledQuantity, COALESCE(lt.delivered_qty,0) AS dropShipDeliveredQuantity,
           CASE WHEN so.lifecycle_status='confirmed' THEN COALESCE(lt.open_shipment_qty,0) ELSE 0 END AS openToShipQuantity,
           CASE WHEN so.lifecycle_status='confirmed' THEN COALESCE(lt.open_delivery_qty,0) ELSE 0 END AS openToDeliverQuantity,
           CASE WHEN so.lifecycle_status='confirmed' THEN COALESCE(lt.open_shipment_qty,0)+COALESCE(lt.open_delivery_qty,0) ELSE 0 END AS openToFulfillQuantity,
           -- Supply position across every line, evaluated exactly like the blocked worklist
           -- filter above so a row and the queue it belongs to can never disagree. The client
           -- previously derived this from the first line's product within the current product
           -- page, which on any scope that ships no products marked every order short.
            COALESCE(os.available_now_qty,0) AS availableNowQuantity,
            COALESCE(os.incoming_supply_qty,0) AS incomingSupplyQuantity,
           CASE WHEN so.lifecycle_status='draft' THEN 'draft'
                WHEN so.lifecycle_status!='confirmed' THEN so.lifecycle_status
                WHEN COALESCE(lt.fulfilled_qty,0)>=COALESCE(lt.ordered_qty,0)-COALESCE(lt.canceled_qty,0) THEN CASE WHEN COALESCE(lt.delivered_qty,0)>0 THEN 'fully_fulfilled' ELSE 'fully_shipped' END
                WHEN COALESCE(lt.fulfilled_qty,0)>0 THEN CASE WHEN COALESCE(lt.delivered_qty,0)>0 THEN 'partially_fulfilled' ELSE 'partially_shipped' END
                WHEN COALESCE(r.reserved_qty,0)>0 THEN 'reserved' ELSE 'unreserved' END AS fulfillmentStatus
      FROM sales_orders so JOIN business_partners bp ON bp.id=so.customer_id
      LEFT JOIN line_totals lt ON lt.sales_order_id=so.id LEFT JOIN movement_totals mt ON mt.sales_order_id=so.id
       LEFT JOIN reserved r ON r.sales_order_id=so.id LEFT JOIN invoiced inv ON inv.sales_order_id=so.id
       LEFT JOIN order_supply os ON os.sales_order_id=so.id
      WHERE (?='' OR so.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(so.project_reference,'') LIKE ? ESCAPE '\\')
        AND (?='' OR so.lifecycle_status=?)${salesWorklistFilter('so')}
      ORDER BY ${salesOrderOrder("so", "bp", "lt", "mt", "r", "inv", "os")}`, term, like, like, like, salesStatus, salesStatus)) : Promise.resolve([]),
    Promise.resolve([] as Array<Record<string, unknown>>),
    needs("movements") ? (pageAll<Record<string, unknown>>(`SELECT sm.id, sm.movement_type AS type, sm.quantity, sm.inventory_status AS inventoryStatus,
      sm.source_document_type AS sourceDocumentType, sm.source_document_id AS sourceDocumentId,
      sm.posted_at AS postedAt, sm.posted_by AS postedBy, sm.reversal_of_movement_id AS reversalOfMovementId,
      sm.unit_cost_cents AS unitCostCents, COALESCE((SELECT SUM(ive.value_cents) FROM inventory_value_entries ive WHERE ive.movement_id=sm.id),0) AS inventoryValueCents,
      p.id AS productId, p.sku, p.name AS productName,
      -- The raw source id is an internal identifier (receipt-9705cb96-…). Resolve it to the
      -- document number an operator can actually look up, plus the order it belongs to.
      ${movementDocumentNumber("sm")} AS sourceDocumentNumber,
      ${movementRelatedOrderNumber("sm")} AS relatedOrderNumber,
      ${movementRelatedOrderId("sm")} AS relatedOrderId,
      ${movementRelatedOrderKind("sm")} AS relatedOrderKind,
      fl.code AS fromLocationCode, tl.code AS toLocationCode
      FROM stock_movements sm JOIN products p ON p.id=sm.product_id
      LEFT JOIN locations fl ON fl.id=sm.from_location_id LEFT JOIN locations tl ON tl.id=sm.to_location_id
      WHERE (?='' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR COALESCE(sm.source_document_id,'') LIKE ? ESCAPE '\\' OR COALESCE(${movementDocumentNumber("sm")},'') LIKE ? ESCAPE '\\' OR COALESCE(${movementRelatedOrderNumber("sm")},'') LIKE ? ESCAPE '\\' OR COALESCE(fl.code,'') LIKE ? ESCAPE '\\' OR COALESCE(tl.code,'') LIKE ? ESCAPE '\\' OR sm.posted_by LIKE ? ESCAPE '\\')
        AND (?='' OR sm.movement_type=?)
       ORDER BY ${requestedColumnSort ? columnOrder({
         posted: "sm.posted_at",
         movement: "sm.movement_type COLLATE NOCASE",
         document: "sourceDocumentNumber COLLATE NOCASE",
         order: "relatedOrderNumber COLLATE NOCASE",
         product: "p.sku COLLATE NOCASE",
         quantity: "sm.quantity",
         from: "fl.code COLLATE NOCASE",
         to: "tl.code COLLATE NOCASE",
         actor: "sm.posted_by COLLATE NOCASE",
       }, "sm.posted_at DESC,sm.id DESC", "sm.id") : sort === "oldest" ? "sm.posted_at,sm.id" : "sm.posted_at DESC,sm.id DESC"}`, term, like, like, like, like, like, like, like, like, movementStatus, movementStatus)) : Promise.resolve([]),
    needs("bills") ? (pageAll<Record<string, unknown>>(`SELECT vb.id, vb.number, vb.status, vb.match_status AS matchStatus,
      vb.total_cents AS totalCents, vb.due_date AS dueDate, vb.currency, vb.version,
      -- Line values exclude tax, so the register previously never showed the amount actually
      -- payable, and AP had no vendor reference to match the supplier's invoice against.
      vb.vendor_invoice_number AS vendorInvoiceNumber, vb.invoice_date AS invoiceDate,
      vb.subtotal_cents AS subtotalCents, vb.tax_cents AS taxCents, vb.paid_cents AS paidCents,
      ${billOutstanding("vb")} AS outstandingCents, vb.payment_terms AS paymentTerms, vb.hold_reason AS holdReason,
      COALESCE((SELECT SUM(ROUND(vbl.quantity*pol.unit_cost_cents)) FROM vendor_bill_lines vbl JOIN purchase_order_lines pol ON pol.id=vbl.purchase_order_line_id WHERE vbl.vendor_bill_id=vb.id),0) AS authorizedLineValueCents,
      COALESCE((SELECT SUM(vbl.line_total_cents) FROM vendor_bill_lines vbl WHERE vbl.vendor_bill_id=vb.id),0) AS billedLineValueCents,
      bp.id AS vendorId, bp.name AS vendorName, po.id AS purchaseOrderId, po.number AS purchaseOrderNumber
       FROM vendor_bills vb JOIN business_partners bp ON bp.id=vb.vendor_id
       LEFT JOIN purchase_orders po ON po.id=vb.purchase_order_id
      WHERE (?='' OR vb.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(po.number,'') LIKE ? ESCAPE '\\' OR vb.vendor_invoice_number LIKE ? ESCAPE '\\')
        AND (?='' OR vb.status=? OR vb.match_status=?)${billWorklistFilter('vb')}
      ORDER BY ${requestedColumnSort ? columnOrder({
        number: "vb.number COLLATE NOCASE",
        vendorInvoice: "vb.vendor_invoice_number COLLATE NOCASE",
        vendor: "bp.name COLLATE NOCASE",
        purchaseOrder: "po.number COLLATE NOCASE",
        invoiced: "vb.invoice_date",
        due: "vb.due_date",
        authorized: "authorizedLineValueCents",
        billed: "billedLineValueCents",
        variance: "ABS(billedLineValueCents-authorizedLineValueCents)",
        tax: "vb.tax_cents",
        total: "vb.total_cents",
        outstanding: "outstandingCents",
        match: "vb.match_status COLLATE NOCASE",
        settlement: "vb.status COLLATE NOCASE",
      }, "vb.due_date,vb.number", "vb.number") : sort === "newest" ? "COALESCE(vb.posted_at,vb.invoice_date,vb.due_date) DESC,vb.number" : "vb.due_date,vb.number"}`, term, like, like, like, like, billStatus, billStatus, billStatus)) : Promise.resolve([]),
    needs("activities") ? (pageAll<Record<string, unknown>>(`SELECT id, entity_type AS entityType, entity_id AS entityId, action, summary,
       actor, metadata_json AS metadataJson, created_at AS createdAt
       FROM audit_events
      WHERE NOT (entity_type IN ('product','business_partner') AND action IN ('created','updated'))
        AND (?='' OR summary LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR actor LIKE ? ESCAPE '\\' OR entity_id LIKE ? ESCAPE '\\')
      ORDER BY ${sort === "oldest" ? "created_at,id" : "created_at DESC,id DESC"}`, term, like, like, like, like)) : Promise.resolve([]),
    needs("counts") ? (pageAll<Record<string, unknown>>(`SELECT ic.id, ic.number, ic.status, ic.recorded_qty AS recordedQuantity,
      ic.counted_qty AS countedQuantity, ic.variance_qty AS varianceQuantity, ic.reason,
      ic.counted_at AS countedAt, ic.counted_by AS countedBy,
      p.id AS productId, p.sku, p.name AS productName, l.id AS locationId, l.code AS locationCode
       FROM inventory_counts ic JOIN products p ON p.id=ic.product_id JOIN locations l ON l.id=ic.location_id
      WHERE (?='' OR ic.number LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR l.code LIKE ? ESCAPE '\\')
       ORDER BY ${sort === "oldest" ? "ic.counted_at,ic.id" : "ic.counted_at DESC,ic.id DESC"}`, term, like, like, like, like)) : Promise.resolve([]),
    !scope.startsWith("workflow-") ? referenceAll<Record<string, unknown>>(`SELECT l.id,l.code,l.name,l.location_type AS locationType,l.inventory_status AS inventoryStatus,
      l.warehouse_id AS warehouseId,w.name AS warehouseName,l.active FROM locations l LEFT JOIN warehouses w ON w.id=l.warehouse_id WHERE l.active=1 ORDER BY w.code,l.code`)
      : Promise.resolve([]),
    !scope.startsWith("workflow-") ? pageAll<Record<string, unknown>>(`SELECT id,code,name,partner_type AS partnerType,email,phone,
      address_line_1 AS addressLine1,address_line_2 AS addressLine2,city,region,postal_code AS postalCode,country,
      credit_limit_cents AS creditLimitCents,credit_hold AS creditHold,payment_terms AS paymentTerms,currency,version
      FROM business_partners WHERE active=1
        AND (?='' OR code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR COALESCE(email,'') LIKE ? ESCAPE '\\' OR COALESCE(city,'') LIKE ? ESCAPE '\\' OR COALESCE(postal_code,'') LIKE ? ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM master_record_merges mr WHERE mr.entity_type='business_partner' AND mr.target_id=business_partners.id AND mr.source_label LIKE ? ESCAPE '\\'))
        AND (?='' OR partner_type=? OR partner_type='both')
      ORDER BY ${requestedColumnSort && scope === "partners" ? columnOrder({
        partner: "name COLLATE NOCASE",
        type: "partner_type COLLATE NOCASE",
        contact: "COALESCE(email,phone,'') COLLATE NOCASE",
        address: "COALESCE(city,address_line_1,'') COLLATE NOCASE",
        terms: "COALESCE(payment_terms,'') COLLATE NOCASE",
        credit: "CASE WHEN credit_hold=1 THEN 1 ELSE COALESCE(credit_limit_cents,0) END",
      }, "name,id", "id") : sort === "code" ? "code,id" : "name,id"}`, term, like, like, like, like, like, like, scope === "partners" ? status : "", scope === "partners" ? status : "")
      : Promise.resolve([]),
    Promise.resolve([] as Array<Record<string, unknown>>),
    needs("countBalances") ? (pageAll<Record<string, unknown>>(`SELECT ib.product_id AS productId, ib.location_id AS locationId,
      ib.on_hand_qty AS recordedQuantity, ib.reserved_qty AS reservedQuantity, ib.version,
      l.code AS locationCode, l.name AS locationName, l.inventory_status AS inventoryStatus,
      w.id AS warehouseId, w.code AS warehouseCode, w.name AS warehouseName,
      p.sku, p.name AS productName
      ${countBalanceFrom}
      ORDER BY ${requestedColumnSort && scope === "counts" ? columnOrder({
        product: "p.name COLLATE NOCASE",
        location: "w.code COLLATE NOCASE,l.code COLLATE NOCASE",
        recorded: "ib.on_hand_qty",
        reserved: "ib.reserved_qty",
        available: "ib.on_hand_qty-ib.reserved_qty",
      }, "w.code,l.code,p.sku", "ib.product_id") : "w.code,l.code,p.sku"}`, ...countBalanceBindings)) : Promise.resolve([]),
    !scope.startsWith("workflow-") ? first<Record<string, unknown>>(`WITH po_movement AS MATERIALIZED (
      SELECT purchase_order_line_id,SUM(quantity) fulfilled_qty FROM stock_movements
       WHERE purchase_order_line_id IS NOT NULL GROUP BY purchase_order_line_id
    ), po_delivery AS MATERIALIZED (
      SELECT purchase_order_line_id,SUM(quantity-reversed_qty) fulfilled_qty FROM drop_ship_deliveries
       WHERE purchase_order_line_id IS NOT NULL GROUP BY purchase_order_line_id
    ), po_line_state AS MATERIALIZED (
      SELECT pol.id,pol.purchase_order_id,pol.product_id,pol.fulfillment_route,po.lifecycle_status,po.expected_date,
             MAX(pol.ordered_qty-pol.closed_qty-CASE WHEN pol.fulfillment_route='drop_ship'
               THEN COALESCE(pd.fulfilled_qty,0) ELSE COALESCE(pm.fulfilled_qty,0) END,0) open_qty
        FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id
        LEFT JOIN po_movement pm ON pm.purchase_order_line_id=pol.id
        LEFT JOIN po_delivery pd ON pd.purchase_order_line_id=pol.id
    ), so_movement AS MATERIALIZED (
      SELECT sales_order_line_id,SUM(CASE WHEN movement_type='sales_shipment' THEN -quantity
             WHEN movement_type='shipment_reversal' THEN -quantity ELSE 0 END) fulfilled_qty
        FROM stock_movements WHERE sales_order_line_id IS NOT NULL GROUP BY sales_order_line_id
    ), so_delivery AS MATERIALIZED (
      SELECT sales_order_line_id,SUM(quantity-reversed_qty) fulfilled_qty FROM drop_ship_deliveries
       WHERE sales_order_line_id IS NOT NULL GROUP BY sales_order_line_id
    ), so_reservation AS MATERIALIZED (
      SELECT sales_order_line_id,SUM(quantity) reserved_qty FROM reservations
       WHERE status='active' GROUP BY sales_order_line_id
    ), so_line_state AS MATERIALIZED (
      SELECT sol.id,sol.sales_order_id,sol.product_id,sol.fulfillment_route,so.lifecycle_status,so.requested_date,
             MAX(sol.ordered_qty-sol.canceled_qty-CASE WHEN sol.fulfillment_route='drop_ship'
               THEN COALESCE(sd.fulfilled_qty,0) ELSE COALESCE(sm.fulfilled_qty,0) END,0) open_qty,
             COALESCE(sr.reserved_qty,0) reserved_qty
        FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id
        LEFT JOIN so_movement sm ON sm.sales_order_line_id=sol.id
        LEFT JOIN so_delivery sd ON sd.sales_order_line_id=sol.id
        LEFT JOIN so_reservation sr ON sr.sales_order_line_id=sol.id
    ), so_product_demand AS MATERIALIZED (
      SELECT sales_order_id,product_id,lifecycle_status,requested_date,SUM(open_qty) open_qty,
             SUM(MIN(open_qty,reserved_qty)) reserved_qty
        FROM so_line_state WHERE fulfillment_route<>'drop_ship' GROUP BY sales_order_id,product_id,lifecycle_status,requested_date
    ), product_balance AS MATERIALIZED (
      SELECT ib.product_id,SUM(ib.on_hand_qty) on_hand,
             SUM(CASE WHEN l.inventory_status='usable' THEN ib.on_hand_qty ELSE 0 END) usable_on_hand,
             SUM(CASE WHEN l.inventory_status='usable' THEN ib.on_hand_qty-ib.reserved_qty ELSE 0 END) usable_available,
             SUM(CASE WHEN l.inventory_status<>'usable' THEN ib.on_hand_qty ELSE 0 END) quarantine
        FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE l.active=1 GROUP BY ib.product_id
    ), incoming_product AS MATERIALIZED (
      SELECT product_id,SUM(open_qty) incoming_qty FROM po_line_state WHERE lifecycle_status='approved' AND fulfillment_route<>'drop_ship' GROUP BY product_id
    ), incoming_product_date AS MATERIALIZED (
      SELECT product_id,expected_date,SUM(open_qty) incoming_qty FROM po_line_state
       WHERE lifecycle_status='approved' AND fulfillment_route<>'drop_ship' GROUP BY product_id,expected_date
    ), demand_product AS MATERIALIZED (
      SELECT product_id,SUM(open_qty) demand_qty FROM so_line_state WHERE lifecycle_status='confirmed' AND fulfillment_route<>'drop_ship' GROUP BY product_id
    ), so_product_supply AS MATERIALIZED (
      SELECT spd.sales_order_id,spd.product_id,spd.lifecycle_status,spd.requested_date,
             spd.open_qty,spd.reserved_qty,COALESCE(SUM(ipd.incoming_qty),0) incoming_qty
        FROM so_product_demand spd LEFT JOIN incoming_product_date ipd
          ON ipd.product_id=spd.product_id AND ipd.expected_date<=spd.requested_date
       GROUP BY spd.sales_order_id,spd.product_id,spd.lifecycle_status,spd.requested_date,spd.open_qty,spd.reserved_qty
    ), scoped_balance AS MATERIALIZED (
      SELECT ib.on_hand_qty,ib.reserved_qty,l.inventory_status,l.location_type
        FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id
       WHERE l.active=1 AND (?='' OR l.warehouse_id=?)
    ), orphan_movement AS MATERIALIZED (
      SELECT sm.id FROM stock_movements sm
        LEFT JOIN locations fl ON fl.id=sm.from_location_id LEFT JOIN locations tl ON tl.id=sm.to_location_id
       WHERE (sm.from_location_id IS NOT NULL AND fl.id IS NULL) OR (sm.to_location_id IS NOT NULL AND tl.id IS NULL)
    ) SELECT
      (SELECT COUNT(*) FROM products WHERE active=1) AS skuCount,
      (SELECT COALESCE(SUM(on_hand_qty),0) FROM scoped_balance) AS onHand,
      (SELECT COALESCE(SUM(CASE WHEN inventory_status='usable' THEN on_hand_qty ELSE 0 END),0) FROM scoped_balance) AS usable,
      (SELECT COALESCE(SUM(reserved_qty),0) FROM scoped_balance) AS reserved,
      (SELECT COALESCE(SUM(CASE WHEN inventory_status='usable' THEN on_hand_qty-reserved_qty ELSE 0 END),0) FROM scoped_balance) AS available,
      (SELECT COALESCE(SUM(open_qty),0) FROM po_line_state WHERE lifecycle_status='approved' AND fulfillment_route<>'drop_ship') AS incoming,
      (SELECT COALESCE(SUM(CASE WHEN inventory_status<>'usable' THEN on_hand_qty ELSE 0 END),0) FROM scoped_balance) AS quarantine,
      (SELECT COALESCE(SUM(value_cents),0) FROM inventory_value_entries) AS inventoryValueCents,
      (SELECT COALESCE(SUM(open_qty),0) FROM so_line_state WHERE lifecycle_status='confirmed' AND fulfillment_route<>'drop_ship') AS openDemand,
      (SELECT COUNT(DISTINCT purchase_order_id) FROM po_line_state WHERE lifecycle_status='approved' AND open_qty>0) AS openPurchaseOrders,
      (SELECT COALESCE(SUM(open_qty),0) FROM po_line_state WHERE lifecycle_status='approved' AND fulfillment_route<>'drop_ship') AS openReceiptUnits,
      (SELECT COUNT(DISTINCT purchase_order_id) FROM po_line_state WHERE lifecycle_status='approved' AND fulfillment_route<>'drop_ship' AND expected_date<${todaySql} AND open_qty>0) AS latePurchaseOrders,
      (SELECT COUNT(*) FROM purchase_orders WHERE lifecycle_status='pending_approval') AS pendingApprovals,
      (SELECT COUNT(DISTINCT sales_order_id) FROM so_line_state WHERE lifecycle_status='confirmed' AND open_qty>0) AS openSalesOrders,
      (SELECT COUNT(DISTINCT sps.sales_order_id) FROM so_product_supply sps
        LEFT JOIN product_balance pb ON pb.product_id=sps.product_id
       WHERE sps.lifecycle_status='confirmed'
         AND sps.open_qty>sps.reserved_qty+COALESCE(pb.usable_available,0)+sps.incoming_qty) AS blockedSalesOrders,
      (SELECT COUNT(DISTINCT so.id) FROM sales_orders so JOIN sales_order_lines sol ON sol.sales_order_id=so.id
        JOIN reservations r ON r.sales_order_line_id=sol.id WHERE so.lifecycle_status='confirmed' AND r.status='active' AND r.quantity>0) AS readyToShip,
      (SELECT COALESCE(SUM(quantity),0) FROM reservations WHERE status='active' AND quantity>0) AS readyToShipUnits,
      (SELECT COUNT(*) FROM vendor_bills WHERE match_status='exception') AS matchExceptions,
      (SELECT COUNT(*) FROM products p LEFT JOIN product_balance pb ON pb.product_id=p.id
        LEFT JOIN incoming_product ip ON ip.product_id=p.id LEFT JOIN demand_product dp ON dp.product_id=p.id
       WHERE p.active=1 AND ((p.inventory_policy='stocked'
         AND COALESCE(pb.usable_on_hand,0)+COALESCE(ip.incoming_qty,0)-COALESCE(dp.demand_qty,0)<=p.reorder_point
         AND COALESCE(pb.usable_on_hand,0)+COALESCE(ip.incoming_qty,0)-COALESCE(dp.demand_qty,0)<p.max_stock_level)
         OR COALESCE(pb.quarantine,0)>0)) AS inventoryRiskCount,
      (SELECT COUNT(*) FROM products p JOIN product_balance pb ON pb.product_id=p.id
       WHERE p.active=1 AND p.inventory_policy='special_order' AND pb.on_hand>0) AS specialOrderInventoryCount,
      (SELECT COUNT(*) FROM scoped_balance WHERE on_hand_qty>0) AS countableBalanceCount,
      (SELECT COUNT(*) FROM scoped_balance WHERE location_type='receiving' AND on_hand_qty>0) AS receivingBalanceCount,
      (SELECT COUNT(*) FROM inventory_balances ib LEFT JOIN locations l ON l.id=ib.location_id WHERE l.id IS NULL) AS orphanedBalanceRows,
      (SELECT COALESCE(SUM(ib.on_hand_qty),0) FROM inventory_balances ib LEFT JOIN locations l ON l.id=ib.location_id WHERE l.id IS NULL) AS orphanedBalanceUnits,
      (SELECT COUNT(*) FROM orphan_movement) AS orphanedMovementCount,
      (SELECT COALESCE(SUM(ive.value_cents),0) FROM inventory_value_entries ive JOIN orphan_movement om ON om.id=ive.movement_id) AS orphanedInventoryValueCents,
      (SELECT COUNT(*) FROM purchase_orders) AS purchaseOrderCount,
      (SELECT COUNT(*) FROM sales_orders) AS salesOrderCount,
      (SELECT COUNT(*) FROM business_partners WHERE active=1) AS partnerCount,
      (SELECT COUNT(*) FROM stock_movements) AS movementCount,
      (SELECT COUNT(*) FROM vendor_bills) AS billCount,
      (SELECT COUNT(*) FROM audit_events WHERE NOT (entity_type IN ('product','business_partner') AND action IN ('created','updated'))) AS activityCount,
      (SELECT COUNT(*) FROM inventory_counts) AS countCount`, warehouseScope, warehouseScope) : Promise.resolve(null),
  ]);

  // Child rows follow the ids already selected for this page. The previous form repeated the
  // complete parent query—including every aggregate and sort—inside each child query, doubling
  // the work on order and invoice screens before SQLite could apply the same 50-row limit.
  const purchaseOrderIds = purchaseOrders.map((order) => String(order.id)).filter(Boolean);
  const salesOrderIds = salesOrders.map((order) => String(order.id)).filter(Boolean);
  const visibleProductIds = products.map((product) => String(product.id)).filter(Boolean);
  const taxDefaultPromise = first<{ valueJson: string }>("SELECT value_json AS valueJson FROM system_settings WHERE key='tax.defaultRateBps'");
  const reorderRulePromise = first<{ valueJson: string }>("SELECT value_json AS valueJson FROM system_settings WHERE key='inventory.reorderPointRule'");
  const orphanedLocationsPromise = all<Record<string, unknown>>(`WITH referenced AS (
      SELECT ib.location_id AS locationId,SUM(ib.on_hand_qty) AS balanceUnits,COUNT(*) AS balanceRows,0 AS movementRows FROM inventory_balances ib LEFT JOIN locations l ON l.id=ib.location_id WHERE l.id IS NULL GROUP BY ib.location_id
      UNION ALL
      SELECT sm.from_location_id,0,0,COUNT(*) FROM stock_movements sm LEFT JOIN locations l ON l.id=sm.from_location_id WHERE sm.from_location_id IS NOT NULL AND l.id IS NULL GROUP BY sm.from_location_id
      UNION ALL
      SELECT sm.to_location_id,0,0,COUNT(*) FROM stock_movements sm LEFT JOIN locations l ON l.id=sm.to_location_id WHERE sm.to_location_id IS NOT NULL AND l.id IS NULL GROUP BY sm.to_location_id
    ) SELECT locationId,SUM(balanceUnits) AS balanceUnits,SUM(balanceRows) AS balanceRows,SUM(movementRows) AS movementRows FROM referenced GROUP BY locationId ORDER BY locationId`);
  const filteredTotalPromise = (async () => {
    if (!term && !status && scope !== "customer-invoices") return null;
    let total: { count: number } | null = null;
    if (["purchase-orders", "expected-receipts", "vendor-returns"].includes(scope)) total = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM purchase_orders po JOIN business_partners bp ON bp.id=po.vendor_id WHERE (?='' OR po.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(po.project_reference,'') LIKE ? ESCAPE '\\' OR COALESCE(po.supplier_quote_number,'') LIKE ? ESCAPE '\\' OR COALESCE(po.supplier_reference,'') LIKE ? ESCAPE '\\') AND (?='' OR po.lifecycle_status=?)${purchaseWorklistFilter("po")}`, term, like, like, like, like, like, purchaseStatus, purchaseStatus);
    else if (["sales-orders", "fulfillment", "customer-returns", "customer-invoices"].includes(scope)) total = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM sales_orders so JOIN business_partners bp ON bp.id=so.customer_id WHERE (?='' OR so.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(so.project_reference,'') LIKE ? ESCAPE '\\') AND (?='' OR so.lifecycle_status=?)${salesWorklistFilter("so")}`, term, like, like, like, salesStatus, salesStatus);
    else if (scope === "counts") total = await first<{ count: number }>(`SELECT COUNT(*) AS count ${countBalanceFrom}`, ...countBalanceBindings);
    else if (["stock", "products"].includes(scope)) total = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM products p WHERE p.active=1 AND (?='' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR COALESCE(p.manufacturer_sku,'') LIKE ? ESCAPE '\\' OR p.dimensions LIKE ? ESCAPE '\\' OR p.material LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM product_aliases pa WHERE pa.product_id=p.id AND pa.alias LIKE ? ESCAPE '\\')) AND (?='' OR p.inventory_policy=? OR p.tracking_policy=?)`, term, like, like, like, like, like, like, productStatus, productStatus, productStatus);
    else if (scope === "movements") total = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM stock_movements sm JOIN products p ON p.id=sm.product_id LEFT JOIN locations fl ON fl.id=sm.from_location_id LEFT JOIN locations tl ON tl.id=sm.to_location_id WHERE (?='' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR COALESCE(sm.source_document_id,'') LIKE ? ESCAPE '\\' OR COALESCE(${movementDocumentNumber("sm")},'') LIKE ? ESCAPE '\\' OR COALESCE(${movementRelatedOrderNumber("sm")},'') LIKE ? ESCAPE '\\' OR COALESCE(fl.code,'') LIKE ? ESCAPE '\\' OR COALESCE(tl.code,'') LIKE ? ESCAPE '\\' OR sm.posted_by LIKE ? ESCAPE '\\') AND (?='' OR sm.movement_type=?)`, term, like, like, like, like, like, like, like, like, movementStatus, movementStatus);
    else if (scope === "partners") total = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM business_partners WHERE active=1 AND (?='' OR code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR COALESCE(email,'') LIKE ? ESCAPE '\\' OR COALESCE(city,'') LIKE ? ESCAPE '\\' OR COALESCE(postal_code,'') LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM master_record_merges mr WHERE mr.entity_type='business_partner' AND mr.target_id=business_partners.id AND mr.source_label LIKE ? ESCAPE '\\')) AND (?='' OR partner_type=? OR partner_type='both')`, term, like, like, like, like, like, like, status, status);
    else if (scope === "vendor-bills") total = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM vendor_bills vb JOIN business_partners bp ON bp.id=vb.vendor_id LEFT JOIN purchase_orders po ON po.id=vb.purchase_order_id WHERE (?='' OR vb.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(po.number,'') LIKE ? ESCAPE '\\' OR vb.vendor_invoice_number LIKE ? ESCAPE '\\') AND (?='' OR vb.status=? OR vb.match_status=?)${billWorklistFilter('vb')}`, term, like, like, like, like, billStatus, billStatus, billStatus);
    return total ? Number(total.count) : null;
  })();
  const [purchaseLines, salesLines, inventoryBalances, taxDefault, reorderRule, orphanedLocations, filteredTotal] = await Promise.all([
    needs("purchaseLines") && purchaseOrderIds.length ? all<Record<string, unknown>>(`SELECT pol.id, pol.purchase_order_id AS purchaseOrderId, pol.product_id AS productId,
      p.sku, p.name AS productName, pol.ordered_qty AS orderedQuantity, pol.closed_qty AS closedWithoutReceiptQuantity,pol.version,
      pol.ordered_uom_id AS orderedUomId,pol.ordered_uom_qty AS orderedUomQuantity,pol.ordered_uom_unit_cost_cents AS orderedUomUnitCostCents,ou.code AS orderedUomCode,
      COALESCE(SUM(sm.quantity),0) AS netReceivedQuantity,
      COALESCE(SUM(CASE WHEN sm.movement_type='purchase_receipt' THEN sm.quantity ELSE 0 END),0) AS grossReceivedQuantity,
      COALESCE(SUM(CASE WHEN sm.movement_type='vendor_return' THEN -sm.quantity WHEN sm.movement_type='receipt_reversal' THEN -sm.quantity ELSE 0 END),0) AS returnedQuantity,
      COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0) AS dropShipDeliveredQuantity,
      ${purchaseLineFulfilledQuantity("pol")} AS supplierFulfilledQuantity,
      COALESCE((SELECT MAX(${receiptMovementReversible}) FROM stock_movements receipt_movement WHERE ${latestReceiptMovementFilter("pol")}),0) AS latestReceiptReversibleQuantity,
      -- One entry per condition the latest receipt was split into, so a caller can reverse the
      -- quarantined part by inventoryStatus/receiptLineId instead of only the largest movement.
      COALESCE((SELECT json_group_array(json_object(
        'movementId',receipt_movement.id,'receiptLineId',receipt_movement.source_line_id,'inventoryStatus',receipt_movement.inventory_status,
        'locationId',receipt_movement.to_location_id,'locationCode',(SELECT l.code FROM locations l WHERE l.id=receipt_movement.to_location_id),
        'remainingQuantity',${receiptMovementRemaining},'reversibleQuantity',${receiptMovementReversible}))
        FROM stock_movements receipt_movement WHERE ${latestReceiptMovementFilter("pol")} AND ${receiptMovementRemaining}>0),'[]') AS latestReceiptReversibleJson,
      CASE WHEN pol.fulfillment_route<>'drop_ship' THEN MAX(pol.ordered_qty-pol.closed_qty-${purchaseLineFulfilledQuantity("pol")},0) ELSE 0 END AS openToReceiveQuantity,
      CASE WHEN pol.fulfillment_route='drop_ship' THEN MAX(pol.ordered_qty-pol.closed_qty-${purchaseLineFulfilledQuantity("pol")},0) ELSE 0 END AS openToDeliverQuantity,
      MAX(pol.ordered_qty-pol.closed_qty-${purchaseLineFulfilledQuantity("pol")},0) AS openToFulfillQuantity,
      pol.unit_cost_cents AS unitCostCents,pol.configuration_snapshot AS configurationSnapshot,
      pol.discount_cents AS discountCents,pol.taxable,pol.tax_code AS taxCode,pol.tax_rate_bps AS taxRateBps,
      pol.fulfillment_route AS fulfillmentRoute,pol.source_sales_order_line_id AS sourceSalesOrderLineId,p.tracking_policy AS trackingPolicy,
      COALESCE((SELECT json_group_array(json_object(
        'warehouseId',pdl.warehouse_id,'warehouseCode',dw.code,'warehouseName',dw.name,
        'locationId',pdl.location_id,'locationCode',dl.code,'locationName',dl.name))
        FROM product_default_locations pdl JOIN warehouses dw ON dw.id=pdl.warehouse_id
        JOIN locations dl ON dl.id=pdl.location_id WHERE pdl.product_id=pol.product_id),'[]') AS defaultLocationsJson,
      COALESCE((SELECT json_group_array(json_object(
        'id',sa.id,'salesOrderLineId',sa.sales_order_line_id,'quantity',sa.allocated_qty,
        'receivedQuantity',sa.received_qty,'status',sa.status,'salesOrderNumber',allocated_so.number,
        'customerName',allocated_partner.name))
          FROM supply_allocations sa JOIN sales_order_lines allocated_sol ON allocated_sol.id=sa.sales_order_line_id
          JOIN sales_orders allocated_so ON allocated_so.id=allocated_sol.sales_order_id
          JOIN business_partners allocated_partner ON allocated_partner.id=allocated_so.customer_id
          WHERE sa.purchase_order_line_id=pol.id AND sa.status='active'),'[]') AS supplyAllocationsJson
      FROM purchase_order_lines pol JOIN products p ON p.id=pol.product_id LEFT JOIN units_of_measure ou ON ou.id=pol.ordered_uom_id
      LEFT JOIN stock_movements sm ON sm.purchase_order_line_id=pol.id
      WHERE pol.purchase_order_id IN (SELECT value FROM json_each(?))
      GROUP BY pol.id ORDER BY pol.id LIMIT ?`, JSON.stringify(purchaseOrderIds), childLimit) : purchaseLineRows,
    needs("salesLines") && salesOrderIds.length ? all<Record<string, unknown>>(`WITH product_available AS MATERIALIZED (
      SELECT ib.product_id,SUM(ib.on_hand_qty-ib.reserved_qty) available_qty
        FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id
       WHERE l.active=1 AND l.inventory_status='usable' GROUP BY ib.product_id
    ), purchase_line_net AS MATERIALIZED (
      SELECT pol.id,pol.product_id,po3.expected_date,
             MAX(pol.ordered_qty-pol.closed_qty-${purchaseLineFulfilledQuantity("pol")},0) incoming_qty,
             MAX(pol.ordered_qty-pol.closed_qty-${purchaseLineFulfilledQuantity("pol")}
               -COALESCE((SELECT SUM(sa.allocated_qty-sa.received_qty) FROM supply_allocations sa
                 WHERE sa.purchase_order_line_id=pol.id AND sa.status='active'),0),0) unallocated_incoming_qty
        FROM purchase_order_lines pol JOIN purchase_orders po3 ON po3.id=pol.purchase_order_id
       WHERE po3.lifecycle_status='approved' AND pol.fulfillment_route<>'drop_ship' GROUP BY pol.id
    ) SELECT sol.id,sol.sales_order_id AS salesOrderId,sol.product_id AS productId,
      p.sku,p.name AS productName,sol.ordered_qty AS orderedQuantity,sol.canceled_qty AS canceledQuantity,
      sol.ordered_uom_id AS orderedUomId,sol.ordered_uom_qty AS orderedUomQuantity,sol.ordered_uom_unit_price_cents AS orderedUomUnitPriceCents,ou.code AS orderedUomCode,
      COALESCE(SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END),0) AS shippedQuantity,
      COALESCE(SUM(CASE WHEN sm.movement_type='customer_return' THEN sm.quantity ELSE 0 END),0) AS returnedQuantity,
      COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.sales_order_line_id=sol.id),0) AS dropShipDeliveredQuantity,
      ${salesLineFulfilledQuantity("sol")} AS fulfilledQuantity,
      COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.sales_order_line_id=sol.id AND r.status='active'),0) AS reservedQuantity,
      sol.unit_price_cents AS unitPriceCents,sol.configuration_snapshot AS configurationSnapshot,
      sol.fulfillment_route AS fulfillmentRoute,sol.project_reference AS projectReference,sol.linked_purchase_order_line_id AS linkedPurchaseOrderLineId,
      linked_po.id AS linkedPurchaseOrderId,linked_po.number AS linkedPurchaseOrderNumber,linked_po.lifecycle_status AS linkedPurchaseOrderLifecycle,p.tracking_policy AS trackingPolicy,
      CASE WHEN (SELECT COUNT(DISTINCT ar.location_id) FROM reservations ar WHERE ar.sales_order_line_id=sol.id AND ar.status='active' AND ar.quantity>0)=1
        THEN (SELECT MAX(ar.location_id) FROM reservations ar WHERE ar.sales_order_line_id=sol.id AND ar.status='active' AND ar.quantity>0) ELSE NULL END AS reservationLocationId,
      sol.discount_cents AS discountCents,sol.taxable,sol.tax_code AS taxCode,sol.tax_rate_bps AS taxRateBps,
      COALESCE(pa.available_qty,0) AS productAvailableQuantity,
      CASE WHEN sol.fulfillment_route='stock' THEN COALESCE((SELECT SUM(pln.unallocated_incoming_qty) FROM purchase_line_net pln
                 WHERE pln.product_id=sol.product_id AND pln.expected_date<=so.requested_date),0)
           ELSE COALESCE((SELECT SUM(sa.allocated_qty-sa.received_qty) FROM supply_allocations sa
                 JOIN purchase_order_lines allocated_line ON allocated_line.id=sa.purchase_order_line_id
                 JOIN purchase_orders allocated_order ON allocated_order.id=allocated_line.purchase_order_id
                 WHERE sa.sales_order_line_id=sol.id AND sa.status='active' AND allocated_order.lifecycle_status='approved'
                   AND allocated_order.expected_date<=so.requested_date),0) END AS productIncomingQuantity
      FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id
      JOIN products p ON p.id=sol.product_id LEFT JOIN units_of_measure ou ON ou.id=sol.ordered_uom_id
      LEFT JOIN purchase_order_lines linked_pol ON linked_pol.id=sol.linked_purchase_order_line_id
      LEFT JOIN purchase_orders linked_po ON linked_po.id=linked_pol.purchase_order_id
      LEFT JOIN stock_movements sm ON sm.sales_order_line_id=sol.id
      LEFT JOIN product_available pa ON pa.product_id=sol.product_id
      WHERE sol.sales_order_id IN (SELECT value FROM json_each(?))
      GROUP BY sol.id ORDER BY sol.id LIMIT ?`, JSON.stringify(salesOrderIds), childLimit) : salesLineRows,
    // Balance rows follow the ids chosen by the fully sorted product page. Run this alongside
    // child rows and other independent reads instead of adding another database round trip.
    needs("inventoryBalances") && visibleProductIds.length ? all<Record<string, unknown>>(`SELECT ib.product_id AS productId, ib.location_id AS locationId,
      ib.on_hand_qty AS recordedQuantity, ib.reserved_qty AS reservedQuantity, ib.version,
      l.code AS locationCode, l.name AS locationName, l.inventory_status AS inventoryStatus,
      w.id AS warehouseId, w.code AS warehouseCode, w.name AS warehouseName
      FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id
      JOIN warehouses w ON w.id=l.warehouse_id
      WHERE l.active=1 AND w.active=1 AND (?='' OR w.id=?)
        AND ib.product_id IN (SELECT value FROM json_each(?))
      ORDER BY w.code,l.code,ib.product_id`, warehouseScope, warehouseScope, JSON.stringify(visibleProductIds)) : inventoryBalanceRows,
    taxDefaultPromise,
    reorderRulePromise,
    orphanedLocationsPromise,
    filteredTotalPromise,
  ]);

  const linesByPo = new Map<string, Array<Record<string, unknown>>>();
  purchaseLines.forEach((line) => {
    const key = String(line.purchaseOrderId);
    linesByPo.set(key, [...(linesByPo.get(key) ?? []), line]);
  });
  purchaseOrders.forEach((order) => { order.lines = linesByPo.get(String(order.id)) ?? []; });
  const linesBySo = new Map<string, Array<Record<string, unknown>>>();
  salesLines.forEach((line) => {
    const key = String(line.salesOrderId);
    linesBySo.set(key, [...(linesBySo.get(key) ?? []), line]);
  });
  salesOrders.forEach((order) => { order.lines = linesBySo.get(String(order.id)) ?? []; });

  const numeric = (value: unknown) => Number(value ?? 0);
  const summary = Object.fromEntries(Object.entries(aggregate ?? {}).map(([key,value])=>[key,numeric(value)]));
  let taxDefaultRateBps = 500;
  if (taxDefault) {
    try {
      const parsed = JSON.parse(taxDefault.valueJson) as unknown;
      if (Number.isInteger(parsed) && Number(parsed) >= 0 && Number(parsed) <= 10_000) taxDefaultRateBps = Number(parsed);
    } catch { throw new DomainError("POLICY_CONFIGURATION_ERROR", "Default tax policy is invalid.", 500); }
  }
  let reorderPointPercent = 70;
  if (reorderRule) {
    try {
      const parsed = JSON.parse(reorderRule.valueJson) as { percent?: unknown };
      if (typeof parsed.percent === "number" && Number.isFinite(parsed.percent) && parsed.percent > 0 && parsed.percent <= 100) reorderPointPercent = parsed.percent;
    } catch { throw new DomainError("POLICY_CONFIGURATION_ERROR", "Reorder point policy is invalid.", 500); }
  }
  return {
    generatedAt: new Date().toISOString(),
    configuration: { taxDefaultRateBps, reorderPointPercent },
    summary,
    purchaseOrders,
    products,
    salesOrders,
    movements,
    bills,
    activities,
    counts,
    locations,
    partners,
    inventoryBalances,
    countBalances,
    orphanedLocations,
    pagination: {
      page,
      pageSize,
      filteredTotal,
      totals: {
        purchaseOrders: numeric(aggregate?.purchaseOrderCount),
        products: numeric(aggregate?.skuCount),
        partners: numeric(aggregate?.partnerCount),
        salesOrders: numeric(aggregate?.salesOrderCount),
        movements: numeric(aggregate?.movementCount),
        bills: numeric(aggregate?.billCount),
        activities: numeric(aggregate?.activityCount),
        counts: numeric(aggregate?.countCount),
        // Countable rows in the selected warehouse — what the cycle-count worklist pages over.
        countBalances: numeric(aggregate?.countableBalanceCount),
      },
    },
  };
}

export async function searchInventoryRecords(search: string, limit = 20, pageSize = 50) {
  await ensureDatabase();
  const term = search.trim();
  if (!term) return { purchaseOrders: [], salesOrders: [], products: [], partners: [] };
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const boundedPageSize = Math.min(Math.max(Math.trunc(pageSize), 1), 100);
  const like = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const [purchaseOrders, salesOrders, products, partners] = await Promise.all([
    all<Record<string, unknown>>(`WITH ranked AS (SELECT po.id,po.number,bp.name AS vendorName,po.project_reference AS projectReference,
      CAST((ROW_NUMBER() OVER (ORDER BY ${purchaseOrderPriorityOrder("po", purchaseOpenQuantity("po"))},po.id)-1)/? AS INTEGER)+1 AS page
      FROM purchase_orders po JOIN business_partners bp ON bp.id=po.vendor_id)
      SELECT * FROM ranked WHERE number LIKE ? ESCAPE '\\' OR vendorName LIKE ? ESCAPE '\\' OR COALESCE(projectReference,'') LIKE ? ESCAPE '\\'
      ORDER BY page,number LIMIT ?`, boundedPageSize, like, like, like, boundedLimit),
    all<Record<string, unknown>>(`WITH ranked AS (SELECT so.id,so.number,bp.name AS customerName,so.project_reference AS projectReference,
      CAST((ROW_NUMBER() OVER (ORDER BY ${salesOrderPriorityOrder("so", salesOpenQuantity("so"))},so.id)-1)/? AS INTEGER)+1 AS page
      FROM sales_orders so JOIN business_partners bp ON bp.id=so.customer_id)
      SELECT * FROM ranked WHERE number LIKE ? ESCAPE '\\' OR customerName LIKE ? ESCAPE '\\' OR COALESCE(projectReference,'') LIKE ? ESCAPE '\\'
      ORDER BY page,number LIMIT ?`, boundedPageSize, like, like, like, boundedLimit),
    all<Record<string, unknown>>(`WITH ranked AS (SELECT id,sku,name,dimensions,finish,material,
      CAST((ROW_NUMBER() OVER (ORDER BY name,id)-1)/? AS INTEGER)+1 AS page FROM products WHERE active=1)
      SELECT * FROM ranked WHERE sku LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR dimensions LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM product_aliases pa WHERE pa.product_id=ranked.id AND pa.alias LIKE ? ESCAPE '\\')
      ORDER BY page,name LIMIT ?`, boundedPageSize, like, like, like, like, boundedLimit),
    all<Record<string, unknown>>(`WITH ranked AS (SELECT id,code,name,partner_type AS partnerType,email,phone,
      address_line_1 AS addressLine1,address_line_2 AS addressLine2,city,region,postal_code AS postalCode,country,
      CAST((ROW_NUMBER() OVER (ORDER BY name,id)-1)/? AS INTEGER)+1 AS page FROM business_partners WHERE active=1)
      SELECT * FROM ranked WHERE code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR COALESCE(email,'') LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM master_record_merges mr WHERE mr.entity_type='business_partner' AND mr.target_id=ranked.id AND mr.source_label LIKE ? ESCAPE '\\')
      ORDER BY page,name LIMIT ?`, boundedPageSize, like, like, like, like, boundedLimit),
  ]);
  return { purchaseOrders, salesOrders, products, partners };
}

export async function getProductOperationalDetail(productId: string, page = 1, pageSize = 50) {
  await ensureDatabase();
  const normalized = normalizeSnapshotPage({ page, pageSize });
  const product = await first<Record<string, unknown>>(`SELECT p.id,p.sku,p.name,p.tracking_policy AS trackingPolicy,p.inventory_policy AS inventoryPolicy,
      p.base_uom_id AS baseUomId,bu.code AS baseUomCode,p.purchase_uom_id AS purchaseUomId,pu.code AS purchaseUomCode,
      p.sales_uom_id AS salesUomId,su.code AS salesUomCode
    FROM products p LEFT JOIN units_of_measure bu ON bu.id=p.base_uom_id LEFT JOIN units_of_measure pu ON pu.id=p.purchase_uom_id LEFT JOIN units_of_measure su ON su.id=p.sales_uom_id
    WHERE p.id=?`, productId);
  if (!product) throw new DomainError("NOT_FOUND", "Product was not found.", 404);
  const balances = await all<Record<string, unknown>>(`SELECT ib.product_id AS productId,ib.location_id AS locationId,ib.on_hand_qty AS recordedQuantity,ib.reserved_qty AS reservedQuantity,ib.version,
      l.code AS locationCode,l.name AS locationName,l.inventory_status AS inventoryStatus,w.code AS warehouseCode,w.name AS warehouseName
      FROM inventory_balances ib LEFT JOIN locations l ON l.id=ib.location_id LEFT JOIN warehouses w ON w.id=l.warehouse_id
      WHERE ib.product_id=? ORDER BY CASE WHEN l.id IS NULL THEN 0 ELSE 1 END,w.code,l.code`, productId);
  const movements = await all<Record<string, unknown>>(`SELECT sm.id,sm.movement_type AS type,sm.quantity,sm.inventory_status AS inventoryStatus,
      sm.source_document_type AS sourceDocumentType,sm.source_document_id AS sourceDocumentId,sm.posted_at AS postedAt,sm.posted_by AS postedBy,
      fl.code AS fromLocationCode,tl.code AS toLocationCode FROM stock_movements sm
      LEFT JOIN locations fl ON fl.id=sm.from_location_id LEFT JOIN locations tl ON tl.id=sm.to_location_id
      WHERE sm.product_id=? OR sm.product_id IN (
        SELECT source_id FROM master_record_merges WHERE entity_type='product' AND target_id=?
      ) ORDER BY sm.posted_at DESC,sm.id DESC LIMIT ? OFFSET ?`, productId, productId, normalized.pageSize, normalized.offset);
  const movementTotal = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM stock_movements WHERE product_id=? OR product_id IN (
      SELECT source_id FROM master_record_merges WHERE entity_type='product' AND target_id=?)`, productId, productId);
  const aliases = await all<Record<string, unknown>>(`SELECT id,alias,alias_type AS aliasType,created_at AS createdAt,created_by AS createdBy
      FROM product_aliases WHERE product_id=? ORDER BY alias COLLATE NOCASE`, productId);
  const defaultLocations = await all<Record<string, unknown>>(`SELECT w.id AS warehouseId,w.code AS warehouseCode,w.name AS warehouseName,
      pdl.location_id AS locationId,l.code AS locationCode,l.name AS locationName,pdl.version
      FROM warehouses w LEFT JOIN product_default_locations pdl ON pdl.warehouse_id=w.id AND pdl.product_id=?
      LEFT JOIN locations l ON l.id=pdl.location_id WHERE w.active=1 ORDER BY w.code`, productId);
  return { product, balances, movements, aliases, defaultLocations, pagination: { page: normalized.page, pageSize: normalized.pageSize, total: Number(movementTotal?.count ?? 0) } };
}

/**
 * Every reference list a form can select from. The workflow snapshot only ships one page
 * of each table, so anything a user must find by name or number has to be searched on the
 * server instead of filtered in the browser.
 */
export const REFERENCE_LOOKUPS = [
  "products", "partners", "locations", "warehouses", "uoms", "priceLists", "priceListAssignments", "priceListEntries", "assetTypes",
  "salesOrders", "purchaseOrders", "salesOrderLines", "purchaseOrderLines",
  "customerInvoices", "vendorBills", "costLayers", "partnerAddresses", "inventoryLots", "inventoryUnits",
] as const;

export type ReferenceLookup = (typeof REFERENCE_LOOKUPS)[number];

export function isReferenceLookup(value: unknown): value is ReferenceLookup {
  return typeof value === "string" && (REFERENCE_LOOKUPS as readonly string[]).includes(value);
}

export async function searchInventoryReferences(kind: ReferenceLookup, search = "", limit = 20, role?: string, partnerId?: string, quantity = 1, warehouseId?: string, currency?: string, exchangeRateToBase?: number, offset = 0, productId?: string, lineId?: string, locationId?: string) {
  await ensureDatabase();
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const boundedOffset = Math.max(Math.trunc(Number.isFinite(offset) ? offset : 0), 0);
  const term = search.trim();
  const like = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const scopedWarehouse = typeof warehouseId === "string" ? warehouseId.trim() : "";

  if (kind === "inventoryLots") {
    if (role === "shipped") return { items: await all<Record<string, unknown>>(`SELECT il.id,il.lot_number AS lotNumber,p.sku,p.name AS productName,
      COALESCE(SUM(CASE WHEN sm.movement_type='sales_shipment' THEN ma.quantity WHEN sm.movement_type='customer_return' THEN -ma.quantity ELSE 0 END),0) AS availableQuantity
      FROM inventory_lots il JOIN products p ON p.id=il.product_id
      JOIN movement_assignments ma ON ma.lot_id=il.id JOIN stock_movements sm ON sm.id=ma.movement_id
      WHERE il.status='active' AND (?='' OR il.product_id=?) AND (?='' OR sm.sales_order_line_id=?)
        AND (?='' OR il.lot_number LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')
      GROUP BY il.id HAVING availableQuantity>0 ORDER BY il.lot_number LIMIT ? OFFSET ?`, productId ?? "", productId ?? "", lineId ?? "", lineId ?? "", term, like, like, boundedLimit, boundedOffset) };
    return { items: await all<Record<string, unknown>>(`SELECT il.id,il.lot_number AS lotNumber,p.sku,p.name AS productName,
      COALESCE(SUM(CASE WHEN ?='' AND sm.to_location_id IS NOT NULL AND sm.from_location_id IS NULL THEN ma.quantity WHEN ?='' AND sm.from_location_id IS NOT NULL AND sm.to_location_id IS NULL THEN -ma.quantity
        WHEN ?<>'' AND sm.to_location_id=? THEN ma.quantity WHEN ?<>'' AND sm.from_location_id=? THEN -ma.quantity ELSE 0 END),0) AS availableQuantity
      FROM inventory_lots il JOIN products p ON p.id=il.product_id
      JOIN movement_assignments ma ON ma.lot_id=il.id JOIN stock_movements sm ON sm.id=ma.movement_id
      WHERE il.status='active' AND (?='' OR il.product_id=?)
        AND (?='' OR il.lot_number LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')
      GROUP BY il.id HAVING availableQuantity>0 ORDER BY il.lot_number LIMIT ? OFFSET ?`,
      locationId ?? "", locationId ?? "", locationId ?? "", locationId ?? "", locationId ?? "", locationId ?? "",
      productId ?? "", productId ?? "", term, like, like, boundedLimit, boundedOffset) };
  }
  if (kind === "inventoryUnits") {
    return { items: await all<Record<string, unknown>>(`SELECT iu.id,iu.serial_number AS serialNumber,il.lot_number AS lotNumber,p.sku,p.name AS productName,
      l.code AS locationCode,l.name AS locationName,iu.inventory_status AS inventoryStatus,iu.lifecycle_status AS lifecycleStatus
      FROM inventory_units iu JOIN products p ON p.id=iu.product_id LEFT JOIN inventory_lots il ON il.id=iu.lot_id LEFT JOIN locations l ON l.id=iu.location_id
      WHERE (?='' OR iu.product_id=?) AND (?='' OR iu.location_id=?)
        AND ((?='shipped' AND iu.lifecycle_status='shipped' AND EXISTS (SELECT 1 FROM movement_assignments ma JOIN stock_movements sm ON sm.id=ma.movement_id
          WHERE ma.inventory_unit_id=iu.id AND sm.movement_type='sales_shipment' AND (?='' OR sm.sales_order_line_id=?)))
          OR (?<>'shipped' AND iu.lifecycle_status='on_hand' AND iu.inventory_status='usable' AND iu.allocated_sales_order_line_id IS NULL))
        AND (?='' OR iu.serial_number LIKE ? ESCAPE '\\' OR COALESCE(il.lot_number,'') LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')
      ORDER BY iu.serial_number LIMIT ? OFFSET ?`, productId ?? "", productId ?? "", locationId ?? "", locationId ?? "", role ?? "", lineId ?? "", lineId ?? "", role ?? "", term, like, like, like, boundedLimit, boundedOffset) };
  }

  if (kind === "partnerAddresses") {
    return { items: await all<Record<string, unknown>>(`SELECT id,partner_id AS partnerId,label,contact_name AS contactName,
        address_line_1 AS addressLine1,address_line_2 AS addressLine2,city,region,postal_code AS postalCode,country,
        delivery_instructions AS deliveryInstructions,is_default AS isDefault,version
      FROM partner_addresses WHERE active=1 AND (?='' OR partner_id=?)
        AND (?='' OR label LIKE ? ESCAPE '\\' OR address_line_1 LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\')
      ORDER BY is_default DESC,label LIMIT ? OFFSET ?`, partnerId ?? "", partnerId ?? "", term, like, like, like, boundedLimit, boundedOffset) };
  }
  if (kind === "warehouses") {
    return { items: await all<Record<string, unknown>>(`SELECT id,code,name,timezone,version FROM warehouses WHERE active=1
      AND (?='' OR code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY code LIMIT ? OFFSET ?`, term, like, like, boundedLimit, boundedOffset) };
  }
  if (kind === "uoms") {
    return { items: await all<Record<string, unknown>>(`SELECT id,code,name,dimension,precision FROM units_of_measure WHERE active=1
      AND (?='' OR code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY code LIMIT ?`, term, like, like, boundedLimit) };
  }
  if (kind === "priceLists") {
    return { items: await all<Record<string, unknown>>(`SELECT id,code,name,currency,priority,active,version FROM price_lists WHERE active=1
      AND (?='' OR code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY priority DESC,code LIMIT ?`, term, like, like, boundedLimit) };
  }
  if (kind === "priceListAssignments") {
    return { items: await all<Record<string, unknown>>(`SELECT pla.id,pla.price_list_id AS priceListId,pl.code AS priceListCode,pl.name AS priceListName,pl.currency,
        pla.partner_id AS partnerId,bp.code AS partnerCode,bp.name AS partnerName,pla.priority,pla.valid_from AS validFrom,pla.valid_to AS validTo,pla.version
      FROM price_list_assignments pla JOIN price_lists pl ON pl.id=pla.price_list_id JOIN business_partners bp ON bp.id=pla.partner_id
      WHERE pla.active=1 AND (?='' OR pla.partner_id=?)
        AND (?='' OR pl.code LIKE ? ESCAPE '\\' OR bp.code LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\')
      ORDER BY pla.priority,pl.code,bp.name LIMIT ?`, partnerId ?? "", partnerId ?? "", term, like, like, like, boundedLimit) };
  }
  if (kind === "priceListEntries") {
    return { items: await all<Record<string, unknown>>(`SELECT ple.id,ple.price_list_id AS priceListId,pl.code AS priceListCode,pl.currency,
        ple.product_id AS productId,p.sku,p.name AS productName,ple.uom_id AS uomId,u.code AS uomCode,
        ple.minimum_quantity AS minimumQuantity,ple.unit_price_cents AS unitPriceCents,ple.valid_from AS validFrom,ple.valid_to AS validTo,ple.version
      FROM price_list_entries ple JOIN price_lists pl ON pl.id=ple.price_list_id JOIN products p ON p.id=ple.product_id JOIN units_of_measure u ON u.id=ple.uom_id
      WHERE ple.active=1 AND (?='' OR pl.code LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')
      ORDER BY pl.code,p.sku,ple.minimum_quantity DESC LIMIT ?`, term, like, like, like, boundedLimit) };
  }
  if (kind === "assetTypes") {
    return { items: await all<Record<string, unknown>>(`SELECT id,code,name,asset_class AS assetClass,unit_deposit_cents AS unitDepositCents,version FROM returnable_asset_types WHERE active=1
      AND (?='' OR code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY name LIMIT ?`, term, like, like, boundedLimit) };
  }
  if (kind === "salesOrders") {
    return { items: await all<Record<string, unknown>>(`SELECT so.id,so.number,so.customer_id AS customerId,bp.name AS customerName,so.lifecycle_status AS status,
        so.requested_date AS requestedDate,so.total_cents AS totalCents,so.currency,so.exchange_rate_to_base AS exchangeRateToBase,so.payment_terms AS paymentTerms,so.due_date AS dueDate,so.version,
        COALESCE((SELECT SUM(eligible.netLineCents + CASE WHEN eligible.taxable=1 THEN ROUND(eligible.netLineCents*eligible.taxRateBps/10000.0) ELSE 0 END)
          FROM (SELECT sol2.id,sol2.taxable,sol2.tax_rate_bps AS taxRateBps,
            MAX(ROUND(MAX((CASE WHEN sol2.fulfillment_route='drop_ship'
              THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.sales_order_line_id=sol2.id),0)
              ELSE COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol2.id),0) END)
              -COALESCE((SELECT SUM(cil.quantity) FROM customer_invoice_lines cil JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id WHERE cil.sales_order_line_id=sol2.id AND ci.status<>'void'),0),0)*sol2.unit_price_cents)
              -MAX(ROUND(sol2.discount_cents*MIN((CASE WHEN sol2.fulfillment_route='drop_ship'
                THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.sales_order_line_id=sol2.id),0)
                ELSE COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol2.id),0) END),sol2.ordered_qty)/MAX(sol2.ordered_qty,1))
                -COALESCE((SELECT SUM(ROUND(cil.quantity*cil.unit_price_cents)-cil.line_total_cents) FROM customer_invoice_lines cil JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id WHERE cil.sales_order_line_id=sol2.id AND ci.status<>'void'),0),0),0) AS netLineCents
            FROM sales_order_lines sol2 WHERE sol2.sales_order_id=so.id) eligible),0)
          + CASE WHEN NOT EXISTS (SELECT 1 FROM customer_invoices ci WHERE ci.sales_order_id=so.id AND ci.status<>'void') THEN
              COALESCE((SELECT SUM((CASE WHEN dc.direction='subtract' THEN -1 ELSE 1 END)*(dc.amount_cents+dc.tax_amount_cents)) FROM document_charges dc WHERE dc.document_type='sales_order' AND dc.document_id=so.id),0)
            ELSE 0 END AS invoiceableCents
      FROM sales_orders so JOIN business_partners bp ON bp.id=so.customer_id
      -- "Open" means the order still owes the customer goods or money, not merely that it was
      -- never cancelled. A confirmed order keeps that lifecycle forever, so filtering on the
      -- lifecycle alone listed every order the customer had ever placed as open.
      WHERE (?='' OR so.customer_id=?) AND (?<>'open' OR (so.lifecycle_status='draft' OR (so.lifecycle_status='confirmed'
        AND (${salesOpenLines("so")} OR so.billing_status<>'invoiced'))))
        AND (?='' OR so.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(so.project_reference,'') LIKE ? ESCAPE '\\')
      ORDER BY so.number DESC LIMIT ? OFFSET ?`, partnerId ?? "", partnerId ?? "", role ?? "", term, like, like, like, boundedLimit, boundedOffset) };
  }
  if (kind === "purchaseOrders") {
    return { items: await all<Record<string, unknown>>(`SELECT po.id,po.number,po.vendor_id AS vendorId,bp.name AS vendorName,po.lifecycle_status AS status,
        po.expected_date AS expectedDate,po.total_cents AS totalCents,po.currency,po.version
      FROM purchase_orders po JOIN business_partners bp ON bp.id=po.vendor_id
      -- Same rule as the customer side: an approved order that has been fully received and
      -- fully billed is finished, whatever its lifecycle column still says.
      WHERE (?='' OR po.vendor_id=?) AND (?<>'open' OR (po.lifecycle_status IN ('draft','pending_approval')
        OR (po.lifecycle_status='approved' AND (${purchaseOpenLines("po")} OR po.billing_status NOT IN ('fully_billed','billed')))))
        AND (?<>'draft' OR po.lifecycle_status='draft')
        AND (?='' OR po.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\')
      ORDER BY po.number DESC LIMIT ? OFFSET ?`, partnerId ?? "", partnerId ?? "", role ?? "", role ?? "", term, like, like, boundedLimit, boundedOffset) };
  }
  if (kind === "salesOrderLines") {
    // Purchase-order composers need demand with unallocated quantity (excluding the draft being edited),
    // while external delivery needs only demand that already has dedicated drop-ship supply.
    const linkedDelivery = role === "drop_ship_linked";
    const routeFilter = linkedDelivery ? "drop_ship" : ["stock", "special_order", "drop_ship"].includes(role ?? "") ? role! : "";
    const demandMode = linkedDelivery ? "linked" : routeFilter ? "available" : "all";
    return { items: await all<Record<string, unknown>>(`SELECT sol.id,so.number AS orderNumber,so.id AS salesOrderId,bp.name AS customerName,p.sku,p.name AS productName,
        sol.fulfillment_route AS fulfillmentRoute,sol.ordered_qty AS orderedQuantity,sol.canceled_qty AS canceledQuantity,so.lifecycle_status AS orderStatus,so.version AS salesOrderVersion,
        COALESCE((SELECT SUM(sa.allocated_qty) FROM supply_allocations sa WHERE sa.sales_order_line_id=sol.id AND sa.status='active'),0) AS allocatedQuantity,
        MAX(sol.ordered_qty-sol.canceled_qty-COALESCE((SELECT SUM(sa.allocated_qty) FROM supply_allocations sa
          JOIN purchase_order_lines allocated_line ON allocated_line.id=sa.purchase_order_line_id
          WHERE sa.sales_order_line_id=sol.id AND sa.status='active' AND (?='' OR allocated_line.purchase_order_id<>?)),0),0) AS availableToAllocateQuantity
      FROM sales_order_lines sol
      JOIN sales_orders so ON so.id=sol.sales_order_id
      JOIN business_partners bp ON bp.id=so.customer_id
      JOIN products p ON p.id=sol.product_id
      WHERE so.lifecycle_status<>'canceled' AND sol.ordered_qty>sol.canceled_qty
        AND (?='' OR sol.fulfillment_route=?) AND (?='' OR sol.product_id=?)
        AND (?='all' OR (?='linked' AND EXISTS (SELECT 1 FROM supply_allocations linked_sa WHERE linked_sa.sales_order_line_id=sol.id AND linked_sa.status='active'))
          OR (?='available' AND sol.ordered_qty-sol.canceled_qty>COALESCE((SELECT SUM(sa.allocated_qty) FROM supply_allocations sa
            JOIN purchase_order_lines allocated_line ON allocated_line.id=sa.purchase_order_line_id
            WHERE sa.sales_order_line_id=sol.id AND sa.status='active' AND (?='' OR allocated_line.purchase_order_id<>?)),0)))
        AND (?='' OR so.number LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\')
      ORDER BY so.number DESC,p.sku LIMIT ?`, partnerId ?? "", partnerId ?? "", routeFilter, routeFilter, productId ?? "", productId ?? "", demandMode, demandMode, demandMode, partnerId ?? "", partnerId ?? "", term, like, like, like, like, boundedLimit) };
  }
  if (kind === "purchaseOrderLines") {
    return { items: await all<Record<string, unknown>>(`SELECT pol.id,po.number AS orderNumber,po.id AS purchaseOrderId,bp.name AS vendorName,p.sku,p.name AS productName,
        pol.fulfillment_route AS fulfillmentRoute,pol.ordered_qty AS orderedQuantity,pol.closed_qty AS closedQuantity,pol.unit_cost_cents AS unitCostCents,po.lifecycle_status AS orderStatus,
        CASE WHEN pol.fulfillment_route='drop_ship'
          THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0)
          ELSE COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0) END AS netReceivedQuantity,
        COALESCE((SELECT SUM(vbl.quantity) FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id WHERE vbl.purchase_order_line_id=pol.id AND vb.status<>'void'),0) AS billedQuantity,
        MAX(CASE WHEN pol.fulfillment_route='drop_ship'
          THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0)
          ELSE COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0) END
          -COALESCE((SELECT SUM(vbl.quantity) FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id WHERE vbl.purchase_order_line_id=pol.id AND vb.status<>'void'),0),0) AS billableQuantity,
        po.currency,po.exchange_rate_to_base AS exchangeRateToBase,po.payment_terms AS paymentTerms,po.due_date AS dueDate,po.version AS purchaseOrderVersion,pol.version AS lineVersion
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id=pol.purchase_order_id
      JOIN business_partners bp ON bp.id=po.vendor_id
      JOIN products p ON p.id=pol.product_id
      WHERE (?='' OR po.id=?)
        AND (?<>'billable' OR (CASE WHEN pol.fulfillment_route='drop_ship'
          THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0)
          ELSE COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0) END)
          > COALESCE((SELECT SUM(vbl.quantity) FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id WHERE vbl.purchase_order_line_id=pol.id AND vb.status<>'void'),0))
        AND (?='' OR po.number LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\')
      ORDER BY po.number DESC,p.sku LIMIT ? OFFSET ?`, partnerId ?? "", partnerId ?? "", role ?? "", term, like, like, like, like, boundedLimit, boundedOffset) };
  }
  if (kind === "customerInvoices") {
    return { items: await all<Record<string, unknown>>(`SELECT ci.id,ci.number,ci.customer_id AS customerId,bp.name AS customerName,ci.status,ci.invoice_date AS invoiceDate,ci.due_date AS dueDate,ci.currency,ci.exchange_rate_to_base AS exchangeRateToBase,
        ci.total_cents AS totalCents,ci.paid_cents AS paidCents,
        MAX(ci.total_cents-ci.paid_cents-COALESCE((SELECT SUM(cc.amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0),0) AS outstandingCents,
        ci.version
      FROM customer_invoices ci JOIN business_partners bp ON bp.id=ci.customer_id
      WHERE ci.status<>'void' AND (?='' OR ci.customer_id=?) AND (?<>'open' OR MAX(ci.total_cents-ci.paid_cents-COALESCE((SELECT SUM(cc.amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0),0)>0)
        AND (?='' OR ci.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\')
      ORDER BY ci.number DESC LIMIT ? OFFSET ?`, partnerId ?? "", partnerId ?? "", role ?? "", term, like, like, boundedLimit, boundedOffset) };
  }
  if (kind === "vendorBills") {
    return { items: await all<Record<string, unknown>>(`SELECT vb.id,vb.number,vb.vendor_id AS vendorId,bp.name AS vendorName,vb.status,vb.match_status AS matchStatus,
        vb.vendor_invoice_number AS vendorInvoiceNumber,vb.total_cents AS totalCents,vb.due_date AS dueDate,vb.currency,vb.exchange_rate_to_base AS exchangeRateToBase,vb.version
      FROM vendor_bills vb JOIN business_partners bp ON bp.id=vb.vendor_id
      WHERE (?='' OR vb.vendor_id=?) AND (?='' OR vb.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(vb.vendor_invoice_number,'') LIKE ? ESCAPE '\\')
      ORDER BY vb.number DESC LIMIT ?`, partnerId ?? "", partnerId ?? "", term, like, like, like, boundedLimit) };
  }
  if (kind === "costLayers") {
    return { items: await all<Record<string, unknown>>(`SELECT cl.id,p.sku,p.name AS productName,cl.remaining_qty AS remainingQuantity,cl.received_qty AS receivedQuantity,
        cl.unit_cost_cents AS unitCostCents,cl.landed_cost_cents AS landedCostCents,cl.received_at AS receivedAt,cl.status
      FROM cost_layers cl JOIN products p ON p.id=cl.product_id
      WHERE cl.remaining_qty>0 AND (?='' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')
      ORDER BY cl.received_at DESC LIMIT ?`, term, like, like, boundedLimit) };
  }
  if (kind === "products") {
    // Availability travels with the option so the person taking the order can see whether
    // the branch can actually supply the line before committing to it.
    const items = await all<Record<string, unknown>>(`SELECT p.id,p.sku,p.manufacturer_sku AS manufacturerSku,p.name,p.category,p.material,p.dimensions,p.finish,
      p.tracking_policy AS trackingPolicy,p.inventory_policy AS inventoryPolicy,p.reorder_point AS reorderPoint,p.max_stock_level AS maxStockLevel,
      p.reorder_rule_mode AS reorderRuleMode,p.reorder_rule_percent AS reorderRulePercent,
      p.selling_price_cents AS sellingPriceCents,p.standard_cost_cents AS standardCostCents,p.last_unit_cost_cents AS lastUnitCostCents,
      p.last_unit_cost_source_po_id AS lastUnitCostSourcePoId,p.last_unit_cost_at AS lastUnitCostAt,p.suggested_selling_price_cents AS suggestedSellingPriceCents,
      p.pricing_mode AS pricingMode,p.applied_margin_rule_id AS appliedMarginRuleId,
      p.base_uom_id AS baseUomId,p.purchase_uom_id AS purchaseUomId,p.sales_uom_id AS salesUomId,p.version,
      COALESCE((SELECT SUM(ib.on_hand_qty-ib.reserved_qty) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id
                 WHERE ib.product_id=p.id AND l.active=1 AND l.inventory_status='usable' AND (?='' OR l.warehouse_id=?)),0) AS availableQuantity,
      COALESCE((SELECT SUM(MAX(pol.ordered_qty-pol.closed_qty-COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0),0))
                 FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id
                WHERE pol.product_id=p.id AND po.lifecycle_status='approved'),0) AS incomingQuantity
      FROM products p WHERE p.active=1 AND (?='' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR COALESCE(p.manufacturer_sku,'') LIKE ? ESCAPE '\\' OR p.dimensions LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM product_aliases pa WHERE pa.product_id=p.id AND pa.alias LIKE ? ESCAPE '\\'))
      ORDER BY CASE WHEN p.sku=? THEN 0 WHEN p.sku LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,p.name,p.id LIMIT ?`, scopedWarehouse, scopedWarehouse, term, like, like, like, like, like, term, `${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`, boundedLimit);
    return { items: await effectivePricesForProducts({ products: items, usage: role === "vendor" ? "purchase" : "sales", partnerId, quantity, currency, exchangeRateToBase }) };
  }
  if (kind === "locations") {
    // "stocked" lists every active bin that physically holds stock a person can pull from — usable,
    // quarantine, and damaged — but never in-transit locations. Vendor returns of damaged
    // receipts source from quarantine, so the picker cannot be usable-only.
    const stockedOnly = role === "stocked";
    const inventoryStatus = role === "bin" ? "usable" : ["usable", "quarantine", "damaged", "in_transit", "return_pending", "non_usable"].includes(role ?? "") ? role! : "";
    const scopedProduct = productId?.trim() ?? "";
    const items = await all<Record<string, unknown>>(`SELECT l.id,l.code,l.name,l.location_type AS locationType,l.inventory_status AS inventoryStatus,
      l.warehouse_id AS warehouseId,w.code AS warehouseCode,w.name AS warehouseName,l.version,
      COALESCE((SELECT ib.on_hand_qty-ib.reserved_qty FROM inventory_balances ib WHERE ib.product_id=? AND ib.location_id=l.id),0) AS availableQuantity
      FROM locations l JOIN warehouses w ON w.id=l.warehouse_id
      WHERE l.active=1 AND w.active=1 AND (?='' OR (?='non_usable' AND l.inventory_status IN ('quarantine','damaged')) OR l.inventory_status=?)
        AND (?=0 OR (l.inventory_status IN ('usable','quarantine','damaged') AND l.location_type<>'in_transit'))
        AND (?<>'bin' OR l.warehouse_id=?)
        AND (?='' OR COALESCE((SELECT ib.on_hand_qty-ib.reserved_qty FROM inventory_balances ib WHERE ib.product_id=? AND ib.location_id=l.id),0)>0)
        AND (?='' OR l.code LIKE ? ESCAPE '\\' OR l.name LIKE ? ESCAPE '\\' OR w.code LIKE ? ESCAPE '\\' OR w.name LIKE ? ESCAPE '\\')
      ORDER BY CASE WHEN ?<>'' AND l.warehouse_id=? THEN 0 ELSE 1 END,w.code,l.code,l.id LIMIT ?`,
      scopedProduct, inventoryStatus, inventoryStatus, inventoryStatus, stockedOnly ? 1 : 0, role ?? "", scopedWarehouse, scopedProduct, scopedProduct,
      term, like, like, like, like, scopedWarehouse, scopedWarehouse, boundedLimit);
    return { items };
  }
  const partnerRole = role === "vendor" || role === "customer" ? role : "";
  const items = await all<Record<string, unknown>>(`SELECT id,code,name,partner_type AS partnerType,email,phone,currency,payment_terms AS paymentTerms,
      address_line_1 AS addressLine1,address_line_2 AS addressLine2,city,region,postal_code AS postalCode,country,
      credit_limit_cents AS creditLimitCents,credit_hold AS creditHold,version
    FROM business_partners WHERE active=1 AND (?='' OR partner_type=? OR partner_type='both')
      AND (?='' OR code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR COALESCE(email,'') LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM master_record_merges mr WHERE mr.entity_type='business_partner' AND mr.target_id=business_partners.id AND mr.source_label LIKE ? ESCAPE '\\'))
    ORDER BY CASE WHEN code=? THEN 0 WHEN code LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,name,id LIMIT ?`, partnerRole, partnerRole, term, like, like, like, like, term, `${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`, boundedLimit);
  return { items };
}
