# sharecli

Share HTML pages, Markdown docs and files from the terminal, or let your AI agent do it, under your own domain. It runs on Cloudflare's free plan.

```
$ share ./report.html
✓ Shared  https://s.example.com/k7p2xq
  Expires     in 30 days (Nov 9, 2026)
  Copied link to the clipboard
```

I built it because agents are good at making HTML pages and bad at getting them to anyone else. One command uploads the page, prints a short link, and cleans up after 30 days unless you say otherwise.

## What it does

- **HTML.** A single `.html` file is served as-is. Inline images work. If the page points to local images, CSS or other pages, the CLI finds them and uploads them too.
- **Folders.** A folder with an `index.html` is served as a small static site under `/<slug>/`.
- **Markdown.** `.md` files render in a clean reader with a contents sidebar, code highlighting, tables, Mermaid diagrams, dark mode and a download button for the source.
- **Anything else.** PDFs, images and zips are served directly, with a `/raw` download link.
- **Private links.** `--private` puts the page behind a generated 6-character passcode. The CLI also prints a direct link with the passcode in it, so friends can open the page in one tap.
- **Expiry.** Shares expire after 30 days by default. `--ttl 7d` sets another window and `--permanent` keeps one forever. An hourly job deletes expired files.
- **Versions.** `share update` uploads new content to the same link. The last 5 versions are kept, and `share rollback` brings back the previous one.
- **Views.** `share info` counts views. Link-preview bots from Slack, iMessage and WhatsApp don't count, and no IPs or cookies are stored.

## Install

Needs Node 20 or newer and a Cloudflare account. The free plan is enough.

```bash
npm install -g sharecli
share setup
```

`share setup` opens a browser to log you in to Cloudflare. It then creates an R2 bucket and a D1 database, deploys the Worker and saves the settings to `~/.config/sharecli/config.json`. At the end it offers to install the agent skill. Re-run it any time; it updates the existing deployment.

```bash
share setup --domain s.example.com   # links on your own subdomain
share setup --workers-dev            # links on a free *.workers.dev address
```

A custom domain has to be a zone in the same Cloudflare account. Use a subdomain like `s.example.com` rather than a path on your main site: shared pages run their own JavaScript, and a separate subdomain keeps it away from your main site's cookies.

Cloudflare asks for a payment method before it enables R2, even on the free tier. Enable R2 once in the dashboard if setup tells you to.

### More machines

The machine that ran setup can show its token:

```bash
share config --reveal
```

On the other machine:

```bash
share connect https://s.example.com --token <token>
```

`SHARECLI_URL` and `SHARECLI_TOKEN` override the config file, which helps in CI.

## Usage

```bash
share page.html                      # public, 30 days
share notes.md --private             # passcode generated for you
share deck.html --passcode friends24 # your own passcode, 4+ letters or digits
share ./site --slug launch           # s.example.com/launch/
share demo.mp4 --permanent           # never expires

share ls                             # everything you've shared
share info launch                    # passcode, expiry, views, versions
share update launch ./site           # new version, same link
share rollback launch                # back to the previous version
share private launch                 # or: share public launch
share extend launch --ttl 90d
share rm launch --yes
share usage                          # storage and views against the free plan
share doctor                         # check config, server, token and skill
```

Every command takes a slug or a full link, and every command accepts `--json`. Run `share --help` for the full list.

## For AI agents

The repo ships a skill that teaches agents when to share, which flags to pick and how to report the link back:

```bash
npx skills add alesmartan/sharecli
```

The skill has no domain in it. Each machine's config holds the server, so the same skill works for everyone. Agents should always pass `--json`. Errors come back as `{"error": {"code", "message", "hint"}}` with exit code 1, and deleting needs `--yes` when nobody is at the keyboard.

## Costs and limits

Everything fits in Cloudflare's free plan for personal use:

| | Free plan | What it means here |
|---|---|---|
| Workers | 100,000 requests a day | Every page view and every upload is a request |
| R2 | 10 GB stored, no egress fees | About 17,000 half-megabyte HTML pages |
| D1 | 5 GB, 100,000 row writes a day | Two row writes per counted view, so about 50,000 views a day |

Single files can be up to 95 MB, and a share can hold up to 1,000 files.

## How it works

```
share (CLI) ──HTTPS + API token──> Worker on s.example.com
                                    ├─ R2: files, stored as <slug>/v<n>/<path>
                                    ├─ D1: shares, versions, daily views
                                    └─ Cron, hourly: delete expired shares
```

The CLI only talks to the Worker's API, using a bearer token. After setup it has no Cloudflare credentials of its own.

Passcodes are checked on the server. A correct passcode sets a signed cookie scoped to that one share, and changing the passcode invalidates old cookies. Ten wrong tries lock a visitor out of that share for 15 minutes. Passcodes are stored in plain text so `share info` can show them again. They keep casual visitors out. They are not meant to protect secrets.

All shares live on one origin. A shared page's JavaScript can read other shares a visitor has already unlocked, so share only content you'd trust on your own domain.

## Development

```bash
pnpm install
pnpm dev        # builds, creates the local database, runs the Worker on localhost:8787
pnpm test       # builds, then runs the end-to-end tests against a throwaway local Worker
pnpm typecheck
```

`pnpm dev` reads secrets from `.dev.vars`:

```
API_TOKEN=dev-token
SECRET=dev-secret
```

Then point a local CLI at it:

```bash
SHARECLI_CONFIG_DIR=/tmp/sharecli node dist/cli.js connect http://localhost:8787 --token dev-token
```

## License

MIT
