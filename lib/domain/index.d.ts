export type LocationKind =
  | "supplier"
  | "customer"
  | "adjustment"
  | "internal"
  | "receiving"
  | "quarantine"
  | "damaged"
  | "staging"
  | "in_transit"
  | "returns";

export interface LocationRef {
  id: string;
  kind: LocationKind | string;
  countsOnHand?: boolean;
  usable?: boolean;
}

export interface InventoryMovement {
  readonly id: string;
  readonly type: string;
  readonly productId: string;
  readonly quantity: number;
  readonly source: Readonly<LocationRef>;
  readonly destination: Readonly<LocationRef>;
  readonly reference?: Readonly<{ type: string; id: string }>;
}

export interface CommandMeta {
  idempotencyKey: string;
  expectedVersion?: number;
}

export interface CommandResult<TState, TImpact = Record<string, unknown>> {
  state: TState;
  movements: InventoryMovement[];
  impact: TImpact & { replayed: boolean; applied: boolean };
  duplicate: boolean;
}

export interface VersionedAggregate {
  version: number;
  commandLog: Record<
    string,
    {
      fingerprint: string;
      commandName: string;
      impact: Record<string, unknown>;
    }
  >;
}

export class DomainError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export function createMovement(input: {
  id: string;
  type: string;
  productId: string;
  quantity: number;
  source: LocationRef;
  destination: LocationRef;
  reference?: { type: string; id: string };
}): InventoryMovement;

export interface PurchaseOrderLine extends VersionedAggregate {
  kind: "purchase-order-line";
  id: string;
  productId: string;
  warehouseLocationId: string;
  lifecycle: "draft" | "approved" | "canceled";
  effectiveOrderedQuantity: number;
  grossReceivedQuantity: number;
  receiptReversedQuantity: number;
  vendorReturnedQuantity: number;
  notExpectedQuantity: number;
  billedQuantity: number;
  creditedQuantity: number;
  priceOnlyCreditCents: number;
  revision: number;
  expectedDate: string | null;
}

export interface PurchaseOrderQuantities {
  effectiveOrderedQuantity: number;
  grossReceivedQuantity: number;
  receiptReversedQuantity: number;
  vendorReturnedQuantity: number;
  netRetainedQuantity: number;
  notExpectedQuantity: number;
  openToReceiveQuantity: number;
  incomingQuantity: number;
  overReceivedQuantity: number;
  billedQuantity: number;
  creditedQuantity: number;
  fulfillmentStatus:
    | "not_received"
    | "partially_received"
    | "fully_received"
    | "closed_short"
    | "over_received"
    | "canceled";
}

export function createPurchaseOrderLine(input: {
  id: string;
  productId: string;
  orderedQuantity: number;
  warehouseLocationId?: string;
}): PurchaseOrderLine;
export function derivePurchaseOrderQuantities(
  line: PurchaseOrderLine,
): PurchaseOrderQuantities;
export function approvePurchaseOrder(
  line: PurchaseOrderLine,
  command: CommandMeta,
): CommandResult<PurchaseOrderLine>;
export function receivePurchaseOrder(
  line: PurchaseOrderLine,
  command: CommandMeta & {
    quantity: number;
    allowOverReceipt?: boolean;
    movementId?: string;
    supplierLocationId?: string;
    destinationLocationId?: string;
    destinationKind?: LocationKind | string;
  },
): CommandResult<PurchaseOrderLine>;
export function closePurchaseOrderRemainder(
  line: PurchaseOrderLine,
  command: CommandMeta & { quantity?: number; reason: string },
): CommandResult<PurchaseOrderLine>;
export function reopenPurchaseOrderQuantity(
  line: PurchaseOrderLine,
  command: CommandMeta & {
    quantity: number;
    reason: string;
    expectedDate: string;
  },
): CommandResult<PurchaseOrderLine>;
export function reversePurchaseOrderReceipt(
  line: PurchaseOrderLine,
  command: CommandMeta & {
    quantity: number;
    reason: string;
    remainingExpected?: boolean;
    movementId?: string;
    sourceLocationId?: string;
    sourceKind?: LocationKind | string;
    adjustmentLocationId?: string;
  },
): CommandResult<PurchaseOrderLine>;
export function returnToVendor(
  line: PurchaseOrderLine,
  command: CommandMeta & {
    quantity: number;
    reason: string;
    disposition: "replacement" | "refund";
    movementId?: string;
    sourceLocationId?: string;
    sourceKind?: LocationKind | string;
    supplierLocationId?: string;
  },
): CommandResult<PurchaseOrderLine>;
export function postPriceOnlyVendorCredit(
  line: PurchaseOrderLine,
  command: CommandMeta & { amountCents: number; reason: string },
): CommandResult<PurchaseOrderLine>;

export interface InventoryLedger extends VersionedAggregate {
  kind: "inventory-ledger";
  locations: Record<string, Required<LocationRef>>;
  balances: Record<string, Record<string, number>>;
  movements: InventoryMovement[];
}

