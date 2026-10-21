---
name: murmur
description: 連絡の索引「Murmur」(プロトタイプ)のスレッドを API ゲートウェイ経由で読み書きする。メール・Slack・LINE などの連絡から拾ったスレッドのうち自分の番のもの、スレッドの経過とタイムライン、仕分け待ち、期限超過の確認、スレッドを持つ・手放す・引き継ぐ、個人のメモ(「この件」)を書いてスレッド同士を結ぶ、属性・片付け・開き直し・振り分けの直し、そして外へ送った・起票した直後の送信の記録(record_sent)を扱う。「自分の番のものを見せて」「ボールがこっちにあるものは？」「仕分け待ちは？」「返事が来てないものは？」「この件は私が持つ」「この件のメモを作って結んで」「さっきの返信を記録して」「振り分けが違う」などの依頼で使う。外へ送るときは、送信のスキルで送ったあと必ずこのスキルで記録する。
---

# Murmur

Murmur の本体は、API ゲートウェイの上流サービス `murmur` として登録されている。トークンの発行とスクリプトの基本的な使い方は、`api-gateway` プラグインの `api-gateway` スキルに従う。

Murmur は連絡(メール・Slack・LINE・Jira など)を**スレッド**に綴じて、誰の番か(ボール)を追う索引。スレッドはデータソースの写しで、データソースごとに 1 つのリストに入る。**個人のメモ**も読者が本人だけのデータソースで、「この件」として追いたいものはメモのスレッドを作り、関係するスレッドとリンクで結ぶ。

**Murmur は外に何も書かない。** メール・LINE・Slack の送信や Jira の起票は、それぞれのスキル(gmail・microsoft-graph など)でユーザーの確認を取ってから送り、送った直後に `record_sent` で事実を記録する。Murmur がするのは、どのスレッドに綴じるかと、ボールが動いたかの判断だけ。何をするか・どのスレッドを結ぶかは、ユーザーとあなたが決める。

## 手順

1. `list_credentials` に `identity:murmur` があることを確かめる。ユーザーが登録するものはない。ゲートウェイが、サインイン中のユーザーとして本体に伝える。
2. `issue_token` に `identity:murmur` を渡してトークンを発行し、`GW_TOKEN` と `GW_BASE_URL` を設定する。送信に使うサービスの認証情報と一緒に発行してよい。
3. `scripts/gw_request.py`(`api-gateway` スキルのものと同じ)で呼ぶ。パスは下の表のとおり(先頭に `/api` は付けない)。

```sh
python3 ${CLAUDE_SKILL_DIR}/scripts/gw_request.py GET murmur /me
python3 ${CLAUDE_SKILL_DIR}/scripts/gw_request.py GET murmur /threads -q filter=my_turn
python3 ${CLAUDE_SKILL_DIR}/scripts/gw_request.py GET murmur /threads/thr_12 -q since=2026-10-21T09:00:00+09:00
python3 ${CLAUDE_SKILL_DIR}/scripts/gw_request.py POST murmur /sent --json '{"data_source":"ds_support","reply_to_thread_id":"thr_12","to":["owner@example.com"],"body":"...","sent_ref":"<...@mail>"}'
```

見えるもの・できることは、ユーザー本人と同じ。見えるのは、ユーザーが読者になっているデータソースのスレッドと、本人のメモだけ。

## 守ること

