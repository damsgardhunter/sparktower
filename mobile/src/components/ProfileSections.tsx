/**
 * The cards a profile is made of, in the website's order and words.
 *
 * Mirrors client/src/pages/profile.tsx and the components it draws —
 * looking-for-card, profile-resume-panel, profile-credentials, profile-feed,
 * project-card and reputation-card — on the same endpoints. On a phone the
 * web's two columns stack the way the website's own narrow layout stacks
 * them: the left column's cards first, then posts, projects and the Builder
 * Index.
 */
import { useState, type ReactNode } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useEntitlementsQuery } from "../hooks/useEntitlements";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { assetUri, Avatar, Btn, Icon, Meta, Progress, Row, type IconName } from "./ui";
import type { Notice } from "./Sheet";
import { PostCard } from "./PostCard";
import { PinnedBadgesRow } from "./ProfileBadges";
import { CardTitle, EmptyCard, GUTTER, Heading, OutlineButton, PCard, Pill, StrongTitle } from "./profile/kit";

/** The web's header name: display name, else the account's name, else the headline. */
export const nameOf = (profile: any, user?: any) =>
  profile?.displayName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || profile?.headline || "Untitled Profile";

const bodyText = { fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular, color: colors.text } as const;
const mutedText = { fontSize: font.xs + 1, lineHeight: 18, fontFamily: fontFamily.regular, color: colors.textTertiary } as const;

// --- Header ------------------------------------------------------------------

export interface HeaderStat { value: number | string; label: string; onPress?: () => void }

