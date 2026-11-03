# 申し送り

最終更新: 2026-11-03（属性と写しを議論し、`docs/adr/0031`・`0032` を案で書いた。「いまの状態」の先頭）。2026-11-02（UBS の Murmur に 0030 をデプロイした。「いまの状態」の先頭）。2026-10-31（0030 を実装した。「いまの状態」の先頭）。**2026-10-28〜29 に最初の実コネクタ（Outlook）の設計を議論し、`docs/adr/0024`（採用）と `docs/adr/0023`（構想: リポジトリをまとめる）を書いた。次はゲートウェイの改修（api-gateway-mcp#15）から。****計画 v2（ステップ 1〜8）は完了した**（振り返りは `docs/retrospective-v2.md`、直樹のレビュー済み）。**2026-10-23 に Murmur の立ち位置を明確にした（`docs/adr/0020`: チーム単位でセルフホストし、チームの境界を越えることを最初から想定する）。マルチテナントを外してストレージを Cloudflare の中に移す方向（`docs/adr/0021`）と、Murmur 間連携の構想（`docs/adr/0022`）も書いた。同じ日に 0021 の決定 1〜3 を実装した（マルチテナントを外す・投影を差分で書く・D1 に移す。ブランチ `claude/adoring-noether-yjejoy`、main には未反映）。次のステップは次の段階（`docs/adr/0016`、汎用の書き方に直した）。** 次のセッションは、まずこのファイルの「次のセッションでやること」と 0020・0021・0016、`docs/retrospective-v2.md` を読む。

## いまの状態

**2026-11-03: スレッドの属性の扱いを議論し、`docs/adr/0031`（案）と `docs/adr/0032`（案、0027 を改める）を書いた。コードは変えていない。** きっかけ: `AttributeDef` が写しと本人の属性の 2 役を兼ね、定義は seed でしか作れず、実データでは属性を書くことも写すこともできない。要点:
- 0031: 1 タスク = 1 メモスレッド（着手を決めたらスタンドが作り、共有スレッドと結ぶ。`record_sent` の `source_thread_id` で実装・レビュー・修正のループが 1 本に綴じる）。共有スレッドには事実と構造の操作だけ。メモのシグナルに書き手の印（`author: user | agent(名前)`、自己申告、番には使わない）。属性はメモだけのもので標準は `due` だけ、完了は片付け。一覧は結んだ先も含めた最終更新の降順。写しは決まった形（`closed / holders / title / statusLabel / due`）でコネクタは標準の意味で写す（Jira はステータスカテゴリと担当者、PR はレビュー待ちならレビュアー・変更を求められたら作者）。写しにスレッドを作らせ、件名は写しの `title`（0016 の段取り 2・4 を置き換える）
- 0032: 次の一手を決める者が書く。オーケストレータの下のエージェント（boid の job・サブエージェント）は書かず、直接の参加者（オーケストレータ、PR を見張る Codex）は書き手の印を付けて書く（コレオグラフィ）。boid を使わないときはサブエージェントが基本。メモを共有できるのは本人のエージェントまで
- **同じ日に採用し、実装した**（ブランチ `ccr-59689cfd-kswup8`、PR #15。5 コミット）。4 シナリオは expected と一致（development の写しの行・expected・seed の属性定義だけ書き直した）、AI の記録の再生と D1 も一致。実装で決めたことは 0031 の「実装の記録」（`due` はマスタに書かず標準の定義として足す、など）
- HTTP API が変わった: スレッドに `source`（写し）・`lastActivityAt`、`turn.by` の `assignee` → `holder`、`POST /notes` の `author`。`docs/stand/skill-murmur.md` は直した
- 残り:
  - **スキル（novshi-tech/nvt-api-gateway-skills の `plugins/nvt-api-gateway/skills/murmur/`）を `docs/stand/skill-murmur.md` に合わせて直す**（0030 の分と一緒に）。0031 の 1・2（着手でメモのスレッドを作って結ぶ、共有スレッドには事実と構造だけ）と 0032 の参加の約束も、スキルの手順に書く
  - 0031 の未決 1〜4、0032 の未決 1〜3

**2026-11-02: UBS の Murmur に 0030 の実装をデプロイした（main の 2b764d3、Worker のバージョン `a9189f7b-e5b2-4a4c-bab4-14b0c0108207`）。** 10-31 は D1 に `0001_master_keys` を当てたが、Worker は 0030 より前のコード（10-31 16:22 JST のデプロイ）のままだった。クラウドセッションから `murmur-deployments` を clone して `pnpm run deploy ubs` で出し直した（マイグレーションは当て済みなので migrate は不要）。
- 確かめたこと: UBS のゲートウェイ（`identity:murmur`）経由の `GET /me` が 200 で `{ user: { id: <直樹の Entra の sub>, name: "" }, contact: null, lists: [] }`。これで直樹の User の行が 1 つできた（ほかは空）
- クラウドセッションからは `*.workers.dev` に直接届かない（プロキシが拒否）。確かめるときはゲートウェイの REST（`issue_token` → `https://gateway.urban-b.com/api/murmur/...`）から呼ぶ
- 次: データソースを入れて、リストに入るときのアイデンティティを選ぶ（0030 の流れ）。スキルの直し（下の「残り」）