export function createInventoryLedger(input?: {
  locations?: LocationRef[];
  openingBalances?: Array<{
    productId: string;
    locationId: string;
    quantity: number;
  }>;
}): InventoryLedger;
export function movementBalance(movements: InventoryMovement[]): {
  debits: number;
  credits: number;
  net: number;
  netByProduct: Record<string, number>;
  balanced: boolean;
};
export function getLocationBalance(
  state: InventoryLedger,
  productId: string,
  locationId: string,
): number;
export function getInventoryMetrics(
  state: InventoryLedger,
  productId: string,
  reservedQuantity?: number,
): {
  onHandQuantity: number;
  usableOnHandQuantity: number;
  reservedQuantity: number;
  availableNowQuantity: number;
};
export function postInventoryMovements(
  state: InventoryLedger,
  command: CommandMeta & {
    movements: InventoryMovement[];
    allowNegative?: boolean;
    negativeOverrideReason?: string;
  },
): CommandResult<InventoryLedger>;

export interface InventoryCount extends VersionedAggregate {
  kind: "inventory-count";
  id: string;
  productId: string;
  locationId: string;
  locationKind: LocationKind | string;
  bookQuantity: number;
  countedQuantity: number;
  status: "counted" | "posted";
  postedAdjustmentQuantity: number;
}
export function createInventoryCount(input: {
  id: string;
  productId: string;
  locationId: string;
  bookQuantity: number;
  countedQuantity: number;
  locationKind?: LocationKind | string;
}): InventoryCount;
export function deriveInventoryCount(count: InventoryCount): {
  bookQuantity: number;
  countedQuantity: number;
  varianceQuantity: number;
  status: InventoryCount["status"];
};
export function approveInventoryCount(
  count: InventoryCount,
  command: CommandMeta & {
    reason?: string;
    movementId?: string;
    adjustmentLocationId?: string;
  },
): CommandResult<InventoryCount>;

export interface SalesOrderLine extends VersionedAggregate {
  kind: "sales-order-line";
  id: string;
  productId: string;
  warehouseLocationId: string;
  lifecycle: "draft" | "confirmed" | "canceled";
  orderedQuantity: number;
  grossShippedQuantity: number;
  shipmentReversedQuantity: number;
  canceledRemainderQuantity: number;
  authorizedReplacementQuantity: number;
  returnedQuantity: number;
  reservedQuantity: number;
}
export interface SalesOrderQuantities {
  orderedQuantity: number;
  grossShippedQuantity: number;
  shipmentReversedQuantity: number;
  netShippedQuantity: number;
  canceledRemainderQuantity: number;
  authorizedReplacementQuantity: number;
  returnedQuantity: number;
  reservedQuantity: number;
  openToShipQuantity: number;
  outgoingDemandQuantity: number;
}
export function createSalesOrderLine(input: {
  id: string;
  productId: string;
  orderedQuantity: number;
  warehouseLocationId?: string;
}): SalesOrderLine;
export function deriveSalesOrderQuantities(
  line: SalesOrderLine,
): SalesOrderQuantities;
export function confirmSalesOrder(
  line: SalesOrderLine,
  command: CommandMeta,
): CommandResult<SalesOrderLine>;
export function reserveSalesOrderStock(
  line: SalesOrderLine,
  command: CommandMeta & { quantity: number; availableNowQuantity: number },
): CommandResult<SalesOrderLine>;
export function releaseSalesOrderReservation(
  line: SalesOrderLine,
  command: CommandMeta & { quantity: number; reason: string },
): CommandResult<SalesOrderLine>;
export function shipSalesOrder(
  line: SalesOrderLine,
  command: CommandMeta & {
    quantity: number;
    usableOnHandQuantity: number;
    requireReservation?: boolean;
    allowNegative?: boolean;
    negativeOverrideReason?: string;
    movementId?: string;
    sourceLocationId?: string;
    sourceKind?: LocationKind | string;
    customerLocationId?: string;
  },
): CommandResult<SalesOrderLine>;
export function returnFromCustomer(
  line: SalesOrderLine,
  command: CommandMeta & {
    quantity: number;
    reason: string;
    resolution: "refund" | "replacement";
    movementId?: string;
    customerLocationId?: string;
    destinationLocationId?: string;
    destinationKind?: LocationKind | string;
  },
): CommandResult<SalesOrderLine>;
export function reverseSalesShipment(
  line: SalesOrderLine,
  command: CommandMeta & {
    quantity: number;
    reason: string;
    movementId?: string;
    customerLocationId?: string;
    destinationLocationId?: string;
    destinationKind?: LocationKind | string;
  },
): CommandResult<SalesOrderLine>;

export type ChargeKind =
  | "freight"
  | "fuel_surcharge"
  | "environmental_fee"
  | "handling_fee"
  | "core_charge"
  | "empty_deposit"
  | "returnable_deposit"
  | "customs"
  | "brokerage"
  | "tax"
  | "discount"
  | "other";

