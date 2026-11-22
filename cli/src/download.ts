import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { ApiClient, downloadToFile, type AssetFile } from "./api.js";
import { ASSET_KINDS, FORMATS, SLUG_RE, defaultFormat, type AssetKind } from "./constants.js";

export interface AssetRef {
  kind: AssetKind;
  slug: string;
  id: string;
}

/** Parse `<kind>/<slug>` (the API's `id`). Returns null for anything that is not exactly that. */
export function parseId(value: string): AssetRef | null {
  const m = /^([a-z]+)\/([^/]+)$/.exec(value);
  if (!m) return null;
  const kind = m[1] as AssetKind;
  const slug = m[2]!;
  if (!(ASSET_KINDS as readonly string[]).includes(kind) || !SLUG_RE.test(slug)) return null;
  return { kind, slug, id: `${kind}/${slug}` };
}

/** File names come from the API. Accept a plain file name only — never a path. */
const UNSAFE_FILENAME = /[\\/:*?"<>|\u0000-\u001f]/;
export function isSafeFilename(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 200 &&
    !UNSAFE_FILENAME.test(name) &&
    !name.startsWith(".") &&
    !name.endsWith(".part")
  );
}

/** Roles to download for `format` (null = every downloadable file), or undefined if the format is not valid for the kind. */
export function rolesFor(kind: AssetKind, format: string | undefined): readonly string[] | null | undefined {
  const table = FORMATS[kind];
  const key = format ?? defaultFormat(kind);
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

export interface DownloadReport {
  saved: { id: string; role: string; filename: string; path: string; size: number; sha256: string }[];
  skipped: { id: string; role: string; path: string; reason: string }[];
  warnings: { id: string; message: string }[];
  errors: { id: string; kind: "invalid" | "not_found" | "no_file" | "backend" | "checksum"; message: string }[];
}

const downloadable = (f: AssetFile) => f.downloadable && !!f.download_url;

export async function download(
  api: ApiClient,
  refs: AssetRef[],
  opts: { out: string; format?: string; force: boolean },
): Promise<DownloadReport> {
  const report: DownloadReport = { saved: [], skipped: [], warnings: [], errors: [] };
  const outRoot = resolve(opts.out);

  for (const ref of refs) {
    const roles = rolesFor(ref.kind, opts.format);
    if (roles === undefined) {
      // Callers validate up front; this guards direct use.
      report.errors.push({ id: ref.id, kind: "invalid", message: `Invalid --format "${opts.format}" for ${ref.kind}` });
      continue;
    }

    const detail = await api.detail(ref.kind, ref.slug);
    if (!detail.ok) {
      report.errors.push(
        detail.status === 404
          ? { id: ref.id, kind: "not_found", message: `Asset not found: ${ref.id}` }
          : { id: ref.id, kind: "backend", message: `Lookup failed (${detail.reason})` },
      );
      continue;
    }

    const files = (detail.data.files ?? []).filter(downloadable);
    const selected = roles === null ? files : files.filter((f) => roles.includes(f.role));
    if (roles !== null) {
      for (const role of roles) {
        if (!files.some((f) => f.role === role)) {
          report.warnings.push({ id: ref.id, message: `No downloadable "${role}" file on this asset` });
        }
      }
    }
    if (selected.length === 0) {
      report.errors.push({ id: ref.id, kind: "no_file", message: `Nothing to download for ${ref.id} with --format ${opts.format ?? defaultFormat(ref.kind)}` });
      continue;
    }

    const dir = join(outRoot, ref.slug);
    await mkdir(dir, { recursive: true });

    for (const f of selected) {
      if (!isSafeFilename(f.filename)) {
        report.errors.push({ id: ref.id, kind: "invalid", message: `Refusing unsafe file name from API: ${JSON.stringify(f.filename)}` });
        continue;
      }
      const path = resolve(dir, f.filename);
      if (!path.startsWith(dir + sep)) {
        report.errors.push({ id: ref.id, kind: "invalid", message: `Refusing path outside the output directory: ${f.filename}` });
        continue;
      }
      if (existsSync(path) && !opts.force) {
        report.skipped.push({ id: ref.id, role: f.role, path, reason: "exists (use --force to overwrite)" });
        continue;
      }

      const r = await downloadToFile(f.download_url!, path, { sha256: f.sha256, size: f.size });
      if (!r.ok) {
        report.errors.push({ id: ref.id, kind: r.kind, message: `${f.filename}: ${r.reason}` });
        continue;
      }
      report.saved.push({ id: ref.id, role: f.role, filename: f.filename, path, size: r.bytes, sha256: f.sha256 });
    }
  }
  return report;
}
