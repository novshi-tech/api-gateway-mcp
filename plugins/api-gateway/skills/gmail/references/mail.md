# 検索・取得・添付・ラベル

`U=/gmail/v1/users/me` として、以下のパスを共通の `gw_request.py` に渡す。

| 操作 | メソッド / パス | 指定 |
|---|---|---|
| アカウント確認 | GET `{U}/profile` | `emailAddress` |
| メール検索 | GET `{U}/messages` | `q`, `maxResults` (最大500), `pageToken`, `labelIds`, `includeSpamTrash` |
| メール取得 | GET `{U}/messages/{id}` | `format=full` / `metadata` / `raw` |
| スレッド検索・取得 | GET `{U}/threads`, `{U}/threads/{id}` | 一覧は `q`、取得は `format` |
| 添付の取得 | GET `{U}/messages/{id}/attachments/{attachment-id}` | JSON の `data` は base64url |
| ラベル一覧 | GET `{U}/labels` | ID と名前の対応 |
| ラベル変更 | POST `{U}/messages/{id}/modify` | `addLabelIds`, `removeLabelIds` の配列 |
| ゴミ箱へ移動 / 戻す | POST `{U}/messages/{id}/trash`, `/untrash` | ボディ不要 |

## 検索

`q` は Gmail の検索式: `from:sender@example.com`, `to:recipient@example.com`, `subject:請求書`, `has:attachment`, `filename:pdf`, `is:unread`, `after:2026/09/01 before:2026/10/01`。複数条件は空白で結合し、シェルでは `-q 'q=...'` として渡す。API は UI の別名展開やスレッド単位の検索と挙動が異なる。日付だけの境界は米国太平洋時間で解釈されるため、厳密な日本時間の範囲には Unix 秒を使う。

[検索仕様](https://developers.google.com/workspace/gmail/api/guides/filtering)、[messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)。

## 本文と添付

`format=full` の `payload.headers` から Subject / From / To / Date / Message-ID を読む。本文は `payload.body.data` または再帰的な `payload.parts` 内の `text/plain` / `text/html`。base64url を復号し、Content-Type の charset に従って文字列にする。HTML のみの場合は表示用テキストに変換し、snippet を全文と扱わない。

添付は parts を再帰的に探す。`filename` があるパートの `body.data` を直接復号するか、`body.attachmentId` で取得する。JSON をそのまま PDF として保存しない。

```sh
python3 "$GW" GET gmail /gmail/v1/users/me/messages/{id}/attachments/{attachment-id} -o attachment.json
python3 "${CLAUDE_SKILL_DIR}/scripts/gmail_mime.py" decode attachment.json -o invoice.pdf
```

`decode` は `{data: ...}` または `format=raw` の `{raw: ...}` を復号する。インラインのパートなら `body` オブジェクトを JSON に保存して渡す。出力名はローカルで決め、メール由来の名前をそのままパスとして使わない。[添付 API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get)。

## ラベル

既読にする: `modify` に `{"removeLabelIds":["UNREAD"]}`。アーカイブ: `{"removeLabelIds":["INBOX"]}`。ユーザーラベルは一覧で取得した ID を指定する。メールの Gmail ID と RFC の Message-ID は別物。