export interface FinancialLineInput {
  quantity: number;
  unitAmountCents: number;
  discountCents?: number;
  taxable?: boolean;
  [key: string]: unknown;
}

export interface ChargeInput {
  kind: ChargeKind;
  amountCents: number;
  direction?: "add" | "subtract";
  taxable?: boolean;
  refundable?: boolean;
  [key: string]: unknown;
}

export function calculateDocumentTotals(input: {
  lines?: FinancialLineInput[];
  charges?: ChargeInput[];
  taxRateBps?: number;
}): {
  itemSubtotalCents: number;
  chargeTotalCents: number;
  refundableDepositCents: number;
  taxableSubtotalCents: number;
  taxCents: number;
  subtotalCents: number;
  totalCents: number;
  physicalInventoryDelta: 0;
};

export function evaluateThreeWayMatch(input: {
  purchaseLines?: Array<{ id: string; quantity: number; unitCostCents: number }>;
  receiptLines?: Array<{ purchaseOrderLineId: string; quantity: number }>;
  returnLines?: Array<{ purchaseOrderLineId: string; quantity: number }>;
  billLines?: Array<{ purchaseOrderLineId: string; quantity: number; unitCostCents: number }>;
  billCharges?: Array<{ kind: string; amountCents: number }>;
  tolerances?: { quantity?: number; unitPriceCents?: number; totalCents?: number; allowedChargeKinds?: string[] };
}): {
  status: "matched" | "approval_required" | "blocked";
  payable: boolean;
  authorizedCents: number;
  receivedValueCents: number;
  billedCents: number;
  varianceCents: number;
  exceptions: ReadonlyArray<{ code: string; severity: string; message: string }>;
  physicalInventoryDelta: 0;
};

export interface ReturnableLedger {
  kind: "returnable-ledger";
  balances: Record<string, Record<string, unknown>>;
  events: ReadonlyArray<Record<string, unknown>>;
  auditTrail: ReadonlyArray<Record<string, unknown>>;
  version: number;
  commandLog: Record<string, unknown>;
}

export function createReturnableLedger(): ReturnableLedger;
export function postReturnableEvent(
  state: ReturnableLedger,
  command: CommandMeta & {
    type: "issue_to_partner" | "return_from_partner" | "receive_from_partner" | "return_to_partner" | "forfeit_by_partner" | "forfeit_by_company";
    partnerId: string;
    assetType: string;
    quantity: number;
    unitDepositCents?: number;
    actor: string;
    reason: string;
  },
): CommandResult<ReturnableLedger>;

export interface ApprovalRecord {
  kind: "approval-record";
  entityId: string;
  entityType: string;
  revision: number;
  totalCents: number;
  status: "draft" | "pending_approval" | "approved" | "rejected";
  auditTrail: ReadonlyArray<Record<string, unknown>>;
  version: number;
  commandLog: Record<string, unknown>;
}

export function createApprovalRecord(input: { entityId: string; entityType: string; revision?: number; totalCents?: number }): ApprovalRecord;
export function submitForApproval(state: ApprovalRecord, command: CommandMeta & { actor: string; reason: string }): CommandResult<ApprovalRecord>;
export function decideApproval(state: ApprovalRecord, command: CommandMeta & { actor: string; reason: string; decision: "approved" | "rejected" }): CommandResult<ApprovalRecord>;
export function amendApprovedRecord(state: ApprovalRecord, command: CommandMeta & { actor: string; reason: string; changes: unknown[]; totalCents?: number }): CommandResult<ApprovalRecord>;

export interface ValuationLedger {
  kind: "valuation-ledger";
  method: "fifo" | "average" | "standard";
  standardCostCents: number;
  layers: ReadonlyArray<Record<string, unknown>>;
  quantityOnHand: number;
  inventoryValueCents: number;
  cogsCents: number;
  entries: ReadonlyArray<Record<string, unknown>>;
  auditTrail: ReadonlyArray<Record<string, unknown>>;
  version: number;
  commandLog: Record<string, unknown>;
}

export function createValuationLedger(input?: { method?: "fifo" | "average" | "standard"; standardCostCents?: number }): ValuationLedger;
export function receiveValuation(state: ValuationLedger, command: CommandMeta & { quantity: number; unitCostCents: number; layerId: string; actor: string; reference: string }): CommandResult<ValuationLedger>;
export function issueValuation(state: ValuationLedger, command: CommandMeta & { quantity: number; actor: string; reference: string }): CommandResult<ValuationLedger>;
export function allocateLandedCost(lines: Array<{ id: string; quantity?: number; unitCostCents?: number; weight?: number; volume?: number }>, totalCostCents: number, basis?: "quantity" | "weight" | "volume" | "purchase_value" | "equal"): ReadonlyArray<{ lineId: string; amountCents: number; basis: string; physicalInventoryDelta: 0 }>;
