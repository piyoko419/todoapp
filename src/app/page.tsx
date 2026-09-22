import Link from "next/link";
import AppNav from "@/components/AppNav";
import MonthCalendar from "@/components/MonthCalendar";
import { monthKey, withoutDate } from "@/lib/calendar";
import { toISODate } from "@/lib/date";
import { listJobs, listStaff } from "@/lib/jobs";
import { isConfigured } from "@/lib/line/client";
import { Job, STATUS_LABEL, URGENCY_LABEL, isOpen } from "@/lib/types";
import { STATUS_STYLE, URGENCY_STYLE, dueLabel } from "@/lib/ui";

export const dynamic = "force-dynamic";

function JobLine({ job, today, assignee }: { job: Job; today: string; assignee: string }) {
  const overdue = job.dueDate !== null && job.dueDate < today;
  return (
    <div className="flex overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className={`w-1.5 ${URGENCY_STYLE[job.urgency].bar}`} />
      <div className="flex-1 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-slate-700">{job.room}号室</span>
          <span className="text-sm text-slate-400">{job.property}</span>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs ${URGENCY_STYLE[job.urgency].chip}`}
          >
            {URGENCY_LABEL[job.urgency]}
          </span>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs ${STATUS_STYLE[job.status]}`}
          >
            {STATUS_LABEL[job.status]}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {job.workTypes.join("・") || "内容未設定"} ・ 担当 {assignee}
        </p>
        <p className={`text-xs ${overdue ? "font-bold text-rose-500" : "text-slate-400"}`}>
          {job.dueDate ?? "期限未定"}（{dueLabel(job.dueDate, today)}）
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const [jobs, staff, params] = await Promise.all([
    listJobs(),
    listStaff(),
    searchParams,
  ]);
  const now = new Date();
  const today = toISODate(now);
  // ?month=2026-10 で月を切り替える。不正な値は今月に落とす。
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "")
    ? (params.month as string)
    : monthKey(now);
  const open = jobs.filter(isOpen);
  const overdue = open.filter((job) => job.dueDate !== null && job.dueDate < today);
  const urgent = open.filter((job) => job.urgency === "urgent");
  const unassigned = open.filter((job) => job.assigneeId === null);
  const lineReady = isConfigured();

  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.name ?? "未割当";
  const attention = [...overdue, ...urgent.filter((job) => !overdue.includes(job))].slice(0, 8);
  const undated = withoutDate(open);

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <AppNav />
      <h1 className="text-2xl font-bold text-slate-700 mb-1">ダッシュボード</h1>
      <p className="text-sm text-slate-500 mb-6">{today} 時点の状況です。</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <Stat label="未完了" value={open.length} tone="text-slate-700" />
        <Stat label="至急" value={urgent.length} tone="text-rose-500" />
        <Stat label="期限超過" value={overdue.length} tone="text-amber-500" />
        <Stat label="未割当" value={unassigned.length} tone="text-violet-500" />
      </div>

      {!lineReady && (
        <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          LINE 連携が未設定です。<code className="mx-1">.env.local</code>
          に LINE_CHANNEL_SECRET と LINE_CHANNEL_ACCESS_TOKEN を設定すると、
          新規案件の通知とスタッフの受諾・完了報告が LINE 上で回るようになります。
          手順は <code className="mx-1">docs/LINE_SETUP.md</code> にあります。
        </div>
      )}

      <div className="mb-8">
        <MonthCalendar jobs={open} month={month} today={today} />
        {undated.length > 0 && (
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            実施予定日も期限も入っていない案件が {undated.length} 件あります（
            {undated.map((job) => `${job.room}号室`).join("・")}）。
            カレンダーには出ないので、案件ボードで日付を入れてください。
          </p>
        )}
      </div>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-slate-700 mb-3">今すぐ手を打つもの</h2>
        <div className="space-y-3">
          {attention.length === 0 && (
            <p className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
              期限超過・至急の案件はありません。
            </p>
          )}
          {attention.map((job) => (
            <JobLine key={job.id} job={job} today={today} assignee={nameOf(job.assigneeId)} />
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/intake"
          className="rounded-full bg-violet-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-600"
        >
          依頼メールを取り込む
        </Link>
        <Link
          href="/board"
          className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm text-slate-500 hover:border-violet-300 hover:text-violet-600"
        >
          案件ボードを開く
        </Link>
      </div>
    </main>
  );
}
