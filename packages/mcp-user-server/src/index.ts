import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createTelegramUserMcpServer } from "./server.js";

serveStdio(() => createTelegramUserMcpServer());