export function ProfileHeader({
  userId, profile, user, stats, actions, onEditCover, onEditAvatar,
}: {
  userId: string;
  profile: any;
  user?: any;
  stats: HeaderStat[];
  actions: ReactNode;
  onEditCover?: () => void;
  onEditAvatar?: () => void;
}) {
  const name = nameOf(profile, user);
  const cover = assetUri(profile?.coverUrl);

  return (
    <View style={{ marginHorizontal: GUTTER, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
      {/* The cover photo, or the web's soft primary → accent gradient when there isn't one. */}
      <View style={{ height: 120 }}>
        {cover
          ? <Image source={{ uri: assetUri(cover)! }} style={{ width: "100%", height: 120 }} resizeMode="cover" />
          : <LinearGradient colors={["#EADCF0", "#F1EEFF", "#EADCF0"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ height: 120 }} />}
        {onEditCover && (
          <Pressable onPress={onEditCover} accessibilityLabel="Change cover photo" hitSlop={8}
            style={({ pressed }) => [{ position: "absolute", top: spacing.sm, right: spacing.sm, width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.7 }]}>
            <Icon name="camera-outline" size={17} color={colors.text} />
          </Pressable>
        )}
      </View>

      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
        <Pressable onPress={onEditAvatar} disabled={!onEditAvatar} style={{ marginTop: -48, alignSelf: "flex-start" }} accessibilityLabel="Change profile photo">
          <View style={{ borderRadius: 52, borderWidth: 4, borderColor: colors.surface }}>
            <Avatar name={name} uri={profile?.avatarUrl ?? user?.profileImageUrl} size={96} />
          </View>
          {onEditAvatar && (
            <View style={{ position: "absolute", right: 4, bottom: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
              <Icon name="camera" size={13} color="#FFFFFF" />
            </View>
          )}
        </Pressable>

        <View style={{ marginTop: spacing.sm, gap: 3 }}>
          <Row center gap={spacing.sm} wrap>
            <Text style={{ fontSize: font.xl, fontFamily: fontFamily.bold, color: colors.text, letterSpacing: -0.3, flexShrink: 1 }}>{name}</Text>
            {profile?.experienceLevel ? (
              <Pill label={profile.experienceLevel.charAt(0).toUpperCase() + profile.experienceLevel.slice(1)} />
            ) : null}
          </Row>
          {profile?.username ? <Text style={{ fontSize: font.sm, fontFamily: fontFamily.regular, color: colors.textTertiary }}>@{profile.username}</Text> : null}
          {profile?.headline && profile?.displayName ? (
            <Text style={{ fontSize: font.base, lineHeight: 21, fontFamily: fontFamily.regular, color: colors.textSecondary }}>{profile.headline}</Text>
          ) : null}
          <View style={{ marginTop: 2 }}><PinnedBadgesRow userId={userId} /></View>
          {profile?.location ? (
            <Row center gap={4} style={{ marginTop: 2 }}>
              <Icon name="location-outline" size={15} color={colors.textTertiary} />
              <Text style={{ fontSize: font.sm, fontFamily: fontFamily.regular, color: colors.textTertiary }}>{profile.location}</Text>
            </Row>
          ) : null}
        </View>

        {stats.length > 0 && (
          <View style={{ flexDirection: "row", marginTop: spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.borderSubtle, paddingVertical: spacing.sm }}>
            {stats.map((st, i) => (
              <Pressable key={st.label} onPress={st.onPress} disabled={!st.onPress}
                style={({ pressed }) => [{ flex: 1, alignItems: "center", gap: 1 }, i > 0 && { borderLeftWidth: 1, borderColor: colors.borderSubtle }, pressed && { opacity: 0.6 }]}>
                <Text style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color: colors.text }}>{st.value}</Text>
                <Text style={{ fontSize: font.xs, fontFamily: fontFamily.medium, color: colors.textTertiary }}>{st.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ marginTop: spacing.md }}>{actions}</View>
      </View>
    </View>
  );
}

// --- Looking for -------------------------------------------------------------

function Fact({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={{ gap: 1, minWidth: "45%", flexGrow: 1 }}>
      <Row center gap={3}>
        <Icon name={icon} size={10} color={colors.textTertiary} />
        <Text style={overline}>{label}</Text>
      </Row>
      <Text style={bodyText}>{value}</Text>
    </View>
  );
}
const overline = { fontSize: 10, fontFamily: fontFamily.semibold, color: colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.5 } as const;

/** The public ask. Visitors see it only while it's switched on; the owner always sees it, or the prompt to add one. */
export function LookingForCard({ lookingFor, isOwn }: { lookingFor: any; isOwn: boolean }) {
  const router = useRouter();
  const edit = () => router.push("/profile/looking-for");

  if (!lookingFor || (!lookingFor.isActive && !isOwn)) {
    if (!isOwn) return null;
    return (
      <PCard dashed style={{ backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md + 2 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>Looking for someone?</Text>
          <Text style={mutedText}>Post what you need — a cofounder, a first engineer, a project to join.</Text>
        </View>
        <OutlineButton label="Add" icon="add" onPress={edit} />
      </PCard>
    );
  }

  return (
    <PCard tone="primary" style={{ padding: spacing.md + 2 }}>
      <Row gap={spacing.sm + 2} style={{ alignItems: "flex-start" }}>
        <View style={{ width: 32, height: 32, borderRadius: radius.sm, backgroundColor: "#EBD9F2", alignItems: "center", justifyContent: "center" }}>
          <Icon name="hand-left-outline" size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.primary, textTransform: "uppercase", letterSpacing: 0.5 }}>Looking for</Text>
          <Text style={{ fontSize: font.base, fontFamily: fontFamily.semibold, color: colors.text }}>{lookingFor.role}</Text>
        </View>
        {isOwn && (
          <Row center gap={4}>
            {!lookingFor.isActive && <Pill label="Hidden" icon="eye-off-outline" variant="secondary" />}
            <Pressable onPress={edit} hitSlop={8} accessibilityLabel="Edit what you're looking for" style={{ padding: 4 }}>
              <Icon name="pencil" size={15} color={colors.textSecondary} />
            </Pressable>
          </Row>
        )}
      </Row>

      <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: spacing.sm, columnGap: spacing.sm }}>
        {(lookingFor.industries?.length ?? 0) > 0 && (
          <View style={{ width: "100%", gap: 4 }}>
            <Text style={overline}>Industry</Text>
            <Row wrap gap={4}>{lookingFor.industries.map((i: string) => <Pill key={i} label={i} />)}</Row>
          </View>
        )}
        {lookingFor.commitment ? <Fact icon="time-outline" label="Commitment" value={lookingFor.commitment} /> : null}
        {lookingFor.stage ? <Fact icon="layers-outline" label="Stage" value={lookingFor.stage} /> : null}
        {lookingFor.equityAvailable === true || lookingFor.equityAvailable === false ? (
          <Fact icon="pie-chart-outline" label="Equity" value={lookingFor.equityAvailable ? "Available" : "Not available"} />
        ) : null}
      </View>

      {lookingFor.details ? (
        <Text style={[bodyText, { color: colors.textSecondary, borderTopWidth: 1, borderColor: "#E3CCEC", paddingTop: spacing.sm }]}>{lookingFor.details}</Text>
      ) : null}
    </PCard>
  );
}

// --- Résumé panel ------------------------------------------------------------

/** The owner's prompt to let Nova fill the profile from a résumé. The review happens on the builder screen. */
export function ResumePanel({ hasContent }: { hasContent: boolean }) {
  const router = useRouter();
  const ent = useEntitlementsQuery();
  const { data: status } = useQuery({ queryKey: ["resume-status"], queryFn: () => api<any>("/api/profile/resume-status") });
  const cost: number = ent.creditCosts?.resumeEvaluation ?? 4;
  const cantAfford = !ent.isLoading && !ent.isUnlimited && ent.creditsRemaining < cost;

  return (
    <PCard tone="primary" dashed style={{ padding: spacing.md + 2 }}>
      <Row gap={spacing.sm + 2} style={{ alignItems: "flex-start" }}>
        <View style={{ width: 32, height: 32, borderRadius: radius.sm, backgroundColor: "#EBD9F2", alignItems: "center", justifyContent: "center" }}>
          <Icon name="color-wand-outline" size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>
            {hasContent ? "Refresh your profile with Nova" : "Let Nova build your profile"}
          </Text>
          <Text style={mutedText}>
            {status?.hasResume && status.readable
              ? "Nova reads the résumé on your profile and fills in your experience, education, projects, and skills."
              : "Upload your résumé and Nova fills in your experience, education, projects, and skills."}
          </Text>
        </View>
      </Row>
      <Pressable onPress={() => router.push("/profile-builder")} disabled={cantAfford}
        style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 8 }, (pressed || cantAfford) && { opacity: 0.6 }]}>
        <Icon name="sparkles" size={14} color="#FFFFFF" />
        <Text style={{ color: "#FFFFFF", fontSize: font.sm, fontFamily: fontFamily.semibold }}>{hasContent ? "Re-run" : "Build my profile"}</Text>
        <View style={{ backgroundColor: "rgba(255,255,255,0.25)", borderRadius: radius.pill, paddingHorizontal: 6 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 10, fontFamily: fontFamily.bold }}>{cost}</Text>
        </View>
      </Pressable>
      {cantAfford && <Text style={[mutedText, { color: colors.danger }]}>Needs {cost} credits, you have {ent.creditsRemaining}.</Text>}
    </PCard>
  );
}

// --- About ---------------------------------------------------------------------

function LinkRow({ icon, label, url }: { icon: IconName; label: string; url: string }) {
  const href = url.startsWith("/") ? assetUri(url)! : /^https?:\/\//.test(url) ? url : `https://${url}`;
  return (
    <Pressable onPress={() => Linking.openURL(href).catch(() => {})} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.sm }, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={16} color={colors.textSecondary} />
      <Text style={{ fontSize: font.sm, fontFamily: fontFamily.regular, color: colors.textSecondary, flexShrink: 1 }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function AboutCard({ profile, isOwn }: { profile: any; isOwn: boolean }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const bio: string = profile?.bio || "";
  const long = bio.length > 320;
  const links = [
    profile?.githubUrl && { icon: "logo-github" as IconName, label: "GitHub Profile", url: profile.githubUrl },
    profile?.linkedinUrl && { icon: "logo-linkedin" as IconName, label: "LinkedIn Profile", url: profile.linkedinUrl },
    profile?.websiteUrl && { icon: "globe-outline" as IconName, label: "Portfolio Website", url: profile.websiteUrl },
    profile?.resumeUrl && { icon: "document-text-outline" as IconName, label: "Resume", url: profile.resumeUrl },
  ].filter(Boolean) as { icon: IconName; label: string; url: string }[];

  return (
    <PCard>
      <CardTitle action={isOwn ? "Edit" : undefined} actionIcon="pencil" onAction={() => router.push("/profile/edit")}>About</CardTitle>
      <Pressable onPress={() => setExpanded((v) => !v)} disabled={!long}>
        <Text style={bodyText} numberOfLines={expanded || !long ? undefined : 6}>{bio || "No bio yet."}</Text>
        {long && !expanded && <Text style={{ color: colors.textSecondary, fontFamily: fontFamily.semibold, fontSize: font.sm, marginTop: 2 }}>…see more</Text>}
      </Pressable>
      {links.length > 0 && <View style={{ gap: spacing.sm, paddingTop: 2 }}>{links.map((l) => <LinkRow key={l.label} {...l} />)}</View>}
    </PCard>
  );
}

// --- Résumé credentials ---------------------------------------------------------

/** Nova's read, skills, experience, education and other work. Each hides when empty. */
export function Credentials({ profile }: { profile: any }) {
  const exp: any[] = profile?.experience ?? [];
  const edu: any[] = profile?.education ?? [];
  const work: any[] = profile?.portfolioProjects ?? [];
  const skills: string[] = profile?.skills ?? [];

  return (
    <>
      {profile?.novaSummary ? (
        <PCard tone="primary" style={{ padding: spacing.md + 2, gap: 6 }}>
          <Row center gap={6}>
            <Icon name="sparkles" size={12} color={colors.primary} />
            <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.primary, textTransform: "uppercase", letterSpacing: 0.5 }}>Nova's read</Text>
          </Row>
          <Text style={bodyText}>{profile.novaSummary}</Text>
        </PCard>
      ) : null}

      {skills.length > 0 && (
        <PCard>
          <CardTitle icon="construct-outline">Skills</CardTitle>
          <Row wrap gap={6}>{skills.map((s) => <SoftChip key={s} label={s} />)}</Row>
        </PCard>
      )}

      {exp.length > 0 && (
        <PCard>
          <CardTitle icon="briefcase-outline">Experience</CardTitle>
          <View style={{ gap: spacing.lg }}>
            {exp.map((e, i) => (
              <View key={i} style={{ paddingLeft: spacing.lg, borderLeftWidth: 2, borderColor: colors.border, gap: 1 }}>
                <View style={{ position: "absolute", left: -5, top: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} />
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{e.title}</Text>
                {e.company ? <Text style={[bodyText, { color: colors.textSecondary }]}>{e.company}</Text> : null}
                <Text style={mutedText}>
                  {[e.startDate, e.current ? "Present" : e.endDate].filter(Boolean).join(" – ") || "—"}
                  {e.location ? ` · ${e.location}` : ""}
                </Text>
                {e.description ? <Text style={[mutedText, { marginTop: 4 }]}>{e.description}</Text> : null}
                {(e.skills?.length ?? 0) > 0 && (
                  <Row wrap gap={4} style={{ marginTop: 6 }}>{e.skills.map((s: string) => <Pill key={s} label={s} />)}</Row>
                )}
              </View>
            ))}
          </View>
        </PCard>
      )}

      {edu.length > 0 && (
        <PCard>
          <CardTitle icon="school-outline">Education</CardTitle>
          <View style={{ gap: spacing.md }}>
            {edu.map((e, i) => (
              <View key={i} style={{ gap: 1 }}>
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{e.school}</Text>
                {e.degree || e.field ? <Text style={[bodyText, { color: colors.textSecondary }]}>{[e.degree, e.field].filter(Boolean).join(", ")}</Text> : null}
                {e.startYear || e.endYear ? <Text style={mutedText}>{[e.startYear, e.endYear].filter(Boolean).join(" – ")}</Text> : null}
                {e.description ? <Text style={[mutedText, { marginTop: 4 }]}>{e.description}</Text> : null}
              </View>
            ))}
          </View>
        </PCard>
      )}

      {work.length > 0 && (
        <PCard>
          <CardTitle icon="folder-open-outline">Other work</CardTitle>
          <View style={{ gap: spacing.md }}>
            {work.map((p, i) => (
              <View key={i} style={{ gap: 1 }}>
                <Row center gap={6}>
                  <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text, flexShrink: 1 }}>{p.name}</Text>
                  {p.url ? (
                    <Pressable hitSlop={8} accessibilityLabel={`Open ${p.name}`} onPress={() => Linking.openURL(/^https?:\/\//.test(p.url) ? p.url : `https://${p.url}`).catch(() => {})}>
                      <Icon name="open-outline" size={13} color={colors.textTertiary} />
                    </Pressable>
                  ) : null}
                </Row>
                {p.role ? <Text style={[mutedText, { color: colors.textSecondary }]}>{p.role}</Text> : null}
                {p.description ? <Text style={[mutedText, { marginTop: 2 }]}>{p.description}</Text> : null}
                {(p.technologies?.length ?? 0) > 0 && (
                  <Row wrap gap={4} style={{ marginTop: 6 }}>{p.technologies.map((t: string) => <Pill key={t} label={t} />)}</Row>
                )}
              </View>
            ))}
          </View>
        </PCard>
      )}

      {profile?.resumeParsedAt ? (
        <Text style={{ fontSize: 10, fontFamily: fontFamily.regular, color: colors.textTertiary, paddingHorizontal: GUTTER + 4, marginTop: -spacing.xs }}>
          Profile built from résumé {new Date(profile.resumeParsedAt).toLocaleDateString()}
        </Text>
      ) : null}
    </>
  );
}

/** The web's secondary Badge, which wraps long résumé skills instead of overflowing. */
function SoftChip({ label, tint }: { label: string; tint?: boolean }) {
  return (
    <View style={{ backgroundColor: tint ? "#F1EEFF" : colors.surfaceRaised, borderWidth: 1, borderColor: tint ? "#E2DBFF" : colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, maxWidth: "100%" }}>
      <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: colors.text }}>{label}</Text>
    </View>
  );
}

