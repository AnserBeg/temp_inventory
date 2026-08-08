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

type Severity = "neutral" | "info" | "success" | "warning" | "danger";

type PurchaseLine = {
  id: string;
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
  open: number;
  availableNow: number;
  incomingBeforeDate: number;
  shortage: number;
  total: number;
  route: string;
  linkedPo?: string;
  exception?: string;
  version: number;
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
  salesOrders: SalesOrder[];
  movements: Movement[];
  bills: Bill[];
  activities: Activity[];
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
  | "ship"
  | "customer-return"
  | "count";

type ActiveCommand = {
  kind: CommandKind;
  entityId: string;
  entityNumber: string;
};

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

const fallbackSnapshot: Snapshot = {
  summary: {
    lateReceipts: 3,
    approvals: 2,
    blockedSales: 2,
    dueReceipts: 7,
    readyToShip: 5,
    pickups: 3,
  },
  purchaseOrders: [
    {
      id: "po-1024",
      number: "PO-1024",
      vendor: "Andersen Windows",
      lifecycle: "Approved",
      fulfillment: "Closed short",
      billing: "Partially billed",
      expectedDate: futureDate(-4),
      daysLate: 4,
      ordered: 100,
      received: 60,
      returned: 0,
      closed: 40,
      open: 0,
      billed: 40,
      total: 48250,
      buyer: "Maya Chen",
      revision: 3,
      version: 3,
      customerRef: "SO-2041 · Westside Homes",
      exception: "40 units closed without receipt; linked customer demand remains open",
      lines: [
        {
          id: "pol-1024-1",
          sku: "AND-100-CS-3648-L-WH",
          product: "Andersen 100 Series Casement",
          specification: "36 × 48 in · Left handing · White · Low-E dual pane",
          customerRef: "SO-2041 · Aspen Lot 14",
          ordered: 100,
          received: 60,
          returned: 0,
          closed: 40,
          open: 0,
          unitCost: 482.5,
          location: "Main / Rack A / Bay 03",
        },
      ],
    },
    {
      id: "po-1031",
      number: "PO-1031",
      vendor: "JELD-WEN Canada",
      lifecycle: "Approved",
      fulfillment: "Partially received",
      billing: "Not billed",
      expectedDate: futureDate(0),
      daysLate: 0,
      ordered: 48,
      received: 24,
      returned: 0,
      closed: 0,
      open: 24,
      billed: 0,
      total: 31920,
      buyer: "Maya Chen",
      revision: 1,
      version: 1,
      lines: [
        {
          id: "pol-1031-1",
          sku: "JW-BRICK-4860-R-BK",
          product: "JELD-WEN Brickmould Awning",
          specification: "48 × 60 in · Right handing · Black exterior",
          ordered: 48,
          received: 24,
          returned: 0,
          closed: 0,
          open: 24,
          unitCost: 665,
          location: "Main / Receiving Dock",
        },
      ],
    },
    {
      id: "po-1040",
      number: "PO-1040",
      vendor: "Ply Gem Canada",
      lifecycle: "Pending approval",
      fulfillment: "Not received",
      billing: "Not billed",
      expectedDate: futureDate(8),
      daysLate: 0,
      ordered: 16,
      received: 0,
      returned: 0,
      closed: 0,
      open: 16,
      billed: 0,
      total: 21840,
      buyer: "Avery Singh",
      revision: 1,
      version: 1,
      customerRef: "SO-2050 · Prairie Build Group",
      exception: "Approval required: custom order exceeds $20,000",
      lines: [
        {
          id: "pol-1040-1",
          sku: "CUSTOM-PG-400",
          product: "Custom Ply Gem 400 Casement",
          specification: "41 3/8 × 59 7/8 in · Left · Bronze / White · Triple pane",
          customerRef: "SO-2050 · Kitchen W-03",
          ordered: 16,
          received: 0,
          returned: 0,
          closed: 0,
          open: 16,
          unitCost: 1365,
          location: "Main / Special Orders / Bay S-12",
        },
      ],
    },
  ],
  products: [
    {
      id: "prod-and-3648",
      sku: "AND-100-CS-3648-L-WH",
      name: "Andersen 100 Series Casement",
      specification: "36 × 48 in · Left · White · Low-E dual pane",
      policy: "Stocked",
      location: "Main Warehouse / Rack A / Bay 03",
      locationCode: "A-03",
      onHand: 60,
      usable: 58,
      reserved: 8,
      available: 50,
      incoming: 0,
      demand: 13,
      projected: 37,
      reorderPoint: 20,
    },
    {
      id: "prod-jw-4860",
      sku: "JW-BRICK-4860-R-BK",
      name: "JELD-WEN Brickmould Awning",
      specification: "48 × 60 in · Right · Black exterior",
      policy: "Stocked",
      location: "Main Warehouse / Rack B / Bay 08",
      locationCode: "B-08",
      onHand: 24,
      usable: 24,
      reserved: 18,
      available: 6,
      incoming: 24,
      demand: 27,
      projected: 21,
      reorderPoint: 12,
    },
    {
      id: "prod-custom-48392",
      sku: "WIN-00048392",
      name: "Custom Andersen 400 Casement",
      specification: "41 3/8 × 59 7/8 in · Left · Black / White · Kitchen W-03",
      policy: "Individual unit",
      location: "Main Warehouse / Special Orders / Bay S-12",
      locationCode: "S-12",
      onHand: 1,
      usable: 1,
      reserved: 1,
      available: 0,
      incoming: 0,
      demand: 1,
      projected: 0,
      reorderPoint: 0,
      customerRef: "Westside Homes · Aspen Lot 14 · SO-2041",
    },
    {
      id: "prod-pg-slider",
      sku: "PG-SL-6048-WH",
      name: "Ply Gem 400 Series Slider",
      specification: "60 × 48 in · XO · White · Dual pane",
      policy: "Stocked",
      location: "Main Warehouse / Rack C / Bay 02",
      locationCode: "C-02",
      onHand: 7,
      usable: 5,
      reserved: 4,
      available: 1,
      incoming: 0,
      demand: 8,
      projected: -3,
      reorderPoint: 10,
    },
  ],
  salesOrders: [
    {
      id: "so-2041",
      number: "SO-2041",
      customer: "Westside Homes",
      project: "Aspen Lot 14",
      requestedDate: futureDate(6),
      lifecycle: "Confirmed",
      fulfillment: "Partially allocated",
      billing: "Not invoiced",
      ordered: 10,
      reserved: 6,
      shipped: 0,
      open: 10,
      availableNow: 6,
      incomingBeforeDate: 3,
      shortage: 1,
      total: 63800,
      route: "Mixed stock + special order",
      linkedPo: "PO-1024",
      exception: "1 unit short for requested date",
      version: 2,
    },
    {
      id: "so-2046",
      number: "SO-2046",
      customer: "North Ridge Renovations",
      project: "Bowness Residence",
      requestedDate: futureDate(0),
      lifecycle: "Confirmed",
      fulfillment: "Ready to ship",
      billing: "Not invoiced",
      ordered: 5,
      reserved: 5,
      shipped: 0,
      open: 5,
      availableNow: 5,
      incomingBeforeDate: 0,
      shortage: 0,
      total: 12450,
      route: "Customer pickup",
      version: 1,
    },
    {
      id: "so-2050",
      number: "SO-2050",
      customer: "Prairie Build Group",
      project: "Meadowview Phase 2",
      requestedDate: futureDate(14),
      lifecycle: "Confirmed",
      fulfillment: "Awaiting purchased items",
      billing: "Deposit received",
      ordered: 16,
      reserved: 0,
      shipped: 0,
      open: 16,
      availableNow: 0,
      incomingBeforeDate: 16,
      shortage: 0,
      total: 36400,
      route: "Special order",
      linkedPo: "PO-1040",
      exception: "Linked PO is awaiting approval",
      version: 1,
    },
  ],
  movements: [
    {
      id: "mov-801",
      time: "Today, 10:42 AM",
      type: "Purchase receipt",
      document: "RCPT-0098",
      product: "AND-100-CS-3648-L-WH",
      quantity: 60,
      from: "Supplier",
      to: "Main / Rack A / Bay 03",
      user: "Jordan Lee",
    },
    {
      id: "mov-802",
      time: "Today, 10:42 AM",
      type: "Status transfer",
      document: "RCPT-0098",
      product: "AND-100-CS-3648-L-WH",
      quantity: 2,
      from: "Receiving",
      to: "Main / Quarantine",
      user: "Jordan Lee",
    },
    {
      id: "mov-799",
      time: "Yesterday, 3:18 PM",
      type: "Sales shipment",
      document: "SHP-0338",
      product: "PG-SL-6048-WH",
      quantity: -4,
      from: "Main / Customer Staging",
      to: "Customer",
      user: "Riley Morgan",
    },
    {
      id: "mov-794",
      time: "Aug 6, 4:04 PM",
      type: "Inventory adjustment loss",
      document: "COUNT-0042",
      product: "JW-BRICK-4860-R-BK",
      quantity: -1,
      from: "Main / Rack B / Bay 08",
      to: "Adjustment",
      user: "Devon Clark",
    },
  ],
  bills: [
    {
      id: "bill-8392",
      number: "VB-8392",
      vendor: "Andersen Windows",
      po: "PO-1024",
      receivedValue: 48250,
      billedValue: 48600,
      variance: 350,
      status: "Match exception",
      reason: "$100 unit-price variance and $250 freight not on PO",
    },
    {
      id: "bill-8401",
      number: "VB-8401",
      vendor: "JELD-WEN Canada",
      po: "PO-1031",
      receivedValue: 15960,
      billedValue: 15960,
      variance: 0,
      status: "Matched",
    },
  ],
  activities: [
    {
      id: "act-1",
      time: "10:42 AM",
      title: "Jordan Lee posted receipt RCPT-0098",
      detail: "58 units entered available stock and 2 entered quarantine.",
      tone: "success",
    },
    {
      id: "act-2",
      time: "9:18 AM",
      title: "PO-1040 entered the approval queue",
      detail: "Custom order total exceeds the $20,000 purchasing threshold.",
      tone: "warning",
    },
    {
      id: "act-3",
      time: "Yesterday",
      title: "Shipment SHP-0338 posted",
      detail: "Four reservations were released; invoice quantity is now available.",
      tone: "info",
    },
  ],
};

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
  "sales-orders": { title: "Sales orders", description: "Demand, allocation, fulfillment, and billing state." },
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
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [view, setView] = useState<ViewKey>(() => {
    if (typeof window === "undefined") return "home";
    const requested = new URLSearchParams(window.location.search).get("view") as ViewKey | null;
    return requested && viewTitles[requested] ? requested : "home";
  });
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [selectedSoId, setSelectedSoId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [activeCommand, setActiveCommand] = useState<ActiveCommand | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"server" | "demo">("demo");
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
      if (!normalized.purchaseOrders.length || !normalized.products.length) throw new Error("Incomplete snapshot");
      setSnapshot(normalized);
      setSource("server");
    } catch {
      setSource("demo");
    } finally {
      setLoading(false);
    }
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
      ship: "shipSale",
      "customer-return": "customerReturn",
      count: "inventoryAdjustment",
    };
    const apiEntityId = kind === "reverse" ? po?.latestReceiptId ?? entityId : entityId;
    const apiVersion = kind === "reverse"
      ? po?.latestReceiptVersion ?? 1
      : po?.version ?? so?.version ?? product?.version ?? 1;
    const apiPayload: Record<string, unknown> = {
      ...payload,
      damagedQuantity: payload.quarantineQuantity,
      replacementExpected: payload.disposition === "replacement",
      condition: payload.disposition === "available" ? "usable" : "quarantine",
    };
    if (kind === "count" && product) {
      apiPayload.locationId = "loc-a01";
      apiPayload.countedQuantity = Math.max(0, product.onHand + Number(payload.quantity ?? 0));
    }
    try {
      const response = await fetch("/api/commands", {
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
      const result = (await response.json()) as { snapshot?: unknown; message?: string; error?: string | { message?: string } };
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message || "The command could not be completed.");
      if (result.snapshot) setSnapshot(normalizeSnapshot(result.snapshot));
      else await loadSnapshot();
      setSource("server");
      setToast(result.message || `${entityNumber} was updated.`);
    } catch (error) {
      setSnapshot((current) => applyLocalCommand(current, kind, entityId, payload));
      setSource("demo");
      setToast(`${entityNumber} updated in this preview session. ${error instanceof Error ? error.message : ""}`.trim());
    } finally {
      setActiveCommand(null);
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
          <div className="user-avatar" aria-hidden="true">SC</div>
          <div><strong>Sam Carter</strong><small>Operations manager</small></div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen((open) => !open)}>☰</button>
          <button className="global-search" onClick={() => { setSearchOpen(true); requestAnimationFrame(() => searchRef.current?.focus()); }}>
            <span aria-hidden="true">⌕</span><span>Search orders, products, customers…</span><kbd>Ctrl K</kbd>
          </button>
          <div className="topbar-actions">
            <button className="warehouse-selector"><span className="online-dot" />Main Warehouse <span aria-hidden="true">⌄</span></button>
            <button className="icon-button notification-button" aria-label="Open notifications" onClick={() => setNotificationsOpen((open) => !open)}>
              ♧<span className="notification-count">4</span>
            </button>
            <button className="avatar-button" aria-label="Open user menu">SC</button>
          </div>
        </header>

        {notificationsOpen && (
          <section className="popover notification-panel" aria-label="Tasks and notifications">
            <div className="popover-header"><div><strong>Tasks requiring action</strong><small>4 open</small></div><button className="icon-button" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}>×</button></div>
            <NotificationItem tone="danger" title="PO-1024 is 4 days late" detail="Customer-linked quantity remains unreceived." />
            <NotificationItem tone="warning" title="PO-1040 needs approval" detail="Custom order exceeds the purchasing threshold." />
            <NotificationItem tone="warning" title="Vendor bill VB-8392 has a $350 variance" detail="Price and freight require review." />
            <NotificationItem tone="info" title="SO-2046 is ready for pickup" detail="All five units are staged and reserved." />
          </section>
        )}

        <main id="main-content" tabIndex={-1} className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow-row"><span className={`connection ${source}`}>{source === "server" ? "Live data" : "Preview data"}</span><span>Updated just now</span></div>
              <h1>{viewTitles[view].title}</h1>
              <p>{viewTitles[view].description}</p>
            </div>
            <PageActions view={view} onNavigate={navigate} />
          </div>

          {loading ? <LoadingState /> : (
            <>
              {view === "home" && <Dashboard snapshot={snapshot} navigate={navigate} openPo={setSelectedPoId} />}
              {(view === "purchase-orders" || view === "expected-receipts") && (
                selectedPo ? (
                  <PurchaseOrderDetail po={selectedPo} onBack={() => setSelectedPoId(null)} onCommand={(kind) => setActiveCommand({ kind, entityId: selectedPo.id, entityNumber: selectedPo.number })} />
                ) : (
                  <PurchaseOrdersView orders={snapshot.purchaseOrders} mode={view} onOpen={setSelectedPoId} onReceive={(po) => setActiveCommand({ kind: "receive", entityId: po.id, entityNumber: po.number })} />
                )
              )}
              {view === "vendor-returns" && <VendorReturnsView orders={snapshot.purchaseOrders} onReturn={(po) => setActiveCommand({ kind: "vendor-return", entityId: po.id, entityNumber: po.number })} />}
              {(view === "sales-orders" || view === "fulfillment") && (
                selectedSo ? (
                  <SalesOrderDetail so={selectedSo} onBack={() => setSelectedSoId(null)} onShip={() => setActiveCommand({ kind: "ship", entityId: selectedSo.id, entityNumber: selectedSo.number })} />
                ) : (
                  <SalesOrdersView orders={snapshot.salesOrders} mode={view} onOpen={setSelectedSoId} onShip={(so) => setActiveCommand({ kind: "ship", entityId: so.id, entityNumber: so.number })} />
                )
              )}
              {view === "customer-returns" && <CustomerReturnsView orders={snapshot.salesOrders} onReturn={(so) => setActiveCommand({ kind: "customer-return", entityId: so.id, entityNumber: so.number })} />}
              {(view === "stock" || view === "products") && (
                selectedProduct ? <ProductDetail product={selectedProduct} movements={snapshot.movements} onBack={() => setSelectedProductId(null)} /> : <InventoryView products={snapshot.products} onOpen={setSelectedProductId} />
              )}
              {view === "movements" && <MovementsView movements={snapshot.movements} />}
              {view === "counts" && <CountsView products={snapshot.products} onCount={() => setActiveCommand({ kind: "count", entityId: snapshot.products[0]?.id ?? "count-main", entityNumber: "COUNT-DRAFT" })} />}
              {view === "vendor-bills" && <VendorBillsView bills={snapshot.bills} />}
              {view === "customer-invoices" && <InvoicesView salesOrders={snapshot.salesOrders} />}
              {view === "partners" && <PartnersView />}
              {view === "reports" && <ReportsView snapshot={snapshot} />}
              {view === "warehouse" && <WarehouseView orders={snapshot.purchaseOrders} onReceive={(po) => setActiveCommand({ kind: "receive", entityId: po.id, entityNumber: po.number })} />}
            </>
          )}
        </main>
      </div>

      {searchOpen && (
        <div className="command-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
          <section className="command-palette" role="dialog" aria-modal="true" aria-label="Global search">
            <div className="command-input-row"><span aria-hidden="true">⌕</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by document, SKU, barcode, customer, or dimensions" aria-label="Global search" /><kbd>Esc</kbd></div>
            <div className="search-results">
              {!query && <div className="search-hint"><strong>Find anything operational</strong><span>Try “PO-1024”, “36x48”, “Westside”, or an inventory-unit ID.</span></div>}
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
          onClose={() => setActiveCommand(null)}
          onSubmit={(payload) => runCommand(activeCommand.kind, activeCommand.entityId, activeCommand.entityNumber, payload)}
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

function PageActions({ view, onNavigate }: { view: ViewKey; onNavigate: (view: ViewKey) => void }) {
  if (view === "home") return <button className="button secondary" onClick={() => onNavigate("reports")}>View reports</button>;
  if (view === "purchase-orders") return <button className="button primary">Create purchase order</button>;
  if (view === "sales-orders") return <button className="button primary">Create sales order</button>;
  if (view === "stock") return <button className="button secondary" onClick={() => onNavigate("counts")}>Start inventory count</button>;
  if (view === "warehouse") return <span className="connection server"><span /> Online</span>;
  return null;
}

function Dashboard({ snapshot, navigate, openPo }: { snapshot: Snapshot; navigate: (view: ViewKey) => void; openPo: (id: string) => void }) {
  const due = snapshot.purchaseOrders.filter((po) => po.open > 0 || po.daysLate > 0).slice(0, 4);
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
        <MetricCard label="Receipts due" value={snapshot.summary.dueReceipts} detail="3 need customer allocation" tone="info" onClick={() => navigate("expected-receipts")} />
        <MetricCard label="Ready to ship" value={snapshot.summary.readyToShip} detail="18 total units reserved" tone="success" onClick={() => navigate("fulfillment")} />
        <MetricCard label="Customer pickups" value={snapshot.summary.pickups} detail="Next pickup at 1:30 PM" tone="neutral" onClick={() => navigate("fulfillment")} />
        <MetricCard label="Inventory risks" value={2} detail="1 below minimum · 1 on hold" tone="warning" onClick={() => navigate("stock")} />
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
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="panel activity-panel">
        <PanelHeading title="Recent activity" detail="Physical and commercial events" />
        <div className="timeline">{snapshot.activities.map((activity) => (
          <div className="timeline-item" key={activity.id}><span className={`timeline-dot ${activity.tone}`} /><div><strong>{activity.title}</strong><p>{activity.detail}</p><small>{activity.time}</small></div></div>
        ))}</div>
      </section>

      <section className="panel wide-panel">
        <PanelHeading title="Special-order watch" detail="Customer-specific windows and linked supply" action="View inventory" onAction={() => navigate("stock")} />
        <div className="special-order-strip">
          <div className="window-thumb" aria-hidden="true"><span /><span /><span /><span /></div>
          <div><span className="section-kicker">Individual unit · WIN-00048392</span><h3>Custom Andersen 400 Casement</h3><p>41 3/8 × 59 7/8 in · Kitchen opening W-03</p></div>
          <div><small>Allocated customer</small><strong>Westside Homes</strong><span>Aspen Lot 14 · SO-2041</span></div>
          <div><small>Current location</small><strong>Special Orders / S-12</strong><span>Available and reserved</span></div>
          <button className="button secondary" onClick={() => navigate("stock")}>View exact unit</button>
        </div>
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
  return <div className="filter-bar"><label className="list-search"><span aria-hidden="true">⌕</span><input placeholder={placeholder} aria-label={placeholder} /></label>{children}<button className="filter-button">Columns</button><button className="filter-button">Export</button></div>;
}

function PurchaseOrdersView({ orders, mode, onOpen, onReceive }: { orders: PurchaseOrder[]; mode: "purchase-orders" | "expected-receipts"; onOpen: (id: string) => void; onReceive: (po: PurchaseOrder) => void }) {
  const [filter, setFilter] = useState(mode === "expected-receipts" ? "Due and late" : "All open");
  const visible = mode === "expected-receipts" ? orders.filter((po) => po.open > 0 || po.daysLate > 0) : orders;
  return <section className="panel worklist">
    <div className="saved-view-row"><div className="view-tabs">{[mode === "expected-receipts" ? "Due and late" : "All open", "Partially received", "Closed short", "Awaiting approval"].map((label) => <button key={label} className={filter === label ? "active" : ""} onClick={() => setFilter(label)}>{label}{label === "Closed short" && <span>1</span>}</button>)}</div><button className="text-button">Save view</button></div>
    <FilterBar placeholder={mode === "expected-receipts" ? "Search PO, vendor, or customer" : "Search purchase orders"}><button className="filter-button">Main Warehouse</button><button className="filter-button">Status</button><button className="filter-button">Expected date</button></FilterBar>
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
    <section className="object-header panel"><div className="object-title"><div><span className="section-kicker">Purchase order · Revision {po.revision}</span><h2>{po.number}</h2><p>{po.vendor} · Main Warehouse</p></div><div className="object-total"><span>Total</span><strong>{money.format(po.total)}</strong></div></div>
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
    <div className="detail-columns"><section className="panel"><PanelHeading title="Related documents" detail="Commercial, physical, and financial lineage" /><div className="document-chain"><DocumentNode type="Purchase order" number={po.number} status={po.lifecycle} /><span className="chain-line" /><DocumentNode type="Receipt" number="RCPT-0098" status="Posted" /><span className="chain-branch">├</span><DocumentNode type="Vendor bill" number="VB-8392" status="Match exception" /><span className="chain-branch">└</span><DocumentNode type="Linked demand" number={po.customerRef?.split(" · ")[0] ?? "Stock"} status="Confirmed" /></div></section>
      <section className="panel"><PanelHeading title="Activity and audit" /><div className="timeline"><div className="timeline-item"><span className="timeline-dot info" /><div><strong>PO revision {po.revision} approved</strong><p>Commercial commitment updated. Physical inventory did not change.</p><small>Aug 4 · Maya Chen</small></div></div><div className="timeline-item"><span className="timeline-dot success" /><div><strong>Receipt RCPT-0098 posted</strong><p>{po.received} units entered internal inventory.</p><small>Today · Jordan Lee</small></div></div></div></section></div>
  </div>;
}

function MetricDisplay({ label, value, tone = "neutral" }: { label: string; value: number | string; tone?: Severity }) {
  return <div className={`metric-display ${tone}`}><span>{label}</span><strong>{value}</strong><button>View sources</button></div>;
}

function DocumentNode({ type, number, status }: { type: string; number: string; status: string }) {
  return <button className="document-node"><span>{type}</span><strong>{number}</strong><StatusBadge>{status}</StatusBadge></button>;
}

function VendorReturnsView({ orders, onReturn }: { orders: PurchaseOrder[]; onReturn: (po: PurchaseOrder) => void }) {
  const eligible = orders.filter((po) => po.received - po.returned > 0);
  return <section className="panel worklist"><div className="info-banner"><span aria-hidden="true">i</span><p><strong>Returns are physical movements.</strong> For a price-only allowance where goods stay in stock, use a vendor credit instead.</p></div><FilterBar placeholder="Search receipt, PO, vendor, or unit ID"><button className="filter-button">Eligible stock</button><button className="filter-button">Quarantine</button></FilterBar><div className="record-cards">{eligible.map((po) => <article className="record-card" key={po.id}><div><span className="section-kicker">{po.number}</span><h3>{po.vendor}</h3><p>{po.lines[0]?.product}</p></div><div className="card-metrics"><span><small>Eligible to return</small><strong>{po.received - po.returned}</strong></span><span><small>Source receipt</small><strong>RCPT-0098</strong></span></div><button className="button secondary" onClick={() => onReturn(po)}>Start vendor return</button></article>)}</div></section>;
}

function SalesOrdersView({ orders, mode, onOpen, onShip }: { orders: SalesOrder[]; mode: "sales-orders" | "fulfillment"; onOpen: (id: string) => void; onShip: (so: SalesOrder) => void }) {
  const visible = mode === "fulfillment" ? orders.filter((so) => so.reserved > so.shipped) : orders;
  return <section className="panel worklist"><div className="saved-view-row"><div className="view-tabs"><button className="active">{mode === "fulfillment" ? "Ready and partially ready" : "Open orders"}</button><button>Shortages</button><button>Special orders received</button><button>Customer pickup</button></div><button className="text-button">Save view</button></div><FilterBar placeholder="Search SO, customer, project, or customer PO"><button className="filter-button">Requested date</button><button className="filter-button">Route</button></FilterBar><div className="responsive-table"><table><caption className="sr-only">Sales orders</caption><thead><tr><th>Exception</th><th>SO</th><th>Customer / project</th><th>Requested</th><th>Availability</th><th>Fulfillment</th><th>Invoice</th><th className="numeric">Total</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{visible.map((so) => <tr key={so.id}><td>{so.exception ? <span className={`exception-cell ${so.shortage > 0 ? "danger" : "warning"}`}>!</span> : "—"}</td><td><button className="table-link" onClick={() => onOpen(so.id)}>{so.number}</button><small>{so.route}</small></td><td><strong>{so.customer}</strong><small>{so.project}</small></td><td>{formatDate(so.requestedDate)}</td><td><div className="availability-mini"><strong>{so.availableNow} now</strong><span>{so.incomingBeforeDate} incoming</span>{so.shortage > 0 && <b>{so.shortage} short</b>}</div></td><td><StatusBadge>{so.fulfillment}</StatusBadge></td><td><StatusBadge>{so.billing}</StatusBadge></td><td className="numeric strong">{money.format(so.total)}</td><td>{so.reserved > so.shipped ? <button className="row-action" onClick={() => onShip(so)}>Post shipment</button> : <button className="row-action" onClick={() => onOpen(so.id)}>Open</button>}</td></tr>)}</tbody></table></div></section>;
}

function SalesOrderDetail({ so, onBack, onShip }: { so: SalesOrder; onBack: () => void; onShip: () => void }) {
  return <div className="object-page"><button className="back-button" onClick={onBack}>← Back to sales orders</button><section className="object-header panel"><div className="object-title"><div><span className="section-kicker">Sales order · {so.route}</span><h2>{so.number}</h2><p>{so.customer} · {so.project}</p></div><div className="object-total"><span>Total</span><strong>{money.format(so.total)}</strong></div></div><div className="status-summary"><div><small>Commercial</small><StatusBadge>{so.lifecycle}</StatusBadge></div><div><small>Physical</small><StatusBadge>{so.fulfillment}</StatusBadge></div><div><small>Financial</small><StatusBadge>{so.billing}</StatusBadge></div></div>{so.exception && <div className="exception-banner"><span>!</span><div><strong>Fulfillment exception</strong><p>{so.exception}</p></div></div>}<div className="object-actions"><button className="button primary" onClick={onShip} disabled={so.reserved <= so.shipped}>Post shipment</button><button className="button secondary">Reserve available stock</button><button className="button ghost">Resolve shortage</button></div></section>
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
  return <div className="stack"><section className="metric-row object-metrics"><MetricDisplay label="On hand" value={onHand} /><MetricDisplay label="Usable" value={products.reduce((sum, item) => sum + item.usable, 0)} /><MetricDisplay label="Reserved" value={reserved} tone="info" /><MetricDisplay label="Available now" value={available} tone="success" /><MetricDisplay label="Incoming" value={incoming} tone="info" /></section><section className="panel worklist"><FilterBar placeholder="Search SKU, manufacturer, dimensions, unit ID, or allocation"><button className="filter-button">Main Warehouse</button><button className="filter-button">All statuses</button><button className="filter-button">All locations</button></FilterBar><div className="responsive-table"><table><caption className="sr-only">Inventory balances by product</caption><thead><tr><th>Product / configuration</th><th>Warehouse location</th><th className="numeric">On hand</th><th className="numeric">Usable</th><th className="numeric">Reserved</th><th className="numeric">Available</th><th className="numeric">Incoming</th><th className="numeric">Demand</th><th className="numeric">Projected</th><th>Exception</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><button className="table-link" onClick={() => onOpen(product.id)}>{product.name}</button><small>{product.sku} · {product.specification}</small>{product.customerRef && <span className="allocation-tag">{product.customerRef}</span>}</td><td><strong>{product.locationCode}</strong><small>{product.location}</small></td><td className="numeric">{product.onHand}</td><td className="numeric">{product.usable}</td><td className="numeric">{product.reserved}</td><td className="numeric strong">{product.available}</td><td className="numeric">{product.incoming}</td><td className="numeric">{product.demand}</td><td className={`numeric strong ${product.projected < 0 ? "text-danger" : ""}`}>{product.projected}</td><td>{product.projected < 0 ? <StatusBadge tone="danger">Shortage {Math.abs(product.projected)}</StatusBadge> : product.available <= product.reorderPoint ? <StatusBadge tone="warning">Below target</StatusBadge> : <StatusBadge tone="success">Healthy</StatusBadge>}</td></tr>)}</tbody></table></div></section></div>;
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

function CountsView({ products, onCount }: { products: Product[]; onCount: () => void }) {
  return <div className="stack"><section className="panel count-hero"><div><span className="section-kicker">Cycle count · Main / Rack B</span><h2>COUNT-0043</h2><p>Blind count assigned to Jordan Lee · 8 products · snapshot today at 8:00 AM</p></div><div className="progress-ring"><strong>75%</strong><span>counted</span></div><button className="button primary" onClick={onCount}>Review variance</button></section><section className="panel"><PanelHeading title="Variance review" detail="A count never overwrites inventory. Approval posts an adjustment movement." /><div className="responsive-table"><table><caption className="sr-only">Inventory count variances</caption><thead><tr><th>Product</th><th className="numeric">System</th><th className="numeric">Counted</th><th className="numeric">Variance</th><th className="numeric">Value effect</th><th>Reason</th></tr></thead><tbody>{products.slice(0, 3).map((product, index) => { const variance = index === 0 ? -1 : index === 1 ? 2 : 0; return <tr key={product.id}><td><strong>{product.name}</strong><small>{product.sku}</small></td><td className="numeric">{product.onHand}</td><td className="numeric">{product.onHand + variance}</td><td className={`numeric strong ${variance < 0 ? "text-danger" : variance > 0 ? "text-success" : ""}`}>{variance > 0 ? "+" : ""}{variance}</td><td className="numeric">{money.format(variance * 800)}</td><td>{variance === 0 ? "—" : <select aria-label={`Variance reason for ${product.name}`} defaultValue={variance < 0 ? "damage" : "found"}><option value="damage">Unrecorded damage</option><option value="found">Found in adjacent bay</option><option value="count">Counting error</option></select>}</td></tr>; })}</tbody></table></div></section></div>;
}

function VendorBillsView({ bills }: { bills: Bill[] }) {
  const [selected, setSelected] = useState<Bill | null>(bills.find((bill) => bill.variance !== 0) ?? null);
  if (selected) return <div className="object-page"><button className="back-button" onClick={() => setSelected(null)}>← Back to vendor bills</button><section className="object-header panel"><div className="object-title"><div><span className="section-kicker">Vendor bill · {selected.po}</span><h2>{selected.number}</h2><p>{selected.vendor}</p></div><div className="object-total"><span>Invoice total</span><strong>{money.format(selected.billedValue)}</strong></div></div><StatusBadge>{selected.status}</StatusBadge>{selected.reason && <div className="exception-banner"><span>!</span><div><strong>Three-way match exception</strong><p>{selected.reason}</p></div></div>}<div className="object-actions"><button className="button primary">Request purchasing approval</button><button className="button secondary">Hold vendor bill</button><button className="button ghost">Correct bill draft</button></div></section><section className="metric-row object-metrics"><MetricDisplay label="PO authorized" value={money.format(selected.receivedValue)} /><MetricDisplay label="Received value" value={money.format(selected.receivedValue)} /><MetricDisplay label="Vendor billed" value={money.format(selected.billedValue)} /><MetricDisplay label="Variance" value={money.format(selected.variance)} tone={selected.variance ? "danger" : "success"} /></section><section className="panel"><PanelHeading title="Line comparison" detail="Bill review cannot alter physically received quantities." /><div className="responsive-table"><table><caption className="sr-only">Purchase order receipt and bill comparison</caption><thead><tr><th>Item</th><th className="numeric">PO qty</th><th className="numeric">Received</th><th className="numeric">Billed</th><th className="numeric">PO price</th><th className="numeric">Bill price</th><th>Exception</th></tr></thead><tbody><tr><td>Casement 3648</td><td className="numeric">40</td><td className="numeric">40</td><td className="numeric">40</td><td className="numeric">$800</td><td className="numeric">$800</td><td>—</td></tr><tr><td>Awning 4860</td><td className="numeric">2</td><td className="numeric">2</td><td className="numeric">2</td><td className="numeric">$900</td><td className="numeric text-danger">$950</td><td><StatusBadge tone="danger">+$100</StatusBadge></td></tr><tr><td>Freight</td><td>—</td><td>—</td><td className="numeric">1</td><td>—</td><td className="numeric">$250</td><td><StatusBadge tone="danger">Not on PO</StatusBadge></td></tr></tbody></table></div></section></div>;
  return <section className="panel worklist"><FilterBar placeholder="Search vendor, bill, or PO"><button className="filter-button">Match exceptions</button></FilterBar><div className="responsive-table"><table><caption className="sr-only">Vendor bills</caption><thead><tr><th>Bill</th><th>Vendor</th><th>Purchase order</th><th className="numeric">Received value</th><th className="numeric">Billed</th><th className="numeric">Variance</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{bills.map((bill) => <tr key={bill.id}><td><button className="table-link" onClick={() => setSelected(bill)}>{bill.number}</button></td><td>{bill.vendor}</td><td>{bill.po}</td><td className="numeric">{money.format(bill.receivedValue)}</td><td className="numeric">{money.format(bill.billedValue)}</td><td className={`numeric strong ${bill.variance ? "text-danger" : ""}`}>{money.format(bill.variance)}</td><td><StatusBadge>{bill.status}</StatusBadge></td><td><button className="row-action" onClick={() => setSelected(bill)}>Review match</button></td></tr>)}</tbody></table></div></section>;
}

function InvoicesView({ salesOrders }: { salesOrders: SalesOrder[] }) {
  return <section className="panel worklist"><div className="info-banner"><span aria-hidden="true">i</span><p><strong>Delivered-quantity invoicing is active.</strong> Canceling or crediting an invoice has no physical inventory effect.</p></div><FilterBar placeholder="Search invoice, shipment, customer, or sales order" /><div className="responsive-table"><table><caption className="sr-only">Customer invoices and invoiceable shipments</caption><thead><tr><th>Sales order</th><th>Customer</th><th className="numeric">Ordered</th><th className="numeric">Posted shipment</th><th className="numeric">Already invoiced</th><th className="numeric">Available to invoice</th><th>State</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{salesOrders.map((so) => <tr key={so.id}><td><button className="table-link">{so.number}</button></td><td>{so.customer}</td><td className="numeric">{so.ordered}</td><td className="numeric">{so.shipped}</td><td className="numeric">0</td><td className="numeric strong">{so.shipped}</td><td><StatusBadge>{so.billing}</StatusBadge></td><td><button className="row-action" disabled={!so.shipped}>Create invoice</button></td></tr>)}</tbody></table></div></section>;
}

function PartnersView() {
  const partners = [{ name: "Andersen Windows", type: "Vendor", contact: "orders@andersen.example", terms: "Net 30", status: "Active" }, { name: "JELD-WEN Canada", type: "Vendor", contact: "canada-orders@jeldwen.example", terms: "Net 30", status: "Active" }, { name: "Westside Homes", type: "Customer", contact: "purchasing@westside.example", terms: "Net 15", status: "Active" }, { name: "Prairie Build Group", type: "Customer", contact: "ap@prairiebuild.example", terms: "Net 30", status: "Credit review" }];
  return <section className="panel worklist"><FilterBar placeholder="Search customer, vendor, contact, or account"><button className="filter-button">All partner types</button><button className="filter-button">Active</button></FilterBar><div className="responsive-table"><table><caption className="sr-only">Customers and vendors</caption><thead><tr><th>Partner</th><th>Type</th><th>Primary contact</th><th>Payment terms</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{partners.map((partner) => <tr key={partner.name}><td><button className="table-link">{partner.name}</button></td><td>{partner.type}</td><td>{partner.contact}</td><td>{partner.terms}</td><td><StatusBadge>{partner.status}</StatusBadge></td><td><button className="row-action">Open</button></td></tr>)}</tbody></table></div></section>;
}

function ReportsView({ snapshot }: { snapshot: Snapshot }) {
  const reports = [{ title: "Late purchase orders", detail: `${snapshot.summary.lateReceipts} POs currently late`, tone: "danger" as Severity }, { title: "Available versus reserved", detail: `${snapshot.products.reduce((sum, p) => sum + p.available, 0)} available · ${snapshot.products.reduce((sum, p) => sum + p.reserved, 0)} reserved`, tone: "info" as Severity }, { title: "Three-way-match exceptions", detail: `${snapshot.bills.filter((b) => b.variance).length} bill requires review`, tone: "warning" as Severity }, { title: "Special-order inventory", detail: `${snapshot.products.filter((p) => p.customerRef).length} customer-specific units`, tone: "success" as Severity }];
  return <div className="stack"><section className="report-grid">{reports.map((report) => <button className={`report-card ${report.tone}`} key={report.title}><span className="report-icon" aria-hidden="true">▥</span><strong>{report.title}</strong><p>{report.detail}</p><b>Open report →</b></button>)}</section><section className="panel"><PanelHeading title="Projected availability" detail="Dated events with exact values; use filters to narrow the report." /><div className="report-filters"><button className="filter-button">Next 30 days</button><button className="filter-button">Main Warehouse</button><button className="filter-button">All products</button><button className="button secondary">Export CSV</button></div><div className="responsive-table"><table><caption className="sr-only">Projected product availability</caption><thead><tr><th>Product</th><th className="numeric">Usable now</th><th className="numeric">Incoming</th><th className="numeric">Open demand</th><th className="numeric">Projected</th><th>Risk</th></tr></thead><tbody>{snapshot.products.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.sku}</small></td><td className="numeric">{product.usable}</td><td className="numeric">{product.incoming}</td><td className="numeric">{product.demand}</td><td className={`numeric strong ${product.projected < 0 ? "text-danger" : ""}`}>{product.projected}</td><td>{product.projected < 0 ? <StatusBadge tone="danger">Demand exceeds supply</StatusBadge> : <StatusBadge tone="success">Covered</StatusBadge>}</td></tr>)}</tbody></table></div></section></div>;
}

