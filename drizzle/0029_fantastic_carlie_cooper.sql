CREATE TABLE `helcim_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`encrypted_api_token` text NOT NULL,
	`invoice_host` text NOT NULL,
	`payment_method` text DEFAULT 'cc-ach' NOT NULL,
	`connected_by` text NOT NULL,
	`connected_by_id` text,
	`connected_by_email` text,
	`connected_at` text NOT NULL,
	`verified_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "helcim_connection_id_check" CHECK("helcim_connections"."id" = 'primary'),
	CONSTRAINT "helcim_connection_payment_method_check" CHECK("helcim_connections"."payment_method" IN ('cc','ach','cc-ach'))
);
