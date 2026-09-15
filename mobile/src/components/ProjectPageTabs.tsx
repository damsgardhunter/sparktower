/**
 * A project's public page, below the header — the native counterparts of
 * client/src/components/project-social-tabs.tsx (Overview, Updates, Roadmap,
 * Milestones, Team, Open Roles, Media, Discussion, Followers),
 * project-overview.tsx and media-gallery.tsx, plus the blocks the web page
 * keeps outside the tabs and in its right rail (storyboards, tech stack,
 * links, stats, team members, application questions), in the web's order.
 */
import { useState, type ReactNode } from "react";
import { Image, Modal, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as DocumentPicker from "expo-document-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, uploadFile } from "../api/client";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Avatar, Body, Btn, Empty, Icon, Loading, Meta, Row, assetUri, errText, type IconName } from "./ui";
import { Discussion } from "./Discussion";
import { Composer } from "./Composer";
import { PostCard } from "./PostCard";
import { Block, IconLine, ProjectVisualImage, Tag } from "./ProjectBits";
import { FeedbackInbox } from "./project/FeedbackInbox";
import { PROJECT_SECTIONS_BY_KEY, isSectionVisible, type ProjectSectionKey } from "../projectSections";
import { projectVisual } from "../projectData";
import type { Notice } from "./Sheet";
import type { FeedPost } from "./feedModel";

export type ProjectTab = "overview" | "updates" | "roadmap" | "milestones" | "team" | "roles" | "media" | "discussion" | "followers";

export const PROJECT_TABS: { value: ProjectTab; label: string; icon: IconName }[] = [
  { value: "overview", label: "Overview", icon: "grid-outline" },
  { value: "updates", label: "Updates", icon: "newspaper-outline" },
  { value: "roadmap", label: "Roadmap", icon: "map-outline" },
  { value: "milestones", label: "Milestones", icon: "flag-outline" },
  { value: "team", label: "Team", icon: "people-outline" },
  { value: "roles", label: "Open Roles", icon: "briefcase-outline" },
  { value: "media", label: "Media", icon: "images-outline" },
  { value: "discussion", label: "Discussion", icon: "chatbubbles-outline" },
  { value: "followers", label: "Followers", icon: "heart-outline" },
];

/** Open roles, less any a member already holds; none at all on a Solo Builder project. */
export function unfilledRoles(project: any, members: any[]): string[] {
  if (project.soloMode) return [];
  const filled = new Set(members.map((m) => (m.role || "").toLowerCase()));
  return (project.rolesNeeded || []).filter((r: string) => !filled.has(r.toLowerCase()));
}

export const memberName = (m: any) =>
  m.profile?.displayName || [m.user?.firstName, m.user?.lastName].filter(Boolean).join(" ") || m.user?.email || "Member";

const openLink = (url: string) => { void WebBrowser.openBrowserAsync(url).catch(() => {}); };

/** The project's posts — shared by Overview's "Latest updates", the Updates tab and its count. */
export const useProjectUpdates = (projectId: string) => useQuery({
  queryKey: ["feed", "project", projectId],
  queryFn: () => api<{ posts: FeedPost[] }>(`/api/feed?projectId=${projectId}&limit=20`),
});

export const useProjectMilestones = (projectId: string) => useQuery({
  queryKey: ["project", projectId, "milestones"],
  // Members-only on the server today, so a visitor gets a 403: read it as "none yet" rather than retrying.
  queryFn: () => api<any[]>(`/api/projects/${projectId}/milestones`).catch(() => []),
  retry: false,
});

/** A section heading on the canvas, the web's `h2.text-xl`. */
function Heading({ icon, children, right }: { icon?: IconName; children: ReactNode; right?: ReactNode }) {
  return (
    <Row center gap={spacing.sm}>
      {icon && <Icon name={icon} size={19} color={colors.primary} />}
      <Text style={{ flex: 1, fontSize: font.lg + 1, fontFamily: fontFamily.semibold, color: colors.text }}>{children}</Text>
      {right}
    </Row>
  );
}

function Overline({ children, color = colors.textTertiary }: { children: ReactNode; color?: string }) {
  return <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color, textTransform: "uppercase", letterSpacing: 0.5 }}>{children}</Text>;
}

