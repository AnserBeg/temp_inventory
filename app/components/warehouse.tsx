"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertIcon, CheckIcon, ChevronRightIcon, ScanIcon, UndoIcon } from "./icons";
import { StatusBadge } from "./status";
import type { ConnectionState, ScanRecord, WarehouseTask } from "./types";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const scanStateClasses: Record<ScanResult["state"], string> = {
  accepted: "bg-emerald-50 text-emerald-800",
  duplicate: "bg-amber-50 text-amber-900",
  invalid: "bg-red-50 text-red-800",
};

export function StepHeader({ current, total, title, instruction, onBack, className }: { current: number; total: number; title: string; instruction: string; onBack?: () => void; className?: string }) {
  const progress = total > 0 ? Math.max(0, Math.min(100, (current / total) * 100)) : 0;
  return (
    <header className={cx("warehouse-step-header", className)}>
      <div className="flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500"><span>Step {current} of {total}</span>{onBack ? <button type="button" onClick={onBack} className="min-h-11 rounded-lg px-3 text-sm normal-case tracking-normal text-teal-700 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2">Back</button> : null}</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden="true"><span className="block h-full rounded-full bg-teal-700 transition-[width] motion-reduce:transition-none" style={{ width: `${progress}%` }} /></div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">{title}</h1><p className="mt-2 text-base leading-6 text-slate-600">{instruction}</p>
    </header>
  );
}

export interface ScanResult {
  state: "accepted" | "duplicate" | "invalid";
  message: string;
}

export function ScanInput({ label = "Scan or enter code", placeholder = "Ready to scan", submitLabel = "Check code", autoFocus = true, disabled = false, knownValues, recentValues = [], onScan, className }: { label?: string; placeholder?: string; submitLabel?: string; autoFocus?: boolean; disabled?: boolean; knownValues?: string[]; recentValues?: string[]; onScan: (value: string) => ScanResult | Promise<ScanResult>; className?: string }) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const normalizedKnown = knownValues?.map((item) => item.trim().toLocaleLowerCase());
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const scan = value.trim();
    if (!scan || busy) return;
    if (recentValues.some((item) => item.toLocaleLowerCase() === scan.toLocaleLowerCase())) { setResult({ state: "duplicate", message: `${scan} was already scanned.` }); setValue(""); inputRef.current?.focus(); return; }
    if (normalizedKnown && !normalizedKnown.includes(scan.toLocaleLowerCase())) { setResult({ state: "invalid", message: `${scan} is not an exact match for this task.` }); inputRef.current?.focus(); return; }
    setBusy(true);
    try { const next = await onScan(scan); setResult(next); if (next.state === "accepted") setValue(""); }
    catch { setResult({ state: "invalid", message: "The scan could not be checked. Your entry is still here." }); }
    finally { setBusy(false); inputRef.current?.focus(); }
  };
  return (
    <form className={cx("scan-input rounded-xl border border-slate-200 bg-white p-4", className)} onSubmit={submit}>
      <label htmlFor={statusId} className="text-sm font-semibold text-slate-950">{label}</label>
      <div className="relative mt-2"><ScanIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input ref={inputRef} id={statusId} value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} autoFocus={autoFocus} disabled={disabled || busy} autoComplete="off" enterKeyHint="done" aria-describedby={`${statusId}-feedback`} className="min-h-14 w-full rounded-lg border border-slate-300 bg-white pl-12 pr-4 text-base text-slate-950 outline-none placeholder:text-slate-400 focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20 disabled:bg-slate-100" /></div>
      <button type="submit" disabled={disabled || busy || !value.trim()} className="mt-3 min-h-12 w-full rounded-lg bg-teal-700 px-5 text-base font-semibold text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Checking…" : submitLabel}</button>
      <div id={`${statusId}-feedback`} aria-live="assertive" aria-atomic="true">{result ? <ScanFeedback result={result} className="mt-3" /> : null}</div>
    </form>
  );
}

export function ScanFeedback({ result, className }: { result: ScanResult; className?: string }) {
  const Icon = result.state === "accepted" ? CheckIcon : AlertIcon;
  return <div className={cx("scan-feedback flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm font-medium", scanStateClasses[result.state], `scan-feedback--${result.state}`, className)} role={result.state === "accepted" ? "status" : "alert"}><Icon className="mt-0.5 h-4 w-4 shrink-0" /><span>{result.message}</span></div>;
}

