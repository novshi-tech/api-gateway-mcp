# 請求書 API(`/iv`)と販売 API(`/sm`)

例の `$GW` は `api-gateway` スキルの `gw_request.py`、`$ALL` はこのスキルの `scripts/freee_all.py`。`company_id` は GET ではクエリ、POST / PUT / PATCH ではボディに入れる。ボディの項目は公式リファレンス(https://developer.freee.co.jp/reference)で確かめる。

## 請求書 API: 請求書・見積書・納品書

請求書・見積書・納品書の作成と更新はこちらを使う。会計 API の `/api/1/invoices`、`/api/1/quotations` は旧来のもので、読み取りだけ。

```
GET  /iv/invoices              # 請求書の一覧(partner_id、offset、limit などで絞り込み)
GET  /iv/invoices/{id}
POST /iv/invoices              # 作成
PUT  /iv/invoices/{id}         # 更新
GET  /iv/invoices/templates    # 帳票テンプレートの一覧

GET/POST /iv/quotations        # 見積書。/{id} の取得と PUT、/templates も同じ形
GET/POST /iv/delivery_slips    # 納品書。/{id} の取得と PUT、/templates も同じ形
```

```sh
python3 $ALL /iv/invoices -q company_id=123 -o invoices.json
python3 $GW GET freee /iv/invoices/templates -q company_id=123
```

- 作成には、取引先・日付・明細行・テンプレートなどが要る。テンプレートの ID は `/templates` で、取引先の ID は会計 API の `/api/1/partners` で調べる。
- 一覧で使える絞り込みの値(請求書の状態、入金状況など)は、公式リファレンスで確かめる。
- 作成・更新の前に、内容をユーザーに確認する。送付(メール送信など)は freee の画面で行ってもらう。

## 販売 API: 案件・受注・納品・売上

更新のメソッドに注意する。案件は `PUT`、受注・納品・売上は `PATCH`。

```
GET/POST /sm/businesses              # 案件。/{id} の取得と PUT
GET/POST /sm/sales_orders            # 受注。/{id} の取得と PATCH
GET/POST /sm/deliveries              # 納品。/{id} の取得と PATCH
GET/POST /sm/sales                   # 売上。/{id} の取得と PATCH
```

```sh
python3 $ALL /sm/sales -q company_id=123 -o sales.json
python3 $GW PATCH freee /sm/sales_orders/{id} --json @body.json    # body.json に company_id と変える項目
```

作成や更新で指定する ID は、次のマスタで調べる(どれも GET、`company_id` が要る)。

```
GET /sm/master/business_phases                      # 案件のフェーズ
GET /sm/master/sales_progressions                   # 受注の確度
GET /sm/master/items                                # 品目(会計 API の品目とは別)
GET /sm/master/deal_line_types                      # 明細の種類
GET /sm/master/employees                            # 担当者
GET /sm/master/custom_fields/business/definitions   # 案件のカスタム項目の定義
```
