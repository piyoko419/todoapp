#!/usr/bin/env python3
"""シフト表から読み取ったJSONを検算する。

一番怖いのは、列を1つずらして読んだまま「それらしい」予定が丸ごと登録されること。
画像に書いてある曜日と、日付から計算した曜日を突き合わせれば、ズレは必ずここで止まる。

usage: python3 validate_shifts.py /tmp/claude-shifts.json
"""

import calendar
import json
import sys
from collections import Counter
from datetime import date

WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"]


def main(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        sys.exit(f"ファイルがありません: {path}")
    except json.JSONDecodeError as e:
        sys.exit(f"JSONとして読めません: {e}")

    errors = []
    for key in ("year", "month", "person", "days"):
        if key not in data:
            errors.append(f"必須項目 '{key}' がありません")
    if errors:
        report(errors, [])
        return 1

    year, month = int(data["year"]), int(data["month"])
    days = data["days"]
    last_day = calendar.monthrange(year, month)[1]

    seen = {}
    for i, entry in enumerate(days):
        label = f"days[{i}]"
        try:
            d = date.fromisoformat(entry["date"])
        except (KeyError, ValueError):
            errors.append(f"{label}: date が正しい YYYY-MM-DD ではありません: {entry.get('date')!r}")
            continue

        label = f"{d.isoformat()}"

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
            errors.append(
                f"{label}: 曜日が合いません — 画像では「{written}」ですが実際は「{actual}」です"
            )

        action = entry.get("action")
        if action not in ("create", "skip"):
            errors.append(f"{label}: action は 'create' か 'skip' です（現在: {action!r}）")
            continue

        cell = (entry.get("cell") or "").strip()
        if action == "create" and not cell:
            errors.append(f"{label}: action が create なのに cell が空です")
        if action == "skip" and cell and cell not in ("休", "公休", "有休"):
            errors.append(
                f"{label}: cell に「{cell}」が入っているのに skip です。登録漏れではありませんか"
            )

    missing = [n for n in range(1, last_day + 1) if n not in seen]
    if missing:
        errors.append(
            f"{year}年{month}月の {', '.join(f'{n}日' for n in missing)} がJSONにありません"
            "（画像の撮り漏れか、読み飛ばしです）"
        )

    creates = [e for e in days if e.get("action") == "create"]
    skips = [e for e in days if e.get("action") == "skip"]
    summary = [
        f"対象: {data['person']}さん / {year}年{month}月",
        f"登録する日: {len(creates)}件",
    ]
    for cell, n in Counter((e.get("cell") or "").strip() for e in creates).most_common():
        summary.append(f"  {cell}: {n}件")
    rests = sum(1 for e in skips if (e.get("cell") or "").strip())
    summary.append(f"登録しない日: {len(skips)}件（うち休み {rests}件、空欄 {len(skips) - rests}件）")

    # ズレの検出は「どこから」が分かると直しやすい
    weekday_errors = [e for e in errors if "曜日が合いません" in e]
    if len(weekday_errors) > 2:
        summary.append("")
        summary.append(
            f"曜日の不一致が {len(weekday_errors)}件 連続しています。"
            f"列を1つずらして読んでいる可能性が高いので、{weekday_errors[0].split(':')[0]} のあたりから読み直してください。"
        )

    report(errors, summary)
    return 1 if errors else 0


def report(errors, summary):
    for line in summary:
        print(line)
    if errors:
        print()
        print(f"--- エラー {len(errors)}件 ---")
        for e in errors:
            print(f"  ✗ {e}")
        print()
        print("読み取りミスです。画像を見直してJSONを直してから、もう一度実行してください。")
    else:
        print()
        print("✓ 検算OK。ユーザーに内容を確認してもらってからカレンダーに登録してください。")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
