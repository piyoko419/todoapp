/** ローカル日付を YYYY-MM-DD に。toISOString は UTC にずれるので使わない。 */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

/** その月の末日。month は 1-12。 */
export function lastDayOfMonth(year: number, month: number): Date {
  return new Date(year, month, 0);
}

/** 今日から見て何日後か（負なら過去）。 */
export function daysUntil(isoDate: string, now: Date): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

export function formatJP(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${m}/${d}`;
}
