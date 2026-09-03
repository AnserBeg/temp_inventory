import type { ParsedPlyGemCostSheet } from "../domain/ply-gem-cost-sheet";
import { automaticPlyGemProductMatch, type PlyGemCatalogProduct } from "../domain/ply-gem-product-match";
import { all, ensureDatabase, first } from "./inventory-db";

type VendorRow = { id: string; name: string; currency: string; paymentTerms: string | null };
type ExistingPurchaseOrder = { id: string; number: string; status: string; sourceDocumentHash: string | null };

export class PlyGemImportPreviewError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

function documentError(document: ParsedPlyGemCostSheet) {
  if (!document.clientId?.trim() || !document.fileName?.trim()) return "The uploaded document is missing its client identifier or file name.";
  if (!/^\d{5,20}$/.test(document.quoteNumber ?? "")) return `${document.fileName}: quote number is invalid.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(document.scheduledDate ?? "")) return `${document.fileName}: scheduled date is invalid.`;
  if (!/^[a-f0-9]{64}$/i.test(document.sourceDocumentHash ?? "")) return `${document.fileName}: source document hash is invalid.`;
  if (!Array.isArray(document.lines) || document.lines.length < 1 || document.lines.length > 250) return `${document.fileName}: item line count is invalid.`;
  if (!Number.isSafeInteger(document.subtotalCents) || !Number.isSafeInteger(document.taxTotalCents) || !Number.isSafeInteger(document.totalCents)) return `${document.fileName}: totals must be whole cents.`;
  if (document.lines.some((line) => !line.sourceLineNumber?.trim() || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isSafeInteger(line.unitCostCents) || line.unitCostCents < 0 || !Number.isSafeInteger(line.lineTotalCents))) return `${document.fileName}: one or more item lines are invalid.`;
  const quantity = document.lines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = document.lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const charges = (document.charges ?? []).reduce((sum, charge) => sum + charge.amountCents, 0);
  if (quantity !== document.totalQuantity || subtotal !== document.subtotalCents || subtotal + charges + document.taxTotalCents !== document.totalCents) return `${document.fileName}: parsed lines do not reconcile to the supplied totals.`;
  if (document.lines.some((line) => Math.round(line.quantity * line.unitCostCents) !== line.lineTotalCents)) return `${document.fileName}: a quantity and unit cost do not reconcile to their source line total.`;
  return "";
}

function normalized(value: string) {
  return value.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
}

function chooseVendor(supplierName: string, vendors: VendorRow[]) {
  const supplier = normalized(supplierName);
  const direct = vendors.find((vendor) => normalized(vendor.name).includes(supplier) || supplier.includes(normalized(vendor.name)));
  if (direct) return { vendor: direct, warning: "" };
  if (supplier.includes("PLYGEM")) {
    const legacy = vendors.find((vendor) => normalized(vendor.name).includes("VINYLVISTA"));
    if (legacy) return { vendor: legacy, warning: `Ply Gem is mapped to the existing vendor ${legacy.name}.` };
  }
  return { vendor: null, warning: "Add or activate a Ply Gem vendor before importing these cost sheets." };
}

export async function previewPlyGemCostSheets(documents: ParsedPlyGemCostSheet[]) {
  if (!Array.isArray(documents) || documents.length < 1) throw new PlyGemImportPreviewError("DOCUMENTS_REQUIRED", "Select at least one Ply Gem PDF.");
  if (documents.length > 25) throw new PlyGemImportPreviewError("TOO_MANY_DOCUMENTS", "Import up to 25 PDFs in one batch.");
  await ensureDatabase();
  const [products, vendors] = await Promise.all([
    all<PlyGemCatalogProduct>(`SELECT id,sku,manufacturer_sku AS manufacturerSku,name,category,material,dimensions,finish
      FROM products WHERE active=1 ORDER BY sku`),
    all<VendorRow>(`SELECT id,name,currency,payment_terms AS paymentTerms FROM business_partners
      WHERE active=1 AND partner_type IN ('vendor','both') ORDER BY name`),
  ]);

  const previews = [];
  for (const document of documents) {
    const errors: string[] = [];
    const warnings = [...(Array.isArray(document.warnings) ? document.warnings : [])];
    const invalid = documentError(document);
    if (invalid) errors.push(invalid);
    const vendorChoice = chooseVendor(document.supplierName, vendors);
    if (vendorChoice.warning) (vendorChoice.vendor ? warnings : errors).push(vendorChoice.warning);
    const vendor = vendorChoice.vendor;
    const existing = vendor ? await first<ExistingPurchaseOrder>(`SELECT id,number,lifecycle_status AS status,source_document_hash AS sourceDocumentHash
      FROM purchase_orders WHERE (vendor_id=? AND supplier_quote_number=?) OR source_document_hash=? OR project_reference LIKE ?
      ORDER BY CASE WHEN lifecycle_status='draft' THEN 0 ELSE 1 END,created_at DESC LIMIT 1`, vendor.id, document.quoteNumber, document.sourceDocumentHash, `%Source quote ${document.quoteNumber}%`) : null;
    const lines = document.lines.map((line) => {
      const matched = automaticPlyGemProductMatch(document, line, products);
      if (!matched.product) errors.push(`Source line ${line.sourceLineNumber} (${line.productType}) does not have one unambiguous catalog match.`);
      return {
        ...line,
        productId: matched.product?.id ?? "",
        productSku: matched.product?.sku ?? "",
        productName: matched.product?.name ?? "",
        candidates: matched.candidates.map((candidate) => ({ id: candidate.id, sku: candidate.sku, name: candidate.name, score: candidate.score })),
      };
    });
    if (existing) warnings.push(`${existing.number} already uses Ply Gem quote ${document.quoteNumber}; this PDF will be skipped.`);
    previews.push({
      ...document,
      vendorId: vendor?.id ?? "",
      vendorName: vendor?.name ?? "",
      paymentTerms: vendor?.paymentTerms ?? "",
      vendorCurrency: vendor?.currency ?? "CAD",
      existingPurchaseOrder: existing ? { id: existing.id, number: existing.number, status: existing.status, sameFile: existing.sourceDocumentHash === document.sourceDocumentHash } : null,
      lines,
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
      canImport: errors.length === 0 && !existing,
    });
  }
  return { documents: previews };
}
