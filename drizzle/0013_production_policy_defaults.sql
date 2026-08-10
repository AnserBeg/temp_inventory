INSERT OR IGNORE INTO `system_settings` (`key`,`value_json`,`description`,`version`,`updated_by`,`updated_at`) VALUES
	('receiving.overReceiptPolicy','{"tolerancePct":5,"toleranceQuantity":0}','Percentage and absolute-quantity tolerance for receipts above ordered quantity.',1,'System',CURRENT_TIMESTAMP),
	('inventory.negativeAllowed','false','Negative on-hand inventory is blocked.',1,'System',CURRENT_TIMESTAMP),
	('inventory.countApprovalThreshold','{"absoluteQuantity":5,"absoluteValueCents":100000}','Absolute inventory-count variance thresholds requiring manager approval.',1,'System',CURRENT_TIMESTAMP),
	('inventory.scrapApprovalThresholdCents','50000','Inventory value above which scrap requires manager approval.',1,'System',CURRENT_TIMESTAMP),
	('matching.tolerances','{"quantity":0,"unitPriceCents":2500,"totalCents":5000,"allowedChargeKinds":["freight","fuel_surcharge","environmental_fee"]}','Quantity, unit-price, total, and allowed-charge tolerances for three-way matching.',1,'System',CURRENT_TIMESTAMP),
	('tax.defaultRateBps','500','Default transaction tax rate in basis points.',1,'System',CURRENT_TIMESTAMP),
	('security.defaultRole','"viewer"','Least-privilege role assigned to authenticated users without an explicit mapping.',1,'System',CURRENT_TIMESTAMP),
	('valuation.defaultMethod','"fifo"','Default inventory valuation method for new products.',1,'System',CURRENT_TIMESTAMP);
