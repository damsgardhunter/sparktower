import { useEffect, useState } from "react";
import { Image, Linking, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { API_URL, api } from "../api/client";
import { colors, font, fontFamily, postTypeColors, radius, spacing } from "../theme";
import { Avatar, Btn, ListItem, Loading, Meta, assetUri, errText, timeAgo, type IconName } from "./ui";
import { Sheet, type Notice } from "./Sheet";
import { FeedText, ReactionBadge, ReactionPicker, ReactionStack, ReportSheet, useMe } from "./FeedParts";
import { REACTIONS, authorAvatar, authorName, creditLine, postTypeDef, reactionDef, type FeedPost, type Reaction } from "./feedModel";

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
  const accent = postTypeColors[post.postType] || colors.info;
  const name = authorName(post);
  const media = (post.mediaUrls ?? []).map((u) => assetUri(u)).filter(Boolean) as string[];
  const asks = post.asks ?? [];
  const long = post.content.length > FOLD_CHARS || post.content.split("\n").length > FOLD_LINES;
  const viewerDef = reactionDef(viewerReaction);

  const open = () => { if (!standalone) router.push(`/post/${post.id}` as any); };
  const comment = onComment ?? (() => router.push(`/post/${post.id}?comment=1` as any));

  const share = async () => {
    const excerpt = post.content.replace(/\*\*/g, "").slice(0, 140);
    try {
      await Share.share({ message: `${name} on SparkTower: "${excerpt}${post.content.length > 140 ? "…" : ""}" ${postUrl(post.id)}`, url: postUrl(post.id) });
    } catch {
      onNotice?.({ text: "Sharing isn't available here.", tone: "error" });
    }
  };

  return (
    <View style={[s.card, standalone && s.cardStandalone]}>
      {/* Who, and which project they're posting for */}
      <View style={s.header}>
        <Pressable onPress={() => router.push(`/user/${post.authorId}` as any)} accessibilityLabel={`Open ${name}'s profile`}>
          <Avatar name={name} uri={authorAvatar(post)} size={46} />
        </Pressable>
        <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => router.push(`/user/${post.authorId}` as any)}>
          <Text style={s.name} numberOfLines={1}>
            {name}
            {post.project && (
              <Text style={s.dot}>{"  ·  "}
                <Text style={s.project} onPress={() => router.push(`/project/${post.project!.id}` as any)}>
                  {post.project.title}
                </Text>
              </Text>
            )}
          </Text>
          {post.profile?.headline ? <Text style={s.headline} numberOfLines={1}>{post.profile.headline}</Text> : null}
          <View style={s.metaRow}>
            <Text style={s.meta}>
              {standalone
                ? new Date(post.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                : timeAgo(post.createdAt)}
            </Text>
            <Text style={s.meta}>·</Text>
            <Ionicons name={def.icon} size={12} color={accent} />
            <Text style={[s.meta, { color: accent, fontFamily: fontFamily.semibold }]}>{def.label}</Text>
            {post.project?.isPrivate && <Ionicons name="lock-closed" size={11} color={colors.textTertiary} />}
            {post.isSystemGenerated && (
              <View style={s.auto}><Ionicons name="sparkles" size={9} color={colors.textSecondary} /><Text style={s.autoText}>Auto</Text></View>
            )}
          </View>
        </Pressable>
        <Pressable onPress={() => setMenu(true)} hitSlop={10} accessibilityLabel="More options" style={s.more}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* The post itself */}
      <Pressable onPress={open} disabled={standalone} style={s.body}>
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

      {asks.length > 0 && (
        <View style={s.asks}>
          <View style={s.asksTitle}>
            <Ionicons name="help-circle" size={14} color={colors.primary} />
            <Text style={s.asksLabel}>HELP ANSWER</Text>
          </View>
          {asks.map((a, i) => (
            <Text key={a} style={s.ask}><Text style={{ fontFamily: fontFamily.semibold }}>{i + 1}.</Text> {a}</Text>
          ))}
          {!mine && <Text style={s.link} onPress={comment}>Answer in a comment</Text>}
        </View>
      )}

      {post.pathStep && post.project && (
        <Pressable
          onPress={() => router.push((post.viewerIsTeam ? `/manage/${post.project!.id}` : `/project/${post.project!.id}`) as any)}
          style={s.pathStep}
        >
          <Ionicons name="compass-outline" size={13} color={colors.primary} />
          <Text style={s.pathStepText} numberOfLines={1}>From the path: {post.pathStep.title}</Text>
        </Pressable>
      )}

      {(post.credits?.length ?? 0) > 0 && (
        <View style={s.credits}>
          <Ionicons name="repeat" size={14} color={colors.success} />
          <Text style={s.creditsText}>{creditLine(post.credits!.map((c) => c.name))}</Text>
        </View>
      )}

      {media.length > 0 && (
        <View style={s.media}>
          {media.map((uri, i) => (
            <Pressable
              key={uri}
              onPress={() => Linking.openURL(uri).catch(() => {})}
              style={[media.length === 1 ? s.mediaOne : s.mediaTile, media.length % 2 === 1 && i === 0 && media.length > 1 && s.mediaWide]}
            >
              <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            </Pressable>
          ))}
        </View>
      )}

      {/* Counts */}
      {(reactionCount > 0 || post.commentCount > 0) && (
        <View style={s.counts}>
          {reactionCount > 0 ? (
            <Pressable onPress={() => setReactors(true)} style={s.countLeft} hitSlop={6} accessibilityLabel="See who reacted">
              <ReactionStack breakdown={breakdown} size={17} />
              <Text style={s.countText}>{reactionCount}</Text>
            </Pressable>
          ) : <View />}
          {post.commentCount > 0 && (
            <Text style={s.countText} onPress={standalone ? undefined : comment}>
              {post.commentCount} comment{post.commentCount === 1 ? "" : "s"}
            </Text>
          )}
        </View>
      )}

      {/* Actions */}
      <View style={s.actions}>
        {picker && (
          <ReactionPicker
            current={viewerReaction}
            style={{ bottom: 48, left: spacing.sm }}
            onClose={() => setPicker(false)}
            onPick={(r) => { setPicker(false); react.mutate(r); }}
          />
        )}
        <Action
          icon={viewerDef ? viewerDef.icon : "thumbs-up-outline"}
          label={viewerDef ? viewerDef.label : "React"}
          color={viewerDef?.color}
          onPress={() => react.mutate(viewerReaction ?? "like")}
          onLongPress={() => setPicker(true)}
          disabled={!me.id}
        />
        <Action icon="chatbubble-outline" label="Comment" onPress={comment} />
        <Action icon="arrow-redo-outline" label="Share" onPress={share} />
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
  icon, label, onPress, onLongPress, color, disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  color?: string;
  disabled?: boolean;
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
      accessibilityHint={onLongPress ? "Hold to pick a reaction" : undefined}
      style={({ pressed }) => [s.action, pressed && { backgroundColor: colors.surfaceRaised }, disabled && { opacity: 0.5 }]}
    >
      <Ionicons name={icon} size={19} color={tint} />
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
  card: { backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  cardStandalone: { borderTopWidth: 0 },
  header: { flexDirection: "row", gap: spacing.sm + 2, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, alignItems: "flex-start" },
  name: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold },
  dot: { color: colors.textTertiary, fontFamily: fontFamily.regular },
  project: { color: colors.primary, fontFamily: fontFamily.semibold },
  headline: { color: colors.textSecondary, fontSize: 12, fontFamily: fontFamily.regular, marginTop: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  meta: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular },
  auto: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: 5, paddingVertical: 1, marginLeft: 2 },
  autoText: { color: colors.textSecondary, fontSize: 10, fontFamily: fontFamily.medium },
  more: { padding: 2, marginTop: -2 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  seeMore: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold, alignSelf: "flex-end", marginTop: 2 },
  asks: {
    marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, gap: 4,
    backgroundColor: colors.primarySoft, borderRadius: radius.sm,
  },
  asksTitle: { flexDirection: "row", alignItems: "center", gap: 4 },
  asksLabel: { color: colors.primary, fontSize: 11, fontFamily: fontFamily.bold, letterSpacing: 0.5 },
  ask: { color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular, lineHeight: 19 },
  link: { color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold, marginTop: 2 },
  pathStep: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", maxWidth: "90%",
    marginHorizontal: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.primarySoft,
  },
  pathStepText: { color: colors.primary, fontSize: 12, fontFamily: fontFamily.medium, flexShrink: 1 },
  credits: { flexDirection: "row", alignItems: "center", gap: 5, marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  creditsText: { color: colors.success, fontSize: 12, fontFamily: fontFamily.medium, flexShrink: 1 },
  media: { flexDirection: "row", flexWrap: "wrap", gap: 2, marginBottom: spacing.xs },
  mediaOne: { width: "100%", aspectRatio: 4 / 3, backgroundColor: colors.surfaceRaised },
  mediaTile: { width: "49.7%", aspectRatio: 1, backgroundColor: colors.surfaceRaised },
  mediaWide: { width: "100%", aspectRatio: 16 / 9 },
  counts: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  countLeft: { flexDirection: "row", alignItems: "center", gap: 5 },
  countText: { color: colors.textSecondary, fontSize: 12, fontFamily: fontFamily.regular },
  actions: {
    flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    marginHorizontal: spacing.md, paddingVertical: 2, position: "relative",
  },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: radius.sm },
  actionText: { fontSize: font.sm, fontFamily: fontFamily.medium },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  tab: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  tabOn: { backgroundColor: colors.primarySoft },
  tabText: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.medium },
  tabTextOn: { color: colors.primary, fontFamily: fontFamily.semibold },
  reactor: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
});
