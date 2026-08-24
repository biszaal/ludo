/**
 * The hub's one dominant CTA: a big raised Porcelain piece with a two-line
 * label (PLAY over the mode + stake). Same depth recipe as Button — face over
 * a darker under-edge; pressing seats it without changing total height.
 */

import { Pressable, Text, View } from "react-native";
import { CoinGlyph } from "./CoinsPill";
import { formatCompact } from "../lib/format";
import { useLayout } from "../lib/useLayout";
import { playSound } from "../lib/sound";
import { tapLight } from "../lib/haptics";
import { depth, font, palette, radius, shade, space } from "../theme";

interface PlayCtaProps {
  onPress: () => void;
  /** Entry stake quoted under the label (from remote config). */
  stake: number;
  /** A match is being found — label swaps and presses are ignored. */
  busy?: boolean;
  /** Total height (face + under-edge) from the hub's budget. Unset — as in the
   *  quick-setup sheet — keeps the natural size the piece has always had. */
  height?: number;
}

export function PlayCta({ onPress, stake, busy = false, height }: PlayCtaProps) {
  const { scale } = useLayout();
  const face = palette.porcelain;
  const edge = shade(face, -0.45);
  // The type rides the piece: a budget that squeezes PLAY shrinks its label in
  // step, so the word never crowds the two edges it sits between.
  const natural = Math.round(60 * scale) + depth.edge;
  const k = (height ?? natural) / natural;
  const title = Math.round(Math.max(16, Math.min(30, 22 * scale * k)));
  const sub = Math.round(Math.max(10, Math.min(15, 12 * scale * k)));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy ? "Finding a match" : `Play, quick match, entry ${stake} coins`}
      onPress={() => {
        if (!busy) onPress();
      }}
      onPressIn={() => {
        playSound("tap");
        tapLight();
      }}
    >
      {({ pressed }) => {
        const down = pressed && !busy;
        return (
          <View
            style={{
              borderRadius: radius.lg,
              backgroundColor: edge,
              paddingBottom: down ? 1 : depth.edge,
              marginTop: down ? depth.edge - 1 : 0,
              ...depth.shadow,
            }}
          >
            <View
              style={{
                // Height, not minHeight, once budgeted: a minimum would win over
                // the budget on a short screen and put the tower back over the fold.
                height: height === undefined ? undefined : height - depth.edge,
                minHeight: height === undefined ? Math.round(60 * scale) : undefined,
                borderRadius: radius.lg,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: face,
                borderTopWidth: 1,
                borderTopColor: "rgba(255,255,255,0.6)",
                paddingHorizontal: space.xl,
                paddingVertical: space.sm,
                gap: 2,
              }}
            >
              <Text style={{ fontFamily: font.display, fontSize: title, color: palette.feltCharcoal, letterSpacing: 1 }}>
                {busy ? "FINDING…" : "PLAY"}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={{ fontFamily: font.medium, fontSize: sub, color: shade(palette.feltCharcoal, 0.35) }}>
                  {busy ? "Looking for opponents" : "Quick match ·"}
                </Text>
                {!busy && (
                  <>
                    <CoinGlyph size={sub} />
                    <Text style={{ fontFamily: font.mono, fontSize: sub, color: shade(palette.feltCharcoal, 0.35) }}>
                      {formatCompact(stake)}
                    </Text>
                  </>
                )}
              </View>
            </View>
          </View>
        );
      }}
    </Pressable>
  );
}
