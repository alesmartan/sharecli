import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CliError } from "./ui";

export interface Deployment {
  accountId: string;
  workerName: string;
  domain: string | null;
  bucket: string;
  database: string;
  databaseId: string;
  ttlDays: number;
}

export interface Config {
  /** Public base URL, for example https://s.example.com */
  url: string;
  /** Bearer token for the admin API. */
  token: string;
  /** Signs passcode cookies. Only the machine that ran `share setup` has it. */
  secret?: string;
  deployment?: Deployment;
}

export const configDir = () =>
  process.env.SHARECLI_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "sharecli");

export const configPath = () => join(configDir(), "config.json");

export function readConfig(): Partial<Config> {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CliError(`Could not read ${path}`, "Fix or delete the file, then run `share setup` again.");
  }
}

export function writeConfig(config: Partial<Config>) {
  mkdirSync(configDir(), { recursive: true });
  const path = configPath();
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Config for talking to the server. Environment variables win over the file. */
export function requireConnection(): { url: string; token: string } {
  const file = readConfig();
  const url = (process.env.SHARECLI_URL ?? file.url)?.replace(/\/+$/, "");
  const token = process.env.SHARECLI_TOKEN ?? file.token;
  if (!url || !token) {
    throw new CliError(
      "sharecli is not set up on this machine",
      "Run `share setup` to deploy your own server, or `share connect <url> --token <token>` to use one you already have.",
      "not_configured",
    );
  }
  return { url, token };
}
