import { env } from "cloudflare:workers";
import type { ActorIdentity } from "./auth";
import { all, ensureDatabase, first, getD1, newId } from "./inventory-db";
import { requireTenant } from "./tenancy";

const MAX_BYTES = 10 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const allowedCategories = new Set(["document","damage_photo","proof_of_delivery","packing_slip","invoice","label","product_photo","sales_person_photo","other"]);
const documentTables: Record<string, string> = {
  product: "products",
  sales_person: "sales_people",
  purchase_order: "purchase_orders", receipt: "receipts", vendor_return: "vendor_returns",
  sales_order: "sales_orders", shipment: "shipments", customer_return: "customer_returns",
  vendor_bill: "vendor_bills", customer_invoice: "customer_invoices", inventory_count: "inventory_counts",
  inventory_transfer: "inventory_transfers", returnable_obligation: "returnable_obligations",
};
const lineItemTables: Record<string, { table: string; documentColumn: string }> = {
  purchase_order: { table: "purchase_order_lines", documentColumn: "purchase_order_id" },
  sales_order: { table: "sales_order_lines", documentColumn: "sales_order_id" },
};

export class AttachmentError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

function bucket() {
  const files = (env as unknown as { FILES?: R2Bucket }).FILES;
  if (!files) throw new AttachmentError("STORAGE_UNAVAILABLE", "Attachment storage is not configured.", 503);
  return files;
}

/** Idempotent storage cleanup used both by the request path and the durable outbox retry. */
export async function deleteAttachmentObject(objectKey: string) {
  if (!objectKey.trim()) throw new AttachmentError("OBJECT_KEY_REQUIRED", "Attachment cleanup requires an object key.");
  await bucket().delete(objectKey);
}

async function validateDocument(documentType: string, documentId: string) {
  const table = documentTables[documentType];
  if (!table) throw new AttachmentError("INVALID_DOCUMENT_TYPE", "This document type does not support attachments.");
  const document = await first(`SELECT id FROM ${table} WHERE id=?`, documentId);
  if (!document) throw new AttachmentError("DOCUMENT_NOT_FOUND", "The attachment target was not found.", 404);
}

export async function listAttachments(documentType: string, documentId: string) {
  await ensureDatabase();
  const records = await all<Record<string, unknown>>(`SELECT id,document_type AS documentType,document_id AS documentId,
    file_name AS fileName,content_type AS contentType,size_bytes AS sizeBytes,category,
    owner_id AS ownerId,owner_email AS ownerEmail,uploaded_at AS uploadedAt,version,
    COALESCE((SELECT json_group_array(ali.line_item_id) FROM attachment_line_items ali WHERE ali.attachment_id=attachments.id),'[]') AS lineItemIdsJson
    FROM attachments WHERE document_type=? AND document_id=? AND deleted_at IS NULL ORDER BY uploaded_at DESC`, documentType, documentId);
  return records.map((record) => {
    let lineItemIds: string[] = [];
    try {
      const parsed = JSON.parse(String(record.lineItemIdsJson ?? "[]"));
      if (Array.isArray(parsed)) lineItemIds = parsed.filter((value): value is string => typeof value === "string");
    } catch { /* A malformed legacy value is treated as an unassigned document attachment. */ }
    const attachment = { ...record };
    delete attachment.lineItemIdsJson;
    return { ...attachment, lineItemIds };
  });
}

