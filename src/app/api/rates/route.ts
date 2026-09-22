import { NextRequest, NextResponse } from "next/server";
import { getSettings, listRates, saveRates, saveSettings } from "@/lib/jobs";
import { Rate, Settings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [rates, settings] = await Promise.all([listRates(), getSettings()]);
  return NextResponse.json({ rates, settings });
}

export async function PUT(request: NextRequest) {
  const body = (await request.json()) as {
    rates?: Rate[];
    settings?: Partial<Settings>;
  };
  const rates = body.rates ? await saveRates(body.rates) : await listRates();
  const settings = body.settings
    ? await saveSettings(body.settings)
    : await getSettings();
  return NextResponse.json({ rates, settings });
}
