/**
 * Avatar chips — the fourteen Ludo Club–style characters, shipped as PNGs.
 *
 * These used to be drawn at runtime with Skia. The art now lives in
 * scripts/gen-avatars.mjs, which renders assets/images/avatars/<id>.png, so
 * this component is just an image. That also retires a sharp edge: the Skia
 * version could NOT be memoized, because PlayerChip animates a scale pop on an
 * ancestor every turn hand-off, which dropped the canvas's native picture, and
 * only an incidental re-render repainted it — memoizing blanked the avatars one
 * per turn. An Image has no such coupling.
 */

import { Image } from "react-native";
import { avatarImage } from "../render/avatarImages";

export { AVATAR_IDS, DEFAULT_AVATAR_ID, resolveAvatarId } from "../render/avatars";
export type { AvatarId } from "../render/avatars";

export function AvatarGlyph({ id, size }: { id: string | null | undefined; size: number }) {
  return (
    <Image
      source={avatarImage(id)}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessible={false}
    />
  );
}
