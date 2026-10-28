---
name: serper
description: Serper(serper.dev)の API を API ゲートウェイ経由で呼び出し、Google 検索の結果を JSON で取得する。ウェブ検索、画像・ニュース・動画・ショッピング・地図・場所・論文(Scholar)・特許の検索、検索候補(オートコンプリート)を扱う。「Google で調べて」「最新のニュースを検索して」「この会社の評判を検索して」「このキーワードの検索結果の上位を見たい」「近くの店を探して」などの依頼で使う。読み取り専用。
---

# Serper API

Serper は Google の検索結果を JSON で返す API。トークンの発行とスクリプトの基本的な使い方は、`api-gateway` スキルに従う。読み取り専用で、登録や更新はない。

## 手順

1. `api-gateway` スキルの手順で、サービス `serper` の認証情報を選んでトークンを発行し、`GW_TOKEN` と `GW_BASE_URL` を設定する。
   - 認証情報は Serper の API キー。ユーザーが serper.dev のダッシュボードで発行し、ゲートウェイの画面で登録する。
2. このスキルの `scripts/gw_request.py`(共通の `api-gateway` スキルと同じもの) で、**POST** で呼び出す。検索条件は JSON の本文で渡す。

```sh
GW="${CLAUDE_SKILL_DIR}/scripts/gw_request.py"
python3 $GW POST serper /search --json '{"q": "api gateway mcp", "gl": "jp", "hl": "ja", "num": 10}'
python3 $GW POST serper /news --json '{"q": "Cloudflare Workers", "gl": "jp", "hl": "ja", "tbs": "qdr:w"}'
```

## エンドポイント

すべて `POST`。本文は JSON で、`q`(検索語)が必須。

| パス | 内容 | 結果の主なキー |
|---|---|---|
| `/search` | ウェブ検索 | `organic`、`knowledgeGraph`、`peopleAlsoAsk`、`relatedSearches` |
| `/images` | 画像検索 | `images` |
| `/news` | ニュース検索 | `news` |
| `/videos` | 動画検索 | `videos` |
| `/shopping` | ショッピング | `shopping` |
| `/places`、`/maps` | 場所・地図の検索 | `places` |
| `/scholar` | 論文の検索 | `organic` |
| `/patents` | 特許の検索 | `organic` |
| `/autocomplete` | 検索候補 | `suggestions`(各要素は `{"value": "..."}`) |

## 検索条件(本文のキー)

- `q`: 検索語。Google の検索演算子(`site:`、`"完全一致"`、`-除外`)も使える。
- `gl`: 国コード(日本は `jp`)。`hl`: 言語(日本語は `ja`)。日本語の依頼では、この 2 つを付ける。
- `num`: 件数。`page`: ページ番号(1 から)。`page` を増やすと続きの結果が返る。
- `tbs`: 期間の絞り込み。`qdr:d`(1 日)、`qdr:w`(1 週間)、`qdr:m`(1 か月)、`qdr:y`(1 年)。
- `location`: 検索する地域の名前(例: `Tokyo, Japan`)。
- `autocorrect`: `false` で、検索語の自動修正を止める。

## 制限と注意

- 1 回の呼び出しで、プランのクレジットを消費する(結果の `credits` に、その呼び出しの消費量が入る。通常は 1)。無料枠は小さいので、同じ検索を繰り返さず、結果はファイルや会話に残して使い回す。件数を増やす(`num`)と、消費が増えることがある。
- 結果は `organic` の `title`、`link`、`snippet` が中心で、ページの本文は含まない。本文が必要なら、`link` のページを別の手段で取得する。
- 検索結果は取得した時点のもの。報告するときは、出典(`link`)と取得日を添える。
- 401 や 403 は、API キーが無効か、クレジット切れのことが多い。ユーザーに serper.dev で確認してもらう。429 は、少し待って間隔をあける。
- ページの本文を取得する `scrape.serper.dev` はホストが違うので、このサービスでは呼べない。
