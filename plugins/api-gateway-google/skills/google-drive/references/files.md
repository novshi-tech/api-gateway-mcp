# ファイル操作

## 検索と共有ドライブ

GET `/drive/v3/files` の `q` は Drive の式。例: `trashed=false and name contains '請求書'`、`'<folder-id>' in parents and trashed=false`、`mimeType='application/vnd.google-apps.folder'`。名前検索は `name`、本文なども含む検索は `fullText`。値中のシングルクォート・バックスラッシュはエスケープする。`fields=files(id,name,mimeType,parents,size,modifiedTime,webViewLink),nextPageToken,incompleteSearch` など必要な項目を選ぶ。

`pageSize` は最大1000。結果のページが空でも `nextPageToken` がある限り続ける。全件取得は `drive_all.py`、件数を絞る場合は単発呼び出しを使う。

共有ドライブは GET `/drive/v3/drives` で ID を調べる。対象のドライブ内検索は `corpora=drive`, `driveId=<id>`, `includeItemsFromAllDrives=true`, `supportsAllDrives=true` を指定する。ファイルの取得・更新や permissions の操作も、対応するメソッドには `supportsAllDrives=true` を付ける。`incompleteSearch=true` のときは検索範囲を個別のドライブに絞る。

[検索式](https://developers.google.com/workspace/drive/api/guides/search-files)、[files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)、[共有ドライブ](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives)。

## ダウンロードとエクスポート

PDF / 画像など通常のファイルは GET `/drive/v3/files/{id}` に `alt=media` を指定し、`gw_request.py -o` で保存する。

Google 文書は GET `/drive/v3/files/{id}/export` に `mimeType` を指定する。Docs → PDF は `application/pdf`、Docs → DOCX は `application/vnd.openxmlformats-officedocument.wordprocessingml.document`、Sheets → XLSX は `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`。CSV は最初のシートのみ。対応形式は `/drive/v3/about?fields=exportFormats` で確認できる。通常の `files.export` は出力サイズ10MBまで。

```sh
python3 "$GW" GET drive /drive/v3/files/{id}/export -q mimeType=application/pdf -o document.pdf
```

[ダウンロード仕様](https://developers.google.com/workspace/drive/api/guides/manage-downloads)。

## 作成とアップロード

フォルダを作成: POST `/drive/v3/files` に `{"name":"請求書","mimeType":"application/vnd.google-apps.folder","parents":["<folder-id>"]}` を送る。

小さい通常ファイルはメディアの単純アップロードで作成後、メタデータを PATCH する方法が使える。作成のレスポンスの ID を使い、既存ファイルを上書きしない。

```sh
python3 "$GW" POST drive /upload/drive/v3/files -q uploadType=media -q 'fields=id,parents' --data invoice.pdf -H Content-Type=application/pdf -o created.json
# created.json の id と parents を使う。元の親を外して移動する。
python3 "$GW" PATCH drive /drive/v3/files/{created-id} -q addParents={folder-id} -q removeParents={old-parent-id} -q 'fields=id,name,parents' --json '{"name":"invoice.pdf"}'
```

名前や親フォルダを作成時に設定するなら `uploadType=multipart` の `multipart/related` を組み立てて `--data` と Content-Type で送る。`gw_request.py --file` が作る `multipart/form-data` は Drive のこの形式と異なる。大きなファイルや中断に備える場合は resumable upload を使う。Location の URL をそのまま呼ばず、`www.googleapis.com` の upload パスとクエリをサービス `drive` に付け替える。別ホストなら転送前に仕様を確認する。[アップロード仕様](https://developers.google.com/workspace/drive/api/guides/manage-uploads)。

## メタデータ・移動・共有

- メタデータ取得: GET `/drive/v3/files/{id}`、`fields=id,name,mimeType,parents,capabilities,webViewLink`。
- 名前変更・ゴミ箱: PATCH `/drive/v3/files/{id}` に `{"name":"..."}` / `{"trashed":true}`。復元は false。
- 移動: 先に parents を取得し、PATCH に `addParents=<new-id>` と `removeParents=<old-id>`。`parents` をボディに書いて置き換えない。
- コピー: POST `/drive/v3/files/{id}/copy` に `{"name":"...","parents":["<folder-id>"]}`。
- 共有状態: GET `/drive/v3/files/{id}/permissions`、`fields=permissions(id,type,role,emailAddress,domain),nextPageToken`。
- ユーザーに共有: POST `/drive/v3/files/{id}/permissions` に `{"type":"user","role":"reader","emailAddress":"recipient@example.com"}`。編集は writer。通知メールを送るかはユーザーの指示と `sendNotificationEmail` で決める。
- DELETE `/drive/v3/files/{id}` は完全削除。ゴミ箱への移動とは別の操作なので、明示的な依頼がある場合だけ行う。

[Files API](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)、[Permissions API](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions)。