export function InterestsCard({ interests }: { interests?: string[] | null }) {
  if (!interests?.length) return null;
  return (
    <PCard>
      <CardTitle>Interests</CardTitle>
      <Row wrap gap={6}>{interests.map((i) => <SoftChip key={i} label={i} tint />)}</Row>
    </PCard>
  );
}

// --- Posts ---------------------------------------------------------------------

/** "Your posts" / "Maya's posts": the feed card, as on the web, with a way to post on your own. */
export function PostsSection({ userId, isOwn, firstName, avatarUri, myName, onCompose, notify }: {
  userId: string; isOwn: boolean; firstName: string; avatarUri?: string | null; myName: string;
  onCompose?: () => void; notify: (n: Notice) => void;
}) {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ["feed", "author", userId],
    queryFn: () => api<{ posts: any[] }>(`/api/feed?authorId=${encodeURIComponent(userId)}&limit=10`),
  });
  const posts = data?.posts ?? [];

  return (
    <>
      <Heading>{isOwn ? "Your posts" : `${firstName}'s posts`}</Heading>
      {isOwn && onCompose && (
        <PCard style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md }}>
          <Avatar name={myName} uri={avatarUri} size={40} />
          <Pressable onPress={onCompose} accessibilityLabel="Start a post"
            style={({ pressed }) => [{ flex: 1, borderWidth: 1, borderColor: colors.textTertiary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 10 }, pressed && { backgroundColor: colors.surfaceRaised }]}>
            <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.textSecondary }}>Start a post</Text>
          </Pressable>
          <Pressable onPress={onCompose} hitSlop={6} accessibilityLabel="Add a photo"><Icon name="image-outline" size={22} color={colors.info} /></Pressable>
        </PCard>
      )}
      {isLoading ? (
        <PCard><Meta>Loading posts…</Meta></PCard>
      ) : posts.length === 0 ? (
        <EmptyCard icon="newspaper-outline" text={isOwn ? "You haven't posted yet. Share an update, ask for help, or announce a milestone." : "No posts yet."} />
      ) : (
        <>
          {posts.map((post) => (
            <View key={post.id} style={{ marginHorizontal: GUTTER - spacing.sm }}>
              <PostCard post={post} onNotice={notify} />
            </View>
          ))}
          {posts.length >= 10 && (
            <OutlineButton label="See the whole feed" onPress={() => router.push("/(tabs)/feed")} style={{ marginHorizontal: GUTTER }} />
          )}
        </>
      )}
    </>
  );
}

