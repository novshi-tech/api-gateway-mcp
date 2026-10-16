# スタンドからの接続手順（Cowork / Claude Code）

認可の接続の形は (B)（2026-10-16 決定）: スタンドから見える MCP は API ゲートウェイの 1 つだけ。
Murmur の本体はゲートウェイの上流サービス `murmur` として登録され、ゲートウェイが User ID を署名して Service Binding 越しに伝える。

## 前提（ゲートウェイ側。0003 を参照）

1. ゲートウェイの Worker に Service Binding で本体（`murmur-dev` / `murmur`）をつなぐ
2. 上流サービス `murmur` を登録し、認証方式を「ユーザー識別の伝搬」にする（`x-murmur-identity` に EdDSA の compact JWS、aud=`murmur`）
3. 署名鍵の公開鍵（JWK）を本体の `GATEWAY_IDENTITY_PUBLIC_KEY` に設定する
4. スタンド用スキル `docs/stand/skill.md` をゲートウェイのスキルとして配る（freee や board と同じ形）

## 本体の準備

```sh
pnpm install
# Neon の dev ブランチ（aws-ap-southeast-1）にマイグレーション
DATABASE_URL=postgres://... pnpm db:migrate
# secrets
wrangler secret put DATABASE_URL --env dev
wrangler secret put ANTHROPIC_API_KEY --env dev
wrangler secret put WEBHOOK_SECRET --env dev
wrangler secret put TIMELINE_TOKEN --env dev   # timeline.html を見る人だけに渡す
pnpm deploy:dev
```

マスタ（seed）とシナリオの投入は、プロトタイプでは `fixtures/<scenario>/seed.json` を `master` テーブルに入れる
（`PgMasterStore.replaceSeed`）。受信は `POST /webhooks/dummy/{tenant}`（本文は InboundSignal の配列、`x-murmur-signature` は
WEBHOOK_SECRET の HMAC-SHA256 hex）で流し込む。

## Cowork

1. Cowork の設定で API ゲートウェイの MCP コネクタを有効にする（既存のもの。追加の MCP は不要）
2. スキル `murmur` を有効にする
3. 「自分のタスクを見せて」で `list_my_tasks` が呼ばれることを確認する

## Claude Code

1. `claude mcp add` でゲートウェイの MCP を追加する（既に使っていればそのまま）
2. `docs/stand/skill.md` をスキルとして置く（ゲートウェイのスキル配布を使うか、`.claude/skills/murmur/SKILL.md` に置く）
3. 同じく `list_my_tasks` で確認する

## H7（スタンド主導の完走）の回し方

1. `fixtures/absence` と `fixtures/complaint` の seed を投入し、`signals.jsonl` の受信だけを Webhook で時刻順に流す
2. ユーザーは Claude に指示（「この欠勤の代わりを探して」「承認して」）だけを出し、属性の設定・派生の提案はスタンドに任せる
3. 終わったら、実際に呼ばれたツールと引数を `signals.jsonl` の action 行に、確かめた結果を `expected.json` に固め、
   `scenario.json` の `status` を `stand-recorded` にする