function DashedEmpty({ icon, title, body, action, onAction }: { icon: IconName; title: string; body?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ marginHorizontal: spacing.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg, alignItems: "center", gap: spacing.sm }}>
      <Icon name={icon} size={32} color={colors.textTertiary} />
      <Text style={{ fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.medium, textAlign: "center" }}>{title}</Text>
      {body ? <Meta style={{ textAlign: "center", fontSize: font.sm }}>{body}</Meta> : null}
      {action && onAction ? <Btn small variant="outline" label={action} onPress={onAction} /> : null}
    </View>
  );
}

/** "💬 3" beside a phase or milestone once it has a thread. */
function CommentCount({ count }: { count: number }) {
  if (!count) return null;
  return (
    <Row center gap={3}>
      <Icon name="chatbubble-outline" size={12} color={colors.textTertiary} />
      <Meta>{count}</Meta>
    </Row>
  );
}

// --- Overview ----------------------------------------------------------------

const BRIEF: { key: ProjectSectionKey; icon: IconName; accent: string }[] = [
  { key: "problemStatement", icon: "locate-outline", accent: "#F43F5E" },
  { key: "targetUser", icon: "people-outline", accent: "#3B82F6" },
  { key: "valueProposition", icon: "sparkles-outline", accent: "#F59E0B" },
  { key: "targetCustomerProfile", icon: "person-circle-outline", accent: "#8B5CF6" },
  { key: "successMetrics", icon: "trending-up-outline", accent: "#10B981" },
];

