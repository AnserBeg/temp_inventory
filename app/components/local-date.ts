/**
 * Calendar dates the way the person at the keyboard reads them.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which in Alberta is already tomorrow
 * from 5 pm (6 pm in summer). Every "today" default and every late-versus-expected comparison
 * drifted a day at the end of the working afternoon, and a receipt keyed at 6 pm was dated the
 * next day.
 */
export function localDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today plus `days` calendar days, in the viewer's own calendar. */
export function localDatePlusDays(days: number, from: Date = new Date()): string {
  return localDateString(new Date(from.getFullYear(), from.getMonth(), from.getDate() + days, 12));
}
