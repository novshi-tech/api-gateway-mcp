# 申し送り

最終更新: 2026-10-21（ステップ 5「API・スキル・管理 UI」の本体側を実装した。スキルは nvt-api-gateway-skills の main に反映した（c3e4c41、プラグイン 0.3.0）。本体のステップ 5 も 2026-10-21 に main に反映した（600956b。マイグレーションの追加はない））。以前: 2026-10-21（深夜。ステップ 4「送信の記録」を実装した。H4・H5 が緑。ステップ 3 と合わせて 2026-10-21 に main に反映（35f05ad、直樹の了承）。マイグレーションの追加はないので dev の DB はそのまま）。以前: 2026-10-21（夜。ステップ 3「個人のメモとリンク」。H1（リンク込み）・H2・H8 が緑）。**次はステップ 5 の残り（2026-10-21 に直樹がプラグイン 0.3.0 を入れ、クラウドセッションからゲートウェイ経由で `GET /me`・`/lists`・`/threads?filter=all` が 200 で返るのを確かめた（木村として、スレッドは 0 件）。残りの「書き込みを含めてゲートウェイ経由で一通り呼ぶ確認」は、H7（ステップ 6）の absence をスタンド主導で回すのと一緒にやる（直樹、2026-10-21）。手順は `docs/stand/h7-absence.md`。`pnpm send` は record_sent の echo の行（観測された送信）も流せるようにした（`--sent-ref` で上書き可）。Claude の記録は 2026-10-21 に取り直した（75c1736。H6 は 33/33））。直樹のレビュー（下の「ステップ 3 で決めた細部」「ステップ 4 で決めた細部」）も残っている。** 次のセッションは、まずこれと `docs/PLAN.md`（v2）、`docs/adr/0014`・`0013` を読む。

## いまの状態

**2026-10-21: ステップ 5 の本体側を実装した（クラウドセッション。ブランチ `ccr-fab8e92c-c9jtn1`、main の c358f37 の上）。** 要点:
- API: 計画の「スタンド接続」の表と突き合わせ、足りなかった 2 つを足した。`GET /api/lists`（list_lists。見えるリストの一覧、`tenant` で絞れる）と、`GET /api/threads` の `since`
  （それより後に動いたスレッドだけ。スレッド自身か、見えるリンク先の updatedAt で見る。メモのスレッドは結んだ先が動けば差分に入る）。
  `since`（一覧・詳細とも）は `Instant` で受け、オフセット付きでも UTC にそろえる。ほかのツール（get_thread・claim・link・unlink・add_note・record_sent など）はステップ 3・4 で入っていた
- 管理 UI（参照専用）: `src/http/admin.ts`（純関数で HTML を描く）。`/admin`（テナントごとのリスト一覧。未片付け・仕分け待ち・期限超過の件数）→ `/admin/lists/:id`（スレッドの一覧。誰の番・ボール・結び・属性・状態）→
  `/admin/threads/:id`（誰の番・結び・結び候補・属性・結んだ先のシグナルも並べたタイムライン）。`timeline.html` と同じく `TIMELINE_TOKEN` をクエリで渡した人だけ（ほかは 404）、トークンはリンクに引き回す。
  運用者は全データソースが見える（結び候補もテナントの全スレッドから出す）。`src/http/timeline.ts` は `admin.ts` に統合した
- スキル: v2 の SKILL.md を `docs/stand/skill-murmur.md` に書いた（ツールの表、`record_sent` の入力、「送る → 記録する」を 1 つの手順に、リンクは候補を見てユーザーと決めてから張る、閉じたメモを勝手に開き直さない）。
  2026-10-21 に、スキルのリポ（novshi-tech/nvt-api-gateway-skills）の `plugins/nvt-api-gateway/skills/murmur/SKILL.md` をこの下書きで置き換え、プラグインを 0.3.0 に上げて main に push した（c3e4c41。README の説明も直した。スキルのリポのテストは 22 件緑）。record_sent の anchors の例に `quoted_message_id` を足し、下書きもそろえた
