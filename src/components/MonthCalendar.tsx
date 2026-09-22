import Link from "next/link";
import { formatMonth, groupByDate, monthGrid, shiftMonth } from "@/lib/calendar";
import { Job, STATUS_LABEL, URGENCY_LABEL } from "@/lib/types";
import { URGENCY_STYLE } from "@/lib/ui";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 1 日の升目に出す件数。これを超えた分は「他 N 件」にまとめる。 */
const MAX_PER_DAY = 3;

function weekdayColor(weekday: number): string {
  if (weekday === 0) return "text-rose-400";
  if (weekday === 6) return "text-sky-400";
  return "text-slate-400";
}

export default function MonthCalendar({
  jobs,
  month,
  today,
}: {
  jobs: Job[];
  month: string;
  today: string;
}) {
  const cells = monthGrid(month, today);
  const byDate = groupByDate(jobs);
  const thisMonth = today.slice(0, 7);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-slate-700">{formatMonth(month)}</h2>
        <div className="ml-auto flex items-center gap-1">
          <Link
            href={`/?month=${shiftMonth(month, -1)}`}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500 hover:border-violet-300 hover:text-violet-600"
          >
            ← 前月
          </Link>
          {month !== thisMonth && (
            <Link
              href="/"
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500 hover:border-violet-300 hover:text-violet-600"
            >
              今月
            </Link>
          )}
          <Link
            href={`/?month=${shiftMonth(month, 1)}`}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500 hover:border-violet-300 hover:text-violet-600"
          >
            翌月 →
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid grid-cols-7 border-b border-slate-100">
          {WEEKDAYS.map((label, index) => (
            <div
              key={label}
              className={`py-2 text-center text-xs font-medium ${weekdayColor(index)}`}
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((cell) => {
            const placed = byDate.get(cell.date) ?? [];
            const shown = placed.slice(0, MAX_PER_DAY);
            const rest = placed.length - shown.length;
            return (
              <div
                key={cell.date}
                className={`min-h-[6.5rem] border-b border-r border-slate-100 p-1.5 ${
                  cell.inMonth ? "" : "bg-slate-50/60"
                }`}
              >
                <div className="mb-1 flex items-center gap-1">
                  <span
                    className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs ${
                      cell.isToday
                        ? "bg-violet-500 font-bold text-white"
                        : cell.inMonth
                          ? weekdayColor(cell.weekday)
                          : "text-slate-300"
                    }`}
                  >
                    {Number(cell.date.slice(8))}
                  </span>
                </div>

                <div className="space-y-1">
                  {shown.map(({ job, kind }) => (
                    <Link
                      key={job.id}
                      href="/board"
                      title={`${job.property} ${job.room}号室 / ${job.workTypes.join("・") || "内容未定"} / ${URGENCY_LABEL[job.urgency]} / ${STATUS_LABEL[job.status]}${kind === "due" ? " / 期限（実施日未定）" : ""}`}
                      className={`flex items-center gap-1 rounded-md border px-1 py-0.5 text-[11px] leading-tight ${
                        URGENCY_STYLE[job.urgency].chip
                      } ${kind === "due" ? "border-dashed opacity-75" : ""}`}
                    >
                      <span className="truncate font-medium">{job.room}</span>
                      <span className="truncate opacity-70">
                        {job.workTypes[0] ?? ""}
                      </span>
                    </Link>
                  ))}
                  {rest > 0 && (
                    <Link
                      href="/board"
                      className="block px-1 text-[11px] text-slate-400 hover:text-violet-500"
                    >
                      他 {rest} 件
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        実線は実施予定日、
        <span className="mx-1 rounded border border-dashed border-slate-300 px-1">
          破線
        </span>
        は実施日が未定で期限の日に仮置きしたものです。色は緊急度、クリックで案件ボードに移ります。
      </p>
    </section>
  );
}
