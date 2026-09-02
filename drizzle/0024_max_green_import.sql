PRAGMA defer_foreign_keys=TRUE;--> statement-breakpoint
DELETE FROM system_settings WHERE key='__migration.max_green_import_guard';--> statement-breakpoint
INSERT INTO system_settings (key,value_json,description,version,updated_by,updated_at)
SELECT '__migration.max_green_import_guard','true','Deployment-scoped Max Green import guard.',1,'Max Green inventory import',CURRENT_TIMESTAMP
WHERE (SELECT COUNT(*) FROM products)=6
  AND (SELECT COUNT(*) FROM business_partners)=6
  AND (SELECT COUNT(*) FROM locations)=6
  AND (SELECT COUNT(*) FROM inventory_balances)=7
  AND EXISTS (SELECT 1 FROM products WHERE id='prod-awning-2436')
  AND EXISTS (SELECT 1 FROM products WHERE id='prod-casement-3648')
  AND EXISTS (SELECT 1 FROM products WHERE id='prod-slider-6048')
  AND EXISTS (SELECT 1 FROM business_partners WHERE id='vendor-andersen')
  AND EXISTS (SELECT 1 FROM business_partners WHERE id='customer-copperstone')
  AND EXISTS (SELECT 1 FROM locations WHERE id='loc-a01');--> statement-breakpoint
