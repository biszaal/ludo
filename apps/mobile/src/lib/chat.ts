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
  /** Latest reaction per sender user_id (drives the floating bubbles). */
  latestReactions: Record<string, { value: string; seq: number }>;
}

/** Append one event: cap the transcript, count remote-text unread, track reactions. */
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
    latestReactions:
      p.kind === "reaction" ? { ...st.latestReactions, [p.fromUserId]: { value: p.value, seq } } : st.latestReactions,
  };
}
