import { newId } from "./id";
import { ParsedJob, ParseResult } from "./parser";
import { read, write } from "./store";
import { Job, JobSource, JobStatus, Rate, Settings, Staff, isOpen, urgencyRank } from "./types";
import { priceFor } from "./billing";
import { toISODate } from "./date";

/** 状態遷移の許可表。ここに無い遷移は拒否する。 */
const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  pending: ["assigned", "cancelled"],
  assigned: ["accepted", "pending", "cancelled"],
  accepted: ["in_progress", "assigned", "cancelled"],
  in_progress: ["done", "accepted", "cancelled"],
  done: ["in_progress"],
  cancelled: ["pending"],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

function touch(job: Job, actor: string, text: string): void {
  job.updatedAt = new Date().toISOString();
  job.history.push({ at: job.updatedAt, actor, text });
}

export type NewJobInput = ParsedJob & {
  client: string;
  property?: string;
  source: JobSource;
  batchId?: string | null;
};

function buildJob(input: NewJobInput): Job {
  const now = new Date().toISOString();
  return {
    id: newId("job"),
    client: input.client,
    property: input.property || input.client,
    room: input.room,
    workTypes: input.workTypes,
    urgency: input.urgency,
    dueDate: input.dueDate,
    dueDateText: input.dueDateText,
    scheduledDate: null,
    status: "pending",
    assigneeId: null,
    notes: input.notes,
    source: input.source,
    batchId: input.batchId ?? null,
    completedAt: null,
    billedItems: [],
    amount: null,
    invoicedAt: null,
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, actor: "system", text: "案件を登録しました" }],
  };
}

/**
 * 解析結果をまとめて案件登録する。
 * 同じ依頼元・同じ部屋の未完了案件が既にあれば重複とみなして飛ばす。
 */
export async function createJobsFromParse(
  parsed: ParseResult,
  options: { source: JobSource; rawText: string; clientOverride?: string },
): Promise<{ created: Job[]; skipped: { room: string; reason: string }[] }> {
  const client = options.clientOverride || parsed.client || "不明な依頼元";
  const batchId = newId("batch");

  return write((db) => {
    const created: Job[] = [];
    const skipped: { room: string; reason: string }[] = [];

    for (const job of parsed.jobs) {
      const duplicate = db.jobs.find(
        (existing) =>
          existing.client === client && existing.room === job.room && isOpen(existing),
      );
      if (duplicate) {
        skipped.push({ room: job.room, reason: "同じ部屋の未完了案件が既にあります" });
        continue;
      }
      const record = buildJob({ ...job, client, source: options.source, batchId });
      db.jobs.push(record);
      created.push(record);
    }

    db.intakes.push({
      id: newId("intake"),
      receivedAt: new Date().toISOString(),
      client,
      rawText: options.rawText,
      jobIds: created.map((j) => j.id),
    });

    return { created, skipped };
  });
}

export async function addJob(input: NewJobInput): Promise<Job> {
  return write((db) => {
    const job = buildJob(input);
    db.jobs.push(job);
    return job;
  });
}

/** 急ぎ順・期限順に並べた案件一覧。 */
export async function listJobs(filter?: { openOnly?: boolean; assigneeId?: string }) {
  return read((db) => {
    let jobs = [...db.jobs];
    if (filter?.openOnly) jobs = jobs.filter(isOpen);
    if (filter?.assigneeId) jobs = jobs.filter((j) => j.assigneeId === filter.assigneeId);
    return jobs.sort(compareJobs);
  });
}

export function compareJobs(a: Job, b: Job): number {
  const byUrgency = urgencyRank(b.urgency) - urgencyRank(a.urgency);
  if (byUrgency !== 0) return byUrgency;
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  return a.room.localeCompare(b.room);
}

export async function getJob(id: string): Promise<Job | undefined> {
  return read((db) => db.jobs.find((j) => j.id === id));
}

export type JobPatch = {
  status?: JobStatus;
  assigneeId?: string | null;
  scheduledDate?: string | null;
  notes?: string;
  workTypes?: string[];
  dueDate?: string | null;
  /** 請求額（税抜）の手直し。 */
  amount?: number | null;
  completedAt?: string | null;
};

