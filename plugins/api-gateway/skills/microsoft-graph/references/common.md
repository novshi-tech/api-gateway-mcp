# ページング・クエリ・エラー

例の `$GW` は `api-gateway` スキルの `gw_request.py`。

## ページング

一覧は次の形で返る。`@odata.nextLink` は次のページがあるときだけ付く。

```json
{"value": [ ... ], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?%24skip=10&..."}
```

- `@odata.nextLink` は Graph の絶対 URL。直接呼ぶとゲートウェイを通らないので、呼ばない。パスとクエリだけをゲートウェイに付け替える。`graph_all.py` がこれを行う。
- 手で次のページを取るときは、nextLink の `https://graph.microsoft.com` を除いた残り(`/v1.0/...?...`)を、そのまま `gw_request.py` のパスに渡す(`-q` に分け直さない)。`$skiptoken` などの中身を自分で組み立てない。
- 総件数は既定では返らない。`$count=true` を付けると `@odata.count` が返るエンドポイントもある(ヘッダー `ConsistencyLevel: eventual` が要るものがある)。

```sh
python3 ${CLAUDE_SKILL_DIR}/scripts/graph_all.py /v1.0/me/messages \
  -q '$filter=hasAttachments eq true' -q '$select=id,subject,receivedDateTime' -q '$top=100' -o messages.json
python3 ${CLAUDE_SKILL_DIR}/scripts/graph_all.py /v1.0/me/messages -q '$select=id,subject,from' --csv id,subject,from.emailAddress.address
```

`graph_all.py` は既定で 50 ページで止まる(`--max-pages` で変える)。`--csv` の項目名は `.` で入れ子をたどる。

## OData のクエリ

| パラメータ | 使い方 |
|---|---|
| `$select` | 返す項目をカンマ区切りで指定する。入れ子の一部だけは選べない |
| `$filter` | `eq`、`ne`、`gt`、`ge`、`lt`、`le`、`and`、`or`、`startswith(subject,'請求')` など。文字列はシングルクォート |
| `$orderby` | 例 `receivedDateTime desc` |
| `$top` | 1 ページの件数。上限はリソースで違う |
| `$search` | キーワード検索(メールなど対応するものだけ)。`$filter` や `$orderby` と併用できないことが多い |
| `$expand` | 関連するリソースを一緒に取る(例 `$expand=attachments`、`$expand=members`) |

`$` を含む引数はシングルクォートで囲む。空白や日本語は `gw_request.py` がエンコードする。

## エラー

ゲートウェイ自身のエラーは `{"error": "<文字列>"}`。

| ステータス | 本文 | 対応 |
|---|---|---|
| 401 | `missing gateway token` / `invalid or expired gateway token` | トークンを発行し直す(寿命 15 分) |
| 403 | `token does not cover service: graph` | `issue_token` に graph の認証情報を含めて発行し直す |
| 403 | `credential must be reconnected by the user at ...` | その URL でユーザーに Microsoft アカウントを接続し直してもらう |
| 502 | `could not refresh the upstream access token; ...` | 少し待って再試行。続くなら接続し直してもらう |

Graph のエラーは `{"error": {"code": "...", "message": "...", "innerError": {"request-id": "..."}}}`。分岐は `code` で見る。

| ステータス | よくある `code` | 意味 |
|---|---|---|
| 400 | `BadRequest`、`ErrorInvalidProperty` など | OData の書き方、日時の形式、JSON の誤り |
| 401 | `InvalidAuthenticationToken` | 上流のトークンの問題。ゲートウェイの接続をやり直してもらう |
| 403 | `ErrorAccessDenied`、`accessDenied`、`Forbidden` | 権限の範囲外、またはそのファイル・メールボックス・チャネルに権限がない |
| 404 | `ErrorItemNotFound`、`itemNotFound` | ID やパスの誤り、削除済み |
| 409 | `nameAlreadyExists` など | 同じ名前がある(`conflictBehavior: fail`) |
| 413 | | ボディが大きすぎる。添付やアップロードのサイズを確かめる |
| 429 / 503 | `TooManyRequests`、`serviceNotAvailable` | `Retry-After` の秒数だけ待って再試行する |

## スロットリング

上限は公開された固定値ではなく、テナント・アプリ・リソースごとに変わる。429 が返ったら `Retry-After` に従う。同じ一覧を何度も取らず、ファイルに保存して使い回す。メールの大量処理や送信は特に制限されやすい。

## $batch

最大 20 件のリクエストを 1 回にまとめられる。サブリクエストの `url` は `/v1.0` を除いた相対パスで書く。

```sh
python3 $GW POST graph '/v1.0/$batch' --json '{"requests": [
  {"id": "1", "method": "GET", "url": "/me/messages?$top=5&$select=id,subject"},
  {"id": "2", "method": "GET", "url": "/me/events?$top=5&$select=id,subject"}
]}'
```

結果は `responses[]`(`id`、`status`、`body`)で、順番は保証されない。各サブリクエストの成否は `status` で確かめる。
