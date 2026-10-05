---
name: google-calendar
description: Google Calendar のカレンダー一覧、予定の検索・取得・作成・更新・削除、会議への出欠回答と空き時間の確認を API Gateway MCP 経由で行う。ゲートウェイに登録された Google アカウントのカレンダーを操作する依頼で使う。
---

# Google Calendar API

`api-gateway` スキルでサービス `calendar` の認証情報を選び、`issue_token` が返した `token` / `base_url` を `GW_TOKEN` / `GW_BASE_URL` に設定する。上流の Google トークンはゲートウェイが管理する。ホストやアカウント名を固定しない。

複数の接続があれば `list_credentials` の `label` とユーザーの指定を照合する。指定済みの接続を使い、曖昧な場合だけ確認する。Gmail / Drive の認証情報とは別に選ぶ。同じ OAuth クライアント ID でも、同じアカウントへの接続とは限らない。

まず `/calendar/v3/users/me/calendarList` を取得し、`id`, `summary`, `primary`, `timeZone`, `accessRole` から対象カレンダーを決める。`primary` は選んだ接続アカウントのメインカレンダーを指す API キーワード。共有カレンダーは取得した ID を使う。名前は一意ではない。

## 呼び出す

単発の取得・作成・更新は共通の `gw_request.py`、カレンダーや予定の一覧のページングは `scripts/calendar_all.py` を使う。Python 標準ライブラリだけで動く。

```sh
GW=$(ls "${CLAUDE_SKILL_DIR}"/../*api-gateway/scripts/gw_request.py)
python3 "${CLAUDE_SKILL_DIR}/scripts/calendar_all.py" /calendar/v3/users/me/calendarList -q 'fields=items(id,summary,primary,timeZone,accessRole)' -o calendars.json
# 以下の日付・タイムゾーンは例。ユーザーの期間と対象カレンダーに合わせる。
python3 "${CLAUDE_SKILL_DIR}/scripts/calendar_all.py" /calendar/v3/calendars/primary/events -q timeMin=2026-10-01T00:00:00+09:00 -q timeMax=2026-10-08T00:00:00+09:00 -q singleEvents=true -q orderBy=startTime -q timeZone=Asia/Tokyo -o events.json
python3 "$GW" GET calendar /calendar/v3/calendars/primary/events/{event-id}
```

- パスは `/calendar/v3/...`。Google の `items` 配列と `nextPageToken` を使う。`calendar_all.py` は events / calendarList / instances の一覧を JSON 配列または CSV に保存する。
- `fields` を指定しても次ページのトークンはスクリプトが補う。空ページでもトークンがあれば続ける。`--max-pages` の警告があれば全件取得と報告しない。
- 期間のある予定一覧は `timeMin` / `timeMax`、`singleEvents=true`、`orderBy=startTime` を指定し、繰り返し予定を回ごとに展開する。繰り返し予定の無制限な展開を避けるため、期間を絞る。
- 日時のオフセットとタイムゾーン、終日予定の終了日、繰り返し予定の変更範囲に注意する。詳細は下のリファレンスを読む。
- この一覧スクリプトは `nextSyncToken` を保存しない。差分同期が必要ならレスポンス全体を別に保存する。

## 詳細

一覧・検索、日時、空き時間、作成・更新・削除、出欠回答、繰り返し予定: [references/events.md](references/events.md)。

## 実行範囲とエラー

予定の作成・更新・削除・出欠回答や招待通知はユーザーの依頼の範囲で行う。日時、カレンダー、参加者、繰り返しの変更範囲が曖昧なら確認する。指定済みの操作に重ねて承認を求めない。作成がタイムアウトした場合は、作成済みか確認してから再試行する。

スコープは `calendar.events`、`calendar.calendarlist.readonly`、`calendar.events.freebusy`。カレンダー自体の作成や ACL による共有権限の変更は含めない。403 はカレンダーへのアクセス権と Google のエラー本文を確認する。ゲートウェイの再接続エラーは案内された URL を使う。429 / 503 の GET は付属の一覧スクリプトが上限付きで再試行する。
