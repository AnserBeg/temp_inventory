import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("advanced distributor commands remain wired through the durable dispatcher", async () => {
  const source = await read("lib/server/advanced-domain.ts");
  const commands = [
    "updatesalesorderdraft", "confirmsalesorder", "cancelsalesorder", "submitpurchaseorder", "approvepurchaseorder", "cancelpurchaseorder",
    "amendpurchaseorder", "transferinventory", "receivetransfer", "changeinventorystatus",
    "scrapinventory", "releasereservation", "reallocatereservation", "reverseshipment",
    "createvendorbill", "approvevendorbill", "createvendorcredit", "createcustomerinvoice",
    "createcustomercredit", "recordpayment", "issuereturnable", "returnreturnable",
    "forfeitreturnable", "refundreturnabledeposit", "setvaluationpolicy", "allocatelandedcost",
    "updateuserrole", "createbusinesspartner", "createproduct", "createwarehouse",
    "createlocation", "createreturnableassettype",
    "postdropshipdelivery", "reversedropshipdelivery", "registerinventoryidentity", "voidcustomerinvoice",
  ];
  for (const command of commands) assert.match(source, new RegExp(`case\\s+"${command}"`), command);
  assert.match(source, /outbox_events/);
  assert.match(source, /audit_events/);
  assert.match(source, /requestHash/);
});

test("application routes enforce identity and capability checks", async () => {
  const [snapshot, workflow, commands, records, attachments, exports] = await Promise.all([
    read("app/api/snapshot/route.ts"), read("app/api/workflows/route.ts"),
    read("app/api/commands/route.ts"),
    read("app/api/records/route.ts"), read("app/api/attachments/route.ts"),
    read("app/api/export/route.ts"),
  ]);
  for (const route of [snapshot, workflow, commands, records, attachments, exports]) {
    assert.match(route, /resolveActor/);
    assert.match(route, /requireCapability/);
  }
  assert.match(workflow, /workflowCapability/);
  assert.match(workflow, /UNKNOWN_COMMAND/);
  const advanced = await read("lib/server/advanced-domain.ts");
  assert.match(advanced, /updateUserRole:\s*"administer"/);
  assert.match(advanced, /refundReturnableDeposit:\s*"financialWrite"/);
  assert.match(commands, /postimmediatesale/);
  assert.match(commands, /requireCapability\(actor,\s*"operationalWrite"\)/);
  assert.match(commands, /requireCapability\(actor,\s*"financialWrite"\)/);
  assert.match(workflow, /scope:\s*url\.searchParams\.get\("scope"\)/);
  assert.match(advanced, /workflowCoreScope/);
});

test("QuickBooks boundaries require administrators, one-use OAuth state, encrypted tokens, and signed webhooks", async () => {
  const [route, connect, client, cryptoSource, webhook, worker, migration] = await Promise.all([
    read("app/api/integrations/qbo/route.ts"), read("app/api/integrations/qbo/connect/route.ts"),
    read("lib/server/qbo-client.ts"), read("lib/server/qbo-crypto.ts"), read("lib/server/qbo-webhook.ts"),
    read("worker/index.ts"), read("drizzle/0015_huge_golden_guardian.sql"),
  ]);
  for (const adminRoute of [route, connect]) {
    assert.match(adminRoute, /resolveActor/);
    assert.match(adminRoute, /requireCapability\(actor,\s*"administer"\)/);
  }
  assert.match(client, /consumed_at IS NULL AND expires_at>\?/);
  assert.match(client, /encryptQboSecret/);
  assert.match(client, /token_lock_owner/);
  assert.match(cryptoSource, /AES-GCM/);
  assert.match(webhook, /intuit-signature/);
  assert.match(webhook, /constantTimeEqual/);
  assert.match(worker, /processQboWebhookBatch/);
  assert.match(worker, /processQboSyncBatch/);
  for (const table of ["qbo_connections", "qbo_entity_links", "qbo_sync_deliveries", "qbo_webhook_events", "qbo_reconciliation_runs"]) {
    assert.match(migration, new RegExp(table), table);
  }
});

