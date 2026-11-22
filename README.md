# Free Game 3D Assets — Agent Skill & CLI

Just ask your AI for "a street lamp 3D model" or "a wood PBR texture" and it searches **[Free Game 3D Assets](https://3d.freegameui.net)** (3D models, PBR materials, decals, MatCaps and skyboxes), then saves the best match straight into your project. Works with Claude Code, Codex, Cursor, Gemini CLI and other agents.

- **All assets are CC0 1.0** — commercial use allowed, no attribution required, free to modify
- **CLI** — [`freegame3d`](https://www.npmjs.com/package/freegame3d) on npm. Zero dependencies, runs via `npx` (Node.js 18.18+). Every downloaded file is verified against its sha256
- **Skill** — built-in search strategy (kind → `--kind`, subject noun → query, format by engine) that drives the CLI, so you reliably land the asset you want

## Setup

### Easiest: paste this prompt into your AI agent

```
Set up "Free Game 3D Assets" (a CC0 library of 3D models, PBR materials, decals, MatCaps and skyboxes) so it can be used in this project.

1. Check that Node.js 18.18+ is available.
2. Install the skill that finds and saves assets with:
   npx skills add Yu-Rin-Chi2/free-game-3dassets-plugin -y
3. Check that `npx -y freegame3d@1 --version` works.
4. When done, tell me whether a restart is needed to activate it, and give me an example prompt to try (e.g. "Save a wood PBR texture to assets/textures/").
```

### Or run it yourself

```bash
npx skills add Yu-Rin-Chi2/free-game-3dassets-plugin
```

This uses the [Skills CLI](https://skills.sh) and installs the skill into your project for every supported agent (add `-g` to install it for all projects).

Alternatives:

- **Claude Code plugin**: `claude plugin marketplace add Yu-Rin-Chi2/free-game-3dassets-plugin` then `claude plugin install game-3d-assets@free-game-3d-assets`
- **Manual**: copy the whole [game-3d-assets/skills/find-game-3d-assets/](game-3d-assets/skills/find-game-3d-assets/) folder (`SKILL.md` plus `references/`) into your agent's skills folder. If you only have an instructions file (e.g. `AGENTS.md`), paste `SKILL.md` and keep `references/` next to it

## Usage

Just ask your agent:

```
I need a street lamp 3D model. Save it to Assets/Models/ as FBX.
Find a wood PBR texture and put it in assets/textures/.
Add a sunset skybox to the project.
斧の3Dモデルを探して assets/ に保存して。
```

The skill triggers automatically and walks through search → candidates (with size check) → save. It also knows how the assets are built (units, color spaces, OpenGL normal maps, ORM packing, tiling size, projected decals, LDR skyboxes), so you can ask it to go further and assemble a scene:

```
Build a small three.js scene: a cobblestone ground, a few street lamps, a sunset sky.
Unity プロジェクトに、アスファルトの地面と道路のひび割れデカール、昼のスカイボックスを入れて。
```

## Use the CLI directly

```bash
npx freegame3d search axe --kind model
npx freegame3d search wood --kind material
npx freegame3d get model/anime-axe-kit
npx freegame3d download model/anime-axe-kit --out assets/3d              # GLB
npx freegame3d download model/anime-axe-kit --out assets/3d --format fbx # FBX package (zip)
npx freegame3d taxonomy --kind model
```

See [cli/README.md](cli/README.md) for all commands and options.

## What's included

| Type | Name | Contents |
|------|------|----------|
| CLI | [`freegame3d`](cli/) | `search` / `get` / `taxonomy` / `download` (`--json` for agents) |
| Skill | [`find-game-3d-assets`](game-3d-assets/skills/find-game-3d-assets/SKILL.md) | Search-and-save workflow for 3D game assets |

## License

- **Assets**: CC0 1.0 Universal (public domain). Free to use, modify, and redistribute for any purpose, commercial or not.
- **This skill / CLI**: [LICENSE](LICENSE) (CC0 1.0)
