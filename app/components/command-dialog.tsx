"use client";

import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { CloseIcon } from "./icons";
import { ImpactPreview } from "./metrics";
import { BusinessRuleBanner } from "./status";
import type { CommandPreviewResponse } from "./types";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export interface CommandDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  recordVersion: number;
  idempotencyKey: string;
  commandEndpoint: string;
  preview: CommandPreviewResponse;
  busy?: boolean;
  children?: ReactNode;
  onClose: () => void;
  onConfirm: (context: { recordVersion: number; idempotencyKey: string; commandEndpoint: string }) => void | Promise<void>;
  className?: string;
}

export function CommandDialog({ open, title, description, confirmLabel, recordVersion, idempotencyKey, commandEndpoint, preview, busy = false, children, onClose, onConfirm, className }: CommandDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => cancelRef.current?.focus());
    return () => { document.removeEventListener("keydown", handleKeyDown); document.body.style.overflow = ""; previous?.focus(); };
  }, [open, busy, onClose]);

  if (!open) return null;
  const submit = (event: FormEvent) => { event.preventDefault(); if (preview.permitted && !busy) void onConfirm({ recordVersion, idempotencyKey, commandEndpoint }); };

  return (
    <div className="command-dialog fixed inset-0 z-50 grid place-items-end bg-slate-950/40 p-0 sm:place-items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={panelRef} className={cx("command-dialog__panel max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl", className)} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <form onSubmit={submit}>
          <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:rounded-t-2xl">
            <div><h2 id={titleId} className="text-lg font-semibold text-slate-950">{title}</h2><p id={descriptionId} className="mt-1 text-sm leading-5 text-slate-500">{description}</p></div>
            <button type="button" className="inline-grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2" onClick={onClose} disabled={busy} aria-label={`Close ${title}`}><CloseIcon className="h-5 w-5" /></button>
          </header>
          <div className="space-y-4 px-5 py-5">
            {preview.blockingReasons.map((reason) => <BusinessRuleBanner key={reason.code} title="Action blocked" severity="blocking">{reason.message}{reason.resolutionActions?.length ? <div className="mt-2 flex flex-wrap gap-3">{reason.resolutionActions.map((action) => action.href ? <a key={action.label} href={action.href} className="font-semibold underline">{action.label}</a> : <span key={action.label} className="font-semibold">{action.label}</span>)}</div> : null}</BusinessRuleBanner>)}
            {preview.warnings.map((warning) => <BusinessRuleBanner key={warning.code} title="Review before continuing" severity="warning">{warning.message}</BusinessRuleBanner>)}
            {preview.approvalRequired ? <BusinessRuleBanner title="Approval required" severity="info">Completing this command will send it to an approver before it can take effect.</BusinessRuleBanner> : null}
            {children}
            <ImpactPreview impact={preview.impact} />
          </div>
          <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end sm:rounded-b-2xl">
            <button ref={cancelRef} type="button" className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 disabled:opacity-50" onClick={onClose} disabled={busy}>Keep reviewing</button>
            <button type="submit" className="min-h-11 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={!preview.permitted || busy} aria-busy={busy}>{busy ? "Working…" : confirmLabel}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
