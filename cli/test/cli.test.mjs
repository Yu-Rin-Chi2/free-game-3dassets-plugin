import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../dist/index.js", import.meta.url));

let server;
let base;
let requests = [];
let flaky = 0; // number of upcoming /v1/assets list requests to fail with 503
let rateLimitOnce = new Set(); // /files paths that answer 429 once

// ---- fixtures ---------------------------------------------------------------------------------

const BODIES = {}; // path -> Buffer served by /files
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/** A file entry as the API returns it (downloadable ones get a download_url). */
function file(role, filename, content, { downloadable = true, path, sha256, size } = {}) {
  const buf = Buffer.from(content);
  const p = path ?? `/files/${role}-${filename}`;
  if (downloadable) BODIES[p] = buf;
  return {
    role,
    url: `${base}${p}`,
    download_url: downloadable ? `${base}${p}?dl=1` : null,
    filename,
    content_type: "application/octet-stream",
    size: size ?? buf.length,
    sha256: sha256 ?? sha(buf),
    width: null,
    height: null,
    downloadable,
  };
}

function summary(kind, slug, extra = {}) {
  return {
    id: `${kind}/${slug}`,
    kind,
    slug,
    name: slug,
    name_ja: "名前",
    category: "cat",
    subcategory: "sub",
    tags: ["object:斧"],
    thumb_url: `${base}/files/thumb-${slug}.webp`,
    license: "CC0-1.0",
    // fields the CLI must ignore:
    search_text: "x",
    facets: {},
    preview: { type: "glb" },
    ...extra,
  };
}

function buildDetails() {
  return {
    "model/axe-kit": summary("model", "axe-kit", {
      description: "",
      description_en: "An axe.",
      meta: { stats: { triangles: 100 } },
      files: [
        file("fbx_zip", "axe-kit_fbx.zip", "FBXZIP"),
        file("glb", "axe-kit.glb", "GLBDATA"),
        file("poster", "poster.webp", "p", { downloadable: false }),
        file("thumb", "thumb.webp", "t", { downloadable: false }),
      ],
    }),
    "material/wood-test": summary("material", "wood-test", {
      meta: { resolution: 2048 },
      files: [
        file("map_basecolor", "wood-test_basecolor.png", "BC"),
        file("map_roughness", "wood-test_roughness.png", "RG"),
        file("map_metallic", "wood-test_metallic.png", "MT"),
        file("map_basecolor_preview", "map_basecolor_preview.webp", "x", { downloadable: false }),
        file("engine_zip", "wood-test_material.zip", "ENGINE"),
      ],
    }),
    "skybox/sky-test": summary("skybox", "sky-test", {
      files: [file("image", "sky-test.png", "SKYPNG"), file("engine_zip", "sky-test_skybox.zip", "SKYZIP")],
    }),
    "decal/decal-test": summary("decal", "decal-test", { files: [file("image", "decal-test.png", "DECAL")] }),
    "model/bad-sha": summary("model", "bad-sha", {
      files: [file("glb", "bad-sha.glb", "REAL", { path: "/files/bad-sha.glb", sha256: sha("OTHER") })],
    }),
    "model/short-size": summary("model", "short-size", {
      files: [file("glb", "short-size.glb", "REAL", { path: "/files/short-size.glb", size: 999 })],
    }),
    "model/evil-name": summary("model", "evil-name", {
      files: [file("glb", "../../evil.glb", "EVIL", { path: "/files/evil.glb" })],
    }),
    "model/rate-limited": summary("model", "rate-limited", {
      files: [file("glb", "rate-limited.glb", "OKAFTER429", { path: "/files/rate-limited.glb" })],
    }),
    "model/no-glb": summary("model", "no-glb", {
      files: [file("fbx_zip", "no-glb_fbx.zip", "ONLYFBX")],
    }),
  };
}

