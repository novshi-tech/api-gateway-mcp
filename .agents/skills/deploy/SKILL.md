---
name: deploy
description: api-gateway-mcp を自分の Cloudflare アカウントにセルフホストする手順。IdP(Entra ID / Google)へのアプリ登録、wrangler.jsonc の作成、KV とシークレットの登録、wrangler deploy、Claude へのコネクタ追加、プラグインの導入までを、ユーザーと対話しながら進める。設定を変えたあとの再デプロイも扱う。「ゲートウェイをデプロイしたい」「セルフホストしたい」「初期設定をして」「設定を変えたので出し直して」などの依頼で使う。サービスを足すだけなら add-service スキル。
---

# ゲートウェイをデプロイする

ゲートウェイは Cloudflare Workers で動く。デプロイ先ごとに、IdP のアプリ、`wrangler.jsonc`、KV、シークレットを 1 組ずつ持つ。手順の正本は README の「デプロイ」の節なので、まず読んでから進める。

## 進め方

1. 現状を確かめる。
   - `wrangler.jsonc` があるか(git の管理外)。あれば初回ではなく更新なので、手順 5 に進む。
   - `npx wrangler whoami` で Cloudflare にログインしているか。していなければ、ユーザーに `npx wrangler login` を実行してもらう(ブラウザが要る。GUI のないマシンでは、SSH のポート転送で 8976 を通す)。
2. ユーザーに決めてもらう。推測で埋めない。
   - 公開 URL(`PUBLIC_URL`)。workers.dev なら `https://api-gateway-mcp.<サブドメイン>.workers.dev`。独自ドメインなら、その設定もする。
   - IdP: Microsoft 365 の組織なら Entra ID、Google Workspace なら Google。
   - 最初に使うサービス。`wrangler.example.jsonc` の `SERVICES` から、要らないものを消す。例にないサービスは、デプロイのあとで add-service スキルで足す。
3. IdP にアプリを登録してもらう。Claude が IdP の管理画面を操作することはできないので、README の手順を示して、ユーザーにやってもらう。
   - リダイレクト URI: `<PUBLIC_URL>/oauth/callback` と `<PUBLIC_URL>/login/callback`
   - 受け取るもの: クライアント ID と、Entra ならテナント ID。クライアントシークレットは会話に貼らせず、手順 4 で直接 `wrangler secret put` に入れてもらう。
4. 設定とシークレット。
   - `cp wrangler.example.jsonc wrangler.jsonc` して、`PUBLIC_URL`、`IDP_TYPE`、`OIDC_ISSUER`、`OIDC_CLIENT_ID`、`ALLOWED_TENANTS` / `ALLOWED_DOMAINS`、`SERVICES` を書く。Google では `ALLOWED_DOMAINS` を必ず指定する(空だと誰でもサインインできてしまう)。
   - `npx wrangler kv namespace create OAUTH_KV` の結果の ID を `kv_namespaces` に書く。
   - シークレット: `OIDC_CLIENT_SECRET` はユーザーに対話で入れてもらう。`SIGNING_KEY` と `ENCRYPTION_KEY` は `openssl rand -base64 32 | npx wrangler secret put <名前>` で作る。値を表示したり、ファイルに残したりしない。
   - OAuth の連携先(freee、Google、Microsoft Graph など)は、サービスごとに `OAUTH_<SERVICE>_CLIENT_ID` / `_CLIENT_SECRET` が要る。README の「OAuth の連携先」に従う。
5. デプロイする。
   - 先に `npm ci`、`npm run typecheck`、`npm test` を通す。
   - `npx wrangler deploy --dry-run --outdir <一時ディレクトリ>` で、ビルドと `wrangler.jsonc` の読み込みを先に確かめる(アップロードはしない)。
   - `npx wrangler deploy`。デプロイは外に出る操作なので、実行前にユーザーに確認する。エージェントの権限設定で止められたら、ユーザー自身に実行してもらう(Claude Code なら `! npx wrangler deploy`)。
   - 失敗したら、エラーをそのまま見せる。`SERVICES` の検証エラー(`invalid service name`、`must be https`、`unsupported auth`)は `src/config.ts` の `parseServices` が出している。
6. 動作を確かめる。
   - `<PUBLIC_URL>/` をユーザーに開いてもらい、サインインと認証情報の登録ができるか見てもらう。
   - Claude にコネクタ `<PUBLIC_URL>/mcp` を追加してもらう(Pro / Max は個人の設定、Team / Enterprise は Owner が組織の設定)。
   - プラグイン `api-gateway` を入れてもらう(README の「スキル(プラグイン)」)。Team / Enterprise では、コード実行のネットワーク設定でゲートウェイのドメインを許可する必要がある。
   - 調べるときは `npx wrangler tail --format json` をバックグラウンドで流して、ユーザーに操作を再現してもらう。

## 注意

- `ENCRYPTION_KEY` を作り直すと、登録済みの認証情報はすべて復号できなくなる。更新のデプロイでは触らない。
- `SIGNING_KEY` を作り直すと、発行済みのトークンと MCP の接続が切れる。ユーザーは接続し直しになる。
- `wrangler.jsonc` には KV の ID やテナント ID が入る。git に入れない(`.gitignore` 済み)。

