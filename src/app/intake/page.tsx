"use client";

import { useState } from "react";
import AppNav from "@/components/AppNav";
import type { ParseResult } from "@/lib/parser";
import { URGENCY_STYLE } from "@/lib/ui";
import { URGENCY_LABEL, Urgency } from "@/lib/types";

type EditableJob = ParseResult["jobs"][number] & { include: boolean };

const SAMPLE = `相談室くわん
宮良 哲美 様

いつも大変お世話になっております。
本日ご連絡しましたのは下記内容でございます。

231・233・308・322・338号室
以上5居室の件ですが、至急原状回復掃除をお願いしたくご連絡致しました。

【時期】
338号室→至急※入居が既に決まっています
233・308・322号室→９月中にお願いします
231号室→なるべく早めにご対応頂けると幸いです

【清掃内容】
231・233・308・322号室→通常の清掃のみ
338号室→プラス剥離

時間が短く申し訳ございませんが、何卒よろしくお願い申し上げます。`;

export default function IntakePage() {
  const [raw, setRaw] = useState("");
  const [client, setClient] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [jobs, setJobs] = useState<EditableJob[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const analyze = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw }),
      });
      if (!res.ok) {
        const error = (await res.json()) as { error?: string };
        setResult(error.error ?? "解析に失敗しました");
        return;
      }
      const parsed = (await res.json()) as ParseResult;
      setClient(parsed.client);
      setWarnings(parsed.warnings);
      setJobs(parsed.jobs.map((job) => ({ ...job, include: true })));
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    if (!jobs) return;
    setBusy(true);
    try {
      const selected = jobs.filter((job) => job.include);
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: raw,
          client,
          parsed: { client, contactPerson: "", warnings: [], jobs: selected },
        }),
      });
      const body = (await res.json()) as {
        created?: { room: string }[];
        skipped?: { room: string; reason: string }[];
        error?: string;
      };
      if (!res.ok) {
        setResult(body.error ?? "登録に失敗しました");
        return;
      }
      const skippedText =
        body.skipped && body.skipped.length > 0
          ? `（重複のため除外: ${body.skipped.map((s) => `${s.room}号室`).join("・")}）`
          : "";
      setResult(`${body.created?.length ?? 0}件を登録しました${skippedText}`);
      setJobs(null);
      setRaw("");
    } finally {
      setBusy(false);
    }
  };

  const patch = (index: number, change: Partial<EditableJob>) => {
    setJobs((prev) =>
      prev ? prev.map((job, i) => (i === index ? { ...job, ...change } : job)) : prev,
    );
  };

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <AppNav />
      <h1 className="text-2xl font-bold text-slate-700 mb-1">メール取り込み</h1>
      <p className="text-sm text-slate-500 mb-6">
        依頼メールを貼り付けると、居室ごとの案件に分解します。内容を直してから登録してください。
      </p>

      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="依頼メールの本文を貼り付け"
        rows={14}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-700 outline-none focus:border-violet-300"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={analyze}
          disabled={busy || !raw.trim()}
          className="px-5 py-2.5 rounded-full bg-violet-500 text-white text-sm font-medium disabled:opacity-40 hover:bg-violet-600 transition-colors"
        >
          解析する
        </button>
        <button
          onClick={() => setRaw(SAMPLE)}
          className="px-4 py-2.5 rounded-full border border-slate-200 bg-white text-sm text-slate-500 hover:border-violet-300"
        >
          サンプルを入れる
        </button>
        {result && <span className="text-sm text-emerald-600">{result}</span>}
      </div>

      {warnings.length > 0 && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-700 mb-1">確認してください</p>
          <ul className="text-sm text-amber-700 space-y-0.5">
            {warnings.map((warning) => (
              <li key={warning}>・{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {jobs && (
        <section className="mt-6">
          <label className="block text-sm text-slate-500 mb-1">依頼元</label>
          <input
            value={client}
            onChange={(e) => setClient(e.target.value)}
            className="w-full sm:w-80 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-300"
          />

          <div className="mt-4 space-y-3">
            {jobs.map((job, index) => (
              <div
                key={job.room}
                className={`rounded-2xl border bg-white px-4 py-3 ${
                  job.include ? "border-slate-200" : "border-slate-100 opacity-50"
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="checkbox"
                    checked={job.include}
                    onChange={(e) => patch(index, { include: e.target.checked })}
                    className="w-4 h-4 accent-violet-500"
                    aria-label={`${job.room}号室を登録する`}
                  />
                  <span className="text-lg font-bold text-slate-700 w-24">
                    {job.room}号室
                  </span>
                  <select
                    value={job.urgency}
                    onChange={(e) => patch(index, { urgency: e.target.value as Urgency })}
                    className={`rounded-full border px-3 py-1 text-xs ${URGENCY_STYLE[job.urgency].chip}`}
                  >
                    {(Object.keys(URGENCY_LABEL) as Urgency[]).map((key) => (
                      <option key={key} value={key}>
                        {URGENCY_LABEL[key]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={job.dueDate ?? ""}
                    onChange={(e) => patch(index, { dueDate: e.target.value || null })}
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
                  />
                  <input
                    value={job.workTypes.join("・")}
                    onChange={(e) =>
                      patch(index, {
                        workTypes: e.target.value
                          .split(/[・,、]/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="清掃内容"
                    className="flex-1 min-w-[12rem] rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 outline-none focus:border-violet-300"
                  />
                </div>
                {(job.dueDateText || job.notes) && (
                  <p className="mt-2 text-xs text-slate-400">
                    原文: {job.dueDateText}
                    {job.notes ? ` / ${job.notes}` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={register}
            disabled={busy || jobs.every((job) => !job.include)}
            className="mt-5 px-6 py-2.5 rounded-full bg-emerald-500 text-white text-sm font-medium disabled:opacity-40 hover:bg-emerald-600 transition-colors"
          >
            {jobs.filter((job) => job.include).length}件を登録してLINEに通知
          </button>
        </section>
      )}
    </main>
  );
}
