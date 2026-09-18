import { useMemo } from "react";
import { Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { colors, font, fontFamily, spacing } from "../../../src/theme";
import { Btn, Card, Empty, Icon, Loading, Screen, errText } from "../../../src/components/ui";
import { Callout, isSwitchedOff } from "../../../src/components/MoreKit";
import { SimSectionTitle } from "../../../src/components/sim/SimKit";
import { HistoryRow, NoHistoryYet, StandingRowView, StandingsBanner, Trajectory } from "../../../src/components/sim/StandingsKit";
import { ROOM_POLL_MS, useStandings } from "../../../src/components/sim/useSim";
import {
  gapAhead, movementRead, sortRows, standingLine, trajectory, yourRow,
} from "../../../src/components/sim/standings";
import { seasonOver } from "../../../src/components/sim/lobby";

/**
 * The league table, and the season so far.
 *
 * This screen exists because a multiplayer game with no way to see the other
 * players is a single-player game with extra steps — and because it is the
 * only screen that answers "was that a good year?". The desk can show a team
 * every number about themselves and still not tell them that, since a year
 * that grew customers by a fifth is a triumph or a disaster depending entirely
 * on what everybody else did with theirs.
 *
 * Three things here are deliberate.
 *
 * **The incumbents are in the table.** They hold most of the market. Listing
 * only the five teams would tell everybody they were doing three times better
 * than they are, and the whole value of a league table is that it is not
 * flattering.
 *
 * **The trajectory sits under the table, not above it.** Where you are comes
 * first because it is what somebody opened the screen for; how you got there
 * is what they stay for.
 *
 * **A team with no customers has sold the business, and the row says so.** It
 * is a strategy — they kept the company, the seats and the money — and a row
 * that read as an empty husk would be the screen quietly calling it an
 * elimination.
 */
export default function Standings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data, isLoading, error, refetch, isRefetching } = useStandings(id);

  const rows = useMemo(() => sortRows(data?.rows), [data?.rows]);
  const you = useMemo(() => yourRow(rows), [rows]);
  const points = useMemo(() => trajectory(data?.history), [data?.history]);
  const movement = useMemo(() => movementRead(data?.history), [data?.history]);
  const gap = useMemo(() => gapAhead(rows), [rows]);

  if (isLoading) {
    return (<><Stack.Screen options={{ title: "Standings" }} /><Loading label="Counting the market…" /></>);
  }

  if (error || !data) {
    const gone = (error as any)?.status === 404;
    return (
      <>
        <Stack.Screen options={{ title: "Standings" }} />
        <Screen canvas>
          {gone ? (
            <Empty icon="lock-closed-outline" title="No table here"
              body="Either this company isn't yours, or its season isn't running."
              action="Back to your desk" onAction={() => router.replace(`/sim/desk/${id}`)} />
          ) : isSwitchedOff(error) ? (
            <Empty icon="pause-circle-outline" title="Simulations are paused"
              body="The market simulation is switched off right now." />
          ) : (
            <Empty icon="cloud-offline-outline" title="Lost the table"
              body={errText(error)} action="Try again" onAction={() => refetch()} />
          )}
        </Screen>
      </>
    );
  }

  // A finished season's table is the last word on it, and a screen that reads
  // like a live one invites somebody to wait for a change that isn't coming.
  const over = seasonOver(data.status);
  const leaderShare = rows.length > 0 ? Math.max(...rows.map((r) => r.share)) : 0;
  const teams = rows.filter((r) => r.kind === "player");

  return (
    <>
      <Stack.Screen options={{ title: "Standings" }} />
      <Screen canvas onRefresh={refetch} refreshing={isRefetching}>
        <StandingsBanner
          year={data.year}
          totalYears={data.totalYears}
          you={you}
          line={standingLine(rows)}
          gap={gap?.line ?? null}
        />

        {over ? (
          <Callout
            icon="flag"
            tone="info"
            title="Final standings"
            body="The season is finished. This is how it ended — and being bought along the way was never being knocked out of it."
          />
        ) : null}

        <Card>
          <SimSectionTitle icon="podium" title={over ? "How it finished" : "The market, in order"} />
          <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
            {teams.length} team{teams.length === 1 ? "" : "s"} and {rows.length - teams.length} incumbents, ranked by
            customers. Share is of every customer in the market, not of the teams.
          </Text>
          {rows.map((row) => (
            <StandingRowView key={row.id} row={row} leaderShare={leaderShare} />
          ))}
        </Card>

        {/* How the season has gone, which is the question the table can't
            answer on its own: third place is a climb or a slide depending
            entirely on where you were standing last year. */}
        <Card accent={colors.novaEmerald}>
          <SimSectionTitle icon="trending-up" title="Your season so far" color={colors.novaEmerald} />
          {points.length === 0 ? (
            <NoHistoryYet year={data.year} />
          ) : (
            <>
              {movement ? (
                <Text style={{ color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.medium }}>
                  {movement}
                </Text>
              ) : null}
              <Trajectory points={points} />
              <View style={{ paddingTop: spacing.xs }}>
                {points.map((point, i) => (
                  <HistoryRow key={point.year} point={point} previousShare={i > 0 ? points[i - 1].share : null} />
                ))}
              </View>
              <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
                Bars are your share of the market, scaled to your own best year so a few points of a crowded market still
                has a shape. The figures beside them are the real ones.
              </Text>
            </>
          )}
        </Card>

        <Card onPress={() => router.push(`/sim/offers/${id}`)}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Icon name="briefcase" size={20} color={colors.novaPurple} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>Acquisitions</Text>
              <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
                What every team on this table is worth, and what it would take to buy one of them.
              </Text>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
          </View>
        </Card>

        <Btn label="Back to your desk" icon="arrow-back" variant="outline" onPress={() => router.back()} testID="standings-back" />

        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingTop: spacing.xs }}>
          <Icon name={over ? "flag-outline" : "refresh"} size={12} color={colors.textTertiary} />
          <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
            {over ? "Season finished · this table is final" : `Settles on the tick · refreshes every ${ROOM_POLL_MS / 1000} seconds`}
          </Text>
        </View>
      </Screen>
    </>
  );
}
