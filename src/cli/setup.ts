import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TTL_DAYS } from "../shared/constants";
import { VERSION } from "../shared/version";
import { Client } from "./client";
import { type Config, type Deployment, configDir, configPath, readConfig, writeConfig } from "./config";
import { CliError, ask, c, choose, confirm, isInteractive, printJson, run } from "./ui";

export const SKILL_REPO = "alesmartan/sharecli";

export interface SetupFlags {
  domain?: string;
  "workers-dev"?: boolean;
  "account-id"?: string;
  name?: string;
  "ttl-days"?: string;
  "install-skill"?: boolean;
  "skip-skill"?: boolean;
  json?: boolean;
  token?: string;
  reveal?: boolean;
}

const step = (text: string) => console.log(`${c.cyan("›")} ${text}`);
const ok = (text: string) => console.log(`${c.green("✓")} ${text}`);

// ---- Wrangler ---------------------------------------------------------------

let wranglerCmd: { cmd: string; args: string[] } | undefined;

async function wrangler(args: string[], opts: { accountId?: string; capture?: boolean; input?: string } = {}) {
  if (!wranglerCmd) {
    const local = await run("wrangler", ["--version"], { capture: true }).catch(() => ({ code: 1 }));
    wranglerCmd = local.code === 0 ? { cmd: "wrangler", args: [] } : { cmd: "npx", args: ["--yes", "wrangler@4"] };
  }
  return run(wranglerCmd.cmd, [...wranglerCmd.args, ...args], {
    capture: opts.capture ?? true,
    input: opts.input,
    env: {
      ...(opts.accountId ? { CLOUDFLARE_ACCOUNT_ID: opts.accountId } : {}),
      // Captured runs can't answer prompts, so let wrangler take its defaults.
      ...(opts.capture === false ? {} : { CI: "1" }),
      WRANGLER_SEND_METRICS: "false",
    },
  });
}

