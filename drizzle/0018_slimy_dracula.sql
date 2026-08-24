CREATE INDEX `idx_reservations_status_created` ON `reservations` (`status`,`created_at`);--> statement-breakpoint
PRAGMA optimize;
