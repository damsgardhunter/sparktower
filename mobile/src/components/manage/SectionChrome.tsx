/**
 * The manager's frame on a phone, after client/src/components/manager/*:
 * the three sections as a switcher, each section's own tabs with a More
 * sheet, and the project-wide tabs (Setup, Codebase, Team, Chat) in their own
 * Nova-outlined row.
 */
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Icon, NovaGradient, type IconName } from "../ui";
import { Sheet } from "../Sheet";
import { GradientOutline } from "./bits";
import { SECTIONS, type ProjectGoal, type SectionSummary } from "../../sections";

export type Tab =
  | "dashboard" | "roadmap" | "tasks" | "files" | "analytics"
  | "public" | "milestones" | "activity" | "personas" | "research" | "strategy" | "investors" | "launch" | "support"
  | "setup" | "codebase" | "team" | "chat";

export interface TabDef { value: Tab; label: string; icon: IconName; ownerOnly?: boolean }

/** Each section's own Dashboard, Roadmap, Tasks, Files and Analytics. */
export const SECTION_TABS: TabDef[] = [
  { value: "dashboard", label: "Dashboard", icon: "sparkles-outline" },
  { value: "roadmap", label: "Roadmap", icon: "map-outline" },
  { value: "tasks", label: "Tasks", icon: "list-outline" },
  { value: "files", label: "Files", icon: "folder-open-outline" },
  { value: "analytics", label: "Analytics", icon: "bar-chart-outline" },
];
export const MORE_TABS: TabDef[] = [
  { value: "public", label: "Public Page", icon: "eye-outline" },
  { value: "milestones", label: "Milestones", icon: "flag-outline" },
  { value: "activity", label: "Activity", icon: "pulse-outline" },
  { value: "personas", label: "Personas", icon: "locate-outline" },
  { value: "research", label: "Research", icon: "flask-outline" },
  { value: "strategy", label: "Strategy", icon: "compass-outline" },
  { value: "investors", label: "Investors", icon: "cash-outline", ownerOnly: true },
  { value: "launch", label: "Launch", icon: "rocket-outline" },
  { value: "support", label: "Support", icon: "headset-outline" },
];
/** The project-wide tabs, the same whichever section is open. */
export const PROJECT_TABS: TabDef[] = [
  { value: "setup", label: "Setup", icon: "grid-outline" },
  { value: "codebase", label: "Codebase", icon: "scan-outline" },
  { value: "team", label: "Team", icon: "people-outline" },
  { value: "chat", label: "Chat", icon: "chatbubbles-outline" },
];
export const ALL_TABS: TabDef[] = [...SECTION_TABS, ...MORE_TABS, ...PROJECT_TABS];

// --- Sections ------------------------------------------------------------------