export function OverviewTab({ project, members, isOwner, isMember, onApply, onManage, onTab, notify }: {
  project: any;
  members: any[];
  isOwner: boolean;
  isMember: boolean;
  onApply: () => void;
  onManage: () => void;
  onTab: (t: ProjectTab) => void;
  notify: (n: Notice) => void;
}) {
  const show = (k: ProjectSectionKey) => isSectionVisible(project, k);
  const visuals = project.profileVisuals;
  const brief = BRIEF.filter((b) => show(b.key));
  const scope = project.scope || {};
  const hasHero = show("oneLiner") || show("mission") || show("description");
  const hasAnything = hasHero || brief.length > 0 || show("scope");
  const roles = show("rolesNeeded") ? unfilledRoles(project, members) : [];
  const { data: updates } = useProjectUpdates(project.id);
  const latest = updates?.posts?.slice(0, 2) ?? [];
  const oneLinerVisual = projectVisual(visuals, "oneLiner");
  const aboutVisual = projectVisual(visuals, "about");
  const successVisual = projectVisual(visuals, "success");

  return (
    <View style={{ gap: spacing.sm }}>
      {!hasAnything && isOwner && (
        <Block>
          <IconLine icon="compass-outline" color={colors.text}><Text style={{ fontFamily: fontFamily.semibold }}>Bring this page to life</Text></IconLine>
          <Body muted>Add a one-liner, mission, and project brief so visitors instantly understand what you're building.</Body>
          <Btn label="Set up your brief" small icon="settings-outline" style={{ alignSelf: "flex-start" }} onPress={onManage} />
        </Block>
      )}

      {hasAnything && (
        <Block style={{ gap: spacing.lg }}>
          {show("oneLiner") && (
            <View style={{ borderWidth: 1, borderColor: `${colors.primary}33`, backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: spacing.lg, gap: 6 }}>
              <View style={{ position: "absolute", top: 12, right: 12 }}><Icon name="chatbox-ellipses" size={28} color={`${colors.primary}26`} /></View>
              <Overline color={`${colors.primary}CC`}>{PROJECT_SECTIONS_BY_KEY.oneLiner.label}</Overline>
              <Text style={{ fontSize: font.xl - 2, lineHeight: 26, fontFamily: fontFamily.semibold, color: colors.text, paddingRight: spacing.xl }}>{project.oneLiner}</Text>
            </View>
          )}
          <ProjectVisualImage uri={oneLinerVisual} />

          {show("mission") && (
            <View style={{ gap: spacing.sm }}>
              <Heading icon="compass-outline">{PROJECT_SECTIONS_BY_KEY.mission.label}</Heading>
              <Body muted style={{ lineHeight: 21 }}>{project.mission}</Body>
            </View>
          )}
          {show("description") && (
            <View style={{ gap: spacing.sm }}>
              <Heading>{PROJECT_SECTIONS_BY_KEY.description.label} this project</Heading>
              <Body muted style={{ lineHeight: 21 }}>{project.description}</Body>
            </View>
          )}
          <ProjectVisualImage uri={aboutVisual} />

          {brief.length > 0 && (
            <View style={{ gap: spacing.sm }}>
              <Heading>Project Brief</Heading>
              {brief.map(({ key, icon, accent }) => (
                <View key={key} style={{ backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.md, padding: spacing.md, gap: 6 }}>
                  <Row center gap={6}>
                    <Icon name={icon} size={14} color={accent} />
                    <Overline>{PROJECT_SECTIONS_BY_KEY[key].label}</Overline>
                  </Row>
                  <Body style={{ lineHeight: 20 }}>{project[key]}</Body>
                </View>
              ))}
            </View>
          )}
          <ProjectVisualImage uri={successVisual} />

          {show("scope") && (
            <View style={{ gap: spacing.md }}>
              <Heading icon="list-outline">{PROJECT_SECTIONS_BY_KEY.scope.label}</Heading>
              {(scope.mvp?.length || 0) > 0 && (
                <View style={{ gap: 6 }}>
                  <Overline>Building now (MVP)</Overline>
                  {scope.mvp.map((x: string, i: number) => (
                    <Row key={i} gap={spacing.sm} style={{ alignItems: "flex-start" }}>
                      <View style={{ marginTop: 3 }}><Icon name="radio-button-on" size={13} color={colors.primary} /></View>
                      <Body style={{ flex: 1 }}>{x}</Body>
                    </Row>
                  ))}
                </View>
              )}
              {(scope.niceToHave?.length || 0) > 0 && (
                <View style={{ gap: 6 }}>
                  <Overline>Exploring next</Overline>
                  <Row wrap gap={6}>{scope.niceToHave.map((x: string, i: number) => <Tag key={i} label={x} />)}</Row>
                </View>
              )}
            </View>
          )}
        </Block>
      )}

      {roles.length > 0 && (
        <Block>
          <Heading right={!isMember && !isOwner ? <Btn small icon="send" label="Apply" onPress={onApply} /> : undefined}>Open Roles</Heading>
          <Row wrap gap={6}>{roles.map((r) => <RoleBadge key={r} role={r} />)}</Row>
        </Block>
      )}

      {latest.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <Row between style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
            <Text style={{ fontSize: font.lg + 1, fontFamily: fontFamily.semibold, color: colors.text }}>Latest updates</Text>
            <Pressable onPress={() => onTab("updates")} hitSlop={8}>
              <Row center gap={4}>
                <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>See all</Text>
                <Icon name="arrow-forward" size={14} color={colors.primary} />
              </Row>
            </Pressable>
          </Row>
          {latest.map((p) => <PostCard key={p.id} post={p} onNotice={notify} />)}
        </View>
      )}
    </View>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: colors.text }}>{role}</Text>
    </View>
  );
}

// --- Outside the tabs, and the right rail ---------------------------------------

/** The owner's private AI storyboards, which the web keeps under the tabs. */
export function StoryboardsBlock({ projectId, onOpen }: { projectId: string; onOpen: () => void }) {
  const { data } = useQuery({
    queryKey: ["project", projectId, "storyboards"],
    queryFn: () => api<{ id: string }[]>(`/api/projects/${projectId}/storyboards`),
    retry: false,
  });
  const count = data?.length ?? 0;
  return (
    <Block>
      <Row center gap={spacing.sm}>
        <Text style={{ fontSize: font.lg + 1, fontFamily: fontFamily.semibold, color: colors.text }}>AI Storyboards</Text>
        <Tag icon="lock-closed" label="Private" />
      </Row>
      <Meta style={{ fontSize: font.sm, lineHeight: 19 }}>Showcase reels Nova builds from your brief. Only you can see these.</Meta>
      <Row gap={spacing.sm} wrap>
        <Btn small variant="outline" icon="sparkles" label={`View Storyboards${count ? ` · ${count}` : ""}`} onPress={onOpen} />
        <Btn small variant="outline" icon="videocam-outline" label="Generate AI Video" onPress={onOpen} />
      </Row>
    </Block>
  );
}

