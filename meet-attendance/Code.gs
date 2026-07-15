/**
 * Google Meet 出席自動集計スクリプト
 *
 * Google Meet REST API から会議の参加者記録を取得してスプレッドシートに記録し、
 * 月次サマリー(開催回数・延べ/ユニーク参加者数・新規/リピーター・リピート率)と
 * 参加者マスタを自動生成します。
 *
 * セットアップ手順は同梱の README.md を参照してください。
 */

// ======== 設定 ========
const CONFIG = {
  LOG_SHEET: '参加ログ',
  SUMMARY_SHEET: '月次サマリー',
  MASTER_SHEET: '参加者マスタ',
  MAP_SHEET: '名前対応表',

  // 初回同期で何日前まで遡って取得するか
  LOOKBACK_DAYS: 90,

  // 集計対象の会議コード。空配列 [] にすると自分が主催した全会議が対象
  // プログラム用リンク: https://meet.google.com/ust-ndqc-kwk
  MEETING_CODES: ['ust-ndqc-kwk'],

  // この分数未満の滞在は出席とみなさない(0 なら全員カウント)
  MIN_MINUTES: 0,

  // 毎日の自動同期を実行する時刻(0〜23)。15 なら15時台に実行される
  TRIGGER_HOUR: 15,
};
// ======================

/** スプレッドシートを開いたときにメニューを追加 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Meet出席')
    .addItem('今すぐ同期(参加記録を取得)', 'syncAttendance')
    .addItem('集計だけ更新', 'rebuildReports')
    .addSeparator()
    .addItem('毎日の自動同期を設定', 'setupDailyTrigger')
    .addToUi();
}

/**
 * メイン処理: Meet API から会議記録を取得して参加ログに追記し、集計を更新する。
 * 毎日のトリガーからもメニューからも呼ばれる。
 */
function syncAttendance() {
  // 同時実行防止: 手動実行の連打や自動実行との重なりで同じ会議が
  // 二重に取り込まれるのを防ぐ
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    toast_('同期は既に実行中のため、この実行はスキップしました。');
    return;
  }
  try {
    syncAttendanceLocked_();
  } finally {
    lock.releaseLock();
  }
}

function syncAttendanceLocked_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const logSheet = getOrCreateLogSheet_(ss);
  const knownRecords = getKnownRecordIds_(logSheet);

  const since = new Date(Date.now() - CONFIG.LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const filter = 'start_time>="' + since.toISOString() + '"';

  const newRows = [];
  let skippedOngoing = 0;
  let pageToken;
  do {
    let query = 'pageSize=100&filter=' + encodeURIComponent(filter);
    if (pageToken) query += '&pageToken=' + encodeURIComponent(pageToken);
    const resp = meetApiGet_('conferenceRecords?' + query);
    const records = resp.conferenceRecords || [];
    for (const rec of records) {
      if (knownRecords.has(rec.name)) continue; // 取得済み
      if (!rec.endTime) { skippedOngoing++; continue; } // 進行中の会議は次回同期で取得
      const meetingCode = getMeetingCode_(rec.space);
      if (CONFIG.MEETING_CODES.length > 0 && CONFIG.MEETING_CODES.indexOf(meetingCode) === -1) {
        continue;
      }
      newRows.push.apply(newRows, buildParticipantRows_(rec, meetingCode, tz));
    }
    pageToken = resp.nextPageToken;
  } while (pageToken);

  if (newRows.length > 0) {
    logSheet
      .getRange(logSheet.getLastRow() + 1, 1, newRows.length, newRows[0].length)
      .setValues(newRows);
  }
  sortLog_(logSheet);

  rebuildReports();

  const msg =
    '同期完了: ' + newRows.length + ' 件の参加記録を追加しました。' +
    (skippedOngoing > 0 ? '(進行中の会議 ' + skippedOngoing + ' 件は終了後に取得されます)' : '');
  Logger.log(msg);
  toast_(msg);
}

