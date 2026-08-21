import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const businessPartners = sqliteTable(
  "business_partners",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    partnerType: text("partner_type").notNull(),
    email: text("email"),
    phone: text("phone"),
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country").notNull().default("CA"),
    paymentTerms: text("payment_terms"),
    currency: text("currency").notNull().default("CAD"),
    creditLimitCents: integer("credit_limit_cents").notNull().default(0),
    creditHold: integer("credit_hold", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_business_partners_code").on(table.code),
    index("idx_business_partners_active_name").on(table.active, table.name),
  ]
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    sku: text("sku").notNull(),
    manufacturerSku: text("manufacturer_sku"),
    name: text("name").notNull(),
    category: text("category").notNull(),
    material: text("material").notNull(),
    dimensions: text("dimensions").notNull(),
    finish: text("finish").notNull(),
    trackingPolicy: text("tracking_policy").notNull().default("quantity"),
    inventoryPolicy: text("inventory_policy").notNull().default("stocked"),
    standardCostCents: integer("standard_cost_cents").notNull(),
    sellingPriceCents: integer("selling_price_cents").notNull(),
    reorderPoint: real("reorder_point").notNull().default(0),
    baseUomId: text("base_uom_id").notNull().default("uom-each"),
    purchaseUomId: text("purchase_uom_id").notNull().default("uom-each"),
    salesUomId: text("sales_uom_id").notNull().default("uom-each"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_products_sku").on(table.sku),
    index("idx_products_active_name").on(table.active, table.name),
  ]
);

export const locations = sqliteTable(
  "locations",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    locationType: text("location_type").notNull(),
    inventoryStatus: text("inventory_status").notNull().default("usable"),
    warehouseId: text("warehouse_id").notNull().default("warehouse-main"),
    parentLocationId: text("parent_location_id"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("idx_locations_code").on(table.code),
    index("idx_locations_warehouse_status_active").on(table.warehouseId, table.inventoryStatus, table.active),
  ]
);

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    vendorId: text("vendor_id").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull().default("approved"),
    billingStatus: text("billing_status").notNull().default("not_billed"),
    expectedDate: text("expected_date"),
    currency: text("currency").notNull().default("CAD"),
    exchangeRateToBase: real("exchange_rate_to_base").notNull().default(1),
    baseTotalCents: integer("base_total_cents").notNull().default(0),
    paymentTerms: text("payment_terms"),
    dueDate: text("due_date"),
    totalCents: integer("total_cents").notNull(),
    buyerName: text("buyer_name"),
    projectReference: text("project_reference"),
    revisionNumber: integer("revision_number").notNull().default(1),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_purchase_orders_number").on(table.number),
    index("idx_purchase_orders_vendor_status").on(table.vendorId, table.lifecycleStatus),
    index("idx_purchase_orders_status_expected").on(table.lifecycleStatus, table.expectedDate),
  ]
);

export const purchaseOrderLines = sqliteTable(
  "purchase_order_lines",
  {
    id: text("id").primaryKey(),
    purchaseOrderId: text("purchase_order_id").notNull(),
    productId: text("product_id").notNull(),
    orderedQty: real("ordered_qty").notNull(),
    closedQty: real("closed_qty").notNull().default(0),
    unitCostCents: integer("unit_cost_cents").notNull(),
    orderedUomId: text("ordered_uom_id"),
    orderedUomQty: real("ordered_uom_qty"),
    orderedUomUnitCostCents: integer("ordered_uom_unit_cost_cents"),
    configurationSnapshot: text("configuration_snapshot"),
    fulfillmentRoute: text("fulfillment_route").notNull().default("stock"),
    sourceSalesOrderLineId: text("source_sales_order_line_id"),
    discountCents: integer("discount_cents").notNull().default(0),
    taxable: integer("taxable", { mode: "boolean" }).notNull().default(false),
    taxCode: text("tax_code").notNull().default("EXEMPT"),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("idx_purchase_order_lines_order").on(table.purchaseOrderId),
    uniqueIndex("idx_purchase_order_lines_source_sales_line").on(table.sourceSalesOrderLineId),
  ]
);

export const receipts = sqliteTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    purchaseOrderId: text("purchase_order_id").notNull(),
    status: text("status").notNull().default("posted"),
    postedAt: text("posted_at").notNull(),
    /**
     * The carrier or vendor paperwork that arrived with the goods. Receiving is reconciled
     * against that document, and without somewhere to record it the number lived on paper only.
     */
    packingSlipNumber: text("packing_slip_number"),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("idx_receipts_number").on(table.number),
    index("idx_receipts_purchase_order").on(table.purchaseOrderId),
  ]
);

export const receiptLines = sqliteTable(
  "receipt_lines",
  {
    id: text("id").primaryKey(),
    receiptId: text("receipt_id").notNull(),
    purchaseOrderLineId: text("purchase_order_line_id").notNull(),
    productId: text("product_id").notNull(),
    locationId: text("location_id").notNull(),
    quantity: real("quantity").notNull(),
    condition: text("condition").notNull().default("usable"),
  },
  (table) => [index("idx_receipt_lines_receipt").on(table.receiptId)]
);

