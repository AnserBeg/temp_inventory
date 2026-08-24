CREATE INDEX `idx_approvals_status` ON `approvals` (`status`);--> statement-breakpoint
CREATE INDEX `idx_cost_layers_receipt_movement` ON `cost_layers` (`receipt_movement_id`);--> statement-breakpoint
CREATE INDEX `idx_customer_invoice_lines_sales_line` ON `customer_invoice_lines` (`sales_order_line_id`);--> statement-breakpoint
CREATE INDEX `idx_customer_invoices_sales_order` ON `customer_invoices` (`sales_order_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_balances_location` ON `inventory_balances` (`location_id`);--> statement-breakpoint
CREATE INDEX `idx_value_entries_movement` ON `inventory_value_entries` (`movement_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_order_lines_product` ON `purchase_order_lines` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_order_lines_product` ON `sales_order_lines` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_vendor_bill_lines_purchase_line` ON `vendor_bill_lines` (`purchase_order_line_id`);--> statement-breakpoint
CREATE INDEX `idx_vendor_bills_match_due` ON `vendor_bills` (`match_status`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_vendor_bills_purchase_order` ON `vendor_bills` (`purchase_order_id`);--> statement-breakpoint
PRAGMA optimize;
