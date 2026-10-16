# Murmur — AI ネイティブ タスク管理ツールのプロトタイプ

設計メモ「AIネイティブ タスク管理ツール」のデータモデルとアーキテクチャが成立するかを、外部接続なしで確かめるためのプロトタイプ。製品の MVP ではない。

- 計画: `docs/PLAN.md`（プロトタイプ計画の Markdown 書き出し）
- 設計の正本: Google Doc（https://docs.google.com/document/d/1gNSrK_p5xrEGiJB4RRr2FfFf9r-naPamh_5P9tNqM6w/edit）。API ゲートウェイの google-docs スキル経由で読める。`docs/PLAN.md` と食い違ったら Google Doc が優先
- 決定の記録: `docs/adr/`

## 約束事

- 実装の順序と完了条件は `docs/PLAN.md` の実装ステップに従う。ステップをまたいで先回りしない
- イベント型を追加・変更するときは、zod スキーマ（`src/domain/events.ts`）、fold の純関数テスト（`test/domain/fold.test.ts`）、リプレイテスト（H1、`test/scenarios.test.ts`）を同じ PR で更新する
- Claude API の呼び出しは必ず記録・再生の層（`src/ingest/llm.ts` の `RecordReplayLlm`）を通す。テストは再生モードのみ
- `src/domain/` に Workers API への依存を持ち込まない（下の FC-IS を参照）
- テスト名とコミットメッセージに仮説番号（H1〜H7）を付ける
- 設計メモや本計画と食い違う判断が必要になったら、実装せず `docs/adr/` に案を書いて止まる

## 構成: Functional Core / Imperative Shell

判断はすべて純関数のコアに置き、副作用（DB・Claude・コネクタ・HTTP・時計・ID 生成・暗号）はシェルに集める。`test/architecture.test.ts` がこの境界を検査する。

```
src/
  domain/        関数型コア。zod と domain 内しか import しない。Date.now・乱数・fetch・crypto 禁止
    entities.ts    マスタ（Tenant / User / Party / Address / List / AttributeDef / CredentialRef / ChannelPolicy）
    events.ts      イベント型（zod）
    fold.ts        fold(events) → projections
    comm.ts        通信状態の導出（事前定義の項目だけ）
    commands.ts    スタンドの操作の判断（状態 + コマンド → イベント）、期限の見回り
    ingest.ts      Ingest の判断（重複排除、アンカー解決、候補、AI 出力の検証）、プロンプト
    visibility.ts  クエリ層の可視性（Viewer から見えるものだけ返す）
  app/service.ts 命令型シェルの中心。読む → コアで決める → 追記 → fold して保存
  store/         イベントストア・投影・マスタ（メモリ実装と Drizzle/Postgres 実装）
  ingest/        Claude 呼び出し（記録・再生）、Decider / ReplyEstimator
  derivation/    境界越えの要約
  connectors/    Connector インタフェース + dummy/
  api/           HTTP API の入力スキーマ
  auth/          ゲートウェイが署名した sub の検証（claims.ts は純関数）
  http/          Hono ルート、timeline.html
  index.ts       Worker の入口（fetch / scheduled）と配線
scripts/         scenario CLI と、その部品（Node 専用。Worker には入らない）
fixtures/<scenario>/  seed.json / signals.jsonl / expected.json / scenario.json / recordings/
drizzle/         マイグレーション（drizzle-kit generate で作る）
```

時刻と ID はシェルが `CoreContext`（`now`・`newId`）で渡す。コアの関数は同じ入力なら同じ出力を返す。

## コマンド

```sh
pnpm install
pnpm typecheck
pnpm test                                   # vitest（コア・シェル・4 シナリオ。Postgres は pglite）
pnpm scenario verify all                    # 4 シナリオを expected.json と比較（H1 のリプレイ比較も）
pnpm scenario verify development --db pglite
pnpm scenario verify all --ai replay        # 記録した Claude の判断で H6 の一致率を出す
ANTHROPIC_API_KEY=... pnpm scenario verify all --ai record   # 記録を作る（モデルを変えたら --ai rerecord）
pnpm db:generate                            # src/store/schema.ts からマイグレーションを作る
DATABASE_URL=... pnpm db:migrate            # Neon に当てる
pnpm dev / pnpm deploy:dev / pnpm deploy:prod   # wrangler
```

## 注意

- 本体は上流サービスのトークンを持たない。外部との出入りはゲートウェイ経由（プロトタイプはダミーコネクタのみ）
- 本体の API（`/api/*`）は `Authorization: Bearer <JWT>` が必須。JWT はゲートウェイ（api-gateway-mcp の認証方式 `identity`）がサインイン中のユーザーの ID を Ed25519 で署名したもので、本体は `GATEWAY_JWKS` で検証する（`docs/adr/0003`）。公開ルートは `/webhooks/*` と `/timeline.html` だけ
- スタンド（Cowork / Claude Code）用のスキルは novshi-tech/nvt-api-gateway-skills の `plugins/nvt-api-gateway/skills/murmur/`、接続手順は `docs/stand/connect.md`。HTTP API を変えたらスキルの API の表も直す
