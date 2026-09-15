/**
 * The blocks a profile is made of, LinkedIn-style: the header card, the open
 * ask, About, résumé credentials, projects, activity and the Builder Index.
 *
 * Mirrors client/src/pages/profile.tsx and its components
 * (profile-credentials, looking-for-card, reputation-card, profile-feed) on
 * the same endpoints, laid out as full-width white sections on the gray canvas.
 */
import { useState, type ReactNode } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors, font, fontFamily, postTypeColors, radius, spacing } from "../theme";
import {
  assetUri, Avatar, Body, Btn, Chip, Divider, Icon, Meta, NovaGradient, Progress, Row, Section,
  plain, timeAgo, type IconName,
} from "./ui";
import type { Notice } from "./Sheet";
import { PinnedBadgesRow } from "./ProfileBadges";

export const nameOf = (profile: any, user?: any) =>
  profile?.displayName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || profile?.headline || "Builder";

// --- Header ----------------------------------------------------------------

export function ProfileHeader({
  userId, profile, user, followers, connections, actions, onEditCover, onEditAvatar,
}: {
  userId: string;
  profile: any;
  user?: any;
  followers?: number;
  connections?: number;
  actions: ReactNode;
  onEditCover?: () => void;
  onEditAvatar?: () => void;
}) {
  const name = nameOf(profile, user);
  const cover = assetUri(profile?.coverUrl);
  const counts = [
    followers != null ? `${followers} follower${followers === 1 ? "" : "s"}` : null,
    connections != null ? `${connections} connection${connections === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border }}>
      <View style={{ height: 112 }}>
        {cover
          ? <Image source={{ uri: cover }} style={{ width: "100%", height: 112 }} resizeMode="cover" />
          : <NovaGradient style={{ height: 112, opacity: 0.55 }} />}
        {onEditCover && (
          <Pressable onPress={onEditCover} accessibilityLabel="Change cover photo" hitSlop={8}
            style={{ position: "absolute", top: spacing.md, right: spacing.md, width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
            <Icon name="camera-outline" size={18} color={colors.text} />
          </Pressable>
        )}
      </View>
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
        <Pressable onPress={onEditAvatar} disabled={!onEditAvatar} style={{ marginTop: -52, alignSelf: "flex-start" }} accessibilityLabel="Change profile photo">
          <Avatar name={name} uri={profile?.avatarUrl ?? user?.profileImageUrl} size={104} ring />
          {onEditAvatar && (
            <View style={{ position: "absolute", right: 2, bottom: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
              <Icon name="add" size={18} color="#FFFFFF" />
            </View>
          )}
        </Pressable>

        <View style={{ marginTop: spacing.sm, gap: 3 }}>
          <Row center gap={spacing.sm} wrap>
            <Text style={{ fontSize: font.xl, fontFamily: fontFamily.bold, color: colors.text, letterSpacing: -0.3, flexShrink: 1 }}>{name}</Text>
            {profile?.experienceLevel && (
              <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 }}>
                <Text style={{ fontSize: font.xs, fontFamily: fontFamily.medium, color: colors.textSecondary, textTransform: "capitalize" }}>{profile.experienceLevel}</Text>
              </View>
            )}
          </Row>
          {profile?.username ? <Meta style={{ fontSize: font.sm }}>@{profile.username}</Meta> : null}
          {profile?.headline && profile?.displayName ? (
            <Text style={{ fontSize: font.base, lineHeight: 21, fontFamily: fontFamily.regular, color: colors.text }}>{profile.headline}</Text>
          ) : null}
          {profile?.location ? (
            <Text style={{ fontSize: font.sm, fontFamily: fontFamily.regular, color: colors.textTertiary }}>{profile.location}</Text>
          ) : null}
          {counts ? <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.primary, marginTop: 2 }}>{counts}</Text> : null}
          <View style={{ marginTop: 6 }}><PinnedBadgesRow userId={userId} /></View>
        </View>

        <View style={{ marginTop: spacing.md }}>{actions}</View>
      </View>
    </View>
  );
}

// --- Looking for -----------------------------------------------------------

export function LookingForBlock({ lookingFor, isOwn }: { lookingFor: any; isOwn: boolean }) {
  const router = useRouter();
  const edit = () => router.push("/profile/looking-for");

  if (!lookingFor || (!lookingFor.isActive && !isOwn)) {
    if (!isOwn) return null;
    return (
      <Pressable onPress={edit} style={({ pressed }) => [{ backgroundColor: colors.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, padding: spacing.lg, flexDirection: "row", gap: spacing.md, alignItems: "center" }, pressed && { opacity: 0.7 }]}>
        <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
          <Icon name="add" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Body style={{ fontFamily: fontFamily.semibold }}>Looking for someone?</Body>
          <Meta style={{ fontSize: font.sm }}>Post what you need: a cofounder, a first engineer, a project to join.</Meta>
        </View>
        <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
      </Pressable>
    );
  }

  const facts: { icon: IconName; label: string; value: string }[] = [];
  if (lookingFor.commitment) facts.push({ icon: "time-outline", label: "Commitment", value: lookingFor.commitment });
  if (lookingFor.stage) facts.push({ icon: "layers-outline", label: "Stage", value: lookingFor.stage });
  if (lookingFor.equityAvailable === true || lookingFor.equityAvailable === false) {
    facts.push({ icon: "pie-chart-outline", label: "Equity", value: lookingFor.equityAvailable ? "Available" : "Not available" });
  }

  return (
    <View style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
      <View style={{ backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm }}>
        <Row between>
          <Row center gap={spacing.sm} style={{ flex: 1 }}>
            <Icon name="hand-left-outline" size={18} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.primary, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Looking for{isOwn && !lookingFor.isActive ? " · Hidden" : ""}
              </Text>
              <Text style={{ fontSize: font.base, fontFamily: fontFamily.bold, color: colors.text }}>{lookingFor.role}</Text>
            </View>
          </Row>
          {isOwn && (
            <Pressable onPress={edit} hitSlop={8} accessibilityLabel="Edit what you're looking for">
              <Icon name="pencil" size={18} color={colors.textSecondary} />
            </Pressable>
          )}
        </Row>
        {(lookingFor.industries?.length ?? 0) > 0 && (
          <Row wrap gap={6}>{lookingFor.industries.map((i: string) => <Chip key={i} label={i} small />)}</Row>
        )}
        {facts.length > 0 && (
          <Row wrap gap={spacing.lg}>
            {facts.map((f) => (
              <View key={f.label} style={{ gap: 1 }}>
                <Row center gap={4}>
                  <Icon name={f.icon} size={12} color={colors.textTertiary} />
                  <Meta>{f.label}</Meta>
                </Row>
                <Body>{f.value}</Body>
              </View>
            ))}
          </Row>
        )}
        {lookingFor.details ? <Body muted>{lookingFor.details}</Body> : null}
      </View>
    </View>
  );
}

// --- About -----------------------------------------------------------------

function LinkRow({ icon, label, url }: { icon: IconName; label: string; url: string }) {
  const href = /^https?:\/\//.test(url) || url.startsWith("/") ? url : `https://${url}`;
  return (
    <Pressable onPress={() => Linking.openURL(href.startsWith("/") ? assetUri(href)! : href).catch(() => {})} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.sm }, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={17} color={colors.textSecondary} />
      <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.primary, flexShrink: 1 }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function AboutBlock({ profile, isOwn }: { profile: any; isOwn: boolean }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const bio: string = profile?.bio || "";
  const links = [
    profile?.websiteUrl && { icon: "globe-outline" as IconName, label: "Website", url: profile.websiteUrl },
    profile?.githubUrl && { icon: "logo-github" as IconName, label: "GitHub", url: profile.githubUrl },
    profile?.linkedinUrl && { icon: "logo-linkedin" as IconName, label: "LinkedIn", url: profile.linkedinUrl },
    profile?.resumeUrl && { icon: "document-text-outline" as IconName, label: "Résumé", url: profile.resumeUrl },
  ].filter(Boolean) as { icon: IconName; label: string; url: string }[];

  if (!bio && !links.length && !profile?.novaSummary && !isOwn) return null;

  return (
    <Section title="About" action={isOwn ? "Edit" : undefined} onAction={() => router.push("/profile/edit")}>
      {bio ? (
        <Pressable onPress={() => setExpanded((v) => !v)} disabled={bio.length < 220}>
          <Body style={{ fontSize: font.base - 1, lineHeight: 21 }} numberOfLines={expanded ? undefined : 4}>{bio}</Body>
          {bio.length >= 220 && !expanded && <Text style={{ color: colors.textSecondary, fontFamily: fontFamily.semibold, fontSize: font.sm, marginTop: 2 }}>...see more</Text>}
        </Pressable>
      ) : isOwn ? (
        <Body muted>Tell people what you build and what you're looking for.</Body>
      ) : null}

      {profile?.novaSummary ? (
        <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: "#DCC4E8", backgroundColor: colors.primarySoft, padding: spacing.md, gap: 4 }}>
          <Row center gap={6}>
            <Icon name="sparkles" size={13} color={colors.primary} />
            <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.primary, textTransform: "uppercase", letterSpacing: 0.5 }}>Nova's read</Text>
          </Row>
          <Body>{profile.novaSummary}</Body>
        </View>
      ) : null}

      {links.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          {links.map((l) => <LinkRow key={l.label} {...l} />)}
        </View>
      )}
    </Section>
  );
}

