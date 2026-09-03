import { getD1 } from "./inventory-db";
import { sha256Hex } from "./qbo-crypto";
import type {
  QboAccountMapping,
  QboDelivery,
  QboEntityLink,
  QboMappedEntity,
  QboMappingContext,
  QboReferenceMapping,
} from "./qbo-types";

type Row = Record<string, unknown>;

export class QboMappingError extends Error {
  code: string;
  retryable: boolean;
  conflict: boolean;

  constructor(message: string, options: { code?: string; retryable?: boolean; conflict?: boolean } = {}) {
    super(message);
    this.name = "QboMappingError";
    this.code = options.code ?? "QBO_MAPPING_REQUIRED";
    this.retryable = options.retryable ?? false;
    this.conflict = options.conflict ?? true;
  }
}

const cents = (value: unknown) => Math.round(Number(value ?? 0)) / 100;
const text = (value: unknown) => value == null ? "" : String(value);
const limited = (value: unknown, length: number) => text(value).slice(0, length);
const dateOnly = (value: unknown) => text(value).slice(0, 10);
const optionalDate = (value: unknown) => text(value) ? dateOnly(value) : undefined;
const ref = (value: string, name?: string) => name ? { value, name } : { value };
const qboLinkKey = (entityType: string, localId: string, qboType?: string) => `${entityType}:${localId}:${qboType ?? ""}`;

