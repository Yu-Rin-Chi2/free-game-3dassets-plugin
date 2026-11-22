import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { KIND_PATH, SITE_BASE, type AssetKind } from "./constants.js";

// ---- API shapes (only the fields this CLI reads) ---------------------------------------------

export interface AssetSummary {
  id: string;
  kind: AssetKind;
  slug: string;
  name: string;
  name_ja: string;
  category: string | null;
  subcategory: string | null;
  tags: string[];
  thumb_url: string | null;
  license: string;
}

export interface AssetFile {
  role: string;
  url: string | null;
  download_url: string | null;
  filename: string;
  content_type: string;
  size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  downloadable: boolean;
}

export interface AssetDetail extends AssetSummary {
  description?: string;
  description_en?: string;
  meta?: unknown;
  files: AssetFile[];
}

export interface ListResponse {
  items: AssetSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface FacetsResponse {
  kinds: { kind: string; count: number }[];
  categories: { kind: string; category: string | null; subcategory: string | null; count: number }[];
  tags: { ns: string; value: string; count: number }[];
}

// ---- HTTP -------------------------------------------------------------------------------------

export type FetchResult<T> = { ok: true; data: T } | { ok: false; status: number; reason: string };

const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_SEC = 90;
const HEADERS_TIMEOUT_MS = 30_000;
const STALL_TIMEOUT_MS = 60_000;

let userAgent = "freegame3d-cli";
export function setUserAgent(ua: string) {
  userAgent = ua;
}

// Overridable so tests do not have to wait. Default: 400ms, 800ms, ...
function backoffMs(attempt: number): number {
  const base = Number(process.env.FREEGAME3D_RETRY_DELAY_MS ?? 400);
  return (Number.isFinite(base) ? base : 400) * 2 ** (attempt - 1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Milliseconds to wait before retrying, or null if this response must not be retried. */
function retryDelay(res: Response | null, attempt: number): number | null {
  if (res && res.status >= 400 && res.status < 500 && res.status !== 429) return null;
  if (res?.status === 429) {
    const ra = Number(res.headers.get("retry-after"));
    if (Number.isFinite(ra) && ra >= 0) return ra > MAX_RETRY_AFTER_SEC ? null : ra * 1000;
  }
  return backoffMs(attempt);
}

async function fetchWithTimeout(url: string, accept: string): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), HEADERS_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: { Accept: accept, "User-Agent": userAgent }, signal: ctl.signal });
  } finally {
    clearTimeout(timer); // only the time-to-headers is bounded here; the body has its own stall guard
  }
}

/**
 * Resilient JSON GET. Never throws. Retries network errors, 5xx, 429 (honouring Retry-After) and
 * non-JSON 200s (e.g. an HTML error page from the edge). Other 4xx are returned immediately.
 */
export async function getJson<T>(url: string): Promise<FetchResult<T>> {
  let last: FetchResult<T> = { ok: false, status: 0, reason: "unknown" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetchWithTimeout(url, "application/json");
    } catch (e) {
      last = { ok: false, status: 0, reason: `network error: ${String(e)}` };
    }

    if (res) {
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          try {
            return { ok: true, data: (await res.json()) as T };
          } catch (e) {
            last = { ok: false, status: res.status, reason: `invalid body: ${String(e)}` };
          }
        } else {
          last = { ok: false, status: res.status, reason: `non-JSON response (content-type: ${ct || "unknown"})` };
        }
      } else {
        last = { ok: false, status: res.status, reason: `HTTP ${res.status}` };
      }
    }

    const wait = retryDelay(res && !res.ok ? res : null, attempt);
    if (wait === null || attempt === MAX_ATTEMPTS) break;
    await sleep(wait);
  }
  return last;
}

export type DownloadResult =
  | { ok: true; bytes: number }
  | { ok: false; kind: "backend" | "checksum"; reason: string };

/**
 * Streams `url` to `dest` (never buffering the whole file: GLB / FBX can be hundreds of MiB), verifies
 * size + sha256 against what the API declared, and only then renames the `.part` file into place.
 */
