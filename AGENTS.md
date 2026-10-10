# sharecli

A CLI that turns a local HTML page, Markdown doc, file or folder into a short link on the user's own domain. Each user deploys their own server to Cloudflare's free plan with `share setup`. The main users are AI agents: they build a page, run `share page.html --json`, and hand the link back.

Published on npm as `@alesmartan/sharecli` (npm refused the bare `sharecli`). It installs two commands, `share` and `sharecli`.

## How it fits together

- `src/cli/` is the CLI. It only talks to the Worker's HTTP API with a bearer token, never to Cloudflare directly. `setup.ts` is the exception: it drives `wrangler` to create the R2 bucket and D1 database and deploy the Worker.
- `src/worker/` is the server. Files live in R2 under `<slug>/v<n>/`, metadata in D1 (`schema.sql`, which must stay idempotent because setup re-runs it on every deploy). An hourly cron deletes expired shares.
- `src/viewer/` renders Markdown in the browser. It is bundled to `/_assets/`.
- `src/shared/` holds code used by both sides. Keep it free of Node and Worker APIs.
- `skills/sharecli/SKILL.md` is the agent skill, installed with `npx skills add alesmartan/sharecli`. Keep it generic: no domain in it, and details stay in `share --help`.

## Working on it

```bash
pnpm dev    # builds, then runs the Worker on localhost:8787 (secrets from .dev.vars)
pnpm test   # typecheck, build, then end-to-end tests against a throwaway local Worker
```

The tests drive the built CLI against a real local Worker. Any behaviour change belongs in `test/e2e.test.mjs`.

Every CLI command must keep working with `--json` and return exit code 1 with `{"error": {"code", "message", "hint"}}` on failure. Agents depend on that shape.

## Releasing

Bump `version` in `package.json`, run `pnpm test`, then `npm publish`. The owner publishes, since npm asks for a browser approval. Users update their server by re-running `share setup`.

README screenshots live in `.github/assets/`.