- **送ったら記録する。** スタンド経由で外へ送った・起票した・コメントしたら、その直後に `record_sent` を呼ぶ。送る前には呼ばない(送れなかったものを記録しない)。`sent_ref` は送信の API が返した ID(メールの Message-ID、Slack の ts、LINE の sentMessages[].id、Jira の課題キーやコメント ID)。同じ `sent_ref` で 2 回呼んでも 1 回分しか残らない
- 送る前の確認(宛先・本文・送信元・返事期待)はユーザーに見せて、送信の指示をもらう。これは Murmur の承認ではなく、ユーザーとの会話でのゲート
- **リンクは候補を見て、ユーザーと決めてから張る。** `get_thread` の `linkCandidates` はアンカー(課題キー・PR・メッセージ ID)が一致したものにすぎない。同じ件でなければ結ばない
- メモ・属性・片付け・開き直しは本人の側の状態。結んだ先が動いても(`linkedActiveSinceDismissed`)、閉じたメモを勝手に開き直さない。ユーザーに知らせて決めてもらう
- 属性は、リストの属性定義(`get_list` の `attributeDefs`)にあるものだけを使う。`description` を読んで意味を合わせる
- **Jira など状態を持つデータソースのスレッドの属性(ステータス・担当者・優先度・期日・完了)はソースの写し。** Murmur では書けない(`set_attribute` は `invalid`)。変えるときは Jira の側で(jira スキルなど)変えれば、写しとして戻ってくる。`set_attribute` で書けるのは個人のメモのスレッドの属性だけ
- 状態を持つデータソースのスレッドは、担当者(`attributes.assignee`)が読者のユーザーならその人の番(`turn.by` が `assignee`)。完了(`closedAtSource`)ならボールは「なし」で、`filter=open` にも出ない
- ボール(`ball`)・誰の番(`turn`)・返事期待(`replyExpectedBy`)・期限超過(`overdue`)はイベントから自動で決まる。属性で書き換えない。ボールを人に寄せたいときは `claim` で持つ

## API

| ツール | メソッドとパス | 入力 | 返すもの |
| --- | --- | --- | --- |
| me | `GET /me` | | User と、各テナントの Party・読者になっているリスト(データソース) |
| list_lists | `GET /lists` | `-q tenant=...`(省略可) | 見えるリストの一覧(データソース・読者・属性定義) |
| get_list | `GET /lists/{list_id}` | | データソース・読者・属性定義 |
| list_threads | `GET /threads` | `-q filter=my_turn\|mine\|open\|overdue\|triage\|all`(既定 `open`)、`-q data_source=...`、`-q tenant=...`、`-q since=<ISO 8601>`(それより後に動いたものだけ。メモのスレッドは結んだ先が動いても入る) | スレッドの一覧(テナント横断、更新の新しい順)。各スレッドに `ball`・`turn`(`by` は `owner` / `assignee` / `reader` / `addressed`)・`ownerUserId`・`links`・`attributes`・`derivedBall`・`linkCandidates`・`overdue`・`closedAtSource`(ソースで完了) など |
| get_thread | `GET /threads/{thread_id}` | `-q since=<ISO 8601>`(省略可。タイムラインをそれより後に絞る) | `thread`(一覧と同じ項目)、`dataSource`、`linked`(結んだ先。見えない先は id と経路だけ)、`timeline`(このスレッドのシグナル・メモ・操作と、結んだ先のシグナルを時刻順に) |
| add_note | `POST /notes` | `{"body", "thread_id"?, "title"?, "tenant"?}`。`thread_id` を渡せば既存のメモのスレッドに足し、渡さなければ新しいスレッド(「この件」)を作る。件名は `title`、なければ本文の 1 行目 | メモのスレッド(`get_thread` と同じ) |
| claim_thread | `POST /threads/{thread_id}/claim` | `{"user_id"?, "reason"?}`。省略で自分が持つ、`null` で手放す、ほかの読者の User ID で引き継ぐ | `get_thread` と同じ |
| link_threads | `POST /threads/{thread_id}/links` | `{"thread_id", "reason"?}`(結ぶ相手) | `get_thread` と同じ。候補から張れば経路 `anchor`、それ以外は `manual` |
| unlink_threads | `POST /threads/{thread_id}/unlink` | `{"thread_id", "reason"?}` | `get_thread` と同じ |
| set_attribute | `POST /threads/{thread_id}/attributes` | `{"name", "value"}`(`null` で外す)。個人のメモのスレッドだけ(外のサービスの属性は写しなので書けない) | `get_thread` と同じ |
| dismiss_thread | `POST /threads/{thread_id}/dismiss` | `{"reason"}`(必須)。仕分け待ちから片付ける・メモのスレッドを閉じる | `get_thread` と同じ |
| reopen_thread | `POST /threads/{thread_id}/reopen` | `{"reason"?}` | `get_thread` と同じ |
| move_signal | `POST /signals/{signal_id}/move` | `{"thread_id"}` か `{"new_thread_title"}` のどちらか、`"needs_response"?`(受信だけ)、`"reason"`(必須) | 移した先のスレッド(`get_thread` と同じ) |
| record_sent | `POST /sent` | 下の「送信の記録」 | 送ったシグナルの入ったスレッド(`get_thread` と同じ) |

