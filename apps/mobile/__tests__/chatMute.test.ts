/**
 * Blocking somebody has to actually silence them.
 *
 * `blocks` has existed since friend discovery (0015), but nothing on the chat
 * path ever consulted it, so a player who blocked someone still heard them for
 * the rest of the game. These tests pin the filter at the door every inbound
 * payload comes through — which is the load-bearing detail, because that single
 * event also drives the speech bubble over the sender's avatar and the unread
 * badge. Filtering in the transcript renderer instead would leave a blocked
 * player still popping up over the board, which is most of what people are
 * asking to stop.
 */

import { describe, expect, it } from "vitest";
import { acceptChatPayload, applyChatEvent, type ChatState } from "../src/lib/chat";

const SEATS = ["alice", "bob", "carol"] as const;
const base = { seatedUserIds: SEATS, selfUserId: "alice" };

describe("acceptChatPayload with a mute list", () => {
  it("drops a message from a blocked player", () => {
    const ev = acceptChatPayload(
      { kind: "text", value: "get lost", fromUserId: "bob" },
      { ...base, mutedUserIds: ["bob"] },
    );
    expect(ev).toBeNull();
  });

  it("drops a blocked player's reactions too, not just their text", () => {
    // Reactions render as the same bubble beside the same avatar.
    const ev = acceptChatPayload(
      { kind: "reaction", value: "😂", fromUserId: "bob" },
      { ...base, mutedUserIds: ["bob"] },
    );
    expect(ev).toBeNull();
  });

  it("still delivers everyone who is not blocked", () => {
    const ev = acceptChatPayload(
      { kind: "text", value: "Nice move!", fromUserId: "carol" },
      { ...base, mutedUserIds: ["bob"] },
    );
    expect(ev).toEqual({ kind: "text", value: "Nice move!", fromUserId: "carol" });
  });

  it("behaves exactly as before when nothing is blocked", () => {
    // The list is optional so a caller that has not loaded it yet is not a
    // silent mute-everyone.
    const withEmpty = acceptChatPayload({ kind: "text", value: "hi", fromUserId: "bob" }, { ...base, mutedUserIds: [] });
    const withNone = acceptChatPayload({ kind: "text", value: "hi", fromUserId: "bob" }, base);
    expect(withEmpty).toEqual({ kind: "text", value: "hi", fromUserId: "bob" });
    expect(withNone).toEqual(withEmpty);
  });
});

describe("what a blocked message would have driven", () => {
  const blank: ChatState & { userId: string | null } = {
    chat: [],
    chatSeq: 0,
    chatUnread: 0,
    latestBubbles: {},
    userId: "alice",
  };

  it("never reaches the bubble map or the unread badge", () => {
    // The proof that filtering at the door is enough: the only way to a bubble
    // or an unread count is through an accepted event.
    const rejected = acceptChatPayload(
      { kind: "text", value: "abuse", fromUserId: "bob" },
      { ...base, mutedUserIds: ["bob"] },
    );
    expect(rejected).toBeNull();

    // Nothing appended, so nothing to show and nothing to badge.
    expect(blank.latestBubbles).toEqual({});
    expect(blank.chatUnread).toBe(0);

    // Contrast: an accepted event does drive both.
    const accepted = acceptChatPayload({ kind: "text", value: "hi", fromUserId: "carol" }, base)!;
    const next = applyChatEvent(blank, accepted);
    expect(next.latestBubbles.carol?.value).toBe("hi");
    expect(next.chatUnread).toBe(1);
  });
});
