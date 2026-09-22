import { toISODate } from "../date";
import {
  createJobsFromParse,
  findStaffByLineId,
  getJob,
  listJobs,
  updateJob,
  upsertStaff,
} from "../jobs";
import { parseRequestEmail } from "../parser";
import { Job, STATUS_LABEL, Staff } from "../types";
import { reply } from "./client";
import { HELP_TEXT, jobCarousel, jobCard, text } from "./messages";
import { notifyCompletion, notifyNewJobs } from "./notify";

export type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string; groupId?: string; type?: string };
  message?: { type: string; text?: string };
  postback?: { data: string };
};

const REGISTER_STAFF = /^(?:スタッフ登録|登録)\s*[:：]?\s*(.+)$/;
const REGISTER_CLIENT = /^(?:依頼元登録|クライアント登録)\s*[:：]?\s*(.+)$/;

export async function handleEvents(events: LineEvent[]): Promise<void> {
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (error) {
      console.error("[line] イベント処理に失敗", error);
      if (event.replyToken) {
        await reply(event.replyToken, [
          text("処理中にエラーが発生しました。管理画面から確認してください。"),
        ]);
      }
    }
  }
}

async function handleEvent(event: LineEvent): Promise<void> {
  if (event.type === "follow" && event.replyToken) {
    await reply(event.replyToken, [text(HELP_TEXT)]);
    return;
  }
  if (event.type === "message" && event.message?.type === "text") {
    await handleText(event, event.message.text ?? "");
    return;
  }
  if (event.type === "postback" && event.postback) {
    await handlePostback(event, event.postback.data);
  }
}

async function handleText(event: LineEvent, body: string): Promise<void> {
  const replyToken = event.replyToken;
  const userId = event.source?.userId;
  if (!replyToken || !userId) return;
  const message = body.trim();

  const staffMatch = message.match(REGISTER_STAFF);
  if (staffMatch) {
    // role を明示しないと、依頼元になった人をスタッフに戻せない。
    const staff = await upsertStaff({
      name: staffMatch[1].trim(),
      lineUserId: userId,
      role: "staff",
    });
    await reply(replyToken, [
      text(`${staff.name} さんをスタッフとして登録しました。\n「一覧」で未完了の案件を確認できます。`),
    ]);
    return;
  }

  const clientMatch = message.match(REGISTER_CLIENT);
  if (clientMatch) {
    const name = clientMatch[1].trim();
    await upsertStaff({ name, lineUserId: userId, role: "client", clientName: name });
    await reply(replyToken, [
      text(`${name} 様を依頼元として登録しました。\n依頼内容をそのまま送信してください。部屋番号・時期・清掃内容を読み取って受付します。`),
    ]);
    return;
  }

  const sender = await findStaffByLineId(userId);
  if (!sender) {
    await reply(replyToken, [
      text("はじめまして。まず登録をお願いします。\n\n" + HELP_TEXT),
    ]);
    return;
  }

  if (sender.role === "client") {
    await handleClientMessage(replyToken, sender, message);
    return;
  }
  await handleStaffCommand(replyToken, sender, message);
}

/** 依頼元から届いたメッセージを、依頼文として解析して受け付ける。 */
async function handleClientMessage(
  replyToken: string,
  sender: Staff,
  message: string,
): Promise<void> {
  if (!/号室|部屋|室/.test(message)) {
    await reply(replyToken, [
      text(
        [
          `【依頼元: ${sender.clientName || sender.name}】として登録されています。`,
          "",
          "ご依頼は、部屋番号と時期・清掃内容を含めて送信してください。",
          "例）231・233号室",
          "【時期】9月中",
          "【清掃内容】通常清掃",
        ].join("\n"),
      ),
    ]);
    return;
  }

  const clientName = sender.clientName || sender.name;
  const parsed = parseRequestEmail(message);
  if (parsed.jobs.length === 0) {
    await reply(replyToken, [
      text("部屋番号を読み取れませんでした。「231号室」のように番号を含めて送信してください。"),
    ]);
    return;
  }

  const { created, skipped } = await createJobsFromParse(parsed, {
    source: "line",
    rawText: message,
    clientOverride: clientName,
  });

  const lines = [`ご依頼を受け付けました（${created.length}件）。`];
  for (const job of created) {
    lines.push(
      `・${job.room}号室 ${job.workTypes.join("・") || "内容未定"} / ${job.dueDate ?? "期限未定"}`,
    );
  }
  if (skipped.length > 0) {
    lines.push("", "※ 受付済みのため除外:");
    for (const s of skipped) lines.push(`・${s.room}号室（${s.reason}）`);
  }
  if (parsed.warnings.length > 0) {
    lines.push("", "※ 確認事項:", ...parsed.warnings.map((w) => `・${w}`));
  }

  await reply(replyToken, [text(lines.join("\n"))]);
  await notifyNewJobs(clientName, created);
}