function sourceMemo(entityType: string, id: string, extra?: string) {
  return limited(`PaneFlow ${entityType}:${id}${extra ? ` · ${extra}` : ""}`, 4000);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function mapped(qboEntityType: string, body: Record<string, unknown>, localVersion?: number | null): Promise<QboMappedEntity> {
  return { qboEntityType, body, localVersion, sourceHash: await sha256Hex(canonical(body)) };
}

async function rows(sql: string, ...bindings: unknown[]) {
  const result = await getD1().prepare(sql).bind(...bindings).all<Row>();
  return result.results;
}

async function row(sql: string, ...bindings: unknown[]) {
  return getD1().prepare(sql).bind(...bindings).first<Row>();
}

export async function buildQboMappingContext(connectionId: string): Promise<QboMappingContext> {
  const [accountRows, referenceRows, linkRows] = await Promise.all([
    rows(`SELECT logical_key AS logicalKey,qbo_account_id AS qboAccountId,qbo_account_name AS qboAccountName,
      qbo_account_type AS qboAccountType,active FROM qbo_account_mappings WHERE connection_id=?`, connectionId),
    rows(`SELECT mapping_type AS mappingType,local_value AS localValue,qbo_entity_id AS qboEntityId,
      qbo_entity_name AS qboEntityName,metadata_json AS metadataJson,active FROM qbo_reference_mappings WHERE connection_id=?`, connectionId),
    rows(`SELECT id,connection_id AS connectionId,local_entity_type AS localEntityType,local_entity_id AS localEntityId,
      qbo_entity_type AS qboEntityType,qbo_entity_id AS qboEntityId,qbo_sync_token AS qboSyncToken,local_version AS localVersion,
      source_hash AS sourceHash,qbo_last_updated_at AS qboLastUpdatedAt,status,last_synced_at AS lastSyncedAt,last_error AS lastError
      FROM qbo_entity_links WHERE connection_id=?`, connectionId),
  ]);
  const accounts = new Map<string, QboAccountMapping>();
  for (const item of accountRows as unknown as QboAccountMapping[]) if (item.active) accounts.set(item.logicalKey, item);
  const references = new Map<string, QboReferenceMapping>();
  for (const item of referenceRows as unknown as QboReferenceMapping[]) if (item.active) references.set(`${item.mappingType}:${item.localValue}`, item);
  const links = new Map<string, QboEntityLink>();
  for (const item of linkRows as unknown as QboEntityLink[]) links.set(qboLinkKey(item.localEntityType, item.localEntityId, item.qboEntityType), item);
  return { accounts, references, links };
}

function requiredAccount(context: QboMappingContext, key: string) {
  const mapping = context.accounts.get(key);
  if (!mapping) throw new QboMappingError(`Map the PaneFlow account role “${key}” to a QuickBooks account before this record can sync.`);
  return ref(mapping.qboAccountId, mapping.qboAccountName);
}

function canonicalTaxCode(value: unknown) {
  const normalized = text(value).trim().toUpperCase();
  return normalized === "ZERO" ? "ZERO" : normalized === "EXEMPT" ? "EXEMPT" : normalized;
}

function requiredReference(context: QboMappingContext, type: string, localValue: unknown) {
  const value = type === "tax_code" ? canonicalTaxCode(localValue) : text(localValue);
  const mapping = context.references.get(`${type}:${value}`);
  if (!mapping) throw new QboMappingError(`Map ${type.replaceAll("_", " ")} “${value || "(blank)"}” to QuickBooks before this record can sync.`);
  return ref(mapping.qboEntityId, mapping.qboEntityName);
}

function requiredLink(context: QboMappingContext, entityType: string, localId: unknown, qboType: string) {
  const id = text(localId);
  const link = context.links.get(qboLinkKey(entityType, id, qboType));
  if (!link || !["synced", "inactive"].includes(link.status)) {
    throw new QboMappingError(`QuickBooks dependency ${entityType}:${id} (${qboType}) has not synced yet.`, {
      code: "QBO_DEPENDENCY_PENDING", retryable: true, conflict: false,
    });
  }
  return ref(link.qboEntityId);
}

function address(source: Row) {
  const line1 = text(source.addressLine1);
  if (!line1 && !source.city && !source.postalCode) return undefined;
  return {
    Line1: limited(line1, 500), Line2: limited(source.addressLine2, 500), City: limited(source.city, 255),
    CountrySubDivisionCode: limited(source.region, 255), PostalCode: limited(source.postalCode, 30), Country: limited(source.country || "CA", 255),
  };
}

function currencyFields(currency: unknown, exchangeRate: unknown) {
  const code = text(currency || "CAD");
  return code && code !== "CAD" ? { CurrencyRef: ref(code), ExchangeRate: Number(exchangeRate || 1) } : {};
}

function taxCodeFor(context: QboMappingContext, localValue: unknown, taxable?: unknown) {
  return requiredReference(context, "tax_code", localValue || (taxable ? "GST" : "EXEMPT"));
}

function isCreditCardMethod(value: unknown) {
  return /\b(credit|card|visa|mastercard|master card|amex|american express)\b/iu.test(text(value).replaceAll("_", " "));
}

function customerDepositAccount(method: unknown) {
  return text(method).toLowerCase().startsWith("helcim_") ? "helcim_clearing" : "cash";
}

function customerPaymentType(value: unknown) {
  const method = text(value).trim().toLowerCase();
  if (isCreditCardMethod(method)) return "CreditCard";
  if (/\b(cheque|check)\b/u.test(method)) return "Check";
  if (/\bcash\b/u.test(method)) return "Cash";
  return "Other";
}

function vendorPaymentInstrument(context: QboMappingContext, value: unknown) {
  if (isCreditCardMethod(value)) {
    return { PayType: "CreditCard", CreditCardPayment: { CCAccountRef: requiredAccount(context, "credit_card") } };
  }
  return { PayType: "Check", CheckPayment: { BankAccountRef: requiredAccount(context, "cash") } };
}

async function partnerBody(delivery: QboDelivery, context: QboMappingContext, kind: "Customer" | "Vendor") {
  const partner = await row(`SELECT id,code,name,partner_type AS partnerType,email,phone,address_line_1 AS addressLine1,address_line_2 AS addressLine2,
    city,region,postal_code AS postalCode,country,payment_terms AS paymentTerms,currency,credit_limit_cents AS creditLimitCents,
    credit_hold AS creditHold,active,version FROM business_partners WHERE id=?`, delivery.localEntityId);
  if (!partner) throw new QboMappingError(`Business partner ${delivery.localEntityId} no longer exists.`, { code: "QBO_SOURCE_MISSING" });
  const isCustomer = ["customer", "both"].includes(text(partner.partnerType).toLowerCase());
  const isVendor = ["vendor", "both", "supplier"].includes(text(partner.partnerType).toLowerCase());
  if ((kind === "Customer" && !isCustomer) || (kind === "Vendor" && !isVendor)) {
    throw new QboMappingError(`Business partner ${text(partner.code)} is not a ${kind.toLowerCase()}.`, { code: "QBO_ENTITY_NOT_APPLICABLE" });
  }
  const sharedRole = text(partner.partnerType).toLowerCase() === "both";
  const displayName = sharedRole ? `${kind === "Customer" ? "C" : "V"} · ${partner.name} · ${partner.code}` : `${partner.name} · ${partner.code}`;
  const body: Record<string, unknown> = {
    DisplayName: limited(displayName, 100),
    CompanyName: limited(partner.name, 100),
    PrimaryEmailAddr: partner.email ? { Address: limited(partner.email, 100) } : undefined,
    PrimaryPhone: partner.phone ? { FreeFormNumber: limited(partner.phone, 30) } : undefined,
    BillAddr: address(partner),
    Active: Boolean(partner.active),
    CurrencyRef: text(partner.currency) !== "CAD" ? ref(text(partner.currency)) : undefined,
    Notes: sourceMemo("business_partner", text(partner.id), `${text(partner.code)}${partner.creditHold ? " · credit hold in PaneFlow" : ""}`),
    CreditLimit: kind === "Customer" && Number(partner.creditLimitCents) > 0 ? cents(partner.creditLimitCents) : undefined,
    ...(kind === "Customer"
      ? { SalesTermRef: partner.paymentTerms ? requiredReference(context, "term", partner.paymentTerms) : undefined }
      : { TermRef: partner.paymentTerms ? requiredReference(context, "term", partner.paymentTerms) : undefined }),
  };
  return mapped(kind, body, Number(partner.version));
}

async function productBody(delivery: QboDelivery, context: QboMappingContext) {
  const product = await row(`SELECT id,sku,manufacturer_sku AS manufacturerSku,name,category,material,dimensions,finish,
    standard_cost_cents AS standardCostCents,selling_price_cents AS sellingPriceCents,active,version FROM products WHERE id=?`, delivery.localEntityId);
  if (!product) throw new QboMappingError(`Product ${delivery.localEntityId} no longer exists.`, { code: "QBO_SOURCE_MISSING" });
  return mapped("Item", {
    Name: limited(`${product.sku} · ${product.name}`, 100),
    Sku: limited(product.sku, 100),
    Type: "NonInventory",
    Description: limited([product.category, product.material, product.dimensions, product.finish].filter(Boolean).join(" · "), 4000),
    UnitPrice: cents(product.sellingPriceCents),
    PurchaseCost: cents(product.standardCostCents),
    IncomeAccountRef: requiredAccount(context, "sales_revenue"),
    ExpenseAccountRef: requiredAccount(context, "inventory_clearing"),
    Active: Boolean(product.active),
  }, Number(product.version));
}

const specialItems: Record<string, { name: string; description: string; income: string; expense: string }> = {
  "sales-charge": { name: "PaneFlow sales charges", description: "Freight, handling, service fees, and other sales charges from PaneFlow.", income: "distribution_fees_revenue", expense: "inventory_clearing" },
  "sales-discount": { name: "PaneFlow sales discounts", description: "Invoice discounts and deductions from PaneFlow.", income: "sales_revenue", expense: "inventory_clearing" },
  "sales-credit": { name: "PaneFlow sales returns and credits", description: "Customer credits from PaneFlow.", income: "sales_returns", expense: "inventory_clearing" },
  "purchase-charge": { name: "PaneFlow purchase charges", description: "Freight, handling, and other vendor-bill charges from PaneFlow.", income: "purchase_returns", expense: "inventory_clearing" },
  "landed-cost-charge": { name: "PaneFlow landed-cost charges", description: "Freight, fuel, handling, customs, and brokerage awaiting landed-cost allocation.", income: "purchase_returns", expense: "landed_cost_accrual" },
};

const landedCostChargeTypes = new Set(["freight", "fuel_surcharge", "handling", "customs", "brokerage"]);

async function specialItemBody(delivery: QboDelivery, context: QboMappingContext) {
  const definition = specialItems[delivery.localEntityId];
  if (!definition) throw new QboMappingError(`Unknown QBO helper item ${delivery.localEntityId}.`, { code: "QBO_SOURCE_MISSING" });
  return mapped("Item", {
    Name: definition.name,
    Type: "NonInventory",
    Description: definition.description,
    IncomeAccountRef: requiredAccount(context, definition.income),
    ExpenseAccountRef: requiredAccount(context, definition.expense),
    Active: true,
  }, 1);
}

async function purchaseOrderBody(delivery: QboDelivery, context: QboMappingContext) {
  const order = await row(`SELECT id,number,vendor_id AS vendorId,lifecycle_status AS lifecycleStatus,expected_date AS expectedDate,currency,created_at AS createdAt,
    exchange_rate_to_base AS exchangeRate,payment_terms AS paymentTerms,due_date AS dueDate,total_cents AS totalCents,buyer_name AS buyerName,
    project_reference AS projectReference,revision_number AS revisionNumber,version FROM purchase_orders WHERE id=?`, delivery.localEntityId);
  if (!order) throw new QboMappingError(`Purchase order ${delivery.localEntityId} no longer exists.`, { code: "QBO_SOURCE_MISSING" });
  if (["draft", "pending_approval", "rejected"].includes(text(order.lifecycleStatus))) {
    throw new QboMappingError("Only approved purchase-order commitments are sent to QuickBooks.", { code: "QBO_ENTITY_NOT_APPLICABLE", conflict: false });
  }
  const lineRows = await rows(`SELECT pol.id,pol.product_id AS productId,pol.ordered_qty AS quantity,pol.unit_cost_cents AS unitCostCents,
    pol.discount_cents AS discountCents,pol.taxable,pol.tax_code AS taxCode,pol.tax_rate_bps AS taxRateBps,p.sku,p.name
    FROM purchase_order_lines pol JOIN products p ON p.id=pol.product_id WHERE pol.purchase_order_id=? ORDER BY pol.id`, delivery.localEntityId);
  const chargeRows = await charges("purchase_order", delivery.localEntityId);
  const lines: Record<string, unknown>[] = lineRows.map((line) => {
    const netCents = Math.max(0, Math.round(Number(line.quantity) * Number(line.unitCostCents)) - Number(line.discountCents || 0));
    return {
    Amount: cents(netCents),
    Description: limited(`${line.sku} · ${line.name} · PaneFlow line ${line.id}${Number(line.discountCents) ? ` · discount ${cents(line.discountCents)}` : ""}`, 4000),
    DetailType: "ItemBasedExpenseLineDetail",
    ItemBasedExpenseLineDetail: {
      ItemRef: requiredLink(context, "product", line.productId, "Item"), Qty: Math.abs(Number(line.quantity)),
      UnitPrice: Math.abs(Number(line.quantity)) ? cents(netCents) / Math.abs(Number(line.quantity)) : cents(line.unitCostCents), TaxCodeRef: taxCodeFor(context, line.taxCode, line.taxable),
    },
  }; });
  if (chargeRows.length) {
    const purchaseCharge = requiredLink(context, "qbo_special_item", "purchase-charge", "Item");
    for (const charge of chargeRows) lines.push({
      Amount: text(charge.direction) === "subtract" ? -cents(charge.amountCents) : cents(charge.amountCents), Description: limited(charge.description, 4000), DetailType: "ItemBasedExpenseLineDetail",
      ItemBasedExpenseLineDetail: { ItemRef: purchaseCharge, Qty: 1, UnitPrice: text(charge.direction) === "subtract" ? -cents(charge.amountCents) : cents(charge.amountCents), TaxCodeRef: taxCodeFor(context, charge.taxCode, charge.taxable) },
    });
  }
  const taxCents = lineRows.reduce((sum, line) => sum + (line.taxable ? Math.round(Math.max(0, Math.round(Number(line.quantity) * Number(line.unitCostCents)) - Number(line.discountCents || 0)) * Number(line.taxRateBps) / 10_000) : 0), 0)
    + chargeRows.reduce((sum, charge) => sum + Number(charge.taxAmountCents || 0) * (text(charge.direction) === "subtract" ? -1 : 1), 0);
  const headerTaxValue = lineRows.find((line) => Boolean(line.taxable))?.taxCode ?? chargeRows.find((charge) => Boolean(charge.taxable))?.taxCode ?? "EXEMPT";
  const headerTaxCode = taxCodeFor(context, headerTaxValue, taxCents > 0);
  return mapped("PurchaseOrder", {
    DocNumber: limited(order.number, 21), TxnDate: dateOnly(order.createdAt || new Date().toISOString()),
    VendorRef: requiredLink(context, "business_partner_vendor", order.vendorId, "Vendor"),
    DueDate: optionalDate(order.dueDate), ExpectedDate: optionalDate(order.expectedDate), APAccountRef: requiredAccount(context, "accounts_payable"),
    Line: lines, PrivateNote: sourceMemo("purchase_order", text(order.id), [`revision ${order.revisionNumber}`, order.projectReference, order.buyerName].filter(Boolean).join(" · ")),
    SalesTermRef: order.paymentTerms ? requiredReference(context, "term", order.paymentTerms) : undefined,
    GlobalTaxCalculation: taxCents ? "TaxExcluded" : "NotApplicable", TxnTaxDetail: { TxnTaxCodeRef: headerTaxCode, TotalTax: cents(taxCents) },
    POStatus: ["canceled", "completed", "closed"].includes(text(order.lifecycleStatus)) ? "Closed" : "Open",
    ...currencyFields(order.currency, order.exchangeRate),
  }, Number(order.version));
}

async function charges(documentType: string, documentId: string) {
  return rows(`SELECT id,charge_type AS chargeType,description,amount_cents AS amountCents,direction,taxable,tax_code AS taxCode,
    tax_rate_bps AS taxRateBps,tax_amount_cents AS taxAmountCents FROM document_charges WHERE document_type=? AND document_id=? ORDER BY id`, documentType, documentId);
}

async function invoiceBody(delivery: QboDelivery, context: QboMappingContext) {
  const invoice = await row(`SELECT id,number,customer_id AS customerId,sales_order_id AS salesOrderId,status,invoice_date AS invoiceDate,due_date AS dueDate,
    subtotal_cents AS subtotalCents,tax_cents AS taxCents,total_cents AS totalCents,paid_cents AS paidCents,currency,
    exchange_rate_to_base AS exchangeRate,tax_code AS taxCode,payment_terms AS paymentTerms,version FROM customer_invoices WHERE id=?`, delivery.localEntityId);
  if (!invoice) throw new QboMappingError(`Customer invoice ${delivery.localEntityId} no longer exists.`, { code: "QBO_SOURCE_MISSING" });
  const [lineRows, chargeRows] = await Promise.all([
    rows(`SELECT cil.id,cil.product_id AS productId,cil.quantity,cil.unit_price_cents AS unitPriceCents,cil.line_total_cents AS lineTotalCents,
      p.sku,p.name,sol.taxable,COALESCE(sol.tax_code,CASE WHEN sol.taxable=1 THEN 'GST' ELSE 'EXEMPT' END) AS taxCode
      FROM customer_invoice_lines cil JOIN products p ON p.id=cil.product_id JOIN customer_invoices ci ON ci.id=cil.customer_invoice_id
      LEFT JOIN sales_order_lines sol ON sol.id=cil.sales_order_line_id WHERE cil.customer_invoice_id=? ORDER BY cil.id`, delivery.localEntityId),
    charges("customer_invoice", delivery.localEntityId),
  ]);
  const lines: Record<string, unknown>[] = lineRows.map((line) => ({
    Amount: cents(line.lineTotalCents), Description: limited(`${line.sku} · ${line.name} · PaneFlow line ${line.id}`, 4000), DetailType: "SalesItemLineDetail",
    SalesItemLineDetail: {
      ItemRef: requiredLink(context, "product", line.productId, "Item"), Qty: Math.abs(Number(line.quantity)),
      UnitPrice: Math.abs(Number(line.quantity)) ? cents(line.lineTotalCents) / Math.abs(Number(line.quantity)) : cents(line.unitPriceCents),
      TaxCodeRef: taxCodeFor(context, line.taxCode, line.taxable),
    },
  }));
  const salesCharge = requiredLink(context, "qbo_special_item", "sales-charge", "Item");
  const salesDiscount = requiredLink(context, "qbo_special_item", "sales-discount", "Item");
  for (const charge of chargeRows) {
    const subtract = text(charge.direction) === "subtract";
    lines.push({
      Amount: subtract ? -cents(charge.amountCents) : cents(charge.amountCents), Description: limited(charge.description, 4000), DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: { ItemRef: subtract ? salesDiscount : salesCharge, Qty: 1, UnitPrice: subtract ? -cents(charge.amountCents) : cents(charge.amountCents), TaxCodeRef: taxCodeFor(context, charge.taxCode || invoice.taxCode, charge.taxable) },
    });
  }
  const computedSubtotal = Math.round(lines.reduce((sum, line) => sum + Number(line.Amount || 0), 0) * 100);
  const delta = Number(invoice.subtotalCents) - computedSubtotal;
  if (delta) lines.push({ Amount: cents(delta), Description: "PaneFlow exact-subtotal adjustment", DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: delta < 0 ? salesDiscount : salesCharge, Qty: 1, UnitPrice: cents(delta), TaxCodeRef: taxCodeFor(context, "EXEMPT", false) } });
  const term = invoice.paymentTerms ? requiredReference(context, "term", invoice.paymentTerms) : undefined;
  const headerTaxValue = canonicalTaxCode(invoice.taxCode) === "MIXED"
    ? lineRows.find((line) => Boolean(line.taxable))?.taxCode ?? "GST"
    : invoice.taxCode || (Number(invoice.taxCents) ? "GST" : "EXEMPT");
  const taxCode = taxCodeFor(context, headerTaxValue, Number(invoice.taxCents) > 0);
  return mapped("Invoice", {
    DocNumber: limited(invoice.number, 21), TxnDate: dateOnly(invoice.invoiceDate), DueDate: dateOnly(invoice.dueDate),
    CustomerRef: requiredLink(context, "business_partner_customer", invoice.customerId, "Customer"), Line: lines,
    SalesTermRef: term, PrivateNote: sourceMemo("customer_invoice", text(invoice.id), invoice.salesOrderId ? `sales order ${invoice.salesOrderId}` : undefined),
    GlobalTaxCalculation: Number(invoice.taxCents) ? "TaxExcluded" : "NotApplicable", TxnTaxDetail: { TxnTaxCodeRef: taxCode, TotalTax: cents(invoice.taxCents) },
    ...currencyFields(invoice.currency, invoice.exchangeRate),
  }, Number(invoice.version));
}

