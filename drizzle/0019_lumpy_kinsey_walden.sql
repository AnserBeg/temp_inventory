CREATE INDEX `idx_customer_credits_invoice_status_posted` ON `customer_credits` (`customer_invoice_id`,`status`,`posted_at`);--> statement-breakpoint
CREATE INDEX `idx_payments_document_date` ON `payments` (`document_type`,`document_id`,`direction`,`payment_date`);--> statement-breakpoint
CREATE INDEX `idx_vendor_credits_bill_status_posted` ON `vendor_credits` (`vendor_bill_id`,`status`,`posted_at`);--> statement-breakpoint
PRAGMA optimize;
