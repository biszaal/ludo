/**
 * The hero preview at the top of the Shop / Customize browser — a large look at
 * the highlighted cosmetic before you equip or buy it:
 *  - avatar → the big drawn chip,
 *  - board  → a clean BoardSurface with NO tokens (BoardSurface reads no state),
 *  - dice   → the real in-game die you can TAP TO ROLL, so a skin's tumble,
 *             gradient and shaped pips all show exactly as they will in play.
 * Fixed height so switching categories never makes the layout jump.
 */

import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Canvas } from "@shopify/react-native-skia";
import { AvatarGlyph } from "./Avatar";
import { BoardSurface } from "./Board";
import { Dice } from "./Dice";
import { BOARD_THEMES, DEFAULT_THEME, type BoardTheme, type BoardThemeId } from "../render/boardThemes";
import { resolveDiceSkin } from "../render/diceSkins";
import type { CosmeticCategory } from "../lib/cosmetics";
import { depth, font, palette, radius, space } from "../theme";

const PREVIEW_H = 224;
const BOARD_SIZE = 176;

export function CosmeticPreview({
  category,
  itemId,
  boardTheme,
}: {
  category: CosmeticCategory;
  itemId: string;
  boardTheme: BoardTheme;
}) {
  return (
    <View
      style={{
        height: PREVIEW_H,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: palette.raisedSlate,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: palette.hairline,
        borderTopColor: depth.highlight,
      }}
    >
      {category === "avatar" ? <AvatarGlyph id={itemId} size={132} /> : null}
      {category === "board" ? <BoardPreview themeId={itemId} /> : null}
      {category === "dice" ? <DicePreview skinId={itemId} boardTheme={boardTheme} /> : null}
    </View>
  );
}

function BoardPreview({ themeId }: { themeId: string }) {
  const theme = BOARD_THEMES[themeId as BoardThemeId] ?? DEFAULT_THEME;
  return (
    <View style={{ borderRadius: radius.md, overflow: "hidden", ...depth.shadow }}>
      <Canvas style={{ width: BOARD_SIZE, height: BOARD_SIZE }}>
        <BoardSurface size={BOARD_SIZE} theme={theme} />
      </Canvas>
    </View>
  );
}

function DicePreview({ skinId, boardTheme }: { skinId: string; boardTheme: BoardTheme }) {
  const [seq, setSeq] = useState(0);
  const [value, setValue] = useState<number | null>(null);
  const skin = resolveDiceSkin(skinId);

  // Land back on the swirl whenever the previewed skin changes, so each skin
  // reads as a fresh "tap to roll" rather than freezing on the last face.
  useEffect(() => {
    setValue(null);
  }, [skinId]);

  const roll = () => {
    setValue(1 + Math.floor(Math.random() * 6));
    setSeq((s) => s + 1);
  };

  return (
    <View style={{ alignItems: "center", gap: space.md }}>
      <Dice
        value={value}
        spinSeq={seq}
        size={104}
        idle={value === null}
        theme={boardTheme}
        skin={skin}
        onRollPress={roll}
        pressLabel="Roll the dice"
      />
      <Text style={{ fontFamily: font.medium, fontSize: 12, color: palette.mutedSteel }}>Tap to roll</Text>
    </View>
  );
}
