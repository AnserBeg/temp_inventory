CREATE TABLE `app_password_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer DEFAULT 310000 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_login_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "app_password_credentials_iterations_check" CHECK(`password_iterations` >= 100000)
);
--> statement-breakpoint
CREATE TABLE `app_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_app_sessions_token_hash` ON `app_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `idx_app_sessions_user_expiry` ON `app_sessions` (`user_id`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_app_sessions_tenant_expiry` ON `app_sessions` (`tenant_id`,`expires_at`);
--> statement-breakpoint
CREATE TRIGGER `app_sessions_active_membership_insert`
BEFORE INSERT ON `app_sessions`
WHEN NOT EXISTS (
	SELECT 1 FROM `tenant_memberships` tm JOIN `tenants` t ON t.`id`=tm.`tenant_id`
	WHERE tm.`tenant_id`=NEW.`tenant_id` AND tm.`user_id`=NEW.`user_id` AND tm.`active`=1 AND t.`status`='active'
)
BEGIN SELECT RAISE(ABORT,'ACTIVE_TENANT_MEMBERSHIP_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER `app_sessions_active_membership_update`
BEFORE UPDATE OF `user_id`,`tenant_id` ON `app_sessions`
WHEN NOT EXISTS (
	SELECT 1 FROM `tenant_memberships` tm JOIN `tenants` t ON t.`id`=tm.`tenant_id`
	WHERE tm.`tenant_id`=NEW.`tenant_id` AND tm.`user_id`=NEW.`user_id` AND tm.`active`=1 AND t.`status`='active'
)
BEGIN SELECT RAISE(ABORT,'ACTIVE_TENANT_MEMBERSHIP_REQUIRED'); END;
--> statement-breakpoint
CREATE TABLE `auth_login_attempts` (
	`attempt_key` text PRIMARY KEY NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`window_started_at` text NOT NULL,
	`locked_until` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_auth_login_attempts_updated` ON `auth_login_attempts` (`updated_at`);
