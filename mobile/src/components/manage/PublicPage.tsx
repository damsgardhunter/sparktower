/**
 * The manager's Public Page tab — the native counterpart of PublicPageTab and
 * PrivacyCard in client/src/pages/project-manager.tsx: the private switch
 * (within the plan's quota), how many sections are live, and a switch per
 * section, saved as you flip it.
 */
import { useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useEntitlementsQuery } from "../../hooks/useEntitlements";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Btn, Card, Divider, Icon, Meta, Row } from "../ui";
import { PROJECT_SECTIONS, SECTION_GROUPS, isSectionEnabled, sectionHasContent, type ProjectSectionKey } from "../../projectSections";
import { Tag, useNotify } from "./bits";
import { mkey } from "./shared";

export function PublicPage({ projectId, project, isOwner, onEditBrief }: { projectId: string; project: any; isOwner: boolean; onEditBrief: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { fail } = useNotify();
  const { privateLimit, privateUsed, canCreatePrivate } = useEntitlementsQuery();
  const [overrides, setOverrides] = useState<Partial<Record<ProjectSectionKey, boolean>>>(project.publicSections || {});
  const [isPrivate, setIsPrivate] = useState<boolean>(!!project.isPrivate);
  useEffect(() => { setIsPrivate(!!project.isPrivate); }, [project.isPrivate]);

  const update = useMutation({
    mutationFn: (data: Record<string, unknown>) => api(`/api/projects/${projectId}`, { method: "PATCH", body: data }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mkey(projectId, "project") });
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e) => { setIsPrivate(!!project.isPrivate); setOverrides(project.publicSections || {}); fail(e, "Couldn't save that."); },
  });

  const enabled = (key: ProjectSectionKey) => overrides[key] ?? isSectionEnabled(project, key);
  const toggle = (key: ProjectSectionKey, value: boolean) => {
    const next = { ...overrides, [key]: value };
    setOverrides(next);
    update.mutate({ publicSections: next });
  };
  const visibleCount = PROJECT_SECTIONS.filter((s) => enabled(s.key) && sectionHasContent(project, s.key)).length;
  const emptyCount = PROJECT_SECTIONS.filter((s) => !sectionHasContent(project, s.key)).length;
  const blocked = !isPrivate && !canCreatePrivate;
  const unlimited = privateLimit === -1;

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <Row center gap={spacing.sm}>
          <Icon name={isPrivate ? "lock-closed" : "globe-outline"} size={17} color={colors.text} />
          <Text style={{ fontSize: font.lg, fontFamily: fontFamily.semibold, color: colors.text }}>Project visibility</Text>
        </Row>
        <Meta style={{ fontSize: font.sm, lineHeight: 19 }}>
          {isPrivate
            ? "Only you and your team can see this project. It's hidden from Discover and search."
            : "Anyone can find this project in Discover and view its public page."}
        </Meta>
        <Row between gap={spacing.md} style={{ marginTop: spacing.xs }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>Make this project private</Text>
            <Meta>
              {unlimited ? "Unlimited private projects on your plan"
                : privateLimit === 0 ? "Private projects need a paid plan"
                : `${privateUsed} of ${privateLimit} private projects used`}
            </Meta>
          </View>
          <Switch
            value={isPrivate}
            disabled={!isOwner || blocked}
            onValueChange={(v) => { setIsPrivate(v); update.mutate({ isPrivate: v }); }}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Make this project private"
          />
        </Row>
        {blocked && (
          <View style={{ backgroundColor: colors.primarySoft, borderRadius: 8, padding: spacing.md, gap: 4 }}>
            <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>
              {privateLimit === 0 ? "Keep work private until you're ready" : "You've used all your private projects"}
            </Text>
            <Meta>{privateLimit === 0 ? "Starter includes 3 private projects. Builder makes them unlimited." : "Builder includes unlimited private projects."}</Meta>
            <Btn small variant="outline" label="See plans" style={{ alignSelf: "flex-start", marginTop: 4 }} onPress={() => router.push("/pricing" as any)} />
          </View>
        )}
      </Card>

      <Card>
        <Row between gap={spacing.md} style={{ alignItems: "flex-start" }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Row center gap={spacing.sm}>
              <Icon name="eye-outline" size={17} color={colors.text} />
              <Text style={{ fontSize: font.lg, fontFamily: fontFamily.semibold, color: colors.text }}>What visitors see</Text>
            </Row>
            <Meta style={{ fontSize: font.sm, lineHeight: 19 }}>Sections appear automatically once they have content. Turn any of them off to keep them private.</Meta>
          </View>
        </Row>
        <Row wrap center gap={spacing.sm}>
          <Tag solid label={`${visibleCount} live`} />
          {emptyCount > 0 && <Tag color={colors.textSecondary} label={`${emptyCount} awaiting content`} />}
          {emptyCount > 0 && (
            <Pressable onPress={onEditBrief} hitSlop={6}>
              <Text style={{ fontSize: font.xs + 1, color: colors.primary, fontFamily: fontFamily.semibold }}>Fill in your brief →</Text>
            </Pressable>
          )}
        </Row>
        <Btn small variant="outline" icon="open-outline" label="View page" style={{ alignSelf: "flex-start" }} onPress={() => router.push(`/project/${projectId}` as any)} />
      </Card>

      {SECTION_GROUPS.map(({ group, title, blurb }) => (
        <Card key={group} style={{ gap: 2 }}>
          <Text style={{ fontSize: font.base, fontFamily: fontFamily.semibold, color: colors.text }}>{title}</Text>
          <Meta style={{ marginBottom: spacing.xs }}>{blurb}</Meta>
          {PROJECT_SECTIONS.filter((s) => s.group === group).map((section, i) => {
            const has = sectionHasContent(project, section.key);
            const on = enabled(section.key);
            return (
              <View key={section.key}>
                {i > 0 && <Divider />}
                <Row between gap={spacing.md} style={{ paddingVertical: spacing.sm + 2 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Row center wrap gap={6}>
                      <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: has ? colors.text : colors.textTertiary }}>{section.label}</Text>
                      {!has && <Tag color={colors.textTertiary} label="No content yet" />}
                      {has && !on && <Tag color={colors.textSecondary} label="Hidden" />}
                    </Row>
                    <Meta>{section.hint}</Meta>
                  </View>
                  <Switch
                    value={on}
                    disabled={!isOwner}
                    onValueChange={(v) => toggle(section.key, v)}
                    trackColor={{ true: colors.primary, false: colors.border }}
                    thumbColor="#FFFFFF"
                    accessibilityLabel={`Show ${section.label} on the public page`}
                  />
                </Row>
              </View>
            );
          })}
        </Card>
      ))}
    </View>
  );
}
