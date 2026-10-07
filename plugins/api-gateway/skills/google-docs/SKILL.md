---
name: google-docs
description: Google ドキュメント(Google Docs)の本文の読み取り、新規作成、文字の挿入・削除・置換、見出しや箇条書き・文字の書式、表、タブの操作を API Gateway MCP 経由で行う。「この Google ドキュメントを読んで要約して」「議事録のドキュメントに追記して」「テンプレートの {{会社名}} を置換して」「新しいドキュメントを作って下書きを書いて」など、ゲートウェイに登録された Google アカウントのドキュメントの中身を扱う依頼で使う。ファイルの検索・移動・共有・PDF への書き出しは google-drive スキル。
---

# Google Docs API

`api-gateway` スキルでサービス `docs` の認証情報を選び、`issue_token` の `token` と `base_url` を `GW_TOKEN` / `GW_BASE_URL` に設定する。上流の Google トークンはゲートウェイが管理する。

複数の接続があれば `list_credentials` の `label` をユーザーの指定と照合する。指定済みの接続を使い、曖昧な場合だけ確認する。Drive / Gmail の認証情報とは別に選ぶ。同じ OAuth クライアント ID でも、接続したアカウントが同じとは限らない。

ドキュメント ID は URL `https://docs.google.com/document/d/<ID>/edit` の `<ID>`。名前でしか分からないときは、`google-drive` スキルで `mimeType='application/vnd.google-apps.document'` を検索して ID を調べる。

## 呼び出す

読むときは `scripts/docs_text.py`、作成と編集は共通の `gw_request.py` を使う。Python 標準ライブラリだけで動く。

```sh
GW=$(ls "${CLAUDE_SKILL_DIR}"/../*api-gateway/scripts/gw_request.py)
python3 "${CLAUDE_SKILL_DIR}/scripts/docs_text.py" 'https://docs.google.com/document/d/{document-id}/edit'
python3 "${CLAUDE_SKILL_DIR}/scripts/docs_text.py" {document-id} --paragraphs -o paragraphs.json
python3 "$GW" POST docs /v1/documents --json '{"title": "議事録 2026-10-07"}'
python3 "$GW" POST docs /v1/documents/{document-id}:batchUpdate --json @requests.json
```

- パスは `/v1/documents`(作成)、`/v1/documents/{id}`(取得)、`/v1/documents/{id}:batchUpdate`(編集)の 3 つだけ。編集はすべて `batchUpdate` の `requests` 配列で送る。
- `docs_text.py` は全タブの本文を Markdown 風のテキストにする(見出しは `#`、箇条書きは `-`、表は `|`)。`--paragraphs` は段落ごとの `tabId`、`startIndex`、`endIndex`、スタイルを JSON にする。`--raw` は API の応答そのまま。
- 位置は UTF-16 のコード単位のインデックス。絵文字などはサロゲートペアで 2 と数える。本文の先頭は 1。インデックスは文書を読んだ時点の `revisionId` でだけ正しい。
- 1 回の `batchUpdate` の中では、リクエストが順に適用され、前のリクエストでインデックスがずれる。後ろから前へ並べるか、`endOfSegmentLocation` や `replaceAllText` のようにインデックスの要らない書き方を使う。
- 一つでも失敗すると、その `batchUpdate` 全体が適用されない。

## 詳細

作成、追記、置換、削除、書式、箇条書き、表、タブ、同時編集の扱いは [references/editing.md](references/editing.md)。

## 実行範囲とエラー

編集と削除は、ユーザーが指定したドキュメントと範囲で行う。対象のドキュメントや範囲が曖昧なら確認する。明示的な実行指示がある操作に重ねて承認を求めない。作成がタイムアウトしたら、同じ題名のドキュメントが作られていないか Drive で確かめてから再試行する。

スコープは `documents`。ドキュメントの中身を読み書きできるが、ファイルの移動、共有、削除、書き出し(PDF / DOCX)、コメントの一覧は Drive API で、`google-drive` スキルを使う。403 はドキュメントへのアクセス権(閲覧者は編集できない)と Google のエラー本文を確認する。400 の `Invalid requests[N]` は N 番目のリクエストが原因。インデックスの範囲外がよくある原因なので、読み直してからやり直す。ゲートウェイの再接続エラーは案内された URL を使う。レート制限は、ユーザーごとに毎分の読み取り 300 回、書き込み 60 回。編集はまとめて 1 回の `batchUpdate` にする。
