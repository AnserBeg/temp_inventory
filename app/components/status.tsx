import type { HTMLAttributes, ReactNode } from "react";
import { AlertIcon, CheckIcon, ClockIcon, InfoIcon } from "./icons";
import type { DocumentStatusModel, LabeledStatus, Severity, StatusException } from "./types";

const statusDefaults: Record<string, Severity> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "success",
  closed: "neutral",
  canceled: "blocking",
  not_started: "neutral",
  partial: "info",
  complete: "success",
  closed_short: "warning",
  over_fulfilled: "warning",
  return_in_progress: "info",
  not_billed: "neutral",
  partially_billed: "info",
  fully_billed: "success",
  credit_expected: "warning",
  credited: "neutral",
};

const badgeToneClasses: Record<Severity, string> = {
  neutral: "bg-slate-100 text-slate-700",
  info: "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200",
  success: "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200",
  warning: "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200",
  blocking: "bg-red-50 text-red-800 ring-1 ring-inset ring-red-200",
};

const bannerToneClasses: Record<Severity, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-800",
  info: "border-sky-200 bg-sky-50 text-sky-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  blocking: "border-red-200 bg-red-50 text-red-900",
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function toneIcon(tone: Severity) {
  const className = "h-3.5 w-3.5 shrink-0";
  if (tone === "success") return <CheckIcon className={className} />;
  if (tone === "warning" || tone === "blocking") return <AlertIcon className={className} />;
  if (tone === "info") return <InfoIcon className={className} />;
  return <ClockIcon className={className} />;
}

export interface StatusBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  label: string;
  tone?: Severity;
  icon?: ReactNode;
}

export function StatusBadge({ label, tone = "neutral", icon, className, ...props }: StatusBadgeProps) {
  return (
    <span className={cx("status-badge inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", badgeToneClasses[tone], `status-badge--${tone}`, className)} data-tone={tone} {...props}>
      {icon ?? toneIcon(tone)}
      <span>{label}</span>
    </span>
  );
}

function Dimension({ title, value }: { title: string; value: LabeledStatus }) {
  const tone = value.severity ?? statusDefaults[value.code] ?? "neutral";
  return (
    <div className="document-status-summary__dimension min-w-0">
      <dt className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</dt>
      <dd><StatusBadge label={value.label} tone={tone} /></dd>
    </div>
  );
}

export function DocumentStatusSummary({ status, className }: { status: DocumentStatusModel; className?: string }) {
  return (
    <section className={cx("document-status-summary", className)} aria-label="Document status">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Dimension title="Commercial" value={status.lifecycle} />
        <Dimension title="Physical" value={status.fulfillment} />
        <Dimension title="Financial" value={status.billing} />
      </dl>
      {status.exceptions.length ? (
        <div className="mt-3 space-y-2" aria-label="Exceptions">
          {status.exceptions.map((exception) => <ExceptionBanner key={exception.code} exception={exception} compact />)}
        </div>
      ) : null}
    </section>
  );
}

export function ExceptionBanner({ exception, compact = false, className }: { exception: StatusException; compact?: boolean; className?: string }) {
  const urgent = exception.severity === "blocking";
  return (
    <div className={cx("exception-banner flex items-start gap-2.5 rounded-lg border", bannerToneClasses[exception.severity], `exception-banner--${exception.severity}`, compact ? "px-3 py-2" : "px-4 py-3", className)} role={urgent ? "alert" : "status"}>
      {exception.severity === "info" ? <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0">
        <p className="text-sm font-semibold">{exception.label}</p>
        {exception.detail ? <p className="mt-0.5 text-sm opacity-80">{exception.detail}</p> : null}
      </div>
    </div>
  );
}

export function BusinessRuleBanner({ title, children, severity = "info", className }: { title: string; children: ReactNode; severity?: Severity; className?: string }) {
  const isAlert = severity === "blocking";
  return (
    <aside className={cx("business-rule-banner flex items-start gap-3 rounded-lg border px-4 py-3", bannerToneClasses[severity], `business-rule-banner--${severity}`, className)} role={isAlert ? "alert" : "note"}>
      {toneIcon(severity)}
      <div><p className="text-sm font-semibold">{title}</p><div className="mt-1 text-sm opacity-85">{children}</div></div>
    </aside>
  );
}
