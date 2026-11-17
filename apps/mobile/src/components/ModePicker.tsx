/**
 * The mode row of a setup sheet, with the chosen mode's one-line rule under it.
 * Renders nothing when there is only one mode to pick, so a sheet whose server
 * has not opened Blitz looks exactly as it did before modes existed.
 */

import { Text, View } from "react-native";
import { SectionLabel } from "./SectionLabel";
import { SelectTile } from "./SelectTile";
import type { Variant } from "../lib/standings";
import { font, palette, space } from "../theme";
import { useT } from "../i18n";

interface ModePickerProps<V extends Variant> {
  options: readonly V[];
  value: V;
  onChange: (value: V) => void;
}

export function ModePicker<V extends Variant>({ options, value, onChange }: ModePickerProps<V>) {
  const t = useT();
  if (options.length < 2) return null;
  return (
    <>
      <SectionLabel>{t("mode.label")}</SectionLabel>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {options.map((v) => (
          <SelectTile key={v} label={t(`mode.${v}`)} selected={v === value} onPress={() => onChange(v)} />
        ))}
      </View>
      <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, paddingLeft: space.xs }}>
        {t(`mode.${value}Hint`)}
      </Text>
    </>
  );
}
