# 構想

更新日: 2026-09-26

要件メモ: https://docs.google.com/document/d/1aV-pfbEYjyamSPmm6_JnvG4vZwRO5oiEMCazvK-bX00
認可の設計: [auth-design.md](auth-design.md)

## 目的

Claude Cowork と ChatGPT から、既存のコネクタではできない業務を自動化できるようにする。

- ファイル本体を扱う処理(例: SharePoint の請求書 PDF を freee のファイルボックスに上げる)
- MCP がないサービス(Board、自社ツール)
- サービスをまたぐ処理

**Cowork と ChatGPT からつなげることが最重要。** そのため、リモート MCP のコネクタとして使える形にする。

## 全体像

```
Cowork / ChatGPT
  │ ① MCP(OAuth、ユーザー単位)
  ▼
Worker
  ├─ MCP: 短命トークンの発行など、少数のツール
  └─ REST: /<service>/<path> を上流に中継する ──④ 認証情報を注入──▶ freee / Graph / Board / 自社ツール
        ▲
        │ ③ 短命トークンで呼び出す
  サンドボックス内のスクリプト(スキルに同梱) ◀── ② トークンを受け取る
```

1. ユーザーは、MCP コネクタとして OAuth でログインする(auth-design.md)。
2. Claude がスキルの手順に従い、MCP のツールで寿命の短いトークンを発行してもらう。
3. サンドボックスで動くスクリプトが、そのトークンでゲートウェイの REST を呼ぶ。
4. ゲートウェイは、パスの先頭で上流のサービスを決め、認証情報を注入して転送する。

## 責務

扱う情報が機密なので、責務はできるだけ軽くし、見通しをよくする。

### ゲートウェイがやること

- MCP クライアントの認可(OAuth。ユーザーの認証は外部の IdP に任せる)
- 短命トークンの発行と検証
- パスの先頭から上流のサービスを決め、リクエストを中継する
- 認証情報の保管、注入、リフレッシュ(API キー、OAuth トークン)
- 1 つのサービスに複数の認証情報を持ち、呼び出すときに選ぶ

### ゲートウェイがやらないこと

- **API の仕様を知ること。** OpenAPI や GraphQL のスキーマは取り込まない。ボディの中身は見ないで素通しにする。API の知識はスキルとスクリプトが持つ。
- **メソッドやパスによる認可。** 何ができるかは、上流のサービスが、発行された API キーや OAuth トークンの権限で決める。権限を絞りたければ、上流側で絞った認証情報を登録する。
- **上流のレート制限の肩代わり。** 上流が返す 429 などは、そのまま呼び出し側に返す。

### スキルとスクリプトの役割

- スキル: API の使い方と、業務の手順を書く。
- スクリプト: 決まった手順の処理を、毎回同じ動きで実行する。ファイル本体は、スクリプトとゲートウェイの間だけを流れ、AI の会話を通らない。
- どちらも git で管理し、プラグインとして組織に配布する。

既存のコネクタで足りる処理(freee 公式のリモート MCP での読み取りや取引登録、Claude の M365 コネクタでの読み取りなど)は、そちらを使う。

## 前提となる事実

### 既存のコネクタではファイル本体を運べない

- Claude の M365 コネクタは、ファイルをテキストとして読むだけで、バイナリを取得できない。
  - https://claude.com/docs/connectors/microsoft/365
- freee 公式のリモート MCP は、ボディが JSON だけで multipart を送れない。ファイルのアップロードはローカル(stdio)版だけ。
  - https://github.com/freee/freee-mcp
- MCP のツールの結果として返せるのは、テキストと画像。上限はおよそ 15 万文字。
  - https://claude.com/docs/connectors/building

### サンドボックスとコネクタ

- Cowork のコードは使い捨てのサンドボックスで動く。コネクタの認証トークンはサンドボックスに入らず、スキルに秘密情報を入れてはいけない。
  - https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview
  - https://claude.com/docs/skills/how-to
  - → スクリプトの認証には、MCP で発行する短命トークンを使う。
