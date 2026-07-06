import { useEffect } from "react";
import { AppState, View } from "react-native";
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
import { useOnlineStore } from "./src/store/onlineStore";
import { initSound, setMusicActive } from "./src/lib/sound";
import { initFeedback } from "./src/lib/feedback";
import { initDeepLinks } from "./src/lib/invite";
import { initProfileSync } from "./src/net/profileSync";
import { palette } from "./src/theme";

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    JetBrainsMono_500Medium,
  });
  useEffect(() => {
    void initSound();
    const stopFeedback = initFeedback();
    const stopProfileSync = initProfileSync();
    const stopDeepLinks = initDeepLinks();
    return () => {
      stopFeedback();
      stopProfileSync();
      stopDeepLinks();
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
      } else {
        online.setAway(true); // opponents see an "Away" badge while I'm out
      }
    });
    return () => sub.remove();
  }, []);

  // Proceed once fonts load OR fail — never block the UI on a font error
  // (RN falls back to the system font).
  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: palette.feltCharcoal }} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <ScreenStack />
    </SafeAreaProvider>
  );
}
