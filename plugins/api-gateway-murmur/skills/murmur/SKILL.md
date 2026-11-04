---
name: murmur
description: 連絡の索引「Murmur」(プロトタイプ)のスレッドを API ゲートウェイ経由で読み書きする。メール・Slack・LINE などの連絡から拾ったスレッドのうち自分の番のもの、スレッドの経過とタイムライン、仕分け待ち、期限超過の確認、スレッドを持つ・手放す・引き継ぐ、個人のメモ(「この件」)を書いてスレッド同士を結ぶ、着手したタスクを 1 つのメモのスレッドで追う(実装・レビュー・修正のループ、エージェントとしての参加)、属性・片付け・開き直し・振り分けの直し、そして外へ送った・起票した直後の送信の記録(record_sent)を扱う。「自分の番のものを見せて」「ボールがこっちにあるものは？」「仕分け待ちは？」「返事が来てないものは？」「この件は私が持つ」「この件のメモを作って結んで」「この課題に着手する」「タスクの経過を見せて」「さっきの返信を記録して」「振り分けが違う」などの依頼で使う。外へ送るときは、送信のスキルで送ったあと必ずこのスキルで記録する。
---

# Murmur

Murmur の本体は、API ゲートウェイの上流サービス `murmur` として登録されている。トークンの発行とスクリプトの基本的な使い方は、`api-gateway` プラグインの `api-gateway` スキルに従う。

Murmur は連絡(メール・Slack・LINE・Jira など)を**スレッド**に綴じて、誰の番か(ボール)を追う索引。スレッドはデータソースの写しで、データソースごとに 1 つのリストに入る。**個人のメモ**も読者が本人だけのデータソースで、「この件」として追いたいものはメモのスレッドを作り、関係するスレッドとリンクで結ぶ。

**Murmur は外に何も書かない。** メール・LINE・Slack の送信や Jira の起票は、それぞれのスキル(gmail・microsoft-graph など)でユーザーの確認を取ってから送り、送った直後に `record_sent` で事実を記録する。Murmur がするのは、どのスレッドに綴じるかと、ボールが動いたかの判断だけ。何をするか・どのスレッドを結ぶかは、ユーザーとあなたが決める。

## 手順

1. 作業する組織のコネクタを選ぶ(`api-gateway` スキルの「コネクタの選び方」)。Murmur は組織(チーム)ごとに 1 つで、その組織のゲートウェイの上流になっている。組織の分からない「自分の番のもの」は、`identity:murmur` を持つコネクタが 2 つ以上あれば、どの組織のものかを聞くか、組織ごとに分けて見せる。
2. そのコネクタの `list_credentials` に `identity:murmur` があることを確かめる。ユーザーが登録するものはない。ゲートウェイが、サインイン中のユーザーとして本体に伝える。
3. 同じコネクタの `issue_token` に `identity:murmur` を渡してトークンを発行し、`GW_TOKEN` と `GW_BASE_URL` を設定する。送信に使うサービスの認証情報と一緒に発行してよい(同じ組織のコネクタのものだけ)。
4. `scripts/gw_request.py`(`api-gateway` スキルのものと同じ)で呼ぶ。パスは下の表のとおり(先頭に `/api` は付けない)。

```sh
python3 ${CLAUDE_SKILL_DIR}/scripts/gw_request.py GET murmur /me
python3 ${CLAUDE_SKILL_DIR}/scripts/gw_request.py GET murmur /threads -q filter=my_turn
python3 ${CLAUDE_SKILL_DIR}/scripts/gw_request.py GET murmur /threads/thr_12 -q since=2026-10-21T09:00:00+09:00
python3 ${CLAUDE_SKILL_DIR}/scripts/gw_request.py POST murmur /sent --json '{"data_source":"ds_support","reply_to_thread_id":"thr_12","to":["owner@example.com"],"body":"...","sent_ref":"<...@mail>"}'
```

見えるもの・できることは、ユーザー本人と同じ。見えるのは、ユーザーが読者になっているデータソースのスレッドと、本人のメモだけ。

### 初めてつないだとき

初めてつないだユーザーは名無しで、Contact(連絡先の自分)もリストもない(`GET /me` が `contact: null`・`lists: []`)。次の順に案内する。

