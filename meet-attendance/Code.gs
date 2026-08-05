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
  // プログラム用リンク: https://meet.google.com/fnu-guox-pfg
  // ust-ndqc-kwk は旧リンク(2026年8月に変更)。過去分の取り込みのため残している
  MEETING_CODES: ['fnu-guox-pfg', 'ust-ndqc-kwk'],

  // この分数未満の滞在は出席とみなさない(0 なら全員カウント)
  MIN_MINUTES: 0,

  // 毎日の自動同期を実行する時刻(0〜23)。15 なら15時台に実行される
  TRIGGER_HOUR: 15,

  // ---- Chatwork報告文の設定 ----
  // 冒頭のあいさつ部分
  REPORT_HEADER: '【共有】\nノービー記録用です🙇',
  // アンケートのURL(毎回同じ場合はここに設定。空文字なら空行になる)
  REPORT_SURVEY_URL: 'https://forms.gle/hZmYXmAfiyg82gz56',
  // 参加人数・名簿から除外する名前(運営アカウントなど)
  REPORT_EXCLUDE: ['プログラム専用アカウント', 'プログラム_スキルアップ工房'],

  // ---- アンケート月次集計の設定 ----
  // 回答が入っているスプレッドシートのURL。
  // 空文字ならこの出席管理シート自身から探す
  SURVEY_SPREADSHEET_URL:
    'https://docs.google.com/spreadsheets/d/1zvenC0nI2EKyXqtmSWZKnaOK9cSfZ3wGBWWMHE2apfw/edit',
  // 回答シート名(空文字なら「タイムスタンプ」列を持つシートを自動で探す)
  SURVEY_SHEET: '',
  // 自由記述を報告文に載せる最大件数
  SURVEY_MAX_COMMENTS: 20,
};
// ======================

/** スプレッドシートを開いたときにメニューを追加 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Meet出席')
    .addItem('今すぐ同期(参加記録を取得)', 'syncAttendance')
    .addItem('集計だけ更新', 'rebuildReports')
    .addItem('報告文を作成(最新回)', 'createReportDraft')
    .addItem('アンケート結果をまとめる(月次)', 'createSurveyDigest')
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

  rebuildReports(); // 並び替えと日付境界の罫線もこの中で行う

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

  sortLog_(logSheet);
}

/**
 * 最新の開催回の出席データから、Chatwork共有用の報告文の下書きを作成して表示する。
 * 参加者名の「(大阪)」「(東京)」などから拠点別の名簿を自動生成する。
 */
function createReportDraft() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName(CONFIG.LOG_SHEET);
  if (!logSheet || logSheet.getLastRow() < 2) {
    toast_('参加ログがまだ空です。先に「今すぐ同期」を実行してください。');
    return;
  }
  const rows = logSheet
    .getRange(2, 1, logSheet.getLastRow() - 1, LOG_HEADERS.length)
    .getValues();
  const text = buildReportText_(rows, ss.getSpreadsheetTimeZone());
  showCopyableText_(
    text,
    '報告文(Chatwork用)',
    '時間・内容・資料URLの欄を埋めてChatworkに貼り付けてください。'
  );
}

