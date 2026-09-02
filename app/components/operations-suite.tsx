"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type Dispatch, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type SetStateAction } from "react";
import { PAYMENT_TERMS, RemoteSearchSelect, SearchableSelect, type LookupKind, type PickerOption, type QuickCreateKind } from "./reference-picker";
import { useDialogDismiss } from "./use-dialog-dismiss";
import { actorName } from "./format";
import { EmailDocumentButton } from "./email-documents";
import { workflowCommandEnvelope, workflowCommandForAction, workflowSnapshotParts } from "@/lib/domain/workflow-envelope";

export type OperationsWorkspaceKind = "purchasing" | "sales" | "inventory" | "vendor-billing" | "customer-billing" | "controls";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
type WorkflowActionKind =
  | "submitPurchaseOrder" | "approvePurchaseOrder" | "rejectPurchaseOrder" | "amendPurchaseOrder" | "cancelPurchaseOrder"
  | "transferInventory" | "changeInventoryStatus" | "scrapInventory" | "allocateLandedCost"
  | "receiveTransfer" | "registerInventoryIdentity" | "requestOverReceiptApproval" | "setValuationPolicy"
  | "releaseReservation" | "reallocateReservation" | "reverseShipment"
  | "postDropShipDelivery" | "reverseDropShipDelivery"
  | "confirmSalesOrder" | "cancelSalesOrder"
  | "createVendorBill" | "resolveMatchException" | "approveVendorBill" | "createVendorCredit" | "recordVendorPayment"
  | "createCustomerInvoice" | "issueCustomerCredit" | "recordCustomerPayment" | "voidCustomerInvoice" | "addDocumentCharge"
  | "issueReturnableAsset" | "returnReturnableAsset" | "forfeitReturnableAsset" | "refundAssetDeposit"
  | "approveApproval" | "rejectApproval"
  | "updatePolicy" | "lockPeriod" | "unlockPeriod" | "updateUserRole";

type WorkflowRecord = {
  id: string;
  number: string;
  status: string;
  party?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  quantity?: number;
  detail?: string;
  version?: number;
  revision?: number;
  exception?: string;
  integrationErrorCode?: string;
  /** Document dates. An AP/AR register without them cannot show what is overdue. */
  issuedOn?: string;
  dueOn?: string;
  /** Who raised the document and why, plus what is on it — the context an approver needs. */
  requester?: string;
  note?: string;
  lines?: Array<{ id: string; sku: string; product: string; quantity: number; unitAmount: number; amount: number }>;
  data?: Record<string, unknown>;
};

type TraceUnit = {
  id: string;
  sku: string;
  serial: string;
  lot: string;
  location: string;
  status: string;
  customer?: string;
  receivedOn: string;
  source: string;
};

type AssetRecord = WorkflowRecord & { assetType: string; customer: string; deposit: number; issued: number; returned: number };
type PolicyRecord = { id: string; name: string; value: string; description: string; risk: string; version?: number; data?: Record<string, unknown> };
/** `data` carries the raw row so a dialog can prefill from fields the summary does not show. */
type ActionRecord = { id: string; number?: string; status?: string; party?: string; reference?: string; amount?: number; currency?: string; quantity?: number; detail?: string; version?: number; revision?: number; exception?: string; value?: string; data?: Record<string, unknown> };
type AuditRecord = { id: string; time: string; actor: string; action: string; record: string; impact: string; category: string };
type AttachmentRecord = { id: string; fileName: string; type: string; document: string; status: string; uploadedBy: string; time: string; href?: string; ownerId?: string; documentType?: string; documentId?: string };
type CurrentUser = { id: string; name: string; role: string; permissions: string[] };
type SelectOption = { id: string; label: string; detail?: string; version?: number; status?: string; data?: Record<string, unknown> };
type WorkflowOptions = { products: SelectOption[]; warehouses: SelectOption[]; locations: SelectOption[]; uoms: SelectOption[]; priceLists: SelectOption[]; salesOrderLines: SelectOption[]; purchaseOrderLines: SelectOption[]; purchaseOrders: SelectOption[]; salesOrders: SelectOption[]; partners: SelectOption[]; costLayers: SelectOption[]; assetTypes: SelectOption[]; vendorBills: SelectOption[]; customerInvoices: SelectOption[] };

export type WorkflowState = {
  purchaseOrders: WorkflowRecord[];
  revisions: WorkflowRecord[];
  transfers: WorkflowRecord[];
  traceUnits: TraceUnit[];
  reservations: WorkflowRecord[];
  shipments: WorkflowRecord[];
  dropShipDeliveries: WorkflowRecord[];
  vendorBills: WorkflowRecord[];
  customerInvoices: WorkflowRecord[];
  valuations: WorkflowRecord[];
  assets: AssetRecord[];
  approvals: WorkflowRecord[];
  policies: PolicyRecord[];
  periodLocks: WorkflowRecord[];
  valuationPolicies: WorkflowRecord[];
  users: WorkflowRecord[];
  outbox: WorkflowRecord[];
  marginRules: WorkflowRecord[];
  priceLists: SelectOption[];
  priceAssignments: WorkflowRecord[];
  priceEntries: WorkflowRecord[];
  uomConversions: WorkflowRecord[];
  orphanedLocations: WorkflowRecord[];
  audit: AuditRecord[];
  attachments: AttachmentRecord[];
  currentUser: CurrentUser;
  permissions: Record<string, boolean>;
  options: WorkflowOptions;
  /** Whole-database totals. The record arrays above are only the requested page. */
  totals: { inventoryValueCents: number; landedCostAllocatedCents: number; landedCostAllocationCount: number; scrapValueCents: number; scrapEntryCount: number };
};

type ActionDefinition = {
  kind: WorkflowActionKind;
  title: string;
  description: string;
  finalLabel: string;
  record?: ActionRecord;
};

type FinancialInput = { currency: string; exchangeRate: number; terms: string; postingDate: string; dueDate: string; taxCode: string; taxRate: number; discount: number; freight: number; fees: number; deposit: number; paid: number };

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const formatWorkflowMoney = (value: number, currency = "CAD") => {
  try { return new Intl.NumberFormat("en-CA", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
};

/** Fixed enumerations that outgrew a glance. Routed through OptionField so they pick up the
 *  same type-to-filter treatment as every other list past SEARCHABLE_THRESHOLD. */
const attachmentCategories: SelectOption[] = [
  { id: "document", label: "Document" }, { id: "damage_photo", label: "Damage photo" },
  { id: "proof_of_delivery", label: "Proof of delivery" }, { id: "packing_slip", label: "Packing slip" },
  { id: "invoice", label: "Invoice" }, { id: "label", label: "Label" }, { id: "other", label: "Other" },
];
const locationTypes: SelectOption[] = [
  { id: "storage", label: "Storage" }, { id: "receiving", label: "Receiving" }, { id: "shipping", label: "Shipping" },
  { id: "quarantine", label: "Quarantine" }, { id: "in_transit", label: "In transit" }, { id: "scrap", label: "Scrap" },
];
const today = new Date().toISOString().slice(0, 10);

function dueDateFromTerms(baseDate: string, terms: string) {
  const match = terms.match(/(\d+)/);
  const days = match ? Number(match[1]) : 0;
  const date = new Date(`${baseDate || today}T12:00:00Z`);
  if (!Number.isFinite(date.valueOf())) return baseDate || today;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function typedPolicyValue(key: string, raw: string) {
  if (["valuation.defaultMethod", "security.defaultRole"].includes(key)) return raw.trim();
  try { return JSON.parse(raw) as unknown; }
  catch { throw new Error("Enter valid JSON for this policy value (for example, a number, false, or an object)."); }
}

function emptyWorkflowOptions(): WorkflowState["options"] {
  return { products: [], warehouses: [], locations: [], uoms: [], priceLists: [], salesOrderLines: [], purchaseOrderLines: [], purchaseOrders: [], salesOrders: [], partners: [], costLayers: [], assetTypes: [], vendorBills: [], customerInvoices: [] };
}

async function loadWorkflowState(workspace: OperationsWorkspaceKind) {
  const pageSize = 100;
  // Workflow tabs are action queues, while the surrounding register is the paginated system of
  // record. Loading every historical workflow page before showing the first one turned 10,000
  // bills into 100 serial requests and retained the full history in the browser. The server sorts
  // these queues by operational relevance, so one bounded page gives the user the next work
  // immediately; older records remain available in the register and remote reference pickers.
  const response = await fetch(`/api/workflows?page=1&pageSize=${pageSize}&scope=${encodeURIComponent(workspace)}`, { cache: "no-store" });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const error = body.error;
    const message = typeof error === "string" ? error : error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message) : "Workflow service unavailable";
    throw new Error(message);
  }
  const parts = workflowSnapshotParts(body);
  return normalizeLiveWorkflowState(parts.advanced, parts.core);
}

function emptyWorkflowState(): WorkflowState {
  return {
    purchaseOrders: [], revisions: [], transfers: [], traceUnits: [], reservations: [], shipments: [], dropShipDeliveries: [], vendorBills: [], customerInvoices: [], valuations: [], assets: [], approvals: [], policies: [], periodLocks: [], valuationPolicies: [], users: [], outbox: [], marginRules: [], priceLists: [], priceAssignments: [], priceEntries: [], uomConversions: [], orphanedLocations: [], audit: [], attachments: [],
    currentUser: { id: "unavailable", name: "Permission context unavailable", role: "No authenticated role", permissions: [] },
    permissions: {},
    options: emptyWorkflowOptions(),
    totals: { inventoryValueCents: 0, landedCostAllocatedCents: 0, landedCostAllocationCount: 0, scrapValueCents: 0, scrapEntryCount: 0 },
  };
}

const tabs: Record<OperationsWorkspaceKind, Array<{ key: string; label: string }>> = {
  purchasing: [{ key: "overview", label: "Orders" }, { key: "drafts", label: "Drafts & revisions" }, { key: "approvals", label: "Approval queue" }],
  sales: [{ key: "overview", label: "Orders" }, { key: "lifecycle", label: "Draft lifecycle" }, { key: "reservations", label: "Reservations" }, { key: "drop-ship", label: "Drop-ship deliveries" }, { key: "shipment-corrections", label: "Shipment corrections" }],
  inventory: [{ key: "overview", label: "Balances" }, { key: "transfers", label: "Transfers & status" }, { key: "approvals", label: "Inventory approvals" }, { key: "traceability", label: "Traceability" }, { key: "valuation", label: "Valuation" }, { key: "returnables", label: "Returnables" }],
  "vendor-billing": [{ key: "overview", label: "Bills" }, { key: "match", label: "Match exceptions" }, { key: "billing-actions", label: "Credits, payments & charges" }],
  // The overview lists sales orders and what is still invoiceable on them; the posted invoices
  // themselves live on the other tab. Labelling the first one "Invoices" sent anyone looking
  // for an invoice to the tab that has none, so each label now names what the tab shows.
  "customer-billing": [{ key: "overview", label: "Ready to invoice" }, { key: "billing-actions", label: "Posted invoices" }],
  controls: [{ key: "overview", label: "Reports" }, { key: "approvals", label: "Approvals" }, { key: "audit", label: "Audit timeline" }, { key: "policies", label: "System policies" }, { key: "periods-access", label: "Periods & access" }, { key: "integrations", label: "Integrations" }, { key: "reconciliation", label: "Reconciliation" }, { key: "pricing", label: "Pricing" }, { key: "units", label: "Units & conversions" }, { key: "master-data", label: "Master data" }],
};

/** Create actions offered above a workspace's main list, alongside the records they add to. */
const overviewCreateActions: Partial<Record<OperationsWorkspaceKind, ActionDefinition>> = {
  "vendor-billing": { kind: "createVendorBill", title: "Create vendor bill", description: "Record and post the financial obligation against a PO and posted receipt. Inventory does not move.", finalLabel: "Create & post vendor bill" },
};

export function OperationsWorkspace({ workspace, children, initialTab = "overview", onTabChange, onDurableRefresh, refreshToken = 0, onCreateOrder }: { workspace: OperationsWorkspaceKind; children: ReactNode; initialTab?: string; onTabChange?: (tab: string) => void; onDurableRefresh?: () => void | Promise<void>; refreshToken?: number; onCreateOrder?: () => void }) {
  const validTab = tabs[workspace].some((tab) => tab.key === initialTab) ? initialTab : "overview";
  const requestedTab = `${workspace}:${initialTab}`;
  const [tabSelection, setTabSelection] = useState({ request: requestedTab, tab: validTab });
  const [state, setState] = useState<WorkflowState>(emptyWorkflowState);
  const [serviceState, setServiceState] = useState<"loading" | "live" | "unavailable">("loading");
  const [serviceError, setServiceError] = useState("");
  /**
   * Which workspace the records in `state` actually answer for. Every tab's table reported
   * "No records in this view" while the first fetch was still running, which reads as a
   * finished, empty answer — the same trap the worklist snapshot already guards against.
   * Tracking the loaded workspace tells a genuine empty result apart from an unanswered one,
   * and it deliberately does not reset on background refreshes, which would blank a tab the
   * user is reading every time a posted command reloads the workspace.
   */
  const [loadedWorkspace, setLoadedWorkspace] = useState<OperationsWorkspaceKind | null>(null);
  /**
   * Recording an ordinary vendor invoice had no route from the Bills tab: the only "Create
   * vendor bill" button lived on Match exceptions, so the everyday case was reached through a
   * queue named after problems. Every other list in the app carries its own create action.
   */
  const overviewCreate = overviewCreateActions[workspace];
  const [action, setAction] = useState<ActionDefinition | null>(null);
  const [toast, setToast] = useState("");
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setServiceState("loading");
    try {
      const nextState = await loadWorkflowState(workspace);
      if (generation !== loadGeneration.current) return;
      setState(nextState);
      setLoadedWorkspace(workspace);
      setServiceState("live");
      setServiceError("");
    } catch (caught) {
      if (generation !== loadGeneration.current) return;
      setServiceState("unavailable");
      setServiceError(caught instanceof Error ? caught.message : "The workflow service could not be reached.");
    }
  }, [workspace]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshToken]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 5000); return () => window.clearTimeout(timer); }, [toast]);
  const visibleTab = tabSelection.request === requestedTab ? tabSelection.tab : validTab;

  const selectTab = (tab: string) => {
    setTabSelection({ request: requestedTab, tab });
    onTabChange?.(tab);
  };

  const execute = async (kind: WorkflowActionKind, payload: Record<string, unknown>) => {
    const idempotencyKey = crypto.randomUUID();
    const command = workflowCommandForAction(kind, payload.fastTrack === true ? "fast-track" : String(payload.resolution ?? ""));
    const envelope = workflowCommandEnvelope({ command, kind, payload, record: action?.record, options: state.options, idempotencyKey });
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(envelope),
    });
    const result = await response.json() as { state?: unknown; snapshot?: unknown; message?: string; recordId?: string; error?: string | { message?: string } };
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "The workflow could not be completed.");
    await load();
    await onDurableRefresh?.();
    const recordSuffix = result.recordId && kind === "requestOverReceiptApproval" ? ` Approval ID: ${result.recordId}` : "";
    setToast(`${result.message ?? `${actionTitle(kind)} completed.`}${recordSuffix}`);
  };
  const canAction = (kind: WorkflowActionKind) => {
    if (serviceState !== "live") return false;
    if (kind === "resolveMatchException") return state.permissions.approveVendorBill === true || state.permissions.createVendorCredit === true;
    return state.permissions[workflowCommandForAction(kind, "")] === true;
  };
  const routeLegacyAction = (event: ReactMouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest("button");
    const label = button?.textContent?.trim().toLowerCase() ?? "";
    const next = workspace === "inventory" && label.includes("transfer inventory") ? "transfers"
      : workspace === "sales" && label.includes("resolve shortage") ? "reservations"
      : workspace === "vendor-billing" && /request purchasing approval|hold vendor bill|correct bill draft/.test(label) ? "match"
      : workspace === "customer-billing" && label.includes("create invoice") ? "billing-actions"
      : null;
    if (next) { event.preventDefault(); selectTab(next); }
  };

  return (
    <div className="operations-workspace" onClickCapture={routeLegacyAction}>
      <div className="workspace-tabbar" role="tablist" aria-label={`${workspace} workspace views`}>
        {tabs[workspace].map((tab) => <button key={tab.key} role="tab" aria-selected={visibleTab === tab.key} className={visibleTab === tab.key ? "active" : ""} onClick={() => selectTab(tab.key)}>{tab.label}{tabCount(workspace, tab.key, state) ? <span>{tabCount(workspace, tab.key, state)}</span> : null}</button>)}
        <span className={`workflow-service ${serviceState}`} role="status" title={serviceError || undefined}>{serviceState === "live" ? "Durable workflows live" : serviceState === "loading" ? "Loading workflows…" : "Workflow service unavailable"}</span>
      </div>
      {serviceState === "unavailable" && visibleTab !== "overview" ? <div className="workflow-banner warning"><strong>Changes are temporarily unavailable.</strong><span>{serviceError || "Reference data is shown below. Reconnect before posting a business action so it can be durably recorded."}</span><button onClick={() => void load()}>Retry connection</button></div> : null}
      {visibleTab === "overview" ? <>{overviewCreate ? <div className="workspace-overview-actions"><ActionButton kind="primary" disabled={!canAction(overviewCreate.kind)} onClick={() => setAction(overviewCreate)}>{overviewCreate.finalLabel}</ActionButton></div> : null}{children}</>
        : loadedWorkspace !== workspace && serviceState === "loading" ? <div className="workflow-empty" role="status">Loading records…</div>
        : <WorkflowTab workspace={workspace} tab={visibleTab} state={state} canAction={canAction} openAction={setAction} refresh={load} onCreateOrder={onCreateOrder} />}
      {action ? <WorkflowDialog action={action} state={state} onClose={() => setAction(null)} onSubmit={async (payload) => { await execute(action.kind, payload); setAction(null); }} /> : null}
      {toast ? <div className="workflow-toast" role="status"><span aria-hidden="true">✓</span>{toast}</div> : null}
    </div>
  );
}

function WorkflowTab({ workspace, tab, state, canAction, openAction, refresh, onCreateOrder }: { workspace: OperationsWorkspaceKind; tab: string; state: WorkflowState; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void; refresh: () => Promise<void>; onCreateOrder?: () => void }) {
  if (workspace === "purchasing" && tab === "drafts") return <PurchaseDrafts state={state} canAction={canAction} openAction={openAction} onCreateOrder={onCreateOrder} />;
  if (workspace === "purchasing" && tab === "approvals") return <ApprovalQueue records={state.purchaseOrders.filter((item) => item.status.toLowerCase().includes("pending"))} canAction={canAction} openAction={openAction} />;
  if (workspace === "sales" && tab === "reservations") return <Reservations records={state.reservations} canAction={canAction} openAction={openAction} />;
  if (workspace === "sales" && tab === "lifecycle") return <SalesLifecycle records={state.options.salesOrders.map((option) => {
    const row = option.data ?? {};
    const currency = String(row.currency ?? "CAD");
    return { id: option.id, number: option.label, status: String(option.status ?? "unknown").replaceAll("_", " "), version: option.version,
      party: String(row.customerName ?? ""),
      quantity: Number(row.orderedQuantity ?? 0) || undefined, amount: Number(row.totalCents ?? 0) / 100, currency };
  })} canAction={canAction} openAction={openAction} />;
  if (workspace === "sales" && tab === "shipment-corrections") return <ShipmentCorrections records={state.shipments} canAction={canAction} openAction={openAction} />;
  if (workspace === "sales" && tab === "drop-ship") return <DropShipDeliveries records={state.dropShipDeliveries} canAction={canAction} openAction={openAction} />;
  if (workspace === "inventory" && tab === "transfers") return <InventoryTransfers records={state.transfers} canAction={canAction} openAction={openAction} />;
  if ((workspace === "inventory" || workspace === "controls") && tab === "approvals") return <CountApprovalInbox records={state.approvals.filter((record) => ["inventory_count_variance", "over_receipt"].includes(String(record.data?.requestType ?? "")))} canAction={canAction} openAction={openAction} />;
  if (workspace === "inventory" && tab === "traceability") return <Traceability units={state.traceUnits} state={state} canAction={canAction} openAction={openAction} />;
  if (workspace === "inventory" && tab === "valuation") return <Valuation records={state.valuations} policies={state.valuationPolicies} totals={state.totals} canAction={canAction} openAction={openAction} />;
  if (workspace === "inventory" && tab === "returnables") return <Returnables records={state.assets} canAction={canAction} openAction={openAction} />;
  if (workspace === "vendor-billing" && tab === "match") return <VendorMatching records={state.vendorBills} canAction={canAction} openAction={openAction} />;
  if (workspace === "vendor-billing" && tab === "billing-actions") return <VendorBillingActions records={state.vendorBills} canAction={canAction} openAction={openAction} />;
  if (workspace === "customer-billing" && tab === "billing-actions") return <CustomerBilling records={state.customerInvoices} canAction={canAction} openAction={openAction} />;
  if (workspace === "controls" && tab === "audit") return <AuditTimeline state={state} />;
  if (workspace === "controls" && tab === "policies") return <div className="workflow-stack"><AccessNotice /><Policies records={state.policies} user={state.currentUser} canAction={canAction} openAction={openAction} /></div>;
  if (workspace === "controls" && tab === "periods-access") return <PeriodsAndAccess state={state} canAction={canAction} openAction={openAction} />;
  if (workspace === "controls" && tab === "integrations") return <IntegrationOutbox state={state} refresh={refresh} />;
  if (workspace === "controls" && tab === "pricing") return <PriceListsPanel state={state} refresh={refresh} />;
  if (workspace === "controls" && tab === "units") return <UnitsPanel state={state} refresh={refresh} />;
  if (workspace === "controls" && tab === "reconciliation") return <LocationReconciliationPanel state={state} refresh={refresh} />;
  if (workspace === "controls" && tab === "master-data") return <MasterDataPanel state={state} refresh={refresh} />;
  return null;
}

function Section({ title, detail, action, children }: { title: string; detail?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="workflow-panel"><header className="workflow-panel-header"><div><h2>{title}</h2>{detail ? <p>{detail}</p> : null}</div>{action}</header>{children}</section>;
}

function AccessNotice() {
  return <section className="workflow-banner"><strong>Role administration</strong><span>User access is server-managed; only an administrator can assign or disable a role.</span></section>;
}

function PeriodsAndAccess({ state, canAction, openAction }: { state: WorkflowState; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <div className="workflow-stack"><Section title="Posting period locks" detail="Control accounting, inventory, purchasing, sales, or all posting modules." action={<ActionButton kind="primary" disabled={!canAction("lockPeriod")} onClick={() => openAction({ kind: "lockPeriod", title: "Lock a posting period", description: "Prevent new postings on or before a controlled date for one module.", finalLabel: "Lock period" })}>Lock period</ActionButton>}><RecordTable records={state.periodLocks} columns={["number", "reference", "status", "detail", "version"]} actions={(record) => workflowStatusIs(record.status, "active") ? <ActionButton disabled={!canAction("unlockPeriod")} onClick={() => openAction({ kind: "unlockPeriod", title: `Unlock ${record.number}`, description: "Re-open this posting period. The reason is written to the audit trail.", finalLabel: "Unlock period", record })}>Unlock</ActionButton> : <span className="read-only-label">Unlocked</span>} /></Section><Section title="Application users"><RecordTable records={state.users} columns={["number", "party", "status", "detail", "version"]} actions={(record) => <ActionButton disabled={!canAction("updateUserRole")} onClick={() => openAction({ kind: "updateUserRole", title: `Update access for ${record.number}`, description: "Assign a server-enforced role or disable this identity.", finalLabel: "Save user access", record })}>Change access</ActionButton>} /></Section></div>;
}

type QboAdminState = {
  configuration: { configured: boolean; message?: string; redirectUri?: string; webhookConfigured?: boolean; minorVersion?: string };
  connections: Array<Record<string, unknown>>;
  selectedConnectionId: string | null;
  accountRoles: Array<{ key: string; label: string; types: readonly string[] }>;
  accountMappings: Array<Record<string, unknown>>;
  referenceMappings: Array<Record<string, unknown>>;
  deliveries: Array<Record<string, unknown>>;
  summary: { counts?: Record<string, number>; links?: { total?: number; conflicts?: number }; lastReconciliation?: Record<string, unknown> } | null;
  remoteOptions: { accounts: Array<{ id: string; name: string; accountType: string; accountSubType: string }>; taxCodes: Array<{ id: string; name: string }>; terms: Array<{ id: string; name: string }>; paymentMethods: Array<{ id: string; name: string }> } | null;
  remoteError: string | null;
  localReferenceValues: { taxCodes: string[]; terms: string[]; paymentMethods: string[] };
};

function qboError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
  }
  return fallback;
}

