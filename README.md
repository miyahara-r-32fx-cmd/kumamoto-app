# くまもと交通安全ポータル｜自転車危険マップ（GitHub + Render 版）

熊本市の自転車の危険箇所を地図に投稿・共有し、交通ルールをクイズで学べるWebサイトです。  
もともと Google Apps Script（GAS）で動かしていたものを、**GitHub に置いて Render で公開できる形**に移したものです。サイトの見た目・機能は GAS 版と同じです。

## ファイル構成

```
kumamoto-app/
├─ public/
│   ├─ index.html   画面（HTML）
│   ├─ style.css    デザイン（CSS）
│   └─ script.js    画面の動き（JavaScript）
├─ server.js        サーバー（public の配信 ＋ ピンの保存などの API）
├─ package.json     起動コマンドの設定
├─ README.md        この説明書
└─ .gitignore       GitHub に上げないファイルの指定
```

GAS 版との対応は次のとおりです。

| GAS 版 | この版 |
| --- | --- |
| index.html ＋ style.html ＋ script.html | public/index.html ＋ public/style.css ＋ public/script.js |
| Code.gs | server.js |
| `google.script.run.getPins()` など | `fetch('/api/pins')` など（script.js の `callApi`） |
| スプレッドシート（pins シート） | **同じスプレッドシートをそのまま使えます** |

ライブラリ（Express など）は使っていません。Node.js 標準の機能だけで動くので、`npm install` で何かをダウンロードする必要はありません。

---

## 1. 自分のパソコンで試す（任意）

