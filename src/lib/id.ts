import { randomUUID } from "crypto";

/** 表示にも使う短い ID。衝突しにくさより読みやすさを優先。 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
