---
name: heddleway
description: API ゲートウェイ(Heddleway コネクタ)経由で外部サービスの API を呼び出すための共通手順。複数の組織のゲートウェイ(コネクタ)がつながっているときのコネクタの選び方、認証情報の確認、MCP のツール(api_get / api_request)での小さい呼び出しとスクリプトとの使い分け、短命トークンの発行、スクリプトからの REST 呼び出し、ファイルのダウンロードとアップロードを扱う。freee、Microsoft Graph(Outlook メール・OneDrive / SharePoint・Teams・予定表)、Gmail、Google Drive、Google Calendar、gBizINFO など、ゲートウェイに登録されたサービスの API を叩くときは、サービス別のスキルと合わせて必ず使う。
---

# API ゲートウェイの使い方

API ゲートウェイは、連携先サービスの認証情報を預かり、リクエストに注入して中継する。Claude は認証情報そのものを扱わない。

- MCP コネクタ(Heddleway)のツール: `list_credentials`、`api_get`、`api_request`、`issue_token`
- `api_get` / `api_request`: ゲートウェイが上流の API を呼んで、応答をツールの結果として返す。スクリプトもトークンも要らない(下の「MCP のツールで呼ぶ」)。
- REST: `<base_url>/<service>/<上流のパス>` に `issue_token` のトークン付きで送ると、ゲートウェイが上流の認証ヘッダーに差し替えて転送する。ボディはそのまま中継される。
- ゲートウェイは 1 つの組織に 1 つ。複数の組織で仕事をするユーザーは、組織ごとのゲートウェイを別々のコネクタとしてつないでいる。どのコネクタも同じツールを持つので、まず下の「コネクタの選び方」でコネクタを決める。

## コネクタの選び方

同じゲートウェイのコネクタが複数つながっているのは普通のこと。コネクタは組織ごとに分かれていて、コネクタの instructions、ツールの説明、`list_credentials` と `issue_token` の結果の `gateway.organization` に、そのゲートウェイの組織名が出る。

- 依頼から組織が分かれば(会社名、メールのドメイン、その組織専用のプラグインやスキルから使っているなど)、その組織のコネクタを使う。
- 分からないとき: そのサービスを持つコネクタが 1 つだけならそれを使う。2 つ以上あれば、どの組織の作業かをユーザーに聞く。推測で選ばない。
- 1 回の作業は 1 つの組織で完結させる。ある組織のコネクタで読んだものを、別の組織のコネクタで書く(送る・起票する・アップロードする)ときは、何をどこへ出すかをユーザーに確認してから行う。
- `api_get` / `api_request` は、呼んだコネクタの組織のゲートウェイを通る。結果の `gateway.organization` で確かめられる。
- `GW_TOKEN` / `GW_BASE_URL` は 1 組しかない。どうしても組織をまたぐときは、組織を切り替えるたびに、その組織のコネクタで発行したトークンと `base_url` を入れ直す。
- 組織が別なら、同じサービスでもアカウントは別のゲートウェイにある。あるコネクタの `list_credentials` に目当てのアカウントがなければ、ほかの組織のコネクタを確かめる。別の組織のアカウントを、いまのゲートウェイに登録するよう案内しない。

## 手順

1. 選んだコネクタの `list_credentials` で、使えるサービスとユーザーが登録済みの認証情報を確かめる。結果の `gateway.organization` が、作業する組織と合っているかも見る。
   - 必要なサービスの認証情報がなければ、`register_url` を案内して、ユーザーに登録してもらう。Claude が認証情報を受け取って登録することはできない。
   - 1 人がつなげるのは 1 つのサービスにつき 1 つ。以前につないだものが残っていて同じサービスに 2 つ以上ある場合だけ、`label` を見て、どれを使うかユーザーに確認し、使わないほうを画面で削除するよう勧める。
2. 下の「使い分け」で、MCP のツールで呼ぶかスクリプトで呼ぶかを決める。
3. MCP のツールで呼ぶなら、`api_get` / `api_request` に認証情報の ID とパスを渡す(下の「MCP のツールで呼ぶ」)。
4. スクリプトで呼ぶなら、`issue_token` に使う認証情報の ID を渡して、トークンを発行する。1 サービスにつき 1 つまで。複数サービスをまとめて 1 つのトークンにできる。
   - トークンの寿命は 15 分。期限が切れたら発行し直す。
5. 結果の `token` と `base_url` を環境変数に入れて、スクリプトを実行する。

```sh
export GW_TOKEN='<token>'
export GW_BASE_URL='<base_url>'
python3 ${CLAUDE_SKILL_DIR}/scripts/gw_request.py GET freee /api/1/companies
```

Claude Code では、Bash の呼び出しごとにシェルが新しくなり、前の呼び出しの `export` は残らない。`export` とスクリプトの実行を、毎回同じコマンドに書く。

## 使い分け

| 呼び方 | 向いている作業 |
|---|---|
| `api_get` / `api_request` | 1 件の取得、絞り込んだ一覧の 1 ページ、1 回の登録・更新・削除など、数回で済む JSON(テキスト)の呼び出し。サンドボックスもトークンも要らないので速い |
| `issue_token` とスクリプト | ページをたどる全件取得、件数の多いループや集計、ファイル(PDF・画像など)のダウンロード・アップロード、multipart、応答が大きいもの |

