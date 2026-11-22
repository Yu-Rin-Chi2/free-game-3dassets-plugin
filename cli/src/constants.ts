// The API contract this CLI depends on (which fields are read, what each --format downloads) is maintained
// alongside the service's API. Only those fields are read. Unknown fields are ignored, so API additions never break the CLI.

export const ASSET_KINDS = ["model", "material", "decal", "matcap", "skybox"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const SORTS = ["name", "updated"] as const;

export const DEFAULT_API_BASE = "https://3d-api.freegameui.net";
export const SITE_BASE = "https://3d.freegameui.net";

// URL segment of each kind on the website (human-facing pages only; file URLs always come from the API).
export const KIND_PATH: Record<AssetKind, string> = {
  model: "models",
  material: "materials",
  decal: "decals",
  matcap: "matcaps",
  skybox: "skyboxes",
};

// Same rule as the service (packages/shared SLUG_RE). Keeps an id from ever escaping the output directory.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;

export const DEFAULT_LIMIT = 12;
export const MAX_LIMIT = 50;
export const MAX_TAGS = 8; // the API accepts at most 8 `tag` params

export const LICENSE = "CC0-1.0";

/**
 * `--format` values per kind → the file roles they download.
 * `null` means "every downloadable file". The first key of each kind is its default.
 * Roles that are not present on a given asset are reported as warnings (e.g. a material without a normal map).
 */
const MAPS = ["map_basecolor", "map_roughness", "map_metallic", "map_normal", "map_ao"] as const;

export const FORMATS: Record<AssetKind, Record<string, readonly string[] | null>> = {
  model: {
    glb: ["glb"],
    fbx: ["fbx_zip"],
    both: ["glb", "fbx_zip"],
    all: null,
  },
  material: {
    maps: MAPS,
    engine: ["engine_zip"],
    both: [...MAPS, "engine_zip"],
    all: null,
  },
  decal: {
    image: ["image"],
    all: null,
  },
  matcap: {
    image: ["image"],
    all: null,
  },
  skybox: {
    image: ["image"],
    engine: ["engine_zip"],
    both: ["image", "engine_zip"],
    all: null,
  },
};

export function defaultFormat(kind: AssetKind): string {
  return Object.keys(FORMATS[kind])[0]!;
}

// Exit codes
export const EXIT_OK = 0;
export const EXIT_NOT_FOUND = 1;
export const EXIT_USAGE = 2;
export const EXIT_BACKEND = 3;
