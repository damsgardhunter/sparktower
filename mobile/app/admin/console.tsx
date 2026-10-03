import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Empty, Icon, Loading, Screen } from "../../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../../src/components/MoreKit";
import { Pill } from "../../src/components/nova/Pill";
import { CountRow, NotFoundScreen, StatBox, StatGrid, isNotFound, text, useReviewer, gateView } from "../../src/components/more/AdminKit";

/**
 * Find the customer who just wrote in — the phone's half of
 * `client/src/pages/admin-console.tsx`.
 *
 * The server's own comment says what the search is for: support arrives as an
 * address, a name, or an id pasted out of an email, and guessing which "is a
 * worse use of a minute than trying all of them". Projects are searched too,
 * because "my project X is broken" is how people describe themselves. That is a
 * phone task — somebody writes in, you are not at a desk, you need to know who
 * they are and what has already been done to them.
 *
 * ## What this screen does not do, and why that is deliberate
 *
 * The web console also *acts*: suspend, restore, grant credit, issue a day
 * pass. Those are not here. `/api/admin/console/actions` reports
 * `maxGrantCents`, `maxGrantPerDayCents` and `grantedTodayCents` — it is a
 * surface that moves money, capped per operator per day — and a mis-tap on a
 * phone is a different kind of accident from a mis-click at a desk. There is an
 * undo route, so an action is recoverable; a *grant* is recoverable only in the
 * sense that money can be taken back off somebody's balance after they have
 * seen it.
 *
 * So the lookup is here, the history is here, and the actions stay at a desk
 * until that half is built with its own care — a confirmation that names the
 * person and the amount, the per-day remainder shown before the field, and the
 * reason field the server already requires. It is in
 * `docs/mobile-parity.md` as its own item rather than as an absence.
 */

interface Person {
  id: string; email: string | null; name: string; role: string | null;
  suspended: boolean; isBot: boolean; balance: string; joined: string;
}
interface SearchResult { people: Person[]; projects: { id: string; title: string; ownerId: string }[] }

interface HistoryRow {
  id: string; action: string; actorId: string; reason: string | null;
  details: unknown; createdAt: string; previousState: unknown; resultingState: unknown;
}

const TITLE = "Support console";

export default function AdminConsole() {
  const { loading, isReviewer } = useReviewer();
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const search = useQuery<SearchResult>({
    queryKey: ["console-search", searched],
    queryFn: () => api<SearchResult>(`/api/admin/console/search?q=${encodeURIComponent(searched)}`),
    enabled: searched.trim().length > 0,
    retry: false,
  });
  const person = useQuery<any>({
    queryKey: ["console-user", openId],
    queryFn: () => api<any>(`/api/admin/console/users/${openId}`),
    enabled: !!openId,
    retry: false,
  });

  const gate = gateView(TITLE, loading, isReviewer);
  if (gate) return gate;
  if (isNotFound(search.error) || isNotFound(person.error)) return <NotFoundScreen title={TITLE} />;

  return (
    <Screen>
      <Stack.Screen options={{ title: TITLE }} />
      <PageIntro icon="search" title={TITLE} body="Look somebody up by address, name, or the id out of their email." />

      <View style={{ paddingHorizontal: spacing.lg, flexDirection: "row", gap: spacing.sm }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Address, name, or id"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => { setOpenId(null); setSearched(q.trim()); }}
          style={{
            flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
            borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
            color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular,
          }}
          testID="input-console-search"
        />
        <Pressable
          onPress={() => { setOpenId(null); setSearched(q.trim()); }}
          accessibilityRole="button"
          style={({ pressed }) => [{
            paddingHorizontal: spacing.md, justifyContent: "center",
            backgroundColor: colors.primary, borderRadius: radius.sm, opacity: pressed ? 0.85 : 1,
          }]}
          testID="button-console-search"
        >
          <Icon name="search" size={16} color={colors.primaryText} />
        </Pressable>
      </View>

      {!searched ? (
        <Callout icon="information-circle" body="Projects are searched too — “my project X is broken” is how people describe themselves." />
      ) : search.isLoading ? (
        <Loading />
      ) : !search.data?.people.length && !search.data?.projects.length ? (
        <Empty icon="search-outline" title="Nobody matched" body="Try the address they wrote in from, or paste the id out of the email." />
      ) : (
        <TitledCard icon="people" title={`${search.data.people.length} ${search.data.people.length === 1 ? "person" : "people"}`}>
          {search.data.people.map((p) => (
            <Pressable key={p.id} onPress={() => setOpenId(p.id)} testID={`console-person-${p.id}`}>
              <CountRow
                label={`${p.name}${p.email ? ` · ${p.email}` : ""}`}
                value={p.balance}
                note={p.role ?? undefined}
                leading={
                  p.suspended ? <Pill label="suspended" tone="bad" />
                    : p.isBot ? <Pill label="bot" tone="neutral" />
                    : <Pill label="ok" tone="good" />
                }
              />
            </Pressable>
          ))}
          {search.data.projects.length ? (
            <Text style={[text.small, { marginTop: spacing.sm }]}>
              {search.data.projects.length} matching {search.data.projects.length === 1 ? "project" : "projects"}:
              {" "}{search.data.projects.map((p) => p.title).join(", ")}
            </Text>
          ) : null}
        </TitledCard>
      )}

      {openId ? (
        person.isLoading ? <Loading /> : person.data ? (
          <>
            <TitledCard icon="person" title={person.data.account?.name || person.data.account?.email || "Account"}>
              <StatGrid>
                <StatBox label="Balance" value={person.data.wallet?.balance ?? "—"} />
                <StatBox
                  label="Allowance"
                  value={`${person.data.allowance?.used ?? 0} of ${person.data.allowance?.of ?? 0}`}
                  sub="this month"
                />
                <StatBox label="Projects" value={`${person.data.projects?.length ?? 0}`} />
              </StatGrid>
              <Text style={text.meta}>
                Titles and settings only — never the contents of anybody's projects. The route is
                written that way and the screen cannot ask for more.
              </Text>
            </TitledCard>

            {/*
              * Everything ever done to this account by an operator, newest
              * first. This is the half of the console a phone is actually good
              * for: knowing whether somebody has already handled it.
              */}
            <TitledCard icon="time" title="What has been done to this account">
              {!person.data.history?.length ? (
                <Text style={text.meta}>Nothing. No operator has touched this account.</Text>
              ) : (person.data.history as HistoryRow[]).slice(0, 15).map((h) => (
                <CountRow
                  key={h.id}
                  label={h.action.replace(/_/g, " ")}
                  value={new Date(h.createdAt).toLocaleDateString()}
                  note={h.reason ? undefined : "no reason given"}
                />
              ))}
            </TitledCard>

            <Callout
              icon="desktop"
              tone="info"
              body="Suspending, restoring, granting credit and issuing a day pass are on the web console. They move money and they are capped per operator per day, so they want a bigger screen and a confirmation that names the amount."
            />
          </>
        ) : null
      ) : null}

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
