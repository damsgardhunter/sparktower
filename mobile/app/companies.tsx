import { Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { colors, font, fontFamily, spacing } from "../src/theme";
import { Empty, Loading, Screen } from "../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../src/components/MoreKit";
import { Pill } from "../src/components/nova/Pill";
import { CountRow } from "../src/components/more/AdminKit";

/**
 * The companies you act for — the phone's half of `client/src/pages/companies.tsx`.
 *
 * The second slice of the Companies surface, and the one everything else needs:
 * seasons, challenges, scouting and members all hang off a company, and until
 * there is a list there is nowhere for any of them to be reached from.
 *
 * Deliberately a list and a page, not a console. Creating a company, editing
 * it, managing members and running a season are desk jobs — they are forms with
 * consequences, and the web has them. What a phone is for is knowing which
 * companies you are in, who else is in them, and whether the one you lead can
 * actually do things yet, which is the verification state.
 */

interface CompanyRow {
  id: string; name: string; slug: string;
  website: string | null; industry: string | null; size: string | null;
  description: string | null; projectId: string | null;
  verifiedDomain: string | null; verifiedAt: string | null; verifiedMethod: string | null;
  role: string; memberCount: number;
}

const TITLE = "Companies";

export default function Companies() {
  const router = useRouter();
  const list = useQuery<{ companies: CompanyRow[] }>({
    queryKey: ["companies"],
    queryFn: () => api<{ companies: CompanyRow[] }>("/api/companies"),
  });

  if (list.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: TITLE }} />
        <Loading />
      </View>
    );
  }

  const rows = list.data?.companies ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: TITLE }} />
      <PageIntro icon="business" title={TITLE} body="The companies you act for, and what each one can do." />

      {rows.length === 0 ? (
        <Empty
          icon="business-outline"
          title="No companies"
          body="A company is how a team runs training seasons, posts challenges and recruits. Starting one is on the web."
        />
      ) : rows.map((c) => (
        <TitledCard
          key={c.id}
          icon="business"
          title={c.name}
          action={<Pill label={c.role} tone={c.role === "owner" ? "good" : "neutral"} />}
        >
          {c.description ? (
            <Text style={{ color: colors.textSecondary, fontSize: font.sm }} numberOfLines={2}>{c.description}</Text>
          ) : null}
          <CountRow label="Members" value={c.memberCount} />
          {/*
            * The verification state, on the list rather than only on the page.
            * `publicCompany` puts it on the wire for a reason worth repeating:
            * without it "no screen can say what is missing, and a leader whose
            * company cannot post challenges has no way to find out why".
            */}
          <CountRow
            label="Domain"
            value={c.verifiedAt ? (c.verifiedDomain ?? "verified") : "not verified"}
            leading={<Pill label={c.verifiedAt ? "verified" : "unverified"} tone={c.verifiedAt ? "good" : "unknown"} />}
          />
          <Text
            onPress={() => router.push(`/company/${c.id}`)}
            style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.medium, marginTop: spacing.sm }}
            testID={`open-company-${c.id}`}
          >
            Open
          </Text>
        </TitledCard>
      ))}

      <Callout
        icon="desktop"
        tone="info"
        body="Starting a company, editing it, running a season and posting a challenge are on the web. They are forms with consequences and they want a keyboard."
      />
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
