// Renders a shared Markdown document in the browser. Bundled to /_assets/viewer.js.
import { Marked, type Tokens } from "marked";
import hljs from "highlight.js/lib/common";

interface ViewerData {
  slug: string;
  base: string;
  filename: string;
  markdown: string;
  updatedAt: string;
  expiresAt: string | null;
}

const data: ViewerData = JSON.parse(document.getElementById("sharecli-data")!.textContent!);
const doc = document.getElementById("doc")!;
const toc = document.getElementById("toc")!;

const isRelative = (href: string) => !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(href);
const resolve = (href: string) => (isRelative(href) ? data.base + href.replace(/^\.\//, "") : href);

function slugify(html: string, used: Map<string, number>): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const base =
    (tmp.textContent ?? "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-") || "section";
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function render(markdown: string): string {
  const used = new Map<string, number>();
  const marked = new Marked({ gfm: true });
  marked.use({
    walkTokens(token) {
      if (token.type === "image" || token.type === "link") {
        (token as Tokens.Image | Tokens.Link).href = resolve((token as Tokens.Image | Tokens.Link).href);
      }
    },
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const id = slugify(html, used);
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${html}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const language = (lang ?? "").split(/\s/)[0].toLowerCase();
        if (language === "mermaid") return `<pre class="mermaid">${escapeHtml(text)}</pre>\n`;
        const highlighted =
          language && hljs.getLanguage(language)
            ? hljs.highlight(text, { language, ignoreIllegals: true }).value
            : escapeHtml(text);
        const label = language ? `<span class="code-lang">${escapeHtml(language)}</span>` : "";
        return `<div class="code"><div class="code-head">${label}<button class="code-copy" type="button">Copy</button></div><pre><code class="hljs">${highlighted}</code></pre></div>\n`;
      },
      table(token) {
        // Wrap tables so wide ones scroll instead of breaking the layout.
        const header = token.header.map((cell) => this.tablecell(cell)).join("");
        const rows = token.rows.map((row) => `<tr>${row.map((cell) => this.tablecell(cell)).join("")}</tr>`).join("\n");
        return `<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
    },
  });
  return marked.parse(markdown, { async: false }) as string;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

function metaLine(): HTMLElement {
  const meta = document.createElement("p");
  meta.className = "doc-meta";
  const parts = [`Updated ${dateFmt.format(new Date(data.updatedAt))}`];
  if (data.expiresAt) {
    const days = Math.max(0, Math.ceil((Date.parse(data.expiresAt) - Date.now()) / 86400_000));
    parts.push(days <= 1 ? "Expires within a day" : `Expires in ${days} days`);
  }
  for (const text of parts) {
    const span = document.createElement("span");
    span.textContent = text;
    meta.append(span);
  }
  return meta;
}

function buildToc() {
  const headings = [...doc.querySelectorAll<HTMLHeadingElement>("h2, h3")];
  if (headings.length < 3) return;
  const title = document.createElement("p");
  title.className = "toc-title";
  title.textContent = "On this page";
  const list = document.createElement("ol");
  const links = new Map<Element, HTMLAnchorElement>();
  for (const h of headings) {
    const li = document.createElement("li");
    li.className = h.tagName === "H3" ? "toc-sub" : "";
    const a = document.createElement("a");
    a.href = `#${h.id}`;
    a.textContent = h.textContent!.replace(/^#/, "");
    li.append(a);
    list.append(li);
    links.set(h, a);
  }
  toc.append(title, list);
  toc.hidden = false;

  let current: HTMLAnchorElement | undefined;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        current?.removeAttribute("aria-current");
        current = links.get(e.target);
        current?.setAttribute("aria-current", "true");
      }
    },
    { rootMargin: "0px 0px -70% 0px" },
  );
  headings.forEach((h) => observer.observe(h));
}

function enhance() {
  for (const a of doc.querySelectorAll<HTMLAnchorElement>("a[href^='http']")) {
    if (new URL(a.href).host !== location.host) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  }
  doc.addEventListener("click", async (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>(".code-copy");
    if (!btn) return;
    await navigator.clipboard.writeText(btn.closest(".code")!.querySelector("pre")!.innerText);
    flash(btn, "Copied");
  });
}

function flash(btn: HTMLElement, text: string) {
  const original = btn.dataset.label ?? btn.textContent!;
  btn.dataset.label = original;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = original), 1400);
}

function currentTheme(): "light" | "dark" {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

async function renderMermaid() {
  const blocks = doc.querySelectorAll<HTMLElement>("pre.mermaid");
  if (!blocks.length) return;
  const url = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  const { default: mermaid } = await import(/* @vite-ignore */ url);
  mermaid.initialize({ startOnLoad: false, theme: currentTheme() === "dark" ? "dark" : "neutral", fontFamily: "inherit" });
  await mermaid.run({ nodes: blocks });
}

function wireBar() {
  document.querySelector<HTMLButtonElement>("[data-copy-link]")?.addEventListener("click", async (e) => {
    await navigator.clipboard.writeText(location.origin + location.pathname);
    flash(e.currentTarget as HTMLElement, "Copied");
  });
  document.querySelector<HTMLButtonElement>("[data-theme-toggle]")?.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("sharecli-theme", next);
    } catch {}
  });
}

doc.innerHTML = render(data.markdown);
const h1 = doc.querySelector("h1");
if (h1) h1.after(metaLine());
else doc.prepend(metaLine());
buildToc();
enhance();
wireBar();
renderMermaid().catch((err) => console.warn("mermaid failed", err));
if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