// --- Résumé credentials ------------------------------------------------------

function TimelineItem({ icon, title, subtitle, meta, description, tags, last }: {
  icon: IconName; title: string; subtitle?: string | null; meta?: string | null; description?: string | null; tags?: string[]; last?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={22} color={colors.textSecondary} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ fontSize: font.base, fontFamily: fontFamily.semibold, color: colors.text }}>{title}</Text>
          {subtitle ? <Body>{subtitle}</Body> : null}
          {meta ? <Meta style={{ fontSize: font.sm }}>{meta}</Meta> : null}
          {description ? (
            <Pressable onPress={() => setOpen((v) => !v)} style={{ marginTop: 4 }}>
              <Body muted numberOfLines={open ? undefined : 3}>{description}</Body>
            </Pressable>
          ) : null}
          {tags && tags.length > 0 && (
            <Row wrap gap={4} style={{ marginTop: 6 }}>
              {tags.map((t) => <Chip key={t} label={t} small />)}
            </Row>
          )}
        </View>
      </View>
      {!last && <Divider style={{ marginLeft: 56 }} />}
    </>
  );
}

function Collapsible<T>({ items, limit, render, noun }: { items: T[]; limit: number; render: (item: T, i: number, last: boolean) => ReactNode; noun: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  return (
    <>
      {shown.map((item, i) => render(item, i, i === shown.length - 1))}
      {items.length > limit && (
        <>
          <Divider style={{ marginHorizontal: -spacing.lg }} />
          <Pressable onPress={() => setAll((v) => !v)} style={{ alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6, marginBottom: -spacing.xs }}>
            <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.textSecondary }}>
              {all ? "Show less" : `Show all ${items.length} ${noun}`}
            </Text>
            <Icon name={all ? "chevron-up" : "arrow-forward"} size={15} color={colors.textSecondary} />
          </Pressable>
        </>
      )}
    </>
  );
}

