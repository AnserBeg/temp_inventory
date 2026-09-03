CREATE TRIGGER `tenant_guard_catalog_price_history_margin_rule_id_insert` BEFORE INSERT ON `catalog_price_history` WHEN NEW.`margin_rule_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `margin_rules` WHERE `id`=NEW.`margin_rule_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_catalog_price_history_margin_rule_id_update` BEFORE UPDATE OF `margin_rule_id`,`tenant_id` ON `catalog_price_history` WHEN NEW.`margin_rule_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `margin_rules` WHERE `id`=NEW.`margin_rule_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_catalog_price_history_product_id_insert` BEFORE INSERT ON `catalog_price_history` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_catalog_price_history_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `catalog_price_history` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_catalog_price_history_source_purchase_order_id_insert` BEFORE INSERT ON `catalog_price_history` WHEN NEW.`source_purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`source_purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_catalog_price_history_source_purchase_order_id_update` BEFORE UPDATE OF `source_purchase_order_id`,`tenant_id` ON `catalog_price_history` WHEN NEW.`source_purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`source_purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_cost_layers_product_id_insert` BEFORE INSERT ON `cost_layers` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_cost_layers_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `cost_layers` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_cost_layers_receipt_movement_id_insert` BEFORE INSERT ON `cost_layers` WHEN NEW.`receipt_movement_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `stock_movements` WHERE `id`=NEW.`receipt_movement_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_cost_layers_receipt_movement_id_update` BEFORE UPDATE OF `receipt_movement_id`,`tenant_id` ON `cost_layers` WHEN NEW.`receipt_movement_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `stock_movements` WHERE `id`=NEW.`receipt_movement_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_credits_customer_invoice_id_insert` BEFORE INSERT ON `customer_credits` WHEN NEW.`customer_invoice_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `customer_invoices` WHERE `id`=NEW.`customer_invoice_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_credits_customer_invoice_id_update` BEFORE UPDATE OF `customer_invoice_id`,`tenant_id` ON `customer_credits` WHEN NEW.`customer_invoice_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `customer_invoices` WHERE `id`=NEW.`customer_invoice_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_credits_sales_order_id_insert` BEFORE INSERT ON `customer_credits` WHEN NEW.`sales_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_orders` WHERE `id`=NEW.`sales_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_credits_sales_order_id_update` BEFORE UPDATE OF `sales_order_id`,`tenant_id` ON `customer_credits` WHEN NEW.`sales_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_orders` WHERE `id`=NEW.`sales_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_invoice_lines_customer_invoice_id_insert` BEFORE INSERT ON `customer_invoice_lines` WHEN NEW.`customer_invoice_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `customer_invoices` WHERE `id`=NEW.`customer_invoice_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_invoice_lines_customer_invoice_id_update` BEFORE UPDATE OF `customer_invoice_id`,`tenant_id` ON `customer_invoice_lines` WHEN NEW.`customer_invoice_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `customer_invoices` WHERE `id`=NEW.`customer_invoice_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_invoice_lines_product_id_insert` BEFORE INSERT ON `customer_invoice_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_invoice_lines_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `customer_invoice_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_invoice_lines_sales_order_line_id_insert` BEFORE INSERT ON `customer_invoice_lines` WHEN NEW.`sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_invoice_lines_sales_order_line_id_update` BEFORE UPDATE OF `sales_order_line_id`,`tenant_id` ON `customer_invoice_lines` WHEN NEW.`sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_invoices_sales_order_id_insert` BEFORE INSERT ON `customer_invoices` WHEN NEW.`sales_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_orders` WHERE `id`=NEW.`sales_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_invoices_sales_order_id_update` BEFORE UPDATE OF `sales_order_id`,`tenant_id` ON `customer_invoices` WHEN NEW.`sales_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_orders` WHERE `id`=NEW.`sales_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_returns_location_id_insert` BEFORE INSERT ON `customer_returns` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_returns_location_id_update` BEFORE UPDATE OF `location_id`,`tenant_id` ON `customer_returns` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_returns_product_id_insert` BEFORE INSERT ON `customer_returns` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_returns_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `customer_returns` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_returns_sales_order_id_insert` BEFORE INSERT ON `customer_returns` WHEN NEW.`sales_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_orders` WHERE `id`=NEW.`sales_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_returns_sales_order_id_update` BEFORE UPDATE OF `sales_order_id`,`tenant_id` ON `customer_returns` WHEN NEW.`sales_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_orders` WHERE `id`=NEW.`sales_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_returns_sales_order_line_id_insert` BEFORE INSERT ON `customer_returns` WHEN NEW.`sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_customer_returns_sales_order_line_id_update` BEFORE UPDATE OF `sales_order_line_id`,`tenant_id` ON `customer_returns` WHEN NEW.`sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_drop_ship_deliveries_product_id_insert` BEFORE INSERT ON `drop_ship_deliveries` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_drop_ship_deliveries_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `drop_ship_deliveries` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_drop_ship_deliveries_purchase_order_id_insert` BEFORE INSERT ON `drop_ship_deliveries` WHEN NEW.`purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_drop_ship_deliveries_purchase_order_id_update` BEFORE UPDATE OF `purchase_order_id`,`tenant_id` ON `drop_ship_deliveries` WHEN NEW.`purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_drop_ship_deliveries_purchase_order_line_id_insert` BEFORE INSERT ON `drop_ship_deliveries` WHEN NEW.`purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_drop_ship_deliveries_purchase_order_line_id_update` BEFORE UPDATE OF `purchase_order_line_id`,`tenant_id` ON `drop_ship_deliveries` WHEN NEW.`purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_drop_ship_deliveries_sales_order_id_insert` BEFORE INSERT ON `drop_ship_deliveries` WHEN NEW.`sales_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_orders` WHERE `id`=NEW.`sales_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_drop_ship_deliveries_sales_order_id_update` BEFORE UPDATE OF `sales_order_id`,`tenant_id` ON `drop_ship_deliveries` WHEN NEW.`sales_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_orders` WHERE `id`=NEW.`sales_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_drop_ship_deliveries_sales_order_line_id_insert` BEFORE INSERT ON `drop_ship_deliveries` WHEN NEW.`sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_drop_ship_deliveries_sales_order_line_id_update` BEFORE UPDATE OF `sales_order_line_id`,`tenant_id` ON `drop_ship_deliveries` WHEN NEW.`sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_helcim_checkout_sessions_customer_invoice_id_insert` BEFORE INSERT ON `helcim_checkout_sessions` WHEN NEW.`customer_invoice_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `customer_invoices` WHERE `id`=NEW.`customer_invoice_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_helcim_checkout_sessions_customer_invoice_id_update` BEFORE UPDATE OF `customer_invoice_id`,`tenant_id` ON `helcim_checkout_sessions` WHEN NEW.`customer_invoice_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `customer_invoices` WHERE `id`=NEW.`customer_invoice_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_helcim_checkout_sessions_payment_id_insert` BEFORE INSERT ON `helcim_checkout_sessions` WHEN NEW.`payment_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `payments` WHERE `id`=NEW.`payment_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_helcim_checkout_sessions_payment_id_update` BEFORE UPDATE OF `payment_id`,`tenant_id` ON `helcim_checkout_sessions` WHEN NEW.`payment_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `payments` WHERE `id`=NEW.`payment_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_helcim_checkout_sessions_payment_link_id_insert` BEFORE INSERT ON `helcim_checkout_sessions` WHEN NEW.`payment_link_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `invoice_payment_links` WHERE `id`=NEW.`payment_link_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_helcim_checkout_sessions_payment_link_id_update` BEFORE UPDATE OF `payment_link_id`,`tenant_id` ON `helcim_checkout_sessions` WHEN NEW.`payment_link_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `invoice_payment_links` WHERE `id`=NEW.`payment_link_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_helcim_invoice_mirrors_customer_invoice_id_insert` BEFORE INSERT ON `helcim_invoice_mirrors` WHEN NEW.`customer_invoice_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `customer_invoices` WHERE `id`=NEW.`customer_invoice_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_helcim_invoice_mirrors_customer_invoice_id_update` BEFORE UPDATE OF `customer_invoice_id`,`tenant_id` ON `helcim_invoice_mirrors` WHEN NEW.`customer_invoice_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `customer_invoices` WHERE `id`=NEW.`customer_invoice_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_balances_location_id_insert` BEFORE INSERT ON `inventory_balances` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_balances_location_id_update` BEFORE UPDATE OF `location_id`,`tenant_id` ON `inventory_balances` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_balances_product_id_insert` BEFORE INSERT ON `inventory_balances` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_balances_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `inventory_balances` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_count_session_lines_location_id_insert` BEFORE INSERT ON `inventory_count_session_lines` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_count_session_lines_location_id_update` BEFORE UPDATE OF `location_id`,`tenant_id` ON `inventory_count_session_lines` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_count_session_lines_product_id_insert` BEFORE INSERT ON `inventory_count_session_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_count_session_lines_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `inventory_count_session_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_count_session_lines_session_id_insert` BEFORE INSERT ON `inventory_count_session_lines` WHEN NEW.`session_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_count_sessions` WHERE `id`=NEW.`session_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_count_session_lines_session_id_update` BEFORE UPDATE OF `session_id`,`tenant_id` ON `inventory_count_session_lines` WHEN NEW.`session_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_count_sessions` WHERE `id`=NEW.`session_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_count_sessions_warehouse_id_insert` BEFORE INSERT ON `inventory_count_sessions` WHEN NEW.`warehouse_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `warehouses` WHERE `id`=NEW.`warehouse_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_count_sessions_warehouse_id_update` BEFORE UPDATE OF `warehouse_id`,`tenant_id` ON `inventory_count_sessions` WHEN NEW.`warehouse_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `warehouses` WHERE `id`=NEW.`warehouse_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_counts_count_session_id_insert` BEFORE INSERT ON `inventory_counts` WHEN NEW.`count_session_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_count_sessions` WHERE `id`=NEW.`count_session_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_counts_count_session_id_update` BEFORE UPDATE OF `count_session_id`,`tenant_id` ON `inventory_counts` WHEN NEW.`count_session_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_count_sessions` WHERE `id`=NEW.`count_session_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_counts_count_session_line_id_insert` BEFORE INSERT ON `inventory_counts` WHEN NEW.`count_session_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_count_session_lines` WHERE `id`=NEW.`count_session_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_counts_count_session_line_id_update` BEFORE UPDATE OF `count_session_line_id`,`tenant_id` ON `inventory_counts` WHEN NEW.`count_session_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_count_session_lines` WHERE `id`=NEW.`count_session_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_counts_location_id_insert` BEFORE INSERT ON `inventory_counts` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_counts_location_id_update` BEFORE UPDATE OF `location_id`,`tenant_id` ON `inventory_counts` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_counts_product_id_insert` BEFORE INSERT ON `inventory_counts` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_counts_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `inventory_counts` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_lots_product_id_insert` BEFORE INSERT ON `inventory_lots` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_lots_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `inventory_lots` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfer_lines_from_location_id_insert` BEFORE INSERT ON `inventory_transfer_lines` WHEN NEW.`from_location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`from_location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfer_lines_from_location_id_update` BEFORE UPDATE OF `from_location_id`,`tenant_id` ON `inventory_transfer_lines` WHEN NEW.`from_location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`from_location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfer_lines_inventory_unit_id_insert` BEFORE INSERT ON `inventory_transfer_lines` WHEN NEW.`inventory_unit_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_units` WHERE `id`=NEW.`inventory_unit_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfer_lines_inventory_unit_id_update` BEFORE UPDATE OF `inventory_unit_id`,`tenant_id` ON `inventory_transfer_lines` WHEN NEW.`inventory_unit_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_units` WHERE `id`=NEW.`inventory_unit_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfer_lines_lot_id_insert` BEFORE INSERT ON `inventory_transfer_lines` WHEN NEW.`lot_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_lots` WHERE `id`=NEW.`lot_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfer_lines_lot_id_update` BEFORE UPDATE OF `lot_id`,`tenant_id` ON `inventory_transfer_lines` WHEN NEW.`lot_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_lots` WHERE `id`=NEW.`lot_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfer_lines_product_id_insert` BEFORE INSERT ON `inventory_transfer_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfer_lines_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `inventory_transfer_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfer_lines_to_location_id_insert` BEFORE INSERT ON `inventory_transfer_lines` WHEN NEW.`to_location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`to_location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfer_lines_to_location_id_update` BEFORE UPDATE OF `to_location_id`,`tenant_id` ON `inventory_transfer_lines` WHEN NEW.`to_location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`to_location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfer_lines_transfer_id_insert` BEFORE INSERT ON `inventory_transfer_lines` WHEN NEW.`transfer_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_transfers` WHERE `id`=NEW.`transfer_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfer_lines_transfer_id_update` BEFORE UPDATE OF `transfer_id`,`tenant_id` ON `inventory_transfer_lines` WHEN NEW.`transfer_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_transfers` WHERE `id`=NEW.`transfer_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfers_from_warehouse_id_insert` BEFORE INSERT ON `inventory_transfers` WHEN NEW.`from_warehouse_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `warehouses` WHERE `id`=NEW.`from_warehouse_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfers_from_warehouse_id_update` BEFORE UPDATE OF `from_warehouse_id`,`tenant_id` ON `inventory_transfers` WHEN NEW.`from_warehouse_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `warehouses` WHERE `id`=NEW.`from_warehouse_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfers_in_transit_location_id_insert` BEFORE INSERT ON `inventory_transfers` WHEN NEW.`in_transit_location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`in_transit_location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfers_in_transit_location_id_update` BEFORE UPDATE OF `in_transit_location_id`,`tenant_id` ON `inventory_transfers` WHEN NEW.`in_transit_location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`in_transit_location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfers_to_warehouse_id_insert` BEFORE INSERT ON `inventory_transfers` WHEN NEW.`to_warehouse_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `warehouses` WHERE `id`=NEW.`to_warehouse_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_transfers_to_warehouse_id_update` BEFORE UPDATE OF `to_warehouse_id`,`tenant_id` ON `inventory_transfers` WHEN NEW.`to_warehouse_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `warehouses` WHERE `id`=NEW.`to_warehouse_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_units_location_id_insert` BEFORE INSERT ON `inventory_units` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_units_location_id_update` BEFORE UPDATE OF `location_id`,`tenant_id` ON `inventory_units` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_units_lot_id_insert` BEFORE INSERT ON `inventory_units` WHEN NEW.`lot_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_lots` WHERE `id`=NEW.`lot_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_units_lot_id_update` BEFORE UPDATE OF `lot_id`,`tenant_id` ON `inventory_units` WHEN NEW.`lot_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_lots` WHERE `id`=NEW.`lot_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_units_product_id_insert` BEFORE INSERT ON `inventory_units` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_units_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `inventory_units` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_value_entries_movement_id_insert` BEFORE INSERT ON `inventory_value_entries` WHEN NEW.`movement_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `stock_movements` WHERE `id`=NEW.`movement_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_value_entries_movement_id_update` BEFORE UPDATE OF `movement_id`,`tenant_id` ON `inventory_value_entries` WHEN NEW.`movement_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `stock_movements` WHERE `id`=NEW.`movement_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_value_entries_product_id_insert` BEFORE INSERT ON `inventory_value_entries` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_inventory_value_entries_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `inventory_value_entries` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_invoice_payment_links_customer_invoice_id_insert` BEFORE INSERT ON `invoice_payment_links` WHEN NEW.`customer_invoice_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `customer_invoices` WHERE `id`=NEW.`customer_invoice_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_invoice_payment_links_customer_invoice_id_update` BEFORE UPDATE OF `customer_invoice_id`,`tenant_id` ON `invoice_payment_links` WHEN NEW.`customer_invoice_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `customer_invoices` WHERE `id`=NEW.`customer_invoice_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_landed_cost_allocation_lines_allocation_id_insert` BEFORE INSERT ON `landed_cost_allocation_lines` WHEN NEW.`allocation_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `landed_cost_allocations` WHERE `id`=NEW.`allocation_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_landed_cost_allocation_lines_allocation_id_update` BEFORE UPDATE OF `allocation_id`,`tenant_id` ON `landed_cost_allocation_lines` WHEN NEW.`allocation_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `landed_cost_allocations` WHERE `id`=NEW.`allocation_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_landed_cost_allocation_lines_cost_layer_id_insert` BEFORE INSERT ON `landed_cost_allocation_lines` WHEN NEW.`cost_layer_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `cost_layers` WHERE `id`=NEW.`cost_layer_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_landed_cost_allocation_lines_cost_layer_id_update` BEFORE UPDATE OF `cost_layer_id`,`tenant_id` ON `landed_cost_allocation_lines` WHEN NEW.`cost_layer_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `cost_layers` WHERE `id`=NEW.`cost_layer_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_locations_parent_location_id_insert` BEFORE INSERT ON `locations` WHEN NEW.`parent_location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`parent_location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_locations_parent_location_id_update` BEFORE UPDATE OF `parent_location_id`,`tenant_id` ON `locations` WHEN NEW.`parent_location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`parent_location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_locations_warehouse_id_insert` BEFORE INSERT ON `locations` WHEN NEW.`warehouse_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `warehouses` WHERE `id`=NEW.`warehouse_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_locations_warehouse_id_update` BEFORE UPDATE OF `warehouse_id`,`tenant_id` ON `locations` WHEN NEW.`warehouse_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `warehouses` WHERE `id`=NEW.`warehouse_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_margin_rules_product_id_insert` BEFORE INSERT ON `margin_rules` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_margin_rules_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `margin_rules` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_movement_assignments_inventory_unit_id_insert` BEFORE INSERT ON `movement_assignments` WHEN NEW.`inventory_unit_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_units` WHERE `id`=NEW.`inventory_unit_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_movement_assignments_inventory_unit_id_update` BEFORE UPDATE OF `inventory_unit_id`,`tenant_id` ON `movement_assignments` WHEN NEW.`inventory_unit_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_units` WHERE `id`=NEW.`inventory_unit_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_movement_assignments_lot_id_insert` BEFORE INSERT ON `movement_assignments` WHEN NEW.`lot_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_lots` WHERE `id`=NEW.`lot_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_movement_assignments_lot_id_update` BEFORE UPDATE OF `lot_id`,`tenant_id` ON `movement_assignments` WHEN NEW.`lot_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `inventory_lots` WHERE `id`=NEW.`lot_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_movement_assignments_movement_id_insert` BEFORE INSERT ON `movement_assignments` WHEN NEW.`movement_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `stock_movements` WHERE `id`=NEW.`movement_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_movement_assignments_movement_id_update` BEFORE UPDATE OF `movement_id`,`tenant_id` ON `movement_assignments` WHEN NEW.`movement_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `stock_movements` WHERE `id`=NEW.`movement_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_partner_addresses_partner_id_insert` BEFORE INSERT ON `partner_addresses` WHEN NEW.`partner_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`partner_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_partner_addresses_partner_id_update` BEFORE UPDATE OF `partner_id`,`tenant_id` ON `partner_addresses` WHEN NEW.`partner_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`partner_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_payments_partner_id_insert` BEFORE INSERT ON `payments` WHEN NEW.`partner_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`partner_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_payments_partner_id_update` BEFORE UPDATE OF `partner_id`,`tenant_id` ON `payments` WHEN NEW.`partner_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`partner_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_price_list_assignments_partner_id_insert` BEFORE INSERT ON `price_list_assignments` WHEN NEW.`partner_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`partner_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_price_list_assignments_partner_id_update` BEFORE UPDATE OF `partner_id`,`tenant_id` ON `price_list_assignments` WHEN NEW.`partner_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`partner_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_price_list_assignments_price_list_id_insert` BEFORE INSERT ON `price_list_assignments` WHEN NEW.`price_list_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `price_lists` WHERE `id`=NEW.`price_list_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_price_list_assignments_price_list_id_update` BEFORE UPDATE OF `price_list_id`,`tenant_id` ON `price_list_assignments` WHEN NEW.`price_list_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `price_lists` WHERE `id`=NEW.`price_list_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_price_list_entries_price_list_id_insert` BEFORE INSERT ON `price_list_entries` WHEN NEW.`price_list_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `price_lists` WHERE `id`=NEW.`price_list_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_price_list_entries_price_list_id_update` BEFORE UPDATE OF `price_list_id`,`tenant_id` ON `price_list_entries` WHEN NEW.`price_list_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `price_lists` WHERE `id`=NEW.`price_list_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_price_list_entries_product_id_insert` BEFORE INSERT ON `price_list_entries` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_price_list_entries_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `price_list_entries` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_price_list_entries_uom_id_insert` BEFORE INSERT ON `price_list_entries` WHEN NEW.`uom_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `units_of_measure` WHERE `id`=NEW.`uom_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_price_list_entries_uom_id_update` BEFORE UPDATE OF `uom_id`,`tenant_id` ON `price_list_entries` WHEN NEW.`uom_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `units_of_measure` WHERE `id`=NEW.`uom_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_aliases_product_id_insert` BEFORE INSERT ON `product_aliases` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_aliases_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `product_aliases` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_cost_history_product_id_insert` BEFORE INSERT ON `product_cost_history` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_cost_history_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `product_cost_history` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_cost_history_source_purchase_order_id_insert` BEFORE INSERT ON `product_cost_history` WHEN NEW.`source_purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`source_purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_cost_history_source_purchase_order_id_update` BEFORE UPDATE OF `source_purchase_order_id`,`tenant_id` ON `product_cost_history` WHEN NEW.`source_purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`source_purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_cost_history_source_purchase_order_line_id_insert` BEFORE INSERT ON `product_cost_history` WHEN NEW.`source_purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`source_purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_cost_history_source_purchase_order_line_id_update` BEFORE UPDATE OF `source_purchase_order_line_id`,`tenant_id` ON `product_cost_history` WHEN NEW.`source_purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`source_purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_cost_history_vendor_id_insert` BEFORE INSERT ON `product_cost_history` WHEN NEW.`vendor_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`vendor_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_cost_history_vendor_id_update` BEFORE UPDATE OF `vendor_id`,`tenant_id` ON `product_cost_history` WHEN NEW.`vendor_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`vendor_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_default_locations_location_id_insert` BEFORE INSERT ON `product_default_locations` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_default_locations_location_id_update` BEFORE UPDATE OF `location_id`,`tenant_id` ON `product_default_locations` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_default_locations_product_id_insert` BEFORE INSERT ON `product_default_locations` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_default_locations_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `product_default_locations` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_default_locations_warehouse_id_insert` BEFORE INSERT ON `product_default_locations` WHEN NEW.`warehouse_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `warehouses` WHERE `id`=NEW.`warehouse_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_product_default_locations_warehouse_id_update` BEFORE UPDATE OF `warehouse_id`,`tenant_id` ON `product_default_locations` WHEN NEW.`warehouse_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `warehouses` WHERE `id`=NEW.`warehouse_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_order_lines_product_id_insert` BEFORE INSERT ON `purchase_order_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_order_lines_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `purchase_order_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_order_lines_purchase_order_id_insert` BEFORE INSERT ON `purchase_order_lines` WHEN NEW.`purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_order_lines_purchase_order_id_update` BEFORE UPDATE OF `purchase_order_id`,`tenant_id` ON `purchase_order_lines` WHEN NEW.`purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_order_lines_source_sales_order_line_id_insert` BEFORE INSERT ON `purchase_order_lines` WHEN NEW.`source_sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`source_sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_order_lines_source_sales_order_line_id_update` BEFORE UPDATE OF `source_sales_order_line_id`,`tenant_id` ON `purchase_order_lines` WHEN NEW.`source_sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`source_sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_order_merges_source_purchase_order_id_insert` BEFORE INSERT ON `purchase_order_merges` WHEN NEW.`source_purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`source_purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_order_merges_source_purchase_order_id_update` BEFORE UPDATE OF `source_purchase_order_id`,`tenant_id` ON `purchase_order_merges` WHEN NEW.`source_purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`source_purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_order_merges_target_purchase_order_id_insert` BEFORE INSERT ON `purchase_order_merges` WHEN NEW.`target_purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`target_purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_order_merges_target_purchase_order_id_update` BEFORE UPDATE OF `target_purchase_order_id`,`tenant_id` ON `purchase_order_merges` WHEN NEW.`target_purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`target_purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_order_revisions_purchase_order_id_insert` BEFORE INSERT ON `purchase_order_revisions` WHEN NEW.`purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_order_revisions_purchase_order_id_update` BEFORE UPDATE OF `purchase_order_id`,`tenant_id` ON `purchase_order_revisions` WHEN NEW.`purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_orders_vendor_id_insert` BEFORE INSERT ON `purchase_orders` WHEN NEW.`vendor_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`vendor_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_purchase_orders_vendor_id_update` BEFORE UPDATE OF `vendor_id`,`tenant_id` ON `purchase_orders` WHEN NEW.`vendor_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`vendor_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_account_mappings_connection_id_insert` BEFORE INSERT ON `qbo_account_mappings` WHEN NEW.`connection_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `qbo_connections` WHERE `id`=NEW.`connection_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_account_mappings_connection_id_update` BEFORE UPDATE OF `connection_id`,`tenant_id` ON `qbo_account_mappings` WHEN NEW.`connection_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `qbo_connections` WHERE `id`=NEW.`connection_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_entity_links_connection_id_insert` BEFORE INSERT ON `qbo_entity_links` WHEN NEW.`connection_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `qbo_connections` WHERE `id`=NEW.`connection_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_entity_links_connection_id_update` BEFORE UPDATE OF `connection_id`,`tenant_id` ON `qbo_entity_links` WHEN NEW.`connection_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `qbo_connections` WHERE `id`=NEW.`connection_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_reconciliation_runs_connection_id_insert` BEFORE INSERT ON `qbo_reconciliation_runs` WHEN NEW.`connection_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `qbo_connections` WHERE `id`=NEW.`connection_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_reconciliation_runs_connection_id_update` BEFORE UPDATE OF `connection_id`,`tenant_id` ON `qbo_reconciliation_runs` WHEN NEW.`connection_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `qbo_connections` WHERE `id`=NEW.`connection_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_reference_mappings_connection_id_insert` BEFORE INSERT ON `qbo_reference_mappings` WHEN NEW.`connection_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `qbo_connections` WHERE `id`=NEW.`connection_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_reference_mappings_connection_id_update` BEFORE UPDATE OF `connection_id`,`tenant_id` ON `qbo_reference_mappings` WHEN NEW.`connection_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `qbo_connections` WHERE `id`=NEW.`connection_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_sync_cursors_connection_id_insert` BEFORE INSERT ON `qbo_sync_cursors` WHEN NEW.`connection_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `qbo_connections` WHERE `id`=NEW.`connection_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_sync_cursors_connection_id_update` BEFORE UPDATE OF `connection_id`,`tenant_id` ON `qbo_sync_cursors` WHEN NEW.`connection_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `qbo_connections` WHERE `id`=NEW.`connection_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_sync_deliveries_connection_id_insert` BEFORE INSERT ON `qbo_sync_deliveries` WHEN NEW.`connection_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `qbo_connections` WHERE `id`=NEW.`connection_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_sync_deliveries_connection_id_update` BEFORE UPDATE OF `connection_id`,`tenant_id` ON `qbo_sync_deliveries` WHEN NEW.`connection_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `qbo_connections` WHERE `id`=NEW.`connection_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_sync_deliveries_outbox_event_id_insert` BEFORE INSERT ON `qbo_sync_deliveries` WHEN NEW.`outbox_event_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `outbox_events` WHERE `id`=NEW.`outbox_event_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_sync_deliveries_outbox_event_id_update` BEFORE UPDATE OF `outbox_event_id`,`tenant_id` ON `qbo_sync_deliveries` WHEN NEW.`outbox_event_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `outbox_events` WHERE `id`=NEW.`outbox_event_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_webhook_events_connection_id_insert` BEFORE INSERT ON `qbo_webhook_events` WHEN NEW.`connection_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `qbo_connections` WHERE `id`=NEW.`connection_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_qbo_webhook_events_connection_id_update` BEFORE UPDATE OF `connection_id`,`tenant_id` ON `qbo_webhook_events` WHEN NEW.`connection_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `qbo_connections` WHERE `id`=NEW.`connection_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_receipt_lines_location_id_insert` BEFORE INSERT ON `receipt_lines` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_receipt_lines_location_id_update` BEFORE UPDATE OF `location_id`,`tenant_id` ON `receipt_lines` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_receipt_lines_product_id_insert` BEFORE INSERT ON `receipt_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_receipt_lines_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `receipt_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_receipt_lines_purchase_order_line_id_insert` BEFORE INSERT ON `receipt_lines` WHEN NEW.`purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_receipt_lines_purchase_order_line_id_update` BEFORE UPDATE OF `purchase_order_line_id`,`tenant_id` ON `receipt_lines` WHEN NEW.`purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_receipt_lines_receipt_id_insert` BEFORE INSERT ON `receipt_lines` WHEN NEW.`receipt_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `receipts` WHERE `id`=NEW.`receipt_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_receipt_lines_receipt_id_update` BEFORE UPDATE OF `receipt_id`,`tenant_id` ON `receipt_lines` WHEN NEW.`receipt_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `receipts` WHERE `id`=NEW.`receipt_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_receipts_purchase_order_id_insert` BEFORE INSERT ON `receipts` WHEN NEW.`purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_receipts_purchase_order_id_update` BEFORE UPDATE OF `purchase_order_id`,`tenant_id` ON `receipts` WHEN NEW.`purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_reservations_location_id_insert` BEFORE INSERT ON `reservations` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_reservations_location_id_update` BEFORE UPDATE OF `location_id`,`tenant_id` ON `reservations` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_reservations_product_id_insert` BEFORE INSERT ON `reservations` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_reservations_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `reservations` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_reservations_sales_order_line_id_insert` BEFORE INSERT ON `reservations` WHEN NEW.`sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_reservations_sales_order_line_id_update` BEFORE UPDATE OF `sales_order_line_id`,`tenant_id` ON `reservations` WHEN NEW.`sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_returnable_events_obligation_id_insert` BEFORE INSERT ON `returnable_events` WHEN NEW.`obligation_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `returnable_obligations` WHERE `id`=NEW.`obligation_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_returnable_events_obligation_id_update` BEFORE UPDATE OF `obligation_id`,`tenant_id` ON `returnable_events` WHEN NEW.`obligation_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `returnable_obligations` WHERE `id`=NEW.`obligation_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_returnable_obligations_asset_type_id_insert` BEFORE INSERT ON `returnable_obligations` WHEN NEW.`asset_type_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `returnable_asset_types` WHERE `id`=NEW.`asset_type_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_returnable_obligations_asset_type_id_update` BEFORE UPDATE OF `asset_type_id`,`tenant_id` ON `returnable_obligations` WHEN NEW.`asset_type_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `returnable_asset_types` WHERE `id`=NEW.`asset_type_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_returnable_obligations_partner_id_insert` BEFORE INSERT ON `returnable_obligations` WHEN NEW.`partner_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`partner_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_returnable_obligations_partner_id_update` BEFORE UPDATE OF `partner_id`,`tenant_id` ON `returnable_obligations` WHEN NEW.`partner_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`partner_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_sales_order_lines_linked_purchase_order_line_id_insert` BEFORE INSERT ON `sales_order_lines` WHEN NEW.`linked_purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`linked_purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_sales_order_lines_linked_purchase_order_line_id_update` BEFORE UPDATE OF `linked_purchase_order_line_id`,`tenant_id` ON `sales_order_lines` WHEN NEW.`linked_purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`linked_purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_sales_order_lines_product_id_insert` BEFORE INSERT ON `sales_order_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_sales_order_lines_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `sales_order_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_sales_order_lines_sales_order_id_insert` BEFORE INSERT ON `sales_order_lines` WHEN NEW.`sales_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_orders` WHERE `id`=NEW.`sales_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_sales_order_lines_sales_order_id_update` BEFORE UPDATE OF `sales_order_id`,`tenant_id` ON `sales_order_lines` WHEN NEW.`sales_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_orders` WHERE `id`=NEW.`sales_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_sales_orders_customer_id_insert` BEFORE INSERT ON `sales_orders` WHEN NEW.`customer_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`customer_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_sales_orders_customer_id_update` BEFORE UPDATE OF `customer_id`,`tenant_id` ON `sales_orders` WHEN NEW.`customer_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`customer_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_shipment_lines_location_id_insert` BEFORE INSERT ON `shipment_lines` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_shipment_lines_location_id_update` BEFORE UPDATE OF `location_id`,`tenant_id` ON `shipment_lines` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_shipment_lines_product_id_insert` BEFORE INSERT ON `shipment_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_shipment_lines_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `shipment_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_shipment_lines_sales_order_line_id_insert` BEFORE INSERT ON `shipment_lines` WHEN NEW.`sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_shipment_lines_sales_order_line_id_update` BEFORE UPDATE OF `sales_order_line_id`,`tenant_id` ON `shipment_lines` WHEN NEW.`sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_shipment_lines_shipment_id_insert` BEFORE INSERT ON `shipment_lines` WHEN NEW.`shipment_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `shipments` WHERE `id`=NEW.`shipment_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_shipment_lines_shipment_id_update` BEFORE UPDATE OF `shipment_id`,`tenant_id` ON `shipment_lines` WHEN NEW.`shipment_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `shipments` WHERE `id`=NEW.`shipment_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_shipments_sales_order_id_insert` BEFORE INSERT ON `shipments` WHEN NEW.`sales_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_orders` WHERE `id`=NEW.`sales_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_shipments_sales_order_id_update` BEFORE UPDATE OF `sales_order_id`,`tenant_id` ON `shipments` WHEN NEW.`sales_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_orders` WHERE `id`=NEW.`sales_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_stock_movements_from_location_id_insert` BEFORE INSERT ON `stock_movements` WHEN NEW.`from_location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`from_location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_stock_movements_from_location_id_update` BEFORE UPDATE OF `from_location_id`,`tenant_id` ON `stock_movements` WHEN NEW.`from_location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`from_location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_stock_movements_product_id_insert` BEFORE INSERT ON `stock_movements` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_stock_movements_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `stock_movements` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_stock_movements_purchase_order_line_id_insert` BEFORE INSERT ON `stock_movements` WHEN NEW.`purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_stock_movements_purchase_order_line_id_update` BEFORE UPDATE OF `purchase_order_line_id`,`tenant_id` ON `stock_movements` WHEN NEW.`purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_stock_movements_reversal_of_movement_id_insert` BEFORE INSERT ON `stock_movements` WHEN NEW.`reversal_of_movement_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `stock_movements` WHERE `id`=NEW.`reversal_of_movement_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_stock_movements_reversal_of_movement_id_update` BEFORE UPDATE OF `reversal_of_movement_id`,`tenant_id` ON `stock_movements` WHEN NEW.`reversal_of_movement_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `stock_movements` WHERE `id`=NEW.`reversal_of_movement_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_stock_movements_sales_order_line_id_insert` BEFORE INSERT ON `stock_movements` WHEN NEW.`sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_stock_movements_sales_order_line_id_update` BEFORE UPDATE OF `sales_order_line_id`,`tenant_id` ON `stock_movements` WHEN NEW.`sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_stock_movements_to_location_id_insert` BEFORE INSERT ON `stock_movements` WHEN NEW.`to_location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`to_location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_stock_movements_to_location_id_update` BEFORE UPDATE OF `to_location_id`,`tenant_id` ON `stock_movements` WHEN NEW.`to_location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`to_location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_supply_allocation_receipts_receipt_movement_id_insert` BEFORE INSERT ON `supply_allocation_receipts` WHEN NEW.`receipt_movement_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `stock_movements` WHERE `id`=NEW.`receipt_movement_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_supply_allocation_receipts_receipt_movement_id_update` BEFORE UPDATE OF `receipt_movement_id`,`tenant_id` ON `supply_allocation_receipts` WHEN NEW.`receipt_movement_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `stock_movements` WHERE `id`=NEW.`receipt_movement_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_supply_allocation_receipts_reservation_id_insert` BEFORE INSERT ON `supply_allocation_receipts` WHEN NEW.`reservation_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `reservations` WHERE `id`=NEW.`reservation_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_supply_allocation_receipts_reservation_id_update` BEFORE UPDATE OF `reservation_id`,`tenant_id` ON `supply_allocation_receipts` WHEN NEW.`reservation_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `reservations` WHERE `id`=NEW.`reservation_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_supply_allocation_receipts_supply_allocation_id_insert` BEFORE INSERT ON `supply_allocation_receipts` WHEN NEW.`supply_allocation_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `supply_allocations` WHERE `id`=NEW.`supply_allocation_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_supply_allocation_receipts_supply_allocation_id_update` BEFORE UPDATE OF `supply_allocation_id`,`tenant_id` ON `supply_allocation_receipts` WHEN NEW.`supply_allocation_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `supply_allocations` WHERE `id`=NEW.`supply_allocation_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_supply_allocations_purchase_order_line_id_insert` BEFORE INSERT ON `supply_allocations` WHEN NEW.`purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_supply_allocations_purchase_order_line_id_update` BEFORE UPDATE OF `purchase_order_line_id`,`tenant_id` ON `supply_allocations` WHEN NEW.`purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_supply_allocations_sales_order_line_id_insert` BEFORE INSERT ON `supply_allocations` WHEN NEW.`sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_supply_allocations_sales_order_line_id_update` BEFORE UPDATE OF `sales_order_line_id`,`tenant_id` ON `supply_allocations` WHEN NEW.`sales_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_order_lines` WHERE `id`=NEW.`sales_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_uom_conversions_from_uom_id_insert` BEFORE INSERT ON `uom_conversions` WHEN NEW.`from_uom_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `units_of_measure` WHERE `id`=NEW.`from_uom_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_uom_conversions_from_uom_id_update` BEFORE UPDATE OF `from_uom_id`,`tenant_id` ON `uom_conversions` WHEN NEW.`from_uom_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `units_of_measure` WHERE `id`=NEW.`from_uom_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_uom_conversions_product_id_insert` BEFORE INSERT ON `uom_conversions` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_uom_conversions_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `uom_conversions` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_uom_conversions_to_uom_id_insert` BEFORE INSERT ON `uom_conversions` WHEN NEW.`to_uom_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `units_of_measure` WHERE `id`=NEW.`to_uom_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_uom_conversions_to_uom_id_update` BEFORE UPDATE OF `to_uom_id`,`tenant_id` ON `uom_conversions` WHEN NEW.`to_uom_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `units_of_measure` WHERE `id`=NEW.`to_uom_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_valuation_policies_product_id_insert` BEFORE INSERT ON `valuation_policies` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_valuation_policies_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `valuation_policies` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_bill_lines_product_id_insert` BEFORE INSERT ON `vendor_bill_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_bill_lines_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `vendor_bill_lines` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_bill_lines_purchase_order_line_id_insert` BEFORE INSERT ON `vendor_bill_lines` WHEN NEW.`purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_bill_lines_purchase_order_line_id_update` BEFORE UPDATE OF `purchase_order_line_id`,`tenant_id` ON `vendor_bill_lines` WHEN NEW.`purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_bill_lines_vendor_bill_id_insert` BEFORE INSERT ON `vendor_bill_lines` WHEN NEW.`vendor_bill_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `vendor_bills` WHERE `id`=NEW.`vendor_bill_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_bill_lines_vendor_bill_id_update` BEFORE UPDATE OF `vendor_bill_id`,`tenant_id` ON `vendor_bill_lines` WHEN NEW.`vendor_bill_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `vendor_bills` WHERE `id`=NEW.`vendor_bill_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_bills_purchase_order_id_insert` BEFORE INSERT ON `vendor_bills` WHEN NEW.`purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_bills_purchase_order_id_update` BEFORE UPDATE OF `purchase_order_id`,`tenant_id` ON `vendor_bills` WHEN NEW.`purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_bills_vendor_id_insert` BEFORE INSERT ON `vendor_bills` WHEN NEW.`vendor_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`vendor_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_bills_vendor_id_update` BEFORE UPDATE OF `vendor_id`,`tenant_id` ON `vendor_bills` WHEN NEW.`vendor_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `business_partners` WHERE `id`=NEW.`vendor_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_credits_purchase_order_id_insert` BEFORE INSERT ON `vendor_credits` WHEN NEW.`purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_credits_purchase_order_id_update` BEFORE UPDATE OF `purchase_order_id`,`tenant_id` ON `vendor_credits` WHEN NEW.`purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_credits_vendor_bill_id_insert` BEFORE INSERT ON `vendor_credits` WHEN NEW.`vendor_bill_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `vendor_bills` WHERE `id`=NEW.`vendor_bill_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_credits_vendor_bill_id_update` BEFORE UPDATE OF `vendor_bill_id`,`tenant_id` ON `vendor_credits` WHEN NEW.`vendor_bill_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `vendor_bills` WHERE `id`=NEW.`vendor_bill_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_returns_location_id_insert` BEFORE INSERT ON `vendor_returns` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_returns_location_id_update` BEFORE UPDATE OF `location_id`,`tenant_id` ON `vendor_returns` WHEN NEW.`location_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `locations` WHERE `id`=NEW.`location_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_returns_product_id_insert` BEFORE INSERT ON `vendor_returns` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_returns_product_id_update` BEFORE UPDATE OF `product_id`,`tenant_id` ON `vendor_returns` WHEN NEW.`product_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `products` WHERE `id`=NEW.`product_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_returns_purchase_order_id_insert` BEFORE INSERT ON `vendor_returns` WHEN NEW.`purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_returns_purchase_order_id_update` BEFORE UPDATE OF `purchase_order_id`,`tenant_id` ON `vendor_returns` WHEN NEW.`purchase_order_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_orders` WHERE `id`=NEW.`purchase_order_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_returns_purchase_order_line_id_insert` BEFORE INSERT ON `vendor_returns` WHEN NEW.`purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_guard_vendor_returns_purchase_order_line_id_update` BEFORE UPDATE OF `purchase_order_line_id`,`tenant_id` ON `vendor_returns` WHEN NEW.`purchase_order_line_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `purchase_order_lines` WHERE `id`=NEW.`purchase_order_line_id` AND `tenant_id`=NEW.`tenant_id`) BEGIN SELECT RAISE(ABORT,'CROSS_TENANT_REFERENCE'); END;
