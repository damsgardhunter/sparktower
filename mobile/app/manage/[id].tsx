import { useEffect, useRef, useState } from "react";
import { ScrollView, RefreshControl, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, readPref, writePref } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, fontFamily, spacing } from "../../src/theme";
import { Btn, Empty, Loading, Row } from "../../src/components/ui";
import { ProjectLogo } from "../../src/components/ProjectBits";
import { NoticeProvider } from "../../src/components/manage/bits";
import { Dashboard } from "../../src/components/manage/Dashboard";
import { Kanban } from "../../src/components/manage/Kanban";
import { Milestones } from "../../src/components/manage/Milestones";
import { Team } from "../../src/components/manage/Team";
import { Investors } from "../../src/components/manage/Investors";
import { Setup } from "../../src/components/manage/Setup";
import { Roadmap } from "../../src/components/manage/Roadmap";
import { PublicPage } from "../../src/components/manage/PublicPage";
import { Files } from "../../src/components/manage/Files";
import { Activity } from "../../src/components/manage/Activity";
import { Personas } from "../../src/components/manage/Personas";
import { Chat } from "../../src/components/manage/Chat";
import { WebTools, type WebOnlyTab } from "../../src/components/manage/WebTools";
import { MilestoneSheet } from "../../src/components/manage/MilestoneDetail";
import { StartSectionSheet } from "../../src/components/manage/StartSectionSheet";
import { SectionPathStrip } from "../../src/components/manage/SectionPathStrip";
import { ALL_TABS, ProjectTabRow, SectionSwitcher, SectionTabRow, type Tab } from "../../src/components/manage/SectionChrome";
import { mkey } from "../../src/components/manage/shared";
import { NovaFab, NovaGuideSheet, useNovaMessages } from "../../src/components/manage/path/NovaGuide";
import { normaliseGoal, sectionDef, useScreenFocused, useSections, type ProjectGoal } from "../../src/sections";

/** Paths whose first screen is the money step's bubbles on the dashboard, not the chat (nova-guide.tsx). */
const MONEY_FIRST = new Set(["systemize_business", "run_company"]);

/** Older links and the web's ids: `?tab=kanban`, `?tab=nova`, and the retired `?tab=checkins` (now Activity). */
const ALIAS: Record<string, { tab: Tab; sub?: "feedback" }> = {
  nova: { tab: "dashboard" }, kanban: { tab: "tasks" }, checkins: { tab: "activity" }, tools: { tab: "codebase" },
};

const resolve = (t?: string | null): { tab: Tab; sub?: "feedback" } =>
  !t ? { tab: "dashboard" } : ALIAS[t] ?? (ALL_TABS.some((x) => x.value === t) ? { tab: t as Tab } : { tab: "dashboard" });

const sectionPrefKey = (projectId: string) => `manager-section.${projectId}`;

/**
 * The project manager — the team's workspace, the native counterpart of
 * client/src/pages/project-manager.tsx. A project works three sections side
 * by side (Ship, Systemize, Raise), each its own path with its own Dashboard,
 * Roadmap, Tasks, Files and Analytics; Setup, Codebase, Team and Chat belong
 * to the whole project. Switching section only changes what you're looking at.
 */
