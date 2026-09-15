import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, ErrorNote, Icon, NovaGradient, errText } from "../../src/components/ui";
import { OptionCard } from "../../src/components/MoreKit";
import { SprintIdeaPicker } from "../../src/components/SprintIdeaPicker";
import { DURATION_OPTIONS, STYLE_OPTIONS, type Duration, type ProductStyle, type SprintIdea } from "../../src/components/SprintKit";

/** Practice sprint setup — duration, style, then one of three ideas from Nova. The web's /sprints/practice. */
export default function PracticeSprint() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(1);
  const [duration, setDuration] = useState<Duration | null>(null);
  const [style, setStyle] = useState<ProductStyle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    // Without an idea the server generates one, which is "surprise me".
    mutationFn: (idea?: SprintIdea) => api<any>("/api/sprints/practice", { method: "POST", body: { duration, productStyle: style, idea } }),
    onSuccess: (sprint) => {
      qc.invalidateQueries({ queryKey: ["sprints"] });
      qc.invalidateQueries({ queryKey: ["subscription"] });
      router.replace(`/sprint/${sprint.id}`);
    },
    onError: (e: any) => setError(
      e?.status === 402 || e?.status === 403 || /credit/i.test(e?.message ?? "")
        ? "Not enough AI credits. Practice sprints use 1 credit for Nova's product suggestion."
        : errText(e, "Couldn't create the practice sprint."),
    ),
  });

  const styleName = STYLE_OPTIONS.find((o) => o.value === style)?.label.toLowerCase();

  return (
    <>
      <Stack.Screen options={{ title: "Practice sprint" }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}>
        {/* Nova, the practice partner. */}
        <NovaGradient style={{ borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" }}>
              <Icon name="school" size={22} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#FFFFFF", fontSize: font.lg, fontFamily: fontFamily.bold }}>Practice with Nova</Text>
              <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: font.xs, fontFamily: fontFamily.medium }}>Your AI co-founder for a dry run</Text>
            </View>
          </View>
          <Text style={{ color: "#FFFFFF", fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
            Nova pitches you ideas, talks through the product with you, answers the ideation questions as your partner, and gives feedback at the end.
          </Text>
        </NovaGradient>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm }}>
          {[1, 2, 3].map((n) => (
            <View key={n} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: n <= step ? colors.primary : colors.surfaceRaised }}>
                {n < step ? <Icon name="checkmark" size={15} color="#FFFFFF" /> : (
                  <Text style={{ color: n <= step ? "#FFFFFF" : colors.textTertiary, fontFamily: fontFamily.semibold, fontSize: font.sm }}>{n}</Text>
                )}
              </View>
              {n < 3 && <View style={{ width: 36, height: 2, backgroundColor: n < step ? colors.primary : colors.surfaceRaised }} />}
            </View>
          ))}
        </View>

        {step === 1 && (
          <View style={{ gap: spacing.sm }}>
            <Text style={h2}>Choose sprint duration</Text>
            {DURATION_OPTIONS.map((o) => (
              <OptionCard key={o.value} icon={o.icon} title={o.label}
                body={o.value === "24h" ? "Quick practice run. Problem definition, ICP, value proposition, and a product brief." : "Full practice with a validation phase: outreach, social posts, and interview questions."}
                selected={duration === o.value} onPress={() => setDuration(o.value)} />
            ))}
          </View>
        )}

        {step === 2 && (
          <View style={{ gap: spacing.sm }}>
            <Text style={h2}>Choose product style</Text>
            {STYLE_OPTIONS.map((o) => (
              <OptionCard key={o.value} icon={o.icon} title={o.label} body={o.body} selected={style === o.value} onPress={() => setStyle(o.value)} />
            ))}
          </View>
        )}

        {step === 3 && style && (
          <View style={{ gap: spacing.md }}>
            <View style={{ gap: 2 }}>
              <Text style={h2}>Pick your product</Text>
              <Text style={sub}>Nova will pitch three {styleName} ideas. Choose whichever sounds most fun to build.</Text>
            </View>
            <SprintIdeaPicker productStyle={style} onChoose={(idea) => create.mutate(idea)} isSubmitting={create.isPending} chooseLabel="Build" />
          </View>
        )}

        {error && <ErrorNote message={error} />}
      </ScrollView>

      <View style={{ flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md + insets.bottom, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
        <Btn label="Back" icon="arrow-back" variant="outline" style={{ flex: 1 }} onPress={() => (step > 1 ? setStep(step - 1) : router.back())} />
        {step === 1 ? (
          <Btn label="Next" style={{ flex: 1.5 }} disabled={!duration} onPress={() => setStep(2)} />
        ) : step === 2 ? (
          <Btn label="Pick an idea" style={{ flex: 1.5 }} disabled={!style} onPress={() => setStep(3)} />
        ) : (
          <Btn label="Surprise me instead" icon="school-outline" variant="outline" style={{ flex: 1.5 }} loading={create.isPending} onPress={() => { setError(null); create.mutate(undefined); }} />
        )}
      </View>
    </>
  );
}

const h2 = { color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold } as const;
const sub = { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular, lineHeight: 19 } as const;
