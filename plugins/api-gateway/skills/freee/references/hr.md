# 人事労務 API(`/hr/api/v1`)

例の `$GW` は `api-gateway` スキルの `gw_request.py`、`$ALL` はこのスキルの `scripts/freee_all.py`。`company_id` は GET ではクエリ、POST / PUT ではボディに入れる。人事労務は年月ごとのデータが多く、`year` / `month` で対象の月を指定するものが多い。ボディの細かい項目は公式リファレンス(https://developer.freee.co.jp/reference/hr/reference)で確かめる。

給与・人事の情報は機微なので、必要な項目だけを取り、会話には要約だけを出す。

## 自分

```
GET /hr/api/v1/users/me      # 自分と、所属する事業所・従業員 ID(company_id は不要)
```

## 従業員

```
GET  /hr/api/v1/employees                          # その年月に在籍する従業員(company_id、year、month、offset、limit)
GET  /hr/api/v1/companies/{company_id}/employees   # 退職者も含む全従業員(company_id はパスに入る)
GET  /hr/api/v1/employees/{id}                     # 1 件(company_id、year、month)
POST /hr/api/v1/employees                          # 作成
PUT  /hr/api/v1/employees/{id}                     # 更新
```

```sh
python3 $ALL /hr/api/v1/employees -q company_id=123 -q year=2026 -q month=9 -o employees.json
```

年月ごとの属性は、従業員の下のリソースに分かれている(GET は `company_id`、`year`、`month`)。

| リソース | パス(`/hr/api/v1/employees/{id}/...`) |
|---|---|
| 氏名・住所など | `profile_rule` |
| 健康保険 | `health_insurance_rule` |
| 厚生年金 | `welfare_pension_insurance_rule` |
| 家族・扶養 | `dependent_rules`(更新は `dependent_rules/bulk_update`) |
| 給与振込口座 | `bank_account_rule` |
| 基本給 | `basic_pay_rule` |
| カスタム項目 | `profile_custom_fields` |

## 勤怠

```
GET/PUT/DELETE /hr/api/v1/employees/{id}/work_records/{date}                    # 日ごとの勤怠(date は YYYY-MM-DD)
GET/PUT        /hr/api/v1/employees/{id}/work_record_summaries/{year}/{month}    # 月の集計(労働時間・残業時間など)
GET            /hr/api/v1/employees/{id}/time_clocks                             # 打刻の一覧(from_date、to_date)
POST           /hr/api/v1/employees/{id}/time_clocks                             # 打刻する
GET            /hr/api/v1/employees/{id}/time_clocks/available_types             # 今打刻できる種類(出勤・退勤・休憩など)
```

```sh
python3 $GW GET freee /hr/api/v1/employees/{id}/work_record_summaries/2026/9 -q company_id=123
```

打刻や勤怠の変更は、本人の記録を変える操作なので、必ずユーザーに確認してから行う。

## 給与・賞与明細(読み取り)

```
GET /hr/api/v1/salaries/employee_payroll_statements        # 給与明細の一覧(company_id、year、month)
GET /hr/api/v1/salaries/employee_payroll_statements/{id}
GET /hr/api/v1/bonuses/employee_payroll_statements         # 賞与明細の一覧(company_id、year、month)
GET /hr/api/v1/bonuses/employee_payroll_statements/{id}
```

## 組織

```
GET/POST        /hr/api/v1/groups                        # 部署などのグループ
PUT/DELETE      /hr/api/v1/groups/{id}
GET/POST        /hr/api/v1/positions                     # 役職
PUT/DELETE      /hr/api/v1/positions/{id}
GET             /hr/api/v1/employee_group_memberships    # 従業員とグループ・役職の対応
```

## 勤怠系の申請

申請の種類ごとにパスが分かれ、どれも同じ形をしている。

| 申請 | パス |
|---|---|
| 月次の勤怠締め | `/hr/api/v1/approval_requests/monthly_attendances` |
| 勤務時間の修正 | `/hr/api/v1/approval_requests/work_times` |
| 有給休暇 | `/hr/api/v1/approval_requests/paid_holidays` |
| 特別休暇 | `/hr/api/v1/approval_requests/special_holidays` |
| 残業 | `/hr/api/v1/approval_requests/overtime_works` |

それぞれに、一覧(`company_id`、`status` などで絞り込み)・`/{id}` の取得・作成・更新・削除と、承認や却下の `POST .../{id}/actions` がある。`actions` のボディは公式リファレンスで確かめ、ユーザーに確認してから実行する。申請経路は `GET /hr/api/v1/approval_flow_routes`。
