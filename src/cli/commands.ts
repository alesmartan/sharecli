import { ANY_SLUG_RE, PASSCODE_RE, type Share } from "../shared/constants";
import { Client } from "./client";
import { collect, type Collected } from "./collect";
import {
  CliError,
  c,
  confirm,
  copyToClipboard,
  formatBytes,
  formatDate,
  isInteractive,
  openUrl,
  parseTtl,
  printJson,
  relative,
  table,
  truncate,
} from "./ui";

export interface Flags {
  json?: boolean;
  private?: boolean;
  passcode?: string;
  ttl?: string;
  permanent?: boolean;
  slug?: string;
  title?: string;
  open?: boolean;
  "no-copy"?: boolean;
  yes?: boolean;
}

/** Accepts a slug or a full share URL. */
export function parseSlug(input: string | undefined): string {
  if (!input) throw new CliError("Missing share", "Pass a slug like k7p2xq or the full share URL.");
  let slug = input;
  if (/^https?:\/\//i.test(input)) {
    slug = new URL(input).pathname.split("/").filter(Boolean)[0] ?? "";
  }
  slug = slug.toLowerCase();
  if (!ANY_SLUG_RE.test(slug)) throw new CliError(`"${input}" is not a share slug or URL`);
  return slug;
}

function ttlOptions(flags: Flags): { ttl_seconds?: number; permanent?: boolean } {
  if (flags.permanent && flags.ttl) throw new CliError("Use either --ttl or --permanent, not both");
  if (flags.permanent) return { permanent: true };
  if (flags.ttl) {
    if (/^(never|permanent|forever)$/i.test(flags.ttl)) return { permanent: true };
    return { ttl_seconds: parseTtl(flags.ttl) };
  }
  return {};
}

function checkPasscode(passcode: string | undefined) {
  if (passcode !== undefined && !PASSCODE_RE.test(passcode)) {
    throw new CliError("Passcodes must be 4-64 letters or digits", "Example: --passcode friends24");
  }
}

const unlockUrl = (s: Share) => (s.private && s.passcode ? `${s.url}?k=${encodeURIComponent(s.passcode)}` : null);

const withExtras = (s: Share, extra: Record<string, unknown> = {}) => ({ ...s, unlock_url: unlockUrl(s), ...extra });

function expiryText(s: Share): string {
  if (s.permanent) return "never (permanent)";
  if (s.expired) return c.red("expired, removed within the hour");
  return `${relative(s.expires_at!)} (${formatDate(s.expires_at!)})`;
}

function printShareSummary(s: Share, verb: string) {
  console.log(`${c.green("✓")} ${verb}  ${c.bold(s.url)}`);
  const rows: [string, string][] = [];
  if (s.private) rows.push(["Passcode", c.bold(s.passcode ?? "")], ["Direct link", unlockUrl(s) ?? ""]);
  rows.push(["Expires", expiryText(s)]);
  for (const [k, v] of rows) console.log(`  ${c.dim(k.padEnd(12))}${v}`);
}

async function upload(client: Client, slug: string, version: number, collected: Collected, quiet: boolean) {
  const { files } = collected;
  const total = files.reduce((n, f) => n + f.size, 0);
  if (!quiet && files.length > 1) process.stderr.write(c.dim(`Uploading ${files.length} files (${formatBytes(total)})\n`));
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) await client.upload(slug, version, f.path, f.abs, f.type);
  };
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
}

function printWarnings(collected: Collected, json?: boolean) {
  if (json) return;
  for (const w of collected.warnings) process.stderr.write(`${c.dim("warning")} ${w}\n`);
}

async function afterPublish(share: Share, flags: Flags) {
  if (flags.json) return;
  if (!flags["no-copy"] && isInteractive()) {
    const text = share.private && share.passcode ? `${share.url}\nPasscode: ${share.passcode}` : share.url;
    if (await copyToClipboard(text)) console.log(c.dim(`  Copied ${share.private ? "link and passcode" : "link"} to the clipboard`));
  }
  if (flags.open) await openUrl(share.url);
}

