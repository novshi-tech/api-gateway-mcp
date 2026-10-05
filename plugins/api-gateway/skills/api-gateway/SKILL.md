---
name: api-gateway
description: API ゲートウェイ(API Gateway MCP コネクタ)経由で外部サービスの API を呼び出すための共通手順。認証情報の確認、短命トークンの発行、スクリプトからの REST 呼び出し、ファイルのダウンロードとアップロードを扱う。Board、freee、Microsoft Graph(Outlook メール・OneDrive / SharePoint・Teams・予定表)、Gmail、Google Drive、Google Calendar、ビルメンNEXT(GraphQL)、gBizINFO など、ゲートウェイに登録されたサービスの API を叩くときは、サービス別のスキルと合わせて必ず使う。
---

# API ゲートウェイの使い方

API ゲートウェイは、連携先サービスの認証情報を預かり、リクエストに注入して中継する。Claude は認証情報そのものを扱わない。

- MCP コネクタ(API Gateway MCP)のツール: `list_credentials`、`issue_token`
- REST: `<base_url>/<service>/<上流のパス>` にトークン付きで送ると、ゲートウェイが上流の認証ヘッダーに差し替えて転送する。ボディはそのまま中継される。

## 手順

1. `list_credentials` で、使えるサービスとユーザーが登録済みの認証情報を確かめる。
   - 必要なサービスの認証情報がなければ、`register_url` を案内して、ユーザーに登録してもらう。Claude が認証情報を受け取って登録することはできない。
   - 同じサービスに複数ある場合は、`label` を見て、どれを使うかユーザーに確認する。
2. `issue_token` に使う認証情報の ID を渡して、トークンを発行する。1 サービスにつき 1 つまで。複数サービスをまとめて 1 つのトークンにできる。
   - トークンの寿命は 15 分。期限が切れたら発行し直す。
3. 結果の `token` と `base_url` を環境変数に入れて、スクリプトを実行する。

```sh
export GW_TOKEN='<token>'
export GW_BASE_URL='<base_url>'
python3 ${CLAUDE_SKILL_DIR}/scripts/gw_request.py GET board /v1/projects -q per_page=5
```

## gw_request.py

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
- 更新・削除のリクエストは、実行前に内容をユーザーに確認する。
- 上流の権限は、登録された API キーやトークン側で決まる。403 が返ったら、その認証情報に必要な権限があるかをユーザーに確認してもらう。
- OAuth で接続するサービス(freee、Microsoft Graph、Gmail、Google Drive、Google Calendar など)は、ゲートウェイが上流のトークンを注入し、更新もする。Claude が上流のトークンやクライアント ID を扱うことはない。ゲートウェイが `credential must be reconnected by the user at ...` の 403 を返したら、その URL でユーザーに接続し直してもらう。
- 接続先のネットワークが制限されている環境(Team / Enterprise のコード実行設定)では、ゲートウェイのドメインを管理者に許可してもらう必要がある。
