'use strict';
/**
 * くまもと交通安全ポータル｜自転車危険マップ
 * Node.js サーバー ― server.js
 *
 * GAS（Code.gs）で動かしていたサイトを、GitHub + Render で動かすためのサーバーです。
 *  ・public フォルダ（index.html / style.css / script.js）をそのまま配信します。
 *  ・Code.gs の getPins / addPin / votePin / deletePin / getQuizData を、API として提供します。
 *  ・ライブラリのインストールは不要です（Node.js 18 以上の標準機能だけで動きます）。
 *
 * 【ピンの保存先】
 *  ・環境変数 SPREADSHEET_ID と GOOGLE_SERVICE_ACCOUNT_JSON を設定すると、
 *    これまでと同じ Googleスプレッドシート（pins シート）に保存します。（Render ではこちらを使用）
 *  ・設定しない場合は、data/pins.json に保存します。（自分のパソコンで試すとき用）
 *    ※ Render の無料プランは再起動でファイルが消えるため、本番では使わないでください。
 *
 * 【pins シートの列】（GAS 版と同じ）
 *  A:id  B:lat  C:lng  D:category  E:detail  F:postedAt  G:votes  H:ownerToken
 *
 * 【起動】 npm start      【サンプルのピンを5件追加】 npm run seed
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

/* =========================================================
   設定
========================================================= */
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'pins.json');
const SHEET_NAME = process.env.SHEET_NAME || 'pins';
// テスト用。通常は変更しません（Google の Sheets API の接続先）
const SHEETS_BASE = process.env.SHEETS_API_BASE || 'https://sheets.googleapis.com';

const SHEET_HEADER = ['id', 'lat', 'lng', 'category', 'detail', 'postedAt', 'votes', 'ownerToken'];
const ALLOWED_CATEGORIES = ['事故多発', '見通し不良', '段差・悪路', '違法駐輪', 'その他'];

const MAX_DETAIL_LENGTH = 200;   // 詳細の最大文字数
const POST_INTERVAL_SEC = 15;    // 同じ端末からの連続投稿を防ぐ間隔（秒）
// 熊本県周辺の緯度経度の範囲（範囲外の投稿は拒否）
const LAT_RANGE = [32.0, 33.3];
const LNG_RANGE = [130.0, 131.4];

const READ_CACHE_MS = 10 * 1000;       // スプレッドシートの読み込み結果を使い回す時間（Google API の回数制限対策）
const IP_POST_LIMIT = 20;              // 同じ回線からの投稿は、10分間に20件まで（いたずら対策）
const IP_POST_WINDOW_MS = 10 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* =========================================================
   小さな道具
========================================================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// 同時に2つの書き込みが走らないよう、順番に処理する（GAS の LockService の代わり）
let lockChain = Promise.resolve();
function withLock(fn) {
  const run = lockChain.then(fn);
  lockChain = run.catch(() => {});
  return run;
}

/* ---------- 時刻の変換（スプレッドシートの日付 ⇔ ISO 8601） ----------
   スプレッドシートの日時は「そのシートのタイムゾーンの時刻」で保存されているため、変換が必要 */
function tzOffsetMs(utcMs, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
  });
  const o = {};
  f.formatToParts(new Date(utcMs)).forEach((p) => { o[p.type] = p.value; });
  const wall = Date.UTC(+o.year, +o.month - 1, +o.day, (+o.hour) % 24, +o.minute, +o.second);
  return wall - Math.floor(utcMs / 1000) * 1000;
}
function wallToUtc(wallMs, tz) {
  let u = wallMs - tzOffsetMs(wallMs, tz);
  u = wallMs - tzOffsetMs(u, tz);
  return u;
}
function serialToIso(serial, tz) {
  const wall = Math.round(((serial - 25569) * 86400000) / 1000) * 1000;
  return new Date(wallToUtc(wall, tz)).toISOString();
}
function isoToSerial(iso, tz) {
  const ms = Date.parse(iso);
  return (ms + tzOffsetMs(ms, tz)) / 86400000 + 25569;
}

/* =========================================================
   保存先①：ローカルの JSON ファイル（認証情報なしで動く）
========================================================= */
class FileStore {
  constructor(file) { this.file = file; this.rows = []; this.label = 'JSONファイル（' + file + '）'; }

