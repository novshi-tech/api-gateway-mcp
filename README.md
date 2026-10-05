# api-gateway-mcp

Claude Cowork や ChatGPT から、既存のコネクタではできない API 呼び出しを行うための、汎用 API ゲートウェイです。Cloudflare Workers で動くリモート MCP サーバーとして、顧客ごとにデプロイします。

- MCP: OAuth でログインしたユーザーに、寿命の短いゲートウェイトークンを発行します。
- REST: `/api/<service>/<path>` をトークンで受け付け、上流のサービスに認証情報を注入して中継します。ボディは素通しです。
- Web 画面: ユーザーが連携先の認証情報を登録します。

設計は [docs/concept.md](docs/concept.md) と [docs/auth-design.md](docs/auth-design.md) を参照してください。

## 使い方(クライアント側)

1. コネクタを追加します。ゲートウェイの Web 画面(`https://<ゲートウェイ>/`)に、追加用のリンクがあります。
   - Pro / Max: 個人の設定でカスタムコネクタとして `https://<ゲートウェイ>/mcp` を追加します。
   - Team / Enterprise: Owner が組織の設定で同じ URL を追加し、各メンバーが接続します。
2. 各ユーザーは `https://<ゲートウェイ>/` にサインインし、連携先の認証情報を登録します。
3. Claude は `list_credentials` で認証情報を確かめ、`issue_token` でトークンを受け取ります。
4. サンドボックス内のスクリプトは、そのトークンで REST を呼びます。

```sh
curl -H "Authorization: Bearer $TOKEN" "https://<ゲートウェイ>/api/freee/api/1/companies"
```

## スキル(プラグイン)

このリポジトリは Claude のプラグインのマーケットプレイスを兼ねています。`plugins/api-gateway` に、ゲートウェイの共通手順(`api-gateway`)と、よく使うサービスのスキル(freee、Microsoft Graph、Gmail、Google Drive、Google Calendar、gBizINFO)が入っています。プラグインにはコネクタの URL を含めていないので、どのデプロイでも同じものを使えます。

- Pro / Max: Customize > Plugins > Add marketplace で `novshi-tech/api-gateway-mcp` を追加し、`api-gateway` をインストールします。
- Team / Enterprise: Owner が Organization settings > Plugins & skills で、このリポジトリ(または、これを参照する社内のマーケットプレイス用リポジトリ)を同期し、配布方法を選びます。
- zip でアップロードする場合: `npm run plugin:zip` で `dist/api-gateway-<version>.zip` を作り、Plugins の Upload plugin で追加します。更新するときは `plugin.json` の `version` を上げて作り直し、同じ名前でアップロードし直します。

2026-09 時点では、個人の Cowork で GitHub のマーケットプレイスからのインストールが同期に失敗しました(Claude Code では同じマーケットプレイスからインストールできます)。その場合は zip を使ってください。

Gmail (`gmail`)、Google Drive (`google-drive`)、Google Calendar (`google-calendar`) のスキルも同梱しています。ゲートウェイのサービス名はそれぞれ `gmail` / `drive` / `calendar` です。各スキルは認証情報のラベルで接続アカウントを選び、一覧のページングに対応します。Gmail には送信・返信・下書き用の MIME 生成と添付ファイルの復号、Drive には共有ドライブ・ダウンロード・エクスポート・アップロード、Calendar には予定の検索・作成・更新・空き時間の確認の手順があります。

gBizINFO(`gbizinfo` スキル)は、経済産業省の法人情報の REST API(v2)で法人を検索し、基本情報・財務・補助金などを取得します。ゲートウェイのサービス名は `gbizinfo` で、認証情報には gBizINFO の Web API 利用申請で取得した API トークンを登録します(`wrangler.example.jsonc` に設定例があります)。

ほかのサービスは、自分のプラグインにスキルを作って足します(手順は下の「Claude Code で整える」)。業務に寄ったサービスのスキルは、このリポジトリに入れず、別のプラグインに分けて運用するのがおすすめです。

スクリプトでは `User-Agent` を明示してください。Python の `urllib` の既定値などは、Cloudflare に Error 1010 で拒否されることがあります。

Team / Enterprise では、組織の管理者がコード実行のネットワーク設定で、ゲートウェイのドメインを許可する必要があります。

## デプロイ

### 1. IdP にアプリを登録する

リダイレクト URI を 2 つ登録します。

- `https://<ゲートウェイ>/oauth/callback`(MCP クライアントの接続)
- `https://<ゲートウェイ>/login/callback`(Web 画面のサインイン)

Entra ID はシングルテナントのアプリとして登録し、`OIDC_ISSUER` を `https://login.microsoftonline.com/<tenant-id>/v2.0` にします。Google は Workspace のドメインを `ALLOWED_DOMAINS` に必ず指定します。

