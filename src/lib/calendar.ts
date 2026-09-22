import { Job } from "./types";
import { toISODate } from "./date";

export type CalendarCell = {
  /** YYYY-MM-DD */
  date: string;
  /** 表示中の月に属する日か。前後の月の日は薄く出す。 */
  inMonth: boolean;
  isToday: boolean;
  /** 0=日曜 … 6=土曜 */
  weekday: number;
};

/** "2026-09" のような月キーを作る。 */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** 月キーを前後に動かす。年またぎも正しく扱う。 */
export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  return monthKey(new Date(year, m - 1 + delta, 1));
}

export function formatMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return `${year}年${m}月`;
}

/**
 * 月カレンダーの升目を作る。日曜始まりで、前後の月の日を足して週単位に揃える。
 */
export function monthGrid(month: string, today: string): CalendarCell[] {
  const [year, m] = month.split("-").map(Number);
  const first = new Date(year, m - 1, 1);
  const last = new Date(year, m, 0);

  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(last);
  end.setDate(end.getDate() + (6 - end.getDay()));

  const cells: CalendarCell[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = toISODate(cursor);
    cells.push({
      date,
      inMonth: cursor.getMonth() === m - 1,
      isToday: date === today,
      weekday: cursor.getDay(),
    });
  }
  return cells;
}

export type PlacedJob = {
  job: Job;
  /** scheduled = 実施予定日が入っている。due = 期限しか無いので仮置き。 */
  kind: "scheduled" | "due";
};

/**
 * カレンダーのどの日に置くかを決める。
 * 実施予定日が入っていればそれを優先し、無ければ期限の日に仮置きする。
 * どちらも無ければカレンダーに出さない。
 */
export function placeJob(job: Job): { date: string; kind: PlacedJob["kind"] } | null {
  if (job.scheduledDate) return { date: job.scheduledDate, kind: "scheduled" };
  if (job.dueDate) return { date: job.dueDate, kind: "due" };
  return null;
}

/** 日付ごとに案件をまとめる。各日の中は実施予定が先、次に急ぎ順。 */
export function groupByDate(jobs: Job[]): Map<string, PlacedJob[]> {
  const byDate = new Map<string, PlacedJob[]>();
  for (const job of jobs) {
    const placed = placeJob(job);
    if (!placed) continue;
    const list = byDate.get(placed.date) ?? [];
    list.push({ job, kind: placed.kind });
    byDate.set(placed.date, list);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "scheduled" ? -1 : 1;
      return a.job.room.localeCompare(b.job.room);
    });
  }
  return byDate;
}

/** 予定の無い案件。カレンダーに出せないので別枠で知らせる。 */
export function withoutDate(jobs: Job[]): Job[] {
  return jobs.filter((job) => placeJob(job) === null);
}
