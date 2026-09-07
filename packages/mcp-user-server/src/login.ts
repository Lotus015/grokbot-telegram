import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createGramJsUserClient } from "./client.js";
import { writeSessionString } from "./credentials.js";
import { isPasswordNeeded } from "./types.js";

async function main() {
  const rl = createInterface({ input, output });
  const ask = (prompt: string) => rl.question(prompt);

  try {
    const client = createGramJsUserClient();
    await client.connect();
    if (await client.isAuthorized()) {
      const me = await client.getMe();
      const path = writeSessionString(client.exportSession());
      console.log(
        `Already authorized as ${me.username ? `@${me.username}` : me.firstName ?? me.id}.`,
      );
      console.log(`Session file: ${path}`);
      return;
    }

    const phone = (await ask("Phone number (+country code): ")).trim();
    const sent = await client.sendCode(phone);
    const code = (
      await ask(
        sent.isCodeViaApp
          ? "Login code from the Telegram app: "
          : "Login code from SMS: ",
      )
    ).trim();

    try {
      await client.signIn(phone, sent.phoneCodeHash, code);
    } catch (err) {
      if (!isPasswordNeeded(err)) throw err;
      const password = await ask("Two-step verification password: ");
      await client.signInWithPassword(password);
    }

    const me = await client.getMe();
    const session = client.exportSession();
    const path = writeSessionString(session);
    console.log(
      `Logged in as ${me.username ? `@${me.username}` : me.firstName ?? me.id} (user id ${me.id}).`,
    );
    console.log(`Session written to ${path} (mode 0600).`);
    console.log(
      "This string is full account access. Paste it into Cursor Plugins → Configure → TELEGRAM_SESSION if you want it in plugin variables. Never commit it.",
    );
    console.log(session);
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
