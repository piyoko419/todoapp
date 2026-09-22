"use client";

import { useCallback, useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import type { InvoiceGroup } from "@/lib/billing";
import { formatYen } from "@/lib/billing";
import { Rate, Settings } from "@/lib/types";

export default function BillingPage() {
  const [groups, setGroups] = useState<InvoiceGroup[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showRates, setShowRates] = useState(false);

  const load = useCallback(async () => {
    const [billingRes, ratesRes] = await Promise.all([
      fetch("/api/billing", { cache: "no-store" }),
      fetch("/api/rates", { cache: "no-store" }),
    ]);
    const billing = (await billingRes.json()) as { groups: InvoiceGroup[] };
    const rateBody = (await ratesRes.json()) as { rates: Rate[]; settings: Settings };
    setGroups(billing.groups);
    setRates(rateBody.rates);
    setSettings(rateBody.settings);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setInvoiced = async (group: InvoiceGroup, invoiced: boolean) => {
    await fetch("/api/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobIds: group.lines.map((l) => l.jobId), invoiced }),
    });
    setMessage(
      `${group.client} ${group.month} を${invoiced ? "請求済み" : "未請求"}にしました`,
    );
    await load();
  };

  const editAmount = async (jobId: string, amount: number) => {
    await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    await load();
  };

  const persistRates = async (next: Rate[], nextSettings?: Partial<Settings>) => {
    const res = await fetch("/api/rates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rates: next, settings: nextSettings }),
    });
    const body = (await res.json()) as { rates: Rate[]; settings: Settings };
    setRates(body.rates);
    setSettings(body.settings);
    setMessage("単価表を保存しました");
    await load();
  };

  const unbilled = groups.filter((g) => !g.invoiced);
  const unbilledTotal = unbilled.reduce((sum, g) => sum + g.total, 0);

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <AppNav />
      <h1 className="text-2xl font-bold text-slate-700 mb-1">請求</h1>
      <p className="text-sm text-slate-500 mb-6">
        完了した案件を、依頼元ごと・完了月ごとにまとめています。
        金額は完了した時点の単価で確定しているので、単価表を変えても遡りません。
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
          <p className="text-xs text-slate-400">未請求の件数</p>
          <p className="mt-1 text-3xl font-bold text-violet-500">{unbilled.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
          <p className="text-xs text-slate-400">未請求の合計（税込）</p>
          <p className="mt-1 text-3xl font-bold text-slate-700">
            {formatYen(unbilledTotal)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
          <p className="text-xs text-slate-400">消費税率</p>
          <p className="mt-1 text-3xl font-bold text-slate-700">
            {settings ? `${Math.round(settings.taxRate * 100)}%` : "—"}
          </p>
        </div>
      </div>

      {message && (
        <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {message}
        </p>
      )}

      <div className="space-y-3">
        {groups.length === 0 && (
          <p className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
            完了した案件がまだありません。案件を完了にすると、ここに請求としてまとまります。
          </p>
        )}

        {groups.map((group) => {
          const expanded = open === group.key;
          return (
            <section
              key={group.key}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
            >
              <button
                onClick={() => setOpen(expanded ? null : group.key)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
              >
                <span className="font-bold text-slate-700">{group.client}</span>
                <span className="text-sm text-slate-500">{group.month} 分</span>
                <span className="text-sm text-slate-400">{group.lines.length}件</span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${
                    group.invoiced
                      ? "border-emerald-200 bg-emerald-100 text-emerald-600"
                      : "border-amber-200 bg-amber-100 text-amber-600"
                  }`}
                >
                  {group.invoiced ? "請求済" : "未請求"}
                </span>
                <span className="ml-auto text-lg font-bold text-slate-700">
                  {formatYen(group.total)}
                </span>
                <span className="text-slate-300">{expanded ? "▲" : "▼"}</span>
              </button>

              {expanded && (
                <div className="border-t border-slate-100 px-4 py-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-400">
                        <th className="pb-2 font-normal">完了日</th>
                        <th className="pb-2 font-normal">部屋</th>
                        <th className="pb-2 font-normal">清掃内容</th>
                        <th className="pb-2 font-normal">担当</th>
                        <th className="pb-2 text-right font-normal">金額（税抜）</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.lines.map((line) => (
                        <tr key={line.jobId} className="border-t border-slate-50">
                          <td className="py-2 text-slate-500">{line.completedAt}</td>
                          <td className="py-2 font-medium text-slate-700">
                            {line.room}号室
                          </td>
                          <td className="py-2 text-slate-500">
                            {line.workTypes.join("・")}
                          </td>
                          <td className="py-2 text-slate-500">{line.assigneeName}</td>
                          <td className="py-2 text-right">
                            <input
                              type="number"
                              defaultValue={line.amount}
                              onBlur={(e) => {
                                const next = Number(e.target.value);
                                if (next !== line.amount) editAmount(line.jobId, next);
                              }}
                              className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-right text-slate-700 outline-none focus:border-violet-300"
                              aria-label={`${line.room}号室の金額`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="text-slate-600">
                      <tr className="border-t border-slate-200">
                        <td colSpan={4} className="py-1.5 text-right text-xs text-slate-400">
                          小計（税抜）
                        </td>
                        <td className="py-1.5 text-right">{formatYen(group.subtotal)}</td>
                      </tr>
                      <tr>
                        <td colSpan={4} className="py-1.5 text-right text-xs text-slate-400">
                          消費税
                        </td>
                        <td className="py-1.5 text-right">{formatYen(group.tax)}</td>
                      </tr>
                      <tr>
                        <td colSpan={4} className="py-1.5 text-right text-xs text-slate-400">
                          合計（税込）
                        </td>
                        <td className="py-1.5 text-right text-lg font-bold text-slate-700">
                          {formatYen(group.total)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <a
                      href={`/api/billing/csv?month=${group.month}&client=${encodeURIComponent(group.client)}`}
                      className="rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-500 hover:border-violet-300 hover:text-violet-600"
                    >
                      この請求を CSV で出力
                    </a>
                    <button
                      onClick={() => setInvoiced(group, !group.invoiced)}
                      className={`rounded-full px-4 py-1.5 text-sm text-white ${
                        group.invoiced
                          ? "bg-slate-400 hover:bg-slate-500"
                          : "bg-emerald-500 hover:bg-emerald-600"
                      }`}
                    >
                      {group.invoiced ? "未請求に戻す" : "請求済みにする"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {groups.length > 0 && (
        <a
          href="/api/billing/csv"
          className="mt-4 inline-block rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm text-slate-500 hover:border-violet-300 hover:text-violet-600"
        >
          すべて CSV で出力
        </a>
      )}

      <section className="mt-12">
        <button
          onClick={() => setShowRates(!showRates)}
          className="text-lg font-bold text-slate-700"
        >
          単価表・設定 {showRates ? "▲" : "▼"}
        </button>
        <p className="mt-1 text-sm text-slate-500">
          ここで設定した単価が、案件を完了にした時点で請求額として確定します。
        </p>

        {showRates && settings && (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <div className="space-y-2">
              {rates.map((rate, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <input
                    value={rate.workType}
                    onChange={(e) =>
                      setRates(
                        rates.map((r, i) =>
                          i === index ? { ...r, workType: e.target.value } : r,
                        ),
                      )
                    }
                    placeholder="清掃内容"
                    className="w-48 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-violet-300"
                  />
                  <input
                    type="number"
                    value={rate.unitPrice}
                    onChange={(e) =>
                      setRates(
                        rates.map((r, i) =>
                          i === index ? { ...r, unitPrice: Number(e.target.value) } : r,
                        ),
                      )
                    }
                    className="w-32 rounded-xl border border-slate-200 px-3 py-1.5 text-right text-sm outline-none focus:border-violet-300"
                    aria-label={`${rate.workType}の単価`}
                  />
                  <span className="text-sm text-slate-400">円（税抜）</span>
                  <button
                    onClick={() => setRates(rates.filter((_, i) => i !== index))}
                    className="text-sm text-slate-300 hover:text-rose-500"
                    aria-label={`${rate.workType}を削除`}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() => setRates([...rates, { workType: "", unitPrice: 0 }])}
              className="mt-3 rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-500 hover:border-violet-300"
            >
              行を追加
            </button>

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <label className="text-sm text-slate-500">消費税率</label>
              <input
                type="number"
                value={Math.round(settings.taxRate * 100)}
                onChange={(e) =>
                  setSettings({ ...settings, taxRate: Number(e.target.value) / 100 })
                }
                className="w-20 rounded-xl border border-slate-200 px-3 py-1.5 text-right text-sm"
              />
              <span className="text-sm text-slate-400">%</span>

              <label className="ml-4 text-sm text-slate-500">端数処理</label>
              <select
                value={settings.rounding}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    rounding: e.target.value as Settings["rounding"],
                  })
                }
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
              >
                <option value="floor">切り捨て</option>
                <option value="round">四捨五入</option>
                <option value="ceil">切り上げ</option>
              </select>
            </div>

            <button
              onClick={() => persistRates(rates, settings)}
              className="mt-5 rounded-full bg-violet-500 px-6 py-2 text-sm font-medium text-white hover:bg-violet-600"
            >
              保存する
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
