import { NextRequest, NextResponse } from "next/server";
import { deleteStaff, listStaff, upsertStaff } from "@/lib/jobs";
import { Staff } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ staff: await listStaff() });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { name?: string; role?: Staff["role"] };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "名前が必要です" }, { status: 400 });
  }
  const staff = await upsertStaff({ name: body.name.trim(), role: body.role ?? "staff" });
  return NextResponse.json({ staff }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  await deleteStaff(id);
  return NextResponse.json({ ok: true });
}
