---
name: confluence
description: Confluence Cloud の REST API(v2 と、検索などの v1)を API ゲートウェイ経由で、接続したユーザー本人として呼び出す。CQL によるページの検索、スペースとページの一覧、ページ本文の取得、ページの作成・更新(追記)・移動、子ページ・階層の確認、コメント(フッター・インライン)の読み書き、添付ファイルのダウンロードとアップロード、ラベルを扱う。「Confluence で○○のページを探して」「このページを要約して」「議事録を Confluence に作って」「ページに追記して」「このページにコメントして」「スペースのページ一覧を出して」「添付の PDF を保存して」などの依頼で使う。
---

# Confluence Cloud API

Confluence Cloud の REST API を、API ゲートウェイ経由で呼び出す。トークンの発行とスクリプトの基本的な使い方は、`heddleway` スキルに従う。

## 手順

1. `heddleway` スキルの手順で、サービス `confluence` の認証情報を選んでトークンを発行し、`GW_TOKEN` と `GW_BASE_URL` を設定する。
   - `confluence` は OAuth(Atlassian の OAuth 2.0 3LO)のサービスで、ユーザーがゲートウェイの画面で Atlassian アカウントを接続する。Jira(`jira`)とは別の接続なので、Jira をつないでいても Confluence は別につなぐ。上流のトークンはゲートウェイが注入・更新するので、Claude は扱わない。
2. サイトのクラウド ID を調べる。上流は `https://api.atlassian.com` で、Confluence の API はサイトごとに `/ex/confluence/<cloudid>/wiki/...` の下にある。

   ```sh
   GW="${CLAUDE_SKILL_DIR}/scripts/gw_request.py"
   python3 $GW GET confluence /oauth/token/accessible-resources
   ```

   返る配列の `id` がクラウド ID、`url` がサイト(`https://<site>.atlassian.net`)。複数あれば、どのサイトかをユーザーに確かめる。
3. `/ex/confluence/<cloudid>/wiki/api/v2/...`(v2)か `/ex/confluence/<cloudid>/wiki/rest/api/...`(v1)を呼ぶ。

```sh
W=/ex/confluence/$CLOUD_ID/wiki
V2=$W/api/v2
# 検索(CQL。v1)
python3 $GW GET confluence $W/rest/api/search -q 'cql=type = page AND text ~ "議事録" ORDER BY lastmodified DESC' -q limit=25
# スペース
python3 $GW GET confluence $V2/spaces -q keys=ENG
python3 $GW GET confluence $V2/spaces/<spaceId>/pages -q limit=100 -q sort=-modified-date
# ページ本文(storage 形式の XHTML)
python3 $GW GET confluence $V2/pages/<pageId> -q body-format=storage
# 子ページ・配下
python3 $GW GET confluence $V2/pages/<pageId>/direct-children
python3 $GW GET confluence $V2/pages/<pageId>/descendants -q depth=2
# 作成・更新
python3 $GW POST confluence $V2/pages --json @new-page.json
python3 $GW PUT confluence $V2/pages/<pageId> --json @update-page.json
# コメント
python3 $GW GET confluence $V2/pages/<pageId>/footer-comments -q body-format=storage
python3 $GW POST confluence $V2/footer-comments --json '{"pageId": "<pageId>", "body": {"representation": "storage", "value": "<p>確認しました。</p>"}}'
# 添付
python3 $GW GET confluence $V2/pages/<pageId>/attachments
python3 $GW GET confluence $W/rest/api/content/<pageId>/child/attachment/<attachmentId>/download -o file.pdf
python3 $GW POST confluence $W/rest/api/content/<pageId>/child/attachment -H X-Atlassian-Token=no-check --file file=report.pdf
```

`-q`・`-H` などのオプションは `gw_request.py --help` で確かめる。

## API の要点

