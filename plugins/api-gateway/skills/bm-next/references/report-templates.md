# Excel 帳票テンプレートの作り方

ビルメンNEXT は、登録された Excel テンプレート(`.xlsx`)にデータを差し込んで帳票を出力する。テンプレートは 2 種類ある。

| 種類 | 単位 | 差し込むデータ | 登録 | 出力 |
|---|---|---|---|---|
| 作業予定 | 保存済みフィルタ(`target: EXECUTION_SCHEDULE`)1 つに 1 つ | フィルタ条件に合う、指定月の実行予定 | `uploadScheduleReportTemplate` | `GET /api/works/saved-filters/{id}/report?yearMonth=2026-10` |
| 検針表 | 施設 1 つに 1 つ | その施設の、指定月の検針値(公開中のメーター) | `uploadFacilityReportTemplate` | `GET /api/meter-reading/facilities/{id}/reports/202610/export` |

テンプレートは、ふつうの Excel ブックのセルに `{{report.month}}` のような**トークン**を書いたもの。ビルメンNEXT がトークンを値に置き換え、トークン行をデータの件数ぶん複製する。書式・数式・ほかのシートはそのまま残る。

## 前提

- 組織で機能フラグが有効なこと。作業予定は `works.report.custom-template`、検針表は `meter-reading.report.custom-template`。`{ myFeatureFlags }` に入っているかを見る。無いときは有償オプションなので、運営に有効化を頼むようユーザーに伝える(Claude がフラグを作らない)。
- スコープ: 登録・削除は `works.report.template.write` / `meter-reading.report.template.write`、検針表のテンプレートの参照は `meter-reading.report.template.read`、出力は作業予定が `works.schedule.read`。`myScopes` で確かめる。
- 作業予定: 対象の保存済みフィルタがあること(`savedWorkFilters(target: EXECUTION_SCHEDULE)`)。無ければ `createSavedWorkFilter` で作る(作る前にユーザーに条件を確認する)。出力する月の予定が作成済み(`executionMonth(year, month) { status }` が `INITIALIZED`)であること。
- 検針表: 施設とメーターが登録済みで、出力する月の検針値が入っていること。
- 登録済みテンプレートのファイル自体を API で取り出す方法は無い(返るのは `originalFileName` などの情報だけ)。直すときに使うので、元の `.xlsx` はユーザーの手元(SharePoint など)に保存しておいてもらう。

## 共通の書き方

### トークン

- `{{` と `}}` で囲む。大文字・小文字は区別する(`{{report.Month}}` は不可)。前後に空白を入れない。
- 1 つのセルに置けるのは、行トークン 1 つ、または、スカラートークン(文字列の途中に埋めてもよい)。
- **知らないトークンが 1 つでもあると、登録が拒否される**。登録の前に `scripts/bm_next_template_check.py` で確かめると、`シート名!セル: 未知のトークン: {{...}}` のように場所が出る。
- トークンは文字列のセルに書く。数式の中に書いたり、数式の結果がトークンの文字列になるようにしたりしない。

### スカラートークンと行トークン

- **スカラートークン**(`report.*`、`filter.*`、`facility.*`): 値 1 つに置き換わる。見出しや表題に使う。
  - セルの中身がトークンだけのとき(テーブル方式と固定セル方式)、数値・日付は数値として書き込まれる。セルに日付の表示形式を付けておく。
  - 文字列の途中に埋めたとき(例 `{{facility.name}} 検針表`)、および旧方式では、文字列として置き換わる。
- **行トークン**(`schedule.*`、`meter.*`): 1 行に並べる。その行が**データの件数ぶん複製**され、1 件ずつ値が入る。
  - 値は型付きで入る。日付・時刻は Excel のシリアル値(数値)なので、セルに `yyyy/m/d` や `h:mm` などの表示形式を付けておく。
  - セルにはトークンだけを書く。前後の文字は消える(`{{meter.value}} kWh` は値だけになる)。単位は隣のセルか表示形式で付ける。
  - データが 0 件のときは、行は 1 行残り、トークンのセルが空欄になる。
  - トークン行より下の行は、増えた行数ぶん下にずれる。ただし、下の行の数式の参照範囲は広がらない(テーブル方式では `=SUM(D5:D5)` が `=SUM(D8:D8)` のように、範囲ごとずれる)。合計は、テーブル方式で構造化参照(`=SUM(METER_VALUE[使用量])`)を使う。

### 方式(エンジン)

ファイルの作りで方式が自動で決まる。

