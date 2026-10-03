import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Empty, Field, Icon, Loading, Row, Screen, errText } from "../../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../../src/components/MoreKit";
import { NoticeBanner, Sheet, useNotice, type Notice } from "../../src/components/Sheet";
import { Pill } from "../../src/components/nova/Pill";
import { CountRow, NotFoundScreen, StatBox, StatGrid, isNotFound, money, text, useReviewer, gateView } from "../../src/components/more/AdminKit";

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
 ## Acting, and the care it was waiting for
 *
 * The console also *acts*: money onto a balance, a day pass, a project's
 * privacy, a transfer. This screen refused to do any of it for a while, and
 * named the three things it wanted first — "a confirmation that names the
 * person and the amount, the per-day remainder shown before the field, and the
 * reason field the server already requires". All three are here now, so it
 * acts.
 *
 * A mis-tap on a phone is still a different accident from a mis-click at a
 * desk, and the difference is handled rather than avoided:
 *
 *   - **The remainder is shown before the field, not after the refusal.** The
 *     server caps a grant per operator per day and answers 429 past it. Being
 *     told "you have $320 of today's $500 left" before typing is the whole
 *     point; being told after is a wasted minute and a retype.
 *   - **The confirmation names the person and the amount.** Not "are you
 *     sure" — "Put $25 on Dana Weir's balance?". A confirmation that does not
 *     restate what it is confirming is a second tap, not a check.
 *   - **The reason is required here too.** The server requires it anyway; a
 *     field that is refused server-side after a paragraph is written is worse
 *     than one that says it needs eight characters.
 *
 * The action catalogue is not restated. `/api/admin/console/actions` sends
 * `CONSOLE_ACTION_DEFS` — the label, the blurb, who may, whether it is
 * reversible and what it acts on — and the phone renders what it is given. A
 * power over somebody not in the room is exactly the list that must not exist
 * twice: a copy here would eventually offer something the server has removed.
 */

interface Person {
  id: string; email: string | null; name: string; role: string | null;
  suspended: boolean; isBot: boolean; balance: string; joined: string;
}
interface SearchResult { people: Person[]; projects: { id: string; title: string; ownerId: string }[] }

interface ActionDef {
  id: string;
  label: string;
  blurb: string;
  role: "admin" | "owner";
  reversible: boolean;
  subject: "user" | "project";
}
interface ActionsView {
  you: { id: string; isOwner: boolean };
  actions: ActionDef[];
  limits: {
    maxGrantCents: number;
    maxGrantPerDayCents: number;
    grantedTodayCents: number;
    maxPassDays: number;
    minReason: number;
  };
}

interface HistoryRow {
  id: string; action: string; actorId: string; reason: string | null;
  details: unknown; createdAt: string; previousState: unknown; resultingState: unknown;
}

const TITLE = "Support console";

export default function AdminConsole() {
  const qc = useQueryClient();
  const { loading, isReviewer } = useReviewer();
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [acting, setActing] = useState<ActionDef | null>(null);
  const { notice, show, clear } = useNotice();

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
  /*
   * What this operator may do, and how much of today's allowance is left.
   * Asked once for the screen rather than per person: the limits are the
   * operator's, not the customer's.
   */
  const caps = useQuery<ActionsView>({
    queryKey: ["console-actions"],
    queryFn: () => api<ActionsView>("/api/admin/console/actions"),
    enabled: isReviewer,
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

            {/*
              * Rendered from what the server sent, filtered by what this
              * operator may do. An owner-only action is not greyed out for an
              * admin, it is absent: a disabled button for something somebody
              * will never be allowed to press is a question with no answer.
              */}
            <TitledCard icon="construct" title="Act on this account">
              <Text style={text.small}>
                Every one of these is a power over somebody who is not in the room. Each takes a reason, and the
                reason is stored.
              </Text>
              {caps.data ? (
                <>
                  {/* The remainder, before the field rather than after the refusal. */}
                  {caps.data.you.isOwner ? (
                    <Text style={text.small} testID="grant-remainder">
                      Today you have put {money(caps.data.limits.grantedTodayCents)} on balances, of{" "}
                      {money(caps.data.limits.maxGrantPerDayCents)} allowed — {money(Math.max(0, caps.data.limits.maxGrantPerDayCents - caps.data.limits.grantedTodayCents))} left.
                      One action can move at most {money(caps.data.limits.maxGrantCents)}.
                    </Text>
                  ) : null}
                  {caps.data.actions
                    .filter((a) => a.role !== "owner" || caps.data!.you.isOwner)
                    .filter((a) => a.subject === "user")
                    .map((a) => (
                      <Pressable
                        key={a.id}
                        onPress={() => setActing(a)}
                        testID={`console-action-${a.id}`}
                        style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border, gap: 2 }}
                      >
                        <Row between center>
                          <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>{a.label}</Text>
                          {a.reversible ? <Pill label="can be undone" tone="neutral" /> : <Pill label="final" tone="warn" />}
                        </Row>
                        <Text style={{ color: colors.textTertiary, fontSize: font.xs }}>{a.blurb}</Text>
                      </Pressable>
                    ))}
                  {/*
                    * Project actions need a project chosen, and this screen is
                    * looking at a person. Said rather than silently missing.
                    */}
                  <Text style={[text.small, { marginTop: 4 }]}>
                    Actions on a single project — the whole-business build, privacy, moving it to another account —
                    are on the web console, which has the project open beside them.
                  </Text>
                </>
              ) : caps.isLoading ? <Loading /> : (
                <Text style={text.small}>Couldn't read what you're allowed to do, so nothing is offered.</Text>
              )}
            </TitledCard>
          </>
        ) : null
      ) : null}

      <View style={{ height: spacing.xl }} />

      {acting && openId && caps.data ? (
        <ActSheet
          action={acting}
          userId={openId}
          personName={person.data?.account?.name || person.data?.account?.email || "this account"}
          limits={caps.data.limits}
          onClose={() => setActing(null)}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ["console-user", openId] });
            void qc.invalidateQueries({ queryKey: ["console-actions"] });
            setActing(null);
          }}
          notify={show}
        />
      ) : null}
      <NoticeBanner notice={notice} onDismiss={clear} />
    </Screen>
  );
}