**2026-10-31: Party の作り方を議論し、`docs/adr/0030`（`0030-contacts-and-query-time-resolution.md`）を採用した（直樹。実装は未着手）。** きっかけ: マスタは seed でしか作れず、`--user u_kimura=<ゲートウェイの ID>` の差し替えで直樹が接続すると「木村」になる。要点:
- Party を **Contact**（Outlook の連絡先と同じ形。アドレスを束ねた連絡の相手）に改め、組織の概念を外す（`kind`・`internal` を消す。どこからも読まれていなかった）。資格情報の主語 `organization` は `team` に。データソースの窓口のアドレスは値（`selfAddresses: AddressRef[]`）で持ち、チームの Contact は作らない
- イベントと fold はマスタに依存しない。`SignalObserved` から `direction` と Party ID を外し、fold はボールを「どのアドレスが持っているか」（`holders`・`requestedBy`）で畳む。どちら側のボールか・誰の番かはクエリ層がそのときのマスタで解決する（「こちら」= 窓口のアドレス + 読者の Contact のアドレス）。名寄せを後から直すと過去のスレッドの誰の番も直る。`needsResponse` はすべてのシグナルに付ける（こちらからなら Ingest が AI に聞かずに true）
- 読者は User で持つ（`ListMember = { listId, userId }`）。Contact の責務は名寄せとボールの判定だけ。個人のメモは `ownerUserId` で Contact に依存しない
- マスタはその場で書き換え、変更の記録を表 1 つに残す
- サインインの直後は sub だけの名無し（User の行だけ）。自分の Contact は、リストに入るときに、そのリストでのアイデンティティ（アドレス）を選んで決める。そのアドレスのゴーストがあれば sub に結ぶ。個人のリストはスタンドが API で作り（ゲートウェイの接続を先に確かめる）、共有のリストと読者は当面は管理者だけが足す
- 名寄せはスタンドがやる: `GET /addresses/unresolved` → `GET /contacts?q=` → 本人に確かめて `POST /contacts`・`POST /contacts/:id/addresses`。Murmur は自動では付けない。0016 の段取り 1 を含む。まとめる（別名を残す）・付け替える・結びを外す操作も持つ
- **実装した（2026-10-31、ブランチ `claude/laughing-einstein-0sdrz4`、5 コミット）。** 4 シナリオは expected のまま一致（担当者の写しの値だけアカウントに直した）、AI の記録の再生と D1 も一致。実装で決めたことは 0030 の「実装の記録」
- HTTP API が変わった: `/me` は `{ user, contact | null, lists }`、`list_lists` の読者は `{ userId, name, contactId }`、`record_sent` の `to_party_ids` → `to_contact_ids` と任意の `from`。足した: `PATCH /me`・`POST /data-sources`・`POST /lists/{id}/identity`・`/addresses/unresolved`・`/contacts`（作る・引く・名前・アドレスを付ける / 終わらせる・まとめる・結びを外す）
- 残り:
  - **スキル（novshi-tech/nvt-api-gateway-skills の `plugins/nvt-api-gateway/skills/murmur/`）を `docs/stand/skill-murmur.md` に合わせて直す**（API の表と「初めてつないだとき」「名寄せ」。このセッションの範囲外のリポジトリ）
  - デプロイ済みの Murmur は `pnpm db:migrate <名前>` のあと seed を入れ直す（投影とマスタの形が変わった）。実データのデプロイは空で始め、データソースだけを入れる
  - 共有のリストに読者を足す管理者の入口（スクリプト）。いまは `MurmurService.addListMember` だけ
  - ゲートウェイの JWT に `name` を足すか（足しても Contact を作るときの名前の初期値だけ）

**2026-10-31: UBS の Murmur を新しい Cloudflare アカウントに立てた（`docs/adr/0029`）。** デプロイの設定はリポジトリの外（`deployments/`。設定の private リポジトリを clone）に出し、CI のデプロイはやめた。
- UBS: ゲートウェイ https://gateway.urban-b.com（Entra）と Murmur（Service Binding でつなぐ）を同じアカウントに置いた。ゲートウェイ → Service Binding → JWT の検証までは通った（`/me` がマスタなしの 404）
- マスタは 0030（上）の流れで作る（空で始め、データソースを入れ、サインインした人がリストに入るときにアイデンティティを選ぶ）。シナリオの seed は架空のユーザなので使わない。それまで UBS の Murmur の D1 は空。0030 の実装を入れたら `pnpm db:migrate ubs` してからデプロイする
- novshi-tech のアカウントの `murmur-dev` は削除した（Worker・D1・Queue `murmur-dev-sync`）。nvt のゲートウェイ（https://gateway.novshi-tech.com、Google）用の Murmur は、あとで新しく立てる

