import { useEffect, useMemo, useState } from "react";
import { Image, ScrollView, RefreshControl, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, fontFamily, spacing } from "../../src/theme";
import { Btn, Empty, Icon, Loading, Meta, NovaGradient, Row, TabStrip, assetUri } from "../../src/components/ui";
import { NoticeProvider } from "../../src/components/manage/bits";
import { Dashboard } from "../../src/components/manage/Dashboard";
import { Kanban } from "../../src/components/manage/Kanban";
import { Milestones } from "../../src/components/manage/Milestones";
import { CheckIns } from "../../src/components/manage/CheckIns";
import { Team } from "../../src/components/manage/Team";
import { Investors } from "../../src/components/manage/Investors";
import { Setup } from "../../src/components/manage/Setup";
import { Roadmap } from "../../src/components/manage/Roadmap";
import { WebTools } from "../../src/components/manage/WebTools";
import { goalLabel, mkey } from "../../src/components/manage/shared";

type Tab = "dashboard" | "tasks" | "milestones" | "checkins" | "team" | "investors" | "roadmap" | "setup" | "tools";

/**
 * The project manager — the owner's and members' workspace, the native
 * counterpart of client/src/pages/project-manager.tsx. Nova's path leads;
 * the sections sit in a scrollable tab strip under the project header.
 */
export default function Manage() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || "dashboard");
  const [refreshing, setRefreshing] = useState(false);
  // A link can open straight onto a section (`?tab=investors`), as on the web.
  useEffect(() => { if (initialTab) setTab(initialTab as Tab); }, [initialTab]);

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

  const isOwner = !!project && project.ownerId === user?.id;
  const isMember = isOwner || !!members?.some((m) => m.userId === user?.id);

  const tabs = useMemo(() => ([
    { value: "dashboard", label: "Dashboard" },
    { value: "tasks", label: "Tasks" },
    { value: "milestones", label: "Milestones" },
    { value: "checkins", label: "Check-ins" },
    { value: "team", label: "Team" },
    { value: "investors", label: "Investors" },
    { value: "roadmap", label: "Roadmap" },
    { value: "setup", label: "Setup" },
    { value: "tools", label: "More tools" },
  ] as { value: Tab; label: string }[]), []);

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
          <Empty icon="alert-circle-outline" title="Couldn't load this project" body={(error as any)?.message} action="Back to projects" onAction={() => router.back()} />
        </View>
      </>
    );
  }
  if (members && !isMember) {
    return (
      <><Stack.Screen options={{ title: project.title }} />
        <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center" }}>
          <Empty icon="lock-closed-outline" title="This workspace is for the team" body="You don't have access to this project's management dashboard." action="View the project" onAction={() => router.replace(`/project/${id}` as any)} />
        </View>
      </>
    );
  }

  const go = (t: string) => setTab((tabs.some((x) => x.value === t) ? t : "tools") as Tab);

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
        {/* Project header: cover, logo, title, path — LinkedIn's page header */}
        <View style={{ backgroundColor: colors.surface }}>
          {project.coverUrl
            ? <Image source={{ uri: assetUri(project.coverUrl)! }} style={{ height: 88, width: "100%" }} resizeMode="cover" />
            : <NovaGradient style={{ height: 88, opacity: 0.85 }} />}
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
            <View style={{ marginTop: -30, width: 60, height: 60, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 3, borderColor: colors.surface, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
              {project.logoUrl
                ? <Image source={{ uri: assetUri(project.logoUrl)! }} style={{ width: 54, height: 54, borderRadius: 9 }} resizeMode="cover" />
                : <View style={{ width: 54, height: 54, borderRadius: 9, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}><Text style={{ fontFamily: fontFamily.bold, fontSize: 24, color: colors.primary }}>{(project.title || "?").charAt(0).toUpperCase()}</Text></View>}
            </View>
            <Row between style={{ marginTop: spacing.sm, alignItems: "flex-start" }} gap={spacing.md}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: fontFamily.bold, fontSize: font.xl, color: colors.text, letterSpacing: -0.3 }} numberOfLines={2}>{project.title}</Text>
                {!!project.oneLiner && <Text style={{ fontFamily: fontFamily.regular, fontSize: font.sm, color: colors.textSecondary }} numberOfLines={2}>{project.oneLiner}</Text>}
                <Row center gap={4} style={{ marginTop: 2 }}>
                  <Icon name="navigate-circle-outline" size={13} color={colors.primary} />
                  <Meta style={{ color: colors.primary, fontFamily: fontFamily.semibold }}>{goalLabel(project.goal)}</Meta>
                  <Meta>· {isOwner ? "Owner" : "Member"}{project.isPrivate ? " · Private" : ""}</Meta>
                </Row>
              </View>
              <Btn small variant="outline" icon="eye-outline" label="Public page" onPress={() => router.push(`/project/${id}` as any)} />
            </Row>
          </View>
        </View>

        <TabStrip options={tabs} value={tab} onChange={setTab} />

        <View style={{ padding: spacing.md, gap: spacing.md }}>
          {tab === "dashboard" && <Dashboard projectId={id!} project={project} onNavigate={go} />}
          {tab === "tasks" && <Kanban projectId={id!} members={members ?? []} />}
          {tab === "milestones" && <Milestones projectId={id!} />}
          {tab === "checkins" && <CheckIns projectId={id!} projectTitle={project.title} />}
          {tab === "team" && <Team projectId={id!} project={project} members={members ?? []} isOwner={isOwner} />}
          {tab === "investors" && <Investors projectId={id!} isOwner={isOwner} />}
          {tab === "roadmap" && <Roadmap projectId={id!} />}
          {tab === "setup" && <Setup projectId={id!} project={project} isOwner={isOwner} />}
          {tab === "tools" && <WebTools projectId={id!} />}
        </View>
      </ScrollView>
    </NoticeProvider>
  );
}