DROP TRIGGER IF EXISTS stock_movements_immutable_delete;--> statement-breakpoint
DROP TRIGGER IF EXISTS stock_movements_immutable_update;--> statement-breakpoint
DELETE FROM qbo_webhook_events WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM qbo_sync_deliveries WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM qbo_sync_cursors WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM qbo_reference_mappings WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM qbo_reconciliation_runs WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM qbo_entity_links WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM qbo_account_mappings WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM qbo_oauth_states WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM qbo_connections WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM document_email_deliveries WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM attachments WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM inventory_count_session_lines WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM inventory_count_sessions WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM payments WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM customer_invoice_lines WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM customer_credits WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM customer_invoices WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM vendor_bill_lines WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM vendor_credits WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM vendor_bills WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM catalog_price_history WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM product_cost_history WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM landed_cost_allocation_lines WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM landed_cost_allocations WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM inventory_value_entries WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM cost_layers WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM movement_assignments WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM returnable_events WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM returnable_obligations WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM returnable_asset_types WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM inventory_counts WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM customer_returns WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM vendor_returns WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM drop_ship_deliveries WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM shipment_lines WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM shipments WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM reservations WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM receipt_lines WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM receipts WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM inventory_transfer_lines WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM inventory_transfers WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM stock_movements WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM inventory_balances WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM inventory_units WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM inventory_lots WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM sales_order_lines WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM sales_orders WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM purchase_order_revisions WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM purchase_order_lines WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM purchase_orders WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM price_list_entries WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM price_list_assignments WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM price_lists WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM partner_addresses WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM document_charges WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM approvals WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM outbox_events WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM audit_events WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM command_log WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM valuation_policies WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM uom_conversions WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM margin_rules WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM products WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM business_partners WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM locations WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM warehouses WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM document_sequences WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
DELETE FROM period_locks WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT OR IGNORE INTO units_of_measure (id,code,name,dimension,precision,active)
SELECT 'uom-each','EA','Each','quantity',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO warehouses (id,code,name,timezone,active,version)
SELECT 'warehouse-max-green','MG','Max Green Warehouse','America/Edmonton',1,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,parent_location_id,active,version)
SELECT 'loc-max-green-inside','MG-INSIDE','Inside','storage','usable','warehouse-max-green',NULL,1,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,parent_location_id,active,version)
SELECT 'loc-max-green-outside','MG-OUTSIDE','Outside','yard','usable','warehouse-max-green',NULL,1,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO business_partners (id,code,name,partner_type,country,currency,credit_limit_cents,credit_hold,active,version,created_at)
SELECT 'vendor-max-green-vinyl-vista','V-VISTA','Vinyl Vista','vendor','CA','CAD',0,0,1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO business_partners (id,code,name,partner_type,country,currency,credit_limit_cents,credit_hold,active,version,created_at)
SELECT 'vendor-max-green-kohltech','V-KOHL','Kohltech','vendor','CA','CAD',0,0,1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0001','MG-0001','2424XO','2424XO Vinyl Vista Slider Windows','Sliding window','Vinyl','See product description','Unspecified',
   'quantity','stocked',19590,19590,25900,25900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   7,10,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0001','fifo',19590,19590,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0001','prod-max-green-0001','inventory_import',19590,25900,25900,25900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0001','loc-max-green-inside',12,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0001-inside','opening_balance','prod-max-green-0001',12,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0001',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',19590,'CAD','max-green-opening-MG-0001-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0001-inside','prod-max-green-0001','mov-max-green-mg-0001-inside',12,12,19590,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0001-inside','prod-max-green-0001','mov-max-green-mg-0001-inside','opening_balance',12,19590,235080,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0002','MG-0002','2424A','2424A Vinyl Vista Awning','Awning window','Vinyl','See product description','Unspecified',
   'quantity','stocked',27922,27922,34900,34900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   7,10,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0002','fifo',27922,27922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0002','prod-max-green-0002','inventory_import',27922,34900,34900,34900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0002','loc-max-green-inside',7,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0002-inside','opening_balance','prod-max-green-0002',7,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0002',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',27922,'CAD','max-green-opening-MG-0002-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0002-inside','prod-max-green-0002','mov-max-green-mg-0002-inside',7,7,27922,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0002-inside','prod-max-green-0002','mov-max-green-mg-0002-inside','opening_balance',7,27922,195454,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0003','MG-0003','2436PV','2436PV Vinyl Vista Slider Windows - Single Hung - White - W 600 X H900 24x36','Single-hung window','Vinyl','24×36','White',
   'quantity','stocked',19878,19878,27000,27000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   7,10,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0003','fifo',19878,19878,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0003','prod-max-green-0003','inventory_import',19878,27000,27000,27000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0003','loc-max-green-inside',17,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0003-inside','opening_balance','prod-max-green-0003',17,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0003',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',19878,'CAD','max-green-opening-MG-0003-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0003-inside','prod-max-green-0003','mov-max-green-mg-0003-inside',17,17,19878,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0003-inside','prod-max-green-0003','mov-max-green-mg-0003-inside','opening_balance',17,19878,337926,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0004','MG-0004','2448C','2448C Vinyl Vista LEFT Casement 23 3/4 x 47 1/4 White Vinyl 600 x 1200','Casement window','Vinyl','23 3/4 × 47 1/4','White',
   'quantity','stocked',34888,34888,42500,42500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   7,10,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0004','fifo',34888,34888,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0004','prod-max-green-0004','inventory_import',34888,42500,42500,42500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0004','loc-max-green-inside',6,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0004-inside','opening_balance','prod-max-green-0004',6,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0004',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',34888,'CAD','max-green-opening-MG-0004-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0004-inside','prod-max-green-0004','mov-max-green-mg-0004-inside',6,6,34888,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0004-inside','prod-max-green-0004','mov-max-green-mg-0004-inside','opening_balance',6,34888,209328,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0005','MG-0005','2448C','2448C Vinyl Vista RIGHT Casement 23 3/4 x 47 1/4 White Vinyl 600 x 1200','Casement window','Vinyl','23 3/4 × 47 1/4','White',
   'quantity','stocked',34888,34888,42500,42500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   2.8,4,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0005','fifo',34888,34888,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0005','prod-max-green-0005','inventory_import',34888,42500,42500,42500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0005','loc-max-green-inside',6,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0005-inside','opening_balance','prod-max-green-0005',6,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0005',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',34888,'CAD','max-green-opening-MG-0005-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0005-inside','prod-max-green-0005','mov-max-green-mg-0005-inside',6,6,34888,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0005-inside','prod-max-green-0005','mov-max-green-mg-0005-inside','opening_balance',6,34888,209328,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0006','MG-0006','2448PV','2448PV Vinyl Vista Slider Windows - Single Hung - White - W 600 X H 1200 24x48','Single-hung window','Vinyl','24×48','White',
   'quantity','stocked',22850,22850,28500,28500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   3.5,5,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0006','fifo',22850,22850,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0006','prod-max-green-0006','inventory_import',22850,28500,28500,28500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0006','loc-max-green-inside',13,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0006-inside','opening_balance','prod-max-green-0006',13,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0006',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',22850,'CAD','max-green-opening-MG-0006-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0006-inside','prod-max-green-0006','mov-max-green-mg-0006-inside',13,13,22850,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0006-inside','prod-max-green-0006','mov-max-green-mg-0006-inside','opening_balance',13,22850,297050,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0007','MG-0007','2460PV','2460PV Vinyl Vista Slider Windows - Single Hung - White - W 600 X H 1500 24x60','Single-hung window','Vinyl','24×60','White',
   'quantity','stocked',23578,23578,31500,31500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   7,10,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0007','fifo',23578,23578,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0007','prod-max-green-0007','inventory_import',23578,31500,31500,31500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0007','loc-max-green-inside',10,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0007-inside','opening_balance','prod-max-green-0007',10,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0007',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',23578,'CAD','max-green-opening-MG-0007-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0007-inside','prod-max-green-0007','mov-max-green-mg-0007-inside',10,10,23578,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0007-inside','prod-max-green-0007','mov-max-green-mg-0007-inside','opening_balance',10,23578,235780,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0008','MG-0008','3012OX','3012OX Vinyl Vista Slider 750 x 304.8 (30x12)','Sliding window','Vinyl','750 × 304.8','Unspecified',
   'quantity','stocked',20154,20154,24500,24500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   11.2,16,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0008','fifo',20154,20154,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0008','prod-max-green-0008','inventory_import',20154,24500,24500,24500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0008','loc-max-green-inside',5,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0008-inside','opening_balance','prod-max-green-0008',5,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0008',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',20154,'CAD','max-green-opening-MG-0008-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0008-inside','prod-max-green-0008','mov-max-green-mg-0008-inside',5,5,20154,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0008-inside','prod-max-green-0008','mov-max-green-mg-0008-inside','opening_balance',5,20154,100770,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0009','MG-0009','3030C','3030C - Vinyl Vista LEFT Casement 29 3/4 x 29 3/4 White Vinyl Gain DG no jamb 755 x 755','Casement window','Vinyl','29 3/4 × 29 3/4','White',
   'quantity','stocked',31709,31709,39900,39900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   10.5,15,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0009','fifo',31709,31709,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0009','prod-max-green-0009','inventory_import',31709,39900,39900,39900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0009','loc-max-green-inside',1,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0009-inside','opening_balance','prod-max-green-0009',1,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0009',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',31709,'CAD','max-green-opening-MG-0009-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0009-inside','prod-max-green-0009','mov-max-green-mg-0009-inside',1,1,31709,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0009-inside','prod-max-green-0009','mov-max-green-mg-0009-inside','opening_balance',1,31709,31709,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0010','MG-0010','3030C','3030C - Vinyl Vista RIGHT Casement 29 3/4 x 29 3/4 White Vinyl Gain DG no jamb 755 x 755','Casement window','Vinyl','29 3/4 × 29 3/4','White',
   'quantity','stocked',31709,31709,39900,39900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   10.5,15,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0010','fifo',31709,31709,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0010','prod-max-green-0010','inventory_import',31709,39900,39900,39900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0011','MG-0011','3030C-B','3030C-B - 29 3/4 x 29 3/4 - BLACK LEFT','Window and door product','Unspecified','29 3/4 × 29 3/4','Black',
   'quantity','stocked',35388,35388,49900,49900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   1.4,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0011','fifo',35388,35388,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0011','prod-max-green-0011','inventory_import',35388,49900,49900,49900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0011','loc-max-green-inside',3,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0011-inside','opening_balance','prod-max-green-0011',3,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0011',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',35388,'CAD','max-green-opening-MG-0011-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0011-inside','prod-max-green-0011','mov-max-green-mg-0011-inside',3,3,35388,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0011-inside','prod-max-green-0011','mov-max-green-mg-0011-inside','opening_balance',3,35388,106164,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0012','MG-0012','3030C-B','3030C-B - 29 3/4 x 29 3/4 - BLACK RIGHT','Window and door product','Unspecified','29 3/4 × 29 3/4','Black',
   'quantity','stocked',35388,35388,49900,49900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   1.4,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0012','fifo',35388,35388,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0012','prod-max-green-0012','inventory_import',35388,49900,49900,49900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0012','loc-max-green-inside',2,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0012-inside','opening_balance','prod-max-green-0012',2,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0012',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',35388,'CAD','max-green-opening-MG-0012-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0012-inside','prod-max-green-0012','mov-max-green-mg-0012-inside',2,2,35388,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0012-inside','prod-max-green-0012','mov-max-green-mg-0012-inside','opening_balance',2,35388,70776,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0013','MG-0013','3048PV','3048PV - Vinyl Vista Slider Windows - Single Hung 750x1200','Single-hung window','Vinyl','750×1200','Unspecified',
   'quantity','stocked',23252,23252,31500,31500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   4.199999999999999,6,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0013','fifo',23252,23252,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0013','prod-max-green-0013','inventory_import',23252,31500,31500,31500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0013','loc-max-green-inside',4,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0013-inside','opening_balance','prod-max-green-0013',4,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0013',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',23252,'CAD','max-green-opening-MG-0013-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0013-inside','prod-max-green-0013','mov-max-green-mg-0013-inside',4,4,23252,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0013-inside','prod-max-green-0013','mov-max-green-mg-0013-inside','opening_balance',4,23252,93008,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0014','MG-0014','3060PV','3060PV - Vinyl Vista Slider Windows - Single Hung 750x1500','Single-hung window','Vinyl','750×1500','Unspecified',
   'quantity','stocked',26237,26237,35000,35000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   4.199999999999999,6,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0014','fifo',26237,26237,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0014','prod-max-green-0014','inventory_import',26237,35000,35000,35000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0014','loc-max-green-inside',5,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0014-inside','opening_balance','prod-max-green-0014',5,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0014',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',26237,'CAD','max-green-opening-MG-0014-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0014-inside','prod-max-green-0014','mov-max-green-mg-0014-inside',5,5,26237,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0014-inside','prod-max-green-0014','mov-max-green-mg-0014-inside','opening_balance',5,26237,131185,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0015','MG-0015','3660PV','3660PV - Vinyl Vista Slider Windows - Single Hung 900x1500','Single-hung window','Vinyl','900×1500','Unspecified',
   'quantity','stocked',30117,30117,39900,39900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   4.199999999999999,6,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0015','fifo',30117,30117,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0015','prod-max-green-0015','inventory_import',30117,39900,39900,39900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0016','MG-0016','3612XO','3612XO Vinyl Vista Slider 900 x 300','Sliding window','Vinyl','900 × 300','Unspecified',
   'quantity','stocked',20463,20463,25000,25000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   3.5,5,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0016','fifo',20463,20463,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0016','prod-max-green-0016','inventory_import',20463,25000,25000,25000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0016','loc-max-green-inside',7,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0016-inside','opening_balance','prod-max-green-0016',7,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0016',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',20463,'CAD','max-green-opening-MG-0016-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0016-inside','prod-max-green-0016','mov-max-green-mg-0016-inside',7,7,20463,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0016-inside','prod-max-green-0016','mov-max-green-mg-0016-inside','opening_balance',7,20463,143241,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0017','MG-0017','3624C','3624C Vinyl Vista LEFT Casement 35 1/2 x 24 1/2 White Vinyl 900 x 620','Casement window','Vinyl','35 1/2 × 24 1/2','White',
   'quantity','stocked',32914,32914,37500,37500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   7,10,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0017','fifo',32914,32914,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0017','prod-max-green-0017','inventory_import',32914,37500,37500,37500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0017','loc-max-green-inside',2,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0017-inside','opening_balance','prod-max-green-0017',2,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0017',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',32914,'CAD','max-green-opening-MG-0017-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0017-inside','prod-max-green-0017','mov-max-green-mg-0017-inside',2,2,32914,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0017-inside','prod-max-green-0017','mov-max-green-mg-0017-inside','opening_balance',2,32914,65828,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0018','MG-0018','3624C','3624C Vinyl Vista RIGHT Casement 35 1/2 x 24 1/2 White Vinyl 900 x 620','Casement window','Vinyl','35 1/2 × 24 1/2','White',
   'quantity','stocked',32914,32914,37500,37500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   7,10,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0018','fifo',32914,32914,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0018','prod-max-green-0018','inventory_import',32914,37500,37500,37500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0018','loc-max-green-inside',14,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0018-inside','opening_balance','prod-max-green-0018',14,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0018',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',32914,'CAD','max-green-opening-MG-0018-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0018-inside','prod-max-green-0018','mov-max-green-mg-0018-inside',14,14,32914,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0018-inside','prod-max-green-0018','mov-max-green-mg-0018-inside','opening_balance',14,32914,460796,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0019','MG-0019','3624XO','3624XO Vinyl Vista Slider Window 900 x 600 (35 3/8 x 23 5/8)','Sliding window','Vinyl','900 × 600','Unspecified',
   'quantity','stocked',20078,20078,25900,25900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   14,20,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0019','fifo',20078,20078,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0019','prod-max-green-0019','inventory_import',20078,25900,25900,25900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0019','loc-max-green-inside',3,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0019-inside','opening_balance','prod-max-green-0019',3,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0019',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',20078,'CAD','max-green-opening-MG-0019-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0019-inside','prod-max-green-0019','mov-max-green-mg-0019-inside',3,3,20078,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0019-inside','prod-max-green-0019','mov-max-green-mg-0019-inside','opening_balance',3,20078,60234,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0019','loc-max-green-outside',16,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0019-outside','opening_balance','prod-max-green-0019',16,NULL,'loc-max-green-outside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0019',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',20078,'CAD','max-green-opening-MG-0019-outside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0019-outside','prod-max-green-0019','mov-max-green-mg-0019-outside',16,16,20078,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0019-outside','prod-max-green-0019','mov-max-green-mg-0019-outside','opening_balance',16,20078,321248,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0020','MG-0020','3624C-B-36x24','3624C-B-36x24 BLACK LEFT Casement (35 1/2 x 24 1/2)','Casement window','Unspecified','36×24','Black',
   'quantity','stocked',35288,35288,49900,49900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   1.4,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0020','fifo',35288,35288,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0020','prod-max-green-0020','inventory_import',35288,49900,49900,49900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0020','loc-max-green-inside',9,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0020-inside','opening_balance','prod-max-green-0020',9,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0020',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',35288,'CAD','max-green-opening-MG-0020-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0020-inside','prod-max-green-0020','mov-max-green-mg-0020-inside',9,9,35288,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0020-inside','prod-max-green-0020','mov-max-green-mg-0020-inside','opening_balance',9,35288,317592,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0021','MG-0021','3624C-B-36x24','3624C-B-36x24 BLACK RIGHT Casement (35 1/2 x 24 1/2)','Casement window','Unspecified','36×24','Black',
   'quantity','stocked',35288,35288,49900,49900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   1.4,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0021','fifo',35288,35288,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0021','prod-max-green-0021','inventory_import',35288,49900,49900,49900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0021','loc-max-green-inside',4,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0021-inside','opening_balance','prod-max-green-0021',4,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0021',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',35288,'CAD','max-green-opening-MG-0021-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0021-inside','prod-max-green-0021','mov-max-green-mg-0021-inside',4,4,35288,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0021-inside','prod-max-green-0021','mov-max-green-mg-0021-inside','opening_balance',4,35288,141152,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0022','MG-0022','3630C-36x30','3630C-36x30 LEFT Casement  (900X750) (35 1/2 x 24 1/2)','Casement window','Unspecified','36×30','Unspecified',
   'quantity','stocked',33416,33416,39900,39900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   3.5,5,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0022','fifo',33416,33416,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0022','prod-max-green-0022','inventory_import',33416,39900,39900,39900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0022','loc-max-green-inside',4,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0022-inside','opening_balance','prod-max-green-0022',4,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0022',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',33416,'CAD','max-green-opening-MG-0022-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0022-inside','prod-max-green-0022','mov-max-green-mg-0022-inside',4,4,33416,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0022-inside','prod-max-green-0022','mov-max-green-mg-0022-inside','opening_balance',4,33416,133664,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0023','MG-0023','3630C-36x30','3630C-36x30 RIGHT Casement (900X750) (35 1/2 x 24 1/2)','Casement window','Unspecified','36×30','Unspecified',
   'quantity','stocked',33416,33416,39900,39900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   3.5,5,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0023','fifo',33416,33416,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0023','prod-max-green-0023','inventory_import',33416,39900,39900,39900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0023','loc-max-green-inside',1,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0023-inside','opening_balance','prod-max-green-0023',1,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0023',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',33416,'CAD','max-green-opening-MG-0023-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0023-inside','prod-max-green-0023','mov-max-green-mg-0023-inside',1,1,33416,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0023-inside','prod-max-green-0023','mov-max-green-mg-0023-inside','opening_balance',1,33416,33416,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0024','MG-0024','3636XO','3636XO Vinyl Vista Slider Windows 900 X 900 - 36 3/16" X 36 3/16"','Sliding window','Vinyl','900 × 900','Unspecified',
   'quantity','stocked',23989,23989,29500,29500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   10.5,15,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0024','fifo',23989,23989,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0024','prod-max-green-0024','inventory_import',23989,29500,29500,29500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0024','loc-max-green-inside',5,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0024-inside','opening_balance','prod-max-green-0024',5,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0024',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',23989,'CAD','max-green-opening-MG-0024-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0024-inside','prod-max-green-0024','mov-max-green-mg-0024-inside',5,5,23989,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0024-inside','prod-max-green-0024','mov-max-green-mg-0024-inside','opening_balance',5,23989,119945,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0025','MG-0025','4020HOPPER','4020HOPPER Vinyl Bsmt Window 1016X520.7','Basement window','Vinyl','1016×520.7','Unspecified',
   'quantity','stocked',25708,25708,32000,32000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   21,30,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0025','fifo',25708,25708,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0025','prod-max-green-0025','inventory_import',25708,32000,32000,32000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0025','loc-max-green-inside',2,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0025-inside','opening_balance','prod-max-green-0025',2,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0025',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',25708,'CAD','max-green-opening-MG-0025-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0025-inside','prod-max-green-0025','mov-max-green-mg-0025-inside',2,2,25708,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0025-inside','prod-max-green-0025','mov-max-green-mg-0025-inside','opening_balance',2,25708,51416,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0026','MG-0026','4432XO','4432XO Vinyl Vista Slider Windows 1117.6 x 825.5- 44" X 32 1/2','Sliding window','Vinyl','1117.6 × 825.5','Unspecified',
   'quantity','stocked',25747,25747,33500,33500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   35,50,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0026','fifo',25747,25747,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0026','prod-max-green-0026','inventory_import',25747,33500,33500,33500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0027','MG-0027','4419BIFORLD','4419BIFORLD Vinyl Vista Slider Windows 1117.6 x 825.5- 44" X 32 1/2','Sliding window','Vinyl','1117.6 × 825.5','Unspecified',
   'quantity','stocked',38074,38074,44900,44900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   42,60,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0027','fifo',38074,38074,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0027','prod-max-green-0027','inventory_import',38074,44900,44900,44900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0028','MG-0028','4824XO','4824XO Vinyl Vista Slider Windows 1200 x 600 - 48" X 23 3/8"','Sliding window','Vinyl','1200 × 600','Unspecified',
   'quantity','stocked',20216,20216,27000,27000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   10.5,15,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0028','fifo',20216,20216,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0028','prod-max-green-0028','inventory_import',20216,27000,27000,27000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0028','loc-max-green-inside',232,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0028-inside','opening_balance','prod-max-green-0028',232,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0028',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',20216,'CAD','max-green-opening-MG-0028-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0028-inside','prod-max-green-0028','mov-max-green-mg-0028-inside',232,232,20216,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0028-inside','prod-max-green-0028','mov-max-green-mg-0028-inside','opening_balance',232,20216,4690112,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0029','MG-0029','4830XO','4830XO Egress Window - Single Slider XO Double Glaze','Sliding window','Unspecified','See product description','Unspecified',
   'quantity','stocked',24408,24408,29900,29900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   42,60,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0029','fifo',24408,24408,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0029','prod-max-green-0029','inventory_import',24408,29900,29900,29900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0029','loc-max-green-inside',36,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0029-inside','opening_balance','prod-max-green-0029',36,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0029',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',24408,'CAD','max-green-opening-MG-0029-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0029-inside','prod-max-green-0029','mov-max-green-mg-0029-inside',36,36,24408,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0029-inside','prod-max-green-0029','mov-max-green-mg-0029-inside','opening_balance',36,24408,878688,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0030','MG-0030','4830XI','4830XI Egress Window - Double Slider XO Double Glaze','Sliding window','Unspecified','See product description','Unspecified',
   'quantity','stocked',25555,25555,36500,36500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,0,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0030','fifo',25555,25555,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0030','prod-max-green-0030','inventory_import',25555,36500,36500,36500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0030','loc-max-green-inside',17,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0030-inside','opening_balance','prod-max-green-0030',17,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0030',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',25555,'CAD','max-green-opening-MG-0030-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0030-inside','prod-max-green-0030','mov-max-green-mg-0030-inside',17,17,25555,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0030-inside','prod-max-green-0030','mov-max-green-mg-0030-inside','opening_balance',17,25555,434435,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0031','MG-0031','4832XO-B','4832XO-B BLACK Egress Window - Single Slider XO Double Glaze','Sliding window','Unspecified','See product description','Black',
   'quantity','stocked',33684,33684,52900,52900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   7,10,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0031','fifo',33684,33684,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0031','prod-max-green-0031','inventory_import',33684,52900,52900,52900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0031','loc-max-green-inside',5,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0031-inside','opening_balance','prod-max-green-0031',5,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0031',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',33684,'CAD','max-green-opening-MG-0031-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0031-inside','prod-max-green-0031','mov-max-green-mg-0031-inside',5,5,33684,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0031-inside','prod-max-green-0031','mov-max-green-mg-0031-inside','opening_balance',5,33684,168420,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0031','loc-max-green-outside',10,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0031-outside','opening_balance','prod-max-green-0031',10,NULL,'loc-max-green-outside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0031',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',33684,'CAD','max-green-opening-MG-0031-outside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0031-outside','prod-max-green-0031','mov-max-green-mg-0031-outside',10,10,33684,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0031-outside','prod-max-green-0031','mov-max-green-mg-0031-outside','opening_balance',10,33684,336840,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0032','MG-0032','4832XO','4832XO TRIPLE GLAZE Window - Single Slider XO','Sliding window','Unspecified','See product description','Unspecified',
   'quantity','stocked',32548,32548,39900,39900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   17.5,25,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0032','fifo',32548,32548,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0032','prod-max-green-0032','inventory_import',32548,39900,39900,39900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0032','loc-max-green-inside',7,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0032-inside','opening_balance','prod-max-green-0032',7,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0032',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',32548,'CAD','max-green-opening-MG-0032-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0032-inside','prod-max-green-0032','mov-max-green-mg-0032-inside',7,7,32548,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0032-inside','prod-max-green-0032','mov-max-green-mg-0032-inside','opening_balance',7,32548,227836,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0033','MG-0033','4836XO','4836XO Vinyl Vista Slider Windows 1200 X 900 -47 1/4" X 35 7/16"','Sliding window','Vinyl','1200 × 900','Unspecified',
   'quantity','stocked',27074,27074,33000,33000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   28,40,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0033','fifo',27074,27074,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0033','prod-max-green-0033','inventory_import',27074,33000,33000,33000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0033','loc-max-green-outside',20,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0033-outside','opening_balance','prod-max-green-0033',20,NULL,'loc-max-green-outside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0033',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',27074,'CAD','max-green-opening-MG-0033-outside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0033-outside','prod-max-green-0033','mov-max-green-mg-0033-outside',20,20,27074,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0033-outside','prod-max-green-0033','mov-max-green-mg-0033-outside','opening_balance',20,27074,541480,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0034','MG-0034','4836P','4836P Vinyl Vista Picture Windows 1200 X 900 -47 1/4" X 35 7/16"','Picture window','Vinyl','1200 × 900','Unspecified',
   'quantity','stocked',19429,19429,27000,27000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   14,20,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0034','fifo',19429,19429,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0034','prod-max-green-0034','inventory_import',19429,27000,27000,27000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0034','loc-max-green-inside',8,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0034-inside','opening_balance','prod-max-green-0034',8,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0034',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',19429,'CAD','max-green-opening-MG-0034-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0034-inside','prod-max-green-0034','mov-max-green-mg-0034-inside',8,8,19429,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0034-inside','prod-max-green-0034','mov-max-green-mg-0034-inside','opening_balance',8,19429,155432,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0035','MG-0035','4848XO','4848XO Vinyl Vista Slider Windows 1200 X 1500 - 47 1/4 X 47 1/4','Sliding window','Vinyl','1200 × 1500','Unspecified',
   'quantity','stocked',32266,32266,39900,39900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   14,20,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0035','fifo',32266,32266,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0035','prod-max-green-0035','inventory_import',32266,39900,39900,39900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0035','loc-max-green-outside',10,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0035-outside','opening_balance','prod-max-green-0035',10,NULL,'loc-max-green-outside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0035',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',32266,'CAD','max-green-opening-MG-0035-outside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0035-outside','prod-max-green-0035','mov-max-green-mg-0035-outside',10,10,32266,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0035-outside','prod-max-green-0035','mov-max-green-mg-0035-outside','opening_balance',10,32266,322660,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0036','MG-0036','4860XO','4860XO Vinyl Vista Slider Windows 1200 X 1200 - 47 1/4 X 59','Sliding window','Vinyl','1200 × 1200','Unspecified',
   'quantity','stocked',39126,39126,56000,56000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   1.4,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0036','fifo',39126,39126,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0036','prod-max-green-0036','inventory_import',39126,56000,56000,56000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0037','MG-0037','4860PV','4860PV Vinyl Vista Slider Windows - 47 1/4 X 59','Sliding window','Vinyl','47 1/4 × 59','Unspecified',
   'quantity','stocked',39126,39126,56000,56000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   10.5,15,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0037','fifo',39126,39126,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0037','prod-max-green-0037','inventory_import',39126,56000,56000,56000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0038','MG-0038','6024XO','6024XO Vinyl Vista Slider 1500 x 603 (60x24)','Sliding window','Vinyl','1500 × 603','Unspecified',
   'quantity','stocked',24547,24547,29900,29900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   35,50,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0038','fifo',24547,24547,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0038','prod-max-green-0038','inventory_import',24547,29900,29900,29900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0038','loc-max-green-inside',11,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0038-inside','opening_balance','prod-max-green-0038',11,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0038',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',24547,'CAD','max-green-opening-MG-0038-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0038-inside','prod-max-green-0038','mov-max-green-mg-0038-inside',11,11,24547,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0038-inside','prod-max-green-0038','mov-max-green-mg-0038-inside','opening_balance',11,24547,270017,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0039','MG-0039','6024XI','6024XI Egress Window - Double Slider XO Double Glaze','Sliding window','Unspecified','See product description','Unspecified',
   'quantity','stocked',31912,31912,53000,53000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   2.0999999999999996,3,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0039','fifo',31912,31912,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0039','prod-max-green-0039','inventory_import',31912,53000,53000,53000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0040','MG-0040','6024XO','6024XO BLACK Vinyl Vista Slider 1500 x 603 (60x24)','Sliding window','Vinyl','1500 × 603','Black',
   'quantity','stocked',37326,37326,49900,49900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   7,10,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0040','fifo',37326,37326,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0040','prod-max-green-0040','inventory_import',37326,49900,49900,49900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0041','MG-0041','6030XO','6030XO Vinyl Vista Slider Window 1500 x 750 - 59 1/16 x 29 3/4','Sliding window','Vinyl','1500 × 750','Unspecified',
   'quantity','stocked',27664,27664,33000,33000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   35,50,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0041','fifo',27664,27664,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0041','prod-max-green-0041','inventory_import',27664,33000,33000,33000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0042','MG-0042','6036XO','6036XO Vinyl Vista Slider Windows 1500 X 900 59 1/16" X 35 7/16"','Sliding window','Vinyl','1500 × 900','Unspecified',
   'quantity','stocked',30289,30289,37000,37000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   35,50,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0042','fifo',30289,30289,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0042','prod-max-green-0042','inventory_import',30289,37000,37000,37000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0042','loc-max-green-inside',1,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0042-inside','opening_balance','prod-max-green-0042',1,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0042',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',30289,'CAD','max-green-opening-MG-0042-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0042-inside','prod-max-green-0042','mov-max-green-mg-0042-inside',1,1,30289,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0042-inside','prod-max-green-0042','mov-max-green-mg-0042-inside','opening_balance',1,30289,30289,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0043','MG-0043','6040XO','6040XO Vinyl Vista Slider Windows 1500 X 1000 59 1/16" X 39 3/8"','Sliding window','Vinyl','1500 × 1000','Unspecified',
   'quantity','stocked',33876,33876,48500,48500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   7,10,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0043','fifo',33876,33876,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0043','prod-max-green-0043','inventory_import',33876,48500,48500,48500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0044','MG-0044','6048XO','6048XO Vinyl Vista Slider Windows 1500 X 1200 - (59 x 47 1/4)','Sliding window','Vinyl','1500 × 1200','Unspecified',
   'quantity','stocked',38047,38047,44500,44500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   14,20,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0044','fifo',38047,38047,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0044','prod-max-green-0044','inventory_import',38047,44500,44500,44500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0044','loc-max-green-inside',8,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0044-inside','opening_balance','prod-max-green-0044',8,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0044',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',38047,'CAD','max-green-opening-MG-0044-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0044-inside','prod-max-green-0044','mov-max-green-mg-0044-inside',8,8,38047,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0044-inside','prod-max-green-0044','mov-max-green-mg-0044-inside','opening_balance',8,38047,304376,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0045','MG-0045','6060XO','6060XO Vinyl Vista Slider Windows 1500 X 1500 - (59 x 59)','Sliding window','Vinyl','1500 × 1500','Unspecified',
   'quantity','stocked',42408,42408,53000,53000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   4.199999999999999,6,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0045','fifo',42408,42408,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0045','prod-max-green-0045','inventory_import',42408,53000,53000,53000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0046','MG-0046','7236XO','7236XO Vinyl Vista Slider Windows 1800 X 900 - (70 7/8 x 35 1/2)','Sliding window','Vinyl','1800 × 900','Unspecified',
   'quantity','stocked',34385,34385,43500,43500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   2.8,4,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0046','fifo',34385,34385,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0046','prod-max-green-0046','inventory_import',34385,43500,43500,43500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0046','loc-max-green-inside',6,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0046-inside','opening_balance','prod-max-green-0046',6,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0046',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',34385,'CAD','max-green-opening-MG-0046-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0046-inside','prod-max-green-0046','mov-max-green-mg-0046-inside',6,6,34385,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0046-inside','prod-max-green-0046','mov-max-green-mg-0046-inside','opening_balance',6,34385,206310,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0046','loc-max-green-outside',6,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0046-outside','opening_balance','prod-max-green-0046',6,NULL,'loc-max-green-outside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0046',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',34385,'CAD','max-green-opening-MG-0046-outside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0046-outside','prod-max-green-0046','mov-max-green-mg-0046-outside',6,6,34385,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0046-outside','prod-max-green-0046','mov-max-green-mg-0046-outside','opening_balance',6,34385,206310,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0047','MG-0047','7248XO','7248XO Vinyl Vista Slider Windows 1800 X 1200 - (70 7/8 x 47 1/4)','Sliding window','Vinyl','1800 × 1200','Unspecified',
   'quantity','stocked',40776,40776,51000,51000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   2.8,4,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0047','fifo',40776,40776,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0047','prod-max-green-0047','inventory_import',40776,51000,51000,51000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0047','loc-max-green-inside',3,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0047-inside','opening_balance','prod-max-green-0047',3,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0047',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',40776,'CAD','max-green-opening-MG-0047-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0047-inside','prod-max-green-0047','mov-max-green-mg-0047-inside',3,3,40776,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0047-inside','prod-max-green-0047','mov-max-green-mg-0047-inside','opening_balance',3,40776,122328,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0048','MG-0048','7260XO','7260XO Vinyl Vista Slider Windows 1800 X 1500 - (70 7/8 x 59)','Sliding window','Vinyl','1800 × 1500','Unspecified',
   'quantity','stocked',44940,44940,59500,59500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   2.8,4,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0048','fifo',44940,44940,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0048','prod-max-green-0048','inventory_import',44940,59500,59500,59500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0049','MG-0049','9660XOX','9660XOX Vinyl Vista Slider Windows 2400 X 1500 - (94 1/2 x 59 1)','Sliding window','Vinyl','2400 × 1500','Unspecified',
   'quantity','stocked',74317,74317,95000,95000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   1.4,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0049','fifo',74317,74317,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0049','prod-max-green-0049','inventory_import',74317,95000,95000,95000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0049','loc-max-green-inside',4,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0049-inside','opening_balance','prod-max-green-0049',4,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0049',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',74317,'CAD','max-green-opening-MG-0049-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0049-inside','prod-max-green-0049','mov-max-green-mg-0049-inside',4,4,74317,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0049-inside','prod-max-green-0049','mov-max-green-mg-0049-inside','opening_balance',4,74317,297268,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0050','MG-0050','9660LPR','9660LPR Casement Windows 2400 X 1500 - (94 1/2 x 59 1)','Casement window','Unspecified','2400 × 1500','Unspecified',
   'quantity','stocked',99492,99492,135000,135000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   1.4,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0050','fifo',99492,99492,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0050','prod-max-green-0050','inventory_import',99492,135000,135000,135000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0050','loc-max-green-inside',5,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0050-inside','opening_balance','prod-max-green-0050',5,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0050',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',99492,'CAD','max-green-opening-MG-0050-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0050-inside','prod-max-green-0050','mov-max-green-mg-0050-inside',5,5,99492,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0050-inside','prod-max-green-0050','mov-max-green-mg-0050-inside','opening_balance',5,99492,497460,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0051','MG-0051','3280','3280 BLANK SLAB - RHI 2x4 3680 Swing Doors - Blank Slab (No Glass)','Door slab','Unspecified','2×4','Unspecified',
   'quantity','stocked',45817,45817,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0051','fifo',45817,45817,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0051','prod-max-green-0051','inventory_import',45817,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0051','loc-max-green-inside',4,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0051-inside','opening_balance','prod-max-green-0051',4,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0051',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',45817,'CAD','max-green-opening-MG-0051-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0051-inside','prod-max-green-0051','mov-max-green-mg-0051-inside',4,4,45817,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0051-inside','prod-max-green-0051','mov-max-green-mg-0051-inside','opening_balance',4,45817,183268,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0052','MG-0052','3280','3280 BLANK SLAB - LHI 2x4 3680 Swing Doors - Blank Slab (No Glass)','Door slab','Unspecified','2×4','Unspecified',
   'quantity','stocked',45817,45817,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0052','fifo',45817,45817,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0052','prod-max-green-0052','inventory_import',45817,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0052','loc-max-green-inside',3,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0052-inside','opening_balance','prod-max-green-0052',3,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0052',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',45817,'CAD','max-green-opening-MG-0052-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0052-inside','prod-max-green-0052','mov-max-green-mg-0052-inside',3,3,45817,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0052-inside','prod-max-green-0052','mov-max-green-mg-0052-inside','opening_balance',3,45817,137451,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0053','MG-0053','3680','3680 BLANK SLAB - RHI 2x6 3680 Swing Doors - Blank Slab (No Glass)','Door slab','Unspecified','2×6','Unspecified',
   'quantity','stocked',45817,45817,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0053','fifo',45817,45817,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0053','prod-max-green-0053','inventory_import',45817,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0054','MG-0054','3680','3680 BLANK SLAB - LHI 2x6 3680 Swing Doors - Blank Slab (No Glass)','Door slab','Unspecified','2×6','Unspecified',
   'quantity','stocked',45817,45817,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0054','fifo',45817,45817,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0054','prod-max-green-0054','inventory_import',45817,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0055','MG-0055','3280','3280 6PANEL - RHI 2x4 3280 Swing Doors - 6 Panel (No Glass)','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',46858,46858,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0055','fifo',46858,46858,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0055','prod-max-green-0055','inventory_import',46858,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0056','MG-0056','3280','3280 6PANEL - LHI 2x4 3280 Swing Doors - 6 Panel (No Glass)','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',46858,46858,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0056','fifo',46858,46858,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0056','prod-max-green-0056','inventory_import',46858,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0056','loc-max-green-inside',1,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0056-inside','opening_balance','prod-max-green-0056',1,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0056',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',46858,'CAD','max-green-opening-MG-0056-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0056-inside','prod-max-green-0056','mov-max-green-mg-0056-inside',1,1,46858,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0056-inside','prod-max-green-0056','mov-max-green-mg-0056-inside','opening_balance',1,46858,46858,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0057','MG-0057','3280','3280 6PANEL - RHI 2x6 3280 Swing Doors - 6 Panel (No Glass)','Entry door','Unspecified','2×6','Unspecified',
   'quantity','stocked',46858,46858,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0057','fifo',46858,46858,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0057','prod-max-green-0057','inventory_import',46858,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0057','loc-max-green-inside',2,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0057-inside','opening_balance','prod-max-green-0057',2,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0057',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',46858,'CAD','max-green-opening-MG-0057-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0057-inside','prod-max-green-0057','mov-max-green-mg-0057-inside',2,2,46858,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0057-inside','prod-max-green-0057','mov-max-green-mg-0057-inside','opening_balance',2,46858,93716,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0058','MG-0058','3280','3280 6PANEL - LHI 2x6 3280 Swing Doors - 6 Panel (No Glass)','Entry door','Unspecified','2×6','Unspecified',
   'quantity','stocked',46858,46858,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0058','fifo',46858,46858,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0058','prod-max-green-0058','inventory_import',46858,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0058','loc-max-green-inside',1,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0058-inside','opening_balance','prod-max-green-0058',1,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0058',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',46858,'CAD','max-green-opening-MG-0058-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0058-inside','prod-max-green-0058','mov-max-green-mg-0058-inside',1,1,46858,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0058-inside','prod-max-green-0058','mov-max-green-mg-0058-inside','opening_balance',1,46858,46858,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0059','MG-0059','3680','3680 6PANEL - RHI 2x4 3680 Swing Doors - 6 Panel (No Glass)','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',46858,46858,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0059','fifo',46858,46858,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0059','prod-max-green-0059','inventory_import',46858,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0060','MG-0060','3680','3680 6PANEL - LHI 2x4 3680 Swing Doors - 6 Panel (No Glass)','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',46858,46858,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0060','fifo',46858,46858,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0060','prod-max-green-0060','inventory_import',46858,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0060','loc-max-green-inside',1,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0060-inside','opening_balance','prod-max-green-0060',1,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0060',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',46858,'CAD','max-green-opening-MG-0060-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0060-inside','prod-max-green-0060','mov-max-green-mg-0060-inside',1,1,46858,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0060-inside','prod-max-green-0060','mov-max-green-mg-0060-inside','opening_balance',1,46858,46858,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0061','MG-0061','3680','3680 6PANEL - RHI 2x6 3680 Swing Doors - 6 Panel (No Glass)','Entry door','Unspecified','2×6','Unspecified',
   'quantity','stocked',46858,46858,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0061','fifo',46858,46858,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0061','prod-max-green-0061','inventory_import',46858,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0062','MG-0062','3680','3680 6PANEL - LHI 2x6 3680 Swing Doors - 6 Panel (No Glass)','Entry door','Unspecified','2×6','Unspecified',
   'quantity','stocked',46858,46858,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0062','fifo',46858,46858,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0062','prod-max-green-0062','inventory_import',46858,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0063','MG-0063','3680','3680 6PANEL - RHO 2x4 3680 Swing Doors - 6 Panel (No Glass)','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',46858,46858,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,0,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0063','fifo',46858,46858,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0063','prod-max-green-0063','inventory_import',46858,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0064','MG-0064','3680','3680 6PANEL - LHO 2x4 3680 Swing Doors - 6 Panel (No Glass)','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',46858,46858,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,0,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0064','fifo',46858,46858,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0064','prod-max-green-0064','inventory_import',46858,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0065','MG-0065','3280','3280 6PANEL - RHO 2x4 3280 Swing Doors - 6 Panel (No Glass)','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',46858,46858,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0065','fifo',46858,46858,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0065','prod-max-green-0065','inventory_import',46858,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0066','MG-0066','3280','3280 6PANEL - LHO 2x4 3280 Swing Doors - 6 Panel (No Glass)','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',46858,46858,65000,65000,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0066','fifo',46858,46858,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0066','prod-max-green-0066','inventory_import',46858,65000,65000,65000,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0067','MG-0067','3280CRAFTSMAN','3280CRAFTSMAN QUARTERLITE RHI 2x4 - 3280 Swing Doors - 22x17 Craftsman Glass 33 1/2 x 82/14','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',59725,59725,84900,84900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0067','fifo',59725,59725,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0067','prod-max-green-0067','inventory_import',59725,84900,84900,84900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0068','MG-0068','3280CRAFTSMAN','3280CRAFTSMAN QUARTERLITE LHI 2x4 - 3280 Swing Doors - 22x17 Craftsman Glass 33 1/2 x 82/14','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',59725,59725,84900,84900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0068','fifo',59725,59725,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0068','prod-max-green-0068','inventory_import',59725,84900,84900,84900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0069','MG-0069','3280CRAFTSMAN','3280CRAFTSMAN QUARTERLITE RHI 2x6 - 3280 Swing Doors - 22x17 Craftsman Glass 33 1/2 x 82/14','Entry door','Unspecified','2×6','Unspecified',
   'quantity','stocked',59725,59725,84900,84900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0069','fifo',59725,59725,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0069','prod-max-green-0069','inventory_import',59725,84900,84900,84900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0070','MG-0070','3280CRAFTSMAN','3280CRAFTSMAN QUARTERLITE LHI 2x6 - 3280 Swing Doors - 22x17 Craftsman Glass 33 1/2 x 82/14','Entry door','Unspecified','2×6','Unspecified',
   'quantity','stocked',59725,59725,84900,84900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0070','fifo',59725,59725,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0070','prod-max-green-0070','inventory_import',59725,84900,84900,84900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0070','loc-max-green-inside',3,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0070-inside','opening_balance','prod-max-green-0070',3,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0070',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',59725,'CAD','max-green-opening-MG-0070-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0070-inside','prod-max-green-0070','mov-max-green-mg-0070-inside',3,3,59725,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0070-inside','prod-max-green-0070','mov-max-green-mg-0070-inside','opening_balance',3,59725,179175,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0071','MG-0071','3680CRAFTSMAN','3680CRAFTSMAN RHI 2x4 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad','Entry door','Vinyl','2×4','Unspecified',
   'quantity','stocked',59725,59725,84900,84900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0071','fifo',59725,59725,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0071','prod-max-green-0071','inventory_import',59725,84900,84900,84900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0071','loc-max-green-inside',7,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0071-inside','opening_balance','prod-max-green-0071',7,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0071',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',59725,'CAD','max-green-opening-MG-0071-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0071-inside','prod-max-green-0071','mov-max-green-mg-0071-inside',7,7,59725,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0071-inside','prod-max-green-0071','mov-max-green-mg-0071-inside','opening_balance',7,59725,418075,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0072','MG-0072','3680CRAFTSMAN','3680CRAFTSMAN LHI 2x4 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad','Entry door','Vinyl','2×4','Unspecified',
   'quantity','stocked',59725,59725,84900,84900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0072','fifo',59725,59725,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0072','prod-max-green-0072','inventory_import',59725,84900,84900,84900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0073','MG-0073','3680CRAFTSMAN','3680CRAFTSMAN RHI 2x6 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad','Entry door','Vinyl','2×6','Unspecified',
   'quantity','stocked',59725,59725,84900,84900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0073','fifo',59725,59725,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0073','prod-max-green-0073','inventory_import',59725,84900,84900,84900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0073','loc-max-green-inside',3,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0073-inside','opening_balance','prod-max-green-0073',3,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0073',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',59725,'CAD','max-green-opening-MG-0073-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0073-inside','prod-max-green-0073','mov-max-green-mg-0073-inside',3,3,59725,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0073-inside','prod-max-green-0073','mov-max-green-mg-0073-inside','opening_balance',3,59725,179175,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0074','MG-0074','3680CRAFTSMAN','3680CRAFTSMAN LHI 2x6 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad','Entry door','Vinyl','2×6','Unspecified',
   'quantity','stocked',59725,59725,84900,84900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0074','fifo',59725,59725,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0074','prod-max-green-0074','inventory_import',59725,84900,84900,84900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0074','loc-max-green-inside',1,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0074-inside','opening_balance','prod-max-green-0074',1,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0074',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',59725,'CAD','max-green-opening-MG-0074-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0074-inside','prod-max-green-0074','mov-max-green-mg-0074-inside',1,1,59725,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0074-inside','prod-max-green-0074','mov-max-green-mg-0074-inside','opening_balance',1,59725,59725,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0075','MG-0075','3680CRAFTSMAN','3680CRAFTSMAN RHO 2x4 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad','Entry door','Vinyl','2×4','Unspecified',
   'quantity','stocked',59725,59725,84900,84900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0075','fifo',59725,59725,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0075','prod-max-green-0075','inventory_import',59725,84900,84900,84900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0076','MG-0076','3680CRAFTSMAN','3680CRAFTSMAN LHO 2x4 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad','Entry door','Vinyl','2×4','Unspecified',
   'quantity','stocked',59725,59725,84900,84900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0076','fifo',59725,59725,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0076','prod-max-green-0076','inventory_import',59725,84900,84900,84900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0077','MG-0077','3680CRAFTSMAN','3680CRAFTSMAN RHO 2x6 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad','Entry door','Vinyl','2×6','Unspecified',
   'quantity','stocked',59725,59725,84900,84900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0077','fifo',59725,59725,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0077','prod-max-green-0077','inventory_import',59725,84900,84900,84900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0078','MG-0078','3680CRAFTSMAN','3680CRAFTSMAN LHO 2x6 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad','Entry door','Vinyl','2×6','Unspecified',
   'quantity','stocked',59725,59725,84900,84900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0078','fifo',59725,59725,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0078','prod-max-green-0078','inventory_import',59725,84900,84900,84900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0079','MG-0079','3280HALFLITE','3280HALFLITE RHI 2x4 - 3280 Swing Doors - 1/2 Glass','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',57633,57633,82500,82500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0079','fifo',57633,57633,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0079','prod-max-green-0079','inventory_import',57633,82500,82500,82500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0080','MG-0080','3280HALFLITE','3280HALFLITE LHI 2x4 - 3280 Swing Doors - 1/2 Glass','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',57633,57633,82500,82500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0080','fifo',57633,57633,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0080','prod-max-green-0080','inventory_import',57633,82500,82500,82500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0080','loc-max-green-inside',3,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0080-inside','opening_balance','prod-max-green-0080',3,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0080',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',57633,'CAD','max-green-opening-MG-0080-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0080-inside','prod-max-green-0080','mov-max-green-mg-0080-inside',3,3,57633,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0080-inside','prod-max-green-0080','mov-max-green-mg-0080-inside','opening_balance',3,57633,172899,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0081','MG-0081','3280HALFLITE','3280HALFLITE RHI 2x6 - 3280 Swing Doors - 1/2 Glass','Entry door','Unspecified','2×6','Unspecified',
   'quantity','stocked',57633,57633,82500,82500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0081','fifo',57633,57633,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0081','prod-max-green-0081','inventory_import',57633,82500,82500,82500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0081','loc-max-green-inside',1,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0081-inside','opening_balance','prod-max-green-0081',1,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0081',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',57633,'CAD','max-green-opening-MG-0081-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0081-inside','prod-max-green-0081','mov-max-green-mg-0081-inside',1,1,57633,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0081-inside','prod-max-green-0081','mov-max-green-mg-0081-inside','opening_balance',1,57633,57633,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0082','MG-0082','3280HALFLITE','3280HALFLITE LHI 2x6 - 3280 Swing Doors - 1/2 Glass','Entry door','Unspecified','2×6','Unspecified',
   'quantity','stocked',57633,57633,82500,82500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0082','fifo',57633,57633,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0082','prod-max-green-0082','inventory_import',57633,82500,82500,82500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0082','loc-max-green-inside',2,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0082-inside','opening_balance','prod-max-green-0082',2,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0082',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',57633,'CAD','max-green-opening-MG-0082-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0082-inside','prod-max-green-0082','mov-max-green-mg-0082-inside',2,2,57633,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0082-inside','prod-max-green-0082','mov-max-green-mg-0082-inside','opening_balance',2,57633,115266,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0083','MG-0083','3280HALFLITE','3280HALFLITE RHO 2x4 - 3280 Swing Doors - 1/2 Glass','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',57633,57633,82500,82500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0083','fifo',57633,57633,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0083','prod-max-green-0083','inventory_import',57633,82500,82500,82500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0084','MG-0084','3280HALFLITE','3280HALFLITE LHO 2x4 - 3280 Swing Doors - 1/2 Glass','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',57633,57633,82500,82500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0084','fifo',57633,57633,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0084','prod-max-green-0084','inventory_import',57633,82500,82500,82500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0085','MG-0085','3680HALFLITE','3680HALFLITE RHI 2x4 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad Half Lite 22x36 Glass I/S Entry Door','Entry door','Vinyl','2×4','Unspecified',
   'quantity','stocked',57633,57633,82500,82500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0085','fifo',57633,57633,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0085','prod-max-green-0085','inventory_import',57633,82500,82500,82500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0086','MG-0086','3680HALFLITE','3680HALFLITE LHI 2x4 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad Half Lite 22x36 Glass I/S Entry Door','Entry door','Vinyl','2×4','Unspecified',
   'quantity','stocked',57633,57633,82500,82500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0086','fifo',57633,57633,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0086','prod-max-green-0086','inventory_import',57633,82500,82500,82500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0086','loc-max-green-inside',1,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0086-inside','opening_balance','prod-max-green-0086',1,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0086',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',57633,'CAD','max-green-opening-MG-0086-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0086-inside','prod-max-green-0086','mov-max-green-mg-0086-inside',1,1,57633,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0086-inside','prod-max-green-0086','mov-max-green-mg-0086-inside','opening_balance',1,57633,57633,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0087','MG-0087','3680HALFLITE','3680HALFLITE RHI 2x6 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad Half Lite 22x36 Glass I/S Entry Door','Entry door','Vinyl','2×6','Unspecified',
   'quantity','stocked',57633,57633,82500,82500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0087','fifo',57633,57633,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0087','prod-max-green-0087','inventory_import',57633,82500,82500,82500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0087','loc-max-green-inside',1,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0087-inside','opening_balance','prod-max-green-0087',1,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0087',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',57633,'CAD','max-green-opening-MG-0087-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0087-inside','prod-max-green-0087','mov-max-green-mg-0087-inside',1,1,57633,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0087-inside','prod-max-green-0087','mov-max-green-mg-0087-inside','opening_balance',1,57633,57633,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0088','MG-0088','3680HALFLITE','3680HALFLITE LHI 2x6 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad Half Lite 22x36 Glass I/S Entry Door','Entry door','Vinyl','2×6','Unspecified',
   'quantity','stocked',57633,57633,82500,82500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0088','fifo',57633,57633,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0088','prod-max-green-0088','inventory_import',57633,82500,82500,82500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0088','loc-max-green-inside',1,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0088-inside','opening_balance','prod-max-green-0088',1,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0088',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',57633,'CAD','max-green-opening-MG-0088-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0088-inside','prod-max-green-0088','mov-max-green-mg-0088-inside',1,1,57633,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0088-inside','prod-max-green-0088','mov-max-green-mg-0088-inside','opening_balance',1,57633,57633,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0089','MG-0089','3680HALFLITE','3680HALFLITE RHO 2x4 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad Half Lite 22x36 Glass I/S Entry Door','Entry door','Vinyl','2×4','Unspecified',
   'quantity','stocked',57633,57633,82500,82500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0089','fifo',57633,57633,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0089','prod-max-green-0089','inventory_import',57633,82500,82500,82500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0090','MG-0090','3680HALFLITE','3680HALFLITE LHO 2x4 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad Half Lite 22x36 Glass I/S Entry Door','Entry door','Vinyl','2×4','Unspecified',
   'quantity','stocked',57633,57633,82500,82500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0090','fifo',57633,57633,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0090','prod-max-green-0090','inventory_import',57633,82500,82500,82500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0091','MG-0091','3280FULLLITE','3280FULLLITE RHI 2x4 - 3280 Swing Doors - Full Glass 2264 331/2 x 81/18','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',63922,63922,89900,89900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0091','fifo',63922,63922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0091','prod-max-green-0091','inventory_import',63922,89900,89900,89900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0092','MG-0092','3280FULLLITE','3280FULLLITE LHI 2x4 - 3280 Swing Doors - Full Glass 2264 331/2 x 81/18','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',63922,63922,89900,89900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0092','fifo',63922,63922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0092','prod-max-green-0092','inventory_import',63922,89900,89900,89900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0093','MG-0093','3280FULLLITE','3280FULLLITE RHI 2x6 - 3280 Swing Doors - Full Glass 2264 331/2 x 81/18','Entry door','Unspecified','2×6','Unspecified',
   'quantity','stocked',63922,63922,89900,89900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0093','fifo',63922,63922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0093','prod-max-green-0093','inventory_import',63922,89900,89900,89900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0094','MG-0094','3280FULLLITE','3280FULLLITE LHI 2x6 - 3280 Swing Doors - Full Glass 2264 331/2 x 81/18','Entry door','Unspecified','2×6','Unspecified',
   'quantity','stocked',63922,63922,89900,89900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0094','fifo',63922,63922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0094','prod-max-green-0094','inventory_import',63922,89900,89900,89900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0095','MG-0095','3280FULLLITE','3280FULLLITE RHO 2x4 - 3280 Swing Doors - Full Glass 2264 331/2 x 81/18','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',63922,63922,89900,89900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0095','fifo',63922,63922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0095','prod-max-green-0095','inventory_import',63922,89900,89900,89900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0096','MG-0096','3280FULLLITE','3280FULLLITE LHO 2x4 - 3280 Swing Doors - Full Glass 2264 331/2 x 81/18','Entry door','Unspecified','2×4','Unspecified',
   'quantity','stocked',63922,63922,89900,89900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0096','fifo',63922,63922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0096','prod-max-green-0096','inventory_import',63922,89900,89900,89900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0097','MG-0097','3680FULLLITE','3680FULLLITE RHI 2x4 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad Full Lite 20x64 Glass O/S Entry Door','Entry door','Vinyl','2×4','Unspecified',
   'quantity','stocked',63922,63922,89900,89900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0097','fifo',63922,63922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0097','prod-max-green-0097','inventory_import',63922,89900,89900,89900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0098','MG-0098','3680FULLLITE','3680FULLLITE LHI 2x4 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad Full Lite 20x64 Glass O/S Entry Door','Entry door','Vinyl','2×4','Unspecified',
   'quantity','stocked',63922,63922,89900,89900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0098','fifo',63922,63922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0098','prod-max-green-0098','inventory_import',63922,89900,89900,89900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0099','MG-0099','3680FULLLITE','3680FULLLITE RHI 2x6 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad Full Lite 20x64 Glass O/S Entry Door','Entry door','Vinyl','2×6','Unspecified',
   'quantity','stocked',63922,63922,89900,89900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0099','fifo',63922,63922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0099','prod-max-green-0099','inventory_import',63922,89900,89900,89900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0099','loc-max-green-inside',1,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0099-inside','opening_balance','prod-max-green-0099',1,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0099',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',63922,'CAD','max-green-opening-MG-0099-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0099-inside','prod-max-green-0099','mov-max-green-mg-0099-inside',1,1,63922,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0099-inside','prod-max-green-0099','mov-max-green-mg-0099-inside','opening_balance',1,63922,63922,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0100','MG-0100','3680FULLLITE','3680FULLLITE LHI 2x6 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad Full Lite 20x64 Glass O/S Entry Door','Entry door','Vinyl','2×6','Unspecified',
   'quantity','stocked',63922,63922,89900,89900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0100','fifo',63922,63922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0100','prod-max-green-0100','inventory_import',63922,89900,89900,89900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0101','MG-0101','3680FULLLITE','3680FULLLITE RHO 2x4 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad Full Lite 20x64 Glass O/S Entry Door','Entry door','Vinyl','2×4','Unspecified',
   'quantity','stocked',63922,63922,89900,89900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0101','fifo',63922,63922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0101','prod-max-green-0101','inventory_import',63922,89900,89900,89900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0102','MG-0102','3680FULLLITE','3680FULLLITE LHO 2x4 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad Full Lite 20x64 Glass O/S Entry Door','Entry door','Vinyl','2×4','Unspecified',
   'quantity','stocked',63922,63922,89900,89900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0102','fifo',63922,63922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0102','prod-max-green-0102','inventory_import',63922,89900,89900,89900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0103','MG-0103','3680FULLLITE','3680FULLLITE RHO 2x6 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad Full Lite 20x64 Glass O/S Entry Door','Entry door','Vinyl','2×6','Unspecified',
   'quantity','stocked',63922,63922,89900,89900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0103','fifo',63922,63922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0103','prod-max-green-0103','inventory_import',63922,89900,89900,89900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0104','MG-0104','3680FULLLITE','3680FULLLITE LHO 2x6 Kohltech Stock Door 37 ½ x 82 3/16 Vinyl Clad Full Lite 20x64 Glass O/S Entry Door','Entry door','Vinyl','2×6','Unspecified',
   'quantity','stocked',63922,63922,89900,89900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0104','fifo',63922,63922,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0104','prod-max-green-0104','inventory_import',63922,89900,89900,89900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0105','MG-0105','3280DOORFRAME','3280DOORFRAME - RHI 2x4 Door Frame Only NO Slab','Door frame','Unspecified','2×4','Unspecified',
   'quantity','stocked',24857,24857,37500,37500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0105','fifo',24857,24857,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0105','prod-max-green-0105','inventory_import',24857,37500,37500,37500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0106','MG-0106','3280DOORFRAME','3280DOORFRAME - LHI 2x4 Door Frame Only NO Slab','Door frame','Unspecified','2×4','Unspecified',
   'quantity','stocked',24857,24857,37500,37500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0106','fifo',24857,24857,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0106','prod-max-green-0106','inventory_import',24857,37500,37500,37500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0107','MG-0107','3280DOORFRAME','3280DOORFRAME - RHI 2x6 Door Frame Only NO Slab','Door frame','Unspecified','2×6','Unspecified',
   'quantity','stocked',24857,24857,37500,37500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0107','fifo',24857,24857,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0107','prod-max-green-0107','inventory_import',24857,37500,37500,37500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0108','MG-0108','3280DOORFRAME','3280DOORFRAME - LHI 2x6 Door Frame Only NO Slab','Door frame','Unspecified','2×6','Unspecified',
   'quantity','stocked',24857,24857,37500,37500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0108','fifo',24857,24857,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0108','prod-max-green-0108','inventory_import',24857,37500,37500,37500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0108','loc-max-green-inside',4,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0108-inside','opening_balance','prod-max-green-0108',4,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0108',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',24857,'CAD','max-green-opening-MG-0108-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0108-inside','prod-max-green-0108','mov-max-green-mg-0108-inside',4,4,24857,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0108-inside','prod-max-green-0108','mov-max-green-mg-0108-inside','opening_balance',4,24857,99428,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0109','MG-0109','3680DOORFRAME','3680DOORFRAME - RHI 2x4 Door Frame Only NO Slab','Door frame','Unspecified','2×4','Unspecified',
   'quantity','stocked',26100,26100,37500,37500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0109','fifo',26100,26100,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0109','prod-max-green-0109','inventory_import',26100,37500,37500,37500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0109','loc-max-green-inside',1,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0109-inside','opening_balance','prod-max-green-0109',1,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0109',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',26100,'CAD','max-green-opening-MG-0109-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0109-inside','prod-max-green-0109','mov-max-green-mg-0109-inside',1,1,26100,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0109-inside','prod-max-green-0109','mov-max-green-mg-0109-inside','opening_balance',1,26100,26100,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0110','MG-0110','3680DOORFRAME','3680DOORFRAME - LHI 2x4 Door Frame Only NO Slab','Door frame','Unspecified','2×4','Unspecified',
   'quantity','stocked',26100,26100,37500,37500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0110','fifo',26100,26100,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0110','prod-max-green-0110','inventory_import',26100,37500,37500,37500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0111','MG-0111','3680DOORFRAME','3680DOORFRAME - RHI 2x6 Door Frame Only NO Slab','Door frame','Unspecified','2×6','Unspecified',
   'quantity','stocked',26100,26100,37500,37500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0111','fifo',26100,26100,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0111','prod-max-green-0111','inventory_import',26100,37500,37500,37500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0112','MG-0112','3680DOORFRAME','3680DOORFRAME - LHI 2x6 Door Frame Only NO Slab','Door frame','Unspecified','2×6','Unspecified',
   'quantity','stocked',26100,26100,37500,37500,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   0,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0112','fifo',26100,26100,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0112','prod-max-green-0112','inventory_import',26100,37500,37500,37500,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0113','MG-0113','6080STANDARDDD','6080STANDARDDD LHO 2x4 Kohltech Stock Door 60 x 81 1/8 Vinyl Clad Full Lite DOUBLE Door 20x64 Glass O/S Door','Entry door','Vinyl','2×4','Unspecified',
   'quantity','stocked',128485,128485,179900,179900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   3.5,5,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0113','fifo',128485,128485,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0113','prod-max-green-0113','inventory_import',128485,179900,179900,179900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0113','loc-max-green-inside',3,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0113-inside','opening_balance','prod-max-green-0113',3,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0113',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',128485,'CAD','max-green-opening-MG-0113-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0113-inside','prod-max-green-0113','mov-max-green-mg-0113-inside',3,3,128485,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0113-inside','prod-max-green-0113','mov-max-green-mg-0113-inside','opening_balance',3,128485,385455,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0114','MG-0114','7280STANDARDDD','7280STANDARDDD LHO 2x4 Kohltech Stock Door 70 x 81 1/8 Vinyl Clad Full Lite DOUBLE Door 20x64 Glass O/S Door','Entry door','Vinyl','2×4','Unspecified',
   'quantity','stocked',126371,126371,179900,179900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   3.5,5,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0114','fifo',126371,126371,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0114','prod-max-green-0114','inventory_import',126371,179900,179900,179900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0114','loc-max-green-inside',3,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0114-inside','opening_balance','prod-max-green-0114',3,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0114',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',126371,'CAD','max-green-opening-MG-0114-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0114-inside','prod-max-green-0114','mov-max-green-mg-0114-inside',3,3,126371,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0114-inside','prod-max-green-0114','mov-max-green-mg-0114-inside','opening_balance',3,126371,379113,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0115','MG-0115','6080XOPD','6080XOPD OX Patio Doors - Double Sliding Door 59 1/4" X 79 1/4"','Patio door','Unspecified','See product description','Unspecified',
   'quantity','stocked',93532,93532,119900,119900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   4.199999999999999,6,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0115','fifo',93532,93532,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0115','prod-max-green-0115','inventory_import',93532,119900,119900,119900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0115','loc-max-green-inside',6,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0115-inside','opening_balance','prod-max-green-0115',6,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0115',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',93532,'CAD','max-green-opening-MG-0115-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0115-inside','prod-max-green-0115','mov-max-green-mg-0115-inside',6,6,93532,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0115-inside','prod-max-green-0115','mov-max-green-mg-0115-inside','opening_balance',6,93532,561192,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0116','MG-0116','6080XOPD','6080XOPD XO Patio Doors - Double Siding Door 59 1/4" X 79 1/4" 1505 x 2013.7','Patio door','Unspecified','1505 × 2013.7','Unspecified',
   'quantity','stocked',93532,93532,119900,119900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   4.199999999999999,6,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0116','fifo',93532,93532,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0116','prod-max-green-0116','inventory_import',93532,119900,119900,119900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0116','loc-max-green-inside',3,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0116-inside','opening_balance','prod-max-green-0116',3,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0116',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',93532,'CAD','max-green-opening-MG-0116-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0116-inside','prod-max-green-0116','mov-max-green-mg-0116-inside',3,3,93532,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0116-inside','prod-max-green-0116','mov-max-green-mg-0116-inside','opening_balance',3,93532,280596,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0117','MG-0117','6080XOPD','6080XOPD OX-B BLACK Patio Doors - Double Siding Door 59 1/4" X 79 1/4" 1505 x 2013.7','Patio door','Unspecified','1505 × 2013.7','Black',
   'quantity','stocked',105232,105232,169900,169900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   1,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0117','fifo',105232,105232,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0117','prod-max-green-0117','inventory_import',105232,169900,169900,169900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0117','loc-max-green-inside',3,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0117-inside','opening_balance','prod-max-green-0117',3,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0117',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',105232,'CAD','max-green-opening-MG-0117-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0117-inside','prod-max-green-0117','mov-max-green-mg-0117-inside',3,3,105232,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0117-inside','prod-max-green-0117','mov-max-green-mg-0117-inside','opening_balance',3,105232,315696,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0118','MG-0118','6080XOPD','6080XOPD XO-B BLACK Patio Doors - Double Siding Door 59 1/4" X 79 1/4" 1505 x 2013.7','Patio door','Unspecified','1505 × 2013.7','Black',
   'quantity','stocked',105232,105232,169900,169900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   1,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0118','fifo',105232,105232,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0118','prod-max-green-0118','inventory_import',105232,169900,169900,169900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0118','loc-max-green-inside',1,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0118-inside','opening_balance','prod-max-green-0118',1,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0118',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',105232,'CAD','max-green-opening-MG-0118-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0118-inside','prod-max-green-0118','mov-max-green-mg-0118-inside',1,1,105232,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0118-inside','prod-max-green-0118','mov-max-green-mg-0118-inside','opening_balance',1,105232,105232,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0119','MG-0119','7280XOPD','7280XOPD OX Patio Doors - Double Siding Door 71 1/4" X 79 1/4" 1810 x 2013.7','Patio door','Unspecified','1810 × 2013.7','Unspecified',
   'quantity','stocked',102459,102459,129900,129900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   4.199999999999999,6,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0119','fifo',102459,102459,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0119','prod-max-green-0119','inventory_import',102459,129900,129900,129900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0119','loc-max-green-inside',2,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0119-inside','opening_balance','prod-max-green-0119',2,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0119',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',102459,'CAD','max-green-opening-MG-0119-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0119-inside','prod-max-green-0119','mov-max-green-mg-0119-inside',2,2,102459,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0119-inside','prod-max-green-0119','mov-max-green-mg-0119-inside','opening_balance',2,102459,204918,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0120','MG-0120','7280XOPD','7280XOPD XO Patio Doors - Double Siding Door 71 1/4" X 79 1/4" 1810 x 2013.7','Patio door','Unspecified','1810 × 2013.7','Unspecified',
   'quantity','stocked',102459,102459,129900,129900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   4.199999999999999,6,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0120','fifo',102459,102459,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0120','prod-max-green-0120','inventory_import',102459,129900,129900,129900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0120','loc-max-green-inside',5,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0120-inside','opening_balance','prod-max-green-0120',5,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0120',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',102459,'CAD','max-green-opening-MG-0120-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0120-inside','prod-max-green-0120','mov-max-green-mg-0120-inside',5,5,102459,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0120-inside','prod-max-green-0120','mov-max-green-mg-0120-inside','opening_balance',5,102459,512295,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0121','MG-0121','7280XOPD','7280XOPD OX-B BLACK Patio Doors - Double Siding Door 71 1/4" X 79 1/4" 1810 x 2013.7','Patio door','Unspecified','1810 × 2013.7','Black',
   'quantity','stocked',179900,179900,179900,179900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   1,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0121','fifo',179900,179900,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0121','prod-max-green-0121','inventory_import',179900,179900,179900,179900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0121','loc-max-green-inside',2,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0121-inside','opening_balance','prod-max-green-0121',2,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0121',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',179900,'CAD','max-green-opening-MG-0121-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0121-inside','prod-max-green-0121','mov-max-green-mg-0121-inside',2,2,179900,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0121-inside','prod-max-green-0121','mov-max-green-mg-0121-inside','opening_balance',2,179900,359800,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0122','MG-0122','7280XOPD','7280XOPD XO-B BLACK Patio Doors - Double Siding Door 71 1/4" X 79 1/4" 1810 x 2013.7','Patio door','Unspecified','1810 × 2013.7','Black',
   'quantity','stocked',179900,179900,179900,179900,'manual',
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z',
   1,1,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0122','fifo',179900,179900,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0122','prod-max-green-0122','inventory_import',179900,179900,179900,179900,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
