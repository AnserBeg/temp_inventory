CREATE TABLE `helcim_checkout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_link_id` text NOT NULL,
	`customer_invoice_id` text NOT NULL,
	`checkout_token` text NOT NULL,
	`encrypted_secret_token` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'initialized' NOT NULL,
	`provider_transaction_id` text,
	`provider_method` text,
	`provider_status` text,
	`provider_response_json` text DEFAULT '{}' NOT NULL,
	`payment_id` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`completed_at` text,
	`reconciled_at` text,
	`last_error` text,
	FOREIGN KEY (`payment_link_id`) REFERENCES `invoice_payment_links`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_invoice_id`) REFERENCES `customer_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "helcim_checkout_session_status_check" CHECK("helcim_checkout_sessions"."status" IN ('initialized','pending','settled','failed','expired','review'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_helcim_checkout_sessions_token` ON `helcim_checkout_sessions` (`checkout_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_helcim_checkout_sessions_transaction` ON `helcim_checkout_sessions` (`provider_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_helcim_checkout_sessions_invoice_created` ON `helcim_checkout_sessions` (`customer_invoice_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_helcim_checkout_sessions_status_expiry` ON `helcim_checkout_sessions` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `helcim_invoice_mirrors` (
	`customer_invoice_id` text PRIMARY KEY NOT NULL,
	`helcim_invoice_id` text NOT NULL,
	`helcim_invoice_number` text NOT NULL,
	`helcim_invoice_token` text,
	`local_version` integer NOT NULL,
	`synced_at` text NOT NULL,
	`last_error` text,
	FOREIGN KEY (`customer_invoice_id`) REFERENCES `customer_invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_helcim_invoice_mirrors_id` ON `helcim_invoice_mirrors` (`helcim_invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_helcim_invoice_mirrors_number` ON `helcim_invoice_mirrors` (`helcim_invoice_number`);--> statement-breakpoint
CREATE TABLE `helcim_webhook_events` (
	`webhook_id` text PRIMARY KEY NOT NULL,
	`webhook_type` text NOT NULL,
	`object_id` text,
	`body_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`received_at` text NOT NULL,
	`processed_at` text,
	`last_error` text,
	CONSTRAINT "helcim_webhook_event_status_check" CHECK("helcim_webhook_events"."status" IN ('pending','processed','ignored','failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_helcim_webhook_events_status_received` ON `helcim_webhook_events` (`status`,`received_at`);--> statement-breakpoint
CREATE TABLE `invoice_payment_links` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_invoice_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_viewed_at` text,
	FOREIGN KEY (`customer_invoice_id`) REFERENCES `customer_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invoice_payment_link_status_check" CHECK("invoice_payment_links"."status" IN ('active','paid','revoked','expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_invoice_payment_links_token_hash` ON `invoice_payment_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_invoice_payment_links_invoice_status` ON `invoice_payment_links` (`customer_invoice_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_invoice_payment_links_expiry` ON `invoice_payment_links` (`status`,`expires_at`);