/**
 * Room invites: the share message that goes out (Messages, Messenger, anything
 * on the share sheet) and the deep-link handling that brings a friend in.
 *
 * The message carries both the tappable link and the plain code — many chat
 * apps don't linkify custom schemes, so the code is the fallback.
 *
 * SCHEME: the app registers `ludobiszaal` first and plain `ludo` second
 * (app.json). `ludo://` is claimed by several shipped Ludo apps and iOS picks
 * among them arbitrarily, so an invite generated with it routinely opened a
 * COMPETITOR's app on the recipient's phone. createURL uses the primary scheme,
 * so links we generate are unambiguous; parsing stays scheme-agnostic, so an
 * older `ludo://` link still works if it happens to reach us.
 */

import { Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { useOnlineStore } from "../store/onlineStore";

export function inviteUrl(code: string): string {
  return Linking.createURL(`join/${code}`);
}

/** Open the OS share sheet with the room invite. Best-effort (user may cancel).
 *  The stake goes in the text so nobody taps into a pot they didn't expect. */
export async function shareInvite(code: string, stake = 0): Promise<void> {
  try {
    const pot = stake > 0 ? ` We're playing for ${stake} coins.` : "";
    await Share.share({
      message: `Join my Ludo game! Room code: ${code}.${pot}\n${inviteUrl(code)}`,
    });
  } catch {
    // user dismissed or no share targets — nothing to do
  }
}

export async function copyCode(code: string): Promise<void> {
  try {
    await Clipboard.setStringAsync(code);
  } catch {
    // clipboard unavailable — non-fatal
  }
}

/** Extract a room code from a <scheme>://join/CODE url (null if it isn't one).
 *  Scheme-agnostic on purpose — see the note on SCHEME above. */
export function codeFromUrl(url: string | null): string | null {
  if (!url) return null;
  const parsed = Linking.parse(url);
  // scheme://join/ABCD parses as hostname "join" + path "ABCD" (two slashes) or
  // path "join/ABCD" (three) — normalize both.
  const segments = [parsed.hostname, ...(parsed.path?.split("/") ?? [])].filter(
    (s): s is string => !!s && s.length > 0,
  );
  if (segments[0]?.toLowerCase() !== "join") return null;
  const code = (segments[1] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  return code.length >= 3 ? code : null;
}

function handleUrl(url: string | null): void {
  const code = codeFromUrl(url);
  if (!code) return;
  const online = useOnlineStore.getState();
  // Never yank someone out of a live room/game they're already in.
  if (online.status !== "idle" && online.status !== "error") return;
  void online.join(code);
}

/** Join rooms from invite links (cold start + while running). Call once from App. */
export function initDeepLinks(): () => void {
  void Linking.getInitialURL().then(handleUrl);
  const sub = Linking.addEventListener("url", (e) => handleUrl(e.url));
  return () => sub.remove();
}