export const salesOrders = sqliteTable(
  "sales_orders",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    customerId: text("customer_id").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull().default("confirmed"),
    billingStatus: text("billing_status").notNull().default("not_invoiced"),
    requestedDate: text("requested_date"),
    currency: text("currency").notNull().default("CAD"),
    exchangeRateToBase: real("exchange_rate_to_base").notNull().default(1),
    baseTotalCents: integer("base_total_cents").notNull().default(0),
    paymentTerms: text("payment_terms"),
    dueDate: text("due_date"),
    totalCents: integer("total_cents").notNull(),
    ownerName: text("owner_name"),
    projectReference: text("project_reference"),
    shipToName: text("ship_to_name"),
    shipToAddressLine1: text("ship_to_address_line_1"),
    shipToAddressLine2: text("ship_to_address_line_2"),
    shipToCity: text("ship_to_city"),
    shipToRegion: text("ship_to_region"),
    shipToPostalCode: text("ship_to_postal_code"),
    shipToCountry: text("ship_to_country"),
    deliveryInstructions: text("delivery_instructions"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_sales_orders_number").on(table.number),
    index("idx_sales_orders_customer_status").on(table.customerId, table.lifecycleStatus),
    index("idx_sales_orders_status_requested").on(table.lifecycleStatus, table.requestedDate),
  ]
);

export const salesOrderLines = sqliteTable(
  "sales_order_lines",
  {
    id: text("id").primaryKey(),
    salesOrderId: text("sales_order_id").notNull(),
    productId: text("product_id").notNull(),
    orderedQty: real("ordered_qty").notNull(),
    canceledQty: real("canceled_qty").notNull().default(0),
    unitPriceCents: integer("unit_price_cents").notNull(),
    orderedUomId: text("ordered_uom_id"),
    orderedUomQty: real("ordered_uom_qty"),
    orderedUomUnitPriceCents: integer("ordered_uom_unit_price_cents"),
    configurationSnapshot: text("configuration_snapshot"),
    fulfillmentRoute: text("fulfillment_route").notNull().default("stock"),
    projectReference: text("project_reference"),
    linkedPurchaseOrderLineId: text("linked_purchase_order_line_id"),
    discountCents: integer("discount_cents").notNull().default(0),
    taxable: integer("taxable", { mode: "boolean" }).notNull().default(true),
    taxCode: text("tax_code").notNull().default("EXEMPT"),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
  },
  (table) => [index("idx_sales_order_lines_order").on(table.salesOrderId)]
);

export const dropShipDeliveries = sqliteTable(
  "drop_ship_deliveries",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    purchaseOrderId: text("purchase_order_id").notNull().references(() => purchaseOrders.id),
    purchaseOrderLineId: text("purchase_order_line_id").notNull().references(() => purchaseOrderLines.id),
    salesOrderId: text("sales_order_id").notNull().references(() => salesOrders.id),
    salesOrderLineId: text("sales_order_line_id").notNull().references(() => salesOrderLines.id),
    productId: text("product_id").notNull().references(() => products.id),
    quantity: real("quantity").notNull(),
    reversedQty: real("reversed_qty").notNull().default(0),
    status: text("status").notNull().default("posted"),
    deliveryDate: text("delivery_date").notNull(),
    externalReference: text("external_reference").notNull(),
    postedAt: text("posted_at").notNull(),
    postedBy: text("posted_by").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("idx_drop_ship_deliveries_number").on(table.number),
    index("idx_drop_ship_deliveries_purchase_line").on(table.purchaseOrderLineId, table.status),
    index("idx_drop_ship_deliveries_sales_line").on(table.salesOrderLineId, table.status),
    check("drop_ship_delivery_quantity_check", sql`${table.quantity} > 0`),
    check("drop_ship_delivery_reversed_quantity_check", sql`${table.reversedQty} >= 0 AND ${table.reversedQty} <= ${table.quantity}`),
  ]
);

export const reservations = sqliteTable(
  "reservations",
  {
    id: text("id").primaryKey(),
    salesOrderLineId: text("sales_order_line_id").notNull(),
    productId: text("product_id").notNull(),
    locationId: text("location_id").notNull(),
    quantity: real("quantity").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_reservations_line_status").on(table.salesOrderLineId, table.status),
    index("idx_reservations_product_location_status").on(table.productId, table.locationId, table.status),
  ]
);

export const shipments = sqliteTable(
  "shipments",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    salesOrderId: text("sales_order_id").notNull(),
    status: text("status").notNull().default("posted"),
    carrier: text("carrier"),
    serviceLevel: text("service_level"),
    trackingNumber: text("tracking_number"),
    billOfLadingNumber: text("bill_of_lading_number"),
    shipToName: text("ship_to_name"),
    shipToAddressLine1: text("ship_to_address_line_1"),
    shipToAddressLine2: text("ship_to_address_line_2"),
    shipToCity: text("ship_to_city"),
    shipToRegion: text("ship_to_region"),
    shipToPostalCode: text("ship_to_postal_code"),
    shipToCountry: text("ship_to_country"),
    postedAt: text("posted_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("idx_shipments_number").on(table.number),
    index("idx_shipments_sales_order").on(table.salesOrderId),
  ]
);

