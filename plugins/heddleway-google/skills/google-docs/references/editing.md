# ドキュメントの作成と編集

編集は POST `/v1/documents/{id}:batchUpdate` に `{"requests": [...]}` を送る。リクエストは JSON のファイルに書いて `--json @requests.json` で渡すと、シェルのエスケープに悩まない。応答の `replies` は `requests` と同じ順に並ぶ(`replaceAllText` は置換した件数、`addDocumentTab` は新しいタブの ID など)。

[batchUpdate のリクエスト一覧](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request)、[文書の構造](https://developers.google.com/workspace/docs/api/concepts/structure)。

## 作成

POST `/v1/documents` は題名だけを受け付け、空のドキュメントを作る。本文を一緒に送っても無視されるので、作成の応答の `documentId` に対して `batchUpdate` で書き込む。作成先はマイドライブの直下。フォルダへの移動は `google-drive` スキルで `addParents` / `removeParents` を使う。

```sh
python3 "$GW" POST docs /v1/documents --json '{"title": "議事録 2026-10-07"}'
```

## 追記と挿入

末尾への追記は `endOfSegmentLocation` を使う。インデックスが要らない。改行 `\n` で段落が分かれる。

```json
{"requests": [
  {"insertText": {"endOfSegmentLocation": {}, "text": "決定事項\n次回までに見積を出す\n"}}
]}
```

位置を指定するときは `location.index`。段落の途中にしか入れられない(表の直前の位置などは不可)。複数タブの文書では `location.tabId` / `endOfSegmentLocation.tabId` を付ける。省略すると最初のタブになる。

書いた文字に書式を付けるには、挿入した位置と長さ(UTF-16 単位)から範囲を計算して、同じ `batchUpdate` の後ろに `updateParagraphStyle` や `updateTextStyle` を並べる。挿入より前の位置は、挿入でずれない。

## 置換

`replaceAllText` は文書全体(既定で全タブ)の一致をすべて置き換える。インデックスが要らないので、テンプレートの差し込みに向く。`tabsCriteria.tabIds` でタブを絞れる。

```json
{"requests": [
  {"replaceAllText": {"containsText": {"text": "{{会社名}}", "matchCase": true}, "replaceText": "株式会社サンプル"}},
  {"replaceAllText": {"containsText": {"text": "{{日付}}", "matchCase": true}, "replaceText": "2026年10月7日"}}
]}
```

`searchByRegex: true` で正規表現になる。テンプレートを残したいときは、先に `google-drive` スキルで `files.copy` してから、コピーを置換する。

## 削除

`deleteContentRange` の `range` に `startIndex` と `endIndex` を指定する。段落の最後の改行だけを残したり、表のセルの区切りをまたいだりする範囲は 400 になる。段落ごと消すなら、`--paragraphs` の `startIndex` から `endIndex` まで。ただし、本文の最後の段落の改行は消せないので、最後の段落は `endIndex - 1` まで。

複数の範囲を消すときは、インデックスの大きい方から並べる。

## 書式

見出しは段落のスタイルで付ける。

```json
{"updateParagraphStyle": {"range": {"startIndex": 1, "endIndex": 10}, "paragraphStyle": {"namedStyleType": "HEADING_2"}, "fields": "namedStyleType"}}
```

`namedStyleType` は `NORMAL_TEXT`、`TITLE`、`SUBTITLE`、`HEADING_1` から `HEADING_6`。文字の書式は `updateTextStyle` で、`textStyle` に `bold`、`italic`、`underline`、`link: {"url": ...}`、`foregroundColor` など、`fields` に変える項目の名前をカンマ区切りで書く(`"bold,link"`)。`fields` に書いて値を書かなければ、その書式は消える。

箇条書きは `createParagraphBullets`(`bulletPreset` は `BULLET_DISC_CIRCLE_SQUARE`、番号なら `NUMBERED_DECIMAL_ALPHA_ROMAN`、チェックボックスなら `BULLET_CHECKBOX`)、外すのは `deleteParagraphBullets`。入れ子は、行頭のタブ文字の数で決まる。そのタブ文字は消されるので、後ろのインデックスがずれる。

## 表

`insertTable` に `rows`、`columns` と `location` か `endOfSegmentLocation` を指定すると、空の表ができる。セルに文字を入れるには、文書を読み直して各セルの段落のインデックスを調べ(`--paragraphs` の `table` に `row` / `column` がある)、後ろのセルから前へ `insertText` を並べる。行と列の追加・削除は `insertTableRow` / `deleteTableRow` / `insertTableColumn` / `deleteTableColumn` で、`tableCellLocation.tableStartLocation.index` に表の `startIndex` を指定する。

## タブ

`docs_text.py` は全タブを読む(`includeTabsContent=true`)。タブは入れ子になれる。タブの追加は `addDocumentTab`(`tabProperties.title`)、題名の変更は `updateDocumentTabProperties`、削除は `deleteTab`。

## 画像

`insertInlineImage` の `uri` は、公開されていて Google から取りに行ける画像の URL(PNG / JPEG / GIF、50 MB まで)。Drive にある非公開の画像は直接は入れられない。

## 同時編集

人が同時に編集している文書では、読んだあとにインデックスがずれることがある。`batchUpdate` の `writeControl` で扱いを決める。

- `{"requiredRevisionId": "<読んだときの revisionId>"}`: 読んだあとに変更があれば 400 で拒否される。読み直してやり直す。確実に狙った位置を編集したいときに使う。
- `{"targetRevisionId": "<読んだときの revisionId>"}`: 読んだあとの他人の変更と、こちらの変更を Google が統合する。

## コメントと提案

ドキュメントのコメントの一覧や返信は、Drive API の `/drive/v3/files/{id}/comments`(`google-drive` スキル)を使う。Docs API の `insertComment`、`acceptSuggestion` などは Developer Preview で、一般のプロジェクトでは使えない。提案モードの変更を反映した本文を読むには、取得で `suggestionsViewMode=PREVIEW_SUGGESTIONS_ACCEPTED` を指定する(`gw_request.py` で GET `/v1/documents/{id}` に `-q` で渡す)。