const output = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`.trim();

function parseJson<T>(text: string, open: "[" | "{"): T {
  const start = text.indexOf(open);
  if (start === -1) throw new Error("no JSON in output");
  return JSON.parse(text.slice(start));
}

interface WhoAmI {
  loggedIn: boolean;
  email?: string;
  accounts?: { id: string; name: string }[];
}

async function whoami(): Promise<WhoAmI> {
  const r = await wrangler(["whoami", "--json"]);
  if (r.code !== 0) return { loggedIn: false };
  try {
    return parseJson<WhoAmI>(r.stdout, "{");
  } catch {
    return { loggedIn: false };
  }
}

// ---- Setup ------------------------------------------------------------------

const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function normalizeDomain(input: string): string {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!HOST_RE.test(host)) throw new CliError(`"${input}" is not a valid domain`, "Example: --domain s.example.com");
  return host;
}

const newSecret = (prefix: string) => prefix + randomBytes(32).toString("base64url");

const packagePath = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export async function setup(flags: SetupFlags) {
  const existing = readConfig();
  const previous = existing.deployment;
  const interactive = isInteractive();

  console.log(c.bold(`sharecli setup`) + c.dim(` v${VERSION}`));
  console.log(c.dim("Deploys your own share server to Cloudflare (Workers, R2 and D1, all on the free plan).\n"));

  // 1. Cloudflare login
  step("Checking your Cloudflare login");
  let me = await whoami();
  if (!me.loggedIn) {
    if (!interactive) {
      throw new CliError("You are not logged in to Cloudflare", "Run `npx wrangler login`, then run `share setup` again.", "cloudflare_login");
    }
    console.log("  A browser window will open so you can log in to Cloudflare.");
    await wrangler(["login"], { capture: false });
    me = await whoami();
    if (!me.loggedIn) throw new CliError("Cloudflare login did not complete", "Run `npx wrangler login` and try again.", "cloudflare_login");
  }
  ok(`Logged in${me.email ? ` as ${me.email}` : ""}`);

  // 2. Account
  const accounts = me.accounts ?? [];
  let accountId = flags["account-id"] ?? previous?.accountId;
  if (!accountId) {
    if (accounts.length === 1) accountId = accounts[0].id;
    else if (interactive && accounts.length > 1) {
      accountId = await choose(
        "Which Cloudflare account should host sharecli?",
        accounts.map((a) => ({ label: `${a.name} ${c.dim(a.id)}`, value: a.id })),
      );
    } else {
      const list = accounts.map((a) => `  ${a.id}  ${a.name}`).join("\n");
      throw new CliError("Your login has several Cloudflare accounts", `Pick one with --account-id:\n${list}`, "account_required");
    }
  }
  const accountName = accounts.find((a) => a.id === accountId)?.name ?? accountId;
  ok(`Account: ${accountName}`);

  // 3. Domain
  let domain: string | null;
  if (flags["workers-dev"]) domain = null;
  else if (flags.domain) domain = normalizeDomain(flags.domain);
  else if (previous) domain = previous.domain;
  else if (interactive) {
    console.log(
      "\nShare links can live on a domain you have in Cloudflare (for example s.example.com),\nor on a free workers.dev address. Leave this empty for workers.dev.",
    );
    const answer = await ask("Domain for share links: ");
    domain = answer ? normalizeDomain(answer) : null;
    console.log();
  } else domain = null;

  const workerName = flags.name ?? previous?.workerName ?? "sharecli";
  const ttlDays = flags["ttl-days"] ? Number(flags["ttl-days"]) : (previous?.ttlDays ?? DEFAULT_TTL_DAYS);
  if (!Number.isInteger(ttlDays) || ttlDays < 1) throw new CliError("--ttl-days must be a whole number of days, 1 or more");

  // 4. R2 bucket
  step(`Creating the R2 bucket "${workerName}"`);
  const bucket = await wrangler(["r2", "bucket", "create", workerName], { accountId });
  if (bucket.code !== 0 && !/already exists|already own/i.test(output(bucket))) {
    if (/enable r2|10042|purchase/i.test(output(bucket))) {
      throw new CliError(
        "R2 is not enabled on this Cloudflare account",
        "Open https://dash.cloudflare.com → R2 Object Storage and enable it. Cloudflare asks for a payment method, but the free tier (10 GB) costs nothing. Then run `share setup` again.",
        "r2_disabled",
      );
    }
    throw new CliError("Could not create the R2 bucket", output(bucket));
  }
  ok("R2 bucket ready");

  // 5. D1 database
  step(`Creating the D1 database "${workerName}"`);
  const findDb = async () => {
    const r = await wrangler(["d1", "list", "--json"], { accountId });
    if (r.code !== 0) throw new CliError("Could not list D1 databases", output(r));
    return parseJson<{ name: string; uuid: string }[]>(r.stdout, "[").find((d) => d.name === workerName);
  };
  let db = await findDb();
  if (!db) {
    const created = await wrangler(["d1", "create", workerName], { accountId });
    if (created.code !== 0) throw new CliError("Could not create the D1 database", output(created));
    db = await findDb();
    if (!db) throw new CliError("The D1 database was created but could not be found", "Run `share setup` again.");
  }
  ok("D1 database ready");

  // 6. Wrangler config for this deployment
  const deployDir = join(configDir(), "deploy");
  mkdirSync(deployDir, { recursive: true });
  const wranglerConfig = join(deployDir, "wrangler.json");
  writeFileSync(
    wranglerConfig,
    JSON.stringify(
      {
        $schema: "https://unpkg.com/wrangler/config-schema.json",
        name: workerName,
        account_id: accountId,
        main: packagePath("./worker/index.js"),
        compatibility_date: "2026-10-01",
        assets: { directory: packagePath("./worker/assets"), binding: "ASSETS" },
        r2_buckets: [{ binding: "BUCKET", bucket_name: workerName }],
        d1_databases: [{ binding: "DB", database_name: workerName, database_id: db.uuid }],
        triggers: { crons: ["17 * * * *"] },
        vars: { DEFAULT_TTL_DAYS: String(ttlDays) },
        workers_dev: domain === null,
        preview_urls: false,
        ...(domain ? { routes: [{ pattern: domain, custom_domain: true }] } : {}),
        observability: { enabled: true },
      },
      null,
      2,
    ),
  );

  // 7. Schema
  step("Applying the database schema");
  const schema = await wrangler(["d1", "execute", workerName, "--remote", "--yes", "--file", packagePath("./worker/schema.sql"), "--config", wranglerConfig], {
    accountId,
  });
  if (schema.code !== 0) throw new CliError("Could not apply the database schema", output(schema));
  ok("Schema applied");

  // 8. Deploy with secrets. Reuse existing secrets so other machines and unlocked pages keep working.
  const token = existing.token ?? newSecret("sc_");
  const secret = existing.secret ?? newSecret("");
  const secretsFile = join(deployDir, ".secrets.json");
  writeFileSync(secretsFile, JSON.stringify({ API_TOKEN: token, SECRET: secret }), { mode: 0o600 });
  step(`Deploying the Worker${domain ? ` to ${domain}` : ""}`);
  let deployed;
  try {
    deployed = await wrangler(["deploy", "--config", wranglerConfig, "--secrets-file", secretsFile], { accountId });
  } finally {
    rmSync(secretsFile, { force: true });
  }
  if (deployed.code !== 0) {
    const out = output(deployed);
    let hint: string | undefined;
    if (domain && /already (has|have|exists)|existing.*record|conflict/i.test(out)) {
      hint = `${domain} already has a DNS record. Delete it in the Cloudflare dashboard (DNS → Records) or choose another subdomain with --domain.`;
    } else if (domain && /zone|not found/i.test(out)) {
      hint = `Is ${domain.split(".").slice(-2).join(".")} added to this Cloudflare account? Custom domains need the zone in the same account.`;
    } else if (/workers\.dev subdomain/i.test(out)) {
      hint = "Open https://dash.cloudflare.com → Workers & Pages once to register your workers.dev subdomain, then run `share setup` again.";
    }
    throw new CliError(`Deploy failed:\n${out}`, hint, "deploy_failed");
  }
  const url = domain ? `https://${domain}` : /https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(output(deployed))?.[0];
  if (!url) throw new CliError("Deployed, but could not find the Worker URL in wrangler's output", output(deployed));
  ok(`Deployed to ${url}`);

  const deployment: Deployment = {
    accountId: accountId!,
    workerName,
    domain,
    bucket: workerName,
    database: workerName,
    databaseId: db.uuid,
    ttlDays,
  };
  writeConfig({ url, token, secret, deployment });
  ok(`Saved settings to ${configPath()}`);

  // 9. Wait until the server answers (new custom domains need a certificate first).
  step("Waiting for the server to answer");
  const live = await waitForServer(new Client(url, token), domain ? 180_000 : 60_000);
  if (live) ok("Server is live");
  else {
    console.log(
      c.dim(`  ${url} is not answering yet. New domains can take a few minutes to get a certificate; run \`share doctor\` in a bit.`),
    );
  }

  console.log(`\n${c.bold("Ready.")} Share something with ${c.bold("share ./page.html")}\n`);
  console.log(c.dim(`To use sharecli on another machine: share connect ${url} --token <token>  (see \`share config --reveal\`)\n`));

  await offerSkill(flags, interactive);
}

