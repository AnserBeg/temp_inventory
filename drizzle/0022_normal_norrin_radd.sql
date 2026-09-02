CREATE TABLE `inventory_count_session_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`tracking_policy` text DEFAULT 'quantity' NOT NULL,
	`expected_qty` real DEFAULT 0 NOT NULL,
	`expected_balance_version` integer DEFAULT 1 NOT NULL,
	`counted_qty` real,
	`variance_qty` real,
	`unit_cost_cents` integer,
	`reason` text,
	`status` text DEFAULT 'uncounted' NOT NULL,
	`approval_id` text,
	`posted_count_id` text,
	`counted_by` text,
	`counted_by_id` text,
	`counted_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `inventory_count_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_count_session_line_scope` ON `inventory_count_session_lines` (`session_id`,`product_id`,`location_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_count_session_lines_worklist` ON `inventory_count_session_lines` (`session_id`,`status`,`location_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_count_session_lines_approval` ON `inventory_count_session_lines` (`approval_id`);--> statement-breakpoint
CREATE TABLE `inventory_count_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`count_type` text DEFAULT 'cycle' NOT NULL,
	`warehouse_id` text NOT NULL,
	`scope_type` text DEFAULT 'warehouse' NOT NULL,
	`blind_count` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`effective_date` text NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`created_by_id` text,
	`created_by_email` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`submitted_at` text,
	`posted_at` text,
	`idempotency_key` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_count_sessions_number` ON `inventory_count_sessions` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_count_sessions_idempotency` ON `inventory_count_sessions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_inventory_count_sessions_warehouse_status` ON `inventory_count_sessions` (`warehouse_id`,`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `inventory_counts` ADD `count_session_id` text;--> statement-breakpoint
ALTER TABLE `inventory_counts` ADD `count_session_line_id` text;--> statement-breakpoint
CREATE INDEX `idx_inventory_counts_session` ON `inventory_counts` (`count_session_id`,`counted_at`);--> statement-breakpoint
PRAGMA optimize;