function WarehouseView({ orders, onReceive }: { orders: PurchaseOrder[]; onReceive: (po: PurchaseOrder) => void }) {
  const tasks = [{ label: "Receive", count: 8, glyph: "↓", enabled: true }, { label: "Put away", count: 3, glyph: "↳", enabled: true }, { label: "Pick", count: 6, glyph: "✓", enabled: true }, { label: "Ship", count: 5, glyph: "→", enabled: true }, { label: "Transfer", count: 2, glyph: "⇄", enabled: true }, { label: "Count", count: 2, glyph: "#", enabled: true }];
  return <div className="warehouse-shell"><div className="warehouse-header"><div><span className="connection server"><span /> Online</span><h2>Main Warehouse</h2><p>Choose a task. Instructions will guide you one step at a time.</p></div><div className="warehouse-user"><span>JL</span><div><strong>Jordan Lee</strong><small>Receiver</small></div></div></div><section className="warehouse-launcher" aria-label="Warehouse tasks">{tasks.map((task) => <button key={task.label}><span className="task-glyph" aria-hidden="true">{task.glyph}</span><strong>{task.label}</strong><small>{task.count} assigned</small><b aria-hidden="true">→</b></button>)}</section><section className="warehouse-next"><div className="step-header"><span>Next task</span><StatusBadge tone="danger">4 days late</StatusBadge></div><h3>Receive {orders[0]?.number}</h3><p>{orders[0]?.vendor} · {orders[0]?.customerRef}</p><div className="scan-zone"><span aria-hidden="true">▤</span><div><strong>Scan the purchase order or packing slip</strong><small>Scanner focus is ready. Manual entry is also available.</small></div><input aria-label="Scan purchase order or packing slip" placeholder="Scan or type code" autoComplete="off" /></div><button className="warehouse-primary" onClick={() => orders[0] && onReceive(orders[0])}>Start receiving {orders[0]?.number}</button></section></div>;
}

