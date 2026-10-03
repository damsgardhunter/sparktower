import { useState } from "react";
import { Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, spacing } from "../../src/theme";
import { Loading, Screen, TabStrip } from "../../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../../src/components/MoreKit";
import { Pill } from "../../src/components/nova/Pill";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { CountRow, NotFoundScreen, isNotFound, text } from "../../src/components/more/AdminKit";
import { hasPower } from "../../src/companies";
import { companyKey, type CompanyView } from "../../src/components/company/kit";
import { TeamTab } from "../../src/components/company/TeamTab";
import { AdminTab } from "../../src/components/company/AdminTab";

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
 * It used to be a single read-only screen that said members, seasons and
 * challenges "are forms with consequences and they are on the web". Some of
 * them are here now, under the tabs the web uses, because a form with
 * consequences is still a form somebody needs when they are not at a desk —
 * and because every one of these controls mirrors a rule the server enforces
 * again regardless of what the phone allowed.
 *
 * Training seasons are still elsewhere: that surface is being built under
 * `app/sim/` and the Team tab points at it rather than guessing its shape.
 */

type Tab = "about" | "team" | "admin";

const TABS: { value: Tab; label: string }[] = [
  { value: "about", label: "About" },
  { value: "team", label: "Team" },
  { value: "admin", label: "Admin" },
];

export default function CompanyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("about");
  const { notice, show, clear } = useNotice();

  const q = useQuery<CompanyView>({
    queryKey: companyKey(id!),
    queryFn: () => api<CompanyView>(`/api/companies/${id}`),
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

  const { company: c, me } = q.data;

  return (
    <>
      <Screen>
        <Stack.Screen options={{ title: c.name }} />
        <PageIntro
          icon="business"
          title={c.name}
          body={c.description ?? c.industry ?? undefined}
          right={<Pill label={me.role} tone={me.role === "owner" ? "good" : "neutral"} />}
        />

        {/*
          * Every tab is shown to everybody, Admin included. It explains itself
          * to whoever cannot use it and names the leaders to ask; hiding it
          * would answer "where do I change this" with silence.
          */}
        <TabStrip options={TABS} value={tab} onChange={setTab} />

        {tab === "about" ? <About view={q.data} /> : null}
        {tab === "team" ? <TeamTab companyId={id!} notify={show} /> : null}
        {tab === "admin" ? <AdminTab companyId={id!} notify={show} /> : null}

        <View style={{ height: spacing.xl }} />
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}

function About({ view }: { view: CompanyView }) {
  const { company: c, me } = view;
  /* The server's answer, not the phone's. */
  const can = Object.entries(me.powers ?? {}).filter(([, v]) => v).map(([k]) => k);

  return (
    <View style={{ gap: spacing.md }}>
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
          body={hasPower(me, "manage_team")
            ? "Until a domain is verified this company cannot post challenges or recruit. Verifying it is on the web — it needs a DNS record or a file on the site."
            : "Until a domain is verified this company cannot post challenges or recruit. An owner or admin can verify it on the web."}
        />
      )}

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
    </View>
  );
}
