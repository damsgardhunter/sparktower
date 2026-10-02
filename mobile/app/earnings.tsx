import { Text, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { colors, font, fontFamily, spacing } from "../src/theme";
import { Empty, Loading, Screen, errText } from "../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../src/components/MoreKit";
import { Pill } from "../src/components/nova/Pill";
import { NoticeBanner, useNotice } from "../src/components/Sheet";
import { ChoiceList, CountRow, money, text } from "../src/components/more/AdminKit";

/**
 * What you have earned, and where the next of it goes — the phone's half of
 * `client/src/pages/earnings.tsx`.
 *
 * The phone could already read `/api/payouts`, so it could show what had been
 * paid. It could not show what was *waiting*, or change where money goes next,
 * which is the half somebody actually acts on.
 *
 * The screen is built around the server's three states, which are the whole
 * model: `held` is collected and waiting on an approval that is not theirs to
 * give; `balance` is landed and spendable now; `bank` has left for their
 * account. Money in the first of those is the thing people write in about, so it
 * is named and explained rather than folded into a total.
 *
 * `balanceCents` is deliberately not the same as `toBalanceCents` — the first is
 * their whole spendable balance including top-ups they paid for, the second is
 * only what they earned. Showing one as the other would tell somebody they had
 * earned money they had actually bought.
 */

type EarningState = "held" | "balance" | "bank";
interface EarningLine {
  id: string;
  kind: "backing" | "prize";
  amountCents: number;
  what: string;
  at: string;
  state: EarningState;
  note: string | null;
}
interface Earnings {
  toBalanceCents: number;
  toBankCents: number;
  heldCents: number;
  lines: EarningLine[];
  balanceCents: number;
  payoutTarget: "balance" | "bank";
  bank: { connected: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean; available: boolean };
}

const TITLE = "Earnings";
const STATE_TONE: Record<EarningState, "warn" | "good" | "info"> = { held: "warn", balance: "good", bank: "info" };

export default function Earnings() {
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();

  const q = useQuery<Earnings>({
    queryKey: ["earnings"],
    queryFn: () => api<Earnings>("/api/earnings"),
  });

  const setTarget = useMutation({
    mutationFn: (target: "balance" | "bank") => api<Earnings>("/api/earnings/target", { method: "PATCH", body: { target } }),
    onSuccess: (fresh) => {
      qc.setQueryData(["earnings"], fresh);
      show({ text: fresh.payoutTarget === "bank" ? "New earnings will go to your bank." : "New earnings will stay in your balance.", tone: "success" });
    },
    onError: (e) => show({ text: errText(e, "Couldn't change that."), tone: "error" }),
  });

  if (q.isLoading || !q.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: TITLE }} />
        <Loading />
      </View>
    );
  }

  const d = q.data;

  return (
    <>
      <Screen>
        <Stack.Screen options={{ title: TITLE }} />
        <PageIntro icon="cash" title={TITLE} body="What you have earned, where it is, and where the next of it goes." />

        <TitledCard icon="wallet" title="Earned">
          <CountRow label="Spendable here" value={money(d.toBalanceCents)} />
          <CountRow label="Sent to your bank" value={money(d.toBankCents)} />
          <CountRow
            label="Waiting on a decision"
            value={money(d.heldCents)}
            leading={d.heldCents > 0 ? <Pill label="held" tone="warn" /> : undefined}
          />
          {/*
            * Said plainly, because the two numbers look like each other and
            * mean different things: this one includes money they topped up.
            */}
          <Text style={text.small}>
            Your whole balance is {money(d.balanceCents)} — that includes top-ups you paid for, not
            just what you earned.
          </Text>
        </TitledCard>

        {d.heldCents > 0 ? (
          <Callout
            icon="time"
            tone="warn"
            title={`${money(d.heldCents)} is waiting on somebody else`}
            body="Collected, and held until a reviewer approves the project it was pledged to. It is not yours to release and it has not been lost."
          />
        ) : null}

        <TitledCard icon="swap-horizontal" title="Where new earnings go">
          {d.bank.available ? (
            <>
              <ChoiceList
                options={[
                  { id: "balance" as const, label: "Keep it here", detail: "Spendable on Nova straight away" },
                  {
                    id: "bank" as const,
                    label: "Send it to my bank",
                    detail: d.bank.payoutsEnabled ? "Paid out through Stripe" : "Needs your bank details finishing first",
                  },
                ]}
                value={d.payoutTarget}
                onChange={(t) => setTarget.mutate(t)}
                disabled={setTarget.isPending}
              />
              {/*
                * Choosing the bank without finishing Stripe is a choice that
                * cannot be honoured, so it is said here rather than discovered
                * when the first payout does not arrive.
                */}
              {d.payoutTarget === "bank" && !d.bank.payoutsEnabled ? (
                <Callout
                  icon="alert-circle"
                  tone="warn"
                  body={d.bank.connected
                    ? "Your Stripe account is connected but not finished, so payouts cannot leave yet. Finishing it is on the web."
                    : "No bank is connected yet. Connecting one is on the web."}
                />
              ) : null}
            </>
          ) : (
            <Text style={text.meta}>
              Bank payouts are not switched on for this server, so earnings stay in your balance.
            </Text>
          )}
        </TitledCard>

        <TitledCard icon="list" title="Every line">
          {d.lines.length === 0 ? (
            <Empty icon="cash-outline" title="Nothing yet" body="Backings and challenge prizes land here." />
          ) : d.lines.map((l) => (
            <View key={l.id} style={{ gap: 2, paddingVertical: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Pill label={l.state} tone={STATE_TONE[l.state]} />
                <Text style={[text.body, { flex: 1 }]} numberOfLines={1}>{l.what}</Text>
                <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>
                  {money(l.amountCents)}
                </Text>
              </View>
              {/* The server writes one line saying what has to happen next, when something does. */}
              {l.note ? <Text style={text.small}>{l.note}</Text> : null}
            </View>
          ))}
          <Text style={text.small}>Amounts are what you receive, after the platform's cut.</Text>
        </TitledCard>

        <View style={{ height: spacing.xl }} />
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
