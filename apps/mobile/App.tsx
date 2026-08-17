import { useCallback, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  useFonts,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from "@expo-google-fonts/outfit";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import { ScreenStack } from "./src/components/ScreenStack";
import { InviteBanner } from "./src/components/InviteBanner";
import { LoadingScreen } from "./src/components/LoadingScreen";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { useOnlineStore } from "./src/store/onlineStore";
import { useNav } from "./src/store/navStore";
import { initSound, setMusicActive } from "./src/lib/sound";
import { initFeedback } from "./src/lib/feedback";
import { initDeepLinks } from "./src/lib/invite";
import { initPush } from "./src/lib/push";
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
  const onLaunched = useCallback(() => setLaunched(true), []);

  useEffect(() => {
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
    const stopFeedback = initFeedback();
    const stopProfileSync = initProfileSync();
    const stopDeepLinks = initDeepLinks();
    const stopFriends = initFriends();
    const stopPresence = initPresence();
    // Listener only — registration (and the OS permission prompt) is deferred
    // to the screens where push is obviously worth something. See lib/push.ts.
    const stopPush = initPush();
    return () => {
      stopFeedback();
      stopProfileSync();
      stopDeepLinks();
      stopFriends();
      stopPresence();
      stopPush();
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
    <SafeAreaProvider>
      <StatusBar style="light" />
      {ready && (
        <ErrorBoundary onReset={recoverFromCrash}>
          <ScreenStack />
          <InviteBanner />
        </ErrorBoundary>
      )}
      {!launched && <LoadingScreen done={ready} onHidden={onLaunched} />}
    </SafeAreaProvider>
  );
}
