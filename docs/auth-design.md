# MCP ゲートウェイの認可設計

調査日: 2026-09-26

要件メモ: https://docs.google.com/document/d/1aV-pfbEYjyamSPmm6_JnvG4vZwRO5oiEMCazvK-bX00

## 前提と要件

- クライアント: Claude(Cowork / claude.ai / Desktop / Claude Code)は必須、ChatGPT は対応できればよい
- デプロイ形態: 顧客ごとに自分の Cloudflare アカウントへデプロイする OSS
- ログイン: 社内の IdP を使う。主に Entra ID、Google Workspace にも対応し、IdP は差し替えられるようにする
- トークンとユーザー: MCP トークンからユーザーを特定し、そのユーザーの連携先認証情報(freee、Graph など)を注入する

## 結論

**認証と認可を分ける。** MCP の認可サーバーは Worker 自身が担い、`@cloudflare/workers-oauth-provider`(v1.1 以上)で実装する。ユーザー認証は OIDC で上流の IdP に委譲する。

```
Claude / ChatGPT ──(MCP OAuth: CIMD / DCR, PKCE S256, resource)──▶ Worker
                                                                   ├─ 認可サーバー (workers-oauth-provider)
                                                                   └─ MCP リソースサーバー / API ゲートウェイ
                                                                        │
                                                         ログインのみ委譲 (OIDC 認可コード + PKCE)
                                                                        ▼
                                                        Entra ID / Google Workspace / (CF Access for SaaS)
```

- Worker は自前の不透明な MCP トークンを発行する。トークンの宛先(audience)は MCP の URL に固定する。
- 上流の IdP とのやりとりは、ユーザーが誰かを確かめることだけに使う。IdP のトークンは MCP クライアントに渡さない。
- IdP はアダプタとして差し替え可能にする。最初は汎用の OIDC に、IdP ごとのクレーム検証を足した形で作る。

## 用語: クライアント登録方式

OAuth の認可サーバーは、どのアプリ(クライアント)がアクセスしてくるかを知っている必要がある。MCP の世界ではクライアント(Claude や ChatGPT)とサーバーが事前に知り合いではないため、登録方法がいくつかある。

| 方式 | 仕組み | 特徴 |
|---|---|---|
| 事前登録(静的) | 管理者が認可サーバーでクライアントを作り、client_id と secret をコネクタ設定に手で入れる | 確実だが、クライアントごとに手作業が必要 |
| **DCR**(Dynamic Client Registration、RFC 7591) | クライアントが `registration_endpoint` に自分の情報を POST すると、サーバーが client_id を払い出す | 自動化できるが、接続のたびにクライアントが増える。誰でも登録できるため、なりすまし対策が弱い。MCP 仕様 2026-07-28 で非推奨(後方互換のため残っている) |
| **CIMD**(Client ID Metadata Document) | client_id そのものが HTTPS の URL になっている(例: `https://chatgpt.com/oauth/client.json`)。サーバーはその URL を取得して、クライアント名や redirect_uris を知る | 登録という手順がなく、サーバー側に状態が残らない。client_id のドメインでクライアントの身元が分かる。MCP 仕様 2026-07-28 で推奨 |

## クライアントごとの挙動

### Claude(claude.ai / Desktop / Cowork / Claude Code)

- 対応している MCP 認可仕様は 2025-03-26、2025-06-18、2025-11-25。Cowork は claude.ai のコネクタ設定をそのまま使う。
- クライアント登録の優先順位: 事前登録の client_id → CIMD → DCR。
  - CIMD を使うのは、認可サーバーのメタデータに `client_id_metadata_document_supported: true` があり、かつ `token_endpoint_auth_methods_supported` に `none` が含まれるときだけ。
- 保護リソースのメタデータ(RFC 9728)を見に行く。
  - 401 の `WWW-Authenticate: Bearer resource_metadata="..."` が起点になる。200 に付いた `WWW-Authenticate` は無視される。
  - `authorization_servers` は先頭の要素しか使わない。
- コールバック URL:
  - claude.ai / Desktop / Cowork: `https://claude.ai/api/mcp/auth_callback`(`https://claude.com/api/mcp/auth_callback` も許可しておくとよい)
  - Claude Code: ループバック。`http://localhost:<任意のポート>/callback`、`127.0.0.1` も同様
