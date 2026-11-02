# 0002 git をゲートウェイで中継する。repo ごとの許可は持たない

- 状態: 採用(2026-11-02。案は 2026-10-29、直樹とのディスカッション)。2026-11-02 に背景を動機から書き直し、決定 2 の「読み取り専用と書き込み用の認証情報を使い分ける」を取り下げた(下の「改訂」)
- 関連: [0001](0001-absorb-boid-gateways.md)(boid の API ゲートウェイを引き取る。案)、[0004](0004-one-deployment-per-organization.md)(1 つのサービスにつき認証情報は 1 つ)、[concept.md](../concept.md)(ゲートウェイがやらないこと)
- 発端: novshi-tech/boid の `docs/plans/split-and-shrink.md` §2.3

## 背景

Claude のサンドボックスから、資格情報を置かずに git の clone・push をしたい。いまは手段が forge と環境で限られている。

- Claude Code のクラウドセッションの git は、環境の GitHub のプロキシ経由で、GitHub にしか届かない。Bitbucket(顧客の環境など)は clone も push もできない
- Cowork のサンドボックスには、git の資格情報を渡す仕組みがない
- 資格情報をサンドボックスや `.git/config`・リモートの URL に置くと、ログや成果物、会話に漏れうる

このゲートウェイは、API について同じ問題をすでに解いている。認証情報は保管庫に置き、サンドボックスには短命のトークンだけを渡し、上流の資格情報はゲートウェイが注入する。git の smart HTTP は普通の HTTPS(`GET .../info/refs?service=...`、`POST .../git-upload-pack`・`git-receive-pack`)なので、`proxy.ts` の中継(ボディをストリームのまま流し、hop-by-hop と呼び手の資格情報だけを落として、ヘッダーを差し替える)にそのまま乗る見込みがある。乗るなら、git も API と同じ置き場・同じトークンで扱える。

### boid の git gateway との関係

boid も、サンドボックスの資格情報を持たない git と forge(GitHub・Bitbucket)の間に、認証プロキシ(git gateway)を持っている。機能は 5 つある。

| 機能 | 中身 | このゲートウェイでは |
|---|---|---|
| 資格情報の注入 | ホストと workspace ごとに token を注入する | 接続先の定義で行う(決定 1) |
| repo ごと・操作ごとの許可 | job ごとのトークンで、どの repo を fetch だけ / push もできるかを決める | 持たない(決定 2) |
| push の観測 | push された ref を拾って boid のタスクに記録する | 要らない。成果は job の結果で返す |
| リリースの検証 | push したブランチの先頭が期待のコミットかを確かめる | 要らない。オーケストレータが forge の API で確かめる |
| 対話のプロンプトの回避 | 資格情報がないとき 502 で落とし、git がパスワードを聞いてこないようにする | `GIT_TERMINAL_PROMPT=0` で足りる |

0001(boid の API ゲートウェイを引き取る)が採用になれば、この決定で boid の git gateway も退役できる。ただし 0002 は 0001 に依らない。0001 がなくても、上の背景だけで成り立つ。

## 決定

### 1. git の接続先を足す

`github-git`(`base_url: https://github.com`)、`bitbucket-git`(`base_url: https://bitbucket.org`)のような接続先を足し、上流には Basic 認証を注入する。

```sh
git -c http.extraHeader="Authorization: Bearer $GW_TOKEN" \
    clone https://<ゲートウェイ>/api/github-git/owner/repo.git
```

- ゲートウェイは呼び手の `Authorization`(ゲートウェイのトークン)を落とし、上流用の Basic 認証を注入する
- git のためのコードは足さない。接続先の定義だけで済ませる(ゲートウェイは HTTP と OAuth2 だけを知る)
- 長い作業の途中でトークン(15 分)が切れるので、git の credential helper(または `extraHeader` を差し替える小さなラッパー)が取り直す。Claude のセッションの外での取り方は 0001 の決定 3

### 2. repo ごと・操作ごとの許可は持たない。権限は上流で絞る

concept.md の「メソッドやパスによる認可はしない。権限を絞りたければ、上流側で絞った認証情報を登録する」をそのまま当てる。

- ユーザーが登録するトークンの範囲が、そのまま Claude にできることの上限になる。Claude に触らせたい repo と権限(読み取りか書き込みか)に絞ったトークンを登録する
  - GitHub: fine-grained personal access token(repo ごと、Contents の read / write)
  - Bitbucket: repository access token(repo ごとに read / write。ユーザー名は `x-token-auth`)。OAuth の consumer は、ユーザーが見えるすべての repo に効くので、git には広すぎる
- 1 つの forge につき接続先は 1 つ、認証情報はユーザーごとに 1 つ(0004 の決定 5)。読み取り専用と書き込み用を別の接続先に分けることもしない。同じゲートウェイにつながっていれば、どちらのトークンも発行できるので、境界にならない
- push してよいかの判断は、ゲートウェイの権限ではなく運用(スキルの「push の前にユーザーに確かめる」など)で行う
- boid にも、このゲートウェイにも、repo ごとの許可は持たない

## 気をつけること

- push のサイズ: Workers のリクエストのボディには上限がある(プランによって 100MB〜)。巨大なバイナリを push しなければ当たらない
- clone はレスポンスのストリームなので、サイズの制限はない
- 上流のレート制限は肩代わりしない(429 はそのまま返す。concept.md のまま)

## 得るもの

