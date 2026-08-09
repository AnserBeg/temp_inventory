CREATE TABLE `app_users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`full_name` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "app_users_role_check" CHECK("app_users"."role" IN ('viewer','operator','accounting','manager','administrator'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_email_unique` ON `app_users` (`email`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`request_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by` text NOT NULL,
	`requested_reason` text NOT NULL,
	`requested_at` text NOT NULL,
	`decided_by` text,
	`decision_reason` text,
	`decided_at` text,
	`consumed_at` text,
	`consumed_by` text,
	`consumed_entity_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "approvals_status_check" CHECK("approvals"."status" IN ('pending','approved','rejected','canceled'))
);
--> statement-breakpoint
CREATE INDEX `idx_approvals_entity_status` ON `approvals` (`entity_type`,`entity_id`,`status`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`document_type` text NOT NULL,
	`document_id` text NOT NULL,
	`file_name` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`category` text DEFAULT 'document' NOT NULL,
	`owner_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`uploaded_at` text NOT NULL,
	`deleted_at` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_attachments_object_key` ON `attachments` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_attachments_document` ON `attachments` (`document_type`,`document_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `cost_layers` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`receipt_movement_id` text,
	`received_qty` real NOT NULL,
	`remaining_qty` real NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`landed_cost_cents` integer DEFAULT 0 NOT NULL,
	`received_at` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_movement_id`) REFERENCES `stock_movements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cost_layers_product_received` ON `cost_layers` (`product_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `customer_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`customer_id` text NOT NULL,
	`customer_invoice_id` text,
	`sales_order_id` text,
	`amount_cents` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`posted_at` text NOT NULL,
	`posted_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`exchange_rate_to_base` real DEFAULT 1 NOT NULL,
	`base_amount_cents` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`customer_invoice_id`) REFERENCES `customer_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_credits_number_unique` ON `customer_credits` (`number`);--> statement-breakpoint
CREATE TABLE `customer_invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_invoice_id` text NOT NULL,
	`sales_order_line_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`line_total_cents` integer NOT NULL,
	FOREIGN KEY (`customer_invoice_id`) REFERENCES `customer_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sales_order_line_id`) REFERENCES `sales_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_customer_invoice_lines_invoice` ON `customer_invoice_lines` (`customer_invoice_id`);--> statement-breakpoint
CREATE TABLE `customer_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`customer_id` text NOT NULL,
	`sales_order_id` text,
	`status` text DEFAULT 'posted' NOT NULL,
	`invoice_date` text NOT NULL,
	`due_date` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer NOT NULL,
	`paid_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`exchange_rate_to_base` real DEFAULT 1 NOT NULL,
	`base_total_cents` integer DEFAULT 0 NOT NULL,
	`tax_rate_bps` integer DEFAULT 0 NOT NULL,
	`tax_code` text,
	`payment_terms` text,
	`posted_at` text NOT NULL,
	`posted_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_customer_invoices_number` ON `customer_invoices` (`number`);--> statement-breakpoint
CREATE TABLE `document_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`document_type` text NOT NULL,
	`document_id` text NOT NULL,
	`charge_type` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`direction` text DEFAULT 'add' NOT NULL,
	`taxable` integer DEFAULT false NOT NULL,
	`refundable` integer DEFAULT false NOT NULL,
	`tax_code` text,
	`tax_rate_bps` integer DEFAULT 0 NOT NULL,
	`tax_amount_cents` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "document_charge_amount_check" CHECK("document_charges"."amount_cents" >= 0),
	CONSTRAINT "document_charge_direction_check" CHECK("document_charges"."direction" IN ('add','subtract'))
);
--> statement-breakpoint
CREATE INDEX `idx_document_charges_document` ON `document_charges` (`document_type`,`document_id`);--> statement-breakpoint
CREATE TABLE `inventory_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`lot_number` text NOT NULL,
	`vendor_id` text,
	`manufactured_date` text,
	`expiry_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_lots_product_number` ON `inventory_lots` (`product_id`,`lot_number`);--> statement-breakpoint
CREATE TABLE `inventory_transfer_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`transfer_id` text NOT NULL,
	`product_id` text NOT NULL,
	`from_location_id` text NOT NULL,
	`to_location_id` text NOT NULL,
	`quantity` real NOT NULL,
	`received_qty` real DEFAULT 0 NOT NULL,
	`lot_id` text,
	`inventory_unit_id` text,
	FOREIGN KEY (`transfer_id`) REFERENCES `inventory_transfers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_unit_id`) REFERENCES `inventory_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`transfer_type` text NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`from_warehouse_id` text NOT NULL,
	`to_warehouse_id` text NOT NULL,
	`in_transit_location_id` text,
	`posted_at` text NOT NULL,
	`posted_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`in_transit_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_transfer_type_check" CHECK("inventory_transfers"."transfer_type" IN ('intra_warehouse','inter_warehouse'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_transfers_number_unique` ON `inventory_transfers` (`number`);--> statement-breakpoint
CREATE TABLE `inventory_units` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`serial_number` text NOT NULL,
	`lot_id` text,
	`location_id` text NOT NULL,
	`inventory_status` text DEFAULT 'usable' NOT NULL,
	`lifecycle_status` text DEFAULT 'on_hand' NOT NULL,
	`allocated_sales_order_line_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_units_product_serial` ON `inventory_units` (`product_id`,`serial_number`);--> statement-breakpoint
CREATE TABLE `inventory_value_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`movement_id` text,
	`entry_type` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`value_cents` integer NOT NULL,
	`cost_method` text NOT NULL,
	`reference_type` text NOT NULL,
	`reference_id` text NOT NULL,
	`posted_at` text NOT NULL,
	`posted_by` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`movement_id`) REFERENCES `stock_movements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_value_entries_product_posted` ON `inventory_value_entries` (`product_id`,`posted_at`);--> statement-breakpoint
CREATE TABLE `landed_cost_allocation_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`allocation_id` text NOT NULL,
	`cost_layer_id` text NOT NULL,
	`allocated_cents` integer NOT NULL,
	FOREIGN KEY (`allocation_id`) REFERENCES `landed_cost_allocations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cost_layer_id`) REFERENCES `cost_layers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `landed_cost_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`source_document_type` text NOT NULL,
	`source_document_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`allocation_basis` text NOT NULL,
	`posted_at` text NOT NULL,
	`posted_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `landed_cost_allocations_number_unique` ON `landed_cost_allocations` (`number`);--> statement-breakpoint
