CREATE TABLE `qbo_account_mappings` (
	`connection_id` text NOT NULL,
	`logical_key` text NOT NULL,
	`qbo_account_id` text NOT NULL,
	`qbo_account_name` text NOT NULL,
	`qbo_account_type` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`connection_id`, `logical_key`),
	FOREIGN KEY (`connection_id`) REFERENCES `qbo_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_qbo_account_mappings_account` ON `qbo_account_mappings` (`connection_id`,`qbo_account_id`);--> statement-breakpoint
CREATE TABLE `qbo_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`realm_id` text NOT NULL,
	`environment` text DEFAULT 'sandbox' NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`company_name` text DEFAULT 'QuickBooks company' NOT NULL,
	`country` text DEFAULT 'CA' NOT NULL,
	`home_currency` text DEFAULT 'CAD' NOT NULL,
	`scopes` text DEFAULT 'com.intuit.quickbooks.accounting' NOT NULL,
	`encrypted_access_token` text NOT NULL,
	`encrypted_refresh_token` text NOT NULL,
	`access_token_expires_at` text NOT NULL,
	`refresh_token_expires_at` text,
	`sync_from` text NOT NULL,
	`initial_sync_status` text DEFAULT 'not_started' NOT NULL,
	`token_lock_owner` text,
	`token_lock_until` text,
	`connected_by` text NOT NULL,
	`connected_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`disconnected_at` text,
	`last_error` text,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "qbo_connection_environment_check" CHECK("qbo_connections"."environment" IN ('sandbox','production')),
	CONSTRAINT "qbo_connection_status_check" CHECK("qbo_connections"."status" IN ('connected','disconnected','error','reauthorization_required')),
	CONSTRAINT "qbo_initial_sync_status_check" CHECK("qbo_connections"."initial_sync_status" IN ('not_started','queued','running','completed','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_qbo_connections_realm` ON `qbo_connections` (`realm_id`);--> statement-breakpoint
CREATE INDEX `idx_qbo_connections_status` ON `qbo_connections` (`status`);--> statement-breakpoint
CREATE TABLE `qbo_entity_links` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`local_entity_type` text NOT NULL,
	`local_entity_id` text NOT NULL,
	`qbo_entity_type` text NOT NULL,
	`qbo_entity_id` text NOT NULL,
	`qbo_sync_token` text DEFAULT '0' NOT NULL,
	`local_version` integer,
	`source_hash` text,
	`qbo_last_updated_at` text,
	`status` text DEFAULT 'synced' NOT NULL,
	`last_synced_at` text NOT NULL,
	`last_error` text,
	FOREIGN KEY (`connection_id`) REFERENCES `qbo_connections`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "qbo_entity_link_status_check" CHECK("qbo_entity_links"."status" IN ('synced','conflict','inactive','deleted','error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_qbo_entity_links_local` ON `qbo_entity_links` (`connection_id`,`local_entity_type`,`local_entity_id`,`qbo_entity_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_qbo_entity_links_remote` ON `qbo_entity_links` (`connection_id`,`qbo_entity_type`,`qbo_entity_id`);--> statement-breakpoint
CREATE INDEX `idx_qbo_entity_links_status` ON `qbo_entity_links` (`connection_id`,`status`);--> statement-breakpoint
CREATE TABLE `qbo_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`environment` text NOT NULL,
	`return_to` text DEFAULT '/' NOT NULL,
	`sync_from` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	CONSTRAINT "qbo_oauth_state_environment_check" CHECK("qbo_oauth_states"."environment" IN ('sandbox','production'))
);
--> statement-breakpoint
CREATE INDEX `idx_qbo_oauth_states_expires` ON `qbo_oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `qbo_reconciliation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`checked_count` integer DEFAULT 0 NOT NULL,
	`matched_count` integer DEFAULT 0 NOT NULL,
	`conflict_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`last_error` text,
	FOREIGN KEY (`connection_id`) REFERENCES `qbo_connections`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "qbo_reconciliation_status_check" CHECK("qbo_reconciliation_runs"."status" IN ('running','completed','failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_qbo_reconciliation_runs_started` ON `qbo_reconciliation_runs` (`connection_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `qbo_reference_mappings` (
	`connection_id` text NOT NULL,
	`mapping_type` text NOT NULL,
	`local_value` text NOT NULL,
	`qbo_entity_id` text NOT NULL,
	`qbo_entity_name` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`connection_id`, `mapping_type`, `local_value`),
	FOREIGN KEY (`connection_id`) REFERENCES `qbo_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_qbo_reference_mappings_entity` ON `qbo_reference_mappings` (`connection_id`,`mapping_type`,`qbo_entity_id`);--> statement-breakpoint
CREATE TABLE `qbo_sync_cursors` (
	`connection_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`last_changed_at` text NOT NULL,
	`last_checked_at` text NOT NULL,
	`last_error` text,
	PRIMARY KEY(`connection_id`, `entity_type`),
	FOREIGN KEY (`connection_id`) REFERENCES `qbo_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `qbo_sync_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`outbox_event_id` text,
	`dedupe_key` text NOT NULL,
	`local_entity_type` text NOT NULL,
	`local_entity_id` text NOT NULL,
	`operation` text DEFAULT 'upsert' NOT NULL,
	`source_version` integer,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`available_at` text NOT NULL,
	`locked_at` text,
	`last_error_code` text,
	`last_error` text,
	`qbo_entity_type` text,
	`qbo_entity_id` text,
	`request_hash` text,
	`created_at` text NOT NULL,
	`processed_at` text,
	FOREIGN KEY (`connection_id`) REFERENCES `qbo_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`outbox_event_id`) REFERENCES `outbox_events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "qbo_sync_delivery_operation_check" CHECK("qbo_sync_deliveries"."operation" IN ('upsert','void','deactivate','reconcile')),
	CONSTRAINT "qbo_sync_delivery_status_check" CHECK("qbo_sync_deliveries"."status" IN ('pending','processing','succeeded','failed','conflict','canceled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_qbo_sync_deliveries_dedupe` ON `qbo_sync_deliveries` (`connection_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_qbo_sync_deliveries_claim` ON `qbo_sync_deliveries` (`connection_id`,`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `idx_qbo_sync_deliveries_entity` ON `qbo_sync_deliveries` (`connection_id`,`local_entity_type`,`local_entity_id`);--> statement-breakpoint
CREATE TABLE `qbo_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text,
	`realm_id` text NOT NULL,
	`payload_sha256` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`processed_at` text,
	`last_error` text,
	FOREIGN KEY (`connection_id`) REFERENCES `qbo_connections`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "qbo_webhook_status_check" CHECK("qbo_webhook_events"."status" IN ('pending','processing','processed','failed','ignored'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_qbo_webhook_events_payload` ON `qbo_webhook_events` (`realm_id`,`payload_sha256`);--> statement-breakpoint
CREATE INDEX `idx_qbo_webhook_events_status` ON `qbo_webhook_events` (`status`,`created_at`);