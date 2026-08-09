"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { workflowCommandEnvelope, workflowSnapshotParts } from "@/lib/domain/workflow-envelope";

export type OperationsWorkspaceKind = "purchasing" | "sales" | "inventory" | "vendor-billing" | "customer-billing" | "controls";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
type WorkflowActionKind =
  | "createPurchaseOrder" | "submitPurchaseOrder" | "approvePurchaseOrder" | "rejectPurchaseOrder" | "amendPurchaseOrder"
  | "transferInventory" | "changeInventoryStatus" | "scrapInventory" | "allocateLandedCost"
  | "releaseReservation" | "reallocateReservation" | "reverseShipment"
  | "postDropShipDelivery" | "reverseDropShipDelivery"
  | "confirmSalesOrder" | "cancelSalesOrder"
  | "createVendorBill" | "resolveMatchException"
  | "createCustomerInvoice" | "issueCustomerCredit" | "recordCustomerPayment"
  | "issueReturnableAsset" | "returnReturnableAsset" | "forfeitReturnableAsset" | "refundAssetDeposit"
  | "approveApproval" | "rejectApproval"
  | "updatePolicy";

type WorkflowRecord = {
  id: string;
  number: string;
  status: string;
  party?: string;
  reference?: string;
  amount?: number;
  quantity?: number;
  detail?: string;
  version?: number;
  revision?: number;
  exception?: string;
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
type PolicyRecord = { id: string; name: string; value: string; description: string; risk: string };
type ActionRecord = { id: string; number?: string; status?: string; party?: string; reference?: string; amount?: number; quantity?: number; detail?: string; version?: number; revision?: number; exception?: string; value?: string };
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
};

type ActionDefinition = {
  kind: WorkflowActionKind;
  title: string;
  description: string;
  finalLabel: string;
  record?: ActionRecord;
};

type DraftLine = { id: string; sku: string; description: string; quantity: number; unitCost: number; expectedDate: string; customerRef: string };
type FinancialInput = { currency: string; exchangeRate: number; terms: string; dueDate: string; taxCode: string; taxRate: number; discount: number; freight: number; fees: number; deposit: number; paid: number };

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const today = new Date().toISOString().slice(0, 10);

function emptyWorkflowOptions(): WorkflowState["options"] {
  return { products: [], warehouses: [], locations: [], uoms: [], priceLists: [], salesOrderLines: [], purchaseOrderLines: [], purchaseOrders: [], salesOrders: [], partners: [], costLayers: [], assetTypes: [], vendorBills: [], customerInvoices: [] };
}

function emptyWorkflowState(): WorkflowState {
  return {
    purchaseOrders: [], revisions: [], transfers: [], traceUnits: [], reservations: [], shipments: [], dropShipDeliveries: [], vendorBills: [], customerInvoices: [], valuations: [], assets: [], approvals: [], policies: [], priceLists: [], priceAssignments: [], priceEntries: [], uomConversions: [], orphanedLocations: [], audit: [], attachments: [],
    currentUser: { id: "unavailable", name: "Permission context unavailable", role: "No authenticated role", permissions: [] },
    permissions: {},
    options: emptyWorkflowOptions(),
  };
}

const tabs: Record<OperationsWorkspaceKind, Array<{ key: string; label: string }>> = {
  purchasing: [{ key: "overview", label: "Orders" }, { key: "drafts", label: "Drafts & revisions" }, { key: "approvals", label: "Approval queue" }],
  sales: [{ key: "overview", label: "Orders" }, { key: "lifecycle", label: "Draft lifecycle" }, { key: "reservations", label: "Reservations" }, { key: "drop-ship", label: "Drop-ship deliveries" }, { key: "shipment-corrections", label: "Shipment corrections" }],
  inventory: [{ key: "overview", label: "Balances" }, { key: "transfers", label: "Transfers & status" }, { key: "approvals", label: "Count approvals" }, { key: "traceability", label: "Traceability" }, { key: "valuation", label: "Valuation" }, { key: "returnables", label: "Returnables" }],
  "vendor-billing": [{ key: "overview", label: "Bills" }, { key: "match", label: "Match exceptions" }],
  "customer-billing": [{ key: "overview", label: "Invoices" }, { key: "billing-actions", label: "Credits & payments" }],
  controls: [{ key: "overview", label: "Reports" }, { key: "approvals", label: "Count approvals" }, { key: "audit", label: "Audit timeline" }, { key: "policies", label: "System policies" }, { key: "reconciliation", label: "Reconciliation" }, { key: "pricing", label: "Customer pricing" }, { key: "units", label: "Units & conversions" }, { key: "master-data", label: "Master data" }],
};

export function OperationsWorkspace({ workspace, children, onDurableRefresh, refreshToken = 0 }: { workspace: OperationsWorkspaceKind; children: ReactNode; onDurableRefresh?: () => void | Promise<void>; refreshToken?: number }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [state, setState] = useState<WorkflowState>(emptyWorkflowState);
  const [serviceState, setServiceState] = useState<"loading" | "live" | "unavailable">("loading");
  const [action, setAction] = useState<ActionDefinition | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/workflows", { cache: "no-store" });
      if (!response.ok) throw new Error("Workflow service unavailable");
      const result = await response.json() as Record<string, unknown>;
      const parts = workflowSnapshotParts(result);
      setState(normalizeLiveWorkflowState(parts.advanced, parts.core));
      setServiceState("live");
    } catch {
      setServiceState("unavailable");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshToken]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 5000); return () => window.clearTimeout(timer); }, [toast]);

  const execute = async (kind: WorkflowActionKind, payload: Record<string, unknown>) => {
    const idempotencyKey = crypto.randomUUID();
    const command = workflowCommand(kind, String(payload.resolution ?? ""));
    const envelope = workflowCommandEnvelope({ command, kind, payload, record: action?.record, options: state.options, idempotencyKey });
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(envelope),
    });
    const result = await response.json() as { state?: unknown; snapshot?: unknown; message?: string; error?: string | { message?: string } };
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "The workflow could not be completed.");
    if (result.snapshot || result.state) {
      const parts = workflowSnapshotParts(result);
      setState(normalizeLiveWorkflowState(parts.advanced, parts.core));
    } else await load();
    await onDurableRefresh?.();
    setServiceState("live");
    setToast(result.message ?? `${actionTitle(kind)} completed.`);
  };
  const canAction = (kind: WorkflowActionKind) => {
    if (serviceState !== "live") return false;
    if (kind === "resolveMatchException") return state.permissions.approveVendorBill === true || state.permissions.createVendorCredit === true;
    return state.permissions[workflowCommand(kind, "")] === true;
  };
  const routeLegacyAction = (event: ReactMouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest("button");
    const label = button?.textContent?.trim().toLowerCase() ?? "";
    const next = workspace === "inventory" && label.includes("transfer inventory") ? "transfers"
      : workspace === "sales" && label.includes("resolve shortage") ? "reservations"
      : workspace === "vendor-billing" && /request purchasing approval|hold vendor bill|correct bill draft/.test(label) ? "match"
      : workspace === "customer-billing" && label.includes("create invoice") ? "billing-actions"
      : null;
    if (next) { event.preventDefault(); setActiveTab(next); }
  };

  return (
    <div className="operations-workspace" onClickCapture={routeLegacyAction}>
      <div className="workspace-tabbar" role="tablist" aria-label={`${workspace} workspace views`}>
        {tabs[workspace].map((tab) => <button key={tab.key} role="tab" aria-selected={activeTab === tab.key} className={activeTab === tab.key ? "active" : ""} onClick={() => setActiveTab(tab.key)}>{tab.label}{tabCount(workspace, tab.key, state) ? <span>{tabCount(workspace, tab.key, state)}</span> : null}</button>)}
        <span className={`workflow-service ${serviceState}`} role="status">{serviceState === "live" ? "Durable workflows live" : serviceState === "loading" ? "Loading workflows…" : "Workflow service unavailable"}</span>
      </div>
      {serviceState === "unavailable" && activeTab !== "overview" ? <div className="workflow-banner warning"><strong>Changes are temporarily unavailable.</strong><span>Reference data is shown below. Reconnect before posting a business action so it can be durably recorded.</span><button onClick={() => void load()}>Retry connection</button></div> : null}
      {activeTab === "overview" ? children : <WorkflowTab workspace={workspace} tab={activeTab} state={state} canAction={canAction} openAction={setAction} refresh={load} />}
      {action ? <WorkflowDialog action={action} state={state} onClose={() => setAction(null)} onSubmit={async (payload) => { await execute(action.kind, payload); setAction(null); }} /> : null}
      {toast ? <div className="workflow-toast" role="status"><span aria-hidden="true">✓</span>{toast}</div> : null}
    </div>
  );
}

function WorkflowTab({ workspace, tab, state, canAction, openAction, refresh }: { workspace: OperationsWorkspaceKind; tab: string; state: WorkflowState; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void; refresh: () => Promise<void> }) {
  if (workspace === "purchasing" && tab === "drafts") return <PurchaseDrafts state={state} canAction={canAction} openAction={openAction} />;
  if (workspace === "purchasing" && tab === "approvals") return <ApprovalQueue records={state.purchaseOrders.filter((item) => item.status.toLowerCase().includes("pending"))} canAction={canAction} openAction={openAction} />;
  if (workspace === "sales" && tab === "reservations") return <Reservations records={state.reservations} canAction={canAction} openAction={openAction} />;
  if (workspace === "sales" && tab === "lifecycle") return <SalesLifecycle records={state.options.salesOrders.map((option) => ({ id: option.id, number: option.label, status: String(option.status ?? "unknown").replaceAll("_", " "), version: option.version }))} canAction={canAction} openAction={openAction} />;
  if (workspace === "sales" && tab === "shipment-corrections") return <ShipmentCorrections records={state.shipments} canAction={canAction} openAction={openAction} />;
  if (workspace === "sales" && tab === "drop-ship") return <DropShipDeliveries records={state.dropShipDeliveries} canAction={canAction} openAction={openAction} />;
  if (workspace === "inventory" && tab === "transfers") return <InventoryTransfers records={state.transfers} canAction={canAction} openAction={openAction} />;
  if ((workspace === "inventory" || workspace === "controls") && tab === "approvals") return <CountApprovalInbox records={state.approvals} canAction={canAction} openAction={openAction} />;
  if (workspace === "inventory" && tab === "traceability") return <Traceability units={state.traceUnits} />;
  if (workspace === "inventory" && tab === "valuation") return <Valuation records={state.valuations} canAction={canAction} openAction={openAction} />;
  if (workspace === "inventory" && tab === "returnables") return <Returnables records={state.assets} canAction={canAction} openAction={openAction} />;
  if (workspace === "vendor-billing" && tab === "match") return <VendorMatching records={state.vendorBills} canAction={canAction} openAction={openAction} />;
  if (workspace === "customer-billing" && tab === "billing-actions") return <CustomerBilling records={state.customerInvoices} canAction={canAction} openAction={openAction} />;
  if (workspace === "controls" && tab === "audit") return <AuditTimeline state={state} />;
  if (workspace === "controls" && tab === "policies") return <div className="workflow-stack"><AccessNotice /><Policies records={state.policies} user={state.currentUser} canAction={canAction} openAction={openAction} /></div>;
  if (workspace === "controls" && tab === "pricing") return <PriceListsPanel state={state} refresh={refresh} />;
  if (workspace === "controls" && tab === "units") return <UnitsPanel state={state} refresh={refresh} />;
  if (workspace === "controls" && tab === "reconciliation") return <LocationReconciliationPanel state={state} refresh={refresh} />;
  if (workspace === "controls" && tab === "master-data") return <MasterDataPanel state={state} refresh={refresh} />;
  return null;
}

function Section({ title, detail, action, children }: { title: string; detail: string; action?: ReactNode; children: ReactNode }) {
  return <section className="workflow-panel"><header className="workflow-panel-header"><div><h2>{title}</h2><p>{detail}</p></div>{action}</header>{children}</section>;
}

function AccessNotice() {
  return <section className="workflow-banner"><strong>Role administration</strong><span>User access is server-managed. On a new installation, the first authenticated user is bootstrapped as administrator; subsequent role assignment or disabling must be performed by an administrator.</span></section>;
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
  return <div className="workflow-stack"><Section title="Inventory reference reconciliation" detail="Restore a missing legacy location under its original ID so immutable balances and movements resolve without rewriting history.">
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
    <Section title="Units of measure" detail="Define real operational units and their allowed precision before assigning them to products."><div className="workflow-action-grid">
      <form className="master-data-form" onSubmit={createUnit}><h3>Create unit</h3><label><span>Code</span><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="CASE" required /></label><label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Case" required /></label><label><span>Dimension</span><input value={dimension} onChange={(event) => setDimension(event.target.value.toLowerCase())} placeholder="quantity" required /></label><label><span>Decimal precision</span><input type="number" min="0" max="3" step="1" value={precision} onChange={(event) => setPrecision(Number(event.target.value))} required /></label><button className="workflow-action primary" disabled={!canAdminister || busy}>Create unit</button></form>
      <form className="master-data-form" onSubmit={createConversion}><h3>Create conversion</h3><label><span><input type="checkbox" checked={globalScope} onChange={(event) => setGlobalScope(event.target.checked)} /> Apply to all products in this dimension</span></label>{!globalScope ? <RemoteProductField value={productId} initialOptions={state.options.products} setValue={setProductId} label="Product scope" /> : null}<OptionField label="Source unit" value={selectedFromUomId} options={state.options.uoms} setValue={setFromUomId} /><OptionField label="Destination / base unit" value={selectedToUomId} options={state.options.uoms} setValue={setToUomId} /><label><span>Destination units (numerator)</span><input type="number" min="1" step="1" value={numerator} onChange={(event) => setNumerator(Number(event.target.value))} required /></label><label><span>Source units (denominator)</span><input type="number" min="1" step="1" value={denominator} onChange={(event) => setDenominator(Number(event.target.value))} required /></label><p className="read-only-label full">Formula: 1 source unit = numerator ÷ denominator destination units.</p><button className="workflow-action primary" disabled={!canAdminister || busy || !selectedFromUomId || !selectedToUomId || selectedFromUomId === selectedToUomId || !globalScope && !productId}>Create conversion</button></form>
    </div>{message ? <p role="status" className="workflow-banner">{message}</p> : null}</Section>
    <Section title="Configured units" detail="Precision zero enforces whole-number inventory for products using that unit as base."><RecordTable records={unitRecords} columns={["number", "detail", "status"]} /></Section>
    <Section title="Conversion rules" detail="Product-specific rules take precedence over global conversions."><RecordTable records={state.uomConversions} columns={["number", "party", "quantity", "detail", "status"]} /></Section>
  </div>;
}

