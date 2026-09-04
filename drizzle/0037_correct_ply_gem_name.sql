UPDATE `business_partners`
SET `code` = 'V-PLYGEM',
    `name` = 'Ply Gem',
    `version` = `version` + 1
WHERE `id` = 'vendor-max-green-vinyl-vista';
--> statement-breakpoint
UPDATE `products`
SET `name` = REPLACE(`name`, 'Vinyl Vista', 'Ply Gem'),
    `version` = `version` + 1
WHERE `name` LIKE '%Vinyl Vista%';
--> statement-breakpoint
UPDATE `audit_events`
SET `metadata_json` = REPLACE(`metadata_json`, 'Vinyl Vista', 'Ply Gem')
WHERE `id` = 'audit-max-green-import'
  AND `metadata_json` LIKE '%Vinyl Vista%';
