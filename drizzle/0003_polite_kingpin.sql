CREATE TABLE `drop_ship_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`purchase_order_id` text NOT NULL,
	`purchase_order_line_id` text NOT NULL,
	`sales_order_id` text NOT NULL,
	`sales_order_line_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real NOT NULL,
	`reversed_qty` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`delivery_date` text NOT NULL,
	`external_reference` text NOT NULL,
	`posted_at` text NOT NULL,
	`posted_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_order_line_id`) REFERENCES `purchase_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sales_order_line_id`) REFERENCES `sales_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "drop_ship_delivery_quantity_check" CHECK("drop_ship_deliveries"."quantity" > 0),
	CONSTRAINT "drop_ship_delivery_reversed_quantity_check" CHECK("drop_ship_deliveries"."reversed_qty" >= 0 AND "drop_ship_deliveries"."reversed_qty" <= "drop_ship_deliveries"."quantity")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_drop_ship_deliveries_number` ON `drop_ship_deliveries` (`number`);--> statement-breakpoint
CREATE INDEX `idx_drop_ship_deliveries_purchase_line` ON `drop_ship_deliveries` (`purchase_order_line_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_drop_ship_deliveries_sales_line` ON `drop_ship_deliveries` (`sales_order_line_id`,`status`);