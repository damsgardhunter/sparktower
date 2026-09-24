import { useEffect, useState } from "react";
import { Image, Linking, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { API_URL, api } from "../api/client";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Avatar, Btn, ListItem, Loading, Meta, assetUri, errText, timeAgo, type IconName } from "./ui";
import { Sheet, type Notice } from "./Sheet";
import { FeedText, ReactionBadge, ReactionPicker, ReactionStack, ReportSheet, useMe } from "./FeedParts";
import { REACTIONS, authorAvatar, authorName, creditLine, postTypeAccent, postTypeDef, reactionDef, type FeedPost, type Reaction } from "./feedModel";

/** Emerald-700, the web's colour for "Acts on feedback from…". */
const CREDIT_GREEN = "#047857";

/** Long posts fold after this much in the feed, with "see more". */
const FOLD_CHARS = 280;
const FOLD_LINES = 5;

/** Where a post lives on the website, for sharing. The API host serves the site too. */
export const postUrl = (id: string) => `${API_URL}/posts/${id}`;

/**
 * One post, the way a professional network shows it on a phone: who and for
 * what project, the text folded at a few lines, photos, a count of reactions
 * and comments, and React / Comment / Share across the bottom.
 *
 * In the feed the card opens the post; `standalone` is the post's own page,
 * where the text is unfolded and nothing links to itself.
 */
