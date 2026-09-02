CREATE TABLE `master_record_merges` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`source_label` text NOT NULL,
	`merged_at` text NOT NULL,
	`merged_by` text NOT NULL,
	CONSTRAINT "master_record_merges_type_check" CHECK("master_record_merges"."entity_type" IN ('product','business_partner'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_master_record_merges_source` ON `master_record_merges` (`entity_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_master_record_merges_target` ON `master_record_merges` (`entity_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `product_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`alias_type` text DEFAULT 'alternate' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "product_aliases_type_check" CHECK("product_aliases"."alias_type" IN ('alternate','sku','manufacturer_sku','name','merged_record'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_aliases_normalized` ON `product_aliases` (`normalized_alias`);--> statement-breakpoint
CREATE INDEX `idx_product_aliases_product` ON `product_aliases` (`product_id`,`alias`);--> statement-breakpoint
CREATE TABLE `product_default_locations` (
	`product_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`location_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	PRIMARY KEY(`product_id`, `warehouse_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_product_default_locations_location` ON `product_default_locations` (`location_id`);--> statement-breakpoint
CREATE TABLE `purchase_order_merges` (
	`source_purchase_order_id` text PRIMARY KEY NOT NULL,
	`target_purchase_order_id` text NOT NULL,
	`merged_at` text NOT NULL,
	`merged_by` text NOT NULL,
	FOREIGN KEY (`source_purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_order_merges_target` ON `purchase_order_merges` (`target_purchase_order_id`);