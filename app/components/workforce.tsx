"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDialogDismiss } from "./use-dialog-dismiss";

type Link = { id: string; documentType: "sales_order" | "purchase_order"; documentId: string; documentNumber: string };
type TimeEntry = {
  id: string;
  labourItemId: string;
  workOrderId: string;
  workOrderNumber: string;
  workOrderTitle: string;
  labourTitle: string;
  workerUserId: string;
  workerName: string;
  workerEmail: string;
  startedAt: string;
  endedAt: string | null;
  techStory: string | null;
  editedByName: string | null;
  version: number;
  updatedAt: string;
  durationSeconds?: number;
};
type LabourItem = {
  id: string;
  workOrderId: string;
  title: string;
  status: "open" | "completed";
  version: number;
  totalSeconds: number;
  entries: TimeEntry[];
};
type WorkOrder = {
  id: string;
  number: string;
  title: string;
  notes: string | null;
  status: "open" | "on_hold" | "completed";
  partnerId: string | null;
  partnerName: string | null;
  partnerType: string | null;
  createdByName: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  totalSeconds: number;
  people: Array<{ userId: string; name: string }>;
  links: Link[];
  labourItems: LabourItem[];
};
type Worker = {
  userId: string;
  name: string;
  email: string;
  role: string;
  activeEntry: TimeEntry | null;
  totalSeconds: number;
  sevenDaySeconds: number;
  entryCount: number;
};
type Lookup = { id: string; number?: string; name?: string; partnerName?: string; partnerType?: string };
type WorkforceSnapshot = {
  capturedAt: string;
  viewer: { id: string; name: string; email: string; role: string; canOperate: boolean; canManage: boolean };
  workOrders: WorkOrder[];
  workers: Worker[];
  timeEntries: TimeEntry[];
  lookups: { partners: Lookup[]; salesOrders: Lookup[]; purchaseOrders: Lookup[] };
};

type ModalState =
  | { kind: "create-order" }
  | { kind: "edit-order"; order: WorkOrder }
  | { kind: "add-labour"; order: WorkOrder }
  | { kind: "edit-labour"; item: LabourItem }
  | { kind: "clock-out"; entry: TimeEntry }
  | { kind: "edit-time"; entry: TimeEntry }
  | null;

type RecognitionResultEvent = { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const statusLabels = { open: "Open", on_hold: "On hold", completed: "Completed" };

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 1) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

function elapsed(entry: TimeEntry, now: number) {
  const end = entry.endedAt ? new Date(entry.endedAt).valueOf() : now;
  return Math.max(0, Math.round((end - new Date(entry.startedAt).valueOf()) / 1000));
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function toLocalInput(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function errorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const error = (data as { error?: unknown }).error;
  if (typeof error === "string") return error;
  return error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string" ? String((error as { message: string }).message) : fallback;
}

function DictationButton({ onText }: { onText: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<Recognition | null>(null);

  useEffect(() => {
    const speechWindow = window as typeof window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const timer = window.setTimeout(() => setSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition)), 0);
    return () => { window.clearTimeout(timer); recognitionRef.current?.stop(); };
  }, []);

  const toggle = () => {
    if (listening) { recognitionRef.current?.stop(); return; }
    const speechWindow = window as typeof window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const RecognitionConstructor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!RecognitionConstructor) { setSupported(false); return; }
    const recognition = new RecognitionConstructor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-CA";
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) if (event.results[index].isFinal) transcript += `${event.results[index][0].transcript} `;
      if (transcript.trim()) onText(transcript.trim());
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  return <button type="button" className={`button ${listening ? "danger" : "secondary"} wf-dictate`} disabled={!supported} onClick={toggle} title={supported ? "Use your browser microphone" : "Voice dictation is not supported by this browser"}>
    <span aria-hidden="true">{listening ? "■" : "●"}</span>{listening ? "Stop dictation" : "Dictate"}
  </button>;
}

