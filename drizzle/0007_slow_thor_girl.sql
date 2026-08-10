PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__inventory_balance_fk_guard` (
	`orphan_count` integer NOT NULL CHECK (`orphan_count` = 0)
);--> statement-breakpoint
INSERT INTO `__inventory_balance_fk_guard` (`orphan_count`)
SELECT COUNT(*) FROM `inventory_balances` ib
LEFT JOIN `products` p ON p.`id` = ib.`product_id`
LEFT JOIN `locations` l ON l.`id` = ib.`location_id`
WHERE p.`id` IS NULL OR l.`id` IS NULL;--> statement-breakpoint
DROP TABLE `__inventory_balance_fk_guard`;--> statement-breakpoint
CREATE TABLE `__new_inventory_balances` (
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`on_hand_qty` real DEFAULT 0 NOT NULL,
	`reserved_qty` real DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`product_id`, `location_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_balances_on_hand_check" CHECK("__new_inventory_balances"."on_hand_qty" >= 0),
	CONSTRAINT "inventory_balances_reserved_check" CHECK("__new_inventory_balances"."reserved_qty" >= 0 AND "__new_inventory_balances"."reserved_qty" <= "__new_inventory_balances"."on_hand_qty")
);
--> statement-breakpoint
INSERT INTO `__new_inventory_balances`("product_id", "location_id", "on_hand_qty", "reserved_qty", "version") SELECT "product_id", "location_id", "on_hand_qty", "reserved_qty", "version" FROM `inventory_balances`;--> statement-breakpoint
DROP TABLE `inventory_balances`;--> statement-breakpoint
ALTER TABLE `__new_inventory_balances` RENAME TO `inventory_balances`;--> statement-breakpoint
CREATE TRIGGER `inventory_balances_nonnegative_insert`
BEFORE INSERT ON `inventory_balances`
WHEN NEW.`on_hand_qty` < 0 OR NEW.`reserved_qty` < 0 OR NEW.`reserved_qty` > NEW.`on_hand_qty`
BEGIN SELECT RAISE(ABORT, 'inventory balance invariant violated'); END;--> statement-breakpoint
CREATE TRIGGER `inventory_balances_nonnegative_update`
BEFORE UPDATE ON `inventory_balances`
WHEN NEW.`on_hand_qty` < 0 OR NEW.`reserved_qty` < 0 OR NEW.`reserved_qty` > NEW.`on_hand_qty`
BEGIN SELECT RAISE(ABORT, 'inventory balance invariant violated'); END;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_key_check;