const dateRange = (start?: string | null, end?: string | null, current?: boolean) =>
  [start, current ? "Present" : end].filter(Boolean).join(" – ");

export function ExperienceBlock({ experience }: { experience?: any[] | null }) {
  const list = experience ?? [];
  if (!list.length) return null;
  return (
    <Section title="Experience">
      <Collapsible items={list} limit={3} noun="experiences" render={(e: any, i, last) => (
        <TimelineItem key={i} icon="briefcase-outline" title={e.title} subtitle={e.company}
          meta={[dateRange(e.startDate, e.endDate, e.current), e.location].filter(Boolean).join(" · ")}
          description={e.description} tags={e.skills} last={last} />
      )} />
    </Section>
  );
}

export function EducationBlock({ education }: { education?: any[] | null }) {
  const list = education ?? [];
  if (!list.length) return null;
  return (
    <Section title="Education">
      <Collapsible items={list} limit={3} noun="schools" render={(e: any, i, last) => (
        <TimelineItem key={i} icon="school-outline" title={e.school}
          subtitle={[e.degree, e.field].filter(Boolean).join(", ") || null}
          meta={[e.startYear, e.endYear].filter(Boolean).join(" – ") || null}
          description={e.description} last={last} />
      )} />
    </Section>
  );
}

export function PortfolioBlock({ portfolio }: { portfolio?: any[] | null }) {
  const list = portfolio ?? [];
  if (!list.length) return null;
  return (
    <Section title="Other work">
      <Collapsible items={list} limit={3} noun="projects" render={(p: any, i, last) => (
        <View key={i} style={{ gap: spacing.md }}>
          <TimelineItem icon="folder-open-outline" title={p.name} subtitle={p.role} description={p.description} tags={p.technologies} last />
          {p.url ? <View style={{ marginLeft: 56, marginTop: -spacing.sm }}><LinkRow icon="open-outline" label="Open" url={p.url} /></View> : null}
          {!last && <Divider style={{ marginLeft: 56 }} />}
        </View>
      )} />
    </Section>
  );
}

