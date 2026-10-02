import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { colors, font, fontFamily, radius, spacing } from "../src/theme";
import { Avatar, Btn, Empty, Icon, Loading, NovaGradient, errText, type IconName } from "../src/components/ui";
import { NoticeBanner, Sheet, useNotice } from "../src/components/Sheet";
import { money as gameMoney } from "../src/components/game/model";
import { FeaturedContestCard } from "../src/components/FeaturedContest";

interface Community {
  id: string; slug: string; name: string; tagline: string; description: string;
  icon: string; color: string; members: number; joined: boolean;
}

const ICONS: Record<string, IconName> = { user: "person", sparkles: "sparkles", layers: "layers", rocket: "rocket", "hand-coins": "cash", store: "storefront" };
const KEY = ["communities"];
const CONTESTS_KEY = ["contests"];

/**
 * A contest, as `GET /api/contests` returns it. Mirrors the web's shape in
 * `client/src/pages/contests.tsx`.
 */
interface Contest {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  status: "upcoming" | "active" | "judging" | "completed";
  prize: string | null;
  maxParticipants: number | null;
  participantCount: number;
  isParticipant: boolean;
  /**
   * The viewer's own entry, once they have filed one. Null while they have only
   * joined — which is the distinction that did not exist until now, and the
   * reason entering was a dead end on both clients: nothing could tell somebody
   * who was in from somebody who had actually filed, so nothing offered to file.
   */
  submission: { url: string | null; note: string | null } | null;
  /** Set when the product scores this contest itself rather than a person judging it. */
  scoredBy: string | null;
}

/** One row of a scored contest's table, from `GET /api/contests/:id/standings`. */
interface Standing {
  userId: string;
  name: string;
  avatarUrl: string | null;
  best: number | null;
  gameId: string | null;
  company: string | null;
  played: number;
  rank: number | null;
}

interface Standings {
  from: string;
  to: string;
  open: boolean;
  standings: Standing[];
  played: number;
  entrants: number;
}

/**
 * One entrant, as `GET /api/contests/:id/participants` returns them.
 *
 * Deliberately not the entry. That route is readable signed out, so it answers
 * with who is in and whether they have filed — never what anybody else filed,
 * which would be every rival's work readable before judging. `submission` is
 * only ever your own.
 */
interface Entrant {
  userId: string;
  name: string;
  avatarUrl: string | null;
  joinedAt: string;
  hasSubmitted: boolean;
  submission: { url: string | null; note: string | null } | null;
}

/**
 * What each self-scoring contest ranks, in a sentence.
 *
 * A copy of `CONTEST_SCORERS` in shared/contests.ts, because Metro will not
 * resolve the alias — so a test compares the two rather than trusting them to
 * stay in step. An unknown id falls back to a plain sentence rather than
 * rendering the raw enum value at somebody.
 */
const SCORERS: Record<string, string> = {
  ten_years_from_now:
    "Each entrant's highest ten-year valuation from a game played while the contest is open. Nothing is filed and nobody judges it.",
};

/* The two a person can still get into. Judging and completed are history. */
const OPEN_STATUSES: Contest["status"][] = ["upcoming", "active"];

/**
 * Contests and Communities — the web's /contests. Contests are empty on purpose
 * for now; below them, communities to join around what you're building.
 */
