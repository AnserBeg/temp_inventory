import { ensureDatabase, first } from "./inventory-db";

/**
 * Policy violations are ordinary business rejections, not outages. They carry an HTTP status and a
 * stable code so every API route can answer with a 4xx JSON envelope instead of a 500.
 */
export class PolicyError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message);
  }
}

export class PeriodLockError extends PolicyError {
  constructor(public moduleName: string, public lockedThrough: string) {
    super("PERIOD_LOCKED", `${moduleName} is locked through ${lockedThrough}. Use a later posting date or ask a manager to reopen the period.`, 409);
  }
}

export async function assertPeriodOpen(moduleName: "inventory" | "purchasing" | "sales" | "accounting", postingDate: string) {
  await ensureDatabase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(postingDate)) throw new PolicyError("POSTING_DATE_INVALID", "postingDate must use YYYY-MM-DD format.", 400);
  const parsed = new Date(`${postingDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== postingDate) throw new PolicyError("POSTING_DATE_INVALID", "postingDate must be a valid calendar date.", 400);
  const lock = await first<{ lockedThrough: string }>(
    `SELECT locked_through AS lockedThrough FROM period_locks
      WHERE active=1 AND module IN (?, 'all') AND locked_through >= ?
      ORDER BY locked_through DESC LIMIT 1`,
    moduleName,
    postingDate
  );
  if (lock) throw new PeriodLockError(moduleName, lock.lockedThrough);
}
