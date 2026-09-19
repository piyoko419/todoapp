import { formatJP } from "../date";
import { LineMessage } from "./client";
import { Job, STATUS_LABEL, URGENCY_LABEL, Urgency } from "../types";

const URGENCY_COLOR: Record<Urgency, string> = {
  urgent: "#ef4444",
  high: "#f59e0b",
  normal: "#3b82f6",
  low: "#94a3b8",
};

export function text(content: string): LineMessage {
  return { type: "text", text: content.slice(0, 4900) };
}

function postback(label: string, action: string, jobId: string, style: string) {
  return {
    type: "button",
    style,
    height: "sm",
    action: {
      type: "postback",
      label,
      data: new URLSearchParams({ action, jobId }).toString(),
      displayText: `${label}しました`,
    },
  };
}

/** 状態に応じて、次に押せるボタンだけを出す。 */
function actionsFor(job: Job) {
  switch (job.status) {
    case "pending":
      return [postback("この案件を受ける", "claim", job.id, "primary")];
    case "assigned":
      return [postback("受諾", "accept", job.id, "primary")];
    case "accepted":
      return [postback("作業開始", "start", job.id, "primary")];
    case "in_progress":
      return [postback("完了報告", "done", job.id, "primary")];
    default:
      return [];
  }
}

function summaryLine(job: Job): string {
  const due = job.dueDate ? `${formatJP(job.dueDate)}まで` : "期限未定";
  return `${due} / ${job.workTypes.join("・") || "内容未定"}`;
}

/** 1 件の案件を表すカード。スタッフはここから受諾・完了まで進める。 */
export function jobCard(job: Job, assigneeName?: string): LineMessage {
  const rows: Record<string, unknown>[] = [
    { type: "text", text: `${job.property}`, size: "sm", color: "#64748b", wrap: true },
    {
      type: "text",
      text: `${job.room}号室`,
      size: "xxl",
      weight: "bold",
      color: "#0f172a",
    },
    {
      type: "box",
      layout: "baseline",
      margin: "md",
      contents: [
        { type: "text", text: "期限", size: "sm", color: "#94a3b8", flex: 2 },
        {
          type: "text",
          text: job.dueDate ? `${formatJP(job.dueDate)} (${job.dueDateText || "指定"})` : "未定",
          size: "sm",
          color: "#0f172a",
          flex: 5,
          wrap: true,
        },
      ],
    },
    {
      type: "box",
      layout: "baseline",
      contents: [
        { type: "text", text: "内容", size: "sm", color: "#94a3b8", flex: 2 },
        {
          type: "text",
          text: job.workTypes.join("・") || "未設定",
          size: "sm",
          color: "#0f172a",
          flex: 5,
          wrap: true,
        },
      ],
    },
    {
      type: "box",
      layout: "baseline",
      contents: [
        { type: "text", text: "担当", size: "sm", color: "#94a3b8", flex: 2 },
        {
          type: "text",
          text: assigneeName || "未割当",
          size: "sm",
          color: "#0f172a",
          flex: 5,
        },
      ],
    },
  ];

  if (job.notes) {
    rows.push({
      type: "text",
      text: job.notes,
      size: "xs",
      color: "#64748b",
      wrap: true,
      margin: "md",
    });
  }

  const buttons = actionsFor(job);

  return {
    type: "flex",
    altText: `【${URGENCY_LABEL[job.urgency]}】${job.room}号室 ${summaryLine(job)}`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "horizontal",
        backgroundColor: URGENCY_COLOR[job.urgency],
        paddingAll: "12px",
        contents: [
          {
            type: "text",
            text: URGENCY_LABEL[job.urgency],
            color: "#ffffff",
            weight: "bold",
            size: "sm",
          },
          {
            type: "text",
            text: STATUS_LABEL[job.status],
            color: "#ffffff",
            size: "sm",
            align: "end",
          },
        ],
      },
      body: { type: "box", layout: "vertical", spacing: "sm", contents: rows },
      ...(buttons.length > 0
        ? { footer: { type: "box", layout: "vertical", spacing: "sm", contents: buttons } }
        : {}),
    },
  };
}

/** 複数案件をまとめてカルーセルで送る。LINE の上限は 12 バブル。 */
export function jobCarousel(jobs: Job[], altText: string): LineMessage {
  const cards = jobs.slice(0, 12).map((job) => {
    const card = jobCard(job) as { contents: unknown };
    return card.contents;
  });
  return {
    type: "flex",
    altText,
    contents: { type: "carousel", contents: cards },
  };
}

/** 取り込み直後にスタッフへ流す要約。 */
export function intakeSummary(client: string, jobs: Job[]): LineMessage {
  const lines = jobs.map(
    (job) =>
      `・${job.room}号室 [${URGENCY_LABEL[job.urgency]}] ${summaryLine(job)}`,
  );
  return text(
    [
      `📩 ${client} より新規依頼 ${jobs.length}件`,
      "",
      ...lines,
      "",
      "続けて届くカードから受諾できます。",
    ].join("\n"),
  );
}

export const HELP_TEXT = [
  "使い方",
  "",
  "▼ スタッフの方",
  "「スタッフ登録 山田太郎」と送ると登録されます。",
  "「一覧」… 未完了の案件",
  "「今日」… 本日が期限・予定の案件",
  "「担当」… 自分の担当案件",
  "",
  "▼ 依頼元の方",
  "「依頼元登録 ○○管理」で登録後、依頼内容をそのまま送ってください。",
  "部屋番号と時期・清掃内容を読み取って受付します。",
].join("\n");
