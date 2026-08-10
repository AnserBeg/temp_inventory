"use client";

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { OperationsWorkspace } from "./components/operations-suite";
import { PAYMENT_TERMS, QuickCreateDialog, RemoteSearchSelect, SearchableSelect, type LookupKind, type QuickCreateKind } from "./components/reference-picker";
import { inventoryCountApprovalPayload, workflowSnapshotParts } from "@/lib/domain/workflow-envelope";

type Severity = "neutral" | "info" | "success" | "warning" | "danger";

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
  closed: number;
  open: number;
  unitCost: number;
  orderedUomId?: string;
  orderedUomCode?: string;
  uomFactorToBase: number;
  location: string;
  fulfillmentRoute?: string;
  sourceSalesOrderLineId?: string;
  discountCents: number;
  taxable: boolean;
  taxRateBps: number;
  version: number;
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
  open: number;
  unitPrice: number;
  orderedUomId?: string;
  orderedUomCode?: string;
  uomFactorToBase: number;
  fulfillmentRoute: string;
  linkedPurchaseOrderLineId?: string;
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
  closed: number;
  open: number;
  billed: number;
  total: number;
  currency: string;
  exchangeRateToBase: number;
  paymentTerms?: string;
  dueDate?: string;
  projectReference?: string;
  freightCents: number;
  freightTaxRateBps: number;
  feeCents: number;
  feeTaxRateBps: number;
  depositCents: number;
  buyer: string;
  revision: number;
  version: number;
  latestReceiptId?: string;
  latestReceiptVersion?: number;
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
  inventoryPolicy: string;
  standardCost: number;
  sellingPrice: number;
  baseUomId: string;
  baseUomCode: string;
  purchaseUomId: string;
  purchaseUomCode: string;
  salesUomId: string;
  salesUomCode: string;
  quantityPrecision: number;
  customerRef?: string;
  version?: number;
};

type LocationOption = {
  id: string;
  code: string;
  name: string;
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
  invoiced?: number;
  open: number;
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
  version: number;
  lines?: SalesLine[];
};

type Movement = {
  id: string;
  time: string;
  type: string;
  document: string;
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
  receivedValue: number;
  billedValue: number;
  variance: number;
  currency: string;
  status: string;
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
    orphanedBalanceRows: number;
    orphanedBalanceUnits: number;
    orphanedMovementCount: number;
    orphanedInventoryValueCents: number;
  };
  purchaseOrders: PurchaseOrder[];
  products: Product[];
  inventoryBalances: InventoryLocationBalance[];
  salesOrders: SalesOrder[];
  movements: Movement[];
  bills: Bill[];
  activities: Activity[];
  partners: Partner[];
  locations: LocationOption[];
  configuration: { taxDefaultRateBps: number };
  viewer: {
    name: string;
    email: string;
    role: string;
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
  summary: { lateReceipts: 0, approvals: 0, blockedSales: 0, dueReceipts: 0, readyToShip: 0, onHand: 0, usable: 0, reserved: 0, available: 0, incoming: 0, openDemand: 0, openReceiptUnits: 0, readyToShipUnits: 0, inventoryRisks: 0, matchExceptions: 0, specialOrderInventory: 0, countableBalances: 0, orphanedBalanceRows: 0, orphanedBalanceUnits: 0, orphanedMovementCount: 0, orphanedInventoryValueCents: 0 },
  purchaseOrders: [],
  products: [],
  inventoryBalances: [],
  salesOrders: [],
  movements: [],
  bills: [],
  activities: [],
  partners: [],
  locations: [],
  configuration: { taxDefaultRateBps: 500 },
  viewer: { name: "", email: "", role: "", permissions: { canRead: false, canExport: false, canOperate: false, canPostFinancial: false, canApprove: false, canAdminister: false } },
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
  linkedPurchaseOrderLineId: string;
};

type ViewKey =
  | "home"
  | "purchase-orders"
  | "expected-receipts"
  | "vendor-returns"
  | "sales-orders"
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
};

type CommandKind =
  | "receive"
  | "close"
  | "reopen"
  | "reverse"
  | "vendor-return"
  | "reserve"
  | "ship"
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

function futureDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function dueDateForTerms(baseDate: string, terms: string) {
  const days = terms === "Due on receipt" ? 0 : Number(/^Net (\d+)$/.exec(terms)?.[1] ?? 0);
  const date = new Date(`${baseDate}T12:00:00Z`);
  if (Number.isNaN(date.valueOf())) return baseDate;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}


const navGroups: Array<{ label?: string; items: Array<{ key: ViewKey; label: string; glyph: string }> }> = [
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
      { key: "counts", label: "Counts", glyph: "#" },
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
      { key: "partners", label: "Partners", glyph: "◎" },
      { key: "reports", label: "Reports", glyph: "▥" },
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
  fulfillment: { title: "Ready to fulfill" },
  "customer-returns": { title: "Customer returns" },
  stock: { title: "Inventory" },
  movements: { title: "Movement history" },
  counts: { title: "Inventory counts" },
  "vendor-bills": { title: "Vendor bills" },
  "customer-invoices": { title: "Customer invoices" },
  products: { title: "Product catalog" },
  partners: { title: "Partners" },
  reports: { title: "Operational reports" },
  warehouse: { title: "Warehouse mode" },
};

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
  "customer-invoices": "sales orders", stock: "products", products: "products", counts: "products",
  movements: "movements", "vendor-bills": "vendor bills", partners: "customers and vendors",
};

/** Worklist views that should open pre-filtered to the queue they exist to clear. */
const defaultWorklistStatus: Partial<Record<ViewKey, string>> = {
  "expected-receipts": "open",
  fulfillment: "reserved",
  "vendor-returns": "returnable",
  "customer-returns": "shipped",
};

