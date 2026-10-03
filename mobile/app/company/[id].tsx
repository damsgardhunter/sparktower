import { Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, spacing } from "../../src/theme";
import { Avatar, Loading, Screen } from "../../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../../src/components/MoreKit";
import { Pill } from "../../src/components/nova/Pill";
import { CountRow, NotFoundScreen, isNotFound, text } from "../../src/components/more/AdminKit";

/**
 * One company — the phone's half of the web's company page.
 *
 * `GET /api/companies/:id` is the shape "every tab relies on", by its own
 * comment, and it answers the question this screen is built around:
 * `me.powers` — what *this* person may do, worked out on the server "so every
 * tab reads one answer instead of restating the rule". The phone reads that
 * answer rather than deriving its own, because two implementations of a
 * permission rule is one implementation and one bug.
 *
 * What is here: who is in it, what it is, and whether it is verified. What is
 * not: anything that changes it. Members, seasons and challenges are forms with
 * consequences and they are on the web.
 */

interface Member {
  userId: string; role: string; permissions: unknown; joinedAt: string;
  firstName: string | null; lastName: string | null;
  displayName: string | null; avatarUrl: string | null;
}
interface Company {
  id: string; name: string; slug: string;
  website: string | null; industry: string | null; size: string | null;
  description: string | null; projectId: string | null;
  verifiedDomain: string | null; verifiedAt: string | null; verifiedMethod: string | null;
}
interface Detail {
  company: Company;
  role: string;
  members: Member[];
  me: { userId: string; role: string; permissions: unknown; powers: Record<string, boolean> };
}

export default function CompanyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery<Detail>({
    queryKey: ["company", id],
    queryFn: () => api<Detail>(`/api/companies/${id}`),
    enabled: !!id,
    retry: false,
  });

  if (isNotFound(q.error)) return <NotFoundScreen title="Company" />;
  if (q.isLoading || !q.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: "Company" }} />
        <Loading />
      </View>
    );
  }

  const { company: c, members, me } = q.data;
  const nameOf = (m: Member) => m.displayName || [m.firstName, m.lastName].filter(Boolean).join(" ") || "Member";
  /* The server's answer, not the phone's. */
  const can = Object.entries(me.powers ?? {}).filter(([, v]) => v).map(([k]) => k);

  return (
    <Screen>
      <Stack.Screen options={{ title: c.name }} />
      <PageIntro
        icon="business"
        title={c.name}
        body={c.description ?? c.industry ?? undefined}
        right={<Pill label={me.role} tone={me.role === "owner" ? "good" : "neutral"} />}
      />

      {/*
        * Verification first when it is missing, because it is the answer to
        * "why can't this company post a challenge" and nothing else on the
        * screen explains that.
        */}
      {c.verifiedAt ? (
        <Callout icon="checkmark-circle" tone="success" body={`Domain verified${c.verifiedDomain ? ` — ${c.verifiedDomain}` : ""}${c.verifiedMethod ? ` (${c.verifiedMethod})` : ""}.`} />
      ) : (
        <Callout
          icon="alert-circle"
          tone="warn"
          title="Domain not verified"
          body="Until a domain is verified this company cannot post challenges or recruit. Verifying it is on the web — it needs a DNS record or a file on the site."
        />
      )}

      <TitledCard icon="people" title={`Members · ${members.length}`}>
        {members.map((m) => (
          <View key={m.userId} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 }}>
            <Avatar name={nameOf(m)} uri={m.avatarUrl} size={32} />
            <Text style={{ color: colors.text, fontSize: font.sm, flex: 1 }} numberOfLines={1}>{nameOf(m)}</Text>
            <Pill label={m.role} tone={m.role === "owner" ? "good" : "neutral"} />
          </View>
        ))}
        <Text style={text.small}>Owners first, then by when they joined. Adding and removing members is on the web.</Text>
      </TitledCard>

      <TitledCard icon="information-circle" title="Details">
        {c.industry ? <CountRow label="Industry" value={c.industry} /> : null}
        {c.size ? <CountRow label="Size" value={c.size} /> : null}
        {c.website ? <CountRow label="Website" value={c.website} /> : null}
        {c.projectId ? <CountRow label="Run project" value="linked" /> : null}
      </TitledCard>

      {can.length ? (
        <TitledCard icon="key" title="What you can do here">
          <Text style={text.meta}>
            Worked out by the server so every screen reads one answer instead of restating the rule.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {can.map((p) => <Pill key={p} label={p.replace(/([A-Z])/g, " $1").toLowerCase()} tone="info" />)}
          </View>
        </TitledCard>
      ) : null}

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
