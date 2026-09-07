#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "mcp-user-server");
const require = createRequire(join(pkgDir, "package.json"));
const esbuild = require("esbuild");

const banner = `import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
`;

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  minify: true,
  target: "node20",
  legalComments: "eof",
  banner: { js: banner },
  logLevel: "info",
};

await esbuild.build({
  ...shared,
  entryPoints: [join(pkgDir, "src/index.ts")],
  outfile: join(pkgDir, "dist/index.js"),
});

await esbuild.build({
  ...shared,
  entryPoints: [join(pkgDir, "src/login.ts")],
  outfile: join(pkgDir, "dist/login.js"),
});
