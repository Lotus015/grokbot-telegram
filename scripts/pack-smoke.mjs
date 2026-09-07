#!/usr/bin/env node
// Packs the real tarball, unpacks it somewhere clean, and drives the binary
// out of it over stdio. This is the only check that sees what users get:
// npm rewrites the manifest at publish time and merely *warns* when it drops
// a bin entry, which would leave `npx grokbot-telegram` doing nothing at all.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function check(condition, message) {
  if (condition) return;
  failures.push(message);
}

function packAndExtract() {
  const tmp = mkdtempSync(join(tmpdir(), "grokbot-telegram-pack-"));
  // --ignore-scripts: prepublishOnly calls this script, and packing again
  // from inside it would recurse.
  const packed = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", tmp],
      { cwd: root, encoding: "utf8" },
    ),
  );
  execFileSync("tar", ["-xzf", join(tmp, packed[0].filename), "-C", tmp]);
  return { tmp, pkgRoot: join(tmp, "package") };
}

// One MCP initialize + tools/list over stdio, no client library needed.
function listTools(entry, mode, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, mode], {
      env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${mode}: timed out waiting for tools/list`));
    }, 30_000);

    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer);
      for (const line of out.split("\n").filter(Boolean)) {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 2 && message.result?.tools) {
          resolve(message.result.tools.map((t) => t.name).sort());
          return;
        }
      }
      reject(
        new Error(`${mode}: no tools/list response.\nstdout: ${out}\nstderr: ${err}`),
      );
    });

    for (const frame of [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "pack-smoke", version: "0.0.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]) {
      child.stdin.write(`${JSON.stringify(frame)}\n`);
    }
    child.stdin.end();
  });
}

const { tmp, pkgRoot } = packAndExtract();
try {
  const manifest = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  const binPath = manifest.bin?.[manifest.name];

  check(
    binPath === "dist/cli.js",
    `bin.${manifest.name} is ${JSON.stringify(binPath)}, expected "dist/cli.js" — npm drops the entry when the path starts with "./"`,
  );
  check(manifest.type === "module", 'packed manifest lost "type": "module"');
  check(
    manifest.private !== true,
    "packed manifest is private and cannot be published",
  );

  const entry = join(pkgRoot, "dist", "cli.js");
  const head = readFileSync(entry, "utf8").slice(0, 19);
  check(head === "#!/usr/bin/env node", `dist/cli.js lost its shebang: ${head}`);
  check(
    (statSync(entry).mode & 0o111) !== 0,
    "dist/cli.js is not executable in the tarball",
  );

  const bot = await listTools(entry, "bot", { TELEGRAM_BOT_TOKEN: "dummy" });
  check(
    bot.includes("send_message") && bot.includes("get_me"),
    `bot mode listed unexpected tools: ${bot.join(", ")}`,
  );

  const user = await listTools(entry, "user", {});
  check(
    user.includes("send_message") && user.includes("list_dialogs"),
    `user mode listed unexpected tools: ${user.join(", ")}`,
  );

  // The disclaimer is a trust promise; it has to survive bundling. Read the
  // expected wording out of the source so a reworded footer cannot make this
  // check quietly vacuous.
  for (const [file, source] of [
    ["bot.js", "packages/mcp-server/src/disclaimer.ts"],
    ["user.js", "packages/mcp-user-server/src/disclaimer.ts"],
  ]) {
    const declared = readFileSync(join(root, source), "utf8");
    const match = declared.match(/DEFAULT_DISCLAIMER\s*=\s*\n?\s*"([^"]+)"/);
    if (match === null) {
      failures.push(`could not read DEFAULT_DISCLAIMER out of ${source}`);
      continue;
    }
    // esbuild emits ASCII by default, so the em dash lands as \u2014.
    const bundle = readFileSync(join(pkgRoot, "dist", file), "utf8").replace(
      /\\u([0-9a-fA-F]{4})/g,
      (_, hex) => String.fromCharCode(parseInt(hex, 16)),
    );
    check(
      bundle.includes(match[1]),
      `dist/${file} does not carry the disclaimer footer ${JSON.stringify(match[1])}`,
    );
  }

  if (failures.length > 0) {
    console.error("Pack smoke failed:");
    for (const failure of failures) console.error(` - ${failure}`);
    process.exit(1);
  }
  console.log(
    `Pack smoke passed: ${manifest.name}@${manifest.version}, bin ${binPath}, ${bot.length} bot tools, ${user.length} user tools.`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