### 2. 設定する

`wrangler.example.jsonc` を `wrangler.jsonc` にコピーし(`wrangler.jsonc` は git の管理外です)、`vars` に `PUBLIC_URL`、IdP の設定、`SERVICES`(連携先)を書きます。KV ネームスペースを作って ID を設定します。

```sh
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler kv namespace create OAUTH_KV
npx wrangler secret put OIDC_CLIENT_SECRET
openssl rand -base64 32 | npx wrangler secret put SIGNING_KEY
openssl rand -base64 32 | npx wrangler secret put ENCRYPTION_KEY
npx wrangler deploy
```

`ENCRYPTION_KEY` を変えると、登録済みの認証情報は復号できなくなります。

### 3. OAuth の連携先(freee など)

`SERVICES` で `auth.type` を `oauth2` にした連携先は、Web 画面から OAuth(認可コード + PKCE)で接続します。連携先にアプリを登録し、コールバック URL に `https://<ゲートウェイ>/connect/callback` を指定します。クライアント ID とシークレットは、サービス名を大文字にした名前で登録します。

```sh
npx wrangler secret put OAUTH_FREEE_CLIENT_ID
npx wrangler secret put OAUTH_FREEE_CLIENT_SECRET
```

Microsoft Graph は、サインイン用とは別の Entra アプリを登録します。プラットフォームは「Web」で、`wrangler.example.jsonc` の `scope` にある委任のアクセス許可を付けて、管理者の同意を与えます。

Gmail (`gmail`) と Google Drive (`drive`) は、Google Cloud のプロジェクトで Gmail API と Google Drive API を有効にし、OAuth クライアントを「ウェブ アプリケーション」として作成します。承認済みのリダイレクト URI に `https://<ゲートウェイ>/connect/callback` を登録し、OAuth 同意画面に `wrangler.example.jsonc` のスコープを設定します。同じ OAuth クライアントを両サービスに使うこともできますが、シークレットはサービスごとに登録します。

```sh
npx wrangler secret put OAUTH_GMAIL_CLIENT_ID
npx wrangler secret put OAUTH_GMAIL_CLIENT_SECRET
npx wrangler secret put OAUTH_DRIVE_CLIENT_ID
npx wrangler secret put OAUTH_DRIVE_CLIENT_SECRET
```

Gmail の `gmail.modify` はメールの読み書き・送信、Drive の `drive` は既存ファイルを含む全ファイルの閲覧・管理に使います。読み取り専用にする場合は、それぞれ `gmail.readonly` / `drive.readonly` に変更してください。スコープの詳細は [Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes) と [Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) の公式ドキュメントを参照してください。`authorize_params` の `access_type: offline` と `prompt: consent` は、リフレッシュトークンを取得するための設定です。

デプロイ後、Web 画面からサービスごとに接続します。REST の呼び出し先は、例えば Gmail が `/api/gmail/gmail/v1/users/me/messages`、Drive が `/api/drive/drive/v3/files`、Drive のアップロードが `/api/drive/upload/drive/v3/files` です。

Google Calendar (`calendar`) は、同じ Google Cloud プロジェクトで Calendar API を有効にし、OAuth 同意画面に `wrangler.example.jsonc` の3つのスコープを追加します。予定の読み書き、カレンダー一覧の参照、アクセス可能なカレンダーの空き時間の参照を許可する設定です。Gmail / Drive と同じ OAuth クライアントを使えますが、次の名前でもシークレットを登録し、Web 画面から Calendar に接続します。

```sh
npx wrangler secret put OAUTH_CALENDAR_CLIENT_ID
npx wrangler secret put OAUTH_CALENDAR_CLIENT_SECRET
```

REST の例は `/api/calendar/calendar/v3/users/me/calendarList` と `/api/calendar/calendar/v3/calendars/primary/events` です。スコープの詳細は [Calendar の公式ドキュメント](https://developers.google.com/workspace/calendar/api/auth)を参照してください。

アクセストークンは期限の 1 分前からゲートウェイがリフレッシュします。リフレッシュトークンが失効したら、画面に「再接続」が出ます。

## Claude Code で整える

このリポジトリには、作業用のエージェントスキルを `.agents/skills` に置いています(`.claude/skills` はそこへのリンクです)。Claude Code でリポジトリを開いて頼むと、手順に沿って対話で進めます。

- `deploy`: 自分の Cloudflare アカウントへの初回のデプロイ(IdP のアプリ登録、`wrangler.jsonc`、KV、シークレット、コネクタの追加)と、再デプロイ
- `add-service`: 新しいサービスを足す(認証方式の調査、`SERVICES` の定義、OAuth のシークレット、サービス別のスキルの作成)

例: 「ゲートウェイをデプロイしたい」「kintone の API をゲートウェイに足して」

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
