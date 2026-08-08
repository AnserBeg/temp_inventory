import { all, documentNumber, ensureDatabase, first, getD1, newId, roundQuantity, statement } from "./inventory-db";

type CommandPayload = Record<string, unknown>;

export type InventoryCommand = {
  command: string;
  entityId: string;
  payload?: CommandPayload;
  idempotencyKey: string;
  version: number;
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

function logPrepared(input: InventoryCommand, result: CommandResult, entityTable: "purchase_orders" | "receipts" | "sales_orders" | "inventory_balances", extraPredicate = "") {
  const now = new Date().toISOString();
  let predicate: string;
  let bindings: Array<string | number>;
  if (entityTable === "inventory_balances") {
    const locationId = String(input.payload?.locationId ?? "");
    predicate = `product_id = ? AND location_id = ? AND version = ? ${extraPredicate}`;
    bindings = [input.entityId, locationId, input.version];
  } else {
    predicate = `id = ? AND version = ? ${extraPredicate}`;
    bindings = [input.entityId, input.version];
  }
  return statement(
    `INSERT OR IGNORE INTO command_log (idempotency_key, command, entity_id, response_json, created_at)
     SELECT ?, ?, ?, ?, ? FROM ${entityTable} WHERE ${predicate}`,
    input.idempotencyKey,
    input.command,
    input.entityId,
    JSON.stringify(result),
    now,
    ...bindings
  );
}

function commandExistsPrepared(idempotencyKey: string) {
  return `EXISTS (SELECT 1 FROM command_log WHERE idempotency_key = '${idempotencyKey.replaceAll("'", "''")}')`;
}

async function currentOrConflict(input: InventoryCommand) {
  const saved = await first<{ responseJson: string }>(
    "SELECT response_json AS responseJson FROM command_log WHERE idempotency_key = ?",
    input.idempotencyKey
  );
  if (saved) return JSON.parse(saved.responseJson) as CommandResult;
  return null;
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
  netReceivedQty: number;
  openToReceiveQty: number;
};

async function getPurchaseLine(orderId: string, lineId?: string) {
  const line = await first<PurchaseLineState>(
    `SELECT pol.id, pol.purchase_order_id AS purchaseOrderId, pol.product_id AS productId,
            pol.ordered_qty AS orderedQty, pol.closed_qty AS closedQty,
            pol.unit_cost_cents AS unitCostCents, po.version, po.expected_date AS expectedDate,
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

async function postReceipt(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const quantity = positive(payload);
  const damagedQuantity = payload.damagedQuantity == null ? 0 : roundQuantity(asNumber(payload, "damagedQuantity"));
  if (damagedQuantity < 0 || damagedQuantity > quantity) {
    throw new DomainError("VALIDATION_ERROR", "damagedQuantity must be between zero and the received quantity.");
  }
  const usableQuantity = roundQuantity(quantity - damagedQuantity);
  const line = await getPurchaseLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  if (line.version !== input.version) {
    throw new DomainError("VERSION_CONFLICT", "The purchase order changed. Refresh it before receiving.", 409, line.version);
  }
  if (quantity > line.openToReceiveQty) {
    throw new DomainError("OVER_RECEIPT", `Only ${line.openToReceiveQty} units remain open to receive.`, 409, line.version);
  }
  const locationId = optionalText(payload, "locationId", "loc-receiving");
  const quarantineLocationId = optionalText(payload, "quarantineLocationId", "loc-quarantine");
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const receiptId = newId("receipt");
  const receiptNumber = documentNumber("RCV");
  const usableLineId = newId("receipt-line");
  const damagedLineId = newId("receipt-line");
  const now = new Date().toISOString();
  const result: CommandResult = {
    message: `${receiptNumber} posted for ${quantity} unit${quantity === 1 ? "" : "s"}.`,
    impact: {
      physical: `${quantity} units added to on-hand inventory${damagedQuantity ? `; ${damagedQuantity} routed to quarantine` : ""}.`,
      commercial: `Open incoming decreased by ${quantity}.`,
      financial: "No vendor bill or payment was created.",
      onHandDelta: quantity,
      incomingDelta: -quantity,
      reservedDelta: 0,
      availableDelta: usableQuantity,
    },
  };
  const exists = commandExistsPrepared(input.idempotencyKey);
  const db = getD1();
  const commands: D1PreparedStatement[] = [
    logPrepared(input, result, "purchase_orders"),
    db.prepare(`UPDATE purchase_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`).bind(input.entityId, input.version),
    db.prepare(`INSERT INTO receipts (id, number, purchase_order_id, status, posted_at, version)
                SELECT ?, ?, ?, 'posted', ?, 1 WHERE ${exists}`).bind(receiptId, receiptNumber, input.entityId, now),
  ];
  if (usableQuantity > 0) {
    commands.push(
      db.prepare(`INSERT INTO receipt_lines (id, receipt_id, purchase_order_line_id, product_id, location_id, quantity, condition)
                  SELECT ?, ?, ?, ?, ?, ?, 'usable' WHERE ${exists}`).bind(usableLineId, receiptId, line.id, line.productId, locationId, usableQuantity),
      db.prepare(`INSERT INTO stock_movements
        (id, movement_type, product_id, quantity, to_location_id, inventory_status, source_document_type,
         source_document_id, source_line_id, purchase_order_line_id, posted_at, posted_by, unit_cost_cents, idempotency_key)
        SELECT ?, 'purchase_receipt', ?, ?, ?, 'usable', 'receipt', ?, ?, ?, ?, ?, ?, ? WHERE ${exists}`)
        .bind(newId("movement"), line.productId, usableQuantity, locationId, receiptId, usableLineId, line.id, now, actor, line.unitCostCents, input.idempotencyKey),
      db.prepare(`INSERT INTO inventory_balances (product_id, location_id, on_hand_qty, reserved_qty, version)
                  SELECT ?, ?, ?, 0, 1 WHERE ${exists}
                  ON CONFLICT(product_id, location_id) DO UPDATE SET on_hand_qty = on_hand_qty + excluded.on_hand_qty, version = version + 1`)
        .bind(line.productId, locationId, usableQuantity)
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
        .bind(newId("movement"), line.productId, damagedQuantity, quarantineLocationId, receiptId, damagedLineId, line.id, now, actor, line.unitCostCents, input.idempotencyKey),
      db.prepare(`INSERT INTO inventory_balances (product_id, location_id, on_hand_qty, reserved_qty, version)
                  SELECT ?, ?, ?, 0, 1 WHERE ${exists}
                  ON CONFLICT(product_id, location_id) DO UPDATE SET on_hand_qty = on_hand_qty + excluded.on_hand_qty, version = version + 1`)
        .bind(line.productId, quarantineLocationId, damagedQuantity)
    );
  }
  commands.push(
    db.prepare(`INSERT INTO audit_events (id, entity_type, entity_id, action, summary, actor, metadata_json, created_at)
                SELECT ?, 'purchase_order', ?, 'receipt_posted', ?, ?, ?, ? WHERE ${exists}`)
      .bind(newId("audit"), input.entityId, result.message, actor, JSON.stringify(result.impact), now)
  );
  await db.batch(commands);
  return requireLogged(input, "The purchase order changed before the receipt could be posted.");
}

async function closeRemainder(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const line = await getPurchaseLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  const quantity = payload.quantity == null ? line.openToReceiveQty : positive(payload);
  const reason = requiredText(payload, "reason");
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The purchase order changed. Refresh before closing the remainder.", 409, line.version);
  if (quantity > line.openToReceiveQty) throw new DomainError("INVALID_QUANTITY", `Only ${line.openToReceiveQty} units can be closed.`, 409, line.version);
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const result: CommandResult = {
    message: `${quantity} unit${quantity === 1 ? "" : "s"} closed without receipt.`,
    impact: { physical: "On-hand inventory is unchanged.", commercial: `Incoming forecast decreased by ${quantity}.`, financial: "No financial posting was created.", onHandDelta: 0, incomingDelta: -quantity, reservedDelta: 0, availableDelta: 0 },
  };
  const exists = commandExistsPrepared(input.idempotencyKey);
  const db = getD1();
  await db.batch([
    logPrepared(input, result, "purchase_orders"),
    db.prepare(`UPDATE purchase_order_lines SET closed_qty = closed_qty + ? WHERE id = ? AND ${exists}`).bind(quantity, line.id),
    db.prepare(`UPDATE purchase_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`).bind(input.entityId, input.version),
    db.prepare(`INSERT INTO audit_events (id, entity_type, entity_id, action, summary, actor, metadata_json, created_at)
                SELECT ?, 'purchase_order', ?, 'remainder_closed', ?, ?, ?, ? WHERE ${exists}`)
      .bind(newId("audit"), input.entityId, result.message, actor, JSON.stringify({ reason, quantity, lineId: line.id }), new Date().toISOString()),
  ]);
  return requireLogged(input, "The purchase order changed before the remainder could be closed.");
}

async function reopenRemainder(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const quantity = positive(payload);
  const reason = requiredText(payload, "reason");
  const expectedDate = requiredText(payload, "expectedDate");
  const line = await getPurchaseLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The purchase order changed. Refresh before reopening quantity.", 409, line.version);
  if (quantity > line.closedQty) throw new DomainError("INVALID_QUANTITY", `Only ${line.closedQty} closed units can be reopened.`, 409, line.version);
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const result: CommandResult = {
    message: `${quantity} unit${quantity === 1 ? "" : "s"} reopened for receipt.`,
    impact: { physical: "On-hand inventory is unchanged.", commercial: `Incoming forecast increased by ${quantity}.`, financial: "No financial posting was created.", onHandDelta: 0, incomingDelta: quantity, reservedDelta: 0, availableDelta: 0 },
  };
  const exists = commandExistsPrepared(input.idempotencyKey);
  const db = getD1();
  await db.batch([
    logPrepared(input, result, "purchase_orders"),
    db.prepare(`UPDATE purchase_order_lines SET closed_qty = closed_qty - ? WHERE id = ? AND ${exists}`).bind(quantity, line.id),
    db.prepare(`UPDATE purchase_orders SET version = version + 1, expected_date = ? WHERE id = ? AND version = ? AND ${exists}`).bind(expectedDate, input.entityId, input.version),
    db.prepare(`INSERT INTO audit_events (id, entity_type, entity_id, action, summary, actor, metadata_json, created_at)
                SELECT ?, 'purchase_order', ?, 'remainder_reopened', ?, ?, ?, ? WHERE ${exists}`)
      .bind(newId("audit"), input.entityId, result.message, actor, JSON.stringify({ reason, expectedDate, quantity, lineId: line.id }), new Date().toISOString()),
  ]);
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
  const source = await first<{ movementId: string; receiptLineId: string; poLineId: string; productId: string; locationId: string; unitCostCents: number; remainingQty: number }>(
    `SELECT sm.id AS movementId, sm.source_line_id AS receiptLineId, sm.purchase_order_line_id AS poLineId,
            sm.product_id AS productId, sm.to_location_id AS locationId, sm.unit_cost_cents AS unitCostCents,
            sm.quantity + COALESCE(SUM(rev.quantity), 0) AS remainingQty
       FROM stock_movements sm
       LEFT JOIN stock_movements rev ON rev.reversal_of_movement_id = sm.id
      WHERE sm.source_document_type = 'receipt' AND sm.source_document_id = ?
        AND (? IS NULL OR sm.source_line_id = ?)
      GROUP BY sm.id HAVING remainingQty > 0 ORDER BY sm.id LIMIT 1`,
    input.entityId,
    typeof payload.lineId === "string" ? payload.lineId : null,
    typeof payload.lineId === "string" ? payload.lineId : null
  );
  if (!source) throw new DomainError("NOT_REVERSIBLE", "This receipt has no remaining quantity to reverse.", 409, receipt.version);
  if (quantity > source.remainingQty) throw new DomainError("INVALID_QUANTITY", `Only ${source.remainingQty} units remain reversible.`, 409, receipt.version);
  const balance = await first<{ onHandQty: number }>("SELECT on_hand_qty AS onHandQty FROM inventory_balances WHERE product_id = ? AND location_id = ?", source.productId, source.locationId);
  if (!balance || balance.onHandQty < quantity) throw new DomainError("INSUFFICIENT_STOCK", "The source location no longer holds enough stock for this reversal.", 409, receipt.version);
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const result: CommandResult = {
    message: `${quantity} unit${quantity === 1 ? "" : "s"} reversed from the posted receipt.`,
    impact: { physical: `${quantity} units removed from on-hand inventory.`, commercial: `Open incoming may increase by up to ${quantity}.`, financial: "Vendor bills and credits are unchanged.", onHandDelta: -quantity, incomingDelta: quantity, reservedDelta: 0, availableDelta: -quantity },
  };
  const exists = commandExistsPrepared(input.idempotencyKey);
  const db = getD1();
  const now = new Date().toISOString();
  await db.batch([
    logPrepared(input, result, "receipts"),
    db.prepare(`UPDATE receipts SET version = version + 1, status = CASE WHEN ? = ? THEN 'reversed' ELSE 'partially_reversed' END
                WHERE id = ? AND version = ? AND ${exists}`).bind(quantity, source.remainingQty, input.entityId, input.version),
    db.prepare(`UPDATE purchase_orders SET version = version + 1 WHERE id = ? AND ${exists}`).bind(receipt.purchaseOrderId),
    db.prepare(`UPDATE inventory_balances SET on_hand_qty = on_hand_qty - ?, version = version + 1
                WHERE product_id = ? AND location_id = ? AND ${exists}`).bind(quantity, source.productId, source.locationId),
    db.prepare(`INSERT INTO stock_movements
      (id, movement_type, product_id, quantity, from_location_id, inventory_status, source_document_type,
       source_document_id, source_line_id, purchase_order_line_id, reversal_of_movement_id,
       posted_at, posted_by, unit_cost_cents, idempotency_key)
      SELECT ?, 'receipt_reversal', ?, ?, ?, 'usable', 'receipt_reversal', ?, ?, ?, ?, ?, ?, ?, ? WHERE ${exists}`)
      .bind(newId("movement"), source.productId, -quantity, source.locationId, input.entityId, source.receiptLineId, source.poLineId, source.movementId, now, actor, source.unitCostCents, input.idempotencyKey),
    db.prepare(`INSERT INTO audit_events (id, entity_type, entity_id, action, summary, actor, metadata_json, created_at)
                SELECT ?, 'receipt', ?, 'receipt_reversed', ?, ?, ?, ? WHERE ${exists}`)
      .bind(newId("audit"), input.entityId, result.message, actor, JSON.stringify({ reason, quantity }), now),
  ]);
  return requireLogged(input, "The receipt changed before it could be reversed.");
}

async function postVendorReturn(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const quantity = positive(payload);
  const reason = requiredText(payload, "reason");
  const replacementExpected = payload.replacementExpected === true;
  const line = await getPurchaseLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The purchase order changed. Refresh before posting the vendor return.", 409, line.version);
  if (quantity > line.netReceivedQty) throw new DomainError("INVALID_QUANTITY", `Only ${line.netReceivedQty} net received units can be returned.`, 409, line.version);
  const locationId = optionalText(payload, "locationId", "loc-a01");
  const balance = await first<{ onHandQty: number; reservedQty: number }>("SELECT on_hand_qty AS onHandQty, reserved_qty AS reservedQty FROM inventory_balances WHERE product_id = ? AND location_id = ?", line.productId, locationId);
  if (!balance || balance.onHandQty - balance.reservedQty < quantity) throw new DomainError("INSUFFICIENT_STOCK", "Not enough unreserved stock exists at the selected location.", 409, line.version);
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const returnId = newId("vendor-return");
  const returnNumber = documentNumber("VRT");
  const now = new Date().toISOString();
  const result: CommandResult = {
    message: `${returnNumber} posted for ${quantity} unit${quantity === 1 ? "" : "s"}.`,
    impact: {
      physical: `${quantity} units removed from on-hand inventory.`,
      commercial: replacementExpected ? `${quantity} units are open to receive as replacement.` : `${quantity} units marked not expected; no replacement incoming.`,
      financial: replacementExpected ? "No credit assumed; replacement is expected." : "Vendor credit is expected but not yet posted.",
      onHandDelta: -quantity,
      incomingDelta: replacementExpected ? quantity : 0,
      reservedDelta: 0,
      availableDelta: -quantity,
    },
  };
  const exists = commandExistsPrepared(input.idempotencyKey);
  const db = getD1();
  const commands: D1PreparedStatement[] = [
    logPrepared(input, result, "purchase_orders"),
    db.prepare(`UPDATE purchase_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`).bind(input.entityId, input.version),
  ];
  if (!replacementExpected) commands.push(db.prepare(`UPDATE purchase_order_lines SET closed_qty = closed_qty + ? WHERE id = ? AND ${exists}`).bind(quantity, line.id));
  commands.push(
    db.prepare(`UPDATE inventory_balances SET on_hand_qty = on_hand_qty - ?, version = version + 1
                WHERE product_id = ? AND location_id = ? AND ${exists}`).bind(quantity, line.productId, locationId),
    db.prepare(`INSERT INTO vendor_returns
      (id, number, purchase_order_id, purchase_order_line_id, product_id, location_id, quantity, disposition, posted_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${exists}`)
      .bind(returnId, returnNumber, input.entityId, line.id, line.productId, locationId, quantity, replacementExpected ? "replacement" : "refund", now),
    db.prepare(`INSERT INTO stock_movements
      (id, movement_type, product_id, quantity, from_location_id, inventory_status, source_document_type,
       source_document_id, purchase_order_line_id, posted_at, posted_by, unit_cost_cents, idempotency_key)
      SELECT ?, 'vendor_return', ?, ?, ?, 'usable', 'vendor_return', ?, ?, ?, ?, ?, ? WHERE ${exists}`)
      .bind(newId("movement"), line.productId, -quantity, locationId, returnId, line.id, now, actor, line.unitCostCents, input.idempotencyKey),
    db.prepare(`INSERT INTO audit_events (id, entity_type, entity_id, action, summary, actor, metadata_json, created_at)
                SELECT ?, 'purchase_order', ?, 'vendor_return_posted', ?, ?, ?, ? WHERE ${exists}`)
      .bind(newId("audit"), input.entityId, result.message, actor, JSON.stringify({ reason, replacementExpected, quantity }), now)
  );
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
  const actor = optionalText(payload, "actor", "Avery Morgan");
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
  const exists = commandExistsPrepared(input.idempotencyKey);
  const db = getD1();
  const now = new Date().toISOString();
  await db.batch([
    logPrepared(input, result, "purchase_orders"),
    db.prepare(`INSERT INTO audit_events (id, entity_type, entity_id, action, summary, actor, metadata_json, created_at)
                SELECT ?, 'purchase_order', ?, 'price_only_credit_recorded', ?, ?, ?, ? WHERE ${exists}`)
      .bind(newId("audit"), input.entityId, result.message, actor, JSON.stringify({ reason, amountCents, currency: order.currency }), now),
  ]);
  return requireLogged(input, "The purchase order changed before the price allowance could be recorded.");
}

type SalesLineState = { id: string; salesOrderId: string; productId: string; orderedQty: number; canceledQty: number; version: number; shippedQty: number; returnedQty: number; reservedQty: number };

async function getSalesLine(orderId: string, lineId?: string) {
  const line = await first<SalesLineState>(
    `SELECT sol.id, sol.sales_order_id AS salesOrderId, sol.product_id AS productId,
            sol.ordered_qty AS orderedQty, sol.canceled_qty AS canceledQty, so.version,
            COALESCE(SUM(CASE WHEN sm.movement_type = 'sales_shipment' THEN -sm.quantity ELSE 0 END), 0) AS shippedQty,
            COALESCE(SUM(CASE WHEN sm.movement_type = 'customer_return' THEN sm.quantity ELSE 0 END), 0) AS returnedQty,
            COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.sales_order_line_id = sol.id AND r.status = 'active'), 0) AS reservedQty
       FROM sales_order_lines sol JOIN sales_orders so ON so.id = sol.sales_order_id
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
  const quantity = positive(payload);
  const line = await getSalesLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
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
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const reservationId = newId("reservation");
  const now = new Date().toISOString();
  const result: CommandResult = {
    message: `${quantity} unit${quantity === 1 ? "" : "s"} reserved for this sales order.`,
    impact: { physical: "On-hand inventory is unchanged.", commercial: `${quantity} units allocated to customer demand.`, financial: "No invoice was created.", onHandDelta: 0, incomingDelta: 0, reservedDelta: quantity, availableDelta: -quantity },
  };
  const availability = "AND EXISTS (SELECT 1 FROM inventory_balances ib WHERE ib.product_id = sales_orders.id)";
  void availability;
  const exists = commandExistsPrepared(input.idempotencyKey);
  const db = getD1();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key, command, entity_id, response_json, created_at)
                SELECT ?, ?, ?, ?, ? FROM sales_orders so
                 WHERE so.id = ? AND so.version = ?
                   AND EXISTS (SELECT 1 FROM inventory_balances ib WHERE ib.product_id = ? AND ib.location_id = ? AND ib.on_hand_qty - ib.reserved_qty >= ?)`)
      .bind(input.idempotencyKey, input.command, input.entityId, JSON.stringify(result), now, input.entityId, input.version, line.productId, balance.locationId, quantity),
    db.prepare(`INSERT INTO reservations (id, sales_order_line_id, product_id, location_id, quantity, status, created_at)
                SELECT ?, ?, ?, ?, ?, 'active', ? WHERE ${exists}`).bind(reservationId, line.id, line.productId, balance.locationId, quantity, now),
    db.prepare(`UPDATE inventory_balances SET reserved_qty = reserved_qty + ?, version = version + 1
                WHERE product_id = ? AND location_id = ? AND ${exists}`).bind(quantity, line.productId, balance.locationId),
    db.prepare(`UPDATE sales_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`).bind(input.entityId, input.version),
    db.prepare(`INSERT INTO audit_events (id, entity_type, entity_id, action, summary, actor, metadata_json, created_at)
                SELECT ?, 'sales_order', ?, 'stock_reserved', ?, ?, ?, ? WHERE ${exists}`)
      .bind(newId("audit"), input.entityId, result.message, actor, JSON.stringify({ quantity, locationId: balance.locationId }), now),
  ]);
  return requireLogged(input, "Availability or the sales order changed before stock could be reserved.");
}

async function shipSale(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const quantity = positive(payload);
  const line = await getSalesLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The sales order changed. Refresh before shipping.", 409, line.version);
  const reservation = await first<{ id: string; locationId: string; quantity: number }>(
    `SELECT id, location_id AS locationId, quantity FROM reservations
      WHERE sales_order_line_id = ? AND status = 'active' AND quantity >= ?
      ORDER BY created_at LIMIT 1`, line.id, quantity
  );
  if (!reservation) throw new DomainError("NOT_RESERVED", "Reserve the requested quantity before posting shipment.", 409, line.version);
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const shipmentId = newId("shipment");
  const shipmentLineId = newId("shipment-line");
  const shipmentNumber = documentNumber("SHP");
  const now = new Date().toISOString();
  const result: CommandResult = {
    message: `${shipmentNumber} posted for ${quantity} unit${quantity === 1 ? "" : "s"}.`,
    impact: { physical: `${quantity} units removed from on-hand inventory.`, commercial: `${quantity} reserved units fulfilled.`, financial: "No customer invoice was created.", onHandDelta: -quantity, incomingDelta: 0, reservedDelta: -quantity, availableDelta: 0 },
  };
  const exists = commandExistsPrepared(input.idempotencyKey);
  const db = getD1();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO command_log (idempotency_key, command, entity_id, response_json, created_at)
                SELECT ?, ?, ?, ?, ? FROM sales_orders so
                 WHERE so.id = ? AND so.version = ?
                   AND EXISTS (SELECT 1 FROM reservations r WHERE r.id = ? AND r.status = 'active' AND r.quantity >= ?)
                   AND EXISTS (SELECT 1 FROM inventory_balances ib WHERE ib.product_id = ? AND ib.location_id = ? AND ib.on_hand_qty >= ? AND ib.reserved_qty >= ?)`)
      .bind(input.idempotencyKey, input.command, input.entityId, JSON.stringify(result), now, input.entityId, input.version, reservation.id, quantity, line.productId, reservation.locationId, quantity, quantity),
    db.prepare(`UPDATE reservations SET quantity = quantity - ?, status = CASE WHEN quantity - ? = 0 THEN 'consumed' ELSE 'active' END
                WHERE id = ? AND ${exists}`).bind(quantity, quantity, reservation.id),
    db.prepare(`UPDATE inventory_balances SET on_hand_qty = on_hand_qty - ?, reserved_qty = reserved_qty - ?, version = version + 1
                WHERE product_id = ? AND location_id = ? AND ${exists}`).bind(quantity, quantity, line.productId, reservation.locationId),
    db.prepare(`UPDATE sales_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`).bind(input.entityId, input.version),
    db.prepare(`INSERT INTO shipments (id, number, sales_order_id, status, posted_at, version)
                SELECT ?, ?, ?, 'posted', ?, 1 WHERE ${exists}`).bind(shipmentId, shipmentNumber, input.entityId, now),
    db.prepare(`INSERT INTO shipment_lines (id, shipment_id, sales_order_line_id, product_id, location_id, quantity)
                SELECT ?, ?, ?, ?, ?, ? WHERE ${exists}`).bind(shipmentLineId, shipmentId, line.id, line.productId, reservation.locationId, quantity),
    db.prepare(`INSERT INTO stock_movements
      (id, movement_type, product_id, quantity, from_location_id, inventory_status, source_document_type,
       source_document_id, source_line_id, sales_order_line_id, posted_at, posted_by, idempotency_key)
      SELECT ?, 'sales_shipment', ?, ?, ?, 'usable', 'shipment', ?, ?, ?, ?, ?, ? WHERE ${exists}`)
      .bind(newId("movement"), line.productId, -quantity, reservation.locationId, shipmentId, shipmentLineId, line.id, now, actor, input.idempotencyKey),
    db.prepare(`INSERT INTO audit_events (id, entity_type, entity_id, action, summary, actor, metadata_json, created_at)
                SELECT ?, 'sales_order', ?, 'shipment_posted', ?, ?, ?, ? WHERE ${exists}`)
      .bind(newId("audit"), input.entityId, result.message, actor, JSON.stringify({ quantity, shipmentId }), now),
  ]);
  return requireLogged(input, "Reservation, inventory, or the sales order changed before shipment could be posted.");
}

