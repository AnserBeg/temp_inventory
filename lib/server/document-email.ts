import type { ActorIdentity, AppCapability } from "./auth";
import { all, first, getD1 } from "./inventory-db";
import { getEmailSender, sendWithConnectedMailbox } from "./email-client";
import { maybeCreateInvoicePaymentLink } from "./helcim-payments";
import { currentTenant } from "./tenancy";
import type { DocumentEmailPreview, EmailDocumentType, EmailSenderType, PrintableDocumentType } from "./email-types";

type DocumentHeader = {
  id: string;
  number: string;
  status: string;
  partyName: string;
  partyEmail: string | null;
  partyPhone: string | null;
  currency: string;
  totalCents: number;
  subtotalCents: number | null;
  taxCents: number | null;
  paidCents: number | null;
  creditedCents: number | null;
  documentDate: string;
  dueOrExpectedDate: string | null;
  paymentTerms: string | null;
  reference: string | null;
  preparedBy: string | null;
  supplierQuoteNumber: string | null;
  supplierReference: string | null;
  notes: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  title?: string | null;
  updatedDate?: string | null;
};

type DocumentLine = {
  sku: string;
  productName: string;
  description: string | null;
  binLocationCode: string | null;
  binLocationName: string | null;
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
  return type === "customer_invoice" || type === "vendor_bill" ? "financialWrite" : "operationalWrite";
}

export function isEmailDocumentType(value: string): value is EmailDocumentType {
  return ["purchase_order", "sales_order", "customer_invoice", "vendor_bill", "work_order"].includes(value);
}

export function isPrintableDocumentType(value: string): value is PrintableDocumentType {
  return isEmailDocumentType(value);
}

async function documentHeader(type: PrintableDocumentType, id: string) {
  if (type === "purchase_order") {
    return first<DocumentHeader>(`SELECT po.id,po.number,po.lifecycle_status AS status,bp.name AS partyName,bp.email AS partyEmail,
      bp.phone AS partyPhone,po.currency,po.total_cents AS totalCents,NULL AS subtotalCents,NULL AS taxCents,NULL AS paidCents,NULL AS creditedCents,substr(po.created_at,1,10) AS documentDate,
      po.expected_date AS dueOrExpectedDate,po.payment_terms AS paymentTerms,po.project_reference AS reference,
      po.buyer_name AS preparedBy,po.supplier_quote_number AS supplierQuoteNumber,po.supplier_reference AS supplierReference,po.notes,
      bp.address_line_1 AS addressLine1,bp.address_line_2 AS addressLine2,bp.city,bp.region,bp.postal_code AS postalCode,bp.country
      FROM purchase_orders po JOIN business_partners bp ON bp.id=po.vendor_id WHERE po.id=? LIMIT 1`, id);
  }
  if (type === "sales_order") {
    return first<DocumentHeader>(`SELECT so.id,so.number,so.lifecycle_status AS status,bp.name AS partyName,bp.email AS partyEmail,
      bp.phone AS partyPhone,so.currency,so.total_cents AS totalCents,NULL AS subtotalCents,NULL AS taxCents,NULL AS paidCents,NULL AS creditedCents,substr(so.created_at,1,10) AS documentDate,
      so.requested_date AS dueOrExpectedDate,so.payment_terms AS paymentTerms,so.project_reference AS reference,
      so.owner_name AS preparedBy,NULL AS supplierQuoteNumber,NULL AS supplierReference,so.notes,
      COALESCE(so.ship_to_address_line_1,bp.address_line_1) AS addressLine1,COALESCE(so.ship_to_address_line_2,bp.address_line_2) AS addressLine2,
      COALESCE(so.ship_to_city,bp.city) AS city,COALESCE(so.ship_to_region,bp.region) AS region,
      COALESCE(so.ship_to_postal_code,bp.postal_code) AS postalCode,COALESCE(so.ship_to_country,bp.country) AS country
      FROM sales_orders so JOIN business_partners bp ON bp.id=so.customer_id WHERE so.id=? LIMIT 1`, id);
  }
  if (type === "work_order") {
    return first<DocumentHeader>(`SELECT wo.id,wo.number,wo.status,COALESCE(bp.name,'Unassigned') AS partyName,bp.email AS partyEmail,
      bp.phone AS partyPhone,COALESCE(bp.currency,'CAD') AS currency,0 AS totalCents,NULL AS subtotalCents,NULL AS taxCents,
      NULL AS paidCents,NULL AS creditedCents,substr(wo.created_at,1,10) AS documentDate,substr(wo.updated_at,1,10) AS dueOrExpectedDate,
      NULL AS paymentTerms,(SELECT GROUP_CONCAT(wodl.document_number, ', ') FROM work_order_document_links wodl WHERE wodl.work_order_id=wo.id) AS reference,
      wo.created_by_name AS preparedBy,NULL AS supplierQuoteNumber,NULL AS supplierReference,wo.notes,
      bp.address_line_1 AS addressLine1,bp.address_line_2 AS addressLine2,bp.city,bp.region,bp.postal_code AS postalCode,bp.country,
      wo.title,substr(wo.updated_at,1,10) AS updatedDate
      FROM work_orders wo LEFT JOIN business_partners bp ON bp.id=wo.partner_id WHERE wo.id=? LIMIT 1`, id);
  }
  if (type === "vendor_bill") {
    return first<DocumentHeader>(`SELECT vb.id,vb.number,vb.status,bp.name AS partyName,bp.email AS partyEmail,
      bp.phone AS partyPhone,vb.currency,vb.total_cents AS totalCents,vb.subtotal_cents AS subtotalCents,vb.tax_cents AS taxCents,
      vb.paid_cents AS paidCents,COALESCE((SELECT SUM(vc.amount_cents) FROM vendor_credits vc WHERE vc.vendor_bill_id=vb.id AND vc.status='posted'),0) AS creditedCents,
      vb.invoice_date AS documentDate,vb.due_date AS dueOrExpectedDate,vb.payment_terms AS paymentTerms,po.number AS reference,
      vb.approved_by AS preparedBy,NULL AS supplierQuoteNumber,NULL AS supplierReference,vb.notes,
      bp.address_line_1 AS addressLine1,bp.address_line_2 AS addressLine2,bp.city,bp.region,bp.postal_code AS postalCode,bp.country
      FROM vendor_bills vb JOIN business_partners bp ON bp.id=vb.vendor_id
      LEFT JOIN purchase_orders po ON po.id=vb.purchase_order_id WHERE vb.id=? LIMIT 1`, id);
  }
  return first<DocumentHeader>(`SELECT ci.id,ci.number,ci.status,bp.name AS partyName,bp.email AS partyEmail,
    bp.phone AS partyPhone,ci.currency,ci.total_cents AS totalCents,ci.subtotal_cents AS subtotalCents,ci.tax_cents AS taxCents,
    ci.paid_cents AS paidCents,COALESCE((SELECT SUM(cc.amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0) AS creditedCents,
    ci.invoice_date AS documentDate,ci.due_date AS dueOrExpectedDate,ci.payment_terms AS paymentTerms,so.number AS reference,
    COALESCE(sp.name,so.owner_name,ci.posted_by) AS preparedBy,NULL AS supplierQuoteNumber,NULL AS supplierReference,ci.notes,
    bp.address_line_1 AS addressLine1,bp.address_line_2 AS addressLine2,bp.city,bp.region,bp.postal_code AS postalCode,bp.country
    FROM customer_invoices ci JOIN business_partners bp ON bp.id=ci.customer_id
    LEFT JOIN sales_orders so ON so.id=ci.sales_order_id LEFT JOIN sales_people sp ON sp.id=so.sales_person_id WHERE ci.id=? LIMIT 1`, id);
}

