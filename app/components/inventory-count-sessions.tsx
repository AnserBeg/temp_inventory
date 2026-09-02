"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuickCreateDialog } from "./reference-picker";
import { useDialogDismiss } from "./use-dialog-dismiss";

type CountSession = {
  id: string; number: string; countType: "correction" | "cycle" | "annual" | "opening"; warehouseId: string;
  warehouseCode: string; warehouseName: string; scopeType: string; blindCount: number | boolean;
  status: string; effectiveDate: string; notes?: string; createdBy: string; createdAt: string; version: number;
  lineCount: number; countedCount: number; varianceCount: number; approvalCount: number; conflictCount: number;
  postedCount: number; varianceQuantity: number; varianceValueCents: number;
};

type CountLine = {
  id: string; sessionId: string; productId: string; locationId: string; trackingPolicy: string;
  expectedQuantity: number; expectedBalanceVersion: number; countedQuantity: number | null; varianceQuantity: number | null;
  unitCostCents: number | null; reason: string | null; status: string; approvalId: string | null;
  approvalStatus: string | null; approvalVersion: number | null; postedCountId: string | null; countedBy: string | null;
  countedAt: string | null; lastError: string | null; version: number; sku: string; manufacturerSku?: string;
  productName: string; category: string; standardCostCents: number; baseUomCode: string; quantityPrecision: number;
  locationCode: string; locationName: string; inventoryStatus: string; warehouseCode: string;
};

type Warehouse = { id: string; code: string; name: string; timezone: string };
type Location = { id: string; code: string; name: string; locationType: string; inventoryStatus: string; warehouseId: string; warehouseCode: string };
type ProductOption = { id: string; sku: string; manufacturerSku?: string; name: string; category: string; trackingPolicy: string; inventoryPolicy: string; standardCostCents: number; baseUomCode: string; quantityPrecision: number };
type WorkspaceResponse = { sessions: CountSession[]; warehouses: Warehouse[]; locations: Location[]; session?: CountSession; lines?: CountLine[]; products?: ProductOption[] };
type DraftLine = { quantity: string; reason: string; unitCost: string };

const reasons = ["Found in adjacent bay", "Unrecorded damage", "Counting error confirmed", "Unrecorded scrap", "Received but not posted", "Shipped but not posted", "Theft or loss under investigation"];
const countLabels = { correction: "Quick correction", cycle: "Cycle count", annual: "Annual stocktake", opening: "Opening inventory" } as const;

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(cents: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(Number(cents || 0) / 100);
}

function dateLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function statusTone(status: string) {
  if (["posted", "approved", "counted", "variance"].includes(status)) return "success";
  if (["review", "awaiting_approval", "needs_approval", "needs_reason"].includes(status)) return "warning";
  if (["conflict", "cancelled", "rejected"].includes(status)) return "danger";
  if (status === "counting") return "info";
  return "neutral";
}

function CountBadge({ status }: { status: string }) {
  return <span className={`status-badge ${statusTone(status)}`}>{titleCase(status)}</span>;
}

