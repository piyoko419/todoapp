import { promises as fs } from "fs";
import path from "path";
import { Database } from "./types";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

const EMPTY: Database = { jobs: [], staff: [], intakes: [] };

let cache: Database | null = null;
/** 書き込みを直列化するためのチェーン。同時リクエストでの読み書き競合を防ぐ。 */
let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<Database> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Database>;
    cache = { ...EMPTY, ...parsed };
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
