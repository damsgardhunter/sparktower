/**
 * The three simulations of *your own* business, on the phone.
 *
 * The market season is a game in an invented world; these are the opposite —
 * they run the numbers the owner actually has. Ask what happens if you hire,
 * borrow or put prices up and see it month by month. Write a marketing scheme
 * and have it scored against your own figures. Put fifty thousand somewhere
 * and find out what it is worth in ten years.
 *
 * All three existed on the web and none of them on the phone, which is the
 * wrong way round for a tool whose whole subject is a business somebody is
 * running this week — the moment you want to ask "can I afford to hire her"
 * is rarely the moment you are sitting at a desk.
 *
 * ## Why one screen and not three
 *
 * They share a business. All three read the same fourteen numbers, and those
 * numbers have to be right before any of them can answer anything — so the
 * starting position is asked once, at the top, and the three games are tabs
 * under it rather than three screens each demanding the same form.
 *
 * ## Why almost nothing is decided here
 *
 * Every label, band, horizon, spending option and verdict comes off the API.
 * The web client renders from the same payload, and two clients only stay in
 * agreement about a business by neither of them having an opinion about it.
 */
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Body, Btn, Card, Empty, Field, Label, Loading, Meta, Screen, Segments, TabStrip, errText } from "../../src/components/ui";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { BaselineForm, Facts, Score, Stat, Verdict, money, type BaselineField } from "../../src/components/sim/BusinessKit";
import {
  PayWall, WalletCard, paymentRequiredOf, useBuildMyBusiness, useTopUp, useWallet,
  type PaymentRequired,
} from "../../src/components/Pay";

type Game = "decide" | "scheme" | "tenYears";

interface ProjectRow { id: string; title: string | null }

interface Scenario {
  id: string;
  question: string;
  months: number;
  result: any;
  assumptions?: string[];
  createdAt: string;
}

interface Outlook {
  id: string;
  verdict: { peak?: number; notes?: Record<string, string>; scores?: Record<string, number> };
  overall: number;
  band: string;
  createdAt: string;
}

interface Sim {
  currency: string;
  aiAvailable: boolean;
  price: { cents: number; display: string; unlocked: boolean };
  baseline: Record<string, number>;
  overridden: string[];
  fields: BaselineField[];
  notReady: string | null;
  missing: string[];
  horizons: number[];
  scenarios: Scenario[];
  tenYears: {
    budget: number;
    options: { id: string; label: string; group: string; detail: string; step: number; minimumUseful: number }[];
    outlooks: Outlook[];
  };
}

const GAMES: { value: Game; label: string }[] = [
  { value: "decide", label: "Decide" },
  { value: "scheme", label: "Scheme" },
  { value: "tenYears", label: "Ten years" },
];

