# 予定と空き時間

以下のパスはサービス `calendar` に対する上流パス。`C=/calendar/v3/calendars/{calendar-id}` とする。メールアドレス形式のカレンダー ID は1つのパス要素として URL エンコードする。`event-id` は API の `id` であり、`iCalUID` とは異なる。

| 操作 | メソッド / パス | 主な指定 |
|---|---|---|
| カレンダー一覧 | GET `/calendar/v3/users/me/calendarList` | items の id, primary, timeZone, accessRole |
| 予定一覧・検索 | GET `{C}/events` | timeMin, timeMax, singleEvents, orderBy, q |
| 予定取得 | GET `{C}/events/{event-id}` | 詳細、attendees、etag |
| 予定作成 | POST `{C}/events` | JSON の summary, start, end, attendees |
| 一部更新 | PATCH `{C}/events/{event-id}` | 変更するフィールドのみ |
| 予定削除 | DELETE `{C}/events/{event-id}` | sendUpdates |
| 繰り返しの各回 | GET `{C}/events/{series-id}/instances` | timeMin, timeMax |
| 空き時間の確認 | POST `/calendar/v3/freeBusy` | timeMin, timeMax, timeZone, items |

## 日時と一覧

`timeMin` / `timeMax` はオフセット付き RFC3339。予定の終了が timeMin より後、開始が timeMax より前なら検索対象になるため、境界をまたぐ予定も含む。q は自由文検索で、Gmail の `from:` のような式ではない。予定一覧は最大2500件/ページ。`singleEvents=true` は繰り返しを展開し、`orderBy=startTime` と組み合わせる。

時刻のある予定は `start.dateTime` / `end.dateTime`、終日予定は `start.date` / `end.date` を使う。終日予定の end.date は含まない日: 10月1日の1日だけなら start=2026-10-01, end=2026-10-02。ユーザーのタイムゾーンを尊重し、指定がなければカレンダーの timeZone を基準にする。繰り返しでは IANA タイムゾーンも設定する。

`status=cancelled` は通常の予定として扱わない。閲覧権限によっては予定の詳細が隠れる。空白や非公開の件名を勝手に推測しない。[一覧 API](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)。

## 作成と通知

例の日時・参加者はユーザーの依頼に置き換え、event.json に保存する。

```json
{
  "summary": "打ち合わせ",
  "start": {"dateTime": "2026-10-01T10:00:00+09:00", "timeZone": "Asia/Tokyo"},
  "end": {"dateTime": "2026-10-01T11:00:00+09:00", "timeZone": "Asia/Tokyo"},
  "attendees": [{"email": "participant@example.com"}]
}
```

```sh
python3 "$GW" POST calendar /calendar/v3/calendars/primary/events -q sendUpdates=all --json @event.json
```

`sendUpdates=all` は全参加者、`externalOnly` は Google Calendar を利用していない参加者への通知。`none` は通知を抑えるが、外部カレンダーへの同期に支障が出る場合がある。参加者への招待・通知を含めたユーザーの意図に沿って選ぶ。作成後は id / htmlLink を保存する。重複作成を避けるには、仕様を満たすクライアント生成 id を固定して使う方法もある。[作成 API](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)。

## 更新・削除・出欠回答

更新前に GET して現在の内容と etag を保存する。PATCH は変更部分だけを送る。必要なら `-H 'If-Match=<etag>'` を付け、412 のときは再取得して変更内容を確認する。PUT はリソース全体を置き換えるため、部分更新には使わない。

PATCH でも attendees / recurrence など配列は全体が置き換わる。出欠回答では最新の attendees から `self=true` の参加者を特定し、その `responseStatus` を accepted / tentative / declined に変更する。他の参加者と属性を保持して配列全体を送る。自分を特定できない場合は他人の回答を書き換えない。更新・削除時も通知の指定を確認する。[PATCH API](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)。

## 繰り返し予定

全体を変更するならシリーズの id、1回だけなら instances で得た回の id を操作する。回には `recurringEventId` と `originalStartTime` がある。「今回」「全体」「これ以降」を区別し、ユーザーの指定が曖昧なら確認する。「これ以降」はシリーズの分割が必要になり得るため、親イベント全体の更新で代用しない。[繰り返しの仕様](https://developers.google.com/workspace/calendar/api/guides/recurringevents)。

## 空き時間

freebusy.json を作り POST `/calendar/v3/freeBusy` する。

```json
{
  "timeMin": "2026-10-01T09:00:00+09:00",
  "timeMax": "2026-10-01T18:00:00+09:00",
  "timeZone": "Asia/Tokyo",
  "items": [{"id": "primary"}]
}
```

レスポンスの `calendars.<id>.busy` は予定のある区間。検索区間から全対象の busy の和集合を引き、希望の長さ、勤務時間、タイムゾーンで候補を絞る。HTTP 200 でも calendars / groups ごとの errors を確認する。取得できないカレンダーを空き時間と扱わない。1リクエストの展開は最大50カレンダー。[空き時間 API](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)。