function CommandPanel({ command, po, so, products, onClose, onSubmit }: { command: ActiveCommand; po?: PurchaseOrder; so?: SalesOrder; products: Product[]; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
  const defaults = commandDefaults(command.kind, po, so, products);
  const [quantity, setQuantity] = useState(defaults.quantity);
  const [secondaryQuantity, setSecondaryQuantity] = useState(defaults.secondaryQuantity);
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState(defaults.disposition);
  const [expectedDate, setExpectedDate] = useState(futureDate(7));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const title = commandTitle(command.kind);
  const impact = commandImpact(command.kind, quantity, secondaryQuantity, po, so, disposition);
  const max = defaults.max;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (quantity <= 0) return setError("Enter a quantity greater than zero.");
    if (max > 0 && quantity > max) return setError(`Quantity cannot exceed ${max}.`);
    if (command.kind === "receive" && secondaryQuantity > quantity) return setError("Quarantine quantity cannot exceed arrived quantity.");
    if (["close", "reopen", "reverse", "vendor-return", "customer-return", "count"].includes(command.kind) && !reason.trim()) return setError("Select or enter a reason before continuing.");
    setSubmitting(true);
    setError("");
    await onSubmit({ quantity, quarantineQuantity: secondaryQuantity, reason, disposition, expectedDate });
    setSubmitting(false);
  };

  return <div className="modal-overlay" role="presentation"><section className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title"><div className="dialog-header"><div><span className="section-kicker">{command.entityNumber}</span><h2 id="command-title">{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}>×</button></div><form onSubmit={submit}>
    {error && <div className="error-summary" role="alert"><strong>Review the highlighted information</strong><p>{error}</p></div>}
    <CommandFields kind={command.kind} po={po} so={so} quantity={quantity} secondaryQuantity={secondaryQuantity} setQuantity={setQuantity} setSecondaryQuantity={setSecondaryQuantity} reason={reason} setReason={setReason} disposition={disposition} setDisposition={setDisposition} expectedDate={expectedDate} setExpectedDate={setExpectedDate} max={max} />
    <ImpactPreview lines={impact} />
    <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Go back</button><button type="submit" className="button primary" disabled={submitting}>{submitting ? `${title.replace(/^(Post|Reopen|Close|Reverse|Return|Approve)/, "$1ing")}…` : finalCommandLabel(command.kind, quantity)}</button></div>
  </form></section></div>;
}

