ALTER TABLE `products` ADD `reorder_rule_mode` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `products` ADD `reorder_rule_percent` real;
--> statement-breakpoint
INSERT OR IGNORE INTO `system_settings`
  (`tenant_id`,`key`,`value_json`,`description`,`version`,`updated_by`,`updated_at`)
SELECT `id`,'inventory.reorderPointRule','{"percent":70,"applyToAllStocked":false}',
  'Sets the reorder point as a percentage of maximum stock for opted-in or all stocked parts.',
  1,'System',CURRENT_TIMESTAMP
FROM `tenants`;
