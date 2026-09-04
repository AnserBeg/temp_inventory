import { all, first, getD1, newId, nextDocumentNumber } from "./inventory-db";
import { hasCapability, type ActorIdentity } from "./auth";

type WorkOrderStatus = "open" | "on_hold" | "completed";
type DocumentKind = "sales_order" | "purchase_order";
type DocumentInput = { id: string; number: string };

type WorkOrderRow = {
  id: string;
  number: string;
  title: string;
  notes: string | null;
  status: WorkOrderStatus;
  partnerId: string | null;
  partnerName: string | null;
  partnerType: string | null;
  createdByName: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type WorkOrderLinkRow = {
  id: string;
  workOrderId: string;
  documentType: DocumentKind;
  documentId: string;
  documentNumber: string;
};

type LabourItemRow = {
  id: string;
  workOrderId: string;
  title: string;
  status: "open" | "completed";
  version: number;
  createdAt: string;
  updatedAt: string;
  totalSeconds: number;
};

type TimeEntryRow = {
  id: string;
  labourItemId: string;
  workOrderId: string;
  workOrderNumber: string;
  workOrderTitle: string;
  labourTitle: string;
  workerUserId: string;
  workerName: string;
  workerEmail: string;
  startedAt: string;
  endedAt: string | null;
  techStory: string | null;
  editedByName: string | null;
  version: number;
  updatedAt: string;
};

export class WorkforceError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "WorkforceError";
  }
}

function requiredText(input: Record<string, unknown>, key: string, max = 180) {
  const value = typeof input[key] === "string" ? input[key].trim() : "";
  if (!value) throw new WorkforceError("VALIDATION_ERROR", `${key} is required.`);
  if (value.length > max) throw new WorkforceError("VALIDATION_ERROR", `${key} must be ${max} characters or fewer.`);
  return value;
}

function optionalText(input: Record<string, unknown>, key: string, max = 8_000) {
  const value = typeof input[key] === "string" ? input[key].trim() : "";
  if (value.length > max) throw new WorkforceError("VALIDATION_ERROR", `${key} must be ${max} characters or fewer.`);
  return value;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 50);
}

function secondsBetween(startedAt: string, endedAt: string | null, now = Date.now()) {
  const start = new Date(startedAt).valueOf();
  const end = endedAt ? new Date(endedAt).valueOf() : now;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 1000)) : 0;
}

async function documentRows(kind: DocumentKind, ids: string[]): Promise<DocumentInput[]> {
  if (!ids.length) return [];
  const table = kind === "sales_order" ? "sales_orders" : "purchase_orders";
  const placeholders = ids.map(() => "?").join(",");
  const rows = await all<DocumentInput>(`SELECT id,number FROM ${table} WHERE id IN (${placeholders})`, ...ids);
  if (rows.length !== ids.length) throw new WorkforceError("INVALID_DOCUMENT", "One of the linked orders is no longer available.", 409);
  return rows;
}

async function validatePartner(partnerId: string) {
  if (!partnerId) return;
  const partner = await first<{ id: string }>("SELECT id FROM business_partners WHERE id=? AND active=1", partnerId);
  if (!partner) throw new WorkforceError("INVALID_PARTNER", "Choose an active customer or vendor.", 409);
}

