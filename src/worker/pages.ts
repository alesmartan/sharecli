import { VERSION } from "../shared/version";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** JSON that is safe to place inside a <script> element. */
const scriptJson = (data: unknown) =>
  JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

const FONT = `/_assets/fonts/geist-latin-wght-normal.woff2`;
const REPO = "https://github.com/alesmartan/sharecli";
const GITHUB = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>`;

const BASE_HEAD = `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/_assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="${FONT}" as="font" type="font/woff2" crossorigin>`;

/** Small pages (passcode, expired, not found) share this inline stylesheet. */
const PAGE_CSS = `
@font-face{font-family:"Geist";font-style:normal;font-weight:100 900;font-display:swap;src:url(${FONT}) format("woff2")}
:root{--paper:#fff;--ink:#17191e;--muted:#5f6673;--rule:#e4e7ec;--wash:#f4f6f9;--link:#2747c7;--danger:#b42318;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--paper:#161616;--ink:#ececec;--muted:#9e9e9e;--rule:#2e2e2e;--wash:#1f1f1f;--link:#94a9ff;--danger:#ff8a80}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--paper);color:var(--ink)}
body{font:16px/1.6 "Geist",system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh;display:flex;flex-direction:column}
main{width:100%;max-width:27rem;margin:0 auto;padding:22vh 1.5rem 3rem;flex:1}
h1{font-size:2rem;line-height:1.15;font-weight:650;letter-spacing:-.035em;margin:.9rem 0 .6rem}
p{margin:0 0 1.4rem;color:var(--muted)}
a{color:var(--link)}
.glyph{width:2.25rem;height:2.25rem;color:var(--muted)}
form{display:flex;gap:.5rem;margin-top:1.6rem}
input{flex:1;min-width:0;font:500 1.15rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;padding:.8rem .9rem;border:1px solid var(--rule);border-radius:10px;background:var(--wash);color:var(--ink)}
input:focus{outline:2px solid var(--link);outline-offset:1px;border-color:transparent}
button{font:600 .95rem/1 "Geist",system-ui,-apple-system,"Segoe UI",sans-serif;padding:0 1.15rem;border:0;border-radius:10px;background:var(--ink);color:var(--paper);cursor:pointer}
button:hover{opacity:.88}
button:focus-visible{outline:2px solid var(--link);outline-offset:2px}
.error{color:var(--danger);font-size:.9rem;font-weight:500;line-height:1.4;margin:.8rem 0 0}
footer{display:flex;justify-content:center;align-items:center;gap:.6rem;padding:1.5rem;font-size:.8rem;line-height:1;color:var(--muted)}
footer a{display:inline-flex;align-items:center;gap:.35rem;color:inherit;text-decoration:none}
footer .sep{color:var(--rule)}
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
<footer><a href="/">${esc(opts.host)}</a><span class="sep">/</span><a href="${REPO}">${GITHUB}via sharecli</a></footer>
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
    body: `${BLANK}<h1>${esc(host)}</h1><p>Pages shared with <a href="${REPO}">sharecli</a>. Open a full link to see one.</p>`,
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
<script>try{var t=localStorage.getItem("sharecli-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>
<link rel="stylesheet" href="/_assets/viewer.css?v=${v}">
</head>
<body>
<header class="bar">
  <div class="bar-left">
    <a class="bar-host" href="/${esc(d.slug)}">${esc(host)}</a>
    <span class="bar-sep" aria-hidden="true">/</span>
    <a class="bar-via" href="${REPO}" title="sharecli on GitHub">${GITHUB}<span class="wide">via sharecli</span></a>
  </div>
  <div class="bar-actions">
    <a class="btn" href="/${esc(d.slug)}/raw" download="${esc(d.filename)}">Download<span class="wide"> .md</span></a>
    <button class="btn" type="button" data-copy-link>Copy<span class="wide"> link</span></button>
    <button class="btn btn-icon" type="button" data-theme-toggle aria-label="Theme" title="Theme">
      <svg class="theme-icon theme-system" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/></svg>
      <svg class="theme-icon theme-light" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>
      <svg class="theme-icon theme-dark" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>
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