  async init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.rows = Array.isArray(data) ? data : [];
    } catch (e) {
      this.rows = [];
    }
  }
  async all() { return this.rows.map((r) => Object.assign({}, r)); }

  async add(pin) { this.rows.push(Object.assign({}, pin)); await this._save(); }

  async vote(id) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    r.votes = (Number(r.votes) || 0) + 1;
    await this._save();
    return r.votes;
  }

  /** @return {'ok'|'notfound'|'forbidden'} */
  async remove(id, ownerToken) {
    const i = this.rows.findIndex((x) => x.id === id);
    if (i === -1) return 'notfound';
    const stored = String(this.rows[i].ownerToken || '');
    if (!stored || !safeEqual(stored, ownerToken)) return 'forbidden';
    this.rows.splice(i, 1);
    await this._save();
    return 'ok';
  }

  async _save() {
    const tmp = this.file + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(this.rows, null, 2));
    await fs.promises.rename(tmp, this.file);   // 書き込み途中で止まってもファイルが壊れないようにする
  }
}

/* =========================================================
   保存先②：Googleスプレッドシート（Sheets API）
   サービスアカウント（ロボット用のGoogleアカウント）で、スプレッドシートを読み書きします。
========================================================= */
class SheetsStore {
  constructor(opts) {
    this.id = opts.spreadsheetId;
    this.sheetName = opts.sheetName;
    this.cred = opts.credentials;           // サービスアカウントの JSON（client_email / private_key）
    this.label = 'Googleスプレッドシート（シート名「' + opts.sheetName + '」）';
    this.tz = 'Asia/Tokyo';
    this.sheetId = null;
    this.tok = null; this.tokExp = 0; this.tokPromise = null;
    this.cache = null; this.loading = null;
  }

