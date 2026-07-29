/**
 * The shared cosmetics browser behind both the Shop and the Customize locker.
 * One data-driven surface — category tabs (Avatar / Board / Dice), a hero
 * preview of the highlighted item, and a grid — parametrized by `mode`:
 *
 *  - "locker" (Profile): shows only OWNED items; tapping equips; a "Shop for
 *    more" button bridges to the store.
 *  - "shop":  shows EVERYTHING; owned items equip on tap, locked ones open the
 *    BuySheet (and equip on a successful purchase).
 *
 * Tapping any tile updates the hero preview first, so you always see a big,
 * live look (a clean board, a tap-to-roll die) before it changes anything.
 * Buy/equip reuse the existing entitlements machinery unchanged.
 */

import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AvatarSwatch } from "./AvatarSwatch";
import { ThemeSwatch } from "./ThemeSwatch";
import { DiceSwatch } from "./DiceSwatch";
import { CosmeticPreview } from "./CosmeticPreview";
import { BuySheet } from "./PriceTag";
import { GetGemsSheet } from "./GetGemsSheet";
import { Button } from "./Button";
import { avatarById } from "../render/avatars";
import { BOARD_THEMES, type BoardThemeId } from "../render/boardThemes";
import { DICE_SKINS, resolveDiceSkin, type DiceSkinId } from "../render/diceSkins";
import { cosmeticItems, ownedItems, type CosmeticCategory, type CosmeticItem } from "../lib/cosmetics";
import { useCosmeticsUI } from "../store/cosmeticsUI";
import { currencyOf, isUnlocked, priceOf, useEntitlements } from "../store/entitlementsStore";
import { useProfile } from "../store/profileStore";
import { useSettings } from "../store/settingsStore";
import { useWallet } from "../store/walletStore";
import { useNav } from "../store/navStore";
import { font, palette, radius, space } from "../theme";

const TABS: { key: CosmeticCategory; label: string }[] = [
  { key: "avatar", label: "Avatar" },
  { key: "board", label: "Board" },
  { key: "dice", label: "Dice" },
];

const COLS = 4;

