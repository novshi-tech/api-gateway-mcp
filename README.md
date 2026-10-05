# api-gateway-mcp

Claude から、既存のコネクタではできない API 呼び出しを行うための、汎用 API ゲートウェイです。Cloudflare Workers で動くリモート MCP サーバーとして、自分の組織の Cloudflare アカウントにデプロイします。

Claude(Cowork など)のコード実行のサンドボックスから、freee や Microsoft 365 などの API を、スクリプトで直接呼べるようになります。一覧の全件取得や集計、ファイルのダウンロード・アップロードのように、コネクタのツールでは手間のかかる作業を、Claude がスクリプトを書いて進めます。

## しくみ

```
Claude ──MCP(OAuth でサインイン)──▶ ゲートウェイ ─┐
  │  issue_token で 15 分のトークンを受け取る       │ 認証情報を注入して中継
  ▼                                                 ▼
サンドボックスのスクリプト ──REST /api/<service>/...──▶ freee・Graph・Gmail などの API
```

- **Claude は認証情報を見ません。** API キーや OAuth のトークンは、ユーザーがゲートウェイの Web 画面で登録し、暗号化して保存されます。Claude が受け取るのは、寿命 15 分のゲートウェイのトークンだけです。
- **サービスは設定で足せます。** 連携先は `wrangler.jsonc` の `SERVICES` に、ベース URL と認証方式(ヘッダーか OAuth 2.0)を書くだけです。OAuth のトークンの更新もゲートウェイが受け持ちます。
- **使い方はスキルで配ります。** API の呼び方は、Claude のスキル(プラグイン)にまとめて配布します。コネクタの URL を含めていないので、どのデプロイでも同じプラグインを使えます。

Claude の Cowork で動作を確認しています。MCP の OAuth に従っているので、ほかの Claude のクライアントや ChatGPT のコネクタにも対応する設計ですが、まだ確認していません。設計の詳細は [docs/concept.md](docs/concept.md) と [docs/auth-design.md](docs/auth-design.md) にあります。

## 前提

- Cloudflare のアカウント(Workers、Durable Objects、KV を使います)
- サインインに使う IdP: Microsoft Entra ID か Google Workspace
- Node.js 24 と npm
- Claude のカスタムコネクタとコード実行を使えるプラン。Team / Enterprise では、組織の管理者がコード実行のネットワーク設定で、ゲートウェイのドメインを許可する必要があります。

## はじめる

いちばん楽なのは、このリポジトリを Claude Code で開いて「ゲートウェイをデプロイしたい」と頼むことです。作業用のスキル(`.agents/skills`。`.claude/skills` はそこへのリンク)が、手順に沿って対話で進めます。

- `deploy`: IdP へのアプリ登録、`wrangler.jsonc` の作成、KV とシークレットの登録、デプロイ、コネクタの追加までと、設定を変えたあとの再デプロイ
- `add-service`: 新しいサービスを足す。認証方式の調査、`SERVICES` の定義、OAuth のシークレット、サービス別のスキルの作成まで。例:「kintone の API をゲートウェイに足して」

手作業で進める場合は、下の「デプロイ」に従ってください。

## 使い方

1. コネクタを追加します。ゲートウェイの Web 画面(`https://<ゲートウェイ>/`)に、追加用のリンクがあります。
   - Pro / Max: 個人の設定で、カスタムコネクタとして `https://<ゲートウェイ>/mcp` を追加します。
   - Team / Enterprise: Owner が組織の設定で同じ URL を追加し、各メンバーが接続します。
2. プラグイン `api-gateway` をインストールします(下の「スキル」)。
3. 各ユーザーは `https://<ゲートウェイ>/` にサインインし、連携先の認証情報を登録します(OAuth のサービスは「接続」)。
4. あとは Claude に頼むだけです。Claude は `list_credentials` で認証情報を確かめ、`issue_token` でトークンを受け取り、スクリプトで REST を呼びます。

```sh
curl -H "Authorization: Bearer $TOKEN" "https://<ゲートウェイ>/api/freee/api/1/companies"
```

## スキル

