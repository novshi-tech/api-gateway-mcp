# メール(Outlook)

例の `$GW` は `api-gateway` スキルの `gw_request.py`。パスはすべて `/v1.0` から書く。

## 一覧と絞り込み($filter)

```
GET /v1.0/me/messages                          # 全フォルダ
GET /v1.0/me/mailFolders/{folder}/messages     # フォルダ指定。inbox、sentitems、drafts、archive などの既定名か ID
```

- `$select`: 例 `id,subject,from,receivedDateTime,isRead,hasAttachments`。指定しないと本文まで返って重い。
- `$filter`: OData の式。複数条件は `and` でつなぐ。
  - `isRead eq false`、`hasAttachments eq true`、`importance eq 'high'`
  - `from/emailAddress/address eq 'user@example.com'`(入れ子は `/` 区切り)
  - `receivedDateTime ge 2026-09-01T00:00:00Z`(日時は UTC の ISO 8601)
- `$orderby`: 例 `receivedDateTime desc`。`$filter` と併用するときは、`$orderby` のプロパティを `$filter` にも(先頭に)含めないと、複雑すぎるという 400 になることがある。
- `$top`: 1 ページの件数。全件は `graph_all.py` で `@odata.nextLink` をたどる。

```sh
python3 $GW GET graph /v1.0/me/messages \
  -q '$filter=receivedDateTime ge 2026-09-01T00:00:00Z and hasAttachments eq true' \
  -q '$orderby=receivedDateTime desc' \
  -q '$select=id,subject,from,receivedDateTime' -q '$top=25'
```

## キーワード検索($search)

```sh
python3 $GW GET graph /v1.0/me/messages -q '$search="請求書"' -q '$select=id,subject,from,receivedDateTime,hasAttachments' -q '$top=25'
python3 $GW GET graph /v1.0/me/messages -q '$search="from:billing@example.com AND subject:請求"'
```

- 値はダブルクォートで囲む。KQL(`from:`、`subject:`、`hasAttachments:true`、`received>=2026-09-01` など)が使える。
- `$search` は `$filter` とも `$orderby` とも同時に使えない。結果は関連度順で返る。日付で絞りたいときは KQL の `received` を使うか、取得後に絞る。

## 1 件の取得

```
GET /v1.0/me/messages/{id}
```

本文が要るときは `$select` に `body` を含める(`body.contentType` は `text` か `html`)。`uniqueBody` は引用を除いた本文。メールの `id` は、フォルダを移動すると変わることがある。

## 添付ファイル

```
GET /v1.0/me/messages/{id}/attachments                   # 一覧(name、contentType、size、@odata.type)
GET /v1.0/me/messages/{id}/attachments/{attachment-id}/$value   # 本体(ファイル添付のみ)
```

一覧で `$select=id,name,contentType,size` を指定すると、`contentBytes`(base64)を省ける。本体は `$value` をファイルに保存する。

```sh
python3 $GW GET graph /v1.0/me/messages/{id}/attachments -q '$select=id,name,contentType,size'
python3 $GW GET graph '/v1.0/me/messages/{id}/attachments/{attachment-id}/$value' -o invoice.pdf
```

- `@odata.type` が `#microsoft.graph.fileAttachment` のものがファイル。`itemAttachment`(添付されたメールや予定)と `referenceAttachment`(OneDrive などへのリンク)は扱いが違う。リンクの場合は、リンク先を [files.md](files.md) の手順で取得する。
- `$value` のパスは `$` を含むので、シングルクォートで囲む。

## 送信

```sh
python3 $GW POST graph /v1.0/me/sendMail --json '{
  "message": {
    "subject": "件名",
    "body": {"contentType": "text", "content": "本文"},
    "toRecipients": [{"emailAddress": {"address": "user@example.com"}}]
  },
  "saveToSentItems": true
}'
```

- 成功すると 202 で、ボディは空。
- `ccRecipients`、`bccRecipients` も同じ形の配列。
- 添付を付けるときは、`message.attachments` に `{"@odata.type": "#microsoft.graph.fileAttachment", "name": "...", "contentBytes": "<base64>"}` を入れる。base64 はスクリプトでファイルから組み立て、`--json @body.json` で渡す(会話に貼らない)。この方法はリクエスト全体でおよそ 3MB まで。それより大きいファイルは、下書きを作って `createUploadSession` でアップロードする必要があり、このスキルでは扱わない。

## 返信と下書き

```
POST /v1.0/me/messages/{id}/createReply        # 送信者への返信の下書きを作る
POST /v1.0/me/messages/{id}/createReplyAll     # 全員への返信の下書き
PATCH /v1.0/me/messages/{draft-id}             # 下書きの本文などを変える
POST /v1.0/me/messages/{draft-id}/attachments  # 下書きに添付を足す(1 回に 1 ファイル、上の 3MB の制限)
POST /v1.0/me/messages/{draft-id}/send         # 送信(202)
DELETE /v1.0/me/messages/{draft-id}            # 途中で失敗したら下書きを消す
```

本文だけの返信なら、`POST /v1.0/me/messages/{id}/reply` に `{"comment": "本文"}` を送れば 1 回で済む。書式を整えたい、添付を付けたいときは下書きの手順を使う。ユーザーに確認してもらうため、送信せず下書きのまま残してもよい。

## 移動・既読

```sh
python3 $GW POST graph /v1.0/me/messages/{id}/move --json '{"destinationId": "archive"}'
python3 $GW PATCH graph /v1.0/me/messages/{id} --json '{"isRead": true}'
```

`move` のレスポンスは移動後のメッセージで、`id` が変わる。フォルダの一覧は `GET /v1.0/me/mailFolders`。