export function InventoryApp() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [view, setView] = useState<ViewKey>("home");
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [selectedSoId, setSelectedSoId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);
  const [editingPartner, setEditingPartner] = useState<Partner | "new" | null>(null);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [activeCommand, setActiveCommand] = useState<ActiveCommand | null>(null);
  const [createOrder, setCreateOrder] = useState<"purchaseOrder" | "salesOrder" | null>(null);
  const [editingPurchaseOrder, setEditingPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [editingSalesOrder, setEditingSalesOrder] = useState<SalesOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"loading" | "server" | "unavailable">("loading");
  const [sourceError, setSourceError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState("overview");
  const [workflowRefreshToken, setWorkflowRefreshToken] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [worklistQuery, setWorklistQuery] = useState("");
  const [appliedWorklistQuery, setAppliedWorklistQuery] = useState("");
  const [worklistStatus, setWorklistStatus] = useState("");
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

  const loadSnapshot = useCallback(async () => {
    const generation = ++snapshotLoadGeneration.current;
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "50", scope: view, worklistQuery: appliedWorklistQuery, status: worklistStatus, sort: worklistSort, warehouseId });
      const response = await fetch(`/api/snapshot?${params}`, { cache: "no-store" });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(text(asRecord(data.error).message, "Snapshot unavailable"));
      if (generation !== snapshotLoadGeneration.current) return;
      const normalized = normalizeSnapshot(data);
      setSnapshot(normalized);
      setSource("server");
      setSourceError("");
      setLastUpdatedAt(new Date());
    } catch (caught) {
      if (generation !== snapshotLoadGeneration.current) return;
      setSource("unavailable");
      setSourceError(caught instanceof Error ? caught.message : "The operations service could not be reached.");
    } finally {
      if (generation === snapshotLoadGeneration.current) setLoading(false);
    }
  }, [appliedWorklistQuery, page, view, warehouseId, worklistSort, worklistStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(1); setAppliedWorklistQuery(worklistQuery.trim()); }, 220);
    return () => window.clearTimeout(timer);
  }, [worklistQuery]);

  useEffect(() => {
    const stored = window.localStorage.getItem("paneflow.warehouse") ?? "";
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
        if (stored && rows.some((row) => row.id === stored)) setWarehouseId(stored);
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) setWarehouseLookupError(caught instanceof Error ? caught.message : "Warehouse scope could not be loaded.");
      }
    })();
    return () => controller.abort();
  }, [warehouseLookupRefresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requested = new URLSearchParams(window.location.search).get("view") as ViewKey | null;
      const requestedTab = new URLSearchParams(window.location.search).get("tab") ?? "overview";
      const initial = requested && viewTitles[requested] ? requested : "home";
      setView(initial);
      setWorkspaceTab(requestedTab);
      setWorklistStatus(defaultWorklistStatus[initial] ?? "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSnapshot(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSnapshot]);

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
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      } else if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      } else if (event.key === "Escape") {
        setSearchOpen(false);
        setNotificationsOpen(false);
        setAccountOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const navigate = (next: ViewKey, status?: string, tab = "overview") => {
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
    window.history.pushState({}, "", url);
    document.getElementById("main-content")?.focus();
  };
  const changeWorkspaceTab = (tab: string) => {
    setWorkspaceTab(tab);
    const url = new URL(window.location.href);
    if (tab === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url);
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
    stock: "products", products: "products", partners: "partners", counts: "products", movements: "movements", reports: "products", "vendor-bills": "bills",
  };
  const pageTotal = snapshot.pagination.filteredTotal ?? snapshot.pagination.totals[pageTotalKey[view] ?? ""] ?? 0;
  const pageCount = Math.max(1, Math.ceil(pageTotal / snapshot.pagination.pageSize));

  const localSearchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return [
      ...snapshot.purchaseOrders
        .filter((item) => `${item.number} ${item.vendor} ${item.customerRef ?? ""}`.toLowerCase().includes(term))
        .map((item) => ({ type: "Purchase order", id: item.id, label: item.number, detail: item.vendor, view: "purchase-orders" as ViewKey, page })),
      ...snapshot.salesOrders
        .filter((item) => `${item.number} ${item.customer} ${item.project}`.toLowerCase().includes(term))
        .map((item) => ({ type: "Sales order", id: item.id, label: item.number, detail: `${item.customer} · ${item.project}`, view: "sales-orders" as ViewKey, page })),
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
        setSearchResults([
          ...asRows(raw.purchaseOrders).map((item) => ({ type: "Purchase order", id: text(item.id), label: text(item.number), detail: text(item.vendorName), view: "purchase-orders" as ViewKey, page: number(item.page, 1) })),
          ...asRows(raw.salesOrders).map((item) => ({ type: "Sales order", id: text(item.id), label: text(item.number), detail: [text(item.customerName), text(item.projectReference)].filter(Boolean).join(" · "), view: "sales-orders" as ViewKey, page: number(item.page, 1) })),
          ...asRows(raw.products).map((item) => ({ type: "Product / unit", id: text(item.id), label: text(item.sku), detail: text(item.name), view: "stock" as ViewKey, page: number(item.page, 1) })),
          ...asRows(raw.partners).map((item) => ({ type: "Business partner", id: text(item.id), label: text(item.name), detail: [text(item.code), titleCase(text(item.partnerType))].filter(Boolean).join(" · "), view: "partners" as ViewKey, page: number(item.page, 1) })),
        ].slice(0, 10));
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
      replacementExpected: payload.disposition === "replacement",
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
    const result = (await response.json()) as { snapshot?: unknown; message?: string; error?: string | { code?: string; message?: string; currentVersion?: number } };
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
    const response = await fetch("/api/workflows?page=1&pageSize=100", { cache: "no-store" });
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
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ command: type === "purchaseOrder" ? "createPurchaseOrderDraft" : "createSalesOrderDraft", payload, idempotencyKey }),
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
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`} aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <div><strong>PaneFlow</strong><small>Operations</small></div>
        </div>
        <nav className="nav-groups">
          {navGroups.map((group, index) => (
            <div className="nav-group" key={group.label ?? index}>
              {group.label && <p className="nav-label">{group.label}</p>}
              {group.items.map((item) => (
                <button
                  key={item.key}
                  className={`nav-item ${view === item.key ? "active" : ""}`}
                  onClick={() => navigate(item.key)}
                  aria-current={view === item.key ? "page" : undefined}
                >
                  <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>
                  <span>{item.label}</span>
                  {item.key === "expected-receipts" && snapshot.summary.lateReceipts > 0 && <span className="nav-count">{snapshot.summary.lateReceipts}</span>}
                  {item.key === "vendor-bills" && snapshot.summary.matchExceptions > 0 && <span className="nav-dot" aria-label="Exceptions present" />}
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
          <button className="global-search" onClick={() => { setSearchOpen(true); requestAnimationFrame(() => searchRef.current?.focus()); }}>
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
        {accountOpen && <section className="popover account-panel" aria-label="Account menu"><div className="account-summary"><div className="user-avatar" aria-hidden="true">{initials(snapshot.viewer.name)}</div><div><strong>{snapshot.viewer.name}</strong><small>{snapshot.viewer.email}</small><span>{titleCase(snapshot.viewer.role)}</span></div></div><a className="button secondary" href="/signout-with-chatgpt?return_to=%2F">Sign out</a></section>}

        <main id="main-content" tabIndex={-1} className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow-row"><span className={`connection ${source}`}>{source === "server" ? "Connected" : source === "loading" ? "Connecting" : "Connection interrupted"}</span><span>{lastUpdatedAt ? `Last updated ${lastUpdatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "No successful refresh yet"}</span></div>
              <h1>{viewTitles[view].title}</h1>
              {viewTitles[view].description ? <p>{viewTitles[view].description}</p> : null}
            </div>
            <PageActions view={view} source={source} canOperate={snapshot.viewer.permissions.canOperate} canApprove={snapshot.viewer.permissions.canApprove} onNavigate={navigate} onCreate={setCreateOrder} onCreatePartner={() => setEditingPartner("new")} onCreateProduct={() => setCreatingProduct(true)} />
          </div>
          {source === "unavailable" ? <div className="connection-error" role="alert"><div><strong>Couldn&apos;t refresh operations data.</strong><p>{sourceError || "The last successfully loaded records remain on screen; no sample data was substituted."}</p></div><button className="button secondary" onClick={() => void loadSnapshot()}>Retry</button></div> : null}
          {warehouseLookupError ? <div className="connection-error" role="alert"><div><strong>Warehouse scope unavailable.</strong><p>{warehouseLookupError} Company-wide records remain visible.</p></div><button className="button secondary" onClick={() => setWarehouseLookupRefresh((current) => current + 1)}>Retry</button></div> : null}
          {pageTotalKey[view] ? <ServerWorklistControls view={view} query={worklistQuery} setQuery={setWorklistQuery} status={worklistStatus} setStatus={(value) => { setPage(1); setWorklistStatus(value); }} sort={worklistSort} setSort={(value) => { setPage(1); setWorklistSort(value); }} total={pageTotal} /> : null}

          {loading ? <LoadingState /> : (
            <>
              {view === "home" && <Dashboard snapshot={snapshot} navigate={navigate} openPo={setSelectedPoId} />}
              {view === "purchase-orders" && (
                <OperationsWorkspace workspace="purchasing" initialTab={workspaceTab} onTabChange={changeWorkspaceTab} onDurableRefresh={loadSnapshot} refreshToken={workflowRefreshToken} onCreateOrder={() => setCreateOrder("purchaseOrder")}>
                {selectedPo ? (
                  <PurchaseOrderDetail po={selectedPo} canOperate={snapshot.viewer.permissions.canOperate} onBack={() => setSelectedPoId(null)} onEdit={() => setEditingPurchaseOrder(selectedPo)} onCommand={(kind) => setActiveCommand({ kind, entityId: selectedPo.id, entityNumber: selectedPo.number })} onSubmitForApproval={(reason) => activateDraft("submitPurchaseOrder", selectedPo.id, selectedPo.version, reason, `${selectedPo.number} submitted for approval.`)} />
                ) : (
                  <PurchaseOrdersView orders={snapshot.purchaseOrders} canOperate={snapshot.viewer.permissions.canOperate} onOpen={setSelectedPoId} onReceive={(po) => setActiveCommand({ kind: "receive", entityId: po.id, entityNumber: po.number })} />
                )}
                </OperationsWorkspace>
              )}
              {view === "expected-receipts" && (
                selectedPo ? (
                  <PurchaseOrderDetail po={selectedPo} canOperate={snapshot.viewer.permissions.canOperate} onBack={() => setSelectedPoId(null)} onEdit={() => setEditingPurchaseOrder(selectedPo)} onCommand={(kind) => setActiveCommand({ kind, entityId: selectedPo.id, entityNumber: selectedPo.number })} onSubmitForApproval={(reason) => activateDraft("submitPurchaseOrder", selectedPo.id, selectedPo.version, reason, `${selectedPo.number} submitted for approval.`)} />
                ) : (
                  <PurchaseOrdersView orders={snapshot.purchaseOrders} canOperate={snapshot.viewer.permissions.canOperate} onOpen={setSelectedPoId} onReceive={(po) => setActiveCommand({ kind: "receive", entityId: po.id, entityNumber: po.number })} />
                )
              )}
              {view === "vendor-returns" && <VendorReturnsView orders={snapshot.purchaseOrders} canOperate={snapshot.viewer.permissions.canOperate} onReturn={(po) => setActiveCommand({ kind: "vendor-return", entityId: po.id, entityNumber: po.number })} />}
              {view === "sales-orders" && (
                <OperationsWorkspace workspace="sales" initialTab={workspaceTab} onTabChange={changeWorkspaceTab} onDurableRefresh={loadSnapshot} refreshToken={workflowRefreshToken} onCreateOrder={() => setCreateOrder("salesOrder")}>
                {selectedSo ? (
                  <SalesOrderDetail so={selectedSo} canOperate={snapshot.viewer.permissions.canOperate} onBack={() => setSelectedSoId(null)} onEdit={() => setEditingSalesOrder(selectedSo)} onReserve={() => setActiveCommand({ kind: "reserve", entityId: selectedSo.id, entityNumber: selectedSo.number })} onShip={() => setActiveCommand({ kind: "ship", entityId: selectedSo.id, entityNumber: selectedSo.number })} onConfirm={(reason) => activateDraft("confirmSalesOrder", selectedSo.id, selectedSo.version, reason, `${selectedSo.number} confirmed.`)} />
                ) : (
                  <SalesOrdersView orders={snapshot.salesOrders} canOperate={snapshot.viewer.permissions.canOperate} onOpen={setSelectedSoId} onShip={(so) => setActiveCommand({ kind: "ship", entityId: so.id, entityNumber: so.number })} />
                )}
                </OperationsWorkspace>
              )}
              {view === "fulfillment" && (
                selectedSo ? (
                  <SalesOrderDetail so={selectedSo} canOperate={snapshot.viewer.permissions.canOperate} onBack={() => setSelectedSoId(null)} onEdit={() => setEditingSalesOrder(selectedSo)} onReserve={() => setActiveCommand({ kind: "reserve", entityId: selectedSo.id, entityNumber: selectedSo.number })} onShip={() => setActiveCommand({ kind: "ship", entityId: selectedSo.id, entityNumber: selectedSo.number })} onConfirm={(reason) => activateDraft("confirmSalesOrder", selectedSo.id, selectedSo.version, reason, `${selectedSo.number} confirmed.`)} />
                ) : (
                  <SalesOrdersView orders={snapshot.salesOrders} canOperate={snapshot.viewer.permissions.canOperate} onOpen={setSelectedSoId} onShip={(so) => setActiveCommand({ kind: "ship", entityId: so.id, entityNumber: so.number })} />
                )
              )}
              {view === "customer-returns" && <CustomerReturnsView orders={snapshot.salesOrders} canOperate={snapshot.viewer.permissions.canOperate} onReturn={(so) => setActiveCommand({ kind: "customer-return", entityId: so.id, entityNumber: so.number })} />}
              {view === "stock" && (
                <OperationsWorkspace workspace="inventory" initialTab={workspaceTab} onTabChange={changeWorkspaceTab} onDurableRefresh={loadSnapshot}>
                  {selectedProduct ? <ProductDetail product={selectedProduct} movements={snapshot.movements} backLabel="inventory" onBack={() => setSelectedProductId(null)} /> : <InventoryView snapshot={snapshot} onOpen={setSelectedProductId} warehouseId={warehouseId} />}
                </OperationsWorkspace>
              )}
              {view === "products" && (selectedProduct ? <ProductDetail product={selectedProduct} movements={snapshot.movements} backLabel="the catalog" onBack={() => setSelectedProductId(null)} /> : <CatalogView products={snapshot.products} onOpen={setSelectedProductId} />)}
              {view === "movements" && <MovementsView movements={snapshot.movements} />}
              {view === "counts" && <OperationsWorkspace workspace="inventory" initialTab={workspaceTab} onTabChange={changeWorkspaceTab} onDurableRefresh={loadSnapshot}><CountsView canOperate={snapshot.viewer.permissions.canOperate} products={snapshot.products} balances={snapshot.inventoryBalances} onCount={(product, balance) => setActiveCommand({ kind: "count", entityId: product.id, entityNumber: `COUNT · ${product.sku}`, locationId: balance.locationId, locationLabel: `${balance.warehouseName} / ${balance.locationCode}`, recordedQuantity: balance.recordedQuantity, balanceVersion: balance.version })} /></OperationsWorkspace>}
              {view === "vendor-bills" && <OperationsWorkspace workspace="vendor-billing" initialTab={workspaceTab} onTabChange={changeWorkspaceTab} onDurableRefresh={loadSnapshot}><VendorBillsView bills={snapshot.bills} /></OperationsWorkspace>}
              {view === "customer-invoices" && <OperationsWorkspace workspace="customer-billing" initialTab={workspaceTab} onTabChange={changeWorkspaceTab} onDurableRefresh={loadSnapshot}><InvoicesView salesOrders={snapshot.salesOrders} /></OperationsWorkspace>}
              {view === "partners" && <PartnersView partners={snapshot.partners} selectedId={selectedPartnerId} canApprove={snapshot.viewer.permissions.canApprove} canOperate={snapshot.viewer.permissions.canOperate} onOpen={setSelectedPartnerId} onEdit={setEditingPartner} />}
              {view === "reports" && <OperationsWorkspace workspace="controls" initialTab={workspaceTab} onTabChange={changeWorkspaceTab} onDurableRefresh={loadSnapshot}><ReportsView snapshot={snapshot} warehouseId={warehouseId} /></OperationsWorkspace>}
              {view === "warehouse" && <WarehouseView snapshot={snapshot} source={source} lastUpdatedAt={lastUpdatedAt} canOperate={snapshot.viewer.permissions.canOperate} navigate={navigate} onReceive={(po) => setActiveCommand({ kind: "receive", entityId: po.id, entityNumber: po.number })} />}
            </>
          )}
          {/* Fifty rows a page over a catalog this size runs to dozens of pages, so Previous /
              Next alone made page 40 a forty-click journey. */}
          {source === "server" && pageCount > 1 ? <nav className="snapshot-pagination" aria-label={view === "reports" ? "Projected availability pages" : "Record pages"}>
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

      {toast && <div className="toast" role="status"><span aria-hidden="true">✓</span>{toast}</div>}
      {mobileNavOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
    </div>
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
  if (view === "warehouse") return <span className={`connection ${source}`}><span /> {source === "server" ? "Connected" : source === "loading" ? "Connecting…" : "Offline"}</span>;
  if (!ready) return null;
  if (view === "purchase-orders") return canOperate ? <button className="button primary" onClick={() => onCreate("purchaseOrder")}>Create purchase order</button> : null;
  if (view === "sales-orders") return canOperate ? <button className="button primary" onClick={() => onCreate("salesOrder")}>Create sales order</button> : null;
  if (view === "stock") return canOperate ? <button className="button secondary" onClick={() => onNavigate("counts")}>Start inventory count</button> : null;
  // Adding a SKU used to be reachable only from inside an order line or the master-data tab,
  // which is the wrong place to look when you are standing on the catalog. Master data is an
  // approver's job, matching the permission the create command itself checks.
  if (view === "products") return canApprove ? <button className="button primary" onClick={onCreateProduct}>Add product</button> : null;
  if (view === "partners") return canApprove ? <button className="button primary" onClick={onCreatePartner}>Add partner</button> : null;
  return null;
}

function Dashboard({ snapshot, navigate, openPo }: { snapshot: Snapshot; navigate: (view: ViewKey, status?: string, tab?: string) => void; openPo: (id: string) => void }) {
  const due = snapshot.purchaseOrders.filter((po) => po.open > 0 || po.daysLate > 0).slice(0, 4);
  // This panel used to show whichever special-order product happened to sort first, which on a
  // real catalog is a SKU with no demand, no supply, and nothing to watch. Watch the ones that
  // are actually committed to a customer and short.
  const specialOrders = snapshot.products
    .filter((product) => (product.inventoryPolicy === "special_order" || product.inventoryPolicy === "drop_ship") && (product.demand > 0 || product.incoming > 0))
    .sort((first, second) => first.projected - second.projected || second.demand - first.demand)
    .slice(0, 5);
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
        <MetricCard label="Open customer demand" value={snapshot.summary.openDemand} detail="Confirmed units not yet shipped" tone="neutral" onClick={() => navigate("sales-orders")} />
        <MetricCard label="Inventory risks" value={snapshot.summary.inventoryRisks} detail="Below target, short, or on hold" tone="warning" onClick={() => navigate("stock")} />
      </section>

      <section className="panel today-panel">
        {/* Not "today": this is whatever the priority sort put at the top of the receiving queue. */}
        <PanelHeading title="Receipts needing attention" action="View all receipts" onAction={() => navigate("expected-receipts")} />
        <div className="responsive-table">
          <table>
            <caption className="sr-only">Purchase orders requiring receiving attention</caption>
            <thead><tr><th>Purchase order</th><th>Vendor</th><th>Expected</th><th className="numeric">Open</th><th>Customer impact</th><th><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{due.map((po) => (
              <tr key={po.id}>
                <td><button className="table-link" onClick={() => { navigate("purchase-orders"); openPo(po.id); }}>{po.number}</button></td>
                <td>{po.vendor}</td>
                <td><span className={po.daysLate > 0 ? "text-danger" : ""}>{po.daysLate > 0 ? `${po.daysLate} days late` : formatDate(po.expectedDate)}</span></td>
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
            <thead><tr><th>Product</th><th>Route</th><th className="numeric">Open demand</th><th className="numeric">Reserved</th><th className="numeric">Incoming</th><th className="numeric">Projected</th></tr></thead>
            <tbody>{specialOrders.map((product) => (
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

function ServerWorklistControls({ view, query, setQuery, status, setStatus, sort, setSort, total }: { view: ViewKey; query: string; setQuery: (value: string) => void; status: string; setStatus: (value: string) => void; sort: string; setSort: (value: string) => void; total: number }) {
  const statusOptions: Partial<Record<ViewKey, Array<[string, string]>>> = {
    // "Open to …" and "Late" are worklist states resolved server-side, so filtering to real
    // work no longer means paging through settled documents looking for it.
    "purchase-orders": [["", "All states"], ["open", "Open to receive"], ["late", "Late"], ["draft", "Draft"], ["pending_approval", "Pending approval"], ["approved", "Approved"]],
    "expected-receipts": [["", "All states"], ["open", "Open to receive"], ["late", "Late"], ["approved", "Approved"], ["pending_approval", "Pending approval"]],
    "vendor-returns": [["", "All states"], ["returnable", "Has received quantity"], ["approved", "Approved"]],
    "sales-orders": [["", "All states"], ["open", "Open to ship"], ["blocked", "Blocked by supply"], ["reserved", "Reserved"], ["draft", "Draft"], ["confirmed", "Confirmed"], ["canceled", "Canceled"]],
    fulfillment: [["", "All states"], ["reserved", "Reserved"], ["open", "Open to ship"], ["confirmed", "Confirmed"]],
    "customer-returns": [["", "All states"], ["shipped", "Has shipped quantity"], ["confirmed", "Confirmed"]],
    stock: [["", "All policies"], ["stocked", "Stocked"], ["special_order", "Special order"], ["drop_ship", "Drop ship"], ["serial", "Serial tracked"], ["lot", "Lot tracked"]],
    products: [["", "All policies"], ["stocked", "Stocked"], ["special_order", "Special order"], ["drop_ship", "Drop ship"], ["serial", "Serial tracked"], ["lot", "Lot tracked"]],
    movements: [["", "All movement types"], ["purchase_receipt", "Purchase receipt"], ["sales_shipment", "Sales shipment"], ["internal_transfer", "Internal transfer"], ["customer_return", "Customer return"], ["vendor_return", "Vendor return"]],
    "vendor-bills": [["", "All states"], ["posted", "Posted"], ["on_hold", "On hold"], ["matched", "Matched"], ["exception", "Match exception"]],
    partners: [["", "All partner types"], ["customer", "Customers"], ["vendor", "Vendors"]],
  };
  const catalogView = view === "products" || view === "stock";
  const sortOptions = [catalogView ? ["priority", "Product name"] : ["priority", "Operational priority"], ["newest", "Newest first"], ...(catalogView ? [] : [["name", "Name"]]), ...(view === "movements" ? [["oldest", "Oldest first"]] : []), ...(catalogView ? [["sku", "SKU"], ["availability", "Availability"]] : [])] as Array<[string, string]>;
  const asOptions = (pairs: Array<[string, string]>) => pairs.map(([id, label]) => ({ id, label }));
  // Name what is being searched. "the full database worklist" is our word for it, not theirs.
  const scopeLabel = `Search all ${worklistNoun[view] ?? "records"}`;
  return <div className="filter-bar server-worklist-controls"><label className="list-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={scopeLabel} aria-label={scopeLabel} /></label>
    {statusOptions[view] ? <SearchableSelect label="Filter status" hideLabel className="worklist-filter" value={status} setValue={setStatus} options={asOptions(statusOptions[view] ?? [])} placeholder="Filter status" /> : null}
    <SearchableSelect label="Sort worklist" hideLabel className="worklist-filter" value={sort} setValue={setSort} options={asOptions(sortOptions)} placeholder="Sort worklist" />
    <span className="read-only-label">{total} matching record{total === 1 ? "" : "s"}</span></div>;
}

function PurchaseOrdersView({ orders, canOperate, onOpen, onReceive }: { orders: PurchaseOrder[]; canOperate: boolean; onOpen: (id: string) => void; onReceive: (po: PurchaseOrder) => void }) {
  // Scoped server-side by the worklist status filter; see SalesOrdersView.
  return <section className="panel worklist">
    <div className="responsive-table"><table><caption className="sr-only">Purchase orders</caption><thead><tr><th>Exception</th><th>PO</th><th>Vendor</th><th>Expected</th><th className="numeric">Ordered</th><th className="numeric">Net received</th><th className="numeric">Closed</th><th className="numeric">Open</th><th>Billing</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{orders.map((po) => <tr key={po.id}>
      <td>{po.exception ? <span className={`exception-cell ${po.daysLate > 0 ? "danger" : "warning"}`} title={po.exception}>!</span> : <span className="muted">—</span>}</td>
      <td><button className="table-link" onClick={() => onOpen(po.id)}>{po.number}</button><small>Rev {po.revision}</small></td>
      <td><strong>{po.vendor}</strong>{po.customerRef && <small>{po.customerRef}</small>}</td>
      <td>{po.daysLate > 0 ? <StatusBadge tone="danger">{po.daysLate} days late</StatusBadge> : formatDate(po.expectedDate)}</td>
      <td className="numeric">{po.ordered}</td><td className="numeric">{po.received - po.returned}</td><td className="numeric">{po.closed}</td><td className="numeric strong">{po.open}</td>
      <td><StatusBadge>{po.billing}</StatusBadge></td>
      <td>{canOperate && po.lifecycle.toLowerCase() === "approved" && po.open > 0 ? <button className="row-action" onClick={() => onReceive(po)}>Receive</button> : <button className="row-action" onClick={() => onOpen(po.id)}>Open</button>}</td>
    </tr>)}{!orders.length ? <tr><td colSpan={10}><div className="empty-inline">No purchase order matches this filter.</div></td></tr> : null}</tbody></table></div>
  </section>;
}

function PurchaseOrderDetail({ po, canOperate, onBack, onEdit, onCommand, onSubmitForApproval }: { po: PurchaseOrder; canOperate: boolean; onBack: () => void; onEdit: () => void; onCommand: (kind: CommandKind) => void; onSubmitForApproval: (reason: string) => Promise<void> }) {
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState("");
  const [submitNote, setSubmitNote] = useState("");
  const isDraft = po.lifecycle.toLowerCase() === "draft";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setActivating(true); setActivateError("");
    try { await onSubmitForApproval(submitNote.trim()); } catch (caught) { setActivateError(caught instanceof Error ? caught.message : "The purchase order could not be submitted."); }
    finally { setActivating(false); }
  };
  return <div className="object-page">
    <button className="back-button" onClick={onBack}>← Back to purchase orders</button>
    <section className="object-header panel"><div className="object-title"><div><span className="section-kicker">Purchase order · Revision {po.revision}</span><h2>{po.number}</h2><p>{po.vendor} · destination selected per receipt</p></div><div className="object-total"><span>Total</span><strong>{formatDocumentMoney(po.total, po.currency)}</strong></div></div>
      <div className="status-summary"><div><small>Commercial</small><StatusBadge>{po.lifecycle}</StatusBadge></div><div><small>Physical</small><StatusBadge>{po.fulfillment}</StatusBadge></div><div><small>Financial</small><StatusBadge>{po.billing}</StatusBadge></div></div>
      {po.exception && <div className="exception-banner"><span aria-hidden="true">!</span><div><strong>Action needed</strong><p>{po.exception}</p></div></div>}
      {activateError ? <div className="error-summary" role="alert"><p>{activateError}</p></div> : null}
      {isDraft && canOperate ? <form className="draft-activation" onSubmit={submit}><label>Submission note<input value={submitNote} onChange={(event) => setSubmitNote(event.target.value)} placeholder="Why this order is needed" required /></label><button className="button primary" type="submit" disabled={activating || !submitNote.trim()}>{activating ? "Submitting…" : "Submit for approval"}</button><button className="button secondary" type="button" onClick={onEdit}>Edit draft lines</button></form> : null}
      {canOperate ? <div className="object-actions">
        {po.lifecycle.toLowerCase() === "approved" && po.open > 0 && <button className="button primary" onClick={() => onCommand("receive")}>Receive remaining</button>}
        {po.lifecycle.toLowerCase() === "approved" && po.closed > 0 && <button className="button primary" onClick={() => onCommand("reopen")}>Reopen quantity to receive</button>}
        {po.lifecycle.toLowerCase() === "approved" && po.open > 0 && <button className="button secondary" onClick={() => onCommand("close")}>Close unreceived quantity</button>}
        {po.received > 0 && <button className="button secondary" onClick={() => onCommand("reverse")}>Reverse incorrect receipt</button>}
        {po.received - po.returned > 0 && <button className="button ghost" onClick={() => onCommand("vendor-return")}>Return to vendor</button>}
      </div> : <p className="read-only-label">Read-only access: operational posting actions are hidden.</p>}
    </section>
    <section className="metric-row object-metrics">
      <MetricDisplay label="Ordered" value={po.ordered} />
      <MetricDisplay label="Net retained" value={po.received - po.returned} />
      <MetricDisplay label="Closed without receipt" value={po.closed} tone={po.closed > 0 ? "warning" : "neutral"} />
      <MetricDisplay label="Open to receive" value={po.open} tone={po.open > 0 ? "info" : "neutral"} />
    </section>
    <section className="panel"><PanelHeading title="Order lines" />
      <div className="responsive-table"><table><caption className="sr-only">Purchase order lines and quantity breakdown</caption><thead><tr><th>Product / configuration</th><th>Customer / project</th><th className="numeric">Ordered</th><th className="numeric">Net received</th><th className="numeric">Returned</th><th className="numeric">Closed</th><th className="numeric">Open</th><th className="numeric">Unit cost</th></tr></thead><tbody>{po.lines.map((line) => <tr key={line.id}><td><strong>{line.product}</strong><small>{line.sku} · {line.specification}</small></td><td>{line.customerRef ? <span className="allocation-tag">{line.customerRef}</span> : <span className="muted">Stock</span>}</td><td className="numeric">{line.ordered}</td><td className="numeric strong">{line.received - line.returned}</td><td className="numeric">{line.returned}</td><td className="numeric">{line.closed}</td><td className="numeric strong">{line.open}</td><td className="numeric">{formatDocumentMoney(line.unitCost, po.currency)}</td></tr>)}</tbody></table></div>
    </section>
    <div className="detail-columns"><section className="panel"><PanelHeading title="Related state" /><dl className="definition-list"><div><dt>Purchase order</dt><dd>{po.number} · revision {po.revision}</dd></div><div><dt>Receipt lineage</dt><dd>{po.latestReceiptId ?? (po.received > 0 ? "Recorded stock movements" : "No receipt posted")}</dd></div><div><dt>Linked demand</dt><dd>{po.customerRef ?? "Stock replenishment"}</dd></div><div><dt>Billing</dt><dd>{po.billing}</dd></div></dl></section>
      <section className="panel"><PanelHeading title="Posting summary" /><div className="timeline"><div className="timeline-item"><span className="timeline-dot info" /><div><strong>Revision {po.revision} · {po.lifecycle}</strong><p>Commercial state is version checked independently of inventory.</p><small>{po.buyer || "Buyer not recorded"}</small></div></div><div className="timeline-item"><span className="timeline-dot success" /><div><strong>{po.received - po.returned} units net retained</strong><p>{po.received} received · {po.returned} returned · {po.closed} closed without receipt.</p><small>{po.fulfillment}</small></div></div></div></section></div>
  </div>;
}

function MetricDisplay({ label, value, tone = "neutral" }: { label: string; value: number | string; tone?: Severity }) {
  return <div className={`metric-display ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function VendorReturnsView({ orders, canOperate, onReturn }: { orders: PurchaseOrder[]; canOperate: boolean; onReturn: (po: PurchaseOrder) => void }) {
  const eligible = orders.filter((po) => po.received - po.returned > 0);
  return <section className="panel worklist"><div className="record-cards">{eligible.map((po) => <article className="record-card" key={po.id}><div><span className="section-kicker">{po.number}</span><h3>{po.vendor}</h3><p>{po.lines[0]?.product ?? "Purchase-order inventory"}</p></div><div className="card-metrics"><span><small>Eligible to return</small><strong>{po.received - po.returned}</strong></span><span><small>Receipt lineage</small><strong>{po.latestReceiptId ?? "Movement history"}</strong></span></div>{canOperate ? <button className="button secondary" onClick={() => onReturn(po)}>Start vendor return</button> : <span className="read-only-label">Read-only</span>}</article>)}{!eligible.length ? <div className="empty-inline">No retained purchase receipts are currently eligible for return.</div> : null}</div></section>;
}

function SalesOrdersView({ orders, canOperate, onOpen, onShip }: { orders: SalesOrder[]; canOperate: boolean; onOpen: (id: string) => void; onShip: (so: SalesOrder) => void }) {
  // No client-side trim: the worklist status filter scopes this server-side, so the row
  // count on screen always equals the record count reported above it.
  return <section className="panel worklist"><div className="responsive-table"><table><caption className="sr-only">Sales orders</caption><thead><tr><th>Exception</th><th>SO</th><th>Customer / project</th><th>Requested</th><th>Availability</th><th>Fulfillment</th><th>Invoice</th><th className="numeric">Total</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{orders.map((so) => <tr key={so.id}><td>{so.exception ? <span className={`exception-cell ${so.shortage > 0 ? "danger" : "warning"}`}>!</span> : "—"}</td><td><button className="table-link" onClick={() => onOpen(so.id)}>{so.number}</button><small>{so.route}</small></td><td><strong>{so.customer}</strong><small>{so.project}</small></td><td>{formatDate(so.requestedDate)}</td><td><div className="availability-mini"><strong>{so.availableNow} now</strong><span>{so.incomingBeforeDate} incoming</span>{so.shortage > 0 && <b>{so.shortage} short</b>}</div></td><td><StatusBadge>{so.fulfillment}</StatusBadge></td><td><StatusBadge>{so.billing}</StatusBadge></td><td className="numeric strong">{formatDocumentMoney(so.total, so.currency, false)}</td><td>{canOperate && so.lifecycle.toLowerCase() === "confirmed" && so.reserved > so.shipped ? <button className="row-action" onClick={() => onShip(so)}>Post shipment</button> : <button className="row-action" onClick={() => onOpen(so.id)}>Open</button>}</td></tr>)}{!orders.length ? <tr><td colSpan={9}><div className="empty-inline">No sales order matches this filter.</div></td></tr> : null}</tbody></table></div></section>;
}

function SalesOrderDetail({ so, canOperate, onBack, onEdit, onReserve, onShip, onConfirm }: { so: SalesOrder; canOperate: boolean; onBack: () => void; onEdit: () => void; onReserve: () => void; onShip: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState("");
  // Confirmation is an audited decision, so the note is typed rather than defaulted — a
  // generated one would fill the trail with a sentence nobody wrote.
  const [confirmNote, setConfirmNote] = useState("");
  const isDraft = so.lifecycle.toLowerCase() === "draft";
  const hasDedicatedSupply = so.lines?.some((line) => Boolean(line.linkedPurchaseOrderLineId)) ?? false;
  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setActivating(true); setActivateError("");
    try { await onConfirm(confirmNote.trim()); } catch (caught) { setActivateError(caught instanceof Error ? caught.message : "The sales order could not be confirmed."); }
    finally { setActivating(false); }
  };
  return <div className="object-page"><button className="back-button" onClick={onBack}>← Back to sales orders</button><section className="object-header panel"><div className="object-title"><div><span className="section-kicker">Sales order · {so.route}</span><h2>{so.number}</h2><p>{so.customer} · {so.project}</p></div><div className="object-total"><span>Total</span><strong>{formatDocumentMoney(so.total, so.currency)}</strong></div></div><div className="status-summary"><div><small>Commercial</small><StatusBadge>{so.lifecycle}</StatusBadge></div><div><small>Physical</small><StatusBadge>{so.fulfillment}</StatusBadge></div><div><small>Financial</small><StatusBadge>{so.billing}</StatusBadge></div></div>{so.exception && <div className="exception-banner"><span>!</span><div><strong>Fulfillment exception</strong><p>{so.exception}</p></div></div>}{activateError ? <div className="error-summary" role="alert"><p>{activateError}</p></div> : null}{isDraft && canOperate ? <form className="draft-activation" onSubmit={confirm}><label>Confirmation note<input value={confirmNote} onChange={(event) => setConfirmNote(event.target.value)} placeholder="Customer PO number, or who approved it" required /></label><button className="button primary" type="submit" disabled={activating || !confirmNote.trim()}>{activating ? "Confirming…" : "Confirm sales order"}</button><button className="button secondary" type="button" onClick={onEdit} disabled={hasDedicatedSupply} title={hasDedicatedSupply ? "Cancel the linked purchase order before replacing these demand lines." : undefined}>Edit draft lines</button>{hasDedicatedSupply ? <small className="read-only-label">Dedicated supply is linked. Cancel that purchase order before replacing demand lines.</small> : null}</form> : !isDraft && canOperate ? <div className="object-actions"><button className="button primary" onClick={onShip} disabled={so.lifecycle.toLowerCase() !== "confirmed" || so.reserved <= so.shipped}>Post shipment</button><button className="button secondary" onClick={onReserve} disabled={so.lifecycle.toLowerCase() !== "confirmed" || so.open <= so.reserved || so.availableNow <= 0}>Reserve available stock</button></div> : <p className="read-only-label">Read-only access: operational posting actions are hidden.</p>}</section>
    <section className="panel availability-panel"><PanelHeading title="Availability for requested date" detail={`Requested ${formatDate(so.requestedDate)}`} /><div className="availability-grid"><MetricDisplay label="Required" value={so.open} /><MetricDisplay label="Available now" value={so.availableNow} tone="success" /><MetricDisplay label="Incoming before date" value={so.incomingBeforeDate} tone="info" /><MetricDisplay label="Shortage" value={so.shortage} tone={so.shortage > 0 ? "danger" : "neutral"} /></div>{so.linkedPo && <div className="linked-supply"><span className="section-kicker">Linked supply</span><strong>{so.linkedPo}</strong><p>{so.incomingBeforeDate} units expected before the customer&apos;s requested date.</p></div>}</section>
    <div className="detail-columns"><section className="panel"><PanelHeading title="Fulfillment quantities" /><dl className="definition-list"><div><dt>Ordered</dt><dd>{so.ordered}</dd></div><div><dt>Reserved</dt><dd>{so.reserved}</dd></div><div><dt>Net shipped</dt><dd>{so.shipped}</dd></div><div><dt>Open to ship</dt><dd>{so.open}</dd></div></dl></section><section className="panel"><PanelHeading title="Customer delivery" /><dl className="definition-list"><div><dt>Method</dt><dd>{so.route}</dd></div><div><dt>Requested</dt><dd>{formatDate(so.requestedDate)}</dd></div><div><dt>Ship to</dt><dd>{so.shipToName ?? so.customer}<br />{[so.shipToAddressLine1, so.shipToAddressLine2, so.shipToCity, so.shipToRegion, so.shipToPostalCode, so.shipToCountry].filter(Boolean).join(", ") || "Address required before confirmation"}</dd></div><div><dt>Instructions</dt><dd>{so.deliveryInstructions ?? "None"}</dd></div></dl></section></div>
  </div>;
}

function CustomerReturnsView({ orders, canOperate, onReturn }: { orders: SalesOrder[]; canOperate: boolean; onReturn: (so: SalesOrder) => void }) {
  // Only a posted shipment can come back. Reserved stock has never left the building, so
  // listing it as "eligible return" invited a return against goods the customer never received.
  const eligible = orders.filter((so) => so.shipped > 0);
  return <section className="panel worklist"><div className="record-cards">{eligible.map((so) => <article className="record-card" key={so.id}><div><span className="section-kicker">{so.number}</span><h3>{so.customer}</h3><p>{so.project}</p></div><div className="card-metrics"><span><small>Net shipped</small><strong>{so.shipped}</strong></span><span><small>Invoiced</small><strong>{so.invoiced ?? 0}</strong></span></div>{canOperate ? <button className="button secondary" onClick={() => onReturn(so)}>Create customer return</button> : <span className="read-only-label">Read-only</span>}</article>)}{!eligible.length ? <div className="empty-inline">No sales order in this view has a posted shipment to return.</div> : null}</div></section>;
}

function InventoryView({ snapshot, onOpen, warehouseId }: { snapshot: Snapshot; onOpen: (id: string) => void; warehouseId: string }) {
  const { products, summary } = snapshot;
  return <div className="stack">{summary.orphanedBalanceRows > 0 ? <div className="exception-banner"><span aria-hidden="true">!</span><div><strong>Inventory reconciliation failed</strong><p>{summary.orphanedBalanceUnits} units across {summary.orphanedBalanceRows} balance row(s) reference missing locations; {money.format(summary.orphanedInventoryValueCents / 100)} of movement value is affected. Posting to unknown locations is now blocked.</p></div></div> : null}<section className="metric-row object-metrics"><MetricDisplay label="On hand" value={summary.onHand} /><MetricDisplay label="Usable" value={summary.usable} /><MetricDisplay label="Reserved" value={summary.reserved} tone="info" /><MetricDisplay label="Available now" value={summary.available} tone="success" />{/* Purchase orders carry no warehouse, so incoming supply stays company-wide even when
        the physical totals beside it are scoped to one site. */}
      <MetricDisplay label={warehouseId ? "Incoming (all sites)" : "Incoming"} value={summary.incoming} tone="info" /></section><section className="panel worklist"><div className="responsive-table"><table><caption className="sr-only">Inventory balances by product</caption><thead><tr><th>Product / configuration</th><th>Warehouse location</th><th className="numeric">On hand</th><th className="numeric">Usable</th><th className="numeric">Reserved</th><th className="numeric">Available</th><th className="numeric">Incoming</th><th className="numeric">Demand</th><th className="numeric">Projected</th><th>Exception</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><button className="table-link" onClick={() => onOpen(product.id)}>{product.name}</button><small>{product.sku} · {product.specification}</small>{product.customerRef && <span className="allocation-tag">{product.customerRef}</span>}</td><td><strong>{product.locationCode}</strong><small>{product.location}</small></td><td className="numeric">{product.onHand}</td><td className="numeric">{product.usable}</td><td className="numeric">{product.reserved}</td><td className="numeric strong">{product.available}</td><td className="numeric">{product.incoming}</td><td className="numeric">{product.demand}</td><td className={`numeric strong ${product.projected < 0 ? "text-danger" : ""}`}>{product.projected}</td><td>{product.projected < 0 ? <StatusBadge tone="danger">Shortage {Math.abs(product.projected)}</StatusBadge> : product.available <= product.reorderPoint ? <StatusBadge tone="warning">Below target</StatusBadge> : <StatusBadge tone="success">Healthy</StatusBadge>}</td></tr>)}{!products.length ? <tr><td colSpan={10}><div className="empty-inline">No product matches this filter.</div></td></tr> : null}</tbody></table></div></section></div>;
}

/**
 * Catalog and Stock used to render the same balances table, so two nav entries led to one
 * screen. The catalog answers "what do we sell, at what cost, at what margin"; Stock answers
 * "how much is there and where".
 */
function CatalogView({ products, onOpen }: { products: Product[]; onOpen: (id: string) => void }) {
  return <section className="panel worklist"><div className="responsive-table"><table>
    <caption className="sr-only">Product catalog</caption>
    <thead><tr><th>Product</th><th>Configuration</th><th>Policy</th><th>Units · base / buy / sell</th><th className="numeric">Standard cost</th><th className="numeric">Selling price</th><th className="numeric">Margin</th><th className="numeric">Reorder point</th></tr></thead>
    <tbody>{products.map((product) => {
      const margin = product.sellingPrice > 0 ? (product.sellingPrice - product.standardCost) / product.sellingPrice * 100 : 0;
      return <tr key={product.id}>
        <td><button className="table-link" onClick={() => onOpen(product.id)}>{product.name}</button><small>{product.sku}</small></td>
        <td>{product.specification}</td>
        <td><StatusBadge tone="info">{titleCase(product.inventoryPolicy)}</StatusBadge></td>
        <td>{product.baseUomCode} / {product.purchaseUomCode} / {product.salesUomCode}</td>
        <td className="numeric">{exact.format(product.standardCost)}</td>
        <td className="numeric">{exact.format(product.sellingPrice)}</td>
        {/* A SKU priced at or below its own cost is a pricing error worth seeing in the list. */}
        <td className={`numeric strong ${margin <= 0 ? "text-danger" : ""}`}>{product.sellingPrice > 0 ? `${margin.toFixed(1)}%` : "—"}</td>
        <td className="numeric">{product.reorderPoint}</td>
      </tr>;
    })}{!products.length ? <tr><td colSpan={8}><div className="empty-inline">No products match this view.</div></td></tr> : null}</tbody>
  </table></div></section>;
}

function ProductDetail({ product, movements, onBack, backLabel }: { product: Product; movements: Movement[]; onBack: () => void; backLabel: string }) {
  const [movementPage, setMovementPage] = useState(1);
  const [movementTotal, setMovementTotal] = useState(0);
  const [productMovements, setProductMovements] = useState<Movement[]>(movements.filter((movement) => movement.product === product.sku));
  const [balances, setBalances] = useState<Array<InventoryLocationBalance & { inventoryStatus: string }>>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setHistoryLoading(true); setHistoryError("");
      const params = new URLSearchParams({ detail: "product", productId: product.id, page: String(movementPage), pageSize: "50" });
      const response = await fetch(`/api/snapshot?${params}`, { cache: "no-store", signal: controller.signal });
      const raw = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(text(asRecord(raw.error).message, "Product history could not be loaded."));
      setProductMovements(asRows(raw.movements).map((item, index) => ({ id: text(item.id, `movement-${index}`), time: displayTimestamp(text(item.postedAt)), type: titleCase(text(item.type)), document: `${titleCase(text(item.sourceDocumentType))} · ${text(item.sourceDocumentId)}`, product: product.sku, quantity: number(item.quantity), from: text(item.fromLocationCode, "External"), to: text(item.toLocationCode, "External"), user: text(item.postedBy, "System") })));
      setBalances(asRows(raw.balances).map((item) => ({ productId: product.id, locationId: text(item.locationId), recordedQuantity: number(item.recordedQuantity), reservedQuantity: number(item.reservedQuantity), version: number(item.version), locationCode: text(item.locationCode, "Missing location"), locationName: text(item.locationName, "Referenced location no longer exists"), warehouseName: text(item.warehouseName, "Unreconciled"), inventoryStatus: text(item.inventoryStatus, "orphaned") })));
      setMovementTotal(number(asRecord(raw.pagination).total));
    })().catch((caught) => { if (!controller.signal.aborted) setHistoryError(caught instanceof Error ? caught.message : "Product history could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [historyRefresh, movementPage, product.id, product.sku]);
  const movementPages = Math.max(1, Math.ceil(movementTotal / 50));
  return <div className="object-page">
    <button className="back-button" onClick={onBack}>← Back to {backLabel}</button>
    {historyError ? <div className="exception-banner" role="alert"><span aria-hidden="true">!</span><div><strong>Product detail unavailable</strong><p>{historyError}</p><button className="button secondary" onClick={() => setHistoryRefresh((current) => current + 1)}>Retry</button></div></div> : null}
    <section className="object-header panel product-header"><div className="window-thumb large" aria-hidden="true"><span /><span /><span /><span /></div><div className="object-title"><div><span className="section-kicker">{product.policy}</span><h2>{product.name}</h2><p>{product.specification}</p><code>{product.sku}</code></div></div></section>
    <section className="metric-row object-metrics"><MetricDisplay label="On hand" value={product.onHand} /><MetricDisplay label="Usable" value={product.usable} /><MetricDisplay label="Reserved" value={product.reserved} tone="info" /><MetricDisplay label="Available now" value={product.available} tone="success" /><MetricDisplay label="Incoming" value={product.incoming} tone="info" /><MetricDisplay label="Projected" value={product.projected} tone={product.projected < 0 ? "danger" : "neutral"} /></section>
    <section className="panel"><PanelHeading title="Location balances" /><div className="responsive-table"><table><thead><tr><th>Warehouse</th><th>Location</th><th>Status</th><th className="numeric">On hand</th><th className="numeric">Reserved</th><th className="numeric">Available</th></tr></thead><tbody>{balances.map((balance) => <tr key={balance.locationId}><td>{balance.warehouseName}</td><td><strong>{balance.locationCode}</strong><small>{balance.locationName}</small></td><td><StatusBadge tone={balance.inventoryStatus === "orphaned" ? "danger" : balance.inventoryStatus === "usable" ? "success" : "warning"}>{titleCase(balance.inventoryStatus)}</StatusBadge></td><td className="numeric">{balance.recordedQuantity}</td><td className="numeric">{balance.reservedQuantity}</td><td className="numeric strong">{balance.recordedQuantity - balance.reservedQuantity}</td></tr>)}</tbody></table></div></section>
    <section className="panel"><PanelHeading title="Movement history" detail={`${movementTotal} posted record${movementTotal === 1 ? "" : "s"}`} />{historyLoading ? <div className="empty-inline">Loading product history…</div> : productMovements.length ? <MovementsTable movements={productMovements} /> : <div className="empty-inline">No movement records exist for this product.</div>}{!historyLoading && movementPages > 1 ? <nav className="snapshot-pagination" aria-label="Product movement pages"><button className="button secondary" disabled={movementPage <= 1} onClick={() => setMovementPage((current) => current - 1)}>Previous</button><span>Page {movementPage} of {movementPages}</span><button className="button secondary" disabled={movementPage >= movementPages} onClick={() => setMovementPage((current) => current + 1)}>Next</button></nav> : null}</section>
  </div>;
}

function MovementsView({ movements }: { movements: Movement[] }) {
  return <section className="panel worklist"><MovementsTable movements={movements} /></section>;
}

function MovementsTable({ movements }: { movements: Movement[] }) {
  return <div className="responsive-table"><table><caption className="sr-only">Posted inventory movements</caption><thead><tr><th>Date and time</th><th>Movement</th><th>Source document</th><th>Product / unit</th><th className="numeric">Quantity</th><th>From</th><th>To</th><th>Posted by</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td>{movement.time}</td><td><StatusBadge>{movement.type}</StatusBadge></td><td><span className="table-link">{movement.document}</span></td><td><code>{movement.product}</code></td><td className={`numeric strong ${movement.quantity < 0 ? "text-danger" : "text-success"}`}>{movement.quantity > 0 ? "+" : ""}{movement.quantity}</td><td>{movement.from}</td><td>{movement.to}</td><td>{movement.user}</td></tr>)}{!movements.length ? <tr><td colSpan={8}><div className="empty-inline">No posted movement matches this filter.</div></td></tr> : null}</tbody></table></div>;
}

function CountsView({ products, balances, canOperate, onCount }: { products: Product[]; balances: InventoryLocationBalance[]; canOperate: boolean; onCount: (product: Product, balance: InventoryLocationBalance) => void }) {
  // The hero that used to sit here offered one "Start count" button wired to balances[0] — a
  // row nobody chose. Counting starts from the row you mean to count.
  return <div className="stack"><section className="panel"><PanelHeading title="Active location balances" /><div className="responsive-table"><table><caption className="sr-only">Inventory balances available for cycle counting</caption><thead><tr><th>Product</th><th>Warehouse location</th><th className="numeric">Book quantity</th><th className="numeric">Reserved</th><th className="numeric">Available</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{balances.map((balance) => { const product = products.find((item) => item.id === balance.productId); if (!product) return null; return <tr key={`${balance.productId}-${balance.locationId}`}><td><strong>{product.name}</strong><small>{product.sku}</small></td><td><strong>{balance.warehouseName} · {balance.locationCode}</strong><small>{balance.locationName}</small></td><td className="numeric strong">{balance.recordedQuantity}</td><td className="numeric">{balance.reservedQuantity}</td><td className="numeric">{balance.recordedQuantity - balance.reservedQuantity}</td><td>{canOperate ? <button className="button secondary" onClick={() => onCount(product, balance)}>Count location</button> : <span className="read-only-label">Read-only</span>}</td></tr>; })}{!balances.length ? <tr><td colSpan={6}><div className="empty-inline">No location balances are available to count.</div></td></tr> : null}</tbody></table></div></section></div>;
}


function PartnersView({ partners, selectedId, canApprove, canOperate, onOpen, onEdit }: { partners: Partner[]; selectedId: string | null; canApprove: boolean; canOperate: boolean; onOpen: (id: string | null) => void; onEdit: (partner: Partner) => void }) {
  const selected = partners.find((partner) => partner.id === selectedId);
  if (selected) return <PartnerDetail partner={selected} canApprove={canApprove} canOperate={canOperate} onBack={() => onOpen(null)} onEdit={() => onEdit(selected)} />;
  return <section className="panel worklist"><div className="responsive-table"><table><caption className="sr-only">Customers and vendors</caption><thead><tr><th>Partner</th><th>Type</th><th>Contact</th><th>Address</th><th>Terms</th><th>Credit control</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{partners.map((partner) => <tr key={partner.id}><td><button className="table-link" onClick={() => onOpen(partner.id)}>{partner.name}</button><small>{partner.code}</small></td><td>{titleCase(partner.type)}</td><td>{partner.email || "—"}<small>{partner.phone || ""}</small></td><td>{[partner.addressLine1, partner.city, partner.region, partner.postalCode].filter(Boolean).join(", ") || "Not recorded"}</td><td>{partner.paymentTerms || "—"}</td><td>{partner.creditHold ? <StatusBadge tone="danger">Credit hold</StatusBadge> : partner.creditLimitCents ? formatDocumentMoney(partner.creditLimitCents / 100, partner.currency) : "No limit"}</td><td><button className="row-action" onClick={() => onOpen(partner.id)}>Open</button></td></tr>)}{!partners.length ? <tr><td colSpan={7}><div className="empty-inline">No business partners match this view.</div></td></tr> : null}</tbody></table></div></section>;
}

type PartnerAddress = { id: string; label: string; contactName?: string; addressLine1: string; addressLine2?: string; city: string; region: string; postalCode: string; country: string; deliveryInstructions?: string; isDefault: boolean; version: number };

/** One account in one place: contacts, credit, ship-to sites, and its open commercial state. */
function PartnerDetail({ partner, canApprove, canOperate, onBack, onEdit }: { partner: Partner; canApprove: boolean; canOperate: boolean; onBack: () => void; onEdit: () => void }) {
  const [addresses, setAddresses] = useState<PartnerAddress[]>([]);
  const [orders, setOrders] = useState<Array<{ id: string; number: string; detail: string }>>([]);
  const [invoices, setInvoices] = useState<Array<{ id: string; number: string; detail: string }>>([]);
  const [addingAddress, setAddingAddress] = useState(false);
  const [editingAddress, setEditingAddress] = useState<PartnerAddress | null>(null);
  const [deactivatingAddress, setDeactivatingAddress] = useState<PartnerAddress | null>(null);
  const [addressMessage, setAddressMessage] = useState("");
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const isCustomer = partner.type === "customer" || partner.type === "both";

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
      const [addressRows, orderRows, invoiceRows] = await Promise.all([
        loadAll("partnerAddresses"),
        loadAll(isCustomer ? "salesOrders" : "purchaseOrders", "open"),
        isCustomer ? loadAll("customerInvoices", "open") : Promise.resolve([]),
      ]);
      setAddresses(addressRows.map((item) => ({
        id: text(item.id), label: text(item.label), contactName: text(item.contactName) || undefined,
        addressLine1: text(item.addressLine1), addressLine2: text(item.addressLine2) || undefined,
        city: text(item.city), region: text(item.region), postalCode: text(item.postalCode), country: text(item.country, "CA"),
        deliveryInstructions: text(item.deliveryInstructions) || undefined, isDefault: number(item.isDefault) !== 0, version: number(item.version, 1),
      })));
      setOrders(orderRows.map((item) => ({
        id: text(item.id), number: text(item.number),
        detail: `${titleCase(text(item.status))} · ${formatDocumentMoney(number(item.totalCents) / 100, text(item.currency, partner.currency))}`,
      })));
      setInvoices(invoiceRows.map((item) => ({
        id: text(item.id), number: text(item.number),
        detail: `${formatDocumentMoney(number(item.outstandingCents) / 100, text(item.currency, partner.currency))} outstanding · due ${text(item.dueDate, "—")}`,
      })));
    })().catch((caught) => {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setDetailError(caught instanceof Error ? caught.message : "Partner activity could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [isCustomer, partner.currency, partner.id, refreshToken]);

  return <div className="object-page">
    <button className="back-button" onClick={onBack}>← Back to partners</button>
    {detailError ? <div className="exception-banner" role="alert"><span aria-hidden="true">!</span><div><strong>Partner activity unavailable</strong><p>{detailError}</p></div></div> : null}
    <section className="object-header panel"><div className="object-title"><div><span className="section-kicker">{titleCase(partner.type)} · {partner.code}</span><h2>{partner.name}</h2><p>{[partner.email, partner.phone].filter(Boolean).join(" · ") || "No contact recorded"}</p></div><div className="object-total"><span>Credit limit</span><strong>{partner.creditLimitCents ? formatDocumentMoney(partner.creditLimitCents / 100, partner.currency) : "None"}</strong></div></div>
      {partner.creditHold ? <div className="exception-banner"><span aria-hidden="true">!</span><div><strong>Credit hold</strong><p>New sales orders for this account cannot be confirmed until the hold is released.</p></div></div> : null}
      <div className="object-actions">{canApprove ? <button className="button primary" onClick={onEdit}>Edit partner</button> : null}{isCustomer && canOperate ? <button className="button secondary" onClick={() => setAddingAddress(true)}>Add ship-to address</button> : null}</div>
    </section>
    <div className="detail-columns">
      <section className="panel"><PanelHeading title="Billing address" /><dl className="definition-list"><div><dt>Address</dt><dd>{[partner.addressLine1, partner.addressLine2, partner.city, partner.region, partner.postalCode, partner.country].filter(Boolean).join(", ") || "Not recorded"}</dd></div><div><dt>Payment terms</dt><dd>{partner.paymentTerms || "Not set"}</dd></div></dl></section>
      <section className="panel"><PanelHeading title={isCustomer ? "Open sales orders" : "Open purchase orders"} />{detailLoading ? <div className="empty-inline">Loading partner activity…</div> : orders.length ? <ul className="plain-list">{orders.map((order) => <li key={order.id}><strong>{order.number}</strong><span>{order.detail}</span></li>)}</ul> : <div className="empty-inline">No open orders for this partner.</div>}</section>
    </div>
    {isCustomer ? <section className="panel"><PanelHeading title="Ship-to addresses" />{addressMessage ? <p className="read-only-label" role="status">{addressMessage}</p> : null}{addresses.length ? <div className="responsive-table"><table><thead><tr><th>Label</th><th>Contact</th><th>Address</th><th>Instructions</th><th>Default</th>{canOperate ? <th><span className="sr-only">Actions</span></th> : null}</tr></thead><tbody>{addresses.map((address) => <tr key={address.id}><td><strong>{address.label}</strong></td><td>{address.contactName || "—"}</td><td>{[address.addressLine1, address.addressLine2, address.city, address.region, address.postalCode, address.country].filter(Boolean).join(", ")}</td><td>{address.deliveryInstructions || "—"}</td><td>{address.isDefault ? <StatusBadge tone="success">Default</StatusBadge> : "—"}</td>{canOperate ? <td><div className="workflow-row-actions"><button className="row-action" onClick={() => setEditingAddress(address)}>Edit</button><button className="row-action" onClick={() => setDeactivatingAddress(address)}>Deactivate</button></div></td> : null}</tr>)}</tbody></table></div> : <div className="empty-inline">No saved ship-to addresses. Add one so orders do not need the address retyped.</div>}</section> : null}
    {isCustomer ? <section className="panel"><PanelHeading title="Open invoices" />{detailLoading ? <div className="empty-inline">Loading invoices…</div> : invoices.length ? <ul className="plain-list">{invoices.map((invoice) => <li key={invoice.id}><strong>{invoice.number}</strong><span>{invoice.detail}</span></li>)}</ul> : <div className="empty-inline">No open invoices for this customer.</div>}</section> : null}
    {addingAddress ? <PartnerAddressDialog partnerId={partner.id} onClose={() => setAddingAddress(false)} onSaved={() => { setAddingAddress(false); setRefreshToken((current) => current + 1); }} /> : null}
    {editingAddress ? <PartnerAddressDialog partnerId={partner.id} address={editingAddress} onClose={() => setEditingAddress(null)} onSaved={() => { setEditingAddress(null); setRefreshToken((current) => current + 1); }} /> : null}
    {deactivatingAddress ? <PartnerAddressDeactivateDialog address={deactivatingAddress} onClose={() => setDeactivatingAddress(null)} onSaved={(message) => { setDeactivatingAddress(null); setAddressMessage(message); setRefreshToken((current) => current + 1); }} /> : null}
  </div>;
}

function PartnerAddressDialog({ partnerId, address, onClose, onSaved }: { partnerId: string; address?: PartnerAddress; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ label: address?.label ?? "", contactName: address?.contactName ?? "", addressLine1: address?.addressLine1 ?? "", addressLine2: address?.addressLine2 ?? "", city: address?.city ?? "", region: address?.region ?? "", postalCode: address?.postalCode ?? "", country: address?.country ?? "CA", deliveryInstructions: address?.deliveryInstructions ?? "", isDefault: address?.isDefault ?? false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
        <label>Label<input value={form.label} onChange={(event) => set({ label: event.target.value })} placeholder="Job site or branch name" required /></label>
        <label>Site contact<input value={form.contactName} onChange={(event) => set({ contactName: event.target.value })} /></label>
        <label>Address line 1<input value={form.addressLine1} onChange={(event) => set({ addressLine1: event.target.value })} required /></label>
        <label>Address line 2<input value={form.addressLine2} onChange={(event) => set({ addressLine2: event.target.value })} /></label>
        <label>City<input value={form.city} onChange={(event) => set({ city: event.target.value })} required /></label>
        <label>Province / region<input value={form.region} onChange={(event) => set({ region: event.target.value })} required /></label>
        <label>Postal code<input value={form.postalCode} onChange={(event) => set({ postalCode: event.target.value })} required /></label>
        <label>Country<input value={form.country} onChange={(event) => set({ country: event.target.value.toUpperCase() })} required /></label>
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
  return <div className="modal-overlay" role="presentation"><section className="command-dialog quick-create-dialog" role="dialog" aria-modal="true" aria-label={editing ? "Edit partner" : "New partner"}>
    <div className="dialog-header"><h2>{editing ? `Edit ${source?.name}` : "New vendor / customer"}</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
    <form onSubmit={submit}>
      {error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}
      <div className="command-form form-grid">
        <label>Partner code<input value={form.code} onChange={(event) => set({ code: event.target.value.toUpperCase() })} required /></label>
        <label>Name<input value={form.name} onChange={(event) => set({ name: event.target.value })} required /></label>
        <label>Type<select value={form.partnerType} onChange={(event) => set({ partnerType: event.target.value as Partner["type"] })}><option value="customer">Customer</option><option value="vendor">Vendor</option><option value="both">Both</option></select></label>
        <label>Currency<select value={form.currency} onChange={(event) => set({ currency: event.target.value })}><option>CAD</option><option>USD</option><option>EUR</option></select></label>
        <label>Payment terms<select value={form.paymentTerms} onChange={(event) => set({ paymentTerms: event.target.value })}>{PAYMENT_TERMS.map((term) => <option key={term}>{term}</option>)}</select></label>
        <label>Email<input type="email" value={form.email} onChange={(event) => set({ email: event.target.value })} /></label>
        <label>Phone<input value={form.phone} onChange={(event) => set({ phone: event.target.value })} /></label>
        <label>Address line 1<input value={form.addressLine1} onChange={(event) => set({ addressLine1: event.target.value })} /></label>
        <label>Address line 2<input value={form.addressLine2} onChange={(event) => set({ addressLine2: event.target.value })} /></label>
        <label>City<input value={form.city} onChange={(event) => set({ city: event.target.value })} /></label>
        <label>Province / region<input value={form.region} onChange={(event) => set({ region: event.target.value })} /></label>
        <label>Postal code<input value={form.postalCode} onChange={(event) => set({ postalCode: event.target.value })} /></label>
        <label>Country<input value={form.country} onChange={(event) => set({ country: event.target.value.toUpperCase() })} /></label>
        <label>Credit limit<input type="number" min="0" step="0.01" value={form.creditLimit} onChange={(event) => set({ creditLimit: Number(event.target.value) })} /></label>
        <label className="radio-row"><input type="checkbox" checked={form.creditHold} onChange={(event) => set({ creditHold: event.target.checked })} /><span>Credit hold</span></label>
      </div>
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create partner"}</button></div>
    </form>
  </section></div>;
}



function VendorBillsView({ bills }: { bills: Bill[] }) {
  // Exact amounts here: a variance is an exception precisely because it is small, and rounding
  // one to the dollar prints "$0" beside a row that is demanding review.
  return <section className="panel worklist"><div className="responsive-table"><table><caption className="sr-only">Vendor bills</caption><thead><tr><th>Bill</th><th>Vendor</th><th>Purchase order</th><th className="numeric">Authorized line value</th><th className="numeric">Billed line value</th><th className="numeric">Line variance</th><th>Status</th></tr></thead><tbody>{bills.map((bill) => <tr key={bill.id}><td><strong>{bill.number}</strong></td><td>{bill.vendor}</td><td>{bill.po}</td><td className="numeric">{formatDocumentMoney(bill.receivedValue, bill.currency)}</td><td className="numeric">{formatDocumentMoney(bill.billedValue, bill.currency)}</td><td className={`numeric strong ${bill.variance ? "text-danger" : ""}`}>{formatDocumentMoney(bill.variance, bill.currency)}</td><td><StatusBadge>{bill.status}</StatusBadge></td></tr>)}{!bills.length ? <tr><td colSpan={7}><div className="empty-inline">No vendor bills match this view.</div></td></tr> : null}</tbody></table></div></section>;
}

function InvoicesView({ salesOrders }: { salesOrders: SalesOrder[] }) {
  return <section className="panel worklist"><div className="responsive-table"><table><caption className="sr-only">Customer invoice eligibility</caption><thead><tr><th>Sales order</th><th>Customer</th><th className="numeric">Ordered</th><th className="numeric">Posted shipment</th><th className="numeric">Already invoiced</th><th className="numeric">Available to invoice</th><th>State</th></tr></thead><tbody>{salesOrders.map((so) => { const invoiced = so.invoiced ?? 0; const available = Math.max(so.shipped - invoiced, 0); return <tr key={so.id}><td><strong>{so.number}</strong></td><td>{so.customer}</td><td className="numeric">{so.ordered}</td><td className="numeric">{so.shipped}</td><td className="numeric">{invoiced}</td><td className="numeric strong">{available}</td><td><StatusBadge>{so.billing}</StatusBadge></td></tr>; })}{!salesOrders.length ? <tr><td colSpan={7}><div className="empty-inline">No sales orders match this view.</div></td></tr> : null}</tbody></table></div></section>;
}

type ReportKey = "ar-aging" | "open-orders" | "replenishment" | "customer-statement";

type ReportRow = Record<string, unknown>;
type ReportPayload = { rows?: ReportRow[]; totals?: Record<string, number>; asOf?: string; error?: { message?: string } };
const LOCAL_TABLE_PAGE_SIZE = 50;

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
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
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
  const reportPages = Math.max(1, Math.ceil(rows.length / LOCAL_TABLE_PAGE_SIZE));
  const currentReportPage = Math.min(reportPage, reportPages);
  const pageRows = rows.slice((currentReportPage - 1) * LOCAL_TABLE_PAGE_SIZE, currentReportPage * LOCAL_TABLE_PAGE_SIZE);
  const totals = ready ? payload?.totals ?? {} : {};
  const visibleLoading = ready && loading;
  const visibleError = ready ? error : "";
  // Reports are reconciled against invoices and statements, so they carry cents.
  const baseCash = (value: unknown) => formatDocumentMoney(Number(value ?? 0) / 100, "CAD");
  const documentCash = (value: unknown, currency: unknown) => formatDocumentMoney(Number(value ?? 0) / 100, String(currency || "CAD"));
  const exportCsv = () => {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers, ...rows.map((row) => headers.map((key) => row[key]))]
      .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `paneflow-${report}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  return <section className="panel">
    <div className="workspace-tabbar" role="tablist" aria-label="Management reports">
      {reportTabs.filter((tab) => canViewReceivables || tab.key !== "ar-aging" && tab.key !== "customer-statement").map((tab) => <button key={tab.key} role="tab" aria-selected={report === tab.key} className={report === tab.key ? "active" : ""} onClick={() => { setReport(tab.key); setReportPage(1); }}>{tab.label}</button>)}
      <button className="text-button" onClick={exportCsv} disabled={!rows.length}>Export CSV →</button>
    </div>
    {!canViewReceivables ? <p className="read-only-label">Receivables aging and customer statements require accounting, manager, or administrator access.</p> : null}

    {report === "ar-aging" || report === "customer-statement" ? <div className="filter-bar">{report === "customer-statement" ? <label className="project-field">Customer<ReferenceSearchSelect kind="partners" role="customer" value={statementPartner.id} initialOptions={[]} onSelect={(option) => setStatementPartner({ id: option.id, label: option.label })} placeholder="Search a customer" /></label> : null}<label>As of<input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} required /></label></div> : null}

    {visibleLoading ? <div className="empty-inline">Loading…</div> : null}
    {visibleError ? <div className="exception-banner"><span aria-hidden="true">!</span><div><strong>Report unavailable</strong><p>{visibleError}</p></div></div> : null}

    {!visibleLoading && !visibleError && report === "ar-aging" ? <>
      <div className="metric-row object-metrics"><MetricDisplay label="Total outstanding (CAD)" value={baseCash(totals.totalBaseCents)} /><MetricDisplay label="Current (CAD)" value={baseCash(totals.currentBaseCents)} tone="success" /><MetricDisplay label="1–30 days (CAD)" value={baseCash(totals.days1To30BaseCents)} tone="info" /><MetricDisplay label="31–60 days (CAD)" value={baseCash(totals.days31To60BaseCents)} tone="warning" /><MetricDisplay label="61–90 days (CAD)" value={baseCash(totals.days61To90BaseCents)} tone="warning" /><MetricDisplay label="Over 90 days (CAD)" value={baseCash(totals.over90BaseCents)} tone="danger" /></div>
      <div className="responsive-table"><table><caption className="sr-only">Accounts receivable aging by customer in company base currency</caption><thead><tr><th>Customer</th><th className="numeric">Current CAD</th><th className="numeric">1–30 CAD</th><th className="numeric">31–60 CAD</th><th className="numeric">61–90 CAD</th><th className="numeric">90+ CAD</th><th className="numeric">Total CAD</th><th>Credit</th></tr></thead><tbody>{pageRows.map((row) => { const comparableCredit = String(row.documentCurrency) === String(row.partnerCurrency); return <tr key={String(row.customerId)}><td><strong>{String(row.customerName)}</strong><small>{String(row.customerCode)} · {Number(row.invoiceCount ?? 0)} invoice{Number(row.invoiceCount ?? 0) === 1 ? "" : "s"}</small></td><td className="numeric">{baseCash(row.currentBaseCents)}</td><td className="numeric">{baseCash(row.days1To30BaseCents)}</td><td className="numeric">{baseCash(row.days31To60BaseCents)}</td><td className={`numeric ${Number(row.days61To90BaseCents ?? 0) > 0 ? "text-danger" : ""}`}>{baseCash(row.days61To90BaseCents)}</td><td className={`numeric strong ${Number(row.over90BaseCents ?? 0) > 0 ? "text-danger" : ""}`}>{baseCash(row.over90BaseCents)}</td><td className="numeric strong">{baseCash(row.totalBaseCents)}</td><td>{Number(row.creditHold ?? 0) ? <StatusBadge tone="danger">Hold</StatusBadge> : !comparableCredit ? <StatusBadge tone="warning">Mixed currency</StatusBadge> : Number(row.creditLimitCents ?? 0) && Number(row.documentOutstandingCents ?? 0) > Number(row.creditLimitCents ?? 0) ? <StatusBadge tone="warning">Over limit</StatusBadge> : <StatusBadge tone="success">OK</StatusBadge>}</td></tr>; })}{!rows.length ? <tr><td colSpan={8}><div className="empty-inline">No outstanding customer balances.</div></td></tr> : null}</tbody></table></div>
    </> : null}

    {!visibleLoading && !visibleError && report === "open-orders" ? <>
      <div className="metric-row object-metrics"><MetricDisplay label="Open item value (CAD)" value={baseCash(totals.openBaseValueCents)} tone="info" /><MetricDisplay label="Open units" value={Number(totals.openQuantity ?? 0)} /></div>
      <div className="responsive-table"><table><caption className="sr-only">Open sales-order commitment by customer in company base currency</caption><thead><tr><th>Customer</th><th className="numeric">Orders</th><th className="numeric">Ordered units</th><th className="numeric">Open units</th><th className="numeric">Open item value CAD</th><th>Earliest requested</th></tr></thead><tbody>{pageRows.map((row) => <tr key={String(row.customerId)}><td><strong>{String(row.customerName)}</strong><small>{String(row.customerCode)}</small></td><td className="numeric">{Number(row.orderCount ?? 0)}</td><td className="numeric">{Number(row.orderedQuantity ?? 0)}</td><td className="numeric strong">{Number(row.openQuantity ?? 0)}</td><td className="numeric strong">{baseCash(row.openBaseValueCents)}</td><td>{formatDate(String(row.earliestRequestedDate ?? ""))}</td></tr>)}{!rows.length ? <tr><td colSpan={6}><div className="empty-inline">No open sales-order commitment.</div></td></tr> : null}</tbody></table></div>
    </> : null}

    {!visibleLoading && !visibleError && report === "replenishment" ? <>
      <div className="metric-row object-metrics"><MetricDisplay label="Products to buy" value={Number(totals.lineCount ?? 0)} tone={Number(totals.lineCount ?? 0) > 0 ? "warning" : "success"} /><MetricDisplay label="Suggested purchase value (CAD)" value={baseCash(totals.suggestedValueCents)} /></div>
      <div className="responsive-table"><table><caption className="sr-only">Products at or below their reorder point</caption><thead><tr><th>Product</th><th className="numeric">Available</th><th className="numeric">Incoming</th><th className="numeric">Open demand</th><th className="numeric">Projected</th><th className="numeric">Reorder point</th><th className="numeric">Suggested order</th><th>Last vendor</th></tr></thead><tbody>{pageRows.map((row) => <tr key={String(row.id)}><td><strong>{String(row.name)}</strong><small>{String(row.sku)}</small></td><td className="numeric">{Number(row.availableQuantity ?? 0)}</td><td className="numeric">{Number(row.incomingQuantity ?? 0)}</td><td className="numeric">{Number(row.openDemandQuantity ?? 0)}</td><td className={`numeric strong ${Number(row.projectedQuantity ?? 0) < 0 ? "text-danger" : ""}`}>{Number(row.projectedQuantity ?? 0)}</td><td className="numeric">{Number(row.reorderPoint ?? 0)}</td><td className="numeric strong">{Number(row.suggestedOrderQuantity ?? 0)}</td><td>{String(row.lastVendorName ?? "No purchase history")}</td></tr>)}{!rows.length ? <tr><td colSpan={8}><div className="empty-inline">Every stocked product is projected at or above its reorder point.</div></td></tr> : null}</tbody></table></div>
    </> : null}

    {!visibleLoading && !visibleError && report === "customer-statement" ? (!statementPartner.id ? <div className="empty-inline">Select a customer to produce a statement.</div> : <>
      <div className="metric-row object-metrics"><MetricDisplay label={`${statementPartner.label} outstanding (CAD)`} value={baseCash(totals.outstandingBaseCents)} tone={Number(totals.outstandingBaseCents ?? 0) > 0 ? "warning" : "success"} /><MetricDisplay label="Invoices" value={Number(totals.invoiceCount ?? 0)} /></div>
      <div className="responsive-table"><table><caption className="sr-only">Customer statement with document-currency amounts</caption><thead><tr><th>Invoice</th><th>Sales order</th><th>Invoiced</th><th>Due</th><th className="numeric">Total</th><th className="numeric">Paid</th><th className="numeric">Credited</th><th className="numeric">Outstanding</th><th>Age</th></tr></thead><tbody>{pageRows.map((row) => <tr key={String(row.id)}><td><strong>{String(row.number)}</strong><small>{String(row.currency || "CAD")}</small></td><td>{String(row.salesOrderNumber ?? "—")}</td><td>{formatDate(String(row.invoiceDate ?? ""))}</td><td>{formatDate(String(row.dueDate ?? ""))}</td><td className="numeric">{documentCash(row.totalCents, row.currency)}</td><td className="numeric">{documentCash(row.paidCents, row.currency)}</td><td className="numeric">{documentCash(row.creditedCents, row.currency)}</td><td className="numeric strong">{documentCash(row.outstandingCents, row.currency)}</td><td>{Number(row.outstandingCents ?? 0) <= 0 ? <StatusBadge tone="success">Settled</StatusBadge> : Number(row.daysPastDue ?? 0) > 0 ? <StatusBadge tone="danger">{Number(row.daysPastDue)} days late</StatusBadge> : <StatusBadge tone="info">Current</StatusBadge>}</td></tr>)}{!rows.length ? <tr><td colSpan={9}><div className="empty-inline">No invoices for this customer.</div></td></tr> : null}</tbody></table></div>
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
  const today = new Date().toISOString().slice(0, 10);
  const [exportFrom, setExportFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [exportTo, setExportTo] = useState(today);
  const validRange = Boolean(exportFrom && exportTo) && exportFrom <= exportTo;
  const products = scope === "risk" ? snapshot.products.filter((product) => product.projected < 0 || product.available <= product.reorderPoint) : snapshot.products;
  const productPages = Math.max(1, Math.ceil(products.length / LOCAL_TABLE_PAGE_SIZE));
  const currentProductPage = Math.min(productPage, productPages);
  const visibleProducts = products.slice((currentProductPage - 1) * LOCAL_TABLE_PAGE_SIZE, currentProductPage * LOCAL_TABLE_PAGE_SIZE);
  const exportCsv = () => {
    const rows = [["SKU", "Product", "Usable", "Incoming", "Demand", "Projected"], ...products.map((product) => [product.sku, product.name, product.usable, product.incoming, product.demand, product.projected])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `paneflow-availability-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  // The four static cards that used to sit here restated dashboard numbers and did nothing when
  // clicked, so they occupied a screen of a reporting workspace without answering a question.
  return <div className="stack"><ManagementReports warehouseId={warehouseId} canViewReceivables={canViewFinancialReports} /><section className="panel"><PanelHeading title="Projected availability" /><div className="report-filters"><label>Scope<select value={scope} onChange={(event) => { setScope(event.target.value as "all" | "risk"); setProductPage(1); }}><option value="all">All products</option><option value="risk">Risks only</option></select></label><button className="button secondary" onClick={exportCsv}>Export current table</button></div>{canViewFinancialReports ? <div className="report-filters"><label>Accounting period from<input type="date" value={exportFrom} max={exportTo} onChange={(event) => setExportFrom(event.target.value)} /></label><label>to<input type="date" value={exportTo} min={exportFrom} onChange={(event) => setExportTo(event.target.value)} /></label><a className={`button secondary ${validRange ? "" : "disabled"}`} aria-disabled={!validRange} href={validRange ? `/api/export?type=accounting&from=${exportFrom}&to=${exportTo}` : undefined}>Accounting control export</a><a className={`button primary ${validRange ? "" : "disabled"}`} aria-disabled={!validRange} href={validRange ? `/api/export?type=quickbooks&from=${exportFrom}&to=${exportTo}` : undefined}>Export QuickBooks journal</a></div> : <p className="read-only-label">Accounting journal exports require accounting, manager, or administrator access.</p>}<div className="responsive-table"><table><caption className="sr-only">Projected product availability</caption><thead><tr><th>Product</th><th className="numeric">Usable now</th><th className="numeric">Incoming</th><th className="numeric">Open demand</th><th className="numeric">Projected</th><th>Risk</th></tr></thead><tbody>{visibleProducts.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.sku}</small></td><td className="numeric">{product.usable}</td><td className="numeric">{product.incoming}</td><td className="numeric">{product.demand}</td><td className={`numeric strong ${product.projected < 0 ? "text-danger" : ""}`}>{product.projected}</td><td>{product.projected < 0 ? <StatusBadge tone="danger">Demand exceeds supply</StatusBadge> : <StatusBadge tone="success">Covered</StatusBadge>}</td></tr>)}{!products.length ? <tr><td colSpan={6}><div className="empty-inline">No products are available in this scope.</div></td></tr> : null}</tbody></table></div><LocalTablePager label="Projected availability pages" page={currentProductPage} pages={productPages} setPage={setProductPage} /></section></div>;
}

function WarehouseView({ snapshot, source, lastUpdatedAt, canOperate, onReceive, navigate }: { snapshot: Snapshot; source: "loading" | "server" | "unavailable"; lastUpdatedAt: Date | null; canOperate: boolean; onReceive: (po: PurchaseOrder) => void; navigate: (view: ViewKey, status?: string, tab?: string) => void }) {
  const orders = snapshot.purchaseOrders.filter((po) => po.lifecycle.toLowerCase() === "approved" && po.open > 0);
  // Put-away means stock sitting in a location typed "receiving". This used to regex the
  // product's display location name, so unless a bin was literally called "Receiving" the tile
  // read zero forever — a warehouse task that could never be seen.
  const receivingLocationIds = new Set(snapshot.locations.filter((location) => location.locationType === "receiving").map((location) => location.id));
  const awaitingPutAway = snapshot.inventoryBalances.filter((balance) => receivingLocationIds.has(balance.locationId) && balance.recordedQuantity > 0);
  const [scan, setScan] = useState("");
  const next = orders[0];
  const scanned = scan.trim().toLowerCase();
  const scanMatch = scanned ? orders.find((po) => po.number.toLowerCase().includes(scanned) || po.lines.some((line) => line.sku.toLowerCase().includes(scanned))) : undefined;
  // Receive and pick counts come from the whole-database summary. Counting the current page
  // capped every queue at the page size, so a warehouse with 300 open receipts was told it had
  // 50 — and the tile disagreed with the worklist it opens.
  const tasks: Array<{ label: string; count: number; glyph: string; view: ViewKey; tab?: string }> = [
    { label: "Receive", count: snapshot.summary.dueReceipts, glyph: "↓", view: "expected-receipts" },
    { label: "Put away", count: awaitingPutAway.length, glyph: "↳", view: "stock", tab: "transfers" },
    { label: "Pick / ship", count: snapshot.summary.readyToShip, glyph: "→", view: "fulfillment" },
    { label: "Count locations", count: snapshot.summary.countableBalances, glyph: "#", view: "counts" },
  ];
  const selected = scanned ? scanMatch : next;
  const postingAvailable = source === "server" && canOperate;
  return <div className="warehouse-shell"><div className="warehouse-header"><div><span className={`connection ${source}`}><span /> {source === "server" ? "Live operations" : source === "loading" ? "Connecting…" : "Offline — read only"}</span><h2>Warehouse work</h2>{lastUpdatedAt ? <small>Data refreshed {displayTimestamp(lastUpdatedAt.toISOString())}</small> : null}</div><div className="warehouse-user"><span>{initials(snapshot.viewer.name)}</span><div><strong>{snapshot.viewer.name || "Signing in…"}</strong><small>{snapshot.viewer.role ? titleCase(snapshot.viewer.role) : ""}</small></div></div></div><section className="warehouse-launcher" aria-label="Warehouse work">{tasks.map((task) => <button type="button" key={task.label} onClick={() => navigate(task.view, undefined, task.tab)}><span className="task-glyph" aria-hidden="true">{task.glyph}</span><strong>{task.label}</strong><small>{task.count} work item{task.count === 1 ? "" : "s"}</small></button>)}</section>{next ? <section className="warehouse-next"><div className="step-header"><span>Next receipt</span><StatusBadge tone={next.daysLate > 0 ? "danger" : "info"}>{next.daysLate > 0 ? `${next.daysLate} days late` : formatDate(next.expectedDate)}</StatusBadge></div><h3>{selected ? `Receive ${selected.number}` : "No matching receipt"}</h3><p>{selected ? `${selected.vendor} · ${selected.customerRef ?? "Stock replenishment"}` : "Scan a different purchase order or SKU."}</p><form className="scan-zone" onSubmit={(event) => { event.preventDefault(); if (postingAvailable && selected) onReceive(selected); }}><span aria-hidden="true">▤</span><div><strong>Scan a purchase order or SKU</strong>{scanned && !scanMatch ? <small className="text-danger">No approved open purchase order matches “{scan.trim()}”.</small> : null}</div><input aria-label="Scan purchase order or SKU" placeholder="Scan or type code" autoComplete="off" value={scan} onChange={(event) => setScan(event.target.value)} /></form><button className="warehouse-primary" disabled={!postingAvailable || !selected} onClick={() => { if (selected) onReceive(selected); }}>{postingAvailable ? selected ? `Start receiving ${selected.number}` : "Scan a valid receipt" : "Posting unavailable"}</button></section> : <section className="warehouse-next"><div className="empty-inline">No approved purchase order currently has quantity open to receive.</div></section>}</div>;
}


function ReferenceSearchSelect({ kind, role, partnerId, quantity = 1, warehouseId, currency, exchangeRateToBase, value, initialOptions, onSelect, placeholder, quickCreate }: { kind: LookupKind; role?: string; partnerId?: string; quantity?: number; warehouseId?: string; currency?: string; exchangeRateToBase?: number; value: string; initialOptions: LookupOption[]; onSelect: (option: LookupOption) => void; placeholder: string; quickCreate?: QuickCreateKind }) {
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
    detail: [text(item.customerName), text(item.productName), titleCase(text(item.fulfillmentRoute))].filter(Boolean).join(" · "),
  } : kind === "purchaseOrderLines" ? {
    id: text(item.id),
    label: `${text(item.orderNumber)} · ${text(item.sku)}`,
    detail: [text(item.vendorName), text(item.productName)].filter(Boolean).join(" · "),
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
  } : kind === "locations" ? {
    id: text(item.id),
    label: `${text(item.warehouseCode)} · ${text(item.code)} · ${text(item.name)}`,
    detail: `${text(item.warehouseName)} · ${titleCase(text(item.inventoryStatus))}`,
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
  };
  return <RemoteSearchSelect
    kind={kind}
    role={role}
    partnerId={partnerId}
    quantity={quantity}
    warehouseId={warehouseId}
    currency={currency}
    exchangeRateToBase={exchangeRateToBase}
    value={value}
    placeholder={placeholder}
    initialOptions={initialOptions}
    quickCreate={quickCreate}
    mapItem={mapItem}
    onSelect={(option) => onSelect(option as LookupOption)}
  />;
}

type ComposerDraftLine = {
  id: string; productId: string; label: string; quantity: number; unitAmount: number;
  uomId: string; uomCode: string; route: string; projectReference: string;
  discountCents: number; taxable: boolean; taxRateBps: number;
  sourceSalesOrderLineId: string; linkedPurchaseOrderLineId: string;
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
        sourceSalesOrderLineId: line.sourceSalesOrderLineId ?? "", linkedPurchaseOrderLineId: "",
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
      sourceSalesOrderLineId: "", linkedPurchaseOrderLineId: line.linkedPurchaseOrderLineId ?? "",
    })),
  };
}

function AdvancedCreateOrderDialog({ type, initialOrder, partners, products, warehouseId, defaultTaxRateBps, onClose, onSubmit }: { type: "purchaseOrder" | "salesOrder"; initialOrder?: SalesOrder | PurchaseOrder; partners: Partner[]; products: Product[]; warehouseId: string; defaultTaxRateBps: number; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
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
    unitAmount: isPurchase ? product.standardCost : product.sellingPrice,
    uomId: isPurchase ? product.purchaseUomId : product.salesUomId,
    uomCode: isPurchase ? product.purchaseUomCode : product.salesUomCode,
    priceSource: isPurchase ? "Catalog standard cost" : "Catalog selling price",
  }));
  draft?.lines.forEach((line) => { if (!initialProductOptions.some((option) => option.id === line.productId)) initialProductOptions.push({ id: line.productId, label: line.label, detail: line.projectReference || "Current draft line" }); });
  // Lines start empty: pre-filling an arbitrary catalog product is how the wrong SKU
  // gets ordered when someone tabs past it.
  const initialLine = (): ComposerLine => ({ id: crypto.randomUUID(), productId: "", quantity: 1, unitAmount: 0, uomId: "", uomCode: "", priceSource: "Select a product", discountRate: 0, taxCode: defaultTaxRateBps > 0 ? "GST" : "Zero", taxRate: defaultTaxRateBps / 100, route: "stock", projectReference: "", sourceSalesOrderLineId: "", linkedPurchaseOrderLineId: "" });
  const existingLines: ComposerLine[] = (draft?.lines ?? []).map((line) => ({
    id: line.id, productId: line.productId, quantity: line.quantity, unitAmount: line.unitAmount,
    uomId: line.uomId || products.find((product) => product.id === line.productId)?.[isPurchase ? "purchaseUomId" : "salesUomId"] || "",
    uomCode: line.uomCode || products.find((product) => product.id === line.productId)?.[isPurchase ? "purchaseUomCode" : "salesUomCode"] || "",
    priceSource: "Saved order price",
    discountRate: line.quantity * line.unitAmount > 0 ? line.discountCents / (line.quantity * line.unitAmount) : 0,
    taxCode: line.taxable ? "GST" : "Exempt", taxRate: line.taxRateBps / 100,
    route: line.route.replaceAll("_", "-"), projectReference: line.projectReference || draft?.projectReference || "",
    sourceSalesOrderLineId: line.sourceSalesOrderLineId, linkedPurchaseOrderLineId: line.linkedPurchaseOrderLineId,
  }));
  // No partner is pre-selected: the first alphabetical account is never a safe guess.
  const [partnerId, setPartnerId] = useState(draft?.partnerId ?? "");
  const [date, setDate] = useState(draft?.date ?? futureDate(isPurchase ? 14 : 21));
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
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!partnerId) return setError(`Select a ${isPurchase ? "vendor" : "customer"}.`);
    if (!lines.length || lines.some((line) => !line.productId || !line.uomId || line.quantity <= 0 || line.unitAmount < 0)) return setError("Every line needs a product with a configured unit, positive quantity, and valid unit amount.");
    if (isPurchase && lines.some((line) => line.route !== "stock" && !line.sourceSalesOrderLineId.trim())) return setError("Every special-order or drop-ship purchase line must link to its source sales-order line ID.");
    if (!date || !dueDate) return setError("Enter delivery and due dates.");
    if (![freightTaxRate, feeTaxRate].every((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 100)) return setError("Freight and fee tax rates must be between 0% and 100%.");
    if (!isPurchase && (!shipToName.trim() || !shipToAddressLine1.trim() || !shipToCity.trim() || !shipToRegion.trim() || !shipToPostalCode.trim() || !shipToCountry.trim())) return setError("Enter a complete ship-to name and address before saving the sales-order draft.");
    if (currency !== "CAD" && exchangeRate <= 0) return setError("Enter a positive exchange rate for the foreign currency.");
    setSubmitting(true);
    try {
      const normalizedLines = lines.map((line) => {
        const product = productOptions[line.productId];
        return { kind: "item", productId: line.productId, quantity: line.quantity, uomId: line.uomId, unitCostCents: isPurchase ? Math.round(line.unitAmount * 100) : undefined, unitPriceCents: isPurchase ? undefined : Math.round(line.unitAmount * 100), discountCents: Math.round(line.quantity * line.unitAmount * line.discountRate), taxable: line.taxRate > 0, taxCode: line.taxCode, taxRateBps: Math.round(line.taxRate * 100), fulfillmentRoute: line.route.replaceAll("-", "_"), projectReference: line.projectReference, sourceSalesOrderLineId: isPurchase && line.route !== "stock" ? line.sourceSalesOrderLineId.trim() : undefined, configurationSnapshot: product ? `${product.label} · ${product.detail}` : undefined };
      });
      const chargeLines = [
        freight > 0 ? { kind: "charge", chargeType: "freight", description: "Freight", amountCents: Math.round(freight * 100), direction: "add", taxable: freightTaxRate > 0, refundable: false, taxCode: freightTaxRate > 0 ? "GST" : "Zero", taxRateBps: Math.round(freightTaxRate * 100) } : null,
        fees > 0 ? { kind: "charge", chargeType: "fee", description: "Other fees", amountCents: Math.round(fees * 100), direction: "add", taxable: feeTaxRate > 0, refundable: false, taxCode: feeTaxRate > 0 ? "GST" : "Zero", taxRateBps: Math.round(feeTaxRate * 100) } : null,
        deposit > 0 ? { kind: "charge", chargeType: "returnable_deposit", description: "Refundable core / empty deposit", amountCents: Math.round(deposit * 100), direction: "add", taxable: false, refundable: true, taxCode: "EXEMPT", taxRateBps: 0 } : null,
      ].filter(Boolean);
      await onSubmit({ ...(isPurchase ? { vendorId: partnerId, expectedDate: date } : { customerId: partnerId, requestedDate: date, shipToName, shipToAddressLine1, shipToAddressLine2, shipToCity, shipToRegion, shipToPostalCode, shipToCountry, deliveryInstructions }), lines: [...normalizedLines, ...chargeLines], currency, exchangeRateToBase: exchangeRate, paymentTerms: terms, dueDate, projectReference: draft?.projectReference });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The order could not be created. Your entries are still here."); }
    finally { setSubmitting(false); }
  };

  const impact = [
    { category: "Physical inventory", label: "On-hand inventory", after: "No change" },
    { category: "Commercial commitment", label: isPurchase ? "Expected incoming" : "Customer demand", before: 0, after: `${quantity} units across ${lines.length} lines`, tone: "info" as Severity },
    { category: "Commercial commitment", label: "Fulfillment routes", after: [...new Set(lines.map((line) => line.route))].join(", ") },
    { category: "Financial effect", label: "Draft total", before: money.format(0), after: `${currency} ${total.toFixed(2)}` },
    { category: "Financial effect", label: "Refundable core / empty deposit", after: `${currency} ${deposit.toFixed(2)}` },
  ];

  return <div className="modal-overlay" role="presentation"><section className="command-dialog create-order-dialog commercial-composer" role="dialog" aria-modal="true" aria-labelledby="create-order-title"><div className="dialog-header"><div><span className="section-kicker">{editing ? draft?.number : "New commercial commitment"}</span><h2 id="create-order-title">{editing ? `Edit ${isPurchase ? "purchase" : "sales"} order draft` : `Create multi-line ${isPurchase ? "purchase order" : "sales order"}`}</h2></div><button ref={closeRef} className="icon-button" aria-label="Close dialog" onClick={onClose}>×</button></div><form onSubmit={submit}>
    {error && <div className="error-summary" role="alert" tabIndex={-1}><strong>Review the order</strong><p>{error}</p></div>}
    <div className="command-form form-grid composer-header-fields"><label>{isPurchase ? "Vendor" : "Customer"}<ReferenceSearchSelect kind="partners" role={partnerRole} value={partnerId} initialOptions={initialPartnerOptions} quickCreate={partnerRole} onSelect={(option) => { setPartnerId(option.id); const nextCurrency = option.currency || "CAD"; const nextTerms = option.paymentTerms || (isPurchase ? "Net 30" : "Net 15"); setCurrency(nextCurrency); setExchangeRate(nextCurrency === "CAD" ? 1 : 0); setTerms(nextTerms); setDueDate(dueDateForTerms(date, nextTerms)); if (!isPurchase) { setShipToName(option.label); setShipToAddressLine1(option.addressLine1 ?? ""); setShipToAddressLine2(option.addressLine2 ?? ""); setShipToCity(option.city ?? ""); setShipToRegion(option.region ?? ""); setShipToPostalCode(option.postalCode ?? ""); setShipToCountry(option.country ?? "CA"); } }} placeholder={`Search ${partnerRole} name, code, or email`} /></label><label>{isPurchase ? "Expected delivery" : "Requested delivery"}<input type="date" value={date} onChange={(event) => { const nextDate = event.target.value; setDate(nextDate); setDueDate(dueDateForTerms(nextDate, terms)); }} /></label><label>Currency<select value={currency} onChange={(event) => { const nextCurrency = event.target.value; setCurrency(nextCurrency); setExchangeRate(nextCurrency === "CAD" ? 1 : 0); }}><option>CAD</option><option>USD</option><option>EUR</option></select></label>{currency !== "CAD" && <label>Exchange rate to CAD<input type="number" min="0.0001" step="0.0001" value={exchangeRate} onChange={(event) => setExchangeRate(Number(event.target.value))} /></label>}<label>Payment terms<select value={terms} onChange={(event) => { const nextTerms = event.target.value; setTerms(nextTerms); setDueDate(dueDateForTerms(date, nextTerms)); }}>{PAYMENT_TERMS.map((term) => <option key={term}>{term}</option>)}</select></label><label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div>
    {!isPurchase ? <fieldset className="composer-lines"><legend>Ship-to address</legend><div className="command-form form-grid composer-header-fields"><label className="project-field">Saved job site / ship-to<ReferenceSearchSelect kind="partnerAddresses" partnerId={partnerId} value={shipToAddressId} initialOptions={[]} onSelect={(option) => { setShipToAddressId(option.id); setShipToName(option.contactName || option.label); setShipToAddressLine1(option.addressLine1 ?? ""); setShipToAddressLine2(option.addressLine2 ?? ""); setShipToCity(option.city ?? ""); setShipToRegion(option.region ?? ""); setShipToPostalCode(option.postalCode ?? ""); setShipToCountry(option.country ?? "CA"); if (option.deliveryInstructions) setDeliveryInstructions(option.deliveryInstructions); }} placeholder={partnerId ? "Search this customer's saved addresses" : "Select a customer first"} /></label><label>Recipient<input value={shipToName} onChange={(event) => setShipToName(event.target.value)} required /></label><label>Address line 1<input value={shipToAddressLine1} onChange={(event) => setShipToAddressLine1(event.target.value)} required /></label><label>Address line 2<input value={shipToAddressLine2} onChange={(event) => setShipToAddressLine2(event.target.value)} /></label><label>City<input value={shipToCity} onChange={(event) => setShipToCity(event.target.value)} required /></label><label>Province / region<input value={shipToRegion} onChange={(event) => setShipToRegion(event.target.value)} required /></label><label>Postal code<input value={shipToPostalCode} onChange={(event) => setShipToPostalCode(event.target.value)} required /></label><label>Country<input value={shipToCountry} onChange={(event) => setShipToCountry(event.target.value.toUpperCase())} required /></label><label>Delivery instructions<input value={deliveryInstructions} onChange={(event) => setDeliveryInstructions(event.target.value)} placeholder="Dock, access, or appointment details" /></label></div><div className="composer-address-actions"><button type="button" className="button secondary" disabled={savingAddress || !partnerId || !shipToAddressLine1.trim() || !shipToCity.trim()} onClick={() => void saveShipToAddress()}>{savingAddress ? "Saving…" : "Save to this customer's address book"}</button>{addressNotice ? <span className="read-only-label" role="status">{addressNotice}</span> : null}</div></fieldset> : null}
    <section className="composer-lines" aria-labelledby="composer-lines-title">
      <div className="composer-section-heading"><div><strong id="composer-lines-title">Product lines</strong></div><button type="button" className="button secondary" onClick={() => setLines((current) => [...current, initialLine()])}>Add product line</button></div>
      {lines.map((line, index) => {
        const selected = productOptions[line.productId];
        return <fieldset key={line.id} className="composer-line">
          <legend>Line {index + 1}</legend>
          <label className="product-field">Product / configuration<ReferenceSearchSelect kind="products" role={partnerRole} partnerId={partnerId} quantity={line.quantity} warehouseId={warehouseId} currency={currency} exchangeRateToBase={exchangeRate} value={line.productId} initialOptions={line.productId && productOptions[line.productId] ? [productOptions[line.productId]] : []} quickCreate="product" onSelect={(option) => { setProductOptions((current) => ({ ...current, [option.id]: option })); updateLine(line.id, { productId: option.id, ...(option.unitAmount != null ? { unitAmount: option.unitAmount } : {}), uomId: option.uomId ?? "", uomCode: option.uomCode ?? "", priceSource: option.priceSource ?? "Catalog price" }); }} placeholder="Search SKU, name, manufacturer SKU, or dimensions" /><small>{selected?.detail}</small></label>
          <label>Quantity ({line.uomCode || "unit"})<input type="number" min="1" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} />{line.uomCode ? null : <small>Select a configured product unit</small>}</label>
          <label>Unit {isPurchase ? "cost" : "price"}<input type="number" min="0" step="0.01" value={line.unitAmount} onChange={(event) => updateLine(line.id, { unitAmount: Number(event.target.value), priceSource: "Manual override" })} /><small>{line.priceSource}</small></label>
          <label>Discount %<input type="number" min="0" max="100" step="0.1" value={line.discountRate} onChange={(event) => updateLine(line.id, { discountRate: Number(event.target.value) })} /></label>
          <label>Tax code<select value={line.taxCode} onChange={(event) => updateLine(line.id, { taxCode: event.target.value, taxRate: event.target.value === "GST" ? defaultTaxRateBps / 100 : 0 })}><option>GST</option><option>Zero</option><option>Exempt</option></select></label>
          <label>Tax %<input type="number" min="0" value={line.taxRate} onChange={(event) => updateLine(line.id, { taxRate: Number(event.target.value) })} /></label>
          <label>Fulfillment route<select value={line.route} onChange={(event) => updateLine(line.id, { route: event.target.value as ComposerLine["route"] })}><option value="stock">Stock</option><option value="special-order">Special order</option><option value="drop-ship">Drop ship</option></select></label>
          <label className="project-field">Customer / project / opening<input value={line.projectReference} onChange={(event) => updateLine(line.id, { projectReference: event.target.value })} placeholder="Optional allocation" /></label>
          {isPurchase && line.route !== "stock" ? <label className="project-field">Source customer demand<ReferenceSearchSelect kind="salesOrderLines" role={line.route === "drop-ship" ? "drop_ship" : "special_order"} partnerId={initialOrder?.id} value={line.sourceSalesOrderLineId} initialOptions={[]} onSelect={(option) => updateLine(line.id, { sourceSalesOrderLineId: option.id })} placeholder="Search unlinked sales order, customer, or SKU" /></label> : null}
          {!isPurchase && line.route !== "stock" ? <div className="project-field read-only-label">Save this demand first. Dedicated supply is linked from the purchase-order composer so both sides are recorded atomically.</div> : null}
          {lines.length > 1 && <button type="button" className="remove-composer-line" onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}>Remove line {index + 1}</button>}
        </fieldset>;
      })}
    </section>
    <div className="composer-bottom-grid"><fieldset className="composer-charges"><legend>Charges, fees, and deposits</legend><label>Freight<input type="number" min="0" step="0.01" value={freight} onChange={(event) => setFreight(Number(event.target.value))} /></label><label>Freight tax %<input type="number" min="0" max="100" step="0.01" value={freightTaxRate} onChange={(event) => setFreightTaxRate(Number(event.target.value))} /></label><label>Other fees<input type="number" min="0" step="0.01" value={fees} onChange={(event) => setFees(Number(event.target.value))} /></label><label>Fee tax %<input type="number" min="0" max="100" step="0.01" value={feeTaxRate} onChange={(event) => setFeeTaxRate(Number(event.target.value))} /></label><label>Refundable core / empty deposit<input type="number" min="0" step="0.01" value={deposit} onChange={(event) => setDeposit(Number(event.target.value))} /></label></fieldset><dl className="composer-totals"><div><dt>Items</dt><dd>{currency} {itemSubtotal.toFixed(2)}</dd></div><div><dt>Discounts</dt><dd>−{currency} {discountTotal.toFixed(2)}</dd></div><div><dt>Freight & fees</dt><dd>{currency} {(freight + fees).toFixed(2)}</dd></div><div><dt>Refundable deposits</dt><dd>{currency} {deposit.toFixed(2)}</dd></div><div><dt>Tax</dt><dd>{currency} {taxTotal.toFixed(2)}</dd></div><div className="total"><dt>Draft total</dt><dd>{currency} {total.toFixed(2)}</dd></div></dl></div>
    <ImpactPreview lines={impact} /><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Keep editing later</button><button type="submit" className="button primary" disabled={submitting}>{submitting ? "Saving draft…" : editing ? "Save draft changes" : `Save ${isPurchase ? "purchase" : "sales"} order draft`}</button></div>
  </form></section></div>;
}

type CommandPanelProps = {
  command: ActiveCommand;
  warehouseId: string;
  po?: PurchaseOrder;
  so?: SalesOrder;
  locations: LocationOption[];
  countBalances: InventoryLocationBalance[];
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onRequestCountApproval: (payload: Record<string, unknown>) => Promise<{ approval: CountApproval; message: string }>;
  onApproveCountApproval: (approval: CountApproval, reason: string) => Promise<{ approval: CountApproval; message: string }>;
  onRefreshCountApproval: (approval: CountApproval) => Promise<CountApproval>;
};

function CommandPanel({ command, warehouseId, po, so, locations, countBalances, onClose, onSubmit, onRequestCountApproval, onApproveCountApproval, onRefreshCountApproval }: CommandPanelProps) {
  const initialPoLine = po?.lines.find((line) => command.kind === "reopen" ? line.closed > 0 : command.kind === "vendor-return" ? line.received - line.returned > 0 : line.open > 0) ?? po?.lines[0];
  const initialSoLine = so?.lines?.find((line) => command.kind === "ship" ? line.reserved > 0 : line.open > 0) ?? so?.lines?.[0];
  const [selectedPoLineId, setSelectedPoLineId] = useState(initialPoLine?.id ?? "");
  const [selectedSoLineId, setSelectedSoLineId] = useState(initialSoLine?.id ?? "");
  const selectedPoLine = po?.lines.find((line) => line.id === selectedPoLineId) ?? initialPoLine;
  const selectedSoLine = so?.lines?.find((line) => line.id === selectedSoLineId) ?? initialSoLine;
  const effectivePo = po && selectedPoLine ? { ...po, ordered: selectedPoLine.ordered, received: selectedPoLine.received, returned: selectedPoLine.returned, closed: selectedPoLine.closed, open: selectedPoLine.open, lines: [selectedPoLine] } : po;
  const salesFactor = selectedSoLine?.uomFactorToBase || 1;
  // Supply comes with the line itself. Reading it out of the snapshot's product page meant
  // "0 available" wherever that page did not happen to include this SKU, which disabled
  // Reserve on every order and defaulted the quantity to 1 instead of what is really there.
  const lineAvailable = Math.min(selectedSoLine?.open ?? 0, (selectedSoLine?.productAvailable ?? 0) / salesFactor);
  const lineIncoming = Math.min(Math.max((selectedSoLine?.open ?? 0) - lineAvailable, 0), (selectedSoLine?.productIncoming ?? 0) / salesFactor);
  const effectiveSo = so && selectedSoLine ? { ...so, ordered: selectedSoLine.ordered, reserved: selectedSoLine.reserved, shipped: selectedSoLine.shipped, open: selectedSoLine.open, availableNow: lineAvailable, incomingBeforeDate: lineIncoming, shortage: Math.max(selectedSoLine.open - lineAvailable - lineIncoming, 0), route: titleCase(selectedSoLine.fulfillmentRoute), lines: [selectedSoLine] } : so;
  const defaults = commandDefaults(command.kind, effectivePo, effectiveSo);
  const initialBalance = countBalances.find((item) => item.locationId === command.locationId) ?? countBalances[0];
  const [quantity, setQuantity] = useState(command.kind === "count" ? initialBalance?.recordedQuantity ?? 0 : defaults.quantity);
  const [secondaryQuantity, setSecondaryQuantity] = useState(defaults.secondaryQuantity);
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState(defaults.disposition);
  const [expectedDate, setExpectedDate] = useState(futureDate(7));
  const [carrier, setCarrier] = useState("");
  const [serviceLevel, setServiceLevel] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [billOfLadingNumber, setBillOfLadingNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [countApproval, setCountApproval] = useState<CountApproval | null>(null);
  const [approvedCountPayload, setApprovedCountPayload] = useState<Record<string, unknown> | null>(null);
  const [approvalMessage, setApprovalMessage] = useState("");
  const [countLocationId, setCountLocationId] = useState(initialBalance?.locationId ?? "");
  const usableLocations = locations.filter((location) => location.inventoryStatus === "usable");
  const quarantineLocations = locations.filter((location) => location.inventoryStatus === "quarantine" || location.inventoryStatus === "damaged");
  // Only auto-fill a destination when the whole company has exactly one candidate; picking
  // the first of several silently ships stock into the wrong warehouse.
  const [postingLocationId, setPostingLocationId] = useState(usableLocations.length === 1 ? usableLocations[0].id : "");
  const [quarantineLocationId, setQuarantineLocationId] = useState(quarantineLocations.length === 1 ? quarantineLocations[0].id : "");
  const [receiptLines, setReceiptLines] = useState(() => (po?.lines ?? []).filter((line) => line.open > 0 && line.fulfillmentRoute !== "drop_ship").map((line) => ({ lineId: line.id, lineVersion: line.version, quantity: line.open, damagedQuantity: 0, uomId: line.orderedUomId, approvalId: "" })));
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
    if (isBatchReceipt) return { lines: receiptLines.filter((line) => line.quantity > 0), locationId: postingLocationId, quarantineLocationId };
    const lineId = ["receive", "close", "reopen", "vendor-return"].includes(command.kind)
      ? selectedPoLine?.id
      : ["reserve", "ship", "customer-return"].includes(command.kind)
        ? selectedSoLine?.id
        : undefined;
    const lineUomId = ["receive", "vendor-return"].includes(command.kind) ? selectedPoLine?.orderedUomId : ["reserve", "ship", "customer-return"].includes(command.kind) ? selectedSoLine?.orderedUomId : undefined;
    const locationId = command.kind === "count" ? selectedCountBalance?.locationId : ["receive", "vendor-return", "customer-return"].includes(command.kind) ? (command.kind === "customer-return" && disposition !== "available" ? quarantineLocationId : postingLocationId) : undefined;
    return { quantity, quarantineQuantity: secondaryQuantity, reason, disposition, expectedDate, carrier, serviceLevel, trackingNumber, billOfLadingNumber, locationId, quarantineLocationId, uomId: lineUomId, recordedQuantity: selectedCountBalance?.recordedQuantity, balanceVersion: selectedCountBalance?.version, ...(overReceiptApprovalId.trim() ? { approvalId: overReceiptApprovalId.trim() } : {}), ...(lineId ? { lineId } : {}) };
  };
  const chooseCountLocation = (locationId: string) => { const balance = countBalances.find((item) => item.locationId === locationId); setCountLocationId(locationId); setQuantity(balance?.recordedQuantity ?? 0); setApprovalRequired(false); setCountApproval(null); setApprovedCountPayload(null); setApprovalMessage(""); };
  const choosePoLine = (lineId: string) => { const line = po?.lines.find((item) => item.id === lineId); setSelectedPoLineId(lineId); if (po && line) setQuantity(commandDefaults(command.kind, { ...po, ordered: line.ordered, received: line.received, returned: line.returned, closed: line.closed, open: line.open, lines: [line] }, effectiveSo).quantity); };
  const chooseSoLine = (lineId: string) => { const line = so?.lines?.find((item) => item.id === lineId); if (!so || !line) return; const factor = line.uomFactorToBase || 1; const availableNow = Math.min(line.open, line.productAvailable / factor); const incomingBeforeDate = Math.min(Math.max(line.open - availableNow, 0), line.productIncoming / factor); setSelectedSoLineId(lineId); setQuantity(commandDefaults(command.kind, effectivePo, { ...so, ordered: line.ordered, reserved: line.reserved, shipped: line.shipped, open: line.open, availableNow, incomingBeforeDate, shortage: Math.max(line.open - availableNow - incomingBeforeDate, 0), route: titleCase(line.fulfillmentRoute), lines: [line] }).quantity); };
  const updateReceiptLine = (lineId: string, patch: Partial<{ quantity: number; damagedQuantity: number; uomId?: string; approvalId: string }>) => setReceiptLines((current) => current.map((line) => line.lineId === lineId ? { ...line, ...patch } : line));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (command.kind !== "count" && receiptQuantity <= 0) return setError("Enter a quantity greater than zero.");
    if (command.kind === "count" && (!selectedCountBalance || !Number.isFinite(selectedCountBalance.version))) return setError("Select a current durable location balance before posting the count.");
    if (command.kind === "count" && quantity < 0) return setError("The counted quantity cannot be negative.");
    if (!isBatchReceipt && command.kind !== "count" && max > 0 && quantity > max) return setError(`Quantity cannot exceed ${max}.`);
    if ((command.kind === "receive" || command.kind === "vendor-return" && disposition !== "allowance") && !postingLocationId) return setError("Select an active usable inventory location.");
    if ((command.kind === "customer-return" && disposition !== "available") || (command.kind === "receive" && (secondaryQuantity > 0 || isBatchReceipt && receiptLines.some((line) => line.damagedQuantity > 0)))) { if (!quarantineLocationId) return setError("Select an active quarantine or damaged inventory location."); }
    if (command.kind === "receive" && secondaryQuantity > quantity) return setError("Quarantine quantity cannot exceed arrived quantity.");
    if (isBatchReceipt && receiptLines.some((line) => line.quantity < 0 || line.damagedQuantity < 0 || line.damagedQuantity > line.quantity)) return setError("Each receipt line needs a non-negative quantity and quarantine cannot exceed arrived quantity.");
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

  return <div className="modal-overlay" role="presentation"><section className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title"><div className="dialog-header"><div><span className="section-kicker">{command.entityNumber}</span><h2 id="command-title">{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}>×</button></div><form onSubmit={submit}>
    {error && <div className="error-summary" role="alert"><strong>Review the highlighted information</strong><p>{error}</p></div>}
    <fieldset className="command-fields-lock" disabled={command.kind === "count" && Boolean(countApproval)}>
      <CommandFields warehouseId={warehouseId} kind={command.kind} po={effectivePo} so={effectiveSo} purchaseLines={po?.lines ?? []} salesLines={so?.lines ?? []} selectedPoLineId={selectedPoLine?.id ?? ""} selectedSoLineId={selectedSoLine?.id ?? ""} setSelectedPoLineId={choosePoLine} setSelectedSoLineId={chooseSoLine} quantity={quantity} secondaryQuantity={secondaryQuantity} setQuantity={setQuantity} setSecondaryQuantity={setSecondaryQuantity} receiptLines={receiptLines} updateReceiptLine={updateReceiptLine} overReceiptApprovalId={overReceiptApprovalId} setOverReceiptApprovalId={setOverReceiptApprovalId} reason={reason} setReason={setReason} disposition={disposition} setDisposition={setDisposition} expectedDate={expectedDate} setExpectedDate={setExpectedDate} carrier={carrier} setCarrier={setCarrier} serviceLevel={serviceLevel} setServiceLevel={setServiceLevel} trackingNumber={trackingNumber} setTrackingNumber={setTrackingNumber} billOfLadingNumber={billOfLadingNumber} setBillOfLadingNumber={setBillOfLadingNumber} max={max} countBalances={countBalances} countLocationId={countLocationId} setCountLocationId={chooseCountLocation} usableLocations={usableLocations} quarantineLocations={quarantineLocations} postingLocationId={postingLocationId} setPostingLocationId={setPostingLocationId} quarantineLocationId={quarantineLocationId} setQuarantineLocationId={setQuarantineLocationId} />
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
  receiptLines: Array<{ lineId: string; lineVersion: number; quantity: number; damagedQuantity: number; uomId?: string; approvalId: string }>;
  updateReceiptLine: (lineId: string, patch: Partial<{ quantity: number; damagedQuantity: number; uomId?: string; approvalId: string }>) => void;
  overReceiptApprovalId: string; setOverReceiptApprovalId: (value: string) => void;
  reason: string; setReason: (value: string) => void; disposition: string; setDisposition: (value: string) => void;
  expectedDate: string; setExpectedDate: (value: string) => void; carrier: string; setCarrier: (value: string) => void;
  serviceLevel: string; setServiceLevel: (value: string) => void; trackingNumber: string; setTrackingNumber: (value: string) => void;
  billOfLadingNumber: string; setBillOfLadingNumber: (value: string) => void; max: number;
  countBalances: InventoryLocationBalance[]; countLocationId: string; setCountLocationId: (value: string) => void;
  usableLocations: LocationOption[]; quarantineLocations: LocationOption[]; postingLocationId: string; setPostingLocationId: (value: string) => void;
  quarantineLocationId: string; setQuarantineLocationId: (value: string) => void;
};

function CommandFields({ warehouseId, kind, po, so, purchaseLines, salesLines, selectedPoLineId, selectedSoLineId, setSelectedPoLineId, setSelectedSoLineId, quantity, secondaryQuantity, setQuantity, setSecondaryQuantity, receiptLines, updateReceiptLine, overReceiptApprovalId, setOverReceiptApprovalId, reason, setReason, disposition, setDisposition, expectedDate, setExpectedDate, carrier, setCarrier, serviceLevel, setServiceLevel, trackingNumber, setTrackingNumber, billOfLadingNumber, setBillOfLadingNumber, max, countBalances, countLocationId, setCountLocationId, usableLocations, quarantineLocations, postingLocationId, setPostingLocationId, quarantineLocationId, setQuarantineLocationId }: CommandFieldsProps) {
  const purchaseLineSelector = purchaseLines.length > 1 ? <SearchableSelect label="Purchase order line" value={selectedPoLineId} setValue={setSelectedPoLineId} options={purchaseLines.map((line) => ({ id: line.id, label: `${line.sku} · ${line.product}`, detail: `${line.open} open` }))} /> : null;
  const salesLineSelector = salesLines.length > 1 ? <SearchableSelect label="Sales order line" value={selectedSoLineId} setValue={setSelectedSoLineId} options={salesLines.map((line) => ({ id: line.id, label: `${line.sku} · ${line.product}`, detail: `${line.open} open` }))} /> : null;
  const usableLocationField = <label>Usable destination<ReferenceSearchSelect kind="locations" role="usable" warehouseId={warehouseId} value={postingLocationId} initialOptions={usableLocations.map((location) => ({ id: location.id, label: `${location.warehouseName} · ${location.code} · ${location.name}`, detail: "Usable inventory" }))} quickCreate="location" onSelect={(option) => setPostingLocationId(option.id)} placeholder="Search every usable location" /></label>;
  const quarantineLocationField = <label>Quarantine destination<ReferenceSearchSelect kind="locations" role="non_usable" warehouseId={warehouseId} value={quarantineLocationId} initialOptions={quarantineLocations.map((location) => ({ id: location.id, label: `${location.warehouseName} · ${location.code} · ${location.name}`, detail: titleCase(location.inventoryStatus) }))} quickCreate="location" onSelect={(option) => setQuarantineLocationId(option.id)} placeholder="Search every quarantine or damaged location" /></label>;
  if (kind === "receive" && receiptLines.length > 1) return <div className="command-form"><div className="line-context"><span>Multi-line truck receipt</span><strong>{receiptLines.length} PO lines on one receipt document</strong></div>{usableLocationField}{receiptLines.some((line) => line.damagedQuantity > 0) ? quarantineLocationField : null}<div className="batch-receipt-lines">{receiptLines.map((receiptLine) => { const line = purchaseLines.find((item) => item.id === receiptLine.lineId); const excess = Math.max(receiptLine.quantity - (line?.open ?? 0), 0); return <div className="batch-receipt-line" key={receiptLine.lineId}><div><strong>{line?.sku} · {line?.product}</strong><small>{line?.open} {line?.orderedUomCode ?? "unit"} open</small></div><label>Arrived ({line?.orderedUomCode ?? "unit"})<input type="number" min="0" step={line?.uomFactorToBase === 1 ? "1" : "0.001"} value={receiptLine.quantity} onChange={(event) => updateReceiptLine(receiptLine.lineId, { quantity: Number(event.target.value) })} /></label><label>Quarantine ({line?.orderedUomCode ?? "unit"})<input type="number" min="0" step={line?.uomFactorToBase === 1 ? "1" : "0.001"} max={receiptLine.quantity} value={receiptLine.damagedQuantity} onChange={(event) => updateReceiptLine(receiptLine.lineId, { damagedQuantity: Number(event.target.value) })} /></label>{excess > 0 ? <label>Approval ID (if above tolerance)<input value={receiptLine.approvalId} onChange={(event) => updateReceiptLine(receiptLine.lineId, { approvalId: event.target.value })} placeholder={`${excess} excess; paste approved request ID when required`} /></label> : null}</div>; })}</div><p className="formula-note">Lines with zero arrived quantity are skipped. The server applies the configured tolerance and requires a line-scoped approval above it.</p></div>;
  if (kind === "receive") return <div className="command-form">{purchaseLineSelector}<div className="line-context"><span>{po?.lines[0]?.product}</span><strong>{po?.open ?? 0} {po?.lines[0]?.orderedUomCode ?? "units"} open to receive</strong><small>{po?.lines[0]?.specification}</small></div><div className="form-grid"><label>Arrived at dock ({po?.lines[0]?.orderedUomCode ?? "unit"})<input type="number" min="1" step={po?.lines[0]?.uomFactorToBase === 1 ? "1" : "0.001"} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label><label>Accepted into quarantine<input type="number" min="0" step={po?.lines[0]?.uomFactorToBase === 1 ? "1" : "0.001"} max={quantity} value={secondaryQuantity} onChange={(e) => setSecondaryQuantity(Number(e.target.value))} /></label>{quantity > (po?.open ?? 0) ? <label>Approval ID (if above tolerance)<input value={overReceiptApprovalId} onChange={(event) => setOverReceiptApprovalId(event.target.value)} placeholder="Paste the approved line-scoped request ID" /></label> : null}{usableLocationField}{secondaryQuantity > 0 ? quarantineLocationField : null}</div></div>;
  if (kind === "ship" || kind === "reserve") return <div className="command-form">{salesLineSelector}<div className="line-context"><span>{so?.lines?.[0]?.product ?? so?.customer} · {so?.project}</span><strong>{kind === "reserve" ? `${so?.availableNow ?? 0} available now` : `${so?.reserved ?? 0} reserved`}</strong><small>{so?.route}</small></div><label>{kind === "reserve" ? "Quantity to reserve" : "Quantity to ship"}<input type="number" min="1" max={max} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label><div className="line-context"><span>{kind === "reserve" ? "Location selection" : "Ship-to address"}</span><strong>{kind === "reserve" ? "Best available usable location is selected at posting" : `${so?.shipToName ?? so?.customer}`}</strong><small>{kind === "reserve" ? "The committed location is recorded on the reservation." : [so?.shipToAddressLine1, so?.shipToCity, so?.shipToRegion, so?.shipToPostalCode, so?.shipToCountry].filter(Boolean).join(", ")}</small></div>{kind === "ship" ? <><label>Carrier<input value={carrier} onChange={(event) => setCarrier(event.target.value)} placeholder="Required carrier" required /></label><label>Service level<input value={serviceLevel} onChange={(event) => setServiceLevel(event.target.value)} placeholder="Ground, LTL, same day…" /></label><label>Tracking number<input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} placeholder="Tracking or PRO number" /></label><label>Bill of lading<input value={billOfLadingNumber} onChange={(event) => setBillOfLadingNumber(event.target.value)} placeholder="Required when no tracking number" /></label></> : null}</div>;
  if (kind === "vendor-return") return <div className="command-form">{purchaseLineSelector}<div className="line-context"><span>{po?.lines[0]?.product}</span><strong>{max} {po?.lines[0]?.orderedUomCode ?? "units"} eligible to return</strong><small>Source: {po?.number}</small></div><label>Quantity to return<input type="number" min="1" step={po?.lines[0]?.uomFactorToBase === 1 ? "1" : "0.001"} max={max} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label>{disposition !== "allowance" ? usableLocationField : null}<fieldset><legend>What should happen after the vendor receives these goods?</legend>{[["replacement", "Replace the returned quantity"], ["refund", "Issue a credit; no replacement"], ["repair", "Repair and return the same unit"], ["allowance", "No physical return; issue a price allowance"]].map(([value, label]) => <label className="radio-row" key={value}><input type="radio" name="disposition" value={value} checked={disposition === value} onChange={(e) => setDisposition(e.target.value)} /><span>{label}</span></label>)}</fieldset><SearchableSelect label="Return reason" allowCustom value={reason} setValue={setReason} placeholder="Search or type a reason" options={vendorReturnReasons.map((label) => ({ id: label, label }))} /></div>;
  if (kind === "customer-return") return <div className="command-form">{salesLineSelector}<div className="line-context"><span>{so?.lines?.[0]?.product ?? so?.customer} · {so?.number}</span><strong>{max} {so?.lines?.[0]?.orderedUomCode ?? "units"} eligible to return</strong><small>Physical and financial decisions are reviewed separately.</small></div><label>Quantity received back<input type="number" min="1" step={so?.lines?.[0]?.uomFactorToBase === 1 ? "1" : "0.001"} max={max} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label><label>Physical disposition<select value={disposition} onChange={(e) => setDisposition(e.target.value)}><option value="quarantine">Receive into quarantine</option><option value="available">Return to available stock</option><option value="damaged">Damaged stock</option></select></label>{disposition === "available" ? usableLocationField : quarantineLocationField}<SearchableSelect label="Return reason" allowCustom value={reason} setValue={setReason} placeholder="Search or type a reason" options={customerReturnReasons.map((label) => ({ id: label, label }))} /></div>;
  if (kind === "count") { const balance = countBalances.find((item) => item.locationId === countLocationId); return <div className="command-form"><div className="line-context"><span>Cycle count</span><strong>{balance ? `${balance.warehouseName} / ${balance.locationCode}` : "No active location balance"}</strong><small>{balance ? `Book quantity ${balance.recordedQuantity} · ${balance.reservedQuantity} reserved` : "Receive inventory at an active location before counting."}</small></div><SearchableSelect label="Inventory location" value={countLocationId} setValue={setCountLocationId} options={countBalances.map((item) => ({ id: item.locationId, label: `${item.warehouseName} · ${item.locationCode} · ${item.locationName}`, detail: `${item.recordedQuantity} book` }))} /><label>Book quantity<input value={balance?.recordedQuantity ?? ""} readOnly /></label><label>Counted quantity<input type="number" min="0" step="0.0001" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required /></label><SearchableSelect label="Variance reason" allowCustom value={reason} setValue={setReason} placeholder="Search or type a reason" options={countVarianceReasons.map((label) => ({ id: label, label }))} /></div>; }
  return <div className="command-form">{kind === "reverse" ? null : purchaseLineSelector}<div className="line-context"><span>{po?.lines[0]?.product}</span><strong>{max} eligible</strong><small>{kind === "reopen" ? `${po?.closed} closed without receipt` : kind === "reverse" ? `${po?.received} originally received` : `${po?.open} open to receive`}</small></div><label>{kind === "reopen" ? "Quantity to reopen" : kind === "reverse" ? "Quantity to reverse" : "Quantity to close"}<input type="number" min="1" max={max} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label>{kind === "reopen" && <label>New expected date<input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></label>}{kind === "reverse" && <fieldset><legend>Is the reversed quantity still expected?</legend><label className="radio-row"><input type="radio" name="disposition" value="reopen" checked={disposition === "reopen"} onChange={(e) => setDisposition(e.target.value)} /><span>Yes, reopen it to receive</span></label><label className="radio-row"><input type="radio" name="disposition" value="close" checked={disposition === "close"} onChange={(e) => setDisposition(e.target.value)} /><span>No, close it without receipt</span></label></fieldset>}<SearchableSelect label="Reason" allowCustom value={reason} setValue={setReason} placeholder="Search or type a reason" options={closeReopenReasons.map((label) => ({ id: label, label }))} /></div>;
}

function ImpactPreview({ lines }: { lines: Array<{ category: string; label: string; before?: string | number; after: string | number; tone?: Severity }> }) {
  const grouped = lines.reduce<Record<string, typeof lines>>((acc, line) => { (acc[line.category] ??= []).push(line); return acc; }, {});
  return <section className="impact-preview" aria-labelledby="impact-title"><div className="impact-heading"><span aria-hidden="true">⇄</span><h3 id="impact-title">Review business impact</h3></div>{Object.entries(grouped).map(([category, categoryLines]) => <div className="impact-group" key={category}><h4>{category}</h4>{categoryLines.map((line) => <div className={`impact-line ${line.tone ?? "neutral"}`} key={line.label}><span>{line.label}</span><strong>{line.before !== undefined ? <><del>{line.before}</del><b aria-hidden="true">→</b></> : null}{line.after}</strong></div>)}</div>)}</section>;
}

function commandDefaults(kind: CommandKind, po?: PurchaseOrder, so?: SalesOrder) {
  if (kind === "receive") return { quantity: po?.open || 1, secondaryQuantity: 0, max: 0, disposition: "available" };
  if (kind === "close") return { quantity: po?.open || 1, secondaryQuantity: 0, max: po?.open || 0, disposition: "close" };
  // Both default to the whole eligible quantity, like close and receive above. The previous
  // caps of 20 and 10 were arbitrary: on a 55-unit reversal they pre-filled a wrong number that
  // still passed validation, so a mis-keyed correction posted silently.
  if (kind === "reopen") return { quantity: po?.closed || 1, secondaryQuantity: 0, max: po?.closed || 0, disposition: "reopen" };
  if (kind === "reverse") return { quantity: Math.max((po?.received || 0) - (po?.returned || 0), 1), secondaryQuantity: 0, max: (po?.received || 0) - (po?.returned || 0), disposition: "reopen" };
  if (kind === "vendor-return") return { quantity: 1, secondaryQuantity: 0, max: (po?.received || 0) - (po?.returned || 0), disposition: "replacement" };
  if (kind === "reserve") return { quantity: Math.max(1, Math.min(so?.availableNow || 0, (so?.open || 0) - (so?.reserved || 0))), secondaryQuantity: 0, max: Math.max(0, Math.min(so?.availableNow || 0, (so?.open || 0) - (so?.reserved || 0))), disposition: "reserve" };
  if (kind === "ship") return { quantity: Math.max(1, so?.reserved || 0), secondaryQuantity: 0, max: Math.max(0, so?.reserved || 0), disposition: "ship" };
  if (kind === "customer-return") return { quantity: 1, secondaryQuantity: 0, max: so?.shipped || 0, disposition: "quarantine" };
  if (kind === "count") return { quantity: -1, secondaryQuantity: 0, max: 0, disposition: "adjust" };
  return { quantity: 1, secondaryQuantity: 0, max: 0, disposition: "adjust" };
}

function commandTitle(kind: CommandKind) {
  return ({ receive: "Post receipt", close: "Close unreceived quantity", reopen: "Reopen quantity to receive", reverse: "Reverse incorrect receipt", "vendor-return": "Return to vendor", reserve: "Reserve available stock", ship: "Post shipment", "customer-return": "Post customer return", count: "Approve inventory adjustment" } as Record<CommandKind, string>)[kind];
}

function finalCommandLabel(kind: CommandKind, quantity: number) {
  return ({ receive: `Post receipt of ${quantity}`, close: `Close ${quantity} without receipt`, reopen: `Reopen ${quantity} to receive`, reverse: `Reverse ${quantity} received units`, "vendor-return": `Post vendor return of ${quantity}`, reserve: `Reserve ${quantity} units`, ship: `Post shipment of ${quantity}`, "customer-return": `Post customer return of ${quantity}`, count: "Approve and post inventory adjustment" } as Record<CommandKind, string>)[kind];
}

function commandImpact(kind: CommandKind, quantity: number, secondary: number, po?: PurchaseOrder, so?: SalesOrder, disposition?: string, recordedQuantity = 0) {
  if (kind === "receive") return [
    { category: "Physical inventory", label: "Available inventory", before: po?.received ?? 0, after: (po?.received ?? 0) + quantity - secondary, tone: "success" as Severity },
    { category: "Physical inventory", label: "Quarantine inventory", before: 0, after: secondary, tone: secondary > 0 ? "warning" as Severity : "neutral" as Severity },
    { category: "Commercial commitment", label: "PO open to receive", before: po?.open ?? 0, after: Math.max((po?.open ?? 0) - quantity, 0), tone: "info" as Severity },
    { category: "Commercial commitment", label: "Over-receipt policy", after: quantity > (po?.open ?? 0) ? `${quantity - (po?.open ?? 0)} excess · server tolerance or line-scoped approval required` : "No excess" , tone: quantity > (po?.open ?? 0) ? "warning" as Severity : "neutral" as Severity },
    { category: "Financial eligibility", label: "Quantity eligible for vendor billing", before: po?.billed ?? 0, after: (po?.billed ?? 0) + quantity },
  ];
  if (kind === "close") return [{ category: "Physical inventory", label: "On-hand inventory", after: "No change" }, { category: "Commercial commitment", label: "Expected incoming", before: po?.open ?? 0, after: Math.max((po?.open ?? 0) - quantity, 0), tone: "warning" as Severity }, { category: "Commercial commitment", label: "Closed without receipt", before: po?.closed ?? 0, after: (po?.closed ?? 0) + quantity }];
  if (kind === "reopen") return [{ category: "Physical inventory", label: "On-hand inventory", after: "No change" }, { category: "Commercial commitment", label: "Expected incoming", before: po?.open ?? 0, after: (po?.open ?? 0) + quantity, tone: "info" as Severity }, { category: "Commercial commitment", label: "Closed without receipt", before: po?.closed ?? 0, after: Math.max((po?.closed ?? 0) - quantity, 0) }, { category: "Commercial commitment", label: "Purchase-order revision", before: po?.revision ?? 1, after: (po?.revision ?? 1) + 1 }];
  if (kind === "reverse") return [{ category: "Physical inventory", label: "Available inventory", before: po?.received ?? 0, after: Math.max((po?.received ?? 0) - quantity, 0), tone: "danger" as Severity }, { category: "Commercial commitment", label: "Net received", before: (po?.received ?? 0) - (po?.returned ?? 0), after: Math.max((po?.received ?? 0) - (po?.returned ?? 0) - quantity, 0) }, { category: "Commercial commitment", label: disposition === "reopen" ? "Open to receive" : "Closed without receipt", before: disposition === "reopen" ? po?.open ?? 0 : po?.closed ?? 0, after: (disposition === "reopen" ? po?.open ?? 0 : po?.closed ?? 0) + quantity }];
  if (kind === "vendor-return") return disposition === "allowance" ? [{ category: "Physical inventory", label: "On-hand inventory", after: "No change" }, { category: "Commercial commitment", label: "PO fulfillment", after: "No change" }, { category: "Financial effect", label: "Vendor credit", after: "Price-only credit expected", tone: "info" as Severity }] : [{ category: "Physical inventory", label: "Internal inventory", before: (po?.received ?? 0) - (po?.returned ?? 0), after: Math.max((po?.received ?? 0) - (po?.returned ?? 0) - quantity, 0), tone: "danger" as Severity }, { category: "Commercial commitment", label: disposition === "replacement" ? "Replacement supply" : "Closed without replacement", before: 0, after: quantity, tone: disposition === "replacement" ? "info" as Severity : "warning" as Severity }, { category: "Financial effect", label: "Vendor credit expected", after: "Yes" }];
  if (kind === "reserve") return [{ category: "Physical inventory", label: "On-hand inventory", after: "No change" }, { category: "Commercial commitment", label: "Customer allocation", before: so?.reserved ?? 0, after: (so?.reserved ?? 0) + quantity, tone: "info" as Severity }, { category: "Allocations", label: "Available inventory", before: so?.availableNow ?? 0, after: Math.max((so?.availableNow ?? 0) - quantity, 0), tone: "warning" as Severity }, { category: "Financial effect", label: "Customer invoice", after: "No change" }];
  if (kind === "ship") return [{ category: "Physical inventory", label: "Main warehouse on hand", before: so?.reserved ?? 0, after: Math.max((so?.reserved ?? 0) - quantity, 0), tone: "danger" as Severity }, { category: "Commercial commitment", label: "Sales order shipped", before: so?.shipped ?? 0, after: (so?.shipped ?? 0) + quantity, tone: "success" as Severity }, { category: "Allocations", label: "Reservations released", before: so?.reserved ?? 0, after: Math.max((so?.reserved ?? 0) - quantity, 0) }, { category: "Financial eligibility", label: "Quantity eligible to invoice", before: so?.shipped ?? 0, after: (so?.shipped ?? 0) + quantity }];
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
      policy: titleCase(text(item.trackingPolicy || item.inventoryPolicy, "stock")),
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
      inventoryPolicy: text(item.inventoryPolicy, "stocked"),
      standardCost: number(item.standardCostCents) / 100,
      sellingPrice: number(item.sellingPriceCents) / 100,
      baseUomId: text(item.baseUomId),
      baseUomCode: text(item.baseUomCode, "EA"),
      purchaseUomId: text(item.purchaseUomId),
      purchaseUomCode: text(item.purchaseUomCode, text(item.baseUomCode, "EA")),
      salesUomId: text(item.salesUomId),
      salesUomCode: text(item.salesUomCode, text(item.baseUomCode, "EA")),
      quantityPrecision: number(item.quantityPrecision),
      customerRef: undefined,
      version: number(item.version, 1),
    };
  });

  const purchaseOrders: PurchaseOrder[] = rawPurchaseOrders.map((item, index) => {
    const lines = asRows(item.lines).map((line, lineIndex): PurchaseLine => {
      const baseOrdered = number(line.orderedQuantity);
      const enteredOrdered = number(line.orderedUomQuantity, baseOrdered);
      const factor = enteredOrdered > 0 ? baseOrdered / enteredOrdered : 1;
      return {
      id: text(line.id, `${text(item.id)}-line-${lineIndex}`),
      productId: text(line.productId) || undefined,
      sku: text(line.sku),
      product: text(line.productName, "Unnamed product"),
      specification: configurationText(line.configurationSnapshot) || products.find((product) => product.id === text(line.productId))?.specification || "No configuration recorded",
      customerRef: text(line.sourceSalesOrderLineId) || undefined,
      sourceSalesOrderLineId: text(line.sourceSalesOrderLineId) || undefined,
      ordered: enteredOrdered,
      received: number(line.netReceivedQuantity) / factor,
      returned: 0,
      closed: number(line.closedWithoutReceiptQuantity) / factor,
      open: number(line.openToReceiveQuantity) / factor,
      unitCost: number(line.orderedUomUnitCostCents, number(line.unitCostCents)) / 100,
      orderedUomId: text(line.orderedUomId) || undefined,
      orderedUomCode: text(line.orderedUomCode) || undefined,
      uomFactorToBase: factor,
      location: text(line.fulfillmentRoute, "stock") === "drop_ship" ? "Drop ship · no internal stock" : "Destination selected at receipt",
      fulfillmentRoute: text(line.fulfillmentRoute, "stock"),
      // Stored per line since 0012. The composer collects a discount and tax rate on every
      // purchase line and prices the order with them, so reading them back is what makes a
      // reopened draft show the same total the buyer approved.
      discountCents: number(line.discountCents),
      taxable: number(line.taxable) !== 0,
      taxRateBps: number(line.taxRateBps),
      version: number(line.version, 1),
      };
    });
    const expectedDate = text(item.expectedDate, futureDate(7));
    const open = number(item.openToReceiveQuantity);
    const closed = number(item.closedWithoutReceiptQuantity);
    const late = expectedDate < new Date().toISOString().slice(0, 10) && open > 0 ? calendarDaysLate(expectedDate) : 0;
    return {
      id: text(item.id, `po-${index}`),
      number: text(item.number, "Purchase order"),
      vendorId: text(item.vendorId),
      vendor: text(item.vendorName, "Vendor"),
      lifecycle: titleCase(text(item.lifecycleStatus, "approved")),
      fulfillment: titleCase(text(item.fulfillmentStatus, "not_received")),
      billing: titleCase(text(item.billingStatus, "not_billed")),
      expectedDate,
      daysLate: late,
      ordered: number(item.orderedQuantity),
      received: number(item.grossReceivedQuantity || item.netReceivedQuantity),
      returned: number(item.vendorReturnedQuantity) + number(item.receiptReversedQuantity),
      closed,
      open,
      billed: number(item.netReceivedQuantity),
      total: number(item.totalCents) / 100,
      currency: text(item.currency, "CAD"),
      exchangeRateToBase: number(item.exchangeRateToBase, 1),
      paymentTerms: text(item.paymentTerms) || undefined,
      dueDate: text(item.dueDate) || undefined,
      projectReference: text(item.projectReference) || undefined,
      freightCents: number(item.freightCents),
      freightTaxRateBps: number(item.freightTaxRateBps),
      feeCents: number(item.feeCents),
      feeTaxRateBps: number(item.feeTaxRateBps),
      depositCents: number(item.depositCents),
      buyer: text(item.buyerName, "Unassigned"),
      revision: number(item.version, 1),
      version: number(item.version, 1),
      latestReceiptId: text(item.latestReceiptId) || undefined,
      latestReceiptVersion: number(item.latestReceiptVersion) || undefined,
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
      return {
        id: text(line.id, `${text(item.id)}-line-${lineIndex}`),
        productId: text(line.productId),
        sku: text(line.sku),
        product: text(line.productName, "Unnamed product"),
        ordered: enteredOrdered,
        canceled: canceled / factor,
        reserved: number(line.reservedQuantity) / factor,
        shipped: shipped / factor,
        open: Math.max(ordered - canceled - shipped, 0) / factor,
        unitPrice: number(line.orderedUomUnitPriceCents, number(line.unitPriceCents)) / 100,
        orderedUomId: text(line.orderedUomId) || undefined,
        orderedUomCode: text(line.orderedUomCode) || undefined,
        uomFactorToBase: factor,
        fulfillmentRoute: text(line.fulfillmentRoute, "stock"),
        linkedPurchaseOrderLineId: text(line.linkedPurchaseOrderLineId) || undefined,
        projectReference: text(line.projectReference) || undefined,
        discountCents: number(line.discountCents),
        taxable: number(line.taxable, 1) !== 0,
        taxRateBps: number(line.taxRateBps),
        productAvailable: number(line.productAvailableQuantity),
        productIncoming: number(line.productIncomingQuantity),
      };
    });
    const firstLine = rawLines[0];
    const open = number(item.openToShipQuantity);
    // Availability now comes from the server, which sees every line and the whole catalog. The
    // old first-line-and-current-page guess reported "0 available" for every order on any view
    // that ships no products, so the entire sales worklist read as short.
    const availableNow = Math.min(open, number(item.availableNowQuantity));
    const incomingBeforeDate = Math.min(Math.max(open - availableNow, 0), number(item.incomingSupplyQuantity));
    const shortage = Math.max(open - availableNow - incomingBeforeDate, 0);
    return {
      id: text(item.id, `so-${index}`),
      number: text(item.number, "Sales order"),
      customerId: text(item.customerId),
      customer: text(item.customerName, "Unnamed customer"),
      project: text(item.projectReference, "No project reference"),
      requestedDate: text(item.requestedDate),
      lifecycle: titleCase(text(item.lifecycleStatus, "confirmed")),
      fulfillment: titleCase(text(item.fulfillmentStatus, "unreserved")),
      billing: titleCase(text(item.billingStatus, "not_invoiced")),
      ordered: number(item.orderedQuantity),
      reserved: number(item.reservedQuantity),
      shipped: number(item.shippedQuantity),
      invoiced: number(item.invoicedQuantity),
      open,
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
      linkedPo: text(firstLine?.linkedPurchaseOrderLineId) || undefined,
      exception: shortage > 0 ? `${shortage} unit${shortage === 1 ? "" : "s"} short for requested date` : undefined,
      version: number(item.version, 1),
      lines,
    };
  });

  const movements: Movement[] = asRows(raw.movements).map((item, index) => ({
    id: text(item.id, `movement-${index}`),
    time: displayTimestamp(text(item.postedAt)),
    type: titleCase(text(item.type, "stock_movement")),
    document: text(item.sourceDocumentId || item.sourceDocumentType, "Source document"),
    product: text(item.sku, text(item.productName)),
    quantity: number(item.quantity),
    from: text(item.fromLocationCode, "External / Supplier"),
    to: text(item.toLocationCode, "External / Customer"),
    user: text(item.postedBy, "System"),
  }));

  const bills: Bill[] = asRows(raw.bills).map((item, index) => {
    const isException = text(item.matchStatus) !== "matched";
    return {
      id: text(item.id, `bill-${index}`),
      number: text(item.number, "Vendor bill"),
      vendor: text(item.vendorName, "Vendor"),
      po: text(item.purchaseOrderNumber, "Unlinked"),
      receivedValue: number(item.authorizedLineValueCents) / 100,
      billedValue: number(item.billedLineValueCents) / 100,
      variance: (number(item.billedLineValueCents) - number(item.authorizedLineValueCents)) / 100,
      currency: text(item.currency, "CAD"),
      status: titleCase(text(item.matchStatus, text(item.status, "draft"))),
      reason: isException ? "Price or quantity differs from the authorized PO and posted receipt." : undefined,
    };
  });

  const activities: Activity[] = asRows(raw.activities).map((item, index) => {
    const action = titleCase(text(item.action, "Activity"));
    return {
      id: text(item.id, `activity-${index}`),
      time: displayTimestamp(text(item.createdAt)),
      title: `${text(item.actor, "System")} · ${action}`,
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

  const locations: LocationOption[] = asRows(raw.locations).map((item) => ({
    id: text(item.id),
    code: text(item.code),
    name: text(item.name),
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
      orphanedBalanceRows: number(summary.orphanedBalanceRows),
      orphanedBalanceUnits: number(summary.orphanedBalanceUnits),
      orphanedMovementCount: number(summary.orphanedMovementCount),
      orphanedInventoryValueCents: number(summary.orphanedInventoryValueCents),
    },
    purchaseOrders,
    products,
    inventoryBalances,
    salesOrders,
    movements,
    bills,
    activities,
    partners,
    locations,
    configuration: { taxDefaultRateBps: number(asRecord(raw.configuration).taxDefaultRateBps, 500) },
    viewer: {
      name: text(asRecord(raw.viewer).name),
      email: text(asRecord(raw.viewer).email),
      role: text(asRecord(raw.viewer).role),
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
