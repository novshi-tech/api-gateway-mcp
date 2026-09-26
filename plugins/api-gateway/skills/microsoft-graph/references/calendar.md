# 予定表

例の `$GW` は `api-gateway` スキルの `gw_request.py`。パスはすべて `/v1.0` から書く。

## タイムゾーン

- 予定の `start` / `end` は `{"dateTime": "2026-09-28T10:00:00", "timeZone": "Tokyo Standard Time"}` の形。`dateTime` にはオフセットを付けず、`timeZone` を別に書く。`timeZone` は Windows の名前(`Tokyo Standard Time`)か IANA の名前(`Asia/Tokyo`)。
- 読み取りの結果は、既定では UTC で返る。ヘッダー `Prefer: outlook.timezone="Tokyo Standard Time"` を付けると、その時間帯で返る。
- 作成・更新では `timeZone` を必ず書く。実行環境の時間帯(UTC のことが多い)とユーザーの時間帯を取り違えない。ユーザーの設定は `GET /v1.0/me/mailboxSettings` の `timeZone`。

## 期間内の予定(calendarView)

```sh
python3 $GW GET graph /v1.0/me/calendarView \
  -q startDateTime=2026-09-28T00:00:00+09:00 -q endDateTime=2026-10-05T00:00:00+09:00 \
  -q '$select=id,subject,start,end,location,organizer,isAllDay,isCancelled' -q '$orderby=start/dateTime' -q '$top=100' \
  -H 'Prefer=outlook.timezone="Tokyo Standard Time"'
```

- 「今週の予定」のように期間で見るときは `calendarView` を使う。定期的な予定も回ごとに展開される。
- `GET /v1.0/me/events` は予定そのものの一覧で、定期的な予定は元の 1 件だけが返る。期間の確認には向かない。
- 特定の予定表は `/v1.0/me/calendars/{calendar-id}/calendarView`。予定表の一覧は `GET /v1.0/me/calendars`(`isDefaultCalendar` が既定)。

## 1 件の取得

```
GET /v1.0/me/events/{id}
```

説明文は `body`、参加者と返答は `attendees[].status.response`、オンライン会議の URL は `onlineMeeting.joinUrl`。

## 作成

```sh
python3 $GW POST graph /v1.0/me/events --json '{
  "subject": "打合せ",
  "start": {"dateTime": "2026-09-30T14:00:00", "timeZone": "Tokyo Standard Time"},
  "end":   {"dateTime": "2026-09-30T15:00:00", "timeZone": "Tokyo Standard Time"},
  "location": {"displayName": "会議室A"},
  "body": {"contentType": "text", "content": "議題: ..."},
  "attendees": [{"emailAddress": {"address": "user@example.com"}, "type": "required"}],
  "isOnlineMeeting": true
}'
```

- `attendees` を入れると、参加者に招待が送られる。`type` は `required`、`optional`、`resource`(会議室など)。
- `isOnlineMeeting: true` で Teams 会議を付ける(組織で有効な場合)。
- 終日の予定は `isAllDay: true` にし、開始と終了を日付の 0 時にする(終了は翌日の 0 時)。
- 成功すると 201 で、作られた予定が返る。

## 更新・削除

```sh
python3 $GW PATCH graph /v1.0/me/events/{id} --json '{"start": {...}, "end": {...}}'
python3 $GW DELETE graph /v1.0/me/events/{id}
```

- `PATCH` は送った項目だけ変える。時刻を動かすときは `start` と `end` を両方送る。
- 主催者が削除すると、参加者に取り消しが通知される。主催者として取り消しの文面を送るなら `POST /v1.0/me/events/{id}/cancel`(`{"comment": "..."}`)。
- 招待された予定を断るときは、削除ではなく下の `decline` を使う。

## 招待への応答

```sh
python3 $GW POST graph /v1.0/me/events/{id}/accept --json '{"sendResponse": true, "comment": "参加します"}'
```

`accept`、`decline`、`tentativelyAccept` の 3 つ。`sendResponse: false` にすると、主催者に通知せず自分の予定表だけ変わる。自分が主催者の予定には使えない。