export default function ContestsAndCommunities() {
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const { data: communities, isLoading } = useQuery({ queryKey: KEY, queryFn: () => api<Community[]>("/api/communities") });
  /*
   * The real contests, which this screen did not ask for at all: it showed the
   * communities list and the featured card, so a contest somebody had actually
   * opened was invisible on the phone and could not be entered from it.
   */
  const { data: contests, isLoading: contestsLoading } = useQuery({
    queryKey: CONTESTS_KEY,
    queryFn: () => api<Contest[]>("/api/contests"),
  });
  const openContests = (contests ?? []).filter((c) => OPEN_STATUSES.includes(c.status));
  /*
   * Joining and leaving write the row straight into the cache on success, so a
   * failure changed nothing at all on screen: the button stopped spinning, the
   * label still said "Join", and there was no way to tell a refused request
   * from a tap that didn't land. People tap again, which is a second request to
   * an endpoint that may have refused the first one for rate-limiting it.
   */
  const toggle = useMutation({
    mutationFn: (c: Community) => api<Community>(`/api/communities/${c.slug}/join`, { method: c.joined ? "DELETE" : "POST" }),
    onSuccess: (updated) => qc.setQueryData<Community[]>(KEY, (list) => list?.map((c) => (c.id === updated.id ? updated : c))),
    onError: (e, c) => show({ tone: "error", text: errText(e, c.joined ? `Couldn't leave ${c.name}. You're still a member.` : `Couldn't join ${c.name}. Try again.`) }),
  });
  const enter = useMutation({
    mutationFn: (c: Contest) => api(`/api/contests/${c.id}/join`, { method: "POST" }),
    /*
     * Refetched rather than patched into the cache: entering changes the entry
     * count as well as your own state, and the count is what tells the next person
     * whether a capped contest still has room.
     */
    onSuccess: () => { void qc.invalidateQueries({ queryKey: CONTESTS_KEY }); show({ text: "You're entered.", tone: "success" }); },
    /* Said out loud, for the reason the comment above `toggle` gives: a silent
       failure leaves a button that still says "Enter" and no way to tell a refusal
       from a tap that did not land. */
    onError: (e, c) => show({ tone: "error", text: errText(e, `Couldn't enter ${c.title}. Try again.`) }),
  });
  /*
   * Filing the work. A sheet rather than a screen: it is a link and a sentence,
   * and a contest entered on a phone is usually filed from the same place a
   * minute later.
   */
  const [filing, setFiling] = useState<Contest | null>(null);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  const openFiling = (c: Contest) => {
    /* Seeded from what is already filed, so changing a link is an edit and not a retype. */
    setUrl(c.submission?.url ?? "");
    setNote(c.submission?.note ?? "");
    setFiling(c);
  };

  const submit = useMutation({
    mutationFn: (c: Contest) =>
      api(`/api/contests/${c.id}/submit`, {
        method: "POST",
        body: { submissionUrl: url.trim(), submissionNote: note.trim() || undefined },
      }),
    onSuccess: (_r, c) => {
      setFiling(null);
      void qc.invalidateQueries({ queryKey: CONTESTS_KEY });
      show({ text: c.submission ? "Entry updated." : "Entry filed. Good luck.", tone: "success" });
    },
    /*
     * The server's own sentence, because every refusal here is actionable and
     * specific: the link isn't a link, the contest hasn't opened, it has closed.
     * A generic message would leave somebody retyping a perfectly good URL.
     */
    onError: (e) => show({ tone: "error", text: errText(e, "Couldn't file that entry.") }),
  });

  /*
   * Who else is in. Fetched only when somebody opens it — a contest card showing
   * every entrant by default would be a request per card on a screen that already
   * makes two.
   */
  const [showing, setShowing] = useState<Contest | null>(null);
  const entrants = useQuery<Entrant[]>({
    queryKey: ["contest", showing?.id, "entrants"],
    queryFn: () => api<Entrant[]>(`/api/contests/${showing!.id}/participants`),
    enabled: !!showing,
  });

  /* The table for a scored contest, fetched on open for the same reason as the entrants. */
  const [viewing, setViewing] = useState<Contest | null>(null);
  const standings = useQuery<Standings>({
    queryKey: ["contest", viewing?.id, "standings"],
    queryFn: () => api<Standings>(`/api/contests/${viewing!.id}/standings`),
    enabled: !!viewing,
  });

  const label = { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold, letterSpacing: 0.8, textTransform: "uppercase" as const };

  return (
    <>
      <Stack.Screen options={{ title: "Contests and Communities" }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ paddingBottom: spacing.xxl * 2, gap: spacing.lg }}>
        <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border }}>
          <NovaGradient style={{ height: 4 }} />
          <View style={{ padding: spacing.lg, flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Icon name="trophy" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold }}>Contests and Communities</Text>
              <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular }}>Build against a brief, and find people building what you're building.</Text>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.lg }}>
          <Text style={label}>Contests</Text>
          {/*
            * Open contests first, then the standing offer. A contest somebody can
            * enter this week outranks one that has not opened yet, however much
            * larger the prize — and the featured card is deliberately not in this
            * list, because it is not a row in `contests` at all.
            */}
          <View style={{ paddingTop: spacing.md, gap: spacing.md }} testID="list-contests">
            {contestsLoading ? <Loading /> : openContests.map((c) => {
              const full = c.maxParticipants != null && c.participantCount >= c.maxParticipants;
              const busy = enter.isPending && enter.variables?.id === c.id;
              return (
                <View
                  key={c.id}
                  testID={`contest-${c.id}`}
                  style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm }}
                >
                  <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "flex-start" }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{c.title}</Text>
                      <Text style={{ color: colors.textTertiary, fontSize: font.xs + 1, fontFamily: fontFamily.regular }}>
                        {c.status === "active" ? "Open now" : "Opening soon"} · {c.category} · {c.difficulty}
                      </Text>
                    </View>
                    {c.prize ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: `${colors.warning}66`, backgroundColor: `${colors.warning}1A`, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
                        <Icon name="trophy" size={12} color={colors.warning} />
                        <Text style={{ color: colors.warning, fontSize: font.xs, fontFamily: fontFamily.semibold }}>{c.prize}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text numberOfLines={3} style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>{c.description}</Text>
                  {/* How it is decided, when it isn't a person reading entries. */}
                  {c.scoredBy ? (
                    <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                      <Icon name="game-controller" size={13} color={colors.textTertiary} />
                      <Text style={{ flex: 1, color: colors.textTertiary, fontSize: font.xs + 1, fontFamily: fontFamily.regular, lineHeight: 17 }} testID={`text-scored-${c.id}`}>
                        {SCORERS[c.scoredBy] ?? "Scored from your games."}
                      </Text>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs }}>
                    {/*
                      * The count opens the list of who is in. A contest is partly
                      * about who else turned up, and on a phone that is a tap
                      * rather than a second screen.
                      */}
                    <Pressable onPress={() => setShowing(c)} hitSlop={8} accessibilityRole="button" testID={`entrants-${c.id}`}>
                      <Text style={{ color: colors.textTertiary, fontSize: font.xs + 1, fontFamily: fontFamily.regular }}>
                        {c.submission?.url
                          /* What they filed, so the card is a receipt and not just a state. */
                          ? "Your entry is in · see who else"
                          : `${c.participantCount.toLocaleString()}${c.maxParticipants != null ? ` of ${c.maxParticipants.toLocaleString()}` : ""} entered`}
                      </Text>
                    </Pressable>
                    {user ? (
                      /*
                       * A scored contest has nothing to file: the next thing is
                       * to play, and the thing worth seeing is where everybody
                       * stands.
                       */
                      c.scoredBy ? (
                        <View style={{ flexDirection: "row", gap: spacing.sm }}>
                          <Btn label="Standings" small variant="outline" icon="trophy" onPress={() => setViewing(c)} testID={`button-standings-${c.id}`} />
                          {c.isParticipant ? (
                            <Btn label="Play" small onPress={() => router.push("/(tabs)/sprints" as any)} testID={`button-play-${c.id}`} />
                          ) : (
                            <Btn label={full ? "Full" : "Enter"} small disabled={full} loading={busy} onPress={() => enter.mutate(c)} testID={`button-enter-${c.id}`} />
                          )}
                        </View>
                      ) : c.isParticipant ? (
                        /*
                         * In, so the next thing is the work. An upcoming contest
                         * takes entrants but not submissions, so it says it is
                         * waiting rather than offering a button the server would
                         * refuse.
                         */
                        c.status === "active" ? (
                          <Btn
                            small
                            label={c.submission ? "Change entry" : "File your entry"}
                            icon={c.submission ? "checkmark-circle" : "cloud-upload"}
                            variant={c.submission ? "outline" : "primary"}
                            onPress={() => openFiling(c)}
                            testID={`button-file-${c.id}`}
                          />
                        ) : (
                          <Text style={{ color: colors.textTertiary, fontSize: font.xs + 1, fontFamily: fontFamily.regular }}>
                            Entered — file your work when it opens
                          </Text>
                        )
                      ) : (
                        <Btn
                          small
                          label={full ? "Full" : "Enter"}
                          disabled={full}
                          loading={busy}
                          onPress={() => enter.mutate(c)}
                          testID={`button-enter-${c.id}`}
                        />
                      )
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
          <View style={{ paddingTop: spacing.md, paddingBottom: spacing.md }}>
            <FeaturedContestCard />
          </View>
        </View>

        <View testID="section-communities" style={{ paddingHorizontal: spacing.lg, gap: spacing.md, borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.lg }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={label}>Communities</Text>
            {communities ? <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>{communities.filter((c) => c.joined).length} joined</Text> : null}
          </View>
          {isLoading ? <Loading /> : !communities?.length ? (
            <Empty icon="people-outline" title="No communities yet" body="Communities will show up here." />
          ) : communities.map((c) => {
            const busy = toggle.isPending && toggle.variables?.id === c.id;
            return (
              <View key={c.id} testID={`community-${c.slug}`} style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm }}>
                <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
                  <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: `${c.color}1A`, alignItems: "center", justifyContent: "center" }}>
                    <Icon name={ICONS[c.icon] ?? "people"} size={20} color={c.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{c.name}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular }}>{c.tagline}</Text>
                  </View>
                </View>
                <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>{c.description}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs }}>
                  <Text style={{ color: colors.textTertiary, fontSize: font.xs + 1, fontFamily: fontFamily.regular }}>{c.members.toLocaleString()} {c.members === 1 ? "member" : "members"}</Text>
                  {user ? <Btn small label={c.joined ? "Joined" : "Join"} icon={c.joined ? "checkmark" : undefined} variant={c.joined ? "outline" : "primary"} loading={busy} onPress={() => toggle.mutate(c)} /> : null}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/*
        * Filing the work: a link, and optionally a sentence about it. The link is
        * the entry — the note is for the thing a judge would otherwise have to
        * guess, like which part you built.
        */}
      <Sheet
        visible={!!filing}
        onClose={() => setFiling(null)}
        title={filing?.submission ? "Change your entry" : "File your entry"}
        subtitle={filing?.title}
      >
        <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular, marginBottom: spacing.sm }}>
          A link to what you built — a live page, a repository, a video. You can change it
          until entries close.
        </Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="https://"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={{
            backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
            paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text,
            fontSize: font.sm, fontFamily: fontFamily.regular,
          }}
          testID="input-submission-url"
        />
        <Text style={{ color: colors.textTertiary, fontSize: font.xs + 1, fontFamily: fontFamily.regular, marginTop: spacing.md, marginBottom: 4 }}>
          Anything the judge should know (optional)
        </Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={2000}
          placeholder="What it does, and what you'd do next."
          placeholderTextColor={colors.textTertiary}
          style={{
            backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
            padding: spacing.md, minHeight: 72, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular,
          }}
          testID="input-submission-note"
        />
        <Btn
          label={filing?.submission ? "Save the change" : "File it"}
          style={{ marginTop: spacing.lg }}
          loading={submit.isPending}
          /*
           * Only the obviously-empty case is stopped here. Whether a link is a
           * link is the server's judgement, and it says so in a sentence this
           * screen shows — two places deciding would drift.
           */
          disabled={!url.trim() || submit.isPending}
          onPress={() => filing && submit.mutate(filing)}
          testID="submit-entry"
        />
      </Sheet>

      {/*
        * The table for a scored contest. Your own row is marked in place rather
        * than pulled to the top — a leaderboard that moves you is harder to read.
        */}
      <Sheet
        visible={!!viewing}
        onClose={() => setViewing(null)}
        title="Standings"
        subtitle={viewing?.title}
      >
        {standings.isLoading ? (
          <Loading />
        ) : !standings.data ? (
          <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular }}>
            Couldn't load the standings.
          </Text>
        ) : (
          <>
            <Text style={{ color: colors.textTertiary, fontSize: font.xs + 1, fontFamily: fontFamily.regular, marginBottom: spacing.sm }}>
              {standings.data.played} of {standings.data.entrants} entrants have played.
              {standings.data.open ? " Still open." : " Closed — these are final."}
            </Text>
            {standings.data.standings.map((row) => {
              const you = row.userId === user?.id;
              return (
                <View
                  key={row.userId}
                  testID={`standing-${row.userId}`}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: spacing.sm,
                    paddingVertical: spacing.sm, paddingHorizontal: you ? spacing.sm : 0,
                    borderRadius: radius.sm,
                    backgroundColor: you ? colors.primarySoft : "transparent",
                  }}
                >
                  <Text style={{ width: 26, color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>
                    {row.rank ?? "—"}
                  </Text>
                  <Avatar uri={row.avatarUrl} name={row.name} size={30} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>
                      {row.name}{you ? " (you)" : ""}
                    </Text>
                    {/* What they built, so a row reads like something somebody did. */}
                    {row.company ? (
                      <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
                        {row.company}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>
                      {row.best == null ? "—" : gameMoney(row.best)}
                    </Text>
                    <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
                      {row.played === 0 ? "not played" : `${row.played} ${row.played === 1 ? "game" : "games"}`}
                    </Text>
                  </View>
                </View>
              );
            })}
            {/*
              * Partners share one verdict, so they share a number and a rank.
              * Said once, rather than leaving somebody to think the table is broken.
              */}
            <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular, marginTop: spacing.sm, lineHeight: 16 }}>
              Best ten-year valuation from a game played while the contest is open. The game is played
              in pairs, so partners share a result.
            </Text>
          </>
        )}
      </Sheet>

      {/*
        * Who is in. Names, faces, and whether each has filed — which is all the
        * route publishes, and all it should: an entrant's work is theirs until
        * judging is done.
        */}
      <Sheet
        visible={!!showing}
        onClose={() => setShowing(null)}
        title="Who's entered"
        subtitle={showing?.title}
      >
        {entrants.isLoading ? (
          <Loading />
        ) : !entrants.data?.length ? (
          <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular }}>
            Nobody yet. Be first.
          </Text>
        ) : (
          <>
            <Text style={{ color: colors.textTertiary, fontSize: font.xs + 1, fontFamily: fontFamily.regular, marginBottom: spacing.sm }}>
              {entrants.data.filter((e) => e.hasSubmitted).length} of {entrants.data.length} have filed their work.
            </Text>
            {entrants.data.map((e) => (
              <View
                key={e.userId}
                style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm }}
              >
                <Avatar uri={e.avatarUrl} name={e.name} size={32} />
                <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular }}>{e.name}</Text>
                {/*
                  * Filed or not — never *what*. The one fact about somebody
                  * else's entry that is fair to show before judging.
                  */}
                <Text style={{ color: e.hasSubmitted ? colors.success : colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
                  {e.hasSubmitted ? "filed" : "entered"}
                </Text>
              </View>
            ))}
          </>
        )}
      </Sheet>

      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
