# Murmur

チームの仕事の記憶。連絡から対応の要る件を拾い、誰の番かを追う。API ゲートウェイの Worker の機能として動き
（`docs/adr/0023`）、スタンド（Claude）が裏で読んで「いまやるべきこと」に答える。

- 計画: [docs/PLAN.md](docs/PLAN.md)（実装の順序と仮説 H1〜H7）
- 開発の約束事と構成: [CLAUDE.md](CLAUDE.md)
- 決定の記録: [docs/adr/](docs/adr/)
- 有効にする手順と接続: [docs/stand/connect.md](docs/stand/connect.md)（スタンド用スキルは同じリポジトリのプラグイン `api-gateway-murmur`、`../plugins/api-gateway-murmur`）
- シナリオ: [fixtures/](fixtures/)

```sh
npm install
npm test
npm run scenario verify all
```