- PKCE は S256。`resource` パラメータ(RFC 8707)を認可リクエストとトークンリクエストの両方で送ってくる。
- 公開クライアントのリフレッシュトークンは、使うたびに作り直す(ローテーション)。失効したものには `invalid_grant` を返す。期限の 5 分前から先回りしてリフレッシュする。
- タイムアウト: メタデータ取得・登録・トークン発行は 10 秒、リフレッシュは 30 秒。
- 送信元 IP は `160.79.104.0/21`。WAF やボット対策でこの範囲をブロックしないこと。IPv4 の A レコードが必須。
- Team / Enterprise では Owner が組織全体にコネクタを追加し、メンバーはそれぞれ自分のアカウントで接続する(トークンはユーザー単位)。
- claude.ai / Cowork の CIMD の client_id URL は公開されていないが、実際の接続では `https://claude.ai/oauth/mcp-oauth-client-metadata` だった(2026-09-26 確認。Claude Code は `https://claude.ai/oauth/claude-code-client-metadata`)。変わる可能性があるので、特定の URL を決め打ちせず、仕様どおりに検証する。

出典: https://claude.com/docs/connectors/building/authentication 、 https://claude.com/docs/connectors/building/troubleshooting

### ChatGPT(開発者モードのコネクタ / Apps)

- 参照している MCP 認可仕様は 2025-11-25 と 2026-07-28。
- クライアント登録: 事前登録、CIMD(`https://chatgpt.com/oauth/client.json`、認証方式は `none` または `private_key_jwt`。ChatGPT のメタデータ文書は `private_key_jwt` を既定にしている)、DCR にフォールバック。
- メタデータは `/mcp` 付きのパス(例: `/.well-known/oauth-authorization-server/mcp`)を見に行く。ルートと両方に置く。
- コールバック URL:
  - `https://chatgpt.com/connector_platform_oauth_redirect`(RFC 9207 の `iss` を認可レスポンスに付ける場合に使われる)
  - `https://chatgpt.com/connector/oauth/{callback_id}`(それ以外の場合。アプリごとに異なる)
- PKCE は S256 が必須。`resource` パラメータを送ってくる。
- 更新系のツールは Business / Enterprise / Edu が前提。`readOnlyHint` が付いていないツールは、書き込み扱いになり実行前に確認が入る。
- ワークスペースエージェントはスケジュール実行があるので、リフレッシュが確実に動く必要がある。

出典: https://developers.openai.com/plugins/build/auth 、 https://developers.openai.com/api/docs/guides/developer-mode

## 採用しなかった案