/**
 * One action, with the three things this screen was waiting for.
 *
 * `amountCents` for money, `days` for a pass, and a reason for everything. The
 * server validates all of it again and its sentence is the one shown — it names
 * the field and the ceiling, which a generic failure would throw away.
 */
function ActSheet({
  action, userId, personName, limits, onClose, onDone, notify,
}: {
  action: ActionDef;
  userId: string;
  personName: string;
  limits: ActionsView["limits"];
  onClose: () => void;
  onDone: () => void;
  notify: (n: Notice) => void;
}) {
  const [dollars, setDollars] = useState("");
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");

  const needsMoney = action.id === "credit";
  const needsDays = action.id === "day_pass" || action.id === "image_pass";
  const cents = Math.round((Number(dollars) || 0) * 100);
  const dayCount = Math.round(Number(days) || 0);
  const leftToday = Math.max(0, limits.maxGrantPerDayCents - limits.grantedTodayCents);

  /*
   * Refused here for the same reasons the server refuses, so the ceiling is a
   * fact on the screen rather than a surprise. The server is still the one that
   * decides — this only saves the round trip.
   */
  const tooMuch = needsMoney && (cents > limits.maxGrantCents || cents > leftToday);
  const tooLong = needsDays && (dayCount < 1 || dayCount > limits.maxPassDays);
  const reasonShort = reason.trim().length < limits.minReason;

  const act = useMutation({
    mutationFn: () => api("/api/admin/console/act", {
      method: "POST",
      body: {
        action: action.id,
        userId,
        reason: reason.trim(),
        ...(needsMoney ? { amountCents: cents } : {}),
        ...(needsDays ? { days: dayCount } : {}),
      },
    }),
    onSuccess: () => { notify({ text: "Done, and in the log.", tone: "success" }); onDone(); },
    onError: (e) => notify({ text: errText(e, "Couldn't do that."), tone: "error" }),
  });

  /* Names the person and the amount — not "are you sure". */
  const confirmTitle = needsMoney
    ? `Put ${money(cents)} on ${personName}'s balance?`
    : needsDays
      ? `Give ${personName} ${dayCount} ${dayCount === 1 ? "day" : "days"}?`
      : `${action.label} for ${personName}?`;

  return (
    <Sheet visible onClose={onClose} title={action.label} subtitle={personName}>
      <View style={{ gap: spacing.sm }}>
        <Text style={text.small}>{action.blurb}</Text>

        {needsMoney ? (
          <>
            <Field label="How much, in dollars" value={dollars} onChangeText={setDollars} numeric testID="act-amount" />
            <Text style={text.small} testID="act-money-limits">
              At most {money(limits.maxGrantCents)} in one go, and {money(leftToday)} left of today's allowance.
            </Text>
            {tooMuch ? (
              <Text style={[text.small, { color: colors.danger }]} testID="act-too-much">
                {cents > limits.maxGrantCents
                  ? `That is over the ${money(limits.maxGrantCents)} limit for a single action.`
                  : `That is more than the ${money(leftToday)} left in today's allowance.`}
              </Text>
            ) : null}
          </>
        ) : null}

        {needsDays ? (
          <>
            <Field label="How many days" value={days} onChangeText={setDays} numeric testID="act-days" />
            <Text style={text.small}>
              Up to {limits.maxPassDays} days. Anything longer is a plan, not support.
            </Text>
          </>
        ) : null}

        <Field
          label="Why"
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder="What they asked for, and what you decided."
          testID="act-reason"
        />
        <Text style={text.small}>
          {reasonShort
            ? `At least ${limits.minReason} characters. An administrative change nobody can account for afterwards is indistinguishable from an intrusion.`
            : "Stored against the action, and readable in the log above."}
        </Text>

        {!action.reversible ? (
          <Callout icon="warning" tone="warn" body="This one cannot be undone from the log." />
        ) : null}

        <Btn
          label={action.label}
          loading={act.isPending}
          disabled={reasonShort || tooMuch || tooLong || (needsMoney && cents <= 0)}
          testID="act-confirm"
          onPress={() => Alert.alert(
            confirmTitle,
            reason.trim(),
            [{ text: "Cancel", style: "cancel" }, { text: "Do it", onPress: () => act.mutate() }],
          )}
        />
      </View>
    </Sheet>
  );
}
