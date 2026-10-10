import { type Env, deletePrefix, deleteShare, utcDay, versionPrefix } from "./db";

const DAY = 86400_000;
/** Each run stays well under the free plan's per-invocation subrequest limit. */
const BATCH = 50;

/** Runs from the cron trigger: removes expired shares, abandoned uploads and old stats. */
export async function cleanup(env: Env): Promise<{ expired: number; abandoned: number }> {
  const now = Date.now();

  const { results: expired } = await env.DB.prepare(
    "SELECT slug FROM shares WHERE expires_at IS NOT NULL AND expires_at <= ? LIMIT ?",
  )
    .bind(now, BATCH)
    .all<{ slug: string }>();
  for (const { slug } of expired) await deleteShare(env, slug);

  // Shares whose first upload never finished.
  const { results: emptyShares } = await env.DB.prepare(
    "SELECT slug FROM shares WHERE version = 0 AND created_at < ? LIMIT ?",
  )
    .bind(now - DAY, BATCH)
    .all<{ slug: string }>();
  for (const { slug } of emptyShares) await deleteShare(env, slug);

  // Updates that were started but never committed.
  const { results: pending } = await env.DB.prepare(
    "SELECT slug, version FROM versions WHERE committed = 0 AND created_at < ? LIMIT ?",
  )
    .bind(now - DAY, BATCH)
    .all<{ slug: string; version: number }>();
  for (const v of pending) {
    await deletePrefix(env.BUCKET, versionPrefix(v.slug, v.version));
    await env.DB.prepare("DELETE FROM versions WHERE slug = ? AND version = ?").bind(v.slug, v.version).run();
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM unlock_attempts WHERE window_start < ?").bind(now - DAY),
    env.DB.prepare("DELETE FROM views_daily WHERE day < ?").bind(utcDay(now - 90 * DAY)),
  ]);

  return { expired: expired.length, abandoned: emptyShares.length + pending.length };
}
