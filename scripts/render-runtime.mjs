import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";

function bindValue(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}

class PreparedStatement {
  constructor(owner, sql, values = []) {
    this.owner = owner;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new PreparedStatement(this.owner, this.sql, values.map(bindValue));
  }

  execute() {
    const statement = this.owner.sqlite.prepare(this.sql);
    if (statement.columns().length) {
      return { success: true, results: statement.all(...this.values), meta: { changes: 0 } };
    }
    const result = statement.run(...this.values);
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  async first(columnName) {
    const row = this.owner.sqlite.prepare(this.sql).get(...this.values) ?? null;
    return columnName && row ? row[columnName] ?? null : row;
  }

  async all() {
    return this.execute();
  }

  async run() {
    return this.execute();
  }

  async raw(options = {}) {
    const statement = this.owner.sqlite.prepare(this.sql);
    const columns = statement.columns().map((column) => column.name);
    const rows = statement.all(...this.values).map((row) => columns.map((column) => row[column]));
    return options.columnNames ? [columns, ...rows] : rows;
  }
}

export class RenderD1Database {
  constructor(filename) {
    this.filename = filename;
    this.sqlite = new DatabaseSync(filename);
    this.sqlite.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;");
  }

  prepare(sql) {
    return new PreparedStatement(this, sql);
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  exec(sql) {
    this.sqlite.exec(sql);
  }

  close() {
    this.sqlite.close();
  }
}

export function databasePathFromUrl(value, projectRoot = process.cwd()) {
  const configured = String(value ?? "").trim();
  if (!configured) return resolve(projectRoot, ".render-data", "paneflow.sqlite");

  if (/^[a-z][a-z\d+.-]*:/iu.test(configured)) {
    let url;
    try {
      url = new URL(configured);
    } catch {
      throw new Error("DATABASE_URL must be a valid file: URL, for example file:/var/data/paneflow.sqlite.");
    }
    if (url.protocol !== "file:") {
      throw new Error(
        `Unsupported DATABASE_URL protocol ${url.protocol} This application uses SQLite/D1 SQL; use a file: URL on a Render persistent disk, not a PostgreSQL URL.`,
      );
    }
    return fileURLToPath(url);
  }

  return isAbsolute(configured) ? configured : resolve(projectRoot, configured);
}

function checksum(source) {
  return createHash("sha256").update(source).digest("hex");
}

function pragmaKind(statement) {
  const sql = statement.replaceAll(/--[^\r\n]*/gu, "").trim();
  if (/^PRAGMA\s+foreign_keys\s*=/iu.test(sql)) return "foreign-keys";
  if (/^PRAGMA\s+foreign_key_check\b/iu.test(sql)) return "foreign-key-check";
  return "statement";
}

async function existingFileSize(filename) {
  try {
    return (await stat(filename)).size;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

export async function openRenderDatabase({ databaseUrl, projectRoot = process.cwd() } = {}) {
  const filename = databasePathFromUrl(databaseUrl, projectRoot);
  await mkdir(dirname(filename), { recursive: true });
  const priorSize = await existingFileSize(filename);
  const database = new RenderD1Database(filename);
  return { database, filename, priorSize };
}

export async function applyRenderMigrations(database, {
  migrationDirectory = resolve(process.cwd(), "drizzle"),
  backupDirectory = resolve(dirname(database.filename), "backups"),
  priorSize = 0,
} = {}) {
  database.sqlite.exec(`CREATE TABLE IF NOT EXISTS _paneflow_migrations (
    name TEXT PRIMARY KEY NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const migrationNames = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}.*\.sql$/u.test(name))
    .sort();
  const appliedRows = database.sqlite.prepare("SELECT name,checksum FROM _paneflow_migrations").all();
  const applied = new Map(appliedRows.map((row) => [String(row.name), String(row.checksum)]));
  const pending = [];

  for (const name of migrationNames) {
    const source = await readFile(resolve(migrationDirectory, name), "utf8");
    const digest = checksum(source);
    const previous = applied.get(name);
    if (previous && previous !== digest) {
      throw new Error(`Applied migration ${name} no longer matches its recorded checksum. Restore the committed migration instead of editing migration history.`);
    }
    if (!previous) pending.push({ name, source, digest });
  }

  if (!pending.length) {
    console.info(`[render] Database is current (${migrationNames.length} migrations).`);
    return { applied: 0, total: migrationNames.length, backupPath: null };
  }

  let backupPath = null;
  if (applied.size && priorSize > 0) {
    await mkdir(backupDirectory, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
    backupPath = resolve(backupDirectory, `paneflow-before-${pending[0].name}-${stamp}.sqlite`);
    await backup(database.sqlite, backupPath);
    console.info(`[render] Created pre-migration backup at ${backupPath}.`);
  }

  for (const migration of pending) {
    console.info(`[render] Applying migration ${migration.name}...`);
    const statements = migration.source.split("--> statement-breakpoint");
    const controlsForeignKeys = statements.some((statement) => {
      const clean = statement.replaceAll(/--[^\r\n]*/gu, "").trim();
      return /^PRAGMA\s+foreign_keys\s*=\s*OFF\b/iu.test(clean);
    });

    if (controlsForeignKeys) database.sqlite.exec("PRAGMA foreign_keys=OFF");
    database.sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of statements) {
        const kind = pragmaKind(statement);
        if (kind === "foreign-keys" || kind === "foreign-key-check" || !statement.trim()) continue;
        database.sqlite.exec(statement);
      }
      if (controlsForeignKeys) {
        const violations = database.sqlite.prepare("PRAGMA foreign_key_check").all();
        if (violations.length) {
          throw new Error(`Migration ${migration.name} introduced ${violations.length} foreign-key violation(s).`);
        }
      }
      database.sqlite.prepare("INSERT INTO _paneflow_migrations (name,checksum,applied_at) VALUES (?,?,?)")
        .run(migration.name, migration.digest, new Date().toISOString());
      database.sqlite.exec("COMMIT");
    } catch (error) {
      database.sqlite.exec("ROLLBACK");
      throw new Error(`Migration ${migration.name} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    } finally {
      if (controlsForeignKeys) database.sqlite.exec("PRAGMA foreign_keys=ON");
    }
  }

  console.info(`[render] Applied ${pending.length} migration(s); database is at ${migrationNames.at(-1)}.`);
  return { applied: pending.length, total: migrationNames.length, backupPath };
}

function safeObjectPath(root, key) {
  const base = resolve(root);
  const target = resolve(base, ...String(key).split("/").filter(Boolean));
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error("Invalid object key.");
  return target;
}

export class LocalFileBucket {
  constructor(root) {
    this.root = resolve(root);
  }

  async put(key, value) {
    const { writeFile } = await import("node:fs/promises");
    const target = safeObjectPath(this.root, key);
    await mkdir(dirname(target), { recursive: true });
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    await writeFile(target, bytes);
    return { key };
  }

  async get(key) {
    try {
      const bytes = await readFile(safeObjectPath(this.root, key));
      return { body: bytes };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key) {
    const { rm } = await import("node:fs/promises");
    await rm(safeObjectPath(this.root, key), { force: true });
  }
}

export function fileUrlForPath(path) {
  return pathToFileURL(path).href;
}
