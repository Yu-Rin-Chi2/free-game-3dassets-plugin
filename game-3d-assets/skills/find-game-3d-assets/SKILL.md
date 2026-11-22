---
name: find-game-3d-assets
description: Use when the user wants free 3D game assets — 3D models (GLB / FBX), PBR materials / textures, decals, MatCaps, or skyboxes — found, saved into their project, and wired into a game or scene (Unity, Unreal, Godot, three.js). Triggers on requests like "I need a street lamp 3D model", "a wood PBR texture", "a sunset skybox", "build a small 3D scene / game with free assets", "街灯の3Dモデルがほしい", "木目のPBRテクスチャ", "夕焼けのスカイボックス", "3Dゲームの素材をそろえて配置して". Explains how the assets are structured (units, color spaces, normal maps, ORM, tiling, decals, skybox). All assets are CC0 (commercial use OK, no attribution required).
allowed-tools: Bash(npx -y freegame3d@1:*)
---

# Find Game 3D Assets

Search the Free Game 3D Assets library (3D models, PBR materials, decals, MatCaps, skyboxes) for assets matching the user's request and save them into their project. **All assets are CC0 1.0** (public domain — commercial use allowed, no attribution required, free to modify).

Use the `freegame3d` CLI (npm, zero dependencies, Node.js 18.18+). Always run it via `npx -y freegame3d@1` and pass `--json` so the output is machine-readable:

| Command | Purpose |
|---------|---------|
| `npx -y freegame3d@1 search [query] --kind <k> --category <c> --subcategory <s> --tag <ns:value> --limit <n> --json` | Search assets (primary command) |
| `npx -y freegame3d@1 get <kind>/<slug> --json` | Details, **file sizes**, and what each `--format` would download |
| `npx -y freegame3d@1 taxonomy [--kind <k>] --json` | List categories and tags that exist (to discover search axes) |
| `npx -y freegame3d@1 download <kind>/<slug>... --out <dir> [--format <f>] [--force] --json` | Save files into the project |

Assets are identified by `<kind>/<slug>` (the `id` in search results), e.g. `model/anime-axe-kit`.
Exit codes: `0` ok / `1` no results or not found / `2` usage error / `3` network, API or checksum error.

## Kinds and formats

| Kind | What it is | `--format` (first = default) |
|------|------------|------------------------------|
| `model` | 3D model | `glb` (single file) · `fbx` (FBX package, zip, for game engines) · `both` · `all` |
| `material` | PBR material (2048² PNG maps: basecolor / roughness / metallic / normal / ao) | `maps` · `engine` (Unity-ready pack, zip) · `both` · `all` |
| `decal` | RGBA PNG decal | `image` |
| `matcap` | 1024² PNG MatCap | `image` |
| `skybox` | 4096×2048 equirectangular PNG (LDR) | `image` · `engine` (Unity pack, zip) · `both` · `all` |

## Facts you must know before using the assets

Read [references/asset-structure.md](references/asset-structure.md) for the full structure of each kind. The essentials:

- **Units**: 1 unit = 1 meter. `meta.size_m` / `meta.stats.size_m` are real-world meters — use them to scale and tile.
- **Color space**: assume a Linear project. Only BaseColor, decals, MatCaps and skyboxes are **sRGB**; Normal / Roughness / Metallic / AO / ORM are **linear** (sRGB off).
- **Normal maps are documented as OpenGL (+Y)** — correct for Unity, Godot, three.js; Unreal needs the green channel flipped. Some flat materials intentionally have **no normal map** (treat as flat).
  **Data note (2026-11-22): a batch of materials had been published with the green channel inverted (DirectX-style) despite the `OpenGL (+Y)` label. The cause was found and the materials were fixed and re-published the same day, and new ones are now checked before approval — but a few may still be stale or undecided.** If a material's grooves/joints look raised under a low raking light, its green is inverted: flip green for three.js/Unity/Godot, and **do not** flip for Unreal. Verify by eye — see "Verify the normal map" in [references/asset-structure.md](references/asset-structure.md).
- **ORM** (in `engine` packs and FBX packages): **R = AO, G = Roughness, B = Metallic** (glTF layout). Unity Smoothness = `1 − G`.
- **Materials are seamless 2048² tiles**: one tile = `meta.size_m` meters → repeat `1 / size_m` per meter.
- **Models**: **GLB = textures embedded, materials ready** (use it unless the user wants FBX). FBX packages need materials rebuilt from their manifest and have import rules (no extra rotation, Generate Lightmap UVs off, LOD0 only). Pivot = center of the ground-contact face.
- **Decals** are straight-alpha RGBA PNGs meant to be **projected** onto surfaces; `meta.size_m` is the real-world footprint.
- **Skyboxes** are 4096×2048 equirectangular **LDR** — they do not light the scene; add a real directional light (aim it at `meta.sun_azimuth_deg` if given). Unity: mipmaps OFF.
- **MatCaps** shade by view-space normal (no UVs, no lights).
- Do not resize or recompress the downloaded PNG/GLB; let the engine compress on import.

Engine-specific recipes (three.js, Unity, Unreal, Godot): [references/engine-integration.md](references/engine-integration.md).

## Workflow

### 1. Turn the request into a search

Split the request into **kind + subject noun + category**. This is the most important step.

- `query` … the subject noun only (e.g. `axe`, `streetlight`, `wood`, `sunset`)
- `--kind` … `model` / `material` / `decal` / `matcap` / `skybox`
- `--category` / `--subcategory` / `--tag` … optional; copy values from `taxonomy` (categories and model tags are **Japanese**, e.g. `--tag object:街灯`)

**Do NOT put kind words (`model`, `texture`, `skybox`) into `query`.** `query` is an AND match over names, categories and tags, so extra words easily return zero results.

