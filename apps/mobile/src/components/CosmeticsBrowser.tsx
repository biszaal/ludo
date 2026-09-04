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
import { GemsSection } from "./GemsSection";
import { goToTab } from "./TabDock";
import { Button } from "./Button";
import { resolveAvatarId } from "../render/avatars";
import { resolveBoardTheme, type BoardThemeId } from "../render/boardThemes";
import { DICE_SKINS, resolveDiceSkin, type DiceSkinId } from "../render/diceSkins";
import { cosmeticItems, ownedItems, sellableItems, type CosmeticCategory, type CosmeticItem } from "../lib/cosmetics";
import { useCosmeticsUI, type ShopTab } from "../store/cosmeticsUI";
import { catalogKnown, currencyOf, isUnlocked, priceOf, useEntitlements } from "../store/entitlementsStore";
import { useProfile } from "../store/profileStore";
import { useSettings } from "../store/settingsStore";
import { useWallet } from "../store/walletStore";
import { useNav } from "../store/navStore";
import { font, palette, radius, space } from "../theme";
import { SkeletonBlock, SkeletonGroup, SkeletonLine } from "./Skeleton";
import { LoadFailed } from "./LoadFailed";
import { useLoadPhase } from "../lib/useLoadPhase";

const TABS: { key: ShopTab; label: string }[] = [
  { key: "avatar", label: "Avatar" },
  { key: "board", label: "Board" },
  { key: "dice", label: "Dice" },
];

const COLS = 4;

/**
 * Skeleton geometry per category, matched to the swatch it stands in for —
 * AvatarSwatch's 56pt glyph and no label, ThemeSwatch's 64pt board thumbnail
 * over a label, DiceSwatch's 72pt die over a label. One shape for all three
 * would make the grid jump the moment the catalog landed, which is the one
 * thing a skeleton exists to prevent.
 */
const SWATCH_SKELETON: Record<CosmeticCategory, { thumb: number; rad: number; label: boolean; gap: number }> = {
  avatar: { thumb: 56, rad: radius.md, label: false, gap: 0 },
  board: { thumb: 64, rad: 8, label: true, gap: space.sm },
  dice: { thumb: 72, rad: radius.md, label: true, gap: space.xs },
};

export function CosmeticsBrowser({ mode }: { mode: "locker" | "shop" }) {
  const category = useCosmeticsUI((s) => s.category);
  const tab = useCosmeticsUI((s) => s.tab);
  const setTab = useCosmeticsUI((s) => s.setTab);
  // Gems are not a cosmetic and the locker has no business selling them, so
  // the fourth tab exists in the Shop only.
  const tabs = mode === "shop" ? [...TABS, { key: "gems" as const, label: "Gems" }] : TABS;
  const showingGems = mode === "shop" && tab === "gems";
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
  const boardTheme = resolveBoardTheme(boardThemeId);
  const push = useNav((s) => s.push);

  const [highlights, setHighlights] = useState<Record<CosmeticCategory, string | null>>({
    avatar: null,
    board: null,
    dice: null,
  });
  const [pending, setPending] = useState<{ category: CosmeticCategory; item: CosmeticItem } | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);

  // Ownership is server-held; this surface only reflects it.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The equipped id per category (avatar id normalized past legacy slugs so it
  // lines up with the catalog tiles).
  const equippedId =
    category === "avatar"
      ? resolveAvatarId(avatarId)
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

  const items = mode === "locker" ? ownedItems(category, owned, prices) : sellableItems(category, owned, prices);
  const fillers = (COLS - (items.length % COLS)) % COLS;

  // The catalog is what both modes are actually waiting on: the shop filters
  // its grid through it, and the locker's "owned" verdict is unanswerable
  // without it (isUnlocked fails closed on an unknown catalog, by design).
  const failed = useEntitlements((s) => s.failed);
  const view = useLoadPhase(catalogKnown(prices), failed);
  const swatchSkeleton = SWATCH_SKELETON[category];

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
        {tabs.map((t) => {
          const active = t.key === (mode === "shop" ? tab : category);
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => (mode === "shop" ? setTab(t.key) : setCategory(t.key as CosmeticCategory))}
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

      {showingGems ? <GemsSection /> : <>
      {/* Hero preview + caption */}
      <View style={{ gap: space.sm }}>
        <CosmeticPreview category={category} itemId={highlightId} boardTheme={boardTheme} />
        <View style={{ alignItems: "center", gap: 2 }}>
          {view === "skeleton" ? (
            <SkeletonGroup label="Loading item details" style={{ alignItems: "center", gap: 6 }}>
              <SkeletonLine width={96} size={17} index={0} />
              <SkeletonLine width={64} size={12} index={1} />
            </SkeletonGroup>
          ) : (
            <>
              <Text style={{ fontFamily: font.display, fontSize: 17, color: palette.porcelain, textTransform: "capitalize" }}>
                {highlightItem?.label ?? highlightId}
              </Text>
              <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>{status}</Text>
            </>
          )}
        </View>
      </View>

      {/* Item grid */}
      {view === "stalled" ? (
        <LoadFailed
          message={
            mode === "shop"
              ? "The shop didn't load. Check your connection and try again."
              : "Your collection didn't load. Check your connection and try again."
          }
          onRetry={() => void refresh()}
        />
      ) : view === "skeleton" ? (
        <SkeletonGroup
          label={mode === "shop" ? "Loading the shop" : "Loading your collection"}
          style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space.lg }}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <View
              key={`sk-${i}`}
              style={{ width: "22%", alignItems: "center", padding: space.xs, gap: swatchSkeleton.gap }}
            >
              <SkeletonBlock
                width={swatchSkeleton.thumb}
                height={swatchSkeleton.thumb}
                rad={swatchSkeleton.rad}
                index={i}
              />
              {swatchSkeleton.label ? (
                <SkeletonLine width={Math.round(swatchSkeleton.thumb * 0.6)} size={12} index={i} />
              ) : null}
            </View>
          ))}
        </SkeletonGroup>
      ) : (
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
                  theme={resolveBoardTheme(item.id)}
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
      )}

      {mode === "locker" ? (
        <Button label="Shop for more" variant="ghost" onPress={() => push("shop")} />
      ) : null}
      </>}

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
                  // Straight to where gems come from — the same destination the
                  // gem pill goes to, rather than a sheet over a sheet.
                  setPending(null);
                  setTab("gems");
                  goToTab("shop");
                }
              : undefined
          }
        />
      ) : null}

    </View>
  );
}