1. 呼び方を聞いて `PATCH /me` で付ける
2. 自分の箱(メール・Slack・LINE など)をリストにするなら、ゲートウェイでそのサービスがつながっているか(`list_credentials`)を先に確かめ、つないだアカウントのアドレスを `identity` にして `POST /data-sources` を呼ぶ。結果の `identity.kind`:
   - `created`: 自分の Contact を新しく作った / `bound`: チームが先に作っていたゴーストが自分に結ばれた / `attached`・`already`: 自分の Contact に付いた
   - `merge_candidate`: そのアドレスは別のゴースト(`ghostContactId`)に付いている。同じ人なら、ユーザーに確かめてから `POST /contacts/{自分の contactId}/merge` で `from` にゴーストを渡してまとめる
3. 共有のリスト(共有メールボックス・LINE 公式アカウント・Jira のプロジェクト)の読者は管理者が足す。読者になったリストで自分のアカウントを決めるなら `POST /lists/{list_id}/identity`
4. メモ(`add_note`)はリストがなくても使える(最初に書いたときに作られる)

### 名寄せ(Contact)

Contact はチームで共有する連絡先(Outlook の連絡先と同じ)。人か会社の窓口かは区別しない。Murmur は自分では名寄せしない。

- `GET /addresses/unresolved` で、見えるスレッドに出てきたのに Contact のないアドレスを探す
- `GET /contacts?q=` で候補を出し、**同じ相手かをユーザーに確かめてから** `POST /contacts`(新しく作る)か `POST /contacts/{id}/addresses`(付ける)を呼ぶ。推測で付けない
- 付け替えるときは、今の付け先を `POST /contacts/{id}/addresses/{address_id}/end` で終わらせてから付ける。過去のシグナルは元の付け先のまま
- 名寄せを直すと、過去のスレッドの相手と「誰の番」も直る(イベントはそのまま)

### タスクとして追う(1 タスク = 1 メモのスレッド)

対応すると決めた件は、個人のメモのスレッド 1 本で追う。共有のスレッド(Jira の課題・PR・メールなど)には進み具合を書かない。

1. **着手したら作って結ぶ**: ユーザーが着手を決めたら、`POST /notes` でメモのスレッドを作り(`title` にタスクの名前)、元のスレッドと `POST /threads/{メモのid}/links` で結ぶ。1 つのタスクが複数のスレッドにまたがれば全部結ぶ。チームに誰の番かを見せたいなら、元のスレッドを `claim` で持つ
2. **外に出したものはメモから記録する**: PR を出した・課題にコメントした・返信したら、`record_sent` の `source_thread_id` にメモのスレッドを入れる。送ったスレッドとメモが経路 `sent` で結ばれ、レビューや返事が返るとメモの `derivedBall` が `my_turn` になる。実装・レビュー・修正のループが 1 本のメモに綴じられる
3. **経過はメモに書く**: 指示・結果の要約・判断・次の一手をメモに足す。書き手を `author` で分ける(人の言葉は `user`、エージェント自身が書いたものは `{"kind":"agent","name":...}`)
4. **終わったら片付ける**: 結んだ先が完了しても(`closedAtSource`)、メモは自動では閉じない。片付けてよいかをユーザーに聞いてから `dismiss` する
5. 期日は属性 `due` に付ける(`POST /threads/{メモのid}/attributes`、`{"name":"due","value":"2026-11-10"}`)。進み具合や「委譲中」は属性にしない。タイムラインで読める

一覧(`filter=mine`)は、メモ自身か結んだ先の新しい更新(`lastActivityAt`)の順に並ぶ。結んだ PR にレビューが返れば、メモに何も書かれていなくても上に来る。

### エージェントとして参加するとき

**次の一手を決める者が書く。**

- オーケストレータの下で動くエージェント(boid の job、サブエージェント)は Murmur に書かない。結果をオーケストレータに返し、オーケストレータが判断してメモに綴じる
- 自分のきっかけで動く参加者(オーケストレータ自身、PR を見張ってレビューするエージェント)は、メモを読み、`author` に自分の名前を付けて書く。名前は参加者を見分けられるもの(`orchestrator`・`codex`・`claude-code` など)にする
- ボールは本人のまま。メモが `my_turn` になったら、エージェントが対応するか、人に回すかを決める。人に答えてほしいことは、メモに質問として書いて(`author` はエージェント)、ユーザーに知らせる
- ループの止め方を決めておく。レビューと修正が何周もしたら人に回す。参加者が互いの書き込みに反応し続けないようにする
- Murmur は参加者に通知しない。`GET /threads/{メモのid} -q since=<前回見た時刻>` か、外のサービスのきっかけ(PR のイベントなど)で拾う
- メモが見えるのは本人(とその代理)だけ。チームの別の人に渡すことは、PR や課題など外のサービスに書く