export default function Manage() {
  const { id, tab: initialTab, section: sectionParam, from, focus } = useLocalSearchParams<{ id: string; tab?: string; section?: string; from?: string; focus?: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const focused = useScreenFocused();
  const [{ tab, sub }, setState] = useState(() => resolve(initialTab));
  const [refreshing, setRefreshing] = useState(false);
  // A link can open straight onto a tab (`?tab=investors`), as on the web.
  useEffect(() => { if (initialTab) setState(resolve(initialTab)); }, [initialTab]);
  const setTab = (t: Tab) => setState({ tab: t });

  /**
   * The open section: ?section= in the link, else the one last opened on this
   * device for this project, else (once the sections load) the primary.
   */
  // An old link to the retired funding section opens Systemize, which holds it now.
  const linkedSection = normaliseGoal(sectionParam);
  const [chosen, setChosen] = useState<ProjectGoal | null>(linkedSection);
  const [prefRead, setPrefRead] = useState(!!linkedSection);
  useEffect(() => {
    if (linkedSection) { setChosen(linkedSection); setPrefRead(true); return; }
    if (!id) return;
    let live = true;
    // Normalised like the link above: a remembered "raise_funding" (the retired Raise section) opens the section that took it over, not the default.
    readPref(sectionPrefKey(id)).then((v) => { const g = normaliseGoal(v); if (live && g) setChosen((c) => c ?? g); }).catch(() => {}).finally(() => { if (live) setPrefRead(true); });
    return () => { live = false; };
  }, [id, sectionParam]);
  useEffect(() => { if (id && chosen) void writePref(sectionPrefKey(id), chosen).catch(() => {}); }, [id, chosen]);

  const { data: sections } = useSections(id, focused);
  const primary: ProjectGoal = sections?.primary ?? "ship_mvp";
  const section: ProjectGoal = chosen ?? primary;
  const [startFor, setStartFor] = useState<ProjectGoal | null>(null);
  const [openMilestone, setOpenMilestone] = useState<{ id: string; title: string } | null>(null);

  // Coming back to this screen: pick up what changed elsewhere (a teammate, the web, the editor bridge).
  const wasFocused = useRef(true);
  useEffect(() => {
    if (focused && !wasFocused.current && id) {
      for (const key of ["kanban", "files", "milestones", "path"]) void qc.invalidateQueries({ queryKey: ["manage", id, key] });
    }
    wasFocused.current = focused;
  }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: project, isLoading, error } = useQuery({
    queryKey: mkey(id!, "project"),
    queryFn: () => api<any>(`/api/projects/${id}`),
    enabled: !!id,
  });
  const { data: members } = useQuery({
    queryKey: mkey(id!, "members"),
    queryFn: () => api<any[]>(`/api/projects/${id}/members`),
    enabled: !!id,
  });

  const [nova, setNova] = useState<{ open: boolean; message: string | null }>({ open: false, message: null });
  const { data: novaMessages } = useNovaMessages(id!);
  const autoOpened = useRef(false);
  // A new project lands on Nova, the way the web's onboarding overlay opens over the manager.
  useEffect(() => {
    if (autoOpened.current || !project || !novaMessages || !members) return;
    autoOpened.current = true;
    const member = project.ownerId === user?.id || members.some((m) => m.userId === user?.id);
    if (member && !project.novaOnboardingComplete && novaMessages.length === 0 && !MONEY_FIRST.has(project.goal) && tab === "dashboard"
      // A link into another section (the home card's "Continue" on Raise, say) opens that section, not the welcome.
      && (!linkedSection || linkedSection === project.goal)
      // Opening the app lands on the path; the welcome chat is for arriving from a new project, not every launch (the Nova button is right there).
      && from !== "launch"
      // Nor when a notification sent them to a step: that step is what they came for.
      && !focus) {
      setNova({ open: true, message: null });
    }
  }, [project, novaMessages, members]);

  const isOwner = !!project && project.ownerId === user?.id;
  const isMember = isOwner || !!members?.some((m) => m.userId === user?.id);

  const onRefresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ["manage", id] });
    setRefreshing(false);
  };

  /** Opening a section: an unstarted one asks what kind of project it is first. */
  const selectSection = (goal: ProjectGoal) => {
    setChosen(goal);
    const summary = sections?.tracks.find((t) => t.goal === goal);
    if (summary && !summary.started) setStartFor(goal);
  };

  if (isLoading) return <><Stack.Screen options={{ title: "Manage" }} /><Loading /></>;
  if (!project) {
    return (
      <><Stack.Screen options={{ title: "Manage" }} />
        <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center" }}>
          <Empty icon="alert-circle-outline" title="Project not found" body={(error as any)?.message} action="Back to Projects" onAction={() => router.back()} />
        </View>
      </>
    );
  }
  if (members && !isMember) {
    return (
      <><Stack.Screen options={{ title: project.title }} />
        <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center" }}>
          <Empty icon="lock-closed-outline" title="This workspace is for the team" body="You don't have access to this project's management dashboard." action="Back to Project" onAction={() => router.replace(`/project/${id}` as any)} />
        </View>
      </>
    );
  }

  const go = (t: string) => setState(resolve(t));
  const current = ALL_TABS.find((t) => t.value === (tab === "investors" && !isOwner ? "dashboard" : tab)) ?? ALL_TABS[0];
  const def = sectionDef(section);
  const ready = prefRead && (!!chosen || !!sections);
  const openStart = () => setStartFor(section);

  return (
    <NoticeProvider>
      <Stack.Screen options={{ title: "Manage" }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.canvas }}
        contentContainerStyle={{ paddingBottom: spacing.xxl * 3 }}
        stickyHeaderIndices={[2]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* The title bar: the project, and where you are in it — section · tab. */}
        <View style={{ backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm }}>
          <Row gap={spacing.md} center>
            <ProjectLogo title={project.title} uri={project.logoUrl} size={40} />
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg + 1, color: colors.text }} numberOfLines={1} testID="text-manager-title">{project.title}</Text>
              <Text numberOfLines={1} testID="text-manager-breadcrumb" style={{ fontSize: font.sm, fontFamily: fontFamily.regular, color: colors.textTertiary }}>
                {def.label}<Text style={{ color: colors.border }}>{"  ·  "}</Text><Text style={{ color: colors.primary, fontFamily: fontFamily.semibold }}>{current.label}</Text>
              </Text>
            </View>
            <Btn small variant="outline" icon="eye-outline" label="View" onPress={() => router.push(`/project/${id}` as any)} />
          </Row>
        </View>

        {/* The three sections, parallel: tapping one only changes what you're looking at. */}
        <View style={{ backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingBottom: spacing.md, paddingTop: spacing.xs }}>
          <SectionSwitcher tracks={sections?.tracks} selected={section} onSelect={selectSection} />
        </View>

        <SectionTabRow active={tab} onSelect={setTab} isOwner={isOwner} />

        <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm }}>
          {/* The whole path for the open section, whatever tab is showing. */}
          <SectionPathStrip projectId={id!} goal={section} onOpenMilestone={setOpenMilestone} onStart={openStart} />
          <ProjectTabRow active={tab} onSelect={setTab} />
        </View>

        <View style={{ padding: spacing.md, gap: spacing.md }} testID={`manager-content-${tab}`}>
          {/* Until the open section is known, don't mount one section's content only to swap it. */}
          {!ready ? <View style={{ height: 200 }}><Loading /></View> : (
            <>
              {tab === "dashboard" && (
                <Dashboard key={section} projectId={id!} project={project} goal={section} isPrimary={section === primary}
                  onStartSection={openStart} onNavigate={go} onOpenNova={(message) => setNova({ open: true, message: message ?? null })} />
              )}
              {tab === "setup" && <Setup projectId={id!} project={project} isOwner={isOwner} />}
              {tab === "public" && <PublicPage projectId={id!} project={project} isOwner={isOwner} onEditBrief={() => setTab("setup")} />}
              {tab === "roadmap" && <Roadmap key={section} projectId={id!} goal={section} isPrimary={section === primary} />}
              {tab === "tasks" && <Kanban key={section} projectId={id!} members={members ?? []} goal={section} primary={primary} />}
              {tab === "milestones" && <Milestones key={section} projectId={id!} goal={section} primary={primary} />}
              {tab === "team" && <Team projectId={id!} project={project} members={members ?? []} isOwner={isOwner} />}
              {tab === "files" && <Files key={section} projectId={id!} goal={section} />}
              {tab === "activity" && <Activity key={sub ?? "feed"} projectId={id!} projectTitle={project.title} initialSection={sub} />}
              {tab === "personas" && <Personas projectId={id!} />}
              {tab === "investors" && isOwner && <Investors projectId={id!} isOwner={isOwner} />}
              {tab === "chat" && <Chat projectId={id!} />}
              {(["codebase", "research", "strategy", "launch", "analytics", "support"] as const).includes(tab as WebOnlyTab) && (
                <WebTools key={tab === "analytics" ? section : tab} projectId={id!} tab={tab as WebOnlyTab} goal={section} />
              )}
            </>
          )}
        </View>
      </ScrollView>
      <NovaFab onPress={() => setNova({ open: true, message: null })} />
      <NovaGuideSheet
        projectId={id!} visible={nova.open} initialMessage={nova.message} currentTab={tab} section={section}
        onboarding={!project.novaOnboardingComplete}
        onClose={() => setNova({ open: false, message: null })}
      />
      <StartSectionSheet projectId={id!} goal={startFor} onClose={() => setStartFor(null)} onStarted={(g) => setChosen(g)} />
      <MilestoneSheet projectId={id!} backboneId={openMilestone?.id ?? null} title={openMilestone?.title ?? ""} onClose={() => setOpenMilestone(null)} />
    </NoticeProvider>
  );
}