- ID: スペースもページも、v2 では数値の文字列の ID で指定する。スペースキー(`ENG`)から ID は `GET .../spaces?keys=ENG` の `results[].id`。ページの URL `https://<site>.atlassian.net/wiki/spaces/ENG/pages/123456/タイトル` の `123456` がページ ID。応答の `_links.webui` に `_links.base`(サイトの `/wiki`)を前に付けると、ユーザーに見せるリンクになる。
- 検索は v1 の `GET .../rest/api/search?cql=...`(v2 に CQL の検索はない)。よく使う CQL: `space = ENG`、`type = page`、`title ~ "..."`、`text ~ "..."`、`creator = currentUser()`、`contributor = currentUser()`、`lastmodified >= now("-7d")`、`label = "議事録"`、`ancestor = <pageId>`。結果の `results[].content.id` がページ ID。
- ページング: v2 は応答の `_links.next`(`/wiki/api/v2/...?cursor=...` の相対パス)を、`/ex/confluence/<cloudid>` を前に付けてそのまま呼ぶ。`_links.next` がなくなるまで続ける。`limit` は 250 まで。v1 の検索は `start` と `limit`(`totalSize` で全体の数)か、`_links.next` の `cursor`。
- 本文の形式は `body-format` で選ぶ。`storage`(Confluence の XHTML。書き込みにもこれを使う)、`atlas_doc_format`(ADF の JSON 文字列)、`view`(表示用の HTML)。要約などで読むだけなら `storage` を取って、タグを外して読む。
- 作成は `POST .../pages` に次の形。`parentId` を省くとスペースのホームページの下(ホームの外のスペース直下に置くなら、`parentId` を省いて `-q root-level=true`)。`status` を `draft` にすると下書き。

  ```json
  {"spaceId": "<spaceId>", "status": "current", "title": "2026-11-07 定例 議事録", "parentId": "<pageId>",
   "body": {"representation": "storage", "value": "<h2>決定事項</h2><ul><li>...</li></ul>"}}
  ```

- 更新は `PUT .../pages/<pageId>` に、`id`・`status`・`title`・`body` と、`version.number` を現在の版 + 1 で送る(本文は丸ごと置き換え)。追記なら、先に `GET .../pages/<pageId>?body-format=storage` で本文と `version.number` を取り、本文の末尾に足して送る。版が合わないと 409。`version.message` に変更の説明を書ける。
- 親の付け替え(移動)は、更新の本文に `parentId` を入れる(同じスペースの中だけ)。
- 子ページは `GET .../pages/<pageId>/direct-children`(旧 `.../children` は非推奨)、配下全体は `.../descendants`(`depth` は 1〜10、既定 2)。
- storage 形式の書き方: 段落 `<p>`、見出し `<h1>`〜`<h6>`、箇条書き `<ul><li>`、表 `<table><tbody><tr><th>`/`<td>`、リンク `<a href="...">`。`&`・`<` は実体参照にする。ユーザーの名指しは `<ac:link><ri:user ri:account-id="<accountId>"/></ac:link>`、ほかのページへのリンクは `<ac:link><ri:page ri:content-title="タイトル"/></ac:link>`。目次などのマクロは `<ac:structured-macro ac:name="toc"/>`。
- インラインコメントは `GET .../pages/<pageId>/inline-comments`。返信は `POST .../footer-comments`(または `inline-comments`)に `parentCommentId` を付ける。新しいインラインコメントは本文中の選択位置が要るので、基本はフッターコメントを使う。
- 添付の一覧は v2、ダウンロードとアップロードは v1(上の例)。アップロードには `X-Atlassian-Token: no-check` ヘッダーが要る。同じファイル名で上げると新しい版になる(`.../child/attachment` に `PUT`)。
- ラベルは `GET .../pages/<pageId>/labels`。付けるのは v1 の `POST .../rest/api/content/<pageId>/label` に `[{"prefix": "global", "name": "議事録"}]`。
- `accountId` から表示名を引くのは v1 の `GET .../rest/api/user?accountId=<id>`。

## 権限

ゲートウェイの `confluence` には、`src/catalog.ts` の `CONFLUENCE_SCOPE` のスコープ(スペース・ページ・階層・コメント・添付・ラベルの読み取りと、ページ・コメント・添付・ラベルの書き込み、read:me、offline_access)が付いている。

- ページの削除、スペースの作成と設定、権限(制限)の変更は、この範囲にない。
- 見えるスペースとページ、書けるかどうかは、接続したユーザーの Confluence の権限とページの制限で決まる。権限がないと 403 か 404 になる(見えないページは 404)。
- 401 で `scope does not match` のように返るときは、Atlassian のアプリにそのスコープが付いていないか、つないだあとにスコープが増えた。ゲートウェイの管理者にアプリの設定を確かめてもらい、ユーザーにつなぎ直してもらう。

## 制限と注意

- レート制限は 429 と `Retry-After`(秒)で返る。待ってから再試行する。スペースの全ページなど大量の取得は、結果をファイルに保存して使い回す。
- エラーは v2 が `{"errors": [{"status": 400, "code": "...", "title": "...", "detail": "..."}]}`、v1 が `{"statusCode": 400, "message": "..."}` の形。ゲートウェイ自身のエラーは `{"error": "..."}`。
- ページの作成・更新・コメントは、ウォッチャーに通知が飛び、更新は版の履歴に残る。実行前に、対象のスペース・親ページ・タイトル・本文をユーザーに確認する。既存のページの本文を置き換えるときは、消える部分がないかを特に確かめる。