/** 案件を更新する。禁止された状態遷移は Error にする。 */
export async function updateJob(
  id: string,
  patch: JobPatch,
  actor: string,
): Promise<Job> {
  return write((db) => {
    const job = db.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`案件が見つかりません: ${id}`);

    if (patch.status && patch.status !== job.status) {
      if (!canTransition(job.status, patch.status)) {
        throw new Error(`${job.status} から ${patch.status} には変更できません`);
      }
      const from = job.status;
      job.status = patch.status;
      touch(job, actor, `状態を ${from} → ${patch.status} に変更`);

      if (patch.status === "done") {
        // 完了した時点の単価を写し取る。以後、単価表を変えても請求額は動かない。
        job.completedAt ??= toISODate(new Date());
        if (job.amount === null) {
          const { items, amount } = priceFor(job.workTypes, db.rates);
          job.billedItems = items;
          job.amount = amount;
          touch(job, actor, `請求額を ${amount} 円（税抜）で確定`);
        }
      }
    }
    if (patch.assigneeId !== undefined && patch.assigneeId !== job.assigneeId) {
      job.assigneeId = patch.assigneeId;
      const name = patch.assigneeId
        ? (db.staff.find((s) => s.id === patch.assigneeId)?.name ?? patch.assigneeId)
        : "未割当";
      touch(job, actor, `担当を ${name} に変更`);
      // 担当を付けたら pending のままにしない。
      if (patch.assigneeId && job.status === "pending" && !patch.status) {
        job.status = "assigned";
      }
    }
    if (patch.scheduledDate !== undefined && patch.scheduledDate !== job.scheduledDate) {
      job.scheduledDate = patch.scheduledDate;
      touch(job, actor, `実施予定日を ${patch.scheduledDate ?? "未定"} に変更`);
    }
    if (patch.dueDate !== undefined) job.dueDate = patch.dueDate;
    if (patch.completedAt !== undefined) job.completedAt = patch.completedAt;
    if (patch.amount !== undefined && patch.amount !== job.amount) {
      const before = job.amount;
      job.amount = patch.amount;
      touch(job, actor, `請求額を ${before ?? "未設定"} → ${patch.amount ?? "未設定"} 円に変更`);
    }
    if (patch.notes !== undefined) job.notes = patch.notes;
    if (patch.workTypes !== undefined) job.workTypes = patch.workTypes;
    job.updatedAt = new Date().toISOString();
    return job;
  });
}

export async function listStaff(): Promise<Staff[]> {
  return read((db) => [...db.staff]);
}

export async function findStaffByLineId(lineUserId: string): Promise<Staff | undefined> {
  return read((db) => db.staff.find((s) => s.lineUserId === lineUserId));
}

/** LINE から「スタッフ登録 名前」で呼ばれる。既に登録済みなら名前を更新する。 */
export async function upsertStaff(input: {
  name: string;
  lineUserId?: string | null;
  role?: Staff["role"];
  clientName?: string;
}): Promise<Staff> {
  return write((db) => {
    const existing = input.lineUserId
      ? db.staff.find((s) => s.lineUserId === input.lineUserId)
      : undefined;
    if (existing) {
      existing.name = input.name || existing.name;
      if (input.role) existing.role = input.role;
      if (input.clientName) existing.clientName = input.clientName;
      return existing;
    }
    const staff: Staff = {
      id: newId("stf"),
      name: input.name,
      lineUserId: input.lineUserId ?? null,
      role: input.role ?? "staff",
      clientName: input.clientName,
      createdAt: new Date().toISOString(),
    };
    db.staff.push(staff);
    return staff;
  });
}

export async function deleteStaff(id: string): Promise<void> {
  await write((db) => {
    db.staff = db.staff.filter((s) => s.id !== id);
    for (const job of db.jobs) {
      if (job.assigneeId === id) job.assigneeId = null;
    }
  });
}

export async function listRates(): Promise<Rate[]> {
  return read((db) => [...db.rates]);
}

/** 単価表をまるごと置き換える。すでに完了した案件の請求額には影響しない。 */
export async function saveRates(rates: Rate[]): Promise<Rate[]> {
  return write((db) => {
    db.rates = rates
      .filter((rate) => rate.workType.trim().length > 0)
      .map((rate) => ({
        workType: rate.workType.trim(),
        unitPrice: Math.max(0, Math.round(rate.unitPrice) || 0),
      }));
    return db.rates;
  });
}

export async function getSettings(): Promise<Settings> {
  return read((db) => ({ ...db.settings }));
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  return write((db) => {
    db.settings = { ...db.settings, ...patch };
    return { ...db.settings };
  });
}

/** 指定した案件をまとめて請求済みにする。すでに請求済みのものは変えない。 */
export async function markInvoiced(
  jobIds: string[],
  invoiced: boolean,
): Promise<number> {
  return write((db) => {
    const stamp = new Date().toISOString();
    let changed = 0;
    for (const job of db.jobs) {
      if (!jobIds.includes(job.id)) continue;
      const next = invoiced ? stamp : null;
      if ((job.invoicedAt === null) === (next === null)) continue;
      job.invoicedAt = next;
      touch(job, "web", invoiced ? "請求済みにしました" : "未請求に戻しました");
      changed += 1;
    }
    return changed;
  });
}
