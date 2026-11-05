---
name: jira
description: Jira Cloud の REST API(v3)を API ゲートウェイ経由で、接続したユーザー本人として呼び出す。JQL による課題の検索、課題の取得・作成・更新、コメントの追加、ステータスの遷移、担当者の変更、プロジェクトと課題タイプ・フィールドの確認、ユーザーの検索を扱う。「Jira で自分の担当の課題を一覧して」「PROJ-123 の内容を見せて」「この件を Jira に起票して」「課題にコメントして」「ステータスを完了にして」「担当者を○○さんにして」などの依頼で使う。
---

# Jira Cloud API

Jira Cloud の REST API(v3)を、API ゲートウェイ経由で呼び出す。トークンの発行とスクリプトの基本的な使い方は、`heddleway` スキルに従う。

## 手順

1. `heddleway` スキルの手順で、サービス `jira` の認証情報を選んでトークンを発行し、`GW_TOKEN` と `GW_BASE_URL` を設定する。
   - `jira` は OAuth(Atlassian の OAuth 2.0 3LO)のサービスで、ユーザーがゲートウェイの画面で Atlassian アカウントを接続する。上流のトークンはゲートウェイが注入・更新するので、Claude は扱わない。
2. サイトのクラウド ID を調べる。上流は `https://api.atlassian.com` で、Jira の API はサイトごとに `/ex/jira/<cloudid>/...` の下にある。

   ```sh
   GW="${CLAUDE_SKILL_DIR}/scripts/gw_request.py"
   python3 $GW GET jira /oauth/token/accessible-resources
   ```

   返る配列の `id` がクラウド ID、`url` がサイト(`https://<site>.atlassian.net`)。複数あれば、どのサイトかをユーザーに確かめる。
3. `/ex/jira/<cloudid>/rest/api/3/...` を呼ぶ。

```sh
J=/ex/jira/$CLOUD_ID/rest/api/3
python3 $GW GET jira $J/myself
python3 $GW POST jira $J/search/jql --json '{"jql": "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC", "fields": ["summary", "status", "assignee", "updated"], "maxResults": 50}'
python3 $GW GET jira $J/issue/PROJ-123 -q fields=summary,status,assignee,description,comment
python3 $GW GET jira $J/issue/PROJ-123/transitions
python3 $GW POST jira $J/issue/PROJ-123/transitions --json '{"transition": {"id": "31"}}'
python3 $GW POST jira $J/issue/PROJ-123/comment --json @comment.json
python3 $GW POST jira $J/issue --json @new-issue.json
```

## API の要点

- 検索は `POST .../search/jql`(旧 `/search` は廃止)。`fields` で項目を絞る。ページングは応答の `nextPageToken` を次の要求の `nextPageToken` に渡し、`isLast` が `true` になるまで続ける。`maxResults` は 100 程度まで。
- 課題はキー(`PROJ-123`)か ID で指定する。リンクは `https://<site>.atlassian.net/browse/PROJ-123`。
- 説明(`description`)とコメントの本文は Atlassian Document Format(ADF)の JSON。プレーンテキストは次の形で包む。

  ```json
  {"body": {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "本文"}]}]}}
  ```

- 起票は `POST .../issue` に `{"fields": {"project": {"key": "PROJ"}, "issuetype": {"name": "Task"}, "summary": "...", "description": <ADF>}}`。必須のフィールドはプロジェクトと課題タイプで違うので、先に `GET .../issue/createmeta/PROJ/issuetypes` と `.../issuetypes/<id>` で確かめる。
- 更新は `PUT .../issue/<key>` に `{"fields": {...}}`。ステータスは `fields` では変えられないので、`GET .../transitions` で遷移の ID を調べて `POST .../transitions` する。
- 担当者は `accountId` で指定する(`PUT .../issue/<key>/assignee` に `{"accountId": "..."}`)。名前やメールアドレスからは `GET .../user/search?query=...` で探す。
- `accountId` から表示名を引くのは `GET .../user?accountId=<id>`(`displayName`)。
- ウォッチは `GET .../issue/<key>/watchers` で一覧、`POST .../issue/<key>/watchers` で足す(本文は accountId の JSON 文字列 `"<accountId>"`。省くと自分)、`DELETE .../issue/<key>/watchers?accountId=<id>` で外す。
- カスタムフィールドは `customfield_10010` のような ID。名前との対応は `GET .../field` で調べる。

## 権限

ゲートウェイの `jira` には、次のスコープが付いている: read:jira-work、write:jira-work、read:jira-user、manage:jira-webhook、read:me、offline_access。

- 課題・コメント・添付の読み書き、遷移、ユーザーの参照ができる。Jira の管理(プロジェクトやワークフローの設定)と、Confluence はこの範囲にない。
- 見える課題と操作できる範囲は、接続したユーザーの Jira の権限で決まる。権限がないと 403 や 404 になる。

## 制限と注意

- レート制限は 429 と `Retry-After`(秒)で返る。待ってから再試行する。大量の取得は結果をファイルに保存して使い回す。
- エラーは `{"errorMessages": [...], "errors": {"<field>": "..."}}` の形。起票や更新の 400 は `errors` にフィールドごとの理由が出る。ゲートウェイ自身のエラーは `{"error": "..."}`。
- 起票・更新・コメント・遷移・担当者の変更は、ウォッチャーに通知が飛ぶ。実行前に対象の課題と内容をユーザーに確認する。