エラーは `{"error": "not_found" | "invalid" | "forbidden" | "conflict", "message": ...}`。見えないスレッドやデータソースは、存在していても `not_found` になる。

### 送信の記録(record_sent)

```json
{
  "data_source": "ds_support",
  "to": ["owner@tanaka-bldg.example"],
  "to_party_ids": [],
  "subject": "Re: エントランスの床について",
  "body": "送った本文",
  "sent_ref": "<20261016.0925@ubs.example>",
  "anchors": { "in_reply_to": "<...>", "thread_ts": "...", "quoted_message_id": "...", "thread_key": "NVT-42", "jira_keys": ["NVT-42"], "pr_refs": [] },
  "reply_to_thread_id": "thr_2",
  "source_thread_id": "thr_5",
  "reply_expected_by": "2026-10-16T17:00:00+09:00"
}
```

- `data_source`: 送ったデータソース(送信元のメールボックス・LINE 公式アカウントなど)。`get_thread` の `dataSource.id`、または `list_lists`
- `to` か `to_party_ids` のどちらかは必須。`to` はそのチャネルのアドレス
- `reply_to_thread_id`: 返事をしているスレッド(同じデータソース)。送ったシグナルはそこに入る。省略すると、アンカーで決まらなければ新しいスレッドになる
- `source_thread_id`: 送る元になったスレッド(どのデータソースでもよい。メモのスレッドや、LINE の欠勤のスレッドから打診を送るときなど)。送ったスレッドと経路 `sent` で結ばれる
- `reply_expected_by`: 返事期待の期限(ISO 8601、オフセット付きでよい)。過ぎると `overdue` になり、返事が来れば消える
- ボールは相手へ移る。返事は同じデータソースに戻り、送ったスレッドに入る
- **Jira の起票**: `sent_ref` に課題キー、`anchors.thread_key` にも同じ課題キーを入れる。`to_party_ids` は担当者、`source_thread_id` に起票の元になったスレッド(LINE・メール・Slack など)。課題のスレッドができて元のスレッドと経路 `sent` で結ばれ、課題の状態(写し)とコメントはそのスレッドに入る
- **Jira のコメント**: `sent_ref` にコメント ID、`anchors.thread_key` に課題キー、`reply_to_thread_id` に課題のスレッド

## よくある流れ

1. 「今日やることは？」: `GET /threads -q filter=my_turn`。仕分け待ち(誰の番か決まらないもの)は `filter=triage`、返事待ちの期限超過は `filter=overdue`。前回から何が動いたかは `-q since=<前回見た時刻>`
2. 「この件は私が持つ」: `POST /threads/{id}/claim`。引き継ぐなら `{"user_id": "..."}`、手放すなら `{"user_id": null}`
3. 「この件をまとめて追いたい」: `POST /notes` でメモのスレッドを作る → `GET /threads/{id}` の `linkCandidates` と、ユーザーの話から関係するスレッドを選ぶ → `POST /threads/{メモのid}/links`。LINE の 1 本だけで済むなら、メモを作らず持つだけでよい
4. 「この件に返信して」「協力会社に依頼して」: `GET /threads/{id}` で経過を読む → 文面と宛先・返事期待をユーザーに確認 → 送信のスキルで送る → **すぐ `POST /sent`**(返信なら `reply_to_thread_id`、別の相手への依頼なら `source_thread_id` に元のスレッド)
5. 「メモの件、どうなった？」: `GET /threads/{メモのid}`。`derivedBall` が結んだ先から見たボール(`my_turn` / `waiting`)、`timeline` に結んだ先の受信も並ぶ
6. 「もう対応不要」: 仕分け待ちなら `POST /threads/{id}/dismiss`、件が片付いたらメモのスレッドも `dismiss`。また動いたら `reopen`
7. 「振り分けが違う」: `POST /signals/{signal_id}/move`(既存のスレッドか新しいスレッドへ)。違うスレッドと結んだら `unlink`
8. 「これ課題にして」: 起票の内容(要約・説明・担当者)をユーザーに確認 → jira スキルで起票 → **すぐ `POST /sent`**(`sent_ref` と `anchors.thread_key` に課題キー、`source_thread_id` に元のスレッド)。ステータスや担当者を変えたいときは jira スキルで Jira を直接変える
