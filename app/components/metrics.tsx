import type { ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronRightIcon, InfoIcon } from "./icons";
import { BusinessRuleBanner, StatusBadge } from "./status";
import type { ImpactPreviewModel, MetricItem, QuantityItem, Severity } from "./types";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const metricToneClasses: Record<Severity, string> = {
  neutral: "",
  info: "border-l-4 border-l-sky-500",
  success: "border-l-4 border-l-emerald-500",
  warning: "border-l-4 border-l-amber-500",
  blocking: "border-l-4 border-l-red-500",
};

const valueToneClasses: Record<Severity, string> = {
  neutral: "text-slate-700",
  info: "text-sky-800",
  success: "text-emerald-800",
  warning: "text-amber-900",
  blocking: "text-red-800",
};

export interface MetricCardProps extends MetricItem {
  className?: string;
}

export function MetricCard({ label, value, detail, tone = "neutral", href, icon, className }: MetricCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-slate-600">{label}</span>
        {icon ? <span className="text-slate-400">{icon}</span> : null}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <strong className="text-2xl font-semibold tabular-nums tracking-tight text-slate-950">{value}</strong>
        {href ? <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" /> : null}
      </div>
      {detail ? <p className="mt-1.5 text-xs leading-5 text-slate-500">{detail}</p> : null}
    </>
  );
  const classes = cx("metric-card block rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm", metricToneClasses[tone], `metric-card--${tone}`, href && "transition-colors hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2", className);
  return href ? <a className={classes} href={href} aria-label={`${label}: ${value}. View details`}>{content}</a> : <article className={classes}>{content}</article>;
}

export function InventoryMetricStrip({ metrics, className }: { metrics: MetricItem[]; className?: string }) {
  return (
    <section className={cx("inventory-metric-strip grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7", className)} aria-label="Inventory metrics">
      {metrics.map(({ key, ...metric }) => <MetricCard key={key} {...metric} />)}
    </section>
  );
}