**2026-10-30: 組織の使い分けを「切り替える」から「並べてつなぐ」に変えた（api-gateway-mcp の `docs/adr/0004`、採用。0018 に追記）。** 1 つのデプロイ = 1 つの組織のまま、組織ごとのゲートウェイを別々のコネクタとして Claude に並べる。実装（3 つのリポジトリのブランチ `claude/eager-ride-i7ul38`、main には未反映）:
- ゲートウェイ: 設定 `ORGANIZATION_NAME`（空なら `PUBLIC_URL` のホスト名）を、MCP の title・instructions、ツールの説明、`list_credentials` / `issue_token` の `gateway`、Web 画面の見出しに出す。登録画面のラベル欄は「同じ組織の中の使い分け」の文言に
- スキル: `api-gateway` に「コネクタの選び方」（api-gateway 0.14.0）。murmur・bm-next はそれを参照（nvt-api-gateway 0.7.0）。`docs/stand/skill-murmur.md` と `connect.md` も合わせた
- マルチアカウントはやめた（0004 の決定 5 を改めた）。1 人がつなげるのは 1 つのサービスにつき 1 つ。以前の 2 つ目以降の接続は残り、画面で削除を促す
- 残り: 各デプロイの設定に `ORGANIZATION_NAME` を書いて出し直す。コネクタの名前を組織が分かるものに付け直す。0004 の未決（顧客のゲートウェイの置き場所、独自ドメインで揃えるか）

**2026-10-29（後半）: ゲートウェイに client credentials・Background の入口・許可したアプリの取り消しを実装した（api-gateway-mcp のブランチ `claude/busy-feynman-5zz6sk`）。** `docs/background-access.md` の 1〜3。本体のコードは変えていない。要点:
- 認証方式 `client_credentials`: 管理画面（「OAuth 2.0(client credentials)」）か設定ファイルで登録。トークンはゲートウェイのメモリで使い回し、保管しない。利用者の画面・`list_credentials`・REST（`/api/`）には出ない
- 名前付きのエントリポイント `Background`: 本体は `{ "binding": "GATEWAY", "service": "<ゲートウェイの Worker 名>", "entrypoint": "Background" }` を張り、`env.GATEWAY.fetch("https://gateway/<サービス名>/<Graph のパス>")` で呼ぶ（`/api` は付けない、Authorization も要らない）。`client_credentials` の接続先にだけ届く
- 許可したアプリ: ゲートウェイのトップに許可ごとに出て、本人が取り消せる。名前はクライアントの `client_name`（本体は CIMD のメタデータに書いておく）
- 共有の箱の RBAC for Applications は必須。権限は Exchange の役割 `Application Mail.Read` をスコープ付きで渡し、Entra では何も付けない（Entra で `Mail.Read` のアプリ権限に同意すると全員の箱が読めて、スコープが効かない）。やめたのは、個人の箱もアプリの権限で読んで人ごとにスコープを足す案（0024 の議論の経過 4）
- 共有のアドレスが Microsoft 365 グループ（`GroupMailbox`）だとわかった。グループの会話はアプリの権限では変更通知が作れず、delta もない（公式ドキュメント）。`docs/adr/0025`（採用、直樹）: 共有メールボックスをグループのメンバー・購読者にして、0024 のとおり読む。実装は後回し
- 次の検証: 変更通知（サブスクリプション）は本人の箱で確かめる（0024 の決定 3、委任の `graph` の接続）。client credentials の実機の検証は、共有メールボックスを取り込むときに回す
- 残り: 未決 1（client secret をなくす）、確かめること（名前付きエントリポイントがインターネットに出ないこと・RBAC for Applications のスコープの外が 403 になること。実デプロイで）

