# Wiring the assets into an engine

Short recipes for the engines people ask for most. Details of each asset kind are in [asset-structure.md](asset-structure.md). If the project uses an engine not listed here, apply the same facts (units, color spaces, OpenGL normals, ORM layout) to that engine's equivalent settings.

Rule of thumb: **model → GLB** (materials included) unless the engine is Unity/Unreal and the user wants the FBX package.

## three.js / Babylon.js (web)

```js
// model (GLB)
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
new GLTFLoader().load('assets/3d/anime-axe-kit/anime-axe-kit.glb', (gltf) => scene.add(gltf.scene));

// tiling PBR material from separate maps (--format maps)
import * as THREE from 'three';
const tl = new THREE.TextureLoader();
const dir = 'assets/3d/board-cork-pinup/';            // <out>/<slug>/
const tex = (file, srgb = false) => {
  const t = tl.load(dir + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;       // only BaseColor is sRGB
  return t;
};
const mat = new THREE.MeshStandardMaterial({
  map: tex('board-cork-pinup_basecolor.png', true),
  roughnessMap: tex('board-cork-pinup_roughness.png'),
  metalnessMap: tex('board-cork-pinup_metallic.png'),
  normalMap: tex('board-cork-pinup_normal.png'),       // omit if the material has no normal map. CHECK the green channel (see below)
  aoMap: tex('board-cork-pinup_ao.png'),               // omit if absent (current three.js reads UV channel 0 by default: texture.channel = 0)
});
// Some materials ship with an inverted green channel (see asset-structure.md "Verify the normal map").
// If joints/grooves look raised under a low raking light:  mat.normalScale.set(1, -1);
// size_m = [w, h] meters per tile → repeat per meter = 1 / size_m
const [w, h] = [1.3, 1.3];                             // from `get … --json` → meta.size_m
for (const t of [mat.map, mat.roughnessMap, mat.metalnessMap, mat.normalMap, mat.aoMap]) t?.repeat.set(floorWidth / w, floorDepth / h);

// skybox
const sky = tl.load('assets/3d/anime-day-cumulus/anime-day-cumulus.png');
sky.mapping = THREE.EquirectangularReflectionMapping;
sky.colorSpace = THREE.SRGBColorSpace;
scene.background = sky;                                // LDR: add your own DirectionalLight + AmbientLight

// MatCap
new THREE.MeshMatcapMaterial({ matcap: tl.load('assets/3d/metal-gold-polished/metal-gold-polished.png') });

// decal (projected onto a mesh)
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
// DecalGeometry(targetMesh, hitPoint, orientationEuler, sizeVector3(w, h, depth)); material: transparent, depthWrite:false,
// polygonOffset:true, map = decal PNG (sRGB). Use meta.size_m for width/height.
```

If the maps come from `--format engine`, one ORM texture can feed all three slots in three.js (roughness is read from G, metalness from B, AO from R): set `roughnessMap`, `metalnessMap` and `aoMap` to the same ORM texture (non-sRGB).
Apply `renderer.outputColorSpace = THREE.SRGBColorSpace` (the default in current three.js).

## Unity

- **Model**: GLB needs a glTF importer package (e.g. glTFast). FBX imports natively — use the FBX settings in asset-structure.md (Convert Units on, scale 1, Normals Import, Tangents MikkTSpace, Generate Lightmap UVs OFF) and assign materials from the manifest.
- **Material** (`--format engine`): import `T_<id>_BaseColor` as sRGB, `T_<id>_ORM` and `T_<id>_Normal` with sRGB **off** (Normal → Texture Type *Normal map*). URP Lit wants Metallic in R and Smoothness in A of one map, with occlusion separate — repack ORM yourself (Smoothness = 1 − G, Metallic = B, Occlusion = R), or use a shader graph that reads ORM directly. Set tiling to `1 / size_m`.
- **Decal**: URP *Decal Projector* with a Decal Shader Graph material using the PNG (sRGB, alpha, wrap clamp). Projector size = `meta.size_m` (width, height) + a depth. (Built-in pipeline: a slightly offset quad with an alpha-blended unlit/transparent material.)
- **Skybox** (`--format engine`): material with shader `Skybox/Panoramic`, Mapping *Latitude Longitude*, Image Type *360*, texture **Generate Mip Maps OFF**, Max Size 4096 (2048 for mobile); assign it as the scene's Skybox material. LDR: keep a Directional Light (aim at `sun_azimuth_deg` if present) and set Ambient to Skybox or a color.
- **MatCap**: needs a MatCap shader (URP has none built in) sampling the PNG with the view-space normal.

## Unreal Engine

- **Model**: FBX imports natively; GLB needs a glTF importer plugin. 1 unit in the file = 1 m (Unreal uses cm — the importer scales).
- **Material**: BaseColor sRGB on; ORM and Normal sRGB off. ORM is already in Unreal's usual packing (R = AO, G = Roughness, B = Metallic) — connect the channels directly. **Normal maps are OpenGL (+Y): enable "Flip Green Channel"** on import. Tile with a TexCoord multiplier of `1 / size_m` (adjusted for cm).
- **Decal**: a Decal Actor with a material using *Deferred Decal* domain; use the PNG's RGB and alpha, size from `meta.size_m`.
- **Skybox**: the image is equirectangular (2:1). Either map it on a large sky-sphere material (simplest), or convert it to a cube texture and use it with a SkyLight. It is LDR, so keep real lights in the level. (Check the engine version's current workflow for long-lat → cubemap conversion.)

## Godot 4

- **Model**: import the GLB directly (`.glb` is a first-class format).
- **Material**: `StandardMaterial3D`: Albedo texture = BaseColor; Roughness texture (channel Green when using ORM, or the roughness PNG with the matching channel); Metallic texture (Blue for ORM); Ambient Occlusion texture (Red for ORM); Normal Map (Godot uses the OpenGL convention, so no flip). Set UV1 *Scale* to `Vector3(1/size_m.x, 1/size_m.y, 1)` for tiling (or use triplanar).
- **Decal**: the `Decal` node — Albedo = the PNG, `size` = `Vector3(w, depth, h)` from `meta.size_m`.
- **Skybox**: `PanoramaSkyMaterial` with the PNG in a `Sky`, assigned to a `WorldEnvironment` (Background = Sky). LDR: add a `DirectionalLight3D`.

## Practical checklist when assembling a scene

1. Scale-check every model against `meta.stats.size_m` (door ≈ 2 m, person ≈ 1.7 m).
2. Set color spaces right: only BaseColor, decals, MatCaps and skyboxes are sRGB.
3. Normal maps: OpenGL by default; flip green for Unreal only.
4. Tile materials by `1 / size_m` per meter.
5. Skybox is LDR → add real lights; aim the sun light at `sun_azimuth_deg` when given; hide the flat lower half with a large ground.
5b. Normal maps: look at joints under a raking light; some materials are inverted (flip green for three.js / Unity / Godot; **not** for Unreal).
6. Keep downloaded files under one folder (e.g. `assets/3d/<slug>/`) and let the engine compress textures; do not resize the PNGs yourself.
