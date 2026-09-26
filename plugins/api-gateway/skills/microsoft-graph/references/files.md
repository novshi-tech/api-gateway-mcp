# ファイル(OneDrive / SharePoint)

例の `$GW` は `api-gateway` スキルの `gw_request.py`。パスはすべて `/v1.0` から書く。

## ドライブとアドレス指定

OneDrive も SharePoint のドキュメントライブラリも、同じ drive / driveItem の API で扱う。以下の `{drive}` は次のどれか。

| 対象 | `{drive}` |
|---|---|
| 自分の OneDrive | `/v1.0/me/drive` |
| ドライブ ID を指定(SharePoint のライブラリなど) | `/v1.0/drives/{drive-id}` |
| サイトの既定のライブラリ | `/v1.0/sites/{site-id}/drive` |

ファイルやフォルダは、ID かパスで指定する。

- ID: `{drive}/items/{item-id}`。一覧・検索の結果の `id`。
- パス: `{drive}/root:/{path}:` の後ろに操作を続ける。例 `{drive}/root:/請求書/2026-09:/children`、`{drive}/root:/請求書/a.pdf:/content`。パスの先頭に `/` を重ねない。末尾の `:` を忘れない。ルート直下は `{drive}/root/children`。
- パスの日本語や空白は、`gw_request.py` がエンコードする。そのまま書いてよい。

項目は `folder`(フォルダ)か `file`(`file.mimeType`)のどちらかを持つ。ほかに `name`、`size`、`webUrl`、`lastModifiedDateTime`、`parentReference`(`driveId`、`id`、`path`)。

## SharePoint のサイトとライブラリを探す

```sh
python3 $GW GET graph /v1.0/sites -q search=経理 -q '$select=id,displayName,webUrl'
python3 $GW GET graph /v1.0/sites/{site-id}/drives -q '$select=id,name,webUrl'
python3 $GW GET graph /v1.0/sites/{hostname}:/sites/{path}      # URL がわかっているとき(例 contoso.sharepoint.com:/sites/finance)
```

サイトの `id` は `{hostname},{site-collection-id},{web-id}` の形。ライブラリの `id` が `drive-id`。

## 一覧

```sh
python3 $GW GET graph /v1.0/drives/{drive-id}/root/children -q '$select=id,name,size,file,folder,lastModifiedDateTime'
python3 $GW GET graph '/v1.0/drives/{drive-id}/root:/請求書/2026-09:/children' -q '$select=id,name,size,file'
python3 ${CLAUDE_SKILL_DIR}/scripts/graph_all.py '/v1.0/me/drive/root:/請求書:/children' --csv id,name,size,file.mimeType
```

## ドライブ内の検索

```sh
python3 $GW GET graph "/v1.0/drives/{drive-id}/root/search(q='請求書')" -q '$select=id,name,parentReference,lastModifiedDateTime'
```

- 検索語はパスに埋め込む。シングルクォートを含む語は `''` と重ねる。
- ファイル名だけでなく、本文やメタデータにも一致する。検索の索引への反映には時間がかかることがある。

## 組織全体の検索(Microsoft Search)

どのサイトにあるかわからないときは、`/v1.0/search/query` で driveItem を横断検索する。

```sh
python3 $GW POST graph /v1.0/search/query --json '{
  "requests": [{
    "entityTypes": ["driveItem"],
    "query": {"queryString": "請求書 filetype:pdf"},
    "from": 0, "size": 25
  }]
}'
```

結果は `value[0].hitsContainers[0].hits[].resource` に入る。`resource.id` が item ID、`resource.parentReference.driveId` が drive ID。続きは `from` を増やす(`hitsContainers[0].moreResultsAvailable` が true の間)。

## ダウンロード

```sh
python3 $GW GET graph /v1.0/drives/{drive-id}/items/{item-id}/content -o invoice.pdf
python3 $GW GET graph '/v1.0/me/drive/root:/請求書/a.pdf:/content' -o a.pdf
```

- Graph は事前認証済みの一時 URL(SharePoint のホスト)への 302 を返す。`gw_request.py` はこれを追い、リダイレクト先にはゲートウェイのトークンを送らない。一時 URL は数分で失効するので、`--no-follow` で分けずに一度で取る。
- Office ファイルを PDF にして取るときは `-q format=pdf` を付ける(変換できる形式のみ)。

## アップロード

```sh
python3 $GW PUT graph '/v1.0/drives/{drive-id}/root:/請求書/2026-09/a.pdf:/content' --data a.pdf -H Content-Type=application/pdf
```

- 同じ名前のファイルがあると上書きする。上書きを避けるときは `-q @microsoft.graph.conflictBehavior=fail`(または `rename`)を付ける。
- この方法は 250MB まで。それより大きいファイルは `createUploadSession` による分割アップロードが要り、このスキルでは扱わない。
- 成功すると 200 か 201 で、作られた driveItem が返る。

## フォルダの作成

```sh
python3 $GW POST graph /v1.0/drives/{drive-id}/root:/請求書:/children --json '{"name": "2026-09", "folder": {}, "@microsoft.graph.conflictBehavior": "fail"}'
```

`conflictBehavior` は `fail`、`replace`、`rename`。

## 移動・名前の変更・コピー・削除

```
PATCH  {drive}/items/{item-id}          # {"parentReference": {"id": "<移動先フォルダ ID>"}, "name": "新しい名前"}(片方だけでもよい)
POST   {drive}/items/{item-id}/copy     # {"parentReference": {"driveId": "...", "id": "..."}, "name": "..."}
DELETE {drive}/items/{item-id}          # 204。ごみ箱に移る
```

`copy` は非同期で、202 と `Location`(進み具合を確かめる URL)が返る。完了を確かめたいときは、コピー先のフォルダを一覧して確かめる。

## 共有リンク

```sh
python3 $GW POST graph /v1.0/drives/{drive-id}/items/{item-id}/createLink --json '{"type": "view", "scope": "organization"}'
```

- `type`: `view`、`edit`。`scope`: `organization`(組織内)、`anonymous`(誰でも)、`users`(特定のユーザー)。`anonymous` はテナントの設定で禁止されていることが多い。
- リンクは `link.webUrl`。共有は実行前にユーザーに範囲を確認する。