1. [Node.js](https://nodejs.org/)（18 以上）を入れる
2. このフォルダで次を実行する

```bash
npm start
```

3. ブラウザで <http://localhost:3000> を開く

スプレッドシートの設定をしていないときは、投稿は `data/pins.json` というファイルに保存されます（試すだけならこれで十分です）。  
サンプルのピンを5件入れたいときは `npm run seed` を実行します。

---

## 2. GitHub にアップロードする

`kumamoto-app` リポジトリに、上のファイル構成のとおりに置きます。

- すでにある `public/` の3ファイル（index.html / script.js / style.css）を、この版のものに**置き換え**
- `server.js` と `package.json` も置き換え
- `README.md` を置き換え
- `.gitignore` を追加（GitHub の画面では「Add file → Create new file」でファイル名に `.gitignore` と入力して、中身を貼り付けます）

> ⚠ サービスアカウントのキー（JSON ファイル）は **絶対に GitHub に上げないでください**。
> 次の 3 の手順のとおり、Render の「環境変数」に入れます。

---

## 3. スプレッドシートと連携する（投稿を保存する場所）

Render の無料プランは、再起動するとファイルが消えてしまいます。そのため、これまでと同じ **Google スプレッドシート**に保存します。  
GAS 版で使っていたスプレッドシートをそのまま使えば、**今までの投稿も引き継がれます**（`pins` シート）。

サーバーがスプレッドシートを読み書きできるように、「ロボット用の Google アカウント（サービスアカウント）」を作って、スプレッドシートに招待します。

### 3-1. サービスアカウントを作る

1. [Google Cloud Console](https://console.cloud.google.com/) を開き、**個人の Google アカウント**でログイン  
   （学校の Google アカウントだと、キーの作成が管理者に制限されている場合があります）
2. 画面上部の「プロジェクトを選択」→「新しいプロジェクト」で、プロジェクトを作る（名前は何でも OK）
3. 左メニュー「API とサービス」→「ライブラリ」で **Google Sheets API** を検索して「有効にする」
4. 左メニュー「API とサービス」→「認証情報」→「認証情報を作成」→「サービス アカウント」
   - 名前は何でも OK（例：`kumamoto-app`）→「作成して続行」→ ロールは選ばずに「完了」
5. 作ったサービスアカウントをクリック →「キー」タブ →「鍵を追加」→「新しい鍵を作成」→ **JSON** →「作成」  
   JSON ファイルがダウンロードされます（これが「キー」です。大切に保管）

### 3-2. スプレッドシートを共有する

1. ダウンロードした JSON ファイルを開き、`"client_email"` の値（`〜@〜.iam.gserviceaccount.com`）をコピー
2. スプレッドシートを開き、右上の「共有」→ そのメールアドレスを **「編集者」** で追加（通知はオフで OK）
3. スプレッドシートの URL から **ID** をコピー  
   `https://docs.google.com/spreadsheets/d/`**`ここがID`**`/edit`

---

## 4. Render で公開する

1. [Render](https://render.com/) にログインし、「New」→「Web Service」→ GitHub の `kumamoto-app` リポジトリを選ぶ
2. 次のように設定する

| 項目 | 設定 |
| --- | --- |
| Language / Runtime | Node |
| Branch | main |
| Build Command | `npm install`（何もインストールしないので、空欄でも動きます） |
| Start Command | `npm start` |
| Instance Type | Free |

3. 「Environment Variables」（環境変数）に次の2つを追加する

| Key | Value |
| --- | --- |
| `SPREADSHEET_ID` | 3-2 でコピーしたスプレッドシートの ID（URL まるごとでも可） |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ダウンロードした JSON ファイルの**中身をすべて**貼り付け |

   シート名が `pins` 以外のときだけ、`SHEET_NAME` も追加します（通常は不要）。

4. （任意）「Advanced」の「Health Check Path」に `/healthz` と入力
5. 「Create Web Service」を押す。数分でデプロイが終わり、`https://〜.onrender.com` のURLで見られます

以後は、GitHub の `main` ブランチを更新するたびに、Render が自動で作り直します。

### 動いているかの確認

Render の「Logs」に、次の表示が出れば成功です。

```
✔ 保存先の準備ができました: Googleスプレッドシート（シート名「pins」）
```

---

## 注意とヒント

- **無料プランは、15分アクセスがないと眠ります。** 次に開いたときの起動に、最大1分ほどかかります。  
  発表の前には、一度サイトを開いて起こしておくと安心です。（地図を表示している間は、2分ごとの自動更新でアクセスが続くため、眠りません）
- **投稿の削除（管理者）**：スプレッドシートの行を直接消せば、サイトからも消えます。`ownerToken` 列（H列）は、投稿者だけが削除できるようにするための鍵なので、公開しないでください。
- **URL が変わったことによる違い**：「自分の投稿を削除できる」「共感ずみの印」は、ブラウザに保存されています。GAS 版の URL で投稿したものは、新しい URL のサイトからは自分の投稿として削除できません（スプレッドシートから削除してください）。
- **投稿の回数制限**：同じ端末は15秒に1回まで。同じ回線からは10分間に20件までです（いたずら対策）。`server.js` の上のほうで変更できます。
- **Google の回数制限への対策**：スプレッドシートの読み込み結果は10秒間だけ使い回します。そのため、他の人の投稿が反映されるまでに、最大10秒ほどかかることがあります。

## うまく動かないとき

Render の「Logs」を見ると原因が分かります。

| ログのメッセージ | 原因と対処 |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_JSON を読み取れません` | JSON の貼り付けが途中で切れている。ファイルの中身を、最初の `{` から最後の `}` まで貼る |
| `Sheets API 403` / `The caller does not have permission` | スプレッドシートがサービスアカウントに共有されていない（3-2 を確認） |
| `Sheets API 403` / `Google Sheets API has not been used` | Google Sheets API が有効になっていない（3-1 の手順3） |
| `Sheets API 404` / `Requested entity was not found` | `SPREADSHEET_ID` が違う |
| `Google の認証に失敗しました` | キーが違う、またはキーを削除した。新しいキーを作って貼り直す |
| 画面に「サーバーに接続できませんでした」 | 無料プランが眠っていた可能性。少し待ってから再読み込み |

## API 一覧（server.js）

| メソッド | パス | 内容 | GAS 版の関数 |
| --- | --- | --- | --- |
| GET | `/api/pins` | 全ピンの取得 | `getPins()` |
| POST | `/api/pins` | ピンの投稿 | `addPin()` |
| POST | `/api/pins/:id/vote` | 共感（票を +1） | `votePin()` |
| DELETE | `/api/pins/:id` | 削除（`X-Owner-Token` ヘッダーが必要） | `deletePin()` |
| GET | `/api/quiz` | ◯✕クイズの問題 | `getQuizData()` |
| GET | `/healthz` | 動作確認用 | ― |

3択クイズの問題は、`public/script.js` の中（`QUIZ_BANK`）にあります。◯✕クイズの問題は、`server.js` の中（`QUIZ_DATA`）にあります。問題を増やしたいときは、それぞれの形式に合わせて追加してください。

## ライセンス・出典

- 地図：Leaflet、OpenStreetMap contributors
- アイコン：Lucide（ISC License）
- 交通ルールの内容は、道路交通法および警察庁などの公開情報をもとに作成しています（法改正があるため、最新の公式資料もあわせてご確認ください）。