// --- Projects --------------------------------------------------------------------

const STATUS_ACTIVE = "active";

/** The web's ProjectCard: title and status, the description, roles or Solo Builder, the owner, views and donations. */
export function ProjectCardLite({ project, ownerName, ownerAvatar }: { project: any; ownerName: string; ownerAvatar?: string | null }) {
  const router = useRouter();
  const roles: string[] = project.soloMode ? [] : (project.rolesNeeded ?? []);
  return (
    <PCard onPress={() => router.push(`/project/${project.id}`)} style={{ gap: spacing.sm }}>
      <Row between style={{ alignItems: "flex-start" }}>
        <Row center gap={6} style={{ flex: 1 }}>
          {project.isPrivate && <Icon name="lock-closed" size={14} color={colors.textTertiary} />}
          <Text style={{ fontSize: font.lg + 1, fontFamily: fontFamily.bold, color: colors.text, flexShrink: 1 }} numberOfLines={1}>{project.title}</Text>
        </Row>
        {project.status ? <Pill label={project.status} variant={project.status === STATUS_ACTIVE ? "default" : "secondary"} /> : null}
      </Row>
      <Text style={[bodyText, { color: colors.textSecondary, minHeight: 40 }]} numberOfLines={2}>{project.description || project.oneLiner || ""}</Text>
      <Row wrap gap={4} center>
        {project.soloMode ? (
          <Pill label="Solo Builder" icon="rocket-outline" color={colors.primary} />
        ) : (
          <>
            {roles.slice(0, 3).map((r) => <Pill key={r} label={r} variant="secondary" />)}
            {roles.length > 3 && <Meta>+{roles.length - 3} more</Meta>}
          </>
        )}
      </Row>
      <Row between>
        <Row center gap={spacing.sm} style={{ flex: 1 }}>
          <Avatar name={ownerName} uri={ownerAvatar} size={24} />
          <Text style={{ fontSize: font.sm, fontFamily: fontFamily.regular, color: colors.textSecondary, flexShrink: 1 }} numberOfLines={1}>{ownerName}</Text>
        </Row>
        <Row center gap={spacing.md}>
          <Row center gap={3}><Icon name="eye-outline" size={15} color={colors.textTertiary} /><Meta style={{ fontSize: font.sm }}>{project.views ?? 0}</Meta></Row>
          <Row center gap={1}><Icon name="logo-usd" size={14} color={colors.textTertiary} /><Meta style={{ fontSize: font.sm }}>{(project.totalDonations ?? 0) / 100}</Meta></Row>
        </Row>
      </Row>
    </PCard>
  );
}