- `docs/stand/connect.md` の確認手順（list_my_tasks → list_threads）と管理画面の入口、`CLAUDE.md` の構成と公開ルートを直した
- テスト: `pnpm test` で 180 件が全部緑。`pnpm scenario verify all` は 4 本とも一致。スキーマは変わらない（マイグレーション不要）
- 残り（ステップ 5 の完了条件「ゲートウェイ経由で一通り呼べる」）: スキルを反映し、main に入れて murmur-dev にデプロイしたあと、Cowork か Claude Code から一通り呼ぶ（seed を入れて Webhook で受信を流す）。そのあと Claude の記録の取り直し（下の「次のセッションでやること」4）

**2026-10-21（深夜）: ステップ 4 を実装した（クラウドセッション。ブランチ `ccr-fab8e92c-c9jtn1`、ステップ 3 の上）。** 要点:
- イベントを 2 つ足した: `OutboundRecorded`（`merged: false` なら送ったシグナルを作る、`true` なら先に届いた観測された送信に記録を重ねる）、`ReplyOverdue`（期限超過、同じ送信に 1 回）
- `record_sent`（`POST /api/sent`）の判断は新しい `src/domain/outbound.ts`。置き先は `reply_to_thread_id`（同じデータソース）→ アンカー → 新しいスレッド。
  `source_thread_id`（どのデータソースでもよい）があれば経路 sent で結ぶ。sent_ref はシグナルの messageId になり、返事は送ったスレッドに戻る。同じ sent_ref の記録は冪等
- 観測された送信の統合（H5）: 記録 → 観測の順は、Ingest が messageId で記録済みのシグナルを見つけたら `merged` を返してイベントを出さない。観測 → 記録の順は `OutboundRecorded(merged: true)` が返事期待だけを載せる（reply_to が Ingest の置き先と違えば移す）。どちらもシグナルは 1 本、ボールは二重に動かない
- 返事期待: 記録した送信の `reply_expected_by` がスレッドの `replyExpectedBy` になり、受信が来れば消える。Cron（`tick` → `checkOverdue`）が期限を過ぎたスレッドに `ReplyOverdue`、遅れて返事が来れば解消。
  一覧の `filter=overdue`。`reply_expected_by` はオフセット付きでも UTC にそろえる（v1 の `Instant` を `src/api/schemas.ts` に戻した）
- 結び候補のキーに messageId（`msg:<id>`、つまり sent_ref）を足した。同じメールや DM を 2 人がそれぞれのデータソースで見ていれば候補になる
- シナリオ: 既存の観測された送信を `record_sent` に置き換えた（absence の打診 o01、complaint の協力会社への依頼 o01、repair-estimate の鈴木の見積依頼 o02。どれも元のスレッドと経路 sent で結ばれ、ダミーの echo が統合される）。
  complaint・repair-estimate は期限超過 → 返事で解消、complaint のお詫び o03 は観測が先で記録があと（r03）。ステップ 3 で手で張った sent 相当のリンク（absence の a02）は消した
- **記録は取り直していない**（このセッションに `ANTHROPIC_API_KEY` がない）。記録した送信は観測された送信と同じ順に ID を使う（シグナル → 新しいスレッド）ので、置き換えても後の AI のプロンプトは変わらず、再生で 4 本とも一致する。置き換えた行の AI 判断はなくなった（absence の o02 は観測された送信のまま残して AI の区切りを測っている）
- テスト: `pnpm test` で 177 件が全部緑。`pnpm scenario verify all`（`--db pglite`・`--ai replay` も）は 4 本とも一致。スキーマは変わらない（投影は jsonb）

**2026-10-21（夜）: ステップ 3 を実装した（クラウドセッション。ブランチ `ccr-fab8e92c-c9jtn1`）。** 要点:
- イベントを 3 つ足した: `ThreadClaimed`（userId: null で手放す）、`ThreadLinked`（無向。`op: link | unlink`、経路 sent / anchor / manual）、`ThreadAttributeSet`（value: null で外す）。
  個人のメモは新しいイベントを作らず `SignalObserved`（channel `note`、direction outbound、from は本人の Party）+ `SignalThreaded`（by `self`）
- fold（1 段のまま）: 持ち主はボールに入る（持つ・引き継ぐ → `{kind:'user'}`、手放す → `us`、持ち主がいる間の「こちらの番」は持ち主へ）。リンクは 1 つのイベントで両端に同じ辺を載せる。属性はスレッドの `attributes`。
  メモはログの kind `note` でボールを動かさない。スレッドの投影に `ownerUserId`・`links`・`attributes` を足した（DB は jsonb なのでマイグレーションは要らない）
