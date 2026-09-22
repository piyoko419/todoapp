import { NextRequest, NextResponse } from "next/server";
import { groupInvoices } from "@/lib/billing";
import { getSettings, listJobs, listStaff, markInvoiced } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 依頼元 × 完了月でまとめた請求一覧を返す。 */
export async function GET() {
  const [jobs, staff, settings] = await Promise.all([
    listJobs(),
    listStaff(),
    getSettings(),
  ]);
  const nameOf = (id: string | null) =>
    staff.find((s) => s.id === id)?.name ?? "未割当";
  return NextResponse.json({
    groups: groupInvoices(jobs, settings, nameOf),
    settings,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { jobIds?: string[]; invoiced?: boolean };
  if (!body.jobIds?.length) {
    return NextResponse.json({ error: "jobIds が必要です" }, { status: 400 });
  }
  const changed = await markInvoiced(body.jobIds, body.invoiced !== false);
  return NextResponse.json({ changed });
}
