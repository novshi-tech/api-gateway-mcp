---
name: board
description: 販売管理 SaaS「board」(the-board.jp)の API を API ゲートウェイ経由で操作する。案件・案件原価・見積書・請求書・納品書・領収書・発注・支払・顧客・発注先・計上データなどの検索、一覧の取得・集計、登録・更新を扱う。「board の案件を一覧して」「今月の請求を集計して」「取引先を検索して」「発注を登録して」などの依頼で使う。
---

# board API

board の API を、API ゲートウェイ経由で呼び出す。トークンの発行とスクリプトの基本的な使い方は、`api-gateway` スキルに従う。

## 手順

1. `api-gateway` スキルの手順で、サービス `board` の認証情報を選んでトークンを発行し、`GW_TOKEN` と `GW_BASE_URL` を設定する。
2. 使うエンドポイントを [references/endpoints.md](references/endpoints.md) で探す。見出しは `## <METHOD> /v1/<path>` の形なので、`grep -n "^## GET /v1/projects" references/endpoints.md` のように検索して、その節だけ読む。ファイル全体は大きいので、丸ごと読まない。
3. スクリプトで呼び出す。
   - 1 件の取得や、登録・更新: `api-gateway` スキルの `gw_request.py`
   - 一覧の全件取得: `scripts/board_all.py`(ページングとレート制限を処理する)

```sh
GW=${CLAUDE_SKILL_DIR}/../api-gateway/scripts/gw_request.py
python3 $GW GET board /v1/projects -q per_page=5 -q name_cont=保守
python3 ${CLAUDE_SKILL_DIR}/scripts/board_all.py /v1/projects -q order_status_in[]=4 -o projects.json
python3 ${CLAUDE_SKILL_DIR}/scripts/board_all.py /v1/clients --csv id,name,name_disp -o clients.csv
```

## API の要点

- パスは `/v1/...`。一覧は `per_page`(最大 100)と `page` でページングし、件数はレスポンスヘッダーの `X-Total-Count` に入る。
- 一覧の検索条件は `*_cont`(部分一致)、`*_eq`(一致)、`*_in[]`(いずれか)、`*_gteq` / `*_lteq`(以上・以下)。日付は `YYYY-MM-DD`。
- 一覧は既定で新しい順。アーカイブ済みや失注は既定で含まれないことがある(`include_archive_flg`、`include_lost_flg`)。
- 項目を増やしたいときは `response_group=large` を付ける。
- 更新は `PATCH`。ステータスの変更やロックは、専用のエンドポイントに分かれている(例: `PATCH /v1/projects/order_status/{id}`)。
- ID を他のリソースから引く項目が多い。顧客 ID は `/v1/clients`、担当者 ID は `/v1/users`、支払条件 ID は `/v1/payment_terms` などで調べる。
- 自社支社 ID や書類詳細設定 ID のように、API で取得できない ID もある。その場合はユーザーに board の画面の URL から調べてもらう。

## 主なリソース

| やりたいこと | エンドポイント |
|---|---|
| 案件(受注・見積) | `/v1/projects`、受注ステータス変更 `/v1/projects/order_status/{id}` |
| 案件原価 | `/v1/project_costs` |
| 請求の一覧・入金状況 | `/v1/invoices`、請求ステータス変更 `/v1/invoices/invoice_status/{id}` |
| 見積書・請求書などの書類 | `/v1/documents/{estimates,orders,deliveries,invoices,receipts}/{id}` |
| 顧客・支社・担当者 | `/v1/clients`、`/v1/client_branches`、`/v1/contacts` |
| 発注・支払 | `/v1/expenditures`、`/v1/expenditure_payments` |
| 発注先 | `/v1/payees`、`/v1/payee_branches`、`/v1/payee_contacts` |
| 売上・原価の計上データ | `/v1/analyses` |
| マスタ | `/v1/users`、`/v1/groups`、`/v1/payment_terms`、`/v1/project_types`、`/v1/expenditure_types`、`/v1/accounting_types` |

## 制限と注意

- レート制限: API キーごとに 1 秒 3 回、1 日 3,000 回(UTC で日付が変わるとリセット)。超えると 429。大量に取得するときは `board_all.py` を使い、同じデータを何度も取らずにファイルに保存して使い回す。
- API トークンごとに使えるエンドポイントが決まっている。403 の `{"message":"許可されていません。"}` は、トークンにそのエンドポイントの権限がないことが多い。ユーザーに board の API 設定を確認してもらう。
- 登録・更新・削除・ステータス変更・ロックは、実行前に対象と内容をユーザーに確認する。削除は取り消せない。
- 金額や件数を報告するときは、取得した件数と `X-Total-Count` が一致しているか確かめる。
