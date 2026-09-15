import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, RefreshControl, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, fontFamily, spacing } from "../../src/theme";
import { Btn, Empty, Icon, Loading, Meta, Row, type IconName } from "../../src/components/ui";
import { ScrollingTabs } from "../../src/components/project/ScrollingTabs";
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
import { goalLabel, mkey } from "../../src/components/manage/shared";
import { NovaFab, NovaGuideSheet, useNovaMessages } from "../../src/components/manage/path/NovaGuide";

/** Paths whose first screen is the money step's bubbles on the dashboard, not the chat (nova-guide.tsx). */
const MONEY_FIRST = new Set(["systemize_business", "raise_funding"]);

type Tab =
  | "dashboard" | "setup" | "public" | "roadmap" | "tasks" | "milestones" | "team" | "files" | "codebase" | "activity"
  | "personas" | "research" | "strategy" | "investors" | "launch" | "analytics" | "support" | "chat";

/** The web manager's rail, in its order (client/src/pages/project-manager.tsx). */
const TABS: { value: Tab; label: string; icon: IconName; ownerOnly?: boolean }[] = [
  { value: "dashboard", label: "Dashboard", icon: "sparkles-outline" },
  { value: "setup", label: "Setup", icon: "grid-outline" },
  { value: "public", label: "Public Page", icon: "eye-outline" },
  { value: "roadmap", label: "Roadmap", icon: "map-outline" },
  { value: "tasks", label: "Tasks", icon: "list-outline" },
  { value: "milestones", label: "Milestones", icon: "flag-outline" },
  { value: "team", label: "Team", icon: "people-outline" },
  { value: "files", label: "Files", icon: "folder-open-outline" },
  { value: "codebase", label: "Codebase", icon: "scan-outline" },
  { value: "activity", label: "Activity", icon: "pulse-outline" },
  { value: "personas", label: "Personas", icon: "locate-outline" },
  { value: "research", label: "Research", icon: "flask-outline" },
  { value: "strategy", label: "Strategy", icon: "compass-outline" },
  { value: "investors", label: "Investors", icon: "cash-outline", ownerOnly: true },
  { value: "launch", label: "Launch", icon: "rocket-outline" },
  { value: "analytics", label: "Analytics", icon: "bar-chart-outline" },
  { value: "support", label: "Support", icon: "headset-outline" },
  { value: "chat", label: "Chat", icon: "chatbubbles-outline" },
];

/** Older links and the web's ids: `?tab=kanban`, `?tab=nova`, and the home rail's `?tab=checkins`. */
const ALIAS: Record<string, { tab: Tab; section?: "checkins" }> = {
  nova: { tab: "dashboard" }, kanban: { tab: "tasks" }, checkins: { tab: "activity", section: "checkins" }, tools: { tab: "codebase" },
};

const resolve = (t?: string | null): { tab: Tab; section?: "checkins" } =>
  !t ? { tab: "dashboard" } : ALIAS[t] ?? (TABS.some((x) => x.value === t) ? { tab: t as Tab } : { tab: "dashboard" });

/**
 * The project manager — the team's workspace, the native counterpart of
 * client/src/pages/project-manager.tsx: the project's title and the section
 * you're in, the web's eighteen sections in a scrolling tab strip, and Nova's
 * dashboard first. The tools too dense for a phone keep their tab and open
 * the website.
 */
export default function Manage() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [{ tab, section }, setState] = useState(() => resolve(initialTab));
  const [refreshing, setRefreshing] = useState(false);
  // A link can open straight onto a section (`?tab=investors`), as on the web.
  useEffect(() => { if (initialTab) setState(resolve(initialTab)); }, [initialTab]);
  const setTab = (t: Tab) => setState({ tab: t });

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
    if (member && !project.novaOnboardingComplete && novaMessages.length === 0 && !MONEY_FIRST.has(project.goal) && tab === "dashboard") {
      setNova({ open: true, message: null });
    }
  }, [project, novaMessages, members]);

  const isOwner = !!project && project.ownerId === user?.id;
  const isMember = isOwner || !!members?.some((m) => m.userId === user?.id);
  const tabs = useMemo(() => TABS.filter((t) => !t.ownerOnly || isOwner), [isOwner]);

  const onRefresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ["manage", id] });
    setRefreshing(false);
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
  const current = tabs.find((t) => t.value === tab) ?? tabs[0];

  return (
    <NoticeProvider>
      <Stack.Screen options={{ title: "Manage" }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.canvas }}
        contentContainerStyle={{ paddingBottom: spacing.xxl * 3 }}
        stickyHeaderIndices={[1]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* The web's sticky title bar: the project, and which section you're in. */}
        <View style={{ backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
          <Row gap={spacing.md} center>
            <ProjectLogo title={project.title} uri={project.logoUrl} size={44} />
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg + 1, color: colors.text }} numberOfLines={1} testID="text-manager-title">{project.title}</Text>
              <Row center gap={4}>
                <Icon name={current.icon} size={13} color={colors.primary} />
                <Meta style={{ color: colors.primary, fontFamily: fontFamily.semibold, fontSize: font.sm }}>{current.label}</Meta>
                <Meta numberOfLines={1} style={{ flexShrink: 1 }}>· {goalLabel(project.goal)} · {isOwner ? "Owner" : "Member"}{project.isPrivate ? " · Private" : ""}</Meta>
              </Row>
            </View>
            <Btn small variant="outline" icon="eye-outline" label="View" onPress={() => router.push(`/project/${id}` as any)} />
          </Row>
        </View>

        <ScrollingTabs options={tabs} value={tab} onChange={setTab} />

        <View style={{ padding: spacing.md, gap: spacing.md }}>
          {tab === "dashboard" && <Dashboard projectId={id!} project={project} onNavigate={go} onOpenNova={(message) => setNova({ open: true, message: message ?? null })} />}
          {tab === "setup" && <Setup projectId={id!} project={project} isOwner={isOwner} />}
          {tab === "public" && <PublicPage projectId={id!} project={project} isOwner={isOwner} onEditBrief={() => setTab("setup")} />}
          {tab === "roadmap" && <Roadmap projectId={id!} />}
          {tab === "tasks" && <Kanban projectId={id!} members={members ?? []} />}
          {tab === "milestones" && <Milestones projectId={id!} />}
          {tab === "team" && <Team projectId={id!} project={project} members={members ?? []} isOwner={isOwner} />}
          {tab === "files" && <Files projectId={id!} />}
          {tab === "activity" && <Activity key={section ?? "feed"} projectId={id!} projectTitle={project.title} initialSection={section} />}
          {tab === "personas" && <Personas projectId={id!} />}
          {tab === "investors" && isOwner && <Investors projectId={id!} isOwner={isOwner} />}
          {tab === "chat" && <Chat projectId={id!} />}
          {(["codebase", "research", "strategy", "launch", "analytics", "support"] as const).includes(tab as WebOnlyTab) && (
            <WebTools projectId={id!} tab={tab as WebOnlyTab} />
          )}
        </View>
      </ScrollView>
      <NovaFab onPress={() => setNova({ open: true, message: null })} />
      <NovaGuideSheet
        projectId={id!} visible={nova.open} initialMessage={nova.message} currentTab={tab}
        onboarding={!project.novaOnboardingComplete}
        onClose={() => setNova({ open: false, message: null })}
      />
    </NoticeProvider>
  );
}