/** 参加ログの内容から月次サマリーと参加者マスタを再生成する */
function rebuildReports() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName(CONFIG.LOG_SHEET);
  if (!logSheet || logSheet.getLastRow() < 2) {
    toast_('参加ログがまだ空です。先に「今すぐ同期」を実行してください。');
    return;
  }
  let rows = logSheet
    .getRange(2, 1, logSheet.getLastRow() - 1, LOG_HEADERS.length)
    .getValues();

  // 過去に二重取り込みされた行があれば自動で削除する
  const deduped = dedupeRows_(rows);
  if (deduped.length !== rows.length) {
    logSheet.getRange(2, 1, rows.length, LOG_HEADERS.length).clearContent();
    logSheet
      .getRange(2, 1, deduped.length, LOG_HEADERS.length)
      .setValues(deduped);
    Logger.log('重複していた ' + (rows.length - deduped.length) + ' 行を削除しました。');
    rows = deduped;
  }

  // 名前対応表を最新化し、本名が入力済みの参加者は名前を置き換える
  const nameMap = updateNameMapping_(ss, rows);
  rows.forEach(function (r) {
    const real = nameMap[String(r[7])];
    if (real) r[3] = real;
  });
  logSheet
    .getRange(2, 4, rows.length, 1)
    .setValues(rows.map(function (r) { return [r[3]]; }));

  buildMonthlySummary_(ss, rows, nameMap);
  buildParticipantMaster_(ss, rows, nameMap);
}

/** 毎日 CONFIG.TRIGGER_HOUR 時台に syncAttendance を実行するトリガーを設定(既存の設定は置き換える) */
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'syncAttendance'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncAttendance')
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.TRIGGER_HOUR)
    .create();
  toast_('毎日' + CONFIG.TRIGGER_HOUR + '時台に自動同期するよう設定しました。');
}

// ======== 内部処理 ========

const LOG_HEADERS = [
  '日付', '月', '会議コード', '参加者名',
  '参加開始', '退出', '滞在時間(分)', '参加者キー', '会議レコードID',
];

/** 1つの会議レコードの参加者一覧を取得し、ログ行の配列にする */
function buildParticipantRows_(rec, meetingCode, tz) {
  // 同一人物が複数エントリになる場合があるためキーでマージする
  const byKey = {};
  let pageToken;
  do {
    let query = 'pageSize=250';
    if (pageToken) query += '&pageToken=' + encodeURIComponent(pageToken);
    const resp = meetApiGet_(rec.name + '/participants?' + query);
    const participants = resp.participants || [];
    for (const p of participants) {
      const id = participantIdentity_(p);
      const start = p.earliestStartTime ? new Date(p.earliestStartTime) : null;
      const end = p.latestEndTime ? new Date(p.latestEndTime) : null;
      const cur = byKey[id.key];
      if (!cur) {
        byKey[id.key] = { name: id.name, start: start, end: end };
      } else {
        if (start && (!cur.start || start < cur.start)) cur.start = start;
        if (end && (!cur.end || end > cur.end)) cur.end = end;
      }
    }
    pageToken = resp.nextPageToken;
  } while (pageToken);

  const dateStr = Utilities.formatDate(new Date(rec.startTime), tz, 'yyyy-MM-dd');
  const monthStr = Utilities.formatDate(new Date(rec.startTime), tz, 'yyyy-MM');
  const rows = [];
  for (const key in byKey) {
    const e = byKey[key];
    const minutes =
      e.start && e.end ? Math.round((e.end.getTime() - e.start.getTime()) / 60000) : '';
    if (CONFIG.MIN_MINUTES > 0 && minutes !== '' && minutes < CONFIG.MIN_MINUTES) continue;
    rows.push([
      dateStr,
      monthStr,
      meetingCode,
      e.name,
      e.start ? Utilities.formatDate(e.start, tz, 'yyyy-MM-dd HH:mm') : '',
      e.end ? Utilities.formatDate(e.end, tz, 'yyyy-MM-dd HH:mm') : '',
      minutes,
      key,
      rec.name,
    ]);
  }
  return rows;
}

/**
 * 参加者の識別キーと表示名を決める。
 * Google アカウントでログインしていれば user ID で確実に同一人物を追跡できる。
 * 匿名参加者は表示名でしか識別できない(表記ゆれに注意)。
 */