CREATE TABLE `movement_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`movement_id` text NOT NULL,
	`lot_id` text,
	`inventory_unit_id` text,
	`quantity` real NOT NULL,
	FOREIGN KEY (`movement_id`) REFERENCES `stock_movements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_unit_id`) REFERENCES `inventory_units`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "movement_assignment_quantity_check" CHECK("movement_assignments"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_movement_assignments_movement` ON `movement_assignments` (`movement_id`);--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`available_at` text NOT NULL,
	`locked_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`processed_at` text,
	CONSTRAINT "outbox_status_check" CHECK("outbox_events"."status" IN ('pending','processing','processed','failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_outbox_status_available` ON `outbox_events` (`status`,`available_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`direction` text NOT NULL,
	`partner_id` text NOT NULL,
	`document_type` text NOT NULL,
	`document_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`payment_date` text NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`posted_at` text NOT NULL,
	`posted_by` text NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`exchange_rate_to_base` real DEFAULT 1 NOT NULL,
	`base_amount_cents` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payments_number` ON `payments` (`number`);--> statement-breakpoint
CREATE TABLE `period_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`locked_through` text NOT NULL,
	`reason` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `purchase_order_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_order_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`lifecycle_status` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`reason` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_po_revisions_order_number` ON `purchase_order_revisions` (`purchase_order_id`,`revision_number`);--> statement-breakpoint
CREATE TABLE `returnable_asset_types` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`asset_class` text NOT NULL,
	`unit_deposit_cents` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `returnable_asset_types_code_unique` ON `returnable_asset_types` (`code`);--> statement-breakpoint
CREATE TABLE `returnable_events` (
	`id` text PRIMARY KEY NOT NULL,
	`obligation_id` text NOT NULL,
	`event_type` text NOT NULL,
	`quantity` real NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`posted_at` text NOT NULL,
	`posted_by` text NOT NULL,
	FOREIGN KEY (`obligation_id`) REFERENCES `returnable_obligations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `returnable_obligations` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`asset_type_id` text NOT NULL,
	`direction` text NOT NULL,
	`issued_qty` real DEFAULT 0 NOT NULL,
	`returned_qty` real DEFAULT 0 NOT NULL,
	`forfeited_qty` real DEFAULT 0 NOT NULL,
	`deposit_charged_cents` integer DEFAULT 0 NOT NULL,
	`deposit_refunded_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_type_id`) REFERENCES `returnable_asset_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_returnable_obligations_partner_status` ON `returnable_obligations` (`partner_id`,`status`);--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`description` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `units_of_measure` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`dimension` text DEFAULT 'quantity' NOT NULL,
	`precision` integer DEFAULT 3 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_of_measure_code_unique` ON `units_of_measure` (`code`);--> statement-breakpoint
CREATE TABLE `uom_conversions` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text,
	`from_uom_id` text NOT NULL,
	`to_uom_id` text NOT NULL,
	`numerator` integer NOT NULL,
	`denominator` integer NOT NULL,
	`rounding_mode` text DEFAULT 'nearest' NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_uom_id`) REFERENCES `units_of_measure`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_uom_id`) REFERENCES `units_of_measure`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "uom_conversion_positive_check" CHECK("uom_conversions"."numerator" > 0 AND "uom_conversions"."denominator" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_uom_conversion_scope` ON `uom_conversions` (`product_id`,`from_uom_id`,`to_uom_id`);--> statement-breakpoint
CREATE TABLE `valuation_policies` (
	`product_id` text PRIMARY KEY NOT NULL,
	`method` text DEFAULT 'fifo' NOT NULL,
	`standard_cost_cents` integer DEFAULT 0 NOT NULL,
	`average_cost_cents` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "valuation_method_check" CHECK("valuation_policies"."method" IN ('fifo','average','standard'))
);
--> statement-breakpoint
CREATE TABLE `vendor_bill_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_bill_id` text NOT NULL,
	`purchase_order_line_id` text,
	`product_id` text,
	`quantity` real NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`line_total_cents` integer NOT NULL,
	`match_status` text NOT NULL,
	`match_details_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`vendor_bill_id`) REFERENCES `vendor_bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_order_line_id`) REFERENCES `purchase_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_vendor_bill_lines_bill` ON `vendor_bill_lines` (`vendor_bill_id`);--> statement-breakpoint
