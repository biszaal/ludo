/**
 * Home hub — a fixed, no-scroll arcade lobby in the app's own felt language:
 * status header, the equipped-cosmetics diorama in the lamplight over one
 * dominant PLAY CTA, a terse mode-tile row, and the drawn-glyph dock. Only
 * the diorama flexes; everything else is fixed-height, so nothing can
 * overlap on small phones and the ad strip's height variance is absorbed.
 */

import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Canvas, Group } from "@shopify/react-native-skia";
import { TableBackground } from "../components/TableBackground";
import { PawnShape } from "../components/Board";
import { HeroDiorama } from "../components/HeroDiorama";
import { PlayCta } from "../components/PlayCta";
import { ModeTile } from "../components/ModeTile";
import { HomeDock } from "../components/HomeDock";
import { DailyChestTile } from "../components/DailyChestTile";
import { RoomSheet } from "../components/RoomSheet";
import { QuickSetupSheet } from "../components/QuickSetupSheet";
import { PlaySetupSheet, type PlayMode } from "../components/PlaySetupSheet";
import { ProfileChip } from "../components/ProfileChip";
import { CoinsPill } from "../components/CoinsPill";
import { GemsPill } from "../components/GemsPill";
import { GetCoinsSheet } from "../components/GetCoinsSheet";
import { GetGemsSheet } from "../components/GetGemsSheet";
import { AdSlot } from "../components/AdSlot";
import { CycleGlyph, PeopleGlyph } from "../components/HomeGlyphs";
import { ContentColumn } from "../components/ContentColumn";
import { stillDieColors } from "../components/DieStill";
import { useLayout } from "../lib/useLayout";
import { useWallet } from "../store/walletStore";
import { useConfig } from "../store/configStore";
import { BOARD_THEMES } from "../render/boardThemes";
import { resolveDiceSkin } from "../render/diceSkins";
import { useGameStore } from "../store/gameStore";
import { useOnlineStore } from "../store/onlineStore";
import { pollPresence, useFriends } from "../store/friendsStore";
import { useNav } from "../store/navStore";
import { useProfile } from "../store/profileStore";
import { useSettings } from "../store/settingsStore";
import { incomingRequests, onlineFriendCount } from "../lib/friendship";
import { nextDailyBonus } from "../lib/economy";
import { font, palette, space } from "../theme";

