/**
 * A builder's profile, yours or someone else's — one view for both, the way
 * client/src/pages/profile.tsx is one page for both.
 *
 * Laid out like a professional network's profile on a phone: the cover and
 * photo, name and headline, follower and connection counts, the actions,
 * then full-width sections on the gray canvas. What only the owner should see
 * (analytics, invitations, earnings, the résumé prompt) is drawn only for them.
 */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fetchMe } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { markSeen } from "../explore";
import { exploreContext } from "../explore";
import { useEntitlementsQuery } from "../hooks/useEntitlements";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Btn, Cost, Empty, Icon, ListItem, Loading, Meta, NovaGradient, Row, Screen, Section } from "./ui";
import { NoticeBanner, Sheet, useNotice } from "./Sheet";
import { ConnectActions, useConnectionStates } from "./ConnectActions";
import { Composer } from "./Composer";
import {
  AboutBlock, ActivityBlock, EducationBlock, ExperienceBlock, LookingForBlock, PortfolioBlock,
  ProfileHeader, ProjectsBlock, ReputationBlock, SkillsBlock, nameOf,
} from "./ProfileSections";
import { BackerCredits, BadgeShowcase, EarnedBadges } from "./ProfileBadges";
import { ProfileAnalytics, YourNetwork } from "./ProfileNetwork";
import { pickAndUploadImage } from "./profilePhoto";

