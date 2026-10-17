# 申し送り

最終更新: 2026-10-17（H7 の absence を途中で止め、リストの分け方（0008）を議論している）。次のセッションは、まずこれと `docs/PLAN.md` を読む。

## いまの状態

| リポジトリ | main | 内容 |
| --- | --- | --- |
| novshi-tech/murmur | 最新 | 本体。計画のステップ 1〜6 と、実環境（murmur-dev + Neon + ゲートウェイ）の接続まで |
| novshi-tech/api-gateway-mcp | f6fa0ed（デプロイ済み） | 認証方式 `identity`（ユーザー ID を Ed25519 で署名して `Authorization: Bearer`）、`binding`（Service Binding 中継）、`/.well-known/jwks.json` |
| novshi-tech/nvt-api-gateway-skills | 84d9fec | スタンド用スキル `murmur`（プラグイン `nvt-api-gateway` 0.2.0） |

- murmur のテスト: `pnpm test` で 169 件が緑（skip なし）。`pnpm scenario verify all` で 4 シナリオとも expected.json と一致
- 3 リポとも、プロトタイプの間は main に直接 push する運用（直樹の指示）
- 構成は FC-IS（`src/domain` が純関数のコア、`test/architecture.test.ts` で検査）。詳しくは `CLAUDE.md` と `docs/adr/0001`

## 仮説ごとの状態

| 仮説 | 状態 | 残り |
| --- | --- | --- |
| H1 リプレイの決定性 | 緑（メモリと Postgres（pglite）の両方） | Neon 実機では未確認（H7 の記録で確かめられる） |
| H2 二層の状態 | 緑 | — |
| H3 境界 | 緑 | — |
| H4 派生のライフサイクル | 緑（見回りの冪等性も） | — |
| H5 観測と送信の重複排除 | 緑 | — |
| H6 Ingest の一致率 | 緑（claude-sonnet-5-5 の記録を再生。全体 91.7%（22/24）、AI のみ 85.7%（12/14）） | ignore を一度も選ばない（下の「H6 の記録で分かったこと」） |
| H7 スタンドで完走 | absence を s02 まで回して止めた | リストの構成を見直す（0009）。固まったらシナリオを作り直して回す |

## 残作業（優先順）

1. ~~H6 の記録を作る~~（済み。`fixtures/*/recordings/` をコミットした）
2. **実環境の設定**（2026-10-17 にほぼ済み。手順は `docs/stand/connect.md`）
   - 済み: Neon プロジェクト `murmur`（quiet-dust-32237629、aws-ap-southeast-1、組織 株式会社ノブシテック）の `dev` ブランチにマイグレーション
   - 済み: murmur-dev（https://murmur-dev.nose-0d2.workers.dev、dev だけ workers.dev を開けた）に `DATABASE_URL`・`WEBHOOK_SECRET`・`TIMELINE_TOKEN` と `GATEWAY_JWKS`・`IDENTITY_ISSUER`
   - 済み: ゲートウェイに `IDENTITY_SIGNING_KEY`、本番の `wrangler.jsonc` に `MURMUR`（→ murmur-dev）の Service Binding と `SERVICES.murmur` を足してデプロイ。`list_credentials` に `identity:murmur` が出て、ゲートウェイ経由の `/murmur/me` が seed のユーザーを返す
   - 済み: `ANTHROPIC_API_KEY`。absence の s01 を Webhook で流し、Claude が new と判断してタスクを作り、ゲートウェイ経由の `/murmur/tasks` で見えるところまで確認した（H7 を回す前に `pnpm seed absence --user ...` で入れ直す）
   - 済み: GitHub Secrets の `CLOUDFLARE_API_TOKEN`。main への push で CI の deploy-dev が murmur-dev にデプロイする（`v*` タグの deploy-prod は、prod の設定が空なので当面打たない）
   - 済み: Cowork に `api-gateway` と `nvt-api-gateway`（0.2.0）のプラグインを入れた（2026-10-17）
   - 控え: Webhook の鍵・timeline のトークン・接続文字列は、直樹のマシンの `~/.config/murmur/dev.env`（600、シェルで source できる形）。Neon の API キーは `~/.config/neonctl/api_key`