async function vendorBillBody(delivery: QboDelivery, context: QboMappingContext) {
  const bill = await row(`SELECT id,number,vendor_id AS vendorId,purchase_order_id AS purchaseOrderId,status,total_cents AS totalCents,due_date AS dueDate,
    currency,vendor_invoice_number AS vendorInvoiceNumber,invoice_date AS invoiceDate,subtotal_cents AS subtotalCents,tax_cents AS taxCents,
    exchange_rate_to_base AS exchangeRate,tax_code AS taxCode,payment_terms AS paymentTerms,version FROM vendor_bills WHERE id=?`, delivery.localEntityId);
  if (!bill) throw new QboMappingError(`Vendor bill ${delivery.localEntityId} no longer exists.`, { code: "QBO_SOURCE_MISSING" });
  if (["draft", "on_hold", "void", "voided"].includes(text(bill.status))) {
    throw new QboMappingError("Only approved vendor bills are sent to QuickBooks.", { code: "QBO_ENTITY_NOT_APPLICABLE", conflict: false });
  }
  const [lineRows, chargeRows] = await Promise.all([
    rows(`SELECT vbl.id,vbl.product_id AS productId,vbl.quantity,vbl.unit_cost_cents AS unitCostCents,vbl.line_total_cents AS lineTotalCents,
      vbl.purchase_order_line_id AS purchaseOrderLineId,p.sku,p.name,pol.taxable,COALESCE(pol.tax_code,CASE WHEN ?<>0 THEN COALESCE(?,'GST') ELSE 'EXEMPT' END) AS taxCode
      FROM vendor_bill_lines vbl LEFT JOIN products p ON p.id=vbl.product_id LEFT JOIN purchase_order_lines pol ON pol.id=vbl.purchase_order_line_id
      WHERE vbl.vendor_bill_id=? ORDER BY vbl.id`, Number(bill.taxCents), bill.taxCode, delivery.localEntityId),
    charges("vendor_bill", delivery.localEntityId),
  ]);
  const purchaseOrderLink = bill.purchaseOrderId ? requiredLink(context, "purchase_order", bill.purchaseOrderId, "PurchaseOrder") : undefined;
  const lines: Record<string, unknown>[] = lineRows.map((line) => line.productId ? ({
    Amount: cents(line.lineTotalCents), Description: limited(`${line.sku || "Item"} · ${line.name || ""} · PaneFlow line ${line.id}`, 4000), DetailType: "ItemBasedExpenseLineDetail",
    LinkedTxn: purchaseOrderLink ? [{ TxnId: purchaseOrderLink.value, TxnType: "PurchaseOrder" }] : undefined,
    ItemBasedExpenseLineDetail: {
      ItemRef: requiredLink(context, "product", line.productId, "Item"), Qty: Math.abs(Number(line.quantity)),
      UnitPrice: Math.abs(Number(line.quantity)) ? cents(line.lineTotalCents) / Math.abs(Number(line.quantity)) : cents(line.unitCostCents),
      TaxCodeRef: taxCodeFor(context, line.taxCode, line.taxable),
    },
  }) : ({
    Amount: cents(line.lineTotalCents), Description: limited(`PaneFlow bill line ${line.id}`, 4000), DetailType: "AccountBasedExpenseLineDetail",
    LinkedTxn: purchaseOrderLink ? [{ TxnId: purchaseOrderLink.value, TxnType: "PurchaseOrder" }] : undefined,
    AccountBasedExpenseLineDetail: { AccountRef: requiredAccount(context, "inventory_clearing"), TaxCodeRef: taxCodeFor(context, line.taxCode, line.taxable) },
  }));
  const purchaseCharge = requiredLink(context, "qbo_special_item", "purchase-charge", "Item");
  const landedCostCharge = chargeRows.some((charge) => landedCostChargeTypes.has(text(charge.chargeType)))
    ? requiredLink(context, "qbo_special_item", "landed-cost-charge", "Item") : null;
  for (const charge of chargeRows) {
    const itemRef = landedCostChargeTypes.has(text(charge.chargeType)) ? landedCostCharge! : purchaseCharge;
    lines.push({
      Amount: text(charge.direction) === "subtract" ? -cents(charge.amountCents) : cents(charge.amountCents), Description: limited(charge.description, 4000), DetailType: "ItemBasedExpenseLineDetail",
      ItemBasedExpenseLineDetail: { ItemRef: itemRef, Qty: 1, UnitPrice: text(charge.direction) === "subtract" ? -cents(charge.amountCents) : cents(charge.amountCents), TaxCodeRef: taxCodeFor(context, charge.taxCode || bill.taxCode, charge.taxable) },
    });
  }
  const computedSubtotal = Math.round(lines.reduce((sum, line) => sum + Number(line.Amount || 0), 0) * 100);
  const delta = Number(bill.subtotalCents) - computedSubtotal;
  if (delta) lines.push({ Amount: cents(delta), Description: "PaneFlow exact-subtotal adjustment", DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: requiredAccount(context, "inventory_clearing"), TaxCodeRef: taxCodeFor(context, "EXEMPT", false) } });
  const taxCode = taxCodeFor(context, canonicalTaxCode(bill.taxCode) === "MIXED" ? lineRows.find((line) => Boolean(line.taxable))?.taxCode ?? "GST" : bill.taxCode || (Number(bill.taxCents) ? "GST" : "EXEMPT"), Number(bill.taxCents) > 0);
  return mapped("Bill", {
    DocNumber: limited(bill.vendorInvoiceNumber || bill.number, 21), TxnDate: dateOnly(bill.invoiceDate || new Date().toISOString()), DueDate: optionalDate(bill.dueDate),
    VendorRef: requiredLink(context, "business_partner_vendor", bill.vendorId, "Vendor"), APAccountRef: requiredAccount(context, "accounts_payable"), Line: lines,
    SalesTermRef: bill.paymentTerms ? requiredReference(context, "term", bill.paymentTerms) : undefined, PrivateNote: sourceMemo("vendor_bill", text(bill.id), bill.purchaseOrderId ? `purchase order ${bill.purchaseOrderId}` : undefined),
    GlobalTaxCalculation: Number(bill.taxCents) ? "TaxExcluded" : "NotApplicable", TxnTaxDetail: { TxnTaxCodeRef: taxCode, TotalTax: cents(bill.taxCents) },
    ...currencyFields(bill.currency, bill.exchangeRate),
  }, Number(bill.version));
}