test("Helcim company connection requires administrators and stores only an encrypted API token", async () => {
  const [route, payments, migration] = await Promise.all([
    read("app/api/integrations/helcim/route.ts"), read("lib/server/helcim-payments.ts"), read("drizzle/0029_fantastic_carlie_cooper.sql"),
  ]);
  assert.match(route, /resolveActor/);
  assert.match(route, /requireCapability\(actor,\s*"administer"\)/);
  assert.match(route, /connectHelcimCompany/);
  assert.match(payments, /encryptHelcimSecret\(apiToken/);
  assert.match(payments, /\/connection-test/);
  assert.match(payments, /\/invoices\?limit=1&page=1/);
  assert.doesNotMatch(migration, /\n\s*`api_token`/u);
  assert.match(migration, /encrypted_api_token/);
});

test("runtime storage preserves inventory, upload, and onboarding invariants", async () => {
  const [database, migration, auth, attachments] = await Promise.all([
    read("lib/server/inventory-db.ts"), read("drizzle/0006_runtime-integrity.sql"), read("lib/server/auth.ts"), read("lib/server/attachments.ts"),
  ]);
  assert.match(migration, /inventory_balances_nonnegative_insert/);
  assert.match(migration, /NEW\.`reserved_qty`\s*>\s*NEW\.`on_hand_qty`/);
  assert.doesNotMatch(database, /CREATE TABLE IF NOT EXISTS/);
  assert.match(database, /SELECT source_sales_order_line_id FROM purchase_order_lines LIMIT 0/);
  assert.match(auth, /first_administrator_bootstrapped/);
  assert.match(auth, /security\.defaultRole/);
  assert.match(auth, /["']viewer["']/);
  assert.match(attachments, /MAX_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024/);
  assert.match(attachments, /CONTENT_MISMATCH/);
  assert.match(attachments, /attachment\.delete_requested/);
  assert.match(attachments, /product:\s*["']products["']/);
  assert.match(attachments, /product_photo/);
});

test("stock item detail supports durable product picture galleries", async () => {
  const source = await read("app/inventory-app.tsx");
  assert.match(source, /function ProductPictures/);
  assert.match(source, /documentType",\s*"product"/);
  assert.match(source, /category",\s*"product_photo"/);
  assert.match(source, /multiple/);
  assert.match(source, /image\/jpeg,image\/png,image\/webp/);
});

test("multi-line order contract retains currency, tax, routes, fees, and refundable deposits", async () => {
  const source = await read("lib/server/inventory-records.ts");
  for (const field of [
    "exchangeRateToBase", "paymentTerms", "taxRateBps", "fulfillmentRoute",
    "freightCents", "feeCents", "refundableDepositCents", "discountCents",
  ]) assert.match(source, new RegExp(field), field);
  assert.match(source, /INSERT INTO purchase_orders/);
  assert.match(source, /fastTrack \? "approved" : "draft"/);
  assert.match(source, /fastTrackApprovalReason/);
  assert.match(source, /outbox_events/);
});

test("operations UI uses live adapters, exact payload builders, permissions, and attachments", async () => {
  const source = await read("app/components/operations-suite.tsx");
  assert.match(source, /normalizeLiveWorkflowState/);
  assert.match(source, /buildWorkflowPayload/);
  assert.match(source, /permissions\.actions|capabilities\.actions/);
  assert.match(source, /type="file"/);
  assert.match(source, /\/api\/attachments/);
  assert.match(source, /LookupField kind=\{lookupKind\} label="Document"/);
  assert.match(source, /LocalPager label="Audit timeline pages"/);
  assert.match(source, /LocalPager label="Operational record pages"/);
  assert.doesNotMatch(source, /Â|â|Ã/);
});

test("reports keep complete long results navigable", async () => {
  const source = await read("app/inventory-app.tsx");
  assert.match(source, /reports:\s*"products"/);
  assert.match(source, /aria-label=\{view === "reports" \? "Projected availability pages" : "Record pages"\}/);
  assert.match(source, /LocalTablePager label="Report result pages"/);
});

test("schema covers the operational subledgers and audit trail", async () => {
  const source = await read("db/schema.ts");
  for (const table of [
    "document_charges", "vendor_bill_lines", "customer_invoices", "customer_credits",
    "returnable_obligations", "returnable_events", "valuation_policies", "cost_layers",
    "inventory_value_entries", "landed_cost_allocations", "period_locks", "outbox_events",
    "attachments", "warehouses", "inventory_transfers", "uom_conversions",
    "drop_ship_deliveries", "movement_assignments", "inventory_units", "inventory_lots",
  ]) assert.match(source, new RegExp(`"${table}"`), table);
});

test("tracked physical postings and drop-ship fulfillment preserve their separate ledgers", async () => {
  const [advanced, core, migration] = await Promise.all([
    read("lib/server/advanced-domain.ts"), read("lib/server/inventory-domain.ts"), read("drizzle/0004_useful_nomad.sql"),
  ]);
  assert.match(advanced, /LOT_QUANTITY_SHORTAGE/);
  assert.match(advanced, /SERIAL_QUANTITY_INVALID/);
  assert.match(advanced, /UPDATE inventory_units SET location_id=/);
  assert.match(advanced, /drop_ship\.delivery_posted/);
  assert.match(advanced, /drop_ship\.delivery_reversed/);
  assert.match(advanced, /customer_invoice\.voided/);
  assert.match(advanced, /LANDED_COST_LAYER_UNRELATED/);
  assert.match(advanced, /purchase_order_revisions SET lifecycle_status/);
  assert.match(advanced, /base_total_cents=\?/);
  assert.match(advanced, /CASE WHEN sol\.fulfillment_route='drop_ship'/);
  assert.match(core, /incomingTracking/);
  assert.match(core, /outgoingTracking/);
  assert.match(core, /returnTracking/);
  assert.match(core, /receipt_reversed/);
  assert.match(core, /returned_to_vendor/);
  assert.match(core, /INSERT INTO movement_assignments/);
  assert.match(migration, /idx_purchase_order_lines_source_sales_line/);
});

test("local development applies the production migration chain before serving", async () => {
  const [packageSource, wranglerSource, migrationScript, startScript, devVars] = await Promise.all([
    read("package.json"),
    read("wrangler.local.jsonc"),
    read("scripts/apply-local-migrations.mjs"),
    read("scripts/start-local.mjs"),
    read(".dev.vars.example"),
  ]);
  const packageJson = JSON.parse(packageSource);
  const wrangler = JSON.parse(wranglerSource);
  assert.equal(packageJson.scripts.predev, "node scripts/apply-local-migrations.mjs");
  assert.equal(packageJson.scripts.start, "node scripts/start-local.mjs");
  assert.match(startScript, /"dev"/);
  assert.match(startScript, /\.wrangler["',\s]+["']state/);
  assert.match(startScript, /"--persist-to"/);
  assert.equal(wrangler.d1_databases[0].binding, "DB");
  assert.equal(wrangler.d1_databases[0].database_name, "site-creator-d1");
  assert.equal(wrangler.d1_databases[0].migrations_dir, "drizzle");
  assert.match(migrationScript, /d1[\s\S]*migrations[\s\S]*apply[\s\S]*--local/);
  assert.match(migrationScript, /--persist-to[\s\S]*\.wrangler\/state/);
  assert.match(migrationScript, /WRANGLER_WRITE_LOGS:\s*"false"/);
  assert.match(devVars, /ALLOW_LOCAL_DEV_AUTH=false/);
  assert.match(devVars, /BOOTSTRAP_DEMO_DATA=false/);
});
