import { NextRequest, NextResponse } from "next/server";
import { isConfigured, verifySignature } from "@/lib/line/client";
import { LineEvent, handleEvents } from "@/lib/line/webhook-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** LINE Developers の Webhook 検証（GET）に応答する。 */
export function GET() {
  return NextResponse.json({ ok: true, configured: isConfigured() });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();

  if (!isConfigured()) {
    console.warn("[line] チャネル未設定のため Webhook を無視しました");
    return NextResponse.json({ ok: true });
  }
  if (!verifySignature(raw, request.headers.get("x-line-signature"))) {
    return NextResponse.json({ error: "署名が不正です" }, { status: 401 });
  }

  const body = JSON.parse(raw) as { events?: LineEvent[] };
  // LINE は 1 秒以内の 200 応答を求めるが、件数が少ないので同期処理で足りる。
  await handleEvents(body.events ?? []);
  return NextResponse.json({ ok: true });
}
