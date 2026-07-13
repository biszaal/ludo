/**
 * Chat-state transitions (pure reducer from src/lib/chat). The realtime
 * transport is exercised on-device; these tests pin the bookkeeping: caps,
 * unread counting, and per-sender bubble tracking.
 */

import { describe, expect, it } from "vitest";
import { applyChatEvent, type ChatEvent } from "../src/lib/chat";

type ChatState = Parameters<typeof applyChatEvent>[0];

const EMPTY: ChatState = { chat: [], chatSeq: 0, chatUnread: 0, latestBubbles: {}, userId: "me" };

function run(st: ChatState, events: Array<Omit<ChatEvent, "id" | "at">>): ChatState {
  let cur = st;
  for (const ev of events) cur = { ...cur, ...applyChatEvent(cur, ev) };
  return cur;
}

describe("applyChatEvent", () => {
  it("appends events and bumps the sequence", () => {
    const st = run(EMPTY, [
      { kind: "text", value: "hi", fromUserId: "them" },
      { kind: "reaction", value: "🔥", fromUserId: "them" },
    ]);
    expect(st.chat.map((e) => e.value)).toEqual(["hi", "🔥"]);
    expect(st.chatSeq).toBe(2);
  });

  it("counts unread only for remote text (not own sends, not reactions)", () => {
    const st = run(EMPTY, [
      { kind: "text", value: "own", fromUserId: "me" },
      { kind: "text", value: "remote", fromUserId: "them" },
      { kind: "reaction", value: "😂", fromUserId: "them" },
    ]);
    expect(st.chatUnread).toBe(1);
  });

  it("tracks the latest bubble per sender with its seq (bubble retrigger key)", () => {
    const st = run(EMPTY, [
      { kind: "reaction", value: "😂", fromUserId: "a" },
      { kind: "reaction", value: "😭", fromUserId: "b" },
      { kind: "reaction", value: "🎉", fromUserId: "a" },
    ]);
    expect(st.latestBubbles["a"]).toEqual({ value: "🎉", kind: "reaction", seq: 3 });
    expect(st.latestBubbles["b"]).toEqual({ value: "😭", kind: "reaction", seq: 2 });
  });

  it("text messages also pop as bubbles, replacing the sender's prior reaction", () => {
    const st = run(EMPTY, [
      { kind: "reaction", value: "🔥", fromUserId: "a" },
      { kind: "text", value: "Nice move!", fromUserId: "a" },
    ]);
    expect(st.latestBubbles["a"]).toEqual({ value: "Nice move!", kind: "text", seq: 2 });
  });

  it("caps the transcript at 50 events, dropping the oldest", () => {
    const events = Array.from({ length: 55 }, (_u, i) => ({
      kind: "text" as const,
      value: `m${i}`,
      fromUserId: "them",
    }));
    const st = run(EMPTY, events);
    expect(st.chat).toHaveLength(50);
    expect(st.chat[0]!.value).toBe("m5");
    expect(st.chatSeq).toBe(55);
  });
});