function PriceListsPanel({ state, refresh }: { state: WorkflowState; refresh: () => Promise<void> }) {
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [priority, setPriority] = useState(0);
  const [priceListId, setPriceListId] = useState(state.options.priceLists[0]?.id ?? "");
  const [partnerId, setPartnerId] = useState(state.options.partners.find((option) => option.detail === "customer" || option.detail === "both")?.id ?? "");
  const [productId, setProductId] = useState(state.options.products[0]?.id ?? ""); const [uomId, setUomId] = useState(state.options.uoms[0]?.id ?? "");
  const [minimumQuantity, setMinimumQuantity] = useState(1); const [unitPrice, setUnitPrice] = useState(0); const [deactivationReason, setDeactivationReason] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const customers = state.options.partners.filter((option) => option.detail === "customer" || option.detail === "both");
  const canAdminister = state.permissions.canAdminister === true;
  const selectedPriceListId = state.options.priceLists.some((option) => option.id === priceListId) ? priceListId : state.options.priceLists[0]?.id ?? "";
  const selectedPartnerId = partnerId || customers[0]?.id || "";
  const selectedProductId = productId || state.options.products[0]?.id || "";
  const selectedUomId = uomId || state.options.uoms[0]?.id || "";
  const post = async (command: string, payload: Record<string, unknown>, entity?: SelectOption) => {
    const idempotencyKey = crypto.randomUUID(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ command, idempotencyKey, entityId: entity?.id, version: entity?.version, payload }) });
      const result = await response.json() as { message?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Pricing change failed.");
      setMessage(result.message ?? "Pricing saved."); await refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Pricing change failed."); }
    finally { setBusy(false); }
  };
  const submitList = (event: FormEvent) => { event.preventDefault(); void post("createPriceList", { code, name, currency: "CAD", priority }); };
  const submitAssignment = (event: FormEvent) => { event.preventDefault(); void post("assignPriceList", { priceListId: selectedPriceListId, partnerId: selectedPartnerId, priority: 0 }); };
  const submitEntry = (event: FormEvent) => { event.preventDefault(); void post("createPriceListEntry", { priceListId: selectedPriceListId, productId: selectedProductId, uomId: selectedUomId, minimumQuantity, unitPriceCents: Math.round(unitPrice * 100) }); };
  const deactivateList = (event: FormEvent) => { event.preventDefault(); const selected = state.options.priceLists.find((option) => option.id === selectedPriceListId); if (selected) void post("deactivatePriceList", { reason: deactivationReason }, selected); };
  return <div className="workflow-stack">
    <Section title="Customer price lists" detail="Contract pricing is resolved by customer, product, UOM, quantity break, priority, and validity dates when a sales-order line is selected.">
      <div className="workflow-action-grid">
        <form className="master-data-form" onSubmit={submitList}><h3>Create price list</h3><label><span>Code</span><input value={code} onChange={(event) => setCode(event.target.value)} required /></label><label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label><label><span>Priority</span><input type="number" value={priority} onChange={(event) => setPriority(Number(event.target.value))} /></label><button className="workflow-action primary" disabled={!canAdminister || busy}>Create list</button></form>
        <form className="master-data-form" onSubmit={submitAssignment}><h3>Assign customer</h3><OptionField label="Price list" value={selectedPriceListId} options={state.options.priceLists} setValue={setPriceListId} /><RemotePartnerField label="Customer" role="customer" value={selectedPartnerId} initialOptions={customers} setValue={setPartnerId} /><button className="workflow-action primary" disabled={!canAdminister || busy || !selectedPriceListId || !selectedPartnerId}>Assign customer</button></form>
        <form className="master-data-form" onSubmit={submitEntry}><h3>Add contract price</h3><OptionField label="Price list" value={selectedPriceListId} options={state.options.priceLists} setValue={setPriceListId} /><RemoteProductField value={selectedProductId} initialOptions={state.options.products} setValue={setProductId} onSelect={(option) => setUomId(String(option.data?.salesUomId ?? selectedUomId))} /><OptionField label="Sales UOM" value={selectedUomId} options={state.options.uoms} setValue={setUomId} /><label><span>Minimum quantity</span><input type="number" min="0.001" step="0.001" value={minimumQuantity} onChange={(event) => setMinimumQuantity(Number(event.target.value))} /></label><label><span>Unit price</span><input type="number" min="0" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(Number(event.target.value))} /></label><button className="workflow-action primary" disabled={!canAdminister || busy || !selectedPriceListId || !selectedProductId || !selectedUomId || minimumQuantity <= 0}>Add price</button></form>
        <form className="master-data-form" onSubmit={deactivateList}><h3>Retire price list</h3><OptionField label="Price list" value={selectedPriceListId} options={state.options.priceLists} setValue={setPriceListId} /><label><span>Reason</span><input value={deactivationReason} onChange={(event) => setDeactivationReason(event.target.value)} required /></label><button className="workflow-action" disabled={!canAdminister || busy || !selectedPriceListId || !deactivationReason}>Deactivate for future orders</button></form>
      </div>
      {message ? <p role="status" className="workflow-banner">{message}</p> : null}
    </Section>
    <Section title="Active contract entries" detail="These prices are considered before the product catalog selling price."><RecordTable records={state.priceEntries} columns={["number", "party", "quantity", "amount", "status"]} /></Section>
    <Section title="Customer assignments" detail="Priority resolves overlapping customer contracts deterministically."><RecordTable records={state.priceAssignments} columns={["number", "party", "reference", "status"]} /></Section>
  </div>;
}

type MasterKind = "product" | "partner" | "warehouse" | "location" | "asset";
function MasterDataPanel({ state, refresh }: { state: WorkflowState; refresh: () => Promise<void> }) {
  const [kind, setKind] = useState<MasterKind>("product"); const [mode, setMode] = useState("create"); const [selectedId, setSelectedId] = useState(""); const [selectedVersion, setSelectedVersion] = useState(0); const [code, setCode] = useState(""); const [name, setName] = useState(""); const [detail, setDetail] = useState("vendor"); const [warehouseId, setWarehouseId] = useState(state.options.warehouses[0]?.id ?? ""); const [cost, setCost] = useState(0); const [price, setPrice] = useState(0); const [reason, setReason] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [baseUomId, setBaseUomId] = useState(state.options.uoms[0]?.id ?? ""); const [purchaseUomId, setPurchaseUomId] = useState(state.options.uoms[0]?.id ?? ""); const [salesUomId, setSalesUomId] = useState(state.options.uoms[0]?.id ?? "");
  const [manufacturerSku, setManufacturerSku] = useState(""); const [category, setCategory] = useState("General"); const [material, setMaterial] = useState("Unspecified"); const [dimensions, setDimensions] = useState("N/A"); const [finish, setFinish] = useState("N/A"); const [trackingPolicy, setTrackingPolicy] = useState("quantity"); const [inventoryPolicy, setInventoryPolicy] = useState("stocked"); const [reorderPoint, setReorderPoint] = useState(0);
  const [addressLine1, setAddressLine1] = useState(""); const [addressLine2, setAddressLine2] = useState(""); const [city, setCity] = useState(""); const [region, setRegion] = useState(""); const [postalCode, setPostalCode] = useState(""); const [country, setCountry] = useState("CA"); const [creditLimit, setCreditLimit] = useState(0); const [creditHold, setCreditHold] = useState(false);
  const options = kind === "product" ? state.options.products : kind === "partner" ? state.options.partners : kind === "warehouse" ? state.options.warehouses : kind === "location" ? state.options.locations : state.options.assetTypes;
  const commandStem = ({ product: "Product", partner: "BusinessPartner", warehouse: "Warehouse", location: "Location", asset: "ReturnableAssetType" } as const)[kind];
  const resetFields = (nextKind: MasterKind = kind) => { setSelectedId(""); setSelectedVersion(0); setCode(""); setName(""); setDetail(nextKind === "partner" ? "vendor" : nextKind === "location" ? "storage" : ""); setWarehouseId(state.options.warehouses[0]?.id ?? ""); setBaseUomId(state.options.uoms[0]?.id ?? ""); setPurchaseUomId(state.options.uoms[0]?.id ?? ""); setSalesUomId(state.options.uoms[0]?.id ?? ""); setManufacturerSku(""); setCategory("General"); setMaterial("Unspecified"); setDimensions("N/A"); setFinish("N/A"); setTrackingPolicy("quantity"); setInventoryPolicy("stocked"); setReorderPoint(0); setCost(0); setPrice(0); setAddressLine1(""); setAddressLine2(""); setCity(""); setRegion(""); setPostalCode(""); setCountry("CA"); setCreditLimit(0); setCreditHold(false); setReason(""); setMessage(""); };
  const selectRecord = (id: string, supplied?: SelectOption) => {
    setSelectedId(id); setMessage("");
    const selected = supplied ?? options.find((item) => item.id === id); const row = selected?.data ?? {};
    setSelectedVersion(selected?.version ?? Number(row.version ?? 0));
    setCode(String(row.sku ?? row.code ?? selected?.label.split(" · ")[0] ?? ""));
    setName(String(row.name ?? selected?.label.split(" · ").at(-1) ?? ""));
    if (kind === "partner") { setDetail(String(row.partnerType ?? selected?.detail ?? "vendor")); setAddressLine1(String(row.addressLine1 ?? "")); setAddressLine2(String(row.addressLine2 ?? "")); setCity(String(row.city ?? "")); setRegion(String(row.region ?? "")); setPostalCode(String(row.postalCode ?? "")); setCountry(String(row.country ?? "CA")); setCreditLimit(Number(row.creditLimitCents ?? 0) / 100); setCreditHold(Boolean(row.creditHold)); }
    if (kind === "location") { setDetail(String(row.locationType ?? "storage")); setWarehouseId(String(row.warehouseId ?? state.options.warehouses[0]?.id ?? "")); }
    if (kind === "product") { setManufacturerSku(String(row.manufacturerSku ?? "")); setCategory(String(row.category ?? "General")); setMaterial(String(row.material ?? "Unspecified")); setDimensions(String(row.dimensions ?? "N/A")); setFinish(String(row.finish ?? "N/A")); setTrackingPolicy(String(row.trackingPolicy ?? "quantity")); setInventoryPolicy(String(row.inventoryPolicy ?? "stocked")); setReorderPoint(Number(row.reorderPoint ?? 0)); setBaseUomId(String(row.baseUomId ?? state.options.uoms[0]?.id ?? "")); setPurchaseUomId(String(row.purchaseUomId ?? row.baseUomId ?? state.options.uoms[0]?.id ?? "")); setSalesUomId(String(row.salesUomId ?? row.baseUomId ?? state.options.uoms[0]?.id ?? "")); }
    if (kind === "asset") setDetail(String(row.assetClass ?? "rack"));
    setCost(Number(row.standardCostCents ?? row.unitDepositCents ?? 0) / 100);
    setPrice(Number(row.sellingPriceCents ?? 0) / 100);
    setReason("");
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setMessage(""); const selected = options.find((item) => item.id === selectedId) ?? (selectedId ? { id: selectedId, version: selectedVersion } : undefined); if (mode !== "create" && !selected) return setMessage("Select the record to change.");
    const recordPayload = kind === "product" ? { sku: code, manufacturerSku, name, category, material, dimensions, finish, trackingPolicy, inventoryPolicy, standardCostCents: Math.round(cost * 100), sellingPriceCents: Math.round(price * 100), reorderPoint, baseUomId, purchaseUomId, salesUomId }
      : kind === "partner" ? { code, name, partnerType: detail, currency: "CAD", paymentTerms: "Net 30", addressLine1, addressLine2, city, region, postalCode, country, creditLimitCents: Math.round(creditLimit * 100), creditHold }
      : kind === "warehouse" ? { code, name, timezone: "America/Edmonton" }
      : kind === "location" ? { code, name, locationType: detail || "storage", inventoryStatus: detail === "quarantine" ? "quarantine" : detail === "in_transit" ? "in_transit" : "usable", warehouseId }
      : { code, name, assetClass: detail || "rack", unitDepositCents: Math.round(cost * 100) };
    const payload = mode === "deactivate" ? { reason } : recordPayload;
    const idempotencyKey = crypto.randomUUID(); setBusy(true);
    try { const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ command: `${mode}${commandStem}`, entityId: selected?.id, version: selected?.version ?? 0, idempotencyKey, payload }) }); const result = await response.json() as { message?: string; error?: { message?: string } }; if (!response.ok) throw new Error(result.error?.message ?? "Master-data change failed."); setMessage(result.message ?? "Master data saved."); await refresh(); setSelectedId(""); setCode(""); setName(""); setReason(""); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "Master-data change failed."); } finally { setBusy(false); }
  };
  const permitted = state.permissions.canApprove === true;
  const deactivating = mode === "deactivate";
  if (kind === "product") return <Section title="Product master data" detail="Every product has explicit base, purchasing, and sales UOMs; quantity conversions are enforced when orders and stock movements post."><form className="master-data-form" onSubmit={save}>
    <label><span>Record type</span><select value={kind} onChange={(event) => { const nextKind = event.target.value as MasterKind; setKind(nextKind); resetFields(nextKind); }}><option value="product">Product</option><option value="partner">Vendor / customer</option><option value="warehouse">Warehouse</option><option value="location">Location</option><option value="asset">Returnable asset type</option></select></label>
    <label><span>Action</span><select value={mode} onChange={(event) => { setMode(event.target.value); resetFields(); }}><option value="create">Create</option><option value="update">Edit</option><option value="deactivate">Deactivate</option></select></label>
    {mode !== "create" ? <RemoteProductField label="Existing product" value={selectedId} initialOptions={state.options.products} setValue={setSelectedId} onSelect={(option) => selectRecord(option.id, option)} /> : null}
    <label><span>SKU</span><input value={code} onChange={(event) => setCode(event.target.value)} disabled={deactivating} required /></label>
    <label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} disabled={deactivating} required /></label>
    {!deactivating ? <><label><span>Manufacturer SKU</span><input value={manufacturerSku} onChange={(event) => setManufacturerSku(event.target.value)} /></label><label><span>Category</span><input value={category} onChange={(event) => setCategory(event.target.value)} required /></label><label><span>Material</span><input value={material} onChange={(event) => setMaterial(event.target.value)} required /></label><label><span>Dimensions / configuration</span><input value={dimensions} onChange={(event) => setDimensions(event.target.value)} required /></label><label><span>Finish</span><input value={finish} onChange={(event) => setFinish(event.target.value)} required /></label><label><span>Tracking policy</span><select value={trackingPolicy} onChange={(event) => setTrackingPolicy(event.target.value)}><option value="quantity">Quantity</option><option value="lot">Lot</option><option value="serial">Serial</option></select></label><label><span>Inventory policy</span><select value={inventoryPolicy} onChange={(event) => setInventoryPolicy(event.target.value)}><option value="stocked">Stocked</option><option value="special_order">Special order</option><option value="drop_ship">Drop ship</option></select></label><OptionField label="Base inventory UOM" value={baseUomId} options={state.options.uoms} setValue={setBaseUomId} /><OptionField label="Purchasing UOM" value={purchaseUomId} options={state.options.uoms} setValue={setPurchaseUomId} /><OptionField label="Sales UOM" value={salesUomId} options={state.options.uoms} setValue={setSalesUomId} /><label><span>Standard cost</span><input type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(Number(event.target.value))} required /></label><label><span>Selling price</span><input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(Number(event.target.value))} required /></label><label><span>Reorder point (base UOM)</span><input type="number" min="0" step="0.001" value={reorderPoint} onChange={(event) => setReorderPoint(Number(event.target.value))} required /></label></> : <label className="full"><span>Deactivation reason</span><input value={reason} onChange={(event) => setReason(event.target.value)} required /></label>}
    {!state.options.uoms.length ? <span className="read-only-label">Create an active unit of measure before creating products.</span> : null}
    <button className="workflow-action primary" type="submit" disabled={!permitted || busy || !deactivating && (!baseUomId || !purchaseUomId || !salesUomId)}>{busy ? "Saving…" : `${mode[0].toUpperCase()}${mode.slice(1)} product`}</button>
    {!permitted ? <span className="read-only-label">Manager approval permission required</span> : null}{message ? <span role="status">{message}</span> : null}
  </form></Section>;
  return <Section title="Master data" detail="Create, revise, or deactivate the durable records required before entering orders and inventory movements."><form className="master-data-form" onSubmit={save}><label><span>Record type</span><select value={kind} onChange={(event) => { const nextKind = event.target.value as MasterKind; setKind(nextKind); resetFields(nextKind); }}><option value="product">Product</option><option value="partner">Vendor / customer</option><option value="warehouse">Warehouse</option><option value="location">Location</option><option value="asset">Returnable asset type</option></select></label><label><span>Action</span><select value={mode} onChange={(event) => { setMode(event.target.value); resetFields(); }}><option value="create">Create</option><option value="update">Edit</option><option value="deactivate">Deactivate</option></select></label>{mode !== "create" ? <OptionField label="Existing record" value={selectedId} options={options} setValue={selectRecord} /> : null}<label><span>Code / SKU</span><input value={code} onChange={(event) => setCode(event.target.value)} disabled={deactivating} required /></label><label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} disabled={deactivating} required /></label>{kind === "partner" ? <label><span>Partner type</span><select value={detail} onChange={(event) => setDetail(event.target.value)} disabled={deactivating}><option value="vendor">Vendor</option><option value="customer">Customer</option><option value="both">Both</option></select></label> : null}{kind === "partner" ? <><label><span>Address line 1</span><input value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} disabled={deactivating} /></label><label><span>Address line 2</span><input value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} disabled={deactivating} /></label><label><span>City</span><input value={city} onChange={(event) => setCity(event.target.value)} disabled={deactivating} /></label><label><span>Province / region</span><input value={region} onChange={(event) => setRegion(event.target.value)} disabled={deactivating} /></label><label><span>Postal code</span><input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} disabled={deactivating} /></label><label><span>Country</span><input value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} disabled={deactivating} /></label><label><span>Credit limit</span><input type="number" min="0" step="0.01" value={creditLimit} onChange={(event) => setCreditLimit(Number(event.target.value))} disabled={deactivating} /></label><label><span><input type="checkbox" checked={creditHold} onChange={(event) => setCreditHold(event.target.checked)} disabled={deactivating} /> Credit hold</span></label></> : null}{kind === "location" ? <><label><span>Location type</span><select value={detail} onChange={(event) => setDetail(event.target.value)} disabled={deactivating}><option value="storage">Storage</option><option value="receiving">Receiving</option><option value="shipping">Shipping</option><option value="quarantine">Quarantine</option><option value="in_transit">In transit</option><option value="scrap">Scrap</option></select></label><OptionField label="Warehouse" value={warehouseId} options={state.options.warehouses} setValue={setWarehouseId} disabled={deactivating} /></> : null}{kind === "asset" ? <><label><span>Asset class</span><input value={detail} onChange={(event) => setDetail(event.target.value)} disabled={deactivating} required /></label><label><span>Unit deposit</span><input type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(Number(event.target.value))} disabled={deactivating} required /></label></> : null}{deactivating ? <label className="full"><span>Deactivation reason</span><input value={reason} onChange={(event) => setReason(event.target.value)} required /></label> : null}<button className="workflow-action primary" type="submit" disabled={!permitted || busy}>{busy ? "Saving…" : `${mode[0].toUpperCase()}${mode.slice(1)} ${kind}`}</button>{!permitted ? <span className="read-only-label">Manager approval permission required</span> : null}{message ? <span role="status">{message}</span> : null}</form></Section>;
}

