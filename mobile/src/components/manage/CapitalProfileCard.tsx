/**
 * The fundability score: one number, what it's made of, and how each route
 * fits. The native counterpart of client/src/components/capital-profile-card.tsx.
 */
import { Text, View } from "react-native";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Card, Icon, Meta, Progress, Row } from "../ui";
import { Bubble, Overline } from "./bits";
import type { CapitalProfile } from "./shared";

const BAND_TONE: Record<CapitalProfile["band"]["id"], string> = {
  not_yet: "#E11D48", early: "#D97706", with_work: "#0284C7", strong: "#059669", very_strong: "#059669",
};

export function CapitalProfileCard({ capital }: { capital: CapitalProfile }) {
  if (!capital || capital.answered === 0) return null;
  const tone = BAND_TONE[capital.band.id] ?? colors.primary;
  const best = capital.routeFit[0];
  return (
    <Card style={{ gap: spacing.md }}>
      <Row center gap={spacing.md}>
        {/* A ring without SVG: a thick tinted border, the score inside. */}
        <View style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 7, borderColor: `${tone}33`, alignItems: "center", justifyContent: "center" }}>
          <View style={{ position: "absolute", top: -7, left: -7, right: -7, bottom: -7, borderRadius: 38, borderWidth: 7, borderColor: tone, borderRightColor: capital.score < 75 ? "transparent" : tone, borderBottomColor: capital.score < 50 ? "transparent" : tone, borderLeftColor: capital.score < 25 ? "transparent" : tone, transform: [{ rotate: "45deg" }] }} />
          <Text style={{ fontSize: 24, fontFamily: fontFamily.bold, color: colors.text }} accessibilityLabel={`Fundability score ${capital.score} out of 100`}>{capital.score}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Row center gap={4}><Icon name="trending-up" size={13} color={colors.textTertiary} /><Overline>Fundability today</Overline></Row>
          <Text style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color: tone }}>{capital.band.label}</Text>
          <Meta>
            How a lender or investor would likely see you now{capital.answered < 5 ? ` (${capital.answered} of 5 steps so far)` : ""}. Not the odds of approval — each part says what raises it.
          </Meta>
        </View>
      </Row>

      <View style={{ gap: spacing.md }}>
        {capital.parts.map((p) => (
          <View key={p.key} style={{ gap: 4 }}>
            <Row between>
              <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{p.label}</Text>
              <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.textSecondary }}>{p.score}/{p.max}</Text>
            </Row>
            <Progress value={(p.score / Math.max(1, p.max)) * 100} />
            <Meta>{p.why}{p.raise ? <Text style={{ color: colors.text }}>  Raise it: </Text> : null}{p.raise ?? ""}</Meta>
          </View>
        ))}
      </View>

      {capital.answered >= 3 && capital.routeFit.length > 0 && (
        <View style={{ gap: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.md }}>
          <Overline>Route fit</Overline>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {capital.routeFit.map((r) => (
              <Bubble key={r.route} small label={r.label} note={`${r.score}${capital.route === r.route ? " · your route" : ""}`} on={capital.route === r.route} onPress={() => {}} />
            ))}
          </View>
          {!capital.route && best && <Meta>Best fit today: {best.label} — {best.why}</Meta>}
        </View>
      )}
    </Card>
  );
}
