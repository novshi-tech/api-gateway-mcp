# スタンドからの接続手順（Cowork / Claude Code）

認可の接続の形は (B)（2026-10-16 決定）: スタンドから見える MCP は API ゲートウェイの 1 つだけ。
Murmur の本体はゲートウェイの上流サービス `murmur` として登録され、ゲートウェイが User ID を署名して Service Binding 越しに伝える。

## ゲートウェイ側（api-gateway-mcp、0003 を参照）

ゲートウェイには、認証方式 `identity` と Service Binding での中継が入っている（api-gateway-mcp の README「連携先を設定する」）。

1. 署名鍵を作って登録する

   ```sh
   node -e "crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']).then(k=>crypto.subtle.exportKey('jwk',k.privateKey)).then(j=>console.log(JSON.stringify(j)))" | npx wrangler secret put IDENTITY_SIGNING_KEY
   ```

2. ゲートウェイのデプロイの設定（`deployments/<名前>.jsonc`）に Service Binding とサービスの定義を足して、デプロイする。Service Binding は同じ Cloudflare アカウントの中でしか張れないので、Murmur はゲートウェイと同じアカウントに置く

   ```jsonc
   "services": [{ "binding": "MURMUR", "service": "murmur" }],
   "vars": {
     "SERVICES": {
       "murmur": {
         "display_name": "Murmur",
         "base_url": "https://murmur.internal/api",
         "binding": "MURMUR",
         "auth": { "type": "identity", "audience": "murmur" }
       }
     }
   }
   ```

3. `<gateway>/.well-known/jwks.json` の中身を、本体の `GATEWAY_JWKS` に設定する。`IDENTITY_ISSUER` にはゲートウェイの PUBLIC_URL を設定する
4. スタンド用スキルは nvt-api-gateway-skills のプラグイン `nvt-api-gateway` に入っている。api-gateway プラグインと一緒にインストールする。
   v2（スレッドとリンク）の版はプラグイン 0.3.0（スキルのリポの c3e4c41）。下書きの `docs/stand/skill-murmur.md` と同じ内容

## 本体の準備

デプロイの設定は `deployments/<名前>.jsonc`（`docs/adr/0029`）。`deployments/` には、デプロイする人の private リポジトリを clone する。
ひな形 `wrangler.example.jsonc` からデプロイの設定を作るときは、`$schema`・`main`・`migrations_dir` のパスの先頭に `../` を付け、`account_id`（ゲートウェイと同じアカウント）・`IDENTITY_ISSUER`・`GATEWAY_JWKS`・D1 の `database_id` を書く。
受信の Webhook と管理画面を使うなら `workers_dev` を `true` にする。

```sh
pnpm install
git clone <デプロイの設定のリポジトリ> deployments
# D1 を作り（日本のチームなら apac）、出力の database_id を deployments/<名前>.jsonc に書く（初回だけ）
pnpm exec wrangler d1 create murmur --location apac
# マイグレーション（drizzle/ を当てる。スキーマを変えたらデプロイの前に手で当てる）
pnpm db:migrate <名前>
pnpm run deploy <名前>
# secrets
pnpm secret <名前> put ANTHROPIC_API_KEY
pnpm secret <名前> put WEBHOOK_SECRET
pnpm secret <名前> put TIMELINE_TOKEN   # 管理画面（/admin・timeline.html）を見る人だけに渡す
```

設定を変えたら、設定のリポジトリにコミットしてプッシュする。CI はデプロイしない。

マスタの `User.id` は、ゲートウェイの User ID（`entra_<tenant-id>_<object-id>` / `google_<sub>`）にする。
マスタ（seed）の投入は `pnpm seed <scenario> --deployment <名前> --user <seed の User ID>=<ゲートウェイの User ID>`（SQL を作って `wrangler d1 execute` で流す）。
DB を空にしてから `fixtures/<scenario>/seed.json` を入れるので、シナリオは 1 つずつ回す。受信は `POST /webhooks/dummy`（本文は InboundSignal の配列、`x-murmur-signature` は
WEBHOOK_SECRET の HMAC-SHA256 hex）で流し込む。

## Cowork

1. Cowork の設定で API ゲートウェイの MCP コネクタを有効にする（既存のもの。追加の MCP は不要）
2. プラグイン `api-gateway` と `nvt-api-gateway` をインストールし、スキル `murmur` を有効にする
3. 「自分の番のものを見せて」で `GET /threads?filter=my_turn`（list_threads）が呼ばれることを確認する

## Claude Code

1. `claude mcp add` でゲートウェイの MCP を追加する（既に使っていればそのまま）
2. マーケットプレイス `novshi-tech/api-gateway-mcp` と `novshi-tech/nvt-api-gateway-skills` を追加し、`api-gateway` と `nvt-api-gateway` のプラグインをインストールする
3. 同じく list_threads で確認する

## 複数の組織を使い分けるとき（`docs/adr/0018`、api-gateway-mcp の `docs/adr/0004`）

Murmur とゲートウェイは「1 つの接続 = 1 つの組織（IdP が 1 つ）」が前提。1 人のユーザが複数の組織にまたがる対応は本体にもゲートウェイにも入れない（適切なセキュリティ境界を引けないため）。
別の組織の Murmur を使うときは、その組織のゲートウェイを**別のコネクタとして並べてつなぐ**。切り替えは要らない。

- Cowork / Claude Code とも、組織ごとのゲートウェイの `<ゲートウェイ>/mcp` を別々のコネクタとして追加する。コネクタには組織が分かる名前を付ける。ゲートウェイの設定 `ORGANIZATION_NAME` が、コネクタの説明と `list_credentials` の `gateway.organization` に出る
- スキルは 1 回入れれば全部のコネクタで使う。`api-gateway` スキル（0.14.0 から）の「コネクタの選び方」で作業する組織のコネクタを選び、Murmur の記録もその組織のコネクタで行う
- どの Claude にどのゲートウェイをつなぐかは使う側が決める。組織が契約している Claude（Team / Enterprise）には、その組織のゲートウェイだけをつなぐ

## H7（スタンド主導の完走）の回し方

1. `fixtures/absence` と `fixtures/complaint` の seed を投入し、`signals.jsonl` の受信だけを Webhook で時刻順に流す
2. ユーザーは Claude に指示（「この欠勤の代わりを探して」「送って」）と送信の確認だけを出し、持ち主・メモ・リンク・属性・送信の記録はスタンドに任せる
3. 終わったら、実際に呼ばれたツールと引数を `signals.jsonl` の action 行に、確かめた結果を `expected.json` に固め、
   `scenario.json` の `status` を `stand-recorded` にする

## 管理画面（参照専用）

`https://<Murmur の URL>/admin?token=<TIMELINE_TOKEN>` でリスト一覧 → リストのスレッドの一覧（誰の番・結び・属性・状態）→ スレッドの詳細（結び・結び候補・属性・結んだ先も含むタイムライン）を辿れる。
書き込みはできない。全データソースが見えるので、トークンは運用する人だけに渡す。全スレッドを 1 枚で見るときは `/timeline.html?token=...`

H7 で absence をスタンド主導で回す手順は `docs/stand/h7-absence.md`。