- クエリ層（新しい `src/domain/turn.ts`）: 誰の番か（`turn`: 持ち主 → 読者が 1 人のデータソース → 受信の宛先に読者 → どれでもなければ仕分け待ち）、
  リンク先から導出したボール（`derivedBall`: 見えるリンク先のどれかが自分の番 → my_turn、全部相手待ち → waiting、ほか none）、
  閉じたスレッドに結ばれた先が動いた（`linkedActiveSinceDismissed`。開き直さない）、結び候補（`linkCandidates`: threadKey・jiraKeys・prRefs が一致する見えるスレッドで、まだ結んでいないもの）
- 一覧のフィルタに `my_turn`・`mine` を足し、`triage` は「持ち主も構造で決まる人もいない」に直した。詳細は `linked`（見えない先は id と経路だけ）と `timeline`（自分のログ + 見えるリンク先のシグナル、`since`）を返す
- HTTP: `POST /api/notes`・`/api/threads/:id/claim`・`/links`・`/unlink`・`/attributes`、`GET /api/threads?filter=my_turn|mine`、`GET /api/threads/:id?since=`。スキルの API の表は直していない（ステップ 5）
- シナリオ: absence（木村が欠勤を持ち、打診のスレッドと結ぶ。メモなし）、complaint（佐藤が持ち、メモのスレッドを作って 2 本と結び、優先度を付けて閉じる。別件の返信で `linkedActiveSinceDismissed`）、
  development（NVT-42 と NVT-50 に触れた Slack の補足 o03 を足し、候補から NVT-42 の課題だけを結ぶ。課題と PR も結ぶ。計画の DEV-12 / DEV-30 の例をフィクスチャの課題キーで書いた）、repair-estimate（「自分の番」の確認だけ）。
  `record_sent` がまだないので、送ったスレッドは `link_threads` で手で結んだ（ステップ 4 で `record_sent` の sent 経路に置き換える）
- 記録の取り直しは要らなかった（足した受信はなく、o03 は構造で決まる観測された送信）。注意: プロンプトに候補のスレッドの連番 id が入るので、AI 判断の前に `add_note` を足すと記録のキーがずれる（complaint はメモを o01 の後に置いた。`fixtures/README.md` に書いた）
- テスト: `pnpm test` で 163 件が全部緑（H6 の再生を含む）。`pnpm scenario verify all`（`--db pglite`・`--ai replay` も）は 4 本とも一致

**2026-10-20（夜）: ステップ 2 を実装し、main に入れた（707e300。murmur-dev にデプロイ済み、dev の DB はマイグレーションと absence の seed を当てた）。** 要点:
- コア（`src/domain/`）を置き換えた。マスタは DataSource（service / notes）・List（データソース 1 つに 1 つ）・ListMember（読者）・AttributeDef（データソースに付く）。ChannelPolicy はなくした。
  `seedProblems` が「データソース 1 つにリスト 1 つ」「個人のメモの読者は本人だけ」「個人の資格情報は読者 1 人のデータソースだけ」を検査し、シナリオの読み込みで必ず通す
- イベントは `SignalObserved`（direction）・`SignalThreaded`（by: anchor / awaiting / no_match / ai / human / self、needsResponse）・`ThreadDismissed`（片付けと閉じるの兼用）・`ThreadReopened` の 4 つ。
  `ThreadClaimed`・`ThreadLinked`・`ThreadAttributeSet` はステップ 3、`OutboundRecorded`・`ReplyOverdue` はステップ 4、`ThreadMirrored` はステップ 7
- Ingest v2: 区切りは「アンカー（同じデータソースの中だけ）→ 返事待ちが 1 本だけ → 同じ相手の直近のスレッドから AI → 新しいスレッド」。受信はアンカーで決まっても AI が「返事や対応を求めているか」を判断する（mode: choose / new / fixed）。
  観測された送信は「求めているか」を判断せず、構造で決まれば AI を呼ばない。「求めているか」は AI の答えをそのまま使う（2026-10-21 に閾値をやめた。直近の本数は `RECENT_THREAD_LIMIT`、既定 5）
