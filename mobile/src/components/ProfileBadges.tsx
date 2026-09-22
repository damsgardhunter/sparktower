/**
 * Badges on a profile: the pinned medals under a name, the showcase with its
 * picker, the platform badges someone has earned, and the projects they've
 * believed in.
 *
 * The native side of client/src/components/pinned-badges.tsx,
 * backer-badge-showcase.tsx and backer-credits.tsx, against the same endpoints.
 * The badge levels are restated from shared/backing.ts — Metro can't resolve
 * the web app's shared folder.
 */
import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "../api/client";
import { colors, font, fontFamily, novaGradient, radius, spacing } from "../theme";
import { assetUri, Body, Btn, Icon, Meta, Row, type IconName } from "./ui";
import { Sheet, type Notice } from "./Sheet";
import { CardTitle, OutlineButton, PCard, Pill } from "./profile/kit";

// --- Restated from shared/backing.ts --------------------------------------

const BADGE_LEVELS = [
  { key: "bronze", label: "Bronze", minCents: 500, hex: "#a8672a" },
  { key: "silver", label: "Silver", minCents: 1500, hex: "#9aa3ad" },
  { key: "gold", label: "Gold", minCents: 3500, hex: "#c9962a" },
  { key: "platinum", label: "Platinum", minCents: 7500, hex: "#8f9bb3" },
] as const;
const MAX_SHOWCASE_BADGES = 5;
const isCreatorBadge = (level: string) => level === "founder";
const levelLabel = (level: string) => isCreatorBadge(level) ? "Creator" : BADGE_LEVELS.find((l) => l.key === level)?.label ?? level;
const levelHex = (level: string) => BADGE_LEVELS.find((l) => l.key === level)?.hex ?? BADGE_LEVELS[0].hex;
export const formatBelieverNumber = (n: number) => `#${String(n).padStart(4, "0")}`;

export interface BackerBadgeRow {
  id: string;
  projectId: string;
  projectTitle: string;
  projectLogo?: string | null;
  level: string;
  imageUrl: string | null;
  believerNumber?: number | null;
  foundingBeliever?: boolean;
  status?: "pending" | "ready" | "failed";
  showcaseOrder?: number | null;
}

/** The pinned set, under the same key everywhere on the phone. */
export function usePinnedBadges(userId?: string | null) {
  return useQuery({
    queryKey: ["user-badges-backer", userId],
    queryFn: () => api<BackerBadgeRow[]>(`/api/users/${userId}/badges/backer`).catch(() => [] as BackerBadgeRow[]),
    enabled: !!userId,
    staleTime: 60_000,
  });
}

