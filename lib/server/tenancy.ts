import { AsyncLocalStorage } from "node:async_hooks";

export const DEFAULT_TENANT_ID = "tenant-default";

export type TenantContext = {
  tenantId: string;
  tenantName?: string;
  tenantSlug?: string;
};

/**
 * Tables containing company-owned data. Global identity and tenant registry tables are
 * deliberately absent; membership is company-owned and root auth queries it explicitly.
 */
export const TENANT_OWNED_TABLES = [
  "approvals",
  "attachments",
  "audit_events",
  "business_partners",
  "catalog_price_history",
  "command_log",
  "cost_layers",
  "customer_credits",
  "customer_invoice_lines",
  "customer_invoices",
  "customer_returns",
  "document_charges",
  "document_email_deliveries",
  "document_sequences",
  "drop_ship_deliveries",
  "email_connections",
  "email_oauth_states",
  "smtp_email_connections",
  "helcim_checkout_sessions",
  "helcim_connections",
  "helcim_invoice_mirrors",
  "helcim_webhook_events",
  "inventory_balances",
  "inventory_count_session_lines",
  "inventory_count_sessions",
  "inventory_counts",
  "inventory_lots",
  "inventory_transfer_lines",
  "inventory_transfers",
  "inventory_units",
  "inventory_value_entries",
  "landed_cost_allocation_lines",
  "landed_cost_allocations",
  "locations",
  "margin_rules",
  "master_record_merges",
  "movement_assignments",
  "outbox_events",
  "partner_addresses",
  "payments",
  "period_locks",
  "price_list_assignments",
  "price_list_entries",
  "price_lists",
  "product_aliases",
  "product_cost_history",
  "product_default_locations",
  "products",
  "purchase_order_lines",
  "purchase_order_merges",
  "purchase_order_revisions",
  "purchase_orders",
  "qbo_account_mappings",
  "qbo_connections",
  "qbo_entity_links",
  "qbo_oauth_states",
  "qbo_reconciliation_runs",
  "qbo_reference_mappings",
  "qbo_sync_cursors",
  "qbo_sync_deliveries",
  "qbo_webhook_events",
  "receipts",
  "receipt_lines",
  "reservations",
  "returnable_asset_types",
  "returnable_events",
  "returnable_obligations",
  "sales_order_lines",
  "sales_orders",
  "shipment_lines",
  "shipments",
  "stock_movements",
  "supply_allocation_receipts",
  "supply_allocations",
  "system_settings",
  "tenant_memberships",
  "units_of_measure",
  "uom_conversions",
  "valuation_policies",
  "vendor_bill_lines",
  "vendor_bills",
  "vendor_credits",
  "vendor_returns",
  "warehouses",
] as const;

const tenantStorage = new AsyncLocalStorage<TenantContext>();
const tenantTableSet = new Set<string>(TENANT_OWNED_TABLES);

export class TenantContextError extends Error {
  constructor(message = "A tenant context is required for this operation.") {
    super(message);
    this.name = "TenantContextError";
  }
}

export function validateTenantId(tenantId: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/iu.test(tenantId)) {
    throw new TenantContextError("The tenant identifier is invalid.");
  }
  return tenantId;
}

export function currentTenant() {
  return tenantStorage.getStore();
}

export function requireTenant() {
  const context = currentTenant();
  if (!context) throw new TenantContextError();
  return context;
}

export function runWithTenant<T>(context: TenantContext, work: () => T): T {
  validateTenantId(context.tenantId);
  return tenantStorage.run(context, work);
}

function requestCookie(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key !== name) continue;
    try { return decodeURIComponent(value.join("=")); } catch { return ""; }
  }
  return "";
}

/**
 * Resolves an authenticated request's tenant before the application router runs. Cloudflare's
 * AsyncLocalStorage deliberately supports run(), but not enterWith(), so the Worker owns the
 * request boundary and the database layer inherits a concurrency-safe context from here.
 * Authorization is still repeated by resolveActor; an untrusted tenant cookie is never enough.
 */
