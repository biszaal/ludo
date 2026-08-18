/**
 * The daily bonus, as a streak calendar rather than a line in a list.
 *
 * Seven cells laid out 3 / 3 / 1: the finale is a full-width row, not a seventh
 * equal tile, because it pays gems and deserves to look like the thing you came
 * back for. That asymmetry is also what keeps this off DESIGN.md §7's banned
 * "equal-card grid" — the shape carries the hierarchy.
 *
 * This is the ONLY place a bonus is claimed. GetCoinsSheet links here rather
 * than claiming inline, so there is one claim path and one set of edge cases.
 * The server is idempotent by UTC date regardless (opDailyBonus CAS), so a
 * double-tap or a second device can't pay twice — the UI just shouldn't imply
 * otherwise.
 */

import { useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { Surface3D } from "./Surface3D";
import { Confetti } from "./Confetti";
import { CoinGlyph } from "./CoinsPill";
import { GemGlyph } from "./GemGlyph";
import { CheckGlyph, ChestGlyph } from "./HomeGlyphs";
import { useWallet } from "../store/walletStore";
import { isTimeout } from "../net/api";
import { useConfig } from "../store/configStore";
import { dailyBonusLadder, type BonusDay } from "../lib/economy";
import { formatExact } from "../lib/format";
import { playSound } from "../lib/sound";
import { win as winHaptic } from "../lib/haptics";
import { depth, font, palette, radius, space } from "../theme";

const GOLD = "#F5C542";
const COIN_CONFETTI = ["#F5C542", "#FFE08A", "#C8951B"];

export function DailyBonusSheet({ onClose }: { onClose: () => void }) {
  const { width } = useWindowDimensions();
  const economy = useConfig((s) => s.config.economy);
  const streakDay = useWallet((s) => s.streakDay);
  const claimable = useWallet((s) => s.bonusClaimable);
  const claimDailyBonus = useWallet((s) => s.claimDailyBonus);

  const [busy, setBusy] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const ladder = dailyBonusLadder(economy);
  // Banked days are what you've already claimed; the claimable cell is the next
  // one up. Clamped so a streak sitting at the ceiling still highlights day 7
  // rather than running off the end of the ladder.
  const bankedDays = Math.min(streakDay, economy.streakMaxDay);
  const todayIndex = claimable ? Math.min(bankedDays, economy.streakMaxDay - 1) : -1;

  const onClaim = async () => {
    if (busy || !claimable) return;
    setBusy(true);
    try {
      const claimed = await claimDailyBonus();
      if (claimed > 0) {
        playSound("cheer");
        winHaptic();
        setCelebrating(true);
        setNote(null);
      } else {
        // Already taken today — another device, or a retry that raced the claim.
        setNote("Today's bonus is already claimed. Come back tomorrow.");
      }
      await useWallet.getState().refresh();
    } catch (e) {
      // A failed request is NOT a spent bonus. Saying "already claimed" here
      // sent players away from coins that were still theirs to take; the refresh
      // below puts the button back so they can simply try again.
      //
      // An UNANSWERED call is different from a refusal: the claim may have been
      // applied and only the reply was lost, so telling the player to check
      // their connection is wrong as often as it is right. The claim is
      // idempotent by construction — daily_bonus_claim (0033) does the whole
      // thing in one transaction under an ext_id of daily:<user>:<date> — so
      // simply asking again is safe, and answers the question properly whether
      // the first attempt landed or not.
      let settled = false;
      if (isTimeout(e)) {
        try {
          const again = await claimDailyBonus();
          if (again > 0) {
            playSound("cheer");
            winHaptic();
            setCelebrating(true);
            setNote(null);
          } else {
            setNote("Today's bonus is already claimed. Come back tomorrow.");
          }
          settled = true;
        } catch {
          // still unreachable — fall through to the connection note
        }
      }
      if (!settled) {
        // Say what actually went wrong. A blanket "check your connection" over
        // every failure is why this was impossible to diagnose from a
        // screenshot: an unreachable server, a refused claim and a bug in the
        // client all read identically. Only a genuinely unanswered call gets
        // the connection wording now.
        setNote(
          isTimeout(e)
            ? "Couldn't reach the server. Check your connection and try again."
            : `Couldn't claim the bonus: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      await useWallet.getState().refresh();
    } finally {
      setBusy(false);
    }
  };

  const rowOne = ladder.slice(0, 3);
  const rowTwo = ladder.slice(3, 6);
  const finale = ladder[6] ?? ladder[ladder.length - 1];
  const finaleIndex = ladder.length - 1;

  return (
    <Sheet onClose={onClose} title="Daily bonus">
      <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
        Play any day to keep the streak going. Miss one and it starts over.
      </Text>

      <View style={{ flexDirection: "row", gap: space.sm }}>
        {rowOne.map((d, i) => (
          <DayCell key={d.day} day={d} state={cellState(i, todayIndex, bankedDays)} />
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {rowTwo.map((d, i) => (
          <DayCell key={d.day} day={d} state={cellState(i + 3, todayIndex, bankedDays)} />
        ))}
      </View>
      {finale ? <FinaleCell day={finale} state={cellState(finaleIndex, todayIndex, bankedDays)} /> : null}

      {note ? (
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
          {note}
        </Text>
      ) : null}

      {claimable ? (
        <Button label={busy ? "Claiming…" : "Claim now"} onPress={() => void onClaim()} disabled={busy} />
      ) : (
        <Text style={{ fontFamily: font.medium, fontSize: 14, color: palette.mutedSteel, textAlign: "center" }}>
          Claimed today — the next one unlocks tomorrow.
        </Text>
      )}

      {celebrating ? (
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
          <Confetti width={width} height={520} originX={width / 2} originY={140} colors={COIN_CONFETTI} />
        </View>
      ) : null}
    </Sheet>
  );
}

type CellState = "claimed" | "today" | "future";

/** Days below the banked count are done; the claimable one is today. */
function cellState(index: number, todayIndex: number, bankedDays: number): CellState {
  if (index === todayIndex) return "today";
  return index < bankedDays ? "claimed" : "future";
}

function DayCell({ day, state }: { day: BonusDay; state: CellState }) {
  return (
    <View style={{ flex: 1 }}>
      <Surface3D
        rad={radius.md}
        edge={state === "today" ? 3 : 2}
        faceColor={state === "today" ? palette.liftedSlate : palette.raisedSlate}
        faceStyle={{
          paddingVertical: space.md,
          paddingHorizontal: space.xs,
          gap: space.xs,
          alignItems: "center",
          borderTopWidth: state === "today" ? 1 : 0,
          borderTopColor: depth.highlight,
          opacity: state === "claimed" ? 0.45 : 1,
        }}
      >
        <Text style={{ fontFamily: font.medium, fontSize: 11, color: palette.mutedSteel }}>Day {day.day}</Text>
        {state === "claimed" ? (
          <CheckGlyph size={22} color={palette.feltCharcoal} discColor={palette.mutedSteel} />
        ) : (
          <ChestGlyph size={22} open={state === "today"} color={state === "today" ? "#C8951B" : palette.mutedSteel} />
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <CoinGlyph size={10} />
          <Text
            style={{
              fontFamily: font.mono,
              fontSize: 11,
              color: state === "today" ? GOLD : palette.mutedSteel,
            }}
          >
            {formatExact(day.coins)}
          </Text>
        </View>
      </Surface3D>
    </View>
  );
}

/** The streak finale: full width, and the only cell that quotes gems. */
function FinaleCell({ day, state }: { day: BonusDay; state: CellState }) {
  const live = state === "today";
  return (
    <Animated.View entering={FadeIn.duration(200)}>
      <Surface3D
        rad={radius.lg}
        edge={live ? 4 : 2}
        faceColor={live ? palette.liftedSlate : palette.raisedSlate}
        faceStyle={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          padding: space.lg,
          borderTopWidth: live ? 1 : 0,
          borderTopColor: depth.highlight,
          opacity: state === "claimed" ? 0.45 : 1,
        }}
      >
        {state === "claimed" ? (
          <CheckGlyph size={32} color={palette.feltCharcoal} discColor={palette.mutedSteel} />
        ) : (
          <ChestGlyph size={32} open={live} color={live ? "#C8951B" : palette.mutedSteel} />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>
            Day {day.day} · streak reward
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <CoinGlyph size={13} />
              <Text style={{ fontFamily: font.mono, fontSize: 13, color: live ? GOLD : palette.mutedSteel }}>
                {formatExact(day.coins)}
              </Text>
            </View>
            {day.gems > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <GemGlyph size={13} />
                <Text style={{ fontFamily: font.mono, fontSize: 13, color: live ? palette.porcelain : palette.mutedSteel }}>
                  {formatExact(day.gems)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Surface3D>
    </Animated.View>
  );
}
