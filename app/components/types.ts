import type { ReactNode } from "react";

export type Severity = "neutral" | "info" | "success" | "warning" | "blocking";

export type LifecycleCode =
  | "draft"
  | "pending_approval"
  | "approved"
  | "closed"
  | "canceled";

export type FulfillmentCode =
  | "not_started"
  | "partial"
  | "complete"
  | "closed_short"
  | "over_fulfilled"
  | "return_in_progress";

export type BillingCode =
  | "not_billed"
  | "partially_billed"
  | "fully_billed"
  | "credit_expected"
  | "credited";

export interface LabeledStatus<TCode extends string = string> {
  code: TCode;
  label: string;
  severity?: Severity;
}

export interface StatusException {
  code: string;
  label: string;
  severity: "info" | "warning" | "blocking";
  detail?: string;
}

export interface DocumentStatusModel {
  lifecycle: LabeledStatus<LifecycleCode>;
  fulfillment: LabeledStatus<FulfillmentCode>;
  billing: LabeledStatus<BillingCode>;
  exceptions: StatusException[];
}

export interface SourceReference {
  id: string;
  label: string;
  href: string;
  type?: string;
}

export interface QuantityItem {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  tone?: Severity;
  sources: SourceReference[];
}

export interface MetricItem {
  key: string;
  label: string;
  value: number | string;
  detail?: string;
  tone?: Severity;
  href?: string;
  icon?: ReactNode;
}

export interface ImpactChange {
  key: string;
  label: string;
  before: number | string;
  after: number | string;
  delta?: number | string;
  tone?: Severity;
}

export interface ImpactPreviewModel {
  title?: string;
  summary: string;
  inventoryEffect: "increase" | "decrease" | "none";
  changes: ImpactChange[];
  locationChanges?: Array<{
    from?: string;
    to?: string;
    quantity: number | string;
    unit?: string;
  }>;
  notes?: string[];
}

export interface CommandReason {
  code: string;
  message: string;
  resolutionActions?: Array<{ label: string; href?: string }>;
}

export interface CommandPreviewResponse {
  permitted: boolean;
  blockingReasons: CommandReason[];
  warnings: CommandReason[];
  impact: ImpactPreviewModel;
  approvalRequired: boolean;
  currentVersion: number;
}

export interface EntityColumn<T> {
  key: string;
  header: string;
  accessor?: keyof T;
  render?: (row: T) => ReactNode;
  align?: "start" | "center" | "end";
  sortable?: boolean;
  sortHref?: (direction: "asc" | "desc") => string;
  visible?: boolean;
  headerClassName?: string;
  cellClassName?: string;
}

export interface ScanRecord {
  id: string;
  value: string;
  label?: string;
  timestamp: string;
  state: "accepted" | "duplicate" | "invalid";
}

export interface WarehouseTask {
  id: string;
  title: string;
  description: string;
  count?: number;
  href: string;
  priority?: "normal" | "warning" | "urgent";
  icon?: ReactNode;
}

export type ConnectionState = "online" | "offline" | "syncing";