  /* ---------- 認証（JWT → アクセストークン） ---------- */
  _token() {
    if (this.tok && this.tokExp - 60000 > Date.now()) return Promise.resolve(this.tok);
    if (this.tokPromise) return this.tokPromise;

    this.tokPromise = (async () => {
      const b64u = (v) => Buffer.from(v).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const uri = this.cred.token_uri || 'https://oauth2.googleapis.com/token';
      const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claim = b64u(JSON.stringify({
        iss: this.cred.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: uri, iat: now, exp: now + 3600
      }));
      const key = String(this.cred.private_key || '').replace(/\\n/g, '\n');
      const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(key, 'base64url');

      const res = await fetch(uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: head + '.' + claim + '.' + sig
        }),
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) throw new Error('Google の認証に失敗しました (' + res.status + '): ' + (await res.text()).slice(0, 300));
      const j = await res.json();
      this.tok = j.access_token;
      this.tokExp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
      return this.tok;
    })().finally(() => { this.tokPromise = null; });

    return this.tokPromise;
  }

  /* ---------- Sheets API 呼び出し（一時的なエラーは自動でやり直す） ---------- */
  async _call(method, pathname, body) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        const token = await this._token();
        res = await fetch(SHEETS_BASE + pathname, {
          method: method,
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(20000)
        });
      } catch (e) {
        if (attempt < 2) { await sleep(600 * (attempt + 1)); continue; }
        throw e;
      }
      if (res.ok) return res.status === 204 ? null : res.json();

      const text = await res.text();
      if (res.status === 401 && attempt < 1) { this.tok = null; continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) { await sleep(1200 * (attempt + 1)); continue; }
      const err = new Error('Sheets API ' + res.status + ': ' + text.slice(0, 400));
      err.status = res.status;
      throw err;
    }
  }

  _rng(a1) { return encodeURIComponent("'" + this.sheetName.replace(/'/g, "''") + "'!" + a1); }

  /* ---------- 起動時の準備（GAS の setup() に相当） ---------- */
  async init() {
    const meta = await this._call('GET', '/v4/spreadsheets/' + this.id +
      '?fields=' + encodeURIComponent('properties.timeZone,sheets.properties(sheetId,title)'));
    const tz = meta.properties && meta.properties.timeZone;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); this.tz = tz; } catch (e) { this.tz = 'Asia/Tokyo'; }

    let sheet = (meta.sheets || []).map((s) => s.properties).find((p) => p.title === this.sheetName);
    if (!sheet) {
      const r = await this._call('POST', '/v4/spreadsheets/' + this.id + ':batchUpdate',
        { requests: [{ addSheet: { properties: { title: this.sheetName } } }] });
      sheet = r.replies[0].addSheet.properties;
    }
    this.sheetId = sheet.sheetId;

    // 見出し行（旧バージョンの6列のシートも、8列に自動で広げる）
    const h = await this._call('GET', '/v4/spreadsheets/' + this.id + '/values/' + this._rng('A1:H1'));
    const cur = (h.values && h.values[0]) || [];
    if (!SHEET_HEADER.every((x, i) => cur[i] === x)) {
      await this._call('PUT', '/v4/spreadsheets/' + this.id + '/values/' + this._rng('A1:H1') + '?valueInputOption=RAW',
        { values: [SHEET_HEADER] });
    }

    // 見た目の設定：見出しを太字、詳細列は「書式なしテキスト」（=SUM() などが式にならないように）、日時列は日時の書式
    const sid = this.sheetId;
    const requests = [
      { repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.91, green: 0.933, blue: 0.969 } } },
          fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
      { updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      { repeatCell: { range: { sheetId: sid, startRowIndex: 1, startColumnIndex: 4, endColumnIndex: 5 },
          cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } },
      { repeatCell: { range: { sheetId: sid, startRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 },
          cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'yyyy/MM/dd HH:mm:ss' } } }, fields: 'userEnteredFormat.numberFormat' } }
    ];
    try {
      await this._call('POST', '/v4/spreadsheets/' + this.id + ':batchUpdate', { requests: requests });
    } catch (e) {
      console.warn('シートの書式設定をスキップしました（動作には影響しません）:', e.message);
    }
  }

  /* ---------- 読み込み ---------- */
  async _load() {
    const j = await this._call('GET', '/v4/spreadsheets/' + this.id + '/values/' + this._rng('A2:H') +
      '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER');
    const rows = [];
    (j.values || []).forEach((r, i) => {
      const lat = Number(r[1]), lng = Number(r[2]);
      if (!r[0] || r[1] === '' || r[2] === '' || r[1] == null || r[2] == null || !isFinite(lat) || !isFinite(lng)) return;   // 壊れた行は無視
      let postedAt = r[5];
      if (typeof postedAt === 'number') postedAt = serialToIso(postedAt, this.tz);
      rows.push({
        row: i + 2,                                  // シート上の行番号（見出しが1行目）
        id: String(r[0]), lat: lat, lng: lng,
        category: String(r[3] == null ? '' : r[3]),
        detail: String(r[4] == null ? '' : r[4]),
        postedAt: postedAt == null ? '' : String(postedAt),
        votes: Number(r[6]) || 0,
        ownerToken: String(r[7] == null ? '' : r[7])
      });
    });
    this.cache = { at: Date.now(), rows: rows };
    return rows;
  }

  async all() {
    if (this.cache && Date.now() - this.cache.at < READ_CACHE_MS) return this.cache.rows;
    if (!this.loading) this.loading = this._load().finally(() => { this.loading = null; });
    return this.loading;
  }

  /* ---------- 書き込み（server.js 側の withLock の中で呼ばれる） ---------- */
  async add(pin) {
    await this._call('POST', '/v4/spreadsheets/' + this.id + '/values/' + this._rng('A:H') +
      ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
      { values: [[pin.id, pin.lat, pin.lng, pin.category, pin.detail, isoToSerial(pin.postedAt, this.tz), pin.votes, pin.ownerToken]] });
    this.cache = null;
  }

  async vote(id) {
    const row = (await this._load()).find((r) => r.id === id);   // 行の位置がずれないよう、必ず最新を読み直す
    if (!row) return null;
    const next = row.votes + 1;
    await this._call('PUT', '/v4/spreadsheets/' + this.id + '/values/' + this._rng('G' + row.row) + '?valueInputOption=RAW',
      { values: [[next]] });
    this.cache = null;
    return next;
  }

  async remove(id, ownerToken) {
    const row = (await this._load()).find((r) => r.id === id);
    if (!row) return 'notfound';
    if (!row.ownerToken || !safeEqual(row.ownerToken, ownerToken)) return 'forbidden';
    await this._call('POST', '/v4/spreadsheets/' + this.id + ':batchUpdate', {
      requests: [{ deleteDimension: { range: { sheetId: this.sheetId, dimension: 'ROWS', startIndex: row.row - 1, endIndex: row.row } } }]
    });
    this.cache = null;
    return 'ok';
  }
}

