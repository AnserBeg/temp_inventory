ALTER TABLE `purchase_orders` ADD `ordered_at` text;
--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `ordered_by` text;
--> statement-breakpoint
UPDATE `purchase_orders`
SET `ordered_at` = COALESCE(
  (SELECT MIN(r.posted_at) FROM receipts r WHERE r.purchase_order_id = purchase_orders.id),
  (SELECT MIN(d.posted_at) FROM drop_ship_deliveries d WHERE d.purchase_order_id = purchase_orders.id),
  (SELECT MIN(vb.posted_at) FROM vendor_bills vb WHERE vb.purchase_order_id = purchase_orders.id AND vb.status <> 'void')
)
WHERE lifecycle_status = 'approved'
  AND (
    EXISTS (SELECT 1 FROM receipts r WHERE r.purchase_order_id = purchase_orders.id)
    OR EXISTS (SELECT 1 FROM drop_ship_deliveries d WHERE d.purchase_order_id = purchase_orders.id)
    OR EXISTS (SELECT 1 FROM vendor_bills vb WHERE vb.purchase_order_id = purchase_orders.id AND vb.status <> 'void')
  );
--> statement-breakpoint
UPDATE `purchase_orders`
SET `ordered_by` = 'Migrated from existing fulfillment history'
WHERE `ordered_at` IS NOT NULL AND `ordered_by` IS NULL;
