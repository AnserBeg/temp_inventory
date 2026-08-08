import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const businessPartners = sqliteTable(
  "business_partners",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    partnerType: text("partner_type").notNull(),
    email: text("email"),
    phone: text("phone"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_business_partners_code").on(table.code)]
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
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_products_sku").on(table.sku)]
);

export const locations = sqliteTable(
  "locations",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    locationType: text("location_type").notNull(),
    inventoryStatus: text("inventory_status").notNull().default("usable"),
  },
  (table) => [uniqueIndex("idx_locations_code").on(table.code)]
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
    totalCents: integer("total_cents").notNull(),
    buyerName: text("buyer_name"),
    projectReference: text("project_reference"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_purchase_orders_number").on(table.number),
    index("idx_purchase_orders_vendor_status").on(table.vendorId, table.lifecycleStatus),
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
    configurationSnapshot: text("configuration_snapshot"),
  },
  (table) => [index("idx_purchase_order_lines_order").on(table.purchaseOrderId)]
);

export const receipts = sqliteTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    purchaseOrderId: text("purchase_order_id").notNull(),
    status: text("status").notNull().default("posted"),
    postedAt: text("posted_at").notNull(),
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
    totalCents: integer("total_cents").notNull(),
    ownerName: text("owner_name"),
    projectReference: text("project_reference"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_sales_orders_number").on(table.number),
    index("idx_sales_orders_customer_status").on(table.customerId, table.lifecycleStatus),
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
    configurationSnapshot: text("configuration_snapshot"),
  },
  (table) => [index("idx_sales_order_lines_order").on(table.salesOrderId)]
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
  number: text("number").notNull(),
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
  number: text("number").notNull(),
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
    postedAt: text("posted_at").notNull(),
    postedBy: text("posted_by").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull().default(0),
    currency: text("currency").notNull().default("CAD"),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (table) => [
    index("idx_stock_movements_product_posted").on(table.productId, table.postedAt),
    index("idx_stock_movements_po_line").on(table.purchaseOrderLineId),
    index("idx_stock_movements_so_line").on(table.salesOrderLineId),
    index("idx_stock_movements_source").on(table.sourceDocumentType, table.sourceDocumentId),
    index("idx_stock_movements_reversal").on(table.reversalOfMovementId),
  ]
);

export const inventoryBalances = sqliteTable(
  "inventory_balances",
  {
    productId: text("product_id").notNull(),
    locationId: text("location_id").notNull(),
    onHandQty: real("on_hand_qty").notNull().default(0),
    reservedQty: real("reserved_qty").notNull().default(0),
    version: integer("version").notNull().default(1),
  },
  (table) => [primaryKey({ columns: [table.productId, table.locationId] })]
);

export const inventoryCounts = sqliteTable("inventory_counts", {
  id: text("id").primaryKey(),
  number: text("number").notNull(),
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
  number: text("number").notNull(),
  vendorId: text("vendor_id").notNull(),
  purchaseOrderId: text("purchase_order_id"),
  status: text("status").notNull(),
  matchStatus: text("match_status").notNull(),
  totalCents: integer("total_cents").notNull(),
  dueDate: text("due_date"),
  currency: text("currency").notNull().default("CAD"),
  version: integer("version").notNull().default(1),
});

export const commandLog = sqliteTable("command_log", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  command: text("command").notNull(),
  entityId: text("entity_id").notNull(),
  responseJson: text("response_json").notNull(),
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
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_audit_events_entity_created").on(table.entityType, table.entityId, table.createdAt)]
);
