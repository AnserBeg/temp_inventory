CREATE TABLE `price_list_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`price_list_id` text NOT NULL,
	`partner_id` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`partner_id`) REFERENCES `business_partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_price_list_assignments_list_partner` ON `price_list_assignments` (`price_list_id`,`partner_id`);--> statement-breakpoint
CREATE INDEX `idx_price_list_assignments_partner_active` ON `price_list_assignments` (`partner_id`,`active`,`priority`);--> statement-breakpoint
CREATE TABLE `price_list_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`price_list_id` text NOT NULL,
	`product_id` text NOT NULL,
	`uom_id` text NOT NULL,
	`minimum_quantity` real DEFAULT 1 NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uom_id`) REFERENCES `units_of_measure`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "price_list_entry_quantity_check" CHECK("price_list_entries"."minimum_quantity" > 0),
	CONSTRAINT "price_list_entry_price_check" CHECK("price_list_entries"."unit_price_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_price_list_entries_scope` ON `price_list_entries` (`price_list_id`,`product_id`,`uom_id`,`minimum_quantity`);--> statement-breakpoint
CREATE INDEX `idx_price_list_entries_lookup` ON `price_list_entries` (`product_id`,`uom_id`,`active`,`minimum_quantity`);--> statement-breakpoint
CREATE TABLE `price_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_price_lists_code` ON `price_lists` (`code`);--> statement-breakpoint
CREATE INDEX `idx_price_lists_active_priority` ON `price_lists` (`active`,`priority`);--> statement-breakpoint
INSERT OR IGNORE INTO `units_of_measure` (`id`,`code`,`name`,`dimension`,`precision`,`active`) VALUES ('uom-each','EA','Each','quantity',0,1);--> statement-breakpoint
ALTER TABLE `purchase_order_lines` ADD `ordered_uom_id` text;--> statement-breakpoint
ALTER TABLE `purchase_order_lines` ADD `ordered_uom_qty` real;--> statement-breakpoint
ALTER TABLE `purchase_order_lines` ADD `ordered_uom_unit_cost_cents` integer;--> statement-breakpoint
ALTER TABLE `sales_order_lines` ADD `ordered_uom_id` text;--> statement-breakpoint
ALTER TABLE `sales_order_lines` ADD `ordered_uom_qty` real;--> statement-breakpoint
ALTER TABLE `sales_order_lines` ADD `ordered_uom_unit_price_cents` integer;--> statement-breakpoint
UPDATE `purchase_order_lines` SET `ordered_uom_id`=(SELECT `base_uom_id` FROM `products` WHERE `products`.`id`=`purchase_order_lines`.`product_id`),`ordered_uom_qty`=`ordered_qty`,`ordered_uom_unit_cost_cents`=`unit_cost_cents` WHERE `ordered_uom_id` IS NULL;--> statement-breakpoint
UPDATE `sales_order_lines` SET `ordered_uom_id`=(SELECT `base_uom_id` FROM `products` WHERE `products`.`id`=`sales_order_lines`.`product_id`),`ordered_uom_qty`=`ordered_qty`,`ordered_uom_unit_price_cents`=`unit_price_cents` WHERE `ordered_uom_id` IS NULL;--> statement-breakpoint
CREATE INDEX `idx_audit_events_action_created` ON `audit_events` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_business_partners_active_name` ON `business_partners` (`active`,`name`);--> statement-breakpoint
CREATE INDEX `idx_customer_invoices_status_due` ON `customer_invoices` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_locations_warehouse_status_active` ON `locations` (`warehouse_id`,`inventory_status`,`active`);--> statement-breakpoint
CREATE INDEX `idx_products_active_name` ON `products` (`active`,`name`);--> statement-breakpoint
CREATE INDEX `idx_purchase_orders_status_expected` ON `purchase_orders` (`lifecycle_status`,`expected_date`);--> statement-breakpoint
CREATE INDEX `idx_sales_orders_status_requested` ON `sales_orders` (`lifecycle_status`,`requested_date`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_posted` ON `stock_movements` (`posted_at`);--> statement-breakpoint
CREATE INDEX `idx_vendor_bills_status_due` ON `vendor_bills` (`status`,`due_date`);
