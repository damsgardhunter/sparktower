import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../src/api/client";
import { useEntitlementsQuery } from "../../src/hooks/useEntitlements";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Chip, ErrorNote, Icon, errText } from "../../src/components/ui";
import { Callout, OptionCard, PageIntro, Pill } from "../../src/components/MoreKit";
import { DURATION_OPTIONS, STYLE_OPTIONS, styleLabel, type Duration, type ProductStyle } from "../../src/components/SprintKit";

/**
 * Setting up a real sprint — the web's /sprints/new.
 *
 * Two steps: how long, then what kind of product. With `?partnerId=` (from a
 * match) it creates the sprint with that person; without, it joins the
 * matchmaking queue and pairs you with the next builder who picks the same
 * duration. Bringing one of your projects seeds the sprint from its brief.
 */
export default function NewSprint() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { partnerId } = useLocalSearchParams<{ partnerId?: string }>();
  const { can, isLoading: entLoading } = useEntitlementsQuery();
  const [step, setStep] = useState(1);
  const [duration, setDuration] = useState<Duration | null>(null);
  const [productStyle, setProductStyle] = useState<ProductStyle | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: projects } = useQuery({
    queryKey: ["user-projects"],
    queryFn: () => api<any[]>("/api/user/projects"),
    enabled: !partnerId,
  });

  const create = useMutation({
    mutationFn: async () => {
      if (partnerId) return { matched: true, sprint: await api<any>("/api/sprints", { method: "POST", body: { partnerId, duration, productStyle } }) };
      return api<any>("/api/sprints/queue", { method: "POST", body: { duration, productStyle, projectId: projectId ?? undefined } });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["sprints"] });
      qc.invalidateQueries({ queryKey: ["sprint-queue"] });
      if (r.matched && r.sprint) router.replace(`/sprint/${r.sprint.id}`);
      else router.replace("/(tabs)/sprints");
    },
    onError: (e) => setError(errText(e, partnerId ? "Couldn't create the sprint." : "Couldn't join the queue.")),
  });

  const locked = !entLoading && !can("createSprints");
  const owned = (projects ?? []).slice(0, 12);

  return (
    <>
      <Stack.Screen options={{ title: "New sprint" }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}>
        <PageIntro icon="people" title="Co-Founder Sprint"
          body={partnerId ? "Set up a trial collaboration with your match." : "Find a partner and start building together."} />

        {/* Step dots */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm }}>
          {[1, 2].map((n) => (
            <View key={n} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: n <= step ? colors.primary : colors.surfaceRaised }}>
                {n < step ? <Icon name="checkmark" size={15} color="#FFFFFF" /> : (
                  <Text style={{ color: n <= step ? "#FFFFFF" : colors.textTertiary, fontFamily: fontFamily.semibold, fontSize: font.sm }}>{n}</Text>
                )}
              </View>
              {n < 2 && <View style={{ width: 44, height: 2, backgroundColor: step > 1 ? colors.primary : colors.surfaceRaised }} />}
            </View>
          ))}
        </View>

        {locked && (
          <Callout icon="lock-closed" tone="warn" title="Sprints need a paid plan"
            body="Get matched with another builder for a 24 or 72-hour co-founder trial, or practise the whole thing against Nova first.">
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: 6 }}>
              <Btn label="See plans" small onPress={() => router.push("/pricing")} />
              <Btn label="Practice instead" small variant="outline" onPress={() => router.replace("/sprint/practice")} />
            </View>
          </Callout>
        )}

        {step === 1 ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={h2}>Choose sprint duration</Text>
            {DURATION_OPTIONS.map((o) => (
              <OptionCard key={o.value} icon={o.icon} title={o.label} body={o.body} selected={duration === o.value} onPress={() => setDuration(o.value)} />
            ))}
            {!partnerId && owned.length > 0 && (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                <Text style={h2}>Bring a project? <Text style={{ color: colors.textTertiary, fontFamily: fontFamily.regular, fontSize: font.sm }}>Optional</Text></Text>
                <Text style={sub}>The sprint's product is seeded from its brief.</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                  <Chip label="A fresh idea" active={!projectId} onPress={() => setProjectId(null)} />
                  {owned.map((p) => <Chip key={p.id} label={p.title} active={projectId === p.id} onPress={() => setProjectId(p.id)} />)}
                </View>
              </View>
            )}
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Text style={h2}>Choose product style</Text>
            {STYLE_OPTIONS.map((o) => (
              <OptionCard key={o.value} icon={o.icon} title={o.label} body={o.body} selected={productStyle === o.value} onPress={() => setProductStyle(o.value)} />
            ))}
            <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm, marginTop: spacing.sm }}>
              <Text style={[h2, { fontSize: font.sm }]}>Sprint summary</Text>
              <SummaryRow label="Duration" value={duration ?? "—"} />
              {productStyle && <SummaryRow label="Product style" value={styleLabel(productStyle)} />}
              {projectId && <SummaryRow label="Project" value={owned.find((p) => p.id === projectId)?.title ?? "—"} />}
              <SummaryRow label="Partner" value={partnerId ? "Matched partner" : "Random match"} icon={partnerId ? "people" : "shuffle"} />
              <Text style={[sub, { fontSize: font.xs }]}>You'll agree on a product name after you're matched with your partner.</Text>
            </View>
          </View>
        )}
        {error && <ErrorNote message={error} />}
      </ScrollView>

      <View style={{ flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md + insets.bottom, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
        <Btn label="Back" icon="arrow-back" variant="outline" style={{ flex: 1 }} disabled={step === 1} onPress={() => setStep(1)} />
        {step === 1 ? (
          <Btn label="Next" style={{ flex: 1.5 }} disabled={!duration} onPress={() => setStep(2)} />
        ) : (
          <Btn label={partnerId ? "Create sprint" : "Find match & create"} icon={partnerId ? "rocket" : "shuffle"} style={{ flex: 1.5 }}
            disabled={!productStyle || locked} loading={create.isPending} onPress={() => { setError(null); create.mutate(); }} />
        )}
      </View>
    </>
  );
}

function SummaryRow({ label, value, icon }: { label: string; value: string; icon?: "people" | "shuffle" }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={sub}>{label}</Text>
      <Pill label={value} icon={icon} color={colors.textSecondary} />
    </View>
  );
}

const h2 = { color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold } as const;
const sub = { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular, lineHeight: 19 } as const;