function QuickBooksIntegration({ canAdminister }: { canAdminister: boolean }) {
  const [data, setData] = useState<QboAdminState | null>(null);
  const [loading, setLoading] = useState(canAdminister); const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [syncFrom, setSyncFrom] = useState(() => new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString().slice(0, 10));
  const [accountSelections, setAccountSelections] = useState<Record<string, string>>({});
  const [referenceSelections, setReferenceSelections] = useState<Record<string, string>>({});

  const load = useCallback(async (includeRemoteOptions = false, connectionId?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams(); if (includeRemoteOptions) params.set("refresh", "1"); if (connectionId) params.set("connectionId", connectionId);
      const response = await fetch(`/api/integrations/qbo?${params}`, { cache: "no-store" });
      const result = await response.json() as QboAdminState & { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "QuickBooks integration state could not be loaded.");
      setData(result);
      const selected = result.connections.find((item) => String(item.id) === String(result.selectedConnectionId));
      if (selected?.environment === "sandbox" || selected?.environment === "production") setEnvironment(selected.environment);
      if (typeof selected?.syncFrom === "string") setSyncFrom(String(selected.syncFrom).slice(0, 10));
      setAccountSelections(Object.fromEntries(result.accountMappings.map((item) => [String(item.logicalKey), String(item.qboAccountId)])));
      setReferenceSelections(Object.fromEntries(result.referenceMappings.map((item) => [`${String(item.mappingType)}:${String(item.localValue)}`, String(item.qboEntityId)])));
      if (result.remoteError) setMessage(result.remoteError);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "QuickBooks integration state could not be loaded."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!canAdminister) return undefined;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [canAdminister, load]);
  const connectionId = data?.selectedConnectionId ?? "";

  const connect = async () => {
    setBusy("connect"); setMessage("");
    try {
      const response = await fetch("/api/integrations/qbo/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ environment, syncFrom: `${syncFrom}T00:00:00.000Z`, returnTo: "/?view=reports&tab=integrations" }) });
      const result = await response.json() as { authorizationUrl?: string; error?: { message?: string } };
      if (!response.ok || !result.authorizationUrl) throw new Error(result.error?.message ?? "QuickBooks authorization could not be started.");
      window.location.assign(result.authorizationUrl);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "QuickBooks authorization could not be started."); setBusy(""); }
  };

  const post = async (action: string, input: Record<string, unknown> = {}) => {
    setBusy(action); setMessage("");
    try {
      const response = await fetch("/api/integrations/qbo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, connectionId, ...input }) });
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(qboError(result, `QuickBooks ${action} failed.`));
      const labels: Record<string, string> = { sync: "QuickBooks sync run completed.", reconcile: "QuickBooks reconciliation completed.", saveAccountMappings: "Account mappings saved.", saveReferenceMappings: "Tax, term, and payment-method mappings saved.", retry: "Delivery queued for retry.", disconnect: "QuickBooks connection disconnected." };
      setMessage(labels[action] ?? "QuickBooks integration updated.");
      await load(action === "saveAccountMappings" || action === "saveReferenceMappings", connectionId);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : `QuickBooks ${action} failed.`); }
    finally { setBusy(""); }
  };

  const saveAccounts = () => {
    const accounts = data?.remoteOptions?.accounts ?? [];
    const mappings = Object.entries(accountSelections).filter(([, id]) => id).map(([logicalKey, id]) => {
      const account = accounts.find((item) => item.id === id);
      return { logicalKey, qboAccountId: id, qboAccountName: account?.name ?? id, qboAccountType: account?.accountType ?? "Unknown" };
    });
    void post("saveAccountMappings", { mappings });
  };

  const saveReferences = () => {
    const options = data?.remoteOptions;
    const mappings = Object.entries(referenceSelections).filter(([, id]) => id).map(([key, id]) => {
      const separator = key.indexOf(":"); const mappingType = key.slice(0, separator); const localValue = key.slice(separator + 1);
      const candidates = mappingType === "tax_code" ? options?.taxCodes : mappingType === "term" ? options?.terms : options?.paymentMethods;
      return { mappingType, localValue, qboEntityId: id, qboEntityName: candidates?.find((item) => item.id === id)?.name ?? id };
    });
    void post("saveReferenceMappings", { mappings });
  };

  if (!canAdminister) return <Section title="QuickBooks Online"><div className="workflow-banner"><strong>Administrator access required</strong><span>Only administrators can view company mappings, connect QuickBooks, or operate the accounting sync.</span></div></Section>;
  if (loading && !data) return <Section title="QuickBooks Online"><div className="workflow-empty">Loading QuickBooks integration…</div></Section>;
  const selectedConnection = data?.connections.find((item) => String(item.id) === connectionId);
  const connected = selectedConnection?.status === "connected";
  const deliveryRecords: WorkflowRecord[] = (data?.deliveries ?? []).map((item) => ({
    id: String(item.id), number: String(item.localEntityType).replaceAll("_", " "), party: String(item.operation), reference: String(item.localEntityId),
    status: String(item.status), detail: `${String(item.attempts)} attempt(s)${item.qboEntityId ? ` · QBO ${String(item.qboEntityType)} ${String(item.qboEntityId)}` : ""}${item.lastError ? ` · ${String(item.lastError)}` : ""}`,
    integrationErrorCode: String(item.lastErrorCode ?? ""),
  }));
  const counts = data?.summary?.counts ?? {};

  return <div className="workflow-stack">
    <Section title="QuickBooks Online" detail="PaneFlow remains the inventory source of truth; QBO receives accounting documents and balanced inventory-value journals.">
      {!data?.configuration.configured ? <div className="workflow-banner"><strong>Configuration required</strong><span>{data?.configuration.message ?? "Add the QBO Worker secrets before connecting."}</span></div> : null}
      {!selectedConnection ? <div className="qbo-connect-grid"><label><span>Intuit environment</span><select value={environment} onChange={(event) => setEnvironment(event.target.value as "sandbox" | "production")}><option value="sandbox">Sandbox (recommended for setup)</option><option value="production">Production company</option></select></label><label><span>Backfill accounting activity from</span><input type="date" value={syncFrom} onChange={(event) => setSyncFrom(event.target.value)} /></label><button type="button" className="workflow-action primary" disabled={!canAdminister || !data?.configuration.configured || busy === "connect"} onClick={() => void connect()}>{busy === "connect" ? "Opening Intuit…" : "Connect QuickBooks"}</button><p>Use a QBO Plus or Advanced company if purchase orders must be pushed. Start with a sandbox and verify tax/account mappings before production.</p></div>
      : <div className="qbo-connection-summary"><div><span>Company</span><strong>{String(selectedConnection.companyName)}</strong><small>{String(selectedConnection.environment)} · realm {String(selectedConnection.realmId)} · {String(selectedConnection.homeCurrency)}</small></div><div><span>Status</span><strong>{String(selectedConnection.status)}</strong><small>Initial sync: {String(selectedConnection.initialSyncStatus)}</small></div><div><span>Delivery</span><strong>{Number(counts.succeeded ?? 0)} succeeded</strong><small>{Number(counts.pending ?? 0)} pending · {Number(counts.failed ?? 0)} retrying · {Number(counts.conflict ?? 0)} conflicts</small></div><div className="qbo-actions">{connected ? <><button className="workflow-action primary" disabled={Boolean(busy)} onClick={() => void post("sync", { limit: 100 })}>{busy === "sync" ? "Syncing…" : "Sync now"}</button><button className="workflow-action" disabled={Boolean(busy)} onClick={() => void post("reconcile", { limit: 100 })}>{busy === "reconcile" ? "Checking…" : "Reconcile"}</button><button className="workflow-action" disabled={Boolean(busy)} onClick={() => void load(true, connectionId)}>Refresh QBO lists</button><button className="workflow-action quiet" disabled={Boolean(busy)} onClick={() => { if (window.confirm("Disconnect PaneFlow from this QuickBooks company and revoke its refresh token?")) void post("disconnect"); }}>Disconnect</button></> : <button className="workflow-action primary" disabled={!canAdminister || !data?.configuration.configured || Boolean(busy)} onClick={() => void connect()}>{busy === "connect" ? "Opening Intuit…" : "Reconnect QuickBooks"}</button>}</div></div>}
      {message ? <p className="workflow-banner" role="status">{message}</p> : null}
    </Section>
    {selectedConnection ? <>
      <Section title="Chart-of-accounts mappings" detail="Mappings use immutable QBO account IDs. Choose the exact account for each PaneFlow posting role.">
        {data?.remoteOptions ? <><div className="qbo-mapping-grid">{data.accountRoles.map((role) => <label key={role.key}><span>{role.label}</span><select value={accountSelections[role.key] ?? ""} onChange={(event) => setAccountSelections((current) => ({ ...current, [role.key]: event.target.value }))}><option value="">Not mapped</option>{data.remoteOptions?.accounts.filter((account) => role.types.some((type) => type === account.accountType)).map((account) => <option key={account.id} value={account.id}>{account.name} · {account.accountType}</option>)}</select></label>)}</div><button className="workflow-action primary" disabled={!canAdminister || Boolean(busy)} onClick={saveAccounts}>Save account mappings</button></> : <div className="workflow-empty">Select “Refresh QBO lists” to load the company chart of accounts.</div>}
      </Section>
      <Section title="Tax, terms, and payment methods" detail="Canadian sales-tax codes are company-owned. Map every local value used on a posted document.">
        {data?.remoteOptions ? <><QboReferenceMappingFields data={data} selections={referenceSelections} setSelections={setReferenceSelections} /><button className="workflow-action primary" disabled={!canAdminister || Boolean(busy)} onClick={saveReferences}>Save reference mappings</button></> : <div className="workflow-empty">Refresh QBO lists to map tax codes, payment terms, and payment methods.</div>}
      </Section>
      <Section title="QBO delivery worklist" detail="Conflicts require an administrator to confirm mappings or approve overwriting an external QBO edit from PaneFlow."><RecordTable records={deliveryRecords} columns={["number", "party", "reference", "status", "detail"]} actions={(record) => ["failed", "conflict"].includes(record.status) ? <button className="workflow-action quiet" disabled={Boolean(busy)} onClick={() => void post("retry", { deliveryId: record.id })}>{record.integrationErrorCode === "QBO_EXTERNAL_EDIT" ? "Overwrite from PaneFlow" : "Retry"}</button> : null} /></Section>
    </> : null}
  </div>;
}

function QboReferenceMappingFields({ data, selections, setSelections }: { data: QboAdminState; selections: Record<string, string>; setSelections: Dispatch<SetStateAction<Record<string, string>>> }) {
  const groups = [
    { type: "tax_code", label: "Tax code", locals: data.localReferenceValues.taxCodes, options: data.remoteOptions?.taxCodes ?? [] },
    { type: "term", label: "Payment term", locals: data.localReferenceValues.terms, options: data.remoteOptions?.terms ?? [] },
    { type: "payment_method", label: "Payment method", locals: data.localReferenceValues.paymentMethods, options: data.remoteOptions?.paymentMethods ?? [] },
  ];
  return <div className="qbo-mapping-grid">{groups.flatMap((group) => group.locals.map((local) => { const key = `${group.type}:${local}`; return <label key={key}><span>{group.label}: {local}</span><select value={selections[key] ?? ""} onChange={(event) => setSelections((current) => ({ ...current, [key]: event.target.value }))}><option value="">Not mapped</option>{group.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>; }))}</div>;
}

function IntegrationOutbox({ state, refresh }: { state: WorkflowState; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const retry = async () => {
    setBusy(true); setMessage("");
    try { const response = await fetch("/api/outbox", { method: "POST" }); const result = await response.json() as { message?: string; error?: { message?: string } }; if (!response.ok) throw new Error(result.error?.message ?? "Outbox delivery failed."); setMessage(result.message ?? "Outbox delivery attempted."); await refresh(); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "Outbox delivery failed."); }
    finally { setBusy(false); }
  };
  return <div className="workflow-stack"><QuickBooksIntegration canAdminister={state.permissions.canAdminister === true} /><section className="workflow-banner"><strong>Other transactional integrations</strong><span>Every posting is also committed with a generic outbox event. Configured webhooks are delivered with signatures, retries, and durable failure state.</span><button type="button" disabled={busy || state.permissions.canAdminister !== true} onClick={() => void retry()}>{busy ? "Delivering…" : "Retry webhook deliveries"}</button></section>{message ? <p className="workflow-banner" role="status">{message}</p> : null}<Section title="Generic outbox events"><RecordTable records={state.outbox} columns={["number", "party", "reference", "status", "detail"]} /></Section></div>;
}

function LocationReconciliationPanel({ state, refresh }: { state: WorkflowState; refresh: () => Promise<void> }) {
  const [locationId, setLocationId] = useState(state.orphanedLocations[0]?.id ?? ""); const [warehouseId, setWarehouseId] = useState(state.options.warehouses[0]?.id ?? "");
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [inventoryStatus, setInventoryStatus] = useState("usable"); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); const idempotencyKey = crypto.randomUUID(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ command: "restoreLegacyLocation", entityId: locationId, idempotencyKey, payload: { warehouseId, code, name, inventoryStatus, locationType: inventoryStatus === "quarantine" ? "quarantine" : inventoryStatus === "in_transit" ? "in_transit" : "storage" } }) });
      const result = await response.json() as { message?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Location restoration failed.");
      setMessage(result.message ?? "Legacy location restored."); await refresh(); setLocationId(""); setCode(""); setName("");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Location restoration failed."); }
    finally { setBusy(false); }
  };
  return <div className="workflow-stack"><Section title="Restore a missing location" detail="Balances and movements keep their original location ID, so history is not rewritten.">
    {state.orphanedLocations.length ? <><RecordTable records={state.orphanedLocations} columns={["number", "quantity", "detail", "status"]} /><form className="master-data-form" onSubmit={submit}><OptionField label="Missing location ID" value={locationId} options={state.orphanedLocations.map((record) => ({ id: record.id, label: record.number, detail: record.detail }))} setValue={setLocationId} /><OptionField label="Warehouse" value={warehouseId} options={state.options.warehouses} setValue={setWarehouseId} /><label><span>Restored code</span><input value={code} onChange={(event) => setCode(event.target.value)} required /></label><label><span>Restored name</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label><label><span>Inventory status</span><select value={inventoryStatus} onChange={(event) => setInventoryStatus(event.target.value)}><option value="usable">Usable</option><option value="quarantine">Quarantine</option><option value="damaged">Damaged</option><option value="in_transit">In transit</option><option value="return_pending">Return pending</option></select></label><button className="workflow-action primary" disabled={!state.permissions.canAdminister || busy || !locationId || !warehouseId}>Restore referenced location</button></form></> : <div className="workflow-banner"><strong>Location references are reconciled</strong><span>No inventory balances or movements reference a missing location. Inventory and accounting exports are eligible to run.</span></div>}
    {message ? <p role="status" className="workflow-banner">{message}</p> : null}
  </Section></div>;
}

function UnitsPanel({ state, refresh }: { state: WorkflowState; refresh: () => Promise<void> }) {
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [dimension, setDimension] = useState("quantity"); const [precision, setPrecision] = useState(0);
  const [globalScope, setGlobalScope] = useState(true); const [productId, setProductId] = useState(""); const [fromUomId, setFromUomId] = useState(state.options.uoms[0]?.id ?? ""); const [toUomId, setToUomId] = useState(state.options.uoms[1]?.id ?? state.options.uoms[0]?.id ?? "");
  const [numerator, setNumerator] = useState(1); const [denominator, setDenominator] = useState(1); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const canAdminister = state.permissions.canAdminister === true;
  const selectedFromUomId = fromUomId || state.options.uoms[0]?.id || "";
  const selectedToUomId = toUomId || state.options.uoms[1]?.id || state.options.uoms[0]?.id || "";
  const post = async (command: string, payload: Record<string, unknown>) => {
    const idempotencyKey = crypto.randomUUID(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ command, idempotencyKey, payload }) });
      const result = await response.json() as { message?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Unit configuration failed.");
      setMessage(result.message ?? "Unit configuration saved."); await refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Unit configuration failed."); }
    finally { setBusy(false); }
  };
  const createUnit = (event: FormEvent) => { event.preventDefault(); void post("createUnitOfMeasure", { code, name, dimension, precision }); };
  const createConversion = (event: FormEvent) => { event.preventDefault(); void post("createUomConversion", { productId: globalScope ? undefined : productId, fromUomId: selectedFromUomId, toUomId: selectedToUomId, numerator, denominator, roundingMode: "nearest" }); };
  const unitRecords: WorkflowRecord[] = state.options.uoms.map((unit) => ({ id: unit.id, number: unit.label, status: "Active", detail: `Precision ${String(unit.data?.precision ?? 0)} decimal place(s)` }));
  return <div className="workflow-stack">
    <Section title="Units of measure"><div className="workflow-action-grid">
      <form className="master-data-form" onSubmit={createUnit}><h3>Create unit</h3><label><span>Code</span><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="CASE" required /></label><label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Case" required /></label><label><span>Dimension</span><input value={dimension} onChange={(event) => setDimension(event.target.value.toLowerCase())} placeholder="quantity" required /></label><label><span>Decimal precision</span><input type="number" min="0" max="3" step="1" value={precision} onChange={(event) => setPrecision(Number(event.target.value))} required /></label><button className="workflow-action primary" disabled={!canAdminister || busy}>Create unit</button></form>
      <form className="master-data-form" onSubmit={createConversion}><h3>Create conversion</h3><label><span><input type="checkbox" checked={globalScope} onChange={(event) => setGlobalScope(event.target.checked)} /> Apply to all products in this dimension</span></label>{!globalScope ? <RemoteProductField value={productId} initialOptions={state.options.products} setValue={setProductId} label="Product scope" /> : null}<LookupField quickCreate="uom" kind="uoms" label="Source unit" value={selectedFromUomId} setValue={setFromUomId} initialOptions={state.options.uoms} /><LookupField quickCreate="uom" kind="uoms" label="Destination / base unit" value={selectedToUomId} setValue={setToUomId} initialOptions={state.options.uoms} /><label><span>Destination units (numerator)</span><input type="number" min="1" step="1" value={numerator} onChange={(event) => setNumerator(Number(event.target.value))} required /></label><label><span>Source units (denominator)</span><input type="number" min="1" step="1" value={denominator} onChange={(event) => setDenominator(Number(event.target.value))} required /></label><p className="read-only-label full">Formula: 1 source unit = numerator ÷ denominator destination units.</p><button className="workflow-action primary" disabled={!canAdminister || busy || !selectedFromUomId || !selectedToUomId || selectedFromUomId === selectedToUomId || !globalScope && !productId}>Create conversion</button></form>
    </div>{message ? <p role="status" className="workflow-banner">{message}</p> : null}</Section>
    <Section title="Configured units"><RecordTable records={unitRecords} columns={["number", "detail", "status"]} /></Section>
    <Section title="Conversion rules"><RecordTable records={state.uomConversions} columns={["number", "party", "quantity", "detail", "status"]} /></Section>
  </div>;
}

function MarginMatrixPanel({ state, refresh }: { state: WorkflowState; refresh: () => Promise<void> }) {
  const [mode, setMode] = useState<"create" | "update" | "deactivate">("create");
  const [selectedId, setSelectedId] = useState("");
  const [code, setCode] = useState(""); const [name, setName] = useState("");
  const [scope, setScope] = useState<"global" | "category" | "product">("global"); const [category, setCategory] = useState(""); const [productId, setProductId] = useState("");
  const [minimumCost, setMinimumCost] = useState(0); const [maximumCost, setMaximumCost] = useState(0); const [openEnded, setOpenEnded] = useState(true);
  const [targetMargin, setTargetMargin] = useState(32); const [minimumProfit, setMinimumProfit] = useState(0); const [roundingIncrement, setRoundingIncrement] = useState(1); const [priority, setPriority] = useState(0);
  const [validFrom, setValidFrom] = useState(""); const [validTo, setValidTo] = useState(""); const [reason, setReason] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const selected = state.marginRules.find((rule) => rule.id === selectedId);
  const activeRules = state.marginRules.filter((rule) => rule.status === "Active");
  const chooseRule = (id: string) => {
    setSelectedId(id); const rule = state.marginRules.find((candidate) => candidate.id === id); const row = rule?.data ?? {};
    if (!rule) return;
    setCode(String(row.code ?? "")); setName(String(row.name ?? "")); setMinimumCost(Number(row.minimumCostCents ?? 0) / 100);
    setOpenEnded(row.maximumCostCents == null); setMaximumCost(Number(row.maximumCostCents ?? 0) / 100); setTargetMargin(Number(row.targetMarginBps ?? 0) / 100);
    setMinimumProfit(Number(row.minimumGrossProfitCents ?? 0) / 100); setRoundingIncrement(Number(row.roundingIncrementCents ?? 100) / 100); setPriority(Number(row.priority ?? 0));
    setValidFrom(String(row.validFrom ?? "")); setValidTo(String(row.validTo ?? "")); setProductId(String(row.productId ?? "")); setCategory(String(row.category ?? ""));
    setScope(row.productId ? "product" : row.category ? "category" : "global"); setReason("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); const idempotencyKey = crypto.randomUUID(); setBusy(true); setMessage("");
    const command = mode === "create" ? "createMarginRule" : mode === "update" ? "updateMarginRule" : "deactivateMarginRule";
    const payload = mode === "deactivate" ? { reason } : {
      code, name, productId: scope === "product" ? productId : null, category: scope === "category" ? category.trim() : null,
      minimumCostCents: Math.round(minimumCost * 100), maximumCostCents: openEnded ? null : Math.round(maximumCost * 100), targetMarginBps: Math.round(targetMargin * 100),
      minimumGrossProfitCents: Math.round(minimumProfit * 100), roundingIncrementCents: Math.round(roundingIncrement * 100), priority, validFrom: validFrom || null, validTo: validTo || null,
    };
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ command, idempotencyKey, entityId: mode === "create" ? undefined : selected?.id, version: mode === "create" ? undefined : selected?.version, payload }) });
      const result = await response.json() as { message?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Margin rule change failed.");
      setMessage(result.message ?? "Margin matrix saved."); if (mode === "create") { setCode(""); setName(""); } await refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Margin rule change failed."); }
    finally { setBusy(false); }
  };
  const adoptCatalogDefault = async (event: FormEvent) => {
    event.preventDefault(); const idempotencyKey = crypto.randomUUID(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ command: "adoptMarginMatrixForCatalog", idempotencyKey, payload: {} }) });
      const result = await response.json() as { message?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "The catalog pricing default could not be changed.");
      setMessage(result.message ?? "The margin matrix is now the catalog pricing default."); await refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "The catalog pricing default could not be changed."); }
    finally { setBusy(false); }
  };
  const invalidRange = !openEnded && maximumCost <= minimumCost;
  return <Section title="Automatic margin matrix" detail="Suggested catalog prices use gross margin: price = cost ÷ (1 − margin), rounded up. Product rules win over category rules, which win over global rules.">
    <div className="workflow-action-grid"><form className="master-data-form" onSubmit={submit}>
      <h3>{mode === "create" ? "Create margin rule" : mode === "update" ? "Edit margin rule" : "Deactivate margin rule"}</h3>
      <label><span>Action</span><select value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); setSelectedId(""); }}><option value="create">Create</option><option value="update">Edit</option><option value="deactivate">Deactivate</option></select></label>
      {mode !== "create" ? <label><span>Rule</span><select value={selectedId} onChange={(event) => chooseRule(event.target.value)} required><option value="">Select a rule</option>{(mode === "deactivate" ? activeRules : state.marginRules).map((rule) => <option key={rule.id} value={rule.id}>{rule.number} · {rule.status}</option>)}</select></label> : null}
      {mode === "deactivate" ? <label className="full"><span>Reason</span><input value={reason} onChange={(event) => setReason(event.target.value)} required /></label> : <>
        <label><span>Code</span><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="HARDWARE-LOW" required /></label><label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label><span>Scope</span><select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="global">All products</option><option value="category">Category</option><option value="product">One product</option></select></label>
        {scope === "category" ? <label><span>Category</span><input value={category} onChange={(event) => setCategory(event.target.value)} required /></label> : null}{scope === "product" ? <RemoteProductField value={productId} initialOptions={state.options.products} setValue={setProductId} label="Product" /> : null}
        <label><span>Minimum cost (CAD)</span><input type="number" min="0" step="0.01" value={minimumCost} onChange={(event) => setMinimumCost(Number(event.target.value))} required /></label>
        <label><span><input type="checkbox" checked={openEnded} onChange={(event) => setOpenEnded(event.target.checked)} /> No maximum cost</span>{!openEnded ? <input type="number" min={minimumCost + 0.01} step="0.01" value={maximumCost} onChange={(event) => setMaximumCost(Number(event.target.value))} required /> : null}</label>
        <label><span>Target gross margin (%)</span><input type="number" min="0" max="99.99" step="0.01" value={targetMargin} onChange={(event) => setTargetMargin(Number(event.target.value))} required /></label><label><span>Minimum gross profit (CAD)</span><input type="number" min="0" step="0.01" value={minimumProfit} onChange={(event) => setMinimumProfit(Number(event.target.value))} /></label>
        <label><span>Round price up to (CAD)</span><input type="number" min="0.01" step="0.01" value={roundingIncrement} onChange={(event) => setRoundingIncrement(Number(event.target.value))} required /></label><label><span>Priority</span><input type="number" step="1" value={priority} onChange={(event) => setPriority(Number(event.target.value))} /></label>
        <label><span>Valid from (optional)</span><input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></label><label><span>Valid to (optional)</span><input type="date" value={validTo} onChange={(event) => setValidTo(event.target.value)} /></label>
      </>}
      <button className="workflow-action primary" disabled={!state.permissions.canAdminister || busy || (mode !== "create" && !selected) || (mode === "deactivate" && !reason.trim()) || (mode !== "deactivate" && (!code.trim() || !name.trim() || invalidRange || targetMargin < 0 || targetMargin >= 100 || roundingIncrement <= 0 || (scope === "category" && !category.trim()) || (scope === "product" && !productId)))}>{busy ? "Saving…" : mode === "create" ? "Create rule" : mode === "update" ? "Save rule" : "Deactivate rule"}</button>
    </form>
    <form className="master-data-form" onSubmit={adoptCatalogDefault}>
      <h3>Catalog-wide default</h3>
      <p>Apply these cost-band rules to active catalog items in one step. Existing product-specific manual overrides remain unchanged.</p>
      <p className="read-only-label">Each automatic item uses its last approved purchase-order cost, falling back to standard cost until one exists.</p>
      <button className="workflow-action" disabled={!state.permissions.canAdminister || busy}>{busy ? "Applying…" : "Use matrix for catalog defaults"}</button>
    </form></div>
    {message ? <p role="status" className="workflow-banner">{message}</p> : null}
    <RecordTable records={state.marginRules} columns={["number", "party", "reference", "detail", "status"]} />
  </Section>;
}