## 守ること

- **送ったら記録する。** スタンド経由で外へ送った・起票した・コメントしたら、その直後に `record_sent` を呼ぶ。送る前には呼ばない(送れなかったものを記録しない)。`sent_ref` は送信の API が返した ID(メールの Message-ID、Slack の ts、LINE の sentMessages[].id、Jira の課題キーやコメント ID)。同じ `sent_ref` で 2 回呼んでも 1 回分しか残らない
- **共有のスレッドには、事実と構造の操作だけ。** 送信の記録・持つ・結ぶ・振り分けの直し・片付けは共有のスレッドにしてよい。進み具合・作業のメモ・属性は、個人のメモのスレッドに書く
- **リンクは両端を読める人にしか見えない。** 共有のスレッドを自分のメモや自分の受信トレイ・自分の Jira のスレッドと結んでも、ほかの読者にはリンクがあることも見えない。チームに伝えたい進み(メールで先方に確かめた、課題で直した など)は、ユーザーと伝える粒度を決めて、共有のデータソースに書く(LINE で返す、Slack のスレッドに書く、課題にコメントする)。書いたら `record_sent` で記録する
- **組織をまたがない。** 送ったのと同じ組織のコネクタの Murmur に記録する。組織が違えば Murmur も違うので、別の組織の連絡やスレッドを、この組織の Murmur のメモに書き写したり結んだりしない
- 送る前の確認(宛先・本文・送信元・返事期待)はユーザーに見せて、送信の指示をもらう。これは Murmur の承認ではなく、ユーザーとの会話でのゲート
- **リンクは候補を見て、ユーザーと決めてから張る。** `get_thread` の `linkCandidates` はアンカー(課題キー・PR・メッセージ ID)が一致したものにすぎない。同じ件でなければ結ばない
- メモ・属性・片付け・開き直しは本人の側の状態。結んだ先が動いても(`linkedActiveSinceDismissed`)、閉じたメモを勝手に開き直さない。ユーザーに知らせて決めてもらう
- 属性は、リストの属性定義(`get_list` の `attributeDefs`)にあるものだけを使う。`description` を読んで意味を合わせる
- **Jira など状態を持つデータソースのスレッドの状態はソースの写し(`source`: `holders` = ソースでボールを持つアカウント、`statusLabel`、`due`。完了は `closedAtSource`、件名は `title`)。** Murmur では書けない。変えるときは Jira の側で(jira スキルなど)変えれば、写しとして戻ってくる。属性(`set_attribute`)は個人のメモのスレッドだけのもの。どのメモにも標準で `due`(タスクの期日、`YYYY-MM-DD`)が付く
- 状態を持つデータソースのスレッドは、ソースでボールを持つ人(`source.holders`。Jira は担当者、PR はレビュー待ちならレビュアー・変更を求められたら作者)に読者のユーザーがいればその人の番(`turn.by` が `holder`)。完了(`closedAtSource`)ならボールは「なし」で、`filter=open` にも出ない
- ボール(`ball`)・誰の番(`turn`)・返事期待(`replyExpectedBy`)・期限超過(`overdue`)はイベントから自動で決まる。属性で書き換えない。ボールを人に寄せたいときは `claim` で持つ

## API

