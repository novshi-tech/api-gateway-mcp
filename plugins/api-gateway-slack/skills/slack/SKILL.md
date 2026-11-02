---
name: slack
description: Slack の Web API を API ゲートウェイ経由で、接続したユーザー本人として呼び出す。チャンネル・プライベートチャンネル・DM・グループ DM の一覧と履歴、スレッドの返信、メッセージの検索、ユーザーの検索とプロフィール、メッセージの投稿・スレッドへの返信・更新、リアクションの付け外し、ファイルの情報を扱う。「Slack の #general の最近の投稿を見せて」「このスレッドを要約して」「Slack で○○について検索して」「○○さんに DM して」「このスレッドに返信して」「リアクションを付けて」などの依頼で使う。
---

# Slack Web API

Slack の Web API を、API ゲートウェイ経由で呼び出す。トークンの発行とスクリプトの基本的な使い方は、`api-gateway` スキルに従う。

## 手順

1. `api-gateway` スキルの手順で、サービス `slack` の認証情報を選んでトークンを発行し、`GW_TOKEN` と `GW_BASE_URL` を設定する。
   - `slack` は OAuth のサービスで、ユーザーがゲートウェイの画面で Slack のワークスペースを接続する。ゲートウェイが注入するのはユーザートークン(`xoxp-`)なので、API はそのユーザー本人として動く。投稿もその人の名前で出る。
2. このスキルの `scripts/gw_request.py`(共通の `api-gateway` スキルと同じもの)で呼び出す。パスはメソッド名そのもの(`/conversations.history` など。上流は `https://slack.com/api`)。

```sh
GW="${CLAUDE_SKILL_DIR}/scripts/gw_request.py"
python3 $GW GET slack /auth.test
python3 $GW GET slack /conversations.list -q types=public_channel,private_channel -q exclude_archived=true -q limit=200
python3 $GW GET slack /conversations.history -q channel=C0123456789 -q limit=50
python3 $GW GET slack /conversations.replies -q channel=C0123456789 -q ts=1730000000.000100
python3 $GW GET slack /search.messages -q 'query=請求書 in:#accounting after:2026-10-01' -q count=20
python3 $GW GET slack /users.lookupByEmail -q email=someone@example.com
python3 $GW POST slack /chat.postMessage --json '{"channel": "C0123456789", "text": "確認しました", "thread_ts": "1730000000.000100"}'
python3 $GW POST slack /reactions.add --json '{"channel": "C0123456789", "timestamp": "1730000000.000100", "name": "eyes"}'
```

## API の要点

- 読み取りのメソッドは GET とクエリで呼ぶ。書き込み(`chat.postMessage`、`chat.update`、`reactions.add` など)は POST と JSON 本文(`--json`)で呼ぶ。
- **エラーでも HTTP 200 が返る。** 本文の `ok` が `false` なら失敗で、理由は `error`(`channel_not_found`、`not_in_channel`、`missing_scope`、`invalid_auth` など)。ステータスだけで成否を判断しない。
- チャンネル・DM はすべて「conversation」で、ID で指定する(`C...` チャンネル、`G...` 古いプライベートチャンネル、`D...` DM)。名前しか分からないときは `conversations.list` で探す。DM を開くには `conversations.open` に `users`(ユーザー ID)を渡す。
- メッセージは `channel` と `ts`(文字列のタイムスタンプ)で特定する。スレッドの親の `ts` を `thread_ts` に渡すとスレッドへの返信になる。メッセージのリンク `https://<ws>.slack.com/archives/C0123/p1730000000000100` の `p` 以下は、小数点を補うと `ts`(`1730000000.000100`)になる。
- 一覧はカーソルでページングする。応答の `response_metadata.next_cursor` が空でなければ、それを `cursor` に渡して次を取る。`limit` は 200 程度までにする。
- 時刻の範囲は `oldest` / `latest`(UNIX 秒)。`conversations.history` は既定で新しい順。
- 本文の `<@U0123>` はユーザー、`<#C0123|name>` はチャンネルへの言及。名前に直すときは `users.info` / `conversations.info` で引く。
- 検索(`search.messages`)は Slack の検索の構文(`in:#channel`、`from:@user`、`after:YYYY-MM-DD`、`before:`、`has:link` など)が使える。ページングは `page` と `count`。

## 権限

ゲートウェイの `slack` には、次のユーザースコープが付いている: channels:history、channels:read、groups:history、groups:read、im:history、im:read、mpim:history、mpim:read、users:read、users:read.email、team:read、search:read、files:read、reactions:read、reactions:write、chat:write。

- 見えるのは、接続したユーザーが参加している会話だけ。参加していない公開チャンネルの履歴は `not_in_channel` になることがある。
- ファイルのアップロード、チャンネルの作成・招待、ユーザーグループ、Canvas などはこの範囲にないので、`missing_scope` になる。頼まれたら、使えないことを伝える。

## 制限と注意

- レート制限は 429 と `Retry-After`(秒)で返る。メソッドごとに段階(Tier)があり、`conversations.history` などは 1 分あたり数十回程度。全件取得はページの間に間をあけ、結果をファイルに保存して使い回す。
- 投稿・返信・更新・削除・リアクションは、ユーザー本人の名前で相手に通知が飛ぶ。実行前に宛先(チャンネル・スレッド)と本文をユーザーに確認する。
- メッセージの本文を大量に会話に貼らない。ファイルに保存し、必要な部分だけ読む。
