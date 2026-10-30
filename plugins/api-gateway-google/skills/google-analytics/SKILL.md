---
name: google-analytics
description: Google アナリティクス 4(GA4)のレポート取得とプロパティの参照を API Gateway MCP 経由で行う。ページビュー・セッション・ユーザー数・コンバージョンなどの指標をディメンション別・期間別に集計する(Data API)、リアルタイムのアクティブユーザーを見る、アカウントとプロパティの一覧・データストリーム・カスタムディメンションを調べる(Admin API)。「先月のセッション数を流入元別に出して」「人気ページ上位 20 を見たい」「GA のプロパティ ID を調べて」「いまサイトに何人いる?」など、ゲートウェイに登録された Google アカウントの GA4 のデータを読む依頼で使う。読み取り専用。
---

# Google Analytics API

GA4 の API はホストが 2 つに分かれていて、ゲートウェイのサービスも 2 つある。

| サービス | 用途 | 上流 |
| --- | --- | --- |
| `analytics` | レポートの取得(Data API) | `analyticsdata.googleapis.com` |
| `analytics-admin` | アカウント・プロパティ・データストリームなどの参照(Admin API) | `analyticsadmin.googleapis.com` |

`api-gateway` スキルで、使うサービスの認証情報を選んで `issue_token` する。両方使うときは、サービスごとにトークンを発行して `GW_TOKEN` / `GW_BASE_URL` を切り替える。接続はサービスごとに 1 つ。複数の組織のゲートウェイがつながっていれば、`api-gateway` スキルの「コネクタの選び方」で組織のコネクタを選ぶ。

スコープは `analytics.readonly` だけ。読み取り専用で、プロパティの作成や設定の変更はできない。

## プロパティ ID を調べる

レポートには数字のプロパティ ID が要る(GA の管理画面の「プロパティの詳細」にある)。ユーザーが知らなければ Admin API で探す。測定 ID(`G-XXXX`)やアカウント ID とは別物。

```sh
GW="${CLAUDE_SKILL_DIR}/scripts/gw_request.py"
python3 "$GW" GET analytics-admin /v1beta/accountSummaries
```

応答の `propertySummaries[].property` が `properties/123456789`。この `123456789` をレポートのパスに使う。

## レポートを取る

```sh
python3 "$GW" POST analytics /v1beta/properties/123456789:runReport --json '{
  "dateRanges": [{"startDate": "2026-09-01", "endDate": "2026-09-30"}],
  "dimensions": [{"name": "sessionDefaultChannelGroup"}],
  "metrics": [{"name": "sessions"}, {"name": "activeUsers"}],
  "orderBys": [{"metric": {"metricName": "sessions"}, "desc": true}],
  "limit": 20
}'
```

- 日付は `YYYY-MM-DD` のほか、`today`、`yesterday`、`30daysAgo` が使える。
- `dimensions` と `metrics` は名前の組み合わせに制約がある。使えるかは `:checkCompatibility` で確かめられる。名前の一覧は、プロパティごとのカスタム定義を含めて `GET /v1beta/properties/123456789/metadata` で取る。
- 応答は `dimensionHeaders`、`metricHeaders`、`rows`(各行の `dimensionValues` と `metricValues` は `value` の文字列)、`rowCount`、`metadata`。数値も文字列で返る。
- 行が多いときは `limit`(既定 10000、最大 250000)と `offset` でページングし、`rowCount` に届くまで繰り返す。
- 値がすべて 0 の行は既定で返らない。含めるなら `"keepEmptyRows": true`。
- 合計は `metricAggregations: ["TOTAL"]` で一緒に取れる。
- 前期間との比較は `dateRanges` を 2 つ渡す。行に `dateRange` のディメンションが付く。

リアルタイムは `POST /v1beta/properties/{id}:runRealtimeReport`(標準のプロパティは直近 30 分。`dateRanges` は使わず、`minuteRanges` で範囲を絞る。最大 2 つで、`startMinutesAgo` は 29 まで)。複数のレポートは `:batchRunReports` に `requests` で最大 5 件まとめて送れる。各リクエストの `property` は省くか、パスと同じにする。

よく使う名前、フィルターの書き方、Admin API のパスは [references/api.md](references/api.md) にある。必要な節だけ `grep` で読む。

## エラーと制限

- 403 は、接続した Google アカウントがそのプロパティを閲覧できないか、該当の API(Google Analytics Data API / Admin API)が Google Cloud のプロジェクトで有効になっていない。エラー本文を確認する。
- 400 の `Field ... is not a valid dimension/metric` は名前の間違い。`metadata` で調べ直す。互換性のない組み合わせも 400 になる。
- 429 や `RESOURCE_EXHAUSTED` はクォータ。標準プロパティは、プロパティごとに 1 日 20 万トークン、1 時間 4 万トークン、同時 10 リクエスト。Google Cloud のプロジェクトごとでは、プロパティあたり 1 時間 1 万 4 千トークン、サーバーエラーは 1 時間 10 回まで。重いレポート(期間が長い、ディメンションが多い)ほど消費が大きいので、期間と項目を絞る。クォータの消費は `"returnPropertyQuota": true` を付けると応答の `propertyQuota` で見える。
- データの処理には 24〜48 時間かかり、その間は数字があとから動く。ユニーク数(アクティブユーザーやセッション)は HLL++ による近似値で、管理画面とも少しずれることがある。リアルタイムは数分で反映される。
- ゲートウェイの再接続エラーは案内された URL を使う。