export const shipmentLines = sqliteTable(
  "shipment_lines",
  {
    id: text("id").primaryKey(),
    shipmentId: text("shipment_id").notNull(),
    salesOrderLineId: text("sales_order_line_id").notNull(),
    productId: text("product_id").notNull(),
    locationId: text("location_id").notNull(),
    quantity: real("quantity").notNull(),
  },
  (table) => [index("idx_shipment_lines_shipment").on(table.shipmentId)]
);

export const vendorReturns = sqliteTable("vendor_returns", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  purchaseOrderId: text("purchase_order_id").notNull(),
  purchaseOrderLineId: text("purchase_order_line_id").notNull(),
  productId: text("product_id").notNull(),
  locationId: text("location_id").notNull(),
  quantity: real("quantity").notNull(),
  disposition: text("disposition").notNull(),
  postedAt: text("posted_at").notNull(),
});

export const customerReturns = sqliteTable("customer_returns", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  salesOrderId: text("sales_order_id").notNull(),
  salesOrderLineId: text("sales_order_line_id").notNull(),
  productId: text("product_id").notNull(),
  locationId: text("location_id").notNull(),
  quantity: real("quantity").notNull(),
  condition: text("condition").notNull(),
  financialResolution: text("financial_resolution").notNull().default("pending"),
  postedAt: text("posted_at").notNull(),
});

export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: text("id").primaryKey(),
    movementType: text("movement_type").notNull(),
    productId: text("product_id").notNull(),
    quantity: real("quantity").notNull(),
    fromLocationId: text("from_location_id"),
    toLocationId: text("to_location_id"),
    inventoryStatus: text("inventory_status").notNull(),
    sourceDocumentType: text("source_document_type").notNull(),
    sourceDocumentId: text("source_document_id").notNull(),
    sourceLineId: text("source_line_id"),
    purchaseOrderLineId: text("purchase_order_line_id"),
    salesOrderLineId: text("sales_order_line_id"),
    reversalOfMovementId: text("reversal_of_movement_id"),
    lotId: text("lot_id"),
    inventoryUnitId: text("inventory_unit_id"),
    postedAt: text("posted_at").notNull(),
    postedBy: text("posted_by").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull().default(0),
    currency: text("currency").notNull().default("CAD"),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (table) => [
    index("idx_stock_movements_product_posted").on(table.productId, table.postedAt),
    index("idx_stock_movements_posted").on(table.postedAt),
    index("idx_stock_movements_po_line").on(table.purchaseOrderLineId),
    index("idx_stock_movements_so_line").on(table.salesOrderLineId),
    index("idx_stock_movements_source").on(table.sourceDocumentType, table.sourceDocumentId),
    index("idx_stock_movements_reversal").on(table.reversalOfMovementId),
  ]
);

export const inventoryBalances = sqliteTable(
  "inventory_balances",
  {
    productId: text("product_id").notNull().references(() => products.id),
    locationId: text("location_id").notNull().references(() => locations.id),
    onHandQty: real("on_hand_qty").notNull().default(0),
    reservedQty: real("reserved_qty").notNull().default(0),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.locationId] }),
    check("inventory_balances_on_hand_check", sql`${table.onHandQty} >= 0`),
    check("inventory_balances_reserved_check", sql`${table.reservedQty} >= 0 AND ${table.reservedQty} <= ${table.onHandQty}`),
  ]
);

export const inventoryCounts = sqliteTable("inventory_counts", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  productId: text("product_id").notNull(),
  locationId: text("location_id").notNull(),
  recordedQty: real("recorded_qty").notNull(),
  countedQty: real("counted_qty").notNull(),
  varianceQty: real("variance_qty").notNull(),
  status: text("status").notNull().default("posted"),
  reason: text("reason").notNull(),
  countedAt: text("counted_at").notNull(),
  countedBy: text("counted_by").notNull(),
});

export const vendorBills = sqliteTable("vendor_bills", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  vendorId: text("vendor_id").notNull(),
  purchaseOrderId: text("purchase_order_id"),
  status: text("status").notNull(),
  matchStatus: text("match_status").notNull(),
  totalCents: integer("total_cents").notNull(),
  dueDate: text("due_date"),
  currency: text("currency").notNull().default("CAD"),
  vendorInvoiceNumber: text("vendor_invoice_number"),
  invoiceDate: text("invoice_date"),
  postedAt: text("posted_at"),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  paidCents: integer("paid_cents").notNull().default(0),
  holdReason: text("hold_reason"),
  approvedAt: text("approved_at"),
  approvedBy: text("approved_by"),
  exchangeRateToBase: real("exchange_rate_to_base").notNull().default(1),
  baseTotalCents: integer("base_total_cents").notNull().default(0),
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  taxCode: text("tax_code"),
  paymentTerms: text("payment_terms"),
  version: integer("version").notNull().default(1),
}, (table) => [
  uniqueIndex("idx_vendor_bills_vendor_invoice").on(table.vendorId, table.vendorInvoiceNumber),
  index("idx_vendor_bills_status_due").on(table.status, table.dueDate),
]);