/* =========================================================
   保存先の選択
========================================================= */
function createStore() {
  const rawId = (process.env.SPREADSHEET_ID || '').trim();
  const rawCred = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();

  if (rawId && rawCred) {
    // スプレッドシートのURLをそのまま貼ってもよいようにする
    const m = rawId.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const spreadsheetId = m ? m[1] : rawId;
    let text = rawCred;
    if (text[0] !== '{') {   // Base64 で貼られた場合にも対応
      try { text = Buffer.from(text, 'base64').toString('utf8'); } catch (e) { /* そのまま */ }
    }
    let credentials;
    try { credentials = JSON.parse(text); } catch (e) {
      console.error('✖ GOOGLE_SERVICE_ACCOUNT_JSON を読み取れません。ダウンロードした JSON ファイルの中身を、そのまま貼り付けてください。');
      process.exit(1);
    }
    if (!credentials.client_email || !credentials.private_key) {
      console.error('✖ GOOGLE_SERVICE_ACCOUNT_JSON に client_email / private_key がありません。サービスアカウントの「キー」の JSON を使ってください。');
      process.exit(1);
    }
    return new SheetsStore({ spreadsheetId: spreadsheetId, sheetName: SHEET_NAME, credentials: credentials });
  }
  if (rawId || rawCred) {
    console.warn('⚠ SPREADSHEET_ID と GOOGLE_SERVICE_ACCOUNT_JSON は、両方そろえて設定してください。今回はローカルの JSON ファイルで動かします。');
  }
  return new FileStore(DATA_FILE);
}

const store = createStore();
let readyPromise = null;
/** 保存先の準備ができるまで待つ（失敗したら次のアクセスでやり直す） */
function ready() {
  if (!readyPromise) {
    readyPromise = store.init()
      .then(() => console.log('✔ 保存先の準備ができました: ' + store.label))
      .catch((e) => { readyPromise = null; console.error('✖ 保存先の準備に失敗しました:', e.message); throw e; });
  }
  return readyPromise;
}

