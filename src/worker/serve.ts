import { ANY_SLUG_RE, RESERVED_SLUGS } from "../shared/constants";
import { hmac, safeEqual } from "./crypto";
import { type Env, type LiveShare, getLiveShare, isExpired, utcDay, versionPrefix } from "./db";
import { expiredPage, framePage, gatePage, homePage, markdownPage, notFoundPage } from "./pages";

const UNLOCK_MAX_ATTEMPTS = 10;
const UNLOCK_WINDOW_MS = 15 * 60_000;
const UNLOCK_COOKIE_SECONDS = 30 * 86400;

/** Link-preview fetchers and crawlers. Their requests are served but not counted as views. */
const BOT_UA =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|embedly|iframely|vkshare|skypeuripreview|bitlybot|quora|pinterest|headless|lighthouse|curl|wget|python-requests|go-http-client/i;

export async function handlePublic(req: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const host = url.host;
  if (url.protocol === "http:" && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }
  if (url.pathname === "/") return homePage(host);
  if (url.pathname === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain" } });
  }

  let segments: string[];
  try {
    segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
  } catch {
    return notFoundPage(host);
  }
  const slug = segments[0].toLowerCase();
  if (!ANY_SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) return notFoundPage(host);

  const share = await getLiveShare(env.DB, slug);
  if (!share) return notFoundPage(host);
  if (isExpired(share)) return expiredPage(host);

  const rest = segments.slice(1).join("/");

  if (share.private) {
    if (rest === "unlock" && req.method === "POST") return unlockFromForm(req, env, share, url);
    if (!(await hasUnlockCookie(req, env, share))) {
      const k = url.searchParams.get("k");
      if (k) return unlockFromQuery(req, env, share, url, k);
      return gatePage({ host, action: `/${slug}/unlock`, next: url.pathname });
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const res = await serveShare(req, env, ctx, share, rest, url);
  return req.method === "HEAD" ? new Response(null, res) : res;
}

async function serveShare(req: Request, env: Env, ctx: ExecutionContext, share: LiveShare, rest: string, url: URL) {
  const host = url.host;
  const prefix = versionPrefix(share.slug, share.version);
  const cacheControl = share.private ? "private, no-cache" : "public, no-cache";
  // A browser opening an HTML page gets the top bar with the page in a frame under it. The frame then
  // loads the same URL and gets the page itself, as do agents, curl and link previews.
  const dest = req.headers.get("sec-fetch-dest");
  const wantsFrame = req.method === "GET" && dest === "document" && !isBot(req);
  const countView = () => {
    if (req.method === "GET" && dest !== "iframe" && !isBot(req)) ctx.waitUntil(recordView(env, share.slug));
  };
  const frame = (filename?: string) =>
    framePage(host, { slug: share.slug, title: share.title || share.entry, src: url.pathname + url.search, filename }, framedHeaders(cacheControl));

  switch (share.kind) {
    case "html": {
      if (rest === "raw") return (await serveObject(req, env, prefix + share.entry, cacheControl, share.entry)) ?? notFoundPage(host);
      if (rest !== "") break;
      countView();
      if (wantsFrame) return frame(share.entry.split("/").pop());
      return framed(await serveObject(req, env, prefix + share.entry, cacheControl)) ?? notFoundPage(host);
    }
    case "site": {
      if (rest === "" && !url.pathname.endsWith("/")) return redirect(`/${share.slug}/${url.search}`);
      const key = rest === "" ? prefix + share.entry : prefix + (rest.endsWith("/") ? `${rest}index.html` : rest);
      if (rest === "") countView();
      if (wantsFrame && /\.html?$/i.test(key) && (await env.BUCKET.head(key))) return frame();
      const found = await serveObject(req, env, key, cacheControl);
      if (found) return /\.html?$/i.test(key) ? framed(found) : found;
      // `/slug/docs` → `/slug/docs/` when docs/index.html exists, so relative links keep working.
      if (rest !== "" && !rest.endsWith("/") && (await env.BUCKET.head(`${prefix}${rest}/index.html`))) {
        return redirect(`${url.pathname}/${url.search}`);
      }
      return notFoundPage(host);
    }
    case "markdown": {
      if (rest === "") {
        const obj = await env.BUCKET.get(prefix + share.entry);
        if (!obj) return notFoundPage(host);
        countView();
        return markdownPage(
          host,
          {
            slug: share.slug,
            title: share.title || share.entry,
            filename: share.entry.split("/").pop()!,
            markdown: await obj.text(),
            updatedAt: new Date(share.updated_at).toISOString(),
            expiresAt: share.expires_at == null ? null : new Date(share.expires_at).toISOString(),
          },
          baseHeaders(cacheControl),
        );
      }
      if (rest === "raw") return (await serveObject(req, env, prefix + share.entry, cacheControl, share.entry)) ?? notFoundPage(host);
      return (await serveObject(req, env, prefix + rest, cacheControl)) ?? notFoundPage(host);
    }
    case "file": {
      if (rest === "") {
        countView();
        return (await serveObject(req, env, prefix + share.entry, cacheControl)) ?? notFoundPage(host);
      }
      if (rest === "raw") return (await serveObject(req, env, prefix + share.entry, cacheControl, share.entry)) ?? notFoundPage(host);
      break;
    }
  }
  return notFoundPage(host);
}

function baseHeaders(cacheControl: string): Headers {
  return new Headers({
    "cache-control": cacheControl,
    "x-robots-tag": "noindex, nofollow",
    "x-content-type-options": "nosniff",
  });
}

/** The frame page and the page itself share a URL, so caches must keep them apart. */
function framedHeaders(cacheControl: string): Headers {
  const h = baseHeaders(cacheControl);
  h.set("vary", "Sec-Fetch-Dest");
  return h;
}

function framed<T extends Response | null>(res: T): T {
  res?.headers.append("vary", "Sec-Fetch-Dest");
  return res;
}

const redirect = (location: string, status = 301) => new Response(null, { status, headers: { location } });

/** Streams an R2 object with ETag revalidation and byte ranges. Returns null when the key is missing. */
async function serveObject(req: Request, env: Env, key: string, cacheControl: string, downloadAs?: string) {
  const obj = await env.BUCKET.get(key, { onlyIf: req.headers, range: req.headers });
  if (!obj) return null;
  const headers = baseHeaders(cacheControl);
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  if (downloadAs) {
    const name = downloadAs.split("/").pop()!;
    headers.set(
      "content-disposition",
      `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
  }
  if (!("body" in obj)) return new Response(null, { status: 304, headers });

  const range = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && req.headers.has("range")) {
    const start = range.suffix !== undefined ? obj.size - range.suffix : (range.offset ?? 0);
    const end = range.length !== undefined ? start + range.length - 1 : obj.size - 1;
    headers.set("content-range", `bytes ${start}-${end}/${obj.size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

function isBot(req: Request): boolean {
  const purpose = req.headers.get("sec-purpose") ?? req.headers.get("purpose") ?? "";
  return purpose.includes("prefetch") || BOT_UA.test(req.headers.get("user-agent") ?? "");
}

async function recordView(env: Env, slug: string) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE shares SET views = views + 1, last_viewed_at = ? WHERE slug = ?").bind(now, slug),
    env.DB.prepare(
      "INSERT INTO views_daily (slug, day, count) VALUES (?, ?, 1) ON CONFLICT (slug, day) DO UPDATE SET count = count + 1",
    ).bind(slug, utcDay(now)),
  ]);
}

// ---- Passcode gate ----------------------------------------------------------

const cookieName = (slug: string) => `sharecli_${slug.replace(/-/g, "_")}`;

/** The cookie proves the visitor knew the current passcode. Changing the passcode invalidates it. */
const unlockToken = (env: Env, share: LiveShare) => hmac(env.SECRET!, `unlock:${share.slug}:${share.passcode?.toLowerCase()}`);

async function hasUnlockCookie(req: Request, env: Env, share: LiveShare): Promise<boolean> {
  if (!env.SECRET || !share.passcode) return false;
  const name = cookieName(share.slug);
  const value = (req.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!value) return false;
  return safeEqual(value, await unlockToken(env, share));
}

async function unlockCookie(env: Env, share: LiveShare, url: URL): Promise<string> {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${cookieName(share.slug)}=${await unlockToken(env, share)}; Path=/${share.slug}; Max-Age=${UNLOCK_COOKIE_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

type UnlockResult = "ok" | "wrong" | "locked";

async function checkPasscode(req: Request, env: Env, share: LiveShare, input: string): Promise<UnlockResult> {
  if (!env.SECRET || !share.passcode) return "wrong";
  const now = Date.now();
  const ip = req.headers.get("cf-connecting-ip") ?? "local";
  // Rate limit per share and visitor. The IP is stored only as a keyed hash.
  const key = `${share.slug}:${(await hmac(env.SECRET, `ip:${ip}`)).slice(0, 22)}`;
  const row = await env.DB.prepare("SELECT count, window_start FROM unlock_attempts WHERE key = ?")
    .bind(key)
    .first<{ count: number; window_start: number }>();
  const windowOpen = row && row.window_start > now - UNLOCK_WINDOW_MS;
  if (windowOpen && row.count >= UNLOCK_MAX_ATTEMPTS) return "locked";

  // Passcodes are matched without case so phone keyboards that capitalise the first letter still work.
  if (await safeEqual(input.trim().toLowerCase(), share.passcode.toLowerCase())) {
    if (row) await env.DB.prepare("DELETE FROM unlock_attempts WHERE key = ?").bind(key).run();
    return "ok";
  }
  await env.DB.prepare(
    `INSERT INTO unlock_attempts (key, count, window_start) VALUES (?, 1, ?)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END`,
  )
    .bind(key, now, now - UNLOCK_WINDOW_MS, now - UNLOCK_WINDOW_MS)
    .run();
  return "wrong";
}

function gateError(result: UnlockResult): { error: string; status: number } {
  return result === "locked"
    ? { error: "Too many wrong passcodes. Try again in 15 minutes.", status: 429 }
    : { error: "Wrong passcode. Check it and try again.", status: 401 };
}

async function unlockFromForm(req: Request, env: Env, share: LiveShare, url: URL): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const input = String(form?.get("passcode") ?? "");
  const rawNext = String(form?.get("next") ?? "");
  const next = rawNext === `/${share.slug}` || rawNext.startsWith(`/${share.slug}/`) ? rawNext : `/${share.slug}`;
  const result = await checkPasscode(req, env, share, input);
  if (result !== "ok") {
    return gatePage({ host: url.host, action: `/${share.slug}/unlock`, next, ...gateError(result) });
  }
  return new Response(null, { status: 303, headers: { location: next, "set-cookie": await unlockCookie(env, share, url) } });
}

async function unlockFromQuery(req: Request, env: Env, share: LiveShare, url: URL, input: string): Promise<Response> {
  const result = await checkPasscode(req, env, share, input);
  if (result !== "ok") {
    return gatePage({ host: url.host, action: `/${share.slug}/unlock`, next: url.pathname, ...gateError(result) });
  }
  const clean = new URL(url);
  clean.searchParams.delete("k");
  return new Response(null, {
    status: 302,
    headers: { location: clean.pathname + clean.search, "set-cookie": await unlockCookie(env, share, url) },
  });
}