- ボール（`comm.ts`）: 求める受信 → こちら、送信 → 相手、求めない受信 → 相手待ちなら「なし」、片付け → 開き直すまで「なし」。仕分け待ち = ボールがこちらで片付けていない
- アンカーに `threadKey`（ソースが元から持つ区切り。Jira の課題キー・PR）を足した。一致すればそのスレッド、一致しなければ新しいスレッドに決まる（AI は区切らない）。`jiraKeys`・`prRefs` は区切りに使わず、ステップ 3 の結び候補に使う
- 片付けたスレッドにアンカーでシグナルが来ても、Murmur は開き直さない。スレッドに `activeSinceDismissed` を立てて事実だけ返す（0014 の 4 を外のソースのスレッドにも当てた。complaint で確かめている）
- v1 の派生・承認・`Connector.send`・`ReplyEstimator`・`AiSummarizer`・期限の見回り・属性は、タスクと派生に結びついていたのでコアと一緒に外した（計画ではステップ 4 で外す予定だった。計画のステップ 4 の行を直した）。
  コネクタは取り込みだけ（`pull(source, cursor)`）。HTTP API はステップ 2 の分だけ（`/api/me`・`GET /api/threads`（filter: open / triage / all、data_source、tenant）・`GET /api/threads/:id`・`POST /api/threads/:id/dismiss`・`/reopen`・`POST /api/signals/:id/move`・`GET /api/lists/:id`）
- 4 シナリオを受信の流れで作り直した。送信は record_sent がまだないので、メーラー・Slack・LINE の管理画面から直接送った観測された送信として書いた。absence の v1 の s02 の取り違えは「返事待ちが 1 本だけ」の規則で打診のスレッドに入る
- 投影のテーブルは `threads`・`signals`・`dummy_queue`（データソースごと）。マイグレーションは `0001_v2_drop_v1_projections`（v1 の投影を落とす）と `0002_v2_threads`
- テスト: `pnpm test` で 139 件が全部緑（H6 の Claude 再生を含む）。`pnpm scenario verify all`（`--db pglite`・`--ai replay` も）は 4 本とも一致。H6 は再生で 35/35（構造の区切り 29/29、AI の区切り 5/5、求めているか 24/24）

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
| novshi-tech/murmur | ステップ 2 まで（デプロイ済み） | v1 の実装 + 実環境の接続 + 計画 v2（0014 反映済み）。v2 のステップ 2 は main。ステップ 3（H1・H2・H8 が緑）はブランチ `ccr-fab8e92c-c9jtn1` |
| novshi-tech/api-gateway-mcp | f6fa0ed（デプロイ済み） | 認証方式 `identity`（ユーザー ID を Ed25519 で署名して `Authorization: Bearer`）、`binding`（Service Binding 中継）、`/.well-known/jwks.json` |
| novshi-tech/nvt-api-gateway-skills | c3e4c41 | スタンド用スキル `murmur`（プラグイン `nvt-api-gateway` 0.3.0）。v2 の API（スレッド・メモ・リンク・持ち主・record_sent）の表。本体はステップ 5 まで main に入っている。Cowork のプラグインの入れ替えは直樹 |

- murmur のテスト: `pnpm test` で 180 件が全部緑（v2 のステップ 5 の本体側まで。v1 は 171 件だった）
- 3 リポとも、プロトタイプの間は main に直接 push する運用（直樹の指示）
- 構成は FC-IS（`src/domain` が純関数のコア、`test/architecture.test.ts` で検査）。v2 でも変えない

## 仮説ごとの状態（v2）

v1 の H1〜H6 は緑だった（`proto-v1`）。v2 は仮説を立て直したので、全部これから（`docs/PLAN.md`）。

| 仮説 | 状態 | どのステップで |
| --- | --- | --- |
| H1 リプレイの決定性（fold は 1 段、リンク込み） | ステップ 3 の段（リンク・持ち主・属性・メモ込み）は緑。メモリと Postgres、1 段の検査（リンクの相手は作成だけ残す）も | 2〜4 |
| H2 状態は属性と導出で足りる（0014 で書き直し） | 緑（2026-10-21）。メモのスレッドのボールはリンク先から導出、閉じた件は自動で開かない | 3 |
| H3 境界 | 緑。外のソースに加えて、個人のメモは本人だけ、リンクの辺は見えるが先の中身は見えない、候補は見えるものだけ | 2・3 |
| H4 送信の記録と持ち主の操作 | 緑（2026-10-21）。記録 → 送ったスレッド・sent のリンク・ボールが相手へ → 返事は送ったスレッドに戻る → 期限超過 → 遅れた返事で解消、と持ち主の操作 | 3・4 |
| H5 観測と送信の記録の重複排除（両順） | 緑（2026-10-21）。メール・LINE で両順。Jira のコメントはステップ 7 | 4 |
| H6 Ingest（区切り + 返事や対応を求めているか） | 緑（2026-10-21、claude-sonnet-5-5 の再生で 35/35） | 2 |
| H7 スタンドで完走 | v1 で absence を s02 まで回して止めた | 6 |
| H8 構造と持ち主だけで「自分の番」が決まり、結び候補が正しく出る（0014 で書き直し） | 緑（2026-10-21）。Jira の担当者で決まる分はステップ 7（ThreadMirrored） | 3 |
| H9 状態の写しを持つデータソース（Jira。起票でリンクが付く） | 未着手 | 7 |
| H10 Murmur あり vs なし（新、0012） | 未着手 | 6 |

