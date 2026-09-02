CREATE TABLE `document_email_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`sender_email` text NOT NULL,
	`document_type` text NOT NULL,
	`document_id` text NOT NULL,
	`document_number` text NOT NULL,
	`recipients_json` text NOT NULL,
	`subject` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider_message_id` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`sent_at` text,
	CONSTRAINT "document_email_deliveries_provider_check" CHECK("document_email_deliveries"."provider" IN ('google','microsoft')),
	CONSTRAINT "document_email_deliveries_type_check" CHECK("document_email_deliveries"."document_type" IN ('purchase_order','sales_order','customer_invoice')),
	CONSTRAINT "document_email_deliveries_status_check" CHECK("document_email_deliveries"."status" IN ('pending','sent','failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_document_email_deliveries_document` ON `document_email_deliveries` (`document_type`,`document_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_document_email_deliveries_user_created` ON `document_email_deliveries` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `email_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`email_address` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`scopes` text NOT NULL,
	`encrypted_access_token` text NOT NULL,
	`encrypted_refresh_token` text NOT NULL,
	`access_token_expires_at` text NOT NULL,
	`connected_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`disconnected_at` text,
	`last_error` text,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "email_connections_provider_check" CHECK("email_connections"."provider" IN ('google','microsoft')),
	CONSTRAINT "email_connections_status_check" CHECK("email_connections"."status" IN ('connected','disconnected','error','reauthorization_required'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_email_connections_provider_address` ON `email_connections` (`provider`,`email_address`);--> statement-breakpoint
CREATE INDEX `idx_email_connections_status` ON `email_connections` (`status`);--> statement-breakpoint
CREATE TABLE `email_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_email` text NOT NULL,
	`user_name` text NOT NULL,
	`provider` text NOT NULL,
	`return_to` text DEFAULT '/' NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	CONSTRAINT "email_oauth_states_provider_check" CHECK("email_oauth_states"."provider" IN ('google','microsoft'))
);
--> statement-breakpoint
CREATE INDEX `idx_email_oauth_states_expires` ON `email_oauth_states` (`expires_at`);