このリポジトリは Claude のプラグインのマーケットプレイスを兼ねています。プラグイン `api-gateway`(`plugins/api-gateway`)に、ゲートウェイの共通手順と、よく使うサービスのスキルが入っています。

| スキル | サービス名 | できること |
| --- | --- | --- |
| `api-gateway` | — | トークンの発行と、REST の呼び出し(`gw_request.py`)の共通手順。ほかのスキルはこれを使う |
| `freee` | `freee` | 会計・人事労務・請求書・販売の API |
| `microsoft-graph` | `graph` | Outlook メール、OneDrive / SharePoint、Teams、予定表 |
| `gmail` | `gmail` | メールの検索・送信・返信・下書き、添付ファイル |
| `google-drive` | `drive` | ファイルの検索・ダウンロード・エクスポート・アップロード、共有ドライブ |
| `google-calendar` | `calendar` | 予定の検索・作成・更新、空き時間の確認 |
| `gbizinfo` | `gbizinfo` | 経済産業省の法人情報(gBizINFO)の検索 |

インストールの方法:

- Claude Code: `/plugin marketplace add novshi-tech/api-gateway-mcp` のあと、`/plugin install api-gateway@api-gateway-mcp` でインストールします。
- Pro / Max: Customize > Plugins > Add marketplace で `novshi-tech/api-gateway-mcp` を追加し、`api-gateway` をインストールします。
- Team / Enterprise: Owner が Organization settings > Plugins & skills で、このリポジトリ(または、これを参照する社内のマーケットプレイス用リポジトリ)を同期し、配布方法を選びます。
- zip: `npm run plugin:zip` で `dist/api-gateway-<version>.zip` を作り、Plugins の Upload plugin で追加します。更新するときは `plugin.json` の `version` を上げて作り直し、同じ名前でアップロードし直します。2026-09 時点では、個人の Cowork で GitHub のマーケットプレイスの同期に失敗することがありました。その場合は zip を使ってください。

ほかのサービスのスキルは、自分のプラグインに作って足します(`add-service` スキル)。業務に寄ったサービスのスキルは、このリポジトリに入れず、別のプラグインに分けて運用するのがおすすめです。別のプラグインのスクリプトから `gwlib.py` を使うときは、コピーを同梱してください(Claude Code はプラグインごとに別の場所にインストールするため)。

## デプロイ

### 1. IdP にアプリを登録する

ゲートウェイへのサインインに使うアプリを登録し、リダイレクト URI を 2 つ設定します。

- `https://<ゲートウェイ>/oauth/callback`(MCP クライアントの接続)
- `https://<ゲートウェイ>/login/callback`(Web 画面のサインイン)

Entra ID はシングルテナントのアプリとして登録し、`OIDC_ISSUER` を `https://login.microsoftonline.com/<tenant-id>/v2.0` にします。Google は、Workspace のドメインを `ALLOWED_DOMAINS` に必ず指定します(空だと、どの Google アカウントでもサインインできてしまいます)。

### 2. 設定してデプロイする

`wrangler.example.jsonc` を `wrangler.jsonc` にコピーし(git の管理外です)、`vars` に `PUBLIC_URL`、IdP の設定、`SERVICES`(使う連携先)を書きます。KV ネームスペースを作って、ID を `kv_namespaces` に設定します。

```sh
npm ci
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler login
npx wrangler kv namespace create OAUTH_KV
npx wrangler secret put OIDC_CLIENT_SECRET
openssl rand -base64 32 | npx wrangler secret put SIGNING_KEY
openssl rand -base64 32 | npx wrangler secret put ENCRYPTION_KEY
npx wrangler deploy
```

- `ENCRYPTION_KEY` を変えると、登録済みの認証情報は復号できなくなります。
- `SIGNING_KEY` を変えると、発行済みのトークンと MCP の接続が無効になり、ユーザーは接続し直しになります。
- 設定を変えたら、`npx wrangler deploy` で出し直します。

### 3. 連携先を設定する

ヘッダーで認証するサービス(`gbizinfo` など)は、`SERVICES` に書くだけです。ユーザーが Web 画面で API キーやトークンを登録します。

