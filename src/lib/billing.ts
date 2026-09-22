import { BilledItem, Job, Rate, Settings } from "./types";

/**
 * 清掃内容から明細と税抜合計を組み立てる。
 * 単価表に無い内容は 0 円の行として残す（請求書に項目として出したいため）。
 */
export function priceFor(
  workTypes: string[],
  rates: Rate[],
): { items: BilledItem[]; amount: number } {
  const items = workTypes.map((workType) => ({
    workType,
    unitPrice: rates.find((rate) => rate.workType === workType)?.unitPrice ?? 0,
  }));
  return { items, amount: items.reduce((sum, item) => sum + item.unitPrice, 0) };
}

function applyRounding(value: number, rounding: Settings["rounding"]): number {
  if (rounding === "ceil") return Math.ceil(value);
  if (rounding === "round") return Math.round(value);
  return Math.floor(value);
}

/** 税抜合計から消費税額を出す。端数処理は設定に従う。 */
export function taxOf(subtotal: number, settings: Settings): number {
  return applyRounding(subtotal * settings.taxRate, settings.rounding);
}

export type InvoiceLine = {
  jobId: string;
  completedAt: string;
  property: string;
  room: string;
  workTypes: string[];
  assigneeName: string;
  amount: number;
  invoicedAt: string | null;
};

export type InvoiceGroup = {
  /** 依頼元 + 対象月。請求書 1 通に対応する。 */
  key: string;
  client: string;
  /** YYYY-MM */
  month: string;
  lines: InvoiceLine[];
  subtotal: number;
  tax: number;
  total: number;
  /** 全明細が請求済みなら true。 */
  invoiced: boolean;
};

/** 月締めの対象になる案件か。完了していて、金額が確定しているもの。 */
export function isBillable(job: Job): boolean {
  return job.status === "done" && job.completedAt !== null;
}

/**
 * 完了案件を「依頼元 × 完了月」でまとめる。新しい月が先に並ぶ。
 */
export function groupInvoices(
  jobs: Job[],
  settings: Settings,
  staffName: (id: string | null) => string,
): InvoiceGroup[] {
  const groups = new Map<string, InvoiceGroup>();

  for (const job of jobs) {
    if (!isBillable(job)) continue;
    const month = job.completedAt!.slice(0, 7);
    const key = `${job.client}\u0000${month}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        client: job.client,
        month,
        lines: [],
        subtotal: 0,
        tax: 0,
        total: 0,
        invoiced: true,
      };
      groups.set(key, group);
    }
    group.lines.push({
      jobId: job.id,
      completedAt: job.completedAt!,
      property: job.property,
      room: job.room,
      workTypes: job.workTypes,
      assigneeName: staffName(job.assigneeId),
      amount: job.amount ?? 0,
      invoicedAt: job.invoicedAt,
    });
  }

  for (const group of groups.values()) {
    group.lines.sort((a, b) =>
      a.completedAt === b.completedAt
        ? a.room.localeCompare(b.room)
        : a.completedAt < b.completedAt
          ? -1
          : 1,
    );
    group.subtotal = group.lines.reduce((sum, line) => sum + line.amount, 0);
    group.tax = taxOf(group.subtotal, settings);
    group.total = group.subtotal + group.tax;
    group.invoiced = group.lines.every((line) => line.invoicedAt !== null);
  }

  return [...groups.values()].sort((a, b) =>
    a.month === b.month ? a.client.localeCompare(b.client) : a.month < b.month ? 1 : -1,
  );
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Excel で開ける CSV を作る。先頭の BOM が無いと日本語が文字化けする。
 */
export function toCsv(groups: InvoiceGroup[]): string {
  const header = [
    "請求月",
    "依頼元",
    "完了日",
    "物件",
    "部屋番号",
    "清掃内容",
    "担当者",
    "金額(税抜)",
    "請求状況",
  ];
  const rows = groups.flatMap((group) =>
    group.lines.map((line) => [
      group.month,
      group.client,
      line.completedAt,
      line.property,
      `${line.room}号室`,
      line.workTypes.join("・"),
      line.assigneeName,
      line.amount,
      line.invoicedAt ? "請求済" : "未請求",
    ]),
  );
  const body = [header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  return `﻿${body}\r\n`;
}

export function formatYen(value: number): string {
  return `¥${value.toLocaleString("ja-JP")}`;
}