function participantIdentity_(p) {
  if (p.signedinUser) {
    return {
      key: p.signedinUser.user || 'name:' + p.signedinUser.displayName,
      name: p.signedinUser.displayName || '(不明)',
    };
  }
  if (p.anonymousUser) {
    const name = p.anonymousUser.displayName || '(匿名)';
    return { key: 'name:' + name, name: name };
  }
  if (p.phoneUser) {
    const name = p.phoneUser.displayName || '(電話参加)';
    return { key: 'phone:' + name, name: name };
  }
  return { key: 'unknown:' + (p.name || ''), name: '(不明)' };
}

/** 月次サマリーシートを再生成する */
function buildMonthlySummary_(ss, rows, nameMap) {
  // 参加者ごとの初参加月(新規/リピーター判定用)
  const firstMonthById = {};
  for (const r of rows) {
    const month = String(r[1]);
    const id = canonicalId_(r, nameMap);
    if (!firstMonthById[id] || month < firstMonthById[id]) {
      firstMonthById[id] = month;
    }
  }

  // 月ごとに集計
  const byMonth = {};
  for (const r of rows) {
    const month = String(r[1]);
    const id = canonicalId_(r, nameMap);
    const recordId = String(r[8]);
    if (!byMonth[month]) {
      byMonth[month] = { records: {}, ids: {}, attendances: {} };
    }
    const m = byMonth[month];
    m.records[recordId] = true;
    m.ids[id] = true;
    m.attendances[recordId + '|' + id] = true; // 同一人物の重複入室は1回と数える
  }

  const months = Object.keys(byMonth).sort();
  const out = [];
  for (const month of months) {
    const m = byMonth[month];
    const sessionCount = Object.keys(m.records).length;
    const uniqueIds = Object.keys(m.ids);
    const attendances = Object.keys(m.attendances).length;
    const newcomers = uniqueIds.filter(function (id) {
      return firstMonthById[id] === month;
    }).length;
    const repeaters = uniqueIds.length - newcomers;
    out.push([
      month,
      sessionCount,
      attendances,
      uniqueIds.length,
      newcomers,
      repeaters,
      uniqueIds.length > 0 ? repeaters / uniqueIds.length : 0,
      sessionCount > 0 ? Math.round((attendances / sessionCount) * 10) / 10 : 0,
    ]);
  }

  const headers = [
    '月', '開催回数', '延べ参加者数', 'ユニーク参加者数',
    '新規参加者数', 'リピーター数', 'リピート率', '平均参加者数/回',
  ];
  const sheet = resetSheet_(ss, CONFIG.SUMMARY_SHEET, headers);
  if (out.length > 0) {
    sheet.getRange(2, 1, out.length, headers.length).setValues(out);
    sheet.getRange(2, 7, out.length, 1).setNumberFormat('0.0%');
  }
}

/** 参加者マスタシートを再生成する */
function buildParticipantMaster_(ss, rows, nameMap) {
  const byId = {};
  for (const r of rows) {
    const date = String(r[0]);
    const month = String(r[1]);
    const name = String(r[3]);
    const key = String(r[7]);
    const recordId = String(r[8]);
    const id = canonicalId_(r, nameMap);
    if (!byId[id]) {
      byId[id] = { name: name, first: date, last: date, records: {}, months: {}, keys: {} };
    }
    const e = byId[id];
    e.records[recordId] = true;
    e.months[month] = true;
    e.keys[key] = true;
    if (date < e.first) e.first = date;
    if (date >= e.last) {
      e.last = date;
      e.name = name; // 最新の名前を採用
    }
  }

  const out = Object.keys(byId)
    .map(function (id) {
      const e = byId[id];
      return [
        e.name,
        e.first,
        e.last,
        Object.keys(e.records).length,
        Object.keys(e.months).length,
        Object.keys(e.keys).join(', '),
      ];
    })
    .sort(function (a, b) { return b[3] - a[3]; }); // 参加回数の多い順

  const headers = ['参加者名', '初回参加日', '最終参加日', '参加回数', '参加月数', '参加者キー'];
  const sheet = resetSheet_(ss, CONFIG.MASTER_SHEET, headers);
  if (out.length > 0) {
    sheet.getRange(2, 1, out.length, headers.length).setValues(out);
  }
}

/**
 * 参加ログの重複行(同じ会議 × 同じ参加者)を取り除く。最初の1行だけ残す。
 * 同時実行などで二重取り込みされた過去データの自動修復に使う。
 */
