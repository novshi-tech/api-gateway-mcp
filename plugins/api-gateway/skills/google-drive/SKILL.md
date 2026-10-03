---
name: google-drive
description: Google Drive のファイル・フォルダの検索、一覧、ダウンロード、Google 文書のエクスポート、アップロード、移動、共有を API Gateway MCP 経由で行う。ゲートウェイに登録された Google アカウントの Drive を操作する依頼で使う。
---

# Google Drive API

`api-gateway` スキルでサービス `drive` の認証情報を選び、`issue_token` の `token` と `base_url` を `GW_TOKEN` / `GW_BASE_URL` に設定する。上流の Google トークンはゲートウェイが管理する。

複数の接続があれば `list_credentials` の `label` をユーザーの指定と照合する。ユーザーが指定済みの接続を使い、曖昧な場合だけ確認する。`GET /drive/v3/about` に `fields=user` を指定すると接続アカウントを確認できる。Gmail の認証情報とは別に選ぶ。同じ OAuth クライアント ID でも、接続したアカウントが同じとは限らない。

## 呼び出す

単発の取得・更新・アップロードは共通の `gw_request.py`、一覧のページングは `scripts/drive_all.py` を使う。Python 標準ライブラリだけで動く。

```sh
GW=$(ls "${CLAUDE_SKILL_DIR}"/../*api-gateway/scripts/gw_request.py)
python3 "$GW" GET drive /drive/v3/about -q fields=user
python3 "${CLAUDE_SKILL_DIR}/scripts/drive_all.py" /drive/v3/files -q "q=trashed=false and name contains '請求書'" -q 'fields=files(id,name,mimeType,parents,webViewLink),incompleteSearch' -q pageSize=100 -o files.json
python3 "$GW" GET drive /drive/v3/files/{file-id} -q alt=media -o invoice.pdf
```

- 通常の API は `/drive/v3/...`、アップロードは `/upload/drive/v3/...`。両方ともサービス `drive` を指定する。
- 名前は一意ではない。検索で得た ID と親フォルダ・共有ドライブを照合して操作する。
- `fields` で必要な項目を明示する。一覧は `files` 配列と `nextPageToken`。`drive_all.py` は次ページを取得し、`fields` に `nextPageToken` を補う。空のページでもトークンがあれば続ける。
- `--max-pages` の警告や `incompleteSearch=true` があれば、全件取得とは報告しない。変更履歴の継続同期で必要な `newStartPageToken` は、この配列出力には保存されない。継続同期には単発呼び出しでレスポンス全体を保存する。
- Google Docs / Sheets / Slides は `alt=media` ではなく `files.export` でダウンロードする。文書内部の編集は各製品の API が必要で、このスキルでは Drive のファイル操作を扱う。

## 詳細

検索・共有ドライブ・ダウンロード・アップロード・移動・共有の手順は [references/files.md](references/files.md)。

## 実行範囲とエラー

アップロード・移動・共有・削除はユーザーが指定した対象と範囲で実行する。宛先、フォルダ、共有範囲が曖昧なら確認する。明示的な実行指示がある操作に重ねて承認を求めない。作成・アップロードの結果が不明な場合は、作成済みファイルを確認してから再試行する。

現在のスコープは `drive`。403 はファイルのアクセス権、共有ドライブの役割、Google のエラー本文を確認する。ゲートウェイの再接続エラーは表示された URL を案内する。429 / 503 の GET は一覧スクリプトが上限付きで再試行する。