export const commandLog = sqliteTable("command_log", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  command: text("command").notNull(),
  entityId: text("entity_id").notNull(),
  responseJson: text("response_json").notNull(),
  requestHash: text("request_hash"),
  claimToken: text("claim_token"),
  createdAt: text("created_at").notNull(),
});

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    summary: text("summary").notNull(),
    actor: text("actor").notNull(),
    actorId: text("actor_id"),
    actorEmail: text("actor_email"),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_audit_events_entity_created").on(table.entityType, table.entityId, table.createdAt),
    index("idx_audit_events_action_created").on(table.action, table.createdAt),
  ]
);

export const appUsers = sqliteTable("app_users", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  role: text("role").notNull().default("viewer"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [check("app_users_role_check", sql`${table.role} IN ('viewer','operator','accounting','manager','administrator')`)]);

export const purchaseOrderRevisions = sqliteTable(
  "purchase_order_revisions",
  {
    id: text("id").primaryKey(),
    purchaseOrderId: text("purchase_order_id").notNull().references(() => purchaseOrders.id),
    revisionNumber: integer("revision_number").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    reason: text("reason").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_po_revisions_order_number").on(table.purchaseOrderId, table.revisionNumber)]
);

export const systemSettings = sqliteTable("system_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  description: text("description").notNull(),
  version: integer("version").notNull().default(1),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    requestType: text("request_type").notNull(),
    status: text("status").notNull().default("pending"),
    requestedBy: text("requested_by").notNull(),
    requestedReason: text("requested_reason").notNull(),
    requestedAt: text("requested_at").notNull(),
    decidedBy: text("decided_by"),
    decisionReason: text("decision_reason"),
    decidedAt: text("decided_at"),
    consumedAt: text("consumed_at"),
    consumedBy: text("consumed_by"),
    consumedEntityId: text("consumed_entity_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("idx_approvals_entity_status").on(table.entityType, table.entityId, table.status),
    check("approvals_status_check", sql`${table.status} IN ('pending','approved','rejected','canceled')`),
  ]
);

export const periodLocks = sqliteTable("period_locks", {
  id: text("id").primaryKey(),
  module: text("module").notNull(),
  lockedThrough: text("locked_through").notNull(),
  reason: text("reason").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const inventoryLots = sqliteTable(
  "inventory_lots",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => products.id),
    lotNumber: text("lot_number").notNull(),
    vendorId: text("vendor_id"),
    manufacturedDate: text("manufactured_date"),
    expiryDate: text("expiry_date"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_inventory_lots_product_number").on(table.productId, table.lotNumber)]
);

export const inventoryUnits = sqliteTable(
  "inventory_units",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => products.id),
    serialNumber: text("serial_number").notNull(),
    lotId: text("lot_id").references(() => inventoryLots.id),
    locationId: text("location_id").notNull().references(() => locations.id),
    inventoryStatus: text("inventory_status").notNull().default("usable"),
    lifecycleStatus: text("lifecycle_status").notNull().default("on_hand"),
    allocatedSalesOrderLineId: text("allocated_sales_order_line_id"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_inventory_units_product_serial").on(table.productId, table.serialNumber)]
);

export const movementAssignments = sqliteTable(
  "movement_assignments",
  {
    id: text("id").primaryKey(),
    movementId: text("movement_id").notNull().references(() => stockMovements.id),
    lotId: text("lot_id").references(() => inventoryLots.id),
    inventoryUnitId: text("inventory_unit_id").references(() => inventoryUnits.id),
    quantity: real("quantity").notNull(),
  },
  (table) => [
    index("idx_movement_assignments_movement").on(table.movementId),
    check("movement_assignment_quantity_check", sql`${table.quantity} > 0`),
  ]
);

export const documentCharges = sqliteTable(
  "document_charges",
  {
    id: text("id").primaryKey(),
    documentType: text("document_type").notNull(),
    documentId: text("document_id").notNull(),
    chargeType: text("charge_type").notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    direction: text("direction").notNull().default("add"),
    taxable: integer("taxable", { mode: "boolean" }).notNull().default(false),
    refundable: integer("refundable", { mode: "boolean" }).notNull().default(false),
    taxCode: text("tax_code"),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    taxAmountCents: integer("tax_amount_cents").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_document_charges_document").on(table.documentType, table.documentId),
    check("document_charge_amount_check", sql`${table.amountCents} >= 0`),
    check("document_charge_direction_check", sql`${table.direction} IN ('add','subtract')`),
  ]
);

export const vendorBillLines = sqliteTable(
  "vendor_bill_lines",
  {
    id: text("id").primaryKey(),
    vendorBillId: text("vendor_bill_id").notNull().references(() => vendorBills.id),
    purchaseOrderLineId: text("purchase_order_line_id").references(() => purchaseOrderLines.id),
    productId: text("product_id").references(() => products.id),
    quantity: real("quantity").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
    matchStatus: text("match_status").notNull(),
    matchDetailsJson: text("match_details_json").notNull().default("{}"),
  },
  (table) => [index("idx_vendor_bill_lines_bill").on(table.vendorBillId)]
);

export const vendorCredits = sqliteTable("vendor_credits", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  vendorId: text("vendor_id").notNull(),
  vendorBillId: text("vendor_bill_id").references(() => vendorBills.id),
  purchaseOrderId: text("purchase_order_id").references(() => purchaseOrders.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("posted"),
  postedAt: text("posted_at").notNull(),
  postedBy: text("posted_by").notNull(),
  version: integer("version").notNull().default(1),
  currency: text("currency").notNull().default("CAD"),
  exchangeRateToBase: real("exchange_rate_to_base").notNull().default(1),
  baseAmountCents: integer("base_amount_cents").notNull().default(0),
});

export const customerInvoices = sqliteTable(
  "customer_invoices",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    customerId: text("customer_id").notNull(),
    salesOrderId: text("sales_order_id").references(() => salesOrders.id),
    status: text("status").notNull().default("posted"),
    invoiceDate: text("invoice_date").notNull(),
    dueDate: text("due_date").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    paidCents: integer("paid_cents").notNull().default(0),
    currency: text("currency").notNull().default("CAD"),
    exchangeRateToBase: real("exchange_rate_to_base").notNull().default(1),
    baseTotalCents: integer("base_total_cents").notNull().default(0),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    taxCode: text("tax_code"),
    paymentTerms: text("payment_terms"),
    postedAt: text("posted_at").notNull(),
    postedBy: text("posted_by").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("idx_customer_invoices_number").on(table.number),
    index("idx_customer_invoices_status_due").on(table.status, table.dueDate),
  ]
);

export const customerInvoiceLines = sqliteTable(
  "customer_invoice_lines",
  {
    id: text("id").primaryKey(),
    customerInvoiceId: text("customer_invoice_id").notNull().references(() => customerInvoices.id),
    salesOrderLineId: text("sales_order_line_id").notNull().references(() => salesOrderLines.id),
    productId: text("product_id").notNull().references(() => products.id),
    quantity: real("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
  },
  (table) => [index("idx_customer_invoice_lines_invoice").on(table.customerInvoiceId)]
);

export const customerCredits = sqliteTable("customer_credits", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  customerId: text("customer_id").notNull(),
  customerInvoiceId: text("customer_invoice_id").references(() => customerInvoices.id),
  salesOrderId: text("sales_order_id").references(() => salesOrders.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("posted"),
  postedAt: text("posted_at").notNull(),
  postedBy: text("posted_by").notNull(),
  version: integer("version").notNull().default(1),
  currency: text("currency").notNull().default("CAD"),
  exchangeRateToBase: real("exchange_rate_to_base").notNull().default(1),
  baseAmountCents: integer("base_amount_cents").notNull().default(0),
});

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    direction: text("direction").notNull(),
    partnerId: text("partner_id").notNull(),
    documentType: text("document_type").notNull(),
    documentId: text("document_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    paymentDate: text("payment_date").notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    postedAt: text("posted_at").notNull(),
    postedBy: text("posted_by").notNull(),
    currency: text("currency").notNull().default("CAD"),
    exchangeRateToBase: real("exchange_rate_to_base").notNull().default(1),
    baseAmountCents: integer("base_amount_cents").notNull().default(0),
  },
  (table) => [uniqueIndex("idx_payments_number").on(table.number)]
);

export const returnableAssetTypes = sqliteTable("returnable_asset_types", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  assetClass: text("asset_class").notNull(),
  unitDepositCents: integer("unit_deposit_cents").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const returnableObligations = sqliteTable(
  "returnable_obligations",
  {
    id: text("id").primaryKey(),
    partnerId: text("partner_id").notNull(),
    assetTypeId: text("asset_type_id").notNull().references(() => returnableAssetTypes.id),
    direction: text("direction").notNull(),
    issuedQty: real("issued_qty").notNull().default(0),
    returnedQty: real("returned_qty").notNull().default(0),
    forfeitedQty: real("forfeited_qty").notNull().default(0),
    depositChargedCents: integer("deposit_charged_cents").notNull().default(0),
    depositRefundedCents: integer("deposit_refunded_cents").notNull().default(0),
    status: text("status").notNull().default("open"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_returnable_obligations_partner_status").on(table.partnerId, table.status)]
);

export const returnableEvents = sqliteTable("returnable_events", {
  id: text("id").primaryKey(),
  obligationId: text("obligation_id").notNull().references(() => returnableObligations.id),
  eventType: text("event_type").notNull(),
  quantity: real("quantity").notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
  reason: text("reason").notNull(),
  postedAt: text("posted_at").notNull(),
  postedBy: text("posted_by").notNull(),
});

export const valuationPolicies = sqliteTable("valuation_policies", {
  productId: text("product_id").primaryKey().references(() => products.id),
  method: text("method").notNull().default("fifo"),
  standardCostCents: integer("standard_cost_cents").notNull().default(0),
  averageCostCents: integer("average_cost_cents").notNull().default(0),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
}, (table) => [check("valuation_method_check", sql`${table.method} IN ('fifo','average','standard')`)]);

export const costLayers = sqliteTable(
  "cost_layers",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => products.id),
    receiptMovementId: text("receipt_movement_id").references(() => stockMovements.id),
    receivedQty: real("received_qty").notNull(),
    remainingQty: real("remaining_qty").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    landedCostCents: integer("landed_cost_cents").notNull().default(0),
    receivedAt: text("received_at").notNull(),
    status: text("status").notNull().default("open"),
  },
  (table) => [index("idx_cost_layers_product_received").on(table.productId, table.receivedAt)]
);

export const inventoryValueEntries = sqliteTable(
  "inventory_value_entries",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => products.id),
    movementId: text("movement_id").references(() => stockMovements.id),
    entryType: text("entry_type").notNull(),
    quantity: real("quantity").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    valueCents: integer("value_cents").notNull(),
    costMethod: text("cost_method").notNull(),
    referenceType: text("reference_type").notNull(),
    referenceId: text("reference_id").notNull(),
    postedAt: text("posted_at").notNull(),
    postedBy: text("posted_by").notNull(),
  },
  (table) => [index("idx_value_entries_product_posted").on(table.productId, table.postedAt)]
);

export const landedCostAllocations = sqliteTable("landed_cost_allocations", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  sourceDocumentType: text("source_document_type").notNull(),
  sourceDocumentId: text("source_document_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  allocationBasis: text("allocation_basis").notNull(),
  postedAt: text("posted_at").notNull(),
  postedBy: text("posted_by").notNull(),
});

export const landedCostAllocationLines = sqliteTable("landed_cost_allocation_lines", {
  id: text("id").primaryKey(),
  allocationId: text("allocation_id").notNull().references(() => landedCostAllocations.id),
  costLayerId: text("cost_layer_id").notNull().references(() => costLayers.id),
  allocatedCents: integer("allocated_cents").notNull(),
});

export const outboxEvents = sqliteTable(
  "outbox_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: text("available_at").notNull(),
    lockedAt: text("locked_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    processedAt: text("processed_at"),
  },
  (table) => [
    index("idx_outbox_status_available").on(table.status, table.availableAt),
    check("outbox_status_check", sql`${table.status} IN ('pending','processing','processed','failed')`),
  ]
);

/**
 * One authorized QuickBooks company connection. Tokens are encrypted by the application
 * before they reach D1; the encryption key is a Worker secret and is never stored here.
 */
export const qboConnections = sqliteTable(
  "qbo_connections",
  {
    id: text("id").primaryKey(),
    realmId: text("realm_id").notNull(),
    environment: text("environment").notNull().default("sandbox"),
    status: text("status").notNull().default("connected"),
    companyName: text("company_name").notNull().default("QuickBooks company"),
    country: text("country").notNull().default("CA"),
    homeCurrency: text("home_currency").notNull().default("CAD"),
    scopes: text("scopes").notNull().default("com.intuit.quickbooks.accounting"),
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    accessTokenExpiresAt: text("access_token_expires_at").notNull(),
    refreshTokenExpiresAt: text("refresh_token_expires_at"),
    syncFrom: text("sync_from").notNull(),
    initialSyncStatus: text("initial_sync_status").notNull().default("not_started"),
    tokenLockOwner: text("token_lock_owner"),
    tokenLockUntil: text("token_lock_until"),
    connectedBy: text("connected_by").notNull(),
    connectedAt: text("connected_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    disconnectedAt: text("disconnected_at"),
    lastError: text("last_error"),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("idx_qbo_connections_realm").on(table.realmId),
    index("idx_qbo_connections_status").on(table.status),
    check("qbo_connection_environment_check", sql`${table.environment} IN ('sandbox','production')`),
    check("qbo_connection_status_check", sql`${table.status} IN ('connected','disconnected','error','reauthorization_required')`),
    check("qbo_initial_sync_status_check", sql`${table.initialSyncStatus} IN ('not_started','queued','running','completed','failed')`),
  ]
);

/** Short-lived, one-use OAuth state records bind callbacks to an authenticated administrator. */
export const qboOauthStates = sqliteTable(
  "qbo_oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    actorId: text("actor_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    environment: text("environment").notNull(),
    returnTo: text("return_to").notNull().default("/"),
    syncFrom: text("sync_from").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
  },
  (table) => [
    index("idx_qbo_oauth_states_expires").on(table.expiresAt),
    check("qbo_oauth_state_environment_check", sql`${table.environment} IN ('sandbox','production')`),
  ]
);

/** Logical PaneFlow accounting roles are mapped to immutable QBO Account IDs, never names. */
export const qboAccountMappings = sqliteTable(
  "qbo_account_mappings",
  {
    connectionId: text("connection_id").notNull().references(() => qboConnections.id),
    logicalKey: text("logical_key").notNull(),
    qboAccountId: text("qbo_account_id").notNull(),
    qboAccountName: text("qbo_account_name").notNull(),
    qboAccountType: text("qbo_account_type").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    updatedBy: text("updated_by").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.logicalKey] }),
    index("idx_qbo_account_mappings_account").on(table.connectionId, table.qboAccountId),
  ]
);

