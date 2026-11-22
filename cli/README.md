# freegame3d

Search and download **CC0 3D game assets** — 3D models (GLB / FBX), PBR materials, decals, MatCaps and skyboxes — from [Free Game 3D Assets](https://3d.freegameui.net), straight from your terminal or AI agent.

- **All assets are CC0 1.0** — commercial use OK, no attribution required
- **Zero dependencies**, Node.js 18.18+
- **Agent-friendly** — `--json` output and stable exit codes
- **Safe downloads** — streamed to disk, verified against the sha256 the API declares, never overwrites existing files

## Quick start

```bash
# search: subject noun + --kind (English or Japanese)
npx freegame3d search axe --kind model
npx freegame3d search 街灯 --kind model
npx freegame3d search wood --kind material

# details, file sizes and what each --format downloads
npx freegame3d get model/anime-axe-kit

# save into your project → <out>/<slug>/<file>
npx freegame3d download model/anime-axe-kit --out assets/3d
npx freegame3d download model/anime-axe-kit --out assets/3d --format fbx
npx freegame3d download material/board-cork-pinup --out assets/textures

# discover categories and tags (categories and model tags are Japanese)
npx freegame3d taxonomy --kind model
```

## Commands

| Command | Description |
|---------|-------------|
| `search [query] [--kind] [--category] [--subcategory] [--tag ns:value]… [--sort name\|updated] [--limit] [--page]` | Search assets (limit 1-50, default 12) |
| `get <kind>/<slug>` | Details, downloadable files with sizes, and what each `--format` would fetch |
| `taxonomy [--kind]` | Categories and tags with counts |
| `download <kind>/<slug>... [--out] [--format] [--force]` | Save files; existing files are skipped unless `--force` |

Assets are identified by `<kind>/<slug>` — the `id` in search results.

| Kind | `--format` (first = default) |
|------|------------------------------|
| `model` | `glb` · `fbx` (FBX package, zip) · `both` · `all` |
| `material` | `maps` (basecolor / roughness / metallic / normal / ao PNG) · `engine` (Unity pack, zip) · `both` · `all` |
| `decal`, `matcap` | `image` · `all` |
| `skybox` | `image` (4096×2048 PNG) · `engine` (Unity pack, zip) · `both` · `all` |

- zip files are **not** extracted — use `unzip`, `tar -xf` or `Expand-Archive`.
- `--json`: machine-readable output
- `--api <url>` or `FREEGAME3D_API`: override the API base (default `https://3d-api.freegameui.net`)

**Search tip:** put only the subject noun in the query and the kind in `--kind`. The query is an AND match over names, categories and tags, so extra words easily return nothing. If English finds nothing, try the Japanese word.

Exit codes: `0` ok / `1` no results or not found / `2` usage error / `3` network, API or checksum error.

## Use with AI agents

Install the skill that drives this CLI (Claude Code, Codex, Cursor, Gemini CLI and more):

```bash
npx skills add Yu-Rin-Chi2/free-game-3dassets-plugin
```

See the [repository README](https://github.com/Yu-Rin-Chi2/free-game-3dassets-plugin#setup) for a copy-paste setup prompt and other install options.

## License

CC0 1.0 Universal — both the assets and this CLI.
