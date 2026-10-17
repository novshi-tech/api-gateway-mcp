# 申し送り

最終更新: 2026-10-17（ADR 0012 を採用し、計画 v2 に反映した。ステップ 1 完了）。次のセッションは、まずこれと `docs/PLAN.md`（v2）、`docs/adr/0012` を読んで、ステップ 2 に入る。

## いまの状態

設計の正本はこのリポジトリ（`docs/PLAN.md` と `docs/adr/`、0011）。Google Doc は経緯の資料に格下げした。

計画 v2 を書いたあと、直樹と立ち位置の議論をして `docs/adr/0012` を書き、採用した。要点: Murmur は「人とエージェントが共有する判断の台帳」で、
連絡から対応の要る用件を抽出して追跡する。外には何も書かない（送信はスタンドが実行し、本体は事実を `OutboundRecorded` として綴じる）。
用件に宛てたメモ（`MatterNoted`）を綴じる 3 種類目として足す。前例は boid（card = 判断の台帳、signal inbox）で、Murmur はそれを一人のマシンからテナントの皆が届く場所へ持ち出したもの。
計画 v2 は 0012 のとおり直した（ステップ 4 は「送信の記録と派生」、起票ルールと `Connector.send` と `ReplyEstimator` は消え、H10 を足した）。**ステップ 1 は 2026-10-17 に直樹のレビューを通った。次はステップ 2。**

H7 で absence を実環境で回したところ、リストの構成に根本の問題が見つかった（s02 の取り違え。`docs/adr/0009` の背景）。
直樹と議論して、リストを 2 層（会話の層 = データソース、用件の層 = 人とチーム）に組み替えることにし（0009）、
製品の方向（Murmur は黒子。用件ごとに正を 1 つ、0010）も決めた。計画を v2 に書き直し、v1 の計画と実装はタグ `proto-v1` に残した。

| リポジトリ | main | 内容 |
| --- | --- | --- |
| novshi-tech/murmur | 最新 | v1 の実装（ステップ 1〜6）+ 実環境の接続 + 計画 v2。v2 のステップ 1（計画の書き直し）は 2026-10-17 にレビュー済み。次はステップ 2 |
| novshi-tech/api-gateway-mcp | f6fa0ed（デプロイ済み） | 認証方式 `identity`（ユーザー ID を Ed25519 で署名して `Authorization: Bearer`）、`binding`（Service Binding 中継）、`/.well-known/jwks.json` |
| novshi-tech/nvt-api-gateway-skills | 84d9fec | スタンド用スキル `murmur`（プラグイン `nvt-api-gateway` 0.2.0）。v1 の API の表。v2 のステップ 5 で作り直す |

- murmur のテスト: `pnpm test` で 171 件が緑（v1 のコア）。v2 のステップ 2 からコアを置き換えるので、テストもステップごとに作り直す
- 3 リポとも、プロトタイプの間は main に直接 push する運用（直樹の指示）
- 構成は FC-IS（`src/domain` が純関数のコア、`test/architecture.test.ts` で検査）。v2 でも変えない

## 仮説ごとの状態（v2）

v1 の H1〜H6 は緑だった（`proto-v1`）。v2 は仮説を立て直したので、全部これから（`docs/PLAN.md`）。

| 仮説 | 状態 | どのステップで |
| --- | --- | --- |
| H1 リプレイの決定性 | v1 は緑。v2 は未着手 | 2〜4 |
| H2 二層の状態 | 未着手 | 3 |
| H3 境界 | 未着手 | 2（会話の層）・3 |
| H4 送信の記録と派生 | 未着手 | 4 |
| H5 観測と送信の記録の重複排除（両順） | v1 は緑（送信 → 観測の順だけ）。v2 は未着手 | 4 |
| H6 Ingest（区切り + 返事や対応を求めているか） | 未着手 | 2 |
| H7 スタンドで完走 | v1 で absence を s02 まで回して止めた | 6 |
| H8 購読だけで振り分けが回る（新） | 未着手 | 3 |
| H9 正が外にある用件（新。起票はスタンドが記録） | 未着手 | 7 |
| H10 台帳あり vs なし（新、0012） | 未着手 | 6 |

