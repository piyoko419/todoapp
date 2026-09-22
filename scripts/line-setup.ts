/**
 * LINE の設定のうち、API で操作できる部分をコマンド化する。
 *
 *   bun run line:check              トークンと現在の設定を確認
 *   bun run line:webhook <URL>      Webhook URL を登録して疎通テスト
 *
 * 管理画面での手作業は「応答設定」のトグルだけ残る（API が無い）。
 */

import { promises as fs } from "fs";
import path from "path";

const API_BASE = process.env.LINE_API_BASE || "https://api.line.me";

/** .env.local → .env の順に読む。既存の環境変数は上書きしない。 */
async function loadEnv(): Promise<void> {
  for (const name of [".env.local", ".env"]) {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(process.cwd(), name), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const key = match[1];
      // 前後のクォートは取り除く。貼り付け時に付いてしまいがち。
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      if (value && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

type ApiResult = { status: number; body: unknown; raw: string };

async function api(
  method: string,
  endpointPath: string,
  body?: unknown,
): Promise<ApiResult> {
  const res = await fetch(`${API_BASE}${endpointPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text();
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // JSON でない応答（HTML のエラーページなど）はそのまま見せる。
  }
  return { status: res.status, body: parsed, raw };
}

let failed = false;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string) => {
  failed = true;
  console.log(`  ✗ ${msg}`);
};
const warn = (msg: string) => console.log(`  ! ${msg}`);

function requireToken(): boolean {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (token) return true;
  bad("LINE_CHANNEL_ACCESS_TOKEN が設定されていません。");
  console.log("");
  console.log("    .env.local を作り、次の行を入れてください:");
  console.log("      LINE_CHANNEL_ACCESS_TOKEN=（Messaging API設定 > チャネルアクセストークンの「発行」）");
  console.log("");
  console.log("    .env.local が無い場合: cp .env.example .env.local");
  return false;
}

async function cmdCheck(): Promise<number> {
  console.log("■ 環境変数");
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    bad("LINE_CHANNEL_SECRET が未設定（Webhook の署名検証に必要）");
  } else if (!/^[0-9a-f]{32}$/.test(secret)) {
    warn(`LINE_CHANNEL_SECRET の形が想定と違います（32桁の英小文字と数字）: ${secret.length}文字`);
  } else {
    ok("LINE_CHANNEL_SECRET を読み込みました");
  }
  if (!requireToken()) return 1;
  ok("LINE_CHANNEL_ACCESS_TOKEN を読み込みました");
  if (process.env.LINE_STAFF_GROUP_ID) {
    ok(`スタッフグループへ一括通知します (${process.env.LINE_STAFF_GROUP_ID})`);
  } else {
    console.log("  - LINE_STAFF_GROUP_ID は未設定。登録済みスタッフ個人あてに送ります");
  }

  console.log("");
  console.log("■ アカウント情報 (GET /v2/bot/info)");
  const info = await api("GET", "/v2/bot/info");
  if (info.status !== 200) {
    bad(`取得できませんでした (HTTP ${info.status})`);
    console.log(`    ${info.raw}`);
    if (info.status === 401) {
      console.log("    → アクセストークンが違うか失効しています。再発行して貼り替えてください。");
    }
    return 1;
  }
  const botInfo = info.body as {
    displayName?: string;
    basicId?: string;
    chatMode?: string;
    markAsReadMode?: string;
  };
  ok(`アカウント名: ${botInfo.displayName ?? "(不明)"} ${botInfo.basicId ?? ""}`);
  if (botInfo.chatMode === "bot") {
    ok("応答モード: bot（このアプリが応答します）");
  } else if (botInfo.chatMode === "chat") {
    bad("応答モード: chat（LINE の自動応答が優先され、このアプリの返信とぶつかります）");
    console.log("    → LINE Official Account Manager の 設定 > 応答設定 で");
    console.log("       「応答メッセージ」と「チャット」をオフ、「Webhook」をオンにしてください。");
  } else {
    warn(`応答モードが判定できません: ${JSON.stringify(botInfo.chatMode)}`);
  }

  console.log("");
  console.log("■ Webhook の登録状況 (GET /v2/bot/channel/webhook/endpoint)");
  const endpoint = await api("GET", "/v2/bot/channel/webhook/endpoint");
  if (endpoint.status === 404) {
    warn("Webhook URL が未登録です。");
    console.log("    → bun run line:webhook https://あなたの公開URL");
    return failed ? 1 : 0;
  }
  if (endpoint.status !== 200) {
    bad(`取得できませんでした (HTTP ${endpoint.status})`);
    console.log(`    ${endpoint.raw}`);
    return 1;
  }
  const hook = endpoint.body as { endpoint?: string; active?: boolean };
  ok(`登録済み: ${hook.endpoint}`);
  if (hook.active === false) {
    bad("Webhook が無効になっています（応答設定の Webhook をオンに）");
  } else {
    ok("Webhook は有効です");
  }
  if (hook.endpoint && !hook.endpoint.endsWith("/api/line/webhook")) {
    warn("URL の末尾が /api/line/webhook ではありません。届かない可能性があります。");
  }
  return failed ? 1 : 0;
}

async function cmdWebhook(input: string): Promise<number> {
  if (!requireToken()) return 1;

  // 公開 URL だけ渡されたら、アプリのパスを補う。
  let url = input.trim().replace(/\/+$/, "");
  if (!url.endsWith("/api/line/webhook")) url = `${url}/api/line/webhook`;
  if (!url.startsWith("https://")) {
    bad(`https:// で始まる URL が必要です: ${url}`);
    return 1;
  }

  console.log(`■ Webhook URL を登録します`);
  console.log(`  ${url}`);
  const put = await api("PUT", "/v2/bot/channel/webhook/endpoint", { endpoint: url });
  if (put.status !== 200) {
    bad(`登録に失敗しました (HTTP ${put.status})`);
    console.log(`    ${put.raw}`);
    return 1;
  }
  ok("登録しました");

  console.log("");
  console.log("■ 疎通テスト (POST /v2/bot/channel/webhook/test)");
  const test = await api("POST", "/v2/bot/channel/webhook/test", { endpoint: url });
  if (test.status !== 200) {
    bad(`テストを実行できませんでした (HTTP ${test.status})`);
    console.log(`    ${test.raw}`);
    return 1;
  }
  const result = test.body as {
    success?: boolean;
    statusCode?: number;
    reason?: string;
    detail?: string;
  };
  if (result.success) {
    ok(`アプリが応答しました (HTTP ${result.statusCode})`);
    console.log("");
    console.log("  次は LINE で公式アカウントに「スタッフ登録 あなたの名前」と送ってみてください。");
    return failed ? 1 : 0;
  }
  bad(`アプリが応答しませんでした: ${result.reason ?? "不明"} ${result.detail ?? ""}`);
  console.log("    確認すること:");
  console.log("      - アプリが起動しているか（bun run dev）");
  console.log("      - ngrok が起動していて、URL が今のものと一致しているか");
  console.log("      - 応答設定の Webhook がオンか");
  console.log(`    生の応答: ${test.raw}`);
  return 1;
}

async function main(): Promise<void> {
  await loadEnv();
  const [command, argument] = process.argv.slice(2);
  let code: number;
  if (command === "check") {
    code = await cmdCheck();
  } else if (command === "webhook" && argument) {
    code = await cmdWebhook(argument);
  } else {
    console.log("使い方:");
    console.log("  bun run line:check              トークンと現在の設定を確認");
    console.log("  bun run line:webhook <公開URL>  Webhook URL を登録して疎通テスト");
    code = 1;
  }
  process.exit(code);
}

main().catch((error) => {
  console.error("予期しないエラー:", error);
  process.exit(1);
});