CREATE TABLE `vendor_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`vendor_id` text NOT NULL,
	`vendor_bill_id` text,
	`purchase_order_id` text,
	`amount_cents` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`posted_at` text NOT NULL,
	`posted_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`exchange_rate_to_base` real DEFAULT 1 NOT NULL,
	`base_amount_cents` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`vendor_bill_id`) REFERENCES `vendor_bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_credits_number_unique` ON `vendor_credits` (`number`);--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`timezone` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warehouses_code_unique` ON `warehouses` (`code`);--> statement-breakpoint
ALTER TABLE `audit_events` ADD `actor_id` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `actor_email` text;--> statement-breakpoint
ALTER TABLE `business_partners` ADD `payment_terms` text;--> statement-breakpoint
ALTER TABLE `business_partners` ADD `currency` text DEFAULT 'CAD' NOT NULL;--> statement-breakpoint
ALTER TABLE `business_partners` ADD `active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `business_partners` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `command_log` ADD `request_hash` text;--> statement-breakpoint
ALTER TABLE `command_log` ADD `claim_token` text;--> statement-breakpoint
ALTER TABLE `locations` ADD `warehouse_id` text DEFAULT 'warehouse-main' NOT NULL;--> statement-breakpoint
ALTER TABLE `locations` ADD `parent_location_id` text;--> statement-breakpoint
ALTER TABLE `locations` ADD `active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `locations` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `base_uom_id` text DEFAULT 'uom-each' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `purchase_uom_id` text DEFAULT 'uom-each' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `sales_uom_id` text DEFAULT 'uom-each' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_order_lines` ADD `fulfillment_route` text DEFAULT 'stock' NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_order_lines` ADD `source_sales_order_line_id` text;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `exchange_rate_to_base` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `base_total_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `payment_terms` text;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `due_date` text;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `revision_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_order_lines` ADD `fulfillment_route` text DEFAULT 'stock' NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_order_lines` ADD `project_reference` text;--> statement-breakpoint
ALTER TABLE `sales_order_lines` ADD `linked_purchase_order_line_id` text;--> statement-breakpoint
ALTER TABLE `sales_order_lines` ADD `discount_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_order_lines` ADD `taxable` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_order_lines` ADD `tax_rate_bps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `exchange_rate_to_base` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `base_total_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `payment_terms` text;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `due_date` text;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `lot_id` text;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `inventory_unit_id` text;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `vendor_invoice_number` text;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `invoice_date` text;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `posted_at` text;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `subtotal_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `tax_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `paid_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `hold_reason` text;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `approved_at` text;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `approved_by` text;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `exchange_rate_to_base` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `base_total_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `tax_rate_bps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `tax_code` text;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `payment_terms` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vendor_bills_vendor_invoice` ON `vendor_bills` (`vendor_id`,`vendor_invoice_number`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_inventory_balances` (
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`on_hand_qty` real DEFAULT 0 NOT NULL,
	`reserved_qty` real DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`product_id`, `location_id`),
	CONSTRAINT "inventory_balances_on_hand_check" CHECK("__new_inventory_balances"."on_hand_qty" >= 0),
	CONSTRAINT "inventory_balances_reserved_check" CHECK("__new_inventory_balances"."reserved_qty" >= 0 AND "__new_inventory_balances"."reserved_qty" <= "__new_inventory_balances"."on_hand_qty")
);
--> statement-breakpoint
INSERT INTO `__new_inventory_balances`("product_id", "location_id", "on_hand_qty", "reserved_qty", "version") SELECT "product_id", "location_id", "on_hand_qty", "reserved_qty", "version" FROM `inventory_balances`;--> statement-breakpoint
DROP TABLE `inventory_balances`;--> statement-breakpoint
ALTER TABLE `__new_inventory_balances` RENAME TO `inventory_balances`;--> statement-breakpoint
PRAGMA foreign_keys=ON;