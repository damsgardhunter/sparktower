import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, fetchMe, readPref, writePref } from "../../src/api/client";
import { colors, spacing } from "../../src/theme";
import { Btn, Empty, Icon, Loading, Screen, TabStrip } from "../../src/components/ui";
import { buildDiscoverFeed, timeAgo, type FeedItem } from "../../src/discoverFeed";
import { ConnectActions, FollowButton, useConnectionStates } from "../../src/components/ConnectActions";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { DISCOVER_NEW_KEY, EXPLORE, markSeen as rememberSeen, openDiscover, recordDiscoverVisit, trackExplore } from "../../src/explore";
import {
  DISCOVER_UPDATES_KEY, CONNECTION_REQUESTS_KEY, personAvatar, personName, updateLabel,
  DIRECTORY_KEY, useConnectionRequests, useConnections, useDirectory, useExploreUpdates, useInvitationActions,
} from "../../src/networkData";
import {
  InvitationRow, LookingForCardView, NetworkBlock, NewsBanner, PersonGridCard, ProjectRowItem, ShowMore, networkStyles,
} from "../../src/components/NetworkCards";

type Mode = "grow" | "looking";

const GRID_START = 6;
const PROJECTS_START = 4;
const INVITES_SHOWN = 3;
const MORE_START = 4;

/**
 * My Network: invitations to answer, builders Nova matched you with, projects
 * to follow, and who's openly looking for collaborators — plus what's new
 * with what you've already looked at.
 *
 * Real data, not a mock: matches from Nova, projects as they're posted. The
 * rules — order, reasons, what counts as new — live in src/discoverFeed.ts,
 * where they're tested; this file draws them and handles the taps.
 *
 * Refreshing re-reads. It never generates matches: that's the separate
 * "Find new matches" button, because on paid plans it can spend a credit.
 *
 * The quick actions — Connect with a note, Message once connected, Follow —
 * live in src/components/ConnectActions.tsx, shared with the builder screen.
 */