const initialsOf = (title: string) => title.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/** One badge as a round medal: Nova's ring for a creator badge, its metal for a backer's. */
export function BadgeMedal({ level, imageUrl, projectTitle, size }: {
  level: string; imageUrl: string | null; projectTitle: string; size: number;
}) {
  const uri = assetUri(imageUrl);
  const inner = size - 4;
  if (isCreatorBadge(level)) {
    return (
      <LinearGradient colors={[...novaGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ width: size, height: size, borderRadius: size / 2, padding: 2 }}>
        <View style={{ width: inner, height: inner, borderRadius: inner / 2, overflow: "hidden", backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
          {uri
            ? <Image source={{ uri }} style={{ width: inner, height: inner }} resizeMode="contain" />
            : (
              <LinearGradient colors={[...novaGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ width: inner, height: inner, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#FFFFFF", fontFamily: fontFamily.bold, fontSize: Math.max(8, size * 0.32) }}>{initialsOf(projectTitle)}</Text>
              </LinearGradient>
            )}
        </View>
      </LinearGradient>
    );
  }
  const hex = levelHex(level);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: hex, overflow: "hidden", backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
      {uri
        ? <Image source={{ uri }} style={{ width: size - 4, height: size - 4 }} resizeMode="contain" />
        : <Text style={{ color: hex, fontFamily: fontFamily.semibold, fontSize: Math.max(8, size * 0.3) }}>{initialsOf(projectTitle)}</Text>}
    </View>
  );
}

/** The row of small medals next to a name. Nothing when nothing is pinned. */
export function PinnedBadgesRow({ userId, size = 26, max = 5 }: { userId?: string | null; size?: number; max?: number }) {
  const router = useRouter();
  const { data } = usePinnedBadges(userId);
  const badges = (data ?? []).slice(0, max);
  if (!badges.length) return null;
  return (
    <Row gap={6} center>
      {badges.map((b) => (
        <Pressable key={b.id} onPress={() => router.push(`/project/${b.projectId}`)} hitSlop={4}
          accessibilityLabel={`${levelLabel(b.level)} badge for ${b.projectTitle}`}>
          <BadgeMedal level={b.level} imageUrl={b.imageUrl} projectTitle={b.projectTitle} size={size} />
        </Pressable>
      ))}
    </Row>
  );
}

function BadgeTile({ badge, size = 64 }: { badge: BackerBadgeRow; size?: number }) {
  return (
    <View style={{ alignItems: "center", gap: 3, width: size + 16 }}>
      <BadgeMedal level={badge.level} imageUrl={badge.imageUrl} projectTitle={badge.projectTitle} size={size} />
      <Text numberOfLines={1} style={{ fontSize: font.xs, fontFamily: fontFamily.medium, color: colors.text, textAlign: "center" }}>{badge.projectTitle}</Text>
      <Text style={{ fontSize: 10, fontFamily: fontFamily.semibold, color: isCreatorBadge(badge.level) ? colors.novaEmerald : levelHex(badge.level) }}>
        {levelLabel(badge.level)}{badge.believerNumber != null ? ` ${formatBelieverNumber(badge.believerNumber)}` : ""}
      </Text>
    </View>
  );
}

/** Pinned badges, and for the owner the picker. A visitor sees nothing when nothing is pinned. */
export function BadgeShowcase({ userId, isOwn, notify }: { userId: string; isOwn: boolean; notify: (n: Notice) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const { data: pinned } = usePinnedBadges(userId);
  const { data: mine } = useQuery({
    queryKey: ["me-badges"],
    queryFn: () => api<BackerBadgeRow[]>("/api/me/badges"),
    enabled: isOwn,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["user-badges-backer", userId] });
    void qc.invalidateQueries({ queryKey: ["me-badges"] });
  };

  const generate = useMutation({
    mutationFn: (badgeId: string) => api(`/api/backer-badges/${badgeId}/generate`, { method: "POST" }),
    onSuccess: () => { notify({ text: "Badge made.", tone: "success" }); refresh(); },
    onError: (e: any) => notify({ text: e?.message || "Couldn't make that badge. Try again in a moment.", tone: "error" }),
  });

  const save = useMutation({
    mutationFn: (badgeIds: string[]) => api("/api/me/badges/showcase", { method: "PUT", body: { badgeIds } }),
    onSuccess: () => { notify({ text: "Profile updated", tone: "success" }); setPicking(false); refresh(); },
    onError: () => notify({ text: "Couldn't save that", tone: "error" }),
  });

  const hasAny = (pinned?.length ?? 0) > 0;
  const earned = mine?.length ?? 0;
  const creatorsToMake = (mine ?? []).filter((b) => isCreatorBadge(b.level) && b.status !== "ready").length;
  if (!hasAny && !isOwn) return null;

  return (
    <PCard>
      <CardTitle icon="sparkles" iconColor={colors.primary} action={isOwn && earned > 0 ? "Choose" : undefined} actionIcon="options-outline" onAction={() => setPicking(true)}>
        Badges
      </CardTitle>
      {isOwn && creatorsToMake > 0 && (
        <Pressable onPress={() => setPicking(true)}>
          <LinearGradient colors={[...novaGradient]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ borderRadius: radius.sm, padding: 1.5 }}>
            <View style={{ backgroundColor: colors.background, borderRadius: radius.sm - 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
              <Text style={{ fontSize: font.xs + 1, lineHeight: 18, fontFamily: fontFamily.regular, color: colors.textTertiary }}>
                <Text style={{ fontFamily: fontFamily.semibold, color: colors.text }}>Generate your creator badge{creatorsToMake === 1 ? "" : "s"}</Text>
                {` — ${creatorsToMake} project${creatorsToMake === 1 ? "" : "s"} you created, in Nova's colours. It's what shows next to your name.`}
              </Text>
            </View>
          </LinearGradient>
        </Pressable>
      )}
      {hasAny ? (
        <Row wrap gap={spacing.md}>
          {pinned!.map((b) => (
            <Pressable key={b.id} onPress={() => router.push(`/project/${b.projectId}`)}>
              <BadgeTile badge={b} />
            </Pressable>
          ))}
        </Row>
      ) : earned > 0 ? (
        <Meta style={{ fontSize: font.xs + 1 }}>You've earned {earned} badge{earned === 1 ? "" : "s"} — pick which to show.</Meta>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Row gap={spacing.sm}>
            {BADGE_LEVELS.map((l) => (
              <View key={l.key} style={{ alignItems: "center", gap: 4 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: l.hex, backgroundColor: `${l.hex}22`, opacity: 0.45 }} />
                <Text style={{ fontSize: 9, fontFamily: fontFamily.regular, color: colors.textTertiary }}>{l.label}</Text>
              </View>
            ))}
          </Row>
          <Text style={{ fontSize: font.xs + 1, lineHeight: 18, fontFamily: fontFamily.regular, color: colors.textTertiary }}>
            Create a public project and you get a creator badge in Nova's colours. Back one and you earn a badge for it — bronze at ${BADGE_LEVELS[0].minCents / 100},
            up to platinum at ${BADGE_LEVELS[3].minCents / 100}. Nova builds the artwork from that project's logo. Pin up to {MAX_SHOWCASE_BADGES} here.
          </Text>
          <OutlineButton label="Find a project to back" icon="search" style={{ alignSelf: "flex-start" }} onPress={() => router.push("/(tabs)/discover")} />
        </View>
      )}

      {isOwn && picking && (
        <BadgePicker
          badges={mine ?? []}
          onClose={() => setPicking(false)}
          onGenerate={(id) => generate.mutate(id)}
          generatingId={generate.isPending ? (generate.variables as string) : null}
          onSave={(ids) => save.mutate(ids)}
          saving={save.isPending}
        />
      )}
    </PCard>
  );
}

function BadgePicker({ badges, onClose, onGenerate, generatingId, onSave, saving }: {
  badges: BackerBadgeRow[];
  onClose: () => void;
  onGenerate: (id: string) => void;
  generatingId: string | null;
  onSave: (ids: string[]) => void;
  saving: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(() =>
    badges.filter((b) => b.showcaseOrder != null)
      .sort((a, b) => (a.showcaseOrder ?? 0) - (b.showcaseOrder ?? 0))
      .map((b) => b.id));
  const toggle = (id: string) => setSelected((cur) =>
    cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_SHOWCASE_BADGES ? cur : [...cur, id]);

  return (
    <Sheet visible onClose={onClose} title="Badges on your profile" subtitle={`Pick up to ${MAX_SHOWCASE_BADGES}. They show in the order you tap them.`}>
      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.sm }}>
        {badges.map((b) => {
          const rank = selected.indexOf(b.id);
          return (
            <Pressable key={b.id} onPress={() => toggle(b.id)}
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: rank >= 0 ? colors.primary : colors.border }}>
              <BadgeMedal level={b.level} imageUrl={b.imageUrl} projectTitle={b.projectTitle} size={48} />
              <View style={{ flex: 1, gap: 2 }}>
                <Body style={{ fontFamily: fontFamily.semibold }} numberOfLines={1}>{b.projectTitle}</Body>
                <Meta>
                  {levelLabel(b.level)}
                  {b.foundingBeliever ? " · Founding believer" : ""}
                  {b.believerNumber != null ? ` · ${formatBelieverNumber(b.believerNumber)}` : ""}
                </Meta>
                {b.status !== "ready" && (
                  <Btn small variant="outline" icon="sparkles" style={{ alignSelf: "flex-start", marginTop: 4 }}
                    loading={generatingId === b.id}
                    label={b.status === "failed" ? "Try again" : isCreatorBadge(b.level) ? "Generate creator badge" : "Make the artwork"}
                    onPress={() => onGenerate(b.id)} />
                )}
              </View>
              {rank >= 0
                ? <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#FFFFFF", fontFamily: fontFamily.bold, fontSize: font.sm }}>{rank + 1}</Text>
                  </View>
                : <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: colors.border }} />}
            </Pressable>
          );
        })}
      </ScrollView>
      <Row gap={spacing.sm}>
        <Btn label="Cancel" variant="ghost" small onPress={onClose} />
        <Btn label={`Show ${selected.length}`} small loading={saving} onPress={() => onSave(selected)} />
      </Row>
    </Sheet>
  );
}

