/**
 * "+200 coins: Ravi played 2 games" — the pop-up for a referral reward that has
 * landed (0082). Home shows one at a time, and only when no other Home sheet is
 * open; closing it records the reward as announced on this device.
 */

import { Text, View } from "react-native";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { CoinGlyph } from "./CoinsPill";
import type { Announcement } from "../lib/referrals";
import { font, palette, space } from "../theme";
import { useT } from "../i18n";

export function ReferralNotice({
  item,
  gamesRequired,
  onClose,
}: {
  item: Announcement;
  gamesRequired: number;
  onClose: () => void;
}) {
  const t = useT();
  const name = item.name ?? t("referral.newPlayer");
  const line =
    item.side === "inviter"
      ? t("referral.noticeInviter", { coins: item.coins, name, games: gamesRequired })
      : t("referral.noticeInvitee", { coins: item.coins, name });

  return (
    <Sheet onClose={onClose} variant="popup">
      <View style={{ alignItems: "center", gap: space.lg, paddingVertical: space.md }}>
        <CoinGlyph size={44} />
        <Text style={{ fontFamily: font.display, fontSize: 20, color: palette.porcelain, textAlign: "center" }}>{line}</Text>
        <Button label={t("common.continue")} onPress={onClose} />
      </View>
    </Sheet>
  );
}
