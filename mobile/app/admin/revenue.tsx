import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { Stack } from "expo-router";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, spacing } from "../../src/theme";
import { Loading, Screen } from "../../src/components/ui";
import { PageIntro, TitledCard } from "../../src/components/MoreKit";
import { NotFoundScreen, isNotFound, money, text } from "../../src/components/more/AdminKit";

/**
 * What SparkTower has collected, and how much of it is really ours — the
 * phone's half of `client/src/pages/admin-revenue.tsx`.
 *
 * Built around one identity, stated on the screen in plain words:
 *
 *     ours = collected − sent out − owed
 *
 * Every pound a card was charged is in exactly one of four places — escrow, a
 * creator's bank, somebody's spendable balance, or ours — so the last one is a
 * subtraction rather than a guess. `server/platform-revenue.ts` explains why
 * that holds and which movements are deliberately not counted.
 *
 * The liabilities are as prominent as the takings, which is the web's decision
 * and matters more on a phone where less fits above the fold: held pledges are
 * refundable to the backer and user balances are credit people can spend
 * tomorrow, so an owner who reads only the top line and plans around it is
 * planning around other people's money.
 */

interface PlatformRevenue {
  collected: { topUpsCents: number; pledgesCents: number; totalCents: number };
  sentOutCents: number;
  owed: { escrowCents: number; balancesCents: number; totalCents: number };
  mintedCents: number;
  oursCents: number;
  peopleWithBalance: number;
}

const TITLE = "Revenue";

export default function AdminRevenue() {
  const { data, isLoading, error } = useQuery<PlatformRevenue>({
    queryKey: ["admin-revenue"],
    queryFn: () => api<PlatformRevenue>("/api/admin/revenue"),
    staleTime: 0,
    retry: false,
  });

  /* The route answers 404 to anyone who should not know this exists; so does the screen. */
  if (error && isNotFound(error)) return <NotFoundScreen title={TITLE} />;

  if (isLoading || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: TITLE }} />
        <Loading />
      </View>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: TITLE }} />
      <PageIntro
        icon="cash"
        title={TITLE}
        body="What SparkTower has collected, what it owes, and what's left."
      />

      <TitledCard icon="wallet" title="SparkTower's, after everything owed">
        <Text style={{ color: colors.text, fontSize: 34, fontFamily: fontFamily.bold }} testID="text-ours">
          {money(data.oursCents)}
        </Text>
        <Text style={text.meta}>
          Cash position, not profit. Stripe's processing fees and what the model calls cost aren't
          taken off this.
        </Text>
      </TitledCard>

      <Group
        title="Collected"
        total={data.collected.totalCents}
        testID="collected"
        blurb="Money a card was actually charged for. Posting a challenge and buying action packs come out of a balance that was already topped up, so they aren't counted again here."
        rows={[
          { label: "Nova top-ups", cents: data.collected.topUpsCents, testID: "topups" },
          { label: "Backing pledges", cents: data.collected.pledgesCents, testID: "pledges" },
        ]}
      />

      <Group
        title="Already sent out"
        total={data.sentOutCents}
        testID="sentout"
        blurb="Released to creators' banks through Stripe, after our fee. This money has left."
      />

      <Group
        title="Owed to other people"
        total={data.owed.totalCents}
        testID="owed"
        blurb="Collected, but other people can still claim or spend it. Not yours to plan around."
        rows={[
          { label: "Pledges in escrow, still refundable", cents: data.owed.escrowCents, testID: "escrow" },
          {
            label: `Balances held by ${data.peopleWithBalance} ${data.peopleWithBalance === 1 ? "person" : "people"}`,
            cents: data.owed.balancesCents,
            testID: "balances",
          },
        ]}
      />

      {/*
        * Only when there is some. On a real installation this is zero, and a
        * permanent "$0.00 given away" row would be a line of noise on the one
        * screen that has to be read carefully.
        */}
      {data.mintedCents > 0 && (
        <Group
          title="Credit given away, unspent"
          total={data.mintedCents}
          testID="minted"
          blurb="Balance handed out without a card behind it — the development bypass, and support putting money on an account by hand. It isn't collected and it isn't owed, because there's nothing to give back. It's here so it isn't mistaken for either."
        />
      )}

      <Text style={[text.meta, { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }]} testID="revenue-payout-note">
        Paying SparkTower's own money out to your bank is set up in your Stripe dashboard, under
        payouts — it isn't something this screen does. What's here is the platform's position, so you
        can see how much of the Stripe balance is genuinely yours to take.
      </Text>
    </Screen>
  );
}

/** A heading with its total, the reason it is what it is, and the parts it breaks into. */
function Group({ title, total, blurb, testID, rows }: {
  title: string;
  total: number;
  blurb: string;
  testID: string;
  rows?: { label: string; cents: number; testID: string }[];
}) {
  return (
    <TitledCard title={title} action={
      <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.semibold }} testID={`text-${testID}`}>
        {money(total)}
      </Text>
    }>
      <Text style={text.meta}>{blurb}</Text>
      {rows?.length ? (
        <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle, gap: 6 }}>
          {rows.map((r) => (
            <View key={r.testID} style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm }}>
              <Text style={{ color: colors.textSecondary, fontSize: font.sm, flexShrink: 1 }}>{r.label}</Text>
              <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }} testID={`text-${r.testID}`}>
                {money(r.cents)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </TitledCard>
  );
}
