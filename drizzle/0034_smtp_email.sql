CREATE TABLE `smtp_email_connections` (
  `tenant_id` text DEFAULT 'tenant-default' NOT NULL,
  `user_id` text NOT NULL,
  `email_address` text NOT NULL,
  `host` text NOT NULL,
  `port` integer NOT NULL,
  `username` text NOT NULL,
  `encrypted_password` text NOT NULL,
  `status` text DEFAULT 'connected' NOT NULL,
  `connected_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `last_error` text,
  `version` integer DEFAULT 1 NOT NULL,
  PRIMARY KEY (`tenant_id`,`user_id`),
  CONSTRAINT `smtp_email_connections_port_check` CHECK (`port` IN (465,587,2525)),
  CONSTRAINT `smtp_email_connections_status_check` CHECK (`status` IN ('connected','error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_smtp_email_connections_address` ON `smtp_email_connections` (`tenant_id`,`email_address`);
--> statement-breakpoint
CREATE INDEX `idx_smtp_email_connections_status` ON `smtp_email_connections` (`tenant_id`,`status`);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_document_email_deliveries` (
  `tenant_id` text DEFAULT 'tenant-default' NOT NULL,
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `provider` text NOT NULL,
  `sender_type` text DEFAULT 'personal' NOT NULL,
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
  CONSTRAINT `document_email_deliveries_provider_check` CHECK (`provider` IN ('google','microsoft','smtp')),
  CONSTRAINT `document_email_deliveries_sender_type_check` CHECK (`sender_type` IN ('company','personal')),
  CONSTRAINT `document_email_deliveries_type_check` CHECK (`document_type` IN ('purchase_order','sales_order','customer_invoice')),
  CONSTRAINT `document_email_deliveries_status_check` CHECK (`status` IN ('pending','sent','failed'))
);
--> statement-breakpoint
INSERT INTO `__new_document_email_deliveries` (`tenant_id`,`id`,`user_id`,`provider`,`sender_type`,`sender_email`,`document_type`,`document_id`,`document_number`,`recipients_json`,`subject`,`status`,`provider_message_id`,`last_error`,`created_at`,`sent_at`)
SELECT `tenant_id`,`id`,`user_id`,`provider`,`sender_type`,`sender_email`,`document_type`,`document_id`,`document_number`,`recipients_json`,`subject`,`status`,`provider_message_id`,`last_error`,`created_at`,`sent_at` FROM `document_email_deliveries`;
--> statement-breakpoint
DROP TABLE `document_email_deliveries`;
--> statement-breakpoint
ALTER TABLE `__new_document_email_deliveries` RENAME TO `document_email_deliveries`;
--> statement-breakpoint
CREATE INDEX `idx_document_email_deliveries_document` ON `document_email_deliveries` (`tenant_id`,`document_type`,`document_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_document_email_deliveries_user_created` ON `document_email_deliveries` (`tenant_id`,`user_id`,`created_at`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
