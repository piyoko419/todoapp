import { Urgency } from "./types";
import { addDays, daysUntil, lastDayOfMonth, toISODate } from "./date";

/** 「至急」とだけ書かれたときに仮置きする期限の日数。 */
export const URGENT_DUE_DAYS = 3;
/** 「なるべく早めに」に仮置きする期限の日数。 */
export const SOON_DUE_DAYS = 14;

export type ParsedJob = {
  room: string;
  workTypes: string[];
  urgency: Urgency;
  dueDate: string | null;
  dueDateText: string;
  notes: string;
};

export type ParseResult = {
  client: string;
  contactPerson: string;
  jobs: ParsedJob[];
  warnings: string[];
};

/** 全角英数を半角に、矢印と区切り記号を 1 種類に揃える。 */
export function normalize(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/⇒|⇨|➡|➔|⟹|=>|->|＝>/g, "→")
    .replace(/[･･]/g, "・");
}

const SEPARATORS = "・、,，/／\\s";
const ROOM_GROUP_RE = new RegExp(
  `((?:\\d{1,4}(?:号室|号|室)?[${SEPARATORS}]+)*\\d{1,4})\\s*(?:号室|号|室)`,
  "g",
);

/**
 * 「231・233・308・322・338号室」のような並びから部屋番号を取り出す。
 * 「以上5居室」「計3室」のような数え上げは部屋番号ではないので除く。
 */
export function extractRooms(line: string): string[] {
  const rooms: string[] = [];
  ROOM_GROUP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ROOM_GROUP_RE.exec(line)) !== null) {
    const before = line.slice(Math.max(0, m.index - 3), m.index);
    if (/(以上|合計|計|全|各|残り)\s*$/.test(before)) continue;
    for (const token of m[1].split(new RegExp(`[${SEPARATORS}]+`))) {
      const num = token.replace(/(号室|号|室)$/, "").trim();
      if (num && !rooms.includes(num)) rooms.push(num);
    }
  }
  return rooms;
}

type SectionKind = "timing" | "work" | "notes" | "other";

function classifySection(header: string): SectionKind {
  if (/時期|日程|希望日|納期|スケジュール|期限|実施日|予定日/.test(header)) {
    return "timing";
  }
  if (/清掃|作業|内容|仕様|メニュー/.test(header)) return "work";
  if (/備考|補足|その他|連絡|注意/.test(header)) return "notes";
  return "other";
}

const HEADER_RE = /^\s*(?:[【\[［<＜■◆●☆*]+)\s*([^】\]］>＞\n]+?)\s*(?:[】\]］>＞]+)?\s*$/;

type Section = { kind: SectionKind; lines: string[] };

