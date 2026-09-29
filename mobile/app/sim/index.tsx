import { useState } from "react";
import { Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Card, Empty, Icon, Loading, NovaGradient, Screen, errText } from "../../src/components/ui";
import { Pill, isSwitchedOff, tintSoft } from "../../src/components/MoreKit";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { Disclosure, IncumbentRow, LeverList, SegmentRow, SimSectionTitle, VentureResumeRow } from "../../src/components/sim/SimKit";
import { useNiches, useVentures } from "../../src/components/sim/useSim";
import { formatCount, incumbentHold, liveVentures, ventureRoute, type LiveVenture, type SimNiche, type SimRole } from "../../src/components/sim/lobby";

/**
 * Choosing a market, which is choosing a world.
 *
 * The temptation here is a list of two names and a Join button, and it would
 * be the wrong screen: a niche isn't a label, it's who the customers are and
 * who already has them. So each market shows its premise, the ~90% the
 * incumbents hold and how each of them fights, and — the number that actually
 * decides whether a market is winnable — how loyal each segment is. A team
 * that reads this picks a fight it can win; a team that picks the nicer name
 * spends four years finding out.
 *
 * Above all of that, though, come the companies you are already running. A
 * season is fourteen real days: someone opening this on day six has four
 * people waiting on them, and a screen that offers only a list of markets to
 * join has told them they are nowhere. Joining the same market does return
 * the room they are in — the server is careful about that — but nobody would
 * think to press it.
 */
export default function PickMarket() {
  const router = useRouter();
  const { notice, show, clear } = useNotice();
  const { data, isLoading, isRefetching, refetch, error } = useNiches();
  const { data: ventureData } = useVentures();
  const [openSeats, setOpenSeats] = useState(false);

  const mine = liveVentures(ventureData?.ventures);
  const roleTitles = roleTitleMap(data?.roles);
  const resume = (
    <ResumeList ventures={mine} roleTitles={roleTitles} onOpen={(v) => router.push(ventureRoute(v) as any)} />
  );

  /*
   * Joining is not optimistic either: the server decides which room has space,
   * and pushing to a venture id we invented would be a screen with nothing
   * behind it. `replace`, not `push` — coming back out of a room should reach
   * the markets, not a market picker with a stale join in progress.
   */
  const join = useMutation({
    mutationFn: (nicheId: string) => api<{ ventureId: string }>("/api/sim/join", { method: "POST", body: { nicheId } }),
    onSuccess: ({ ventureId }) => router.replace(`/sim/${ventureId}`),
    onError: (err: any) => show({ tone: "error", text: errText(err, "Couldn't get you into a room. Try again.") }),
  });

  if (isLoading) return (<><Stack.Screen options={{ title: "Start a company" }} /><Loading label="Finding the markets…" /></>);

  if (error) {
    return (
      <>
        <Stack.Screen options={{ title: "Start a company" }} />
        <Screen canvas>
          {/* A market list that won't load is no reason to strand somebody
              outside a company they are already running. */}
          {resume}
          {isSwitchedOff(error) ? (
            <Empty icon="pause-circle-outline" title="Simulations are paused"
              body="The market simulation is switched off right now. Check back soon." />
          ) : (
            <Empty icon="cloud-offline-outline" title="Couldn't load the markets"
              body={errText(error)} action="Try again" onAction={() => refetch()} />
          )}
        </Screen>
      </>
    );
  }

  const niches = data?.niches ?? [];
  const roles = data?.roles ?? [];
  const lobbySize = data?.lobbySize ?? 5;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "Start a company" }} />
      <Screen canvas onRefresh={refetch} refreshing={isRefetching}>
        {resume}

        {/*
          * The door to a market of your own, above the seven we wrote.
          *
          * Somebody whose business is already in this app should not have to
          * rehearse it in a dating-app market. Offered here rather than on the
          * project page because that page is the public one and this is the
          * owner's door — pressing it stands a company up.
          */}
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>
              Or run one built around your own project
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
              Nova reads what you are building and writes the market it is actually in — who buys, and the four
              companies that already have them.
            </Text>
            <Btn
              label="Have Nova Customize my Season"
              icon="sparkles-outline"
              variant="outline"
              small
              onPress={() => router.push("/sim/from-project" as any)}
              testID="button-from-project"
            />
            {/*
              * And the other half of the feature: the same business, run on
              * its real numbers rather than in a market. A season is a game;
              * these answer "can I afford to hire her" on the figures the
              * owner actually has.
              */}
            <Btn
              label="Or run your own numbers"
              icon="calculator-outline"
              variant="ghost"
              small
              onPress={() => router.push("/sim/business" as any)}
              testID="button-business-sims"
            />
          </View>
        </Card>

        {mine.length === 0 ? (
        <NovaGradient style={{ borderRadius: radius.md, padding: spacing.lg, gap: 6 }}>
          <Text style={{ color: "#FFFFFF", fontSize: font.xl, fontFamily: fontFamily.bold, letterSpacing: -0.3 }}>
            {lobbySize} strangers. One company.
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
            You'll take a seat between {lobbySize} of you and run a business against the companies that already own the market.
            A day is a year; a season is fourteen of them. Pick where you're starting — it decides what winning looks like.
          </Text>
        </NovaGradient>
        ) : null}

        {niches.length === 0 ? (
          <Card style={{ borderStyle: "dashed" }}>
            <Empty icon="map-outline" title="No markets open"
              body="There's nothing running right now. Pull to refresh in a minute." />
          </Card>
        ) : (
          <>
            <SimSectionTitle
              icon="map"
              title={mine.length > 0 ? `Join another market (${niches.length})` : `Markets (${niches.length})`}
            />
            {niches.map((niche) => (
              <NicheCard
                key={niche.id}
                niche={niche}
                joining={join.isPending && join.variables === niche.id}
                // One join at a time: two in flight means two rooms and a
                // person in whichever answered last.
                disabled={join.isPending}
                onJoin={() => join.mutate(niche.id)}
              />
            ))}
          </>
        )}

        {/* The seats, before you have to argue for one. Collapsed by default —
            it's five headings of homework, and it matters most to the person
            deciding whether to join at all. */}
        {roles.length > 0 && (
          <Card>
            <Disclosure
              label={openSeats ? "Hide the five seats" : `What the ${roles.length} seats control`}
              open={openSeats}
              onPress={() => setOpenSeats((v) => !v)}
              testID="sim-toggle-seats"
            />
            {openSeats && (
              <View style={{ gap: spacing.md, marginTop: spacing.xs }}>
                <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
                  The levers multiply rather than add — marketing on a product nobody can deliver buys churn. Nobody wins one of
                  these alone.
                </Text>
                {roles.map((role) => (
                  <View key={role.id} style={{ gap: 4 }}>
                    <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{role.title}</Text>
                    <LeverList levers={role.levers} />
                  </View>
                ))}
              </View>
            )}
          </Card>
        )}
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}