function CommandFields({ kind, po, so, quantity, secondaryQuantity, setQuantity, setSecondaryQuantity, reason, setReason, disposition, setDisposition, expectedDate, setExpectedDate, max }: { kind: CommandKind; po?: PurchaseOrder; so?: SalesOrder; quantity: number; secondaryQuantity: number; setQuantity: (value: number) => void; setSecondaryQuantity: (value: number) => void; reason: string; setReason: (value: string) => void; disposition: string; setDisposition: (value: string) => void; expectedDate: string; setExpectedDate: (value: string) => void; max: number }) {
  if (kind === "receive") return <div className="command-form"><div className="line-context"><span>{po?.lines[0]?.product}</span><strong>{po?.open ?? 0} open to receive</strong><small>{po?.lines[0]?.specification}</small></div><div className="form-grid"><label>Arrived at dock<input type="number" min="1" max={max || undefined} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label><label>Accepted into quarantine<input type="number" min="0" max={quantity} value={secondaryQuantity} onChange={(e) => setSecondaryQuantity(Number(e.target.value))} /></label><label>Rejected at dock<input value="0" readOnly /></label><label>Destination<select><option>Main / Rack A / Bay 03</option><option>Main / Special Orders / Bay S-12</option></select></label></div><p className="formula-note">Available inventory = arrived − quarantine − rejected. The quantity distribution must balance.</p></div>;
  if (kind === "ship") return <div className="command-form"><div className="line-context"><span>{so?.customer} · {so?.project}</span><strong>{so?.reserved ?? 0} reserved</strong><small>{so?.route}</small></div><label>Quantity to ship<input type="number" min="1" max={max} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label><label>Staging location<select><option>Main / Customer Staging / ST-02</option><option>Main / Pickup Staging / PU-01</option></select></label><label>Carrier or pickup reference<input placeholder="Optional reference" /></label></div>;
  if (kind === "vendor-return") return <div className="command-form"><div className="line-context"><span>{po?.lines[0]?.product}</span><strong>{max} eligible to return</strong><small>Source: {po?.number} · RCPT-0098</small></div><label>Quantity to return<input type="number" min="1" max={max} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label><fieldset><legend>What should happen after the vendor receives these goods?</legend>{[["replacement", "Replace the returned quantity"], ["refund", "Issue a credit; no replacement"], ["repair", "Repair and return the same unit"], ["allowance", "No physical return; issue a price allowance"]].map(([value, label]) => <label className="radio-row" key={value}><input type="radio" name="disposition" value={value} checked={disposition === value} onChange={(e) => setDisposition(e.target.value)} /><span>{label}</span></label>)}</fieldset><label>Return reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Select reason</option><option>Damaged on arrival</option><option>Wrong specification</option><option>Warranty issue</option><option>Customer cancellation</option></select></label></div>;
  if (kind === "customer-return") return <div className="command-form"><div className="line-context"><span>{so?.customer} · {so?.number}</span><strong>{max} eligible to return</strong><small>Physical and financial decisions are reviewed separately.</small></div><label>Quantity received back<input type="number" min="1" max={max} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label><label>Physical disposition<select value={disposition} onChange={(e) => setDisposition(e.target.value)}><option value="quarantine">Receive into quarantine</option><option value="available">Return to available stock</option><option value="damaged">Damaged / discounted stock</option><option value="scrap">Scrap after inspection</option></select></label><label>Customer resolution<select><option>Issue customer credit</option><option>Create replacement order</option><option>Repair</option><option>No credit</option></select></label><label>Return reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Select reason</option><option>Damage</option><option>Incorrect item</option><option>Customer changed mind</option><option>Warranty</option></select></label></div>;
  if (kind === "count") return <div className="command-form"><div className="line-context"><span>Main / Rack B</span><strong>2 variance lines</strong><small>COUNT-0043 · blind count completed by Jordan Lee</small></div><label>Net quantity adjustment<input type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label><label>Variance reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Select reason</option><option>Found in adjacent bay</option><option>Unrecorded damage</option><option>Counting error confirmed</option></select></label></div>;
  return <div className="command-form"><div className="line-context"><span>{po?.lines[0]?.product}</span><strong>{max} eligible</strong><small>{kind === "reopen" ? `${po?.closed} closed without receipt` : kind === "reverse" ? `${po?.received} originally received` : `${po?.open} open to receive`}</small></div><label>{kind === "reopen" ? "Quantity to reopen" : kind === "reverse" ? "Quantity to reverse" : "Quantity to close"}<input type="number" min="1" max={max} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label>{kind === "reopen" && <label>New expected date<input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></label>}{kind === "reverse" && <fieldset><legend>Is the reversed quantity still expected?</legend><label className="radio-row"><input type="radio" name="disposition" value="reopen" checked={disposition === "reopen"} onChange={(e) => setDisposition(e.target.value)} /><span>Yes, reopen it to receive</span></label><label className="radio-row"><input type="radio" name="disposition" value="close" checked={disposition === "close"} onChange={(e) => setDisposition(e.target.value)} /><span>No, close it without receipt</span></label></fieldset>}<label>Reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Select reason</option><option>Vendor confirmed partial availability</option><option>Vendor cannot supply</option><option>Customer canceled</option><option>Quantity entered incorrectly</option><option>Other</option></select></label></div>;
}

