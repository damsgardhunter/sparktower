/**
 * Last year, on the phone.
 *
 * The web has three tabs on its desk — what just happened, what to do about it,
 * where that leads — and the phone had one long scroll that was almost entirely
 * the middle one. It could say what happened to the company and never what the
 * five of them did to cause it: the decisions live on the desk for a fortnight
 * and then vanish, and sealed bids are deleted the moment they settle. A
 * phone-only table could lose a third of its cash at auction and afterwards have
 * nothing to look at but one line of prose saying so.
 *
 * A route rather than a tab, which is the same choice the seat and company
 * profiles made: `/sim/past/<venture>` is somewhere a notification can land, and
 * the desk is already long enough without three screens inside it.
 *
 * Everything here was on the wire already. `lastFiled` and `standing` have been
 * in the desk payload since the web's Past tab was built; the phone simply never
 * read them.
 */
import { Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { colors, font, fontFamily, spacing } from "../../../src/theme";
import { Btn, Card, Empty, Loading, Screen, errText } from "../../../src/components/ui";
import { useDesk } from "../../../src/components/sim/useSim";
import { AtAuction, WhatTheTableDecided, WhereTheMarketSits } from "../../../src/components/sim/PastKit";
import { EventCard, ReportCard } from "../../../src/components/sim/DeskKit";

export default function Past() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error } = useDesk(id);

  if (isLoading) {
    return (<><Stack.Screen options={{ title: "Last year" }} /><Loading label="Reading the year behind you…" /></>);
  }

  if (error || !data) {
    return (
      <>
        <Stack.Screen options={{ title: "Last year" }} />
        <Screen canvas>
          <Empty
            icon="time-outline"
            title="That season isn't here"
            body={errText(error, "It either doesn't exist or you're not at that table.")}
          />
          <Btn label="Back to your desk" icon="arrow-back" variant="outline" onPress={() => router.replace(`/sim/desk/${id}`)} />
        </Screen>
      </>
    );
  }

  const last = data.lastYear ?? null;
  const voice = data.niche?.voice;

  return (
    <>
      <Stack.Screen options={{ title: last ? `Year ${last.year}` : "Last year" }} />
      <Screen canvas>
        {/*
          * Year one has no year behind it, and saying so plainly beats three
          * empty cards. The premise is the thing to read instead: it is the only
          * guidance a table gets before its first decision.
          */}
        {!last ? (
          <Card testID="past-year-one">
            <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>Year one</Text>
            <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular, marginTop: 4 }}>
              {data.niche?.premise} Nobody has heard of you yet — that is the first problem to solve.
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular, marginTop: spacing.sm }}>
              Once a year has resolved, this is where what the table filed, what it bought and where everybody ended up will be.
            </Text>
          </Card>
        ) : (
          <>
            <ReportCard report={last} onOpen={() => router.push(`/sim/report/${id}?year=${last.year}` as any)} />
            {last.event ? <EventCard event={last.event} year={last.year} /> : null}

            <WhatTheTableDecided
              year={last.year}
              seats={(data.table ?? []).map((seat) => ({
                userId: seat.userId,
                name: seat.name,
                role: seat.role ?? null,
                title: seat.title ?? null,
                isYou: !!seat.isYou,
              }))}
              filed={data.lastFiled?.decisions ?? null}
            />

            {/*
              * Which company is yours, taken from the standing's own `isYou`
              * rather than assumed. A venture id and its company id are the same
              * string today and that is an implementation detail of how a world
              * is built, not a promise — and getting it wrong here would quietly
              * tell a team it lost a lot it actually won.
              */}
            <AtAuction
              auctions={(last as any).auctions ?? []}
              yourCompanyId={(data.standing ?? []).find((row) => row.isYou)?.id ?? null}
            />
          </>
        )}

        {/*
          * Where everyone sits is worth reading in year one too — it is the
          * market a table is about to walk into, not only the one it has played.
          */}
        <WhereTheMarketSits standing={data.standing ?? []} voice={voice} />

        <Btn
          label="What's coming"
          icon="telescope-outline"
          variant="outline"
          onPress={() => router.push(`/sim/future/${id}`)}
          testID="past-to-future"
        />
        <Btn
          label="Back to your desk"
          icon="arrow-back"
          variant="outline"
          onPress={() => router.replace(`/sim/desk/${id}`)}
        />
      </Screen>
    </>
  );
}
