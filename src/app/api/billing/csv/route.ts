import { NextRequest, NextResponse } from "next/server";
import { groupInvoices, toCsv } from "@/lib/billing";
import { getSettings, listJobs, listStaff } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 会計ソフトや Excel に取り込む用の CSV。?month=2026-09 で絞れる。 */
export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get("month");
  const client = request.nextUrl.searchParams.get("client");

  const [jobs, staff, settings] = await Promise.all([
    listJobs(),
    listStaff(),
    getSettings(),
  ]);
  const nameOf = (id: string | null) =>
    staff.find((s) => s.id === id)?.name ?? "未割当";

  let groups = groupInvoices(jobs, settings, nameOf);
  if (month) groups = groups.filter((g) => g.month === month);
  if (client) groups = groups.filter((g) => g.client === client);

  const filename = `seikyu_${month ?? "all"}.csv`;
  return new NextResponse(toCsv(groups), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
