UPDATE `customer_returns`
SET `number` = `number` || '-DUP-' || upper(substr(replace(`id`, '-', ''), 1, 8))
WHERE `id` IN (
  SELECT `id` FROM (
    SELECT `id`, row_number() OVER (PARTITION BY `number` ORDER BY `posted_at`, `id`) AS duplicate_rank
    FROM `customer_returns`
  ) WHERE duplicate_rank > 1
);--> statement-breakpoint
UPDATE `inventory_counts`
SET `number` = `number` || '-DUP-' || upper(substr(replace(`id`, '-', ''), 1, 8))
WHERE `id` IN (
  SELECT `id` FROM (
    SELECT `id`, row_number() OVER (PARTITION BY `number` ORDER BY `counted_at`, `id`) AS duplicate_rank
    FROM `inventory_counts`
  ) WHERE duplicate_rank > 1
);--> statement-breakpoint
UPDATE `vendor_bills`
SET `number` = `number` || '-DUP-' || upper(substr(replace(`id`, '-', ''), 1, 8))
WHERE `id` IN (
  SELECT `id` FROM (
    SELECT `id`, row_number() OVER (PARTITION BY `number` ORDER BY COALESCE(`posted_at`, `invoice_date`, `due_date`), `id`) AS duplicate_rank
    FROM `vendor_bills`
  ) WHERE duplicate_rank > 1
);--> statement-breakpoint
UPDATE `vendor_returns`
SET `number` = `number` || '-DUP-' || upper(substr(replace(`id`, '-', ''), 1, 8))
WHERE `id` IN (
  SELECT `id` FROM (
    SELECT `id`, row_number() OVER (PARTITION BY `number` ORDER BY `posted_at`, `id`) AS duplicate_rank
    FROM `vendor_returns`
  ) WHERE duplicate_rank > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_returns_number_unique` ON `customer_returns` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_counts_number_unique` ON `inventory_counts` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_bills_number_unique` ON `vendor_bills` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_returns_number_unique` ON `vendor_returns` (`number`);