export default function Discover() {
  const router = useRouter();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const [mode, setMode] = useState<Mode>("grow");
  const [gridAll, setGridAll] = useState(false);
  const [projectsAll, setProjectsAll] = useState(false);
  const [moreAll, setMoreAll] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [newsDismissed, setNewsDismissed] = useState(false);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const meId: string | undefined = me?.user?.id;

  const matches = useQuery({ queryKey: ["matches"], queryFn: () => api<any[]>("/api/matches") });
  const projects = useQuery({ queryKey: ["projects", "discover"], queryFn: () => api<any[]>("/api/projects") });
  const followed = useQuery({ queryKey: ["followed-projects"], queryFn: () => api<any[]>("/api/user/followed-projects") });
  const requests = useConnectionRequests();
  const connectionsList = useConnections();
  const looking = useQuery({ queryKey: ["looking-for"], queryFn: () => api<any[]>("/api/looking-for") });
  const { updates, byKey } = useExploreUpdates();
  // Everyone else on SparkTower — the web's Discover People list — for when Nova's matches run short.
  const directory = useDirectory();

  // --- what's new ---------------------------------------------------------
  //
  // "Seen" is a moment this person chose — tapping "Mark seen" — not every time
  // the screen happened to be open. Stored per account, so a shared phone
  // doesn't mark one person's feed seen for another.
  //
  // It's stored as the newest item's own timestamp, as the server reported it,
  // not the phone's clock. The server's times can be off from true time by its
  // timezone (a database not on UTC reads back hours early), and the phone's
  // clock can simply be wrong; comparing the server's times only with each
  // other is right either way. Undefined until read; on a first visit it's set
  // to the newest item, so nothing is "new" the first time.
  const seenKey = meId ? `discover.lastSeen.${meId}` : null;
  const [lastSeen, setLastSeen] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!seenKey) return;
    let cancelled = false;
    readPref(seenKey)
      .then((stored) => { if (!cancelled) setLastSeen(stored ?? null); })
      .catch(() => { if (!cancelled) setLastSeen(null); });
    return () => { cancelled = true; };
  }, [seenKey]);

  const newest = useMemo(() => {
    const times = [...(matches.data ?? []), ...(projects.data ?? [])]
      .map((item: any) => item?.createdAt)
      .filter((t: unknown): t is string => typeof t === "string")
      .sort();
    return times.length ? times[times.length - 1] : null;
  }, [matches.data, projects.data]);

  useEffect(() => {
    if (lastSeen !== null || !seenKey || !newest) return;
    setLastSeen(newest);
    void writePref(seenKey, newest);
  }, [lastSeen, seenKey, newest]);

  const markSeen = () => {
    const mark = newest ?? new Date().toISOString();
    setLastSeen(mark);
    if (seenKey) void writePref(seenKey, mark);
  };

  const feed = useMemo(() => buildDiscoverFeed({
    matches: matches.data ?? [],
    projects: projects.data ?? [],
    meId,
    mySkills: me?.profile?.skills ?? [],
    followed: new Set((followed.data ?? []).map((f: any) => f.projectId)),
    lastSeen: lastSeen ?? null,
  }), [matches.data, projects.data, followed.data, meId, me?.profile?.skills, lastSeen]);

  // The feed's order is the rank Explore records; the screen draws builders and projects apart.
  const ranked = feed.items.map((item, index) => ({ item, rank: index + 1 }));
  const builders = ranked.filter((r): r is { item: BuilderItem; rank: number } => r.item.kind === "builder" && !hidden.has(r.item.key));
  const projectItems = ranked.filter((r): r is { item: ProjectItem; rank: number } => r.item.kind === "project");
  const covers = useMemo(() => new Map((matches.data ?? []).map((m: any) => [m.matchedUserId, m.matchedProfile?.coverUrl])), [matches.data]);
  const matchedSkills = useMemo(() => new Map<string, string[]>((matches.data ?? []).map((m: any) => [m.matchedUserId, m.matchedProfile?.skills ?? []])), [matches.data]);
  const categories = useMemo(() => new Map<string, string | null>((projects.data ?? []).map((p: any) => [p.id, p.category ?? null])), [projects.data]);

  // Builders Nova hasn't matched you with, you aren't connected to, and haven't hidden.
  const moreBuilders = useMemo(() => {
    const skip = new Set<string>([
      ...(meId ? [meId] : []),
      ...builders.map((b) => b.item.userId),
      ...(connectionsList.data ?? []).map((c) => c.user.id),
      ...(requests.data ?? []).map((r) => r.requesterId),
    ]);
    const candidates = (directory.data ?? [])
      .filter((u) => u?.id && !skip.has(u.id) && !hidden.has(`more:${u.id}`) && (u.profile?.displayName || u.firstName));
    // Empty profiles make empty cards; leave them out once there are enough filled-in ones.
    const filled = candidates.filter((u) => u.profile?.headline || u.profile?.skills?.length);
    return (filled.length >= MORE_START ? filled : candidates)
      // Filled-in profiles first: a photo and a headline are what make a card worth tapping.
      .sort((a, b) => Number(!!b.profile?.headline) - Number(!!a.profile?.headline) || Number(!!(b.profile?.avatarUrl || b.profileImageUrl)) - Number(!!(a.profile?.avatarUrl || a.profileImageUrl)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directory.data, meId, builders.length, connectionsList.data, requests.data, hidden]);

  // --- refreshing ---------------------------------------------------------

  const refreshing = matches.isRefetching || projects.isRefetching || followed.isRefetching || requests.isRefetching;
  const refresh = useCallback(() => {
    void Promise.all([matches.refetch(), projects.refetch(), followed.refetch(), requests.refetch(), looking.refetch(), directory.refetch()]);
    void qc.invalidateQueries({ queryKey: DISCOVER_UPDATES_KEY });
  }, [matches, projects, followed, requests, looking, directory, qc]);

  // Coming back to the tab re-reads, so something new since the last visit
  // shows up — and the banner with it — without anyone having to pull.
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    // Every time Discover comes into view is an open; in the same visit, a return.
    openDiscover();
    // …and the tab's badge clears: its "since" is now.
    void recordDiscoverVisit().then(() => qc.invalidateQueries({ queryKey: DISCOVER_NEW_KEY }));
    if (firstFocus.current) { firstFocus.current = false; return; }
    void qc.invalidateQueries({ queryKey: ["matches"] });
    void qc.invalidateQueries({ queryKey: ["projects", "discover"] });
    void qc.invalidateQueries({ queryKey: ["followed-projects"] });
    void qc.invalidateQueries({ queryKey: CONNECTION_REQUESTS_KEY });
    void qc.invalidateQueries({ queryKey: DISCOVER_UPDATES_KEY });
    void qc.invalidateQueries({ queryKey: DIRECTORY_KEY });
  }, [qc]));

  const updatedAt = Math.max(matches.dataUpdatedAt || 0, projects.dataUpdatedAt || 0);

  // --- quick actions -------------------------------------------------------
  //
  // One lookup for where you stand with every builder on screen, and one
  // notice for how any action went.
  const lookingIds = (looking.data ?? []).map((p: any) => p.userId).filter((id: string) => id !== meId);
  const { data: connections } = useConnectionStates([
    ...builders.map((b) => b.item.userId), ...lookingIds, ...moreBuilders.slice(0, 24).map((u) => u.id),
  ]);
  const { notice, show, clear } = useNotice();
  const invites = useInvitationActions(show);

  const generate = useMutation({
    mutationFn: () => api<any[]>("/api/matches/generate", { method: "POST" }),
    onSuccess: (rows) => {
      void qc.invalidateQueries({ queryKey: ["matches"] });
      show({ text: rows?.length ? `Nova found ${rows.length} builder${rows.length === 1 ? "" : "s"} for you.` : "No new matches right now — try again after you add skills to your profile.", tone: rows?.length ? "success" : "info" });
    },
    onError: (error: any) => show({ text: error?.message || "Couldn't find matches.", tone: "error" }),
  });

  const openBuilder = (userId: string, rank: number) => {
    trackExplore(EXPLORE.openProfile, { matchType: "builder", targetId: userId, rankPosition: rank, source: "discover" });
    rememberSeen("builder", userId);
    router.push(`/user/${userId}`);
  };
  const openProject = (projectId: string, rank: number) => {
    trackExplore(EXPLORE.openProject, { matchType: "project", targetId: projectId, rankPosition: rank, source: "discover" });
    rememberSeen("project", projectId);
    router.push(`/project/${projectId}`);
  };

  // --- drawing --------------------------------------------------------------

  const loadingFeed = matches.isLoading || projects.isLoading;
  const gridWidth = Math.floor((Math.min(width, 700) - spacing.lg * 2 - spacing.sm) / 2);
  const invitations = requests.data ?? [];
  const shownBuilders = gridAll ? builders : builders.slice(0, GRID_START);
  const shownProjects = projectsAll ? projectItems : projectItems.slice(0, PROJECTS_START);
  const shownMore = moreAll ? moreBuilders.slice(0, 24) : moreBuilders.slice(0, MORE_START);
  const showNews = !newsDismissed && (updates.length > 0 || feed.newCount > 0);

  const newsTitle = updates.length ? "Welcome back — new since you last looked" : `${feed.newCount} new since you last looked`;
  const newsDetail = updates.length
    ? updates.map((u) => `${u.name}: ${updateLabel(u)}`).join(" · ")
    : "New matches and projects are at the top of each list, marked New.";
  const firstUpdate = updates[0];

  const lookingSection = (limit?: number) => {
    const rows = (looking.data ?? []).filter((p: any) => p.userId !== meId);
    const shown = limit ? rows.slice(0, limit) : rows;
    return looking.isLoading ? <Loading /> : !rows.length ? (
      <Empty icon="megaphone-outline" title="Nobody's posted an open call yet" body="When builders say who they're looking for — a cofounder, a designer, an engineer — they show up here." />
    ) : (
      <>
        {shown.map((p: any, i: number) => {
          const name = personName(p.user, p);
          return (
            <View key={p.userId}>
              {i > 0 && <View style={[networkStyles.divider, { marginLeft: spacing.lg }]} />}
              <LookingForCardView
                name={name}
                headline={p.headline}
                avatarUrl={personAvatar(p.user, p)}
                lookingFor={p.lookingFor || {}}
                onOpen={() => router.push(`/user/${p.userId}`)}
                action={
                  <ConnectActions userId={p.userId} name={name} headline={p.headline} connection={connections?.[p.userId]} notify={show} explore={{ source: "discover" }} />
                }
              />
            </View>
          );
        })}
      </>
    );
  };

  return (
    <>
      <Screen hideTabBar canvas onRefresh={refresh} refreshing={refreshing} contentStyle={{ padding: 0, gap: spacing.sm }}>
        <View style={{ backgroundColor: colors.surface }}>
          <TabStrip
            options={[{ value: "grow" as Mode, label: "Grow" }, { value: "looking" as Mode, label: "Who's looking" }]}
            value={mode}
            onChange={setMode}
          />
          <Pressable
            onPress={() => router.push("/network/connections")}
            style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }, pressed && { backgroundColor: colors.surfaceRaised }]}
            accessibilityRole="button"
          >
            <Icon name="people-outline" size={22} color={colors.textSecondary} />
            <Text style={[networkStyles.rowTitle, { flex: 1 }]}>Manage my network</Text>
            {connectionsList.data ? <Text style={networkStyles.rowSub}>{connectionsList.data.length}</Text> : null}
            <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>
        </View>

        {mode === "looking" ? (
          <NetworkBlock title="Looking for collaborators" subtitle="Open calls from builders — say hello to the ones that fit" flush>
            {lookingSection()}
          </NetworkBlock>
        ) : (
          <>
            {showNews && (
              <NewsBanner
                title={newsTitle}
                detail={newsDetail}
                primary={firstUpdate
                  ? { label: `See ${firstUpdate.name}`, onPress: () => (firstUpdate.kind === "builder" ? openBuilder(firstUpdate.id, 0) : openProject(firstUpdate.id, 0)) }
                  : feed.newCount > 0 ? { label: "Mark seen", onPress: markSeen } : undefined}
                secondary={firstUpdate && feed.newCount > 0 ? { label: `Mark ${feed.newCount} seen`, onPress: markSeen } : undefined}
                onDismiss={() => setNewsDismissed(true)}
              />
            )}

            {invitations.length > 0 && (
              <NetworkBlock
                title={`Invitations (${invitations.length})`}
                action={invitations.length > INVITES_SHOWN ? "Show all" : undefined}
                onAction={() => router.push("/network/invitations")}
                flush
              >
                {invitations.slice(0, INVITES_SHOWN).map((r, i) => {
                  const name = personName(r.user, r.profile);
                  return (
                    <View key={r.id}>
                      {i > 0 && <View style={networkStyles.divider} />}
                      <InvitationRow
                        name={name}
                        headline={r.profile?.headline}
                        avatarUrl={personAvatar(r.user, r.profile)}
                        note={r.note}
                        createdAt={r.createdAt}
                        busy={invites.busyId === r.id}
                        onOpen={() => router.push(`/user/${r.requesterId}`)}
                        onAccept={() => invites.accept({ id: r.id, name })}
                        onIgnore={() => invites.ignore({ id: r.id, name })}
                      />
                    </View>
                  );
                })}
              </NetworkBlock>
            )}

            <NetworkBlock
              title="People you may know"
              subtitle={updatedAt ? `Matched by Nova · updated ${timeAgo(updatedAt)}` : "Matched by Nova from your skills and projects"}
              action={builders.length ? "See all" : undefined}
              onAction={() => router.push("/matches")}
            >
              {loadingFeed ? <Loading /> : !builders.length ? (
                <Empty
                  icon="people-circle-outline"
                  title="No matches yet"
                  body="Let Nova find builders who fit what you're making. It can use 1 credit on paid plans."
                  action="Find new matches"
                  onAction={() => generate.mutate()}
                />
              ) : (
                <View style={{ gap: spacing.md }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                    {shownBuilders.map(({ item, rank }) => (
                      <PersonGridCard
                        key={item.key}
                        width={gridWidth}
                        name={item.name}
                        headline={item.headline}
                        avatarUrl={item.avatarUrl}
                        coverUrl={covers.get(item.userId)}
                        reason={item.reason}
                        skills={matchedSkills.get(item.userId)}
                        score={item.score}
                        isNew={item.isNew}
                        update={byKey.get(`builder:${item.userId}`)}
                        onOpen={() => openBuilder(item.userId, rank)}
                        onDismiss={() => setHidden((prev) => new Set(prev).add(item.key))}
                        action={
                          <ConnectActions block userId={item.userId} name={item.name} reason={item.reason} headline={item.headline} connection={connections?.[item.userId]} notify={show} explore={{ source: "discover", rankPosition: rank }} moreLikeThis={matchedSkills.get(item.userId)?.[0]} />
                        }
                      />
                    ))}
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Text style={[networkStyles.meta, { flex: 1 }]}>Finding matches can use 1 credit on paid plans, for Nova's reasons.</Text>
                    <Btn label="Find new matches" small variant="outline" icon="sparkles-outline" loading={generate.isPending} onPress={() => generate.mutate()} />
                  </View>
                </View>
              )}
              {builders.length > GRID_START && (
                <ShowMore label={gridAll ? "Show less" : `Show all ${builders.length}`} onPress={() => setGridAll((v) => !v)} />
              )}
            </NetworkBlock>

            {moreBuilders.length > 0 && (
              <NetworkBlock
                title="More builders to meet"
                subtitle="Find entrepreneurs and freelancers to join your next project"
                action="Search"
                onAction={() => router.push("/search")}
              >
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                  {shownMore.map((u) => {
                    const name = personName(u, u.profile);
                    return (
                      <PersonGridCard
                        key={u.id}
                        width={gridWidth}
                        name={name}
                        headline={u.profile?.headline}
                        avatarUrl={personAvatar(u, u.profile)}
                        coverUrl={u.profile?.coverUrl}
                        skills={u.profile?.skills ?? undefined}
                        update={byKey.get(`builder:${u.id}`)}
                        onOpen={() => {
                          trackExplore(EXPLORE.openProfile, { matchType: "builder", targetId: u.id, source: "discover" });
                          rememberSeen("builder", u.id);
                          router.push(`/user/${u.id}`);
                        }}
                        onDismiss={() => setHidden((prev) => new Set(prev).add(`more:${u.id}`))}
                        action={
                          <ConnectActions block userId={u.id} name={name} headline={u.profile?.headline} connection={connections?.[u.id]} notify={show} explore={{ source: "discover" }} moreLikeThis={u.profile?.skills?.[0]} />
                        }
                      />
                    );
                  })}
                </View>
                {moreBuilders.length > MORE_START && (
                  <ShowMore label={moreAll ? "Show less" : `Show more`} onPress={() => setMoreAll((v) => !v)} />
                )}
              </NetworkBlock>
            )}

            {projectItems.length > 0 && (
              <NetworkBlock title="Projects to follow" subtitle="Follow along and their updates come to your feed" flush>
                {shownProjects.map(({ item, rank }, i) => (
                  <View key={item.key}>
                    {i > 0 && <View style={networkStyles.divider} />}
                    <ProjectRowItem
                      title={item.title}
                      owner={item.owner}
                      blurb={item.blurb}
                      reason={item.reason}
                      roles={item.roles}
                      isNew={item.isNew}
                      update={byKey.get(`project:${item.projectId}`)}
                      onOpen={() => openProject(item.projectId, rank)}
                      action={<FollowButton projectId={item.projectId} title={item.title} following={item.following} notify={show} explore={{ source: "discover", rankPosition: rank }} moreLikeThis={categories.get(item.projectId)} />}
                    />
                  </View>
                ))}
                {projectItems.length > PROJECTS_START && (
                  <View style={{ paddingHorizontal: spacing.lg }}>
                    <ShowMore label={projectsAll ? "Show less" : `Show all ${projectItems.length}`} onPress={() => setProjectsAll((v) => !v)} />
                  </View>
                )}
              </NetworkBlock>
            )}

            {(looking.data ?? []).some((p: any) => p.userId !== meId) && (
              <NetworkBlock title="Looking for collaborators" action="See all" onAction={() => setMode("looking")} flush>
                {lookingSection(2)}
              </NetworkBlock>
            )}
          </>
        )}
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}

type BuilderItem = Extract<FeedItem, { kind: "builder" }>;
type ProjectItem = Extract<FeedItem, { kind: "project" }>;
