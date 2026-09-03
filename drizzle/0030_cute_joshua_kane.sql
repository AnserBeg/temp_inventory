CREATE TABLE `tenant_memberships` (
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `user_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tenant_memberships_role_check" CHECK("tenant_memberships"."role" IN ('viewer','operator','accounting','manager','administrator'))
);
--> statement-breakpoint
CREATE INDEX `idx_tenant_memberships_user_active` ON `tenant_memberships` (`user_id`,`active`,`is_default`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "tenants_status_check" CHECK("tenants"."status" IN ('active','suspended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_tenants_status_name` ON `tenants` (`status`,`name`);--> statement-breakpoint
INSERT OR IGNORE INTO `tenants` (`id`,`slug`,`name`,`status`,`created_by`,`created_at`,`updated_at`) VALUES ('tenant-default','default','PaneFlow','active','System',datetime('now'),datetime('now'));--> statement-breakpoint
INSERT OR IGNORE INTO `tenant_memberships` (`tenant_id`,`user_id`,`role`,`active`,`is_default`,`version`,`created_at`,`updated_at`) SELECT 'tenant-default',`user_id`,`role`,`active`,1,1,`created_at`,`updated_at` FROM `app_users`;--> statement-breakpoint
DROP INDEX `customer_credits_number_unique`;--> statement-breakpoint
DROP INDEX `idx_customer_credits_invoice_status_posted`;--> statement-breakpoint
ALTER TABLE `customer_credits` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_customer_credits_number` ON `customer_credits` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_customer_credits_invoice_status_posted` ON `customer_credits` (`tenant_id`,`customer_invoice_id`,`status`,`posted_at`);--> statement-breakpoint
DROP INDEX `customer_returns_number_unique`;--> statement-breakpoint
ALTER TABLE `customer_returns` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_customer_returns_number` ON `customer_returns` (`tenant_id`,`number`);--> statement-breakpoint
DROP INDEX `inventory_counts_number_unique`;--> statement-breakpoint
DROP INDEX `idx_inventory_counts_session`;--> statement-breakpoint
ALTER TABLE `inventory_counts` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_counts_number` ON `inventory_counts` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_inventory_counts_session` ON `inventory_counts` (`tenant_id`,`count_session_id`,`counted_at`);--> statement-breakpoint
DROP INDEX `inventory_transfers_number_unique`;--> statement-breakpoint
ALTER TABLE `inventory_transfers` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_transfers_number` ON `inventory_transfers` (`tenant_id`,`number`);--> statement-breakpoint
DROP INDEX `landed_cost_allocations_number_unique`;--> statement-breakpoint
ALTER TABLE `landed_cost_allocations` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_landed_cost_allocations_number` ON `landed_cost_allocations` (`tenant_id`,`number`);--> statement-breakpoint
DROP INDEX `returnable_asset_types_code_unique`;--> statement-breakpoint
ALTER TABLE `returnable_asset_types` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_returnable_asset_types_code` ON `returnable_asset_types` (`tenant_id`,`code`);--> statement-breakpoint
DROP INDEX `units_of_measure_code_unique`;--> statement-breakpoint
ALTER TABLE `units_of_measure` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_units_of_measure_code` ON `units_of_measure` (`tenant_id`,`code`);--> statement-breakpoint
DROP INDEX `vendor_bills_number_unique`;--> statement-breakpoint
DROP INDEX `idx_vendor_bills_vendor_invoice`;--> statement-breakpoint
DROP INDEX `idx_vendor_bills_status_due`;--> statement-breakpoint
DROP INDEX `idx_vendor_bills_match_due`;--> statement-breakpoint
DROP INDEX `idx_vendor_bills_purchase_order`;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vendor_bills_number` ON `vendor_bills` (`tenant_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vendor_bills_vendor_invoice` ON `vendor_bills` (`tenant_id`,`vendor_id`,`vendor_invoice_number`);--> statement-breakpoint
CREATE INDEX `idx_vendor_bills_status_due` ON `vendor_bills` (`tenant_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_vendor_bills_match_due` ON `vendor_bills` (`tenant_id`,`match_status`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_vendor_bills_purchase_order` ON `vendor_bills` (`tenant_id`,`purchase_order_id`);--> statement-breakpoint
DROP INDEX `vendor_credits_number_unique`;--> statement-breakpoint
DROP INDEX `idx_vendor_credits_bill_status_posted`;--> statement-breakpoint
ALTER TABLE `vendor_credits` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vendor_credits_number` ON `vendor_credits` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_vendor_credits_bill_status_posted` ON `vendor_credits` (`tenant_id`,`vendor_bill_id`,`status`,`posted_at`);--> statement-breakpoint
DROP INDEX `vendor_returns_number_unique`;--> statement-breakpoint
ALTER TABLE `vendor_returns` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vendor_returns_number` ON `vendor_returns` (`tenant_id`,`number`);--> statement-breakpoint
DROP INDEX `warehouses_code_unique`;--> statement-breakpoint
ALTER TABLE `warehouses` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_warehouses_code` ON `warehouses` (`tenant_id`,`code`);--> statement-breakpoint
DROP INDEX `idx_approvals_entity_status`;--> statement-breakpoint
DROP INDEX `idx_approvals_status`;--> statement-breakpoint
ALTER TABLE `approvals` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_approvals_entity_status` ON `approvals` (`tenant_id`,`entity_type`,`entity_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_approvals_status` ON `approvals` (`tenant_id`,`status`);--> statement-breakpoint
DROP INDEX `idx_attachments_object_key`;--> statement-breakpoint
DROP INDEX `idx_attachments_document`;--> statement-breakpoint
ALTER TABLE `attachments` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_attachments_object_key` ON `attachments` (`tenant_id`,`object_key`);--> statement-breakpoint
CREATE INDEX `idx_attachments_document` ON `attachments` (`tenant_id`,`document_type`,`document_id`,`deleted_at`);--> statement-breakpoint
DROP INDEX `idx_audit_events_entity_created`;--> statement-breakpoint
DROP INDEX `idx_audit_events_action_created`;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_audit_events_entity_created` ON `audit_events` (`tenant_id`,`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_action_created` ON `audit_events` (`tenant_id`,`action`,`created_at`);--> statement-breakpoint
DROP INDEX `idx_business_partners_code`;--> statement-breakpoint
DROP INDEX `idx_business_partners_active_name`;--> statement-breakpoint
ALTER TABLE `business_partners` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_business_partners_code` ON `business_partners` (`tenant_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_business_partners_active_name` ON `business_partners` (`tenant_id`,`active`,`name`);--> statement-breakpoint
DROP INDEX `idx_catalog_price_history_product`;--> statement-breakpoint
ALTER TABLE `catalog_price_history` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_catalog_price_history_product` ON `catalog_price_history` (`tenant_id`,`product_id`,`created_at`);--> statement-breakpoint
DROP INDEX `idx_cost_layers_product_received`;--> statement-breakpoint
DROP INDEX `idx_cost_layers_receipt_movement`;--> statement-breakpoint
ALTER TABLE `cost_layers` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_cost_layers_product_received` ON `cost_layers` (`tenant_id`,`product_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `idx_cost_layers_receipt_movement` ON `cost_layers` (`tenant_id`,`receipt_movement_id`);--> statement-breakpoint
DROP INDEX `idx_customer_invoice_lines_invoice`;--> statement-breakpoint
DROP INDEX `idx_customer_invoice_lines_sales_line`;--> statement-breakpoint
ALTER TABLE `customer_invoice_lines` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_customer_invoice_lines_invoice` ON `customer_invoice_lines` (`tenant_id`,`customer_invoice_id`);--> statement-breakpoint
CREATE INDEX `idx_customer_invoice_lines_sales_line` ON `customer_invoice_lines` (`tenant_id`,`sales_order_line_id`);--> statement-breakpoint
DROP INDEX `idx_customer_invoices_number`;--> statement-breakpoint
DROP INDEX `idx_customer_invoices_status_due`;--> statement-breakpoint
DROP INDEX `idx_customer_invoices_sales_order`;--> statement-breakpoint
ALTER TABLE `customer_invoices` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_customer_invoices_number` ON `customer_invoices` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_customer_invoices_status_due` ON `customer_invoices` (`tenant_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_customer_invoices_sales_order` ON `customer_invoices` (`tenant_id`,`sales_order_id`);--> statement-breakpoint
DROP INDEX `idx_document_charges_document`;--> statement-breakpoint
ALTER TABLE `document_charges` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_document_charges_document` ON `document_charges` (`tenant_id`,`document_type`,`document_id`);--> statement-breakpoint
DROP INDEX `idx_document_email_deliveries_document`;--> statement-breakpoint
DROP INDEX `idx_document_email_deliveries_user_created`;--> statement-breakpoint
ALTER TABLE `document_email_deliveries` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_document_email_deliveries_document` ON `document_email_deliveries` (`tenant_id`,`document_type`,`document_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_document_email_deliveries_user_created` ON `document_email_deliveries` (`tenant_id`,`user_id`,`created_at`);--> statement-breakpoint
DROP INDEX `idx_drop_ship_deliveries_number`;--> statement-breakpoint
DROP INDEX `idx_drop_ship_deliveries_purchase_line`;--> statement-breakpoint
DROP INDEX `idx_drop_ship_deliveries_sales_line`;--> statement-breakpoint
ALTER TABLE `drop_ship_deliveries` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_drop_ship_deliveries_number` ON `drop_ship_deliveries` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_drop_ship_deliveries_purchase_line` ON `drop_ship_deliveries` (`tenant_id`,`purchase_order_line_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_drop_ship_deliveries_sales_line` ON `drop_ship_deliveries` (`tenant_id`,`sales_order_line_id`,`status`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_email_connections` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`user_id` text NOT NULL,
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
	PRIMARY KEY(`tenant_id`, `user_id`),
	CONSTRAINT "email_connections_provider_check" CHECK("__new_email_connections"."provider" IN ('google','microsoft')),
	CONSTRAINT "email_connections_status_check" CHECK("__new_email_connections"."status" IN ('connected','disconnected','error','reauthorization_required'))
);
--> statement-breakpoint
INSERT INTO `__new_email_connections`("tenant_id", "user_id", "provider", "email_address", "status", "scopes", "encrypted_access_token", "encrypted_refresh_token", "access_token_expires_at", "connected_at", "updated_at", "disconnected_at", "last_error", "version") SELECT 'tenant-default', "user_id", "provider", "email_address", "status", "scopes", "encrypted_access_token", "encrypted_refresh_token", "access_token_expires_at", "connected_at", "updated_at", "disconnected_at", "last_error", "version" FROM `email_connections`;--> statement-breakpoint
DROP TABLE `email_connections`;--> statement-breakpoint
ALTER TABLE `__new_email_connections` RENAME TO `email_connections`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_email_connections_provider_address` ON `email_connections` (`tenant_id`,`provider`,`email_address`);--> statement-breakpoint
CREATE INDEX `idx_email_connections_status` ON `email_connections` (`tenant_id`,`status`);--> statement-breakpoint
DROP INDEX `idx_email_oauth_states_expires`;--> statement-breakpoint
ALTER TABLE `email_oauth_states` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_email_oauth_states_expires` ON `email_oauth_states` (`tenant_id`,`expires_at`);--> statement-breakpoint
DROP INDEX `idx_helcim_checkout_sessions_token`;--> statement-breakpoint
DROP INDEX `idx_helcim_checkout_sessions_transaction`;--> statement-breakpoint
DROP INDEX `idx_helcim_checkout_sessions_invoice_created`;--> statement-breakpoint
DROP INDEX `idx_helcim_checkout_sessions_status_expiry`;--> statement-breakpoint
ALTER TABLE `helcim_checkout_sessions` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_helcim_checkout_sessions_token` ON `helcim_checkout_sessions` (`tenant_id`,`checkout_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_helcim_checkout_sessions_transaction` ON `helcim_checkout_sessions` (`tenant_id`,`provider_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_helcim_checkout_sessions_invoice_created` ON `helcim_checkout_sessions` (`tenant_id`,`customer_invoice_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_helcim_checkout_sessions_status_expiry` ON `helcim_checkout_sessions` (`tenant_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_helcim_invoice_mirrors` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`customer_invoice_id` text NOT NULL,
	`helcim_invoice_id` text NOT NULL,
	`helcim_invoice_number` text NOT NULL,
	`helcim_invoice_token` text,
	`local_version` integer NOT NULL,
	`synced_at` text NOT NULL,
	`last_error` text,
	PRIMARY KEY(`tenant_id`, `customer_invoice_id`),
	FOREIGN KEY (`customer_invoice_id`) REFERENCES `customer_invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_helcim_invoice_mirrors`("tenant_id", "customer_invoice_id", "helcim_invoice_id", "helcim_invoice_number", "helcim_invoice_token", "local_version", "synced_at", "last_error") SELECT 'tenant-default', "customer_invoice_id", "helcim_invoice_id", "helcim_invoice_number", "helcim_invoice_token", "local_version", "synced_at", "last_error" FROM `helcim_invoice_mirrors`;--> statement-breakpoint
DROP TABLE `helcim_invoice_mirrors`;--> statement-breakpoint
ALTER TABLE `__new_helcim_invoice_mirrors` RENAME TO `helcim_invoice_mirrors`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_helcim_invoice_mirrors_id` ON `helcim_invoice_mirrors` (`tenant_id`,`helcim_invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_helcim_invoice_mirrors_number` ON `helcim_invoice_mirrors` (`tenant_id`,`helcim_invoice_number`);--> statement-breakpoint
CREATE TABLE `__new_helcim_webhook_events` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`webhook_id` text NOT NULL,
	`webhook_type` text NOT NULL,
	`object_id` text,
	`body_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`received_at` text NOT NULL,
	`processed_at` text,
	`last_error` text,
	PRIMARY KEY(`tenant_id`, `webhook_id`),
	CONSTRAINT "helcim_webhook_event_status_check" CHECK("__new_helcim_webhook_events"."status" IN ('pending','processed','ignored','failed'))
);
--> statement-breakpoint
INSERT INTO `__new_helcim_webhook_events`("tenant_id", "webhook_id", "webhook_type", "object_id", "body_json", "status", "attempts", "received_at", "processed_at", "last_error") SELECT 'tenant-default', "webhook_id", "webhook_type", "object_id", "body_json", "status", "attempts", "received_at", "processed_at", "last_error" FROM `helcim_webhook_events`;--> statement-breakpoint
DROP TABLE `helcim_webhook_events`;--> statement-breakpoint
ALTER TABLE `__new_helcim_webhook_events` RENAME TO `helcim_webhook_events`;--> statement-breakpoint
CREATE INDEX `idx_helcim_webhook_events_status_received` ON `helcim_webhook_events` (`tenant_id`,`status`,`received_at`);--> statement-breakpoint
CREATE TABLE `__new_inventory_balances` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`on_hand_qty` real DEFAULT 0 NOT NULL,
	`reserved_qty` real DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`tenant_id`, `product_id`, `location_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_balances_on_hand_check" CHECK("__new_inventory_balances"."on_hand_qty" >= 0),
	CONSTRAINT "inventory_balances_reserved_check" CHECK("__new_inventory_balances"."reserved_qty" >= 0 AND "__new_inventory_balances"."reserved_qty" <= "__new_inventory_balances"."on_hand_qty")
);
--> statement-breakpoint
INSERT INTO `__new_inventory_balances`("tenant_id", "product_id", "location_id", "on_hand_qty", "reserved_qty", "version") SELECT 'tenant-default', "product_id", "location_id", "on_hand_qty", "reserved_qty", "version" FROM `inventory_balances`;--> statement-breakpoint
DROP TABLE `inventory_balances`;--> statement-breakpoint
ALTER TABLE `__new_inventory_balances` RENAME TO `inventory_balances`;--> statement-breakpoint
CREATE INDEX `idx_inventory_balances_location` ON `inventory_balances` (`tenant_id`,`location_id`);--> statement-breakpoint
DROP INDEX `idx_inventory_count_session_line_scope`;--> statement-breakpoint
DROP INDEX `idx_inventory_count_session_lines_worklist`;--> statement-breakpoint
DROP INDEX `idx_inventory_count_session_lines_approval`;--> statement-breakpoint
ALTER TABLE `inventory_count_session_lines` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_count_session_line_scope` ON `inventory_count_session_lines` (`tenant_id`,`session_id`,`product_id`,`location_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_count_session_lines_worklist` ON `inventory_count_session_lines` (`tenant_id`,`session_id`,`status`,`location_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_count_session_lines_approval` ON `inventory_count_session_lines` (`tenant_id`,`approval_id`);--> statement-breakpoint
DROP INDEX `idx_inventory_count_sessions_number`;--> statement-breakpoint
DROP INDEX `idx_inventory_count_sessions_idempotency`;--> statement-breakpoint
DROP INDEX `idx_inventory_count_sessions_warehouse_status`;--> statement-breakpoint
ALTER TABLE `inventory_count_sessions` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_count_sessions_number` ON `inventory_count_sessions` (`tenant_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_count_sessions_idempotency` ON `inventory_count_sessions` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_inventory_count_sessions_warehouse_status` ON `inventory_count_sessions` (`tenant_id`,`warehouse_id`,`status`,`created_at`);--> statement-breakpoint
DROP INDEX `idx_inventory_lots_product_number`;--> statement-breakpoint
ALTER TABLE `inventory_lots` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_lots_product_number` ON `inventory_lots` (`tenant_id`,`product_id`,`lot_number`);--> statement-breakpoint
DROP INDEX `idx_inventory_units_product_serial`;--> statement-breakpoint
ALTER TABLE `inventory_units` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_units_product_serial` ON `inventory_units` (`tenant_id`,`product_id`,`serial_number`);--> statement-breakpoint
DROP INDEX `idx_value_entries_product_posted`;--> statement-breakpoint
DROP INDEX `idx_value_entries_movement`;--> statement-breakpoint
ALTER TABLE `inventory_value_entries` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_value_entries_product_posted` ON `inventory_value_entries` (`tenant_id`,`product_id`,`posted_at`);--> statement-breakpoint
CREATE INDEX `idx_value_entries_movement` ON `inventory_value_entries` (`tenant_id`,`movement_id`);--> statement-breakpoint
DROP INDEX `idx_invoice_payment_links_token_hash`;--> statement-breakpoint
DROP INDEX `idx_invoice_payment_links_invoice_status`;--> statement-breakpoint
DROP INDEX `idx_invoice_payment_links_expiry`;--> statement-breakpoint
ALTER TABLE `invoice_payment_links` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_invoice_payment_links_token_hash` ON `invoice_payment_links` (`tenant_id`,`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_invoice_payment_links_invoice_status` ON `invoice_payment_links` (`tenant_id`,`customer_invoice_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_invoice_payment_links_expiry` ON `invoice_payment_links` (`tenant_id`,`status`,`expires_at`);--> statement-breakpoint
DROP INDEX `idx_locations_code`;--> statement-breakpoint
DROP INDEX `idx_locations_warehouse_status_active`;--> statement-breakpoint
ALTER TABLE `locations` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_locations_code` ON `locations` (`tenant_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_locations_warehouse_status_active` ON `locations` (`tenant_id`,`warehouse_id`,`inventory_status`,`active`);--> statement-breakpoint
DROP INDEX `idx_margin_rules_code`;--> statement-breakpoint
DROP INDEX `idx_margin_rules_resolution`;--> statement-breakpoint
ALTER TABLE `margin_rules` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_margin_rules_code` ON `margin_rules` (`tenant_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_margin_rules_resolution` ON `margin_rules` (`tenant_id`,`active`,`product_id`,`category`,`minimum_cost_cents`,`priority`);--> statement-breakpoint
DROP INDEX `idx_master_record_merges_source`;--> statement-breakpoint
DROP INDEX `idx_master_record_merges_target`;--> statement-breakpoint
ALTER TABLE `master_record_merges` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_master_record_merges_source` ON `master_record_merges` (`tenant_id`,`entity_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_master_record_merges_target` ON `master_record_merges` (`tenant_id`,`entity_type`,`target_id`);--> statement-breakpoint
DROP INDEX `idx_movement_assignments_movement`;--> statement-breakpoint
ALTER TABLE `movement_assignments` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_movement_assignments_movement` ON `movement_assignments` (`tenant_id`,`movement_id`);--> statement-breakpoint
DROP INDEX `idx_outbox_status_available`;--> statement-breakpoint
ALTER TABLE `outbox_events` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_outbox_status_available` ON `outbox_events` (`tenant_id`,`status`,`available_at`);--> statement-breakpoint
DROP INDEX `idx_partner_addresses_label`;--> statement-breakpoint
DROP INDEX `idx_partner_addresses_partner_active`;--> statement-breakpoint
ALTER TABLE `partner_addresses` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_partner_addresses_label` ON `partner_addresses` (`tenant_id`,`partner_id`,`label`);--> statement-breakpoint
CREATE INDEX `idx_partner_addresses_partner_active` ON `partner_addresses` (`tenant_id`,`partner_id`,`active`,`is_default`);--> statement-breakpoint
DROP INDEX `idx_payments_number`;--> statement-breakpoint
DROP INDEX `idx_payments_document_date`;--> statement-breakpoint
ALTER TABLE `payments` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payments_number` ON `payments` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_payments_document_date` ON `payments` (`tenant_id`,`document_type`,`document_id`,`direction`,`payment_date`);--> statement-breakpoint
DROP INDEX `idx_price_list_assignments_list_partner`;--> statement-breakpoint
DROP INDEX `idx_price_list_assignments_partner_active`;--> statement-breakpoint
ALTER TABLE `price_list_assignments` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_price_list_assignments_list_partner` ON `price_list_assignments` (`tenant_id`,`price_list_id`,`partner_id`);--> statement-breakpoint
CREATE INDEX `idx_price_list_assignments_partner_active` ON `price_list_assignments` (`tenant_id`,`partner_id`,`active`,`priority`);--> statement-breakpoint
DROP INDEX `idx_price_list_entries_scope`;--> statement-breakpoint
DROP INDEX `idx_price_list_entries_lookup`;--> statement-breakpoint
ALTER TABLE `price_list_entries` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_price_list_entries_scope` ON `price_list_entries` (`tenant_id`,`price_list_id`,`product_id`,`uom_id`,`minimum_quantity`);--> statement-breakpoint
CREATE INDEX `idx_price_list_entries_lookup` ON `price_list_entries` (`tenant_id`,`product_id`,`uom_id`,`active`,`minimum_quantity`);--> statement-breakpoint
DROP INDEX `idx_price_lists_code`;--> statement-breakpoint
DROP INDEX `idx_price_lists_active_priority`;--> statement-breakpoint
ALTER TABLE `price_lists` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_price_lists_code` ON `price_lists` (`tenant_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_price_lists_active_priority` ON `price_lists` (`tenant_id`,`active`,`priority`);--> statement-breakpoint
DROP INDEX `idx_product_aliases_normalized`;--> statement-breakpoint
DROP INDEX `idx_product_aliases_product`;--> statement-breakpoint
ALTER TABLE `product_aliases` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_aliases_normalized` ON `product_aliases` (`tenant_id`,`normalized_alias`);--> statement-breakpoint
CREATE INDEX `idx_product_aliases_product` ON `product_aliases` (`tenant_id`,`product_id`,`alias`);--> statement-breakpoint
DROP INDEX `idx_product_cost_history_source`;--> statement-breakpoint
DROP INDEX `idx_product_cost_history_latest`;--> statement-breakpoint
ALTER TABLE `product_cost_history` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_cost_history_source` ON `product_cost_history` (`tenant_id`,`product_id`,`source_purchase_order_id`,`purchase_order_revision`);--> statement-breakpoint
CREATE INDEX `idx_product_cost_history_latest` ON `product_cost_history` (`tenant_id`,`product_id`,`effective_at`);--> statement-breakpoint
CREATE TABLE `__new_product_default_locations` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`product_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`location_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `product_id`, `warehouse_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_product_default_locations`("tenant_id", "product_id", "warehouse_id", "location_id", "version", "updated_at", "updated_by") SELECT 'tenant-default', "product_id", "warehouse_id", "location_id", "version", "updated_at", "updated_by" FROM `product_default_locations`;--> statement-breakpoint
DROP TABLE `product_default_locations`;--> statement-breakpoint
ALTER TABLE `__new_product_default_locations` RENAME TO `product_default_locations`;--> statement-breakpoint
CREATE INDEX `idx_product_default_locations_location` ON `product_default_locations` (`tenant_id`,`location_id`);--> statement-breakpoint
DROP INDEX `idx_products_sku`;--> statement-breakpoint
DROP INDEX `idx_products_active_name`;--> statement-breakpoint
DROP INDEX `idx_products_pricing_mode`;--> statement-breakpoint
ALTER TABLE `products` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_sku` ON `products` (`tenant_id`,`sku`);--> statement-breakpoint
CREATE INDEX `idx_products_active_name` ON `products` (`tenant_id`,`active`,`name`);--> statement-breakpoint
CREATE INDEX `idx_products_pricing_mode` ON `products` (`tenant_id`,`pricing_mode`,`category`);--> statement-breakpoint
DROP INDEX `idx_purchase_order_lines_order`;--> statement-breakpoint
DROP INDEX `idx_purchase_order_lines_product`;--> statement-breakpoint
DROP INDEX `idx_purchase_order_lines_source_sales_line`;--> statement-breakpoint
ALTER TABLE `purchase_order_lines` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_purchase_order_lines_order` ON `purchase_order_lines` (`tenant_id`,`purchase_order_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_order_lines_product` ON `purchase_order_lines` (`tenant_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_order_lines_source_sales_line` ON `purchase_order_lines` (`tenant_id`,`source_sales_order_line_id`);--> statement-breakpoint
DROP INDEX `idx_purchase_order_merges_target`;--> statement-breakpoint
ALTER TABLE `purchase_order_merges` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_purchase_order_merges_target` ON `purchase_order_merges` (`tenant_id`,`target_purchase_order_id`);--> statement-breakpoint
DROP INDEX `idx_po_revisions_order_number`;--> statement-breakpoint
ALTER TABLE `purchase_order_revisions` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_po_revisions_order_number` ON `purchase_order_revisions` (`tenant_id`,`purchase_order_id`,`revision_number`);--> statement-breakpoint
DROP INDEX `idx_purchase_orders_number`;--> statement-breakpoint
DROP INDEX `idx_purchase_orders_vendor_supplier_quote`;--> statement-breakpoint
DROP INDEX `idx_purchase_orders_source_document_hash`;--> statement-breakpoint
DROP INDEX `idx_purchase_orders_vendor_status`;--> statement-breakpoint
DROP INDEX `idx_purchase_orders_status_expected`;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchase_orders_number` ON `purchase_orders` (`tenant_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchase_orders_vendor_supplier_quote` ON `purchase_orders` (`tenant_id`,`vendor_id`,`supplier_quote_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchase_orders_source_document_hash` ON `purchase_orders` (`tenant_id`,`source_document_hash`);--> statement-breakpoint
CREATE INDEX `idx_purchase_orders_vendor_status` ON `purchase_orders` (`tenant_id`,`vendor_id`,`lifecycle_status`);--> statement-breakpoint
CREATE INDEX `idx_purchase_orders_status_expected` ON `purchase_orders` (`tenant_id`,`lifecycle_status`,`expected_date`);--> statement-breakpoint
CREATE TABLE `__new_qbo_account_mappings` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`connection_id` text NOT NULL,
	`logical_key` text NOT NULL,
	`qbo_account_id` text NOT NULL,
	`qbo_account_name` text NOT NULL,
	`qbo_account_type` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `connection_id`, `logical_key`),
	FOREIGN KEY (`connection_id`) REFERENCES `qbo_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_qbo_account_mappings`("tenant_id", "connection_id", "logical_key", "qbo_account_id", "qbo_account_name", "qbo_account_type", "active", "updated_by", "updated_at") SELECT 'tenant-default', "connection_id", "logical_key", "qbo_account_id", "qbo_account_name", "qbo_account_type", "active", "updated_by", "updated_at" FROM `qbo_account_mappings`;--> statement-breakpoint
DROP TABLE `qbo_account_mappings`;--> statement-breakpoint
ALTER TABLE `__new_qbo_account_mappings` RENAME TO `qbo_account_mappings`;--> statement-breakpoint
CREATE INDEX `idx_qbo_account_mappings_account` ON `qbo_account_mappings` (`tenant_id`,`connection_id`,`qbo_account_id`);--> statement-breakpoint
DROP INDEX `idx_qbo_connections_realm`;--> statement-breakpoint
DROP INDEX `idx_qbo_connections_status`;--> statement-breakpoint
ALTER TABLE `qbo_connections` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_qbo_connections_realm` ON `qbo_connections` (`tenant_id`,`realm_id`);--> statement-breakpoint
CREATE INDEX `idx_qbo_connections_status` ON `qbo_connections` (`tenant_id`,`status`);--> statement-breakpoint
DROP INDEX `idx_qbo_entity_links_local`;--> statement-breakpoint
DROP INDEX `idx_qbo_entity_links_remote`;--> statement-breakpoint
DROP INDEX `idx_qbo_entity_links_status`;--> statement-breakpoint
ALTER TABLE `qbo_entity_links` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_qbo_entity_links_local` ON `qbo_entity_links` (`tenant_id`,`connection_id`,`local_entity_type`,`local_entity_id`,`qbo_entity_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_qbo_entity_links_remote` ON `qbo_entity_links` (`tenant_id`,`connection_id`,`qbo_entity_type`,`qbo_entity_id`);--> statement-breakpoint
CREATE INDEX `idx_qbo_entity_links_status` ON `qbo_entity_links` (`tenant_id`,`connection_id`,`status`);--> statement-breakpoint
DROP INDEX `idx_qbo_oauth_states_expires`;--> statement-breakpoint
ALTER TABLE `qbo_oauth_states` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_qbo_oauth_states_expires` ON `qbo_oauth_states` (`tenant_id`,`expires_at`);--> statement-breakpoint
DROP INDEX `idx_qbo_reconciliation_runs_started`;--> statement-breakpoint
ALTER TABLE `qbo_reconciliation_runs` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_qbo_reconciliation_runs_started` ON `qbo_reconciliation_runs` (`tenant_id`,`connection_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `__new_qbo_reference_mappings` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`connection_id` text NOT NULL,
	`mapping_type` text NOT NULL,
	`local_value` text NOT NULL,
	`qbo_entity_id` text NOT NULL,
	`qbo_entity_name` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `connection_id`, `mapping_type`, `local_value`),
	FOREIGN KEY (`connection_id`) REFERENCES `qbo_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_qbo_reference_mappings`("tenant_id", "connection_id", "mapping_type", "local_value", "qbo_entity_id", "qbo_entity_name", "metadata_json", "active", "updated_by", "updated_at") SELECT 'tenant-default', "connection_id", "mapping_type", "local_value", "qbo_entity_id", "qbo_entity_name", "metadata_json", "active", "updated_by", "updated_at" FROM `qbo_reference_mappings`;--> statement-breakpoint
DROP TABLE `qbo_reference_mappings`;--> statement-breakpoint
ALTER TABLE `__new_qbo_reference_mappings` RENAME TO `qbo_reference_mappings`;--> statement-breakpoint
CREATE INDEX `idx_qbo_reference_mappings_entity` ON `qbo_reference_mappings` (`tenant_id`,`connection_id`,`mapping_type`,`qbo_entity_id`);--> statement-breakpoint
DROP INDEX `idx_qbo_sync_deliveries_dedupe`;--> statement-breakpoint
DROP INDEX `idx_qbo_sync_deliveries_claim`;--> statement-breakpoint
DROP INDEX `idx_qbo_sync_deliveries_entity`;--> statement-breakpoint
ALTER TABLE `qbo_sync_deliveries` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_qbo_sync_deliveries_dedupe` ON `qbo_sync_deliveries` (`tenant_id`,`connection_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_qbo_sync_deliveries_claim` ON `qbo_sync_deliveries` (`tenant_id`,`connection_id`,`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `idx_qbo_sync_deliveries_entity` ON `qbo_sync_deliveries` (`tenant_id`,`connection_id`,`local_entity_type`,`local_entity_id`);--> statement-breakpoint
DROP INDEX `idx_qbo_webhook_events_payload`;--> statement-breakpoint
DROP INDEX `idx_qbo_webhook_events_status`;--> statement-breakpoint
ALTER TABLE `qbo_webhook_events` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_qbo_webhook_events_payload` ON `qbo_webhook_events` (`tenant_id`,`realm_id`,`payload_sha256`);--> statement-breakpoint
CREATE INDEX `idx_qbo_webhook_events_status` ON `qbo_webhook_events` (`tenant_id`,`status`,`created_at`);--> statement-breakpoint
DROP INDEX `idx_receipt_lines_receipt`;--> statement-breakpoint
ALTER TABLE `receipt_lines` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_receipt_lines_receipt` ON `receipt_lines` (`tenant_id`,`receipt_id`);--> statement-breakpoint
DROP INDEX `idx_receipts_number`;--> statement-breakpoint
DROP INDEX `idx_receipts_purchase_order`;--> statement-breakpoint
ALTER TABLE `receipts` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_receipts_number` ON `receipts` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_receipts_purchase_order` ON `receipts` (`tenant_id`,`purchase_order_id`);--> statement-breakpoint
DROP INDEX `idx_reservations_line_status`;--> statement-breakpoint
DROP INDEX `idx_reservations_product_location_status`;--> statement-breakpoint
DROP INDEX `idx_reservations_status_created`;--> statement-breakpoint
ALTER TABLE `reservations` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_reservations_line_status` ON `reservations` (`tenant_id`,`sales_order_line_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_reservations_product_location_status` ON `reservations` (`tenant_id`,`product_id`,`location_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_reservations_status_created` ON `reservations` (`tenant_id`,`status`,`created_at`);--> statement-breakpoint
DROP INDEX `idx_returnable_obligations_partner_status`;--> statement-breakpoint
ALTER TABLE `returnable_obligations` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_returnable_obligations_partner_status` ON `returnable_obligations` (`tenant_id`,`partner_id`,`status`);--> statement-breakpoint
DROP INDEX `idx_sales_order_lines_order`;--> statement-breakpoint
DROP INDEX `idx_sales_order_lines_product`;--> statement-breakpoint
ALTER TABLE `sales_order_lines` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_sales_order_lines_order` ON `sales_order_lines` (`tenant_id`,`sales_order_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_order_lines_product` ON `sales_order_lines` (`tenant_id`,`product_id`);--> statement-breakpoint
DROP INDEX `idx_sales_orders_number`;--> statement-breakpoint
DROP INDEX `idx_sales_orders_customer_status`;--> statement-breakpoint
DROP INDEX `idx_sales_orders_status_requested`;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sales_orders_number` ON `sales_orders` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_sales_orders_customer_status` ON `sales_orders` (`tenant_id`,`customer_id`,`lifecycle_status`);--> statement-breakpoint
CREATE INDEX `idx_sales_orders_status_requested` ON `sales_orders` (`tenant_id`,`lifecycle_status`,`requested_date`);--> statement-breakpoint
DROP INDEX `idx_shipment_lines_shipment`;--> statement-breakpoint
ALTER TABLE `shipment_lines` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_shipment_lines_shipment` ON `shipment_lines` (`tenant_id`,`shipment_id`);--> statement-breakpoint
DROP INDEX `idx_shipments_number`;--> statement-breakpoint
DROP INDEX `idx_shipments_sales_order`;--> statement-breakpoint
ALTER TABLE `shipments` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shipments_number` ON `shipments` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_shipments_sales_order` ON `shipments` (`tenant_id`,`sales_order_id`);--> statement-breakpoint
DROP INDEX `idx_stock_movements_product_posted`;--> statement-breakpoint
DROP INDEX `idx_stock_movements_posted`;--> statement-breakpoint
DROP INDEX `idx_stock_movements_po_line`;--> statement-breakpoint
DROP INDEX `idx_stock_movements_so_line`;--> statement-breakpoint
DROP INDEX `idx_stock_movements_source`;--> statement-breakpoint
DROP INDEX `idx_stock_movements_reversal`;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_stock_movements_product_posted` ON `stock_movements` (`tenant_id`,`product_id`,`posted_at`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_posted` ON `stock_movements` (`tenant_id`,`posted_at`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_po_line` ON `stock_movements` (`tenant_id`,`purchase_order_line_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_so_line` ON `stock_movements` (`tenant_id`,`sales_order_line_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_source` ON `stock_movements` (`tenant_id`,`source_document_type`,`source_document_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_reversal` ON `stock_movements` (`tenant_id`,`reversal_of_movement_id`);--> statement-breakpoint
DROP INDEX `idx_supply_allocation_receipts_pair`;--> statement-breakpoint
DROP INDEX `idx_supply_allocation_receipts_movement`;--> statement-breakpoint
DROP INDEX `idx_supply_allocation_receipts_reservation`;--> statement-breakpoint
ALTER TABLE `supply_allocation_receipts` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_supply_allocation_receipts_pair` ON `supply_allocation_receipts` (`tenant_id`,`supply_allocation_id`,`receipt_movement_id`);--> statement-breakpoint
CREATE INDEX `idx_supply_allocation_receipts_movement` ON `supply_allocation_receipts` (`tenant_id`,`receipt_movement_id`);--> statement-breakpoint
CREATE INDEX `idx_supply_allocation_receipts_reservation` ON `supply_allocation_receipts` (`tenant_id`,`reservation_id`);--> statement-breakpoint
DROP INDEX `idx_supply_allocations_pair`;--> statement-breakpoint
DROP INDEX `idx_supply_allocations_purchase_line_status`;--> statement-breakpoint
DROP INDEX `idx_supply_allocations_sales_line_status`;--> statement-breakpoint
ALTER TABLE `supply_allocations` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_supply_allocations_pair` ON `supply_allocations` (`tenant_id`,`purchase_order_line_id`,`sales_order_line_id`);--> statement-breakpoint
CREATE INDEX `idx_supply_allocations_purchase_line_status` ON `supply_allocations` (`tenant_id`,`purchase_order_line_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_supply_allocations_sales_line_status` ON `supply_allocations` (`tenant_id`,`sales_order_line_id`,`status`);--> statement-breakpoint
DROP INDEX `idx_uom_conversion_scope`;--> statement-breakpoint
ALTER TABLE `uom_conversions` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_uom_conversion_scope` ON `uom_conversions` (`tenant_id`,`product_id`,`from_uom_id`,`to_uom_id`);--> statement-breakpoint
DROP INDEX `idx_vendor_bill_lines_bill`;--> statement-breakpoint
DROP INDEX `idx_vendor_bill_lines_purchase_line`;--> statement-breakpoint
ALTER TABLE `vendor_bill_lines` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_vendor_bill_lines_bill` ON `vendor_bill_lines` (`tenant_id`,`vendor_bill_id`);--> statement-breakpoint
CREATE INDEX `idx_vendor_bill_lines_purchase_line` ON `vendor_bill_lines` (`tenant_id`,`purchase_order_line_id`);--> statement-breakpoint
CREATE TABLE `__new_qbo_sync_cursors` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`connection_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`last_changed_at` text NOT NULL,
	`last_checked_at` text NOT NULL,
	`last_error` text,
	PRIMARY KEY(`tenant_id`, `connection_id`, `entity_type`),
	FOREIGN KEY (`connection_id`) REFERENCES `qbo_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_qbo_sync_cursors`("tenant_id", "connection_id", "entity_type", "last_changed_at", "last_checked_at", "last_error") SELECT 'tenant-default', "connection_id", "entity_type", "last_changed_at", "last_checked_at", "last_error" FROM `qbo_sync_cursors`;--> statement-breakpoint
DROP TABLE `qbo_sync_cursors`;--> statement-breakpoint
ALTER TABLE `__new_qbo_sync_cursors` RENAME TO `qbo_sync_cursors`;--> statement-breakpoint
CREATE TABLE `__new_command_log` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`idempotency_key` text NOT NULL,
	`command` text NOT NULL,
	`entity_id` text NOT NULL,
	`response_json` text NOT NULL,
	`request_hash` text,
	`claim_token` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `idempotency_key`)
);
--> statement-breakpoint
INSERT INTO `__new_command_log`("tenant_id", "idempotency_key", "command", "entity_id", "response_json", "request_hash", "claim_token", "created_at") SELECT 'tenant-default', "idempotency_key", "command", "entity_id", "response_json", "request_hash", "claim_token", "created_at" FROM `command_log`;--> statement-breakpoint
DROP TABLE `command_log`;--> statement-breakpoint
ALTER TABLE `__new_command_log` RENAME TO `command_log`;--> statement-breakpoint
CREATE TABLE `__new_document_sequences` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`prefix` text NOT NULL,
	`next_value` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `prefix`)
);
--> statement-breakpoint
INSERT INTO `__new_document_sequences`("tenant_id", "prefix", "next_value", "updated_at") SELECT 'tenant-default', "prefix", "next_value", "updated_at" FROM `document_sequences`;--> statement-breakpoint
DROP TABLE `document_sequences`;--> statement-breakpoint
ALTER TABLE `__new_document_sequences` RENAME TO `document_sequences`;--> statement-breakpoint
CREATE TABLE `__new_helcim_connections` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`id` text NOT NULL,
	`encrypted_api_token` text NOT NULL,
	`invoice_host` text NOT NULL,
	`payment_method` text DEFAULT 'cc-ach' NOT NULL,
	`connected_by` text NOT NULL,
	`connected_by_id` text,
	`connected_by_email` text,
	`connected_at` text NOT NULL,
	`verified_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `id`),
	CONSTRAINT "helcim_connection_id_check" CHECK("__new_helcim_connections"."id" = 'primary'),
	CONSTRAINT "helcim_connection_payment_method_check" CHECK("__new_helcim_connections"."payment_method" IN ('cc','ach','cc-ach'))
);
--> statement-breakpoint
INSERT INTO `__new_helcim_connections`("tenant_id", "id", "encrypted_api_token", "invoice_host", "payment_method", "connected_by", "connected_by_id", "connected_by_email", "connected_at", "verified_at", "updated_at") SELECT 'tenant-default', "id", "encrypted_api_token", "invoice_host", "payment_method", "connected_by", "connected_by_id", "connected_by_email", "connected_at", "verified_at", "updated_at" FROM `helcim_connections`;--> statement-breakpoint
DROP TABLE `helcim_connections`;--> statement-breakpoint
ALTER TABLE `__new_helcim_connections` RENAME TO `helcim_connections`;--> statement-breakpoint
CREATE TABLE `__new_system_settings` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`description` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `key`)
);
--> statement-breakpoint
INSERT INTO `__new_system_settings`("tenant_id", "key", "value_json", "description", "version", "updated_by", "updated_at") SELECT 'tenant-default', "key", "value_json", "description", "version", "updated_by", "updated_at" FROM `system_settings`;--> statement-breakpoint
DROP TABLE `system_settings`;--> statement-breakpoint
ALTER TABLE `__new_system_settings` RENAME TO `system_settings`;--> statement-breakpoint
CREATE TABLE `__new_valuation_policies` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`product_id` text NOT NULL,
	`method` text DEFAULT 'fifo' NOT NULL,
	`standard_cost_cents` integer DEFAULT 0 NOT NULL,
	`average_cost_cents` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `product_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "valuation_method_check" CHECK("__new_valuation_policies"."method" IN ('fifo','average','standard'))
);
--> statement-breakpoint
INSERT INTO `__new_valuation_policies`("tenant_id", "product_id", "method", "standard_cost_cents", "average_cost_cents", "version", "updated_at", "updated_by") SELECT 'tenant-default', "product_id", "method", "standard_cost_cents", "average_cost_cents", "version", "updated_at", "updated_by" FROM `valuation_policies`;--> statement-breakpoint
DROP TABLE `valuation_policies`;--> statement-breakpoint
ALTER TABLE `__new_valuation_policies` RENAME TO `valuation_policies`;--> statement-breakpoint
ALTER TABLE `inventory_transfer_lines` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
ALTER TABLE `landed_cost_allocation_lines` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
ALTER TABLE `period_locks` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;--> statement-breakpoint
ALTER TABLE `returnable_events` ADD `tenant_id` text DEFAULT 'tenant-default' NOT NULL;