SELECT 'prod-max-green-0122','loc-max-green-inside',2,0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
SELECT 'mov-max-green-mg-0122-inside','opening_balance','prod-max-green-0122',2,NULL,'loc-max-green-inside','usable','opening_balance','MAX-GREEN-2026-08-26','prod-max-green-0122',
   '2026-08-26T23:59:59.000Z','Max Green inventory import',179900,'CAD','max-green-opening-MG-0122-inside'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
SELECT 'layer-mov-max-green-mg-0122-inside','prod-max-green-0122','mov-max-green-mg-0122-inside',2,2,179900,0,'2026-08-26T23:59:59.000Z','open'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
SELECT 'value-mov-max-green-mg-0122-inside','prod-max-green-0122','mov-max-green-mg-0122-inside','opening_balance',2,179900,359800,'fifo','opening_balance','MAX-GREEN-2026-08-26','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0123','MG-0123','3280','3280 Left Halflite Slab  - 31-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0123','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0123','prod-max-green-0123','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0124','MG-0124','3280','3280 Right Halflite Slab  - 31-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0124','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0124','prod-max-green-0124','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0125','MG-0125','3280','3280 Left Fulllite Slab  - 31-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0125','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0125','prod-max-green-0125','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0126','MG-0126','3280','3280 Right Fulllite Slab  - 31-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0126','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0126','prod-max-green-0126','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0127','MG-0127','3280','3280 Left Craftsman Slab  - 31-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0127','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0127','prod-max-green-0127','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0128','MG-0128','3280','3280 Right Craftsman Slab -  31-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0128','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0128','prod-max-green-0128','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0129','MG-0129','3280','3280 6 Panel Slab  - 31-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   8,8,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0129','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0129','prod-max-green-0129','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0130','MG-0130','3280','3280 Smooth Panel Slab  - 31-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   8,8,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0130','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0130','prod-max-green-0130','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0131','MG-0131','3680','3680 Left Halflite Slab  - 35-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0131','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0131','prod-max-green-0131','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0132','MG-0132','3680','3680 Right Halflite Slab  - 35-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0132','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0132','prod-max-green-0132','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0133','MG-0133','3680','3680 Left Fulllite Slab  - 35-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0133','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0133','prod-max-green-0133','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0134','MG-0134','3680','3680 Right Fulllite Slab  - 35-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0134','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0134','prod-max-green-0134','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0135','MG-0135','3680','3680 Left Craftsman Slab  - 35-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0135','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0135','prod-max-green-0135','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0136','MG-0136','3680','3680 Right Craftsman Slab  - 35-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0136','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0136','prod-max-green-0136','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0137','MG-0137','3680','3680 6 Panel Slab  - 35-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   8,8,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0137','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0137','prod-max-green-0137','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0138','MG-0138','3680','3680 Smooth Panel Slab  - 35-3/4"W x 79"H','Door slab','Unspecified','See product description','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   8,8,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0138','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0138','prod-max-green-0138','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0139','MG-0139','3280','3280 2x6 RHO Frame Only - 33-1/2W x 81-1/8H','Door frame','Unspecified','2×6','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0139','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0139','prod-max-green-0139','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0140','MG-0140','3280','3280 2x4 RHO Frame Only  - 33-1/2W x 81-1/8H','Door frame','Unspecified','2×4','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0140','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0140','prod-max-green-0140','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0141','MG-0141','3280','3280 2x6 LHO Frame Only  - 33-1/2W x 81-1/8H','Door frame','Unspecified','2×6','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0141','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0141','prod-max-green-0141','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0142','MG-0142','3280','3280 2x4 LHO Frame Only  - 33-1/2W x 81-1/8H','Door frame','Unspecified','2×4','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0142','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0142','prod-max-green-0142','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0143','MG-0143','3280','3280 2x4 RHI Frame Only  - 33-1/2W x 82-3/16H','Door frame','Unspecified','2×4','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   5,5,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0143','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0143','prod-max-green-0143','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0144','MG-0144','3280','3280 2x6 RHI Frame Only  - 33-1/2W x 82-3/16H','Door frame','Unspecified','2×6','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   5,5,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0144','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0144','prod-max-green-0144','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0145','MG-0145','3280','3280 2x4 LHI Frame Only  - 33-1/2W x 82-3/16H','Door frame','Unspecified','2×4','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   5,5,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0145','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0145','prod-max-green-0145','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0146','MG-0146','3280','3280 2x6 LHI Frame Only  - 33-1/2W x 82-3/16H','Door frame','Unspecified','2×6','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   5,5,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0146','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0146','prod-max-green-0146','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0147','MG-0147','3680','3680 2x6 RHO Frame Only  - 37-1/2W x 81-1/8H','Door frame','Unspecified','2×6','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0147','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0147','prod-max-green-0147','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0148','MG-0148','3680','3680 2x4 RHO Frame Only  - 37-1/2W x 81-1/8H','Door frame','Unspecified','2×4','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0148','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0148','prod-max-green-0148','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0149','MG-0149','3680','3680 2x6 LHO Frame Only  - 37-1/2W x 81-1/8H','Door frame','Unspecified','2×6','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0149','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0149','prod-max-green-0149','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0150','MG-0150','3680','3680 2x4 LHO Frame Only  - 37-1/2W x 81-1/8H','Door frame','Unspecified','2×4','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   2,2,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0150','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0150','prod-max-green-0150','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0151','MG-0151','3680','3680 2x4 RHI Frame Only  - 37-1/2W x 82-3/16H','Door frame','Unspecified','2×4','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   5,5,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0151','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0151','prod-max-green-0151','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0152','MG-0152','3680','3680 2x6 RHI Frame Only  - 37-1/2W x 82-3/16H','Door frame','Unspecified','2×6','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   5,5,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0152','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0152','prod-max-green-0152','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0153','MG-0153','3680','3680 2x6 LHI Frame Only  - 37-1/2W x 82-3/16H','Door frame','Unspecified','2×6','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   5,5,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0153','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0153','prod-max-green-0153','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
SELECT 'prod-max-green-0154','MG-0154','3680','3680 2x4 LHI Frame Only  - 37-1/2W x 82-3/16H','Door frame','Unspecified','2×4','Unspecified',
   'quantity','stocked',0,0,0,0,'manual',
   'Source workbook did not provide both cost and selling price','2026-08-26T23:59:59.000Z',
   5,5,'uom-each','uom-each','uom-each',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
