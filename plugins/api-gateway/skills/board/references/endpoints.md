# Board API エンドポイント一覧(v1.9.0)

自動生成: `tools/gen-board-reference.py`(元: https://developers.the-board.jp/doc/board_openapi.json)。パスはすべて `/v1` の下。
レスポンスの項目はここに載せていない。実際に 1 件取得して確かめること。

## GET /v1/clients

顧客リスト取得。顧客リストを取得します。

パラメータ:
- `name_cont` (string): 顧客名（部分一致）
- `name_disp_cont` (string): 顧客略称名（部分一致）
- `invoice_system_number_eq` (string): 適格請求書発行事業者の登録番号
- `tags[]` (string): タグ（複数の場合はカンマ区切り）
- `include_archive_flg` (enum(0, 1)): アーカイブを含むか - 0：アーカイブ済みは除く - 1：アーカイブ済みも含む
- `updated_at_gteq` (string): 更新日時（指定日時以降）
- `updated_at_lteq` (string): 更新日時（指定日時以前）
- `custom_no_eq` (string): 顧客番号
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号
- `response_group` (enum(small, large)): レスポンスグループ | response_group | 項目 | |:-----------|:------------| | small | id, name, name_disp, title, zip, pref, address1, address2, tel, fax, payment_term_id, …

## POST /v1/clients

顧客登録。顧客を新規登録します。

リクエストボディ(JSON):
- `name` (string): (必須) 顧客名
- `name_disp` (string): (必須) 顧客略称名
- `zip` (string): 郵便番号（ハイフン区切り）
- `pref` (string): 都道府県
- `address1` (string): 市区町村・番地
- `address2` (string): 建物名
- `tel` (string): TEL（ハイフン区切り）
- `fax` (string): FAX（ハイフン区切り）
- `title` (string): 敬称
- `payment_term_id` (integer): デフォルト支払条件ID - 新規登録時に未指定の場合は最初の支払条件が使用されます - 支払条件リスト取得APIのレスポンスにある`id`です
- `nda_flg` (enum(0, 1)): NDA締結 - 0：未 - 1：済
- `basic_agreement_flg` (enum(0, 1)): 基本契約書締結 - 0：未 - 1：済
- `document_send_type` (integer): 書類送付方法 - 1：メール(DL) - 2：郵送 - 3：メール(DL)+郵送 - 4：メール(添付) - 5：メール(添付)+郵送 - またはカスタム書類送付方法のID
- `note` (string): 備考
- `tags` (array<string>): タグ ※タグ名の配列
- `wareki_flg` (enum(0, 1)): デフォルト和暦表示 - 0：西暦 - 1：和暦 ※「和暦表示」機能有効時のみ
- `company_number` (string): 法人番号
- `accounting_code` (string): 会計用名称・コード ※「会計連携機能」機能有効時のみ
- `to` (string): TO（メールアドレス） ※複数指定する場合はカンマ区切り
- `cc` (string): CC（メールアドレス） ※複数指定する場合はカンマ区切り
- `invoice_system_number` (string): 適格請求書発行事業者の登録番号
- `invoice_system_issuer_type` (enum(0, 1, 2)): 適格請求書発行事業者 - 0：未設定 - 1：該当する - 2：該当しない
- `bank_charge_to_client_flg` (enum(0, 1)): 振込手数料負担 - 0：当方 - 1：先方
- `custom_no` (string): 顧客番号
- `company_bank_id` (integer): デフォルト振込口座ID ※このIDを取得するAPIはありません。画面上の「組織設定→振込口座管理」で対象の「編集」に行き、そのURLに含まれるIDを使用してください。例：`https://the-board.jp/company_banks/123456/edit` → 123456
- `name_en` (string): 顧客名（英語表記） ※英語アドオン有効時のみ
- `address_en` (string): 住所（英語表記） ※英語アドオン有効時のみ
- `phone_country_code` (string): 国番号（英語表記） ※英語アドオン有効時のみ
- `currency` (enum(JPY, USD, EUR, GBP, CNY, HKD, TWD, KRW, SGD, AUD, IDR, THB, CAD)): デフォルト通貨 ※英語アドオン有効時のみ
- `lang_kbn` (enum(1, 2)): デフォルト言語 - 1：日本語 - 2：英語 ※英語アドオン有効時のみ
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み

## GET /v1/clients/{id}

顧客取得。ID指定で顧客を取得します。

パラメータ:
- `id` (integer): 顧客ID ※顧客登録API・顧客リスト取得APIのレスポンスにある`id`

## PATCH /v1/clients/{id}

顧客更新。ID指定で顧客を更新します。

パラメータ:
- `id` (integer): 顧客ID ※顧客登録API・顧客リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `name` (string): 顧客名
- `name_disp` (string): 顧客略称名
- `zip` (string): 郵便番号（ハイフン区切り）
- `pref` (string): 都道府県
- `address1` (string): 市区町村・番地
- `address2` (string): 建物名
- `tel` (string): TEL（ハイフン区切り）
- `fax` (string): FAX（ハイフン区切り）
- `title` (string): 敬称
- `payment_term_id` (integer): デフォルト支払条件ID - 新規登録時に未指定の場合は最初の支払条件が使用されます - 支払条件リスト取得APIのレスポンスにある`id`です
- `nda_flg` (enum(0, 1)): NDA締結 - 0：未 - 1：済
- `basic_agreement_flg` (enum(0, 1)): 基本契約書締結 - 0：未 - 1：済
- `document_send_type` (integer): 書類送付方法 - 1：メール(DL) - 2：郵送 - 3：メール(DL)+郵送 - 4：メール(添付) - 5：メール(添付)+郵送 - またはカスタム書類送付方法のID
- `note` (string): 備考
- `tags` (array<string>): タグ ※タグ名の配列
- `wareki_flg` (enum(0, 1)): デフォルト和暦表示 - 0：西暦 - 1：和暦 ※「和暦表示」機能有効時のみ
- `company_number` (string): 法人番号
- `accounting_code` (string): 会計用名称・コード ※「会計連携機能」機能有効時のみ
- `to` (string): TO（メールアドレス） ※複数指定する場合はカンマ区切り
- `cc` (string): CC（メールアドレス） ※複数指定する場合はカンマ区切り
- `invoice_system_number` (string): 適格請求書発行事業者の登録番号
- `invoice_system_issuer_type` (enum(0, 1, 2)): 適格請求書発行事業者 - 0：未設定 - 1：該当する - 2：該当しない
- `bank_charge_to_client_flg` (enum(0, 1)): 振込手数料負担 - 0：当方 - 1：先方
- `custom_no` (string): 顧客番号
- `company_bank_id` (integer): デフォルト振込口座ID ※このIDを取得するAPIはありません。画面上の「組織設定→振込口座管理」で対象の「編集」に行き、そのURLに含まれるIDを使用してください。例：`https://the-board.jp/company_banks/123456/edit` → 123456
- `name_en` (string): 顧客名（英語表記） ※英語アドオン有効時のみ
- `address_en` (string): 住所（英語表記） ※英語アドオン有効時のみ
- `phone_country_code` (string): 国番号（英語表記） ※英語アドオン有効時のみ
- `currency` (enum(JPY, USD, EUR, GBP, CNY, HKD, TWD, KRW, SGD, AUD, IDR, THB, CAD)): デフォルト通貨 ※英語アドオン有効時のみ
- `lang_kbn` (enum(1, 2)): デフォルト言語 - 1：日本語 - 2：英語 ※英語アドオン有効時のみ
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み

## DELETE /v1/clients/{id}

顧客削除。ID指定で顧客を削除します。

パラメータ:
- `id` (integer): 顧客ID ※顧客登録API・顧客リスト取得APIのレスポンスにある`id`

## GET /v1/client_branches

顧客支社リスト取得。顧客支社リストを取得します。

パラメータ:
- `client_id_eq` (integer): 顧客ID ※顧客登録API・顧客リスト取得APIのレスポンスにある`id`
- `include_archive_flg` (enum(0, 1)): アーカイブを含むか - 0：アーカイブ済みは除く - 1：アーカイブ済みも含む
- `updated_at_gteq` (string): 更新日時（指定日時以降）
- `updated_at_lteq` (string): 更新日時（指定日時以前）
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号

## POST /v1/client_branches

顧客支社登録。顧客支社を新規登録します。

リクエストボディ(JSON):
- `client_id` (integer): (必須) 顧客ID ※顧客登録API・顧客リスト取得APIのレスポンスにある`id`
- `name` (string): (必須) 顧客支社名
- `zip` (string): 郵便番号（ハイフン区切り）
- `pref` (string): 都道府県
- `address1` (string): 市区町村・番地
- `address2` (string): 建物名
- `tel` (string): TEL（ハイフン区切り）
- `fax` (string): FAX（ハイフン区切り）
- `name_en` (string): 顧客支社名（英語表記） ※英語アドオン有効時のみ
- `address_en` (string): 住所（英語表記） ※英語アドオン有効時のみ
- `phone_country_code` (string): 国番号（英語表記） ※英語アドオン有効時のみ
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み

## GET /v1/client_branches/{id}

顧客支社取得。ID指定で顧客支社を取得します。

パラメータ:
- `id` (integer): 顧客支社ID ※顧客支社登録API・顧客支社リスト取得APIのレスポンスにある`id`

## PATCH /v1/client_branches/{id}

顧客支社更新。ID指定で顧客支社を更新します。

パラメータ:
- `id` (integer): 顧客支社ID ※顧客支社登録API・顧客支社リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `client_id` (integer): 顧客ID ※顧客登録API・顧客リスト取得APIのレスポンスにある`id`
- `name` (string): 顧客支社名
- `zip` (string): 郵便番号（ハイフン区切り）
- `pref` (string): 都道府県
- `address1` (string): 市区町村・番地
- `address2` (string): 建物名
- `tel` (string): TEL（ハイフン区切り）
- `fax` (string): FAX（ハイフン区切り）
- `name_en` (string): 顧客支社名（英語表記） ※英語アドオン有効時のみ
- `address_en` (string): 住所（英語表記） ※英語アドオン有効時のみ
- `phone_country_code` (string): 国番号（英語表記） ※英語アドオン有効時のみ
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み

## DELETE /v1/client_branches/{id}

顧客支社削除。ID指定で顧客支社を削除します。

パラメータ:
- `id` (integer): 顧客支社ID ※顧客支社登録API・顧客支社リスト取得APIのレスポンスにある`id`

## GET /v1/contacts

顧客担当者リスト取得。顧客担当者リストを取得します。

パラメータ:
- `client_id_eq` (integer): 顧客ID ※顧客登録API・顧客リスト取得APIのレスポンスにある`id`
- `include_archive_flg` (enum(0, 1)): アーカイブを含むか - 0：アーカイブ済みは除く - 1：アーカイブ済みも含む
- `updated_at_gteq` (string): 更新日時（指定日時以降）
- `updated_at_lteq` (string): 更新日時（指定日時以前）
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号

## POST /v1/contacts

顧客担当者登録。顧客担当者を新規登録します。

リクエストボディ(JSON):
- `client_id` (integer): (必須) 顧客ID ※顧客登録API・顧客リスト取得APIのレスポンスにある`id`
- `last_name` (string): (必須) 姓
- `first_name` (string): 名
- `honorific_title` (string): 敬称
- `title` (string): 肩書
- `department` (string): 部署
- `email` (string): email
- `note` (string): 備考
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み
- `last_name_en` (string): 姓（英語表記） ※英語アドオン有効時のみ
- `first_name_en` (string): 名（英語表記） ※英語アドオン有効時のみ
- `prefix_en` (string): 敬称（英語表記） ※英語アドオン有効時のみ
- `title_en` (string): 肩書（英語表記） ※英語アドオン有効時のみ
- `department_en` (string): 部署（英語表記） ※英語アドオン有効時のみ

## GET /v1/contacts/{id}

顧客担当者取得。ID指定で顧客担当者を取得します。

パラメータ:
- `id` (integer): 顧客担当者ID ※顧客担当者登録API・顧客担当者リスト取得APIのレスポンスにある`id`

## PATCH /v1/contacts/{id}

顧客担当者更新。ID指定で顧客担当者を更新します。

パラメータ:
- `id` (integer): 顧客担当者ID ※顧客担当者登録API・顧客担当者リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `client_id` (integer): 顧客ID ※顧客登録API・顧客リスト取得APIのレスポンスにある`id`
- `last_name` (string): 姓
- `first_name` (string): 名
- `honorific_title` (string): 敬称
- `title` (string): 肩書
- `department` (string): 部署
- `email` (string): email
- `note` (string): 備考
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み
- `last_name_en` (string): 姓（英語表記） ※英語アドオン有効時のみ
- `first_name_en` (string): 名（英語表記） ※英語アドオン有効時のみ
- `prefix_en` (string): 敬称（英語表記） ※英語アドオン有効時のみ
- `title_en` (string): 肩書（英語表記） ※英語アドオン有効時のみ
- `department_en` (string): 部署（英語表記） ※英語アドオン有効時のみ

## DELETE /v1/contacts/{id}

顧客担当者削除。ID指定で顧客担当者を削除します。

パラメータ:
- `id` (integer): 顧客担当者ID ※顧客担当者登録API・顧客担当者リスト取得APIのレスポンスにある`id`

## GET /v1/projects

案件リスト取得。案件リストを取得します。取得結果は新しい順で取得されます。

パラメータ:
- `name_cont` (string): 案件名（部分一致）
- `client_id_eq` (integer): 顧客ID ※顧客登録API・顧客リスト取得APIのレスポンスにある`id`
- `client_name_cont` (string): 顧客名（部分一致）
- `client_name_disp_cont` (string): 顧客略称名（部分一致）
- `order_status_in[]` (string): 受注ステータス - 1：見積中(高) - 2：見積中(中) - 3：見積中(低) - 8：見積中(除) - 4：受注確定 - 5：受注済 - 9：失注 ※複数の場合はカンマ区切り
- `delivery_status_in[]` (string): 進捗状況 - 1：未着手 - 2：着手中 - 3：納品済 - 4：検収済 ※複数の場合はカンマ区切り
- `project_no_eq` (integer): 案件No
- `management_no_eq` (string): 管理番号
- `delivery_date_gteq` (string): 納期（指定日時以降）
- `delivery_date_lteq` (string): 納期（指定日時以前）
- `invoice_date_gteq` (string): 請求日（指定日時以降）
- `invoice_date_lteq` (string): 請求日（指定日時以前）
- `invoice_timing_kbn_in[]` (string): 請求タイミング - 1：一括請求 - 2：定期請求 - 3：分割請求 ※複数の場合はカンマ区切り
- `tags[]` (string): タグ（OR条件、複数の場合はカンマ区切り）
- `created_at_gteq` (string): 作成日時（指定日時以降）
- `created_at_lteq` (string): 作成日時（指定日時以前）
- `updated_at_gteq` (string): 更新日時（指定日時以降）
- `updated_at_lteq` (string): 更新日時（指定日時以前）
- `include_lost_flg` (integer): 失注を含むか - 0：失注は除く - 1：失注も含む
- `include_archive_flg` (enum(0, 1)): アーカイブを含むか - 0：アーカイブ済みは除く - 1：アーカイブ済みも含む
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号
- `response_group` (enum(small, medium, large, estimate, order, delivery, invoice, receipt, project_cost, all)): レスポンスグループ | response_group | 項目 | |:-----------|:------------| | small | id, project_no, management_no, name, client, contact, user, total, tax, estimate_date,…

## POST /v1/projects

案件登録。案件を新規登録します。 請求タイミング（一括請求・定期請求・分割請求）に応じてパラメーターが異なります。 下記のリクエストパラメーターリストの上部にある「共通」「一括請求」「定期請求」「分割請求」のボタンでリクエストパラメーターを切り替えることができます。 「共通」は、全請求タイミングで共通して使用するパラメーターです。「一括請求」「定期請求」「分割請求」は、それぞれの請求タイミング固有のパラメーターです。「共通+一括請求」のように組み合わせて使用してください。

リクエストボディ(JSON):
- `name` (string): (必須) 案件名
- `client_id` (integer): (必須) 顧客ID ※顧客登録API・顧客リスト取得APIのレスポンスにある`id`
- `client_branch_id` (integer): 顧客支社ID ※顧客支社登録API・顧客支社リスト取得APIのレスポンスにある`id`
- `client_name_disp_kbn` (enum(1, 2, 3)): 顧客支社（書類上の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※顧客支社を指定する場合のみ
- `client_name_for_post_disp_kbn` (enum(1, 2, 3)): 顧客支社（郵送時の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※顧客支社を指定する場合のみ
- `contact_id` (integer): 顧客担当者ID ※顧客担当者登録API・顧客担当者リスト取得APIのレスポンスにある`id`
- `company_branch_id` (integer): 自社支社ID ※このIDを取得するAPIはありません。画面上の「組織設定→支社管理」で対象の「編集」に行き、そのURLに含まれるIDを使用してください。例：`https://the-board.jp/company_branches/123456/edit` → 123456
- `company_name_disp_kbn` (enum(1, 2, 3)): 自社支社（書類上の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※自社支社を指定する場合のみ
- `company_name_for_post_disp_kbn` (enum(1, 2, 3)): 自社支社（郵送時の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※自社支社を指定する場合のみ
- `user_id` (integer): (必須) 担当者ID ※ユーザーリスト取得APIのレスポンスにある`id`
- `estimate_date` (string): 見積日 ※新規登録時に未指定の場合は、本日の日付がセットされます
- `delivery_date` (string): 納期
- `delivery_date_text` (string): 納期テキスト
- `payment_term_id` (integer): 支払条件ID - 新規登録時に未指定の場合は「デフォルト支払条件」が使用されます - 支払条件リスト取得APIのレスポンスにある`id`です
- `order_status` (enum(1, 2, 3, 4, 5, 8, 9)): (必須) 受注ステータス - 1：見積中(高) - 2：見積中(中) - 3：見積中(低) - 8：見積中(除) - 4：受注確定 - 5：受注済 - 9：失注
- `delivery_status` (enum(1, 2, 3, 4)): 進捗状況 - 1：未着手 - 2：着手中 - 3：納品済 - 4：検収済
- `invoice_timing_kbn` (enum(1, 2, 3)): (必須) 請求タイミング - 1：一括請求 - 2：定期請求 - 3：分割請求
- `project_type_id` (integer): 案件区分1ID ※案件区分リスト取得APIのレスポンスにある`id`
- `project_type2_id` (integer): 案件区分2ID ※案件区分リスト取得APIのレスポンスにある`id`
- `project_type3_id` (integer): 案件区分3ID ※案件区分リスト取得APIのレスポンスにある`id`
- `group_id` (integer): グループID ※グループリスト取得APIのレスポンスにある`id`
- `tags` (array<string>): タグ ※タグ名の配列
- `accounting_type_id` (integer): 会計区分1ID ※会計区分リスト取得APIのレスポンスにある`id`
- `accounting_type2_id` (integer): 会計区分2ID ※会計区分リスト取得APIのレスポンスにある`id`
- `accounting_type3_id` (integer): 会計区分3ID ※会計区分リスト取得APIのレスポンスにある`id`
- `in_house_memo` (string): 社内メモ
- `management_no` (string): 管理番号
- `ordered_date` (string): 受注日
- `payment_method_kbn` (enum(1, 2, 3, 4, 5, 6, 7)): 支払方法 - 1：銀行振込 - 2：口座振替 - 3：クレジットカード - 4：現金支払 - 5：代金引換 - 6：コンビニ支払 - 7：郵便振替
- `tax_rule_kbn` (enum(1, 2, 3)): 端数処理 - 1：四捨五入 - 2：切り捨て - 3：切り上げ ※デフォルトはアカウントの端数処理設定による
- `to` (string): TO（メールアドレス） ※複数指定する場合はカンマ区切り
- `cc` (string): CC（メールアドレス） ※複数指定する場合はカンマ区切り
- `wareki_flg` (enum(0, 1)): 和暦表示 - 0：西暦 - 1：和暦 ※「和暦表示」機能有効時のみ
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み
- `reduced_tax_rate_kbn` (enum(1, 2)): 軽減税率 - 1：対象外 - 2：対象 ※「軽減税率」機能有効時のみ
- `document_setting_id` (integer): 書類詳細設定ID ※このIDを取得するAPIはありません。画面上の「設定→書類詳細設定」で対象の「編集」に行き、そのURLに含まれるIDを使用してください。例：`https://the-board.jp/document_settings/123456/edit` → 123456
- `currency` (enum(JPY, USD, EUR, GBP, CNY, HKD, TWD, KRW, SGD, AUD, IDR, THB, CAD)): 通貨 ※英語アドオン有効時のみ
- `lang_kbn` (enum(1, 2)): 言語 - 1：日本語 - 2：英語 ※英語アドオン有効時のみ
- `exchange_rate` (string): 為替レート ※英語アドオン有効時のみ
- `invoice_date` (string): (必須) 請求日 ※一括請求用
- `contract_start_date` (string): (必須) 請求開始日 ※定期請求用
- `contract_end_date` (string): (必須) 請求終了日 ※定期請求用
- `periodical_invoice_interval` (enum(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)): 請求間隔 ※定期請求用
- `periodical_invoice_payment_kbn` (enum(1, 2)): 請求間隔内の請求時期 - 1：請求間隔の最初の月 - 2：請求間隔の最後の月 ※定期請求用
- `contract_end_alert_flg` (enum(0, 1)): 通知対象 - 0：通知しない - 1：通知する ※定期請求用
- `auto_renewal_flg` (enum(0, 1)): 自動契約更新 - 0：OFF - 1：ON ※定期請求用
- `auto_renewal_period_month` (enum(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)): 自動契約更新期間（月数） ※定期請求用
- `monthly_invoice_payment_kbn` (enum(1, 2, 3)): 自動挿入メッセージ年月 - 1：請求月 - 2：請求月の翌月 - 3：請求月の前月 ※定期請求用
- `delivery_document_kbn` (enum(1, 2)): 納品書・検収書の枚数 - 1：1枚 - 2：請求回数と同じ ※定期請求・分割請求用<br> ※複数納品書対応ON時のみ
- `invoice_dates` (array<string>): (必須) 請求日（`YYYY-MM-DD`形式の日付）の配列

## GET /v1/projects/{id}

案件取得。案件ID指定で案件を取得します。

パラメータ:
- `id` (integer): 案件ID ※案件登録API・案件リスト取得APIのレスポンスにある`id`
- `response_group` (enum(small, medium, large, estimate, order, delivery, invoice, receipt, project_cost, all)): レスポンスグループ | response_group | 項目 | |:-----------|:------------| | small | id, project_no, management_no, name, client, contact, user, total, tax, estimate_date,…

## PATCH /v1/projects/{id}

案件更新。案件ID指定で案件を更新します。 <strong>分割請求に関する注意事項</strong><br> 現在、API経由での`invoice_dates`の更新（請求日・請求回数の変更）には対応していません。

パラメータ:
- `id` (integer): 案件ID ※案件登録API・案件リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `name` (string): 案件名
- `client_id` (integer): 顧客ID ※顧客登録API・顧客リスト取得APIのレスポンスにある`id`
- `client_branch_id` (integer): 顧客支社ID ※顧客支社登録API・顧客支社リスト取得APIのレスポンスにある`id`
- `client_name_disp_kbn` (enum(1, 2, 3)): 顧客支社（書類上の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※顧客支社を指定する場合のみ
- `client_name_for_post_disp_kbn` (enum(1, 2, 3)): 顧客支社（郵送時の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※顧客支社を指定する場合のみ
- `contact_id` (integer): 顧客担当者ID ※顧客担当者登録API・顧客担当者リスト取得APIのレスポンスにある`id`
- `company_branch_id` (integer): 自社支社ID ※このIDを取得するAPIはありません。画面上の「組織設定→支社管理」で対象の「編集」に行き、そのURLに含まれるIDを使用してください。例：`https://the-board.jp/company_branches/123456/edit` → 123456
- `company_name_disp_kbn` (enum(1, 2, 3)): 自社支社（書類上の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※自社支社を指定する場合のみ
- `company_name_for_post_disp_kbn` (enum(1, 2, 3)): 自社支社（郵送時の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※自社支社を指定する場合のみ
- `user_id` (integer): 担当者ID ※ユーザーリスト取得APIのレスポンスにある`id`
- `estimate_date` (string): 見積日 ※新規登録時に未指定の場合は、本日の日付がセットされます
- `delivery_date` (string): 納期
- `delivery_date_text` (string): 納期テキスト
- `payment_term_id` (integer): 支払条件ID - 新規登録時に未指定の場合は「デフォルト支払条件」が使用されます - 支払条件リスト取得APIのレスポンスにある`id`です
- `order_status` (enum(1, 2, 3, 4, 5, 8, 9)): 受注ステータス - 1：見積中(高) - 2：見積中(中) - 3：見積中(低) - 8：見積中(除) - 4：受注確定 - 5：受注済 - 9：失注
- `delivery_status` (enum(1, 2, 3, 4)): 進捗状況 - 1：未着手 - 2：着手中 - 3：納品済 - 4：検収済
- `invoice_timing_kbn` (enum(1, 2, 3)): 請求タイミング - 1：一括請求 - 2：定期請求 - 3：分割請求
- `project_type_id` (integer): 案件区分1ID ※案件区分リスト取得APIのレスポンスにある`id`
- `project_type2_id` (integer): 案件区分2ID ※案件区分リスト取得APIのレスポンスにある`id`
- `project_type3_id` (integer): 案件区分3ID ※案件区分リスト取得APIのレスポンスにある`id`
- `group_id` (integer): グループID ※グループリスト取得APIのレスポンスにある`id`
- `tags` (array<string>): タグ ※タグ名の配列
- `accounting_type_id` (integer): 会計区分1ID ※会計区分リスト取得APIのレスポンスにある`id`
- `accounting_type2_id` (integer): 会計区分2ID ※会計区分リスト取得APIのレスポンスにある`id`
- `accounting_type3_id` (integer): 会計区分3ID ※会計区分リスト取得APIのレスポンスにある`id`
- `in_house_memo` (string): 社内メモ
- `management_no` (string): 管理番号
- `ordered_date` (string): 受注日
- `payment_method_kbn` (enum(1, 2, 3, 4, 5, 6, 7)): 支払方法 - 1：銀行振込 - 2：口座振替 - 3：クレジットカード - 4：現金支払 - 5：代金引換 - 6：コンビニ支払 - 7：郵便振替
- `tax_rule_kbn` (enum(1, 2, 3)): 端数処理 - 1：四捨五入 - 2：切り捨て - 3：切り上げ ※デフォルトはアカウントの端数処理設定による
- `to` (string): TO（メールアドレス） ※複数指定する場合はカンマ区切り
- `cc` (string): CC（メールアドレス） ※複数指定する場合はカンマ区切り
- `wareki_flg` (enum(0, 1)): 和暦表示 - 0：西暦 - 1：和暦 ※「和暦表示」機能有効時のみ
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み
- `reduced_tax_rate_kbn` (enum(1, 2)): 軽減税率 - 1：対象外 - 2：対象 ※「軽減税率」機能有効時のみ
- `document_setting_id` (integer): 書類詳細設定ID ※このIDを取得するAPIはありません。画面上の「設定→書類詳細設定」で対象の「編集」に行き、そのURLに含まれるIDを使用してください。例：`https://the-board.jp/document_settings/123456/edit` → 123456
- `currency` (enum(JPY, USD, EUR, GBP, CNY, HKD, TWD, KRW, SGD, AUD, IDR, THB, CAD)): 通貨 ※英語アドオン有効時のみ
- `lang_kbn` (enum(1, 2)): 言語 - 1：日本語 - 2：英語 ※英語アドオン有効時のみ
- `exchange_rate` (string): 為替レート ※英語アドオン有効時のみ
- `invoice_date` (string): 請求日 ※一括請求用
- `contract_start_date` (string): 請求開始日 ※定期請求用
- `contract_end_date` (string): 請求終了日 ※定期請求用
- `periodical_invoice_interval` (enum(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)): 請求間隔 ※定期請求用
- `periodical_invoice_payment_kbn` (enum(1, 2)): 請求間隔内の請求時期 - 1：請求間隔の最初の月 - 2：請求間隔の最後の月 ※定期請求用
- `contract_end_alert_flg` (enum(0, 1)): 通知対象 - 0：通知しない - 1：通知する ※定期請求用
- `auto_renewal_flg` (enum(0, 1)): 自動契約更新 - 0：OFF - 1：ON ※定期請求用
- `auto_renewal_period_month` (enum(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)): 自動契約更新期間（月数） ※定期請求用
- `monthly_invoice_payment_kbn` (enum(1, 2, 3)): 自動挿入メッセージ年月 - 1：請求月 - 2：請求月の翌月 - 3：請求月の前月 ※定期請求用
- `delivery_document_kbn` (enum(1, 2)): 納品書・検収書の枚数 - 1：1枚 - 2：請求回数と同じ ※定期請求・分割請求用<br> ※複数納品書対応ON時のみ

## DELETE /v1/projects/{id}

案件削除。案件ID指定で案件を削除します。

パラメータ:
- `id` (integer): 案件ID ※案件登録API・案件リスト取得APIのレスポンスにある`id`

## GET /v1/project_costs

案件原価リスト取得。案件原価リストを取得します。

パラメータ:
- `project_id_eq` (integer): 案件ID ※案件登録API・案件リスト取得APIのレスポンスにある`id`
- `created_at_gteq` (string): 作成日時（指定日時以降）
- `created_at_lteq` (string): 作成日時（指定日時以前）
- `invoice_date_gteq` (string): 請求日（指定日時以降）
- `invoice_date_lteq` (string): 請求日（指定日以前）
- `payment_date_gteq` (string): 支払日（指定日時以降）
- `payment_date_lteq` (string): 支払日（指定日以前）
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号

## POST /v1/project_costs

案件原価登録。案件原価を新規登録します。

リクエストボディ(JSON):
- `project_id` (integer): (必須) 案件ID ※案件登録API・案件リスト取得APIのレスポンスにある`id`
- `description` (string): (必須) 費用の説明
- `cost` (integer): (必須) 金額
- `invoice_date` (string): (必須) 請求日
- `payment_date` (string): (必須) 支払日

## GET /v1/project_costs/{id}

案件原価取得。ID指定で案件原価を取得します。

パラメータ:
- `id` (integer): 案件原価ID ※案件原価登録API・案件原価リスト取得APIのレスポンスにある`id`

## PATCH /v1/project_costs/{id}

案件原価更新。ID指定で案件原価を更新します。

パラメータ:
- `id` (integer): 案件原価ID ※案件原価登録API・案件原価リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `project_id` (integer): 案件ID ※案件登録API・案件リスト取得APIのレスポンスにある`id`
- `description` (string): 費用の説明
- `cost` (integer): 金額
- `invoice_date` (string): 請求日
- `payment_date` (string): 支払日

## DELETE /v1/project_costs/{id}

案件原価削除。ID指定で案件原価を削除します。

パラメータ:
- `id` (integer): 案件原価ID ※案件原価登録API・案件原価リスト取得APIのレスポンスにある`id`

## PATCH /v1/projects/order_status/{id}

受注ステータス変更。案件ID指定で受注ステータスを変更します。

パラメータ:
- `id` (integer): 案件ID ※案件登録API・案件リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `order_status` (enum(1, 2, 3, 4, 5, 8, 9)): (必須) 受注ステータス - 1：見積中(高) - 2：見積中(中) - 3：見積中(低) - 8：見積中(除) - 4：受注確定 - 5：受注済 - 9：失注

## PATCH /v1/projects/lock_flg/{id}

案件のロック。案件ID指定で案件情報をロック・ロック解除します。

パラメータ:
- `id` (integer): 案件ID ※案件登録API・案件リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `lock_flg` (enum(0, 1)): (必須) ロックフラグ - 0：未ロック - 1：ロック済み

## GET /v1/invoices

請求リスト取得。請求リストを取得します。

パラメータ:
- `invoice_date_gteq` (string): 請求日（指定日以降）
- `invoice_date_lteq` (string): 請求日（指定日以前）
- `invoice_payment_limit_date_gteq` (string): 支払期限（指定日以降）
- `invoice_payment_limit_date_lteq` (string): 支払期限（指定日以前）
- `project_order_status_in[]` (string): 受注ステータス - 1：見積中(高) - 2：見積中(中) - 3：見積中(低) - 8：見積中(除) - 4：受注確定 - 5：受注済 - 9：失注 ※複数の場合はカンマ区切り
- `invoice_status_in[]` (string): 請求ステータス - 1：未請求 - 4：請求OK - 2：請求済 - 5：一部入金済 - 3：入金済 - 9：回収不能 ※複数の場合はカンマ区切り
- `project_project_no_eq` (integer): 案件No
- `project_management_no_eq` (string): 管理番号
- `project_name_cont` (string): 案件名（部分一致）
- `project_client_id_eq` (integer): 顧客ID ※顧客登録API・顧客リスト取得APIのレスポンスにある`id`
- `project_client_name_cont` (string): 顧客名（部分一致）
- `project_client_name_disp_cont` (string): 顧客略称名（部分一致）
- `project_tags[]` (string): タグ（OR条件、複数の場合はカンマ区切り）
- `updated_at_gteq` (string): 更新日時（指定日時以降）
- `updated_at_lteq` (string): 更新日時（指定日時以前）
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号
- `response_group` (enum(small, medium, large, estimate, order, delivery, invoice, receipt, project_cost, all)): レスポンスグループ | response_group | 項目 | |:-----------|:------------| | small | id, project_id, project_no, management_no, name, client, contact, user, total, tax, co…

## PATCH /v1/invoices/invoice_status/{id}

請求ステータス変更。請求ID指定で請求ステータスを変更します。

パラメータ:
- `id` (integer): 請求ID ※請求リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `invoice_status` (enum(1, 2, 3, 4, 5, 9)): (必須) 請求ステータス - 1：未請求 - 4：請求OK - 2：請求済 - 5：一部入金済 - 3：入金済 - 9：回収不能

## GET /v1/documents/estimates/{id}

見積書取得。ID指定で見積書を取得します。

パラメータ:
- `id` (integer): 見積書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`estimate`内の`id`（要レスポンスグループ指定）

## PATCH /v1/documents/estimates/{id}

見積書更新。ID指定で見積書を更新します。

パラメータ:
- `id` (integer): 見積書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`estimate`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `valid_period` (string): 有効期限
- `message` (string): 備考
- `total` (string): 小計 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax` (string): 消費税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax_withholding` (string): 源泉所得税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `document_amount_disp_kbn` (enum(1, 2, 3, 4)): 金額表示 - 1：税込表示 - 2：合計欄を税抜表示＋明細下の小計・消費税行非表示 - 3：合計欄のみ税抜表示 - 4：合計表示なし ※デフォルトは「デフォルト設定」によって決まります
- `delivery_place` (string): 納品場所
- `details` (array<object>): 明細行
- `blank_date_flg` (enum(0, 1)): 見積日空欄 - 0：表示 - 1：空欄にする

## PATCH /v1/documents/estimates/lock_flg/{id}

見積書ロック。ID指定で見積書のロック状態を変更します。

パラメータ:
- `id` (integer): 見積書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`estimate`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `lock_flg` (enum(0, 1)): ロックフラグ - 0：未ロック - 1：ロック済み

## GET /v1/documents/orders/{id}

発注書取得。ID指定で発注書を取得します。

パラメータ:
- `id` (integer): 発注書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`order`内の`id`（要レスポンスグループ指定）

## PATCH /v1/documents/orders/{id}

発注書更新。ID指定で発注書を更新します。

パラメータ:
- `id` (integer): 発注書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`order`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `message` (string): 備考
- `total` (string): 小計 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax` (string): 消費税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax_withholding` (string): 源泉所得税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `document_amount_disp_kbn` (enum(1, 2, 3, 4)): 金額表示 - 1：税込表示 - 2：合計欄を税抜表示＋明細下の小計・消費税行非表示 - 3：合計欄のみ税抜表示 - 4：合計表示なし ※デフォルトは「デフォルト設定」によって決まります
- `delivery_place` (string): 納品場所
- `details` (array<object>): 明細行
- `disp_order_date` (string): 発注日（表示設定）
- `disp_order_receive_date` (string): 発注請日（表示設定）
- `blank_date_flg` (enum(0, 1)): 発注請日空欄 - 0：表示 - 1：空欄にする

## PATCH /v1/documents/orders/lock_flg/{id}

発注書ロック。ID指定で発注書のロック状態を変更します。

パラメータ:
- `id` (integer): 発注書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`order`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `lock_flg` (enum(0, 1)): ロックフラグ - 0：未ロック - 1：ロック済み

## GET /v1/documents/deliveries/{id}

納品書取得。ID指定で納品書を取得します。

パラメータ:
- `id` (integer): 納品書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`deliveries`内の`id`（要レスポンスグループ指定）

## PATCH /v1/documents/deliveries/{id}

納品書更新。ID指定で納品書を更新します。

パラメータ:
- `id` (integer): 納品書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`deliveries`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `message` (string): 備考
- `total` (string): 小計 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax` (string): 消費税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax_withholding` (string): 源泉所得税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `document_amount_disp_kbn` (enum(1, 2, 3, 4)): 金額表示 - 1：税込表示 - 2：合計欄を税抜表示＋明細下の小計・消費税行非表示 - 3：合計欄のみ税抜表示 - 4：合計表示なし ※デフォルトは「デフォルト設定」によって決まります
- `delivery_place` (string): 納品場所
- `details` (array<object>): 明細行
- `delivery_date` (string): 納品日
- `disp_delivery_date` (string): 納品日（表示設定）
- `disp_delivery_receive_date` (string): 検収日（表示設定）
- `blank_date_flg` (enum(0, 1)): 納品日空欄 - 0：表示 - 1：空欄にする

## PATCH /v1/documents/deliveries/lock_flg/{id}

納品書ロック。ID指定で納品書のロック状態を変更します。

パラメータ:
- `id` (integer): 納品書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`deliveries`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `lock_flg` (enum(0, 1)): ロックフラグ - 0：未ロック - 1：ロック済み

## GET /v1/documents/invoices/{id}

請求書取得。ID指定で請求書を取得します。

パラメータ:
- `id` (integer): 請求書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`invoices`内の`id`（要レスポンスグループ指定）

## PATCH /v1/documents/invoices/{id}

請求書更新。ID指定で請求書を更新します。

パラメータ:
- `id` (integer): 請求書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`invoices`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `message` (string): 備考
- `total` (string): 小計 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax` (string): 消費税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax_withholding` (string): 源泉所得税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `document_amount_disp_kbn` (enum(1, 2, 3, 4)): 金額表示 - 1：税込表示 - 2：合計欄を税抜表示＋明細下の小計・消費税行非表示 - 3：合計欄のみ税抜表示 - 4：合計表示なし ※デフォルトは「デフォルト設定」によって決まります
- `delivery_place` (string): 納品場所
- `details` (array<object>): 明細行
- `disp_invoice_date` (string): 請求日（表示設定）
- `blank_date_flg` (enum(0, 1)): 請求日空欄 - 0：表示 - 1：空欄にする
- `multi_bank_info_flg` (enum(0, 1)): 複数口座表示 - 0：OFF - 1：ON ※デフォルトは設定による

## PATCH /v1/documents/invoices/lock_flg/{id}

請求書ロック。ID指定で請求書のロック状態を変更します。

パラメータ:
- `id` (integer): 請求書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`invoices`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `lock_flg` (enum(0, 1)): ロックフラグ - 0：未ロック - 1：ロック済み

## GET /v1/documents/receipts/{id}

領収書取得。ID指定で領収書を取得します。

パラメータ:
- `id` (integer): 領収書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`receipts`内の`id`（要レスポンスグループ指定）

## PATCH /v1/documents/receipts/{id}

領収書更新。ID指定で領収書を更新します。

パラメータ:
- `id` (integer): 領収書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`receipts`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `message` (string): 備考
- `total` (string): 小計 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax` (string): 消費税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax_withholding` (string): 源泉所得税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `document_amount_disp_kbn` (enum(1, 2, 3, 4)): 金額表示 - 1：税込表示 - 2：合計欄を税抜表示＋明細下の小計・消費税行非表示 - 3：合計欄のみ税抜表示 - 4：合計表示なし ※デフォルトは「デフォルト設定」によって決まります
- `delivery_place` (string): 納品場所
- `details` (array<object>): 明細行
- `disp_receipt_date` (string): 発行日（表示設定）
- `blank_date_flg` (enum(0, 1)): 発行日空欄 - 0：表示 - 1：空欄にする

## PATCH /v1/documents/receipts/lock_flg/{id}

領収書ロック。ID指定で領収書のロック状態を変更します。

パラメータ:
- `id` (integer): 領収書ID ※案件登録API・案件リスト取得API・案件取得APIのレスポンスにある`receipts`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `lock_flg` (enum(0, 1)): ロックフラグ - 0：未ロック - 1：ロック済み

## GET /v1/payees

発注先リスト取得。発注先リストを取得します。

パラメータ:
- `name_cont` (string): 発注先名（部分一致）
- `name_disp_cont` (string): 発注先略称名（部分一致）
- `invoice_system_number_eq` (string): 適格請求書発行事業者の登録番号
- `tags[]` (string): タグ（複数の場合はカンマ区切り）
- `include_archive_flg` (enum(0, 1)): アーカイブを含むか - 0：アーカイブ済みは除く - 1：アーカイブ済みも含む
- `updated_at_gteq` (string): 更新日時（指定日時以降）
- `updated_at_lteq` (string): 更新日時（指定日時以前）
- `custom_no_eq` (string): 発注先番号
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号
- `response_group` (enum(small, large)): レスポンスグループ | response_group | 項目 | |:-----------|:------------| | small | id, name, name_disp, title, zip, pref, address1, address2, tel, fax, payment_term_id, …

## POST /v1/payees

発注先登録。発注先を新規登録します。

リクエストボディ(JSON):
- `name` (string): (必須) 発注先名
- `name_disp` (string): (必須) 発注先略称名
- `zip` (string): 郵便番号（ハイフン区切り）
- `pref` (string): 都道府県
- `address1` (string): 市区町村・番地
- `address2` (string): 建物名
- `tel` (string): TEL（ハイフン区切り）
- `fax` (string): FAX（ハイフン区切り）
- `title` (string): 敬称
- `payment_term_id` (integer): デフォルト支払条件ID - 新規登録時に未指定の場合は最初の支払条件が使用されます - 支払条件リスト取得APIのレスポンスにある`id`です
- `nda_flg` (enum(0, 1)): NDA締結 - 0：未 - 1：済
- `basic_agreement_flg` (enum(0, 1)): 基本契約書締結 - 0：未 - 1：済
- `document_send_type` (integer): 書類送付方法 - 1：メール(DL) - 2：郵送 - 3：メール(DL)+郵送 - 4：メール(添付) - 5：メール(添付)+郵送 - またはカスタム書類送付方法のID
- `note` (string): 備考
- `tags` (array<string>): タグ ※タグ名の配列
- `wareki_flg` (enum(0, 1)): デフォルト和暦表示 - 0：西暦 - 1：和暦 ※「和暦表示」機能有効時のみ
- `company_number` (string): 法人番号
- `accounting_code` (string): 会計用名称・コード ※「会計連携機能」機能有効時のみ
- `to` (string): TO（メールアドレス） ※複数指定する場合はカンマ区切り
- `cc` (string): CC（メールアドレス） ※複数指定する場合はカンマ区切り
- `invoice_system_number` (string): 適格請求書発行事業者の登録番号
- `invoice_system_issuer_type` (enum(0, 1, 2)): 適格請求書発行事業者 - 0：未設定 - 1：該当する - 2：該当しない
- `bank_charge_to_client_flg` (enum(0, 1)): 振込手数料負担 - 0：当方 - 1：先方
- `tax_withholding_kbn` (enum(1, 2, 3)): デフォルト源泉徴収 - 1：なし - 2：源泉徴収（復興特別所得税あり） - 3：源泉徴収（復興特別所得税なし）
- `custom_no` (string): 発注先番号
- `name_en` (string): 発注先名（英語表記） ※英語アドオン有効時のみ
- `address_en` (string): 住所（英語表記） ※英語アドオン有効時のみ
- `phone_country_code` (string): 国番号（英語表記） ※英語アドオン有効時のみ
- `currency` (enum(JPY, USD, EUR, GBP, CNY, HKD, TWD, KRW, SGD, AUD, IDR, THB, CAD)): デフォルト通貨 ※英語アドオン有効時のみ
- `lang_kbn` (enum(1, 2)): デフォルト言語 - 1：日本語 - 2：英語 ※英語アドオン有効時のみ
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み

## GET /v1/payees/{id}

発注先取得。ID指定で発注先を取得します。

パラメータ:
- `id` (integer): 発注先ID ※発注先登録API・発注先リスト取得APIのレスポンスにある`id`

## PATCH /v1/payees/{id}

発注先更新。ID指定で発注先を更新します。

パラメータ:
- `id` (integer): 発注先ID ※発注先登録API・発注先リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `name` (string): 発注先名
- `name_disp` (string): 発注先略称名
- `zip` (string): 郵便番号（ハイフン区切り）
- `pref` (string): 都道府県
- `address1` (string): 市区町村・番地
- `address2` (string): 建物名
- `tel` (string): TEL（ハイフン区切り）
- `fax` (string): FAX（ハイフン区切り）
- `title` (string): 敬称
- `payment_term_id` (integer): デフォルト支払条件ID - 新規登録時に未指定の場合は最初の支払条件が使用されます - 支払条件リスト取得APIのレスポンスにある`id`です
- `nda_flg` (enum(0, 1)): NDA締結 - 0：未 - 1：済
- `basic_agreement_flg` (enum(0, 1)): 基本契約書締結 - 0：未 - 1：済
- `document_send_type` (integer): 書類送付方法 - 1：メール(DL) - 2：郵送 - 3：メール(DL)+郵送 - 4：メール(添付) - 5：メール(添付)+郵送 - またはカスタム書類送付方法のID
- `note` (string): 備考
- `tags` (array<string>): タグ ※タグ名の配列
- `wareki_flg` (enum(0, 1)): デフォルト和暦表示 - 0：西暦 - 1：和暦 ※「和暦表示」機能有効時のみ
- `company_number` (string): 法人番号
- `accounting_code` (string): 会計用名称・コード ※「会計連携機能」機能有効時のみ
- `to` (string): TO（メールアドレス） ※複数指定する場合はカンマ区切り
- `cc` (string): CC（メールアドレス） ※複数指定する場合はカンマ区切り
- `invoice_system_number` (string): 適格請求書発行事業者の登録番号
- `invoice_system_issuer_type` (enum(0, 1, 2)): 適格請求書発行事業者 - 0：未設定 - 1：該当する - 2：該当しない
- `bank_charge_to_client_flg` (enum(0, 1)): 振込手数料負担 - 0：当方 - 1：先方
- `tax_withholding_kbn` (enum(1, 2, 3)): デフォルト源泉徴収 - 1：なし - 2：源泉徴収（復興特別所得税あり） - 3：源泉徴収（復興特別所得税なし）
- `custom_no` (string): 発注先番号
- `name_en` (string): 発注先名（英語表記） ※英語アドオン有効時のみ
- `address_en` (string): 住所（英語表記） ※英語アドオン有効時のみ
- `phone_country_code` (string): 国番号（英語表記） ※英語アドオン有効時のみ
- `currency` (enum(JPY, USD, EUR, GBP, CNY, HKD, TWD, KRW, SGD, AUD, IDR, THB, CAD)): デフォルト通貨 ※英語アドオン有効時のみ
- `lang_kbn` (enum(1, 2)): デフォルト言語 - 1：日本語 - 2：英語 ※英語アドオン有効時のみ
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み

## DELETE /v1/payees/{id}

発注先削除。ID指定で発注先を削除します。

パラメータ:
- `id` (integer): 発注先ID ※発注先登録API・発注先リスト取得APIのレスポンスにある`id`

## GET /v1/payee_branches

発注先支社リスト取得。発注先支社リストを取得します。

パラメータ:
- `payee_id_eq` (integer): 発注先ID ※発注先登録API・発注先リスト取得APIのレスポンスにある`id`
- `include_archive_flg` (enum(0, 1)): アーカイブを含むか - 0：アーカイブ済みは除く - 1：アーカイブ済みも含む
- `updated_at_gteq` (string): 更新日時（指定日時以降）
- `updated_at_lteq` (string): 更新日時（指定日時以前）
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号

## POST /v1/payee_branches

発注先支社登録。発注先支社を新規登録します。

リクエストボディ(JSON):
- `payee_id` (integer): (必須) 発注先ID ※発注先登録API・発注先リスト取得APIのレスポンスにある`id`
- `name` (string): (必須) 発注先支社名
- `zip` (string): 郵便番号（ハイフン区切り）
- `pref` (string): 都道府県
- `address1` (string): 市区町村・番地
- `address2` (string): 建物名
- `tel` (string): TEL（ハイフン区切り）
- `fax` (string): FAX（ハイフン区切り）
- `name_en` (string): 発注先支社名（英語表記） ※英語アドオン有効時のみ
- `address_en` (string): 住所（英語表記） ※英語アドオン有効時のみ
- `phone_country_code` (string): 国番号（英語表記） ※英語アドオン有効時のみ
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み

## GET /v1/payee_branches/{id}

発注先支社取得。ID指定で発注先支社を取得します。

パラメータ:
- `id` (integer): 発注先支社ID ※発注先支社登録API・発注先支社リスト取得APIのレスポンスにある`id`

## PATCH /v1/payee_branches/{id}

発注先支社更新。ID指定で発注先支社を更新します。

パラメータ:
- `id` (integer): 発注先支社ID ※発注先支社登録API・発注先支社リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `payee_id` (integer): 発注先ID ※発注先登録API・発注先リスト取得APIのレスポンスにある`id`
- `name` (string): 発注先支社名
- `zip` (string): 郵便番号（ハイフン区切り）
- `pref` (string): 都道府県
- `address1` (string): 市区町村・番地
- `address2` (string): 建物名
- `tel` (string): TEL（ハイフン区切り）
- `fax` (string): FAX（ハイフン区切り）
- `name_en` (string): 発注先支社名（英語表記） ※英語アドオン有効時のみ
- `address_en` (string): 住所（英語表記） ※英語アドオン有効時のみ
- `phone_country_code` (string): 国番号（英語表記） ※英語アドオン有効時のみ
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み

## DELETE /v1/payee_branches/{id}

発注先支社削除。ID指定で発注先支社を削除します。

パラメータ:
- `id` (integer): 発注先支社ID ※発注先支社登録API・発注先支社リスト取得APIのレスポンスにある`id`

## GET /v1/payee_contacts

発注先担当者リスト取得。発注先担当者リストを取得します。

パラメータ:
- `payee_id_eq` (integer): 発注先ID ※発注先登録API・発注先リスト取得APIのレスポンスにある`id`
- `include_archive_flg` (enum(0, 1)): アーカイブを含むか - 0：アーカイブ済みは除く - 1：アーカイブ済みも含む
- `updated_at_gteq` (string): 更新日時（指定日時以降）
- `updated_at_lteq` (string): 更新日時（指定日時以前）
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号

## POST /v1/payee_contacts

発注先担当者登録。発注先担当者を新規登録します。

リクエストボディ(JSON):
- `payee_id` (integer): (必須) 発注先ID ※発注先登録API・発注先リスト取得APIのレスポンスにある`id`
- `last_name` (string): (必須) 姓
- `first_name` (string): 名
- `honorific_title` (string): 敬称
- `title` (string): 肩書
- `department` (string): 部署
- `email` (string): email
- `note` (string): 備考
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み
- `last_name_en` (string): 姓（英語表記） ※英語アドオン有効時のみ
- `first_name_en` (string): 名（英語表記） ※英語アドオン有効時のみ
- `prefix_en` (string): 敬称（英語表記） ※英語アドオン有効時のみ
- `title_en` (string): 肩書（英語表記） ※英語アドオン有効時のみ
- `department_en` (string): 部署（英語表記） ※英語アドオン有効時のみ

## GET /v1/payee_contacts/{id}

発注先担当者取得。ID指定で発注先担当者を取得します。

パラメータ:
- `id` (integer): 発注先担当者ID ※発注先担当者登録API・発注先担当者リスト取得APIのレスポンスにある`id`

## PATCH /v1/payee_contacts/{id}

発注先担当者更新。ID指定で発注先担当者を更新します。

パラメータ:
- `id` (integer): 発注先担当者ID ※発注先担当者登録API・発注先担当者リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `payee_id` (integer): 発注先ID ※発注先登録API・発注先リスト取得APIのレスポンスにある`id`
- `last_name` (string): 姓
- `first_name` (string): 名
- `honorific_title` (string): 敬称
- `title` (string): 肩書
- `department` (string): 部署
- `email` (string): email
- `note` (string): 備考
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み
- `last_name_en` (string): 姓（英語表記） ※英語アドオン有効時のみ
- `first_name_en` (string): 名（英語表記） ※英語アドオン有効時のみ
- `prefix_en` (string): 敬称（英語表記） ※英語アドオン有効時のみ
- `title_en` (string): 肩書（英語表記） ※英語アドオン有効時のみ
- `department_en` (string): 部署（英語表記） ※英語アドオン有効時のみ

## DELETE /v1/payee_contacts/{id}

発注先担当者削除。ID指定で発注先担当者を削除します。

パラメータ:
- `id` (integer): 発注先担当者ID ※発注先担当者登録API・発注先担当者リスト取得APIのレスポンスにある`id`

## GET /v1/expenditures

発注リスト取得。発注リストを取得します。取得結果は新しい順で取得されます。

パラメータ:
- `name_cont` (string): 発注名（部分一致）
- `payee_id_eq` (integer): 発注先ID ※発注先登録API・発注先リスト取得APIのレスポンスにある`id`
- `payee_name_cont` (string): 発注先名（部分一致）
- `payee_name_disp_cont` (string): 発注先略称名（部分一致）
- `expenditure_status_in[]` (string): 発注ステータス - 1：見積中(高) - 2：見積中(中) - 3：見積中(低) - 8：見積中(除) - 4：発注確定 - 5：発注済 - 9：見送り ※複数の場合はカンマ区切り
- `delivery_status_in[]` (string): 進捗状況 - 1：未着手 - 2：着手中 - 3：納品済 - 4：検収済 ※複数の場合はカンマ区切り
- `expenditure_no_eq` (integer): 発注No
- `management_no_eq` (string): 管理番号
- `tags[]` (string): タグ（OR条件、複数の場合はカンマ区切り）
- `project_id_eq` (integer): 関連案件ID ※案件登録API・案件リスト取得APIのレスポンスにある`id`
- `created_at_gteq` (string): 作成日時（指定日時以降）
- `created_at_lteq` (string): 作成日時（指定日時以前）
- `updated_at_gteq` (string): 更新日時（指定日時以降）
- `updated_at_lteq` (string): 更新日時（指定日時以前）
- `include_not_ordered_flg` (integer): 見送りステータスを含むか - 0：見送りは除く - 1：見送りも含む
- `include_archive_flg` (enum(0, 1)): アーカイブを含むか - 0：アーカイブ済みは除く - 1：アーカイブ済みも含む
- `expenditure_order_order_date_gteq` (string): 発注日（指定日以降）
- `expenditure_order_order_date_lteq` (string): 発注日（指定日以前）
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号
- `response_group` (enum(small, medium, large, estimate, order, delivery, invoice, all)): レスポンスグループ | response_group | 項目 | |:-----------|:------------| | small | id, expenditure_no, management_no, name, payee, payee_contact, user, total, tax, tax_w…

## POST /v1/expenditures

発注登録。発注を新規登録します。 支払タイミング（一括支払・定期支払・分割支払）に応じてパラメーターが異なります。 下記のリクエストパラメーターリストの上部にある「共通」「一括支払」「定期支払」「分割支払」のボタンでリクエストパラメーターを切り替えることができます。 「共通」は、全支払タイミングで共通して使用するパラメーターです。「一括支払」「定期支払」「分割支払」は、それぞれの支払タイミング固有のパラメーターです。「共通+一括支払」のように組み合わせて使用してください。

リクエストボディ(JSON):
- `name` (string): (必須) 発注名
- `payee_id` (integer): (必須) 発注先ID ※発注先登録API・発注先リスト取得APIのレスポンスにある`id`
- `payee_branch_id` (integer): 発注先支社ID ※発注先支社登録API・発注先支社リスト取得APIのレスポンスにある`id`
- `payee_name_disp_kbn` (enum(1, 2, 3)): 発注先支社（書類上の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※発注先支社を指定する場合のみ
- `payee_name_for_post_disp_kbn` (enum(1, 2, 3)): 発注先支社（郵送時の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※発注先支社を指定する場合のみ
- `payee_contact_id` (integer): 発注先担当者ID ※発注先担当者登録API・発注先担当者リスト取得APIのレスポンスにある`id`
- `company_branch_id` (integer): 自社支社ID ※このIDを取得するAPIはありません。画面上の「組織設定→支社管理」で対象の「編集」に行き、そのURLに含まれるIDを使用してください。例：`https://the-board.jp/company_branches/123456/edit` → 123456
- `company_name_disp_kbn` (enum(1, 2, 3)): 自社支社（書類上の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※自社支社を指定する場合のみ
- `company_name_for_post_disp_kbn` (enum(1, 2, 3)): 自社支社（郵送時の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※自社支社を指定する場合のみ
- `user_id` (integer): (必須) 担当者ID ※ユーザーリスト取得APIのレスポンスにある`id`
- `project_id` (integer): 関連案件ID ※案件登録API・案件リスト取得APIのレスポンスにある`id`
- `payment_term_id` (integer): 支払条件ID - 新規登録時に未指定の場合は「デフォルト支払条件」が使用されます - 支払条件リスト取得APIのレスポンスにある`id`です
- `expenditure_status` (enum(1, 2, 3, 4, 5, 8, 9)): (必須) 発注ステータス - 1：見積中(高) - 2：見積中(中) - 3：見積中(低) - 8：見積中(除) - 4：発注確定 - 5：発注済 - 9：見送り
- `payment_timing_kbn` (enum(1, 2, 3)): (必須) 支払タイミング - 1：一括支払 - 2：定期支払 - 3：分割支払
- `tax_withholding_kbn` (enum(1, 2, 3)): (必須) 源泉徴収区分 - 1：なし - 2：源泉徴収（復興特別所得税あり） - 3：源泉徴収（復興特別所得税なし）
- `in_house_memo` (string): 社内メモ
- `management_no` (string): 管理番号
- `expenditure_type_id` (integer): 発注区分1 ※発注区分リスト取得APIのレスポンスにある`id`
- `expenditure_type2_id` (integer): 発注区分2 ※発注区分リスト取得APIのレスポンスにある`id`
- `expenditure_type3_id` (integer): 発注区分3 ※発注区分リスト取得APIのレスポンスにある`id`
- `tags` (array<string>): タグ ※タグ名の配列
- `group_id` (integer): グループID ※グループリスト取得APIのレスポンスにある`id`
- `accounting_type_id` (integer): 会計区分1ID ※会計区分リスト取得APIのレスポンスにある`id`
- `accounting_type2_id` (integer): 会計区分2ID ※会計区分リスト取得APIのレスポンスにある`id`
- `accounting_type3_id` (integer): 会計区分3ID ※会計区分リスト取得APIのレスポンスにある`id`
- `company_bank_id` (integer): 集計用出金口座（振込口座ID） ※このIDを取得するAPIはありません。画面上の「組織設定→振込口座管理」で対象の「編集」に行き、そのURLに含まれるIDを使用してください。例：`https://the-board.jp/company_banks/123456/edit` → 123456
- `delivery_status` (enum(1, 2, 3, 4)): 進捗状況 - 1：未着手 - 2：着手中 - 3：納品済 - 4：検収済
- `payment_method_kbn` (enum(1, 2, 3, 4, 5, 6, 7)): 支払方法 - 1：銀行振込 - 2：口座振替 - 3：クレジットカード - 4：現金支払 - 5：代金引換 - 6：コンビニ支払 - 7：郵便振替
- `tax_rule_kbn` (enum(1, 2, 3)): 端数処理 - 1：四捨五入 - 2：切り捨て - 3：切り上げ ※デフォルトはアカウントの端数処理設定による
- `wareki_flg` (enum(0, 1)): 和暦表示 - 0：西暦 - 1：和暦 ※「和暦表示」機能有効時のみ
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み
- `reduced_tax_rate_kbn` (enum(1, 2)): 軽減税率 - 1：対象外 - 2：対象 ※「軽減税率」機能有効時のみ
- `document_setting_id` (integer): 書類詳細設定ID ※このIDを取得するAPIはありません。画面上の「設定→書類詳細設定」で対象の「編集」に行き、そのURLに含まれるIDを使用してください。例：`https://the-board.jp/document_settings/123456/edit` → 123456
- `to` (string): TO（メールアドレス） ※複数指定する場合はカンマ区切り
- `cc` (string): CC（メールアドレス） ※複数指定する場合はカンマ区切り
- `currency` (enum(JPY, USD, EUR, GBP, CNY, HKD, TWD, KRW, SGD, AUD, IDR, THB, CAD)): 通貨 ※英語アドオン有効時のみ
- `lang_kbn` (enum(1, 2)): 言語 - 1：日本語 - 2：英語 ※英語アドオン有効時のみ
- `exchange_rate` (string): 為替レート ※英語アドオン有効時のみ
- `invoice_date` (string): (必須) 請求日 ※一括支払用
- `total` (string): (必須) 税抜金額
- `tax` (string): (必須) 消費税
- `tax_withholding` (integer): 源泉所得税
- `contract_start_date` (string): (必須) 請求開始日 ※定期支払用
- `contract_end_date` (string): (必須) 請求終了日 ※定期支払用
- `periodical_payment_interval` (enum(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)): 支払間隔 ※定期支払用
- `periodical_payment_payment_kbn` (enum(1, 2)): 支払間隔内の請求時期 - 1：支払間隔の最初の月 - 2：支払間隔の最後の月 ※定期支払用
- `auto_renewal_flg` (enum(0, 1)): 自動契約更新 - 0：OFF - 1：ON ※定期支払用
- `auto_renewal_period_month` (enum(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)): 自動契約更新期間（月数） ※定期支払用
- `delivery_document_kbn` (enum(1, 2)): 検収書の枚数 - 1：1枚 - 2：支払回数と同じ ※定期支払・分割支払用<br> ※複数検収書対応ON時のみ
- `invoices` (array<object>): (必須) 請求情報 ※分割支払用

## GET /v1/expenditures/{id}

発注取得。発注ID指定で発注を取得します。

パラメータ:
- `id` (integer): 発注ID ※発注登録API・発注リスト取得APIのレスポンスにある`id`
- `response_group` (enum(small, medium, large, estimate, order, delivery, invoice, all)): レスポンスグループ | response_group | 項目 | |:-----------|:------------| | small | id, expenditure_no, management_no, name, payee, payee_contact, user, total, tax, tax_w…

## PATCH /v1/expenditures/{id}

発注更新。発注ID指定で発注を更新します。 <strong>分割支払に関する注意事項</strong><br> 現在、API経由での`invoices`の更新（請求日・請求回数の変更）には対応していません。

パラメータ:
- `id` (integer): 発注ID ※発注登録API・発注リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `name` (string): 発注名
- `payee_id` (integer): 発注先ID ※発注先登録API・発注先リスト取得APIのレスポンスにある`id`
- `payee_branch_id` (integer): 発注先支社ID ※発注先支社登録API・発注先支社リスト取得APIのレスポンスにある`id`
- `payee_name_disp_kbn` (enum(1, 2, 3)): 発注先支社（書類上の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※発注先支社を指定する場合のみ
- `payee_name_for_post_disp_kbn` (enum(1, 2, 3)): 発注先支社（郵送時の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※発注先支社を指定する場合のみ
- `payee_contact_id` (integer): 発注先担当者ID ※発注先担当者登録API・発注先担当者リスト取得APIのレスポンスにある`id`
- `company_branch_id` (integer): 自社支社ID ※このIDを取得するAPIはありません。画面上の「組織設定→支社管理」で対象の「編集」に行き、そのURLに含まれるIDを使用してください。例：`https://the-board.jp/company_branches/123456/edit` → 123456
- `company_name_disp_kbn` (enum(1, 2, 3)): 自社支社（書類上の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※自社支社を指定する場合のみ
- `company_name_for_post_disp_kbn` (enum(1, 2, 3)): 自社支社（郵送時の表示） - 1：会社名のみ - 2：会社名＋支社名 - 3：支社名のみ ※自社支社を指定する場合のみ
- `user_id` (integer): 担当者ID ※ユーザーリスト取得APIのレスポンスにある`id`
- `project_id` (integer): 関連案件ID ※案件登録API・案件リスト取得APIのレスポンスにある`id`
- `payment_term_id` (integer): 支払条件ID - 新規登録時に未指定の場合は「デフォルト支払条件」が使用されます - 支払条件リスト取得APIのレスポンスにある`id`です
- `expenditure_status` (enum(1, 2, 3, 4, 5, 8, 9)): 発注ステータス - 1：見積中(高) - 2：見積中(中) - 3：見積中(低) - 8：見積中(除) - 4：発注確定 - 5：発注済 - 9：見送り
- `payment_timing_kbn` (enum(1, 2, 3)): 支払タイミング - 1：一括支払 - 2：定期支払 - 3：分割支払
- `tax_withholding_kbn` (enum(1, 2, 3)): 源泉徴収区分 - 1：なし - 2：源泉徴収（復興特別所得税あり） - 3：源泉徴収（復興特別所得税なし）
- `in_house_memo` (string): 社内メモ
- `management_no` (string): 管理番号
- `expenditure_type_id` (integer): 発注区分1 ※発注区分リスト取得APIのレスポンスにある`id`
- `expenditure_type2_id` (integer): 発注区分2 ※発注区分リスト取得APIのレスポンスにある`id`
- `expenditure_type3_id` (integer): 発注区分3 ※発注区分リスト取得APIのレスポンスにある`id`
- `tags` (array<string>): タグ ※タグ名の配列
- `group_id` (integer): グループID ※グループリスト取得APIのレスポンスにある`id`
- `accounting_type_id` (integer): 会計区分1ID ※会計区分リスト取得APIのレスポンスにある`id`
- `accounting_type2_id` (integer): 会計区分2ID ※会計区分リスト取得APIのレスポンスにある`id`
- `accounting_type3_id` (integer): 会計区分3ID ※会計区分リスト取得APIのレスポンスにある`id`
- `company_bank_id` (integer): 集計用出金口座（振込口座ID） ※このIDを取得するAPIはありません。画面上の「組織設定→振込口座管理」で対象の「編集」に行き、そのURLに含まれるIDを使用してください。例：`https://the-board.jp/company_banks/123456/edit` → 123456
- `delivery_status` (enum(1, 2, 3, 4)): 進捗状況 - 1：未着手 - 2：着手中 - 3：納品済 - 4：検収済
- `payment_method_kbn` (enum(1, 2, 3, 4, 5, 6, 7)): 支払方法 - 1：銀行振込 - 2：口座振替 - 3：クレジットカード - 4：現金支払 - 5：代金引換 - 6：コンビニ支払 - 7：郵便振替
- `tax_rule_kbn` (enum(1, 2, 3)): 端数処理 - 1：四捨五入 - 2：切り捨て - 3：切り上げ ※デフォルトはアカウントの端数処理設定による
- `wareki_flg` (enum(0, 1)): 和暦表示 - 0：西暦 - 1：和暦 ※「和暦表示」機能有効時のみ
- `archive_flg` (enum(0, 1)): アーカイブ状態 - 0：未アーカイブ - 1：アーカイブ済み
- `reduced_tax_rate_kbn` (enum(1, 2)): 軽減税率 - 1：対象外 - 2：対象 ※「軽減税率」機能有効時のみ
- `document_setting_id` (integer): 書類詳細設定ID ※このIDを取得するAPIはありません。画面上の「設定→書類詳細設定」で対象の「編集」に行き、そのURLに含まれるIDを使用してください。例：`https://the-board.jp/document_settings/123456/edit` → 123456
- `to` (string): TO（メールアドレス） ※複数指定する場合はカンマ区切り
- `cc` (string): CC（メールアドレス） ※複数指定する場合はカンマ区切り
- `currency` (enum(JPY, USD, EUR, GBP, CNY, HKD, TWD, KRW, SGD, AUD, IDR, THB, CAD)): 通貨 ※英語アドオン有効時のみ
- `lang_kbn` (enum(1, 2)): 言語 - 1：日本語 - 2：英語 ※英語アドオン有効時のみ
- `exchange_rate` (string): 為替レート ※英語アドオン有効時のみ
- `invoice_date` (string): 請求日 ※一括支払用
- `total` (string): 税抜金額
- `tax` (string): 消費税
- `tax_withholding` (integer): 源泉所得税
- `contract_start_date` (string): 請求開始日 ※定期支払用
- `contract_end_date` (string): 請求終了日 ※定期支払用
- `periodical_payment_interval` (enum(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)): 支払間隔 ※定期支払用
- `periodical_payment_payment_kbn` (enum(1, 2)): 支払間隔内の請求時期 - 1：支払間隔の最初の月 - 2：支払間隔の最後の月 ※定期支払用
- `auto_renewal_flg` (enum(0, 1)): 自動契約更新 - 0：OFF - 1：ON ※定期支払用
- `auto_renewal_period_month` (enum(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)): 自動契約更新期間（月数） ※定期支払用
- `delivery_document_kbn` (enum(1, 2)): 検収書の枚数 - 1：1枚 - 2：支払回数と同じ ※定期支払・分割支払用<br> ※複数検収書対応ON時のみ

## DELETE /v1/expenditures/{id}

発注削除。発注ID指定で発注を削除します。

パラメータ:
- `id` (integer): 発注ID ※発注登録API・発注リスト取得APIのレスポンスにある`id`

## PATCH /v1/expenditures/expenditure_status/{id}

発注ステータス変更。発注ID指定で発注ステータスを変更します。

パラメータ:
- `id` (integer): 発注ID ※発注登録API・発注リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `expenditure_status` (enum(1, 2, 3, 4, 5, 8, 9)): (必須) 発注ステータス - 1：見積中(高) - 2：見積中(中) - 3：見積中(低) - 8：見積中(除) - 4：発注確定 - 5：発注済 - 9：見送り

## PATCH /v1/expenditures/lock_flg/{id}

発注のロック。発注ID指定で発注情報をロック・ロック解除します。

パラメータ:
- `id` (integer): 発注ID ※発注登録API・発注リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `lock_flg` (enum(0, 1)): (必須) ロックフラグ - 0：未ロック - 1：ロック済み

## GET /v1/expenditure_payments

支払リスト取得。支払リストを取得します。

パラメータ:
- `invoice_date_gteq` (string): 請求日（指定日以降）
- `invoice_date_lteq` (string): 請求日（指定日以前）
- `payment_date_gteq` (string): 支払期限（指定日以降）
- `payment_date_lteq` (string): 支払期限（指定日以前）
- `expenditure_expenditure_status_in[]` (string): 発注ステータス - 1：見積中(高) - 2：見積中(中) - 3：見積中(低) - 8：見積中(除) - 4：発注確定 - 5：発注済 - 9：見送り ※複数の場合はカンマ区切り
- `payment_status_in[]` (string): 支払ステータス - 1：請求書未受領 - 2：請求書受領済 - 4：振込予約済 - 3：支払済 ※複数の場合はカンマ区切り
- `expenditure_expenditure_no_eq` (integer): 発注No
- `expenditure_management_no_eq` (string): 管理番号
- `expenditure_name_cont` (string): 発注名（部分一致）
- `expenditure_payee_id_eq` (integer): 発注先ID ※発注先登録API・発注先リスト取得APIのレスポンスにある`id`
- `expenditure_payee_name_cont` (string): 発注先名（部分一致）
- `expenditure_payee_name_disp_cont` (string): 発注先略称名（部分一致）
- `expenditure_tags[]` (string): タグ（OR条件、複数の場合はカンマ区切り）
- `expenditure_project_id_eq` (integer): 関連案件ID ※案件登録API・案件リスト取得APIのレスポンスにある`id`
- `updated_at_gteq` (string): 更新日時（指定日時以降）
- `updated_at_lteq` (string): 更新日時（指定日時以前）
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号
- `response_group` (enum(small, medium, large, estimate, order, delivery, invoice, receipt, project_cost, all)): レスポンスグループ | response_group | 項目 | |:-----------|:------------| | small | id, expenditure_no, management_no, name, payee, payee_contact, user, total, tax, tax_w…

## PATCH /v1/expenditure_payments/payment_status/{id}

支払ステータス変更。支払ID指定で請求ステータスを変更します。

パラメータ:
- `id` (integer): 支払ID ※支払リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `payment_status` (enum(1, 2, 3, 4)): (必須) 支払ステータス - 1：請求書未受領 - 2：請求書受領済 - 4：振込予約済 - 3：支払済

## PATCH /v1/expenditure_payments/lock_flg/{id}

支払のロック。支払ID指定で支払のロック状態を変更します。

パラメータ:
- `id` (integer): 支払ID ※支払リスト取得APIのレスポンスにある`id`

リクエストボディ(JSON):
- `lock_flg` (enum(0, 1)): (必須) ロックフラグ - 0：未ロック - 1：ロック済み

## GET /v1/expenditure_documents/estimates/{id}

見積依頼書取得。ID指定で見積依頼書を取得します。

パラメータ:
- `id` (integer): 見積依頼書ID ※発注登録API・発注リスト取得API・発注取得APIのレスポンスにある`expenditure_estimate`内の`id`（要レスポンスグループ指定）

## PATCH /v1/expenditure_documents/estimates/{id}

見積依頼書更新。ID指定で見積依頼書を更新します。

パラメータ:
- `id` (integer): 見積依頼書ID ※発注登録API・発注リスト取得API・発注取得APIのレスポンスにある`expenditure_estimate`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `estimate_request_date` (string): 依頼日
- `desired_delivery_date_text` (string): 希望納期
- `message` (string): 備考
- `total` (string): 小計 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax` (string): 消費税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax_withholding` (string): 源泉所得税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `document_amount_disp_kbn` (enum(1, 2, 3, 4)): 金額表示 - 1：税込表示 - 2：合計欄を税抜表示＋明細下の小計・消費税行非表示 - 3：合計欄のみ税抜表示 - 4：合計表示なし ※デフォルトは「デフォルト設定」によって決まります
- `delivery_place` (string): 納品場所
- `details` (array<object>): 明細行
- `blank_date_flg` (enum(0, 1)): 依頼日空欄 - 0：表示 - 1：空欄にする

## PATCH /v1/expenditure_documents/estimates/lock_flg/{id}

見積依頼書ロック。ID指定で見積依頼書のロック状態を変更します。

パラメータ:
- `id` (integer): 見積依頼書ID ※発注登録API・発注リスト取得API・発注取得APIのレスポンスにある`expenditure_estimate`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `lock_flg` (enum(0, 1)): ロックフラグ - 0：未ロック - 1：ロック済み

## GET /v1/expenditure_documents/orders/{id}

発注書取得。ID指定で発注書を取得します。

パラメータ:
- `id` (integer): 発注書ID ※発注登録API・発注リスト取得API・発注取得APIのレスポンスにある`expenditure_order`内の`id`（要レスポンスグループ指定）

## PATCH /v1/expenditure_documents/orders/{id}

発注書更新。ID指定で発注書を更新します。

パラメータ:
- `id` (integer): 発注書ID ※発注登録API・発注リスト取得API・発注取得APIのレスポンスにある`expenditure_order`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `order_date` (string): 発注日
- `delivery_date` (string): 納期
- `message` (string): 備考
- `total` (string): 小計 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax` (string): 消費税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax_withholding` (string): 源泉所得税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `document_amount_disp_kbn` (enum(1, 2, 3, 4)): 金額表示 - 1：税込表示 - 2：合計欄を税抜表示＋明細下の小計・消費税行非表示 - 3：合計欄のみ税抜表示 - 4：合計表示なし ※デフォルトは「デフォルト設定」によって決まります
- `delivery_place` (string): 納品場所
- `details` (array<object>): 明細行
- `blank_date_flg` (enum(0, 1)): 発注日空欄 - 0：表示 - 1：空欄にする

## PATCH /v1/expenditure_documents/orders/lock_flg/{id}

発注書ロック。ID指定で発注書のロック状態を変更します。

パラメータ:
- `id` (integer): 発注書ID ※発注登録API・発注リスト取得API・発注取得APIのレスポンスにある`expenditure_order`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `lock_flg` (enum(0, 1)): ロックフラグ - 0：未ロック - 1：ロック済み

## GET /v1/expenditure_documents/deliveries/{id}

検収書取得。ID指定で検収書を取得します。

パラメータ:
- `id` (integer): 検収書ID ※発注登録API・発注リスト取得API・発注取得APIのレスポンスにある`expenditure_delivery`内の`id`（要レスポンスグループ指定）

## PATCH /v1/expenditure_documents/deliveries/{id}

検収書更新。ID指定で検収書を更新します。

パラメータ:
- `id` (integer): 検収書ID ※発注登録API・発注リスト取得API・発注取得APIのレスポンスにある`expenditure_delivery`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `delivery_received_date` (string): 検収日
- `disp_delivery_receive_date` (string): 検収日（表示設定）
- `message` (string): 備考
- `total` (string): 小計 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax` (string): 消費税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax_withholding` (string): 源泉所得税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `document_amount_disp_kbn` (enum(1, 2, 3, 4)): 金額表示 - 1：税込表示 - 2：合計欄を税抜表示＋明細下の小計・消費税行非表示 - 3：合計欄のみ税抜表示 - 4：合計表示なし ※デフォルトは「デフォルト設定」によって決まります
- `delivery_place` (string): 納品場所
- `details` (array<object>): 明細行
- `blank_date_flg` (enum(0, 1)): 検収日空欄 - 0：表示 - 1：空欄にする

## PATCH /v1/expenditure_documents/deliveries/lock_flg/{id}

検収書ロック。ID指定で検収書のロック状態を変更します。

パラメータ:
- `id` (integer): 検収書ID ※発注登録API・発注リスト取得API・発注取得APIのレスポンスにある`expenditure_delivery`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `lock_flg` (enum(0, 1)): ロックフラグ - 0：未ロック - 1：ロック済み

## GET /v1/expenditure_documents/invoices/{id}

支払通知書取得。ID指定で支払通知書を取得します。

パラメータ:
- `id` (integer): 支払通知書ID ※発注登録API・発注リスト取得API・発注取得APIのレスポンスにある`expenditure_invoice`内の`id`（要レスポンスグループ指定）

## PATCH /v1/expenditure_documents/invoices/{id}

支払通知書更新。ID指定で支払通知書を更新します。

パラメータ:
- `id` (integer): 支払通知書ID ※発注登録API・発注リスト取得API・発注取得APIのレスポンスにある`expenditure_invoice`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `paid_date` (string): 支払日
- `message` (string): 備考
- `total` (string): 小計 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax` (string): 消費税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `tax_withholding` (string): 源泉所得税 ※APIから登録時は画面上と異なり自動計算されないため未指定の場合は0になります ※1,000,000,000未満の値を設定してください
- `document_amount_disp_kbn` (enum(1, 2, 3, 4)): 金額表示 - 1：税込表示 - 2：合計欄を税抜表示＋明細下の小計・消費税行非表示 - 3：合計欄のみ税抜表示 - 4：合計表示なし ※デフォルトは「デフォルト設定」によって決まります
- `delivery_place` (string): 納品場所
- `details` (array<object>): 明細行
- `blank_date_flg` (enum(0, 1)): 支払日空欄 - 0：表示 - 1：空欄にする

## PATCH /v1/expenditure_documents/invoices/lock_flg/{id}

支払通知書ロック。ID指定で支払通知書のロック状態を変更します。

パラメータ:
- `id` (integer): 支払通知書ID ※発注登録API・発注リスト取得API・発注取得APIのレスポンスにある`expenditure_invoice`内の`id`（要レスポンスグループ指定）

リクエストボディ(JSON):
- `lock_flg` (enum(0, 1)): ロックフラグ - 0：未ロック - 1：ロック済み

## GET /v1/analyses

計上データリスト取得。計上データリストを取得します。 ### レスポンスデータに関する補足 #### 計上データ区分に応じた項目 計上データは、案件・案件原価・発注の3種類のデータがあり、それぞれ持っているデータの項目が異なります。 たとえば、案件には、受注ステータス（`order_status`）・請求ステータス（`invoice_status`）・案件区分（`project_type_id`）などがありますが、発注にはそれらはありません。 逆に発注には、発注ステータス（`expenditure_status`）・支払ステータス（`payment_status`）・発注区分（`expenditure_type_…。

パラメータ:
- `report_ym_gteq` (string): 計上年月（指定日以降）
- `report_ym_lteq` (string): 計上年月（指定日以前）
- `analysis_data_kbn_in[]` (string): 計上データ区分 - 1：案件 - 2：案件原価 - 3：発注 ※複数の場合はカンマ区切り
- `order_status_in[]` (string): 受注ステータス - 1：見積中(高) - 2：見積中(中) - 3：見積中(低) - 8：見積中(除) - 4：受注確定 - 5：受注済 - 9：失注 ※複数の場合はカンマ区切り
- `expenditure_status_in[]` (string): 発注ステータス - 1：見積中(高) - 2：見積中(中) - 3：見積中(低) - 8：見積中(除) - 4：発注確定 - 5：発注済 - 9：見送り ※複数の場合はカンマ区切り
- `include_auto_renewal_flg` (enum(0, 1)): 自動契約更新を考慮 - 0：自動契約更新のシミュレーションデータを含まない - 1：自動契約更新のシミュレーションデータを含む ※未指定時は`0`指定時と同等の結果
- `invoice_status_in[]` (string): 請求ステータス - 1：未請求 - 4：請求OK - 2：請求済 - 5：一部入金済 - 3：入金済 - 9：回収不能 ※複数の場合はカンマ区切り
- `payment_status_in[]` (string): 支払ステータス - 1：請求書未受領 - 2：請求書受領済 - 4：振込予約済 - 3：支払済 ※複数の場合はカンマ区切り
- `updated_at_gteq` (string): 更新日時（指定日時以降）
- `updated_at_lteq` (string): 更新日時（指定日時以前）
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号

## GET /v1/users

ユーザーリスト取得。ユーザーリストを取得します。

パラメータ:
- `email_eq` (string): メールアドレス
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号

## GET /v1/groups

グループリスト取得。グループリストを取得します。

パラメータ:
- `name_cont` (string): グループ名
- `include_archive_flg` (enum(0, 1)): アーカイブを含むか - 0：アーカイブ済みは除く - 1：アーカイブ済みも含む
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号

## GET /v1/payment_terms

支払条件リスト取得。支払条件リストを取得します。

パラメータ:
- `name_cont` (string): 支払条件名
- `include_archive_flg` (enum(0, 1)): アーカイブを含むか - 0：アーカイブ済みは除く - 1：アーカイブ済みも含む
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号

## GET /v1/project_types

案件区分リスト取得。案件区分リストを取得します。

パラメータ:
- `project_type_kbn_eq` (integer): 案件区分1〜3の種類 - 1：案件区分1 - 2：案件区分2 - 3：案件区分3 ※未指定時は`1`指定時と同等の結果
- `name_cont` (string): 案件区分名
- `include_archive_flg` (enum(0, 1)): アーカイブを含むか - 0：アーカイブ済みは除く - 1：アーカイブ済みも含む
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号

## GET /v1/expenditure_types

発注区分リスト取得。発注区分リストを取得します。

パラメータ:
- `expenditure_type_kbn_eq` (integer): 発注区分1〜3の種類 - 1：発注区分1 - 2：発注区分2 - 3：発注区分3 ※未指定時は`1`指定時と同等の結果
- `name_cont` (string): 発注区分名
- `include_archive_flg` (enum(0, 1)): アーカイブを含むか - 0：アーカイブ済みは除く - 1：アーカイブ済みも含む
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号

## GET /v1/accounting_types

会計区分リスト取得。会計区分リストを取得します。

パラメータ:
- `accounting_type_kbn_eq` (integer): 会計区分1〜3の種類 - 1：会計区分1 - 2：会計区分2 - 3：会計区分3 ※未指定時は`1`指定時と同等の結果
- `name_cont` (string): 会計区分名
- `include_archive_flg` (enum(0, 1)): アーカイブを含むか - 0：アーカイブ済みは除く - 1：アーカイブ済みも含む
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号

## GET /v1/document_send_channels

カスタム書類送付方法リスト取得。カスタム書類送付方法リストを取得します。

パラメータ:
- `name_cont` (string): カスタム書類送付方法名
- `include_archive_flg` (enum(0, 1)): アーカイブを含むか - 0：アーカイブ済みは除く - 1：アーカイブ済みも含む
- `per_page` (integer): 1ページあたりの要素数（最大100まで）
- `page` (integer): 現在のページ番号
