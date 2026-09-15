import { useEffect, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Chip, ErrorNote, Field, Icon, Loading, Meta, Row, Screen, Section } from "../../src/components/ui";

/**
 * The public "looking for" call — the web's LookingForCard editor
 * (client/src/components/looking-for-card.tsx): role, industries, commitment,
 * stage, equity and a note, with a switch to keep it saved but hidden.
 */
interface LookingFor {
  isActive: boolean;
  role: string;
  industries: string[];
  commitment: string | null;
  stage: string | null;
  equityAvailable: boolean | null;
  details: string | null;
}
const EMPTY: LookingFor = { isActive: true, role: "", industries: [], commitment: null, stage: null, equityAvailable: null, details: null };

export default function LookingForEditor() {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState<LookingFor | null>(null);
  const [industry, setIndustry] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<any>("/api/profile").catch((e) => { if (e?.status === 404) return null; throw e; }),
  });
  const { data: options } = useQuery({
    queryKey: ["looking-for-options"],
    queryFn: () => api<{ roles: string[]; stages: string[]; commitments: string[] }>("/api/profile/looking-for-options"),
  });
  useEffect(() => { if (!isLoading && !form) setForm({ ...EMPTY, ...(profile?.lookingFor ?? {}) }); }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = () => {
    void qc.invalidateQueries({ queryKey: ["profile"] });
    void qc.invalidateQueries({ queryKey: ["user"] });
    if (router.canGoBack()) router.back(); else router.replace("/(tabs)/profile");
  };
  const save = useMutation({
    mutationFn: (payload: any) => api("/api/profile/looking-for", { method: "POST", body: payload }),
    onSuccess: done,
    onError: (e: any) => setError(e?.message || "Couldn't save."),
  });

  if (isLoading || !form) return <Loading />;
  if (!profile) {
    return <Screen canvas><ErrorNote message="Set up your profile first." /><Btn label="Edit profile" onPress={() => router.replace("/profile/edit")} /></Screen>;
  }

  const addIndustry = () => {
    const v = industry.trim();
    if (!v || form.industries.includes(v) || form.industries.length >= 6) return;
    setForm({ ...form, industries: [...form.industries, v] });
    setIndustry("");
  };

  return (
    <>
      <Stack.Screen options={{ title: "Looking for" }} />
      <Screen canvas contentStyle={{ padding: 0, gap: spacing.sm, paddingBottom: spacing.xxl * 2 }}>
        <Section>
          <Row gap={spacing.md} center>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Icon name="hand-left-outline" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color: colors.text }}>What are you looking for?</Text>
              <Meta style={{ fontSize: font.sm }}>Shown publicly on your profile so the right people can find you.</Meta>
            </View>
          </Row>
        </Section>

        <Section title="Looking for *">
          <Row wrap gap={spacing.sm}>
            {(options?.roles ?? []).map((r) => <Chip key={r} label={r} active={form.role === r} onPress={() => setForm({ ...form, role: r })} />)}
          </Row>
        </Section>

        <Section title="Industry">
          <Row gap={spacing.sm} center>
            <TextInput value={industry} onChangeText={setIndustry} onSubmitEditing={addIndustry} placeholder="e.g. FinTech" placeholderTextColor={colors.textTertiary} blurOnSubmit={false}
              style={{ flex: 1, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 42, fontFamily: fontFamily.regular, fontSize: font.base, color: colors.text }} />
            <Pressable onPress={addIndustry} disabled={!industry.trim()} accessibilityLabel="Add industry"
              style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: industry.trim() ? colors.primary : colors.surfaceRaised, alignItems: "center", justifyContent: "center" }}>
              <Icon name="add" size={22} color={industry.trim() ? "#FFFFFF" : colors.textTertiary} />
            </Pressable>
          </Row>
          {form.industries.length > 0 && (
            <Row wrap gap={6}>
              {form.industries.map((i) => (
                <Pressable key={i} onPress={() => setForm({ ...form, industries: form.industries.filter((x) => x !== i) })}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, backgroundColor: colors.primarySoft, paddingLeft: spacing.md, paddingRight: spacing.sm, paddingVertical: 6 }}>
                  <Text style={{ color: colors.primary, fontFamily: fontFamily.medium, fontSize: font.sm }}>{i}</Text>
                  <Icon name="close" size={14} color={colors.primary} />
                </Pressable>
              ))}
            </Row>
          )}
          <Meta>Up to 6.</Meta>
        </Section>

        <Section title="Commitment">
          <Row wrap gap={spacing.sm}>
            {(options?.commitments ?? []).map((c) => <Chip key={c} label={c} active={form.commitment === c} onPress={() => setForm({ ...form, commitment: form.commitment === c ? null : c })} />)}
          </Row>
        </Section>

        <Section title="Stage">
          <Row wrap gap={spacing.sm}>
            {(options?.stages ?? []).map((s) => <Chip key={s} label={s} active={form.stage === s} onPress={() => setForm({ ...form, stage: form.stage === s ? null : s })} />)}
          </Row>
        </Section>

        <Section title="Equity available">
          <Row wrap gap={spacing.sm}>
            {([{ label: "Yes", value: true }, { label: "No", value: false }, { label: "Rather not say", value: null }] as const).map((o) => (
              <Chip key={o.label} label={o.label} active={form.equityAvailable === o.value} onPress={() => setForm({ ...form, equityAvailable: o.value })} />
            ))}
          </Row>
        </Section>

        <Section title="Anything else?">
          <Field value={form.details ?? ""} onChangeText={(v) => setForm({ ...form, details: v })} multiline maxLength={600}
            placeholder="I've got 20 user interviews and a design. I need someone who wants to own the build." />
        </Section>

        <Section>
          <Row between>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: font.base, fontFamily: fontFamily.semibold, color: colors.text }}>Show this on my profile</Text>
              <Meta style={{ fontSize: font.sm }}>Turn off to keep it saved but hidden.</Meta>
            </View>
            <Switch value={form.isActive} onValueChange={(v) => setForm({ ...form, isActive: v })} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#FFFFFF" />
          </Row>
        </Section>

        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          {error && <ErrorNote message={error} />}
          <Btn label="Save" disabled={!form.role} loading={save.isPending && !save.variables?.clear} onPress={() => { setError(null); save.mutate(form); }} />
          {profile.lookingFor && (
            <Btn label="Remove" variant="danger" loading={save.isPending && !!save.variables?.clear} onPress={() => save.mutate({ clear: true })} />
          )}
        </View>
      </Screen>
    </>
  );
}
