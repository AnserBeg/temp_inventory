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
  location: string;
  fulfillmentRoute?: string;
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
  fulfillmentRoute: string;
  linkedPurchaseOrderLineId?: string;
};

type PurchaseOrder = {
  id: string;
  number: string;
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
  customerRef?: string;
  version?: number;
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
  name: string;
  type: "vendor" | "customer";
  email?: string;
  phone?: string;
};

type Snapshot = {
  summary: {
    lateReceipts: number;
    approvals: number;
    blockedSales: number;
    dueReceipts: number;
    readyToShip: number;
    pickups: number;
  };
  purchaseOrders: PurchaseOrder[];
  products: Product[];
  inventoryBalances: InventoryLocationBalance[];
  salesOrders: SalesOrder[];
  movements: Movement[];
  bills: Bill[];
  activities: Activity[];
  partners: Partner[];
};

const emptySnapshot: Snapshot = {
  summary: { lateReceipts: 0, approvals: 0, blockedSales: 0, dueReceipts: 0, readyToShip: 0, pickups: 0 },
  purchaseOrders: [],
  products: [],
  inventoryBalances: [],
  salesOrders: [],
  movements: [],
  bills: [],
  activities: [],
  partners: [],
};

type ComposerLine = {
  id: string;
  productId: string;
  quantity: number;
  unitAmount: number;
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

const money = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

const compactDate = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
});

function futureDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
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

const viewTitles: Record<ViewKey, { title: string; description: string }> = {
  home: { title: "Operations overview", description: "What needs attention across the business today." },
  "purchase-orders": { title: "Purchase orders", description: "Expected supply, receipt progress, and vendor commitments." },
  "expected-receipts": { title: "Expected receipts", description: "Inbound work ordered by urgency and customer impact." },
  "vendor-returns": { title: "Vendor returns", description: "Physical returns, replacements, and credits kept distinct." },
  "sales-orders": { title: "Sales orders", description: "Confirmed sales order demand, allocation, fulfillment, and billing state." },
  fulfillment: { title: "Ready to fulfill", description: "Reserved orders ready for picking, staging, or shipment." },
  "customer-returns": { title: "Customer returns", description: "Return intake, physical disposition, and customer resolution." },
  stock: { title: "Inventory", description: "Explainable balances by product, location, and status." },
  movements: { title: "Movement history", description: "The immutable physical ledger behind every on-hand balance." },
  counts: { title: "Inventory counts", description: "Count, review variance, and post a linked adjustment." },
  "vendor-bills": { title: "Vendor bills", description: "Three-way matching across purchase order, receipt, and bill." },
  "customer-invoices": { title: "Customer invoices", description: "Invoice posted shipments without implying stock movement." },
  products: { title: "Product catalog", description: "Standard variants and customer-specific configurations." },
  partners: { title: "Partners", description: "Customers, vendors, job sites, terms, and account status." },
  reports: { title: "Operational reports", description: "Exception-first reports with direct source-document drill-down." },
  warehouse: { title: "Warehouse mode", description: "Scan-first receiving, picking, transfer, and count tasks." },
};

