# Google Analytics API リファレンス

## Data API(サービス `analytics`、パスは `/v1beta`)

| 操作 | メソッドとパス |
| --- | --- |
| レポート | `POST /v1beta/properties/{id}:runReport` |
| 複数のレポート | `POST /v1beta/properties/{id}:batchRunReports` |
| リアルタイム | `POST /v1beta/properties/{id}:runRealtimeReport` |
| 使える項目の一覧 | `GET /v1beta/properties/{id}/metadata`(ID を `0` にすると全プロパティ共通の項目だけ) |
| 組み合わせの検査 | `POST /v1beta/properties/{id}:checkCompatibility`(本文は `runReport` の `dimensions` / `metrics` / フィルターと同じ。`compatibilityFilter: "COMPATIBLE"` で使える項目だけ返る) |

## よく使う項目

ディメンション: `date`、`yearMonth`、`country`、`city`、`deviceCategory`、`sessionDefaultChannelGroup`、`sessionSource`、`sessionMedium`、`sessionCampaignName`、`pagePath`、`pageTitle`、`landingPage`、`eventName`、`hostName`。

指標: `sessions`、`activeUsers`、`newUsers`、`totalUsers`、`screenPageViews`、`engagedSessions`、`engagementRate`、`averageSessionDuration`、`bounceRate`、`eventCount`、`keyEvents`(キーイベントの数)、`totalRevenue`。

名前はプロパティの設定で変わることがあるので、迷ったら `metadata` を `grep` する。

## フィルター

`dimensionFilter` と `metricFilter` に書く。

```json
{"dimensionFilter": {"filter": {"fieldName": "pagePath", "stringFilter": {"matchType": "BEGINS_WITH", "value": "/blog/"}}}}
```

- 複数の条件は `andGroup` / `orGroup` / `notExpression` の `expressions` に入れる。
- `matchType` は `EXACT`、`BEGINS_WITH`、`ENDS_WITH`、`CONTAINS`、`FULL_REGEXP`、`PARTIAL_REGEXP`。
- 大文字小文字の区別は `caseSensitive`(既定 false)。
- 一覧から選ぶときは `inListFilter` の `values`。数値は `numericFilter`(`operation` は `EQUAL`、`LESS_THAN`、`LESS_THAN_OR_EQUAL`、`GREATER_THAN`、`GREATER_THAN_OR_EQUAL`。`value` は `{"int64Value": "100"}` か `{"doubleValue": 4.2}`)。範囲は `betweenFilter`(`fromValue` と `toValue`、両端を含む)。
- `emptyFilter` は空文字と `(not set)` に一致する。除外するなら `notExpression` で包む。
- 1 つの `FilterExpression` にディメンションと指標は混ぜられない。`dimensionFilter` と `metricFilter` に分ける。

## Admin API(サービス `analytics-admin`、パスは `/v1beta`)

| 操作 | メソッドとパス |
| --- | --- |
| アカウントとプロパティの一覧 | `GET /v1beta/accountSummaries` |
| アカウントの一覧 | `GET /v1beta/accounts` |
| プロパティの一覧 | `GET /v1beta/properties?filter=parent:accounts/{accountId}`(`filter` は必須。`ancestor:accounts/...` や `firebase_project:...` も使える。`showDeleted=true` で削除済みも含む) |
| プロパティの詳細 | `GET /v1beta/properties/{id}` |
| データストリーム | `GET /v1beta/properties/{id}/dataStreams` |
| カスタムディメンション | `GET /v1beta/properties/{id}/customDimensions` |
| カスタム指標 | `GET /v1beta/properties/{id}/customMetrics` |
| キーイベント | `GET /v1beta/properties/{id}/keyEvents` |

一覧はどれも `pageSize` と `pageToken` でページングする。`properties` の一覧は既定 50 件、最大 200 件。応答の `nextPageToken` が空になるまで繰り返す。
