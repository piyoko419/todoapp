import { describe, expect, test } from "bun:test";
import { groupInvoices, priceFor, taxOf, toCsv } from "./billing";
import { DEFAULT_SETTINGS, Job, Rate, Settings } from "./types";

const RATES: Rate[] = [
  { workType: "通常清掃", unitPrice: 30000 },
  { workType: "剥離", unitPrice: 15000 },
  { workType: "原状回復", unitPrice: 0 },
];

function job(over: Partial<Job>): Job {
  return {
    id: "j1",
    client: "相談室くわん",
    property: "相談室くわん",
    room: "338",
    workTypes: ["通常清掃"],
    urgency: "normal",
    dueDate: null,
    dueDateText: "",
    scheduledDate: null,
    status: "done",
    assigneeId: "stf_1",
    completedAt: "2026-09-22",
    billedItems: [],
    amount: 30000,
    invoicedAt: null,
    notes: "",
    source: "email",
    batchId: null,
    createdAt: "",
    updatedAt: "",
    history: [],
    ...over,
  };
}

const NAME = (id: string | null) => (id === "stf_1" ? "山田太郎" : "未割当");

describe("priceFor", () => {
  test("清掃内容の単価を足し合わせる", () => {
    const r = priceFor(["通常清掃", "剥離"], RATES);
    expect(r.amount).toBe(45000);
    expect(r.items).toEqual([
      { workType: "通常清掃", unitPrice: 30000 },
      { workType: "剥離", unitPrice: 15000 },
    ]);
  });

  test("単価表に無い内容は 0 円の明細として残す", () => {
    const r = priceFor(["通常清掃", "未登録の作業"], RATES);
    expect(r.amount).toBe(30000);
    expect(r.items[1]).toEqual({ workType: "未登録の作業", unitPrice: 0 });
  });

  test("単価 0 の内容は金額を増やさない", () => {
    expect(priceFor(["通常清掃", "原状回復"], RATES).amount).toBe(30000);
  });
});

describe("taxOf", () => {
  const base: Settings = { ...DEFAULT_SETTINGS };
  test("10% の端数を切り捨てる", () => {
    expect(taxOf(45005, base)).toBe(4500);
  });
  test("四捨五入に切り替えられる", () => {
    expect(taxOf(45005, { ...base, rounding: "round" })).toBe(4501);
  });
  test("切り上げに切り替えられる", () => {
    expect(taxOf(45001, { ...base, rounding: "ceil" })).toBe(4501);
  });
  test("税率を変えられる", () => {
    expect(taxOf(10000, { ...base, taxRate: 0.08 })).toBe(800);
  });
});

describe("groupInvoices", () => {
  const jobs = [
    job({ id: "a", room: "338", amount: 45000, completedAt: "2026-09-22" }),
    job({ id: "b", room: "231", amount: 30000, completedAt: "2026-09-30" }),
    job({ id: "c", room: "101", amount: 20000, completedAt: "2026-10-02" }),
    job({ id: "d", room: "201", amount: 25000, client: "○○管理", completedAt: "2026-09-15" }),
  ];

  test("依頼元と完了月でまとめる", () => {
    const groups = groupInvoices(jobs, DEFAULT_SETTINGS, NAME);
    expect(groups.map((g) => `${g.client}/${g.month}`)).toEqual([
      "相談室くわん/2026-10",
      "○○管理/2026-09",
      "相談室くわん/2026-09",
    ]);
  });

  test("税抜合計・消費税・税込合計を出す", () => {
    const g = groupInvoices(jobs, DEFAULT_SETTINGS, NAME).find(
      (x) => x.client === "相談室くわん" && x.month === "2026-09",
    )!;
    expect(g.subtotal).toBe(75000);
    expect(g.tax).toBe(7500);
    expect(g.total).toBe(82500);
    expect(g.lines).toHaveLength(2);
  });

  test("明細は完了日の早い順", () => {
    const g = groupInvoices(jobs, DEFAULT_SETTINGS, NAME).find(
      (x) => x.month === "2026-09" && x.client === "相談室くわん",
    )!;
    expect(g.lines.map((l) => l.room)).toEqual(["338", "231"]);
  });

  test("未完了や完了日の無い案件は含めない", () => {
    const groups = groupInvoices(
      [
        job({ id: "x", status: "in_progress", completedAt: null }),
        job({ id: "y", status: "done", completedAt: null }),
      ],
      DEFAULT_SETTINGS,
      NAME,
    );
    expect(groups).toHaveLength(0);
  });

  test("全明細が請求済みのときだけ請求済みになる", () => {
    const partly = groupInvoices(
      [
        job({ id: "a", invoicedAt: "2026-10-01T00:00:00Z" }),
        job({ id: "b", room: "231", invoicedAt: null }),
      ],
      DEFAULT_SETTINGS,
      NAME,
    );
    expect(partly[0].invoiced).toBe(false);

    const all = groupInvoices(
      [
        job({ id: "a", invoicedAt: "2026-10-01T00:00:00Z" }),
        job({ id: "b", room: "231", invoicedAt: "2026-10-01T00:00:00Z" }),
      ],
      DEFAULT_SETTINGS,
      NAME,
    );
    expect(all[0].invoiced).toBe(true);
  });

  test("担当者名を明細に入れる", () => {
    const g = groupInvoices([job({})], DEFAULT_SETTINGS, NAME)[0];
    expect(g.lines[0].assigneeName).toBe("山田太郎");
  });
});

describe("toCsv", () => {
  const csv = toCsv(groupInvoices([job({})], DEFAULT_SETTINGS, NAME));

  test("Excel 用に BOM を付ける", () => {
    expect(csv.startsWith("﻿")).toBe(true);
  });

  test("見出しと明細を出す", () => {
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe(
      "請求月,依頼元,完了日,物件,部屋番号,清掃内容,担当者,金額(税抜),請求状況",
    );
    expect(lines[1]).toBe(
      "2026-09,相談室くわん,2026-09-22,相談室くわん,338号室,通常清掃,山田太郎,30000,未請求",
    );
  });

  test("カンマを含む値を引用符で囲む", () => {
    const withComma = toCsv(
      groupInvoices([job({ property: "A棟,B棟" })], DEFAULT_SETTINGS, NAME),
    );
    expect(withComma).toContain('"A棟,B棟"');
  });
});
