ALTER TABLE `email_oauth_states` ADD `connection_type` text DEFAULT 'personal' NOT NULL
  CONSTRAINT `email_oauth_states_connection_type_check` CHECK (`connection_type` IN ('company','personal'));
--> statement-breakpoint
ALTER TABLE `document_email_deliveries` ADD `sender_type` text DEFAULT 'personal' NOT NULL
  CONSTRAINT `document_email_deliveries_sender_type_check` CHECK (`sender_type` IN ('company','personal'));