before(async () => {
  let details;
  server = createServer((req, res) => {
    const url = new URL(req.url, base);
    requests.push(url);
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/v1/assets") {
      if (flaky > 0) {
        flaky--;
        res.writeHead(503);
        return res.end("unavailable");
      }
      const items = url.searchParams.get("q") === "zzz" ? [] : [summary("model", "axe-kit")];
      return json(200, { total: items.length, page: 1, limit: 12, items });
    }
    const m = /^\/v1\/assets\/([a-z]+)\/([^/]+)$/.exec(url.pathname);
    if (m) {
      details ??= buildDetails();
      const d = details[`${m[1]}/${m[2]}`];
      return d ? json(200, d) : json(404, { error: "Not found", status: 404 });
    }
    if (url.pathname === "/v1/meta/facets") {
      return json(200, {
        kinds: [{ kind: "model", count: 1 }],
        categories: [{ kind: "model", category: "小物", subcategory: "武器", count: 1 }],
        tags: [{ ns: "object", value: "斧", count: 1 }],
      });
    }
    if (url.pathname.startsWith("/files/")) {
      if (rateLimitOnce.has(url.pathname)) {
        rateLimitOnce.delete(url.pathname);
        res.writeHead(429, { "Retry-After": "0" });
        return res.end("slow down");
      }
      const body = BODIES[url.pathname];
      if (!body) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      return res.end(body);
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  details = undefined;
});

after(() => server.close());

function run(args) {
  requests = [];
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { env: { ...process.env, FREEGAME3D_API: base, FREEGAME3D_RETRY_DELAY_MS: "5" } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
  });
}

async function withTmp(fn) {
  const dir = await mkdtemp(join(tmpdir(), "fg3d-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const listAll = async (dir) => {
  const out = [];
  const walk = async (d, prefix) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(join(d, e.name), `${prefix}${e.name}/`);
      else out.push(`${prefix}${e.name}`);
    }
  };
  await walk(dir, "");
  return out.sort();
};

// ---- search / get / taxonomy ------------------------------------------------------------------

test("search passes every filter through to the API", async () => {
  const r = await run([
    "search", "axe", "--kind", "model", "--category", "小物", "--subcategory", "武器",
    "--tag", "object:斧", "--tag", "scene:城", "--sort", "updated", "--page", "2", "--limit", "5", "--json",
  ]);
  assert.equal(r.code, 0);
  const p = requests[0].searchParams;
  assert.equal(requests[0].pathname, "/v1/assets");
  assert.equal(p.get("q"), "axe");
  assert.equal(p.get("kind"), "model");
  assert.equal(p.get("category"), "小物");
  assert.equal(p.get("subcategory"), "武器");
  assert.deepEqual(p.getAll("tag"), ["object:斧", "scene:城"]);
  assert.equal(p.get("sort"), "updated");
  assert.equal(p.get("page"), "2");
  assert.equal(p.get("limit"), "5");
});

test("search --json output is slim, stable and ignores unknown API fields", async () => {
  const r = await run(["search", "axe", "--json"]);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out), ["total", "page", "returned", "items"]);
  assert.deepEqual(Object.keys(out.items[0]), [
    "id", "kind", "slug", "name", "name_ja", "category", "subcategory", "tags", "thumb_url", "license", "page_url",
  ]);
  assert.equal(out.items[0].page_url, "https://3d.freegameui.net/models/axe-kit");
});

test("search with no results exits 1", async () => {
  assert.equal((await run(["search", "zzz"])).code, 1);
});

