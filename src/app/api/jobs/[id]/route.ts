import { NextRequest, NextResponse } from "next/server";
import { JobPatch, getJob, updateJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  return NextResponse.json({ job });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const patch = (await request.json()) as JobPatch;
  try {
    const job = await updateJob(id, patch, "web");
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新に失敗しました";
    const status = message.includes("見つかりません") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
