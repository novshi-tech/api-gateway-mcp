# 申し送り

最終更新: 2026-10-16（`docs/adr/0007`・`0008` を書いたあと）。次のセッションは、まずこれと `docs/PLAN.md` を読む。

## いまの状態

| リポジトリ | main | 内容 |
| --- | --- | --- |
| novshi-tech/murmur | 最新 | 本体。計画のステップ 1〜6 を、外部接続なしで進められるところまで |
| novshi-tech/api-gateway-mcp | f6fa0ed | 認証方式 `identity`（ユーザー ID を Ed25519 で署名して `Authorization: Bearer`）、`binding`（Service Binding 中継）、`/.well-known/jwks.json` |
| novshi-tech/nvt-api-gateway-skills | 84d9fec | スタンド用スキル `murmur`（プラグイン `nvt-api-gateway` 0.2.0） |

- murmur のテスト: `pnpm test` で 167 件が緑（skip なし）。`pnpm scenario verify all` で 4 シナリオとも expected.json と一致
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
| H6 Ingest の一致率 | 緑（claude-sonnet-5-5 の記録を再生。全体 91.7%（22/24）、AI のみ 85.7%（12/14）） | ignore を一度も選ばない（下の「H6 の記録で分かったこと」） |
| H7 スタンドで完走 | 未着手 | 実環境をつないでから（下の 2・3） |

## 残作業（優先順）

1. ~~H6 の記録を作る~~（済み。`fixtures/*/recordings/` をコミットした）
2. **実環境の設定**（手順は `docs/stand/connect.md`）
   - Neon（aws-ap-southeast-1）の dev ブランチを作り、`DATABASE_URL=... pnpm db:migrate`
   - murmur の secrets（`DATABASE_URL`・`ANTHROPIC_API_KEY`・`WEBHOOK_SECRET`・`TIMELINE_TOKEN`）と vars（`GATEWAY_JWKS`・`IDENTITY_ISSUER`）を設定して `pnpm deploy:dev`
   - ゲートウェイ: `IDENTITY_SIGNING_KEY` を登録し、本番の `wrangler.jsonc`（git 管理外）に `services` の Service Binding と `SERVICES.murmur` を足してデプロイ
   - GitHub Secrets に `CLOUDFLARE_API_TOKEN` を入れる。入れるまで murmur の CI の deploy-dev は失敗する
   - Cowork / Claude Code に `api-gateway` と `nvt-api-gateway`（0.2.0）のプラグインを入れる
3. **実データでの Ingest の試用**（`docs/adr/0007`）。デプロイが通ったら、読み取り専用の実コネクタで Ingest だけを回す
   - つなぐ前に: ignore を選ばない問題の手当て（下の「H6 の記録で分かったこと」）
   - 実コネクタは `pull` だけ、`send` はエラー。資格情報は読み取りの権限だけ。データソースは 1 つ、過去分は取らない
   - 計画のスコープ外（本物のコネクタ）だが、捨てないプロトタイプとして段階的に進める次の段階。方針は直樹と合意済み（2026-10-16）
   - 新規シグナルの置き先の判断材料（受信箱ごとの置き先の分かれ方、置き先・ignore の訂正件数）もここで取る（0008）
   - 量が増えたときの詰まりどころ（cursor の未保存、投影の丸ごと入れ替え、Cron の 1 回で全件、候補 20 件、Claude の費用、取り込みの形）は 0007 に書いた。
     プロトタイプではパフォーマンスに手を付けず、実業務を観察させる段階で考える（2026-10-16 決定）
4. **H7**: 欠勤連絡（`fixtures/absence`）とクレーム（`fixtures/complaint`）は、スタンドで回す前の下書き（`status: draft`）。
   実環境で、ユーザーは指示と承認だけを出して完走させ、記録を `signals.jsonl` と `expected.json` に固めて `status: stand-recorded` にする（`docs/stand/connect.md` の最後の節）
   - マスタの `User.id` はゲートウェイの User ID（`entra_<tenant-id>_<object-id>` / `google_<sub>`）にする。今の seed の ID は仮
   - seed の投入は今は `PgMasterStore.replaceSeed` を直接呼ぶしかない。投入用のスクリプトを足すとよい
