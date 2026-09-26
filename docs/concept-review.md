# 構想レビュー

調査日: 2026-09-26

要件メモ: https://docs.google.com/document/d/1aV-pfbEYjyamSPmm6_JnvG4vZwRO5oiEMCazvK-bX00
認可の設計: [auth-design.md](auth-design.md)

細かい設計に入る前に、構想全体に穴がないか、もっとよい別解がないかを確かめた結果をまとめる。

## 構想(レビュー後)

```
Cowork / ChatGPT
  │ ① MCP (OAuth、ユーザー単位)
  ▼
Worker ──────────────────────────────────────────────┐
  ├─ MCP: 短命トークンの発行、サービスとアカウントの一覧 など少数のツール │
  └─ REST: /<service>/<path> を上流に中継する                        │
        ▲ ③ 短命トークンで直接呼び出す                             │
        │                                                          │ ④ 認証情報を注入して転送
  サンドボックス内のスクリプト(スキルに同梱)  ◀─ ② トークンを受け取る   ▼
                                                     freee / Graph / Board / 自社ツール
```

1. ユーザーは MCP コネクタとして OAuth でログインする(詳細は auth-design.md)。
2. スキルの手順に従い、Claude が MCP のツールで寿命の短いトークンを発行してもらう。トークンの範囲は、サービス・メソッド・パスで指定する。
3. サンドボックスで動くスクリプトが、そのトークンでゲートウェイの REST を呼ぶ。
4. ゲートウェイは、パスの先頭から上流のサービスを決め、認証情報を注入して転送する。リクエストやレスポンスのボディの中身は見ない。

### 方針

- **ゲートウェイは API の仕様を知らない。** パスから上流を決めて認証情報を注入するだけの、単純なリバースプロキシにする。OpenAPI や GraphQL のスキーマは取り込まない。API の知識はスキル(と、スキルに同梱するスクリプト)が持つ。
  - ボディは素通しにする。これで multipart のアップロードやファイルのダウンロードもそのまま扱える。
  - REST でも GraphQL でも、HTTP でさえあれば同じ仕組みで中継できる。
- **決まった手順の処理はスクリプトで行う。** スクリプトはスキルに同梱し、git で管理する。AI が毎回組み立てないので動作がぶれず、ファイル本体も AI の会話を通らない。
- **既存のコネクタで足りる処理はそちらを使う。** freee 公式のリモート MCP や Claude の M365 コネクタは、単純な読み取りには十分。ゲートウェイが役に立つのは、次のような処理。
  - サービスをまたぐ処理とファイルの受け渡し
  - MCP がないサービス(Board、自社ツール)
  - 認証情報の一元管理と操作ログ

## 調査で確認した事実

### 既存のコネクタではファイルを運べない

- Claude の M365 コネクタは、ファイルをテキストとして読むだけで、バイナリを取得できない(書き込み系のツールは 2026-07 に追加された)。
  - https://claude.com/docs/connectors/microsoft/365
- freee 公式のリモート MCP(`https://mcp.freee.co.jp/mcp`)は `freee_api_post` などの汎用ツールを持つが、ボディは JSON だけで multipart を送れない。ファイルをアップロードする `freee_file_upload` はローカル(stdio)版にしかない。
  - https://github.com/freee/freee-mcp
- MCP のツールの結果として返せるのは、テキストと画像。上限はおよそ 15 万文字、1 回の呼び出しは 240 秒まで。埋め込みリソースの blob は失敗した報告がある。
  - https://claude.com/docs/connectors/building
  - https://github.com/anthropics/claude-code/issues/93946
- ローカルの OneDrive 同期フォルダを Cowork に読ませる案は、ファイルがクラウドにだけある状態(オンデマンド)だと、中身が空や途中までになる不具合がある。
  - https://github.com/anthropics/claude-code/issues/62140

→ ファイル本体の受け渡しには独自の仕組みが要る。汎用ゲートウェイとスクリプトの組み合わせで対応する。

### Cowork の実行環境

- コードは、使い捨てのサンドボックス(クラウドまたはローカルの VM)で動く。
  - https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview
- コネクタの認証トークンはサンドボックスに入らない。スキルに秘密情報を入れてはいけない。
  - https://claude.com/docs/skills/how-to
  - → スクリプトの認証には、MCP で発行する短命トークンを使う。
