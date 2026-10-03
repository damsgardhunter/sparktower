/**
 * What the machine is doing right now, while you wait for it — on the phone.
 *
 * ## The thing a spinner refuses to say
 *
 * A spinner says "something is happening". It does not say what, how far through,
 * how long it has taken, or whether it is stuck, and those are the only four
 * questions anybody has while watching one. On a two-second wait that is fine. On
 * the two minutes a code read or a whole-business build actually costs, a bare
 * `ActivityIndicator` is the product declining to answer — and the phone is where
 * these waits are *longest*, same model call over a worse connection, so it had
 * the most to gain from saying something and was the half that said nothing.
 *
 * So: a segment per stage, the current one filled part-way; the stage named in
 * plain words — "Nova is reading it", not "PROCESSING"; and, where the caller
 * knows it, who started it and how long ago. That last part matters more than it
 * looks, because these runs are shared: a teammate can start a code read, and
 * "Dana · 1:05" is the difference between a screen that seems frozen and one that
 * is obviously somebody else's work in progress.
 *
 * The web's counterpart is `client/src/components/nova/working.tsx`. Which
 * segment is filled and what the wait is called come from `src/workingView.ts`,
 * mirrored against the web's copy, so the two clients cannot disagree about the
 * state of the same run.
 *
 * No animation on the current segment, deliberately. The web pulses it with CSS;
 * the equivalent here is a driven `Animated` loop, which on a screen that is
 * already waiting on the network is a frame budget spent on reassurance that the
 * changing stage name and the ticking elapsed time already provide.
 */
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { workingView, type WorkingStage } from "../workingView";

export type { WorkingStage };

export function Working({
  stages, current, saying, meta, detail, progress, style, testID = "working",
}: {
  /** The stages in the order they happen. Two to five; more is a log, not a progress bar. */
  stages: readonly WorkingStage[];
  /** Which stage is happening, by id. Null or unrecognised draws as nothing started. */
  current?: string | null;
  /** What to say instead of the current stage's label — for moments the server has no stage for. */
  saying?: string | null;
  /** Who and how long, on the right. Usually "Dana · 1:05". */
  meta?: string | null;
  /** A second line under the bar: "19 of 28 steps · Writing your pricing page". */
  detail?: string | null;
  /** How far through the current stage, 0–1, for the rare caller that genuinely knows. */
  progress?: number | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { label, widths } = workingView(stages, current, saying, progress);

  return (
    <View style={[{ gap: spacing.xs }, style]} testID={testID}>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {stages.map((stage, i) => (
          <View
            key={stage.id}
            style={{
              flex: 1, height: 6, borderRadius: radius.pill,
              backgroundColor: colors.surfaceRaised, overflow: "hidden",
            }}
          >
            {/*
              * A width in percent rather than a flex, so a segment at 0 collapses
              * cleanly and one at 60 does not fight its neighbours for space.
              */}
            <View
              style={{
                width: `${widths[i]}%`, height: "100%",
                borderRadius: radius.pill, backgroundColor: colors.primary,
              }}
            />
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
        <Text
          style={{ flex: 1, fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.text }}
          numberOfLines={1}
          /* Politely: this changes every half-minute, and interrupting whatever
             somebody is doing to say "saving what it found" is worse than silence. */
          accessibilityLiveRegion="polite"
          testID={`${testID}-stage`}
        >
          {label}…
        </Text>
        {meta ? (
          <Text style={{ fontSize: font.xs, color: colors.textSecondary }} numberOfLines={1} testID={`${testID}-meta`}>
            {meta}
          </Text>
        ) : null}
      </View>

      {detail ? (
        <Text style={{ fontSize: font.xs, color: colors.textSecondary }} numberOfLines={1} testID={`${testID}-detail`}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}
