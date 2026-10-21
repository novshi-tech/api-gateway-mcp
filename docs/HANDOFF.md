# 申し送り

最終更新: 2026-10-20（夜。ステップ 2「データソースのスレッド」を実装した。コアを v1 のタスク・派生からスレッド 1 種類に置き換え、4 シナリオを受信の流れで作り直した。残りは Claude の記録の取り直しだけ）。**次は `--ai record` で H6 を測り、それからステップ 3。** 次のセッションは、まずこれと `docs/PLAN.md`（v2）、`docs/adr/0014`・`0013` を読む。

## いまの状態

**2026-10-20（夜）: ステップ 2 を実装し、main に入れた（707e300。murmur-dev にデプロイ済み、dev の DB はマイグレーションと absence の seed を当てた）。** 要点:
- コア（`src/domain/`）を置き換えた。マスタは DataSource（service / notes）・List（データソース 1 つに 1 つ）・ListMember（読者）・AttributeDef（データソースに付く）。ChannelPolicy はなくした。
  `seedProblems` が「データソース 1 つにリスト 1 つ」「個人のメモの読者は本人だけ」「個人の資格情報は読者 1 人のデータソースだけ」を検査し、シナリオの読み込みで必ず通す
- イベントは `SignalObserved`（direction）・`SignalThreaded`（by: anchor / awaiting / no_match / ai / human / self、needsResponse）・`ThreadDismissed`（片付けと閉じるの兼用）・`ThreadReopened` の 4 つ。
  `ThreadClaimed`・`ThreadLinked`・`ThreadAttributeSet` はステップ 3、`OutboundRecorded`・`ReplyOverdue` はステップ 4、`ThreadMirrored` はステップ 7
- Ingest v2: 区切りは「アンカー（同じデータソースの中だけ）→ 返事待ちが 1 本だけ → 同じ相手の直近のスレッドから AI → 新しいスレッド」。受信はアンカーで決まっても AI が「返事や対応を求めているか」を判断する（mode: choose / new / fixed）。
  観測された送信は「求めているか」を判断せず、構造で決まれば AI を呼ばない。「求めていない」は confidence 0.8 以上でだけ採用（拾いすぎに倒す。設定は `NO_RESPONSE_CONFIDENCE_THRESHOLD`、直近の本数は `RECENT_THREAD_LIMIT`、既定 5）
- ボール（`comm.ts`）: 求める受信 → こちら、送信 → 相手、求めない受信 → 相手待ちなら「なし」、片付け → 開き直すまで「なし」。仕分け待ち = ボールがこちらで片付けていない
- アンカーに `threadKey`（ソースが元から持つ区切り。Jira の課題キー・PR）を足した。一致すればそのスレッド、一致しなければ新しいスレッドに決まる（AI は区切らない）。`jiraKeys`・`prRefs` は区切りに使わず、ステップ 3 の結び候補に使う
- 片付けたスレッドにアンカーでシグナルが来ても、Murmur は開き直さない。スレッドに `activeSinceDismissed` を立てて事実だけ返す（0014 の 4 を外のソースのスレッドにも当てた。complaint で確かめている）
- v1 の派生・承認・`Connector.send`・`ReplyEstimator`・`AiSummarizer`・期限の見回り・属性は、タスクと派生に結びついていたのでコアと一緒に外した（計画ではステップ 4 で外す予定だった。計画のステップ 4 の行を直した）。
  コネクタは取り込みだけ（`pull(source, cursor)`）。HTTP API はステップ 2 の分だけ（`/api/me`・`GET /api/threads`（filter: open / triage / all、data_source、tenant）・`GET /api/threads/:id`・`POST /api/threads/:id/dismiss`・`/reopen`・`POST /api/signals/:id/move`・`GET /api/lists/:id`）
- 4 シナリオを受信の流れで作り直した。送信は record_sent がまだないので、メーラー・Slack・LINE の管理画面から直接送った観測された送信として書いた。absence の v1 の s02 の取り違えは「返事待ちが 1 本だけ」の規則で打診のスレッドに入る
- 投影のテーブルは `threads`・`signals`・`dummy_queue`（データソースごと）。マイグレーションは `0001_v2_drop_v1_projections`（v1 の投影を落とす）と `0002_v2_threads`
- テスト: `pnpm test` で 137 件が緑、1 件スキップ（H6 の Claude 再生。記録がないため）。`pnpm scenario verify all`（`--db pglite` も）は 4 本とも一致。H6 はヒント実行で 100%（構造の区切り 29/29、AI の区切り 5/5、求めているか 24/24）

