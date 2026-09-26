# api-gateway-mcp

Claude Cowork や ChatGPT から、既存のコネクタではできない API 呼び出しを行うための、汎用 API ゲートウェイです。Cloudflare Workers で動くリモート MCP サーバーとして、顧客ごとにデプロイします。

- MCP: OAuth でログインしたユーザーに、寿命の短いゲートウェイトークンを発行します。
- REST: `/api/<service>/<path>` をトークンで受け付け、上流のサービスに認証情報を注入して中継します。ボディは素通しです。
- Web 画面: ユーザーが連携先の認証情報を登録します。

設計は [docs/concept.md](docs/concept.md) と [docs/auth-design.md](docs/auth-design.md) を参照してください。

## 使い方(クライアント側)

1. Claude の組織設定で、カスタムコネクタとして `https://<ゲートウェイ>/mcp` を追加します。
2. 各ユーザーは `https://<ゲートウェイ>/` にサインインし、連携先の認証情報を登録します。
3. Claude は `list_credentials` で認証情報を確かめ、`issue_token` でトークンを受け取ります。
4. サンドボックス内のスクリプトは、そのトークンで REST を呼びます。

```sh
curl -H "Authorization: Bearer $TOKEN" "https://<ゲートウェイ>/api/board/v1/clients"
```

Team / Enterprise では、組織の管理者がコード実行のネットワーク設定で、ゲートウェイのドメインを許可する必要があります。

## デプロイ

### 1. IdP にアプリを登録する

リダイレクト URI を 2 つ登録します。

- `https://<ゲートウェイ>/oauth/callback`(MCP クライアントの接続)
- `https://<ゲートウェイ>/login/callback`(Web 画面のサインイン)

Entra ID はシングルテナントのアプリとして登録し、`OIDC_ISSUER` を `https://login.microsoftonline.com/<tenant-id>/v2.0` にします。Google は Workspace のドメインを `ALLOWED_DOMAINS` に必ず指定します。

### 2. 設定する

`wrangler.jsonc` の `vars` に、`PUBLIC_URL`、IdP の設定、`SERVICES`(連携先)を書きます。KV ネームスペースを作って ID を設定します。

```sh
npx wrangler kv namespace create OAUTH_KV
npx wrangler secret put OIDC_CLIENT_SECRET
openssl rand -base64 32 | npx wrangler secret put SIGNING_KEY
openssl rand -base64 32 | npx wrangler secret put ENCRYPTION_KEY
npx wrangler deploy
```

`ENCRYPTION_KEY` を変えると、登録済みの認証情報は復号できなくなります。

## 開発

```sh
npm install
cp .dev.vars.example .dev.vars   # 値を埋める
npm run dev
npm run typecheck
npm test
```