- サンドボックスから外への通信:
  - Max プランでは、ドメインの制限がないことを実機で確認した。
  - Team / Enterprise では、組織の管理者が許可するドメインを設定する。Enterprise は初期状態だと外に出られない。
    - https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans
  - ChatGPT も、ワークスペースの方針と利用者の設定で、外への通信が許可される。
    - https://learn.chatgpt.com/docs/enterprise/chatgpt-work-overview
  - → 導入時に、管理者がゲートウェイのドメインを許可する。
- スキルやプラグインは、Owner が組織に配布できる。コネクタは Owner が追加し、各メンバーが自分のアカウントで接続する。
  - https://claude.com/docs/plugins/admin

### 連携先

- **freee**
  - `POST /api/1/receipts` は multipart のみ。
  - リフレッシュトークンは一回しか使えず、リフレッシュのたびに新しくなる。
  - 読み取り結果から取引を自動で作る API はない。取引は freee の画面で確定するか、API で作って書類を紐づける。
  - https://developer.freee.co.jp/reference/accounting/reference
  - https://developer.freee.co.jp/reference/faq/token_lifetime
- **Microsoft Graph**
  - ファイルのダウンロードは `GET /drives/{drive-id}/items/{item-id}/content`。事前認証済みの URL への 302 が返るので、リダイレクトをたどる。
  - `Sites.Selected` を使うと、アクセスを特定のサイトに絞れる。
  - https://learn.microsoft.com/en-us/graph/api/driveitem-get-content
- **Board**
  - `x-api-key`(アカウントにひとつ)と `Authorization: Bearer <API トークン>` の 2 つが要る。API トークンごとに、使えるエンドポイントを絞れる。
  - https://developers.the-board.jp/doc/

## 採用しなかった案

| 案 | 理由 |
|---|---|
| 業務ごとに専用の MCP を作る | 業務の分析が事前にできるとは限らず、場当たり的な MCP が増える |
| Cloudflare Code Mode(AI が書いたコードを Worker の中で動かす) | ゲートウェイが API の仕様を知る必要があり、責務が重くなる。まだベータ |
| Executor(executor.sh) | 連携先を API の仕様から型付きのツールにする作りで、素通しの中継がない。Cloudflare 版には MCP の OAuth サーバーがない |
| Composio / Pipedream / Zapier など | 第三者に認証情報を預けることになる |
| n8n / Power Automate のフローを MCP のツールにする | 業務ごとにフローを作る必要があり、認証情報も共有になる |
| freee のローカル MCP と OneDrive の同期フォルダ | クラウドにだけあるファイルを読めない不具合があり、不安定 |

Executor の実装で参考にする点(https://github.com/UsefulSoftwareCo/executor):
- 上流 OAuth のリフレッシュとローテーションの扱い(`packages/core/sdk/src/oauth-service.ts`)
- 組織所有とユーザー所有の二本立ての認証情報(`packages/core/sdk/src/owner-policy.ts`)
- 秘密情報の AES-256-GCM 暗号化(`packages/plugins/encrypted-secrets`)

## 先に決めておくこと

1. **認証情報の持ち方**: ユーザー個人のものと組織で共有するもの(Board の API キーなど)をどう持ち、誰が使えるようにするか。
2. **短命トークン**: 寿命、使える範囲(サービスとアカウント)、発行と検証の方式。
3. **リフレッシュの直列化**: 一回しか使えないリフレッシュトークンを、同時に使わないようにする仕組み(Durable Object など)。
4. **連携先の認証情報を登録する手順**: ユーザーが freee や Graph と接続する画面と、組織の認証情報を管理者が登録する方法。
5. **操作ログ**: 残すかどうか。残すなら、誰が・どの認証情報で・どのメソッドとパスを呼んだか、くらいにとどめ、ボディは残さない。