export async function publish(path: string, flags: Flags) {
  checkPasscode(flags.passcode);
  const collected = collect(path, { title: flags.title });
  printWarnings(collected, flags.json);
  const client = Client.fromConfig();
  const created = await client.create({
    slug: flags.slug,
    private: flags.private || flags.passcode !== undefined,
    passcode: flags.passcode,
    ...ttlOptions(flags),
    manifest: collected.manifest,
  });
  await upload(client, created.slug, created.version, collected, Boolean(flags.json));
  const share = await client.commit(created.slug, created.version);
  if (flags.json) printJson(withExtras(share, { warnings: collected.warnings }));
  else printShareSummary(share, "Shared");
  await afterPublish(share, flags);
}

export async function update(target: string | undefined, path: string | undefined, flags: Flags) {
  const slug = parseSlug(target);
  checkPasscode(flags.passcode);
  const client = Client.fromConfig();
  let share: Share;
  let warnings: string[] = [];
  const access = flags.private || flags.passcode !== undefined ? { private: true, passcode: flags.passcode } : {};
  if (path) {
    const collected = collect(path, { title: flags.title });
    printWarnings(collected, flags.json);
    warnings = collected.warnings;
    const { version } = await client.createVersion(slug, collected.manifest);
    await upload(client, slug, version, collected, Boolean(flags.json));
    share = await client.commit(slug, version, ttlOptions(flags));
    if (access.private) share = await client.update(slug, access);
  } else {
    const patch = { ...ttlOptions(flags), title: flags.title, ...access };
    if (patch.title === undefined && patch.ttl_seconds === undefined && !patch.permanent && !patch.private) {
      throw new CliError("Nothing to update", "Pass a file or folder to upload, or --title, --ttl, --permanent, --private or --passcode.");
    }
    share = await client.update(slug, patch);
  }
  if (flags.json) printJson(withExtras(share, { warnings }));
  else printShareSummary(share, path ? `Updated to v${share.version}` : "Updated");
  if (path) await afterPublish(share, { ...flags, "no-copy": true });
}

export async function list(flags: Flags) {
  const shares = await Client.fromConfig().list();
  if (flags.json) return printJson(shares.map((s) => withExtras(s)));
  if (!shares.length) return console.log("Nothing shared yet. Share a file with `share <file>`.");
  table(
    shares.map((s) => [
      s.url,
      truncate(s.title ?? s.entry, 36),
      s.kind,
      s.private ? "private" : "public",
      s.permanent ? "permanent" : s.expired ? c.red("expired") : relative(s.expires_at!),
      String(s.views),
    ]),
    ["URL", "TITLE", "TYPE", "ACCESS", "EXPIRES", "VIEWS"],
  );
}

export async function info(target: string | undefined, flags: Flags) {
  const slug = parseSlug(target);
  const s = await Client.fromConfig().get(slug);
  if (flags.json) return printJson(withExtras(s));
  const live = s.versions.find((v) => v.current);
  const rows: [string, string][] = [
    ["Type", `${s.kind}, ${formatBytes(s.size)}, ${s.files} file${s.files === 1 ? "" : "s"}`],
    ["Access", s.private ? `private, passcode ${c.bold(s.passcode ?? "")}` : "public"],
    ...(s.private ? [["Direct link", unlockUrl(s)!] as [string, string]] : []),
    ["Expires", expiryText(s)],
    ["Created", formatDate(s.created_at)],
    ["Updated", `${formatDate(s.updated_at)} (${relative(s.updated_at)})`],
    [
      "Views",
      `${s.views} total, ${s.views_7d} in the last 7 days` + (s.last_viewed_at ? `, last ${relative(s.last_viewed_at)}` : ""),
    ],
    ["Versions", `${s.versions.length} kept, live is v${live?.version ?? s.version}`],
  ];
  console.log(c.bold(s.title ?? s.entry));
  console.log(s.url + "\n");
  for (const [k, v] of rows) console.log(`  ${c.dim(k.padEnd(12))}${v}`);
}

