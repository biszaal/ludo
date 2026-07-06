/**
 * Chat-state transitions (pure reducer from src/lib/chat). The realtime
 * transport is exercised on-device; these tests pin the bookkeeping: caps,
 * unread counting, and per-sender reaction tracking.
 */

import { describe, expect, it } from "vitest";
import { applyChatEvent, type ChatEvent } from "../src/lib/chat";

type ChatState = Parameters<typeof applyChatEvent>[0];

const EMPTY: ChatState = { chat: [], chatSeq: 0, chatUnread: 0, latestReactions: {}, userId: "me" };

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

  it("tracks the latest reaction per sender with its seq (bubble retrigger key)", () => {
    const st = run(EMPTY, [
      { kind: "reaction", value: "😂", fromUserId: "a" },
      { kind: "reaction", value: "😭", fromUserId: "b" },
      { kind: "reaction", value: "🎉", fromUserId: "a" },
    ]);
    expect(st.latestReactions["a"]).toEqual({ value: "🎉", seq: 3 });
    expect(st.latestReactions["b"]).toEqual({ value: "😭", seq: 2 });
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