async function handleStaffCommand(
  replyToken: string,
  sender: Staff,
  message: string,
): Promise<void> {
  if (/^(一覧|案件|リスト)$/.test(message)) {
    const jobs = await listJobs({ openOnly: true });
    await replyJobs(replyToken, jobs, "未完了の案件はありません。", "未完了の案件");
    return;
  }
  if (/^(今日|本日)$/.test(message)) {
    const today = toISODate(new Date());
    const jobs = (await listJobs({ openOnly: true })).filter(
      (job) => job.scheduledDate === today || job.dueDate === today,
    );
    await replyJobs(replyToken, jobs, "本日の案件はありません。", "本日の案件");
    return;
  }
  if (/^(担当|自分|マイ)/.test(message)) {
    const jobs = (await listJobs({ openOnly: true })).filter(
      (job) => job.assigneeId === sender.id,
    );
    await replyJobs(replyToken, jobs, "担当の案件はありません。", "担当の案件");
    return;
  }
  // 依頼文らしきものをスタッフが送ってきたら、登録の行き違いを疑って案内する。
  if (looksLikeRequest(message)) {
    await reply(replyToken, [
      text(
        [
          `この LINE アカウントは【スタッフ: ${sender.name}】として登録されています。`,
          "スタッフからの送信は依頼として受け付けません。",
          "",
          "依頼元としてお使いになる場合は、次を送って切り替えてください。",
          "　依頼元登録 会社名",
          "",
          "スタッフに戻すときは「スタッフ登録 お名前」を送ります。",
        ].join("\n"),
      ),
    ]);
    return;
  }

  await reply(replyToken, [
    text(`【スタッフ: ${sender.name}】として登録されています。\n\n${HELP_TEXT}`),
  ]);
}

/** 部屋番号を含む、ある程度の長さの本文を依頼文とみなす。 */
function looksLikeRequest(message: string): boolean {
  return /号室/.test(message) && message.length >= 10;
}

async function replyJobs(
  replyToken: string,
  jobs: Job[],
  emptyText: string,
  title: string,
): Promise<void> {
  if (jobs.length === 0) {
    await reply(replyToken, [text(emptyText)]);
    return;
  }
  await reply(replyToken, [
    text(`${title}（${jobs.length}件）`),
    jobCarousel(jobs, `${title} ${jobs.length}件`),
  ]);
}

async function handlePostback(event: LineEvent, data: string): Promise<void> {
  const replyToken = event.replyToken;
  const userId = event.source?.userId;
  if (!replyToken || !userId) return;

  const sender = await findStaffByLineId(userId);
  if (!sender || sender.role === "client") {
    await reply(replyToken, [text("スタッフ登録が必要です。「スタッフ登録 名前」と送信してください。")]);
    return;
  }

  const params = new URLSearchParams(data);
  const action = params.get("action");
  const jobId = params.get("jobId");
  if (!action || !jobId) return;

  const job = await getJob(jobId);
  if (!job) {
    await reply(replyToken, [text("案件が見つかりませんでした。")]);
    return;
  }

  const actor = `staff:${sender.id}`;
  let updated = job;

  switch (action) {
    case "claim":
      // 未割当の案件を自分のものにして、そのまま受諾状態にする。
      updated = await updateJob(jobId, { assigneeId: sender.id }, actor);
      updated = await updateJob(jobId, { status: "accepted" }, actor);
      break;
    case "accept":
      if (!job.assigneeId) await updateJob(jobId, { assigneeId: sender.id }, actor);
      updated = await updateJob(jobId, { status: "accepted" }, actor);
      break;
    case "start":
      updated = await updateJob(jobId, { status: "in_progress" }, actor);
      break;
    case "done":
      updated = await updateJob(jobId, { status: "done" }, actor);
      await notifyCompletion(updated, sender.name);
      break;
    default:
      return;
  }

  await reply(replyToken, [
    text(`${updated.room}号室を「${STATUS_LABEL[updated.status]}」に更新しました。`),
    jobCard(updated, sender.name),
  ]);
}
