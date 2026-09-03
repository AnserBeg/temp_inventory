import type { ActorIdentity, AppCapability } from "./auth";
import { all, first, getD1 } from "./inventory-db";
import { getEmailSender, sendWithConnectedMailbox } from "./email-client";
import { maybeCreateInvoicePaymentLink } from "./helcim-payments";
import type { DocumentEmailPreview, EmailDocumentType, EmailSenderType, PrintableDocumentType } from "./email-types";

type DocumentHeader = {
  id: string;
  number: string;
  status: string;
  partyName: string;
  partyEmail: string | null;
  currency: string;
  totalCents: number;
  subtotalCents: number | null;
  taxCents: number | null;
  documentDate: string;
  dueOrExpectedDate: string | null;
  paymentTerms: string | null;
  reference: string | null;
  supplierQuoteNumber: string | null;
  supplierReference: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
};

type DocumentLine = {
  sku: string;
  productName: string;
  description: string | null;
  quantity: number;
  uomCode: string | null;
  unitAmountCents: number;
  discountCents: number;
  taxRateBps: number;
  taxable: number;
  lineTotalCents: number | null;
};

type DocumentCharge = { description: string; amountCents: number; direction: string; taxAmountCents: number };
type LoadedDocument = { type: PrintableDocumentType; label: string; header: DocumentHeader; lines: DocumentLine[]; charges: DocumentCharge[] };

export class DocumentEmailError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = "DOCUMENT_EMAIL_INVALID", status = 400) {
    super(message); this.code = code; this.status = status;
  }
}

export function emailDocumentCapability(type: EmailDocumentType): AppCapability {
  return type === "customer_invoice" ? "financialWrite" : "operationalWrite";
}

export function isEmailDocumentType(value: string): value is EmailDocumentType {
  return ["purchase_order", "sales_order", "customer_invoice"].includes(value);
}

export function isPrintableDocumentType(value: string): value is PrintableDocumentType {
  return isEmailDocumentType(value) || value === "vendor_bill";
}

async function documentHeader(type: PrintableDocumentType, id: string) {
  if (type === "purchase_order") {
    return first<DocumentHeader>(`SELECT po.id,po.number,po.lifecycle_status AS status,bp.name AS partyName,bp.email AS partyEmail,
      po.currency,po.total_cents AS totalCents,NULL AS subtotalCents,NULL AS taxCents,substr(po.created_at,1,10) AS documentDate,
      po.expected_date AS dueOrExpectedDate,po.payment_terms AS paymentTerms,po.project_reference AS reference,
      po.supplier_quote_number AS supplierQuoteNumber,po.supplier_reference AS supplierReference,
      bp.address_line_1 AS addressLine1,bp.address_line_2 AS addressLine2,bp.city,bp.region,bp.postal_code AS postalCode,bp.country
      FROM purchase_orders po JOIN business_partners bp ON bp.id=po.vendor_id WHERE po.id=? LIMIT 1`, id);
  }
  if (type === "sales_order") {
    return first<DocumentHeader>(`SELECT so.id,so.number,so.lifecycle_status AS status,bp.name AS partyName,bp.email AS partyEmail,
      so.currency,so.total_cents AS totalCents,NULL AS subtotalCents,NULL AS taxCents,substr(so.created_at,1,10) AS documentDate,
      so.requested_date AS dueOrExpectedDate,so.payment_terms AS paymentTerms,so.project_reference AS reference,
      NULL AS supplierQuoteNumber,NULL AS supplierReference,
      COALESCE(so.ship_to_address_line_1,bp.address_line_1) AS addressLine1,COALESCE(so.ship_to_address_line_2,bp.address_line_2) AS addressLine2,
      COALESCE(so.ship_to_city,bp.city) AS city,COALESCE(so.ship_to_region,bp.region) AS region,
      COALESCE(so.ship_to_postal_code,bp.postal_code) AS postalCode,COALESCE(so.ship_to_country,bp.country) AS country
      FROM sales_orders so JOIN business_partners bp ON bp.id=so.customer_id WHERE so.id=? LIMIT 1`, id);
  }
  if (type === "vendor_bill") {
    return first<DocumentHeader>(`SELECT vb.id,vb.number,vb.status,bp.name AS partyName,bp.email AS partyEmail,
      vb.currency,vb.total_cents AS totalCents,vb.subtotal_cents AS subtotalCents,vb.tax_cents AS taxCents,
      vb.invoice_date AS documentDate,vb.due_date AS dueOrExpectedDate,vb.payment_terms AS paymentTerms,po.number AS reference,
      NULL AS supplierQuoteNumber,NULL AS supplierReference,
      bp.address_line_1 AS addressLine1,bp.address_line_2 AS addressLine2,bp.city,bp.region,bp.postal_code AS postalCode,bp.country
      FROM vendor_bills vb JOIN business_partners bp ON bp.id=vb.vendor_id
      LEFT JOIN purchase_orders po ON po.id=vb.purchase_order_id WHERE vb.id=? LIMIT 1`, id);
  }
  return first<DocumentHeader>(`SELECT ci.id,ci.number,ci.status,bp.name AS partyName,bp.email AS partyEmail,
    ci.currency,ci.total_cents AS totalCents,ci.subtotal_cents AS subtotalCents,ci.tax_cents AS taxCents,
    ci.invoice_date AS documentDate,ci.due_date AS dueOrExpectedDate,ci.payment_terms AS paymentTerms,so.number AS reference,
    NULL AS supplierQuoteNumber,NULL AS supplierReference,
    bp.address_line_1 AS addressLine1,bp.address_line_2 AS addressLine2,bp.city,bp.region,bp.postal_code AS postalCode,bp.country
    FROM customer_invoices ci JOIN business_partners bp ON bp.id=ci.customer_id
    LEFT JOIN sales_orders so ON so.id=ci.sales_order_id WHERE ci.id=? LIMIT 1`, id);
}

