# Murmur

AI ネイティブ タスク管理ツールのプロトタイプ。イベントソーシングによるタスク導出、通信状態と作業状態の二層、
リスト境界と派生シグナル、観測された送信、スタンドへの MCP ハンドオフが成立するかを、外部接続なしで確かめる。

- 計画: [docs/PLAN.md](docs/PLAN.md)（実装の順序と仮説 H1〜H7）
- 開発の約束事と構成: [CLAUDE.md](CLAUDE.md)
- 決定の記録: [docs/adr/](docs/adr/)
- 接続手順: [docs/stand/connect.md](docs/stand/connect.md)（スタンド用スキルは nvt-api-gateway-skills に移設）
- シナリオ: [fixtures/](fixtures/)

```sh
pnpm install
pnpm test
pnpm scenario verify all
```