test("usage errors exit 2 and never hit the API", async () => {
  for (const args of [
    ["search", "x", "--kind", "models"],
    ["search", "x", "--limit", "99"],
    ["search", "x", "--limit", "0"],
    ["search", "x", "--page", "0"],
    ["search", "x", "--sort", "popular"],
    ["search", "x", "--tag", "nocolon"],
    ["search", "x", "--tag", "ns:"],
    ["search", "--bogus"],
    ["get"],
    ["get", "axe-kit"],
    ["get", "model/../x"],
    ["get", "Model/axe-kit"],
    ["download"],
    ["download", "model/axe-kit/extra"],
    ["download", "material/wood-test", "--format", "glb"],
    ["download", "model/axe-kit", "skybox/sky-test", "--format", "fbx"],
    ["nope"],
  ]) {
    const r = await run(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(requests.length, 0, args.join(" "));
  }
});

test("transient 5xx is retried, persistent 5xx exits 3", async () => {
  flaky = 1;
  const ok = await run(["search", "axe", "--json"]);
  assert.equal(ok.code, 0);
  assert.equal(requests.length, 2);

  flaky = 3;
  assert.equal((await run(["search", "axe"])).code, 3);
});

test("get lists only downloadable files and what each --format would fetch", async () => {
  const r = await run(["get", "model/axe-kit", "--json"]);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.files.map((f) => f.role), ["fbx_zip", "glb"]);
  assert.equal(out.description_en, "An axe.");
  assert.equal(out.formats.default, "glb");
  assert.deepEqual(out.formats.options.glb.roles, ["glb"]);
  assert.equal(out.formats.options.glb.bytes, Buffer.byteLength("GLBDATA"));
  assert.equal(out.formats.options.both.bytes, Buffer.byteLength("GLBDATA") + Buffer.byteLength("FBXZIP"));
});

test("get: found / not found", async () => {
  assert.equal((await run(["get", "model/axe-kit"])).code, 0);
  assert.equal((await run(["get", "model/missing"])).code, 1);
});

test("taxonomy passes --kind and prints the facets", async () => {
  const r = await run(["taxonomy", "--kind", "model", "--json"]);
  assert.equal(r.code, 0);
  assert.equal(requests[0].searchParams.get("kind"), "model");
  assert.equal(JSON.parse(r.stdout).tags[0].value, "斧");
});

// ---- download ---------------------------------------------------------------------------------

test("download model: default is GLB, saved under <out>/<slug>/", async () => {
  await withTmp(async (dir) => {
    const r = await run(["download", "model/axe-kit", "--out", dir, "--json"]);
    assert.equal(r.code, 0);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(out), ["saved", "skipped", "warnings", "errors", "license"]);
    assert.equal(out.license, "CC0-1.0");
    assert.deepEqual(await listAll(dir), ["axe-kit/axe-kit.glb"]);
    assert.equal(await readFile(join(dir, "axe-kit", "axe-kit.glb"), "utf8"), "GLBDATA");
    // Only the URL the API returned is requested (with ?dl=1), never a constructed one.
    const fileReq = requests.find((u) => u.pathname.startsWith("/files/"));
    assert.equal(fileReq.searchParams.get("dl"), "1");
  });
});

test("download model: --format fbx / both", async () => {
  await withTmp(async (dir) => {
    assert.equal((await run(["download", "model/axe-kit", "--out", dir, "--format", "fbx"])).code, 0);
    assert.deepEqual(await listAll(dir), ["axe-kit/axe-kit_fbx.zip"]);
    assert.equal((await run(["download", "model/axe-kit", "--out", dir, "--format", "both"])).code, 0);
    assert.deepEqual(await listAll(dir), ["axe-kit/axe-kit.glb", "axe-kit/axe-kit_fbx.zip"]);
  });
});

test("download refuses to overwrite without --force", async () => {
  await withTmp(async (dir) => {
    assert.equal((await run(["download", "model/axe-kit", "--out", dir])).code, 0);
    const file = join(dir, "axe-kit", "axe-kit.glb");
    await writeFile(file, "mine");

    const r2 = await run(["download", "model/axe-kit", "--out", dir, "--json"]);
    assert.equal(r2.code, 0);
    assert.equal(JSON.parse(r2.stdout).skipped.length, 1);
    assert.equal(await readFile(file, "utf8"), "mine");
    assert.equal(requests.some((u) => u.pathname.startsWith("/files/")), false, "must not fetch a skipped file");

    assert.equal((await run(["download", "model/axe-kit", "--out", dir, "--force"])).code, 0);
    assert.equal(await readFile(file, "utf8"), "GLBDATA");
  });
});