function PriceListsPanel({ state, refresh }: { state: WorkflowState; refresh: () => Promise<void> }) {
  const [listMode, setListMode] = useState<"create" | "update">("create"); const [code, setCode] = useState(""); const [name, setName] = useState(""); const [listCurrency, setListCurrency] = useState("CAD"); const [priority, setPriority] = useState(0); const [listValidFrom, setListValidFrom] = useState(""); const [listValidTo, setListValidTo] = useState("");
  const [priceListId, setPriceListId] = useState(state.options.priceLists[0]?.id ?? ""); const [priceListSelection, setPriceListSelection] = useState<SelectOption>();
  const [partnerId, setPartnerId] = useState(state.options.partners.find((option) => option.detail === "customer" || option.detail === "both")?.id ?? "");
  const [productId, setProductId] = useState(state.options.products[0]?.id ?? ""); const [uomId, setUomId] = useState(state.options.uoms[0]?.id ?? "");
  const [assignmentMode, setAssignmentMode] = useState<"create" | "update" | "deactivate">("create"); const [assignmentId, setAssignmentId] = useState(""); const [assignmentSelection, setAssignmentSelection] = useState<SelectOption>(); const [assignmentPriority, setAssignmentPriority] = useState(0); const [assignmentValidFrom, setAssignmentValidFrom] = useState(""); const [assignmentValidTo, setAssignmentValidTo] = useState(""); const [assignmentReason, setAssignmentReason] = useState("");
  const [entryMode, setEntryMode] = useState<"create" | "update" | "deactivate">("create"); const [priceEntryId, setPriceEntryId] = useState(""); const [entrySelection, setEntrySelection] = useState<SelectOption>(); const [minimumQuantity, setMinimumQuantity] = useState(1); const [unitPrice, setUnitPrice] = useState(0); const [entryValidFrom, setEntryValidFrom] = useState(""); const [entryValidTo, setEntryValidTo] = useState(""); const [entryReason, setEntryReason] = useState(""); const [listDeactivationReason, setListDeactivationReason] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const customers = state.options.partners.filter((option) => option.detail === "customer" || option.detail === "both");
  const canAdminister = state.permissions.canAdminister === true;
  const selectedPriceListId = priceListId || state.options.priceLists[0]?.id || "";
  const selectedPartnerId = partnerId || customers[0]?.id || "";
  const selectedProductId = productId || state.options.products[0]?.id || "";
  const selectedUomId = uomId || state.options.uoms[0]?.id || "";
  const selectedPriceList = priceListSelection?.id === selectedPriceListId ? priceListSelection : state.options.priceLists.find((option) => option.id === selectedPriceListId);
  const assignmentInitialOptions = state.priceAssignments.filter((record) => record.status === "Active").map((record) => ({ id: record.id, label: `${record.number} · ${record.party}`, detail: record.reference, version: record.version, data: record.data }));
  const entryInitialOptions = state.priceEntries.filter((record) => record.status === "Active").map((record) => ({ id: record.id, label: record.number, detail: `${record.party} · minimum ${record.quantity}`, version: record.version, data: record.data }));
  // Only the id and version are sent, so any record carrying them can be the optimistic-lock
  // target — callers should not have to fabricate a label to satisfy the parameter.
  const post = async (command: string, payload: Record<string, unknown>, entity?: { id: string; version?: number }) => {
    const idempotencyKey = crypto.randomUUID(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ command, idempotencyKey, entityId: entity?.id, version: entity?.version, payload }) });
      const result = await response.json() as { message?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Pricing change failed.");
      setMessage(result.message ?? "Pricing saved."); await refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Pricing change failed."); }
    finally { setBusy(false); }
  };
  const chooseList = (option: PickerOption) => { const selected = option as SelectOption; setPriceListId(selected.id); setPriceListSelection(selected); const row = selected.data ?? {}; setCode(String(row.code ?? "")); setName(String(row.name ?? "")); setListCurrency(String(row.currency ?? "CAD")); setPriority(Number(row.priority ?? 0)); setListValidFrom(String(row.validFrom ?? "")); setListValidTo(String(row.validTo ?? "")); };
  const submitList = (event: FormEvent) => { event.preventDefault(); void post(listMode === "create" ? "createPriceList" : "updatePriceList", { code, name, currency: listCurrency, priority, validFrom: listValidFrom || null, validTo: listValidTo || null }, listMode === "update" ? selectedPriceList : undefined); };
  const chooseAssignment = (option: PickerOption) => { const selected = option as SelectOption; const row = selected.data ?? {}; setAssignmentId(selected.id); setAssignmentSelection(selected); setPriceListId(String(row.priceListId ?? "")); setPartnerId(String(row.partnerId ?? "")); setAssignmentPriority(Number(row.priority ?? 0)); setAssignmentValidFrom(String(row.validFrom ?? "")); setAssignmentValidTo(String(row.validTo ?? "")); setAssignmentReason(""); };
  const submitAssignment = (event: FormEvent) => { event.preventDefault(); const payload = assignmentMode === "deactivate" ? { reason: assignmentReason } : { priceListId: selectedPriceListId, partnerId: selectedPartnerId, priority: assignmentPriority, validFrom: assignmentValidFrom || null, validTo: assignmentValidTo || null }; const command = assignmentMode === "create" ? "assignPriceList" : assignmentMode === "update" ? "updatePriceListAssignment" : "deactivatePriceListAssignment"; void post(command, payload, assignmentMode === "create" ? undefined : assignmentSelection); };
  const chooseEntry = (option: PickerOption) => { const selected = option as SelectOption; const row = selected.data ?? {}; setPriceEntryId(selected.id); setEntrySelection(selected); setPriceListId(String(row.priceListId ?? "")); setProductId(String(row.productId ?? "")); setUomId(String(row.uomId ?? "")); setMinimumQuantity(Number(row.minimumQuantity ?? 1)); setUnitPrice(Number(row.unitPriceCents ?? 0) / 100); setEntryValidFrom(String(row.validFrom ?? "")); setEntryValidTo(String(row.validTo ?? "")); setEntryReason(""); };
  const submitEntry = (event: FormEvent) => { event.preventDefault(); const payload = entryMode === "deactivate" ? { reason: entryReason } : { priceListId: selectedPriceListId, productId: selectedProductId, uomId: selectedUomId, minimumQuantity, unitPriceCents: Math.round(unitPrice * 100), validFrom: entryValidFrom || null, validTo: entryValidTo || null }; const command = entryMode === "create" ? "createPriceListEntry" : entryMode === "update" ? "updatePriceListEntry" : "deactivatePriceListEntry"; void post(command, payload, entryMode === "create" ? undefined : entrySelection); };
  const deactivateList = (event: FormEvent) => { event.preventDefault(); if (selectedPriceList) void post("deactivatePriceList", { reason: listDeactivationReason }, selectedPriceList); };
  return <div className="workflow-stack">
    <MarginMatrixPanel state={state} refresh={refresh} />
    <Section title="Customer price lists">
      <div className="workflow-action-grid">
        <form className="master-data-form" onSubmit={submitList}><h3>{listMode === "create" ? "Create price list" : "Edit price list"}</h3><label><span>Action</span><select value={listMode} onChange={(event) => setListMode(event.target.value as "create" | "update")}><option value="create">Create</option><option value="update">Edit</option></select></label>{listMode === "update" ? <LookupField kind="priceLists" label="Price list to edit" value={selectedPriceListId} setValue={setPriceListId} onSelect={chooseList} initialOptions={state.options.priceLists} /> : null}<label><span>Code</span><input value={code} onChange={(event) => setCode(event.target.value)} required /></label><label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label><label><span>Currency</span><select value={listCurrency} onChange={(event) => setListCurrency(event.target.value)}><option>CAD</option><option>USD</option><option>EUR</option></select></label><label><span>Priority</span><input type="number" value={priority} onChange={(event) => setPriority(Number(event.target.value))} /></label><label><span>Valid from (optional)</span><input type="date" value={listValidFrom} onChange={(event) => setListValidFrom(event.target.value)} /></label><label><span>Valid to (optional)</span><input type="date" value={listValidTo} onChange={(event) => setListValidTo(event.target.value)} /></label><button className="workflow-action primary" disabled={!canAdminister || busy || (listMode === "update" && !selectedPriceList) || Boolean(listValidFrom && listValidTo && listValidFrom > listValidTo)}>{listMode === "create" ? "Create list" : "Save list changes"}</button></form>
        <form className="master-data-form" onSubmit={submitAssignment}><h3>Customer assignment</h3><label><span>Action</span><select value={assignmentMode} onChange={(event) => { setAssignmentMode(event.target.value as "create" | "update" | "deactivate"); setAssignmentId(""); setAssignmentSelection(undefined); }}><option value="create">Create / reactivate</option><option value="update">Edit</option><option value="deactivate">Deactivate</option></select></label>{assignmentMode !== "create" ? <LookupField kind="priceListAssignments" label="Active assignment" value={assignmentId} setValue={setAssignmentId} initialOptions={assignmentInitialOptions} onSelect={chooseAssignment} /> : null}{assignmentMode !== "deactivate" ? <><LookupField kind="priceLists" label="Price list" value={selectedPriceListId} setValue={setPriceListId} initialOptions={state.options.priceLists} quickCreate="priceList" onCreated={refresh} onSelect={(option) => setPriceListSelection(option as SelectOption)} /><RemotePartnerField label="Customer" role="customer" value={selectedPartnerId} initialOptions={customers} setValue={setPartnerId} quickCreate="customer" onCreated={refresh} /><label><span>Assignment priority</span><input type="number" step="1" value={assignmentPriority} onChange={(event) => setAssignmentPriority(Number(event.target.value))} /></label><label><span>Valid from (optional)</span><input type="date" value={assignmentValidFrom} onChange={(event) => setAssignmentValidFrom(event.target.value)} /></label><label><span>Valid to (optional)</span><input type="date" value={assignmentValidTo} onChange={(event) => setAssignmentValidTo(event.target.value)} /></label></> : <label><span>Reason</span><input value={assignmentReason} onChange={(event) => setAssignmentReason(event.target.value)} required /></label>}<button className="workflow-action primary" disabled={!canAdminister || busy || (assignmentMode === "create" && (!selectedPriceListId || !selectedPartnerId)) || (assignmentMode !== "create" && !assignmentSelection) || (assignmentMode === "deactivate" && !assignmentReason)}>{assignmentMode === "create" ? "Assign customer" : assignmentMode === "update" ? "Save assignment" : "Deactivate assignment"}</button></form>
        <form className="master-data-form" onSubmit={submitEntry}><h3>Contract price</h3><label><span>Action</span><select value={entryMode} onChange={(event) => { setEntryMode(event.target.value as "create" | "update" | "deactivate"); setPriceEntryId(""); setEntrySelection(undefined); }}><option value="create">Create</option><option value="update">Edit</option><option value="deactivate">Deactivate</option></select></label>{entryMode !== "create" ? <LookupField kind="priceListEntries" label="Active contract entry" value={priceEntryId} setValue={setPriceEntryId} initialOptions={entryInitialOptions} onSelect={chooseEntry} /> : null}{entryMode !== "deactivate" ? <><LookupField kind="priceLists" label="Price list" value={selectedPriceListId} setValue={setPriceListId} initialOptions={state.options.priceLists} quickCreate="priceList" onCreated={refresh} onSelect={(option) => setPriceListSelection(option as SelectOption)} /><RemoteProductField value={selectedProductId} initialOptions={state.options.products} setValue={setProductId} quickCreate="product" onCreated={refresh} onSelect={(option) => setUomId(String(option.data?.salesUomId ?? selectedUomId))} /><LookupField quickCreate="uom" kind="uoms" label="Sales UOM" value={selectedUomId} setValue={setUomId} initialOptions={state.options.uoms} /><label><span>Minimum quantity</span><input type="number" min="0.001" step="0.001" value={minimumQuantity} onChange={(event) => setMinimumQuantity(Number(event.target.value))} /></label><label><span>Unit price</span><input type="number" min="0" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(Number(event.target.value))} /></label><label><span>Valid from (optional)</span><input type="date" value={entryValidFrom} onChange={(event) => setEntryValidFrom(event.target.value)} /></label><label><span>Valid to (optional)</span><input type="date" value={entryValidTo} onChange={(event) => setEntryValidTo(event.target.value)} /></label></> : <label><span>Reason</span><input value={entryReason} onChange={(event) => setEntryReason(event.target.value)} required /></label>}<button className="workflow-action primary" disabled={!canAdminister || busy || (entryMode !== "deactivate" && (!selectedPriceListId || !selectedProductId || !selectedUomId || minimumQuantity <= 0)) || (entryMode !== "create" && !entrySelection) || (entryMode === "deactivate" && !entryReason)}>{entryMode === "create" ? "Add price" : entryMode === "update" ? "Save price changes" : "Deactivate price"}</button></form>
        <form className="master-data-form" onSubmit={deactivateList}><h3>Retire price list</h3><LookupField kind="priceLists" label="Price list" value={selectedPriceListId} setValue={setPriceListId} initialOptions={state.options.priceLists} quickCreate="priceList" onCreated={refresh} onSelect={(option) => setPriceListSelection(option as SelectOption)} /><label><span>Reason</span><input value={listDeactivationReason} onChange={(event) => setListDeactivationReason(event.target.value)} required /></label><button className="workflow-action" disabled={!canAdminister || busy || !selectedPriceList || !listDeactivationReason}>Deactivate for future orders</button></form>
      </div>
      {message ? <p role="status" className="workflow-banner">{message}</p> : null}
    </Section>
    <Section title="Contract price entries"><RecordTable records={state.priceEntries} columns={["number", "party", "quantity", "amount", "status"]} /></Section>
    <Section title="Customer assignments"><RecordTable records={state.priceAssignments} columns={["number", "party", "reference", "status"]} /></Section>
  </div>;
}

type MasterKind = "product" | "partner" | "warehouse" | "location" | "asset";
function MasterDataPanel({ state, refresh }: { state: WorkflowState; refresh: () => Promise<void> }) {
  const [kind, setKind] = useState<MasterKind>("product"); const [mode, setMode] = useState("create"); const [selectedId, setSelectedId] = useState(""); const [selectedVersion, setSelectedVersion] = useState(0); const [code, setCode] = useState(""); const [name, setName] = useState(""); const [detail, setDetail] = useState("vendor"); const [warehouseId, setWarehouseId] = useState(state.options.warehouses[0]?.id ?? ""); const [cost, setCost] = useState(0); const [price, setPrice] = useState(0); const [reason, setReason] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [baseUomId, setBaseUomId] = useState(state.options.uoms[0]?.id ?? ""); const [purchaseUomId, setPurchaseUomId] = useState(state.options.uoms[0]?.id ?? ""); const [salesUomId, setSalesUomId] = useState(state.options.uoms[0]?.id ?? "");
  const [manufacturerSku, setManufacturerSku] = useState(""); const [category, setCategory] = useState(""); const [material, setMaterial] = useState(""); const [dimensions, setDimensions] = useState(""); const [finish, setFinish] = useState(""); const [trackingPolicy, setTrackingPolicy] = useState("quantity"); const [inventoryPolicy, setInventoryPolicy] = useState("stocked"); const [reorderPoint, setReorderPoint] = useState(0); const [maxStockLevel, setMaxStockLevel] = useState(0);
  const [email, setEmail] = useState(""); const [phone, setPhone] = useState("");
  const [currency, setCurrency] = useState("CAD"); const [paymentTerms, setPaymentTerms] = useState("Net 30"); const [timezone, setTimezone] = useState("America/Edmonton"); const [inventoryStatus, setInventoryStatus] = useState("usable");
  const [addressLine1, setAddressLine1] = useState(""); const [addressLine2, setAddressLine2] = useState(""); const [city, setCity] = useState(""); const [region, setRegion] = useState(""); const [postalCode, setPostalCode] = useState(""); const [country, setCountry] = useState("CA"); const [creditLimit, setCreditLimit] = useState(0); const [creditHold, setCreditHold] = useState(false);
  const options = kind === "product" ? state.options.products : kind === "partner" ? state.options.partners : kind === "warehouse" ? state.options.warehouses : kind === "location" ? state.options.locations : state.options.assetTypes;
  const masterLookupKind: LookupKind = kind === "partner" ? "partners" : kind === "warehouse" ? "warehouses" : kind === "location" ? "locations" : "assetTypes";
  const commandStem = ({ product: "Product", partner: "BusinessPartner", warehouse: "Warehouse", location: "Location", asset: "ReturnableAssetType" } as const)[kind];
  const resetFields = (nextKind: MasterKind = kind) => { setSelectedId(""); setSelectedVersion(0); setCode(""); setName(""); setDetail(nextKind === "partner" ? "vendor" : nextKind === "location" ? "storage" : ""); setWarehouseId(state.options.warehouses[0]?.id ?? ""); setBaseUomId(state.options.uoms[0]?.id ?? ""); setPurchaseUomId(state.options.uoms[0]?.id ?? ""); setSalesUomId(state.options.uoms[0]?.id ?? ""); setManufacturerSku(""); setCategory(""); setMaterial(""); setDimensions(""); setFinish(""); setTrackingPolicy("quantity"); setInventoryPolicy("stocked"); setReorderPoint(0); setMaxStockLevel(0); setCost(0); setPrice(0); setEmail(""); setPhone(""); setCurrency("CAD"); setPaymentTerms("Net 30"); setTimezone("America/Edmonton"); setInventoryStatus("usable"); setAddressLine1(""); setAddressLine2(""); setCity(""); setRegion(""); setPostalCode(""); setCountry("CA"); setCreditLimit(0); setCreditHold(false); setReason(""); setMessage(""); };
  const selectRecord = (id: string, supplied?: SelectOption) => {
    setSelectedId(id); setMessage("");
    const selected = supplied ?? options.find((item) => item.id === id); const row = selected?.data ?? {};
    setSelectedVersion(selected?.version ?? Number(row.version ?? 0));
    setCode(String(row.sku ?? row.code ?? selected?.label.split(" · ")[0] ?? ""));
    setName(String(row.name ?? selected?.label.split(" · ").at(-1) ?? ""));
    if (kind === "partner") { setDetail(String(row.partnerType ?? selected?.detail ?? "vendor")); setEmail(String(row.email ?? "")); setPhone(String(row.phone ?? "")); setCurrency(String(row.currency ?? "CAD")); setPaymentTerms(String(row.paymentTerms ?? "Net 30")); setAddressLine1(String(row.addressLine1 ?? "")); setAddressLine2(String(row.addressLine2 ?? "")); setCity(String(row.city ?? "")); setRegion(String(row.region ?? "")); setPostalCode(String(row.postalCode ?? "")); setCountry(String(row.country ?? "CA")); setCreditLimit(Number(row.creditLimitCents ?? 0) / 100); setCreditHold(Boolean(row.creditHold)); }
    if (kind === "warehouse") setTimezone(String(row.timezone ?? "America/Edmonton"));
    if (kind === "location") { setDetail(String(row.locationType ?? "storage")); setInventoryStatus(String(row.inventoryStatus ?? "usable")); setWarehouseId(String(row.warehouseId ?? state.options.warehouses[0]?.id ?? "")); }
    if (kind === "product") { setManufacturerSku(String(row.manufacturerSku ?? "")); setCategory(String(row.category ?? "")); setMaterial(String(row.material ?? "")); setDimensions(String(row.dimensions ?? "")); setFinish(String(row.finish ?? "")); setTrackingPolicy(String(row.trackingPolicy ?? "quantity")); setInventoryPolicy(String(row.inventoryPolicy ?? "stocked")); setReorderPoint(Number(row.reorderPoint ?? 0)); setMaxStockLevel(Number(row.maxStockLevel ?? row.reorderPoint ?? 0)); setBaseUomId(String(row.baseUomId ?? state.options.uoms[0]?.id ?? "")); setPurchaseUomId(String(row.purchaseUomId ?? row.baseUomId ?? state.options.uoms[0]?.id ?? "")); setSalesUomId(String(row.salesUomId ?? row.baseUomId ?? state.options.uoms[0]?.id ?? "")); }
    if (kind === "asset") setDetail(String(row.assetClass ?? "rack"));
    setCost(Number(row.standardCostCents ?? row.unitDepositCents ?? 0) / 100);
    setPrice(Number(row.sellingPriceCents ?? 0) / 100);
    setReason("");
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setMessage(""); const selected = options.find((item) => item.id === selectedId) ?? (selectedId ? { id: selectedId, version: selectedVersion } : undefined); if (mode !== "create" && !selected) return setMessage("Select the record to change.");
    const recordPayload = kind === "product" ? { sku: code, manufacturerSku, name, category, material, dimensions, finish, trackingPolicy, inventoryPolicy, standardCostCents: Math.round(cost * 100), sellingPriceCents: Math.round(price * 100), reorderPoint, maxStockLevel, baseUomId, purchaseUomId, salesUomId }
      : kind === "partner" ? { code, name, partnerType: detail, email, phone, currency, paymentTerms, addressLine1, addressLine2, city, region, postalCode, country, creditLimitCents: Math.round(creditLimit * 100), creditHold }
      : kind === "warehouse" ? { code, name, timezone }
      // Status is chosen independently for ordinary bins, but a transit or quarantine location
      // whose status disagrees with its type is unusable: inter-warehouse dispatch matches on
      // location_type='in_transit' AND inventory_status='in_transit', so a mismatched pair
      // creates a location no transfer can ever select. Coerce the two that must agree.
      : kind === "location" ? { code, name, locationType: detail || "storage", inventoryStatus: detail === "in_transit" ? "in_transit" : detail === "quarantine" ? "quarantine" : inventoryStatus, warehouseId }
      : { code, name, assetClass: detail || "rack", unitDepositCents: Math.round(cost * 100) };
    const payload = mode === "deactivate" ? { reason } : recordPayload;
    const idempotencyKey = crypto.randomUUID(); setBusy(true);
    try { const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ command: `${mode}${commandStem}`, entityId: selected?.id, version: selected?.version ?? 0, idempotencyKey, payload }) }); const result = await response.json() as { message?: string; error?: { message?: string } }; if (!response.ok) throw new Error(result.error?.message ?? "Master-data change failed."); setMessage(result.message ?? "Master data saved."); await refresh(); resetFields(); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "Master-data change failed."); } finally { setBusy(false); }
  };
  const permitted = state.permissions.canApprove === true;
  const deactivating = mode === "deactivate";
  if (kind === "product") return <Section title="Product master data"><form className="master-data-form" onSubmit={save}>
    <label><span>Record type</span><select value={kind} onChange={(event) => { const nextKind = event.target.value as MasterKind; setKind(nextKind); resetFields(nextKind); }}><option value="product">Product</option><option value="partner">Vendor / customer</option><option value="warehouse">Warehouse</option><option value="location">Location</option><option value="asset">Returnable asset type</option></select></label>
    <label><span>Action</span><select value={mode} onChange={(event) => { setMode(event.target.value); resetFields(); }}><option value="create">Create</option><option value="update">Edit</option><option value="deactivate">Deactivate</option></select></label>
    {mode !== "create" ? <RemoteProductField label="Existing product" value={selectedId} initialOptions={state.options.products} setValue={setSelectedId} onSelect={(option) => selectRecord(option.id, option)} /> : null}
    <label><span>SKU</span><input value={code} onChange={(event) => setCode(event.target.value)} disabled={deactivating} required /></label>
    <label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} disabled={deactivating} required /></label>
    {!deactivating ? <><label><span>Manufacturer SKU</span><input value={manufacturerSku} onChange={(event) => setManufacturerSku(event.target.value)} /></label><label><span>Category</span><input value={category} onChange={(event) => setCategory(event.target.value)} required /></label><label><span>Material</span><input value={material} onChange={(event) => setMaterial(event.target.value)} required /></label><label><span>Dimensions / configuration</span><input value={dimensions} onChange={(event) => setDimensions(event.target.value)} required /></label><label><span>Finish</span><input value={finish} onChange={(event) => setFinish(event.target.value)} required /></label><label><span>Tracking policy</span><select value={trackingPolicy} onChange={(event) => setTrackingPolicy(event.target.value)}><option value="quantity">Quantity</option><option value="lot">Lot</option><option value="serial">Serial</option></select></label><label><span>Inventory policy</span><select value={inventoryPolicy} onChange={(event) => setInventoryPolicy(event.target.value)}><option value="stocked">Stocked</option><option value="special_order">Special order</option><option value="drop_ship">Drop ship</option></select></label><LookupField quickCreate="uom" kind="uoms" label="Base inventory UOM" value={baseUomId} setValue={setBaseUomId} initialOptions={state.options.uoms} /><LookupField quickCreate="uom" kind="uoms" label="Purchasing UOM" value={purchaseUomId} setValue={setPurchaseUomId} initialOptions={state.options.uoms} /><LookupField quickCreate="uom" kind="uoms" label="Sales UOM" value={salesUomId} setValue={setSalesUomId} initialOptions={state.options.uoms} /><label><span>Standard cost</span><input type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(Number(event.target.value))} required /></label><label><span>Selling price</span><input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(Number(event.target.value))} required /></label><label><span>Reorder point (base UOM)</span><input type="number" min="0" step="0.001" value={reorderPoint} onChange={(event) => { const value = Number(event.target.value); setReorderPoint(value); setMaxStockLevel((current) => Math.max(current, value)); }} required /></label><label><span>Reorder up to (base UOM)</span><input type="number" min={reorderPoint} step="0.001" value={maxStockLevel} onChange={(event) => setMaxStockLevel(Number(event.target.value))} required /></label></> : <label className="full"><span>Deactivation reason</span><input value={reason} onChange={(event) => setReason(event.target.value)} required /></label>}
    {!state.options.uoms.length ? <span className="read-only-label">Create an active unit of measure before creating products.</span> : null}
    <button className="workflow-action primary" type="submit" disabled={!permitted || busy || !deactivating && (!baseUomId || !purchaseUomId || !salesUomId)}>{busy ? "Saving…" : `${mode[0].toUpperCase()}${mode.slice(1)} product`}</button>
    {!permitted ? <span className="read-only-label">Manager approval permission required</span> : null}{message ? <span role="status">{message}</span> : null}
  </form></Section>;
  return <Section title="Master data"><form className="master-data-form" onSubmit={save}><label><span>Record type</span><select value={kind} onChange={(event) => { const nextKind = event.target.value as MasterKind; setKind(nextKind); resetFields(nextKind); }}><option value="product">Product</option><option value="partner">Vendor / customer</option><option value="warehouse">Warehouse</option><option value="location">Location</option><option value="asset">Returnable asset type</option></select></label><label><span>Action</span><select value={mode} onChange={(event) => { setMode(event.target.value); resetFields(); }}><option value="create">Create</option><option value="update">Edit</option><option value="deactivate">Deactivate</option></select></label>{mode !== "create" ? <LookupField kind={masterLookupKind} label="Existing record" value={selectedId} initialOptions={options} setValue={setSelectedId} onSelect={(option) => selectRecord(option.id, option as SelectOption)} /> : null}<label><span>{kind === "partner" ? "Partner code" : "Code"}</span><input value={code} onChange={(event) => setCode(event.target.value)} disabled={deactivating} required /></label><label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} disabled={deactivating} required /></label>{kind === "partner" ? <label><span>Partner type</span><select value={detail} onChange={(event) => setDetail(event.target.value)} disabled={deactivating}><option value="vendor">Vendor</option><option value="customer">Customer</option><option value="both">Both</option></select></label> : null}{kind === "partner" ? <><label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={deactivating} /></label><label><span>Phone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} disabled={deactivating} /></label><label><span>Currency</span><select value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={deactivating}><option>CAD</option><option>USD</option><option>EUR</option></select></label><label><span>Payment terms</span><select value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} disabled={deactivating}>{PAYMENT_TERMS.map((term) => <option key={term}>{term}</option>)}</select></label><label><span>Address line 1</span><input value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} disabled={deactivating} /></label><label><span>Address line 2</span><input value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} disabled={deactivating} /></label><label><span>City</span><input value={city} onChange={(event) => setCity(event.target.value)} disabled={deactivating} /></label><label><span>Province / region</span><input value={region} onChange={(event) => setRegion(event.target.value)} disabled={deactivating} /></label><label><span>Postal code</span><input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} disabled={deactivating} /></label><label><span>Country</span><input value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} disabled={deactivating} /></label><label><span>Credit limit</span><input type="number" min="0" step="0.01" value={creditLimit} onChange={(event) => setCreditLimit(Number(event.target.value))} disabled={deactivating} /></label><label><span><input type="checkbox" checked={creditHold} onChange={(event) => setCreditHold(event.target.checked)} disabled={deactivating} /> Credit hold</span></label></> : null}{kind === "warehouse" && !deactivating ? <label><span>IANA timezone</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Edmonton" required /></label> : null}{kind === "location" ? <><OptionField label="Location type" value={detail} options={locationTypes} setValue={setDetail} disabled={deactivating} /><label><span>Inventory status</span><select value={inventoryStatus} onChange={(event) => setInventoryStatus(event.target.value)} disabled={deactivating}><option value="usable">Usable</option><option value="quarantine">Quarantine</option><option value="damaged">Damaged</option><option value="in_transit">In transit</option><option value="return_pending">Return pending</option></select></label><LookupField kind="warehouses" label="Warehouse" value={warehouseId} initialOptions={state.options.warehouses} setValue={setWarehouseId} /></> : null}{kind === "asset" ? <><label><span>Asset class</span><input value={detail} onChange={(event) => setDetail(event.target.value)} disabled={deactivating} required /></label><label><span>Unit deposit</span><input type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(Number(event.target.value))} disabled={deactivating} required /></label></> : null}{deactivating ? <label className="full"><span>Deactivation reason</span><input value={reason} onChange={(event) => setReason(event.target.value)} required /></label> : null}<button className="workflow-action primary" type="submit" disabled={!permitted || busy}>{busy ? "Saving…" : `${mode[0].toUpperCase()}${mode.slice(1)} ${kind}`}</button>{!permitted ? <span className="read-only-label">Manager approval permission required</span> : null}{message ? <span role="status">{message}</span> : null}</form></Section>;
}

