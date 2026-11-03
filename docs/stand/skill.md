# スタンド用スキル（移設済み）

スタンド（Cowork / Claude Code）用の `murmur` スキルは、API ゲートウェイに同梱している:
[novshi-tech/api-gateway-mcp](https://github.com/novshi-tech/api-gateway-mcp) の
`plugins/api-gateway-murmur/skills/murmur/SKILL.md`（プラグイン `api-gateway-murmur`。2026-11-03 から。
それまでは novshi-tech/nvt-api-gateway-skills のプラグイン `nvt-api-gateway` 0.2.0〜0.7.0 に入っていた）。

ゲートウェイはプラグインを Worker に組み込んで「Claude につなぐ」(`/setup`)で配り、マーケットプレイス `novshi-tech/api-gateway-mcp` にも並べる。
下書きは置かない（以前の `docs/stand/skill-murmur.md` は消した）。

本体の HTTP API（`src/http/app.ts`、入力は `src/api/schemas.ts`）を変えたら、そちらの SKILL.md の API の表と手順も更新し、
`plugin.json` とマーケットプレイスの `version` を上げる。
