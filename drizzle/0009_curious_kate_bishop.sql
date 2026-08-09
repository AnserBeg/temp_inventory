ALTER TABLE `business_partners` ADD `address_line_1` text;--> statement-breakpoint
ALTER TABLE `business_partners` ADD `address_line_2` text;--> statement-breakpoint
ALTER TABLE `business_partners` ADD `city` text;--> statement-breakpoint
ALTER TABLE `business_partners` ADD `region` text;--> statement-breakpoint
ALTER TABLE `business_partners` ADD `postal_code` text;--> statement-breakpoint
ALTER TABLE `business_partners` ADD `country` text DEFAULT 'CA' NOT NULL;--> statement-breakpoint
ALTER TABLE `business_partners` ADD `credit_limit_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `business_partners` ADD `credit_hold` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `ship_to_name` text;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `ship_to_address_line_1` text;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `ship_to_address_line_2` text;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `ship_to_city` text;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `ship_to_region` text;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `ship_to_postal_code` text;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `ship_to_country` text;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `delivery_instructions` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `carrier` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `service_level` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `tracking_number` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `bill_of_lading_number` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `ship_to_name` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `ship_to_address_line_1` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `ship_to_address_line_2` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `ship_to_city` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `ship_to_region` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `ship_to_postal_code` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `ship_to_country` text;