- 外への通信:
  - Max プランでは、ドメインの制限がないことを実機で確認した。
  - Team / Enterprise では、組織の管理者が「パッケージマネージャーのみ」か「すべてのドメイン」を選び、許可するドメインを追加できる。Enterprise は初期状態だと外に出られない。
    - https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans
  - 許可リストに入れても 403 になる、という不具合報告が 2026-09 に複数ある(anthropics/claude-code #93512, #93520, #93656, #93677)。
  - → 導入時に管理者がゲートウェイのドメインを許可する。Team の環境で実際に通るかを検証する。
- スキルやプラグインは、Owner が組織に配布できる。GitHub のリポジトリと同期でき、「必須」や「既定でインストール」も指定できる。コネクタは別途 Owner が追加し、各メンバーが自分のアカウントで接続する。
  - https://claude.com/docs/plugins/admin
- Cowork のスケジュール実行はクラウドで動き、デスクトップアプリを閉じていても実行される。
  - https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork
- ChatGPT も、サンドボックスとコネクタの関係はほぼ同じ(認証情報は橋渡しされず、外への通信は管理者と利用者の設定で決まる)。
  - https://learn.chatgpt.com/docs/enterprise/chatgpt-work-overview

### freee

- `POST /api/1/receipts` は multipart のみ。1 ファイル 64MB まで。自動読み取りは 10MB 未満のファイルだけが対象(ヘルプセンター情報)。1 アプリ・1 事業所あたり 1 日 3,000 回まで(プランで増える)。
- API でファイルをアップロードすると自動読み取りは走るが、**読み取り結果から取引を自動で作る API はない**。取引は freee の画面で人が確定するか、API で取引を作って `receipt_ids` で書類を紐づける。
- 電子帳簿保存法: freee はタイムスタンプではなく、訂正・削除の履歴で対応している(JIIMA 認証あり)。検索要件は、取引先・日付・金額のメタデータで満たす。社内の事務処理規程は別途必要。
- OAuth: アクセストークンは 6 時間、リフレッシュトークンは 90 日。**リフレッシュトークンは一回しか使えず、リフレッシュのたびに新しくなる。**
- アプリの種別: プライベートアプリは 5 事業所まで、審査なし。
- 出典:
  - https://developer.freee.co.jp/reference/accounting/reference
  - https://developer.freee.co.jp/reference/faq/token_lifetime
  - https://developer.freee.co.jp/reference/application-types

### Microsoft Graph

- ファイルのダウンロードは `GET /drives/{drive-id}/items/{item-id}/content`。事前に認証された URL への 302 リダイレクトが返る。その URL は数分で失効し、Authorization ヘッダーは不要。
  - https://learn.microsoft.com/en-us/graph/api/driveitem-get-content
- `Sites.Selected` を使うと、アクセスを特定のサイトだけに絞れる。委任(ユーザーとして)とアプリケーション(アプリとして)のどちらの権限でも使える。
  - https://learn.microsoft.com/en-us/graph/permissions-selected-overview

### Board

- 認証は `x-api-key`(アカウントにひとつ)と `Authorization: Bearer <API トークン>`。トークンは複数作れて、トークンごとに使えるエンドポイントを制限できる。
- レート制限は 1 秒に 3 回、1 日 3,000 回。
- 公式の MCP はない。非公式の `breakedge/the-board-mcp-server` は、書き込みを三段階で制限している(読み取りのみ / 書き込み可 / 削除も可)。
- 出典:
  - https://developers.the-board.jp/doc/
  - https://github.com/breakedge/the-board-mcp-server

## 短命トークンの設計上の注意

- トークンはツールの結果として返すので、会話に残る。寿命は 15 分程度にし、使える範囲をサービス・メソッド・パスで絞る。
- 外への通信に制限がない環境では、プロンプトインジェクションでトークンが外に送られる可能性がある。寿命を短くし、範囲を絞ることで被害を抑える。
- 書き込みの承認: 書き込みを含む範囲でトークンを発行するときは、Claude がツールを呼ぶ前に実行確認を出す。これを人が承認する場面にする。そのため、読み取り用と書き込み用で、発行するときの範囲を分ける。
- トークンはユーザーに紐づくので、REST の呼び出しもユーザー単位で操作ログに残せる。
- 処理の途中で寿命が切れたら、ツールでもう一度発行する。スキルにそう書いておく。

## 先に決めておくこと

1. **認証情報を持つ単位とアクセスの方針**
   - Board の API キーは組織でひとつなので、組織で共有するしかない。freee や Graph はユーザーごとに持てる。
   - 「ユーザー個人の認証情報」と「組織で共有する認証情報」の両方を扱い、誰がどれを使えるかを決める仕組みが要る。
2. **許可リスト**
   - サービスごと・役割ごとに、使えるメソッドとパスを決める。既定は読み取りのみ。
   - GraphQL は、読み取りも書き込みもすべて `POST /graphql` になる。そのため、メソッドとパスだけでは区別できない。ボディを見ない方針と両立させるなら、GraphQL のサービスは「読み取りも書き込みも可」か「不可」の二択にする。あるいは、そのサービスに限って operation の種類(query か mutation か)だけを判定するか、どちらかを決める。
3. **リフレッシュトークンの直列化**
   - freee のように一回しか使えないリフレッシュトークンは、二か所から同時にリフレッシュすると互いに壊れる。認証情報ごとに Durable Object で処理を順番に並べる。
4. **freee の取引の確定を誰がやるか**
   - 読み取り結果から取引は自動で作られない。「解析は freee に任せたい」という要件を守るなら、freee の画面で人が確定する運用にする。
5. **連携先の認証情報を登録する手順**
   - 各ユーザーが freee や Graph と接続する画面(ゲートウェイ上の Web UI)が要る。
   - Graph は、Entra のログインと同時に同意を取ることもできる。
6. **レート制限**
   - Board は 1 秒に 3 回。ゲートウェイ側で上流ごとに流量を制限するかを決める。

## 検討したほかの手段

| 手段 | 評価 |
|---|---|
| Cloudflare Code Mode(AI が書いたコードを Worker の中の隔離環境で動かす) | ファイルの受け渡しとトークン削減には効く。ただしまだベータで、ゲートウェイが API 仕様を知る必要がある。サンドボックスから外に出られない環境(Enterprise の初期設定、スクリプトを実行できない ChatGPT のチャット)向けの代わりの手段として残す |
| Executor(executor.sh、MIT) | 採用もフォークもしない。部品の考え方だけ参考にする(下記) |
| Composio / Pipedream / Zapier / Arcade | 第三者に認証情報を預けることになる。顧客ごとにデプロイする方針と合わない |
| IBM ContextForge / Obot / MetaMCP / Microsoft mcp-gateway / Kong | MCP サーバーを束ねるものが中心で、小さな会社には重い |
| n8n / Power Automate でフローを作り、MCP のツールとして公開する | 決まった手順の業務には強い。ただし認証情報が共有になり、業務ごとにフローの作成が要る。スキルに同梱するスクリプトで代われる |
| freee のローカル MCP と OneDrive の同期フォルダ | オンデマンドのファイルを読めない不具合があり、不安定 |

参考:
- https://blog.cloudflare.com/code-mode-mcp/
- https://github.com/UsefulSoftwareCo/executor
- https://github.com/e2b-dev/awesome-mcp-gateways
- https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices
- https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html

## 次にやること

- [x] Executor を評価する(下記)
- [ ] Team プランの Cowork で、ゲートウェイのドメインへの通信が通るかを検証する
- [ ] 「先に決めておくこと」の 1〜6 を決める

## Executor の評価(2026-09-26)

結論: **採用もフォークもしない。部品の考え方だけ参考にする。**

- **設計の軸が逆。** すべての連携先を OpenAPI / GraphQL / MCP の仕様から型付きのツールにして、コードの実行も Executor の中で行う。仕様なしで素通しに中継する仕組みはない。バイナリは JSON の中に base64 で入れて運ぶので、ボディは素通しにならない。
- **Cloudflare 版には MCP の OAuth サーバーがない。** 認証は Cloudflare Access だけに頼っている(`apps/host-cloudflare/src/mcp/auth.ts`)。そのため、claude.ai のコネクタからはそのままでは接続できない。Docker 版には Better Auth による OAuth(DCR)があるが、Bun と libSQL で動いており Workers ではない。CIMD には対応していない。
- **短命トークンの発行や、外部のスクリプトから呼べる REST の中継もない。** 操作ログは OpenTelemetry に出すだけで、呼び出しごとのログは残らない。
- **成熟度:** スター数は約 4k。ただしコミットのほとんどが作者ひとりによるもので、v2 のベータに移行している最中。変更がとても速い。
- **フォークした場合:** 素通しの中継、Workers 上の OAuth サーバー、トークンの発行、操作ログ、リフレッシュの直列化を足すことになる。目標の大半を、大きくて変化の速いコードベースの上に作ることになるので、小さな Worker を自作するほうが軽い。

参考にする部品(https://github.com/UsefulSoftwareCo/executor):
- 上流 OAuth のリフレッシュとローテーションの扱い(`packages/core/sdk/src/oauth-service.ts`)。一回しか使えないリフレッシュトークンを使う前に、保存先へ書き込めるかを確かめている。ただし、同時リフレッシュを防ぐ仕組みは同じインスタンスの中でしか効かない。そのため、こちらは Durable Object で直列化する。
- 組織所有とユーザー所有の二本立ての権限モデル(`packages/core/sdk/src/owner-policy.ts`)。ユーザーは、自分のものと組織のものを見られる。
- 1 つの連携先に複数の接続を持ち、呼び出すときに選ぶ仕組み。
- 許可 / 承認が必要 / 拒否 のポリシーと、承認待ちで処理を止めて再開する仕組み(`packages/core/sdk/src/policies.ts`)。
- 秘密情報の AES-256-GCM 暗号化(`packages/plugins/encrypted-secrets`)。
- OIDC ログインの受け入れ条件(メールアドレスが確認済みであることと、ドメインの許可リスト。`apps/host-selfhost/src/auth/sso.ts`)。
