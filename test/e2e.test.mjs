// End-to-end: starts the Worker with `wrangler dev` on a free port and a throwaway state
// directory, then drives the built CLI (dist/cli.js) against it. Run with `pnpm test`.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");
const wranglerBin = join(root, "node_modules", ".bin", "wrangler");
const TOKEN = "test-token";
const exec = promisify(execFile);

const tmp = mkdtempSync(join(tmpdir(), "sharecli-test-"));
const state = join(tmp, "state");
const fixtures = join(tmp, "fixtures");
// A fake npm registry that always reports 9.9.9 as the latest version.
const registry = createHttpServer((_req, res) => res.end(JSON.stringify({ version: "9.9.9" })));
// HOME points at the temp dir so the agent-skill lookup never finds a real install.
const env = { ...process.env, HOME: tmp, SHARECLI_CONFIG_DIR: join(tmp, "config"), NO_COLOR: "1" };

let server;
let base;

function freePort() {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Runs the CLI with --json and returns { code, data }. */
async function share(...args) {
  try {
    const { stdout } = await exec(process.execPath, [cli, ...args, "--json"], { env, cwd: tmp });
    return { code: 0, data: JSON.parse(stdout) };
  } catch (err) {
    if (typeof err.code !== "number") throw err;
    return { code: err.code, data: JSON.parse(err.stdout) };
  }
}

async function ok(...args) {
  const r = await share(...args);
  assert.equal(r.code, 0, `share ${args.join(" ")} failed: ${JSON.stringify(r.data)}`);
  return r.data;
}

const get = (path, init) => fetch(base + path, { redirect: "manual", ...init });

function fixture(path, content) {
  const abs = join(fixtures, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

before(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  await exec(wranglerBin, ["d1", "execute", "sharecli-dev", "--local", "--persist-to", state, "--file", "src/worker/schema.sql"], {
    cwd: root,
  });
  server = spawn(
    wranglerBin,
    [
      "dev",
      "--port", String(port),
      "--inspector-port", String(await freePort()),
      "--persist-to", state,
      "--var", `API_TOKEN:${TOKEN}`,
      "--var", "SECRET:test-secret",
      "--test-scheduled",
      "--show-interactive-dev-session=false",
      "--log-level", "warn",
    ],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error("wrangler dev did not start within 60s");
    await new Promise((r) => setTimeout(r, 300));
  }
  await new Promise((r) => registry.listen(0, "127.0.0.1", r));
  env.SHARECLI_REGISTRY_URL = `http://127.0.0.1:${registry.address().port}`;
  await ok("connect", base, "--token", TOKEN);
});

after(() => {
  server?.kill();
  registry.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("publishing", () => {
  test("a single HTML file is served as-is at /<slug>", async () => {
    const s = await ok(fixture("page.html", "<!doctype html><title>Hello &amp; welcome</title><h1>Hi</h1>"), "--no-copy");
    assert.equal(s.kind, "html");
    assert.equal(s.title, "Hello & welcome");
    assert.equal(s.private, false);
    assert.equal(s.version, 1);
    assert.match(s.slug, /^[a-z2-9]{6}$/);
    const days = (Date.parse(s.expires_at) - Date.now()) / 86400_000;
    assert.ok(days > 29.9 && days <= 30, `expires in ${days} days`);
    const res = await get(`/${s.slug}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.match(await res.text(), /<h1>Hi<\/h1>/);
  });

  test("a browser gets the top bar with the HTML page in a frame under it", async () => {
    const s = await ok(fixture("framed.html", "<!doctype html><title>Framed</title><h1>Inside</h1>"));
    const doc = { headers: { "sec-fetch-dest": "document", "user-agent": "Mozilla/5.0" } };
    const res = await get(`/${s.slug}`, doc);
    assert.equal(res.headers.get("vary"), "Sec-Fetch-Dest");
    const page = await res.text();
    assert.match(page, /class="bar-via"/);
    assert.match(page, new RegExp(`<iframe class="frame" id="frame" src="/${s.slug}"`));
    assert.match(page, new RegExp(`href="/${s.slug}/raw" download="framed.html"`));
    assert.match(page, /\/_assets\/frame\.js/);
    assert.doesNotMatch(page, /<h1>Inside<\/h1>/);
    // The frame, link previews and agents get the page itself.
    assert.match(await (await get(`/${s.slug}`, { headers: { "sec-fetch-dest": "iframe" } })).text(), /<h1>Inside<\/h1>/);
    assert.match(await (await get(`/${s.slug}`, { headers: { "sec-fetch-dest": "document", "user-agent": "Slackbot 1.0" } })).text(), /<h1>Inside<\/h1>/);
    const raw = await get(`/${s.slug}/raw`);
    assert.match(raw.headers.get("content-disposition"), /attachment; filename="framed.html"/);
    assert.equal((await get("/_assets/frame.js")).status, 200);
    // Opening it in a browser and then loading the frame counts as one view.
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await ok("info", s.slug)).views, 1);
  });

  test("a folder becomes a site with its assets under /<slug>/", async () => {
    fixture("site/index.html", '<title>Site</title><link rel="stylesheet" href="style.css"><img src="img/a.png">');
    fixture("site/style.css", "body{color:red}");
    fixture("site/img/a.png", "PNG");
    fixture("site/docs/index.html", "docs");
    const s = await ok(join(fixtures, "site"), "--slug", "my-site");
    assert.equal(s.kind, "site");
    assert.equal(s.url, `${base}/my-site/`);
    assert.equal(s.files, 4);
    assert.equal((await get("/my-site")).headers.get("location"), "/my-site/");
    assert.equal((await get("/my-site/style.css")).headers.get("content-type"), "text/css; charset=utf-8");
    assert.equal((await get("/my-site/img/a.png")).status, 200);
    assert.equal((await get("/my-site/docs")).headers.get("location"), "/my-site/docs/");
    assert.equal(await (await get("/my-site/docs/")).text(), "docs");
    assert.equal((await get("/my-site/missing.png")).status, 404);
    // Every HTML page of a site gets the bar in a browser, with no download since there is no single file.
    const doc = { headers: { "sec-fetch-dest": "document" } };
    const framed = await (await get("/my-site/docs/", doc)).text();
    assert.match(framed, /<iframe class="frame" id="frame" src="\/my-site\/docs\/"/);
    assert.doesNotMatch(framed, /download=/);
    assert.equal(await (await get("/my-site/style.css", doc)).text(), "body{color:red}");
    assert.equal((await get("/my-site/missing.html", doc)).status, 404);
  });

  test("an HTML file that references local images takes them along", async () => {
    fixture("withimg/page.html", '<title>P</title><img src="pic.png"><img src="/abs.png">');
    fixture("withimg/pic.png", "PNG");
    const s = await ok(join(fixtures, "withimg/page.html"));
    assert.equal(s.kind, "site");
    assert.equal(s.files, 2);
    assert.ok(s.warnings.some((w) => w.includes("/abs.png")), "warns about root-relative links");
    assert.equal((await get(`/${s.slug}/pic.png`)).status, 200);
  });

  test("Markdown gets the viewer, a raw download and its images", async () => {
    fixture("md/notes.md", "# Release notes\n\n![shot](shot.png)\n\n## One\n");
    fixture("md/shot.png", "PNG");
    const s = await ok(join(fixtures, "md/notes.md"));
    assert.equal(s.kind, "markdown");
    assert.equal(s.title, "Release notes");
    const page = await (await get(`/${s.slug}`)).text();
    assert.match(page, /<title>Release notes<\/title>/);
    assert.match(page, /\/_assets\/viewer\.js/);
    assert.match(page, /class="bar-via" href="https:\/\/github\.com\/alesmartan\/sharecli"/);
    assert.match(page, /data-theme-toggle/);
    assert.match(page, /data-copy-link aria-label="Copy link"/);
    const raw = await get(`/${s.slug}/raw`);
    assert.match(raw.headers.get("content-disposition"), /attachment; filename="notes\.md"/);
    assert.equal((await get(`/${s.slug}/shot.png`)).status, 200);
    assert.equal((await get("/_assets/viewer.js")).status, 200);
    for (const font of ["geist-latin-wght-normal", "geist-mono-latin-wght-normal"]) {
      assert.equal((await get(`/_assets/fonts/${font}.woff2`)).status, 200, font);
    }
  });

  test("custom slugs are validated and must be free", async () => {
    const page = join(fixtures, "page.html");
    assert.equal((await share(page, "--slug", "my-site")).data.error.code, "slug_taken");
    assert.equal((await share(page, "--slug", "api")).data.error.code, "bad_slug");
  });

  test("bad input fails before anything is uploaded", async () => {
    assert.equal((await share(join(fixtures, "nope.html"))).code, 1);
    assert.match((await share(join(fixtures, "page.html"), "--ttl", "soon")).data.error.message, /Invalid --ttl/);
    assert.match((await share(join(fixtures, "page.html"), "--passcode", "ab")).data.error.message, /4-64/);
  });
});

describe("private shares", () => {
  let s;
  before(async () => {
    s = await ok(join(fixtures, "page.html"), "--private");
  });

  test("get a generated passcode of letters and digits", () => {
    assert.equal(s.private, true);
    assert.match(s.passcode, /^(?=.*[a-z])(?=.*[2-9])[a-z2-9]{6}$/);
    assert.equal(s.unlock_url, `${s.url}?k=${s.passcode}`);
  });

  test("show the passcode page until unlocked", async () => {
    const res = await get(`/${s.slug}`);
    assert.equal(res.status, 401);
    assert.match(await res.text(), /This page is protected/);
  });

  test("reject a wrong passcode", async () => {
    const res = await get(`/${s.slug}/unlock`, { method: "POST", body: new URLSearchParams({ passcode: "wrong1", next: `/${s.slug}` }) });
    assert.equal(res.status, 401);
    assert.match(await res.text(), /Wrong passcode/);
  });

  test("unlock with the form (any case) and stay on the share", async () => {
    const res = await get(`/${s.slug}/unlock`, {
      method: "POST",
      body: new URLSearchParams({ passcode: s.passcode.toUpperCase(), next: "//evil.example" }),
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), `/${s.slug}`);
    const cookie = res.headers.get("set-cookie").split(";")[0];
    assert.equal((await get(`/${s.slug}`, { headers: { cookie } })).status, 200);
  });

  test("unlock with the direct link", async () => {
    const res = await get(`/${s.slug}?k=${s.passcode}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), `/${s.slug}`);
  });

  test("a new passcode invalidates old cookies; public opens it up", async () => {
    const res = await get(`/${s.slug}?k=${s.passcode}`);
    const cookie = res.headers.get("set-cookie").split(";")[0];
    const changed = await ok("passcode", s.slug, "newpass7");
    assert.equal(changed.passcode, "newpass7");
    assert.equal((await get(`/${s.slug}`, { headers: { cookie } })).status, 401);
    assert.equal((await ok("public", s.slug)).private, false);
    assert.equal((await get(`/${s.slug}`)).status, 200);
    const again = await ok("private", s.slug);
    assert.equal(again.passcode, "newpass7", "going private again keeps the passcode");
  });

  test("update --private works without a new upload", async () => {
    const p = await ok(join(fixtures, "page.html"));
    const u = await ok("update", p.slug, "--private", "--passcode", "abcd");
    assert.equal(u.private, true);
    assert.equal(u.passcode, "abcd");
  });
});

describe("versions", () => {
  let slug;
  before(async () => {
    slug = (await ok(fixture("v.html", "<title>v1</title>v1"))).slug;
    for (let i = 2; i <= 7; i++) await ok("update", slug, fixture("v.html", `<title>v${i}</title>v${i}`));
  });

  test("update keeps the link and the newest 5 versions", async () => {
    const list = await ok("versions", slug);
    assert.deepEqual(list.map((v) => v.version), [7, 6, 5, 4, 3]);
    assert.equal(list[0].current, true);
    assert.equal(await (await get(`/${slug}`)).text(), "<title>v7</title>v7");
  });

  test("rollback goes to the previous version, or a chosen one", async () => {
    assert.equal((await ok("rollback", slug)).version, 6);
    assert.equal(await (await get(`/${slug}`)).text(), "<title>v6</title>v6");
    assert.equal((await ok("rollback", `${base}/${slug}`, "v3")).version, 3);
    assert.equal((await share("rollback", slug, "v1")).data.error.code, "version_not_found");
  });
});

describe("expiry", () => {
  test("--permanent never expires, and extend leaves it permanent", async () => {
    const s = await ok(join(fixtures, "page.html"), "--permanent");
    assert.equal(s.permanent, true);
    assert.equal(s.expires_at, null);
    assert.equal((await ok("extend", s.slug)).permanent, true);
  });

  test("--ttl and extend set the clock", async () => {
    const s = await ok(join(fixtures, "page.html"), "--ttl", "2h");
    const hours = (Date.parse(s.expires_at) - Date.now()) / 3600_000;
    assert.ok(hours > 1.9 && hours <= 2);
    const e = await ok("extend", s.slug, "--ttl", "7d");
    assert.ok((Date.parse(e.expires_at) - Date.now()) / 86400_000 > 6.9);
  });

  test("expired shares show 410, then the cron removes them", async () => {
    const s = await ok(join(fixtures, "page.html"), "--ttl", "1m");
    // Backdate the expiry directly in the local D1 database.
    await exec(
      wranglerBin,
      ["d1", "execute", "sharecli-dev", "--local", "--persist-to", state, "--command", `UPDATE shares SET expires_at = 1 WHERE slug = '${s.slug}'`],
      { cwd: root },
    );
    const res = await get(`/${s.slug}`);
    assert.equal(res.status, 410);
    assert.equal((await ok("info", s.slug)).expired, true);
    const cron = await fetch(`${base}/cdn-cgi/handler/scheduled`);
    assert.equal(cron.status, 200);
    assert.equal((await get(`/${s.slug}`)).status, 404);
    assert.equal((await share("info", s.slug)).data.error.code, "share_not_found");
  });
});

describe("management", () => {
  test("ls, info, usage and views", async () => {
    const s = await ok(join(fixtures, "page.html"), "--title", "Counted");
    await get(`/${s.slug}`, { headers: { "user-agent": "Mozilla/5.0" } });
    await get(`/${s.slug}`, { headers: { "user-agent": "Slackbot-LinkExpanding 1.0" } });
    await new Promise((r) => setTimeout(r, 300));
    const info = await ok("info", s.slug);
    assert.equal(info.title, "Counted");
    assert.equal(info.views, 1, "link-preview bots are not counted");
    assert.ok((await ok("ls")).some((x) => x.slug === s.slug));
    const u = await ok("usage");
    assert.ok(u.shares >= 1 && u.storage_bytes > 0);
  });

  test("rm needs --yes when nobody can confirm, then deletes everything", async () => {
    const s = await ok(join(fixtures, "page.html"));
    assert.equal((await share("rm", s.slug)).data.error.code, "confirmation_required");
    assert.deepEqual((await ok("rm", s.slug, "--yes")).deleted, [s.slug]);
    assert.equal((await get(`/${s.slug}`)).status, 404);
  });

  test("the API rejects a wrong token", async () => {
    const res = await fetch(`${base}/api/shares`, { headers: { authorization: "Bearer nope" } });
    assert.equal(res.status, 401);
  });

  test("doctor reports a healthy setup", async () => {
    const r = await share("doctor");
    assert.equal(r.code, 0);
    assert.ok(r.data.checks.find((c) => c.name === "Token").ok);
    assert.match(r.data.checks.find((c) => c.name === "Updates").detail, /9\.9\.9 is available/);
  });
});

describe("upgrade", () => {
  test("reports what is outdated without touching a source checkout", async () => {
    const r = await ok("upgrade");
    assert.equal(r.latest, "9.9.9");
    assert.equal(r.cli.status, "source");
    assert.equal(r.skill.status, "not_installed");
    assert.equal(r.server.status, "not_owner", "a connected machine never redeploys the server");
  });
});
