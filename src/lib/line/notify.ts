import { listStaff } from "../jobs";
import { Job } from "../types";
import { broadcastToStaff, isConfigured } from "./client";
import { intakeSummary, jobCarousel, text } from "./messages";

/** 新規案件をスタッフ全員に流す。LINE 未設定なら何もしない。 */
export async function notifyNewJobs(client: string, jobs: Job[]): Promise<void> {
  if (!isConfigured() || jobs.length === 0) return;
  const staff = await listStaff();
  const ids = staff
    .filter((s) => s.role !== "client" && s.lineUserId)
    .map((s) => s.lineUserId as string);
  await broadcastToStaff(ids, [
    intakeSummary(client, jobs),
    jobCarousel(jobs, `${client} の新規依頼 ${jobs.length}件`),
  ]);
}

/** 完了報告を管理者に流す。 */
export async function notifyCompletion(job: Job, staffName: string): Promise<void> {
  if (!isConfigured()) return;
  const staff = await listStaff();
  const admins = staff
    .filter((s) => s.role === "admin" && s.lineUserId)
    .map((s) => s.lineUserId as string);
  if (admins.length === 0) return;
  await broadcastToStaff(admins, [
    text(`✅ 完了報告\n${job.property} ${job.room}号室\n担当: ${staffName}`),
  ]);
}
