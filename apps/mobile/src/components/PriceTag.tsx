/**
 * The "locked, costs N" chip shown on cosmetics the player doesn't own yet, and
 * the confirm sheet for buying one. Shared by the board themes and the avatar
 * grid so both read the same way. Currency-aware: gem-tier items carry the gem
 * glyph and charge the gem wallet (the server decides which — this is display).
 */

import { Text, View } from "react-native";
import { CoinGlyph } from "./CoinsPill";
import { GemGlyph } from "./GemGlyph";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { formatCompact } from "../lib/format";
import { font, palette, radius } from "../theme";
import { useT } from "../i18n";

export type PriceCurrency = "coins" | "gems";

/** Small price chip overlaid on a locked cosmetic tile. */
export function PriceTag({ price, currency = "coins" }: { price: number; currency?: PriceCurrency }) {
  const t = useT();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: "rgba(20,23,28,0.82)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.14)",
      }}
    >
      {currency === "gems" ? <GemGlyph size={11} /> : <CoinGlyph size={11} />}
      <Text style={{ fontFamily: font.mono, fontSize: 11, color: palette.porcelain }}>{formatCompact(price)}</Text>
    </View>
  );
}

interface BuySheetProps {
  title: string;
  price: number;
  /** Balance in the item's own currency (coins OR gems). */
  balance: number | null;
  currency?: PriceCurrency;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
  /** Short on funds — offer a doorway to top up (Get coins / Get gems). */
  onGetCurrency?: () => void;
  /**
   * A cheaper way to buy this AND its matching piece — the set (`set.<key>`).
   *
   * Offered here rather than as a shelf of its own because this is the moment
   * it is worth anything: the player has already decided they want the board.
   * A separate Sets tab would be a third place to browse the same nine things.
   */
  bundle?: { label: string; price: number; saving: number; onConfirm: () => void };
}

/** Confirm sheet. Spells out the price and the balance after, so a purchase is
 *  never a surprise — and says plainly that looks don't affect play. */
export function BuySheet({
  title,
  price,
  balance,
  currency = "coins",
  busy,
  error,
  onConfirm,
  onClose,
  onGetCurrency,
  bundle,
}: BuySheetProps) {
  const t = useT();
  const have = balance ?? 0;
  const affordable = have >= price;
  const after = have - price;
  const unit = currency === "gems" ? "gems" : "coins";

  return (
    <Sheet onClose={onClose}>
      <Text style={{ fontFamily: font.display, fontSize: 20, color: palette.porcelain }}>Unlock {title}</Text>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {currency === "gems" ? <GemGlyph size={15} /> : <CoinGlyph size={15} />}
        <Text style={{ fontFamily: font.mono, fontSize: 15, color: palette.porcelain }}>{price}</Text>
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
          {affordable ? `· you'll have ${after} left` : `· you have ${have}`}
        </Text>
      </View>

      {error ? (
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: "#E8705F" }}>{error}</Text>
      ) : (
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
          A different look, nothing more — it doesn't change how the game plays.
        </Text>
      )}

      <Button
        label={busy ? t("shop.unlocking") : affordable ? t("shop.unlock") : t("shop.notEnough", { unit })}
        onPress={onConfirm}
        disabled={busy || !affordable}
      />
      {bundle && bundle.price <= have ? (
        <Button
          label={`${bundle.label} · ${bundle.price} (save ${bundle.saving})`}
          variant="ghost"
          onPress={bundle.onConfirm}
          disabled={busy}
        />
      ) : null}
      {!affordable && onGetCurrency ? (
        <Button label={currency === "gems" ? t("gems.getGems") : t("coins.getCoins")} variant="ghost" onPress={onGetCurrency} />
      ) : (
        <Button label={t("common.cancel")} onPress={onClose} variant="ghost" />
      )}
    </Sheet>
  );
}
