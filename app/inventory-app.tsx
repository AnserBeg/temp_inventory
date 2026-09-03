"use client";

import {
  FormEvent,
  lazy,
  ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { DocumentDownloadLink, EmailConnectionManager, EmailDocumentButton } from "./components/email-documents";
import { AddressAutocomplete } from "./components/address-autocomplete";
import { actorName } from "./components/format";
import { localDatePlusDays, localDateString } from "./components/local-date";
import { NumberField } from "./components/number-field";
import { useDialogDismiss } from "./components/use-dialog-dismiss";
import { PAYMENT_TERMS, PickerPermissionsContext, QuickCreateDialog, RemoteSearchSelect, SearchableSelect, type LookupKind, type QuickCreateKind } from "./components/reference-picker";
import { calculateSalesAvailability } from "@/lib/domain/sales-availability";
import { inventoryCountApprovalPayload, workflowSnapshotParts } from "@/lib/domain/workflow-envelope";

let operationsWorkspaceModule: Promise<typeof import("./components/operations-suite")> | undefined;
const loadOperationsWorkspaceModule = () => operationsWorkspaceModule ??= import("./components/operations-suite");
const OperationsWorkspace = lazy(() => loadOperationsWorkspaceModule().then((module) => ({ default: module.OperationsWorkspace })));

let inventoryCountSessionsModule: Promise<typeof import("./components/inventory-count-sessions")> | undefined;
const loadInventoryCountSessionsModule = () => inventoryCountSessionsModule ??= import("./components/inventory-count-sessions");
const InventoryCountSessions = lazy(() => loadInventoryCountSessionsModule().then((module) => ({ default: module.InventoryCountSessions })));

type Severity = "neutral" | "info" | "success" | "warning" | "danger";
type SortDirection = "asc" | "desc";
type WorklistSortProps = { sort: string; setSort: (value: string) => void };

type PurchaseLine = {
  id: string;
  productId?: string;
  sku: string;
  product: string;
  specification: string;
  customerRef?: string;
  ordered: number;
  received: number;
  returned: number;
  fulfilled: number;
  /** Quantity from this line that remains reversible on the most recently posted receipt. */
  latestReceiptReversible: number;
  closed: number;
  open: number;
  openToReceive: number;
  openToDeliver: number;
  unitCost: number;
  orderedUomId?: string;
  orderedUomCode?: string;
  uomFactorToBase: number;
  location: string;
  fulfillmentRoute?: string;
  trackingPolicy: string;
  sourceSalesOrderLineId?: string;
  supplyAllocations: Array<{ id: string; salesOrderLineId: string; quantity: number; receivedQuantity: number; status: string; salesOrderNumber: string; customerName: string }>;
  defaultLocations: ProductDefaultLocation[];
  discountCents: number;
  taxable: boolean;
  taxRateBps: number;
  version: number;
};

type ProductDefaultLocation = {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  locationId?: string;
  locationCode?: string;
  locationName?: string;
  version?: number;
};

type SalesLine = {
  id: string;
  productId: string;
  sku: string;
  product: string;
  ordered: number;
  canceled: number;
  reserved: number;
  shipped: number;
  returned: number;
  fulfilled: number;
  open: number;
  unitPrice: number;
  orderedUomId?: string;
  orderedUomCode?: string;
  uomFactorToBase: number;
  fulfillmentRoute: string;
  trackingPolicy: string;
  reservationLocationId?: string;
  linkedPurchaseOrderLineId?: string;
  linkedPurchaseOrderId?: string;
  linkedPurchaseOrderNumber?: string;
  linkedPurchaseOrderLifecycle?: string;
  projectReference?: string;
  discountCents: number;
  taxable: boolean;
  taxRateBps: number;
  /** Usable stock and approved incoming supply for this line's product, in base units. */
  productAvailable: number;
  productIncoming: number;
};

type PurchaseOrder = {
  id: string;
  number: string;
  vendorId: string;
  vendor: string;
  lifecycle: string;
  fulfillment: string;
  billing: string;
  expectedDate: string;
  daysLate: number;
  ordered: number;
  received: number;
  returned: number;
  fulfilled: number;
  closed: number;
  open: number;
  openToReceive: number;
  openToDeliver: number;
  billed: number;
  total: number;
  currency: string;
  exchangeRateToBase: number;
  paymentTerms?: string;
  dueDate?: string;
  projectReference?: string;
  supplierQuoteNumber?: string;
  supplierReference?: string;
  freightCents: number;
  freightTaxRateBps: number;
  feeCents: number;
  feeTaxRateBps: number;
  depositCents: number;
  buyer: string;
  orderDate: string;
  submissionNote?: string;
  revision: number;
  version: number;
  latestReceiptId?: string;
  latestReceiptVersion?: number;
  latestReceiptNumber?: string;
  latestReceiptPostedAt?: string;
  latestReceiptPackingSlip?: string;
  receipts: PurchaseReceiptRecord[];
  supplierDeliveries: SupplierDeliveryRecord[];
  vendorBills: FinancialDocumentRecord[];
  settlements: SettlementDocumentRecord[];
  customerRef?: string;
  exception?: string;
  lines: PurchaseLine[];
};

type Product = {
  id: string;
  sku: string;
  name: string;
  specification: string;
  policy: string;
  location: string;
  locationCode: string;
  onHand: number;
  usable: number;
  reserved: number;
  available: number;
  incoming: number;
  demand: number;
  projected: number;
  reorderPoint: number;
  maxStockLevel: number;
  reorderRuleMode: "manual" | "global" | "custom";
  reorderRulePercent?: number;
  inventoryPolicy: string;
  standardCost: number;
  lastUnitCost?: number;
  lastUnitCostSourcePoNumber?: string;
  lastUnitCostVendorName?: string;
  lastUnitCostAt?: string;
  sellingPrice: number;
  suggestedSellingPrice: number;
  pricingMode: "automatic" | "manual";
  appliedMarginRuleCode?: string;
  manualPriceReason?: string;
  baseUomId: string;
  baseUomCode: string;
  purchaseUomId: string;
  purchaseUomCode: string;
  salesUomId: string;
  salesUomCode: string;
  quantityPrecision: number;
  customerRef?: string;
  /** Balance version, used for count concurrency. */
  version?: number;
  /** The catalog row's own optimistic-lock value, required to save an edit. */
  productVersion: number;
  manufacturerSku?: string;
  category: string;
  material: string;
  dimensions: string;
  finish: string;
  trackingPolicy: string;
  aliases: string[];
  defaultLocations: ProductDefaultLocation[];
};

type ProductPicture = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  ownerEmail: string;
  uploadedAt: string;
};

type LocationOption = {
  id: string;
  code: string;
  name: string;
  warehouseId: string;
  warehouseName: string;
  inventoryStatus: string;
  locationType: string;
};

type InventoryLocationBalance = {
  productId: string;
  locationId: string;
  recordedQuantity: number;
  reservedQuantity: number;
  version: number;
  locationCode: string;
  locationName: string;
  warehouseName: string;
};

/** A countable balance carrying its own product identity, so the cycle-count worklist can be
 *  paged over balances instead of being reassembled from a page of the catalog. */
type CountBalance = InventoryLocationBalance & { sku: string; productName: string };

type SalesOrder = {
  id: string;
  number: string;
  customerId: string;
  customer: string;
  project: string;
  requestedDate: string;
  lifecycle: string;
  fulfillment: string;
  billing: string;
  ordered: number;
  reserved: number;
  shipped: number;
  returned: number;
  fulfilled: number;
  invoiced?: number;
  open: number;
  openToShip: number;
  openToDeliver: number;
  availableNow: number;
  incomingBeforeDate: number;
  shortage: number;
  total: number;
  currency: string;
  exchangeRateToBase: number;
  paymentTerms?: string;
  dueDate?: string;
  freightCents: number;
  freightTaxRateBps: number;
  feeCents: number;
  feeTaxRateBps: number;
  depositCents: number;
  shipToName?: string;
  shipToAddressLine1?: string;
  shipToAddressLine2?: string;
  shipToCity?: string;
  shipToRegion?: string;
  shipToPostalCode?: string;
  shipToCountry?: string;
  deliveryInstructions?: string;
  route: string;
  linkedPo?: string;
  exception?: string;
  orderDate: string;
  owner: string;
  shipments: ShipmentRecord[];
  supplierDeliveries: SupplierDeliveryRecord[];
  invoices: FinancialDocumentRecord[];
  settlements: SettlementDocumentRecord[];
  version: number;
  lines?: SalesLine[];
};

/** Carrier paperwork for a posted shipment, so "where is my order" is answerable on screen. */
type ShipmentRecord = {
  number: string;
  postedAt: string;
  status: string;
  carrier: string;
  serviceLevel: string;
  trackingNumber: string;
  billOfLadingNumber: string;
};

type Movement = {
  id: string;
  time: string;
  type: string;
  /** The source document's own number, falling back to its id when it has none. */
  document: string;
  documentType?: string;
  relatedOrderNumber?: string;
  relatedOrderId?: string;
  relatedOrderKind?: "purchase" | "sales";
  product: string;
  quantity: number;
  from: string;
  to: string;
  user: string;
};

type Bill = {
  id: string;
  number: string;
  vendor: string;
  po: string;
  purchaseOrderId?: string;
  receivedValue: number;
  billedValue: number;
  variance: number;
  currency: string;
  status: string;
  /** Posting/settlement state, kept apart from the three-way `status` match state. */
  settlementStatus: string;
  vendorInvoiceNumber?: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  outstanding: number;
  paymentTerms?: string;
  holdReason?: string;
  reason?: string;
};

type Activity = {
  id: string;
  time: string;
  title: string;
  detail: string;
  tone: Severity;
};

type Partner = {
  id: string;
  code: string;
  version: number;
  paymentTerms?: string;
  currency: string;
  name: string;
  type: "vendor" | "customer" | "both";
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  creditLimitCents?: number;
  creditHold?: boolean;
};

type Snapshot = {
  summary: {
    lateReceipts: number;
    approvals: number;
    blockedSales: number;
    dueReceipts: number;
    readyToShip: number;
    onHand: number;
    usable: number;
    reserved: number;
    available: number;
    incoming: number;
    openDemand: number;
    openReceiptUnits: number;
    readyToShipUnits: number;
    inventoryRisks: number;
    matchExceptions: number;
    specialOrderInventory: number;
    countableBalances: number;
    receivingBalances: number;
    orphanedBalanceRows: number;
    orphanedBalanceUnits: number;
    orphanedMovementCount: number;
    orphanedInventoryValueCents: number;
  };
  purchaseOrders: PurchaseOrder[];
  products: Product[];
  inventoryBalances: InventoryLocationBalance[];
  countBalances: CountBalance[];
  salesOrders: SalesOrder[];
  movements: Movement[];
  bills: Bill[];
  activities: Activity[];
  partners: Partner[];
  locations: LocationOption[];
  configuration: { taxDefaultRateBps: number; reorderPointPercent: number };
  viewer: {
    name: string;
    email: string;
    role: string;
    tenant: { id: string; slug: string; name: string };
    tenants: Array<{ id: string; slug: string; name: string; role: string; isDefault: boolean }>;
    permissions: { canRead: boolean; canExport: boolean; canOperate: boolean; canPostFinancial: boolean; canApprove: boolean; canAdminister: boolean };
  };
  pagination: {
    page: number;
    pageSize: number;
    totals: Record<string, number>;
    filteredTotal: number | null;
  };
};

const emptySnapshot: Snapshot = {
  summary: { lateReceipts: 0, approvals: 0, blockedSales: 0, dueReceipts: 0, readyToShip: 0, onHand: 0, usable: 0, reserved: 0, available: 0, incoming: 0, openDemand: 0, openReceiptUnits: 0, readyToShipUnits: 0, inventoryRisks: 0, matchExceptions: 0, specialOrderInventory: 0, countableBalances: 0, receivingBalances: 0, orphanedBalanceRows: 0, orphanedBalanceUnits: 0, orphanedMovementCount: 0, orphanedInventoryValueCents: 0 },
  purchaseOrders: [],
  products: [],
  inventoryBalances: [],
  countBalances: [],
  salesOrders: [],
  movements: [],
  bills: [],
  activities: [],
  partners: [],
  locations: [],
  configuration: { taxDefaultRateBps: 500, reorderPointPercent: 70 },
  viewer: { name: "", email: "", role: "", tenant: { id: "", slug: "", name: "" }, tenants: [], permissions: { canRead: false, canExport: false, canOperate: false, canPostFinancial: false, canApprove: false, canAdminister: false } },
  pagination: { page: 1, pageSize: 50, totals: {}, filteredTotal: null },
};

/** Two letters for the avatar. "Morgan Liu" → ML; a single name falls back to its first two. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}` : parts[0].slice(0, 2)).toUpperCase();
}

type ComposerLine = {
  id: string;
  productId: string;
  quantity: number;
  unitAmount: number;
  uomId: string;
  uomCode: string;
  priceSource: string;
  discountRate: number;
  taxCode: string;
  taxRate: number;
  route: string;
  projectReference: string;
  sourceSalesOrderLineId: string;
  supplyAllocations: Array<{ id: string; salesOrderLineId: string; quantity: number; label: string }>;
  linkedPurchaseOrderLineId: string;
};

type CounterSaleLine = ComposerLine & {
  factorToBase: number;
  trackingPolicy: string;
  availableQuantity: number;
  locationId: string;
  locationLabel: string;
  locationAvailable: number;
  lotId: string;
  inventoryUnitId: string;
};

export type ViewKey =
  | "home"
  | "purchase-orders"
  | "expected-receipts"
  | "vendor-returns"
  | "sales-orders"
  | "counter-sales"
  | "fulfillment"
  | "customer-returns"
  | "stock"
  | "movements"
  | "counts"
  | "vendor-bills"
  | "customer-invoices"
  | "products"
  | "partners"
  | "reports"
  | "warehouse";

type SearchResult = { type: string; id: string; label: string; detail: string; view: ViewKey; page?: number };
type LookupOption = {
  id: string; label: string; detail: string; unitAmount?: number;
  uomId?: string; uomCode?: string; priceSource?: string; factorToBase?: number;
  addressLine1?: string; addressLine2?: string; city?: string; region?: string; postalCode?: string; country?: string;
  contactName?: string; deliveryInstructions?: string;
  currency?: string; paymentTerms?: string;
  creditHold?: boolean; creditLimitCents?: number;
  availableQuantity?: number; trackingPolicy?: string; inventoryPolicy?: string;
  /** Catalog attributes, so an order line's configuration snapshot is built from what the product is, not its price hint. */
  dimensions?: string; finish?: string; material?: string; category?: string;
};

type CommandKind =
  | "receive"
  | "close"
  | "reopen"
  | "reverse"
  | "vendor-return"
  | "reserve"
  | "ship"
  | "immediate-sale"
  | "customer-return"
  | "count";

type ActiveCommand = {
  kind: CommandKind;
  entityId: string;
  entityNumber: string;
  locationId?: string;
  locationLabel?: string;
  recordedQuantity?: number;
  balanceVersion?: number;
};

type CountApproval = {
  id: string;
  version: number;
  status: "pending" | "approved" | "rejected";
  canApprove: boolean;
};

class CommandRequestError extends Error {
  constructor(message: string, public code: string, public currentVersion?: number) {
    super(message);
  }
}

// Whole dollars for roll-ups, where cents are noise.
const money = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

// Exact amounts for anything a person reconciles against a document. A $412.50 line cost read
// as "$413", or a $0.40 bill variance flagged as an exception but displayed as "$0", is worse
// than no number at all.
const exact = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Inventory quantities may legitimately use fractions, but database arithmetic should not
// leak floating-point noise such as 4.199999999999999 into a worklist or form preview.
const quantity = new Intl.NumberFormat("en-CA", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

function formatQuantity(value: number) {
  return Number.isFinite(value) ? quantity.format(value) : "—";
}

function formatDocumentMoney(value: number, currency: string, exactAmount = true) {
  try {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: currency || "CAD", minimumFractionDigits: exactAmount ? 2 : 0, maximumFractionDigits: exactAmount ? 2 : 0 }).format(value);
  } catch {
    return `${currency || "CAD"} ${value.toFixed(exactAmount ? 2 : 0)}`;
  }
}

const compactDate = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
});

// Documents carry the year. A purchase order dated "Aug 4" is ambiguous the moment the data set
// spans more than one year, which it does from the first day of the second fiscal year.
const documentDate = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** Visible suffix on a required field's label, so a disabled or refused submit is never a mystery. */
const requiredMark = <span className="required-mark" aria-hidden="true"> *</span>;

function formatDocumentDate(value: string | undefined, fallback = "Not recorded") {
  if (!value) return fallback;
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : documentDate.format(date);
}

/**
 * Extended amount for one order line, matching the server's pricing exactly
 * (`prepareOrderDraft` in lib/server/inventory-records.ts): the entered quantity times the
 * entered unit amount, less the line discount. Rounding happens on the gross so a line never
 * disagrees with the document total by a cent.
 */
function lineNetAmount(quantity: number, unitAmount: number, discountCents: number) {
  return (Math.round(quantity * Math.round(unitAmount * 100)) - discountCents) / 100;
}

function lineTaxAmount(quantity: number, unitAmount: number, discountCents: number, taxable: boolean, taxRateBps: number) {
  if (!taxable) return 0;
  return Math.round((Math.round(quantity * Math.round(unitAmount * 100)) - discountCents) * taxRateBps / 10000) / 100;
}

type DocumentChargeTotals = {
  freightCents: number;
  freightTaxRateBps: number;
  feeCents: number;
  feeTaxRateBps: number;
  depositCents: number;
};

type DocumentTotalLine = { quantity: number; unitAmount: number; discountCents: number; taxable: boolean; taxRateBps: number };

/**
 * The document totals a person reconciles against: item subtotal, the discounts already netted
 * out of it, order-level charges, and tax. Deposits are refundable and tax-exempt, so they are
 * shown on their own line rather than folded into revenue.
 */
function documentTotals(lines: DocumentTotalLine[], charges: DocumentChargeTotals) {
  const gross = lines.reduce((sum, line) => sum + Math.round(line.quantity * Math.round(line.unitAmount * 100)), 0) / 100;
  const discount = lines.reduce((sum, line) => sum + line.discountCents, 0) / 100;
  const lineTax = lines.reduce((sum, line) => sum + lineTaxAmount(line.quantity, line.unitAmount, line.discountCents, line.taxable, line.taxRateBps), 0);
  const freight = charges.freightCents / 100;
  const fees = charges.feeCents / 100;
  const deposit = charges.depositCents / 100;
  const chargeTax = Math.round(charges.freightCents * charges.freightTaxRateBps / 10000) / 100
    + Math.round(charges.feeCents * charges.feeTaxRateBps / 10000) / 100;
  const tax = lineTax + chargeTax;
  return { gross, discount, subtotal: gross - discount, freight, fees, deposit, tax, total: gross - discount + freight + fees + deposit + tax };
}

/** Reconciliation block shared by the purchase- and sales-order documents. */
function DocumentTotalsPanel({ totals, currency }: { totals: ReturnType<typeof documentTotals>; currency: string }) {
  const row = (label: string, value: number, negative = false) =>
    <div key={label}><dt>{label}</dt><dd>{negative && value > 0 ? "−" : ""}{formatDocumentMoney(value, currency)}</dd></div>;
  return <section className="panel"><PanelHeading title="Totals" detail={`Amounts in ${currency}`} />
    <dl className="financial-total-lines document-totals">
      {row("Items", totals.gross)}
      {totals.discount > 0 ? row("Line discounts", totals.discount, true) : null}
      {row("Subtotal", totals.subtotal)}
      {totals.freight ? row("Freight", totals.freight) : null}
      {totals.fees ? row("Other fees", totals.fees) : null}
      {totals.deposit ? row("Refundable deposit", totals.deposit) : null}
      {row("Tax", totals.tax)}
      <div className="total"><dt>Document total</dt><dd>{formatDocumentMoney(totals.total, currency)}</dd></div>
    </dl>
  </section>;
}

/** Header field grid for a document: the dates, terms and people an operator asks about first. */
function DocumentFacts({ title, facts }: { title: string; facts: Array<[string, ReactNode]> }) {
  return <section className="panel"><PanelHeading title={title} />
    <dl className="definition-list">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </section>;
}

/** Today plus `days`, in the viewer's calendar rather than UTC's. */
function futureDate(days: number) {
  return localDatePlusDays(days);
}

/**
 * A purchase order without an expected date says so. The normaliser used to invent one a week
 * out, which then showed as a real commitment and, a week later, as "late".
 */
function expectedDateLabel(value: string | undefined) {
  return value ? formatDocumentDate(value) : "Not set";
}

/**
 * What stands in for a missing location on a movement. Every external row used to read
 * "External / Supplier → External / Customer" whatever the movement was, so a customer return
 * appeared to arrive from a supplier and a scrap posting to ship to a customer.
 */
const externalMovementFrom: Record<string, string> = { purchase_receipt: "External / Supplier", customer_return: "External / Customer", shipment_reversal: "External / Customer" };
const externalMovementTo: Record<string, string> = { sales_shipment: "External / Customer", receipt_reversal: "External / Supplier", vendor_return: "External / Supplier" };
function movementCounterparty(type: string, side: "from" | "to") {
  const named = (side === "from" ? externalMovementFrom : externalMovementTo)[type];
  if (named) return named;
  return type.includes("scrap") ? "Scrap" : "Adjustment";
}

function dueDateForTerms(baseDate: string, terms: string) {
  const days = terms === "Due on receipt" ? 0 : Number(/^Net (\d+)$/.exec(terms)?.[1] ?? 0);
  const date = new Date(`${baseDate}T12:00:00Z`);
  if (Number.isNaN(date.valueOf())) return baseDate;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}


type NavItem = { key: ViewKey; label: string; glyph: string; tab?: string; tabs?: readonly string[] };

const navGroups: Array<{ label?: string; items: NavItem[] }> = [
  { items: [{ key: "home", label: "Home", glyph: "H" }] },
  {
    label: "Purchasing",
    items: [
      { key: "purchase-orders", label: "Purchase orders", glyph: "PO" },
      { key: "expected-receipts", label: "Expected receipts", glyph: "↓" },
      { key: "vendor-returns", label: "Vendor returns", glyph: "↗" },
    ],
  },
  {
    label: "Sales",
    items: [
      { key: "counter-sales", label: "Counter sale", glyph: "$" },
      { key: "sales-orders", label: "Sales orders", glyph: "SO" },
      { key: "fulfillment", label: "Ready to fulfill", glyph: "✓" },
      { key: "customer-returns", label: "Customer returns", glyph: "↙" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { key: "stock", label: "Stock", glyph: "▦" },
      { key: "movements", label: "Movements", glyph: "⇄" },
      // Counting is one of six things behind this item; transfers, traceability, valuation, and
      // returnables live here too, and none of them is findable from the word "Counts".
      { key: "counts", label: "Counts & transfers", glyph: "#" },
    ],
  },
  {
    label: "Billing",
    items: [
      { key: "vendor-bills", label: "Vendor bills", glyph: "$" },
      { key: "customer-invoices", label: "Customer invoices", glyph: "$" },
    ],
  },
  {
    items: [
      { key: "products", label: "Catalog", glyph: "◇" },
      { key: "partners", label: "Customers & vendors", glyph: "◎" },
      { key: "reports", label: "Reports", glyph: "▥", tab: "overview", tabs: ["overview", "approvals", "audit"] },
      { key: "reports", label: "Pricing", glyph: "%", tab: "pricing" },
      { key: "reports", label: "Settings", glyph: "⚙", tab: "policies", tabs: ["policies", "periods-access", "integrations", "reconciliation", "units", "master-data"] },
      { key: "warehouse", label: "Warehouse mode", glyph: "▣" },
    ],
  },
];

// Titles carry the page. A subtitle is only kept where the heading alone leaves a real
// question about what the page does with the records it lists.
const viewTitles: Record<ViewKey, { title: string; description?: string }> = {
  home: { title: "Operations overview" },
  "purchase-orders": { title: "Purchase orders" },
  "expected-receipts": { title: "Expected receipts" },
  "vendor-returns": { title: "Vendor returns" },
  "sales-orders": { title: "Sales orders" },
  "counter-sales": { title: "Counter sale", description: "Sell available stock and post the invoice in one step." },
  fulfillment: { title: "Ready to fulfill" },
  "customer-returns": { title: "Customer returns" },
  stock: { title: "Inventory" },
  movements: { title: "Movement history" },
  counts: { title: "Counts & transfers" },
  "vendor-bills": { title: "Vendor bills" },
  "customer-invoices": { title: "Customer invoices" },
  products: { title: "Product catalog" },
  partners: { title: "Customers & vendors" },
  reports: { title: "Reports" },
  warehouse: { title: "Warehouse mode" },
};

function navItemIsActive(item: NavItem, view: ViewKey, workspaceTab: string) {
  if (view !== item.key) return false;
  if (item.tabs) return item.tabs.includes(workspaceTab);
  return item.tab ? workspaceTab === item.tab : true;
}

function reportsPageTitle(workspaceTab: string) {
  if (workspaceTab === "pricing") return "Pricing";
  if (["policies", "periods-access", "integrations", "reconciliation", "units", "master-data"].includes(workspaceTab)) return "Settings";
  return "Reports";
}

type PurchaseReceiptRecord = {
  id: string;
  number: string;
  postedAt: string;
  status: string;
  packingSlipNumber?: string;
  quantity: number;
};

type SupplierDeliveryRecord = {
  id: string;
  number: string;
  postedAt: string;
  deliveryDate: string;
  status: string;
  externalReference?: string;
  quantity: number;
};

type FinancialDocumentRecord = {
  id: string;
  number: string;
  status: string;
  matchStatus?: string;
  issuedOn: string;
  dueOn?: string;
  amount: number;
  paid: number;
  credited: number;
  outstanding: number;
  currency: string;
  externalReference?: string;
};

type SettlementDocumentRecord = {
  id: string;
  number: string;
  kind: "payment" | "credit";
  postedAt: string;
  amount: number;
  currency: string;
  appliedTo?: string;
};

const operationsWorkspaceByView = {
  "purchase-orders": "purchasing",
  "sales-orders": "sales",
  stock: "inventory",
  counts: "inventory",
  "vendor-bills": "vendor-billing",
  "customer-invoices": "customer-billing",
  reports: "controls",
} as const;

/**
 * The advanced workflow surface is intentionally a separate chunk. Start downloading and
 * warming its first query as soon as intent is known, so clicking a sidebar item does not turn
 * code, the core snapshot, and workflow data into three serial waits.
 */
function preloadViewCode(view: ViewKey) {
  const workspace = operationsWorkspaceByView[view as keyof typeof operationsWorkspaceByView];
  if (workspace) void loadOperationsWorkspaceModule().then((module) => module.preloadOperationsWorkspace(workspace));
  if (view === "counts") void loadInventoryCountSessionsModule();
}

type SnapshotRequestInput = {
  view: ViewKey;
  page: number;
  search: string;
  status: string;
  sort: string;
  warehouseId: string;
};

function createSnapshotRequest(input: SnapshotRequestInput) {
  const params = new URLSearchParams({
    page: String(input.page),
    // Reports paginate their product table locally. Loading the complete catalog for this
    // bounded reporting view avoids stacking a second, unrelated server pager beneath it.
    pageSize: input.view === "reports" ? "500" : "50",
    scope: input.view,
    worklistQuery: input.search,
    status: input.status,
    sort: input.sort,
    warehouseId: input.warehouseId,
    asOf: localDateString(),
  });
  return { key: params.toString(), url: `/api/snapshot?${params}` };
}

type SnapshotCacheEntry = { snapshot: Snapshot; loadedAt: number };
const snapshotCache = new Map<string, SnapshotCacheEntry>();
const snapshotPrefetches = new Map<string, Promise<Snapshot>>();
const SNAPSHOT_CACHE_LIMIT = 12;

function rememberSnapshot(key: string, snapshot: Snapshot) {
  snapshotCache.delete(key);
  snapshotCache.set(key, { snapshot, loadedAt: Date.now() });
  while (snapshotCache.size > SNAPSHOT_CACHE_LIMIT) {
    const oldest = snapshotCache.keys().next().value as string | undefined;
    if (!oldest) break;
    snapshotCache.delete(oldest);
  }
}

async function requestSnapshot(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(text(asRecord(data.error).message, "Snapshot unavailable"));
  return normalizeSnapshot(data);
}

function prefetchSnapshot(request: ReturnType<typeof createSnapshotRequest>) {
  if (snapshotCache.has(request.key) || snapshotPrefetches.has(request.key)) return;
  const pending = requestSnapshot(request.url)
    .then((snapshot) => {
      rememberSnapshot(request.key, snapshot);
      return snapshot;
    })
    .finally(() => snapshotPrefetches.delete(request.key));
  snapshotPrefetches.set(request.key, pending);
  void pending.catch(() => undefined);
}

type WorkflowGuideStep = { label: string; detail: string; view: ViewKey; tab?: string };

const purchasingWorkflow: WorkflowGuideStep[] = [
  { label: "Commit order", detail: "Draft and approve", view: "purchase-orders" },
  { label: "Receive stock", detail: "Post warehouse receipt", view: "expected-receipts" },
  { label: "Match vendor bill", detail: "PO + receipt + vendor invoice", view: "vendor-bills" },
  { label: "Settle payable", detail: "Credit or record payment", view: "vendor-bills", tab: "billing-actions" },
];

const salesWorkflow: WorkflowGuideStep[] = [
  { label: "Commit order", detail: "Confirm customer demand", view: "sales-orders" },
  { label: "Allocate supply", detail: "Reserve or link supplier supply", view: "sales-orders", tab: "reservations" },
  { label: "Post fulfillment", detail: "Shipment or supplier delivery", view: "fulfillment" },
  { label: "Create invoice", detail: "Only fulfilled quantity", view: "customer-invoices" },
  { label: "Collect or credit", detail: "Close the receivable", view: "customer-invoices", tab: "billing-actions" },
];

const vendorReturnWorkflow: WorkflowGuideStep[] = [
  { label: "Select receipt", detail: "Choose eligible net received quantity", view: "vendor-returns" },
  { label: "Post return", detail: "Goods out or price allowance", view: "vendor-returns" },
  { label: "Track replacement", detail: "Keep incoming supply explicit", view: "expected-receipts" },
  { label: "Reconcile credit", detail: "Post credit against the payable", view: "vendor-bills", tab: "billing-actions" },
];

const customerReturnWorkflow: WorkflowGuideStep[] = [
  { label: "Select shipment", detail: "Choose eligible net shipped quantity", view: "customer-returns" },
  { label: "Receive and inspect", detail: "Available, quarantine, or damaged", view: "customer-returns" },
  { label: "Issue credit", detail: "Financial action stays separate", view: "customer-invoices", tab: "billing-actions" },
  { label: "Close balance", detail: "Record refund or remaining payment", view: "customer-invoices", tab: "billing-actions" },
];

// Reason lists are suggestions, not an enumeration: every one of these pickers accepts a typed
// value, because a branch meets reasons no shipped list anticipated and an operator who cannot
// record the real one records a wrong one.
const vendorReturnReasons = ["Damaged on arrival", "Wrong specification", "Wrong quantity shipped", "Warranty issue", "Late delivery refused", "Customer cancellation", "Ordered in error"];
const customerReturnReasons = ["Damage in transit", "Incorrect item shipped", "Wrong specification ordered", "Customer changed mind", "Warranty", "Job cancelled", "Overshipment"];
const countVarianceReasons = ["Found in adjacent bay", "Unrecorded damage", "Counting error confirmed", "Unrecorded scrap", "Received but not posted", "Shipped but not posted", "Theft or loss under investigation"];
const closeReopenReasons = ["Vendor confirmed partial availability", "Vendor cannot supply", "Customer canceled", "Quantity entered incorrectly", "Discontinued by manufacturer", "Replaced by a newer purchase order"];

/** What each worklist actually searches, for the search box's own placeholder. */
const worklistNoun: Partial<Record<ViewKey, string>> = {
  "purchase-orders": "purchase orders", "expected-receipts": "expected receipts", "vendor-returns": "purchase orders",
  "sales-orders": "sales orders", fulfillment: "sales orders", "customer-returns": "sales orders",
  "customer-invoices": "sales orders", stock: "products", products: "products", counts: "location balances",
  movements: "movements", "vendor-bills": "vendor bills", partners: "customers and vendors",
};

/** Worklist views that should open pre-filtered to the queue they exist to clear. */
const defaultWorklistStatus: Partial<Record<ViewKey, string>> = {
  "expected-receipts": "open",
  fulfillment: "reserved",
  "vendor-returns": "returnable",
  "customer-returns": "shipped",
};

export function InventoryApp({ initialView, initialTab = "overview", initialPurchaseOrderId, initialWorklistQuery = "" }: {
  initialView?: string; initialTab?: string; initialPurchaseOrderId?: string; initialWorklistQuery?: string;
}) {
  const requestedInitialView = initialView as ViewKey | undefined;
  const normalizedInitialView = requestedInitialView && viewTitles[requestedInitialView] ? requestedInitialView : "home";
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [view, setView] = useState<ViewKey>(normalizedInitialView);
  const [selectedPoId, setSelectedPoId] = useState<string | null>(initialPurchaseOrderId ?? null);
  const [selectedSoId, setSelectedSoId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);
  const [editingPartner, setEditingPartner] = useState<Partner | "new" | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [activeCommand, setActiveCommand] = useState<ActiveCommand | null>(null);
  const [createOrder, setCreateOrder] = useState<"purchaseOrder" | "salesOrder" | null>(null);
  const [editingPurchaseOrder, setEditingPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [editingSalesOrder, setEditingSalesOrder] = useState<SalesOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [warehouseReady, setWarehouseReady] = useState(false);
  /**
   * Which request the snapshot on screen actually answers. Changing view, page, or filter keeps
   * the previous scope's records mounted until the new ones arrive, and the tables read that as
   * a result: switching to Sales orders showed "No sales order matches this filter" over an
   * empty purchase-order snapshot. Comparing this against the pending request tells the two
   * states apart. It deliberately does not flip on background refreshes of the same request,
   * which would flash the whole page.
   */
  const [loadedKey, setLoadedKey] = useState("");
  const [source, setSource] = useState<"loading" | "server" | "unavailable">("loading");
  const [sourceError, setSourceError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState(initialTab);
  const [workflowRefreshToken, setWorkflowRefreshToken] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [worklistQuery, setWorklistQuery] = useState(initialWorklistQuery);
  const [appliedWorklistQuery, setAppliedWorklistQuery] = useState(initialWorklistQuery);
  const [worklistStatus, setWorklistStatus] = useState(defaultWorklistStatus[normalizedInitialView] ?? "");
  const [worklistSort, setWorklistSort] = useState("priority");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // Read once during initialisation rather than in a mount effect: an effect would render the
  // panel with every notification visible and then blank the dismissed ones a frame later.
  const [dismissedNotifications, setDismissedNotifications] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = JSON.parse(window.localStorage.getItem("paneflow.dismissedNotifications") ?? "[]") as unknown;
      return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : [];
    } catch { return []; }
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [warehouses, setWarehouses] = useState<Array<{ id: string; label: string }>>([]);
  const [warehouseLookupError, setWarehouseLookupError] = useState("");
  const [warehouseLookupRefresh, setWarehouseLookupRefresh] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const snapshotLoadGeneration = useRef(0);
  const snapshotLoadController = useRef<AbortController | null>(null);
  const navPrefetchTimer = useRef<number | null>(null);

  const loadSnapshot = useCallback(async () => {
    const generation = ++snapshotLoadGeneration.current;
    snapshotLoadController.current?.abort();
    const controller = new AbortController();
    snapshotLoadController.current = controller;
    const request = createSnapshotRequest({ view, page, search: appliedWorklistQuery, status: worklistStatus, sort: worklistSort, warehouseId });
    const cached = snapshotCache.get(request.key);
    if (cached) {
      // Stale-while-revalidate makes Back, pagination revisits, and repeated worklist switches
      // instantaneous without ever trusting cached operational data as the final answer.
      setSnapshot(cached.snapshot);
      setLoadedKey(request.key);
      setSource("server");
      setSourceError("");
      setLastUpdatedAt(new Date(cached.loadedAt));
      setLoading(false);
    }
    try {
      const prefetched = snapshotPrefetches.get(request.key);
      const normalized = await (prefetched ?? requestSnapshot(request.url, controller.signal));
      if (controller.signal.aborted || generation !== snapshotLoadGeneration.current) return;
      rememberSnapshot(request.key, normalized);
      setSnapshot(normalized);
      setLoadedKey(request.key);
      setSource("server");
      setSourceError("");
      setLastUpdatedAt(new Date());
    } catch (caught) {
      if (generation !== snapshotLoadGeneration.current) return;
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setSource("unavailable");
      setSourceError(caught instanceof Error ? caught.message : "The operations service could not be reached.");
    } finally {
      if (snapshotLoadController.current === controller) snapshotLoadController.current = null;
      if (generation === snapshotLoadGeneration.current) setLoading(false);
    }
  }, [appliedWorklistQuery, page, view, warehouseId, worklistSort, worklistStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(1); setAppliedWorklistQuery(worklistQuery.trim()); }, 220);
    return () => window.clearTimeout(timer);
  }, [worklistQuery]);

  useEffect(() => {
    const stored = window.localStorage.getItem("paneflow.warehouse") ?? "";
    const initializationTimer = window.setTimeout(() => {
      setWarehouseId(stored);
      setWarehouseReady(true);
    }, 0);
    const controller = new AbortController();
    void (async () => {
      try {
        const items: Record<string, unknown>[] = [];
        for (let offset = 0; ; offset += 50) {
          const response = await fetch(`/api/snapshot?lookup=warehouses&limit=50&offset=${offset}`, { cache: "no-store", signal: controller.signal });
          const raw = await response.json() as Record<string, unknown>;
          if (!response.ok) throw new Error(text(asRecord(raw.error).message, "Warehouse scope could not be loaded."));
          const page = asRows(raw.items);
          items.push(...page);
          if (page.length < 50) break;
        }
        const rows = items.map((item) => ({ id: text(item.id), label: `${text(item.code)} · ${text(item.name)}` }));
        setWarehouses(rows);
        setWarehouseLookupError("");
        if (stored && !rows.some((row) => row.id === stored)) {
          window.localStorage.removeItem("paneflow.warehouse");
          setWarehouseId("");
        }
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) setWarehouseLookupError(caught instanceof Error ? caught.message : "Warehouse scope could not be loaded.");
      }
    })();
    return () => {
      window.clearTimeout(initializationTimer);
      controller.abort();
    };
  }, [warehouseLookupRefresh]);

  useEffect(() => {
    if (!warehouseReady) return;
    const timer = window.setTimeout(() => void loadSnapshot(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSnapshot, warehouseReady]);

  useEffect(() => {
    preloadViewCode(view);
  }, [view]);

  useEffect(() => () => {
    snapshotLoadGeneration.current += 1;
    snapshotLoadController.current?.abort();
    if (navPrefetchTimer.current !== null) window.clearTimeout(navPrefetchTimer.current);
  }, []);

  useEffect(() => {
    const handlePop = () => {
      const next = new URLSearchParams(window.location.search).get("view") as ViewKey | null;
      const nextTab = new URLSearchParams(window.location.search).get("tab") ?? "overview";
      const restored = next && viewTitles[next] ? next : "home";
      setView(restored);
      setWorkspaceTab(nextTab);
      setWorklistStatus(defaultWorklistStatus[restored] ?? "");
      // Reset the same worklist state that navigate() does. Without this, going Back out of a
      // view carried its search into the next one — landing on Sales orders still filtered to
      // a purchase-order number, showing "0 matching records" for no visible reason.
      setPage(1);
      setWorklistQuery("");
      setAppliedWorklistQuery("");
      setWorklistSort("priority");
      setSelectedPoId(null);
      setSelectedSoId(null);
      setSelectedProductId(null);
      setSelectedPartnerId(null);
      // Back out of a view and any dialog it opened goes with it, for the same reason navigate()
      // closes them: the record behind the dialog is gone.
      setEditingPartner(null);
      setEditingProduct(null);
      setCreatingProduct(false);
      setActiveCommand(null);
      setCreateOrder(null);
      setEditingPurchaseOrder(null);
      setEditingSalesOrder(null);
      setSearchOpen(false);
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key === "Escape") {
        setSearchOpen(false);
        setNotificationsOpen(false);
        setAccountOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, []);

  /**
   * Focus after the palette has actually been committed. The open handlers used to schedule this
   * on the next animation frame, which could run before React mounted the input, so the dialog
   * appeared with nothing focused and the first thing the user typed went nowhere.
   */
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  /**
   * A dialog is bound to the record that opened it, and `navigate` drops every selection. Left
   * mounted across a view change the dialog kept rendering against a record the new snapshot no
   * longer carries — a shipment dialog survived onto the Partners screen showing an empty line
   * and a literal "undefined" ship-to address. Closing them is part of navigating.
   */
  const closeAllDialogs = () => {
    setEditingPartner(null);
    setEditingProduct(null);
    setCreatingProduct(false);
    setActiveCommand(null);
    setCreateOrder(null);
    setEditingPurchaseOrder(null);
    setEditingSalesOrder(null);
    setSearchOpen(false);
    setNotificationsOpen(false);
    setAccountOpen(false);
  };

  const navigate = (next: ViewKey, status?: string, tab = "overview") => {
    preloadViewCode(next);
    closeAllDialogs();
    setView(next);
    setPage(1);
    setSelectedPoId(null);
    setSelectedSoId(null);
    setSelectedProductId(null);
    setSelectedPartnerId(null);
    setWorkspaceTab(tab);
    // These views exist to work a queue, so they open already filtered to it. Without this
    // the row count reads the whole table while the page shows only the open subset.
    setWorklistQuery(""); setAppliedWorklistQuery(""); setWorklistStatus(status ?? defaultWorklistStatus[next] ?? ""); setWorklistSort("priority");
    setMobileNavOpen(false);
    const url = new URL(window.location.href);
    if (next === "home") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    if (tab === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    url.searchParams.delete("po");
    url.searchParams.delete("number");
    window.history.pushState({}, "", url);
    document.getElementById("main-content")?.focus();
  };
  const prefetchView = (next: ViewKey, status?: string) => {
    preloadViewCode(next);
    prefetchSnapshot(createSnapshotRequest({
      view: next,
      page: 1,
      search: "",
      status: status ?? defaultWorklistStatus[next] ?? "",
      sort: "priority",
      warehouseId,
    }));
  };
  const scheduleViewPrefetch = (next: ViewKey) => {
    preloadViewCode(next);
    if (navPrefetchTimer.current !== null) window.clearTimeout(navPrefetchTimer.current);
    navPrefetchTimer.current = window.setTimeout(() => {
      navPrefetchTimer.current = null;
      prefetchView(next);
    }, 80);
  };
  const cancelViewPrefetch = () => {
    if (navPrefetchTimer.current === null) return;
    window.clearTimeout(navPrefetchTimer.current);
    navPrefetchTimer.current = null;
  };
  const changeWorkspaceTab = (tab: string) => {
    closeAllDialogs();
    setWorkspaceTab(tab);
    const url = new URL(window.location.href);
    if (tab === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url);
  };
  const switchTenant = async (tenantId: string) => {
    if (!tenantId || tenantId === snapshot.viewer.tenant.id) return;
    setSource("loading");
    try {
      const response = await fetch("/api/tenants/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId }) });
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(text(asRecord(result.error).message, "Organization could not be switched."));
      window.localStorage.removeItem("paneflow.warehouse");
      window.location.reload();
    } catch (error) {
      setSource("unavailable");
      setSourceError(error instanceof Error ? error.message : "Organization could not be switched.");
    }
  };
  const createTenant = async () => {
    const name = window.prompt("Organization name");
    if (!name?.trim()) return;
    setSource("loading");
    try {
      const response = await fetch("/api/tenants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(text(asRecord(result.error).message, "Organization could not be created."));
      window.localStorage.removeItem("paneflow.warehouse");
      window.location.reload();
    } catch (error) {
      setSource("unavailable");
      setSourceError(error instanceof Error ? error.message : "Organization could not be created.");
    }
  };
  const addTenantMember = async () => {
    const email = window.prompt("Registered member email");
    if (!email?.trim()) return;
    const role = window.prompt("Role: viewer, operator, accounting, manager, or administrator", "viewer");
    if (!role?.trim()) return;
    try {
      const response = await fetch("/api/tenants/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim(), role: role.trim().toLowerCase() }) });
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(text(asRecord(result.error).message, "Member could not be added."));
      setToast(text(result.message, "Organization member added."));
      await loadSnapshot();
      setWorkflowRefreshToken((current) => current + 1);
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Member could not be added.");
    }
  };

  const selectedPo = snapshot.purchaseOrders.find((po) => po.id === selectedPoId) ?? null;
  const selectedSo = snapshot.salesOrders.find((so) => so.id === selectedSoId) ?? null;
  const selectedProduct = snapshot.products.find((product) => product.id === selectedProductId) ?? null;
  // Counted from the whole-database summary, never from the page in front of you. These used
  // to filter the current page, so the same bell read "6 approvals waiting" on Purchasing and
  // "0" on Sales — the badge changed meaning depending on where you happened to be standing.
  const operationalNotifications = useMemo(() => {
    const { lateReceipts, approvals, matchExceptions, blockedSales } = snapshot.summary;
    const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
    const items: Array<{ id: string; tone: Severity; title: string; detail: string; view: ViewKey; status?: string; tab?: string }> = [];
    if (lateReceipts) items.push({ id: `late-receipts:${lateReceipts}`, tone: "danger", title: `${plural(lateReceipts, "late receipt")}`, detail: "Approved purchase orders are past their expected date with quantity still open.", view: "expected-receipts", status: "late" });
    if (approvals) items.push({ id: `purchase-approvals:${approvals}`, tone: "warning", title: `${plural(approvals, "purchase approval")} waiting`, detail: "Review the current durable revisions before deciding.", view: "purchase-orders", tab: "approvals" });
    if (matchExceptions) items.push({ id: `bill-exceptions:${matchExceptions}`, tone: "warning", title: `${plural(matchExceptions, "vendor bill exception")}`, detail: "Price or quantity differs from the authorized purchasing records.", view: "vendor-bills", status: "exception", tab: "match" });
    if (blockedSales) items.push({ id: `blocked-sales:${blockedSales}`, tone: "info", title: `${plural(blockedSales, "blocked sales order")}`, detail: "Open demand exceeds available stock and approved incoming supply.", view: "sales-orders", status: "blocked" });
    return items;
  }, [snapshot.summary]);
  const visibleNotifications = operationalNotifications.filter((item) => !dismissedNotifications.includes(item.id));
  const dismissNotification = (id: string) => setDismissedNotifications((current) => {
    const next = current.includes(id) ? current : [...current, id];
    window.localStorage.setItem("paneflow.dismissedNotifications", JSON.stringify(next));
    return next;
  });

  const pageTotalKey: Partial<Record<ViewKey, string>> = {
    "purchase-orders": "purchaseOrders", "expected-receipts": "purchaseOrders", "vendor-returns": "purchaseOrders",
    "sales-orders": "salesOrders", fulfillment: "salesOrders", "customer-returns": "salesOrders", "customer-invoices": "salesOrders",
    stock: "products", products: "products", partners: "partners", counts: "countBalances", movements: "movements", reports: "products", "vendor-bills": "bills",
  };
  const pageTotal = snapshot.pagination.filteredTotal ?? snapshot.pagination.totals[pageTotalKey[view] ?? ""] ?? 0;
  const pageCount = Math.max(1, Math.ceil(pageTotal / snapshot.pagination.pageSize));
  const currentSnapshotKey = createSnapshotRequest({ view, page, search: appliedWorklistQuery, status: worklistStatus, sort: worklistSort, warehouseId }).key;

  const localSearchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return [
      ...snapshot.purchaseOrders
        .filter((item) => `${item.number} ${item.vendor} ${item.customerRef ?? ""}`.toLowerCase().includes(term))
        .map((item) => ({ type: "Purchase order", id: item.id, label: item.number, detail: item.vendor, view: "purchase-orders" as ViewKey, page })),
      ...snapshot.salesOrders
        .filter((item) => `${item.number} ${item.customer} ${item.project}`.toLowerCase().includes(term))
        .map((item) => ({ type: "Sales order", id: item.id, label: item.number, detail: [item.customer, item.project].filter(Boolean).join(" · "), view: "sales-orders" as ViewKey, page })),
      ...snapshot.products
        .filter((item) => `${item.sku} ${item.name} ${item.specification} ${item.customerRef ?? ""}`.toLowerCase().includes(term))
        .map((item) => ({ type: "Product / unit", id: item.id, label: item.sku, detail: item.name, view: "stock" as ViewKey, page })),
      ...snapshot.partners
        .filter((item) => `${item.name} ${item.email ?? ""} ${item.phone ?? ""}`.toLowerCase().includes(term))
        .map((item) => ({ type: "Business partner", id: item.id, label: item.name, detail: titleCase(item.type), view: "partners" as ViewKey, page })),
    ].slice(0, 10);
  }, [page, query, snapshot]);

  useEffect(() => {
    const term = query.trim();
    if (!term) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/snapshot?q=${encodeURIComponent(term)}&limit=10`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Search unavailable");
        const raw = await response.json() as Record<string, unknown>;
        /**
         * Round-robin rather than concatenate-then-truncate. Every type was already being
         * fetched, but the list was built purchase orders first and cut at ten, so searching a
         * vendor by name returned ten of that vendor's purchase orders and never the vendor —
         * the record that was actually asked for was fetched and then thrown away.
         */
        const grouped = [
          asRows(raw.partners).map((item) => ({ type: "Business partner", id: text(item.id), label: text(item.name), detail: [text(item.code), titleCase(text(item.partnerType))].filter(Boolean).join(" · "), view: "partners" as ViewKey, page: number(item.page, 1) })),
          asRows(raw.products).map((item) => ({ type: "Product / unit", id: text(item.id), label: text(item.sku), detail: text(item.name), view: "stock" as ViewKey, page: number(item.page, 1) })),
          asRows(raw.purchaseOrders).map((item) => ({ type: "Purchase order", id: text(item.id), label: text(item.number), detail: text(item.vendorName), view: "purchase-orders" as ViewKey, page: number(item.page, 1) })),
          asRows(raw.salesOrders).map((item) => ({ type: "Sales order", id: text(item.id), label: text(item.number), detail: [text(item.customerName), text(item.projectReference)].filter(Boolean).join(" · "), view: "sales-orders" as ViewKey, page: number(item.page, 1) })),
        ];
        const merged: SearchResult[] = [];
        for (let index = 0; merged.length < 10; index += 1) {
          const filled = merged.length;
          for (const group of grouped) if (group[index] && merged.length < 10) merged.push(group[index]);
          if (merged.length === filled) break;
        }
        setSearchResults(merged);
        setSearchError("");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSearchResults(localSearchResults);
          setSearchError("Company-wide search is unavailable. Results below are limited to the current page.");
        }
      }
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, localSearchResults]);

  const displayedSearchResults = query.trim() ? searchResults : [];

  const runCommand = async (kind: CommandKind, entityId: string, entityNumber: string, payload: Record<string, unknown>) => {
    const idempotencyKey = crypto.randomUUID();
    const po = snapshot.purchaseOrders.find((item) => item.id === entityId);
    const so = snapshot.salesOrders.find((item) => item.id === entityId);
    const product = snapshot.products.find((item) => item.id === entityId);
    const commandMap: Record<CommandKind, string> = {
      receive: Array.isArray(payload.lines) ? "postReceiptBatch" : "postReceipt",
      close: "closeRemainder",
      reopen: "reopenRemainder",
      reverse: "reverseReceipt",
      "vendor-return": payload.disposition === "allowance" ? "priceOnlyCredit" : "vendorReturn",
      reserve: "reserveSale",
      ship: "shipSale",
      "immediate-sale": "postImmediateSale",
      "customer-return": "customerReturn",
      count: "inventoryAdjustment",
    };
    const apiEntityId = kind === "reverse" ? po?.latestReceiptId ?? entityId : entityId;
    const apiVersion = kind === "reverse"
      ? po?.latestReceiptVersion ?? 1
      : kind === "count"
        ? Number(payload.balanceVersion ?? 0)
        : kind === "receive"
          ? Array.isArray(payload.lines) ? 1 : po?.lines.find((line) => line.id === payload.lineId)?.version ?? 1
          : po?.version ?? so?.version ?? product?.version ?? 1;
    const apiPayload: Record<string, unknown> = {
      ...payload,
      damagedQuantity: payload.quarantineQuantity,
      replacementExpected: payload.disposition === "replacement" || payload.disposition === "repair",
      condition: payload.disposition === "available" ? "usable" : payload.disposition === "damaged" ? "damaged" : "quarantine",
    };
    if (kind === "count" && product) {
      apiPayload.locationId = String(payload.locationId ?? "");
      apiPayload.countedQuantity = Number(payload.quantity ?? 0);
    }
    let response: Response;
    try {
      response = await fetch("/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          command: commandMap[kind],
          entityId: apiEntityId,
          payload: apiPayload,
          idempotencyKey,
          version: apiVersion,
        }),
      });
    } catch (error) {
      throw new Error(`The durable workflow service could not be reached. No changes were made. ${error instanceof Error ? error.message : ""}`.trim());
    }
    const result = (await response.json()) as { snapshot?: unknown; message?: string; invoiceNumber?: string; error?: string | { code?: string; message?: string; currentVersion?: number } };
    if (!response.ok) {
      const message = typeof result.error === "string" ? result.error : result.error?.message || "The command could not be completed.";
      const code = typeof result.error === "object" ? result.error?.code ?? "COMMAND_FAILED" : "COMMAND_FAILED";
      const currentVersion = typeof result.error === "object" ? result.error?.currentVersion : undefined;
      throw new CommandRequestError(message, code, currentVersion);
    }
    if (result.snapshot) setSnapshot(normalizeSnapshot(result.snapshot));
    else await loadSnapshot();
    setSource("server");
    setToast(result.message || `${entityNumber} was updated.`);
    setActiveCommand(null);
    if (kind === "immediate-sale") navigate("customer-invoices", undefined, "billing-actions");
  };

  const countApprovalFromResponse = (response: unknown, approvalId: string): CountApproval => {
    const parts = workflowSnapshotParts(response);
    const advanced = parts.advanced && typeof parts.advanced === "object" ? parts.advanced as Record<string, unknown> : {};
    const permissions = advanced.permissions && typeof advanced.permissions === "object" ? advanced.permissions as Record<string, unknown> : {};
    const actions = permissions.actions && typeof permissions.actions === "object" ? permissions.actions as Record<string, unknown> : {};
    const approvals = Array.isArray(advanced.approvals) ? advanced.approvals.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
    const approval = approvals.find((item) => String(item.id) === approvalId);
    return {
      id: approvalId,
      version: Number(approval?.version ?? 1),
      status: (["pending", "approved", "rejected"].includes(String(approval?.status)) ? String(approval?.status) : "pending") as CountApproval["status"],
      canApprove: actions.approveApproval === true || permissions.canApprove === true,
    };
  };

  const fetchCountApproval = async (approvalId: string) => {
    const response = await fetch(`/api/workflows?page=1&pageSize=100&asOf=${localDateString()}`, { cache: "no-store" });
    const result = await response.json() as { error?: string | { message?: string } };
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "Approval status could not be refreshed.");
    return countApprovalFromResponse(result, approvalId);
  };

  const requestCountApproval = async (entityId: string, payload: Record<string, unknown>) => {
    const product = snapshot.products.find((item) => item.id === entityId);
    if (!product) throw new Error("The counted product is no longer available. Refresh and try again.");
    const locationId = String(payload.locationId ?? "");
    const recordedQuantity = Number(payload.recordedQuantity);
    const countedQuantity = Number(payload.quantity ?? 0);
    if (!locationId || !Number.isFinite(recordedQuantity)) throw new Error("Select a current durable location balance before requesting approval.");
    if (countedQuantity < 0) throw new Error("The counted quantity cannot be negative.");
    const idempotencyKey = crypto.randomUUID();
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({
        command: "requestApproval",
        entityId,
        idempotencyKey,
        payload: inventoryCountApprovalPayload({ productId: entityId, locationId, recordedQuantity, countedQuantity, reason: String(payload.reason ?? "Inventory count variance") }),
      }),
    });
    const result = await response.json() as { recordId?: string; message?: string; error?: string | { message?: string } };
    if (!response.ok || !result.recordId) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "Approval could not be requested.");
    return { approval: await fetchCountApproval(result.recordId), message: result.message ?? "Manager approval requested." };
  };

  const decideCountApproval = async (approval: CountApproval, reason: string) => {
    const idempotencyKey = crypto.randomUUID();
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ command: "approveApproval", entityId: approval.id, version: approval.version, idempotencyKey, payload: { reason } }),
    });
    const result = await response.json() as { message?: string; error?: string | { message?: string } };
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "Approval could not be completed.");
    return { approval: await fetchCountApproval(approval.id), message: result.message ?? "Count variance approved." };
  };

  const refreshCountApproval = async (approval: CountApproval) => {
    return fetchCountApproval(approval.id);
  };

  /**
   * Activating a draft used to live only in the workspace tabs, so creating an order dropped
   * you on a document whose own instructions ("confirmation is required") pointed somewhere
   * else. Both order types can now be advanced from the page you land on.
   */
  const activateDraft = async (command: "confirmSalesOrder" | "submitPurchaseOrder", entityId: string, version: number, reason: string, fallback: string) => {
    const idempotencyKey = crypto.randomUUID();
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ command, entityId, version, idempotencyKey, payload: { reason } }),
    });
    const result = await response.json() as { message?: string; error?: string | { message?: string } };
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? fallback);
    await loadSnapshot();
    setWorkflowRefreshToken((current) => current + 1);
    setToast(result.message ?? fallback);
  };

  const createOperationalOrder = async (type: "purchaseOrder" | "salesOrder", payload: Record<string, unknown>) => {
    const idempotencyKey = crypto.randomUUID();
    const fastTrack = payload.fastTrack === true;
    const command = type === "purchaseOrder"
      ? fastTrack ? "createApprovedPurchaseOrder" : "createPurchaseOrderDraft"
      : fastTrack ? "createConfirmedSalesOrder" : "createSalesOrderDraft";
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ command, payload, idempotencyKey }),
    });
    const result = (await response.json()) as { snapshot?: unknown; recordId?: string; number?: string; message?: string; error?: string | { message?: string } };
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message || "The order could not be created.");
    setWorkflowRefreshToken((current) => current + 1);
    setSource("server");
    setToast(result.message || "Order created.");
    setCreateOrder(null);
    // A new draft sorts to the back of a worklist thousands of rows long, so navigating alone
    // dropped the user on a list that did not contain the order they had just keyed. Scoping
    // the worklist to its document number puts it on screen and lets the detail open.
    if (type === "purchaseOrder") {
      navigate("purchase-orders");
      if (result.number) { setWorklistQuery(result.number); setAppliedWorklistQuery(result.number); }
      if (result.recordId) setSelectedPoId(result.recordId);
    } else {
      navigate("sales-orders");
      if (result.number) { setWorklistQuery(result.number); setAppliedWorklistQuery(result.number); }
      if (result.recordId) setSelectedSoId(result.recordId);
    }
  };

  const updateOperationalSalesOrder = async (order: SalesOrder, payload: Record<string, unknown>) => {
    const idempotencyKey = crypto.randomUUID();
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ command: "updateSalesOrderDraft", entityId: order.id, version: order.version, payload, idempotencyKey }),
    });
    const result = await response.json() as { message?: string; error?: string | { message?: string } };
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message || "The sales-order draft could not be updated.");
    await loadSnapshot();
    setWorkflowRefreshToken((current) => current + 1);
    setToast(result.message || "Sales-order draft updated.");
    setEditingSalesOrder(null);
  };

  const updateOperationalPurchaseOrder = async (order: PurchaseOrder, payload: Record<string, unknown>) => {
    const idempotencyKey = crypto.randomUUID();
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ command: "updatePurchaseOrderDraft", entityId: order.id, version: order.version, payload, idempotencyKey }),
    });
    const result = await response.json() as { message?: string; error?: string | { message?: string } };
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message || "The purchase-order draft could not be updated.");
    await loadSnapshot();
    setWorkflowRefreshToken((current) => current + 1);
    setToast(result.message || "Purchase-order draft updated.");
    setEditingPurchaseOrder(null);
  };

  return (
    <PickerPermissionsContext.Provider value={snapshot.viewer.permissions}>
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`} aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <div><strong>PaneFlow</strong><small>{snapshot.viewer.tenant.name || "Loading organization…"}</small></div>
        </div>
        {snapshot.viewer.tenants.length ? <div className="tenant-switcher"><span>Organization</span><div className="tenant-switcher-row"><select aria-label="Current organization" value={snapshot.viewer.tenant.id} disabled={snapshot.viewer.tenants.length < 2} onChange={(event) => void switchTenant(event.target.value)}>{snapshot.viewer.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select><button type="button" onClick={() => void createTenant()} aria-label="Create organization" title="Create organization">+</button>{snapshot.viewer.permissions.canAdminister ? <button type="button" onClick={() => void addTenantMember()} aria-label="Add organization member" title="Add organization member">+👤</button> : null}</div></div> : null}
        <nav className="nav-groups">
          {navGroups.map((group, index) => (
            <div className="nav-group" key={group.label ?? index}>
              {group.label && <p className="nav-label">{group.label}</p>}
              {group.items.map((item) => (
                <button
                  key={`${item.key}:${item.tab ?? "overview"}`}
                  className={`nav-item ${navItemIsActive(item, view, workspaceTab) ? "active" : ""}`}
                  onPointerEnter={() => scheduleViewPrefetch(item.key)}
                  onPointerLeave={cancelViewPrefetch}
                  onFocus={() => preloadViewCode(item.key)}
                  onClick={() => navigate(item.key, undefined, item.tab ?? "overview")}
                  aria-current={navItemIsActive(item, view, workspaceTab) ? "page" : undefined}
                  // Named explicitly, with the badge folded in: the glyph is decorative and the
                  // tree was reading these as unnamed buttons.
                  aria-label={item.key === "expected-receipts" && snapshot.summary.lateReceipts > 0 ? `${item.label}, ${snapshot.summary.lateReceipts} late` : item.key === "vendor-bills" && snapshot.summary.matchExceptions > 0 ? `${item.label}, exceptions present` : item.label}
                >
                  <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>
                  <span>{item.label}</span>
                  {item.key === "expected-receipts" && snapshot.summary.lateReceipts > 0 && <span className="nav-count" aria-hidden="true">{snapshot.summary.lateReceipts}</span>}
                  {item.key === "vendor-bills" && snapshot.summary.matchExceptions > 0 && <span className="nav-dot" aria-hidden="true" />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-avatar" aria-hidden="true">{initials(snapshot.viewer.name)}</div>
          <div><strong>{snapshot.viewer.name || "Signing in…"}</strong><small>{snapshot.viewer.role ? titleCase(snapshot.viewer.role) : "Role pending"}</small></div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen((open) => !open)}>☰</button>
          <button className="global-search" aria-label="Open global search" onClick={() => setSearchOpen(true)}>
            <span aria-hidden="true">⌕</span><span>Search orders, products, customers…</span><kbd>Ctrl K</kbd>
          </button>
          <div className="topbar-actions">
            {/* Branch count grows with the business, so this goes through the picker and
                becomes type-to-filter on its own once it outgrows a glance. */}
            {warehouses.length ? <div className="warehouse-selector"><span className="online-dot" aria-hidden="true" /><SearchableSelect label="Warehouse scope" hideLabel placeholder="All active locations" value={warehouseId} options={[{ id: "", label: "All active locations" }, ...warehouses]} setValue={(next) => { setWarehouseId(next); setPage(1); window.localStorage.setItem("paneflow.warehouse", next); }} /></div> : null}
            <button className="icon-button notification-button" aria-label="Open notifications" aria-expanded={notificationsOpen} onClick={() => { setAccountOpen(false); setNotificationsOpen((open) => !open); }}>
              ♧{visibleNotifications.length ? <span className="notification-count">{visibleNotifications.length}</span> : null}
            </button>
            <button className="avatar-button" title={snapshot.viewer.email ? `${snapshot.viewer.name} · ${titleCase(snapshot.viewer.role)} · ${snapshot.viewer.email}` : "Signing in…"} aria-label={snapshot.viewer.name ? `Open account menu for ${snapshot.viewer.name}, ${titleCase(snapshot.viewer.role)}` : "Signing in"} aria-expanded={accountOpen} onClick={() => { setNotificationsOpen(false); setAccountOpen((open) => !open); }}>{initials(snapshot.viewer.name)}</button>
          </div>
        </header>

        {notificationsOpen && (
          <section className="popover notification-panel" aria-label="Tasks and notifications">
            <div className="popover-header"><div><strong>Tasks requiring action</strong><small>{visibleNotifications.length} open</small></div><div className="popover-header-actions">{visibleNotifications.length ? <button className="text-button" onClick={() => visibleNotifications.forEach((item) => dismissNotification(item.id))}>Dismiss all</button> : null}<button className="icon-button" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}>×</button></div></div>
            {visibleNotifications.map((item) => <NotificationItem key={item.id} tone={item.tone} title={item.title} detail={item.detail} onDismiss={() => dismissNotification(item.id)} onOpen={() => { setNotificationsOpen(false); navigate(item.view, item.status, item.tab); }} />)}
            {!visibleNotifications.length ? <div className="empty-inline">No current undismissed exceptions.</div> : null}
          </section>
        )}
        {accountOpen && <section className="popover account-panel" aria-label="Account menu"><div className="account-summary"><div className="user-avatar" aria-hidden="true">{initials(snapshot.viewer.name)}</div><div><strong>{snapshot.viewer.name}</strong><small>{snapshot.viewer.email}</small><span>{titleCase(snapshot.viewer.role)}</span></div></div><EmailConnectionManager compact /><a className="button secondary" href="/signout-with-chatgpt?return_to=%2F">Sign out</a></section>}

        <main id="main-content" tabIndex={-1} className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow-row"><span className={`connection ${source}`}>{source === "server" ? "Connected" : source === "loading" ? "Connecting" : "Connection interrupted"}</span><span>{lastUpdatedAt ? `Last updated ${lastUpdatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "No successful refresh yet"}</span></div>
              <h1>{view === "reports" ? reportsPageTitle(workspaceTab) : viewTitles[view].title}</h1>
              {viewTitles[view].description ? <p>{viewTitles[view].description}</p> : null}
            </div>
            <PageActions view={view} source={source} canOperate={snapshot.viewer.permissions.canOperate} canApprove={snapshot.viewer.permissions.canApprove} onNavigate={navigate} onCreate={setCreateOrder} onCreatePartner={() => setEditingPartner("new")} onCreateProduct={() => setCreatingProduct(true)} />
          </div>
          <WorkflowGuide view={view} workspaceTab={workspaceTab} onNavigate={navigate} />
          {source === "unavailable" ? <div className="connection-error" role="alert"><div><strong>Couldn&apos;t refresh operations data.</strong><p>{sourceError || "The last successfully loaded records remain on screen; no sample data was substituted."}</p></div><button className="button secondary" onClick={() => void loadSnapshot()}>Retry</button></div> : null}
          {warehouseLookupError ? <div className="connection-error" role="alert"><div><strong>Warehouse scope unavailable.</strong><p>{warehouseLookupError} Company-wide records remain visible.</p></div><button className="button secondary" onClick={() => setWarehouseLookupRefresh((current) => current + 1)}>Retry</button></div> : null}
          {/* A view has a worklist only if it has a noun for one. Reports paginates a projected
              availability report, but showing "542 matching records" above an AR aging table
              described a list the reader was not looking at. */}
          {worklistNoun[view] ? <ServerWorklistControls view={view} query={worklistQuery} setQuery={setWorklistQuery} status={worklistStatus} setStatus={(value) => { setPage(1); setWorklistStatus(value); }} sort={worklistSort} setSort={(value) => { setPage(1); setWorklistSort(value); }} total={pageTotal} /> : null}

          {loading || (source !== "unavailable" && loadedKey !== currentSnapshotKey) ? <LoadingState /> : (
            <Suspense fallback={<LoadingState />}>
              {view === "home" && <Dashboard snapshot={snapshot} navigate={navigate} openPo={setSelectedPoId} />}
              {view === "purchase-orders" && (
                <OperationsWorkspace workspace="purchasing" initialTab={workspaceTab} onTabChange={changeWorkspaceTab} onDurableRefresh={loadSnapshot} refreshToken={workflowRefreshToken} filterReference={appliedWorklistQuery} onCreateOrder={() => setCreateOrder("purchaseOrder")} onOpenOrder={(record) => { changeWorkspaceTab("overview"); setWorklistQuery(record.number); setAppliedWorklistQuery(record.number); setSelectedPoId(record.id); }}>
                {selectedPo ? (
                  <PurchaseOrderDetail po={selectedPo} canOperate={snapshot.viewer.permissions.canOperate} onBack={() => setSelectedPoId(null)} onEdit={() => setEditingPurchaseOrder(selectedPo)} onCommand={(kind) => setActiveCommand({ kind, entityId: selectedPo.id, entityNumber: selectedPo.number })} onOpenVendorBilling={(tab = "overview") => { navigate("vendor-bills", undefined, tab); setWorklistQuery(selectedPo.number); setAppliedWorklistQuery(selectedPo.number); }} onOpenApprovalQueue={() => navigate("purchase-orders", undefined, "approvals")} onOpenDropShip={() => navigate("sales-orders", undefined, "drop-ship")} onSubmitForApproval={(reason) => activateDraft("submitPurchaseOrder", selectedPo.id, selectedPo.version, reason, `${selectedPo.number} submitted for approval.`)} onChanged={(message) => { setToast(message); void loadSnapshot(); }} />
                ) : (
                  <PurchaseOrdersView orders={snapshot.purchaseOrders} canOperate={snapshot.viewer.permissions.canOperate} onOpen={setSelectedPoId} onReceive={(po) => setActiveCommand({ kind: "receive", entityId: po.id, entityNumber: po.number })} sort={worklistSort} setSort={(value) => { setPage(1); setWorklistSort(value); }} />
                )}
                </OperationsWorkspace>
              )}
              {view === "expected-receipts" && (
                selectedPo ? (
                  <PurchaseOrderDetail po={selectedPo} canOperate={snapshot.viewer.permissions.canOperate} onBack={() => setSelectedPoId(null)} onEdit={() => setEditingPurchaseOrder(selectedPo)} onCommand={(kind) => setActiveCommand({ kind, entityId: selectedPo.id, entityNumber: selectedPo.number })} onOpenVendorBilling={(tab = "overview") => { navigate("vendor-bills", undefined, tab); setWorklistQuery(selectedPo.number); setAppliedWorklistQuery(selectedPo.number); }} onOpenApprovalQueue={() => navigate("purchase-orders", undefined, "approvals")} onOpenDropShip={() => navigate("sales-orders", undefined, "drop-ship")} onSubmitForApproval={(reason) => activateDraft("submitPurchaseOrder", selectedPo.id, selectedPo.version, reason, `${selectedPo.number} submitted for approval.`)} onChanged={(message) => { setToast(message); void loadSnapshot(); }} />
                ) : (
                  <PurchaseOrdersView orders={snapshot.purchaseOrders} canOperate={snapshot.viewer.permissions.canOperate} onOpen={setSelectedPoId} onReceive={(po) => setActiveCommand({ kind: "receive", entityId: po.id, entityNumber: po.number })} sort={worklistSort} setSort={(value) => { setPage(1); setWorklistSort(value); }} receivingOnly />
                )
              )}
              {view === "vendor-returns" && <VendorReturnsView orders={snapshot.purchaseOrders} canOperate={snapshot.viewer.permissions.canOperate} onReturn={(po) => setActiveCommand({ kind: "vendor-return", entityId: po.id, entityNumber: po.number })} />}
              {view === "counter-sales" && <CounterSaleScreen
                warehouseId={warehouseId}
                taxDefaultRateBps={snapshot.configuration.taxDefaultRateBps}
                canPost={snapshot.viewer.permissions.canOperate && snapshot.viewer.permissions.canPostFinancial}
                onComplete={(message) => { setToast(message); navigate("customer-invoices", undefined, "billing-actions"); }}
              />}
              {view === "sales-orders" && (
                <OperationsWorkspace workspace="sales" initialTab={workspaceTab} onTabChange={changeWorkspaceTab} onDurableRefresh={loadSnapshot} refreshToken={workflowRefreshToken} filterReference={appliedWorklistQuery} onCreateOrder={() => setCreateOrder("salesOrder")}>
                {selectedSo ? (
                  <SalesOrderDetail so={selectedSo} canOperate={snapshot.viewer.permissions.canOperate} canPostFinancial={snapshot.viewer.permissions.canPostFinancial} onBack={() => setSelectedSoId(null)} onEdit={() => setEditingSalesOrder(selectedSo)} onReserve={() => setActiveCommand({ kind: "reserve", entityId: selectedSo.id, entityNumber: selectedSo.number })} onShip={() => setActiveCommand({ kind: "ship", entityId: selectedSo.id, entityNumber: selectedSo.number })} onImmediateSale={() => setActiveCommand({ kind: "immediate-sale", entityId: selectedSo.id, entityNumber: selectedSo.number })} onOpenCustomerBilling={(tab = "overview") => { navigate("customer-invoices", undefined, tab); setWorklistQuery(selectedSo.number); setAppliedWorklistQuery(selectedSo.number); }} onOpenDropShip={() => navigate("sales-orders", undefined, "drop-ship")} onCreateLinkedPurchaseOrder={() => setCreateOrder("purchaseOrder")} onOpenLinkedPurchaseOrder={() => { const line = selectedSo.lines?.find((candidate) => candidate.linkedPurchaseOrderId); navigate("purchase-orders"); if (line?.linkedPurchaseOrderNumber) { setWorklistQuery(line.linkedPurchaseOrderNumber); setAppliedWorklistQuery(line.linkedPurchaseOrderNumber); } if (line?.linkedPurchaseOrderId) setSelectedPoId(line.linkedPurchaseOrderId); }} onConfirm={(reason) => activateDraft("confirmSalesOrder", selectedSo.id, selectedSo.version, reason, `${selectedSo.number} confirmed.`)} />
                ) : (
                  <SalesOrdersView orders={snapshot.salesOrders} canOperate={snapshot.viewer.permissions.canOperate} onOpen={setSelectedSoId} onShip={(so) => setActiveCommand({ kind: "ship", entityId: so.id, entityNumber: so.number })} sort={worklistSort} setSort={(value) => { setPage(1); setWorklistSort(value); }} />
                )}
                </OperationsWorkspace>
              )}
              {view === "fulfillment" && (
                selectedSo ? (
                  <SalesOrderDetail so={selectedSo} canOperate={snapshot.viewer.permissions.canOperate} canPostFinancial={snapshot.viewer.permissions.canPostFinancial} onBack={() => setSelectedSoId(null)} onEdit={() => setEditingSalesOrder(selectedSo)} onReserve={() => setActiveCommand({ kind: "reserve", entityId: selectedSo.id, entityNumber: selectedSo.number })} onShip={() => setActiveCommand({ kind: "ship", entityId: selectedSo.id, entityNumber: selectedSo.number })} onImmediateSale={() => setActiveCommand({ kind: "immediate-sale", entityId: selectedSo.id, entityNumber: selectedSo.number })} onOpenCustomerBilling={(tab = "overview") => { navigate("customer-invoices", undefined, tab); setWorklistQuery(selectedSo.number); setAppliedWorklistQuery(selectedSo.number); }} onOpenDropShip={() => navigate("sales-orders", undefined, "drop-ship")} onCreateLinkedPurchaseOrder={() => setCreateOrder("purchaseOrder")} onOpenLinkedPurchaseOrder={() => { const line = selectedSo.lines?.find((candidate) => candidate.linkedPurchaseOrderId); navigate("purchase-orders"); if (line?.linkedPurchaseOrderNumber) { setWorklistQuery(line.linkedPurchaseOrderNumber); setAppliedWorklistQuery(line.linkedPurchaseOrderNumber); } if (line?.linkedPurchaseOrderId) setSelectedPoId(line.linkedPurchaseOrderId); }} onConfirm={(reason) => activateDraft("confirmSalesOrder", selectedSo.id, selectedSo.version, reason, `${selectedSo.number} confirmed.`)} />
                ) : (
                  <SalesOrdersView orders={snapshot.salesOrders} canOperate={snapshot.viewer.permissions.canOperate} onOpen={setSelectedSoId} onShip={(so) => setActiveCommand({ kind: "ship", entityId: so.id, entityNumber: so.number })} sort={worklistSort} setSort={(value) => { setPage(1); setWorklistSort(value); }} />
                )
              )}
              {view === "customer-returns" && <CustomerReturnsView orders={snapshot.salesOrders} canOperate={snapshot.viewer.permissions.canOperate} onReturn={(so) => setActiveCommand({ kind: "customer-return", entityId: so.id, entityNumber: so.number })} />}
              {view === "stock" && (
                <OperationsWorkspace workspace="inventory" initialTab={workspaceTab} onTabChange={changeWorkspaceTab} onDurableRefresh={loadSnapshot}>
                  {selectedProduct ? <ProductDetail product={selectedProduct} movements={snapshot.movements} backLabel="inventory" onBack={() => setSelectedProductId(null)} onEdit={snapshot.viewer.permissions.canApprove ? () => setEditingProduct(selectedProduct) : undefined} canManagePictures={snapshot.viewer.permissions.canOperate} canConsolidate={snapshot.viewer.permissions.canAdminister} viewerEmail={snapshot.viewer.email} viewerRole={snapshot.viewer.role} onChanged={(message) => { setToast(message); void loadSnapshot(); }} /> : <InventoryView snapshot={snapshot} onOpen={setSelectedProductId} warehouseId={warehouseId} sort={worklistSort} setSort={(value) => { setPage(1); setWorklistSort(value); }} />}
                </OperationsWorkspace>
              )}
              {view === "products" && (selectedProduct ? <ProductDetail product={selectedProduct} movements={snapshot.movements} backLabel="the catalog" onBack={() => setSelectedProductId(null)} onEdit={snapshot.viewer.permissions.canApprove ? () => setEditingProduct(selectedProduct) : undefined} canManagePictures={snapshot.viewer.permissions.canOperate} canConsolidate={snapshot.viewer.permissions.canAdminister} viewerEmail={snapshot.viewer.email} viewerRole={snapshot.viewer.role} onChanged={(message) => { setToast(message); void loadSnapshot(); }} /> : <CatalogView products={snapshot.products} onOpen={setSelectedProductId} onEdit={snapshot.viewer.permissions.canApprove ? setEditingProduct : undefined} sort={worklistSort} setSort={(value) => { setPage(1); setWorklistSort(value); }} />)}
              {/* Jumping to the order a movement belongs to: navigate first, then select, since
                  navigate clears the current selection. The worklist is searched by the order
                  number so the target is on the page that loads. */}
              {view === "movements" && <MovementsView movements={snapshot.movements} sort={worklistSort} setSort={(value) => { setPage(1); setWorklistSort(value); }} onOpenOrder={(movement) => {
                if (!movement.relatedOrderId || !movement.relatedOrderNumber) return;
                const purchase = movement.relatedOrderKind === "purchase";
                navigate(purchase ? "purchase-orders" : "sales-orders");
                setWorklistQuery(movement.relatedOrderNumber);
                setAppliedWorklistQuery(movement.relatedOrderNumber);
                if (purchase) setSelectedPoId(movement.relatedOrderId); else setSelectedSoId(movement.relatedOrderId);
              }} />}
              {view === "counts" && <OperationsWorkspace workspace="inventory" initialTab={workspaceTab} onTabChange={changeWorkspaceTab} onDurableRefresh={loadSnapshot}><InventoryCountSessions warehouseId={warehouseId} canOperate={snapshot.viewer.permissions.canOperate} canApprove={snapshot.viewer.permissions.canApprove} canAdminister={snapshot.viewer.permissions.canAdminister} onDurableRefresh={loadSnapshot} /></OperationsWorkspace>}
              {view === "vendor-bills" && <OperationsWorkspace workspace="vendor-billing" initialTab={workspaceTab} onTabChange={changeWorkspaceTab} onDurableRefresh={loadSnapshot} filterReference={appliedWorklistQuery}><VendorBillsView bills={snapshot.bills} sort={worklistSort} setSort={(value) => { setPage(1); setWorklistSort(value); }} onOpenPurchaseOrder={(bill) => { if (!bill.purchaseOrderId) return; navigate("purchase-orders"); setWorklistQuery(bill.po); setAppliedWorklistQuery(bill.po); setSelectedPoId(bill.purchaseOrderId); }} /></OperationsWorkspace>}
              {view === "customer-invoices" && <OperationsWorkspace workspace="customer-billing" initialTab={workspaceTab} onTabChange={changeWorkspaceTab} onDurableRefresh={loadSnapshot} filterReference={appliedWorklistQuery}><InvoicesView salesOrders={snapshot.salesOrders} sort={worklistSort} setSort={(value) => { setPage(1); setWorklistSort(value); }} onOpenSalesOrder={(so) => { navigate("sales-orders"); setWorklistQuery(so.number); setAppliedWorklistQuery(so.number); setSelectedSoId(so.id); }} /></OperationsWorkspace>}
              {view === "partners" && <PartnersView partners={snapshot.partners} selectedId={selectedPartnerId} canApprove={snapshot.viewer.permissions.canApprove} canOperate={snapshot.viewer.permissions.canOperate} canAdminister={snapshot.viewer.permissions.canAdminister} onOpen={setSelectedPartnerId} onEdit={setEditingPartner} onChanged={(message) => { setToast(message); void loadSnapshot(); }} onOpenOrder={(order) => { navigate(order.kind === "sales" ? "sales-orders" : "purchase-orders"); setWorklistQuery(order.number); setAppliedWorklistQuery(order.number); if (order.kind === "sales") setSelectedSoId(order.id); else setSelectedPoId(order.id); }} sort={worklistSort} setSort={(value) => { setPage(1); setWorklistSort(value); }} />}
              {view === "reports" && <OperationsWorkspace workspace="controls" initialTab={workspaceTab} onTabChange={changeWorkspaceTab} onDurableRefresh={loadSnapshot}><ReportsView snapshot={snapshot} warehouseId={warehouseId} /></OperationsWorkspace>}
              {view === "warehouse" && <WarehouseView snapshot={snapshot} source={source} canOperate={snapshot.viewer.permissions.canOperate} navigate={navigate} onReceive={(po) => setActiveCommand({ kind: "receive", entityId: po.id, entityNumber: po.number })} />}
            </Suspense>
          )}
          {/* Fifty rows a page over a catalog this size runs to dozens of pages, so Previous /
              Next alone made page 40 a forty-click journey.

              It only belongs under the worklist it pages. Rendering it unconditionally put
              "Page 1 of 27" beneath an opened purchase order and beneath the workflow tabs,
              where it offered to page a table that was no longer on screen. */}
          {source === "server" && pageCount > 1 && workspaceTab === "overview" && !selectedPo && !selectedSo && !selectedProduct && !selectedPartnerId ? <nav className="snapshot-pagination" aria-label={view === "reports" ? "Projected availability pages" : "Record pages"}>
            <button className="button secondary" disabled={page <= 1} onClick={() => setPage(1)}>First</button>
            <button className="button secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
            <label className="page-jump">Page <input type="number" min={1} max={pageCount} value={page} aria-label={`Page number, 1 to ${pageCount}`} onChange={(event) => { const next = Math.trunc(Number(event.target.value)); if (Number.isFinite(next)) setPage(Math.min(Math.max(next, 1), pageCount)); }} /> of {pageCount}</label>
            <button className="button secondary" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</button>
            <button className="button secondary" disabled={page >= pageCount} onClick={() => setPage(pageCount)}>Last</button>
          </nav> : null}
        </main>
      </div>

      {searchOpen && (
        <div className="command-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
          <section className="command-palette" role="dialog" aria-modal="true" aria-label="Global search">
            <div className="command-input-row"><span aria-hidden="true">⌕</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by document, SKU, customer, or dimensions" aria-label="Global search" /><kbd>Esc</kbd></div>
            <div className="search-results">
              {/* The placeholder above already says what is searchable; repeating it in the
                  panel is two sentences for one instruction. */}
              {query.trim() && searchError ? <div className="connection-error" role="alert"><div><strong>Search is limited.</strong><p>{searchError}</p></div></div> : null}
              {query && displayedSearchResults.length === 0 && <div className="empty-inline">No records match “{query}”.</div>}
              {displayedSearchResults.map((result) => (
                <button key={`${result.type}-${result.id}`} onClick={() => {
                  navigate(result.view);
                  setPage(result.page ?? 1);
                  if (result.view === "purchase-orders") setSelectedPoId(result.id);
                  if (result.view === "sales-orders") setSelectedSoId(result.id);
                  if (result.view === "stock") setSelectedProductId(result.id);
                  if (result.view === "partners") setSelectedPartnerId(result.id);
                  setSearchOpen(false);
                  setQuery("");
                }}>
                  <span className="result-type">{result.type}</span><strong>{result.label}</strong><span>{result.detail}</span><b aria-hidden="true">→</b>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {activeCommand && (
        <CommandPanel
          command={activeCommand}
          po={snapshot.purchaseOrders.find((item) => item.id === activeCommand.entityId)}
          so={snapshot.salesOrders.find((item) => item.id === activeCommand.entityId)}
          locations={snapshot.locations}
          countBalances={snapshot.inventoryBalances.filter((item) => item.productId === activeCommand.entityId)}
          warehouseId={warehouseId}
          canPostFinancial={snapshot.viewer.permissions.canPostFinancial}
          onClose={() => setActiveCommand(null)}
          onSubmit={(payload) => runCommand(activeCommand.kind, activeCommand.entityId, activeCommand.entityNumber, payload)}
          onRequestCountApproval={(payload) => requestCountApproval(activeCommand.entityId, payload)}
          onApproveCountApproval={decideCountApproval}
          onRefreshCountApproval={refreshCountApproval}
        />
      )}

      {createOrder && (
        <AdvancedCreateOrderDialog
          type={createOrder}
          partners={snapshot.partners}
          products={snapshot.products}
          warehouseId={warehouseId}
          defaultTaxRateBps={snapshot.configuration.taxDefaultRateBps}
          canFastTrack={snapshot.viewer.permissions.canApprove}
          onClose={() => setCreateOrder(null)}
          onSubmit={(payload) => createOperationalOrder(createOrder, payload)}
        />
      )}

      {editingSalesOrder && (
        <AdvancedCreateOrderDialog
          type="salesOrder"
          initialOrder={editingSalesOrder}
          partners={snapshot.partners}
          products={snapshot.products}
          warehouseId={warehouseId}
          defaultTaxRateBps={snapshot.configuration.taxDefaultRateBps}
          onClose={() => setEditingSalesOrder(null)}
          onSubmit={(payload) => updateOperationalSalesOrder(editingSalesOrder, payload)}
        />
      )}

      {editingPurchaseOrder && (
        <AdvancedCreateOrderDialog
          type="purchaseOrder"
          initialOrder={editingPurchaseOrder}
          partners={snapshot.partners}
          products={snapshot.products}
          warehouseId={warehouseId}
          defaultTaxRateBps={snapshot.configuration.taxDefaultRateBps}
          onClose={() => setEditingPurchaseOrder(null)}
          onSubmit={(payload) => updateOperationalPurchaseOrder(editingPurchaseOrder, payload)}
        />
      )}

      {creatingProduct && (
        <QuickCreateDialog
          kind="product"
          companyReorderPercent={snapshot.configuration.reorderPointPercent}
          submitLabel="Create product"
          onClose={() => setCreatingProduct(false)}
          onCreated={async (option) => { setCreatingProduct(false); setToast(`${option.label} added to the catalog.`); await loadSnapshot(); }}
        />
      )}

      {editingPartner && (
        <PartnerEditor
          partner={editingPartner}
          onClose={() => setEditingPartner(null)}
          onSaved={(message) => { setEditingPartner(null); setToast(message); void loadSnapshot(); }}
        />
      )}

      {editingProduct && (
        <EditProductDialog
          product={editingProduct}
          companyReorderPercent={snapshot.configuration.reorderPointPercent}
          onClose={() => setEditingProduct(null)}
          onSaved={(message) => { setEditingProduct(null); setToast(message); void loadSnapshot(); }}
        />
      )}

      {toast && <div className="toast" role="status"><span aria-hidden="true">✓</span>{toast}</div>}
      {mobileNavOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
    </div>
    </PickerPermissionsContext.Provider>
  );
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/**
 * Write actions are offered only to a role that can actually post them, and only once the
 * snapshot has confirmed which role that is. Showing "Create sales order" to a viewer just
 * moves the refusal from the button to a server error after they have keyed the whole order.
 */
function PageActions({ view, source, canOperate, canApprove, onNavigate, onCreate, onCreatePartner, onCreateProduct }: { view: ViewKey; source: "loading" | "server" | "unavailable"; canOperate: boolean; canApprove: boolean; onNavigate: (view: ViewKey) => void; onCreate: (type: "purchaseOrder" | "salesOrder") => void; onCreatePartner: () => void; onCreateProduct: () => void }) {
  const ready = source === "server";
  if (view === "home") return <button className="button secondary" onClick={() => onNavigate("reports")}>View reports</button>;
  // Warehouse mode used to repeat the connection pill here, a few pixels from the identical one
  // the page eyebrow already renders for every view.
  if (!ready) return null;
  if (view === "purchase-orders") return canOperate ? <button className="button primary" onClick={() => onCreate("purchaseOrder")}>Create purchase order</button> : null;
  if (view === "sales-orders") return canOperate ? <button className="button primary" onClick={() => onCreate("salesOrder")}>Create sales order</button> : null;
  if (view === "stock") return canOperate ? <button className="button secondary" onClick={() => onNavigate("counts")}>Start inventory count</button> : null;
  // Adding a SKU used to be reachable only from inside an order line or the master-data tab,
  // which is the wrong place to look when you are standing on the catalog. Master data is an
  // approver's job, matching the permission the create command itself checks.
  if (view === "products") return canApprove ? <button className="button primary" onClick={onCreateProduct}>Add product</button> : null;
  if (view === "partners") return canApprove ? <button className="button primary" onClick={onCreatePartner}>Add customer / vendor</button> : null;
  return null;
}

function Dashboard({ snapshot, navigate, openPo }: { snapshot: Snapshot; navigate: (view: ViewKey, status?: string, tab?: string) => void; openPo: (id: string) => void }) {
  const due = snapshot.purchaseOrders.filter((po) => po.open > 0 || po.daysLate > 0).slice(0, 4);
  // This panel used to show whichever special-order product happened to sort first, which on a
  // real catalog is a SKU with no demand, no supply, and nothing to watch. Watch the ones that
  // are actually committed to a customer and short.
  const specialOrders = snapshot.products
    // "Awaiting supply" means a customer is waiting. Including rows that only had incoming
    // stock listed products with nothing owed to anyone under a heading, and a caption, that
    // both promised committed demand — three of the five rows had none.
    .filter((product) => (product.inventoryPolicy === "special_order" || product.inventoryPolicy === "drop_ship") && product.demand > 0)
    .sort((first, second) => first.projected - second.projected || second.demand - first.demand)
    .slice(0, 5);
  const dueTable = useLocalTableSort(due, { number: (row) => row.number, vendor: (row) => row.vendor, expected: (row) => row.expectedDate, open: (row) => row.open, impact: (row) => row.customerRef ?? "Stock replenishment" });
  const specialTable = useLocalTableSort(specialOrders, { product: (row) => `${row.name} ${row.sku}`, route: (row) => row.inventoryPolicy, demand: (row) => row.demand, reserved: (row) => row.reserved, incoming: (row) => row.incoming, projected: (row) => row.projected });
  return (
    <div className="dashboard-grid">
      <section className="urgent-band" aria-labelledby="urgent-heading">
        <div><span className="section-kicker">Attention needed</span><h2 id="urgent-heading">Resolve today&apos;s exceptions</h2></div>
        <div className="urgent-actions">
          <button onClick={() => navigate("expected-receipts", "late")}><strong>{snapshot.summary.lateReceipts}</strong><span>Late receipts</span><b>Review →</b></button>
          <button onClick={() => navigate("sales-orders", "blocked")}><strong>{snapshot.summary.blockedSales}</strong><span>Blocked sales orders</span><b>Resolve →</b></button>
          <button onClick={() => navigate("purchase-orders", undefined, "approvals")}><strong>{snapshot.summary.approvals}</strong><span>Approvals waiting</span><b>Review →</b></button>
        </div>
      </section>

      <section className="metric-row" aria-label="Today's work">
        <MetricCard label="Receipts due" value={snapshot.summary.dueReceipts} detail={`${snapshot.summary.openReceiptUnits} total units open`} tone="info" onClick={() => navigate("expected-receipts")} />
        <MetricCard label="Ready to ship" value={snapshot.summary.readyToShip} detail={`${snapshot.summary.readyToShipUnits} reserved units ready`} tone="success" onClick={() => navigate("fulfillment")} />
        {/* Replaced a "Customer pickups" tile that counted a `pickup` fulfillment route the
            schema never defines, so it could only ever read zero. */}
        <MetricCard label="Open warehouse demand" value={snapshot.summary.openDemand} detail="Confirmed stock and special-order units not yet shipped" tone="neutral" onClick={() => navigate("sales-orders")} />
        <MetricCard label="Inventory risks" value={snapshot.summary.inventoryRisks} detail="Below target, short, or on hold" tone="warning" onClick={() => navigate("stock")} />
      </section>

      <section className="panel today-panel">
        {/* Not "today": this is whatever the priority sort put at the top of the receiving queue. */}
        <PanelHeading title="Receipts needing attention" action="View all receipts" onAction={() => navigate("expected-receipts")} />
        <div className="responsive-table">
          <table>
            <caption className="sr-only">Purchase orders requiring receiving attention</caption>
            <thead><tr><SortableHeader label="Purchase order" column="number" sort={dueTable.sort} setSort={dueTable.setSort} /><SortableHeader label="Vendor" column="vendor" sort={dueTable.sort} setSort={dueTable.setSort} /><SortableHeader label="Expected" column="expected" sort={dueTable.sort} setSort={dueTable.setSort} /><SortableHeader label="Open" column="open" sort={dueTable.sort} setSort={dueTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Customer impact" column="impact" sort={dueTable.sort} setSort={dueTable.setSort} /><th><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{dueTable.rows.map((po) => (
              <tr key={po.id}>
                <td><button className="table-link" onClick={() => { navigate("purchase-orders"); openPo(po.id); }}>{po.number}</button></td>
                <td>{po.vendor}</td>
                <td><span className={po.daysLate > 0 ? "text-danger" : ""}>{po.daysLate > 0 ? `${po.daysLate} days late` : po.expectedDate ? formatDate(po.expectedDate) : "Not set"}</span></td>
                <td className="numeric strong">{po.open}</td>
                <td>{po.customerRef ? <span className="allocation-tag">{po.customerRef}</span> : <span className="muted">Stock replenishment</span>}</td>
                <td><button className="row-action" onClick={() => { navigate("purchase-orders"); openPo(po.id); }}>Open</button></td>
              </tr>
            ))}{!due.length ? <tr><td colSpan={6}><div className="empty-inline">No purchase orders currently require receiving attention.</div></td></tr> : null}</tbody>
          </table>
        </div>
      </section>

      <section className="panel activity-panel">
        <PanelHeading title="Recent activity" action="View audit timeline" onAction={() => navigate("reports", undefined, "audit")} />
        {/* Capped: a day at this volume posts dozens of payments and shipments, and an
            uncapped feed pushes every other panel off the dashboard. */}
        <div className="timeline">{snapshot.activities.slice(0, 8).map((activity) => (
          <div className="timeline-item" key={activity.id}><span className={`timeline-dot ${activity.tone}`} /><div><strong>{activity.title}</strong><p>{activity.detail}</p><small>{activity.time}</small></div></div>
        ))}{!snapshot.activities.length ? <div className="empty-inline">No durable activity has been recorded yet.</div> : null}</div>
      </section>

      {specialOrders.length ? <section className="panel wide-panel">
        <PanelHeading title="Special orders awaiting supply" action="View inventory" onAction={() => navigate("stock")} />
        <div className="responsive-table">
          <table>
            <caption className="sr-only">Special-order and drop-ship products with committed customer demand</caption>
            <thead><tr><SortableHeader label="Product" column="product" sort={specialTable.sort} setSort={specialTable.setSort} /><SortableHeader label="Route" column="route" sort={specialTable.sort} setSort={specialTable.setSort} /><SortableHeader label="Open demand" column="demand" sort={specialTable.sort} setSort={specialTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Reserved" column="reserved" sort={specialTable.sort} setSort={specialTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Incoming" column="incoming" sort={specialTable.sort} setSort={specialTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Projected" column="projected" sort={specialTable.sort} setSort={specialTable.setSort} className="numeric" defaultDirection="desc" /></tr></thead>
            <tbody>{specialTable.rows.map((product) => (
              <tr key={product.id}>
                <td><strong>{product.name}</strong><small>{product.sku} · {product.specification}</small></td>
                <td><StatusBadge tone="info">{titleCase(product.inventoryPolicy)}</StatusBadge></td>
                <td className="numeric">{product.demand}</td>
                <td className="numeric">{product.reserved}</td>
                <td className="numeric">{product.incoming}</td>
                <td className={`numeric strong ${product.projected < 0 ? "text-danger" : ""}`}>{product.projected}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section> : null}
    </div>
  );
}

function MetricCard({ label, value, detail, tone, onClick }: { label: string; value: number; detail: string; tone: Severity; onClick: () => void }) {
  return <button className={`metric-card ${tone}`} onClick={onClick}><span>{label}</span><strong>{value}</strong><small>{detail}</small><b>Open worklist →</b></button>;
}

function PanelHeading({ title, detail, action, onAction }: { title: string; detail?: string; action?: string; onAction?: () => void }) {
  return <div className="panel-heading"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action && <button className="text-button" onClick={onAction}>{action} →</button>}</div>;
}

function StatusBadge({ children, tone }: { children: ReactNode; tone?: Severity }) {
  const resolved = tone ?? inferTone(String(children));
  return <span className={`status-badge ${resolved}`}><span aria-hidden="true" />{children}</span>;
}

function inferTone(label: string): Severity {
  const value = label.toLowerCase();
  if (value.includes("late") || value.includes("exception") || value.includes("blocked") || value.includes("shortage")) return "danger";
  if (value.includes("partial") || value.includes("pending") || value.includes("closed short") || value.includes("awaiting")) return "warning";
  if (value.includes("approved") || value.includes("matched") || value.includes("ready") || value.includes("complete")) return "success";
  if (value.includes("not ") || value.includes("draft")) return "neutral";
  return "info";
}

function SortableHeader({ label, column, sort, setSort, className, defaultDirection = "asc" }: {
  label: string;
  column: string;
  sort: string;
  setSort: (value: string) => void;
  className?: string;
  defaultDirection?: SortDirection;
}) {
  const match = /^([^:]+):(asc|desc)$/.exec(sort);
  const activeDirection = match?.[1] === column ? match[2] as SortDirection : null;
  const nextDirection: SortDirection = activeDirection === "asc" ? "desc" : activeDirection === "desc" ? "asc" : defaultDirection;
  const ariaSort = activeDirection === "asc" ? "ascending" : activeDirection === "desc" ? "descending" : "none";
  return <th className={className} aria-sort={ariaSort}>
    <button className="sortable-heading" type="button" onClick={() => setSort(`${column}:${nextDirection}`)} title={`Sort by ${label.toLowerCase()} ${nextDirection === "asc" ? "ascending" : "descending"}`}>
      <span>{label}</span><span className={`sort-indicator ${activeDirection ? "active" : ""}`} aria-hidden="true">{activeDirection === "asc" ? "↑" : activeDirection === "desc" ? "↓" : "↕"}</span>
    </button>
  </th>;
}

function useLocalTableSort<T>(rows: T[], accessors: Record<string, (row: T) => unknown>) {
  const [sort, setSort] = useState("");
  const sortedRows = useMemo(() => {
    const match = /^([^:]+):(asc|desc)$/.exec(sort);
    const accessor = match ? accessors[match[1]] : undefined;
    if (!match || !accessor) return rows;
    const direction = match[2] === "desc" ? -1 : 1;
    return [...rows].sort((left, right) => {
      const leftValue = accessor(left);
      const rightValue = accessor(right);
      // Blank cells sort last in either direction: an unset date is not earlier than every real one.
      const leftBlank = leftValue == null || leftValue === "";
      const rightBlank = rightValue == null || rightValue === "";
      if (leftBlank !== rightBlank) return leftBlank ? 1 : -1;
      if (typeof leftValue === "number" && typeof rightValue === "number") return (leftValue - rightValue) * direction;
      return String(leftValue ?? "").localeCompare(String(rightValue ?? ""), undefined, { numeric: true, sensitivity: "base" }) * direction;
    });
  }, [accessors, rows, sort]);
  return { rows: sortedRows, sort, setSort };
}

/** One overall stage for list scanning. The three detail badges remain independent, while this
 *  label answers the operator's immediate question: what needs to happen next? */
function purchaseOrderStage(po: PurchaseOrder) {
  const lifecycle = po.lifecycle.toLowerCase();
  const billing = po.billing.toLowerCase();
  if (lifecycle === "draft" || lifecycle.includes("pending") || lifecycle === "rejected" || lifecycle === "canceled") return po.lifecycle;
  if (po.open > 0) return po.fulfilled > 0 ? "Partially fulfilled" : "Awaiting fulfillment";
  if (billing.includes("partially")) return "Partially billed";
  if (billing === "fully billed" || billing === "billed") return "Fully billed";
  return "Awaiting vendor bill";
}

const worklistColumnLabels: Partial<Record<ViewKey, Record<string, string>>> = {
  "purchase-orders": { exception: "Exception", number: "PO", vendor: "Vendor", status: "Status", expected: "Expected", ordered: "Ordered", received: "Supplier fulfilled", closed: "Closed", open: "Open fulfillment", billing: "Billing", total: "Total" },
  "expected-receipts": { exception: "Exception", number: "PO", vendor: "Vendor", status: "Status", expected: "Expected", ordered: "Ordered", received: "Net received", closed: "Closed", open: "Open", billing: "Billing", total: "Total" },
  "sales-orders": { exception: "Exception", number: "SO", customer: "Customer", requested: "Requested", availability: "Availability", fulfillment: "Fulfillment", billing: "Invoice", total: "Total" },
  fulfillment: { exception: "Exception", number: "SO", customer: "Customer", requested: "Requested", availability: "Availability", fulfillment: "Fulfillment", billing: "Invoice", total: "Total" },
  stock: { product: "Product", location: "Warehouse location", onHand: "On hand", usable: "Usable", reserved: "Reserved", available: "Available", incoming: "Incoming", demand: "Demand", projected: "Projected", exception: "Exception" },
  products: { product: "Product", configuration: "Configuration", policy: "Policy", units: "Units", standardCost: "Standard cost", lastUnitCost: "Last PO cost", sellingPrice: "Selling price", pricingMode: "Pricing", margin: "Margin", reorderPoint: "Reorder point", maxStockLevel: "Reorder up to" },
  movements: { posted: "Date and time", movement: "Movement", document: "Source document", order: "Order", product: "Product", quantity: "Quantity", from: "From", to: "To", actor: "Posted by" },
  counts: { product: "Product", location: "Warehouse location", recorded: "Book quantity", reserved: "Reserved", available: "Available" },
  partners: { partner: "Partner", type: "Type", contact: "Contact", address: "Address", terms: "Terms", credit: "Credit control" },
  "vendor-bills": { number: "Bill", vendorInvoice: "Vendor invoice", vendor: "Vendor", purchaseOrder: "Purchase order", invoiced: "Invoiced", due: "Due", authorized: "Authorized line value", billed: "Billed line value", variance: "Line variance", tax: "Tax", total: "Bill total", outstanding: "Outstanding", match: "Match", settlement: "Settlement" },
  "customer-invoices": { number: "Sales order", customer: "Customer", ordered: "Ordered", shipped: "Posted fulfillment", invoiced: "Already invoiced", availableToInvoice: "Available to invoice", billing: "State" },
};

function ServerWorklistControls({ view, query, setQuery, status, setStatus, sort, setSort, total }: { view: ViewKey; query: string; setQuery: (value: string) => void; status: string; setStatus: (value: string) => void; sort: string; setSort: (value: string) => void; total: number }) {
  const statusOptions: Partial<Record<ViewKey, Array<[string, string]>>> = {
    // "Open to …" and "Late" are worklist states resolved server-side, so filtering to real
    // work no longer means paging through settled documents looking for it.
    "purchase-orders": [["", "All states"], ["open", "Open fulfillment"], ["late", "Late"], ["closed", "Fulfillment closed"], ["fully_received", "Fully fulfilled"], ["closed_short", "Closed short"], ["draft", "Draft"], ["pending_approval", "Pending approval"], ["approved", "Approved"]],
    "expected-receipts": [["", "All states"], ["open", "Open to receive"], ["late", "Late"], ["approved", "Approved"], ["pending_approval", "Pending approval"]],
    "vendor-returns": [["", "All states"], ["returnable", "Has received quantity"], ["approved", "Approved"]],
    "sales-orders": [["", "All states"], ["open", "Open fulfillment"], ["blocked", "Blocked by supply"], ["reserved", "Reserved"], ["draft", "Draft"], ["confirmed", "Confirmed"], ["canceled", "Canceled"]],
    fulfillment: [["", "All states"], ["reserved", "Reserved"], ["open", "Open fulfillment"], ["confirmed", "Confirmed"]],
    "customer-returns": [["", "All states"], ["shipped", "Has shipped quantity"], ["confirmed", "Confirmed"], ["canceled", "Canceled with shipment history"]],
    stock: [["", "All policies"], ["stocked", "Stocked"], ["special_order", "Special order"], ["drop_ship", "Drop ship"], ["serial", "Serial tracked"], ["lot", "Lot tracked"]],
    products: [["", "All policies"], ["stocked", "Stocked"], ["special_order", "Special order"], ["drop_ship", "Drop ship"], ["serial", "Serial tracked"], ["lot", "Lot tracked"]],
    movements: [["", "All movement types"], ["purchase_receipt", "Purchase receipt"], ["sales_shipment", "Sales shipment"], ["internal_transfer", "Internal transfer"], ["customer_return", "Customer return"], ["vendor_return", "Vendor return"]],
    "vendor-bills": [["", "All bills"], ["outstanding", "Outstanding"], ["settled", "Settled"], ["on_hold", "On hold"], ["matched", "Matched"], ["exception", "Match exception"]],
    partners: [["", "All partner types"], ["customer", "Customers"], ["vendor", "Vendors"]],
  };
  const catalogView = view === "products" || view === "stock";
  const sortOptions = [catalogView ? ["priority", "Product name"] : ["priority", "Operational priority"], ["newest", "Newest first"], ...(catalogView ? [] : [["name", "Name"]]), ...(view === "movements" ? [["oldest", "Oldest first"]] : []), ...(catalogView ? [["sku", "SKU"], ["availability", "Availability"]] : [])] as Array<[string, string]>;
  const columnSort = /^([^:]+):(asc|desc)$/.exec(sort);
  const columnLabel = columnSort ? worklistColumnLabels[view]?.[columnSort[1]] : undefined;
  if (columnSort && columnLabel && !sortOptions.some(([id]) => id === sort)) sortOptions.push([sort, `${columnLabel} ${columnSort[2] === "asc" ? "ascending" : "descending"}`]);
  const asOptions = (pairs: Array<[string, string]>) => pairs.map(([id, label]) => ({ id, label }));
  // Name what is being searched. "the full database worklist" is our word for it, not theirs.
  const scopeLabel = `Search all ${worklistNoun[view] ?? "records"}`;
  return <div className="filter-bar server-worklist-controls"><label className="list-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={scopeLabel} aria-label={scopeLabel} /></label>
    {statusOptions[view] ? <SearchableSelect label="Filter status" hideLabel className="worklist-filter" value={status} setValue={setStatus} options={asOptions(statusOptions[view] ?? [])} placeholder="Filter status" /> : null}
    <SearchableSelect label="Sort worklist" hideLabel className="worklist-filter" value={sort} setValue={setSort} options={asOptions(sortOptions)} placeholder="Sort worklist" />
    <span className="read-only-label">{total} matching record{total === 1 ? "" : "s"}</span></div>;
}

/**
 * A worklist explains the task in front of the user; this map explains what comes next.
 * The highlighted step is page context, not a claim that an individual document has completed
 * every earlier step. Record details continue to show the authoritative three-part status.
 */
function WorkflowGuide({ view, workspaceTab, onNavigate }: { view: ViewKey; workspaceTab: string; onNavigate: (view: ViewKey, status?: string, tab?: string) => void }) {
  let title = "";
  let steps: WorkflowGuideStep[] = [];
  let active = 0;

  if (["purchase-orders", "expected-receipts", "vendor-bills"].includes(view)) {
    title = "Purchase to payment";
    steps = purchasingWorkflow;
    active = view === "purchase-orders" ? 0 : view === "expected-receipts" ? 1 : workspaceTab === "billing-actions" ? 3 : 2;
  } else if (["sales-orders", "fulfillment", "customer-invoices"].includes(view)) {
    title = "Order to cash";
    steps = salesWorkflow;
    active = view === "sales-orders" ? (workspaceTab === "reservations" ? 1 : workspaceTab === "drop-ship" || workspaceTab === "shipment-corrections" ? 2 : 0) : view === "fulfillment" ? 2 : workspaceTab === "billing-actions" ? 4 : 3;
  } else if (view === "vendor-returns") {
    title = "Vendor return";
    steps = vendorReturnWorkflow;
    active = 1;
  } else if (view === "customer-returns") {
    title = "Customer return";
    steps = customerReturnWorkflow;
    active = 1;
  }

  if (!steps.length) return null;
  return <nav className="process-guide" aria-label={`${title} workflow`}>
    <div className="process-guide-title"><span>Workflow map</span><strong>{title}</strong></div>
    <ol>{steps.map((step, index) => <li key={`${step.view}-${step.tab ?? "overview"}-${index}`} className={index === active ? "current" : ""}>
      <button type="button" aria-current={index === active ? "step" : undefined} onClick={() => onNavigate(step.view, undefined, step.tab)}>
        <span className="process-guide-number" aria-hidden="true">{index + 1}</span>
        <span><strong>{step.label}</strong><small>{step.detail}</small></span>
      </button>
    </li>)}</ol>
  </nav>;
}

type RecordProgressState = "complete" | "current" | "upcoming" | "attention" | "stopped";
type RecordProgressDocument = { number: string; detail: string; href?: string };
type RecordProgressStep = { label: string; state: RecordProgressState; summary: string; documents?: RecordProgressDocument[] };
type RecordNextAction = { title: string; detail: string; label?: string; onClick?: () => void; tone?: "info" | "success" | "warning" };

/**
 * The page-level workflow map explains the process. This record-level progression is the
 * operational source of truth: it keeps the order, its fulfillment documents, its financial
 * documents, and the single best next action together.
 */
function RecordProgress({ title, steps, next }: { title: string; steps: RecordProgressStep[]; next: RecordNextAction }) {
  const headingId = useId();
  return <section className="panel record-progress" aria-labelledby={headingId}>
    <header className="record-progress-header"><div><span className="section-kicker">Record progression</span><h3 id={headingId}>{title}</h3></div><p>Connected documents and the next action stay with this order.</p></header>
    <ol className="record-progress-steps">{steps.map((step, index) => <li key={step.label} className={step.state} aria-current={step.state === "current" || step.state === "attention" ? "step" : undefined}>
      <span className="record-progress-marker" aria-hidden="true">{step.state === "complete" ? "✓" : step.state === "attention" ? "!" : index + 1}</span>
      <div className="record-progress-copy"><span>{step.state === "attention" ? "Needs attention" : titleCase(step.state)}</span><strong>{step.label}</strong><p>{step.summary}</p>
        {step.documents?.length ? <div className="record-progress-documents" aria-label={`${step.label} connected documents`}>{step.documents.map((document) => document.href
          ? <a key={`${document.number}-${document.detail}`} href={document.href} download title={`Download ${document.number} as a PDF`}><strong>{document.number}</strong><small>{document.detail}</small></a>
          : <span key={`${document.number}-${document.detail}`}><strong>{document.number}</strong><small>{document.detail}</small></span>)}</div> : null}
      </div>
    </li>)}</ol>
    <div className={`record-next-action ${next.tone ?? "info"}`}><div><span className="section-kicker">Next action</span><strong>{next.title}</strong><p>{next.detail}</p></div>{next.label && next.onClick ? <button className="button primary" type="button" onClick={next.onClick}>{next.label}</button> : null}</div>
  </section>;
}

function PurchaseOrdersView({ orders, canOperate, onOpen, onReceive, sort, setSort, receivingOnly = false }: { orders: PurchaseOrder[]; canOperate: boolean; onOpen: (id: string) => void; onReceive: (po: PurchaseOrder) => void; receivingOnly?: boolean } & WorklistSortProps) {
  // Scoped server-side by the worklist status filter; see SalesOrdersView.
  return <section className="panel worklist">
    <div className="responsive-table"><table><caption className="sr-only">Purchase orders</caption><thead><tr><SortableHeader label="Exception" column="exception" sort={sort} setSort={setSort} defaultDirection="desc" /><SortableHeader label="PO" column="number" sort={sort} setSort={setSort} /><SortableHeader label="Vendor" column="vendor" sort={sort} setSort={setSort} /><SortableHeader label="Status" column="status" sort={sort} setSort={setSort} /><SortableHeader label="Expected" column="expected" sort={sort} setSort={setSort} /><SortableHeader label="Ordered" column="ordered" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label={receivingOnly ? "Net received" : "Supplier fulfilled"} column="received" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Closed" column="closed" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label={receivingOnly ? "Open to receive" : "Open fulfillment"} column="open" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Billing" column="billing" sort={sort} setSort={setSort} /><SortableHeader label="Total" column="total" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><th><span className="sr-only">Action</span></th></tr></thead><tbody>{orders.map((po) => <tr key={po.id}>
      <td>{po.exception ? <span className={`exception-cell ${po.daysLate > 0 ? "danger" : "warning"}`} title={po.exception}>!</span> : <span className="muted">—</span>}</td>
      <td><button className="table-link" onClick={() => onOpen(po.id)}>{po.number}</button><small>Rev {po.revision}</small></td>
      <td><strong>{po.vendor}</strong>{po.customerRef && <small>{po.customerRef}</small>}</td>
      <td><StatusBadge>{purchaseOrderStage(po)}</StatusBadge></td>
      {/* A late order still has to say which date it missed; "6 days late" alone cannot be
          matched against the vendor's confirmation. */}
      <td>{po.daysLate > 0 ? <><StatusBadge tone="danger">{po.daysLate} days late</StatusBadge><small>{expectedDateLabel(po.expectedDate)}</small></> : expectedDateLabel(po.expectedDate)}</td>
      <td className="numeric">{po.ordered}</td><td className="numeric">{receivingOnly ? po.received - po.returned : po.fulfilled}</td><td className="numeric">{po.closed}</td><td className="numeric strong">{receivingOnly ? po.openToReceive : po.open}</td>
      <td><StatusBadge>{po.billing}</StatusBadge></td>
      <td className="numeric strong">{formatDocumentMoney(po.total, po.currency, false)}</td>
      {/* "Open" named both the remaining-quantity column and this button. The action says what
          it does to a document; the column keeps the ERP term for quantity. */}
      <td>{canOperate && po.lifecycle.toLowerCase() === "approved" && po.openToReceive > 0 ? <button className="row-action" onClick={() => onReceive(po)}>Receive</button> : <button className="row-action" onClick={() => onOpen(po.id)}>View</button>}</td>
    </tr>)}{!orders.length ? <tr><td colSpan={12}><div className="empty-inline">No purchase order matches this filter.</div></td></tr> : null}</tbody></table></div>
  </section>;
}

function PurchaseOrderDetail({ po, canOperate, onBack, onEdit, onCommand, onOpenVendorBilling, onOpenApprovalQueue, onOpenDropShip, onSubmitForApproval, onChanged }: { po: PurchaseOrder; canOperate: boolean; onBack: () => void; onEdit: () => void; onCommand: (kind: CommandKind) => void; onOpenVendorBilling: (tab?: string) => void; onOpenApprovalQueue: () => void; onOpenDropShip: () => void; onSubmitForApproval: (reason: string) => Promise<void>; onChanged: (message: string) => void }) {
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState("");
  const [submitNote, setSubmitNote] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  // A rejected revision is the buyer's to correct and resubmit, so it is edited like a draft.
  const lifecycle = po.lifecycle.toLowerCase();
  const isDraft = ["draft", "rejected"].includes(po.lifecycle.toLowerCase());
  const hasStockLines = po.lines.some((line) => line.fulfillmentRoute === "stock");
  const hasDropShipLines = po.lines.some((line) => line.fulfillmentRoute === "drop_ship");
  const hasWarehouseLines = po.lines.some((line) => line.fulfillmentRoute !== "drop_ship");
  const destinationSummary = hasDropShipLines && !hasWarehouseLines
    ? "supplier delivers directly to the customer"
    : hasDropShipLines ? "warehouse receipt or supplier delivery, by line" : "warehouse destination selected per receipt";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setActivating(true); setActivateError("");
    try { await onSubmitForApproval(submitNote.trim()); } catch (caught) { setActivateError(caught instanceof Error ? caught.message : "The purchase order could not be submitted."); }
    finally { setActivating(false); }
  };
  const totals = documentTotals(po.lines.map((line) => ({ quantity: line.ordered, unitAmount: line.unitCost, discountCents: line.discountCents, taxable: line.taxable, taxRateBps: line.taxRateBps })), po);
  const lineTable = useLocalTableSort(po.lines, { line: (row) => po.lines.indexOf(row), product: (row) => `${row.product} ${row.sku}`, customer: (row) => row.customerRef ?? "Stock", ordered: (row) => row.ordered, received: (row) => row.received - row.returned, returned: (row) => row.returned, closed: (row) => row.closed, open: (row) => row.open, unitCost: (row) => row.unitCost, discount: (row) => row.discountCents, tax: (row) => lineTaxAmount(row.ordered, row.unitCost, row.discountCents, row.taxable, row.taxRateBps), amount: (row) => lineNetAmount(row.ordered, row.unitCost, row.discountCents) });
  const activeVendorBills = po.vendorBills.filter((bill) => bill.status.toLowerCase() !== "void");
  const vendorBillOutstanding = activeVendorBills.reduce((sum, bill) => sum + bill.outstanding, 0);
  const billNeedsAttention = activeVendorBills.some((bill) => bill.status.toLowerCase().includes("hold") || bill.matchStatus?.toLowerCase().includes("exception"));
  const billingSaysComplete = ["fully billed", "billed"].includes(po.billing.toLowerCase());
  const fulfillmentDocuments: RecordProgressDocument[] = [
    ...po.receipts.map((receipt) => ({ number: receipt.number, detail: `${receipt.quantity} received · ${formatDocumentDate(receipt.postedAt)}${receipt.packingSlipNumber ? ` · slip ${receipt.packingSlipNumber}` : ""}` })),
    ...po.supplierDeliveries.map((delivery) => ({ number: delivery.number, detail: `${delivery.quantity} delivered · ${formatDocumentDate(delivery.deliveryDate)}${delivery.externalReference ? ` · ${delivery.externalReference}` : ""}` })),
  ];
  const billDocuments: RecordProgressDocument[] = activeVendorBills.map((bill) => ({
    number: bill.number,
    detail: `${bill.externalReference ? `Vendor ${bill.externalReference} · ` : ""}${bill.matchStatus ? `${bill.matchStatus} · ` : ""}${formatDocumentMoney(bill.amount, bill.currency)}${bill.outstanding > 0 ? ` · ${formatDocumentMoney(bill.outstanding, bill.currency)} outstanding` : " · settled"}`,
    href: `/api/documents/pdf?documentType=vendor_bill&documentId=${encodeURIComponent(bill.id)}`,
  }));
  const settlementDocuments: RecordProgressDocument[] = po.settlements.map((settlement) => ({
    number: settlement.number,
    detail: `${titleCase(settlement.kind)}${settlement.appliedTo ? ` to ${settlement.appliedTo}` : ""} · ${formatDocumentDate(settlement.postedAt)} · ${formatDocumentMoney(settlement.amount, settlement.currency)}`,
  }));
  const purchaseProgress: RecordProgressStep[] = [
    { label: "Purchase order", state: lifecycle === "canceled" ? "stopped" : lifecycle === "approved" ? "complete" : lifecycle.includes("pending") || lifecycle === "rejected" ? "attention" : "current", summary: `${po.lifecycle} · revision ${po.revision} · ${formatDocumentMoney(po.total, po.currency)}`, documents: [{ number: po.number, detail: `${po.vendor} · ordered ${formatDocumentDate(po.orderDate)}`, href: `/api/documents/pdf?documentType=purchase_order&documentId=${encodeURIComponent(po.id)}` }] },
    { label: "Supplier fulfillment", state: lifecycle === "canceled" ? "stopped" : po.open <= 0 && lifecycle === "approved" ? "complete" : lifecycle === "approved" ? "current" : "upcoming", summary: `${po.fulfilled} of ${po.ordered} fulfilled · ${po.closed} closed · ${po.open} open`, documents: fulfillmentDocuments },
    { label: "Vendor bill", state: lifecycle === "canceled" ? "stopped" : billNeedsAttention || (billingSaysComplete && !activeVendorBills.length) ? "attention" : billingSaysComplete && activeVendorBills.length > 0 ? "complete" : activeVendorBills.length > 0 || (lifecycle === "approved" && po.open <= 0) ? "current" : "upcoming", summary: activeVendorBills.length ? `${activeVendorBills.length} connected bill${activeVendorBills.length === 1 ? "" : "s"} · ${po.billing}` : billingSaysComplete ? "Billing status is complete, but no connected bill was found" : `${po.billing} · no vendor bill posted`, documents: billDocuments },
    { label: "Payable settlement", state: lifecycle === "canceled" ? "stopped" : activeVendorBills.length && vendorBillOutstanding <= 0 ? "complete" : activeVendorBills.length ? "current" : "upcoming", summary: activeVendorBills.length ? `${formatDocumentMoney(vendorBillOutstanding, po.currency)} outstanding across connected bills` : "Begins after a vendor bill is posted", documents: settlementDocuments },
  ];
  const nextAction: RecordNextAction = lifecycle === "canceled"
    ? { title: "No action — order canceled", detail: "This progression is retained as history.", tone: "success" }
    : isDraft
      ? { title: lifecycle === "rejected" ? "Correct and resubmit the order" : "Finish and submit the order", detail: "Review the lines and supporting note before sending it for approval.", label: "Edit draft", onClick: onEdit }
      : lifecycle.includes("pending")
        ? { title: "Purchasing approval is required", detail: "An approver must accept or reject the commercial commitment before fulfillment.", label: "Open approval queue", onClick: onOpenApprovalQueue, tone: "warning" }
        : po.openToReceive > 0
          ? { title: `Receive ${po.openToReceive} remaining unit${po.openToReceive === 1 ? "" : "s"}`, detail: "Post the warehouse receipt against this order and capture the packing slip.", label: "Receive remaining", onClick: () => onCommand("receive") }
          : po.openToDeliver > 0
            ? { title: `Post ${po.openToDeliver} supplier-delivered unit${po.openToDeliver === 1 ? "" : "s"}`, detail: "Confirm the direct customer delivery without moving internal inventory.", label: "Post supplier delivery", onClick: onOpenDropShip }
            : billNeedsAttention
              ? { title: "Resolve the vendor bill exception", detail: "Review the three-way match or hold before approval and payment.", label: "Open match exceptions", onClick: () => onOpenVendorBilling("match"), tone: "warning" }
              : billingSaysComplete && !activeVendorBills.length
                ? { title: "Reconcile the missing bill link", detail: "The order says fully billed, but no vendor bill is connected to it.", label: "Review vendor billing", onClick: () => onOpenVendorBilling("overview"), tone: "warning" }
                : !billingSaysComplete
                  ? { title: "Record the vendor bill", detail: "Create the payable from this order and its posted fulfillment; inventory will not move again.", label: "Open vendor billing", onClick: () => onOpenVendorBilling("overview") }
                  : vendorBillOutstanding > 0
                    ? { title: `Settle ${formatDocumentMoney(vendorBillOutstanding, po.currency)}`, detail: "Record payment or apply a vendor credit to the connected bill.", label: "Open bill actions", onClick: () => onOpenVendorBilling("billing-actions") }
                    : { title: "Purchase-to-payment complete", detail: "The commitment, fulfillment, bill, and settlement are complete.", tone: "success" };
  return <div className="object-page">
    <button className="back-button" onClick={onBack}>← Back to purchase orders</button>
    <section className="object-header panel"><div className="object-title"><div><span className="section-kicker">Purchase order · Revision {po.revision}</span><h2>{po.number}</h2><p>{po.vendor} · {destinationSummary}</p></div><div className="object-total"><span>Total</span><strong>{formatDocumentMoney(po.total, po.currency)}</strong><small>{po.currency}</small></div></div>
      <div className="status-summary"><div><small>Commercial</small><StatusBadge>{po.lifecycle}</StatusBadge></div><div><small>Physical</small><StatusBadge>{po.fulfillment}</StatusBadge></div><div><small>Financial</small><StatusBadge>{po.billing}</StatusBadge></div></div>
      {po.exception && <div className="exception-banner"><span aria-hidden="true">!</span><div><strong>Action needed</strong><p>{po.exception}</p></div></div>}
      {activateError ? <div className="error-summary" role="alert"><p>{activateError}</p></div> : null}
      {isDraft && canOperate ? <form className="draft-activation" onSubmit={submit} noValidate><label><span>Submission note{requiredMark}</span><input value={submitNote} onChange={(event) => setSubmitNote(event.target.value)} placeholder="Why this order is needed" required aria-required="true" /><small className="field-hint">{submitNote.trim() ? "" : "Required before the order can be submitted."}</small></label><button className="button primary" type="submit" disabled={activating || !submitNote.trim()}>{activating ? "Submitting…" : po.lifecycle.toLowerCase() === "rejected" ? "Resubmit for approval" : "Submit for approval"}</button><button className="button secondary" type="button" onClick={onEdit}>Edit draft lines</button>{po.lifecycle.toLowerCase() === "draft" ? <button className="button secondary" type="button" onClick={() => setMergeOpen(true)}>Merge another draft</button> : null}</form> : null}
      {canOperate ? <div className="object-actions">
        {po.lifecycle.toLowerCase() === "approved" && <DocumentDownloadLink documentType="purchase_order" documentId={po.id} documentNumber={po.number}>Download purchase order</DocumentDownloadLink>}
        {po.lifecycle.toLowerCase() === "approved" && <EmailDocumentButton documentType="purchase_order" documentId={po.id} documentNumber={po.number}>Email purchase order</EmailDocumentButton>}
        {po.lifecycle.toLowerCase() === "approved" && po.openToReceive > 0 && <button className="button primary" onClick={() => onCommand("receive")}>Receive remaining</button>}
        {po.lifecycle.toLowerCase() === "approved" && po.openToDeliver > 0 && <button className="button primary" onClick={onOpenDropShip}>Post supplier delivery</button>}
        {po.lifecycle.toLowerCase() === "approved" && hasStockLines && po.lines.some((line) => line.fulfillmentRoute === "stock" && line.closed > 0) && <button className="button primary" onClick={() => onCommand("reopen")}>Reopen stock-receipt quantity</button>}
        {po.lifecycle.toLowerCase() === "approved" && po.open > 0 && <button className="button secondary" onClick={() => onCommand("close")}>Close unfulfilled quantity</button>}
        {po.latestReceiptId && po.lines.some((line) => line.latestReceiptReversible > 0) && <button className="button secondary" onClick={() => onCommand("reverse")}>Reverse incorrect receipt</button>}
        {po.received - po.returned > 0 && <button className="button ghost" onClick={() => onCommand("vendor-return")}>Return to vendor</button>}
      </div> : <p className="read-only-label">Read-only access: operational posting actions are hidden.</p>}
    </section>
    <RecordProgress title={`Purchase to payment for ${po.number}`} steps={purchaseProgress} next={nextAction} />
    <section className="metric-row object-metrics">
      <MetricDisplay label="Ordered" value={po.ordered} />
      {/* Same quantity the line table calls "Net received"; two names for one number sent
          people looking for the difference between them. */}
      <MetricDisplay label="Supplier fulfilled" value={po.fulfilled} />
      <MetricDisplay label="Closed without receipt" value={po.closed} tone={po.closed > 0 ? "warning" : "neutral"} />
      <MetricDisplay label="Open fulfillment" value={po.open} tone={po.open > 0 ? "info" : "neutral"} />
    </section>
    <section className="panel"><PanelHeading title="Order lines" detail={`${po.lines.length} line${po.lines.length === 1 ? "" : "s"} · amounts in ${po.currency}`} />
      <div className="responsive-table"><table><caption className="sr-only">Purchase order lines, quantity breakdown, and extended amounts</caption><thead><tr><SortableHeader label="#" column="line" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" /><SortableHeader label="Product / configuration" column="product" sort={lineTable.sort} setSort={lineTable.setSort} /><SortableHeader label="Customer / project" column="customer" sort={lineTable.sort} setSort={lineTable.setSort} /><SortableHeader label="Ordered" column="ordered" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Supplier fulfilled" column="received" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Returned" column="returned" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Closed" column="closed" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Open" column="open" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Unit cost" column="unitCost" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Discount" column="discount" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Tax" column="tax" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Amount" column="amount" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /></tr></thead><tbody>{lineTable.rows.map((line) => <tr key={line.id}><td className="numeric muted">{po.lines.indexOf(line) + 1}</td><td><strong>{line.product}</strong><small>{line.sku} · {line.specification}</small></td><td>{line.customerRef ? <span className="allocation-tag">{line.customerRef}</span> : <span className="muted">Stock</span>}</td><td className="numeric">{line.ordered}{line.orderedUomCode ? <small>{line.orderedUomCode}</small> : null}</td><td className="numeric strong">{line.fulfilled}</td><td className="numeric">{line.returned}</td><td className="numeric">{line.closed}</td><td className="numeric strong">{line.open}</td><td className="numeric">{formatDocumentMoney(line.unitCost, po.currency)}</td><td className="numeric">{line.discountCents ? `−${formatDocumentMoney(line.discountCents / 100, po.currency)}` : "—"}</td><td className="numeric">{line.taxable ? formatDocumentMoney(lineTaxAmount(line.ordered, line.unitCost, line.discountCents, line.taxable, line.taxRateBps), po.currency) : "Exempt"}</td><td className="numeric strong">{formatDocumentMoney(lineNetAmount(line.ordered, line.unitCost, line.discountCents), po.currency)}</td></tr>)}</tbody></table></div>
    </section>
    <div className="detail-columns">
      <DocumentFacts title="Order details" facts={[
        ["Order date", formatDocumentDate(po.orderDate)],
        ["Expected delivery", expectedDateLabel(po.expectedDate)],
        ["Payment terms", po.paymentTerms ?? "Not recorded"],
        ["Payment due", formatDocumentDate(po.dueDate)],
        ["Currency", po.exchangeRateToBase === 1 ? po.currency : `${po.currency} · rate ${po.exchangeRateToBase} to CAD`],
        ["Buyer", po.buyer],
        ["Supplier quote", po.supplierQuoteNumber ?? "Not imported"],
        ["Supplier reference", po.supplierReference ?? "Not recorded"],
        ["Project reference", po.projectReference ?? "Stock replenishment"],
      ]} />
      <DocumentTotalsPanel totals={totals} currency={po.currency} />
    </div>
    <div className="detail-columns"><section className="panel"><PanelHeading title="Related state" /><dl className="definition-list"><div><dt>Purchase order</dt><dd>{po.number} · revision {po.revision}</dd></div><div><dt>Latest receipt</dt><dd>{po.latestReceiptNumber ? <>{po.latestReceiptNumber}<br /><small>{formatDocumentDate(po.latestReceiptPostedAt)}</small></> : po.received > 0 ? "Recorded stock movements" : "No receipt posted"}</dd></div><div><dt>Packing slip</dt><dd>{po.latestReceiptPackingSlip ?? (po.latestReceiptNumber ? "Not recorded" : "—")}</dd></div><div><dt>Linked demand</dt><dd>{po.customerRef ?? "Stock replenishment"}</dd></div><div><dt>Billing</dt><dd>{po.billing}</dd></div></dl></section>
      <section className="panel"><PanelHeading title="Posting summary" /><div className="timeline"><div className="timeline-item"><span className="timeline-dot info" /><div><strong>Revision {po.revision} · {po.lifecycle}</strong><p>Commercial state is version checked independently of inventory.</p><small>Raised by {po.buyer || "an unrecorded buyer"}</small>{po.submissionNote ? <p className="submission-note">“{po.submissionNote}”</p> : null}</div></div><div className="timeline-item"><span className="timeline-dot success" /><div><strong>{po.received - po.returned} units net received</strong><p>{po.received} received · {po.returned} returned · {po.closed} closed without receipt.</p><small>{po.fulfillment}</small></div></div></div></section></div>
    {mergeOpen ? <MergePurchaseOrderDialog purchaseOrder={po} onClose={() => setMergeOpen(false)} onSaved={(message) => { setMergeOpen(false); onChanged(message); }} /> : null}
  </div>;
}

function MergePurchaseOrderDialog({ purchaseOrder, onClose, onSaved }: { purchaseOrder: PurchaseOrder; onClose: () => void; onSaved: (message: string) => void }) {
  const [source, setSource] = useState<LookupOption | null>(null); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useDialogDismiss(onClose, busy);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!source || source.id === purchaseOrder.id) return setError("Choose a different draft purchase order."); setBusy(true); setError(""); try { onSaved(await postWorkflow("mergePurchaseOrders", purchaseOrder.id, purchaseOrder.version, { sourcePurchaseOrderId: source.id })); } catch (caught) { setError(caught instanceof Error ? caught.message : "The purchase orders could not be merged."); } finally { setBusy(false); } };
  return <div className="modal-overlay" role="presentation"><section className="command-dialog" role="dialog" aria-modal="true" aria-label="Merge draft purchase orders"><div className="dialog-header"><div><span className="section-kicker">Surviving order · {purchaseOrder.number}</span><h2>Merge draft purchase orders</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div><form className="command-form" onSubmit={submit}>{error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}<label><span>Other unsubmitted draft from {purchaseOrder.vendor}</span><ReferenceSearchSelect kind="purchaseOrders" role="draft" partnerId={purchaseOrder.vendorId} value={source?.id ?? ""} initialOptions={[]} onSelect={setSource} placeholder="Search draft purchase-order number" /></label><div className="next-step-banner"><div><strong>{source ? source.label : "Choose a draft to combine"}</strong><p>Its lines, charges, and live attachments will move to {purchaseOrder.number}. The other number is retained as a canceled audit record. Submitted, received, emailed, delivered, or billed orders cannot be merged.</p></div></div><label className="radio-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I understand the other draft will be canceled after its contents are consolidated.</span></label><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button danger" disabled={busy || !source || !confirmed}>{busy ? "Merging…" : `Merge into ${purchaseOrder.number}`}</button></div></form></section></div>;
}

function MetricDisplay({ label, value, tone = "neutral" }: { label: string; value: number | string; tone?: Severity }) {
  return <div className={`metric-display ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function VendorReturnsView({ orders, canOperate, onReturn }: { orders: PurchaseOrder[]; canOperate: boolean; onReturn: (po: PurchaseOrder) => void }) {
  const eligible = orders.filter((po) => po.received - po.returned > 0);
  return <section className="panel worklist"><div className="record-cards">{eligible.map((po) => <article className="record-card" key={po.id}>{/* The eligible quantity covers the whole order, so naming only the first line's product
    misreported a multi-line order: a 30-unit total read as 30 of the first product. */}
<div><span className="section-kicker">{po.number}</span><h3>{po.vendor}</h3><p>{po.lines.length === 1 ? po.lines[0].product : `${po.lines.length} order lines`}</p></div><div className="card-metrics"><span><small>Eligible to return</small><strong>{po.received - po.returned}</strong></span><span><small>Latest receipt</small><strong>{po.latestReceiptNumber ?? "Movement history"}</strong></span></div>{canOperate ? <button className="button secondary" onClick={() => onReturn(po)}>Start vendor return</button> : <span className="read-only-label">Read-only</span>}</article>)}{!eligible.length ? <div className="empty-inline">No retained purchase receipts are currently eligible for return.</div> : null}</div></section>;
}

function SalesOrdersView({ orders, canOperate, onOpen, onShip, sort, setSort }: { orders: SalesOrder[]; canOperate: boolean; onOpen: (id: string) => void; onShip: (so: SalesOrder) => void } & WorklistSortProps) {
  // No client-side trim: the worklist status filter scopes this server-side, so the row
  // count on screen always equals the record count reported above it.
  return <section className="panel worklist"><div className="responsive-table"><table><caption className="sr-only">Sales orders</caption><thead><tr><SortableHeader label="Exception" column="exception" sort={sort} setSort={setSort} defaultDirection="desc" /><SortableHeader label="SO" column="number" sort={sort} setSort={setSort} /><SortableHeader label="Customer / project" column="customer" sort={sort} setSort={setSort} /><SortableHeader label="Requested" column="requested" sort={sort} setSort={setSort} /><SortableHeader label="Availability" column="availability" sort={sort} setSort={setSort} defaultDirection="desc" /><SortableHeader label="Fulfillment" column="fulfillment" sort={sort} setSort={setSort} /><SortableHeader label="Invoice" column="billing" sort={sort} setSort={setSort} /><SortableHeader label="Total" column="total" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><th><span className="sr-only">Action</span></th></tr></thead><tbody>{orders.map((so) => <tr key={so.id}><td>{so.exception ? <span className={`exception-cell ${so.shortage > 0 ? "danger" : "warning"}`}>!</span> : "—"}</td><td><button className="table-link" onClick={() => onOpen(so.id)}>{so.number}</button><small>{so.route}</small></td><td><strong>{so.customer}</strong>{so.project ? <small>{so.project}</small> : null}</td><td>{formatDate(so.requestedDate)}</td><td><div className="availability-mini"><strong>{so.availableNow} now</strong><span>{so.incomingBeforeDate} incoming</span>{so.shortage > 0 && <b>{so.shortage} short</b>}</div></td><td><StatusBadge>{so.fulfillment}</StatusBadge></td><td><StatusBadge>{so.billing}</StatusBadge></td><td className="numeric strong">{formatDocumentMoney(so.total, so.currency, false)}</td><td>{canOperate && so.lifecycle.toLowerCase() === "confirmed" && so.reserved > 0 ? <button className="row-action" onClick={() => onShip(so)}>Post shipment</button> : <button className="row-action" onClick={() => onOpen(so.id)}>View</button>}</td></tr>)}{!orders.length ? <tr><td colSpan={9}><div className="empty-inline">No sales order matches this filter.</div></td></tr> : null}</tbody></table></div></section>;
}

function SalesOrderDetail({ so, canOperate, canPostFinancial, onBack, onEdit, onReserve, onShip, onImmediateSale, onOpenCustomerBilling, onOpenDropShip, onCreateLinkedPurchaseOrder, onOpenLinkedPurchaseOrder, onConfirm }: { so: SalesOrder; canOperate: boolean; canPostFinancial: boolean; onBack: () => void; onEdit: () => void; onReserve: () => void; onShip: () => void; onImmediateSale: () => void; onOpenCustomerBilling: (tab?: string) => void; onOpenDropShip: () => void; onCreateLinkedPurchaseOrder: () => void; onOpenLinkedPurchaseOrder: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState("");
  // Confirmation is an audited decision, so the note is typed rather than defaulted — a
  // generated one would fill the trail with a sentence nobody wrote.
  const [confirmNote, setConfirmNote] = useState("");
  const isDraft = so.lifecycle.toLowerCase() === "draft";
  const hasDedicatedSupply = so.lines?.some((line) => Boolean(line.linkedPurchaseOrderLineId)) ?? false;
  const confirmed = so.lifecycle.toLowerCase() === "confirmed";
  const openDedicatedLines = so.lines?.filter((line) => line.fulfillmentRoute !== "stock" && line.open > 0) ?? [];
  const missingDedicatedSupply = confirmed && openDedicatedLines.some((line) => !line.linkedPurchaseOrderLineId);
  const linkedSupplyAwaitingApproval = confirmed && openDedicatedLines.some((line) => line.linkedPurchaseOrderLineId && line.linkedPurchaseOrderLifecycle !== "approved");
  const specialOrderAwaitingReceipt = confirmed && openDedicatedLines.some((line) => line.fulfillmentRoute === "special_order" && line.linkedPurchaseOrderLifecycle === "approved" && line.reserved <= 0);
  const canImmediateSale = confirmed && (so.lines?.some((line) => line.fulfillmentRoute === "stock" && line.open > line.reserved && line.productAvailable > 0) ?? false);
  // Actions that cannot apply are not offered: a fully shipped order showed three live-looking
  // buttons that did nothing. Whatever remains that is blocked says why.
  const fulfillmentOpen = confirmed && so.open > 0;
  const canShip = confirmed && so.openToShip > 0 && so.reserved > 0;
  const canReserve = confirmed && (so.lines?.some((line) => line.fulfillmentRoute === "stock" && line.open > line.reserved) ?? false);
  const canPostDropShipDelivery = confirmed && (so.lines?.some((line) => line.fulfillmentRoute === "drop_ship" && line.open > 0 && line.linkedPurchaseOrderLifecycle === "approved") ?? false);
  const invoiceable = Math.max(so.fulfilled - (so.invoiced ?? 0), 0);
  const reserveBlocked = canReserve && so.availableNow <= 0;
  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setActivating(true); setActivateError("");
    try { await onConfirm(confirmNote.trim()); } catch (caught) { setActivateError(caught instanceof Error ? caught.message : "The sales order could not be confirmed."); }
    finally { setActivating(false); }
  };
  const lines = so.lines ?? [];
  const totals = documentTotals(lines.map((line) => ({ quantity: line.ordered, unitAmount: line.unitPrice, discountCents: line.discountCents, taxable: line.taxable, taxRateBps: line.taxRateBps })), so);
  const lineTable = useLocalTableSort(lines, { line: (row) => lines.indexOf(row), product: (row) => `${row.product} ${row.sku}`, route: (row) => `${row.fulfillmentRoute} ${row.projectReference ?? ""}`, ordered: (row) => row.ordered, reserved: (row) => row.reserved, shipped: (row) => row.shipped, returned: (row) => row.returned, open: (row) => row.open, unitPrice: (row) => row.unitPrice, discount: (row) => row.discountCents, tax: (row) => lineTaxAmount(row.ordered, row.unitPrice, row.discountCents, row.taxable, row.taxRateBps), amount: (row) => lineNetAmount(row.ordered, row.unitPrice, row.discountCents) });
  const shipmentTable = useLocalTableSort(so.shipments, { number: (row) => row.number, posted: (row) => row.postedAt, status: (row) => row.status, carrier: (row) => row.carrier, service: (row) => row.serviceLevel, tracking: (row) => row.trackingNumber, billOfLading: (row) => row.billOfLadingNumber });
  const lifecycle = so.lifecycle.toLowerCase();
  const canceled = lifecycle === "canceled";
  const activeInvoices = so.invoices.filter((invoice) => invoice.status.toLowerCase() !== "void");
  const invoiceOutstanding = activeInvoices.reduce((sum, invoice) => sum + invoice.outstanding, 0);
  const billingComplete = ["invoiced", "fully invoiced"].includes(so.billing.toLowerCase());
  const fulfillmentDocuments: RecordProgressDocument[] = [
    ...so.shipments.map((shipment) => ({ number: shipment.number, detail: `${formatDocumentDate(shipment.postedAt)}${shipment.trackingNumber ? ` · tracking ${shipment.trackingNumber}` : ""}` })),
    ...so.supplierDeliveries.map((delivery) => ({ number: delivery.number, detail: `${delivery.quantity} supplier-delivered · ${formatDocumentDate(delivery.deliveryDate)}${delivery.externalReference ? ` · ${delivery.externalReference}` : ""}` })),
  ];
  const invoiceDocuments: RecordProgressDocument[] = activeInvoices.map((invoice) => ({
    number: invoice.number,
    detail: `${formatDocumentMoney(invoice.amount, invoice.currency)} · due ${formatDocumentDate(invoice.dueOn)}${invoice.outstanding > 0 ? ` · ${formatDocumentMoney(invoice.outstanding, invoice.currency)} outstanding` : " · settled"}`,
    href: `/api/documents/pdf?documentType=customer_invoice&documentId=${encodeURIComponent(invoice.id)}`,
  }));
  const settlementDocuments: RecordProgressDocument[] = so.settlements.map((settlement) => ({
    number: settlement.number,
    detail: `${titleCase(settlement.kind)}${settlement.appliedTo ? ` to ${settlement.appliedTo}` : ""} · ${formatDocumentDate(settlement.postedAt)} · ${formatDocumentMoney(settlement.amount, settlement.currency)}`,
  }));
  const supplyAttention = missingDedicatedSupply || linkedSupplyAwaitingApproval || specialOrderAwaitingReceipt || reserveBlocked;
  const salesProgress: RecordProgressStep[] = [
    { label: "Sales order", state: canceled ? "stopped" : confirmed ? "complete" : "current", summary: `${so.lifecycle} · ${formatDocumentMoney(so.total, so.currency)}`, documents: [{ number: so.number, detail: `${so.customer} · ordered ${formatDocumentDate(so.orderDate)}`, href: `/api/documents/pdf?documentType=sales_order&documentId=${encodeURIComponent(so.id)}` }] },
    { label: "Supply & allocation", state: canceled ? "stopped" : supplyAttention ? "attention" : !confirmed ? "upcoming" : so.open <= 0 || so.reserved >= so.open ? "complete" : "current", summary: missingDedicatedSupply ? "A linked purchase order is missing for dedicated supply" : linkedSupplyAwaitingApproval ? "Linked purchasing commitment is awaiting approval" : specialOrderAwaitingReceipt ? "Linked special-order supply must be received" : so.open <= 0 ? "Supply consumed by completed fulfillment" : `${so.reserved} reserved · ${so.availableNow} available now · ${so.incomingBeforeDate} incoming` },
    { label: "Customer fulfillment", state: canceled ? "stopped" : so.open <= 0 && confirmed ? "complete" : confirmed ? "current" : "upcoming", summary: `${so.fulfilled} of ${so.ordered} fulfilled · ${so.open} open`, documents: fulfillmentDocuments },
    { label: "Customer invoice", state: canceled ? "stopped" : billingComplete && activeInvoices.length > 0 ? "complete" : billingComplete && !activeInvoices.length ? "attention" : invoiceable > 0 || activeInvoices.length > 0 ? "current" : "upcoming", summary: activeInvoices.length ? `${activeInvoices.length} connected invoice${activeInvoices.length === 1 ? "" : "s"} · ${so.billing}` : billingComplete ? "Billing status is complete, but no connected invoice was found" : `${invoiceable} fulfilled unit${invoiceable === 1 ? "" : "s"} ready to invoice`, documents: invoiceDocuments },
    { label: "Payment / credit", state: canceled ? "stopped" : activeInvoices.length && invoiceOutstanding <= 0 ? "complete" : activeInvoices.length ? "current" : "upcoming", summary: activeInvoices.length ? `${formatDocumentMoney(invoiceOutstanding, so.currency)} outstanding across connected invoices` : "Begins after an invoice is posted", documents: settlementDocuments },
  ];
  const nextAction: RecordNextAction = canceled
    ? { title: "No action — order canceled", detail: "This progression is retained as history.", tone: "success" }
    : isDraft
      ? { title: "Confirm the sales order", detail: "Review customer approval, delivery details, and lines before committing demand.", label: "Edit draft", onClick: onEdit }
      : invoiceable > 0
        ? { title: `Invoice ${invoiceable} fulfilled unit${invoiceable === 1 ? "" : "s"}`, detail: "Create the customer receivable from posted fulfillment; inventory will not move again.", label: "Open customer invoicing", onClick: () => onOpenCustomerBilling("overview") }
        : missingDedicatedSupply
          ? { title: "Dedicated supplier supply is required", detail: "Link a purchase order before attempting special-order or drop-ship fulfillment.", label: "Create linked purchase order", onClick: onCreateLinkedPurchaseOrder, tone: "warning" }
          : linkedSupplyAwaitingApproval
            ? { title: "Approve the linked purchase order", detail: "Supplier fulfillment remains unavailable until the purchasing commitment is approved.", label: "Open linked purchase order", onClick: onOpenLinkedPurchaseOrder, tone: "warning" }
            : specialOrderAwaitingReceipt
              ? { title: "Receive the linked special-order supply", detail: "A usable receipt will reserve the dedicated quantity for this customer order.", label: "Open linked purchase order", onClick: onOpenLinkedPurchaseOrder }
              : canShip
                ? { title: `Ship ${so.openToShip} reserved unit${so.openToShip === 1 ? "" : "s"}`, detail: "Post the customer shipment and capture carrier references.", label: "Post shipment", onClick: onShip }
                : canPostDropShipDelivery
                  ? { title: "Post the supplier delivery", detail: "Confirm direct delivery to the customer without moving internal inventory.", label: "Post supplier delivery", onClick: onOpenDropShip }
                  : canReserve && !reserveBlocked
                    ? { title: "Reserve available stock", detail: "Allocate usable stock to make the order ready for shipment.", label: "Reserve available stock", onClick: onReserve }
                    : billingComplete && !activeInvoices.length
                      ? { title: "Reconcile the missing invoice link", detail: "The order says invoiced, but no customer invoice is connected to it.", label: "Review customer billing", onClick: () => onOpenCustomerBilling("billing-actions"), tone: "warning" }
                      : invoiceOutstanding > 0
                        ? { title: `Collect ${formatDocumentMoney(invoiceOutstanding, so.currency)}`, detail: "Record payment or issue a credit against the connected invoice.", label: "Open invoice actions", onClick: () => onOpenCustomerBilling("billing-actions") }
                        : reserveBlocked
                          ? { title: "Resolve the supply shortage", detail: "Review incoming supply or create a purchasing commitment before reserving stock.", tone: "warning" }
                          : { title: "Order-to-cash complete", detail: "The order, fulfillment, invoice, and settlement are complete.", tone: "success" };
  return <div className="object-page"><button className="back-button" onClick={onBack}>← Back to sales orders</button><section className="object-header panel"><div className="object-title"><div><span className="section-kicker">Sales order · {so.route}</span><h2>{so.number}</h2><p>{[so.customer, so.project].filter(Boolean).join(" · ")}</p></div><div className="object-total"><span>Total</span><strong>{formatDocumentMoney(so.total, so.currency)}</strong><small>{so.currency}</small></div></div><div className="status-summary"><div><small>Commercial</small><StatusBadge>{so.lifecycle}</StatusBadge></div><div><small>Physical</small><StatusBadge>{so.fulfillment}</StatusBadge></div><div><small>Financial</small><StatusBadge>{so.billing}</StatusBadge></div></div>{so.exception && <div className="exception-banner"><span>!</span><div><strong>Fulfillment exception</strong><p>{so.exception}</p></div></div>}{activateError ? <div className="error-summary" role="alert"><p>{activateError}</p></div> : null}{isDraft && canOperate ? <form className="draft-activation" onSubmit={confirm} noValidate><label><span>Confirmation note{requiredMark}</span><input value={confirmNote} onChange={(event) => setConfirmNote(event.target.value)} placeholder="Customer PO number, or who approved it" required aria-required="true" /><small className="field-hint">{confirmNote.trim() ? "" : "Required before the order can be confirmed."}</small></label><button className="button primary" type="submit" disabled={activating || !confirmNote.trim()}>{activating ? "Confirming…" : "Confirm sales order"}</button><button className="button secondary" type="button" onClick={onEdit} disabled={hasDedicatedSupply} title={hasDedicatedSupply ? "Cancel the linked purchase order before replacing these demand lines." : undefined}>Edit draft lines</button>{hasDedicatedSupply ? <small className="read-only-label">Dedicated supply is linked. Cancel that purchase order before replacing demand lines.</small> : null}</form> : !isDraft && canOperate ? <div className="object-actions">{confirmed ? <DocumentDownloadLink documentType="sales_order" documentId={so.id} documentNumber={so.number}>Download sales order</DocumentDownloadLink> : null}{confirmed ? <EmailDocumentButton documentType="sales_order" documentId={so.id} documentNumber={so.number}>Email sales order</EmailDocumentButton> : null}{canPostFinancial && so.openToShip > 0 ? <button className="button primary" onClick={onImmediateSale} disabled={!canImmediateSale} title={canImmediateSale ? undefined : "No unreserved stock line has usable inventory to ship and invoice now."}>Ship &amp; invoice now</button> : null}{canShip ? <button className={canPostFinancial ? "button secondary" : "button primary"} onClick={onShip}>Post shipment</button> : null}{canReserve ? <button className="button secondary" onClick={onReserve} disabled={reserveBlocked} title={reserveBlocked ? "No usable stock is available to reserve right now." : undefined}>Reserve available stock</button> : null}{canPostDropShipDelivery ? <button className="button primary" onClick={onOpenDropShip}>Post supplier delivery</button> : null}{!fulfillmentOpen && !canShip ? <span className="read-only-label">{confirmed ? "Fully fulfilled: no fulfillment actions remain." : `No fulfillment actions while the order is ${so.lifecycle.toLowerCase()}.`}</span> : null}</div> : <p className="read-only-label">Read-only access: operational posting actions are hidden.</p>}</section>
    <RecordProgress title={`Order to cash for ${so.number}`} steps={salesProgress} next={nextAction} />
    <section className="panel availability-panel"><PanelHeading title="Availability for requested date" detail={`Requested ${formatDate(so.requestedDate)}`} /><div className="availability-grid"><MetricDisplay label="Required" value={so.open} /><MetricDisplay label="Available now" value={so.availableNow} tone="success" /><MetricDisplay label="Incoming before date" value={so.incomingBeforeDate} tone="info" /><MetricDisplay label="Shortage" value={so.shortage} tone={so.shortage > 0 ? "danger" : "neutral"} /></div>{so.linkedPo && <div className="linked-supply"><span className="section-kicker">Linked supply</span><strong>{so.linkedPo}</strong><p>{so.incomingBeforeDate} units expected before the customer&apos;s requested date.</p></div>}</section>
    {/* The lines are the order. Without them this page showed a total for goods it never named,
        so nobody could check what the customer actually bought. */}
    <section className="panel"><PanelHeading title="Order lines" detail={`${lines.length} line${lines.length === 1 ? "" : "s"} · amounts in ${so.currency}`} />
      <div className="responsive-table"><table><caption className="sr-only">Sales order lines, fulfillment quantities, and extended amounts</caption><thead><tr><SortableHeader label="#" column="line" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" /><SortableHeader label="Product" column="product" sort={lineTable.sort} setSort={lineTable.setSort} /><SortableHeader label="Route / project" column="route" sort={lineTable.sort} setSort={lineTable.setSort} /><SortableHeader label="Ordered" column="ordered" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Reserved" column="reserved" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Fulfilled" column="shipped" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Returned" column="returned" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Open" column="open" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Unit price" column="unitPrice" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Discount" column="discount" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Tax" column="tax" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Amount" column="amount" sort={lineTable.sort} setSort={lineTable.setSort} className="numeric" defaultDirection="desc" /></tr></thead><tbody>{lineTable.rows.map((line) => <tr key={line.id}><td className="numeric muted">{lines.indexOf(line) + 1}</td><td><strong>{line.product}</strong><small>{line.sku}</small></td><td>{titleCase(line.fulfillmentRoute)}{line.projectReference ? <small>{line.projectReference}</small> : null}</td><td className="numeric">{line.ordered}{line.orderedUomCode ? <small>{line.orderedUomCode}</small> : null}</td><td className="numeric">{line.reserved}</td><td className="numeric strong">{line.fulfilled}</td><td className="numeric">{line.returned}</td><td className="numeric strong">{line.open}</td><td className="numeric">{formatDocumentMoney(line.unitPrice, so.currency)}</td><td className="numeric">{line.discountCents ? `−${formatDocumentMoney(line.discountCents / 100, so.currency)}` : "—"}</td><td className="numeric">{line.taxable ? formatDocumentMoney(lineTaxAmount(line.ordered, line.unitPrice, line.discountCents, line.taxable, line.taxRateBps), so.currency) : "Exempt"}</td><td className="numeric strong">{formatDocumentMoney(lineNetAmount(line.ordered, line.unitPrice, line.discountCents), so.currency)}</td></tr>)}{!lines.length ? <tr><td colSpan={12}><div className="empty-inline">This order has no lines recorded.</div></td></tr> : null}</tbody></table></div>
    </section>
    <div className="detail-columns">
      <DocumentFacts title="Order details" facts={[
        ["Order date", formatDocumentDate(so.orderDate)],
        ["Requested delivery", formatDocumentDate(so.requestedDate)],
        ["Payment terms", so.paymentTerms ?? "Not recorded"],
        ["Payment due", formatDocumentDate(so.dueDate)],
        ["Currency", so.exchangeRateToBase === 1 ? so.currency : `${so.currency} · rate ${so.exchangeRateToBase} to CAD`],
        ["Sales owner", so.owner],
        ["Project reference", so.project || "—"],
      ]} />
      <DocumentTotalsPanel totals={totals} currency={so.currency} />
    </div>
    <div className="detail-columns"><section className="panel"><PanelHeading title="Fulfillment quantities" /><dl className="definition-list"><div><dt>Ordered</dt><dd>{so.ordered}</dd></div><div><dt>Reserved for shipment</dt><dd>{so.reserved}</dd></div><div><dt>Supplier / warehouse fulfilled</dt><dd>{so.fulfilled}</dd></div><div><dt>Open fulfillment</dt><dd>{so.open}</dd></div></dl></section><section className="panel"><PanelHeading title="Customer delivery" /><dl className="definition-list"><div><dt>Method</dt><dd>{so.route}</dd></div><div><dt>Requested</dt><dd>{formatDocumentDate(so.requestedDate)}</dd></div><div><dt>Ship to</dt><dd>{so.shipToName ?? so.customer}<br />{[so.shipToAddressLine1, so.shipToAddressLine2, so.shipToCity, so.shipToRegion, so.shipToPostalCode, so.shipToCountry].filter(Boolean).join(", ") || "Address required before confirmation"}</dd></div><div><dt>Instructions</dt><dd>{so.deliveryInstructions ?? "None"}</dd></div></dl></section></div>
    {/* Carrier paperwork was required at posting and then invisible, so "where is my order"
        had no answer on any screen. */}
    <section className="panel"><PanelHeading title="Shipments" detail={so.shipments.length ? `${so.shipments.length} posted` : undefined} />
      {so.shipments.length ? <div className="responsive-table"><table><caption className="sr-only">Posted shipments and carrier references</caption><thead><tr><SortableHeader label="Shipment" column="number" sort={shipmentTable.sort} setSort={shipmentTable.setSort} /><SortableHeader label="Posted" column="posted" sort={shipmentTable.sort} setSort={shipmentTable.setSort} defaultDirection="desc" /><SortableHeader label="Status" column="status" sort={shipmentTable.sort} setSort={shipmentTable.setSort} /><SortableHeader label="Carrier" column="carrier" sort={shipmentTable.sort} setSort={shipmentTable.setSort} /><SortableHeader label="Service level" column="service" sort={shipmentTable.sort} setSort={shipmentTable.setSort} /><SortableHeader label="Tracking" column="tracking" sort={shipmentTable.sort} setSort={shipmentTable.setSort} /><SortableHeader label="Bill of lading" column="billOfLading" sort={shipmentTable.sort} setSort={shipmentTable.setSort} /></tr></thead><tbody>{shipmentTable.rows.map((shipment) => <tr key={shipment.number}><td><strong>{shipment.number}</strong></td><td>{formatDocumentDate(shipment.postedAt)}</td><td><StatusBadge>{shipment.status}</StatusBadge></td><td>{shipment.carrier || <span className="muted">Not recorded</span>}</td><td>{shipment.serviceLevel || <span className="muted">—</span>}</td><td>{shipment.trackingNumber || <span className="muted">—</span>}</td><td>{shipment.billOfLadingNumber || <span className="muted">—</span>}</td></tr>)}</tbody></table></div>
        : <div className="empty-inline">No shipment has been posted against this order.</div>}
    </section>
  </div>;
}

function CustomerReturnsView({ orders, canOperate, onReturn }: { orders: SalesOrder[]; canOperate: boolean; onReturn: (so: SalesOrder) => void }) {
  // Only a posted shipment can come back. Reserved stock has never left the building, so
  // listing it as "eligible return" invited a return against goods the customer never received.
  const eligible = orders.filter((so) => so.shipped - so.returned > 0);
  return <section className="panel worklist"><div className="record-cards">{eligible.map((so) => <article className="record-card" key={so.id}><div><span className="section-kicker">{so.number}</span><h3>{so.customer}</h3>{so.project ? <p>{so.project}</p> : null}</div><div className="card-metrics"><span><small>Eligible to return</small><strong>{so.shipped - so.returned}</strong></span><span><small>Invoiced</small><strong>{so.invoiced ?? 0}</strong></span></div>{canOperate ? <button className="button secondary" onClick={() => onReturn(so)}>Create customer return</button> : <span className="read-only-label">Read-only</span>}</article>)}{!eligible.length ? <div className="empty-inline">No sales order in this view has a posted shipment to return.</div> : null}</div></section>;
}

function InventoryView({ snapshot, onOpen, warehouseId, sort, setSort }: { snapshot: Snapshot; onOpen: (id: string) => void; warehouseId: string } & WorklistSortProps) {
  const { products, summary } = snapshot;
  return <div className="stack">{summary.orphanedBalanceRows > 0 ? <div className="exception-banner"><span aria-hidden="true">!</span><div><strong>Inventory reconciliation failed</strong><p>{summary.orphanedBalanceUnits} units across {summary.orphanedBalanceRows} balance row(s) reference missing locations; {money.format(summary.orphanedInventoryValueCents / 100)} of movement value is affected. Posting to unknown locations is now blocked.</p></div></div> : null}<section className="metric-row object-metrics"><MetricDisplay label="On hand" value={summary.onHand} /><MetricDisplay label="Usable" value={summary.usable} /><MetricDisplay label="Reserved" value={summary.reserved} tone="info" /><MetricDisplay label="Available now" value={summary.available} tone="success" />{/* Purchase orders carry no warehouse, so incoming supply stays company-wide even when
        the physical totals beside it are scoped to one site. */}
      <MetricDisplay label={warehouseId ? "Incoming (all sites)" : "Incoming"} value={summary.incoming} tone="info" /></section><section className="panel worklist"><div className="responsive-table"><table><caption className="sr-only">Inventory balances by product</caption><thead><tr><SortableHeader label="Product / configuration" column="product" sort={sort} setSort={setSort} /><SortableHeader label="Warehouse location" column="location" sort={sort} setSort={setSort} /><SortableHeader label="On hand" column="onHand" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Usable" column="usable" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Reserved" column="reserved" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Available" column="available" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Incoming" column="incoming" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Demand" column="demand" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Projected" column="projected" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Exception" column="exception" sort={sort} setSort={setSort} defaultDirection="desc" /></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><button className="table-link" onClick={() => onOpen(product.id)}>{product.name}</button><small>{product.sku} · {product.specification}</small>{product.customerRef && <span className="allocation-tag">{product.customerRef}</span>}</td><td><strong>{product.locationCode}</strong><small>{product.location}</small></td><td className="numeric">{product.onHand}</td><td className="numeric">{product.usable}</td><td className="numeric">{product.reserved}</td><td className="numeric strong">{product.available}</td><td className="numeric">{product.incoming}</td><td className="numeric">{product.demand}</td><td className={`numeric strong ${product.projected < 0 ? "text-danger" : ""}`}>{product.projected}</td><td>{product.projected < 0 ? <StatusBadge tone="danger">Shortage {Math.abs(product.projected)}</StatusBadge> : product.inventoryPolicy === "stocked" && product.projected <= product.reorderPoint && product.projected < product.maxStockLevel ? <StatusBadge tone="warning">Reorder</StatusBadge> : <StatusBadge tone="success">Healthy</StatusBadge>}</td></tr>)}{!products.length ? <tr><td colSpan={10}><div className="empty-inline">No product matches this filter.</div></td></tr> : null}</tbody></table></div></section></div>;
}

/**
 * Catalog and Stock used to render the same balances table, so two nav entries led to one
 * screen. The catalog answers "what do we sell, at what cost, at what margin"; Stock answers
 * "how much is there and where".
 */
function reorderRuleLabel(product: Product) {
  if (product.reorderRuleMode === "global") return `Company · ${product.reorderRulePercent ?? 70}% of max`;
  if (product.reorderRuleMode === "custom") return `Custom · ${product.reorderRulePercent ?? 0}% of max`;
  return "Manual quantity";
}

function CatalogView({ products, onOpen, onEdit, sort, setSort }: { products: Product[]; onOpen: (id: string) => void; onEdit?: (product: Product) => void } & WorklistSortProps) {
  return <section className="panel worklist"><div className="responsive-table"><table>
    <caption className="sr-only">Product catalog</caption>
    <thead><tr><SortableHeader label="Product" column="product" sort={sort} setSort={setSort} /><SortableHeader label="Configuration" column="configuration" sort={sort} setSort={setSort} /><SortableHeader label="Policy" column="policy" sort={sort} setSort={setSort} /><SortableHeader label="Units · base / buy / sell" column="units" sort={sort} setSort={setSort} /><SortableHeader label="Standard cost" column="standardCost" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Last PO cost" column="lastUnitCost" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Selling price" column="sellingPrice" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Pricing" column="pricingMode" sort={sort} setSort={setSort} /><SortableHeader label="Margin" column="margin" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Reorder point" column="reorderPoint" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Max stock" column="maxStockLevel" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><th scope="col">Reorder rule</th></tr></thead>
    <tbody>{products.map((product) => {
      const costBasis = product.lastUnitCost ?? product.standardCost;
      const margin = product.sellingPrice > 0 ? (product.sellingPrice - costBasis) / product.sellingPrice * 100 : 0;
      return <tr key={product.id}>
        <td><button className="table-link" onClick={() => onOpen(product.id)}>{product.name}</button><small>{product.sku}</small></td>
        <td>{product.specification}</td>
        <td><StatusBadge tone="info">{titleCase(product.inventoryPolicy)}</StatusBadge></td>
        {/* Nearly every product buys, stocks, and sells in the same unit, and printing
            "EA / EA / EA" across the whole catalog buried the few that genuinely differ. */}
        <td>{product.baseUomCode === product.purchaseUomCode && product.baseUomCode === product.salesUomCode
          ? product.baseUomCode
          : `${product.baseUomCode} / ${product.purchaseUomCode} / ${product.salesUomCode}`}</td>
        <td className="numeric">{exact.format(product.standardCost)}</td>
        <td className="numeric">{product.lastUnitCost == null ? <span className="muted">—</span> : <>{exact.format(product.lastUnitCost)}<small>{product.lastUnitCostSourcePoNumber ?? "Approved PO"}</small></>}</td>
        <td className="numeric">{exact.format(product.sellingPrice)}</td>
        <td><StatusBadge tone={product.pricingMode === "automatic" ? "success" : "info"}>{titleCase(product.pricingMode)}</StatusBadge><small>{product.pricingMode === "automatic" ? product.appliedMarginRuleCode ?? "Default margin" : `Suggested ${exact.format(product.suggestedSellingPrice)}`}</small></td>
        {/* A SKU priced at or below its own cost is a pricing error worth seeing in the list. */}
        <td className={`numeric strong ${margin <= 0 ? "text-danger" : ""}`}>{product.sellingPrice > 0 ? `${margin.toFixed(1)}%` : "—"}</td>
        <td className="numeric">{formatQuantity(product.reorderPoint)}</td>
        <td className="numeric">{formatQuantity(product.maxStockLevel)}</td>
        <td><span className={`reorder-rule-badge ${product.reorderRuleMode}`}>{reorderRuleLabel(product)}</span>{onEdit ? <button type="button" className="row-action reorder-rule-action" onClick={() => onEdit(product)}>Set max &amp; rule</button> : null}</td>
      </tr>;
    })}{!products.length ? <tr><td colSpan={12}><div className="empty-inline">No products match this view.</div></td></tr> : null}</tbody>
  </table></div></section>;
}

function ProductDetail({ product, movements, onBack, backLabel, onEdit, canManagePictures, canConsolidate, viewerEmail, viewerRole, onChanged }: { product: Product; movements: Movement[]; onBack: () => void; backLabel: string; onEdit?: () => void; canManagePictures: boolean; canConsolidate: boolean; viewerEmail: string; viewerRole: string; onChanged: (message: string) => void }) {
  const costBasis = product.lastUnitCost ?? product.standardCost;
  const margin = product.sellingPrice > 0 ? `${(((product.sellingPrice - costBasis) / product.sellingPrice) * 100).toFixed(1)}%` : "—";
  const [movementPage, setMovementPage] = useState(1);
  const [movementTotal, setMovementTotal] = useState(0);
  const [productMovements, setProductMovements] = useState<Movement[]>(movements.filter((movement) => movement.product === product.sku));
  const [balances, setBalances] = useState<Array<InventoryLocationBalance & { inventoryStatus: string }>>([]);
  const [aliases, setAliases] = useState<Array<{ id: string; alias: string; aliasType: string }>>([]);
  const [defaultLocations, setDefaultLocations] = useState<ProductDefaultLocation[]>(product.defaultLocations);
  const [addingAlias, setAddingAlias] = useState(false);
  const [editingBin, setEditingBin] = useState<ProductDefaultLocation | null>(null);
  const [merging, setMerging] = useState(false);
  const [masterBusy, setMasterBusy] = useState(false);
  const [masterError, setMasterError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setHistoryLoading(true); setHistoryError("");
      const params = new URLSearchParams({ detail: "product", productId: product.id, page: String(movementPage), pageSize: "50", asOf: localDateString() });
      const response = await fetch(`/api/snapshot?${params}`, { cache: "no-store", signal: controller.signal });
      const raw = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(text(asRecord(raw.error).message, "Product history could not be loaded."));
      setProductMovements(asRows(raw.movements).map((item, index) => ({ id: text(item.id, `movement-${index}`), time: displayTimestamp(text(item.postedAt)), type: titleCase(text(item.type)), document: `${titleCase(text(item.sourceDocumentType))} · ${text(item.sourceDocumentId)}`, product: product.sku, quantity: number(item.quantity), from: text(item.fromLocationCode) || movementCounterparty(text(item.type), "from"), to: text(item.toLocationCode) || movementCounterparty(text(item.type), "to"), user: text(item.postedBy, "System") })));
      setBalances(asRows(raw.balances).map((item) => ({ productId: product.id, locationId: text(item.locationId), recordedQuantity: number(item.recordedQuantity), reservedQuantity: number(item.reservedQuantity), version: number(item.version), locationCode: text(item.locationCode, "Missing location"), locationName: text(item.locationName, "Referenced location no longer exists"), warehouseName: text(item.warehouseName, "Unreconciled"), inventoryStatus: text(item.inventoryStatus, "orphaned") })));
      setAliases(asRows(raw.aliases).map((item) => ({ id: text(item.id), alias: text(item.alias), aliasType: text(item.aliasType, "alternate") })));
      setDefaultLocations(asRows(raw.defaultLocations).map((item) => ({ warehouseId: text(item.warehouseId), warehouseCode: text(item.warehouseCode), warehouseName: text(item.warehouseName), locationId: text(item.locationId) || undefined, locationCode: text(item.locationCode) || undefined, locationName: text(item.locationName) || undefined, version: item.version == null ? undefined : number(item.version) })));
      setMovementTotal(number(asRecord(raw.pagination).total));
    })().catch((caught) => { if (!controller.signal.aborted) setHistoryError(caught instanceof Error ? caught.message : "Product history could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [historyRefresh, movementPage, product.id, product.sku]);
  const changed = (message: string) => { setAddingAlias(false); setEditingBin(null); setMerging(false); setMasterError(""); setHistoryRefresh((current) => current + 1); onChanged(message); };
  const removeAlias = async (alias: { id: string; alias: string }) => {
    if (!window.confirm(`Remove “${alias.alias}” as an alternate identifier for ${product.sku}?`)) return;
    setMasterBusy(true); setMasterError("");
    const idempotencyKey = crypto.randomUUID();
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ command: "removeProductAlias", entityId: product.id, version: product.productVersion, idempotencyKey, payload: { aliasId: alias.id } }) });
      const result = await response.json() as { message?: string; error?: string | { message?: string } };
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "The alias could not be removed.");
      changed(result.message ?? `Alias “${alias.alias}” removed.`);
    } catch (caught) { setMasterError(caught instanceof Error ? caught.message : "The alias could not be removed."); }
    finally { setMasterBusy(false); }
  };
  const movementPages = Math.max(1, Math.ceil(movementTotal / 50));
  const balanceTable = useLocalTableSort(balances, { warehouse: (row) => row.warehouseName, location: (row) => `${row.locationCode} ${row.locationName}`, status: (row) => row.inventoryStatus, onHand: (row) => row.recordedQuantity, reserved: (row) => row.reservedQuantity, available: (row) => row.recordedQuantity - row.reservedQuantity });
  return <div className="object-page">
    <button className="back-button" onClick={onBack}>← Back to {backLabel}</button>
    {historyError ? <div className="exception-banner" role="alert"><span aria-hidden="true">!</span><div><strong>Product detail unavailable</strong><p>{historyError}</p><button className="button secondary" onClick={() => setHistoryRefresh((current) => current + 1)}>Retry</button></div></div> : null}
    <section className="object-header panel product-header"><div className="window-thumb large" aria-hidden="true"><span /><span /><span /><span /></div><div className="object-title"><div><span className="section-kicker">{product.policy}</span><h2>{product.name}</h2><p>{product.specification}</p><code>{product.sku}</code></div><div className="object-total"><span>Selling price</span><strong>{exact.format(product.sellingPrice)}</strong><small>margin {margin}</small></div></div>
      <div className="object-actions">{onEdit ? <button className="button primary" onClick={onEdit}>Edit product</button> : null}{canConsolidate ? <><button className="button secondary" onClick={() => setAddingAlias(true)}>Add alias</button><button className="button secondary" onClick={() => setMerging(true)}>Merge duplicate</button></> : null}</div></section>
    {masterError ? <div className="error-summary" role="alert"><p>{masterError}</p></div> : null}
    <section className="metric-row object-metrics"><MetricDisplay label="On hand" value={product.onHand} /><MetricDisplay label="Usable" value={product.usable} /><MetricDisplay label="Reserved" value={product.reserved} tone="info" /><MetricDisplay label="Available now" value={product.available} tone="success" /><MetricDisplay label="Incoming" value={product.incoming} tone="info" /><MetricDisplay label="Projected" value={product.projected} tone={product.projected < 0 ? "danger" : "neutral"} /></section>
    <section className="panel replenishment-summary"><div className="replenishment-summary-heading"><div><span className="section-kicker">Replenishment</span><h3>Max stock &amp; reorder point</h3><p>When projected stock reaches the reorder point, purchasing restores this part to its maximum.</p></div>{onEdit ? <button type="button" className="button primary" onClick={onEdit}>Set max &amp; reorder rule</button> : null}</div><div className="replenishment-values"><div><small>Maximum stock</small><strong>{formatQuantity(product.maxStockLevel)}</strong><span>{product.baseUomCode}</span></div><div><small>Reorder point</small><strong>{formatQuantity(product.reorderPoint)}</strong><span>{product.baseUomCode}</span></div><div><small>Rule</small><strong className="rule-value">{reorderRuleLabel(product)}</strong><span>{product.reorderRuleMode === "manual" ? "Set for this part" : "Recalculates when max changes"}</span></div></div></section>
    <ProductPictures product={product} canManage={canManagePictures} viewerEmail={viewerEmail} viewerRole={viewerRole} />
    {/* Cost, price, units and policy were visible in the catalog list and absent from the record
        the list links to, so the detail page could not answer what the product is or costs. */}
    <div className="detail-columns">
      <DocumentFacts title="Commercial" facts={[
        ["Standard cost", exact.format(product.standardCost)],
        ["Last approved PO cost", product.lastUnitCost == null ? "No approved PO cost" : exact.format(product.lastUnitCost)],
        ["Last cost source", product.lastUnitCostSourcePoNumber ? [product.lastUnitCostSourcePoNumber, product.lastUnitCostVendorName, product.lastUnitCostAt ? formatDocumentDate(product.lastUnitCostAt) : ""].filter(Boolean).join(" · ") : "Standard cost fallback"],
        ["Selling price", exact.format(product.sellingPrice)],
        ["Suggested price", exact.format(product.suggestedSellingPrice)],
        ["Pricing", `${titleCase(product.pricingMode)}${product.appliedMarginRuleCode ? ` · ${product.appliedMarginRuleCode}` : ""}`],
        ["Gross margin on cost basis", margin],
        ...(product.manualPriceReason ? [["Manual override reason", product.manualPriceReason] as [string, string]] : []),
      ]} />
      <DocumentFacts title="Catalog" facts={[
        ["Inventory policy", titleCase(product.inventoryPolicy)],
        ["Tracking policy", titleCase(product.trackingPolicy)],
        ["Base unit", product.baseUomCode],
        ["Purchasing unit", product.purchaseUomCode],
        ["Sales unit", product.salesUomCode],
      ]} />
    </div>
    <div className="detail-columns">
      <section className="panel"><PanelHeading title="Aliases" detail="Alternate names and part numbers resolve to this item" />
        {aliases.length ? <ul className="plain-list">{aliases.map((alias) => <li key={alias.id}><span><strong>{alias.alias}</strong><small>{alias.aliasType === "merged_record" ? "Retained from merge" : titleCase(alias.aliasType)}</small></span>{canConsolidate && alias.aliasType !== "merged_record" ? <button type="button" className="row-action" disabled={masterBusy} onClick={() => void removeAlias(alias)}>Remove</button> : null}</li>)}</ul> : <div className="empty-inline">No alternate identifiers have been added.</div>}
      </section>
      <section className="panel"><PanelHeading title="Preferred warehouse bins" detail="Receiving defaults by warehouse" />
        <ul className="plain-list">{defaultLocations.map((item) => <li key={item.warehouseId}><span><strong>{item.warehouseCode} · {item.warehouseName}</strong><small>{item.locationId ? `${item.locationCode} · ${item.locationName}` : "No preferred bin set"}</small></span>{canConsolidate ? <button type="button" className="row-action" onClick={() => setEditingBin(item)}>{item.locationId ? "Change" : "Set bin"}</button> : null}</li>)}</ul>
      </section>
    </div>
    <section className="panel"><PanelHeading title="Location balances" /><div className="responsive-table"><table><thead><tr><SortableHeader label="Warehouse" column="warehouse" sort={balanceTable.sort} setSort={balanceTable.setSort} /><SortableHeader label="Location" column="location" sort={balanceTable.sort} setSort={balanceTable.setSort} /><SortableHeader label="Status" column="status" sort={balanceTable.sort} setSort={balanceTable.setSort} /><SortableHeader label="On hand" column="onHand" sort={balanceTable.sort} setSort={balanceTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Reserved" column="reserved" sort={balanceTable.sort} setSort={balanceTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Available" column="available" sort={balanceTable.sort} setSort={balanceTable.setSort} className="numeric" defaultDirection="desc" /></tr></thead><tbody>{balanceTable.rows.map((balance) => <tr key={balance.locationId}><td>{balance.warehouseName}</td><td><strong>{balance.locationCode}</strong><small>{balance.locationName}</small></td><td><StatusBadge tone={balance.inventoryStatus === "orphaned" ? "danger" : balance.inventoryStatus === "usable" ? "success" : "warning"}>{titleCase(balance.inventoryStatus)}</StatusBadge></td><td className="numeric">{balance.recordedQuantity}</td><td className="numeric">{balance.reservedQuantity}</td><td className="numeric strong">{balance.recordedQuantity - balance.reservedQuantity}</td></tr>)}</tbody></table></div></section>
    <section className="panel"><PanelHeading title="Movement history" detail={`${movementTotal} posted record${movementTotal === 1 ? "" : "s"}`} />{historyLoading ? <div className="empty-inline">Loading product history…</div> : productMovements.length ? <MovementsTable movements={productMovements} /> : <div className="empty-inline">No movement records exist for this product.</div>}{!historyLoading && movementPages > 1 ? <nav className="snapshot-pagination" aria-label="Product movement pages"><button className="button secondary" disabled={movementPage <= 1} onClick={() => setMovementPage((current) => current - 1)}>Previous</button><span>Page {movementPage} of {movementPages}</span><button className="button secondary" disabled={movementPage >= movementPages} onClick={() => setMovementPage((current) => current + 1)}>Next</button></nav> : null}</section>
    {addingAlias ? <ProductAliasDialog product={product} onClose={() => setAddingAlias(false)} onSaved={changed} /> : null}
    {editingBin ? <ProductBinDialog product={product} warehouse={editingBin} onClose={() => setEditingBin(null)} onSaved={changed} /> : null}
    {merging ? <MergeProductDialog product={product} onClose={() => setMerging(false)} onSaved={changed} /> : null}
  </div>;
}

async function postWorkflow(command: string, entityId: string, version: number, payload: Record<string, unknown>) {
  const idempotencyKey = crypto.randomUUID();
  const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ command, entityId, version, idempotencyKey, payload }) });
  const result = await response.json() as { message?: string; error?: string | { message?: string } };
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "The change could not be completed.");
  return result.message ?? "The change was completed.";
}

function ProductAliasDialog({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: (message: string) => void }) {
  const [alias, setAlias] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useDialogDismiss(onClose, busy);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { onSaved(await postWorkflow("addProductAlias", product.id, product.productVersion, { alias })); } catch (caught) { setError(caught instanceof Error ? caught.message : "The alias could not be added."); } finally { setBusy(false); } };
  return <div className="modal-overlay" role="presentation"><section className="command-dialog quick-create-dialog" role="dialog" aria-modal="true" aria-label="Add product alias"><div className="dialog-header"><div><span className="section-kicker">{product.sku}</span><h2>Add product alias</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div><form className="command-form" onSubmit={submit}>{error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}<label><span>Alternate name or part number</span><input autoFocus autoComplete="off" value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="Vendor SKU, legacy number, or common name" required /></label><p className="formula-note">Searches and product pickers will resolve this value to {product.sku}.</p><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy || !alias.trim()}>{busy ? "Adding…" : "Add alias"}</button></div></form></section></div>;
}

function ProductBinDialog({ product, warehouse, onClose, onSaved }: { product: Product; warehouse: ProductDefaultLocation; onClose: () => void; onSaved: (message: string) => void }) {
  const [locationId, setLocationId] = useState(warehouse.locationId ?? ""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useDialogDismiss(onClose, busy);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { onSaved(await postWorkflow("setProductDefaultLocation", product.id, product.productVersion, { warehouseId: warehouse.warehouseId, locationId })); } catch (caught) { setError(caught instanceof Error ? caught.message : "The preferred bin could not be saved."); } finally { setBusy(false); } };
  return <div className="modal-overlay" role="presentation"><section className="command-dialog quick-create-dialog" role="dialog" aria-modal="true" aria-label="Set preferred warehouse bin"><div className="dialog-header"><div><span className="section-kicker">{product.sku} · {warehouse.warehouseCode}</span><h2>Set preferred bin</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div><form className="command-form" onSubmit={submit}>{error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}<label><span>Usable bin in {warehouse.warehouseName}</span><ReferenceSearchSelect kind="locations" role="bin" warehouseId={warehouse.warehouseId} value={locationId} initialOptions={warehouse.locationId ? [{ id: warehouse.locationId, label: `${warehouse.locationCode} · ${warehouse.locationName}`, detail: warehouse.warehouseName }] : []} onSelect={(option) => setLocationId(option.id)} placeholder="Search bins in this warehouse" /></label><p className="formula-note">Future receipts of this product into {warehouse.warehouseCode} will start with this bin selected.</p><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy || !locationId}>{busy ? "Saving…" : "Save preferred bin"}</button></div></form></section></div>;
}

function MergeProductDialog({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: (message: string) => void }) {
  const [source, setSource] = useState<LookupOption | null>(null); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useDialogDismiss(onClose, busy);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!source || source.id === product.id) return setError("Choose a different duplicate product."); setBusy(true); setError(""); try { onSaved(await postWorkflow("mergeProducts", product.id, product.productVersion, { sourceProductId: source.id })); } catch (caught) { setError(caught instanceof Error ? caught.message : "The products could not be merged."); } finally { setBusy(false); } };
  return <div className="modal-overlay" role="presentation"><section className="command-dialog" role="dialog" aria-modal="true" aria-label="Merge duplicate product"><div className="dialog-header"><div><span className="section-kicker">Surviving item · {product.sku}</span><h2>Merge duplicate product</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div><form className="command-form" onSubmit={submit}>{error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}<label><span>Duplicate item to retire</span><ReferenceSearchSelect kind="products" value={source?.id ?? ""} initialOptions={[]} onSelect={setSource} placeholder="Search SKU, name, manufacturer SKU, or alias" /></label><div className="next-step-banner"><div><strong>{source ? source.label : "Choose the duplicate record"}</strong><p>Its on-hand and reserved balances will be summed into {product.sku}. Orders, costing, and product references move to the surviving item; its old identifiers become aliases.</p></div></div><label className="radio-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I understand the duplicate item will be deactivated and this merge cannot be undone.</span></label><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button danger" disabled={busy || !source || !confirmed}>{busy ? "Merging…" : `Merge into ${product.sku}`}</button></div></form></section></div>;
}

function ProductPictures({ product, canManage, viewerEmail, viewerRole }: { product: Product; canManage: boolean; viewerEmail: string; viewerRole: string }) {
  const [pictures, setPictures] = useState<ProductPicture[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const loadPictures = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ documentType: "product", documentId: product.id });
      const response = await fetch(`/api/attachments?${params}`, { cache: "no-store", signal });
      const result = await response.json() as { attachments?: Array<Record<string, unknown>>; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Pictures could not be loaded.");
      setPictures((result.attachments ?? []).filter((item) => text(item.category) === "product_photo" && text(item.contentType).startsWith("image/")).map((item) => ({
        id: text(item.id), fileName: text(item.fileName), contentType: text(item.contentType), sizeBytes: number(item.sizeBytes), ownerEmail: text(item.ownerEmail), uploadedAt: text(item.uploadedAt),
      })));
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(caught instanceof Error ? caught.message : "Pictures could not be loaded.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [product.id]);

  useEffect(() => {
    const controller = new AbortController();
    // Deferred a tick so the load's own "loading" state is not set synchronously inside the effect.
    const timer = window.setTimeout(() => void loadPictures(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadPictures]);

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedFiles.length) return;
    setBusy(true); setError(""); setMessage("");
    let uploaded = 0;
    try {
      for (const file of selectedFiles) {
        const form = new FormData();
        form.set("documentType", "product"); form.set("documentId", product.id); form.set("category", "product_photo"); form.set("file", file);
        const response = await fetch("/api/attachments", { method: "POST", body: form });
        const result = await response.json() as { error?: { message?: string } };
        if (!response.ok) throw new Error(result.error?.message ?? `${file.name} could not be uploaded.`);
        uploaded += 1;
      }
      setSelectedFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      await loadPictures();
      setMessage(`${uploaded} picture${uploaded === 1 ? "" : "s"} added to ${product.sku}.`);
    } catch (caught) {
      if (uploaded) await loadPictures();
      setError(caught instanceof Error ? caught.message : "The pictures could not be uploaded.");
    } finally { setBusy(false); }
  };

  const remove = async (picture: ProductPicture) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/attachments/${encodeURIComponent(picture.id)}`, { method: "DELETE" });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? `${picture.fileName} could not be removed.`);
      setPictures((current) => current.filter((item) => item.id !== picture.id));
      setMessage(`${picture.fileName} removed.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The picture could not be removed."); }
    finally { setBusy(false); }
  };

  const canRemoveAny = /manager|administrator/i.test(viewerRole);
  return <section className="panel product-pictures">
    <PanelHeading title="Pictures" detail={`${pictures.length} picture${pictures.length === 1 ? "" : "s"}`} />
    {canManage ? <form className="product-picture-upload" onSubmit={upload}>
      <label><span>Add pictures</span><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))} /></label>
      <button className="button primary" type="submit" disabled={busy || !selectedFiles.length}>{busy ? "Uploading…" : selectedFiles.length > 1 ? `Add ${selectedFiles.length} pictures` : "Add picture"}</button>
      <small>JPEG, PNG, or WebP · up to 10 MB each</small>
    </form> : <p className="read-only-label product-picture-readonly">Read-only access: picture uploads are hidden.</p>}
    {error ? <div className="product-picture-feedback error" role="alert">{error}</div> : null}
    {message ? <div className="product-picture-feedback success" role="status">{message}</div> : null}
    {loading ? <div className="empty-inline">Loading pictures…</div> : pictures.length ? <div className="product-picture-grid">{pictures.map((picture, index) => {
      const canRemove = canManage && (canRemoveAny || picture.ownerEmail.toLowerCase() === viewerEmail.toLowerCase());
      return <article key={picture.id} className="product-picture-card">
        <a className="product-picture-preview" href={`/api/attachments/${encodeURIComponent(picture.id)}`} target="_blank" rel="noreferrer" aria-label={`Open ${picture.fileName} full size`}>
          <img src={`/api/attachments/${encodeURIComponent(picture.id)}`} alt={`${product.name} — picture ${index + 1}`} loading="lazy" />
        </a>
        <div className="product-picture-meta"><div><strong title={picture.fileName}>{picture.fileName}</strong><small>{(picture.sizeBytes / 1024 / 1024).toFixed(1)} MB · {formatDocumentDate(picture.uploadedAt)}</small></div>{canRemove ? <button className="text-button danger-text" type="button" disabled={busy} onClick={() => void remove(picture)}>Remove</button> : null}</div>
      </article>;
    })}</div> : <div className="product-picture-empty"><div className="window-thumb" aria-hidden="true"><span /><span /><span /><span /></div><div><strong>No pictures yet</strong><p>Add photos of the item, packaging, labels, or identifying details.</p></div></div>}
  </section>;
}

/**
 * Editing a catalog row. `updateProduct` has always existed on the server; the catalog offered
 * only "Add product", so a typo in a SKU or a price change had no path through the interface.
 */
function EditProductDialog({ product, companyReorderPercent, onClose, onSaved }: { product: Product; companyReorderPercent: number; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState({
    sku: product.sku, name: product.name, manufacturerSku: product.manufacturerSku ?? "",
    category: product.category, material: product.material, dimensions: product.dimensions, finish: product.finish,
    trackingPolicy: product.trackingPolicy, inventoryPolicy: product.inventoryPolicy,
    reorderPoint: product.reorderPoint, maxStockLevel: product.maxStockLevel, reorderRuleMode: product.reorderRuleMode,
    reorderRulePercent: product.reorderRuleMode === "custom" ? product.reorderRulePercent ?? 70 : companyReorderPercent,
    standardCost: product.standardCost, sellingPrice: product.sellingPrice,
    pricingMode: product.pricingMode, manualPriceReason: product.manualPriceReason ?? "",
  });
  const [busy, setBusy] = useState(false);
  useDialogDismiss(onClose, busy);
  const [error, setError] = useState("");
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const missing = (["sku", "name", "category", "material", "dimensions", "finish"] as const).filter((key) => !form[key].trim());
  const activeReorderPercent = form.reorderRuleMode === "global" ? companyReorderPercent : form.reorderRulePercent;
  const effectiveReorderPoint = form.reorderRuleMode === "manual" ? form.reorderPoint : Math.round(form.maxStockLevel * activeReorderPercent * 10) / 1000;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (missing.length) return setError(`Enter the ${missing.join(", ")} before saving.`);
    if (form.inventoryPolicy === "stocked" && form.maxStockLevel < effectiveReorderPoint) return setError("Maximum stock must be at least the reorder point.");
    if (form.reorderRuleMode === "custom" && (form.reorderRulePercent <= 0 || form.reorderRulePercent > 100)) return setError("Enter a custom percentage greater than 0 and no more than 100.");
    setBusy(true); setError("");
    const idempotencyKey = crypto.randomUUID();
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({
        command: "updateProduct", entityId: product.id, version: product.productVersion, idempotencyKey,
        payload: { sku: form.sku.trim(), name: form.name.trim(), manufacturerSku: form.manufacturerSku.trim(),
          category: form.category.trim(), material: form.material.trim(), dimensions: form.dimensions.trim(), finish: form.finish.trim(),
          trackingPolicy: form.trackingPolicy, inventoryPolicy: form.inventoryPolicy, reorderPoint: effectiveReorderPoint, maxStockLevel: form.maxStockLevel,
          reorderRuleMode: form.reorderRuleMode, reorderRulePercent: form.reorderRuleMode === "custom" ? form.reorderRulePercent : undefined,
          standardCostCents: Math.round(form.standardCost * 100), sellingPriceCents: Math.round(form.sellingPrice * 100),
          pricingMode: form.pricingMode, manualPriceReason: form.pricingMode === "manual" ? form.manualPriceReason.trim() || "Manual catalog price" : "",
          baseUomId: product.baseUomId, purchaseUomId: product.purchaseUomId, salesUomId: product.salesUomId },
      }) });
      const result = await response.json() as { error?: string | { message?: string } };
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "The product could not be saved.");
      onSaved(`${form.sku.trim()} saved.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The product could not be saved."); }
    finally { setBusy(false); }
  };
  return <div className="modal-overlay" role="presentation"><section className="command-dialog quick-create-dialog" role="dialog" aria-modal="true" aria-label={`Edit ${product.sku}`}>
    <div className="dialog-header"><h2>Edit {product.sku}</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
    <form onSubmit={submit} noValidate>
      {error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}
      <div className="command-form form-grid">
        <label><span>SKU</span><input value={form.sku} onChange={(event) => set({ sku: event.target.value })} required /></label>
        <label><span>Name</span><input value={form.name} onChange={(event) => set({ name: event.target.value })} required /></label>
        <label><span>Manufacturer SKU</span><input value={form.manufacturerSku} onChange={(event) => set({ manufacturerSku: event.target.value })} /></label>
        <label><span>Category</span><input value={form.category} onChange={(event) => set({ category: event.target.value })} required /></label>
        <label><span>Material</span><input value={form.material} onChange={(event) => set({ material: event.target.value })} required /></label>
        <label><span>Dimensions / configuration</span><input value={form.dimensions} onChange={(event) => set({ dimensions: event.target.value })} required /></label>
        <label><span>Finish</span><input value={form.finish} onChange={(event) => set({ finish: event.target.value })} required /></label>
        <label><span>Tracking policy</span><select value={form.trackingPolicy} onChange={(event) => set({ trackingPolicy: event.target.value })}><option value="quantity">Quantity</option><option value="lot">Lot</option><option value="serial">Serial</option></select></label>
        <label><span>Inventory policy</span><select value={form.inventoryPolicy} onChange={(event) => set({ inventoryPolicy: event.target.value })}><option value="stocked">Stocked</option><option value="special_order">Special order</option><option value="drop_ship">Drop ship</option></select></label>
        <fieldset className="replenishment-editor full-field"><legend>Max stock &amp; reorder rule</legend><div className="replenishment-editor-intro"><strong>Set the ceiling first, then choose when to reorder.</strong><small>Purchasing suggests enough stock to return this part to its maximum.</small></div><label><span>Maximum stock level ({product.baseUomCode})</span><NumberField min="0" step="0.001" value={form.maxStockLevel} onChange={(maxStockLevel) => set({ maxStockLevel })} /><small>The target quantity after replenishment.</small></label><label><span>Reorder method</span><select value={form.reorderRuleMode} onChange={(event) => set({ reorderRuleMode: event.target.value as "manual" | "global" | "custom" })}><option value="manual">Enter a quantity manually</option><option value="global">Use company rule ({companyReorderPercent}% of max)</option><option value="custom">Use a custom percentage</option></select><small>Company-rule parts update when max changes.</small></label>{form.reorderRuleMode === "manual" ? <label><span>Reorder point ({product.baseUomCode})</span><NumberField min="0" max={form.maxStockLevel} step="0.001" value={form.reorderPoint} onChange={(reorderPoint) => set({ reorderPoint })} /><small>Start replenishment at or below this quantity.</small></label> : form.reorderRuleMode === "custom" ? <label><span>Custom percentage of max</span><NumberField min="0.1" max="100" step="0.1" value={form.reorderRulePercent} onChange={(reorderRulePercent) => set({ reorderRulePercent })} /><small>This rule applies only to this part.</small></label> : <div className="reorder-company-note"><span>Company rule</span><strong>{companyReorderPercent}% of maximum stock</strong><small>Change it for all following parts in Settings → System policies.</small></div>}<div className="reorder-preview"><span>Resulting reorder point</span><strong>{formatQuantity(effectiveReorderPoint)} {product.baseUomCode}</strong><small>{form.reorderRuleMode === "manual" ? "Manual quantity" : `${activeReorderPercent}% × ${formatQuantity(form.maxStockLevel)} maximum`}</small></div></fieldset>
        <label><span>Standard cost</span><NumberField min="0" step="0.01" value={form.standardCost} onChange={(standardCost) => set({ standardCost })} /></label>
        <label><span>Pricing mode</span><select value={form.pricingMode} onChange={(event) => set({ pricingMode: event.target.value as "automatic" | "manual" })}><option value="automatic">Automatic from margin matrix</option><option value="manual">Manual override</option></select></label>
        <label><span>Selling price</span><NumberField min="0" step="0.01" value={form.sellingPrice} onChange={(sellingPrice) => set({ sellingPrice })} disabled={form.pricingMode === "automatic"} /><small>{form.pricingMode === "automatic" ? `Will use the current suggestion (${exact.format(product.suggestedSellingPrice)}).` : `Current matrix suggestion: ${exact.format(product.suggestedSellingPrice)}.`}</small></label>
        {form.pricingMode === "manual" ? <label className="full"><span>Override reason</span><input value={form.manualPriceReason} onChange={(event) => set({ manualPriceReason: event.target.value })} placeholder="Why this product does not follow the matrix" required /></label> : null}
      </div>
      {/* Units are fixed once a product has movement history, so they are shown rather than edited here. */}
      <p className="read-only-label">Units of measure ({product.baseUomCode} base · {product.purchaseUomCode} purchasing · {product.salesUomCode} sales) are managed from master data.</p>
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save product"}</button></div>
    </form>
  </section></div>;
}

function MovementsView({ movements, onOpenOrder, sort, setSort }: { movements: Movement[]; onOpenOrder?: (movement: Movement) => void } & WorklistSortProps) {
  return <section className="panel worklist"><MovementsTable movements={movements} onOpenOrder={onOpenOrder} sort={sort} setSort={setSort} /></section>;
}

function MovementsTable({ movements, onOpenOrder, sort, setSort }: { movements: Movement[]; onOpenOrder?: (movement: Movement) => void; sort?: string; setSort?: (value: string) => void }) {
  const local = useLocalTableSort(movements, { posted: (row) => row.time, movement: (row) => row.type, document: (row) => row.document, order: (row) => row.relatedOrderNumber, product: (row) => row.product, quantity: (row) => row.quantity, from: (row) => row.from, to: (row) => row.to, actor: (row) => row.user });
  const activeSort = sort ?? local.sort;
  const changeSort = setSort ?? local.setSort;
  const rows = setSort ? movements : local.rows;
  const heading = (label: string, column: string, className?: string, defaultDirection?: SortDirection) => <SortableHeader label={label} column={column} sort={activeSort} setSort={changeSort} className={className} defaultDirection={defaultDirection} />;
  return <div className="responsive-table"><table><caption className="sr-only">Posted inventory movements</caption><thead><tr>{heading("Date and time", "posted", undefined, "desc")}{heading("Movement", "movement")}{heading("Source document", "document")}{heading("Order", "order")}{heading("Product / unit", "product")}{heading("Quantity", "quantity", "numeric", "desc")}{heading("From", "from")}{heading("To", "to")}{heading("Posted by", "actor")}</tr></thead><tbody>{rows.map((movement) => <tr key={movement.id}>
    <td>{movement.time}</td>
    <td><StatusBadge>{movement.type}</StatusBadge></td>
    <td><strong>{movement.document}</strong>{movement.documentType ? <small>{movement.documentType}</small> : null}</td>
    {/* Movements were unreadable and dead-ended: a raw uuid with nothing to open. */}
    <td>{movement.relatedOrderNumber
      ? (onOpenOrder ? <button className="table-link" onClick={() => onOpenOrder(movement)}>{movement.relatedOrderNumber}</button> : movement.relatedOrderNumber)
      : <span className="muted">—</span>}</td>
    <td><code>{movement.product}</code></td>
    <td className={`numeric strong ${movement.quantity < 0 ? "text-danger" : "text-success"}`}>{movement.quantity > 0 ? "+" : ""}{movement.quantity}</td>
    <td>{movement.from}</td><td>{movement.to}</td><td title={movement.user}>{actorName(movement.user)}</td>
  </tr>)}{!movements.length ? <tr><td colSpan={9}><div className="empty-inline">No posted movement matches this filter.</div></td></tr> : null}</tbody></table></div>;
}

function PartnersView({ partners, selectedId, canApprove, canOperate, canAdminister, onOpen, onEdit, onChanged, onOpenOrder, sort, setSort }: { partners: Partner[]; selectedId: string | null; canApprove: boolean; canOperate: boolean; canAdminister: boolean; onOpen: (id: string | null) => void; onEdit: (partner: Partner) => void; onChanged: (message: string) => void; onOpenOrder: (order: PartnerOrder) => void } & WorklistSortProps) {
  const selected = partners.find((partner) => partner.id === selectedId);
  if (selected) return <PartnerDetail partner={selected} canApprove={canApprove} canOperate={canOperate} canAdminister={canAdminister} onBack={() => onOpen(null)} onEdit={() => onEdit(selected)} onChanged={onChanged} onOpenOrder={onOpenOrder} />;
  return <section className="panel worklist"><div className="responsive-table"><table><caption className="sr-only">Customers and vendors</caption><thead><tr><SortableHeader label="Account" column="partner" sort={sort} setSort={setSort} /><SortableHeader label="Type" column="type" sort={sort} setSort={setSort} /><SortableHeader label="Contact" column="contact" sort={sort} setSort={setSort} /><SortableHeader label="Address" column="address" sort={sort} setSort={setSort} /><SortableHeader label="Terms" column="terms" sort={sort} setSort={setSort} /><SortableHeader label="Credit control" column="credit" sort={sort} setSort={setSort} defaultDirection="desc" /><th><span className="sr-only">Action</span></th></tr></thead><tbody>{partners.map((partner) => <tr key={partner.id}><td><button className="table-link" onClick={() => onOpen(partner.id)}>{partner.name}</button><small>{partner.code}</small></td><td>{titleCase(partner.type)}</td><td>{partner.email || "—"}<small>{partner.phone || ""}</small></td><td>{[partner.addressLine1, partner.city, partner.region, partner.postalCode].filter(Boolean).join(", ") || "Not recorded"}</td><td>{partner.paymentTerms || "—"}</td><td>{partner.type === "vendor" ? "Not applicable" : partner.creditHold ? <StatusBadge tone="danger">Credit hold</StatusBadge> : partner.creditLimitCents ? formatDocumentMoney(partner.creditLimitCents / 100, partner.currency) : "No limit"}</td><td><button className="row-action" onClick={() => onOpen(partner.id)}>Open</button></td></tr>)}{!partners.length ? <tr><td colSpan={7}><div className="empty-inline">No customer or vendor matches this view.</div></td></tr> : null}</tbody></table></div></section>;
}

type PartnerAddress = { id: string; label: string; contactName?: string; addressLine1: string; addressLine2?: string; city: string; region: string; postalCode: string; country: string; deliveryInstructions?: string; isDefault: boolean; version: number };
type PartnerOrder = { kind: "sales" | "purchase"; id: string; number: string; detail: string };

/** One account in one place: contacts, credit, ship-to sites, and its open commercial state. */
function PartnerDetail({ partner, canApprove, canOperate, canAdminister, onBack, onEdit, onChanged, onOpenOrder }: { partner: Partner; canApprove: boolean; canOperate: boolean; canAdminister: boolean; onBack: () => void; onEdit: () => void; onChanged: (message: string) => void; onOpenOrder: (order: PartnerOrder) => void }) {
  const [addresses, setAddresses] = useState<PartnerAddress[]>([]);
  const [orders, setOrders] = useState<PartnerOrder[]>([]);
  const [invoices, setInvoices] = useState<Array<{ id: string; number: string; status: string; invoiceDate: string; dueDate: string; total: number; paid: number; outstanding: number; currency: string }>>([]);
  const [priceLists, setPriceLists] = useState<Array<{ id: string; label: string; detail: string }>>([]);
  const [addingAddress, setAddingAddress] = useState(false);
  const [editingAddress, setEditingAddress] = useState<PartnerAddress | null>(null);
  const [deactivatingAddress, setDeactivatingAddress] = useState<PartnerAddress | null>(null);
  const [merging, setMerging] = useState(false);
  const [addressMessage, setAddressMessage] = useState("");
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const isCustomer = partner.type === "customer" || partner.type === "both";
  const creditLimit = (partner.creditLimitCents ?? 0) / 100;
  // Credit used is the unpaid balance across every posted invoice, which is exactly what the
  // AR aging report measures the limit against.
  const outstanding = invoices.reduce((sum, invoice) => sum + invoice.outstanding, 0);

  useEffect(() => {
    const controller = new AbortController();
    const loadAll = async (lookup: string, role = "") => {
      const loaded: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 50) {
        const params = new URLSearchParams({ lookup, partnerId: partner.id, limit: "50", offset: String(offset) });
        if (role) params.set("role", role);
        const response = await fetch(`/api/snapshot?${params}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as { items?: unknown; error?: { message?: string } };
        if (!response.ok) throw new Error(result.error?.message ?? `The ${lookup} records could not be loaded.`);
        const page = asRows(result.items);
        loaded.push(...page);
        if (page.length < 50) return loaded;
      }
    };
    void (async () => {
      // Start after the effect has subscribed so React does not receive a synchronous state
      // cascade from the effect body when an address edit triggers a refresh.
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setDetailLoading(true); setDetailError("");
      const loadOrders = async () => {
        const [salesRows, purchaseRows] = await Promise.all([
          partner.type === "vendor" ? Promise.resolve([]) : loadAll("salesOrders", "open"),
          partner.type === "customer" ? Promise.resolve([]) : loadAll("purchaseOrders", "open"),
        ]);
        return [
          ...salesRows.map((item) => ({ kind: "sales" as const, item })),
          ...purchaseRows.map((item) => ({ kind: "purchase" as const, item })),
        ];
      };
      const [addressRows, orderRows, invoiceRows, priceListRows] = await Promise.all([
        loadAll("partnerAddresses"),
        loadOrders(),
        // The whole ledger, not only what is unpaid: a page that said "no open invoices" for an
        // account with a year of settled billing read as an account with no history at all.
        isCustomer ? loadAll("customerInvoices") : Promise.resolve([]),
        isCustomer ? loadAll("priceListAssignments") : Promise.resolve([]),
      ]);
      setAddresses(addressRows.map((item) => ({
        id: text(item.id), label: text(item.label), contactName: text(item.contactName) || undefined,
        addressLine1: text(item.addressLine1), addressLine2: text(item.addressLine2) || undefined,
        city: text(item.city), region: text(item.region), postalCode: text(item.postalCode), country: text(item.country, "CA"),
        deliveryInstructions: text(item.deliveryInstructions) || undefined, isDefault: number(item.isDefault) !== 0, version: number(item.version, 1),
      })));
      setOrders(orderRows.map(({ kind, item }) => ({
        kind, id: text(item.id), number: text(item.number),
        detail: `${partner.type === "both" ? kind === "sales" ? "Sales order · " : "Purchase order · " : ""}${titleCase(text(item.status))} · ${formatDocumentMoney(number(item.totalCents) / 100, text(item.currency, partner.currency))}`,
      })));
      setInvoices(invoiceRows.map((item) => ({
        id: text(item.id), number: text(item.number), status: titleCase(text(item.status, "posted")),
        invoiceDate: text(item.invoiceDate), dueDate: text(item.dueDate),
        total: number(item.totalCents) / 100, paid: number(item.paidCents) / 100,
        outstanding: number(item.outstandingCents) / 100, currency: text(item.currency, partner.currency),
      })));
      setPriceLists(priceListRows.map((item) => ({
        id: text(item.id),
        label: text(item.priceListName) || text(item.priceListCode, "Price list"),
        detail: [text(item.priceListCode), `priority ${number(item.priority)}`, text(item.currency, partner.currency),
          text(item.validFrom) || text(item.validTo) ? `valid ${formatDocumentDate(text(item.validFrom), "any date")} – ${formatDocumentDate(text(item.validTo), "no end")}` : "no date limit"].filter(Boolean).join(" · "),
      })));
    })().catch((caught) => {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setDetailError(caught instanceof Error ? caught.message : "Account activity could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [isCustomer, partner.currency, partner.id, partner.type, refreshToken]);

  const addressTable = useLocalTableSort(addresses, { label: (row) => row.label, contact: (row) => row.contactName, address: (row) => `${row.addressLine1} ${row.city} ${row.region} ${row.postalCode}`, instructions: (row) => row.deliveryInstructions, default: (row) => Number(row.isDefault) });
  const invoiceTable = useLocalTableSort(invoices, { number: (row) => row.number, invoiced: (row) => row.invoiceDate, due: (row) => row.dueDate, status: (row) => row.status, total: (row) => row.total, paid: (row) => row.paid, outstanding: (row) => row.outstanding });

  return <div className="object-page">
    <button className="back-button" onClick={onBack}>← Back to customers &amp; vendors</button>
    {detailError ? <div className="exception-banner" role="alert"><span aria-hidden="true">!</span><div><strong>Account activity unavailable</strong><p>{detailError}</p></div></div> : null}
    <section className="object-header panel"><div className="object-title"><div><span className="section-kicker">{titleCase(partner.type)} · {partner.code}</span><h2>{partner.name}</h2><p>{[partner.email, partner.phone].filter(Boolean).join(" · ") || "No contact recorded"}</p></div>
      {/* A credit limit on its own is not credit control. What matters at order entry is how
          much of it is already used, so the limit is shown beside the live receivable. */}
      {isCustomer ? <div className="object-total"><span>Receivable outstanding</span><strong>{formatDocumentMoney(outstanding, partner.currency)}</strong><small>{creditLimit ? `of ${formatDocumentMoney(creditLimit, partner.currency)} limit` : "No credit limit set"}</small></div> : null}</div>
      {isCustomer && partner.creditHold ? <div className="exception-banner"><span aria-hidden="true">!</span><div><strong>Credit hold</strong><p>New sales orders for this account cannot be confirmed until the hold is released.</p></div></div> : null}
      {isCustomer && !partner.creditHold && creditLimit > 0 && outstanding > creditLimit ? <div className="exception-banner"><span aria-hidden="true">!</span><div><strong>Over credit limit</strong><p>{formatDocumentMoney(outstanding - creditLimit, partner.currency)} above the {formatDocumentMoney(creditLimit, partner.currency)} limit.</p></div></div> : null}
      <div className="object-actions">{canApprove ? <button className="button primary" onClick={onEdit}>Edit {partner.type === "both" ? "customer & vendor" : partner.type}</button> : null}{isCustomer && canOperate ? <button className="button secondary" onClick={() => setAddingAddress(true)}>Add ship-to address</button> : null}{canAdminister ? <button className="button secondary" onClick={() => setMerging(true)}>Merge duplicate</button> : null}</div>
    </section>
    <div className="detail-columns">
      <section className="panel"><PanelHeading title="Account" /><dl className="definition-list">
        <div><dt>Billing address</dt><dd>{[partner.addressLine1, partner.addressLine2, partner.city, partner.region, partner.postalCode, partner.country].filter(Boolean).join(", ") || "Not recorded"}</dd></div>
        <div><dt>Payment terms</dt><dd>{partner.paymentTerms || "Not set"}</dd></div>
        <div><dt>Currency</dt><dd>{partner.currency}</dd></div>
        {isCustomer ? <div><dt>Credit limit</dt><dd>{creditLimit ? formatDocumentMoney(creditLimit, partner.currency) : "None"}</dd></div> : null}
        {isCustomer ? <div><dt>Credit available</dt><dd>{creditLimit ? formatDocumentMoney(Math.max(creditLimit - outstanding, 0), partner.currency) : "Unlimited"}</dd></div> : null}
        {isCustomer ? <div><dt>Contract pricing</dt><dd>{detailLoading ? "Loading…" : priceLists.length ? priceLists.map((list) => list.label).join(", ") : "Catalog price only"}</dd></div> : null}
      </dl></section>
      <section className="panel"><PanelHeading title={partner.type === "both" ? "Open sales & purchase orders" : isCustomer ? "Open sales orders" : "Open purchase orders"} detail="Orders with quantity or billing still outstanding" />{detailLoading ? <div className="empty-inline">Loading account activity…</div> : orders.length ? <ul className="plain-list">{orders.map((order) => <li key={`${order.kind}:${order.id}`}><button type="button" className="table-link" onClick={() => onOpenOrder(order)}>{order.number}</button><span>{order.detail}</span></li>)}</ul> : <div className="empty-inline">No open orders for this account.</div>}</section>
    </div>
    {priceLists.length ? <section className="panel"><PanelHeading title="Assigned price lists" detail="Applied before the catalog price when an order line is priced" />
      <ul className="plain-list">{priceLists.map((list) => <li key={list.id}><strong>{list.label}</strong><span>{list.detail}</span></li>)}</ul></section> : null}
    {isCustomer ? <section className="panel"><PanelHeading title="Ship-to addresses" />{addressMessage ? <p className="read-only-label" role="status">{addressMessage}</p> : null}{addresses.length ? <div className="responsive-table"><table><thead><tr><SortableHeader label="Label" column="label" sort={addressTable.sort} setSort={addressTable.setSort} /><SortableHeader label="Contact" column="contact" sort={addressTable.sort} setSort={addressTable.setSort} /><SortableHeader label="Address" column="address" sort={addressTable.sort} setSort={addressTable.setSort} /><SortableHeader label="Instructions" column="instructions" sort={addressTable.sort} setSort={addressTable.setSort} /><SortableHeader label="Default" column="default" sort={addressTable.sort} setSort={addressTable.setSort} defaultDirection="desc" />{canOperate ? <th><span className="sr-only">Actions</span></th> : null}</tr></thead><tbody>{addressTable.rows.map((address) => <tr key={address.id}><td><strong>{address.label}</strong></td><td>{address.contactName || "—"}</td><td>{[address.addressLine1, address.addressLine2, address.city, address.region, address.postalCode, address.country].filter(Boolean).join(", ")}</td><td>{address.deliveryInstructions || "—"}</td><td>{address.isDefault ? <StatusBadge tone="success">Default</StatusBadge> : "—"}</td>{canOperate ? <td><div className="workflow-row-actions"><button className="row-action" onClick={() => setEditingAddress(address)}>Edit</button><button className="row-action" onClick={() => setDeactivatingAddress(address)}>Deactivate</button></div></td> : null}</tr>)}</tbody></table></div> : <div className="empty-inline">No saved ship-to addresses. Add one so orders do not need the address retyped.</div>}</section> : null}
    {isCustomer ? <section className="panel"><PanelHeading title="Invoices" detail={invoices.length ? `${invoices.length} invoice${invoices.length === 1 ? "" : "s"} · ${formatDocumentMoney(outstanding, partner.currency)} outstanding` : undefined} />
      {detailLoading ? <div className="empty-inline">Loading invoices…</div>
        : invoices.length ? <div className="responsive-table"><table><caption className="sr-only">Customer invoices, dates, and settlement</caption><thead><tr><SortableHeader label="Invoice" column="number" sort={invoiceTable.sort} setSort={invoiceTable.setSort} /><SortableHeader label="Invoiced" column="invoiced" sort={invoiceTable.sort} setSort={invoiceTable.setSort} /><SortableHeader label="Due" column="due" sort={invoiceTable.sort} setSort={invoiceTable.setSort} /><SortableHeader label="Status" column="status" sort={invoiceTable.sort} setSort={invoiceTable.setSort} /><SortableHeader label="Total" column="total" sort={invoiceTable.sort} setSort={invoiceTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Paid" column="paid" sort={invoiceTable.sort} setSort={invoiceTable.setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Outstanding" column="outstanding" sort={invoiceTable.sort} setSort={invoiceTable.setSort} className="numeric" defaultDirection="desc" /></tr></thead><tbody>{invoiceTable.rows.map((invoice) => {
          const overdue = invoice.outstanding > 0 && Boolean(invoice.dueDate) && invoice.dueDate < localDateString();
          return <tr key={invoice.id}><td><strong>{invoice.number}</strong></td><td>{formatDocumentDate(invoice.invoiceDate)}</td><td>{formatDocumentDate(invoice.dueDate)}</td><td>{overdue ? <StatusBadge tone="danger">Overdue</StatusBadge> : <StatusBadge>{invoice.status}</StatusBadge>}</td><td className="numeric">{formatDocumentMoney(invoice.total, invoice.currency)}</td><td className="numeric">{formatDocumentMoney(invoice.paid, invoice.currency)}</td><td className="numeric strong">{formatDocumentMoney(invoice.outstanding, invoice.currency)}</td></tr>;
        })}</tbody></table></div>
        : <div className="empty-inline">No invoice has been posted for this customer.</div>}</section> : null}
    {addingAddress ? <PartnerAddressDialog partnerId={partner.id} onClose={() => setAddingAddress(false)} onSaved={() => { setAddingAddress(false); setRefreshToken((current) => current + 1); }} /> : null}
    {editingAddress ? <PartnerAddressDialog partnerId={partner.id} address={editingAddress} onClose={() => setEditingAddress(null)} onSaved={() => { setEditingAddress(null); setRefreshToken((current) => current + 1); }} /> : null}
    {deactivatingAddress ? <PartnerAddressDeactivateDialog address={deactivatingAddress} onClose={() => setDeactivatingAddress(null)} onSaved={(message) => { setDeactivatingAddress(null); setAddressMessage(message); setRefreshToken((current) => current + 1); }} /> : null}
    {merging ? <MergePartnerDialog partner={partner} onClose={() => setMerging(false)} onSaved={(message) => { setMerging(false); onChanged(message); }} /> : null}
  </div>;
}

function MergePartnerDialog({ partner, onClose, onSaved }: { partner: Partner; onClose: () => void; onSaved: (message: string) => void }) {
  const [source, setSource] = useState<LookupOption | null>(null); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useDialogDismiss(onClose, busy);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!source || source.id === partner.id) return setError("Choose a different duplicate account."); setBusy(true); setError(""); try { onSaved(await postWorkflow("mergeBusinessPartners", partner.id, partner.version, { sourcePartnerId: source.id })); } catch (caught) { setError(caught instanceof Error ? caught.message : "The partner accounts could not be merged."); } finally { setBusy(false); } };
  return <div className="modal-overlay" role="presentation"><section className="command-dialog" role="dialog" aria-modal="true" aria-label="Merge duplicate partner"><div className="dialog-header"><div><span className="section-kicker">Surviving account · {partner.code}</span><h2>Merge duplicate vendor or customer</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div><form className="command-form" onSubmit={submit}>{error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}<label><span>Duplicate account to retire</span><ReferenceSearchSelect kind="partners" role={partner.type === "both" ? undefined : partner.type} value={source?.id ?? ""} initialOptions={[]} onSelect={setSource} placeholder="Search account name, code, or email" /></label><div className="next-step-banner"><div><strong>{source ? source.label : "Choose the duplicate account"}</strong><p>Orders, billing, credits, payments, addresses, and product cost history will move to {partner.code}. If one record is a vendor and the other a customer, the survivor becomes both.</p></div></div><label className="radio-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I understand the duplicate account will be deactivated and this merge cannot be undone.</span></label><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button danger" disabled={busy || !source || !confirmed}>{busy ? "Merging…" : `Merge into ${partner.code}`}</button></div></form></section></div>;
}

function PartnerAddressDialog({ partnerId, address, onClose, onSaved }: { partnerId: string; address?: PartnerAddress; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ label: address?.label ?? "", contactName: address?.contactName ?? "", addressLine1: address?.addressLine1 ?? "", addressLine2: address?.addressLine2 ?? "", city: address?.city ?? "", region: address?.region ?? "", postalCode: address?.postalCode ?? "", country: address?.country ?? "CA", deliveryInstructions: address?.deliveryInstructions ?? "", isDefault: address?.isDefault ?? false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useDialogDismiss(onClose, busy);
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    const idempotencyKey = crypto.randomUUID();
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ command: address ? "updatePartnerAddress" : "createPartnerAddress", entityId: address?.id, version: address?.version, idempotencyKey, payload: { partnerId, ...form } }) });
      const result = await response.json() as { error?: string | { message?: string } };
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "The address could not be saved.");
      onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The address could not be saved."); }
    finally { setBusy(false); }
  };
  return <div className="modal-overlay" role="presentation"><section className="command-dialog quick-create-dialog" role="dialog" aria-modal="true" aria-label={address ? "Edit ship-to address" : "Add ship-to address"}>
    <div className="dialog-header"><h2>{address ? "Edit ship-to address" : "Add ship-to address"}</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
    <form onSubmit={submit}>
      {error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}
      <div className="command-form form-grid">
        <label><span>Label{requiredMark}</span><input value={form.label} onChange={(event) => set({ label: event.target.value })} placeholder="Job site or branch name" required /></label>
        <label>Site contact<input value={form.contactName} onChange={(event) => set({ contactName: event.target.value })} /></label>
        <label><span>Street address{requiredMark}</span><AddressAutocomplete value={form.addressLine1} country={form.country} onChange={(addressLine1) => set({ addressLine1 })} onAddressSelected={(selected) => set(selected)} required /></label>
        <label>Address line 2<input value={form.addressLine2} onChange={(event) => set({ addressLine2: event.target.value })} /></label>
        <label><span>City{requiredMark}</span><input value={form.city} onChange={(event) => set({ city: event.target.value })} required /></label>
        <label><span>Province / region{requiredMark}</span><input value={form.region} onChange={(event) => set({ region: event.target.value })} required /></label>
        <label><span>Postal code{requiredMark}</span><input value={form.postalCode} onChange={(event) => set({ postalCode: event.target.value })} required /></label>
        <label><span>Country{requiredMark}</span><input value={form.country} onChange={(event) => set({ country: event.target.value.toUpperCase() })} required /></label>
        <label className="project-field">Delivery instructions<input value={form.deliveryInstructions} onChange={(event) => set({ deliveryInstructions: event.target.value })} placeholder="Crane access, gate code, appointment window" /></label>
        <label className="radio-row"><input type="checkbox" checked={form.isDefault} onChange={(event) => set({ isDefault: event.target.checked })} /><span>Use as this customer&apos;s default ship-to</span></label>
      </div>
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy ? "Saving…" : address ? "Save address changes" : "Save address"}</button></div>
    </form>
  </section></div>;
}

function PartnerAddressDeactivateDialog({ address, onClose, onSaved }: { address: PartnerAddress; onClose: () => void; onSaved: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useDialogDismiss(onClose, busy);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) return setError("Enter a reason for deactivating this address.");
    setBusy(true); setError("");
    const idempotencyKey = crypto.randomUUID();
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ command: "deactivatePartnerAddress", entityId: address.id, version: address.version, idempotencyKey, payload: { reason: reason.trim() } }) });
      const result = await response.json() as { message?: string; error?: string | { message?: string } };
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "The address could not be deactivated.");
      onSaved(result.message ?? "Address deactivated.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The address could not be deactivated."); }
    finally { setBusy(false); }
  };
  return <div className="modal-overlay" role="presentation"><section className="command-dialog quick-create-dialog" role="dialog" aria-modal="true" aria-label="Deactivate ship-to address">
    <div className="dialog-header"><h2>Deactivate {address.label}</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose} disabled={busy}>×</button></div>
    <form onSubmit={submit}>{error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}<div className="command-form"><p>This removes the address from future order selection. Existing orders keep their saved address snapshot.</p><label>Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} required /></label></div><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="button primary" disabled={busy || !reason.trim()}>{busy ? "Deactivating…" : "Deactivate address"}</button></div></form>
  </section></div>;
}

/** Create or revise a partner, including the contact and credit fields orders depend on. */
function PartnerEditor({ partner, onClose, onSaved }: { partner: Partner | "new"; onClose: () => void; onSaved: (message: string) => void }) {
  const editing = partner !== "new";
  const source = editing ? partner : null;
  const [form, setForm] = useState({
    code: source?.code === "—" ? "" : source?.code ?? "", name: source?.name ?? "", partnerType: source?.type ?? "customer",
    email: source?.email ?? "", phone: source?.phone ?? "", currency: source?.currency ?? "CAD", paymentTerms: source?.paymentTerms ?? "Net 30",
    addressLine1: source?.addressLine1 ?? "", addressLine2: source?.addressLine2 ?? "", city: source?.city ?? "",
    region: source?.region ?? "", postalCode: source?.postalCode ?? "", country: source?.country ?? "CA",
    creditLimit: (source?.creditLimitCents ?? 0) / 100, creditHold: source?.creditHold ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isCustomerAccount = form.partnerType !== "vendor";
  const accountLabel = form.partnerType === "both" ? "customer & vendor" : form.partnerType;
  const accountTitle = `${accountLabel[0].toUpperCase()}${accountLabel.slice(1)}`;
  useDialogDismiss(onClose, busy);
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    const idempotencyKey = crypto.randomUUID();
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({
        command: editing ? "updateBusinessPartner" : "createBusinessPartner",
        entityId: source?.id, version: source?.version, idempotencyKey,
        payload: { ...form, creditLimitCents: Math.round(form.creditLimit * 100) },
      }) });
      const result = await response.json() as { message?: string; error?: string | { message?: string } };
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "The partner could not be saved.");
      onSaved(result.message ?? `${form.name} saved.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The partner could not be saved."); }
    finally { setBusy(false); }
  };
  return <div className="modal-overlay" role="presentation"><section className="command-dialog quick-create-dialog" role="dialog" aria-modal="true" aria-label={editing ? `Edit ${accountLabel}` : `New ${accountLabel}`}>
    <div className="dialog-header"><h2>{editing ? `Edit ${source?.name}` : `New ${accountLabel}`}</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
    <form onSubmit={submit}>
      {error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}
      <div className="command-form form-grid">
        <label><span>{accountTitle} code{requiredMark}</span><input value={form.code} onChange={(event) => set({ code: event.target.value.toUpperCase() })} required /></label>
        <label><span>Name{requiredMark}</span><input value={form.name} onChange={(event) => set({ name: event.target.value })} required /></label>
        <label>Account type<select value={form.partnerType} onChange={(event) => set({ partnerType: event.target.value as Partner["type"] })}><option value="customer">Customer</option><option value="vendor">Vendor</option><option value="both">Both roles</option></select></label>
        <label>Currency<select value={form.currency} onChange={(event) => set({ currency: event.target.value })}><option>CAD</option><option>USD</option><option>EUR</option></select></label>
        <label>Payment terms<select value={form.paymentTerms} onChange={(event) => set({ paymentTerms: event.target.value })}>{PAYMENT_TERMS.map((term) => <option key={term}>{term}</option>)}</select></label>
        <label>Email<input type="email" value={form.email} onChange={(event) => set({ email: event.target.value })} /></label>
        <label>Phone<input value={form.phone} onChange={(event) => set({ phone: event.target.value })} /></label>
        <label>Street address<AddressAutocomplete value={form.addressLine1} country={form.country} onChange={(addressLine1) => set({ addressLine1 })} onAddressSelected={(selected) => set(selected)} /></label>
        <label>Address line 2<input value={form.addressLine2} onChange={(event) => set({ addressLine2: event.target.value })} /></label>
        <label>City<input value={form.city} onChange={(event) => set({ city: event.target.value })} /></label>
        <label>Province / region<input value={form.region} onChange={(event) => set({ region: event.target.value })} /></label>
        <label>Postal code<input value={form.postalCode} onChange={(event) => set({ postalCode: event.target.value })} /></label>
        <label>Country<input value={form.country} onChange={(event) => set({ country: event.target.value.toUpperCase() })} /></label>
        {isCustomerAccount ? <><label>Credit limit<NumberField min="0" step="0.01" value={form.creditLimit} onChange={(creditLimit) => set({ creditLimit })} /></label>
        <label className="radio-row"><input type="checkbox" checked={form.creditHold} onChange={(event) => set({ creditHold: event.target.checked })} /><span>Credit hold</span></label></> : null}
      </div>
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : `Create ${accountLabel}`}</button></div>
    </form>
  </section></div>;
}



function VendorBillsView({ bills, sort, setSort, onOpenPurchaseOrder }: { bills: Bill[]; onOpenPurchaseOrder: (bill: Bill) => void } & WorklistSortProps) {
  // Exact amounts here: a variance is an exception precisely because it is small, and rounding
  // one to the dollar prints "$0" beside a row that is demanding review.
  const today = localDateString();
  return <section className="panel worklist"><div className="responsive-table"><table><caption className="sr-only">Vendor bills, matching variance, and settlement</caption><thead><tr><SortableHeader label="Bill" column="number" sort={sort} setSort={setSort} /><SortableHeader label="Vendor invoice" column="vendorInvoice" sort={sort} setSort={setSort} /><SortableHeader label="Vendor" column="vendor" sort={sort} setSort={setSort} /><SortableHeader label="Purchase order" column="purchaseOrder" sort={sort} setSort={setSort} /><SortableHeader label="Invoiced" column="invoiced" sort={sort} setSort={setSort} /><SortableHeader label="Due" column="due" sort={sort} setSort={setSort} /><SortableHeader label="Authorized line value" column="authorized" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Billed line value" column="billed" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Line variance" column="variance" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Tax" column="tax" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Bill total" column="total" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Outstanding" column="outstanding" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Match" column="match" sort={sort} setSort={setSort} /><SortableHeader label="Settlement" column="settlement" sort={sort} setSort={setSort} /></tr></thead><tbody>{bills.map((bill) => {
    const overdue = bill.outstanding > 0 && Boolean(bill.dueDate) && bill.dueDate < today;
    return <tr key={bill.id}>
      <td><a className="table-link" href={`/api/documents/pdf?documentType=vendor_bill&documentId=${encodeURIComponent(bill.id)}`} download title={`Download ${bill.number} as a PDF`}>{bill.number}</a>{bill.holdReason ? <small>{bill.holdReason}</small> : null}</td>
      {/* AP reconciles against the supplier's own document number, not ours. */}
      <td>{bill.vendorInvoiceNumber ?? <span className="muted">Not recorded</span>}</td>
      <td>{bill.vendor}</td><td>{bill.purchaseOrderId ? <button className="table-link" type="button" onClick={() => onOpenPurchaseOrder(bill)}>{bill.po}</button> : bill.po}</td>
      <td>{formatDocumentDate(bill.invoiceDate, "—")}</td>
      <td>{overdue ? <StatusBadge tone="danger">{formatDocumentDate(bill.dueDate, "—")}</StatusBadge> : formatDocumentDate(bill.dueDate, "—")}</td>
      <td className="numeric">{formatDocumentMoney(bill.receivedValue, bill.currency)}</td>
      <td className="numeric">{formatDocumentMoney(bill.billedValue, bill.currency)}</td>
      <td className={`numeric strong ${bill.variance ? "text-danger" : ""}`}>{formatDocumentMoney(bill.variance, bill.currency)}</td>
      <td className="numeric">{formatDocumentMoney(bill.tax, bill.currency)}</td>
      {/* The amount actually payable: line values are net of tax and never equalled it. */}
      <td className="numeric strong">{formatDocumentMoney(bill.total, bill.currency)}</td>
      <td className="numeric">{formatDocumentMoney(bill.outstanding, bill.currency)}</td>
      <td><StatusBadge>{bill.status}</StatusBadge></td>
      <td><StatusBadge>{bill.settlementStatus}</StatusBadge></td>
    </tr>;
  })}{!bills.length ? <tr><td colSpan={14}><div className="empty-inline">No vendor bills match this view.</div></td></tr> : null}</tbody></table></div></section>;
}

function InvoicesView({ salesOrders, sort, setSort, onOpenSalesOrder }: { salesOrders: SalesOrder[]; onOpenSalesOrder: (so: SalesOrder) => void } & WorklistSortProps) {
  return <section className="panel worklist"><div className="responsive-table"><table><caption className="sr-only">Customer invoice eligibility</caption><thead><tr><SortableHeader label="Sales order" column="number" sort={sort} setSort={setSort} /><SortableHeader label="Customer" column="customer" sort={sort} setSort={setSort} /><SortableHeader label="Ordered" column="ordered" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Posted fulfillment" column="shipped" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Already invoiced" column="invoiced" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Available to invoice" column="availableToInvoice" sort={sort} setSort={setSort} className="numeric" defaultDirection="desc" /><SortableHeader label="State" column="billing" sort={sort} setSort={setSort} /></tr></thead><tbody>{salesOrders.map((so) => { const invoiced = so.invoiced ?? 0; const available = Math.max(so.fulfilled - invoiced, 0); return <tr key={so.id}><td><button className="table-link" type="button" onClick={() => onOpenSalesOrder(so)}>{so.number}</button></td><td>{so.customer}</td><td className="numeric">{so.ordered}</td><td className="numeric">{so.fulfilled}</td><td className="numeric">{invoiced}</td><td className="numeric strong">{available}</td><td><StatusBadge>{so.billing}</StatusBadge></td></tr>; })}{!salesOrders.length ? <tr><td colSpan={7}><div className="empty-inline">Nothing is waiting to be invoiced.</div></td></tr> : null}</tbody></table></div></section>;
}

type ReportKey = "ar-aging" | "open-orders" | "replenishment" | "customer-statement";

type ReportRow = Record<string, unknown>;
type ReportPayload = { rows?: ReportRow[]; totals?: Record<string, number>; asOf?: string; error?: { message?: string } };
// Report worklists stay scannable; deeper result sets remain available through pagination.
const LOCAL_TABLE_PAGE_SIZE = 20;

function LocalTablePager({ label, page, pages, setPage }: { label: string; page: number; pages: number; setPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return <nav className="snapshot-pagination" aria-label={label}><button className="button secondary" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}>Previous</button><span>Page {page} of {pages}</span><button className="button secondary" disabled={page >= pages} onClick={() => setPage(Math.min(pages, page + 1))}>Next</button></nav>;
}

const reportTabs: Array<{ key: ReportKey; label: string }> = [
  { key: "ar-aging", label: "AR aging" },
  { key: "open-orders", label: "Open orders by customer" },
  { key: "replenishment", label: "Buying worklist" },
  { key: "customer-statement", label: "Customer statement" },
];

/**
 * The four reports a distributor actually runs: who owes money, what is committed, what to
 * buy, and one customer's open balance. Each reads a whole-company aggregate, not a page.
 */
function ManagementReports({ warehouseId, canViewReceivables }: { warehouseId: string; canViewReceivables: boolean }) {
  const [report, setReport] = useState<ReportKey>(canViewReceivables ? "ar-aging" : "open-orders");
  const [asOf, setAsOf] = useState(localDateString());
  const [statementPartner, setStatementPartner] = useState<{ id: string; label: string }>({ id: "", label: "" });
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reportPage, setReportPage] = useState(1);
  const requestGeneration = useRef(0);

  // A statement needs a customer first; until one is picked there is nothing to fetch.
  const ready = report !== "customer-statement" || Boolean(statementPartner.id);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    if (!ready) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams({ type: report });
        if (report === "ar-aging" || report === "customer-statement") params.set("asOf", asOf);
        if (report === "customer-statement") params.set("partnerId", statementPartner.id);
        if (report === "replenishment" && warehouseId) params.set("warehouseId", warehouseId);
        const response = await fetch(`/api/reports?${params}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as ReportPayload;
        if (!response.ok) throw new Error(result.error?.message ?? "The report could not be produced.");
        if (generation !== requestGeneration.current) return;
        setPayload(result);
      } catch (caught) {
        if (generation === requestGeneration.current && !(caught instanceof DOMException && caught.name === "AbortError")) { setError(caught instanceof Error ? caught.message : "The report could not be produced."); setPayload(null); }
      } finally { if (generation === requestGeneration.current) setLoading(false); }
    })();
    return () => controller.abort();
  }, [asOf, ready, report, statementPartner.id, warehouseId]);

  const rows = ready ? payload?.rows ?? [] : [];
  const reportTable = useLocalTableSort(rows, {
    customer: (row) => row.customerName, current: (row) => Number(row.currentBaseCents ?? 0), days1To30: (row) => Number(row.days1To30BaseCents ?? 0), days31To60: (row) => Number(row.days31To60BaseCents ?? 0), days61To90: (row) => Number(row.days61To90BaseCents ?? 0), over90: (row) => Number(row.over90BaseCents ?? 0), totalBase: (row) => Number(row.totalBaseCents ?? 0), credit: (row) => Number(row.creditHold ?? 0) || Number(row.documentOutstandingCents ?? 0) - Number(row.creditLimitCents ?? 0),
    orders: (row) => Number(row.orderCount ?? 0), ordered: (row) => Number(row.orderedQuantity ?? 0), open: (row) => Number(row.openQuantity ?? 0), openValue: (row) => Number(row.openBaseValueCents ?? 0), earliest: (row) => row.earliestRequestedDate,
    product: (row) => `${String(row.name ?? "")} ${String(row.sku ?? "")}`, available: (row) => Number(row.availableQuantity ?? 0), incoming: (row) => Number(row.incomingQuantity ?? 0), demand: (row) => Number(row.openDemandQuantity ?? 0), projected: (row) => Number(row.projectedQuantity ?? 0), reorderPoint: (row) => Number(row.reorderPoint ?? 0), maxStockLevel: (row) => Number(row.maxStockLevel ?? 0), suggested: (row) => Number(row.suggestedOrderQuantity ?? 0), vendor: (row) => row.lastVendorName,
    invoice: (row) => row.number, salesOrder: (row) => row.salesOrderNumber, invoiced: (row) => row.invoiceDate, due: (row) => row.dueDate, documentTotal: (row) => Number(row.totalCents ?? 0), paid: (row) => Number(row.paidCents ?? 0), credited: (row) => Number(row.creditedCents ?? 0), outstanding: (row) => Number(row.outstandingCents ?? 0), age: (row) => Number(row.daysPastDue ?? 0),
  });
  const reportPages = Math.max(1, Math.ceil(reportTable.rows.length / LOCAL_TABLE_PAGE_SIZE));
  const currentReportPage = Math.min(reportPage, reportPages);
  const pageRows = reportTable.rows.slice((currentReportPage - 1) * LOCAL_TABLE_PAGE_SIZE, currentReportPage * LOCAL_TABLE_PAGE_SIZE);
  const setReportSort = (value: string) => { setReportPage(1); reportTable.setSort(value); };
  const totals = ready ? payload?.totals ?? {} : {};
  const visibleLoading = ready && loading;
  const visibleError = ready ? error : "";
  // Reports are reconciled against invoices and statements, so they carry cents.
  const baseCash = (value: unknown) => formatDocumentMoney(Number(value ?? 0) / 100, "CAD");
  const documentCash = (value: unknown, currency: unknown) => formatDocumentMoney(Number(value ?? 0) / 100, String(currency || "CAD"));
  const exportCsv = () => {
    if (!reportTable.rows.length) return;
    const headers = Object.keys(reportTable.rows[0]);
    const csv = [headers, ...reportTable.rows.map((row) => headers.map((key) => row[key]))]
      .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `paneflow-${report}-${localDateString()}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  return <section className="panel">
    <div className="workspace-tabbar" role="tablist" aria-label="Management reports">
      {reportTabs.filter((tab) => canViewReceivables || tab.key !== "ar-aging" && tab.key !== "customer-statement").map((tab) => <button key={tab.key} role="tab" aria-selected={report === tab.key} className={report === tab.key ? "active" : ""} onClick={() => { setReport(tab.key); setReportPage(1); reportTable.setSort(""); }}>{tab.label}</button>)}
      <button className="text-button" onClick={exportCsv} disabled={!rows.length}>Export CSV →</button>
    </div>
    {!canViewReceivables ? <p className="read-only-label">Receivables aging and customer statements require accounting, manager, or administrator access.</p> : null}

    {report === "ar-aging" || report === "customer-statement" ? <div className="filter-bar">{report === "customer-statement" ? <label className="project-field">Customer<ReferenceSearchSelect kind="partners" role="customer" value={statementPartner.id} initialOptions={[]} onSelect={(option) => setStatementPartner({ id: option.id, label: option.label })} placeholder="Search a customer" /></label> : null}<label>As of<input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} required /></label></div> : null}

    {visibleLoading ? <div className="empty-inline">Loading…</div> : null}
    {visibleError ? <div className="exception-banner"><span aria-hidden="true">!</span><div><strong>Report unavailable</strong><p>{visibleError}</p></div></div> : null}

    {!visibleLoading && !visibleError && report === "ar-aging" ? <>
      <div className="metric-row object-metrics"><MetricDisplay label="Total outstanding (CAD)" value={baseCash(totals.totalBaseCents)} /><MetricDisplay label="Current (CAD)" value={baseCash(totals.currentBaseCents)} tone="success" /><MetricDisplay label="1–30 days (CAD)" value={baseCash(totals.days1To30BaseCents)} tone="info" /><MetricDisplay label="31–60 days (CAD)" value={baseCash(totals.days31To60BaseCents)} tone="warning" /><MetricDisplay label="61–90 days (CAD)" value={baseCash(totals.days61To90BaseCents)} tone="warning" /><MetricDisplay label="Over 90 days (CAD)" value={baseCash(totals.over90BaseCents)} tone="danger" /></div>
      <div className="responsive-table"><table><caption className="sr-only">Accounts receivable aging by customer in company base currency</caption>
        <thead><tr><SortableHeader label="Customer" column="customer" sort={reportTable.sort} setSort={setReportSort} /><SortableHeader label="Current CAD" column="current" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="1–30 CAD" column="days1To30" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="31–60 CAD" column="days31To60" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="61–90 CAD" column="days61To90" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="90+ CAD" column="over90" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Total CAD" column="totalBase" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Credit" column="credit" sort={reportTable.sort} setSort={setReportSort} defaultDirection="desc" /></tr></thead>
        <tbody>{pageRows.map((row) => { const comparableCredit = String(row.documentCurrency) === String(row.partnerCurrency); return <tr key={String(row.customerId)}><td><strong>{String(row.customerName)}</strong><small>{String(row.customerCode)} · {Number(row.invoiceCount ?? 0)} invoice{Number(row.invoiceCount ?? 0) === 1 ? "" : "s"}</small></td><td className="numeric">{baseCash(row.currentBaseCents)}</td><td className="numeric">{baseCash(row.days1To30BaseCents)}</td><td className="numeric">{baseCash(row.days31To60BaseCents)}</td><td className={`numeric ${Number(row.days61To90BaseCents ?? 0) > 0 ? "text-danger" : ""}`}>{baseCash(row.days61To90BaseCents)}</td><td className={`numeric strong ${Number(row.over90BaseCents ?? 0) > 0 ? "text-danger" : ""}`}>{baseCash(row.over90BaseCents)}</td><td className="numeric strong">{baseCash(row.totalBaseCents)}</td><td>{Number(row.creditHold ?? 0) ? <StatusBadge tone="danger">Hold</StatusBadge> : !comparableCredit ? <StatusBadge tone="warning">Mixed currency</StatusBadge> : Number(row.creditLimitCents ?? 0) && Number(row.documentOutstandingCents ?? 0) > Number(row.creditLimitCents ?? 0) ? <StatusBadge tone="warning">Over limit</StatusBadge> : <StatusBadge tone="success">OK</StatusBadge>}</td></tr>; })}{!rows.length ? <tr><td colSpan={8}><div className="empty-inline">No outstanding customer balances.</div></td></tr> : null}</tbody></table></div>
    </> : null}

    {!visibleLoading && !visibleError && report === "open-orders" ? <>
      <div className="metric-row object-metrics"><MetricDisplay label="Open item value (CAD)" value={baseCash(totals.openBaseValueCents)} tone="info" /><MetricDisplay label="Open units" value={Number(totals.openQuantity ?? 0)} /></div>
      <div className="responsive-table"><table><caption className="sr-only">Open sales-order commitment by customer in company base currency</caption><thead><tr><SortableHeader label="Customer" column="customer" sort={reportTable.sort} setSort={setReportSort} /><SortableHeader label="Orders" column="orders" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Ordered units" column="ordered" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Open units" column="open" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Open item value CAD" column="openValue" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Earliest requested" column="earliest" sort={reportTable.sort} setSort={setReportSort} /></tr></thead><tbody>{pageRows.map((row) => <tr key={String(row.customerId)}><td><strong>{String(row.customerName)}</strong><small>{String(row.customerCode)}</small></td><td className="numeric">{Number(row.orderCount ?? 0)}</td><td className="numeric">{Number(row.orderedQuantity ?? 0)}</td><td className="numeric strong">{Number(row.openQuantity ?? 0)}</td><td className="numeric strong">{baseCash(row.openBaseValueCents)}</td><td>{formatDate(String(row.earliestRequestedDate ?? ""))}</td></tr>)}{!rows.length ? <tr><td colSpan={6}><div className="empty-inline">No open sales-order commitment.</div></td></tr> : null}</tbody></table></div>
    </> : null}

    {!visibleLoading && !visibleError && report === "replenishment" ? <>
      <div className="metric-row object-metrics"><MetricDisplay label="Products to buy" value={Number(totals.lineCount ?? 0)} tone={Number(totals.lineCount ?? 0) > 0 ? "warning" : "success"} /><MetricDisplay label="Suggested purchase value (CAD)" value={baseCash(totals.suggestedValueCents)} /></div>
      <div className="responsive-table"><table><caption className="sr-only">Products at or below their reorder point, with reorder-up-to targets</caption><thead><tr><SortableHeader label="Product" column="product" sort={reportTable.sort} setSort={setReportSort} /><SortableHeader label="Available" column="available" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Incoming" column="incoming" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Open demand" column="demand" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Projected" column="projected" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Reorder point" column="reorderPoint" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Reorder up to" column="maxStockLevel" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Suggested order" column="suggested" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Last vendor" column="vendor" sort={reportTable.sort} setSort={setReportSort} /></tr></thead><tbody>{pageRows.map((row) => <tr key={String(row.id)}><td><strong>{String(row.name)}</strong><small>{String(row.sku)}</small></td><td className="numeric">{formatQuantity(Number(row.availableQuantity ?? 0))}</td><td className="numeric">{formatQuantity(Number(row.incomingQuantity ?? 0))}</td><td className="numeric">{formatQuantity(Number(row.openDemandQuantity ?? 0))}</td><td className={`numeric strong ${Number(row.projectedQuantity ?? 0) < 0 ? "text-danger" : ""}`}>{formatQuantity(Number(row.projectedQuantity ?? 0))}</td><td className="numeric">{formatQuantity(Number(row.reorderPoint ?? 0))}</td><td className="numeric">{formatQuantity(Number(row.maxStockLevel ?? 0))}</td><td className="numeric strong">{formatQuantity(Number(row.suggestedOrderQuantity ?? 0))}</td><td>{String(row.lastVendorName ?? "No purchase history")}</td></tr>)}{!rows.length ? <tr><td colSpan={9}><div className="empty-inline">No stocked product has reached its reorder point.</div></td></tr> : null}</tbody></table></div>
    </> : null}

    {!visibleLoading && !visibleError && report === "customer-statement" ? (!statementPartner.id ? <div className="empty-inline">Select a customer to produce a statement.</div> : <>
      <div className="metric-row object-metrics"><MetricDisplay label={`${statementPartner.label} outstanding (CAD)`} value={baseCash(totals.outstandingBaseCents)} tone={Number(totals.outstandingBaseCents ?? 0) > 0 ? "warning" : "success"} /><MetricDisplay label="Invoices" value={Number(totals.invoiceCount ?? 0)} /></div>
      <div className="responsive-table"><table><caption className="sr-only">Customer statement with document-currency amounts</caption><thead><tr><SortableHeader label="Invoice" column="invoice" sort={reportTable.sort} setSort={setReportSort} /><SortableHeader label="Sales order" column="salesOrder" sort={reportTable.sort} setSort={setReportSort} /><SortableHeader label="Invoiced" column="invoiced" sort={reportTable.sort} setSort={setReportSort} /><SortableHeader label="Due" column="due" sort={reportTable.sort} setSort={setReportSort} /><SortableHeader label="Total" column="documentTotal" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Paid" column="paid" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Credited" column="credited" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Outstanding" column="outstanding" sort={reportTable.sort} setSort={setReportSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Age" column="age" sort={reportTable.sort} setSort={setReportSort} defaultDirection="desc" /></tr></thead><tbody>{pageRows.map((row) => <tr key={String(row.id)}><td><strong>{String(row.number)}</strong><small>{String(row.currency || "CAD")}</small></td><td>{String(row.salesOrderNumber ?? "—")}</td><td>{formatDate(String(row.invoiceDate ?? ""))}</td><td>{formatDate(String(row.dueDate ?? ""))}</td><td className="numeric">{documentCash(row.totalCents, row.currency)}</td><td className="numeric">{documentCash(row.paidCents, row.currency)}</td><td className="numeric">{documentCash(row.creditedCents, row.currency)}</td><td className="numeric strong">{documentCash(row.outstandingCents, row.currency)}</td><td>{Number(row.outstandingCents ?? 0) <= 0 ? <StatusBadge tone="success">Settled</StatusBadge> : Number(row.daysPastDue ?? 0) > 0 ? <StatusBadge tone="danger">{Number(row.daysPastDue)} days late</StatusBadge> : <StatusBadge tone="info">Current</StatusBadge>}</td></tr>)}{!rows.length ? <tr><td colSpan={9}><div className="empty-inline">No invoices for this customer.</div></td></tr> : null}</tbody></table></div>
    </>) : null}
    {!visibleLoading && !visibleError ? <LocalTablePager label="Report result pages" page={currentReportPage} pages={reportPages} setPage={setReportPage} /> : null}
  </section>;
}

function ReportsView({ snapshot, warehouseId }: { snapshot: Snapshot; warehouseId: string }) {
  const canViewFinancialReports = ["accounting", "manager", "administrator"].includes(snapshot.viewer.role);
  const [scope, setScope] = useState<"all" | "risk">("all");
  const [productPage, setProductPage] = useState(1);
  // The accounting handoff was locked to year-to-date, so the month-end close everybody
  // actually runs could not be exported without editing the URL.
  const today = localDateString();
  const [exportFrom, setExportFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [exportTo, setExportTo] = useState(today);
  const validRange = Boolean(exportFrom && exportTo) && exportFrom <= exportTo;
  const products = scope === "risk" ? snapshot.products.filter((product) => product.projected < 0 || product.available <= product.reorderPoint) : snapshot.products;
  const productTable = useLocalTableSort(products, { product: (row) => `${row.name} ${row.sku}`, usable: (row) => row.usable, incoming: (row) => row.incoming, demand: (row) => row.demand, projected: (row) => row.projected, risk: (row) => Number(row.projected < 0) });
  const productPages = Math.max(1, Math.ceil(productTable.rows.length / LOCAL_TABLE_PAGE_SIZE));
  const currentProductPage = Math.min(productPage, productPages);
  const visibleProducts = productTable.rows.slice((currentProductPage - 1) * LOCAL_TABLE_PAGE_SIZE, currentProductPage * LOCAL_TABLE_PAGE_SIZE);
  const setProductSort = (value: string) => { setProductPage(1); productTable.setSort(value); };
  const exportCsv = () => {
    const rows = [["SKU", "Product", "Usable", "Incoming", "Demand", "Projected"], ...productTable.rows.map((product) => [product.sku, product.name, product.usable, product.incoming, product.demand, product.projected])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `paneflow-availability-${localDateString()}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  // The four static cards that used to sit here restated dashboard numbers and did nothing when
  // clicked, so they occupied a screen of a reporting workspace without answering a question.
  return <div className="stack"><ManagementReports warehouseId={warehouseId} canViewReceivables={canViewFinancialReports} /><section className="panel"><PanelHeading title="Projected availability" /><div className="report-filters"><label>Scope<select value={scope} onChange={(event) => { setScope(event.target.value as "all" | "risk"); setProductPage(1); }}><option value="all">All products</option><option value="risk">Risks only</option></select></label><button className="button secondary" onClick={exportCsv}>Export current table</button></div>{canViewFinancialReports ? <div className="report-filters"><label>Accounting period from<input type="date" value={exportFrom} max={exportTo} onChange={(event) => setExportFrom(event.target.value)} /></label><label>to<input type="date" value={exportTo} min={exportFrom} onChange={(event) => setExportTo(event.target.value)} /></label><a className={`button secondary ${validRange ? "" : "disabled"}`} aria-disabled={!validRange} href={validRange ? `/api/export?type=accounting&from=${exportFrom}&to=${exportTo}` : undefined}>Accounting control export</a><a className={`button primary ${validRange ? "" : "disabled"}`} aria-disabled={!validRange} href={validRange ? `/api/export?type=quickbooks&from=${exportFrom}&to=${exportTo}` : undefined}>Export QuickBooks journal</a></div> : <p className="read-only-label">Accounting journal exports require accounting, manager, or administrator access.</p>}<div className="responsive-table"><table><caption className="sr-only">Projected product availability</caption><thead><tr><SortableHeader label="Product" column="product" sort={productTable.sort} setSort={setProductSort} /><SortableHeader label="Usable now" column="usable" sort={productTable.sort} setSort={setProductSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Incoming" column="incoming" sort={productTable.sort} setSort={setProductSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Open demand" column="demand" sort={productTable.sort} setSort={setProductSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Projected" column="projected" sort={productTable.sort} setSort={setProductSort} className="numeric" defaultDirection="desc" /><SortableHeader label="Risk" column="risk" sort={productTable.sort} setSort={setProductSort} defaultDirection="desc" /></tr></thead><tbody>{visibleProducts.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.sku}</small></td><td className="numeric">{product.usable}</td><td className="numeric">{product.incoming}</td><td className="numeric">{product.demand}</td><td className={`numeric strong ${product.projected < 0 ? "text-danger" : ""}`}>{product.projected}</td><td>{product.projected < 0 ? <StatusBadge tone="danger">Demand exceeds supply</StatusBadge> : <StatusBadge tone="success">Covered</StatusBadge>}</td></tr>)}{!products.length ? <tr><td colSpan={6}><div className="empty-inline">No products are available in this scope.</div></td></tr> : null}</tbody></table></div><LocalTablePager label="Projected availability pages" page={currentProductPage} pages={productPages} setPage={setProductPage} /></section></div>;
}

function WarehouseView({ snapshot, source, canOperate, onReceive, navigate }: { snapshot: Snapshot; source: "loading" | "server" | "unavailable"; canOperate: boolean; onReceive: (po: PurchaseOrder) => void; navigate: (view: ViewKey, status?: string, tab?: string) => void }) {
  const orders = snapshot.purchaseOrders.filter((po) => po.lifecycle.toLowerCase() === "approved" && po.open > 0);
  const [scan, setScan] = useState("");
  const next = orders[0];
  const scanned = scan.trim().toLowerCase();
  const scanMatch = scanned ? orders.find((po) => po.number.toLowerCase().includes(scanned) || po.lines.some((line) => line.sku.toLowerCase().includes(scanned))) : undefined;
  // Receive and pick counts come from the whole-database summary. Counting the current page
  // capped every queue at the page size, so a warehouse with 300 open receipts was told it had
  // 50 — and the tile disagreed with the worklist it opens.
  const tasks: Array<{ label: string; count: number; glyph: string; view: ViewKey; tab?: string }> = [
    { label: "Receive", count: snapshot.summary.dueReceipts, glyph: "↓", view: "expected-receipts" },
    { label: "Put away", count: snapshot.summary.receivingBalances, glyph: "↳", view: "stock", tab: "transfers" },
    { label: "Pick / ship", count: snapshot.summary.readyToShip, glyph: "→", view: "fulfillment" },
    { label: "Count locations", count: snapshot.summary.countableBalances, glyph: "#", view: "counts" },
  ];
  const selected = scanned ? scanMatch : next;
  const postingAvailable = source === "server" && canOperate;
  {/* The page shell's top bar already shows the connection state and the last refresh time
      directly above this, so the header repeated both within a few pixels of the originals. */}
  return <div className="warehouse-shell"><div className="warehouse-header"><div><h2>Warehouse work</h2></div><div className="warehouse-user"><span>{initials(snapshot.viewer.name)}</span><div><strong>{snapshot.viewer.name || "Signing in…"}</strong><small>{snapshot.viewer.role ? titleCase(snapshot.viewer.role) : ""}</small></div></div></div><section className="warehouse-launcher" aria-label="Warehouse work">{tasks.map((task) => <button type="button" key={task.label} onClick={() => navigate(task.view, undefined, task.tab)}><span className="task-glyph" aria-hidden="true">{task.glyph}</span><strong>{task.label}</strong><small>{task.count} work item{task.count === 1 ? "" : "s"}</small></button>)}</section>{next ? <section className="warehouse-next"><div className="step-header"><span>Next receipt</span><StatusBadge tone={next.daysLate > 0 ? "danger" : "info"}>{next.daysLate > 0 ? `${next.daysLate} days late` : next.expectedDate ? formatDate(next.expectedDate) : "No expected date"}</StatusBadge></div><h3>{selected ? `Receive ${selected.number}` : "No matching receipt"}</h3><p>{selected ? `${selected.vendor} · ${selected.customerRef ?? "Stock replenishment"}` : "Scan a different purchase order or SKU."}</p><form className="scan-zone" onSubmit={(event) => { event.preventDefault(); if (postingAvailable && selected) onReceive(selected); }}><span aria-hidden="true">▤</span><div><strong>Scan a purchase order or SKU</strong>{scanned && !scanMatch ? <small className="text-danger">No approved open purchase order matches “{scan.trim()}”.</small> : null}</div><input aria-label="Scan purchase order or SKU" placeholder="Scan or type code" autoComplete="off" value={scan} onChange={(event) => setScan(event.target.value)} /></form><button className="warehouse-primary" disabled={!postingAvailable || !selected} onClick={() => { if (selected) onReceive(selected); }}>{postingAvailable ? selected ? `Start receiving ${selected.number}` : "Scan a valid receipt" : "Posting unavailable"}</button></section> : <section className="warehouse-next"><div className="empty-inline">No approved purchase order currently has quantity open to receive.</div></section>}</div>;
}


function ReferenceSearchSelect({ kind, role, partnerId, productId, lineId, locationId, quantity = 1, warehouseId, currency, exchangeRateToBase, value, initialOptions, onSelect, placeholder, quickCreate, required = false }: { kind: LookupKind; role?: string; partnerId?: string; productId?: string; lineId?: string; locationId?: string; quantity?: number; warehouseId?: string; currency?: string; exchangeRateToBase?: number; value: string; initialOptions: LookupOption[]; onSelect: (option: LookupOption) => void; placeholder: string; quickCreate?: QuickCreateKind; required?: boolean }) {
  const mapItem = (item: Record<string, unknown>): LookupOption => kind === "partnerAddresses" ? {
    id: text(item.id),
    label: text(item.label),
    detail: [text(item.addressLine1), text(item.city), text(item.region)].filter(Boolean).join(", ") + (Number(item.isDefault) ? " · Default" : ""),
    addressLine1: text(item.addressLine1) || undefined,
    addressLine2: text(item.addressLine2) || undefined,
    city: text(item.city) || undefined,
    region: text(item.region) || undefined,
    postalCode: text(item.postalCode) || undefined,
    country: text(item.country, "CA"),
    contactName: text(item.contactName) || undefined,
    deliveryInstructions: text(item.deliveryInstructions) || undefined,
  } : kind === "salesOrderLines" ? {
    id: text(item.id),
    label: `${text(item.orderNumber)} · ${text(item.sku)}`,
    detail: [text(item.customerName), text(item.productName), titleCase(text(item.fulfillmentRoute)), `${number(item.availableToAllocateQuantity)} base units unallocated`].filter(Boolean).join(" · "),
    availableQuantity: number(item.availableToAllocateQuantity),
  } : kind === "purchaseOrderLines" ? {
    id: text(item.id),
    label: `${text(item.orderNumber)} · ${text(item.sku)}`,
    detail: [text(item.vendorName), text(item.productName)].filter(Boolean).join(" · "),
  } : kind === "purchaseOrders" ? {
    id: text(item.id),
    label: text(item.number, "Purchase order"),
    detail: [text(item.vendorName), titleCase(text(item.status)), formatDocumentMoney(number(item.totalCents) / 100, text(item.currency, "CAD"))].filter(Boolean).join(" · "),
  } : kind === "products" ? {
    id: text(item.id),
    label: `${text(item.sku)} · ${text(item.name)}`,
    // Price and availability lead the detail line: "can I supply it, and at what price"
    // is the question being answered while the line is entered.
    detail: [
      // The price on this row is the price about to land on the order line, so it carries cents.
      formatDocumentMoney(number(item.effectiveUnitAmountCents, number(role === "vendor" ? item.standardCostCents : item.sellingPriceCents)) / 100, text(item.effectiveCurrency, currency || "CAD"), true),
      role === "vendor" ? "" : `${number(item.availableQuantity)} available${number(item.incomingQuantity) ? ` · ${number(item.incomingQuantity)} incoming` : ""}`,
      text(item.priceSource),
      [text(item.dimensions), text(item.finish)].filter(Boolean).join(" · "),
    ].filter(Boolean).join(" · "),
    unitAmount: number(item.effectiveUnitAmountCents, number(role === "vendor" ? item.standardCostCents : item.sellingPriceCents)) / 100,
    uomId: text(item.selectedUomId) || undefined,
    uomCode: text(item.selectedUomCode) || undefined,
    priceSource: text(item.priceSource) || undefined,
    factorToBase: number(item.factorToBase, 1),
    availableQuantity: number(item.availableQuantity),
    trackingPolicy: text(item.trackingPolicy, "quantity"),
    inventoryPolicy: text(item.inventoryPolicy, "stocked"),
    dimensions: text(item.dimensions) || undefined,
    finish: text(item.finish) || undefined,
    material: text(item.material) || undefined,
    category: text(item.category) || undefined,
  } : kind === "locations" ? {
    id: text(item.id),
    label: `${text(item.warehouseCode)} · ${text(item.code)} · ${text(item.name)}`,
    detail: [text(item.warehouseName), titleCase(text(item.inventoryStatus)), productId ? `${number(item.availableQuantity)} available` : ""].filter(Boolean).join(" · "),
    availableQuantity: number(item.availableQuantity),
  } : kind === "inventoryLots" ? {
    id: text(item.id),
    label: text(item.lotNumber),
    detail: `${number(item.availableQuantity)} available · ${text(item.sku)} · ${text(item.productName)}`,
  } : kind === "inventoryUnits" ? {
    id: text(item.id),
    label: text(item.serialNumber),
    detail: [text(item.lotNumber) ? `Lot ${text(item.lotNumber)}` : "", text(item.locationCode), titleCase(text(item.lifecycleStatus))].filter(Boolean).join(" · "),
  } : {
    id: text(item.id),
    label: text(item.name),
    // Credit hold is enforced at confirmation. Surfacing it here stops a rep from keying a
    // whole order for an account that cannot be confirmed.
    detail: [text(item.code), Number(item.creditHold) ? "ON CREDIT HOLD" : "", text(item.email), titleCase(text(item.partnerType))].filter(Boolean).join(" · "),
    addressLine1: text(item.addressLine1) || undefined,
    addressLine2: text(item.addressLine2) || undefined,
    city: text(item.city) || undefined,
    region: text(item.region) || undefined,
    postalCode: text(item.postalCode) || undefined,
    country: text(item.country, "CA"),
    currency: text(item.currency) || undefined,
    paymentTerms: text(item.paymentTerms) || undefined,
    creditHold: Number(item.creditHold) !== 0,
    creditLimitCents: number(item.creditLimitCents),
  };
  return <RemoteSearchSelect
    kind={kind}
    role={role}
    partnerId={partnerId}
    productId={productId}
    lineId={lineId}
    locationId={locationId}
    quantity={quantity}
    warehouseId={warehouseId}
    currency={currency}
    exchangeRateToBase={exchangeRateToBase}
    value={value}
    placeholder={placeholder}
    initialOptions={initialOptions}
    quickCreate={quickCreate}
    required={required}
    mapItem={mapItem}
    onSelect={(option) => onSelect(option as LookupOption)}
  />;
}

/**
 * The fast path for stock handed over at the counter. It presents one sale to the operator while
 * the server still records the confirmed order, shipment, invoice, and (when chosen) payment that
 * the rest of the product needs for returns, traceability, receivables, and audit history.
 */
const WALK_IN_CUSTOMER_ID = "customer-walk-in";
const WALK_IN_CUSTOMER: LookupOption = {
  id: WALK_IN_CUSTOMER_ID,
  label: "Walk-in Customer",
  detail: "WALK-IN · Pay now",
  currency: "CAD",
  paymentTerms: "Due on receipt",
  country: "CA",
  creditHold: false,
  creditLimitCents: 0,
};

function CounterSaleScreen({ warehouseId, taxDefaultRateBps, canPost, onComplete }: {
  warehouseId: string;
  taxDefaultRateBps: number;
  canPost: boolean;
  onComplete: (message: string) => void;
}) {
  const newLine = (): CounterSaleLine => ({
    id: crypto.randomUUID(), productId: "", quantity: 1, unitAmount: 0, uomId: "", uomCode: "",
    priceSource: "Select a product", discountRate: 0, taxCode: taxDefaultRateBps > 0 ? "GST" : "EXEMPT",
    taxRate: taxDefaultRateBps / 100, route: "stock", projectReference: "", sourceSalesOrderLineId: "", supplyAllocations: [],
    linkedPurchaseOrderLineId: "", factorToBase: 1, trackingPolicy: "quantity", availableQuantity: 0,
    locationId: "", locationLabel: "", locationAvailable: 0, lotId: "", inventoryUnitId: "",
  });
  const [customerId, setCustomerId] = useState(WALK_IN_CUSTOMER_ID);
  const [customer, setCustomer] = useState<LookupOption | null>(WALK_IN_CUSTOMER);
  const [lines, setLines] = useState<CounterSaleLine[]>(() => [newLine()]);
  const [postingDate, setPostingDate] = useState(() => localDateString());
  const [currency, setCurrency] = useState("CAD");
  const [exchangeRate, setExchangeRate] = useState(1);
  const [settlement, setSettlement] = useState<"pay_now" | "on_account">("pay_now");
  const [paymentTerms, setPaymentTerms] = useState("Due on receipt");
  const [dueDate, setDueDate] = useState(() => localDateString());
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [projectReference, setProjectReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Set when the server reports the attempt key already belongs to a posted sale.
  const [alreadyPosted, setAlreadyPosted] = useState(false);
  const attemptKey = useRef("");

  const updateLine = (id: string, patch: Partial<CounterSaleLine>) => setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
  const lineAmounts = lines.map((line) => {
    const gross = Math.round(line.quantity * line.unitAmount * 100);
    const discount = Math.round(gross * Math.min(Math.max(line.discountRate, 0), 100) / 100);
    const subtotal = gross - discount;
    const tax = Math.round(subtotal * Math.max(line.taxRate, 0) / 100);
    return { gross, discount, subtotal, tax, total: subtotal + tax };
  });
  const itemGross = lineAmounts.reduce((sum, amount) => sum + amount.gross, 0);
  const discountTotal = lineAmounts.reduce((sum, amount) => sum + amount.discount, 0);
  const subtotal = lineAmounts.reduce((sum, amount) => sum + amount.subtotal, 0);
  const taxTotal = lineAmounts.reduce((sum, amount) => sum + amount.tax, 0);
  const total = subtotal + taxTotal;
  const lineReady = (line: CounterSaleLine) => Boolean(line.productId && line.locationId && line.quantity > 0 && line.unitAmount > 0
    && (line.trackingPolicy !== "lot" || line.lotId) && (line.trackingPolicy !== "serial" || line.inventoryUnitId));
  const overAvailable = lines.some((line) => line.locationId && line.quantity * line.factorToBase > line.locationAvailable);
  const ready = Boolean(customerId && lines.length && lines.every(lineReady) && !overAvailable && total > 0
    && (currency === "CAD" || exchangeRate > 0) && (settlement !== "pay_now" || paymentReference.trim()));

  const chooseCustomer = (option: LookupOption) => {
    setCustomerId(option.id);
    setCustomer(option);
    if (option.id === WALK_IN_CUSTOMER_ID) setSettlement("pay_now");
    const nextCurrency = option.currency || "CAD";
    const terms = option.paymentTerms || "Due on receipt";
    setCurrency(nextCurrency);
    setExchangeRate(nextCurrency === "CAD" ? 1 : 0);
    setPaymentTerms(terms);
    setDueDate(dueDateForTerms(postingDate, settlement === "pay_now" ? "Due on receipt" : terms));
    if (lines.some((line) => line.productId)) {
      setLines([newLine()]);
      setError("Product lines were cleared so customer-specific pricing can be applied.");
    } else setError("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError("");
    if (!attemptKey.current) attemptKey.current = crypto.randomUUID();
    const idempotencyKey = attemptKey.current;
    try {
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          command: "postCounterSale",
          entityId: `counter-sale-${idempotencyKey}`,
          idempotencyKey,
          version: 1,
          payload: {
            customerId, postingDate, settlement, currency, exchangeRateToBase: exchangeRate,
            paymentTerms: settlement === "pay_now" ? "Due on receipt" : paymentTerms,
            dueDate: settlement === "pay_now" ? postingDate : dueDate,
            paymentMethod, paymentReference, projectReference,
            shipToName: customer?.label,
            shipToAddressLine1: customer?.addressLine1,
            shipToAddressLine2: customer?.addressLine2,
            shipToCity: customer?.city,
            shipToRegion: customer?.region,
            shipToPostalCode: customer?.postalCode,
            shipToCountry: customer?.country,
            lines: lines.map((line, index) => ({
              kind: "item", productId: line.productId, quantity: line.quantity, uomId: line.uomId || undefined,
              unitPriceCents: Math.round(line.unitAmount * 100), discountCents: lineAmounts[index].discount,
              taxable: line.taxRate > 0, taxCode: line.taxRate > 0 ? line.taxCode || "GST" : "EXEMPT",
              taxRateBps: Math.round(line.taxRate * 100), fulfillmentRoute: "stock", locationId: line.locationId,
              lotId: line.lotId || undefined, inventoryUnitId: line.inventoryUnitId || undefined,
            })),
          },
        }),
      });
      const result = await response.json() as { message?: string; error?: string | { code?: string; message?: string } };
      if (!response.ok) {
        // The key is kept through a conflict: it means an earlier attempt with this key was
        // already recorded (a network drop after the server posted), and a fresh key on the
        // third try would post the same sale twice. Any other failure gets a new key.
        if (typeof result.error === "object" && result.error?.code === "IDEMPOTENCY_CONFLICT") {
          setAlreadyPosted(true);
          throw new Error("An earlier attempt at this sale was already recorded by the server. Check Customer invoices before posting it again.");
        }
        attemptKey.current = "";
        throw new Error(typeof result.error === "string" ? result.error : result.error?.message || "The counter sale could not be completed.");
      }
      attemptKey.current = "";
      onComplete(result.message || "Counter sale completed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The counter sale could not be completed.");
    } finally {
      setSaving(false);
    }
  };

  if (!canPost) return <section className="panel empty-state"><span className="empty-glyph" aria-hidden="true">$</span><h2>Counter-sale posting is restricted</h2><p>This action moves inventory and posts a receivable in one step. A manager or administrator with both inventory and financial posting access must complete it.</p></section>;

  return <form className="counter-sale-workspace" onSubmit={submit}>
    {error ? <div className="error-summary" role="alert"><strong>Counter sale not completed</strong><p>{error}</p>{alreadyPosted ? <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => { attemptKey.current = ""; setAlreadyPosted(false); setError(""); setLines([newLine()]); }}>Start a new sale</button></div> : null}</div> : null}
    <section className="panel counter-sale-customer" aria-labelledby="counter-customer-heading">
      <div className="panel-heading"><div><span className="section-kicker">1 · Customer</span><h2 id="counter-customer-heading">Who is buying?</h2></div><StatusBadge tone="success">{customerId === WALK_IN_CUSTOMER_ID ? "Walk-in selected" : "Selected"}</StatusBadge></div>
      <div className="command-form form-grid composer-header-fields">
        <label className="project-field">Customer<ReferenceSearchSelect kind="partners" role="customer" value={customerId} initialOptions={[WALK_IN_CUSTOMER]} quickCreate="customer" onSelect={chooseCustomer} placeholder="Search customer name, code, or email" /><small>{customerId === WALK_IN_CUSTOMER_ID ? "Selected automatically for a pay-now sale. Search here to use a customer account instead." : "Customer pricing and account terms apply."}</small></label>
        <label>Sale date<input type="date" value={postingDate} onChange={(event) => { const next = event.target.value; setPostingDate(next); setDueDate(dueDateForTerms(next, settlement === "pay_now" ? "Due on receipt" : paymentTerms)); }} required /></label>
        <label>Customer / job reference<input value={projectReference} onChange={(event) => setProjectReference(event.target.value)} placeholder="Optional" /></label>
        <label>Currency<select value={currency} onChange={(event) => { const next = event.target.value; setCurrency(next); setExchangeRate(next === "CAD" ? 1 : 0); }}><option>CAD</option><option>USD</option><option>EUR</option></select></label>
        {currency !== "CAD" ? <label>Exchange rate to CAD<input type="number" min="0.0001" step="0.0001" value={exchangeRate || ""} onChange={(event) => setExchangeRate(Number(event.target.value))} required /></label> : null}
      </div>
      {customer?.creditHold ? <div className="exception-banner"><span aria-hidden="true">!</span><div><strong>Customer is on credit hold.</strong><p>{settlement === "pay_now" ? "Payment now is still available; charging the account is blocked." : "Switch to payment now or clear the credit hold."}</p></div></div> : null}
    </section>

    <section className="panel commercial-composer" aria-labelledby="counter-lines-heading">
      <div className="composer-section-heading"><div><span className="section-kicker">2 · Items</span><strong id="counter-lines-heading">Stock leaving with the customer</strong><small>Only usable, unreserved stock can be sold here. Special-order and drop-ship products still use a sales order.</small></div><button type="button" className="button secondary" disabled={!customerId} onClick={() => setLines((current) => [...current, newLine()])}>Add product line</button></div>
      {!customerId ? <div className="empty-inline">Select the customer first so the product picker can apply the correct price list and currency.</div> : null}
      {customerId ? <div className="counter-sale-lines">{lines.map((line, index) => {
        const baseQuantity = line.quantity * line.factorToBase;
        const short = Boolean(line.locationId && baseQuantity > line.locationAvailable);
        return <fieldset key={line.id} className="counter-sale-line">
          <legend>Line {index + 1}</legend>
          <label className="product-field">Product<ReferenceSearchSelect kind="products" role="customer" partnerId={customerId} quantity={line.quantity} warehouseId={warehouseId} currency={currency} exchangeRateToBase={exchangeRate || undefined} value={line.productId} initialOptions={[]} quickCreate="product" onSelect={(option) => {
            if (option.inventoryPolicy && option.inventoryPolicy !== "stocked") {
              setError("That product is not stocked. Use a sales order for special-order or drop-ship demand.");
              return;
            }
            const serial = option.trackingPolicy === "serial";
            updateLine(line.id, { productId: option.id, quantity: serial ? 1 : line.quantity, unitAmount: option.unitAmount ?? 0,
              uomId: option.uomId ?? "", uomCode: option.uomCode ?? "", priceSource: option.priceSource ?? "Catalog price",
              factorToBase: option.factorToBase ?? 1, trackingPolicy: option.trackingPolicy ?? "quantity", availableQuantity: option.availableQuantity ?? 0,
              locationId: "", locationLabel: "", locationAvailable: 0, lotId: "", inventoryUnitId: "" });
            setError("");
          }} placeholder="Search SKU, name, manufacturer code, or dimensions" /><small>{line.productId ? `${line.availableQuantity} available in scope · ${line.priceSource}` : "Price and availability appear with each result."}</small></label>
          {/* The chosen location, lot, and serial survive a quantity change; the free-stock check beside the location flags a shortfall instead. */}
          <label>Quantity<input type="number" min="0.001" step="0.001" value={line.quantity} disabled={line.trackingPolicy === "serial"} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} required /></label>
          <label>UOM<input value={line.uomCode || "Base"} readOnly /></label>
          <label>Unit price<input type="number" min="0.01" step="0.01" value={line.unitAmount || ""} onChange={(event) => updateLine(line.id, { unitAmount: Number(event.target.value) })} required /></label>
          <label>Discount %<input type="number" min="0" max="100" step="0.01" value={line.discountRate} onChange={(event) => updateLine(line.id, { discountRate: Number(event.target.value) })} /></label>
          <label>Tax %<input type="number" min="0" max="100" step="0.01" value={line.taxRate} onChange={(event) => updateLine(line.id, { taxRate: Number(event.target.value), taxCode: Number(event.target.value) > 0 ? "GST" : "EXEMPT" })} /></label>
          <label className="location-field">Source location<ReferenceSearchSelect kind="locations" role="usable" productId={line.productId} quantity={baseQuantity} warehouseId={warehouseId} value={line.locationId} initialOptions={[]} onSelect={(option) => updateLine(line.id, { locationId: option.id, locationLabel: option.label, locationAvailable: option.availableQuantity ?? 0, lotId: "", inventoryUnitId: "" })} placeholder={line.productId ? "Search locations with free stock" : "Select a product first"} /><small className={short ? "text-danger" : undefined}>{line.locationId ? `${line.locationAvailable} base units free${short ? " — not enough" : ""}` : "Required for immediate handover."}</small></label>
          {line.trackingPolicy === "lot" ? <label className="identity-field">Lot<ReferenceSearchSelect kind="inventoryLots" productId={line.productId} locationId={line.locationId} value={line.lotId} initialOptions={[]} onSelect={(option) => updateLine(line.id, { lotId: option.id })} placeholder={line.locationId ? "Search lots at this location" : "Select a location first"} /></label> : null}
          {line.trackingPolicy === "serial" ? <label className="identity-field">Serial number<ReferenceSearchSelect kind="inventoryUnits" productId={line.productId} locationId={line.locationId} value={line.inventoryUnitId} initialOptions={[]} onSelect={(option) => updateLine(line.id, { inventoryUnitId: option.id })} placeholder={line.locationId ? "Search serials at this location" : "Select a location first"} /></label> : null}
          <div className="counter-line-total"><span>Line total</span><strong>{formatDocumentMoney(lineAmounts[index].total / 100, currency, true)}</strong></div>
          {lines.length > 1 ? <button type="button" className="remove-composer-line" onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}>Remove line {index + 1}</button> : null}
        </fieldset>;
      })}</div> : null}
    </section>

    <div className="counter-sale-finish">
      <section className="panel counter-sale-settlement" aria-labelledby="counter-payment-heading">
        <div className="panel-heading"><div><span className="section-kicker">3 · Settlement</span><h2 id="counter-payment-heading">How is this sale being paid?</h2></div></div>
        <div className="segmented-control" role="group" aria-label="Settlement method"><button type="button" className={settlement === "pay_now" ? "active" : ""} onClick={() => { setSettlement("pay_now"); setDueDate(postingDate); }}>Pay now</button><button type="button" className={settlement === "on_account" ? "active" : ""} disabled={customerId === WALK_IN_CUSTOMER_ID} title={customerId === WALK_IN_CUSTOMER_ID ? "Select a customer account before charging the sale." : undefined} onClick={() => { setSettlement("on_account"); setDueDate(dueDateForTerms(postingDate, paymentTerms)); }}>Charge account</button></div>
        {customerId === WALK_IN_CUSTOMER_ID ? <p className="formula-note">Walk-in sales are collected now. Select an account customer above to offer payment terms.</p> : null}
        {settlement === "pay_now" ? <div className="command-form form-grid counter-payment-fields"><label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Cash</option><option value="credit_card">Credit card</option><option value="debit_card">Debit card</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option></select></label><label>Receipt / payment reference<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Till receipt, terminal, or cheque no." required /></label></div> : <div className="command-form form-grid counter-payment-fields"><label>Payment terms<select value={paymentTerms} onChange={(event) => { const next = event.target.value; setPaymentTerms(next); setDueDate(dueDateForTerms(postingDate, next)); }}>{PAYMENT_TERMS.map((term) => <option key={term}>{term}</option>)}</select></label><label>Due date<input type="date" min={postingDate} value={dueDate} onChange={(event) => setDueDate(event.target.value)} required /></label></div>}
        <ImpactPreview lines={[
          { category: "Physical", label: "Usable on-hand", after: `−${lines.reduce((sum, line) => sum + line.quantity * line.factorToBase, 0)} base units`, tone: "warning" },
          { category: "Commercial", label: "Internal records", after: "Confirmed order + posted pickup shipment" },
          { category: "Financial", label: settlement === "pay_now" ? "Invoice and payment" : "Accounts receivable", after: settlement === "pay_now" ? "Posted and fully paid" : `Due ${formatDate(dueDate)}`, tone: settlement === "pay_now" ? "success" : "info" },
        ]} />
      </section>
      <aside className="panel counter-sale-summary" aria-label="Counter sale total">
        <span className="section-kicker">Sale summary</span>
        <dl className="composer-totals"><div><dt>Items</dt><dd>{formatDocumentMoney(itemGross / 100, currency, true)}</dd></div><div><dt>Discounts</dt><dd>−{formatDocumentMoney(discountTotal / 100, currency, true)}</dd></div><div><dt>Subtotal</dt><dd>{formatDocumentMoney(subtotal / 100, currency, true)}</dd></div><div><dt>Tax</dt><dd>{formatDocumentMoney(taxTotal / 100, currency, true)}</dd></div><div className="total"><dt>{settlement === "pay_now" ? "Amount to collect" : "Invoice total"}</dt><dd>{formatDocumentMoney(total / 100, currency, true)}</dd></div></dl>
        {overAvailable ? <p className="text-danger">A line exceeds the free stock at its selected location.</p> : null}
        <button className="button primary counter-sale-submit" disabled={!ready || saving}>{saving ? "Completing sale…" : settlement === "pay_now" ? `Collect ${formatDocumentMoney(total / 100, currency, true)} & complete` : "Post to customer account"}</button>
        <small>One click posts the hidden sales order, pickup shipment, invoice, and {settlement === "pay_now" ? "payment" : "receivable"} together.</small>
      </aside>
    </div>
  </form>;
}

type ComposerDraftLine = {
  id: string; productId: string; label: string; quantity: number; unitAmount: number;
  uomId: string; uomCode: string; route: string; projectReference: string;
  discountCents: number; taxable: boolean; taxRateBps: number;
  sourceSalesOrderLineId: string; supplyAllocations: Array<{ id: string; salesOrderLineId: string; quantity: number; label: string }>; linkedPurchaseOrderLineId: string;
};
type ComposerDraft = {
  number: string; partnerId: string; partnerLabel: string; date: string;
  currency: string; exchangeRateToBase: number; paymentTerms?: string; dueDate?: string;
  projectReference: string; shipToName?: string; shipToAddressLine1?: string; shipToAddressLine2?: string;
  shipToCity?: string; shipToRegion?: string; shipToPostalCode?: string; shipToCountry?: string;
  deliveryInstructions?: string; freightCents: number; freightTaxRateBps: number; feeCents: number; feeTaxRateBps: number; depositCents: number; lines: ComposerDraftLine[];
};

/**
 * Flattens either order type into the single shape the composer edits, preserving line and
 * charge tax rates so reopening a draft never silently reprices it.
 */
function composerDraft(order: SalesOrder | PurchaseOrder | undefined, isPurchase: boolean): ComposerDraft | undefined {
  if (!order) return undefined;
  if (isPurchase) {
    const po = order as PurchaseOrder;
    return {
      number: po.number, partnerId: po.vendorId, partnerLabel: po.vendor, date: po.expectedDate,
      currency: po.currency, exchangeRateToBase: po.exchangeRateToBase, paymentTerms: po.paymentTerms, dueDate: po.dueDate,
      projectReference: po.projectReference ?? "", freightCents: po.freightCents, freightTaxRateBps: po.freightTaxRateBps, feeCents: po.feeCents, feeTaxRateBps: po.feeTaxRateBps, depositCents: po.depositCents,
      lines: po.lines.map((line) => ({
        id: line.id, productId: line.productId ?? "", label: `${line.sku} · ${line.product}`,
        quantity: line.ordered, unitAmount: line.unitCost, uomId: line.orderedUomId ?? "", uomCode: line.orderedUomCode ?? "",
        route: line.fulfillmentRoute ?? "stock", projectReference: "",
        discountCents: line.discountCents, taxable: line.taxable, taxRateBps: line.taxRateBps,
        sourceSalesOrderLineId: line.sourceSalesOrderLineId ?? "",
        supplyAllocations: line.supplyAllocations.map((allocation) => ({ id: allocation.id, salesOrderLineId: allocation.salesOrderLineId, quantity: allocation.quantity / (line.uomFactorToBase || 1), label: `${allocation.salesOrderNumber} · ${allocation.customerName}` })),
        linkedPurchaseOrderLineId: "",
      })),
    };
  }
  const so = order as SalesOrder;
  return {
    number: so.number, partnerId: so.customerId, partnerLabel: so.customer, date: so.requestedDate,
    currency: so.currency, exchangeRateToBase: so.exchangeRateToBase, paymentTerms: so.paymentTerms, dueDate: so.dueDate,
    projectReference: so.project, freightCents: so.freightCents, freightTaxRateBps: so.freightTaxRateBps, feeCents: so.feeCents, feeTaxRateBps: so.feeTaxRateBps, depositCents: so.depositCents, shipToName: so.shipToName, shipToAddressLine1: so.shipToAddressLine1,
    shipToAddressLine2: so.shipToAddressLine2, shipToCity: so.shipToCity, shipToRegion: so.shipToRegion,
    shipToPostalCode: so.shipToPostalCode, shipToCountry: so.shipToCountry, deliveryInstructions: so.deliveryInstructions,
    lines: (so.lines ?? []).map((line) => ({
      id: line.id, productId: line.productId, label: `${line.sku} · ${line.product}`,
      quantity: line.ordered, unitAmount: line.unitPrice, uomId: line.orderedUomId ?? "", uomCode: line.orderedUomCode ?? "",
      route: line.fulfillmentRoute, projectReference: line.projectReference ?? "",
      discountCents: line.discountCents, taxable: line.taxable, taxRateBps: line.taxRateBps,
      sourceSalesOrderLineId: "", supplyAllocations: [], linkedPurchaseOrderLineId: line.linkedPurchaseOrderLineId ?? "",
    })),
  };
}

function AdvancedCreateOrderDialog({ type, initialOrder, partners, products, warehouseId, defaultTaxRateBps, canFastTrack = false, onClose, onSubmit }: { type: "purchaseOrder" | "salesOrder"; initialOrder?: SalesOrder | PurchaseOrder; partners: Partner[]; products: Product[]; warehouseId: string; defaultTaxRateBps: number; canFastTrack?: boolean; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
  const isPurchase = type === "purchaseOrder";
  const editing = Boolean(initialOrder);
  // One composer serves both documents, so the order being edited is flattened to a single
  // shape first. A purchase order carries a vendor and an expected date where a sales order
  // carries a customer, a requested date, and a ship-to block.
  const draft = composerDraft(initialOrder, isPurchase);
  const partnerRole = isPurchase ? "vendor" : "customer";
  const eligiblePartners = partners.filter((partner) => partner.type === partnerRole || partner.type === "both");
  const initialPartnerOptions: LookupOption[] = eligiblePartners.map((partner) => ({ id: partner.id, label: partner.name, detail: [partner.email, titleCase(partner.type)].filter(Boolean).join(" · "), addressLine1: partner.addressLine1, addressLine2: partner.addressLine2, city: partner.city, region: partner.region, postalCode: partner.postalCode, country: partner.country, currency: partner.currency, paymentTerms: partner.paymentTerms }));
  if (draft?.partnerId && !initialPartnerOptions.some((option) => option.id === draft.partnerId)) initialPartnerOptions.unshift({ id: draft.partnerId, label: draft.partnerLabel, detail: isPurchase ? "Current vendor" : "Current customer", addressLine1: draft.shipToAddressLine1, addressLine2: draft.shipToAddressLine2, city: draft.shipToCity, region: draft.shipToRegion, postalCode: draft.shipToPostalCode, country: draft.shipToCountry, currency: draft.currency, paymentTerms: draft.paymentTerms });
  const initialProductOptions: LookupOption[] = products.map((product) => ({
    id: product.id,
    label: `${product.sku} · ${product.name}`,
    detail: product.specification,
    unitAmount: isPurchase ? product.lastUnitCost ?? product.standardCost : product.sellingPrice,
    uomId: isPurchase ? product.purchaseUomId : product.salesUomId,
    uomCode: isPurchase ? product.purchaseUomCode : product.salesUomCode,
    priceSource: isPurchase ? product.lastUnitCost != null ? `Last approved PO cost${product.lastUnitCostSourcePoNumber ? ` · ${product.lastUnitCostSourcePoNumber}` : ""}` : "Catalog standard cost fallback" : "Catalog selling price",
  }));
  draft?.lines.forEach((line) => { if (!initialProductOptions.some((option) => option.id === line.productId)) initialProductOptions.push({ id: line.productId, label: line.label, detail: line.projectReference || "Current draft line" }); });
  // Lines start empty: pre-filling an arbitrary catalog product is how the wrong SKU
  // gets ordered when someone tabs past it.
  const initialLine = (): ComposerLine => ({ id: crypto.randomUUID(), productId: "", quantity: 1, unitAmount: 0, uomId: "", uomCode: "", priceSource: "Select a product", discountRate: 0, taxCode: defaultTaxRateBps > 0 ? "GST" : "Zero", taxRate: defaultTaxRateBps / 100, route: "stock", projectReference: "", sourceSalesOrderLineId: "", supplyAllocations: [], linkedPurchaseOrderLineId: "" });
  const existingLines: ComposerLine[] = (draft?.lines ?? []).map((line) => ({
    id: line.id, productId: line.productId, quantity: line.quantity, unitAmount: line.unitAmount,
    uomId: line.uomId || products.find((product) => product.id === line.productId)?.[isPurchase ? "purchaseUomId" : "salesUomId"] || "",
    uomCode: line.uomCode || products.find((product) => product.id === line.productId)?.[isPurchase ? "purchaseUomCode" : "salesUomCode"] || "",
    priceSource: "Saved order price",
    discountRate: line.quantity * line.unitAmount > 0 ? line.discountCents / (line.quantity * line.unitAmount) : 0,
    taxCode: line.taxable ? "GST" : "Exempt", taxRate: line.taxRateBps / 100,
    route: line.route.replaceAll("_", "-"), projectReference: line.projectReference || draft?.projectReference || "",
    sourceSalesOrderLineId: line.sourceSalesOrderLineId, supplyAllocations: line.supplyAllocations, linkedPurchaseOrderLineId: line.linkedPurchaseOrderLineId,
  }));
  // No partner is pre-selected: the first alphabetical account is never a safe guess.
  const [partnerId, setPartnerId] = useState(draft?.partnerId ?? "");
  // The hold is enforced when the order is confirmed. Carrying it here means a rep learns about
  // it before keying the lines rather than after.
  const [partnerCreditHold, setPartnerCreditHold] = useState(false);
  // `||` rather than `??`: an order saved without an expected date reopens with the default.
  const [date, setDate] = useState(draft?.date || futureDate(isPurchase ? 14 : 21));
  const [currency, setCurrency] = useState(draft?.currency ?? "CAD");
  const [exchangeRate, setExchangeRate] = useState(draft?.exchangeRateToBase ?? 1);
  const [terms, setTerms] = useState(draft?.paymentTerms ?? (isPurchase ? "Net 30" : "Net 15"));
  const [dueDate, setDueDate] = useState(draft?.dueDate ?? futureDate(isPurchase ? 44 : 36));
  const [shipToName, setShipToName] = useState(draft?.shipToName ?? draft?.partnerLabel ?? "");
  const [shipToAddressLine1, setShipToAddressLine1] = useState(draft?.shipToAddressLine1 ?? "");
  const [shipToAddressLine2, setShipToAddressLine2] = useState(draft?.shipToAddressLine2 ?? "");
  const [shipToCity, setShipToCity] = useState(draft?.shipToCity ?? "");
  const [shipToRegion, setShipToRegion] = useState(draft?.shipToRegion ?? "");
  const [shipToPostalCode, setShipToPostalCode] = useState(draft?.shipToPostalCode ?? "");
  const [shipToCountry, setShipToCountry] = useState(draft?.shipToCountry ?? "CA");
  const [deliveryInstructions, setDeliveryInstructions] = useState(draft?.deliveryInstructions ?? "");
  const [fastTrack, setFastTrack] = useState(false);
  const [approvalReason, setApprovalReason] = useState("");
  const [shipToAddressId, setShipToAddressId] = useState("");
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressNotice, setAddressNotice] = useState("");
  const [freight, setFreight] = useState((draft?.freightCents ?? 0) / 100);
  const [freightTaxRate, setFreightTaxRate] = useState(draft ? draft.freightTaxRateBps / 100 : defaultTaxRateBps / 100);
  const [fees, setFees] = useState((draft?.feeCents ?? 0) / 100);
  const [feeTaxRate, setFeeTaxRate] = useState(draft ? draft.feeTaxRateBps / 100 : defaultTaxRateBps / 100);
  const [deposit, setDeposit] = useState((draft?.depositCents ?? 0) / 100);
  const [lines, setLines] = useState<ComposerLine[]>(existingLines.length ? existingLines : [initialLine()]);
  const [productOptions, setProductOptions] = useState<Record<string, LookupOption>>(() => Object.fromEntries(initialProductOptions.map((option) => [option.id, option])));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  // Validation messages appear once a save has been attempted, then clear field by field.
  const [attempted, setAttempted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const errorId = useId();
  useEffect(() => { closeRef.current?.focus(); }, []);
  /**
   * Closing this dialog throws the draft away — nothing is persisted until the order is saved.
   * A composer holding keyed lines therefore asks first, so Escape or a mis-aimed × cannot
   * silently discard a twelve-line order. An existing draft compares against what it opened
   * with, so closing it untouched does not warn about losing changes that were never made.
   */
  const formSignature = JSON.stringify({ partnerId, date, currency, exchangeRate, terms, dueDate, shipToName, shipToAddressLine1, shipToAddressLine2, shipToCity, shipToRegion, shipToPostalCode, shipToCountry, deliveryInstructions, freight, freightTaxRate, fees, feeTaxRate, deposit, lines: lines.map((line) => [line.productId, line.quantity, line.unitAmount, line.uomId, line.discountRate, line.taxCode, line.taxRate, line.route, line.projectReference, line.supplyAllocations.map((allocation) => [allocation.salesOrderLineId, allocation.quantity])]) });
  const [openedWith] = useState(formSignature);
  const dirty = editing ? formSignature !== openedWith : Boolean(partnerId) || lines.some((line) => line.productId) || freight > 0 || fees > 0 || deposit > 0;
  // Not memoized by hand: the dismiss hook reads the latest handler through a ref.
  const requestClose = () => { if (dirty) setConfirmingDiscard(true); else onClose(); };
  useDialogDismiss(requestClose, submitting);
  useEffect(() => {
    if (!partnerId) return;
    const controller = new AbortController();
    void (async () => {
      const priced = await Promise.all(lines.map(async (line) => {
        if (line.priceSource === "Manual override" || line.priceSource === "Saved order price") return null;
        const sku = productOptions[line.productId]?.label.split(" · ")[0] ?? "";
        if (!sku) return null;
        const params = new URLSearchParams({ lookup: "products", role: partnerRole, partnerId, q: sku, quantity: String(Math.max(line.quantity, 1)), currency, exchangeRateToBase: String(exchangeRate), limit: "10" });
        const response = await fetch(`/api/snapshot?${params}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return null;
        const item = asRows((await response.json() as Record<string, unknown>).items).find((candidate) => text(candidate.id) === line.productId);
        return item ? { id: line.id, unitAmount: number(item.effectiveUnitAmountCents) / 100, uomId: text(item.selectedUomId), uomCode: text(item.selectedUomCode), priceSource: text(item.priceSource, "Catalog selling price") } : null;
      }));
      if (!controller.signal.aborted) setLines((current) => {
        let changed = false;
        const next = current.map((line) => {
          const update = priced.find((item) => item?.id === line.id);
          if (!update || line.priceSource === "Manual override" || line.priceSource === "Saved order price") return line;
          if (line.unitAmount === update.unitAmount && line.uomId === update.uomId && line.uomCode === update.uomCode && line.priceSource === update.priceSource) return line;
          changed = true;
          return { ...line, unitAmount: update.unitAmount, uomId: update.uomId, uomCode: update.uomCode, priceSource: update.priceSource };
        });
        return changed ? next : current;
      });
    })().catch((caught) => { if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(`${isPurchase ? "Vendor cost" : "Customer pricing"} could not be refreshed. Check the document currency and exchange rate.`); });
    return () => controller.abort();
  }, [currency, exchangeRate, isPurchase, lines, partnerId, partnerRole, productOptions]);

  const saveShipToAddress = async () => {
    setSavingAddress(true); setAddressNotice("");
    const idempotencyKey = crypto.randomUUID();
    try {
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ command: "createPartnerAddress", idempotencyKey, payload: {
          partnerId, label: shipToName.trim() || shipToCity.trim() || "Ship-to", contactName: shipToName,
          addressLine1: shipToAddressLine1, addressLine2: shipToAddressLine2, city: shipToCity, region: shipToRegion,
          postalCode: shipToPostalCode, country: shipToCountry, deliveryInstructions,
        } }),
      });
      const result = await response.json() as { recordId?: string; error?: string | { message?: string } };
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "The address could not be saved.");
      if (result.recordId) setShipToAddressId(result.recordId);
      setAddressNotice("Saved to the customer's address book.");
    } catch (caught) { setAddressNotice(caught instanceof Error ? caught.message : "The address could not be saved."); }
    finally { setSavingAddress(false); }
  };

  const itemSubtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitAmount, 0);
  const discountTotal = lines.reduce((sum, line) => sum + line.quantity * line.unitAmount * line.discountRate / 100, 0);
  const taxTotal = lines.reduce((sum, line) => sum + line.quantity * line.unitAmount * (1 - line.discountRate / 100) * line.taxRate / 100, 0) + freight * freightTaxRate / 100 + fees * feeTaxRate / 100;
  const total = itemSubtotal - discountTotal + freight + fees + deposit + taxTotal;
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const updateLine = (id: string, patch: Partial<ComposerLine>) => setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
  const addSupplyAllocation = (lineId: string) => setLines((current) => current.map((line) => {
    if (line.id !== lineId) return line;
    const remaining = Math.max(line.quantity - line.supplyAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0), 0);
    return { ...line, supplyAllocations: [...line.supplyAllocations, { id: crypto.randomUUID(), salesOrderLineId: "", quantity: remaining, label: "" }] };
  }));
  const updateSupplyAllocation = (lineId: string, allocationId: string, patch: Partial<ComposerLine["supplyAllocations"][number]>) => setLines((current) => current.map((line) => {
    if (line.id !== lineId) return line;
    const supplyAllocations = line.supplyAllocations.map((allocation) => allocation.id === allocationId ? { ...allocation, ...patch } : allocation);
    return { ...line, supplyAllocations, sourceSalesOrderLineId: supplyAllocations[0]?.salesOrderLineId ?? "" };
  }));
  const removeSupplyAllocation = (lineId: string, allocationId: string) => setLines((current) => current.map((line) => {
    if (line.id !== lineId) return line;
    const supplyAllocations = line.supplyAllocations.filter((allocation) => allocation.id !== allocationId);
    return { ...line, supplyAllocations, sourceSalesOrderLineId: supplyAllocations[0]?.salesOrderLineId ?? "" };
  }));

  /**
   * Every reason the order cannot be saved, re-evaluated on each render so a message clears as
   * its field is fixed. Native `required` validation only flashed a tooltip on the first empty
   * field, so "Save sales order draft" appeared to do nothing when a postal code was missing.
   */
  const collectProblems = () => {
    const problems: Array<{ field: string; message: string }> = [];
    const add = (field: string, message: string) => { if (!problems.some((problem) => problem.field === field)) problems.push({ field, message }); };
    if (!partnerId) add("partnerId", `Select a ${isPurchase ? "vendor" : "customer"}.`);
    if (!lines.length) add("lines", "Add at least one product line.");
    lines.forEach((line, index) => {
      if (!line.productId) add(`line-${line.id}-product`, `Line ${index + 1}: choose a product.`);
      else if (!line.uomId) add(`line-${line.id}-product`, `Line ${index + 1}: this product has no configured ${isPurchase ? "purchasing" : "sales"} unit.`);
      if (!(line.quantity > 0)) add(`line-${line.id}-quantity`, `Line ${index + 1}: enter a positive quantity.`);
      if (line.unitAmount < 0) add(`line-${line.id}-unitAmount`, `Line ${index + 1}: the unit ${isPurchase ? "cost" : "price"} cannot be negative.`);
      if (isPurchase && line.route !== "stock") {
        const allocated = line.supplyAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
        if (!line.supplyAllocations.length || line.supplyAllocations.some((allocation) => !allocation.salesOrderLineId.trim() || !Number.isFinite(allocation.quantity) || allocation.quantity <= 0)) add(`line-${line.id}-allocations`, `Line ${index + 1} needs a sales-order demand and positive quantity for every allocation.`);
        else if (new Set(line.supplyAllocations.map((allocation) => allocation.salesOrderLineId)).size !== line.supplyAllocations.length) add(`line-${line.id}-allocations`, `Line ${index + 1} allocates to the same sales-order demand more than once.`);
        else if (allocated > line.quantity + 0.000001) add(`line-${line.id}-allocations`, `Line ${index + 1} allocates ${allocated} ${line.uomCode || "units"} from only ${line.quantity} ordered.`);
        else if (line.route === "drop-ship" && line.supplyAllocations.length !== 1) add(`line-${line.id}-allocations`, `Line ${index + 1} is drop ship and must allocate to exactly one sales-order demand.`);
      }
    });
    if (!date) add("date", `Enter the ${isPurchase ? "expected" : "requested"} delivery date.`);
    if (!dueDate) add("dueDate", "Enter the payment due date.");
    if (currency !== "CAD" && !(exchangeRate > 0)) add("exchangeRate", "Enter a positive exchange rate for the foreign currency.");
    if (![freightTaxRate, feeTaxRate].every((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 100)) add("freightTaxRate", "Freight and fee tax rates must be between 0% and 100%.");
    if (!isPurchase) {
      if (!shipToName.trim()) add("shipToName", "Enter the ship-to recipient.");
      if (!shipToAddressLine1.trim()) add("shipToAddressLine1", "Enter the first ship-to address line.");
      if (!shipToCity.trim()) add("shipToCity", "Enter the ship-to city.");
      if (!shipToRegion.trim()) add("shipToRegion", "Enter the ship-to province or region.");
      if (!shipToPostalCode.trim()) add("shipToPostalCode", "Enter the ship-to postal code.");
      if (!shipToCountry.trim()) add("shipToCountry", "Enter the ship-to country.");
    }
    if (fastTrack && !approvalReason.trim()) add("approvalReason", "Enter an authorization note before creating and approving this order.");
    return problems;
  };
  const problems = collectProblems();
  const shownProblems = attempted ? problems : [];
  const fieldMessage = (field: string) => shownProblems.find((problem) => problem.field === field)?.message;
  const fieldProps = (field: string) => fieldMessage(field) ? { "aria-invalid": true as const, "aria-describedby": `${errorId}-${field}` } : {};
  const fieldError = (field: string) => { const message = fieldMessage(field); return message ? <small className="field-error" id={`${errorId}-${field}`}>{message}</small> : null; };
  const focusField = (field: string) => window.requestAnimationFrame(() => {
    const target = formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"] input, [data-field="${field}"] select`);
    target?.scrollIntoView({ block: "center" });
    target?.focus();
  });
  /**
   * What was ordered, from the product's own attributes. The picker's detail line — price,
   * availability, cost source — used to be saved here as the line's "configuration".
   */
  const configurationSnapshotFor = (productId: string) => {
    const option = productOptions[productId];
    const catalog = products.find((product) => product.id === productId);
    const parts = [option?.dimensions ?? catalog?.dimensions, option?.finish ?? catalog?.finish, option?.material ?? catalog?.material].map((part) => part?.trim() ?? "").filter(Boolean);
    return parts.length ? parts.join(" · ") : undefined;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setAttempted(true);
    if (problems.length) { focusField(problems[0].field); return; }
    setSubmitting(true);
    try {
      const normalizedLines = lines.map((line) => {
        const supplyAllocations = isPurchase && line.route !== "stock" ? line.supplyAllocations.map((allocation) => ({ salesOrderLineId: allocation.salesOrderLineId.trim(), quantity: allocation.quantity })) : undefined;
        return { kind: "item", productId: line.productId, quantity: line.quantity, uomId: line.uomId, unitCostCents: isPurchase ? Math.round(line.unitAmount * 100) : undefined, unitPriceCents: isPurchase ? undefined : Math.round(line.unitAmount * 100), discountCents: Math.round(line.quantity * line.unitAmount * line.discountRate), taxable: line.taxRate > 0, taxCode: line.taxCode, taxRateBps: Math.round(line.taxRate * 100), fulfillmentRoute: line.route.replaceAll("-", "_"), projectReference: line.projectReference, sourceSalesOrderLineId: supplyAllocations?.[0]?.salesOrderLineId, supplyAllocations, configurationSnapshot: configurationSnapshotFor(line.productId) };
      });
      const chargeLines = [
        freight > 0 ? { kind: "charge", chargeType: "freight", description: "Freight", amountCents: Math.round(freight * 100), direction: "add", taxable: freightTaxRate > 0, refundable: false, taxCode: freightTaxRate > 0 ? "GST" : "Zero", taxRateBps: Math.round(freightTaxRate * 100) } : null,
        fees > 0 ? { kind: "charge", chargeType: "fee", description: "Other fees", amountCents: Math.round(fees * 100), direction: "add", taxable: feeTaxRate > 0, refundable: false, taxCode: feeTaxRate > 0 ? "GST" : "Zero", taxRateBps: Math.round(feeTaxRate * 100) } : null,
        deposit > 0 ? { kind: "charge", chargeType: "returnable_deposit", description: "Refundable core / empty deposit", amountCents: Math.round(deposit * 100), direction: "add", taxable: false, refundable: true, taxCode: "EXEMPT", taxRateBps: 0 } : null,
      ].filter(Boolean);
      await onSubmit({ ...(isPurchase ? { vendorId: partnerId, expectedDate: date } : { customerId: partnerId, requestedDate: date, shipToName, shipToAddressLine1, shipToAddressLine2, shipToCity, shipToRegion, shipToPostalCode, shipToCountry, deliveryInstructions }), lines: [...normalizedLines, ...chargeLines], currency, exchangeRateToBase: exchangeRate, paymentTerms: terms, dueDate, projectReference: draft?.projectReference, fastTrack, ...(fastTrack ? { approvalReason: approvalReason.trim() } : {}) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The order could not be created. Your entries are still here."); }
    finally { setSubmitting(false); }
  };

  const draftQuantitySummary = `${quantity} ${quantity === 1 ? "unit" : "units"} across ${lines.length} ${lines.length === 1 ? "line" : "lines"}`;
  const impact = [
    { category: "Physical inventory", label: "On-hand inventory", after: "No change" },
    { category: "Commercial commitment", label: fastTrack ? (isPurchase ? "Expected incoming" : "Customer demand") : (isPurchase ? "Draft purchase quantity" : "Draft sales quantity"), ...(fastTrack ? { before: 0 } : {}), after: fastTrack ? `${draftQuantitySummary} active` : `${draftQuantitySummary} · not active until ${isPurchase ? "approved" : "confirmed"}`, tone: "info" as Severity },
    { category: "Commercial commitment", label: "Fulfillment routes", after: [...new Set(lines.map((line) => titleCase(line.route.replaceAll("-", " "))))].join(", ") },
    { category: "Financial effect", label: fastTrack ? "Authorized commitment total" : "Draft total", before: money.format(0), after: `${currency} ${total.toFixed(2)}` },
    { category: "Financial effect", label: "Refundable core / empty deposit", after: `${currency} ${deposit.toFixed(2)}` },
  ];

  return <div className="modal-overlay" role="presentation"><section className="command-dialog create-order-dialog commercial-composer" role="dialog" aria-modal="true" aria-labelledby="create-order-title"><div className="dialog-header"><div><span className="section-kicker">{editing ? draft?.number : "New commercial commitment"}</span><h2 id="create-order-title">{editing ? `Edit ${isPurchase ? "purchase" : "sales"} order draft` : `Create multi-line ${isPurchase ? "purchase order" : "sales order"}`}</h2></div><button ref={closeRef} type="button" className="icon-button" aria-label="Close dialog" onClick={requestClose}>×</button></div><form ref={formRef} onSubmit={submit} noValidate>
    {error || shownProblems.length ? <div className="error-summary" role="alert" tabIndex={-1}><strong>Review the order</strong>{error ? <p>{error}</p> : null}{shownProblems.length ? <ul className="error-list">{shownProblems.map((problem) => <li key={problem.field}><button type="button" className="text-button" onClick={() => focusField(problem.field)}>{problem.message}</button></li>)}</ul> : null}</div> : null}
    {!isPurchase && partnerCreditHold ? <div className="exception-banner"><span aria-hidden="true">!</span><div><strong>This customer is on credit hold</strong><p>The draft can be saved, but it cannot be confirmed until accounting releases the hold.</p></div></div> : null}
    <div className="command-form form-grid composer-header-fields"><label data-field="partnerId"><span>{isPurchase ? "Vendor" : "Customer"}{requiredMark}</span><ReferenceSearchSelect kind="partners" role={partnerRole} value={partnerId} initialOptions={initialPartnerOptions} quickCreate={partnerRole} onSelect={(option) => { setPartnerId(option.id); setPartnerCreditHold(option.creditHold === true); const nextCurrency = option.currency || "CAD"; const nextTerms = option.paymentTerms || (isPurchase ? "Net 30" : "Net 15"); setCurrency(nextCurrency); setExchangeRate(nextCurrency === "CAD" ? 1 : 0); setTerms(nextTerms); setDueDate(dueDateForTerms(date, nextTerms)); if (!isPurchase) { setShipToName(option.label); setShipToAddressLine1(option.addressLine1 ?? ""); setShipToAddressLine2(option.addressLine2 ?? ""); setShipToCity(option.city ?? ""); setShipToRegion(option.region ?? ""); setShipToPostalCode(option.postalCode ?? ""); setShipToCountry(option.country ?? "CA"); } }} placeholder={`Search ${partnerRole} name, code, or email`} />{fieldError("partnerId")}</label><label data-field="date"><span>{isPurchase ? "Expected delivery" : "Requested delivery"}{requiredMark}</span><input type="date" value={date} {...fieldProps("date")} onChange={(event) => { const nextDate = event.target.value; setDate(nextDate); setDueDate(dueDateForTerms(nextDate, terms)); }} />{fieldError("date")}</label><label>Currency<select value={currency} onChange={(event) => { const nextCurrency = event.target.value; setCurrency(nextCurrency); setExchangeRate(nextCurrency === "CAD" ? 1 : 0); }}><option>CAD</option><option>USD</option><option>EUR</option></select></label>{currency !== "CAD" && <label data-field="exchangeRate"><span>Exchange rate to CAD{requiredMark}</span><NumberField min="0.0001" step="0.0001" value={exchangeRate} onChange={setExchangeRate} {...fieldProps("exchangeRate")} />{fieldError("exchangeRate")}</label>}<label>Payment terms<select value={terms} onChange={(event) => { const nextTerms = event.target.value; setTerms(nextTerms); setDueDate(dueDateForTerms(date, nextTerms)); }}>{PAYMENT_TERMS.map((term) => <option key={term}>{term}</option>)}</select></label><label data-field="dueDate"><span>Due date{requiredMark}</span><input type="date" value={dueDate} {...fieldProps("dueDate")} onChange={(event) => setDueDate(event.target.value)} />{fieldError("dueDate")}</label></div>
    {!isPurchase ? <fieldset className="composer-lines"><legend>Ship-to address</legend><div className="command-form form-grid composer-header-fields"><label className="project-field">Saved job site / ship-to<ReferenceSearchSelect kind="partnerAddresses" partnerId={partnerId} value={shipToAddressId} initialOptions={[]} onSelect={(option) => { setShipToAddressId(option.id); setShipToName(option.contactName || option.label); setShipToAddressLine1(option.addressLine1 ?? ""); setShipToAddressLine2(option.addressLine2 ?? ""); setShipToCity(option.city ?? ""); setShipToRegion(option.region ?? ""); setShipToPostalCode(option.postalCode ?? ""); setShipToCountry(option.country ?? "CA"); if (option.deliveryInstructions) setDeliveryInstructions(option.deliveryInstructions); }} placeholder={partnerId ? "Search this customer's saved addresses" : "Select a customer first"} /></label><label data-field="shipToName"><span>Recipient{requiredMark}</span><input value={shipToName} onChange={(event) => setShipToName(event.target.value)} required {...fieldProps("shipToName")} />{fieldError("shipToName")}</label><label data-field="shipToAddressLine1"><span>Street address{requiredMark}</span><AddressAutocomplete value={shipToAddressLine1} country={shipToCountry} onChange={setShipToAddressLine1} onAddressSelected={(selected) => { setShipToAddressLine1(selected.addressLine1); setShipToAddressLine2(selected.addressLine2); setShipToCity(selected.city); setShipToRegion(selected.region); setShipToPostalCode(selected.postalCode); setShipToCountry(selected.country || shipToCountry); }} required ariaInvalid={Boolean(fieldMessage("shipToAddressLine1"))} ariaDescribedBy={fieldMessage("shipToAddressLine1") ? `${errorId}-shipToAddressLine1` : undefined} />{fieldError("shipToAddressLine1")}</label><label>Address line 2<input value={shipToAddressLine2} onChange={(event) => setShipToAddressLine2(event.target.value)} autoComplete="address-line2" /></label><label data-field="shipToCity"><span>City{requiredMark}</span><input value={shipToCity} onChange={(event) => setShipToCity(event.target.value)} required autoComplete="address-level2" {...fieldProps("shipToCity")} />{fieldError("shipToCity")}</label><label data-field="shipToRegion"><span>Province / region{requiredMark}</span><input value={shipToRegion} onChange={(event) => setShipToRegion(event.target.value)} required autoComplete="address-level1" {...fieldProps("shipToRegion")} />{fieldError("shipToRegion")}</label><label data-field="shipToPostalCode"><span>Postal code{requiredMark}</span><input value={shipToPostalCode} onChange={(event) => setShipToPostalCode(event.target.value)} required autoComplete="postal-code" {...fieldProps("shipToPostalCode")} />{fieldError("shipToPostalCode")}</label><label data-field="shipToCountry"><span>Country{requiredMark}</span><input value={shipToCountry} onChange={(event) => setShipToCountry(event.target.value.toUpperCase())} required autoComplete="country" {...fieldProps("shipToCountry")} />{fieldError("shipToCountry")}</label><label>Delivery instructions<input value={deliveryInstructions} onChange={(event) => setDeliveryInstructions(event.target.value)} placeholder="Dock, access, or appointment details" /></label></div><div className="composer-address-actions"><button type="button" className="button secondary" disabled={savingAddress || !partnerId || !shipToAddressLine1.trim() || !shipToCity.trim()} onClick={() => void saveShipToAddress()}>{savingAddress ? "Saving…" : "Save to this customer's address book"}</button>{addressNotice ? <span className="read-only-label" role="status">{addressNotice}</span> : null}</div></fieldset> : null}
    <section className="composer-lines" aria-labelledby="composer-lines-title">
      <div className="composer-section-heading"><div><strong id="composer-lines-title">Product lines</strong></div><button type="button" className="button secondary" onClick={() => setLines((current) => [...current, initialLine()])}>Add product line</button></div>
      {lines.map((line, index) => {
        const selected = productOptions[line.productId];
        return <fieldset key={line.id} className="composer-line">
          <legend>Line {index + 1}</legend>
          <label className="product-field" data-field={`line-${line.id}-product`}><span>Product / configuration{requiredMark}</span><ReferenceSearchSelect kind="products" role={partnerRole} partnerId={partnerId} quantity={line.quantity} warehouseId={warehouseId} currency={currency} exchangeRateToBase={exchangeRate} value={line.productId} initialOptions={line.productId && productOptions[line.productId] ? [productOptions[line.productId]] : []} quickCreate="product" onSelect={(option) => { setProductOptions((current) => ({ ...current, [option.id]: option })); updateLine(line.id, { productId: option.id, ...(option.unitAmount != null ? { unitAmount: option.unitAmount } : {}), uomId: option.uomId ?? "", uomCode: option.uomCode ?? "", priceSource: option.priceSource ?? "Catalog price" }); }} placeholder="Search SKU, name, manufacturer SKU, or dimensions" /><small>{selected?.detail}</small>{fieldError(`line-${line.id}-product`)}</label>
          <label data-field={`line-${line.id}-quantity`}><span>Quantity ({line.uomCode || "unit"}){requiredMark}</span><NumberField min="1" value={line.quantity} onChange={(quantity) => updateLine(line.id, { quantity })} {...fieldProps(`line-${line.id}-quantity`)} />{line.uomCode ? null : <small>Select a configured product unit</small>}{fieldError(`line-${line.id}-quantity`)}</label>
          <label data-field={`line-${line.id}-unitAmount`}>Unit {isPurchase ? "cost" : "price"}<NumberField min="0" step="0.01" value={line.unitAmount} onChange={(unitAmount) => updateLine(line.id, { unitAmount, priceSource: "Manual override" })} {...fieldProps(`line-${line.id}-unitAmount`)} /><small>{line.priceSource}</small>{fieldError(`line-${line.id}-unitAmount`)}</label>
          <label>Discount %<NumberField min="0" max="100" step="0.1" value={line.discountRate} onChange={(discountRate) => updateLine(line.id, { discountRate })} /></label>
          <label>Tax code<select value={line.taxCode} onChange={(event) => updateLine(line.id, { taxCode: event.target.value, taxRate: event.target.value === "GST" ? defaultTaxRateBps / 100 : 0 })}><option>GST</option><option>Zero</option><option>Exempt</option></select></label>
          <label>Tax %<NumberField min="0" value={line.taxRate} onChange={(taxRate) => updateLine(line.id, { taxRate })} /></label>
          <label>Fulfillment route<select value={line.route} onChange={(event) => {
            const route = event.target.value as ComposerLine["route"];
            const existing = route === "stock" ? [] : route === "drop-ship" ? line.supplyAllocations.slice(0, 1) : line.supplyAllocations;
            const supplyAllocations = route !== "stock" && !existing.length ? [{ id: crypto.randomUUID(), salesOrderLineId: "", quantity: line.quantity, label: "" }] : existing;
            updateLine(line.id, { route, supplyAllocations, sourceSalesOrderLineId: supplyAllocations[0]?.salesOrderLineId ?? "" });
          }}><option value="stock">Stock</option><option value="special-order">Special order</option><option value="drop-ship">Drop ship</option></select></label>
          <label className="project-field">Customer / project / opening<input value={line.projectReference} onChange={(event) => updateLine(line.id, { projectReference: event.target.value })} placeholder="Optional allocation" /></label>
          {isPurchase && line.route !== "stock" ? <div className="project-field supply-allocation-editor" data-field={`line-${line.id}-allocations`}>
            <div className="supply-allocation-heading"><div><strong>Customer-demand allocations</strong><small>Received usable quantity is reserved to these sales orders automatically, in the order shown.</small></div><button type="button" className="button secondary" disabled={line.route === "drop-ship" || line.supplyAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0) >= line.quantity} onClick={() => addSupplyAllocation(line.id)}>Add allocation</button></div>
            {line.supplyAllocations.map((allocation, allocationIndex) => <div key={allocation.id} className="supply-allocation-row">
              <label>Sales-order demand<ReferenceSearchSelect kind="salesOrderLines" role={line.route === "drop-ship" ? "drop_ship" : "special_order"} partnerId={initialOrder?.id} productId={line.productId} value={allocation.salesOrderLineId} initialOptions={allocation.salesOrderLineId ? [{ id: allocation.salesOrderLineId, label: allocation.label || `Saved allocation ${allocationIndex + 1}`, detail: "Current quantity allocation" }] : []} onSelect={(option) => updateSupplyAllocation(line.id, allocation.id, { salesOrderLineId: option.id, label: `${option.label}${option.detail ? ` · ${option.detail}` : ""}` })} placeholder="Search sales order, customer, or SKU" /></label>
              <label>Allocated quantity ({line.uomCode || "unit"})<NumberField min="0.000001" max={line.quantity} step="any" value={allocation.quantity} onChange={(quantity) => updateSupplyAllocation(line.id, allocation.id, { quantity })} /></label>
              {line.route !== "drop-ship" ? <button type="button" className="button secondary" onClick={() => removeSupplyAllocation(line.id, allocation.id)}>Remove</button> : null}
            </div>)}
            <small>{line.supplyAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0)} of {line.quantity} {line.uomCode || "units"} allocated; any remainder stays general incoming supply.</small>
            {fieldError(`line-${line.id}-allocations`)}
          </div> : null}
          {!isPurchase && line.route !== "stock" ? <div className="project-field read-only-label">Save this demand first. Dedicated supply is linked from the purchase-order composer so both sides are recorded atomically.</div> : null}
          {lines.length > 1 && <button type="button" className="remove-composer-line" onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}>Remove line {index + 1}</button>}
        </fieldset>;
      })}
    </section>
    <div className="composer-bottom-grid"><fieldset className="composer-charges"><legend>Charges, fees, and deposits</legend><label>Freight<NumberField min="0" step="0.01" value={freight} onChange={setFreight} /></label><label data-field="freightTaxRate">Freight tax %<NumberField min="0" max="100" step="0.01" value={freightTaxRate} onChange={setFreightTaxRate} {...fieldProps("freightTaxRate")} />{fieldError("freightTaxRate")}</label><label>Other fees<NumberField min="0" step="0.01" value={fees} onChange={setFees} /></label><label>Fee tax %<NumberField min="0" max="100" step="0.01" value={feeTaxRate} onChange={setFeeTaxRate} /></label><label>Refundable core / empty deposit<NumberField min="0" step="0.01" value={deposit} onChange={setDeposit} /></label></fieldset><dl className="composer-totals"><div><dt>Items</dt><dd>{currency} {itemSubtotal.toFixed(2)}</dd></div><div><dt>Discounts</dt><dd>−{currency} {discountTotal.toFixed(2)}</dd></div><div><dt>Freight & fees</dt><dd>{currency} {(freight + fees).toFixed(2)}</dd></div><div><dt>Refundable deposits</dt><dd>{currency} {deposit.toFixed(2)}</dd></div><div><dt>Tax</dt><dd>{currency} {taxTotal.toFixed(2)}</dd></div><div className="total"><dt>{fastTrack ? "Authorized total" : "Draft total"}</dt><dd>{currency} {total.toFixed(2)}</dd></div></dl></div>
    {canFastTrack && !editing ? <fieldset className="composer-lines"><legend>Authorization path</legend><label><span><input type="checkbox" checked={fastTrack} onChange={(event) => setFastTrack(event.target.checked)} /> Fast-track with my signing authority</span><small>{isPurchase ? "Create this purchase order directly as approved." : "Create this sales order directly as confirmed."} Your identity, note, and timestamp are written to the audit trail.</small></label>{fastTrack ? <label data-field="approvalReason"><span>Authorization note{requiredMark}</span><input value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} placeholder="Why I am authorizing this commitment" required {...fieldProps("approvalReason")} />{fieldError("approvalReason")}</label> : null}</fieldset> : null}
    <ImpactPreview lines={impact} /><div className="dialog-actions">
      {confirmingDiscard
        ? <><span className="discard-warning" role="alert">Nothing here has been saved yet. Discarding loses the lines you keyed.</span><button type="button" className="button secondary" onClick={() => setConfirmingDiscard(false)}>Keep editing</button><button type="button" className="button danger" onClick={onClose}>Discard draft</button></>
        : <button type="button" className="button secondary" onClick={requestClose}>Discard draft</button>}
      <button type="submit" className="button primary" disabled={submitting || confirmingDiscard}>{submitting ? fastTrack ? "Creating & authorizing…" : "Saving draft…" : editing ? "Save draft changes" : fastTrack ? `Create & ${isPurchase ? "approve purchase" : "confirm sales"} order` : `Save ${isPurchase ? "purchase" : "sales"} order draft`}</button></div>
  </form></section></div>;
}

type CommandPanelProps = {
  command: ActiveCommand;
  warehouseId: string;
  po?: PurchaseOrder;
  so?: SalesOrder;
  locations: LocationOption[];
  countBalances: InventoryLocationBalance[];
  /** A vendor-return price allowance posts a financial credit, which needs its own permission. */
  canPostFinancial?: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onRequestCountApproval: (payload: Record<string, unknown>) => Promise<{ approval: CountApproval; message: string }>;
  onApproveCountApproval: (approval: CountApproval, reason: string) => Promise<{ approval: CountApproval; message: string }>;
  onRefreshCountApproval: (approval: CountApproval) => Promise<CountApproval>;
};

function CommandPanel({ command, warehouseId, po, so, locations, countBalances, canPostFinancial = false, onClose, onSubmit, onRequestCountApproval, onApproveCountApproval, onRefreshCountApproval }: CommandPanelProps) {
  const initialPoLine = po?.lines.find((line) => command.kind === "reopen" ? line.closed > 0 : command.kind === "reverse" ? line.latestReceiptReversible > 0 : command.kind === "vendor-return" ? line.received - line.returned > 0 : line.open > 0) ?? po?.lines[0];
  const initialSoLine = so?.lines?.find((line) => command.kind === "ship" ? line.reserved > 0 : command.kind === "immediate-sale" ? line.fulfillmentRoute === "stock" && line.open > line.reserved && line.productAvailable > 0 : command.kind === "customer-return" ? line.shipped - line.returned > 0 : line.open > 0) ?? so?.lines?.[0];
  const [selectedPoLineId, setSelectedPoLineId] = useState(initialPoLine?.id ?? "");
  const [selectedSoLineId, setSelectedSoLineId] = useState(initialSoLine?.id ?? "");
  const selectedPoLine = po?.lines.find((line) => line.id === selectedPoLineId) ?? initialPoLine;
  const selectedSoLine = so?.lines?.find((line) => line.id === selectedSoLineId) ?? initialSoLine;
  const effectivePo = po && selectedPoLine ? { ...po, ordered: selectedPoLine.ordered, received: selectedPoLine.received, returned: selectedPoLine.returned, closed: selectedPoLine.closed, open: selectedPoLine.open, lines: [selectedPoLine] } : po;
  const salesFactor = selectedSoLine?.uomFactorToBase || 1;
  // Supply comes with the line itself. Reading it out of the snapshot's product page meant
  // "0 available" wherever that page did not happen to include this SKU, which disabled
  // Reserve on every order and defaulted the quantity to 1 instead of what is really there.
  const lineAvailability = calculateSalesAvailability(
    selectedSoLine?.open ?? 0,
    selectedSoLine?.reserved ?? 0,
    (selectedSoLine?.productAvailable ?? 0) / salesFactor,
    (selectedSoLine?.productIncoming ?? 0) / salesFactor,
  );
  const effectiveSo = so && selectedSoLine ? { ...so, ordered: selectedSoLine.ordered, reserved: selectedSoLine.reserved, shipped: selectedSoLine.shipped, returned: selectedSoLine.returned, open: selectedSoLine.open, availableNow: lineAvailability.availableNow, incomingBeforeDate: lineAvailability.incomingBeforeDate, shortage: lineAvailability.shortage, route: titleCase(selectedSoLine.fulfillmentRoute), lines: [selectedSoLine] } : so;
  const defaults = commandDefaults(command.kind, effectivePo, effectiveSo);
  const initialBalance = countBalances.find((item) => item.locationId === command.locationId) ?? countBalances[0];
  const [quantity, setQuantity] = useState(command.kind === "count" ? initialBalance?.recordedQuantity ?? 0 : defaults.quantity);
  const [secondaryQuantity, setSecondaryQuantity] = useState(defaults.secondaryQuantity);
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState(defaults.disposition);
  const [expectedDate, setExpectedDate] = useState(futureDate(7));
  const [carrier, setCarrier] = useState(command.kind === "immediate-sale" ? "Customer pickup" : "");
  const [receiptDate, setReceiptDate] = useState(localDateString());
  const [packingSlipNumber, setPackingSlipNumber] = useState("");
  const [serviceLevel, setServiceLevel] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [billOfLadingNumber, setBillOfLadingNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [countApproval, setCountApproval] = useState<CountApproval | null>(null);
  const [approvedCountPayload, setApprovedCountPayload] = useState<Record<string, unknown> | null>(null);
  const [approvalMessage, setApprovalMessage] = useState("");
  useDialogDismiss(onClose, submitting);
  const [countLocationId, setCountLocationId] = useState(initialBalance?.locationId ?? "");
  const usableLocations = locations.filter((location) => location.inventoryStatus === "usable");
  const quarantineLocations = locations.filter((location) => location.inventoryStatus === "quarantine" || location.inventoryStatus === "damaged");
  /**
   * Never guess across warehouses — picking the first of several silently puts stock in the
   * wrong building. Within the one warehouse the operator has already selected, though, its
   * receiving location (or its only usable location) is the unambiguous answer, and making the
   * receiver search a 47-location list for it every time was pure friction.
   */
  const scopedUsable = warehouseId ? usableLocations.filter((location) => location.warehouseId === warehouseId) : usableLocations;
  const defaultPostingLocation = warehouseId
    ? (scopedUsable.find((location) => location.locationType === "receiving") ?? (scopedUsable.length === 1 ? scopedUsable[0] : undefined))
    : (usableLocations.length === 1 ? usableLocations[0] : undefined);
  const preferredLocation = (line?: PurchaseLine) => line?.defaultLocations.find((item) => item.warehouseId === warehouseId)?.locationId;
  const [postingLocationId, setPostingLocationId] = useState(command.kind === "immediate-sale" ? "" : preferredLocation(initialPoLine) ?? defaultPostingLocation?.id ?? "");
  const [quarantineLocationId, setQuarantineLocationId] = useState(quarantineLocations.length === 1 ? quarantineLocations[0].id : "");
  const [lotNumber, setLotNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [lotId, setLotId] = useState("");
  const [inventoryUnitId, setInventoryUnitId] = useState("");
  const fullOpenQuantity = (line: PurchaseLine) => line.trackingPolicy === "serial" ? Math.min(line.open, 1) : line.open;
  const [receiptLines, setReceiptLines] = useState(() => {
    const openLines = (po?.lines ?? []).filter((line) => line.open > 0 && line.fulfillmentRoute !== "drop_ship");
    // One line is received in full by default. A truck with several starts every line at zero
    // so nothing is received by omission; "Receive all open lines" fills them on request.
    const startEmpty = openLines.length > 1;
    return openLines.map((line) => ({ lineId: line.id, lineVersion: line.version, quantity: startEmpty ? 0 : fullOpenQuantity(line), damagedQuantity: 0, locationId: preferredLocation(line) ?? defaultPostingLocation?.id ?? "", uomId: line.orderedUomId, approvalId: "", lotNumber: "", serialNumber: "" }));
  });
  const receiveAllOpenLines = () => setReceiptLines((current) => current.map((receiptLine) => { const line = po?.lines.find((item) => item.id === receiptLine.lineId); return line ? { ...receiptLine, quantity: fullOpenQuantity(line) } : receiptLine; }));
  const [overReceiptApprovalId, setOverReceiptApprovalId] = useState("");
  const isBatchReceipt = command.kind === "receive" && receiptLines.length > 1;
  const receiptQuantity = isBatchReceipt ? receiptLines.reduce((sum, line) => sum + Math.max(line.quantity, 0), 0) : quantity;
  const title = commandTitle(command.kind);
  const selectedCountBalance = countBalances.find((item) => item.locationId === countLocationId);
  // A batch receipt posts the whole truck, so its impact must be measured against the whole
  // order. Comparing the 100-unit batch total to the selected line's 30 open units reported
  // "70 excess · within tolerance" on a receipt that exactly matched the purchase order.
  const impactPo = isBatchReceipt ? po : effectivePo;
  const impact = commandImpact(command.kind, receiptQuantity, isBatchReceipt ? receiptLines.reduce((sum, line) => sum + Math.max(line.damagedQuantity, 0), 0) : secondaryQuantity, impactPo, effectiveSo, disposition, selectedCountBalance?.recordedQuantity);
  const max = commandDefaults(command.kind, effectivePo, effectiveSo).max;
  const countPayload = () => {
    // The batch receipt builds its own payload, so the truck's paperwork has to be attached
    // here too — otherwise the fields above post nothing on a multi-line receipt.
    if (isBatchReceipt) return { lines: receiptLines.filter((line) => line.quantity > 0), warehouseId, quarantineLocationId, postingDate: receiptDate, ...(packingSlipNumber.trim() ? { packingSlipNumber: packingSlipNumber.trim() } : {}) };
    const lineId = ["receive", "close", "reopen", "reverse", "vendor-return"].includes(command.kind)
      ? selectedPoLine?.id
      : ["reserve", "ship", "immediate-sale", "customer-return"].includes(command.kind)
        ? selectedSoLine?.id
        : undefined;
    const lineUomId = ["receive", "close", "reopen", "reverse", "vendor-return"].includes(command.kind) ? selectedPoLine?.orderedUomId : ["reserve", "ship", "immediate-sale", "customer-return"].includes(command.kind) ? selectedSoLine?.orderedUomId : undefined;
    const locationId = command.kind === "count" ? selectedCountBalance?.locationId : ["receive", "vendor-return", "immediate-sale", "customer-return"].includes(command.kind) ? (command.kind === "customer-return" && disposition !== "available" ? quarantineLocationId : postingLocationId) : undefined;
    return { quantity, quarantineQuantity: secondaryQuantity, reason, disposition, expectedDate, carrier, serviceLevel, trackingNumber, billOfLadingNumber, locationId, quarantineLocationId, uomId: lineUomId, recordedQuantity: selectedCountBalance?.recordedQuantity, balanceVersion: selectedCountBalance?.version,
      // Goods that arrived on Friday and are keyed on Monday belong to Friday's period, and the
      // vendor's packing slip is what the receipt gets reconciled against.
      ...(["receive", "immediate-sale"].includes(command.kind) ? { postingDate: receiptDate, warehouseId, ...(packingSlipNumber.trim() ? { packingSlipNumber: packingSlipNumber.trim() } : {}) } : {}), ...(lotNumber.trim() ? { lotNumber: lotNumber.trim() } : {}), ...(serialNumber.trim() ? { serialNumber: serialNumber.trim() } : {}), ...(lotId ? { lotId } : {}), ...(inventoryUnitId ? { inventoryUnitId } : {}), ...(overReceiptApprovalId.trim() ? { approvalId: overReceiptApprovalId.trim() } : {}), ...(lineId ? { lineId } : {}) };
  };
  const chooseCountLocation = (locationId: string) => { const balance = countBalances.find((item) => item.locationId === locationId); setCountLocationId(locationId); setQuantity(balance?.recordedQuantity ?? 0); setApprovalRequired(false); setCountApproval(null); setApprovedCountPayload(null); setApprovalMessage(""); };
  const choosePoLine = (lineId: string) => { const line = po?.lines.find((item) => item.id === lineId); setSelectedPoLineId(lineId); setLotNumber(""); setSerialNumber(""); setLotId(""); setInventoryUnitId(""); if (po && line) { setPostingLocationId(preferredLocation(line) ?? defaultPostingLocation?.id ?? ""); setQuantity(commandDefaults(command.kind, { ...po, ordered: line.ordered, received: line.received, returned: line.returned, closed: line.closed, open: line.open, lines: [line] }, effectiveSo).quantity); } };
  const chooseSoLine = (lineId: string) => { const line = so?.lines?.find((item) => item.id === lineId); if (!so || !line) return; const factor = line.uomFactorToBase || 1; const availability = calculateSalesAvailability(line.open, line.reserved, line.productAvailable / factor, line.productIncoming / factor); setSelectedSoLineId(lineId); setLotId(""); setInventoryUnitId(""); setQuantity(commandDefaults(command.kind, effectivePo, { ...so, ordered: line.ordered, reserved: line.reserved, shipped: line.shipped, returned: line.returned, open: line.open, availableNow: availability.availableNow, incomingBeforeDate: availability.incomingBeforeDate, shortage: availability.shortage, route: titleCase(line.fulfillmentRoute), lines: [line] }).quantity); };
  const updateReceiptLine = (lineId: string, patch: Partial<{ quantity: number; damagedQuantity: number; locationId: string; uomId?: string; approvalId: string; lotNumber: string; serialNumber: string }>) => setReceiptLines((current) => current.map((line) => line.lineId === lineId ? { ...line, ...patch } : line));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (command.kind !== "count" && receiptQuantity <= 0) return setError("Enter a quantity greater than zero.");
    if (command.kind === "count" && (!selectedCountBalance || !Number.isFinite(selectedCountBalance.version))) return setError("Select a current durable location balance before posting the count.");
    if (command.kind === "count" && quantity < 0) return setError("The counted quantity cannot be negative.");
    if (!isBatchReceipt && command.kind !== "count" && max > 0 && quantity > max) return setError(`Quantity cannot exceed ${max}.`);
    if ((!isBatchReceipt && command.kind === "receive" || command.kind === "vendor-return" && disposition !== "allowance") && !postingLocationId) return setError("Select an active usable inventory location.");
    if (isBatchReceipt && receiptLines.some((line) => line.quantity > 0 && !line.locationId)) return setError("Select a usable destination for every received line.");
    if ((command.kind === "customer-return" && disposition !== "available") || (command.kind === "receive" && (secondaryQuantity > 0 || isBatchReceipt && receiptLines.some((line) => line.damagedQuantity > 0)))) { if (!quarantineLocationId) return setError("Select an active quarantine or damaged inventory location."); }
    if (command.kind === "receive" && secondaryQuantity > quantity) return setError("Quarantine quantity cannot exceed arrived quantity.");
    if (isBatchReceipt && receiptLines.some((line) => line.quantity < 0 || line.damagedQuantity < 0 || line.damagedQuantity > line.quantity)) return setError("Each receipt line needs a non-negative quantity and quarantine cannot exceed arrived quantity.");
    if (isBatchReceipt && receiptLines.some((receiptLine) => { const line = po?.lines.find((item) => item.id === receiptLine.lineId); return receiptLine.quantity > 0 && (line?.trackingPolicy === "lot" && !receiptLine.lotNumber.trim() || line?.trackingPolicy === "serial" && (receiptLine.quantity !== 1 || !receiptLine.serialNumber.trim())); })) return setError("Every tracked receipt line needs its lot number, or exactly one serial number.");
    if (!isBatchReceipt && command.kind === "receive" && selectedPoLine?.trackingPolicy === "lot" && !lotNumber.trim()) return setError("Enter the received lot number.");
    if (!isBatchReceipt && command.kind === "receive" && selectedPoLine?.trackingPolicy === "serial" && (quantity !== 1 || !serialNumber.trim())) return setError("Serial-tracked receipts must post exactly one unit with its serial number.");
    const outgoingPolicy = selectedPoLine?.trackingPolicy && command.kind === "vendor-return" ? selectedPoLine.trackingPolicy : selectedSoLine?.trackingPolicy;
    const physicalOutgoing = command.kind === "ship" || command.kind === "immediate-sale" || command.kind === "customer-return" || command.kind === "vendor-return" && disposition !== "allowance";
    if (physicalOutgoing && outgoingPolicy === "lot" && !lotId) return setError("Select the lot identity for this physical posting.");
    if (physicalOutgoing && outgoingPolicy === "serial" && (quantity !== 1 || !inventoryUnitId)) return setError("Serial-tracked postings must use exactly one selected serial number.");
    if (command.kind === "ship" && outgoingPolicy !== "quantity" && !selectedSoLine?.reservationLocationId) return setError("Tracked stock is reserved across more than one location. Reallocate it to one location before shipping.");
    if (command.kind === "immediate-sale" && outgoingPolicy !== "quantity" && !postingLocationId) return setError("Select the usable location holding this lot or serial.");
    if (command.kind === "ship" && (!carrier.trim() || (!trackingNumber.trim() && !billOfLadingNumber.trim()))) return setError("Enter a carrier and either a tracking number or bill of lading.");
    if (["close", "reopen", "reverse", "vendor-return", "customer-return", "count"].includes(command.kind) && !reason.trim()) return setError("Select or enter a reason before continuing.");
    setSubmitting(true);
    setError("");
    try {
      const payload = countPayload();
      if (command.kind === "count" && approvalRequired) {
        if (countApproval?.status !== "approved" || !approvedCountPayload) return setError("Manager approval is required before this count can be posted.");
        await onSubmit({ ...approvedCountPayload, approvalId: countApproval.id });
      } else {
        await onSubmit(payload);
      }
    } catch (caught) {
      if (command.kind === "count" && caught instanceof CommandRequestError && caught.code === "APPROVAL_REQUIRED") {
        setApprovalRequired(true);
        setApprovalMessage("This variance exceeds the count policy. Request manager approval; no inventory has moved yet.");
        setError("");
      } else setError(caught instanceof Error ? caught.message : "The command could not be completed.");
    } finally {
      setSubmitting(false);
    }
  };

  const requestApproval = async () => {
    if (!reason.trim()) return setError("Select a variance reason before requesting approval.");
    setSubmitting(true); setError("");
    const payload = countPayload();
    try {
      const result = await onRequestCountApproval(payload);
      setApprovedCountPayload(payload);
      setCountApproval(result.approval);
      setApprovalMessage(`${result.message} Request ${result.approval.id}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Approval could not be requested."); }
    finally { setSubmitting(false); }
  };

  const approveRequest = async () => {
    if (!countApproval) return;
    setSubmitting(true); setError("");
    try {
      const result = await onApproveCountApproval(countApproval, `Approved count variance: ${reason}`);
      setCountApproval(result.approval);
      setApprovalMessage(`${result.message} Post the approved count to create its adjustment movement.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Approval could not be completed."); }
    finally { setSubmitting(false); }
  };

  const checkApproval = async () => {
    if (!countApproval) return;
    setSubmitting(true); setError("");
    try {
      const next = await onRefreshCountApproval(countApproval);
      setCountApproval(next);
      setApprovalMessage(next.status === "approved" ? "Manager approval is complete. Post the approved count to create its adjustment movement." : next.status === "rejected" ? "The request was rejected. Close this dialog and review the count before requesting again." : "Approval is still pending; no inventory has moved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Approval status could not be refreshed."); }
    finally { setSubmitting(false); }
  };

  return <div className="modal-overlay" role="presentation"><section className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title"><div className="dialog-header"><div><span className="section-kicker">{command.entityNumber}</span><h2 id="command-title">{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}>×</button></div><form onSubmit={submit} noValidate>
    {error && <div className="error-summary" role="alert"><strong>Review the highlighted information</strong><p>{error}</p></div>}
    <fieldset className="command-fields-lock" disabled={command.kind === "count" && Boolean(countApproval)}>
      <CommandFields receiptDate={receiptDate} setReceiptDate={setReceiptDate} packingSlipNumber={packingSlipNumber} setPackingSlipNumber={setPackingSlipNumber} warehouseId={warehouseId} kind={command.kind} po={effectivePo} so={effectiveSo} purchaseLines={po?.lines ?? []} salesLines={so?.lines ?? []} selectedPoLineId={selectedPoLine?.id ?? ""} selectedSoLineId={selectedSoLine?.id ?? ""} setSelectedPoLineId={choosePoLine} setSelectedSoLineId={chooseSoLine} quantity={quantity} secondaryQuantity={secondaryQuantity} setQuantity={setQuantity} setSecondaryQuantity={setSecondaryQuantity} receiptLines={receiptLines} updateReceiptLine={updateReceiptLine} receiveAllOpenLines={receiveAllOpenLines} canPostFinancial={canPostFinancial} lotNumber={lotNumber} setLotNumber={setLotNumber} serialNumber={serialNumber} setSerialNumber={setSerialNumber} lotId={lotId} setLotId={setLotId} inventoryUnitId={inventoryUnitId} setInventoryUnitId={setInventoryUnitId} overReceiptApprovalId={overReceiptApprovalId} setOverReceiptApprovalId={setOverReceiptApprovalId} reason={reason} setReason={setReason} disposition={disposition} setDisposition={setDisposition} expectedDate={expectedDate} setExpectedDate={setExpectedDate} carrier={carrier} setCarrier={setCarrier} serviceLevel={serviceLevel} setServiceLevel={setServiceLevel} trackingNumber={trackingNumber} setTrackingNumber={setTrackingNumber} billOfLadingNumber={billOfLadingNumber} setBillOfLadingNumber={setBillOfLadingNumber} max={max} countBalances={countBalances} countLocationId={countLocationId} setCountLocationId={chooseCountLocation} usableLocations={usableLocations} quarantineLocations={quarantineLocations} postingLocationId={postingLocationId} setPostingLocationId={setPostingLocationId} quarantineLocationId={quarantineLocationId} setQuarantineLocationId={setQuarantineLocationId} />
    </fieldset>
    {command.kind === "count" && approvalRequired ? <div className={`count-approval-status ${countApproval?.status ?? "required"}`} role="status"><strong>{countApproval ? `Approval ${countApproval.status}` : "Manager approval required"}</strong><p>{approvalMessage}</p>{countApproval ? <small>Request ID: {countApproval.id} · Version {countApproval.version}</small> : null}</div> : null}
    <ImpactPreview lines={impact} />
    <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Go back</button>{command.kind === "count" && approvalRequired ? !countApproval ? <button type="button" className="button primary" disabled={submitting} onClick={() => void requestApproval()}>{submitting ? "Requesting…" : "Request manager approval"}</button> : countApproval.status === "pending" && countApproval.canApprove ? <button type="button" className="button primary" disabled={submitting} onClick={() => void approveRequest()}>{submitting ? "Approving…" : "Approve this variance"}</button> : countApproval.status === "pending" ? <button type="button" className="button primary" disabled={submitting} onClick={() => void checkApproval()}>{submitting ? "Checking…" : "Check approval status"}</button> : countApproval.status === "approved" ? <button type="submit" className="button primary" disabled={submitting}>{submitting ? "Posting approved count…" : "Post approved count"}</button> : <button type="button" className="button primary" disabled={submitting} onClick={onClose}>Review count</button> : <button type="submit" className="button primary" disabled={submitting}>{submitting ? `${title.replace(/^(Post|Reopen|Close|Reverse|Return|Approve)/, "$1ing")}…` : finalCommandLabel(command.kind, receiptQuantity)}</button>}</div>
  </form></section></div>;
}

type CommandFieldsProps = {
  warehouseId: string;
  kind: CommandKind; po?: PurchaseOrder; so?: SalesOrder; purchaseLines: PurchaseLine[]; salesLines: SalesLine[];
  selectedPoLineId: string; selectedSoLineId: string; setSelectedPoLineId: (value: string) => void; setSelectedSoLineId: (value: string) => void;
  quantity: number; secondaryQuantity: number; setQuantity: (value: number) => void; setSecondaryQuantity: (value: number) => void;
  receiptLines: Array<{ lineId: string; lineVersion: number; quantity: number; damagedQuantity: number; locationId: string; uomId?: string; approvalId: string; lotNumber: string; serialNumber: string }>;
  updateReceiptLine: (lineId: string, patch: Partial<{ quantity: number; damagedQuantity: number; locationId: string; uomId?: string; approvalId: string; lotNumber: string; serialNumber: string }>) => void;
  receiveAllOpenLines: () => void; canPostFinancial: boolean;
  lotNumber: string; setLotNumber: (value: string) => void; serialNumber: string; setSerialNumber: (value: string) => void;
  lotId: string; setLotId: (value: string) => void; inventoryUnitId: string; setInventoryUnitId: (value: string) => void;
  overReceiptApprovalId: string; setOverReceiptApprovalId: (value: string) => void;
  reason: string; setReason: (value: string) => void; disposition: string; setDisposition: (value: string) => void;
  expectedDate: string; setExpectedDate: (value: string) => void; carrier: string; setCarrier: (value: string) => void;
  receiptDate: string; setReceiptDate: (value: string) => void; packingSlipNumber: string; setPackingSlipNumber: (value: string) => void;
  serviceLevel: string; setServiceLevel: (value: string) => void; trackingNumber: string; setTrackingNumber: (value: string) => void;
  billOfLadingNumber: string; setBillOfLadingNumber: (value: string) => void; max: number;
  countBalances: InventoryLocationBalance[]; countLocationId: string; setCountLocationId: (value: string) => void;
  usableLocations: LocationOption[]; quarantineLocations: LocationOption[]; postingLocationId: string; setPostingLocationId: (value: string) => void;
  quarantineLocationId: string; setQuarantineLocationId: (value: string) => void;
};

function CommandFields({ receiptDate, setReceiptDate, packingSlipNumber, setPackingSlipNumber, warehouseId, kind, po, so, purchaseLines, salesLines, selectedPoLineId, selectedSoLineId, setSelectedPoLineId, setSelectedSoLineId, quantity, secondaryQuantity, setQuantity, setSecondaryQuantity, receiptLines, updateReceiptLine, receiveAllOpenLines, canPostFinancial, lotNumber, setLotNumber, serialNumber, setSerialNumber, lotId, setLotId, inventoryUnitId, setInventoryUnitId, overReceiptApprovalId, setOverReceiptApprovalId, reason, setReason, disposition, setDisposition, expectedDate, setExpectedDate, carrier, setCarrier, serviceLevel, setServiceLevel, trackingNumber, setTrackingNumber, billOfLadingNumber, setBillOfLadingNumber, max, countBalances, countLocationId, setCountLocationId, usableLocations, quarantineLocations, postingLocationId, setPostingLocationId, quarantineLocationId, setQuarantineLocationId }: CommandFieldsProps) {
  const eligiblePurchaseLines = purchaseLines.filter((line) => kind === "reverse" ? line.latestReceiptReversible > 0 : true);
  const purchasePolicy = po?.lines[0]?.trackingPolicy ?? "quantity";
  const salesPolicy = so?.lines?.[0]?.trackingPolicy ?? "quantity";
  const purchaseLineSelector = eligiblePurchaseLines.length > 1 ? <SearchableSelect label="Purchase order line" value={selectedPoLineId} setValue={setSelectedPoLineId} options={eligiblePurchaseLines.map((line) => ({ id: line.id, label: `${line.sku} · ${line.product}`, detail: kind === "reverse" ? `${line.latestReceiptReversible} reversible on latest receipt` : `${line.open} open` }))} /> : null;
  const salesLineSelector = salesLines.length > 1 ? <SearchableSelect label="Sales order line" value={selectedSoLineId} setValue={setSelectedSoLineId} options={salesLines.map((line) => ({ id: line.id, label: `${line.sku} · ${line.product}`, detail: kind === "customer-return" ? `${Math.max(line.shipped - line.returned, 0)} returnable` : kind === "ship" ? `${line.reserved} reserved to ship` : kind === "immediate-sale" ? `${Math.max(line.open - line.reserved, 0)} unreserved open` : `${line.open} open` }))} /> : null;
  const usableLocationField = <label><span>Usable destination{requiredMark}</span><ReferenceSearchSelect kind="locations" role="usable" warehouseId={warehouseId} value={postingLocationId} initialOptions={usableLocations.map((location) => ({ id: location.id, label: `${location.warehouseName} · ${location.code} · ${location.name}`, detail: "Usable inventory" }))} quickCreate="location" required onSelect={(option) => setPostingLocationId(option.id)} placeholder="Search every usable location" />{postingLocationId ? null : <small className="field-hint">Required before inventory can be posted.</small>}</label>;
  // "stocked" rather than "usable": goods going back to the vendor are as likely to be sitting
  // in quarantine or a damaged location as on a usable shelf.
  const vendorSourceLocationField = <label><span>Source inventory location{requiredMark}</span><ReferenceSearchSelect kind="locations" role="stocked" warehouseId={warehouseId} value={postingLocationId} initialOptions={[...usableLocations, ...quarantineLocations].filter((location) => !warehouseId || location.warehouseId === warehouseId).map((location) => ({ id: location.id, label: `${location.warehouseName} · ${location.code} · ${location.name}`, detail: `${titleCase(location.inventoryStatus)} inventory` }))} required onSelect={(option) => { setPostingLocationId(option.id); setLotId(""); setInventoryUnitId(""); }} placeholder="Search any location holding the returned stock" />{postingLocationId ? null : <small className="field-hint">Required for a physical vendor return.</small>}</label>;
  const immediateSourceLocationField = <label>Source inventory location {salesPolicy === "quantity" ? <small>(optional)</small> : null}<ReferenceSearchSelect kind="locations" role="usable" warehouseId={warehouseId} value={postingLocationId} initialOptions={usableLocations.map((location) => ({ id: location.id, label: `${location.warehouseName} · ${location.code} · ${location.name}`, detail: "Usable inventory" }))} onSelect={(option) => { setPostingLocationId(option.id); setLotId(""); setInventoryUnitId(""); }} placeholder={salesPolicy === "quantity" ? "Best free-stock location is selected automatically" : "Select the location holding this identity"} /></label>;
  const quarantineLocationField = <label><span>Quarantine destination{requiredMark}</span><ReferenceSearchSelect kind="locations" role="non_usable" warehouseId={warehouseId} value={quarantineLocationId} initialOptions={quarantineLocations.map((location) => ({ id: location.id, label: `${location.warehouseName} · ${location.code} · ${location.name}`, detail: titleCase(location.inventoryStatus) }))} quickCreate="location" required onSelect={(option) => setQuarantineLocationId(option.id)} placeholder="Search every quarantine or damaged location" />{quarantineLocationId ? null : <small className="field-hint">Required when quantity is quarantined or damaged.</small>}</label>;
  // Vendor paperwork for a receipt: which day the goods landed, and the slip they came with.
  const receiptPaperworkFields = <><label>Received on<input type="date" max={localDateString()} value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} /></label><label>Packing slip / delivery note<input value={packingSlipNumber} onChange={(event) => setPackingSlipNumber(event.target.value)} placeholder="Vendor's document number" /></label></>;
  const incomingIdentityFields = purchasePolicy === "lot" ? <label><span>Received lot number{requiredMark}</span><input value={lotNumber} onChange={(event) => setLotNumber(event.target.value)} placeholder="Required lot number" required aria-required="true" /></label> : purchasePolicy === "serial" ? <label><span>Received serial number{requiredMark}</span><input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} placeholder="One serial per receipt posting" required aria-required="true" /></label> : null;
  const outgoingIdentityFields = (policy: string, productId?: string, salesLineId?: string, locationId?: string, shipped = false) => policy === "lot" ? <label>Lot identity<ReferenceSearchSelect kind="inventoryLots" role={shipped ? "shipped" : "on_hand"} productId={productId} lineId={salesLineId} locationId={locationId} value={lotId} initialOptions={[]} onSelect={(option) => setLotId(option.id)} placeholder="Search available lots" /></label> : policy === "serial" ? <label>Serial identity<ReferenceSearchSelect kind="inventoryUnits" role={shipped ? "shipped" : "on_hand"} productId={productId} lineId={salesLineId} locationId={locationId} value={inventoryUnitId} initialOptions={[]} onSelect={(option) => setInventoryUnitId(option.id)} placeholder="Search eligible serial numbers" /></label> : null;
  if (kind === "receive" && receiptLines.length > 1) return <div className="command-form"><div className="line-context"><span>Multi-line truck receipt</span><strong>{receiptLines.length} PO lines on one receipt document</strong><small>Every line starts at zero. Key what actually arrived, or fill every line with its open quantity.</small></div><div className="batch-receipt-actions"><button type="button" className="button secondary" onClick={receiveAllOpenLines}>Receive all open lines</button></div><div className="form-grid">{receiptPaperworkFields}</div>{receiptLines.some((line) => line.damagedQuantity > 0) ? quarantineLocationField : null}<div className="batch-receipt-lines">{receiptLines.map((receiptLine) => { const line = purchaseLines.find((item) => item.id === receiptLine.lineId); const excess = Math.max(receiptLine.quantity - (line?.open ?? 0), 0); return <div className="batch-receipt-line" key={receiptLine.lineId}><div><strong>{line?.sku} · {line?.product}</strong><small>{line?.open} {line?.orderedUomCode ?? "unit"} open</small></div><label>Preferred bin<ReferenceSearchSelect kind="locations" role="bin" warehouseId={warehouseId} value={receiptLine.locationId} initialOptions={usableLocations.filter((location) => !warehouseId || location.warehouseId === warehouseId).map((location) => ({ id: location.id, label: `${location.warehouseName} · ${location.code} · ${location.name}`, detail: "Usable inventory" }))} onSelect={(option) => updateReceiptLine(receiptLine.lineId, { locationId: option.id })} placeholder="Search usable bins in this warehouse" /></label><label>Arrived at dock ({line?.orderedUomCode ?? "unit"})<NumberField min="0" max={line?.trackingPolicy === "serial" ? 1 : undefined} step={line?.uomFactorToBase === 1 ? "1" : "0.001"} value={receiptLine.quantity} onChange={(quantity) => updateReceiptLine(receiptLine.lineId, { quantity })} /></label>{/* Named as a subset: side by side, "Arrived" and "Quarantine" read as two buckets that
      add up, so a clerk logging 13 units with 3 damaged keyed 10 and 3 and short-received the line. */}<label>Of which quarantined ({line?.orderedUomCode ?? "unit"})<NumberField min="0" step={line?.uomFactorToBase === 1 ? "1" : "0.001"} max={receiptLine.quantity} value={receiptLine.damagedQuantity} onChange={(damagedQuantity) => updateReceiptLine(receiptLine.lineId, { damagedQuantity })} /></label>{line?.trackingPolicy === "lot" ? <label>Lot number<input value={receiptLine.lotNumber} onChange={(event) => updateReceiptLine(receiptLine.lineId, { lotNumber: event.target.value })} placeholder="Required lot number" /></label> : line?.trackingPolicy === "serial" ? <label>Serial number<input value={receiptLine.serialNumber} onChange={(event) => updateReceiptLine(receiptLine.lineId, { serialNumber: event.target.value })} placeholder="Exactly one serial" /></label> : null}{excess > 0 ? <label>Approval ID (if above tolerance)<input value={receiptLine.approvalId} onChange={(event) => updateReceiptLine(receiptLine.lineId, { approvalId: event.target.value })} placeholder={`${excess} excess; paste approved request ID when required`} /></label> : null}</div>; })}</div><p className="formula-note">Lines with zero arrived quantity are skipped. Tracked lines require their lot or serial identity; the server applies the configured over-receipt policy per line.</p></div>;
  if (kind === "receive") return <div className="command-form">{purchaseLineSelector}<div className="line-context"><span>{po?.lines[0]?.product}</span><strong>{po?.open ?? 0} {po?.lines[0]?.orderedUomCode ?? "units"} open to receive</strong><small>{po?.lines[0]?.specification}</small></div><div className="form-grid"><label>Arrived at dock ({po?.lines[0]?.orderedUomCode ?? "unit"})<NumberField min="1" max={purchasePolicy === "serial" ? 1 : undefined} step={po?.lines[0]?.uomFactorToBase === 1 ? "1" : "0.001"} value={quantity} onChange={setQuantity} /></label><label>Of which quarantined<NumberField min="0" step={po?.lines[0]?.uomFactorToBase === 1 ? "1" : "0.001"} max={quantity} value={secondaryQuantity} onChange={setSecondaryQuantity} /></label>{receiptPaperworkFields}{incomingIdentityFields}{quantity > (po?.open ?? 0) ? <label>Approval ID (if above tolerance)<input value={overReceiptApprovalId} onChange={(event) => setOverReceiptApprovalId(event.target.value)} placeholder="Paste the approved line-scoped request ID" /></label> : null}{usableLocationField}{secondaryQuantity > 0 ? quarantineLocationField : null}</div></div>;
  if (kind === "ship" || kind === "reserve") return <div className="command-form">{salesLineSelector}<div className="line-context"><span>{[so?.lines?.[0]?.product ?? so?.customer, so?.project].filter(Boolean).join(" · ")}</span><strong>{kind === "reserve" ? `${so?.availableNow ?? 0} available now` : `${so?.reserved ?? 0} reserved`}</strong><small>{so?.route}</small></div><label>{kind === "reserve" ? "Quantity to reserve" : "Quantity to ship"}<NumberField min="1" max={max} value={quantity} onChange={setQuantity} /></label>{kind === "ship" ? outgoingIdentityFields(salesPolicy, so?.lines?.[0]?.productId, so?.lines?.[0]?.id, so?.lines?.[0]?.reservationLocationId) : null}<div className="line-context"><span>{kind === "reserve" ? "Location selection" : "Ship-to address"}</span><strong>{kind === "reserve" ? "Best available usable location is selected at posting" : `${so?.shipToName ?? so?.customer}`}</strong><small>{kind === "reserve" ? "The committed location is recorded on the reservation." : [so?.shipToAddressLine1, so?.shipToCity, so?.shipToRegion, so?.shipToPostalCode, so?.shipToCountry].filter(Boolean).join(", ")}</small></div>{kind === "ship" ? <><label><span>Carrier{requiredMark}</span><input value={carrier} onChange={(event) => setCarrier(event.target.value)} placeholder="Required carrier" required aria-required="true" /></label><label>Service level<input value={serviceLevel} onChange={(event) => setServiceLevel(event.target.value)} placeholder="Ground, LTL, same day…" /></label><label>Tracking number<input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} placeholder="Tracking or PRO number" /></label><label>Bill of lading<input value={billOfLadingNumber} onChange={(event) => setBillOfLadingNumber(event.target.value)} placeholder="Required when no tracking number" /></label></> : null}</div>;
  if (kind === "immediate-sale") return <div className="command-form">{salesLineSelector}<div className="line-context"><span>{so?.lines?.[0]?.product ?? so?.customer}</span><strong>{so?.availableNow ?? 0} unreserved units available now</strong><small>No reservation is created. Shipment, COGS, and customer invoice post together.</small></div><label>Quantity sold now<NumberField min="1" max={max} value={quantity} onChange={setQuantity} /></label><label>Sale and invoice date<input type="date" max={localDateString()} value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} /></label>{immediateSourceLocationField}{outgoingIdentityFields(salesPolicy, so?.lines?.[0]?.productId, so?.lines?.[0]?.id, postingLocationId)}<div className="line-context"><span>Invoice handoff</span><strong>Posted immediately for {so?.customer}</strong><small>{so?.paymentTerms || "Due on receipt"} · you will be taken to Posted invoices after posting.</small></div><label>Fulfillment method<input value={carrier} onChange={(event) => setCarrier(event.target.value)} placeholder="Customer pickup" /></label><label>Reference (optional)<input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} placeholder="Receipt, pickup, or delivery reference" /></label></div>;
  if (kind === "vendor-return") return <div className="command-form">{purchaseLineSelector}<div className="line-context"><span>{po?.lines[0]?.product}</span><strong>{max} {po?.lines[0]?.orderedUomCode ?? "units"} eligible to return</strong><small>Source: {po?.number}</small></div><label>Quantity to return<NumberField min="1" step={po?.lines[0]?.uomFactorToBase === 1 ? "1" : "0.001"} max={max} value={quantity} onChange={setQuantity} /></label>{disposition !== "allowance" ? <>{vendorSourceLocationField}{outgoingIdentityFields(purchasePolicy, po?.lines[0]?.productId, undefined, postingLocationId)}</> : null}<fieldset><legend>What should happen after the vendor receives these goods?</legend>{[["replacement", "Replace the returned quantity"], ["refund", "Issue a credit; no replacement"], ["repair", "Repair and return the same unit"], ["allowance", "No physical return; issue a price allowance"]].map(([value, label]) => { const financialOnly = value === "allowance" && !canPostFinancial; return <label className={`radio-row ${financialOnly ? "disabled" : ""}`} key={value} title={financialOnly ? "A price allowance posts a vendor credit, which needs financial posting permission." : undefined}><input type="radio" name="disposition" value={value} checked={disposition === value} disabled={financialOnly} onChange={(e) => setDisposition(e.target.value)} /><span>{label}{financialOnly ? <small className="field-hint"> Needs financial posting permission.</small> : null}</span></label>; })}</fieldset><SearchableSelect label="Return reason" allowCustom value={reason} setValue={setReason} placeholder="Search or type a reason" options={vendorReturnReasons.map((label) => ({ id: label, label }))} /></div>;
  if (kind === "customer-return") return <div className="command-form">{salesLineSelector}<div className="line-context"><span>{so?.lines?.[0]?.product ?? so?.customer} · {so?.number}</span><strong>{max} {so?.lines?.[0]?.orderedUomCode ?? "units"} eligible to return</strong><small>Physical and financial decisions are reviewed separately.</small></div><label>Quantity received back<NumberField min="1" step={so?.lines?.[0]?.uomFactorToBase === 1 ? "1" : "0.001"} max={max} value={quantity} onChange={setQuantity} /></label>{outgoingIdentityFields(salesPolicy, so?.lines?.[0]?.productId, so?.lines?.[0]?.id, undefined, true)}<label>Physical disposition<select value={disposition} onChange={(e) => setDisposition(e.target.value)}><option value="quarantine">Receive into quarantine</option><option value="available">Return to available stock</option><option value="damaged">Damaged stock</option></select></label>{disposition === "available" ? usableLocationField : quarantineLocationField}<SearchableSelect label="Return reason" allowCustom value={reason} setValue={setReason} placeholder="Search or type a reason" options={customerReturnReasons.map((label) => ({ id: label, label }))} /></div>;
  if (kind === "count") { const balance = countBalances.find((item) => item.locationId === countLocationId); return <div className="command-form"><div className="line-context"><span>Cycle count</span><strong>{balance ? `${balance.warehouseName} / ${balance.locationCode}` : "No active location balance"}</strong><small>{balance ? `Book quantity ${balance.recordedQuantity} · ${balance.reservedQuantity} reserved` : "Receive inventory at an active location before counting."}</small></div><SearchableSelect label="Inventory location" value={countLocationId} setValue={setCountLocationId} options={countBalances.map((item) => ({ id: item.locationId, label: `${item.warehouseName} · ${item.locationCode} · ${item.locationName}`, detail: `${item.recordedQuantity} book` }))} /><label>Book quantity<input value={balance?.recordedQuantity ?? ""} readOnly /></label><label><span>Counted quantity{requiredMark}</span><NumberField min="0" step="0.0001" value={quantity} onChange={setQuantity} required /></label><SearchableSelect label="Variance reason" allowCustom value={reason} setValue={setReason} placeholder="Search or type a reason" options={countVarianceReasons.map((label) => ({ id: label, label }))} /></div>; }
  return <div className="command-form">{purchaseLineSelector}<div className="line-context"><span>{po?.lines[0]?.product}</span><strong>{max} eligible</strong><small>{kind === "reopen" ? `${po?.closed} closed without receipt` : kind === "reverse" ? `${po?.lines[0]?.latestReceiptReversible ?? 0} reversible on the latest receipt` : `${po?.open} open to receive`}</small></div><label>{kind === "reopen" ? "Quantity to reopen" : kind === "reverse" ? "Quantity to reverse" : "Quantity to close"}<NumberField min="1" max={max} value={quantity} onChange={setQuantity} /></label>{kind === "reopen" && <label>New expected date<input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></label>}{kind === "reverse" && <fieldset><legend>Is the reversed quantity still expected?</legend><label className="radio-row"><input type="radio" name="disposition" value="reopen" checked={disposition === "reopen"} onChange={(e) => setDisposition(e.target.value)} /><span>Yes, reopen it to receive</span></label><label className="radio-row"><input type="radio" name="disposition" value="close" checked={disposition === "close"} onChange={(e) => setDisposition(e.target.value)} /><span>No, close it without receipt</span></label></fieldset>}<SearchableSelect label="Reason" allowCustom value={reason} setValue={setReason} placeholder="Search or type a reason" options={closeReopenReasons.map((label) => ({ id: label, label }))} /></div>;
}

function ImpactPreview({ lines }: { lines: Array<{ category: string; label: string; before?: string | number; after: string | number; tone?: Severity }> }) {
  const grouped = lines.reduce<Record<string, typeof lines>>((acc, line) => { (acc[line.category] ??= []).push(line); return acc; }, {});
  return <section className="impact-preview" aria-labelledby="impact-title"><div className="impact-heading"><span aria-hidden="true">⇄</span><h3 id="impact-title">Review business impact</h3></div>{Object.entries(grouped).map(([category, categoryLines]) => <div className="impact-group" key={category}><h4>{category}</h4>{categoryLines.map((line) => <div className={`impact-line ${line.tone ?? "neutral"}`} key={line.label}><span>{line.label}</span><strong>{line.before !== undefined ? <><del>{line.before}</del><b aria-hidden="true">→</b></> : null}{line.after}</strong></div>)}</div>)}</section>;
}

function commandDefaults(kind: CommandKind, po?: PurchaseOrder, so?: SalesOrder) {
  if (kind === "receive") return { quantity: po?.lines[0]?.trackingPolicy === "serial" ? 1 : po?.open || 1, secondaryQuantity: 0, max: 0, disposition: "available" };
  if (kind === "close") return { quantity: po?.open || 1, secondaryQuantity: 0, max: po?.open || 0, disposition: "close" };
  // Both default to the whole eligible quantity, like close and receive above. The previous
  // caps of 20 and 10 were arbitrary: on a 55-unit reversal they pre-filled a wrong number that
  // still passed validation, so a mis-keyed correction posted silently.
  if (kind === "reopen") return { quantity: po?.closed || 1, secondaryQuantity: 0, max: po?.closed || 0, disposition: "reopen" };
  if (kind === "reverse") { const reversible = po?.lines[0]?.latestReceiptReversible ?? 0; return { quantity: Math.max(reversible, 1), secondaryQuantity: 0, max: reversible, disposition: "reopen" }; }
  if (kind === "vendor-return") return { quantity: 1, secondaryQuantity: 0, max: (po?.received || 0) - (po?.returned || 0), disposition: "replacement" };
  if (kind === "reserve") return { quantity: Math.max(1, Math.min(so?.availableNow || 0, (so?.open || 0) - (so?.reserved || 0))), secondaryQuantity: 0, max: Math.max(0, Math.min(so?.availableNow || 0, (so?.open || 0) - (so?.reserved || 0))), disposition: "reserve" };
  if (kind === "immediate-sale") { const max = Math.min(so?.availableNow || 0, Math.max((so?.open || 0) - (so?.reserved || 0), 0), so?.lines?.[0]?.trackingPolicy === "serial" ? 1 : Number.POSITIVE_INFINITY); return { quantity: Math.max(1, max), secondaryQuantity: 0, max: Math.max(0, max), disposition: "sale" }; }
  if (kind === "ship") { const max = so?.lines?.[0]?.trackingPolicy === "serial" ? Math.min(so?.reserved || 0, 1) : so?.reserved || 0; return { quantity: Math.max(1, max), secondaryQuantity: 0, max: Math.max(0, max), disposition: "ship" }; }
  if (kind === "customer-return") { const max = so?.lines?.[0]?.trackingPolicy === "serial" ? Math.min(Math.max((so?.shipped || 0) - (so?.returned || 0), 0), 1) : Math.max((so?.shipped || 0) - (so?.returned || 0), 0); return { quantity: 1, secondaryQuantity: 0, max, disposition: "quarantine" }; }
  if (kind === "count") return { quantity: -1, secondaryQuantity: 0, max: 0, disposition: "adjust" };
  return { quantity: 1, secondaryQuantity: 0, max: 0, disposition: "adjust" };
}

function commandTitle(kind: CommandKind) {
  return ({ receive: "Post receipt", close: "Close unfulfilled quantity", reopen: "Reopen stock-receipt quantity", reverse: "Reverse incorrect receipt", "vendor-return": "Return to vendor", reserve: "Reserve available stock", ship: "Post shipment", "immediate-sale": "Ship and invoice now", "customer-return": "Post customer return", count: "Approve inventory adjustment" } as Record<CommandKind, string>)[kind];
}

function finalCommandLabel(kind: CommandKind, quantity: number) {
  return ({ receive: `Post receipt of ${quantity}`, close: `Close ${quantity} without receipt`, reopen: `Reopen ${quantity} to receive`, reverse: `Reverse ${quantity} received units`, "vendor-return": `Post vendor return of ${quantity}`, reserve: `Reserve ${quantity} units`, ship: `Post shipment of ${quantity}`, "immediate-sale": `Ship and invoice ${quantity} now`, "customer-return": `Post customer return of ${quantity}`, count: "Approve and post inventory adjustment" } as Record<CommandKind, string>)[kind];
}

function commandImpact(kind: CommandKind, quantity: number, secondary: number, po?: PurchaseOrder, so?: SalesOrder, disposition?: string, recordedQuantity = 0) {
  if (kind === "receive") {
    // The quarantined quantity is part of what arrived, not an extra bucket beside it. Reading
    // the raw field while someone was still typing produced a projection like "goes to 35" for
    // a usable quantity that had gone negative; clamping keeps the preview inside the range the
    // form will actually accept, and submitting an over-quarantined line is refused separately.
    const quarantined = Math.min(Math.max(secondary, 0), Math.max(quantity, 0));
    return [
    { category: "Physical inventory", label: "Available inventory", before: po?.received ?? 0, after: (po?.received ?? 0) + quantity - quarantined, tone: "success" as Severity },
    { category: "Physical inventory", label: "Quarantine inventory", before: 0, after: quarantined, tone: quarantined > 0 ? "warning" as Severity : "neutral" as Severity },
    { category: "Commercial commitment", label: "PO open to receive", before: po?.open ?? 0, after: Math.max((po?.open ?? 0) - quantity, 0), tone: "info" as Severity },
    { category: "Commercial commitment", label: "Over-receipt policy", after: quantity > (po?.open ?? 0) ? `${quantity - (po?.open ?? 0)} excess · server tolerance or line-scoped approval required` : "No excess" , tone: quantity > (po?.open ?? 0) ? "warning" as Severity : "neutral" as Severity },
    { category: "Financial eligibility", label: "Quantity eligible for vendor billing", before: po?.billed ?? 0, after: (po?.billed ?? 0) + quantity },
    ];
  }
  if (kind === "close") return [{ category: "Physical inventory", label: "On-hand inventory", after: "No change" }, { category: "Commercial commitment", label: "Expected incoming", before: po?.open ?? 0, after: Math.max((po?.open ?? 0) - quantity, 0), tone: "warning" as Severity }, { category: "Commercial commitment", label: "Closed without receipt", before: po?.closed ?? 0, after: (po?.closed ?? 0) + quantity }];
  if (kind === "reopen") return [{ category: "Physical inventory", label: "On-hand inventory", after: "No change" }, { category: "Commercial commitment", label: "Expected incoming", before: po?.open ?? 0, after: (po?.open ?? 0) + quantity, tone: "info" as Severity }, { category: "Commercial commitment", label: "Closed without receipt", before: po?.closed ?? 0, after: Math.max((po?.closed ?? 0) - quantity, 0) }];
  // Reopening deliberately does not raise the commercial revision: nothing the vendor agreed to
  // has changed. It advances the optimistic-lock version only, which is not a user-facing number.
  if (kind === "reverse") return [{ category: "Physical inventory", label: "Available inventory", before: po?.received ?? 0, after: Math.max((po?.received ?? 0) - quantity, 0), tone: "danger" as Severity }, { category: "Commercial commitment", label: "Net received", before: (po?.received ?? 0) - (po?.returned ?? 0), after: Math.max((po?.received ?? 0) - (po?.returned ?? 0) - quantity, 0) }, { category: "Commercial commitment", label: disposition === "reopen" ? "Open to receive" : "Closed without receipt", before: disposition === "reopen" ? po?.open ?? 0 : po?.closed ?? 0, after: (disposition === "reopen" ? po?.open ?? 0 : po?.closed ?? 0) + quantity }];
  if (kind === "vendor-return") return disposition === "allowance" ? [{ category: "Physical inventory", label: "On-hand inventory", after: "No change" }, { category: "Commercial commitment", label: "PO fulfillment", after: "No change" }, { category: "Financial effect", label: "Vendor credit", after: "Price-only credit expected", tone: "info" as Severity }] : [{ category: "Physical inventory", label: "Internal inventory", before: (po?.received ?? 0) - (po?.returned ?? 0), after: Math.max((po?.received ?? 0) - (po?.returned ?? 0) - quantity, 0), tone: "danger" as Severity }, { category: "Commercial commitment", label: disposition === "replacement" ? "Replacement supply" : "Closed without replacement", before: 0, after: quantity, tone: disposition === "replacement" ? "info" as Severity : "warning" as Severity }, { category: "Financial effect", label: "Vendor credit expected", after: "Yes" }];
  if (kind === "reserve") return [{ category: "Physical inventory", label: "On-hand inventory", after: "No change" }, { category: "Commercial commitment", label: "Customer allocation", before: so?.reserved ?? 0, after: (so?.reserved ?? 0) + quantity, tone: "info" as Severity }, { category: "Allocations", label: "Available inventory", before: so?.availableNow ?? 0, after: Math.max((so?.availableNow ?? 0) - quantity, 0), tone: "warning" as Severity }, { category: "Financial effect", label: "Customer invoice", after: "No change" }];
  if (kind === "ship") { const invoiceable = Math.max((so?.shipped ?? 0) - (so?.invoiced ?? 0), 0); return [{ category: "Physical inventory", label: "On-hand inventory", after: `Decreases by ${quantity}`, tone: "danger" as Severity }, { category: "Commercial commitment", label: "Sales order shipped", before: so?.shipped ?? 0, after: (so?.shipped ?? 0) + quantity, tone: "success" as Severity }, { category: "Allocations", label: "Reserved to ship", before: so?.reserved ?? 0, after: Math.max((so?.reserved ?? 0) - quantity, 0) }, { category: "Financial eligibility", label: "Quantity eligible to invoice", before: invoiceable, after: invoiceable + quantity }]; }
  if (kind === "immediate-sale") return [{ category: "Physical inventory", label: "Unreserved on-hand inventory", after: `Decreases by ${quantity}`, tone: "danger" as Severity }, { category: "Commercial commitment", label: "Sales order shipped", before: so?.shipped ?? 0, after: (so?.shipped ?? 0) + quantity, tone: "success" as Severity }, { category: "Allocations", label: "Reservation records", after: "None created" }, { category: "Financial effect", label: "Customer invoice", after: "Posted immediately", tone: "success" as Severity }, { category: "Financial effect", label: "COGS", after: "Posted in the same transaction" }];
  if (kind === "customer-return") return [{ category: "Physical inventory", label: disposition === "available" ? "Available stock" : "Returns / quarantine", before: 0, after: quantity, tone: disposition === "available" ? "success" as Severity : "warning" as Severity }, { category: "Commercial commitment", label: "Replacement demand", after: "Explicit only; not automatic" }, { category: "Financial effect", label: "Customer credit", after: "Created separately after review", tone: "info" as Severity }];
  const variance = quantity - recordedQuantity;
  return [{ category: "Physical inventory", label: "Counted quantity", before: recordedQuantity, after: quantity, tone: variance < 0 ? "danger" as Severity : variance > 0 ? "success" as Severity : "neutral" as Severity }, { category: "Physical inventory", label: "Posted variance", after: `${variance > 0 ? "+" : ""}${variance}` }, { category: "Audit", label: "Linked adjustment movement", after: variance === 0 ? "Count record only; no movement" : "Will be created" }];
}

function normalizeSnapshot(input: unknown): Snapshot {
  if (!input || typeof input !== "object") return emptySnapshot;
  const raw = input as Record<string, unknown>;
  const summary = asRecord(raw.summary);
  const rawProducts = asRows(raw.products);
  const rawPurchaseOrders = asRows(raw.purchaseOrders);
  const rawSalesOrders = asRows(raw.salesOrders);

  const products: Product[] = rawProducts.map((item, index) => {
    const demand = number(item.demand);
    const usable = number(item.usable);
    const incoming = number(item.incoming);
    const available = number(item.available);
    return {
      id: text(item.id, `product-${index}`),
      sku: text(item.sku, "Unidentified product"),
      name: text(item.name, "Unnamed product"),
      specification: [text(item.dimensions), text(item.finish), text(item.material)].filter(Boolean).join(" · ") || "No configuration recorded",
      // The inventory policy is the one that varies (stocked, special order, drop ship);
      // leading with the tracking policy printed "Quantity" on nearly every product.
      policy: [titleCase(text(item.inventoryPolicy, "stocked")), text(item.trackingPolicy, "quantity") === "quantity" ? "" : `${titleCase(text(item.trackingPolicy))} tracked`].filter(Boolean).join(" · "),
      location: number(item.stockedLocationCount) > 1 ? `${text(item.primaryLocationName)} + ${number(item.stockedLocationCount) - 1} more` : text(item.primaryLocationName, "No stocked location"),
      locationCode: text(item.primaryLocationCode, "No stock"),
      onHand: number(item.onHand),
      usable,
      reserved: number(item.reserved),
      available,
      incoming,
      demand,
      projected: number(item.projected, usable + incoming - demand),
      reorderPoint: number(item.reorderPoint),
      maxStockLevel: number(item.maxStockLevel, number(item.reorderPoint)),
      reorderRuleMode: ["global", "custom"].includes(text(item.reorderRuleMode)) ? text(item.reorderRuleMode) as "global" | "custom" : "manual",
      reorderRulePercent: item.reorderRulePercent == null ? undefined : number(item.reorderRulePercent),
      inventoryPolicy: text(item.inventoryPolicy, "stocked"),
      standardCost: number(item.standardCostCents) / 100,
      lastUnitCost: item.lastUnitCostCents == null ? undefined : number(item.lastUnitCostCents) / 100,
      lastUnitCostSourcePoNumber: text(item.lastUnitCostSourcePoNumber) || undefined,
      lastUnitCostVendorName: text(item.lastUnitCostVendorName) || undefined,
      lastUnitCostAt: text(item.lastUnitCostAt) || undefined,
      sellingPrice: number(item.sellingPriceCents) / 100,
      suggestedSellingPrice: number(item.suggestedSellingPriceCents, number(item.sellingPriceCents)) / 100,
      pricingMode: text(item.pricingMode, "manual") === "automatic" ? "automatic" : "manual",
      appliedMarginRuleCode: text(item.appliedMarginRuleCode) || undefined,
      manualPriceReason: text(item.manualPriceReason) || undefined,
      baseUomId: text(item.baseUomId),
      baseUomCode: text(item.baseUomCode, "EA"),
      purchaseUomId: text(item.purchaseUomId),
      purchaseUomCode: text(item.purchaseUomCode, text(item.baseUomCode, "EA")),
      salesUomId: text(item.salesUomId),
      salesUomCode: text(item.salesUomCode, text(item.baseUomCode, "EA")),
      quantityPrecision: number(item.quantityPrecision),
      customerRef: undefined,
      version: number(item.version, 1),
      productVersion: number(item.productVersion, 1),
      manufacturerSku: text(item.manufacturerSku) || undefined,
      category: text(item.category),
      material: text(item.material),
      dimensions: text(item.dimensions),
      finish: text(item.finish),
      trackingPolicy: text(item.trackingPolicy, "quantity"),
      aliases: parseJsonRows(item.aliasesJson).map((row) => text(row.alias)).filter(Boolean),
      defaultLocations: parseJsonRows(item.defaultLocationsJson).map((row) => ({
        warehouseId: text(row.warehouseId), warehouseCode: text(row.warehouseCode), warehouseName: text(row.warehouseName),
        locationId: text(row.locationId) || undefined, locationCode: text(row.locationCode) || undefined,
        locationName: text(row.locationName) || undefined, version: row.version == null ? undefined : number(row.version),
      })),
    };
  });

  const purchaseOrders: PurchaseOrder[] = rawPurchaseOrders.map((item, index) => {
    const lines = asRows(item.lines).map((line, lineIndex): PurchaseLine => {
      const baseOrdered = number(line.orderedQuantity);
      const enteredOrdered = number(line.orderedUomQuantity, baseOrdered);
      const factor = enteredOrdered > 0 ? baseOrdered / enteredOrdered : 1;
      const supplyAllocations = parseJsonRows(line.supplyAllocationsJson).map((allocation) => ({
        id: text(allocation.id),
        salesOrderLineId: text(allocation.salesOrderLineId),
        quantity: number(allocation.quantity),
        receivedQuantity: number(allocation.receivedQuantity),
        status: text(allocation.status, "active"),
        salesOrderNumber: text(allocation.salesOrderNumber, "Sales order"),
        customerName: text(allocation.customerName, "Customer"),
      }));
      return {
      id: text(line.id, `${text(item.id)}-line-${lineIndex}`),
      productId: text(line.productId) || undefined,
      sku: text(line.sku),
      product: text(line.productName, "Unnamed product"),
      specification: configurationText(line.configurationSnapshot) || products.find((product) => product.id === text(line.productId))?.specification || "No configuration recorded",
      customerRef: supplyAllocations.length ? supplyAllocations.map((allocation) => `${allocation.salesOrderNumber} · ${allocation.customerName}`).join(", ") : text(line.sourceSalesOrderLineId) || undefined,
      sourceSalesOrderLineId: text(line.sourceSalesOrderLineId) || undefined,
      supplyAllocations,
      defaultLocations: parseJsonRows(line.defaultLocationsJson).map((row) => ({
        warehouseId: text(row.warehouseId), warehouseCode: text(row.warehouseCode), warehouseName: text(row.warehouseName),
        locationId: text(row.locationId) || undefined, locationCode: text(row.locationCode) || undefined,
        locationName: text(row.locationName) || undefined, version: row.version == null ? undefined : number(row.version),
      })),
      ordered: enteredOrdered,
      received: number(line.grossReceivedQuantity, number(line.netReceivedQuantity)) / factor,
      returned: number(line.returnedQuantity) / factor,
      fulfilled: number(line.supplierFulfilledQuantity, number(line.netReceivedQuantity)) / factor,
      latestReceiptReversible: number(line.latestReceiptReversibleQuantity) / factor,
      closed: number(line.closedWithoutReceiptQuantity) / factor,
      open: number(line.openToFulfillQuantity, number(line.openToReceiveQuantity)) / factor,
      openToReceive: number(line.openToReceiveQuantity) / factor,
      openToDeliver: number(line.openToDeliverQuantity) / factor,
      unitCost: number(line.orderedUomUnitCostCents, number(line.unitCostCents)) / 100,
      orderedUomId: text(line.orderedUomId) || undefined,
      orderedUomCode: text(line.orderedUomCode) || undefined,
      uomFactorToBase: factor,
      location: text(line.fulfillmentRoute, "stock") === "drop_ship" ? "Drop ship · no internal stock" : "Destination selected at receipt",
      fulfillmentRoute: text(line.fulfillmentRoute, "stock"),
      trackingPolicy: text(line.trackingPolicy, "quantity"),
      // Stored per line since 0012. The composer collects a discount and tax rate on every
      // purchase line and prices the order with them, so reading them back is what makes a
      // reopened draft show the same total the buyer approved.
      discountCents: number(line.discountCents),
      taxable: number(line.taxable) !== 0,
      taxRateBps: number(line.taxRateBps),
      version: number(line.version, 1),
      };
    });
    // Empty when the order has none: a fabricated date a week out read as a real promise.
    const expectedDate = text(item.expectedDate);
    const open = number(item.openToFulfillQuantity, number(item.openToReceiveQuantity));
    const fulfilled = number(item.supplierFulfilledQuantity, number(item.netReceivedQuantity));
    const closed = number(item.closedWithoutReceiptQuantity);
    const billingStatus = text(item.billingStatus, "not_billed");
    const late = expectedDate && expectedDate < localDateString() && open > 0 ? calendarDaysLate(expectedDate) : 0;
    return {
      id: text(item.id, `po-${index}`),
      number: text(item.number, "Purchase order"),
      vendorId: text(item.vendorId),
      vendor: text(item.vendorName, "Vendor"),
      lifecycle: titleCase(text(item.lifecycleStatus, "approved")),
      fulfillment: titleCase(text(item.fulfillmentStatus, "not_received")),
      // Older postings used "billed" while the rest of the application uses
      // "fully_billed". Present both as one durable business state.
      billing: titleCase(billingStatus === "billed" ? "fully_billed" : billingStatus),
      expectedDate,
      daysLate: late,
      ordered: number(item.orderedQuantity),
      received: number(item.grossReceivedQuantity || item.netReceivedQuantity),
      returned: number(item.vendorReturnedQuantity) + number(item.receiptReversedQuantity),
      fulfilled,
      closed,
      open,
      openToReceive: number(item.openToReceiveQuantity),
      openToDeliver: number(item.openToDeliverQuantity),
      billed: fulfilled,
      total: number(item.totalCents) / 100,
      currency: text(item.currency, "CAD"),
      exchangeRateToBase: number(item.exchangeRateToBase, 1),
      paymentTerms: text(item.paymentTerms) || undefined,
      dueDate: text(item.dueDate) || undefined,
      projectReference: text(item.projectReference) || undefined,
      supplierQuoteNumber: text(item.supplierQuoteNumber) || undefined,
      supplierReference: text(item.supplierReference) || undefined,
      freightCents: number(item.freightCents),
      freightTaxRateBps: number(item.freightTaxRateBps),
      feeCents: number(item.feeCents),
      feeTaxRateBps: number(item.feeTaxRateBps),
      depositCents: number(item.depositCents),
      buyer: text(item.buyerName, "Unassigned"),
      orderDate: text(item.orderDate).slice(0, 10),
      submissionNote: text(item.submissionNote) || undefined,
      // The commercial revision the vendor would recognise, not the optimistic-lock version.
      // These were the same field, so posting a receipt — which changes nothing the vendor
      // agreed to — advanced a purchase order from "Rev 1" to "Rev 2".
      revision: number(item.revisionNumber, 1),
      version: number(item.version, 1),
      latestReceiptId: text(item.latestReceiptId) || undefined,
      latestReceiptVersion: number(item.latestReceiptVersion) || undefined,
      latestReceiptNumber: text(item.latestReceiptNumber) || undefined,
      latestReceiptPostedAt: text(item.latestReceiptPostedAt) || undefined,
      latestReceiptPackingSlip: text(item.latestReceiptPackingSlip) || undefined,
      receipts: parsePurchaseReceipts(item.receiptsJson),
      supplierDeliveries: parseSupplierDeliveries(item.purchaseDeliveriesJson),
      vendorBills: parseFinancialDocuments(item.vendorBillsJson),
      settlements: parseSettlementDocuments(item.vendorSettlementsJson),
      customerRef: text(item.projectReference) || undefined,
      exception: late > 0
        ? `${open} units are ${late} days late`
        : closed > 0 ? `${closed} units closed without receipt` : undefined,
      lines,
    };
  });

  const salesOrders: SalesOrder[] = rawSalesOrders.map((item, index) => {
    const rawLines = asRows(item.lines);
    const lines: SalesLine[] = rawLines.map((line, lineIndex) => {
      const ordered = number(line.orderedQuantity);
      const enteredOrdered = number(line.orderedUomQuantity, ordered);
      const factor = enteredOrdered > 0 ? ordered / enteredOrdered : 1;
      const canceled = number(line.canceledQuantity);
      const shipped = number(line.shippedQuantity);
      const fulfilled = number(line.fulfilledQuantity, shipped);
      const returned = number(line.returnedQuantity);
      return {
        id: text(line.id, `${text(item.id)}-line-${lineIndex}`),
        productId: text(line.productId),
        sku: text(line.sku),
        product: text(line.productName, "Unnamed product"),
        ordered: enteredOrdered,
        canceled: canceled / factor,
        reserved: number(line.reservedQuantity) / factor,
        shipped: shipped / factor,
        returned: returned / factor,
        fulfilled: fulfilled / factor,
        open: Math.max(ordered - canceled - fulfilled, 0) / factor,
        unitPrice: number(line.orderedUomUnitPriceCents, number(line.unitPriceCents)) / 100,
        orderedUomId: text(line.orderedUomId) || undefined,
        orderedUomCode: text(line.orderedUomCode) || undefined,
        uomFactorToBase: factor,
        fulfillmentRoute: text(line.fulfillmentRoute, "stock"),
        trackingPolicy: text(line.trackingPolicy, "quantity"),
        reservationLocationId: text(line.reservationLocationId) || undefined,
        linkedPurchaseOrderLineId: text(line.linkedPurchaseOrderLineId) || undefined,
        linkedPurchaseOrderId: text(line.linkedPurchaseOrderId) || undefined,
        linkedPurchaseOrderNumber: text(line.linkedPurchaseOrderNumber) || undefined,
        linkedPurchaseOrderLifecycle: text(line.linkedPurchaseOrderLifecycle) || undefined,
        projectReference: text(line.projectReference) || undefined,
        discountCents: number(line.discountCents),
        taxable: number(line.taxable, 1) !== 0,
        taxRateBps: number(line.taxRateBps),
        productAvailable: number(line.productAvailableQuantity),
        productIncoming: number(line.productIncomingQuantity),
      };
    });
    const firstLine = rawLines[0];
    const open = number(item.openToFulfillQuantity, number(item.openToShipQuantity));
    // Availability now comes from the server, which sees every line and the whole catalog. The
    // old first-line-and-current-page guess reported "0 available" for every order on any view
    // that ships no products, so the entire sales worklist read as short.
    const { availableNow, incomingBeforeDate, shortage } = calculateSalesAvailability(
      open,
      number(item.reservedQuantity),
      number(item.availableNowQuantity),
      number(item.incomingSupplyQuantity),
    );
    return {
      id: text(item.id, `so-${index}`),
      number: text(item.number, "Sales order"),
      customerId: text(item.customerId),
      customer: text(item.customerName, "Unnamed customer"),
      // Left empty when the order has no project reference rather than carrying placeholder
      // prose. As a default it printed "No project reference" on every row of a 1,300-row
      // worklist, and reopening such a draft in the composer saved that sentence as the
      // order's actual project reference.
      project: text(item.projectReference),
      requestedDate: text(item.requestedDate),
      lifecycle: titleCase(text(item.lifecycleStatus, "confirmed")),
      fulfillment: titleCase(text(item.fulfillmentStatus, "unreserved")),
      billing: titleCase(text(item.billingStatus, "not_invoiced")),
      ordered: number(item.orderedQuantity),
      reserved: number(item.reservedQuantity),
      shipped: number(item.shippedQuantity),
      returned: number(item.returnedQuantity),
      fulfilled: number(item.fulfilledQuantity, number(item.shippedQuantity)),
      invoiced: number(item.invoicedQuantity),
      open,
      openToShip: number(item.openToShipQuantity),
      openToDeliver: number(item.openToDeliverQuantity),
      availableNow,
      incomingBeforeDate,
      shortage,
      total: number(item.totalCents) / 100,
      currency: text(item.currency, "CAD"),
      exchangeRateToBase: number(item.exchangeRateToBase, 1),
      paymentTerms: text(item.paymentTerms) || undefined,
      dueDate: text(item.dueDate) || undefined,
      freightCents: number(item.freightCents),
      freightTaxRateBps: number(item.freightTaxRateBps),
      feeCents: number(item.feeCents),
      feeTaxRateBps: number(item.feeTaxRateBps),
      depositCents: number(item.depositCents),
      shipToName: text(item.shipToName) || undefined,
      shipToAddressLine1: text(item.shipToAddressLine1) || undefined,
      shipToAddressLine2: text(item.shipToAddressLine2) || undefined,
      shipToCity: text(item.shipToCity) || undefined,
      shipToRegion: text(item.shipToRegion) || undefined,
      shipToPostalCode: text(item.shipToPostalCode) || undefined,
      shipToCountry: text(item.shipToCountry) || undefined,
      deliveryInstructions: text(item.deliveryInstructions) || undefined,
      route: titleCase(text(firstLine?.fulfillmentRoute, "stock")),
      linkedPo: text(firstLine?.linkedPurchaseOrderNumber) || undefined,
      exception: shortage > 0 ? `${shortage} unit${shortage === 1 ? "" : "s"} short for requested date` : undefined,
      orderDate: text(item.orderDate).slice(0, 10),
      owner: text(item.ownerName, "Unassigned"),
      shipments: parseShipments(item.shipmentsJson),
      supplierDeliveries: parseSupplierDeliveries(item.salesDeliveriesJson),
      invoices: parseFinancialDocuments(item.customerInvoicesJson),
      settlements: parseSettlementDocuments(item.customerSettlementsJson),
      version: number(item.version, 1),
      lines,
    };
  });

  const movements: Movement[] = asRows(raw.movements).map((item, index) => ({
    id: text(item.id, `movement-${index}`),
    time: displayTimestamp(text(item.postedAt)),
    type: titleCase(text(item.type, "stock_movement")),
    // Prefer the document's own number; the raw id is a fallback for movement types that have
    // no numbered parent document, and it is never the first thing a reader sees.
    document: text(item.sourceDocumentNumber) || text(item.sourceDocumentId || item.sourceDocumentType, "Source document"),
    documentType: titleCase(text(item.sourceDocumentType, "movement")),
    relatedOrderNumber: text(item.relatedOrderNumber) || undefined,
    relatedOrderId: text(item.relatedOrderId) || undefined,
    relatedOrderKind: text(item.relatedOrderKind) === "purchase" ? "purchase" as const : text(item.relatedOrderKind) === "sales" ? "sales" as const : undefined,
    product: text(item.sku, text(item.productName)),
    quantity: number(item.quantity),
    from: text(item.fromLocationCode) || movementCounterparty(text(item.type), "from"),
    to: text(item.toLocationCode) || movementCounterparty(text(item.type), "to"),
    user: text(item.postedBy, "System"),
  }));

  const bills: Bill[] = asRows(raw.bills).map((item, index) => {
    const isException = text(item.matchStatus) !== "matched";
    const outstanding = number(item.outstandingCents) / 100;
    const rawStatus = text(item.status, "draft");
    return {
      id: text(item.id, `bill-${index}`),
      number: text(item.number, "Vendor bill"),
      vendor: text(item.vendorName, "Vendor"),
      po: text(item.purchaseOrderNumber, "Unlinked"),
      purchaseOrderId: text(item.purchaseOrderId) || undefined,
      receivedValue: number(item.authorizedLineValueCents) / 100,
      billedValue: number(item.billedLineValueCents) / 100,
      variance: (number(item.billedLineValueCents) - number(item.authorizedLineValueCents)) / 100,
      currency: text(item.currency, "CAD"),
      status: titleCase(text(item.matchStatus, text(item.status, "draft"))),
      settlementStatus: rawStatus === "on_hold" ? "On hold" : outstanding <= 0 ? "Settled" : rawStatus === "partially_paid" ? "Partially paid" : rawStatus === "draft" ? "Draft" : "Outstanding",
      vendorInvoiceNumber: text(item.vendorInvoiceNumber) || undefined,
      invoiceDate: text(item.invoiceDate),
      dueDate: text(item.dueDate),
      subtotal: number(item.subtotalCents) / 100,
      tax: number(item.taxCents) / 100,
      total: number(item.totalCents) / 100,
      paid: number(item.paidCents) / 100,
      outstanding,
      paymentTerms: text(item.paymentTerms) || undefined,
      holdReason: humanHoldReason(item.holdReason),
      reason: isException ? "Price or quantity differs from the authorized PO and posted receipt." : undefined,
    };
  });

  const activities: Activity[] = asRows(raw.activities).map((item, index) => {
    const action = titleCase(text(item.action, "Activity"));
    return {
      id: text(item.id, `activity-${index}`),
      time: displayTimestamp(text(item.createdAt)),
      title: `${actorName(text(item.actor, "System"))} · ${action}`,
      detail: text(item.summary, "Operational record updated."),
      tone: action.toLowerCase().includes("posted") ? "success" : action.toLowerCase().includes("closed") ? "warning" : "info",
    };
  });

  const partners: Partner[] = asRows(raw.partners).map((item, index) => {
    const kind = text(item.partnerType).toLowerCase();
    return {
      id: text(item.id, `partner-${index}`),
      code: text(item.code, "—"),
      version: number(item.version, 1),
      paymentTerms: text(item.paymentTerms) || undefined,
      currency: text(item.currency, "CAD"),
      name: text(item.name, "Business partner"),
      type: kind === "both" ? "both" : kind.includes("vendor") ? "vendor" : "customer",
      email: text(item.email) || undefined,
      phone: text(item.phone) || undefined,
      addressLine1: text(item.addressLine1) || undefined,
      addressLine2: text(item.addressLine2) || undefined,
      city: text(item.city) || undefined,
      region: text(item.region) || undefined,
      postalCode: text(item.postalCode) || undefined,
      country: text(item.country, "CA"),
      creditLimitCents: number(item.creditLimitCents),
      creditHold: number(item.creditHold) !== 0,
    };
  });

  const inventoryBalances: InventoryLocationBalance[] = asRows(raw.inventoryBalances).map((item) => ({
    productId: text(item.productId),
    locationId: text(item.locationId),
    recordedQuantity: number(item.recordedQuantity),
    reservedQuantity: number(item.reservedQuantity),
    version: number(item.version),
    locationCode: text(item.locationCode),
    locationName: text(item.locationName),
    warehouseName: text(item.warehouseName, text(item.warehouseCode)),
  })).filter((item) => item.productId && item.locationId && item.version > 0);

  const countBalances: CountBalance[] = asRows(raw.countBalances).map((item) => ({
    productId: text(item.productId),
    locationId: text(item.locationId),
    recordedQuantity: number(item.recordedQuantity),
    reservedQuantity: number(item.reservedQuantity),
    version: number(item.version),
    locationCode: text(item.locationCode),
    locationName: text(item.locationName),
    warehouseName: text(item.warehouseName, text(item.warehouseCode)),
    sku: text(item.sku),
    productName: text(item.productName, "Unnamed product"),
  })).filter((item) => item.productId && item.locationId && item.version > 0);

  const locations: LocationOption[] = asRows(raw.locations).map((item) => ({
    id: text(item.id),
    code: text(item.code),
    name: text(item.name),
    warehouseId: text(item.warehouseId),
    warehouseName: text(item.warehouseName, "Warehouse"),
    inventoryStatus: text(item.inventoryStatus),
    locationType: text(item.locationType),
  })).filter((item) => item.id && item.code);

  return {
    summary: {
      lateReceipts: number(summary.latePurchaseOrders, purchaseOrders.filter((po) => po.daysLate > 0).length),
      approvals: number(summary.pendingApprovals, purchaseOrders.filter((po) => po.lifecycle.toLowerCase().includes("pending")).length),
      blockedSales: number(summary.blockedSalesOrders, salesOrders.filter((so) => so.shortage > 0).length),
      dueReceipts: number(summary.openPurchaseOrders, purchaseOrders.filter((po) => po.open > 0).length),
      readyToShip: number(summary.readyToShip, salesOrders.filter((so) => so.reserved > 0).length),
      onHand: number(summary.onHand),
      usable: number(summary.usable),
      reserved: number(summary.reserved),
      available: number(summary.available),
      incoming: number(summary.incoming),
      openDemand: number(summary.openDemand),
      openReceiptUnits: number(summary.openReceiptUnits),
      readyToShipUnits: number(summary.readyToShipUnits),
      inventoryRisks: number(summary.inventoryRiskCount),
      matchExceptions: number(summary.matchExceptions),
      specialOrderInventory: number(summary.specialOrderInventoryCount),
      countableBalances: number(summary.countableBalanceCount),
      receivingBalances: number(summary.receivingBalanceCount),
      orphanedBalanceRows: number(summary.orphanedBalanceRows),
      orphanedBalanceUnits: number(summary.orphanedBalanceUnits),
      orphanedMovementCount: number(summary.orphanedMovementCount),
      orphanedInventoryValueCents: number(summary.orphanedInventoryValueCents),
    },
    purchaseOrders,
    products,
    inventoryBalances,
    countBalances,
    salesOrders,
    movements,
    bills,
    activities,
    partners,
    locations,
    configuration: { taxDefaultRateBps: number(asRecord(raw.configuration).taxDefaultRateBps, 500), reorderPointPercent: number(asRecord(raw.configuration).reorderPointPercent, 70) },
    viewer: {
      name: text(asRecord(raw.viewer).name),
      email: text(asRecord(raw.viewer).email),
      role: text(asRecord(raw.viewer).role),
      tenant: {
        id: text(asRecord(asRecord(raw.viewer).tenant).id),
        slug: text(asRecord(asRecord(raw.viewer).tenant).slug),
        name: text(asRecord(asRecord(raw.viewer).tenant).name),
      },
      tenants: asRows(asRecord(raw.viewer).tenants).map((tenant) => ({
        id: text(tenant.id), slug: text(tenant.slug), name: text(tenant.name), role: text(tenant.role), isDefault: tenant.isDefault === true,
      })),
      permissions: {
        canRead: asRecord(asRecord(raw.viewer).permissions).canRead === true,
        canExport: asRecord(asRecord(raw.viewer).permissions).canExport === true,
        canOperate: asRecord(asRecord(raw.viewer).permissions).canOperate === true,
        canPostFinancial: asRecord(asRecord(raw.viewer).permissions).canPostFinancial === true,
        canApprove: asRecord(asRecord(raw.viewer).permissions).canApprove === true,
        canAdminister: asRecord(asRecord(raw.viewer).permissions).canAdminister === true,
      },
    },
    pagination: {
      page: number(asRecord(raw.pagination).page, 1),
      pageSize: number(asRecord(raw.pagination).pageSize, 50),
      filteredTotal: asRecord(raw.pagination).filteredTotal == null ? null : number(asRecord(raw.pagination).filteredTotal),
      totals: Object.fromEntries(Object.entries(asRecord(asRecord(raw.pagination).totals)).map(([key, value]) => [key, number(value)])),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function parseJsonRows(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== "string") return asRows(value);
  try { return asRows(JSON.parse(value) as unknown); }
  catch { return []; }
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function humanHoldReason(value: unknown) {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const reasons = asRows(parsed).map((reason) => text(reason.message) || titleCase(text(reason.code).toLowerCase())).filter(Boolean);
    if (reasons.length) return reasons.join(" · ");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const reason = parsed as Record<string, unknown>;
      return text(reason.message) || titleCase(text(reason.code).toLowerCase()) || raw;
    }
  } catch { /* Legacy rows may already contain operator-facing prose. */ }
  return raw;
}

/** Shipments arrive as a JSON array built by the snapshot query rather than a joined child row. */
function parseShipments(value: unknown): ShipmentRecord[] {
  const rows = typeof value === "string" ? (() => { try { return JSON.parse(value) as unknown; } catch { return []; } })() : value;
  return asRows(rows).map((row) => ({
    number: text(row.number, "Shipment"),
    postedAt: text(row.postedAt),
    status: titleCase(text(row.status, "posted")),
    carrier: text(row.carrier),
    serviceLevel: text(row.serviceLevel),
    trackingNumber: text(row.trackingNumber),
    billOfLadingNumber: text(row.billOfLadingNumber),
  }));
}

function parsePurchaseReceipts(value: unknown): PurchaseReceiptRecord[] {
  return parseJsonRows(value).map((row) => ({
    id: text(row.id),
    number: text(row.number, "Receipt"),
    postedAt: text(row.postedAt),
    status: titleCase(text(row.status, "posted")),
    packingSlipNumber: text(row.packingSlipNumber) || undefined,
    quantity: number(row.quantity),
  }));
}

function parseSupplierDeliveries(value: unknown): SupplierDeliveryRecord[] {
  return parseJsonRows(value).map((row) => ({
    id: text(row.id),
    number: text(row.number, "Supplier delivery"),
    postedAt: text(row.postedAt),
    deliveryDate: text(row.deliveryDate),
    status: titleCase(text(row.status, "posted")),
    externalReference: text(row.externalReference) || undefined,
    quantity: number(row.quantity),
  }));
}

function parseFinancialDocuments(value: unknown): FinancialDocumentRecord[] {
  return parseJsonRows(value).map((row) => {
    const amount = number(row.amountCents) / 100;
    const paid = number(row.paidCents) / 100;
    const credited = number(row.creditedCents) / 100;
    return {
      id: text(row.id),
      number: text(row.number, "Financial document"),
      status: titleCase(text(row.status, "posted")),
      matchStatus: text(row.matchStatus) ? titleCase(text(row.matchStatus)) : undefined,
      issuedOn: text(row.issuedOn),
      dueOn: text(row.dueOn) || undefined,
      amount,
      paid,
      credited,
      outstanding: Math.max(amount - paid - credited, 0),
      currency: text(row.currency, "CAD"),
      externalReference: text(row.externalReference) || undefined,
    };
  });
}

function parseSettlementDocuments(value: unknown): SettlementDocumentRecord[] {
  return parseJsonRows(value).map((row) => ({
    id: text(row.id),
    number: text(row.number, "Settlement"),
    kind: text(row.kind) === "credit" ? "credit" : "payment",
    postedAt: text(row.postedAt),
    amount: number(row.amountCents) / 100,
    currency: text(row.currency, "CAD"),
    appliedTo: text(row.appliedTo) || undefined,
  }));
}

function configurationText(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return Object.values(parsed).filter((item) => typeof item === "string" || typeof item === "number").join(" · ");
    } catch {
      return value;
    }
  }
  return "";
}

function calendarDaysLate(value: string) {
  const expected = new Date(`${value}T12:00:00`).getTime();
  if (!Number.isFinite(expected)) return 0;
  return Math.max(0, Math.floor((Date.now() - expected) / 86_400_000));
}

function displayTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value || "Recently";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed);
}


/**
 * Each row already promised a destination with its arrow; now it actually goes there. Dismiss
 * is a sibling button rather than nested inside the row, because a button inside a button is
 * invalid markup and the inner click never reaches its own handler.
 */
function NotificationItem({ tone, title, detail, onOpen, onDismiss }: { tone: Severity; title: string; detail: string; onOpen: () => void; onDismiss: () => void }) {
  return <div className="notification-row">
    <button className="notification-item" onClick={onOpen}><span className={`timeline-dot ${tone}`} /><div><strong>{title}</strong><p>{detail}</p></div><b aria-hidden="true">→</b></button>
    <button className="notification-dismiss" onClick={onDismiss} aria-label={`Dismiss: ${title}`} title="Dismiss">×</button>
  </div>;
}

function LoadingState() {
  return <div className="loading-state" role="status"><div className="loading-bar" /><div className="loading-grid"><div /><div /><div /><div /></div><span className="sr-only">Loading operations workspace</span></div>;
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : compactDate.format(date);
}