export function TechStackBlock({ project }: { project: any }) {
  if (!isSectionVisible(project, "techStack")) return null;
  return (
    <Block>
      <Heading>Tech Stack</Heading>
      <Row wrap gap={6}>
        {project.techStack.map((t: string) => (
          <View key={t} style={{ borderWidth: 1, borderColor: "#A855F74D", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
            <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: "#9333EA" }}>{t}</Text>
          </View>
        ))}
      </Row>
    </Block>
  );
}

export function LinksBlock({ project }: { project: any }) {
  if (!isSectionVisible(project, "links")) return null;
  return (
    <Block>
      <Row wrap gap={spacing.sm}>
        {project.repoUrl ? <Btn small variant="outline" icon="logo-github" label="Repository" onPress={() => openLink(project.repoUrl)} /> : null}
        {project.liveUrl ? <Btn small variant="outline" icon="open-outline" label="Live Demo" onPress={() => openLink(project.liveUrl)} /> : null}
      </Row>
    </Block>
  );
}

function StatRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <Row between>
      <IconLine icon={icon}>{label}</IconLine>
      <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{value}</Text>
    </Row>
  );
}

export function StatsBlock({ project, members, followerCount }: { project: any; members: any[]; followerCount: number }) {
  if (!isSectionVisible(project, "stats")) return null;
  return (
    <Block title="Project Stats">
      <StatRow icon="eye-outline" label="Views" value={String(project.views ?? 0)} />
      <StatRow icon="people-outline" label="Team Size" value={`${members.length} / ${project.teamSize ?? "—"}`} />
      <StatRow icon="calendar-outline" label="Timeline" value={project.estimatedWeeks ? `${project.estimatedWeeks} weeks` : "—"} />
      <StatRow icon="heart-outline" label="Followers" value={String(followerCount)} />
    </Block>
  );
}

export function TeamMembersBlock({ project, members }: { project: any; members: any[] }) {
  const router = useRouter();
  if (!isSectionVisible(project, "team") || !members.length) return null;
  return (
    <Block title="Team Members">
      {members.map((m) => (
        <Pressable key={m.id} onPress={() => router.push(`/user/${m.userId}` as any)} style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Row center gap={spacing.md}>
            <Avatar name={memberName(m)} uri={m.profile?.avatarUrl} size={34} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{memberName(m)}</Text>
              <Meta style={{ textTransform: "capitalize" }}>{m.role}</Meta>
            </View>
          </Row>
        </Pressable>
      ))}
    </Block>
  );
}

export function QuestionsBlock({ questions, onEdit }: { questions: { id: string; question: string; required: boolean }[]; onEdit: () => void }) {
  return (
    <Block title="Application Questions" action="Edit" onAction={onEdit}>
      {questions.length ? questions.map((q, i) => (
        <Row key={q.id || i} gap={spacing.sm} style={{ alignItems: "flex-start" }}>
          <Meta style={{ fontSize: font.sm }}>{i + 1}.</Meta>
          <Body style={{ flex: 1 }}>{q.question}</Body>
          {q.required ? <Tag label="Required" /> : null}
        </Row>
      )) : (
        <Meta style={{ fontSize: font.sm }}>No application questions set. Tap Edit to add some.</Meta>
      )}
    </Block>
  );
}

export function RailVisuals({ project }: { project: any }) {
  const top = projectVisual(project.profileVisuals, "railTop");
  const bottom = projectVisual(project.profileVisuals, "railBottom");
  if (!top && !bottom) return null;
  return (
    <Block>
      <ProjectVisualImage square uri={top} />
      <ProjectVisualImage square uri={bottom} />
    </Block>
  );
}