function draftFromLine(line: CountLine): DraftLine {
  return {
    quantity: line.countedQuantity == null ? "" : String(line.countedQuantity),
    reason: line.reason ?? "",
    unitCost: String((line.unitCostCents ?? line.standardCostCents) / 100),
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json() as T & { error?: string | { message?: string } };
  if (!response.ok) {
    const error = body.error;
    throw new Error(typeof error === "string" ? error : error?.message ?? "The inventory count request failed.");
  }
  return body;
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const percent = total ? Math.min(100, Math.round(value / total * 100)) : 0;
  return <div className="count-progress" aria-label={`${percent}% counted`}><span style={{ width: `${percent}%` }} /></div>;
}

export function InventoryCountSessions({ warehouseId, canOperate, canApprove, canAdminister, onDurableRefresh }: { warehouseId: string; canOperate: boolean; canApprove: boolean; canAdminister: boolean; onDurableRefresh?: () => void | Promise<void> }) {
  const [workspace, setWorkspace] = useState<WorkspaceResponse>({ sessions: [], warehouses: [], locations: [] });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [createType, setCreateType] = useState<CountSession["countType"] | null>(null);

  const load = useCallback(async (sessionId = activeSessionId) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (warehouseId) params.set("warehouseId", warehouseId);
      if (sessionId) params.set("sessionId", sessionId);
      const result = await requestJson<WorkspaceResponse>(`/api/inventory-counts?${params}`);
      setWorkspace(result); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Inventory counts could not be loaded."); }
    finally { setLoading(false); }
  }, [activeSessionId, warehouseId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 5000); return () => window.clearTimeout(timer); }, [toast]);

  const openSession = (id: string) => { setActiveSessionId(id); window.setTimeout(() => void load(id), 0); };
  const closeSession = () => { setActiveSessionId(null); window.setTimeout(() => void load(null), 0); };
  const refresh = async (message?: string) => { await load(activeSessionId); if (message) setToast(message); await onDurableRefresh?.(); };

  if (activeSessionId && workspace.session) return <CountSessionWorkspace session={workspace.session} lines={workspace.lines ?? []} locations={workspace.locations} canOperate={canOperate} canApprove={canApprove} canAdminister={canAdminister} loading={loading} onBack={closeSession} onRefresh={refresh} />;

  const active = workspace.sessions.filter((session) => !["posted", "cancelled"].includes(session.status));
  const history = workspace.sessions.filter((session) => ["posted", "cancelled"].includes(session.status));
  return <div className="count-sessions-shell">
    <section className="count-launch-panel panel">
      <div className="count-launch-copy"><span className="section-kicker">Physical inventory</span><h2>Inventory counts</h2><p>Count a single correction, a rack, or a complete warehouse. Quantities save as you work and stock changes only after review.</p></div>
      {canOperate ? <div className="count-launch-actions"><button className="button primary" onClick={() => setCreateType("cycle")}>New count session</button><button className="button secondary" onClick={() => setCreateType("correction")}>Quick correction</button>{canAdminister ? <button className="button secondary" onClick={() => setCreateType("opening")}>Opening inventory</button> : null}</div> : <span className="read-only-label">Read-only inventory access</span>}
    </section>
    {error ? <div className="error-summary" role="alert"><strong>Inventory counts are unavailable</strong><p>{error}</p><button className="button secondary" onClick={() => void load(null)}>Try again</button></div> : null}
    {loading && !workspace.sessions.length ? <section className="panel"><div className="empty-inline">Loading inventory count sessions…</div></section> : <>
      <section className="panel"><div className="panel-heading"><div><span className="section-kicker">Resume work</span><h3>Active sessions</h3></div><span>{active.length} open</span></div>
        <div className="count-session-cards">{active.map((session) => <button className="count-session-card" key={session.id} onClick={() => openSession(session.id)}>
          <div className="count-session-card-top"><div><strong>{session.number}</strong><small>{countLabels[session.countType]} · {session.warehouseCode}</small></div><CountBadge status={session.status} /></div>
          <ProgressBar value={session.countedCount} total={session.lineCount} />
          <div className="count-session-card-stats"><span><strong>{session.countedCount}/{session.lineCount}</strong><small>counted</small></span><span><strong>{session.varianceCount}</strong><small>variances</small></span><span><strong>{session.approvalCount + session.conflictCount}</strong><small>attention</small></span></div>
        </button>)}{!active.length ? <div className="empty-inline">No count is currently in progress. Start a correction, cycle count, or annual stocktake when you are ready.</div> : null}</div>
      </section>
      <section className="panel"><div className="panel-heading"><div><span className="section-kicker">Audit trail</span><h3>Recent count history</h3></div></div><div className="responsive-table"><table><thead><tr><th>Session</th><th>Warehouse</th><th>Type</th><th>Status</th><th className="numeric">Lines</th><th className="numeric">Variance</th><th className="numeric">Value impact</th><th>Date</th></tr></thead><tbody>{history.map((session) => <tr key={session.id} onClick={() => openSession(session.id)} className="clickable-row"><td><strong>{session.number}</strong><small>{session.createdBy}</small></td><td>{session.warehouseName}</td><td>{countLabels[session.countType]}</td><td><CountBadge status={session.status} /></td><td className="numeric">{session.lineCount}</td><td className={`numeric strong ${session.varianceQuantity < 0 ? "text-danger" : session.varianceQuantity > 0 ? "text-success" : ""}`}>{session.varianceQuantity > 0 ? "+" : ""}{session.varianceQuantity}</td><td className="numeric">{money(session.varianceValueCents)}</td><td>{dateLabel(session.effectiveDate)}</td></tr>)}{!history.length ? <tr><td colSpan={8}><div className="empty-inline">Posted and cancelled sessions will appear here.</div></td></tr> : null}</tbody></table></div></section>
    </>}
    {createType ? <CreateCountDialog initialType={createType} warehouseId={warehouseId} warehouses={workspace.warehouses} locations={workspace.locations} canAdminister={canAdminister} onClose={() => setCreateType(null)} onCreated={(session) => { setCreateType(null); setToast(`${session.number} created.`); openSession(session.id); }} /> : null}
    {toast ? <div className="toast" role="status"><span>✓</span>{toast}</div> : null}
  </div>;
}