async function postCustomerReturn(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const quantity = positive(payload);
  const reason = requiredText(payload, "reason");
  const line = await getSalesLine(input.entityId, typeof payload.lineId === "string" ? payload.lineId : undefined);
  if (line.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The sales order changed. Refresh before receiving the return.", 409, line.version);
  const remainingReturnable = roundQuantity(line.shippedQty - line.returnedQty);
  if (quantity > remainingReturnable) throw new DomainError("INVALID_QUANTITY", `Only ${Math.max(remainingReturnable, 0)} shipped units remain returnable.`, 409, line.version);
  const condition = optionalText(payload, "condition", "quarantine");
  const locationId = optionalText(payload, "locationId", condition === "usable" ? "loc-receiving" : "loc-returns");
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const returnId = newId("customer-return");
  const returnNumber = documentNumber("RMA");
  const now = new Date().toISOString();
  const result: CommandResult = {
    message: `${returnNumber} received for ${quantity} unit${quantity === 1 ? "" : "s"}.`,
    impact: { physical: `${quantity} units added to ${condition === "usable" ? "usable" : "quarantine"} on-hand inventory.`, commercial: "Original shipped quantity remains fulfilled; replacement demand is separate.", financial: "Refund or credit remains a separate financial decision.", onHandDelta: quantity, incomingDelta: 0, reservedDelta: 0, availableDelta: condition === "usable" ? quantity : 0 },
  };
  const exists = commandExistsPrepared(input.idempotencyKey);
  const db = getD1();
  await db.batch([
    logPrepared(input, result, "sales_orders"),
    db.prepare(`UPDATE sales_orders SET version = version + 1 WHERE id = ? AND version = ? AND ${exists}`).bind(input.entityId, input.version),
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
       source_document_id, sales_order_line_id, posted_at, posted_by, idempotency_key)
      SELECT ?, 'customer_return', ?, ?, ?, ?, 'customer_return', ?, ?, ?, ?, ? WHERE ${exists}`)
      .bind(newId("movement"), line.productId, quantity, locationId, condition === "usable" ? "usable" : "quarantine", returnId, line.id, now, actor, input.idempotencyKey),
    db.prepare(`INSERT INTO audit_events (id, entity_type, entity_id, action, summary, actor, metadata_json, created_at)
                SELECT ?, 'sales_order', ?, 'customer_return_received', ?, ?, ?, ? WHERE ${exists}`)
      .bind(newId("audit"), input.entityId, result.message, actor, JSON.stringify({ reason, condition, quantity }), now),
  ]);
  return requireLogged(input, "The sales order changed before the customer return could be received.");
}

async function postInventoryAdjustment(input: InventoryCommand): Promise<CommandResult> {
  const payload = input.payload ?? {};
  const locationId = requiredText(payload, "locationId");
  const countedQuantity = roundQuantity(asNumber(payload, "countedQuantity"));
  if (countedQuantity < 0) throw new DomainError("VALIDATION_ERROR", "countedQuantity cannot be negative.");
  const reason = requiredText(payload, "reason");
  const balance = await first<{ onHandQty: number; reservedQty: number; version: number }>(
    "SELECT on_hand_qty AS onHandQty, reserved_qty AS reservedQty, version FROM inventory_balances WHERE product_id = ? AND location_id = ?",
    input.entityId, locationId
  );
  if (!balance) throw new DomainError("NOT_FOUND", "No inventory balance exists for this product and location.", 404);
  if (balance.version !== input.version) throw new DomainError("VERSION_CONFLICT", "The inventory balance changed. Refresh before posting the count.", 409, balance.version);
  if (countedQuantity < balance.reservedQty) throw new DomainError("RESERVATION_CONFLICT", `Counted quantity cannot be below ${balance.reservedQty} actively reserved units.`, 409, balance.version);
  const delta = roundQuantity(countedQuantity - balance.onHandQty);
  const actor = optionalText(payload, "actor", "Avery Morgan");
  const countId = newId("count");
  const countNumber = documentNumber("CNT");
  const now = new Date().toISOString();
  const result: CommandResult = {
    message: delta === 0 ? `${countNumber} posted with no variance.` : `${countNumber} posted with a ${delta > 0 ? "+" : ""}${delta} unit variance.`,
    impact: { physical: delta === 0 ? "Ledger and physical count agree; no movement created." : `${Math.abs(delta)} unit ${delta > 0 ? "gain" : "loss"} posted.`, commercial: "Orders and commitments are unchanged.", financial: "No invoice or bill was created; valuation reflects the stock movement.", onHandDelta: delta, incomingDelta: 0, reservedDelta: 0, availableDelta: delta },
  };
  const exists = commandExistsPrepared(input.idempotencyKey);
  const db = getD1();
  const commands: D1PreparedStatement[] = [
    logPrepared(input, result, "inventory_balances"),
    db.prepare(`UPDATE inventory_balances SET on_hand_qty = ?, version = version + 1
                WHERE product_id = ? AND location_id = ? AND version = ? AND ${exists}`)
      .bind(countedQuantity, input.entityId, locationId, input.version),
    db.prepare(`INSERT INTO inventory_counts
      (id, number, product_id, location_id, recorded_qty, counted_qty, variance_qty, status, reason, counted_at, counted_by)
      SELECT ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ? WHERE ${exists}`)
      .bind(countId, countNumber, input.entityId, locationId, balance.onHandQty, countedQuantity, delta, reason, now, actor),
    db.prepare(`INSERT INTO audit_events (id, entity_type, entity_id, action, summary, actor, metadata_json, created_at)
                SELECT ?, 'product', ?, 'inventory_count_posted', ?, ?, ?, ? WHERE ${exists}`)
      .bind(newId("audit"), input.entityId, result.message, actor, JSON.stringify({ reason, locationId, recordedQuantity: balance.onHandQty, countedQuantity }), now),
  ];
  if (delta !== 0) {
    commands.push(
      db.prepare(`INSERT INTO stock_movements
        (id, movement_type, product_id, quantity, from_location_id, to_location_id, inventory_status,
         source_document_type, source_document_id, posted_at, posted_by, idempotency_key)
        SELECT ?, ?, ?, ?, ?, ?, 'usable', 'inventory_count', ?, ?, ?, ? WHERE ${exists}`)
        .bind(newId("movement"), delta > 0 ? "inventory_adjustment_gain" : "inventory_adjustment_loss", input.entityId, delta, delta < 0 ? locationId : null, delta > 0 ? locationId : null, countId, now, actor, input.idempotencyKey)
    );
  }
  await db.batch(commands);
  return requireLogged(input, "The inventory balance changed before the count could be posted.");
}

export async function executeInventoryCommand(input: InventoryCommand): Promise<CommandResult> {
  await ensureDatabase();
  validateEnvelope(input);
  const prior = await currentOrConflict(input);
  if (prior) return prior;
  switch (normalizeCommand(input.command)) {
    case "receive":
    case "postreceipt": return postReceipt(input);
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
    case "customerreturn":
    case "postcustomerreturn": return postCustomerReturn(input);
    case "inventoryadjustment":
    case "postinventoryadjustment": return postInventoryAdjustment(input);
    default: throw new DomainError("UNKNOWN_COMMAND", `Unsupported command: ${input.command}.`);
  }
}

export async function getInventorySnapshot() {
  await ensureDatabase();

  const [purchaseOrders, purchaseLines, products, salesOrders, salesLines, movements, bills, activities, counts, locations, partners] = await Promise.all([
    all<Record<string, unknown>>(`WITH line_totals AS (
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
           po.expected_date AS expectedDate, po.currency, po.total_cents AS totalCents, po.buyer_name AS buyerName,
           po.version, bp.id AS vendorId, bp.name AS vendorName,
           lr.id AS latestReceiptId, lr.version AS latestReceiptVersion,
           COALESCE(lt.ordered_qty, 0) AS orderedQuantity, COALESCE(mt.gross_received_qty, 0) AS grossReceivedQuantity,
           COALESCE(mt.reversed_qty, 0) AS receiptReversedQuantity, COALESCE(mt.returned_qty, 0) AS vendorReturnedQuantity,
           COALESCE(mt.net_received_qty, 0) AS netReceivedQuantity, COALESCE(lt.closed_qty, 0) AS closedWithoutReceiptQuantity,
           MAX(COALESCE(lt.ordered_qty,0) - COALESCE(mt.net_received_qty,0) - COALESCE(lt.closed_qty,0), 0) AS openToReceiveQuantity,
           CASE WHEN COALESCE(mt.net_received_qty,0) > COALESCE(lt.ordered_qty,0) THEN 'over_received'
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
      ORDER BY po.expected_date, po.number`),
    all<Record<string, unknown>>(`SELECT pol.id, pol.purchase_order_id AS purchaseOrderId, pol.product_id AS productId,
      p.sku, p.name AS productName, pol.ordered_qty AS orderedQuantity, pol.closed_qty AS closedWithoutReceiptQuantity,
      COALESCE(SUM(sm.quantity),0) AS netReceivedQuantity,
      MAX(pol.ordered_qty - pol.closed_qty - COALESCE(SUM(sm.quantity),0), 0) AS openToReceiveQuantity,
      pol.unit_cost_cents AS unitCostCents, pol.configuration_snapshot AS configurationSnapshot
      FROM purchase_order_lines pol JOIN products p ON p.id=pol.product_id
      LEFT JOIN stock_movements sm ON sm.purchase_order_line_id=pol.id GROUP BY pol.id ORDER BY pol.id`),
    all<Record<string, unknown>>(`WITH balance AS (
      SELECT ib.product_id, SUM(ib.on_hand_qty) on_hand_qty, SUM(ib.reserved_qty) reserved_qty,
             SUM(CASE WHEN l.inventory_status='usable' THEN ib.on_hand_qty ELSE 0 END) usable_qty,
             SUM(CASE WHEN l.inventory_status!='usable' THEN ib.on_hand_qty ELSE 0 END) quarantine_qty,
             MAX(ib.version) balance_version
        FROM inventory_balances ib JOIN locations l ON l.id=ib.location_id GROUP BY ib.product_id
    ), line_net AS (
      SELECT pol.id, pol.product_id, pol.ordered_qty, pol.closed_qty, COALESCE(SUM(sm.quantity),0) net_received
        FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id
        LEFT JOIN stock_movements sm ON sm.purchase_order_line_id=pol.id
       WHERE po.lifecycle_status='approved' GROUP BY pol.id
    ), incoming AS (
      SELECT product_id, SUM(MAX(ordered_qty-closed_qty-net_received,0)) incoming_qty FROM line_net GROUP BY product_id
    )
    SELECT p.id, p.sku, p.manufacturer_sku AS manufacturerSku, p.name, p.category, p.material, p.dimensions,
           p.finish, p.tracking_policy AS trackingPolicy, p.inventory_policy AS inventoryPolicy,
           p.standard_cost_cents AS standardCostCents, p.selling_price_cents AS sellingPriceCents,
           p.reorder_point AS reorderPoint, COALESCE(b.on_hand_qty,0) AS onHand,
           COALESCE(b.usable_qty,0) AS usable, COALESCE(b.quarantine_qty,0) AS quarantine,
           COALESCE(b.reserved_qty,0) AS reserved, COALESCE(b.usable_qty-b.reserved_qty,0) AS available,
           COALESCE(i.incoming_qty,0) AS incoming, COALESCE(b.balance_version,1) AS version
      FROM products p LEFT JOIN balance b ON b.product_id=p.id LEFT JOIN incoming i ON i.product_id=p.id
      WHERE p.active=1 ORDER BY p.name`),
    all<Record<string, unknown>>(`WITH line_totals AS (
      SELECT sales_order_id, SUM(ordered_qty) ordered_qty, SUM(canceled_qty) canceled_qty FROM sales_order_lines GROUP BY sales_order_id
    ), movement_totals AS (
      SELECT sol.sales_order_id,
             SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity ELSE 0 END) shipped_qty,
             SUM(CASE WHEN sm.movement_type='customer_return' THEN sm.quantity ELSE 0 END) returned_qty
        FROM sales_order_lines sol LEFT JOIN stock_movements sm ON sm.sales_order_line_id=sol.id GROUP BY sol.sales_order_id
    ), reserved AS (
      SELECT sol.sales_order_id, SUM(r.quantity) reserved_qty FROM sales_order_lines sol
      JOIN reservations r ON r.sales_order_line_id=sol.id AND r.status='active' GROUP BY sol.sales_order_id
    )
    SELECT so.id, so.number, so.lifecycle_status AS lifecycleStatus, so.billing_status AS billingStatus,
           so.requested_date AS requestedDate, so.currency, so.total_cents AS totalCents, so.owner_name AS ownerName,
           so.version, bp.id AS customerId, bp.name AS customerName,
           COALESCE(lt.ordered_qty,0) AS orderedQuantity, COALESCE(mt.shipped_qty,0) AS shippedQuantity,
           COALESCE(mt.returned_qty,0) AS returnedQuantity, COALESCE(r.reserved_qty,0) AS reservedQuantity,
           MAX(COALESCE(lt.ordered_qty,0)-COALESCE(lt.canceled_qty,0)-COALESCE(mt.shipped_qty,0),0) AS openToShipQuantity,
           CASE WHEN COALESCE(mt.shipped_qty,0)>=COALESCE(lt.ordered_qty,0)-COALESCE(lt.canceled_qty,0) THEN 'fully_shipped'
                WHEN COALESCE(mt.shipped_qty,0)>0 THEN 'partially_shipped'
                WHEN COALESCE(r.reserved_qty,0)>0 THEN 'reserved' ELSE 'unreserved' END AS fulfillmentStatus
      FROM sales_orders so JOIN business_partners bp ON bp.id=so.customer_id
      LEFT JOIN line_totals lt ON lt.sales_order_id=so.id LEFT JOIN movement_totals mt ON mt.sales_order_id=so.id
      LEFT JOIN reserved r ON r.sales_order_id=so.id ORDER BY so.requested_date, so.number`),
    all<Record<string, unknown>>(`SELECT sol.id, sol.sales_order_id AS salesOrderId, sol.product_id AS productId,
      p.sku, p.name AS productName, sol.ordered_qty AS orderedQuantity, sol.canceled_qty AS canceledQuantity,
      COALESCE(SUM(CASE WHEN sm.movement_type='sales_shipment' THEN -sm.quantity ELSE 0 END),0) AS shippedQuantity,
      COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.sales_order_line_id=sol.id AND r.status='active'),0) AS reservedQuantity,
      sol.unit_price_cents AS unitPriceCents, sol.configuration_snapshot AS configurationSnapshot
      FROM sales_order_lines sol JOIN products p ON p.id=sol.product_id
      LEFT JOIN stock_movements sm ON sm.sales_order_line_id=sol.id GROUP BY sol.id ORDER BY sol.id`),
    all<Record<string, unknown>>(`SELECT sm.id, sm.movement_type AS type, sm.quantity, sm.inventory_status AS inventoryStatus,
      sm.source_document_type AS sourceDocumentType, sm.source_document_id AS sourceDocumentId,
      sm.posted_at AS postedAt, sm.posted_by AS postedBy, sm.reversal_of_movement_id AS reversalOfMovementId,
      p.id AS productId, p.sku, p.name AS productName,
      fl.code AS fromLocationCode, tl.code AS toLocationCode
      FROM stock_movements sm JOIN products p ON p.id=sm.product_id
      LEFT JOIN locations fl ON fl.id=sm.from_location_id LEFT JOIN locations tl ON tl.id=sm.to_location_id
      ORDER BY sm.posted_at DESC, sm.id DESC LIMIT 40`),
    all<Record<string, unknown>>(`SELECT vb.id, vb.number, vb.status, vb.match_status AS matchStatus,
      vb.total_cents AS totalCents, vb.due_date AS dueDate, vb.currency, vb.version,
      bp.id AS vendorId, bp.name AS vendorName, po.number AS purchaseOrderNumber
      FROM vendor_bills vb JOIN business_partners bp ON bp.id=vb.vendor_id
      LEFT JOIN purchase_orders po ON po.id=vb.purchase_order_id ORDER BY vb.due_date`),
    all<Record<string, unknown>>(`SELECT id, entity_type AS entityType, entity_id AS entityId, action, summary,
      actor, metadata_json AS metadataJson, created_at AS createdAt
      FROM audit_events ORDER BY created_at DESC, id DESC LIMIT 30`),
    all<Record<string, unknown>>(`SELECT ic.id, ic.number, ic.status, ic.recorded_qty AS recordedQuantity,
      ic.counted_qty AS countedQuantity, ic.variance_qty AS varianceQuantity, ic.reason,
      ic.counted_at AS countedAt, ic.counted_by AS countedBy,
      p.id AS productId, p.sku, p.name AS productName, l.id AS locationId, l.code AS locationCode
      FROM inventory_counts ic JOIN products p ON p.id=ic.product_id JOIN locations l ON l.id=ic.location_id
      ORDER BY ic.counted_at DESC LIMIT 20`),
    all<Record<string, unknown>>("SELECT id, code, name, location_type AS locationType, inventory_status AS inventoryStatus FROM locations ORDER BY code"),
    all<Record<string, unknown>>("SELECT id, code, name, partner_type AS partnerType, email, phone FROM business_partners ORDER BY name"),
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
  const summary = {
    skuCount: products.length,
    onHand: products.reduce((sum, product) => sum + numeric(product.onHand), 0),
    usable: products.reduce((sum, product) => sum + numeric(product.usable), 0),
    reserved: products.reduce((sum, product) => sum + numeric(product.reserved), 0),
    available: products.reduce((sum, product) => sum + numeric(product.available), 0),
    incoming: products.reduce((sum, product) => sum + numeric(product.incoming), 0),
    quarantine: products.reduce((sum, product) => sum + numeric(product.quarantine), 0),
    inventoryValueCents: products.reduce((sum, product) => sum + numeric(product.onHand) * numeric(product.standardCostCents), 0),
    openPurchaseOrders: purchaseOrders.filter((order) => numeric(order.openToReceiveQuantity) > 0).length,
    latePurchaseOrders: purchaseOrders.filter((order) => typeof order.expectedDate === "string" && order.expectedDate < new Date().toISOString().slice(0, 10) && numeric(order.openToReceiveQuantity) > 0).length,
    openSalesOrders: salesOrders.filter((order) => numeric(order.openToShipQuantity) > 0).length,
    readyToShip: salesOrders.filter((order) => numeric(order.reservedQuantity) > 0).length,
    matchExceptions: bills.filter((bill) => bill.matchStatus !== "matched").length,
  };

  return {
    generatedAt: new Date().toISOString(),
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
  };
}