test("download material: maps by default, warns about absent optional maps; engine / both", async () => {
  await withTmp(async (dir) => {
    const r = await run(["download", "material/wood-test", "--out", dir, "--json"]);
    assert.equal(r.code, 0);
    assert.deepEqual(await listAll(dir), [
      "wood-test/wood-test_basecolor.png",
      "wood-test/wood-test_metallic.png",
      "wood-test/wood-test_roughness.png",
    ]);
    const warned = JSON.parse(r.stdout).warnings.map((w) => w.message);
    assert.ok(warned.some((m) => m.includes("map_normal")));
    assert.ok(warned.some((m) => m.includes("map_ao")));

    assert.equal((await run(["download", "material/wood-test", "--out", dir, "--format", "engine"])).code, 0);
    assert.ok(existsSync(join(dir, "wood-test", "wood-test_material.zip")));
  });
  await withTmp(async (dir) => {
    assert.equal((await run(["download", "material/wood-test", "--out", dir, "--format", "all"])).code, 0);
    assert.equal((await listAll(dir)).length, 4, "all = every downloadable file, no previews");
  });
});

test("download skybox / decal: image by default, skybox engine pack on request", async () => {
  await withTmp(async (dir) => {
    assert.equal((await run(["download", "skybox/sky-test", "decal/decal-test", "--out", dir])).code, 0);
    assert.deepEqual(await listAll(dir), ["decal-test/decal-test.png", "sky-test/sky-test.png"]);
    assert.equal((await run(["download", "skybox/sky-test", "--out", dir, "--format", "engine"])).code, 0);
    assert.ok(existsSync(join(dir, "sky-test", "sky-test_skybox.zip")));
  });
});

test("download: a checksum or size mismatch is an error (exit 3) and leaves nothing behind", async () => {
  await withTmp(async (dir) => {
    for (const slug of ["bad-sha", "short-size"]) {
      const r = await run(["download", `model/${slug}`, "--out", dir, "--json"]);
      assert.equal(r.code, 3, slug);
      assert.equal(JSON.parse(r.stdout).errors[0].kind, "checksum", slug);
    }
    assert.deepEqual(await listAll(dir), [], "no final file and no .part left");
  });
});

test("download: 429 is retried (Retry-After honoured)", async () => {
  await withTmp(async (dir) => {
    rateLimitOnce.add("/files/rate-limited.glb");
    const r = await run(["download", "model/rate-limited", "--out", dir]);
    assert.equal(r.code, 0);
    assert.equal(await readFile(join(dir, "rate-limited", "rate-limited.glb"), "utf8"), "OKAFTER429");
    assert.equal(requests.filter((u) => u.pathname === "/files/rate-limited.glb").length, 2);
  });
});

test("download: an unsafe file name from the API is refused and nothing escapes the output dir", async () => {
  await withTmp(async (dir) => {
    const out = join(dir, "out");
    const r = await run(["download", "model/evil-name", "--out", out, "--json"]);
    assert.equal(r.code, 1);
    assert.equal(JSON.parse(r.stdout).errors[0].kind, "invalid");
    assert.equal(requests.some((u) => u.pathname === "/files/evil.glb"), false, "must not even fetch it");
    assert.equal(existsSync(join(dir, "evil.glb")), false);
    assert.equal(existsSync(join(dir, "out", "evil.glb")), false);
  });
});

test("download: missing assets / formats with nothing to fetch exit 1; good ids in the same call still save", async () => {
  await withTmp(async (dir) => {
    const r = await run(["download", "model/missing", "model/no-glb", "model/axe-kit", "--out", dir, "--json"]);
    assert.equal(r.code, 1);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.errors.map((e) => [e.id, e.kind]), [["model/missing", "not_found"], ["model/no-glb", "no_file"]]);
    assert.deepEqual(out.saved.map((s) => s.id), ["model/axe-kit"]);
  });
});

test("--version and --help", async () => {
  const v = await run(["--version"]);
  assert.equal(v.code, 0);
  assert.match(v.stdout.trim(), /^\d+\.\d+\.\d+$/);
  const h = await run(["--help"]);
  assert.equal(h.code, 0);
  assert.match(h.stdout, /freegame3d/);
  assert.equal((await run([])).code, 2);
});