| ツール | メソッドとパス | 入力 | 返すもの |
| --- | --- | --- | --- |
| me | `GET /me` | | User(`user`)、自分の Contact(`contact`。まだなければ `null`)、読者になっているリスト(`lists`。データソース) |
| list_lists | `GET /lists` | | 見えるリストの一覧(データソース・読者(`userId`・`name`・`contactId`)・属性定義) |
| get_list | `GET /lists/{list_id}` | | データソース・読者・属性定義 |
| list_threads | `GET /threads` | `-q filter=my_turn\|mine\|open\|overdue\|triage\|all`(既定 `open`)、`-q data_source=...`、`-q since=<ISO 8601>`(それより後に動いたものだけ。メモのスレッドは結んだ先が動いても入る) | スレッドの一覧(自分か見える結んだ先の最新の更新 `lastActivityAt` の新しい順)。各スレッドに `ball`・`turn`(`by` は `owner` / `holder` / `reader` / `addressed`)・`ownerUserId`・`links`・`attributes`・`source`(写し)・`derivedBall`・`linkCandidates`・`overdue`・`closedAtSource`(ソースで完了) など |
| get_thread | `GET /threads/{thread_id}` | `-q since=<ISO 8601>`(省略可。タイムラインをそれより後に絞る) | `thread`(一覧と同じ項目)、`dataSource`、`linked`(結んだ先。両端を読めるものだけ。見えないスレッドへのリンクは、あることも出ない)、`timeline`(このスレッドのシグナル・メモ・操作と、結んだ先のシグナルを時刻順に) |
| add_note | `POST /notes` | `{"body", "thread_id"?, "title"?, "author"?}`。`thread_id` を渡せば既存のメモのスレッドに足し、渡さなければ新しいスレッド(「この件」)を作る。件名は `title`、なければ本文の 1 行目。`author` は書き手で、人の言葉(中継を含む)なら省略か `{"kind":"user"}`、エージェント自身が書いたもの(judge・結果の要約・提案)なら `{"kind":"agent","name":"orchestrator"}` のように名前を付ける。タイムラインのメモに `signal.author` で出る(誰の番には使わない) | メモのスレッド(`get_thread` と同じ) |
| claim_thread | `POST /threads/{thread_id}/claim` | `{"user_id"?, "reason"?}`。省略で自分が持つ、`null` で手放す、ほかの読者の User ID で引き継ぐ | `get_thread` と同じ |
| link_threads | `POST /threads/{thread_id}/links` | `{"thread_id", "reason"?}`(結ぶ相手) | `get_thread` と同じ。候補から張れば経路 `anchor`、それ以外は `manual` |
| unlink_threads | `POST /threads/{thread_id}/unlink` | `{"thread_id", "reason"?}` | `get_thread` と同じ |
| set_attribute | `POST /threads/{thread_id}/attributes` | `{"name", "value"}`(`null` で外す)。個人のメモのスレッドだけ(外のサービスの属性は写しなので書けない) | `get_thread` と同じ |
| dismiss_thread | `POST /threads/{thread_id}/dismiss` | `{"reason"}`(必須)。仕分け待ちから片付ける・メモのスレッドを閉じる | `get_thread` と同じ |
| reopen_thread | `POST /threads/{thread_id}/reopen` | `{"reason"?}` | `get_thread` と同じ |
| move_signal | `POST /signals/{signal_id}/move` | `{"thread_id"}` か `{"new_thread_title"}` のどちらか、`"needs_response"?`(受信だけ)、`"reason"`(必須) | 移した先のスレッド(`get_thread` と同じ) |
| record_sent | `POST /sent` | 下の「送信の記録」 | 送ったシグナルの入ったスレッド(`get_thread` と同じ) |
| rename_me | `PATCH /me` | `{"name"}` | `me` と同じ |
| create_data_source | `POST /data-sources` | `{"channel", "name", "identity", "gateway_credential_id", "description"?, "group"?}`。個人のリスト(読者は自分だけ) | `get_list` と同じ + `identity`(上の「初めてつないだとき」) |
| set_identity | `POST /lists/{list_id}/identity` | `{"identity"}`(そのリストでの自分のアカウント) | `identity` の結果(`kind`・`contactId`) |
| list_unresolved | `GET /addresses/unresolved` | | `[{channel, value, count, lastSeenAt, threadIds}]`(最後に見た順) |
| search_contacts | `GET /contacts` | `-q q=<名前かアドレスの一部>` | `[{id, name, userId, addresses: [{id, channel, value, validFrom, validTo}], externalRefs}]` |
| get_contact | `GET /contacts/{contact_id}` | | Contact(まとめて消えた ID はまとめ先) |
| create_contact | `POST /contacts` | `{"name", "address"?: {"channel", "value"}}` | Contact |
| rename_contact | `PATCH /contacts/{contact_id}` | `{"name"}` | Contact |
| add_address | `POST /contacts/{contact_id}/addresses` | `{"channel", "value", "valid_from"?, "reason"?}`。同じ時点で別の Contact に付いていれば `conflict` | Contact |
| end_address | `POST /contacts/{contact_id}/addresses/{address_id}/end` | `{"valid_to"?, "reason"?}`(省略で今) | Contact |
| merge_contacts | `POST /contacts/{contact_id}/merge` | `{"from", "reason"?}`(`from` をまとめる。両方に User があれば `conflict`) | まとめ先の Contact |
| unbind_contact | `POST /contacts/{contact_id}/unbind` | | Contact(自分の Contact だけ。見えるものは変わらない) |

