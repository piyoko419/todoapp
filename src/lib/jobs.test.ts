import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const TMP = path.join(os.tmpdir(), `cleaning-test-${process.pid}`);
process.env.DATA_DIR = TMP;

const { addJob, canTransition, compareJobs, createJobsFromParse, listJobs, updateJob, upsertStaff } =
  await import("./jobs");
const { resetCache } = await import("./store");
const { parseRequestEmail } = await import("./parser");

beforeEach(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
  resetCache();
});

afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
});

const NOW = new Date(2026, 8, 19);

describe("canTransition", () => {
  test("順路どおりは通る", () => {
    expect(canTransition("pending", "assigned")).toBe(true);
    expect(canTransition("in_progress", "done")).toBe(true);
  });
  test("飛び越しは拒否する", () => {
    expect(canTransition("pending", "done")).toBe(false);
    expect(canTransition("done", "pending")).toBe(false);
  });
});

describe("createJobsFromParse", () => {
  const email = `○○管理
101・102号室
【時期】
101号室→至急
102号室→10月中
【清掃内容】
101・102号室→通常清掃`;

  test("解析結果を案件として保存する", async () => {
    const parsed = parseRequestEmail(email, NOW);
    const { created } = await createJobsFromParse(parsed, {
      source: "email",
      rawText: email,
    });
    expect(created).toHaveLength(2);
    expect(created.every((j) => j.status === "pending")).toBe(true);
    expect(created[0].client).toBe("○○管理");
  });

  test("同じ依頼元・同じ部屋の未完了案件は重複として飛ばす", async () => {
    const parsed = parseRequestEmail(email, NOW);
    await createJobsFromParse(parsed, { source: "email", rawText: email });
    const second = await createJobsFromParse(parsed, { source: "email", rawText: email });
    expect(second.created).toHaveLength(0);
    expect(second.skipped.map((s) => s.room)).toEqual(["101", "102"]);
  });

  test("完了済みなら同じ部屋を再登録できる", async () => {
    const parsed = parseRequestEmail(email, NOW);
    const { created } = await createJobsFromParse(parsed, {
      source: "email",
      rawText: email,
    });
    for (const job of created) {
      await updateJob(job.id, { status: "assigned" }, "test");
      await updateJob(job.id, { status: "accepted" }, "test");
      await updateJob(job.id, { status: "in_progress" }, "test");
      await updateJob(job.id, { status: "done" }, "test");
    }
    const again = await createJobsFromParse(parsed, { source: "email", rawText: email });
    expect(again.created).toHaveLength(2);
  });
});

describe("updateJob", () => {
  test("担当を付けると自動で割当済になる", async () => {
    const staff = await upsertStaff({ name: "山田" });
    const job = await addJob({
      room: "201",
      client: "テスト管理",
      workTypes: ["通常清掃"],
      urgency: "normal",
      dueDate: null,
      dueDateText: "",
      notes: "",
      source: "manual",
    });
    const updated = await updateJob(job.id, { assigneeId: staff.id }, "test");
    expect(updated.status).toBe("assigned");
    expect(updated.history.some((h) => h.text.includes("山田"))).toBe(true);
  });

  test("禁止された遷移はエラーになる", async () => {
    const job = await addJob({
      room: "202",
      client: "テスト管理",
      workTypes: [],
      urgency: "normal",
      dueDate: null,
      dueDateText: "",
      notes: "",
      source: "manual",
    });
    await expect(updateJob(job.id, { status: "done" }, "test")).rejects.toThrow(
      "pending から done",
    );
  });

  test("保存した内容は読み直せる", async () => {
    const job = await addJob({
      room: "203",
      client: "テスト管理",
      workTypes: ["剥離"],
      urgency: "urgent",
      dueDate: "2026-09-22",
      dueDateText: "至急",
      notes: "",
      source: "manual",
    });
    resetCache();
    const jobs = await listJobs();
    expect(jobs.find((j) => j.id === job.id)?.workTypes).toEqual(["剥離"]);
  });
});

describe("compareJobs", () => {
  test("緊急度が先、その中では期限が早い順", async () => {
    const base = {
      client: "c",
      property: "c",
      workTypes: [],
      dueDateText: "",
      scheduledDate: null,
      status: "pending" as const,
      assigneeId: null,
      notes: "",
      source: "manual" as const,
      batchId: null,
      createdAt: "",
      updatedAt: "",
      history: [],
    };
    const jobs = [
      { ...base, id: "a", room: "101", urgency: "normal" as const, dueDate: "2026-09-20" },
      { ...base, id: "b", room: "102", urgency: "urgent" as const, dueDate: "2026-09-30" },
      { ...base, id: "c", room: "103", urgency: "urgent" as const, dueDate: "2026-09-21" },
    ];
    expect(jobs.sort(compareJobs).map((j) => j.id)).toEqual(["c", "b", "a"]);
  });
});