export function HomeScreen() {
  const [sheetMode, setSheetMode] = useState<PlayMode | null>(null);
  const [coinsSheet, setCoinsSheet] = useState(false);
  const [roomSheet, setRoomSheet] = useState(false);
  const [quickSheet, setQuickSheet] = useState(false);
  const [gemsSheet, setGemsSheet] = useState(false);
  const [dioramaBox, setDioramaBox] = useState({ w: 0, h: 0 });
  const newLocalGame = useGameStore((s) => s.newLocalGame);
  const boardTheme = BOARD_THEMES[useSettings((s) => s.boardThemeId)];
  const diceSkin = resolveDiceSkin(useProfile((s) => s.diceSkinId));
  // Entry fee is server-tunable; the store's constant is only an offline floor.
  const stake = useConfig((s) => s.config.economy.quickStake);
  const economy = useConfig((s) => s.config.economy);

  const onlineStatus = useOnlineStore((s) => s.status);
  const connecting = onlineStatus === "connecting";

  const push = useNav((s) => s.push);
  const friendships = useFriends((s) => s.friendships);
  const myUserId = useFriends((s) => s.userId);
  const presence = useFriends((s) => s.presence);
  const requestCount = incomingRequests(friendships, myUserId).length;
  const onlineCount = onlineFriendCount(friendships, myUserId, presence, Date.now());

  const streakDay = useWallet((s) => s.streakDay);
  const bonusClaimable = useWallet((s) => s.bonusClaimable);

  const { isTablet, scale } = useLayout();
  const s = (n: number) => Math.round(n * scale);

  // Balance freshness: on mount, and again whenever a game hands us back home
  // (the online store refreshes on finish; this catches stake debits too).
  const refreshWallet = useWallet((s) => s.refresh);
  useEffect(() => {
    void refreshWallet();
  }, [refreshWallet, onlineStatus]);

  // Warm the presence map so the friends-online line is real, not stale.
  useEffect(() => pollPresence(), []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />

      {/* The whole hub sits in a centered column: on a tablet it holds a
          comfortable width instead of stretching chips to the far edges; on a
          phone the column is full-width (a no-op). */}
      <ContentColumn style={{ flex: 1 }}>
      {/* Status header — wallet left, identity + settings right. The wordmark
          is dropped here (the diorama and app icon carry the brand; the
          animated mark still opens on the loading screen), so the two edges
          balance instead of piling four chips against the right. Fixed. */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <CoinsPill onPress={() => setCoinsSheet(true)} />
          <GemsPill onPress={() => setGemsSheet(true)} />
        </View>
        <ProfileChip />
      </View>

      {/* Hero zone — the only part of the column that flexes. */}
      <View style={{ flex: 1, paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm }}>
        <DailyChestTile
          onPress={() => setCoinsSheet(true)}
          claimable={bonusClaimable}
          streakDay={streakDay}
          nextBonus={nextDailyBonus(streakDay, economy)}
        />

        <View
          // Floor so the still-life never collapses when the ad claims its
          // strip on a short phone; tablet cap so a tall screen doesn't strand
          // acres of felt above and below a floating board.
          style={{ flex: 1, minHeight: 160, maxHeight: isTablet ? 560 : undefined, alignSelf: "stretch", justifyContent: "center" }}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setDioramaBox({ w: width, h: height });
          }}
        >
          <HeroDiorama theme={boardTheme} diceSkin={diceSkin} width={dioramaBox.w} height={dioramaBox.h} scale={scale} />
        </View>

        <PlayCta stake={stake} busy={connecting} onPress={() => setQuickSheet(true)} />

        {/* Real presence only — invisible (not collapsed) at zero so the
            layout never reflows and the number is never faked. */}
        <View style={{ height: s(18), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, opacity: onlineCount > 0 ? 1 : 0 }}>
          <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#4ADE80" }} />
          <Text style={{ fontFamily: font.medium, fontSize: s(13), color: palette.mutedSteel }}>
            {onlineCount === 1 ? "1 friend online" : `${onlineCount} friends online`}
          </Text>
        </View>
      </View>

      {/* Mode tiles — three across, deliberately equal (hub-only allowance). */}
      <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm }}>
        <ModeTile
          label="Vs AI"
          glyph={<VsAiGlyph theme={boardTheme} scale={scale} />}
          onPress={() => setSheetMode("ai")}
        />
        <ModeTile label="Pass & play" glyph={<CycleGlyph size={s(28)} />} onPress={() => setSheetMode("pass")} />
        <ModeTile label="Friends room" glyph={<PeopleGlyph size={s(28)} />} onPress={() => setRoomSheet(true)} />
      </View>

      {/* Dock — doorways to everything that isn't playing. */}
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm }}>
        <HomeDock
          onShop={() => push("shop")}
          onFriends={() => push("friends")}
          onAccount={() => push("account")}
          onHowToPlay={() => push("howToPlay")}
          requestCount={requestCount}
          onlineCount={onlineCount}
          equipped={stillDieColors(diceSkin, boardTheme)}
        />
      </View>
      </ContentColumn>

      {/* Anchored to the bottom edge: never rides over the hub, collapses to
          nothing unfilled (the diorama flex absorbs the difference). */}
      <AdSlot slot="home" />

      {sheetMode && (
        <PlaySetupSheet
          mode={sheetMode}
          onClose={() => setSheetMode(null)}
          onStart={(players, bots, rules) => {
            setSheetMode(null);
            newLocalGame({ players, bots, rules });
          }}
        />
      )}

      {coinsSheet && <GetCoinsSheet onClose={() => setCoinsSheet(false)} />}
      {gemsSheet && <GetGemsSheet onClose={() => setGemsSheet(false)} />}
      {roomSheet && <RoomSheet onClose={() => setRoomSheet(false)} />}
      {quickSheet && (
        <QuickSetupSheet
          onClose={() => setQuickSheet(false)}
          onNeedCoins={() => {
            setQuickSheet(false);
            setCoinsSheet(true);
          }}
        />
      )}
    </SafeAreaView>
  );
}

/** Two pawns squaring off — the vs-AI tile art, in the equipped theme. */
function VsAiGlyph({ theme, scale = 1 }: { theme: (typeof BOARD_THEMES)[keyof typeof BOARD_THEMES]; scale?: number }) {
  return (
    <Canvas style={{ width: 44 * scale, height: 32 * scale }}>
      <Group transform={[{ scale }]}>
        <Group transform={[{ translateX: 30 }, { translateY: 20 }]}>
          <PawnShape r={9} color={theme.team.blue} stroke={theme.pawnStroke} />
        </Group>
        <Group transform={[{ translateX: 14 }, { translateY: 22 }]}>
          <PawnShape r={11} color={theme.team.red} stroke={theme.pawnStroke} />
        </Group>
      </Group>
    </Canvas>
  );
}