async function creditBody(delivery: QboDelivery, context: QboMappingContext, kind: "customer" | "vendor") {
  const customer = kind === "customer";
  const credit = await row(customer
    ? `SELECT cc.id,cc.number,cc.customer_id AS partnerId,cc.customer_invoice_id AS documentId,cc.amount_cents AS amountCents,cc.reason,cc.status,
       cc.posted_at AS postedAt,cc.version,cc.currency,cc.exchange_rate_to_base AS exchangeRate,ci.subtotal_cents AS documentSubtotalCents,
       ci.tax_cents AS documentTaxCents,ci.total_cents AS documentTotalCents,ci.tax_code AS documentTaxCode
       FROM customer_credits cc LEFT JOIN customer_invoices ci ON ci.id=cc.customer_invoice_id WHERE cc.id=?`
    : `SELECT vc.id,vc.number,vc.vendor_id AS partnerId,vc.vendor_bill_id AS documentId,vc.amount_cents AS amountCents,vc.reason,vc.status,
       vc.posted_at AS postedAt,vc.version,vc.currency,vc.exchange_rate_to_base AS exchangeRate,vb.subtotal_cents AS documentSubtotalCents,
       vb.tax_cents AS documentTaxCents,vb.total_cents AS documentTotalCents,vb.tax_code AS documentTaxCode
       FROM vendor_credits vc LEFT JOIN vendor_bills vb ON vb.id=vc.vendor_bill_id WHERE vc.id=?`, delivery.localEntityId);
  if (!credit) throw new QboMappingError(`${customer ? "Customer" : "Vendor"} credit ${delivery.localEntityId} no longer exists.`, { code: "QBO_SOURCE_MISSING" });
  const documentTotal = Number(credit.documentTotalCents ?? 0);
  const taxAmountCents = documentTotal > 0 ? Math.round(Number(credit.amountCents) * Number(credit.documentTaxCents ?? 0) / documentTotal) : 0;
  const netAmountCents = Number(credit.amountCents) - taxAmountCents;
  const creditTaxCode = taxCodeFor(context, canonicalTaxCode(credit.documentTaxCode) === "MIXED" ? "GST" : credit.documentTaxCode || (taxAmountCents ? "GST" : "EXEMPT"), taxAmountCents > 0);
  if (customer) return mapped("CreditMemo", {
    DocNumber: limited(credit.number, 21), TxnDate: dateOnly(credit.postedAt), CustomerRef: requiredLink(context, "business_partner_customer", credit.partnerId, "Customer"),
    Line: [{ Amount: cents(netAmountCents), Description: limited(credit.reason, 4000), DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: requiredLink(context, "qbo_special_item", "sales-credit", "Item"), Qty: 1, UnitPrice: cents(netAmountCents), TaxCodeRef: creditTaxCode } }],
    GlobalTaxCalculation: taxAmountCents ? "TaxExcluded" : "NotApplicable", TxnTaxDetail: { TxnTaxCodeRef: creditTaxCode, TotalTax: cents(taxAmountCents) },
    PrivateNote: sourceMemo("customer_credit", text(credit.id), credit.documentId ? `invoice ${credit.documentId}` : undefined),
    ...currencyFields(credit.currency, credit.exchangeRate),
  }, Number(credit.version));
  return mapped("VendorCredit", {
    DocNumber: limited(credit.number, 21), TxnDate: dateOnly(credit.postedAt), VendorRef: requiredLink(context, "business_partner_vendor", credit.partnerId, "Vendor"),
    APAccountRef: requiredAccount(context, "accounts_payable"),
    Line: [{ Amount: cents(netAmountCents), Description: limited(credit.reason, 4000), DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: requiredAccount(context, "purchase_returns"), TaxCodeRef: creditTaxCode } }],
    GlobalTaxCalculation: taxAmountCents ? "TaxExcluded" : "NotApplicable", TxnTaxDetail: { TxnTaxCodeRef: creditTaxCode, TotalTax: cents(taxAmountCents) },
    PrivateNote: sourceMemo("vendor_credit", text(credit.id), credit.documentId ? `bill ${credit.documentId}` : undefined),
    ...currencyFields(credit.currency, credit.exchangeRate),
  }, Number(credit.version));
}