/* =========================================================
   ◯✕ゲーム用の問題データ（GAS 版の getQuizData() と同じ内容）
   a: true=◯(正しい) / false=✕(誤り)
========================================================= */
const QUIZ_DATA = {
  "source": "道路交通法および警察庁などの公開情報をもとに作成（法改正があるため、最新の公式資料もあわせてご確認ください）",
  "categories": [
    {
      "id": "basic",
      "name": "通行ルールの基本",
      "desc": "車道・歩道の走り方、並進、傘さし、スマホ、飲酒など。"
    },
    {
      "id": "crossing",
      "name": "交差点・信号・踏切",
      "desc": "信号、一時停止、二段階右折、横断歩道、踏切での判断。"
    },
    {
      "id": "safety",
      "name": "装備・マナー・制度",
      "desc": "ライト、ヘルメット、賠償責任、青切符など。"
    }
  ],
  "questions": [
    {
      "id": "B01",
      "cat": "basic",
      "a": true,
      "q": "自転車は、道路交通法上「軽車両」にあたり、車の仲間として扱われる。",
      "e": "自転車は軽車両です。車道を通行するのが原則で、交通ルールを守る義務があります。"
    },
    {
      "id": "B02",
      "cat": "basic",
      "a": false,
      "q": "車道を走る自転車は、対向車がよく見える道路の右側を走ったほうが安全である。",
      "e": "自転車は車道の左側端を通行します。右側通行（逆走）は正面衝突の危険が高く、違反です。",
      "g": "逆走＝進行方向に対して右側を通行すること。"
    },
    {
      "id": "B03",
      "cat": "basic",
      "a": true,
      "q": "13歳未満の子どもや70歳以上の人は、「歩道通行可」の標識がなくても歩道を通行できる。",
      "e": "13歳未満・70歳以上・身体の不自由な人は、歩道を通行できます。その場合も歩行者が優先で、車道寄りを徐行します。"
    },
    {
      "id": "B04",
      "cat": "basic",
      "a": true,
      "q": "自転車で歩道を通行できる場合、歩行者の通行を妨げそうなときは一時停止しなければならない。",
      "e": "歩道はあくまで歩行者のための空間です。歩行者の通行を妨げるときは、一時停止が必要です。"
    },
    {
      "id": "B05",
      "cat": "basic",
      "a": true,
      "q": "自転車が2台以上で横に並んで走る「並進」は、「並進可」の標識がある道路でのみ認められている。",
      "e": "並進は「並進可」の標識がある場所に限られます。それ以外では車道を広く占有し、他の交通の妨げになります。"
    },
    {
      "id": "B06",
      "cat": "basic",
      "a": false,
      "q": "雨の日は、片手でハンドルを持っていれば、傘をさして自転車に乗ってもよい。",
      "e": "傘をさしながらの運転は、都道府県の規則で禁止されています。レインコートを使いましょう。",
      "g": "片手運転になりブレーキ操作も遅れるため、とても危険です。"
    },
    {
      "id": "B07",
      "cat": "basic",
      "a": true,
      "q": "自転車の走行中にスマートフォンを手に持って通話したり、画面を注視したりすると、罰則の対象になる。",
      "e": "2024年11月から「ながらスマホ」の罰則が強化されました。事故を起こした場合は、さらに重い罰則があります。"
    },
    {
      "id": "B08",
      "cat": "basic",
      "a": false,
      "q": "自転車は車ではないので、お酒を飲んだあとに運転しても罰則はない。",
      "e": "自転車の酒酔い運転・酒気帯び運転は禁止で、罰則があります。運転者だけでなく、酒類を提供した人や自転車を貸した人も処罰の対象になることがあります。"
    },
    {
      "id": "B09",
      "cat": "basic",
      "a": false,
      "q": "自転車の二人乗りは、友達どうしであれば、どんな場合でも認められている。",
      "e": "二人乗りは原則として禁止です。例外は、16歳以上の運転者が6歳未満の子どもを幼児用座席に乗せる場合などに限られます。"
    },
    {
      "id": "B10",
      "cat": "basic",
      "a": false,
      "q": "前を歩いている人に道をあけてもらうために、自転車のベルを鳴らしてよい。",
      "e": "ベルは「警笛鳴らせ」の標識がある場所や、危険を避けるためにやむを得ないときだけ鳴らします。歩行者をどかすために鳴らすのは違反です。",
      "g": "ベルの正式な名前は「警音器」です。"
    },
    {
      "id": "C01",
      "cat": "crossing",
      "a": true,
      "q": "自転車が車道を通行するときは、原則として車両用の信号機に従う。",
      "e": "車道を通行する自転車は車両として扱われるので、車両用信号に従います。",
      "g": "歩道を通行するときは、歩行者用や「歩行者・自転車専用」の信号に従います。"
    },
    {
      "id": "C02",
      "cat": "crossing",
      "a": false,
      "q": "「止まれ」の標識がある交差点でも、左右に車が見えなければ止まらずに通過してよい。",
      "e": "「止まれ」の標識では、自転車も必ず一時停止し、左右の安全を確認する義務があります。"
    },
    {
      "id": "C03",
      "cat": "crossing",
      "a": true,
      "q": "信号のある交差点で右折する自転車は、原則として「二段階右折」をしなければならない。",
      "e": "交差点をいったん直進して向こう側で止まり、向きを変えて信号に従って進みます。"
    },
    {
      "id": "C04",
      "cat": "crossing",
      "a": true,
      "q": "左右の見通しがきかない交差点では、一時停止の標識がなくても、徐行して安全を確認する必要がある。",
      "e": "見通しの悪い交差点では徐行が義務です。熊本市内でも住宅街の出合い頭の事故が起きています。"
    },
    {
      "id": "C05",
      "cat": "crossing",
      "a": true,
      "q": "踏切の手前では、自転車に乗っていても一時停止して、安全を確かめてから渡る。",
      "e": "踏切の直前では、自転車も一時停止し、左右の安全を確認してから通過します。"
    },
    {
      "id": "C06",
      "cat": "crossing",
      "a": false,
      "q": "自転車に乗ったまま横断歩道を渡るとき、歩行者がいても自転車のほうが優先される。",
      "e": "横断歩道は歩行者優先です。自転車に乗ったままでは車両扱いなので、歩行者の妨げにならないよう注意が必要です。",
      "g": "自転車を降りて押して渡る場合は、歩行者として扱われます。"
    },
    {
      "id": "C07",
      "cat": "crossing",
      "a": true,
      "q": "交差点を左折する自転車は、あらかじめ道路の左端に寄り、徐行して曲がる。",
      "e": "左折のときは、あらかじめ左端に寄り、歩行者や後ろから来る車両に注意して徐行します。"
    },
    {
      "id": "C08",
      "cat": "crossing",
      "a": false,
      "q": "自転車で交差点に近づいたとき信号が黄色に変わったら、速度を上げて急いで渡るのが正しい。",
      "e": "黄色信号は「止まれ」の合図です。停止線の手前で安全に止まれるなら止まります。止まれないほど近いときだけ、周りを確認して通過します。"
    },
    {
      "id": "C09",
      "cat": "crossing",
      "a": false,
      "q": "見通しの悪い交差点では、カーブミラーに車が映っていなければ、一時停止せずに進んでよい。",
      "e": "カーブミラーの像は実際より小さく、距離も分かりにくくなります。ミラーだけに頼らず、一時停止して自分の目で確認します。",
      "g": "カーブミラーは、見通しの悪い交差点などに立てられた、曲がった鏡のことです。"
    },
    {
      "id": "C10",
      "cat": "crossing",
      "a": true,
      "q": "熊本市電の線路を横切るときは、タイヤが溝にはまらないよう、できるだけ直角に近い角度で渡るのがよい。",
      "e": "線路の溝に細いタイヤが挟まると、転倒するおそれがあります。雨の日は線路がぬれて滑りやすいので、ブレーキや急なハンドル操作にも注意します。"
    },
    {
      "id": "S01",
      "cat": "safety",
      "a": true,
      "q": "夜間（日没から日の出まで）は、自転車の前照灯（ライト）を点灯しなければならない。",
      "e": "無灯火は違反です。ライトは「見る」ためだけでなく、周りから「見てもらう」ためにも大切です。"
    },
    {
      "id": "S02",
      "cat": "safety",
      "a": true,
      "q": "自転車の後方には、赤色の反射器材を備える必要がある。",
      "e": "後方からの車に気づいてもらうため、赤色の反射器材（またはテールライト）が必要です。",
      "g": "反射器材は「リフレクター」とも呼ばれます。"
    },
    {
      "id": "S03",
      "cat": "safety",
      "a": true,
      "q": "自転車に乗るときのヘルメット着用は、年齢を問わず努力義務になっている。",
      "e": "2023年4月から、すべての自転車利用者にヘルメット着用の努力義務があります。"
    },
    {
      "id": "S04",
      "cat": "safety",
      "a": false,
      "q": "自転車の事故では、加害者になっても、大きな金銭的賠償を負うことはない。",
      "e": "自転車事故でも、1億円近い賠償を命じられた裁判例があります。自転車保険への加入が大切です。"
    },
    {
      "id": "S05",
      "cat": "safety",
      "a": true,
      "q": "16歳以上の自転車運転者の一定の交通違反に、反則金を納める「青切符」の制度が導入された。",
      "e": "2026年4月から、16歳以上の自転車運転者の一定の違反に対して、反則金（いわゆる青切符）の制度が始まりました。",
      "g": "悪質・危険な違反は、これまでどおり刑事手続きの対象です。"
    },
    {
      "id": "S06",
      "cat": "safety",
      "a": true,
      "q": "自転車には、前輪と後輪の両方を制動できるブレーキが必要である。",
      "e": "前後どちらにも効くブレーキがない自転車は、公道を走れません。毎回の点検が事故を防ぎます。"
    },
    {
      "id": "S07",
      "cat": "safety",
      "a": true,
      "q": "自転車の防犯登録は、法律で義務づけられている。",
      "e": "防犯登録は義務で、盗難にあったときに持ち主を確認する手がかりになります。"
    },
    {
      "id": "S08",
      "cat": "safety",
      "a": true,
      "q": "周囲の音が聞こえない状態でのイヤホン・ヘッドホン使用は、禁止している都道府県が多い。",
      "e": "音が聞こえないと、車や歩行者の接近に気づけません。多くの都道府県の規則で禁止されています。"
    },
    {
      "id": "S09",
      "cat": "safety",
      "a": false,
      "q": "夜間は、ライトを「点滅」モードだけにしておけば、法律で求められる灯火の条件を満たす。",
      "e": "点滅ライトだけでは「灯火」の要件を満たさないとされています。常時点灯を基本にして、点滅は補助として使いましょう。"
    },
    {
      "id": "S10",
      "cat": "safety",
      "a": false,
      "q": "ヘルメットは、一度大きな衝撃を受けても、見た目に傷がなければそのまま使い続けてよい。",
      "e": "ヘルメットは衝撃を吸収して頭を守るため、見た目に傷がなくても内部が傷んでいることがあります。強い衝撃を受けたら、交換しましょう。"
    }
  ]
};

