import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, spacing } from "../../src/theme";
import {
  Body, Btn, Card, Chip, ErrorNote, H2, Label, Loading, Meta, Row, Screen, errText,
} from "../../src/components/ui";
import {
  PROJECT_SECTIONS, SECTION_GROUPS, isSectionEnabled, sectionHasContent,
  type ProjectSectionKey,
} from "../../src/projectSections";

/**
 * Public-page visibility editor.
 *
 * Edits happen against local state and save in one PATCH — toggling fourteen
 * switches over a mobile connection shouldn't be fourteen round trips.
 */
export default function Visibility() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [overrides, setOverrides] = useState<Partial<Record<ProjectSectionKey, boolean>> | null>(null);
  const [isPrivate, setIsPrivate] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<any>(`/api/projects/${id}`),
    enabled: !!id,
  });

  // Seed local state once the project arrives, filling in defaults so every
  // switch reflects what a visitor sees today rather than a null.
  useEffect(() => {
    if (!project || overrides) return;
    const seeded: Partial<Record<ProjectSectionKey, boolean>> = {};
    for (const s of PROJECT_SECTIONS) seeded[s.key] = isSectionEnabled(project, s.key);
    setOverrides(seeded);
    setIsPrivate(Boolean(project.isPrivate));
  }, [project, overrides]);

  const save = useMutation({
    mutationFn: () =>
      api(`/api/projects/${id}`, {
        method: "PATCH",
        body: { publicSections: overrides, isPrivate },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      router.back();
    },
    onError: (e) => setError(errText(e, "Couldn't save your changes.")),
  });

  if (isLoading || !project || !overrides) {
    return (
      <>
        <Stack.Screen options={{ title: "Public page" }} />
        <Screen><Loading label="Loading your project…" /></Screen>
      </>
    );
  }

  const dirty =
    isPrivate !== Boolean(project.isPrivate) ||
    PROJECT_SECTIONS.some((s) => overrides[s.key] !== isSectionEnabled(project, s.key));

  const shownCount = PROJECT_SECTIONS.filter(
    (s) => overrides[s.key] && sectionHasContent(project, s.key),
  ).length;

  return (
    <>
      <Stack.Screen options={{ title: "Public page" }} />
      <Screen>
        <Card accent={colors.primary}>
          <H2>{project.title}</H2>
          <Meta>
            {shownCount} of {PROJECT_SECTIONS.length} sections are showing. Sections with
            nothing written in them stay hidden either way.
          </Meta>
        </Card>

        <Card accent={isPrivate ? colors.warning : undefined}>
          <Row between center>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Body style={{ fontWeight: "700" }}>Private project</Body>
              <Meta>
                {isPrivate
                  ? "Only you and your team can open this. Visitors see the name and nothing else."
                  : "Anyone can find this project and read whatever you've left visible below."}
              </Meta>
            </View>
            <Switch
              value={!!isPrivate}
              onValueChange={setIsPrivate}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.text}
            />
          </Row>
        </Card>

        {SECTION_GROUPS.map(({ group, title, blurb }) => {
          const sections = PROJECT_SECTIONS.filter((s) => s.group === group);
          if (sections.length === 0) return null;
          return (
            <Card key={group}>
              <Label>{title}</Label>
              <Meta>{blurb}</Meta>
              <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
                {sections.map((s) => {
                  const empty = !sectionHasContent(project, s.key);
                  return (
                    <Row key={s.key} between center>
                      <View style={{ flex: 1, paddingRight: spacing.md, gap: 2 }}>
                        <Row center gap={spacing.xs} style={{ flexWrap: "wrap" }}>
                          <Body style={{ fontWeight: "700" }}>{s.label}</Body>
                          {empty && <Chip label="Nothing written yet" color={colors.textTertiary} small />}
                        </Row>
                        <Meta>{s.hint}</Meta>
                      </View>
                      <Switch
                        value={!!overrides[s.key]}
                        onValueChange={(v) => setOverrides({ ...overrides, [s.key]: v })}
                        trackColor={{ false: colors.border, true: colors.primary }}
                        thumbColor={colors.text}
                      />
                    </Row>
                  );
                })}
              </View>
            </Card>
          );
        })}

        {error && <ErrorNote message={error} />}

        <Btn
          label={dirty ? "Save changes" : "No changes to save"}
          disabled={!dirty}
          loading={save.isPending}
          onPress={() => save.mutate()}
        />
      </Screen>
    </>
  );
}