| 案 | 採用しない理由 |
|---|---|
| Entra ID / Google を直接 MCP の認可サーバーにする | DCR も CIMD もない。Entra は MCP の URL をアプリケーション ID URI として登録する必要があり、所有を確認したドメインでないと通らない(AADSTS9010010)。Google はトークンの宛先を指定できない。クライアントごとに手作業の登録が要る |
| Cloudflare Access の Managed OAuth | DCR だけに対応しており、CIMD の記載がない。ユーザー単位の情報をトークンに紐付けられない。claude.ai Web 版で接続できなかった報告がある(anthropics/claude-ai-mcp #410, #992) |
| Auth0 / WorkOS / Stytch / Descope | 機能は十分。ただし顧客ごとにデプロイする OSS では、顧客ごとにそのサービスとの契約と設定が必要になる |

Cloudflare Access for SaaS を **上流の IdP として** 使う案(Access が Entra や Google を仲介し、認可サーバーは自前のまま)は有効なので、3 つ目のアダプタとして検討する。

## 認可サーバーの要件(実装チェックリスト)

### エンドポイントとメタデータ

- [ ] MCP エンドポイントは Streamable HTTP で提供する。別のホストへのリダイレクトはしない。カスタムドメインを使う。
- [ ] 未認証のリクエストには、MCP SDK に渡す前に 401 と `WWW-Authenticate: Bearer resource_metadata="<PRM URL>"` を返す(必要なら `scope` も付ける)。
- [ ] 保護リソースのメタデータ(RFC 9728)を `/.well-known/oauth-protected-resource` と `/.well-known/oauth-protected-resource/mcp` に置く。`resource` は MCP の URL と完全に一致させ、`authorization_servers` には 1 つだけ入れる。
- [ ] 認可サーバーのメタデータ(RFC 8414)をルートと `/mcp` 付きのパスに置く。`issuer` は `authorization_servers` の値と文字単位で一致させる。
  - `client_id_metadata_document_supported: true`
  - `token_endpoint_auth_methods_supported` に `none`(事前登録を許すなら `client_secret_post` / `client_secret_basic` も)
  - `code_challenge_methods_supported: ["S256"]`
  - `grant_types_supported: ["authorization_code", "refresh_token"]`
  - `scopes_supported` に `offline_access` を含める。`openid` / `email` / `profile` は、実際に UserInfo まで対応しない限り載せない(ChatGPT が要求してくるため)

### クライアント登録とリダイレクト

- [ ] CIMD を有効にする(`clientIdMetadataDocumentEnabled`、互換性フラグ `global_fetch_strictly_public` が必要)。DCR も後方互換のために残す。
- [ ] リダイレクト URI の許可リスト:
  - `https://claude.ai/api/mcp/auth_callback`
  - `https://claude.com/api/mcp/auth_callback`
  - `http://localhost/callback` と `http://127.0.0.1/callback`(ポートは問わない)
  - `https://chatgpt.com/connector_platform_oauth_redirect`
  - `https://chatgpt.com/connector/oauth/*`
- [ ] 可能なら RFC 9207 に対応する(成功時もエラー時も認可レスポンスに `iss` を付け、メタデータで `authorization_response_iss_parameter_supported: true` を宣言する)。

### トークン

- [ ] PKCE S256 を必須にする。
- [ ] `resource` を受け取り、トークンの宛先を MCP の URL(正規化したもの)に固定する。リクエストのたびに検証する。
- [ ] アクセストークンの有効期限は短くし、`expires_in` を正しく返す。リフレッシュトークンはローテーションし、失効したものには `invalid_grant` を返す。
- [ ] `/token` は form-urlencoded を受け付け、10 秒以内に応答する。

### ツール(ChatGPT 向け)

- [ ] すべてのツールに `readOnlyHint` / `destructiveHint` / `openWorldHint` を付ける。
- [ ] ツールごとに `securitySchemes` を宣言し、認証エラーのときは `_meta["mcp/www_authenticate"]` を返す。

## 上流 IdP のログイン

- workers-oauth-provider v1.1 の補助関数を使う。同意画面は `beginConsent` / `approveConsent`、上流 IdP への往復は `beginUpstream` / `finishUpstream`。
  - `cloudflare/ai` のデモは古い(v0.8 系で、同意や state の処理を自前で書いている)ので参考にしない。
- 上流は OIDC の認可コードフローに PKCE を付けて使う。ID トークンは `jose` で検証する。

| | Entra ID | Google Workspace |
|---|---|---|
| ログインできる人の制限 | シングルテナントのアプリ登録。authority は `https://login.microsoftonline.com/{tenantId}/v2.0`(`common` や `organizations` は使わない)。ID トークンの `iss` / `tid` を許可リストで照合する。必要に応じて「割り当てが必要」を有効にするか、groups / roles のクレームを見る | ID トークンの `hd` と `email_verified` をサーバー側で検証する(認可 URL に付ける `hd=` は画面のヒントにすぎない)。OAuth 同意画面は Internal にする |
| ユーザー ID | `tid` + `oid`(`sub` はアプリごとに変わる。email / UPN は変わりうる) | `sub` |

- `completeAuthorization` に渡す userId は `entra_<tid>_<oid>` / `google_<sub>` の形にする。ライブラリがトークンの中で `:` を区切り文字に使うので、userId に `:` を含めてはいけない。`props` には最小限のクレームだけ入れる。
- 連携先ごとの認証情報(freee、Graph など)は、この userId をキーにして別のストア(D1 または KV、暗号化)に保存する。登録は連携先ごとの接続フローで行う。これは別途設計する。

## 既知のリスクと未確認事項

- workers-oauth-provider の既知の問題:
  - #214: 同時にリフレッシュが来ると KV 上で競合する。必要なら Durable Object で直列化する。
  - #43: ひとつ前のリフレッシュトークンも使えてしまう。
  - #264: CIMD クライアントの `private_key_jwt` に未対応。そのため ChatGPT は DCR で登録してくる見込み。
  - #278: JWT のアクセストークンに未対応(不透明トークンのみ)。
- ChatGPT のワークスペースエージェントがスケジュール実行時にユーザーのトークンをどう扱うかは、資料がない。実機で検証する。
- Entra が CIMD や ID-JAG(Enterprise-Managed Authorization)に対応したら見直す。workers-oauth-provider には ID-JAG の実験的な対応がすでにある。

## 参考

- MCP 認可仕様 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- workers-oauth-provider: https://github.com/cloudflare/workers-oauth-provider (上流 IdP へのログイン委譲: `docs/upstream-sign-in.md`)
- Cloudflare MCP authorization: https://developers.cloudflare.com/agents/model-context-protocol/authorization/
- Access for SaaS MCP: https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/saas-mcp/
- Entra と MCP の現状: https://techcommunity.microsoft.com/blog/appsonazureblog/mcp-enterprise-authorization-is-here-%E2%80%94-what-entra-and-app-service-can-do-today/4537433
