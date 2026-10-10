<p align="center">
  <img src="icon.svg" width="84" alt="">
</p>

<h1 align="center">sharecli</h1>

<p align="center">
  Share pages, docs and files from your terminal or AI agent.<br>
  Short links on your own domain, free on Cloudflare.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-2747c7" alt="MIT license">
  <img src="https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-f38020" alt="Runs on Cloudflare Workers">
  <img src="https://img.shields.io/badge/node-%E2%89%A520-5fa04e" alt="Node 20 or newer">
</p>

<p align="center">
  <img src=".github/assets/terminal.png" width="780" alt="Sharing a page and a private doc with the share command">
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/viewer-dark.png">
  <img src=".github/assets/viewer-light.png" alt="A shared Markdown doc in the reader">
</picture>

## Features

| | |
|---|---|
| **HTML, Markdown, any file** | Pages are served as-is. Docs open in a clean reader with dark mode. |
| **Private links** | `--private` adds a passcode, plus a one-tap link for friends. |
| **Auto cleanup** | Links expire after 30 days, or never with `--permanent`. |
| **Versions** | `update` keeps the link. `rollback` undoes the last change. |
| **Built for agents** | `--json` on every command, and a skill for Claude Code, Codex and more. |
| **Free** | Runs on the Cloudflare free plan: Workers, R2 and D1. |

## Quick start

```bash
npm install -g @alesmartan/sharecli
share setup --domain s.example.com
share page.html
```

`setup` logs you in to Cloudflare and deploys your own server. Skip `--domain` for a free `workers.dev` address.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/phones-dark.png">
  <img src=".github/assets/phones-light.png" alt="An HTML page, a Markdown doc and the passcode screen on a phone">
</picture>

## Commands

```bash
share <file|folder> [--private] [--ttl 7d | --permanent] [--slug name]

share ls                     share update <link> <file>
share info <link>            share rollback <link>
share private <link>         share extend <link>
share public <link>          share rm <link>

share setup | connect | doctor | usage
```

Run `share --help` for every flag.

## For AI agents

```bash
npx skills add alesmartan/sharecli
```

Then ask your agent to *"make an HTML page about X and share it"*.

<details>
<summary><b>Good to know</b></summary>
<br>

- **R2 needs a card on file.** Cloudflare asks once, even on the free plan. You won't be charged under the limits.
- **More machines:** `share connect https://s.example.com --token <token>`. Get the token with `share config --reveal`.
- **Passcodes keep casual visitors out.** They are not meant for secrets.
- **Limits:** 95 MB per file, 1,000 files per share, 10 GB in total on the free plan.

</details>

## Develop

```bash
pnpm install
pnpm dev     # local server on localhost:8787
pnpm test    # end-to-end tests against a throwaway server
```

## License

MIT
