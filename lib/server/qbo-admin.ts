import type { ActorIdentity } from "./auth";
import { ensureDatabase, getD1 } from "./inventory-db";
import { listQboConnections, qboConfigurationStatus, qboQuery } from "./qbo-client";
import { listQboDeliveries, qboSyncSummary } from "./qbo-sync";

type Row = Record<string, unknown>;

function canonicalTaxCode(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized === "ZERO" ? "ZERO" : normalized === "EXEMPT" ? "EXEMPT" : normalized;
}

export const qboAccountRoles = [
  { key: "accounts_receivable", label: "Accounts receivable", types: ["Accounts Receivable"] },
  { key: "accounts_payable", label: "Accounts payable", types: ["Accounts Payable"] },
  { key: "cash", label: "Cash / operating bank", types: ["Bank"] },
  { key: "credit_card", label: "Vendor payment credit card", types: ["Credit Card"] },
  { key: "inventory", label: "Inventory asset", types: ["Other Current Asset"] },
  { key: "inventory_clearing", label: "Inventory clearing", types: ["Other Current Asset", "Other Current Liability", "Expense"] },
  { key: "cost_of_goods_sold", label: "Cost of goods sold", types: ["Cost of Goods Sold"] },
  { key: "sales_revenue", label: "Sales revenue", types: ["Income"] },
  { key: "distribution_fees_revenue", label: "Distribution fees revenue", types: ["Income"] },
  { key: "sales_returns", label: "Sales returns / credits", types: ["Income"] },
  { key: "purchase_returns", label: "Purchase returns / credits", types: ["Expense", "Cost of Goods Sold"] },
  { key: "vendor_return_clearing", label: "Vendor return clearing", types: ["Other Current Asset", "Other Current Liability", "Expense"] },
  { key: "landed_cost_accrual", label: "Landed cost accrual", types: ["Other Current Liability", "Other Current Asset"] },
  { key: "inventory_scrap_expense", label: "Inventory scrap expense", types: ["Expense", "Cost of Goods Sold"] },
  { key: "inventory_adjustment_expense", label: "Inventory adjustment expense", types: ["Expense", "Cost of Goods Sold"] },
  { key: "inventory_adjustment_gain", label: "Inventory adjustment gain", types: ["Other Income", "Income"] },
  { key: "opening_balance_equity", label: "Opening balance equity", types: ["Equity"] },
  { key: "refundable_deposits_payable", label: "Refundable returnable deposits payable", types: ["Other Current Liability"] },
  { key: "refundable_deposits_receivable", label: "Refundable returnable deposits receivable", types: ["Other Current Asset"] },
  { key: "forfeited_deposit_revenue", label: "Forfeited returnable deposit revenue", types: ["Income", "Other Income"] },
  { key: "forfeited_deposit_expense", label: "Forfeited returnable deposit expense", types: ["Expense", "Other Expense"] },
] as const;

function queryItems(payload: Row, name: string) {
  const value = (payload.QueryResponse as Row | undefined)?.[name];
  return Array.isArray(value) ? value as Row[] : [];
}

export async function fetchQboReferenceOptions(connectionId: string) {
  // Keep these sequential so an expired access token is refreshed once rather than
  // making four isolates contend for the refresh lock.
  const accountPayload = await qboQuery(connectionId, "select * from Account where Active = true maxresults 1000");
  const taxPayload = await qboQuery(connectionId, "select * from TaxCode where Active = true maxresults 1000");
  const termPayload = await qboQuery(connectionId, "select * from Term where Active = true maxresults 1000");
  const methodPayload = await qboQuery(connectionId, "select * from PaymentMethod where Active = true maxresults 1000");
  return {
    accounts: queryItems(accountPayload, "Account").map((item) => ({ id: String(item.Id), name: String(item.FullyQualifiedName ?? item.Name), accountType: String(item.AccountType ?? ""), accountSubType: String(item.AccountSubType ?? "") })),
    taxCodes: queryItems(taxPayload, "TaxCode").map((item) => ({ id: String(item.Id), name: String(item.Name), taxable: Boolean(item.Taxable) })),
    terms: queryItems(termPayload, "Term").map((item) => ({ id: String(item.Id), name: String(item.Name) })),
    paymentMethods: queryItems(methodPayload, "PaymentMethod").map((item) => ({ id: String(item.Id), name: String(item.Name), type: String(item.Type ?? "") })),
  };
}