**2026-10-28〜29: 外部コネクタ（Outlook）の設計を議論した（クラウドセッション、ブランチ `claude/adoring-feynman-yozaf4`。#4・#5 で main に入れた）。ADR だけでコードは変えていない。** 要点（詳細は 0024 と Artifact「Murmur 外部コネクタ設計」v4）:
- **`docs/adr/0024`（採用、2026-10-29、直樹）**: Webhook の管理は本体が持つ（0012 を「中身は書き換えない。取り込みのための購読の管理だけはする」に緩めた。0012 の状態と CLAUDE.md に反映した）。通知はヒントで、正は delta。同期は Cloudflare Queues で直列
- 個人の箱は本人の権限: 本体がゲートウェイの OAuth クライアントになり（Claude と同じ）、本人が同意する。データソースは同意のあと実行時に作る（読者は本人 1 人）
- 共有の箱はアプリの権限: テナントの管理者がゲートウェイの管理画面で client credentials の接続先を登録し、Entra の RBAC for Applications で箱を絞る。本体はゲートウェイの名前付きエントリポイント（Service Binding だけから呼べる）で使う
- 読み取りしかしないことは本体のコードで保証する（取り込みに、書き込むかどうかを AI が判断する箇所がない）。本体のためだけに読み取りだけの接続は用意せず、本人の `graph` の接続をそのまま使う（api-gateway-mcp#15 のレビュー）
- ゲートウェイに頼むこと: client credentials の認証方式（管理画面から登録）、Service Binding だけから呼べる専用の入口、許可したクライアントを取り消す画面（あるとよい）、redesign.md の「認証情報の持ち主はユーザーだけ」の例外。ゲートウェイから本体への呼び出しは増やさない。提案は api-gateway-mcp の `docs/background-access.md`（novshi-tech/api-gateway-mcp#15。ゲートウェイの大規模改善の作業と一緒に、そちらでレビューして main に入れる）
- 議論で外した案: 手元のランナー（0015。先送り）、Webhook をゲートウェイに置く（ゲートウェイの性格が崩れて密結合）、全部アプリの権限（人が増えるたびに管理者の作業）、独自の許可の機構（OAuth の作り直し）
- **`docs/adr/0023`（構想）**: ゲートウェイと Murmur を 1 つのリポジトリにまとめる（Worker は分けたまま）。今はやらない
- nvt-api-gateway-skills の `murmur` スキルの API の表は、0021 の分も直っていた（57bd64c、プラグイン 0.5.0。今の main は 0.6.0 で、SKILL.md は `docs/stand/skill-murmur.md` と同じ）

**2026-10-23（後半）: 0021 の決定 1〜3 を実装した（クラウドセッション、ブランチ `claude/adoring-noether-yjejoy`。main には未反映）。ストレージは D1 に決めた（直樹）。** 詳細は 0021 の「実装の記録」。要点:
- マルチテナントを外した（24e666c）: マスタ・イベントの封筒・投影・API からテナントを外し、1 デプロイ = 1 チーム。User の Party は 1 つまで、Party のない User は何も見えない。
  API が変わった: `/me` は `party`（なければ `null`）、`list_threads`・`list_lists`・`add_note` の `tenant` を外した、Webhook は `POST /webhooks/dummy`、`timeline.html` の `tenant` を外した。
  ~~nvt-api-gateway-skills の `murmur` スキルの API の表を直す必要がある~~ → 直っていた（57bd64c、プラグイン 0.5.0。2026-10-29 に確認）
- 投影を差分で書くようにした（74c55d6）: `foldChanges` が変わったスレッド・シグナル・索引を返し、ストアはそれだけ upsert する（0004 のトレードオフの解消）
- D1 に移した（03f9ef2）: スキーマは SQLite、マイグレーションは `drizzle/` を作り直した（Postgres の 0000〜0003 は消した）。Postgres の実装・Neon・pglite の依存を消した。テストは Miniflare の D1
- テスト: `pnpm test` で 199 件が全部緑。`pnpm scenario verify all`（`--db d1`・`--ai replay` も）は 4 本とも一致（AI の記録はそのまま当たる）。`wrangler dev --env dev --local` で Webhook の取り込み・重複排除・管理画面も確かめた
- 途中で見つけた既存の穴: Postgres の追記が payload の検証より先に挿入していた（直してから D1 に移した。D1 版も検証してから書く）

**2026-10-23: Murmur の立ち位置とセルフホストの方向を決めた（クラウドセッション、ブランチ `claude/adoring-noether-yjejoy`。api-gateway-mcp を汎用の製品として広げる議論から）。ADR だけでコードは変えていない。** 要点:
- **`docs/adr/0020`（採用）**: Murmur は 1 チーム（会社・部署・プロジェクトなど、緊密なタスクの共有とディスパッチが要るグループ）に 1 つセルフホストする。ゲートウェイとは 1 対 1。novshi はコードとスキルを配るだけで、資格情報も連絡の中身も預からない。
  チームの境界を越えることを最初から想定し、越えるときはチームの中とは違う要約レベルのスレッドを共有する。0018 の「組織」は「チーム」と読む。Murmur の設計の多くが「メールで足りないもの」から来ていることも書いた