function journalLines(debitAccount: ReturnType<typeof ref>, creditAccount: ReturnType<typeof ref>, amount: number, description: string) {
  return [
    { Amount: amount, Description: limited(description, 4000), DetailType: "JournalEntryLineDetail", JournalEntryLineDetail: { PostingType: "Debit", AccountRef: debitAccount } },
    { Amount: amount, Description: limited(description, 4000), DetailType: "JournalEntryLineDetail", JournalEntryLineDetail: { PostingType: "Credit", AccountRef: creditAccount } },
  ];
}

async function inventoryValueBody(delivery: QboDelivery, context: QboMappingContext) {
  const entry = await row(`SELECT ive.id,ive.entry_type AS entryType,ive.value_cents AS valueCents,ive.quantity,ive.reference_type AS referenceType,
    ive.reference_id AS referenceId,ive.posted_at AS postedAt,ive.cost_method AS costMethod,p.sku FROM inventory_value_entries ive
    JOIN products p ON p.id=ive.product_id WHERE ive.id=?`, delivery.localEntityId);
  if (!entry) throw new QboMappingError(`Inventory value entry ${delivery.localEntityId} no longer exists.`, { code: "QBO_SOURCE_MISSING" });
  if (text(entry.entryType) === "landed_cost") throw new QboMappingError("Landed-cost value entries are consolidated into their allocation journal entry.", { code: "QBO_ENTITY_NOT_APPLICABLE", conflict: false });
  const accounts: Record<string, [string, string]> = {
    receipt: ["inventory", "inventory_clearing"], receipt_reversal: ["inventory_clearing", "inventory"],
    vendor_return: ["vendor_return_clearing", "inventory"], shipment: ["cost_of_goods_sold", "inventory"],
    shipment_reversal: ["inventory", "cost_of_goods_sold"], customer_return: ["inventory", "cost_of_goods_sold"],
    scrap: ["inventory_scrap_expense", "inventory"], inventory_adjustment_loss: ["inventory_adjustment_expense", "inventory"],
    inventory_adjustment_gain: ["inventory", "inventory_adjustment_gain"], opening_balance: ["inventory", "opening_balance_equity"],
    migration_opening_balance: ["inventory", "opening_balance_equity"],
  };
  const pair = accounts[text(entry.entryType)] ?? (Number(entry.valueCents) >= 0 ? ["inventory", "inventory_clearing"] : ["inventory_adjustment_expense", "inventory"]);
  const amount = Math.abs(cents(entry.valueCents));
  if (!amount) throw new QboMappingError("Zero-value inventory entries do not require a QBO journal entry.", { code: "QBO_ZERO_VALUE", conflict: false });
  const description = `${entry.sku} · ${entry.entryType} · ${entry.referenceType}:${entry.referenceId}`;
  return mapped("JournalEntry", {
    DocNumber: limited(`PF-${text(entry.id).replace(/^value-/u, "")}`, 21), TxnDate: dateOnly(entry.postedAt),
    PrivateNote: sourceMemo("inventory_value_entry", text(entry.id), `${entry.costMethod} valuation`),
    Line: journalLines(requiredAccount(context, pair[0]), requiredAccount(context, pair[1]), amount, description),
  }, null);
}