/** Tax codes, terms, payment methods, and other QBO-owned reference lists. */
export const qboReferenceMappings = sqliteTable(
  "qbo_reference_mappings",
  {
    connectionId: text("connection_id").notNull().references(() => qboConnections.id),
    mappingType: text("mapping_type").notNull(),
    localValue: text("local_value").notNull(),
    qboEntityId: text("qbo_entity_id").notNull(),
    qboEntityName: text("qbo_entity_name").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    updatedBy: text("updated_by").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.mappingType, table.localValue] }),
    index("idx_qbo_reference_mappings_entity").on(table.connectionId, table.mappingType, table.qboEntityId),
  ]
);

/** Stable cross-system identity and optimistic-concurrency metadata. */
export const qboEntityLinks = sqliteTable(
  "qbo_entity_links",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull().references(() => qboConnections.id),
    localEntityType: text("local_entity_type").notNull(),
    localEntityId: text("local_entity_id").notNull(),
    qboEntityType: text("qbo_entity_type").notNull(),
    qboEntityId: text("qbo_entity_id").notNull(),
    qboSyncToken: text("qbo_sync_token").notNull().default("0"),
    localVersion: integer("local_version"),
    sourceHash: text("source_hash"),
    qboLastUpdatedAt: text("qbo_last_updated_at"),
    status: text("status").notNull().default("synced"),
    lastSyncedAt: text("last_synced_at").notNull(),
    lastError: text("last_error"),
  },
  (table) => [
    uniqueIndex("idx_qbo_entity_links_local").on(table.connectionId, table.localEntityType, table.localEntityId, table.qboEntityType),
    uniqueIndex("idx_qbo_entity_links_remote").on(table.connectionId, table.qboEntityType, table.qboEntityId),
    index("idx_qbo_entity_links_status").on(table.connectionId, table.status),
    check("qbo_entity_link_status_check", sql`${table.status} IN ('synced','conflict','inactive','deleted','error')`),
  ]
);

