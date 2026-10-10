import {
  GENERATED_PASSCODE_LENGTH,
  GENERATED_SLUG_LENGTH,
  MAX_FILE_BYTES,
  PASSCODE_RE,
  RESERVED_SLUGS,
  SLUG_RE,
  ANY_SLUG_RE,
  isSafePath,
  mimeType,
  type Manifest,
  type ShareDetail,
  type ShareKind,
  type Usage,
} from "../shared/constants";
import { generatePasscode, randomString, safeEqual } from "./crypto";
import {
  type Env,
  type ShareRow,
  defaultTtlSeconds,
  deletePrefix,
  deleteShare,
  getLiveShare,
  getShareRow,
  keepVersions,
  listLiveShares,
  listVersions,
  measurePrefix,
  toShare,
  toVersion,
  utcDay,
  versionPrefix,
} from "./db";
import { VERSION } from "../shared/version";

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const KINDS: ShareKind[] = ["html", "site", "markdown", "file"];

export async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  try {
    const path = url.pathname.replace(/^\/api/, "") || "/";

    if (path === "/health" && req.method === "GET") {
      return json({ sharecli: true, version: VERSION, configured: Boolean(env.API_TOKEN && env.SECRET) });
    }

    await authorize(req, env);
    const origin = url.origin;
    const parts = path.split("/").filter(Boolean);
    const m = req.method;

    if (parts[0] === "usage" && parts.length === 1 && m === "GET") return json(await usage(env));
    if (parts[0] !== "shares") throw new ApiError(404, "not_found", `No API route for ${m} ${url.pathname}`);

    if (parts.length === 1) {
      if (m === "GET") return json({ shares: (await listLiveShares(env.DB)).map((r) => toShare(r, origin)) });
      if (m === "POST") return json(await createShare(req, env), 201);
    }

    const slug = parts[1];
    if (!slug || !ANY_SLUG_RE.test(slug)) throw new ApiError(400, "bad_slug", "Invalid slug");

    if (parts.length === 2) {
      if (m === "GET") return json(await shareDetail(env, slug, origin));
      if (m === "PATCH") return json(await updateShare(req, env, slug, origin));
      if (m === "DELETE") {
        await requireShare(env, slug);
        await deleteShare(env, slug);
        return json({ deleted: slug });
      }
    }

    if (parts[2] === "versions") {
      if (parts.length === 3) {
        if (m === "GET") {
          const share = await requireShare(env, slug);
          return json({ versions: (await listVersions(env.DB, slug)).map((v) => toVersion(v, share.version)) });
        }
        if (m === "POST") return json(await createVersion(req, env, slug), 201);
      }
      const version = Number(parts[3]);
      if (!Number.isInteger(version) || version < 1) throw new ApiError(400, "bad_version", "Invalid version");
      if (parts[4] === "files" && parts.length > 5 && m === "PUT") {
        return json(await uploadFile(req, env, slug, version, parts.slice(5).map(decodeURIComponent).join("/")));
      }
      if (parts[4] === "commit" && parts.length === 5 && m === "POST") {
        return json(await commitVersion(req, env, slug, version, origin));
      }
    }

    if (parts[2] === "rollback" && parts.length === 3 && m === "POST") {
      return json(await rollback(req, env, slug, origin));
    }

    throw new ApiError(404, "not_found", `No API route for ${m} ${url.pathname}`);
  } catch (err) {
    if (err instanceof ApiError) return json({ error: { code: err.code, message: err.message } }, err.status);
    console.error(err);
    return json({ error: { code: "internal", message: String((err as Error)?.message ?? err) } }, 500);
  }
}

async function authorize(req: Request, env: Env): Promise<void> {
  if (!env.API_TOKEN || !env.SECRET) {
    throw new ApiError(503, "not_configured", "Server secrets are missing. Run `share setup` again.");
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !(await safeEqual(token, env.API_TOKEN))) {
    throw new ApiError(401, "unauthorized", "Invalid API token. Check `share config` or run `share connect`.");
  }
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "bad_json", "Request body must be JSON");
  }
}