- **`docs/adr/0021`（採用、方向）**: マルチテナントの概念を本体から外す（境界はデプロイ）。投影を丸ごと入れ替えるのをやめて差分だけ書く（0004 の解消を前倒し）。ストレージは Neon から D1 か Durable Object の SQLite に移し、Postgres の実装は保守しない（抽象は `Repo`）。
  ゲートウェイの `deploy` スキルで一緒にデプロイし、配線（Service Binding・JWKS・シークレット）を自動にする。D1 の上限と、D1 にしたときに直すところ（`batch()` しかない、バインド変数 100 個、`projection_meta.idx` の 2 MB）を書いた。D1 か Durable Object かと着手の時期は未決
- **`docs/adr/0022`（構想）**: チームごとの Murmur が要約したスレッドを送り合う将来像。送るのはスタンド（0012 のまま）、状態は読み取りで返す。個人の Murmur は「1 人のチーム」としてつなぐオプション。読む側の境界（チームをまたぐ俯瞰は個人の経路だけ）、act-as・ゲートウェイの接続先・管理者の制御を設計に入るときの論点として残した。個人の Murmur は組織の管理者から見て情報の脱出口になるので実現は後回し、当面はチームごとのスタンドで各 Murmur を巡回する
- **`docs/adr/0016` を汎用の書き方に直した**: 特定の会社の事情（どの会社のアカウントで回すか、どの会社を入れるか）を外した。最初のデータソースはメール（Outlook）のまま。ADR には個別の事情を書かない（CLAUDE.md に足した）
- 0013・0018 の状態に、読み替え（テナント → デプロイ、組織 → チーム）の注記を足した。CLAUDE.md に 0020〜0022 を足した

**2026-10-22: 1 ユーザマルチテナント対応はやらないと決めた（`docs/adr/0018`、直樹の結論。クラウドセッション、ブランチ `claude/quirky-franklin-o0kaaq`）。** 要点:
- 1 人のユーザが複数の組織（IdP の違うテナント）にまたがる対応は、Murmur とゲートウェイではやらない。どうやっても適切なセキュリティ境界を引けないため
- ゲートウェイが複数ユーザに同時ログインして切り替えられるのはよいかもしれないが、MCP に同時につながるのは 1 テナントだけ
- 複数の組織を使い分けるなら、スタンド（Claude Code）の側で `settings.json` の claude.ai の公式コネクタを切り、ローカルで別の MCP をつなぐなどして切り替える
- 0017 は「結論が出た」にして論点の記録として残した。0016 の「ログインのアカウント」「複数の組織のメンバー」の節と `docs/stand/connect.md` に反映した。コードは変えていない
- **LINE 公式アカウントのチャネルは Murmur の手前の別システムが持つ**（`docs/adr/0019`、直樹）。利用者に従業員・応募者・顧客・入居者がいて、属性でリッチメニューを出し分けたいので、userId と人の紐づけは別システムの仕事。Murmur はその利用者の 1 つ。
  そのため **0016 の最初のデータソースは UBS の Outlook**。チーム全体をシミュレートするために、LINE と Jira はそのあと早めに入れる
- **LINE 公式アカウントの調べ**（`docs/research/2026-10-22-line-messaging-api.md`）: 管理画面のチャットと Webhook は 2022-11-30 から併用できる（公式）。Messaging API をつないでもチャットは無効にならないので、作るのは受信の受け口（webhook を受けて貯め、Murmur に流す）だけでよい。
  ただし過去の会話は取れず、管理画面から返した分と push した分は webhook に来ない見込み（0012 の未決 2。実物で未確認）。木村さんの返事は Murmur から見えないので、LINE のボールは記録か片付けでしか動かない。`fixtures/absence` の o02 はこの点で実物とずれる（今は直さない）
- **0016 の最初のデータソースは UBS 側にする**（直樹）。UBS は独自に Claude の Team プランを契約しているので、スタンド・ゲートウェイ・Murmur が UBS の中で自然に分離できる。UBS の Murmur には UBS のテナントだけを入れる（ノブシテックの Party は持たせない）。LINE 公式アカウントと Outlook のどちらから始めるかは段階 5 の前に決める

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

v1 の H1〜H6 は緑だった（`proto-v1`）。v2 は仮説を立て直した（`docs/PLAN.md`）。2026-10-21 に計画 v2 を完了した時点の結果:

| 仮説 | 状態 | どのステップで |
| --- | --- | --- |
| H1 リプレイの決定性（fold は 1 段、リンク込み） | ステップ 3 の段（リンク・持ち主・属性・メモ込み）は緑。メモリと Postgres、1 段の検査（リンクの相手は作成だけ残す）も | 2〜4 |
| H2 状態は属性と導出で足りる（0014 で書き直し） | 緑（2026-10-21）。メモのスレッドのボールはリンク先から導出、閉じた件は自動で開かない | 3 |
| H3 境界 | 緑。外のソースに加えて、個人のメモは本人だけ、リンクの辺は見えるが先の中身は見えない、候補は見えるものだけ | 2・3 |
| H4 送信の記録と持ち主の操作 | 緑（2026-10-21）。記録 → 送ったスレッド・sent のリンク・ボールが相手へ → 返事は送ったスレッドに戻る → 期限超過 → 遅れた返事で解消、と持ち主の操作 | 3・4 |
| H5 観測と送信の記録の重複排除（両順） | 緑（2026-10-21）。メール・LINE で両順。Jira の起票とコメント（記録 → 観測）もステップ 7 で緑 | 4・7 |
| H6 Ingest（区切り + 返事や対応を求めているか） | 緑（2026-10-21、ステップ 5 のあとの取り直しで 33/33、ステップ 7 で development に 1 件足して 34/34。claude-sonnet-5-5） | 2 |
| H7 スタンドで完走 | 緑（2026-10-21、直樹の判断）。absence を Cowork で 12 段まで回した。Murmur の側は期待と全部一致し、人が「指示と承認」を超えたのは宛先を教えた 1 か所。complaint は回さない（直樹「検証は十分、感触は概ね良い」）。記録は `docs/stand/h7-absence.md` | 6 |
| H8 構造と持ち主だけで「自分の番」が決まり、結び候補が正しく出る（0014 で書き直し） | 緑（2026-10-21）。Jira の担当者で決まる分もステップ 7 で緑（`turn.by: assignee`） | 3・7 |
| H9 状態の写しを持つデータソース（Jira。起票でリンクが付く） | 緑（2026-10-21）。development で、写し（担当者で誰の番・完了でボールなし）、起票の記録で課題のスレッドと Slack のスレッドが経路 sent で結ばれる、コメントの両方向（直接は観測された送信、スタンド経由は記録して観測と統合）、写しは Murmur で書けない | 7 |
| H10 Murmur あり vs なし（新、0012） | 省いた（2026-10-21、直樹）。LINE を読める MCP がなく「Murmur なし」の条件をそろえられない。H7 で、ありの強み（v1 の取り違えが起きない、新しい会話から続きに入れる）は見えた | 6 |

## 残作業（計画 v2 の実装ステップ）

1. **計画の書き直し**（済み。2026-10-20 に 0014 反映まで直樹のレビューを通った）: `docs/PLAN.md` v2、`CLAUDE.md`、ADR 0008〜0014
2. **データソースのスレッド**（済み。2026-10-21 に H6 まで緑）: DataSource、スレッド、Ingest v2（`SignalObserved` + direction）、片付け、シグナルの移し替え、記録の取り直し（H1・H3・H6）
3. **個人のメモとリンク**（済み。2026-10-21 に H1・H2・H8 が緑） 4. **送信の記録**（済み。2026-10-21 に H4・H5 が緑） 5. **API・スキル・管理 UI**（済み。ゲートウェイ経由の書き込みも H7 で確かめた） 6. **H7・H10**（済み、2026-10-21。H7 は緑、H10 は省いた） 7. **状態の写しを持つデータソース**（済み、2026-10-21。H9 が緑） 8. **振り返り**（済み、2026-10-21。`docs/retrospective-v2.md`。直樹のレビュー済み）
- 並行トラック: ステップ 2 のあと、0007 の実データでの試用（読み取り専用の Gmail を読者 1 人のデータソースとして）。前提は 0007 の 6（記録の置き場所）を決めること

実環境の控え（v1 で設定済み、v2 でも使う。**D1 に移したので、ブランチを main に入れたあとは Neon と `DATABASE_URL` を使わない**）:
- Neon プロジェクト `murmur`（quiet-dust-32237629、aws-ap-southeast-1、組織 株式会社ノブシテック）の `dev` ブランチ。v2 ではスキーマが変わるので、マイグレーションを作り直して当て直す
- murmur-dev（https://murmur-dev.nose-0d2.workers.dev）。secrets は `DATABASE_URL`・`ANTHROPIC_API_KEY`・`WEBHOOK_SECRET`・`TIMELINE_TOKEN`、vars は `GATEWAY_JWKS`・`IDENTITY_ISSUER`
- ゲートウェイの本番に `MURMUR`（→ murmur-dev）の Service Binding と `SERVICES.murmur`。Cowork に `api-gateway` と `nvt-api-gateway` を入れてある（Cowork は 0.3.0。最新は 0.4.0）
- main への push で CI が murmur-dev にデプロイする。`v*` のタグは prod にデプロイするので打たない（v1 のタグは `proto-v1`）
- 鍵・トークン・接続文字列は直樹のマシンの `~/.config/murmur/dev.env`（600、`set -a; . ~/.config/murmur/dev.env; set +a`）。Neon の API キーは `~/.config/neonctl/api_key`
- seed の投入は `pnpm seed <scenario> --user <seed の User ID>=<ゲートウェイの User ID>`、受信の送信は `pnpm send <scenario> <signal の id>...`。
  直樹のゲートウェイの User ID は `entra_6f043b7f-9709-4e71-bfa1-bd38a935316b_a86eed80-97f7-41a9-b7cc-2c6849408afb`