async function waitForServer(client: Client, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await client.usage();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return false;
}

// ---- Agent skill ------------------------------------------------------------

async function offerSkill(flags: SetupFlags, interactive: boolean) {
  if (flags["skip-skill"]) return;
  const npx = "npx";
  if (flags["install-skill"]) {
    step("Installing the sharecli skill for your agents");
    const r = await run(npx, ["--yes", "skills", "add", SKILL_REPO, "--global", "--yes"]);
    if (r.code === 0) ok("Skill installed");
    else console.log(c.dim(`  Skill install failed. Run it yourself: npx skills add ${SKILL_REPO}`));
    return;
  }
  if (!interactive) {
    console.log(`Install the agent skill with: npx skills add ${SKILL_REPO}`);
    return;
  }
  if (await confirm("Install the sharecli skill for your AI agents? (recommended)", true)) {
    const r = await run(npx, ["--yes", "skills", "add", SKILL_REPO]);
    if (r.code !== 0) console.log(c.dim(`  Skill install did not finish. Run it again any time: npx skills add ${SKILL_REPO}`));
  } else {
    console.log(c.dim(`  Skipped. Install it later with: npx skills add ${SKILL_REPO}`));
  }
}

const GLOBAL_SKILL_DIRS = [
  join(homedir(), ".agents/skills/sharecli"),
  join(homedir(), ".claude/skills/sharecli"),
  join(homedir(), ".codex/skills/sharecli"),
  join(homedir(), ".cursor/skills/sharecli"),
  join(homedir(), ".config/opencode/skills/sharecli"),
];
const PROJECT_SKILL_DIRS = [join(process.cwd(), ".agents/skills/sharecli"), join(process.cwd(), ".claude/skills/sharecli")];

export const findSkill = () => [...GLOBAL_SKILL_DIRS, ...PROJECT_SKILL_DIRS].find((d) => existsSync(join(d, "SKILL.md")));
export const isGlobalSkill = (dir: string) => GLOBAL_SKILL_DIRS.includes(dir);

// ---- connect / config / doctor ----------------------------------------------