## 残作業（計画 v2 の実装ステップ）

1. **計画の書き直し**（済み。2026-10-17 に直樹のレビューを通った）: `docs/PLAN.md` v2、`CLAUDE.md`、ADR 0008〜0012
2. **会話の層**: DataSource、スレッド、Ingest v2、片付け、シグナルの移し替え、記録の取り直し（H1・H3・H6）
3. **用件の層と昇格**（H2・H8。個人リストを先に、メモも） 4. **送信の記録と派生**（H4・H5） 5. **API・スキル・管理 UI** 6. **H7・H10** 7. **正が外にある用件**（H9） 8. **振り返り**
- 並行トラック: ステップ 2 のあと、0007 の実データでの試用（読み取り専用の Gmail を会話の層だけで）。前提は 0007 の 6（記録の置き場所）を決めること

実環境の控え（v1 で設定済み、v2 でも使う）:
- Neon プロジェクト `murmur`（quiet-dust-32237629、aws-ap-southeast-1、組織 株式会社ノブシテック）の `dev` ブランチ。v2 ではスキーマが変わるので、マイグレーションを作り直して当て直す
- murmur-dev（https://murmur-dev.nose-0d2.workers.dev）。secrets は `DATABASE_URL`・`ANTHROPIC_API_KEY`・`WEBHOOK_SECRET`・`TIMELINE_TOKEN`、vars は `GATEWAY_JWKS`・`IDENTITY_ISSUER`
- ゲートウェイの本番に `MURMUR`（→ murmur-dev）の Service Binding と `SERVICES.murmur`。Cowork に `api-gateway` と `nvt-api-gateway`（0.2.0）を入れてある
- main への push で CI が murmur-dev にデプロイする。`v*` のタグは prod にデプロイするので打たない（v1 のタグは `proto-v1`）
- 鍵・トークン・接続文字列は直樹のマシンの `~/.config/murmur/dev.env`（600、`set -a; . ~/.config/murmur/dev.env; set +a`）。Neon の API キーは `~/.config/neonctl/api_key`
- seed の投入は `pnpm seed <scenario> --user <seed の User ID>=<ゲートウェイの User ID>`、受信の送信は `pnpm send <scenario> <signal の id>...`。
  直樹のゲートウェイの User ID は `entra_6f043b7f-9709-4e71-bfa1-bd38a935316b_a86eed80-97f7-41a9-b7cc-2c6849408afb`
- dev の DB には v1 の absence を s02 まで流した状態が残っている（ステップ 6 の前に入れ直す）

## 次のセッションでやること

1. ステップ 2（会話の層）に入る。最初に、イベント（SignalThreaded・ThreadDismissed）と DataSource の zod スキーマ、
   スレッドの投影と fold、4 シナリオの seed（DataSource）と正解ラベル（シグナルごとのスレッドと「返事や対応を求めているか」）を作る。
   v1 のコアを置き換えるので、v1 の `Connector.send`・`ReplyEstimator`・`AiSummarizer`・承認付きの送信は、該当するステップ（4）で消す
2. Ingest v2 のプロンプトを書いたら `--ai record` で記録を取り直す（`ANTHROPIC_API_KEY` は `dev.env` にはない。直樹に環境変数で渡してもらう）
3. 手が空いたら、0012 の未決 2（LINE の Messaging API が自分の push を webhook で返すか）を WebSearch で確かめる。ステップ 4 までに分かっていればよい

## H7 の absence を途中まで回して分かったこと（2026-10-17、Cowork）

