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
- **よく使うサービスは組み込みです。** freee、Microsoft Graph、Google(Gmail・Drive・Calendar・Docs・Analytics)、board、gBizINFO、Serper は `src/catalog.ts` にあり、OAuth のクライアントを登録すれば使えます。ほかのサービスは、デプロイの設定の `SERVICES` に書くか、管理画面から、ベース URL と認証方式(ヘッダーか OAuth 2.0)を書いて足します。OAuth のトークンの更新もゲートウェイが受け持ちます。
- **使い方はスキルで配ります。** API の呼び方は、Claude のスキル(プラグイン)にまとめて配布します。コネクタの URL を含めていないので、どのデプロイでも同じプラグインを使えます。

Claude の Cowork で動作を確認しています。MCP の OAuth に従っているので、ほかの Claude のクライアントや ChatGPT のコネクタにも対応する設計ですが、まだ確認していません。設計の詳細は [docs/concept.md](docs/concept.md) と [docs/auth-design.md](docs/auth-design.md) にあります。

## 前提

- Cloudflare のアカウント(Workers、Durable Objects、KV を使います)
- サインインに使う IdP: Microsoft Entra ID か Google Workspace
- Node.js 24 と npm
- Claude のカスタムコネクタとコード実行を使えるプラン。Team / Enterprise では、組織の管理者がコード実行のネットワーク設定で、ゲートウェイのドメインを許可する必要があります。

## はじめる

いちばん楽なのは、このリポジトリを Claude Code で開いて「ゲートウェイをデプロイしたい」と頼むことです。作業用のスキル(`.agents/skills`。`.claude/skills` はそこへのリンク)が、手順に沿って対話で進めます。

- `deploy`: IdP へのアプリ登録、デプロイごとの設定(`deployments/<名前>.jsonc`)の作成、KV とシークレットの登録、デプロイ、コネクタの追加までと、設定を変えたあとの再デプロイ
- `add-service`: 新しいサービスを足す。認証方式の調査、`SERVICES` の定義、OAuth のシークレット、サービス別のスキルの作成まで。例:「kintone の API をゲートウェイに足して」

手作業で進める場合は、下の「デプロイ」に従ってください。

## 使い方

1. コネクタを追加します。ゲートウェイの Web 画面(`https://<ゲートウェイ>/`)に、追加用のリンクがあります。
   - Pro / Max: 個人の設定で、カスタムコネクタとして `https://<ゲートウェイ>/mcp` を追加します。
   - Team / Enterprise: Owner が組織の設定で同じ URL を追加し、各メンバーが接続します。
2. プラグイン `api-gateway` と、使う提供元のプラグイン(`api-gateway-google` など)をインストールします(下の「スキル」)。
3. 各ユーザーは `https://<ゲートウェイ>/` にサインインし、連携先の認証情報を登録します(OAuth のサービスは「接続」)。
4. あとは Claude に頼むだけです。Claude は `list_credentials` で認証情報を確かめ、`issue_token` でトークンを受け取り、スクリプトで REST を呼びます。

```sh
curl -H "Authorization: Bearer $TOKEN" "https://<ゲートウェイ>/api/freee/api/1/companies"
```

## スキル

このリポジトリは Claude のプラグインのマーケットプレイスを兼ねています。共通の `api-gateway` を入れ、使う提供元のプラグインを足します。Microsoft 365 だけ、Google だけ、という使い方ができます。

| プラグイン | スキル | サービス名 | できること |
| --- | --- | --- | --- |
| `api-gateway`(必須) | `api-gateway` | — | トークンの発行と、REST の呼び出し(`gw_request.py`)の共通手順。ほかのスキルはこれを前提にする |
| | `board` | `board` | 販売管理 SaaS「board」の案件・見積・請求・発注・支払・顧客などの検索・登録・更新 |
| | `gbizinfo` | `gbizinfo` | 経済産業省の法人情報(gBizINFO)の検索 |
| | `serper` | `serper` | Serper 経由の Google 検索(ウェブ・画像・ニュース・地図・論文など) |
| `api-gateway-microsoft` | `microsoft-graph` | `graph` | Outlook メール、OneDrive / SharePoint、Teams、予定表 |
| `api-gateway-google` | `gmail` | `gmail` | メールの検索・送信・返信・下書き、添付ファイル |
| | `google-drive` | `drive` | ファイルの検索・ダウンロード・エクスポート・アップロード、共有ドライブ |
| | `google-calendar` | `calendar` | 予定の検索・作成・更新、空き時間の確認 |
| | `google-docs` | `docs` | ドキュメントの本文の読み取り、作成、追記・置換・書式の編集 |
| | `google-analytics` | `analytics`・`analytics-admin` | GA4 のレポート取得、アカウントとプロパティの参照(読み取り専用) |
| `api-gateway-freee` | `freee` | `freee` | 会計・人事労務・請求書・販売の API |