/** Per-destination delivery state. It is separate from the generic outbox so one integration
 * cannot mark another destination's delivery complete. */
export const qboSyncDeliveries = sqliteTable(
  "qbo_sync_deliveries",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull().references(() => qboConnections.id),
    outboxEventId: text("outbox_event_id").references(() => outboxEvents.id),
    dedupeKey: text("dedupe_key").notNull(),
    localEntityType: text("local_entity_type").notNull(),
    localEntityId: text("local_entity_id").notNull(),
    operation: text("operation").notNull().default("upsert"),
    sourceVersion: integer("source_version"),
    payloadJson: text("payload_json").notNull().default("{}"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: text("available_at").notNull(),
    lockedAt: text("locked_at"),
    lastErrorCode: text("last_error_code"),
    lastError: text("last_error"),
    qboEntityType: text("qbo_entity_type"),
    qboEntityId: text("qbo_entity_id"),
    requestHash: text("request_hash"),
    createdAt: text("created_at").notNull(),
    processedAt: text("processed_at"),
  },
  (table) => [
    uniqueIndex("idx_qbo_sync_deliveries_dedupe").on(table.connectionId, table.dedupeKey),
    index("idx_qbo_sync_deliveries_claim").on(table.connectionId, table.status, table.availableAt),
    index("idx_qbo_sync_deliveries_entity").on(table.connectionId, table.localEntityType, table.localEntityId),
    check("qbo_sync_delivery_operation_check", sql`${table.operation} IN ('upsert','void','deactivate','reconcile')`),
    check("qbo_sync_delivery_status_check", sql`${table.status} IN ('pending','processing','succeeded','failed','conflict','canceled')`),
  ]
);