/** 参加ログの行データから報告文テキストを組み立てる */
function buildReportText_(rows, tz) {
  const dateOf = function (v) {
    return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v);
  };

  // 最新の開催日の行だけを対象にする(除外リストの名前は除く)
  const latest = rows.map(function (r) { return dateOf(r[0]); }).sort().pop();
  const dayRows = rows.filter(function (r) {
    return dateOf(r[0]) === latest &&
      CONFIG.REPORT_EXCLUDE.indexOf(String(r[3])) === -1;
  });

  // 同一人物の重複を除いて参加者リストを作る
  const seen = {};
  const people = [];
  for (const r of dayRows) {
    const key = String(r[7]);
    if (seen[key]) continue;
    seen[key] = true;
    people.push(String(r[3]));
  }

  // 「名前(拠点)」の形式から拠点ごとにグループ化し、名前から拠点部分を取り除く。
  // 半角 () と全角 () の両方に対応する(（ = (、） = ))
  const groups = {};
  const order = [];
  for (const full of people) {
    const m = full.match(/[(（]([^)）]+)[)）]\s*$/);
    const loc = m ? m[1].trim() : '';
    const bare = m ? full.slice(0, m.index).trim() : full;
    if (!groups[loc]) {
      groups[loc] = [];
      order.push(loc);
    }
    groups[loc].push(bare || full);
  }
  const memberLines = order.map(function (loc) {
    return (loc ? loc + '：' : '') + groups[loc].join('、'); // ： = :
  });

  return (
    CONFIG.REPORT_HEADER + '\n\n' +
    '■プログラム\n' +
    '時間:\n' +
    '内容:\n\n' +
    '参加人数:' + people.length + '名\n' +
    memberLines.join('\n') + '\n\n' +
    '★本日の資料(プロンプト)\n\n' +
    '★アーカイブ\n\n' +
    '★アンケート(任意です)\n' +
    CONFIG.REPORT_SURVEY_URL + '\n'
  );
}

/**
 * アンケート(Googleフォーム)の回答を月ごとに集計し、
 * プログラムチャットに流せるフィードバック文の下書きを作成する。
 */
function createSurveyDigest() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const surveySs = openSurveySpreadsheet_(ss);
  const sheet = findSurveySheet_(surveySs);
  if (!sheet) {
    SpreadsheetApp.getUi().alert(
      'アンケートの回答シートが見つかりません。\n\n' +
      '「' + surveySs.getName() + '」の中に、1行目が「タイムスタンプ」で始まる\n' +
      '回答シートがあるか確認してください。\n' +
      'シート名を直接指定する場合は、Code.gs の CONFIG.SURVEY_SHEET に設定します。'
    );
    return;
  }
  if (sheet.getLastRow() < 2) {
    toast_('アンケートの回答がまだありません。');
    return;
  }

  const tz = ss.getSpreadsheetTimeZone();
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    'アンケート集計',
    '集計する月を YYYY-MM 形式で入力してください(空欄なら先月)',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  let month = res.getResponseText().trim();
  if (!month) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    month = Utilities.formatDate(d, tz, 'yyyy-MM');
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    ui.alert('月の形式が正しくありません(例: 2026-07)。');
    return;
  }

  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const text = buildSurveyDigest_(values, month, tz);
  showCopyableText_(text, 'アンケート結果(' + month + ')', 'プログラムチャットに貼り付けてください。');
}

/** アンケート回答が入っているスプレッドシートを開く(設定がなければこのシート自身) */
function openSurveySpreadsheet_(ss) {
  if (!CONFIG.SURVEY_SPREADSHEET_URL) return ss;
  const id = extractSpreadsheetId_(CONFIG.SURVEY_SPREADSHEET_URL);
  try {
    // URL に余分なパラメータが付いていても開けるよう、ID を取り出して開く
    return id
      ? SpreadsheetApp.openById(id)
      : SpreadsheetApp.openByUrl(CONFIG.SURVEY_SPREADSHEET_URL);
  } catch (e) {
    throw new Error(
      'アンケートのスプレッドシートを開けませんでした。\n' +
      '次の2点を確認してください。\n' +
      '(1) appsscript.json のスコープが「spreadsheets」になっているか' +
      '(「spreadsheets.currentonly」だと他のファイルを開けません)。' +
      '変更した場合は syncAttendance を実行して再承認が必要です。\n' +
      '(2) このアカウントに対象ファイルの閲覧権限があるか。\n' +
      'URL: ' + CONFIG.SURVEY_SPREADSHEET_URL + '\n(詳細: ' + e.message + ')'
    );
  }
}

/** スプレッドシートURLからファイルIDを取り出す */
function extractSpreadsheetId_(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : '';
}

/**
 * アンケートのスプレッドシートに接続できるかを確認する診断用の関数。
 * Apps Script エディタで実行し、実行ログに結果が出る。
 */
