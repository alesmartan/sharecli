// Builds the CLI, the Worker and the Markdown viewer into dist/.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const assets = join(dist, "worker", "assets", "_assets");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(assets, "fonts"), { recursive: true });

await Promise.all([
  build({
    entryPoints: [join(root, "src/cli/main.ts")],
    outfile: join(dist, "cli.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
    logLevel: "warning",
  }),
  build({
    entryPoints: [join(root, "src/worker/index.ts")],
    outfile: join(dist, "worker", "index.js"),
    bundle: true,
    platform: "neutral",
    format: "esm",
    target: "es2022",
    mainFields: ["module", "main"],
    logLevel: "warning",
  }),
  build({
    entryPoints: [join(root, "src/viewer/viewer.ts")],
    outfile: join(assets, "viewer.js"),
    bundle: true,
    minify: true,
    platform: "browser",
    format: "esm",
    target: "es2020",
    logLevel: "warning",
  }),
  build({
    entryPoints: [join(root, "src/viewer/viewer.css")],
    outfile: join(assets, "viewer.css"),
    bundle: true,
    minify: true,
    external: ["*.woff2"],
    logLevel: "warning",
  }),
]);

cpSync(join(root, "src/worker/schema.sql"), join(dist, "worker", "schema.sql"));
cpSync(join(root, "src/viewer/favicon.svg"), join(assets, "favicon.svg"));
const fonts = join(root, "node_modules/@fontsource-variable/source-serif-4/files");
for (const name of ["latin-opsz-normal", "latin-ext-opsz-normal", "latin-opsz-italic", "latin-ext-opsz-italic"]) {
  cpSync(join(fonts, `source-serif-4-${name}.woff2`), join(assets, "fonts", `source-serif-4-${name}.woff2`));
}
console.log(`built sharecli ${pkg.version} → dist/`);