3. **実データでの Ingest の試用**（`docs/adr/0007`）。デプロイが通ったら、読み取り専用の実コネクタで Ingest だけを回す
   - つなぐ前に: ignore を選ばない問題の手当て（下の「H6 の記録で分かったこと」）
   - 実コネクタは `pull` だけ、`send` はエラー。資格情報は読み取りの権限だけ。データソースは 1 つ、過去分は取らない
   - 計画のスコープ外（本物のコネクタ）だが、捨てないプロトタイプとして段階的に進める次の段階。方針は直樹と合意済み（2026-10-16）
   - 新規シグナルの置き先の判断材料（受信箱ごとの置き先の分かれ方、置き先・ignore の訂正件数）もここで取る（0008）
   - 量が増えたときの詰まりどころ（cursor の未保存、投影の丸ごと入れ替え、Cron の 1 回で全件、候補 20 件、Claude の費用、取り込みの形）は 0007 に書いた。
     プロトタイプではパフォーマンスに手を付けず、実業務を観察させる段階で考える（2026-10-16 決定）
4. **H7**: 欠勤連絡（`fixtures/absence`）とクレーム（`fixtures/complaint`）は、スタンドで回す前の下書き（`status: draft`）。
   実環境で、ユーザーは指示と承認だけを出して完走させ、記録を `signals.jsonl` と `expected.json` に固めて `status: stand-recorded` にする（`docs/stand/connect.md` の最後の節）
   - seed の投入は `DATABASE_URL=... pnpm seed <scenario> --user <seed の User ID>=<ゲートウェイの User ID>`。DB を空にしてから入れるので、シナリオは 1 つずつ回す
   - 直樹のゲートウェイの User ID は `entra_6f043b7f-9709-4e71-bfa1-bd38a935316b_a86eed80-97f7-41a9-b7cc-2c6849408afb`。いま dev には absence の seed（u_kimura をこの ID に付け替え）が入っている
5. **ステップ 7（振り返り）**: 直樹のレビュー。設計メモの未決リストへの判定、Google Doc への書き戻し案。Claude だけで閉じない

## 次のセッションでやること

1. `docs/adr/0009` の未決 6（移行の順序）を直樹と詰める。0009・0010 の形を、どの順で、どこまでプロトタイプで確かめるか。データモデルの組み替えになるので、固まるまで実装しない（CLAUDE.md の約束）
2. 固まったら、PLAN.md の実装ステップの組み直し案（どこまでをプロトタイプで確かめるか）を書いて直樹に見せる
3. H7 は 0009 の形で seed とシナリオを作り直してから回す。送信には `pnpm send <scenario> <signal の id>...`（`WEBHOOK_SECRET` が要る。`~/.config/murmur/dev.env` を source する）

## H7 の absence を途中まで回して分かったこと（2026-10-17、Cowork）

- s01 → 打診の提案・承認 → 属性の設定までは、指示と承認だけで回った。打診の文面に山本さんの発熱は出ていなかった
- 「明日（17日）」は 17 日に届いたので、直樹の判断で日付間違いとして 10/18 に読み替えた（`shift_date` と打診の文面の両方）
- スタンドは `kind=欠勤` を設定しなかった。欠勤タスクの件名は受信時の「明日(17日)」のまま
- バグ（直した）: スタンドが返事期待の期限を `+09:00` 付きで渡すと文字列のまま保存され、見回りが UTC の現在時刻と文字列で比べて 9 時間ずれていた
- バグ（直した）: Ingest の訂正で打診の適用先に付け直しても `DerivationReplied` が出ず、打診が sent のまま期限超過になるところだった
- s02（伊藤さんの承諾）を AI が欠勤タスクに付けた（confidence 0.6）。原因と、そこからの議論は `docs/adr/0009` の背景
- dev の DB には、s02 が欠勤タスクに付いた状態が残っている。回し直すときは seed から入れ直す

