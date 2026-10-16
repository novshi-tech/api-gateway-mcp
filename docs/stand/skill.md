---
name: murmur
description: AI ネイティブ タスク管理ツール（Murmur プロトタイプ）のタスク・派生・承認を API ゲートウェイ経由で操作する。「自分のタスクを見せて」「この件を工事部に回して」「承認待ちを確認して」「この派生を承認して」「無視したメールを確認して」などの依頼で使う。
---

# Murmur（スタンド用スキル）

Murmur の本体は API ゲートウェイの上流サービス `murmur` として登録されている。ゲートウェイの MCP から
`murmur` の HTTP API を呼ぶ（呼び方はゲートウェイ共通の api-gateway スキルに従う）。
ゲートウェイがあなた（ユーザー）の User ID を署名して本体に伝えるので、見えるもの・できることはユーザー本人と同じ。

## 守ること

- **承認（approve_derivation）はユーザーの明示の指示があるときだけ呼ぶ。** 提案（propose_derivation）までは自分の判断でしてよいが、
  承認の前に確認項目（本文・添付・宛先・返事期待・送信元）をユーザーに見せて、承認の指示をもらう
- 別のリストへ出す本文には、渡し先が知る必要のない内部事情・個人情報・元のメッセージの引用を入れない
- 属性はリストの属性定義（get_task / get_list の `attributeDefs`）にあるものだけ。`description` を読んで意味を合わせる
- ボールの所在（`ballAt`）と返事期待（`replyExpectedBy`）は通信状態で、イベントから自動で決まる。属性で書き換えない

## ツール（HTTP API）

| ツール | メソッドとパス | 入力 | 返すもの |
| --- | --- | --- | --- |
| list_my_tasks | GET /api/tasks?filter=&tenant= | filter: open / ball_at_me / overdue / all（既定 open）、tenant 省略可 | 自分のタスク一覧（テナント横断） |
| get_task | GET /api/tasks/{task_id} | | `access: full` ならタスク・タイムライン・属性定義・リンク。別リストのタスクは `access: summary`（派生の要約だけ） |
| set_attribute | POST /api/tasks/{task_id}/attributes | `{ name, value }`（null で消去） | get_task と同じ |
| propose_derivation | POST /api/derivations | `{ task_id, target_list, title?, body? , instruction?, attachments?, to_parties?, reply_expected?: { by }, reply_to? }` | 派生（status: proposed） |
| list_proposals | GET /api/proposals?list_id= | | 承認待ちの派生（確認項目つき） |
| approve_derivation | POST /api/derivations/{id}/approve | `{ from_address?: { channel, value } }` | 派生（内部: approved / completed、外部: sent） |
| reject_derivation | POST /api/derivations/{id}/reject | `{ reason }` | 派生（rejected） |
| close_task / reopen_task | POST /api/tasks/{task_id}/close・/reopen | `{ reason? }` | get_task と同じ |
| correct_ingest | POST /api/signals/{signal_id}/correct | `{ decision: { kind: attach, task_id } \| { kind: new, list_id, title } \| { kind: ignore }, reason }` | 訂正後の置き場所 |
| explain_ignore | GET /api/ignores?since= | | 無視の監査ログ（理由・confidence・判断者） |
| get_list | GET /api/lists/{list_id} | | メンバー・属性定義・接続チャネル |

自分の User と各テナントの Party・所属リストは `GET /api/me` で分かる。

## 派生の考え方

- **内部派生**（`to_parties` なし）: 同じテナントの別リストへ渡す。承認するとすぐ相手のリストにタスクとして現れる。返事期待は省略可
- **外部派生**（`to_parties` あり）: 相手リストのタスクを作り、宛先 Party へ送る。返事期待（`reply_expected.by`、ISO 8601）が必須。
  承認時に送信元（`from_address`）を選ぶ。省略するとユーザーかテナントの資格情報から自動で選ぶ
- 派生先のタスクから元のリストへ出す派生は、自動で「返事」として扱われ、元の派生が replied になる
- `body` を省略して `instruction` だけ渡すと、本体の Claude が境界越えの要約を書く

## よくある流れ

1. 「今日やることは？」→ `list_my_tasks(filter=ball_at_me)`、期限超過は `filter=overdue`
2. 「この件を工事部に回して」→ `get_task` で経緯と属性定義を読む → `propose_derivation` → 確認項目を見せて承認を待つ
3. 「承認して」→ `approve_derivation`
4. 「振り分けが違う」→ `correct_ingest`。無視したものは `explain_ignore` で確認できる