export function WorkforceView() {
  const [snapshot, setSnapshot] = useState<WorkforceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState<"orders" | "team" | "time">("orders");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const response = await fetch("/api/workforce", { cache: "no-store" });
      const data = await response.json() as WorkforceSnapshot;
      if (!response.ok) throw new Error(errorMessage(data, "Workforce records could not be loaded."));
      setSnapshot(data);
      setNow(new Date(data.capturedAt).valueOf());
      setError("");
      setSelectedId((current) => current && data.workOrders.some((order) => order.id === current) ? current : data.workOrders[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workforce records could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const mutate = async (command: string, payload: Record<string, unknown> = {}) => {
    const response = await fetch("/api/workforce", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command, ...payload }) });
    const data = await response.json() as { message?: string; workOrderId?: string };
    if (!response.ok) throw new Error(errorMessage(data, "The change could not be saved."));
    await load(true);
    if (data.workOrderId) setSelectedId(data.workOrderId);
    setToast(data.message ?? "Saved.");
    return data;
  };

  const filteredOrders = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!snapshot || !normalized) return snapshot?.workOrders ?? [];
    return snapshot.workOrders.filter((order) => [order.number, order.title, order.notes, order.partnerName, ...order.labourItems.map((item) => item.title), ...order.links.map((link) => link.documentNumber)].some((value) => value?.toLowerCase().includes(normalized)));
  }, [query, snapshot]);
  const selected = snapshot?.workOrders.find((order) => order.id === selectedId) ?? filteredOrders[0] ?? null;
  const currentWorker = snapshot?.workers.find((worker) => worker.userId === snapshot.viewer.id);
  const activeEntry = currentWorker?.activeEntry ?? null;
  const activeCount = snapshot?.workers.filter((worker) => worker.activeEntry).length ?? 0;

  if (loading) return <section className="panel wf-loading" aria-live="polite"><span className="wf-spinner" aria-hidden="true" /><strong>Loading work orders…</strong></section>;
  if (!snapshot) return <section className="panel wf-error" role="alert"><div><strong>Work orders are unavailable.</strong><p>{error}</p></div><button className="button secondary" onClick={() => void load()}>Retry</button></section>;

  return <div className="wf-page">
    {error ? <div className="connection-error" role="alert"><div><strong>Couldn&apos;t refresh work orders.</strong><p>{error}</p></div><button className="button secondary" onClick={() => void load(true)}>Retry</button></div> : null}

    <section className={`wf-clock-card ${activeEntry ? "is-active" : ""}`} aria-live="polite">
      <div className="wf-clock-signal" aria-hidden="true"><span /></div>
      <div className="wf-clock-copy">
        <span className="section-kicker">My clock</span>
        {activeEntry ? <><h2>{activeEntry.workOrderNumber} · {activeEntry.labourTitle}</h2><p>{activeEntry.workOrderTitle}</p></> : <><h2>Ready for the next job</h2><p>Open a labour item below and clock in. Your time follows you across devices.</p></>}
      </div>
      {activeEntry ? <div className="wf-running-time"><small>Started {dateTime(activeEntry.startedAt)}</small><strong>{formatDuration(elapsed(activeEntry, now))}</strong></div> : <div className="wf-clock-idle"><strong>{activeCount}</strong><span>{activeCount === 1 ? "person working" : "people working"}</span></div>}
      {activeEntry ? <button className="button danger wf-clock-action" onClick={() => setModal({ kind: "clock-out", entry: activeEntry })}>Clock out</button> : <button className="button primary wf-clock-action" onClick={() => { setTab("orders"); document.getElementById("wf-orders")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Find labour</button>}
    </section>

    <section className="panel wf-workspace" id="wf-orders">
      <header className="wf-toolbar">
        <div className="wf-tabs" role="tablist" aria-label="Workforce views">
          <button role="tab" aria-selected={tab === "orders"} className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>Work orders <span>{snapshot.workOrders.filter((order) => order.status !== "completed").length}</span></button>
          <button role="tab" aria-selected={tab === "team"} className={tab === "team" ? "active" : ""} onClick={() => setTab("team")}>Team status <span>{activeCount}</span></button>
          <button role="tab" aria-selected={tab === "time"} className={tab === "time" ? "active" : ""} onClick={() => setTab("time")}>Time entries</button>
        </div>
        <div className="wf-toolbar-actions">
          <button className="icon-button" aria-label="Refresh workforce data" disabled={refreshing} onClick={() => void load(true)}>↻</button>
          {snapshot.viewer.canOperate ? <button className="button primary" onClick={() => setModal({ kind: "create-order" })}>Create work order</button> : null}
        </div>
      </header>

      {tab === "orders" ? <div className="wf-order-layout">
        <aside className="wf-order-list" aria-label="Work orders">
          <div className="wf-order-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search work orders" aria-label="Search work orders" /></div>
          <div className="wf-order-list-scroll">
            {filteredOrders.map((order) => {
              const activeWorkers = order.labourItems.flatMap((item) => item.entries).filter((entry) => !entry.endedAt);
              return <button key={order.id} className={`wf-order-row ${selected?.id === order.id ? "active" : ""}`} onClick={() => setSelectedId(order.id)}>
                <span className="wf-order-row-top"><strong>{order.number}</strong><span className={`wf-status ${order.status}`}>{statusLabels[order.status]}</span></span>
                <b>{order.title}</b>
                <small>{order.partnerName || "No customer or vendor"}</small>
                <span className="wf-order-row-foot"><span>{formatDuration(order.totalSeconds)}</span><span>{activeWorkers.length ? <><i className="wf-live-dot" />{activeWorkers.length} active</> : `${order.labourItems.length} labour`}</span></span>
              </button>;
            })}
            {!filteredOrders.length ? <div className="wf-empty-list"><strong>{query ? "No matching work orders" : "No work orders yet"}</strong><p>{query ? "Try a work-order number, title, linked order, or partner." : "Create one and add the labour people can clock into."}</p></div> : null}
          </div>
        </aside>
        <div className="wf-order-detail">
          {selected ? <WorkOrderDetail order={selected} viewerId={snapshot.viewer.id} canOperate={snapshot.viewer.canOperate} activeEntry={activeEntry} now={now} onClockIn={async (item) => {
            try { await mutate("clockIn", { labourItemId: item.id }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not clock in."); }
          }} onClockOut={(entry) => setModal({ kind: "clock-out", entry })} onAddLabour={() => setModal({ kind: "add-labour", order: selected })} onEdit={() => setModal({ kind: "edit-order", order: selected })} onEditLabour={(item) => setModal({ kind: "edit-labour", item })} /> : <div className="wf-detail-empty"><span aria-hidden="true">WO</span><strong>Select a work order</strong><p>Its labour items, linked documents, and clock history will appear here.</p></div>}
        </div>
      </div> : null}

      {tab === "team" ? <TeamStatus workers={snapshot.workers} now={now} onOpenOrder={(id) => { setSelectedId(id); setTab("orders"); }} /> : null}
      {tab === "time" ? <TimeEntries entries={snapshot.timeEntries} viewer={snapshot.viewer} now={now} onEdit={(entry) => setModal({ kind: "edit-time", entry })} onOpenOrder={(id) => { setSelectedId(id); setTab("orders"); }} /> : null}
    </section>

    {modal ? <WorkforceDialog modal={modal} snapshot={snapshot} onClose={() => setModal(null)} onSubmit={async (command, payload) => { const result = await mutate(command, payload); setModal(null); return result; }} /> : null}
    {toast ? <div className="toast" role="status"><span aria-hidden="true">✓</span>{toast}</div> : null}
  </div>;
}

function WorkOrderDetail({ order, viewerId, canOperate, activeEntry, now, onClockIn, onClockOut, onAddLabour, onEdit, onEditLabour }: {
  order: WorkOrder;
  viewerId: string;
  canOperate: boolean;
  activeEntry: TimeEntry | null;
  now: number;
  onClockIn: (item: LabourItem) => void | Promise<void>;
  onClockOut: (entry: TimeEntry) => void;
  onAddLabour: () => void;
  onEdit: () => void;
  onEditLabour: (item: LabourItem) => void;
}) {
  return <>
    <header className="wf-detail-header">
      <div><div className="wf-detail-number"><span>{order.number}</span><span className={`wf-status ${order.status}`}>{statusLabels[order.status]}</span></div><h2>{order.title}</h2><p>{order.partnerName ? `${order.partnerName} · ${order.partnerType === "vendor" ? "Vendor" : order.partnerType === "customer" ? "Customer" : "Customer / vendor"}` : "No customer or vendor assigned"}</p></div>
      <div className="wf-detail-actions">{canOperate ? <button className="button secondary" onClick={onEdit}>Edit</button> : null}{canOperate && order.status !== "completed" ? <button className="button primary" onClick={onAddLabour}>Add labour</button> : null}</div>
    </header>
    <div className="wf-order-meta">
      <div><span>Total labour</span><strong>{formatDuration(order.totalSeconds)}</strong></div>
      <div><span>Workers</span><strong>{order.people.length || "—"}</strong></div>
      <div><span>Labour items</span><strong>{order.labourItems.length}</strong></div>
      <div><span>Created by</span><strong>{order.createdByName}</strong></div>
    </div>
    {order.people.length ? <div className="wf-worked-by"><span>Worked by</span><div>{order.people.map((person) => <span key={person.userId}><i>{initials(person.name)}</i>{person.name}</span>)}</div></div> : null}
    {order.notes ? <div className="wf-worked-by"><span>Notes</span><p>{order.notes}</p></div> : null}
    {order.links.length ? <div className="wf-linked-docs"><span>Linked orders</span><div>{order.links.map((link) => <span key={link.id} className={link.documentType === "sales_order" ? "sales" : "purchase"}>{link.documentType === "sales_order" ? "SO" : "PO"}<strong>{link.documentNumber}</strong></span>)}</div></div> : null}
    <section className="wf-labour-section">
      <div className="wf-section-heading"><div><span className="section-kicker">Clockable work</span><h3>Labour items</h3></div><span>{order.labourItems.filter((item) => item.status === "open").length} open</span></div>
      <div className="wf-labour-list">
        {order.labourItems.map((item) => {
          const activeWorkers = item.entries.filter((entry) => !entry.endedAt);
          const recordedWorkers = [...new Set(item.entries.map((entry) => entry.workerName))];
          const mine = activeWorkers.find((entry) => entry.workerUserId === viewerId);
          const clockable = canOperate && order.status === "open" && item.status === "open" && !activeEntry;
          return <article key={item.id} className={`wf-labour-card ${activeWorkers.length ? "has-active" : ""}`}>
            <div className="wf-labour-icon" aria-hidden="true">{activeWorkers.length ? <i /> : "↗"}</div>
            <div className="wf-labour-main"><div><h4>{item.title}</h4><span className={`wf-status ${item.status}`}>{item.status === "open" ? "Open" : "Completed"}</span></div>
              <p>{activeWorkers.length ? activeWorkers.map((entry) => `${entry.workerName} · ${formatDuration(elapsed(entry, now))}`).join(" • ") : item.entries.length ? `${recordedWorkers.join(", ")} · ${item.entries.length} ${item.entries.length === 1 ? "shift" : "shifts"}` : "No time recorded"}</p>
            </div>
            <strong className="wf-labour-total">{formatDuration(item.totalSeconds)}</strong>
            <div className="wf-labour-actions">{canOperate ? <button className="row-action" onClick={() => onEditLabour(item)}>Edit</button> : null}{mine ? <button className="button danger" onClick={() => onClockOut(mine)}>Clock out</button> : <button className="button primary" disabled={!clockable} title={activeEntry ? "Clock out of your current labour item first" : item.status !== "open" || order.status !== "open" ? "This labour item is not open" : undefined} onClick={() => void onClockIn(item)}>Clock in</button>}</div>
          </article>;
        })}
        {!order.labourItems.length ? <div className="wf-labour-empty"><strong>No labour items</strong><p>Add the first task so the team has somewhere to clock in.</p>{canOperate && order.status !== "completed" ? <button className="button primary" onClick={onAddLabour}>Add labour item</button> : null}</div> : null}
      </div>
    </section>
  </>;
}

function TeamStatus({ workers, now, onOpenOrder }: { workers: Worker[]; now: number; onOpenOrder: (id: string) => void }) {
  const active = workers.filter((worker) => worker.activeEntry);
  const idle = workers.filter((worker) => !worker.activeEntry);
  return <div className="wf-team-view">
    <div className="wf-team-summary"><div><strong>{active.length}</strong><span>Working now</span></div><div><strong>{workers.length}</strong><span>Worker accounts</span></div><div><strong>{formatDuration(workers.reduce((sum, worker) => sum + worker.sevenDaySeconds, 0))}</strong><span>Team time · 7 days</span></div></div>
    <section><div className="wf-section-heading"><div><span className="section-kicker">Live</span><h3>Working now</h3></div></div>
      <div className="wf-worker-grid">{active.map((worker) => <WorkerCard key={worker.userId} worker={worker} now={now} onOpenOrder={onOpenOrder} />)}{!active.length ? <div className="wf-team-empty"><strong>Nobody is clocked in</strong><p>Active workers will appear here with their work order and live duration.</p></div> : null}</div>
    </section>
    {idle.length ? <section><div className="wf-section-heading"><div><span className="section-kicker">Roster</span><h3>Available workers</h3></div></div><div className="wf-worker-grid">{idle.map((worker) => <WorkerCard key={worker.userId} worker={worker} now={now} onOpenOrder={onOpenOrder} />)}</div></section> : null}
  </div>;
}

function WorkerCard({ worker, now, onOpenOrder }: { worker: Worker; now: number; onOpenOrder: (id: string) => void }) {
  const entry = worker.activeEntry;
  return <article className={`wf-worker-card ${entry ? "working" : ""}`}>
    <div className="wf-worker-avatar">{initials(worker.name)}{entry ? <i /> : null}</div>
    <div className="wf-worker-name"><h4>{worker.name}</h4><p>{worker.email}</p></div>
    <span className={`wf-worker-state ${entry ? "working" : "idle"}`}>{entry ? "Working" : "Available"}</span>
    {entry ? <button className="wf-worker-job" onClick={() => onOpenOrder(entry.workOrderId)}><span>{entry.workOrderNumber}</span><strong>{entry.labourTitle}</strong><small>{entry.workOrderTitle}</small></button> : <div className="wf-worker-job idle"><span>No active clock</span><small>{worker.entryCount ? `${worker.entryCount} recorded ${worker.entryCount === 1 ? "shift" : "shifts"}` : "No time recorded yet"}</small></div>}
    <dl><div><dt>{entry ? "Current" : "Last 7 days"}</dt><dd>{entry ? formatDuration(elapsed(entry, now)) : formatDuration(worker.sevenDaySeconds)}</dd></div><div><dt>Total recorded</dt><dd>{formatDuration(worker.totalSeconds)}</dd></div></dl>
  </article>;
}

function TimeEntries({ entries, viewer, now, onEdit, onOpenOrder }: { entries: TimeEntry[]; viewer: WorkforceSnapshot["viewer"]; now: number; onEdit: (entry: TimeEntry) => void; onOpenOrder: (id: string) => void }) {
  return <div className="wf-time-view"><div className="wf-time-intro"><div><span className="section-kicker">Shift history</span><h3>Recorded time</h3><p>Managers can correct any completed shift. Workers can correct their own.</p></div><strong>{formatDuration(entries.reduce((sum, entry) => sum + elapsed(entry, now), 0))}<small>shown</small></strong></div>
    <div className="responsive-table"><table className="wf-time-table"><thead><tr><th>Worker</th><th>Work order</th><th>Labour item</th><th>Clock in</th><th>Clock out</th><th className="numeric">Duration</th><th>Tech story</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}>
      <td><strong>{entry.workerName}</strong><small>{entry.workerEmail}</small></td><td><button className="table-link" onClick={() => onOpenOrder(entry.workOrderId)}>{entry.workOrderNumber}</button><small>{entry.workOrderTitle}</small></td><td>{entry.labourTitle}</td><td>{dateTime(entry.startedAt)}</td><td>{entry.endedAt ? dateTime(entry.endedAt) : <span className="wf-live-label"><i />Active</span>}</td><td className="numeric"><strong>{formatDuration(elapsed(entry, now))}</strong></td><td className="wf-story-cell">{entry.techStory || <span>—</span>}</td><td>{entry.endedAt && (viewer.canManage || entry.workerUserId === viewer.id) ? <button className="button secondary" onClick={() => onEdit(entry)}>Edit</button> : null}</td>
    </tr>)}</tbody></table></div>{!entries.length ? <div className="wf-team-empty"><strong>No time entries yet</strong><p>Completed and active shifts will be listed here.</p></div> : null}</div>;
}

