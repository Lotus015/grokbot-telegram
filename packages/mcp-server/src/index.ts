import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createTelegramMcpServer } from "./server.js";

serveStdio(() => createTelegramMcpServer());
