# 0005 Murmur をゲートウェイの機能として持つ

- 状態: 採用(2026-11-04、直樹とのディスカッション)。段取り 1(リポジトリをまとめる)と 2(口と依存の削減)を実装した
- 関連: Murmur の [`murmur/docs/adr/0023`](../../murmur/docs/adr/0023-murmur-as-gateway-feature.md)(本体の決定。理由・脅威の整理・段取りはそちら)、[0004](0004-one-deployment-per-organization.md)(1 つのデプロイ = 1 つの組織)、[background-access.md](../background-access.md)

## 決定

Murmur(チームの仕事の記憶)を、ゲートウェイの機能にする。1 つのリポジトリ、1 つの Worker、1 つのデプロイ。詳細は Murmur の 0023 に書いた。ゲートウェイの側から見た要点だけをここに置く。

1. **ゲートウェイは Murmur なしでも動く。** Murmur は機能として無効にでき、無効なら今のゲートウェイと同じ。デプロイの設定に Murmur の束縛(D1・キュー)がなければ無効
2. **コードの境界は vertical slice。** ゲートウェイの中核と Murmur は互いの実装を import しない。env を受け取るのは Worker の入口だけで、Murmur には Murmur の束縛と秘密だけを渡す。ゲートウェイは Murmur にトークンや鍵を渡さず、「この人の接続で、この口を読む」能力(関数)だけを渡す。Murmur は実行時の依存を足さない
3. **MCP のツールは `list_credentials` と `issue_token` の 2 つのまま。** Murmur の API は REST で、`issue_token` で発行した短命のトークンで認可する。使い方はプラグイン `api-gateway-murmur` のスキル
4. **デプロイのドメインは変えない。** 各デプロイの `PUBLIC_URL` の下に Murmur の API・Webhook・画面が入る。利用者のコネクタの URL と、上流の OAuth のアプリのコールバックはそのまま
5. **プラグイン名(`api-gateway-*`)は変えない。** 変えると利用者が入れ直すことになる。製品の総称(「○○ Gateway」)の単語は保留

## 段取り(Murmur の 0023 の「移し方」)

1. **リポジトリをまとめる**(済み、2026-11-04): Murmur を `murmur/` に `git subtree` で取り込んだ(履歴つき)。`murmur/` は別のパッケージ(npm。pnpm から移した)で、ルートのテストからは外し、CI では別のジョブで回す。Worker はまだ 2 つで、動きは変えていない。ADR の番号は、ゲートウェイは `docs/adr/`、Murmur は `murmur/docs/adr/` で別々に振る
2. **中核の口を作る**(済み、2026-11-04): Murmur の側で、ゲートウェイを呼ぶところを口(`murmur/src/ports/gateway.ts`)の後ろにまとめた。読める口の許可リストは口の実装が強制する。実行時の依存は `zod` と `drizzle-orm` だけにした(`@anthropic-ai/sdk`・`hono` を外した)。段取り 3 では、ゲートウェイの中核がこの口を実装する
3. **1 つの Worker にする**: 入口で Murmur をつなぎ、口の実装を中核の直接呼び出しに差し替える。Murmur の有効化と本人の同意の画面を作る。このとき、`identity` の Murmur 向けの使い道・Service Binding・Murmur の CIMD がなくなる(`identity` は boid の逆接続のため残る。[0003](0003-reverse-connection.md))
4. **既存のデプロイを移す**: Murmur のデプロイの設定(murmur-deployments)を、ゲートウェイの設定(`deployments/<名前>.jsonc`)にまとめる
