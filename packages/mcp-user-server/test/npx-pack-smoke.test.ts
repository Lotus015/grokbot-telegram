import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function packAndExtract(): { tmp: string; entry: string; tgz: string } {
  const tmp = mkdtempSync(join(tmpdir(), "cursor-telegram-user-mcp-"));
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", tmp], {
      cwd: pkgDir,
      encoding: "utf8",
    }),
  ) as Array<{ filename: string }>;
  const tgz = join(tmp, packed[0].filename);
  execFileSync("tar", ["-xzf", tgz, "-C", tmp]);
  return { tmp, entry: join(tmp, "package", "dist", "index.js"), tgz };
}

async function listToolNames(command: string, args: string[]): Promise<string[]> {
  const transport = new StdioClientTransport({
    command,
    args,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? tmpdir(),
    },
  });
  const client = new Client({ name: "npx-pack-smoke", version: "0.0.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    return listed.tools.map((t) => t.name).sort();
  } finally {
    await client.close();
  }
}

describe("npx-publishable package entry", () => {
  it("packed bin starts over stdio and lists user-account tools", async () => {
    const { tmp, entry } = packAndExtract();
    try {
      const head = readFileSync(entry, "utf8").slice(0, 32);
      assert.ok(head.startsWith("#!/usr/bin/env node"), `missing shebang: ${head}`);
      const names = await listToolNames(process.execPath, [entry]);
      assert.ok(names.includes("auth_status"));
      assert.ok(names.includes("send_message"));
      assert.ok(names.includes("list_dialogs"));
      assert.ok(names.includes("get_messages"));
      assert.ok(names.includes("start_login"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("npx -y --package <tarball> lists the same tools", async () => {
    const { tmp, tgz } = packAndExtract();
    try {
      const names = await listToolNames("npx", [
        "-y",
        `--package=${tgz}`,
        "cursor-telegram-user-mcp",
      ]);
      assert.ok(names.includes("auth_status"));
      assert.ok(names.includes("send_message"));
      assert.ok(names.includes("list_dialogs"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