// Every icon the catalog names (shared/badges.ts). A missing one still draws —
// as the generic ribbon — which is how differently-earned badges end up looking alike.
const PLATFORM_BADGE_ICONS: Record<string, IconName> = {
  rocket: "rocket", star: "star", trophy: "trophy", users: "people", sparkles: "sparkles",
  award: "ribbon", "user-check": "person-circle",
};
const RARITY: Record<string, { bg: string; border: string }> = {
  common: { bg: "#F3F4F6", border: "#D1D5DB" },
  rare: { bg: "#EFF6FF", border: "#93C5FD" },
  epic: { bg: "#FAF5FF", border: "#D8B4FE" },
  legendary: { bg: "#FEFCE8", border: "#FACC15" },
};

/**
 * Platform achievements (first project, a finished profile, a storyboard).
 *
 * On your own profile it shows the whole catalog with the earned ones lit and
 * the rest greyed out with what to do — an empty panel told a new member
 * nothing, not even that badges existed. On somebody else's it shows only what
 * they hold, and disappears when that is nothing: their profile is about what
 * they've done, not what they haven't.
 */
export function EarnedBadges({ userId, isOwn = false }: { userId: string; isOwn?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["user-badges", userId],
    queryFn: () => api<any[]>(`/api/users/${userId}/badges`).catch(() => []),
  });
  const { data: catalog } = useQuery({
    queryKey: ["badge-catalog"],
    queryFn: () => api<any[]>("/api/badges/catalog").catch(() => []),
    enabled: isOwn,
    staleTime: 60 * 60 * 1000,
  });
  const locked = isOwn ? (catalog ?? []).filter((b) => !(data ?? []).some((ub) => ub.badge?.id === b.id)) : [];
  if (!data?.length && locked.length === 0) return null;
  const described = (data ?? []).find((ub) => ub.id === open);
  return (
    <PCard>
      <CardTitle>{isOwn && catalog?.length ? `Badges · ${data?.length ?? 0} of ${catalog.length}` : "Earned Badges"}</CardTitle>
      <Row wrap gap={spacing.md - 2}>
        {(data ?? []).map((ub) => {
          const r = RARITY[ub.badge?.rarity] ?? RARITY.common;
          return (
            <Pressable key={ub.id} onPress={() => setOpen(open === ub.id ? null : ub.id)}
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, backgroundColor: r.bg, borderColor: r.border }}>
              <Icon name={PLATFORM_BADGE_ICONS[ub.badge?.icon] ?? "ribbon"} size={16} color={colors.text} />
              <View>
                <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.text }}>{ub.badge?.name}</Text>
                <Text style={{ fontSize: 10, fontFamily: fontFamily.regular, color: colors.textTertiary, textTransform: "capitalize" }}>{ub.badge?.rarity}</Text>
              </View>
            </Pressable>
          );
        })}
        {locked.map((b) => (
          <View key={b.id}
            style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderStyle: "dashed", backgroundColor: colors.canvas, borderColor: colors.border, opacity: 0.75 }}>
            <Icon name={PLATFORM_BADGE_ICONS[b.icon] ?? "ribbon"} size={16} color={colors.textTertiary} />
            <View>
              <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.textSecondary }}>{b.name}</Text>
              <Text style={{ fontSize: 10, fontFamily: fontFamily.regular, color: colors.textTertiary }}>{b.howTo}</Text>
            </View>
          </View>
        ))}
      </Row>
      {described?.badge?.description ? <Meta style={{ fontSize: font.xs + 1 }}>{described.badge.description}</Meta> : null}
    </PCard>
  );
}

