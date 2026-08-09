import { DatabaseSync } from "node:sqlite";

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

  bind(...values) { return new PreparedStatement(this.owner, this.sql, values.map(bindValue)); }

  execute() {
    const statement = this.owner.sqlite.prepare(this.sql);
    if (statement.columns().length) {
      const results = statement.all(...this.values);
      return { success: true, results, meta: { changes: 0 } };
    }
    const result = statement.run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }

  async first(columnName) {
    const row = this.owner.sqlite.prepare(this.sql).get(...this.values) ?? null;
    return columnName && row ? row[columnName] ?? null : row;
  }

  async all() { return this.execute(); }
  async run() { return this.execute(); }
  async raw(options = {}) {
    const statement = this.owner.sqlite.prepare(this.sql);
    const columns = statement.columns().map((column) => column.name);
    const rows = statement.all(...this.values).map((row) => columns.map((column) => row[column]));
    return options.columnNames ? [columns, ...rows] : rows;
  }
}

export class D1SqliteDatabase {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.preparedSql = [];
  }

  prepare(sql) {
    this.preparedSql.push(sql);
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

  exec(sql) { this.sqlite.exec(sql); }
  close() { this.sqlite.close(); }
}