function ImpactPreview({ lines }: { lines: Array<{ category: string; label: string; before?: string | number; after: string | number; tone?: Severity }> }) {
  const grouped = lines.reduce<Record<string, typeof lines>>((acc, line) => { (acc[line.category] ??= []).push(line); return acc; }, {});
  return <section className="impact-preview" aria-labelledby="impact-title"><div className="impact-heading"><span aria-hidden="true">⇄</span><div><h3 id="impact-title">Review business impact</h3><p>Calculated from the current document state.</p></div></div>{Object.entries(grouped).map(([category, categoryLines]) => <div className="impact-group" key={category}><h4>{category}</h4>{categoryLines.map((line) => <div className={`impact-line ${line.tone ?? "neutral"}`} key={line.label}><span>{line.label}</span><strong>{line.before !== undefined ? <><del>{line.before}</del><b aria-hidden="true">→</b></> : null}{line.after}</strong></div>)}</div>)}</section>;
}

function commandDefaults(kind: CommandKind, po?: PurchaseOrder, so?: SalesOrder, products?: Product[]) {
  if (kind === "receive") return { quantity: po?.open || 1, secondaryQuantity: 0, max: po?.open || 999, disposition: "available" };
  if (kind === "close") return { quantity: po?.open || 1, secondaryQuantity: 0, max: po?.open || 0, disposition: "close" };
  if (kind === "reopen") return { quantity: Math.min(20, po?.closed || 1), secondaryQuantity: 0, max: po?.closed || 0, disposition: "reopen" };
  if (kind === "reverse") return { quantity: Math.min(10, po?.received || 1), secondaryQuantity: 0, max: (po?.received || 0) - (po?.returned || 0), disposition: "reopen" };
  if (kind === "vendor-return") return { quantity: 1, secondaryQuantity: 0, max: (po?.received || 0) - (po?.returned || 0), disposition: "replacement" };
  if (kind === "ship") return { quantity: Math.max(1, (so?.reserved || 0) - (so?.shipped || 0)), secondaryQuantity: 0, max: Math.max(0, (so?.reserved || 0) - (so?.shipped || 0)), disposition: "ship" };
  if (kind === "customer-return") return { quantity: 1, secondaryQuantity: 0, max: so?.shipped || so?.reserved || 1, disposition: "quarantine" };
  return { quantity: 1, secondaryQuantity: 0, max: products?.reduce((sum, product) => sum + product.onHand, 0) || 1, disposition: "adjust" };
}

