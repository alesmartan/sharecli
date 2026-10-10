import type { Share, ShareKind, ShareVersion } from "../shared/constants";

export interface Env {
  BUCKET: R2Bucket;
  DB: D1Database;
  ASSETS: Fetcher;
  API_TOKEN?: string;
  SECRET?: string;
  DEFAULT_TTL_DAYS?: string;
  KEEP_VERSIONS?: string;
}

export interface ShareRow {
  slug: string;
  version: number;
  next_version: number;
  private: number;
  passcode: string | null;
  ttl_seconds: number | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
  views: number;
  last_viewed_at: number | null;
}

export interface VersionRow {
  slug: string;
  version: number;
  kind: ShareKind;
  entry: string;
  title: string | null;
  size: number;
  files: number;
  committed: number;
  created_at: number;
}

/** A share joined with its current version. */
export type LiveShare = ShareRow & Pick<VersionRow, "kind" | "entry" | "title" | "size" | "files">;

const LIVE_SELECT = `
  SELECT s.*, v.kind, v.entry, v.title, v.size, v.files
  FROM shares s JOIN versions v ON v.slug = s.slug AND v.version = s.version`;

export function getLiveShare(db: D1Database, slug: string): Promise<LiveShare | null> {
  return db.prepare(`${LIVE_SELECT} WHERE s.slug = ?`).bind(slug).first<LiveShare>();
}

export async function listLiveShares(db: D1Database): Promise<LiveShare[]> {
  const { results } = await db.prepare(`${LIVE_SELECT} ORDER BY s.updated_at DESC`).all<LiveShare>();
  return results;
}

export function getShareRow(db: D1Database, slug: string): Promise<ShareRow | null> {
  return db.prepare("SELECT * FROM shares WHERE slug = ?").bind(slug).first<ShareRow>();
}

export async function listVersions(db: D1Database, slug: string): Promise<VersionRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM versions WHERE slug = ? AND committed = 1 ORDER BY version DESC")
    .bind(slug)
    .all<VersionRow>();
  return results;
}

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

export function shareUrl(origin: string, slug: string, kind: ShareKind): string {
  // Multi-file shares live under a trailing slash so relative paths resolve.
  return `${origin}/${slug}${kind === "site" ? "/" : ""}`;
}

export function isExpired(row: Pick<ShareRow, "expires_at">, now = Date.now()): boolean {
  return row.expires_at != null && row.expires_at <= now;
}

export function toShare(row: LiveShare, origin: string): Share {
  return {
    slug: row.slug,
    url: shareUrl(origin, row.slug, row.kind),
    kind: row.kind,
    title: row.title,
    entry: row.entry,
    private: row.private === 1,
    passcode: row.passcode,
    permanent: row.expires_at == null,
    ttl_seconds: row.ttl_seconds,
    expires_at: iso(row.expires_at),
    expired: isExpired(row),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
    version: row.version,
    size: row.size,
    files: row.files,
    views: row.views,
    last_viewed_at: iso(row.last_viewed_at),
  };
}

export function toVersion(row: VersionRow, current: number): ShareVersion {
  return {
    version: row.version,
    kind: row.kind,
    entry: row.entry,
    title: row.title,
    size: row.size,
    files: row.files,
    created_at: iso(row.created_at)!,
    current: row.version === current,
  };
}

export function utcDay(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function defaultTtlSeconds(env: Env): number {
  const days = Number(env.DEFAULT_TTL_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : 30) * 86400;
}

export function keepVersions(env: Env): number {
  const n = Number(env.KEEP_VERSIONS);
  return Number.isInteger(n) && n > 0 ? n : 5;
}

/** R2 keys for one version live under `<slug>/v<n>/`. */
export const versionPrefix = (slug: string, version: number) => `${slug}/v${version}/`;

export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function measurePrefix(bucket: R2Bucket, prefix: string): Promise<{ size: number; files: number }> {
  let size = 0;
  let files = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) {
      size += o.size;
      files += 1;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { size, files };
}

/** Removes a share completely: every stored file, every version, its stats. */
export async function deleteShare(env: Env, slug: string): Promise<void> {
  await deletePrefix(env.BUCKET, `${slug}/`);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM versions WHERE slug = ?").bind(slug),
    env.DB.prepare("DELETE FROM views_daily WHERE slug = ?").bind(slug),
    env.DB.prepare("DELETE FROM shares WHERE slug = ?").bind(slug),
  ]);
}
