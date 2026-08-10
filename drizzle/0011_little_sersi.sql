CREATE TABLE `document_sequences` (
	`prefix` text PRIMARY KEY NOT NULL,
	`next_value` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `partner_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`label` text NOT NULL,
	`contact_name` text,
	`address_line_1` text NOT NULL,
	`address_line_2` text,
	`city` text NOT NULL,
	`region` text NOT NULL,
	`postal_code` text NOT NULL,
	`country` text DEFAULT 'CA' NOT NULL,
	`delivery_instructions` text,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `business_partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_partner_addresses_label` ON `partner_addresses` (`partner_id`,`label`);--> statement-breakpoint
CREATE INDEX `idx_partner_addresses_partner_active` ON `partner_addresses` (`partner_id`,`active`,`is_default`);