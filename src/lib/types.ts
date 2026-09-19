/** 案件（1居室 = 1案件）の緊急度。並び順は urgencyRank() を使う。 */
export type Urgency = "urgent" | "high" | "normal" | "low";

/** 案件の進行状態。pending → assigned → accepted → in_progress → done。 */
export type JobStatus =
  | "pending"
  | "assigned"
  | "accepted"
  | "in_progress"
  | "done"
  | "cancelled";

/** 依頼がどこから入ってきたか。 */
export type JobSource = "email" | "line" | "manual";

export type Staff = {
  id: string;
  name: string;
  /** LINE 連携済みなら userId が入る。未連携なら null。 */
  lineUserId: string | null;
  role: "staff" | "admin" | "client";
  /** role=client のとき、どの依頼元かを表す表示名。 */
  clientName?: string;
  createdAt: string;
};

export type JobEvent = {
  at: string;
  /** 誰が起こした変化か。LINE 経由なら staff:<id>、Web 画面なら web。 */
  actor: string;
  text: string;
};

export type Job = {
  id: string;
  /** 依頼元（管理会社・物件名など）。 */
  client: string;
  /** 物件名。メールから取れなければ client と同じ値が入る。 */
  property: string;
  /** 部屋番号（"338" のような文字列。号室は含めない）。 */
  room: string;
  /** 清掃内容のタグ。例: ["通常清掃", "剥離"] */
  workTypes: string[];
  urgency: Urgency;
  /** 期限（YYYY-MM-DD）。読み取れなければ null。 */
  dueDate: string | null;
  /** 期限の元になった原文。"９月中" など。 */
  dueDateText: string;
  /** 実施予定日（YYYY-MM-DD）。割り当て時に決める。 */
  scheduledDate: string | null;
  status: JobStatus;
  assigneeId: string | null;
  notes: string;
  source: JobSource;
  /** 同じメールから作られた案件をまとめる ID。 */
  batchId: string | null;
  createdAt: string;
  updatedAt: string;
  history: JobEvent[];
};

export type Database = {
  jobs: Job[];
  staff: Staff[];
  /** 取り込んだ依頼メールの原文。あとから見返すため。 */
  intakes: {
    id: string;
    receivedAt: string;
    client: string;
    rawText: string;
    jobIds: string[];
  }[];
};

export const URGENCY_LABEL: Record<Urgency, string> = {
  urgent: "至急",
  high: "早め",
  normal: "通常",
  low: "余裕あり",
};

export const STATUS_LABEL: Record<JobStatus, string> = {
  pending: "未割当",
  assigned: "割当済",
  accepted: "受諾済",
  in_progress: "作業中",
  done: "完了",
  cancelled: "キャンセル",
};

/** 緊急度の強さ。ソートで使う（大きいほど急ぎ）。 */
export function urgencyRank(u: Urgency): number {
  return { urgent: 3, high: 2, normal: 1, low: 0 }[u];
}

/** 未完了の案件か。一覧の既定フィルタで使う。 */
export function isOpen(job: Job): boolean {
  return job.status !== "done" && job.status !== "cancelled";
}
