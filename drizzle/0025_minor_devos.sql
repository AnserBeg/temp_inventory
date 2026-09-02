CREATE TABLE `supply_allocation_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`supply_allocation_id` text NOT NULL,
	`receipt_movement_id` text NOT NULL,
	`reservation_id` text,
	`quantity` real NOT NULL,
	`reserved_quantity` real DEFAULT 0 NOT NULL,
	`reversed_qty` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`supply_allocation_id`) REFERENCES `supply_allocations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_movement_id`) REFERENCES `stock_movements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supply_allocation_receipts_quantity_check" CHECK("supply_allocation_receipts"."quantity" > 0),
	CONSTRAINT "supply_allocation_receipts_reserved_quantity_check" CHECK("supply_allocation_receipts"."reserved_quantity" >= 0 AND "supply_allocation_receipts"."reserved_quantity" <= "supply_allocation_receipts"."quantity"),
	CONSTRAINT "supply_allocation_receipts_reversed_quantity_check" CHECK("supply_allocation_receipts"."reversed_qty" >= 0 AND "supply_allocation_receipts"."reversed_qty" <= "supply_allocation_receipts"."quantity")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_supply_allocation_receipts_pair` ON `supply_allocation_receipts` (`supply_allocation_id`,`receipt_movement_id`);--> statement-breakpoint
CREATE INDEX `idx_supply_allocation_receipts_movement` ON `supply_allocation_receipts` (`receipt_movement_id`);--> statement-breakpoint
CREATE INDEX `idx_supply_allocation_receipts_reservation` ON `supply_allocation_receipts` (`reservation_id`);--> statement-breakpoint
CREATE TABLE `supply_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_order_line_id` text NOT NULL,
	`sales_order_line_id` text NOT NULL,
	`allocated_qty` real NOT NULL,
	`received_qty` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`purchase_order_line_id`) REFERENCES `purchase_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sales_order_line_id`) REFERENCES `sales_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supply_allocations_allocated_quantity_check" CHECK("supply_allocations"."allocated_qty" > 0),
	CONSTRAINT "supply_allocations_received_quantity_check" CHECK("supply_allocations"."received_qty" >= 0 AND "supply_allocations"."received_qty" <= "supply_allocations"."allocated_qty"),
	CONSTRAINT "supply_allocations_status_check" CHECK("supply_allocations"."status" IN ('active','released'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_supply_allocations_pair` ON `supply_allocations` (`purchase_order_line_id`,`sales_order_line_id`);--> statement-breakpoint
CREATE INDEX `idx_supply_allocations_purchase_line_status` ON `supply_allocations` (`purchase_order_line_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_supply_allocations_sales_line_status` ON `supply_allocations` (`sales_order_line_id`,`status`);--> statement-breakpoint
DROP INDEX `idx_purchase_order_lines_source_sales_line`;--> statement-breakpoint
CREATE INDEX `idx_purchase_order_lines_source_sales_line` ON `purchase_order_lines` (`source_sales_order_line_id`);
--> statement-breakpoint
INSERT INTO supply_allocations
  (id,purchase_order_line_id,sales_order_line_id,allocated_qty,received_qty,status,created_at,updated_at,version)
SELECT 'allocation-legacy-' || pol.id,
       pol.id,
       sol.id,
       MIN(pol.ordered_qty,sol.ordered_qty-sol.canceled_qty),
       MIN(
         MIN(pol.ordered_qty,sol.ordered_qty-sol.canceled_qty),
         MAX(CASE WHEN pol.fulfillment_route='drop_ship'
           THEN COALESCE((SELECT SUM(d.quantity-d.reversed_qty) FROM drop_ship_deliveries d WHERE d.purchase_order_line_id=pol.id),0)
           ELSE COALESCE((SELECT SUM(CASE WHEN sm.inventory_status='usable' THEN sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.purchase_order_line_id=pol.id),0)
         END,0)
       ),
       CASE WHEN po.lifecycle_status='canceled' THEN 'released' ELSE 'active' END,
       po.created_at,
       CURRENT_TIMESTAMP,
       1
  FROM purchase_order_lines pol
  JOIN purchase_orders po ON po.id=pol.purchase_order_id
  JOIN sales_order_lines sol ON sol.id=pol.source_sales_order_line_id
 WHERE pol.source_sales_order_line_id IS NOT NULL
   AND sol.product_id=pol.product_id
   AND sol.ordered_qty-sol.canceled_qty>0;
