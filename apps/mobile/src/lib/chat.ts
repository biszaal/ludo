/**
 * Pure chat-state bookkeeping for in-room reactions/messages. Kept free of
 * store/native imports so the Node test suite can exercise it directly;
 * onlineStore applies these transitions to its own state.
 */

export const CHAT_CAP = 50;

/** One in-room chat event (reaction emoji or short text). Ephemeral. */
export interface ChatEvent {
  id: string;
  kind: "reaction" | "text";
  value: string;
  fromUserId: string;
  at: number;
}

export interface ChatState {
  chat: ChatEvent[];
  /** Bumps once per appended event — feedback/UI retrigger key. */
  chatSeq: number;
  /** Text messages received since the chat sheet was last opened. */
  chatUnread: number;
  /** Latest event per sender user_id — every reaction AND text pops as a
   *  speech bubble beside the sender's avatar (Ludo Club style). */
  latestBubbles: Record<string, { value: string; kind: ChatEvent["kind"]; seq: number }>;
}

/** Append one event: cap the transcript, count remote-text unread, track bubbles. */
export function applyChatEvent(
  st: ChatState & { userId: string | null },
  p: Omit<ChatEvent, "id" | "at">,
): ChatState {
  const seq = st.chatSeq + 1;
  const ev: ChatEvent = { ...p, id: `${Date.now()}-${seq}`, at: Date.now() };
  const own = p.fromUserId === st.userId;
  return {
    chat: [...st.chat, ev].slice(-CHAT_CAP),
    chatSeq: seq,
    chatUnread: p.kind === "text" && !own ? st.chatUnread + 1 : st.chatUnread,
    latestBubbles: { ...st.latestBubbles, [p.fromUserId]: { value: p.value, kind: p.kind, seq } },
  };
}
