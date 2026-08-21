ALTER TABLE `purchase_order_lines` ADD `tax_code` text DEFAULT 'EXEMPT' NOT NULL;--> statement-breakpoint
UPDATE `purchase_order_lines` SET `tax_code`=CASE WHEN `taxable`=1 AND `tax_rate_bps`>0 THEN 'GST' WHEN `taxable`=1 THEN 'ZERO' ELSE 'EXEMPT' END;--> statement-breakpoint
ALTER TABLE `sales_order_lines` ADD `tax_code` text DEFAULT 'EXEMPT' NOT NULL;--> statement-breakpoint
UPDATE `sales_order_lines` SET `tax_code`=CASE WHEN `taxable`=1 AND `tax_rate_bps`>0 THEN 'GST' WHEN `taxable`=1 THEN 'ZERO' ELSE 'EXEMPT' END;
