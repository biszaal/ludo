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
import { Text, useWindowDimensions, View } from "react-native";
import { Canvas } from "@shopify/react-native-skia";
import { AvatarGlyph } from "./Avatar";
import { BoardSurface } from "./Board";
import { Dice } from "./Dice";
import { resolveBoardTheme, type BoardTheme } from "../render/boardThemes";
import { resolveDiceSkin } from "../render/diceSkins";
import type { CosmeticCategory } from "../lib/cosmetics";
import { depth, font, palette, radius, space } from "../theme";
import { useT } from "../i18n";

/**
 * The preview is the tallest fixed thing on the screen, and since it became
 * PINNED (the grid scrolls under it) its height is taken straight out of the
 * grid's. At 224 on a 667pt phone that left the locker's grid 67pt — under one
 * row — so it scales with the window instead, and only on the short phones
 * that cannot afford it: the clamp keeps 224 on anything 862pt or taller,
 * which is every current phone and every tablet.
 */
const PREVIEW_MAX = 224;
const PREVIEW_MIN = 150;
const previewHeight = (windowHeight: number) =>
  Math.round(Math.max(PREVIEW_MIN, Math.min(PREVIEW_MAX, windowHeight * 0.26)));

/** The art inside keeps its proportion of the box, whatever the box became. */
const BOARD_RATIO = 176 / 224;
const AVATAR_RATIO = 132 / 224;
const DIE_RATIO = 104 / 224;
/** The die is tappable, so it shrinks with the box but never past a comfortable target. */
const DIE_MIN = 84;

export function CosmeticPreview({
  category,
  itemId,
  boardTheme,
}: {
  category: CosmeticCategory;
  itemId: string;
  boardTheme: BoardTheme;
}) {
  const { height } = useWindowDimensions();
  const boxH = previewHeight(height);
  return (
    <View
      style={{
        height: boxH,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: palette.raisedSlate,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: palette.hairline,
        borderTopColor: depth.highlight,
      }}
    >
      {category === "avatar" ? <AvatarGlyph id={itemId} size={Math.round(boxH * AVATAR_RATIO)} /> : null}
      {category === "board" ? <BoardPreview themeId={itemId} size={Math.round(boxH * BOARD_RATIO)} /> : null}
      {category === "dice" ? <DicePreview skinId={itemId} boardTheme={boardTheme} size={Math.max(DIE_MIN, Math.round(boxH * DIE_RATIO))} /> : null}
    </View>
  );
}

function BoardPreview({ themeId, size }: { themeId: string; size: number }) {
  const theme = resolveBoardTheme(themeId);
  return (
    <View style={{ borderRadius: radius.md, overflow: "hidden", ...depth.shadow }}>
      <Canvas style={{ width: size, height: size }}>
        <BoardSurface size={size} theme={theme} />
      </Canvas>
    </View>
  );
}

function DicePreview({ skinId, boardTheme, size }: { skinId: string; boardTheme: BoardTheme; size: number }) {
  const t = useT();
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
        size={size}
        idle={value === null}
        theme={boardTheme}
        skin={skin}
        onRollPress={roll}
        pressLabel={t("game.rollTheDice")}
      />
      <Text style={{ fontFamily: font.medium, fontSize: 12, color: palette.mutedSteel }}>{t("game.tapToRoll")}</Text>
    </View>
  );
}