export function CosmeticsBrowser({ mode }: { mode: "locker" | "shop" }) {
  const category = useCosmeticsUI((s) => s.category);
  const setCategory = useCosmeticsUI((s) => s.setCategory);

  const owned = useEntitlements((s) => s.owned);
  const prices = useEntitlements((s) => s.prices);
  const currencies = useEntitlements((s) => s.currencies);
  const buying = useEntitlements((s) => s.buying);
  const buy = useEntitlements((s) => s.buy);
  const refresh = useEntitlements((s) => s.refresh);
  const balance = useWallet((s) => s.balance);
  const gems = useWallet((s) => s.gems);

  const avatarId = useProfile((s) => s.avatarId);
  const diceSkinId = useProfile((s) => s.diceSkinId);
  const setAvatar = useProfile((s) => s.setAvatar);
  const setDiceSkin = useProfile((s) => s.setDiceSkin);
  const boardThemeId = useSettings((s) => s.boardThemeId);
  const setBoardTheme = useSettings((s) => s.setBoardTheme);
  const boardTheme = BOARD_THEMES[boardThemeId];
  const push = useNav((s) => s.push);

  const [highlights, setHighlights] = useState<Record<CosmeticCategory, string | null>>({
    avatar: null,
    board: null,
    dice: null,
  });
  const [pending, setPending] = useState<{ category: CosmeticCategory; item: CosmeticItem } | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [gemsSheet, setGemsSheet] = useState(false);

  // Ownership is server-held; this surface only reflects it.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The equipped id per category (avatar id normalized past legacy slugs so it
  // lines up with the catalog tiles).
  const equippedId =
    category === "avatar"
      ? avatarById(avatarId).id
      : category === "board"
        ? boardThemeId
        : resolveDiceSkin(diceSkinId).id;

  // Preview target: the last-tapped item, defaulting to whatever is equipped.
  const highlightId = highlights[category] ?? equippedId;

  const equipIn = (cat: CosmeticCategory, id: string) => {
    if (cat === "avatar") setAvatar(id);
    else if (cat === "board") setBoardTheme(id as BoardThemeId);
    else setDiceSkin(id);
  };

  const onSelect = (item: CosmeticItem, unlocked: boolean) => {
    setHighlights((h) => ({ ...h, [category]: item.id }));
    if (unlocked) {
      equipIn(category, item.id);
    } else {
      setBuyError(null);
      setPending({ category, item });
    }
  };

  const confirmBuy = async () => {
    if (!pending) return;
    setBuyError(null);
    const err = await buy(pending.item.sku);
    if (err) {
      setBuyError(err);
      return;
    }
    equipIn(pending.category, pending.item.id);
    setPending(null);
  };

  const items = mode === "locker" ? ownedItems(category, owned, prices) : cosmeticItems(category);
  const fillers = (COLS - (items.length % COLS)) % COLS;

  const highlightItem = cosmeticItems(category).find((it) => it.id === highlightId);
  const highlightOwned = highlightItem ? isUnlocked(owned, prices, highlightItem.sku) : true;
  const status =
    highlightId === equippedId ? "Equipped" : highlightOwned ? "In your collection" : "Not yet unlocked";

  return (
    <View style={{ gap: space.lg }}>
      {/* Category tabs */}
      <View
        style={{
          flexDirection: "row",
          backgroundColor: palette.raisedSlate,
          borderRadius: radius.pill,
          padding: 4,
          borderWidth: 1,
          borderColor: palette.hairline,
        }}
      >
        {TABS.map((t) => {
          const active = t.key === category;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setCategory(t.key)}
              style={{
                flex: 1,
                paddingVertical: space.sm,
                borderRadius: radius.pill,
                backgroundColor: active ? palette.liftedSlate : "transparent",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: active ? font.semibold : font.medium,
                  fontSize: 14,
                  color: active ? palette.porcelain : palette.mutedSteel,
                }}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Hero preview + caption */}
      <View style={{ gap: space.sm }}>
        <CosmeticPreview category={category} itemId={highlightId} boardTheme={boardTheme} />
        <View style={{ alignItems: "center", gap: 2 }}>
          <Text style={{ fontFamily: font.display, fontSize: 17, color: palette.porcelain, textTransform: "capitalize" }}>
            {highlightItem?.label ?? highlightId}
          </Text>
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>{status}</Text>
        </View>
      </View>

      {/* Item grid */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space.lg }}>
        {items.map((item) => {
          const unlocked = isUnlocked(owned, prices, item.sku);
          const selected = item.id === highlightId;
          const locked = mode === "shop" && !unlocked;
          const price = priceOf(prices, item.sku);
          const currency = currencyOf(currencies, item.sku);
          if (category === "avatar") {
            return (
              <AvatarSwatch
                key={item.id}
                id={item.id}
                selected={selected}
                price={price}
                currency={currency}
                locked={locked}
                onSelect={() => onSelect(item, unlocked)}
              />
            );
          }
          if (category === "board") {
            return (
              <ThemeSwatch
                key={item.id}
                theme={BOARD_THEMES[item.id as BoardThemeId]}
                selected={selected}
                price={price}
                currency={currency}
                locked={locked}
                onSelect={() => onSelect(item, unlocked)}
              />
            );
          }
          return (
            <DiceSwatch
              key={item.id}
              skin={DICE_SKINS[item.id as DiceSkinId]}
              theme={boardTheme}
              selected={selected}
              price={price}
              currency={currency}
              locked={locked}
              onSelect={() => onSelect(item, unlocked)}
            />
          );
        })}
        {Array.from({ length: fillers }).map((_, i) => (
          <View key={`filler-${i}`} style={{ width: "22%" }} />
        ))}
      </View>

      {mode === "locker" ? (
        <Button label="Shop for more" variant="ghost" onPress={() => push("shop")} />
      ) : null}

      {pending ? (
        <BuySheet
          title={pending.category === "board" ? `the ${pending.item.label} board` : `this ${pending.category}`}
          price={priceOf(prices, pending.item.sku)}
          balance={currencyOf(currencies, pending.item.sku) === "gems" ? gems : balance}
          currency={currencyOf(currencies, pending.item.sku)}
          busy={buying === pending.item.sku}
          error={buyError}
          onConfirm={() => void confirmBuy()}
          onClose={() => setPending(null)}
          onGetCurrency={
            currencyOf(currencies, pending.item.sku) === "gems"
              ? () => {
                  setPending(null);
                  setGemsSheet(true);
                }
              : undefined
          }
        />
      ) : null}

      {gemsSheet ? <GetGemsSheet onClose={() => setGemsSheet(false)} /> : null}
    </View>
  );
}