function ActionButton({ children, onClick, disabled, kind = "secondary" }: { children: ReactNode; onClick: () => void; disabled?: boolean; kind?: "primary" | "secondary" | "quiet" }) {
  return <button className={`workflow-action ${kind}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

function PurchaseDrafts({ state, canAction, openAction, onCreateOrder }: { state: WorkflowState; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void; onCreateOrder?: () => void }) {
  const drafts = state.purchaseOrders.filter((item) => workflowStatusIs(item.status, "draft", "rejected"));
  const approved = state.purchaseOrders.filter((item) => item.status.toLowerCase() === "approved");
  const cancelAction = (record: WorkflowRecord) => <ActionButton kind="quiet" disabled={!canAction("cancelPurchaseOrder")} onClick={() => openAction({ kind: "cancelPurchaseOrder", title: `Cancel ${record.number}`, description: "Cancel this unreceived purchasing commitment and release any dedicated customer-demand links.", finalLabel: "Cancel purchase order", record })}>Cancel</ActionButton>;
  return <div className="workflow-stack"><Section title="Draft purchase orders" action={onCreateOrder ? <ActionButton kind="primary" onClick={onCreateOrder}>Create purchase order</ActionButton> : null}><RecordTable records={drafts} columns={["number", "party", "quantity", "amount", "status"]} actions={(record) => <><ActionButton disabled={!canAction("submitPurchaseOrder")} onClick={() => openAction({ kind: "submitPurchaseOrder", title: `Submit ${record.number} for approval`, description: "Freeze the current revision and evaluate purchasing approval policy. Inventory does not move.", finalLabel: "Submit for approval", record })}>Submit</ActionButton>{cancelAction(record)}</>} /></Section><Section title="Approved orders available to amend or cancel"><RecordTable records={approved} columns={["number", "party", "quantity", "amount", "status"]} actions={(record) => <><ActionButton kind="quiet" disabled={!canAction("amendPurchaseOrder")} onClick={() => openAction({ kind: "amendPurchaseOrder", title: `Amend ${record.number}`, description: "Create a new draft revision while retaining the approved revision previously shared with the vendor.", finalLabel: "Create amended revision", record })}>Amend</ActionButton>{cancelAction(record)}</>} /></Section><Section title="Revision history"><RecordTable records={state.revisions} columns={["number", "reference", "party", "amount", "status"]} /></Section>{state.attachments.length ? <AttachmentsPanel records={state.attachments.filter((item) => /PO|RCPT|return/i.test(item.document))} /> : null}</div>;
}

function ApprovalQueue({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <Section title="Purchasing approvals"><RecordCards records={records} renderActions={(record) => <><ActionButton kind="primary" disabled={!canAction("approvePurchaseOrder")} onClick={() => openAction({ kind: "approvePurchaseOrder", title: `Approve ${record.number}`, description: "Approve the commercial commitment and incoming forecast. No physical stock or payable is posted.", finalLabel: "Approve purchase order", record })}>Approve</ActionButton><ActionButton disabled={!canAction("rejectPurchaseOrder")} onClick={() => openAction({ kind: "rejectPurchaseOrder", title: `Reject ${record.number}`, description: "Return this revision to the buyer with a required explanation.", finalLabel: "Reject and return to buyer", record })}>Reject</ActionButton></>} /></Section>;
}

function CountApprovalInbox({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <Section title="Inventory approvals"><RecordCards records={records} renderActions={(record) => {
    const overReceipt = String(record.data?.requestType ?? "") === "over_receipt";
    const approveDescription = overReceipt
      ? `${record.detail ?? "Review the purchase-order line and maximum excess quantity."} Approval authorizes only that exact line and limit; it does not receive stock.`
      : `${record.detail ?? "Review the exact product, location, book quantity, and counted quantity."} No inventory moves until the operator posts the approved count.`;
    const rejectDescription = overReceipt
      ? "Reject this over-receipt request without moving inventory. Receiving above the configured tolerance remains blocked."
      : "Reject this variance without moving inventory. The operator must review and recount before requesting again.";
    return workflowStatusIs(record.status, "pending") ? <><ActionButton kind="primary" disabled={!canAction("approveApproval")} onClick={() => openAction({ kind: "approveApproval", title: `Approve ${record.number}`, description: approveDescription, finalLabel: overReceipt ? "Approve over-receipt limit" : "Approve count variance", record })}>Approve</ActionButton><ActionButton disabled={!canAction("rejectApproval")} onClick={() => openAction({ kind: "rejectApproval", title: `Reject ${record.number}`, description: rejectDescription, finalLabel: overReceipt ? "Reject over-receipt request" : "Reject count variance", record })}>Reject</ActionButton></> : <span className="read-only-label">{record.status} · no decision pending</span>;
  }} /></Section>;
}

function InventoryTransfers({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <div className="workflow-stack"><Section title="Location transfers" action={<ActionButton kind="primary" disabled={!canAction("transferInventory")} onClick={() => openAction({ kind: "transferInventory", title: "Transfer inventory", description: "Move a quantity from one internal location to another. Inter-warehouse transfers remain in transit until the destination receives them.", finalLabel: "Post inventory transfer" })}>New transfer</ActionButton>}><RecordTable records={records} columns={["number", "detail", "reference", "quantity", "status"]} actions={(record) => workflowStatusIs(record.status, "in transit", "partially received") ? <ActionButton kind="primary" disabled={!canAction("receiveTransfer")} onClick={() => openAction({ kind: "receiveTransfer", title: `Receive ${record.number}`, description: "Receive some or all of this in-transit line into its configured destination.", finalLabel: "Post transfer receipt", record })}>Receive transfer</ActionButton> : <span className="read-only-label">No receipt pending</span>} /></Section><section className="workflow-action-grid"><ActionCard title="Change inventory status" impact="On hand unchanged · availability may decrease" action="Change status" disabled={!canAction("changeInventoryStatus")} onClick={() => openAction({ kind: "changeInventoryStatus", title: "Change inventory status", description: "Move stock between inventory statuses and keep the movement traceable.", finalLabel: "Post status change" })} /><ActionCard title="Scrap inventory" impact="On hand decreases · valuation expense posted" action="Post scrap" disabled={!canAction("scrapInventory")} tone="danger" onClick={() => openAction({ kind: "scrapInventory", title: "Scrap inventory", description: "This stock-changing correction removes goods from internal inventory.", finalLabel: "Post scrap movement" })} /><ActionCard title="Request over-receipt approval" impact="No stock moves · approval scope is fixed to one PO line" action="Request approval" disabled={!canAction("requestOverReceiptApproval")} onClick={() => openAction({ kind: "requestOverReceiptApproval", title: "Request over-receipt approval", description: "Request manager approval for a precise purchase-order line and maximum excess quantity before receiving it.", finalLabel: "Request manager approval" })} /></section></div>;
}

function Traceability({ units, state, canAction, openAction }: { units: TraceUnit[]; state: WorkflowState; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filtered = units.filter((unit) => `${unit.id} ${unit.sku} ${unit.serial} ${unit.lot} ${unit.customer ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / WORKFLOW_PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * WORKFLOW_PAGE_SIZE, currentPage * WORKFLOW_PAGE_SIZE);
  return <Section title="Lot, serial, and unit traceability" action={<ActionButton kind="primary" disabled={!canAction("registerInventoryIdentity") || !state.options.products.length || !state.options.locations.length} onClick={() => openAction({ kind: "registerInventoryIdentity", title: "Register inventory identity", description: "Register a lot or serial identity against inventory that already exists at a durable location.", finalLabel: "Register identity" })}>Register lot / serial</ActionButton>}><div className="trace-search"><label><span>Find unit, serial, lot, SKU, or customer</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="e.g. AW-24-900183" /></label></div><div className="trace-grid">{visible.map((unit) => <article key={unit.id} className="trace-card"><div className="trace-code">{unit.id}</div><div><span className="workflow-kicker">{unit.sku}</span><h3>{unit.serial}</h3><p>{unit.lot} · Received {unit.receivedOn}</p></div><StatusPill>{unit.status}</StatusPill><dl><div><dt>Current location</dt><dd>{unit.location}</dd></div><div><dt>Source</dt><dd>{unit.source}</dd></div><div><dt>Allocation</dt><dd>{unit.customer ?? "Unallocated"}</dd></div></dl></article>)}{!filtered.length ? <div className="workflow-empty">No traceable units match your search.</div> : null}</div><LocalPager label="Traceability pages" page={currentPage} pages={pages} setPage={setPage} /></Section>;
}

function Valuation({ records, policies, totals, canAction, openAction }: { records: WorkflowRecord[]; policies: WorkflowRecord[]; totals: WorkflowState["totals"]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  // These read whole-database totals, not `records`, which is only the page of cost layers
  // below and understates inventory value by roughly the number of pages.
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  return <div className="workflow-stack"><div className="workflow-metrics"><article><span>Inventory value</span><strong>{cad.format(totals.inventoryValueCents / 100)}</strong><small>All posted value entries</small></article><article><span>Landed cost allocated</span><strong>{cad.format(totals.landedCostAllocatedCents / 100)}</strong><small>{plural(totals.landedCostAllocationCount, "allocation")}</small></article><article><span>Scrap this month</span><strong>{cad.format(totals.scrapValueCents / 100)}</strong><small>{plural(totals.scrapEntryCount, "posted adjustment")}</small></article></div><Section title="Valuation policy" action={<ActionButton kind="primary" disabled={!canAction("setValuationPolicy")} onClick={() => openAction({ kind: "setValuationPolicy", title: "Set product valuation policy", description: "Create or update the valuation method used by future receipts and consumption. Existing immutable value entries do not change.", finalLabel: "Save valuation policy" })}>Set product policy</ActionButton>}><RecordTable records={policies} columns={["number", "status", "amount", "detail"]} actions={(record) => <ActionButton disabled={!canAction("setValuationPolicy")} onClick={() => openAction({ kind: "setValuationPolicy", title: `Set valuation policy for ${record.number}`, description: "Change how future receipts and consumption value this product. Existing immutable value entries do not change.", finalLabel: "Save valuation policy", record })}>Change policy</ActionButton>} /></Section><Section title="Inventory valuation" action={<ActionButton kind="primary" disabled={!canAction("allocateLandedCost")} onClick={() => openAction({ kind: "allocateLandedCost", title: "Allocate landed cost", description: "Allocate freight or duty across received inventory without moving physical stock.", finalLabel: "Post landed-cost allocation" })}>Allocate landed cost</ActionButton>}><RecordTable records={records} columns={["number", "status", "quantity", "amount", "detail"]} /></Section></div>;
}

function Reservations({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <Section title="Reservation ledger"><RecordTable records={records} columns={["number", "party", "reference", "quantity", "status"]} actions={(record) => workflowStatusIs(record.status, "active") ? <><ActionButton disabled={!canAction("releaseReservation")} onClick={() => openAction({ kind: "releaseReservation", title: `Release ${record.number}`, description: "Return reserved quantity to availability. On hand and financial balances do not change.", finalLabel: "Release reservation", record })}>Release</ActionButton><ActionButton kind="quiet" disabled={!canAction("reallocateReservation")} onClick={() => openAction({ kind: "reallocateReservation", title: `Reallocate ${record.number}`, description: "Move this allocation to another demand line with a recorded reason.", finalLabel: "Reallocate inventory", record })}>Reallocate</ActionButton></> : <span className="read-only-label">No active quantity</span>} /></Section>;
}

function SalesLifecycle({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  // The optimistic-lock version is a concurrency detail the server enforces, not something a
  // rep reads off a worklist. What they need is the customer and what the order is worth.
  return <Section title="Sales-order lifecycle"><RecordTable records={records.filter((record) => workflowStatusIs(record.status, "draft", "confirmed"))} columns={["number", "party", "quantity", "amount", "status"]} actions={(record) => workflowStatusIs(record.status, "draft") ? <><ActionButton kind="primary" disabled={!canAction("confirmSalesOrder")} onClick={() => openAction({ kind: "confirmSalesOrder", title: `Confirm ${record.number}`, description: "Activate open stock lines as customer demand without reserving, shipping, or invoicing.", finalLabel: "Confirm sales order", record })}>Confirm</ActionButton><ActionButton kind="quiet" disabled={!canAction("cancelSalesOrder")} onClick={() => openAction({ kind: "cancelSalesOrder", title: `Cancel ${record.number}`, description: "Cancel remaining demand; no stock movement or invoice is created.", finalLabel: "Cancel sales order", record })}>Cancel</ActionButton></> : <ActionButton kind="quiet" disabled={!canAction("cancelSalesOrder")} onClick={() => openAction({ kind: "cancelSalesOrder", title: `Cancel ${record.number}`, description: "Release remaining demand and active reservations without moving physical stock.", finalLabel: "Cancel remaining demand", record })}>Cancel remaining</ActionButton>} /></Section>;
}

function ShipmentCorrections({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <Section title="Posted shipments"><RecordTable records={records} columns={["number", "party", "reference", "quantity", "status"]} actions={(record) => (record.quantity ?? 0) > 0 ? <ActionButton disabled={!canAction("reverseShipment")} onClick={() => openAction({ kind: "reverseShipment", title: `Reverse ${record.number}`, description: "Create a linked correction that returns physical quantity to a controlled internal status.", finalLabel: "Post shipment reversal", record })}>Reverse shipment line</ActionButton> : <span className="read-only-label">Fully reversed</span>} /></Section>;
}

function DropShipDeliveries({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <div className="workflow-stack"><section className="workflow-action-grid"><ActionCard title="Post supplier delivery" impact="Customer fulfillment increases · internal on-hand unchanged" action="Post delivery" disabled={!canAction("postDropShipDelivery")} onClick={() => openAction({ kind: "postDropShipDelivery", title: "Post drop-ship delivery", description: "Record proof that the supplier delivered to the customer. No internal warehouse inventory is created.", finalLabel: "Post drop-ship delivery" })} /></section><Section title="Drop-ship delivery ledger"><RecordTable records={records} columns={["number", "reference", "quantity", "status", "detail"]} actions={(record) => <ActionButton disabled={!canAction("reverseDropShipDelivery") || !workflowStatusIs(record.status, "posted", "partially reversed") || (record.quantity ?? 0) <= 0} onClick={() => openAction({ kind: "reverseDropShipDelivery", title: `Reverse ${record.number}`, description: "Correct externally delivered quantity without changing internal inventory.", finalLabel: "Post delivery reversal", record })}>Reverse delivery</ActionButton>} /></Section></div>;
}

function VendorMatching({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  // The tab is named after exceptions, so it holds exceptions. It used to list every bill in the
  // workspace, which meant paging through hundreds of "Matched · no action needed" cards that
  // duplicated the Bills tab to find the handful that actually needed a decision.
  const exceptions = records.filter((record) => Boolean(record.exception) || /hold|exception|variance/i.test(record.status));
  return <div className="workflow-stack"><Section title="Vendor bills and three-way match"><RecordCards records={exceptions} renderActions={(record) => <ActionButton kind="primary" disabled={!canAction("resolveMatchException")} onClick={() => openAction({ kind: "resolveMatchException", title: `Resolve ${record.number}`, description: "Choose how to resolve the quantity, price, or unplanned-charge difference.", finalLabel: "Resolve match exception", record })}>Resolve exception</ActionButton>} />{!exceptions.length ? <div className="workflow-empty">Every vendor bill in this workspace matches its purchase order and receipts.</div> : null}</Section></div>;
}

function VendorBillingActions({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <Section title="Vendor bill corrections and settlement"><RecordTable records={records} columns={["number", "party", "reference", "issuedOn", "dueOn", "amount", "status", "detail"]} actions={(record) => {
    const settled = documentStatusIsSettled(record.status);
    const held = Boolean(record.exception) || /hold/i.test(record.status);
    if (settled) return <span className="read-only-label">Settled</span>;
    return <>
      {held ? <ActionButton disabled={!canAction("approveVendorBill")} onClick={() => openAction({ kind: "approveVendorBill", title: `Approve ${record.number}`, description: "Approve this match exception and release the payable from hold.", finalLabel: "Approve bill exception", record })}>Approve exception</ActionButton> : null}
      <ActionButton disabled={held || !canAction("createVendorCredit")} onClick={() => openAction({ kind: "createVendorCredit", title: `Credit ${record.number}`, description: "Post a vendor credit against the remaining payable without moving stock.", finalLabel: "Post vendor credit", record })}>Credit</ActionButton>
      <ActionButton disabled={held || !canAction("recordVendorPayment")} onClick={() => openAction({ kind: "recordVendorPayment", title: `Pay ${record.number}`, description: "Record an outbound payment against this payable.", finalLabel: "Record vendor payment", record })}>Pay</ActionButton>
      <ActionButton kind="quiet" disabled={!canAction("addDocumentCharge")} onClick={() => openAction({ kind: "addDocumentCharge", title: `Add charge to ${record.number}`, description: "Add a durable fee, freight, discount, or deposit line and recalculate the bill total.", finalLabel: "Add bill charge", record: { ...record, data: { ...record.data, documentType: "vendor_bill" } } })}>Add charge</ActionButton>
      {held ? <span className="read-only-label">Credit and payment remain blocked until the match hold is approved.</span> : null}
    </>;
  }} /></Section>;
}

function CustomerBilling({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <div className="workflow-stack"><section className="workflow-action-grid"><ActionCard title="Invoice posted shipment" impact="Posts the receivable immediately · inventory unchanged" action="Create & post invoice" disabled={!canAction("createCustomerInvoice")} onClick={() => openAction({ kind: "createCustomerInvoice", title: "Create and post invoice from shipment", description: "Post eligible shipped quantities directly as a customer receivable without changing inventory.", finalLabel: "Create & post customer invoice" })} /></section><Section title="Invoice corrections and settlement"><RecordTable records={records} columns={["number", "party", "reference", "issuedOn", "dueOn", "amount", "status", "detail"]} actions={(record) => <>
    <EmailDocumentButton documentType="customer_invoice" documentId={record.id} documentNumber={record.number} disabled={!canAction("recordCustomerPayment")} className="workflow-action secondary">Email invoice</EmailDocumentButton>
    {!documentStatusIsSettled(record.status) ? <><ActionButton disabled={!canAction("issueCustomerCredit")} onClick={() => openAction({ kind: "issueCustomerCredit", title: `Credit ${record.number}`, description: "Reduce the outstanding receivable. This command does not return stock.", finalLabel: "Issue customer credit", record })}>Credit</ActionButton><ActionButton disabled={!canAction("recordCustomerPayment")} onClick={() => openAction({ kind: "recordCustomerPayment", title: `Record payment for ${record.number}`, description: "Apply a payment to this invoice with an auditable reference.", finalLabel: "Record payment", record })}>Payment</ActionButton><ActionButton kind="quiet" disabled={!canAction("addDocumentCharge")} onClick={() => openAction({ kind: "addDocumentCharge", title: `Add charge to ${record.number}`, description: "Add a durable fee, discount, freight, or deposit and recalculate the invoice.", finalLabel: "Add invoice charge", record: { ...record, data: { ...record.data, documentType: "customer_invoice" } } })}>Add charge</ActionButton><ActionButton kind="quiet" disabled={documentHasSettlement(record) || !canAction("voidCustomerInvoice")} onClick={() => openAction({ kind: "voidCustomerInvoice", title: `Void ${record.number}`, description: "Void an entirely unpaid and uncredited invoice. Its source quantities become invoiceable again.", finalLabel: "Void customer invoice", record })}>Void</ActionButton></> : <span className="read-only-label">Settled</span>}
  </>} /></Section></div>;
}

function Returnables({ records, canAction, openAction }: { records: AssetRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <div className="workflow-stack"><section className="workflow-action-grid"><ActionCard title="Issue returnable asset" impact="Asset custody changes · deposit receipt posts" action="Issue asset" disabled={!canAction("issueReturnableAsset")} onClick={() => openAction({ kind: "issueReturnableAsset", title: "Issue returnable asset", description: "Assign custody and post the refundable deposit collected from the customer.", finalLabel: "Issue asset and post deposit" })} /></section><Section title="Returnable assets and deposits"><RecordCards records={records} renderActions={(record) => <><ActionButton disabled={!canAction("returnReturnableAsset") || (record.quantity ?? 0) <= 0} onClick={() => openAction({ kind: "returnReturnableAsset", title: `Return ${record.number}`, description: "Record the asset physically returned. Deposit refund remains a separate financial action.", finalLabel: "Record asset return", record })}>Record return</ActionButton><ActionButton kind="quiet" disabled={!canAction("forfeitReturnableAsset") || (record.quantity ?? 0) <= 0} onClick={() => openAction({ kind: "forfeitReturnableAsset", title: `Forfeit ${record.number}`, description: "Close the outstanding asset and recognize its deposit as forfeited.", finalLabel: "Forfeit asset deposit", record })}>Forfeit</ActionButton><ActionButton kind="quiet" disabled={!canAction("refundAssetDeposit") || (record.amount ?? 0) <= 0} onClick={() => openAction({ kind: "refundAssetDeposit", title: `Refund deposit for ${record.number}`, description: "Issue the refundable deposit after the physical return has been recorded.", finalLabel: "Refund customer deposit", record })}>Refund deposit</ActionButton></>} /></Section></div>;
}

function AuditTimeline({ state }: { state: WorkflowState }) {
  const { audit: records, attachments } = state;
  const [category, setCategory] = useState("All");
  const [page, setPage] = useState(1);
  const visible = category === "All" ? records : records.filter((record) => record.category.includes(category));
  const pages = Math.max(1, Math.ceil(visible.length / WORKFLOW_PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageRecords = visible.slice((currentPage - 1) * WORKFLOW_PAGE_SIZE, currentPage * WORKFLOW_PAGE_SIZE);
  return <div className="workflow-stack"><Section title="Unified audit timeline"><div className="audit-filters" role="group" aria-label="Audit category">{["All", "Commercial", "Physical", "Financial"].map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => { setCategory(item); setPage(1); }}>{item}</button>)}</div><ol className="audit-timeline">{pageRecords.map((record) => <li key={record.id}><span className="audit-dot" /><div><span className="workflow-kicker">{record.category} · {record.time}</span><h3>{record.action} · {record.record}</h3><p>{record.impact}</p><small title={record.actor}>Actor: {actorName(record.actor)} · Source relationship: {record.record}</small></div></li>)}</ol>{!visible.length ? <div className="workflow-empty">No audit events match this category.</div> : null}<LocalPager label="Audit timeline pages" page={currentPage} pages={pages} setPage={setPage} /></Section><AttachmentsPanel records={attachments} state={state} /></div>;
}

function Policies({ records, user, canAction, openAction }: { records: PolicyRecord[]; user: CurrentUser; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <div className="workflow-stack"><section className="current-user-card"><div className="user-avatar" aria-hidden="true">{user.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div><div><span className="workflow-kicker">Current user and role</span><h2>{user.name}</h2><p>{user.role}</p></div><ul aria-label="Granted permission groups">{user.permissions.map((permission) => <li key={permission}>✓ {permission}</li>)}</ul></section><Section title="System policies"><div className="policy-grid">{records.map((record) => <article key={record.id}><div><span className="workflow-kicker">{record.risk}</span><h3>{record.name}</h3><p>{record.description}</p></div><strong>{record.value}</strong><ActionButton disabled={!canAction("updatePolicy")} onClick={() => openAction({ kind: "updatePolicy", title: `Change ${record.name}`, description: `${record.description} Existing posted records will not be changed.`, finalLabel: "Save policy for future transactions", record })}>{canAction("updatePolicy") ? "Review change" : "Not permitted"}</ActionButton></article>)}</div></Section></div>;
}

function AttachmentsPanel({ records, state }: { records: AttachmentRecord[]; state?: WorkflowState }) {
  const [items, setItems] = useState(records);
  const [documentType, setDocumentType] = useState<"purchase_order" | "sales_order" | "vendor_bill" | "customer_invoice">("purchase_order");
  const [documentId, setDocumentId] = useState("");
  const [category, setCategory] = useState("document");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canManage = state?.permissions.canOperate === true;
  const upload = async (event: FormEvent) => {
    event.preventDefault(); setMessage("");
    if (!file || !documentId) return setMessage("Choose a durable document and file.");
    if (file.size > 10 * 1024 * 1024) return setMessage("File exceeds the 10 MB limit.");
    const form = new FormData(); form.set("documentType", documentType); form.set("documentId", documentId); form.set("category", category); form.set("file", file);
    setBusy(true);
    try {
      const response = await fetch("/api/attachments", { method: "POST", body: form });
      const result = await response.json() as { attachment?: Record<string, unknown>; message?: string; error?: { message?: string } };
      if (!response.ok || !result.attachment) throw new Error(result.error?.message ?? "Upload failed.");
      const row = result.attachment; const attachment: AttachmentRecord = { id: String(row.id), fileName: String(row.fileName), type: String(row.category), document: `${row.documentType} · ${row.documentId}`, status: "Stored", uploadedBy: String(row.ownerEmail), time: String(row.uploadedAt), href: `/api/attachments/${encodeURIComponent(String(row.id))}`, ownerId: String(row.ownerId), documentType: String(row.documentType), documentId: String(row.documentId) };
      setItems((current) => [attachment, ...current]); setFile(null); setMessage(result.message ?? "Attachment uploaded.");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Upload failed."); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setMessage(""); setBusy(true);
    try { const response = await fetch(`/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE" }); const result = await response.json() as { message?: string; error?: { message?: string } }; if (!response.ok) throw new Error(result.error?.message ?? "Remove failed."); setItems((current) => current.filter((item) => item.id !== id)); setMessage(result.message ?? "Attachment removed."); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "Remove failed."); } finally { setBusy(false); }
  };
  const lookupKind: LookupKind = documentType === "purchase_order" ? "purchaseOrders" : documentType === "sales_order" ? "salesOrders" : documentType === "vendor_bill" ? "vendorBills" : "customerInvoices";
  return <Section title="Attachments">{state ? <form className="attachment-upload" onSubmit={upload}><label><span>Document type</span><select value={documentType} onChange={(event) => { setDocumentType(event.target.value as typeof documentType); setDocumentId(""); }}><option value="purchase_order">Purchase order</option><option value="sales_order">Sales order</option><option value="vendor_bill">Vendor bill</option><option value="customer_invoice">Customer invoice</option></select></label><LookupField kind={lookupKind} label="Document" value={documentId} setValue={setDocumentId} /><OptionField label="Category" value={category} options={attachmentCategories} setValue={setCategory} /><label><span>File (PDF, JPEG, PNG, WebP; 10 MB max)</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={!canManage || busy} required /></label><button className="workflow-action primary" type="submit" disabled={!canManage || busy || !documentId || !file}>{busy ? "Uploading…" : "Upload attachment"}</button>{!canManage ? <span className="read-only-label">Operational posting permission required</span> : null}{message ? <span role="status">{message}</span> : null}</form> : null}<div className="attachment-list">{items.map((record) => { const canRemove = canManage && (record.ownerId === state?.currentUser.id || /manager|administrator/i.test(state?.currentUser.role ?? "")); return <article key={record.id}><span className="attachment-type" aria-hidden="true">{record.type.includes("photo") ? "IMG" : "FILE"}</span><div><h3>{record.fileName}</h3><p>{record.type} · {record.document}</p><small>{record.uploadedBy} · {record.time}</small></div><StatusPill>{record.status}</StatusPill><a href={record.href ?? `/api/attachments/${encodeURIComponent(record.id)}`} target="_blank" rel="noreferrer">Open file</a>{canRemove ? <button className="workflow-action quiet" type="button" disabled={busy} onClick={() => void remove(record.id)}>Remove</button> : null}</article>; })}{!items.length ? <div className="workflow-empty">No attachments yet.</div> : null}</div></Section>;
}

const WORKFLOW_PAGE_SIZE = 50;

function LocalPager({ label, page, pages, setPage }: { label: string; page: number; pages: number; setPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return <nav className="snapshot-pagination" aria-label={label}><button className="button secondary" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}>Previous</button><span>Page {page} of {pages}</span><button className="button secondary" disabled={page >= pages} onClick={() => setPage(Math.min(pages, page + 1))}>Next</button></nav>;
}

function RecordTable({ records, columns, actions }: { records: WorkflowRecord[]; columns: Array<keyof WorkflowRecord>; actions?: (record: WorkflowRecord) => ReactNode }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ column: keyof WorkflowRecord; direction: "asc" | "desc" } | null>(null);
  const sortedRecords = useMemo(() => {
    if (!sort) return records;
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...records].sort((left, right) => {
      const leftValue = left[sort.column];
      const rightValue = right[sort.column];
      if (typeof leftValue === "number" && typeof rightValue === "number") return (leftValue - rightValue) * direction;
      return String(leftValue ?? "").localeCompare(String(rightValue ?? ""), undefined, { numeric: true, sensitivity: "base" }) * direction;
    });
  }, [records, sort]);
  const pages = Math.max(1, Math.ceil(records.length / WORKFLOW_PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = sortedRecords.slice((currentPage - 1) * WORKFLOW_PAGE_SIZE, currentPage * WORKFLOW_PAGE_SIZE);
  const changeSort = (column: keyof WorkflowRecord) => {
    setPage(1);
    setSort((current) => ({ column, direction: current?.column === column && current.direction === "asc" ? "desc" : "asc" }));
  };
  return <><div className="workflow-table-wrap"><table className="workflow-table"><caption className="sr-only">Operational records</caption><thead><tr>{columns.map((column) => {
    const activeDirection = sort?.column === column ? sort.direction : null;
    return <th key={column} aria-sort={activeDirection === "asc" ? "ascending" : activeDirection === "desc" ? "descending" : "none"}><button type="button" className="sortable-heading" onClick={() => changeSort(column)}><span>{columnLabel(column)}</span><span className={`sort-indicator ${activeDirection ? "active" : ""}`} aria-hidden="true">{activeDirection === "asc" ? "↑" : activeDirection === "desc" ? "↓" : "↕"}</span></button></th>;
  })}{actions ? <th><span className="sr-only">Actions</span></th> : null}</tr></thead><tbody>{visible.map((record) => <tr key={record.id}>{columns.map((column) => <td key={column}>{renderRecordValue(column, record[column], record.currency)}</td>)}{actions ? <td><div className="workflow-row-actions">{actions(record)}</div></td> : null}</tr>)}{!records.length ? <tr><td colSpan={columns.length + (actions ? 1 : 0)}><div className="workflow-empty">No records in this view.</div></td></tr> : null}</tbody></table></div><LocalPager label="Operational record pages" page={currentPage} pages={pages} setPage={setPage} /></>;
}

function RecordCards<T extends WorkflowRecord>({ records, renderActions }: { records: T[]; renderActions: (record: T) => ReactNode }) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(records.length / WORKFLOW_PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = records.slice((currentPage - 1) * WORKFLOW_PAGE_SIZE, currentPage * WORKFLOW_PAGE_SIZE);
  return <><div className="workflow-record-cards">{visible.map((record) => <article key={record.id}><header><div><span className="workflow-kicker">{record.reference ?? record.status}</span><h3>{record.number}</h3><p>{record.party}</p></div><StatusPill>{record.status}</StatusPill></header>{record.exception || record.detail ? <div className={`record-callout ${record.exception ? "warning" : "neutral"}`}>{record.exception ?? record.detail}</div> : null}
    {/* The note the buyer was required to type when submitting. Requiring a justification and
        then hiding it from the person deciding made the requirement decorative. */}
    {record.note ? <blockquote className="record-note">“{record.note}”</blockquote> : null}
    <dl>{record.requester ? <div><dt>Requested by</dt><dd>{record.requester}</dd></div> : null}{record.issuedOn ? <div><dt>Raised</dt><dd>{formatWorkflowDate(record.issuedOn)}</dd></div> : null}{record.dueOn ? <div><dt>Expected</dt><dd>{formatWorkflowDate(record.dueOn)}</dd></div> : null}{/* Omitted rather than dashed when a record type does not carry them: a vendor bill has
    no quantity or revision, so every card printed two empty rows between the dates and
    the amount, which is the field the reader came for. */}{record.quantity === undefined ? null : <div><dt>Quantity</dt><dd>{record.quantity}</dd></div>}{record.amount === undefined ? null : <div><dt>Amount</dt><dd>{formatWorkflowMoney(record.amount, record.currency)}</dd></div>}{record.revision === undefined ? null : <div><dt>Revision</dt><dd>{record.revision}</dd></div>}</dl>
    {record.lines?.length ? <RecordLinesTable lines={record.lines} currency={record.currency} recordNumber={record.number} /> : null}
    <footer>{renderActions(record)}</footer></article>)}</div><LocalPager label="Workflow record pages" page={currentPage} pages={pages} setPage={setPage} /></>;
}

function ActionCard({ title, detail, impact, action, onClick, disabled, tone = "neutral" }: { title: string; detail?: string; impact: string; action: string; onClick: () => void; disabled?: boolean; tone?: Tone }) {
  return <article className={`workflow-action-card ${tone}`}><h3>{title}</h3>{detail ? <p>{detail}</p> : null}<strong>{impact}</strong><ActionButton kind={tone === "danger" ? "secondary" : "primary"} onClick={onClick} disabled={disabled}>{action}</ActionButton></article>;
}

function RecordLinesTable({ lines, currency, recordNumber }: { lines: NonNullable<WorkflowRecord["lines"]>; currency?: string; recordNumber: string }) {
  const [sort, setSort] = useState<{ column: "item" | "quantity" | "unit" | "amount"; direction: "asc" | "desc" } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return lines;
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...lines].sort((left, right) => {
      const leftValue = sort.column === "item" ? `${left.sku} ${left.product}` : sort.column === "quantity" ? left.quantity : sort.column === "unit" ? left.unitAmount : left.amount;
      const rightValue = sort.column === "item" ? `${right.sku} ${right.product}` : sort.column === "quantity" ? right.quantity : sort.column === "unit" ? right.unitAmount : right.amount;
      return (typeof leftValue === "number" && typeof rightValue === "number" ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" })) * direction;
    });
  }, [lines, sort]);
  const heading = (label: string, column: "item" | "quantity" | "unit" | "amount") => {
    const active = sort?.column === column ? sort.direction : null;
    return <th aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"}><button type="button" className="sortable-heading" onClick={() => setSort({ column, direction: active === "asc" ? "desc" : "asc" })}><span>{label}</span><span className={`sort-indicator ${active ? "active" : ""}`} aria-hidden="true">{active === "asc" ? "↑" : active === "desc" ? "↓" : "↕"}</span></button></th>;
  };
  return <table className="record-lines"><caption className="sr-only">Lines on {recordNumber}</caption><thead><tr>{heading("Item", "item")}{heading("Qty", "quantity")}{heading("Unit", "unit")}{heading("Amount", "amount")}</tr></thead><tbody>{rows.map((line) => <tr key={line.id}><td><strong>{line.sku}</strong><span>{line.product}</span></td><td>{line.quantity}</td><td>{formatWorkflowMoney(line.unitAmount, currency)}</td><td>{formatWorkflowMoney(line.amount, currency)}</td></tr>)}</tbody></table>;
}

function StatusPill({ children }: { children: ReactNode }) {
  const label = String(children);
  const tone = /exception|hold|due|pending|partial/i.test(label) ? "warning" : /approved|matched|ready|posted|returned/i.test(label) ? "success" : "neutral";
  return <span className={`workflow-status ${tone}`}><span aria-hidden="true" />{children}</span>;
}

function documentOutstandingAmount(record?: ActionRecord) {
  const data = record?.data ?? {};
  const value = (...keys: string[]) => Number(keys.map((key) => data[key]).find((item) => item !== undefined && item !== null) ?? 0);
  return Math.max(value("total_cents", "totalCents") - value("paid_cents", "paidCents") - value("credited_cents", "creditedCents"), 0) / 100;
}

function documentHasSettlement(record?: ActionRecord) {
  const data = record?.data ?? {};
  return Number(data.paid_cents ?? data.paidCents ?? 0) > 0 || Number(data.credited_cents ?? data.creditedCents ?? 0) > 0;
}

function documentStatusIsSettled(status: string) {
  return workflowStatusIs(status, "void", "paid", "credited");
}

function workflowStatusIs(status: string, ...expected: string[]) {
  const normalize = (value: string) => value.toLowerCase().replaceAll(/[_\s-]/g, "");
  return expected.some((value) => normalize(value) === normalize(status));
}

/**
 * Additional vendor-bill lines beyond the first. A vendor invoice covers a whole delivery, so a
 * bill has to carry every PO line it charges for: the number is unique per vendor, and billing
 * each line separately would need a fabricated invoice number per line and break the match
 * against the vendor's own statement. The server has always accepted an array here.
 */
export type ExtraBillLine = { key: string; lineId: string; label: string; purchaseOrderId: string; quantity: number; unitCost: number };

type WorkflowPayloadInput = { quantity: number; amount: number; reason: string; reference: string; referenceData?: Record<string, unknown>; referenceVersion?: number; externalReference: string; source: string; destination: string; resolution: string; policyValue: string; financial: FinancialInput; extraLines?: ExtraBillLine[]; fastTrack: boolean };
export function buildWorkflowPayload(action: ActionDefinition, state: WorkflowState, input: WorkflowPayloadInput): Record<string, unknown> {
  const cents = Math.round(input.amount * 100);
  const money = { currency: input.financial.currency, exchangeRateToBase: input.financial.exchangeRate, paymentTerms: input.financial.terms, dueDate: input.financial.dueDate, taxCode: input.financial.taxCode, taxRateBps: Math.round(input.financial.taxRate * 100) };
  switch (action.kind) {
    case "submitPurchaseOrder": case "approvePurchaseOrder": case "rejectPurchaseOrder": case "cancelPurchaseOrder": case "confirmSalesOrder": case "cancelSalesOrder": case "approveApproval": case "rejectApproval": return { reason: input.reason };
    case "amendPurchaseOrder": return { lines: [{ lineId: input.reference, orderedQuantity: input.quantity, ...(cents > 0 ? { unitCostCents: cents } : {}) }], reason: input.reason };
    case "transferInventory": case "changeInventoryStatus": return { productId: input.reference, fromLocationId: input.source, toLocationId: input.destination, quantity: input.quantity, reason: input.reason, postingDate: input.financial.postingDate };
    case "receiveTransfer": return { lineId: action.record?.data?.lineId, quantity: input.quantity, postingDate: input.financial.postingDate };
    case "requestOverReceiptApproval": return { entityType: "purchase_order_line", entityId: input.reference, requestType: "over_receipt", reason: input.reason, metadata: { purchaseOrderId: input.externalReference, maxExcessQuantity: input.quantity } };
    case "registerInventoryIdentity": return { productId: input.reference, locationId: input.source, quantity: input.quantity, lotNumber: input.policyValue || undefined, serialNumber: input.externalReference || undefined, inventoryStatus: input.resolution };
    case "setValuationPolicy": {
      const productId = action.record?.id ?? input.reference;
      const policy = state.valuationPolicies.find((record) => record.id === productId);
      return { productId, expectedVersion: policy?.version ?? 0, method: input.resolution, standardCostCents: cents };
    }
    case "scrapInventory": return { productId: input.reference, locationId: input.source, quantity: input.quantity, reason: input.reason, postingDate: input.financial.postingDate };
    case "releaseReservation": return { quantity: input.quantity, reason: input.reason };
    case "reallocateReservation": return { targetSalesOrderLineId: input.reference, targetLocationId: input.destination, quantity: input.quantity, reason: input.reason };
    case "reverseShipment": return { shipmentId: action.record?.data?.shipmentId ?? action.record?.data?.sourceDocumentId, lineId: action.record?.data?.lineId ?? action.record?.data?.sourceLineId, quantity: input.quantity, reason: input.reason, postingDate: input.financial.postingDate };
    case "postDropShipDelivery": {
      const localLine = state.options.salesOrderLines.find((option) => option.id === input.reference);
      return { salesOrderLineId: input.reference, sourceVersion: input.referenceVersion ?? localLine?.version ?? Number(input.referenceData?.salesOrderVersion), quantity: input.quantity, deliveryDate: input.financial.dueDate, externalReference: input.externalReference };
    }
    case "reverseDropShipDelivery": return { quantity: input.quantity, reason: input.reason, postingDate: input.financial.postingDate };
    case "allocateLandedCost": return { amountCents: cents, allocationBasis: "purchase_value", costLayerIds: [input.reference], sourceDocumentType: "vendor_bill", sourceDocumentId: input.externalReference, postingDate: input.financial.postingDate };
    case "createVendorBill": {
      const localLine = state.options.purchaseOrderLines.find((option) => option.id === input.reference);
      const poLine = input.referenceData ?? localLine?.data ?? {};
      const charge = (chargeType: string, description: string, value: number, refundable = false) => value > 0 ? { chargeType, description, amountCents: Math.round(value * 100), direction: "add", taxable: !refundable && input.financial.taxRate > 0, refundable, taxCode: refundable ? "EXEMPT" : input.financial.taxCode, taxRateBps: refundable ? 0 : Math.round(input.financial.taxRate * 100) } : null;
      const discount = input.financial.discount > 0 ? { chargeType: "discount", description: "Vendor invoice discount", amountCents: Math.round(input.financial.discount * 100), direction: "subtract", taxable: input.financial.taxRate > 0, refundable: false, taxCode: input.financial.taxCode, taxRateBps: Math.round(input.financial.taxRate * 100) } : null;
      const lines = [
        { purchaseOrderLineId: input.reference, quantity: input.quantity, unitCostCents: cents },
        ...(input.extraLines ?? []).map((line) => ({ purchaseOrderLineId: line.lineId, quantity: line.quantity, unitCostCents: Math.round(line.unitCost * 100) })),
      ];
      return { ...money, purchaseOrderId: String(poLine.purchaseOrderId ?? localLine?.detail ?? ""), sourceVersion: input.referenceVersion ?? Number(poLine.purchaseOrderVersion), vendorInvoiceNumber: input.externalReference, invoiceDate: input.financial.postingDate, dueDate: input.financial.dueDate, lines, charges: [discount, charge("freight", "Inbound freight", input.financial.freight), charge("fee", "Vendor fee", input.financial.fees), charge("returnable_deposit", "Refundable deposit", input.financial.deposit, true)].filter(Boolean), fastTrack: input.fastTrack, ...(input.fastTrack ? { approvalReason: input.reason } : {}) };
    }
    case "resolveMatchException": {
      if (input.resolution === "request-credit") return { resolution: input.resolution, amountCents: cents, reason: input.reason, currency: String(action.record?.data?.currency ?? "CAD"), exchangeRateToBase: Number(action.record?.data?.exchange_rate_to_base ?? action.record?.data?.exchangeRateToBase ?? 1), documentId: action.record?.id, postingDate: input.financial.postingDate };
      if (input.resolution !== "approve-variance") throw new Error("Select a valid match-resolution action.");
      return { resolution: input.resolution, reason: input.reason };
    }
    case "approveVendorBill": return { reason: input.reason };
    case "createVendorCredit": return { documentId: action.record?.id, amountCents: cents, reason: input.reason, currency: String(action.record?.data?.currency ?? "CAD"), exchangeRateToBase: Number(action.record?.data?.exchange_rate_to_base ?? action.record?.data?.exchangeRateToBase ?? 1), postingDate: input.financial.postingDate };
    case "recordVendorPayment": return { documentId: action.record?.id, documentType: "vendor_bill", amountCents: cents, paymentDate: input.financial.postingDate, method: input.resolution || "bank_transfer", reference: input.externalReference };
    case "createCustomerInvoice": return { salesOrderId: input.reference, sourceVersion: input.referenceVersion ?? state.options.salesOrders.find((option) => option.id === input.reference)?.version, invoiceDate: input.financial.postingDate, dueDate: input.financial.dueDate, exchangeRateToBase: input.financial.exchangeRate, paymentTerms: input.financial.terms };
    case "issueCustomerCredit": return { amountCents: cents, reason: input.reason, currency: String(action.record?.data?.currency ?? "CAD"), exchangeRateToBase: Number(action.record?.data?.exchange_rate_to_base ?? action.record?.data?.exchangeRateToBase ?? 1), documentId: action.record?.id, sourceVersion: action.record?.version, postingDate: input.financial.postingDate };
    case "recordCustomerPayment": return { documentId: input.reference, documentType: "customer_invoice", sourceVersion: action.record?.version, amountCents: cents, paymentDate: input.financial.postingDate, method: input.resolution || "bank_transfer", reference: input.externalReference };
    case "voidCustomerInvoice": return { reason: input.reason };
    case "addDocumentCharge": return { documentType: String(action.record?.data?.documentType ?? ""), documentId: action.record?.id, chargeType: input.resolution, description: input.externalReference, amountCents: cents, direction: input.source, taxable: input.financial.taxRate > 0, refundable: input.resolution === "returnable_deposit", taxCode: input.financial.taxCode, taxRateBps: Math.round(input.financial.taxRate * 100) };
    case "issueReturnableAsset": return { partnerId: input.reference, assetTypeId: input.resolution, quantity: input.quantity, direction: "customer_holds", reason: input.reason, postingDate: input.financial.postingDate, paymentMethod: input.source, paymentReference: input.externalReference };
    case "returnReturnableAsset": case "forfeitReturnableAsset": return { quantity: input.quantity, reason: input.reason, postingDate: input.financial.postingDate };
    case "refundAssetDeposit": return { amountCents: cents, reason: input.reason, postingDate: input.financial.postingDate };
    case "updatePolicy": return { key: action.record?.id, value: typedPolicyValue(action.record?.id ?? "", input.policyValue), reason: input.reason };
    case "lockPeriod": return { module: input.resolution, lockedThrough: input.financial.dueDate, reason: input.reason };
    case "unlockPeriod": return { module: action.record?.data?.module, lockedThrough: action.record?.data?.lockedThrough, reason: input.reason };
    case "updateUserRole": return { role: input.resolution, active: input.policyValue !== "disabled", reason: input.reason };
    default: throw new Error(`No durable payload contract is defined for ${action.kind}.`);
  }
}

function WorkflowDialog({ action, state, onClose, onSubmit }: { action: ActionDefinition; state: WorkflowState; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quantity, setQuantity] = useState(action.record?.quantity ?? 1);
  const settlementAction = ["createVendorCredit", "recordVendorPayment", "issueCustomerCredit", "recordCustomerPayment", "resolveMatchException"].includes(action.kind);
  const [amount, setAmount] = useState(settlementAction ? documentOutstandingAmount(action.record) : action.record?.amount ?? 0);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState(() => action.record?.id ?? "");
  const [referenceOption, setReferenceOption] = useState<SelectOption>();
  const [externalReference, setExternalReference] = useState("");
  const [source, setSource] = useState(action.kind === "addDocumentCharge" ? "add" : action.kind === "issueReturnableAsset" ? "bank_transfer" : "");
  const [destination, setDestination] = useState("");
  const [resolution, setResolution] = useState(["recordVendorPayment", "recordCustomerPayment"].includes(action.kind) ? "bank_transfer" : action.kind === "registerInventoryIdentity" ? "usable" : action.kind === "issueReturnableAsset" ? "" : action.kind === "resolveMatchException" ? state.permissions.approveVendorBill === true ? "approve-variance" : "request-credit" : action.kind === "setValuationPolicy" ? String(action.record?.data?.method ?? "fifo") : action.kind === "updateUserRole" ? String(action.record?.data?.role ?? "viewer") : action.kind === "lockPeriod" ? "accounting" : action.kind === "addDocumentCharge" ? "fee" : "");
  const [policyValue, setPolicyValue] = useState(action.kind === "updateUserRole" ? Number(action.record?.data?.active ?? 1) ? "active" : "disabled" : (action.record as PolicyRecord | undefined)?.value ?? "");
  const [fastTrack, setFastTrack] = useState(false);
  const [extraLines, setExtraLines] = useState<ExtraBillLine[]>([]);
  const [confirmedBillFingerprint, setConfirmedBillFingerprint] = useState("");
  const recordData = action.record?.data ?? {};
  const documentDate = String(recordData.invoice_date ?? recordData.invoiceDate ?? "");
  const initialPostingDate = documentDate > today ? documentDate : today;
  const defaultTaxRate = Number(state.policies.find((policy) => policy.id === "tax.defaultRateBps")?.data?.value ?? 500) / 100;
  const initialTerms = String(recordData.payment_terms ?? recordData.paymentTerms ?? "Net 30");
  const [financial, setFinancial] = useState<FinancialInput>({ currency: String(recordData.currency ?? "CAD"), exchangeRate: Number(recordData.exchange_rate_to_base ?? recordData.exchangeRateToBase ?? 1), terms: initialTerms, postingDate: initialPostingDate, dueDate: String(recordData.due_date ?? recordData.dueDate ?? dueDateFromTerms(initialPostingDate, initialTerms)), taxCode: defaultTaxRate > 0 ? "GST" : "Zero", taxRate: defaultTaxRate, discount: 0, freight: 0, fees: 0, deposit: 0, paid: 0 });

  // Shared with every other dialog so a quick-create picker opened on top of this one takes the
  // Escape for itself instead of both closing at once.
  useDialogDismiss(onClose, busy);
  useEffect(() => { closeRef.current?.focus(); }, []);

  // The bill's item subtotal spans every line on it, so the review total and the charge tax
  // have to be computed from the whole set rather than the first line alone.
  const extraItemsTotal = extraLines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
  const billLineFingerprint = JSON.stringify({ reference, quantity, amount, extraLines });
  const impact = useMemo(() => workflowImpact(action.kind, { quantity, amount, source, destination, resolution, policyValue, currency: financial.currency, financial, extraItemsTotal, fastTrack }, action.record), [action, amount, destination, extraItemsTotal, fastTrack, financial, policyValue, quantity, resolution, source]);
  const validationError = workflowValidationError(action, state, { quantity, amount, reason, reference, referenceData: referenceOption?.data, referenceVersion: referenceOption?.version, externalReference, source, destination, resolution, policyValue, financial, extraLines, fastTrack });
  const billLinesConfirmed = confirmedBillFingerprint === billLineFingerprint;
  const billReviewIncomplete = action.kind === "createVendorBill" && !billLinesConfirmed;
  const invalid = Boolean(validationError) || billReviewIncomplete;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (validationError || billReviewIncomplete) { setError(validationError || "Confirm the lines included on this bill before posting."); return; }
    setBusy(true);
    try {
      await onSubmit(buildWorkflowPayload(action, state, { quantity, amount, reason, reference, referenceData: referenceOption?.data, referenceVersion: referenceOption?.version, externalReference, source, destination, resolution, policyValue, financial, extraLines, fastTrack }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The workflow could not be completed. Your entries are still here."); setBusy(false); }
  };

  return <div className="workflow-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="workflow-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}><header><div><span className="workflow-kicker">Business command</span><h2 id={titleId}>{action.title}</h2><p id={descriptionId}>{action.description}</p></div><button ref={closeRef} onClick={onClose} disabled={busy} aria-label={`Close ${action.title}`}>×</button></header><form onSubmit={submit}>{error ? <div className="workflow-error" role="alert" tabIndex={-1}><strong>Couldn’t complete this action</strong><p>{error}</p></div> : null}<WorkflowFields action={action} state={state} quantity={quantity} setQuantity={setQuantity} amount={amount} setAmount={setAmount} reason={reason} setReason={setReason} reference={reference} setReference={setReference} onReferenceSelect={setReferenceOption} externalReference={externalReference} setExternalReference={setExternalReference} source={source} setSource={setSource} destination={destination} setDestination={setDestination} resolution={resolution} setResolution={setResolution} policyValue={policyValue} setPolicyValue={setPolicyValue} financial={financial} setFinancial={setFinancial} extraLines={extraLines} setExtraLines={setExtraLines} referenceData={referenceOption?.data} billLinesConfirmed={billLinesConfirmed} setBillLinesConfirmed={(confirmed) => setConfirmedBillFingerprint(confirmed ? billLineFingerprint : "")} fastTrack={fastTrack} setFastTrack={setFastTrack} /><ImpactReview lines={impact} /><footer><button type="button" className="workflow-action secondary" onClick={onClose} disabled={busy}>Keep reviewing</button><button type="submit" className="workflow-action primary" disabled={busy || invalid} aria-busy={busy} title={billReviewIncomplete ? "Confirm the included bill lines above" : undefined}>{busy ? "Posting…" : action.kind === "createVendorBill" && fastTrack ? "Create & approve vendor bill" : action.finalLabel}</button></footer></form></section></div>;
}

type FieldProps = {
  action: ActionDefinition; state: WorkflowState; quantity: number; setQuantity: (value: number) => void; amount: number; setAmount: (value: number) => void; reason: string; setReason: (value: string) => void; reference: string; setReference: (value: string) => void; onReferenceSelect: (option: SelectOption) => void; externalReference: string; setExternalReference: (value: string) => void; source: string; setSource: (value: string) => void; destination: string; setDestination: (value: string) => void; resolution: string; setResolution: (value: string) => void; policyValue: string; setPolicyValue: (value: string) => void; financial: FinancialInput; setFinancial: (value: FinancialInput) => void;
  extraLines: ExtraBillLine[]; setExtraLines: Dispatch<SetStateAction<ExtraBillLine[]>>; referenceData?: Record<string, unknown>;
  billLinesConfirmed: boolean; setBillLinesConfirmed: (value: boolean) => void;
  fastTrack: boolean; setFastTrack: (value: boolean) => void;
};

function WorkflowFields(props: FieldProps) {
  const { action, state } = props;
  if (["approveApproval", "rejectApproval"].includes(action.kind)) return <div className="workflow-form-grid"><div className="workflow-record-context full"><span>{action.record?.number}</span><strong>{action.record?.status}</strong><small>{action.record?.detail}</small></div><ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (action.kind === "receiveTransfer") return <div className="workflow-form-grid"><div className="workflow-record-context full"><span>{action.record?.number}</span><strong>{action.record?.reference}</strong><small>{action.record?.detail}</small></div><label><span>Quantity to receive</span><input type="number" min="0.0001" max={action.record?.quantity} step="0.0001" value={props.quantity} onChange={(event) => props.setQuantity(Number(event.target.value))} required /></label><PostingDateField value={props.financial} onChange={props.setFinancial} /></div>;
  if (action.kind === "requestOverReceiptApproval") return <div className="workflow-form-grid"><LookupField kind="purchaseOrderLines" label="Purchase-order line" value={props.reference} setValue={props.setReference} onSelect={(option) => props.setExternalReference(String(option.data?.purchaseOrderId ?? option.data?.orderId ?? ""))} /><label><span>Maximum excess quantity</span><input type="number" min="0.0001" step="0.0001" value={props.quantity} onChange={(event) => props.setQuantity(Number(event.target.value))} required /></label><ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (action.kind === "registerInventoryIdentity") return <div className="workflow-form-grid"><RemoteProductField value={props.reference} initialOptions={state.options.products} setValue={props.setReference} onSelect={props.onReferenceSelect} /><RemoteLocationField label="Current physical location" value={props.source} initialOptions={state.options.locations} setValue={props.setSource} /><label><span>Quantity (lot only)</span><input type="number" min="1" step="0.0001" value={props.quantity} onChange={(event) => props.setQuantity(Number(event.target.value))} /></label><label><span>Lot number</span><input value={props.policyValue} onChange={(event) => props.setPolicyValue(event.target.value)} placeholder="Required for lot-tracked products" /></label><label><span>Serial number</span><input value={props.externalReference} onChange={(event) => props.setExternalReference(event.target.value)} placeholder="Required for serial-tracked products" /></label><label><span>Inventory status</span><select value={props.resolution} onChange={(event) => props.setResolution(event.target.value)}><option value="usable">Usable</option><option value="quarantine">Quarantine</option><option value="damaged">Damaged</option><option value="in_transit">In transit</option><option value="return_pending">Return pending</option></select></label></div>;
  if (action.kind === "setValuationPolicy") return <div className="workflow-form-grid">{action.record ? <div className="workflow-record-context full"><span>{action.record.number}</span><strong>Current method: {action.record.status}</strong><small>Existing value entries remain immutable.</small></div> : <RemoteProductField value={props.reference} initialOptions={state.options.products} setValue={props.setReference} />}<label><span>Valuation method</span><select value={props.resolution} onChange={(event) => props.setResolution(event.target.value)}><option value="fifo">FIFO</option><option value="average">Weighted average</option><option value="standard">Standard cost</option></select></label><label><span>Standard cost</span><input type="number" min="0" step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} required={props.resolution === "standard"} /></label></div>;
  if (["approveVendorBill", "voidCustomerInvoice", "unlockPeriod"].includes(action.kind)) return <div className="workflow-form-grid"><div className="workflow-record-context full"><span>{action.record?.number}</span><strong>{action.record?.status}</strong><small>Version {action.record?.version ?? 1} will be checked before posting.</small></div><ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (["createVendorCredit", "issueCustomerCredit"].includes(action.kind)) return <div className="workflow-form-grid"><div className="workflow-record-context full"><span>{action.record?.number}</span><strong>{action.record?.party}</strong><small>{action.record?.detail ?? action.record?.status}</small></div><label><span>Credit amount ({props.financial.currency})</span><input type="number" min="0.01" max={documentOutstandingAmount(action.record)} step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} required /></label><PostingDateField value={props.financial} onChange={props.setFinancial} label="Credit date" min={String(action.record?.data?.invoice_date ?? action.record?.data?.invoiceDate ?? "")} /><ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (["recordVendorPayment", "recordCustomerPayment"].includes(action.kind)) return <div className="workflow-form-grid"><div className="workflow-record-context full"><span>{action.record?.number}</span><strong>{action.record?.party}</strong><small>{action.record?.detail ?? action.record?.status}</small></div><label><span>Payment amount ({props.financial.currency})</span><input type="number" min="0.01" max={documentOutstandingAmount(action.record)} step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} required /></label><PostingDateField value={props.financial} onChange={props.setFinancial} label="Payment date" min={String(action.record?.data?.invoice_date ?? action.record?.data?.invoiceDate ?? "")} /><label><span>Method</span><select value={props.resolution} onChange={(event) => props.setResolution(event.target.value)}><option value="bank_transfer">Bank transfer</option><option value="credit_card">Credit card</option><option value="cheque">Cheque</option><option value="cash">Cash</option></select></label><label><span>Payment reference</span><input value={props.externalReference} onChange={(event) => props.setExternalReference(event.target.value)} required /></label></div>;
  if (action.kind === "addDocumentCharge") return <div className="workflow-form-grid"><div className="workflow-record-context full"><span>{action.record?.number}</span><strong>{action.record?.party}</strong><small>{String(action.record?.data?.documentType ?? "document").replaceAll("_", " ")}</small></div><label><span>Charge type</span><select value={props.resolution} onChange={(event) => { const next = event.target.value; props.setResolution(next); if (next === "discount") props.setSource("subtract"); else if (next === "returnable_deposit") { props.setSource("add"); props.setFinancial({ ...props.financial, taxCode: "EXEMPT", taxRate: 0 }); } }}><option value="freight">Freight</option><option value="handling">Handling</option><option value="fee">Other fee</option><option value="discount">Discount</option><option value="returnable_deposit">Refundable deposit</option></select></label><label><span>Description</span><input value={props.externalReference} onChange={(event) => props.setExternalReference(event.target.value)} required /></label><label><span>Amount</span><input type="number" min="0.01" step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} required /></label><label><span>Direction</span><select value={props.source} onChange={(event) => props.setSource(event.target.value)} disabled={["discount", "returnable_deposit"].includes(props.resolution)}><option value="add">Add to total</option><option value="subtract">Subtract from total</option></select></label>{props.resolution === "returnable_deposit" ? <div className="workflow-record-context"><span>Tax treatment</span><strong>Exempt</strong><small>Refundable deposits are tracked separately from revenue and tax.</small></div> : <TaxFields value={props.financial} onChange={props.setFinancial} />}</div>;
  if (action.kind === "lockPeriod") return <div className="workflow-form-grid"><label><span>Module</span><select value={props.resolution} onChange={(event) => props.setResolution(event.target.value)}><option value="accounting">Accounting</option><option value="inventory">Inventory</option><option value="purchasing">Purchasing</option><option value="sales">Sales</option><option value="all">All posting modules</option></select></label><label><span>Lock postings through</span><input type="date" value={props.financial.dueDate} onChange={(event) => props.setFinancial({ ...props.financial, dueDate: event.target.value })} required /></label><ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (action.kind === "updateUserRole") return <div className="workflow-form-grid"><div className="workflow-record-context full"><span>{action.record?.number}</span><strong>{action.record?.party}</strong><small>Current access: {action.record?.detail} · {action.record?.status}</small></div><label><span>Role</span><select value={props.resolution} onChange={(event) => props.setResolution(event.target.value)}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="accounting">Accounting</option><option value="manager">Manager</option><option value="administrator">Administrator</option></select></label><label><span>Account status</span><select value={props.policyValue} onChange={(event) => props.setPolicyValue(event.target.value)}><option value="active">Active</option><option value="disabled">Disabled</option></select></label><ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (action.kind === "postDropShipDelivery") return <div className="workflow-form-grid"><LookupField kind="salesOrderLines" role="drop_ship_linked" label="Linked drop-ship sales-order line" value={props.reference} setValue={props.setReference} onSelect={(option) => props.onReferenceSelect(option as SelectOption)} /><label><span>Delivered quantity</span><input type="number" min="0.0001" step="0.0001" value={props.quantity} onChange={(event) => props.setQuantity(Number(event.target.value))} required /></label><label><span>Delivery date</span><input type="date" value={props.financial.dueDate} onChange={(event) => props.setFinancial({ ...props.financial, dueDate: event.target.value })} required /></label><label><span>Supplier proof / reference</span><input value={props.externalReference} onChange={(event) => props.setExternalReference(event.target.value)} required /></label></div>;
  if (action.kind === "updatePolicy") return <div className="workflow-form-grid"><label className="full"><span>Current value</span><input value={(action.record as PolicyRecord).value} disabled /></label>{action.record?.id === "security.defaultRole" ? <label className="full"><span>New default role</span><select value={props.policyValue} onChange={(event) => props.setPolicyValue(event.target.value)}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="accounting">Accounting</option></select></label> : <label className="full"><span>New value</span><input value={props.policyValue} onChange={(event) => props.setPolicyValue(event.target.value)} required /></label>}<ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (action.kind === "amendPurchaseOrder") return <div className="workflow-form-grid"><div className="workflow-record-context full"><span>{action.record?.number}</span><strong>Revision {(action.record?.revision ?? 1) + 1}</strong><small>The server will reject a quantity below net received.</small></div><LookupField kind="purchaseOrderLines" partnerId={action.record?.id ?? ""} label="Purchase-order line" value={props.reference} setValue={props.setReference} onSelect={(option) => props.setQuantity(Number(option.data?.orderedQuantity ?? props.quantity))} /><label><span>Revised ordered quantity</span><input type="number" min="1" value={props.quantity} onChange={(event) => props.setQuantity(Number(event.target.value))} required /></label><label><span>Revised unit cost (optional)</span><input type="number" min="0" step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} /></label><ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (action.kind === "createVendorBill") return <VendorBillFields {...props} />;
  if (action.kind === "createCustomerInvoice") return <div className="workflow-form-grid"><LookupField kind="salesOrders" label="Sales order with invoiceable delivery" value={props.reference} setValue={props.setReference} onSelect={(option) => { props.onReferenceSelect(option as SelectOption); props.setAmount(Number(option.data?.invoiceableCents ?? 0) / 100); const terms = String(option.data?.paymentTerms ?? "Net 30"); props.setFinancial({ ...props.financial, currency: String(option.data?.currency ?? "CAD"), exchangeRate: Number(option.data?.exchangeRateToBase ?? 1), terms, dueDate: dueDateFromTerms(props.financial.postingDate, terms) }); }} /><FinancialDetails value={props.financial} onChange={props.setFinancial} items={props.amount} currencyLocked postingDateLabel="Customer invoice date" taxIncluded /></div>;
  if (action.kind === "allocateLandedCost") return <div className="workflow-form-grid"><LookupField kind="costLayers" label="Cost layer" value={props.reference} setValue={props.setReference} /><LookupField kind="vendorBills" label="Source vendor bill" value={props.externalReference} setValue={props.setExternalReference} /><label><span>Amount (CAD)</span><input type="number" min="0.01" step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} required /></label><PostingDateField value={props.financial} onChange={props.setFinancial} /></div>;
  if (action.kind === "issueReturnableAsset") return <div className="workflow-form-grid"><LookupField kind="partners" role="customer" label="Customer" value={props.reference} setValue={props.setReference} quickCreate="customer" /><LookupField kind="assetTypes" label="Asset type" value={props.resolution} setValue={props.setResolution} initialOptions={state.options.assetTypes} quickCreate="assetType" onSelect={(option) => props.setAmount(Number(option.data?.unitDepositCents ?? 0) / 100)} /><label><span>Quantity</span><input type="number" min="1" step="1" value={props.quantity} onChange={(event) => props.setQuantity(Number(event.target.value))} required /></label><PostingDateField value={props.financial} onChange={props.setFinancial} /><div className="workflow-record-context"><span>Refundable deposit collected (CAD)</span><strong>{formatWorkflowMoney(props.amount * props.quantity, "CAD")}</strong><small>Calculated from the selected asset type and posted with this issuance</small></div>{props.amount * props.quantity > 0 ? <><label><span>Deposit method</span><select value={props.source} onChange={(event) => props.setSource(event.target.value)}><option value="bank_transfer">Bank transfer</option><option value="credit_card">Credit card</option><option value="cheque">Cheque</option><option value="cash">Cash</option></select></label><label><span>Deposit reference</span><input value={props.externalReference} onChange={(event) => props.setExternalReference(event.target.value)} required /></label></> : null}<ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (action.kind === "refundAssetDeposit") return <div className="workflow-form-grid"><div className="workflow-record-context full"><span>{action.record?.number}</span><strong>{action.record?.party}</strong><small>{action.record?.detail}</small></div><label><span>Refund amount (CAD)</span><input type="number" min="0.01" max={action.record?.amount} step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} required /></label><PostingDateField value={props.financial} onChange={props.setFinancial} label="Refund date" /><ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (action.kind === "resolveMatchException") return <div className="workflow-form-grid"><fieldset className="full"><legend>Resolution</legend>{[["approve-variance", "Approve price / charge variance"], ["request-credit", "Post vendor credit"]].map(([value, label]) => <label key={value} className="workflow-radio"><input type="radio" name="resolution" value={value} checked={props.resolution === value} disabled={value === "approve-variance" ? state.permissions.approveVendorBill !== true : state.permissions.createVendorCredit !== true} onChange={(event) => props.setResolution(event.target.value)} />{label}</label>)}</fieldset>{props.resolution === "request-credit" ? <><label><span>Credit amount</span><input type="number" min="0.01" max={documentOutstandingAmount(action.record)} step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} required /></label><PostingDateField value={props.financial} onChange={props.setFinancial} label="Credit date" min={String(action.record?.data?.invoice_date ?? action.record?.data?.invoiceDate ?? "")} /></> : null}<ReasonField value={props.reason} setValue={props.setReason} /></div>;
  const moneyAction = ["createVendorBill", "createCustomerInvoice", "issueCustomerCredit", "recordCustomerPayment", "allocateLandedCost", "refundAssetDeposit"].includes(action.kind);
  const movementAction = ["transferInventory", "changeInventoryStatus", "scrapInventory", "reverseShipment", "returnReturnableAsset"].includes(action.kind);
  return <div className="workflow-form-grid">
    {action.record ? <div className="workflow-record-context full"><span>{action.record.number}</span><strong>{action.record.party ?? action.record.status}</strong><small>Version {action.record.version ?? 1} will be checked before posting.</small></div> : null}
    {movementAction && !["reverseShipment", "returnReturnableAsset"].includes(action.kind) ? <RemoteProductField value={props.reference} initialOptions={state.options.products} setValue={props.setReference} /> : null}
    {["submitPurchaseOrder", "approvePurchaseOrder", "rejectPurchaseOrder", "amendPurchaseOrder"].includes(action.kind) ? null : <label><span>{moneyAction ? `Amount (${props.financial.currency})` : "Quantity"}</span><input type="number" min={moneyAction ? "0.01" : "1"} step={moneyAction ? "0.01" : "1"} value={moneyAction ? props.amount : props.quantity} onChange={(event) => moneyAction ? props.setAmount(Number(event.target.value)) : props.setQuantity(Number(event.target.value))} required /></label>}
    {["createVendorBill", "createCustomerInvoice", "issueCustomerCredit", "recordCustomerPayment", "issueReturnableAsset"].includes(action.kind) ? <label><span>Document / payment reference</span><input value={props.reference} onChange={(event) => props.setReference(event.target.value)} placeholder="External reference" required /></label> : null}
    {moneyAction ? <FinancialDetails value={props.financial} onChange={props.setFinancial} items={props.amount} /> : null}
    {movementAction && !["reverseShipment", "returnReturnableAsset"].includes(action.kind) ? <><RemoteLocationField label="Source location" value={props.source} initialOptions={state.options.locations} setValue={props.setSource} />{action.kind !== "scrapInventory" ? <RemoteLocationField label="Destination location" value={props.destination} initialOptions={state.options.locations} setValue={props.setDestination} quickCreate="location" /> : null}</> : null}
    {action.kind === "reallocateReservation" ? <><LookupField kind="salesOrderLines" label="New sales order demand" value={props.reference} setValue={props.setReference} /><LookupField kind="locations" label="Target location" value={props.destination} setValue={props.setDestination} initialOptions={state.options.locations} quickCreate="location" /></> : null}
    {["transferInventory", "changeInventoryStatus", "scrapInventory", "reverseShipment", "reverseDropShipDelivery", "returnReturnableAsset", "forfeitReturnableAsset"].includes(action.kind) ? <PostingDateField value={props.financial} onChange={props.setFinancial} /> : null}
    {requiresReason(action.kind) ? <ReasonField value={props.reason} setValue={props.setReason} /> : null}
  </div>;
}

function OptionField({ label, value, options, setValue, disabled = false, quickCreate, onCreated }: { label: string; value: string; options: SelectOption[]; setValue: (value: string) => void; disabled?: boolean; quickCreate?: QuickCreateKind; onCreated?: () => void | Promise<void> }) {
  return <SearchableSelect label={label} value={value} options={options as PickerOption[]} setValue={(next) => setValue(next)} disabled={disabled} quickCreate={quickCreate} onCreated={onCreated} />;
}

function RemoteReferenceField({ kind, role, label, placeholder, value, initialOptions, setOption, quickCreate, onCreated }: { kind: "products" | "partners" | "locations"; role?: "vendor" | "customer" | "usable" | "quarantine" | "damaged" | "in_transit" | "return_pending" | "non_usable"; label: string; placeholder: string; value: string; initialOptions: SelectOption[]; setOption: (option: SelectOption) => void; quickCreate?: QuickCreateKind; onCreated?: () => void | Promise<void> }) {
  const mapItem = (item: Record<string, unknown>): PickerOption => ({
    id: String(item.id),
    label: kind === "products" ? `${String(item.sku)} · ${String(item.name)}` : kind === "locations" ? `${String(item.warehouseCode)} · ${String(item.code)} · ${String(item.name)}` : `${String(item.code)} · ${String(item.name)}`,
    detail: kind === "partners" ? String(item.partnerType ?? "") : kind === "locations" ? String(item.inventoryStatus ?? "") : undefined,
    version: Number(item.version ?? 0) || undefined,
    data: item,
  });
  return <RemoteSearchSelect kind={kind} role={role} label={label} placeholder={placeholder} value={value} initialOptions={initialOptions as PickerOption[]} quickCreate={quickCreate} mapItem={mapItem} onSelect={(option) => setOption(option as SelectOption)} onCreated={onCreated} />;
}

/**
 * A vendor invoice is one document covering one delivery, which normally means several PO lines.
 * The first line also fixes the bill's currency, terms, and which purchase order every other
 * line has to belong to, so it stays the primary field and the rest are added beneath it.
 */
function VendorBillFields(props: FieldProps) {
  const [defaultingLines, setDefaultingLines] = useState(false);
  const [defaultingError, setDefaultingError] = useState("");
  const defaultRequest = useRef(0);
  const primaryPurchaseOrderId = String(props.referenceData?.purchaseOrderId ?? "");
  const items = props.quantity * props.amount + props.extraLines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
  const update = (key: string, patch: Partial<ExtraBillLine>) => props.setExtraLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  const addLine = () => props.setExtraLines((current) => [...current, { key: crypto.randomUUID(), lineId: "", label: "", purchaseOrderId: "", quantity: 1, unitCost: 0 }]);
  const removeLine = (key: string) => props.setExtraLines((current) => current.filter((line) => line.key !== key));
  const defaultBillableLines = async (primary: PickerOption) => {
    const request = ++defaultRequest.current;
    const purchaseOrderId = String(primary.data?.purchaseOrderId ?? "");
    props.setQuantity(Number(primary.data?.billableQuantity ?? 0));
    setDefaultingLines(true);
    setDefaultingError("");
    try {
      const loaded: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 50) {
        const params = new URLSearchParams({ lookup: "purchaseOrderLines", role: "billable", partnerId: purchaseOrderId, limit: "50", offset: String(offset) });
        const response = await fetch(`/api/snapshot?${params}`, { cache: "no-store" });
        const result = await response.json() as { items?: Record<string, unknown>[]; error?: { message?: string } };
        if (!response.ok) throw new Error(result.error?.message ?? "The PO lines could not be loaded.");
        const page = result.items ?? [];
        loaded.push(...page);
        if (page.length < 50) break;
      }
      if (request !== defaultRequest.current) return;
      props.setExtraLines(loaded.filter((line) => String(line.id) !== primary.id).map((line) => ({
        key: crypto.randomUUID(),
        lineId: String(line.id),
        label: `${String(line.orderNumber)} · ${String(line.sku)}`,
        purchaseOrderId,
        quantity: Number(line.billableQuantity ?? 0),
        unitCost: Number(line.unitCostCents ?? 0) / 100,
      })));
    } catch (error) {
      if (request !== defaultRequest.current) return;
      props.setExtraLines([]);
      setDefaultingError(error instanceof Error ? error.message : "The remaining PO lines could not be loaded.");
    } finally { if (request === defaultRequest.current) setDefaultingLines(false); }
  };

  return <div className="workflow-form-grid">
    <LookupField kind="purchaseOrderLines" role="billable" label="Purchase order (select any received line)" value={props.reference} setValue={props.setReference} onSelect={(option) => {
      props.onReferenceSelect(option as SelectOption);
      props.setAmount(Number(option.data?.unitCostCents ?? 0) / 100);
      const terms = String(option.data?.paymentTerms ?? "Net 30");
      props.setFinancial({ ...props.financial, currency: String(option.data?.currency ?? "CAD"), exchangeRate: Number(option.data?.exchangeRateToBase ?? 1), terms, dueDate: dueDateFromTerms(props.financial.postingDate, terms) });
      // Switching the first line to a different purchase order strands every line added under
      // the old one, and the server would reject the bill wholesale rather than per line.
      const nextPurchaseOrderId = String(option.data?.purchaseOrderId ?? "");
      if (primaryPurchaseOrderId && nextPurchaseOrderId !== primaryPurchaseOrderId) props.setExtraLines([]);
      void defaultBillableLines(option);
    }} />
    <label><span>Vendor invoice number</span><input value={props.externalReference} onChange={(event) => props.setExternalReference(event.target.value)} required /></label>
    <label><span>Billed quantity</span><input type="number" min="0.0001" step="0.0001" value={props.quantity} onChange={(event) => props.setQuantity(Number(event.target.value))} required /></label>
    <label><span>Unit cost</span><input type="number" min="0.01" step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} required /></label>

    <fieldset className="bill-lines full"><legend>PO lines included by default</legend>
      {defaultingLines ? <p className="read-only-label" role="status">Loading every received, unbilled line from this purchase order…</p> : null}
      {defaultingError ? <p className="bill-line-warning" role="alert"><strong>Only the selected line could be loaded.</strong>{defaultingError}</p> : null}
      {props.extraLines.length
        ? <div className="bill-line-rows">{props.extraLines.map((line, index) => <div className="bill-line-row" key={line.key}>
            <LookupField kind="purchaseOrderLines" role="billable" partnerId={primaryPurchaseOrderId} label={`Line ${index + 2}`} value={line.lineId} setValue={(value) => update(line.key, { lineId: value })} onSelect={(option) => update(line.key, {
              lineId: option.id,
              label: String(option.label ?? ""),
              purchaseOrderId: String(option.data?.purchaseOrderId ?? ""),
              unitCost: Number(option.data?.unitCostCents ?? 0) / 100,
            })} />
            <label><span>Quantity</span><input type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => update(line.key, { quantity: Number(event.target.value) })} required /></label>
            <label><span>Unit cost</span><input type="number" min="0.01" step="0.01" value={line.unitCost} onChange={(event) => update(line.key, { unitCost: Number(event.target.value) })} required /></label>
            <button type="button" className="workflow-action secondary" onClick={() => removeLine(line.key)} aria-label={`Remove line ${index + 2}`}>Remove</button>
          </div>)}</div>
        : !defaultingLines && props.reference ? <p className="read-only-label">There are no other received, unbilled lines on this purchase order.</p> : null}
      <button type="button" className="workflow-action secondary" onClick={addLine}>Add another PO line to this bill</button>
    </fieldset>

    <section className="bill-inclusion-review full" aria-labelledby="bill-inclusion-title">
      <header><div><span className="workflow-kicker">Posting scope</span><h3 id="bill-inclusion-title">Included on this bill: {props.reference ? 1 + props.extraLines.filter((line) => line.lineId).length : 0} line{props.reference && props.extraLines.filter((line) => line.lineId).length === 0 ? "" : "s"}</h3></div><strong>{formatWorkflowMoney(items, props.financial.currency)}</strong></header>
      <p>All currently billable PO lines are included automatically. Quantities use net receipts after returns and prior bills; closed-short quantities are excluded; unit costs use the latest approved PO revision. Remove or edit lines to match the vendor invoice.</p>
      {props.reference ? <ol>
        <li><span>{String(props.referenceData?.orderNumber ?? "Purchase order")} · {String(props.referenceData?.sku ?? "Line 1")}</span><small>{props.quantity} × {formatWorkflowMoney(props.amount, props.financial.currency)}</small><strong>{formatWorkflowMoney(props.quantity * props.amount, props.financial.currency)}</strong></li>
        {props.extraLines.filter((line) => line.lineId).map((line) => <li key={line.key}><span>{line.label || "Selected PO line"}</span><small>{line.quantity} × {formatWorkflowMoney(line.unitCost, props.financial.currency)}</small><strong>{formatWorkflowMoney(line.quantity * line.unitCost, props.financial.currency)}</strong></li>)}
      </ol> : <p className="read-only-label">Select the first PO line to build the bill’s posting scope.</p>}
      <label className="bill-inclusion-confirm"><input type="checkbox" checked={props.billLinesConfirmed} onChange={(event) => props.setBillLinesConfirmed(event.target.checked)} disabled={!props.reference || defaultingLines} /><span>I compared this list with the vendor invoice and confirm these are all lines included on this bill.</span></label>
    </section>

    <FinancialDetails value={props.financial} onChange={props.setFinancial} items={items} showCharges currencyLocked postingDateLabel="Vendor invoice date" />
    {props.state.permissions.createApprovedVendorBill === true ? <fieldset className="financial-details full"><legend>Authorization path</legend><div className="financial-fields"><label className="full"><span><input type="checkbox" checked={props.fastTrack} onChange={(event) => props.setFastTrack(event.target.checked)} /> Fast-track with my signing authority</span><small>Create this bill directly as approved, including any three-way-match variance. Your identity, note, and timestamp are recorded.</small></label>{props.fastTrack ? <ReasonField value={props.reason} setValue={props.setReason} /> : null}</div></fieldset> : null}
  </div>;
}

// Picker detail lines carry the outstanding balance or unit cost the action will act on, so
// they show cents even though the dashboard tiles above them do not.
const money0 = (cents: unknown, currency: unknown = "CAD") => formatWorkflowMoney(Number(cents ?? 0) / 100, String(currency || "CAD"));

/** Maps a lookup row to the label and detail a picker shows. */
const lookupMappers: Record<string, (item: Record<string, unknown>) => PickerOption> = {
  salesOrders: (item) => ({ id: String(item.id), label: `${String(item.number)} · ${String(item.customerName)}`, detail: `${String(item.status).replaceAll("_", " ")} · ${money0(item.totalCents, item.currency)}`, version: Number(item.version ?? 0) || undefined, data: item }),
  purchaseOrders: (item) => ({ id: String(item.id), label: `${String(item.number)} · ${String(item.vendorName)}`, detail: `${String(item.status).replaceAll("_", " ")} · ${money0(item.totalCents, item.currency)}`, version: Number(item.version ?? 0) || undefined, data: item }),
  salesOrderLines: (item) => ({ id: String(item.id), label: `${String(item.orderNumber)} · ${String(item.sku)}`, detail: `${String(item.customerName)} · ${String(item.productName)} · ${String(item.fulfillmentRoute).replaceAll("_", " ")}`, version: Number(item.salesOrderVersion ?? 0) || undefined, data: item }),
  purchaseOrderLines: (item) => ({ id: String(item.id), label: `${String(item.orderNumber)} · ${String(item.sku)}`, detail: `${String(item.vendorName)} · ${String(item.productName)}`, version: Number(item.purchaseOrderVersion ?? 0) || undefined, data: item }),
  customerInvoices: (item) => ({ id: String(item.id), label: `${String(item.number)} · ${String(item.customerName)}`, detail: `${money0(item.outstandingCents, item.currency)} outstanding · due ${String(item.dueDate ?? "—")}`, version: Number(item.version ?? 0) || undefined, data: item }),
  vendorBills: (item) => ({ id: String(item.id), label: `${String(item.number)} · ${String(item.vendorName)}`, detail: `${String(item.status).replaceAll("_", " ")} · ${money0(item.totalCents, item.currency)}`, version: Number(item.version ?? 0) || undefined, data: item }),
  costLayers: (item) => ({ id: String(item.id), label: `${String(item.sku)} · ${Number(item.remainingQuantity ?? 0)} remaining`, detail: `${money0(item.unitCostCents)} unit · received ${String(item.receivedAt ?? "").slice(0, 10)}`, data: item }),
  priceLists: (item) => ({ id: String(item.id), label: `${String(item.code)} · ${String(item.name)}`, detail: `Priority ${Number(item.priority ?? 0)}`, version: Number(item.version ?? 0) || undefined, data: item }),
  priceListAssignments: (item) => ({ id: String(item.id), label: `${String(item.priceListCode)} · ${String(item.partnerName)}`, detail: `Priority ${Number(item.priority ?? 0)}`, version: Number(item.version ?? 0) || undefined, data: item }),
  priceListEntries: (item) => ({ id: String(item.id), label: `${String(item.priceListCode)} · ${String(item.sku)}`, detail: `${String(item.uomCode)} · minimum ${Number(item.minimumQuantity ?? 0)} · ${money0(item.unitPriceCents, item.currency)}`, version: Number(item.version ?? 0) || undefined, data: item }),
  uoms: (item) => ({ id: String(item.id), label: `${String(item.code)} · ${String(item.name)}`, detail: String(item.dimension ?? ""), data: item }),
  warehouses: (item) => ({ id: String(item.id), label: `${String(item.code)} · ${String(item.name)}`, version: Number(item.version ?? 0) || undefined, data: item }),
  assetTypes: (item) => ({ id: String(item.id), label: `${String(item.code)} · ${String(item.name)}`, detail: String(item.assetClass ?? ""), version: Number(item.version ?? 0) || undefined, data: item }),
};

/**
 * Searchable picker over a server reference table. Use this instead of OptionField whenever
 * the list grows with the business: the workflow snapshot only carries its first page.
 */
function LookupField({ kind, label, value, setValue, initialOptions = [], role, partnerId, onSelect, quickCreate, onCreated }: {
  kind: LookupKind; label: string; value: string; setValue: (value: string) => void; initialOptions?: SelectOption[];
  role?: string; partnerId?: string; onSelect?: (option: PickerOption) => void; quickCreate?: QuickCreateKind; onCreated?: () => void | Promise<void>;
}) {
  return <RemoteSearchSelect
    kind={kind}
    label={label}
    role={role}
    partnerId={partnerId}
    placeholder={`Search ${label.toLowerCase()}`}
    value={value}
    initialOptions={initialOptions as PickerOption[]}
    quickCreate={quickCreate}
    onCreated={onCreated}
    mapItem={lookupMappers[kind] ?? ((item) => ({ id: String(item.id), label: String(item.name ?? item.number ?? item.id), data: item }))}
    onSelect={(option) => { setValue(option.id); onSelect?.(option); }}
  />;
}

function RemoteProductField({ value, initialOptions, setValue, onSelect, label = "Product", quickCreate, onCreated }: { value: string; initialOptions: SelectOption[]; setValue: (value: string) => void; onSelect?: (option: SelectOption) => void; label?: string; quickCreate?: QuickCreateKind; onCreated?: () => void | Promise<void> }) {
  return <RemoteReferenceField kind="products" label={label} placeholder="Search every SKU or product" value={value} initialOptions={initialOptions} quickCreate={quickCreate} onCreated={onCreated} setOption={(option) => { setValue(option.id); onSelect?.(option); }} />;
}

function RemotePartnerField({ value, initialOptions, setValue, role, label, quickCreate, onCreated }: { value: string; initialOptions: SelectOption[]; setValue: (value: string) => void; role: "vendor" | "customer"; label: string; quickCreate?: QuickCreateKind; onCreated?: () => void | Promise<void> }) {
  return <RemoteReferenceField kind="partners" role={role} label={label} placeholder={`Search every active ${role}`} value={value} initialOptions={initialOptions} quickCreate={quickCreate} onCreated={onCreated} setOption={(option) => setValue(option.id)} />;
}

function RemoteLocationField({ value, initialOptions, setValue, label, quickCreate }: { value: string; initialOptions: SelectOption[]; setValue: (value: string) => void; label: string; quickCreate?: QuickCreateKind }) {
  return <RemoteReferenceField kind="locations" label={label} placeholder="Search every active location" value={value} initialOptions={initialOptions} quickCreate={quickCreate} setOption={(option) => setValue(option.id)} />;
}

function TaxFields({ value, onChange }: { value: FinancialInput; onChange: (value: FinancialInput) => void }) {
  const set = (patch: Partial<FinancialInput>) => onChange({ ...value, ...patch });
  return <><label><span>Tax code</span><select value={value.taxCode} onChange={(event) => set({ taxCode: event.target.value, taxRate: event.target.value === "GST" ? 5 : 0 })}><option>GST</option><option>Zero</option><option>Exempt</option></select></label><label><span>Tax %</span><input type="number" min="0" max="100" step="0.01" value={value.taxRate} onChange={(event) => set({ taxRate: Number(event.target.value) })} /></label></>;
}

function PostingDateField({ value, onChange, label = "Posting date", min }: { value: FinancialInput; onChange: (value: FinancialInput) => void; label?: string; min?: string }) {
  return <label><span>{label}</span><input type="date" min={min} value={value.postingDate} onChange={(event) => onChange({ ...value, postingDate: event.target.value })} required /></label>;
}

function FinancialDetails({ value, onChange, items, showCharges = false, currencyLocked = false, postingDateLabel, taxIncluded = false }: { value: FinancialInput; onChange: (value: FinancialInput) => void; items: number; showCharges?: boolean; currencyLocked?: boolean; postingDateLabel?: string; taxIncluded?: boolean }) {
  const tax = taxIncluded ? 0 : Math.max(items - value.discount + value.freight + value.fees, 0) * value.taxRate / 100;
  const total = taxIncluded ? items : items - value.discount + value.freight + value.fees + value.deposit + tax;
  const balance = total - value.paid;
  const set = (patch: Partial<FinancialInput>) => onChange({ ...value, ...patch });
  return <fieldset className="financial-details full"><legend>Financial terms and totals</legend><div className="financial-fields"><label><span>Currency</span><select value={value.currency} disabled={currencyLocked} onChange={(event) => set({ currency: event.target.value })}><option>CAD</option><option>USD</option><option>EUR</option></select></label>{value.currency !== "CAD" ? <label><span>Exchange rate to CAD</span><input type="number" min="0.0001" step="0.0001" value={value.exchangeRate} onChange={(event) => set({ exchangeRate: Number(event.target.value) })} /></label> : null}{postingDateLabel ? <PostingDateField value={value} onChange={(next) => onChange({ ...next, dueDate: next.dueDate < next.postingDate ? dueDateFromTerms(next.postingDate, next.terms) : next.dueDate })} label={postingDateLabel} /> : null}<label><span>Terms</span><select value={value.terms} onChange={(event) => { const terms = event.target.value; set({ terms, dueDate: dueDateFromTerms(value.postingDate, terms) }); }}>{PAYMENT_TERMS.map((term) => <option key={term}>{term}</option>)}</select></label><label><span>Due date</span><input type="date" min={value.postingDate} value={value.dueDate} onChange={(event) => set({ dueDate: event.target.value })} /></label>{taxIncluded ? <p className="read-only-label">Tax, discounts, and eligible order charges are inherited from the delivered sales-order lines.</p> : <TaxFields value={value} onChange={onChange} />}{showCharges ? <><label><span>Discount</span><input type="number" min="0" step="0.01" value={value.discount} onChange={(event) => set({ discount: Number(event.target.value) })} /></label><label><span>Freight</span><input type="number" min="0" step="0.01" value={value.freight} onChange={(event) => set({ freight: Number(event.target.value) })} /></label><label><span>Other fees</span><input type="number" min="0" step="0.01" value={value.fees} onChange={(event) => set({ fees: Number(event.target.value) })} /></label><label><span>Refundable core / empty deposit</span><input type="number" min="0" step="0.01" value={value.deposit} onChange={(event) => set({ deposit: Number(event.target.value) })} /></label></> : null}</div><dl className="financial-total-lines"><div><dt>{taxIncluded ? "Invoiceable delivered amount" : "Items"}</dt><dd>{value.currency} {items.toFixed(2)}</dd></div>{showCharges ? <><div><dt>Discount</dt><dd>−{value.currency} {value.discount.toFixed(2)}</dd></div><div><dt>Freight & fees</dt><dd>{value.currency} {(value.freight + value.fees).toFixed(2)}</dd></div><div><dt>Refundable deposit</dt><dd>{value.currency} {value.deposit.toFixed(2)}</dd></div></> : null}{!taxIncluded ? <div><dt>Tax</dt><dd>{value.currency} {tax.toFixed(2)}</dd></div> : null}<div className="total"><dt>Document total</dt><dd>{value.currency} {balance.toFixed(2)}</dd></div></dl></fieldset>;
}

function ReasonField({ value, setValue }: { value: string; setValue: (value: string) => void }) {
  return <label className="full"><span>Reason / audit note</span><textarea value={value} onChange={(event) => setValue(event.target.value)} placeholder="Explain why this action is needed" rows={3} required /></label>;
}

type ImpactLine = { category: "Physical" | "Commercial" | "Financial" | "Audit"; label: string; effect: string; tone?: Tone };
function workflowImpact(kind: WorkflowActionKind, input: { quantity: number; amount: number; source: string; destination: string; resolution: string; policyValue: string; currency: string; financial?: FinancialInput; extraItemsTotal?: number; fastTrack: boolean }, record?: ActionRecord): ImpactLine[] {
  const none = (category: ImpactLine["category"], label: string): ImpactLine => ({ category, label, effect: "No change" });
  const currency = input.currency || record?.currency || String(record?.data?.currency ?? "CAD");
  const money = (value = input.amount) => formatWorkflowMoney(value, currency);
  if (["submitPurchaseOrder", "approvePurchaseOrder", "rejectPurchaseOrder", "amendPurchaseOrder", "cancelPurchaseOrder"].includes(kind)) return [none("Physical", "On-hand inventory"), { category: "Commercial", label: "Purchase order", effect: kind === "approvePurchaseOrder" ? "Approved; incoming forecast becomes actionable" : kind === "rejectPurchaseOrder" ? "Returned to buyer" : kind === "amendPurchaseOrder" ? `Revision ${(record?.revision ?? 1) + 1} created` : kind === "cancelPurchaseOrder" ? "Canceled; incoming supply and dedicated demand links released" : "Submitted for approval", tone: ["rejectPurchaseOrder", "cancelPurchaseOrder"].includes(kind) ? "warning" : "info" }, none("Financial", "Vendor payable"), { category: "Audit", label: "Decision", effect: "Actor, timestamp, reason, and revision recorded" }];
  if (kind === "confirmSalesOrder") return [none("Physical", "On-hand inventory"), { category: "Commercial", label: "Sales demand", effect: "Order confirmed; stock lines are reserved when availability permits", tone: "success" }, none("Financial", "Customer receivable"), { category: "Audit", label: "Confirmation", effect: "Availability, credit, address, actor, and reason checked" }];
  if (kind === "cancelSalesOrder") return [none("Physical", "On-hand inventory"), { category: "Commercial", label: "Sales demand", effect: "Open demand is canceled and active reservations are released", tone: "warning" }, none("Financial", "Posted invoices and payments"), { category: "Audit", label: "Cancellation", effect: "Reason and actor recorded" }];
  if (kind === "transferInventory") return [{ category: "Physical", label: "Location movement", effect: `${input.quantity} leaves ${input.source}; it enters ${input.destination} immediately within a warehouse or enters controlled transit between warehouses`, tone: "info" }, none("Physical", "Total company on hand"), none("Commercial", "Order demand"), none("Financial", "Inventory value")];
  if (kind === "receiveTransfer") return [{ category: "Physical", label: "Transfer receipt", effect: `${input.quantity} moves from controlled transit to the transfer destination`, tone: "success" }, none("Physical", "Total company on hand"), { category: "Commercial", label: "Destination availability", effect: `May increase by ${input.quantity} according to the destination status`, tone: "info" }, none("Financial", "Inventory value")];
  if (kind === "changeInventoryStatus") return [{ category: "Physical", label: "Inventory status", effect: `${input.quantity} moves from ${input.source} to destination ${input.destination}; the destination location controls its new status`, tone: "warning" }, none("Physical", "Total on hand"), { category: "Commercial", label: "Available to reserve", effect: "Changes only if source and destination availability statuses differ", tone: "warning" }, none("Financial", "Inventory value")];
  if (kind === "registerInventoryIdentity") return [none("Physical", "On-hand quantity"), { category: "Commercial", label: "Trace identity", effect: input.policyValue ? `Lot ${input.policyValue} registered for ${input.quantity}` : "Serial identity registered for one on-hand unit", tone: "info" }, none("Financial", "Inventory value"), { category: "Audit", label: "Traceability", effect: "Product, location, status, lot/serial, and source recorded" }];
  if (kind === "requestOverReceiptApproval") return [none("Physical", "On-hand inventory"), { category: "Commercial", label: "Receipt authorization", effect: `Requests permission for up to ${input.quantity} excess units; it does not receive them`, tone: "warning" }, none("Financial", "Vendor payable"), { category: "Audit", label: "Approval", effect: "PO line, limit, requester, and reason recorded" }];
  if (kind === "setValuationPolicy") return [none("Physical", "On-hand quantity"), none("Commercial", "Orders"), { category: "Financial", label: "Future valuation", effect: `${input.resolution.replaceAll("_", " ")} applies to future value entries${input.resolution === "standard" ? ` at ${money()}` : ""}`, tone: "warning" }, { category: "Audit", label: "Existing value entries", effect: "Remain immutable" }];
  if (kind === "scrapInventory") return [{ category: "Physical", label: "On-hand inventory", effect: `Decreases by ${input.quantity}`, tone: "danger" }, none("Commercial", "Open orders"), { category: "Financial", label: "Inventory valuation", effect: "Scrap expense posted", tone: "warning" }, { category: "Audit", label: "Scrap movement", effect: "Reason and source location linked" }];
  if (kind === "releaseReservation") return [none("Physical", "On-hand inventory"), { category: "Commercial", label: "Reserved quantity", effect: `Decreases by ${input.quantity}`, tone: "warning" }, { category: "Commercial", label: "Available now", effect: `Increases by ${input.quantity}`, tone: "success" }, none("Financial", "Customer balance")];
  if (kind === "reallocateReservation") return [none("Physical", "On-hand inventory"), { category: "Commercial", label: "Allocation", effect: `${input.quantity} moved to ${input.destination}`, tone: "info" }, none("Financial", "Customer balance"), { category: "Audit", label: "Reservation lineage", effect: "Old and new demand linked" }];
  if (kind === "reverseShipment") return [{ category: "Physical", label: "Controlled internal inventory", effect: `Increases by ${input.quantity} at the original shipment location`, tone: "success" }, { category: "Commercial", label: "Net shipped", effect: `Decreases by ${input.quantity}`, tone: "warning" }, { category: "Financial", label: "Invoice eligibility", effect: `Decreases by ${input.quantity}` }, { category: "Audit", label: "Correction", effect: `Linked to ${record?.number}` }];
  if (kind === "postDropShipDelivery") return [none("Physical", "Internal on-hand inventory"), { category: "Commercial", label: "Drop-ship delivered", effect: `Increases by ${input.quantity}`, tone: "success" }, { category: "Financial", label: "Invoice eligibility", effect: `Increases by ${input.quantity}`, tone: "info" }, { category: "Audit", label: "External proof", effect: "PO line, SO line, date, and supplier reference linked" }];
  if (kind === "reverseDropShipDelivery") return [none("Physical", "Internal on-hand inventory"), { category: "Commercial", label: "Net drop-ship delivered", effect: `Decreases by ${input.quantity}`, tone: "warning" }, { category: "Financial", label: "Invoice eligibility", effect: `Decreases by ${input.quantity}` }, { category: "Audit", label: "Delivery correction", effect: `Linked to ${record?.number}` }];
  if (kind === "allocateLandedCost") return [none("Physical", "On-hand quantity"), none("Commercial", "Orders"), { category: "Financial", label: "Inventory value", effect: `Increases by ${money()}`, tone: "info" }, { category: "Audit", label: "Cost layer", effect: "Receipt and source vendor bill linked" }];
  if (kind === "createVendorBill") {
    const details = input.financial;
    const rate = (details?.taxRate ?? 0) / 100;
    const itemSubtotal = input.quantity * input.amount + (input.extraItemsTotal ?? 0);
    const charges = (details?.freight ?? 0) + (details?.fees ?? 0) + (details?.deposit ?? 0) - (details?.discount ?? 0);
    // Refundable deposits are posted as tax-exempt liabilities. Including the deposit here
    // made the review total disagree with the durable bill the server would actually create.
    const chargeTax = [details?.freight ?? 0, details?.fees ?? 0, -(details?.discount ?? 0)].reduce((sum, value) => sum + Math.round(value * rate * 100) / 100, 0);
    const total = itemSubtotal + charges + Math.round(itemSubtotal * rate * 100) / 100 + chargeTax;
    return [none("Physical", "Inventory quantity"), none("Commercial", "Purchase commitment"), { category: "Financial", label: "Vendor payable", effect: input.fastTrack ? `Records ${money(total)} as author-approved; any three-way exception is signed off immediately` : `Records ${money(total)}; three-way exceptions place it on hold`, tone: "info" }, { category: "Audit", label: input.fastTrack ? "Self-authorization" : "Three-way match", effect: input.fastTrack ? "Signer, note, timestamp, PO, receipts, charges, and vendor reference linked" : "PO, cumulative receipts, charges, and vendor reference linked" }];
  }
  if (kind === "resolveMatchException") return [none("Physical", "Inventory quantity"), none("Commercial", "PO / receipt quantities"), { category: "Financial", label: "Bill exception", effect: input.resolution === "request-credit" ? `Posts a ${money()} vendor credit` : "Approves the recorded variance and releases the bill hold", tone: "warning" }, { category: "Audit", label: "Resolution", effect: "Decision and explanation recorded" }];
  if (kind === "approveVendorBill") return [none("Physical", "Inventory quantity"), none("Commercial", "PO / receipt quantities"), { category: "Financial", label: "Vendor bill", effect: "Match hold is released; recorded payable amount is unchanged", tone: "success" }, { category: "Audit", label: "Variance approval", effect: "Approver and reason recorded" }];
  if (kind === "createVendorCredit") return [none("Physical", "Inventory quantity"), none("Commercial", "PO / receipt quantities"), { category: "Financial", label: "Vendor payable", effect: `Decreases by ${money()}`, tone: "warning" }, { category: "Audit", label: "Vendor credit", effect: "Original bill and reason linked" }];
  if (kind === "recordVendorPayment") return [none("Physical", "Inventory"), none("Commercial", "Purchasing"), { category: "Financial", label: "Vendor payable", effect: `Decreases by ${money()}`, tone: "success" }, { category: "Financial", label: "Cash disbursement", effect: money() }];
  if (kind === "createCustomerInvoice") return [none("Physical", "On-hand inventory"), none("Commercial", "Net delivered quantity"), { category: "Financial", label: "Customer receivable", effect: `Increases by ${money()}`, tone: "info" }, { category: "Audit", label: "Invoice source", effect: "Only delivered, not-yet-invoiced lines and eligible charges are linked" }];
  if (kind === "issueCustomerCredit") return [none("Physical", "On-hand inventory"), none("Commercial", "Return or replacement demand"), { category: "Financial", label: "Customer receivable", effect: `Decreases by ${money()}`, tone: "warning" }, { category: "Audit", label: "Credit", effect: "Reason and original invoice linked" }];
  if (kind === "recordCustomerPayment") return [none("Physical", "Inventory"), none("Commercial", "Order fulfillment"), { category: "Financial", label: "Customer receivable", effect: `Decreases by ${money()}`, tone: "success" }, { category: "Financial", label: "Cash receipt", effect: money() }];
  if (kind === "voidCustomerInvoice") return [none("Physical", "Inventory"), none("Commercial", "Delivered quantity"), { category: "Financial", label: "Customer receivable", effect: `Removes the unpaid invoice balance${record?.amount != null ? ` of ${money(record.amount)}` : ""}`, tone: "warning" }, { category: "Audit", label: "Invoice", effect: "Marked void; original record remains visible" }];
  if (kind === "addDocumentCharge") { const signed = input.source === "subtract" ? -input.amount : input.amount; const tax = Math.round(Math.abs(signed) * (input.financial?.taxRate ?? 0)) / 100 * Math.sign(signed); return [none("Physical", "Inventory quantity"), none("Commercial", "Item lines"), { category: "Financial", label: "Document total", effect: `${signed < 0 ? "Decreases" : "Increases"} by ${money(Math.abs(signed + tax))} including configured tax`, tone: signed < 0 ? "warning" : "info" }, { category: "Audit", label: "Separate charge", effect: "Type, description, direction, tax, and actor recorded" }]; }
  if (kind === "issueReturnableAsset") return [{ category: "Physical", label: "Asset custody", effect: `${input.quantity} issued to customer`, tone: "info" }, none("Commercial", "Saleable inventory"), { category: "Financial", label: "Refundable deposit receipt", effect: `${formatWorkflowMoney(input.amount * input.quantity, "CAD")} posts to cash and deposit liability` }, { category: "Audit", label: "Asset ledger", effect: "Asset type, customer, payment method, and reference linked" }];
  if (kind === "returnReturnableAsset") return [{ category: "Physical", label: "Asset custody", effect: `${input.quantity} returned to internal custody`, tone: "success" }, none("Commercial", "Window inventory"), { category: "Financial", label: "Deposit", effect: "Refund remains pending explicit action" }, { category: "Audit", label: "Asset return", effect: `Linked to ${record?.number}` }];
  if (kind === "forfeitReturnableAsset") return [none("Physical", "Window inventory"), { category: "Commercial", label: "Asset custody", effect: "Closed as not returned", tone: "warning" }, { category: "Financial", label: "Deposit", effect: "Recognized as forfeited", tone: "warning" }, { category: "Audit", label: "Forfeiture", effect: "Reason and customer recorded" }];
  if (kind === "refundAssetDeposit") return [none("Physical", "Asset custody"), none("Commercial", "Orders"), { category: "Financial", label: "Customer deposit liability", effect: `Decreases by ${money()}`, tone: "success" }, { category: "Audit", label: "Refund", effect: `Linked to ${record?.number}` }];
  if (["approveApproval", "rejectApproval"].includes(kind)) return [none("Physical", "Inventory"), { category: "Commercial", label: "Authorization", effect: kind === "approveApproval" ? "Approved for later use by the exact scoped command" : "Rejected; no command is authorized", tone: kind === "approveApproval" ? "success" : "warning" }, none("Financial", "Balances"), { category: "Audit", label: "Approval decision", effect: "Decision, actor, reason, and scope recorded" }];
  if (kind === "updatePolicy") return [none("Physical", "Existing inventory"), { category: "Commercial", label: "Future transactions", effect: `Policy changes to “${input.policyValue}”`, tone: "warning" }, none("Financial", "Existing postings"), { category: "Audit", label: "Policy version", effect: "Old value, new value, actor, and reason recorded" }];
  if (kind === "lockPeriod") return [none("Physical", "Existing inventory"), none("Commercial", "Existing documents"), { category: "Financial", label: "Posting control", effect: `${input.resolution} postings on or before the selected date will be rejected`, tone: "warning" }, { category: "Audit", label: "Period lock", effect: "Module, cutoff, actor, and reason recorded" }];
  if (kind === "unlockPeriod") return [none("Physical", "Existing inventory"), none("Commercial", "Existing documents"), { category: "Financial", label: "Posting control", effect: "The selected lock is removed; future back-dated posts are allowed subject to other controls", tone: "warning" }, { category: "Audit", label: "Period unlock", effect: "Actor and reason recorded" }];
  if (kind === "updateUserRole") return [none("Physical", "Inventory"), none("Commercial", "Documents"), none("Financial", "Balances"), { category: "Audit", label: "Access control", effect: `Role becomes ${input.resolution}; account becomes ${input.policyValue}`, tone: "warning" }];
  return [none("Physical", "Inventory"), none("Commercial", "Orders"), none("Financial", "Balances"), { category: "Audit", label: "Command", effect: "Recorded with idempotency protection" }];
}

function ImpactReview({ lines }: { lines: ImpactLine[] }) {
  return <section className="workflow-impact" aria-labelledby="workflow-impact-title"><header><span aria-hidden="true">⇄</span><div><h3 id="workflow-impact-title">Review business impact</h3><p>Server validation remains authoritative when you post.</p></div></header><div>{lines.map((line) => <div key={`${line.category}-${line.label}`} className={`workflow-impact-line ${line.tone ?? "neutral"}`}><span><small>{line.category}</small>{line.label}</span><strong>{line.effect}</strong></div>)}</div></section>;
}

function tabCount(workspace: OperationsWorkspaceKind, tab: string, state: WorkflowState) {
  if (workspace === "purchasing" && tab === "approvals") return state.purchaseOrders.filter((record) => record.status.toLowerCase().includes("pending")).length;
  if (workspace === "vendor-billing" && tab === "match") return state.vendorBills.filter((record) => record.exception).length;
  if (workspace === "inventory" && tab === "returnables") return state.assets.filter((record) => !/closed/i.test(record.status)).length;
  if ((workspace === "inventory" || workspace === "controls") && tab === "approvals") return state.approvals.filter((record) => /pending/i.test(record.status) && ["inventory_count_variance", "over_receipt"].includes(String(record.data?.requestType ?? ""))).length;
  return 0;
}

function requiresReason(kind: WorkflowActionKind) {
  return ["submitPurchaseOrder", "approvePurchaseOrder", "rejectPurchaseOrder", "amendPurchaseOrder", "cancelPurchaseOrder", "confirmSalesOrder", "cancelSalesOrder", "approveApproval", "rejectApproval", "requestOverReceiptApproval", "transferInventory", "changeInventoryStatus", "scrapInventory", "releaseReservation", "reallocateReservation", "reverseShipment", "reverseDropShipDelivery", "resolveMatchException", "approveVendorBill", "createVendorCredit", "issueCustomerCredit", "voidCustomerInvoice", "issueReturnableAsset", "returnReturnableAsset", "forfeitReturnableAsset", "refundAssetDeposit", "updatePolicy", "lockPeriod", "unlockPeriod", "updateUserRole"].includes(kind);
}

function workflowValidationError(action: ActionDefinition, state: WorkflowState, input: WorkflowPayloadInput): string | null {
  if (requiresReason(action.kind) && !input.reason.trim()) return "Enter a reason so this action is traceable.";
  const positiveQuantity = Number.isFinite(input.quantity) && input.quantity > 0;
  const positiveAmount = Number.isFinite(input.amount) && input.amount > 0;
  const sourceData = input.referenceData ?? state.options.products.find((option) => option.id === input.reference)?.data;
  const trackingPolicy = String(sourceData?.trackingPolicy ?? "");

  if (["transferInventory", "changeInventoryStatus"].includes(action.kind)) {
    if (!input.reference || !input.source || !input.destination) return "Select a product, source location, and destination location.";
    if (input.source === input.destination) return "Source and destination locations must be different.";
    if (!positiveQuantity) return "Quantity must be greater than zero.";
  }
  if (["receiveTransfer", "releaseReservation", "reverseShipment", "reverseDropShipDelivery", "returnReturnableAsset", "forfeitReturnableAsset"].includes(action.kind) && !positiveQuantity) return "Quantity must be greater than zero.";
  if (action.kind === "receiveTransfer" && action.record?.quantity != null && input.quantity > action.record.quantity) return "Receipt quantity cannot exceed the remaining in-transit quantity.";
  if (["transferInventory", "changeInventoryStatus", "receiveTransfer", "scrapInventory", "reverseShipment", "reverseDropShipDelivery", "allocateLandedCost", "createVendorBill", "createCustomerInvoice", "createVendorCredit", "issueCustomerCredit", "recordVendorPayment", "recordCustomerPayment", "issueReturnableAsset", "returnReturnableAsset", "forfeitReturnableAsset", "refundAssetDeposit"].includes(action.kind) && !input.financial.postingDate) return "Select the posting date.";
  if (action.kind === "requestOverReceiptApproval" && (!input.reference || !positiveQuantity)) return "Select a purchase-order line and enter a positive excess limit.";
  if (action.kind === "registerInventoryIdentity") {
    if (!input.reference || !input.source) return "Select the traced product and its current location.";
    if (trackingPolicy === "quantity") return "Select a lot- or serial-tracked product; quantity-only products do not have identities.";
    if (trackingPolicy === "lot" && (!input.policyValue.trim() || !positiveQuantity)) return "Enter the lot number and a positive lot quantity.";
    if (trackingPolicy === "serial" && !input.externalReference.trim()) return "Enter the serial number.";
    if (!trackingPolicy && !input.policyValue.trim() && !input.externalReference.trim()) return "Enter a lot or serial number for the selected product.";
  }
  if (action.kind === "setValuationPolicy" && (!(action.record?.id ?? input.reference) || !["fifo", "average", "standard"].includes(input.resolution))) return "Select a product and valuation method.";
  if (action.kind === "setValuationPolicy" && input.resolution === "standard" && (!Number.isFinite(input.amount) || input.amount < 0)) return "Standard cost cannot be negative.";
  if (action.kind === "reallocateReservation" && (!input.reference || !input.destination || !positiveQuantity)) return "Select the new demand, target location, and a positive quantity.";
  if (action.kind === "postDropShipDelivery" && (!input.reference || !positiveQuantity || !input.externalReference.trim() || !input.financial.dueDate)) return "Select the drop-ship line and enter quantity, delivery date, and supplier proof.";
  if (action.kind === "amendPurchaseOrder" && (!input.reference || !positiveQuantity)) return "Select a purchase-order line and enter its revised quantity.";
  if (action.kind === "createVendorBill") {
    if (!input.reference || !positiveQuantity || !positiveAmount || !input.externalReference.trim() || !input.financial.dueDate) return "Select a PO line and enter the invoice number, positive quantity, unit cost, invoice date, and due date.";
    const extras = input.extraLines ?? [];
    if (extras.some((line) => !line.lineId)) return "Choose a purchase-order line for every added invoice line, or remove the empty one.";
    if (extras.some((line) => !(line.quantity > 0) || !(line.unitCost > 0))) return "Every added invoice line needs a positive quantity and unit cost.";
    const lineIds = [input.reference, ...extras.map((line) => line.lineId)];
    if (new Set(lineIds).size !== lineIds.length) return "The same purchase-order line appears twice on this bill. Bill it once with the combined quantity.";
    // The server anchors the bill to one purchase order and rejects the whole document if any
    // line belongs elsewhere, so name the offending line here instead of failing on post.
    const primaryPurchaseOrderId = String(input.referenceData?.purchaseOrderId ?? "");
    if (primaryPurchaseOrderId && extras.some((line) => line.purchaseOrderId && line.purchaseOrderId !== primaryPurchaseOrderId)) return "Every line on one vendor bill must belong to the same purchase order. Post a separate bill for the other order.";
    if (input.fastTrack && !input.reason.trim()) return "Enter an authorization note before creating and approving this vendor bill.";
  }
  if (action.kind === "createCustomerInvoice" && (!input.reference || !positiveAmount || !input.financial.dueDate)) return "Select an order with a positive invoiceable balance, invoice date, and due date.";
  if (["createVendorBill", "createCustomerInvoice"].includes(action.kind) && input.financial.dueDate < input.financial.postingDate) return "Due date cannot be before the invoice date.";
  if (action.kind === "allocateLandedCost" && (!input.reference || !input.externalReference || !positiveAmount)) return "Select a cost layer, source vendor bill, and positive amount.";
  if (["createVendorCredit", "issueCustomerCredit", "recordVendorPayment", "recordCustomerPayment", "refundAssetDeposit"].includes(action.kind) && !positiveAmount) return "Amount must be greater than zero.";
  if (["createVendorCredit", "issueCustomerCredit", "recordVendorPayment", "recordCustomerPayment"].includes(action.kind) && action.record && input.amount > documentOutstandingAmount(action.record)) return "Amount cannot exceed the document's outstanding balance.";
  if (action.kind === "refundAssetDeposit" && action.record?.amount != null && input.amount > action.record.amount) return "Refund cannot exceed the deposit attributable to returned assets.";
  if (["recordVendorPayment", "recordCustomerPayment"].includes(action.kind) && !input.externalReference.trim()) return "Enter the payment reference.";
  if (action.kind === "resolveMatchException" && input.resolution === "request-credit" && (!positiveAmount || !input.financial.postingDate)) return "Enter a positive vendor-credit amount and credit date.";
  if (action.kind === "resolveMatchException" && input.resolution === "request-credit" && action.record && input.amount > documentOutstandingAmount(action.record)) return "Vendor credit cannot exceed the bill's outstanding balance.";
  if (action.kind === "addDocumentCharge" && (!positiveAmount || !input.externalReference.trim())) return "Enter the charge description and a positive amount.";
  if (action.kind === "addDocumentCharge" && input.resolution === "discount" && input.source !== "subtract") return "Discounts must subtract from the document total.";
  if (action.kind === "issueReturnableAsset" && (!input.reference || !input.resolution || !positiveQuantity)) return "Select a customer and asset type, then enter a positive quantity.";
  if (action.kind === "issueReturnableAsset" && input.amount * input.quantity > 0 && (!input.source || !input.externalReference.trim())) return "Select the deposit method and enter its payment reference.";
  if (action.kind === "lockPeriod" && !input.financial.dueDate) return "Select the period-lock cutoff date.";
  if (action.kind === "updatePolicy" && !input.policyValue.trim()) return "Enter the new policy value.";
  if (action.kind === "updatePolicy") { try { typedPolicyValue(action.record?.id ?? "", input.policyValue); } catch (caught) { return caught instanceof Error ? caught.message : "Enter a valid policy value."; } }
  return null;
}

function actionTitle(kind: WorkflowActionKind) { return kind.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase()); }
function columnLabel(column: keyof WorkflowRecord) { return ({ number: "Record", party: "Vendor / customer", reference: "Related documents", amount: "Amount", currency: "Currency", quantity: "Quantity", status: "Status", detail: "Details", version: "Version", revision: "Revision", exception: "Exception", issuedOn: "Issued", dueOn: "Due", data: "Data", id: "ID" } as Record<keyof WorkflowRecord, string>)[column]; }
function renderRecordValue(column: keyof WorkflowRecord, value: WorkflowRecord[keyof WorkflowRecord], currency?: string) { if (column === "amount" && typeof value === "number") return formatWorkflowMoney(value, currency); if (column === "status" && value) return <StatusPill>{String(value)}</StatusPill>; if ((column === "issuedOn" || column === "dueOn") && value) return formatWorkflowDate(String(value)); return value === undefined || value === null || value === "" ? <span className="workflow-muted">—</span> : String(value); }

const workflowDate = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric" });
function formatWorkflowDate(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : workflowDate.format(parsed);
}

function normalizeLiveWorkflowState(input: unknown, snapshotInput?: unknown): WorkflowState {
  const empty = emptyWorkflowState();
  if (!input || typeof input !== "object") return empty;
  const raw = input as Record<string, unknown>;
  const core = snapshotInput && typeof snapshotInput === "object" ? snapshotInput as Record<string, unknown> : {};
  const rows = (value: unknown) => Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  const text = (row: Record<string, unknown>, ...keys: string[]) => { const value = keys.map((key) => row[key]).find((item) => item !== undefined && item !== null && item !== ""); return value === undefined ? "" : String(value); };
  const number = (row: Record<string, unknown>, ...keys: string[]) => Number(keys.map((key) => row[key]).find((item) => item !== undefined && item !== null) ?? 0);
  const jsonRecord = (value: unknown) => { try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } };
  const jsonArray = (value: unknown) => { try { return typeof value === "string" ? JSON.parse(value) as unknown : value; } catch { return []; } };
  const human = (value: unknown) => String(value ?? "unknown").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const makeOption = (row: Record<string, unknown>, keys: string[], detail?: string): SelectOption => ({ id: text(row, "id", "userId", "productId"), label: keys.map((key) => row[key]).filter((value) => value !== undefined && value !== null && value !== "").join(" · ") || text(row, "id"), detail, version: number(row, "version") || undefined, status: text(row, "lifecycleStatus", "status") || undefined, data: row });
  const purchaseOrders = rows(core.purchaseOrders).length ? rows(core.purchaseOrders) : rows(raw.purchaseOrders);
  const salesOrders = rows(core.salesOrders).length ? rows(core.salesOrders) : rows(raw.salesOrders);
  const products = rows(core.products).length ? rows(core.products) : rows(raw.products);
  const partners = rows(core.partners).length ? rows(core.partners) : rows(raw.businessPartners);
  const locations = rows(raw.locations).length ? rows(raw.locations) : rows(core.locations);
  const capabilities = raw.permissions && typeof raw.permissions === "object" ? raw.permissions as Record<string, unknown> : {};
  const actions = capabilities.actions && typeof capabilities.actions === "object" ? capabilities.actions as Record<string, boolean> : {};
  const permissions: Record<string, boolean> = { ...Object.fromEntries(Object.entries(capabilities).filter(([, value]) => typeof value === "boolean")) as Record<string, boolean>, ...actions };
  const permissionLabels = [["canOperate", "Operational posting"], ["canPostFinancial", "Financial posting"], ["canApprove", "Approval decisions"], ["canAdminister", "System administration"], ["canExport", "Data export"]].filter(([key]) => permissions[key] === true).map(([, label]) => label);
  const actor = raw.currentUser && typeof raw.currentUser === "object" ? raw.currentUser as Record<string, unknown> : null;
  const summaryTotals = raw.summary && typeof raw.summary === "object" ? raw.summary as Record<string, unknown> : {};
  const poRecords: WorkflowRecord[] = purchaseOrders.map((row) => ({ id: text(row, "id"), number: text(row, "number", "id"), status: human(row.lifecycleStatus), party: text(row, "vendorName"), reference: text(row, "projectReference", "expectedDate"), amount: number(row, "totalCents") / 100, currency: text(row, "currency") || "CAD", quantity: number(row, "orderedQuantity"), version: number(row, "version") || undefined, revision: number(row, "revisionNumber") || 1,
    issuedOn: text(row, "orderDate"), dueOn: text(row, "expectedDate"), requester: text(row, "buyerName"), note: text(row, "submissionNote"),
    // An approver was previously shown a vendor and a number. What is being bought, by whom,
    // and the justification they were required to type all lived elsewhere.
    // The core snapshot attaches `lines` directly; the purchasing workflow query returns them
    // as JSON so one narrow row can still carry its detail.
    lines: rows(row.lines ?? jsonArray(row.linesJson)).map((line, index) => {
      const quantity = number(line, "orderedUomQuantity") || number(line, "orderedQuantity");
      const unitAmount = (number(line, "orderedUomUnitCostCents") || number(line, "unitCostCents")) / 100;
      return { id: text(line, "id") || `${text(row, "id")}-${index}`, sku: text(line, "sku"), product: text(line, "productName"), quantity, unitAmount, amount: quantity * unitAmount - number(line, "discountCents") / 100 };
    }) }));
  const revisionRecords: WorkflowRecord[] = rows(raw.purchaseRevisions).map((row) => {
    const snapshot = jsonRecord(row.snapshotJson);
    const order = purchaseOrders.find((candidate) => text(candidate, "id") === text(row, "purchaseOrderId"));
    return { id: text(row, "id"), number: `${text(snapshot, "number") || text(order ?? {}, "number") || text(row, "purchaseOrderId")} · Rev ${number(row, "revisionNumber")}`, status: human(row.lifecycleStatus), party: text(order ?? {}, "vendorName") || text(row, "createdBy"), reference: text(snapshot, "expectedDate") || text(row, "purchaseOrderId"), amount: number(snapshot, "totalCents") / 100 || undefined, revision: number(row, "revisionNumber"), detail: `${text(row, "reason")}${text(row, "createdBy") ? ` · ${text(row, "createdBy")}` : ""}` };
  });
  const transferRecords: WorkflowRecord[] = rows(raw.transfers).map((row) => ({ id: text(row, "id"), number: text(row, "number", "id"), status: human(row.status), reference: `${text(row, "fromLocationId")} → ${text(row, "toLocationId")}`, quantity: Math.max(number(row, "quantity") - number(row, "receivedQuantity"), 0), detail: `${text(row, "productId")} · ${number(row, "receivedQuantity")} received`, version: number(row, "version") || undefined, data: row }));
  const serialTraceRecords: TraceUnit[] = rows(raw.units).map((row) => ({ id: text(row, "id"), sku: text(row, "sku", "productId"), serial: text(row, "serialNumber") || "Serial not recorded", lot: text(row, "lotNumber") || "No lot", location: text(row, "locationCode", "locationId"), status: human(row.inventoryStatus ?? row.lifecycleStatus), customer: text(row, "allocatedSalesOrderLineId") || undefined, receivedOn: text(row, "createdAt").slice(0, 10) || "Date unavailable", source: text(row, "sourceDocument") || "Registered against on-hand inventory" }));
  const lotTraceRecords: TraceUnit[] = rows(raw.lots).map((row) => ({ id: `${text(row, "id")}:${text(row, "locationId") || "unlocated"}`, sku: text(row, "sku", "productId"), serial: `${number(row, "currentQuantity")} units`, lot: text(row, "lotNumber"), location: text(row, "locationCode", "locationId") || "No current on-hand location", status: human(row.status), receivedOn: text(row, "createdAt").slice(0, 10) || "Date unavailable", source: text(row, "vendorId") ? `Vendor ${text(row, "vendorId")}` : "Registered lot" }));
  const traceRecords = [...serialTraceRecords, ...lotTraceRecords];
  const reservationRecords: WorkflowRecord[] = rows(raw.reservations).map((row) => ({ id: text(row, "id"), number: text(row, "number", "id"), status: human(row.status), party: text(row, "customerName"), reference: text(row, "salesOrderNumber", "salesOrderLineId"), quantity: number(row, "quantity"), detail: text(row, "sku", "productId"), version: number(row, "version") || undefined }));
  const rawShipments = rows(raw.shipments);
  const shipmentRows = rawShipments.length ? rawShipments : rows(core.movements).filter((row) => text(row, "sourceDocumentType") === "shipment" && text(row, "type") === "sales_shipment");
  const shipmentRecords: WorkflowRecord[] = shipmentRows.map((row) => { const shipmentId = text(row, "sourceDocumentId", "id"); const lineId = text(row, "lineId", "sourceLineId"); const salesOrder = text(row, "salesOrderNumber", "sourceDocumentId"); const product = text(row, "sku", "productName"); return { id: `${shipmentId}:${lineId || text(row, "id")}`, number: text(row, "number", "sourceDocumentId"), status: human(row.status ?? "posted"), party: text(row, "customerName"), reference: [salesOrder, product].filter(Boolean).join(" · "), quantity: Math.abs(number(row, "quantity", "shippedQuantity")), detail: text(row, "productName", "sku"), version: number(row, "version") || undefined, data: { ...row, shipmentId, lineId } }; });
  const dropShipRecords: WorkflowRecord[] = rows(raw.dropShipDeliveries).map((row) => ({ id: text(row, "id"), number: text(row, "number", "id"), status: human(row.status), party: text(row, "productName"), reference: `${text(row, "purchaseOrderNumber")} · ${text(row, "salesOrderNumber")}`, quantity: number(row, "netDeliveredQuantity"), detail: `${text(row, "sku")} · delivered ${number(row, "quantity")} · reversed ${number(row, "reversedQuantity")} · ${text(row, "deliveryDate")} · ${text(row, "externalReference")}`, version: number(row, "version") || undefined }));
  const vendorBillRows = rows(raw.vendorBills);
  const vendorBillRecords: WorkflowRecord[] = vendorBillRows.map((row) => { const outstanding = Math.max(number(row, "total_cents", "totalCents") - number(row, "paid_cents", "paidCents") - number(row, "credited_cents", "creditedCents"), 0); const currency = text(row, "currency") || "CAD"; return { id: text(row, "id"), number: text(row, "number", "id"), status: human(row.status), party: text(row, "vendorName"), reference: [text(row, "purchaseOrderNumber"), text(row, "vendor_invoice_number", "vendorInvoiceNumber")].filter(Boolean).join(" · "), amount: number(row, "total_cents", "totalCents") / 100, currency, version: number(row, "version") || undefined, issuedOn: text(row, "invoice_date", "invoiceDate"), dueOn: text(row, "due_date", "dueDate"), exception: text(row, "match_status", "matchStatus") === "exception" ? text(row, "hold_reason", "holdReason") || "Three-way match exception" : undefined, detail: `${formatWorkflowMoney(outstanding / 100, currency)} outstanding`, data: row }; });
  const invoiceRows = rows(raw.customerInvoices);
  const invoiceRecords: WorkflowRecord[] = invoiceRows.map((row) => ({ id: text(row, "id"), number: text(row, "number", "id"), status: human(row.status), party: text(row, "customerName"), reference: text(row, "salesOrderNumber"), amount: number(row, "total_cents", "totalCents") / 100, currency: text(row, "currency") || "CAD", version: number(row, "version") || undefined, issuedOn: text(row, "invoice_date", "invoiceDate"), dueOn: text(row, "due_date", "dueDate"), detail: `${formatWorkflowMoney(Math.max(number(row, "total_cents", "totalCents") - number(row, "paid_cents", "paidCents") - number(row, "credited_cents", "creditedCents"), 0) / 100, text(row, "currency") || "CAD")} outstanding`, data: row }));
  const valuationRecords: WorkflowRecord[] = rows(raw.costLayers).map((row) => ({ id: text(row, "id"), number: text(row, "sku", "productId"), status: human(row.status ?? "open layer"), quantity: number(row, "remaining_qty", "remainingQty"), amount: number(row, "remaining_qty", "remainingQty") * (number(row, "unit_cost_cents", "unitCostCents") + number(row, "landed_cost_cents", "landedCostCents")) / 100, detail: text(row, "reference_id", "referenceId") }));
  const assetRecords: AssetRecord[] = rows(raw.returnableObligations).map((row) => { const refundable = number(row, "refundableDepositCents", "refundable_deposit_cents") / 100; return { id: text(row, "id"), number: text(row, "number", "id"), status: human(row.status), assetType: text(row, "assetName", "assetCode"), customer: text(row, "partnerName"), party: text(row, "partnerName"), deposit: number(row, "depositBalanceCents", "deposit_balance_cents") / 100, amount: refundable, issued: number(row, "issued_qty", "issuedQuantity"), returned: number(row, "returned_qty", "returnedQuantity"), quantity: number(row, "outstandingQuantity", "outstanding_quantity"), reference: text(row, "source_document_id", "sourceDocumentId"), detail: `${number(row, "outstandingQuantity", "outstanding_quantity")} outstanding · ${formatWorkflowMoney(refundable)} refundable now`, version: number(row, "version") || undefined, data: row }; });
  const approvalRecords: WorkflowRecord[] = rows(raw.approvals).map((row) => { const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {}; const requestType = text(row, "requestType"); const product = products.find((item) => text(item, "id") === text(row, "entityId")); const count = requestType === "inventory_count_variance"; return { id: text(row, "id"), number: count ? `Count variance · ${text(product ?? {}, "sku", "name") || text(row, "entityId")}` : `${human(requestType)} · ${text(row, "entityId")}`, status: human(row.status), party: text(row, "requestedBy"), reference: `${text(metadata, "locationId", "purchaseOrderId")} · ${text(row, "requestedAt")}`, quantity: number(metadata, count ? "absoluteVariance" : "maxExcessQuantity"), version: number(row, "version") || undefined, detail: count ? `Book ${number(metadata, "recordedQuantity")} → counted ${number(metadata, "countedQuantity")} · ${text(row, "requestedReason")}` : `${text(row, "requestedReason")} · maximum excess ${number(metadata, "maxExcessQuantity")}`, data: row }; });
  const policyRecords: PolicyRecord[] = rows(raw.settings).map((row) => ({ id: text(row, "key", "id"), name: text(row, "key"), value: typeof row.value === "string" ? row.value : JSON.stringify(row.value), description: text(row, "description"), risk: "Changes future transactions only", version: number(row, "version") || undefined, data: row }));
  const periodLockRecords: WorkflowRecord[] = rows(raw.periodLocks).map((row) => ({ id: text(row, "id"), number: human(row.module), status: number(row, "active") ? "Active" : "Unlocked", reference: `Through ${text(row, "lockedThrough")}`, detail: text(row, "reason"), version: number(row, "version") || undefined, data: row }));
  const valuationPolicyRecords: WorkflowRecord[] = rows(raw.valuationPolicies).map((row) => ({ id: text(row, "product_id", "productId"), number: `${text(row, "sku")} · ${text(row, "productName")}`, status: human(row.method), amount: number(row, "standard_cost_cents", "standardCostCents") / 100, detail: `Average ${money0(number(row, "average_cost_cents", "averageCostCents"))}`, version: number(row, "version") || undefined, data: row }));
  const userRecords: WorkflowRecord[] = rows(raw.users).map((row) => ({ id: text(row, "userId"), number: text(row, "fullName", "email"), party: text(row, "email"), status: number(row, "active") ? "Active" : "Disabled", detail: human(row.role), version: number(row, "version") || undefined, data: row }));
  const outboxRecords: WorkflowRecord[] = rows(raw.outbox).map((row) => { const lastError = text(row, "lastError"); return { id: text(row, "id"), number: text(row, "eventType"), party: human(row.aggregateType), reference: text(row, "aggregateId"), status: human(row.status), detail: `${number(row, "attempts")} attempt(s) · available ${text(row, "availableAt")}${lastError ? ` · Last error: ${lastError}` : ""}`, data: row }; });
  const marginRuleRecords: WorkflowRecord[] = rows(raw.marginRules).map((row) => {
    const scope = text(row, "sku") ? `Product ${text(row, "sku")}` : text(row, "category") ? `Category ${text(row, "category")}` : "All products";
    const maximum = row.maximumCostCents == null ? "and up" : `to ${formatWorkflowMoney(number(row, "maximumCostCents") / 100)}`;
    return { id: text(row, "id"), number: `${text(row, "code")} · ${text(row, "name")}`, status: number(row, "active") ? "Active" : "Inactive", party: `${scope} · ${(number(row, "targetMarginBps") / 100).toFixed(2)}% margin`, reference: `${formatWorkflowMoney(number(row, "minimumCostCents") / 100)} ${maximum}`, detail: `Minimum profit ${formatWorkflowMoney(number(row, "minimumGrossProfitCents") / 100)} · round to ${formatWorkflowMoney(number(row, "roundingIncrementCents") / 100)}`, version: number(row, "version") || undefined, data: row };
  });
  const priceListOptions = rows(raw.priceLists).filter((row) => number(row, "active") !== 0).map((row) => makeOption(row, ["code", "name"], text(row, "currency")));
  const priceAssignmentRecords: WorkflowRecord[] = rows(raw.priceListAssignments).map((row) => ({ id: text(row, "id"), number: text(row, "priceListCode"), status: number(row, "active") ? "Active" : "Inactive", party: text(row, "partnerName"), reference: `Priority ${number(row, "priority")}`, version: number(row, "version") || undefined, data: row }));
  const priceEntryRecords: WorkflowRecord[] = rows(raw.priceListEntries).map((row) => ({ id: text(row, "id"), number: `${text(row, "priceListCode")} · ${text(row, "sku")}`, status: number(row, "active") ? "Active" : "Inactive", party: `${text(row, "productName")} · ${text(row, "uomCode")}`, quantity: number(row, "minimumQuantity"), amount: number(row, "unitPriceCents") / 100, currency: text(row, "currency") || "CAD", version: number(row, "version") || undefined, data: row }));
  const uomRows = rows(raw.uoms); const uomById = new Map(uomRows.map((row) => [text(row, "id"), text(row, "code", "name")])); const productById = new Map(rows(raw.products).map((row) => [text(row, "id"), `${text(row, "sku")} · ${text(row, "name")}`]));
  const uomConversionRecords: WorkflowRecord[] = rows(raw.uomConversions).map((row) => ({ id: text(row, "id"), number: `${uomById.get(text(row, "fromUomId")) ?? text(row, "fromUomId")} → ${uomById.get(text(row, "toUomId")) ?? text(row, "toUomId")}`, status: "Active", party: productById.get(text(row, "productId")) ?? "All products in dimension", quantity: number(row, "numerator") / Math.max(number(row, "denominator"), 1), detail: `1 source = ${number(row, "numerator")} ÷ ${number(row, "denominator")} destination · ${text(row, "roundingMode")}` }));
  const orphanedLocationRecords: WorkflowRecord[] = rows(core.orphanedLocations).map((row) => ({ id: text(row, "locationId"), number: text(row, "locationId"), status: "Missing location", quantity: number(row, "balanceUnits"), detail: `${number(row, "balanceRows")} balance row(s) · ${number(row, "movementRows")} movement reference(s)` }));
  const auditRecords: AuditRecord[] = rows(raw.auditEvents).concat(rows(core.activities)).map((row) => ({ id: text(row, "id"), time: text(row, "createdAt", "time"), actor: text(row, "actor") || "System", action: human(text(row, "action")), record: text(row, "entityId", "record"), impact: text(row, "summary", "detail", "impact"), category: /invoice|bill|payment|credit/i.test(text(row, "action")) ? "Financial" : /receipt|shipment|inventory|transfer|scrap/i.test(text(row, "action")) ? "Physical" : "Commercial" }));
  const attachmentRecords: AttachmentRecord[] = rows(raw.attachments).map((row) => ({ id: text(row, "id"), fileName: text(row, "fileName"), type: text(row, "category", "contentType"), document: `${text(row, "documentType")} · ${text(row, "documentId")}`, status: "Stored", uploadedBy: text(row, "ownerEmail", "ownerId"), time: text(row, "uploadedAt"), href: `/api/attachments/${encodeURIComponent(text(row, "id"))}`, ownerId: text(row, "ownerId"), documentType: text(row, "documentType"), documentId: text(row, "documentId") }));
  const salesOrderLines = salesOrders.flatMap((order) => rows(order.lines).map((line) => ({ id: text(line, "id"), label: `${text(order, "number")} · ${text(line, "sku", "productName")}${text(line, "fulfillmentRoute") ? ` · ${human(line.fulfillmentRoute)}` : ""}`, detail: text(line, "productId"), version: number(order, "version") || undefined, status: text(line, "fulfillmentRoute"), data: { ...line, salesOrderId: text(order, "id"), salesOrderVersion: number(order, "version") } })));
  const purchaseOrderLines = purchaseOrders.flatMap((order) => rows(order.lines).map((line) => ({ id: text(line, "id"), label: `${text(order, "number")} · ${text(line, "sku", "productName")}`, detail: text(order, "id"), version: number(order, "version") || undefined, data: { ...line, purchaseOrderId: text(order, "id"), purchaseOrderVersion: number(order, "version"), currency: text(order, "currency") || "CAD", exchangeRateToBase: number(order, "exchangeRateToBase", "exchange_rate_to_base") || 1, paymentTerms: text(order, "paymentTerms", "payment_terms") || "Net 30", dueDate: text(order, "dueDate", "due_date") || today } })));
  return { purchaseOrders: poRecords, revisions: revisionRecords, transfers: transferRecords, traceUnits: traceRecords, reservations: reservationRecords, shipments: shipmentRecords, dropShipDeliveries: dropShipRecords, vendorBills: vendorBillRecords, customerInvoices: invoiceRecords, valuations: valuationRecords, assets: assetRecords, approvals: approvalRecords, policies: policyRecords, periodLocks: periodLockRecords, valuationPolicies: valuationPolicyRecords, users: userRecords, outbox: outboxRecords, marginRules: marginRuleRecords, priceLists: priceListOptions, priceAssignments: priceAssignmentRecords, priceEntries: priceEntryRecords, uomConversions: uomConversionRecords, orphanedLocations: orphanedLocationRecords, audit: auditRecords, attachments: attachmentRecords, currentUser: actor ? { id: text(actor, "id"), name: text(actor, "name", "email"), role: human(actor.role), permissions: permissionLabels } : empty.currentUser, permissions,
    totals: {
      inventoryValueCents: number(summaryTotals, "inventoryValueCents"),
      landedCostAllocatedCents: number(summaryTotals, "landedCostAllocatedCents"),
      landedCostAllocationCount: number(summaryTotals, "landedCostAllocationCount"),
      scrapValueCents: number(summaryTotals, "scrapValueCents"),
      scrapEntryCount: number(summaryTotals, "scrapEntryCount"),
    },
    options: { products: products.map((row) => makeOption(row, ["sku", "name"])), warehouses: rows(raw.warehouses).filter((row) => number(row, "active") !== 0).map((row) => makeOption(row, ["code", "name"])), locations: locations.filter((row) => number(row, "active") !== 0).map((row) => makeOption(row, ["warehouseName", "code", "name"])), uoms: uomRows.filter((row) => number(row, "active") !== 0).map((row) => makeOption(row, ["code", "name", "dimension"])), priceLists: priceListOptions, salesOrderLines, purchaseOrderLines, purchaseOrders: purchaseOrders.map((row) => makeOption(row, ["number", "vendorName"], text(row, "vendorId"))), salesOrders: salesOrders.map((row) => makeOption(row, ["number", "customerName"], text(row, "customerId"))), partners: partners.map((row) => makeOption(row, ["name", "partnerType"], text(row, "partnerType"))), costLayers: rows(raw.costLayers).map((row) => makeOption(row, ["sku", "remaining_qty", "id"])), assetTypes: rows(raw.returnableAssetTypes).filter((row) => number(row, "active") !== 0).map((row) => makeOption(row, ["code", "name"])), vendorBills: vendorBillRows.map((row) => makeOption(row, ["number", "vendorName"], text(row, "vendor_id", "vendorId"))), customerInvoices: invoiceRows.map((row) => makeOption(row, ["number", "customerName"], text(row, "customer_id", "customerId"))) } };
}