function dedupeRows_(rows) {
  const seen = {};
  return rows.filter(function (r) {
    const id = String(r[8]) + '|' + String(r[7]); // 会議レコードID + 参加者キー
    if (seen[id]) return false;
    seen[id] = true;
    return true;
  });
}

const MAP_HEADERS = ['参加者キー', 'Meetでの表示名', '正式な名前(ここに入力)'];

/**
 * 名前対応表シートを最新化して、参加者キー → 本名 の対応を返す。
 * ログに現れた未登録の参加者は自動でシートに追加される(本名欄は空)。
 * 本名欄が空の参加者は Meet の表示名のまま扱われる。
 */
function updateNameMapping_(ss, rows) {
  let sheet = ss.getSheetByName(CONFIG.MAP_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.MAP_SHEET);
    sheet.getRange(1, 1, 1, MAP_HEADERS.length).setValues([MAP_HEADERS]);
    sheet.getRange(1, 1, 1, MAP_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const map = {};
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const vals = sheet.getRange(2, 1, lastRow - 1, MAP_HEADERS.length).getValues();
    for (const v of vals) {
      if (v[0]) map[String(v[0])] = String(v[2]).trim();
    }
  }

  const toAppend = [];
  for (const r of rows) {
    const key = String(r[7]);
    if (!(key in map)) {
      map[key] = '';
      toAppend.push([key, String(r[3]), '']);
    }
  }
  if (toAppend.length > 0) {
    sheet
      .getRange(sheet.getLastRow() + 1, 1, toAppend.length, MAP_HEADERS.length)
      .setValues(toAppend);
  }
  return map;
}

/**
 * 集計上の同一人物判定に使うID。
 * 名前対応表で本名が入力されていれば本名で統合する(表示名が毎回違う人の対策)。
 */
function canonicalId_(row, nameMap) {
  const key = String(row[7]);
  const real = nameMap ? nameMap[key] : '';
  return real ? '本名:' + real : key;
}

/** 会議スペースIDから会議コード(abc-mnop-xyz 形式)を取得。取得できなければスペースIDを返す */
const spaceCodeCache_ = {};
function getMeetingCode_(spaceName) {
  if (!spaceName) return '';
  if (spaceCodeCache_[spaceName]) return spaceCodeCache_[spaceName];
  let code = spaceName;
  try {
    const space = meetApiGet_(spaceName);
    if (space && space.meetingCode) code = space.meetingCode;
  } catch (e) {
    // アクセスできないスペースはIDのまま扱う
  }
  spaceCodeCache_[spaceName] = code;
  return code;
}

function getOrCreateLogSheet_(ss) {
  let sheet = ss.getSheetByName(CONFIG.LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.LOG_SHEET, 0);
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** ログに記録済みの会議レコードIDの集合(二重取り込み防止) */
function getKnownRecordIds_(sheet) {
  const known = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return known;
  const ids = sheet.getRange(2, LOG_HEADERS.length, lastRow - 1, 1).getValues();
  for (const row of ids) {
    if (row[0]) known.add(String(row[0]));
  }
  return known;
}

function sortLog_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;
  sheet
    .getRange(2, 1, lastRow - 1, LOG_HEADERS.length)
    .sort([{ column: 5, ascending: false }]); // 参加開始時刻の新しい順(最新が上)
}

/** シートを作り直してヘッダーだけの状態にする */
function resetSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Google Meet REST API を呼び出す。
 * 必要な権限スコープは appsscript.json(マニフェスト)で宣言している。
 */
function meetApiGet_(pathAndQuery) {
  const resp = UrlFetchApp.fetch('https://meet.googleapis.com/v2/' + pathAndQuery, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code === 401 || code === 403) {
    throw new Error(
      'Meet API へのアクセスが許可されていません (HTTP ' + code + ')。' +
      'appsscript.json に meetings.space.readonly スコープが設定されているか、' +
      '会議の主催者アカウントで承認したかを確認してください。詳細: ' +
      resp.getContentText()
    );
  }
  if (code !== 200) {
    throw new Error('Meet API エラー (HTTP ' + code + '): ' + resp.getContentText());
  }
  return JSON.parse(resp.getContentText());
}

function toast_(msg) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Meet出席', 10);
  } catch (e) {
    // トリガー実行時などUIがない場合は無視
  }
}
