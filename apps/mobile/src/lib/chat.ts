/**
 * Pure chat-state bookkeeping for in-room reactions/messages. Kept free of
 * store/native imports so the Node test suite can exercise it directly;
 * onlineStore applies these transitions to its own state.
 */

export const CHAT_CAP = 50;

/** Longest message we will render, enforced on send AND on receive. */
export const CHAT_MAX_LEN = 80;

/** One in-room chat event (reaction emoji or short text). Ephemeral. */
export interface ChatEvent {
  id: string;
  kind: "reaction" | "text";
  value: string;
  fromUserId: string;
  at: number;
}

/** Who is allowed to speak in this room, and which id is our own. */
export interface ChatTrust {
  /** user_ids holding a seat right now — the room's lobby roster. */
  seatedUserIds: readonly string[];
  selfUserId: string | null;
}

/**
 * Gate one inbound broadcast payload.
 *
 * Broadcast is peer-to-peer: every field here was chosen by the sending client,
 * `fromUserId` included. Nothing signs it, so a client can claim any identity it
 * likes. The seat roster is the only thing we independently know to be true —
 * it comes from the `players` table over RLS — so membership in it is what
 * decides whether a payload gets rendered beside somebody's avatar.
 *
 * Returns the sanitized event, or null if the payload should be dropped.
 */
export function acceptChatPayload(
  payload: unknown,
  { seatedUserIds, selfUserId }: ChatTrust,
): Omit<ChatEvent, "id" | "at"> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { kind, value, fromUserId } = payload as Record<string, unknown>;

  if (kind !== "reaction" && kind !== "text") return null;
  if (typeof value !== "string" || typeof fromUserId !== "string") return null;

  // Load-bearing twice over. The server relays to every subscriber on the
  // topic, ourselves included — unlike the old client broadcast, which never
  // echoed to its sender — so this is the dedupe against the local echo
  // sendChatEvent already appended. It is also the drop for anyone else
  // claiming our identity, in the event a future change lets clients send.
  if (fromUserId === selfUserId) return null;
  if (!seatedUserIds.includes(fromUserId)) return null;

  // Any run of whitespace becomes one space: a peer that ignores the input cap
  // must not be able to stretch a transcript row with newlines.
  const clean = value.replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_LEN);
  if (clean.length === 0) return null;

  return { kind, value: clean, fromUserId };
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