## 残作業（計画 v2 の実装ステップ）

1. **計画の書き直し**（済み。2026-10-20 に 0014 反映まで直樹のレビューを通った）: `docs/PLAN.md` v2、`CLAUDE.md`、ADR 0008〜0014
2. **データソースのスレッド**（済み。2026-10-21 に H6 まで緑）: DataSource、スレッド、Ingest v2（`SignalObserved` + direction）、片付け、シグナルの移し替え、記録の取り直し（H1・H3・H6）
3. **個人のメモとリンク**（済み。2026-10-21 に H1・H2・H8 が緑。直樹のレビュー待ち） 4. **送信の記録**（済み。2026-10-21 に H4・H5 が緑。直樹のレビュー待ち） 5. **API・スキル・管理 UI**（本体側は済み。スキルのリポへの反映と、ゲートウェイ経由の確認が残る） 6. **H7・H10** 7. **状態の写しを持つデータソース**（H9） 8. **振り返り**
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

0. **（2026-10-21、最優先）実データの試用**: 直樹「H7 は一回まわせればいい。それより外部コネクタを使った実データで評価できるようにしたい」。`docs/adr/0015`（提案）に案を書いた。
   手元の pull スクリプトがゲートウェイ経由で Gmail（nvt、ラベル 1 つ）を読み、本体の Webhook に流す。記録は手元だけ。**直樹の確認を待って実装する**（未決: ラベル、本文を送ってよい範囲）。
   H7 は absence の s01 まで流したところで止めた（dev の DB にスレッド 1 本）。日付が「明日（17日）」のまま実時刻とずれる（v1 と同じ）。回すときはその場で読み替える


1. （済み、2026-10-21）**H6 の記録と判定**: 直樹が手元で `--ai record`（claude-sonnet-5-5）を流してコミットした（47c43f1）。
   最初は閾値 0.8 で「求めていない」（confidence 0.70〜0.72）が 4 件「求めている」に倒れていた。直樹と話して次のとおり決めた:
   - 閾値で倒すのをやめ、Claude の答えをそのまま使う（`NO_RESPONSE_CONFIDENCE_THRESHOLD` は消した。confidence は監査用に残すだけ）。閾値を下げるのではなく、シンプルで予測しやすい挙動を優先する
   - 遅刻の連絡（absence s03）は知らせだけなので「求めていない」（ボールは動かない）。勤怠を要対応とするのは業務の知識で、将来の振り分けルールのカスタマイズの話。デフォルトでは落とす
   結果: **H6 は緑**。再生で全体 35/35、AI の区切り 5/5、構造の区切り 29/29、求めているか 24/24。`pnpm scenario verify all --ai replay` も 4 本とも一致。ステップ 2 の完了条件（H1・H3・H6）はすべて緑
   見落としの側（本当は返事が要るのに「求めていない」になる）は、0007 の実データでの試用で件数を見る
2. （済み、2026-10-20）main に入れて CI（run #29）で murmur-dev にデプロイした。直樹が dev の DB に `pnpm db:migrate`（0001・0002）と `pnpm seed absence --user u_kimura=<直樹のゲートウェイの User ID>` を流した。
   CI はマイグレーションも seed も走らせない（secrets は `CLOUDFLARE_API_TOKEN` だけ）。スキーマを変えたら、デプロイの前後で手で `pnpm db:migrate` を当てる（CD には入れない、直樹）。
   wrangler の vars の `IGNORE_CONFIDENCE_THRESHOLD` は消した（閾値をやめた）。スキルの API の表は今の本体と合わない（ステップ 5 まで、スタンドからは使えない）