export default function BusinessSimScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();

  const [projectId, setProjectId] = useState<string | null>(null);
  const [game, setGame] = useState<Game>("decide");
  const [editing, setEditing] = useState(false);
  /*
   * The last refusal for money, held here rather than inside whichever tab
   * hit it. All three games are priced and all three can be the one that runs
   * out, and a paywall that disappeared when somebody looked at another tab
   * would be a paywall nobody ever paid.
   */
  const [need, setNeed] = useState<PaymentRequired | null>(null);

  const wallet = useWallet();
  const topUp = useTopUp();
  const buildAll = useBuildMyBusiness(projectId ?? "");

  const projects = useQuery({ queryKey: ["my-projects"], queryFn: () => api<ProjectRow[]>("/api/user/projects") });
  const chosen = projectId ?? projects.data?.[0]?.id ?? null;

  const sim = useQuery({
    queryKey: ["decision-sim", chosen],
    queryFn: () => api<Sim>(`/api/projects/${chosen}/decision-sim`),
    enabled: !!chosen,
  });

  const saveBaseline = useMutation({
    /*
     * `numbers` and `overridden`, which is what the route reads — it was
     * `{ baseline }` here, a key the server ignores, so every save wrote a
     * baseline of zeros and the games underneath drew a flat line at nothing.
     */
    mutationFn: ({ numbers, overridden }: { numbers: Record<string, number>; overridden: string[] }) =>
      api(`/api/projects/${chosen}/decision-sim/baseline`, { method: "PUT", body: { numbers, overridden } }),
    onSuccess: () => {
      setEditing(false);
      show({ tone: "success", text: "Saved. Everything here now runs on those numbers." });
      qc.invalidateQueries({ queryKey: ["decision-sim", chosen] });
    },
    onError: (e: any) => show({ tone: "error", text: errText(e, "Couldn't save those.") }),
  });

  /*
   * One place that decides what a failure was. A 402 is not an error to be
   * toasted away — it is a price, and the server has already worked out what
   * to do about it.
   */
  const onFailure = (e: unknown, fallback: string) => {
    const wall = paymentRequiredOf(e);
    if (wall) { setNeed(wall); return; }
    show({ tone: "error", text: errText(e, fallback) });
  };

  if (projects.isLoading) {
    return (<><Stack.Screen options={{ title: "Your business" }} /><Loading label="Finding your projects…" /></>);
  }

  const mine = projects.data ?? [];
  if (!mine.length) {
    return (
      <>
        <Stack.Screen options={{ title: "Your business" }} />
        <Screen canvas>
          <Empty
            icon="bulb-outline"
            title="No projects yet"
            body="These run on a project's own numbers — what it takes, what it spends, what it has in the bank. Start one and they have something to read."
            action="Start a project"
            onAction={() => router.push("/project/new" as any)}
          />
        </Screen>
      </>
    );
  }

  const d = sim.data;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "Your business" }} />
      <Screen canvas onRefresh={() => sim.refetch()} refreshing={sim.isRefetching}>
        {mine.length > 1 ? (
          <Card>
            <Label>Which business</Label>
            <View style={{ marginTop: spacing.sm }}>
              <Segments
                options={mine.slice(0, 8).map((p) => ({ value: p.id, label: p.title ?? "Untitled" }))}
                value={chosen ?? ""}
                onChange={(v) => { setProjectId(v); setEditing(false); }}
              />
            </View>
          </Card>
        ) : null}

        {sim.isLoading || !d ? (
          <Loading label="Reading your numbers…" />
        ) : (
          <>
            {/*
              * The starting position comes first, and blocks the rest when it
              * cannot answer. A simulation run on a baseline of zeros draws a
              * flat line at nothing, and somebody who paid for that would be
              * entitled to be annoyed about it — so the server says what is
              * missing (`notReady`) and this refuses to offer the games until
              * it is filled in.
              */}
            {editing || d.notReady ? (
              <>
                {d.notReady ? <Card><Body>{d.notReady}</Body></Card> : null}
                <BaselineForm
                  fields={d.fields}
                  baseline={d.baseline}
                  overridden={d.overridden}
                  missing={(d as any).missing ?? []}
                  currency={d.currency}
                  saving={saveBaseline.isPending}
                  onSave={(numbers, overridden) => saveBaseline.mutate({ numbers, overridden })}
                />
                {!d.notReady ? <Btn label="Cancel" variant="ghost" onPress={() => setEditing(false)} /> : null}
              </>
            ) : (
              <>
                <Card onPress={() => setEditing(true)}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                    <View style={{ flex: 1 }}>
                      <Label>Where you're starting from</Label>
                      <Meta>
                        {money(d.baseline.monthlyRevenue ?? 0, d.currency)} in ·{" "}
                        {money(d.baseline.monthlyCosts ?? 0, d.currency)} out ·{" "}
                        {money(d.baseline.cash ?? 0, d.currency)} in the bank
                      </Meta>
                    </View>
                    <Btn label="Edit" variant="outline" small onPress={() => setEditing(true)} testID="button-edit-baseline" />
                  </View>
                </Card>

                <TabStrip options={GAMES} value={game} onChange={setGame} />

                <WalletCard wallet={wallet.data} onTopUp={() => topUp.mutate(2000)} />

                {need ? (
                  <PayWall
                    need={need}
                    busy={topUp.isPending}
                    onTopUp={(cents) => topUp.mutate(cents, { onSuccess: () => setNeed(null) })}
                    onRetry={() => setNeed(null)}
                  />
                ) : null}

                {/*
                  * The whole project, bought outright.
                  *
                  * Offered here because this is where somebody is about to
                  * spend three dollars at a time on the same project — and
                  * once it is bought, every priced outcome on it is already
                  * paid for, these three included.
                  */}
                {!d.price.unlocked && !wallet.data?.devUnlimited ? (
                  <Card>
                    <View style={{ gap: spacing.sm }}>
                      <Label>Nova builds the whole business</Label>
                      <Meta>
                        Every section of the path built out, end to end, for one project — and from then on every
                        priced thing on it, these three included, is already paid for. $14.99 once, no subscription.
                      </Meta>
                      <Btn
                        label="Have Nova build it — $14.99"
                        variant="outline"
                        small
                        loading={buildAll.isPending}
                        disabled={buildAll.isPending}
                        onPress={() => buildAll.mutate(undefined, {
                          onSuccess: () => show({ tone: "success", text: "Nova is building it. Everything priced on this project is covered now." }),
                          onError: (e) => onFailure(e, "Couldn't start that build."),
                        })}
                        testID="button-build-my-business"
                      />
                    </View>
                  </Card>
                ) : null}

                {!d.aiAvailable ? (
                  <Card><Body>Nova can't be reached right now, so these can't be run. Nothing has been charged.</Body></Card>
                ) : null}

                {game === "decide" ? <Decide projectId={chosen!} sim={d} onFailure={onFailure} /> : null}
                {game === "scheme" ? <Scheme projectId={chosen!} currency={d.currency} onFailure={onFailure} /> : null}
                {game === "tenYears" ? <TenYears projectId={chosen!} sim={d} onFailure={onFailure} /> : null}
              </>
            )}
          </>
        )}
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}