- dev の DB は 2026-10-20 に v2 のスキーマにして absence の seed を入れた。2026-10-21 に seed を入れ直して H7 の 1 回目を回した（イベントはそのまま）
- `dev.env` の `DATABASE_URL` は Neon の `dev` ブランチ（エンドポイント `ep-long-bar-a1xbd4pc`、プール用）。`main` ブランチにはテーブルがない

## 次のセッションでやること

0. 2026-10-29 の boid の分割と縮退の議論（novshi-tech/boid の `docs/plans/split-and-shrink.md`）から起こした ADR（0026 自分専用の Murmur は作らない・0027 オーケストレータのスタンド・0028 開発のシグナル（構想））を直樹がレビューする。0026 を採用したら 0020 の 4 と 0022 の「個人の Murmur」の節を直す。ゲートウェイの側は api-gateway-mcp の `docs/adr/0001`〜`0003`（案）

0. **外部コネクタ（0024、採用）は、ゲートウェイの改修から始める。** api-gateway-mcp#15 がそちらで main に入ったら、ゲートウェイに client credentials・専用の入口を実装する（api-gateway-mcp の作業）。並べて、設計の段取り S0（実物で確かめる: 委任の再認可の間隔、delta の `uniqueBody` と In-Reply-To、下書き → 送信の `internetMessageId`、名前付きエントリポイントが公開されないこと）

0. 2026-10-23 の ADR（0020・0021・0022、0016 の書き直し）を直樹がレビューする
0. **0021 の実装（ブランチ `claude/adoring-noether-yjejoy`）を main に入れる前に**、直樹が手でやること（main への push で CI が murmur-dev にデプロイするので、先に済ませないとデプロイが落ちる）:
   1. ~~D1 を作って `database_id` を書く~~ → dev は済み（2026-10-23、直樹が作成。`c74085ea-ccd1-4779-871a-b585afd7624d` を `wrangler.jsonc` に書いた）。prod（`murmur`）は仮の値のまま（タグを打たないので当面は要らない）
   2. `pnpm db:migrate dev`（`wrangler d1 migrations apply DB --remote --env dev`）
   3. `pnpm seed absence --env dev --user u_kimura=<直樹のゲートウェイの User ID>`（dev の Neon のイベントは移さない。seed から入れ直す）
   4. `wrangler secret delete DATABASE_URL --env dev`（任意）。そのあと main に入れる
   5. ~~nvt-api-gateway-skills の `murmur` スキルの API の表を直す~~（済み、57bd64c）。Cowork のプラグインも入れ直す
0. 0021 の残り: 決定の 4（ゲートウェイの `deploy` スキルで Murmur も一緒にデプロイし、Service Binding・JWKS・シークレットの配線を自動にする）。api-gateway-mcp の側の作業。`projection_meta.idx` が何件で 2 MB に届くかの計測
1. ~~複数の組織にまたがる認証と接続の設計（`docs/adr/0017`）~~ → 2026-10-22 に結論（`docs/adr/0018`）: やらない。組織の切り替えはスタンドで行う。設計はしない
2. **次の段階（`docs/adr/0016`）**: 自社向けに実コネクタを作り、実データで Ingest が使えるかを確かめる。振り返りの持ち越しの順に
   1 相手を引く API → 2 件名を属性として畳む → 3 スキルの片付けの説明 → 4 写しが課題のスレッドより先に届いたとき → 5 実データの試用（本題）→ 6 LINE が自分の push を webhook で返すか（LINE をつなぐ前に）。
   着手するものは ADR に案を書いてから。最初のデータソースは UBS の Outlook に決まった（2026-10-22。LINE と Jira はそのあと早めに）。5 に入る前に、ゴールの数字・どのメールボックスとフォルダか・取り込みの経路（0015 の pull スクリプトの案か act-as か）・本文と記録の扱いを決める
