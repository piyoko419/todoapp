"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppNav from "@/components/AppNav";
import { toISODate } from "@/lib/date";
import {
  Job,
  JobStatus,
  STATUS_LABEL,
  Staff,
  URGENCY_LABEL,
  isOpen,
} from "@/lib/types";
import { STATUS_STYLE, URGENCY_STYLE, dueLabel } from "@/lib/ui";

const NEXT_STATUS: Partial<Record<JobStatus, { to: JobStatus; label: string }>> = {
  pending: { to: "assigned", label: "割当済にする" },
  assigned: { to: "accepted", label: "受諾にする" },
  accepted: { to: "in_progress", label: "作業開始" },
  in_progress: { to: "done", label: "完了にする" },
};

export default function BoardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newStaffName, setNewStaffName] = useState("");
  const today = toISODate(new Date());

  const load = useCallback(async () => {
    const [jobRes, staffRes] = await Promise.all([
      fetch("/api/jobs", { cache: "no-store" }),
      fetch("/api/staff", { cache: "no-store" }),
    ]);
    setJobs(((await jobRes.json()) as { jobs: Job[] }).jobs);
    setStaff(((await staffRes.json()) as { staff: Staff[] }).staff);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchJob = async (id: string, patch: Record<string, unknown>) => {
    setError(null);
    const res = await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? "更新に失敗しました");
      return;
    }
    await load();
  };

  const removeJob = async (job: Job) => {
    const label = `${job.property} ${job.room}号室`;
    if (!confirm(`${label} を削除します。元に戻せません。よろしいですか？`)) return;
    setError(null);
    const res = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? "削除に失敗しました");
      return;
    }
    await load();
  };

  const removeStaff = async (member: Staff) => {
    if (!confirm(`${member.name} さんを削除します。担当していた案件は未割当に戻ります。`)) {
      return;
    }
    await fetch(`/api/staff?id=${member.id}`, { method: "DELETE" });
    await load();
  };

  const addStaff = async () => {
    if (!newStaffName.trim()) return;
    await fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newStaffName.trim() }),
    });
    setNewStaffName("");
    await load();
  };

  const visible = useMemo(
    () => (showDone ? jobs : jobs.filter(isOpen)),
    [jobs, showDone],
  );

  const staffName = (id: string | null) =>
    staff.find((s) => s.id === id)?.name ?? "未割当";

  return (
    <main className="max-w-6xl mx-auto px-6 py-10">
      <AppNav />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-700">案件ボード</h1>
          <p className="text-sm text-slate-500">急ぎ順に並んでいます。</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-500">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="w-4 h-4 accent-violet-500"
          />
          完了・キャンセルも表示
        </label>
      </div>

      {error && (
        <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="space-y-3">
        {visible.length === 0 && (
          <p className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
            案件がありません。メール取り込みから登録してください。
          </p>
        )}
        {visible.map((job) => {
          const next = NEXT_STATUS[job.status];
          const overdue = job.dueDate !== null && job.dueDate < today && isOpen(job);
          return (
            <article
              key={job.id}
              className="flex overflow-hidden rounded-2xl border border-slate-200 bg-white"
            >
              <div className={`w-1.5 ${URGENCY_STYLE[job.urgency].bar}`} />
              <div className="flex-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-bold text-slate-700">
                    {job.room}号室
                  </span>
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
                  <span
                    className={`text-xs ${overdue ? "font-bold text-rose-500" : "text-slate-400"}`}
                  >
                    {job.dueDate ?? "期限未定"}（{dueLabel(job.dueDate, today)}）
                  </span>
                </div>

                <p className="mt-1 text-sm text-slate-500">
                  {job.workTypes.join("・") || "内容未設定"}
                  {job.notes && ` / ${job.notes}`}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={job.assigneeId ?? ""}
                    onChange={(e) =>
                      patchJob(job.id, { assigneeId: e.target.value || null })
                    }
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
                  >
                    <option value="">未割当</option>
                    {staff
                      .filter((s) => s.role !== "client")
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                  <input
                    type="date"
                    value={job.scheduledDate ?? ""}
                    onChange={(e) =>
                      patchJob(job.id, { scheduledDate: e.target.value || null })
                    }
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
                    aria-label="実施予定日"
                  />
                  {next && (
                    <button
                      onClick={() => patchJob(job.id, { status: next.to })}
                      className="rounded-full bg-violet-500 px-4 py-1.5 text-sm text-white hover:bg-violet-600"
                    >
                      {next.label}
                    </button>
                  )}
                  {isOpen(job) && (
                    <button
                      onClick={() => patchJob(job.id, { status: "cancelled" })}
                      className="rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-400 hover:border-rose-200 hover:text-rose-500"
                    >
                      キャンセル
                    </button>
                  )}
                  <span className="text-xs text-slate-400">
                    担当: {staffName(job.assigneeId)}
                  </span>
                  <button
                    onClick={() => removeJob(job)}
                    className="ml-auto rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-400 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-500"
                  >
                    削除
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-bold text-slate-700 mb-2">スタッフ</h2>
        <p className="text-sm text-slate-500 mb-3">
          LINE から「スタッフ登録 名前」と送ってもらうと、LINE 連携済みで登録されます。
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {staff.length === 0 && (
            <span className="text-sm text-slate-400">まだ登録がありません。</span>
          )}
          {staff.map((s) => (
            <span
              key={s.id}
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600"
            >
              {s.name}
              <span className="text-xs text-slate-400">
                {s.role === "client" ? "依頼元" : s.role === "admin" ? "管理者" : "スタッフ"}
                {s.lineUserId ? " ・LINE連携済" : ""}
              </span>
              <button
                onClick={() => removeStaff(s)}
                className="text-slate-300 hover:text-rose-500"
                aria-label={`${s.name}を削除`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newStaffName}
            onChange={(e) => setNewStaffName(e.target.value)}
            placeholder="スタッフ名"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-300"
          />
          <button
            onClick={addStaff}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500 hover:border-violet-300 hover:text-violet-600"
          >
            追加
          </button>
        </div>
      </section>
    </main>
  );
}