function commandTitle(kind: CommandKind) {
  return ({ receive: "Post receipt", close: "Close unreceived quantity", reopen: "Reopen quantity to receive", reverse: "Reverse incorrect receipt", "vendor-return": "Return to vendor", ship: "Post shipment", "customer-return": "Post customer return", count: "Approve inventory adjustment" } as Record<CommandKind, string>)[kind];
}

function finalCommandLabel(kind: CommandKind, quantity: number) {
  return ({ receive: `Post receipt of ${quantity}`, close: `Close ${quantity} without receipt`, reopen: `Reopen ${quantity} to receive`, reverse: `Reverse ${quantity} received units`, "vendor-return": `Post vendor return of ${quantity}`, ship: `Post shipment of ${quantity}`, "customer-return": `Post customer return of ${quantity}`, count: "Approve and post inventory adjustment" } as Record<CommandKind, string>)[kind];
}

function commandImpact(kind: CommandKind, quantity: number, secondary: number, po?: PurchaseOrder, so?: SalesOrder, disposition?: string) {
  if (kind === "receive") return [
    { category: "Physical inventory", label: "Available inventory", before: po?.received ?? 0, after: (po?.received ?? 0) + quantity - secondary, tone: "success" as Severity },
    { category: "Physical inventory", label: "Quarantine inventory", before: 0, after: secondary, tone: secondary > 0 ? "warning" as Severity : "neutral" as Severity },
    { category: "Commercial commitment", label: "PO open to receive", before: po?.open ?? 0, after: Math.max((po?.open ?? 0) - quantity, 0), tone: "info" as Severity },
    { category: "Financial eligibility", label: "Quantity eligible for vendor billing", before: po?.billed ?? 0, after: (po?.billed ?? 0) + quantity },
  ];
  if (kind === "close") return [{ category: "Physical inventory", label: "On-hand inventory", after: "No change" }, { category: "Commercial commitment", label: "Expected incoming", before: po?.open ?? 0, after: Math.max((po?.open ?? 0) - quantity, 0), tone: "warning" as Severity }, { category: "Commercial commitment", label: "Closed without receipt", before: po?.closed ?? 0, after: (po?.closed ?? 0) + quantity }];
  if (kind === "reopen") return [{ category: "Physical inventory", label: "On-hand inventory", after: "No change" }, { category: "Commercial commitment", label: "Expected incoming", before: po?.open ?? 0, after: (po?.open ?? 0) + quantity, tone: "info" as Severity }, { category: "Commercial commitment", label: "Closed without receipt", before: po?.closed ?? 0, after: Math.max((po?.closed ?? 0) - quantity, 0) }, { category: "Commercial commitment", label: "Purchase-order revision", before: po?.revision ?? 1, after: (po?.revision ?? 1) + 1 }];
  if (kind === "reverse") return [{ category: "Physical inventory", label: "Available inventory", before: po?.received ?? 0, after: Math.max((po?.received ?? 0) - quantity, 0), tone: "danger" as Severity }, { category: "Commercial commitment", label: "Net received", before: (po?.received ?? 0) - (po?.returned ?? 0), after: Math.max((po?.received ?? 0) - (po?.returned ?? 0) - quantity, 0) }, { category: "Commercial commitment", label: disposition === "reopen" ? "Open to receive" : "Closed without receipt", before: disposition === "reopen" ? po?.open ?? 0 : po?.closed ?? 0, after: (disposition === "reopen" ? po?.open ?? 0 : po?.closed ?? 0) + quantity }];
  if (kind === "vendor-return") return disposition === "allowance" ? [{ category: "Physical inventory", label: "On-hand inventory", after: "No change" }, { category: "Commercial commitment", label: "PO fulfillment", after: "No change" }, { category: "Financial effect", label: "Vendor credit", after: "Price-only credit expected", tone: "info" as Severity }] : [{ category: "Physical inventory", label: "Internal inventory", before: (po?.received ?? 0) - (po?.returned ?? 0), after: Math.max((po?.received ?? 0) - (po?.returned ?? 0) - quantity, 0), tone: "danger" as Severity }, { category: "Commercial commitment", label: disposition === "replacement" ? "Replacement supply" : "Closed without replacement", before: 0, after: quantity, tone: disposition === "replacement" ? "info" as Severity : "warning" as Severity }, { category: "Financial effect", label: "Vendor credit expected", after: "Yes" }];
  if (kind === "ship") return [{ category: "Physical inventory", label: "Main warehouse on hand", before: so?.reserved ?? 0, after: Math.max((so?.reserved ?? 0) - quantity, 0), tone: "danger" as Severity }, { category: "Commercial commitment", label: "Sales order shipped", before: so?.shipped ?? 0, after: (so?.shipped ?? 0) + quantity, tone: "success" as Severity }, { category: "Allocations", label: "Reservations released", before: so?.reserved ?? 0, after: Math.max((so?.reserved ?? 0) - quantity, 0) }, { category: "Financial eligibility", label: "Quantity eligible to invoice", before: so?.shipped ?? 0, after: (so?.shipped ?? 0) + quantity }];
  if (kind === "customer-return") return [{ category: "Physical inventory", label: disposition === "available" ? "Available stock" : "Returns / quarantine", before: 0, after: quantity, tone: disposition === "available" ? "success" as Severity : "warning" as Severity }, { category: "Commercial commitment", label: "Replacement demand", after: "Explicit only; not automatic" }, { category: "Financial effect", label: "Customer credit", after: "Created separately after review", tone: "info" as Severity }];
  return [{ category: "Physical inventory", label: "Inventory adjustment", before: 0, after: quantity, tone: quantity < 0 ? "danger" as Severity : "success" as Severity }, { category: "Financial effect", label: "Estimated value effect", after: money.format(quantity * 800) }, { category: "Audit", label: "Linked adjustment movement", after: "Will be created" }];
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
  next.activities.unshift({ id: crypto.randomUUID(), time: "Just now", title: `${commandTitle(kind)} completed`, detail: `${quantity} unit${quantity === 1 ? "" : "s"} processed for ${po?.number ?? so?.number ?? "COUNT-0043"}.`, tone: "success" });
  return next;
}