設計の正本はこのリポジトリ（`docs/PLAN.md` と `docs/adr/`、0011）。Google Doc は経緯の資料に格下げした。

**2026-10-20（午後）: 0013 を反映した計画 v2 を直樹が Claude Docs 上でレビューし、議論の結果を `docs/adr/0014` に書いた（採用）。** 要点: エンティティはスレッドの 1 種類。
用件とマイリストは「個人のメモ」というデータソース（読者は本人だけ）のスレッドにすぎず、別のエンティティとしては持たない。リストはデータソースごとに 1 つ（`List.kind` 廃止）。
Matter 系のイベントは全部廃止（メモは `SignalObserved`、属性は `ThreadAttributeSet`、閉じる・開くは `ThreadDismissed` / `ThreadReopened`）。`SignalReceived` と `SignalObservedSent` は `SignalObserved` + direction に統合。
スレッド同士を結ぶのは人とスタンド（`ThreadLinked`、無向、unlink あり）で、Murmur はアンカーの一致を結び候補として出すだけ。自動の用件作成・自動リンク・自動の開き直しはなし。fold は 1 段。
計画 v2（方向・データモデル・イベント・投影・ルール・結び・API・シナリオ・ステップ・H1〜H9）、`CLAUDE.md`、0012・0013 の状態行を同日に直した。**直樹は全文を読んでレビュー済み。ステップ 1 は完了。**
0014 の未決 1〜5（`ThreadDismissed` の二役、メモのスレッドの件名、結び候補の範囲、経路 anchor の名前、`record_sent` の元スレッド省略）は直樹に挙げたが、実装を止めるものではない。
**未決 1 は同日に決めた: `ThreadDismissed` は「仕分け待ちから片付ける」と「個人のメモのスレッドを閉じる」を同じイベントで扱う。** どちらも「このスレッドにこれ以上ボールは動かない」の宣言で、
可視性はデータソースの読者で決まるので、イベントを分ける理由は意味の違いだけ。イベントを増やすのは慎重に（直樹）。ステップ 2 ではこの前提でイベントを作り、ステップ 3 で困ったら分ける。

**2026-10-20: 直樹が計画 v2 をレビューして止め、議論の結果を `docs/adr/0013` に書いた（採用）。** 要点: チームの共有は既存のツール（Jira・グループメール・Slack）に任せ、
Murmur はテナントで共有する連絡の索引（ソースのミラー。テナントで 1 つの共有の実体、見えるのはソースの読者）と、各自のマイリスト（項目・メモ・属性）になる。
チームリスト・購読・自然文の分類器・派生・本体の承認・外部のリストを外す。Jira は粒度を元から持つデータソース。持ち主は `ThreadClaimed`（ボールを特定のユーザーへ）、
外の受け皿へのリンクは `record_sent` のアンカー、どちらも共有の層の事実でマイリストから導出しない。マイリストの fold は自分の層のイベント + 共有の層の投影を読み、逆はない。
言葉は「外部リスト」「マイリスト」に決めた（0009 の「外部のリスト」とは別物。0013 の 8）。計画 v2（データモデル・イベント・つなぎ・送信の記録・API・シナリオ・ステップ・H1〜H10）、
`CLAUDE.md` の冒頭と約束事、0012 の定義文を同日に直した。計画 v2 の 0013 反映は、同日午後のレビューで 0014 に置き換わった（上）。

計画 v2 を書いたあと、直樹と立ち位置の議論をして `docs/adr/0012` を書き、採用した。要点: Murmur は「人とエージェントが共有する判断の台帳」で、
連絡から対応の要る用件を抽出して追跡する。外には何も書かない（送信はスタンドが実行し、本体は事実を `OutboundRecorded` として綴じる）。
用件に宛てたメモ（`MatterNoted`）を綴じる 3 種類目として足す。前例は boid（card = 判断の台帳、signal inbox）で、Murmur はそれを一人のマシンからテナントの皆が届く場所へ持ち出したもの。
計画 v2 は 0012 のとおり直した（ステップ 4 は「送信の記録と派生」、起票ルールと `Connector.send` と `ReplyEstimator` は消え、H10 を足した）。**ステップ 1 は 2026-10-17 に直樹のレビューを通った。次はステップ 2。**

