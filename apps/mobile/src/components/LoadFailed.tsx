/**
 * What a wait becomes when it stops being a wait.
 *
 * A skeleton that shimmers forever promises content that is not coming, so
 * loadPhase hands over to this after STALL_AFTER_MS or on an outright failure.
 * It says which thing did not arrive and offers the one action worth offering.
 * No error code and no apology: neither helps, and both make an ordinary
 * dropped connection feel like a fault the player caused.
 */

import { Surface3D } from "./Surface3D";
import { Button } from "./Button";
import { Text } from "react-native";
import { font, palette, radius, space } from "../theme";

interface LoadFailedProps {
  /** Names what did not arrive: "The shop didn't load." */
  message: string;
  onRetry: () => void;
}

export function LoadFailed({ message, onRetry }: LoadFailedProps) {
  return (
    <Surface3D rad={radius.lg} faceStyle={{ padding: space.lg, gap: space.md, alignItems: "center" }}>
      <Text
        style={{
          fontFamily: font.regular,
          fontSize: 13,
          color: palette.mutedSteel,
          textAlign: "center",
        }}
      >
        {message}
      </Text>
      <Button label="Try again" variant="ghost" onPress={onRetry} />
    </Surface3D>
  );
}