async function landedCostBody(delivery: QboDelivery, context: QboMappingContext) {
  const allocation = await row(`SELECT id,number,source_document_type AS sourceDocumentType,source_document_id AS sourceDocumentId,
    amount_cents AS amountCents,allocation_basis AS allocationBasis,posted_at AS postedAt FROM landed_cost_allocations WHERE id=?`, delivery.localEntityId);
  if (!allocation) throw new QboMappingError(`Landed-cost allocation ${delivery.localEntityId} no longer exists.`, { code: "QBO_SOURCE_MISSING" });
  const amount = Math.abs(cents(allocation.amountCents));
  return mapped("JournalEntry", {
    DocNumber: limited(allocation.number, 21), TxnDate: dateOnly(allocation.postedAt),
    PrivateNote: sourceMemo("landed_cost_allocation", text(allocation.id), `${allocation.sourceDocumentType}:${allocation.sourceDocumentId}`),
    Line: journalLines(requiredAccount(context, "inventory"), requiredAccount(context, "landed_cost_accrual"), amount, `Landed cost allocated by ${allocation.allocationBasis}`),
  }, null);
}

async function paymentBody(delivery: QboDelivery, context: QboMappingContext) {
  const payment = await row(`SELECT id,number,direction,partner_id AS partnerId,document_type AS documentType,document_id AS documentId,
    amount_cents AS amountCents,payment_date AS paymentDate,method,reference,currency,exchange_rate_to_base AS exchangeRate FROM payments WHERE id=?`, delivery.localEntityId);
  if (!payment) throw new QboMappingError(`Payment ${delivery.localEntityId} no longer exists.`, { code: "QBO_SOURCE_MISSING" });
  const amount = Math.abs(cents(payment.amountCents));
  const documentType = text(payment.documentType);
  if (documentType === "customer_invoice") return mapped("Payment", {
    TxnDate: dateOnly(payment.paymentDate), CustomerRef: requiredLink(context, "business_partner_customer", payment.partnerId, "Customer"), TotalAmt: amount,
    PaymentRefNum: limited(payment.reference || payment.number, 21), PaymentMethodRef: requiredReference(context, "payment_method", payment.method),
    PaymentType: customerPaymentType(payment.method),
    DepositToAccountRef: requiredAccount(context, customerDepositAccount(payment.method)), Line: [{ Amount: amount, LinkedTxn: [{ TxnId: requiredLink(context, "customer_invoice", payment.documentId, "Invoice").value, TxnType: "Invoice" }] }],
    PrivateNote: sourceMemo("payment", text(payment.id)), ...currencyFields(payment.currency, payment.exchangeRate),
  }, null);
  if (documentType === "vendor_bill") return mapped("BillPayment", {
    TxnDate: dateOnly(payment.paymentDate), VendorRef: requiredLink(context, "business_partner_vendor", payment.partnerId, "Vendor"), TotalAmt: amount,
    ...vendorPaymentInstrument(context, payment.method), DocNumber: limited(payment.reference || payment.number, 21),
    Line: [{ Amount: amount, LinkedTxn: [{ TxnId: requiredLink(context, "vendor_bill", payment.documentId, "Bill").value, TxnType: "Bill" }] }],
    PrivateNote: sourceMemo("payment", text(payment.id)), ...currencyFields(payment.currency, payment.exchangeRate),
  }, null);
  let debit = "accounts_receivable";
  let credit = "cash";
  if (documentType === "returnable_deposit_collection") {
    [debit, credit] = text(payment.direction) === "inbound" ? ["cash", "refundable_deposits_payable"] : ["refundable_deposits_receivable", "cash"];
  } else if (["returnable_deposit_refund", "returnable_deposit"].includes(documentType)) {
    [debit, credit] = text(payment.direction) === "inbound" ? ["cash", "refundable_deposits_receivable"] : ["refundable_deposits_payable", "cash"];
  } else if (text(payment.direction) === "inbound") [debit, credit] = ["cash", "accounts_receivable"];
  else [debit, credit] = ["accounts_payable", "cash"];
  return mapped("JournalEntry", {
    DocNumber: limited(payment.number, 21), TxnDate: dateOnly(payment.paymentDate), PrivateNote: sourceMemo("payment", text(payment.id), documentType),
    Line: journalLines(requiredAccount(context, debit), requiredAccount(context, credit), amount, text(payment.reference || payment.number)),
  }, null);
}