function NicheCard({ niche, onJoin, joining, disabled }: {
  niche: SimNiche;
  onJoin: () => void;
  joining: boolean;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hold = incumbentHold(niche.incumbents);
  const total = niche.segments.reduce((sum, s) => sum + s.size, 0);
  // The one segment a new entrant can actually reach in year one, named up
  // front so the choice can be made without opening the detail.
  const softest = niche.segments.reduce((best, s) => (s.loyalty < best.loyalty ? s : best), niche.segments[0]);

  return (
    <Card>
      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>{niche.name}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
          {niche.premise}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" }}>
        <Pill label={`${hold}% already held`} icon="business-outline" color={colors.danger} />
        <Pill label={`${formatCount(total)} customers`} icon="people-outline" color={colors.info} />
        {softest ? <Pill label={`Way in: ${softest.name}`} icon="enter-outline" color={colors.success} /> : null}
      </View>

      <View style={{
        flexDirection: "row", alignItems: "flex-start", gap: 6, padding: spacing.sm,
        borderRadius: radius.sm, backgroundColor: tintSoft(colors.danger, 0.07),
      }}>
        <Icon name="information-circle" size={15} color={colors.danger} />
        <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
          {niche.incumbents.length} companies hold {hold}% of this market between them. You start with none of it.
        </Text>
      </View>

      <Disclosure
        label={open ? "Hide the detail" : "Who's here, and who you can take"}
        open={open}
        onPress={() => setOpen((v) => !v)}
        testID={`sim-niche-detail-${niche.id}`}
      />

      {open && (
        <View style={{ gap: spacing.sm }}>
          <SimSectionTitle icon="shield-half" title="Who already has the customers" color={colors.danger} />
          {niche.incumbents.length === 0
            ? <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>An open field — unusual, and it won't last.</Text>
            : niche.incumbents.map((inc) => <IncumbentRow key={inc.name} incumbent={inc} />)}

          <SimSectionTitle icon="people-circle" title="Who the customers are" color={colors.info} />
          {niche.segments.length === 0
            ? <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>No segments listed for this market.</Text>
            : niche.segments.map((seg) => (
                <SegmentRow key={seg.id} segment={seg} share={total > 0 ? Math.round((seg.size / total) * 100) : 0} />
              ))}
        </View>
      )}

      <Btn
        label={joining ? "Finding you a room…" : `Start in ${niche.name}`}
        icon="arrow-forward"
        loading={joining}
        disabled={disabled && !joining}
        onPress={onJoin}
        testID={`sim-join-${niche.id}`}
      />
    </Card>
  );
}

/**
 * The companies you already hold a seat in, above everything else.
 *
 * Renders nothing at all when there are none — the market picker is the whole
 * screen for a first-time player, and an empty "your companies" heading is a
 * box that says you have nothing.
 */
function ResumeList({ ventures, roleTitles, onOpen }: {
  ventures: LiveVenture[];
  roleTitles: Record<string, string>;
  onOpen: (venture: LiveVenture) => void;
}) {
  if (ventures.length === 0) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <SimSectionTitle icon="briefcase" title={ventures.length === 1 ? "Your company" : `Your companies (${ventures.length})`} />
      {ventures.map((venture) => (
        <VentureResumeRow
          key={venture.id}
          venture={venture}
          roleTitle={venture.role ? roleTitles[venture.role] ?? null : null}
          onPress={() => onOpen(venture)}
        />
      ))}
    </View>
  );
}

/** Seat id → the title the server gave it, so a row can say "you're the Chief Executive". */
function roleTitleMap(roles: SimRole[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const role of roles ?? []) map[role.id] = role.title;
  return map;
}
