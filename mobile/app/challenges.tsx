import { Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { colors, font, fontFamily, spacing } from "../src/theme";
import { Empty, Loading, Screen } from "../src/components/ui";
import { PageIntro, TitledCard } from "../src/components/MoreKit";
import { Pill } from "../src/components/nova/Pill";
import { ChoiceList, text } from "../src/components/more/AdminKit";

/**
 * Sponsored challenges — the builder's side, on the phone.
 *
 * A company posts a brief with a prize; builders enter. The company's half —
 * creating one, closing entries, judging, announcing — is seven routes and a
 * desk job. This is the other five: see what is open, read the brief, enter,
 * and know where your entry stands.
 *
 * Same shape as the talent slice and for the same reason: it stands alone,
 * needs no company page, and the acting half belongs to whoever is holding a
 * phone rather than whoever is running the company.
 *
 * `verifiedDomain` is on every card, which is the server's decision and worth
 * keeping: "it is the one fact that tells an entrant who is actually asking — a
 * name can be anything, and a domain has been checked". A challenge is somebody
 * asking for work in exchange for a prize, so who is asking is the first thing.
 */

interface ChallengeRow {
  id: string;
  title: string;
  brief: string;
  criteria: string | null;
  prize: string | null;
  industry: string | null;
  deadline: string;
  createdAt: string;
  status: "open" | "judging" | "closed";
  acceptingEntries: boolean;
  company: { id: string; name: string; industry: string | null; website: string | null; verifiedDomain: string | null };
  prizeHeld: { amountCents: number; state: string } | null;
  entryCount: number;
  entered: boolean;
  myEntryStatus: string | null;
}

const TITLE = "Challenges";
const STATUSES = [
  { id: "open" as const, label: "Open", detail: "Taking entries now" },
  { id: "judging" as const, label: "Being judged", detail: "Closed, not decided" },
  { id: "closed" as const, label: "Finished", detail: "Decided" },
];

export default function Challenges() {
  const router = useRouter();
  const [status, setStatus] = useState<"open" | "judging" | "closed">("open");

  /* The route answers a bare array, not a wrapper. */
  const list = useQuery<ChallengeRow[]>({
    queryKey: ["challenges", status],
    queryFn: () => api<ChallengeRow[]>(`/api/challenges?status=${status}`),
  });

  const rows = list.data ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: TITLE }} />
      <PageIntro
        icon="trophy"
        title={TITLE}
        body="Briefs companies have posted, with a prize. Enter one, and see where your entry stands."
      />

      <View style={{ paddingHorizontal: spacing.lg }}>
        <ChoiceList options={STATUSES} value={status} onChange={setStatus} />
      </View>

      {list.isLoading ? <Loading /> : rows.length === 0 ? (
        <Empty
          icon="trophy-outline"
          title={status === "open" ? "Nothing open" : status === "judging" ? "Nothing being judged" : "Nothing finished"}
          body={status === "open" ? "No company is asking for entries right now." : undefined}
        />
      ) : rows.map((c) => (
        <TitledCard
          key={c.id}
          icon="trophy"
          title={c.title}
          action={
            c.entered
              ? <Pill label={c.myEntryStatus ?? "entered"} tone="good" />
              : c.acceptingEntries
                ? <Pill label="open" tone="info" />
                : <Pill label={c.status} tone="neutral" />
          }
        >
          {/*
            * Who is asking, first. A verified domain has been checked; a name
            * has not.
            */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Text style={[text.body, { fontFamily: fontFamily.medium }]}>{c.company.name}</Text>
            {c.company.verifiedDomain
              ? <Pill label={c.company.verifiedDomain} icon="checkmark-circle" tone="good" />
              : <Pill label="domain not verified" tone="unknown" />}
          </View>

          <Text style={{ color: colors.textSecondary, fontSize: font.sm }} numberOfLines={3}>{c.brief}</Text>
          {c.prize ? <Text style={[text.body, { fontFamily: fontFamily.medium }]}>Prize: {c.prize}</Text> : null}
          <Text style={text.small}>
            {c.entryCount} {c.entryCount === 1 ? "entry" : "entries"} · closes {new Date(c.deadline).toLocaleDateString()}
          </Text>
          <Text
            onPress={() => router.push(`/challenge/${c.id}`)}
            style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.medium, marginTop: spacing.sm }}
            testID={`open-challenge-${c.id}`}
          >
            {c.entered ? "See your entry" : c.acceptingEntries ? "Read the brief and enter" : "Read the brief"}
          </Text>
        </TitledCard>
      ))}

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