function MultiOrderSelect({ label, options, values, setValues }: { label: string; options: Lookup[]; values: string[]; setValues: (value: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = options.filter((option) => values.includes(option.id));
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = options.filter((option) => !normalizedQuery || [option.number, option.partnerName].some((value) => value?.toLowerCase().includes(normalizedQuery)));
  const placeholder = `Select ${label.toLowerCase()}`;
  const summary = selected.length
    ? `${selected.slice(0, 2).map((option) => option.number).join(", ")}${selected.length > 2 ? ` +${selected.length - 2}` : ""}`
    : options.length ? placeholder : `No ${label.toLowerCase()} available`;

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [open]);

  const toggle = (id: string) => setValues(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  const close = () => {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  };

  return <div className="wf-multi-select" ref={rootRef} onKeyDownCapture={(event) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }}>
    <div className="wf-multi-label"><span>{label}</span><small>Optional</small></div>
    <button ref={triggerRef} type="button" className="wf-multi-trigger" disabled={!options.length} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span className={selected.length ? "" : "placeholder"}>{summary}</span>
      <span className="wf-multi-trigger-end">{selected.length ? <b>{selected.length}</b> : null}<i aria-hidden="true">⌄</i></span>
    </button>
    {selected.length ? <div className="wf-multi-chips" aria-label={`Selected ${label.toLowerCase()}`}>{selected.map((option) => <button key={option.id} type="button" onClick={() => toggle(option.id)} aria-label={`Remove ${option.number}`}><span>{option.number}</span><i aria-hidden="true">×</i></button>)}</div> : null}
    {open ? <div className="wf-multi-menu">
      <div className="wf-multi-search"><span aria-hidden="true">⌕</span><input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label.toLowerCase()}`} /></div>
      <div className="wf-multi-options" role="listbox" aria-label={label} aria-multiselectable="true">
        {filtered.map((option) => <label key={option.id} role="option" aria-selected={values.includes(option.id)}><input type="checkbox" checked={values.includes(option.id)} onChange={() => toggle(option.id)} /><span><strong>{option.number}</strong><small>{option.partnerName || "No customer or vendor"}</small></span></label>)}
        {!filtered.length ? <p>No matching orders.</p> : null}
      </div>
      <div className="wf-multi-actions"><button type="button" className="text-button" disabled={!filtered.length} onClick={() => setValues(Array.from(new Set([...values, ...filtered.map((option) => option.id)])))}>Select all results</button><button type="button" className="text-button" disabled={!values.length} onClick={() => setValues([])}>Clear</button><button type="button" className="button secondary" onClick={close}>Done</button></div>
    </div> : null}
  </div>;
}

function OrderLinksPicker({ snapshot, partnerId, setPartnerId, salesOrderIds, setSalesOrderIds, purchaseOrderIds, setPurchaseOrderIds }: {
  snapshot: WorkforceSnapshot;
  partnerId: string;
  setPartnerId: (value: string) => void;
  salesOrderIds: string[];
  setSalesOrderIds: (value: string[]) => void;
  purchaseOrderIds: string[];
  setPurchaseOrderIds: (value: string[]) => void;
}) {
  return <>
    <label>Customer or vendor<select value={partnerId} onChange={(event) => setPartnerId(event.target.value)}><option value="">None</option>{snapshot.lookups.partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name} · {partner.partnerType}</option>)}</select></label>
    <MultiOrderSelect label="Sales orders" options={snapshot.lookups.salesOrders} values={salesOrderIds} setValues={setSalesOrderIds} />
    <MultiOrderSelect label="Purchase orders" options={snapshot.lookups.purchaseOrders} values={purchaseOrderIds} setValues={setPurchaseOrderIds} />
  </>;
}

function WorkforceDialog({ modal, snapshot, onClose, onSubmit }: { modal: Exclude<ModalState, null>; snapshot: WorkforceSnapshot; onClose: () => void; onSubmit: (command: string, payload: Record<string, unknown>) => Promise<unknown> }) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  useDialogDismiss(onClose, saving);
  const submit = async (command: string, payload: Record<string, unknown>) => {
    setSaving(true); setFormError("");
    try { await onSubmit(command, payload); } catch (caught) { setFormError(caught instanceof Error ? caught.message : "The change could not be saved."); setSaving(false); }
  };
  const titles: Record<Exclude<ModalState, null>["kind"], string> = { "create-order": "Create work order", "edit-order": "Edit work order", "add-labour": "Add labour item", "edit-labour": "Edit labour item", "clock-out": "Clock out", "edit-time": "Edit shift" };
  return <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section className="command-dialog wf-dialog" role="dialog" aria-modal="true" aria-labelledby="wf-dialog-title">
    <div className="dialog-header"><div><span className="section-kicker">Workforce</span><h2 id="wf-dialog-title">{titles[modal.kind]}</h2></div><button className="icon-button" aria-label="Close" disabled={saving} onClick={onClose}>×</button></div>
    {modal.kind === "create-order" ? <WorkOrderForm formRef={formRef} snapshot={snapshot} saving={saving} error={formError} onClose={onClose} onSubmit={(payload) => submit("createWorkOrder", payload)} /> : null}
    {modal.kind === "edit-order" ? <WorkOrderForm formRef={formRef} snapshot={snapshot} order={modal.order} saving={saving} error={formError} onClose={onClose} onSubmit={(payload) => submit("updateWorkOrder", payload)} /> : null}
    {modal.kind === "add-labour" ? <SimpleLabourForm formRef={formRef} saving={saving} error={formError} order={modal.order} onSubmit={(payload) => submit("addLabourItem", payload)} /> : null}
    {modal.kind === "edit-labour" ? <EditLabourForm formRef={formRef} saving={saving} error={formError} item={modal.item} onSubmit={(payload) => submit("updateLabourItem", payload)} /> : null}
    {modal.kind === "clock-out" ? <ClockOutForm formRef={formRef} saving={saving} error={formError} entry={modal.entry} onSubmit={(payload) => submit("clockOut", payload)} /> : null}
    {modal.kind === "edit-time" ? <EditTimeForm formRef={formRef} saving={saving} error={formError} entry={modal.entry} onSubmit={(payload) => submit("updateTimeEntry", payload)} /> : null}
  </section></div>;
}

function WorkOrderForm({ formRef, snapshot, order, saving, error, onClose, onSubmit }: { formRef: React.RefObject<HTMLFormElement | null>; snapshot: WorkforceSnapshot; order?: WorkOrder; saving: boolean; error: string; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState(order?.title ?? "");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [status, setStatus] = useState<WorkOrder["status"]>(order?.status ?? "open");
  const [partnerId, setPartnerId] = useState(order?.partnerId ?? "");
  const [salesOrderIds, setSalesOrderIds] = useState(order?.links.filter((link) => link.documentType === "sales_order").map((link) => link.documentId) ?? []);
  const [purchaseOrderIds, setPurchaseOrderIds] = useState(order?.links.filter((link) => link.documentType === "purchase_order").map((link) => link.documentId) ?? []);
  const [labourTitles, setLabourTitles] = useState([""]);
  return <form ref={formRef} className="wf-form" onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit({ ...(order ? { workOrderId: order.id, version: order.version, status } : {}), title, notes, partnerId, salesOrderIds, purchaseOrderIds, ...(!order ? { labourTitles: labourTitles.filter((item) => item.trim()) } : {}) }); }}>
    <label>Work-order title <span className="required-mark">*</span><input required maxLength={180} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Inspect damaged patio door" /></label>
    <label>Notes <span>Optional</span><textarea rows={4} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Site details, scope, access instructions, or other context" /></label>
    {order ? <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as WorkOrder["status"])}><option value="open">Open</option><option value="on_hold">On hold</option><option value="completed">Completed</option></select></label> : null}
    <OrderLinksPicker snapshot={snapshot} partnerId={partnerId} setPartnerId={setPartnerId} salesOrderIds={salesOrderIds} setSalesOrderIds={setSalesOrderIds} purchaseOrderIds={purchaseOrderIds} setPurchaseOrderIds={setPurchaseOrderIds} />
    {!order ? <fieldset className="wf-initial-labour"><legend>Initial labour items <span>Optional</span></legend>{labourTitles.map((item, index) => <div key={index}><input maxLength={180} value={item} onChange={(event) => setLabourTitles((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} placeholder={index === 0 ? "e.g. Diagnose issue" : "Another labour item"} />{labourTitles.length > 1 ? <button type="button" className="icon-button" aria-label={`Remove labour item ${index + 1}`} onClick={() => setLabourTitles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button> : null}</div>)}<button type="button" className="text-button" onClick={() => setLabourTitles((current) => [...current, ""])}>+ Add another labour item</button></fieldset> : null}
    {error ? <p className="wf-form-error" role="alert">{error}</p> : null}<div className="dialog-actions"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="button primary" disabled={saving}>{saving ? "Saving…" : order ? "Save work order" : "Create work order"}</button></div>
  </form>;
}

function SimpleLabourForm({ formRef, saving, error, order, onSubmit }: { formRef: React.RefObject<HTMLFormElement | null>; saving: boolean; error: string; order: WorkOrder; onSubmit: (payload: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState("");
  return <form ref={formRef} className="wf-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ workOrderId: order.id, title }); }}><div className="wf-form-context"><span>{order.number}</span><strong>{order.title}</strong></div><label>Labour title <span className="required-mark">*</span><input required autoFocus maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Replace sealed unit" /></label>{error ? <p className="wf-form-error" role="alert">{error}</p> : null}<div className="dialog-actions"><button className="button primary" disabled={saving}>{saving ? "Adding…" : "Add labour item"}</button></div></form>;
}

function EditLabourForm({ formRef, saving, error, item, onSubmit }: { formRef: React.RefObject<HTMLFormElement | null>; saving: boolean; error: string; item: LabourItem; onSubmit: (payload: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState(item.title);
  const [status, setStatus] = useState(item.status);
  return <form ref={formRef} className="wf-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ labourItemId: item.id, version: item.version, title, status }); }}><label>Labour title <span className="required-mark">*</span><input required autoFocus maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as LabourItem["status"])}><option value="open">Open</option><option value="completed">Completed</option></select></label>{error ? <p className="wf-form-error" role="alert">{error}</p> : null}<div className="dialog-actions"><button className="button primary" disabled={saving}>{saving ? "Saving…" : "Save labour item"}</button></div></form>;
}

function ClockOutForm({ formRef, saving, error, entry, onSubmit }: { formRef: React.RefObject<HTMLFormElement | null>; saving: boolean; error: string; entry: TimeEntry; onSubmit: (payload: Record<string, unknown>) => void }) {
  const [story, setStory] = useState("");
  const append = (text: string) => setStory((current) => `${current}${current.trim() ? " " : ""}${text}`);
  return <form ref={formRef} className="wf-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ timeEntryId: entry.id, techStory: story }); }}><div className="wf-form-context"><span>{entry.workOrderNumber} · {entry.labourTitle}</span><strong>{entry.workOrderTitle}</strong><small>Started {dateTime(entry.startedAt)}</small></div><label>Technician story <span>Optional</span><textarea rows={6} maxLength={8000} autoFocus value={story} onChange={(event) => setStory(event.target.value)} placeholder="What did you find, what work was completed, and what happens next?" /></label><div className="wf-dictation-row"><DictationButton onText={append} /><small>Uses your browser&apos;s speech recognition. Review the text before saving.</small></div>{error ? <p className="wf-form-error" role="alert">{error}</p> : null}<div className="dialog-actions"><button className="button danger" disabled={saving}>{saving ? "Clocking out…" : "Clock out & save"}</button></div></form>;
}

function EditTimeForm({ formRef, saving, error, entry, onSubmit }: { formRef: React.RefObject<HTMLFormElement | null>; saving: boolean; error: string; entry: TimeEntry; onSubmit: (payload: Record<string, unknown>) => void }) {
  const [startedAt, setStartedAt] = useState(toLocalInput(entry.startedAt));
  const [endedAt, setEndedAt] = useState(toLocalInput(entry.endedAt ?? entry.startedAt));
  const [story, setStory] = useState(entry.techStory ?? "");
  const append = (text: string) => setStory((current) => `${current}${current.trim() ? " " : ""}${text}`);
  return <form ref={formRef} className="wf-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ timeEntryId: entry.id, version: entry.version, startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(), techStory: story }); }}><div className="wf-form-context"><span>{entry.workerName} · {entry.workOrderNumber}</span><strong>{entry.labourTitle}</strong></div><div className="wf-time-fields"><label>Clock in<input type="datetime-local" required value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></label><label>Clock out<input type="datetime-local" required value={endedAt} onChange={(event) => setEndedAt(event.target.value)} /></label></div><label>Technician story <span>Optional</span><textarea rows={5} maxLength={8000} value={story} onChange={(event) => setStory(event.target.value)} /></label><div className="wf-dictation-row"><DictationButton onText={append} /><small>{entry.editedByName ? `Last corrected by ${entry.editedByName}.` : "Corrections are recorded in the audit trail."}</small></div>{error ? <p className="wf-form-error" role="alert">{error}</p> : null}<div className="dialog-actions"><button className="button primary" disabled={saving}>{saving ? "Saving…" : "Save correction"}</button></div></form>;
}
