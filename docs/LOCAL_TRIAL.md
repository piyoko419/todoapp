# 手元のPCで動作確認する

LINE 通知が実際に届くところまでを、自分の PC だけで確かめる手順です。
公開サーバーは用意せず、[ngrok](https://ngrok.com/) で一時的にトンネルを張ります。

**前提**: Messaging API チャネルを作成済み（[LINE_SETUP.md](LINE_SETUP.md) の手順 0〜1）

---

## 全体像

ターミナル（黒い画面）を **3 枚**使います。1 と 2 は開きっぱなしにします。

| ターミナル | 実行するもの | 役割 |
| --- | --- | --- |
| ① | `bun run dev` | アプリ本体。閉じるとアプリが止まる |
| ② | `ngrok http 3000` | LINE から届くようにトンネルを開ける。閉じると届かなくなる |
| ③ | `bun run line:webhook …` / `bun run line:check` | 設定コマンド。使うときだけ |

ターミナルの開き方: **Mac** は「ターミナル」アプリ（`command + スペース` → `ターミナル`）、
**Windows** は「PowerShell」（スタートメニューで `powershell`）。
新しいタブは Mac が `command + T`、Windows が `Ctrl + Shift + T` です。

## 0. 道具を入れる

### Mac

```bash
# Bun（JavaScript の実行環境）
curl -fsSL https://bun.sh/install | bash

# Git（入っていなければ）
xcode-select --install

# ngrok
brew install ngrok
```

`brew` が無い場合は <https://ngrok.com/download> から zip を落として展開してください。

### Windows（PowerShell）

```powershell
# Bun
powershell -c "irm bun.sh/install.ps1 | iex"

# Git と ngrok
winget install Git.Git
winget install ngrok.ngrok
```

`winget` が無い場合は <https://git-scm.com/download/win> と
<https://ngrok.com/download> から入れてください。

### 共通: ngrok の認証トークンを登録する

<https://dashboard.ngrok.com/signup> で無料登録し、表示される認証トークンを登録します。
**これをやらないと `ngrok http 3000` が動きません。**

```bash
ngrok config add-authtoken ここに認証トークン
```

インストール後は**ターミナルを閉じて開き直す**と、コマンドが認識されます。
確認:

```bash
bun --version
git --version
ngrok version
```

> Node.js 20 以上をお使いの場合も動きます。`bun install` → `npm install`、
> `bun run dev` → `npm run dev` と読み替えてください。

## 1. リポジトリを手元に取得する

```bash
git clone https://github.com/piyoko419/todoapp.git
cd todoapp
git checkout claude/cleaning-reservation-system-1f4ii7
bun install
```

## 2. `.env.local` を作る

`.env.example` を複製して、値を書き込みます。**このファイルは Git に入りません。**

```bash
cp .env.example .env.local
```

`.env.local` をテキストエディタで開き、次の 2 行に値を入れます。

```
LINE_CHANNEL_SECRET=ここにチャネルシークレット
LINE_CHANNEL_ACCESS_TOKEN=ここにチャネルアクセストークン
```

- **ファイル名の先頭のドットを消さないこと**（`env.local` では読み込まれません）
- 値をクォート（`"`）で囲まないこと
- `LINE_STAFF_GROUP_ID` と `DATA_DIR` は空のままで構いません

値の取得場所:

| 値 | 取得場所 |
| --- | --- |
| チャネルシークレット | LINE Developers コンソール → チャネル基本設定 |
| チャネルアクセストークン（長期） | LINE Developers コンソール → Messaging API設定 → 「発行」 |

## 3. アプリを起動する

```bash
bun run dev
```

ブラウザで <http://localhost:3000> を開きます。
**ダッシュボードに「LINE 連携が未設定です」の警告が出ていなければ、環境変数は正しく読めています。**
出ている場合は `.env.local` のファイル名・置き場所を確認し、`bun run dev` を再起動してください。

## 4. ngrok で一時的に公開する

`bun run dev` は動かしたまま、**別のターミナル**を開いて実行します。

```bash
ngrok http 3000
```

`Forwarding` の行に出る `https://` から始まる URL を使います。

```
Forwarding  https://xxxx-xx-xx-xx-xx.ngrok-free.app -> http://localhost:3000
```

## 5. Webhook URL を LINE に登録する

**コマンドで登録できます。**管理画面に貼り付ける必要はありません。
さらに 3 つ目のターミナルを開き、ngrok が出した URL を渡します。

```bash
bun run line:webhook https://xxxx-xx-xx-xx-xx.ngrok-free.app
```

`/api/line/webhook` は自動で付きます。登録のあと疎通テストまで走るので、

```
■ Webhook URL を登録します
  https://xxxx-xx-xx-xx-xx.ngrok-free.app/api/line/webhook
  ✓ 登録しました

■ 疎通テスト (POST /v2/bot/channel/webhook/test)
  ✓ アプリが応答しました (HTTP 200)
```

ここまで出れば、LINE からアプリまでの経路が通っています。

<details>
<summary>手動で登録する場合</summary>

LINE Official Account Manager → **設定 → Messaging API** の「Webhook URL」に
`https://xxxx-xx-xx-xx-xx.ngrok-free.app/api/line/webhook` を入れて **保存**。
</details>

## 6. 応答設定を切り替える

LINE Official Account Manager → **設定 → 応答設定**

| 項目 | 設定 | 理由 |
| --- | --- | --- |
| **Webhook** | **オン** | これがオフだとアプリに何も届きません |
| **応答メッセージ** | **オフ** | LINE の自動応答が先に返って、アプリの返信とぶつかります |
| あいさつメッセージ | 任意 | アプリ側も友だち追加時に使い方を返します |
| チャット | オフ | 手動チャットを併用したい場合のみオン |

このトグルだけは API が無いため、管理画面での操作が必要です。
切り替えたら、次のコマンドで正しく反映されたか確認できます。

```bash
bun run line:check
```

```
■ アカウント情報 (GET /v2/bot/info)
  ✓ アカウント名: くわん清掃 @123abcd
  ✓ 応答モード: bot（このアプリが応答します）

■ Webhook の登録状況 (GET /v2/bot/channel/webhook/endpoint)
  ✓ 登録済み: https://xxxx-xx-xx-xx-xx.ngrok-free.app/api/line/webhook
  ✓ Webhook は有効です
```

「応答モード: chat」と出た場合は、応答設定の切り替えがまだ効いていません。

## 7. 動作を確認する

上から順に試すと、どこで止まったかが分かります。

| # | やること | 期待される結果 |
| --- | --- | --- |
| 1 | 公式アカウントを友だち追加 | 使い方の案内が返ってくる |
| 2 | `スタッフ登録 山田太郎`（自分の名前）と送信 | 「登録しました」が返る |
| 3 | <http://localhost:3000/board> のスタッフ欄を見る | その名前が「LINE連携済」で出る |
| 4 | <http://localhost:3000/intake> で「サンプルを入れる」→ 解析する | 5 居室に分解され、338号室が至急・剥離になる |
| 5 | 「5件を登録してLINEに通知」 | LINE に案件カードが届く |
| 6 | カードの「この案件を受ける」を押す | 「受諾済に更新しました」が返り、`/board` にも反映される |
| 7 | `一覧` と送信 | 未完了の案件がカードで並ぶ |
| 8 | カードで「作業開始」→「完了報告」 | 状態が完了まで進み、`/board` から消える（完了表示に切替で見える） |

## 確認が終わったら

**`ngrok` のターミナルで Ctrl+C を押して停止してください。**

このアプリには**ログイン機能がありません**。ngrok で公開している間は、
URL を知っている人なら誰でも案件の閲覧・変更ができます。
ランダムな URL なので現実的なリスクは低いものの、開けっ放しにする意味はありません。

## うまくいかないとき

まず `bun run line:check` を実行してください。トークン・応答モード・Webhook 登録状況が
一度に出るので、どこが崩れているか分かります。

| 症状 | 確認すること |
| --- | --- |
| 友だち追加しても何も返らない | 応答設定の **Webhook がオン**か。ngrok のターミナルに `POST /api/line/webhook 200` が出ているか |
| ngrok に 401 が出ている | チャネルシークレットが一致していない。**再発行した後の貼り替え忘れ**が典型 |
| 返信が来るが案件カードが届かない | アクセストークンを確認。`bun run dev` のログの `[line]` 行に 401/403 が出ていないか |
| LINE の定型文が混ざる | 応答設定の「応答メッセージ」をオフに |
| ngrok の URL が変わった | 無料プランは起動ごとに変わります。手順 5 をやり直してください |
| Webhook に HTML が返っている | ngrok の警告ページ。`ngrok http 3000` を貼り直すか、ngrok に認証トークンを登録してください |
| PC をスリープさせたら届かなくなった | `bun run dev` と `ngrok` が動いている間だけ通知が届きます |

## 本番運用に移すとき

この手順は**検証用**です。日々の業務で使うには、

1. **常時起動する置き場所**（データが消えないホスティング、または社内サーバー）
2. **画面のログイン機能**（現状は URL を知れば誰でも開けます）

の 2 つが必要です。置き場所によっては保存方式（現在は `data/db.json` へのファイル書き込み）の
差し替えが必要になります。詳しくは [README](../README.md#データの保存先) を参照してください。