async function documentLines(type: PrintableDocumentType, id: string) {
  if (type === "purchase_order") {
    return all<DocumentLine>(`SELECT p.sku,p.name AS productName,pol.configuration_snapshot AS description,
      COALESCE(pol.ordered_uom_qty,pol.ordered_qty) AS quantity,u.code AS uomCode,
      COALESCE(pol.ordered_uom_unit_cost_cents,pol.unit_cost_cents) AS unitAmountCents,pol.discount_cents AS discountCents,
      pol.tax_rate_bps AS taxRateBps,pol.taxable,NULL AS lineTotalCents
      FROM purchase_order_lines pol JOIN products p ON p.id=pol.product_id
      LEFT JOIN units_of_measure u ON u.id=pol.ordered_uom_id WHERE pol.purchase_order_id=? ORDER BY pol.rowid`, id);
  }
  if (type === "sales_order") {
    return all<DocumentLine>(`SELECT p.sku,p.name AS productName,sol.configuration_snapshot AS description,
      COALESCE(sol.ordered_uom_qty,sol.ordered_qty) AS quantity,u.code AS uomCode,
      COALESCE(sol.ordered_uom_unit_price_cents,sol.unit_price_cents) AS unitAmountCents,sol.discount_cents AS discountCents,
      sol.tax_rate_bps AS taxRateBps,sol.taxable,NULL AS lineTotalCents
      FROM sales_order_lines sol JOIN products p ON p.id=sol.product_id
      LEFT JOIN units_of_measure u ON u.id=sol.ordered_uom_id WHERE sol.sales_order_id=? ORDER BY sol.rowid`, id);
  }
  if (type === "vendor_bill") {
    return all<DocumentLine>(`SELECT p.sku,p.name AS productName,pol.configuration_snapshot AS description,
      vbl.quantity,u.code AS uomCode,vbl.unit_cost_cents AS unitAmountCents,0 AS discountCents,
      0 AS taxRateBps,0 AS taxable,vbl.line_total_cents AS lineTotalCents
      FROM vendor_bill_lines vbl JOIN products p ON p.id=vbl.product_id
      LEFT JOIN purchase_order_lines pol ON pol.id=vbl.purchase_order_line_id
      LEFT JOIN units_of_measure u ON u.id=pol.ordered_uom_id WHERE vbl.vendor_bill_id=? ORDER BY vbl.rowid`, id);
  }
  return all<DocumentLine>(`SELECT p.sku,p.name AS productName,sol.configuration_snapshot AS description,
    cil.quantity,NULL AS uomCode,cil.unit_price_cents AS unitAmountCents,
    MAX(ROUND(cil.quantity*cil.unit_price_cents)-cil.line_total_cents,0) AS discountCents,
    0 AS taxRateBps,0 AS taxable,cil.line_total_cents AS lineTotalCents
    FROM customer_invoice_lines cil JOIN products p ON p.id=cil.product_id
    JOIN sales_order_lines sol ON sol.id=cil.sales_order_line_id WHERE cil.customer_invoice_id=? ORDER BY cil.rowid`, id);
}

