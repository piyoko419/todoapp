import { NextRequest, NextResponse } from "next/server";
import { addJob, createJobsFromParse, listJobs } from "@/lib/jobs";
import { notifyNewJobs } from "@/lib/line/notify";
import { ParseResult, parseRequestEmail } from "@/lib/parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const openOnly = request.nextUrl.searchParams.get("open") === "1";
  return NextResponse.json({ jobs: await listJobs({ openOnly }) });
}

type CreateBody = {
  /** 依頼メール本文。解析してまとめて登録する。 */
  text?: string;
  /** 解析結果を画面で直してから送り返す場合はこちら。 */
  parsed?: ParseResult;
  client?: string;
  /** 1 件だけ手入力するとき。 */
  job?: {
    room: string;
    client: string;
    workTypes?: string[];
    urgency?: "urgent" | "high" | "normal" | "low";
    dueDate?: string | null;
    notes?: string;
  };
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CreateBody;

  if (body.job) {
    const job = await addJob({
      room: body.job.room,
      client: body.job.client,
      workTypes: body.job.workTypes ?? [],
      urgency: body.job.urgency ?? "normal",
      dueDate: body.job.dueDate ?? null,
      dueDateText: "",
      notes: body.job.notes ?? "",
      source: "manual",
    });
    return NextResponse.json({ created: [job], skipped: [] }, { status: 201 });
  }

  const parsed = body.parsed ?? (body.text ? parseRequestEmail(body.text) : null);
  if (!parsed) {
    return NextResponse.json({ error: "text か parsed が必要です" }, { status: 400 });
  }

  const result = await createJobsFromParse(parsed, {
    source: "email",
    rawText: body.text ?? "",
    clientOverride: body.client,
  });

  // LINE 未設定なら中で何もせず戻る。通知失敗で登録まで巻き戻さない。
  try {
    await notifyNewJobs(body.client || parsed.client, result.created);
  } catch (error) {
    console.error("[line] 新規案件の通知に失敗", error);
  }

  return NextResponse.json(result, { status: 201 });
}