// --- Updates -----------------------------------------------------------------

export function UpdatesTab({ projectId, isMember, notify }: { projectId: string; isMember: boolean; notify: (n: Notice) => void }) {
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);
  const { data, isLoading } = useProjectUpdates(projectId);
  return (
    <View style={{ gap: spacing.sm }}>
      {isMember && <FeedbackInbox projectId={projectId} notify={notify} />}
      {isMember && (
        <Block>
          <Pressable onPress={() => setComposing(true)} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }, pressed && { opacity: 0.7 }]}>
            <Icon name="create-outline" size={18} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: font.sm }}>Share what you're building</Text>
          </Pressable>
        </Block>
      )}
      {isLoading ? <Loading /> : !data?.posts?.length ? (
        <DashedEmpty icon="newspaper-outline" title={isMember ? "No updates yet. Share what you're building." : "No updates yet."} />
      ) : (
        data.posts.map((p) => <PostCard key={p.id} post={p} onNotice={notify} />)
      )}
      <Composer
        visible={composing}
        defaultProjectId={projectId}
        onClose={() => setComposing(false)}
        onPosted={() => { setComposing(false); void qc.invalidateQueries({ queryKey: ["feed", "project", projectId] }); }}
      />
    </View>
  );
}

// --- Roadmap & milestones ------------------------------------------------------

const STATE_ICON: Record<string, { icon: IconName; color: string }> = {
  completed: { icon: "checkmark-circle", color: "#10B981" },
  "in-progress": { icon: "radio-button-on", color: colors.primary },
  upcoming: { icon: "ellipse-outline", color: colors.textTertiary },
  planned: { icon: "ellipse-outline", color: colors.textTertiary },
};

function StepCard({ status, title, badges, description, footnote, children }: {
  status: string; title: string; badges?: ReactNode; description?: string | null; footnote?: string | null; children?: ReactNode;
}) {
  const st = STATE_ICON[status] || STATE_ICON.upcoming;
  return (
    <Block style={{ gap: spacing.sm }}>
      <Row gap={spacing.md} style={{ alignItems: "flex-start" }}>
        <View style={{ marginTop: 1 }}><Icon name={st.icon} size={21} color={st.color} /></View>
        <View style={{ flex: 1, gap: 4 }}>
          <Row center wrap gap={6}>
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{title}</Text>
            {badges}
          </Row>
          {description ? <Body muted>{description}</Body> : null}
          {footnote ? <Meta>{footnote}</Meta> : null}
        </View>
      </Row>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingTop: spacing.sm }}>{children}</View>
    </Block>
  );
}

function OutlineBadge({ label, icon }: { label: string; icon?: IconName }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 }}>
      {icon && <Icon name={icon} size={10} color={colors.textSecondary} />}
      <Text style={{ fontSize: 10, color: colors.textSecondary, fontFamily: fontFamily.regular, textTransform: "capitalize" }}>{label}</Text>
    </View>
  );
}

export function RoadmapTab({ projectId, isOwner, onManage, counts }: { projectId: string; isOwner: boolean; onManage: () => void; counts?: Record<string, number> }) {
  const { data, isLoading } = useQuery({
    queryKey: ["project", projectId, "roadmap"],
    queryFn: () => api<any>(`/api/projects/${projectId}/roadmap`),
  });
  if (isLoading) return <Loading />;
  if (!data?.roadmap) {
    return <DashedEmpty icon="map-outline" title="No public roadmap yet." action={isOwner ? "Build one" : undefined} onAction={isOwner ? onManage : undefined} />;
  }
  const phases = data.roadmap.phases || [];
  return (
    <View style={{ gap: spacing.sm }}>
      <Block style={{ gap: 6 }}>
        <Overline>The goal</Overline>
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.lg, color: colors.text, lineHeight: 24 }}>{data.roadmap.goal}</Text>
        {data.roadmap.summary ? <Body muted>{data.roadmap.summary}</Body> : null}
      </Block>
      {phases.map((phase: any) => {
        const count = counts?.[`roadmap_phase:${phase.id}`] || 0;
        return (
          <StepCard key={phase.id} status={phase.status} title={phase.title} description={phase.description}
            badges={<>{phase.estimatedDuration ? <OutlineBadge icon="time-outline" label={phase.estimatedDuration} /> : null}<CommentCount count={count} /></>}>
            <Discussion projectId={projectId} targetType="roadmap_phase" targetId={phase.id} compact={count === 0} />
          </StepCard>
        );
      })}
    </View>
  );
}

