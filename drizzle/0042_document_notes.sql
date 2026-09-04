ALTER TABLE `purchase_orders` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `receipts` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `drop_ship_deliveries` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `vendor_returns` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `customer_returns` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `inventory_counts` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `vendor_credits` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `customer_invoices` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `customer_credits` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `landed_cost_allocations` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `inventory_transfers` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `notes` text;--> statement-breakpoint
PRAGMA optimize;