/** Verified QBO webhook notifications are durable before any API readback is attempted. */
export const qboWebhookEvents = sqliteTable(
  "qbo_webhook_events",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").references(() => qboConnections.id),
    realmId: text("realm_id").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: text("created_at").notNull(),
    processedAt: text("processed_at"),
    lastError: text("last_error"),
  },
  (table) => [
    uniqueIndex("idx_qbo_webhook_events_payload").on(table.realmId, table.payloadSha256),
    index("idx_qbo_webhook_events_status").on(table.status, table.createdAt),
    check("qbo_webhook_status_check", sql`${table.status} IN ('pending','processing','processed','failed','ignored')`),
  ]
);

export const qboSyncCursors = sqliteTable(
  "qbo_sync_cursors",
  {
    connectionId: text("connection_id").notNull().references(() => qboConnections.id),
    entityType: text("entity_type").notNull(),
    lastChangedAt: text("last_changed_at").notNull(),
    lastCheckedAt: text("last_checked_at").notNull(),
    lastError: text("last_error"),
  },
  (table) => [primaryKey({ columns: [table.connectionId, table.entityType] })]
);

export const qboReconciliationRuns = sqliteTable(
  "qbo_reconciliation_runs",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull().references(() => qboConnections.id),
    status: text("status").notNull().default("running"),
    checkedCount: integer("checked_count").notNull().default(0),
    matchedCount: integer("matched_count").notNull().default(0),
    conflictCount: integer("conflict_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    summaryJson: text("summary_json").notNull().default("{}"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    lastError: text("last_error"),
  },
  (table) => [
    index("idx_qbo_reconciliation_runs_started").on(table.connectionId, table.startedAt),
    check("qbo_reconciliation_status_check", sql`${table.status} IN ('running','completed','failed')`),
  ]
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    documentType: text("document_type").notNull(),
    documentId: text("document_id").notNull(),
    fileName: text("file_name").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    category: text("category").notNull().default("document"),
    ownerId: text("owner_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    uploadedAt: text("uploaded_at").notNull(),
    deletedAt: text("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("idx_attachments_object_key").on(table.objectKey),
    index("idx_attachments_document").on(table.documentType, table.documentId, table.deletedAt),
  ]
);

export const warehouses = sqliteTable("warehouses", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const unitsOfMeasure = sqliteTable("units_of_measure", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  dimension: text("dimension").notNull().default("quantity"),
  precision: integer("precision").notNull().default(3),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const uomConversions = sqliteTable(
  "uom_conversions",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").references(() => products.id),
    fromUomId: text("from_uom_id").notNull().references(() => unitsOfMeasure.id),
    toUomId: text("to_uom_id").notNull().references(() => unitsOfMeasure.id),
    numerator: integer("numerator").notNull(),
    denominator: integer("denominator").notNull(),
    roundingMode: text("rounding_mode").notNull().default("nearest"),
  },
  (table) => [
    uniqueIndex("idx_uom_conversion_scope").on(table.productId, table.fromUomId, table.toUomId),
    check("uom_conversion_positive_check", sql`${table.numerator} > 0 AND ${table.denominator} > 0`),
  ]
);

export const priceLists = sqliteTable(
  "price_lists",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    currency: text("currency").notNull().default("CAD"),
    priority: integer("priority").notNull().default(0),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_price_lists_code").on(table.code),
    index("idx_price_lists_active_priority").on(table.active, table.priority),
  ]
);

export const priceListAssignments = sqliteTable(
  "price_list_assignments",
  {
    id: text("id").primaryKey(),
    priceListId: text("price_list_id").notNull().references(() => priceLists.id),
    partnerId: text("partner_id").notNull().references(() => businessPartners.id),
    priority: integer("priority").notNull().default(0),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_price_list_assignments_list_partner").on(table.priceListId, table.partnerId),
    index("idx_price_list_assignments_partner_active").on(table.partnerId, table.active, table.priority),
  ]
);

export const priceListEntries = sqliteTable(
  "price_list_entries",
  {
    id: text("id").primaryKey(),
    priceListId: text("price_list_id").notNull().references(() => priceLists.id),
    productId: text("product_id").notNull().references(() => products.id),
    uomId: text("uom_id").notNull().references(() => unitsOfMeasure.id),
    minimumQuantity: real("minimum_quantity").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull(),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_price_list_entries_scope").on(table.priceListId, table.productId, table.uomId, table.minimumQuantity),
    index("idx_price_list_entries_lookup").on(table.productId, table.uomId, table.active, table.minimumQuantity),
    check("price_list_entry_quantity_check", sql`${table.minimumQuantity} > 0`),
    check("price_list_entry_price_check", sql`${table.unitPriceCents} >= 0`),
  ]
);

export const inventoryTransfers = sqliteTable("inventory_transfers", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  transferType: text("transfer_type").notNull(),
  status: text("status").notNull().default("posted"),
  fromWarehouseId: text("from_warehouse_id").notNull().references(() => warehouses.id),
  toWarehouseId: text("to_warehouse_id").notNull().references(() => warehouses.id),
  inTransitLocationId: text("in_transit_location_id").references(() => locations.id),
  postedAt: text("posted_at").notNull(),
  postedBy: text("posted_by").notNull(),
  version: integer("version").notNull().default(1),
}, (table) => [check("inventory_transfer_type_check", sql`${table.transferType} IN ('intra_warehouse','inter_warehouse')`)]);