async function documentLines(type: PrintableDocumentType, id: string) {
  if (type === "purchase_order") {
    return all<DocumentLine>(`SELECT p.sku,p.name AS productName,pol.configuration_snapshot AS description,
      COALESCE(pol.ordered_uom_qty,pol.ordered_qty) AS quantity,u.code AS uomCode,
      COALESCE(pol.ordered_uom_unit_cost_cents,pol.unit_cost_cents) AS unitAmountCents,pol.discount_cents AS discountCents,
      pol.tax_rate_bps AS taxRateBps,pol.taxable,NULL AS lineTotalCents,bin.code AS binLocationCode,bin.name AS binLocationName
      FROM purchase_order_lines pol JOIN products p ON p.id=pol.product_id
      LEFT JOIN units_of_measure u ON u.id=pol.ordered_uom_id
      LEFT JOIN locations bin ON bin.id=pol.bin_location_id WHERE pol.purchase_order_id=? ORDER BY pol.rowid`, id);
  }
  if (type === "sales_order") {
    return all<DocumentLine>(`SELECT p.sku,p.name AS productName,sol.configuration_snapshot AS description,
      COALESCE(sol.ordered_uom_qty,sol.ordered_qty) AS quantity,u.code AS uomCode,
      COALESCE(sol.ordered_uom_unit_price_cents,sol.unit_price_cents) AS unitAmountCents,sol.discount_cents AS discountCents,
      sol.tax_rate_bps AS taxRateBps,sol.taxable,NULL AS lineTotalCents,bin.code AS binLocationCode,bin.name AS binLocationName
      FROM sales_order_lines sol JOIN products p ON p.id=sol.product_id
      LEFT JOIN units_of_measure u ON u.id=sol.ordered_uom_id
      LEFT JOIN locations bin ON bin.id=sol.bin_location_id WHERE sol.sales_order_id=? ORDER BY sol.rowid`, id);
  }
  if (type === "work_order") {
    return all<DocumentLine>(`SELECT li.id AS sku,li.title AS productName,
      'Workers: ' || COALESCE((SELECT GROUP_CONCAT(DISTINCT te.worker_name) FROM time_entries te WHERE te.labour_item_id=li.id),'Not assigned') ||
      CASE WHEN EXISTS (SELECT 1 FROM time_entries te WHERE te.labour_item_id=li.id AND te.tech_story IS NOT NULL AND trim(te.tech_story)<>'')
        THEN '; Technician notes: ' || (SELECT GROUP_CONCAT(te.tech_story, ' | ') FROM time_entries te WHERE te.labour_item_id=li.id AND te.tech_story IS NOT NULL AND trim(te.tech_story)<>'') ELSE '' END AS description,
      li.status AS binLocationCode,NULL AS binLocationName,
      ROUND(COALESCE((SELECT SUM(MAX((julianday(COALESCE(te.ended_at,CURRENT_TIMESTAMP))-julianday(te.started_at))*86400,0)) FROM time_entries te WHERE te.labour_item_id=li.id),0)/3600.0,2) AS quantity,
      'HR' AS uomCode,0 AS unitAmountCents,0 AS discountCents,0 AS taxRateBps,0 AS taxable,0 AS lineTotalCents
      FROM labour_items li WHERE li.work_order_id=? ORDER BY li.created_at,li.id`, id);
  }
  if (type === "vendor_bill") {
    return all<DocumentLine>(`SELECT p.sku,p.name AS productName,pol.configuration_snapshot AS description,
      vbl.quantity,u.code AS uomCode,vbl.unit_cost_cents AS unitAmountCents,0 AS discountCents,
      0 AS taxRateBps,0 AS taxable,vbl.line_total_cents AS lineTotalCents,bin.code AS binLocationCode,bin.name AS binLocationName
      FROM vendor_bill_lines vbl JOIN products p ON p.id=vbl.product_id
      LEFT JOIN purchase_order_lines pol ON pol.id=vbl.purchase_order_line_id
      LEFT JOIN units_of_measure u ON u.id=pol.ordered_uom_id
      LEFT JOIN locations bin ON bin.id=pol.bin_location_id WHERE vbl.vendor_bill_id=? ORDER BY vbl.rowid`, id);
  }
  return all<DocumentLine>(`SELECT p.sku,p.name AS productName,sol.configuration_snapshot AS description,
    cil.quantity,NULL AS uomCode,cil.unit_price_cents AS unitAmountCents,
    MAX(ROUND(cil.quantity*cil.unit_price_cents)-cil.line_total_cents,0) AS discountCents,
    0 AS taxRateBps,0 AS taxable,cil.line_total_cents AS lineTotalCents,bin.code AS binLocationCode,bin.name AS binLocationName
    FROM customer_invoice_lines cil JOIN products p ON p.id=cil.product_id
    JOIN sales_order_lines sol ON sol.id=cil.sales_order_line_id
    LEFT JOIN locations bin ON bin.id=COALESCE(cil.bin_location_id,sol.bin_location_id) WHERE cil.customer_invoice_id=? ORDER BY cil.rowid`, id);
}