H7 で absence を実環境で回したところ、リストの構成に根本の問題が見つかった（s02 の取り違え。`docs/adr/0009` の背景）。
直樹と議論して、リストを 2 層（会話の層 = データソース、用件の層 = 人とチーム）に組み替えることにし（0009）、
製品の方向（Murmur は黒子。用件ごとに正を 1 つ、0010）も決めた。計画を v2 に書き直し、v1 の計画と実装はタグ `proto-v1` に残した。

| リポジトリ | main | 内容 |
| --- | --- | --- |
| novshi-tech/murmur | 最新（デプロイ済み） | v1 の実装 + 実環境の接続 + 計画 v2（0014 反映済み）。v2 のステップ 2（データソースのスレッド）を実装済み。H6 の記録の取り直しが残り |
| novshi-tech/api-gateway-mcp | f6fa0ed（デプロイ済み） | 認証方式 `identity`（ユーザー ID を Ed25519 で署名して `Authorization: Bearer`）、`binding`（Service Binding 中継）、`/.well-known/jwks.json` |
| novshi-tech/nvt-api-gateway-skills | 84d9fec | スタンド用スキル `murmur`（プラグイン `nvt-api-gateway` 0.2.0）。v1 の API の表のまま（ステップ 2 で本体の `/api/tasks` などは消えたので、表は今の本体と合っていない）。v2 のステップ 5 で作り直す |

- murmur のテスト: `pnpm test` で 137 件が緑、1 件スキップ（v2 のステップ 2 のコア。v1 は 171 件だった）
- 3 リポとも、プロトタイプの間は main に直接 push する運用（直樹の指示）
- 構成は FC-IS（`src/domain` が純関数のコア、`test/architecture.test.ts` で検査）。v2 でも変えない

## 仮説ごとの状態（v2）

v1 の H1〜H6 は緑だった（`proto-v1`）。v2 は仮説を立て直したので、全部これから（`docs/PLAN.md`）。

| 仮説 | 状態 | どのステップで |
| --- | --- | --- |
| H1 リプレイの決定性（fold は 1 段、リンク込み） | ステップ 2 の段（リンクなし）は緑。メモリと Postgres、1 段の検査も | 2〜4 |
| H2 状態は属性と導出で足りる（0014 で書き直し） | 未着手 | 3 |
| H3 境界 | 外のソースの分は緑（読者・個人のメールボックス・テナント外・ゴースト・seed の整合性） | 2（外のソース）・3（個人のメモ） |
| H4 送信の記録と持ち主の操作 | 未着手 | 3・4 |
| H5 観測と送信の記録の重複排除（両順） | v1 は緑（送信 → 観測の順だけ）。v2 は未着手 | 4 |
| H6 Ingest（区切り + 返事や対応を求めているか） | ヒント実行は緑。Claude の記録がまだない（次のセッション） | 2 |
| H7 スタンドで完走 | v1 で absence を s02 まで回して止めた | 6 |
| H8 構造と持ち主だけで「自分の番」が決まり、結び候補が正しく出る（0014 で書き直し） | 未着手 | 3 |
| H9 状態の写しを持つデータソース（Jira。起票でリンクが付く） | 未着手 | 7 |
| H10 Murmur あり vs なし（新、0012） | 未着手 | 6 |

## 残作業（計画 v2 の実装ステップ）

1. **計画の書き直し**（済み。2026-10-20 に 0014 反映まで直樹のレビューを通った）: `docs/PLAN.md` v2、`CLAUDE.md`、ADR 0008〜0014
2. **データソースのスレッド**（実装済み。記録の取り直しと H6 の判定が残り）: DataSource、スレッド、Ingest v2（`SignalObserved` + direction）、片付け、シグナルの移し替え、記録の取り直し（H1・H3・H6）
3. **個人のメモとリンク**（H1・H2・H8。`add_note`、「自分の番」ビューと結び候補、`ThreadLinked` / unlink、持ち主 `ThreadClaimed`、本人が付ける属性、片付けと開き直し、導出したボールとタイムライン） 4. **送信の記録**（H4・H5。派生はない） 5. **API・スキル・管理 UI** 6. **H7・H10** 7. **状態の写しを持つデータソース**（H9） 8. **振り返り**
- 並行トラック: ステップ 2 のあと、0007 の実データでの試用（読み取り専用の Gmail を読者 1 人のデータソースとして）。前提は 0007 の 6（記録の置き場所）を決めること

