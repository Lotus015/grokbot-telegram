import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const dist = join(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");

describe("bundled user stdio server", () => {
  it("starts over stdio and lists user-account tools without credentials", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [dist],
      env: {
        PATH: process.env.PATH ?? "",
      },
    });
    const client = new Client({ name: "stdio-smoke", version: "0.0.0" });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      const names = listed.tools.map((t) => t.name).sort();
      assert.ok(names.includes("auth_status"));
      assert.ok(names.includes("send_message"));
      assert.ok(names.includes("list_dialogs"));
      assert.ok(names.includes("get_messages"));
      assert.ok(names.includes("start_login"));
    } finally {
      await client.close();
    }
  });
});