function CreateCountDialog({ initialType, warehouseId, warehouses, locations, canAdminister, onClose, onCreated }: { initialType: CountSession["countType"]; warehouseId: string; warehouses: Warehouse[]; locations: Location[]; canAdminister: boolean; onClose: () => void; onCreated: (session: CountSession) => void }) {
  const [countType, setCountType] = useState(initialType);
  const [selectedWarehouse, setSelectedWarehouse] = useState(warehouseId || warehouses[0]?.id || "");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [blindCount, setBlindCount] = useState(initialType === "annual" || initialType === "cycle");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useDialogDismiss(onClose, busy);
  const scopedLocations = locations.filter((location) => location.warehouseId === selectedWarehouse);
  const selectedType = (value: CountSession["countType"]) => { setCountType(value); setBlindCount(value === "annual" || value === "cycle"); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await requestJson<{ session: CountSession }>("/api/inventory-counts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "createSession", countType, warehouseId: selectedWarehouse, locationIds: selectedLocations, blindCount, effectiveDate, notes, idempotencyKey: crypto.randomUUID() }) });
      onCreated(result.session);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The count session could not be created."); }
    finally { setBusy(false); }
  };
  return <div className="modal-overlay" role="presentation"><section className="command-dialog count-create-dialog" role="dialog" aria-modal="true" aria-labelledby="new-count-title"><div className="dialog-header"><div><span className="section-kicker">Physical inventory</span><h2 id="new-count-title">Create count session</h2></div><button className="icon-button" aria-label="Close" onClick={onClose}>×</button></div><form onSubmit={submit}>
    {error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}
    <fieldset className="count-type-options"><legend>What are you counting?</legend>{(["correction", "cycle", "annual", ...(canAdminister ? ["opening"] : [])] as CountSession["countType"][]).map((type) => <label className={countType === type ? "selected" : ""} key={type}><input type="radio" name="countType" checked={countType === type} onChange={() => selectedType(type)} /><strong>{countLabels[type]}</strong><small>{type === "correction" ? "One or a few items" : type === "cycle" ? "Selected locations or routine rotation" : type === "annual" ? "Complete warehouse stocktake" : "Initial stock and value setup"}</small></label>)}</fieldset>
    <div className="command-form form-grid"><label>Warehouse<select value={selectedWarehouse} onChange={(event) => { setSelectedWarehouse(event.target.value); setSelectedLocations([]); }} required><option value="">Select warehouse</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label><label>Effective date<input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} required /></label></div>
    {!(["correction", "opening"] as string[]).includes(countType) ? <fieldset className="count-location-scope"><legend>Scope</legend><label className="check-row"><input type="checkbox" checked={!selectedLocations.length} onChange={() => setSelectedLocations([])} /> Entire warehouse</label><div className="count-location-checks">{scopedLocations.map((location) => <label className="check-row" key={location.id}><input type="checkbox" checked={selectedLocations.includes(location.id)} onChange={(event) => setSelectedLocations((current) => event.target.checked ? [...current, location.id] : current.filter((id) => id !== location.id))} /> <span><strong>{location.code}</strong><small>{location.name} · {titleCase(location.inventoryStatus)}</small></span></label>)}</div></fieldset> : <p className="count-form-note">Create the session, then search and add the exact items and locations you want to count.</p>}
    <div className="command-form"><label className="check-row"><input type="checkbox" checked={blindCount} onChange={(event) => setBlindCount(event.target.checked)} /><span><strong>Blind count</strong><small>Hide the book quantity until counting is submitted for review.</small></span></label><label>Session notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Purpose, assigned counter, or special instructions" /></label></div>
    <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy || !selectedWarehouse}>{busy ? "Creating…" : "Create session"}</button></div>
  </form></section></div>;
}

