import { all, commandD1, commandGuardSql, ensureDatabase, first, newId, nextDocumentNumber, roundQuantity, statement } from "./inventory-db";
import { assertPeriodOpen } from "./policy";
import type { AppCapability } from "./auth";
import { normalizeProductQuantity, ProductQuantityError, validateBaseProductQuantity } from "./product-quantities";
import { effectivePricesForProducts } from "./pricing";

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

type CommandResult = {
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

function postingDateValue(payload: CommandPayload) {
  const value = typeof payload.postingDate === "string" && payload.postingDate.trim()
    ? payload.postingDate.trim()
    : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DomainError("VALIDATION_ERROR", "postingDate must use YYYY-MM-DD format.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DomainError("VALIDATION_ERROR", "postingDate must be a valid calendar date.");
  }
  return value;
}

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

async function outgoingTracking(productId: string, locationId: string, quantity: number, payload: CommandPayload): Promise<OutgoingTracking> {
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
  const unit = await first<{ lotId: string | null; version: number }>("SELECT lot_id AS lotId,version FROM inventory_units WHERE id=? AND product_id=? AND location_id=? AND inventory_status='usable' AND lifecycle_status='on_hand' AND allocated_sales_order_line_id IS NULL", unitId, productId, locationId);
  if (!unit) throw new DomainError("INVALID_SERIAL_STATE", "The selected serial is not usable, unallocated on-hand stock at the reservation location.", 409);
  if (lotId && lotId !== unit.lotId) throw new DomainError("SERIAL_LOT_MISMATCH", "The serial does not belong to the selected lot.", 409);
  return { policy: "serial", lotId: unit.lotId, unitId, unitVersion: unit.version, claimSql: " AND EXISTS (SELECT 1 FROM inventory_units iu WHERE iu.id=? AND iu.product_id=? AND iu.location_id=? AND iu.inventory_status='usable' AND iu.lifecycle_status='on_hand' AND iu.allocated_sales_order_line_id IS NULL AND iu.version=?)", claimBindings: [unitId, productId, locationId, unit.version] };
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

function layerClaimPredicate(layers: CostLayerAllocation[]) {
  return layers.map(() => "AND EXISTS (SELECT 1 FROM cost_layers WHERE id = ? AND remaining_qty >= ?)").join(" ");
}

function layerClaimBindings(layers: CostLayerAllocation[]) {
  return layers.flatMap((layer) => [layer.id, layer.quantity]);
}

function layerConsumptionPrepared(input: InventoryCommand, layers: CostLayerAllocation[]) {
  const marker = commandExistsPrepared(input);
  return layers.map((layer) => commandD1(input).prepare(`UPDATE cost_layers
    SET remaining_qty = remaining_qty - ?,
        status = CASE WHEN remaining_qty - ? = 0 THEN 'consumed' ELSE 'open' END
    WHERE id = ? AND remaining_qty >= ? AND ${marker}`)
    .bind(layer.quantity, layer.quantity, layer.id, layer.quantity));
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
  reverseShipment: "operationalWrite",
  customerReturn: "operationalWrite",
  postCustomerReturn: "operationalWrite",
  inventoryAdjustment: "operationalWrite",
  postInventoryAdjustment: "operationalWrite",
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

async function getPurchaseLine(orderId: string, lineId?: string) {
  const line = await first<PurchaseLineState>(
    `SELECT pol.id, pol.purchase_order_id AS purchaseOrderId, pol.product_id AS productId,
            pol.ordered_qty AS orderedQty, pol.closed_qty AS closedQty,
            pol.unit_cost_cents AS unitCostCents,pol.fulfillment_route AS fulfillmentRoute,pol.version AS lineVersion,
            pol.source_sales_order_line_id AS sourceSalesOrderLineId,po.version, po.expected_date AS expectedDate,
            po.lifecycle_status AS lifecycleStatus,
            COALESCE(SUM(sm.quantity), 0) AS netReceivedQty,
            MAX(pol.ordered_qty - pol.closed_qty - COALESCE(SUM(sm.quantity), 0), 0) AS openToReceiveQty
       FROM purchase_order_lines pol
       JOIN purchase_orders po ON po.id = pol.purchase_order_id
       LEFT JOIN stock_movements sm ON sm.purchase_order_line_id = pol.id
      WHERE po.id = ? AND (? IS NULL OR pol.id = ?)
      GROUP BY pol.id
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
  const line = await getPurchaseLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
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
  const locationId = requiredText(payload, "locationId");
  const quarantineLocationId = damagedQuantity > 0 ? requiredText(payload, "quarantineLocationId") : locationId;
  await requireActiveLocation(locationId, ["usable"], "accepted receipt inventory");
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
  const usableValueCents = Math.round(usableQuantity * valuation.unitCostCents);
  const damagedValueCents = valuation.valueCents - usableValueCents;
  const result: CommandResult = {
    message: `${receiptNumber} posted for ${enteredQuantity} ${quantityState.fromUomCode} (${quantity} ${quantityState.baseUomCode}).`,
    impact: {
      physical: `${quantity} units added to on-hand inventory${damagedQuantity ? `; ${damagedQuantity} routed to quarantine` : ""}.`,
      commercial: `Open incoming decreased by ${Math.min(quantity,line.openToReceiveQty)}${excessQuantity?`; ${excessQuantity} excess units received under tolerance or approval`:""}.`,
      financial: "No vendor bill or payment was created.",
      onHandDelta: quantity,
      incomingDelta: -Math.min(quantity,line.openToReceiveQty),
      reservedDelta: 0,
      availableDelta: usableQuantity,
    },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  const locationClaimSql = ` AND EXISTS (SELECT 1 FROM locations WHERE id=? AND active=1 AND inventory_status='usable')${damagedQuantity > 0 ? " AND EXISTS (SELECT 1 FROM locations WHERE id=? AND active=1 AND inventory_status IN ('quarantine','damaged'))" : ""}`;
  const locationClaimBindings = damagedQuantity > 0 ? [locationId, quarantineLocationId] : [locationId];
  const commands: D1PreparedStatement[] = [
    logPrepared(input, result, "purchase_order_lines", `AND COALESCE((SELECT version FROM valuation_policies WHERE product_id = ?), 0) = ?${overReceiptApproval?" AND EXISTS (SELECT 1 FROM approvals WHERE id=? AND version=? AND status='approved' AND consumed_at IS NULL)":""}${tracking.claimSql}${locationClaimSql}`, [line.productId, valuation.version,...(overReceiptApproval?[overReceiptApproval.id,overReceiptApproval.version]:[]),...tracking.claimBindings,...locationClaimBindings]),
    db.prepare(`UPDATE purchase_order_lines SET version=version+1 WHERE id=? AND version=? AND ${exists}`).bind(line.id, line.lineVersion),
    db.prepare(`UPDATE purchase_orders SET version = version + 1 WHERE id = ? AND ${exists}`).bind(input.entityId),
    db.prepare(`INSERT INTO receipts (id, number, purchase_order_id, status, posted_at, version)
                SELECT ?, ?, ?, 'posted', ?, 1 WHERE ${exists}`).bind(receiptId, receiptNumber, input.entityId, now),
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
                  ON CONFLICT(product_id, location_id) DO UPDATE SET on_hand_qty = on_hand_qty + excluded.on_hand_qty, version = version + 1`)
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
                  ON CONFLICT(product_id, location_id) DO UPDATE SET on_hand_qty = on_hand_qty + excluded.on_hand_qty, version = version + 1`)
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
  }
  commands.push(
    auditPrepared(input, "purchase_order", input.entityId, "receipt_posted", result.message,
      { ...result.impact, receiptId, inventoryValueCents: valuation.valueCents, costMethod: valuation.method }, now),
    outboxPrepared(input, "inventory.receipt_posted", "receipt", receiptId,
      { purchaseOrderId: input.entityId, productId: line.productId, quantity, inventoryValueCents: valuation.valueCents }, now)
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
    const locationId = requiredText(linePayload, "locationId");
    const quarantineLocationId = damagedQuantity > 0 ? requiredText(linePayload, "quarantineLocationId") : locationId;
    await requireActiveLocation(locationId, ["usable"], `lines[${index}] accepted inventory`);
    if (damagedQuantity > 0) await requireActiveLocation(quarantineLocationId, ["quarantine", "damaged"], `lines[${index}] quarantined inventory`);
    const lineInput: InventoryCommand = { ...input, version: lineVersion, payload: linePayload };
    const approval = await approvalForOverReceipt(lineInput, line, quantity);
    const valuation = await valuationForReceipt(line.productId, quantity, line.unitCostCents);
    const tracking = await incomingTracking(line.productId, quantity, linePayload);
    if (tracking.policy === "serial" && damagedQuantity !== 0 && damagedQuantity !== 1) throw new DomainError("SERIAL_CONDITION_SPLIT", "A serial-tracked unit must be entirely usable or entirely damaged.", 409);
    states.push({ line, lineVersion, quantity, damagedQuantity, usableQuantity, locationId, quarantineLocationId, valuation, tracking, approval, payload: linePayload });
  }
  const duplicateProduct = states.find((state, index) => states.findIndex((candidate) => candidate.line.productId === state.line.productId) !== index);
  if (duplicateProduct) throw new DomainError("DUPLICATE_PRODUCT_RECEIPT", "A batch receipt cannot contain the same product on multiple PO lines because valuation must advance once per product. Post those duplicate-product lines separately.", 409);

  const actor = optionalText(payload, "actor", "Avery Morgan");
  const receiptId = newId("receipt");
  const receiptNumber = await nextDocumentNumber("RCV");
  const now = postingTimestamp(payload);
  const totalQuantity = roundQuantity(states.reduce((sum, state) => sum + state.quantity, 0));
  const totalUsable = roundQuantity(states.reduce((sum, state) => sum + state.usableQuantity, 0));
  const totalValueCents = states.reduce((sum, state) => sum + state.valuation.valueCents, 0);
  const result: CommandResult = {
    message: `${receiptNumber} posted ${states.length} line${states.length === 1 ? "" : "s"} and ${totalQuantity} unit${totalQuantity === 1 ? "" : "s"} as one receipt.`,
    impact: {
      physical: `${totalQuantity} units added to on-hand inventory; ${roundQuantity(totalQuantity - totalUsable)} routed to quarantine.`,
      commercial: "Each purchase-order line advanced independently; open incoming decreased by the retained receipt quantities.",
      financial: `No vendor bill or payment was created. Inventory value increased by ${totalValueCents} cents.`,
      onHandDelta: totalQuantity,
      incomingDelta: -roundQuantity(states.reduce((sum, state) => sum + Math.min(state.quantity, state.line.openToReceiveQty), 0)),
      reservedDelta: 0,
      availableDelta: totalUsable,
    },
  };
  const claimSql = states.map((state) => `
    AND EXISTS (SELECT 1 FROM purchase_order_lines pol WHERE pol.id=? AND pol.purchase_order_id=po.id AND pol.version=?)
    AND COALESCE((SELECT version FROM valuation_policies WHERE product_id=?),0)=?
    ${state.approval ? "AND EXISTS (SELECT 1 FROM approvals WHERE id=? AND version=? AND status='approved' AND consumed_at IS NULL)" : ""}
    ${state.tracking.claimSql}
    AND EXISTS (SELECT 1 FROM locations WHERE id=? AND active=1 AND inventory_status='usable')
    ${state.damagedQuantity > 0 ? "AND EXISTS (SELECT 1 FROM locations WHERE id=? AND active=1 AND inventory_status IN ('quarantine','damaged'))" : ""}`).join("\n");
  const claimBindings = states.flatMap((state) => [
    state.line.id, state.lineVersion, state.line.productId, state.valuation.version,
    ...(state.approval ? [state.approval.id, state.approval.version] : []),
    ...state.tracking.claimBindings,
    state.locationId,
    ...(state.damagedQuantity > 0 ? [state.quarantineLocationId] : []),
  ]);
  const db = commandD1(input);
  const exists = commandExistsPrepared(input);
  const commands: D1PreparedStatement[] = [
    statement(`INSERT OR IGNORE INTO command_log (idempotency_key,command,entity_id,response_json,request_hash,claim_token,created_at)
      SELECT ?,?,?,?,?,?,? FROM purchase_orders po WHERE po.id=? AND po.lifecycle_status='approved' ${claimSql}`,
      input.idempotencyKey, input.command, input.entityId, JSON.stringify(result), input.requestHash ?? null, input.claimToken ?? null, now, input.entityId, ...claimBindings),
    db.prepare(`INSERT INTO receipts (id,number,purchase_order_id,status,posted_at,version) SELECT ?,?,?,'posted',?,1 WHERE ${exists}`).bind(receiptId, receiptNumber, input.entityId, now),
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
      db.prepare(`INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) SELECT ?,?,?,0,1 WHERE ${exists} ON CONFLICT(product_id,location_id) DO UPDATE SET on_hand_qty=on_hand_qty+excluded.on_hand_qty,version=version+1`).bind(line.productId, locationId, usableQuantity),
      db.prepare(`INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status) SELECT ?,?,?,?,?,?,0,?,'open' WHERE ${exists}`).bind(newId("layer"), line.productId, usableMovementId, usableQuantity, usableQuantity, line.unitCostCents, now),
      valueEntryPrepared(input, { productId: line.productId, movementId: usableMovementId, entryType: "receipt", quantity: usableQuantity, unitCostCents: valuation.unitCostCents, valueCents: usableValueCents, method: valuation.method, referenceType: "receipt", referenceId: receiptId, postedAt: now, postedBy: actor }),
    );
    if (usableQuantity > 0 && tracking.policy !== "quantity") commands.push(db.prepare(`INSERT INTO movement_assignments (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${exists}`).bind(newId("assignment"), usableMovementId, tracking.lotId, tracking.unitId, usableQuantity));
    if (damagedQuantity > 0) commands.push(
      db.prepare(`INSERT INTO receipt_lines (id,receipt_id,purchase_order_line_id,product_id,location_id,quantity,condition) SELECT ?,?,?,?,?,?,'damaged' WHERE ${exists}`).bind(damagedLineId, receiptId, line.id, line.productId, quarantineLocationId, damagedQuantity),
      db.prepare(`INSERT INTO stock_movements (id,movement_type,product_id,quantity,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,purchase_order_line_id,posted_at,posted_by,unit_cost_cents,idempotency_key)
        SELECT ?,'purchase_receipt',?,?,?,'quarantine','receipt',?,?,?,?,?,?,? WHERE ${exists}`).bind(damagedMovementId, line.productId, damagedQuantity, quarantineLocationId, receiptId, damagedLineId, line.id, now, actor, line.unitCostCents, input.idempotencyKey),
      db.prepare(`INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) SELECT ?,?,?,0,1 WHERE ${exists} ON CONFLICT(product_id,location_id) DO UPDATE SET on_hand_qty=on_hand_qty+excluded.on_hand_qty,version=version+1`).bind(line.productId, quarantineLocationId, damagedQuantity),
      db.prepare(`INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status) SELECT ?,?,?,?,?,?,0,?,'open' WHERE ${exists}`).bind(newId("layer"), line.productId, damagedMovementId, damagedQuantity, damagedQuantity, line.unitCostCents, now),
      valueEntryPrepared(input, { productId: line.productId, movementId: damagedMovementId, entryType: "receipt", quantity: damagedQuantity, unitCostCents: valuation.unitCostCents, valueCents: damagedValueCents, method: valuation.method, referenceType: "receipt", referenceId: receiptId, postedAt: now, postedBy: actor }),
    );
    if (damagedQuantity > 0 && tracking.policy !== "quantity") commands.push(db.prepare(`INSERT INTO movement_assignments (id,movement_id,lot_id,inventory_unit_id,quantity) SELECT ?,?,?,?,? WHERE ${exists}`).bind(newId("assignment"), damagedMovementId, tracking.lotId, tracking.unitId, damagedQuantity));
    if (state.approval) commands.push(db.prepare(`UPDATE approvals SET consumed_at=?,consumed_by=?,consumed_entity_id=?,version=version+1 WHERE id=? AND version=? AND status='approved' AND consumed_at IS NULL AND ${exists}`).bind(now, actor, receiptId, state.approval.id, state.approval.version));
  }
  commands.push(
    auditPrepared(input, "purchase_order", input.entityId, "batch_receipt_posted", result.message, { receiptId, lineCount: states.length, totalQuantity, totalUsable, inventoryValueCents: totalValueCents }, now),
    outboxPrepared(input, "inventory.batch_receipt_posted", "receipt", receiptId, { purchaseOrderId: input.entityId, lineCount: states.length, totalQuantity, inventoryValueCents: totalValueCents }, now),
  );
  await db.batch(commands);
  return requireLogged(input, "One or more purchase-order lines changed before the batch receipt could post.");
}

async function closeRemainder(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const line = await getPurchaseLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  if (line.lifecycleStatus !== "approved") throw new DomainError("INVALID_STATE", "Only approved purchase-order commitments can be closed.", 409, line.version);
  const quantity = payload.quantity == null ? line.openToReceiveQty : positive(payload);
  const reason = requiredText(payload, "reason");
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The purchase order changed. Refresh before closing the remainder.", 409, line.version);
  if (quantity > line.openToReceiveQty) throw new DomainError("INVALID_QUANTITY", `Only ${line.openToReceiveQty} units can be closed.`, 409, line.version);
  const result: CommandResult = {
    message: `${quantity} unit${quantity === 1 ? "" : "s"} closed without receipt.`,
    impact: { physical: "On-hand inventory is unchanged.", commercial: `Incoming forecast decreased by ${quantity}.`, financial: "No financial posting was created.", onHandDelta: 0, incomingDelta: -quantity, reservedDelta: 0, availableDelta: 0 },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  const now = new Date().toISOString();
  const commands: D1PreparedStatement[] = [
    logPrepared(input, result, "purchase_orders"),
    db.prepare(`UPDATE purchase_order_lines SET closed_qty = closed_qty + ? WHERE id = ? AND ${exists}`).bind(quantity, line.id),
    db.prepare(`UPDATE purchase_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`).bind(input.entityId, input.version),
    auditPrepared(input, "purchase_order", input.entityId, "remainder_closed", result.message,
      { reason, quantity, lineId: line.id }, now),
    outboxPrepared(input, "purchase_order.remainder_closed", "purchase_order", input.entityId,
      { quantity, lineId: line.id, reason }, now),
  ];
  await db.batch(commands);
  return requireLogged(input, "The purchase order changed before the remainder could be closed.");
}

async function reopenRemainder(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const quantity = positive(payload);
  const reason = requiredText(payload, "reason");
  const expectedDate = requiredText(payload, "expectedDate");
  const line = await getPurchaseLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  if (line.lifecycleStatus !== "approved") throw new DomainError("INVALID_STATE", "Only approved purchase-order commitments can be reopened.", 409, line.version);
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
  const quantity = positive(payload);
  const reason = requiredText(payload, "reason");
  const receipt = await first<{ id: string; purchaseOrderId: string; version: number }>(
    "SELECT id, purchase_order_id AS purchaseOrderId, version FROM receipts WHERE id = ?",
    input.entityId
  );
  if (!receipt) throw new DomainError("NOT_FOUND", "Receipt was not found.", 404);
  if (receipt.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The receipt changed. Refresh before reversing it.", 409, receipt.version);
  const source = await first<{ movementId: string; receiptLineId: string; poLineId: string; productId: string; locationId: string; inventoryStatus: string; unitCostCents: number; remainingQty: number }>(
    `SELECT sm.id AS movementId, sm.source_line_id AS receiptLineId, sm.purchase_order_line_id AS poLineId,
            sm.product_id AS productId, sm.to_location_id AS locationId, sm.inventory_status AS inventoryStatus,
            sm.unit_cost_cents AS unitCostCents,
            sm.quantity + COALESCE(SUM(rev.quantity), 0) AS remainingQty
       FROM stock_movements sm
       LEFT JOIN stock_movements rev ON rev.reversal_of_movement_id = sm.id AND rev.movement_type = 'receipt_reversal'
      WHERE sm.source_document_type = 'receipt' AND sm.source_document_id = ?
        AND (? IS NULL OR sm.source_line_id = ?)
      GROUP BY sm.id HAVING remainingQty > 0 ORDER BY sm.id LIMIT 1`,
    input.entityId,
    typeof payload.lineId === "string" ? payload.lineId : null,
    typeof payload.lineId === "string" ? payload.lineId : null
  );
  if (!source) throw new DomainError("NOT_REVERSIBLE", "This receipt has no remaining quantity to reverse.", 409, receipt.version);
  if (quantity > source.remainingQty) throw new DomainError("INVALID_QUANTITY", `Only ${source.remainingQty} units remain reversible.`, 409, receipt.version);
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
  if (quantity > layer.remainingQty) {
    throw new DomainError("RECEIPT_LAYER_CONSUMED", `Only ${layer.remainingQty} units remain in this receipt's original cost layer; other receipts cannot fund its reversal.`, 409);
  }
  const blockingBill = await first<{ number: string; status: string; matchStatus: string }>(`SELECT vb.number,vb.status,vb.match_status AS matchStatus
      FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id
     WHERE vbl.purchase_order_line_id=? AND vb.status<>'void'
       AND (vb.match_status='matched' OR vb.status IN ('approved','partially_paid','paid'))
     LIMIT 1`, source.poLineId);
  if (blockingBill) throw new DomainError("RECEIPT_REVERSAL_AP_CONFLICT", `Receipt reversal is blocked by ${blockingBill.number} (${blockingBill.status}/${blockingBill.matchStatus}). Correct or credit the vendor bill first.`, 409, receipt.version);
  const balance = await first<{ onHandQty: number; reservedQty: number }>("SELECT on_hand_qty AS onHandQty, reserved_qty AS reservedQty FROM inventory_balances WHERE product_id = ? AND location_id = ?", source.productId, source.locationId);
  if (!balance || balance.onHandQty - balance.reservedQty < quantity) throw new DomainError("INSUFFICIENT_STOCK", "The source location no longer holds enough unreserved stock for this reversal.", 409, receipt.version);
  const tracking = await outgoingTracking(source.productId, source.locationId, quantity, payload);
  if (tracking.policy !== "quantity") {
    const assigned = await first<{ quantity: number }>(`SELECT COALESCE((SELECT SUM(ma.quantity) FROM movement_assignments ma WHERE ma.movement_id=? AND ((? IS NOT NULL AND ma.lot_id=?) OR (? IS NOT NULL AND ma.inventory_unit_id=?))),0)
        -COALESCE((SELECT SUM(reversal_assignment.quantity) FROM stock_movements reversal JOIN movement_assignments reversal_assignment ON reversal_assignment.movement_id=reversal.id WHERE reversal.reversal_of_movement_id=? AND reversal.movement_type='receipt_reversal' AND ((? IS NOT NULL AND reversal_assignment.lot_id=?) OR (? IS NOT NULL AND reversal_assignment.inventory_unit_id=?))),0) AS quantity`, source.movementId, tracking.lotId, tracking.lotId, tracking.unitId, tracking.unitId, source.movementId, tracking.lotId, tracking.lotId, tracking.unitId, tracking.unitId);
    if (Number(assigned?.quantity ?? 0) < quantity) throw new DomainError("RECEIPT_ASSIGNMENT_MISMATCH", "The selected lot or serial was not received on this exact receipt movement, or has already been reversed.", 409);
  }
  const totalLayerValueCents = Math.round(layer.receivedQty * layer.unitCostCents) + layer.landedCostCents;
  const consumedByOtherPostingsQty = roundQuantity(layer.receivedQty - layer.remainingQty - layer.priorReversedQty);
  const consumedByOtherPostingsValueCents = Math.round(totalLayerValueCents * consumedByOtherPostingsQty / layer.receivedQty);
  const remainingLayerValueCents = totalLayerValueCents - consumedByOtherPostingsValueCents - layer.priorReversedValueCents;
  const valueCents = quantity === layer.remainingQty
    ? remainingLayerValueCents
    : Math.round(totalLayerValueCents * quantity / layer.receivedQty);
  if (valueCents < 0) throw new DomainError("VALUATION_LINEAGE_INVALID", "The original receipt layer has inconsistent reversal value history.", 409);
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
      ? Math.max(0, Math.round(((totalOnHandQty * policy.averageCostCents) - valueCents) / (totalOnHandQty - quantity)))
      : 0
    : policy.averageCostCents;
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const movementId = newId("movement");
  const result: CommandResult = {
    message: `${quantity} unit${quantity === 1 ? "" : "s"} reversed from the posted receipt.`,
    impact: { physical: `${quantity} units removed from on-hand inventory.`, commercial: `Open incoming may increase by up to ${quantity}.`, financial: `Inventory value decreased by ${valueCents} cents from the original receipt layer, including landed cost; AP compatibility was verified before posting.`, onHandDelta: -quantity, incomingDelta: quantity, reservedDelta: 0, availableDelta: -quantity },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  const now = postingTimestamp(payload);
  const commands: D1PreparedStatement[] = [
    logPrepared(input, result, "receipts",
      `AND EXISTS (SELECT 1 FROM inventory_balances WHERE product_id = ? AND location_id = ? AND on_hand_qty - reserved_qty >= ?)
       AND EXISTS (SELECT 1 FROM cost_layers WHERE id = ? AND receipt_movement_id = ? AND remaining_qty >= ?)
       AND NOT EXISTS (SELECT 1 FROM vendor_bill_lines vbl JOIN vendor_bills vb ON vb.id=vbl.vendor_bill_id WHERE vbl.purchase_order_line_id=? AND vb.status<>'void' AND (vb.match_status='matched' OR vb.status IN ('approved','partially_paid','paid')))
       AND (SELECT COALESCE(SUM(on_hand_qty), 0) FROM inventory_balances WHERE product_id = ?) = ?
        AND COALESCE((SELECT version FROM valuation_policies WHERE product_id = ?), 0) = ?${tracking.claimSql}
        ${tracking.policy === "quantity" ? "" : "AND COALESCE((SELECT SUM(ma.quantity) FROM movement_assignments ma WHERE ma.movement_id=? AND ((? IS NOT NULL AND ma.lot_id=?) OR (? IS NOT NULL AND ma.inventory_unit_id=?))),0)-COALESCE((SELECT SUM(ra.quantity) FROM stock_movements rev JOIN movement_assignments ra ON ra.movement_id=rev.id WHERE rev.reversal_of_movement_id=? AND rev.movement_type='receipt_reversal' AND ((? IS NOT NULL AND ra.lot_id=?) OR (? IS NOT NULL AND ra.inventory_unit_id=?))),0)>=?"}`,
      [source.productId, source.locationId, quantity, layer.id, source.movementId, quantity, source.poLineId,
        source.productId, totalOnHandQty, source.productId, policy.version, ...tracking.claimBindings,
        ...(tracking.policy === "quantity" ? [] : [source.movementId, tracking.lotId, tracking.lotId, tracking.unitId, tracking.unitId, source.movementId, tracking.lotId, tracking.lotId, tracking.unitId, tracking.unitId, quantity])]),
    db.prepare(`UPDATE receipts SET version = version + 1, status = CASE WHEN ? = ? THEN 'reversed' ELSE 'partially_reversed' END
                WHERE id = ? AND version = ? AND ${exists}`).bind(quantity, source.remainingQty, input.entityId, input.version),
    db.prepare(`UPDATE purchase_orders SET version = version + 1 WHERE id = ? AND ${exists}`).bind(receipt.purchaseOrderId),
    db.prepare(`UPDATE inventory_balances SET on_hand_qty = on_hand_qty - ?, version = version + 1
                WHERE product_id = ? AND location_id = ? AND on_hand_qty - reserved_qty >= ? AND ${exists}`).bind(quantity, source.productId, source.locationId, quantity),
    db.prepare(`INSERT INTO stock_movements
      (id, movement_type, product_id, quantity, from_location_id, inventory_status, source_document_type,
       source_document_id, source_line_id, purchase_order_line_id, reversal_of_movement_id,
       posted_at, posted_by, unit_cost_cents, idempotency_key)
       SELECT ?, 'receipt_reversal', ?, ?, ?, ?, 'receipt_reversal', ?, ?, ?, ?, ?, ?, ?, ? WHERE ${exists}`)
      .bind(movementId, source.productId, -quantity, source.locationId, source.inventoryStatus, input.entityId, source.receiptLineId, source.poLineId, source.movementId, now, actor, unitCostCents, input.idempotencyKey),
    valueEntryPrepared(input, { productId: source.productId, movementId, entryType: "receipt_reversal",
      quantity: -quantity, unitCostCents, valueCents: -valueCents,
      method: costMethod, referenceType: "receipt", referenceId: input.entityId, postedAt: now, postedBy: actor }),
    db.prepare(`UPDATE cost_layers
      SET remaining_qty = remaining_qty - ?, status = CASE WHEN remaining_qty - ? = 0 THEN 'consumed' ELSE 'open' END
      WHERE id = ? AND receipt_movement_id = ? AND remaining_qty >= ? AND ${exists}`)
      .bind(quantity, quantity, layer.id, source.movementId, quantity),
    auditPrepared(input, "receipt", input.entityId, "receipt_reversed", result.message,
      { reason, quantity, movementId, sourceMovementId: source.movementId, costLayerId: layer.id,
        baseCostCents: Math.round(quantity * layer.unitCostCents), landedCostIncludedCents: valueCents - Math.round(quantity * layer.unitCostCents),
        inventoryValueCents: -valueCents, costMethod, apIntegrityChecked: true }, now),
    outboxPrepared(input, "inventory.receipt_reversed", "receipt", input.entityId,
      { movementId, sourceMovementId: source.movementId, costLayerId: layer.id, productId: source.productId,
        quantity, inventoryValueCents: -valueCents }, now),
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
  const replacementExpected = payload.replacementExpected === true;
  const line = await getPurchaseLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  const quantity = (await normalizedQuantity({ productId: line.productId, quantity: positive(payload), uomId: typeof payload.uomId === "string" ? payload.uomId : null, usage: "purchase", field: "quantity" })).baseQuantity;
  if (line.lifecycleStatus !== "approved") throw new DomainError("INVALID_STATE", "Vendor returns require an approved purchase order with posted receipts.", 409, line.version);
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The purchase order changed. Refresh before posting the vendor return.", 409, line.version);
  if (quantity > line.netReceivedQty) throw new DomainError("INVALID_QUANTITY", `Only ${line.netReceivedQty} net received units can be returned.`, 409, line.version);
  const locationId = requiredText(payload, "locationId");
  await requireActiveLocation(locationId, ["usable"], "vendor-return inventory");
  const balance = await first<{ onHandQty: number; reservedQty: number }>("SELECT on_hand_qty AS onHandQty, reserved_qty AS reservedQty FROM inventory_balances WHERE product_id = ? AND location_id = ?", line.productId, locationId);
  if (!balance || balance.onHandQty - balance.reservedQty < quantity) throw new DomainError("INSUFFICIENT_STOCK", "Not enough unreserved stock exists at the selected location.", 409, line.version);
  const tracking = await outgoingTracking(line.productId, locationId, quantity, payload);
  const valuation = await valuationForIssue(line.productId, quantity);
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const returnId = newId("vendor-return");
  const movementId = newId("movement");
  const returnNumber = await nextDocumentNumber("VRT");
  const now = postingTimestamp(payload);
  const result: CommandResult = {
    message: `${returnNumber} posted for ${quantity} unit${quantity === 1 ? "" : "s"}.`,
    impact: {
      physical: `${quantity} units removed from on-hand inventory.`,
      commercial: replacementExpected ? `${quantity} units are open to receive as replacement.` : `${quantity} units marked not expected; no replacement incoming.`,
      financial: `${replacementExpected ? "No credit assumed; replacement is expected." : "Vendor credit is expected but not yet posted."} Inventory value decreased by ${valuation.valueCents} cents.`,
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
      `AND EXISTS (SELECT 1 FROM inventory_balances WHERE product_id = ? AND location_id = ? AND on_hand_qty - reserved_qty >= ?) ${layerClaimPredicate(valuation.layers)}${tracking.claimSql}`,
      [line.productId, locationId, quantity, ...layerClaimBindings(valuation.layers), ...tracking.claimBindings]),
    db.prepare(`UPDATE purchase_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`).bind(input.entityId, input.version),
  ];
  if (!replacementExpected) commands.push(db.prepare(`UPDATE purchase_order_lines SET closed_qty = closed_qty + ? WHERE id = ? AND ${exists}`).bind(quantity, line.id));
  commands.push(
    db.prepare(`UPDATE inventory_balances SET on_hand_qty = on_hand_qty - ?, version = version + 1
                WHERE product_id = ? AND location_id = ? AND on_hand_qty - reserved_qty >= ? AND ${exists}`).bind(quantity, line.productId, locationId, quantity),
    db.prepare(`INSERT INTO vendor_returns
      (id, number, purchase_order_id, purchase_order_line_id, product_id, location_id, quantity, disposition, posted_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${exists}`)
      .bind(returnId, returnNumber, input.entityId, line.id, line.productId, locationId, quantity, replacementExpected ? "replacement" : "refund", now),
    db.prepare(`INSERT INTO stock_movements
      (id, movement_type, product_id, quantity, from_location_id, inventory_status, source_document_type,
       source_document_id, purchase_order_line_id, posted_at, posted_by, unit_cost_cents, idempotency_key)
      SELECT ?, 'vendor_return', ?, ?, ?, 'usable', 'vendor_return', ?, ?, ?, ?, ?, ? WHERE ${exists}`)
      .bind(movementId, line.productId, -quantity, locationId, returnId, line.id, now, actor, valuation.unitCostCents, input.idempotencyKey),
    valueEntryPrepared(input, { productId: line.productId, movementId, entryType: "vendor_return",
      quantity: -quantity, unitCostCents: valuation.unitCostCents, valueCents: -valuation.valueCents,
      method: valuation.method, referenceType: "vendor_return", referenceId: returnId, postedAt: now, postedBy: actor }),
    ...layerConsumptionPrepared(input, valuation.layers),
    auditPrepared(input, "purchase_order", input.entityId, "vendor_return_posted", result.message,
      { reason, replacementExpected, quantity, returnId, inventoryValueCents: -valuation.valueCents, costMethod: valuation.method }, now),
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
  const amountLabel = amountCents > 0
    ? new Intl.NumberFormat("en-CA", { style: "currency", currency: order.currency }).format(amountCents / 100)
    : "An unvalued allowance";
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
  if(line.fulfillmentRoute==="special_order"&&!line.linkedPurchaseOrderLineId)throw new DomainError("SUPPLY_LINK_REQUIRED","Special-order reservation requires an explicit linked purchase-order line.",409,line.version);
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The sales order changed. Refresh before reserving stock.", 409, line.version);
  const openToReserve = roundQuantity(line.orderedQty - line.canceledQty - line.shippedQty - line.reservedQty);
  if (quantity > openToReserve) throw new DomainError("INVALID_QUANTITY", `Only ${Math.max(openToReserve, 0)} units remain to reserve.`, 409, line.version);
  const requestedLocation = typeof payload.locationId === "string" ? payload.locationId : null;
  const balance = await first<{ locationId: string; onHandQty: number; reservedQty: number }>(
    `SELECT ib.location_id AS locationId, ib.on_hand_qty AS onHandQty, ib.reserved_qty AS reservedQty
       FROM inventory_balances ib JOIN locations l ON l.id = ib.location_id
      WHERE ib.product_id = ? AND l.inventory_status = 'usable' AND (? IS NULL OR ib.location_id = ?)
        AND ib.on_hand_qty - ib.reserved_qty >= ? ORDER BY ib.on_hand_qty - ib.reserved_qty DESC LIMIT 1`,
    line.productId, requestedLocation, requestedLocation, quantity
  );
  if (!balance) throw new DomainError("INSUFFICIENT_AVAILABILITY", "There is not enough usable, unreserved stock at the selected location.", 409, line.version);
  const reservationId = newId("reservation");
  const now = new Date().toISOString();
  const result: CommandResult = {
    message: `${quantity} unit${quantity === 1 ? "" : "s"} reserved for this sales order.`,
    impact: { physical: "On-hand inventory is unchanged.", commercial: `${quantity} units allocated to customer demand.`, financial: "No invoice was created.", onHandDelta: 0, incomingDelta: 0, reservedDelta: quantity, availableDelta: -quantity },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key, command, entity_id, response_json, request_hash, claim_token, created_at)
                SELECT ?, ?, ?, ?, ?, ?, ? FROM sales_orders so
                 WHERE so.id = ? AND so.version = ?
                   AND EXISTS (SELECT 1 FROM inventory_balances ib WHERE ib.product_id = ? AND ib.location_id = ? AND ib.on_hand_qty - ib.reserved_qty >= ?)`)
      .bind(input.idempotencyKey, input.command, input.entityId, JSON.stringify(result), input.requestHash ?? null, input.claimToken ?? null, now, input.entityId, input.version, line.productId, balance.locationId, quantity),
    db.prepare(`INSERT INTO reservations (id, sales_order_line_id, product_id, location_id, quantity, status, created_at)
                SELECT ?, ?, ?, ?, ?, 'active', ? WHERE ${exists}`).bind(reservationId, line.id, line.productId, balance.locationId, quantity, now),
    db.prepare(`UPDATE inventory_balances SET reserved_qty = reserved_qty + ?, version = version + 1
                WHERE product_id = ? AND location_id = ? AND ${exists}`).bind(quantity, line.productId, balance.locationId),
    db.prepare(`UPDATE sales_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`).bind(input.entityId, input.version),
    auditPrepared(input, "sales_order", input.entityId, "stock_reserved", result.message,
      { quantity, locationId: balance.locationId, reservationId }, now),
    outboxPrepared(input, "sales_order.stock_reserved", "reservation", reservationId,
      { salesOrderId: input.entityId, productId: line.productId, quantity, locationId: balance.locationId }, now),
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
  if(line.fulfillmentRoute==="special_order"&&!line.linkedPurchaseOrderLineId)throw new DomainError("SUPPLY_LINK_REQUIRED","Special-order shipment requires an explicit linked purchase-order line.",409,line.version);
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The sales order changed. Refresh before shipping.", 409, line.version);
  const activeReservations = await all<{ id: string; locationId: string; quantity: number }>(
    `SELECT id, location_id AS locationId, quantity FROM reservations
      WHERE sales_order_line_id = ? AND status = 'active' AND quantity > 0
      ORDER BY created_at, id`, line.id
  );
  let remaining = quantity;
  const allocations = activeReservations.flatMap((reservation) => {
    if (remaining <= 0) return [];
    const allocated = roundQuantity(Math.min(reservation.quantity, remaining));
    remaining = roundQuantity(remaining - allocated);
    return allocated > 0 ? [{ ...reservation, allocated }] : [];
  });
  if (remaining > 0) throw new DomainError("NOT_RESERVED", "Reserve the requested quantity before posting shipment.", 409, line.version);
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
  const reservationClaims = trackedAllocations.map(() => `EXISTS (SELECT 1 FROM reservations r WHERE r.id = ? AND r.status = 'active' AND r.quantity >= ?)
    AND EXISTS (SELECT 1 FROM inventory_balances ib WHERE ib.product_id = ? AND ib.location_id = ? AND ib.on_hand_qty >= ? AND ib.reserved_qty >= ?)`).join(" AND ");
  const reservationClaimBindings = trackedAllocations.flatMap((allocation) => [
    allocation.id, allocation.allocated, line.productId, allocation.locationId, allocation.allocated, allocation.allocated,
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
      db.prepare(`UPDATE reservations SET quantity = quantity - ?, status = CASE WHEN quantity - ? = 0 THEN 'consumed' ELSE 'active' END
                  WHERE id = ? AND ${exists}`).bind(allocation.allocated, allocation.allocated, allocation.id),
      db.prepare(`UPDATE inventory_balances SET on_hand_qty = on_hand_qty - ?, reserved_qty = reserved_qty - ?, version = version + 1
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

async function reverseShipment(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const quantity = positive(payload);
  const reason = requiredText(payload, "reason");
  const lineId = typeof payload.lineId === "string" ? payload.lineId : null;
  const source = await first<{
    shipmentId: string;
    shipmentVersion: number;
    shipmentStatus: string;
    salesOrderId: string;
    salesOrderVersion: number;
    salesOrderStatus: string;
    salesOrderLineId: string;
    productId: string;
    locationId: string;
    inventoryStatus: string;
    movementId: string;
    originalQuantity: number;
    remainingQuantity: number;
    shippedLineQuantity: number;
    invoicedQuantity: number;
  }>(`SELECT sh.id AS shipmentId, sh.version AS shipmentVersion, sh.status AS shipmentStatus,
             so.id AS salesOrderId, so.version AS salesOrderVersion, so.lifecycle_status AS salesOrderStatus,
             sl.sales_order_line_id AS salesOrderLineId, sl.product_id AS productId, sl.location_id AS locationId,
             sm.inventory_status AS inventoryStatus, sm.id AS movementId, sl.quantity AS originalQuantity,
             sl.quantity - COALESCE((SELECT SUM(rev.quantity) FROM stock_movements rev
               WHERE rev.reversal_of_movement_id = sm.id AND rev.movement_type = 'shipment_reversal'), 0) AS remainingQuantity,
             COALESCE((SELECT SUM(CASE WHEN sm2.movement_type = 'sales_shipment' THEN -sm2.quantity
                                      WHEN sm2.movement_type = 'shipment_reversal' THEN -sm2.quantity ELSE 0 END)
                         FROM stock_movements sm2 WHERE sm2.sales_order_line_id = sl.sales_order_line_id), 0) AS shippedLineQuantity,
             COALESCE((SELECT SUM(cil.quantity) FROM customer_invoice_lines cil
                         WHERE cil.sales_order_line_id = sl.sales_order_line_id), 0) AS invoicedQuantity
        FROM shipments sh
        JOIN sales_orders so ON so.id = sh.sales_order_id
        JOIN shipment_lines sl ON sl.shipment_id = sh.id
        JOIN stock_movements sm ON sm.source_document_type = 'shipment' AND sm.source_document_id = sh.id
          AND sm.source_line_id = sl.id AND sm.movement_type = 'sales_shipment'
       WHERE sh.id = ? AND (? IS NULL OR sl.id = ?)
       ORDER BY sl.id LIMIT 1`, input.entityId, lineId, lineId);
  if (!source) throw new DomainError("NOT_FOUND", "Shipment or shipment line was not found.", 404);
  if (source.shipmentVersion !== input.version) throw new DomainError("VERSION_CONFLICT", "The shipment changed. Refresh before reversing it.", 409, source.shipmentVersion);
  if (source.salesOrderStatus !== "confirmed") throw new DomainError("INVALID_STATE", "Only shipments for confirmed sales orders can be reversed.", 409);
  if (quantity > source.remainingQuantity) throw new DomainError("INVALID_QUANTITY", `Only ${source.remainingQuantity} units remain reversible.`, 409);
  if (source.shippedLineQuantity - quantity < source.invoicedQuantity) {
    throw new DomainError("INVOICED_SHIPMENT", "Issue or reverse the related customer invoice before reversing this shipped quantity.", 409);
  }
  const historical = await first<{ quantity: number; valueCents: number; restoredValueCents: number; unitCostCents: number; method: string }>(
    `SELECT COALESCE(SUM(-quantity), 0) AS quantity, COALESCE(SUM(-value_cents), 0) AS valueCents,
            COALESCE((SELECT SUM(reversal_value.value_cents)
                        FROM inventory_value_entries reversal_value
                        JOIN stock_movements reversal_movement ON reversal_movement.id = reversal_value.movement_id
                       WHERE reversal_movement.reversal_of_movement_id = ?
                         AND reversal_movement.movement_type = 'shipment_reversal'), 0) AS restoredValueCents,
            MAX(unit_cost_cents) AS unitCostCents, MAX(cost_method) AS method
       FROM inventory_value_entries WHERE movement_id = ? AND quantity < 0`, source.movementId, source.movementId);
  const historicalQuantity = Number(historical?.quantity ?? 0);
  if (historicalQuantity <= 0) throw new DomainError("VALUATION_HISTORY_MISSING", "The shipment has no immutable value entry to reverse.", 409);
  const unitCostCents = Math.round(Number(historical?.valueCents ?? 0) / historicalQuantity);
  const valueCents = quantity === source.remainingQuantity
    ? Number(historical?.valueCents ?? 0) - Number(historical?.restoredValueCents ?? 0)
    : Math.round(quantity * unitCostCents);
  const method = (historical?.method ?? "fifo") as ValuationMethod;
  const currentPolicy = await valuationPolicy(source.productId);
  const total = await first<{ onHandQty: number }>("SELECT COALESCE(SUM(on_hand_qty), 0) AS onHandQty FROM inventory_balances WHERE product_id = ?", source.productId);
  const nextAverageCostCents = Math.round(((Number(total?.onHandQty ?? 0) * currentPolicy.averageCostCents) + valueCents) / (Number(total?.onHandQty ?? 0) + quantity));
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const movementId = newId("movement");
  const now = postingTimestamp(payload);
  const result: CommandResult = {
    message: `${quantity} unit${quantity === 1 ? "" : "s"} reversed from the posted shipment.`,
    impact: { physical: `${quantity} units restored to on-hand inventory.`, commercial: `${quantity} units reopened to ship and were not automatically re-reserved.`, financial: `COGS was reversed by ${valueCents} cents; invoices remain separate.`, onHandDelta: quantity, incomingDelta: 0, reservedDelta: 0, availableDelta: quantity },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  const commands: D1PreparedStatement[] = [db.prepare(`INSERT OR IGNORE INTO command_log
      (idempotency_key, command, entity_id, response_json, request_hash, claim_token, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ? FROM shipments sh
     WHERE sh.id = ? AND sh.version = ?
       AND EXISTS (SELECT 1 FROM sales_orders so WHERE so.id = ? AND so.version = ? AND so.lifecycle_status = 'confirmed')
       AND EXISTS (SELECT 1 FROM stock_movements original
         WHERE original.id = ? AND -original.quantity - COALESCE((SELECT SUM(rev.quantity) FROM stock_movements rev
           WHERE rev.reversal_of_movement_id = original.id AND rev.movement_type = 'shipment_reversal'), 0) >= ?)
       AND COALESCE((SELECT SUM(CASE WHEN sm.movement_type = 'sales_shipment' THEN -sm.quantity
                                    WHEN sm.movement_type = 'shipment_reversal' THEN -sm.quantity ELSE 0 END)
                       FROM stock_movements sm WHERE sm.sales_order_line_id = ?), 0) - ?
           >= COALESCE((SELECT SUM(cil.quantity) FROM customer_invoice_lines cil WHERE cil.sales_order_line_id = ?), 0)
       AND COALESCE((SELECT version FROM valuation_policies WHERE product_id = ?), 0) = ?`)
    .bind(input.idempotencyKey, input.command, input.entityId, JSON.stringify(result), input.requestHash ?? null,
      input.claimToken ?? null, now, input.entityId, input.version, source.salesOrderId, source.salesOrderVersion,
      source.movementId, quantity, source.salesOrderLineId, quantity, source.salesOrderLineId,
      source.productId, currentPolicy.version)];
  commands.push(
    db.prepare(`UPDATE shipments SET version = version + 1,
      status = CASE WHEN ? = ? THEN 'reversed' ELSE 'partially_reversed' END
      WHERE id = ? AND version = ? AND ${exists}`)
      .bind(quantity, source.remainingQuantity, input.entityId, input.version),
    db.prepare(`UPDATE sales_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`)
      .bind(source.salesOrderId, source.salesOrderVersion),
    db.prepare(`INSERT INTO inventory_balances (product_id, location_id, on_hand_qty, reserved_qty, version)
      SELECT ?, ?, ?, 0, 1 WHERE ${exists}
      ON CONFLICT(product_id, location_id) DO UPDATE SET on_hand_qty = on_hand_qty + excluded.on_hand_qty, version = version + 1`)
      .bind(source.productId, source.locationId, quantity),
    db.prepare(`INSERT INTO stock_movements
      (id, movement_type, product_id, quantity, to_location_id, inventory_status, source_document_type,
       source_document_id, sales_order_line_id, reversal_of_movement_id, posted_at, posted_by, unit_cost_cents, idempotency_key)
      SELECT ?, 'shipment_reversal', ?, ?, ?, ?, 'shipment_reversal', ?, ?, ?, ?, ?, ?, ? WHERE ${exists}`)
      .bind(movementId, source.productId, quantity, source.locationId, source.inventoryStatus, input.entityId,
        source.salesOrderLineId, source.movementId, now, actor, unitCostCents, input.idempotencyKey),
    db.prepare(`INSERT INTO cost_layers
      (id, product_id, receipt_movement_id, received_qty, remaining_qty, unit_cost_cents, landed_cost_cents, received_at, status)
      SELECT ?, ?, ?, ?, ?, ?, 0, ?, 'open' WHERE ${exists}`)
      .bind(newId("layer"), source.productId, movementId, quantity, quantity, unitCostCents, now),
    valueEntryPrepared(input, { productId: source.productId, movementId, entryType: "shipment_reversal", quantity,
      unitCostCents, valueCents, method, referenceType: "shipment", referenceId: input.entityId, postedAt: now, postedBy: actor }),
    auditPrepared(input, "shipment", input.entityId, "shipment_reversed", result.message,
      { reason, quantity, movementId, originalMovementId: source.movementId, cogsReversedCents: valueCents, costMethod: method }, now),
    outboxPrepared(input, "inventory.shipment_reversed", "shipment", input.entityId,
      { salesOrderId: source.salesOrderId, productId: source.productId, quantity, cogsReversedCents: valueCents }, now)
  );
  if (currentPolicy.method === "average") {
    commands.push(db.prepare(`UPDATE valuation_policies SET average_cost_cents = ?, version = version + 1, updated_at = ?, updated_by = ?
      WHERE product_id = ? AND version = ? AND method = 'average' AND ${exists}`)
      .bind(nextAverageCostCents, now, actor, source.productId, currentPolicy.version));
  }
  await db.batch(commands);
  return requireLogged(input, "The shipment or sales order changed before the reversal could post.");
}

async function postCustomerReturn(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const reason = requiredText(payload, "reason");
  const line = await getSalesLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  const quantity = (await normalizedQuantity({ productId: line.productId, quantity: positive(payload), uomId: typeof payload.uomId === "string" ? payload.uomId : null, usage: "sales", field: "quantity" })).baseQuantity;
  if (line.lifecycleStatus !== "confirmed") throw new DomainError("INVALID_STATE", "Customer returns require a confirmed sales order with posted shipment.", 409, line.version);
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
                ON CONFLICT(product_id, location_id) DO UPDATE SET on_hand_qty = on_hand_qty + excluded.on_hand_qty, version = version + 1`)
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
  const balance = await first<{ onHandQty: number; reservedQty: number; version: number }>(
    "SELECT on_hand_qty AS onHandQty, reserved_qty AS reservedQty, version FROM inventory_balances WHERE product_id = ? AND location_id = ?",
    input.entityId, locationId
  );
  if (!balance) throw new DomainError("NOT_FOUND", "No inventory balance exists for this product and location.", 404);
  if (balance.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The inventory balance changed. Refresh before posting the count.", 409, balance.version);
  if (countedQuantity < balance.reservedQty) throw new DomainError("RESERVATION_CONFLICT", `Counted quantity cannot be below ${balance.reservedQty} actively reserved units.`, 409, balance.version);
  const delta = roundQuantity(countedQuantity - balance.onHandQty);
  const lossValuation = delta < 0 ? await valuationForIssue(input.entityId, Math.abs(delta)) : null;
  const policy = delta > 0 ? await valuationPolicy(input.entityId) : null;
  const gainActualUnitCostCents = delta > 0
    ? payload.unitCostCents == null
      ? (policy?.averageCostCents || policy?.standardCostCents || 0)
      : Math.round(asNumber(payload, "unitCostCents"))
    : 0;
  if (gainActualUnitCostCents < 0) throw new DomainError("VALIDATION_ERROR", "unitCostCents cannot be negative.");
  const gainValuation = delta > 0 ? await valuationForReceipt(input.entityId, delta, gainActualUnitCostCents) : null;
  const inventoryValueDeltaCents = lossValuation ? -lossValuation.valueCents : gainValuation?.valueCents ?? 0;
  const approval = await countApprovalForVariance(input, locationId, balance.onHandQty, countedQuantity, inventoryValueDeltaCents);
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const countId = newId("count");
  const movementId = newId("movement");
  const countNumber = await nextDocumentNumber("CNT");
  const now = postingTimestamp(payload);
  const result: CommandResult = {
    message: delta === 0 ? `${countNumber} posted with no variance.` : `${countNumber} posted with a ${delta > 0 ? "+" : ""}${delta} unit variance.`,
    impact: { physical: delta === 0 ? "Ledger and physical count agree; no movement created." : `${Math.abs(delta)} unit ${delta > 0 ? "gain" : "loss"} posted.`, commercial: "Orders and commitments are unchanged.", financial: `Inventory value changed by ${inventoryValueDeltaCents} cents; no invoice or bill was created.`, onHandDelta: delta, incomingDelta: 0, reservedDelta: 0, availableDelta: delta },
  };
  const exists = commandExistsPrepared(input);
  const db = commandD1(input);
  let claimPredicate = "AND on_hand_qty >= reserved_qty";
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
    logPrepared(input, result, "inventory_balances", claimPredicate, claimBindings),
    db.prepare(`UPDATE inventory_balances SET on_hand_qty = ?, version = version + 1
                WHERE product_id = ? AND location_id = ? AND version = ? AND ? >= reserved_qty AND ${exists}`)
      .bind(countedQuantity, input.entityId, locationId, input.version, countedQuantity),
    db.prepare(`INSERT INTO inventory_counts
      (id, number, product_id, location_id, recorded_qty, counted_qty, variance_qty, status, reason, counted_at, counted_by)
      SELECT ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ? WHERE ${exists}`)
      .bind(countId, countNumber, input.entityId, locationId, balance.onHandQty, countedQuantity, delta, reason, now, actor),
  ];
  if (delta !== 0) {
    commands.push(
      db.prepare(`INSERT INTO stock_movements
        (id, movement_type, product_id, quantity, from_location_id, to_location_id, inventory_status,
         source_document_type, source_document_id, posted_at, posted_by, unit_cost_cents, idempotency_key)
        SELECT ?, ?, ?, ?, ?, ?, 'usable', 'inventory_count', ?, ?, ?, ?, ? WHERE ${exists}`)
        .bind(movementId, delta > 0 ? "inventory_adjustment_gain" : "inventory_adjustment_loss", input.entityId, delta,
          delta < 0 ? locationId : null, delta > 0 ? locationId : null, countId, now, actor,
          lossValuation?.unitCostCents ?? gainValuation?.unitCostCents ?? 0, input.idempotencyKey),
      valueEntryPrepared(input, { productId: input.entityId, movementId,
        entryType: delta > 0 ? "inventory_adjustment_gain" : "inventory_adjustment_loss", quantity: delta,
        unitCostCents: lossValuation?.unitCostCents ?? gainValuation?.unitCostCents ?? 0,
        valueCents: inventoryValueDeltaCents,
        method: lossValuation?.method ?? gainValuation?.method ?? "fifo",
        referenceType: "inventory_count", referenceId: countId, postedAt: now, postedBy: actor })
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
    auditPrepared(input, "product", input.entityId, "inventory_count_posted", result.message,
      { reason, locationId, recordedQuantity: balance.onHandQty, countedQuantity, approvalId: approval?.id ?? null,
        movementId: delta === 0 ? null : movementId, inventoryValueDeltaCents }, now),
    outboxPrepared(input, "inventory.count_posted", "inventory_count", countId,
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
  if (["receive", "postreceipt", "postreceiptbatch", "reversereceipt", "vendorreturn", "postvendorreturn", "ship", "shipsale", "postshipment", "reverseshipment", "customerreturn", "postcustomerreturn", "inventoryadjustment", "postinventoryadjustment"].includes(normalizedCommand)) {
    await assertPeriodOpen("inventory", postingDate);
  }
  if (["receive", "postreceipt", "postreceiptbatch", "reversereceipt", "vendorreturn", "postvendorreturn", "priceonlycredit", "vendorpriceallowance"].includes(normalizedCommand)) await assertPeriodOpen("purchasing", postingDate);
  if (["ship", "shipsale", "postshipment", "reverseshipment", "customerreturn", "postcustomerreturn"].includes(normalizedCommand)) await assertPeriodOpen("sales", postingDate);
  if (["priceonlycredit", "vendorpriceallowance"].includes(normalizedCommand)) await assertPeriodOpen("accounting", postingDate);
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
    case "reverseshipment": return reverseShipment(input);
    case "customerreturn":
    case "postcustomerreturn": return postCustomerReturn(input);
    case "inventoryadjustment":
    case "postinventoryadjustment": return postInventoryAdjustment(input);
    default: throw new DomainError("UNKNOWN_COMMAND", `Unsupported command: ${input.command}.`);
  }
}

export type SnapshotPage = { page?: number; pageSize?: number; search?: string; scope?: string; status?: string; sort?: string; warehouseId?: string };

export function normalizeSnapshotPage(input: SnapshotPage = {}) {
  const page = Number.isInteger(input.page) && Number(input.page) > 0 ? Number(input.page) : 1;
  const pageSize = Number.isInteger(input.pageSize) ? Math.min(Math.max(Number(input.pageSize), 1), 100) : 50;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

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
  const status = input.status?.trim() ?? "";
  const scope = input.scope?.trim() ?? "";
  const sort = input.sort?.trim() ?? "priority";
  const requestedPurchaseStatus = ["purchase-orders", "expected-receipts", "vendor-returns"].includes(scope) ? status : "";
  const requestedSalesStatus = ["sales-orders", "fulfillment", "customer-returns", "customer-invoices"].includes(scope) ? status : "";

  /**
   * "Open to receive"/"Open to ship"/"Late" are worklist states rather than lifecycle
   * columns, so they resolve to a SQL predicate instead of a bound lifecycle value. The
   * fragments are picked from this fixed set — never interpolated from the request — and
   * carry no bindings, so every query that filters by status can splice them in without
   * disturbing its positional parameters.
   */
  const purchaseOpenLines = (order: string) => `EXISTS (SELECT 1 FROM purchase_order_lines pl WHERE pl.purchase_order_id=${order}.id
    AND pl.ordered_qty-pl.closed_qty-COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pl.id),0)>0)`;
  const salesOpenLines = (order: string) => `EXISTS (SELECT 1 FROM sales_order_lines sl WHERE sl.sales_order_id=${order}.id
    AND sl.ordered_qty-sl.canceled_qty-COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity
      WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sl.id),0)>0)`;
  const purchaseWorklistFilter = (order: string) =>
    requestedPurchaseStatus === "open" ? ` AND ${order}.lifecycle_status='approved' AND ${purchaseOpenLines(order)}`
      : requestedPurchaseStatus === "late" ? ` AND ${order}.lifecycle_status='approved' AND ${order}.expected_date<date('now') AND ${purchaseOpenLines(order)}`
      : requestedPurchaseStatus === "returnable" ? ` AND EXISTS (SELECT 1 FROM purchase_order_lines pl JOIN stock_movements sm ON sm.purchase_order_line_id=pl.id WHERE pl.purchase_order_id=${order}.id AND sm.movement_type='purchase_receipt')`
      : "";
  const salesWorklistFilter = (order: string) =>
    requestedSalesStatus === "open" ? ` AND ${order}.lifecycle_status='confirmed' AND ${salesOpenLines(order)}`
      // Reserved-and-not-yet-shipped is an aggregate comparison, matching what the
      // fulfillment worklist renders, so its row count equals its record count.
      : requestedSalesStatus === "reserved" ? ` AND ${order}.lifecycle_status='confirmed'
        AND COALESCE((SELECT SUM(rv.quantity) FROM sales_order_lines sl JOIN reservations rv ON rv.sales_order_line_id=sl.id AND rv.status='active' WHERE sl.sales_order_id=${order}.id),0)
          > COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END)
              FROM sales_order_lines sl2 JOIN stock_movements sm ON sm.sales_order_line_id=sl2.id WHERE sl2.sales_order_id=${order}.id),0)`
      : requestedSalesStatus === "shipped" ? ` AND EXISTS (SELECT 1 FROM sales_order_lines sl JOIN stock_movements sm ON sm.sales_order_line_id=sl.id WHERE sl.sales_order_id=${order}.id AND sm.movement_type='sales_shipment')`
      // Mirrors the blockedSalesOrders summary metric: open quantity that neither stock on
      // hand nor approved incoming supply can cover.
      : requestedSalesStatus === "blocked" ? ` AND ${order}.lifecycle_status='confirmed' AND EXISTS (
          SELECT 1 FROM sales_order_lines sl WHERE sl.sales_order_id=${order}.id
            AND MAX(sl.ordered_qty-sl.canceled_qty-COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sl.id),0),0)
              > COALESCE((SELECT SUM(ib.on_hand_qty-ib.reserved_qty) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE ib.product_id=sl.product_id AND l.active=1 AND l.inventory_status='usable'),0)
                + COALESCE((SELECT SUM(MAX(pol.ordered_qty-pol.closed_qty-COALESCE((SELECT SUM(sm2.quantity) FROM stock_movements sm2 WHERE sm2.purchase_order_line_id=pol.id),0),0)) FROM purchase_order_lines pol JOIN purchase_orders po2 ON po2.id=pol.purchase_order_id WHERE pol.product_id=sl.product_id AND po2.lifecycle_status='approved'),0))`
      : "";
  /**
   * One row per sales-order line: what is still open on it, what usable stock exists for its
   * product, and what approved purchasing has coming. Summing these per order gives the
   * availability a rep reads on the worklist; each line is evaluated independently, matching
   * the `blocked` filter, so an order whose two lines want the same SKU is judged the same way
   * in both places.
   */
  const salesLineSupply = (order: string) => `(SELECT
      MAX(sl.ordered_qty-sl.canceled_qty-COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sl.id),0),0) AS line_open,
      COALESCE((SELECT SUM(ib.on_hand_qty-ib.reserved_qty) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE ib.product_id=sl.product_id AND l.active=1 AND l.inventory_status='usable'),0) AS usable_qty,
      COALESCE((SELECT SUM(MAX(pol.ordered_qty-pol.closed_qty-COALESCE((SELECT SUM(sm2.quantity) FROM stock_movements sm2 WHERE sm2.purchase_order_line_id=pol.id),0),0)) FROM purchase_order_lines pol JOIN purchase_orders po2 ON po2.id=pol.purchase_order_id WHERE pol.product_id=sl.product_id AND po2.lifecycle_status='approved'),0) AS incoming_qty
    FROM sales_order_lines sl WHERE sl.sales_order_id=${order}.id)`;

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
  const billWorklistFilter = (bill: string) => scope === "vendor-bills" && status === "exception" ? ` AND ${bill}.match_status='exception'` : "";
  const billStatus = scope === "vendor-bills" && !billWorklistFilter("vb") ? status : "";
  const productStatus = ["stock", "products", "counts"].includes(scope) ? status : "";

  /**
   * Purchase-order page ordering. The parent query and the child line query must sort
   * identically or the lines fetched belong to a different page than the orders shown.
   */
  const purchaseOrderOrder = (order: string, partner: string, totals: string, movements: string) =>
    sort === "newest" ? `${order}.created_at DESC,${order}.number`
      : sort === "name" ? `${partner}.name,${order}.number`
      : scope === "vendor-returns" ? `CASE WHEN COALESCE(${movements}.net_received_qty,0) > 0 THEN 0 ELSE 1 END,${order}.expected_date DESC,${order}.number`
      : `CASE WHEN ${order}.lifecycle_status='approved' AND COALESCE(${totals}.ordered_qty,0)-COALESCE(${movements}.net_received_qty,0)-COALESCE(${totals}.closed_qty,0) > 0 THEN 0 ELSE 1 END,${order}.expected_date,${order}.number`;

  /**
   * Sales-order page ordering, with the same parent/child sorting contract as purchase
   * orders. Priority leads with the orders that still owe the customer something: at this
   * distributor's volume roughly nine in ten sales orders are shipped and invoiced, so
   * ordering by requested date alone buries every live order pages deep.
   */
  const salesOrderOrder = (order: string, partner: string, totals: string, movements: string, reserved: string) =>
    sort === "newest" ? `${order}.created_at DESC,${order}.number`
      : sort === "name" ? `${partner}.name,${order}.number`
      : scope === "fulfillment" ? `CASE WHEN COALESCE(${reserved}.reserved_qty,0) > COALESCE(${movements}.shipped_qty,0) THEN 0 ELSE 1 END,${order}.requested_date,${order}.number`
      : scope === "customer-returns" ? `CASE WHEN COALESCE(${movements}.shipped_qty,0) > 0 THEN 0 ELSE 1 END,${order}.requested_date DESC,${order}.number`
      : `CASE WHEN ${order}.lifecycle_status='draft' THEN 0
              WHEN ${order}.lifecycle_status='confirmed' AND COALESCE(${totals}.ordered_qty,0)-COALESCE(${totals}.canceled_qty,0)-COALESCE(${movements}.shipped_qty,0) > 0 THEN 0
              ELSE 1 END,${order}.requested_date,${order}.number`;

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
    counts: ["products", "inventoryBalances", "counts"],
    movements: ["movements"],
    "vendor-bills": ["bills"],
    partners: [],
    reports: ["products"],
    "workflow-empty": [],
    warehouse: ["purchaseOrders", "purchaseLines", "salesOrders", "salesLines", "products", "inventoryBalances"],
  };
  const requested = scopeDatasets[input.scope ?? ""];
  const needs = (dataset: string) => !requested || requested.includes(dataset);


  const [purchaseOrders, purchaseLines, products, salesOrders, salesLines, movements, bills, activities, counts, locations, partners, inventoryBalances, aggregate] = await Promise.all([
    needs("purchaseOrders") ? (pageAll<Record<string, unknown>>(`WITH line_totals AS (
      SELECT purchase_order_id, SUM(ordered_qty) ordered_qty, SUM(closed_qty) closed_qty FROM purchase_order_lines GROUP BY purchase_order_id
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
           po.project_reference AS projectReference,
           COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='purchase_order' AND dc.document_id=po.id AND dc.charge_type='freight'),0) AS freightCents,
           COALESCE((SELECT MAX(dc.tax_rate_bps) FROM document_charges dc WHERE dc.document_type='purchase_order' AND dc.document_id=po.id AND dc.charge_type='freight'),0) AS freightTaxRateBps,
           COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='purchase_order' AND dc.document_id=po.id AND dc.charge_type IN ('fee','handling_fee')),0) AS feeCents,
           COALESCE((SELECT MAX(dc.tax_rate_bps) FROM document_charges dc WHERE dc.document_type='purchase_order' AND dc.document_id=po.id AND dc.charge_type IN ('fee','handling_fee')),0) AS feeTaxRateBps,
           COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='purchase_order' AND dc.document_id=po.id AND dc.charge_type='returnable_deposit'),0) AS depositCents,
           po.version, bp.id AS vendorId, bp.name AS vendorName,
           lr.id AS latestReceiptId, lr.version AS latestReceiptVersion,
           COALESCE(lt.ordered_qty, 0) AS orderedQuantity, COALESCE(mt.gross_received_qty, 0) AS grossReceivedQuantity,
           COALESCE(mt.reversed_qty, 0) AS receiptReversedQuantity, COALESCE(mt.returned_qty, 0) AS vendorReturnedQuantity,
           COALESCE(mt.net_received_qty, 0) AS netReceivedQuantity, COALESCE(lt.closed_qty, 0) AS closedWithoutReceiptQuantity,
           CASE WHEN po.lifecycle_status='approved' THEN MAX(COALESCE(lt.ordered_qty,0) - COALESCE(mt.net_received_qty,0) - COALESCE(lt.closed_qty,0), 0) ELSE 0 END AS openToReceiveQuantity,
           CASE WHEN po.lifecycle_status='draft' THEN 'draft'
                WHEN po.lifecycle_status='pending_approval' THEN 'pending_approval'
                WHEN po.lifecycle_status='rejected' THEN 'rejected'
                WHEN COALESCE(mt.net_received_qty,0) > COALESCE(lt.ordered_qty,0) THEN 'over_received'
                WHEN COALESCE(mt.net_received_qty,0) = COALESCE(lt.ordered_qty,0) THEN 'fully_received'
                WHEN COALESCE(mt.net_received_qty,0) > 0 AND COALESCE(lt.ordered_qty,0) - COALESCE(mt.net_received_qty,0) - COALESCE(lt.closed_qty,0) > 0 THEN 'partially_received'
                WHEN COALESCE(lt.closed_qty,0) > 0 AND COALESCE(lt.ordered_qty,0) - COALESCE(mt.net_received_qty,0) - COALESCE(lt.closed_qty,0) <= 0 THEN 'closed_short'
                ELSE 'not_received' END AS fulfillmentStatus
      FROM purchase_orders po JOIN business_partners bp ON bp.id = po.vendor_id
      LEFT JOIN line_totals lt ON lt.purchase_order_id = po.id LEFT JOIN movement_totals mt ON mt.purchase_order_id = po.id
      LEFT JOIN receipts lr ON lr.id = (
        SELECT r2.id FROM receipts r2 WHERE r2.purchase_order_id = po.id
        ORDER BY r2.posted_at DESC, r2.id DESC LIMIT 1
      )
      WHERE (?='' OR po.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(po.project_reference,'') LIKE ? ESCAPE '\\')
        AND (?='' OR po.lifecycle_status=?)${purchaseWorklistFilter('po')}
      ORDER BY ${purchaseOrderOrder("po", "bp", "lt", "mt")}`, term, like, like, like, purchaseStatus, purchaseStatus)) : Promise.resolve([]),
    needs("purchaseLines") ? (all<Record<string, unknown>>(`SELECT pol.id, pol.purchase_order_id AS purchaseOrderId, pol.product_id AS productId,
      p.sku, p.name AS productName, pol.ordered_qty AS orderedQuantity, pol.closed_qty AS closedWithoutReceiptQuantity,pol.version,
      pol.ordered_uom_id AS orderedUomId,pol.ordered_uom_qty AS orderedUomQuantity,pol.ordered_uom_unit_cost_cents AS orderedUomUnitCostCents,ou.code AS orderedUomCode,
      COALESCE(SUM(sm.quantity),0) AS netReceivedQuantity,
      MAX(pol.ordered_qty - pol.closed_qty - COALESCE(SUM(sm.quantity),0), 0) AS openToReceiveQuantity,
      pol.unit_cost_cents AS unitCostCents, pol.configuration_snapshot AS configurationSnapshot,
      pol.discount_cents AS discountCents,pol.taxable,pol.tax_rate_bps AS taxRateBps,
      pol.fulfillment_route AS fulfillmentRoute, pol.source_sales_order_line_id AS sourceSalesOrderLineId
      FROM purchase_order_lines pol JOIN products p ON p.id=pol.product_id LEFT JOIN units_of_measure ou ON ou.id=pol.ordered_uom_id
      LEFT JOIN stock_movements sm ON sm.purchase_order_line_id=pol.id
      WHERE pol.purchase_order_id IN (SELECT po2.id FROM purchase_orders po2 JOIN business_partners bp2 ON bp2.id=po2.vendor_id
        LEFT JOIN (SELECT purchase_order_id, SUM(ordered_qty) ordered_qty, SUM(closed_qty) closed_qty FROM purchase_order_lines GROUP BY purchase_order_id) lt2 ON lt2.purchase_order_id=po2.id
        LEFT JOIN (SELECT pol2.purchase_order_id, SUM(sm2.quantity) net_received_qty FROM purchase_order_lines pol2 LEFT JOIN stock_movements sm2 ON sm2.purchase_order_line_id=pol2.id GROUP BY pol2.purchase_order_id) mt2 ON mt2.purchase_order_id=po2.id
        WHERE (?='' OR po2.number LIKE ? ESCAPE '\\' OR bp2.name LIKE ? ESCAPE '\\' OR COALESCE(po2.project_reference,'') LIKE ? ESCAPE '\\')
          AND (?='' OR po2.lifecycle_status=?)${purchaseWorklistFilter('po2')}
        ORDER BY ${purchaseOrderOrder("po2", "bp2", "lt2", "mt2")} LIMIT ? OFFSET ?)
      GROUP BY pol.id ORDER BY pol.id LIMIT ?`, term, like, like, like, purchaseStatus, purchaseStatus, pageSize, offset, childLimit)) : Promise.resolve([]),
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
       WHERE po.lifecycle_status='approved' GROUP BY pol.id
    ), incoming AS (
      SELECT product_id, SUM(MAX(ordered_qty-closed_qty-net_received,0)) incoming_qty FROM line_net GROUP BY product_id
    ), sales_line_net AS (
      SELECT sol.id,sol.product_id,sol.ordered_qty,sol.canceled_qty,
             COALESCE(SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity
                               WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END),0) shipped_qty
        FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id
        LEFT JOIN stock_movements sm ON sm.sales_order_line_id=sol.id
       WHERE so.lifecycle_status='confirmed' GROUP BY sol.id
    ), demand AS (
      SELECT product_id,SUM(MAX(ordered_qty-canceled_qty-shipped_qty,0)) demand_qty FROM sales_line_net GROUP BY product_id
    )
    SELECT p.id, p.sku, p.manufacturer_sku AS manufacturerSku, p.name, p.category, p.material, p.dimensions,
           p.finish, p.tracking_policy AS trackingPolicy, p.inventory_policy AS inventoryPolicy,
           p.standard_cost_cents AS standardCostCents, p.selling_price_cents AS sellingPriceCents,
           p.base_uom_id AS baseUomId,p.purchase_uom_id AS purchaseUomId,p.sales_uom_id AS salesUomId,
           bu.code AS baseUomCode,pu.code AS purchaseUomCode,su.code AS salesUomCode,bu.precision AS quantityPrecision,
           p.reorder_point AS reorderPoint, COALESCE(b.on_hand_qty,0) AS onHand,
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
         AND (?='' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR COALESCE(p.manufacturer_sku,'') LIKE ? ESCAPE '\\' OR p.dimensions LIKE ? ESCAPE '\\' OR p.material LIKE ? ESCAPE '\\')
         AND (?='' OR p.inventory_policy=? OR p.tracking_policy=?)
       ORDER BY ${sort === "sku" ? "p.sku,p.id" : sort === "availability" ? "COALESCE(b.usable_qty-b.reserved_qty,0) DESC,p.name" : "p.name,p.id"}`,
      warehouseScope, warehouseScope, warehouseScope, warehouseScope, warehouseScope, warehouseScope, warehouseScope, warehouseScope,
      term, like, like, like, like, like, productStatus, productStatus, productStatus)) : Promise.resolve([]),
    needs("salesOrders") ? (pageAll<Record<string, unknown>>(`WITH line_totals AS (
      SELECT sales_order_id, SUM(ordered_qty) ordered_qty, SUM(canceled_qty) canceled_qty FROM sales_order_lines GROUP BY sales_order_id
    ), movement_totals AS (
      SELECT sol.sales_order_id,
             SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity
                      WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) shipped_qty,
             SUM(CASE WHEN sm.movement_type='customer_return' THEN sm.quantity ELSE 0 END) returned_qty
        FROM sales_order_lines sol LEFT JOIN stock_movements sm ON sm.sales_order_line_id=sol.id GROUP BY sol.sales_order_id
    ), reserved AS (
      SELECT sol.sales_order_id, SUM(r.quantity) reserved_qty FROM sales_order_lines sol
      JOIN reservations r ON r.sales_order_line_id=sol.id AND r.status='active' GROUP BY sol.sales_order_id
    ), invoiced AS (
      SELECT sol.sales_order_id, SUM(cil.quantity) invoiced_qty FROM sales_order_lines sol
      JOIN customer_invoice_lines cil ON cil.sales_order_line_id=sol.id
      JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id AND ci.status<>'void'
      GROUP BY sol.sales_order_id
    )
    SELECT so.id, so.number, so.lifecycle_status AS lifecycleStatus, so.billing_status AS billingStatus,
           so.requested_date AS requestedDate, so.currency,so.exchange_rate_to_base AS exchangeRateToBase,so.payment_terms AS paymentTerms,so.due_date AS dueDate, so.total_cents AS totalCents, so.owner_name AS ownerName,
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
           CASE WHEN so.lifecycle_status='confirmed' THEN MAX(COALESCE(lt.ordered_qty,0)-COALESCE(lt.canceled_qty,0)-COALESCE(mt.shipped_qty,0),0) ELSE 0 END AS openToShipQuantity,
           -- Supply position across every line, evaluated exactly like the blocked worklist
           -- filter above so a row and the queue it belongs to can never disagree. The client
           -- previously derived this from the first line's product within the current product
           -- page, which on any scope that ships no products marked every order short.
           COALESCE((SELECT SUM(MIN(s.line_open,s.usable_qty)) FROM ${salesLineSupply("so")} s),0) AS availableNowQuantity,
           COALESCE((SELECT SUM(MIN(MAX(s.line_open-MIN(s.line_open,s.usable_qty),0),s.incoming_qty)) FROM ${salesLineSupply("so")} s),0) AS incomingSupplyQuantity,
           CASE WHEN so.lifecycle_status='draft' THEN 'draft'
                WHEN so.lifecycle_status!='confirmed' THEN so.lifecycle_status
                WHEN COALESCE(mt.shipped_qty,0)>=COALESCE(lt.ordered_qty,0)-COALESCE(lt.canceled_qty,0) THEN 'fully_shipped'
                WHEN COALESCE(mt.shipped_qty,0)>0 THEN 'partially_shipped'
                WHEN COALESCE(r.reserved_qty,0)>0 THEN 'reserved' ELSE 'unreserved' END AS fulfillmentStatus
      FROM sales_orders so JOIN business_partners bp ON bp.id=so.customer_id
      LEFT JOIN line_totals lt ON lt.sales_order_id=so.id LEFT JOIN movement_totals mt ON mt.sales_order_id=so.id
       LEFT JOIN reserved r ON r.sales_order_id=so.id LEFT JOIN invoiced inv ON inv.sales_order_id=so.id
      WHERE (?='' OR so.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(so.project_reference,'') LIKE ? ESCAPE '\\')
        AND (?='' OR so.lifecycle_status=?)${salesWorklistFilter('so')}
      ORDER BY ${salesOrderOrder("so", "bp", "lt", "mt", "r")}`, term, like, like, like, salesStatus, salesStatus)) : Promise.resolve([]),
    needs("salesLines") ? (all<Record<string, unknown>>(`SELECT sol.id, sol.sales_order_id AS salesOrderId, sol.product_id AS productId,
      p.sku, p.name AS productName, sol.ordered_qty AS orderedQuantity, sol.canceled_qty AS canceledQuantity,
      sol.ordered_uom_id AS orderedUomId,sol.ordered_uom_qty AS orderedUomQuantity,sol.ordered_uom_unit_price_cents AS orderedUomUnitPriceCents,ou.code AS orderedUomCode,
      COALESCE(SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity
                        WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END),0) AS shippedQuantity,
      COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.sales_order_line_id=sol.id AND r.status='active'),0) AS reservedQuantity,
      sol.unit_price_cents AS unitPriceCents, sol.configuration_snapshot AS configurationSnapshot,
      sol.fulfillment_route AS fulfillmentRoute,sol.project_reference AS projectReference, sol.linked_purchase_order_line_id AS linkedPurchaseOrderLineId,
      sol.discount_cents AS discountCents,sol.taxable,sol.tax_rate_bps AS taxRateBps,
      -- Supply for this line's product. The reserve and ship dialogs used to look this up in
      -- whatever page of products the snapshot happened to carry; on the sales scope that page
      -- is empty, so they read zero available and disabled the very action they exist for.
      COALESCE((SELECT SUM(ib.on_hand_qty-ib.reserved_qty) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE ib.product_id=sol.product_id AND l.active=1 AND l.inventory_status='usable'),0) AS productAvailableQuantity,
      COALESCE((SELECT SUM(MAX(pol.ordered_qty-pol.closed_qty-COALESCE((SELECT SUM(sm3.quantity) FROM stock_movements sm3 WHERE sm3.purchase_order_line_id=pol.id),0),0)) FROM purchase_order_lines pol JOIN purchase_orders po3 ON po3.id=pol.purchase_order_id WHERE pol.product_id=sol.product_id AND po3.lifecycle_status='approved'),0) AS productIncomingQuantity
      FROM sales_order_lines sol JOIN products p ON p.id=sol.product_id LEFT JOIN units_of_measure ou ON ou.id=sol.ordered_uom_id
      LEFT JOIN stock_movements sm ON sm.sales_order_line_id=sol.id
      WHERE sol.sales_order_id IN (SELECT so2.id FROM sales_orders so2 JOIN business_partners bp2 ON bp2.id=so2.customer_id
        LEFT JOIN (SELECT sales_order_id, SUM(ordered_qty) ordered_qty, SUM(canceled_qty) canceled_qty FROM sales_order_lines GROUP BY sales_order_id) lt2 ON lt2.sales_order_id=so2.id
        LEFT JOIN (SELECT sol2.sales_order_id, SUM(CASE WHEN sm2.movement_type='sales_shipment' THEN -sm2.quantity WHEN sm2.movement_type='shipment_reversal' THEN -sm2.quantity ELSE 0 END) shipped_qty
                     FROM sales_order_lines sol2 LEFT JOIN stock_movements sm2 ON sm2.sales_order_line_id=sol2.id GROUP BY sol2.sales_order_id) mt2 ON mt2.sales_order_id=so2.id
        LEFT JOIN (SELECT sol3.sales_order_id, SUM(r3.quantity) reserved_qty FROM sales_order_lines sol3
                     JOIN reservations r3 ON r3.sales_order_line_id=sol3.id AND r3.status='active' GROUP BY sol3.sales_order_id) r2 ON r2.sales_order_id=so2.id
        WHERE (?='' OR so2.number LIKE ? ESCAPE '\\' OR bp2.name LIKE ? ESCAPE '\\' OR COALESCE(so2.project_reference,'') LIKE ? ESCAPE '\\')
          AND (?='' OR so2.lifecycle_status=?)${salesWorklistFilter('so2')}
        ORDER BY ${salesOrderOrder("so2", "bp2", "lt2", "mt2", "r2")} LIMIT ? OFFSET ?)
      GROUP BY sol.id ORDER BY sol.id LIMIT ?`, term, like, like, like, salesStatus, salesStatus, pageSize, offset, childLimit)) : Promise.resolve([]),
    needs("movements") ? (pageAll<Record<string, unknown>>(`SELECT sm.id, sm.movement_type AS type, sm.quantity, sm.inventory_status AS inventoryStatus,
      sm.source_document_type AS sourceDocumentType, sm.source_document_id AS sourceDocumentId,
      sm.posted_at AS postedAt, sm.posted_by AS postedBy, sm.reversal_of_movement_id AS reversalOfMovementId,
      sm.unit_cost_cents AS unitCostCents, COALESCE((SELECT SUM(ive.value_cents) FROM inventory_value_entries ive WHERE ive.movement_id=sm.id),0) AS inventoryValueCents,
      p.id AS productId, p.sku, p.name AS productName,
      fl.code AS fromLocationCode, tl.code AS toLocationCode
      FROM stock_movements sm JOIN products p ON p.id=sm.product_id
      LEFT JOIN locations fl ON fl.id=sm.from_location_id LEFT JOIN locations tl ON tl.id=sm.to_location_id
      WHERE (?='' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR COALESCE(sm.source_document_id,'') LIKE ? ESCAPE '\\' OR COALESCE(fl.code,'') LIKE ? ESCAPE '\\' OR COALESCE(tl.code,'') LIKE ? ESCAPE '\\' OR sm.posted_by LIKE ? ESCAPE '\\')
        AND (?='' OR sm.movement_type=?)
       ORDER BY ${sort === "oldest" ? "sm.posted_at,sm.id" : "sm.posted_at DESC,sm.id DESC"}`, term, like, like, like, like, like, like, movementStatus, movementStatus)) : Promise.resolve([]),
    needs("bills") ? (pageAll<Record<string, unknown>>(`SELECT vb.id, vb.number, vb.status, vb.match_status AS matchStatus,
      vb.total_cents AS totalCents, vb.due_date AS dueDate, vb.currency, vb.version,
      COALESCE((SELECT SUM(ROUND(vbl.quantity*pol.unit_cost_cents)) FROM vendor_bill_lines vbl JOIN purchase_order_lines pol ON pol.id=vbl.purchase_order_line_id WHERE vbl.vendor_bill_id=vb.id),0) AS authorizedLineValueCents,
      COALESCE((SELECT SUM(vbl.line_total_cents) FROM vendor_bill_lines vbl WHERE vbl.vendor_bill_id=vb.id),0) AS billedLineValueCents,
      bp.id AS vendorId, bp.name AS vendorName, po.number AS purchaseOrderNumber
       FROM vendor_bills vb JOIN business_partners bp ON bp.id=vb.vendor_id
       LEFT JOIN purchase_orders po ON po.id=vb.purchase_order_id
      WHERE (?='' OR vb.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(po.number,'') LIKE ? ESCAPE '\\' OR vb.vendor_invoice_number LIKE ? ESCAPE '\\')
        AND (?='' OR vb.status=? OR vb.match_status=?)${billWorklistFilter('vb')}
      ORDER BY ${sort === "newest" ? "COALESCE(vb.posted_at,vb.invoice_date,vb.due_date) DESC,vb.number" : "vb.due_date,vb.number"}`, term, like, like, like, like, billStatus, billStatus, billStatus)) : Promise.resolve([]),
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
    referenceAll<Record<string, unknown>>(`SELECT l.id,l.code,l.name,l.location_type AS locationType,l.inventory_status AS inventoryStatus,
      l.warehouse_id AS warehouseId,w.name AS warehouseName,l.active FROM locations l LEFT JOIN warehouses w ON w.id=l.warehouse_id WHERE l.active=1 ORDER BY w.code,l.code`),
    pageAll<Record<string, unknown>>(`SELECT id,code,name,partner_type AS partnerType,email,phone,
      address_line_1 AS addressLine1,address_line_2 AS addressLine2,city,region,postal_code AS postalCode,country,
      credit_limit_cents AS creditLimitCents,credit_hold AS creditHold,payment_terms AS paymentTerms,currency,version
      FROM business_partners WHERE active=1
        AND (?='' OR code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR COALESCE(email,'') LIKE ? ESCAPE '\\' OR COALESCE(city,'') LIKE ? ESCAPE '\\' OR COALESCE(postal_code,'') LIKE ? ESCAPE '\\')
        AND (?='' OR partner_type=? OR partner_type='both')
      ORDER BY ${sort === "code" ? "code,id" : "name,id"}`, term, like, like, like, like, like, scope === "partners" ? status : "", scope === "partners" ? status : ""),
    needs("inventoryBalances") ? (all<Record<string, unknown>>(`SELECT ib.product_id AS productId, ib.location_id AS locationId,
      ib.on_hand_qty AS recordedQuantity, ib.reserved_qty AS reservedQuantity, ib.version,
      l.code AS locationCode, l.name AS locationName, l.inventory_status AS inventoryStatus,
      w.id AS warehouseId, w.code AS warehouseCode, w.name AS warehouseName
      FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id
      JOIN warehouses w ON w.id=l.warehouse_id
      WHERE l.active=1 AND w.active=1 AND (?='' OR w.id=?)
        AND ib.product_id IN (SELECT p2.id FROM products p2 WHERE p2.active=1
          AND (?='' OR p2.sku LIKE ? ESCAPE '\\' OR p2.name LIKE ? ESCAPE '\\' OR COALESCE(p2.manufacturer_sku,'') LIKE ? ESCAPE '\\' OR p2.dimensions LIKE ? ESCAPE '\\' OR p2.material LIKE ? ESCAPE '\\')
          AND (?='' OR p2.inventory_policy=? OR p2.tracking_policy=?)
          ORDER BY ${sort === "sku" ? "p2.sku,p2.id" : "p2.name,p2.id"} LIMIT ? OFFSET ?)
      ORDER BY w.code,l.code,ib.product_id LIMIT ?`, warehouseScope, warehouseScope, term, like, like, like, like, like, productStatus, productStatus, productStatus, pageSize, offset, childLimit)) : Promise.resolve([]),
    first<Record<string, unknown>>(`SELECT
      (SELECT COUNT(*) FROM products WHERE active=1) AS skuCount,
      (SELECT COALESCE(SUM(ib.on_hand_qty),0) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE l.active=1 AND (?='' OR l.warehouse_id=?)) AS onHand,
      (SELECT COALESCE(SUM(ib.on_hand_qty),0) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE l.active=1 AND l.inventory_status='usable' AND (?='' OR l.warehouse_id=?)) AS usable,
      (SELECT COALESCE(SUM(ib.reserved_qty),0) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE l.active=1 AND (?='' OR l.warehouse_id=?)) AS reserved,
      (SELECT COALESCE(SUM(ib.on_hand_qty-ib.reserved_qty),0) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE l.active=1 AND l.inventory_status='usable' AND (?='' OR l.warehouse_id=?)) AS available,
      (SELECT COALESCE(SUM(MAX(pol.ordered_qty-pol.closed_qty-COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0),0)),0) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id WHERE po.lifecycle_status='approved') AS incoming,
      (SELECT COALESCE(SUM(ib.on_hand_qty),0) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE l.inventory_status<>'usable' AND (?='' OR l.warehouse_id=?)) AS quarantine,
      (SELECT COALESCE(SUM(value_cents),0) FROM inventory_value_entries) AS inventoryValueCents,
      (SELECT COALESCE(SUM(MAX(sol.ordered_qty-sol.canceled_qty-COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol.id),0),0)),0) FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id WHERE so.lifecycle_status='confirmed') AS openDemand,
      (SELECT COUNT(*) FROM purchase_orders po WHERE po.lifecycle_status='approved' AND EXISTS (SELECT 1 FROM purchase_order_lines pol WHERE pol.purchase_order_id=po.id AND pol.ordered_qty-pol.closed_qty-COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0)>0)) AS openPurchaseOrders,
      (SELECT COALESCE(SUM(MAX(pol.ordered_qty-pol.closed_qty-COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0),0)),0) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id WHERE po.lifecycle_status='approved') AS openReceiptUnits,
      (SELECT COUNT(*) FROM purchase_orders po WHERE po.lifecycle_status='approved' AND po.expected_date<date('now') AND EXISTS (SELECT 1 FROM purchase_order_lines pol WHERE pol.purchase_order_id=po.id AND pol.ordered_qty-pol.closed_qty-COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0)>0)) AS latePurchaseOrders,
      (SELECT COUNT(*) FROM purchase_orders WHERE lifecycle_status='pending_approval') AS pendingApprovals,
      (SELECT COUNT(*) FROM sales_orders so WHERE so.lifecycle_status='confirmed' AND EXISTS (SELECT 1 FROM sales_order_lines sol WHERE sol.sales_order_id=so.id AND sol.ordered_qty-sol.canceled_qty-COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol.id),0)>0)) AS openSalesOrders,
      (SELECT COUNT(*) FROM sales_orders so WHERE so.lifecycle_status='confirmed' AND EXISTS (
        SELECT 1 FROM sales_order_lines sol WHERE sol.sales_order_id=so.id
          AND MAX(sol.ordered_qty-sol.canceled_qty-COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol.id),0),0)
            > COALESCE((SELECT SUM(ib.on_hand_qty-ib.reserved_qty) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE ib.product_id=sol.product_id AND l.active=1 AND l.inventory_status='usable'),0)
              + COALESCE((SELECT SUM(MAX(pol.ordered_qty-pol.closed_qty-COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0),0)) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id WHERE pol.product_id=sol.product_id AND po.lifecycle_status='approved'),0)
      )) AS blockedSalesOrders,
      -- Same definition as the fulfillment worklist this tile links to, so the count the
      -- user clicks matches the number of rows they land on.
      (SELECT COUNT(*) FROM sales_orders so WHERE so.lifecycle_status='confirmed'
        AND COALESCE((SELECT SUM(rv.quantity) FROM sales_order_lines sl JOIN reservations rv ON rv.sales_order_line_id=sl.id AND rv.status='active' WHERE sl.sales_order_id=so.id),0)
          > COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END)
              FROM sales_order_lines sl2 JOIN stock_movements sm ON sm.sales_order_line_id=sl2.id WHERE sl2.sales_order_id=so.id),0)) AS readyToShip,
      (SELECT COALESCE(SUM(r.quantity),0) FROM reservations r WHERE r.status='active' AND r.quantity>0) AS readyToShipUnits,
      (SELECT COUNT(*) FROM vendor_bills WHERE match_status='exception') AS matchExceptions,
      (SELECT COUNT(*) FROM products p WHERE p.active=1 AND (
        COALESCE((SELECT SUM(ib.on_hand_qty) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE ib.product_id=p.id AND l.active=1 AND l.inventory_status='usable'),0)
        + COALESCE((SELECT SUM(MAX(pol.ordered_qty-pol.closed_qty-COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0),0)) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id WHERE pol.product_id=p.id AND po.lifecycle_status='approved'),0)
        - COALESCE((SELECT SUM(MAX(sol.ordered_qty-sol.canceled_qty-COALESCE((SELECT SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity WHEN sm.movement_type='shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id=sol.id),0),0)) FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id WHERE sol.product_id=p.id AND so.lifecycle_status='confirmed'),0) < 0
        OR COALESCE((SELECT SUM(ib.on_hand_qty-ib.reserved_qty) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE ib.product_id=p.id AND l.active=1 AND l.inventory_status='usable'),0) <= p.reorder_point
        OR COALESCE((SELECT SUM(ib.on_hand_qty) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE ib.product_id=p.id AND l.active=1 AND l.inventory_status<>'usable'),0) > 0
      )) AS inventoryRiskCount,
      (SELECT COUNT(*) FROM products p WHERE p.active=1 AND p.inventory_policy='special_order' AND EXISTS (SELECT 1 FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE ib.product_id=p.id AND l.active=1 AND ib.on_hand_qty>0)) AS specialOrderInventoryCount,
      -- Location balances a warehouse could actually go and count today.
      (SELECT COUNT(*) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id WHERE l.active=1 AND ib.on_hand_qty>0 AND (?='' OR l.warehouse_id=?)) AS countableBalanceCount,
      (SELECT COUNT(*) FROM inventory_balances ib LEFT JOIN locations l ON l.id=ib.location_id WHERE l.id IS NULL) AS orphanedBalanceRows,
      (SELECT COALESCE(SUM(ib.on_hand_qty),0) FROM inventory_balances ib LEFT JOIN locations l ON l.id=ib.location_id WHERE l.id IS NULL) AS orphanedBalanceUnits,
      (SELECT COUNT(*) FROM stock_movements sm LEFT JOIN locations fl ON fl.id=sm.from_location_id LEFT JOIN locations tl ON tl.id=sm.to_location_id WHERE (sm.from_location_id IS NOT NULL AND fl.id IS NULL) OR (sm.to_location_id IS NOT NULL AND tl.id IS NULL)) AS orphanedMovementCount,
      (SELECT COALESCE(SUM(ive.value_cents),0) FROM inventory_value_entries ive JOIN stock_movements sm ON sm.id=ive.movement_id LEFT JOIN locations fl ON fl.id=sm.from_location_id LEFT JOIN locations tl ON tl.id=sm.to_location_id WHERE (sm.from_location_id IS NOT NULL AND fl.id IS NULL) OR (sm.to_location_id IS NOT NULL AND tl.id IS NULL)) AS orphanedInventoryValueCents,
      (SELECT COUNT(*) FROM purchase_orders) AS purchaseOrderCount,
      (SELECT COUNT(*) FROM sales_orders) AS salesOrderCount,
      (SELECT COUNT(*) FROM business_partners WHERE active=1) AS partnerCount,
      (SELECT COUNT(*) FROM stock_movements) AS movementCount,
      (SELECT COUNT(*) FROM vendor_bills) AS billCount,
      (SELECT COUNT(*) FROM audit_events WHERE NOT (entity_type IN ('product','business_partner') AND action IN ('created','updated'))) AS activityCount,
      (SELECT COUNT(*) FROM inventory_counts) AS countCount`,
      // Physical totals follow the warehouse selector. Incoming supply and open demand stay
      // company-wide: purchase and sales orders carry no warehouse in this schema, so
      // scoping them would invent an attribution the documents do not record.
      warehouseScope, warehouseScope, warehouseScope, warehouseScope, warehouseScope,
      warehouseScope, warehouseScope, warehouseScope, warehouseScope, warehouseScope,
      // countableBalanceCount, the last placeholder pair in the statement.
      warehouseScope, warehouseScope),
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
  const taxDefault = await first<{ valueJson: string }>("SELECT value_json AS valueJson FROM system_settings WHERE key='tax.defaultRateBps'");
  let taxDefaultRateBps = 500;
  if (taxDefault) {
    try {
      const parsed = JSON.parse(taxDefault.valueJson) as unknown;
      if (Number.isInteger(parsed) && Number(parsed) >= 0 && Number(parsed) <= 10_000) taxDefaultRateBps = Number(parsed);
    } catch { throw new DomainError("POLICY_CONFIGURATION_ERROR", "Default tax policy is invalid.", 500); }
  }
  const orphanedLocations = await all<Record<string, unknown>>(`WITH referenced AS (
      SELECT ib.location_id AS locationId,SUM(ib.on_hand_qty) AS balanceUnits,COUNT(*) AS balanceRows,0 AS movementRows FROM inventory_balances ib LEFT JOIN locations l ON l.id=ib.location_id WHERE l.id IS NULL GROUP BY ib.location_id
      UNION ALL
      SELECT sm.from_location_id,0,0,COUNT(*) FROM stock_movements sm LEFT JOIN locations l ON l.id=sm.from_location_id WHERE sm.from_location_id IS NOT NULL AND l.id IS NULL GROUP BY sm.from_location_id
      UNION ALL
      SELECT sm.to_location_id,0,0,COUNT(*) FROM stock_movements sm LEFT JOIN locations l ON l.id=sm.to_location_id WHERE sm.to_location_id IS NOT NULL AND l.id IS NULL GROUP BY sm.to_location_id
    ) SELECT locationId,SUM(balanceUnits) AS balanceUnits,SUM(balanceRows) AS balanceRows,SUM(movementRows) AS movementRows FROM referenced GROUP BY locationId ORDER BY locationId`);
  let filteredTotal: number | null = null;
  if (term || status) {
    let total: { count: number } | null = null;
    if (["purchase-orders", "expected-receipts", "vendor-returns"].includes(scope)) total = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM purchase_orders po JOIN business_partners bp ON bp.id=po.vendor_id WHERE (?='' OR po.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(po.project_reference,'') LIKE ? ESCAPE '\\') AND (?='' OR po.lifecycle_status=?)${purchaseWorklistFilter("po")}`, term, like, like, like, purchaseStatus, purchaseStatus);
    else if (["sales-orders", "fulfillment", "customer-returns", "customer-invoices"].includes(scope)) total = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM sales_orders so JOIN business_partners bp ON bp.id=so.customer_id WHERE (?='' OR so.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(so.project_reference,'') LIKE ? ESCAPE '\\') AND (?='' OR so.lifecycle_status=?)${salesWorklistFilter("so")}`, term, like, like, like, salesStatus, salesStatus);
    else if (["stock", "products", "counts"].includes(scope)) total = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM products p WHERE p.active=1 AND (?='' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR COALESCE(p.manufacturer_sku,'') LIKE ? ESCAPE '\\' OR p.dimensions LIKE ? ESCAPE '\\' OR p.material LIKE ? ESCAPE '\\') AND (?='' OR p.inventory_policy=? OR p.tracking_policy=?)`, term, like, like, like, like, like, productStatus, productStatus, productStatus);
    else if (scope === "movements") total = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM stock_movements sm JOIN products p ON p.id=sm.product_id LEFT JOIN locations fl ON fl.id=sm.from_location_id LEFT JOIN locations tl ON tl.id=sm.to_location_id WHERE (?='' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR COALESCE(sm.source_document_id,'') LIKE ? ESCAPE '\\' OR COALESCE(fl.code,'') LIKE ? ESCAPE '\\' OR COALESCE(tl.code,'') LIKE ? ESCAPE '\\' OR sm.posted_by LIKE ? ESCAPE '\\') AND (?='' OR sm.movement_type=?)`, term, like, like, like, like, like, like, movementStatus, movementStatus);
    else if (scope === "partners") total = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM business_partners WHERE active=1 AND (?='' OR code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR COALESCE(email,'') LIKE ? ESCAPE '\\' OR COALESCE(city,'') LIKE ? ESCAPE '\\' OR COALESCE(postal_code,'') LIKE ? ESCAPE '\\') AND (?='' OR partner_type=? OR partner_type='both')`, term, like, like, like, like, like, status, status);
    else if (scope === "vendor-bills") total = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM vendor_bills vb JOIN business_partners bp ON bp.id=vb.vendor_id LEFT JOIN purchase_orders po ON po.id=vb.purchase_order_id WHERE (?='' OR vb.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(po.number,'') LIKE ? ESCAPE '\\' OR vb.vendor_invoice_number LIKE ? ESCAPE '\\') AND (?='' OR vb.status=? OR vb.match_status=?)${billWorklistFilter('vb')}`, term, like, like, like, like, billStatus, billStatus, billStatus);
    filteredTotal = total ? Number(total.count) : null;
  }

  return {
    generatedAt: new Date().toISOString(),
    configuration: { taxDefaultRateBps },
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
      CAST((ROW_NUMBER() OVER (ORDER BY po.expected_date,po.number,po.id)-1)/? AS INTEGER)+1 AS page
      FROM purchase_orders po JOIN business_partners bp ON bp.id=po.vendor_id)
      SELECT * FROM ranked WHERE number LIKE ? ESCAPE '\\' OR vendorName LIKE ? ESCAPE '\\' OR COALESCE(projectReference,'') LIKE ? ESCAPE '\\'
      ORDER BY page,number LIMIT ?`, boundedPageSize, like, like, like, boundedLimit),
    all<Record<string, unknown>>(`WITH ranked AS (SELECT so.id,so.number,bp.name AS customerName,so.project_reference AS projectReference,
      CAST((ROW_NUMBER() OVER (ORDER BY so.requested_date,so.number,so.id)-1)/? AS INTEGER)+1 AS page
      FROM sales_orders so JOIN business_partners bp ON bp.id=so.customer_id)
      SELECT * FROM ranked WHERE number LIKE ? ESCAPE '\\' OR customerName LIKE ? ESCAPE '\\' OR COALESCE(projectReference,'') LIKE ? ESCAPE '\\'
      ORDER BY page,number LIMIT ?`, boundedPageSize, like, like, like, boundedLimit),
    all<Record<string, unknown>>(`WITH ranked AS (SELECT id,sku,name,dimensions,finish,material,
      CAST((ROW_NUMBER() OVER (ORDER BY name,id)-1)/? AS INTEGER)+1 AS page FROM products WHERE active=1)
      SELECT * FROM ranked WHERE sku LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR dimensions LIKE ? ESCAPE '\\'
      ORDER BY page,name LIMIT ?`, boundedPageSize, like, like, like, boundedLimit),
    all<Record<string, unknown>>(`WITH ranked AS (SELECT id,code,name,partner_type AS partnerType,email,phone,
      address_line_1 AS addressLine1,address_line_2 AS addressLine2,city,region,postal_code AS postalCode,country,
      CAST((ROW_NUMBER() OVER (ORDER BY name,id)-1)/? AS INTEGER)+1 AS page FROM business_partners WHERE active=1)
      SELECT * FROM ranked WHERE code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR COALESCE(email,'') LIKE ? ESCAPE '\\'
      ORDER BY page,name LIMIT ?`, boundedPageSize, like, like, like, boundedLimit),
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
  const [balances, movements, movementTotal] = await Promise.all([
    all<Record<string, unknown>>(`SELECT ib.product_id AS productId,ib.location_id AS locationId,ib.on_hand_qty AS recordedQuantity,ib.reserved_qty AS reservedQuantity,ib.version,
      l.code AS locationCode,l.name AS locationName,l.inventory_status AS inventoryStatus,w.code AS warehouseCode,w.name AS warehouseName
      FROM inventory_balances ib LEFT JOIN locations l ON l.id=ib.location_id LEFT JOIN warehouses w ON w.id=l.warehouse_id
      WHERE ib.product_id=? ORDER BY CASE WHEN l.id IS NULL THEN 0 ELSE 1 END,w.code,l.code`, productId),
    all<Record<string, unknown>>(`SELECT sm.id,sm.movement_type AS type,sm.quantity,sm.inventory_status AS inventoryStatus,
      sm.source_document_type AS sourceDocumentType,sm.source_document_id AS sourceDocumentId,sm.posted_at AS postedAt,sm.posted_by AS postedBy,
      fl.code AS fromLocationCode,tl.code AS toLocationCode FROM stock_movements sm
      LEFT JOIN locations fl ON fl.id=sm.from_location_id LEFT JOIN locations tl ON tl.id=sm.to_location_id
      WHERE sm.product_id=? ORDER BY sm.posted_at DESC,sm.id DESC LIMIT ? OFFSET ?`, productId, normalized.pageSize, normalized.offset),
    first<{ count: number }>("SELECT COUNT(*) AS count FROM stock_movements WHERE product_id=?", productId),
  ]);
  return { product, balances, movements, pagination: { page: normalized.page, pageSize: normalized.pageSize, total: Number(movementTotal?.count ?? 0) } };
}

/**
 * Every reference list a form can select from. The workflow snapshot only ships one page
 * of each table, so anything a user must find by name or number has to be searched on the
 * server instead of filtered in the browser.
 */
export const REFERENCE_LOOKUPS = [
  "products", "partners", "locations", "warehouses", "uoms", "priceLists", "priceListAssignments", "priceListEntries", "assetTypes",
  "salesOrders", "purchaseOrders", "salesOrderLines", "purchaseOrderLines",
  "customerInvoices", "vendorBills", "costLayers", "partnerAddresses",
] as const;

export type ReferenceLookup = (typeof REFERENCE_LOOKUPS)[number];

export function isReferenceLookup(value: unknown): value is ReferenceLookup {
  return typeof value === "string" && (REFERENCE_LOOKUPS as readonly string[]).includes(value);
}

export async function searchInventoryReferences(kind: ReferenceLookup, search = "", limit = 20, role?: string, partnerId?: string, quantity = 1, warehouseId?: string, currency?: string, exchangeRateToBase?: number, offset = 0) {
  await ensureDatabase();
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const boundedOffset = Math.max(Math.trunc(Number.isFinite(offset) ? offset : 0), 0);
  const term = search.trim();
  const like = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const scopedWarehouse = typeof warehouseId === "string" ? warehouseId.trim() : "";

  if (kind === "partnerAddresses") {
    return { items: await all<Record<string, unknown>>(`SELECT id,partner_id AS partnerId,label,contact_name AS contactName,
        address_line_1 AS addressLine1,address_line_2 AS addressLine2,city,region,postal_code AS postalCode,country,
        delivery_instructions AS deliveryInstructions,is_default AS isDefault,version
      FROM partner_addresses WHERE active=1 AND (?='' OR partner_id=?)
        AND (?='' OR label LIKE ? ESCAPE '\' OR address_line_1 LIKE ? ESCAPE '\' OR city LIKE ? ESCAPE '\')
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
    return { items: await all<Record<string, unknown>>(`SELECT pla.id,pla.price_list_id AS priceListId,pl.code AS priceListCode,pl.currency,
        pla.partner_id AS partnerId,bp.code AS partnerCode,bp.name AS partnerName,pla.priority,pla.valid_from AS validFrom,pla.valid_to AS validTo,pla.version
      FROM price_list_assignments pla JOIN price_lists pl ON pl.id=pla.price_list_id JOIN business_partners bp ON bp.id=pla.partner_id
      WHERE pla.active=1 AND (?='' OR pl.code LIKE ? ESCAPE '\\' OR bp.code LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\')
      ORDER BY pl.code,bp.name LIMIT ?`, term, like, like, like, boundedLimit) };
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
      WHERE (?='' OR so.customer_id=?) AND (?<>'open' OR so.lifecycle_status IN ('draft','confirmed'))
        AND (?='' OR so.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\' OR COALESCE(so.project_reference,'') LIKE ? ESCAPE '\\')
      ORDER BY so.number DESC LIMIT ? OFFSET ?`, partnerId ?? "", partnerId ?? "", role ?? "", term, like, like, like, boundedLimit, boundedOffset) };
  }
  if (kind === "purchaseOrders") {
    return { items: await all<Record<string, unknown>>(`SELECT po.id,po.number,po.vendor_id AS vendorId,bp.name AS vendorName,po.lifecycle_status AS status,
        po.expected_date AS expectedDate,po.total_cents AS totalCents,po.currency,po.version
      FROM purchase_orders po JOIN business_partners bp ON bp.id=po.vendor_id
      WHERE (?='' OR po.vendor_id=?) AND (?<>'open' OR po.lifecycle_status IN ('draft','pending_approval','approved'))
        AND (?='' OR po.number LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\')
      ORDER BY po.number DESC LIMIT ? OFFSET ?`, partnerId ?? "", partnerId ?? "", role ?? "", term, like, like, boundedLimit, boundedOffset) };
  }
  if (kind === "salesOrderLines") {
    // Purchase-order composers need unlinked demand (plus their own links while editing),
    // while external delivery needs only demand that already has dedicated drop-ship supply.
    const linkedDelivery = role === "drop_ship_linked";
    const routeFilter = linkedDelivery ? "drop_ship" : ["stock", "special_order", "drop_ship"].includes(role ?? "") ? role! : "";
    const demandMode = linkedDelivery ? "linked" : routeFilter ? "available" : "all";
    return { items: await all<Record<string, unknown>>(`SELECT sol.id,so.number AS orderNumber,so.id AS salesOrderId,bp.name AS customerName,p.sku,p.name AS productName,
        sol.fulfillment_route AS fulfillmentRoute,sol.ordered_qty AS orderedQuantity,sol.canceled_qty AS canceledQuantity,so.lifecycle_status AS orderStatus,so.version AS salesOrderVersion
      FROM sales_order_lines sol
      JOIN sales_orders so ON so.id=sol.sales_order_id
      JOIN business_partners bp ON bp.id=so.customer_id
      JOIN products p ON p.id=sol.product_id
      WHERE so.lifecycle_status<>'canceled' AND sol.ordered_qty>sol.canceled_qty
        AND (?='' OR sol.fulfillment_route=?)
        AND (?='all' OR (?='linked' AND sol.linked_purchase_order_line_id IS NOT NULL)
          OR (?='available' AND (sol.linked_purchase_order_line_id IS NULL OR EXISTS (
            SELECT 1 FROM purchase_order_lines own_link WHERE own_link.id=sol.linked_purchase_order_line_id AND own_link.purchase_order_id=?))))
        AND (?='' OR so.number LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\')
      ORDER BY so.number DESC,p.sku LIMIT ?`, routeFilter, routeFilter, demandMode, demandMode, demandMode, partnerId ?? "", term, like, like, like, like, boundedLimit) };
  }
  if (kind === "purchaseOrderLines") {
    return { items: await all<Record<string, unknown>>(`SELECT pol.id,po.number AS orderNumber,po.id AS purchaseOrderId,bp.name AS vendorName,p.sku,p.name AS productName,
        pol.fulfillment_route AS fulfillmentRoute,pol.ordered_qty AS orderedQuantity,pol.closed_qty AS closedQuantity,pol.unit_cost_cents AS unitCostCents,po.lifecycle_status AS orderStatus,
        po.currency,po.exchange_rate_to_base AS exchangeRateToBase,po.payment_terms AS paymentTerms,po.due_date AS dueDate,po.version AS purchaseOrderVersion,pol.version AS lineVersion
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id=pol.purchase_order_id
      JOIN business_partners bp ON bp.id=po.vendor_id
      JOIN products p ON p.id=pol.product_id
      WHERE (?='' OR po.id=?) AND (?='' OR po.number LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR bp.name LIKE ? ESCAPE '\\')
      ORDER BY po.number DESC,p.sku LIMIT ?`, partnerId ?? "", partnerId ?? "", term, like, like, like, like, boundedLimit) };
  }
  if (kind === "customerInvoices") {
    return { items: await all<Record<string, unknown>>(`SELECT ci.id,ci.number,ci.customer_id AS customerId,bp.name AS customerName,ci.status,ci.due_date AS dueDate,ci.currency,ci.exchange_rate_to_base AS exchangeRateToBase,
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
      p.tracking_policy AS trackingPolicy,p.inventory_policy AS inventoryPolicy,p.reorder_point AS reorderPoint,
      p.selling_price_cents AS sellingPriceCents,p.standard_cost_cents AS standardCostCents,
      p.base_uom_id AS baseUomId,p.purchase_uom_id AS purchaseUomId,p.sales_uom_id AS salesUomId,p.version,
      COALESCE((SELECT SUM(ib.on_hand_qty-ib.reserved_qty) FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id
                 WHERE ib.product_id=p.id AND l.active=1 AND l.inventory_status='usable' AND (?='' OR l.warehouse_id=?)),0) AS availableQuantity,
      COALESCE((SELECT SUM(MAX(pol.ordered_qty-pol.closed_qty-COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0),0))
                 FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id
                WHERE pol.product_id=p.id AND po.lifecycle_status='approved'),0) AS incomingQuantity
      FROM products p WHERE p.active=1 AND (?='' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR COALESCE(p.manufacturer_sku,'') LIKE ? ESCAPE '\\' OR p.dimensions LIKE ? ESCAPE '\\')
      ORDER BY CASE WHEN p.sku=? THEN 0 WHEN p.sku LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,p.name,p.id LIMIT ?`, scopedWarehouse, scopedWarehouse, term, like, like, like, like, term, `${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`, boundedLimit);
    return { items: await effectivePricesForProducts({ products: items, usage: role === "vendor" ? "purchase" : "sales", partnerId, quantity, currency, exchangeRateToBase }) };
  }
  if (kind === "locations") {
    const inventoryStatus = ["usable", "quarantine", "damaged", "in_transit", "return_pending", "non_usable"].includes(role ?? "") ? role! : "";
    const items = await all<Record<string, unknown>>(`SELECT l.id,l.code,l.name,l.location_type AS locationType,l.inventory_status AS inventoryStatus,
      l.warehouse_id AS warehouseId,w.code AS warehouseCode,w.name AS warehouseName,l.version
      FROM locations l JOIN warehouses w ON w.id=l.warehouse_id
      WHERE l.active=1 AND w.active=1 AND (?='' OR (?='non_usable' AND l.inventory_status IN ('quarantine','damaged')) OR l.inventory_status=?)
        AND (?='' OR l.code LIKE ? ESCAPE '\\' OR l.name LIKE ? ESCAPE '\\' OR w.code LIKE ? ESCAPE '\\' OR w.name LIKE ? ESCAPE '\\')
      ORDER BY CASE WHEN ?<>'' AND l.warehouse_id=? THEN 0 ELSE 1 END,w.code,l.code,l.id LIMIT ?`,
      inventoryStatus, inventoryStatus, inventoryStatus, term, like, like, like, like, scopedWarehouse, scopedWarehouse, boundedLimit);
    return { items };
  }
  const partnerRole = role === "vendor" || role === "customer" ? role : "";
  const items = await all<Record<string, unknown>>(`SELECT id,code,name,partner_type AS partnerType,email,phone,currency,payment_terms AS paymentTerms,
      address_line_1 AS addressLine1,address_line_2 AS addressLine2,city,region,postal_code AS postalCode,country,
      credit_limit_cents AS creditLimitCents,credit_hold AS creditHold,version
    FROM business_partners WHERE active=1 AND (?='' OR partner_type=? OR partner_type='both')
      AND (?='' OR code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR COALESCE(email,'') LIKE ? ESCAPE '\\')
    ORDER BY CASE WHEN code=? THEN 0 WHEN code LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,name,id LIMIT ?`, partnerRole, partnerRole, term, like, like, like, term, `${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`, boundedLimit);
  return { items };
}
