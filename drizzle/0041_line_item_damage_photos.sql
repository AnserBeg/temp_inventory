CREATE TABLE `attachment_line_items` (
	`tenant_id` text DEFAULT 'tenant-default' NOT NULL,
	`attachment_id` text NOT NULL,
	`document_type` text NOT NULL,
	`line_item_id` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `attachment_id`, `line_item_id`),
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "attachment_line_items_document_type_check" CHECK(`document_type` IN ('purchase_order','sales_order'))
);
--> statement-breakpoint
CREATE INDEX `idx_attachment_line_items_line` ON `attachment_line_items` (`tenant_id`,`document_type`,`line_item_id`);
--> statement-breakpoint
PRAGMA optimize;