async function validateLineItems(documentType: string, documentId: string, category: string, form: FormData) {
  const lineItemIds = [...new Set(form.getAll("lineItemIds").map((value) => String(value).trim()).filter(Boolean))];
  if (category === "damage_photo" && lineItemTables[documentType] && !lineItemIds.length) {
    throw new AttachmentError("LINE_ITEMS_REQUIRED", "Select at least one affected order line for a damage photo.");
  }
  if (!lineItemIds.length) return lineItemIds;
  if (category !== "damage_photo") throw new AttachmentError("INVALID_LINE_ITEM_CATEGORY", "Only damage photos can be linked to order lines.");
  const target = lineItemTables[documentType];
  if (!target) throw new AttachmentError("INVALID_LINE_ITEM_DOCUMENT", "Line-item photos must belong to a purchase order or sales order.");
  if (lineItemIds.length > 100) throw new AttachmentError("TOO_MANY_LINE_ITEMS", "A photo can be linked to at most 100 order lines.");
  for (const lineItemId of lineItemIds) {
    const line = await first(`SELECT id FROM ${target.table} WHERE id=? AND ${target.documentColumn}=?`, lineItemId, documentId);
    if (!line) throw new AttachmentError("LINE_ITEM_NOT_FOUND", "Every selected line must belong to this order.", 404);
  }
  return lineItemIds;
}

export async function uploadAttachment(actor: ActorIdentity, form: FormData) {
  await ensureDatabase();
  const documentType = String(form.get("documentType") ?? "").trim();
  const documentId = String(form.get("documentId") ?? "").trim();
  const category = String(form.get("category") ?? "document").trim();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AttachmentError("FILE_REQUIRED", "file is required.");
  if(!allowedCategories.has(category)) throw new AttachmentError("INVALID_CATEGORY","Unsupported attachment category.");
  if (documentType === "product" && category !== "product_photo") throw new AttachmentError("INVALID_CATEGORY", "Products accept pictures only.");
  if (documentType === "sales_person" && category !== "sales_person_photo") throw new AttachmentError("INVALID_CATEGORY", "Salespeople accept profile pictures only.");
  if (category === "product_photo" && documentType !== "product") throw new AttachmentError("INVALID_DOCUMENT_TYPE", "Product pictures must belong to a product.");
  if (category === "sales_person_photo" && documentType !== "sales_person") throw new AttachmentError("INVALID_DOCUMENT_TYPE", "Salesperson pictures must belong to a salesperson.");
  await validateDocument(documentType, documentId);
  const lineItemIds = await validateLineItems(documentType, documentId, category, form);
  if (!allowedTypes.has(file.type)) throw new AttachmentError("UNSUPPORTED_CONTENT_TYPE", "Only JPEG, PNG, WebP, and PDF attachments are allowed.", 415);
  if (category === "product_photo" && !file.type.startsWith("image/")) throw new AttachmentError("UNSUPPORTED_CONTENT_TYPE", "Product pictures must be JPEG, PNG, or WebP images.", 415);
  if (category === "sales_person_photo" && !file.type.startsWith("image/")) throw new AttachmentError("UNSUPPORTED_CONTENT_TYPE", "Salesperson pictures must be JPEG, PNG, or WebP images.", 415);
  if (category === "damage_photo" && !file.type.startsWith("image/")) throw new AttachmentError("UNSUPPORTED_CONTENT_TYPE", "Damage photos must be JPEG, PNG, or WebP images.", 415);
  if (file.size <= 0 || file.size > MAX_BYTES) throw new AttachmentError("FILE_SIZE_INVALID", "Attachments must be between 1 byte and 10 MB.", 413);
  const bytes=await file.arrayBuffer();const header=new Uint8Array(bytes.slice(0,16));
  const detected=header[0]===0xff&&header[1]===0xd8&&header[2]===0xff?"image/jpeg":header[0]===0x89&&header[1]===0x50&&header[2]===0x4e&&header[3]===0x47?"image/png":String.fromCharCode(...header.slice(0,4))==="%PDF"?"application/pdf":String.fromCharCode(...header.slice(0,4))==="RIFF"&&String.fromCharCode(...header.slice(8,12))==="WEBP"?"image/webp":"unknown";
  if(detected!==file.type) throw new AttachmentError("CONTENT_MISMATCH","File bytes do not match the declared content type.",415);
  const safeName = file.name.replaceAll(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 160) || "attachment";
  const id = newId("attachment");
  const objectKey = `tenants/${requireTenant().tenantId}/${documentType}/${documentId}/${id}/${safeName}`;
  const when = new Date().toISOString();
  await bucket().put(objectKey, bytes, { httpMetadata: { contentType: file.type }, customMetadata: { tenantId: actor.tenantId, ownerId: actor.id, documentType, documentId } });
  try {
    const db = getD1();
    await db.batch([
      db.prepare(`INSERT INTO attachments (id,document_type,document_id,file_name,object_key,content_type,size_bytes,category,owner_id,owner_email,uploaded_at,version)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`).bind(id, documentType, documentId, safeName, objectKey, file.type, file.size, category, actor.id, actor.email, when),
      db.prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(newId("audit"), documentType, documentId, "attachment_uploaded", `${safeName} attached as ${category}.`, actor.label, actor.id, actor.email, JSON.stringify({ attachmentId: id, contentType: file.type, sizeBytes: file.size, lineItemIds }), when),
      db.prepare(`INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at)
        VALUES (?,'attachment.uploaded',?,?,?,'pending',0,?,?)`).bind(newId("outbox"), documentType, documentId, JSON.stringify({ attachmentId: id, category, lineItemIds }), when, when),
      ...lineItemIds.map((lineItemId) => db.prepare(`INSERT INTO attachment_line_items (attachment_id,document_type,line_item_id) VALUES (?,?,?)`).bind(id, documentType, lineItemId)),
    ]);
  } catch (error) {
    await bucket().delete(objectKey);
    throw error;
  }
  return { id, documentType, documentId, fileName: safeName, contentType: file.type, sizeBytes: file.size, category, lineItemIds, ownerId: actor.id, ownerEmail: actor.email, uploadedAt: when, version: 1 };
}