/* =========================================================
   API の処理（Code.gs の関数に対応）
========================================================= */
const postRateByClient = new Map();   // clientId → 次に投稿できる時刻
const postRateByIp = new Map();       // IP → { count, resetAt }
setInterval(() => {
  const now = Date.now();
  postRateByClient.forEach((t, k) => { if (t < now) postRateByClient.delete(k); });
  postRateByIp.forEach((v, k) => { if (v.resetAt < now) postRateByIp.delete(k); });
}, 60 * 1000).unref();

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/** ownerToken（削除用の秘密の鍵）を除いた、公開してよい形にする */
function publicPin(p) {
  return { id: p.id, lat: p.lat, lng: p.lng, category: p.category, detail: p.detail, postedAt: p.postedAt, votes: p.votes };
}

/** 投稿内容の検査（GAS 版の addPin と同じ条件） */
function validatePin(pinData) {
  if (!pinData || typeof pinData.lat !== 'number' || typeof pinData.lng !== 'number'
      || !isFinite(pinData.lat) || !isFinite(pinData.lng)) {
    throw new HttpError(400, '緯度・経度が正しく指定されていません。');
  }
  if (pinData.lat < LAT_RANGE[0] || pinData.lat > LAT_RANGE[1]
      || pinData.lng < LNG_RANGE[0] || pinData.lng > LNG_RANGE[1]) {
    throw new HttpError(400, '熊本県外の場所には投稿できません。');
  }
  const category = ALLOWED_CATEGORIES.indexOf(pinData.category) !== -1 ? pinData.category : 'その他';
  const detail = String(pinData.detail == null ? '' : pinData.detail).trim().slice(0, MAX_DETAIL_LENGTH)
    || '（詳細の記載はありません）';
  return { lat: pinData.lat, lng: pinData.lng, category: category, detail: detail };
}

