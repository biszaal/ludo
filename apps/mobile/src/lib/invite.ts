import { inviteUrl, codeFromUrl, friendCodeFromUrl } from "./inviteLinks";
import { trackProductEvent } from "./analytics";
import { t } from "../i18n";
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
import { useFriends } from "../store/friendsStore";
import { useNav } from "../store/navStore";

/** Open the OS share sheet with the room invite. Best-effort (user may cancel).
 *  The stake goes in the text so nobody taps into a pot they didn't expect. */
export async function shareInvite(code: string, stake = 0): Promise<void> {
  try {
    const pot = stake > 0 ? t("invite.stake", { stake }) : "";
    const result = await Share.share({
      message: t("invite.message", { code, stake: pot, url: inviteUrl(code) }),
    });
    if (result.action === Share.sharedAction) trackProductEvent("invite_shared");
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

/** Screens a friend link must not pull the player out of. */
const BUSY_SCREENS = new Set(["localGame", "frenzyGame", "lobby", "onlineGame"]);

/** A friend's link (?friend=CODE): open Add Friend with the code looked up,
 *  which records the referral the same way typing it would. Mid-game, the code
 *  just waits until they next open Add Friend. */
function handleFriendLink(code: string): void {
  useFriends.getState().setPendingCode(code);
  const nav = useNav.getState();
  const top = nav.stack[nav.stack.length - 1]?.name;
  if (!top || top === "addFriend" || BUSY_SCREENS.has(top)) return;
  nav.push("addFriend");
}

function handleUrl(url: string | null): void {
  const friend = friendCodeFromUrl(url);
  if (friend) return handleFriendLink(friend);
  const code = codeFromUrl(url);
  if (!code) return;
  const online = useOnlineStore.getState();
  // Never yank someone out of a live room/game they're already in.
  if (online.status !== "idle" && online.status !== "error") return;
  void online.join(code).then(() => {
    const state = useOnlineStore.getState();
    if (state.status === "lobby" || state.status === "active") trackProductEvent("invite_joined");
  });
}

/** Join rooms from invite links (cold start + while running). Call once from App. */
export function initDeepLinks(): () => void {
  void Linking.getInitialURL().then(handleUrl);
  const sub = Linking.addEventListener("url", (e) => handleUrl(e.url));
  return () => sub.remove();
}
