/**
 * Push notification registration and routing.
 *
 * Three things arrive this way, all of them social and all sent by
 * functions/game/social.ts: a room invite, a friend request, and a friend
 * coming online. The daily-bonus reminder is NOT here — it is scheduled on the
 * device (lib/bonusReminder.ts) because the reset time is knowable offline —
 * but its taps land in the same router below.
 *
 * Registration is deliberately NOT done at cold start. iOS gives an app exactly
 * one permission prompt, and a player who sees it three seconds into their
 * first launch — before they have a single friend, let alone an invite —
 * declines, permanently. So it is triggered from the places where the value is
 * already obvious (the Friends screen, a lobby you're inviting people to), and
 * the app works fine for anyone who never says yes: invites still arrive over
 * realtime while the app is open.
 *
 * Nothing here throws. Push is an enhancement on top of a delivery path that
 * already works, and a notification failure must never surface as a broken
 * invite.
 */

import { Platform } from "react-native";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { notifications } from "./notifications";
// Type-only: erased at compile time, so it never pulls the module in at runtime.
import type { NotificationResponse } from "expo-notifications";
import { pushDisable, pushRegister } from "../net/api";
import { useOnlineStore } from "../store/onlineStore";
import { useNav } from "../store/navStore";
import { useSettings } from "../store/settingsStore";

/**
 * Foreground presentation. SDK 53+ replaced shouldShowAlert with the
 * banner/list pair; using the old key silently shows nothing.
 *
 * Called from initPush rather than run at module scope: this file must be
 * importable on a runtime where expo-notifications is not, so nothing here may
 * touch the module before `notifications()` has been consulted.
 */
function setForegroundPresentation(): void {
  const N = notifications();
  if (!N) return;
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false, // the app has its own sounds; a double chime is noise
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

function projectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

/**
 * Ask for permission (if not already answered), mint a token, and store it.
 * Returns true when this device is registered to receive pushes.
 *
 * Safe to call repeatedly — the OS only prompts once, and the upsert is
 * idempotent on the token.
 */
export async function registerForPush(): Promise<boolean> {
  // Simulators and emulators cannot receive remote push at all. Bailing here
  // keeps a dev build from writing a token that can never be delivered to.
  if (!Device.isDevice) return false;
  if (!useSettings.getState().pushOn) return false;
  const N = notifications();
  if (!N) return false;

  try {
    const existing = await N.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const asked = await N.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return false;

    // Android needs a channel before anything is delivered; the id matches the
    // channelId the edge function sends.
    if (Platform.OS === "android") {
      await N.setNotificationChannelAsync("default", {
        name: "Invites and friends",
        importance: N.AndroidImportance.DEFAULT,
      });
    }

    const { data: token } = await N.getExpoPushTokenAsync({ projectId: projectId() });
    if (!token) return false;

    // Through the edge function, not the table. The write conflicts on the
    // TOKEN — reinstalling mints a new one, and signing into a different account
    // on the same device must MOVE the existing row rather than leave the old
    // account receiving this handset's pushes. The RLS policy this replaced
    // matched on the row's owner instead, so that move silently did nothing.
    await pushRegister(token, Platform.OS === "ios" ? "ios" : "android");
    return true;
  } catch {
    return false; // permission dialog dismissed, offline, or no credentials yet
  }
}

/** Drop this device's registration (the player turned notifications off). */
export async function unregisterPush(): Promise<void> {
  if (!Device.isDevice) return;
  const N = notifications();
  if (!N) return;
  try {
    const { data: token } = await N.getExpoPushTokenAsync({ projectId: projectId() });
    if (!token) return;
    // Server-side for the same reason as registration: the row being cleared may
    // belong to a previous account on this install, which is precisely the case
    // a self-scoped delete could not reach.
    await pushDisable(token);
  } catch {
    // Nothing to remove, or offline — the server prunes dead tokens on send.
  }
}

/** What the sender puts in `data`. `type` is the routing key; every producer
 *  (social.ts for the friend notifications, bonusReminder.ts for the local
 *  one) sets it, and an unknown value simply opens the app. */
interface NotificationPayload {
  type?: string;
  roomCode?: string;
}

/**
 * Act on a tapped notification.
 *
 * Every branch shares one guard: a live game is never interrupted. A friend's
 * invite, or a nudge about coins, arriving mid-match must not eject the player
 * from the match — the notification has already done its job by getting them
 * back into the app. Same rule the deep-link path follows.
 */
function handleResponse(response: NotificationResponse): void {
  const data = response.notification.request.content.data as NotificationPayload | undefined;
  if (!data?.type) return;

  const online = useOnlineStore.getState();
  const busy = online.status !== "idle" && online.status !== "error";
  if (busy) return;

  switch (data.type) {
    case "invite":
      if (data.roomCode) void online.join(data.roomCode);
      return;
    // Both land on Friends: one has a request to answer, the other a friend to
    // invite, and that screen is where each of those is done.
    case "friend-request":
    case "friend-online":
      useNav.getState().push("friends");
      return;
    case "daily-bonus":
      // Home, not a sheet opened from here: the calendar auto-opens there when
      // a bonus is actually claimable (dailyBonusStore.shouldAutoShow), so the
      // player lands on the same thing they would have seen by opening the app,
      // and a stale reminder for a bonus already taken quietly does nothing.
      useNav.getState().popTo("home");
      return;
    default:
      return;
  }
}

/**
 * Subscribe to notification taps, including the one that launched the app from
 * cold. Call once from App; returns an unsubscribe.
 */
export function initPush(): () => void {
  const N = notifications();
  if (!N) return () => {}; // no notifications on this runtime — nothing to route
  setForegroundPresentation();

  // A tap that cold-started the app has already fired by the time this runs,
  // so it has to be read rather than listened for.
  void N.getLastNotificationResponseAsync().then((response) => {
    if (response) handleResponse(response);
  });

  const sub = N.addNotificationResponseReceivedListener(handleResponse);
  return () => sub.remove();
}
