import { ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { colors, font, fontFamily, radius, spacing } from "../src/theme";
import { Btn, Empty, Icon, Loading, NovaGradient, errText, type IconName } from "../src/components/ui";
import { NoticeBanner, useNotice } from "../src/components/Sheet";
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
}

/* The two a person can still get into. Judging and completed are history. */
const OPEN_STATUSES: Contest["status"][] = ["upcoming", "active"];

/**
 * Contests and Communities — the web's /contests. Contests are empty on purpose
 * for now; below them, communities to join around what you're building.
 */
export default function ContestsAndCommunities() {
  const { user } = useAuth();
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
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs }}>
                    <Text style={{ color: colors.textTertiary, fontSize: font.xs + 1, fontFamily: fontFamily.regular }}>
                      {c.participantCount.toLocaleString()}{c.maxParticipants != null ? ` of ${c.maxParticipants.toLocaleString()}` : ""} entered
                    </Text>
                    {user ? (
                      <Btn
                        small
                        label={c.isParticipant ? "Entered" : full ? "Full" : "Enter"}
                        icon={c.isParticipant ? "checkmark" : undefined}
                        variant={c.isParticipant ? "outline" : "primary"}
                        disabled={c.isParticipant || full}
                        loading={busy}
                        onPress={() => enter.mutate(c)}
                        testID={c.isParticipant ? `button-entered-${c.id}` : `button-enter-${c.id}`}
                      />
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
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