/* ── Simulate a decision ─────────────────────────────────────────────────── */

function Decide({ projectId, sim, onFailure }: { projectId: string; sim: Sim; onFailure: (e: unknown, fallback: string) => void }) {
  const qc = useQueryClient();
  const [question, setQuestion] = useState("");
  const [months, setMonths] = useState(sim.horizons.includes(12) ? 12 : sim.horizons[0]);

  const run = useMutation({
    mutationFn: () => api<{ scenario: Scenario }>(`/api/projects/${projectId}/decision-sim/scenarios`, {
      method: "POST", body: { question, months },
    }),
    onSuccess: () => {
      setQuestion("");
      qc.invalidateQueries({ queryKey: ["decision-sim", projectId] });
    },
    onError: (e) => onFailure(e, "Couldn't run that one."),
  });

  return (
    <>
      <Card>
        <View style={{ gap: spacing.md }}>
          <View style={{ gap: 2 }}>
            <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>Simulate a decision</Text>
            <Meta>
              Ask what happens if you hire, spend, borrow or change what you charge — three ways it could go, and
              against doing nothing at all.
            </Meta>
          </View>

          <Field
            label="What are you thinking of doing?"
            value={question}
            onChangeText={setQuestion}
            placeholder="If I hire a salesperson on $4,000 a month from month three, does it pay for itself?"
            multiline
            maxLength={600}
            testID="input-question"
          />

          <View style={{ gap: spacing.xs }}>
            <Label>Look ahead</Label>
            <Segments
              options={sim.horizons.map((m) => ({ value: String(m), label: `${m} months` }))}
              value={String(months)}
              onChange={(v) => setMonths(Number(v))}
            />
          </View>

          <Btn
            label={sim.price.unlocked ? "Run it" : `Run it — ${sim.price.display}`}
            loading={run.isPending}
            disabled={run.isPending || question.trim().length < 8 || !sim.aiAvailable}
            onPress={() => run.mutate()}
            testID="button-run-scenario"
          />
          {!sim.price.unlocked ? (
            <Meta>Bought once for this project. Every question after the first is free.</Meta>
          ) : null}
        </View>
      </Card>

      {sim.scenarios.map((s) => <ScenarioCard key={s.id} scenario={s} currency={sim.currency} />)}
    </>
  );
}

function ScenarioCard({ scenario, currency }: { scenario: Scenario; currency: string }) {
  const [open, setOpen] = useState(false);
  const r = scenario.result ?? {};
  const verdict = String(r.verdict ?? "");
  const tone = /pays for itself/i.test(verdict) ? "good" : /runs you out|costs more/i.test(verdict) ? "bad" : "plain";

  return (
    <Card onPress={() => setOpen((o) => !o)}>
      <View style={{ gap: spacing.md }}>
        <View style={{ gap: 4 }}>
          <Body numberOfLines={open ? undefined : 2}>{scenario.question}</Body>
          <Verdict text={verdict} tone={tone as any} />
          <Meta>Over {scenario.months} months</Meta>
        </View>

        <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
          <Stat
            label="Cash, against doing nothing"
            value={money(Number(r.cashDifference ?? 0), currency)}
            tone={Number(r.cashDifference ?? 0) >= 0 ? "good" : "bad"}
          />
          <Stat
            label="Revenue a month, at the end"
            value={money(Number(r.revenueDifference ?? 0), currency)}
          />
        </View>

        {open ? (
          <>
            <Facts facts={r.facts ?? []} />
            {scenario.assumptions?.length ? (
              <View style={{ gap: spacing.xs }}>
                <Label>What this assumed</Label>
                {scenario.assumptions.map((a, i) => <Meta key={i}>· {a}</Meta>)}
              </View>
            ) : null}
          </>
        ) : (
          <Meta>Tap to see what decides it</Meta>
        )}
      </View>
    </Card>
  );
}