export function MilestonesTab({ projectId, counts }: { projectId: string; counts?: Record<string, number> }) {
  const { data, isLoading } = useProjectMilestones(projectId);
  if (isLoading) return <Loading />;
  if (!data?.length) return <DashedEmpty icon="flag-outline" title="No milestones yet." />;
  return (
    <View style={{ gap: spacing.sm }}>
      {data.map((m) => {
        const count = counts?.[`milestone:${m.id}`] || 0;
        return (
          <StepCard key={m.id} status={m.status} title={m.title} description={m.description}
            badges={<><OutlineBadge label={m.status} /><CommentCount count={count} /></>}
            footnote={m.targetDate ? `Target ${new Date(m.targetDate).toLocaleDateString()}` : null}>
            <Discussion projectId={projectId} targetType="milestone" targetId={m.id} compact={count === 0} />
          </StepCard>
        );
      })}
    </View>
  );
}

// --- People ------------------------------------------------------------------

function PersonRow({ userId, name, uri, line1, line2 }: { userId: string; name: string; uri?: string | null; line1?: string | null; line2?: string | null }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push(`/user/${userId}` as any)}
      style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle }, pressed && { backgroundColor: colors.surfaceRaised }]}>
      <Avatar name={name} uri={uri} size={44} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{name}</Text>
        {line1 ? <Text style={{ fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.regular, textTransform: "capitalize" }}>{line1}</Text> : null}
        {line2 ? <Meta numberOfLines={1}>{line2}</Meta> : null}
      </View>
      <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

export function TeamTab({ members }: { members: any[] }) {
  if (!members.length) return <DashedEmpty icon="people-outline" title="No team members listed yet." />;
  return (
    <Block flush style={{ paddingBottom: 0, paddingTop: spacing.xs }}>
      {members.map((m) => (
        <PersonRow key={m.id} userId={m.userId} uri={m.profile?.avatarUrl} name={memberName(m)} line1={m.role} line2={m.profile?.headline} />
      ))}
    </Block>
  );
}

