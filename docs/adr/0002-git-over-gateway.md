# 0002 git をゲートウェイで中継する。repo ごとの許可は持たない

- 状態: 案(2026-10-29、直樹とのディスカッション)
- 関連: [0001](0001-absorb-boid-gateways.md)(boid の API ゲートウェイを引き取る)、[concept.md](../concept.md)(ゲートウェイがやらないこと)
- 発端: novshi-tech/boid の `docs/plans/split-and-shrink.md` §2.3

## 背景

boid の git gateway は、サンドボックスの資格情報を持たない git と、実際の forge(GitHub・Bitbucket)の間の認証プロキシ。機能は 5 つある。

| 機能 | 中身 |
|---|---|
| 資格情報の注入 | ホストと workspace ごとに token を注入する |
| repo ごと・操作ごとの許可 | job ごとのトークンで、どの repo を fetch だけ / push もできるかを決める |
| push の観測 | push された ref を拾って boid のタスクに記録する |
| リリースの検証 | push したブランチの先頭が期待のコミットかを確かめる |
| 対話のプロンプトの回避 | 資格情報がないとき 502 で落とし、git がパスワードを聞いてこないようにする |

boid の縮退で、タスクとプロジェクトの概念はなくなる。push の観測とリリースの検証は要らなくなり(成果は job の結果で返し、確かめるのはオーケストレータが forge の API で行う)、プロンプトの回避は `GIT_TERMINAL_PROMPT=0` で足りる。残るのは資格情報の注入と、repo ごとの許可。

git の smart HTTP は普通の HTTPS(`GET .../info/refs?service=...`、`POST .../git-upload-pack`・`git-receive-pack`)なので、`proxy.ts` の中継(ボディをストリームのまま流し、hop-by-hop と呼び手の資格情報だけを落として、ヘッダーを差し替える)にそのまま乗る見込み。

## 決定(案)

### 1. git の接続先を足す

`github-git`(`base_url: https://github.com`)、`bitbucket-git`(`base_url: https://bitbucket.org`)のような接続先を足し、上流には Basic 認証を注入する。

```sh
git -c http.extraHeader="Authorization: Bearer $GW_TOKEN" \
    clone https://<ゲートウェイ>/api/github-git/owner/repo.git
```

- ゲートウェイは呼び手の `Authorization`(ゲートウェイのトークン)を落とし、上流用の Basic 認証を注入する
- git のためのコードは足さない。接続先の定義だけで済ませる(ゲートウェイは HTTP と OAuth2 だけを知る)
- 長い作業の途中でトークン(15 分)が切れるので、git の credential helper(または `extraHeader` を差し替える小さなラッパー)が取り直す。Claude のセッションの外での取り方は 0001 の決定 3

### 2. repo ごと・操作ごとの許可は持たない

concept.md の「メソッドやパスによる認可はしない。権限を絞りたければ、上流側で絞った認証情報を登録する」をそのまま当てる。

- GitHub の fine-grained personal access token は、repo ごと・読み取りだけに絞れる。Bitbucket の repository access token も、repo ごとに read / write を選べる
- 1 サービスに複数の認証情報を持てるので、読み取り専用と書き込みできるものを別の認証情報として登録する。トークンは認証情報に紐づくので、**読み取りだけの作業には読み取り専用の認証情報でトークンを発行する**。権限の判断は「どの認証情報でトークンを出すか」に縮む
- boid にも、このゲートウェイにも、repo ごとの許可は持たない

## 気をつけること

- push のサイズ: Workers のリクエストのボディには上限がある(プランによって 100MB〜)。巨大なバイナリを push しなければ当たらない
- clone はレスポンスのストリームなので、サイズの制限はない
- 上流のレート制限は肩代わりしない(429 はそのまま返す。concept.md のまま)

## 得るもの

- GitHub に縛られない git が、boid の外に出る。Claude Code のクラウドセッションからも、このゲートウェイ経由で Bitbucket を clone・push できる(環境のネットワークの設定でゲートウェイのドメインを許可する)
- Cowork のサンドボックスからも、git があれば同じことができる

## 代案

- **boid の git gateway を残す**: 0001 の二重管理が git でも残り、クラウドセッションや Cowork からは使えない。採らない
- **ゲートウェイに git 専用の中継(repo ごとの許可、push の観測)を作る**: ゲートウェイが git のプロトコルを知ることになり、「API の仕様を知らない」が崩れる。採らない

## 確かめること

1. `info/refs`・`git-upload-pack`・`git-receive-pack` が今の `proxy.ts` のまま通るか(リクエストの `Content-Encoding: gzip`、プロトコル v2 の `Git-Protocol` ヘッダー、リダイレクト)
2. ヘッダー型の認証方式で、上流用の `Authorization: Basic ...` を組み立てられるか。足りなければ、ユーザー名と token から Basic を作る書き方を足す
3. GitHub と Bitbucket が、ゲートウェイ(Cloudflare)からの git の通信を問題なく受け付けるか
4. Cowork のサンドボックスに git が入っているか