export async function downloadAttachment(id: string) {
  await ensureDatabase();
  const metadata = await first<{ objectKey: string; fileName: string; contentType: string }>("SELECT object_key AS objectKey,file_name AS fileName,content_type AS contentType FROM attachments WHERE id=? AND deleted_at IS NULL", id);
  if (!metadata) throw new AttachmentError("NOT_FOUND", "Attachment was not found.", 404);
  const object = await bucket().get(metadata.objectKey);
  if (!object) throw new AttachmentError("OBJECT_NOT_FOUND", "Attachment bytes are unavailable.", 404);
  return new Response(object.body, { headers: {
    "Content-Type": metadata.contentType,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(metadata.fileName)}`,
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  } });
}

export async function deleteAttachment(actor: ActorIdentity, id: string) {
  await ensureDatabase();
  const metadata = await first<{ objectKey: string; ownerId: string; documentType: string; documentId: string; fileName: string; version: number }>("SELECT object_key AS objectKey,owner_id AS ownerId,document_type AS documentType,document_id AS documentId,file_name AS fileName,version FROM attachments WHERE id=? AND deleted_at IS NULL", id);
  if (!metadata) throw new AttachmentError("NOT_FOUND", "Attachment was not found.", 404);
  if (metadata.ownerId !== actor.id && !["manager", "administrator"].includes(actor.role)) throw new AttachmentError("FORBIDDEN", "Only the uploader or a manager may remove this attachment.", 403);
  const when = new Date().toISOString();
  const db = getD1();
  await db.batch([
    db.prepare("UPDATE attachments SET deleted_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL").bind(when, id, metadata.version),
    db.prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM attachments WHERE id=? AND deleted_at=?)`).bind(newId("audit"), metadata.documentType, metadata.documentId, "attachment_deleted", `${metadata.fileName} removed.`, actor.label, actor.id, actor.email, JSON.stringify({ attachmentId: id }), when,id,when),
    db.prepare(`INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at)
      SELECT ?,'attachment.delete_requested',?,?,?,'pending',0,?,? WHERE EXISTS (SELECT 1 FROM attachments WHERE id=? AND deleted_at=?)`).bind(newId("outbox"), metadata.documentType, metadata.documentId, JSON.stringify({ attachmentId: id,objectKey:metadata.objectKey }), when, when,id,when),
  ]);
  try{await deleteAttachmentObject(metadata.objectKey);}catch{/* durable delete_requested outbox retains retry details */}
}