function ActionButton({ children, onClick, disabled, kind = "secondary" }: { children: ReactNode; onClick: () => void; disabled?: boolean; kind?: "primary" | "secondary" | "quiet" }) {
  return <button className={`workflow-action ${kind}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

function PurchaseDrafts({ state, canAction, openAction }: { state: WorkflowState; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  const drafts = state.purchaseOrders.filter((item) => item.status.toLowerCase().includes("draft"));
  return <div className="workflow-stack"><Section title="Draft purchase orders" detail="Build multi-line orders with charges before submitting a frozen revision." action={<span className="read-only-label">Use “Create purchase order” above for a new multi-line draft</span>}><RecordTable records={drafts} columns={["number", "party", "quantity", "amount", "status"]} actions={(record) => <><ActionButton disabled={!canAction("submitPurchaseOrder")} onClick={() => openAction({ kind: "submitPurchaseOrder", title: `Submit ${record.number} for approval`, description: "Freeze the current revision and evaluate purchasing approval policy. Inventory does not move.", finalLabel: "Submit for approval", record })}>Submit</ActionButton><ActionButton kind="quiet" disabled={!canAction("amendPurchaseOrder")} onClick={() => openAction({ kind: "amendPurchaseOrder", title: `Amend ${record.number}`, description: "Create a new revision while retaining the version previously shared with the vendor.", finalLabel: "Create amended revision", record })}>Amend</ActionButton></>} /></Section><Section title="Revision history" detail="Every approved or sent change remains traceable to its prior version."><RecordTable records={state.revisions} columns={["number", "reference", "party", "amount", "status"]} /></Section>{state.attachments.length ? <AttachmentsPanel records={state.attachments.filter((item) => /PO|RCPT|return/i.test(item.document))} /> : null}</div>;
}

function ApprovalQueue({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <Section title="Purchasing approvals" detail="Review the exact revision and its impact before deciding."><RecordCards records={records} renderActions={(record) => <><ActionButton kind="primary" disabled={!canAction("approvePurchaseOrder")} onClick={() => openAction({ kind: "approvePurchaseOrder", title: `Approve ${record.number}`, description: "Approve the commercial commitment and incoming forecast. No physical stock or payable is posted.", finalLabel: "Approve purchase order", record })}>Approve</ActionButton><ActionButton disabled={!canAction("rejectPurchaseOrder")} onClick={() => openAction({ kind: "rejectPurchaseOrder", title: `Reject ${record.number}`, description: "Return this revision to the buyer with a required explanation.", finalLabel: "Reject and return to buyer", record })}>Reject</ActionButton></>} /></Section>;
}

function CountApprovalInbox({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <Section title="Inventory-count approvals" detail="Managers decide scope-locked variances here. Operators can see request status and retry the original count with its approval ID."><RecordCards records={records} renderActions={(record) => /pending/i.test(record.status) ? <><ActionButton kind="primary" disabled={!canAction("approveApproval")} onClick={() => openAction({ kind: "approveApproval", title: `Approve ${record.number}`, description: `${record.detail ?? "Review the exact product, location, book quantity, and counted quantity."} No inventory moves until the operator posts the approved count.`, finalLabel: "Approve count variance", record })}>Approve</ActionButton><ActionButton disabled={!canAction("rejectApproval")} onClick={() => openAction({ kind: "rejectApproval", title: `Reject ${record.number}`, description: "Reject this variance without moving inventory. The operator must review and recount before requesting again.", finalLabel: "Reject count variance", record })}>Reject</ActionButton></> : <span className="read-only-label">{record.status} · no decision pending</span>} /></Section>;
}

function InventoryTransfers({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <div className="workflow-stack"><Section title="Location transfers" detail="Move physical stock between internal locations with a balanced movement." action={<ActionButton kind="primary" disabled={!canAction("transferInventory")} onClick={() => openAction({ kind: "transferInventory", title: "Transfer inventory", description: "Move a quantity from one internal location to another. Total on hand remains unchanged.", finalLabel: "Post inventory transfer" })}>New transfer</ActionButton>}><RecordTable records={records} columns={["number", "detail", "reference", "quantity", "status"]} /></Section><section className="workflow-action-grid"><ActionCard title="Change inventory status" detail="Move usable stock into quarantine, damaged, or return-pending status." impact="On hand unchanged · availability may decrease" action="Change status" disabled={!canAction("changeInventoryStatus")} onClick={() => openAction({ kind: "changeInventoryStatus", title: "Change inventory status", description: "Move stock between inventory statuses and keep the movement traceable.", finalLabel: "Post status change" })} /><ActionCard title="Scrap inventory" detail="Remove damaged inventory from internal on-hand stock with a reason." impact="On hand decreases · valuation expense posted" action="Post scrap" disabled={!canAction("scrapInventory")} tone="danger" onClick={() => openAction({ kind: "scrapInventory", title: "Scrap inventory", description: "This stock-changing correction removes goods from internal inventory.", finalLabel: "Post scrap movement" })} /></section></div>;
}

function Traceability({ units }: { units: TraceUnit[] }) {
  const [query, setQuery] = useState("");
  const filtered = units.filter((unit) => `${unit.id} ${unit.sku} ${unit.serial} ${unit.lot} ${unit.customer ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return <Section title="Lot, serial, and unit traceability" detail="Trace a physical unit from purchase receipt through location, allocation, and shipment."><div className="trace-search"><label><span>Find unit, serial, lot, SKU, or customer</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. AW-24-900183" /></label></div><div className="trace-grid">{filtered.map((unit) => <article key={unit.id} className="trace-card"><div className="trace-code">{unit.id}</div><div><span className="workflow-kicker">{unit.sku}</span><h3>{unit.serial}</h3><p>{unit.lot} · Received {unit.receivedOn}</p></div><StatusPill>{unit.status}</StatusPill><dl><div><dt>Current location</dt><dd>{unit.location}</dd></div><div><dt>Source</dt><dd>{unit.source}</dd></div><div><dt>Allocation</dt><dd>{unit.customer ?? "Unallocated"}</dd></div></dl></article>)}{!filtered.length ? <div className="workflow-empty">No traceable units match your search.</div> : null}</div></Section>;
}

function Valuation({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  const total = records.reduce((sum, record) => sum + (record.amount ?? 0), 0);
  return <div className="workflow-stack"><div className="workflow-metrics"><article><span>Inventory value</span><strong>{cad.format(total)}</strong><small>Average landed cost</small></article><article><span>Pending landed cost</span><strong>{cad.format(350)}</strong><small>1 vendor bill charge</small></article><article><span>Scrap this period</span><strong>{cad.format(800)}</strong><small>1 approved adjustment</small></article></div><Section title="Inventory valuation" detail="Quantity and cost layers remain traceable to receipt, bill, and landed-cost allocation." action={<ActionButton kind="primary" disabled={!canAction("allocateLandedCost")} onClick={() => openAction({ kind: "allocateLandedCost", title: "Allocate landed cost", description: "Allocate freight or duty across received inventory without moving physical stock.", finalLabel: "Post landed-cost allocation" })}>Allocate landed cost</ActionButton>}><RecordTable records={records} columns={["number", "status", "quantity", "amount", "detail"]} /></Section></div>;
}

function Reservations({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <Section title="Active reservations" detail="Release or reallocate customer commitments without changing physical on-hand inventory."><RecordTable records={records} columns={["number", "party", "reference", "quantity", "status"]} actions={(record) => <><ActionButton disabled={!canAction("releaseReservation")} onClick={() => openAction({ kind: "releaseReservation", title: `Release ${record.number}`, description: "Return reserved quantity to availability. On hand and financial balances do not change.", finalLabel: "Release reservation", record })}>Release</ActionButton><ActionButton kind="quiet" disabled={!canAction("reallocateReservation")} onClick={() => openAction({ kind: "reallocateReservation", title: `Reallocate ${record.number}`, description: "Move this allocation to another demand line with a recorded reason.", finalLabel: "Reallocate inventory", record })}>Reallocate</ActionButton></>} /></Section>;
}

function SalesLifecycle({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <Section title="Sales-order lifecycle" detail="Confirm a draft to activate demand, or cancel remaining demand. Neither command ships inventory or creates an invoice."><RecordTable records={records.filter((record) => /draft|confirmed/i.test(record.status))} columns={["number", "status", "version"]} actions={(record) => /draft/i.test(record.status) ? <><ActionButton kind="primary" disabled={!canAction("confirmSalesOrder")} onClick={() => openAction({ kind: "confirmSalesOrder", title: `Confirm ${record.number}`, description: "Activate open stock lines as customer demand without reserving, shipping, or invoicing.", finalLabel: "Confirm sales order", record })}>Confirm</ActionButton><ActionButton kind="quiet" disabled={!canAction("cancelSalesOrder")} onClick={() => openAction({ kind: "cancelSalesOrder", title: `Cancel ${record.number}`, description: "Cancel remaining demand; no stock movement or invoice is created.", finalLabel: "Cancel sales order", record })}>Cancel</ActionButton></> : <ActionButton kind="quiet" disabled={!canAction("cancelSalesOrder")} onClick={() => openAction({ kind: "cancelSalesOrder", title: `Cancel ${record.number}`, description: "Release remaining demand and active reservations without moving physical stock.", finalLabel: "Cancel remaining demand", record })}>Cancel remaining</ActionButton>} /></Section>;
}

function ShipmentCorrections({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <Section title="Posted shipments" detail="Posted shipments are read-only. Corrections create a linked reversal movement."><RecordTable records={records} columns={["number", "party", "reference", "quantity", "status"]} actions={(record) => <ActionButton disabled={!canAction("reverseShipment")} onClick={() => openAction({ kind: "reverseShipment", title: `Reverse ${record.number}`, description: "Create a linked correction that returns physical quantity to a controlled internal status.", finalLabel: "Post shipment reversal", record })}>Reverse shipment</ActionButton>} /></Section>;
}

function DropShipDeliveries({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <div className="workflow-stack"><section className="workflow-action-grid"><ActionCard title="Post supplier delivery" detail="Record externally delivered drop-ship quantity against the linked sales-order line." impact="Customer fulfillment increases · internal on-hand unchanged" action="Post delivery" disabled={!canAction("postDropShipDelivery")} onClick={() => openAction({ kind: "postDropShipDelivery", title: "Post drop-ship delivery", description: "Record proof that the supplier delivered to the customer. No internal warehouse inventory is created.", finalLabel: "Post drop-ship delivery" })} /></section><Section title="Drop-ship delivery ledger" detail="External delivery and correction documents preserve PO/SO lineage without touching internal on-hand."><RecordTable records={records} columns={["number", "reference", "quantity", "status", "detail"]} actions={(record) => <ActionButton disabled={!canAction("reverseDropShipDelivery") || !/posted|partial/i.test(record.status)} onClick={() => openAction({ kind: "reverseDropShipDelivery", title: `Reverse ${record.number}`, description: "Correct externally delivered quantity without changing internal inventory.", finalLabel: "Post delivery reversal", record })}>Reverse delivery</ActionButton>} /></Section></div>;
}

function VendorMatching({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <div className="workflow-stack"><Section title="Vendor bills and three-way match" detail="Compare purchase commitment, posted receipts, and vendor charges." action={<ActionButton kind="primary" disabled={!canAction("createVendorBill")} onClick={() => openAction({ kind: "createVendorBill", title: "Create vendor bill", description: "Record the financial obligation against a PO and posted receipt. Inventory does not move.", finalLabel: "Create vendor bill" })}>Create vendor bill</ActionButton>}><RecordCards records={records} renderActions={(record) => record.exception ? <ActionButton kind="primary" disabled={!canAction("resolveMatchException")} onClick={() => openAction({ kind: "resolveMatchException", title: `Resolve ${record.number}`, description: "Choose how to resolve the quantity, price, or unplanned-charge difference.", finalLabel: "Resolve match exception", record })}>Resolve exception</ActionButton> : <span className="read-only-label">Matched · no action needed</span>} /></Section></div>;
}

function CustomerBilling({ records, canAction, openAction }: { records: WorkflowRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <div className="workflow-stack"><section className="workflow-action-grid"><ActionCard title="Invoice posted shipment" detail="Create an invoice only for shipment-eligible quantities." impact="Financial receivable increases · inventory unchanged" action="Create invoice" disabled={!canAction("createCustomerInvoice")} onClick={() => openAction({ kind: "createCustomerInvoice", title: "Create invoice from shipment", description: "Invoice eligible shipped quantities without changing inventory.", finalLabel: "Create customer invoice" })} /><ActionCard title="Issue customer credit" detail="Create a price or billing correction separate from any physical return." impact="Receivable decreases · inventory unchanged" action="Issue credit" disabled={!canAction("issueCustomerCredit")} onClick={() => openAction({ kind: "issueCustomerCredit", title: "Issue customer credit", description: "Reduce the financial balance. This command does not return stock.", finalLabel: "Issue customer credit" })} /><ActionCard title="Record payment" detail="Apply a received payment to an open customer invoice." impact="Receivable decreases · cash receipt recorded" action="Record payment" disabled={!canAction("recordCustomerPayment")} onClick={() => openAction({ kind: "recordCustomerPayment", title: "Record customer payment", description: "Apply a payment to an invoice with an auditable reference.", finalLabel: "Record payment" })} /></section><Section title="Invoice and payment status" detail="Financial state is shown separately from order fulfillment."><RecordTable records={records} columns={["number", "party", "reference", "amount", "status", "detail"]} /></Section></div>;
}

function Returnables({ records, canAction, openAction }: { records: AssetRecord[]; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <div className="workflow-stack"><section className="workflow-action-grid"><ActionCard title="Issue returnable asset" detail="Track a rack, stillage, core, or reusable crate against a customer shipment." impact="Asset custody changes · deposit may be invoiced" action="Issue asset" disabled={!canAction("issueReturnableAsset")} onClick={() => openAction({ kind: "issueReturnableAsset", title: "Issue returnable asset", description: "Assign custody and optionally create a refundable customer deposit.", finalLabel: "Issue asset and record deposit" })} /></section><Section title="Returnable assets and deposits" detail="Custody, physical return, forfeiture, and deposit refund are explicit separate events."><RecordCards records={records} renderActions={(record) => <><ActionButton disabled={!canAction("returnReturnableAsset")} onClick={() => openAction({ kind: "returnReturnableAsset", title: `Return ${record.number}`, description: "Record the asset physically returned. Deposit refund remains a separate financial action.", finalLabel: "Record asset return", record })}>Record return</ActionButton><ActionButton kind="quiet" disabled={!canAction("forfeitReturnableAsset")} onClick={() => openAction({ kind: "forfeitReturnableAsset", title: `Forfeit ${record.number}`, description: "Close the outstanding asset and recognize its deposit as forfeited.", finalLabel: "Forfeit asset deposit", record })}>Forfeit</ActionButton><ActionButton kind="quiet" disabled={!canAction("refundAssetDeposit") || record.returned === 0} onClick={() => openAction({ kind: "refundAssetDeposit", title: `Refund deposit for ${record.number}`, description: "Issue the refundable deposit after the physical return has been recorded.", finalLabel: "Refund customer deposit", record })}>Refund deposit</ActionButton></>} /></Section></div>;
}

function AuditTimeline({ state }: { state: WorkflowState }) {
  const { audit: records, attachments } = state;
  const [category, setCategory] = useState("All");
  const visible = category === "All" ? records : records.filter((record) => record.category.includes(category));
  return <div className="workflow-stack"><Section title="Unified audit timeline" detail="Actor, source document, timestamp, and before/after business impact in one immutable sequence."><div className="audit-filters" role="group" aria-label="Audit category">{["All", "Commercial", "Physical", "Financial"].map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div><ol className="audit-timeline">{visible.map((record) => <li key={record.id}><span className="audit-dot" /><div><span className="workflow-kicker">{record.category} · {record.time}</span><h3>{record.action} · {record.record}</h3><p>{record.impact}</p><small>Actor: {record.actor} · Source relationship: {record.record}</small></div></li>)}</ol></Section><AttachmentsPanel records={attachments} state={state} /></div>;
}

function Policies({ records, user, canAction, openAction }: { records: PolicyRecord[]; user: CurrentUser; canAction: (kind: WorkflowActionKind) => boolean; openAction: (action: ActionDefinition) => void }) {
  return <div className="workflow-stack"><section className="current-user-card"><div className="user-avatar" aria-hidden="true">{user.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div><div><span className="workflow-kicker">Current user and role</span><h2>{user.name}</h2><p>{user.role}</p></div><ul aria-label="Granted permission groups">{user.permissions.map((permission) => <li key={permission}>✓ {permission}</li>)}</ul></section><Section title="System policies" detail="Operational controls show what changes, who is affected, and whether existing records move."><div className="policy-grid">{records.map((record) => <article key={record.id}><div><span className="workflow-kicker">{record.risk}</span><h3>{record.name}</h3><p>{record.description}</p></div><strong>{record.value}</strong><ActionButton disabled={!canAction("updatePolicy")} onClick={() => openAction({ kind: "updatePolicy", title: `Change ${record.name}`, description: `${record.description} Existing posted records will not be changed.`, finalLabel: "Save policy for future transactions", record })}>{canAction("updatePolicy") ? "Review change" : "Not permitted"}</ActionButton></article>)}</div></Section></div>;
}

function AttachmentsPanel({ records, state }: { records: AttachmentRecord[]; state?: WorkflowState }) {
  const [items, setItems] = useState(records);
  const [document, setDocument] = useState("");
  const [category, setCategory] = useState("document");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const documents = state ? [
    ...state.options.purchaseOrders.map((item) => ({ ...item, type: "purchase_order" })), ...state.options.salesOrders.map((item) => ({ ...item, type: "sales_order" })),
    ...state.options.vendorBills.map((item) => ({ ...item, type: "vendor_bill" })), ...state.options.customerInvoices.map((item) => ({ ...item, type: "customer_invoice" })),
  ] : [];
  const canManage = state?.permissions.canOperate === true;
  const upload = async (event: FormEvent) => {
    event.preventDefault(); setMessage("");
    if (!file || !document) return setMessage("Choose a durable document and file.");
    if (file.size > 10 * 1024 * 1024) return setMessage("File exceeds the 10 MB limit.");
    const [documentType, documentId] = document.split("|"); const form = new FormData(); form.set("documentType", documentType); form.set("documentId", documentId); form.set("category", category); form.set("file", file);
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
  return <Section title="Attachments" detail="Durable PDF and image evidence linked to business documents.">{state ? <form className="attachment-upload" onSubmit={upload}><OptionField label="Document" value={document} options={documents.map((item) => ({ id: `${item.type}|${item.id}`, label: item.label }))} setValue={setDocument} /><label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="document">Document</option><option value="damage_photo">Damage photo</option><option value="proof_of_delivery">Proof of delivery</option><option value="packing_slip">Packing slip</option><option value="invoice">Invoice</option><option value="label">Label</option><option value="other">Other</option></select></label><label><span>File (PDF, JPEG, PNG, WebP; 10 MB max)</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={!canManage || busy} required /></label><button className="workflow-action primary" type="submit" disabled={!canManage || busy}>{busy ? "Uploading…" : "Upload attachment"}</button>{!canManage ? <span className="read-only-label">Operational posting permission required</span> : null}{message ? <span role="status">{message}</span> : null}</form> : null}<div className="attachment-list">{items.map((record) => { const canRemove = canManage && (record.ownerId === state?.currentUser.id || /manager|administrator/i.test(state?.currentUser.role ?? "")); return <article key={record.id}><span className="attachment-type" aria-hidden="true">{record.type.includes("photo") ? "IMG" : "FILE"}</span><div><h3>{record.fileName}</h3><p>{record.type} · {record.document}</p><small>{record.uploadedBy} · {record.time}</small></div><StatusPill>{record.status}</StatusPill><a href={record.href ?? `/api/attachments/${encodeURIComponent(record.id)}`} target="_blank" rel="noreferrer">Open file</a>{canRemove ? <button className="workflow-action quiet" type="button" disabled={busy} onClick={() => void remove(record.id)}>Remove</button> : null}</article>; })}{!items.length ? <div className="workflow-empty">No attachments yet.</div> : null}</div></Section>;
}

export function LegacyAttachmentsPanel({ records }: { records: AttachmentRecord[] }) {
  return <Section title="Attachments" detail="Files and upload checks exposed by the durable workflow service."><div className="attachment-list">{records.map((record) => <article key={record.id}><span className="attachment-type" aria-hidden="true">{record.type.includes("photo") ? "IMG" : "PDF"}</span><div><h3>{record.fileName}</h3><p>{record.type} · {record.document}</p><small>{record.uploadedBy} · {record.time}</small></div><StatusPill>{record.status}</StatusPill>{record.href ? <a href={record.href} target="_blank" rel="noreferrer">Open file</a> : <span className="read-only-label">Stored · preview unavailable</span>}</article>)}</div></Section>;
}

function RecordTable({ records, columns, actions }: { records: WorkflowRecord[]; columns: Array<keyof WorkflowRecord>; actions?: (record: WorkflowRecord) => ReactNode }) {
  return <div className="workflow-table-wrap"><table className="workflow-table"><caption className="sr-only">Operational records</caption><thead><tr>{columns.map((column) => <th key={column}>{columnLabel(column)}</th>)}{actions ? <th><span className="sr-only">Actions</span></th> : null}</tr></thead><tbody>{records.map((record) => <tr key={record.id}>{columns.map((column) => <td key={column}>{renderRecordValue(column, record[column])}</td>)}{actions ? <td><div className="workflow-row-actions">{actions(record)}</div></td> : null}</tr>)}{!records.length ? <tr><td colSpan={columns.length + (actions ? 1 : 0)}><div className="workflow-empty">No records in this view.</div></td></tr> : null}</tbody></table></div>;
}

function RecordCards<T extends WorkflowRecord>({ records, renderActions }: { records: T[]; renderActions: (record: T) => ReactNode }) {
  return <div className="workflow-record-cards">{records.map((record) => <article key={record.id}><header><div><span className="workflow-kicker">{record.reference ?? record.status}</span><h3>{record.number}</h3><p>{record.party}</p></div><StatusPill>{record.status}</StatusPill></header>{record.exception || record.detail ? <div className={`record-callout ${record.exception ? "warning" : "neutral"}`}>{record.exception ?? record.detail}</div> : null}<dl><div><dt>Quantity</dt><dd>{record.quantity ?? "—"}</dd></div><div><dt>Amount</dt><dd>{record.amount === undefined ? "—" : cad.format(record.amount)}</dd></div><div><dt>Revision</dt><dd>{record.revision ?? "—"}</dd></div></dl><footer>{renderActions(record)}</footer></article>)}</div>;
}

function ActionCard({ title, detail, impact, action, onClick, disabled, tone = "neutral" }: { title: string; detail: string; impact: string; action: string; onClick: () => void; disabled?: boolean; tone?: Tone }) {
  return <article className={`workflow-action-card ${tone}`}><span className="workflow-kicker">Business command</span><h3>{title}</h3><p>{detail}</p><strong>{impact}</strong><ActionButton kind={tone === "danger" ? "secondary" : "primary"} onClick={onClick} disabled={disabled}>{action}</ActionButton></article>;
}

function StatusPill({ children }: { children: ReactNode }) {
  const label = String(children);
  const tone = /exception|hold|due|pending|partial/i.test(label) ? "warning" : /approved|matched|ready|posted|returned/i.test(label) ? "success" : "neutral";
  return <span className={`workflow-status ${tone}`}><span aria-hidden="true" />{children}</span>;
}

function initialReference(kind: WorkflowActionKind, state: WorkflowState) {
  if (["transferInventory", "changeInventoryStatus", "scrapInventory"].includes(kind)) return state.options.products[0]?.id ?? "";
  if (kind === "reallocateReservation") return state.options.salesOrderLines[0]?.id ?? "";
  if (kind === "postDropShipDelivery") return state.options.salesOrderLines.find((option) => option.status === "drop_ship")?.id ?? "";
  if (kind === "createVendorBill") return state.options.purchaseOrderLines[0]?.id ?? "";
  if (kind === "createCustomerInvoice") return state.options.salesOrders[0]?.id ?? "";
  if (["issueCustomerCredit", "recordCustomerPayment"].includes(kind)) return state.options.customerInvoices[0]?.id ?? "";
  if (kind === "allocateLandedCost") return state.options.costLayers[0]?.id ?? "";
  if (kind === "issueReturnableAsset") return state.options.partners.find((option) => option.detail === "customer")?.id ?? state.options.partners[0]?.id ?? "";
  return "";
}

type WorkflowPayloadInput = { quantity: number; amount: number; reason: string; reference: string; externalReference: string; source: string; destination: string; resolution: string; policyValue: string; financial: FinancialInput };
export function buildWorkflowPayload(action: ActionDefinition, state: WorkflowState, input: WorkflowPayloadInput): Record<string, unknown> {
  const cents = Math.round(input.amount * 100);
  const money = { currency: input.financial.currency, exchangeRateToBase: input.financial.exchangeRate, paymentTerms: input.financial.terms, dueDate: input.financial.dueDate, taxCode: input.financial.taxCode, taxRateBps: Math.round(input.financial.taxRate * 100) };
  switch (action.kind) {
    case "submitPurchaseOrder": case "approvePurchaseOrder": case "rejectPurchaseOrder": case "confirmSalesOrder": case "cancelSalesOrder": case "approveApproval": case "rejectApproval": return { reason: input.reason };
    case "amendPurchaseOrder": return { lines: [{ lineId: input.reference, orderedQuantity: input.quantity, ...(cents > 0 ? { unitCostCents: cents } : {}) }], reason: input.reason };
    case "transferInventory": case "changeInventoryStatus": return { productId: input.reference, fromLocationId: input.source, toLocationId: input.destination, quantity: input.quantity, reason: input.reason, postingDate: today };
    case "scrapInventory": return { productId: input.reference, locationId: input.source, quantity: input.quantity, reason: input.reason, postingDate: today };
    case "releaseReservation": return { quantity: input.quantity, reason: input.reason };
    case "reallocateReservation": return { targetSalesOrderLineId: input.reference, targetLocationId: input.destination, quantity: input.quantity, reason: input.reason };
    case "reverseShipment": return { quantity: input.quantity, reason: input.reason };
    case "postDropShipDelivery": return { salesOrderLineId: input.reference, quantity: input.quantity, deliveryDate: input.financial.dueDate, externalReference: input.externalReference };
    case "reverseDropShipDelivery": return { quantity: input.quantity, reason: input.reason };
    case "allocateLandedCost": return { amountCents: cents, allocationBasis: "purchase_value", costLayerIds: [input.reference], sourceDocumentType: "vendor_bill", sourceDocumentId: input.externalReference };
    case "createVendorBill": {
      const poLine = state.options.purchaseOrderLines.find((option) => option.id === input.reference);
      return { ...money, purchaseOrderId: poLine?.detail, vendorInvoiceNumber: input.externalReference, invoiceDate: today, dueDate: input.financial.dueDate, lines: [{ purchaseOrderLineId: input.reference, quantity: input.quantity, unitCostCents: cents }] };
    }
    case "resolveMatchException": {
      if (input.resolution === "request-credit") return { amountCents: cents, reason: input.reason, currency: input.financial.currency, exchangeRateToBase: input.financial.exchangeRate, vendorId: state.options.vendorBills.find((option) => option.id === action.record?.id)?.detail, documentId: action.record?.id };
      if (input.resolution !== "approve-variance") throw new Error("This resolution needs a purchasing amendment command that is not available on this server.");
      return { reason: input.reason };
    }
    case "createCustomerInvoice": return { salesOrderId: input.reference, invoiceDate: today, dueDate: input.financial.dueDate, exchangeRateToBase: input.financial.exchangeRate, taxRateBps: Math.round(input.financial.taxRate * 100), taxCode: input.financial.taxCode, paymentTerms: input.financial.terms };
    case "issueCustomerCredit": return { amountCents: cents, reason: input.reason, currency: input.financial.currency, exchangeRateToBase: input.financial.exchangeRate, customerId: state.options.customerInvoices.find((option) => option.id === input.reference)?.detail, documentId: input.reference };
    case "recordCustomerPayment": return { documentId: input.reference, documentType: "customer_invoice", amountCents: cents, paymentDate: today, method: input.resolution || "bank_transfer", reference: input.externalReference, exchangeRateToBase: input.financial.exchangeRate };
    case "issueReturnableAsset": return { partnerId: input.reference, assetTypeId: input.resolution, quantity: input.quantity, direction: "customer_holds", reason: input.reason };
    case "returnReturnableAsset": case "forfeitReturnableAsset": return { quantity: input.quantity, reason: input.reason };
    case "refundAssetDeposit": return { amountCents: cents, reason: input.reason };
    case "updatePolicy": return { key: action.record?.id, value: input.policyValue, reason: input.reason };
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
  const [amount, setAmount] = useState(action.record?.amount ?? 0);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState(() => initialReference(action.kind, state));
  const [externalReference, setExternalReference] = useState("");
  const [source, setSource] = useState(state.options.locations[0]?.id ?? "");
  const [destination, setDestination] = useState(state.options.locations[1]?.id ?? state.options.locations[0]?.id ?? "");
  const [resolution, setResolution] = useState(action.kind === "issueReturnableAsset" ? state.options.assetTypes[0]?.id ?? "" : action.kind === "resolveMatchException" && state.permissions.approveVendorBill !== true ? "request-credit" : "approve-variance");
  const [policyValue, setPolicyValue] = useState((action.record as PolicyRecord | undefined)?.value ?? "");
  const [charges, setCharges] = useState({ freight: 0, duty: 0, fee: 0 });
  const [financial, setFinancial] = useState<FinancialInput>({ currency: "CAD", exchangeRate: 1, terms: "Net 30", dueDate: today, taxCode: "GST", taxRate: 5, discount: 0, freight: 0, fees: 0, deposit: 0, paid: 0 });
  const [lines, setLines] = useState<DraftLine[]>([{ id: crypto.randomUUID(), sku: "", description: "", quantity: 1, unitCost: 0, expectedDate: today, customerRef: "" }]);

  useEffect(() => { closeRef.current?.focus(); const keydown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); }; document.addEventListener("keydown", keydown); return () => document.removeEventListener("keydown", keydown); }, [busy, onClose]);

  const impact = useMemo(() => workflowImpact(action.kind, { quantity, amount, source, destination, resolution, policyValue, charges, lines }, action.record), [action, amount, charges, destination, lines, policyValue, quantity, resolution, source]);
  const invalid = requiresReason(action.kind) && !reason.trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (invalid) { setError("Enter a reason so this action is traceable."); return; }
    setBusy(true);
    try {
      await onSubmit(buildWorkflowPayload(action, state, { quantity, amount, reason, reference, externalReference, source, destination, resolution, policyValue, financial }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The workflow could not be completed. Your entries are still here."); setBusy(false); }
  };

  return <div className="workflow-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="workflow-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}><header><div><span className="workflow-kicker">Business command</span><h2 id={titleId}>{action.title}</h2><p id={descriptionId}>{action.description}</p></div><button ref={closeRef} onClick={onClose} disabled={busy} aria-label={`Close ${action.title}`}>×</button></header><form onSubmit={submit}>{error ? <div className="workflow-error" role="alert" tabIndex={-1}><strong>Couldn’t complete this action</strong><p>{error}</p></div> : null}<WorkflowFields action={action} state={state} quantity={quantity} setQuantity={setQuantity} amount={amount} setAmount={setAmount} reason={reason} setReason={setReason} reference={reference} setReference={setReference} externalReference={externalReference} setExternalReference={setExternalReference} source={source} setSource={setSource} destination={destination} setDestination={setDestination} resolution={resolution} setResolution={setResolution} policyValue={policyValue} setPolicyValue={setPolicyValue} charges={charges} setCharges={setCharges} financial={financial} setFinancial={setFinancial} lines={lines} setLines={setLines} /><ImpactReview lines={impact} /><footer><button type="button" className="workflow-action secondary" onClick={onClose} disabled={busy}>Keep reviewing</button><button type="submit" className="workflow-action primary" disabled={busy || invalid} aria-busy={busy}>{busy ? "Posting…" : action.finalLabel}</button></footer></form></section></div>;
}

type FieldProps = {
  action: ActionDefinition; state: WorkflowState; quantity: number; setQuantity: (value: number) => void; amount: number; setAmount: (value: number) => void; reason: string; setReason: (value: string) => void; reference: string; setReference: (value: string) => void; externalReference: string; setExternalReference: (value: string) => void; source: string; setSource: (value: string) => void; destination: string; setDestination: (value: string) => void; resolution: string; setResolution: (value: string) => void; policyValue: string; setPolicyValue: (value: string) => void; charges: { freight: number; duty: number; fee: number }; setCharges: (value: { freight: number; duty: number; fee: number }) => void; financial: FinancialInput; setFinancial: (value: FinancialInput) => void; lines: DraftLine[]; setLines: (value: DraftLine[]) => void;
};

function WorkflowFields(props: FieldProps) {
  const { action, state } = props;
  if (action.kind === "createPurchaseOrder") return <PurchaseOrderFields {...props} />;
  if (["approveApproval", "rejectApproval"].includes(action.kind)) return <div className="workflow-form-grid"><div className="workflow-record-context full"><span>{action.record?.number}</span><strong>{action.record?.status}</strong><small>{action.record?.detail}</small></div><ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (action.kind === "postDropShipDelivery") return <div className="workflow-form-grid"><OptionField label="Drop-ship sales-order line" value={props.reference} options={state.options.salesOrderLines.filter((option) => option.status === "drop_ship")} setValue={props.setReference} /><label><span>Delivered quantity</span><input type="number" min="0.0001" step="0.0001" value={props.quantity} onChange={(event) => props.setQuantity(Number(event.target.value))} required /></label><label><span>Delivery date</span><input type="date" value={props.financial.dueDate} onChange={(event) => props.setFinancial({ ...props.financial, dueDate: event.target.value })} required /></label><label><span>Supplier proof / reference</span><input value={props.externalReference} onChange={(event) => props.setExternalReference(event.target.value)} required /></label></div>;
  if (action.kind === "updatePolicy") return <div className="workflow-form-grid"><label className="full"><span>Current value</span><input value={(action.record as PolicyRecord).value} disabled /></label><label className="full"><span>New value</span><input value={props.policyValue} onChange={(event) => props.setPolicyValue(event.target.value)} required /></label><ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (action.kind === "amendPurchaseOrder") return <div className="workflow-form-grid"><div className="workflow-record-context full"><span>{action.record?.number}</span><strong>Revision {(action.record?.revision ?? 1) + 1}</strong><small>The server will reject a quantity below net received.</small></div><label><span>Purchase-order line ID</span><input value={props.reference} onChange={(event) => props.setReference(event.target.value)} placeholder="Select or paste line ID" required /></label><label><span>Revised ordered quantity</span><input type="number" min="1" value={props.quantity} onChange={(event) => props.setQuantity(Number(event.target.value))} required /></label><label><span>Revised unit cost (optional)</span><input type="number" min="0" step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} /></label><ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (action.kind === "createVendorBill") return <div className="workflow-form-grid"><OptionField label="Purchase order line" value={props.reference} options={state.options.purchaseOrderLines} setValue={props.setReference} /><label><span>Vendor invoice number</span><input value={props.externalReference} onChange={(event) => props.setExternalReference(event.target.value)} required /></label><label><span>Billed quantity</span><input type="number" min="0.0001" step="0.0001" value={props.quantity} onChange={(event) => props.setQuantity(Number(event.target.value))} required /></label><label><span>Unit cost</span><input type="number" min="0.01" step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} required /></label><FinancialDetails value={props.financial} onChange={props.setFinancial} items={props.quantity * props.amount} /></div>;
  if (action.kind === "createCustomerInvoice") return <div className="workflow-form-grid"><OptionField label="Sales order with invoiceable delivery" value={props.reference} options={state.options.salesOrders} setValue={props.setReference} /><FinancialDetails value={props.financial} onChange={props.setFinancial} items={0} /></div>;
  if (action.kind === "issueCustomerCredit") return <div className="workflow-form-grid"><OptionField label="Customer invoice" value={props.reference} options={state.options.customerInvoices} setValue={props.setReference} /><label><span>Credit amount</span><input type="number" min="0.01" step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} required /></label><FinancialDetails value={props.financial} onChange={props.setFinancial} items={props.amount} /><ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (action.kind === "recordCustomerPayment") return <div className="workflow-form-grid"><OptionField label="Customer invoice" value={props.reference} options={state.options.customerInvoices} setValue={props.setReference} /><label><span>Payment amount</span><input type="number" min="0.01" step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} required /></label><label><span>Method</span><select value={props.resolution} onChange={(event) => props.setResolution(event.target.value)}><option value="bank_transfer">Bank transfer</option><option value="credit_card">Credit card</option><option value="cheque">Cheque</option><option value="cash">Cash</option></select></label><label><span>Payment reference</span><input value={props.externalReference} onChange={(event) => props.setExternalReference(event.target.value)} required /></label><FinancialDetails value={props.financial} onChange={props.setFinancial} items={props.amount} /></div>;
  if (action.kind === "allocateLandedCost") return <div className="workflow-form-grid"><OptionField label="Cost layer" value={props.reference} options={state.options.costLayers} setValue={props.setReference} /><OptionField label="Source vendor bill" value={props.externalReference} options={state.options.vendorBills} setValue={props.setExternalReference} /><label><span>Amount</span><input type="number" min="0.01" step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} required /></label></div>;
  if (action.kind === "issueReturnableAsset") return <div className="workflow-form-grid"><OptionField label="Customer" value={props.reference} options={state.options.partners.filter((option) => option.detail === "customer")} setValue={props.setReference} /><OptionField label="Asset type" value={props.resolution} options={state.options.assetTypes} setValue={props.setResolution} /><label><span>Quantity</span><input type="number" min="1" step="1" value={props.quantity} onChange={(event) => props.setQuantity(Number(event.target.value))} required /></label><ReasonField value={props.reason} setValue={props.setReason} /></div>;
  if (action.kind === "resolveMatchException") return <div className="workflow-form-grid"><fieldset className="full"><legend>Resolution</legend>{[["approve-variance", "Approve price / charge variance"], ["request-credit", "Post vendor credit"]].map(([value, label]) => <label key={value} className="workflow-radio"><input type="radio" name="resolution" value={value} checked={props.resolution === value} disabled={value === "approve-variance" ? state.permissions.approveVendorBill !== true : state.permissions.createVendorCredit !== true} onChange={(event) => props.setResolution(event.target.value)} />{label}</label>)}</fieldset>{props.resolution === "request-credit" ? <><label><span>Credit amount</span><input type="number" min="0.01" step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} required /></label><FinancialDetails value={props.financial} onChange={props.setFinancial} items={props.amount} /></> : null}<ReasonField value={props.reason} setValue={props.setReason} /></div>;
  const moneyAction = ["createVendorBill", "createCustomerInvoice", "issueCustomerCredit", "recordCustomerPayment", "allocateLandedCost", "refundAssetDeposit"].includes(action.kind);
  const movementAction = ["transferInventory", "changeInventoryStatus", "scrapInventory", "reverseShipment", "returnReturnableAsset"].includes(action.kind);
  return <div className="workflow-form-grid">
    {action.record ? <div className="workflow-record-context full"><span>{action.record.number}</span><strong>{action.record.party ?? action.record.status}</strong><small>Version {action.record.version ?? 1} will be checked before posting.</small></div> : null}
    {movementAction && !["reverseShipment", "returnReturnableAsset"].includes(action.kind) ? <RemoteProductField value={props.reference} initialOptions={state.options.products} setValue={props.setReference} /> : null}
    {["submitPurchaseOrder", "approvePurchaseOrder", "rejectPurchaseOrder", "amendPurchaseOrder"].includes(action.kind) ? null : <label><span>{moneyAction ? "Amount (CAD)" : "Quantity"}</span><input type="number" min={moneyAction ? "0.01" : "1"} step={moneyAction ? "0.01" : "1"} value={moneyAction ? props.amount : props.quantity} onChange={(event) => moneyAction ? props.setAmount(Number(event.target.value)) : props.setQuantity(Number(event.target.value))} required /></label>}
    {["createVendorBill", "createCustomerInvoice", "issueCustomerCredit", "recordCustomerPayment", "issueReturnableAsset"].includes(action.kind) ? <label><span>Document / payment reference</span><input value={props.reference} onChange={(event) => props.setReference(event.target.value)} placeholder="External reference" required /></label> : null}
    {moneyAction ? <FinancialDetails value={props.financial} onChange={props.setFinancial} items={props.amount} /> : null}
    {movementAction && !["reverseShipment", "returnReturnableAsset"].includes(action.kind) ? <><RemoteLocationField label="Source location" value={props.source} initialOptions={state.options.locations} setValue={props.setSource} />{action.kind !== "scrapInventory" ? <RemoteLocationField label="Destination location" value={props.destination} initialOptions={state.options.locations} setValue={props.setDestination} /> : null}</> : null}
    {action.kind === "reallocateReservation" ? <><OptionField label="New sales order demand" value={props.reference} options={state.options.salesOrderLines} setValue={props.setReference} /><OptionField label="Target location" value={props.destination} options={state.options.locations} setValue={props.setDestination} /></> : null}
    {action.kind === "changeInventoryStatus" ? <label><span>New status</span><select value={props.resolution} onChange={(event) => props.setResolution(event.target.value)}><option value="quarantine">Quality hold</option><option value="damaged">Damaged</option><option value="available">Available</option><option value="return-pending">Return pending</option></select></label> : null}
    {requiresReason(action.kind) ? <ReasonField value={props.reason} setValue={props.setReason} /> : null}
  </div>;
}

function OptionField({ label, value, options, setValue, disabled = false }: { label: string; value: string; options: SelectOption[]; setValue: (value: string) => void; disabled?: boolean }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => setValue(event.target.value)} disabled={disabled} required><option value="" disabled>{options.length ? `Select ${label.toLowerCase()}` : "No durable records available"}</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>;
}

function RemoteReferenceField({ kind, role, label, placeholder, value, initialOptions, setOption }: { kind: "products" | "partners" | "locations"; role?: "vendor" | "customer" | "usable" | "quarantine" | "damaged" | "in_transit" | "return_pending" | "non_usable"; label: string; placeholder: string; value: string; initialOptions: SelectOption[]; setOption: (option: SelectOption) => void }) {
  const listboxId = useId();
  const [query, setQuery] = useState(initialOptions.find((option) => option.id === value)?.label ?? "");
  const [options, setOptions] = useState(initialOptions.slice(0, 20));
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void (async () => {
      const params = new URLSearchParams({ lookup: kind, q: query, limit: "25" });
      if (role) params.set("role", role);
      const response = await fetch(`/api/snapshot?${params}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) return;
      const raw = await response.json() as { items?: Array<Record<string, unknown>> };
      setOptions((raw.items ?? []).map((item) => ({ id: String(item.id), label: kind === "products" ? `${String(item.sku)} · ${String(item.name)}` : kind === "locations" ? `${String(item.warehouseCode)} · ${String(item.code)} · ${String(item.name)}` : `${String(item.code)} · ${String(item.name)}`, detail: kind === "partners" ? String(item.partnerType ?? "") : kind === "locations" ? String(item.inventoryStatus ?? "") : undefined, version: Number(item.version ?? 0) || undefined, data: item })));
    })(); }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [kind, open, query, role]);
  return <label className="reference-search"><span>{label}</span><input role="combobox" value={query} aria-controls={listboxId} aria-expanded={open} autoComplete="off" placeholder={placeholder} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} />{open ? <div id={listboxId} className="reference-results" role="listbox">{options.map((option) => <button type="button" role="option" aria-selected={option.id === value} key={option.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setOption(option); setQuery(option.label); setOpen(false); }}>{option.label}</button>)}{!options.length ? <span>No matching active records</span> : null}</div> : null}</label>;
}

function RemoteProductField({ value, initialOptions, setValue, onSelect, label = "Product" }: { value: string; initialOptions: SelectOption[]; setValue: (value: string) => void; onSelect?: (option: SelectOption) => void; label?: string }) {
  return <RemoteReferenceField kind="products" label={label} placeholder="Search every SKU or product" value={value} initialOptions={initialOptions} setOption={(option) => { setValue(option.id); onSelect?.(option); }} />;
}

function RemotePartnerField({ value, initialOptions, setValue, role, label }: { value: string; initialOptions: SelectOption[]; setValue: (value: string) => void; role: "vendor" | "customer"; label: string }) {
  return <RemoteReferenceField kind="partners" role={role} label={label} placeholder={`Search every active ${role}`} value={value} initialOptions={initialOptions} setOption={(option) => setValue(option.id)} />;
}

function RemoteLocationField({ value, initialOptions, setValue, label }: { value: string; initialOptions: SelectOption[]; setValue: (value: string) => void; label: string }) {
  return <RemoteReferenceField kind="locations" label={label} placeholder="Search every active location" value={value} initialOptions={initialOptions} setOption={(option) => setValue(option.id)} />;
}

function FinancialDetails({ value, onChange, items }: { value: FinancialInput; onChange: (value: FinancialInput) => void; items: number }) {
  const tax = Math.max(items - value.discount + value.freight + value.fees, 0) * value.taxRate / 100;
  const total = items - value.discount + value.freight + value.fees + value.deposit + tax;
  const balance = total - value.paid;
  const set = (patch: Partial<FinancialInput>) => onChange({ ...value, ...patch });
  return <fieldset className="financial-details full"><legend>Financial terms and totals</legend><div className="financial-fields"><label><span>Currency</span><select value={value.currency} onChange={(event) => set({ currency: event.target.value })}><option>CAD</option><option>USD</option><option>EUR</option></select></label>{value.currency !== "CAD" ? <label><span>Exchange rate to CAD</span><input type="number" min="0.0001" step="0.0001" value={value.exchangeRate} onChange={(event) => set({ exchangeRate: Number(event.target.value) })} /></label> : null}<label><span>Terms</span><select value={value.terms} onChange={(event) => set({ terms: event.target.value })}><option>Due on receipt</option><option>Net 15</option><option>Net 30</option><option>Net 45</option></select></label><label><span>Due date</span><input type="date" value={value.dueDate} onChange={(event) => set({ dueDate: event.target.value })} /></label><label><span>Tax code</span><select value={value.taxCode} onChange={(event) => set({ taxCode: event.target.value, taxRate: event.target.value === "GST" ? 5 : 0 })}><option>GST</option><option>Zero</option><option>Exempt</option></select></label><label><span>Tax %</span><input type="number" min="0" step="0.01" value={value.taxRate} onChange={(event) => set({ taxRate: Number(event.target.value) })} /></label><label><span>Discount</span><input type="number" min="0" step="0.01" value={value.discount} onChange={(event) => set({ discount: Number(event.target.value) })} /></label><label><span>Freight</span><input type="number" min="0" step="0.01" value={value.freight} onChange={(event) => set({ freight: Number(event.target.value) })} /></label><label><span>Other fees</span><input type="number" min="0" step="0.01" value={value.fees} onChange={(event) => set({ fees: Number(event.target.value) })} /></label><label><span>Refundable core / empty deposit</span><input type="number" min="0" step="0.01" value={value.deposit} onChange={(event) => set({ deposit: Number(event.target.value) })} /></label><label><span>Paid</span><input type="number" min="0" step="0.01" value={value.paid} onChange={(event) => set({ paid: Number(event.target.value) })} /></label></div><dl className="financial-total-lines"><div><dt>Items</dt><dd>{value.currency} {items.toFixed(2)}</dd></div><div><dt>Discount</dt><dd>−{value.currency} {value.discount.toFixed(2)}</dd></div><div><dt>Freight & fees</dt><dd>{value.currency} {(value.freight + value.fees).toFixed(2)}</dd></div><div><dt>Refundable deposit</dt><dd>{value.currency} {value.deposit.toFixed(2)}</dd></div><div><dt>Tax</dt><dd>{value.currency} {tax.toFixed(2)}</dd></div><div><dt>Paid</dt><dd>−{value.currency} {value.paid.toFixed(2)}</dd></div><div className="total"><dt>Balance due</dt><dd>{value.currency} {balance.toFixed(2)}</dd></div></dl></fieldset>;
}

function PurchaseOrderFields({ state, lines, setLines, charges, setCharges, reference, setReference }: FieldProps) {
  const update = (id: string, patch: Partial<DraftLine>) => setLines(lines.map((line) => line.id === id ? { ...line, ...patch } : line));
  return <div className="po-composer"><div className="workflow-form-grid"><OptionField label="Vendor" value={reference} options={state.options.partners.filter((option) => option.detail === "vendor" || option.detail === "both")} setValue={setReference} /><div className="workflow-record-context"><span>Ship-to warehouse</span><strong>{state.options.warehouses[0]?.label ?? "No warehouse configured"}</strong><small>The destination location is confirmed when inventory is received.</small></div></div><div className="po-line-list"><div className="po-line-heading"><strong>Order lines</strong><button type="button" onClick={() => setLines([...lines, { id: crypto.randomUUID(), sku: "", description: "", quantity: 1, unitCost: 0, expectedDate: today, customerRef: "" }])}>+ Add line</button></div>{lines.map((line, index) => <fieldset key={line.id}><legend>Line {index + 1}</legend><label><span>SKU</span><input value={line.sku} onChange={(event) => update(line.id, { sku: event.target.value })} required /></label><label className="wide"><span>Description / frozen specification</span><input value={line.description} onChange={(event) => update(line.id, { description: event.target.value })} required /></label><label><span>Quantity</span><input type="number" min="1" value={line.quantity} onChange={(event) => update(line.id, { quantity: Number(event.target.value) })} required /></label><label><span>Unit cost</span><input type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => update(line.id, { unitCost: Number(event.target.value) })} required /></label><label><span>Expected</span><input type="date" value={line.expectedDate} onChange={(event) => update(line.id, { expectedDate: event.target.value })} required /></label><label><span>Customer / project allocation</span><input value={line.customerRef} onChange={(event) => update(line.id, { customerRef: event.target.value })} placeholder="Optional" /></label>{lines.length > 1 ? <button type="button" className="remove-line" onClick={() => setLines(lines.filter((item) => item.id !== line.id))}>Remove line {index + 1}</button> : null}</fieldset>)}</div><fieldset className="po-charges"><legend>Charges and fees</legend><label><span>Freight</span><input type="number" min="0" step="0.01" value={charges.freight} onChange={(event) => setCharges({ ...charges, freight: Number(event.target.value) })} /></label><label><span>Duty</span><input type="number" min="0" step="0.01" value={charges.duty} onChange={(event) => setCharges({ ...charges, duty: Number(event.target.value) })} /></label><label><span>Other fee</span><input type="number" min="0" step="0.01" value={charges.fee} onChange={(event) => setCharges({ ...charges, fee: Number(event.target.value) })} /></label></fieldset></div>;
}

function ReasonField({ value, setValue }: { value: string; setValue: (value: string) => void }) {
  return <label className="full"><span>Reason / audit note</span><textarea value={value} onChange={(event) => setValue(event.target.value)} placeholder="Explain why this action is needed" rows={3} required /></label>;
}

type ImpactLine = { category: "Physical" | "Commercial" | "Financial" | "Audit"; label: string; effect: string; tone?: Tone };
function workflowImpact(kind: WorkflowActionKind, input: { quantity: number; amount: number; source: string; destination: string; resolution: string; policyValue: string; charges: { freight: number; duty: number; fee: number }; lines: DraftLine[] }, record?: ActionRecord): ImpactLine[] {
  const none = (category: ImpactLine["category"], label: string): ImpactLine => ({ category, label, effect: "No change" });
  if (kind === "createPurchaseOrder") { const subtotal = input.lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0); const fees = input.charges.freight + input.charges.duty + input.charges.fee; return [none("Physical", "On-hand inventory"), { category: "Commercial", label: "Draft purchase commitment", effect: `${input.lines.length} lines · ${input.lines.reduce((sum, line) => sum + line.quantity, 0)} units`, tone: "info" }, { category: "Financial", label: "Draft total", effect: cad.format(subtotal + fees) }, { category: "Audit", label: "Revision", effect: "Draft revision 1 created" }]; }
  if (["submitPurchaseOrder", "approvePurchaseOrder", "rejectPurchaseOrder", "amendPurchaseOrder"].includes(kind)) return [none("Physical", "On-hand inventory"), { category: "Commercial", label: "Purchase order", effect: kind === "approvePurchaseOrder" ? "Approved; incoming forecast becomes actionable" : kind === "rejectPurchaseOrder" ? "Returned to buyer" : kind === "amendPurchaseOrder" ? `Revision ${(record?.revision ?? 1) + 1} created` : "Submitted for approval", tone: kind === "rejectPurchaseOrder" ? "warning" : "info" }, none("Financial", "Vendor payable"), { category: "Audit", label: "Decision", effect: "Actor, timestamp, reason, and revision recorded" }];
  if (kind === "transferInventory") return [{ category: "Physical", label: "Location movement", effect: `${input.quantity} from ${input.source} to ${input.destination}`, tone: "info" }, none("Physical", "Total on hand"), none("Commercial", "Demand and supply"), none("Financial", "Inventory value")];
  if (kind === "changeInventoryStatus") return [{ category: "Physical", label: "Inventory status", effect: `${input.quantity} → ${input.resolution}`, tone: input.resolution === "available" ? "success" : "warning" }, none("Physical", "Total on hand"), { category: "Commercial", label: "Available to reserve", effect: input.resolution === "available" ? `Increases by ${input.quantity}` : `Decreases by ${input.quantity}`, tone: "warning" }, none("Financial", "Inventory value")];
  if (kind === "scrapInventory") return [{ category: "Physical", label: "On-hand inventory", effect: `Decreases by ${input.quantity}`, tone: "danger" }, none("Commercial", "Open orders"), { category: "Financial", label: "Inventory valuation", effect: "Scrap expense posted", tone: "warning" }, { category: "Audit", label: "Scrap movement", effect: "Reason and source location linked" }];
  if (kind === "releaseReservation") return [none("Physical", "On-hand inventory"), { category: "Commercial", label: "Reserved quantity", effect: `Decreases by ${input.quantity}`, tone: "warning" }, { category: "Commercial", label: "Available now", effect: `Increases by ${input.quantity}`, tone: "success" }, none("Financial", "Customer balance")];
  if (kind === "reallocateReservation") return [none("Physical", "On-hand inventory"), { category: "Commercial", label: "Allocation", effect: `${input.quantity} moved to ${input.destination}`, tone: "info" }, none("Financial", "Customer balance"), { category: "Audit", label: "Reservation lineage", effect: "Old and new demand linked" }];
  if (kind === "reverseShipment") return [{ category: "Physical", label: "Controlled internal inventory", effect: `Increases by ${input.quantity} at ${input.destination}`, tone: "success" }, { category: "Commercial", label: "Net shipped", effect: `Decreases by ${input.quantity}`, tone: "warning" }, { category: "Financial", label: "Invoice eligibility", effect: `Decreases by ${input.quantity}` }, { category: "Audit", label: "Correction", effect: `Linked to ${record?.number}` }];
  if (kind === "postDropShipDelivery") return [none("Physical", "Internal on-hand inventory"), { category: "Commercial", label: "Drop-ship delivered", effect: `Increases by ${input.quantity}`, tone: "success" }, { category: "Financial", label: "Invoice eligibility", effect: `Increases by ${input.quantity}`, tone: "info" }, { category: "Audit", label: "External proof", effect: "PO line, SO line, date, and supplier reference linked" }];
  if (kind === "reverseDropShipDelivery") return [none("Physical", "Internal on-hand inventory"), { category: "Commercial", label: "Net drop-ship delivered", effect: `Decreases by ${input.quantity}`, tone: "warning" }, { category: "Financial", label: "Invoice eligibility", effect: `Decreases by ${input.quantity}` }, { category: "Audit", label: "Delivery correction", effect: `Linked to ${record?.number}` }];
  if (kind === "allocateLandedCost") return [none("Physical", "On-hand quantity"), none("Commercial", "Orders"), { category: "Financial", label: "Inventory value", effect: `Increases by ${cad.format(input.amount)}`, tone: "info" }, { category: "Audit", label: "Cost layer", effect: "Receipt and vendor charge linked" }];
  if (kind === "createVendorBill") return [none("Physical", "Inventory quantity"), none("Commercial", "Purchase commitment"), { category: "Financial", label: "Vendor payable", effect: `Increases by ${cad.format(input.amount)}`, tone: "info" }, { category: "Audit", label: "Three-way match", effect: "PO, receipt, and vendor reference linked" }];
  if (kind === "resolveMatchException") return [none("Physical", "Inventory quantity"), { category: "Commercial", label: "PO / receipt", effect: input.resolution === "amend-po" ? "New PO revision required" : "No quantity change" }, { category: "Financial", label: "Bill exception", effect: input.resolution.replaceAll("-", " "), tone: "warning" }, { category: "Audit", label: "Resolution", effect: "Decision and explanation recorded" }];
  if (kind === "createCustomerInvoice") return [none("Physical", "On-hand inventory"), none("Commercial", "Net shipped quantity"), { category: "Financial", label: "Customer receivable", effect: `Increases by ${cad.format(input.amount)}`, tone: "info" }, { category: "Audit", label: "Invoice source", effect: "Eligible shipment lines linked" }];
  if (kind === "issueCustomerCredit") return [none("Physical", "On-hand inventory"), none("Commercial", "Return or replacement demand"), { category: "Financial", label: "Customer receivable", effect: `Decreases by ${cad.format(input.amount)}`, tone: "warning" }, { category: "Audit", label: "Credit", effect: "Reason and original invoice linked" }];
  if (kind === "recordCustomerPayment") return [none("Physical", "Inventory"), none("Commercial", "Order fulfillment"), { category: "Financial", label: "Customer receivable", effect: `Decreases by ${cad.format(input.amount)}`, tone: "success" }, { category: "Financial", label: "Cash receipt", effect: cad.format(input.amount) }];
  if (kind === "issueReturnableAsset") return [{ category: "Physical", label: "Asset custody", effect: `${input.quantity} issued to customer`, tone: "info" }, none("Commercial", "Window inventory"), { category: "Financial", label: "Refundable deposit", effect: cad.format(input.amount) }, { category: "Audit", label: "Asset ledger", effect: "Shipment and customer linked" }];
  if (kind === "returnReturnableAsset") return [{ category: "Physical", label: "Asset custody", effect: `${input.quantity} returned to internal custody`, tone: "success" }, none("Commercial", "Window inventory"), { category: "Financial", label: "Deposit", effect: "Refund remains pending explicit action" }, { category: "Audit", label: "Asset return", effect: `Linked to ${record?.number}` }];
  if (kind === "forfeitReturnableAsset") return [none("Physical", "Window inventory"), { category: "Commercial", label: "Asset custody", effect: "Closed as not returned", tone: "warning" }, { category: "Financial", label: "Deposit", effect: "Recognized as forfeited", tone: "warning" }, { category: "Audit", label: "Forfeiture", effect: "Reason and customer recorded" }];
  if (kind === "refundAssetDeposit") return [none("Physical", "Asset custody"), none("Commercial", "Window orders"), { category: "Financial", label: "Customer deposit liability", effect: `Decreases by ${cad.format(input.amount)}`, tone: "success" }, { category: "Audit", label: "Refund", effect: `Linked to ${record?.number}` }];
  if (kind === "updatePolicy") return [none("Physical", "Existing inventory"), { category: "Commercial", label: "Future transactions", effect: `Policy changes to “${input.policyValue}”`, tone: "warning" }, none("Financial", "Existing postings"), { category: "Audit", label: "Policy version", effect: "Old value, new value, actor, and reason recorded" }];
  return [none("Physical", "Inventory"), none("Commercial", "Orders"), none("Financial", "Balances"), { category: "Audit", label: "Command", effect: "Recorded with idempotency protection" }];
}

function ImpactReview({ lines }: { lines: ImpactLine[] }) {
  return <section className="workflow-impact" aria-labelledby="workflow-impact-title"><header><span aria-hidden="true">⇄</span><div><h3 id="workflow-impact-title">Review business impact</h3><p>Server validation remains authoritative when you post.</p></div></header><div>{lines.map((line) => <div key={`${line.category}-${line.label}`} className={`workflow-impact-line ${line.tone ?? "neutral"}`}><span><small>{line.category}</small>{line.label}</span><strong>{line.effect}</strong></div>)}</div></section>;
}

function tabCount(workspace: OperationsWorkspaceKind, tab: string, state: WorkflowState) {
  if (workspace === "purchasing" && tab === "approvals") return state.purchaseOrders.filter((record) => record.status.toLowerCase().includes("pending")).length;
  if (workspace === "vendor-billing" && tab === "match") return state.vendorBills.filter((record) => record.exception).length;
  if (workspace === "inventory" && tab === "returnables") return state.assets.filter((record) => record.status !== "Returned").length;
  if ((workspace === "inventory" || workspace === "controls") && tab === "approvals") return state.approvals.filter((record) => /pending/i.test(record.status)).length;
  return 0;
}

function requiresReason(kind: WorkflowActionKind) {
  return ["submitPurchaseOrder", "approvePurchaseOrder", "rejectPurchaseOrder", "amendPurchaseOrder", "confirmSalesOrder", "cancelSalesOrder", "approveApproval", "rejectApproval", "transferInventory", "changeInventoryStatus", "scrapInventory", "releaseReservation", "reallocateReservation", "reverseShipment", "reverseDropShipDelivery", "resolveMatchException", "issueCustomerCredit", "issueReturnableAsset", "returnReturnableAsset", "forfeitReturnableAsset", "refundAssetDeposit", "updatePolicy"].includes(kind);
}

function actionTitle(kind: WorkflowActionKind) { return kind.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase()); }
function workflowCommand(kind: WorkflowActionKind, resolution: string) {
  const map: Partial<Record<WorkflowActionKind, string>> = {
    createPurchaseOrder: "createPurchaseOrderDraft",
    issueCustomerCredit: "createCustomerCredit",
    recordCustomerPayment: "recordPayment",
    issueReturnableAsset: "issueReturnable",
    returnReturnableAsset: "returnReturnable",
    forfeitReturnableAsset: "forfeitReturnable",
    refundAssetDeposit: "refundReturnableDeposit",
    resolveMatchException: resolution === "request-credit" ? "createVendorCredit" : "approveVendorBill",
  };
  return map[kind] ?? kind;
}
function columnLabel(column: keyof WorkflowRecord) { return ({ number: "Record", party: "Vendor / customer", reference: "Related documents", amount: "Amount", quantity: "Quantity", status: "Status", detail: "Details", version: "Version", revision: "Revision", exception: "Exception", id: "ID" } as Record<keyof WorkflowRecord, string>)[column]; }
function renderRecordValue(column: keyof WorkflowRecord, value: WorkflowRecord[keyof WorkflowRecord]) { if (column === "amount" && typeof value === "number") return cad.format(value); if (column === "status" && value) return <StatusPill>{String(value)}</StatusPill>; return value === undefined || value === null || value === "" ? <span className="workflow-muted">—</span> : String(value); }

function normalizeLiveWorkflowState(input: unknown, snapshotInput?: unknown): WorkflowState {
  const empty = emptyWorkflowState();
  if (!input || typeof input !== "object") return empty;
  const raw = input as Record<string, unknown>;
  const core = snapshotInput && typeof snapshotInput === "object" ? snapshotInput as Record<string, unknown> : {};
  const rows = (value: unknown) => Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  const text = (row: Record<string, unknown>, ...keys: string[]) => { const value = keys.map((key) => row[key]).find((item) => item !== undefined && item !== null && item !== ""); return value === undefined ? "" : String(value); };
  const number = (row: Record<string, unknown>, ...keys: string[]) => Number(keys.map((key) => row[key]).find((item) => item !== undefined && item !== null) ?? 0);
  const jsonRecord = (value: unknown) => { try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } };
  const human = (value: unknown) => String(value ?? "unknown").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const makeOption = (row: Record<string, unknown>, keys: string[], detail?: string): SelectOption => ({ id: text(row, "id", "userId", "productId"), label: keys.map((key) => row[key]).filter((value) => value !== undefined && value !== null && value !== "").join(" · ") || text(row, "id"), detail, version: number(row, "version") || undefined, status: text(row, "lifecycleStatus", "status") || undefined, data: row });
  const purchaseOrders = rows(core.purchaseOrders), salesOrders = rows(core.salesOrders), products = rows(core.products), partners = rows(core.partners);
  const locations = rows(raw.locations).length ? rows(raw.locations) : rows(core.locations);
  const capabilities = raw.permissions && typeof raw.permissions === "object" ? raw.permissions as Record<string, unknown> : {};
  const actions = capabilities.actions && typeof capabilities.actions === "object" ? capabilities.actions as Record<string, boolean> : {};
  const permissions: Record<string, boolean> = { ...Object.fromEntries(Object.entries(capabilities).filter(([, value]) => typeof value === "boolean")) as Record<string, boolean>, ...actions };
  const permissionLabels = [["canOperate", "Operational posting"], ["canPostFinancial", "Financial posting"], ["canApprove", "Approval decisions"], ["canAdminister", "System administration"], ["canExport", "Data export"]].filter(([key]) => permissions[key] === true).map(([, label]) => label);
  const actor = raw.currentUser && typeof raw.currentUser === "object" ? raw.currentUser as Record<string, unknown> : null;
  const poRecords: WorkflowRecord[] = purchaseOrders.map((row) => ({ id: text(row, "id"), number: text(row, "number", "id"), status: human(row.lifecycleStatus), party: text(row, "vendorName"), reference: text(row, "projectReference", "expectedDate"), amount: number(row, "totalCents") / 100, quantity: number(row, "orderedQuantity"), version: number(row, "version") || undefined, revision: number(row, "revisionNumber") || 1 }));
  const revisionRecords: WorkflowRecord[] = rows(raw.purchaseRevisions).map((row) => {
    const snapshot = jsonRecord(row.snapshotJson);
    const order = purchaseOrders.find((candidate) => text(candidate, "id") === text(row, "purchaseOrderId"));
    return { id: text(row, "id"), number: `${text(snapshot, "number") || text(order ?? {}, "number") || text(row, "purchaseOrderId")} · Rev ${number(row, "revisionNumber")}`, status: human(row.lifecycleStatus), party: text(order ?? {}, "vendorName") || text(row, "createdBy"), reference: text(snapshot, "expectedDate") || text(row, "purchaseOrderId"), amount: number(snapshot, "totalCents") / 100 || undefined, revision: number(row, "revisionNumber"), detail: `${text(row, "reason")}${text(row, "createdBy") ? ` · ${text(row, "createdBy")}` : ""}` };
  });
  const transferRecords: WorkflowRecord[] = rows(raw.transfers).map((row) => ({ id: text(row, "id"), number: text(row, "number", "id"), status: human(row.status), reference: `${text(row, "fromLocationId")} → ${text(row, "toLocationId")}`, quantity: number(row, "quantity"), detail: text(row, "productId"), version: number(row, "version") || undefined }));
  const traceRecords: TraceUnit[] = rows(raw.units).map((row) => ({ id: text(row, "id"), sku: text(row, "sku", "productId"), serial: text(row, "serialNumber") || "No serial", lot: text(row, "lotId") || "No lot", location: text(row, "locationCode", "locationId"), status: human(row.inventoryStatus ?? row.lifecycleStatus), customer: text(row, "allocatedSalesOrderLineId") || undefined, receivedOn: "Recorded identity", source: "Inventory unit registry" }));
  const reservationRecords: WorkflowRecord[] = rows(raw.reservations).map((row) => ({ id: text(row, "id"), number: text(row, "number", "id"), status: human(row.status), party: text(row, "customerName"), reference: text(row, "salesOrderNumber", "salesOrderLineId"), quantity: number(row, "quantity"), detail: text(row, "sku", "productId"), version: number(row, "version") || undefined }));
  const rawShipments = rows(raw.shipments);
  const shipmentRows = rawShipments.length ? rawShipments : rows(core.movements).filter((row) => text(row, "sourceDocumentType") === "shipment" && text(row, "type") === "sales_shipment");
  const shipmentRecords: WorkflowRecord[] = shipmentRows.map((row) => ({ id: text(row, "sourceDocumentId", "id"), number: text(row, "number", "sourceDocumentId"), status: human(row.status ?? "posted"), party: text(row, "customerName"), reference: text(row, "salesOrderNumber", "sourceDocumentId"), quantity: Math.abs(number(row, "quantity", "shippedQuantity")), detail: text(row, "sku", "productName"), version: number(row, "version") || undefined }));
  const dropShipRecords: WorkflowRecord[] = rows(raw.dropShipDeliveries).map((row) => ({ id: text(row, "id"), number: text(row, "number", "id"), status: human(row.status), party: text(row, "productName"), reference: `${text(row, "purchaseOrderNumber")} · ${text(row, "salesOrderNumber")}`, quantity: number(row, "netDeliveredQuantity"), detail: `${text(row, "sku")} · delivered ${number(row, "quantity")} · reversed ${number(row, "reversedQuantity")} · ${text(row, "deliveryDate")} · ${text(row, "externalReference")}`, version: number(row, "version") || undefined }));
  const vendorBillRows = rows(raw.vendorBills);
  const vendorBillRecords: WorkflowRecord[] = vendorBillRows.map((row) => ({ id: text(row, "id"), number: text(row, "number", "id"), status: human(row.status), party: text(row, "vendorName"), reference: text(row, "purchaseOrderNumber", "vendor_invoice_number"), amount: number(row, "total_cents", "totalCents") / 100, version: number(row, "version") || undefined, exception: text(row, "match_status", "matchStatus") === "exception" ? text(row, "hold_reason", "holdReason") || "Three-way match exception" : undefined }));
  const invoiceRows = rows(raw.customerInvoices);
  const invoiceRecords: WorkflowRecord[] = invoiceRows.map((row) => ({ id: text(row, "id"), number: text(row, "number", "id"), status: human(row.status), party: text(row, "customerName"), reference: text(row, "salesOrderNumber"), amount: number(row, "total_cents", "totalCents") / 100, version: number(row, "version") || undefined, detail: `${cad.format(Math.max(number(row, "total_cents", "totalCents") - number(row, "paid_cents", "paidCents"), 0) / 100)} outstanding` }));
  const valuationRecords: WorkflowRecord[] = rows(raw.costLayers).map((row) => ({ id: text(row, "id"), number: text(row, "sku", "productId"), status: human(row.status ?? "open layer"), quantity: number(row, "remaining_qty", "remainingQty"), amount: number(row, "remaining_qty", "remainingQty") * (number(row, "unit_cost_cents", "unitCostCents") + number(row, "landed_cost_cents", "landedCostCents")) / 100, detail: text(row, "reference_id", "referenceId") }));
  const assetRecords: AssetRecord[] = rows(raw.returnableObligations).map((row) => ({ id: text(row, "id"), number: text(row, "number", "id"), status: human(row.status), assetType: text(row, "assetName", "assetCode"), customer: text(row, "partnerName"), party: text(row, "partnerName"), deposit: number(row, "depositBalanceCents", "deposit_balance_cents") / 100, amount: number(row, "depositBalanceCents", "deposit_balance_cents") / 100, issued: number(row, "issued_qty", "issuedQuantity"), returned: number(row, "returned_qty", "returnedQuantity"), quantity: number(row, "outstandingQuantity", "outstanding_quantity"), reference: text(row, "source_document_id", "sourceDocumentId"), detail: `${number(row, "outstandingQuantity", "outstanding_quantity")} outstanding`, version: number(row, "version") || undefined }));
  const approvalRecords: WorkflowRecord[] = rows(raw.approvals).filter((row) => text(row, "requestType") === "inventory_count_variance").map((row) => { const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {}; const product = products.find((item) => text(item, "id") === text(row, "entityId")); return { id: text(row, "id"), number: `Count variance · ${text(product ?? {}, "sku", "name") || text(row, "entityId")}`, status: human(row.status), party: text(row, "requestedBy"), reference: `${text(metadata, "locationId")} · ${text(row, "requestedAt")}`, quantity: number(metadata, "absoluteVariance"), version: number(row, "version") || undefined, detail: `Book ${number(metadata, "recordedQuantity")} → counted ${number(metadata, "countedQuantity")} · ${text(row, "requestedReason")}` }; });
  const policyRecords: PolicyRecord[] = rows(raw.settings).map((row) => ({ id: text(row, "key", "id"), name: text(row, "key"), value: typeof row.value === "string" ? row.value : JSON.stringify(row.value), description: text(row, "description"), risk: "Changes future transactions only" }));
  const priceListOptions = rows(raw.priceLists).filter((row) => number(row, "active") !== 0).map((row) => makeOption(row, ["code", "name"], text(row, "currency")));
  const priceAssignmentRecords: WorkflowRecord[] = rows(raw.priceListAssignments).map((row) => ({ id: text(row, "id"), number: text(row, "priceListCode"), status: number(row, "active") ? "Active" : "Inactive", party: text(row, "partnerName"), reference: `Priority ${number(row, "priority")}`, version: number(row, "version") || undefined }));
  const priceEntryRecords: WorkflowRecord[] = rows(raw.priceListEntries).map((row) => ({ id: text(row, "id"), number: `${text(row, "priceListCode")} · ${text(row, "sku")}`, status: number(row, "active") ? "Active" : "Inactive", party: `${text(row, "productName")} · ${text(row, "uomCode")}`, quantity: number(row, "minimumQuantity"), amount: number(row, "unitPriceCents") / 100, version: number(row, "version") || undefined }));
  const uomRows = rows(raw.uoms); const uomById = new Map(uomRows.map((row) => [text(row, "id"), text(row, "code", "name")])); const productById = new Map(rows(raw.products).map((row) => [text(row, "id"), `${text(row, "sku")} · ${text(row, "name")}`]));
  const uomConversionRecords: WorkflowRecord[] = rows(raw.uomConversions).map((row) => ({ id: text(row, "id"), number: `${uomById.get(text(row, "fromUomId")) ?? text(row, "fromUomId")} → ${uomById.get(text(row, "toUomId")) ?? text(row, "toUomId")}`, status: "Active", party: productById.get(text(row, "productId")) ?? "All products in dimension", quantity: number(row, "numerator") / Math.max(number(row, "denominator"), 1), detail: `1 source = ${number(row, "numerator")} ÷ ${number(row, "denominator")} destination · ${text(row, "roundingMode")}` }));
  const orphanedLocationRecords: WorkflowRecord[] = rows(core.orphanedLocations).map((row) => ({ id: text(row, "locationId"), number: text(row, "locationId"), status: "Missing location", quantity: number(row, "balanceUnits"), detail: `${number(row, "balanceRows")} balance row(s) · ${number(row, "movementRows")} movement reference(s)` }));
  const auditRecords: AuditRecord[] = rows(raw.auditEvents).concat(rows(core.activities)).map((row) => ({ id: text(row, "id"), time: text(row, "createdAt", "time"), actor: text(row, "actor") || "System", action: human(text(row, "action")), record: text(row, "entityId", "record"), impact: text(row, "summary", "detail", "impact"), category: /invoice|bill|payment|credit/i.test(text(row, "action")) ? "Financial" : /receipt|shipment|inventory|transfer|scrap/i.test(text(row, "action")) ? "Physical" : "Commercial" }));
  const attachmentRecords: AttachmentRecord[] = rows(raw.attachments).map((row) => ({ id: text(row, "id"), fileName: text(row, "fileName"), type: text(row, "category", "contentType"), document: `${text(row, "documentType")} · ${text(row, "documentId")}`, status: "Stored", uploadedBy: text(row, "ownerEmail", "ownerId"), time: text(row, "uploadedAt"), href: `/api/attachments/${encodeURIComponent(text(row, "id"))}`, ownerId: text(row, "ownerId"), documentType: text(row, "documentType"), documentId: text(row, "documentId") }));
  const salesOrderLines = salesOrders.flatMap((order) => rows(order.lines).map((line) => ({ id: text(line, "id"), label: `${text(order, "number")} · ${text(line, "sku", "productName")}${text(line, "fulfillmentRoute") ? ` · ${human(line.fulfillmentRoute)}` : ""}`, detail: text(line, "productId"), version: number(order, "version") || undefined, status: text(line, "fulfillmentRoute"), data: { ...line, salesOrderId: text(order, "id"), salesOrderVersion: number(order, "version") } })));
  const purchaseOrderLines = purchaseOrders.flatMap((order) => rows(order.lines).map((line) => ({ id: text(line, "id"), label: `${text(order, "number")} · ${text(line, "sku", "productName")}`, detail: text(order, "id") })));
  return { purchaseOrders: poRecords, revisions: revisionRecords, transfers: transferRecords, traceUnits: traceRecords, reservations: reservationRecords, shipments: shipmentRecords, dropShipDeliveries: dropShipRecords, vendorBills: vendorBillRecords, customerInvoices: invoiceRecords, valuations: valuationRecords, assets: assetRecords, approvals: approvalRecords, policies: policyRecords, priceLists: priceListOptions, priceAssignments: priceAssignmentRecords, priceEntries: priceEntryRecords, uomConversions: uomConversionRecords, orphanedLocations: orphanedLocationRecords, audit: auditRecords, attachments: attachmentRecords, currentUser: actor ? { id: text(actor, "id"), name: text(actor, "name", "email"), role: human(actor.role), permissions: permissionLabels } : empty.currentUser, permissions,
    options: { products: products.map((row) => makeOption(row, ["sku", "name"])), warehouses: rows(raw.warehouses).map((row) => makeOption(row, ["code", "name"])), locations: locations.map((row) => makeOption(row, ["warehouseName", "code", "name"])), uoms: uomRows.filter((row) => number(row, "active") !== 0).map((row) => makeOption(row, ["code", "name", "dimension"])), priceLists: priceListOptions, salesOrderLines, purchaseOrderLines, purchaseOrders: purchaseOrders.map((row) => makeOption(row, ["number", "vendorName"], text(row, "vendorId"))), salesOrders: salesOrders.map((row) => makeOption(row, ["number", "customerName"], text(row, "customerId"))), partners: partners.map((row) => makeOption(row, ["name", "partnerType"], text(row, "partnerType"))), costLayers: rows(raw.costLayers).map((row) => makeOption(row, ["sku", "remaining_qty", "id"])), assetTypes: rows(raw.returnableAssetTypes).map((row) => makeOption(row, ["code", "name"])), vendorBills: vendorBillRows.map((row) => makeOption(row, ["number", "vendorName"], text(row, "vendor_id", "vendorId"))), customerInvoices: invoiceRows.map((row) => makeOption(row, ["number", "customerName"], text(row, "customer_id", "customerId"))) } };
}
