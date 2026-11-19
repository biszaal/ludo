/**
 * The invite card on the Friends screen (referral programme, 0082).
 *
 * The offer, a Share button for the player's friend code, and one line per
 * friend they brought with how far along that friend is. Renders nothing until
 * the server has answered with the programme switched on, so an old server or a
 * failed fetch leaves the Friends screen exactly as it was.
 */

import { useEffect } from "react";
import { Share, Text, View } from "react-native";
import { Surface3D } from "./Surface3D";
import { Button } from "./Button";
import { CoinGlyph } from "./CoinsPill";
import { useReferrals } from "../store/referralStore";
import { useFriends } from "../store/friendsStore";
import { useProfile } from "../store/profileStore";
import { cardRows, friendShareMessage } from "../lib/referrals";
import { INVITE_BASE } from "../lib/inviteLinks";
import { tapLight } from "../lib/haptics";
import { font, palette, space } from "../theme";
import { useT } from "../i18n";

export function InviteCard() {
  const t = useT();
  const data = useReferrals((s) => s.data);
  const myCode = useFriends((s) => s.myCode);
  const displayName = useProfile((s) => s.displayName);

  useEffect(() => {
    void useFriends.getState().loadMyCode();
  }, []);

  if (!data || !data.config.enabled) return null;
  const { inviterCoins, inviteeCoins, gamesRequired } = data.config;
  const rows = cardRows(data, t);

  const onShare = async () => {
    if (!myCode) return;
    tapLight();
    try {
      await Share.share({ message: friendShareMessage(t, displayName, myCode, INVITE_BASE, true) });
    } catch {
      // dismissed, or nothing to share to
    }
  };

  return (
    <Surface3D faceStyle={{ padding: space.lg, gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <CoinGlyph size={20} />
        <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 16, color: palette.porcelain }}>
          {t("referral.cardTitle", { inviterCoins, inviteeCoins })}
        </Text>
      </View>
      <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
        {t("referral.cardRule", { games: gamesRequired })}
      </Text>
      {myCode ? <Button label={t("referral.shareCode", { code: myCode })} onPress={() => void onShare()} /> : null}
      {rows.length === 0 ? (
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>{t("referral.empty")}</Text>
      ) : (
        <View style={{ gap: space.sm }}>
          {rows.map((row) => (
            <View key={row.id} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 15, color: palette.porcelain }} numberOfLines={1}>
                {row.name}
              </Text>
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: row.done ? palette.porcelain : palette.mutedSteel }}>
                {row.status}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Surface3D>
  );
}
