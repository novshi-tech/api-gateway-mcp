# シナリオのフィクスチャ

```
fixtures/<scenario>/
  scenario.json    # タイトル・テナント・検証する仮説・状態（desk-checked / draft / stand-recorded）・echoObserved
  seed.json        # Tenant / User / Party / Address / List / ListMember / AttributeDef / CredentialRef / ChannelPolicy
  signals.jsonl    # 時刻順のステップ（受信シグナル・スタンドの操作・Cron）。// で始まる行はコメント
  expected.json    # Ingest の正解ラベル、各時点のボール所在、最終の Task 投影、可視性の確認
  recordings/      # Claude 呼び出しの入出力（再生モード用）。pnpm scenario verify <name> --ai record で作る
```

## signals.jsonl のステップ

```jsonc
// 受信（ダミーコネクタが受け取ったもの）。bind で結果の taskId に名前を付ける
{"id":"s01","at":"2026-10-16T09:00:00.000Z","signal":{ /* InboundSignal */ },"bind":{"custTask":"taskId"}}
// スタンドの操作（HTTP API と同じ入力）。bind で応答のフィールドに名前を付ける
{"id":"a02","at":"...","action":{"tool":"propose_derivation","as":"u_sato","input":{"task_id":"$custTask", ...}},"bind":{"drvInternal":"id"}}
// Cron（取り込みのポーリングと期限の見回り）
{"id":"c01","at":"...","cron":true}
```

- `"$name"` は束縛した値、`"$sent:name"` はその派生の sent_ref（Message-ID）に置き換わる
- 時刻は `2026-10-16T09:00:00.000Z` の形にそろえる（期限の比較は文字列で行う）
- 観測された送信の返事期待は、ヒント実行では `"estimate"` で与える

## expected.json

- `ingest`: 受信ステップごとの正解ラベル（`new`+list / `attach`+task / `ignore` / `merged` / `duplicate`）。
  ヒント実行（AI なし）では、アンカーで決まらなかったシグナルの判断にこのラベルを使う。AI 実行では一致率を測る（H6）
- `checkpoints`: そのステップの直後のタスクの通信状態・属性と派生の状態（H4）
- `final`: 最終のタスク・派生・件数・イベント数
- `visibility`: Viewer ごとの見え方（H3）。`access` は full / summary / null（見えない）

## 状態

| シナリオ | 状態 | 備考 |
| --- | --- | --- |
| repair-estimate（修繕見積） | desk-checked | 机上シミュレーションを機械で通したもの |
| development（開発） | desk-checked | 同上 |
| absence（欠勤連絡） | draft | スタンド主導で回して置き換える（H7） |
| complaint（クレーム） | draft | 同上 |

`recordings/` はまだ空。H6 の Claude 判断の一致率は、`ANTHROPIC_API_KEY` を設定して
`pnpm scenario verify all --ai record` を実行し、記録をコミットすると `pnpm test` で測られる。
添付の `files/` は参照（パスとハッシュ）だけで、実体は置いていない。
