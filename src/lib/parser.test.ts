import { describe, expect, test } from "bun:test";
import {
  extractRooms,
  interpretTiming,
  interpretWork,
  normalize,
  parseRequestEmail,
  splitSections,
} from "./parser";

const NOW = new Date(2026, 8, 19); // 2026-09-19

const SAMPLE = `相談室くわん
宮良 哲美 様

いつも大変お世話になっております。
本日ご連絡しましたのは下記内容でございます。

231・233・308・322・338号室
以上5居室の件ですが、至急原状回復掃除をお願いしたくご連絡致しました。

【時期】
338号室→至急※入居が既に決まっています
233・308・322号室→９月中にお願いします
231号室→なるべく早めにご対応頂けると幸いです

【清掃内容】
231・233・308・322号室→通常の清掃のみ
338号室→プラス剥離

時間が短く申し訳ございませんが、何卒よろしくお願い申し上げます。`;

describe("normalize", () => {
  test("全角数字を半角にする", () => {
    expect(normalize("９月中")).toBe("9月中");
  });
  test("矢印表記を → に揃える", () => {
    expect(normalize("338号室=>至急")).toBe("338号室→至急");
    expect(normalize("338号室⇒至急")).toBe("338号室→至急");
  });
});

describe("extractRooms", () => {
  test("中黒区切りの並びを展開する", () => {
    expect(extractRooms("231・233・308・322・338号室")).toEqual([
      "231",
      "233",
      "308",
      "322",
      "338",
    ]);
  });
  test("読点・スラッシュ区切りも読む", () => {
    expect(extractRooms("101、102/103号室")).toEqual(["101", "102", "103"]);
  });
  test("各号室に号室が付く書き方も読む", () => {
    expect(extractRooms("201号室・202号室")).toEqual(["201", "202"]);
  });
  test("「以上5居室」を部屋番号と誤認しない", () => {
    expect(extractRooms("以上5居室の件ですが")).toEqual([]);
  });
  test("「計3室」を部屋番号と誤認しない", () => {
    expect(extractRooms("計3室お願いします")).toEqual([]);
  });
});

describe("interpretWork", () => {
  test("通常の清掃のみ", () => {
    expect(interpretWork("通常の清掃のみ")).toEqual(["通常清掃"]);
  });
  test("プラス剥離は通常清掃を含む", () => {
    expect(interpretWork("プラス剥離")).toEqual(["通常清掃", "剥離"]);
  });
  test("判定できない文面は空", () => {
    expect(interpretWork("要相談")).toEqual([]);
  });
});

describe("interpretTiming", () => {
  test("至急は緊急度 urgent と仮期限", () => {
    const r = interpretTiming("至急※入居が既に決まっています", NOW);
    expect(r.urgency).toBe("urgent");
    expect(r.dueDate).toBe("2026-09-22");
  });
  test("9月中は月末が期限", () => {
    const r = interpretTiming(normalize("９月中にお願いします"), NOW);
    expect(r.dueDate).toBe("2026-09-30");
    expect(r.urgency).toBe("normal");
  });
  test("なるべく早めは high", () => {
    const r = interpretTiming("なるべく早めにご対応頂けると幸いです", NOW);
    expect(r.urgency).toBe("high");
    expect(r.dueDate).toBe("2026-10-03");
  });
  test("具体日付を読む", () => {
    expect(interpretTiming("10月5日までにお願いします", NOW).dueDate).toBe("2026-10-05");
  });
  test("過ぎた月は翌年に送る", () => {
    expect(interpretTiming("3月中", NOW).dueDate).toBe("2027-03-31");
  });
  test("近い期限は書きぶりに関わらず urgent", () => {
    expect(interpretTiming("9月20日まで", NOW).urgency).toBe("urgent");
  });
  test("10月上旬・下旬", () => {
    expect(interpretTiming("10月上旬", NOW).dueDate).toBe("2026-10-10");
    expect(interpretTiming("10月下旬", NOW).dueDate).toBe("2026-10-31");
  });
});

describe("splitSections", () => {
  test("【】見出しで区切る", () => {
    const { preamble, sections } = splitSections(normalize(SAMPLE));
    expect(sections.map((s) => s.kind)).toEqual(["timing", "work"]);
    expect(preamble[0]).toBe("相談室くわん");
    expect(sections[0].lines).toHaveLength(3);
  });
});

describe("parseRequestEmail", () => {
  const result = parseRequestEmail(SAMPLE, NOW);

  test("依頼元と宛名を取る", () => {
    expect(result.client).toBe("相談室くわん");
    expect(result.contactPerson).toBe("宮良 哲美");
  });

  test("5居室すべてを案件にする", () => {
    expect(result.jobs.map((j) => j.room)).toEqual([
      "231",
      "233",
      "308",
      "322",
      "338",
    ]);
  });

  test("338号室は至急・剥離あり", () => {
    const job = result.jobs.find((j) => j.room === "338")!;
    expect(job.urgency).toBe("urgent");
    expect(job.dueDate).toBe("2026-09-22");
    expect(job.workTypes).toEqual(["通常清掃", "剥離", "原状回復"]);
  });

  test("233・308・322号室は9月末が期限の通常清掃", () => {
    for (const room of ["233", "308", "322"]) {
      const job = result.jobs.find((j) => j.room === room)!;
      expect(job.dueDate).toBe("2026-09-30");
      expect(job.urgency).toBe("normal");
      expect(job.workTypes).toEqual(["通常清掃", "原状回復"]);
    }
  });

  test("231号室は早め扱い", () => {
    const job = result.jobs.find((j) => j.room === "231")!;
    expect(job.urgency).toBe("high");
    expect(job.workTypes).toContain("通常清掃");
  });

  test("居室数が一致していれば警告を出さない", () => {
    expect(result.warnings.filter((w) => w.includes("居室とあります"))).toHaveLength(0);
  });

  test("居室数が合わなければ警告する", () => {
    const broken = SAMPLE.replace("以上5居室", "以上6居室");
    const r = parseRequestEmail(broken, NOW);
    expect(r.warnings.some((w) => w.includes("6居室"))).toBe(true);
  });

  test("部屋番号が無ければ警告する", () => {
    const r = parseRequestEmail("お世話になっております。見積りをお願いします。", NOW);
    expect(r.jobs).toHaveLength(0);
    expect(r.warnings.some((w) => w.includes("部屋番号"))).toBe(true);
  });

  test("セクションが無くても本文の指示を全室に適用する", () => {
    const r = parseRequestEmail(
      "○○管理\n101・102号室\n至急、通常清掃をお願いします。",
      NOW,
    );
    expect(r.jobs).toHaveLength(2);
    expect(r.jobs.every((j) => j.urgency === "urgent")).toBe(true);
    expect(r.jobs[0].workTypes).toContain("通常清掃");
  });
});
