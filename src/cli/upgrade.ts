import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_NAME, VERSION } from "../shared/version";
import { Client } from "./client";
import { configDir, readConfig } from "./config";
import { SKILL_REPO, findSkill, isGlobalSkill } from "./setup";
import { CliError, c, confirm, isInteractive, printJson, run } from "./ui";

const CHECK_EVERY_MS = 24 * 3600_000;
const registryUrl = () =>
  `${process.env.SHARECLI_REGISTRY_URL ?? "https://registry.npmjs.org"}/${PACKAGE_NAME.replace("/", "%2f")}/latest`;

export async function fetchLatest(timeoutMs: number): Promise<string> {
  const res = await fetch(registryUrl(), { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`npm registry answered HTTP ${res.status}`);
  const { version } = (await res.json()) as { version?: string };
  if (!version) throw new Error("npm registry sent no version");
  return version;
}

/** True when version a is newer than b. Pre-release tags are ignored. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/-.*$/, "").split(".").map(Number);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

// ---- Update notice ----------------------------------------------------------

const cachePath = () => join(configDir(), "update-check.json");

/**
 * Prints a one-line notice when npm has a newer version. Checks the registry at
 * most once a day and never for --json, scripts or CI, so agents never see it.
 */
export async function notifyIfOutdated(json: boolean) {
  if (json || !isInteractive() || process.env.CI || process.env.SHARECLI_NO_UPDATE_CHECK) return;
  let cache: { checkedAt?: number; latest?: string } = {};
  try {
    cache = JSON.parse(readFileSync(cachePath(), "utf8"));
  } catch {}
  if (!cache.checkedAt || Date.now() - cache.checkedAt > CHECK_EVERY_MS) {
    // A failed check still counts, so an offline machine doesn't retry on every command.
    cache = { checkedAt: Date.now(), latest: await fetchLatest(1500).catch(() => cache.latest) };
    try {
      mkdirSync(configDir(), { recursive: true });
      writeFileSync(cachePath(), JSON.stringify(cache));
    } catch {}
  }
  if (cache.latest && isNewer(cache.latest, VERSION)) {
    process.stderr.write(`\n${c.green("Update available")} ${VERSION} → ${c.bold(cache.latest)}. Run ${c.bold("share upgrade")}.\n`);
  }
}

// ---- share upgrade ----------------------------------------------------------

type Installer = { kind: "npm" | "pnpm" | "bun"; cmd: string; args: string[] } | { kind: "npx" | "source" };

/** Works out how this copy of the CLI was installed, from where it runs. */
function installer(): Installer {
  let path = process.argv[1] ?? "";
  try {
    path = realpathSync(path);
  } catch {}
  const target = `${PACKAGE_NAME}@latest`;
  if (path.includes("/_npx/")) return { kind: "npx" };
  if (!path.includes("/node_modules/")) return { kind: "source" };
  if (path.includes("/pnpm/") || path.includes("/.pnpm/")) return { kind: "pnpm", cmd: "pnpm", args: ["add", "-g", target] };
  if (path.includes("/.bun/")) return { kind: "bun", cmd: "bun", args: ["add", "-g", target] };
  // --prefer-online skips npm's cached package list, which can predate a fresh release
  return { kind: "npm", cmd: "npm", args: ["install", "-g", "--prefer-online", target] };
}

interface UpgradeFlags {
  json?: boolean;
  yes?: boolean;
}

export async function upgrade(flags: UpgradeFlags) {
  const json = Boolean(flags.json);
  const say = (line: string) => {
    if (!json) console.log(line);
  };
  const latest = await fetchLatest(10_000).catch((err) => {
    throw new CliError(`Could not check npm for the latest version (${(err as Error).message})`, "Check your connection and try again.", "network");
  });
  const result: Record<string, unknown> = { current: VERSION, latest };

  // 1. The CLI itself
  const how = installer();
  if (!isNewer(latest, VERSION)) {
    result.cli = { status: "up_to_date" };
    say(`${c.green("✓")} sharecli ${VERSION} is the latest`);
  } else if (how.kind === "npx") {
    result.cli = { status: "npx" };
    say(`${c.dim("!")} You run sharecli through npx. Use ${c.bold(`npx ${PACKAGE_NAME}@latest`)} to get ${latest}.`);
  } else if (how.kind === "source") {
    result.cli = { status: "source" };
    say(`${c.dim("!")} This sharecli runs from a source checkout, so it was left alone. npm has ${latest}.`);
  } else if ("cmd" in how) {
    say(`${c.cyan("›")} Updating sharecli ${VERSION} → ${latest}`);
    const r = await run(how.cmd, how.args, { capture: json });
    if (r.code !== 0) {
      throw new CliError(
        `${how.cmd} could not install ${latest}`,
        `A new release can take a few minutes to reach every npm server, so try again shortly. Or run it yourself: ${how.cmd} ${how.args.join(" ")}`,
        "upgrade_failed",
      );
    }
    result.cli = { status: "updated", via: how.kind };
    say(`${c.green("✓")} sharecli ${latest} installed`);
  }

  // 2. The agent skill
  const skill = findSkill();
  if (!skill) {
    result.skill = { status: "not_installed" };
    say(`${c.dim("!")} Agent skill not installed. Add it with: npx skills add ${SKILL_REPO}`);
  } else {
    say(`${c.cyan("›")} Updating the agent skill`);
    const r = await run("npx", ["--yes", "skills", "update", "sharecli", isGlobalSkill(skill) ? "--global" : "--project", "--yes"], {
      capture: json,
    });
    result.skill = { status: r.code === 0 ? "updated" : "failed" };
    say(r.code === 0 ? `${c.green("✓")} Agent skill updated` : `${c.dim("!")} Skill update failed. Run: npx skills update sharecli`);
  }

  // 3. The server, only from the machine that deployed it
  const cfg = readConfig();
  let serverVersion: string | null = null;
  if (cfg.url && cfg.token) serverVersion = await new Client(cfg.url, cfg.token).health().then((h) => h.version, () => null);
  if (!cfg.url) {
    result.server = { status: "not_configured" };
  } else if (serverVersion && !isNewer(latest, serverVersion)) {
    result.server = { status: "up_to_date", version: serverVersion };
    say(`${c.green("✓")} Server at ${cfg.url} runs ${serverVersion}`);
  } else if (!cfg.deployment) {
    result.server = { status: "not_owner", version: serverVersion };
    say(`${c.dim("!")} Server runs ${serverVersion ?? "an unknown version"}. Update it from the machine that ran \`share setup\`.`);
  } else {
    const go = flags.yes || (isInteractive() && !json && (await confirm(`Redeploy your server with ${latest}?`, true)));
    if (!go) {
      result.server = { status: "skipped", version: serverVersion };
      say(`${c.dim("!")} Server left on ${serverVersion ?? "its current version"}. Run \`share upgrade --yes\` to redeploy it.`);
    } else {
      const r = await run("npx", ["--yes", `${PACKAGE_NAME}@${latest}`, "setup", "--skip-skill"], { capture: json });
      if (r.code !== 0) throw new CliError("Server redeploy failed", "Run `share setup` to see the full error.", "deploy_failed");
      result.server = { status: "updated", version: latest };
    }
  }

  if (json) printJson(result);
}