export async function getQboAdminState(requestUrl: string, options: { connectionId?: string; includeRemoteOptions?: boolean; deliveryStatus?: string } = {}) {
  await ensureDatabase();
  const connections = await listQboConnections();
  const selected = options.connectionId ? connections.find((item) => item.id === options.connectionId) : connections[0];
  let accountMappings: Row[] = [];
  let referenceMappings: Row[] = [];
  let deliveries: Row[] = [];
  let summary: Row | null = null;
  let remoteOptions: Awaited<ReturnType<typeof fetchQboReferenceOptions>> | null = null;
  let remoteError: string | null = null;
  if (selected) {
    const connectionId = String(selected.id);
    const [accountResult, referenceResult, deliveryResult, summaryResult] = await Promise.all([
      getD1().prepare(`SELECT logical_key AS logicalKey,qbo_account_id AS qboAccountId,qbo_account_name AS qboAccountName,qbo_account_type AS qboAccountType,
        active,updated_by AS updatedBy,updated_at AS updatedAt FROM qbo_account_mappings WHERE connection_id=? AND active=1 ORDER BY logical_key`).bind(connectionId).all<Row>(),
      getD1().prepare(`SELECT mapping_type AS mappingType,local_value AS localValue,qbo_entity_id AS qboEntityId,qbo_entity_name AS qboEntityName,
        metadata_json AS metadataJson,active,updated_by AS updatedBy,updated_at AS updatedAt FROM qbo_reference_mappings WHERE connection_id=? AND active=1 ORDER BY mapping_type,local_value`).bind(connectionId).all<Row>(),
      listQboDeliveries(connectionId, { status: options.deliveryStatus, limit: 100 }),
      qboSyncSummary(connectionId),
    ]);
    accountMappings = accountResult.results;
    referenceMappings = referenceResult.results;
    deliveries = deliveryResult;
    summary = summaryResult as unknown as Row;
    if (options.includeRemoteOptions && selected.status === "connected") {
      try { remoteOptions = await fetchQboReferenceOptions(connectionId); }
      catch (error) { remoteError = error instanceof Error ? error.message : String(error); }
    }
  }
  return {
    configuration: qboConfigurationStatus(requestUrl), connections, selectedConnectionId: selected?.id ?? null,
    accountRoles: qboAccountRoles, accountMappings, referenceMappings, deliveries, summary, remoteOptions, remoteError,
    localReferenceValues: await localReferenceValues(),
  };
}

async function localReferenceValues() {
  const [taxCodes, terms, methods] = await Promise.all([
    getD1().prepare(`SELECT DISTINCT tax_code AS value FROM (
      SELECT tax_code FROM customer_invoices UNION ALL SELECT tax_code FROM vendor_bills UNION ALL
      SELECT tax_code FROM sales_order_lines UNION ALL SELECT tax_code FROM purchase_order_lines UNION ALL
      SELECT tax_code FROM document_charges WHERE taxable=1
    ) WHERE tax_code IS NOT NULL AND TRIM(tax_code)<>'' ORDER BY value`).all<{ value: string }>(),
    getD1().prepare(`SELECT DISTINCT payment_terms AS value FROM (
      SELECT payment_terms FROM business_partners UNION ALL SELECT payment_terms FROM purchase_orders UNION ALL SELECT payment_terms FROM sales_orders UNION ALL
      SELECT payment_terms FROM customer_invoices UNION ALL SELECT payment_terms FROM vendor_bills
    ) WHERE payment_terms IS NOT NULL AND payment_terms<>'' ORDER BY value`).all<{ value: string }>(),
    getD1().prepare("SELECT DISTINCT method AS value FROM payments WHERE method<>'' ORDER BY value").all<{ value: string }>(),
  ]);
  return {
    taxCodes: Array.from(new Set(["GST", "ZERO", "EXEMPT", ...taxCodes.results.map((item) => canonicalTaxCode(item.value)).filter(Boolean)])),
    terms: terms.results.map((item) => item.value), paymentMethods: methods.results.map((item) => item.value),
  };
}

