/**
 * The whole path for the open section, on every tab: each phase a group, each
 * milestone a dot — done filled, the next one ringed in Nova's gradient with
 * "Here" under it — and a tap opens the milestone. The native
 * section-path-strip.tsx. An unstarted section is a slim "Not started" row.
 */
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, Icon, NovaGradient } from "../ui";
import { sectionDef, useSectionPath, type ProjectGoal } from "../../sections";
import type { NoPath, PathMilestone, PathStatus } from "./shared";

export function SectionPathStrip({ projectId, goal, onOpenMilestone, onStart }: {
  projectId: string;
  goal: ProjectGoal;
  onOpenMilestone: (m: { id: string; title: string }) => void;
  onStart?: () => void;
}) {
  const { data, isLoading } = useSectionPath<PathStatus | NoPath>(projectId, goal);
  const def = sectionDef(goal);

  if (isLoading) return <View style={{ height: 58, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: 0.6 }} />;
  if (!data) return null;

  if (!data.adopted) {
    const notStarted = data.started === false;
    return (
      <View testID="section-path-strip" style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, backgroundColor: colors.surface }}>
        <Icon name={def.icon} size={15} color={colors.textTertiary} />
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{def.label}</Text>
        <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.regular, color: colors.textTertiary }}>{notStarted ? "Not started" : "Path not set up"}</Text>
        {notStarted && onStart && <Btn small icon="play" label="Start" onPress={onStart} style={{ marginLeft: "auto", paddingVertical: 4 }} />}
      </View>
    );
  }
  return <Strip data={data} onOpen={onOpenMilestone} />;
}

function Strip({ data, onOpen }: { data: PathStatus; onOpen: (m: { id: string; title: string }) => void }) {
  const scroller = useRef<ScrollView>(null);
  const hereX = useRef<number | null>(null);
  const width = useRef(0);
  const nextId = data.next?.id ?? null;
  const { done, total } = data.mainLine;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const reveal = () => {
    if (hereX.current == null || !width.current) return;
    scroller.current?.scrollTo({ x: Math.max(0, hereX.current - width.current / 2), animated: true });
  };
  useEffect(() => { hereX.current = null; }, [nextId]);

  return (
    <View testID="section-path-strip" style={{ flexDirection: "row", alignItems: "stretch", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" }}>
      <View style={{ justifyContent: "center", paddingHorizontal: spacing.md, borderRightWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: font.base, fontFamily: fontFamily.bold, color: colors.text }} testID="strip-progress">{pct}%</Text>
        <Text style={{ fontSize: 10, fontFamily: fontFamily.medium, color: colors.textTertiary }}>{done}/{total}</Text>
      </View>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        onLayout={(e) => { width.current = e.nativeEvent.layout.width; reveal(); }}
      >
        {data.phases.map((phase) => {
          const [head] = phase.title.split(" — ");
          const isCurrent = phase.id === data.current.id;
          const dim = phase.optional && data.branch?.phaseId !== phase.id;
          const complete = phase.total > 0 && phase.done === phase.total;
          return (
            <View
              key={phase.id}
              onLayout={(e) => {
                // Keep "you are here" in view: remember where the phase holding the next milestone sits.
                if (phase.milestones.some((m) => m.id === nextId)) { hereX.current = e.nativeEvent.layout.x + e.nativeEvent.layout.width / 2; reveal(); }
              }}
              style={{
                justifyContent: "center", gap: 7, paddingHorizontal: spacing.md, paddingTop: 7, paddingBottom: 14,
                borderRightWidth: 1, borderColor: colors.border, borderStyle: phase.optional ? "dashed" : "solid",
                opacity: dim ? 0.55 : 1, backgroundColor: isCurrent ? `${colors.primary}08` : "transparent",
              }}
              testID={`strip-phase-${phase.id}`}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {phase.optional && <Icon name="git-branch-outline" size={10} color={colors.textTertiary} />}
                <Text style={{ fontSize: 10, fontFamily: fontFamily.semibold, color: isCurrent ? colors.primary : complete ? colors.textTertiary : colors.text }}>{head}</Text>
                <Text style={{ fontSize: 10, fontFamily: fontFamily.medium, color: complete ? colors.success : colors.textTertiary }}>{phase.done}/{phase.total}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {phase.milestones.map((m, j) => (
                  <View key={m.id} style={{ flexDirection: "row", alignItems: "center" }}>
                    {j > 0 && <View style={{ height: 1, width: 6, backgroundColor: m.done ? `${colors.primary}99` : colors.border }} />}
                    <Node m={m} next={m.id === nextId} onOpen={onOpen} />
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Node({ m, next, onOpen }: { m: PathMilestone; next: boolean; onOpen: (m: { id: string; title: string }) => void }) {
  const state = m.done ? "Done" : next ? "Next" : "To do";
  return (
    <Pressable
      onPress={() => onOpen({ id: m.id, title: m.title })}
      hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
      accessibilityRole="button"
      accessibilityLabel={`${m.title} — ${state}`}
      testID={`strip-node-${m.id}`}
      style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}
    >
      {next ? (
        <>
          <NovaGradient style={{ width: 17, height: 17, borderRadius: 9, padding: 3 }}>
            <View style={{ flex: 1, borderRadius: 6, backgroundColor: colors.surface }} />
          </NovaGradient>
          <Text style={{ position: "absolute", top: 19, width: 40, left: -10, textAlign: "center", fontSize: 9, fontFamily: fontFamily.bold, color: colors.novaEmerald }}>Here</Text>
        </>
      ) : m.done ? (
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary }} />
      ) : (
        <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: `${colors.textTertiary}66`, backgroundColor: colors.surface }} />
      )}
    </Pressable>
  );
}
