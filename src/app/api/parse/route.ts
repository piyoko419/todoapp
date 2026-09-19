import { NextRequest, NextResponse } from "next/server";
import { parseRequestEmail } from "@/lib/parser";

export const runtime = "nodejs";

/** 依頼メールを解析するだけ。登録はしない（取り込み画面のプレビュー用）。 */
export async function POST(request: NextRequest) {
  const { text } = (await request.json()) as { text?: string };
  if (!text || !text.trim()) {
    return NextResponse.json({ error: "本文が空です" }, { status: 400 });
  }
  return NextResponse.json(parseRequestEmail(text));
}