function newPin(v, ownerToken) {
  return Object.assign({
    id: crypto.randomUUID(), postedAt: new Date().toISOString(), votes: 0, ownerToken: ownerToken || ''
  }, v);
}

async function handleApi(req, res, pathname) {
  const method = req.method;
  let m;

  // 全ピンの取得
  if (pathname === '/api/pins' && method === 'GET') {
    await ready();
    const rows = await store.all();
    return sendJson(res, 200, { ok: true, data: rows.map(publicPin) });
  }

  // ピンの投稿
  if (pathname === '/api/pins' && method === 'POST') {
    const body = await readJson(req);
    const v = validatePin(body.pin);

    const ip = clientIp(req), now = Date.now();
    const lim = postRateByIp.get(ip);
    if (lim && lim.resetAt > now && lim.count >= IP_POST_LIMIT) {
      throw new HttpError(429, '短い時間に投稿が集中しています。しばらくしてからお試しください。');
    }

    const saved = await withLock(async () => {
      await ready();
      const key = String(body.clientId || 'anonymous').slice(0, 64);
      if ((postRateByClient.get(key) || 0) > Date.now()) {
        throw new HttpError(429, '続けて投稿するには、' + POST_INTERVAL_SEC + '秒ほど時間をあけてください。');
      }
      const pin = newPin(v, crypto.randomUUID());
      await store.add(pin);
      postRateByClient.set(key, Date.now() + POST_INTERVAL_SEC * 1000);
      return pin;
    });

    const cur = postRateByIp.get(ip);
    if (cur && cur.resetAt > now) cur.count++; else postRateByIp.set(ip, { count: 1, resetAt: now + IP_POST_WINDOW_MS });

    // ownerToken は、投稿した本人にだけ返す（以後の削除に使う）
    return sendJson(res, 200, { ok: true, data: Object.assign(publicPin(saved), { ownerToken: saved.ownerToken }) });
  }

  // 「ここは危ないと思う」の共感
  if ((m = pathname.match(/^\/api\/pins\/([^/]+)\/vote$/))) {
    if (method !== 'POST') throw new HttpError(405, '許可されていないリクエストです。');
    const id = decodeId(m[1]);
    const votes = await withLock(async () => { await ready(); return store.vote(id); });
    if (votes === null) throw new HttpError(404, 'この投稿は既に削除されています。');
    return sendJson(res, 200, { ok: true, data: votes });
  }

  // ピンの削除（投稿時に渡した ownerToken が一致したときだけ）
  if ((m = pathname.match(/^\/api\/pins\/([^/]+)$/))) {
    if (method !== 'DELETE') throw new HttpError(405, '許可されていないリクエストです。');
    const id = decodeId(m[1]);
    const token = String(req.headers['x-owner-token'] || '');
    const result = await withLock(async () => { await ready(); return store.remove(id, token); });
    if (result === 'forbidden') throw new HttpError(403, '削除できるのは、投稿した本人（同じ端末・ブラウザ）のみです。');
    return sendJson(res, 200, { ok: true, data: result === 'ok' });
  }

  // ◯✕ゲームの問題
  if (pathname === '/api/quiz' && method === 'GET') {
    return sendJson(res, 200, { ok: true, data: QUIZ_DATA });
  }

  throw new HttpError(404, '見つかりません。');
}

function decodeId(raw) {
  let id;
  try { id = decodeURIComponent(raw); } catch (e) { throw new HttpError(400, 'IDが正しくありません。'); }
  if (!id || id.length > 100) throw new HttpError(400, 'IDが正しくありません。');
  return id;
}

/* =========================================================
   HTTP の共通処理
========================================================= */
function baseHeaders(extra) {
  return Object.assign({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  }, extra);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, baseHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  }));
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, baseHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }));
  res.end(text);
}

