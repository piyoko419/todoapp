import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_SETTINGS, DEFAULT_WORK_TYPES, Database, Job } from "./types";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

const EMPTY: Database = {
  jobs: [],
  staff: [],
  intakes: [],
  // 単価は 0 で用意しておき、画面で金額を入れてもらう。
  rates: DEFAULT_WORK_TYPES.map((workType) => ({ workType, unitPrice: 0 })),
  settings: { ...DEFAULT_SETTINGS },
};

/** 請求フィールドを持たない古い案件に既定値を補う。 */
function migrateJob(job: Job): Job {
  return {
    ...job,
    completedAt: job.completedAt ?? null,
    billedItems: job.billedItems ?? [],
    amount: job.amount ?? null,
    invoicedAt: job.invoicedAt ?? null,
  };
}

let cache: Database | null = null;
/** 書き込みを直列化するためのチェーン。同時リクエストでの読み書き競合を防ぐ。 */
let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<Database> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Database>;
    // 途中でフィールドが増えても、古い db.json をそのまま読めるようにする。
    cache = {
      ...structuredClone(EMPTY),
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      jobs: (parsed.jobs ?? []).map(migrateJob),
    };
  } catch {
    cache = structuredClone(EMPTY);
  }
  return cache;
}

async function persist(db: Database): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, DB_PATH);
}

/** 読み取り専用のアクセス。 */
export async function read<T>(fn: (db: Database) => T): Promise<T> {
  return fn(await load());
}

/** 読み書き。中で db を直接書き換えてよい。戻り値がそのまま返る。 */
export async function write<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  const task = queue.then(async () => {
    const db = await load();
    const result = await fn(db);
    await persist(db);
    return result;
  });
  queue = task.catch(() => undefined);
  return task;
}

/** テスト用。ファイルを読み直させる。 */
export function resetCache(): void {
  cache = null;
}