/** 【時期】【清掃内容】…… の見出しで本文を区切る。 */
export function splitSections(text: string): {
  preamble: string[];
  sections: Section[];
} {
  const preamble: string[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const isBracketed = /^[【\[［<＜■◆●]/.test(line);
    const headerMatch = isBracketed ? line.match(HEADER_RE) : null;
    if (headerMatch) {
      current = { kind: classifySection(headerMatch[1]), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }
  return { preamble, sections };
}

const ARROW_RE = /\s*(?:→|：|:)\s*/;

/** 「338号室→至急」の行を、部屋と指示に分ける。矢印が無ければ null。 */
function splitAssignment(line: string): { rooms: string[]; value: string } | null {
  const idx = line.search(ARROW_RE);
  if (idx < 0) return null;
  const head = line.slice(0, idx);
  const value = line.slice(idx).replace(ARROW_RE, "").trim();
  const rooms = extractRooms(head);
  if (rooms.length === 0) return null;
  return { rooms, value };
}

const WORK_RULES: { re: RegExp; tag: string }[] = [
  { re: /剥離|はくり|ハクリ/, tag: "剥離" },
  { re: /ワックス|wax/i, tag: "ワックス" },
  { re: /原状回復/, tag: "原状回復" },
  { re: /エアコン|空調/, tag: "エアコン" },
  { re: /水回り|水廻り|浴室|風呂|トイレ|キッチン|洗面/, tag: "水回り" },
  { re: /窓|サッシ|ガラス/, tag: "窓・サッシ" },
  { re: /ベランダ|バルコニー/, tag: "ベランダ" },
  { re: /ハウスクリーニング/, tag: "ハウスクリーニング" },
  { re: /通常|標準|普通|一般/, tag: "通常清掃" },
];

/**
 * 清掃内容の文面をタグに変換する。
 * 「プラス剥離」のような加算表現は、通常清掃が明示されていなくても足す。
 */
export function interpretWork(text: string): string[] {
  const tags: string[] = [];
  for (const { re, tag } of WORK_RULES) {
    if (re.test(text) && !tags.includes(tag)) tags.push(tag);
  }
  const isAdditive = /プラス|追加|＋|\+|も含む|および|加えて/.test(text);
  if (isAdditive && tags.length > 0 && !tags.includes("通常清掃")) {
    tags.unshift("通常清掃");
  }
  return tags;
}

/** 期限を表す文面から、緊急度と日付を割り出す。 */
export function interpretTiming(
  text: string,
  now: Date,
): { urgency: Urgency; dueDate: string | null } {
  let urgency: Urgency = "normal";
  let dueDate: string | null = null;

  const resolveYear = (month: number, day: number): Date => {
    let d = new Date(now.getFullYear(), month - 1, day);
    if (daysUntil(toISODate(d), now) < -60) {
      d = new Date(now.getFullYear() + 1, month - 1, day);
    }
    return d;
  };

  const monthPeriod = text.match(/(\d{1,2})\s*月\s*(上旬|中旬|下旬|末|中|いっぱい)/);
  const explicitDate = text.match(/(\d{1,2})\s*[月\/]\s*(\d{1,2})\s*日?/);
  const dayOnly = text.match(/(\d{1,2})\s*日(?:まで|迄)/);
  const withinDays = text.match(/(\d{1,2})\s*日\s*以内/);

  if (/本日中|即日|今日中/.test(text)) {
    dueDate = toISODate(now);
  } else if (monthPeriod) {
    const month = Number(monthPeriod[1]);
    const period = monthPeriod[2];
    const day =
      period === "上旬" ? 10 : period === "中旬" ? 20 : null;
    dueDate = toISODate(
      day === null
        ? lastDayOfMonth(resolveYear(month, 1).getFullYear(), month)
        : resolveYear(month, day),
    );
  } else if (explicitDate) {
    dueDate = toISODate(resolveYear(Number(explicitDate[1]), Number(explicitDate[2])));
  } else if (withinDays) {
    dueDate = toISODate(addDays(now, Number(withinDays[1])));
  } else if (/今月末|月末|今月中/.test(text)) {
    dueDate = toISODate(lastDayOfMonth(now.getFullYear(), now.getMonth() + 1));
  } else if (/来月末|来月中/.test(text)) {
    dueDate = toISODate(lastDayOfMonth(now.getFullYear(), now.getMonth() + 2));
  } else if (/今週中|週内/.test(text)) {
    dueDate = toISODate(addDays(now, 6 - now.getDay()));
  } else if (/来週/.test(text)) {
    dueDate = toISODate(addDays(now, 7));
  } else if (dayOnly) {
    dueDate = toISODate(resolveYear(now.getMonth() + 1, Number(dayOnly[1])));
  }

  if (/大至急|至急|緊急|即日|今すぐ|本日中/.test(text)) {
    urgency = "urgent";
    if (!dueDate) dueDate = toISODate(addDays(now, URGENT_DUE_DAYS));
  } else if (/なるべく早|なる早|なるはや|早めに|早急|できるだけ早|可及的/.test(text)) {
    urgency = "high";
    if (!dueDate) dueDate = toISODate(addDays(now, SOON_DUE_DAYS));
  }

  // 日付が近ければ、書きぶりに関わらず緊急度を引き上げる。
  if (dueDate && urgency !== "urgent") {
    const left = daysUntil(dueDate, now);
    if (left <= 3) urgency = "urgent";
    else if (left <= 10) urgency = "high";
  }
  return { urgency, dueDate };
}

/** 差出人（依頼元）と宛名を本文の冒頭から推定する。 */
function extractParties(preamble: string[]): { client: string; contactPerson: string } {
  let client = "";
  let contactPerson = "";
  for (const line of preamble.slice(0, 6)) {
    const honorific = line.match(/^(.{1,30}?)\s*(?:様|御中|さま)$/);
    if (honorific && !contactPerson) {
      contactPerson = honorific[1].trim();
      continue;
    }
    if (!client && !/^(いつも|お世話|拝啓|平素|本日|この度|こんにち)/.test(line)) {
      client = line.trim();
    }
  }
  return { client, contactPerson };
}

/**
 * 依頼メールの本文を、居室ごとの案件に分解する。
 * 部屋別の指示（【時期】【清掃内容】）が本文全体の指示より優先される。
 */
export function parseRequestEmail(rawText: string, now: Date = new Date()): ParseResult {
  const text = normalize(rawText);
  const warnings: string[] = [];
  const { preamble, sections } = splitSections(text);
  const { client, contactPerson } = extractParties(preamble);

  // 本文全体に出てくる部屋番号を、案件の母集合にする。
  const allRooms: string[] = [];
  for (const line of text.split("\n")) {
    for (const room of extractRooms(line)) {
      if (!allRooms.includes(room)) allRooms.push(room);
    }
  }

  const timingByRoom = new Map<string, string>();
  const workByRoom = new Map<string, string>();
  const notesByRoom = new Map<string, string>();
  let defaultTiming = "";
  let defaultWork = "";
  const freeNotes: string[] = [];

  for (const section of sections) {
    const target =
      section.kind === "timing"
        ? timingByRoom
        : section.kind === "work"
          ? workByRoom
          : notesByRoom;
    for (const line of section.lines) {
      const assignment = splitAssignment(line);
      if (assignment) {
        for (const room of assignment.rooms) {
          const prev = target.get(room);
          target.set(room, prev ? `${prev} / ${assignment.value}` : assignment.value);
        }
        continue;
      }
      // 部屋を名指ししない行は、そのセクションの既定値として扱う。
      if (section.kind === "timing") defaultTiming ||= line;
      else if (section.kind === "work") defaultWork ||= line;
      else freeNotes.push(line);
    }
  }

  const preambleText = preamble.join(" ");
  const globalWork = interpretWork(preambleText);
  const preambleTiming = interpretTiming(preambleText, now);

  const jobs: ParsedJob[] = allRooms.map((room) => {
    const timingText = timingByRoom.get(room) ?? defaultTiming;
    const workText = workByRoom.get(room) ?? defaultWork;

    const timing = timingText
      ? interpretTiming(timingText, now)
      : { urgency: preambleTiming.urgency, dueDate: preambleTiming.dueDate };

    const workTypes = [...interpretWork(workText), ...globalWork].filter(
      (tag, i, arr) => arr.indexOf(tag) === i,
    );

    const noteParts: string[] = [];
    const roomNote = notesByRoom.get(room);
    if (roomNote) noteParts.push(roomNote);
    if (workText && interpretWork(workText).length === 0) noteParts.push(workText);

    return {
      room,
      workTypes,
      urgency: timing.urgency,
      dueDate: timing.dueDate,
      dueDateText: timingText || (preambleTiming.dueDate ? preambleText.slice(0, 40) : ""),
      notes: [...noteParts, ...freeNotes].join(" / "),
    };
  });

  // 依頼メールが自己申告している居室数と突き合わせる。
  const declared = text.match(/(?:以上|合計|計|全)\s*(\d{1,3})\s*(?:居室|室|部屋|件)/);
  if (declared && Number(declared[1]) !== jobs.length) {
    warnings.push(
      `メールには${declared[1]}居室とありますが、${jobs.length}件しか読み取れませんでした。部屋番号を確認してください。`,
    );
  }
  if (jobs.length === 0) {
    warnings.push("部屋番号を検出できませんでした。手入力で登録してください。");
  }
  for (const job of jobs) {
    if (job.workTypes.length === 0) {
      warnings.push(`${job.room}号室: 清掃内容を判定できませんでした。`);
    }
    if (!job.dueDate) {
      warnings.push(`${job.room}号室: 期限を読み取れませんでした。`);
    }
  }
  if (!client) warnings.push("依頼元の名称を読み取れませんでした。");

  return { client, contactPerson, jobs, warnings };
}
