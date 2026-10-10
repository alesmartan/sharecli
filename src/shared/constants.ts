// Shared between the CLI and the Worker. Keep this file free of runtime-specific APIs.

/** Lowercase letters and digits without look-alikes (0/o, 1/l/i). */
export const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export const GENERATED_SLUG_LENGTH = 6;
export const GENERATED_PASSCODE_LENGTH = 6;

/** Custom slugs: 3-64 chars, lowercase letters, digits and inner dashes. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
/** Generated slugs can be shorter than custom ones, so accept both when parsing URLs. */
export const ANY_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const PASSCODE_RE = /^[A-Za-z0-9]{4,64}$/;

/** First path segments the Worker owns, so they can never be slugs. */
export const RESERVED_SLUGS = new Set([
  "api",
  "_assets",
  "assets",
  "robots.txt",
  "favicon.ico",
  "favicon.svg",
  "health",
  "admin",
  "login",
  "setup",
]);

export const DEFAULT_TTL_DAYS = 30;
export const DEFAULT_KEEP_VERSIONS = 5;
/** Workers on the free plan accept request bodies up to 100 MB. */
export const MAX_FILE_BYTES = 95 * 1024 * 1024;

export type ShareKind = "html" | "site" | "markdown" | "file";

export interface ManifestFile {
  path: string;
  size: number;
  type: string;
}

export interface Manifest {
  kind: ShareKind;
  /** File served at the share's root: index.html, report.md, photo.png. */
  entry: string;
  title?: string;
  files: ManifestFile[];
}

/** The share object returned by the API. */
export interface Share {
  slug: string;
  url: string;
  kind: ShareKind;
  title: string | null;
  entry: string;
  private: boolean;
  passcode: string | null;
  permanent: boolean;
  ttl_seconds: number | null;
  expires_at: string | null;
  expired: boolean;
  created_at: string;
  updated_at: string;
  version: number;
  size: number;
  files: number;
  views: number;
  last_viewed_at: string | null;
}

export interface ShareVersion {
  version: number;
  kind: ShareKind;
  entry: string;
  title: string | null;
  size: number;
  files: number;
  created_at: string;
  current: boolean;
}

export interface ShareDetail extends Share {
  versions: ShareVersion[];
  views_7d: number;
  views_daily: { day: string; count: number }[];
}

export interface Usage {
  shares: number;
  private: number;
  permanent: number;
  expiring_7d: number;
  storage_bytes: number;
  storage_limit_bytes: number;
  views_today: number;
  views_total: number;
  requests_per_day_limit: number;
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  zip: "application/zip",
  gz: "application/gzip",
};

export function mimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

/** Relative upload paths: no leading slash, no `..`, no empty or dot segments. */
export function isSafePath(path: string): boolean {
  if (!path || path.length > 512 || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}