async function creditApplicationBody(delivery: QboDelivery, context: QboMappingContext, kind: "customer" | "vendor") {
  const customer = kind === "customer";
  const credit = await row(customer
    ? `SELECT cc.id,cc.number,cc.customer_id AS partnerId,cc.customer_invoice_id AS documentId,cc.amount_cents AS amountCents,
       cc.posted_at AS postedAt,cc.currency,cc.exchange_rate_to_base AS exchangeRate FROM customer_credits cc WHERE cc.id=?`
    : `SELECT vc.id,vc.number,vc.vendor_id AS partnerId,vc.vendor_bill_id AS documentId,vc.amount_cents AS amountCents,
       vc.posted_at AS postedAt,vc.currency,vc.exchange_rate_to_base AS exchangeRate FROM vendor_credits vc WHERE vc.id=?`, delivery.localEntityId);
  if (!credit?.documentId) throw new QboMappingError(`${customer ? "Customer" : "Vendor"} credit is not linked to a source document, so it remains an open QBO credit.`, { code: "QBO_ENTITY_NOT_APPLICABLE", conflict: false });
  const amount = Math.abs(cents(credit.amountCents));
  if (customer) return mapped("Payment", {
    CustomerRef: requiredLink(context, "business_partner_customer", credit.partnerId, "Customer"), TxnDate: dateOnly(credit.postedAt),
    TotalAmt: 0, PaymentRefNum: limited(`PF-APPLY-${credit.number}`, 21), PrivateNote: sourceMemo("customer_credit_application", text(credit.id)),
    Line: [{ Amount: amount, LinkedTxn: [
      { TxnId: requiredLink(context, "customer_invoice", credit.documentId, "Invoice").value, TxnType: "Invoice" },
      { TxnId: requiredLink(context, "customer_credit", credit.id, "CreditMemo").value, TxnType: "CreditMemo" },
    ] }], ...currencyFields(credit.currency, credit.exchangeRate),
  }, null);
  return mapped("BillPayment", {
    VendorRef: requiredLink(context, "business_partner_vendor", credit.partnerId, "Vendor"), TxnDate: dateOnly(credit.postedAt),
    TotalAmt: 0, PayType: "Check", CheckPayment: { BankAccountRef: requiredAccount(context, "cash") },
    DocNumber: limited(`PF-APPLY-${credit.number}`, 21), PrivateNote: sourceMemo("vendor_credit_application", text(credit.id)),
    Line: [{ Amount: amount, LinkedTxn: [
      { TxnId: requiredLink(context, "vendor_bill", credit.documentId, "Bill").value, TxnType: "Bill" },
      { TxnId: requiredLink(context, "vendor_credit", credit.id, "VendorCredit").value, TxnType: "VendorCredit" },
    ] }], ...currencyFields(credit.currency, credit.exchangeRate),
  }, null);
}

