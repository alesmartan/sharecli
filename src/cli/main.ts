import { parseArgs } from "node:util";
import { VERSION } from "../shared/version";
import * as cmd from "./commands";
import { SKILL_REPO, connect, doctor, setup, showConfig } from "./setup";
import { CliError, c, printJson } from "./ui";

const HELP = `${c.bold("share")}: publish HTML pages, Markdown docs and files to your own domain.

${c.bold("Share")}
  share <file|folder>              Upload and print the link (expires in 30 days)
    --private                      Require a passcode (one is generated)
    --passcode <code>              Use your own passcode (4+ letters or digits)
    --ttl <time>                   Expire after 7d, 12h, 2w... instead of 30 days
    --permanent                    Never expire
    --slug <name>                  Custom link name: s.example.com/<name>
    --title <text>                 Title shown in lists and link previews
    --open                         Open the link in your browser
    --no-copy                      Don't copy the link to the clipboard

${c.bold("Manage")}
  share update <share> [path]      Upload a new version to the same link
                                   (no path: change --title, --ttl, --permanent or --private)
  share ls                         List your shares
  share info <share>               Details, passcode, views and versions
  share rm <share>...              Delete shares and every version (--yes to skip the prompt)
  share open <share>               Open in the browser
  share versions <share>           List kept versions (the last 5)
  share rollback <share> [v]       Serve an earlier version again (default: the previous one)
  share private <share>            Put behind a passcode (--passcode to choose it)
  share public <share>             Remove the passcode
  share passcode <share> [code]    Set a new passcode (random if omitted)
  share extend <share>             Restart the expiry clock (or --ttl / --permanent)
  share usage                      Storage and views against the free plan

${c.bold("Server")}
  share setup                      Deploy your server to Cloudflare (safe to re-run; updates it)
    --domain <host>                Serve links from this domain, e.g. s.example.com
    --workers-dev                  Use the free workers.dev address instead
    --account-id <id>              Cloudflare account, if you have several
    --ttl-days <n>                 Default expiry in days (30)
    --install-skill / --skip-skill Install the agent skill without asking, or skip it
  share connect <url> --token <t>  Use an existing server from this machine
  share config [--reveal]          Show settings (and the API token with --reveal)
  share doctor                     Check config, server, token and agent skill

${c.bold("Everywhere")}
  --json                           Machine-readable output (for scripts and agents)
  -y, --yes                        Skip confirmations
  -v, --version / -h, --help

<share> is a slug (k7p2xq) or a full link. Agent skill: npx skills add ${SKILL_REPO}
`;

const COMMANDS = new Set([
  "update",
  "ls",
  "list",
  "info",
  "rm",
  "delete",
  "open",
  "versions",
  "rollback",
  "private",
  "public",
  "passcode",
  "extend",
  "usage",
  "setup",
  "connect",
  "config",
  "doctor",
  "help",
]);

async function main(argv: string[]): Promise<number> {
  const { values: flags, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      private: { type: "boolean" },
      passcode: { type: "string" },
      ttl: { type: "string" },
      permanent: { type: "boolean" },
      slug: { type: "string" },
      title: { type: "string" },
      open: { type: "boolean" },
      "no-copy": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      domain: { type: "string" },
      "workers-dev": { type: "boolean" },
      "account-id": { type: "string" },
      name: { type: "string" },
      "ttl-days": { type: "string" },
      "install-skill": { type: "boolean" },
      "skip-skill": { type: "boolean" },
      token: { type: "string" },
      reveal: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (flags.version) {
    console.log(VERSION);
    return 0;
  }
  const [first, ...rest] = positionals;
  if (flags.help || !first || first === "help") {
    console.log(HELP);
    return 0;
  }

  if (!COMMANDS.has(first)) {
    if (rest.length) throw new CliError(`Unexpected arguments: ${rest.join(" ")}`, "Share one file or folder at a time.");
    await cmd.publish(first, flags);
    return 0;
  }

  switch (first) {
    case "update":
      await cmd.update(rest[0], rest[1], flags);
      break;
    case "ls":
    case "list":
      await cmd.list(flags);
      break;
    case "info":
      await cmd.info(rest[0], flags);
      break;
    case "rm":
    case "delete":
      await cmd.remove(rest, flags);
      break;
    case "open":
      await cmd.open(rest[0]);
      break;
    case "versions":
      await cmd.versions(rest[0], flags);
      break;
    case "rollback":
      await cmd.rollback(rest[0], rest[1], flags);
      break;
    case "private":
      await cmd.setAccess(rest[0], true, flags);
      break;
    case "public":
      await cmd.setAccess(rest[0], false, flags);
      break;
    case "passcode":
      await cmd.passcode(rest[0], rest[1], flags);
      break;
    case "extend":
      await cmd.extend(rest[0], flags);
      break;
    case "usage":
      await cmd.usage(flags);
      break;
    case "setup":
      await setup(flags);
      break;
    case "connect":
      await connect(rest[0], flags);
      break;
    case "config":
      showConfig(flags);
      break;
    case "doctor":
      return doctor(flags);
  }
  return 0;
}

const wantsJson = process.argv.includes("--json");

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    const e = err instanceof CliError ? err : new CliError((err as Error)?.message ?? String(err), undefined, (err as any)?.code ?? "error");
    if (wantsJson) printJson({ error: { code: e.code, message: e.message, hint: e.hint ?? null } });
    else {
      console.error(`${c.red("✗")} ${e.message}`);
      if (e.hint) console.error(`  ${e.hint}`);
    }
    process.exit(1);
  },
);