export function PostCard({
  post, standalone, onComment, onNotice, onDeleted,
}: {
  post: FeedPost;
  standalone?: boolean;
  /** Comment was tapped. Defaults to opening the post with the comment box focused. */
  onComment?: () => void;
  onNotice?: (n: Notice) => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const mine = !!me.id && me.id === post.authorId;

  // The reaction shows at once; the server's answer replaces it when the feed refetches.
  const [mineReaction, setMineReaction] = useState<{ reaction: Reaction | null; count: number } | null>(null);
  useEffect(() => setMineReaction(null), [post.viewerReaction, post.reactionCount]);
  const viewerReaction = mineReaction ? mineReaction.reaction : post.viewerReaction;
  const reactionCount = mineReaction ? mineReaction.count : post.reactionCount;
  const breakdown = mineReaction
    ? adjustBreakdown(post.reactionBreakdown, post.viewerReaction, mineReaction.reaction)
    : post.reactionBreakdown;

  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reactors, setReactors] = useState(false);
  const [expanded, setExpanded] = useState(!!standalone);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["feed"] });
    qc.invalidateQueries({ queryKey: ["post", post.id] });
  };

  const react = useMutation({
    mutationFn: (reaction: Reaction) =>
      api<{ reactionCount: number; viewerReaction: Reaction | null }>(`/api/feed/${post.id}/react`, { method: "POST", body: { reaction } }),
    onMutate: (reaction) => {
      const next = viewerReaction === reaction ? null : reaction;
      const count = reactionCount + (next && !viewerReaction ? 1 : !next && viewerReaction ? -1 : 0);
      setMineReaction({ reaction: next, count });
    },
    onSuccess: (r) => { setMineReaction({ reaction: r.viewerReaction, count: r.reactionCount }); refresh(); },
    onError: (e) => { setMineReaction(null); onNotice?.({ text: errText(e, "Couldn't react."), tone: "error" }); },
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/feed/${post.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirmDelete(false);
      onNotice?.({ text: "Post deleted", tone: "success" });
      qc.invalidateQueries({ queryKey: ["feed"] });
      onDeleted?.();
    },
    onError: (e) => onNotice?.({ text: errText(e, "Couldn't delete the post."), tone: "error" }),
  });

  const def = postTypeDef(post.postType);
  const accent = postTypeAccent(post.postType);
  const name = authorName(post);
  // Posted in a company's name: the company is who's speaking; the person stays named underneath.
  const speaker = post.company?.name ?? name;
  const media = (post.mediaUrls ?? []).map((u) => assetUri(u)).filter(Boolean) as string[];
  const asks = post.asks ?? [];
  const long = post.content.length > FOLD_CHARS || post.content.split("\n").length > FOLD_LINES;
  const viewerDef = reactionDef(viewerReaction);

  const open = () => { if (!standalone) router.push(`/post/${post.id}` as any); };
  const comment = onComment ?? (() => router.push(`/post/${post.id}?comment=1` as any));

  const share = async () => {
    const excerpt = post.content.replace(/\*\*/g, "").slice(0, 140);
    try {
      await Share.share({ message: `${speaker} on SparkTower: "${excerpt}${post.content.length > 140 ? "…" : ""}" ${postUrl(post.id)}`, url: postUrl(post.id) });
    } catch {
      onNotice?.({ text: "Sharing isn't available here.", tone: "error" });
    }
  };

  return (
    <View style={[s.card, standalone && s.cardStandalone]}>
      {/* Who, and which project they're posting for */}
      <View style={s.header}>
        <Pressable onPress={() => router.push(`/user/${post.authorId}` as any)} accessibilityLabel={post.company ? `Posted by ${name}` : `Open ${name}'s profile`}>
          {post.company
            ? <View style={s.companyAvatar} testID={`post-company-avatar-${post.id}`}><Ionicons name="business" size={20} color={colors.textSecondary} /></View>
            : <Avatar name={name} uri={authorAvatar(post)} size={44} />}
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.nameRow}>
            {post.company && <Ionicons name="business-outline" size={12} color={colors.textSecondary} />}
            <Text style={s.name} numberOfLines={1} onPress={post.company ? undefined : () => router.push(`/user/${post.authorId}` as any)} testID={post.company ? `post-company-${post.id}` : `post-author-${post.id}`}>
              {speaker}
            </Text>
            {post.project && (
              <>
                <Text style={s.dot}>·</Text>
                <Text style={s.project} numberOfLines={1} onPress={() => router.push(`/project/${post.project!.id}` as any)} testID={`post-project-${post.id}`}>
                  {post.project.title}
                </Text>
                {post.project.isPrivate && <Ionicons name="lock-closed" size={11} color={colors.warning} accessibilityLabel="Private project" />}
              </>
            )}
          </View>
          {post.company
            ? <Text style={s.headline} numberOfLines={1} onPress={() => router.push(`/user/${post.authorId}` as any)} testID={`post-author-${post.id}`}>Posted by {name}</Text>
            : post.profile?.headline ? <Text style={s.headline} numberOfLines={1}>{post.profile.headline}</Text> : null}
          <View style={s.metaRow}>
            <Text style={s.meta} onPress={standalone ? undefined : open}>
              {standalone
                ? new Date(post.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
                : timeAgo(post.createdAt)}
            </Text>
            <View style={[s.typeBadge, { backgroundColor: accent.bg, borderColor: accent.border }]} testID={`post-type-${post.id}`}>
              <Ionicons name={def.icon} size={10} color={accent.text} />
              <Text style={[s.typeBadgeText, { color: accent.text }]}>{def.label}</Text>
            </View>
            {post.isSystemGenerated && (
              <View style={s.auto}><Ionicons name="sparkles" size={9} color={colors.textSecondary} /><Text style={s.autoText}>Auto</Text></View>
            )}
          </View>
        </View>
        <Pressable onPress={() => setMenu(true)} hitSlop={10} accessibilityLabel="More options" style={s.more}>
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={s.content}>
        {/* The post itself */}
        <Pressable onPress={open} disabled={standalone}>
          <FeedText
            content={post.content}
            mentions={post.mentions}
            numberOfLines={!expanded && long ? FOLD_LINES : undefined}
            onMentionPress={(id) => router.push(`/user/${id}` as any)}
          />
          {!expanded && long && (
            <Text style={s.seeMore} onPress={() => setExpanded(true)}>…see more</Text>
          )}
        </Pressable>

        {/* The questions this update wants answered: what makes the feedback specific. */}
        {asks.length > 0 && (
          <View style={s.asks} testID={`post-asks-${post.id}`}>
            <View style={s.asksTitle}>
              <Ionicons name="help-circle-outline" size={13} color={colors.primary} />
              <Text style={s.asksLabel}>HELP ANSWER</Text>
            </View>
            {asks.map((a, i) => (
              <Text key={a} style={s.ask}>{i + 1}.  {a}</Text>
            ))}
            {!mine && <Text style={s.link} onPress={comment}>Answer in a comment</Text>}
          </View>
        )}

        {/* A step from the project's path: back to the path for the team, to the project for everyone else. */}
        {post.pathStep && post.project && (
          <Pressable
            onPress={() => router.push((post.viewerIsTeam ? `/manage/${post.project!.id}` : `/project/${post.project!.id}`) as any)}
            style={s.pathStep}
            testID={`post-path-step-${post.id}`}
          >
            <Ionicons name="compass-outline" size={12} color={colors.primary} />
            <Text style={s.pathStepText} numberOfLines={1}>From the path: {post.pathStep.title}</Text>
          </Pressable>
        )}

        {post.pathWeek && post.project && (
          <View style={s.pathWeek} testID={`post-path-week-${post.id}`}>
            <Text
              style={s.pathWeekTitle}
              onPress={() => router.push((post.viewerIsTeam ? `/manage/${post.project!.id}` : `/project/${post.project!.id}`) as any)}
            >
              <Ionicons name="compass-outline" size={12} color={colors.primary} /> This week on the path: {post.pathWeek.steps.length} step{post.pathWeek.steps.length === 1 ? "" : "s"}
            </Text>
            {post.pathWeek.steps.map((st) => (
              <Text key={st.taskId} style={s.pathWeekStep}>•  {st.title}</Text>
            ))}
          </View>
        )}

        {/* This update closes the loop on earlier feedback, and says whose. */}
        {(post.credits?.length ?? 0) > 0 && (
          <View style={s.credits} testID={`post-credits-${post.id}`}>
            <Ionicons name="repeat" size={14} color={CREDIT_GREEN} />
            <Text style={s.creditsText}>{creditLine(post.credits!.map((c) => c.name))}</Text>
          </View>
        )}

        {media.length > 0 && (
          <View style={s.media}>
            {media.map((uri) => (
              <Pressable
                key={uri}
                onPress={() => Linking.openURL(uri).catch(() => {})}
                style={media.length === 1 ? s.mediaOne : s.mediaTile}
                accessibilityLabel="Open image"
              >
                <Image source={{ uri: assetUri(uri)! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* Counts */}
      {(reactionCount > 0 || post.commentCount > 0) && (
        <View style={s.counts}>
          {reactionCount > 0 ? (
            <Pressable onPress={() => setReactors(true)} style={s.countLeft} hitSlop={6} accessibilityLabel="See who reacted">
              <ReactionStack breakdown={breakdown} size={18} />
              <Text style={s.countText}>{reactionCount}</Text>
            </Pressable>
          ) : <View />}
          {post.commentCount > 0 && (
            <Text style={[s.countText, { marginLeft: "auto" }]} onPress={standalone ? undefined : comment}>
              {post.commentCount} comment{post.commentCount === 1 ? "" : "s"}
            </Text>
          )}
        </View>
      )}

      {/* Actions */}
      <View style={s.rule} />
      <View style={s.actions}>
        {picker && (
          <ReactionPicker
            current={viewerReaction}
            style={{ bottom: 44, left: spacing.sm }}
            onClose={() => setPicker(false)}
            onPick={(r) => { setPicker(false); react.mutate(r); }}
          />
        )}
        <Action
          emoji={viewerDef?.emoji ?? "👍"}
          label={viewerDef ? viewerDef.label : "React"}
          color={viewerDef?.color}
          onPress={() => setPicker((v) => !v)}
          onLongPress={() => setPicker(true)}
          disabled={!me.id || react.isPending}
          testID={`button-react-${post.id}`}
        />
        <Action icon="chatbubble-outline" label="Comment" onPress={comment} testID={`button-comment-${post.id}`} />
        <Action icon="arrow-redo-outline" label="Share" onPress={share} testID={`button-share-${post.id}`} />
      </View>

      {/* Overflow menu */}
      <Sheet visible={menu && !confirmDelete} onClose={() => setMenu(false)} title="Post options">
        <View style={{ marginHorizontal: -spacing.lg }}>
          {!standalone && <ListItem icon="open-outline" title="Open post" onPress={() => { setMenu(false); open(); }} />}
          <ListItem icon="share-social-outline" title="Share post" onPress={() => { setMenu(false); share(); }} />
          {post.project && (
            <ListItem icon="rocket-outline" title={`View ${post.project.title}`} onPress={() => { setMenu(false); router.push(`/project/${post.project!.id}` as any); }} />
          )}
          <ListItem icon="person-outline" title={mine ? "View your profile" : `View ${name}'s profile`} onPress={() => { setMenu(false); router.push(`/user/${post.authorId}` as any); }} />
          {!mine && me.id && (
            <ListItem icon="flag-outline" title="Report post" subtitle="A person reviews every report" onPress={() => { setMenu(false); setReporting(true); }} />
          )}
          {mine && <ListItem icon="trash-outline" title="Delete post" danger onPress={() => setConfirmDelete(true)} />}
        </View>
      </Sheet>

      <Sheet visible={confirmDelete} onClose={() => { setConfirmDelete(false); setMenu(false); }} title="Delete this post?" subtitle="It comes off the feed, with its comments and reactions. This can't be undone.">
        <View style={{ flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" }}>
          <Btn label="Cancel" variant="ghost" small onPress={() => { setConfirmDelete(false); setMenu(false); }} />
          <Btn label="Delete" variant="danger" icon="trash-outline" small loading={remove.isPending} onPress={() => { setMenu(false); remove.mutate(); }} />
        </View>
      </Sheet>

      <ReportSheet
        visible={reporting}
        onClose={() => setReporting(false)}
        targetType="feed_post"
        targetId={post.id}
        onSent={() => onNotice?.({ text: "Thanks — someone will review this.", tone: "success" })}
      />

      <ReactorsSheet postId={post.id} visible={reactors} onClose={() => setReactors(false)} />
    </View>
  );
}

function Action({
  icon, emoji, label, onPress, onLongPress, color, disabled, testID,
}: {
  icon?: IconName;
  emoji?: string;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  color?: string;
  disabled?: boolean;
  testID?: string;
}) {
  const tint = color ?? colors.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [s.action, pressed && { backgroundColor: colors.surfaceRaised }, disabled && { opacity: 0.5 }]}
    >
      {emoji
        ? <Text style={s.actionEmoji} allowFontScaling={false}>{emoji}</Text>
        : icon ? <Ionicons name={icon} size={18} color={tint} /> : null}
      <Text style={[s.actionText, { color: tint }, color && { fontFamily: fontFamily.semibold }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Keeps the reaction badges honest while an optimistic reaction is pending. */
function adjustBreakdown(list: { reaction: string; count: number }[], from: string | null, to: string | null) {
  const map = new Map(list.map((r) => [r.reaction, r.count]));
  if (from) map.set(from, Math.max(0, (map.get(from) ?? 0) - 1));
  if (to) map.set(to, (map.get(to) ?? 0) + 1);
  return [...map.entries()].map(([reaction, count]) => ({ reaction, count }));
}

interface Reactor { userId: string; reaction: Reaction; name: string; headline: string | null; avatarUrl: string | null }

/** Everyone who reacted, by reaction — the web post page's interactions card. */
export function ReactorsSheet({ postId, visible, onClose }: { postId: string; visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<Reaction | "all">("all");
  const { data, isLoading } = useQuery({
    queryKey: ["post", postId, "reactions"],
    queryFn: () => api<Reactor[]>(`/api/feed/${postId}/reactions`),
    enabled: visible,
  });
  const counts = REACTIONS.map((r) => ({ ...r, count: (data ?? []).filter((x) => x.reaction === r.reaction).length })).filter((r) => r.count > 0);
  const shown = (data ?? []).filter((r) => tab === "all" || r.reaction === tab);

  return (
    <Sheet visible={visible} onClose={onClose} title="Reactions">
      <View style={s.tabs}>
        <Pressable onPress={() => setTab("all")} style={[s.tab, tab === "all" && s.tabOn]}>
          <Text style={[s.tabText, tab === "all" && s.tabTextOn]}>All {data?.length ?? ""}</Text>
        </Pressable>
        {counts.map((r) => (
          <Pressable key={r.reaction} onPress={() => setTab(r.reaction)} style={[s.tab, tab === r.reaction && s.tabOn]}>
            <ReactionBadge reaction={r.reaction} size={16} ring={false} />
            <Text style={[s.tabText, tab === r.reaction && s.tabTextOn]}>{r.count}</Text>
          </Pressable>
        ))}
      </View>
      {isLoading ? <View style={{ height: 120 }}><Loading /></View> : (
        <View style={{ maxHeight: 360 }}>
          {!shown.length && <Meta>No reactions yet.</Meta>}
          {shown.slice(0, 50).map((r) => (
            <Pressable key={r.userId} onPress={() => { onClose(); router.push(`/user/${r.userId}` as any); }} style={s.reactor}>
              <View>
                <Avatar name={r.name} uri={r.avatarUrl} size={40} />
                <View style={{ position: "absolute", right: -3, bottom: -3 }}><ReactionBadge reaction={r.reaction} size={18} /></View>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>{r.name}</Text>
                {r.headline ? <Text style={s.headline} numberOfLines={1}>{r.headline}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  // The website's post box: white, hairline border, 8px corners, on the gray canvas.
  card: {
    backgroundColor: colors.surface, marginHorizontal: spacing.sm, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, overflow: "visible",
  },
  cardStandalone: {},
  header: {
    flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: 14, paddingBottom: 10, alignItems: "flex-start",
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  companyAvatar: {
    width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center",
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 },
  name: { color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.semibold, flexShrink: 1 },
  dot: { color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.regular },
  project: { color: colors.primary, fontSize: font.sm + 1, fontFamily: fontFamily.medium, flexShrink: 1 },
  headline: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular, marginTop: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 3 },
  meta: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular },
  typeBadge: {
    flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: 7, paddingVertical: 1,
  },
  typeBadgeText: { fontSize: 11, fontFamily: fontFamily.regular },
  auto: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  autoText: { color: colors.textSecondary, fontSize: 11, fontFamily: fontFamily.regular },
  more: { padding: 2, marginTop: -2 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, gap: spacing.md },
  seeMore: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold, alignSelf: "flex-end", marginTop: 2 },
  asks: {
    padding: spacing.md, gap: 5, borderRadius: 6, borderWidth: 1,
    borderColor: "rgba(151,69,181,0.20)", backgroundColor: "rgba(151,69,181,0.05)",
  },
  asksTitle: { flexDirection: "row", alignItems: "center", gap: 4 },
  asksLabel: { color: colors.primary, fontSize: 11, fontFamily: fontFamily.semibold, letterSpacing: 0.5 },
  ask: { color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.regular, lineHeight: 20 },
  link: { color: colors.primary, fontSize: 12, fontFamily: fontFamily.medium, marginTop: 2 },
  pathStep: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", maxWidth: "100%",
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1,
    borderColor: "rgba(151,69,181,0.30)", backgroundColor: "rgba(151,69,181,0.05)",
  },
  pathStepText: { color: colors.primary, fontSize: 12, fontFamily: fontFamily.regular, flexShrink: 1 },
  pathWeek: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 3, borderRadius: 6, borderWidth: 1,
    borderColor: "rgba(151,69,181,0.30)", backgroundColor: "rgba(151,69,181,0.05)",
  },
  pathWeekTitle: { color: colors.primary, fontSize: 12, fontFamily: fontFamily.medium },
  pathWeekStep: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular, paddingLeft: 4 },
  credits: { flexDirection: "row", alignItems: "center", gap: 6 },
  creditsText: { color: CREDIT_GREEN, fontSize: 12, fontFamily: fontFamily.regular, flexShrink: 1 },
  media: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  mediaOne: { width: "100%", aspectRatio: 4 / 3, maxHeight: 320, borderRadius: 6, overflow: "hidden", backgroundColor: colors.surfaceRaised },
  mediaTile: { width: "48.5%", aspectRatio: 1, borderRadius: 6, overflow: "hidden", backgroundColor: colors.surfaceRaised },
  counts: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: 6 },
  countLeft: { flexDirection: "row", alignItems: "center", gap: 5 },
  countText: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: "#CFCFCF", marginHorizontal: spacing.lg },
  actions: { flexDirection: "row", gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, position: "relative" },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 6 },
  actionEmoji: { fontSize: 16, lineHeight: 20 },
  actionText: { fontSize: 12, fontFamily: fontFamily.medium },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  tab: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  tabOn: { backgroundColor: colors.primarySoft },
  tabText: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.medium },
  tabTextOn: { color: colors.primary, fontFamily: fontFamily.semibold },
  reactor: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
});
