#!/usr/bin/env node
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "mcp-server");
const require = createRequire(join(pkgDir, "package.json"));
const esbuild = require("esbuild");

const outfile = join(pkgDir, "dist/index.js");

await esbuild.build({
  entryPoints: [join(pkgDir, "src/index.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  minify: true,
  target: "node20",
  legalComments: "eof",
  banner: { js: "#!/usr/bin/env node\n" },
  logLevel: "info",
});

chmodSync(outfile, 0o755);