async function requireShare(env: Env, slug: string): Promise<ShareRow> {
  const row = await getShareRow(env.DB, slug);
  if (!row) throw new ApiError(404, "share_not_found", `No share named ${slug}`);
  return row;
}

function checkManifest(m: Manifest | undefined): Manifest {
  if (!m || !KINDS.includes(m.kind)) throw new ApiError(400, "bad_manifest", "manifest.kind is missing or invalid");
  if (!isSafePath(m.entry)) throw new ApiError(400, "bad_manifest", "manifest.entry must be a relative path");
  if (!Array.isArray(m.files) || !m.files.some((f) => f.path === m.entry)) {
    throw new ApiError(400, "bad_manifest", "manifest.files must include the entry file");
  }
  for (const f of m.files) {
    if (!isSafePath(f.path)) throw new ApiError(400, "bad_manifest", `Unsafe file path: ${f.path}`);
    if (f.size > MAX_FILE_BYTES) throw new ApiError(413, "too_large", `${f.path} is larger than 95 MB`);
  }
  return m;
}

function checkPasscode(passcode: unknown): string {
  if (typeof passcode !== "string" || !PASSCODE_RE.test(passcode)) {
    throw new ApiError(400, "bad_passcode", "Passcode must be 4-64 letters or digits");
  }
  return passcode;
}

/** Resolves ttl options into the stored pair. `undefined` means "leave as is". */
function resolveTtl(
  env: Env,
  opts: { ttl_seconds?: number | null; permanent?: boolean },
): { ttl_seconds: number | null } | undefined {
  if (opts.permanent) return { ttl_seconds: null };
  if (opts.ttl_seconds === undefined || opts.ttl_seconds === null) return undefined;
  if (!Number.isFinite(opts.ttl_seconds) || opts.ttl_seconds < 60) {
    throw new ApiError(400, "bad_ttl", "ttl_seconds must be at least 60");
  }
  return { ttl_seconds: Math.round(opts.ttl_seconds) };
}

interface CreateBody {
  slug?: string;
  private?: boolean;
  passcode?: string;
  ttl_seconds?: number;
  permanent?: boolean;
  manifest: Manifest;
}

async function createShare(req: Request, env: Env) {
  const b = await body<CreateBody>(req);
  const manifest = checkManifest(b.manifest);
  const now = Date.now();
  const passcode = b.passcode !== undefined ? checkPasscode(b.passcode) : b.private ? generatePasscode(GENERATED_PASSCODE_LENGTH) : null;
  const isPrivate = Boolean(b.private || b.passcode !== undefined);
  const ttl = resolveTtl(env, b)?.ttl_seconds ?? (b.permanent ? null : defaultTtlSeconds(env));

  let slug = b.slug?.toLowerCase();
  if (slug !== undefined) {
    if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) {
      throw new ApiError(400, "bad_slug", "Slug must be 3-64 lowercase letters, digits or dashes and not a reserved word");
    }
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = slug ?? randomString(GENERATED_SLUG_LENGTH);
    const res = await env.DB.prepare(
      `INSERT INTO shares (slug, version, next_version, private, passcode, ttl_seconds, expires_at, created_at, updated_at)
       VALUES (?, 0, 2, ?, ?, ?, NULL, ?, ?) ON CONFLICT (slug) DO NOTHING`,
    )
      .bind(candidate, isPrivate ? 1 : 0, passcode, ttl, now, now)
      .run();
    if (res.meta.changes === 1) {
      await insertVersion(env, candidate, 1, manifest, now);
      return { slug: candidate, version: 1, passcode };
    }
    if (slug) throw new ApiError(409, "slug_taken", `The slug ${slug} is already in use`);
  }
  throw new ApiError(500, "slug_exhausted", "Could not find a free slug, try again");
}

function insertVersion(env: Env, slug: string, version: number, m: Manifest, now: number) {
  return env.DB.prepare(
    "INSERT INTO versions (slug, version, kind, entry, title, size, files, committed, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)",
  )
    .bind(slug, version, m.kind, m.entry, m.title?.slice(0, 300) ?? null, now)
    .run();
}