function checkSurveyAccess() {
  Logger.log('URL: ' + CONFIG.SURVEY_SPREADSHEET_URL);
  Logger.log('抽出したファイルID: ' + extractSpreadsheetId_(CONFIG.SURVEY_SPREADSHEET_URL));
  try {
    const ss = openSurveySpreadsheet_(SpreadsheetApp.getActiveSpreadsheet());
    Logger.log('✅ 接続できました: ' + ss.getName());
    const sheets = ss.getSheets().map(function (s) { return s.getName(); });
    Logger.log('シート一覧: ' + sheets.join(' / '));
    const target = findSurveySheet_(ss);
    if (!target) {
      Logger.log('⚠️ 回答シートを特定できませんでした(タイムスタンプ列が見つかりません)。');
      return;
    }
    Logger.log('回答シート: ' + target.getName() + '(' + (target.getLastRow() - 1) + '件)');
    if (target.getLastRow() >= 1) {
      Logger.log('設問: ' +
        target.getRange(1, 1, 1, target.getLastColumn()).getValues()[0].join(' | '));
    }
  } catch (e) {
    Logger.log('❌ ' + e.message);
  }
}

/**
 * 回答シートを探す。シート名の指定があればそれを、なければ
 * 「タイムスタンプ」列を持つシート(フォーム回答シート)を自動で選ぶ。
 */
function findSurveySheet_(ss) {
  if (CONFIG.SURVEY_SHEET) return ss.getSheetByName(CONFIG.SURVEY_SHEET);
  const sheets = ss.getSheets();
  for (const s of sheets) {
    const name = s.getName();
    if (name.indexOf('フォームの回答') === 0 || name.indexOf('Form Responses') === 0) {
      return s;
    }
  }
  // シート名が変更されている場合に備え、ヘッダー行の内容から判定する
  for (const s of sheets) {
    if (s.getLastRow() < 1 || s.getLastColumn() < 1) continue;
    const headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
    if (headers.some(function (h) { return /タイムスタンプ|Timestamp/i.test(String(h)); })) {
      return s;
    }
  }
  return sheets.length === 1 ? sheets[0] : null;
}

/**
 * 回答データ(1行目がヘッダー)から指定月のフィードバック文を組み立てる。
 * 設問の型は回答内容から自動判別する(評価スコア / 選択肢 / 自由記述)。
 */
function buildSurveyDigest_(values, month, tz) {
  const headers = values[0].map(function (h) { return String(h).trim(); });

  // タイムスタンプ列を特定する(見つからなければ先頭列)
  let tsCol = 0;
  for (let i = 0; i < headers.length; i++) {
    if (/タイムスタンプ|Timestamp/i.test(headers[i])) { tsCol = i; break; }
  }

  const monthOf = function (v) {
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM');
    const m = String(v).match(/^(\d{4})[-/](\d{1,2})/);
    return m ? m[1] + '-' + ('0' + m[2]).slice(-2) : '';
  };
  const rows = values.slice(1).filter(function (r) { return monthOf(r[tsCol]) === month; });

  if (rows.length === 0) {
    return '■アンケート結果(' + formatMonthJa_(month) + ')\n\nこの月の回答はありませんでした。';
  }

  const blocks = [];
  for (let c = 0; c < headers.length; c++) {
    if (c === tsCol || !headers[c]) continue;
    const answers = rows
      .map(function (r) { return String(r[c]).trim(); })
      .filter(function (v) { return v !== ''; });
    if (answers.length === 0) continue;
    blocks.push(summarizeQuestion_(headers[c], answers));
  }

  return (
    '■アンケート結果(' + formatMonthJa_(month) + ')\n' +
    '回答数:' + rows.length + '件\n\n' +
    blocks.join('\n\n')
  );
}

