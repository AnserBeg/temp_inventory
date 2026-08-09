UPDATE `purchase_orders`
SET `base_total_cents` = ROUND(`total_cents` * COALESCE(NULLIF(`exchange_rate_to_base`, 0), 1))
WHERE `base_total_cents` = 0 AND `total_cents` <> 0;--> statement-breakpoint
UPDATE `sales_orders`
SET `base_total_cents` = ROUND(`total_cents` * COALESCE(NULLIF(`exchange_rate_to_base`, 0), 1))
WHERE `base_total_cents` = 0 AND `total_cents` <> 0;--> statement-breakpoint
UPDATE `vendor_bills`
SET `subtotal_cents` = CASE WHEN `subtotal_cents` = 0 AND `tax_cents` = 0 THEN `total_cents` ELSE `subtotal_cents` END,
    `base_total_cents` = ROUND(`total_cents` * COALESCE(NULLIF(`exchange_rate_to_base`, 0), 1))
WHERE (`subtotal_cents` = 0 AND `tax_cents` = 0 AND `total_cents` <> 0)
   OR (`base_total_cents` = 0 AND `total_cents` <> 0);--> statement-breakpoint
UPDATE `customer_invoices`
SET `base_total_cents` = ROUND(`total_cents` * COALESCE(NULLIF(`exchange_rate_to_base`, 0), 1))
WHERE `base_total_cents` = 0 AND `total_cents` <> 0;--> statement-breakpoint
UPDATE `vendor_credits`
SET `base_amount_cents` = ROUND(`amount_cents` * COALESCE(NULLIF(`exchange_rate_to_base`, 0), 1))
WHERE `base_amount_cents` = 0 AND `amount_cents` <> 0;--> statement-breakpoint
UPDATE `customer_credits`
SET `base_amount_cents` = ROUND(`amount_cents` * COALESCE(NULLIF(`exchange_rate_to_base`, 0), 1))
WHERE `base_amount_cents` = 0 AND `amount_cents` <> 0;--> statement-breakpoint
UPDATE `payments`
SET `base_amount_cents` = ROUND(`amount_cents` * COALESCE(NULLIF(`exchange_rate_to_base`, 0), 1))
WHERE `base_amount_cents` = 0 AND `amount_cents` <> 0;--> statement-breakpoint
INSERT OR IGNORE INTO `valuation_policies`
  (`product_id`, `method`, `standard_cost_cents`, `average_cost_cents`, `version`, `updated_at`, `updated_by`)
SELECT p.`id`, 'fifo', p.`standard_cost_cents`, p.`standard_cost_cents`, 1, CURRENT_TIMESTAMP, 'System migration'
FROM `products` p;--> statement-breakpoint
INSERT OR IGNORE INTO `cost_layers`
  (`id`, `product_id`, `receipt_movement_id`, `received_qty`, `remaining_qty`, `unit_cost_cents`, `landed_cost_cents`, `received_at`, `status`)
SELECT 'layer-migration-opening-' || p.`id`, p.`id`, NULL,
       SUM(ib.`on_hand_qty`), SUM(ib.`on_hand_qty`), p.`standard_cost_cents`, 0, CURRENT_TIMESTAMP, 'open'
FROM `products` p
JOIN `inventory_balances` ib ON ib.`product_id` = p.`id`
WHERE NOT EXISTS (SELECT 1 FROM `cost_layers` cl WHERE cl.`product_id` = p.`id`)
GROUP BY p.`id`
HAVING SUM(ib.`on_hand_qty`) > 0;--> statement-breakpoint
INSERT OR IGNORE INTO `inventory_value_entries`
  (`id`, `product_id`, `movement_id`, `entry_type`, `quantity`, `unit_cost_cents`, `value_cents`, `cost_method`, `reference_type`, `reference_id`, `posted_at`, `posted_by`)
SELECT 'value-migration-opening-' || p.`id`, p.`id`, NULL, 'migration_opening_balance',
       SUM(ib.`on_hand_qty`), p.`standard_cost_cents`, ROUND(SUM(ib.`on_hand_qty`) * p.`standard_cost_cents`),
       COALESCE(vp.`method`, 'fifo'), 'system_migration', 'migration-opening-' || p.`id`, CURRENT_TIMESTAMP, 'System migration'
FROM `products` p
JOIN `inventory_balances` ib ON ib.`product_id` = p.`id`
LEFT JOIN `valuation_policies` vp ON vp.`product_id` = p.`id`
WHERE NOT EXISTS (SELECT 1 FROM `inventory_value_entries` ive WHERE ive.`product_id` = p.`id`)
GROUP BY p.`id`
HAVING SUM(ib.`on_hand_qty`) > 0;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `inventory_balances_nonnegative_insert`
BEFORE INSERT ON `inventory_balances`
WHEN NEW.`on_hand_qty` < 0 OR NEW.`reserved_qty` < 0 OR NEW.`reserved_qty` > NEW.`on_hand_qty`
BEGIN SELECT RAISE(ABORT, 'inventory balance invariant violated'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `inventory_balances_nonnegative_update`
BEFORE UPDATE ON `inventory_balances`
WHEN NEW.`on_hand_qty` < 0 OR NEW.`reserved_qty` < 0 OR NEW.`reserved_qty` > NEW.`on_hand_qty`
BEGIN SELECT RAISE(ABORT, 'inventory balance invariant violated'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `stock_movements_immutable_update`
BEFORE UPDATE ON `stock_movements`
BEGIN SELECT RAISE(ABORT, 'stock movement ledger is immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `stock_movements_immutable_delete`
BEFORE DELETE ON `stock_movements`
BEGIN SELECT RAISE(ABORT, 'stock movement ledger is immutable'); END;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vendor_bills_invoice_date` ON `vendor_bills` (`invoice_date`, `number`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_customer_invoices_invoice_date` ON `customer_invoices` (`invoice_date`, `number`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_payments_payment_date` ON `payments` (`payment_date`, `number`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_returnable_events_posted_at` ON `returnable_events` (`posted_at`, `id`);--> statement-breakpoint
PRAGMA optimize;
