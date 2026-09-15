/**
 * The tabs of a project's public page — Overview, Updates, Roadmap,
 * Milestones, Team, Open roles, Media, Discussion, Followers — the native
 * counterparts of client/src/components/project-social-tabs.tsx,
 * project-overview.tsx and media-gallery.tsx.
 */
import { useState, type ReactNode } from "react";
import { Image, Modal, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as DocumentPicker from "expo-document-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, uploadFile } from "../api/client";
import { colors, font, fontFamily, postTypeColors, radius, spacing } from "../theme";
import { Avatar, Body, Btn, Empty, Icon, Loading, Meta, Row, assetUri, errText, plain, timeAgo, type IconName } from "./ui";
import { Discussion } from "./Discussion";
import { Composer } from "./Composer";
import { Block, IconLine, ProjectVisualImage, Tag } from "./ProjectBits";
import { PROJECT_SECTIONS_BY_KEY, isSectionVisible, type ProjectSectionKey } from "../projectSections";
import { projectVisual } from "../projectData";
import type { Notice } from "./Sheet";

export type ProjectTab = "overview" | "updates" | "roadmap" | "milestones" | "team" | "roles" | "media" | "discussion" | "followers";

export const PROJECT_TABS: { value: ProjectTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "updates", label: "Updates" },
  { value: "roadmap", label: "Roadmap" },
  { value: "milestones", label: "Milestones" },
  { value: "team", label: "Team" },
  { value: "roles", label: "Open roles" },
  { value: "media", label: "Media" },
  { value: "discussion", label: "Discussion" },
  { value: "followers", label: "Followers" },
];

/** Open roles, less any a member already holds; none at all on a Solo Builder project. */
export function unfilledRoles(project: any, members: any[]): string[] {
  if (project.soloMode) return [];
  const filled = new Set(members.map((m) => (m.role || "").toLowerCase()));
  return (project.rolesNeeded || []).filter((r: string) => !filled.has(r.toLowerCase()));
}

const openLink = (url: string) => { void WebBrowser.openBrowserAsync(url).catch(() => {}); };

// --- Overview ----------------------------------------------------------------

const BRIEF: { key: ProjectSectionKey; icon: IconName; accent: string }[] = [
  { key: "problemStatement", icon: "locate-outline", accent: "#E11D48" },
  { key: "targetUser", icon: "people-outline", accent: "#2563EB" },
  { key: "valueProposition", icon: "sparkles-outline", accent: "#D97706" },
  { key: "targetCustomerProfile", icon: "person-circle-outline", accent: "#7C3AED" },
  { key: "successMetrics", icon: "trending-up-outline", accent: "#16A34A" },
];