インストールの方法:

- Claude Code: `/plugin marketplace add novshi-tech/api-gateway-mcp` のあと、`/plugin install api-gateway@api-gateway-mcp` と、使う提供元のもの(例: `/plugin install api-gateway-microsoft@api-gateway-mcp`)をインストールします。提供元のプラグインは `api-gateway` に依存しているので、先に入れていなくても一緒に入ります。
- Pro / Max: Customize > Plugins > Add marketplace で `novshi-tech/api-gateway-mcp` を追加し、`api-gateway` と使う提供元のプラグインをインストールします。
- Team / Enterprise: Owner が Organization settings > Plugins & skills で、このリポジトリ(または、これを参照する社内のマーケットプレイス用リポジトリ)を同期し、配布方法を選びます。
- zip: `npm run plugin:zip` で `dist/<プラグイン>-<version>.zip` をプラグインごとに作り、Plugins の Upload plugin で追加します。更新するときは `plugin.json` と `.claude-plugin/marketplace.json` の `version` を上げて作り直し、同じ名前でアップロードし直します。Cowork で GitHub のマーケットプレイスの同期がうまくいかないときは、zip を使ってください。

以前の版の `api-gateway`(0.11 まで)は、全部のスキルが 1 つに入っていました。0.12 に上げたら、使う提供元のプラグインを足してください。

スキルのスクリプトが使う共通のファイル(`gwlib.py`、`gw_request.py`、`google_paging.py`)の原本は `lib/plugin/` にあります。Claude Code はプラグインごとに別の場所にインストールし、Cowork はスキルのディレクトリを `<プラグイン>:<スキル>` と名付けるので、スキルからほかのスキルのファイルには届きません。そのため、各スキルの `scripts/` にコピーを置いています。原本を変えたら `npm run plugin:sync` でコピーを更新します(テストがずれを検出します)。

ほかのサービスのスキルは、自分のプラグインに作って足します(`add-service` スキル)。業務に寄ったサービスのスキルは、このリポジトリに入れず、別のプラグインに分けて運用するのがおすすめです。そのスキルにも `gwlib.py` と `gw_request.py` のコピーを同梱してください。

## デプロイ

### 1. IdP にアプリを登録する

ゲートウェイへのサインインに使うアプリを登録し、リダイレクト URI を 2 つ設定します。

- `https://<ゲートウェイ>/oauth/callback`(MCP クライアントの接続)
- `https://<ゲートウェイ>/login/callback`(Web 画面のサインイン)

Entra ID はシングルテナントのアプリとして登録し、`OIDC_ISSUER` を `https://login.microsoftonline.com/<tenant-id>/v2.0` にします。Google は、Workspace のドメインを `ALLOWED_DOMAINS` に必ず指定します(空だと、どの Google アカウントでもサインインできてしまいます)。

### 2. 設定してデプロイする

デプロイ先ごとに、設定を `deployments/<名前>.jsonc` に置きます(`deployments/` は git の管理外です)。名前は自由に付けてよく、1 つの clone で複数のデプロイを扱えます。`wrangler.example.jsonc` をコピーし、`$schema` と `main` のパスの先頭に `../` を付けます。Worker の `name` はデプロイごとに変え、別の Cloudflare アカウントなら `account_id` も書きます。`vars` に `PUBLIC_URL`、IdP の設定を書きます。Microsoft Graph を使うなら `MICROSOFT_TENANT_ID` も書きます。組み込みにないサービスは `SERVICES` に足します。KV ネームスペースを作って、ID を `kv_namespaces` に設定します。

