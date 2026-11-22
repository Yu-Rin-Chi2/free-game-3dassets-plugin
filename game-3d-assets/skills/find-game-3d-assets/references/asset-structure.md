# Asset structure reference

What is inside each kind of asset and how it is meant to be used. Read this before wiring downloaded assets into a game or scene.
Always prefer the values from `get <id> --json` → `meta` over the defaults written here: `meta` describes the actual asset.

## Conventions shared by every kind

| Topic | Rule |
|-------|------|
| Units | 1 unit = 1 meter. Sizes in `meta` (`size_m`, `stats.size_m`) are real-world meters |
| Color space | Project is assumed **Linear**. Color textures (BaseColor, decal, MatCap, skybox) are **sRGB**. Data textures (Normal, Roughness, Metallic, AO, ORM) are **linear / "Non-Color"** — turn sRGB off when importing them |
| Normal maps | **Documented as OpenGL (+Y, "green up")**: correct as-is for Unity, Godot, three.js, Blender; **Unreal expects DirectX (−Y): flip the green channel** (Unreal's texture import has a "Flip Green Channel" option). **But some materials actually ship inverted — see "Verify the normal map" below** |
| Original quality | Textures are kept at original resolution (not pre-shrunk). Let the engine compress / limit size on import (e.g. a Max Size setting) instead of resizing files yourself |
| Previews | `thumb` / `*_preview` / `poster` files are for browsing only. They are never downloaded |

## model

Formats: `glb` (default) and `fbx` (an `…_fbx.zip` package).

### GLB — easiest to use
- One file, **textures embedded**, standard glTF metallic-roughness PBR materials already assigned. Y-up, meters.
- Use it by default, especially for web engines (three.js, Babylon.js), Godot, and anything that reads glTF. If a game needs "just show the model correctly", use GLB.
- Textures keep full resolution (some use 4096). File size can be large (limit 300 MiB) — check `get` first, and let the engine compress textures.
- Unity needs a glTF importer package (e.g. glTFast); Unreal needs a glTF importer plugin. Both import FBX natively.

### FBX package (zip) — for game engines
```
<asset>_fbx.zip
├─ <model>.fbx                   one per piece (a "kit" has several pieces: meta.fbx_piece_count)
├─ Textures/T_<key>_<type>.png   everything the materials read
├─ Previews/…png                 preview images only — NOT textures
└─ <asset>.manifest.json         the source of truth for materials
```
- **Build materials from the manifest, not from the FBX.** FBX only references some textures. Match manifest `materials[].name` to the FBX material slot name (`M_<model>[-<variant>]`).
- Axis conversion is already baked in (Y-up, meters). **Do not add rotation fixes.** Unity: Convert Units on, Scale Factor 1.
- Pivot (FBX origin) = center of the piece's ground-contact face (wall pieces: the wall face). Pieces are meant to be snapped together.
- LOD0 only — generate LODs in the engine.
- Import settings (Unity): Normals = Import, Tangents = Calculate Mikktspace, **Generate Lightmap UVs = OFF** (it would overwrite UV1, which holds per-object grime), Read/Write off.
- Mesh structure: the root node holds the merged opaque/cutout geometry. **Emissive parts** (lamps, displays) and **transparent parts** (glass) are separate child nodes so they can be toggled / sorted. **Movable parts** (doors, flaps, drawers) are separate children whose origin sits on the hinge; the manifest's `articulation` describes the motion (in Blender coordinates — convert axes before use).
- Texture types (`Textures/T_<key>_<type>.png`):

| type | Content | Color space | UV |
|------|---------|-------------|----|
| `BaseColor` | albedo (alpha for cutouts) | sRGB | 0 |
| `Normal` | tangent-space normal, OpenGL +Y. **Present only if the surface has real relief** — no Normal means flat | linear | 0 |
| `ORM` | **R = AO, G = Roughness, B = Metallic** (same layout as glTF). Unity Smoothness = `1 − G` | linear | 0 |
| `UniqueGrime` | per-object dirt, **multiply onto BaseColor** (white = clean) | sRGB | 1 |
| `UniqueAO` | per-object AO | linear | 1 |
| `Emission` | emissive color | sRGB | 0 |
| `MatCap` | MatCap image for stylized pieces | sRGB | view-space |

- Building pieces use shared **tiling** textures plus a `tint` color in the manifest, layered with a per-object grime map on UV1. Standard Lit / Standard shaders cannot reproduce that exactly. For a quick, correct look use the GLB; use the FBX package when you are building a manifest-driven importer or custom shader.
- Texture density: props ≈ 512 px/m, building unique layers ≈ 64–128 px/m.
- Linear color space: manifest colors (`tint`, `factors`) are linear values.

### API `meta` for models
`stats` { `triangles`, `vertices`, `meshes`, `materials`, `textures`, `max_texture_size`, `size_m` [x, y, z] }, `fbx_piece_count`, `glb_size`. Use `size_m` to scale-check the model against the scene (a door ≈ 2 m tall, a lamp post ≈ 4–5 m).

Verified on real GLBs (three.js, 2026-11-22): the loaded bounding-box size matches `stats.size_m` exactly, the **lowest point of the GLB is at y = 0 (origin at the base)** and it is roughly centered in X/Z, so placing it at the ground height needs no offset. A "kit" GLB (e.g. `anime-axe-kit`, `fbx_piece_count` 4) contains all of its pieces laid out side by side in one file (the weapon kits show 4 weapons in a row).

## material (tiling PBR surface)

- **Seamless tile**, 2048×2048, 8-bit PNG. One tile covers `meta.size_m` = [width, height] meters. UV 0–1 = one tile, so the repeat count per meter is `1 / size_m`. If `size_m` is absent assume 4 m (2048 px at 512 px/m).
- `--format maps` (default) — separate PNGs:

| role | Content | Color space |
|------|---------|-------------|
| `map_basecolor` | albedo | sRGB |
| `map_roughness` | roughness | linear |
| `map_metallic` | metalness | linear |
| `map_normal` | OpenGL +Y normal. **Optional** | linear |
| `map_ao` | ambient occlusion. **Optional** | linear |

  Flat surfaces (painted metal, plaster, slate…) intentionally ship **without** a normal map — a flat normal would only cost memory. Treat a missing normal as flat. The CLI reports the absence under `warnings`.
- `--format engine` — zip for game engines, containing `<id>/<id>.manifest.json`, `Textures/T_<id>_BaseColor.png`, `T_<id>_ORM.png` (**R = AO (white for tiles), G = Roughness, B = Metallic**, linear), optional `T_<id>_Normal.png`, optional `T_<id>_AO.png`, and `Previews/<id>.png` (a rendered sphere, not a texture). Shading: albedo = BaseColor, roughness = ORM.g, metallic = ORM.b, occlusion = ORM.r × AO.r (AO optional), normal = Normal (or flat). The manifest lists each texture's `colorspace`, `wrap` (`repeat`) and `size_m`.
- `meta`: `resolution`, `maps` (which maps exist), `size_m`, `normal_convention` (`OpenGL (+Y)`, only when a normal map exists), `orm_layout`.
- Use for floors, walls, roofs, terrain layers, props without their own texture set. For repeated surfaces on big meshes, keep the repeat count at `1 / size_m` per meter so texel density stays consistent.
- Verified on real assets (three.js, 2026-11-22): sRGB BaseColor + linear Roughness/Metallic rendered with brightness consistent with the PNG's own sRGB mean (no washed-out or too-dark look); repeat `1 / size_m` gave natural tile sizes; seamless edges showed no seams.

### Verify the normal map (data issue found and fixed on 2026-11-22)

The label says `OpenGL (+Y)`. A scan on 2026-11-22 found about **1 in 6 published normal maps with the green channel inverted (DirectX-style)** — mostly concrete, tile, paving, metal panels, asphalt, cork. They came from an early PBR generation script (Sep 25 – Oct 10) that got the green sign wrong. The originals were fixed and the materials re-published the same day (re-scan: all 20 first-wave materials are OpenGL now), and new materials are checked before approval. Remaining risk: a few materials were published just before the fix and may still be stale, and two (`plastic-pp-corrugated-board`, `nylon-tricot-leotard-black-gloss`) have no clear answer — so verify when it matters.

**By eye (recommended, any engine):** put the material on a flat floor, light it from the camera side at a low angle (grazing light), and look at joints / grooves / cracks.
- They look **recessed** → the map matches OpenGL; use it as documented.
- They look **raised** (inside-out relief) → green is inverted. Fix it:
  - three.js: `material.normalScale.set(1, -1)`
  - Unity / Godot: invert the green channel (a shader/Shader Graph step `G = 1 − G`, or invert it on the texture once)
  - Unreal: it expects DirectX, so the inverted data is **already correct — do not flip** (and flip the materials that are correct for the others)
- A normal map with no clear structure (cloth, fine noise) is not worth the check — a wrong green channel is hard to see there.

**By numbers (optional, any normal PNG):** a normal map made from a height field is curl-free, so
`corr( −dR/drow , dG/dcol )` over the image (rows go downward; central differences) is **positive for OpenGL (+Y) and negative for DirectX (−Y)**; |corr| < 0.05 means "cannot tell". Before the fix, brick paving gave +0.99 and the inverted concrete slabs −0.88 to −1.0 (the fixed ones now give the same magnitudes with a positive sign).

## decal

- One PNG: **RGBA, straight (non-premultiplied) alpha**, transparent edges, 8-bit, **sRGB**, wrap = **clamp** (never repeat). Sizes vary — often 1024², but can be elongated (e.g. a road line 2416×76).
- `meta.size_m` = [width, height] meters: the **real-world footprint to project**. It keeps the image's aspect ratio. For most decals it is derived from a default density (512 px/m, so 1024 px = 2 m); scale to taste.
- `meta`: `surface` (what it depicts), `size_px`, `size_m`, `color_space`, optional `render_class`.
- Decals are made to be **projected onto surfaces** (road wear, cracks, stains, markings, graffiti), not UV-mapped onto a model. Typical use: a projector / decal actor oriented along the surface normal, depth-bounded, with the PNG's alpha as the mask.

## matcap

- One PNG, **1024×1024, sRGB**. A MatCap shades by the **view-space normal** — no UVs, no scene lights. It gives a stylized, baked-lighting look (clay, metal, toon) and is also handy for look-dev.
- `meta`: `surface`, `use_for`, `size_px`.

## skybox

- **Equirectangular (2:1) 4096×2048, 8-bit sRGB, LDR** (not HDR). Horizon is the vertical middle; left and right edges join seamlessly; the lower half is plain ground color (or water) for sky-only styles.
- Tags describe it: `style:` (anime / realistic), `time:` (dawn / morning / day / sunset / dusk / night / space / underwater), `weather:`, `horizon:` (`sky-only` / `panorama` / `none`), `scene:`.
- Below the horizon the image is a **flat ground color** (greenish gray for the daytime anime sky), not scenery: cover it with a large ground plane, or you will see an empty gray floor to the horizon.
- **LDR means it is weak as an image-based light.** Light the scene yourself with a Directional Light plus Ambient; use the skybox as the background (and optionally for reflections).
- `meta.sun_azimuth_deg` (when present): direction of the sun/moon disc, measured from the image's horizontal center (u = 0.5) = 0°, clockwise. Aim the Directional Light accordingly. `null` / absent = no disc drawn.
- `--format engine` pack: `Textures/T_<id>_Skybox.png` + manifest with recommended Unity import: shader `Skybox/Panoramic`, mapping *Latitude Longitude*, image type *360*, **mipmaps OFF** (mips cause a vertical seam line), max size 4096 (2048 on mobile). Compress with ASTC 6x6 first; if the sky gradient shows banding use 4x4 or uncompressed.
- `meta`: `projection` (`equirectangular`), `dynamic_range` (`ldr`), `size_px`.
