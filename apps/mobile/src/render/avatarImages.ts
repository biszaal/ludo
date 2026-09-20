/**
 * Avatar id -> shipped PNG. Split from avatars.ts so that module stays free of
 * binary imports and usable from the Node test suite.
 *
 * The require() calls must stay literal: Metro resolves them statically at
 * bundle time, so a computed path would bundle nothing and blank every avatar.
 * The art lives in scripts/avatar-art.mjs and is rendered by
 * scripts/gen-avatars.mjs — add an id there and here.
 */

import type { ImageSourcePropType } from "react-native";
import { resolveAvatarId, type AvatarId } from "./avatars";

const AVATAR_IMAGES: Record<AvatarId, ImageSourcePropType> = {
  leo: require("../../assets/images/avatars/leo.png"),
  sunny: require("../../assets/images/avatars/sunny.png"),
  coco: require("../../assets/images/avatars/coco.png"),
  zara: require("../../assets/images/avatars/zara.png"),
  rex: require("../../assets/images/avatars/rex.png"),
  nina: require("../../assets/images/avatars/nina.png"),
  milo: require("../../assets/images/avatars/milo.png"),
  ivy: require("../../assets/images/avatars/ivy.png"),
  ace: require("../../assets/images/avatars/ace.png"),
  ruby: require("../../assets/images/avatars/ruby.png"),
  bruno: require("../../assets/images/avatars/bruno.png"),
  kito: require("../../assets/images/avatars/kito.png"),
  nova: require("../../assets/images/avatars/nova.png"),
  onyx: require("../../assets/images/avatars/onyx.png"),
  laurel: require("../../assets/images/avatars/laurel.png"),
  saga: require("../../assets/images/avatars/saga.png"),
  pharo: require("../../assets/images/avatars/pharo.png"),
  regis: require("../../assets/images/avatars/regis.png"),
  astra: require("../../assets/images/avatars/astra.png"),
  selene: require("../../assets/images/avatars/selene.png"),
  solis: require("../../assets/images/avatars/solis.png"),
  momo: require("../../assets/images/avatars/momo.png"),
  tashi: require("../../assets/images/avatars/tashi.png"),
  bolt: require("../../assets/images/avatars/bolt.png"),
  rana: require("../../assets/images/avatars/rana.png"),
  mira: require("../../assets/images/avatars/mira.png"),
  sylva: require("../../assets/images/avatars/sylva.png"),
  draco: require("../../assets/images/avatars/draco.png"),
  vega: require("../../assets/images/avatars/vega.png"),
  frost: require("../../assets/images/avatars/frost.png"),
  diya: require("../../assets/images/avatars/diya.png"),
  ember: require("../../assets/images/avatars/ember.png"),
  rani: require("../../assets/images/avatars/rani.png"),
  "onyx-ii": require("../../assets/images/avatars/onyx-ii.png"),
};

/** The image for any stored id, legacy slugs and unknowns included. */
export function avatarImage(id: string | null | undefined): ImageSourcePropType {
  return AVATAR_IMAGES[resolveAvatarId(id)];
}
