import { VERSION } from "../shared/version";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** JSON that is safe to place inside a <script> element. */
const scriptJson = (data: unknown) =>
  JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

const FONT = `/_assets/fonts/source-serif-4-latin-opsz-normal.woff2`;

const BASE_HEAD = `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/_assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="${FONT}" as="font" type="font/woff2" crossorigin>`;

/** Small pages (passcode, expired, not found) share this inline stylesheet. */
const PAGE_CSS = `
@font-face{font-family:"Source Serif 4";font-style:normal;font-weight:200 900;font-display:swap;src:url(${FONT}) format("woff2")}
:root{--paper:#fff;--ink:#17191e;--muted:#5f6673;--rule:#e4e7ec;--wash:#f4f6f9;--link:#2747c7;--danger:#b42318;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--paper:#131519;--ink:#e6e8ec;--muted:#959ca8;--rule:#2a2e36;--wash:#1b1e23;--link:#94a9ff;--danger:#ff8a80}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--paper);color:var(--ink)}
body{font:17px/1.6 "Source Serif 4",Georgia,serif;font-optical-sizing:auto;min-height:100vh;display:flex;flex-direction:column}
main{width:100%;max-width:27rem;margin:0 auto;padding:22vh 1.5rem 3rem;flex:1}
h1{font-size:2.1rem;line-height:1.15;font-weight:620;letter-spacing:-.015em;margin:.9rem 0 .6rem}
p{margin:0 0 1.4rem;color:var(--muted)}
a{color:var(--link)}
.glyph{width:2.25rem;height:2.25rem;color:var(--muted)}
form{display:flex;gap:.5rem;margin-top:1.6rem}
input{flex:1;min-width:0;font:500 1.15rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;padding:.8rem .9rem;border:1px solid var(--rule);border-radius:10px;background:var(--wash);color:var(--ink)}
input:focus{outline:2px solid var(--link);outline-offset:1px;border-color:transparent}
button{font:600 .95rem/1 system-ui,-apple-system,"Segoe UI",sans-serif;padding:0 1.15rem;border:0;border-radius:10px;background:var(--ink);color:var(--paper);cursor:pointer}
button:hover{opacity:.88}
button:focus-visible{outline:2px solid var(--link);outline-offset:2px}
.error{color:var(--danger);font:500 .9rem/1.4 system-ui,-apple-system,sans-serif;margin:.8rem 0 0}
footer{padding:1.5rem;text-align:center;font:.8rem/1 system-ui,-apple-system,sans-serif;color:var(--muted)}
footer a{color:inherit;text-decoration:none}
footer a:hover{text-decoration:underline}`;

const LOCK = `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none"/></svg>`;
const CLOCK = `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`;
const BLANK = `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/></svg>`;

function page(opts: { title: string; host: string; body: string; status: number; head?: string }): Response {
  const html = `<!doctype html>
<html lang="en">
<head>${BASE_HEAD}
<title>${esc(opts.title)}</title>
${opts.head ?? ""}
<style>${PAGE_CSS}</style>
</head>
<body>
<main>${opts.body}</main>
<footer><a href="/">${esc(opts.host)}</a></footer>
</body>
</html>`;
  return new Response(html, {
    status: opts.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
    },
  });
}

export function gatePage(opts: { host: string; action: string; next: string; error?: string; status?: number }) {
  return page({
    title: "Protected page",
    host: opts.host,
    status: opts.status ?? 401,
    head: `<meta property="og:title" content="Protected page"><meta property="og:description" content="Open the link and enter the passcode you were sent."><meta property="og:site_name" content="${esc(opts.host)}">`,
    body: `${LOCK}
<h1>This page is protected</h1>
<p>Enter the passcode you were sent with the link.</p>
<form method="post" action="${esc(opts.action)}">
  <input type="hidden" name="next" value="${esc(opts.next)}">
  <input name="passcode" aria-label="Passcode" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus required minlength="4" maxlength="64" placeholder="passcode">
  <button type="submit">Open page</button>
</form>
${opts.error ? `<p class="error" role="alert">${esc(opts.error)}</p>` : ""}`,
  });
}

export function expiredPage(host: string) {
  return page({
    title: "Link expired",
    host,
    status: 410,
    body: `${CLOCK}<h1>This link has expired</h1><p>Shared pages are removed after a while. Ask the person who sent it for a new link.</p>`,
  });
}

export function notFoundPage(host: string) {
  return page({
    title: "Nothing here",
    host,
    status: 404,
    body: `${BLANK}<h1>Nothing is shared here</h1><p>Check the link for typos, or ask the person who sent it for a new one.</p>`,
  });
}

export function homePage(host: string) {
  return page({
    title: host,
    host,
    status: 200,
    body: `${BLANK}<h1>${esc(host)}</h1><p>Pages shared with <a href="https://github.com/alesmartan/sharecli">sharecli</a>. Open a full link to see one.</p>`,
  });
}

export interface MarkdownViewerData {
  slug: string;
  title: string;
  filename: string;
  markdown: string;
  updatedAt: string;
  expiresAt: string | null;
}

export function markdownPage(host: string, d: MarkdownViewerData, headers: HeadersInit): Response {
  const v = encodeURIComponent(VERSION);
  const data = {
    slug: d.slug,
    base: `/${d.slug}/`,
    filename: d.filename,
    markdown: d.markdown,
    updatedAt: d.updatedAt,
    expiresAt: d.expiresAt,
  };
  const html = `<!doctype html>
<html lang="en">
<head>${BASE_HEAD}
<title>${esc(d.title)}</title>
<meta property="og:title" content="${esc(d.title)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(host)}">
<script>try{var t=localStorage.getItem("sharecli-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<link rel="stylesheet" href="/_assets/viewer.css?v=${v}">
</head>
<body>
<header class="bar">
  <a class="bar-host" href="/${esc(d.slug)}">${esc(host)}</a>
  <div class="bar-actions">
    <a class="btn" href="/${esc(d.slug)}/raw" download="${esc(d.filename)}">Download<span class="wide"> .md</span></a>
    <button class="btn" type="button" data-copy-link>Copy<span class="wide"> link</span></button>
    <button class="btn btn-icon" type="button" data-theme-toggle aria-label="Switch light or dark theme" title="Switch theme">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>
    </button>
  </div>
</header>
<div class="layout">
  <main class="doc" id="doc"><noscript><pre class="raw">${esc(d.markdown)}</pre></noscript></main>
  <nav class="toc" id="toc" aria-label="On this page" hidden></nav>
</div>
<script id="sharecli-data" type="application/json">${scriptJson(data)}</script>
<script src="/_assets/viewer.js?v=${v}" defer></script>
</body>
</html>`;
  const h = new Headers(headers);
  h.set("content-type", "text/html; charset=utf-8");
  return new Response(html, { status: 200, headers: h });
}