function documentLabel(type: PrintableDocumentType) {
  if (type === "purchase_order") return "Purchase order";
  if (type === "sales_order") return "Sales order";
  if (type === "vendor_bill") return "Vendor bill";
  if (type === "work_order") return "Work order";
  return "Invoice";
}

async function loadDocument(type: PrintableDocumentType, id: string): Promise<LoadedDocument> {
  const header = await documentHeader(type, id);
  if (!header) throw new DocumentEmailError(`${documentLabel(type)} not found.`, "DOCUMENT_NOT_FOUND", 404);
  const status = header.status.toLowerCase();
  if (type === "purchase_order" && status !== "approved") throw new DocumentEmailError("Only an approved purchase order can be emailed to a vendor.", "DOCUMENT_NOT_SENDABLE", 409);
  if (type === "sales_order" && status !== "confirmed") throw new DocumentEmailError("Only a confirmed sales order can be emailed to a customer.", "DOCUMENT_NOT_SENDABLE", 409);
  if (type === "customer_invoice" && status === "void") throw new DocumentEmailError("A void invoice cannot be emailed.", "DOCUMENT_NOT_SENDABLE", 409);
  if (type === "vendor_bill" && status === "void") throw new DocumentEmailError("A void vendor bill cannot be sent.", "DOCUMENT_NOT_SENDABLE", 409);
  const [lines, charges] = await Promise.all([
    documentLines(type, id),
    all<DocumentCharge>(`SELECT description,amount_cents AS amountCents,direction,tax_amount_cents AS taxAmountCents
      FROM document_charges WHERE document_type=? AND document_id=? ORDER BY created_at,id`, type, id),
  ]);
  if (!lines.length && type !== "work_order") throw new DocumentEmailError(`${documentLabel(type)} has no lines to send.`, "DOCUMENT_EMPTY", 409);
  return { type, label: documentLabel(type), header, lines, charges };
}

