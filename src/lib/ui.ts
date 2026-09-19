import { JobStatus, Urgency } from "./types";

/** 緊急度の見た目。パステル基調の既存トーンに合わせる。 */
export const URGENCY_STYLE: Record<Urgency, { chip: string; bar: string }> = {
  urgent: { chip: "bg-rose-100 text-rose-600 border-rose-200", bar: "bg-rose-400" },
  high: { chip: "bg-amber-100 text-amber-600 border-amber-200", bar: "bg-amber-400" },
  normal: { chip: "bg-sky-100 text-sky-600 border-sky-200", bar: "bg-sky-400" },
  low: { chip: "bg-slate-100 text-slate-500 border-slate-200", bar: "bg-slate-300" },
};

export const STATUS_STYLE: Record<JobStatus, string> = {
  pending: "bg-slate-100 text-slate-600 border-slate-200",
  assigned: "bg-violet-100 text-violet-600 border-violet-200",
  accepted: "bg-sky-100 text-sky-600 border-sky-200",
  in_progress: "bg-amber-100 text-amber-600 border-amber-200",
  done: "bg-emerald-100 text-emerald-600 border-emerald-200",
  cancelled: "bg-slate-100 text-slate-400 border-slate-200",
};

/** 期限までの残り日数を、人が読む言葉にする。 */
export function dueLabel(dueDate: string | null, today: string): string {
  if (!dueDate) return "期限未定";
  const diff = Math.round(
    (new Date(dueDate).getTime() - new Date(today).getTime()) / 86400000,
  );
  if (diff < 0) return `${-diff}日超過`;
  if (diff === 0) return "本日まで";
  if (diff === 1) return "明日まで";
  return `あと${diff}日`;
}