- 迷ったら、まず `api_get` で 1 ページ取ってみて、全件や大量のデータが要ると分かったらスクリプトに切り替える。
- サービス別のスキルの手順が `gw_request.py` で書かれていても、同じパス・クエリ・ボディを `api_get` / `api_request` に渡せば同じ呼び出しになる。`gw_request.py GET <service> <path> -q k=v` は `api_get` の `path` と `query` に、`--json` は `api_request` の `json` に当たる。
- Team / Enterprise でサンドボックスからゲートウェイに届かない(外への通信が許可されていない)ときも、MCP のツールなら呼べる。ファイルと大量のデータは、管理者にゲートウェイのドメインを許可してもらう。

## MCP のツールで呼ぶ

- `api_get`: GET。読み取りなので、確認なしで呼べる。
- `api_request`: `method` に POST・PUT・PATCH・DELETE を渡す。呼ぶたびにユーザーの確認が出る。GraphQL や検索の API のように、読み取りでも POST のものはこちら。
- 共通の引数:
  - `credential_id`: `list_credentials` の認証情報の ID(`identity:<service>` も可)。サービスはこれで決まる。
  - `path`: 上流のパス。`/` で始める。`<base_url>/<service>` より後ろの部分(例: freee なら `/api/1/deals`)。日本語はそのまま書いてよい。
  - `query`: クエリパラメータのオブジェクト(`{"company_id": 1, "limit": 50}`)。配列を渡すと同じキーを繰り返す。
  - `headers`: 追加のヘッダー。`Authorization` はゲートウェイが付ける。
  - `max_chars`: 返すボディの長さの上限(既定 5 万文字、最大 10 万文字)。
- `api_request` だけの引数: `json`(JSON のボディ)か `text`(そのままのボディ。`headers` で `Content-Type` を指定する)。
- 結果: `status`、主なレスポンスヘッダー(`content-type`、`location`、`link`、レート制限など)、`body`(JSON は解析済み、それ以外はテキスト)。
  - 上限を超えたボディは切り詰められ、`truncated: true` と `total_chars` が付く。`fields` や絞り込み、ページの大きさで応答を小さくするか、スクリプトに切り替える。
  - バイナリのボディは返らない(`body_omitted`)。スクリプトの `-o` で保存する。
  - リダイレクトは追わず、`status` と `headers.location` を返す(署名付きのダウンロード URL など)。
  - 上流が 400 以上を返したときは、ツールの結果がエラーになり、ボディ(エラーの内容)が付く。

## gw_request.py

サービス別のスキルは、それぞれ自分の `scripts/` に同じ `gw_request.py` を持っている。サービス別のスキルを使うときは、そのスキルの手順にあるパス(`${CLAUDE_SKILL_DIR}/scripts/gw_request.py`)で呼ぶ。Microsoft 365、Google、freee のスキルは、別のプラグイン(`heddleway-microsoft`、`heddleway-google`、`heddleway-freee`)に入っている。

1 回の HTTP リクエストを送る。ステータスは標準エラー、ボディは標準出力(JSON は整形)に出る。

```sh
gw_request.py <METHOD> <service> <path> [-q key=value ...] [-H Name=value ...]
              [--json '{...}' | --json @body.json | --data file.bin]
              [-f key=value ... --file field=path ...] [-o out.bin] [--no-follow]
```

- `<path>`: 上流のパス。日本語や空白はそのまま書いてよい(自動で URL エンコードされる)。`$` を含むパスやクエリは、シェルで展開されないようにシングルクォートで囲む。
- `-q`: クエリパラメータ(自動で URL エンコードされる。空白は `%20` になる)
- `-H`: 追加のリクエストヘッダー
- `--json`: JSON ボディ
- `--data`: ファイルの中身をそのままボディにする(`-H Content-Type=...` と合わせて使う)
- `-f` / `--file`: multipart/form-data(ファイルのアップロード)
- `-o`: レスポンスをファイルに保存する(PDF などのバイナリ)
- リダイレクトは自動で追う。別ホストへのリダイレクト(署名付きのダウンロード URL など)には、トークンを送らない。

## 注意

- スクリプトから直接 HTTP を送るときは、必ず `User-Agent` を明示する。Python の既定の User-Agent は Cloudflare に Error 1010 で拒否される。付属のスクリプトは設定済み。
- トークンをファイルやメッセージに残さない。環境変数で渡す。
- ファイル本体は会話に貼らず、スクリプトで保存・送信する。
- 更新・削除のリクエストは、実行前に内容をユーザーに確認する。`api_request` でも、クライアントの確認とは別に、何をどう変えるかを先に伝える。
- 上流の権限は、登録された API キーやトークン側で決まる。403 が返ったら、その認証情報に必要な権限があるかをユーザーに確認してもらう。
- OAuth で接続するサービス(freee、Microsoft Graph、Gmail、Google Drive、Google Calendar、Google Docs、Google Analytics など)は、ゲートウェイが上流のトークンを注入し、更新もする。Claude が上流のトークンやクライアント ID を扱うことはない。ゲートウェイが `credential must be reconnected by the user at ...` の 403 を返したら、その URL でユーザーに接続し直してもらう。
- git の接続先(`github-git` など)は REST ではなく git で使う。`git` スキルに従う。
- 接続先のネットワークが制限されている環境(Team / Enterprise のコード実行設定)では、スクリプトで呼ぶにはゲートウェイのドメインを管理者に許可してもらう必要がある。つないだゲートウェイごとに要る。`api_get` / `api_request` はサンドボックスを通らないので、許可がなくても使える。