export function SectionSwitcher({ tracks, selected, onSelect }: {
  tracks: SectionSummary[] | undefined; selected: ProjectGoal; onSelect: (goal: ProjectGoal) => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm }} accessibilityRole="tablist" testID="section-switcher">
      {SECTIONS.map((s) => {
        const summary = tracks?.find((t) => t.goal === s.goal);
        const active = s.goal === selected;
        const started = summary?.started ?? false;
        const done = summary?.done ?? 0;
        const total = summary?.total ?? 0;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return (
          <Pressable
            key={s.goal}
            onPress={() => onSelect(s.goal)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${s.label}${started ? `, ${done} of ${total} done` : ", not started"}`}
            testID={`section-${s.goal}`}
            style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.8 }]}
          >
            <GradientOutline on={active} width={active ? 2 : 1} rounded={radius.md} style={{ flex: 1 }} innerStyle={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {active ? (
                  <NovaGradient style={{ width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" }}>
                    <Icon name={s.icon} size={14} color="#FFFFFF" />
                  </NovaGradient>
                ) : (
                  <View style={{ width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised }}>
                    <Icon name={s.icon} size={14} color={colors.textTertiary} />
                  </View>
                )}
                <Text numberOfLines={1} style={{ flex: 1, fontSize: font.sm, fontFamily: active ? fontFamily.bold : fontFamily.semibold, color: active ? colors.text : colors.textSecondary }}>{s.short}</Text>
              </View>
              {started ? (
                <View style={{ gap: 4 }}>
                  <Text style={{ fontSize: 11, fontFamily: fontFamily.medium, color: colors.textTertiary }} testID={`section-progress-${s.goal}`}>{done}/{total} done</Text>
                  <View style={{ height: 3, borderRadius: 2, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
                    {pct > 0 && <NovaGradient style={{ width: `${pct}%`, height: "100%" }} />}
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3, height: 22 }}>
                  <Icon name="play" size={11} color={colors.novaEmerald} />
                  <Text style={{ fontSize: 11, fontFamily: fontFamily.semibold, color: colors.novaEmerald }}>Start</Text>
                </View>
              )}
            </GradientOutline>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- Section tabs --------------------------------------------------------------

export function SectionTabRow({ active, onSelect, isOwner }: { active: Tab; onSelect: (t: Tab) => void; isOwner: boolean }) {
  const [more, setMore] = useState(false);
  const moreTabs = MORE_TABS.filter((t) => !t.ownerOnly || isOwner);
  const inMore = moreTabs.find((t) => t.value === active);
  // Keep the selected tab in view, so a link that opens `?tab=analytics` shows it selected, not off-screen.
  const scroller = useRef<ScrollView>(null);
  const xs = useRef<Record<string, { x: number; width: number }>>({});
  const viewport = useRef(0);
  const key = inMore ? "more" : active;
  const reveal = () => {
    const at = xs.current[key];
    if (!at || !viewport.current) return;
    scroller.current?.scrollTo({ x: Math.max(0, at.x - (viewport.current - at.width) / 2), animated: true });
  };
  useEffect(reveal, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const measure = (k: string) => (e: { nativeEvent: { layout: { x: number; width: number } } }) => {
    xs.current[k] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
    if (k === key) reveal();
  };
  return (
    <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border }}>
      <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.sm }}
        onLayout={(e) => { viewport.current = e.nativeEvent.layout.width; reveal(); }}>
        {SECTION_TABS.map((t) => (
          <View key={t.value} onLayout={measure(t.value)}>
            <TabItem label={t.label} icon={t.icon} on={active === t.value} onPress={() => onSelect(t.value)} testID={`tab-${t.value}`} />
          </View>
        ))}
        <View onLayout={measure("more")}>
          <TabItem label={inMore ? inMore.label : "More"} icon={inMore ? inMore.icon : "ellipsis-horizontal"} on={!!inMore} onPress={() => setMore(true)} chevron testID="tab-more" />
        </View>
      </ScrollView>
      <Sheet visible={more} onClose={() => setMore(false)} title="More for this project">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }} testID="more-sheet">
          {moreTabs.map((t) => {
            const on = t.value === active;
            return (
              <Pressable
                key={t.value}
                onPress={() => { setMore(false); onSelect(t.value); }}
                testID={`more-${t.value}`}
                style={({ pressed }) => [{
                  width: "31%", flexGrow: 1, alignItems: "center", gap: 6, paddingVertical: spacing.md, borderRadius: radius.md,
                  borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primarySoft : colors.surface,
                }, pressed && { opacity: 0.7 }]}
              >
                <Icon name={t.icon} size={20} color={on ? colors.primary : colors.textSecondary} />
                <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: on ? colors.primary : colors.text }}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

function TabItem({ label, icon, on, onPress, chevron, testID }: { label: string; icon: IconName; on: boolean; onPress: () => void; chevron?: boolean; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      testID={testID}
      style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: spacing.md - 2, paddingHorizontal: spacing.sm + 2, borderBottomWidth: 2, borderColor: on ? colors.primary : "transparent" }}
    >
      <Icon name={icon} size={14} color={on ? colors.primary : colors.textTertiary} />
      <Text style={{ fontSize: font.sm, fontFamily: on ? fontFamily.semibold : fontFamily.medium, color: on ? colors.primary : colors.textSecondary }}>{label}</Text>
      {chevron && <Icon name="chevron-down" size={12} color={on ? colors.primary : colors.textTertiary} />}
    </Pressable>
  );
}

// --- Project-wide tabs ---------------------------------------------------------

export function ProjectTabRow({ active, onSelect }: { active: Tab; onSelect: (t: Tab) => void }) {
  return (
    <GradientOutline width={1.5} rounded={radius.md} innerStyle={{ flexDirection: "row", alignItems: "center", paddingVertical: 4, paddingHorizontal: 4 }}>
      <Text style={{ fontSize: 10, fontFamily: fontFamily.semibold, color: colors.textTertiary, letterSpacing: 0.6, textTransform: "uppercase", paddingHorizontal: 6 }}>Project</Text>
      <View style={{ flex: 1, flexDirection: "row", gap: 2 }} testID="project-tabs">
        {PROJECT_TABS.map((t) => {
          const on = t.value === active;
          return (
            <Pressable
              key={t.value}
              onPress={() => onSelect(t.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              testID={`project-tab-${t.value}`}
              style={({ pressed }) => [{
                flex: 1, alignItems: "center", gap: 2, paddingVertical: 6, borderRadius: radius.sm,
                backgroundColor: on ? colors.primarySoft : "transparent",
              }, pressed && { opacity: 0.7 }]}
            >
              <Icon name={t.icon} size={17} color={on ? colors.primary : colors.novaEmerald} />
              <Text style={{ fontSize: 11, fontFamily: on ? fontFamily.semibold : fontFamily.medium, color: on ? colors.primary : colors.text }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </GradientOutline>
  );
}
