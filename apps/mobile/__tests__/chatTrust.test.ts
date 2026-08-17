/**
 * Trust rules for inbound chat broadcasts.
 *
 * Realtime broadcast is peer-to-peer: `fromUserId` is whatever the sending
 * client typed into the payload, not something the server vouched for. These
 * tests pin the gate that turns an untrusted payload into an event we're
 * willing to render — seat membership, kind, and value sanitation.
 */

import { describe, expect, it } from "vitest";
import { acceptChatPayload, CHAT_MAX_LEN } from "../src/lib/chat";

const SEATS = ["alice", "bob", "carol"] as const;
const opts = { seatedUserIds: SEATS, selfUserId: "alice" };

describe("acceptChatPayload", () => {
  it("accepts a well-formed message from another seated player", () => {
    const ev = acceptChatPayload({ kind: "text", value: "Nice move!", fromUserId: "bob" }, opts);
    expect(ev).toEqual({ kind: "text", value: "Nice move!", fromUserId: "bob" });
  });

  it("rejects a sender who holds no seat in this room", () => {
    const ev = acceptChatPayload({ kind: "text", value: "hi", fromUserId: "mallory" }, opts);
    expect(ev).toBeNull();
  });

  // The server relays to every subscriber including the sender, so our own
  // message comes back to us. Dropping it is what stops it appearing twice
  // alongside the local echo — and doubles as the anti-impersonation drop.
  it("drops our own message coming back from the server (already echoed locally)", () => {
    const ev = acceptChatPayload({ kind: "text", value: "I fold", fromUserId: "alice" }, opts);
    expect(ev).toBeNull();
  });

  it("rejects a kind outside the known set", () => {
    const ev = acceptChatPayload({ kind: "system", value: "You won!", fromUserId: "bob" }, opts);
    expect(ev).toBeNull();
  });

  it("rejects empty and whitespace-only values", () => {
    expect(acceptChatPayload({ kind: "text", value: "", fromUserId: "bob" }, opts)).toBeNull();
    expect(acceptChatPayload({ kind: "text", value: "   \t ", fromUserId: "bob" }, opts)).toBeNull();
  });

  it("rejects malformed payloads without throwing", () => {
    expect(acceptChatPayload(null, opts)).toBeNull();
    expect(acceptChatPayload(undefined, opts)).toBeNull();
    expect(acceptChatPayload("hi", opts)).toBeNull();
    expect(acceptChatPayload({ kind: "text", fromUserId: "bob" }, opts)).toBeNull();
    expect(acceptChatPayload({ kind: "text", value: 42, fromUserId: "bob" }, opts)).toBeNull();
    expect(acceptChatPayload({ kind: "text", value: "hi", fromUserId: 7 }, opts)).toBeNull();
  });

  it("clamps an oversized value to the cap the sender was supposed to honour", () => {
    const ev = acceptChatPayload({ kind: "text", value: "x".repeat(500), fromUserId: "bob" }, opts);
    expect(ev?.value).toHaveLength(CHAT_MAX_LEN);
  });

  it("collapses newlines so a crafted message cannot stretch the transcript row", () => {
    const ev = acceptChatPayload({ kind: "text", value: "a\n\n\n\nb", fromUserId: "bob" }, opts);
    expect(ev?.value).toBe("a b");
  });

  it("accepts reactions under the same seat rule", () => {
    expect(acceptChatPayload({ kind: "reaction", value: "🔥", fromUserId: "carol" }, opts)).toEqual({
      kind: "reaction",
      value: "🔥",
      fromUserId: "carol",
    });
    expect(acceptChatPayload({ kind: "reaction", value: "🔥", fromUserId: "mallory" }, opts)).toBeNull();
  });

  it("rejects everything while the seat list is still empty", () => {
    const ev = acceptChatPayload(
      { kind: "text", value: "hi", fromUserId: "bob" },
      { seatedUserIds: [], selfUserId: "alice" },
    );
    expect(ev).toBeNull();
  });
});