export function InventoryApp() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [view, setView] = useState<ViewKey>("home");
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [selectedSoId, setSelectedSoId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [activeCommand, setActiveCommand] = useState<ActiveCommand | null>(null);
  const [createOrder, setCreateOrder] = useState<"purchaseOrder" | "salesOrder" | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"loading" | "server" | "unavailable">("loading");
  const [workflowRefreshToken, setWorkflowRefreshToken] = useState(0);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadSnapshot = useCallback(async () => {
    try {
      const response = await fetch("/api/snapshot", { cache: "no-store" });
      if (!response.ok) throw new Error("Snapshot unavailable");
      const data = await response.json();
      const normalized = normalizeSnapshot(data);
      setSnapshot(normalized);
      setSource("server");
    } catch {
      setSnapshot(emptySnapshot);
      setSource("unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requested = new URLSearchParams(window.location.search).get("view") as ViewKey | null;
      setView(requested && viewTitles[requested] ? requested : "home");
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
      setView(next && viewTitles[next] ? next : "home");
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

  const navigate = (next: ViewKey) => {
    setView(next);
    setSelectedPoId(null);
    setSelectedSoId(null);
    setSelectedProductId(null);
    setMobileNavOpen(false);
    const url = new URL(window.location.href);
    if (next === "home") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.pushState({}, "", url);
    document.getElementById("main-content")?.focus();
  };

  const selectedPo = snapshot.purchaseOrders.find((po) => po.id === selectedPoId) ?? null;
  const selectedSo = snapshot.salesOrders.find((so) => so.id === selectedSoId) ?? null;
  const selectedProduct = snapshot.products.find((product) => product.id === selectedProductId) ?? null;
  const operationalNotifications = useMemo(() => {
    const items: Array<{ tone: Severity; title: string; detail: string }> = [];
    snapshot.purchaseOrders.filter((po) => po.daysLate > 0).slice(0, 2).forEach((po) => items.push({
      tone: "danger",
      title: `${po.number} is ${po.daysLate} day${po.daysLate === 1 ? "" : "s"} late`,
      detail: `${po.open} unit${po.open === 1 ? "" : "s"} remain open to receive.`,
    }));
    const pending = snapshot.purchaseOrders.filter((po) => po.lifecycle.toLowerCase().includes("pending")).length;
    if (pending) items.push({ tone: "warning", title: `${pending} purchase approval${pending === 1 ? "" : "s"} waiting`, detail: "Review the current durable revisions before deciding." });
    const billExceptions = snapshot.bills.filter((bill) => bill.variance !== 0).length;
    if (billExceptions) items.push({ tone: "warning", title: `${billExceptions} vendor bill exception${billExceptions === 1 ? "" : "s"}`, detail: "Price or quantity differs from the authorized purchasing records." });
    const shortages = snapshot.salesOrders.filter((so) => so.shortage > 0).length;
    if (shortages) items.push({ tone: "info", title: `${shortages} sales shortage${shortages === 1 ? "" : "s"}`, detail: "Open demand currently exceeds available and incoming supply." });
    return items.slice(0, 4);
  }, [snapshot]);

  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return [
      ...snapshot.purchaseOrders
        .filter((item) => `${item.number} ${item.vendor} ${item.customerRef ?? ""}`.toLowerCase().includes(term))
        .map((item) => ({ type: "Purchase order", id: item.id, label: item.number, detail: item.vendor, view: "purchase-orders" as ViewKey })),
      ...snapshot.salesOrders
        .filter((item) => `${item.number} ${item.customer} ${item.project}`.toLowerCase().includes(term))
        .map((item) => ({ type: "Sales order", id: item.id, label: item.number, detail: `${item.customer} · ${item.project}`, view: "sales-orders" as ViewKey })),
      ...snapshot.products
        .filter((item) => `${item.sku} ${item.name} ${item.specification} ${item.customerRef ?? ""}`.toLowerCase().includes(term))
        .map((item) => ({ type: "Product / unit", id: item.id, label: item.sku, detail: item.name, view: "stock" as ViewKey })),
    ].slice(0, 10);
  }, [query, snapshot]);

  const runCommand = async (kind: CommandKind, entityId: string, entityNumber: string, payload: Record<string, unknown>) => {
    const idempotencyKey = crypto.randomUUID();
    const po = snapshot.purchaseOrders.find((item) => item.id === entityId);
    const so = snapshot.salesOrders.find((item) => item.id === entityId);
    const product = snapshot.products.find((item) => item.id === entityId);
    const commandMap: Record<CommandKind, string> = {
      receive: "postReceipt",
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
        : po?.version ?? so?.version ?? product?.version ?? 1;
    const apiPayload: Record<string, unknown> = {
      ...payload,
      damagedQuantity: payload.quarantineQuantity,
      replacementExpected: payload.disposition === "replacement",
      condition: payload.disposition === "available" ? "usable" : "quarantine",
      allowOverReceipt: kind === "receive" && Number(payload.quantity ?? 0) > (po?.open ?? 0),
      overReceiptPolicy: "2% or 1 unit; buyer approval above tolerance",
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
    return { approval: countApprovalFromResponse(result, result.recordId), message: result.message ?? "Manager approval requested." };
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
    return { approval: countApprovalFromResponse(result, approval.id), message: result.message ?? "Count variance approved." };
  };

  const refreshCountApproval = async (approval: CountApproval) => {
    const response = await fetch("/api/workflows", { cache: "no-store" });
    const result = await response.json() as { error?: string | { message?: string } };
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "Approval status could not be refreshed.");
    return countApprovalFromResponse(result, approval.id);
  };

  const createOperationalOrder = async (type: "purchaseOrder" | "salesOrder", payload: Record<string, unknown>) => {
    const idempotencyKey = crypto.randomUUID();
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ command: type === "purchaseOrder" ? "createPurchaseOrderDraft" : "createSalesOrderDraft", payload, idempotencyKey }),
    });
    const result = (await response.json()) as { snapshot?: unknown; recordId?: string; message?: string; error?: string | { message?: string } };
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message || "The order could not be created.");
    await loadSnapshot();
    setWorkflowRefreshToken((current) => current + 1);
    setSource("server");
    setToast(result.message || "Order created.");
    setCreateOrder(null);
    if (type === "purchaseOrder") {
      navigate("purchase-orders");
      if (result.recordId) setSelectedPoId(result.recordId);
    } else {
      navigate("sales-orders");
      if (result.recordId) setSelectedSoId(result.recordId);
    }
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
                  {item.key === "vendor-bills" && snapshot.bills.some((bill) => bill.variance !== 0) && <span className="nav-dot" aria-label="Exceptions present" />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-avatar" aria-hidden="true">U</div>
          <div><strong>Current user</strong><small>Server-enforced role access</small></div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen((open) => !open)}>☰</button>
          <button className="global-search" onClick={() => { setSearchOpen(true); requestAnimationFrame(() => searchRef.current?.focus()); }}>
            <span aria-hidden="true">⌕</span><span>Search orders, products, customers…</span><kbd>Ctrl K</kbd>
          </button>
          <div className="topbar-actions">
            <button className="warehouse-selector"><span className="online-dot" />All locations</button>
            <button className="icon-button notification-button" aria-label="Open notifications" onClick={() => setNotificationsOpen((open) => !open)}>
              ♧{operationalNotifications.length ? <span className="notification-count">{operationalNotifications.length}</span> : null}
            </button>
            <button className="avatar-button" aria-label="User access is managed by the server">U</button>
          </div>
        </header>

        {notificationsOpen && (
          <section className="popover notification-panel" aria-label="Tasks and notifications">
            <div className="popover-header"><div><strong>Tasks requiring action</strong><small>{operationalNotifications.length} open</small></div><button className="icon-button" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}>×</button></div>
            {operationalNotifications.map((item) => <NotificationItem key={item.title} {...item} />)}
            {!operationalNotifications.length ? <div className="empty-inline">No current exceptions in the live snapshot.</div> : null}
          </section>
        )}

        <main id="main-content" tabIndex={-1} className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow-row"><span className={`connection ${source}`}>{source === "server" ? "Live data" : source === "loading" ? "Connecting" : "Data unavailable"}</span><span>{source === "server" ? "Updated just now" : "No sample records shown"}</span></div>
              <h1>{viewTitles[view].title}</h1>
              <p>{viewTitles[view].description}</p>
            </div>
            <PageActions view={view} onNavigate={navigate} onCreate={setCreateOrder} />
          </div>

          {loading ? <LoadingState /> : (
            <>
              {view === "home" && <Dashboard snapshot={snapshot} navigate={navigate} openPo={setSelectedPoId} />}
              {view === "purchase-orders" && (
                <OperationsWorkspace workspace="purchasing" onDurableRefresh={loadSnapshot} refreshToken={workflowRefreshToken}>
                {selectedPo ? (
                  <PurchaseOrderDetail po={selectedPo} onBack={() => setSelectedPoId(null)} onCommand={(kind) => setActiveCommand({ kind, entityId: selectedPo.id, entityNumber: selectedPo.number })} />
                ) : (
                  <PurchaseOrdersView orders={snapshot.purchaseOrders} mode={view} onOpen={setSelectedPoId} onReceive={(po) => setActiveCommand({ kind: "receive", entityId: po.id, entityNumber: po.number })} />
                )}
                </OperationsWorkspace>
              )}
              {view === "expected-receipts" && (
                selectedPo ? (
                  <PurchaseOrderDetail po={selectedPo} onBack={() => setSelectedPoId(null)} onCommand={(kind) => setActiveCommand({ kind, entityId: selectedPo.id, entityNumber: selectedPo.number })} />
                ) : (
                  <PurchaseOrdersView orders={snapshot.purchaseOrders} mode={view} onOpen={setSelectedPoId} onReceive={(po) => setActiveCommand({ kind: "receive", entityId: po.id, entityNumber: po.number })} />
                )
              )}
              {view === "vendor-returns" && <VendorReturnsView orders={snapshot.purchaseOrders} onReturn={(po) => setActiveCommand({ kind: "vendor-return", entityId: po.id, entityNumber: po.number })} />}
              {view === "sales-orders" && (
                <OperationsWorkspace workspace="sales" onDurableRefresh={loadSnapshot} refreshToken={workflowRefreshToken}>
                {selectedSo ? (
                  <SalesOrderDetail so={selectedSo} onBack={() => setSelectedSoId(null)} onReserve={() => setActiveCommand({ kind: "reserve", entityId: selectedSo.id, entityNumber: selectedSo.number })} onShip={() => setActiveCommand({ kind: "ship", entityId: selectedSo.id, entityNumber: selectedSo.number })} />
                ) : (
                  <SalesOrdersView orders={snapshot.salesOrders} mode={view} onOpen={setSelectedSoId} onShip={(so) => setActiveCommand({ kind: "ship", entityId: so.id, entityNumber: so.number })} />
                )}
                </OperationsWorkspace>
              )}
              {view === "fulfillment" && (
                selectedSo ? (
                  <SalesOrderDetail so={selectedSo} onBack={() => setSelectedSoId(null)} onReserve={() => setActiveCommand({ kind: "reserve", entityId: selectedSo.id, entityNumber: selectedSo.number })} onShip={() => setActiveCommand({ kind: "ship", entityId: selectedSo.id, entityNumber: selectedSo.number })} />
                ) : (
                  <SalesOrdersView orders={snapshot.salesOrders} mode={view} onOpen={setSelectedSoId} onShip={(so) => setActiveCommand({ kind: "ship", entityId: so.id, entityNumber: so.number })} />
                )
              )}
              {view === "customer-returns" && <CustomerReturnsView orders={snapshot.salesOrders} onReturn={(so) => setActiveCommand({ kind: "customer-return", entityId: so.id, entityNumber: so.number })} />}
              {view === "stock" && (
                <OperationsWorkspace workspace="inventory" onDurableRefresh={loadSnapshot}>
                  {selectedProduct ? <ProductDetail product={selectedProduct} movements={snapshot.movements} onBack={() => setSelectedProductId(null)} /> : <InventoryView products={snapshot.products} onOpen={setSelectedProductId} />}
                </OperationsWorkspace>
              )}
              {view === "products" && (selectedProduct ? <ProductDetail product={selectedProduct} movements={snapshot.movements} onBack={() => setSelectedProductId(null)} /> : <InventoryView products={snapshot.products} onOpen={setSelectedProductId} />)}
              {view === "movements" && <MovementsView movements={snapshot.movements} />}
              {view === "counts" && <OperationsWorkspace workspace="inventory" onDurableRefresh={loadSnapshot}><CountsView products={snapshot.products} balances={snapshot.inventoryBalances} onCount={(product, balance) => setActiveCommand({ kind: "count", entityId: product.id, entityNumber: `COUNT · ${product.sku}`, locationId: balance.locationId, locationLabel: `${balance.warehouseName} / ${balance.locationCode}`, recordedQuantity: balance.recordedQuantity, balanceVersion: balance.version })} /></OperationsWorkspace>}
              {view === "vendor-bills" && <OperationsWorkspace workspace="vendor-billing" onDurableRefresh={loadSnapshot}><VendorBillsView bills={snapshot.bills} /></OperationsWorkspace>}
              {view === "customer-invoices" && <OperationsWorkspace workspace="customer-billing" onDurableRefresh={loadSnapshot}><InvoicesView salesOrders={snapshot.salesOrders} /></OperationsWorkspace>}
              {view === "partners" && <PartnersView partners={snapshot.partners} />}
              {view === "reports" && <OperationsWorkspace workspace="controls" onDurableRefresh={loadSnapshot}><ReportsView snapshot={snapshot} /></OperationsWorkspace>}
              {view === "warehouse" && <WarehouseView snapshot={snapshot} onReceive={(po) => setActiveCommand({ kind: "receive", entityId: po.id, entityNumber: po.number })} />}
            </>
          )}
        </main>
      </div>

      {searchOpen && (
        <div className="command-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
          <section className="command-palette" role="dialog" aria-modal="true" aria-label="Global search">
            <div className="command-input-row"><span aria-hidden="true">⌕</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by document, SKU, barcode, customer, or dimensions" aria-label="Global search" /><kbd>Esc</kbd></div>
            <div className="search-results">
              {!query && <div className="search-hint"><strong>Find anything operational</strong><span>Search a document number, SKU, customer, project, dimension, or inventory-unit ID.</span></div>}
              {query && searchResults.length === 0 && <div className="empty-inline">No records match “{query}”.</div>}
              {searchResults.map((result) => (
                <button key={`${result.type}-${result.id}`} onClick={() => {
                  navigate(result.view);
                  if (result.view === "purchase-orders") setSelectedPoId(result.id);
                  if (result.view === "sales-orders") setSelectedSoId(result.id);
                  if (result.view === "stock") setSelectedProductId(result.id);
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
          products={snapshot.products}
          countBalances={snapshot.inventoryBalances.filter((item) => item.productId === activeCommand.entityId)}
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
          onClose={() => setCreateOrder(null)}
          onSubmit={(payload) => createOperationalOrder(createOrder, payload)}
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

function PageActions({ view, onNavigate, onCreate }: { view: ViewKey; onNavigate: (view: ViewKey) => void; onCreate: (type: "purchaseOrder" | "salesOrder") => void }) {
  if (view === "home") return <button className="button secondary" onClick={() => onNavigate("reports")}>View reports</button>;
  if (view === "purchase-orders") return <button className="button primary" onClick={() => onCreate("purchaseOrder")}>Create purchase order</button>;
  if (view === "sales-orders") return <button className="button primary" onClick={() => onCreate("salesOrder")}>Create sales order</button>;
  if (view === "stock") return <button className="button secondary" onClick={() => onNavigate("counts")}>Start inventory count</button>;
  if (view === "warehouse") return <span className="connection server"><span /> Online</span>;
  return null;
}

function Dashboard({ snapshot, navigate, openPo }: { snapshot: Snapshot; navigate: (view: ViewKey) => void; openPo: (id: string) => void }) {
  const due = snapshot.purchaseOrders.filter((po) => po.open > 0 || po.daysLate > 0).slice(0, 4);
  const openReceiptUnits = snapshot.purchaseOrders.reduce((sum, po) => sum + po.open, 0);
  const readyUnits = snapshot.salesOrders.reduce((sum, so) => sum + Math.max(so.reserved - so.shipped, 0), 0);
  const inventoryRisks = snapshot.products.filter((product) => product.projected < 0 || product.available <= product.reorderPoint || product.usable < product.onHand);
  const specialOrder = snapshot.products.find((product) => product.customerRef);
  return (
    <div className="dashboard-grid">
      <section className="urgent-band" aria-labelledby="urgent-heading">
        <div><span className="section-kicker">Attention needed</span><h2 id="urgent-heading">Resolve today&apos;s exceptions</h2></div>
        <div className="urgent-actions">
          <button onClick={() => navigate("expected-receipts")}><strong>{snapshot.summary.lateReceipts}</strong><span>Late receipts</span><b>Review →</b></button>
          <button onClick={() => navigate("sales-orders")}><strong>{snapshot.summary.blockedSales}</strong><span>Blocked sales orders</span><b>Resolve →</b></button>
          <button onClick={() => navigate("purchase-orders")}><strong>{snapshot.summary.approvals}</strong><span>Approvals waiting</span><b>Review →</b></button>
        </div>
      </section>

      <section className="metric-row" aria-label="Today's work">
        <MetricCard label="Receipts due" value={snapshot.summary.dueReceipts} detail={`${openReceiptUnits} total units open`} tone="info" onClick={() => navigate("expected-receipts")} />
        <MetricCard label="Ready to ship" value={snapshot.summary.readyToShip} detail={`${readyUnits} reserved units ready`} tone="success" onClick={() => navigate("fulfillment")} />
        <MetricCard label="Customer pickups" value={snapshot.summary.pickups} detail="Current pickup worklist" tone="neutral" onClick={() => navigate("fulfillment")} />
        <MetricCard label="Inventory risks" value={inventoryRisks.length} detail="Below target, short, or on hold" tone="warning" onClick={() => navigate("stock")} />
      </section>

      <section className="panel today-panel">
        <PanelHeading title="Inbound today" detail="Ordered by customer impact" action="View all receipts" onAction={() => navigate("expected-receipts")} />
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
        <PanelHeading title="Recent activity" detail="Physical and commercial events" />
        <div className="timeline">{snapshot.activities.map((activity) => (
          <div className="timeline-item" key={activity.id}><span className={`timeline-dot ${activity.tone}`} /><div><strong>{activity.title}</strong><p>{activity.detail}</p><small>{activity.time}</small></div></div>
        ))}{!snapshot.activities.length ? <div className="empty-inline">No durable activity has been recorded yet.</div> : null}</div>
      </section>

      <section className="panel wide-panel">
        <PanelHeading title="Special-order watch" detail="Customer-specific windows and linked supply" action="View inventory" onAction={() => navigate("stock")} />
        {specialOrder ? <div className="special-order-strip">
          <div className="window-thumb" aria-hidden="true"><span /><span /><span /><span /></div>
          <div><span className="section-kicker">{specialOrder.policy} · {specialOrder.sku}</span><h3>{specialOrder.name}</h3><p>{specialOrder.specification}</p></div>
          <div><small>Linked demand</small><strong>{specialOrder.customerRef}</strong><span>{specialOrder.reserved} reserved · {specialOrder.demand} open demand</span></div>
          <div><small>Current location</small><strong>{specialOrder.location}</strong><span>{specialOrder.available} available · {specialOrder.onHand} on hand</span></div>
          <button className="button secondary" onClick={() => navigate("stock")}>View inventory</button>
        </div> : <div className="empty-inline">No customer-linked special-order inventory is present in the live snapshot.</div>}
      </section>
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

function FilterBar({ placeholder = "Search this worklist", children }: { placeholder?: string; children?: ReactNode }) {
  return <div className="filter-bar"><label className="list-search"><span aria-hidden="true">⌕</span><input placeholder={placeholder} aria-label={placeholder} /></label>{children}</div>;
}

function PurchaseOrdersView({ orders, mode, onOpen, onReceive }: { orders: PurchaseOrder[]; mode: "purchase-orders" | "expected-receipts"; onOpen: (id: string) => void; onReceive: (po: PurchaseOrder) => void }) {
  const [filter, setFilter] = useState(mode === "expected-receipts" ? "Due and late" : "All open");
  const visible = mode === "expected-receipts" ? orders.filter((po) => po.open > 0 || po.daysLate > 0) : orders;
  return <section className="panel worklist">
    <div className="saved-view-row"><div className="view-tabs">{[mode === "expected-receipts" ? "Due and late" : "All open", "Partially received", "Closed short", "Awaiting approval"].map((label) => <button key={label} className={filter === label ? "active" : ""} onClick={() => setFilter(label)}>{label}{label === "Closed short" && <span>1</span>}</button>)}</div><button className="text-button">Save view</button></div>
    <FilterBar placeholder={mode === "expected-receipts" ? "Search PO, vendor, or customer" : "Search purchase orders"}><button className="filter-button">All warehouses</button><button className="filter-button">Status</button><button className="filter-button">Expected date</button></FilterBar>
    <div className="active-filters"><span>{filter}<button aria-label={`Remove ${filter} filter`}>×</button></span><button>Clear all</button></div>
    <div className="responsive-table"><table><caption className="sr-only">Purchase orders</caption><thead><tr><th>Exception</th><th>PO</th><th>Vendor</th><th>Expected</th><th className="numeric">Ordered</th><th className="numeric">Net received</th><th className="numeric">Closed</th><th className="numeric">Open</th><th>Billing</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{visible.map((po) => <tr key={po.id}>
      <td>{po.exception ? <span className={`exception-cell ${po.daysLate > 0 ? "danger" : "warning"}`} title={po.exception}>!</span> : <span className="muted">—</span>}</td>
      <td><button className="table-link" onClick={() => onOpen(po.id)}>{po.number}</button><small>Rev {po.revision}</small></td>
      <td><strong>{po.vendor}</strong>{po.customerRef && <small>{po.customerRef}</small>}</td>
      <td>{po.daysLate > 0 ? <StatusBadge tone="danger">{po.daysLate} days late</StatusBadge> : formatDate(po.expectedDate)}</td>
      <td className="numeric">{po.ordered}</td><td className="numeric">{po.received - po.returned}</td><td className="numeric">{po.closed}</td><td className="numeric strong">{po.open}</td>
      <td><StatusBadge>{po.billing}</StatusBadge></td>
      <td>{po.open > 0 ? <button className="row-action" onClick={() => onReceive(po)}>Receive</button> : <button className="row-action" onClick={() => onOpen(po.id)}>Open</button>}</td>
    </tr>)}</tbody></table></div>
    <div className="table-footer"><span>Showing {visible.length} of {visible.length} records</span><div><button disabled>Previous</button><button disabled>Next</button></div></div>
  </section>;
}

function PurchaseOrderDetail({ po, onBack, onCommand }: { po: PurchaseOrder; onBack: () => void; onCommand: (kind: CommandKind) => void }) {
  return <div className="object-page">
    <button className="back-button" onClick={onBack}>← Back to purchase orders</button>
    <section className="object-header panel"><div className="object-title"><div><span className="section-kicker">Purchase order · Revision {po.revision}</span><h2>{po.number}</h2><p>{po.vendor} · destination selected per receipt</p></div><div className="object-total"><span>Total</span><strong>{money.format(po.total)}</strong></div></div>
      <div className="status-summary"><div><small>Commercial</small><StatusBadge>{po.lifecycle}</StatusBadge></div><div><small>Physical</small><StatusBadge>{po.fulfillment}</StatusBadge></div><div><small>Financial</small><StatusBadge>{po.billing}</StatusBadge></div></div>
      {po.exception && <div className="exception-banner"><span aria-hidden="true">!</span><div><strong>Action needed</strong><p>{po.exception}</p></div></div>}
      <div className="object-actions">
        {po.open > 0 && <button className="button primary" onClick={() => onCommand("receive")}>Receive remaining</button>}
        {po.closed > 0 && <button className="button primary" onClick={() => onCommand("reopen")}>Reopen quantity to receive</button>}
        {po.open > 0 && <button className="button secondary" onClick={() => onCommand("close")}>Close unreceived quantity</button>}
        {po.received > 0 && <button className="button secondary" onClick={() => onCommand("reverse")}>Reverse incorrect receipt</button>}
        {po.received - po.returned > 0 && <button className="button ghost" onClick={() => onCommand("vendor-return")}>Return to vendor</button>}
      </div>
    </section>
    <section className="metric-row object-metrics">
      <MetricDisplay label="Ordered" value={po.ordered} />
      <MetricDisplay label="Net retained" value={po.received - po.returned} />
      <MetricDisplay label="Closed without receipt" value={po.closed} tone={po.closed > 0 ? "warning" : "neutral"} />
      <MetricDisplay label="Open to receive" value={po.open} tone={po.open > 0 ? "info" : "neutral"} />
    </section>
    <section className="panel"><PanelHeading title="Order lines" detail="Received quantities are calculated from posted physical documents and cannot be edited here." />
      <div className="responsive-table"><table><caption className="sr-only">Purchase order lines and quantity breakdown</caption><thead><tr><th>Product / configuration</th><th>Customer / project</th><th className="numeric">Ordered</th><th className="numeric">Net received</th><th className="numeric">Returned</th><th className="numeric">Closed</th><th className="numeric">Open</th><th className="numeric">Unit cost</th></tr></thead><tbody>{po.lines.map((line) => <tr key={line.id}><td><strong>{line.product}</strong><small>{line.sku} · {line.specification}</small></td><td>{line.customerRef ? <span className="allocation-tag">{line.customerRef}</span> : <span className="muted">Stock</span>}</td><td className="numeric">{line.ordered}</td><td className="numeric strong">{line.received - line.returned}</td><td className="numeric">{line.returned}</td><td className="numeric">{line.closed}</td><td className="numeric strong">{line.open}</td><td className="numeric">{money.format(line.unitCost)}</td></tr>)}</tbody></table></div>
    </section>
    <div className="detail-columns"><section className="panel"><PanelHeading title="Related state" detail="Current commercial, physical, and financial facts" /><dl className="definition-list"><div><dt>Purchase order</dt><dd>{po.number} · revision {po.revision}</dd></div><div><dt>Receipt lineage</dt><dd>{po.latestReceiptId ?? (po.received > 0 ? "Recorded stock movements" : "No receipt posted")}</dd></div><div><dt>Linked demand</dt><dd>{po.customerRef ?? "Stock replenishment"}</dd></div><div><dt>Billing</dt><dd>{po.billing}</dd></div></dl></section>
      <section className="panel"><PanelHeading title="Posting summary" detail="Derived from durable order and movement totals" /><div className="timeline"><div className="timeline-item"><span className="timeline-dot info" /><div><strong>Revision {po.revision} · {po.lifecycle}</strong><p>Commercial state is version checked independently of inventory.</p><small>{po.buyer || "Buyer not recorded"}</small></div></div><div className="timeline-item"><span className="timeline-dot success" /><div><strong>{po.received - po.returned} units net retained</strong><p>{po.received} received · {po.returned} returned · {po.closed} closed without receipt.</p><small>{po.fulfillment}</small></div></div></div></section></div>
  </div>;
}

function MetricDisplay({ label, value, tone = "neutral" }: { label: string; value: number | string; tone?: Severity }) {
  return <div className={`metric-display ${tone}`}><span>{label}</span><strong>{value}</strong><small>Backed by source records</small></div>;
}

function VendorReturnsView({ orders, onReturn }: { orders: PurchaseOrder[]; onReturn: (po: PurchaseOrder) => void }) {
  const eligible = orders.filter((po) => po.received - po.returned > 0);
  return <section className="panel worklist"><div className="info-banner"><span aria-hidden="true">i</span><p><strong>Returns are physical movements.</strong> For a price-only allowance where goods stay in stock, use a vendor credit instead.</p></div><FilterBar placeholder="Search receipt, PO, vendor, or unit ID"><button className="filter-button">Eligible stock</button><button className="filter-button">Quarantine</button></FilterBar><div className="record-cards">{eligible.map((po) => <article className="record-card" key={po.id}><div><span className="section-kicker">{po.number}</span><h3>{po.vendor}</h3><p>{po.lines[0]?.product ?? "Purchase-order inventory"}</p></div><div className="card-metrics"><span><small>Eligible to return</small><strong>{po.received - po.returned}</strong></span><span><small>Receipt lineage</small><strong>{po.latestReceiptId ?? "Movement history"}</strong></span></div><button className="button secondary" onClick={() => onReturn(po)}>Start vendor return</button></article>)}{!eligible.length ? <div className="empty-inline">No retained purchase receipts are currently eligible for return.</div> : null}</div></section>;
}

function SalesOrdersView({ orders, mode, onOpen, onShip }: { orders: SalesOrder[]; mode: "sales-orders" | "fulfillment"; onOpen: (id: string) => void; onShip: (so: SalesOrder) => void }) {
  const visible = mode === "fulfillment" ? orders.filter((so) => so.reserved > so.shipped) : orders;
  return <section className="panel worklist"><div className="saved-view-row"><div className="view-tabs"><button className="active">{mode === "fulfillment" ? "Ready and partially ready" : "Open orders"}</button><button>Shortages</button><button>Special orders received</button><button>Customer pickup</button></div><button className="text-button">Save view</button></div><FilterBar placeholder="Search SO, customer, project, or customer PO"><button className="filter-button">Requested date</button><button className="filter-button">Route</button></FilterBar><div className="responsive-table"><table><caption className="sr-only">Sales orders</caption><thead><tr><th>Exception</th><th>SO</th><th>Customer / project</th><th>Requested</th><th>Availability</th><th>Fulfillment</th><th>Invoice</th><th className="numeric">Total</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{visible.map((so) => <tr key={so.id}><td>{so.exception ? <span className={`exception-cell ${so.shortage > 0 ? "danger" : "warning"}`}>!</span> : "—"}</td><td><button className="table-link" onClick={() => onOpen(so.id)}>{so.number}</button><small>{so.route}</small></td><td><strong>{so.customer}</strong><small>{so.project}</small></td><td>{formatDate(so.requestedDate)}</td><td><div className="availability-mini"><strong>{so.availableNow} now</strong><span>{so.incomingBeforeDate} incoming</span>{so.shortage > 0 && <b>{so.shortage} short</b>}</div></td><td><StatusBadge>{so.fulfillment}</StatusBadge></td><td><StatusBadge>{so.billing}</StatusBadge></td><td className="numeric strong">{money.format(so.total)}</td><td>{so.reserved > so.shipped ? <button className="row-action" onClick={() => onShip(so)}>Post shipment</button> : <button className="row-action" onClick={() => onOpen(so.id)}>Open</button>}</td></tr>)}</tbody></table></div></section>;
}

function SalesOrderDetail({ so, onBack, onReserve, onShip }: { so: SalesOrder; onBack: () => void; onReserve: () => void; onShip: () => void }) {
  return <div className="object-page"><button className="back-button" onClick={onBack}>← Back to sales orders</button><section className="object-header panel"><div className="object-title"><div><span className="section-kicker">Sales order · {so.route}</span><h2>{so.number}</h2><p>{so.customer} · {so.project}</p></div><div className="object-total"><span>Total</span><strong>{money.format(so.total)}</strong></div></div><div className="status-summary"><div><small>Commercial</small><StatusBadge>{so.lifecycle}</StatusBadge></div><div><small>Physical</small><StatusBadge>{so.fulfillment}</StatusBadge></div><div><small>Financial</small><StatusBadge>{so.billing}</StatusBadge></div></div>{so.exception && <div className="exception-banner"><span>!</span><div><strong>Fulfillment exception</strong><p>{so.exception}</p></div></div>}<div className="object-actions"><button className="button primary" onClick={onShip} disabled={so.reserved <= so.shipped}>Post shipment</button><button className="button secondary" onClick={onReserve} disabled={so.open <= so.reserved || so.availableNow <= 0}>Reserve available stock</button><button className="button ghost">Resolve shortage</button></div></section>
    <section className="panel availability-panel"><PanelHeading title="Availability for requested date" detail={`Requested ${formatDate(so.requestedDate)}`} /><div className="availability-grid"><MetricDisplay label="Required" value={so.open} /><MetricDisplay label="Available now" value={so.availableNow} tone="success" /><MetricDisplay label="Incoming before date" value={so.incomingBeforeDate} tone="info" /><MetricDisplay label="Shortage" value={so.shortage} tone={so.shortage > 0 ? "danger" : "neutral"} /></div>{so.linkedPo && <div className="linked-supply"><span className="section-kicker">Linked supply</span><strong>{so.linkedPo} · vendor confirmed</strong><p>{so.incomingBeforeDate} units expected before the customer&apos;s requested date.</p></div>}</section>
    <div className="detail-columns"><section className="panel"><PanelHeading title="Fulfillment quantities" /><dl className="definition-list"><div><dt>Ordered</dt><dd>{so.ordered}</dd></div><div><dt>Reserved</dt><dd>{so.reserved}</dd></div><div><dt>Net shipped</dt><dd>{so.shipped}</dd></div><div><dt>Open to ship</dt><dd>{so.open}</dd></div></dl></section><section className="panel"><PanelHeading title="Customer delivery" /><dl className="definition-list"><div><dt>Method</dt><dd>{so.route}</dd></div><div><dt>Requested</dt><dd>{formatDate(so.requestedDate)}</dd></div><div><dt>Job site</dt><dd>{so.project}</dd></div><div><dt>Billing policy</dt><dd>Delivered quantity</dd></div></dl></section></div>
  </div>;
}

function CustomerReturnsView({ orders, onReturn }: { orders: SalesOrder[]; onReturn: (so: SalesOrder) => void }) {
  return <section className="panel worklist"><div className="info-banner"><span aria-hidden="true">i</span><p><strong>Physical and financial outcomes are separate.</strong> Receiving a return changes stock; issuing a credit changes the customer balance.</p></div><FilterBar placeholder="Search shipment, invoice, sales order, or customer" /><div className="record-cards">{orders.filter((so) => so.shipped > 0 || so.fulfillment.includes("Ready")).map((so) => <article className="record-card" key={so.id}><div><span className="section-kicker">{so.number}</span><h3>{so.customer}</h3><p>{so.project}</p></div><div className="card-metrics"><span><small>Shipped</small><strong>{so.shipped || so.reserved}</strong></span><span><small>Eligible return</small><strong>{so.shipped || so.reserved}</strong></span></div><button className="button secondary" onClick={() => onReturn(so)}>Create customer return</button></article>)}</div></section>;
}

function InventoryView({ products, onOpen }: { products: Product[]; onOpen: (id: string) => void }) {
  const onHand = products.reduce((sum, item) => sum + item.onHand, 0);
  const available = products.reduce((sum, item) => sum + item.available, 0);
  const reserved = products.reduce((sum, item) => sum + item.reserved, 0);
  const incoming = products.reduce((sum, item) => sum + item.incoming, 0);
  return <div className="stack"><section className="metric-row object-metrics"><MetricDisplay label="On hand" value={onHand} /><MetricDisplay label="Usable" value={products.reduce((sum, item) => sum + item.usable, 0)} /><MetricDisplay label="Reserved" value={reserved} tone="info" /><MetricDisplay label="Available now" value={available} tone="success" /><MetricDisplay label="Incoming" value={incoming} tone="info" /></section><section className="panel worklist"><FilterBar placeholder="Search SKU, manufacturer, dimensions, unit ID, or allocation"><button className="filter-button">All warehouses</button><button className="filter-button">All statuses</button><button className="filter-button">All locations</button></FilterBar><div className="responsive-table"><table><caption className="sr-only">Inventory balances by product</caption><thead><tr><th>Product / configuration</th><th>Warehouse location</th><th className="numeric">On hand</th><th className="numeric">Usable</th><th className="numeric">Reserved</th><th className="numeric">Available</th><th className="numeric">Incoming</th><th className="numeric">Demand</th><th className="numeric">Projected</th><th>Exception</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><button className="table-link" onClick={() => onOpen(product.id)}>{product.name}</button><small>{product.sku} · {product.specification}</small>{product.customerRef && <span className="allocation-tag">{product.customerRef}</span>}</td><td><strong>{product.locationCode}</strong><small>{product.location}</small></td><td className="numeric">{product.onHand}</td><td className="numeric">{product.usable}</td><td className="numeric">{product.reserved}</td><td className="numeric strong">{product.available}</td><td className="numeric">{product.incoming}</td><td className="numeric">{product.demand}</td><td className={`numeric strong ${product.projected < 0 ? "text-danger" : ""}`}>{product.projected}</td><td>{product.projected < 0 ? <StatusBadge tone="danger">Shortage {Math.abs(product.projected)}</StatusBadge> : product.available <= product.reorderPoint ? <StatusBadge tone="warning">Below target</StatusBadge> : <StatusBadge tone="success">Healthy</StatusBadge>}</td></tr>)}</tbody></table></div></section></div>;
}

function ProductDetail({ product, movements, onBack }: { product: Product; movements: Movement[]; onBack: () => void }) {
  const productMovements = movements.filter((movement) => movement.product === product.sku);
  return <div className="object-page"><button className="back-button" onClick={onBack}>← Back to inventory</button><section className="object-header panel product-header"><div className="window-thumb large" aria-hidden="true"><span /><span /><span /><span /></div><div className="object-title"><div><span className="section-kicker">{product.policy}</span><h2>{product.name}</h2><p>{product.specification}</p><code>{product.sku}</code></div></div>{product.customerRef && <div className="exception-banner info"><span>↗</span><div><strong>Customer-specific allocation</strong><p>{product.customerRef}</p></div></div>}</section><section className="metric-row object-metrics"><MetricDisplay label="On hand" value={product.onHand} /><MetricDisplay label="Usable" value={product.usable} /><MetricDisplay label="Reserved" value={product.reserved} tone="info" /><MetricDisplay label="Available now" value={product.available} tone="success" /><MetricDisplay label="Incoming" value={product.incoming} tone="info" /><MetricDisplay label="Projected" value={product.projected} tone={product.projected < 0 ? "danger" : "neutral"} /></section><div className="detail-columns"><section className="panel"><PanelHeading title="Current location" detail="Human-readable path and scannable code" /><div className="location-card"><span className="location-code">{product.locationCode}</span><div><strong>{product.location}</strong><p>Condition: Available</p></div><button className="button secondary">Transfer inventory</button></div></section><section className="panel"><PanelHeading title="Allocation" /><dl className="definition-list"><div><dt>Policy</dt><dd>{product.policy}</dd></div><div><dt>Customer / project</dt><dd>{product.customerRef ?? "Unallocated stock"}</dd></div><div><dt>Reorder point</dt><dd>{product.reorderPoint}</dd></div></dl></section></div><section className="panel"><PanelHeading title="Movement history" detail="These posted records reconstruct the displayed on-hand quantity." />{productMovements.length ? <MovementsTable movements={productMovements} /> : <div className="empty-inline">No movement records match this product in the current view.</div>}</section></div>;
}

function MovementsView({ movements }: { movements: Movement[] }) {
  return <section className="panel worklist"><div className="info-banner"><span aria-hidden="true">✓</span><p><strong>Immutable physical ledger.</strong> Posted movements cannot be edited or deleted; corrections create linked counter-movements.</p></div><FilterBar placeholder="Search document, product, location, or user"><button className="filter-button">Movement type</button><button className="filter-button">Date range</button></FilterBar><MovementsTable movements={movements} /></section>;
}

function MovementsTable({ movements }: { movements: Movement[] }) {
  return <div className="responsive-table"><table><caption className="sr-only">Posted inventory movements</caption><thead><tr><th>Date and time</th><th>Movement</th><th>Source document</th><th>Product / unit</th><th className="numeric">Quantity</th><th>From</th><th>To</th><th>Posted by</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td>{movement.time}</td><td><StatusBadge>{movement.type}</StatusBadge></td><td><button className="table-link">{movement.document}</button></td><td><code>{movement.product}</code></td><td className={`numeric strong ${movement.quantity < 0 ? "text-danger" : "text-success"}`}>{movement.quantity > 0 ? "+" : ""}{movement.quantity}</td><td>{movement.from}</td><td>{movement.to}</td><td>{movement.user}</td></tr>)}</tbody></table></div>;
}

function CountsView({ products, balances, onCount }: { products: Product[]; balances: InventoryLocationBalance[]; onCount: (product: Product, balance: InventoryLocationBalance) => void }) {
  const first = balances[0]; const firstProduct = products.find((item) => item.id === first?.productId);
  return <div className="stack"><section className="panel count-hero"><div><span className="section-kicker">Durable cycle counts</span><h2>Count by product and location</h2><p>Each count uses the current per-location book quantity and version. A variance never overwrites inventory; it posts a linked adjustment movement.</p></div><div className="progress-ring"><strong>{balances.length}</strong><span>balances</span></div><button className="button primary" disabled={!first || !firstProduct} onClick={() => { if (first && firstProduct) onCount(firstProduct, first); }}>Start count</button></section><section className="panel"><PanelHeading title="Active location balances" detail="Choose the exact warehouse location being physically counted." /><div className="responsive-table"><table><caption className="sr-only">Inventory balances available for cycle counting</caption><thead><tr><th>Product</th><th>Warehouse location</th><th className="numeric">Book quantity</th><th className="numeric">Reserved</th><th className="numeric">Available</th><th>Version</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{balances.map((balance) => { const product = products.find((item) => item.id === balance.productId); if (!product) return null; return <tr key={`${balance.productId}-${balance.locationId}`}><td><strong>{product.name}</strong><small>{product.sku}</small></td><td><strong>{balance.warehouseName} · {balance.locationCode}</strong><small>{balance.locationName}</small></td><td className="numeric strong">{balance.recordedQuantity}</td><td className="numeric">{balance.reservedQuantity}</td><td className="numeric">{balance.recordedQuantity - balance.reservedQuantity}</td><td>{balance.version}</td><td><button className="button secondary" onClick={() => onCount(product, balance)}>Count location</button></td></tr>; })}{!balances.length ? <tr><td colSpan={7}><div className="empty-inline">No active durable location balances are available to count.</div></td></tr> : null}</tbody></table></div></section></div>;
}


function PartnersView({ partners }: { partners: Partner[] }) {
  return <section className="panel worklist"><FilterBar placeholder="Search customer, vendor, contact, or account"><button className="filter-button">All partner types</button></FilterBar><div className="responsive-table"><table><caption className="sr-only">Customers and vendors from the live partner registry</caption><thead><tr><th>Partner</th><th>Type</th><th>Email</th><th>Phone</th><th>Record ID</th></tr></thead><tbody>{partners.map((partner) => <tr key={partner.id}><td><strong>{partner.name}</strong></td><td>{titleCase(partner.type)}</td><td>{partner.email || "—"}</td><td>{partner.phone || "—"}</td><td><small>{partner.id}</small></td></tr>)}{!partners.length ? <tr><td colSpan={5}><div className="empty-inline">No business partners have been created yet.</div></td></tr> : null}</tbody></table></div></section>;
}


function VendorBillsView({ bills }: { bills: Bill[] }) {
  return <section className="panel worklist"><div className="info-banner"><span aria-hidden="true">i</span><p><strong>Financial workspace.</strong> Open the Match exceptions tab above to create a bill or post an exception resolution.</p></div><FilterBar placeholder="Search vendor, bill, or PO" /><div className="responsive-table"><table><caption className="sr-only">Vendor bills</caption><thead><tr><th>Bill</th><th>Vendor</th><th>Purchase order</th><th className="numeric">Received value</th><th className="numeric">Billed</th><th className="numeric">Variance</th><th>Status</th><th>Next action</th></tr></thead><tbody>{bills.map((bill) => <tr key={bill.id}><td><strong>{bill.number}</strong></td><td>{bill.vendor}</td><td>{bill.po}</td><td className="numeric">{money.format(bill.receivedValue)}</td><td className="numeric">{money.format(bill.billedValue)}</td><td className={`numeric strong ${bill.variance ? "text-danger" : ""}`}>{money.format(bill.variance)}</td><td><StatusBadge>{bill.status}</StatusBadge></td><td><span className="read-only-label">{bill.variance ? "Resolve in Match exceptions" : "Matched · no action"}</span></td></tr>)}</tbody></table></div></section>;
}

function InvoicesView({ salesOrders }: { salesOrders: SalesOrder[] }) {
  return <section className="panel worklist"><div className="info-banner"><span aria-hidden="true">i</span><p><strong>Delivered-quantity invoicing is active.</strong> Use Credits &amp; payments above to create invoices and post financial commands; none of them move stock.</p></div><FilterBar placeholder="Search invoice, shipment, customer, or sales order" /><div className="responsive-table"><table><caption className="sr-only">Customer invoice eligibility</caption><thead><tr><th>Sales order</th><th>Customer</th><th className="numeric">Ordered</th><th className="numeric">Posted shipment</th><th className="numeric">Already invoiced</th><th className="numeric">Available to invoice</th><th>State</th><th>Next action</th></tr></thead><tbody>{salesOrders.map((so) => { const invoiced = so.invoiced ?? 0; const available = Math.max(so.shipped - invoiced, 0); return <tr key={so.id}><td><strong>{so.number}</strong></td><td>{so.customer}</td><td className="numeric">{so.ordered}</td><td className="numeric">{so.shipped}</td><td className="numeric">{invoiced}</td><td className="numeric strong">{available}</td><td><StatusBadge>{so.billing}</StatusBadge></td><td><span className="read-only-label">{available > 0 ? "Create in Credits & payments" : so.shipped ? "Fully invoiced" : "Await posted shipment"}</span></td></tr>; })}</tbody></table></div></section>;
}

function ReportsView({ snapshot }: { snapshot: Snapshot }) {
  const [scope, setScope] = useState<"all" | "risk">("all");
  const products = scope === "risk" ? snapshot.products.filter((product) => product.projected < 0 || product.available <= product.reorderPoint) : snapshot.products;
  const exportCsv = () => {
    const rows = [["SKU", "Product", "Usable", "Incoming", "Demand", "Projected"], ...products.map((product) => [product.sku, product.name, product.usable, product.incoming, product.demand, product.projected])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `paneflow-availability-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const reports = [{ title: "Late purchase orders", detail: `${snapshot.summary.lateReceipts} POs currently late`, tone: "danger" as Severity }, { title: "Available versus reserved", detail: `${snapshot.products.reduce((sum, product) => sum + product.available, 0)} available · ${snapshot.products.reduce((sum, product) => sum + product.reserved, 0)} reserved`, tone: "info" as Severity }, { title: "Three-way-match exceptions", detail: `${snapshot.bills.filter((bill) => bill.variance).length} bill requires review`, tone: "warning" as Severity }, { title: "Special-order inventory", detail: `${snapshot.products.filter((product) => product.customerRef).length} customer-specific units`, tone: "success" as Severity }];
  return <div className="stack"><section className="report-grid" aria-label="Report summaries">{reports.map((report) => <article className={`report-card ${report.tone}`} key={report.title}><span className="report-icon" aria-hidden="true">▥</span><strong>{report.title}</strong><p>{report.detail}</p><b>Current live snapshot</b></article>)}</section><section className="panel"><PanelHeading title="Projected availability" detail="Exact current values with downloadable operational and accounting handoffs." /><div className="report-filters"><label>Scope<select value={scope} onChange={(event) => setScope(event.target.value as "all" | "risk")}><option value="all">All products</option><option value="risk">Risks only</option></select></label><span className="read-only-label">Current live snapshot · all configured locations</span><button className="button secondary" onClick={exportCsv}>Export current table</button><a className="button secondary" href="/api/export?type=accounting">Accounting control export</a><a className="button primary" href="/api/export?type=quickbooks">Export QuickBooks journal</a></div><p className="read-only-label">PaneFlow exports an audited journal handoff; QuickBooks remains the general ledger and system of record for statutory accounting.</p><div className="responsive-table"><table><caption className="sr-only">Projected product availability</caption><thead><tr><th>Product</th><th className="numeric">Usable now</th><th className="numeric">Incoming</th><th className="numeric">Open demand</th><th className="numeric">Projected</th><th>Risk</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.sku}</small></td><td className="numeric">{product.usable}</td><td className="numeric">{product.incoming}</td><td className="numeric">{product.demand}</td><td className={`numeric strong ${product.projected < 0 ? "text-danger" : ""}`}>{product.projected}</td><td>{product.projected < 0 ? <StatusBadge tone="danger">Demand exceeds supply</StatusBadge> : <StatusBadge tone="success">Covered</StatusBadge>}</td></tr>)}{!products.length ? <tr><td colSpan={6}><div className="empty-inline">No products are available in this scope.</div></td></tr> : null}</tbody></table></div></section></div>;
}

function WarehouseView({ snapshot, onReceive }: { snapshot: Snapshot; onReceive: (po: PurchaseOrder) => void }) {
  const orders = snapshot.purchaseOrders.filter((po) => po.open > 0);
  const readySales = snapshot.salesOrders.filter((so) => so.reserved > so.shipped);
  const receivingProducts = snapshot.products.filter((product) => /receiv/i.test(product.location));
  const next = orders[0];
  const tasks = [{ label: "Receive", count: orders.length, glyph: "↓" }, { label: "Put away", count: receivingProducts.length, glyph: "↳" }, { label: "Pick / ship", count: readySales.length, glyph: "→" }, { label: "Count locations", count: snapshot.inventoryBalances.length, glyph: "#" }];
  return <div className="warehouse-shell"><div className="warehouse-header"><div><span className="connection server"><span /> Live operations</span><h2>Warehouse work</h2><p>Counts reflect the current durable snapshot across configured locations.</p></div><div className="warehouse-user"><span>U</span><div><strong>Current user</strong><small>Permissions checked when posting</small></div></div></div><section className="warehouse-launcher" aria-label="Warehouse work counts">{tasks.map((task) => <article key={task.label}><span className="task-glyph" aria-hidden="true">{task.glyph}</span><strong>{task.label}</strong><small>{task.count} current work item{task.count === 1 ? "" : "s"}</small></article>)}</section>{next ? <section className="warehouse-next"><div className="step-header"><span>Next receipt</span><StatusBadge tone={next.daysLate > 0 ? "danger" : "info"}>{next.daysLate > 0 ? `${next.daysLate} days late` : formatDate(next.expectedDate)}</StatusBadge></div><h3>Receive {next.number}</h3><p>{next.vendor} · {next.customerRef ?? "Stock replenishment"}</p><div className="scan-zone"><span aria-hidden="true">▤</span><div><strong>Scan the purchase order or packing slip</strong><small>Scanner focus is ready. Manual entry is also available.</small></div><input aria-label="Scan purchase order or packing slip" placeholder="Scan or type code" autoComplete="off" /></div><button className="warehouse-primary" onClick={() => onReceive(next)}>Start receiving {next.number}</button></section> : <section className="warehouse-next"><div className="empty-inline">No approved purchase order currently has quantity open to receive.</div></section>}</div>;
}


function AdvancedCreateOrderDialog({ type, partners, products, onClose, onSubmit }: { type: "purchaseOrder" | "salesOrder"; partners: Partner[]; products: Product[]; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
  const isPurchase = type === "purchaseOrder";
  const eligiblePartners = partners.filter((partner) => partner.type === (isPurchase ? "vendor" : "customer"));
  const initialLine = (): ComposerLine => ({ id: crypto.randomUUID(), productId: products[0]?.id ?? "", quantity: 1, unitAmount: isPurchase ? 650 : 1150, discountRate: 0, taxCode: "GST", taxRate: 5, route: "stock", projectReference: "", sourceSalesOrderLineId: "", linkedPurchaseOrderLineId: "" });
  const [partnerId, setPartnerId] = useState(eligiblePartners[0]?.id ?? "");
  const [date, setDate] = useState(futureDate(isPurchase ? 14 : 21));
  const [currency, setCurrency] = useState("CAD");
  const [exchangeRate, setExchangeRate] = useState(1);
  const [terms, setTerms] = useState(isPurchase ? "Net 30" : "Net 15");
  const [dueDate, setDueDate] = useState(futureDate(isPurchase ? 44 : 36));
  const [freight, setFreight] = useState(0);
  const [fees, setFees] = useState(0);
  const [deposit, setDeposit] = useState(0);
  const [lines, setLines] = useState<ComposerLine[]>([initialLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);

  const itemSubtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitAmount, 0);
  const discountTotal = lines.reduce((sum, line) => sum + line.quantity * line.unitAmount * line.discountRate / 100, 0);
  const taxTotal = lines.reduce((sum, line) => sum + line.quantity * line.unitAmount * (1 - line.discountRate / 100) * line.taxRate / 100, 0) + (freight + fees) * .05;
  const total = itemSubtotal - discountTotal + freight + fees + deposit + taxTotal;
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const updateLine = (id: string, patch: Partial<ComposerLine>) => setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!partnerId) return setError(`Select a ${isPurchase ? "vendor" : "customer"}.`);
    if (!lines.length || lines.some((line) => !line.productId || line.quantity <= 0 || line.unitAmount < 0)) return setError("Every line needs a product, positive quantity, and valid unit amount.");
    if (isPurchase && lines.some((line) => line.route !== "stock" && !line.sourceSalesOrderLineId.trim())) return setError("Every special-order or drop-ship purchase line must link to its source sales-order line ID.");
    if (!date || !dueDate) return setError("Enter delivery and due dates.");
    if (currency !== "CAD" && exchangeRate <= 0) return setError("Enter a positive exchange rate for the foreign currency.");
    setSubmitting(true);
    try {
      const normalizedLines = lines.map((line) => {
        const product = products.find((item) => item.id === line.productId);
        return { kind: "item", productId: line.productId, quantity: line.quantity, unitCostCents: isPurchase ? Math.round(line.unitAmount * 100) : undefined, unitPriceCents: isPurchase ? undefined : Math.round(line.unitAmount * 100), discountCents: Math.round(line.quantity * line.unitAmount * line.discountRate), taxable: line.taxRate > 0, taxCode: line.taxCode, taxRateBps: Math.round(line.taxRate * 100), fulfillmentRoute: line.route.replaceAll("-", "_"), projectReference: line.projectReference, sourceSalesOrderLineId: isPurchase && line.route !== "stock" ? line.sourceSalesOrderLineId.trim() : undefined, linkedPurchaseOrderLineId: !isPurchase && line.linkedPurchaseOrderLineId.trim() ? line.linkedPurchaseOrderLineId.trim() : undefined, configurationSnapshot: product ? `${product.sku} · ${product.name} · ${product.specification}` : undefined };
      });
      const chargeLines = [
        freight > 0 ? { kind: "charge", chargeType: "freight", description: "Freight", amountCents: Math.round(freight * 100), direction: "add", taxable: true, refundable: false, taxCode: "GST", taxRateBps: 500 } : null,
        fees > 0 ? { kind: "charge", chargeType: "fee", description: "Other fees", amountCents: Math.round(fees * 100), direction: "add", taxable: true, refundable: false, taxCode: "GST", taxRateBps: 500 } : null,
        deposit > 0 ? { kind: "charge", chargeType: "returnable_deposit", description: "Refundable core / empty deposit", amountCents: Math.round(deposit * 100), direction: "add", taxable: false, refundable: true, taxCode: "EXEMPT", taxRateBps: 0 } : null,
      ].filter(Boolean);
      await onSubmit({ ...(isPurchase ? { vendorId: partnerId, expectedDate: date } : { customerId: partnerId, requestedDate: date }), lines: [...normalizedLines, ...chargeLines], currency, exchangeRateToBase: exchangeRate, paymentTerms: terms, dueDate });
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

  return <div className="modal-overlay" role="presentation"><section className="command-dialog create-order-dialog commercial-composer" role="dialog" aria-modal="true" aria-labelledby="create-order-title"><div className="dialog-header"><div><span className="section-kicker">New commercial commitment</span><h2 id="create-order-title">Create multi-line {isPurchase ? "purchase order" : "sales order"}</h2><p>Build the complete draft, then submit or confirm it as a separate command.</p></div><button ref={closeRef} className="icon-button" aria-label="Close dialog" onClick={onClose}>×</button></div><form onSubmit={submit}>
    {error && <div className="error-summary" role="alert" tabIndex={-1}><strong>Review the order</strong><p>{error}</p></div>}
    <div className="command-form form-grid composer-header-fields"><label>{isPurchase ? "Vendor" : "Customer"}<select value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>{eligiblePartners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select></label><label>{isPurchase ? "Expected delivery" : "Requested delivery"}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>CAD</option><option>USD</option><option>EUR</option></select></label>{currency !== "CAD" && <label>Exchange rate to CAD<input type="number" min="0.0001" step="0.0001" value={exchangeRate} onChange={(event) => setExchangeRate(Number(event.target.value))} /></label>}<label>Payment terms<select value={terms} onChange={(event) => setTerms(event.target.value)}><option>Due on receipt</option><option>Net 15</option><option>Net 30</option><option>Net 45</option></select></label><label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div>
    <section className="composer-lines" aria-labelledby="composer-lines-title"><div className="composer-section-heading"><div><strong id="composer-lines-title">Product lines</strong><small>Pricing, tax, route, and supply lineage are explicit per line.</small></div><button type="button" className="button secondary" onClick={() => setLines((current) => [...current, initialLine()])}>Add product line</button></div>{lines.map((line, index) => { const selected = products.find((product) => product.id === line.productId); return <fieldset key={line.id} className="composer-line"><legend>Line {index + 1}</legend><label className="product-field">Product / configuration<select value={line.productId} onChange={(event) => updateLine(line.id, { productId: event.target.value })}>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select><small>{selected?.specification}</small></label><label>Quantity<input type="number" min="1" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} /></label><label>Unit {isPurchase ? "cost" : "price"}<input type="number" min="0" step="0.01" value={line.unitAmount} onChange={(event) => updateLine(line.id, { unitAmount: Number(event.target.value) })} /></label><label>Discount %<input type="number" min="0" max="100" step="0.1" value={line.discountRate} onChange={(event) => updateLine(line.id, { discountRate: Number(event.target.value) })} /></label><label>Tax code<select value={line.taxCode} onChange={(event) => updateLine(line.id, { taxCode: event.target.value, taxRate: event.target.value === "GST" ? 5 : 0 })}><option>GST</option><option>Zero</option><option>Exempt</option></select></label><label>Tax %<input type="number" min="0" value={line.taxRate} onChange={(event) => updateLine(line.id, { taxRate: Number(event.target.value) })} /></label><label>Fulfillment route<select value={line.route} onChange={(event) => updateLine(line.id, { route: event.target.value as ComposerLine["route"] })}><option value="stock">Stock</option><option value="special-order">Special order</option><option value="drop-ship">Drop ship</option></select></label><label className="project-field">Customer / project / opening<input value={line.projectReference} onChange={(event) => updateLine(line.id, { projectReference: event.target.value })} placeholder="Optional allocation" /></label>{isPurchase && line.route !== "stock" ? <label className="project-field">Source sales-order line ID<input value={line.sourceSalesOrderLineId} onChange={(event) => updateLine(line.id, { sourceSalesOrderLineId: event.target.value })} placeholder="Required demand-line ID" required /></label> : null}{!isPurchase && line.route !== "stock" ? <label className="project-field">Linked purchase-order line ID<input value={line.linkedPurchaseOrderLineId} onChange={(event) => updateLine(line.id, { linkedPurchaseOrderLineId: event.target.value })} placeholder="Optional until supply PO is created" /></label> : null}{lines.length > 1 && <button type="button" className="remove-composer-line" onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}>Remove line {index + 1}</button>}</fieldset>; })}</section>
    <div className="composer-bottom-grid"><fieldset className="composer-charges"><legend>Charges, fees, and deposits</legend><label>Freight<input type="number" min="0" step="0.01" value={freight} onChange={(event) => setFreight(Number(event.target.value))} /></label><label>Other fees<input type="number" min="0" step="0.01" value={fees} onChange={(event) => setFees(Number(event.target.value))} /></label><label>Refundable core / empty deposit<input type="number" min="0" step="0.01" value={deposit} onChange={(event) => setDeposit(Number(event.target.value))} /></label></fieldset><dl className="composer-totals"><div><dt>Items</dt><dd>{currency} {itemSubtotal.toFixed(2)}</dd></div><div><dt>Discounts</dt><dd>−{currency} {discountTotal.toFixed(2)}</dd></div><div><dt>Freight & fees</dt><dd>{currency} {(freight + fees).toFixed(2)}</dd></div><div><dt>Refundable deposits</dt><dd>{currency} {deposit.toFixed(2)}</dd></div><div><dt>Tax</dt><dd>{currency} {taxTotal.toFixed(2)}</dd></div><div><dt>Paid</dt><dd>{currency} 0.00</dd></div><div className="total"><dt>Balance due</dt><dd>{currency} {total.toFixed(2)}</dd></div></dl></div>
    <div className="simplified-policy"><span aria-hidden="true">i</span><p>This creates an editable draft only. It does not move stock, reserve inventory, post a payable or receivable, or send the document.</p></div><ImpactPreview lines={impact} /><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Keep editing later</button><button type="submit" className="button primary" disabled={submitting}>{submitting ? "Saving draft…" : `Save ${isPurchase ? "purchase" : "sales"} order draft`}</button></div>
  </form></section></div>;
}

type CommandPanelProps = {
  command: ActiveCommand;
  po?: PurchaseOrder;
  so?: SalesOrder;
  products: Product[];
  countBalances: InventoryLocationBalance[];
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onRequestCountApproval: (payload: Record<string, unknown>) => Promise<{ approval: CountApproval; message: string }>;
  onApproveCountApproval: (approval: CountApproval, reason: string) => Promise<{ approval: CountApproval; message: string }>;
  onRefreshCountApproval: (approval: CountApproval) => Promise<CountApproval>;
};

function CommandPanel({ command, po, so, products, countBalances, onClose, onSubmit, onRequestCountApproval, onApproveCountApproval, onRefreshCountApproval }: CommandPanelProps) {
  const initialPoLine = po?.lines.find((line) => command.kind === "reopen" ? line.closed > 0 : command.kind === "vendor-return" ? line.received - line.returned > 0 : line.open > 0) ?? po?.lines[0];
  const initialSoLine = so?.lines?.find((line) => command.kind === "ship" ? line.reserved > 0 : line.open > 0) ?? so?.lines?.[0];
  const [selectedPoLineId, setSelectedPoLineId] = useState(initialPoLine?.id ?? "");
  const [selectedSoLineId, setSelectedSoLineId] = useState(initialSoLine?.id ?? "");
  const selectedPoLine = po?.lines.find((line) => line.id === selectedPoLineId) ?? initialPoLine;
  const selectedSoLine = so?.lines?.find((line) => line.id === selectedSoLineId) ?? initialSoLine;
  const selectedSoProduct = products.find((product) => product.id === selectedSoLine?.productId);
  const effectivePo = po && selectedPoLine ? { ...po, ordered: selectedPoLine.ordered, received: selectedPoLine.received, returned: selectedPoLine.returned, closed: selectedPoLine.closed, open: selectedPoLine.open, lines: [selectedPoLine] } : po;
  const lineAvailable = Math.min(selectedSoLine?.open ?? 0, selectedSoProduct?.available ?? 0);
  const lineIncoming = Math.min(Math.max((selectedSoLine?.open ?? 0) - lineAvailable, 0), selectedSoProduct?.incoming ?? 0);
  const effectiveSo = so && selectedSoLine ? { ...so, ordered: selectedSoLine.ordered, reserved: selectedSoLine.reserved, shipped: selectedSoLine.shipped, open: selectedSoLine.open, availableNow: lineAvailable, incomingBeforeDate: lineIncoming, shortage: Math.max(selectedSoLine.open - lineAvailable - lineIncoming, 0), route: titleCase(selectedSoLine.fulfillmentRoute), lines: [selectedSoLine] } : so;
  const defaults = commandDefaults(command.kind, effectivePo, effectiveSo, products);
  const initialBalance = countBalances.find((item) => item.locationId === command.locationId) ?? countBalances[0];
  const [quantity, setQuantity] = useState(command.kind === "count" ? initialBalance?.recordedQuantity ?? 0 : defaults.quantity);
  const [secondaryQuantity, setSecondaryQuantity] = useState(defaults.secondaryQuantity);
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState(defaults.disposition);
  const [expectedDate, setExpectedDate] = useState(futureDate(7));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [countApproval, setCountApproval] = useState<CountApproval | null>(null);
  const [approvedCountPayload, setApprovedCountPayload] = useState<Record<string, unknown> | null>(null);
  const [approvalMessage, setApprovalMessage] = useState("");
  const [countLocationId, setCountLocationId] = useState(initialBalance?.locationId ?? "");
  const title = commandTitle(command.kind);
  const selectedCountBalance = countBalances.find((item) => item.locationId === countLocationId);
  const impact = commandImpact(command.kind, quantity, secondaryQuantity, effectivePo, effectiveSo, disposition, selectedCountBalance?.recordedQuantity);
  const max = commandDefaults(command.kind, effectivePo, effectiveSo, products).max;
  const countPayload = () => {
    const lineId = ["receive", "close", "reopen", "vendor-return"].includes(command.kind)
      ? selectedPoLine?.id
      : ["reserve", "ship", "customer-return"].includes(command.kind)
        ? selectedSoLine?.id
        : undefined;
    return { quantity, quarantineQuantity: secondaryQuantity, reason, disposition, expectedDate, locationId: selectedCountBalance?.locationId, recordedQuantity: selectedCountBalance?.recordedQuantity, balanceVersion: selectedCountBalance?.version, ...(lineId ? { lineId } : {}) };
  };
  const chooseCountLocation = (locationId: string) => { const balance = countBalances.find((item) => item.locationId === locationId); setCountLocationId(locationId); setQuantity(balance?.recordedQuantity ?? 0); setApprovalRequired(false); setCountApproval(null); setApprovedCountPayload(null); setApprovalMessage(""); };
  const choosePoLine = (lineId: string) => { const line = po?.lines.find((item) => item.id === lineId); setSelectedPoLineId(lineId); if (po && line) setQuantity(commandDefaults(command.kind, { ...po, ordered: line.ordered, received: line.received, returned: line.returned, closed: line.closed, open: line.open, lines: [line] }, effectiveSo, products).quantity); };
  const chooseSoLine = (lineId: string) => { const line = so?.lines?.find((item) => item.id === lineId); const product = products.find((item) => item.id === line?.productId); if (!so || !line) return; const availableNow = Math.min(line.open, product?.available ?? 0); const incomingBeforeDate = Math.min(Math.max(line.open - availableNow, 0), product?.incoming ?? 0); setSelectedSoLineId(lineId); setQuantity(commandDefaults(command.kind, effectivePo, { ...so, ordered: line.ordered, reserved: line.reserved, shipped: line.shipped, open: line.open, availableNow, incomingBeforeDate, shortage: Math.max(line.open - availableNow - incomingBeforeDate, 0), route: titleCase(line.fulfillmentRoute), lines: [line] }, products).quantity); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (command.kind !== "count" && quantity <= 0) return setError("Enter a quantity greater than zero.");
    if (command.kind === "count" && (!selectedCountBalance || !Number.isFinite(selectedCountBalance.version))) return setError("Select a current durable location balance before posting the count.");
    if (command.kind === "count" && quantity < 0) return setError("The counted quantity cannot be negative.");
    if (command.kind !== "count" && max > 0 && quantity > max) return setError(`Quantity cannot exceed ${max}.`);
    if (command.kind === "receive" && secondaryQuantity > quantity) return setError("Quarantine quantity cannot exceed arrived quantity.");
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
    <fieldset className="command-fields-lock" disabled={command.kind === "count" && Boolean(countApproval)}><CommandFields kind={command.kind} po={effectivePo} so={effectiveSo} purchaseLines={po?.lines ?? []} salesLines={so?.lines ?? []} selectedPoLineId={selectedPoLine?.id ?? ""} selectedSoLineId={selectedSoLine?.id ?? ""} setSelectedPoLineId={choosePoLine} setSelectedSoLineId={chooseSoLine} quantity={quantity} secondaryQuantity={secondaryQuantity} setQuantity={setQuantity} setSecondaryQuantity={setSecondaryQuantity} reason={reason} setReason={setReason} disposition={disposition} setDisposition={setDisposition} expectedDate={expectedDate} setExpectedDate={setExpectedDate} max={max} countBalances={countBalances} countLocationId={countLocationId} setCountLocationId={chooseCountLocation} /></fieldset>
    {command.kind === "count" && approvalRequired ? <div className={`count-approval-status ${countApproval?.status ?? "required"}`} role="status"><strong>{countApproval ? `Approval ${countApproval.status}` : "Manager approval required"}</strong><p>{approvalMessage}</p>{countApproval ? <small>Request ID: {countApproval.id} · Version {countApproval.version}</small> : null}</div> : null}
    <ImpactPreview lines={impact} />
    <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Go back</button>{command.kind === "count" && approvalRequired ? !countApproval ? <button type="button" className="button primary" disabled={submitting} onClick={() => void requestApproval()}>{submitting ? "Requesting…" : "Request manager approval"}</button> : countApproval.status === "pending" && countApproval.canApprove ? <button type="button" className="button primary" disabled={submitting} onClick={() => void approveRequest()}>{submitting ? "Approving…" : "Approve this variance"}</button> : countApproval.status === "pending" ? <button type="button" className="button primary" disabled={submitting} onClick={() => void checkApproval()}>{submitting ? "Checking…" : "Check approval status"}</button> : countApproval.status === "approved" ? <button type="submit" className="button primary" disabled={submitting}>{submitting ? "Posting approved count…" : "Post approved count"}</button> : <button type="button" className="button primary" disabled={submitting} onClick={onClose}>Review count</button> : <button type="submit" className="button primary" disabled={submitting}>{submitting ? `${title.replace(/^(Post|Reopen|Close|Reverse|Return|Approve)/, "$1ing")}…` : finalCommandLabel(command.kind, quantity)}</button>}</div>
  </form></section></div>;
}

function CommandFields({ kind, po, so, purchaseLines, salesLines, selectedPoLineId, selectedSoLineId, setSelectedPoLineId, setSelectedSoLineId, quantity, secondaryQuantity, setQuantity, setSecondaryQuantity, reason, setReason, disposition, setDisposition, expectedDate, setExpectedDate, max, countBalances, countLocationId, setCountLocationId }: { kind: CommandKind; po?: PurchaseOrder; so?: SalesOrder; purchaseLines: PurchaseLine[]; salesLines: SalesLine[]; selectedPoLineId: string; selectedSoLineId: string; setSelectedPoLineId: (value: string) => void; setSelectedSoLineId: (value: string) => void; quantity: number; secondaryQuantity: number; setQuantity: (value: number) => void; setSecondaryQuantity: (value: number) => void; reason: string; setReason: (value: string) => void; disposition: string; setDisposition: (value: string) => void; expectedDate: string; setExpectedDate: (value: string) => void; max: number; countBalances: InventoryLocationBalance[]; countLocationId: string; setCountLocationId: (value: string) => void }) {
  const purchaseLineSelector = purchaseLines.length > 1 ? <label>Purchase order line<select value={selectedPoLineId} onChange={(event) => setSelectedPoLineId(event.target.value)}>{purchaseLines.map((line) => <option key={line.id} value={line.id}>{line.sku} · {line.product} · {line.open} open</option>)}</select></label> : null;
  const salesLineSelector = salesLines.length > 1 ? <label>Sales order line<select value={selectedSoLineId} onChange={(event) => setSelectedSoLineId(event.target.value)}>{salesLines.map((line) => <option key={line.id} value={line.id}>{line.sku} · {line.product} · {line.open} open</option>)}</select></label> : null;
  if (kind === "receive") return <div className="command-form">{purchaseLineSelector}<div className="line-context"><span>{po?.lines[0]?.product}</span><strong>{po?.open ?? 0} open to receive</strong><small>{po?.lines[0]?.specification}</small></div><div className="form-grid"><label>Arrived at dock<input type="number" min="1" max={max || undefined} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label><label>Accepted into quarantine<input type="number" min="0" max={quantity} value={secondaryQuantity} onChange={(e) => setSecondaryQuantity(Number(e.target.value))} /></label><label>Rejected at dock<input value="0" readOnly /></label><label>Destination<select><option>Main / Rack A / Bay 03</option><option>Main / Special Orders / Bay S-12</option></select></label></div><p className="formula-note">Available inventory = arrived − quarantine − rejected. The quantity distribution must balance.</p></div>;
  if (kind === "ship" || kind === "reserve") return <div className="command-form">{salesLineSelector}<div className="line-context"><span>{so?.lines?.[0]?.product ?? so?.customer} · {so?.project}</span><strong>{kind === "reserve" ? `${so?.availableNow ?? 0} available now` : `${so?.reserved ?? 0} reserved`}</strong><small>{so?.route}</small></div><label>{kind === "reserve" ? "Quantity to reserve" : "Quantity to ship"}<input type="number" min="1" max={max} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label><label>{kind === "reserve" ? "Reserve from location" : "Staging location"}<select><option>{kind === "reserve" ? "Main / Rack A / Bay 01" : "Main / Customer Staging / ST-02"}</option><option>{kind === "reserve" ? "Main / Rack B / Bay 07" : "Main / Pickup Staging / PU-01"}</option></select></label>{kind === "ship" && <label>Carrier or pickup reference<input placeholder="Optional reference" /></label>}</div>;
  if (kind === "vendor-return") return <div className="command-form">{purchaseLineSelector}<div className="line-context"><span>{po?.lines[0]?.product}</span><strong>{max} eligible to return</strong><small>Source: {po?.number}</small></div><label>Quantity to return<input type="number" min="1" max={max} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label><fieldset><legend>What should happen after the vendor receives these goods?</legend>{[["replacement", "Replace the returned quantity"], ["refund", "Issue a credit; no replacement"], ["repair", "Repair and return the same unit"], ["allowance", "No physical return; issue a price allowance"]].map(([value, label]) => <label className="radio-row" key={value}><input type="radio" name="disposition" value={value} checked={disposition === value} onChange={(e) => setDisposition(e.target.value)} /><span>{label}</span></label>)}</fieldset><label>Return reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Select reason</option><option>Damaged on arrival</option><option>Wrong specification</option><option>Warranty issue</option><option>Customer cancellation</option></select></label></div>;
  if (kind === "customer-return") return <div className="command-form">{salesLineSelector}<div className="line-context"><span>{so?.lines?.[0]?.product ?? so?.customer} · {so?.number}</span><strong>{max} eligible to return</strong><small>Physical and financial decisions are reviewed separately.</small></div><label>Quantity received back<input type="number" min="1" max={max} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label><label>Physical disposition<select value={disposition} onChange={(e) => setDisposition(e.target.value)}><option value="quarantine">Receive into quarantine</option><option value="available">Return to available stock</option><option value="damaged">Damaged / discounted stock</option><option value="scrap">Scrap after inspection</option></select></label><label>Customer resolution<select><option>Issue customer credit</option><option>Create replacement order</option><option>Repair</option><option>No credit</option></select></label><label>Return reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Select reason</option><option>Damage</option><option>Incorrect item</option><option>Customer changed mind</option><option>Warranty</option></select></label></div>;
  if (kind === "count") { const balance = countBalances.find((item) => item.locationId === countLocationId); return <div className="command-form"><div className="line-context"><span>Durable cycle-count balance</span><strong>{balance ? `${balance.warehouseName} / ${balance.locationCode}` : "No active location balance"}</strong><small>{balance ? `Book quantity ${balance.recordedQuantity} · ${balance.reservedQuantity} reserved · version ${balance.version}` : "Create or receive inventory at an active location before counting."}</small></div><label>Inventory location<select value={countLocationId} onChange={(event) => setCountLocationId(event.target.value)} required><option value="" disabled>Select location</option>{countBalances.map((item) => <option key={item.locationId} value={item.locationId}>{item.warehouseName} · {item.locationCode} · {item.locationName} ({item.recordedQuantity} book)</option>)}</select></label><label>Book quantity<input value={balance?.recordedQuantity ?? ""} readOnly /></label><label>Counted quantity<input type="number" min="0" step="0.0001" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required /></label><label>Variance reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Select reason</option><option>Found in adjacent bay</option><option>Unrecorded damage</option><option>Counting error confirmed</option></select></label></div>; }
  return <div className="command-form">{kind === "reverse" ? null : purchaseLineSelector}<div className="line-context"><span>{po?.lines[0]?.product}</span><strong>{max} eligible</strong><small>{kind === "reopen" ? `${po?.closed} closed without receipt` : kind === "reverse" ? `${po?.received} originally received` : `${po?.open} open to receive`}</small></div><label>{kind === "reopen" ? "Quantity to reopen" : kind === "reverse" ? "Quantity to reverse" : "Quantity to close"}<input type="number" min="1" max={max} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label>{kind === "reopen" && <label>New expected date<input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></label>}{kind === "reverse" && <fieldset><legend>Is the reversed quantity still expected?</legend><label className="radio-row"><input type="radio" name="disposition" value="reopen" checked={disposition === "reopen"} onChange={(e) => setDisposition(e.target.value)} /><span>Yes, reopen it to receive</span></label><label className="radio-row"><input type="radio" name="disposition" value="close" checked={disposition === "close"} onChange={(e) => setDisposition(e.target.value)} /><span>No, close it without receipt</span></label></fieldset>}<label>Reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Select reason</option><option>Vendor confirmed partial availability</option><option>Vendor cannot supply</option><option>Customer canceled</option><option>Quantity entered incorrectly</option><option>Other</option></select></label></div>;
}

function ImpactPreview({ lines }: { lines: Array<{ category: string; label: string; before?: string | number; after: string | number; tone?: Severity }> }) {
  const grouped = lines.reduce<Record<string, typeof lines>>((acc, line) => { (acc[line.category] ??= []).push(line); return acc; }, {});
  return <section className="impact-preview" aria-labelledby="impact-title"><div className="impact-heading"><span aria-hidden="true">⇄</span><div><h3 id="impact-title">Review business impact</h3><p>Calculated from the current document state.</p></div></div>{Object.entries(grouped).map(([category, categoryLines]) => <div className="impact-group" key={category}><h4>{category}</h4>{categoryLines.map((line) => <div className={`impact-line ${line.tone ?? "neutral"}`} key={line.label}><span>{line.label}</span><strong>{line.before !== undefined ? <><del>{line.before}</del><b aria-hidden="true">→</b></> : null}{line.after}</strong></div>)}</div>)}</section>;
}

function commandDefaults(kind: CommandKind, po?: PurchaseOrder, so?: SalesOrder, products?: Product[]) {
  if (kind === "receive") return { quantity: po?.open || 1, secondaryQuantity: 0, max: (po?.open || 999) + Math.max(1, Math.ceil((po?.ordered ?? 0) * .02)), disposition: "available" };
  if (kind === "close") return { quantity: po?.open || 1, secondaryQuantity: 0, max: po?.open || 0, disposition: "close" };
  if (kind === "reopen") return { quantity: Math.min(20, po?.closed || 1), secondaryQuantity: 0, max: po?.closed || 0, disposition: "reopen" };
  if (kind === "reverse") return { quantity: Math.min(10, po?.received || 1), secondaryQuantity: 0, max: (po?.received || 0) - (po?.returned || 0), disposition: "reopen" };
  if (kind === "vendor-return") return { quantity: 1, secondaryQuantity: 0, max: (po?.received || 0) - (po?.returned || 0), disposition: "replacement" };
  if (kind === "reserve") return { quantity: Math.max(1, Math.min(so?.availableNow || 0, (so?.open || 0) - (so?.reserved || 0))), secondaryQuantity: 0, max: Math.max(0, Math.min(so?.availableNow || 0, (so?.open || 0) - (so?.reserved || 0))), disposition: "reserve" };
  if (kind === "ship") return { quantity: Math.max(1, so?.reserved || 0), secondaryQuantity: 0, max: Math.max(0, so?.reserved || 0), disposition: "ship" };
  if (kind === "customer-return") return { quantity: 1, secondaryQuantity: 0, max: so?.shipped || so?.reserved || 1, disposition: "quarantine" };
  if (kind === "count") return { quantity: -1, secondaryQuantity: 0, max: products?.[0]?.onHand ?? 0, disposition: "adjust" };
  return { quantity: 1, secondaryQuantity: 0, max: products?.reduce((sum, product) => sum + product.onHand, 0) || 1, disposition: "adjust" };
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
    { category: "Commercial commitment", label: "Over-receipt policy", after: quantity > (po?.open ?? 0) ? `${quantity - (po?.open ?? 0)} excess · within 2% / 1-unit tolerance` : "No excess" , tone: quantity > (po?.open ?? 0) ? "warning" as Severity : "neutral" as Severity },
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
  return [{ category: "Physical inventory", label: "Counted quantity", before: recordedQuantity, after: quantity, tone: variance < 0 ? "danger" as Severity : variance > 0 ? "success" as Severity : "neutral" as Severity }, { category: "Physical inventory", label: "Posted variance", after: `${variance > 0 ? "+" : ""}${variance}` }, { category: "Financial effect", label: "Estimated value effect", after: money.format(variance * 800) }, { category: "Audit", label: "Linked adjustment movement", after: variance === 0 ? "Count record only; no movement" : "Will be created" }];
}

function applyLocalCommand(snapshot: Snapshot, kind: CommandKind, entityId: string, payload: Record<string, unknown>): Snapshot {
  const quantity = Number(payload.quantity ?? 0);
  const quarantine = Number(payload.quarantineQuantity ?? 0);
  const disposition = String(payload.disposition ?? "");
  const next = structuredClone(snapshot);
  const po = next.purchaseOrders.find((item) => item.id === entityId);
  const so = next.salesOrders.find((item) => item.id === entityId);
  if (po) {
    if (kind === "receive") { po.received += quantity; po.open = Math.max(po.open - quantity, 0); po.fulfillment = po.open ? "Partially received" : po.closed ? "Closed short" : "Fully received"; po.lines[0].received += quantity; po.lines[0].open = Math.max(po.lines[0].open - quantity, 0); const product = next.products.find((item) => item.sku === po.lines[0].sku); if (product) { product.onHand += quantity; product.usable += quantity - quarantine; product.available += quantity - quarantine; product.incoming = Math.max(product.incoming - quantity, 0); product.projected += quantity; } }
    if (kind === "close") { po.open -= quantity; po.closed += quantity; po.lines[0].open -= quantity; po.lines[0].closed += quantity; po.fulfillment = po.open ? "Partially received" : "Closed short"; }
    if (kind === "reopen") { po.open += quantity; po.closed -= quantity; po.revision += 1; po.version += 1; po.lines[0].open += quantity; po.lines[0].closed -= quantity; po.fulfillment = "Partially received"; const product = next.products.find((item) => item.sku === po.lines[0].sku); if (product) { product.incoming += quantity; product.projected += quantity; } }
    if (kind === "reverse") { po.received -= quantity; po.lines[0].received -= quantity; if (disposition === "reopen") { po.open += quantity; po.lines[0].open += quantity; } else { po.closed += quantity; po.lines[0].closed += quantity; } const product = next.products.find((item) => item.sku === po.lines[0].sku); if (product) { product.onHand -= quantity; product.usable -= quantity; product.available -= quantity; product.projected -= quantity; } }
    if (kind === "vendor-return" && disposition !== "allowance") { po.returned += quantity; po.lines[0].returned += quantity; if (disposition === "replacement") { po.open += quantity; po.lines[0].open += quantity; } else { po.closed += quantity; po.lines[0].closed += quantity; } const product = next.products.find((item) => item.sku === po.lines[0].sku); if (product) { product.onHand -= quantity; product.usable -= quantity; product.available = Math.max(product.available - quantity, 0); product.projected -= disposition === "replacement" ? 0 : quantity; if (disposition === "replacement") product.incoming += quantity; } }
    po.version += 1;
  }
  if (so && kind === "ship") { so.shipped += quantity; so.reserved -= quantity; so.open = Math.max(so.open - quantity, 0); so.fulfillment = so.open ? "Partially shipped" : "Fully shipped"; so.version += 1; }
  if (so && kind === "reserve") { so.reserved += quantity; so.availableNow = Math.max(so.availableNow - quantity, 0); so.fulfillment = "Reserved"; so.version += 1; }
  next.activities.unshift({ id: crypto.randomUUID(), time: "Just now", title: `${commandTitle(kind)} completed`, detail: `${quantity} unit${quantity === 1 ? "" : "s"} processed for ${po?.number ?? so?.number ?? "COUNT-0043"}.`, tone: "success" });
  return next;
}
void applyLocalCommand;

function normalizeSnapshot(input: unknown): Snapshot {
  if (!input || typeof input !== "object") return emptySnapshot;
  const raw = input as Record<string, unknown>;
  const summary = asRecord(raw.summary);
  const rawProducts = asRows(raw.products);
  const rawPurchaseOrders = asRows(raw.purchaseOrders);
  const rawSalesOrders = asRows(raw.salesOrders);

  const products: Product[] = rawProducts.map((item, index) => {
    const demand = rawSalesOrders.reduce((sum, order) => {
      const matching = asRows(order.lines).filter((line) => text(line.productId) === text(item.id));
      return sum + matching.reduce((lineSum, line) => lineSum + number(line.orderedQuantity) - number(line.shippedQuantity), 0);
    }, 0);
    const usable = number(item.usable);
    const incoming = number(item.incoming);
    const available = number(item.available);
    return {
      id: text(item.id, `product-${index}`),
      sku: text(item.sku, `SKU-${index + 1}`),
      name: text(item.name, "Unnamed product"),
      specification: [text(item.dimensions), text(item.finish), text(item.material)].filter(Boolean).join(" · ") || "No configuration recorded",
      policy: titleCase(text(item.trackingPolicy || item.inventoryPolicy, "stock")),
      location: "Multiple locations",
      locationCode: "—",
      onHand: number(item.onHand),
      usable,
      reserved: number(item.reserved),
      available,
      incoming,
      demand,
      projected: usable + incoming - demand,
      reorderPoint: number(item.reorderPoint),
      customerRef: undefined,
      version: number(item.version, 1),
    };
  });

  const purchaseOrders: PurchaseOrder[] = rawPurchaseOrders.map((item, index) => {
    const lines = asRows(item.lines).map((line, lineIndex): PurchaseLine => ({
      id: text(line.id, `${text(item.id)}-line-${lineIndex}`),
      productId: text(line.productId) || undefined,
      sku: text(line.sku),
      product: text(line.productName, "Unnamed product"),
      specification: configurationText(line.configurationSnapshot) || products.find((product) => product.id === text(line.productId))?.specification || "No configuration recorded",
      customerRef: text(line.sourceSalesOrderLineId) || undefined,
      ordered: number(line.orderedQuantity),
      received: number(line.netReceivedQuantity),
      returned: 0,
      closed: number(line.closedWithoutReceiptQuantity),
      open: number(line.openToReceiveQuantity),
      unitCost: number(line.unitCostCents) / 100,
      location: text(line.fulfillmentRoute, "stock") === "drop_ship" ? "Drop ship · no internal stock" : "Destination selected at receipt",
      fulfillmentRoute: text(line.fulfillmentRoute, "stock"),
    }));
    const expectedDate = text(item.expectedDate, futureDate(7));
    const open = number(item.openToReceiveQuantity);
    const closed = number(item.closedWithoutReceiptQuantity);
    const late = expectedDate < new Date().toISOString().slice(0, 10) && open > 0 ? calendarDaysLate(expectedDate) : 0;
    return {
      id: text(item.id, `po-${index}`),
      number: text(item.number, `PO-${1000 + index}`),
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
      const canceled = number(line.canceledQuantity);
      const shipped = number(line.shippedQuantity);
      return {
        id: text(line.id, `${text(item.id)}-line-${lineIndex}`),
        productId: text(line.productId),
        sku: text(line.sku),
        product: text(line.productName, "Unnamed product"),
        ordered,
        canceled,
        reserved: number(line.reservedQuantity),
        shipped,
        open: Math.max(ordered - canceled - shipped, 0),
        unitPrice: number(line.unitPriceCents) / 100,
        fulfillmentRoute: text(line.fulfillmentRoute, "stock"),
        linkedPurchaseOrderLineId: text(line.linkedPurchaseOrderLineId) || undefined,
      };
    });
    const firstLine = rawLines[0];
    const product = products.find((candidate) => candidate.id === text(firstLine?.productId));
    const open = number(item.openToShipQuantity);
    const availableNow = Math.min(open, product?.available ?? 0);
    const incomingBeforeDate = Math.min(Math.max(open - availableNow, 0), product?.incoming ?? 0);
    const shortage = Math.max(open - availableNow - incomingBeforeDate, 0);
    return {
      id: text(item.id, `so-${index}`),
      number: text(item.number, `SO-${2000 + index}`),
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
    const billed = number(item.totalCents) / 100;
    const variance = isException ? 350 : 0;
    return {
      id: text(item.id, `bill-${index}`),
      number: text(item.number, `VB-${8300 + index}`),
      vendor: text(item.vendorName, "Vendor"),
      po: text(item.purchaseOrderNumber, "Unlinked"),
      receivedValue: Math.max(billed - variance, 0),
      billedValue: billed,
      variance,
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
      name: text(item.name, "Business partner"),
      type: kind.includes("vendor") ? "vendor" : "customer",
      email: text(item.email) || undefined,
      phone: text(item.phone) || undefined,
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

  return {
    summary: {
      lateReceipts: number(summary.latePurchaseOrders, purchaseOrders.filter((po) => po.daysLate > 0).length),
      approvals: purchaseOrders.filter((po) => po.lifecycle.toLowerCase().includes("pending")).length,
      blockedSales: salesOrders.filter((so) => so.shortage > 0).length,
      dueReceipts: number(summary.openPurchaseOrders, purchaseOrders.filter((po) => po.open > 0).length),
      readyToShip: number(summary.readyToShip, salesOrders.filter((so) => so.reserved > 0).length),
      pickups: salesOrders.filter((so) => so.route.toLowerCase().includes("pickup")).length,
    },
    purchaseOrders,
    products,
    inventoryBalances,
    salesOrders,
    movements,
    bills,
    activities,
    partners,
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

function NotificationItem({ tone, title, detail }: { tone: Severity; title: string; detail: string }) {
  return <button className="notification-item"><span className={`timeline-dot ${tone}`} /><div><strong>{title}</strong><p>{detail}</p></div><b aria-hidden="true">→</b></button>;
}

function LoadingState() {
  return <div className="loading-state" role="status"><div className="loading-bar" /><div className="loading-grid"><div /><div /><div /><div /></div><span className="sr-only">Loading operations workspace</span></div>;
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : compactDate.format(date);
}
