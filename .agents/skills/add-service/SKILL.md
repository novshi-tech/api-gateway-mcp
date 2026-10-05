---
name: add-service
description: API ゲートウェイに、新しい連携先サービス(外部の REST / GraphQL API)を足す手順。API の認証方式を調べて SERVICES の定義を書き、OAuth のクライアントを登録し、デプロイして、Claude がその API を使うためのサービス別スキルを作るところまでを、ユーザーと対話しながら進める。「○○の API をゲートウェイに足したい」「○○を Claude から使えるようにしたい」「SERVICES に○○を追加して」「○○のスキルを作って」などの依頼で使う。ゲートウェイの初回のデプロイは deploy スキル。
---

# サービスを足す

サービスを 1 つ足すには、次の 3 つをそろえる。

1. ゲートウェイの設定: `wrangler.jsonc` の `vars.SERVICES` にサービスの定義を書く(OAuth ならシークレットも)。
2. デプロイ: `npx wrangler deploy`(deploy スキルの手順 5)。
3. サービス別のスキル: Claude がその API をどう呼ぶかを書いた `SKILL.md`。プラグインに入れて配る。

## 1. 認証方式を調べる

API の公式ドキュメントを読んで、次を確かめる。推測で書かない。分からなければユーザーに聞く。

- ベース URL(https であること)
- 認証方式と、それが下の表のどれに当たるか
- 認証情報をどう発行するか(管理画面で API キー、OAuth アプリの登録など)
- レート制限とページングの方式(サービス別のスキルに書く)

ゲートウェイが注入できるのは、リクエストヘッダーだけ。

| API の認証 | `auth` |
| --- | --- |
| 固定の API キーやトークンをヘッダーで送る | `headers`。ヘッダーごとに `name` と、Web 画面に出す `label`。`Authorization: Bearer <トークン>` なら `"prefix": "Bearer "` |
| OAuth 2.0 の認可コード | `oauth2`。`authorization_url`、`token_url`、必要なら `scope` と `authorize_params` |

次の API は、そのままでは足せない。ユーザーに伝えて、どうするか決めてもらう。

- API キーをクエリパラメータで送る API(ヘッダーでも受け付けないかを先に調べる)
- 署名が要る API(AWS Signature など)、mTLS
- OAuth のクライアントクレデンシャルや、クライアント認証が `client_secret_post` 以外のもの(ゲートウェイはトークンエンドポイントにクライアント ID とシークレットをフォームで送り、PKCE も付ける)
- Basic 認証は `headers` に `"prefix": "Basic "` で書けるが、ユーザーが `ユーザー名:パスワード` の Base64 を自分で作って登録することになる。

## 2. SERVICES に書く

定義の形は `src/config.ts` の `ServiceConfig`。`wrangler.example.jsonc` に、ヘッダー型(`gbizinfo`)と OAuth 型(`freee`、`gmail`、`graph` など)の例がある。

```jsonc
"<service>": {
  "display_name": "Web 画面での表示名",
  "base_url": "https://api.example.com",
  "auth": { "type": "headers", "headers": [{ "name": "x-api-key", "label": "API キー" }] }
}
```

- サービス名は小文字の英数字とハイフン(`^[a-z0-9][a-z0-9-]*$`)。REST のパス `/api/<service>/...` と、スキルでの呼び名になる。
- `base_url` には、API のパスの共通部分を含めてもよい。上流のパスがそのあとにつながる。
- OAuth では、連携先にアプリを登録してもらい、コールバック URL に `<PUBLIC_URL>/connect/callback` を指定してもらう。リフレッシュトークンを出すのに特別なパラメータが要るサービスがある(Google は `access_type: offline` と `prompt: consent`、Entra は `offline_access` のスコープ)。
- OAuth のクライアント ID とシークレットは、サービス名を大文字にしてハイフンを `_` にした名前で登録する。値はユーザーに直接入れてもらい、会話に貼らせない。

```sh
npx wrangler secret put OAUTH_<SERVICE>_CLIENT_ID
npx wrangler secret put OAUTH_<SERVICE>_CLIENT_SECRET
```

書いたら `npm run typecheck` と `npm test` を通して、ユーザーに確認してからデプロイする。デプロイのあと、ユーザーに Web 画面で認証情報を登録(OAuth なら接続)してもらい、`api-gateway` スキルの `gw_request.py` で 1 回呼んで確かめる。

## 3. サービス別のスキルを作る

スキルの置き場所をユーザーと決める。

- 自分だけ・自社だけで使うサービス: ユーザー自身のプラグイン(別リポジトリ)に置く。このリポジトリには入れない。
- 誰でも使えそうな汎用のサービスで、このリポジトリに取り込んでほしい場合: `plugins/api-gateway/skills/<skill>/` に置き、`wrangler.example.jsonc` にも定義を足す。

スキルは、既存の `plugins/api-gateway/skills/gbizinfo`(小さい例)や `freee`(ページングのスクリプトつき)をまねる。

- `SKILL.md` のフロントマターの `name` はディレクトリ名と同じにする。`description` には、何ができるかと、どんな依頼で使うかを具体的に書く(Claude はこれを見てスキルを選ぶ)。
- 本文は「`api-gateway` スキルの手順でトークンを発行する」から始めて、サービス名、API の要点(パス、ページング、レート制限、よくあるエラー)、呼び出しの例を書く。
- エンドポイントが多い API は、`references/` に一覧を分けて、`grep` で必要な節だけ読ませる。公開の OpenAPI や GraphQL のスキーマがあれば、生成スクリプトを `tools/` に置く。
- 全件取得などのスクリプトは `scripts/` に置き、`api-gateway` スキルの `gwlib.py` を使う(User-Agent、リトライ、CSV 出力がそろっている)。
  - 同じプラグインの中なら、`freee_all.py` と同じやり方で隣の `api-gateway` スキルを探す。Cowork はスキルのディレクトリを `<plugin>:<skill>` と名付けるので、パスを決め打ちしない。
  - 別のプラグインなら、Claude Code はプラグインごとに別の場所にインストールするので、`gwlib.py`(と必要なら `gw_request.py`)をスキルの `scripts/` にコピーして同梱する。

## 4. テスト

- このリポジトリの例(`wrangler.example.jsonc`)にサービスを足したときは、`test/gateway.test.ts` の「sends the gBizINFO API token in its own header」にならって、認証情報が正しいヘッダーで上流に届くテストを足す。`list_credentials` のテストにあるサービス一覧も更新する。
- スクリプトを足したときは、`test/scripts/test_skill_scripts.py` の偽のゲートウェイに応答を足して、ページングや CSV のテストを書く。`SkillDocsTest` が、フロントマターと相対リンクを検査する。
- プラグインのスキルを変えたら `plugin.json` の `version` を上げる。
