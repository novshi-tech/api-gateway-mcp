# AIネイティブ タスク管理ツール プロトタイプ計画

Oct 15, 2026 · @Naoki NOSE

## 目的と前提

このプロトタイプは、設計メモ「AIネイティブ タスク管理ツール」のデータモデルとアーキテクチャが成立するかを、外部接続なしで確かめるためのもの。製品の MVP ではない。

- 検証対象: イベントソーシングによるタスク導出、通信状態と作業状態の二層、リスト境界と派生シグナル、観測された送信、スタンドへの MCP ハンドオフ
- 外部接続（メール・Slack・LINE・Jira・Bitbucket）は全部ダミー。Claude API と MCP は本物
- UI は作らない。操作は MCP 経由の Claude と CLI、確認用に読み取り専用のタイムライン HTML を 1 枚だけ
- 技術要素は本番相当: Cloudflare Workers + Neon（Postgres）+ 既存の API ゲートウェイとの連携
- 設計の正本は [Google Doc](https://docs.google.com/document/d/1gNSrK_p5xrEGiJB4RRr2FfFf9r-naPamh_5P9tNqM6w/edit)。この計画と食い違ったら Google Doc が優先。プロトタイプで得た知見はステップ 7 で Google Doc に書き戻す

## 検証仮説と合否基準

7 つの仮説をそれぞれ自動テストにする。全部緑ならデータモデルは「成立」、赤が残ったら設計メモに戻る。

| # | 仮説 | 合否基準（テストの形） |
| --- | --- | --- |
| H1 | 畳み込みは決定的 | 投影を全削除してイベントからリプレイし、Task 投影のハッシュが元と一致する（全シナリオ） |
| H2 | 状態は二層で足りる | 通信状態（ボールの所在・open/closed・未応答経過）が事前定義属性だけから導出され、4 シナリオの作業状態がカスタム属性だけで表現できる |
| H3 | 境界が守られる | テナント外の Viewer は別テナントのシグナルを 0 件しか取れない。同一テナント内の別リストのメンバーには派生の要約だけ見え、生ペイロードは見えない。ゴースト Party（User なし）は何も取れない |
| H4 | 派生のライフサイクルが回る | proposed → approved → sent → replied が双方向に流れ、各遷移でボールの所在リストが期待通りに動く。内部派生は approved で適用され sent を経ない |
| H5 | 観測と送信を重複排除できる | ツール経由で送信した後、同じメッセージがダミーコネクタから observed-sent として戻っても 1 本のイベントに統合され、タスク状態が二重に変わらない |
| H6 | Ingest が運用に耐える | フィクスチャの正解ラベルに対する attach / new / ignore の一致率を計測し、目標値（アンカー解決込みで 90%、AI 判断のみで 80%）を超える。無視は全件、理由付きの監査イベントが残る |
| H7 | スタンドに必要十分な情報が渡る | Cowork または Claude Code から MCP で接続し、欠勤連絡とクレームのシナリオをスタンド主導で完走できる。人の操作はユーザーが Claude に指示する承認のみ |

## アーキテクチャ

本体 Worker 1 本、Neon の Postgres、既存の API ゲートウェイ Worker の 3 つで構成する。本体は上流サービスのトークンを一切持たず、外部との出入りは全部ゲートウェイ経由（boid のサンドボックスと同じ原則）。

&#91;embedded content: 構成要素と呼び出し関係 · Worker 1 本 + Neon + 既存ゲートウェイ\]

スタンドの入口はゲートウェイの MCP 1 つ。ゲートウェイがユーザー識別を本体に伝搬し、本体は Neon と Claude API を直接使う。上流サービスへの出入りだけはゲートウェイを経由し、本体はトークンを保持しない。

- **本体 Worker**: fetch（HTTP API・Webhook）、scheduled（Cron: 取り込みのポーリングと期限の見回り）の 2 ハンドラ。Ingest 判断・要約生成・送信はリクエスト内で同期に処理する（Queues は使わない）
- **期限の見回り**: 返事期待の期限超過は scheduled（Cron）が Task 投影を見回って ReplyOverdue を出す。Workflows は使わない（2026-10-16 決定）
- **Neon**（AWS Singapore）: イベントストアと投影。Neon の serverless ドライバで Worker から直接つなぐ。Hyperdrive と Smart Placement は使わない（パフォーマンスは今回は度外視）
- **添付**: 添付のバイナリは扱わない。イベントにはフィクスチャのファイル参照（パスとハッシュ）だけを持つ。R2 は使わない（2026-10-16 決定）
- **API ゲートウェイ**（既存、Service Binding で接続）: ユーザー識別（OIDC → OAuth2 トークン発行）、資格情報の保管、上流 API への代理呼び出し。本体はゲートウェイの上流サービスの一つとして登録され、署名付きで伝搬されたユーザー識別（sub）を受け取る。本体側に API キーはない。呼び出し元の認証は Service Binding そのもので、本体の API には公開ルートを持たせない（公開するのは Webhook と timeline.html だけ）
- **Claude API**（Sonnet）: Ingest 判断と、境界越えの要約・翻訳。本体から直接呼ぶ。入出力の記録・再生モードを持つ
- **スタンド**（Cowork / Claude Code）: ゲートウェイの MCP に接続し、そこから本体の API を呼ぶ。本体は MCP サーバを持たない（認可の接続の形 (B)）
- **ダミー上流**: フィクスチャを流し込む HTTP エンドポイントと CLI。送信は送信ログに書くだけで、設定により observed-sent として折り返す

ゲートウェイ側に必要になる拡張（プロト期間に実装するのは「ユーザー識別の伝搬」だけ、他は設計のみ）:

1. アカウントリンク: Entra ID と Google の subject を同一 User に束ねる機能。同じ人が Entra ID（UBS）と Google（ノブシテック）の両方でログインすると、今は別々のユーザーに見えてしまう。本体に伝搬する sub は IdP の subject ではなく、この束ねた User の ID にする。プロトタイプでは不要（seed で User を作る）、本番で一人が両テナントを跨ぐときに必要
2. 資格情報の principal に ServiceClient（本体のテナント別 Ingest）を追加し、client\_credentials と静的トークンの grant を足す
3. ユーザー不在時に本体がそのユーザーとして呼ぶ act-as 経路（ユーザーの同意を記録する）。(A) に移るなら本体向けのトークン検証手段（JWKS か introspection）も

## ドメインモデルとイベント

正は append-only のイベント列。Task は投影で、いつでもイベントから作り直せる。判断（Ingest の attach / new / ignore）もイベントなので、監査ログは構造上タダで付いてくる。

**エンティティ（マスタ。イベントではない）**

| エンティティ | 所有 | 要点 |
| --- | --- | --- |
| Tenant | — | 秘匿境界の単位 |
| User | グローバル | ゲートウェイの User と 1:1。各テナントに自分の Party を 1 つ持つ |
| Party | Tenant | 人物／組織。名寄せの到達点。User は部分集合、ゴースト = User を持たない Party。外部マスタ（bm-next・board・freee）へのポインタの束で、人物マスタの正は名乗らない |
| Address | Tenant | チャネル種別 + 値。Party に期間付きで紐づく。共有アドレスは Organization の Party に紐づく |
| List | Tenant | 可視性の単位。同じリストなら同じものが見える |
| ListMember | List | Party の所属 |
| AttributeDef | List | カスタム属性の定義。名前・型・AI が読める意味の記述（必須） |
| CredentialRef | Tenant | ゲートウェイ側の資格情報への参照 + 主体（User か Organization）。Address の取得・送信に使う |

**イベント（tenant ごとに単調な seq、payload は JSONB、zod でスキーマ定義）**

| 種別 | 誰が出す | 要点 |
| --- | --- | --- |
| SignalReceived | Connector | 外部からの受信。channel、from / to（Address）、anchors（In-Reply-To・Jira キー・thread\_ts・PR 番号）、body、attachments（ファイル参照のみ）、source\_ref（重複排除キー）、acquired\_as（取得主体） |
| SignalObservedSent | Connector | ツール外で行われた送信の観測。返事期待は推定値を持つ |
| IngestDecided | Ingest | attach(task\_id) / new(list\_id) / ignore。reason、decided\_by（anchor / ai / human）、confidence |
| TaskAttributeSet | スタンド・人 | カスタム属性の値の変更 |
| DerivationProposed | Ingest・スタンド | 派生シグナルの提案。source\_task、target\_list、本文・添付・宛先 Party・返事期待の束 |
| DerivationApproved | 人 | 承認。宛先の Address をここで解決して凍結。送信元 Address もここで選ぶ。内部派生はここで適用 |
| DerivationSent | Connector | 外部送信の完了。sent\_ref（Message-ID など） |
| DerivationReplied | Ingest | 返事の到着（受信シグナルとの紐づけ） |
| ReplyOverdue | Cron の見回り | 返事期待の期限超過 |
| TaskClosed / TaskReopened | 人・スタンド | open / closed の明示操作 |

**投影**

- Task: list\_id、title、通信状態（ball\_at: list または party、open / closed、last\_outbound\_at、reply\_expected\_by、unanswered\_since）、カスタム属性の JSONB
- TaskLink: 派生で結ばれた Task 間の双方向リンク
- Timeline: タスクごとのシグナル列。可視性フィルタはクエリ層
- IgnoreLog: 無視の監査

**ルール**

- 可視性は Viewer（User → そのテナントの Party → リスト所属）としてクエリ層が強制する。テナント外は 0 件、同一テナントの別リストには派生の要約だけ
- 取得主体ルール: シグナルは、取得に使った資格情報の主体が見えるリストにしか置けない。Organization 主体 → テナント内の許可リスト（チャネルごとに設定）、User 主体 → その User が所属するリストのみ
- 通信状態は事前定義属性だけから機械的に導出する。作業状態（ステータス・担当・期限など）は全部カスタム属性
- 畳み込み（fold）は IO を持たない純関数。`fold(events) → projections` の形で、リプレイテストはこの関数だけで回る

## Ingest パイプライン

判断は 2 段。構造アンカーで決まるものは AI に渡さず、AI は残りだけを見る。

1. 受信: Connector が SignalReceived を append する。source\_ref が既出なら弾く。そのまま同じリクエスト内で次へ進む
2. アンカー解決: anchors（In-Reply-To、thread\_ts、Jira キー、PR 番号）が既存タスクのシグナルに一致したら IngestDecided(attach, decided\_by=anchor)。AI は呼ばない
3. AI 判断: 候補タスク（取得主体ルールで置けるリストの、open で最近のもの）の要約とシグナル本文を Claude に渡し、attach / new / ignore と reason・confidence を構造化出力で受け取る
4. 記録: IngestDecided を append する。ignore も必ずイベントにする（監査）。無視は confidence が閾値を超えたら自動で行う（2026-10-16 決定）。閾値は設定値で、プロトでは confidence の分布を記録して初期値を決める。拾い漏れはデータソース側の通知で気づける前提とし、安全網は IgnoreLog と explain\_ignore で後から確認できること
5. 畳み込み: Task 投影を更新する

**記録・再生モード**

Claude 呼び出しの入出力を `fixtures/<scenario>/recordings/` に保存し、テストでは再生する。モデルを変えたら再記録して差分を見る。境界越えの要約・翻訳も同じ仕組みに乗せる。

**人による訂正**

MCP の correct\_ingest で判断を訂正できる。訂正は IngestDecided(decided\_by=human) として追記し、元の判断は消さない。訂正の蓄積は後で判断精度の評価データになる。

## 派生・境界・承認・送信・観測

派生シグナルはライフサイクル付きの一級イベント。状態はイベント列から畳み込みで導出し、期限だけ Cron が見回る。

&#91;embedded content: 派生シグナルの状態遷移 · 7 状態\]

人の承認が唯一のゲート。外部派生は sent を経て返事を待ち、内部派生は approved でそのまま適用されて返事を待つ。期限超過は終端ではなく、遅れて返事が来れば replied に進む。

- **提案**: Ingest（またはスタンド）が DerivationProposed を出す。中身は本文・添付・宛先 Party・返事期待の束。境界越えの要約は Claude が生成する
- **承認**: 人が確認項目（本文・添付・宛先・返事期待）を見て DerivationApproved。宛先 Party の Address をこの時点で解決して凍結する。送信元 Address（= 使う資格情報）もここで選ぶ
- **適用／送信**: 内部派生（同一テナント内のリスト間）は approved で target\_list にシグナルとして適用し、sent を経ない。外部派生は Connector が送信して DerivationSent
- **返事**: 受信シグナルが anchors か AI で派生に紐づけば DerivationReplied。期限超過は Cron の見回りが ReplyOverdue を出す
- **ボール**: 派生の送信（内部派生も含む）でボールは target\_list 側へ移り、返事で戻る。所在はリスト単位

承認の件数は確実に多くなる（boid でも通知と承認が多すぎる）。内部派生の返事期待は省略可にして承認を増やさない（2026-10-16 決定）。プロトタイプでは承認の件数と種類をシナリオごとに計測し、ステップ 7 で「AI のリスク判断による自動承認」の線引きを議論する材料にする。

**観測された送信**

ツール外で直接行われた送信は、Connector から SignalObservedSent として入る。ツールは行為者である前に観測者。

- DerivationSent の sent\_ref（Message-ID など）と一致すれば同一の送信として統合し、新しいイベントは出さない
- 一致しなければ新規の送信として扱い、返事期待は Claude が推定する。人が MCP から訂正できる

**期限の見回りの実装**

scheduled ハンドラが実行のたびに、Task 投影の reply\_expected\_by を過ぎた未応答タスクを探して ReplyOverdue を append する。冪等にする（同じ派生に対して 1 回だけ）。Workflows は使わない。派生の状態は全部イベント列にあるので、見回りが止まっても再開に問題はなく、止めて再開しても ReplyOverdue が二重に出ないことをテストする。

## スタンド接続（本体の API とゲートウェイ経由の MCP）

スタンドはユーザーと同一権限で重なって働く存在なので、Viewer はゲートウェイから伝搬された User からそのまま導出する。本体が公開する API は以下の 11 本で、プロトタイプの UI はこれと timeline.html だけ。

| ツール | 入力 | 返すもの・起こすこと |
| --- | --- | --- |
| list\_my\_tasks | filter（open / ball\_at\_me / overdue）、tenant（省略可） | User 横断の自分のタスク一覧。各テナントの Party を束ねて返す |
| get\_task | task\_id | タスク本体 + タイムライン（Viewer の可視性でフィルタ済み）+ そのリストの属性定義と意味記述 |
| set\_attribute | task\_id、name、value | TaskAttributeSet |
| propose\_derivation | task\_id、target\_list、body、attachments、to\_parties、reply\_expected | DerivationProposed |
| list\_proposals | list\_id（省略可） | 承認待ちの派生一覧。確認項目（本文・添付・宛先・返事期待）つき |
| approve\_derivation | derivation\_id、from\_address | DerivationApproved。ユーザーの明示の指示で Claude が呼ぶ |
| reject\_derivation | derivation\_id、reason | 却下 |
| close\_task / reopen\_task | task\_id | TaskClosed / TaskReopened |
| correct\_ingest | signal\_id、decision | IngestDecided(decided\_by=human) |
| explain\_ignore | since | 無視の監査ログ |
| get\_list | list\_id | リストのメンバー・属性定義・接続チャネル |

本体はこれらを HTTP API として公開し、ゲートウェイの上流サービスとして登録する。スタンドはゲートウェイの MCP から呼び、使い方はゲートウェイのスキルとして書く（freee や board と同じ形）。本体は McpAgent を持たない。

**認可の接続の形（レビューで選ぶ）**

- (A) 本体を 2 つ目の MCP サーバにする: MCP 認可仕様どおり、本体が Protected Resource Metadata（RFC 9728）でゲートウェイを認可サーバとして指し、クライアントは resource（RFC 8707）を付けて認可を求める。ゲートウェイは aud をその resource にしたトークンを発行し、本体は JWKS か introspection で検証する。ゲートウェイの改修: resource の受け付けと aud、許可するリソースの登録、本体向けの検証手段、リソース単位の同意の記憶
- (B) 本体をゲートウェイの上流サービスとして登録する: 本体は MCP サーバを持たず HTTP API だけ。ゲートウェイの既存 MCP から freee や board と同じ形で呼び、ツール定義はスキルで渡す。ゲートウェイの改修: 上流の認証方式に「ユーザー識別の伝搬」（sub を署名付きで Service Binding 越しに渡す）を 1 つ足すだけ。Cowork から見える MCP は 1 つ、同意も 1 回

プロトタイプは (B) で決定（2026-10-16）。長期の標準形は (A)。(B) で始めても本体のツール一覧と Viewer 導出は同じなので、後から (A) の MCP サーバを被せられる。

approve\_derivation は API に含める（2026-10-16 決定）。承認はユーザーの指示で Claude が呼び、timeline.html は読み取り専用のまま。

## コネクタ抽象とダミー実装

コネクタは「誰として取得・送信したか」を必ず持つ。これが取得主体ルールの入力になり、本番でゲートウェイの資格情報に対応する。

```typescript
type Principal =
  | { kind: 'user'; userId: string }
  | { kind: 'organization'; tenantId: string };

interface Connector {
  channel: 'email' | 'slack' | 'line' | 'jira' | 'bitbucket';
  // Cron から呼ばれる。principal の資格情報で since 以降を取る
  pull(principal: Principal, since: Cursor): Promise<InboundSignal[]>;
  // 承認済み派生の送信。sent_ref は重複排除キーになる
  send(principal: Principal, msg: OutboundMessage): Promise<{ sentRef: string }>;
}
// Webhook（LINE / Slack Events）は Worker の fetch で受け、同じ InboundSignal に正規化する
```

- InboundSignal は SignalReceived か SignalObservedSent のどちらかに変換される。どちらになるかは from が自分側の Address かどうかで決まる
- ダミー実装: pull はフィクスチャのキューから次のシグナルを返す。send は送信ログに記録するだけ。`echoObserved: true` なら、送ったメッセージを次の pull で observed-sent として返す（H5 用）
- 本番実装はゲートウェイ経由で上流 API を叩く。プロトタイプでは作らないが、インタフェースは変えずに差し替えられること
- Webhook の署名検証鍵だけは本体の Workers secret に置く。ゲートウェイは外向き専門のまま

## シナリオとフィクスチャ

4 シナリオを実行可能なフィクスチャにする。机上シミュレーション済みの 2 本をまず機械で通し、未実施の 2 本はスタンド主導で回して設計の穴を探す。

| シナリオ | テナント | 登場するもの | 検証する仮説 | 状態 |
| --- | --- | --- | --- | --- |
| 修繕見積 | UBS | 顧客（ゴースト Party）、協力会社、内部リストと顧客向けリストの 3 者。見積書 PDF の添付 | H1 H2 H3 H4 H5 | 机上済み |
| 開発 | ノブシテック | Jira / Bitbucket / Slack、別ワークスペースのユーザー。構造アンカー（Jira キー・PR 番号・thread\_ts）が主役 | H1 H3 H4 H6 | 机上済み |
| 欠勤連絡 | UBS | 清掃員（LINE 公式アカウント 1:1）、現場リスト。短命・多数、無視と代務の判断 | H2 H6 H7 | 未 |
| クレーム | UBS | 顧客 → 内部 → 協力会社の 3 リスト連鎖、緊急。返事期待と期限超過 | H3 H4 H7 | 未 |

**フィクスチャの形式**

```
fixtures/<scenario>/
  seed.json        # Tenant / User / Party / Address / List / AttributeDef の初期状態
  signals.jsonl    # 時刻順の受信・観測シグナル（ダミーコネクタの pull が返す）
  expected.json    # Ingest の正解ラベル、最終 Task 投影、各時点のボール所在
  recordings/      # Claude 呼び出しの入出力（再生モード用）
```

CLI: `pnpm scenario run <name>`（流し込んで最後まで回す）、`pnpm scenario verify <name>`（expected と比較、H1 のリプレイ比較も実行）。欠勤連絡とクレームは、最初はスタンドから手で回し、その記録を signals.jsonl と expected.json に固める。

## 技術スタックとリポ構成

ゲートウェイと同じ言語・同じ基盤に揃える。選定の理由が「ゲートウェイと同じ」で済むものは、それ以上の理由を求めない。

| 領域 | 選定 | 補足 |
| --- | --- | --- |
| 言語 | TypeScript（strict） | ゲートウェイと同じ |
| ランタイム | Cloudflare Workers | Smart Placement は使わない |
| HTTP | Hono | API・Webhook・timeline.html |
| MCP | なし。プロトは (B) でゲートウェイの MCP 経由 | (A) に移るときに McpAgent を足す |
| DB | Neon Postgres（aws-ap-southeast-1） | @neondatabase/serverless で直接接続。Hyperdrive なし |
| ORM・マイグレーション | Drizzle ORM（neon-serverless ドライバ）+ drizzle-kit | スキーマを TS で持つ |
| 非同期 | Cron Triggers | Queues・Workflows は使わない。Ingest は同期、期限は Cron の見回り |
| ストレージ | なし | 添付はファイル参照のみ。R2 は使わない |
| AI | `@anthropic-ai/sdk`、claude-sonnet-5-5、構造化出力 | 記録・再生の層を挟む |
| バリデーション | zod | イベント payload と MCP 入力のスキーマ |
| テスト | vitest + `@cloudflare/vitest-pool-workers` | Cron をローカル再現 |
| パッケージ | pnpm |  |

**リポ構成**（ゲートウェイとは Service Binding で接続。本体は新規の別リポ・別 Worker。(a) で確定（2026-10-16））

```
repo/
  wrangler.jsonc
  CLAUDE.md
  docs/PLAN.md            # この Doc の Markdown 書き出し
  docs/adr/               # 決定の記録
  src/
    index.ts              # fetch / scheduled の入口
    domain/               # エンティティ、イベント型（zod）、fold（純関数）
    store/                # イベントストア、投影、可視性クエリ（Drizzle）
    ingest/               # アンカー解決、AI 判断、記録・再生
    derivation/           # 派生のライフサイクル、期限の見回り
    connectors/           # Connector インタフェース + dummy/
    api/                  # HTTP API（ゲートウェイの上流として公開）
    auth/                 # ゲートウェイ発行トークンの検証、Viewer 導出
    http/                 # Hono ルート、timeline.html
  fixtures/<scenario>/
  scripts/                # scenario CLI、replay
  drizzle/                # マイグレーション
```

`domain/` は Workers API に依存しない純粋な TS に保つ。fold のテストは Node だけで回る。

## 実装ステップ

7 ステップ。1 ステップ = Claude Code の 1 セッション + 1 PR を目安にし、完了条件のテストが緑になったら次へ進む。

1. **土台**
   - 成果物: リポ、wrangler 設定、Neon + Hyperdrive、Drizzle スキーマとマイグレーション、イベントストア（append / replay）、ゲートウェイから伝搬されるユーザー識別（署名付き sub）の検証と Viewer 導出、ゲートウェイ側への上流サービス登録（認証方式「ユーザー識別の伝搬」の追加）、CI（vitest）
   - 完了条件: ゲートウェイの MCP 経由で `/me` が User と各テナントの Party を返す。イベントを append して replay で同じ列が戻る
2. **畳み込み**
   - 成果物: エンティティ、SignalReceived / IngestDecided、Task 投影、通信状態の導出、可視性クエリ、timeline.html。修繕見積フィクスチャをアンカーと明示ヒント（AI なし）で通す
   - 完了条件: H1・H2・H3 のテストが緑
3. **Ingest**
   - 成果物: Claude による attach / new / ignore 判断、記録・再生モード、IgnoreLog、correct\_ingest
   - 完了条件: 修繕見積・開発の正解ラベルに対する一致率が出て、目標値を超える（H6）。無視の監査が全件残る
4. **派生**
   - 成果物: 派生のライフサイクル（提案・承認・適用・送信（ダミー）・返事）、期限の見回り、Address 凍結、ボール移動、TaskLink。開発シナリオ
   - 完了条件: H4 のテストが緑。見回りを止めて再開しても ReplyOverdue が二重に出ない
5. **観測**
   - 成果物: echoObserved、sent\_ref による重複排除、観測された送信の返事期待推定
   - 完了条件: H5 のテストが緑
6. **MCP**
   - 成果物: API 11 本とゲートウェイ用スキル、Cowork と Claude Code からの接続手順、欠勤連絡・クレームのフィクスチャ
   - 完了条件: 欠勤連絡とクレームをスタンド主導で完走（H7）。その記録を expected.json に固めて自動テスト化
7. **振り返り**
   - 成果物: 設計メモの未決リストに対する判定、docs/adr/、Google Doc への書き戻し案
   - 完了条件: 直樹のレビュー。ここは Claude Code 単独で閉じない

各ステップの PR には対応する仮説番号（H1〜H7）をテスト名とコミットメッセージに付ける。

## 開発環境・テスト・デプロイ

月額は Workers Paid の $5 + Neon の無料枠 + Claude API の従量で収まる。

- **ローカル**: `wrangler dev`。DB は Neon の dev ブランチに直接つなぐ（ローカル Postgres も Hyperdrive の設定も不要）
- **テスト**: `@cloudflare/vitest-pool-workers` で Cron をローカル再現。Claude は再生モード。4 シナリオは `scripts/scenario` から end-to-end テストとして実行
- **環境**: wrangler の env で `dev` と `prod` の 2 つ。Neon はブランチで対応させる
- **Secrets**: ANTHROPIC\_API\_KEY、Neon の接続文字列、Webhook の署名検証鍵。ゲートウェイの Service Binding は wrangler.jsonc の設定だけ
- **デプロイ**: `wrangler deploy`。CI は main への push で dev に、タグで prod に
- **監視**: Workers Logs のみ。本格的な可観測性もパフォーマンスもスコープ外

## スコープ外

- 本物のコネクタ（メール・Slack・LINE・Jira・Bitbucket）とその OAuth 設定
- ゲートウェイ側の拡張の実装（アカウントリンク、ServiceClient principal、act-as 経路）。設計だけ docs/adr/ に残す。ユーザー識別の伝搬だけはステップ 1 で実装する
- UI のデザイン、通知、モバイル対応
- 認証・SSO の新規実装（ゲートウェイに委譲）
- ベクトル検索、スケール、マルチリージョン、バックアップ運用
- boid 本体の改修。Workflows・R2・Queues・Hyperdrive も今回は使わない（必要になったら足す）

## レビュー時に判断してほしいこと

下の 7 点が決まれば、この Doc をそのまま Claude Code に渡せる。決まらない項目はステップ 1 の着手を止めない範囲で後回しにできる。

- [x] H6 （仮説 6「Ingest が運用に耐える」）の一致率の目標値（たたき台: アンカー解決込みで 90%、AI 判断のみで 80%）→ この値で決定（2026-10-16）
- [x] 内部派生でも返事期待を必須にするか、省略可にするか（設計メモの未決「内部派生の返事期待の運用の重さ」）→ 省略可で決定（2026-10-16）
- [x] 無視の初期運用: AI の confidence が閾値を超えたら自動で無視するか、初期は全部人が確認するか → 自動で無視で決定（2026-10-16）。拾い漏れはデータソース側の通知で気づける前提
- [x] 観測された送信の返事期待は「Claude が推定、人が訂正」で進めてよいか → OK、この方針で決定（2026-10-16）
- [x] approve\_derivation をスタンドから呼べる API に含めるか（ユーザーの指示で Claude が承認を呼ぶ = スタンドの権限モデル通り）、承認だけ timeline.html のボタンにするか → 含めるで決定（2026-10-16）。timeline.html に承認ボタンは作らない
- [x] ステップ 1 のトークン検証: (B) 採用により不要。本体は署名付きで伝搬された sub を検証する
- [x] Neon のリージョンは Singapore で確定か → 確定（2026-10-16）。本格展開時に DB を Neon のままにするかは別途検討
- [x] ゲートウェイと本体のデプロイ単位: (a) 別リポ・別 Worker・Service Binding、(b) monorepo で 2 Worker を一括デプロイ（packages/auth で sub の署名と検証を共有）、(c) 同一 Worker。認可を (B) にしたので MCP は 1 つのまま、同意回数の差はない。Service Binding で別リポでも接続は閉じるので、傾きは (a) → (a) で確定（2026-10-16）
- [x] 認可の接続の形: (B) で決定（2026-10-16）。本体はゲートウェイの上流サービスとして登録し、スタンドから見える MCP はゲートウェイの 1 つのまま

* [x] Workflows と R2: 両方削る（2026-10-16）。期限超過は Cron の見回り、添付はファイル参照のみ

## Claude Code への渡し方

レビュー後にこの Doc を Markdown で書き出して `docs/PLAN.md` に置き、CLAUDE.md から参照させる。設計の正本は Google Doc なので、CLAUDE.md には API ゲートウェイの google-docs スキル経由で読めることも書く。

**CLAUDE.md に書く約束事**

- 実装の順序と完了条件は docs/PLAN.md の実装ステップに従う。ステップをまたいで先回りしない
- イベント型を追加・変更するときは zod スキーマ、fold の純関数テスト、リプレイテスト（H1）を同じ PR で更新する
- Claude API の呼び出しは必ず記録・再生の層を通す。テストは再生モードのみ
- `domain/` に Workers API への依存を持ち込まない
- テスト名とコミットメッセージに仮説番号（H1〜H7）を付ける
- 設計メモや本計画と食い違う判断が必要になったら、実装せず docs/adr/ に案を書いて止まる

**最初のセッションのプロンプト（案）**

```
docs/PLAN.md を読んで、実装ステップ 1「土台」をやって。
完了条件はステップ 1 に書いてある通り。
ゲートウェイのリポは <URL>、上流サービスの登録方法と伝搬される sub の形式は <参照先> を見て。
終わったら PR を作って、判断に迷った点を PR の説明に列挙して。
```