## 直樹に判断してもらうこと

- `docs/adr/0002`（提案）: テストを `@cloudflare/vitest-pool-workers` ではなく Node の vitest と pglite で回している。計画からの逸脱
- `docs/adr/0005`: 計画になかった細部を実装で決めた（ボールの所在、`DerivationRejected` の追加、閾値未満の ignore は new に倒す、返事の派生の自動判定など）。Google Doc と食い違っていないか
- `docs/adr/0008`（提案・議論中）: Murmur は業務の知識を持たない。派生の本文もスタンドが書き、`AiSummarizer` を外して境界の検査に替える。
  新規シグナルの置き先の未決は、有力案「1 つのデータソースは 1 つのリストに属する」を 0009 の 2 層の形で詰めている。実装は止めている
- `docs/adr/0009`（提案・議論中、2026-10-17）: リストを 2 層に分ける。会話の層（リスト = データソース、タスク = スレッド、Ingest は業務の知識なし）と、
  用件の層（個人とチームのリスト、タスク = 用件）。用件のリストがデータソースを（構造の条件か自然文の条件で）購読し、昇格はそれとボールの宛先・アンカーで行う。
  可視性はリストのメンバーだけで決め、購読の登録は両側のメンバーに限る（2026-10-17 決定）。
  スレッドは区切りのないチャネルでも作り、発信者の直近のスレッドの続きかを判断する（2026-10-17 決定）。
  スレッドと用件は 1 対 1 以下で、直す操作はシグナルの移し替え・スレッドの付け替え・用件の統合・片付け（2026-10-17 決定）。
  **未決**: 移行の順序（どこまでをプロトタイプで確かめるか）。H7 はこれが固まるまで止める
- `docs/adr/0010`（採用、2026-10-17）: Murmur は黒子になる。用件ごとに正を 1 つ（Jira・bm-next に受け皿があればそちら、なければ Murmur）。
  状態は正から片方向、会話（コメント）は両方向。Murmur から書くのは起票とコメントだけ。起票ルールは最初は承認なし（ルールの登録が事前の承認）。
  管理用の参照専用 UI（リスト一覧・タスク一覧・タスク詳細）を作る。Google Doc への書き戻しはステップ 7
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

- 直樹のローカル（Linux、GUI なし）で動いた。Claude のメモリはある
- 自動モードの判定で止められたこと: 環境変数の `ANTHROPIC_API_KEY` を `wrangler secret put` でクラウドへ送る（直樹が `!` で実行した）、`issue_token` で得たトークンをファイルに書く（トークンは curl の引数に直接書けば通った）。CI の再実行は直樹の確認を待った
- `npx neonctl` は API キーを渡しても止まって返ってこない。Neon は `https://console.neon.tech/api/v2` を curl で呼ぶ（プロジェクト一覧には `org_id=org-broad-river-99881946` が要る）
- Neon の組織には ubs-apps の本番プロジェクト `ubs-app`（damp-bread-05008141）もある。murmur では触らない
- `~/.config/murmur/dev.env` の値はクォートしておく（接続文字列の `&` でシェルが割れ、エラー表示にパスワードが出た。2026-10-17 にロール neondb_owner のパスワードをリセット済み）
- `! gh secret set ...` は端末の入力欄が出ない。秘密の入力は直樹に別のターミナルでやってもらう
- ゲートウェイの本番 `wrangler.jsonc`（git 管理外）を書き換える前の控え: 前セッションの scratchpad にあるだけで、次のセッションからは見えない。差分は `services` の 1 行と `SERVICES.murmur` だけ

- クラウドセッションの git の経路ではリモートのブランチを削除できない（push --delete が切断される）。削除は GitHub の画面で
- 空のリポに最初に push したブランチが既定ブランチになる。新しいリポでは最初に main を push する
- このセッションには Claude のメモリがないので、申し送りはこのファイルに置く
