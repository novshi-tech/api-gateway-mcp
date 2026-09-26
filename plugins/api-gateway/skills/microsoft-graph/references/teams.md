# Teams

例の `$GW` は `api-gateway` スキルの `gw_request.py`。パスはすべて `/v1.0` から書く。

チームやチャネルの作成、メンバーの管理、オンライン会議の管理は、権限の範囲にないので扱わない。

## チームとチャネル

```sh
python3 $GW GET graph /v1.0/me/joinedTeams -q '$select=id,displayName'
python3 $GW GET graph /v1.0/teams/{team-id}/channels -q '$select=id,displayName,membershipType'
```

## チャネルのメッセージ

```
GET  /v1.0/teams/{team-id}/channels/{channel-id}/messages                         # スレッドの先頭だけ。新しい順
GET  /v1.0/teams/{team-id}/channels/{channel-id}/messages/{message-id}            # 1 件
GET  /v1.0/teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies    # スレッドの返信
POST /v1.0/teams/{team-id}/channels/{channel-id}/messages                         # 投稿
POST /v1.0/teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies    # スレッドに返信
```

- 一覧で使えるのは `$top`(最大 50)と `$expand=replies` くらいで、`$filter`、`$orderby`、`$select` は使えない。全件は `graph_all.py` で `@odata.nextLink` をたどる。
- メッセージの `body.contentType` は多くが `html`。本文を読むときはタグを除いてから要約する。`from.user.displayName` が送信者。`replyToId` があれば返信。

```sh
python3 $GW POST graph /v1.0/teams/{team-id}/channels/{channel-id}/messages --json '{"body": {"contentType": "text", "content": "本文"}}'
```

成功すると 201 で、作られたメッセージが返る。HTML で書くときは `contentType` を `html` にする。

## チャット(1 対 1・グループ)

```
GET  /v1.0/me/chats                           # 参加しているチャット。$expand=members で参加者も
GET  /v1.0/chats/{chat-id}/messages           # メッセージ。新しい順
POST /v1.0/chats/{chat-id}/messages           # 投稿。ボディはチャネルと同じ形
```

```sh
python3 $GW GET graph /v1.0/me/chats -q '$expand=members' -q '$top=20'
python3 $GW GET graph /v1.0/chats/{chat-id}/messages -q '$top=20'
```

チャットの `topic` は、グループに名前を付けていなければ空。相手は `members[].displayName` で見分ける。

## 投稿の前に

チャネルやチャットへの投稿は、宛先と本文をユーザーに確認してから送る。送ったメッセージの取り消しは API では扱わない。
