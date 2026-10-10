import { handleApi } from "./api";
import { cleanup } from "./cleanup";
import type { Env } from "./db";
import { handlePublic } from "./serve";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return handleApi(req, env, url);
    return handlePublic(req, env, ctx, url);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanup(env).then((r) => console.log("cleanup", r)));
  },
} satisfies ExportedHandler<Env>;
