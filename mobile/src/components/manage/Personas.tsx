/**
 * Customer Personas — the native counterpart of PersonasTab in
 * client/src/pages/project-manager.tsx: Nova generates one, or you write one,
 * and each card shows goals, pain points and a quote.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useEntitlementsQuery } from "../../hooks/useEntitlements";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Body, Btn, Card, Cost, Field, Icon, IconButton, Loading, Meta, Row } from "../ui";
import { EditorSheet, Overline, Tag, useNotify } from "./bits";
import { mkey } from "./shared";

const EMPTY = { name: "", age: "", occupation: "", bio: "", goals: "", painPoints: "", quote: "" };
const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);

export function Personas({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const { creditCosts } = useEntitlementsQuery();
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const key = mkey(projectId, "personas");
  const { data = [], isLoading } = useQuery({ queryKey: key, queryFn: () => api<any[]>(`/api/projects/${projectId}/personas`) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const generate = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/personas/generate`, { method: "POST" }),
    onSuccess: () => { void refresh(); void qc.invalidateQueries({ queryKey: ["subscription"] }); notify("Nova added a persona."); },
    onError: (e) => fail(e, "Couldn't generate a persona."),
  });
  const create = useMutation({
    mutationFn: (f: typeof EMPTY) => api(`/api/projects/${projectId}/personas`, {
      method: "POST",
      body: { name: f.name.trim(), age: f.age ? parseInt(f.age, 10) : null, occupation: f.occupation || null, bio: f.bio || null, goals: lines(f.goals), painPoints: lines(f.painPoints), quote: f.quote || null },
    }),
    onSuccess: () => { setForm(null); void refresh(); notify("Persona created."); },
    onError: (e) => fail(e, "Couldn't create that persona."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/personas/${id}`, { method: "DELETE" }),
    onSuccess: () => { void refresh(); notify("Persona deleted.", "info"); },
    onError: (e) => fail(e),
  });
  const cost = creditCosts?.personaGeneration;

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <Text style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color: colors.text }}>Customer Personas</Text>
        <Meta style={{ fontSize: font.sm }}>Define your target audience with AI-generated or manual personas.</Meta>
        <Row wrap gap={spacing.sm} center>
          <Btn small variant="outline" icon="sparkles" label="AI Generate" loading={generate.isPending} onPress={() => generate.mutate()} />
          {typeof cost === "number" ? <Cost credits={cost} /> : null}
          <Btn small icon="add" label="Create Manually" onPress={() => setForm(EMPTY)} />
        </Row>
      </Card>

      {isLoading ? <Loading /> : data.length === 0 ? (
        <View style={{ borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.md, padding: spacing.xl, alignItems: "center", gap: spacing.sm }}>
          <Icon name="people-outline" size={40} color={colors.textTertiary} />
          <Text style={{ fontSize: font.base, fontFamily: fontFamily.medium, color: colors.text }}>No personas yet</Text>
          <Meta style={{ textAlign: "center", fontSize: font.sm }}>Create customer personas to better understand your target audience.</Meta>
        </View>
      ) : data.map((p) => (
        <Card key={p.id} style={{ gap: spacing.sm }}>
          <Row gap={spacing.md} style={{ alignItems: "flex-start" }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color: colors.primary }}>{p.name.charAt(0)}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Row center wrap gap={6}>
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{p.name}</Text>
                {p.age ? <Meta>Age {p.age}</Meta> : null}
                {p.isAiGenerated ? <Tag label="AI" /> : null}
              </Row>
              {p.occupation ? <Meta>{p.occupation}</Meta> : null}
            </View>
            <IconButton name="trash-outline" size={17} color={colors.textTertiary} label="Delete persona" onPress={() => remove.mutate(p.id)} />
          </Row>
          {p.bio ? <Body muted>{p.bio}</Body> : null}
          {p.goals?.length > 0 && (
            <View style={{ gap: 4 }}>
              <Overline>Goals</Overline>
              <Row wrap gap={4}>{p.goals.map((g: string, i: number) => <Tag key={i} color="#15803D" label={g} />)}</Row>
            </View>
          )}
          {p.painPoints?.length > 0 && (
            <View style={{ gap: 4 }}>
              <Overline>Pain Points</Overline>
              <Row wrap gap={4}>{p.painPoints.map((g: string, i: number) => <Tag key={i} color="#B91C1C" label={g} />)}</Row>
            </View>
          )}
          {p.quote ? (
            <View style={{ borderLeftWidth: 2, borderLeftColor: `${colors.primary}4D`, paddingLeft: spacing.md }}>
              <Text style={{ fontStyle: "italic", fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.regular }}>"{p.quote}"</Text>
            </View>
          ) : null}
        </Card>
      ))}

      <EditorSheet
        visible={!!form}
        onClose={() => setForm(null)}
        title="New persona"
        action={{ label: "Create persona", onPress: () => form && create.mutate(form), disabled: !form?.name.trim(), loading: create.isPending }}
      >
        {form && (
          <View style={{ gap: spacing.md }}>
            <Field label="Name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="e.g. Shift-lead Sam" />
            <Field label="Age" value={form.age} onChangeText={(age) => setForm({ ...form, age: age.replace(/\D/g, "") })} numeric />
            <Field label="Occupation" value={form.occupation} onChangeText={(occupation) => setForm({ ...form, occupation })} />
            <Field label="Bio" value={form.bio} onChangeText={(bio) => setForm({ ...form, bio })} multiline />
            <Field label="Goals (one per line)" value={form.goals} onChangeText={(goals) => setForm({ ...form, goals })} multiline />
            <Field label="Pain points (one per line)" value={form.painPoints} onChangeText={(painPoints) => setForm({ ...form, painPoints })} multiline />
            <Field label="Quote" value={form.quote} onChangeText={(quote) => setForm({ ...form, quote })} />
          </View>
        )}
      </EditorSheet>
    </View>
  );
}