function QuantityRow({ item }: { item: QuantityItem }) {
  const referencesOkay = item.sources.length > 0;
  return (
    <div className={cx("quantity-breakdown__row grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-t border-slate-100 py-2.5", item.tone && `quantity-breakdown__row--${item.tone}`)}>
      <div className="min-w-0">
        <dt className="text-sm text-slate-600">{item.label}</dt>
        {referencesOkay ? (
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
            {item.sources.map((source) => <a key={source.id} href={source.href} className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline">{source.label}</a>)}
          </div>
        ) : (
          <p className="mt-1 text-xs font-medium text-red-700">Source records unavailable</p>
        )}
      </div>
      <dd className={cx("font-semibold tabular-nums", valueToneClasses[item.tone ?? "neutral"])}>{item.value}{item.unit ? <span className="ml-1 text-xs font-medium text-slate-500">{item.unit}</span> : null}</dd>
    </div>
  );
}

export function QuantityBreakdown({ summary, secondary, items, defaultOpen = false, className }: { summary: string; secondary?: string; items: QuantityItem[]; defaultOpen?: boolean; className?: string }) {
  return (
    <details className={cx("quantity-breakdown overflow-hidden rounded-xl border border-slate-200 bg-white", className)} open={defaultOpen}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]">
        <span><span className="block text-sm font-semibold text-slate-950">{summary}</span>{secondary ? <span className="mt-0.5 block text-xs text-slate-500">{secondary}</span> : null}</span>
        <span className="quantity-breakdown__toggle text-xs font-semibold text-teal-700">Details</span>
      </summary>
      <dl className="border-t border-slate-200 px-4 pb-1">{items.map((item) => <QuantityRow key={item.key} item={item} />)}</dl>
    </details>
  );
}

export interface AvailabilityBreakdownProps {
  requested: number;
  availableNow: number;
  incoming: number;
  shortage: number;
  unit?: string;
  links?: Partial<Record<"available" | "incoming" | "shortage", string>>;
  className?: string;
}

export function AvailabilityBreakdown({ requested, availableNow, incoming, shortage, unit = "units", links = {}, className }: AvailabilityBreakdownProps) {
  const values = [
    { key: "available", label: "Available now", value: availableNow, tone: "success" as Severity, href: links.available },
    { key: "incoming", label: "Incoming", value: incoming, tone: "info" as Severity, href: links.incoming },
    { key: "shortage", label: "Short", value: shortage, tone: shortage > 0 ? "blocking" as Severity : "neutral" as Severity, href: links.shortage },
  ];
  return (
    <section className={cx("availability-breakdown rounded-xl border border-slate-200 bg-white p-4", className)} aria-label={`Availability for ${requested} ${unit} requested`}>
      <div className="flex items-baseline justify-between gap-3"><h3 className="text-sm font-semibold text-slate-950">Availability</h3><span className="text-xs text-slate-500">{requested} {unit} requested</span></div>
      <div className="mt-3 grid grid-cols-3 divide-x divide-slate-200">
        {values.map((item) => {
          const content = <><span className="block text-xs text-slate-500">{item.label}</span><strong className="mt-1 block text-xl font-semibold tabular-nums text-slate-950">{item.value}</strong></>;
          return item.href ? <a key={item.key} href={item.href} className={cx("px-3 first:pl-0 last:pr-0 focus-visible:outline focus-visible:outline-2", valueToneClasses[item.tone], `availability-breakdown__item--${item.tone}`)}>{content}</a> : <div key={item.key} className={cx("px-3 first:pl-0 last:pr-0", valueToneClasses[item.tone], `availability-breakdown__item--${item.tone}`)}>{content}</div>;
        })}
      </div>
    </section>
  );
}

const inventoryEffectCopy: Record<ImpactPreviewModel["inventoryEffect"], { label: string; tone: Severity; icon: ReactNode }> = {
  increase: { label: "On-hand inventory increases", tone: "success", icon: <ArrowUpIcon className="h-4 w-4" /> },
  decrease: { label: "On-hand inventory decreases", tone: "warning", icon: <ArrowDownIcon className="h-4 w-4" /> },
  none: { label: "No change to on-hand inventory", tone: "info", icon: <CheckIcon className="h-4 w-4" /> },
};

export function ImpactPreview({ impact, className }: { impact: ImpactPreviewModel; className?: string }) {
  const effect = inventoryEffectCopy[impact.inventoryEffect];
  return (
    <section className={cx("impact-preview rounded-xl border border-slate-200 bg-slate-50 p-4", className)} aria-labelledby="impact-preview-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="impact-preview-title" className="text-sm font-semibold text-slate-950">{impact.title ?? "Impact preview"}</h3>
        <StatusBadge label={effect.label} tone={effect.tone} icon={effect.icon} />
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{impact.summary}</p>
      {impact.changes.length ? (
        <dl className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white px-3">
          {impact.changes.map((change) => (
            <div key={change.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5 text-sm">
              <dt className="text-slate-600">{change.label}</dt><dd className="tabular-nums text-slate-500"><span className="sr-only">Before: </span>{change.before}</dd><dd className="font-semibold tabular-nums text-slate-950"><span className="sr-only">After: </span>→ {change.after}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {impact.locationChanges?.length ? (
        <div className="mt-4 space-y-2" aria-label="Location effects">
          {impact.locationChanges.map((change, index) => <p key={`${change.from}-${change.to}-${index}`} className="text-sm text-slate-600"><strong className="font-semibold text-slate-950">{change.quantity} {change.unit ?? "units"}</strong>{change.from ? ` from ${change.from}` : ""}{change.to ? ` to ${change.to}` : ""}</p>)}
        </div>
      ) : null}
      {impact.notes?.map((note) => <BusinessRuleBanner key={note} title="Good to know" severity="info" className="mt-3"><span className="flex items-start gap-2"><InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />{note}</span></BusinessRuleBanner>)}
    </section>
  );
}