実環境の控え（v1 で設定済み、v2 でも使う）:
- Neon プロジェクト `murmur`（quiet-dust-32237629、aws-ap-southeast-1、組織 株式会社ノブシテック）の `dev` ブランチ。v2 ではスキーマが変わるので、マイグレーションを作り直して当て直す
- murmur-dev（https://murmur-dev.nose-0d2.workers.dev）。secrets は `DATABASE_URL`・`ANTHROPIC_API_KEY`・`WEBHOOK_SECRET`・`TIMELINE_TOKEN`、vars は `GATEWAY_JWKS`・`IDENTITY_ISSUER`
- ゲートウェイの本番に `MURMUR`（→ murmur-dev）の Service Binding と `SERVICES.murmur`。Cowork に `api-gateway` と `nvt-api-gateway`（0.2.0）を入れてある
- main への push で CI が murmur-dev にデプロイする。`v*` のタグは prod にデプロイするので打たない（v1 のタグは `proto-v1`）
- 鍵・トークン・接続文字列は直樹のマシンの `~/.config/murmur/dev.env`（600、`set -a; . ~/.config/murmur/dev.env; set +a`）。Neon の API キーは `~/.config/neonctl/api_key`
- seed の投入は `pnpm seed <scenario> --user <seed の User ID>=<ゲートウェイの User ID>`、受信の送信は `pnpm send <scenario> <signal の id>...`。
  直樹のゲートウェイの User ID は `entra_6f043b7f-9709-4e71-bfa1-bd38a935316b_a86eed80-97f7-41a9-b7cc-2c6849408afb`
- dev の DB は 2026-10-20 に v2 のスキーマにして absence の seed を入れた（イベントは空）

## 次のセッションでやること

1. （済み、2026-10-21）**H6 の記録**: 直樹が手元で `--ai record`（claude-sonnet-5-5）を流してコミットした（47c43f1）。全体 32/35 = 91.4%、AI の区切り 5/5、構造の区切り 29/29、求めているか 20/24。
   `pnpm test` の H6 の再生テストは緑（139 件すべて緑）。`pnpm scenario verify all --ai replay` は下の 3 件で終了コード 1（CI はヒント実行なので影響なし）。
   外れた 3 件はどれも Claude 自身は「求めていない」と答え、confidence が閾値 0.8 未満で「求めている」に倒れたもの: development s07（パイプライン成功、0.70）・absence s05（回復の連絡、0.70）・complaint s02（協力会社の作業報告、0.72）。
   逆に absence s03（遅刻の連絡、ラベルは true）は Claude が false（0.72）と答え、閾値で true に倒れて当たった。閾値なしの生の判断なら求めているかは 23/24。
   **閾値をどうするかは直樹の判断待ち**（下の「直樹に判断してもらうこと」）
2. （済み、2026-10-20）main に入れて CI（run #29）で murmur-dev にデプロイした。直樹が dev の DB に `pnpm db:migrate`（0001・0002）と `pnpm seed absence --user u_kimura=<直樹のゲートウェイの User ID>` を流した。
   CI はマイグレーションも seed も走らせない（secrets は `CLOUDFLARE_API_TOKEN` だけ）。スキーマを変えたら、デプロイの前後で手で `pnpm db:migrate` を当てる（CD には入れない、直樹）。
   wrangler の vars は `IGNORE_CONFIDENCE_THRESHOLD` から `NO_RESPONSE_CONFIDENCE_THRESHOLD` に改名した。スキルの API の表は今の本体と合わない（ステップ 5 まで、スタンドからは使えない）
3. ステップ 3（個人のメモとリンク）に入る: `add_note`、`ThreadLinked` / unlink、`ThreadClaimed`、`ThreadAttributeSet`、「自分の番」ビューと結び候補（`jiraKeys`・`prRefs`・sent_ref）、導出したボールとタイムライン。development に DEV-12 / DEV-30 の例を足す
4. 手が空いたら、0012 の未決 2（LINE の Messaging API が自分の push を webhook で返すか）を WebSearch で確かめる。ステップ 4 までに分かっていればよい
5. ステップ 4 で `record_sent` の返事期待を受けるとき、v1 で直した「オフセット付きの時刻を UTC にそろえる」（`Instant`、v1 の `src/api/schemas.ts`）を戻す。派生と一緒に消えている