export function OverviewTab({ project, members, followerCount, isOwner, isMember, onApply, onManage, onTab, children }: {
  project: any;
  members: any[];
  followerCount: number;
  isOwner: boolean;
  isMember: boolean;
  onApply: () => void;
  onManage: () => void;
  onTab: (t: ProjectTab) => void;
  /** Invest, back, and owner tools — slotted in after the pitch. */
  children?: ReactNode;
}) {
  const show = (k: ProjectSectionKey) => isSectionVisible(project, k);
  const visuals = project.profileVisuals;
  const brief = BRIEF.filter((b) => show(b.key));
  const scope = project.scope || {};
  const hasAbout = show("oneLiner") || show("mission") || show("description");
  const roles = show("rolesNeeded") ? unfilledRoles(project, members) : [];
  const { data: updates } = useQuery({
    queryKey: ["feed", "project", project.id],
    queryFn: () => api<{ posts: any[] }>(`/api/feed?projectId=${project.id}&limit=20`),
  });
  const latest = updates?.posts?.slice(0, 2) ?? [];

  return (
    <View style={{ gap: spacing.sm }}>
      {!hasAbout && brief.length === 0 && !show("scope") && isOwner && (
        <Block title="Bring this page to life" icon="compass-outline">
          <Body muted>Add a one-liner, mission, and project brief so visitors instantly understand what you're building.</Body>
          <Btn label="Set up your brief" small icon="settings-outline" style={{ alignSelf: "flex-start" }} onPress={onManage} />
        </Block>
      )}

      {hasAbout && (
        <Block title="About">
          {show("oneLiner") && (
            <View style={{ backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: spacing.lg, gap: 6 }}>
              <Row between center>
                <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.primary, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {PROJECT_SECTIONS_BY_KEY.oneLiner.label}
                </Text>
                <Icon name="chatbox-ellipses-outline" size={18} color={colors.primary} />
              </Row>
              <Text style={{ fontSize: font.lg, lineHeight: 24, fontFamily: fontFamily.semibold, color: colors.text }}>{project.oneLiner}</Text>
            </View>
          )}
          <ProjectVisualImage uri={projectVisual(visuals, "oneLiner")} />
          {show("mission") && (
            <View style={{ gap: 4 }}>
              <IconLine icon="compass-outline" color={colors.text}><Text style={{ fontFamily: fontFamily.semibold }}>Mission</Text></IconLine>
              <Body muted>{project.mission}</Body>
            </View>
          )}
          {show("description") && (
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>About this project</Text>
              <Body muted>{project.description}</Body>
            </View>
          )}
          <ProjectVisualImage uri={projectVisual(visuals, "about")} />
        </Block>
      )}

      {children}

      {brief.length > 0 && (
        <Block title="Project brief">
          {brief.map(({ key, icon, accent }) => (
            <View key={key} style={{ backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: spacing.md, gap: 4 }}>
              <Row center gap={6}>
                <Icon name={icon} size={15} color={accent} />
                <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  {PROJECT_SECTIONS_BY_KEY[key].label}
                </Text>
              </Row>
              <Body>{project[key]}</Body>
            </View>
          ))}
          <ProjectVisualImage uri={projectVisual(visuals, "success")} />
        </Block>
      )}

      {show("scope") && (
        <Block title="Roadmap scope" icon="list-outline">
          {(scope.mvp?.length || 0) > 0 && (
            <View style={{ gap: 6 }}>
              <Meta style={{ textTransform: "uppercase", fontFamily: fontFamily.semibold }}>Building now (MVP)</Meta>
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
              <Meta style={{ textTransform: "uppercase", fontFamily: fontFamily.semibold }}>Exploring next</Meta>
              <Row wrap gap={6}>{scope.niceToHave.map((x: string, i: number) => <Tag key={i} label={x} />)}</Row>
            </View>
          )}
        </Block>
      )}

      {show("techStack") && (
        <Block title="Tech stack" icon="code-slash-outline">
          <Row wrap gap={6}>{project.techStack.map((t: string) => <Tag key={t} tone="primary" label={t} />)}</Row>
        </Block>
      )}

      {roles.length > 0 && (
        <Block title="Open roles" icon="briefcase-outline" action="See all" onAction={() => onTab("roles")}>
          <Row wrap gap={6}>{roles.map((r) => <Tag key={r} label={r} />)}</Row>
          {!isMember && !isOwner && <Btn label="Apply to join" small icon="send-outline" style={{ alignSelf: "flex-start" }} onPress={onApply} />}
        </Block>
      )}

      {latest.length > 0 && (
        <Block title="Latest updates" action="See all" onAction={() => onTab("updates")} flush>
          {latest.map((p) => <UpdateRow key={p.id} post={p} />)}
        </Block>
      )}

      {(show("stats") || show("links")) && (
        <Block title="Details">
          {show("stats") && (
            <View style={{ gap: spacing.sm }}>
              <StatRow icon="eye-outline" label="Views" value={String(project.views ?? 0)} />
              <StatRow icon="people-outline" label="Team size" value={`${members.length}${project.teamSize ? ` / ${project.teamSize}` : ""}`} />
              {project.estimatedWeeks ? <StatRow icon="calendar-outline" label="Timeline" value={`${project.estimatedWeeks} weeks`} /> : null}
              <StatRow icon="heart-outline" label="Followers" value={String(followerCount)} />
            </View>
          )}
          {show("links") && (
            <Row wrap gap={spacing.sm}>
              {project.repoUrl ? <Btn small variant="outline" icon="logo-github" label="Repository" onPress={() => openLink(project.repoUrl)} /> : null}
              {project.liveUrl ? <Btn small variant="outline" icon="open-outline" label="Live demo" onPress={() => openLink(project.liveUrl)} /> : null}
            </Row>
          )}
        </Block>
      )}

      {(projectVisual(visuals, "railTop") || projectVisual(visuals, "railBottom")) && (
        <Block>
          <Row gap={spacing.sm}>
            <View style={{ flex: 1 }}><ProjectVisualImage square uri={projectVisual(visuals, "railTop")} /></View>
            <View style={{ flex: 1 }}><ProjectVisualImage square uri={projectVisual(visuals, "railBottom")} /></View>
          </Row>
        </Block>
      )}
    </View>
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

// --- Updates -----------------------------------------------------------------

const POST_LABELS: Record<string, string> = {
  project_update: "Update", looking_for_help: "Looking for help", looking_for_cofounder: "Looking for a cofounder",
  seeking_feedback: "Feedback wanted", milestone: "Milestone", idea_validation: "Idea validation", launch: "Launch", investor_update: "Investor update",
};

function UpdateRow({ post }: { post: any }) {
  const router = useRouter();
  const name = post.profile?.displayName || [post.author?.firstName, post.author?.lastName].filter(Boolean).join(" ") || "Someone";
  const accent = postTypeColors[post.postType] || colors.info;
  const media = (post.mediaUrls || []).filter((u: string) => !/\.(mp4|webm|mov)$/i.test(u));
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSubtle }}>
      <Pressable onPress={() => post.authorId && router.push(`/user/${post.authorId}` as any)}>
        <Row center gap={spacing.sm}>
          <Avatar name={name} uri={post.profile?.avatarUrl} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{name}</Text>
            <Row center gap={6}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} />
              <Meta>{POST_LABELS[post.postType] || "Post"} · {timeAgo(post.createdAt)}</Meta>
            </Row>
          </View>
        </Row>
      </Pressable>
      <Body numberOfLines={8}>{plain(post.content || "")}</Body>
      {media[0] ? (
        <Image source={{ uri: assetUri(media[0])! }} style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised }} resizeMode="cover" />
      ) : null}
      <Row gap={spacing.lg}>
        <IconLine icon="thumbs-up-outline">{String(post.reactionCount ?? 0)}</IconLine>
        <IconLine icon="chatbubble-outline">{String(post.commentCount ?? 0)}</IconLine>
      </Row>
    </View>
  );
}

