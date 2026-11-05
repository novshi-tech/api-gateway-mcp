---
name: git
description: API ゲートウェイ経由で git を使う(GitHub・Bitbucket などのリポジトリの clone・fetch・pull・push)。ゲートウェイのトークンを git に渡す方法、トークンを .git/config や URL に残さないこと、15 分で切れるトークンの取り直し、失敗したときの切り分けを扱う。「ゲートウェイ経由で clone して」「このリポジトリを取ってきて」「ブランチを push して」「git の認証が通らない」などの依頼や、ゲートウェイの接続先に `github-git`・`bitbucket-git` のような git の接続先があるときに使う。
---

# git(ゲートウェイ経由)

ゲートウェイは git の smart HTTP をそのまま中継する。git がゲートウェイのトークンを送ると、ゲートウェイがそれを上流の認証(GitHub の personal access token など)に差し替える。Claude は上流のトークンを扱わない。トークンの発行は `heddleway` スキルに従う。

## 手順

1. `heddleway` スキルの手順で、コネクタの `list_credentials` を見て git の接続先(`github-git`、`bitbucket-git` など。デプロイごとに名前が違う)を探す。認証情報がなければ `register_url` を案内して、ユーザーに登録してもらう。
   - 何ができるか(読むだけか、push もできるか、どのリポジトリか)は、ユーザーが登録したトークンの権限で決まる。ゲートウェイは repo ごとの許可を持たない。
2. `issue_token` でトークンを発行し、`GW_TOKEN` と `GW_BASE_URL` を設定する。
3. git は `scripts/gw_git.py` を通して呼ぶ。引数はそのまま git に渡る。

```sh
export GW_TOKEN='<token>' GW_BASE_URL='<base_url>'
URL=$(python3 ${CLAUDE_SKILL_DIR}/scripts/gw_git.py --url github-git owner/repo)
python3 ${CLAUDE_SKILL_DIR}/scripts/gw_git.py clone "$URL"
cd repo && python3 ${CLAUDE_SKILL_DIR}/scripts/gw_git.py pull
python3 ${CLAUDE_SKILL_DIR}/scripts/gw_git.py push origin my-branch
```

Claude Code では、Bash の呼び出しごとにシェルが新しくなる。`export` と `gw_git.py` を毎回同じコマンドに書く。`commit`・`log`・`diff` などの手元だけの操作は、普通の `git` でよい。

## gw_git.py がすること

- トークンを、`GW_BASE_URL` の下の URL にだけ送る `Authorization: Bearer` として、環境変数(`GIT_CONFIG_COUNT`)で git に渡す。コマンドラインにも `.git/config` にも残らず、ほかの remote や submodule には送られない
- ゲートウェイの URL では credential helper を使わない(保存済みのパスワードを試さない)
- `GIT_TERMINAL_PROMPT=0` で、認証に失敗したときにパスワードを聞いて止まらずに、すぐ失敗させる
- `--url <service> <owner/repo>` は、ゲートウェイ上のリポジトリの URL(`<base_url>/<service>/<owner>/<repo>.git`)を出す。remote の URL にはトークンが入らないので、clone したあとも同じ URL のまま使える

`gw_git.py` を使えないときは、同じことを `git -c http.extraHeader="Authorization: Bearer $GW_TOKEN" -c credential.helper= ...` で行い、`GIT_TERMINAL_PROMPT=0` を付ける。

## やってはいけないこと

- トークンを URL に入れない(`https://x:<token>@...`)。`git config` や `.git/config` にも書かない。remote の URL として残り、ログやエラーにも出る
- 上流のトークン(PAT)をユーザーから受け取らない。登録はユーザーがゲートウェイの画面で行う
- push・ブランチの削除・force push は、何をどこへ送るかをユーザーに確認してから行う

## トークンの寿命

ゲートウェイのトークンは 15 分で切れる。clone のあと時間がたってから fetch・pull・push するときは、`issue_token` で発行し直して `GW_TOKEN` を入れ替える。ゲートウェイがトークンを確かめるのは各リクエストの始めなので、大きい clone の転送の途中で切れることはない。

## 失敗したとき

git の `fatal: could not read Username for 'https://<ゲートウェイ>': terminal prompts disabled` は「401 が返った」という意味しかなく、ゲートウェイと上流のどちらが断ったかが分からない。同じリポジトリの `info/refs` を `gw_request.py` で取ると、どちらが何と言ったかが見える。

```sh
python3 ${CLAUDE_SKILL_DIR}/scripts/gw_request.py GET github-git /owner/repo.git/info/refs -q service=git-upload-pack -o /dev/null
```

| 返ってきたもの | 意味 | 対処 |
|---|---|---|
| 401 `invalid or expired gateway token` | ゲートウェイのトークンが切れた | `issue_token` で発行し直す |
| 403 `token does not cover service` | トークンにその接続先の認証情報が入っていない | 認証情報の ID を確かめて発行し直す |
| 401 `Invalid username or token`(GitHub) | 登録したトークンが無効(期限切れ、貼り間違い) | ユーザーにトークンを作り直して、ゲートウェイの接続を削除してから登録し直してもらう |
| 404 / 403 `Repository not found`(GitHub) | リポジトリがない、またはトークンの権限がそのリポジトリに届いていない | リポジトリ名を確かめる。合っていれば、トークンの対象リポジトリ・Resource owner(org のリポジトリなら org)・org の承認待ちをユーザーに確かめてもらう |
| push で 403 | トークンが読み取りだけ | 書き込みのできるトークンが要る。ユーザーに確かめる |
| 200 | ゲートウェイも上流も通っている | git の側の問題。`GIT_TRACE=1 GIT_CURL_VERBOSE=1` で見る(トークンが出力に出るので、出力を会話やファイルに残さない) |

## 注意

- Workers のリクエストのボディには上限がある(プランによって 100MB〜)。巨大なファイルを含む push は通らない。clone と fetch には上限がない
- Git LFS は、LFS のサーバーが別のホストに誘導することがあり、このスキルでは扱わない
- 接続先のネットワークが制限されている環境(Claude Code のクラウドセッション、Team / Enterprise のコード実行設定)では、ゲートウェイのドメインを許可しておく必要がある
