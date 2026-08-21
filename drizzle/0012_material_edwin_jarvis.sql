ALTER TABLE `purchase_order_lines` ADD `discount_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_order_lines` ADD `taxable` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_order_lines` ADD `tax_rate_bps` integer DEFAULT 0 NOT NULL;