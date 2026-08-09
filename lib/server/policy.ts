import { ensureDatabase, first } from "./inventory-db";

export class PeriodLockError extends Error {
  constructor(public moduleName: string, public lockedThrough: string) {
    super(`${moduleName} is locked through ${lockedThrough}. Use a later posting date or ask a manager to reopen the period.`);
  }
}

export async function assertPeriodOpen(moduleName: "inventory" | "purchasing" | "sales" | "accounting", postingDate: string) {
  await ensureDatabase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(postingDate)) throw new Error("postingDate must use YYYY-MM-DD format.");
  const parsed = new Date(`${postingDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== postingDate) throw new Error("postingDate must be a valid calendar date.");
  const lock = await first<{ lockedThrough: string }>(
    `SELECT locked_through AS lockedThrough FROM period_locks
      WHERE active=1 AND module IN (?, 'all') AND locked_through >= ?
      ORDER BY locked_through DESC LIMIT 1`,
    moduleName,
    postingDate
  );
  if (lock) throw new PeriodLockError(moduleName, lock.lockedThrough);
}