/* ── Test a marketing scheme ─────────────────────────────────────────────── */

function Scheme({ projectId, currency, onFailure }: { projectId: string; currency: string; onFailure: (e: unknown, fallback: string) => void }) {
  const qc = useQueryClient();
  const [scheme, setScheme] = useState("");
  const [budget, setBudget] = useState("");
  const [ret, setRet] = useState("");
  const [price, setPrice] = useState("");
  const [churn, setChurn] = useState("");

  const list = useQuery({
    queryKey: ["marketing-schemes", projectId],
    queryFn: () => api<{ schemes: any[] }>(`/api/projects/${projectId}/marketing-schemes`),
  });

  const score = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/marketing-schemes`, {
      method: "POST",
      body: {
        scheme, months: 12,
        monthlyBudget: Number(budget) || 0,
        expectedMonthlyReturn: Number(ret) || 0,
        pricePerMonth: Number(price) || 0,
        monthlyChurnPct: Number(churn) || 0,
      },
    }),
    onSuccess: () => {
      setScheme("");
      qc.invalidateQueries({ queryKey: ["marketing-schemes", projectId] });
    },
    onError: (e) => onFailure(e, "Couldn't score that one."),
  });

  return (
    <>
      <Card>
        <View style={{ gap: spacing.md }}>
          <View style={{ gap: 2 }}>
            <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>Test a marketing scheme</Text>
            <Meta>
              Who it's for, where it runs, what it offers, and how you'd know it worked. Nova scores it against your
              own figures — for a product that already exists.
            </Meta>
          </View>

          <Field
            label="The plan"
            value={scheme}
            onChangeText={setScheme}
            placeholder="Who it is for · where it runs · what it offers · how you would know it worked"
            multiline
            maxLength={4000}
            testID="input-scheme"
          />
          <Field label={`Budget a month (${currency})`} value={budget} onChangeText={setBudget} numeric testID="input-budget" />
          <Field label={`What you expect back a month (${currency})`} value={ret} onChangeText={setRet} numeric testID="input-return" />
          <Field label={`Price a month, if they subscribe (${currency})`} value={price} onChangeText={setPrice} numeric testID="input-price" />
          <Field label="Churn a month (%)" value={churn} onChangeText={setChurn} numeric testID="input-churn" />
          <Meta>
            Give a price and a churn rate and it is scored as a subscription — lifetime value, cost per customer and
            payback — rather than as a one-off campaign.
          </Meta>

          <Btn
            label="Score it"
            loading={score.isPending}
            disabled={score.isPending || scheme.trim().length < 40 || Number(budget) <= 0}
            onPress={() => score.mutate()}
            testID="button-score-scheme"
          />
        </View>
      </Card>

      {(list.data?.schemes ?? []).map((s: any) => <SchemeCard key={s.id} scheme={s} currency={currency} />)}
    </>
  );
}

function SchemeCard({ scheme, currency }: { scheme: any; currency: string }) {
  const [open, setOpen] = useState(false);
  const e = scheme.evaluation ?? {};
  const a = e.arithmetic ?? {};
  return (
    <Card onPress={() => setOpen((o) => !o)}>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
          <Score score={Number(scheme.score ?? 0)} band={scheme.worthTesting ? "Worth testing" : "Needs work"} />
          <View style={{ flex: 1 }}>
            <Body numberOfLines={open ? undefined : 3}>{e.restated ?? scheme.scheme}</Body>
          </View>
        </View>

        {open ? (
          <>
            {e.scores ? (
              <View style={{ gap: spacing.xs }}>
                <Label>Read on five things</Label>
                {Object.entries(e.scores as Record<string, number>).map(([k, v]) => (
                  <View key={k} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Meta>{k}</Meta>
                    <Text style={{ color: v >= 70 ? colors.success : v >= 40 ? colors.warning : colors.danger, fontSize: font.sm, fontFamily: fontFamily.semibold }}>
                      {v}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {Array.isArray(a.warnings) && a.warnings.length ? (
              <View style={{ backgroundColor: colors.canvas, borderRadius: radius.sm, padding: spacing.md, gap: spacing.xs }}>
                {a.warnings.map((w: string, i: number) => <Meta key={i}>· {w}</Meta>)}
              </View>
            ) : null}

            {e.fix ? (
              <View style={{ gap: 2 }}>
                <Label>What to change</Label>
                <Body>{e.fix}</Body>
              </View>
            ) : null}
          </>
        ) : (
          <Meta>Tap for the read, the arithmetic and what to change</Meta>
        )}
      </View>
    </Card>
  );
}

/* ── Ten years from now ──────────────────────────────────────────────────── */

function TenYears({ projectId, sim, onFailure }: { projectId: string; sim: Sim; onFailure: (e: unknown, fallback: string) => void }) {
  const qc = useQueryClient();
  const [allocation, setAllocation] = useState<Record<string, number>>({});

  const spent = useMemo(
    () => Object.values(allocation).reduce((sum, n) => sum + n, 0),
    [allocation],
  );
  const left = sim.tenYears.budget - spent;

  const run = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/decision-sim/ten-years`, { method: "POST", body: { allocation } }),
    onSuccess: () => {
      setAllocation({});
      qc.invalidateQueries({ queryKey: ["decision-sim", projectId] });
    },
    onError: (e) => onFailure(e, "Couldn't value that one."),
  });

  const nudge = (id: string, step: number, dir: 1 | -1) =>
    setAllocation((a) => {
      const next = Math.max(0, (a[id] ?? 0) + step * dir);
      // Never past the budget: the whole exercise is that it is finite.
      const others = Object.entries(a).reduce((sum, [k, v]) => (k === id ? sum : sum + v), 0);
      return { ...a, [id]: Math.min(next, sim.tenYears.budget - others) };
    });

  return (
    <>
      <Card>
        <View style={{ gap: spacing.md }}>
          <View style={{ gap: 2 }}>
            <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>Ten years from now</Text>
            <Meta>
              You've been lent {money(sim.tenYears.budget, sim.currency)} and a year. Where does it go? Then it says
              where that puts you in ten years.
            </Meta>
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Label>Still to place</Label>
            <Text style={{ color: left === 0 ? colors.success : colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>
              {money(left, sim.currency)}
            </Text>
          </View>

          {sim.tenYears.options.map((o) => {
            const put = allocation[o.id] ?? 0;
            const thin = put > 0 && put < o.minimumUseful;
            return (
              <View key={o.id} style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{o.label}</Text>
                    <Meta>{o.detail}</Meta>
                  </View>
                  <Btn label="−" variant="outline" small onPress={() => nudge(o.id, o.step, -1)} />
                  <Text style={{ width: 58, textAlign: "center", color: colors.text, fontSize: font.sm, fontFamily: fontFamily.bold }}>
                    {put ? money(put, sim.currency) : "—"}
                  </Text>
                  <Btn label="+" variant="outline" small onPress={() => nudge(o.id, o.step, 1)} testID={`button-add-${o.id}`} />
                </View>
                {thin ? (
                  /*
                   * Said before it is run, not after. Underfunding a line is
                   * the most common way one of these comes back "Shaky", and
                   * the reason is worth knowing while it can still be changed.
                   */
                  <Meta>Below {money(o.minimumUseful, sim.currency)} this one tends not to do anything at all.</Meta>
                ) : null}
              </View>
            );
          })}

          <Btn
            label="Value it"
            loading={run.isPending}
            disabled={run.isPending || spent <= 0 || !sim.aiAvailable}
            onPress={() => run.mutate()}
            testID="button-run-tenyears"
          />
        </View>
      </Card>

      {sim.tenYears.outlooks.map((o) => <OutlookCard key={o.id} outlook={o} currency={sim.currency} />)}
    </>
  );
}

function OutlookCard({ outlook, currency }: { outlook: Outlook; currency: string }) {
  const [open, setOpen] = useState(false);
  const notes = outlook.verdict?.notes ?? {};
  return (
    <Card onPress={() => setOpen((o) => !o)}>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
          <Score score={outlook.overall} band={outlook.band} />
          <View style={{ flex: 1 }}>
            <Label>Worth at its peak</Label>
            <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>
              {money(Number(outlook.verdict?.peak ?? 0), currency)}
            </Text>
          </View>
        </View>

        {open ? (
          <View style={{ gap: spacing.sm }}>
            {Object.entries(notes).map(([k, v]) => (
              <View key={k} style={{ gap: 2 }}>
                <Label>{k}</Label>
                <Body>{String(v)}</Body>
              </View>
            ))}
          </View>
        ) : (
          <Meta>Tap for the read on product, growth, capital and risk</Meta>
        )}
      </View>
    </Card>
  );
}