export async function remove(targets: string[], flags: Flags) {
  if (!targets.length) throw new CliError("Missing share", "Usage: share rm <slug|url> [more...]");
  const slugs = targets.map(parseSlug);
  if (!flags.yes) {
    if (!isInteractive()) {
      throw new CliError("Refusing to delete without --yes", "Deleting is permanent. Re-run with --yes to confirm.", "confirmation_required");
    }
    if (!(await confirm(`Delete ${slugs.join(", ")} and all of its versions?`, false))) return console.log("Nothing deleted.");
  }
  const client = Client.fromConfig();
  for (const slug of slugs) await client.remove(slug);
  if (flags.json) printJson({ deleted: slugs });
  else console.log(`${c.green("✓")} Deleted ${slugs.join(", ")}`);
}

export async function open(target: string | undefined) {
  const s = await Client.fromConfig().get(parseSlug(target));
  await openUrl(s.url);
  console.log(s.url);
}

export async function versions(target: string | undefined, flags: Flags) {
  const slug = parseSlug(target);
  const list = await Client.fromConfig().versions(slug);
  if (flags.json) return printJson(list);
  table(
    list.map((v) => [
      `v${v.version}${v.current ? c.green(" live") : ""}`,
      `${formatDate(v.created_at)} (${relative(v.created_at)})`,
      v.kind,
      formatBytes(v.size),
      truncate(v.title ?? v.entry, 40),
    ]),
    ["VERSION", "UPLOADED", "TYPE", "SIZE", "TITLE"],
  );
}

export async function rollback(target: string | undefined, versionArg: string | undefined, flags: Flags) {
  const slug = parseSlug(target);
  let version: number | undefined;
  if (versionArg !== undefined) {
    version = Number(versionArg.replace(/^v/i, ""));
    if (!Number.isInteger(version) || version < 1) throw new CliError(`"${versionArg}" is not a version number`, "Example: share rollback k7p2xq v2");
  }
  const share = await Client.fromConfig().rollback(slug, version);
  if (flags.json) printJson(withExtras(share));
  else console.log(`${c.green("✓")} ${share.url} now serves v${share.version}`);
}

export async function setAccess(target: string | undefined, makePrivate: boolean, flags: Flags) {
  const slug = parseSlug(target);
  checkPasscode(flags.passcode);
  const share = await Client.fromConfig().update(slug, makePrivate ? { private: true, passcode: flags.passcode } : { private: false });
  if (flags.json) return printJson(withExtras(share));
  if (makePrivate) printShareSummary(share, "Private");
  else console.log(`${c.green("✓")} ${share.url} is public. Anyone with the link can open it.`);
}

export async function passcode(target: string | undefined, value: string | undefined, flags: Flags) {
  const slug = parseSlug(target);
  checkPasscode(value);
  const share = await Client.fromConfig().update(
    slug,
    value !== undefined ? { private: true, passcode: value } : { private: true, regenerate_passcode: true },
  );
  if (flags.json) return printJson(withExtras(share));
  printShareSummary(share, "New passcode for");
  console.log(c.dim("  Anyone who unlocked the page before needs the new passcode."));
}

export async function extend(target: string | undefined, flags: Flags) {
  const slug = parseSlug(target);
  const opts = ttlOptions(flags);
  const share = await Client.fromConfig().update(slug, Object.keys(opts).length ? opts : { extend: true });
  if (flags.json) return printJson(withExtras(share));
  console.log(`${c.green("✓")} ${share.url} expires ${expiryText(share)}`);
}

export async function usage(flags: Flags) {
  const u = await Client.fromConfig().usage();
  if (flags.json) return printJson(u);
  const pct = ((u.storage_bytes / u.storage_limit_bytes) * 100).toFixed(u.storage_bytes / u.storage_limit_bytes < 0.1 ? 2 : 1);
  const n = (x: number) => x.toLocaleString("en");
  const rows: [string, string][] = [
    ["Shares", `${n(u.shares)} (${n(u.private)} private, ${n(u.permanent)} permanent, ${n(u.expiring_7d)} expiring this week)`],
    ["Storage", `${formatBytes(u.storage_bytes)} of the ${formatBytes(u.storage_limit_bytes)} free tier (${pct}%)`],
    ["Views", `${n(u.views_today)} today, ${n(u.views_total)} total`],
    ["Limit", `Cloudflare's free plan serves ${n(u.requests_per_day_limit)} requests a day`],
  ];
  for (const [k, v] of rows) console.log(`${c.dim(k.padEnd(10))}${v}`);
}