function documentLabel(type: PrintableDocumentType) {
  if (type === "purchase_order") return "Purchase order";
  if (type === "sales_order") return "Sales order";
  if (type === "vendor_bill") return "Vendor bill";
  return "Invoice";
}

async function loadDocument(type: PrintableDocumentType, id: string): Promise<LoadedDocument> {
  const header = await documentHeader(type, id);
  if (!header) throw new DocumentEmailError(`${documentLabel(type)} not found.`, "DOCUMENT_NOT_FOUND", 404);
  const status = header.status.toLowerCase();
  if (type === "purchase_order" && status !== "approved") throw new DocumentEmailError("Only an approved purchase order can be emailed to a vendor.", "DOCUMENT_NOT_SENDABLE", 409);
  if (type === "sales_order" && status !== "confirmed") throw new DocumentEmailError("Only a confirmed sales order can be emailed to a customer.", "DOCUMENT_NOT_SENDABLE", 409);
  if (type === "customer_invoice" && status === "void") throw new DocumentEmailError("A void invoice cannot be emailed.", "DOCUMENT_NOT_SENDABLE", 409);
  if (type === "vendor_bill" && status === "void") throw new DocumentEmailError("A void vendor bill cannot be printed.", "DOCUMENT_NOT_SENDABLE", 409);
  const [lines, charges] = await Promise.all([
    documentLines(type, id),
    all<DocumentCharge>(`SELECT description,amount_cents AS amountCents,direction,tax_amount_cents AS taxAmountCents
      FROM document_charges WHERE document_type=? AND document_id=? ORDER BY created_at,id`, type, id),
  ]);
  if (!lines.length) throw new DocumentEmailError(`${documentLabel(type)} has no lines to send.`, "DOCUMENT_EMPTY", 409);
  return { type, label: documentLabel(type), header, lines, charges };
}

