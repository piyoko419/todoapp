import { describe, expect, test } from "bun:test";
import {
  formatMonth,
  groupByDate,
  monthGrid,
  monthKey,
  placeJob,
  shiftMonth,
  withoutDate,
} from "./calendar";
import { Job } from "./types";

function job(over: Partial<Job>): Job {
  return {
    id: "j1",
    client: "相談室くわん",
    property: "相談室くわん",
    room: "338",
    workTypes: ["通常清掃"],
    urgency: "normal",
    dueDate: "2026-09-30",
    dueDateText: "",
    scheduledDate: null,
    status: "pending",
    assigneeId: null,
    completedAt: null,
    billedItems: [],
    amount: null,
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

describe("monthKey / shiftMonth", () => {
  test("月キーを作る", () => {
    expect(monthKey(new Date(2026, 8, 22))).toBe("2026-09");
  });
  test("翌月に進む", () => {
    expect(shiftMonth("2026-09", 1)).toBe("2026-10");
  });
  test("年をまたいで進む", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
  test("年をまたいで戻る", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  test("表示用に整える", () => {
    expect(formatMonth("2026-09")).toBe("2026年9月");
  });
});

describe("monthGrid", () => {
  const grid = monthGrid("2026-09", "2026-09-22");

  test("日曜始まりで週単位に揃う", () => {
    expect(grid.length % 7).toBe(0);
    expect(grid[0].weekday).toBe(0);
    expect(grid[grid.length - 1].weekday).toBe(6);
  });

  test("月初の前に前月の日を足す", () => {
    // 2026-09-01 は火曜なので、8/30(日)・8/31(月) が前に付く
    expect(grid[0].date).toBe("2026-08-30");
    expect(grid[0].inMonth).toBe(false);
    expect(grid[2].date).toBe("2026-09-01");
    expect(grid[2].inMonth).toBe(true);
  });

  test("当月の日数がそろっている", () => {
    expect(grid.filter((c) => c.inMonth)).toHaveLength(30);
  });

  test("今日に印が付く", () => {
    const today = grid.filter((c) => c.isToday);
    expect(today).toHaveLength(1);
    expect(today[0].date).toBe("2026-09-22");
  });

  test("うるう年の2月を扱える", () => {
    expect(monthGrid("2028-02", "2028-02-01").filter((c) => c.inMonth)).toHaveLength(29);
  });

  test("平年の2月を扱える", () => {
    expect(monthGrid("2026-02", "2026-02-01").filter((c) => c.inMonth)).toHaveLength(28);
  });
});

describe("placeJob", () => {
  test("実施予定日があればそれを使う", () => {
    expect(placeJob(job({ scheduledDate: "2026-09-24" }))).toEqual({
      date: "2026-09-24",
      kind: "scheduled",
    });
  });
  test("実施予定日が無ければ期限に仮置きする", () => {
    expect(placeJob(job({ scheduledDate: null, dueDate: "2026-09-30" }))).toEqual({
      date: "2026-09-30",
      kind: "due",
    });
  });
  test("どちらも無ければ置かない", () => {
    expect(placeJob(job({ scheduledDate: null, dueDate: null }))).toBeNull();
  });
});

describe("groupByDate", () => {
  test("同じ日の案件をまとめる", () => {
    const grouped = groupByDate([
      job({ id: "a", room: "338", scheduledDate: "2026-09-24" }),
      job({ id: "b", room: "231", scheduledDate: "2026-09-24" }),
      job({ id: "c", room: "101", scheduledDate: "2026-09-25" }),
    ]);
    expect(grouped.get("2026-09-24")).toHaveLength(2);
    expect(grouped.get("2026-09-25")).toHaveLength(1);
  });

  test("同じ日では実施予定が期限より先に並ぶ", () => {
    const grouped = groupByDate([
      job({ id: "a", room: "999", scheduledDate: null, dueDate: "2026-09-24" }),
      job({ id: "b", room: "111", scheduledDate: "2026-09-24" }),
    ]);
    expect(grouped.get("2026-09-24")!.map((p) => p.kind)).toEqual(["scheduled", "due"]);
  });
});

describe("withoutDate", () => {
  test("予定も期限も無い案件を拾う", () => {
    const jobs = [
      job({ id: "a" }),
      job({ id: "b", dueDate: null, scheduledDate: null }),
    ];
    expect(withoutDate(jobs).map((j) => j.id)).toEqual(["b"]);
  });
});
