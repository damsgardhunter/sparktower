import { useEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { exploreContext, markSeen } from "../../src/explore";
import { colors, spacing } from "../../src/theme";
import { Body, Btn, Empty, H1, Icon, Loading, Meta, errText } from "../../src/components/ui";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { ProjectHeader } from "../../src/components/ProjectHeader";
import { InvestCard } from "../../src/components/InvestSheet";
import { BackingCard } from "../../src/components/BackingSheet";
import { ApplySheet, PendingApplications, QuestionsSheet, type AppQuestion } from "../../src/components/ProjectApplications";
import {
  DiscussionTab, FollowersTab, LinksBlock, MediaTab, MilestonesTab, OverviewTab, PROJECT_TABS, QuestionsBlock, RailVisuals,
  RoadmapTab, RolesTab, StatsBlock, StoryboardsBlock, TeamMembersBlock, TeamTab, TechStackBlock, UpdatesTab,
  memberName, unfilledRoles, useProjectMilestones, useProjectUpdates, type ProjectTab,
} from "../../src/components/ProjectPageTabs";
import { useNewFeedbackCount } from "../../src/components/project/FeedbackInbox";
import { ScrollingTabs } from "../../src/components/project/ScrollingTabs";

/**
 * A project's public page — the native counterpart of
 * client/src/pages/project-dashboard.tsx. The web's two columns stack: the
 * header, the social tabs, then (on Overview) what the web keeps under the
 * tabs and in its right rail — storyboards, tech stack, links, applications,
 * Invest, Back this project, stats, team members and application questions.
 */
export default function ProjectDetail() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: ProjectTab }>();
  // Opening it is looking at it: what it posts next is news for you on Discover.
  useEffect(() => { if (id) markSeen("project", id); }, [id]);
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { notice, show: notify, clear } = useNotice();
  const [tab, setTab] = useState<ProjectTab>(PROJECT_TABS.some((t) => t.value === initialTab) ? initialTab! : "overview");
  const [applyOpen, setApplyOpen] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const contentY = useRef(0);
  const backingY = useRef<number | null>(null);

  const { data: project, isLoading, isError } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<any>(`/api/projects/${id}`),
    enabled: !!id,
  });
  const restricted = !!project?.restricted;
  const isOwner = !!project && !!user && project.ownerId === user.id;

  const { data: members = [] } = useQuery({
    queryKey: ["project", id, "members"],
    queryFn: () => api<any[]>(`/api/projects/${id}/members`),
    enabled: !!id && !restricted,
  });
  const { data: counts } = useQuery({
    queryKey: ["project", id, "comment-counts"],
    queryFn: () => api<Record<string, number>>(`/api/projects/${id}/comment-counts`),
    enabled: !!id && !restricted,
  });
  const followKey = ["project", id, "follow-status"];
  const { data: follow } = useQuery({
    queryKey: followKey,
    queryFn: () => api<{ following: boolean; count: number }>(`/api/projects/${id}/follow-status`).catch(() => ({ following: false, count: 0 })),
    enabled: !!id && !restricted,
  });
  const { data: myApplications } = useQuery({
    queryKey: ["user-applications"],
    queryFn: () => api<any[]>("/api/user/applications"),
    enabled: !!user && !restricted && !isOwner,
  });
  const { data: applications } = useQuery({
    queryKey: ["project", id, "applications"],
    queryFn: () => api<any[]>(`/api/projects/${id}/applications`),
    enabled: isOwner,
  });
  const { data: updates } = useProjectUpdates(id!);
  const { data: milestones } = useProjectMilestones(id!);
  const { data: campaign } = useQuery({
    queryKey: ["project", id, "backing", "public"],
    queryFn: () => api<any>(`/api/projects/${id}/backing/public`),
    enabled: !!id && !restricted,
    retry: false,
  });
  const newFeedback = useNewFeedbackCount(id!, !!user && !restricted && !!project && (project.ownerId === user.id || members.some((m) => m.userId === user.id)));

  /*
   * Follow says what it wants rather than toggling, so a double tap can't undo
   * itself; it changes at once and goes back if the server refuses.
   */
  const toggleFollow = useMutation({
    mutationFn: (want: boolean) =>
      api(`/api/projects/${id}/follow`, { method: "POST", body: { following: want, explore: exploreContext("project_page") } }),
    onMutate: async (want) => {
      await qc.cancelQueries({ queryKey: followKey });
      const before = qc.getQueryData<{ following: boolean; count: number }>(followKey);
      qc.setQueryData(followKey, { following: want, count: Math.max(0, (before?.count ?? 0) + (want ? 1 : -1)) });
      return { before };
    },
    onError: (e, _want, ctx) => {
      qc.setQueryData(followKey, ctx?.before);
      notify({ text: errText(e, "Couldn't update. Try again in a moment."), tone: "error" });
    },
    onSuccess: (_r, want) => notify(want
      ? { text: "Following. Its updates now show in your feed.", tone: "success", action: { label: "Open feed", onPress: () => router.push("/(tabs)/feed" as any) } }
      : { text: "Unfollowed.", tone: "info" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: followKey });
      void qc.invalidateQueries({ queryKey: ["followed-projects"] });
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ["project", id] });
    await qc.invalidateQueries({ queryKey: ["feed", "project", id] });
    setRefreshing(false);
  };

  if (isLoading) return <><Stack.Screen options={{ title: "" }} /><Loading /></>;
  if (!project || isError) {
    return (
      <>
        <Stack.Screen options={{ title: "Project" }} />
        <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center" }}>
          <Empty icon="alert-circle-outline" title="Project not found" body="It may have been removed." action="Go back" onAction={() => router.back()} />
        </View>
      </>
    );
  }

  // A private project the viewer can't access returns only the title.
  if (restricted) {
    return (
      <>
        <Stack.Screen options={{ title: "Private project" }} />
        <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md }}>
          <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" }}>
            <Icon name="lock-closed" size={28} color={colors.textSecondary} />
          </View>
          <H1 style={{ textAlign: "center" }}>{project.title}</H1>
          <Body muted style={{ textAlign: "center", fontSize: 16 }}>This is a private project.</Body>
          <Meta style={{ textAlign: "center", maxWidth: 280, fontSize: 13 }}>
            Only the owner and their team can view it. If you should have access, ask them to add you.
          </Meta>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
            <Btn label="Go back" icon="arrow-back" variant="outline" small onPress={() => router.back()} />
            <Btn label="Discover projects" icon="compass-outline" small onPress={() => router.replace("/(tabs)/discover" as any)} />
          </View>
        </View>
      </>
    );
  }

  const isMember = isOwner || members.some((m) => m.userId === user?.id);
  const role = isOwner ? "owner" : isMember ? "member" : "visitor";
  const applied = !!myApplications?.some((a) => a.projectId === id && a.status === "pending");
  const ownerRow = members.find((m) => m.userId === project.ownerId);
  const owner = ownerRow ? { userId: ownerRow.userId, name: memberName(ownerRow), avatarUrl: ownerRow.profile?.avatarUrl } : null;
  const questions = (project.applicationQuestions || []) as AppQuestion[];
  const manage = () => router.push(`/manage/${id}` as any);
  const apply = () => (applied ? notify({ text: "You've already applied. The owner will review it.", tone: "info" }) : setApplyOpen(true));

  const tabLabel = (t: { value: ProjectTab; label: string }) => {
    const n = t.value === "team" ? members.length
      : t.value === "roles" ? unfilledRoles(project, members).length
      : t.value === "media" ? project.mediaUrls?.length || 0
      : t.value === "followers" ? follow?.count || 0
      : t.value === "discussion" ? Object.values(counts || {}).reduce((a, b) => a + b, 0)
      : t.value === "updates" ? updates?.posts?.length || 0
      : t.value === "milestones" ? milestones?.length || 0
      : 0;
    return { value: t.value, label: `${t.label}${n > 0 ? ` ${n}` : ""}`, badge: t.value === "updates" && newFeedback > 0 ? `${newFeedback} new feedback` : null };
  };

  const jumpToBacking = () => {
    const go = () => { if (backingY.current != null) scrollRef.current?.scrollTo({ y: contentY.current + backingY.current - 56, animated: true }); };
    if (tab !== "overview") { setTab("overview"); setTimeout(go, 400); } else go();
  };

  return (
    <>
      <Stack.Screen options={{ title: project.title }} />
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScrollView
          ref={scrollRef}
          stickyHeaderIndices={[1]}
          contentContainerStyle={{ paddingBottom: spacing.xxl * 3 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          keyboardShouldPersistTaps="handled"
        >
          <ProjectHeader
            project={project}
            owner={owner}
            followerCount={follow?.count ?? 0}
            following={!!follow?.following}
            onFollow={() => toggleFollow.mutate(!follow?.following)}
            role={role}
            applied={applied}
            onApply={apply}
            onManage={manage}
            onOwner={() => owner && router.push(`/user/${owner.userId}` as any)}
            onBack={campaign ? jumpToBacking : undefined}
          />
          <ScrollingTabs options={PROJECT_TABS.map(tabLabel)} value={tab} onChange={setTab} />
          <View style={{ paddingTop: spacing.sm, gap: spacing.sm }} onLayout={(e) => { contentY.current = e.nativeEvent.layout.y; }}>
            {tab === "overview" && (
              <>
                <OverviewTab project={project} members={members} isOwner={isOwner} isMember={isMember}
                  onApply={apply} onManage={manage} onTab={setTab} notify={notify} />
                {isOwner && <StoryboardsBlock projectId={id!} onOpen={() => router.push(`/project/storyboards?id=${id}` as any)} />}
                <TechStackBlock project={project} />
                <LinksBlock project={project} />
                {isOwner && (
                  <PendingApplications projectId={id!} applications={applications || []} questions={questions}
                    onEditQuestions={() => setQuestionsOpen(true)} notify={notify} />
                )}
                <InvestCard projectId={id!} notify={notify} />
                <View onLayout={(e) => { backingY.current = e.nativeEvent.layout.y; }}>
                  <BackingCard projectId={id!} projectTitle={project.title} isOwner={isOwner} notify={notify} />
                </View>
                <StatsBlock project={project} members={members} followerCount={follow?.count ?? 0} />
                <TeamMembersBlock project={project} members={members} />
                {isOwner && <QuestionsBlock questions={questions} onEdit={() => setQuestionsOpen(true)} />}
                <RailVisuals project={project} />
              </>
            )}
            {tab === "updates" && <UpdatesTab projectId={id!} isMember={isMember} notify={notify} />}
            {tab === "roadmap" && <RoadmapTab projectId={id!} isOwner={isOwner} onManage={manage} counts={counts} />}
            {tab === "milestones" && <MilestonesTab projectId={id!} counts={counts} />}
            {tab === "team" && <TeamTab members={members} />}
            {tab === "roles" && <RolesTab project={project} members={members} isOwner={isOwner} isMember={isMember} onApply={apply} />}
            {tab === "media" && <MediaTab projectId={id!} mediaUrls={project.mediaUrls || []} isOwner={isOwner} notify={notify} />}
            {tab === "discussion" && <DiscussionTab projectId={id!} />}
            {tab === "followers" && <FollowersTab projectId={id!} />}
          </View>
        </ScrollView>
        <NoticeBanner notice={notice} onDismiss={clear} />
      </View>

      <ApplySheet visible={applyOpen} onClose={() => setApplyOpen(false)} project={project} notify={notify} />
      {isOwner && (
        <QuestionsSheet visible={questionsOpen} onClose={() => setQuestionsOpen(false)} projectId={id!} initial={questions} notify={notify} />
      )}
    </>
  );
}