- s01 → 打診の提案・承認 → 属性の設定までは、指示と承認だけで回った。打診の文面に山本さんの発熱は出ていなかった
- 「明日（17日）」は 17 日に届いたので、直樹の判断で日付間違いとして 10/18 に読み替えた（`shift_date` と打診の文面の両方）
- スタンドは `kind=欠勤` を設定しなかった。欠勤タスクの件名は受信時の「明日(17日)」のまま
- バグ（直した）: スタンドが返事期待の期限を `+09:00` 付きで渡すと文字列のまま保存され、見回りが UTC の現在時刻と文字列で比べて 9 時間ずれていた
- バグ（直した）: Ingest の訂正で打診の適用先に付け直しても `DerivationReplied` が出ず、打診が sent のまま期限超過になるところだった
- s02（伊藤さんの承諾）を AI が欠勤タスクに付けた（confidence 0.6）。原因と、そこからの議論は `docs/adr/0009` の背景
- dev の DB には、s02 が欠勤タスクに付いた状態が残っている。回し直すときは seed から入れ直す

## 直樹に判断してもらうこと

- `docs/adr/0012` の未決 1〜5（急がない。チームの用件への自分だけのメモはまずスタンドの記憶に置く、で進める）
- `docs/adr/0002`（提案）: テストを `@cloudflare/vitest-pool-workers` ではなく Node の vitest と pglite で回している。計画からの逸脱
- `docs/adr/0003` の未決: 本体が JWKS を設定値で持つか、ゲートウェイから取りに行くか（今は設定値）
- `docs/adr/0007`「量の見通し」の 6: 実メールの本文が残る記録（`recordings`）をどこに置くか。並行トラック（実データでの試用）の前提
- 2026-10-17 に決めたこと（参考）: 0008（業務の知識を持たない）・0009（2 層のリスト）・0010（黒子）・0011（正本はリポジトリ）・0012（判断の台帳、外には書かない）は採用。計画 v2 もレビュー済み

## v1 の H6 の記録で分かったこと（2026-10-16、claude-sonnet-5-5。v2 の Ingest の設計に反映した）

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

## v1 の既知の制約（v2 で作り直す部分も含む）

- 外部派生の送信に失敗すると、派生は approved のまま止まり、再送する手段がない
- コネクタの取得位置（cursor）を保存していない。`pollConnectors` は毎回 `pull(principal, null)` を呼ぶ（性能の話なので、実業務を観察させる段階で考える。0007）
- Ingest の候補タスクは更新の新しい open タスク 20 件だけ。タスクが増えると正しい attach 先が落ちて new に倒れる（0007）
- 派生を起こすのはスタンドだけで、Ingest は提案しない（`docs/adr/0005`）
- 投影は書き込みのたびにテナント分を丸ごと入れ替える（`docs/adr/0004`）。件数が増えると遅い
- `timeline.html` は `TIMELINE_TOKEN` を知っている人には全リストが見える（確認用）
- シナリオの文字列で `$` から始まるものは束縛として置き換えられる（本文に `$100` などを書くと失敗する）

## このセッションの環境で分かったこと

- 2026-10-17: クラウドセッションが書いた ADR（0007・0008）が `origin/ccr-*` のブランチに残ったまま main に入っていなかった。セッションの始めに `git fetch` して、main 以外のリモートのブランチに未マージの作業がないかを見る
- 2026-10-17: `v*` のタグは CI が prod にデプロイする。記録用のタグは `proto-v1` のように別の名前にする
- 2026-10-17: 判断専用のモデル Jev（TypeSafe AI、2026-09 公開）は WebSearch で調べた。振り分けのモデルの候補（0010、計画 v2 の「記録・再生」）
- 2026-10-17: boid（novshi-tech/boid）は公開リポジトリで、クラウドセッションから `git clone --depth 1 https://github.com/novshi-tech/boid` で読める（push は不可）。
  Murmur の下敷きになった計画は `docs/plans/` の `cross-project-issue-triage.md`・`ingestion-identity.md`・`card-next-step-and-timeline.md`・`card-model-cleanup.md`

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