export async function tenantContextForRequest(
  request: Request,
  database: Pick<D1Database, "prepare">,
  localDevelopmentAuth = false,
): Promise<TenantContext> {
  const requested = request.headers.get("x-paneflow-tenant-id")?.trim()
    || requestCookie(request, "paneflow_tenant").trim();
  if (!requested) return { tenantId: DEFAULT_TENANT_ID };
  try { validateTenantId(requested); } catch { return { tenantId: DEFAULT_TENANT_ID }; }

  const userId = request.headers.get("oai-authenticated-user-id")?.trim()
    || (localDevelopmentAuth ? "local-dev" : "");
  if (!userId) return { tenantId: DEFAULT_TENANT_ID };
  const membership = await database.prepare(`SELECT t.id,t.slug,t.name
    FROM tenant_memberships tm JOIN tenants t ON t.id=tm.tenant_id
    WHERE tm.user_id=? AND tm.tenant_id=? AND tm.active=1 AND t.status='active' LIMIT 1`)
    .bind(userId, requested).first<{ id: string; slug: string; name: string }>();
  return membership
    ? { tenantId: membership.id, tenantSlug: membership.slug, tenantName: membership.name }
    : { tenantId: DEFAULT_TENANT_ID };
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function identifierPattern(table: string) {
  return new RegExp("\\b(?:FROM|JOIN|UPDATE|INTO)\\s+(?:main\\.)?[\"\\[]?" + table + "\\b", "iu");
}

function matchingParen(sql: string, openIndex: number) {
  let depth = 0;
  let quote = "";
  for (let index = openIndex; index < sql.length; index += 1) {
    const char = sql[index];
    if (quote) {
      if (char === quote) {
        if (sql[index + 1] === quote) index += 1;
        else quote = "";
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
    if (char === "[") { quote = "]"; continue; }
    if (char === "(") depth += 1;
    if (char === ")" && --depth === 0) return index;
  }
  return -1;
}

function findTopLevelKeyword(sql: string, keyword: string, start = 0) {
  let depth = 0;
  let quote = "";
  const wanted = keyword.toUpperCase();
  for (let index = start; index <= sql.length - keyword.length; index += 1) {
    const char = sql[index];
    if (quote) {
      if (char === quote) {
        if (sql[index + 1] === quote) index += 1;
        else quote = "";
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
    if (char === "[") { quote = "]"; continue; }
    if (char === "(") { depth += 1; continue; }
    if (char === ")") { depth = Math.max(0, depth - 1); continue; }
    if (depth !== 0 || sql.slice(index, index + keyword.length).toUpperCase() !== wanted) continue;
    const before = index === 0 ? " " : sql[index - 1];
    const after = sql[index + keyword.length] ?? " ";
    if (!/[a-z0-9_]/iu.test(before) && !/[a-z0-9_]/iu.test(after)) return index;
  }
  return -1;
}

function addMutationTenantPredicate(sql: string, targetEnd: number, tenant: string) {
  const where = findTopLevelKeyword(sql, "WHERE", targetEnd);
  if (where >= 0) return `${sql.slice(0, where + 5)} tenant_id=${tenant} AND${sql.slice(where + 5)}`;
  const returning = findTopLevelKeyword(sql, "RETURNING", targetEnd);
  const end = returning >= 0 ? returning : sql.length;
  return `${sql.slice(0, end)} WHERE tenant_id=${tenant} ${sql.slice(end)}`;
}

function addTenantToConflictTargets(sql: string) {
  return sql.replace(/ON\s+CONFLICT\s*\(([^)]*)\)/giu, (match, columns: string) =>
    /(?:^|,)\s*["`\[]?tenant_id["`\]]?\s*(?:,|$)/iu.test(columns)
      ? match
      : match.replace("(", "(tenant_id,"));
}

function addTenantToInsert(sql: string, targetEnd: number, tenant: string) {
  let open = targetEnd;
  while (/\s/u.test(sql[open] ?? "")) open += 1;
  if (sql[open] !== "(") throw new TenantContextError("Tenant-owned INSERT statements must name their columns.");
  const close = matchingParen(sql, open);
  if (close < 0) throw new TenantContextError("Tenant-owned INSERT statement has an invalid column list.");
  const columns = sql.slice(open + 1, close);
  if (/(?:^|,)\s*["`\[]?tenant_id["`\]]?\s*(?:,|$)/iu.test(columns)) return addTenantToConflictTargets(sql);

  let rewritten = `${sql.slice(0, open + 1)}tenant_id,${columns}${sql.slice(close)}`;
  const shiftedClose = close + "tenant_id,".length;
  const values = findTopLevelKeyword(rewritten, "VALUES", shiftedClose);
  const select = findTopLevelKeyword(rewritten, "SELECT", shiftedClose);
  if (values >= 0 && (select < 0 || values < select)) {
    let cursor = values + 6;
    let output = rewritten.slice(0, cursor);
    const conflict = findTopLevelKeyword(rewritten, "ON", cursor);
    const returning = findTopLevelKeyword(rewritten, "RETURNING", cursor);
    const stop = [conflict, returning].filter((position) => position >= 0).sort((a, b) => a - b)[0] ?? rewritten.length;
    let depth = 0;
    let quote = "";
    while (cursor < stop) {
      const char = rewritten[cursor];
      if (quote) {
        output += char;
        if (char === quote) {
          if (rewritten[cursor + 1] === quote) { output += rewritten[cursor + 1]; cursor += 1; }
          else quote = "";
        }
      } else if (char === "'" || char === '"' || char === "`") {
        quote = char; output += char;
      } else if (char === "(") {
        output += depth === 0 ? `(${tenant},` : char;
        depth += 1;
      } else if (char === ")") {
        depth = Math.max(0, depth - 1); output += char;
      } else output += char;
      cursor += 1;
    }
    rewritten = output + rewritten.slice(cursor);
  } else if (select >= 0) {
    const distinct = /^\s+DISTINCT\b/iu.exec(rewritten.slice(select + 6));
    const insertion = distinct ? select + 6 + distinct[0].length : select + 6;
    rewritten = `${rewritten.slice(0, insertion)} ${tenant},${rewritten.slice(insertion)}`;
  } else {
    throw new TenantContextError("Tenant-owned INSERT statements must use VALUES or SELECT.");
  }
  return addTenantToConflictTargets(rewritten);
}

function prependTenantCtes(sql: string, tables: string[], tenant: string) {
  if (!tables.length) return sql;
  const ctes = tables.map((table) => `"${table}" AS (SELECT rowid AS rowid,* FROM main."${table}" WHERE tenant_id=${tenant})`).join(",");
  const recursive = /^(\s*)WITH\s+RECURSIVE\s+/iu.exec(sql);
  if (recursive) return `${recursive[1]}WITH RECURSIVE ${ctes},${sql.slice(recursive[0].length)}`;
  const withClause = /^(\s*)WITH\s+/iu.exec(sql);
  if (withClause) return `${withClause[1]}WITH ${ctes},${sql.slice(withClause[0].length)}`;
  const leading = /^\s*/u.exec(sql)?.[0] ?? "";
  return `${leading}WITH ${ctes} ${sql.slice(leading.length)}`;
}

/**
 * Applies mandatory row isolation to the raw SQL used by the domain layer. Reads see
 * tenant-filtered CTEs that shadow physical tables; writes receive tenant_id on INSERT and
 * an immutable tenant predicate on UPDATE/DELETE. The transformer fails closed for an INSERT
 * shape it cannot prove safe.
 */
export function scopeTenantSql(sql: string, tenantId: string) {
  validateTenantId(tenantId);
  const tenant = sqlLiteral(tenantId);
  const referenced = TENANT_OWNED_TABLES.filter((table) => identifierPattern(table).test(sql));
  if (!referenced.length) return sql;

  const mutation = /\b(INSERT(?:\s+OR\s+[A-Z]+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+(["`\[]?)([a-z_][a-z0-9_]*)(["`\]]?)/iu.exec(sql);
  if (!mutation || !tenantTableSet.has(mutation[3].toLowerCase())) return prependTenantCtes(sql, referenced, tenant);

  const target = mutation[3].toLowerCase();
  const targetStart = mutation.index + mutation[0].lastIndexOf(mutation[2] + mutation[3]);
  const targetEnd = targetStart + mutation[2].length + mutation[3].length + mutation[4].length;
  let rewritten = `${sql.slice(0, targetStart)}main."${target}"${sql.slice(targetEnd)}`;
  const rewrittenTargetEnd = targetStart + `main."${target}"`.length;
  if (/^INSERT/iu.test(mutation[1])) rewritten = addTenantToInsert(rewritten, rewrittenTargetEnd, tenant);
  else rewritten = addMutationTenantPredicate(rewritten, rewrittenTargetEnd, tenant);
  return prependTenantCtes(rewritten, referenced, tenant);
}
