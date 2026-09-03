import { useCallback, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import {
  useFonts,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from "@expo-google-fonts/outfit";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import { ScreenStack } from "./src/components/ScreenStack";
import { SheetHost } from "./src/components/SheetHost";
import { InviteBanner } from "./src/components/InviteBanner";
import { ConfirmDialog } from "./src/components/ConfirmDialog";
import { LoadingScreen } from "./src/components/LoadingScreen";
import { ChooseNameScreen } from "./src/components/ChooseNameScreen";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { useOnlineStore } from "./src/store/onlineStore";
import { useNav } from "./src/store/navStore";
import { useProfile } from "./src/store/profileStore";
import { initSound, setMusicActive } from "./src/lib/sound";
import { initFeedback } from "./src/lib/feedback";
import { initCrashReporting } from "./src/lib/crashReporting";
import { initDeepLinks } from "./src/lib/invite";
import { initConnection } from "./src/lib/connection";
import { initPush } from "./src/lib/push";
import { initBonusReminder } from "./src/lib/bonusReminder";
import { initFriends, initPresence } from "./src/store/friendsStore";
import { useConfig } from "./src/store/configStore";
import { useAds } from "./src/store/adsStore";
import { useWallet } from "./src/store/walletStore";
import { initAds } from "./src/lib/ads/provider";
import { initProfileSync } from "./src/net/profileSync";
import { initPurchases, syncPurchasesUser } from "./src/lib/purchases";
import { ensureSignedIn } from "./src/net/api";

/**
 * Put the app somewhere known-good before remounting after a render crash.
 *
 * An online game is the likeliest thing to have thrown (it is the only screen
 * driven by state a remote peer can change), and remounting straight back into
 * it would just throw again. Leaving the room also tells the server, so the
 * other players see us go rather than waiting out a turn clock.
 */
function recoverFromCrash(): void {
  try {
    const online = useOnlineStore.getState();
    if (online.gameId) online.leave();
    else useNav.getState().popTo("home");
  } catch {
    // Recovery must never throw — worst case the player lands wherever they were.
  }
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    JetBrainsMono_500Medium,
  });
  const [launched, setLaunched] = useState(false);
  // Never prompted on an existing install: profileStore v3 migrates them past it.
  const namePromptSeen = useProfile((s) => s.namePromptSeen);
  const onLaunched = useCallback(() => setLaunched(true), []);

  useEffect(() => {
    // FIRST, and synchronously: anything that throws during the rest of this
    // startup is exactly the class of crash worth catching, and a reporter
    // started afterwards would miss it. No-op when no DSN is configured.
    initCrashReporting();
    void initSound();
    // Ad pacing / economy config. Fire-and-forget: the store already holds a
    // persisted or default document, so nothing waits on this.
    void useConfig.getState().refresh();
    // Consent then SDK init, both best-effort. bumpSession drives the
    // new-player grace period that holds interstitials back early on.
    useAds.getState().bumpSession();
    void initAds();
    // RevenueCat: configure with the platform key, then attach the current user
    // (created if needed) so purchases land on the right account. No key means
    // billing is off for this build — it all no-ops and the shop uses the stub.
    const rcKey = Platform.select({
      ios: process.env.EXPO_PUBLIC_RC_IOS_KEY,
      android: process.env.EXPO_PUBLIC_RC_ANDROID_KEY,
      default: undefined,
    });
    if (rcKey) {
      void initPurchases(rcKey)
        .then(() => ensureSignedIn())
        .then(syncPurchasesUser)
        .catch(() => {});
    }
    // Who this player has blocked. Loaded before the first game rather than on
    // entering one: the mute filter sits on the chat receive path, and a list
    // that arrives after the first message would let exactly the message
    // somebody blocked for through. Fire-and-forget — it retries next launch,
    // and Report mutes locally regardless.
    void useOnlineStore.getState().loadMuted();
    // Before anything that makes a request: the network layer consults this to
    // decide whether a retry is worth sending, and a call made before it is
    // installed simply falls back to the old fixed cadence.
    const stopConnection = initConnection();
    const stopFeedback = initFeedback();
    const stopProfileSync = initProfileSync();
    const stopDeepLinks = initDeepLinks();
    const stopFriends = initFriends();
    const stopPresence = initPresence();
    // Listener only — registration (and the OS permission prompt) is deferred
    // to the screens where push is obviously worth something. See lib/push.ts.
    const stopPush = initPush();
    // Watches the wallet and keeps the local "daily bonus ready" reminder
    // pointed at the next unclaimed one.
    const stopBonusReminder = initBonusReminder();
    return () => {
      stopConnection();
      stopFeedback();
      stopProfileSync();
      stopDeepLinks();
      stopFriends();
      stopPresence();
      stopPush();
      stopBonusReminder();
    };
  }, []);

  // On returning to the foreground, resync an in-progress online game to recover
  // any updates missed while the realtime socket was asleep. Music pauses in the
  // background and resumes in front.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setMusicActive(next === "active");
      const online = useOnlineStore.getState();
      if (next === "active") {
        online.setAway(false);
        void online.resync();
        // A pot can settle while the app is closed — a match you left after
        // finishing pays out when the LAST player comes home, long after you
        // stopped watching. Re-read the balance so those coins actually show up.
        void useWallet.getState().refresh();
      } else {
        online.setAway(true); // opponents see an "Away" badge while I'm out
      }
    });
    return () => sub.remove();
  }, []);

  // Proceed once fonts load OR fail — never block the UI on a font error
  // (RN falls back to the system font).
  const ready = fontsLoaded || fontError !== null;

  // The app stays unmounted until fonts are in, so no screen ever paints in the
  // system face and snaps. The loading screen then fades off the top of the
  // already-mounted UI, and drops out of the tree once it's invisible.
  return (
    /**
     * KeyboardProvider wraps everything because Android no longer resizes the
     * window for the keyboard.
     *
     * Edge-to-edge is mandatory from SDK 56 (the `edgeToEdgeEnabled` opt-out is
     * gone), so the app draws behind the system bars and the IME animates OVER
     * the layout instead of shrinking it. `softwareKeyboardLayoutMode` still
     * says "resize" and still has no visible effect — which is why the
     * documented Android recipe of "just mount a KeyboardAvoidingView with no
     * behavior" quietly stopped working, and why the friend-code and username
     * fields ended up under the keyboard.
     *
     * This provider subscribes to the IME insets directly, which is the only
     * thing that still reports the keyboard under edge-to-edge. Everything
     * keyboard-aware in the app reads from it.
     */
    <KeyboardProvider>
    <SafeAreaProvider>
      <StatusBar style="light" />
      {ready && (
        <ErrorBoundary onReset={recoverFromCrash}>
          <ScreenStack />
          {/* Bottom sheets draw here, not where they are declared — above the
              screens and the floating dock, anchored to the screen rather than
              to whatever scroll view happened to contain them. */}
          <SheetHost />
          <InviteBanner />
          {/* Above everything, including the banner: it is asked about an
              action the player just tried to take. */}
          <ConfirmDialog />
        </ErrorBoundary>
      )}
      {/* First launch only: asked once, above the hub so nothing behind it can
          be tapped, and below the loading screen so it never flashes during
          startup. Skipping keeps the minted guest handle. */}
      {ready && launched && !namePromptSeen && <ChooseNameScreen />}
      {!launched && <LoadingScreen done={ready} onHidden={onLaunched} />}
    </SafeAreaProvider>
    </KeyboardProvider>
  );
}
