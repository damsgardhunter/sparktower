import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, fetchMe, readPref, writePref } from "../../src/api/client";
import { colors, radius, spacing } from "../../src/theme";
import {
  Avatar, Body, Btn, Card, Chip, Empty, ErrorNote, Field, Loading, Meta, Row, Screen, Segments,
} from "../../src/components/ui";
import { buildDiscoverFeed, timeAgo, type FeedItem } from "../../src/discoverFeed";
import { ConnectActions, FollowButton, useConnectionStates, type ConnectionState } from "../../src/components/ConnectActions";
import { NoticeBanner, useNotice, type Notice } from "../../src/components/Sheet";

type Mode = "people" | "looking";

/**
 * Discover: matched builders and projects to follow, connect with or message,
 * and what's new since you last looked. Plus a name search, and who's openly
 * looking for collaborators.
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
  const [mode, setMode] = useState<Mode>("people");
  const [q, setQ] = useState("");

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const meId: string | undefined = me?.user?.id;

  const matches = useQuery({ queryKey: ["matches"], queryFn: () => api<any[]>("/api/matches"), enabled: mode === "people" });
  const projects = useQuery({ queryKey: ["projects", "discover"], queryFn: () => api<any[]>("/api/projects"), enabled: mode === "people" });
  const followed = useQuery({ queryKey: ["followed-projects"], queryFn: () => api<any[]>("/api/user/followed-projects"), enabled: mode === "people" });

  const { data: search } = useQuery({
    queryKey: ["users", "search", q],
    queryFn: () => api<any[]>(`/api/users/search?q=${encodeURIComponent(q)}`),
    enabled: mode === "people" && q.trim().length > 1,
  });

  const { data: looking, isLoading: lookingLoading } = useQuery({
    queryKey: ["looking-for"],
    queryFn: () => api<any[]>("/api/looking-for"),
    enabled: mode === "looking",
  });

  // --- what's new ---------------------------------------------------------
  //
  // "Seen" is a moment this person chose — tapping the banner — not every time
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

  // --- refreshing ---------------------------------------------------------

  const refreshing = matches.isRefetching || projects.isRefetching || followed.isRefetching;
  const refresh = useCallback(() => {
    void Promise.all([matches.refetch(), projects.refetch(), followed.refetch()]);
  }, [matches, projects, followed]);

  // Coming back to the tab re-reads, so something new since the last visit
  // shows up — and the banner with it — without anyone having to pull.
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    void qc.invalidateQueries({ queryKey: ["matches"] });
    void qc.invalidateQueries({ queryKey: ["projects", "discover"] });
    void qc.invalidateQueries({ queryKey: ["followed-projects"] });
  }, [qc]));

  const updatedAt = Math.max(matches.dataUpdatedAt || 0, projects.dataUpdatedAt || 0);

  // --- quick actions -------------------------------------------------------
  //
  // One lookup for where you stand with every builder on screen, and one
  // notice for how any action went.
  const builderIds = feed.items.flatMap((item) => (item.kind === "builder" ? [item.userId] : []));
  const { data: connections } = useConnectionStates(builderIds);
  const { notice, show, clear } = useNotice();

  const generate = useMutation({
    mutationFn: () => api("/api/matches/generate", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["matches"] }),
  });

  // --- drawing --------------------------------------------------------------

  const searching = q.trim().length > 1;
  const loadingFeed = (matches.isLoading || projects.isLoading) && !searching;

  return (
    <>
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Segments
        options={[{ value: "people" as Mode, label: "For you" }, { value: "looking" as Mode, label: "Who's looking" }]}
        value={mode}
        onChange={setMode}
      />

      {mode === "people" ? (
        <>
          <Field value={q} onChangeText={setQ} placeholder="Search builders by name" autoCapitalize="none" />

          {!searching && (
            <Row between center>
              <Meta>{updatedAt ? `Updated ${timeAgo(updatedAt)}` : " "}</Meta>
              <Row gap={spacing.xs}>
                <Btn label="Refresh" variant="ghost" small loading={refreshing} onPress={refresh} />
                <Btn label="Find new matches" variant="outline" small loading={generate.isPending} onPress={() => generate.mutate()} />
              </Row>
            </Row>
          )}
          {!searching && <Meta>Finding matches can use 1 credit on paid plans, for Nova's reasons.</Meta>}

          {!searching && feed.newCount > 0 && (
            <Pressable
              onPress={markSeen}
              accessibilityRole="button"
              accessibilityLabel={`${feed.newCount} new since you last looked. Tap to mark seen.`}
              style={{
                backgroundColor: colors.primary, borderRadius: radius.pill,
                paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, alignSelf: "center",
              }}
            >
              <Body style={{ color: colors.primaryText, fontWeight: "700" }}>
                {feed.newCount} new since you last looked · Tap to mark seen
              </Body>
            </Pressable>
          )}

          {searching ? (
            !search?.length ? (
              <Empty title="No one by that name" />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {search.map((u: any) => {
                  const name = u.profile?.displayName || u.firstName || u.email || "Builder";
                  return (
                    <Card key={u.id} onPress={() => router.push(`/user/${u.id}`)}>
                      <Row center gap={spacing.md}>
                        <Avatar name={name} uri={u.profile?.avatarUrl} />
                        <View style={{ flex: 1 }}>
                          <Body style={{ fontWeight: "700" }}>{name}</Body>
                          {u.profile?.headline && <Meta numberOfLines={1}>{u.profile.headline}</Meta>}
                        </View>
                      </Row>
                    </Card>
                  );
                })}
              </View>
            )
          ) : loadingFeed ? (
            <Loading />
          ) : !feed.items.length ? (
            <Empty
              title="Nothing here yet"
              body="Find matches to see builders here. New projects show up as they're posted."
              action="Find new matches"
              onAction={() => generate.mutate()}
            />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {feed.items.map((item) => item.kind === "builder" ? (
                <BuilderCard
                  key={item.key}
                  item={item}
                  connection={connections?.[item.userId]}
                  notify={show}
                  onOpen={() => router.push(`/user/${item.userId}`)}
                />
              ) : (
                <ProjectCard
                  key={item.key}
                  item={item}
                  notify={show}
                  onOpen={() => router.push(`/project/${item.projectId}`)}
                />
              ))}
            </View>
          )}
        </>
      ) : lookingLoading ? (
        <Loading />
      ) : !looking?.length ? (
        <Empty title="Nobody's posted an open call yet" />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {looking.map((p: any) => {
            const lf = p.lookingFor || {};
            const name = p.displayName || p.user?.firstName || "Builder";
            return (
              <Card key={p.userId} onPress={() => router.push(`/user/${p.userId}`)}>
                <Row center gap={spacing.md}>
                  <Avatar name={name} />
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{name}</Body>
                    <Meta>Looking for {lf.role}</Meta>
                  </View>
                </Row>
                <Row wrap gap={spacing.xs}>
                  {(lf.industries || []).map((i: string) => <Chip key={i} label={i} small />)}
                  {lf.commitment && <Chip label={lf.commitment} small />}
                  {lf.stage && <Chip label={lf.stage} small />}
                  {lf.equityAvailable === true && <Chip label="Equity available" small />}
                </Row>
                {lf.details && <Body muted>{lf.details}</Body>}
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
    <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}

type BuilderItem = Extract<FeedItem, { kind: "builder" }>;
type ProjectItem = Extract<FeedItem, { kind: "project" }>;

/** A matched builder: who, why, when — and Connect or Message without leaving the feed. */
function BuilderCard({ item, connection, notify, onOpen }: {
  item: BuilderItem; connection?: ConnectionState; notify: (notice: Notice) => void; onOpen: () => void;
}) {
  return (
    <Card onPress={onOpen} accent={item.isNew ? colors.primary : undefined}>
      <Row center gap={spacing.md}>
        <Avatar name={item.name} uri={item.avatarUrl} />
        <View style={{ flex: 1 }}>
          <Row between center>
            <Body style={{ fontWeight: "700", flex: 1 }} numberOfLines={1}>{item.name}</Body>
            {item.isNew && <Chip label="New" small active />}
          </Row>
          {item.headline && <Meta numberOfLines={1}>{item.headline}</Meta>}
          <Meta>{item.score}% match · matched {timeAgo(item.at)}</Meta>
        </View>
      </Row>
      {item.reason && <Body muted numberOfLines={2}>{item.reason}</Body>}
      {item.skills.length > 0 && (
        <Row wrap gap={spacing.xs}>
          {item.skills.map((s) => <Chip key={s} label={s} small />)}
        </Row>
      )}
      <ConnectActions userId={item.userId} name={item.name} reason={item.reason} headline={item.headline} connection={connection} notify={notify} />
    </Card>
  );
}

/** A project: what it is, why it's here, when it appeared — and Follow in place. */
function ProjectCard({ item, notify, onOpen }: {
  item: ProjectItem; notify: (notice: Notice) => void; onOpen: () => void;
}) {
  return (
    <Card onPress={onOpen} accent={item.isNew ? colors.primary : colors.accent}>
      <Row between center>
        <Body style={{ fontWeight: "700", flex: 1 }} numberOfLines={1}>{item.title}</Body>
        {item.isNew && <Chip label="New" small active />}
      </Row>
      <Meta>by {item.owner} · posted {timeAgo(item.at)}</Meta>
      {item.blurb && <Body muted numberOfLines={2}>{item.blurb}</Body>}
      <Meta>{item.reason}</Meta>
      {item.roles.length > 0 && (
        <Row wrap gap={spacing.xs}>
          {item.roles.map((r) => <Chip key={r} label={r} small />)}
        </Row>
      )}
      <Row gap={spacing.sm}>
        <FollowButton projectId={item.projectId} title={item.title} following={item.following} notify={notify} />
        <Btn label="Open" small variant="outline" onPress={onOpen} />
      </Row>
    </Card>
  );
}
