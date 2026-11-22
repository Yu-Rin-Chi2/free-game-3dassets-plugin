#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ApiClient, pageUrl, setUserAgent, slim, type AssetDetail } from "./api.js";
import {
  ASSET_KINDS,
  DEFAULT_API_BASE,
  DEFAULT_LIMIT,
  EXIT_BACKEND,
  EXIT_NOT_FOUND,
  EXIT_OK,
  EXIT_USAGE,
  FORMATS,
  LICENSE,
  MAX_LIMIT,
  MAX_TAGS,
  SORTS,
  defaultFormat,
  type AssetKind,
} from "./constants.js";
import { download, parseId, rolesFor, type AssetRef } from "./download.js";

const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const HELP = `freegame3d ${VERSION} — search & download CC0 3D assets (https://3d.freegameui.net)

Usage:
  freegame3d search [query] [--kind <k>] [--category <c>] [--subcategory <s>] [--tag <ns:value>]...
                    [--sort name|updated] [--limit <n>] [--page <n>]
  freegame3d get <kind>/<slug>
  freegame3d taxonomy [--kind <k>]
  freegame3d download <kind>/<slug>... [--out <dir>] [--format <f>] [--force]

Assets are identified by "<kind>/<slug>", e.g. model/anime-axe-kit (the "id" in search results).

Kinds:
  ${ASSET_KINDS.join(" | ")}

Search tips:
  query is matched (AND, up to 8 words) against English and Japanese names, categories and tags.
  Put only the subject noun in the query; use --kind for the kind. If English finds nothing, try Japanese.
  Run "taxonomy" to see the categories and tags that exist (categories and model tags are Japanese).

Download formats (--format; first = default):
${ASSET_KINDS.map((k) => `  ${k.padEnd(9)} ${Object.keys(FORMATS[k]).join(" | ")}`).join("\n")}
  Files are saved to <out>/<slug>/<file name>. Existing files are skipped unless --force.
  Every file is verified against the sha256 the API declares. zip files are NOT extracted.

Options:
  --limit     1-${MAX_LIMIT} (default ${DEFAULT_LIMIT})
  --out       output directory for download (default: current directory)
  --json      machine-readable JSON output (recommended for AI agents)
  --api       API base URL (default ${DEFAULT_API_BASE}, env FREEGAME3D_API)
  -h, --help  show this help
  -v, --version

Exit codes: 0 ok / 1 no results or not found / 2 usage error / 3 network, API or checksum error
All assets are CC0 1.0 — commercial use OK, no attribution required.`;

class UsageError extends Error {}

function oneOf<T extends string>(flag: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new UsageError(`--${flag} must be one of: ${allowed.join(", ")} (got "${value}")`);
  }
  return value as T;
}