async function audit(actor: ActorIdentity, entityType: string, entityId: string, action: string, summary: string, metadata: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  await getD1().prepare(`INSERT INTO audit_events
    (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(newId("audit-workforce"), entityType, entityId, action, summary, actor.label, actor.id, actor.email, JSON.stringify(metadata), now).run();
}

export async function getWorkforceSnapshot(actor: ActorIdentity) {
  const [workOrders, links, labourItems, timeEntries, workers, workerTotals, partners, salesOrders, purchaseOrders] = await Promise.all([
    all<WorkOrderRow>(`SELECT wo.id,wo.number,wo.title,wo.notes,wo.status,wo.partner_id AS partnerId,
      bp.name AS partnerName,bp.partner_type AS partnerType,wo.created_by_name AS createdByName,
      wo.version,wo.created_at AS createdAt,wo.updated_at AS updatedAt
      FROM work_orders wo LEFT JOIN business_partners bp ON bp.id=wo.partner_id
      ORDER BY CASE wo.status WHEN 'open' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END,wo.updated_at DESC LIMIT 200`),
    all<WorkOrderLinkRow>(`SELECT id,work_order_id AS workOrderId,document_type AS documentType,
      document_id AS documentId,document_number AS documentNumber FROM work_order_document_links
      ORDER BY document_type,document_number`),
    all<LabourItemRow>(`SELECT li.id,li.work_order_id AS workOrderId,li.title,li.status,li.version,li.created_at AS createdAt,li.updated_at AS updatedAt,
      COALESCE((SELECT SUM(MAX((julianday(COALESCE(te.ended_at,CURRENT_TIMESTAMP))-julianday(te.started_at))*86400,0)) FROM time_entries te WHERE te.labour_item_id=li.id),0) AS totalSeconds
      FROM labour_items li ORDER BY li.created_at`),
    all<TimeEntryRow>(`SELECT te.id,te.labour_item_id AS labourItemId,li.work_order_id AS workOrderId,
      wo.number AS workOrderNumber,wo.title AS workOrderTitle,li.title AS labourTitle,
      te.worker_user_id AS workerUserId,te.worker_name AS workerName,te.worker_email AS workerEmail,
      te.started_at AS startedAt,te.ended_at AS endedAt,te.tech_story AS techStory,
      te.edited_by_name AS editedByName,te.version,te.updated_at AS updatedAt
      FROM time_entries te JOIN labour_items li ON li.id=te.labour_item_id JOIN work_orders wo ON wo.id=li.work_order_id
      ORDER BY CASE WHEN te.ended_at IS NULL THEN 0 ELSE 1 END,te.started_at DESC LIMIT 1000`),
    all<{ userId: string; name: string; email: string; role: string }>(`SELECT tm.user_id AS userId,au.full_name AS name,au.email,tm.role
      FROM tenant_memberships tm JOIN app_users au ON au.user_id=tm.user_id
      WHERE tm.active=1 AND au.active=1 ORDER BY au.full_name,au.email`),
    all<{ userId: string; totalSeconds: number; sevenDaySeconds: number; entryCount: number }>(`SELECT worker_user_id AS userId,COUNT(*) AS entryCount,
      COALESCE(SUM(MAX((julianday(COALESCE(ended_at,CURRENT_TIMESTAMP))-julianday(started_at))*86400,0)),0) AS totalSeconds,
      COALESCE(SUM(CASE WHEN julianday(started_at)>=julianday('now','-7 days') THEN MAX((julianday(COALESCE(ended_at,CURRENT_TIMESTAMP))-julianday(started_at))*86400,0) ELSE 0 END),0) AS sevenDaySeconds
      FROM time_entries GROUP BY worker_user_id`),
    all<{ id: string; name: string; partnerType: string }>(`SELECT id,name,partner_type AS partnerType FROM business_partners WHERE active=1 ORDER BY name LIMIT 250`),
    all<{ id: string; number: string; partnerName: string }>(`SELECT so.id,so.number,bp.name AS partnerName FROM sales_orders so
      JOIN business_partners bp ON bp.id=so.customer_id ORDER BY so.created_at DESC LIMIT 250`),
    all<{ id: string; number: string; partnerName: string }>(`SELECT po.id,po.number,bp.name AS partnerName FROM purchase_orders po
      JOIN business_partners bp ON bp.id=po.vendor_id ORDER BY po.created_at DESC LIMIT 250`),
  ]);

  const capturedAt = new Date().toISOString();
  const entriesByLabour = new Map<string, TimeEntryRow[]>();
  for (const entry of timeEntries) {
    const list = entriesByLabour.get(entry.labourItemId) ?? [];
    list.push(entry);
    entriesByLabour.set(entry.labourItemId, list);
  }
  const labourByOrder = new Map<string, Array<LabourItemRow & { entries: Array<TimeEntryRow & { durationSeconds: number }>; totalSeconds: number }>>();
  for (const item of labourItems) {
    const entries = (entriesByLabour.get(item.id) ?? []).map((entry) => ({ ...entry, durationSeconds: secondsBetween(entry.startedAt, entry.endedAt) }));
    const list = labourByOrder.get(item.workOrderId) ?? [];
    list.push({ ...item, entries, totalSeconds: Number(item.totalSeconds ?? 0) });
    labourByOrder.set(item.workOrderId, list);
  }
  const linksByOrder = new Map<string, WorkOrderLinkRow[]>();
  for (const link of links) {
    const list = linksByOrder.get(link.workOrderId) ?? [];
    list.push(link);
    linksByOrder.set(link.workOrderId, list);
  }

  const enrichedOrders = workOrders.map((order) => {
    const items = labourByOrder.get(order.id) ?? [];
    const people = [...new Map(items.flatMap((item) => item.entries).map((entry) => [entry.workerUserId, { userId: entry.workerUserId, name: entry.workerName }])).values()];
    return { ...order, links: linksByOrder.get(order.id) ?? [], labourItems: items, people, totalSeconds: items.reduce((sum, item) => sum + item.totalSeconds, 0) };
  });

  const activeByWorker = new Map(timeEntries.filter((entry) => !entry.endedAt).map((entry) => [entry.workerUserId, entry]));
  const totalsByWorker = new Map(workerTotals.map((total) => [total.userId, total]));
  const workerProfiles = workers.map((worker) => {
    const totals = totalsByWorker.get(worker.userId);
    return {
      ...worker,
      activeEntry: activeByWorker.get(worker.userId) ?? null,
      totalSeconds: Number(totals?.totalSeconds ?? 0),
      sevenDaySeconds: Number(totals?.sevenDaySeconds ?? 0),
      entryCount: Number(totals?.entryCount ?? 0),
    };
  });

  return {
    capturedAt,
    viewer: { id: actor.id, name: actor.name, email: actor.email, role: actor.role, canOperate: hasCapability(actor, "operationalWrite"), canManage: hasCapability(actor, "approve") },
    workOrders: enrichedOrders,
    workers: workerProfiles,
    timeEntries,
    lookups: { partners, salesOrders, purchaseOrders },
  };
}

async function createWorkOrder(actor: ActorIdentity, input: Record<string, unknown>) {
  const title = requiredText(input, "title");
  const notes = optionalText(input, "notes", 4_000);
  const partnerId = optionalText(input, "partnerId", 200);
  const salesOrderIds = stringArray(input.salesOrderIds);
  const purchaseOrderIds = stringArray(input.purchaseOrderIds);
  const labourTitles = stringArray(input.labourTitles).map((item) => item.slice(0, 180));
  await validatePartner(partnerId);
  const [salesDocuments, purchaseDocuments] = await Promise.all([
    documentRows("sales_order", salesOrderIds),
    documentRows("purchase_order", purchaseOrderIds),
  ]);
  const now = new Date().toISOString();
  const id = newId("work-order");
  const number = await nextDocumentNumber("WO");
  const db = getD1();
  const statements = [db.prepare(`INSERT INTO work_orders
    (id,number,title,notes,status,partner_id,created_by_id,created_by_name,version,created_at,updated_at)
    VALUES (?,?,?,?,'open',?,?,?,1,?,?)`).bind(id, number, title, notes || null, partnerId || null, actor.id, actor.name, now, now)];
  for (const document of salesDocuments) statements.push(db.prepare(`INSERT INTO work_order_document_links
    (id,work_order_id,document_type,document_id,document_number,created_at) VALUES (?,?,'sales_order',?,?,?)`)
    .bind(newId("work-order-link"), id, document.id, document.number, now));
  for (const document of purchaseDocuments) statements.push(db.prepare(`INSERT INTO work_order_document_links
    (id,work_order_id,document_type,document_id,document_number,created_at) VALUES (?,?,'purchase_order',?,?,?)`)
    .bind(newId("work-order-link"), id, document.id, document.number, now));
  for (const labourTitle of labourTitles) statements.push(db.prepare(`INSERT INTO labour_items
    (id,work_order_id,title,status,created_by_id,version,created_at,updated_at) VALUES (?,? ,?,'open',?,1,?,?)`)
    .bind(newId("labour-item"), id, labourTitle, actor.id, now, now));
  await db.batch(statements);
  await audit(actor, "work_order", id, "work_order_created", `${number} created: ${title}`, { partnerId: partnerId || null, notes: notes || null, salesOrderIds, purchaseOrderIds, labourItems: labourTitles.length });
  return { message: `${number} created.`, workOrderId: id };
}

async function addLabourItem(actor: ActorIdentity, input: Record<string, unknown>) {
  const workOrderId = requiredText(input, "workOrderId", 200);
  const title = requiredText(input, "title");
  const workOrder = await first<{ number: string; status: WorkOrderStatus }>("SELECT number,status FROM work_orders WHERE id=?", workOrderId);
  if (!workOrder) throw new WorkforceError("NOT_FOUND", "The work order was not found.", 404);
  if (workOrder.status === "completed") throw new WorkforceError("WORK_ORDER_COMPLETED", "Reopen the work order before adding labour.", 409);
  const id = newId("labour-item");
  const now = new Date().toISOString();
  await getD1().prepare(`INSERT INTO labour_items
    (id,work_order_id,title,status,created_by_id,version,created_at,updated_at) VALUES (?,? ,?,'open',?,1,?,?)`)
    .bind(id, workOrderId, title, actor.id, now, now).run();
  await audit(actor, "work_order", workOrderId, "labour_item_added", `${title} added to ${workOrder.number}.`, { labourItemId: id });
  return { message: "Labour item added.", labourItemId: id };
}

async function clockIn(actor: ActorIdentity, input: Record<string, unknown>) {
  const labourItemId = requiredText(input, "labourItemId", 200);
  const active = await first<{ workOrderNumber: string; labourTitle: string }>(`SELECT wo.number AS workOrderNumber,li.title AS labourTitle
    FROM time_entries te JOIN labour_items li ON li.id=te.labour_item_id JOIN work_orders wo ON wo.id=li.work_order_id
    WHERE te.worker_user_id=? AND te.ended_at IS NULL LIMIT 1`, actor.id);
  if (active) throw new WorkforceError("ALREADY_CLOCKED_IN", `Clock out of ${active.workOrderNumber} · ${active.labourTitle} first.`, 409);
  const labour = await first<{ workOrderId: string; workOrderNumber: string; workOrderTitle: string; labourTitle: string }>(`SELECT li.work_order_id AS workOrderId,
    wo.number AS workOrderNumber,wo.title AS workOrderTitle,li.title AS labourTitle
    FROM labour_items li JOIN work_orders wo ON wo.id=li.work_order_id
    WHERE li.id=? AND li.status='open' AND wo.status='open'`, labourItemId);
  if (!labour) throw new WorkforceError("NOT_CLOCKABLE", "This labour item is not open for time entry.", 409);
  const now = new Date().toISOString();
  const id = newId("time-entry");
  try {
    await getD1().prepare(`INSERT INTO time_entries
      (id,labour_item_id,worker_user_id,worker_name,worker_email,started_at,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,1,?,?)`).bind(id, labourItemId, actor.id, actor.name, actor.email, now, now, now).run();
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) throw new WorkforceError("ALREADY_CLOCKED_IN", "You are already clocked into another labour item.", 409);
    throw error;
  }
  await audit(actor, "work_order", labour.workOrderId, "worker_clocked_in", `${actor.name} clocked into ${labour.workOrderNumber} · ${labour.labourTitle}.`, { timeEntryId: id, labourItemId });
  return { message: `Clocked into ${labour.workOrderNumber} · ${labour.labourTitle}.`, timeEntryId: id };
}

async function clockOut(actor: ActorIdentity, input: Record<string, unknown>) {
  const timeEntryId = requiredText(input, "timeEntryId", 200);
  const techStory = optionalText(input, "techStory");
  const entry = await first<{ version: number; workOrderId: string; number: string; labourTitle: string }>(`SELECT te.version,li.work_order_id AS workOrderId,
    wo.number,li.title AS labourTitle FROM time_entries te JOIN labour_items li ON li.id=te.labour_item_id
    JOIN work_orders wo ON wo.id=li.work_order_id WHERE te.id=? AND te.worker_user_id=? AND te.ended_at IS NULL`, timeEntryId, actor.id);
  if (!entry) throw new WorkforceError("NOT_ACTIVE", "This clock is no longer active.", 409);
  const now = new Date().toISOString();
  const result = await getD1().prepare(`UPDATE time_entries SET ended_at=?,tech_story=?,version=version+1,updated_at=?
    WHERE id=? AND worker_user_id=? AND ended_at IS NULL AND version=?`).bind(now, techStory || null, now, timeEntryId, actor.id, entry.version).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new WorkforceError("VERSION_CONFLICT", "The time entry changed. Refresh and try again.", 409);
  await audit(actor, "work_order", entry.workOrderId, "worker_clocked_out", `${actor.name} clocked out of ${entry.number} · ${entry.labourTitle}.`, { timeEntryId, hasTechStory: Boolean(techStory) });
  return { message: `Clocked out of ${entry.number}.` };
}

async function updateTimeEntry(actor: ActorIdentity, input: Record<string, unknown>) {
  const timeEntryId = requiredText(input, "timeEntryId", 200);
  const version = Number(input.version);
  const startedAt = requiredText(input, "startedAt", 100);
  const endedAt = requiredText(input, "endedAt", 100);
  const techStory = optionalText(input, "techStory");
  const startMs = new Date(startedAt).valueOf();
  const endMs = new Date(endedAt).valueOf();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new WorkforceError("INVALID_TIME_RANGE", "Clock-out time must be after clock-in time.");
  if (endMs > Date.now() + 5 * 60_000) throw new WorkforceError("INVALID_TIME_RANGE", "Clock-out time cannot be in the future.");
  const entry = await first<{ workerUserId: string; workOrderId: string; number: string }>(`SELECT te.worker_user_id AS workerUserId,
    li.work_order_id AS workOrderId,wo.number FROM time_entries te JOIN labour_items li ON li.id=te.labour_item_id
    JOIN work_orders wo ON wo.id=li.work_order_id WHERE te.id=? AND te.ended_at IS NOT NULL`, timeEntryId);
  if (!entry) throw new WorkforceError("NOT_FOUND", "The completed time entry was not found.", 404);
  if (entry.workerUserId !== actor.id && !hasCapability(actor, "approve")) throw new WorkforceError("FORBIDDEN", "Only a manager can edit another worker's shift.", 403);
  const now = new Date().toISOString();
  const result = await getD1().prepare(`UPDATE time_entries SET started_at=?,ended_at=?,tech_story=?,edited_by_id=?,edited_by_name=?,
    version=version+1,updated_at=? WHERE id=? AND version=? AND ended_at IS NOT NULL`)
    .bind(new Date(startMs).toISOString(), new Date(endMs).toISOString(), techStory || null, actor.id, actor.name, now, timeEntryId, version).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new WorkforceError("VERSION_CONFLICT", "The shift changed. Refresh before saving.", 409);
  await audit(actor, "work_order", entry.workOrderId, "time_entry_edited", `${actor.name} edited a shift on ${entry.number}.`, { timeEntryId });
  return { message: "Shift updated." };
}

async function updateWorkOrder(actor: ActorIdentity, input: Record<string, unknown>) {
  const workOrderId = requiredText(input, "workOrderId", 200);
  const title = requiredText(input, "title");
  const notes = optionalText(input, "notes", 4_000);
  const status = requiredText(input, "status", 40) as WorkOrderStatus;
  const partnerId = optionalText(input, "partnerId", 200);
  const version = Number(input.version);
  if (!["open", "on_hold", "completed"].includes(status)) throw new WorkforceError("VALIDATION_ERROR", "Choose a valid work-order status.");
  await validatePartner(partnerId);
  if (status === "completed") {
    const active = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM time_entries te JOIN labour_items li ON li.id=te.labour_item_id
      WHERE li.work_order_id=? AND te.ended_at IS NULL`, workOrderId);
    if (Number(active?.count ?? 0) > 0) throw new WorkforceError("ACTIVE_SHIFTS", "Clock out every worker before completing this work order.", 409);
  }
  const salesOrderIds = stringArray(input.salesOrderIds);
  const purchaseOrderIds = stringArray(input.purchaseOrderIds);
  const [salesDocuments, purchaseDocuments] = await Promise.all([
    documentRows("sales_order", salesOrderIds),
    documentRows("purchase_order", purchaseOrderIds),
  ]);
  const now = new Date().toISOString();
  const db = getD1();
  const update = await db.prepare(`UPDATE work_orders SET title=?,notes=?,status=?,partner_id=?,version=version+1,updated_at=? WHERE id=? AND version=?`)
    .bind(title, notes || null, status, partnerId || null, now, workOrderId, version).run();
  if (Number(update.meta?.changes ?? 0) !== 1) throw new WorkforceError("VERSION_CONFLICT", "The work order changed. Refresh before saving.", 409);
  const statements = [db.prepare("DELETE FROM work_order_document_links WHERE work_order_id=?").bind(workOrderId)];
  for (const document of salesDocuments) statements.push(db.prepare(`INSERT INTO work_order_document_links
    (id,work_order_id,document_type,document_id,document_number,created_at) VALUES (?,?,'sales_order',?,?,?)`)
    .bind(newId("work-order-link"), workOrderId, document.id, document.number, now));
  for (const document of purchaseDocuments) statements.push(db.prepare(`INSERT INTO work_order_document_links
    (id,work_order_id,document_type,document_id,document_number,created_at) VALUES (?,?,'purchase_order',?,?,?)`)
    .bind(newId("work-order-link"), workOrderId, document.id, document.number, now));
  await db.batch(statements);
  await audit(actor, "work_order", workOrderId, "work_order_updated", `${actor.name} updated the work order.`, { status, partnerId: partnerId || null, notes: notes || null, salesOrderIds, purchaseOrderIds });
  return { message: "Work order updated." };
}

