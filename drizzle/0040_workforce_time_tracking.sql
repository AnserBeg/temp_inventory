CREATE TABLE `work_orders` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`partner_id` text,
	`created_by_id` text NOT NULL,
	`created_by_name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `business_partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `app_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "work_orders_status_check" CHECK(`status` IN ('open','on_hold','completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_orders_number` ON `work_orders` (`tenant_id`,`number`);
--> statement-breakpoint
CREATE INDEX `idx_work_orders_status_updated` ON `work_orders` (`tenant_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `idx_work_orders_partner` ON `work_orders` (`tenant_id`,`partner_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `work_order_document_links` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`document_type` text NOT NULL,
	`document_id` text NOT NULL,
	`document_number` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "work_order_document_type_check" CHECK(`document_type` IN ('sales_order','purchase_order'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_document_unique` ON `work_order_document_links` (`tenant_id`,`work_order_id`,`document_type`,`document_id`);
--> statement-breakpoint
CREATE INDEX `idx_work_order_document_lookup` ON `work_order_document_links` (`tenant_id`,`document_type`,`document_id`);
--> statement-breakpoint
CREATE TABLE `labour_items` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `app_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "labour_items_status_check" CHECK(`status` IN ('open','completed'))
);
--> statement-breakpoint
CREATE INDEX `idx_labour_items_work_order_status` ON `labour_items` (`tenant_id`,`work_order_id`,`status`);
--> statement-breakpoint
CREATE TABLE `time_entries` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`labour_item_id` text NOT NULL,
	`worker_user_id` text NOT NULL,
	`worker_name` text NOT NULL,
	`worker_email` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`tech_story` text,
	`edited_by_id` text,
	`edited_by_name` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`labour_item_id`) REFERENCES `labour_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`worker_user_id`) REFERENCES `app_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`edited_by_id`) REFERENCES `app_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "time_entries_range_check" CHECK(`ended_at` IS NULL OR `ended_at` > `started_at`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_time_entries_one_active_worker` ON `time_entries` (`tenant_id`,`worker_user_id`) WHERE `ended_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_time_entries_labour_started` ON `time_entries` (`tenant_id`,`labour_item_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `idx_time_entries_worker_started` ON `time_entries` (`tenant_id`,`worker_user_id`,`started_at`);
--> statement-breakpoint
PRAGMA optimize;