| 方式 | 決まり方 | 向いているもの |
|---|---|---|
| **テーブル方式**(推奨) | Excel のテーブル(挿入 → テーブル)の**データ行**に行トークンがある | ほとんどの帳票。データシートを別に持ち、帳票シートは数式で引く作りも可 |
| 旧方式 | テーブルを使わず、ふつうのセル範囲に行トークンがある | ごく単純な一覧 |
| 固定セル方式(検針表のみ) | `{{meter[<meterKey>].<field>}}` がある | メーターごとに値を書くセルが決まっている帳票(行が伸び縮みしない) |

**テーブル方式**の決まり:

- 行トークンを置く行は、ブック全体でテーブル内の**ちょうど 1 行**。2 行あると登録が拒否される。
- 複製した行の数式は、相対参照の行番号だけがずれる(`$5` のような行の絶対参照はずれない)。構造化参照(`[@検針値]` など)はそのまま使える。
- テーブルの範囲は件数に合わせて伸びる。ほかのシートの数式・書式・図形は手を付けずに残る。出力したブックは、Excel で開いたときに再計算される。
- 帳票シートを別に作り、テーブル(データシート)を `XLOOKUP` や構造化参照で引く作りにすると、見た目を自由にできる。
- シート名にスカラートークンを 1 つ書ける(ブックで 1 シートまで)。例 `{{report.measureDateCompact}}` で、シート名が検針日の 8 桁になる。

**旧方式**の決まり:

- テーブル・ピボットテーブルなどの特殊な機能を使わない(読み込めずに拒否されることがある)。
- 複製した行の数式は、**絶対参照も含めてすべての行番号がずれる**。トークン行に、固定のセルを参照する数式を置かない。
- スカラートークンは文字列として置き換わる(数値・日付として使えない)。
- 検針表の旧方式で使えるスカラートークンは `report.month`、`report.createdAt`、`report.meterCount`、`facility.name` だけ。`meter.date` と `meter.prevDate` は `2026-09-30` の文字列になり、`meter.key` は使えない。

### よくある失敗

- 数式の中にトークンを書く(`="{{facility.name}}"&"様"` など) → 数式のセルは対象外なので置き換わらない。トークンは文字列のセルに書き、数式からはそのセルを参照する。
- 日付・時刻のトークンのセルに表示形式が無い → `46296` のような数値が出る。
- `.xlsm`(マクロ付き)を使う → マクロは不要なので `.xlsx` で保存する。

## 作業予定のテンプレート

1 行 = 1 件の実行予定。フィルタ条件と指定月で、作業予定の画面(月 × 組織)と同じ絞り込みをする。画面の 500 件の上限は無い。

並び順: 日付の昇順 → 最初の時間帯の開始時刻の昇順 → 作業名。日付が未定の予定は最後。

スカラートークン:

| トークン | 値 |
|---|---|
| `{{report.month}}` | 対象月の 1 日(日付) |
| `{{report.createdAt}}` | 出力した日時(日本時間、日付時刻。文字列のときは `2026-10-03 09:15`) |
| `{{report.scheduleCount}}` | 予定の件数 |
| `{{filter.name}}` | 保存済みフィルタの名前 |

行トークン:

| トークン | 値 |
|---|---|
| `{{schedule.title}}` | 予定のタイトル |
| `{{schedule.workName}}` | 作業(業務)の名前 |
| `{{schedule.date}}` | 実施日(日付)。未定は空欄 |
| `{{schedule.day}}` | 実施日の日(数値、`1`〜`31`) |
| `{{schedule.weekday}}` | 曜日(`月`、`火` …) |
| `{{schedule.timeFrom}}` | 最も早い時間帯の開始時刻(時刻) |
| `{{schedule.timeTo}}` | 最も遅い終了時刻(時刻)。24 時を超える時刻は 1 日を超える数値になる |
| `{{schedule.timeFrames}}` | 時間帯をつないだ文字列(`9:00〜12:00, 13:00〜15:00`) |
| `{{schedule.frequency}}` | `年次`、`月次`、`日次` |
| `{{schedule.precautions}}` | 居住者向けの注意事項 |
| `{{schedule.tag[<key>]}}` | 作業のタグのうち、そのキーの値。`<key>` はタグキーの `key`(表示名ではない) |

- `schedule.tag[...]` の `<key>` は、`workTagKeys(includeRetired: true) { results { key displayName } }` で調べる。存在しないキーを書くと登録が拒否される。
- 担当者・充足状況・確定状況のトークンは無い。

## 検針表のテンプレート

1 行 = 1 つのメーター。指定月の公開中のメーターが対象。並び順は、メーターの登録順(`displayOrder`)→ メーター名。

スカラートークン:

| トークン | 値 |
|---|---|
| `{{report.month}}` | 対象月(`202609` の数値。日付ではない) |
| `{{report.createdAt}}` | 出力した日(日付) |
| `{{report.meterCount}}` | メーターの本数 |
| `{{report.measureDate}}` | 検針日(メーターの検針日のうち最も新しい日、日付) |
| `{{report.prevMeasureDate}}` | 前回の検針日(同上) |
| `{{report.measureDateCompact}}` | 検針日の 8 桁の文字列(`20260930`)。シート名に使う |
| `{{facility.name}}` | 施設名 |

行トークン:

| トークン | 値 |
|---|---|
| `{{meter.name}}` | メーター名 |
| `{{meter.no}}` | メーター番号 |
| `{{meter.date}}` | 今回の検針日(日付) |
| `{{meter.value}}` | 今回の検針値 |
| `{{meter.usage}}` | 今回の使用量 |
| `{{meter.prevDate}}` | 前回の検針日(日付) |
| `{{meter.prevValue}}` | 前回の検針値 |
| `{{meter.prevUsage}}` | 前月の使用量 |
| `{{meter.median}}` | 過去の使用量の中央値 |
| `{{meter.usageYearAgo}}` | 12 か月前の使用量(無ければ空欄) |
| `{{meter.key}}` | メーターの恒久キー(月をまたいで変わらない) |
| `{{meter.id}}` | その月のメーターの ID(月ごとに変わる。突き合わせには `meter.key` を使う) |

- 検針値が無いメーターも行は出力され、値のセルが空欄になる。
- 数値は数値のセルとして書き込まれるので、料金などの数式はブック側に書いておけば再計算される。

### 固定セル方式

メーターごとに値を書くセルが決まっている帳票は、`{{meter[<meterKey>].<field>}}` を、そのセルに置く。`<field>` は上の行トークンの `meter.` より右(`value`、`usage`、`prevValue` など)。

- `<meterKey>` は `meters(facilityId:, yearMonth:, status: PUBLISHED) { results { meterName meterKey } }` で調べる。`meterKey` が空のメーターは使えない。
- 固定セル方式のトークンは、セルにそれだけを書く。
- 同じブックに、繰り返しの `{{meter.*}}` は混ぜられない(拒否される)。スカラートークンは使える。
- そのキーのメーターが指定月に無いと、セルが空欄になる(エラーにはならない)。メーターを増やしたら、テンプレートにも足す。

## Cowork での作り方

Excel を直接操作できないので、Python(`openpyxl`)でブックを作る。

1. ユーザーに確認する: どちらの種類か、対象(保存済みフィルタか施設)、帳票の見た目(既存の Excel があればもらう)、出したい項目。
2. 前提を確かめる: `{ myFeatureFlags myScopes }`、対象の ID、(作業予定でタグを使うなら)タグキーの `key`、(固定セル方式なら)`meterKey`。
3. `openpyxl` でテンプレートを作り、`.xlsx` で保存する。
4. `scripts/bm_next_template_check.py` で、登録で拒否されないかを確かめる(下記)。
5. ユーザーに対象と内容を確認してから登録する。登録はファイルを base64 にして変数ファイルに入れ、`bm_next_graphql.py` で送る。
6. 出力を REST でダウンロードし、中身(行数・値・書式)を確かめる。ファイルをユーザーに渡し、Excel で開いて見てもらう。

作業予定のテンプレート(テーブル方式)の例:

```python
from openpyxl import Workbook
from openpyxl.worksheet.table import Table, TableStyleInfo

wb = Workbook()
ws = wb.active
ws.title = "作業予定"
ws["A1"] = "{{filter.name}} 作業予定"
ws["A2"] = "{{report.month}}"
ws["A2"].number_format = 'yyyy"年"m"月"'
ws.append([])
ws.append(["日付", "曜日", "時間帯", "作業", "注意事項"])   # 4 行目: 見出し
ws.append(["{{schedule.date}}", "{{schedule.weekday}}", "{{schedule.timeFrames}}",
           "{{schedule.workName}}", "{{schedule.precautions}}"])   # 5 行目: トークン行
ws["A5"].number_format = "m/d"
table = Table(displayName="SCHEDULE", ref="A4:E5")
table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
ws.add_table(table)
wb.save("schedule-template.xlsx")
```

検針表のテンプレート(テーブル方式)の例:

```python
from openpyxl import Workbook
from openpyxl.worksheet.table import Table

wb = Workbook()
ws = wb.active
ws.title = "検針表"
ws["A1"] = "{{facility.name}} 検針表"
ws["A2"] = "検針日"
ws["B2"] = "{{report.measureDate}}"
ws["B2"].number_format = "yyyy/m/d"
ws.append([])
ws.append(["メーター", "前回", "今回", "使用量", "倍率", "請求量"])   # 4 行目: 見出し
ws.append(["{{meter.name}}", "{{meter.prevValue}}", "{{meter.value}}", "{{meter.usage}}",
           1, "=D5*E5"])   # 5 行目: トークン行。数式は複製で =D6*E6 … とずれる
ws.add_table(Table(displayName="METER_VALUE", ref="A4:F5"))
wb.save("meter-template.xlsx")
```