Names and tags exist in both English and Japanese. If an English noun finds nothing, retry with the Japanese word (or a synonym / broader term), and vice versa. Run `taxonomy --kind <k> --json` when the category or tag is unclear.

| User request | Command |
|--------------|---------|
| "an axe 3D model" / "斧の3Dモデル" | `npx -y freegame3d@1 search axe --kind model --json` |
| "a wood PBR texture" | `npx -y freegame3d@1 search wood --kind material --json` |
| "a sunset skybox" | `npx -y freegame3d@1 search sunset --kind skybox --json` |
| "weapon models for a dungeon" | `npx -y freegame3d@1 search --kind model --tag scene:ダンジョン --json` |

### 2. Present candidates and check size

Show the candidates concisely (`id`, `name`, `name_ja`, `category`, `thumb_url`, and `page_url` so the user can look at them in the browser) and confirm which to save. If there are zero results (exit code 1), loosen the query as described above.

Before downloading, run `get <id> --json` for the chosen asset and look at `formats.options.<format>.bytes`. **If the download is large (roughly > 50 MB), tell the user the size and confirm.** Models can reach hundreds of MB; a full material is typically tens of MB. `meta` also has useful details (triangle count, size in meters, texture resolution, normal map convention such as `OpenGL (+Y)`, ORM layout).

### 3. Choose the format

- **model**: `glb` by default (one file, no unzipping). If the user's engine uses FBX (Unity, Unreal, most DCC workflows) or they ask for FBX, use `--format fbx`.
- **material**: `maps` by default (individual PNG maps — some materials have no normal or ao map; the CLI reports this under `warnings`). Use `--format engine` if they want the Unity-ready material pack.
- **skybox**: `image` for the PNG, `engine` for the Unity pack.
- If the engine is unknown and it matters (FBX vs GLB, engine pack), ask.

### 4. Save

Confirm the destination with the user (if unspecified, suggest a sensible location such as `Assets/`, `assets/` or `public/`), then save with one command — the CLI writes the files itself and verifies each file's sha256, so do not fetch or write the files yourself:

```bash
npx -y freegame3d@1 download model/anime-axe-kit material/bark-redwood-fibrous-thick-fissured-cinnamon --out assets/3d --json
```

- Files land in `<out>/<slug>/<file name>`.
- Existing files are **not overwritten** (reported under `skipped`). Only add `--force` after the user confirms overwriting.
- **zip files are not extracted.** Extract them yourself in place if the user wants the contents: `unzip -o <file> -d <dir>` (macOS/Linux), `tar -xf <file> -C <dir>` (Windows 10+ / macOS / Linux), or `Expand-Archive -Path <file> -DestinationPath <dir>` (PowerShell).
- Report the saved paths from the `saved` array, and any `skipped` / `warnings` / `errors` entries. On exit code `3`, the API or network may be temporarily unavailable — retry shortly.

### 5. Mention the license

All assets are **CC0 1.0**, so no attribution is required — but after saving, briefly tell the user "these assets are CC0 (commercial use OK, no attribution needed)." There is no credit obligation.

## Building a 3D game or scene with these assets

When the user wants a game, level or scene (not just one asset), work in this order. Do not guess the structure of the assets — use the facts above and `get --json` → `meta`.

1. **Clarify the target**: engine (Unity / Unreal / Godot / three.js / Babylon…), art style (anime or realistic), and the scene's contents. If the project already has an engine, detect it (`ProjectSettings/`, `*.uproject`, `project.godot`, `package.json` with `three`) instead of asking.
2. **List what is needed** as roles: ground / wall / roof materials, props and buildings (models), surface wear (decals), a sky (skybox). Then search each. Check `taxonomy` first — the library is still growing, so some things will not exist. **If something is missing, say so and use a placeholder or a plain color; never invent an asset id.**
3. **Choose consistently**: pick the same style across assets (skybox `style:anime` vs `realistic`; MatCap for stylized looks). Prefer GLB for models. Confirm total size with the user before a large batch (use `get` → `formats`).
4. **Download into one folder per project**, e.g. `assets/3d/<slug>/` (Unity: `Assets/ThirdParty/FreeGame3D/<slug>/`, Unreal/Godot: under the project's content folder). Extract zips if the engine needs the contents.
5. **Wire them in**, following [references/engine-integration.md](references/engine-integration.md): import settings first (sRGB on/off, normal map type, mipmaps), then materials (tile by `1 / size_m`), models (scale-check with `meta.stats.size_m`), skybox + a real directional light, decals projected onto surfaces.
6. **Record what was used**: keep a short list of the asset ids (e.g. in `assets/3d/ASSETS.md`: `id`, `name`, `page_url`) so the set can be re-fetched or swapped later. No attribution is required (CC0), but the list keeps the scene reproducible.
7. **Verify visually** if the engine can be run or screenshotted: textures not washed out or too dark (color-space mistakes), no seam line in the sky, tile size looks right, and **normal maps are not inverted** (joints and grooves must look recessed under a low raking light — if they look raised, flip green; see the known data issue above).

## Fallback (when Node.js / npx is unavailable)

Call the public REST API directly (no auth, CC0):

```bash
# search (kind: model | material | decal | matcap | skybox)
curl -s "https://3d-api.freegameui.net/v1/assets?q=axe&kind=model&limit=10"
# details — each file has role / filename / size / sha256 / downloadable / download_url
curl -s "https://3d-api.freegameui.net/v1/assets/model/anime-axe-kit"
# save a file: use the download_url from the details (never build file URLs yourself)
curl -s -L -o anime-axe-kit.glb "<download_url of the glb file>"
```

Only files with `downloadable: true` have a `download_url`; thumbnails and previews do not.