function CountSessionWorkspace({ session, lines, locations, canOperate, canApprove, canAdminister, loading, onBack, onRefresh }: { session: CountSession; lines: CountLine[]; locations: Location[]; canOperate: boolean; canApprove: boolean; canAdminister: boolean; loading: boolean; onBack: () => void; onRefresh: (message?: string) => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, DraftLine>>({});
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [addItem, setAddItem] = useState(false);
  const countInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const editable = canOperate && ["draft", "counting", "review", "awaiting_approval"].includes(session.status);
  const review = ["review", "awaiting_approval", "posted"].includes(session.status);
  const concealBook = Boolean(session.blindCount) && !review;

  const visibleLines = useMemo(() => lines.filter((line) => {
    const term = query.trim().toLowerCase();
    const matches = !term || `${line.sku} ${line.productName} ${line.locationCode} ${line.manufacturerSku ?? ""}`.toLowerCase().includes(term);
    const state = filter === "all" || filter === "uncounted" && line.countedQuantity == null || filter === "variance" && Math.abs(Number(line.varianceQuantity ?? 0)) > 0.000001 || filter === "attention" && ["needs_reason", "needs_approval", "conflict"].includes(line.status);
    return matches && state;
  }), [filter, lines, query]);

  const setDraft = (line: CountLine, patch: Partial<DraftLine>) => setDrafts((current) => ({ ...current, [line.id]: { ...(current[line.id] ?? draftFromLine(line)), ...patch } }));
  const action = async (name: string, payload: Record<string, unknown>, message?: string) => {
    setBusy(name); setError("");
    try {
      const result = await requestJson<{ message?: string; blocked?: Array<{ message: string }> }>("/api/inventory-counts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: name, sessionId: session.id, ...payload }) });
      await onRefresh(message ?? result.message);
      if (result.blocked?.length) setError(result.blocked.map((item) => item.message).filter((value, index, values) => values.indexOf(value) === index).join(" "));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The count could not be updated."); }
    finally { setBusy(""); }
  };
  const saveLine = async (line: CountLine, focusNext?: number) => {
    const draft = drafts[line.id] ?? draftFromLine(line);
    if (draft.quantity.trim() === "") return setError(`Enter a physical quantity for ${line.sku}.`);
    setBusy(`save:${line.id}`); setError("");
    try {
      const result = await requestJson<{ message: string }>("/api/inventory-counts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "saveLine", sessionId: session.id, lineId: line.id, version: line.version, countedQuantity: Number(draft.quantity), reason: draft.reason, unitCostCents: session.countType === "opening" ? Math.round(Number(draft.unitCost) * 100) : undefined }) });
      await onRefresh(result.message);
      setDrafts((current) => { const next = { ...current }; delete next[line.id]; return next; });
      if (focusNext != null) window.setTimeout(() => countInputRefs.current[focusNext]?.focus(), 50);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The count line could not be saved."); }
    finally { setBusy(""); }
  };
  const onQuantityKey = (event: KeyboardEvent<HTMLInputElement>, line: CountLine, index: number) => { if (event.key === "Enter") { event.preventDefault(); void saveLine(line, index + 1); } };
  const remaining = Math.max(session.lineCount - session.countedCount, 0);
  const varianceValue = lines.reduce((sum, line) => sum + Number(line.varianceQuantity ?? 0) * Number(line.unitCostCents ?? line.standardCostCents), 0);
  const canPost = canOperate && ["review", "awaiting_approval"].includes(session.status) && session.lineCount > 0;

  return <div className="count-workspace">
    <button className="back-button" onClick={onBack}>← Back to count sessions</button>
    <section className="count-workspace-header panel"><div className="count-workspace-title"><div><span className="section-kicker">{countLabels[session.countType]} · {session.warehouseCode}</span><h2>{session.number}</h2><p>{session.notes || `Effective ${dateLabel(session.effectiveDate)}`}</p></div><CountBadge status={session.status} /></div>
      <div className="count-summary-strip"><span><small>Progress</small><strong>{session.countedCount} / {session.lineCount}</strong></span><span><small>Remaining</small><strong>{remaining}</strong></span><span><small>Variances</small><strong>{session.varianceCount}</strong></span><span><small>Estimated impact</small><strong>{concealBook ? "Hidden" : money(varianceValue)}</strong></span></div><ProgressBar value={session.countedCount} total={session.lineCount} />
      {editable ? <div className="count-header-actions"><button className="button secondary" onClick={() => setAddItem(true)}>Add found item</button>{["draft", "counting"].includes(session.status) ? <button className="button primary" disabled={busy !== "" || remaining > 0 || session.lineCount === 0} onClick={() => void action("submitSession", {}, "Count submitted for review.")}>{remaining ? `${remaining} left to count` : "Submit for review"}</button> : null}{["review", "awaiting_approval"].includes(session.status) && session.postedCount === 0 ? <button className="button secondary" disabled={busy !== ""} onClick={() => void action("reopenSession", {})}>Return to counting</button> : null}{canPost ? <button className="button primary" disabled={busy !== ""} onClick={() => void action("postSession", { postingDate: session.effectiveDate })}>{busy === "postSession" ? "Posting…" : "Post ready lines"}</button> : null}</div> : null}
    </section>
    {concealBook ? <div className="count-blind-banner"><strong>Blind count is active.</strong><span>Book quantities and variances appear after all items are submitted.</span></div> : null}
    {error ? <div className="error-summary" role="alert"><strong>Review required</strong><p>{error}</p></div> : null}
    <section className="panel count-entry-panel"><div className="count-entry-toolbar"><label className="count-search"><span className="sr-only">Scan or search inventory</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Scan or search SKU, item, or location" /></label><label><span className="sr-only">Count filter</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All items</option><option value="uncounted">Uncounted</option><option value="variance">Variances</option><option value="attention">Needs attention</option></select></label><span className="count-save-state">{loading ? "Refreshing…" : busy.startsWith("save:") ? "Saving…" : "All saved"}</span></div>
      <div className="responsive-table count-entry-table"><table><thead><tr><th>Location</th><th>Product</th>{!concealBook ? <th className="numeric">Book</th> : null}<th className="numeric">Physical count</th>{session.countType === "opening" ? <th className="numeric">Unit cost</th> : null}{!concealBook ? <th className="numeric">Variance</th> : null}<th>Reason / review</th><th>Status</th></tr></thead><tbody>{visibleLines.map((line, index) => {
        const draft = drafts[line.id] ?? draftFromLine(line);
        const variance = draft.quantity === "" ? line.varianceQuantity : Number(draft.quantity) - line.expectedQuantity;
        const locked = line.status === "posted" || Boolean(line.approvalId);
        return <tr key={line.id} className={line.status === "conflict" ? "count-line-conflict" : Math.abs(Number(variance ?? 0)) > 0.000001 && !concealBook ? "count-line-variance" : ""}><td><strong>{line.locationCode}</strong><small>{line.locationName} · {titleCase(line.inventoryStatus)}</small></td><td><strong>{line.productName}</strong><small>{line.sku} · {line.baseUomCode}{line.trackingPolicy !== "quantity" ? ` · ${titleCase(line.trackingPolicy)} tracked` : ""}</small></td>{!concealBook ? <td className="numeric strong">{line.expectedQuantity}</td> : null}<td className="numeric"><div className="count-quantity-cell"><input ref={(element) => { countInputRefs.current[index] = element; }} aria-label={`Physical count for ${line.sku} at ${line.locationCode}`} type="number" min="0" step={line.quantityPrecision ? 1 / Math.pow(10, line.quantityPrecision) : 1} value={draft.quantity} disabled={!editable || locked} onChange={(event) => setDraft(line, { quantity: event.target.value })} onBlur={() => { if (draft.quantity !== "" && String(line.countedQuantity ?? "") !== draft.quantity && !locked) void saveLine(line); }} onKeyDown={(event) => onQuantityKey(event, line, index)} placeholder="—" /><span>{line.baseUomCode}</span></div></td>{session.countType === "opening" ? <td className="numeric"><div className="count-cost-cell"><span>$</span><input aria-label={`Unit cost for ${line.sku}`} type="number" min="0" step="0.01" value={draft.unitCost} disabled={!editable || locked} onChange={(event) => setDraft(line, { unitCost: event.target.value })} /></div></td> : null}{!concealBook ? <td className={`numeric strong ${Number(variance ?? 0) < 0 ? "text-danger" : Number(variance ?? 0) > 0 ? "text-success" : ""}`}>{variance == null ? "—" : `${Number(variance) > 0 ? "+" : ""}${roundDisplay(Number(variance), line.quantityPrecision)}`}</td> : null}<td><select aria-label={`Variance reason for ${line.sku}`} value={draft.reason} disabled={!editable || locked || Math.abs(Number(variance ?? 0)) < 0.000001} onChange={(event) => setDraft(line, { reason: event.target.value })} onBlur={() => { if (draft.quantity !== "" && draft.reason !== (line.reason ?? "") && !locked) void saveLine(line); }}><option value="">{Math.abs(Number(variance ?? 0)) > 0.000001 ? "Select reason" : "No variance"}</option>{reasons.map((reason) => <option key={reason}>{reason}</option>)}</select>{line.lastError ? <small className="text-danger">{line.lastError}</small> : line.countedBy ? <small>Counted by {line.countedBy.split(" <")[0]}</small> : null}</td><td><div className="count-line-state"><CountBadge status={line.approvalStatus ?? line.status} />{line.status === "needs_approval" && !line.approvalId ? <button className="row-action" disabled={busy !== ""} onClick={() => void action("requestLineApproval", { lineId: line.id, idempotencyKey: crypto.randomUUID() })}>Request approval</button> : null}{line.approvalStatus === "pending" && canApprove ? <button className="row-action" disabled={busy !== ""} onClick={() => void action("approveLine", { lineId: line.id, reason: `Approved ${session.number} variance`, idempotencyKey: crypto.randomUUID() })}>Approve</button> : null}</div></td></tr>;
      })}{!visibleLines.length ? <tr><td colSpan={8}><div className="empty-inline">No count lines match this view.</div></td></tr> : null}</tbody></table></div>
      {session.status === "posted" ? <div className="count-posted-note"><strong>Count posted</strong><span>Every posted line is immutable and linked to its stock movement and valuation record.</span></div> : null}
    </section>
    {addItem ? <AddCountItemDialog session={session} locations={locations.filter((location) => location.warehouseId === session.warehouseId)} canCreateProduct={canAdminister} onClose={() => setAddItem(false)} onAdded={async (message) => { setAddItem(false); await onRefresh(message); }} /> : null}
  </div>;
}

function roundDisplay(value: number, precision: number) {
  return Number(value.toFixed(Math.max(0, Math.min(precision, 3))));
}

function AddCountItemDialog({ session, locations, canCreateProduct, onClose, onAdded }: { session: CountSession; locations: Location[]; canCreateProduct: boolean; onClose: () => void; onAdded: (message: string) => Promise<void> }) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [creatingProduct, setCreatingProduct] = useState(false);
  useDialogDismiss(onClose, Boolean(busy));
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { setSearching(true); void requestJson<{ products: ProductOption[] }>(`/api/inventory-counts?productSearch=${encodeURIComponent(query)}`, { signal: controller.signal }).then((result) => { setProducts(result.products); setError(""); }).catch((caught) => { if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(caught instanceof Error ? caught.message : "Products could not be searched."); }).finally(() => setSearching(false)); }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);
  const add = async (productId: string) => {
    if (!locationId) return setError("Select the location where the item was counted.");
    setBusy(productId); setError("");
    try {
      const result = await requestJson<{ message: string }>("/api/inventory-counts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "addLine", sessionId: session.id, productId, locationId }) });
      await onAdded(result.message);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The item could not be added."); setBusy(""); }
  };
  return <><div className="modal-overlay" role="presentation"><section className="command-dialog count-add-dialog" role="dialog" aria-modal="true" aria-labelledby="add-count-item-title"><div className="dialog-header"><div><span className="section-kicker">{session.number}</span><h2 id="add-count-item-title">Add found item</h2></div><button className="icon-button" onClick={onClose} aria-label="Close">×</button></div><div className="count-add-body">
    {error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}<label>Inventory location<select value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Select location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name} · {titleCase(location.inventoryStatus)}</option>)}</select></label><label>Search catalog<input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SKU, manufacturer SKU, or product name" /></label>
    <div className="count-product-results">{products.map((product) => <button key={product.id} disabled={Boolean(busy)} onClick={() => void add(product.id)}><span><strong>{product.sku} · {product.name}</strong><small>{product.category} · {product.baseUomCode} · {titleCase(product.trackingPolicy)} tracked</small></span><b>{busy === product.id ? "Adding…" : "Add"}</b></button>)}{searching ? <div className="empty-inline">Searching catalog…</div> : !products.length ? <div className="empty-inline">No matching active inventory product.</div> : null}</div>
    {canCreateProduct ? <div className="count-create-product-prompt"><div><strong>Truly a new item?</strong><small>Create its controlled catalog record, then add it to this count.</small></div><button className="button secondary" onClick={() => setCreatingProduct(true)}>Create product</button></div> : null}
    <div className="dialog-actions"><button className="button secondary" onClick={onClose}>Cancel</button></div>
  </div></section></div>{creatingProduct ? <QuickCreateDialog kind="product" onClose={() => setCreatingProduct(false)} onCreated={async (option) => { setCreatingProduct(false); setQuery(option.label); await add(option.id); }} /> : null}</>;
}