function safeFilePart(value: string) {
  return value.replaceAll(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

export async function getDocumentEmailPreview(type: EmailDocumentType, id: string): Promise<DocumentEmailPreview> {
  const document = await loadDocument(type, id);
  const { header, label } = document;
  return {
    documentType: type,
    documentId: header.id,
    documentNumber: header.number,
    documentLabel: label,
    partyName: header.partyName,
    defaultRecipient: header.partyEmail ?? "",
    defaultSubject: `${label} ${header.number} from PaneFlow`,
    defaultMessage: type === "customer_invoice"
      ? `Hello ${header.partyName},\n\nPlease find invoice ${header.number} attached. A secure online payment button is included below when available.\n\nThank you.`
      : `Hello ${header.partyName},\n\nPlease find ${label.toLowerCase()} ${header.number} attached.\n\nThank you.`,
    fileName: `${safeFilePart(header.number)}.pdf`,
  };
}

function money(cents: number, currency: string) {
  try { return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100); }
  catch { return `${currency} ${(cents / 100).toFixed(2)}`; }
}

function cleanPdfText(value: unknown) {
  return String(value ?? "").normalize("NFKD").replaceAll(/[\u0300-\u036f]/g, "").replaceAll(/[\u2010-\u2015]/g, "-")
    .replaceAll(/[\u2018\u2019]/g, "'").replaceAll(/[\u201c\u201d]/g, '"').replaceAll(/[^\x20-\x7E]/g, "?").trim();
}

function wrapText(value: string, width = 88) {
  const words = cleanPdfText(value).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) { line = word; continue; }
    if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

type PdfRow = { text: string; size?: number; bold?: boolean; gapAfter?: number };

function pdfEscape(value: string) {
  return cleanPdfText(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function buildPdf(rows: PdfRow[]) {
  const pages: PdfRow[][] = [];
  let page: PdfRow[] = [];
  let y = 744;
  for (const row of rows) {
    const height = Math.max((row.size ?? 10) + 4 + (row.gapAfter ?? 0), 14);
    if (y - height < 52 && page.length) { pages.push(page); page = []; y = 744; }
    page.push(row); y -= height;
  }
  if (page.length || !pages.length) pages.push(page);

  const objectCount = 4 + pages.length * 2;
  const objects = new Array<string>(objectCount + 1).fill("");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  const pageReferences: string[] = [];
  pages.forEach((pageRows, pageIndex) => {
    const contentId = 5 + pageIndex * 2;
    const pageId = contentId + 1;
    pageReferences.push(`${pageId} 0 R`);
    let lineY = 744;
    const commands: string[] = [];
    for (const row of pageRows) {
      const size = row.size ?? 10;
      commands.push(`BT /F${row.bold ? 2 : 1} ${size} Tf 1 0 0 1 48 ${lineY} Tm (${pdfEscape(row.text)}) Tj ET`);
      lineY -= Math.max(size + 4 + (row.gapAfter ?? 0), 14);
    }
    commands.push(`BT /F1 8 Tf 1 0 0 1 48 28 Tm (PaneFlow - Page ${pageIndex + 1} of ${pages.length}) Tj ET`);
    const stream = commands.join("\n");
    objects[contentId] = `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
  });
  objects[2] = `<< /Type /Pages /Kids [${pageReferences.join(" ")}] /Count ${pages.length} >>`;

  let output = "%PDF-1.4\n%PaneFlow\n";
  const offsets = new Array<number>(objectCount + 1).fill(0);
  for (let id = 1; id <= objectCount; id += 1) {
    offsets[id] = new TextEncoder().encode(output).length;
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = new TextEncoder().encode(output).length;
  output += `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objectCount; id += 1) output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(output);
}

function printableDescription(value: string | null) {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.entries(parsed).map(([key, item]) => `${key.replaceAll(/([A-Z])/g, " $1")}: ${String(item)}`).join("; ");
  } catch { return value; }
}

function renderDocumentPdf(document: LoadedDocument, senderEmail?: string) {
  const { header } = document;
  const rows: PdfRow[] = [
    { text: "PANEFLOW OPERATIONS", size: 11, bold: true },
    { text: document.label.toUpperCase(), size: 20, bold: true },
    { text: header.number, size: 14, bold: true, gapAfter: 8 },
    { text: `${document.type === "purchase_order" || document.type === "vendor_bill" ? "Vendor" : "Customer"}: ${header.partyName}`, bold: true },
  ];
  const address = [header.addressLine1, header.addressLine2, header.city, header.region, header.postalCode, header.country].filter(Boolean).join(", ");
  if (address) rows.push(...wrapText(address).map((text) => ({ text })));
  if (header.partyEmail) rows.push({ text: `Email: ${header.partyEmail}` });
  rows.push(
    { text: `Status: ${cleanPdfText(header.status).replaceAll("_", " ")}` },
    { text: `${document.type === "customer_invoice" || document.type === "vendor_bill" ? "Invoice" : "Order"} date: ${header.documentDate || "-"}` },
    { text: `${document.type === "purchase_order" ? "Expected" : document.type === "sales_order" ? "Requested" : "Due"}: ${header.dueOrExpectedDate || "-"}` },
    { text: `Currency: ${header.currency}${header.paymentTerms ? `   Terms: ${header.paymentTerms}` : ""}${header.reference ? `   Reference: ${header.reference}` : ""}`, gapAfter: document.type === "purchase_order" && (header.supplierQuoteNumber || header.supplierReference) ? 0 : 8 },
    ...(document.type === "purchase_order" && (header.supplierQuoteNumber || header.supplierReference)
      ? [{ text: `Supplier quote: ${header.supplierQuoteNumber || "-"}${header.supplierReference ? `   Supplier reference: ${header.supplierReference}` : ""}`, gapAfter: 8 }]
      : []),
    { text: "ITEMS", size: 12, bold: true },
  );
  document.lines.forEach((line, index) => {
    rows.push(...wrapText(`${index + 1}. ${line.sku} - ${line.productName}`, 80).map((text, lineIndex) => ({ text, bold: lineIndex === 0 })));
    const quantity = Number(line.quantity);
    const lineSubtotal = Math.round(quantity * Number(line.unitAmountCents));
    const lineTotal = line.lineTotalCents ?? Math.max(lineSubtotal - Number(line.discountCents), 0);
    rows.push({ text: `   ${quantity} ${line.uomCode ?? "unit(s)"} x ${money(Number(line.unitAmountCents), header.currency)}   ${money(lineTotal, header.currency)}` });
    const description = printableDescription(line.description);
    if (description) rows.push(...wrapText(`   ${description}`, 82).map((text) => ({ text })));
    if (line.discountCents) rows.push({ text: `   Discount: -${money(Number(line.discountCents), header.currency)}` });
    if (line.taxable && line.taxRateBps) rows.push({ text: `   Tax rate: ${(Number(line.taxRateBps) / 100).toFixed(2)}%` });
  });
  if (document.charges.length) {
    rows.push({ text: "CHARGES", size: 12, bold: true, gapAfter: 2 });
    for (const charge of document.charges) {
      const sign = charge.direction === "subtract" ? -1 : 1;
      rows.push({ text: `${charge.description}: ${money(sign * Number(charge.amountCents), header.currency)}${charge.taxAmountCents ? `   Tax ${money(Number(charge.taxAmountCents), header.currency)}` : ""}` });
    }
  }
  if (header.subtotalCents != null) rows.push({ text: `Subtotal: ${money(Number(header.subtotalCents), header.currency)}`, bold: true });
  if (header.taxCents != null) rows.push({ text: `Tax: ${money(Number(header.taxCents), header.currency)}`, bold: true });
  rows.push(
    { text: `TOTAL: ${money(Number(header.totalCents), header.currency)}`, size: 14, bold: true, gapAfter: 10 },
    { text: senderEmail
      ? `Sent from ${senderEmail} through PaneFlow on ${new Date().toISOString().slice(0, 10)}.`
      : `Generated from PaneFlow on ${new Date().toISOString().slice(0, 10)}.` },
  );
  return buildPdf(rows);
}

/** Build the same authoritative PDF used for email without requiring a mailbox connection. */
export async function getDocumentPdf(type: PrintableDocumentType, id: string) {
  const document = await loadDocument(type, id);
  return {
    documentNumber: document.header.number,
    fileName: `${safeFilePart(document.header.number)}.pdf`,
    body: renderDocumentPdf(document),
  };
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function validateRecipients(values: unknown) {
  const candidates = Array.isArray(values) ? values : typeof values === "string" ? values.split(/[;,]/) : [];
  const recipients = [...new Set(candidates.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length) throw new DocumentEmailError("Enter at least one recipient email address.", "RECIPIENT_REQUIRED");
  if (recipients.length > 10) throw new DocumentEmailError("A document email can have at most 10 recipients.", "TOO_MANY_RECIPIENTS");
  for (const recipient of recipients) {
    if (recipient.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/u.test(recipient)) throw new DocumentEmailError(`${recipient} is not a valid email address.`, "INVALID_RECIPIENT");
  }
  return recipients;
}

export async function sendDocumentEmail(actor: ActorIdentity, input: { documentType: EmailDocumentType; documentId: string; recipients: unknown; subject: unknown; message: unknown; senderType?: EmailSenderType }, requestUrl?: string) {
  const document = await loadDocument(input.documentType, input.documentId);
  const preview = await getDocumentEmailPreview(input.documentType, input.documentId);
  const recipients = validateRecipients(input.recipients);
  const subject = String(input.subject ?? "").trim();
  const message = String(input.message ?? "").trim();
  if (!subject || subject.length > 200 || /[\r\n]/u.test(subject)) throw new DocumentEmailError("Enter a subject of 200 characters or fewer.", "INVALID_SUBJECT");
  if (message.length > 5_000) throw new DocumentEmailError("The email message must be 5,000 characters or fewer.", "MESSAGE_TOO_LONG");
  const paymentLink = input.documentType === "customer_invoice" && requestUrl
    ? await maybeCreateInvoicePaymentLink(document.header.id, actor, requestUrl)
    : null;
  const paymentAction = paymentLink
    ? `<p style="margin:24px 0"><a href="${escapeHtml(paymentLink.url)}" style="display:inline-block;padding:12px 19px;border-radius:8px;background:#1f5b4c;color:#fff;text-decoration:none;font-weight:700">Pay ${escapeHtml(document.header.number)} securely</a></p><p style="color:#5c6f6b;font-size:12px">${paymentLink.checkoutMode === "embedded" ? `This PaneFlow payment link expires ${escapeHtml(paymentLink.expiresAt.slice(0, 10))}. ` : "This button opens the Helcim-hosted online invoice. "}Card or bank details are entered directly with Helcim.</p>`
    : "";
  const htmlBody = `<div style="font-family:Arial,sans-serif;color:#17342f;line-height:1.5">${escapeHtml(message || preview.defaultMessage).replaceAll("\n", "<br>")}${paymentAction}<p style="color:#5c6f6b;font-size:12px">${escapeHtml(document.label)} ${escapeHtml(document.header.number)} is attached as a PDF generated from PaneFlow&apos;s current system record.</p></div>`;
  const deliveryId = `email-delivery-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const connection = await getEmailSender(actor, input.senderType);
  const db = getD1();
  await db.prepare(`INSERT INTO document_email_deliveries
    (id,user_id,provider,sender_type,sender_email,document_type,document_id,document_number,recipients_json,subject,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?)`)
    .bind(deliveryId, actor.id, connection.provider, connection.senderType, connection.senderEmail, input.documentType, document.header.id, document.header.number, JSON.stringify(recipients), subject, now).run();
  try {
    const pdf = renderDocumentPdf(document, connection.senderEmail);
    const sent = await sendWithConnectedMailbox(actor, { recipients, subject, htmlBody, fileName: preview.fileName, pdf }, connection.senderType);
    const sentAt = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE document_email_deliveries SET status='sent',provider_message_id=?,sent_at=?,last_error=NULL WHERE id=?")
        .bind(sent.messageId || null, sentAt, deliveryId),
      db.prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(`audit-email-${crypto.randomUUID()}`, input.documentType, document.header.id, "document_emailed", `${document.label} ${document.header.number} emailed to ${recipients.join(", ")}.`, actor.label, actor.id, actor.email, JSON.stringify({ deliveryId, provider: sent.provider, senderType: sent.senderType, senderEmail: sent.senderEmail, recipients, subject, paymentLinkId: paymentLink?.id ?? null }), sentAt),
      db.prepare(`INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at)
        VALUES (?,'document.emailed',?,?,?,'pending',0,?,?)`)
        .bind(`outbox-email-${crypto.randomUUID()}`, input.documentType, document.header.id, JSON.stringify({ deliveryId, documentType: input.documentType, documentId: document.header.id, documentNumber: document.header.number, provider: sent.provider, senderType: sent.senderType, senderEmail: sent.senderEmail, recipients }), sentAt, sentAt),
    ]);
    return { deliveryId, documentNumber: document.header.number, recipients, senderType: sent.senderType, senderEmail: sent.senderEmail, sentAt };
  } catch (error) {
    const messageText = error instanceof Error ? error.message.slice(0, 1_000) : "Email delivery failed.";
    await db.prepare("UPDATE document_email_deliveries SET status='failed',last_error=? WHERE id=?").bind(messageText, deliveryId).run();
    throw error;
  }
}
