import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";

export class CliError extends Error {
  constructor(
    message: string,
    public hint?: string,
    public code = "error",
  ) {
    super(message);
  }
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (open: number, close: number) => (s: string) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : s);
export const c = {
  bold: paint(1, 22),
  dim: paint(2, 22),
  green: paint(32, 39),
  red: paint(31, 39),
  cyan: paint(36, 39),
};

export const isInteractive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

export function printJson(data: unknown) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export async function ask(question: string, fallback = ""): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

/** Yes/no prompt. `defaultYes` decides what a bare Enter means. */
export async function confirm(question: string, defaultYes: boolean): Promise<boolean> {
  const answer = (await ask(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `)).toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

export async function choose<T>(question: string, options: { label: string; value: T }[]): Promise<T> {
  console.log(question);
  options.forEach((o, i) => console.log(`  ${c.bold(String(i + 1))}. ${o.label}`));
  for (;;) {
    const n = Number(await ask(`Pick 1-${options.length}: `));
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1].value;
  }
}

const UNITS: Record<string, number> = { m: 60, h: 3600, d: 86400, w: 7 * 86400, y: 365 * 86400 };

/** "30d", "12h", "2w", "90m", "1y"; a bare number means days. */
export function parseTtl(input: string): number {
  const m = /^(\d+)\s*([mhdwy]?)$/i.exec(input.trim());
  if (!m || Number(m[1]) <= 0) {
    throw new CliError(`Invalid --ttl "${input}"`, "Use a number with a unit, for example 7d, 12h, 2w or 90m.");
  }
  return Number(m[1]) * UNITS[(m[2] || "d").toLowerCase()];
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

const dateFmt = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });
export const formatDate = (iso: string) => dateFmt.format(new Date(iso));

/** "in 30 days", "in 5 hours", "3 days ago". */
export function relative(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const [n, unit] =
    abs >= 86400_000 * 2
      ? [Math.round(abs / 86400_000), "day"]
      : abs >= 3600_000 * 2
        ? [Math.round(abs / 3600_000), "hour"]
        : [Math.max(1, Math.round(abs / 60_000)), "minute"];
  const text = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

export function table(rows: string[][], header: string[]) {
  const all = [header, ...rows];
  // Measure without ANSI codes so coloured cells still line up.
  const plain = (s: string) => s.replace(/\x1b\[\d+m/g, "");
  const widths = header.map((_, i) => Math.max(...all.map((r) => plain(r[i] ?? "").length)));
  const line = (r: string[]) => r.map((cell, i) => cell + " ".repeat(widths[i] - plain(cell).length)).join("  ").trimEnd();
  console.log(c.dim(line(header)));
  for (const r of rows) console.log(line(r));
}

export const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Runs a command, resolving with its exit code. Output is inherited unless captured. */
export function run(
  cmd: string,
  args: string[],
  opts: { capture?: boolean; input?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: [opts.input !== undefined ? "pipe" : opts.capture ? "ignore" : "inherit", opts.capture ? "pipe" : "inherit", opts.capture ? "pipe" : "inherit"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    if (opts.input !== undefined) child.stdin!.end(opts.input);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function copyToClipboard(text: string): Promise<boolean> {
  const candidates: [string, string[]][] =
    process.platform === "darwin"
      ? [["pbcopy", []]]
      : process.platform === "win32"
        ? [["clip", []]]
        : [
            ["wl-copy", []],
            ["xclip", ["-selection", "clipboard"]],
            ["xsel", ["--clipboard", "--input"]],
          ];
  for (const [cmd, args] of candidates) {
    try {
      const { code } = await run(cmd, args, { capture: true, input: text });
      if (code === 0) return true;
    } catch {
      // Not installed; try the next one.
    }
  }
  return false;
}

export async function openUrl(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  await run(cmd, [url], { capture: true }).catch(() => undefined);
}