3. （済み、2026-10-21 夜）ステップ 3（個人のメモとリンク）を実装した（上の「いまの状態」）。直樹が「ステップ 3 で決めた細部」を見て、よければ main に入れる（スキーマは変わっていないのでマイグレーションは要らない。dev の DB のイベントは空のまま）
4. （済み、2026-10-21 深夜）ステップ 4（送信の記録）を実装した（上の「いまの状態」）。2026-10-21 に main に反映した（直樹の了承）。そのあとステップ 5（API・スキル・管理 UI。スキルの API の表を作り直し、「送る → 記録する」を 1 つの手順に）
   （済み、2026-10-21）**ステップ 5 のあとの記録の取り直し**: 直樹が手元で `--ai rerecord`（claude-sonnet-5-5）を流してコミットした（75c1736）。全体 33/33、構造の区切り 27/27、AI の区切り 5/5、求めているか 24/24。`--ai replay` と `pnpm test`（180 件）も緑。
   rerecord は使わなくなった記録を消さないので、再生で読まれなかった 11 件をクラウドセッションで消した（記録は 25 件）。
   注意: 最初の 1 回は直樹の手元が閾値をやめる前のコードのままで、外れが並んだ。取り直す前に `git pull` して先頭のコミットを確かめる。
   今の記録（47c43f1）はステップ 3・4 のあとも再生で全部当たっている（プロンプトと入力が変わっていない）が、ステップ 5 までの変更をまとめて新しい記録で確かめる
5. 手が空いたら、0012 の未決 2（LINE の Messaging API が自分の push を webhook で返すか）を WebSearch で確かめる。ステップ 4 までに分かっていればよい
6. （済み）`record_sent` の返事期待は `Instant` で UTC にそろえる（`src/api/schemas.ts`）

## H7 の absence を途中まで回して分かったこと（2026-10-17、Cowork）

- s01 → 打診の提案・承認 → 属性の設定までは、指示と承認だけで回った。打診の文面に山本さんの発熱は出ていなかった
- 「明日（17日）」は 17 日に届いたので、直樹の判断で日付間違いとして 10/18 に読み替えた（`shift_date` と打診の文面の両方）
- スタンドは `kind=欠勤` を設定しなかった。欠勤タスクの件名は受信時の「明日(17日)」のまま
- バグ（直した）: スタンドが返事期待の期限を `+09:00` 付きで渡すと文字列のまま保存され、見回りが UTC の現在時刻と文字列で比べて 9 時間ずれていた
- バグ（直した）: Ingest の訂正で打診の適用先に付け直しても `DerivationReplied` が出ず、打診が sent のまま期限超過になるところだった
- s02（伊藤さんの承諾）を AI が欠勤タスクに付けた（confidence 0.6）。原因と、そこからの議論は `docs/adr/0009` の背景
- dev の DB には、s02 が欠勤タスクに付いた状態が残っている。回し直すときは seed から入れ直す

## 直樹に判断してもらうこと

- **ステップ 5 で決めた細部**（計画と食い違いはないと判断したが、見てほしい）:
  1. 管理 UI は `/admin` 以下に置き、`timeline.html` と同じ `TIMELINE_TOKEN`（クエリ）で守った。ゲートウェイの認証は通さない（運用者の確認用。全データソースが見える）
  2. list_threads の `since` は「スレッド自身か、見えるリンク先の updatedAt が since より後」。持ち主・リンク・属性の操作も updatedAt を動かすので差分に入る
  3. スキルの SKILL.md は murmur のリポに下書きを置いた（`docs/stand/skill-murmur.md`）。スキルのリポに入れたあとも、本体の API を変えたらこちらとスキルの両方を直すか、下書きを消すかを決めてほしい