OAuth 2.0 のサービス(`auth.type` が `oauth2`)は、Web 画面から認可コード + PKCE で接続します。連携先にアプリを登録し、コールバック URL に `https://<ゲートウェイ>/connect/callback` を指定します。クライアント ID とシークレットは、サービス名を大文字にした名前で登録します(ハイフンは `_` に)。

```sh
npx wrangler secret put OAUTH_<SERVICE>_CLIENT_ID
npx wrangler secret put OAUTH_<SERVICE>_CLIENT_SECRET
```

アクセストークンは、期限の 1 分前からゲートウェイがリフレッシュします。リフレッシュトークンが失効したら、Web 画面に「再接続」が出ます。

#### freee(`freee`)

freee のアプリ管理でアプリを作成し、コールバック URL を設定します。シークレットは `OAUTH_FREEE_CLIENT_ID` / `OAUTH_FREEE_CLIENT_SECRET` です。

#### Microsoft Graph(`graph`)

サインイン用とは別の Entra アプリを登録します。プラットフォームは「Web」で、`wrangler.example.jsonc` の `scope` にある委任のアクセス許可を付けて、管理者の同意を与えます。`authorization_url` と `token_url` のテナント ID を書き換えます。シークレットは `OAUTH_GRAPH_CLIENT_ID` / `OAUTH_GRAPH_CLIENT_SECRET` です。

#### Google(`gmail`・`drive`・`calendar`)

Google Cloud のプロジェクトで、Gmail API、Google Drive API、Google Calendar API のうち使うものを有効にし、OAuth クライアントを「ウェブ アプリケーション」として作成します。承認済みのリダイレクト URI に `https://<ゲートウェイ>/connect/callback` を登録し、OAuth 同意画面に `wrangler.example.jsonc` のスコープを追加します。同じ OAuth クライアントを 3 つのサービスで共有できますが、シークレットはサービスごとに登録します。

```sh
npx wrangler secret put OAUTH_GMAIL_CLIENT_ID
npx wrangler secret put OAUTH_GMAIL_CLIENT_SECRET
npx wrangler secret put OAUTH_DRIVE_CLIENT_ID
npx wrangler secret put OAUTH_DRIVE_CLIENT_SECRET
npx wrangler secret put OAUTH_CALENDAR_CLIENT_ID
npx wrangler secret put OAUTH_CALENDAR_CLIENT_SECRET
```

- スコープ: Gmail の `gmail.modify` はメールの読み書きと送信、Drive の `drive` は既存のファイルを含む全ファイルの閲覧と管理、Calendar の 3 つは予定の読み書き、カレンダー一覧の参照、空き時間の参照に使います。読み取り専用にするなら `gmail.readonly` / `drive.readonly` などに変えます。詳細は [Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes)、[Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[Calendar](https://developers.google.com/workspace/calendar/api/auth) の公式ドキュメントにあります。
- `authorize_params` の `access_type: offline` と `prompt: consent` は、リフレッシュトークンを受け取るための設定です。
- REST の呼び出し先の例: `/api/gmail/gmail/v1/users/me/messages`、`/api/drive/drive/v3/files`(アップロードは `/api/drive/upload/drive/v3/files`)、`/api/calendar/calendar/v3/calendars/primary/events`

#### gBizINFO(`gbizinfo`)

gBizINFO の Web API 利用申請で API トークンを取得し、ユーザーが Web 画面で登録します。ゲートウェイは `X-hojinInfo-api-token` ヘッダーで送ります。

## 注意

- スクリプトから直接 HTTP を送るときは、`User-Agent` を明示してください。Python の `urllib` の既定値などは、Cloudflare に Error 1010 で拒否されることがあります(付属のスクリプトは設定済み)。
- 調べるときは `npx wrangler tail --format json` でログを流します。ゲートウェイは、中継したリクエストごとに、ユーザー・サービス・パス・ステータスの監査ログを出します。

## 開発

```sh
npm install
cp wrangler.example.jsonc wrangler.jsonc
cp .dev.vars.example .dev.vars   # 値を埋める
npm run dev
npm run typecheck
npm test          # Worker のテストと、スキルのスクリプトのテスト
```

## License

[MIT](LICENSE).
