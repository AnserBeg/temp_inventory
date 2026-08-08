CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`actor` text NOT NULL,
	`metadata_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_entity_created` ON `audit_events` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `business_partners` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`partner_type` text NOT NULL,
	`email` text,
	`phone` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_business_partners_code` ON `business_partners` (`code`);--> statement-breakpoint
CREATE TABLE `command_log` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`command` text NOT NULL,
	`entity_id` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customer_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`sales_order_id` text NOT NULL,
	`sales_order_line_id` text NOT NULL,
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`quantity` real NOT NULL,
	`condition` text NOT NULL,
	`financial_resolution` text DEFAULT 'pending' NOT NULL,
	`posted_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_balances` (
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`on_hand_qty` real DEFAULT 0 NOT NULL,
	`reserved_qty` real DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`product_id`, `location_id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_counts` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`recorded_qty` real NOT NULL,
	`counted_qty` real NOT NULL,
	`variance_qty` real NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`reason` text NOT NULL,
	`counted_at` text NOT NULL,
	`counted_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`location_type` text NOT NULL,
	`inventory_status` text DEFAULT 'usable' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_locations_code` ON `locations` (`code`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`manufacturer_sku` text,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`material` text NOT NULL,
	`dimensions` text NOT NULL,
	`finish` text NOT NULL,
	`tracking_policy` text DEFAULT 'quantity' NOT NULL,
	`inventory_policy` text DEFAULT 'stocked' NOT NULL,
	`standard_cost_cents` integer NOT NULL,
	`selling_price_cents` integer NOT NULL,
	`reorder_point` real DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_sku` ON `products` (`sku`);--> statement-breakpoint
CREATE TABLE `purchase_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`ordered_qty` real NOT NULL,
	`closed_qty` real DEFAULT 0 NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`configuration_snapshot` text
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_order_lines_order` ON `purchase_order_lines` (`purchase_order_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`vendor_id` text NOT NULL,
	`lifecycle_status` text DEFAULT 'approved' NOT NULL,
	`billing_status` text DEFAULT 'not_billed' NOT NULL,
	`expected_date` text,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`total_cents` integer NOT NULL,
	`buyer_name` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchase_orders_number` ON `purchase_orders` (`number`);--> statement-breakpoint
CREATE INDEX `idx_purchase_orders_vendor_status` ON `purchase_orders` (`vendor_id`,`lifecycle_status`);--> statement-breakpoint
CREATE TABLE `receipt_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	`purchase_order_line_id` text NOT NULL,
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`quantity` real NOT NULL,
	`condition` text DEFAULT 'usable' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_receipt_lines_receipt` ON `receipt_lines` (`receipt_id`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`purchase_order_id` text NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`posted_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_receipts_number` ON `receipts` (`number`);--> statement-breakpoint
CREATE INDEX `idx_receipts_purchase_order` ON `receipts` (`purchase_order_id`);--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`sales_order_line_id` text NOT NULL,
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`quantity` real NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_reservations_line_status` ON `reservations` (`sales_order_line_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_reservations_product_location_status` ON `reservations` (`product_id`,`location_id`,`status`);--> statement-breakpoint
CREATE TABLE `sales_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`sales_order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`ordered_qty` real NOT NULL,
	`canceled_qty` real DEFAULT 0 NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`configuration_snapshot` text
);
--> statement-breakpoint
CREATE INDEX `idx_sales_order_lines_order` ON `sales_order_lines` (`sales_order_id`);--> statement-breakpoint
CREATE TABLE `sales_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`customer_id` text NOT NULL,
	`lifecycle_status` text DEFAULT 'confirmed' NOT NULL,
	`billing_status` text DEFAULT 'not_invoiced' NOT NULL,
	`requested_date` text,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`total_cents` integer NOT NULL,
	`owner_name` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sales_orders_number` ON `sales_orders` (`number`);--> statement-breakpoint
CREATE INDEX `idx_sales_orders_customer_status` ON `sales_orders` (`customer_id`,`lifecycle_status`);--> statement-breakpoint
CREATE TABLE `shipment_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`sales_order_line_id` text NOT NULL,
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`quantity` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_shipment_lines_shipment` ON `shipment_lines` (`shipment_id`);--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`sales_order_id` text NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`posted_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shipments_number` ON `shipments` (`number`);--> statement-breakpoint
CREATE INDEX `idx_shipments_sales_order` ON `shipments` (`sales_order_id`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`movement_type` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real NOT NULL,
	`from_location_id` text,
	`to_location_id` text,
	`inventory_status` text NOT NULL,
	`source_document_type` text NOT NULL,
	`source_document_id` text NOT NULL,
	`source_line_id` text,
	`purchase_order_line_id` text,
	`sales_order_line_id` text,
	`reversal_of_movement_id` text,
	`posted_at` text NOT NULL,
	`posted_by` text NOT NULL,
	`unit_cost_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`idempotency_key` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_stock_movements_product_posted` ON `stock_movements` (`product_id`,`posted_at`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_po_line` ON `stock_movements` (`purchase_order_line_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_so_line` ON `stock_movements` (`sales_order_line_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_source` ON `stock_movements` (`source_document_type`,`source_document_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_reversal` ON `stock_movements` (`reversal_of_movement_id`);--> statement-breakpoint
CREATE TABLE `vendor_bills` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`vendor_id` text NOT NULL,
	`purchase_order_id` text,
	`status` text NOT NULL,
	`match_status` text NOT NULL,
	`total_cents` integer NOT NULL,
	`due_date` text,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vendor_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`purchase_order_id` text NOT NULL,
	`purchase_order_line_id` text NOT NULL,
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`quantity` real NOT NULL,
	`disposition` text NOT NULL,
	`posted_at` text NOT NULL
);
