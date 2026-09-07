/**
 * The language picker.
 *
 * Every language is named in its OWN script — see LOCALE_NAMES. A player
 * looking for their language is scanning for the shape of their own writing,
 * and a list that says "Hindi" in Latin letters is exactly the list somebody
 * who reads हिन्दी cannot use.
 *
 * "Match my phone" is a real option rather than an implicit default, and it is
 * the top row. Following the device is what the app does before anyone touches
 * this, so a player who opens the picker out of curiosity needs a way back to
 * where they started — and a phone whose language later changes should follow
 * it, which a pinned choice would not.
 */

import { ScrollView, Text, View } from "react-native";
import { Sheet } from "./Sheet";
import { Surface3D } from "./Surface3D";
import { Pressable } from "react-native";
import { LOCALES, LOCALE_NAMES, useLocale, useT, type Locale } from "../i18n";
import { font, palette, radius, space } from "../theme";

export function LanguageSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const chosen = useLocale((s) => s.chosen);
  const active = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);

  const pick = (next: Locale | null) => {
    setLocale(next);
    onClose();
  };

  return (
    <Sheet title={t("settings.language")} onClose={onClose}>
      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: space.xs }}>
        <Option
          label={t("settings.languageSystem")}
          // The device's answer, so "Match my phone" says what it will get
          // rather than leaving the player to find out by choosing it.
          note={LOCALE_NAMES[active]}
          selected={chosen === null}
          onPress={() => pick(null)}
        />
        {LOCALES.map((l) => (
          <Option
            key={l}
            label={LOCALE_NAMES[l]}
            selected={chosen === l}
            onPress={() => pick(l)}
          />
        ))}
      </ScrollView>
    </Sheet>
  );
}

function Option({
  label,
  note,
  selected,
  onPress,
}: {
  label: string;
  note?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={note ? `${label}, ${note}` : label}
      onPress={onPress}
    >
      {({ pressed }) => (
        <Surface3D
          pressed={pressed}
          rad={radius.md}
          faceStyle={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.md,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 16, color: palette.porcelain }}>
              {label}
            </Text>
            {note ? (
              <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel }}>
                {note}
              </Text>
            ) : null}
          </View>
          {/* A mark rather than a colour change: the rows differ in script and
              length already, and colour alone would be the only signal for a
              player who cannot distinguish it. */}
          {selected ? (
            <Text style={{ fontFamily: font.semibold, fontSize: 18, color: palette.porcelain }}>✓</Text>
          ) : null}
        </Surface3D>
      )}
    </Pressable>
  );
}