async function returnableEventBody(delivery: QboDelivery, context: QboMappingContext) {
  const event = await row(`SELECT re.id,re.event_type AS eventType,re.amount_cents AS amountCents,re.reason,re.posted_at AS postedAt,
    ro.direction,ro.partner_id AS partnerId,rat.code AS assetCode FROM returnable_events re
    JOIN returnable_obligations ro ON ro.id=re.obligation_id JOIN returnable_asset_types rat ON rat.id=ro.asset_type_id WHERE re.id=?`, delivery.localEntityId);
  if (!event) throw new QboMappingError(`Returnable event ${delivery.localEntityId} no longer exists.`, { code: "QBO_SOURCE_MISSING" });
  if (text(event.eventType) !== "forfeit" || !Number(event.amountCents)) throw new QboMappingError("This returnable event has no standalone accounting entry.", { code: "QBO_ZERO_VALUE", conflict: false });
  const customerHolds = text(event.direction) === "customer_holds";
  return mapped("JournalEntry", {
    DocNumber: limited(`PF-RET-${event.id}`, 21), TxnDate: dateOnly(event.postedAt), PrivateNote: sourceMemo("returnable_event", text(event.id), text(event.assetCode)),
    Line: journalLines(
      requiredAccount(context, customerHolds ? "refundable_deposits_payable" : "forfeited_deposit_expense"),
      requiredAccount(context, customerHolds ? "forfeited_deposit_revenue" : "refundable_deposits_receivable"),
      Math.abs(cents(event.amountCents)), text(event.reason),
    ),
  }, null);
}

export async function mapQboDelivery(delivery: QboDelivery, context: QboMappingContext) {
  switch (delivery.localEntityType) {
    case "business_partner_customer": return partnerBody(delivery, context, "Customer");
    case "business_partner_vendor": return partnerBody(delivery, context, "Vendor");
    case "product": return productBody(delivery, context);
    case "qbo_special_item": return specialItemBody(delivery, context);
    case "purchase_order": return purchaseOrderBody(delivery, context);
    case "customer_invoice": return invoiceBody(delivery, context);
    case "vendor_bill": return vendorBillBody(delivery, context);
    case "customer_credit": return creditBody(delivery, context, "customer");
    case "vendor_credit": return creditBody(delivery, context, "vendor");
    case "payment": return paymentBody(delivery, context);
    case "customer_credit_application": return creditApplicationBody(delivery, context, "customer");
    case "vendor_credit_application": return creditApplicationBody(delivery, context, "vendor");
    case "inventory_value_entry": return inventoryValueBody(delivery, context);
    case "landed_cost_allocation": return landedCostBody(delivery, context);
    case "returnable_event": return returnableEventBody(delivery, context);
    default: throw new QboMappingError(`QBO does not support PaneFlow entity type ${delivery.localEntityType}.`, { code: "QBO_UNSUPPORTED_ENTITY" });
  }
}

export const qboSpecialItemIds = Object.keys(specialItems);