/** 1設問分の集計テキストを作る。回答の内容から型を自動判別する */
function summarizeQuestion_(question, answers) {
  // 「5」「4点」「5 とても満足」など先頭が数字なら評価スコアとして扱う
  const nums = answers.map(function (a) {
    const m = a.match(/^(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  });
  const isScore = nums.every(function (n) { return n !== null; }) &&
    Math.max.apply(null, nums) <= 10;

  if (isScore) {
    const sum = nums.reduce(function (a, b) { return a + b; }, 0);
    const avg = Math.round((sum / nums.length) * 10) / 10;
    const max = Math.max.apply(null, nums);
    const dist = countBy_(answers.map(function (a, i) { return String(nums[i]); }));
    const distText = Object.keys(dist)
      .sort(function (a, b) { return Number(b) - Number(a); })
      .map(function (k) { return k + ':' + dist[k] + '件'; })
      .join(' / ');
    return '【' + question + '】平均 ' + avg + ' / ' + max + '\n　' + distText;
  }

  // 選択肢(同じ回答が繰り返される・短い)なら件数集計、それ以外は自由記述として列挙する
  const counts = countBy_(answers);
  const keys = Object.keys(counts);
  const maxLen = Math.max.apply(null, keys.map(function (k) { return k.length; }));
  const hasRepeat = keys.length < answers.length;
  const isChoice = keys.length <= 8 && maxLen <= 30 && (hasRepeat || maxLen <= 12);

  if (isChoice) {
    const lines = keys
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .map(function (k) {
        const pct = Math.round((counts[k] / answers.length) * 100);
        return '　・' + k + ':' + counts[k] + '件(' + pct + '%)';
      });
    return '【' + question + '】\n' + lines.join('\n');
  }

  const shown = answers.slice(0, CONFIG.SURVEY_MAX_COMMENTS);
  const lines = shown.map(function (a) { return '　・' + a.replace(/\r?\n/g, ' '); });
  const more = answers.length > shown.length
    ? '\n　…ほか' + (answers.length - shown.length) + '件'
    : '';
  return '【' + question + '】\n' + lines.join('\n') + more;
}

/** '2026-07' を '2026年7月' の形式にする */
function formatMonthJa_(month) {
  const parts = month.split('-');
  return parts[0] + '年' + parseInt(parts[1], 10) + '月';
}

function countBy_(list) {
  const counts = {};
  for (const v of list) counts[v] = (counts[v] || 0) + 1;
  return counts;
}

/** テキストをコピーできるダイアログで表示する */
function showCopyableText_(text, title, note) {
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;">' +
    '<p style="margin:0 0 6px;">' + escapeHtml_(note) + '</p>' +
    '<textarea id="t" style="width:100%;height:330px;box-sizing:border-box;">' +
    escapeHtml_(text) +
    '</textarea><br>' +
    '<button style="margin-top:8px;padding:6px 16px;" onclick="' +
    "var t=document.getElementById('t');t.select();document.execCommand('copy');" +
    "this.textContent='コピーしました!';" +
    '">全文をコピー</button></div>'
  ).setWidth(520).setHeight(460);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
  if (lastRow >= 3) {
    sheet
      .getRange(2, 1, lastRow - 1, LOG_HEADERS.length)
      .sort([{ column: 5, ascending: false }]); // 参加開始時刻の新しい順(最新が上)
  }
  applyDateBorders_(sheet);
}

/** 参加ログで日付が変わる境目の行に太い下罫線を引く */
function applyDateBorders_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  // いったん既存の罫線を消してから引き直す(並び替えで境目が移動するため)
  sheet
    .getRange(2, 1, lastRow - 1, LOG_HEADERS.length)
    .setBorder(false, false, false, false, false, false);
  const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < dates.length - 1; i++) {
    if (String(dates[i][0]) !== String(dates[i + 1][0])) {
      sheet
        .getRange(2 + i, 1, 1, LOG_HEADERS.length)
        .setBorder(
          null, null, true, null, null, null,
          '#000000', SpreadsheetApp.BorderStyle.SOLID_MEDIUM
        );
    }
  }
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
