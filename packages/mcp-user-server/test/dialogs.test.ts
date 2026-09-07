import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterDialogs, type DialogSummary } from "../src/dialogs.js";

const dialogs: DialogSummary[] = [
  { id: "1", title: "Ada Lovelace", type: "user", username: "ada" },
  { id: "-100", title: "Work Team", type: "group" },
  { id: "-200", title: "News", type: "channel", username: "news" },
];

describe("filterDialogs", () => {
  it("returns all dialogs for an empty query", () => {
    assert.equal(filterDialogs(dialogs, "  ").length, 3);
  });

  it("matches title, username, and id", () => {
    assert.equal(filterDialogs(dialogs, "ada").length, 1);
    assert.equal(filterDialogs(dialogs, "team")[0]?.id, "-100");
    assert.equal(filterDialogs(dialogs, "-200")[0]?.username, "news");
  });
});
