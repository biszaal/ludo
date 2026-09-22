/**
 * A volume track, for the two channel masters in Settings.
 *
 * Built on RN core's PanResponder rather than a slider package. The two
 * candidates (@react-native-community/slider, react-native-gesture-handler)
 * are both native modules, and adding one would mean a fresh native build
 * against a scarce EAS quota to ship a control that is a rectangle, a circle
 * and one subtraction.
 *
 * The gesture tracks `locationX at grant + dx` rather than the absolute
 * `moveX`. Both describe the same finger, but the absolute one has to be
 * turned into a track-relative offset by measuring the view's position on the
 * page, and `measure()` is async — so the first frames of every drag would use
 * a stale offset, which reads as the thumb jumping away from the finger and
 * settling back. The relative form needs no measurement at all.
 */

import { useRef, useState } from "react";
import { PanResponder, Text, View, type LayoutChangeEvent } from "react-native";
import { stepVolume, trackFraction, valueFromTouch, volumePercent } from "../lib/sliderMath";
import * as haptics from "../lib/haptics";
import { font, palette, radius, space } from "../theme";

const TRACK_H = 6;
const KNOB = 20;
/** Vertical padding around the track. The track itself is 6pt tall, which is a
 *  fine thing to look at and an impossible thing to hit; this brings the touch
 *  target to the 44pt both platforms ask for. */
const TOUCH_PAD = (44 - KNOB) / 2;

interface VolumeSliderProps {
  /** What this adjusts, for screen readers — the visible label is the row's. */
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** Called once when the finger lifts, for the channel's audible preview. A
   *  preview on every step would stutter across a drag. */
  onCommit?: () => void;
  /** Mirrors the row's toggle being off: dimmed, and inert to touch. */
  disabled?: boolean;
}

export function VolumeSlider({ label, value, onChange, onCommit, disabled = false }: VolumeSliderProps) {
  const [width, setWidth] = useState(0);

  // Refs, not state: the responder callbacks below are created once and would
  // otherwise close over the first render's values forever.
  const widthRef = useRef(0);
  const startXRef = useRef(0);
  const lastRef = useRef(value);
  lastRef.current = value;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  /** Move to `next`, ticking only when the step actually changed — a tick per
   *  frame across a drag is a buzz, not feedback. */
  const applyTouch = (next: number): void => {
    if (next === lastRef.current) return;
    lastRef.current = next;
    haptics.tapLight();
    onChangeRef.current(next);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      // Claim the gesture from the ScrollView this sits inside. Without it a
      // horizontal drag that wanders a few pixels vertically is read as a
      // scroll, and the slider lets go mid-adjustment.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        startXRef.current = evt.nativeEvent.locationX;
        applyTouch(valueFromTouch(startXRef.current, widthRef.current));
      },
      onPanResponderMove: (_evt, gesture) => {
        applyTouch(valueFromTouch(startXRef.current + gesture.dx, widthRef.current));
      },
      onPanResponderRelease: () => onCommitRef.current?.(),
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent): void => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  };

  const fraction = trackFraction(value);
  const percent = volumePercent(value);
  // The knob's centre rides the fill, so it has to stop half a knob short of
  // each end or it would hang off the rail at 0% and 100%.
  const knobLeft = width > 0 ? fraction * (width - KNOB) : 0;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, opacity: disabled ? 0.4 : 1 }}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        accessibilityValue={{ min: 0, max: 100, now: percent }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => {
          if (disabled) return;
          const dir = e.nativeEvent.actionName === "increment" ? 1 : -1;
          applyTouch(stepVolume(lastRef.current, dir));
        }}
        // Stretch the responder over the padding as well as the track, so the
        // whole 44pt is live and not just the visible 6.
        style={{ flex: 1, paddingVertical: TOUCH_PAD, justifyContent: "center" }}
        {...responder.panHandlers}
      >
        <View onLayout={onLayout} style={{ height: KNOB, justifyContent: "center" }}>
          <View
            style={{
              height: TRACK_H,
              borderRadius: radius.pill,
              backgroundColor: palette.liftedSlate,
              borderWidth: 1,
              borderColor: palette.hairline,
              overflow: "hidden",
            }}
          >
            {/* Porcelain, per the dynamic-accent rule the toggle follows: the
                chrome stays neutral and never borrows a team colour. */}
            <View
              style={{
                width: `${fraction * 100}%`,
                height: "100%",
                backgroundColor: palette.porcelain,
              }}
            />
          </View>
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: knobLeft,
              width: KNOB,
              height: KNOB,
              borderRadius: radius.pill,
              backgroundColor: palette.porcelain,
              borderWidth: 1,
              borderColor: palette.hairline,
            }}
          />
        </View>
      </View>
      <Text
        // Mono and fixed-width: a proportional face reflows the row as the
        // number goes 9 → 10 → 100, and the track would breathe under the finger.
        style={{
          fontFamily: font.mono,
          fontSize: 12,
          color: palette.mutedSteel,
          width: 38,
          textAlign: "right",
        }}
      >
        {percent}%
      </Text>
    </View>
  );
}