/**
 * Projects on the About tab ("Building", up to four) or the Projects tab (all).
 * The copy for an empty list differs between them on the web, so it does here.
 */
export function ProjectsSection({ projects, isOwn, loading, ownerName, ownerAvatar, full }: {
  projects: any[]; isOwn: boolean; loading?: boolean; ownerName: string; ownerAvatar?: string | null; full?: boolean;
}) {
  const router = useRouter();
  const newProject = () => router.push("/project/new");
  const shown = full ? projects : projects.slice(0, 4);
  return (
    <>
      <Heading action={isOwn ? (full ? "New Project" : "New project") : undefined} onAction={newProject}>
        {full ? "Projects" : projects.length > 0 ? "Building" : "Projects"}
      </Heading>
      {loading ? (
        <PCard><Meta>Loading projects…</Meta></PCard>
      ) : shown.length > 0 ? (
        shown.map((p) => <ProjectCardLite key={p.id} project={p} ownerName={p.profile?.displayName || ownerName} ownerAvatar={p.profile?.avatarUrl ?? ownerAvatar} />)
      ) : full ? (
        <EmptyCard text="No projects yet." action={isOwn ? "Create your first project" : undefined} onAction={newProject} />
      ) : (
        <EmptyCard text={isOwn ? "You're not building anything yet." : "Nothing public yet."} action={isOwn ? "Start your first project" : undefined} onAction={newProject} />
      )}
    </>
  );
}