/** "Believed in": what they've backed. The owner also sees hidden pledges and can toggle their name. */
export function BackerCredits({ userId, isOwn, notify }: { userId: string; isOwn: boolean; notify: (n: Notice) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["user-backings", userId],
    queryFn: () => api<any[]>(`/api/users/${userId}/backings`).catch(() => []),
  });
  const { data: mine } = useQuery({
    queryKey: ["me-backings"],
    queryFn: () => api<any[]>("/api/me/backings"),
    enabled: isOwn,
  });
  const privacy = useMutation({
    mutationFn: ({ id, isAnonymous }: { id: string; isAnonymous: boolean }) =>
      api(`/api/backings/${id}/privacy`, { method: "PATCH", body: { isAnonymous } }),
    onSuccess: (_r, v) => {
      notify({ text: v.isAnonymous ? "Hidden from the backer wall" : "Now shown on the backer wall", tone: "success" });
      void qc.invalidateQueries({ queryKey: ["me-backings"] });
      void qc.invalidateQueries({ queryKey: ["user-backings", userId] });
    },
    onError: () => notify({ text: "Couldn't change that", tone: "error" }),
  });

  const visible = (mine ?? []).filter((b) => b.status === "held" || b.status === "released");
  if (!data?.length && !visible.length) return null;

  const box = { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm + 2, gap: 6 } as const;
  const head = (title: string, number?: number | null) => (
    <Row between style={{ alignItems: "flex-start" }}>
      <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text, flexShrink: 1 }}>{title}</Text>
      {number != null ? <Text style={{ fontSize: font.xs, fontFamily: fontFamily.medium, color: colors.textTertiary }}>{formatBelieverNumber(number)}</Text> : null}
    </Row>
  );

  return (
    <PCard>
      <CardTitle icon="heart" iconColor={colors.primary}>Believed in</CardTitle>
      <View style={{ gap: spacing.sm }}>
        {isOwn
          ? visible.map((b) => (
            <View key={b.id} style={box}>
              <Pressable onPress={() => router.push(`/project/${b.projectId}`)}>{head(b.projectTitle, b.believerNumber)}</Pressable>
              <Row between wrap>
                <Row wrap gap={4} center>
                  {b.tierNameAtBacking ? <Pill label={b.tierNameAtBacking} variant="secondary" /> : null}
                  <Pill label={b.isAnonymous ? "Hidden" : "On the wall"} icon={b.isAnonymous ? "eye-off-outline" : "eye-outline"} />
                </Row>
                <Pressable disabled={privacy.isPending} hitSlop={6} onPress={() => privacy.mutate({ id: b.id, isAnonymous: !b.isAnonymous })}>
                  <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.textSecondary }}>{b.isAnonymous ? "Show my name" : "Hide my name"}</Text>
                </Pressable>
              </Row>
            </View>
          ))
          : data!.map((b) => (
            <Pressable key={`${b.projectId}-${b.createdAt}`} onPress={() => router.push(`/project/${b.projectId}`)} style={({ pressed }) => [box, pressed && { borderColor: colors.primary }]}>
              {head(b.projectTitle, b.believerNumber)}
              <Row wrap gap={4} center>
                {b.foundingBeliever ? <Pill label="Founding believer" icon="star" variant="default" /> : null}
                {b.tierName ? <Pill label={b.tierName} variant="secondary" /> : null}
                <Text style={{ fontSize: 10, fontFamily: fontFamily.regular, color: colors.textTertiary }}>
                  since {new Date(b.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                </Text>
              </Row>
            </Pressable>
          ))}
      </View>
    </PCard>
  );
}
