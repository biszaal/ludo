/** App icons for lib/ads/promos, keyed by promo id. Kept apart because
 *  `require` of an image only works under the bundler. */
import type { ImageSourcePropType } from "react-native";

export const PROMO_ICONS: Record<string, ImageSourcePropType> = {
  cascade: require("../../../assets/images/promos/cascade.png"),
  helicopter: require("../../../assets/images/promos/helicopter.png"),
  itrackhabit: require("../../../assets/images/promos/itrackhabit.png"),
  expenzez: require("../../../assets/images/promos/expenzez.png"),
};