wrangler は、`npm run deploy` / `npm run secret` / `npm run tail` に名前を付けて呼びます(`tools/wrangler.mjs` が `--config deployments/<名前>.jsonc` を渡します)。リポジトリの直下には `wrangler.jsonc` を置かないので、名前を付けずに `npx wrangler deploy` を打っても、どこにもデプロイされません。

```sh
npm ci
mkdir -p deployments
sed -e 's|"node_modules/|"../node_modules/|' -e 's|"src/index.ts"|"../src/index.ts"|' wrangler.example.jsonc > deployments/acme.jsonc
npx wrangler login
npx wrangler kv namespace create OAUTH_KV
npm run secret -- acme put OIDC_CLIENT_SECRET
openssl rand -base64 32 | npm run secret -- acme put SIGNING_KEY
openssl rand -base64 32 | npm run secret -- acme put ENCRYPTION_KEY
npm run deploy -- acme
```

- `ENCRYPTION_KEY` を変えると、登録済みの認証情報は復号できなくなります。
- `SIGNING_KEY` を変えると、発行済みのトークンと MCP の接続が無効になり、ユーザーは接続し直しになります。
- `IDENTITY_SIGNING_KEY` を変えると、`identity` の上流が古い公開鍵をキャッシュしている間は検証に失敗します。上流が JWKS を取り直すまで待つか、上流の公開鍵を差し替えます。
- 設定を変えたら、`npm run deploy -- <名前>` で出し直します。
- 新しい版で Durable Object やその migration が増えたときは(`wrangler.example.jsonc` の `durable_objects` と `migrations`)、各デプロイの設定にも同じものを足してから出し直します。deploy スキルが照らし合わせて直します。

### 3. 連携先を設定する

ヘッダーで認証するサービス(組み込みの `board`・`gbizinfo`・`serper` など)は、設定は要りません。ユーザーが Web 画面で API キーやトークンを登録します。

OAuth 2.0 のサービス(`auth.type` が `oauth2`)は、Web 画面から認可コード + PKCE で接続します。連携先にアプリを登録し、コールバック URL に `https://<ゲートウェイ>/connect/callback` を指定します。クライアント ID とシークレットは、クライアントの名前を大文字にした名前で登録します(ハイフンは `_` に)。組み込みのサービスのクライアントは `FREEE`・`GOOGLE`・`MICROSOFT` の 3 つで、Google の 6 つのサービスは 1 組を共有します。`SERVICES` に足したサービスは、`auth.client` に書いた名前か、なければサービス名がクライアントの名前です。

```sh
npm run secret -- <名前> put OAUTH_<CLIENT>_CLIENT_ID
npm run secret -- <名前> put OAUTH_<CLIENT>_CLIENT_SECRET
```

クライアントが登録されていない OAuth のサービスは、Web 画面にも `list_credentials` にも出ません。以前のサービスごとの名前(`OAUTH_GMAIL_CLIENT_ID` など)は読まなくなったので、古いデプロイでは `OAUTH_GOOGLE_*` / `OAUTH_MICROSOFT_*` を登録し直してください。

アクセストークンは、期限の 1 分前からゲートウェイがリフレッシュします。リフレッシュトークンが失効したら、Web 画面に「再接続」が出ます。

### 管理画面から接続先を足す

デプロイの設定の `ADMINS` にユーザー ID をカンマ区切りで書くと、その人の画面に「接続先の管理」が出ます。ユーザー ID は、Web 画面のトップの一番下にある「アカウントの情報」を開くと表示されます(Entra は `entra_<テナント ID>_<オブジェクト ID>`、Google は `google_<sub>`)。

管理画面で足した接続先(ヘッダーか OAuth 2.0)は、デプロイし直さなくても、全員の「接続を追加」に出ます(反映まで最大 30 秒)。定義は Durable Object(`Registry`)に、OAuth のクライアントシークレットは暗号化して保管します。組み込みと同じ名前は使えず、`SERVICES` に同じ名前があれば `SERVICES` が勝ちます。ベース URL のホストやトークンの URL、クライアント ID を変えると、その接続先の既存の接続は使えなくなり、利用者はつなぎ直すことになります(鍵が新しい向き先に送られないようにするため)。