## H7 の absence を途中まで回して分かったこと（2026-10-17、Cowork）

- s01 → 打診の提案・承認 → 属性の設定までは、指示と承認だけで回った。打診の文面に山本さんの発熱は出ていなかった
- 「明日（17日）」は 17 日に届いたので、直樹の判断で日付間違いとして 10/18 に読み替えた（`shift_date` と打診の文面の両方）
- スタンドは `kind=欠勤` を設定しなかった。欠勤タスクの件名は受信時の「明日(17日)」のまま
- バグ（直した）: スタンドが返事期待の期限を `+09:00` 付きで渡すと文字列のまま保存され、見回りが UTC の現在時刻と文字列で比べて 9 時間ずれていた
- バグ（直した）: Ingest の訂正で打診の適用先に付け直しても `DerivationReplied` が出ず、打診が sent のまま期限超過になるところだった
- s02（伊藤さんの承諾）を AI が欠勤タスクに付けた（confidence 0.6）。原因と、そこからの議論は `docs/adr/0009` の背景
- dev の DB には、s02 が欠勤タスクに付いた状態が残っている。回し直すときは seed から入れ直す

## 直樹に判断してもらうこと

- H6 の「求めていない」の閾値（`NO_RESPONSE_CONFIDENCE_THRESHOLD`、0.8）: 2026-10-21 の記録では、生の判断の「求めていない」の confidence が 0.70〜0.72 に固まり、閾値で 4 件が「求めている」に倒れた（3 件はラベルと外れ、1 件は当たり）。
  案は (1) 0.8 のまま（拾いすぎは設計どおり、片付けで落とす）、(2) 0.7 に下げる、(3) プロンプトに例を足して rerecord。0007 の実データで分布を見てから決める案を推した
- ステップ 2 で決めた実装の細部（計画と食い違いはないと判断したが、見てほしい）:
  1. 片付けたスレッドにアンカーで新しいシグナルが来ても開き直さず、`activeSinceDismissed` で知らせるだけにした（外のソースのスレッドにも 0014 の 4 を当てた）。仕分け待ちには出ないので、スタンドが `activeSinceDismissed` を見て開き直す運用になる
  2. `SignalThreaded.by` に `no_match`（どの規則にも当たらず候補もない → 新しいスレッド）を足した。計画のイベントの表に書き足した
  3. アンカーに `threadKey`（Jira の課題キー・PR。ソースが元から持つ区切り）を足し、一致しなければ AI に聞かず新しいスレッドにした。メールの In-Reply-To や Slack の thread_ts は「一致すれば続き」だけで、ないときは AI が区切る
  4. v1 の派生・承認・送信・期限の見回り・属性を、計画より早くステップ 2 で外した（タスクと派生に結びついていて、スレッドの上に移す意味がないため）。期限の見回りはステップ 4、属性はステップ 3 で戻る
- `docs/adr/0014` の未決 2〜5（急がない。ステップ 3 までに決まっていればよい。1 の `ThreadDismissed` の二役は「同じイベントで始める」と決めた）
- `docs/adr/0013` の未決 3〜5（急がない。1 の単語と 2 の自動作成の範囲は 0014 で解消）
- `docs/adr/0012` の未決 2〜5（急がない。未決 1 は 0013 で解消）
- `docs/adr/0002`（提案）: テストを `@cloudflare/vitest-pool-workers` ではなく Node の vitest と pglite で回している。計画からの逸脱
- `docs/adr/0003` の未決: 本体が JWKS を設定値で持つか、ゲートウェイから取りに行くか（今は設定値）
- `docs/adr/0007`「量の見通し」の 6: 実メールの本文が残る記録（`recordings`）をどこに置くか。並行トラック（実データでの試用）の前提
- 2026-10-17 に決めたこと（参考）: 0008（業務の知識を持たない）・0009（2 層のリスト）・0010（黒子）・0011（正本はリポジトリ）・0012（判断の台帳、外には書かない）は採用。2026-10-20 に 0013（チームの共有は既存のツール）・0014（エンティティはスレッドの 1 種類）を採用し、計画 v2 もレビュー済み

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
