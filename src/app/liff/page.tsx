"use client";

import { useCallback, useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import { toISODate } from "@/lib/date";
import { Job, JobStatus, STATUS_LABEL, Staff, URGENCY_LABEL, isOpen } from "@/lib/types";
import { STATUS_STYLE, URGENCY_STYLE, dueLabel } from "@/lib/ui";

const STORAGE_KEY = "cleaning:staffId";

const NEXT: Partial<Record<JobStatus, { to: JobStatus; label: string }>> = {
  assigned: { to: "accepted", label: "受諾する" },
  accepted: { to: "in_progress", label: "作業開始" },
  in_progress: { to: "done", label: "完了報告" },
};

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [me, setMe] = useState<string>("");
  const today = toISODate(new Date());

  const load = useCallback(async () => {
    const [jobRes, staffRes] = await Promise.all([
      fetch("/api/jobs?open=1", { cache: "no-store" }),
      fetch("/api/staff", { cache: "no-store" }),
    ]);
    setJobs(((await jobRes.json()) as { jobs: Job[] }).jobs);
    setStaff(((await staffRes.json()) as { staff: Staff[] }).staff);
  }, []);

  useEffect(() => {
    setMe(localStorage.getItem(STORAGE_KEY) ?? "");
    void load();
  }, [load]);

  const chooseMe = (id: string) => {
    setMe(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  const act = async (job: Job, patch: Record<string, unknown>) => {
    await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await load();
  };

  const mine = jobs.filter((job) => job.assigneeId === me && isOpen(job));
  const available = jobs.filter((job) => job.assigneeId === null && isOpen(job));

  return (
    <main className="max-w-xl mx-auto px-4 py-8">
      <AppNav />
      <h1 className="text-xl font-bold text-slate-700 mb-1">スタッフ画面</h1>
      <p className="text-sm text-slate-500 mb-4">
        スマホから自分の担当と未割当の案件を確認できます。
      </p>

      <select
        value={me}
        onChange={(e) => chooseMe(e.target.value)}
        className="mb-6 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600"
      >
        <option value="">自分の名前を選択</option>
        {staff
          .filter((s) => s.role !== "client")
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </select>

      <Section title={`自分の担当（${mine.length}件）`}>
        {mine.map((job) => (
          <Card key={job.id} job={job} today={today}>
            {NEXT[job.status] && (
              <button
                onClick={() => act(job, { status: NEXT[job.status]!.to })}
                className="rounded-full bg-violet-500 px-4 py-1.5 text-sm text-white"
              >
                {NEXT[job.status]!.label}
              </button>
            )}
          </Card>
        ))}
        {mine.length === 0 && <Empty text="担当の案件はありません。" />}
      </Section>

      <Section title={`未割当（${available.length}件）`}>
        {available.map((job) => (
          <Card key={job.id} job={job} today={today}>
            <button
              disabled={!me}
              onClick={() => act(job, { assigneeId: me, status: "assigned" })}
              className="rounded-full bg-emerald-500 px-4 py-1.5 text-sm text-white disabled:opacity-40"
            >
              この案件を受ける
            </button>
          </Card>
        ))}
        {available.length === 0 && <Empty text="未割当の案件はありません。" />}
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-bold text-slate-500">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">
      {text}
    </p>
  );
}

function Card({
  job,
  today,
  children,
}: {
  job: Job;
  today: string;
  children: React.ReactNode;
}) {
  return (
    <article className="flex overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className={`w-1.5 ${URGENCY_STYLE[job.urgency].bar}`} />
      <div className="flex-1 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-slate-700">{job.room}号室</span>
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
        <p className="mt-1 text-sm text-slate-500">{job.property}</p>
        <p className="text-sm text-slate-500">{job.workTypes.join("・") || "内容未設定"}</p>
        <p className="text-xs text-slate-400">
          {job.dueDate ?? "期限未定"}（{dueLabel(job.dueDate, today)}）
        </p>
        <div className="mt-3">{children}</div>
      </div>
    </article>
  );
}