export async function saveQboAccountMappings(connectionId: string, mappings: Array<Row>, actor: ActorIdentity) {
  const timestamp = new Date().toISOString();
  const validKeys = new Set(qboAccountRoles.map((role) => role.key));
  const seen = new Set<string>();
  const statements = mappings.map((mapping) => {
    const logicalKey = String(mapping.logicalKey ?? "").trim();
    const qboAccountId = String(mapping.qboAccountId ?? "").trim();
    const qboAccountName = String(mapping.qboAccountName ?? "").trim();
    const qboAccountType = String(mapping.qboAccountType ?? "").trim();
    const role = qboAccountRoles.find((item) => item.key === logicalKey);
    if (!validKeys.has(logicalKey as typeof qboAccountRoles[number]["key"]) || !qboAccountId || !qboAccountName || !qboAccountType) throw new Error(`Invalid account mapping for ${logicalKey || "unknown role"}.`);
    if (seen.has(logicalKey)) throw new Error(`Account role ${logicalKey} was supplied more than once.`);
    seen.add(logicalKey);
    if (!role?.types.some((type) => type === qboAccountType)) throw new Error(`${qboAccountName} (${qboAccountType}) is not an allowed account type for ${role?.label ?? logicalKey}.`);
    return getD1().prepare(`INSERT INTO qbo_account_mappings (connection_id,logical_key,qbo_account_id,qbo_account_name,qbo_account_type,active,updated_by,updated_at)
      VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(connection_id,logical_key) DO UPDATE SET qbo_account_id=excluded.qbo_account_id,
      qbo_account_name=excluded.qbo_account_name,qbo_account_type=excluded.qbo_account_type,active=1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(connectionId, logicalKey, qboAccountId, qboAccountName, qboAccountType, actor.label, timestamp);
  });
  statements.unshift(getD1().prepare("UPDATE qbo_account_mappings SET active=0,updated_by=?,updated_at=? WHERE connection_id=? AND active=1").bind(actor.label, timestamp, connectionId));
  statements.push(getD1().prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
    VALUES (?,'qbo_connection',?,'account_mappings_updated','QuickBooks account mappings updated.',?,?,?,?,?)`)
    .bind(`audit-qbo-${crypto.randomUUID()}`, connectionId, actor.label, actor.id, actor.email, JSON.stringify({ count: mappings.length }), timestamp));
  statements.push(
    getD1().prepare(`UPDATE qbo_sync_deliveries SET status='pending',attempts=0,available_at=?,locked_at=NULL,last_error_code=NULL,last_error=NULL,processed_at=NULL
      WHERE connection_id=? AND status='conflict' AND last_error_code='QBO_MAPPING_REQUIRED'`).bind(timestamp, connectionId),
    getD1().prepare(`UPDATE qbo_connections SET initial_sync_status='running',last_error=NULL,updated_at=? WHERE id=? AND initial_sync_status='failed'`).bind(timestamp, connectionId),
  );
  if (statements.length) await getD1().batch(statements);
  return { saved: mappings.length };
}

export async function saveQboReferenceMappings(connectionId: string, mappings: Array<Row>, actor: ActorIdentity) {
  const timestamp = new Date().toISOString();
  const validTypes = new Set(["tax_code", "term", "payment_method"]);
  const seen = new Set<string>();
  const statements = mappings.map((mapping) => {
    const mappingType = String(mapping.mappingType ?? "").trim();
    const localValue = mappingType === "tax_code" ? canonicalTaxCode(mapping.localValue) : String(mapping.localValue ?? "").trim();
    const qboEntityId = String(mapping.qboEntityId ?? "").trim();
    const qboEntityName = String(mapping.qboEntityName ?? "").trim();
    if (!validTypes.has(mappingType) || !localValue || !qboEntityId || !qboEntityName) throw new Error(`Invalid ${mappingType || "reference"} mapping.`);
    const key = `${mappingType}:${localValue}`;
    if (seen.has(key)) throw new Error(`${mappingType.replaceAll("_", " ")} ${localValue} was supplied more than once.`);
    seen.add(key);
    return getD1().prepare(`INSERT INTO qbo_reference_mappings
      (connection_id,mapping_type,local_value,qbo_entity_id,qbo_entity_name,metadata_json,active,updated_by,updated_at)
      VALUES (?,?,?,?,?,?,1,?,?) ON CONFLICT(connection_id,mapping_type,local_value) DO UPDATE SET qbo_entity_id=excluded.qbo_entity_id,
      qbo_entity_name=excluded.qbo_entity_name,metadata_json=excluded.metadata_json,active=1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(connectionId, mappingType, localValue, qboEntityId, qboEntityName, JSON.stringify(mapping.metadata ?? {}), actor.label, timestamp);
  });
  statements.unshift(getD1().prepare("UPDATE qbo_reference_mappings SET active=0,updated_by=?,updated_at=? WHERE connection_id=? AND active=1").bind(actor.label, timestamp, connectionId));
  statements.push(getD1().prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
    VALUES (?,'qbo_connection',?,'reference_mappings_updated','QuickBooks reference mappings updated.',?,?,?,?,?)`)
    .bind(`audit-qbo-${crypto.randomUUID()}`, connectionId, actor.label, actor.id, actor.email, JSON.stringify({ count: mappings.length }), timestamp));
  statements.push(
    getD1().prepare(`UPDATE qbo_sync_deliveries SET status='pending',attempts=0,available_at=?,locked_at=NULL,last_error_code=NULL,last_error=NULL,processed_at=NULL
      WHERE connection_id=? AND status='conflict' AND last_error_code='QBO_MAPPING_REQUIRED'`).bind(timestamp, connectionId),
    getD1().prepare(`UPDATE qbo_connections SET initial_sync_status='running',last_error=NULL,updated_at=? WHERE id=? AND initial_sync_status='failed'`).bind(timestamp, connectionId),
  );
  if (statements.length) await getD1().batch(statements);
  return { saved: mappings.length };
}
