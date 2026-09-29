/**
 * A builder's profile, yours or someone else's — one view for both, the way
 * client/src/pages/profile.tsx is one page for both.
 *
 * The same anatomy as the website: the header card (cover, photo, name,
 * headline, location, actions), then the tabs — About and Projects for
 * everyone; Connections, Following, Earnings and Editor access for the owner;
 * Behaviour for the site owner. The About tab stacks the web's two columns in
 * the order the website's own narrow layout does.
 */
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fetchMe } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { markSeen } from "../explore";
import { colors, spacing } from "../theme";
import { Btn, Empty, Icon, ListItem, Loading, Row, Screen } from "./ui";
import { NoticeBanner, Sheet, useNotice } from "./Sheet";
import { Composer } from "./Composer";
import {
  AboutCard, Credentials, InterestsCard, LookingForCard, PostsSection, ProfileHeader, ProjectsSection,
  ReputationCard, ResumePanel, nameOf, type HeaderStat,
} from "./ProfileSections";
import { BackerCredits, BadgeShowcase, EarnedBadges } from "./ProfileBadges";
import {
  BehaviourTab, ConnectionButton, ConnectionsTab, EarningsTab, FollowBuilderButton, FollowingTab,
  useConnectionRequests, useFollowedProjects, useMyConnections,
} from "./ProfileNetwork";
import { EditorAccess } from "./profile/EditorAccess";
import { OutlineButton, ProfileTabs, type ProfileTab } from "./profile/kit";
import { pickAndUploadImage } from "./profilePhoto";
import { BlockAction } from "./BlockAction";

export type ProfileTabName = "about" | "projects" | "connections" | "following" | "earnings" | "editor" | "behaviour";