ゲートウェイのサインインを信頼する自社の API(`auth.type` が `identity`)は、ユーザーが何も登録しません。ゲートウェイがサインイン中のユーザーの ID(`sub`)を Ed25519 で署名し、`Authorization: Bearer <JWT>` として送ります。JWT は `iss` がゲートウェイの URL、`aud` が設定の `audience`、寿命は 5 分です。上流は `https://<ゲートウェイ>/.well-known/jwks.json` の公開鍵で検証します。Claude からは、`list_credentials` に `identity:<サービス名>` という認証情報として見えます。

```jsonc
"murmur": {
  "display_name": "Murmur",
  "base_url": "https://murmur.internal/api",
  // 公開ルートを持たない Worker には、Service Binding で中継する
  "binding": "MURMUR",
  "auth": { "type": "identity", "audience": "murmur" }
}
```

```sh
# 署名鍵(Ed25519 の秘密鍵の JWK)を作って登録する
node -e "crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']).then(k=>crypto.subtle.exportKey('jwk',k.privateKey)).then(j=>console.log(JSON.stringify(j)))" | npm run secret -- <名前> put IDENTITY_SIGNING_KEY
```

`binding` を書いたサービスは、公開のインターネットではなく、デプロイの設定の `services` に書いた Service Binding(`{ "binding": "MURMUR", "service": "murmur" }`)で上流を呼びます。`base_url` のホスト名は使われず、パスだけが意味を持ちます。

#### 人がいないときに Worker が使う接続先(`client_credentials`)

Murmur のように、夜中の通知や定期の見回りでユーザーがいないときにも上流を呼ぶ Worker のために、OAuth 2.0 の client credentials でゲートウェイ自身がトークンを取る接続先を置けます(設計は [docs/background-access.md](docs/background-access.md))。持ち主はユーザーではなくデプロイで、Web 画面にも `list_credentials` にも出ず、REST(`/api/`)からも使えません。

- 管理画面の「接続先を追加」で認証方式に「OAuth 2.0(client credentials)」を選び、トークンの URL・スコープ・クライアント ID・シークレットを入れます。設定ファイルに書くこともできます(クライアントは `OAUTH_<CLIENT>_CLIENT_ID` / `_CLIENT_SECRET`)。
- 呼べるのは、同じ Cloudflare アカウントの Worker が名前付きのエントリポイント `Background` に張った Service Binding からだけです。名前付きのエントリポイントはインターネットに出ないので、呼び出し元との間のシークレットは要りません。そのアカウントに Worker をデプロイできる人は使える、という信頼の置き方です。
- パスは `/<サービス名>/<上流のパス>`(`/api` は付けない)。ヘッダーの扱いとリダイレクトは REST と同じです。
- アクセストークンは期限の 1 分前まで Worker のメモリで使い回し、保管しません。
- 上流のアプリの権限は、読ませるものだけに絞ってください(Entra なら `Mail.Read` のアプリの権限と、Exchange の RBAC for Applications の管理スコープ)。

```jsonc
"graph-app": {
  "display_name": "Microsoft Graph(アプリ)",
  "provider": "Microsoft",
  "base_url": "https://graph.microsoft.com",
  "auth": {
    "type": "client_credentials",
    "client": "murmur-app",
    "token_url": "https://login.microsoftonline.com/<テナント ID>/oauth2/v2.0/token",
    "scope": "https://graph.microsoft.com/.default"
  }
}
```

```jsonc
// 呼び出す側(Murmur)の wrangler の設定
"services": [{ "binding": "GATEWAY", "service": "<ゲートウェイの Worker 名>", "entrypoint": "Background" }]
// コード: await env.GATEWAY.fetch("https://gateway/graph-app/v1.0/users/shared@example.com/mailFolders/inbox/messages/delta")
```

#### freee(`freee`)

freee のアプリ管理でアプリを作成し、コールバック URL を設定します。シークレットは `OAUTH_FREEE_CLIENT_ID` / `OAUTH_FREEE_CLIENT_SECRET` です。

#### Microsoft Graph(`graph`)