async function updateLabourItem(actor: ActorIdentity, input: Record<string, unknown>) {
  const labourItemId = requiredText(input, "labourItemId", 200);
  const title = requiredText(input, "title");
  const status = requiredText(input, "status", 40);
  const version = Number(input.version);
  if (!["open", "completed"].includes(status)) throw new WorkforceError("VALIDATION_ERROR", "Choose a valid labour-item status.");
  if (status === "completed") {
    const active = await first<{ id: string }>("SELECT id FROM time_entries WHERE labour_item_id=? AND ended_at IS NULL LIMIT 1", labourItemId);
    if (active) throw new WorkforceError("ACTIVE_SHIFT", "Clock out of this labour item before completing it.", 409);
  }
  const now = new Date().toISOString();
  const item = await first<{ workOrderId: string }>("SELECT work_order_id AS workOrderId FROM labour_items WHERE id=?", labourItemId);
  if (!item) throw new WorkforceError("NOT_FOUND", "The labour item was not found.", 404);
  const result = await getD1().prepare("UPDATE labour_items SET title=?,status=?,version=version+1,updated_at=? WHERE id=? AND version=?")
    .bind(title, status, now, labourItemId, version).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new WorkforceError("VERSION_CONFLICT", "The labour item changed. Refresh before saving.", 409);
  await audit(actor, "work_order", item.workOrderId, "labour_item_updated", `${actor.name} updated ${title}.`, { labourItemId, status });
  return { message: "Labour item updated." };
}

export async function executeWorkforceCommand(actor: ActorIdentity, input: Record<string, unknown>) {
  switch (input.command) {
    case "createWorkOrder": return createWorkOrder(actor, input);
    case "addLabourItem": return addLabourItem(actor, input);
    case "clockIn": return clockIn(actor, input);
    case "clockOut": return clockOut(actor, input);
    case "updateTimeEntry": return updateTimeEntry(actor, input);
    case "updateWorkOrder": return updateWorkOrder(actor, input);
    case "updateLabourItem": return updateLabourItem(actor, input);
    default: throw new WorkforceError("UNKNOWN_COMMAND", "That workforce action is not supported.", 400);
  }
}
