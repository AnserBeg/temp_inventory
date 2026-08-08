"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from "./icons";
import type { Severity } from "./types";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const toastToneClasses: Record<NonNullable<ToastProps["tone"]>, string> = {
  info: "border-sky-200 text-sky-800",
  success: "border-emerald-200 text-emerald-800",
  warning: "border-amber-200 text-amber-900",
  blocking: "border-red-200 text-red-800",
};

export interface ToastProps {
  id: string;
  title: string;
  message?: string;
  tone?: Extract<Severity, "info" | "success" | "warning" | "blocking">;
  action?: { label: string; onClick: () => void };
}

export function ToastLiveRegion({ toasts, onDismiss, dismissAfter = 6000, className }: { toasts: ToastProps[]; onDismiss: (id: string) => void; dismissAfter?: number | false; className?: string }) {
  useEffect(() => {
    if (!dismissAfter || !toasts.length) return;
    const timers = toasts.map((toast) => window.setTimeout(() => onDismiss(toast.id), dismissAfter));
    return () => timers.forEach(window.clearTimeout);
  }, [toasts, dismissAfter, onDismiss]);
  return (
    <div className={cx("toast-live-region pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2", className)} aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />)}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastProps; onDismiss: (id: string) => void }) {
  const tone = toast.tone ?? "info";
  const Icon = tone === "success" ? CheckIcon : tone === "info" ? InfoIcon : AlertIcon;
  return (
    <div className={cx("toast pointer-events-auto flex items-start gap-3 rounded-xl border bg-white p-4 shadow-xl", toastToneClasses[tone], `toast--${tone}`)} role={tone === "blocking" ? "alert" : "status"}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-950">{toast.title}</p>{toast.message ? <p className="mt-1 text-sm leading-5 text-slate-600">{toast.message}</p> : null}{toast.action ? <button type="button" className="mt-2 min-h-9 text-sm font-semibold text-teal-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2" onClick={toast.action.onClick}>{toast.action.label}</button> : null}</div>
      <button type="button" onClick={() => onDismiss(toast.id)} className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2" aria-label={`Dismiss ${toast.title}`}><CloseIcon className="h-4 w-4" /></button>
    </div>
  );
}

export function ErrorSummary({ title = "Please fix the following", errors, className }: { title?: string; errors: Array<{ fieldId: string; message: string }>; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => { if (errors.length) ref.current?.focus(); }, [errors]);
  if (!errors.length) return null;
  return (
    <div ref={ref} tabIndex={-1} className={cx("error-summary rounded-lg border border-red-200 bg-red-50 p-4 text-red-900 focus:outline focus-visible:ring-2 focus-visible:ring-red-600", className)} role="alert" aria-labelledby={id}>
      <div className="flex items-center gap-2"><AlertIcon className="h-5 w-5" /><h2 id={id} className="text-sm font-semibold">{title}</h2></div>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">{errors.map((error) => <li key={`${error.fieldId}-${error.message}`}><a href={`#${error.fieldId}`} className="underline underline-offset-2" onClick={() => document.getElementById(error.fieldId)?.focus()}>{error.message}</a></li>)}</ul>
    </div>
  );
}

export function InlineFieldError({ id, children }: { id?: string; children: ReactNode }) {
  return <p id={id} className="inline-field-error mt-1.5 flex items-start gap-1.5 text-sm text-red-700"><AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />{children}</p>;
}

export function EmptyState({ title, description, action, icon, className }: { title: string; description: string; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return <div className={cx("empty-state grid min-h-56 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center", className)}><div className="max-w-sm">{icon ? <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-white text-slate-500 shadow-sm">{icon}</div> : null}<h3 className="font-semibold text-slate-950">{title}</h3><p className="mt-1.5 text-sm leading-6 text-slate-500">{description}</p>{action ? <div className="mt-4">{action}</div> : null}</div></div>;
}

export function LoadingState({ label = "Loading", rows = 3, className }: { label?: string; rows?: number; className?: string }) {
  return <div className={cx("loading-state space-y-3 rounded-xl border border-slate-200 bg-white p-4", className)} role="status" aria-label={label}><span className="sr-only">{label}</span>{Array.from({ length: rows }, (_, index) => <div key={index} aria-hidden="true" className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>;
}