// --- Builder Reputation Index ------------------------------------------------------

const SCORES: { key: string; label: string; icon: IconName; color: string; hint: string }[] = [
  { key: "executionScore", label: "Execution", icon: "flash", color: "#F59E0B", hint: "Based on milestones completed, deadlines met, sprint consistency, and project completion rate" },
  { key: "contributionScore", label: "Contribution", icon: "people", color: "#3B82F6", hint: "Based on projects involved in, tasks completed, projects followed, and solo build completions" },
  { key: "marketSignalScore", label: "Market Signal", icon: "trending-up", color: "#10B981", hint: "Based on donations received, project applications, build log engagement, and external traction" },
  { key: "strategicThinkingScore", label: "Strategic Thinking", icon: "bulb", color: "#A855F7", hint: "Based on contest wins and AI evaluation of project strategies" },
];

function tierOf(score: number) {
  if (score >= 80) return { label: "Elite", color: "#F59E0B" };
  if (score >= 60) return { label: "Advanced", color: "#A855F7" };
  if (score >= 40) return { label: "Rising", color: "#3B82F6" };
  if (score >= 20) return { label: "Emerging", color: "#10B981" };
  return { label: "New Builder", color: colors.textTertiary };
}

export function ReputationCard({ userId, isOwn, notify }: { userId: string; isOwn: boolean; notify: (n: Notice) => void }) {
  const qc = useQueryClient();
  const [hint, setHint] = useState<string | null>(null);
  const { data: rep, isLoading } = useQuery({ queryKey: ["reputation", userId], queryFn: () => api<any>(`/api/reputation/${userId}`) });
  const calc = useMutation({
    mutationFn: () => api("/api/reputation/calculate", { method: "POST" }),
    onSuccess: () => {
      notify({ text: "Reputation updated. Your Builder Index has been recalculated.", tone: "success" });
      void qc.invalidateQueries({ queryKey: ["reputation", userId] });
      void qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e: any) => notify({ text: e?.message || "Could not calculate reputation", tone: "error" }),
  });

  if (isLoading) return <PCard style={{ alignItems: "center" }}><Meta>Loading…</Meta></PCard>;
  const index = rep?.builderIndex ?? 0;
  const tier = tierOf(index);

  return (
    <PCard style={{ gap: spacing.lg }}>
      <StrongTitle icon="trophy-outline" iconColor={colors.primary}>Builder Reputation Index</StrongTitle>
      <Row center gap={spacing.lg}>
        <View style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 2, borderColor: "#E6D3EE", backgroundColor: "#FAF5FC", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 28, fontFamily: fontFamily.bold, color: colors.primary }}>{index}</Text>
        </View>
        <View style={{ gap: 4 }}>
          <Pill label={tier.label} color={tier.color} style={{ paddingVertical: 2 }} />
          <Meta>out of 100</Meta>
        </View>
        {isOwn && (
          <OutlineButton label={calc.isPending ? "Calculating..." : "Recalculate"} icon="refresh" disabled={calc.isPending}
            onPress={() => calc.mutate()} style={{ marginLeft: "auto" }} />
        )}
      </Row>
      <View style={{ gap: spacing.md }}>
        {SCORES.map((s) => (
          <View key={s.key} style={{ gap: 5 }}>
            <Row between>
              <Row center gap={spacing.sm}>
                <Icon name={s.icon} size={15} color={s.color} />
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{s.label}</Text>
                <Pressable hitSlop={8} onPress={() => setHint(hint === s.key ? null : s.key)} accessibilityLabel={`What ${s.label} means`}>
                  <Icon name="information-circle-outline" size={14} color={colors.textTertiary} />
                </Pressable>
              </Row>
              <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{rep?.[s.key] ?? 0}</Text>
            </Row>
            <Progress value={rep?.[s.key] ?? 0} />
            {hint === s.key && <Meta>{s.hint}</Meta>}
          </View>
        ))}
      </View>
      {rep?.details ? (
        <Text style={[mutedText, { borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm }]}>
          {rep.lastCalculatedAt ? `Last updated: ${new Date(rep.lastCalculatedAt).toLocaleDateString()}` : "Not yet calculated"}
        </Text>
      ) : null}
      {!rep?.builderIndex && isOwn && (
        <View style={{ alignItems: "center", gap: spacing.sm }}>
          <Text style={[mutedText, { fontSize: font.sm, textAlign: "center" }]}>Calculate your Builder Reputation Index to see your scores</Text>
          <Btn label="Calculate Now (1 credit)" icon="flash" small loading={calc.isPending} onPress={() => calc.mutate()} />
        </View>
      )}
    </PCard>
  );
}