function normalizeSnapshot(input: unknown): Snapshot {
  if (!input || typeof input !== "object") return fallbackSnapshot;
  const raw = input as Record<string, unknown>;
  const summary = asRecord(raw.summary);
  const rawProducts = asRows(raw.products);
  const rawPurchaseOrders = asRows(raw.purchaseOrders);
  const rawSalesOrders = asRows(raw.salesOrders);

  const products: Product[] = rawProducts.map((item, index) => {
    const fallback = fallbackSnapshot.products[index % fallbackSnapshot.products.length];
    const demand = rawSalesOrders.reduce((sum, order) => {
      const matching = asRows(order.lines).filter((line) => text(line.productId) === text(item.id));
      return sum + matching.reduce((lineSum, line) => lineSum + number(line.orderedQuantity) - number(line.shippedQuantity), 0);
    }, 0);
    const usable = number(item.usable);
    const incoming = number(item.incoming);
    const available = number(item.available);
    return {
      id: text(item.id, `product-${index}`),
      sku: text(item.sku, fallback.sku),
      name: text(item.name, fallback.name),
      specification: [text(item.dimensions), text(item.finish), text(item.material)].filter(Boolean).join(" · ") || fallback.specification,
      policy: titleCase(text(item.trackingPolicy || item.inventoryPolicy, fallback.policy)),
      location: fallback.location,
      locationCode: fallback.locationCode,
      onHand: number(item.onHand),
      usable,
      reserved: number(item.reserved),
      available,
      incoming,
      demand,
      projected: usable + incoming - demand,
      reorderPoint: number(item.reorderPoint),
      customerRef: text(item.trackingPolicy).includes("serial") ? fallback.customerRef : undefined,
      version: number(item.version, 1),
    };
  });

  const purchaseOrders: PurchaseOrder[] = rawPurchaseOrders.map((item, index) => {
    const fallback = fallbackSnapshot.purchaseOrders[index % fallbackSnapshot.purchaseOrders.length];
    const lines = asRows(item.lines).map((line, lineIndex): PurchaseLine => ({
      id: text(line.id, `${text(item.id)}-line-${lineIndex}`),
      sku: text(line.sku),
      product: text(line.productName, "Window product"),
      specification: configurationText(line.configurationSnapshot) || products.find((product) => product.id === text(line.productId))?.specification || "Standard configuration",
      customerRef: index % 2 === 0 ? fallback.customerRef : undefined,
      ordered: number(line.orderedQuantity),
      received: number(line.netReceivedQuantity),
      returned: 0,
      closed: number(line.closedWithoutReceiptQuantity),
      open: number(line.openToReceiveQuantity),
      unitCost: number(line.unitCostCents) / 100,
      location: fallback.lines[0]?.location ?? "Main Warehouse / Receiving",
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
      customerRef: index % 2 === 0 ? fallback.customerRef : undefined,
      exception: late > 0
        ? `${open} units are ${late} days late${index % 2 === 0 ? " and affect linked customer demand" : ""}`
        : closed > 0 ? `${closed} units closed without receipt` : undefined,
      lines: lines.length ? lines : fallback.lines,
    };
  });

  const salesOrders: SalesOrder[] = rawSalesOrders.map((item, index) => {
    const fallback = fallbackSnapshot.salesOrders[index % fallbackSnapshot.salesOrders.length];
    const firstLine = asRows(item.lines)[0];
    const product = products.find((candidate) => candidate.id === text(firstLine?.productId));
    const open = number(item.openToShipQuantity);
    const availableNow = Math.min(open, product?.available ?? fallback.availableNow);
    const incomingBeforeDate = Math.min(Math.max(open - availableNow, 0), product?.incoming ?? fallback.incomingBeforeDate);
    const shortage = Math.max(open - availableNow - incomingBeforeDate, 0);
    return {
      id: text(item.id, `so-${index}`),
      number: text(item.number, `SO-${2000 + index}`),
      customer: text(item.customerName, fallback.customer),
      project: fallback.project,
      requestedDate: text(item.requestedDate, fallback.requestedDate),
      lifecycle: titleCase(text(item.lifecycleStatus, "confirmed")),
      fulfillment: titleCase(text(item.fulfillmentStatus, "unreserved")),
      billing: titleCase(text(item.billingStatus, "not_invoiced")),
      ordered: number(item.orderedQuantity),
      reserved: number(item.reservedQuantity),
      shipped: number(item.shippedQuantity),
      open,
      availableNow,
      incomingBeforeDate,
      shortage,
      total: number(item.totalCents) / 100,
      route: fallback.route,
      linkedPo: index % 2 === 0 ? purchaseOrders[index % purchaseOrders.length]?.number : undefined,
      exception: shortage > 0 ? `${shortage} unit${shortage === 1 ? "" : "s"} short for requested date` : undefined,
      version: number(item.version, 1),
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
    salesOrders,
    movements: movements.length ? movements : fallbackSnapshot.movements,
    bills: bills.length ? bills : fallbackSnapshot.bills,
    activities: activities.length ? activities : fallbackSnapshot.activities,
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