3. 片付け（急がない）
   - Cowork のプラグインは 0.3.0 のまま。nvt-api-gateway-skills の main は 0.6.0（7286cbc）なので、使う前に入れ直す
   - dev の DB は absence の seed と H7 の 1 回目のイベントが入ったまま（木村 = 直樹のゲートウェイの User）。ステップ 7 のコードがデプロイ済みで、投影のスレッドに `closedAtSource` がない（読むと false 扱い）。使うときに seed を入れ直せば揃う
   - 2026-10-21 の後半は直樹の手元（`~/src/github.com/novshi-tech/murmur`）のセッションで作業した。main に直接 push している（ブランチ `ccr-fab8e92c-c9jtn1` にも同じものを push）

### これまでの記録（済み）

0. （済み、2026-10-21）**H7 を 1 回回した**（`docs/stand/h7-absence.md`）。absence を 12 段まで（Cowork、木村として）。Murmur の側は期待と全部一致。人が口を出したのは、日付の読み替え・LINE の送ったことにする・伊藤さんの宛先を教えた・ビルメンNEXT を止めた・片付けの説明の訂正。complaint は回さない。H10 は省いた（直樹）。
   ステップ 7（H9）を実装して main に入れ、スキルを 0.4.0 にした（下の「ステップ 7 で決めた細部」）。ステップ 8 の振り返りは直樹のレビュー済み（提案どおり、持ち越し 7 はやらない）
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
5. （済み、2026-10-22）0012 の未決 2 を WebSearch で調べた（`docs/research/2026-10-22-line-messaging-api.md`）。返さない見込み。実物での確認は 0016 の段取り 6
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

- ~~**0021 の未決**: D1 か Durable Object の SQLite か~~ → D1（2026-10-23、直樹）。実装した
- **0020 の定義の単語**: 0012 の定義文の「テナントで 1 つの共有の実体」を「デプロイで 1 つの共有の実体」に読み替える。0021 を実装したので、単語を直樹が練る
- **0016 の最初のデータソース（UBS の Outlook に決まった。2026-10-22）**: どのメールボックスとフォルダから始めるか。段階 5 の前に決める
- **LINE の受け口（0019）**: 受け口は送信もサポートし、人の返事も受け口から送る方向（直樹）。送った分は観測された送信として Murmur に流す。設計に入るとき、返信の画面をどこまで作るか、push と reply の使い分け、LINE の userId と人（従業員・応募者・顧客・入居者）の紐づけ方を決める。
  その前に、UBS のアカウントの応答設定でチャットと Webhook を両方オンにできるか、既に Webhook URL を使うツールがないかを画面で確かめる

- **ステップ 7 で決めた細部**（計画と食い違いはないと判断したが、見てほしい）:
  1. 写しは `ThreadMirrored {threadId, dataSourceId, threadKey, fields, sourceRef}`。`fields` は変わった属性だけ（同じ値なら出さない。冪等）。名前はデータソースの `AttributeDef` で、Murmur が読むのは `done`（boolean）と `assignee`（party）だけ。ほかは見せるだけ（業務の知識を持たない）
  2. 完了（`done: true`）はボールを「なし」にする（片付けと同じ扱い。`closedAtSource`）。片付けではないので `dismissed` は立たない。`filter=open` と期限の見回りから外れる。`done` が外れたら綴じた分からボールが決まる
  3. 誰の番: 持ち主（ThreadClaimed）＞ 担当者の写し ＞ シグナルのボール。担当者が読者のユーザーならその人の番（`by: assignee`）、読者でなければその相手（party）。Jira の状態が正（0010 の黒子）なので、担当者のコメントで相手にボールが移っても、担当者を変えないかぎり担当者の番
  4. 写しはシグナルで作られたスレッドにだけ入る（課題の作成の通知か、起票の記録）。課題キーのスレッドがまだなければ写さない（`no_thread`。ダミーは作成の通知を先に流す）。課題キーは `threadKey` のほか、起票の記録の `sent_ref` でも引く（スタンドが `thread_key` を付け忘れても同じスレッドに入る）
  5. 外のサービスのスレッドの属性はソースの写しなので `set_attribute` は断る（`invalid`。0014 の「写すか、書くか」）。書けるのは個人のメモのスレッドだけ
  6. Jira の Murmur のユーザーのアカウント（能勢・加藤）をデータソースの送信元（`selfAddressIds`）に入れた。直接書いたコメントは観測された送信になり、スタンド経由のコメントの記録と統合される（H5）。`record_sent` の送信元は、送った人のアドレスがデータソースの送信元にあればそれ（なければ代表のアドレス）
  7. 担当者のアカウントが知らないもの（Directory にない）なら、写しは空（null）にする（誰の番にもならない）
  8. コネクタの `pull` は `items`（シグナルか写し）を返す。Webhook（`/webhooks/dummy/:tenant`）とダミーのキューも両方を受ける（`kind: "mirror"` で区別）。シナリオに `mirror` の行を足した（ID を使わないので AI の記録のキーは変わらない。記録の取り直しは要らなかった）

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
