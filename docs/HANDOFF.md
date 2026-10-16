# 申し送り

最終更新: 2026-10-16（初回セッションの終わり）。次のセッションは、まずこれと `docs/PLAN.md` を読む。

## いまの状態

| リポジトリ | main | 内容 |
| --- | --- | --- |
| novshi-tech/murmur | 9f34ac5 | 本体。計画のステップ 1〜6 を、外部接続なしで進められるところまで |
| novshi-tech/api-gateway-mcp | f6fa0ed | 認証方式 `identity`（ユーザー ID を Ed25519 で署名して `Authorization: Bearer`）、`binding`（Service Binding 中継）、`/.well-known/jwks.json` |
| novshi-tech/nvt-api-gateway-skills | 84d9fec | スタンド用スキル `murmur`（プラグイン `nvt-api-gateway` 0.2.0） |

- murmur のテスト: `pnpm test` で 166 件が緑、1 件 skip（下の H6）。`pnpm scenario verify all` で 4 シナリオとも expected.json と一致
- 3 リポとも、プロトタイプの間は main に直接 push する運用（直樹の指示）
- 構成は FC-IS（`src/domain` が純関数のコア、`test/architecture.test.ts` で検査）。詳しくは `CLAUDE.md` と `docs/adr/0001`

## 仮説ごとの状態

| 仮説 | 状態 | 残り |
| --- | --- | --- |
| H1 リプレイの決定性 | 緑（メモリと Postgres（pglite）の両方） | Neon 実機では未確認 |
| H2 二層の状態 | 緑 | — |
| H3 境界 | 緑 | — |
| H4 派生のライフサイクル | 緑（見回りの冪等性も） | — |
| H5 観測と送信の重複排除 | 緑 | — |
| H6 Ingest の一致率 | アンカー判定と無視の監査だけ緑。Claude 判断の一致率テストは skip | 記録を作る（下の 1） |
| H7 スタンドで完走 | 未着手 | 実環境をつないでから（下の 2・3） |

## 残作業（優先順）

1. **H6 の記録を作る**: `ANTHROPIC_API_KEY=... pnpm scenario verify all --ai record` を流し、`fixtures/*/recordings/` をコミットする。
   これで `test/scenarios.test.ts` の H6 テスト（アンカー込み 90%、AI のみ 80%）が skip でなくなる。confidence の分布から、無視の閾値（`IGNORE_CONFIDENCE_THRESHOLD`、仮に 0.8）の初期値を決める
2. **実環境の設定**（手順は `docs/stand/connect.md`）
   - Neon（aws-ap-southeast-1）の dev ブランチを作り、`DATABASE_URL=... pnpm db:migrate`
   - murmur の secrets（`DATABASE_URL`・`ANTHROPIC_API_KEY`・`WEBHOOK_SECRET`・`TIMELINE_TOKEN`）と vars（`GATEWAY_JWKS`・`IDENTITY_ISSUER`）を設定して `pnpm deploy:dev`
   - ゲートウェイ: `IDENTITY_SIGNING_KEY` を登録し、本番の `wrangler.jsonc`（git 管理外）に `services` の Service Binding と `SERVICES.murmur` を足してデプロイ
   - GitHub Secrets に `CLOUDFLARE_API_TOKEN` を入れる。入れるまで murmur の CI の deploy-dev は失敗する
   - Cowork / Claude Code に `api-gateway` と `nvt-api-gateway`（0.2.0）のプラグインを入れる
3. **H7**: 欠勤連絡（`fixtures/absence`）とクレーム（`fixtures/complaint`）は、スタンドで回す前の下書き（`status: draft`）。
   実環境で、ユーザーは指示と承認だけを出して完走させ、記録を `signals.jsonl` と `expected.json` に固めて `status: stand-recorded` にする（`docs/stand/connect.md` の最後の節）
   - マスタの `User.id` はゲートウェイの User ID（`entra_<tenant-id>_<object-id>` / `google_<sub>`）にする。今の seed の ID は仮
   - seed の投入は今は `PgMasterStore.replaceSeed` を直接呼ぶしかない。投入用のスクリプトを足すとよい
4. **ステップ 7（振り返り）**: 直樹のレビュー。設計メモの未決リストへの判定、Google Doc への書き戻し案。Claude だけで閉じない

## 直樹に判断してもらうこと

- `docs/adr/0002`（提案）: テストを `@cloudflare/vitest-pool-workers` ではなく Node の vitest と pglite で回している。計画からの逸脱
- `docs/adr/0005`: 計画になかった細部を実装で決めた（ボールの所在、`DerivationRejected` の追加、閾値未満の ignore は new に倒す、返事の派生の自動判定など）。Google Doc と食い違っていないか
- `docs/adr/0003` の未決: 本体が JWKS を設定値で持つか、ゲートウェイから取りに行くか（今は設定値）

## 既知の制約

- 外部派生の送信に失敗すると、派生は approved のまま止まり、再送する手段がない
- 投影は書き込みのたびにテナント分を丸ごと入れ替える（`docs/adr/0004`）。件数が増えると遅い
- `timeline.html` は `TIMELINE_TOKEN` を知っている人には全リストが見える（確認用）
- シナリオの文字列で `$` から始まるものは束縛として置き換えられる（本文に `$100` などを書くと失敗する）

## このセッションの環境で分かったこと

- クラウドセッションの git の経路ではリモートのブランチを削除できない（push --delete が切断される）。削除は GitHub の画面で
- 空のリポに最初に push したブランチが既定ブランチになる。新しいリポでは最初に main を push する
- このセッションには Claude のメモリがないので、申し送りはこのファイルに置く
