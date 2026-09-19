import crypto from "crypto";

const API = "https://api.line.me/v2/bot";

export type LineMessage = Record<string, unknown>;

function token(): string {
  return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
}

function secret(): string {
  return process.env.LINE_CHANNEL_SECRET ?? "";
}

/** トークン未設定でもアプリ全体は動く。LINE 送信だけを黙って落とす。 */
export function isConfigured(): boolean {
  return token().length > 0 && secret().length > 0;
}

/** LINE からの Webhook が本物か、チャネルシークレットで検証する。 */
export function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !secret()) return false;
  const expected = crypto
    .createHmac("sha256", secret())
    .update(rawBody, "utf8")
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function call(path: string, body: unknown): Promise<{ ok: boolean; detail?: string }> {
  if (!isConfigured()) {
    return { ok: false, detail: "LINE_CHANNEL_ACCESS_TOKEN が未設定です" };
  }
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token()}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = `${res.status} ${await res.text()}`;
      console.error(`[line] ${path} に失敗`, detail);
      return { ok: false, detail };
    }
    return { ok: true };
  } catch (error) {
    // LINE 側の不調でアプリの処理まで止めない。案件の更新は済んでいる。
    console.error(`[line] ${path} に到達できません`, error);
    return { ok: false, detail: String(error) };
  }
}

export function reply(replyToken: string, messages: LineMessage[]) {
  return call("/message/reply", { replyToken, messages: messages.slice(0, 5) });
}

export function push(to: string, messages: LineMessage[]) {
  return call("/message/push", { to, messages: messages.slice(0, 5) });
}

/** 複数の個人宛に同じ内容を送る。グループが無い運用のとき使う。 */
export function multicast(to: string[], messages: LineMessage[]) {
  if (to.length === 0) return Promise.resolve({ ok: true });
  return call("/message/multicast", { to: to.slice(0, 500), messages: messages.slice(0, 5) });
}

/** スタッフ全員に届ける宛先。グループ ID があればそちらを優先する。 */
export async function broadcastToStaff(
  staffUserIds: string[],
  messages: LineMessage[],
): Promise<{ ok: boolean; detail?: string }> {
  const groupId = process.env.LINE_STAFF_GROUP_ID;
  if (groupId) return push(groupId, messages);
  return multicast(staffUserIds, messages);
}
