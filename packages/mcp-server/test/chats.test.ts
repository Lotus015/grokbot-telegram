import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chatsFromUpdates, type TelegramUpdate } from "../src/chats.js";

describe("chatsFromUpdates", () => {
  it("dedupes chats from several update types", () => {
    const updates: TelegramUpdate[] = [
      {
        update_id: 1,
        message: {
          chat: { id: 11, type: "private", first_name: "Ada", username: "ada" },
        },
      },
      {
        update_id: 2,
        message: {
          chat: { id: 11, type: "private", first_name: "Ada", username: "ada" },
        },
      },
      {
        update_id: 3,
        my_chat_member: {
          chat: { id: -100, type: "supergroup", title: "Team" },
        },
      },
      {
        update_id: 4,
        channel_post: {
          chat: { id: -200, type: "channel", title: "News", username: "news" },
        },
      },
      {
        update_id: 5,
        callback_query: {
          message: { chat: { id: 11, type: "private", first_name: "Ada" } },
        },
      },
    ];

    const chats = chatsFromUpdates(updates);
    const ids = chats.map((c) => c.id).sort((a, b) => a - b);
    assert.deepEqual(ids, [-200, -100, 11]);
    const priv = chats.find((c) => c.id === 11);
    assert.equal(priv?.username, "ada");
  });

  it("returns empty for updates without chats", () => {
    assert.deepEqual(chatsFromUpdates([{ update_id: 9 }]), []);
  });
});