export function UpdatesTab({ projectId, isMember }: { projectId: string; isMember: boolean }) {
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["feed", "project", projectId],
    queryFn: () => api<{ posts: any[] }>(`/api/feed?projectId=${projectId}&limit=20`),
  });
  return (
    <View style={{ gap: spacing.sm }}>
      {isMember && (
        <Block>
          <Pressable onPress={() => setComposing(true)} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }, pressed && { opacity: 0.7 }]}>
            <Icon name="create-outline" size={18} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: font.sm }}>Share what you're building</Text>
          </Pressable>
        </Block>
      )}
      {isLoading ? <Loading /> : !data?.posts?.length ? (
        <Block><Empty icon="newspaper-outline" title="No updates yet" body={isMember ? "Post the first one — followers see it in their feed." : "When the team posts, it shows up here."} /></Block>
      ) : (
        <Block flush style={{ paddingTop: 0, paddingBottom: 0 }}>
          {data.posts.map((p) => <UpdateRow key={p.id} post={p} />)}
        </Block>
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

const STATE_ICON: Record<string, { icon: IconName; color: string; label: string }> = {
  completed: { icon: "checkmark-circle", color: colors.success, label: "Completed" },
  "in-progress": { icon: "radio-button-on", color: colors.primary, label: "In progress" },
  upcoming: { icon: "ellipse-outline", color: colors.textTertiary, label: "Upcoming" },
  planned: { icon: "ellipse-outline", color: colors.textTertiary, label: "Planned" },
};

function StepCard({ status, title, meta, description, children, last }: {
  status: string; title: string; meta?: string | null; description?: string | null; children?: ReactNode; last?: boolean;
}) {
  const st = STATE_ICON[status] || STATE_ICON.upcoming;
  return (
    <Row gap={spacing.md} style={{ alignItems: "stretch" }}>
      <View style={{ alignItems: "center", width: 22 }}>
        <Icon name={st.icon} size={22} color={st.color} />
        {!last && <View style={{ flex: 1, width: 2, backgroundColor: colors.borderSubtle, marginTop: 4 }} />}
      </View>
      <View style={{ flex: 1, gap: 4, paddingBottom: last ? 0 : spacing.lg }}>
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{title}</Text>
        <Meta>{[st.label, meta].filter(Boolean).join(" · ")}</Meta>
        {description ? <Body muted>{description}</Body> : null}
        {children}
      </View>
    </Row>
  );
}

export function RoadmapTab({ projectId, isOwner, onManage, counts }: { projectId: string; isOwner: boolean; onManage: () => void; counts?: Record<string, number> }) {
  const { data, isLoading } = useQuery({
    queryKey: ["project", projectId, "roadmap"],
    queryFn: () => api<any>(`/api/projects/${projectId}/roadmap`),
  });
  if (isLoading) return <Loading />;
  if (!data?.roadmap) {
    return (
      <Block>
        <Empty icon="map-outline" title="No public roadmap yet" action={isOwner ? "Build one" : undefined} onAction={isOwner ? onManage : undefined} />
      </Block>
    );
  }
  const phases = data.roadmap.phases || [];
  const done = phases.filter((p: any) => p.status === "completed").length;
  return (
    <View style={{ gap: spacing.sm }}>
      <Block>
        <Meta style={{ textTransform: "uppercase", fontFamily: fontFamily.semibold }}>The goal</Meta>
        <Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg, color: colors.text, lineHeight: 24 }}>{data.roadmap.goal}</Text>
        {data.roadmap.summary ? <Body muted>{data.roadmap.summary}</Body> : null}
        <View style={{ gap: 4 }}>
          <View style={{ height: 6, backgroundColor: colors.surfaceRaised, borderRadius: 3, overflow: "hidden" }}>
            <View style={{ height: 6, width: `${phases.length ? (done / phases.length) * 100 : 0}%`, backgroundColor: colors.primary }} />
          </View>
          <Meta>{done} of {phases.length} phases complete</Meta>
        </View>
      </Block>
      <Block title="Phases">
        {phases.map((phase: any, i: number) => (
          <StepCard key={phase.id} status={phase.status} title={phase.title} meta={phase.estimatedDuration} description={phase.description} last={i === phases.length - 1}>
            <Discussion projectId={projectId} targetType="roadmap_phase" targetId={phase.id} compact={(counts?.[`roadmap_phase:${phase.id}`] || 0) === 0} />
          </StepCard>
        ))}
      </Block>
    </View>
  );
}

