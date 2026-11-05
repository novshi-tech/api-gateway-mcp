# gBizINFO REST API v2 エンドポイント

公式の仕様(`https://api.info.gbiz.go.jp/hojin/v3/api-docs?group=v2`)から要点をまとめたもの。ゲートウェイ経由のパスは `/hojin/v2/...`。すべて GET。

## 法人の検索

`GET /hojin/v2/hojin`

| パラメータ | 意味 |
|---|---|
| `corporate_number` | 法人番号(完全一致) |
| `name` | 法人名(部分一致) |
| `exist_flg` | `true`: 法人活動情報あり、`false`: なし |
| `corporate_type` | 法人種別(`101` 国の機関、`201` 地方公共団体、`301` 株式会社、`302` 有限会社、ほか) |
| `prefecture`、`city` | 所在地。全国地方公共団体コードの都道府県(2 桁)と市区町村(3 桁)。`city` には `prefecture` が必要 |
| `capital_stock_from`、`capital_stock_to` | 資本金の範囲 |
| `employee_number_from`、`employee_number_to` | 従業員数の範囲 |
| `founded_year` | 創業・設立年(カンマ区切りで複数) |
| `net_sales_summary_of_business_results_from` / `_to` | 売上高の範囲 |
| `total_assets_summary_of_business_results_from` / `_to` | 総資産額の範囲 |
| `average_continuous_service_years`、`average_age`、`month_average_predetermined_overtime_hours`、`female_workers_proportion` | 職場情報の区分(`A`〜`D`のコード。区分の意味は仕様書を見る) |
| `patent`、`procurement`、`subsidy`、`certification` | 特許(商標)・調達先・補助金名・届出認定表彰名の部分一致 |
| `procurement_amount_from` / `_to`、`subsidy_amount_from` / `_to` | 調達額・補助金額の範囲 |
| `ministry` | 担当府省の内部コード(カンマ区切り) |
| `source` | 出典元(`1` 調達、`2` 表彰、`3` 届出認定、`4` 補助金、`5` 特許、`6` 財務。カンマ区切り) |
| `page`、`limit` | ページ(1〜10)と 1 ページの件数(0〜5000) |
| `metadata_flg` | `true` でメタデータを付ける |

結果は `hojin-infos` の配列。各要素は `corporate_number`、`name`、`name_en`、`location`、`postal_code`、`status`、`update_date`、`number_of_activity` など。

## 法人番号を指定する

| パス | 内容 |
|---|---|
| `/hojin/v2/hojin/{corporate_number}` | 基本情報 |
| `/hojin/v2/hojin/{corporate_number}/corporation` | 事業所情報 |
| `/hojin/v2/hojin/{corporate_number}/certification` | 届出・認定 |
| `/hojin/v2/hojin/{corporate_number}/commendation` | 表彰 |
| `/hojin/v2/hojin/{corporate_number}/finance` | 財務 |
| `/hojin/v2/hojin/{corporate_number}/patent` | 特許・商標 |
| `/hojin/v2/hojin/{corporate_number}/procurement` | 調達 |
| `/hojin/v2/hojin/{corporate_number}/subsidy` | 補助金 |
| `/hojin/v2/hojin/{corporate_number}/workplace` | 職場情報 |

どれも `metadata_flg` を付けられる。

## 期間内の更新

`GET /hojin/v2/hojin/updateInfo`(基本情報)と、`/hojin/v2/hojin/updateInfo/{certification,commendation,finance,patent,procurement,subsidy,workplace}`。

- `from`、`to`(必須): `yyyyMMdd`。
- `page`: 1 以上。レスポンスに `totalCount`、`totalPage`、`pageNumber` が入る。

## 名称のサジェスト

`GET /hojin/SuggestNames?name=...&limit=...`(ゲートウェイ経由では `/hojin/SuggestNames`)。補助金名、事業名、商標名などにも `SuggestSubsidyNames`、`SuggestBusinessNames`、`SuggestTrademarks`、`SuggestNcrNames` がある。