5. **ステップ 7（振り返り）**: 直樹のレビュー。設計メモの未決リストへの判定、Google Doc への書き戻し案。Claude だけで閉じない

## 直樹に判断してもらうこと

- `docs/adr/0002`（提案）: テストを `@cloudflare/vitest-pool-workers` ではなく Node の vitest と pglite で回している。計画からの逸脱
- `docs/adr/0005`: 計画になかった細部を実装で決めた（ボールの所在、`DerivationRejected` の追加、閾値未満の ignore は new に倒す、返事の派生の自動判定など）。Google Doc と食い違っていないか
- `docs/adr/0008`（提案・議論中）: Murmur は業務の知識を持たない。派生の本文もスタンドが書き、`AiSummarizer` を外して境界の検査に替える。
  **未決**: 新規シグナルの置き先（リスト）を誰が決めるか（選択肢 A〜D）。有力案は「1 つのデータソースは 1 つのリストに属する」。
  後から直すと大きいので、プロトタイプの段階で入れるかもしれない。実装は止めている
- `docs/adr/0007`「量の見通し」の 6: 実メールの本文が残る記録（`recordings`）をどこに置くか。決めてから記録モードにする
- `docs/adr/0003` の未決: 本体が JWKS を設定値で持つか、ゲートウェイから取りに行くか（今は設定値）

## H6 の記録で分かったこと（2026-10-16、claude-sonnet-5-5）

| シナリオ | 全体 | アンカー | AI のみ | confidence |
| --- | --- | --- | --- | --- |
| repair-estimate | 6/6 | 2/2 | 3/3 | 0.96 0.96 0.95 |
| development | 8/9 | 5/5 | 3/4 | 0.80 0.90 0.60 0.85 |
| absence | 4/5 | - | 4/5 | 0.90 0.72 0.85 0.80 0.93 |
| complaint | 4/4 | 2/2 | 2/2 | 0.93 0.93 |

- 外れた 2 件はどちらも正解が ignore のシグナル（development s07 の CI 成功通知、absence s04 のスタンプだけの返信）。Claude はどちらも ignore を選ばず、既存タスクに attach した（confidence 0.60 と 0.80）。理由は「経過として履歴に残す価値がある」「直前の連絡の続き」
- 16 件の AI 判断で ignore が 0 件なので、confidence の分布から `IGNORE_CONFIDENCE_THRESHOLD` を決める材料がない。初期値は 0.8 のまま据え置く
- 対策の候補（判断待ち）: プロンプトの「迷ったら ignore より new」が attach にも効いて、拾いすぎに倒れている。ignore の例（CI の成功通知、スタンプだけ）をプロンプトに足すか、「付けても誰の行動も変わらないなら ignore」と書くか。プロンプトを変えたら `--ai rerecord` で取り直す
- `pnpm scenario verify all --ai record`（と `--ai replay`）は、上の 2 件が expected.json と食い違うので終了コード 1 になる。テストの合否は 4 シナリオ合算の一致率で見ている

## 既知の制約

- 外部派生の送信に失敗すると、派生は approved のまま止まり、再送する手段がない
- コネクタの取得位置（cursor）を保存していない。`pollConnectors` は毎回 `pull(principal, null)` を呼ぶ（性能の話なので、実業務を観察させる段階で考える。0007）
- Ingest の候補タスクは更新の新しい open タスク 20 件だけ。タスクが増えると正しい attach 先が落ちて new に倒れる（0007）
- 派生を起こすのはスタンドだけで、Ingest は提案しない（`docs/adr/0005`）
- 投影は書き込みのたびにテナント分を丸ごと入れ替える（`docs/adr/0004`）。件数が増えると遅い
- `timeline.html` は `TIMELINE_TOKEN` を知っている人には全リストが見える（確認用）
- シナリオの文字列で `$` から始まるものは束縛として置き換えられる（本文に `$100` などを書くと失敗する）

## このセッションの環境で分かったこと

- クラウドセッションの git の経路ではリモートのブランチを削除できない（push --delete が切断される）。削除は GitHub の画面で
- 空のリポに最初に push したブランチが既定ブランチになる。新しいリポでは最初に main を push する
- このセッションには Claude のメモリがないので、申し送りはこのファイルに置く