export const inventoryTransferLines = sqliteTable("inventory_transfer_lines", {
  id: text("id").primaryKey(),
  transferId: text("transfer_id").notNull().references(() => inventoryTransfers.id),
  productId: text("product_id").notNull().references(() => products.id),
  fromLocationId: text("from_location_id").notNull().references(() => locations.id),
  toLocationId: text("to_location_id").notNull().references(() => locations.id),
  quantity: real("quantity").notNull(),
  receivedQty: real("received_qty").notNull().default(0),
  lotId: text("lot_id").references(() => inventoryLots.id),
  inventoryUnitId: text("inventory_unit_id").references(() => inventoryUnits.id),
});

/**
 * Monotonic per-prefix counters so operational documents get short sequential numbers
 * (SO-000142) instead of random suffixes that nobody can read over the phone.
 */
export const documentSequences = sqliteTable("document_sequences", {
  prefix: text("prefix").primaryKey(),
  nextValue: integer("next_value").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Ship-to address book. Distributors deliver the same customer's orders to many job
 * sites, so addresses belong to the partner rather than being retyped per order.
 */
export const partnerAddresses = sqliteTable(
  "partner_addresses",
  {
    id: text("id").primaryKey(),
    partnerId: text("partner_id").notNull().references(() => businessPartners.id),
    label: text("label").notNull(),
    contactName: text("contact_name"),
    addressLine1: text("address_line_1").notNull(),
    addressLine2: text("address_line_2"),
    city: text("city").notNull(),
    region: text("region").notNull(),
    postalCode: text("postal_code").notNull(),
    country: text("country").notNull().default("CA"),
    deliveryInstructions: text("delivery_instructions"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_partner_addresses_label").on(table.partnerId, table.label),
    index("idx_partner_addresses_partner_active").on(table.partnerId, table.active, table.isDefault),
  ]
);