export function MilestonesTab({ projectId, counts }: { projectId: string; counts?: Record<string, number> }) {
  const { data, isLoading } = useQuery({
    queryKey: ["project", projectId, "milestones"],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/milestones`),
  });
  if (isLoading) return <Loading />;
  if (!data?.length) return <Block><Empty icon="flag-outline" title="No milestones yet" /></Block>;
  return (
    <Block title="Milestones">
      {data.map((m, i) => (
        <StepCard key={m.id} status={m.status} title={m.title} description={m.description} last={i === data.length - 1}
          meta={m.targetDate ? `Target ${new Date(m.targetDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : null}>
          <Discussion projectId={projectId} targetType="milestone" targetId={m.id} compact={(counts?.[`milestone:${m.id}`] || 0) === 0} />
        </StepCard>
      ))}
    </Block>
  );
}

// --- People ------------------------------------------------------------------

function PersonRow({ userId, name, uri, line1, line2 }: { userId: string; name: string; uri?: string | null; line1?: string | null; line2?: string | null }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push(`/user/${userId}` as any)}
      style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle }, pressed && { backgroundColor: colors.surfaceRaised }]}>
      <Avatar name={name} uri={uri} size={48} />
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
  if (!members.length) return <Block><Empty icon="people-outline" title="No team members listed yet" /></Block>;
  return (
    <Block title={`Team · ${members.length}`} flush style={{ paddingBottom: 0 }}>
      {members.map((m) => (
        <PersonRow key={m.id} userId={m.userId} uri={m.profile?.avatarUrl}
          name={m.profile?.displayName || [m.user?.firstName, m.user?.lastName].filter(Boolean).join(" ") || m.user?.email || "Member"}
          line1={m.role} line2={m.profile?.headline} />
      ))}
    </Block>
  );
}

export function FollowersTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["project", projectId, "followers"],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/followers`),
  });
  if (isLoading) return <Loading />;
  if (!data?.length) return <Block><Empty icon="heart-outline" title="No followers yet" /></Block>;
  return (
    <Block title={`Followers · ${data.length}`} flush style={{ paddingBottom: 0 }}>
      {data.map((f) => (
        <PersonRow key={f.userId} userId={f.userId} uri={f.profile?.avatarUrl}
          name={f.profile?.displayName || f.user?.firstName || "Someone"} line2={f.profile?.headline} />
      ))}
    </Block>
  );
}

export function RolesTab({ project, members, isOwner, isMember, onApply }: { project: any; members: any[]; isOwner: boolean; isMember: boolean; onApply: () => void }) {
  if (project.soloMode) {
    return <Block><Empty icon="rocket-outline" title="Solo Builder project" body="The owner is building this one solo and isn't recruiting teammates." /></Block>;
  }
  const open = unfilledRoles(project, members);
  if (!open.length) {
    return <Block><Empty icon="briefcase-outline" title={project.rolesNeeded?.length ? "Every role is filled" : "No open roles listed"} /></Block>;
  }
  return (
    <Block title={`${open.length} open role${open.length === 1 ? "" : "s"}`} flush style={{ paddingBottom: 0 }}>
      {open.map((r) => (
        <View key={r} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle }}>
          <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
            <Icon name="briefcase-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{r}</Text>
            <Meta>{project.title} · {project.estimatedWeeks ? `~${project.estimatedWeeks} week project` : "Open-ended"}</Meta>
          </View>
          {!isMember && !isOwner && <Btn small variant="outline" label="Apply" onPress={onApply} />}
        </View>
      ))}
    </Block>
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