function readJson(req, limit) {
  limit = limit || 20 * 1024;
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) tooBig = true; else chunks.push(c); });
    req.on('end', () => {
      if (tooBig) return reject(new HttpError(413, '送信データが大きすぎます。'));
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const v = text ? JSON.parse(text) : {};
        resolve(v && typeof v === 'object' ? v : {});
      } catch (e) {
        reject(new HttpError(400, '送信データの形式が正しくありません。'));
      }
    });
    req.on('error', reject);
  });
}

function handleError(req, res, err) {
  if (res.headersSent) { res.end(); return; }
  if (err instanceof HttpError) return sendJson(res, err.status, { ok: false, error: err.message });
  console.error('✖ エラー:', req.method, req.url, err && err.message ? err.message : err);
  if (err && err.status === 429) {
    return sendJson(res, 503, { ok: false, error: 'ただいま混み合っています。少し待ってから、もう一度お試しください。' });
  }
  sendJson(res, 500, { ok: false, error: '保存先との通信に失敗しました。時間をおいて、もう一度お試しください。' });
}

/* ---------- 静的ファイル（public フォルダ）の配信 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
const COMPRESSIBLE = /^(text\/|application\/json|image\/svg)/;
const fileCache = new Map();   // ファイル → { mtimeMs, size, raw, gzip, etag }

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '許可されていないリクエストです。');

  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { throw new HttpError(400, 'URLが正しくありません。'); }
  if (rel.indexOf('\0') !== -1) throw new HttpError(400, 'URLが正しくありません。');
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'ページが見つかりません。');   // ../ で外に出る指定を拒否

  let st;
  try { st = fs.statSync(file); } catch (e) { st = null; }
  if (!st || !st.isFile()) {
    if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    throw new HttpError(404, 'ページが見つかりません。');
  }

  let ent = fileCache.get(file);
  if (!ent || ent.mtimeMs !== st.mtimeMs || ent.size !== st.size) {
    const raw = fs.readFileSync(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    ent = {
      mtimeMs: st.mtimeMs, size: st.size, raw: raw, type: type,
      gzip: COMPRESSIBLE.test(type) && raw.length > 1024 ? zlib.gzipSync(raw) : null,
      etag: 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"'
    };
    fileCache.set(file, ent);
  }

  const headers = baseHeaders({
    'Content-Type': ent.type,
    'ETag': ent.etag,
    'Vary': 'Accept-Encoding',
    // HTML/CSS/JS は毎回「更新があるか」を確認させる（GitHub に反映した変更がすぐ見えるように）
    'Cache-Control': /^(text\/html|text\/css|text\/javascript)/.test(ent.type) ? 'no-cache' : 'public, max-age=86400'
  });
  if (req.headers['if-none-match'] === ent.etag) { res.writeHead(304, headers); return res.end(); }

  const useGzip = ent.gzip && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  const body = useGzip ? ent.gzip : ent.raw;
  if (useGzip) headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

/* =========================================================
   サーバーの起動
========================================================= */
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/healthz') return sendText(res, 200, 'ok');           // Render の死活確認用
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    return serveStatic(req, res, pathname);
  } catch (err) {
    handleError(req, res, err);
  }
});

process.on('unhandledRejection', (e) => console.error('✖ 未処理のエラー:', e));
function shutdown() { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (process.argv.includes('--seed')) {
  // 発表・動作確認用のサンプルピンを5件追加（GAS 版の seedSamplePins に相当）
  (async () => {
    await ready();
    const samples = [
      [32.8032, 130.7079, '見通し不良', '（サンプル）交差点の角に塀があり、左右が見えにくい'],
      [32.7995, 130.7131, '事故多発', '（サンプル）車と自転車の接触が多いと聞く交差点'],
      [32.8061, 130.7012, '段差・悪路', '（サンプル）歩道と車道の境目の段差が大きい'],
      [32.8094, 130.7152, '違法駐輪', '（サンプル）歩道いっぱいに自転車が止められている'],
      [32.7968, 130.6987, 'その他', '（サンプル）夜は街灯が少なく暗い']
    ];
    for (const s of samples) await store.add(newPin({ lat: s[0], lng: s[1], category: s[2], detail: s[3] }, ''));
    console.log('サンプルを ' + samples.length + ' 件追加しました。');
    process.exit(0);
  })().catch((e) => { console.error('✖ 追加に失敗しました:', e.message); process.exit(1); });
} else {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('くまもと交通安全ポータル: http://localhost:' + PORT + ' で起動しました');
    console.log('保存先: ' + store.label);
    if (store instanceof FileStore) {
      console.log('※ 今はローカルの JSON ファイルに保存しています。Render で公開するときは、README の手順でスプレッドシートを設定してください。');
    }
    ready().catch(() => { /* 失敗しても、アクセスのたびにやり直します */ });
  });
}