function intIn(flag: string, value: string | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new UsageError(`--${flag} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function backendMessage(action: string, reason: string) {
  return `${action} failed (${reason}). The API may be temporarily unavailable — retry shortly. API: ${DEFAULT_API_BASE}/v1/assets`;
}

function parseRefs(values: string[]): AssetRef[] {
  return values.map((v) => {
    const ref = parseId(v);
    if (!ref) throw new UsageError(`Invalid asset id "${v}". Use <kind>/<slug>, e.g. model/anime-axe-kit (kinds: ${ASSET_KINDS.join(", ")})`);
    return ref;
  });
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** What each --format value would download for this asset, with sizes — so the caller can warn before a big download. */
function describeFormats(d: AssetDetail) {
  const files = (d.files ?? []).filter((f) => f.downloadable && f.download_url);
  const options: Record<string, { roles: string[]; bytes: number }> = {};
  for (const [name, roles] of Object.entries(FORMATS[d.kind])) {
    const picked = roles === null ? files : files.filter((f) => roles.includes(f.role));
    if (picked.length > 0) options[name] = { roles: picked.map((f) => f.role), bytes: picked.reduce((s, f) => s + f.size, 0) };
  }
  return { default: defaultFormat(d.kind), options };
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      kind: { type: "string" },
      category: { type: "string" },
      subcategory: { type: "string" },
      tag: { type: "string", multiple: true },
      sort: { type: "string" },
      limit: { type: "string" },
      page: { type: "string" },
      out: { type: "string" },
      format: { type: "string" },
      force: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      api: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (values.version) {
    console.log(VERSION);
    return EXIT_OK;
  }
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return values.help ? EXIT_OK : EXIT_USAGE;
  }

  setUserAgent(`freegame3d-cli/${VERSION}`);
  const api = new ApiClient(values.api ?? process.env.FREEGAME3D_API ?? DEFAULT_API_BASE);
  const json = values.json;
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  const kind = oneOf<AssetKind>("kind", values.kind, ASSET_KINDS);

  switch (command) {
    case "search": {
      const limit = intIn("limit", values.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
      const page = intIn("page", values.page, 1, 100_000, 1);
      const sort = oneOf("sort", values.sort, SORTS);
      const tags = values.tag ?? [];
      if (tags.length > MAX_TAGS) throw new UsageError(`--tag can be given at most ${MAX_TAGS} times`);
      for (const t of tags) {
        const i = t.indexOf(":");
        if (i < 1 || i === t.length - 1) throw new UsageError(`--tag must look like <ns>:<value>, e.g. object:街灯 (got "${t}")`);
      }
      const r = await api.search({
        query: rest.join(" ") || undefined,
        kind,
        category: values.category,
        subcategory: values.subcategory,
        tags,
        sort,
        page,
        limit,
      });
      if (!r.ok) {
        console.error(backendMessage("Search", r.reason));
        return EXIT_BACKEND;
      }
      const items = r.data.items.map(slim);
      if (json) {
        print({ total: r.data.total, page: r.data.page, returned: items.length, items });
      } else if (items.length === 0) {
        console.log("No results. Try a synonym / the Japanese word, fewer words, or run `taxonomy` to see what exists.");
      } else {
        for (const a of items) {
          const cat = [a.category, a.subcategory].filter(Boolean).join("/");
          console.log(`${a.id}  ${a.name}${a.name_ja ? ` / ${a.name_ja}` : ""}  [${cat}]`);
        }
        console.log(`\n${items.length} of ${r.data.total} shown (page ${r.data.page}). Details: freegame3d get <id>   Save: freegame3d download <id> --out <dir>`);
      }
      return items.length === 0 ? EXIT_NOT_FOUND : EXIT_OK;
    }

    case "get": {
      const [ref] = parseRefs(rest.slice(0, 1));
      if (!ref) throw new UsageError("get requires an asset <kind>/<slug>");
      const r = await api.detail(ref.kind, ref.slug);
      if (!r.ok) {
        console.error(r.status === 404 ? `Asset not found: ${ref.id}` : backendMessage("Lookup", r.reason));
        return r.status === 404 ? EXIT_NOT_FOUND : EXIT_BACKEND;
      }
      const d = r.data;
      const files = (d.files ?? [])
        .filter((f) => f.downloadable && f.download_url)
        .map((f) => ({ role: f.role, filename: f.filename, size: f.size, sha256: f.sha256, width: f.width, height: f.height }));
      const formats = describeFormats(d);
      if (json) {
        print({
          ...slim(d),
          description: d.description ?? "",
          description_en: d.description_en ?? "",
          meta: d.meta ?? null,
          files,
          formats,
        });
      } else {
        console.log(`${d.id}  ${d.name}${d.name_ja ? ` / ${d.name_ja}` : ""}`);
        console.log(`page:     ${pageUrl(d.kind, d.slug)}`);
        console.log(`license:  ${d.license}`);
        if (d.description_en) console.log(`about:    ${d.description_en}`);
        console.log(`tags:     ${d.tags.join(", ")}`);
        for (const f of files) {
          const dim = f.width && f.height ? `  ${f.width}x${f.height}` : "";
          console.log(`file:     ${f.role.padEnd(14)} ${f.filename}  ${mb(f.size)}${dim}`);
        }
        for (const [name, o] of Object.entries(formats.options)) {
          console.log(`format:   ${name}${name === formats.default ? " (default)" : ""} → ${o.roles.join(", ")}  ${mb(o.bytes)}`);
        }
        if (d.meta) console.log(`meta:     ${JSON.stringify(d.meta)}`);
      }
      return EXIT_OK;
    }

    case "taxonomy": {
      const r = await api.facets(kind);
      if (!r.ok) {
        console.error(backendMessage("Taxonomy", r.reason));
        return EXIT_BACKEND;
      }
      const { kinds, categories, tags } = r.data;
      if (json) {
        print({ kinds, categories, tags });
      } else {
        console.log(`kinds: ${kinds.map((k) => `${k.kind}(${k.count})`).join(", ")}`);
        for (const c of categories) console.log(`${c.kind}/${c.category}${c.subcategory ? `/${c.subcategory}` : ""}  (${c.count})`);
        if (tags.length > 0) console.log(`tags: ${tags.map((t) => `${t.ns}:${t.value}(${t.count})`).join(", ")}`);
      }
      return EXIT_OK;
    }

    case "download": {
      if (rest.length === 0) throw new UsageError("download requires at least one asset <kind>/<slug>");
      const refs = parseRefs(rest);
      // Validate --format against every requested kind before touching the network.
      for (const ref of refs) {
        if (rolesFor(ref.kind, values.format) === undefined) {
          throw new UsageError(`--format "${values.format}" is not valid for ${ref.kind}. Allowed for ${ref.kind}: ${Object.keys(FORMATS[ref.kind]).join(", ")}`);
        }
      }
      const report = await download(api, refs, { out: values.out ?? ".", format: values.format, force: values.force });
      if (json) {
        print({ ...report, license: LICENSE });
      } else {
        for (const s of report.saved) console.log(`saved    ${s.path}  (${mb(s.size)})`);
        for (const s of report.skipped) console.log(`skipped  ${s.path} — ${s.reason}`);
        for (const w of report.warnings) console.log(`warning  ${w.id}: ${w.message}`);
        for (const e of report.errors) console.error(`error    ${e.id}: ${e.message}`);
        if (report.saved.length > 0) console.log("License: CC0 1.0 — commercial use OK, no attribution required.");
      }
      if (report.errors.some((e) => e.kind === "backend" || e.kind === "checksum")) return EXIT_BACKEND;
      if (report.errors.length > 0) return EXIT_NOT_FOUND;
      return EXIT_OK;
    }

    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    // parseArgs throws TypeError with code ERR_PARSE_ARGS_* for unknown / malformed options.
    const isParseError = e instanceof Error && "code" in e && String((e as { code: unknown }).code).startsWith("ERR_PARSE_ARGS");
    if (e instanceof UsageError || isParseError) {
      console.error(`${(e as Error).message}\nRun "freegame3d --help" for usage.`);
      process.exitCode = EXIT_USAGE;
      return;
    }
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = EXIT_BACKEND;
  },
);
