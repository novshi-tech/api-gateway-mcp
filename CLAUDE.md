# Murmur — スレッドとリンクのプロトタイプ

連絡から対応の要る件を拾い、その経過を追跡する（`docs/adr/0012`）。エンティティはスレッドの 1 種類。スレッドはデータソースの写しで、リストはデータソースごとに 1 つ（テナントで共有、見えるのはそのデータソースの読者）。個人のメモもデータソースの 1 種類（読者は本人だけ）で、0013 の「用件」「マイリスト」はそのスレッドにすぎない（`docs/adr/0014`）。スレッド同士を結ぶのは人とスタンドで、Murmur はアンカーの一致を候補として見せるだけ。
そのデータモデルとアーキテクチャが成立するかを、外部接続なしで確かめるためのプロトタイプ。製品の MVP ではない。タスク管理ツールではない（抽出をやる。追跡だけではない）。
チームの共有は既存のツール（Jira・グループメール・Slack）に任せ、Murmur はチームリストを持たない。

- 設計の正本: このリポジトリの `docs/PLAN.md`（計画 v2）と `docs/adr/`（`docs/adr/0011`）。立ち位置は `docs/adr/0012`、データモデルは `docs/adr/0013` を `docs/adr/0014` で 1 種類のスレッドに統合した形
- Google Doc（https://docs.google.com/document/d/1gNSrK_p5xrEGiJB4RRr2FfFf9r-naPamh_5P9tNqM6w/edit）は 2026-10-17 までの経緯の資料。更新しない。食い違ったらリポジトリが優先
- v1 の計画と実装はタグ `proto-v1`
- 決定の記録: `docs/adr/`
- 申し送り（残作業・判断待ち・既知の制約）: `docs/HANDOFF.md`。セッションの始めに読み、終わりに更新する

## 約束事

- 実装の順序と完了条件は `docs/PLAN.md` の実装ステップに従う。ステップをまたいで先回りしない
- イベント型を追加・変更するときは、zod スキーマ（`src/domain/events.ts`）、fold の純関数テスト（`test/domain/fold.test.ts`）、リプレイテスト（H1、`test/scenarios.test.ts`）を同じ PR で更新する
- Claude API の呼び出しは必ず記録・再生の層（`src/ingest/llm.ts` の `RecordReplayLlm`）を通す。テストは再生モードのみ
- `src/domain/` に Workers API への依存を持ち込まない（下の FC-IS を参照）
- 本体は外に何も書かない（`docs/adr/0012`）。送信・起票・コメントはスタンドがゲートウェイ経由で行い、本体には `record_sent` で事実だけを記録する。本体に送信の経路（`Connector.send`、承認付きの送信）を足さない
- チームリスト・購読・派生・本体の承認を足さない（`docs/adr/0013`）。誰の番かは持ち主の操作（`ThreadClaimed`）と構造で決め、自然文の条件を持ち込まない
- スレッド以外のエンティティ（用件・Matter）を足さない。個人のメモはデータソースの 1 種類（`docs/adr/0014`）
- Murmur は自分でリンクを張らない（`record_sent` の副作用の経路 sent だけが例外）。アンカーの一致は結び候補としてクエリ層で出すだけ。本人の側の状態（片付け・属性・メモ）を自動で変えない（`docs/adr/0014`）
- fold は 1 段。スレッドの fold はそのスレッドのイベントとリンクのイベントだけ読み、リンク先の状態はクエリ層で合わせる（`docs/adr/0014`）
- テスト名とコミットメッセージに仮説番号（H1〜H10）を付ける
- 計画や ADR と食い違う判断が必要になったら、実装せず `docs/adr/` に案を書いて止まる

## 構成: Functional Core / Imperative Shell

判断はすべて純関数のコアに置き、副作用（DB・Claude・コネクタ・HTTP・時計・ID 生成・暗号）はシェルに集める。`test/architecture.test.ts` がこの境界を検査する。

`src/domain/` はステップ 2 でスレッド 1 種類のデータモデル（`docs/adr/0013`・`0014`）に組み替え、ステップ 3 で個人のメモ・持ち主・リンク・属性と、クエリ層の「誰の番か」・結び候補・導出したボール・タイムラインを足した。ステップ 4 で送信の記録（`record_sent` → `OutboundRecorded`）、期限の見回り、観測された送信との統合を足した。

```
src/
  domain/        関数型コア。zod と domain 内しか import しない。Date.now・乱数・fetch・crypto 禁止
    entities.ts    マスタ（Tenant / User / Party / Address / CredentialRef / DataSource / List / ListMember / AttributeDef）
    events.ts      イベント型（zod）
    fold.ts        fold(events) → projections（1 段）
    comm.ts        通信状態（ボール）の導出。シグナルの向き・「求めているか」・持ち主・片付けだけ
    directory.ts   マスタの検索、seed の整合性（seedProblems）
    commands.ts    スタンドの操作の判断（片付け・開き直し・シグナルの移し替え・メモ・持ち主・リンク・属性）
    ingest.ts      Ingest の判断（重複排除、向き、記録した送信との統合、区切り、AI 出力の検証）、プロンプト
    outbound.ts    送信の記録の判断（置き先・観測との統合・経路 sent のリンク）と期限の見回り
    turn.ts        クエリ層の「誰の番か」（持ち主・読者が 1 人・宛先）、リンク先から導出したボール、結び候補
    visibility.ts  クエリ層の可視性（Viewer から見えるものだけ返す）、一覧のフィルタ、スレッドの詳細とタイムライン
  app/service.ts 命令型シェルの中心。読む → コアで決める → 追記 → fold して保存
  store/         イベントストア・投影・マスタ（メモリ実装と Drizzle/Postgres 実装）
  ingest/        Claude 呼び出し（記録・再生）、Decider
  connectors/    Connector インタフェース（取り込みだけ）+ dummy/
  api/           HTTP API の入力スキーマ
  auth/          ゲートウェイが署名した sub の検証（claims.ts は純関数）
  http/          Hono ルート、参照専用の管理画面（admin.ts: /admin・timeline.html）
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

- 本体は上流サービスのトークンを持たず、外へは何も書かない。取り込みはゲートウェイ経由（プロトタイプはダミーコネクタのみ）
- 本体の API（`/api/*`）は `Authorization: Bearer <JWT>` が必須。JWT はゲートウェイ（api-gateway-mcp の認証方式 `identity`）がサインイン中のユーザーの ID を Ed25519 で署名したもので、本体は `GATEWAY_JWKS` で検証する（`docs/adr/0003`）。公開ルートは `/webhooks/*` と、`TIMELINE_TOKEN` で守る参照専用の画面（`/admin`・`/timeline.html`）だけ
- スタンド（Cowork / Claude Code）用のスキルは novshi-tech/nvt-api-gateway-skills の `plugins/nvt-api-gateway/skills/murmur/`（v2 の版の下書きは `docs/stand/skill-murmur.md`）、接続手順は `docs/stand/connect.md`。HTTP API を変えたらスキルの API の表も直す
