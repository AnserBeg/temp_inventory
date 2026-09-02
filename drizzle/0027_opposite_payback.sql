ALTER TABLE `purchase_orders` ADD `supplier_quote_number` text;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `supplier_reference` text;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `source_document_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchase_orders_vendor_supplier_quote` ON `purchase_orders` (`vendor_id`,`supplier_quote_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchase_orders_source_document_hash` ON `purchase_orders` (`source_document_hash`);