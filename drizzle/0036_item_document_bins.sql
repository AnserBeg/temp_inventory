ALTER TABLE `purchase_order_lines` ADD `bin_location_id` text REFERENCES `locations`(`id`);
--> statement-breakpoint
ALTER TABLE `sales_order_lines` ADD `bin_location_id` text REFERENCES `locations`(`id`);
--> statement-breakpoint
ALTER TABLE `customer_invoice_lines` ADD `bin_location_id` text REFERENCES `locations`(`id`);
--> statement-breakpoint
CREATE INDEX `idx_purchase_order_lines_bin_location` ON `purchase_order_lines` (`tenant_id`,`bin_location_id`);
--> statement-breakpoint
CREATE INDEX `idx_sales_order_lines_bin_location` ON `sales_order_lines` (`tenant_id`,`bin_location_id`);
--> statement-breakpoint
CREATE INDEX `idx_customer_invoice_lines_bin_location` ON `customer_invoice_lines` (`tenant_id`,`bin_location_id`);
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_order_lines_bin_location_id_insert`
BEFORE INSERT ON `purchase_order_lines`
WHEN NEW.`bin_location_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`bin_location_id` AND `tenant_id`=NEW.`tenant_id`)
BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_order_lines_bin_location_id_update`
BEFORE UPDATE OF `bin_location_id`,`tenant_id` ON `purchase_order_lines`
WHEN NEW.`bin_location_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`bin_location_id` AND `tenant_id`=NEW.`tenant_id`)
BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_sales_order_lines_bin_location_id_insert`
BEFORE INSERT ON `sales_order_lines`
WHEN NEW.`bin_location_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`bin_location_id` AND `tenant_id`=NEW.`tenant_id`)
BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_sales_order_lines_bin_location_id_update`
BEFORE UPDATE OF `bin_location_id`,`tenant_id` ON `sales_order_lines`
WHEN NEW.`bin_location_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`bin_location_id` AND `tenant_id`=NEW.`tenant_id`)
BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_invoice_lines_bin_location_id_insert`
BEFORE INSERT ON `customer_invoice_lines`
WHEN NEW.`bin_location_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`bin_location_id` AND `tenant_id`=NEW.`tenant_id`)
BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_invoice_lines_bin_location_id_update`
BEFORE UPDATE OF `bin_location_id`,`tenant_id` ON `customer_invoice_lines`
WHEN NEW.`bin_location_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`bin_location_id` AND `tenant_id`=NEW.`tenant_id`)
BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