export function SkillsBlock({ title, skills, isOwn }: { title: string; skills?: string[] | null; isOwn?: boolean }) {
  const router = useRouter();
  const list = skills ?? [];
  if (!list.length) return null;
  return (
    <Section title={title} action={isOwn ? "Edit" : undefined} onAction={() => router.push("/profile/edit")}>
      <Row wrap gap={spacing.sm}>{list.map((s) => <Chip key={s} label={s} />)}</Row>
    </Section>
  );
}

// --- Projects ----------------------------------------------------------------

export function ProjectsBlock({ projects, isOwn, firstName }: { projects: any[]; isOwn: boolean; firstName: string }) {
  const router = useRouter();
  if (!projects.length && !isOwn) return null;
  return (
    <Section title={projects.length ? "Building" : "Projects"} action={isOwn ? "New project" : undefined} onAction={() => router.push("/project/new")}>
      {projects.length === 0 ? (
        <View style={{ alignItems: "flex-start", gap: spacing.sm }}>
          <Body muted>You're not building anything yet.</Body>
          <Btn label="Start your first project" icon="rocket-outline" variant="outline" small onPress={() => router.push("/project/new")} />
        </View>
      ) : (
        <Collapsible items={projects} limit={4} noun="projects" render={(p: any, i, last) => {
          const logo = assetUri(p.logoUrl);
          return (
            <View key={p.id} style={{ gap: spacing.md }}>
              <Pressable onPress={() => router.push(`/project/${p.id}`)} style={({ pressed }) => [{ flexDirection: "row", gap: spacing.md }, pressed && { opacity: 0.7 }]}>
                <View style={{ width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.primarySoft, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
                  {logo ? <Image source={{ uri: logo }} style={{ width: 48, height: 48 }} /> : <Icon name="rocket" size={22} color={colors.primary} />}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Row center gap={6}>
                    <Text style={{ fontSize: font.base, fontFamily: fontFamily.semibold, color: colors.text, flexShrink: 1 }} numberOfLines={1}>{p.title}</Text>
                    {p.isPrivate && <Icon name="lock-closed" size={12} color={colors.textTertiary} />}
                  </Row>
                  {(p.oneLiner || p.description) ? <Body muted numberOfLines={2}>{p.oneLiner || p.description}</Body> : null}
                  <Meta style={{ textTransform: "capitalize" }}>
                    {[p.stage?.replace(/_/g, " "), p.category, p.views != null ? `${p.views} views` : null].filter(Boolean).join(" · ")}
                  </Meta>
                </View>
              </Pressable>
              {!last && <Divider style={{ marginLeft: 60 }} />}
            </View>
          );
        }} />
      )}
      {!isOwn && projects.length === 0 && <Body muted>{firstName} has nothing public yet.</Body>}
    </Section>
  );
}

// --- Activity ----------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  project_update: "Project update", looking_for_help: "Looking for help", looking_for_cofounder: "Looking for cofounder",
  seeking_feedback: "Seeking feedback", milestone: "Milestone", idea_validation: "Idea validation", launch: "Launch", investor_update: "Investor update",
};

export function ActivityBlock({ userId, isOwn, firstName, onCompose, notify }: {
  userId: string; isOwn: boolean; firstName: string; onCompose?: () => void; notify: (n: Notice) => void;
}) {
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const key = ["feed", "author", userId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api<{ posts: any[] }>(`/api/feed?authorId=${encodeURIComponent(userId)}&limit=10`),
  });
  const react = useMutation({
    mutationFn: (postId: string) => api(`/api/feed/${postId}/react`, { method: "POST", body: { reaction: "like" } }),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: any) => notify({ text: e?.message || "Couldn't react.", tone: "error" }),
  });

  const posts = data?.posts ?? [];
  const shown = all ? posts : posts.slice(0, 2);

  return (
    <Section title="Activity" action={isOwn && onCompose ? "Create a post" : undefined} onAction={onCompose}>
      {isLoading ? <Meta>Loading posts…</Meta> : posts.length === 0 ? (
        <View style={{ gap: spacing.xs }}>
          <Body style={{ fontFamily: fontFamily.semibold }}>{isOwn ? "You haven't posted yet" : `${firstName} hasn't posted yet`}</Body>
          <Body muted>{isOwn ? "Share an update, ask for help, or announce a milestone." : "Posts they share will show up here."}</Body>
          {isOwn && onCompose && <Btn label="Start a post" icon="create-outline" variant="outline" small style={{ alignSelf: "flex-start", marginTop: spacing.xs }} onPress={onCompose} />}
        </View>
      ) : (
        <>
          <Meta style={{ marginTop: -spacing.sm, fontSize: font.sm, color: colors.primary, fontFamily: fontFamily.semibold }}>
            {posts.length}{posts.length >= 10 ? "+" : ""} post{posts.length === 1 ? "" : "s"}
          </Meta>
          {shown.map((post, i) => {
            const accent = postTypeColors[post.postType] || colors.info;
            const liked = !!post.viewerReaction;
            return (
              <View key={post.id} style={{ gap: spacing.sm }}>
                {i > 0 && <Divider style={{ marginHorizontal: -spacing.lg, marginBottom: spacing.xs }} />}
                <Row center gap={6} wrap>
                  <Meta style={{ fontSize: font.sm }}>{isOwn ? "You" : firstName} posted this · {timeAgo(post.createdAt)}</Meta>
                  <View style={{ borderWidth: 1, borderColor: accent, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 0 }}>
                    <Text style={{ fontSize: 10, fontFamily: fontFamily.semibold, color: accent }}>{TYPE_LABELS[post.postType] || post.postType}</Text>
                  </View>
                </Row>
                {post.project?.title ? (
                  <Row center gap={4}><Icon name="rocket-outline" size={13} color={colors.primary} /><Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.primary }}>{post.project.title}</Text></Row>
                ) : null}
                <Body style={{ fontSize: font.base - 1, lineHeight: 21 }} numberOfLines={all ? 8 : 4}>{plain(post.content || "")}</Body>
                {(post.mediaUrls?.length ?? 0) > 0 && assetUri(post.mediaUrls[0]) ? (
                  <Image source={{ uri: assetUri(post.mediaUrls[0])! }} style={{ width: "100%", height: 180, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised }} resizeMode="cover" />
                ) : null}
                <Row gap={spacing.lg} center>
                  <Pressable onPress={() => react.mutate(post.id)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Icon name={liked ? "thumbs-up" : "thumbs-up-outline"} size={17} color={liked ? colors.primary : colors.textSecondary} />
                    <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: liked ? colors.primary : colors.textSecondary }}>{post.reactionCount > 0 ? post.reactionCount : "Like"}</Text>
                  </Pressable>
                  <Row center gap={5}>
                    <Icon name="chatbubble-outline" size={16} color={colors.textSecondary} />
                    <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.textSecondary }}>{post.commentCount > 0 ? post.commentCount : "Comment"}</Text>
                  </Row>
                </Row>
              </View>
            );
          })}
          {posts.length > 2 && (
            <>
              <Divider style={{ marginHorizontal: -spacing.lg }} />
              <Pressable onPress={() => setAll((v) => !v)} style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginBottom: -spacing.xs }}>
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.textSecondary }}>{all ? "Show less" : "Show all posts"}</Text>
                <Icon name={all ? "chevron-up" : "arrow-forward"} size={15} color={colors.textSecondary} />
              </Pressable>
            </>
          )}
        </>
      )}
    </Section>
  );
}

