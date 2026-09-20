#!/usr/bin/env python3
"""シフト表から読み取ったJSONを検算する。

一番怖いのは、列を1つずらして読んだまま「それらしい」予定が丸ごと登録されること。
画像に書いてある曜日と、日付から計算した曜日を突き合わせれば、ズレは必ずここで止まる。
表に休み日数の集計列があるなら expected_off_days に入れておく。二重の検算になる。

usage: python3 validate_shifts.py /tmp/claude-shifts.json
"""

import calendar
import json
import sys
from collections import Counter
from datetime import date

WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"]

# 表にこう書かれていれば休み。空欄・グレーも休みだが、そちらは cell が空文字になる。
REST_CELLS = ("休", "公休", "有休", "有給", "振休", "代休")


def check_person(name, days, year, month, expected_off):
    """1人ぶんを検算し、(エラー行, サマリ行) を返す。"""
    errors, summary = [], []
    last_day = calendar.monthrange(year, month)[1]
    seen = {}

    for i, entry in enumerate(days):
        try:
            d = date.fromisoformat(entry["date"])
        except (KeyError, ValueError):
            errors.append(f"{name} days[{i}]: date が YYYY-MM-DD ではありません: {entry.get('date')!r}")
            continue

        label = f"{name} {d.isoformat()}"

        if (d.year, d.month) != (year, month):
            errors.append(f"{label}: {year}年{month}月の範囲外です")
            continue
        if d.day in seen:
            errors.append(f"{label}: 同じ日が2回出てきます（前半・後半の画像が重複している可能性）")
            continue
        seen[d.day] = entry

        # ここが本丸。画像に書かれた曜日と実際の曜日が食い違うなら、列がズレている。
        actual = WEEKDAYS[d.weekday()]
        written = entry.get("weekday")
        if not written:
            errors.append(f"{label}: weekday がありません（画像に書かれた曜日を写してください）")
        elif written != actual:
            errors.append(f"{label}: 曜日が合いません — 画像では「{written}」ですが実際は「{actual}」です")

        action = entry.get("action")
        if action not in ("work", "off"):
            errors.append(f"{label}: action は 'work' か 'off' です（現在: {action!r}）")
            continue

        cell = (entry.get("cell") or "").strip()
        if action == "work" and not cell:
            errors.append(f"{label}: action が work なのに cell が空です")
        if action == "off" and cell and cell not in REST_CELLS:
            errors.append(f"{label}: cell に「{cell}」が入っているのに off です。勤務日の読み落としではありませんか")

    missing = [n for n in range(1, last_day + 1) if n not in seen]
    if missing:
        errors.append(
            f"{name}: {year}年{month}月の {', '.join(f'{n}日' for n in missing)} がJSONにありません"
            "（画像の撮り漏れか、読み飛ばしです）"
        )

    work = [e for e in days if e.get("action") == "work"]
    off = [e for e in days if e.get("action") == "off"]
    summary.append(f"{name}: 勤務 {len(work)}件 / 休み {len(off)}件")
    breakdown = ", ".join(
        f"{cell} {n}" for cell, n in Counter((e.get("cell") or "").strip() for e in work).most_common()
    )
    if breakdown:
        summary.append(f"  {breakdown}")

    # 表の集計列との突き合わせ。曜日チェックを通っても、セルの読み違いはこれで拾える。
    if expected_off is not None and len(off) != expected_off:
        errors.append(
            f"{name}: 休みが {len(off)}件ですが、表の集計は {expected_off}日です。"
            "勤務日と休みをどこかで取り違えています"
        )

    weekday_errors = [e for e in errors if "曜日が合いません" in e]
    if len(weekday_errors) > 2:
        first = weekday_errors[0].split(":")[0]
        summary.append(
            f"  → 曜日の不一致が {len(weekday_errors)}件 連続。列を1つずらして読んでいる可能性が高いので、"
            f"{first} のあたりから読み直してください"
        )

    return errors, summary


def main(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        sys.exit(f"ファイルがありません: {path}")
    except json.JSONDecodeError as e:
        sys.exit(f"JSONとして読めません: {e}")

    if "year" not in data or "month" not in data:
        sys.exit("必須項目 'year' / 'month' がありません")
    year, month = int(data["year"]), int(data["month"])

    # 1人ぶん（person + days）でも、全員ぶん（people）でも受け取れる。
    if "people" in data:
        roster = data["people"]
    elif "days" in data:
        roster = [{"name": data.get("person", "対象者"),
                   "days": data["days"],
                   "expected_off_days": data.get("expected_off_days")}]
    else:
        sys.exit("'people' も 'days' もありません")

    print(f"{year}年{month}月")
    errors, total_work, total_off = [], 0, 0
    for p in roster:
        e, s = check_person(p.get("name", "?"), p.get("days", []), year, month,
                            p.get("expected_off_days"))
        errors += e
        for line in s:
            print(line)
        total_work += sum(1 for d in p.get("days", []) if d.get("action") == "work")
        total_off += sum(1 for d in p.get("days", []) if d.get("action") == "off")

    print()
    print(f"合計: 勤務 {total_work}件 / 休み {total_off}件")

    if errors:
        print()
        print(f"--- エラー {len(errors)}件 ---")
        for e in errors:
            print(f"  ✗ {e}")
        print()
        print("読み取りミスです。画像を見直してJSONを直してから、もう一度実行してください。")
        return 1

    print()
    print("✓ 検算OK。ユーザーに内容を確認してもらってからカレンダーに登録してください。")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