async function createVersion(req: Request, env: Env, slug: string) {
  const b = await body<{ manifest: Manifest }>(req);
  const manifest = checkManifest(b.manifest);
  await requireShare(env, slug);
  const row = await env.DB.prepare(
    "UPDATE shares SET next_version = next_version + 1 WHERE slug = ? RETURNING next_version - 1 AS version",
  )
    .bind(slug)
    .first<{ version: number }>();
  if (!row) throw new ApiError(404, "share_not_found", `No share named ${slug}`);
  await insertVersion(env, slug, row.version, manifest, Date.now());
  return { slug, version: row.version };
}

async function pendingVersion(env: Env, slug: string, version: number) {
  const v = await env.DB.prepare("SELECT * FROM versions WHERE slug = ? AND version = ?")
    .bind(slug, version)
    .first<{ committed: number; entry: string }>();
  if (!v) throw new ApiError(404, "version_not_found", `Version ${version} of ${slug} does not exist`);
  if (v.committed) throw new ApiError(409, "version_committed", `Version ${version} is already live; upload a new version`);
  return v;
}

async function uploadFile(req: Request, env: Env, slug: string, version: number, path: string) {
  if (!isSafePath(path)) throw new ApiError(400, "bad_path", `Unsafe file path: ${path}`);
  await pendingVersion(env, slug, version);
  if (!req.body) throw new ApiError(400, "empty_body", "File body is missing");
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_FILE_BYTES) throw new ApiError(413, "too_large", `${path} is larger than 95 MB`);
  const type = req.headers.get("content-type") || mimeType(path);
  const obj = await env.BUCKET.put(versionPrefix(slug, version) + path, req.body, {
    httpMetadata: { contentType: type },
  });
  return { path, size: obj?.size ?? length };
}

async function commitVersion(req: Request, env: Env, slug: string, version: number, origin: string) {
  const b: { ttl_seconds?: number; permanent?: boolean } = await body<object>(req).catch(() => ({}));
  const share = await requireShare(env, slug);
  const v = await pendingVersion(env, slug, version);
  const prefix = versionPrefix(slug, version);
  if (!(await env.BUCKET.head(prefix + v.entry))) {
    throw new ApiError(400, "missing_entry", `Upload ${v.entry} before committing`);
  }
  const { size, files } = await measurePrefix(env.BUCKET, prefix);
  const now = Date.now();
  const ttl = resolveTtl(env, b);
  const ttlSeconds = ttl ? ttl.ttl_seconds : share.ttl_seconds;
  // Every update restarts the expiry clock; permanent shares stay permanent.
  const expiresAt = ttlSeconds == null ? null : now + ttlSeconds * 1000;

  await env.DB.batch([
    env.DB.prepare("UPDATE versions SET committed = 1, size = ?, files = ? WHERE slug = ? AND version = ?").bind(size, files, slug, version),
    env.DB.prepare("UPDATE shares SET version = ?, ttl_seconds = ?, expires_at = ?, updated_at = ? WHERE slug = ?").bind(
      version,
      ttlSeconds,
      expiresAt,
      now,
      slug,
    ),
  ]);
  await pruneVersions(env, slug, version);
  const live = await getLiveShare(env.DB, slug);
  return toShare(live!, origin);
}

/** Keeps the newest N committed versions (and always the live one). */
async function pruneVersions(env: Env, slug: string, current: number) {
  const versions = await listVersions(env.DB, slug);
  const keep = keepVersions(env);
  const stale = versions.slice(keep).filter((v) => v.version !== current);
  for (const v of stale) {
    await deletePrefix(env.BUCKET, versionPrefix(slug, v.version));
    await env.DB.prepare("DELETE FROM versions WHERE slug = ? AND version = ?").bind(slug, v.version).run();
  }
}

async function rollback(req: Request, env: Env, slug: string, origin: string) {
  const b = await body<{ version?: number }>(req).catch(() => ({}) as { version?: number });
  const share = await requireShare(env, slug);
  const versions = await listVersions(env.DB, slug);
  const target =
    b.version !== undefined
      ? versions.find((v) => v.version === b.version)
      : versions.find((v) => v.version < share.version);
  if (!target) {
    throw new ApiError(
      404,
      "version_not_found",
      b.version !== undefined ? `Version ${b.version} is not available` : "There is no earlier version to roll back to",
    );
  }
  await env.DB.prepare("UPDATE shares SET version = ?, updated_at = ? WHERE slug = ?").bind(target.version, Date.now(), slug).run();
  return toShare((await getLiveShare(env.DB, slug))!, origin);
}