SELECT 'prod-max-green-0154','fifo',0,0,1,'2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
SELECT 'price-max-green-MG-0154','prod-max-green-0154','inventory_import',0,0,0,0,'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet','2026-08-26T23:59:59.000Z','Max Green inventory import'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-001','MG-PO-988186','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-08','CAD',1,139552,139552,
   'Max Green inventory import','Source quote 988186',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0001','po-max-green-001','prod-max-green-0004',4,0,34888,'uom-each',4,34888,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-001-1','po-max-green-001',1,'approved','{"sourceQuote":"988186","sourceArrivalValues":["46273"],"lines":[{"productId":"prod-max-green-0004","quantity":4,"unitCostCents":34888}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-002','MG-PO-988188','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-08','CAD',1,161232,161232,
   'Max Green inventory import','Source quote 988188',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0002','po-max-green-002','prod-max-green-0008',8,0,20154,'uom-each',8,20154,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-002-1','po-max-green-002',1,'approved','{"sourceQuote":"988188","sourceArrivalValues":["Sep 8"],"lines":[{"productId":"prod-max-green-0008","quantity":8,"unitCostCents":20154}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-003','MG-PO-993279','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-22','CAD',1,60462,60462,
   'Max Green inventory import','Source quote 993279',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0003','po-max-green-003','prod-max-green-0008',3,0,20154,'uom-each',3,20154,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-003-1','po-max-green-003',1,'approved','{"sourceQuote":"993279","sourceArrivalValues":["Sep22"],"lines":[{"productId":"prod-max-green-0008","quantity":3,"unitCostCents":20154}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-004','MG-PO-993224','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-22','CAD',1,729307,729307,
   'Max Green inventory import','Source quote 993224',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0004','po-max-green-004','prod-max-green-0009',15,0,31709,'uom-each',15,31709,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0005','po-max-green-004','prod-max-green-0010',8,0,31709,'uom-each',8,31709,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-004-1','po-max-green-004',1,'approved','{"sourceQuote":"993224","sourceArrivalValues":["46287","Sep 22"],"lines":[{"productId":"prod-max-green-0009","quantity":15,"unitCostCents":31709},{"productId":"prod-max-green-0010","quantity":8,"unitCostCents":31709}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-005','MG-PO-984634','vendor-max-green-vinyl-vista','approved','not_billed','2026-08-27','CAD',1,253672,253672,
   'Max Green inventory import','Source quote 984634',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0006','po-max-green-005','prod-max-green-0010',8,0,31709,'uom-each',8,31709,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-005-1','po-max-green-005',1,'approved','{"sourceQuote":"984634","sourceArrivalValues":["Aug 27"],"lines":[{"productId":"prod-max-green-0010","quantity":8,"unitCostCents":31709}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-006','MG-PO-988191','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-08','CAD',1,116260,116260,
   'Max Green inventory import','Source quote 988191',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0007','po-max-green-006','prod-max-green-0013',5,0,23252,'uom-each',5,23252,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-006-1','po-max-green-006',1,'approved','{"sourceQuote":"988191","sourceArrivalValues":["46273"],"lines":[{"productId":"prod-max-green-0013","quantity":5,"unitCostCents":23252}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-007','MG-PO-983013','vendor-max-green-vinyl-vista','approved','not_billed','2026-08-24','CAD',1,301170,301170,
   'Max Green inventory import','Source quote 983013',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0008','po-max-green-007','prod-max-green-0015',10,0,30117,'uom-each',10,30117,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-007-1','po-max-green-007',1,'approved','{"sourceQuote":"983013","sourceArrivalValues":["46258"],"lines":[{"productId":"prod-max-green-0015","quantity":10,"unitCostCents":30117}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-008','MG-PO-988153','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-08','CAD',1,263312,263312,
   'Max Green inventory import','Source quote 988153',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0009','po-max-green-008','prod-max-green-0017',8,0,32914,'uom-each',8,32914,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-008-1','po-max-green-008',1,'approved','{"sourceQuote":"988153","sourceArrivalValues":["46273"],"lines":[{"productId":"prod-max-green-0017","quantity":8,"unitCostCents":32914}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-009','MG-PO-993290','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-22','CAD',1,40156,40156,
   'Max Green inventory import','Source quote 993290',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0010','po-max-green-009','prod-max-green-0019',2,0,20078,'uom-each',2,20078,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-009-1','po-max-green-009',1,'approved','{"sourceQuote":"993290","sourceArrivalValues":["46287"],"lines":[{"productId":"prod-max-green-0019","quantity":2,"unitCostCents":20078}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-010','MG-PO-984637','vendor-max-green-vinyl-vista','approved','not_billed','2026-08-27','CAD',1,66832,66832,
   'Max Green inventory import','Source quote 984637',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0011','po-max-green-010','prod-max-green-0022',2,0,33416,'uom-each',2,33416,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-010-1','po-max-green-010',1,'approved','{"sourceQuote":"984637","sourceArrivalValues":["46261"],"lines":[{"productId":"prod-max-green-0022","quantity":2,"unitCostCents":33416}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-011','MG-PO-984635','vendor-max-green-vinyl-vista','approved','not_billed','2026-08-27','CAD',1,133664,133664,
   'Max Green inventory import','Source quote 984635',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0012','po-max-green-011','prod-max-green-0023',4,0,33416,'uom-each',4,33416,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-011-1','po-max-green-011',1,'approved','{"sourceQuote":"984635","sourceArrivalValues":["Aug 27-"],"lines":[{"productId":"prod-max-green-0023","quantity":4,"unitCostCents":33416}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-012','MG-PO-986594','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-03','CAD',1,191912,191912,
   'Max Green inventory import','Source quote 986594',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0013','po-max-green-012','prod-max-green-0024',8,0,23989,'uom-each',8,23989,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-012-1','po-max-green-012',1,'approved','{"sourceQuote":"986594","sourceArrivalValues":["Sep 3"],"lines":[{"productId":"prod-max-green-0024","quantity":8,"unitCostCents":23989}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-013','MG-PO-993293','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-22','CAD',1,47978,47978,
   'Max Green inventory import','Source quote 993293',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0014','po-max-green-013','prod-max-green-0024',2,0,23989,'uom-each',2,23989,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-013-1','po-max-green-013',1,'approved','{"sourceQuote":"993293","sourceArrivalValues":["Sep 22"],"lines":[{"productId":"prod-max-green-0024","quantity":2,"unitCostCents":23989}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-014','MG-PO-988192','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-08','CAD',1,154248,154248,
   'Max Green inventory import','Source quote 988192',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0015','po-max-green-014','prod-max-green-0025',6,0,25708,'uom-each',6,25708,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-014-1','po-max-green-014',1,'approved','{"sourceQuote":"988192","sourceArrivalValues":["Sep8"],"lines":[{"productId":"prod-max-green-0025","quantity":6,"unitCostCents":25708}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-015','MG-PO-993299','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-22','CAD',1,257080,257080,
   'Max Green inventory import','Source quote 993299',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0016','po-max-green-015','prod-max-green-0025',10,0,25708,'uom-each',10,25708,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-015-1','po-max-green-015',1,'approved','{"sourceQuote":"993299","sourceArrivalValues":["Sep22"],"lines":[{"productId":"prod-max-green-0025","quantity":10,"unitCostCents":25708}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-016','MG-PO-993873','vendor-max-green-vinyl-vista','approved','not_billed',NULL,'CAD',1,385620,385620,
   'Max Green inventory import','Source quote 993873',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0017','po-max-green-016','prod-max-green-0025',15,0,25708,'uom-each',15,25708,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-016-1','po-max-green-016',1,'approved','{"sourceQuote":"993873","sourceArrivalValues":[],"lines":[{"productId":"prod-max-green-0025","quantity":15,"unitCostCents":25708}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-017','MG-PO-984665','vendor-max-green-vinyl-vista','approved','not_billed','2026-08-27','CAD',1,257470,257470,
   'Max Green inventory import','Source quote 984665',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0018','po-max-green-017','prod-max-green-0026',10,0,25747,'uom-each',10,25747,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-017-1','po-max-green-017',1,'approved','{"sourceQuote":"984665","sourceArrivalValues":["27Aug"],"lines":[{"productId":"prod-max-green-0026","quantity":10,"unitCostCents":25747}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-018','MG-PO-984674','vendor-max-green-vinyl-vista','approved','not_billed','2026-08-27','CAD',1,514940,514940,
   'Max Green inventory import','Source quote 984674',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0019','po-max-green-018','prod-max-green-0026',20,0,25747,'uom-each',20,25747,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-018-1','po-max-green-018',1,'approved','{"sourceQuote":"984674","sourceArrivalValues":["27Aug"],"lines":[{"productId":"prod-max-green-0026","quantity":20,"unitCostCents":25747}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-019','MG-PO-993870','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-22','CAD',1,514940,514940,
   'Max Green inventory import','Source quote 993870',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0020','po-max-green-019','prod-max-green-0026',20,0,25747,'uom-each',20,25747,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-019-1','po-max-green-019',1,'approved','{"sourceQuote":"993870","sourceArrivalValues":["Sep22"],"lines":[{"productId":"prod-max-green-0026","quantity":20,"unitCostCents":25747}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-020','MG-PO-986557','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-03','CAD',1,732240,732240,
   'Max Green inventory import','Source quote 986557',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0021','po-max-green-020','prod-max-green-0029',30,0,24408,'uom-each',30,24408,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-020-1','po-max-green-020',1,'approved','{"sourceQuote":"986557","sourceArrivalValues":["46268"],"lines":[{"productId":"prod-max-green-0029","quantity":30,"unitCostCents":24408}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-021','MG-PO-UNREFERENCED-32-1','vendor-max-green-vinyl-vista','approved','not_billed',NULL,'CAD',1,336840,336840,
   'Max Green inventory import','Source quote UNREFERENCED-32-1',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0022','po-max-green-021','prod-max-green-0031',10,0,33684,'uom-each',10,33684,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-021-1','po-max-green-021',1,'approved','{"sourceQuote":"UNREFERENCED-32-1","sourceArrivalValues":[],"lines":[{"productId":"prod-max-green-0031","quantity":10,"unitCostCents":33684}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-022','MG-PO-986591','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-03','CAD',1,585864,585864,
   'Max Green inventory import','Source quote 986591',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0023','po-max-green-022','prod-max-green-0032',18,0,32548,'uom-each',18,32548,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-022-1','po-max-green-022',1,'approved','{"sourceQuote":"986591","sourceArrivalValues":["46268"],"lines":[{"productId":"prod-max-green-0032","quantity":18,"unitCostCents":32548}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-023','MG-PO-988162','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-08','CAD',1,541480,541480,
   'Max Green inventory import','Source quote 988162',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0024','po-max-green-023','prod-max-green-0033',20,0,27074,'uom-each',20,27074,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-023-1','po-max-green-023',1,'approved','{"sourceQuote":"988162","sourceArrivalValues":["46273"],"lines":[{"productId":"prod-max-green-0033","quantity":20,"unitCostCents":27074}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-024','MG-PO-988165','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-08','CAD',1,194290,194290,
   'Max Green inventory import','Source quote 988165',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0025','po-max-green-024','prod-max-green-0034',10,0,19429,'uom-each',10,19429,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-024-1','po-max-green-024',1,'approved','{"sourceQuote":"988165","sourceArrivalValues":["Sep8"],"lines":[{"productId":"prod-max-green-0034","quantity":10,"unitCostCents":19429}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-025','MG-PO-993305','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-22','CAD',1,77716,77716,
   'Max Green inventory import','Source quote 993305',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0026','po-max-green-025','prod-max-green-0034',4,0,19429,'uom-each',4,19429,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-025-1','po-max-green-025',1,'approved','{"sourceQuote":"993305","sourceArrivalValues":["Sep22"],"lines":[{"productId":"prod-max-green-0034","quantity":4,"unitCostCents":19429}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-026','MG-PO-988196','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-08','CAD',1,322660,322660,
   'Max Green inventory import','Source quote 988196',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0027','po-max-green-026','prod-max-green-0035',10,0,32266,'uom-each',10,32266,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-026-1','po-max-green-026',1,'approved','{"sourceQuote":"988196","sourceArrivalValues":["46273"],"lines":[{"productId":"prod-max-green-0035","quantity":10,"unitCostCents":32266}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-027','MG-PO-983165','vendor-max-green-vinyl-vista','approved','not_billed','2026-08-24','CAD',1,313008,313008,
   'Max Green inventory import','Source quote 983165',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0028','po-max-green-027','prod-max-green-0037',8,0,39126,'uom-each',8,39126,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-027-1','po-max-green-027',1,'approved','{"sourceQuote":"983165","sourceArrivalValues":["Aug24"],"lines":[{"productId":"prod-max-green-0037","quantity":8,"unitCostCents":39126}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-028','MG-PO-993333','vendor-max-green-vinyl-vista','approved','not_billed','2026-08-22','CAD',1,313008,313008,
   'Max Green inventory import','Source quote 993333',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0029','po-max-green-028','prod-max-green-0037',8,0,39126,'uom-each',8,39126,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-028-1','po-max-green-028',1,'approved','{"sourceQuote":"993333","sourceArrivalValues":["Aug22"],"lines":[{"productId":"prod-max-green-0037","quantity":8,"unitCostCents":39126}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-029','MG-PO-986574','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-03','CAD',1,245470,245470,
   'Max Green inventory import','Source quote 986574',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0030','po-max-green-029','prod-max-green-0038',10,0,24547,'uom-each',10,24547,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-029-1','po-max-green-029',1,'approved','{"sourceQuote":"986574","sourceArrivalValues":["03-Sep"],"lines":[{"productId":"prod-max-green-0038","quantity":10,"unitCostCents":24547}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-030','MG-PO-988809','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-09','CAD',1,736410,736410,
   'Max Green inventory import','Source quote 988809',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0031','po-max-green-030','prod-max-green-0038',30,0,24547,'uom-each',30,24547,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-030-1','po-max-green-030',1,'approved','{"sourceQuote":"988809","sourceArrivalValues":["09-Sep"],"lines":[{"productId":"prod-max-green-0038","quantity":30,"unitCostCents":24547}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-031','MG-PO-984623','vendor-max-green-vinyl-vista','approved','not_billed','2026-08-27','CAD',1,191472,191472,
   'Max Green inventory import','Source quote 984623',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0032','po-max-green-031','prod-max-green-0039',6,0,31912,'uom-each',6,31912,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-031-1','po-max-green-031',1,'approved','{"sourceQuote":"984623","sourceArrivalValues":["Aug 27-"],"lines":[{"productId":"prod-max-green-0039","quantity":6,"unitCostCents":31912}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-032','MG-PO-988198','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-08','CAD',1,276640,276640,
   'Max Green inventory import','Source quote 988198',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0033','po-max-green-032','prod-max-green-0041',10,0,27664,'uom-each',10,27664,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-032-1','po-max-green-032',1,'approved','{"sourceQuote":"988198","sourceArrivalValues":["Sep8"],"lines":[{"productId":"prod-max-green-0041","quantity":10,"unitCostCents":27664}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-033','MG-PO-988175','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-10','CAD',1,378268,378268,
   'Max Green inventory import','Source quote 988175',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0034','po-max-green-033','prod-max-green-0041',10,0,27664,'uom-each',10,27664,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0035','po-max-green-033','prod-max-green-0043',3,0,33876,'uom-each',3,33876,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-033-1','po-max-green-033',1,'approved','{"sourceQuote":"988175","sourceArrivalValues":["SEP10","08-Sep"],"lines":[{"productId":"prod-max-green-0041","quantity":10,"unitCostCents":27664},{"productId":"prod-max-green-0043","quantity":3,"unitCostCents":33876}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-034','MG-PO-989412','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-24','CAD',1,829920,829920,
   'Max Green inventory import','Source quote 989412',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0036','po-max-green-034','prod-max-green-0041',30,0,27664,'uom-each',30,27664,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-034-1','po-max-green-034',1,'approved','{"sourceQuote":"989412","sourceArrivalValues":["Sep24"],"lines":[{"productId":"prod-max-green-0041","quantity":30,"unitCostCents":27664}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-035','MG-PO-988169','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-08','CAD',1,1514450,1514450,
   'Max Green inventory import','Source quote 988169',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0037','po-max-green-035','prod-max-green-0042',50,0,30289,'uom-each',50,30289,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-035-1','po-max-green-035',1,'approved','{"sourceQuote":"988169","sourceArrivalValues":["46273"],"lines":[{"productId":"prod-max-green-0042","quantity":50,"unitCostCents":30289}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-036','MG-PO-986567','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-03','CAD',1,271008,271008,
   'Max Green inventory import','Source quote 986567',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0038','po-max-green-036','prod-max-green-0043',8,0,33876,'uom-each',8,33876,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-036-1','po-max-green-036',1,'approved','{"sourceQuote":"986567","sourceArrivalValues":["03-Sep"],"lines":[{"productId":"prod-max-green-0043","quantity":8,"unitCostCents":33876}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-037','MG-PO-984641','vendor-max-green-vinyl-vista','approved','not_billed','2026-08-27','CAD',1,152188,152188,
   'Max Green inventory import','Source quote 984641',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0039','po-max-green-037','prod-max-green-0044',4,0,38047,'uom-each',4,38047,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-037-1','po-max-green-037',1,'approved','{"sourceQuote":"984641","sourceArrivalValues":["Aug 27"],"lines":[{"productId":"prod-max-green-0044","quantity":4,"unitCostCents":38047}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-038','MG-PO-993322','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-22','CAD',1,380470,380470,
   'Max Green inventory import','Source quote 993322',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0040','po-max-green-038','prod-max-green-0044',10,0,38047,'uom-each',10,38047,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-038-1','po-max-green-038',1,'approved','{"sourceQuote":"993322","sourceArrivalValues":["Sep22"],"lines":[{"productId":"prod-max-green-0044","quantity":10,"unitCostCents":38047}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-039','MG-PO-982380','vendor-max-green-vinyl-vista','approved','not_billed','2026-08-17','CAD',1,339264,339264,
   'Max Green inventory import','Source quote 982380',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0041','po-max-green-039','prod-max-green-0045',8,0,42408,'uom-each',8,42408,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-039-1','po-max-green-039',1,'approved','{"sourceQuote":"982380","sourceArrivalValues":["46251"],"lines":[{"productId":"prod-max-green-0045","quantity":8,"unitCostCents":42408}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-040','MG-PO-988202','vendor-max-green-vinyl-vista','approved','not_billed','2026-09-08','CAD',1,206310,206310,
   'Max Green inventory import','Source quote 988202',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0042','po-max-green-040','prod-max-green-0046',6,0,34385,'uom-each',6,34385,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-040-1','po-max-green-040',1,'approved','{"sourceQuote":"988202","sourceArrivalValues":["46273"],"lines":[{"productId":"prod-max-green-0046","quantity":6,"unitCostCents":34385}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-041','MG-PO-984639','vendor-max-green-vinyl-vista','approved','not_billed','2026-08-27','CAD',1,179760,179760,
   'Max Green inventory import','Source quote 984639',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0043','po-max-green-041','prod-max-green-0048',4,0,44940,'uom-each',4,44940,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-041-1','po-max-green-041',1,'approved','{"sourceQuote":"984639","sourceArrivalValues":["46261"],"lines":[{"productId":"prod-max-green-0048","quantity":4,"unitCostCents":44940}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-042','MG-PO-2456861','vendor-max-green-kohltech','approved','not_billed',NULL,'CAD',1,383341,383341,
   'Max Green inventory import','Source quote 2456861',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0044','po-max-green-042','prod-max-green-0113',2,0,128485,'uom-each',2,128485,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0045','po-max-green-042','prod-max-green-0114',1,0,126371,'uom-each',1,126371,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-042-1','po-max-green-042',1,'approved','{"sourceQuote":"2456861","sourceArrivalValues":["TBD"],"lines":[{"productId":"prod-max-green-0113","quantity":2,"unitCostCents":128485},{"productId":"prod-max-green-0114","quantity":1,"unitCostCents":126371}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-043','MG-PO-990336','vendor-max-green-kohltech','approved','not_billed','2026-09-14','CAD',1,187064,187064,
   'Max Green inventory import','Source quote 990336',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0046','po-max-green-043','prod-max-green-0116',2,0,93532,'uom-each',2,93532,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-043-1','po-max-green-043',1,'approved','{"sourceQuote":"990336","sourceArrivalValues":["46279"],"lines":[{"productId":"prod-max-green-0116","quantity":2,"unitCostCents":93532}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-044','MG-PO-UNREFERENCED-120-1','vendor-max-green-kohltech','approved','not_billed','2026-08-27','CAD',1,409836,409836,
   'Max Green inventory import','Source quote UNREFERENCED-120-1',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0047','po-max-green-044','prod-max-green-0119',4,0,102459,'uom-each',4,102459,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-044-1','po-max-green-044',1,'approved','{"sourceQuote":"UNREFERENCED-120-1","sourceArrivalValues":["Aug27"],"lines":[{"productId":"prod-max-green-0119","quantity":4,"unitCostCents":102459}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
SELECT 'po-max-green-045','MG-PO-UNREFERENCED-120-2','vendor-max-green-kohltech','approved','not_billed','2026-09-22','CAD',1,409836,409836,
   'Max Green inventory import','Source quote UNREFERENCED-120-2',1,1,'2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
SELECT 'pol-max-green-0048','po-max-green-045','prod-max-green-0119',4,0,102459,'uom-each',4,102459,'stock',0,0,'EXEMPT',0,1
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
SELECT 'revision-po-max-green-045-1','po-max-green-045',1,'approved','{"sourceQuote":"UNREFERENCED-120-2","sourceArrivalValues":["Sep22"],"lines":[{"productId":"prod-max-green-0119","quantity":4,"unitCostCents":102459}]}',
   'Imported open order from Max Green inventory count sheet','Max Green inventory import','2026-08-26T23:59:59.000Z'
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO margin_rules
  (id,code,name,product_id,category,minimum_cost_cents,maximum_cost_cents,target_margin_bps,minimum_gross_profit_cents,rounding_increment_cents,priority,valid_from,valid_to,active,version,created_at,updated_at)
SELECT 'margin-default-32','DEFAULT-32','Default 32% gross margin',NULL,NULL,0,NULL,3200,0,100,0,NULL,NULL,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
INSERT INTO system_settings (key,value_json,description,version,updated_by,updated_at)
SELECT 'company.profile','{"name":"Max Green","industry":"Window distributor","currency":"CAD","inventoryAsOf":"2026-08-26"}',
  'Company identity and inventory cutover metadata.',1,'Max Green inventory import',CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard')
ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,description=excluded.description,version=system_settings.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at;--> statement-breakpoint
INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,metadata_json,created_at)
SELECT 'audit-max-green-import','company','max-green','company_inventory_imported',
  'Max Green imported with 154 products, 618 on-hand units across Inside and Outside, and 488 units on open purchase orders.',
  'Max Green inventory import','{"source":{"fileName":"Inventory COUNTING SHEET August 26-2026 (Complete by Yury Li).xlsx","sheetName":"Count Sheet","quantityPolicy":"Inside and Outside are warehouse locations. Opening on-hand equals their sum; the workbook Total column is retained for reconciliation only.","missingPriceCostPolicy":"Missing selling prices and costs are imported as zero so the product remains in the catalog without inventing a value."},"summary":{"productCount":154,"insideUnits":556,"outsideUnits":62,"openingOnHandUnits":618,"missingPriceAndCostProducts":32,"pendingOrderUnits":488,"pendingOrderProductCount":33,"purchaseOrderCount":45},"discrepancies":[{"sourceRow":6,"sku":"MG-0005","name":"2448C Vinyl Vista RIGHT Casement 23 3/4 x 47 1/4 White Vinyl 600 x 1200","sourceTotalQty":5,"locationTotalQty":6,"resolution":"Imported the Inside and Outside location counts as the physical source of truth."},{"sourceRow":44,"sku":"MG-0043","name":"6040XO Vinyl Vista Slider Windows 1500 X 1000 59 1/16\" X 39 3/8\"","sourceTotalQty":2,"locationTotalQty":0,"resolution":"Imported the Inside and Outside location counts as the physical source of truth."}]}',CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM system_settings WHERE key='__migration.max_green_import_guard');--> statement-breakpoint
CREATE TRIGGER stock_movements_immutable_update
BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock movement ledger is immutable'); END;--> statement-breakpoint
CREATE TRIGGER stock_movements_immutable_delete
BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock movement ledger is immutable'); END;--> statement-breakpoint
DELETE FROM system_settings WHERE key='__migration.max_green_import_guard';--> statement-breakpoint
PRAGMA optimize;