- Claude Code のクラウドセッションから、このゲートウェイ経由で GitHub 以外(Bitbucket)を clone・push できる(環境のネットワークの設定でゲートウェイのドメインを許可する)
- Cowork のサンドボックスからも、git があれば同じことができる
- git の資格情報の置き場が、API と同じ保管庫に一本になる。サンドボックスに残るのは 15 分のトークンだけ

## 代案

- **boid の git gateway を残す**: 0001 の二重管理が git でも残り、クラウドセッションや Cowork からは使えない。採らない
- **ゲートウェイに git 専用の中継(repo ごとの許可、push の観測)を作る**: ゲートウェイが git のプロトコルを知ることになり、「API の仕様を知らない」が崩れる。採らない
- **読み取り専用と書き込み用の認証情報を登録し、作業ごとにトークンを使い分ける**: 最初の決定 2。下の「改訂」で取り下げた

## 確かめること

1. ~~`info/refs`・`git-upload-pack`・`git-receive-pack` が今の `proxy.ts` のまま通るか(リクエストの `Content-Encoding: gzip`、プロトコル v2 の `Git-Protocol` ヘッダー、リダイレクト)~~ → 通った(下の「疎通の結果」)
2. ~~ヘッダー型の認証方式で、上流用の `Authorization: Basic ...` を組み立てられるか~~ → 認証方式 `basic` を足した(下の「追記」)
3. ~~GitHub と Bitbucket が、ゲートウェイ(Cloudflare)からの git の通信を問題なく受け付けるか~~ → GitHub は受け付けた。Bitbucket は未確認
4. Cowork のサンドボックスに git が入っているか

## 追記(2026-11-02): 認証方式 `basic` を足す

ヘッダー型(`prefix` + 値)では、ユーザーが `ユーザー名:トークン` の Base64 を自分で作って登録するしかなかった。Basic は HTTP の仕様(RFC 7617)で決まった方式なので、ヘッダー型のオプションではなく、`headers`・`oauth2`・`identity` と並ぶ認証方式 `basic` として足した。

- ユーザーはユーザー名とパスワードを入れ、ゲートウェイが `Authorization: Basic base64(ユーザー名:パスワード)` を組み立てる(UTF-8)
- 定義に `username` を書くと、ユーザー名はそれに固定し、ユーザーはパスワードだけを入れる。GitHub のトークンは `x-access-token`(PAT ならユーザー名は何でも通り、GitHub App のトークンはこれに決まっている)、Bitbucket のアクセストークンは `x-token-auth`
- ユーザーごとにユーザー名が違う上流(メールアドレスとトークンなど)は、`username` を書かずにユーザーに入れてもらう

```jsonc
"github-git": { "base_url": "https://github.com", "auth": { "type": "basic", "username": "x-access-token" } },
"bitbucket-git": { "base_url": "https://bitbucket.org", "auth": { "type": "basic", "username": "x-token-auth" } }
```

## 疎通の結果(2026-11-02)

組織のデプロイに `github-git`(`basic`、ユーザー名 `x-access-token`、org のリポジトリに絞った fine-grained personal access token)を足し、Claude Code のクラウドセッションから git 2.43(プロトコル v2)で試した。`proxy.ts` は変えていない。

| 操作 | 結果 |
|---|---|
| `git ls-remote` | 通った |
| `git clone`(.git が 5MB ほど) | 通った(3 秒ほど) |
| `git fetch` | 通った |
| `git push`(コミットを載せた新しいブランチ) | 通った。上流に同じ SHA のブランチができた |
| `git push --delete` | 通った |

- 上流が断ったときの 401 には GitHub の本文(`Invalid username or token` など)が載ってくる。ゲートウェイが断ったとき(トークン切れ)は、ゲートウェイの JSON の 401。git にはどちらも「ユーザー名を読めない」としか出ないので、切り分けは同じパスの `info/refs` を REST で取って見る
- 使い方はスキル `git`(`plugins/api-gateway/skills/git/`)にまとめた。トークンは `GIT_CONFIG_COUNT` の環境変数で、ゲートウェイの URL にだけ `http.<url>.extraHeader` として渡し、`.git/config` にも URL にも残さない
- 残り: Bitbucket(顧客の環境なので、顧客のデプロイで確かめる)、Cowork のサンドボックスの git(確かめること 4)、15 分を超える作業でのトークンの取り直し(0001 の未決 1)

## 改訂(2026-11-02): 背景を書き直し、認証情報の使い分けを取り下げる

- 背景が boid の git gateway の機能の棚卸しから始まっていて、何に困ってこの決定をしたのかが読み取れなかった。困りごと(クラウドセッションの git は GitHub だけ、Cowork には渡す手段がない、資格情報をサンドボックスに置きたくない)を先に書き、boid の git gateway との関係は節を分けた。0001 はまだ案なので、0002 はそれに依らずに成り立つと書いた
- 最初の決定 2 は「1 サービスに複数の認証情報を持てるので、読み取り専用と書き込みできるものを別の認証情報として登録し、読み取りだけの作業には読み取り専用の認証情報でトークンを発行する」としていた。これを取り下げた
  - 前提が崩れた: 0004 の決定 5 で、1 人のユーザーがつなげるのは 1 つのサービスにつき 1 つになった
  - そもそも境界にならない: 別の接続先に分けても、同じゲートウェイにつながっていれば両方のトークンを発行できる。どちらを使うかは Claude の自制に頼るだけで、強制できない
  - 残るのは「上流で絞る」だけ。登録するトークンの範囲を、Claude に許したい範囲にする