interface PatchBody {
  private?: boolean;
  passcode?: string;
  regenerate_passcode?: boolean;
  ttl_seconds?: number;
  permanent?: boolean;
  extend?: boolean;
  title?: string;
}

async function updateShare(req: Request, env: Env, slug: string, origin: string) {
  const b = await body<PatchBody>(req);
  const share = await requireShare(env, slug);
  if (share.version === 0) throw new ApiError(404, "share_not_found", `No share named ${slug}`);
  const now = Date.now();
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };

  let passcode = share.passcode;
  if (b.passcode !== undefined) passcode = checkPasscode(b.passcode);
  else if (b.regenerate_passcode || (b.private && !passcode)) passcode = generatePasscode(GENERATED_PASSCODE_LENGTH);
  if (passcode !== share.passcode) set("passcode", passcode);
  if (b.private !== undefined) set("private", b.private ? 1 : 0);

  const ttl = resolveTtl(env, b);
  if (ttl) {
    set("ttl_seconds", ttl.ttl_seconds);
    set("expires_at", ttl.ttl_seconds == null ? null : now + ttl.ttl_seconds * 1000);
  } else if (b.extend && share.ttl_seconds != null) {
    // Restarts the clock; permanent shares have no clock and stay permanent.
    set("expires_at", now + share.ttl_seconds * 1000);
  }

  const statements: D1PreparedStatement[] = [];
  if (sets.length) {
    set("updated_at", now);
    statements.push(env.DB.prepare(`UPDATE shares SET ${sets.join(", ")} WHERE slug = ?`).bind(...args, slug));
  }
  if (b.title !== undefined) {
    statements.push(
      env.DB.prepare("UPDATE versions SET title = ? WHERE slug = ? AND version = ?").bind(b.title.slice(0, 300) || null, slug, share.version),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return toShare((await getLiveShare(env.DB, slug))!, origin);
}

async function shareDetail(env: Env, slug: string, origin: string): Promise<ShareDetail> {
  const live = await getLiveShare(env.DB, slug);
  if (!live) throw new ApiError(404, "share_not_found", `No share named ${slug}`);
  const since = utcDay(Date.now() - 6 * 86400_000);
  const [versions, daily] = await Promise.all([
    listVersions(env.DB, slug),
    env.DB.prepare("SELECT day, count FROM views_daily WHERE slug = ? AND day >= ? ORDER BY day").bind(slug, since).all<{ day: string; count: number }>(),
  ]);
  return {
    ...toShare(live, origin),
    versions: versions.map((v) => toVersion(v, live.version)),
    views_7d: daily.results.reduce((n, d) => n + d.count, 0),
    views_daily: daily.results,
  };
}

async function usage(env: Env): Promise<Usage> {
  const now = Date.now();
  const [counts, storage, today] = await env.DB.batch<Record<string, number | null>>([
    env.DB.prepare(
      `SELECT COUNT(*) AS shares, SUM(private) AS private, SUM(expires_at IS NULL) AS permanent,
              SUM(expires_at IS NOT NULL AND expires_at <= ?) AS expiring, SUM(views) AS views
       FROM shares WHERE version > 0`,
    ).bind(now + 7 * 86400_000),
    env.DB.prepare("SELECT SUM(size) AS bytes FROM versions WHERE committed = 1"),
    env.DB.prepare("SELECT SUM(count) AS views FROM views_daily WHERE day = ?").bind(utcDay(now)),
  ]);
  const c = counts.results[0] ?? {};
  return {
    shares: c.shares ?? 0,
    private: c.private ?? 0,
    permanent: c.permanent ?? 0,
    expiring_7d: c.expiring ?? 0,
    storage_bytes: storage.results[0]?.bytes ?? 0,
    storage_limit_bytes: 10 * 1024 ** 3,
    views_today: today.results[0]?.views ?? 0,
    views_total: c.views ?? 0,
    requests_per_day_limit: 100_000,
  };
}