export function ProfileView({ userId: routeId, isOwn: ownRoute, onName }: {
  /** Someone else's id; omitted for your own profile. */
  userId?: string;
  isOwn?: boolean;
  /** Tells a pushed screen the name for its title. */
  onName?: (name: string) => void;
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

  useEffect(() => { if (routeId && !isOwn) markSeen("builder", routeId); }, [routeId, isOwn]);

  // Yours: the profile row and its summary. Theirs: user, profile and projects in one.
  const own = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<any>("/api/profile").catch((e) => { if (e?.status === 404) return null; throw e; }),
    enabled: isOwn,
  });
  const summary = useQuery({ queryKey: ["profile-summary"], queryFn: () => api<any>("/api/profile/summary"), enabled: isOwn });
  const ownProjects = useQuery({ queryKey: ["user-projects"], queryFn: () => api<any[]>("/api/user/projects"), enabled: isOwn });
  const other = useQuery({
    queryKey: ["user", routeId],
    queryFn: () => api<any>(`/api/users/${routeId}`).catch((e) => { if (e?.status === 404) return null; throw e; }),
    enabled: !!routeId && !isOwn,
  });

  const followKey = ["user-follow", userId];
  const followStatus = useQuery({
    queryKey: followKey,
    queryFn: () => api<{ following: boolean; followers: number }>(`/api/users/${userId}/follow-status`),
    enabled: !!userId,
  });
  const { data: states } = useConnectionStates(!isOwn && routeId ? [routeId] : []);
  const ent = useEntitlementsQuery();

  const profile = isOwn ? own.data : other.data?.profile;
  const person = isOwn ? me?.user ?? authUser : other.data;
  const name = nameOf(profile, person);
  const firstName = name.split(" ")[0];
  useEffect(() => { if (profile || person) onName?.(name); }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  const follow = useMutation({
    mutationFn: (want: boolean) => api<{ following: boolean; followers: number }>(`/api/users/${userId}/follow`, {
      method: "POST", body: { following: want, explore: exploreContext("profile_page") },
    }),
    onMutate: async (want) => {
      await qc.cancelQueries({ queryKey: followKey });
      const before = qc.getQueryData<{ following: boolean; followers: number }>(followKey);
      qc.setQueryData(followKey, { following: want, followers: Math.max(0, (before?.followers ?? 0) + (want ? 1 : -1)) });
      return { before };
    },
    onError: (e: any, _want, ctx) => {
      qc.setQueryData(followKey, ctx?.before);
      show({ text: e?.message || "Couldn't update that.", tone: "error" });
    },
    onSuccess: (result, want) => {
      qc.setQueryData(followKey, result);
      if (want) markSeen("builder", userId!);
      show({ text: want ? `Following ${firstName}. Their posts will show up in your feed.` : `Unfollowed ${firstName}.`, tone: want ? "success" : "info" });
    },
  });

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
      void qc.invalidateQueries({ queryKey: ["me"] });
      void refreshUser();
      show({ text: field === "avatarUrl" ? "Profile photo updated." : "Cover photo updated.", tone: "success" });
    },
    onError: (e: any) => show({ text: e?.message || "Couldn't save that photo.", tone: "error" }),
  });

  const refreshing = own.isRefetching || other.isRefetching;
  const onRefresh = () => {
    void qc.invalidateQueries({ queryKey: isOwn ? ["profile"] : ["user", routeId] });
    void qc.invalidateQueries({ queryKey: ["profile-summary"] });
    void qc.invalidateQueries({ queryKey: ["user-projects"] });
    void qc.invalidateQueries({ queryKey: followKey });
    void qc.invalidateQueries({ queryKey: ["feed", "author", userId] });
    void qc.invalidateQueries({ queryKey: ["reputation", userId] });
    void qc.invalidateQueries({ queryKey: ["user-badges-backer", userId] });
    void qc.invalidateQueries({ queryKey: ["connections"] });
  };

  if (!userId || (isOwn ? own.isLoading : other.isLoading)) return <Loading />;

  if (!isOwn && !other.data) {
    return <Screen canvas><Empty icon="person-outline" title="Profile not found" body="This builder may have left SparkTower." action="Go home" onAction={() => router.replace("/(tabs)/feed")} /></Screen>;
  }

  if (isOwn && !profile) {
    return (
      <Screen canvas>
        <Empty icon="person-circle-outline" title="Welcome to SparkTower" body="Set up your profile so other builders can find you and connect." action="Set up your profile" onAction={() => router.push("/profile/edit")} />
        <Btn label="Sign out" variant="ghost" onPress={signOut} />
      </Screen>
    );
  }

  const projects: any[] = isOwn ? (ownProjects.data ?? []) : (other.data?.projects ?? []);
  const connectionCount: number | undefined = isOwn ? summary.data?.stats?.connections : undefined;
  const hasCredentials = (profile?.experience?.length ?? 0) > 0 || (profile?.education?.length ?? 0) > 0;
  const resumeCost: number = ent.creditCosts?.resumeEvaluation ?? 4;
  const cantAfford = !ent.isLoading && !ent.isUnlimited && ent.creditsRemaining < resumeCost;
  const following = !!followStatus.data?.following;

  const actions = isOwn ? (
    <Row gap={spacing.sm} center>
      <Btn label="Edit profile" icon="pencil" small style={{ flex: 1 }} onPress={() => router.push("/profile/edit")} />
      <Btn label="Build with résumé" icon="sparkles" variant="outline" small style={{ flex: 1.25 }} onPress={() => router.push("/profile-builder")} />
      <Pressable onPress={() => setMoreOpen(true)} accessibilityLabel="More" style={({ pressed }) => [circleBtn, pressed && { opacity: 0.6 }]}>
        <Icon name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
      </Pressable>
    </Row>
  ) : (
    <Row gap={spacing.sm} center wrap>
      <Btn
        label={following ? "Following" : "Follow"}
        icon={following ? "checkmark" : "add"}
        small
        variant={following ? "outline" : "primary"}
        onPress={() => follow.mutate(!following)}
      />
      <ConnectActions userId={routeId!} name={name} headline={profile?.headline} connection={states?.[routeId!]} notify={show} explore={{ source: "profile_page" }} />
    </Row>
  );

  return (
    <>
      <Screen canvas onRefresh={onRefresh} refreshing={refreshing} contentStyle={{ padding: 0, gap: spacing.sm, paddingBottom: spacing.xxl * 2 }}>
        <ProfileHeader
          userId={userId}
          profile={profile}
          user={person}
          followers={followStatus.data?.followers}
          connections={connectionCount}
          actions={actions}
          onEditCover={isOwn ? () => photo.mutate("coverUrl") : undefined}
          onEditAvatar={isOwn ? () => photo.mutate("avatarUrl") : undefined}
        />

        {isOwn && <ProfileAnalytics stats={summary.data?.stats} />}

        <LookingForBlock lookingFor={profile?.lookingFor} isOwn={isOwn} />

        {isOwn && !hasCredentials && (
          <Section>
            <Row gap={spacing.md}>
              <NovaGradient style={{ width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" }}>
                <Icon name="color-wand" size={20} color="#FFFFFF" />
              </NovaGradient>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: font.base, fontFamily: fontFamily.semibold, color: colors.text }}>
                  Let Nova build your profile
                </Text>
                <Meta style={{ fontSize: font.sm, lineHeight: 18 }}>Upload your résumé and Nova fills in your experience, education, projects and skills. You review it before anything is saved.</Meta>
              </View>
            </Row>
            <Row center gap={spacing.sm}>
              <Btn label="Build my profile" icon="sparkles" small disabled={cantAfford} onPress={() => router.push("/profile-builder")} />
              <Cost credits={resumeCost} />
              {cantAfford && <Meta style={{ color: colors.danger, flex: 1 }}>Needs {resumeCost} credits, you have {ent.creditsRemaining}.</Meta>}
            </Row>
          </Section>
        )}

        <AboutBlock profile={profile} isOwn={isOwn} />
        <ActivityBlock userId={userId} isOwn={isOwn} firstName={firstName} onCompose={isOwn ? () => setComposerOpen(true) : undefined} notify={show} />
        <ProjectsBlock projects={projects} isOwn={isOwn} firstName={firstName} />
        <ExperienceBlock experience={profile?.experience} />
        <EducationBlock education={profile?.education} />
        <PortfolioBlock portfolio={profile?.portfolioProjects} />
        <SkillsBlock title="Skills" skills={profile?.skills} isOwn={isOwn} />
        <SkillsBlock title="Interests" skills={profile?.interests} isOwn={isOwn} />
        {profile?.resumeParsedAt ? (
          <Meta style={{ paddingHorizontal: spacing.lg, paddingVertical: 2 }}>Experience and skills built from résumé {new Date(profile.resumeParsedAt).toLocaleDateString()}</Meta>
        ) : null}
        <BadgeShowcase userId={userId} isOwn={isOwn} notify={show} />
        <EarnedBadges userId={userId} />
        <BackerCredits userId={userId} isOwn={isOwn} notify={show} />
        <ReputationBlock userId={userId} isOwn={isOwn} notify={show} />

        {isOwn && (
          <YourNetwork notify={show} connectionCount={connectionCount} followingCount={summary.data?.stats?.following} />
        )}

        {isOwn && (
          <View style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border }}>
            <ListItem icon="log-out-outline" title="Sign out" danger onPress={signOut} right={<View />} />
          </View>
        )}
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
            <ListItem icon="create-outline" title="Create a post" onPress={() => { setMoreOpen(false); setComposerOpen(true); }} />
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
  width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: colors.textTertiary,
  alignItems: "center" as const, justifyContent: "center" as const,
};
