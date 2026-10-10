import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { MAX_FILE_BYTES, mimeType, type Manifest, type ShareKind } from "../shared/constants";
import { CliError } from "./ui";

export interface LocalFile {
  path: string;
  abs: string;
  size: number;
  type: string;
}

export interface Collected {
  manifest: Manifest;
  files: LocalFile[];
  warnings: string[];
}

const MAX_FILES = 1000;
const HTML_EXT = new Set([".html", ".htm"]);
const MD_EXT = new Set([".md", ".markdown", ".mdx"]);

/**
 * Turns a path into an upload manifest:
 * - folder → "site" (needs index.html)
 * - .html → "html", or "site" when it references local files (images, CSS, other pages)
 * - .md → "markdown", plus any local images it references
 * - anything else → "file"
 */
export function collect(input: string, opts: { title?: string } = {}): Collected {
  const abs = resolve(input);
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    throw new CliError(`No such file or folder: ${input}`);
  }
  const warnings: string[] = [];

  if (stat.isDirectory()) {
    const files = walk(abs);
    const entry = files.find((f) => f.path === "index.html") ?? (files.filter((f) => HTML_EXT.has(extname(f.path))).length === 1 ? files.find((f) => HTML_EXT.has(extname(f.path))) : undefined);
    if (!entry) {
      throw new CliError(`${input} has no index.html`, "A shared folder needs an index.html at its top level. To share a single file, pass the file instead.");
    }
    return done("site", entry.path, files, opts.title ?? htmlTitle(entry.abs), warnings);
  }

  const ext = extname(abs).toLowerCase();
  const self = localFile(abs, basename(abs));
  const root = dirname(abs);

  if (HTML_EXT.has(ext)) {
    const refs = followRefs(abs, root, warnings);
    const title = opts.title ?? htmlTitle(abs);
    if (!refs.length) return done("html", self.path, [self], title, warnings);
    return done("site", self.path, [self, ...refs], title, warnings);
  }
  if (MD_EXT.has(ext)) {
    const refs = followRefs(abs, root, warnings);
    return done("markdown", self.path, [self, ...refs], opts.title ?? markdownTitle(abs) ?? basename(abs), warnings);
  }
  return done("file", self.path, [self], opts.title ?? basename(abs), warnings);
}

function done(kind: ShareKind, entry: string, files: LocalFile[], title: string | undefined, warnings: string[]): Collected {
  if (files.length > MAX_FILES) throw new CliError(`Too many files (${files.length}). The limit is ${MAX_FILES}.`);
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) throw new CliError(`${f.path} is ${Math.round(f.size / 1048576)} MB. Files must be under 95 MB.`);
  }
  return {
    manifest: { kind, entry, title, files: files.map(({ path, size, type }) => ({ path, size, type })) },
    files,
    warnings,
  };
}

function localFile(abs: string, path: string): LocalFile {
  return { path, abs, size: statSync(abs).size, type: mimeType(path) };
}

const toPosix = (p: string) => p.split(sep).join("/");

function walk(root: string): LocalFile[] {
  const out: LocalFile[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) visit(abs);
      else if (entry.isFile()) out.push(localFile(abs, toPosix(relative(root, abs))));
      if (out.length > MAX_FILES) throw new CliError(`Too many files in ${root}. The limit is ${MAX_FILES}.`);
    }
  };
  visit(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const ATTR_RE = /\s(?:src|href|poster|data-src|data)\s*=\s*(["'])(.*?)\1/gis;
const SRCSET_RE = /\s(?:srcset|data-srcset)\s*=\s*(["'])(.*?)\1/gis;
const CSS_URL_RE = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
const CSS_IMPORT_RE = /@import\s+(["'])(.*?)\1/gi;
const MD_LINK_RE = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g;
const MD_DEF_RE = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm;

function refsIn(text: string, ext: string): string[] {
  const refs: string[] = [];
  const add = (re: RegExp, group: number) => {
    for (const m of text.matchAll(re)) refs.push(m[group]);
  };
  if (HTML_EXT.has(ext) || MD_EXT.has(ext)) {
    add(ATTR_RE, 2);
    for (const m of text.matchAll(SRCSET_RE)) refs.push(...m[2].split(",").map((part) => part.trim().split(/\s+/)[0]));
    add(CSS_URL_RE, 2);
  }
  if (MD_EXT.has(ext)) {
    add(MD_LINK_RE, 1);
    add(MD_DEF_RE, 1);
  }
  if (ext === ".css") {
    add(CSS_URL_RE, 2);
    add(CSS_IMPORT_RE, 2);
  }
  return refs;
}

const isExternal = (ref: string) => /^([a-z][a-z0-9+.-]*:|\/\/|#|\{\{|\$\{)/i.test(ref) || ref === "";

/** Follows local references from an HTML, Markdown or CSS file, recursively, staying inside `root`. */
function followRefs(start: string, root: string, warnings: string[]): LocalFile[] {
  const seen = new Set<string>([start]);
  const found: LocalFile[] = [];
  const queue = [start];
  while (queue.length) {
    const file = queue.shift()!;
    const ext = extname(file).toLowerCase();
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const raw of refsIn(text, ext)) {
      const ref = raw.trim();
      if (isExternal(ref)) continue;
      let clean = ref.replace(/[?#].*$/, "");
      try {
        clean = decodeURI(clean);
      } catch {}
      if (!clean) continue;
      if (clean.startsWith("/")) {
        warnings.push(`${toPosix(relative(root, file))} links to ${ref}, which starts with "/" and will not resolve once shared. Use a relative path.`);
        continue;
      }
      const abs = resolve(dirname(file), clean);
      if (seen.has(abs)) continue;
      seen.add(abs);
      const rel = relative(root, abs);
      if (rel.startsWith("..")) {
        warnings.push(`Skipped ${ref}: it is outside ${root}. Share the parent folder instead, or move the file next to the page.`);
        continue;
      }
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        // Links like href="about" or anchors to routes are common; only warn for things that look like files.
        if (/\.[a-z0-9]{2,5}$/i.test(clean)) warnings.push(`${ref} is referenced but does not exist`);
        continue;
      }
      if (!stat.isFile()) continue;
      found.push(localFile(abs, toPosix(rel)));
      const childExt = extname(abs).toLowerCase();
      if (childExt === ".css" || HTML_EXT.has(childExt)) queue.push(abs);
    }
  }
  return found;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

function htmlTitle(abs: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(readFileSync(abs, "utf8"));
  const title = m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
  return title || undefined;
}

function markdownTitle(abs: string): string | undefined {
  const text = readFileSync(abs, "utf8");
  const front = /^---\n[\s\S]*?\btitle:\s*["']?(.+?)["']?\s*\n[\s\S]*?---/.exec(text);
  if (front) return front[1].trim();
  const m = /^#\s+(.+?)\s*#*\s*$/m.exec(text);
  return m ? m[1].replace(/[*_`]/g, "").trim() : undefined;
}