function safeFilePart(value: string) {
  return value.replaceAll(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

export async function getDocumentEmailPreview(type: EmailDocumentType, id: string): Promise<DocumentEmailPreview> {
  const document = await loadDocument(type, id);
  const { header, label } = document;
  const greeting = header.partyName === "Unassigned" ? "Hello" : `Hello ${header.partyName}`;
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
      : `${greeting},\n\nPlease find ${label.toLowerCase()} ${header.number} attached.\n\nThank you.`,
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

function pdfEscape(value: string) {
  return cleanPdfText(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function buildPdf(pages: string[][], title: string) {
  const objectCount = 4 + pages.length * 2;
  const objects = new Array<string>(objectCount + 1).fill("");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  const pageReferences: string[] = [];
  pages.forEach((commands, pageIndex) => {
    const contentId = 5 + pageIndex * 2;
    const pageId = contentId + 1;
    pageReferences.push(`${pageId} 0 R`);
    const stream = commands.join("\n");
    objects[contentId] = `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
  });
  objects[2] = `<< /Type /Pages /Kids [${pageReferences.join(" ")}] /Count ${pages.length} >>`;

  let output = `%PDF-1.4\n%${safeFilePart(title)}\n`;
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

type PdfColor = readonly [number, number, number];
type PdfTextOptions = { size?: number; bold?: boolean; color?: PdfColor; align?: "left" | "right"; maxWidth?: number };
type PreparedLine = {
  index: number;
  name: string[];
  details: string[];
  quantity: string;
  unitAmount: string;
  tax: string;
  lineAmount: string;
  lineAmountCents: number;
  height: number;
};
type PdfDocumentPage = { lines: PreparedLine[]; continuation: boolean; summary: boolean };
type PreparedWorkOrderLine = { index: number; title: string[]; details: string[]; status: string; hours: string; hoursValue: number; height: number };
type PdfWorkOrderPage = { lines: PreparedWorkOrderLine[]; continuation: boolean; summary: boolean };

const PDF = {
  pageWidth: 612,
  margin: 44,
  contentWidth: 524,
  tableColumns: [44, 318, 367, 445, 496, 568] as const,
  ink: [0.09, 0.2, 0.18] as PdfColor,
  accent: [0.12, 0.36, 0.3] as PdfColor,
  accentSoft: [0.91, 0.95, 0.93] as PdfColor,
  muted: [0.36, 0.43, 0.41] as PdfColor,
  rule: [0.82, 0.86, 0.84] as PdfColor,
  wash: [0.965, 0.975, 0.97] as PdfColor,
  white: [1, 1, 1] as PdfColor,
};

function pdfNumber(value: number) {
  return Number(value.toFixed(3)).toString();
}

function pdfColor(color: PdfColor, stroke = false) {
  return `${color.map(pdfNumber).join(" ")} ${stroke ? "RG" : "rg"}`;
}

function estimateTextWidth(value: string, size: number) {
  let units = 0;
  for (const char of cleanPdfText(value)) {
    if (/[ ilI.,'`:;|!]/u.test(char)) units += 0.27;
    else if (/[MW@%&#]/u.test(char)) units += 0.84;
    else if (/[A-Z0-9]/u.test(char)) units += 0.61;
    else units += 0.51;
  }
  return units * size;
}

function fitPdfText(value: string, width: number, size: number) {
  const clean = cleanPdfText(value);
  if (estimateTextWidth(clean, size) <= width) return clean;
  let fitted = clean;
  while (fitted && estimateTextWidth(`${fitted}...`, size) > width) fitted = fitted.slice(0, -1);
  return `${fitted.trimEnd()}...`;
}

function wrapPdfText(value: string, width: number, size: number, maxLines = Number.POSITIVE_INFINITY) {
  const words = cleanPdfText(value).split(/\s+/u).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (estimateTextWidth(candidate, size) <= width) { line = candidate; continue; }
    if (line) lines.push(line);
    line = estimateTextWidth(word, size) <= width ? word : fitPdfText(word, width, size);
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) lines[maxLines - 1] = fitPdfText(`${lines[maxLines - 1]}...`, width, size);
  return lines;
}

function pdfText(commands: string[], value: string, x: number, y: number, options: PdfTextOptions = {}) {
  const size = options.size ?? 9;
  const text = options.maxWidth ? fitPdfText(value, options.maxWidth, size) : cleanPdfText(value);
  const width = estimateTextWidth(text, size);
  const drawX = options.align === "right" ? x - width : x;
  commands.push(`${pdfColor(options.color ?? PDF.ink)} BT /F${options.bold ? 2 : 1} ${pdfNumber(size)} Tf 1 0 0 1 ${pdfNumber(drawX)} ${pdfNumber(y)} Tm (${pdfEscape(text)}) Tj ET`);
}

function pdfRect(commands: string[], x: number, top: number, width: number, height: number, fill: PdfColor, stroke?: PdfColor) {
  commands.push(`${pdfColor(fill)} ${pdfColor(stroke ?? fill, true)} ${pdfNumber(x)} ${pdfNumber(top - height)} ${pdfNumber(width)} ${pdfNumber(height)} re ${stroke ? "B" : "f"}`);
}

function pdfLine(commands: string[], x1: number, y1: number, x2: number, y2: number, color = PDF.rule, width = 0.7) {
  commands.push(`${pdfColor(color, true)} ${pdfNumber(width)} w ${pdfNumber(x1)} ${pdfNumber(y1)} m ${pdfNumber(x2)} ${pdfNumber(y2)} l S`);
}

function titleFor(type: PrintableDocumentType) {
  if (type === "purchase_order") return "PURCHASE ORDER";
  if (type === "sales_order") return "SALES ORDER";
  if (type === "vendor_bill") return "VENDOR BILL";
  if (type === "work_order") return "WORK ORDER";
  return "INVOICE";
}

function partyLabel(type: PrintableDocumentType) {
  if (type === "purchase_order" || type === "vendor_bill") return "VENDOR";
  if (type === "sales_order") return "CUSTOMER / SHIP TO";
  if (type === "work_order") return "CUSTOMER / VENDOR";
  return "BILL TO";
}

function documentDateLabel(type: PrintableDocumentType) {
  if (type === "work_order") return "Created";
  return type === "customer_invoice" || type === "vendor_bill" ? "Invoice date" : "Order date";
}

function targetDateLabel(type: PrintableDocumentType) {
  if (type === "purchase_order") return "Expected date";
  if (type === "sales_order") return "Requested date";
  if (type === "work_order") return "Last updated";
  return "Due date";
}

function documentNote(type: PrintableDocumentType, number: string) {
  if (type === "purchase_order") return `Please reference purchase order ${number} on shipping documents and invoices.`;
  if (type === "sales_order") return `Please reference sales order ${number} in all order correspondence.`;
  if (type === "customer_invoice") return `Thank you for your business. Please include invoice ${number} with payment.`;
  if (type === "work_order") return `Please reference work order ${number} in all job correspondence.`;
  return `Recorded against the supplier document for ${number}.`;
}

function addressLines(header: DocumentHeader) {
  const locality = [header.city, header.region, header.postalCode].filter(Boolean).join(" ");
  return [header.partyName, header.addressLine1, header.addressLine2, locality, header.country, header.partyEmail, header.partyPhone]
    .filter((value): value is string => Boolean(value));
}

function metadataRows(type: PrintableDocumentType, header: DocumentHeader) {
  if (type === "work_order") {
    return [
      ["Job", header.title || "Untitled work"],
      ["Created", header.documentDate || "-"],
      ["Last updated", header.updatedDate || header.dueOrExpectedDate || "-"],
      ["Created by", header.preparedBy || "Not recorded"],
      ["Linked orders", header.reference || "None"],
    ] satisfies Array<[string, string]>;
  }
  const rows: Array<[string, string]> = [
    [documentDateLabel(type), header.documentDate || "-"],
    [targetDateLabel(type), header.dueOrExpectedDate || "-"],
    ["Payment terms", header.paymentTerms || "Not specified"],
    ["Currency", header.currency],
  ];
  if (header.reference) rows.push([type === "customer_invoice" || type === "vendor_bill" ? "Related order" : "Project reference", header.reference]);
  if (header.preparedBy) rows.push([type === "purchase_order" ? "Buyer" : type === "sales_order" || type === "customer_invoice" ? "Salesperson" : "Prepared by", header.preparedBy]);
  if (header.supplierQuoteNumber || header.supplierReference) rows.push(["Supplier quote / ref", [header.supplierQuoteNumber, header.supplierReference].filter(Boolean).join(" / ")]);
  return rows.slice(0, 7);
}

function lineAmount(line: DocumentLine) {
  const gross = Math.round(Number(line.quantity) * Number(line.unitAmountCents));
  return Number(line.lineTotalCents ?? Math.max(gross - Number(line.discountCents), 0));
}

function lineTax(line: DocumentLine, amount: number) {
  return line.taxable && line.taxRateBps ? Math.round(amount * Number(line.taxRateBps) / 10_000) : 0;
}

function prepareLines(document: LoadedDocument): PreparedLine[] {
  return document.lines.map((line, index) => {
    const amount = lineAmount(line);
    const description = printableDescription(line.description);
    const bin = line.binLocationCode ? `Bin: ${line.binLocationCode}${line.binLocationName ? ` · ${line.binLocationName}` : ""}` : "";
    const details = [line.sku, ...(bin ? [bin] : []), ...(description ? wrapPdfText(description, 252, 8, 3) : []), ...(line.discountCents ? [`Discount: -${money(Number(line.discountCents), document.header.currency)}`] : [])];
    const name = wrapPdfText(line.productName, 252, 9.5, 2);
    return {
      index: index + 1,
      name,
      details,
      quantity: `${Number(line.quantity).toLocaleString("en-CA", { maximumFractionDigits: 3 })} ${line.uomCode ?? "EA"}`,
      unitAmount: money(Number(line.unitAmountCents), document.header.currency),
      tax: line.taxable && line.taxRateBps ? money(lineTax(line, amount), document.header.currency) : "-",
      lineAmount: money(amount, document.header.currency),
      lineAmountCents: amount,
      height: Math.max(39, 17 + name.length * 11 + details.length * 9),
    };
  });
}

function summaryHeight(document: LoadedDocument) {
  const balanceRows = document.type === "customer_invoice" || document.type === "vendor_bill" ? 2 : 0;
  return Math.max(104, 45 + (document.charges.length + 3 + balanceRows) * 17);
}

function paginateDocument(document: LoadedDocument, lines: PreparedLine[]) {
  const pages: PdfDocumentPage[] = [{ lines: [], continuation: false, summary: false }];
  let current = pages[0];
  let remaining = 512 - 78;
  for (const line of lines) {
    if (line.height > remaining && current.lines.length) {
      current = { lines: [], continuation: true, summary: false };
      pages.push(current);
      remaining = 672 - 78;
    }
    current.lines.push(line);
    remaining -= line.height;
  }
  if (summaryHeight(document) > remaining) {
    current = { lines: [], continuation: true, summary: true };
    pages.push(current);
  } else current.summary = true;
  return pages;
}

function drawDocumentHeader(commands: string[], document: LoadedDocument, companyName: string, continuation: boolean) {
  const title = titleFor(document.type);
  if (continuation) {
    pdfRect(commands, PDF.margin, 756, 7, 32, PDF.accent);
    pdfText(commands, companyName.toUpperCase(), 61, 744, { size: 13, bold: true, maxWidth: 250 });
    pdfText(commands, `${title}  ${document.header.number}`, 568, 744, { size: 10, bold: true, color: PDF.accent, align: "right", maxWidth: 235 });
    pdfText(commands, "CONTINUED", 568, 727, { size: 7.5, bold: true, color: PDF.muted, align: "right" });
    pdfLine(commands, PDF.margin, 714, 568, 714, PDF.accent, 1.2);
    return 698;
  }

  pdfRect(commands, PDF.margin, 756, 9, 47, PDF.accent);
  pdfText(commands, companyName.toUpperCase(), 62, 744, { size: 16, bold: true, maxWidth: 275 });
  pdfText(commands, "PANEFLOW OPERATIONS", 62, 727, { size: 7.5, bold: true, color: PDF.muted });
  pdfText(commands, title, 568, 739, { size: 20, bold: true, align: "right", maxWidth: 225 });
  pdfText(commands, document.header.number, 568, 716, { size: 11, bold: true, color: PDF.accent, align: "right", maxWidth: 225 });
  pdfLine(commands, PDF.margin, 696, 568, 696, PDF.accent, 1.4);

  pdfText(commands, partyLabel(document.type), 54, 675, { size: 7.5, bold: true, color: PDF.accent });
  pdfRect(commands, PDF.margin, 664, 252, 105, PDF.wash, PDF.rule);
  const party = addressLines(document.header);
  party.slice(0, 7).forEach((value, index) => pdfText(commands, value, 55, 644 - index * 13, { size: index === 0 ? 10 : 8.2, bold: index === 0, color: index === 0 ? PDF.ink : PDF.muted, maxWidth: 230 }));

  const status = cleanPdfText(document.header.status).replaceAll("_", " ").toUpperCase();
  pdfText(commands, "DOCUMENT DETAILS", 330, 675, { size: 7.5, bold: true, color: PDF.accent });
  const badgeWidth = Math.max(54, estimateTextWidth(status, 7.5) + 18);
  pdfRect(commands, 568 - badgeWidth, 683, badgeWidth, 19, PDF.accentSoft);
  pdfText(commands, status, 559, 670, { size: 7.5, bold: true, color: PDF.accent, align: "right", maxWidth: badgeWidth - 18 });
  const metadata = metadataRows(document.type, document.header);
  metadata.forEach(([label, value], index) => {
    const y = 649 - index * 14;
    pdfText(commands, label.toUpperCase(), 330, y, { size: 7.1, bold: true, color: PDF.muted, maxWidth: 82 });
    pdfText(commands, value, 568, y, { size: 8.5, align: "right", maxWidth: 148 });
  });
  return 540;
}

function drawTableHeader(commands: string[], top: number) {
  const [x0, x1, x2, x3, x4, x5] = PDF.tableColumns;
  pdfRect(commands, x0, top, x5 - x0, 26, PDF.ink);
  pdfText(commands, "ITEM / DESCRIPTION", x0 + 8, top - 17, { size: 7.4, bold: true, color: PDF.white });
  pdfText(commands, "QTY", x2 - 8, top - 17, { size: 7.4, bold: true, color: PDF.white, align: "right" });
  pdfText(commands, "UNIT PRICE", x3 - 8, top - 17, { size: 7.4, bold: true, color: PDF.white, align: "right" });
  pdfText(commands, "TAX", x4 - 8, top - 17, { size: 7.4, bold: true, color: PDF.white, align: "right" });
  pdfText(commands, "AMOUNT", x5 - 8, top - 17, { size: 7.4, bold: true, color: PDF.white, align: "right" });
  [x1, x2, x3, x4].forEach((x) => pdfLine(commands, x, top - 26, x, top, [0.25, 0.37, 0.34], 0.45));
  return top - 26;
}

function drawPreparedLine(commands: string[], line: PreparedLine, top: number) {
  const [x0, x1, x2, x3, x4, x5] = PDF.tableColumns;
  if (line.index % 2 === 0) pdfRect(commands, x0, top, x5 - x0, line.height, PDF.wash);
  pdfText(commands, String(line.index), x0 + 8, top - 16, { size: 8, bold: true, color: PDF.accent });
  line.name.forEach((value, index) => pdfText(commands, value, x0 + 27, top - 16 - index * 11, { size: 9.2, bold: true, maxWidth: x1 - x0 - 36 }));
  let detailY = top - 16 - line.name.length * 11;
  line.details.forEach((value) => { pdfText(commands, value, x0 + 27, detailY, { size: 7.8, color: PDF.muted, maxWidth: x1 - x0 - 36 }); detailY -= 9; });
  pdfText(commands, line.quantity, x2 - 8, top - 16, { size: 8.4, align: "right", maxWidth: x2 - x1 - 12 });
  pdfText(commands, line.unitAmount, x3 - 8, top - 16, { size: 8.4, align: "right", maxWidth: x3 - x2 - 12 });
  pdfText(commands, line.tax, x4 - 8, top - 16, { size: 8.4, align: "right", maxWidth: x4 - x3 - 12 });
  pdfText(commands, line.lineAmount, x5 - 8, top - 16, { size: 8.4, bold: true, align: "right", maxWidth: x5 - x4 - 12 });
  pdfLine(commands, x0, top - line.height, x5, top - line.height);
  [x1, x2, x3, x4].forEach((x) => pdfLine(commands, x, top - line.height, x, top, PDF.rule, 0.45));
  return top - line.height;
}

function prepareWorkOrderLines(document: LoadedDocument): PreparedWorkOrderLine[] {
  return document.lines.map((line, index) => {
    const title = wrapPdfText(line.productName, 300, 9.5, 2);
    const details = wrapPdfText(printableDescription(line.description), 300, 7.8, 5);
    const hoursValue = Math.max(Number(line.quantity) || 0, 0);
    return {
      index: index + 1,
      title,
      details,
      status: cleanPdfText(line.binLocationCode || "open").replaceAll("_", " ").toUpperCase(),
      hours: `${hoursValue.toLocaleString("en-CA", { minimumFractionDigits: hoursValue ? 2 : 0, maximumFractionDigits: 2 })} h`,
      hoursValue,
      height: Math.max(42, 20 + title.length * 11 + details.length * 9),
    };
  });
}

function paginateWorkOrder(lines: PreparedWorkOrderLine[]) {
  const pages: PdfWorkOrderPage[] = [{ lines: [], continuation: false, summary: false }];
  let current = pages[0];
  let remaining = 464;
  for (const line of lines) {
    if (line.height > remaining && current.lines.length) {
      current = { lines: [], continuation: true, summary: false };
      pages.push(current);
      remaining = 622;
    }
    current.lines.push(line);
    remaining -= line.height;
  }
  if (remaining < 128) {
    current = { lines: [], continuation: true, summary: true };
    pages.push(current);
  } else current.summary = true;
  return pages;
}

function drawWorkOrderTableHeader(commands: string[], top: number) {
  const [x0, x1, x2, x3] = [44, 400, 478, 568];
  pdfRect(commands, x0, top, x3 - x0, 26, PDF.ink);
  pdfText(commands, "LABOUR ITEM / DETAILS", x0 + 8, top - 17, { size: 7.4, bold: true, color: PDF.white });
  pdfText(commands, "STATUS", x2 - 8, top - 17, { size: 7.4, bold: true, color: PDF.white, align: "right" });
  pdfText(commands, "RECORDED TIME", x3 - 8, top - 17, { size: 7.4, bold: true, color: PDF.white, align: "right" });
  [x1, x2].forEach((x) => pdfLine(commands, x, top - 26, x, top, [0.25, 0.37, 0.34], 0.45));
  return top - 26;
}

function drawWorkOrderLine(commands: string[], line: PreparedWorkOrderLine, top: number) {
  const [x0, x1, x2, x3] = [44, 400, 478, 568];
  if (line.index % 2 === 0) pdfRect(commands, x0, top, x3 - x0, line.height, PDF.wash);
  pdfText(commands, String(line.index), x0 + 8, top - 16, { size: 8, bold: true, color: PDF.accent });
  line.title.forEach((value, index) => pdfText(commands, value, x0 + 27, top - 16 - index * 11, { size: 9.2, bold: true, maxWidth: x1 - x0 - 36 }));
  let detailY = top - 16 - line.title.length * 11;
  line.details.forEach((value) => { pdfText(commands, value, x0 + 27, detailY, { size: 7.8, color: PDF.muted, maxWidth: x1 - x0 - 36 }); detailY -= 9; });
  pdfText(commands, line.status, x2 - 8, top - 16, { size: 7.7, bold: true, color: PDF.accent, align: "right", maxWidth: x2 - x1 - 12 });
  pdfText(commands, line.hours, x3 - 8, top - 16, { size: 8.7, bold: true, align: "right", maxWidth: x3 - x2 - 12 });
  pdfLine(commands, x0, top - line.height, x3, top - line.height);
  [x1, x2].forEach((x) => pdfLine(commands, x, top - line.height, x, top, PDF.rule, 0.45));
  return top - line.height;
}

function drawWorkOrderSummary(commands: string[], document: LoadedDocument, lines: PreparedWorkOrderLine[], top: number, senderEmail?: string) {
  pdfText(commands, "WORK ORDER NOTES", PDF.margin, top, { size: 7.5, bold: true, color: PDF.accent });
  const note = [document.header.notes, documentNote(document.type, document.header.number)].filter(Boolean).join(" - ");
  const noteLines = wrapPdfText(note, 330, 8, 6);
  noteLines.forEach((value, index) => pdfText(commands, value, PDF.margin, top - 18 - index * 11, { size: 8, color: PDF.muted, maxWidth: 330 }));

  pdfRect(commands, 400, top + 7, 168, 76, PDF.accentSoft, PDF.rule);
  pdfText(commands, "TOTAL RECORDED TIME", 554, top - 14, { size: 7.2, bold: true, color: PDF.accent, align: "right" });
  const totalHours = lines.reduce((sum, line) => sum + line.hoursValue, 0);
  pdfText(commands, `${totalHours.toLocaleString("en-CA", { minimumFractionDigits: totalHours ? 2 : 0, maximumFractionDigits: 2 })} hours`, 554, top - 42, { size: 17, bold: true, align: "right" });
  if (senderEmail) pdfText(commands, `Sent by ${senderEmail}`, 568, top - 91, { size: 7, color: PDF.muted, align: "right", maxWidth: 230 });
}

function renderWorkOrderPdf(document: LoadedDocument, senderEmail?: string) {
  const companyName = currentTenant()?.tenantName || "PaneFlow";
  const preparedLines = prepareWorkOrderLines(document);
  const pageLayout = paginateWorkOrder(preparedLines);
  return buildPdf(pageLayout.map((page, pageIndex) => {
    const commands: string[] = [];
    const tableTop = drawDocumentHeader(commands, document, companyName, page.continuation);
    let y = drawWorkOrderTableHeader(commands, tableTop);
    for (const line of page.lines) y = drawWorkOrderLine(commands, line, y);
    if (page.summary) drawWorkOrderSummary(commands, document, preparedLines, y - 18, senderEmail);
    pdfLine(commands, PDF.margin, 37, 568, 37, PDF.rule, 0.6);
    pdfText(commands, `Generated ${new Date().toISOString().slice(0, 10)}`, PDF.margin, 23, { size: 7, color: PDF.muted });
    pdfText(commands, `Page ${pageIndex + 1} of ${pageLayout.length}`, 568, 23, { size: 7, color: PDF.muted, align: "right" });
    return commands;
  }), `WORK-ORDER-${document.header.number}`);
}

function summaryRows(document: LoadedDocument) {
  const itemSubtotal = document.lines.reduce((sum, line) => sum + lineAmount(line), 0);
  const computedTax = document.lines.reduce((sum, line) => sum + lineTax(line, lineAmount(line)), 0)
    + document.charges.reduce((sum, charge) => sum + (charge.direction === "subtract" ? -1 : 1) * Math.abs(Number(charge.taxAmountCents)), 0);
  const rows: Array<{ label: string; amount: number; total?: boolean; muted?: boolean }> = [
    { label: "Items subtotal", amount: itemSubtotal },
    ...document.charges.map((charge) => ({ label: charge.description, amount: (charge.direction === "subtract" ? -1 : 1) * Number(charge.amountCents) })),
    { label: "Tax", amount: document.header.taxCents ?? computedTax },
    { label: "Total", amount: Number(document.header.totalCents), total: true },
  ];
  if (document.type === "customer_invoice" || document.type === "vendor_bill") {
    const paid = Number(document.header.paidCents ?? 0) + Number(document.header.creditedCents ?? 0);
    rows.push({ label: "Payments / credits", amount: -paid, muted: true });
    rows.push({ label: "Balance due", amount: Math.max(Number(document.header.totalCents) - paid, 0), total: true });
  }
  return rows;
}

function drawSummary(commands: string[], document: LoadedDocument, top: number, companyName: string, senderEmail?: string) {
  const leftWidth = 292;
  pdfText(commands, "TERMS & NOTES", PDF.margin, top - 4, { size: 7.5, bold: true, color: PDF.accent });
  const noteText = [document.header.notes, documentNote(document.type, document.header.number)].filter(Boolean).join(" · ");
  const noteLines = wrapPdfText(noteText, leftWidth, 8.5, 4);
  noteLines.forEach((line, index) => pdfText(commands, line, PDF.margin, top - 21 - index * 11, { size: 8.5, color: PDF.muted }));
  if (senderEmail) pdfText(commands, `Sent by ${senderEmail}`, PDF.margin, top - 76, { size: 7.5, color: PDF.muted, maxWidth: leftWidth });

  const rows = summaryRows(document);
  let y = top;
  for (const row of rows) {
    const height = row.total ? 25 : 17;
    if (row.total) pdfRect(commands, 374, y, 194, height, PDF.accentSoft);
    pdfText(commands, row.label.toUpperCase(), 384, y - (row.total ? 17 : 12), { size: row.total ? 8.2 : 7.5, bold: row.total, color: row.muted ? PDF.muted : row.total ? PDF.accent : PDF.ink, maxWidth: 126 });
    pdfText(commands, money(row.amount, document.header.currency), 558, y - (row.total ? 17 : 12), { size: row.total ? 10 : 8.5, bold: row.total, color: row.muted ? PDF.muted : row.total ? PDF.accent : PDF.ink, align: "right", maxWidth: 76 });
    y -= height;
  }
  pdfText(commands, `${companyName} | ${document.header.currency}`, PDF.margin, 47, { size: 7.2, color: PDF.muted, maxWidth: 260 });
}

function renderDocumentPdf(document: LoadedDocument, senderEmail?: string) {
  if (document.type === "work_order") return renderWorkOrderPdf(document, senderEmail);
  const companyName = currentTenant()?.tenantName || "PaneFlow";
  const preparedLines = prepareLines(document);
  const pageLayout = paginateDocument(document, preparedLines);
  const pages = pageLayout.map((page, pageIndex) => {
    const commands: string[] = [];
    const tableTop = drawDocumentHeader(commands, document, companyName, page.continuation);
    let y = drawTableHeader(commands, tableTop);
    for (const line of page.lines) y = drawPreparedLine(commands, line, y);
    if (page.summary) drawSummary(commands, document, y - 18, companyName, senderEmail);
    pdfLine(commands, PDF.margin, 37, 568, 37, PDF.rule, 0.6);
    pdfText(commands, `Generated ${new Date().toISOString().slice(0, 10)}`, PDF.margin, 23, { size: 7, color: PDF.muted });
    pdfText(commands, `Page ${pageIndex + 1} of ${pageLayout.length}`, 568, 23, { size: 7, color: PDF.muted, align: "right" });
    return commands;
  });
  return buildPdf(pages, `${titleFor(document.type)}-${document.header.number}`);
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
