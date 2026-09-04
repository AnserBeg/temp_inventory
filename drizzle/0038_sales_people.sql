CREATE TABLE `sales_people` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sales_people_code` ON `sales_people` (`tenant_id`,`code`);
--> statement-breakpoint
CREATE INDEX `idx_sales_people_active_name` ON `sales_people` (`tenant_id`,`active`,`name`);
--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `sales_person_id` text REFERENCES `sales_people`(`id`);
--> statement-breakpoint
CREATE INDEX `idx_sales_orders_sales_person_status` ON `sales_orders` (`tenant_id`,`sales_person_id`,`lifecycle_status`);
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_sales_orders_sales_person_id_insert`
BEFORE INSERT ON `sales_orders`
WHEN NEW.`sales_person_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `sales_people` WHERE `id`=NEW.`sales_person_id` AND `tenant_id`=NEW.`tenant_id`)
BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_sales_orders_sales_person_id_update`
BEFORE UPDATE OF `sales_person_id`,`tenant_id` ON `sales_orders`
WHEN NEW.`sales_person_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `sales_people` WHERE `id`=NEW.`sales_person_id` AND `tenant_id`=NEW.`tenant_id`)
BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