// --- Builder Index -------------------------------------------------------------

const SCORES: { key: string; label: string; icon: IconName; color: string; hint: string }[] = [
  { key: "executionScore", label: "Execution", icon: "flash", color: "#F59E0B", hint: "Milestones completed, deadlines met, sprint consistency" },
  { key: "contributionScore", label: "Contribution", icon: "people", color: "#3B82F6", hint: "Projects involved in, tasks completed, solo builds" },
  { key: "marketSignalScore", label: "Market signal", icon: "trending-up", color: "#10B981", hint: "Donations, applications, build log engagement" },
  { key: "strategicThinkingScore", label: "Strategic thinking", icon: "bulb", color: "#A855F7", hint: "Contest wins, game scores, Nova's read of strategy" },
];

function tierOf(score: number) {
  if (score >= 80) return { label: "Elite", color: "#D97706" };
  if (score >= 60) return { label: "Advanced", color: "#9333EA" };
  if (score >= 40) return { label: "Rising", color: "#2563EB" };
  if (score >= 20) return { label: "Emerging", color: "#059669" };
  return { label: "New builder", color: colors.textTertiary };
}

export function ReputationBlock({ userId, isOwn, notify }: { userId: string; isOwn: boolean; notify: (n: Notice) => void }) {
  const qc = useQueryClient();
  const { data: rep } = useQuery({
    queryKey: ["reputation", userId],
    queryFn: () => api<any>(`/api/reputation/${userId}`),
  });
  const calc = useMutation({
    mutationFn: () => api("/api/reputation/calculate", { method: "POST" }),
    onSuccess: () => {
      notify({ text: "Your Builder Index has been recalculated.", tone: "success" });
      void qc.invalidateQueries({ queryKey: ["reputation", userId] });
      void qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e: any) => notify({ text: e?.message || "Could not calculate reputation.", tone: "error" }),
  });

  const index = rep?.builderIndex ?? 0;
  const tier = tierOf(index);

  return (
    <Section title="Builder Index" action={isOwn && index ? (calc.isPending ? "Calculating…" : "Recalculate") : undefined} onAction={() => !calc.isPending && calc.mutate()}>
      <Row center gap={spacing.lg}>
        <View style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: colors.primary, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 26, fontFamily: fontFamily.bold, color: colors.primary }}>{index}</Text>
        </View>
        <View style={{ gap: 3, flex: 1 }}>
          <Text style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color: tier.color }}>{tier.label}</Text>
          <Meta style={{ fontSize: font.sm }}>out of 100</Meta>
          {rep?.lastCalculatedAt ? <Meta>Updated {new Date(rep.lastCalculatedAt).toLocaleDateString()}</Meta> : null}
        </View>
      </Row>
      {(index > 0 || rep?.lastCalculatedAt) ? (
        <View style={{ gap: spacing.md }}>
        {SCORES.map((s) => (
          <View key={s.key} style={{ gap: 4 }}>
            <Row between>
              <Row center gap={6}>
                <Icon name={s.icon} size={15} color={s.color} />
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{s.label}</Text>
              </Row>
              <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{rep?.[s.key] ?? 0}</Text>
            </Row>
            <Progress value={rep?.[s.key] ?? 0} color={s.color} />
            <Meta>{s.hint}</Meta>
          </View>
        ))}
      </View>
      ) : !isOwn ? <Body muted>{"Not calculated yet."}</Body> : null}
      {isOwn && !index && (
        <View style={{ gap: spacing.sm, alignItems: "flex-start" }}>
          <Body muted>Calculate your Builder Reputation Index to see your scores.</Body>
          <Btn label="Calculate now · 1 credit" icon="flash" small loading={calc.isPending} onPress={() => calc.mutate()} />
        </View>
      )}
    </Section>
  );
}
