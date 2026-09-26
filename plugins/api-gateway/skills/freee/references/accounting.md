# 会計 API(`/api/1`)

例の `$GW` は `api-gateway` スキルの `gw_request.py`、`$ALL` はこのスキルの `scripts/freee_all.py`。GET と DELETE は `company_id` をクエリに、POST と PUT は JSON ボディに入れる。書き込みのボディの細かい項目は公式リファレンス(https://developer.freee.co.jp/reference/accounting/reference)で確かめる。

## 事業所・ユーザー

```
GET /api/1/companies          # 使える事業所の一覧(company_id は不要)。companies[].id が company_id
GET /api/1/companies/{id}     # 事業所の詳細
GET /api/1/users/me           # 自分。-q companies=true で所属事業所と権限も
GET /api/1/users              # 事業所のユーザー一覧(company_id)
```

## 取引(deals)

収入・支出の記帳の基本単位。

```
GET    /api/1/deals           # 一覧
GET    /api/1/deals/{id}      # 1 件
POST   /api/1/deals           # 作成
PUT    /api/1/deals/{id}      # 更新
DELETE /api/1/deals/{id}      # 削除(-q company_id=...)
```

一覧の主な絞り込み: `type`(`income` / `expense`)、`partner_id`、`start_issue_date` / `end_issue_date`、`start_due_date` / `end_due_date`、`status`(`settled` 決済済み / `unsettled` 未決済)、`offset` / `limit`(最大 100)。総件数は `meta.total_count`。

```sh
python3 $ALL /api/1/deals -q company_id=123 -q type=expense -q start_issue_date=2026-09-01 -q end_issue_date=2026-09-30 -o deals.json
```

作成の最小形。`details[]` の各行に勘定科目・税区分・金額を入れる。

```sh
python3 $GW POST freee /api/1/deals --json '{
  "company_id": 123,
  "issue_date": "2026-09-26",
  "type": "expense",
  "partner_id": 456,
  "details": [{"account_item_id": 789, "tax_code": 136, "amount": 11000, "description": "9月分"}],
  "receipt_ids": [1001]
}'
```

- `account_item_id` は `/api/1/account_items`、`tax_code` は `/api/1/taxes/companies/{company_id}` で調べる。値を推測しない。
- `receipt_ids` は紐付ける証憑の ID(任意)。
- 支払済みにするときは `payments[]` を付ける(口座と日付と金額)。項目は公式リファレンスで確かめる。

## 口座と口座明細(walletables / wallet_txns)

```
GET  /api/1/walletables                   # 口座の一覧(銀行口座・クレジットカード・現金など)。-q with_balance=true で残高も
GET  /api/1/walletables/{type}/{id}       # type は bank_account / credit_card / wallet
GET  /api/1/wallet_txns                   # 明細の一覧(walletable_type、walletable_id、start_date、end_date、offset、limit)
GET  /api/1/wallet_txns/{id}
POST /api/1/wallet_txns                   # 明細の手入力
DELETE /api/1/wallet_txns/{id}
```

## 振替(transfers)と振替伝票(manual_journals)

```
GET/POST        /api/1/transfers          # 口座間の資金移動(start_date、end_date)
GET/PUT/DELETE  /api/1/transfers/{id}
GET/POST        /api/1/manual_journals    # 仕訳を直接入力する振替伝票(start_issue_date、end_issue_date)
GET/PUT/DELETE  /api/1/manual_journals/{id}
```

## マスタ

```
GET /api/1/partners              # 取引先(keyword で名前などを検索)。POST / PUT / DELETE もある
GET /api/1/account_items         # 勘定科目(base_date でその日時点の一覧)
GET /api/1/sections              # 部門
GET /api/1/tags                  # メモタグ
GET /api/1/items                 # 品目
GET /api/1/segments/{segment_id}/tags   # セグメントタグ(segment_id は 1〜3)
GET /api/1/taxes/companies/{company_id} # 事業所で使う税区分(company_id はパスに入る)
GET /api/1/taxes/codes           # 税区分コードの一覧(company_id は不要)
GET /api/1/banks                 # 金融機関(company_id は不要)
```

各マスタには、ほぼ `/{id}` の取得と POST / PUT / DELETE がある。取引先の一覧は件数が多いことがあるので `freee_all.py` で取る。

## 証憑(receipts、ファイルボックス)

```
POST   /api/1/receipts        # アップロード(multipart)
GET    /api/1/receipts        # 一覧。start_date と end_date が必須
GET    /api/1/receipts/{id}   # 1 件
PUT    /api/1/receipts/{id}   # メモなどの更新
DELETE /api/1/receipts/{id}
```

アップロードは multipart で、`company_id` と `receipt`(ファイル)が必須。`description`(メモ)は任意。

```sh
python3 $GW POST freee /api/1/receipts -f company_id=123 --file receipt=invoice.pdf -f description='株式会社サンプル 9月分'
python3 $GW GET freee /api/1/receipts -q company_id=123 -q start_date=2026-09-01 -q end_date=2026-09-30
```

アップロードしても取引は自動で作られない。取引の登録はユーザーが freee の画面で行うのが基本(SKILL.md の「請求書 PDF をファイルボックスに上げる」を参照)。

## 経費申請・支払依頼・各種申請

申請は「一覧・取得・作成・更新・削除」に加えて、承認や却下を `POST .../{id}/actions` で行う。

```
/api/1/expense_applications       # 経費申請(status で絞り込み)
/api/1/payment_requests           # 支払依頼
/api/1/approval_requests          # 各種申請。フォームは /api/1/approval_requests/forms
/api/1/approval_flow_routes       # 申請経路(読み取りのみ)
```

`actions` のボディ(承認・却下・差し戻しの指定、対象の承認ステップなど)は公式リファレンスで確かめる。承認・却下は必ずユーザーに確認してから行う。

## レポート(試算表・総勘定元帳)

```
GET /api/1/reports/trial_bs                  # 貸借対照表
GET /api/1/reports/trial_pl                  # 損益計算書
GET /api/1/reports/trial_pl_sections         # 損益計算書(部門別)
GET /api/1/reports/trial_bs_two_years        # 前年比較(three_years もある。trial_pl も同様)
GET /api/1/reports/trial_cr                  # 製造原価報告書
GET /api/1/reports/general_ledgers           # 総勘定元帳(account_item_id など)
```

主なパラメータ: `company_id`、`fiscal_year`(会計年度)、`start_month` / `end_month`(会計年度の中の月)、`breakdown_display_type`(内訳の表示。`partner`、`item`、`section`、`account_item` など)。

```sh
python3 $GW GET freee /api/1/reports/trial_pl -q company_id=123 -q fiscal_year=2026 -q start_month=4 -q end_month=9 -o pl.json
```

## 仕訳帳のダウンロード(非同期)

```
GET /api/1/journals                                # 出力を依頼する(download_type、start_date、end_date)。レポートの ID が返る
GET /api/1/journals/reports/{id}/status            # 生成の状態
GET /api/1/journals/reports/{id}/download          # ファイル本体
```

`download_type` は `csv`、`pdf`、`generic_v2` など。状態を何秒か空けて確かめ、完了してから `-o journals.csv` で保存する。

## その他

```
GET /api/1/fixed_assets     # 固定資産(読み取り)
GET /api/1/quotations       # 旧来の見積書(読み取り)。新しい見積書・請求書は /iv を使う
GET /api/1/invoices         # 旧来の請求書(読み取り)
```