export function QuantityKeypad({ value, onChange, max, unit = "units", className }: { value: number; onChange: (value: number) => void; max?: number; unit?: string; className?: string }) {
  const append = (digit: number) => { const next = Number(`${value}${digit}`); onChange(max === undefined ? next : Math.min(max, next)); };
  return <section className={cx("quantity-keypad rounded-xl border border-slate-200 bg-white p-4", className)} aria-label="Quantity keypad"><div className="mb-3 flex items-baseline justify-between rounded-lg bg-slate-50 px-4 py-3"><span className="text-sm text-slate-500">Quantity</span><strong className="text-3xl tabular-nums text-slate-950">{value} <span className="text-sm font-medium text-slate-500">{unit}</span></strong></div><div className="grid grid-cols-3 gap-2">{[1,2,3,4,5,6,7,8,9].map((digit) => <button key={digit} type="button" onClick={() => append(digit)} className="min-h-12 rounded-lg border border-slate-300 bg-white text-lg font-semibold hover:bg-slate-50 focus-visible:outline focus-visible:outline-2">{digit}</button>)}<button type="button" onClick={() => onChange(Math.floor(value / 10))} className="min-h-12 rounded-lg border border-slate-300 bg-white text-sm font-semibold hover:bg-slate-50 focus-visible:outline focus-visible:outline-2" aria-label="Delete last digit">Delete</button><button type="button" onClick={() => append(0)} className="min-h-12 rounded-lg border border-slate-300 bg-white text-lg font-semibold hover:bg-slate-50 focus-visible:outline focus-visible:outline-2">0</button><button type="button" onClick={() => onChange(0)} className="min-h-12 rounded-lg border border-slate-300 bg-white text-sm font-semibold hover:bg-slate-50 focus-visible:outline focus-visible:outline-2">Clear</button></div></section>;
}

export function ConditionSelector({ value, onChange, options = ["Available", "Quality hold", "Damaged", "Rejected"], className }: { value: string; onChange: (value: string) => void; options?: string[]; className?: string }) {
  const name = useId();
  return <fieldset className={cx("condition-selector", className)}><legend className="text-sm font-semibold text-slate-950">Condition</legend><div className="mt-2 grid grid-cols-2 gap-2">{options.map((option) => <label key={option} className={cx("flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm font-medium", value === option ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}><input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} className="h-4 w-4 accent-teal-700" />{option}</label>)}</div></fieldset>;
}

export function DestinationScanner({ expectedLocation, onScan, recentValues = [], className }: { expectedLocation?: string; onScan: (value: string) => ScanResult | Promise<ScanResult>; recentValues?: string[]; className?: string }) {
  return <section className={cx("destination-scanner", className)}>{expectedLocation ? <div className="mb-2 flex items-baseline justify-between gap-3"><h2 className="text-sm font-semibold text-slate-950">Destination</h2><span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-slate-700">{expectedLocation}</span></div> : null}<ScanInput label="Scan destination location" placeholder="Scan rack or bay code" submitLabel="Confirm destination" knownValues={expectedLocation ? [expectedLocation] : undefined} recentValues={recentValues} onScan={onScan} /></section>;
}

export function RecentScans({ scans, onUndo, className }: { scans: ScanRecord[]; onUndo?: (scan: ScanRecord) => void; className?: string }) {
  return <section className={cx("recent-scans", className)} aria-labelledby="recent-scans-heading"><div className="flex items-center justify-between"><h2 id="recent-scans-heading" className="text-sm font-semibold text-slate-950">Recent scans</h2><span className="text-xs tabular-nums text-slate-500">{scans.length} total</span></div>{scans.length ? <ol className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">{scans.map((scan) => <li key={scan.id} className="flex min-h-14 items-center gap-3 px-3 py-2"><span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full", scanStateClasses[scan.state], `recent-scans__state--${scan.state}`)}>{scan.state === "accepted" ? <CheckIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm font-semibold text-slate-900">{scan.label ?? scan.value}</strong><span className="block text-xs text-slate-500">{scan.value} · {scan.timestamp}</span></span>{onUndo && scan.state === "accepted" ? <button type="button" onClick={() => onUndo(scan)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2"><UndoIcon className="h-4 w-4" />Undo</button> : null}</li>)}</ol> : <p className="mt-2 rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Scans will appear here.</p>}</section>;
}

export function ConnectionStatus({ state, pendingCount = 0, className }: { state: ConnectionState; pendingCount?: number; className?: string }) {
  const copy = state === "online" ? "Online" : state === "syncing" ? `Syncing${pendingCount ? ` ${pendingCount}` : ""}` : `Offline${pendingCount ? ` · ${pendingCount} pending` : ""}`;
  const tone = state === "online" ? "success" : state === "syncing" ? "info" : "warning";
  return <div className={cx("connection-status", className)} role="status" aria-live="polite"><StatusBadge label={copy} tone={tone} /></div>;
}

export function WarehouseTaskLauncher({ tasks, className }: { tasks: WarehouseTask[]; className?: string }) {
  return <nav className={cx("warehouse-task-launcher grid gap-3 sm:grid-cols-2", className)} aria-label="Warehouse tasks">{tasks.map((task) => <a key={task.id} href={task.href} className={cx("group flex min-h-24 items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2", `warehouse-task-launcher__task--${task.priority ?? "normal"}`)}><span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">{task.icon ?? <ScanIcon className="h-5 w-5" />}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="text-base text-slate-950">{task.title}</strong>{task.count !== undefined ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">{task.count}</span> : null}</span><span className="mt-1 block text-sm text-slate-500">{task.description}</span></span><ChevronRightIcon className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" /></a>)}</nav>;
}

export function WarehouseActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("warehouse-action-bar sticky bottom-0 z-10 -mx-4 mt-6 flex gap-2 border-t border-slate-200 bg-white/95 p-4 backdrop-blur", className)}>{children}</div>;
}