サインイン用とは別の Entra アプリを登録します。プラットフォームは「Web」で、`src/catalog.ts` の `GRAPH_SCOPE` にある委任のアクセス許可を付けて、管理者の同意を与えます。デプロイの設定の `MICROSOFT_TENANT_ID` にテナント ID を書きます。シークレットは `OAUTH_MICROSOFT_CLIENT_ID` / `OAUTH_MICROSOFT_CLIENT_SECRET` です。

#### Google(`gmail`・`drive`・`calendar`・`docs`・`analytics`・`analytics-admin`)

Google Cloud のプロジェクトで、Gmail API、Google Drive API、Google Calendar API、Google Docs API、Google Analytics Data API、Google Analytics Admin API のうち使うものを有効にし、OAuth クライアントを「ウェブ アプリケーション」として作成します。承認済みのリダイレクト URI に `https://<ゲートウェイ>/connect/callback` を登録し、OAuth 同意画面に `src/catalog.ts` のスコープを追加します。6 つのサービスで 1 つの OAuth クライアントを共有します。

```sh
npm run secret -- <名前> put OAUTH_GOOGLE_CLIENT_ID
npm run secret -- <名前> put OAUTH_GOOGLE_CLIENT_SECRET
```

- スコープ: Gmail の `gmail.modify` はメールの読み書きと送信、Drive の `drive` は既存のファイルを含む全ファイルの閲覧と管理、Calendar の 3 つは予定の読み書き、カレンダー一覧の参照、空き時間の参照、Docs の `documents` はドキュメントの本文の読み書き、Analytics の `analytics.readonly` は GA4 のレポートとプロパティの読み取りに使います(Data API と Admin API はホストが別なので、サービスも 2 つに分けています)。読み取り専用にするなら、`SERVICES` に同じ名前でサービスを書いて、スコープを `gmail.readonly` / `drive.readonly` / `documents.readonly` などに変えます。詳細は [Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes)、[Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[Calendar](https://developers.google.com/workspace/calendar/api/auth)、[Docs](https://developers.google.com/workspace/docs/api/auth) の公式ドキュメントにあります。
- `authorize_params` の `access_type: offline` と `prompt: consent` は、リフレッシュトークンを受け取るための設定です。
- REST の呼び出し先の例: `/api/gmail/gmail/v1/users/me/messages`、`/api/drive/drive/v3/files`(アップロードは `/api/drive/upload/drive/v3/files`)、`/api/calendar/calendar/v3/calendars/primary/events`、`/api/docs/v1/documents/{id}`、`/api/analytics/v1beta/properties/{id}:runReport`、`/api/analytics-admin/v1beta/accountSummaries`

#### board(`board`)

board の API 設定で API キーと API トークンを発行し、ユーザーが Web 画面で登録します。ゲートウェイは API キーを `x-api-key` ヘッダー、トークンを `Authorization: Bearer` で送ります。トークンごとに使えるエンドポイントが決まっているので、使う API の権限を付けて発行します。

#### gBizINFO(`gbizinfo`)

gBizINFO の Web API 利用申請で API トークンを取得し、ユーザーが Web 画面で登録します。ゲートウェイは `X-hojinInfo-api-token` ヘッダーで送ります。

#### Serper(`serper`)

[serper.dev](https://serper.dev) のダッシュボードで API キーを発行し、ユーザーが Web 画面で登録します。ゲートウェイは `X-API-KEY` ヘッダーで送ります。ページの本文取得(`scrape.serper.dev`)はホストが別なので、このサービスでは扱いません。

## 注意

- スクリプトから直接 HTTP を送るときは、`User-Agent` を明示してください。Python の `urllib` の既定値などは、Cloudflare に Error 1010 で拒否されることがあります(付属のスクリプトは設定済み)。
- 調べるときは `npm run tail -- <名前> --format json` でログを流します。ゲートウェイは、中継したリクエストごとに、ユーザー・サービス・パス・ステータスの監査ログを出します。

## 開発

```sh
npm install
cp .dev.vars.example .dev.vars   # 値を埋める
npm run dev       # wrangler.example.jsonc で動かす
npm run typecheck
npm test          # Worker のテストと、スキルのスクリプトのテスト
```

## License

[MIT](LICENSE).