export function FollowersTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["project", projectId, "followers"],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/followers`).catch(() => []),
  });
  if (isLoading) return <Loading />;
  if (!data?.length) return <DashedEmpty icon="heart-outline" title="No followers yet." />;
  return (
    <Block flush style={{ paddingBottom: 0, paddingTop: spacing.xs }}>
      {data.map((f) => (
        <PersonRow key={f.userId} userId={f.userId} uri={f.profile?.avatarUrl}
          name={f.profile?.displayName || f.user?.firstName || "Someone"} line2={f.profile?.headline} />
      ))}
    </Block>
  );
}

export function RolesTab({ project, members, isOwner, isMember, onApply }: { project: any; members: any[]; isOwner: boolean; isMember: boolean; onApply: () => void }) {
  if (project.soloMode) {
    return <DashedEmpty icon="rocket-outline" title="Solo Builder project" body="The owner is building this one solo and isn't recruiting teammates." />;
  }
  const open = unfilledRoles(project, members);
  if (!open.length) {
    return <DashedEmpty icon="briefcase-outline" title={project.rolesNeeded?.length ? "Every role is filled." : "No open roles listed."} />;
  }
  return (
    <View style={{ gap: spacing.sm }}>
      <Meta style={{ fontSize: font.sm, paddingHorizontal: spacing.lg }}>
        {open.length} role{open.length === 1 ? "" : "s"} still open on this project.
      </Meta>
      <Block flush style={{ paddingBottom: 0, paddingTop: spacing.xs }}>
        {open.map((r) => (
          <View key={r} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Icon name="briefcase-outline" size={19} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{r}</Text>
              <Meta>{project.estimatedWeeks ? `~${project.estimatedWeeks} week project` : "Open-ended"}</Meta>
            </View>
            {!isMember && !isOwner && <Btn small variant="outline" label="Apply" onPress={onApply} />}
          </View>
        ))}
      </Block>
    </View>
  );
}

// --- Media -------------------------------------------------------------------

const isVideo = (url: string) => /\.(mp4|webm|ogg|mov)$/i.test(url) || url.includes("video");

export function MediaTab({ projectId, mediaUrls, isOwner, notify }: { projectId: string; mediaUrls: string[]; isOwner: boolean; notify: (n: Notice) => void }) {
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const tile = (Math.min(width, 600) - spacing.lg * 2 - spacing.sm) / 2;
  const refresh = () => qc.invalidateQueries({ queryKey: ["project", projectId] });

  const remove = useMutation({
    mutationFn: (index: number) => api(`/api/projects/${projectId}/media/${index}`, { method: "DELETE" }),
    onSuccess: () => { void refresh(); notify({ text: "Media removed.", tone: "info" }); },
    onError: (e) => notify({ text: errText(e, "Couldn't remove that."), tone: "error" }),
  });

  const add = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm"], copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.[0]) return;
      const file = picked.assets[0];
      if (file.size && file.size > 50 * 1024 * 1024) { notify({ text: "Maximum file size is 50MB.", tone: "error" }); return; }
      setUploading(true);
      const objectPath = await uploadFile({ uri: file.uri, name: file.name, mimeType: file.mimeType, size: file.size });
      await api(`/api/projects/${projectId}/media`, { method: "POST", body: { objectPath } });
      await refresh();
      notify({ text: "Media uploaded.", tone: "success" });
    } catch (e) {
      notify({ text: errText(e, "Upload failed."), tone: "error" });
    } finally {
      setUploading(false);
    }
  };

  if (!mediaUrls.length && !isOwner) {
    return <Block><Empty icon="images-outline" title="No media yet" body="Screenshots and demo videos will show up here." /></Block>;
  }

  return (
    <Block title="Media">
      <Row wrap gap={spacing.sm}>
        {mediaUrls.map((url, i) => (
          <Pressable key={`${url}-${i}`} onPress={() => (isVideo(url) ? openLink(assetUri(url)!) : setLightbox(url))}
            style={{ width: tile, height: tile * 0.75, borderRadius: radius.sm, overflow: "hidden", backgroundColor: isVideo(url) ? "#111" : colors.surfaceRaised }}>
            {isVideo(url)
              ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Icon name="play-circle" size={36} color="#FFFFFF" /></View>
              : <Image source={{ uri: assetUri(url)! }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />}
            {isOwner && (
              <Pressable onPress={() => remove.mutate(i)} hitSlop={6} accessibilityLabel="Remove"
                style={{ position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}>
                <Icon name="close" size={16} color="#FFFFFF" />
              </Pressable>
            )}
          </Pressable>
        ))}
        {isOwner && (
          <Pressable onPress={add} disabled={uploading}
            style={({ pressed }) => [{ width: tile, height: tile * 0.75, borderRadius: radius.sm, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.border, alignItems: "center", justifyContent: "center", gap: 4 }, pressed && { borderColor: colors.primary }]}>
            {uploading ? <Loading /> : <><Icon name="add" size={26} color={colors.textTertiary} /><Meta>Add media</Meta></>}
          </Pressable>
        )}
      </Row>
      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <Pressable onPress={() => setLightbox(null)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" }}>
          {lightbox && <Image source={{ uri: assetUri(lightbox)! }} style={{ width: "100%", height: "80%" }} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </Block>
  );
}

// --- Discussion --------------------------------------------------------------

export function DiscussionTab({ projectId }: { projectId: string }) {
  return (
    <Block title="Project discussion" icon="chatbubbles-outline">
      <Meta style={{ fontSize: font.sm }}>Ask questions, offer help, or share what you'd want from this.</Meta>
      <Discussion projectId={projectId} targetType="project" targetId={projectId} />
    </Block>
  );
}