Contact の API(`/contacts`・`/addresses/unresolved`)は、どれかのリストの読者(チームのメンバー)だけが使える(ほかは `forbidden`)。

エラーは `{"error": "not_found" | "invalid" | "forbidden" | "conflict", "message": ...}`。見えないスレッドやデータソースは、存在していても `not_found` になる。

### 送信の記録(record_sent)

```json
{
  "data_source": "ds_support",
  "to": ["owner@tanaka-bldg.example"],
  "to_contact_ids": [],
  "from": "acct-nose",
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
- `to` か `to_contact_ids` のどちらかは必須。`to` はそのチャネルのアドレス
- `from`(任意): 実際に送ったアドレス。Jira のコメントや Slack の発言のように自分のアカウントで書いたときは、そのアカウントを入れる。省けばデータソースの窓口(共有メールボックス・LINE 公式アカウント)、窓口がなければ(個人の箱)自分のアドレス。そのデータソースでこちらのアドレスでなければ invalid
- `reply_to_thread_id`: 返事をしているスレッド(同じデータソース)。送ったシグナルはそこに入る。省略すると、アンカーで決まらなければ新しいスレッドになる
- `source_thread_id`: 送る元になったスレッド(どのデータソースでもよい。メモのスレッドや、LINE の欠勤のスレッドから打診を送るときなど)。送ったスレッドと経路 `sent` で結ばれる
- `reply_expected_by`: 返事期待の期限(ISO 8601、オフセット付きでよい)。過ぎると `overdue` になり、返事が来れば消える
- ボールは相手へ移る。返事は同じデータソースに戻り、送ったスレッドに入る
- **Jira の起票**: `sent_ref` に課題キー、`anchors.thread_key` にも同じ課題キーを入れる。`to_contact_ids` は担当者、`source_thread_id` に起票の元になったスレッド(LINE・メール・Slack など)。課題のスレッドができて元のスレッドと経路 `sent` で結ばれ、課題の状態(写し)とコメントはそのスレッドに入る
- **Jira のコメント**: `sent_ref` にコメント ID、`anchors.thread_key` に課題キー、`reply_to_thread_id` に課題のスレッド

## よくある流れ

1. 「今日やることは？」: `GET /threads -q filter=my_turn`。仕分け待ち(誰の番か決まらないもの)は `filter=triage`、返事待ちの期限超過は `filter=overdue`。前回から何が動いたかは `-q since=<前回見た時刻>`
2. 「この件は私が持つ」: `POST /threads/{id}/claim`。引き継ぐなら `{"user_id": "..."}`、手放すなら `{"user_id": null}`
3. 「この課題に着手する」: 上の「タスクとして追う」。メモを作る → 元のスレッドと結ぶ → (チームに見せるなら)元のスレッドを `claim`。以後、外に出したものは `source_thread_id` にメモを入れて記録する
4. 「この件をまとめて追いたい」: `POST /notes` でメモのスレッドを作る → `GET /threads/{id}` の `linkCandidates` と、ユーザーの話から関係するスレッドを選ぶ → `POST /threads/{メモのid}/links`。LINE の 1 本だけで済むなら、メモを作らず持つだけでよい
5. 「この件に返信して」「協力会社に依頼して」: `GET /threads/{id}` で経過を読む → 文面と宛先・返事期待をユーザーに確認 → 送信のスキルで送る → **すぐ `POST /sent`**(返信なら `reply_to_thread_id`、別の相手への依頼なら `source_thread_id` に元のスレッド)
6. 「メモの件、どうなった？」: `GET /threads/{メモのid}`。`derivedBall` が結んだ先から見たボール(`my_turn` / `waiting`)、`timeline` に結んだ先の受信も並ぶ
7. 「もう対応不要」: 仕分け待ちなら `POST /threads/{id}/dismiss`、件が片付いたらメモのスレッドも `dismiss`。また動いたら `reopen`
8. 「振り分けが違う」: `POST /signals/{signal_id}/move`(既存のスレッドか新しいスレッドへ)。違うスレッドと結んだら `unlink`
9. 「これ課題にして」: 起票の内容(要約・説明・担当者)をユーザーに確認 → jira スキルで起票 → **すぐ `POST /sent`**(`sent_ref` と `anchors.thread_key` に課題キー、`source_thread_id` に元のスレッド)。ステータスや担当者を変えたいときは jira スキルで Jira を直接変える