export async function connect(urlArg: string | undefined, flags: SetupFlags) {
  if (!urlArg) throw new CliError("Missing server URL", "Usage: share connect https://s.example.com --token <token>");
  let token = flags.token;
  if (!token && isInteractive()) token = await ask("API token (from `share config --reveal` on the machine that ran setup): ");
  if (!token) throw new CliError("Missing --token", "Copy it from `share config --reveal` on the machine that ran `share setup`.");
  const url = new URL(/^https?:\/\//.test(urlArg) ? urlArg : `https://${urlArg}`).origin;
  const client = new Client(url, token);
  await client.usage();
  const existing = readConfig();
  const sameServer = existing.url === url;
  writeConfig({ url, token, ...(sameServer ? { secret: existing.secret, deployment: existing.deployment } : {}) });
  if (flags.json) return printJson({ connected: url });
  ok(`Connected to ${url}`);
  const skill = findSkill();
  if (!skill) console.log(c.dim(`  Give your agents the skill too: npx skills add ${SKILL_REPO}`));
}

export function showConfig(flags: SetupFlags) {
  const cfg = readConfig();
  const mask = (t?: string) => (!t ? null : flags.reveal ? t : `${t.slice(0, 6)}…${t.slice(-4)}`);
  const view = { path: configPath(), url: cfg.url ?? null, token: mask(cfg.token), deployment: cfg.deployment ?? null };
  if (flags.json) return printJson(view);
  if (!cfg.url) {
    console.log(`Not set up yet (${configPath()}). Run \`share setup\` or \`share connect\`.`);
    return;
  }
  console.log(`${c.dim("Config".padEnd(10))}${view.path}`);
  console.log(`${c.dim("Server".padEnd(10))}${view.url}`);
  console.log(`${c.dim("Token".padEnd(10))}${view.token}${flags.reveal ? "" : c.dim("  (--reveal to show)")}`);
  if (cfg.deployment) {
    const d = cfg.deployment;
    console.log(`${c.dim("Worker".padEnd(10))}${d.workerName} on account ${d.accountId}`);
    console.log(`${c.dim("Expiry".padEnd(10))}${d.ttlDays} days by default`);
  }
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
  warn?: boolean;
}

export async function doctor(flags: SetupFlags): Promise<number> {
  const checks: Check[] = [];
  const cfg: Partial<Config> = readConfig();
  const url = (process.env.SHARECLI_URL ?? cfg.url)?.replace(/\/+$/, "");
  const token = process.env.SHARECLI_TOKEN ?? cfg.token;

  checks.push(
    url && token
      ? { name: "Config", ok: true, detail: configPath() }
      : { name: "Config", ok: false, detail: "No server configured", hint: "Run `share setup`, or `share connect <url> --token <token>`." },
  );

  if (url && token) {
    const client = new Client(url, token);
    try {
      const h = await client.health();
      const outdated = h.version !== VERSION;
      checks.push({
        name: "Server",
        ok: true,
        warn: outdated,
        detail: `${url} runs sharecli ${h.version}`,
        hint: outdated ? (cfg.deployment ? `This CLI is ${VERSION}. Run \`share setup\` to update the server.` : `This CLI is ${VERSION}.`) : undefined,
      });
      if (!h.configured) checks.push({ name: "Secrets", ok: false, detail: "Server has no API token", hint: "Run `share setup` again." });
      try {
        const u = await client.usage();
        checks.push({ name: "Token", ok: true, detail: `Accepted (${u.shares} share${u.shares === 1 ? "" : "s"})` });
      } catch (err) {
        checks.push({ name: "Token", ok: false, detail: (err as Error).message, hint: "Run `share connect <url> --token <token>` with the current token." });
      }
    } catch (err) {
      checks.push({ name: "Server", ok: false, detail: (err as CliError).message, hint: (err as CliError).hint });
    }
  }

  const skill = findSkill();
  checks.push(
    skill
      ? { name: "Agent skill", ok: true, detail: skill }
      : { name: "Agent skill", ok: true, warn: true, detail: "Not installed", hint: `npx skills add ${SKILL_REPO}` },
  );

  const failed = checks.some((ch) => !ch.ok);
  if (flags.json) {
    printJson({ ok: !failed, version: VERSION, checks });
  } else {
    for (const ch of checks) {
      const mark = !ch.ok ? c.red("✗") : ch.warn ? c.dim("!") : c.green("✓");
      console.log(`${mark} ${ch.name.padEnd(12)}${ch.detail}`);
      if (ch.hint) console.log(`  ${" ".repeat(12)}${c.dim(ch.hint)}`);
    }
  }
  return failed ? 1 : 0;
}