- **ステップ 4 で決めた細部**（計画と食い違いはないと判断したが、見てほしい）:
  1. 計画の record_sent の「元のスレッド」を 2 つに分けた: `reply_to_thread_id`（返事をしているスレッド。送ったシグナルがそこに入る）と `source_thread_id`（送る元。経路 sent で結ぶ）。
     LINE 公式アカウントのように 1 つのデータソースで「欠勤のスレッドから打診を送る」とき、同じデータソースでも別のスレッドにしたいので、データソースが同じかどうかでは決められない
  2. 記録 → 観測の順の統合では、観測にイベントを出さない（シグナルは 1 本、状態も変わらない）。観測が届いた事実は残らない。残したければ軽いイベントを足す
  3. 返事期待は、どの受信でも消える（「了解」のような求めていない返事でも）。求めていない受信でボールが「なし」になるのと揃えた
  4. 手放すと仕分け待ちに戻るのはステップ 3 のまま。片付けたスレッドは期限超過にしない
  5. どこにも結ばれなかった観測された送信のスレッドを「送った本人の仕分け待ち」に出す（計画の投影の節）は入れていない。組織のメールボックスでは送った本人が分からない。読者 1 人のデータソースならすでに本人の「自分の番」の対象だが、ボールが相手なので出ない。前提の指標（結ばれなかった送信の件数）として数えるのがよいと思う
  6. 宛先は `to`（アドレス）か `to_party_ids`（そのチャネルの有効なアドレスに直す）。受信と同じ sent_ref を渡すと conflict
- **ステップ 3 で決めた細部**（計画と食い違いはないと判断したが、見てほしい）:
  1. 仕分け待ちから、構造で誰の番かが決まるスレッド（読者が 1 人のデータソース、受信の宛先に読者）を外した（計画の「誰の番か」の 1 のとおり）。
     そのため absence の補充依頼（LINE 公式アカウントは読者が木村 1 人）は、仕分け待ちではなく木村の「自分の番」に出る（ステップ 2 の expected を直した）
  2. 持つ・引き継ぐは、今のボールがどこにあってもボールをその人へ移す（相手待ちでも）。手放すと「こちら」（仕分け待ち）に戻る。持ち主がいる間に「求める受信」が来ればボールは持ち主へ
  3. `link_threads` の経路は、結び候補（アンカーの一致）から張れば anchor、そうでなければ manual をコアが付ける（API で経路は選ばない。0014 の未決 4 の「候補から張った印」の読み方）
  4. unlink は別のイベントにせず `ThreadLinked` の `op: unlink` にした（イベントを増やさない）。外すのは片端が見えていればできる（辺は見えるので）。張るのは両端が見える人だけ
  5. メモのシグナルは direction outbound（from が本人 = こちら）、channel `note`。件名は title、なければ本文の最初の行（0014 の未決 2）。メモのスレッドは持ち主を持たない（claim は invalid）
  6. 結び候補は「キー（threadKey・jiraKeys・prRefs）を 1 つでも共有する見えるスレッド」。課題キー同士だけでなく、同じ課題キーに触れた Slack と PR も候補になる（0014 の未決 3 は「見えるものだけ」のまま）
  7. 導出したボールは見えるリンク先だけ、片付けたリンク先は数えない。自分の番と相手待ちが混ざらず、仕分け待ちや他人の番が混ざれば none。`my_turn` の一覧にメモのスレッドは入れない（リンク先が入る）。`mine` は閉じたものも返す
  8. 持たせられるのはそのデータソースの読者（User を持つ Party）だけ

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
- 2026-10-21: `dev.env` の `DATABASE_URL` が Neon の murmur プロジェクトの `main` ブランチ（テーブルなし）の接続文字列になっていて、`pnpm seed` が `relation "events" does not exist` で落ちた。`dev` ブランチの接続文字列（プール用でよい）に直して通った。Neon はブランチごとにエンドポイント（`ep-...`）が違う。migrate・seed の前にホスト名を確かめる
- `~/.config/murmur/dev.env` の値はクォートしておく（接続文字列の `&` でシェルが割れ、エラー表示にパスワードが出た。2026-10-17 にロール neondb_owner のパスワードをリセット済み）
- `! gh secret set ...` は端末の入力欄が出ない。秘密の入力は直樹に別のターミナルでやってもらう
- ゲートウェイの本番 `wrangler.jsonc`（git 管理外）を書き換える前の控え: 前セッションの scratchpad にあるだけで、次のセッションからは見えない。差分は `services` の 1 行と `SERVICES.murmur` だけ

- クラウドセッションの git の経路ではリモートのブランチを削除できない（push --delete が切断される）。削除は GitHub の画面で
- 空のリポに最初に push したブランチが既定ブランチになる。新しいリポでは最初に main を push する
- このセッションには Claude のメモリがないので、申し送りはこのファイルに置く