export async function downloadToFile(
  url: string,
  dest: string,
  expected: { sha256: string; size: number },
): Promise<DownloadResult> {
  const part = `${dest}.part`;
  let last: DownloadResult = { ok: false, kind: "backend", reason: "unknown" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetchWithTimeout(url, "*/*");
    } catch (e) {
      last = { ok: false, kind: "backend", reason: `network error: ${String(e)}` };
    }

    if (res) {
      if (!res.ok || !res.body) {
        last = { ok: false, kind: "backend", reason: res.ok ? "empty body" : `HTTP ${res.status}` };
      } else {
        const hash = createHash("sha256");
        let bytes = 0;
        let stallTimer: NodeJS.Timeout | undefined;
        const guard = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            hash.update(chunk);
            bytes += chunk.length;
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => guard.destroy(new Error("download stalled")), STALL_TIMEOUT_MS);
            cb(null, chunk);
          },
          flush(cb) {
            clearTimeout(stallTimer);
            cb();
          },
          destroy(err, cb) {
            clearTimeout(stallTimer);
            cb(err);
          },
        });
        stallTimer = setTimeout(() => guard.destroy(new Error("download stalled")), STALL_TIMEOUT_MS);

        try {
          await pipeline(Readable.fromWeb(res.body as never), guard, createWriteStream(part));
          const sha = hash.digest("hex");
          if (bytes === expected.size && sha === expected.sha256.toLowerCase()) {
            await rename(part, dest);
            return { ok: true, bytes };
          }
          last = {
            ok: false,
            kind: "checksum",
            reason: `size/sha256 mismatch (got ${bytes} bytes, sha256 ${sha.slice(0, 12)}…; expected ${expected.size} bytes, sha256 ${expected.sha256.slice(0, 12)}…)`,
          };
        } catch (e) {
          clearTimeout(stallTimer);
          last = { ok: false, kind: "backend", reason: `download failed: ${String(e)}` };
        }
        await rm(part, { force: true });
      }
    }

    const wait = retryDelay(res && !res.ok ? res : null, attempt);
    if (wait === null || attempt === MAX_ATTEMPTS) break;
    await sleep(wait);
  }
  await rm(part, { force: true });
  return last;
}

// ---- API client -------------------------------------------------------------------------------

export class ApiClient {
  private readonly base: string;
  constructor(base: string) {
    this.base = base.replace(/\/$/, "");
  }

  private get<T>(path: string) {
    return getJson<T>(`${this.base}${path}`);
  }

  search(opts: {
    query?: string;
    kind?: string;
    category?: string;
    subcategory?: string;
    tags: string[];
    sort?: string;
    page?: number;
    limit: number;
  }) {
    const p = new URLSearchParams();
    if (opts.query) p.set("q", opts.query);
    if (opts.kind) p.set("kind", opts.kind);
    if (opts.category) p.set("category", opts.category);
    if (opts.subcategory) p.set("subcategory", opts.subcategory);
    for (const t of opts.tags) p.append("tag", t);
    if (opts.sort) p.set("sort", opts.sort);
    if (opts.page) p.set("page", String(opts.page));
    p.set("limit", String(opts.limit));
    return this.get<ListResponse>(`/v1/assets?${p}`);
  }

  detail(kind: AssetKind, slug: string) {
    return this.get<AssetDetail>(`/v1/assets/${kind}/${slug}`);
  }

  facets(kind?: string) {
    return this.get<FacetsResponse>(`/v1/meta/facets${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`);
  }
}

// ---- Presentation helpers ---------------------------------------------------------------------

/** Page on the website where a person can look at the asset (not a file URL). */
export function pageUrl(kind: AssetKind, slug: string): string {
  return `${SITE_BASE}/${KIND_PATH[kind]}/${slug}`;
}

/** Trim a list/detail row down to what an agent needs to pick an asset. */
export function slim(a: AssetSummary) {
  return {
    id: a.id,
    kind: a.kind,
    slug: a.slug,
    name: a.name,
    name_ja: a.name_ja,
    category: a.category,
    subcategory: a.subcategory,
    tags: a.tags,
    thumb_url: a.thumb_url,
    license: a.license,
    page_url: pageUrl(a.kind, a.slug),
  };
}
