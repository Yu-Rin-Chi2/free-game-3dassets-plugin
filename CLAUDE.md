# free-game-3dassets-plugin

Free Game 3D Assets（`https://3d.freegameui.net`）のアセットを、AI が検索・保存するための **CLI（npm `freegame3d`）と Skill** を配布する公開リポジトリ。Claude Code のプラグイン兼マーケットプレイスでもある。UI 版の `free-game-ui-assets-plugin`（`freegameui`）と同じ仕組み。

サービス本体（API・D1・R2・サイト）は **別のリポジトリ**（非公開）にある。**CLI が依存する API の契約は、サービス側の `docs/ai-cli.md` が原本**（保守者が管理する）。このリポジトリは API を変更しない。

## 構成

```
.claude-plugin/marketplace.json     マーケットプレイス（free-game-3d-assets）
game-3d-assets/                     プラグイン（Skill 1 つ: find-game-3d-assets）
cli/                                npm パッケージ freegame3d（TypeScript、実行時の依存ゼロ）
.github/workflows/cli.yml           Node 18/22 でテスト。cli-v* タグで provenance 付き npm 公開
```

## コマンド

```bash
cd cli
npm ci
npm test            # tsc → node --test（ローカルのモックサーバに対するテスト。本番には触れない）
npm run build
node dist/index.js search axe --kind model          # 本番 API に対する手動確認（読み取りのみ）
FREEGAME3D_API=http://127.0.0.1:8787 node dist/index.js ...   # ローカルの wrangler dev に向ける
```

## 守ること

- **実行時の依存を足さない**（`npx` の起動を速く、供給網のリスクを小さくするため）。`devDependencies` は TypeScript と `@types/node` のみ。
- **ファイルの URL を自分で組み立てない**。詳細 API の `files[]` のうち `downloadable` かつ `download_url` があるものだけを使う。人が見るページ（`page_url`）だけは `https://3d.freegameui.net/<models|materials|decals|matcaps|skyboxes>/<slug>` で作る。
- **未知のフィールドは無視する**。API に項目が増えても壊れないように、読むのは `docs/ai-cli.md` に載せたフィールドだけ。
- ダウンロードは **ストリームで `.part` に書き、サイズと sha256 を確かめてから rename** する。既存ファイルは `--force` がなければ上書きしない。API が返す `filename` は **ファイル名だけ**を許し、パス区切りや `..` は拒否する。
- 複数アセットは直列で取る（`/files` は IP ごとに 600 回/60 秒）。429 は `Retry-After` に従う。
- **後方互換**: Skill は `npx -y freegame3d@1` にメジャーを固定している。`--json` の形、終了コード、`--format` の名前を変えるのは **メジャーを上げるとき**だけ。上げたら Skill の `@1` も同時に更新する。
- **Skill の `references/` と「Facts」は、アセットの規格の写し**。原本は、サービス側（非公開）の `docs/ai-cli.md`（どの原本から写したかの表がある）。規格（`meta` のキー、ORM の並び、法線の規約、素材の実寸、Skybox の規格、`--format`）が変わったら一緒に直す。書くのは配布物の規格だけで、生成元の内部実装・パス・プロンプトは書かない。エンジン別の手順は一般的な規約なので、断定しすぎず、版で変わりうるものはそう書く。
- テストの本番へのアクセスは **読み取りのみ**。D1 / R2 を変える操作はこのリポジトリにはない。

## リリース

1. `cli/package.json` の `version` を上げる（Skill や plugin.json に影響する変更なら `game-3d-assets/.claude-plugin/plugin.json` と `.claude-plugin/marketplace.json` の `version` も）。
2. `main` に入れてから `git tag cli-vX.Y.Z && git push origin cli-vX.Y.Z`。GitHub Actions がテスト後に `npm publish --provenance` する（リポジトリの Secret `NPM_TOKEN` が必要）。
3. 公開後に `npx -y freegame3d@<メジャー> --version` を確かめる。
