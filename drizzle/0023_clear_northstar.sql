CREATE TABLE `catalog_price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`event_type` text NOT NULL,
	`cost_basis_cents` integer NOT NULL,
	`previous_selling_price_cents` integer NOT NULL,
	`suggested_selling_price_cents` integer NOT NULL,
	`effective_selling_price_cents` integer NOT NULL,
	`pricing_mode` text NOT NULL,
	`margin_rule_id` text,
	`source_purchase_order_id` text,
	`reason` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`margin_rule_id`) REFERENCES `margin_rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "catalog_price_history_mode_check" CHECK("catalog_price_history"."pricing_mode" IN ('automatic','manual'))
);
--> statement-breakpoint
CREATE INDEX `idx_catalog_price_history_product` ON `catalog_price_history` (`product_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `margin_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`product_id` text,
	`category` text,
	`minimum_cost_cents` integer DEFAULT 0 NOT NULL,
	`maximum_cost_cents` integer,
	`target_margin_bps` integer NOT NULL,
	`minimum_gross_profit_cents` integer DEFAULT 0 NOT NULL,
	`rounding_increment_cents` integer DEFAULT 100 NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "margin_rules_cost_range_check" CHECK("margin_rules"."minimum_cost_cents" >= 0 AND ("margin_rules"."maximum_cost_cents" IS NULL OR "margin_rules"."maximum_cost_cents" > "margin_rules"."minimum_cost_cents")),
	CONSTRAINT "margin_rules_margin_check" CHECK("margin_rules"."target_margin_bps" >= 0 AND "margin_rules"."target_margin_bps" < 10000),
	CONSTRAINT "margin_rules_profit_check" CHECK("margin_rules"."minimum_gross_profit_cents" >= 0),
	CONSTRAINT "margin_rules_rounding_check" CHECK("margin_rules"."rounding_increment_cents" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_margin_rules_code` ON `margin_rules` (`code`);--> statement-breakpoint
CREATE INDEX `idx_margin_rules_resolution` ON `margin_rules` (`active`,`product_id`,`category`,`minimum_cost_cents`,`priority`);--> statement-breakpoint
CREATE TABLE `product_cost_history` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`source_purchase_order_id` text NOT NULL,
	`source_purchase_order_line_id` text,
	`purchase_order_revision` integer NOT NULL,
	`vendor_id` text NOT NULL,
	`last_unit_cost_cents` integer NOT NULL,
	`source_currency` text NOT NULL,
	`exchange_rate_to_base` real NOT NULL,
	`effective_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_purchase_order_line_id`) REFERENCES `purchase_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `business_partners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "product_cost_history_cost_check" CHECK("product_cost_history"."last_unit_cost_cents" >= 0),
	CONSTRAINT "product_cost_history_exchange_check" CHECK("product_cost_history"."exchange_rate_to_base" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_cost_history_source` ON `product_cost_history` (`product_id`,`source_purchase_order_id`,`purchase_order_revision`);--> statement-breakpoint
CREATE INDEX `idx_product_cost_history_latest` ON `product_cost_history` (`product_id`,`effective_at`);--> statement-breakpoint
ALTER TABLE `products` ADD `last_unit_cost_cents` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `last_unit_cost_source_po_id` text;--> statement-breakpoint
ALTER TABLE `products` ADD `last_unit_cost_source_po_line_id` text;--> statement-breakpoint
ALTER TABLE `products` ADD `last_unit_cost_vendor_id` text;--> statement-breakpoint
ALTER TABLE `products` ADD `last_unit_cost_at` text;--> statement-breakpoint
ALTER TABLE `products` ADD `suggested_selling_price_cents` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `pricing_mode` text DEFAULT 'manual' NOT NULL CHECK (`pricing_mode` IN ('automatic','manual'));--> statement-breakpoint
ALTER TABLE `products` ADD `applied_margin_rule_id` text;--> statement-breakpoint
ALTER TABLE `products` ADD `manual_price_reason` text;--> statement-breakpoint
ALTER TABLE `products` ADD `pricing_updated_at` text;--> statement-breakpoint
CREATE INDEX `idx_products_pricing_mode` ON `products` (`pricing_mode`,`category`);--> statement-breakpoint
INSERT INTO `margin_rules`
  (`id`,`code`,`name`,`product_id`,`category`,`minimum_cost_cents`,`maximum_cost_cents`,`target_margin_bps`,`minimum_gross_profit_cents`,`rounding_increment_cents`,`priority`,`valid_from`,`valid_to`,`active`,`version`,`created_at`,`updated_at`)
VALUES
  ('margin-default-32','DEFAULT-32','Default 32% gross margin',NULL,NULL,0,NULL,3200,0,100,0,NULL,NULL,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);--> statement-breakpoint
WITH po_product_costs AS (
  SELECT pol.product_id,po.id AS purchase_order_id,
    CASE WHEN COUNT(*)=1 THEN MIN(pol.id) ELSE NULL END AS purchase_order_line_id,
    po.vendor_id,po.revision_number,po.currency,po.exchange_rate_to_base,po.created_at,
    ROUND(MAX(SUM(pol.ordered_qty*pol.unit_cost_cents)-SUM(pol.discount_cents),0)*po.exchange_rate_to_base/SUM(pol.ordered_qty)) AS last_unit_cost_cents
  FROM purchase_order_lines pol
  JOIN purchase_orders po ON po.id=pol.purchase_order_id
  WHERE po.lifecycle_status='approved' AND pol.ordered_qty>0
  GROUP BY pol.product_id,po.id
), ranked AS (
  SELECT *,ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at DESC,purchase_order_id DESC) AS rn
  FROM po_product_costs
)
UPDATE products SET
  (last_unit_cost_cents,last_unit_cost_source_po_id,last_unit_cost_source_po_line_id,last_unit_cost_vendor_id,last_unit_cost_at) =
  (SELECT last_unit_cost_cents,purchase_order_id,purchase_order_line_id,vendor_id,created_at FROM ranked WHERE ranked.product_id=products.id AND rn=1)
WHERE EXISTS (SELECT 1 FROM ranked WHERE ranked.product_id=products.id AND rn=1);--> statement-breakpoint
WITH po_product_costs AS (
  SELECT pol.product_id,po.id AS purchase_order_id,
    CASE WHEN COUNT(*)=1 THEN MIN(pol.id) ELSE NULL END AS purchase_order_line_id,
    po.vendor_id,po.revision_number,po.currency,po.exchange_rate_to_base,po.created_at,
    ROUND(MAX(SUM(pol.ordered_qty*pol.unit_cost_cents)-SUM(pol.discount_cents),0)*po.exchange_rate_to_base/SUM(pol.ordered_qty)) AS last_unit_cost_cents
  FROM purchase_order_lines pol
  JOIN purchase_orders po ON po.id=pol.purchase_order_id
  WHERE po.lifecycle_status='approved' AND pol.ordered_qty>0
  GROUP BY pol.product_id,po.id
), ranked AS (
  SELECT *,ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at DESC,purchase_order_id DESC) AS rn
  FROM po_product_costs
)
INSERT INTO product_cost_history
  (id,product_id,source_purchase_order_id,source_purchase_order_line_id,purchase_order_revision,vendor_id,last_unit_cost_cents,source_currency,exchange_rate_to_base,effective_at,recorded_by)
SELECT 'cost-backfill-'||product_id,product_id,purchase_order_id,purchase_order_line_id,revision_number,vendor_id,last_unit_cost_cents,currency,exchange_rate_to_base,created_at,'System migration'
FROM ranked WHERE rn=1;--> statement-breakpoint
UPDATE products SET
  suggested_selling_price_cents=CAST(((COALESCE(last_unit_cost_cents,standard_cost_cents)/0.68)+99)/100 AS INTEGER)*100,
  applied_margin_rule_id='margin-default-32',
  manual_price_reason='Existing catalog price preserved during automatic-pricing rollout',
  pricing_updated_at=CURRENT_TIMESTAMP;--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-backfill-'||id,id,'migration_backfill',COALESCE(last_unit_cost_cents,standard_cost_cents),selling_price_cents,suggested_selling_price_cents,selling_price_cents,'manual',applied_margin_rule_id,last_unit_cost_source_po_id,manual_price_reason,CURRENT_TIMESTAMP,'System migration'
FROM products;