export function ProfileView({ userId: routeId, isOwn: ownRoute, onName, initialTab }: {
  /** Someone else's id; omitted for your own profile. */
  userId?: string;
  isOwn?: boolean;
  /** Tells a pushed screen the name for its title. */
  onName?: (name: string) => void;
  /** Open on a tab, e.g. `editor` — the web's `/profile#editor`. */
  initialTab?: ProfileTabName;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { user: authUser, signOut, refreshUser } = useAuth();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const myId: string | undefined = me?.user?.id ?? authUser?.id;
  const isOwn = !!ownRoute || (!!routeId && routeId === myId);
  const userId = isOwn ? myId : routeId;
  const { notice, show, clear } = useNotice();
  const [composerOpen, setComposerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [tab, setTab] = useState<ProfileTabName>(initialTab ?? "about");
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);

  useEffect(() => { if (routeId && !isOwn) markSeen("builder", routeId); }, [routeId, isOwn]);

  // Yours: the profile row. Theirs: user, profile and projects in one.
  const own = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<any>("/api/profile").catch((e) => { if (e?.status === 404 || e?.status === 401) return null; throw e; }),
    enabled: isOwn,
  });
  const ownProjects = useQuery({ queryKey: ["user-projects"], queryFn: () => api<any[]>("/api/user/projects"), enabled: isOwn });
  const other = useQuery({
    queryKey: ["user", routeId],
    queryFn: () => api<any>(`/api/users/${routeId}`).catch((e) => { if (e?.status === 404 || e?.status === 401) return null; throw e; }),
    enabled: !!routeId && !isOwn,
  });
  const summary = useQuery({ queryKey: ["profile-summary"], queryFn: () => api<any>("/api/profile/summary"), enabled: isOwn });
  const followStatus = useQuery({
    queryKey: ["user-follow", userId],
    queryFn: () => api<{ following: boolean; followers: number }>(`/api/users/${userId}/follow-status`).catch(() => ({ following: false, followers: 0 })),
    enabled: !!userId,
  });
  const myConnections = useMyConnections(isOwn);
  const requests = useConnectionRequests(isOwn);
  const followed = useFollowedProjects(isOwn);
  const access = useQuery({
    queryKey: ["analytics-access"],
    queryFn: () => api<{ owner: boolean }>("/api/admin/analytics/access").catch(() => ({ owner: false })),
    enabled: isOwn,
    retry: false,
  });

  const profile = isOwn ? own.data : other.data?.profile;
  const person = isOwn ? me?.user ?? authUser : other.data;
  const name = nameOf(profile, person);
  const firstName = (profile?.displayName || person?.firstName || "This builder").split(" ")[0];
  useEffect(() => { if (profile || person) onName?.(name); }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  const photo = useMutation({
    mutationFn: async (field: "avatarUrl" | "coverUrl") => {
      const path = await pickAndUploadImage();
      if (!path) return null;
      await api("/api/profile", { method: "POST", body: { [field]: path } });
      return field;
    },
    onSuccess: (field) => {
      if (!field) return;
      void qc.invalidateQueries({ queryKey: ["profile"] });
      void qc.invalidateQueries({ queryKey: ["profile-summary"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
      void refreshUser();
      show({ text: "Photo updated", tone: "success" });
    },
    onError: (e: any) => show({ text: e?.message || "Couldn't save that photo", tone: "error" }),
  });

  const refreshing = own.isRefetching || other.isRefetching;
  const onRefresh = () => {
    void qc.invalidateQueries({ queryKey: isOwn ? ["profile"] : ["user", routeId] });
    for (const key of [["profile-summary"], ["user-projects"], ["user-follow", userId], ["feed", "author", userId], ["reputation", userId],
      ["user-badges-backer", userId], ["user-badges", userId], ["user-backings", userId], ["connections"], ["connection-status", userId],
      ["followed-projects"], ["payouts"], ["mcp-tokens"]]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };

  if (!userId || (isOwn ? own.isLoading : other.isLoading)) return <Loading />;

  if (!isOwn && !other.data?.profile) {
    return (
      <Screen canvas>
        <Empty icon="person-outline" title="User profile not found" action="Go Home" onAction={() => router.replace("/(tabs)/feed")} />
      </Screen>
    );
  }

  if (isOwn && !profile) {
    return (
      <Screen canvas>
        <Empty icon="person-circle-outline" title="Welcome to SparkTower!" body="Complete your profile to get started and connect with other creators."
          action="Complete Your Profile" onAction={() => router.push("/profile/edit")} />
        <Btn label="Sign out" variant="ghost" onPress={signOut} />
      </Screen>
    );
  }

  const projects: any[] = isOwn ? (ownProjects.data ?? []) : (other.data?.projects ?? []);
  const connectionCount = myConnections.data?.length ?? summary.data?.stats?.connections;
  const requestCount = requests.data?.length ?? 0;
  const hasCredentials = (profile?.experience?.length ?? 0) > 0 || (profile?.education?.length ?? 0) > 0;
  const avatarUri = profile?.avatarUrl ?? person?.profileImageUrl;

  const stats: HeaderStat[] = isOwn
    ? [
      { value: connectionCount ?? 0, label: connectionCount === 1 ? "connection" : "connections", onPress: () => setTab("connections") },
      { value: followStatus.data?.followers ?? 0, label: followStatus.data?.followers === 1 ? "follower" : "followers" },
      { value: summary.data?.stats?.projectViews ?? 0, label: "project views", onPress: () => setTab("projects") },
    ]
    : [
      { value: followStatus.data?.followers ?? 0, label: followStatus.data?.followers === 1 ? "follower" : "followers" },
      { value: projects.length, label: projects.length === 1 ? "project" : "projects", onPress: () => setTab("projects") },
    ];

  const actions = isOwn ? (
    <Row gap={spacing.sm} center>
      <OutlineButton label="Edit Profile" icon="create-outline" style={{ flex: 1 }} onPress={() => router.push("/profile/edit")} />
      <Pressable onPress={() => setMoreOpen(true)} accessibilityLabel="More" style={({ pressed }) => [circleBtn, pressed && { opacity: 0.6 }]}>
        <Icon name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
      </Pressable>
    </Row>
  ) : (
    <Row gap={spacing.sm} center wrap>
      <FollowBuilderButton userId={routeId!} name={profile?.displayName || person?.firstName || "them"} notify={show} />
      <ConnectionButton userId={routeId!} name={firstName} notify={show} />
      {/*
        * Block, beside Connect. The profile is where somebody goes to work out
        * who is contacting them, so it's where the decision to stop it gets
        * made — and it's the only place an existing block can be lifted from
        * the phone, which is why the button becomes "Unblock" rather than
        * disappearing.
        */}
      <BlockAction
        userId={routeId!}
        name={profile?.displayName || person?.firstName || null}
        onBlocked={() => router.back()}
      />
    </Row>
  );

  const tabs: ProfileTab<ProfileTabName>[] = [
    { value: "about", label: "About" },
    { value: "projects", label: "Projects", count: projects.length },
    ...(isOwn ? [
      { value: "connections" as const, label: "Connections", count: myConnections.data?.length, alert: requestCount },
      { value: "following" as const, label: "Following", count: followed.data?.length },
      { value: "earnings" as const, label: "Earnings" },
      { value: "editor" as const, label: "Editor access" },
      ...(access.data?.owner ? [{ value: "behaviour" as const, label: "Behaviour" }] : []),
    ] : []),
  ];

  return (
    <>
      <Screen canvas onRefresh={onRefresh} refreshing={refreshing} /* No paddingTop: Screen leaves room for the floating header, and sixteen points of it is not enough. */
        contentStyle={{ paddingHorizontal: 0, gap: spacing.md, paddingBottom: spacing.xxl * 3 }}>
        <ProfileHeader
          userId={userId}
          profile={profile}
          user={person}
          stats={stats}
          actions={actions}
          onEditCover={isOwn ? () => photo.mutate("coverUrl") : undefined}
          onEditAvatar={isOwn ? () => photo.mutate("avatarUrl") : undefined}
        />

        <ProfileTabs tabs={tabs} value={tab} onChange={setTab} />

        {tab === "about" && (
          <>
            {/* The public ask sits at the top — the most actionable thing on the page for whoever is reading it. */}
            <LookingForCard lookingFor={profile?.lookingFor ?? null} isOwn={isOwn} />
            {isOwn && <ResumePanel hasContent={hasCredentials} />}
            <AboutCard profile={profile} isOwn={isOwn} />
            <Credentials profile={profile} />
            <InterestsCard interests={profile?.interests} />
            <EarnedBadges userId={userId} isOwn={isOwn} />
            <BadgeShowcase userId={userId} isOwn={isOwn} notify={show} />
            <BackerCredits userId={userId} isOwn={isOwn} notify={show} />
            {/* Then the main column: posts, what they're building, and the Builder Index. */}
            <PostsSection userId={userId} isOwn={isOwn} firstName={firstName} avatarUri={avatarUri} myName={name}
              onCompose={isOwn ? () => setComposerOpen(true) : undefined} notify={show} />
            <ProjectsSection projects={projects} isOwn={isOwn} loading={isOwn && ownProjects.isLoading} ownerName={name} ownerAvatar={avatarUri} />
            <ReputationCard userId={userId} isOwn={isOwn} notify={show} />
          </>
        )}

        {tab === "projects" && (
          <ProjectsSection full projects={projects} isOwn={isOwn} loading={isOwn && ownProjects.isLoading} ownerName={name} ownerAvatar={avatarUri} />
        )}
        {isOwn && tab === "connections" && <ConnectionsTab notify={show} />}
        {isOwn && tab === "following" && <FollowingTab />}
        {isOwn && tab === "earnings" && <EarningsTab notify={show} />}
        {isOwn && tab === "editor" && <EditorAccess notify={show} />}
        {isOwn && tab === "behaviour" && access.data?.owner && <BehaviourTab />}
      </Screen>

      {isOwn && (
        <Composer
          visible={composerOpen}
          onClose={() => setComposerOpen(false)}
          onPosted={() => {
            setComposerOpen(false);
            void qc.invalidateQueries({ queryKey: ["feed"] });
            show({ text: "Posted.", tone: "success" });
          }}
        />
      )}

      {isOwn && (
        <Sheet visible={moreOpen} onClose={() => setMoreOpen(false)} title="Profile">
          <View style={{ marginHorizontal: -spacing.lg }}>
            <ListItem icon="hand-left-outline" title={profile?.lookingFor ? "Edit what you're looking for" : "Add what you're looking for"} onPress={() => { setMoreOpen(false); router.push("/profile/looking-for"); }} />
            <ListItem icon="sparkles-outline" title="Build with résumé" onPress={() => { setMoreOpen(false); router.push("/profile-builder"); }} />
            <ListItem icon="person-circle-outline" title="Change profile photo" onPress={() => { setMoreOpen(false); photo.mutate("avatarUrl"); }} />
            <ListItem icon="image-outline" title="Change cover photo" onPress={() => { setMoreOpen(false); photo.mutate("coverUrl"); }} />
            <ListItem icon="rocket-outline" title="New project" onPress={() => { setMoreOpen(false); router.push("/project/new"); }} />
            <ListItem icon="log-out-outline" title="Sign out" danger onPress={() => { setMoreOpen(false); void signOut(); }} right={<View />} />
          </View>
        </Sheet>
      )}

      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}

const circleBtn = {
  width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  alignItems: "center" as const, justifyContent: "center" as const,
};
