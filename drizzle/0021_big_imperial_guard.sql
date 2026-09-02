ALTER TABLE `products` ADD `max_stock_level` real DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `products` SET `max_stock_level` = `reorder_point`;
