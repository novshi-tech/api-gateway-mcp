---
name: bm-next
description: ビルメンNEXT(ビルメンテナンス向けの業務プラットフォーム)の GraphQL API を API ゲートウェイ経由で操作する。業務(work)・割当(assignment)・不在・パートナー・実施月・月次の業務状況、施設・メーターと検針、組織・メンバー・ロール・API キーなどの検索、一覧の取得・集計、登録・更新と、作業予定・検針表の Excel 帳票テンプレートの作成・登録・出力を扱う。「ビルメンNEXT の業務を一覧して」「今月の割当を集計して」「施設のメーター一覧を出して」「不在を登録して」「作業予定の Excel テンプレートを作って」「検針表のテンプレートを登録して」などの依頼で使う。
---

# ビルメンNEXT API

ビルメンNEXT の GraphQL API を、API ゲートウェイ経由で呼び出す。トークンの発行とスクリプトの基本的な使い方は、`api-gateway` スキルに従う。

## 手順

1. `api-gateway` スキルの手順で、サービス `bm-next` の認証情報を選んでトークンを発行し、`GW_TOKEN` と `GW_BASE_URL` を設定する。
   - 認証情報はビルメンNEXT の API キー(`bmn_` で始まる)。ユーザーがビルメンNEXT で発行し、ゲートウェイの画面で登録する。Claude が `createApiKey` で発行してはいけない(キーが会話に残る)。
   - 認証情報が複数あるときは、別の組織やメンバーのキーのことがある。`label` を見て、どれを使うかユーザーに確認する。
2. まず `{ myOrganization { id name } myScopes }` で、どの組織として動いているかと、使えるスコープを確かめる。
3. 使うクエリやミューテーションを [references/schema.md](references/schema.md) で探す。見出しは `## query works`、`## mutation createRole`、`## type Work` の形なので、`grep -n "^## query works" references/schema.md` のように検索して、その節だけ読む。ファイル全体は大きいので、丸ごと読まない。
4. スクリプトで呼び出す。
   - 1 回のクエリやミューテーション: `scripts/bm_next_graphql.py`
   - 一覧の全ページ取得: `scripts/bm_next_all.py`(`continuationToken` をたどる)

```sh
BM=${CLAUDE_SKILL_DIR}/scripts
python3 $BM/bm_next_graphql.py '{ myOrganization { id name } myScopes }'
python3 $BM/bm_next_graphql.py 'query($y: Int!, $m: Int!) { executionMonth(year: $y, month: $m) { id status } }' --vars '{"y": 2026, "m": 9}'
python3 $BM/bm_next_all.py 'query($from: String) { works(from: $from) { results { id name status } continuationToken } }' --csv id,name,status -o works.csv
```

長いクエリは `@query.graphql` のようにファイルから読ませる(`--vars @vars.json` も同じ)。

## API の要点

- 入り口は `POST /graphql` 1 つだけ。ゲートウェイ経由では `<base_url>/bm-next/graphql`。スクリプトが組み立てるので、パスは意識しなくてよい。
- **エラーは HTTP 200 で返る。** 認証に失敗しても 200 で、本文の `errors` に入る。API キーが無効・失効・未登録のときは `extensions.code` が `AUTH_NOT_AUTHENTICATED` になる。スクリプトは `errors` があると標準エラーに出して、終了コード 1 で終わる。
- 使えるクエリとミューテーションは、キーの持ち主のロールに付いたスコープで決まる。スコープがないと、そのフィールドはエラーになる。リファレンスの「必要な権限」の `scope` を、`myScopes` と突き合わせる。
- 一覧は `{ results, continuationToken }` を返す。次のページは、`continuationToken` を `from` 引数に渡す。件数の引数は、`limit`、`count`、`first` とクエリごとに名前が違う。
- ID はすべて文字列(`String`)。日付は `LocalDate`(`2026-09-01`)、日時は `DateTime`(ISO 8601)。
- 状態は enum(`GenericEntityStatus` は `DRAFT`、`PUBLISHED`、`ARCHIVED`)。一覧の `statuses` などの引数で絞る。既定でアーカイブ済みが含まれるかは、クエリごとに違うので確かめる。
- ミューテーションは、`input` を 1 つ取り、結果を包んだ `...Payload` を返す。返してほしい項目は、自分で選ぶ。

## 主なリソース

| やりたいこと | クエリ |
|---|---|
| 自分の組織・スコープ・契約 | `myOrganization`、`myScopes`、`myEntitlements` |
| 業務(作業の定義) | `works`、`work`、`workTagKeys` |
| 業務の割当 | `assignments`、`assignment`、`worker` |
| 月次の実施状況 | `executionMonths`、`monthlyWorkStatuses`、`monthlyWorkStatus` |
| 不在・祝日 | `absences`、`absencesByMonth`、`nationalHolidays` |
| パートナー(取引先の組織) | `partners`、`organizationLinks` |
| 施設・メーター・検針 | `facilities`、`facility`、`meters`、`meterChanges` |
| メンバー・ロール・API キー | `members`、`roles`、`myApiKeys` |
| Excel 帳票のテンプレート | `savedWorkFilters`、`facilityReportTemplate`、`uploadScheduleReportTemplate`、`uploadFacilityReportTemplate` |

## Excel 帳票のテンプレート

作業予定(保存済みフィルタごと)と検針表(施設ごと)は、登録した Excel テンプレートに差し込んで出力できる。テンプレートを作る・直す・登録する・出力を確かめるときは、[references/report-templates.md](references/report-templates.md) を読む。トークンの書き方(`{{report.month}}`、`{{schedule.date}}`、`{{meter.value}}` など)、方式(テーブル方式・旧方式・固定セル方式)、`openpyxl` での作り方、登録と出力の手順がある。

- 登録の前に `scripts/bm_next_template_check.py` で、サーバーに拒否されないかを確かめる。
- 出力は GraphQL ではなく REST(`/api/works/saved-filters/{id}/report`、`/api/meter-reading/facilities/{id}/reports/{yyyyMM}/export`)。`api-gateway` スキルの `gw_request.py` でダウンロードする。

## 注意

- 登録・更新・削除・ミューテーション全般は、実行前に対象と内容をユーザーに確認する。
- `X-Act-As-Organization`(`--act-as 組織ID`)は、System 組織のメンバーのキーだけが使える。別の組織として動くので、指定するときは対象の組織をユーザーに確認し、結果にどの組織のデータかを書く。
- 必要な項目だけを選び、深いネストを避ける。全件が要るときは `bm_next_all.py` を使い、同じデータを何度も取らずにファイルに保存して使い回す。
- 件数や合計を報告するときは、取得した件数を確かめる。ページが途中で切れていないか(`continuationToken` が空で終わったか)を見る。
- リファレンスはスキーマから自動生成したもの。スキーマが変わったら `tools/gen-bm-next-reference.py` で作り直す。
