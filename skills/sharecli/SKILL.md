---
name: sharecli
description: Share a page, doc or file as a link with the `share` CLI. Use to share, publish or host something, or to change a link shared earlier.
---

# sharecli

`share` uploads a path to the user's own server and prints a link. `share --help` lists every command and flag; this file covers how to use them well.

## Share something

1. **Make the content self-contained.** One `.html` file with images inlined (base64 or SVG) is the most reliable. A page with separate assets works too: keep them in the page's folder and reference them with relative paths (`img/chart.png`, never `/img/chart.png`). Markdown renders as a styled document with a contents sidebar, code highlighting and a download button, so share `.md` as-is.
2. **Pick flags from what the user said:**
   - Default: public, expires in 30 days.
   - "private", "password", "only for X": `--private` (generates a passcode), or `--passcode <code>` when they name one (4+ letters or digits).
   - "keep it", "forever", "permanent": `--permanent`. A specific window: `--ttl 7d` (also `12h`, `2w`).
   - A readable link: `--slug <name>`. A better title for link previews: `--title "..."`.
3. **Run it with `--json`:** `share <path> --json [flags]`.
4. **Report back** the `url`, plus `passcode` and `unlock_url` when `private` is true (the unlock link opens the page without typing the passcode), and when it expires (`expires_at`, or "never" when `permanent`). Pass on any `warnings`: they name files that were skipped or links that will break.

## Change a share

A share keeps its link through every edit, so when the user wants changes to something already shared, update that share rather than creating a new one. Find it with `share ls --json` if you don't have the slug.

- New content: `share update <slug> <path> --json`. The previous 5 versions are kept; `share rollback <slug>` restores the one before.
- Access: `share private <slug>`, `share public <slug>`, `share passcode <slug> [code]`.
- Expiry: `share extend <slug>` restarts the clock; add `--ttl` or `--permanent` to change it.
- Delete: `share rm <slug> --yes`. Deletion is immediate and removes every version, so confirm with the user first.

Every command accepts a slug or the full link.

## When it fails

`share: command not found` means the CLI isn't installed: `npm install -g @alesmartan/sharecli`.

With `--json`, errors print `{"error": {"code", "message", "hint"}}` and exit 1. Follow the `hint`.

`not_configured` means this machine has no server yet. Two ways out, and the user picks:

- **Their own server:** `share setup`, optionally `--domain s.example.com` (a domain in their Cloudflare account) or `--workers-dev`. It opens a browser for the Cloudflare login, so the user must be at the machine. If it stops on R2 not being enabled, they enable R2 once in the Cloudflare dashboard (it asks for a card; the free tier costs nothing), then run setup again.
- **An existing server:** `share connect <url> --token <token>`, with the token from `share config --reveal` on the machine that ran setup.

`share doctor` checks the config, server, token, this skill and whether a newer version is out.

An unknown command or flag usually means an old CLI. Run `share upgrade --yes` when that happens or the user asks: it updates the CLI, this skill and the user's server.