既存の顧客の Excel を元にするとき:

- `openpyxl` で開いて保存し直すと、画像・グラフ・図形・マクロなどが失われることがある。見た目を残したいブックは、データ用のシート(テーブル)だけを足し、帳票シートは数式で引く作りにするか、元のブックにトークンを書く作業をユーザーに Excel でしてもらう。
- 書き換えたら、元のファイルと見比べて、シートや書式が消えていないかをユーザーに確かめてもらう。

### 登録前の確認

```sh
BM=${CLAUDE_SKILL_DIR}/scripts
python3 $BM/bm_next_template_check.py schedule schedule-template.xlsx --tag-key building --tag-key floor
python3 $BM/bm_next_template_check.py meter meter-template.xlsx
```

- サーバーが登録のときにする検証(未知のトークン、テーブル内のトークン行の数、固定セル方式の書き方、シート名のトークン)を手元でして、使われる方式(`engine: table` / `legacy` / `fixed-cell`)を出す。拒否される内容があると `error:` を出して終了コード 1 で終わる。
- `warning:` は、登録はできるが出力がおかしくなりやすいもの(行トークンの前後の文字、旧方式で使えないトークンなど)。
- `--tag-key` には、`workTagKeys` で調べたタグキーの `key` を並べる。付けないと、`schedule.tag[...]` のキーが存在するかは確かめない。
- Excel で開いたときの見た目や数式の結果までは確かめられない。最後は出力を見て確かめる。

### 登録

変数ファイルを作り、ミューテーションを送る。

```sh
BM=${CLAUDE_SKILL_DIR}/scripts
python3 - <<'EOF'
import base64, json
data = base64.b64encode(open("schedule-template.xlsx", "rb").read()).decode()
json.dump({"input": {"savedFilterId": "<保存済みフィルタの ID>", "fileBase64": data,
                     "originalFileName": "schedule-template.xlsx"}}, open("vars.json", "w"))
EOF
python3 $BM/bm_next_graphql.py 'mutation($input: UploadScheduleReportTemplateInput!) {
  uploadScheduleReportTemplate(input: $input) { scheduleReportTemplate { id originalFileName uploadedAt } } }' --vars @vars.json
```

検針表は `UploadFacilityReportTemplateInput`(`facilityId`、`fileBase64`、`originalFileName`)で `uploadFacilityReportTemplate(input: $input) { template { id originalFileName uploadedAt } }` を送る。

- 同じフィルタ・施設にもう一度登録すると差し替えになる(前のテンプレートはアーカイブされる)。
- 検証に通らないと `errors` が返る。作業予定は `extensions.code` が `INVALID_REPORT_TEMPLATE` で、メッセージに場所(`シート名!セル`)が入る。検針表は理由が返らず、汎用のエラーになることがある。そのときは `bm_next_template_check.py` で原因を探す。
- 削除は `deleteScheduleReportTemplate(savedFilterId:)` / `deleteFacilityReportTemplate(facilityId:)`。削除すると、検針表は CSV の出力に戻り、作業予定は出力できなくなる。
- 登録済みかどうかは、`savedWorkFilters(target: EXECUTION_SCHEDULE) { id name reportTemplate { originalFileName uploadedAt } }` / `facilityReportTemplate(facilityId:) { originalFileName uploadedAt status }` で見る。

### 出力して確かめる

出力は GraphQL ではなく REST。`api-gateway` スキルの `gw_request.py` でダウンロードする。

```sh
GW=$(ls ${CLAUDE_SKILL_DIR}/../*api-gateway/scripts/gw_request.py)
python3 $GW GET bm-next '/api/works/saved-filters/<保存済みフィルタの ID>/report' -q yearMonth=2026-10 -o schedule.xlsx
python3 $GW GET bm-next '/api/meter-reading/facilities/<施設の ID>/reports/202610/export' -o meter.xlsx
```

- 作業予定: `yearMonth` は `yyyy-MM`。テンプレート未登録は 404、予定が未作成の月は 409、機能フラグが無いと 403。
- 検針表: 月は `yyyyMM`。テンプレートが無いか機能フラグが無いと、エラーではなく CSV が返る(`Content-Type` を見る)。全施設をまとめて出すときは `/api/meter-reading/reports/202610/export-all`(zip)。
- 出力した `.xlsx` は `openpyxl` で開いて、トークンが残っていないか、行数が件数と合うかを確かめる。数式の結果は Excel で開くまで計算されない(`openpyxl` では値が空に見える)。
