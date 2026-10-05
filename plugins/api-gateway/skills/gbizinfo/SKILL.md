---
name: gbizinfo
description: 経済産業省の法人情報サイト gBizINFO の REST API(v2)を API ゲートウェイ経由で呼び出す。法人名・法人番号・所在地・資本金・従業員数などによる法人の検索と、法人の基本情報、届出・認定、表彰、財務、特許、調達、補助金、職場情報、事業所情報の取得、期間内の更新情報の取得を扱う。「この会社の法人番号を調べて」「gBizINFO で会社を検索して」「取引先の財務情報を見て」「補助金の採択実績を調べて」「資本金 1 億円以上の東京の会社を探して」などの依頼で使う。
---

# gBizINFO API

gBizINFO の REST API(v2)を、API ゲートウェイ経由で呼び出す。トークンの発行とスクリプトの基本的な使い方は、`api-gateway` スキルに従う。読み取り専用で、登録や更新はない。

## 手順

1. `api-gateway` スキルの手順で、サービス `gbizinfo` の認証情報を選んでトークンを発行し、`GW_TOKEN` と `GW_BASE_URL` を設定する。
   - 認証情報は gBizINFO の API トークン。ユーザーが gBizINFO の Web API 利用申請で取得し、ゲートウェイの画面で登録する。公式の仕様書にある動作確認用のトークンは、仕様書のページでの確認専用なので使わない。
2. エンドポイントと検索条件を [references/endpoints.md](references/endpoints.md) で確かめる。
3. `api-gateway` スキルの `gw_request.py` で呼び出す。パスは `/hojin/v2/...` で始まる。

```sh
GW=$(ls ${CLAUDE_SKILL_DIR}/../*api-gateway/scripts/gw_request.py)
python3 $GW GET gbizinfo /hojin/v2/hojin -q name=ノヴシ -q limit=10
python3 $GW GET gbizinfo /hojin/v2/hojin/1234567890123
python3 $GW GET gbizinfo /hojin/v2/hojin/1234567890123/finance
```

## API の要点

- パスは `/hojin/v2/hojin...`。v1 も残っているが、新しく使うなら v2。
- 法人は 13 桁の法人番号で特定する。名前しか分からないときは、先に `name` で検索して法人番号を調べる。同名の法人が複数ありうるので、所在地(`location`)で見分けてユーザーに確かめる。
- 検索の `name` は部分一致、`corporate_number` は完全一致。検索の結果は、法人番号・名前・所在地などの基本項目だけ。詳しい情報は、法人番号を指定して個別のエンドポイントで取る。
- ページングは `page`(1〜10)と `limit`(最大 5000)。上限を超える件数は取れないので、条件を絞る。
- 条件に合う法人がなくても、HTTP 200 で `hojin-infos` が空になることがある。エラーは本文の `errors` や `message` も確かめる。
- `metadata_flg=true` を付けると、各項目の出典などのメタデータが付く。通常は付けない。
- 都道府県(`prefecture`)と市区町村(`city`)は、全国地方公共団体コードの数字を使う(東京都は `13`)。市区町村は都道府県と一緒に指定する。
- 掲載は、各府省が公開した情報に基づく。財務や特許などは、すべての法人にあるわけではない。

## 制限と注意

- API トークンのレート制限や利用条件は、gBizINFO 側で決まる。429 が返ったら、少し待って間隔をあける。大量に取得するときは、結果をファイルに保存して使い回す。
- 法人番号や取得した情報を報告するときは、取得した日と出典(gBizINFO)を添える。最新の登記と一致するとは限らない。
- 401 や 403 は、API トークンが無効か期限切れのことが多い。ユーザーに gBizINFO で確認してもらう。
