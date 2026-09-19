import { newId } from "./id";
import { ParsedJob, ParseResult } from "./parser";
import { read, write } from "./store";
import { Job, JobSource, JobStatus, Staff, isOpen, urgencyRank } from "./types";

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
