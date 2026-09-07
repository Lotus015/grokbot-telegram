import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const dist = join(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");

describe("bundled stdio server", () => {
  it("starts over stdio and lists v1 tools without a token", async () => {
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
      assert.deepEqual(names, [
        "get_me",
        "get_updates",
        "list_recent_chats",
        "send_message",
      ]);
    } finally {
      await client.close();
    }
  });
});
