/**
 * "What happens if I do this?" — the simulator, for one real business.
 *
 * Three things about this screen are deliberate, and all three exist to stop
 * it being believed more than it deserves.
 *
 * **The starting position is on the page, editable, before anything is run.**
 * Most of it is read from the weekly check-ins, and the rest — the loan, the
 * payroll, the cost base — is not something a check-in knows. An owner who
 * cannot see what the projection is standing on cannot argue with it, and a
 * projection nobody can argue with is one they either believe completely or
 * ignore completely.
 *
 * **Every answer shows three lines and one of them is doing nothing.** A
 * single line is read as a promise. The slow case is drawn as boldly as the
 * expected case because it is the one that decides whether the decision is
 * survivable, and the do-nothing line is what turns "you'll have $40,000 in
 * June" into the only version of that sentence worth reading: "$18,000 less
 * than if you hadn't".
 *
 * **The assumptions are editable and re-running is free.** Nova turns the
 * sentence into numbers — what a hire costs, what they bring in, how long they
 * take to get going — and those are guesses. They are presented as guesses,
 * with the number in a box, and changing one and running it again costs
 * nothing. That is where this stops being a projection and starts being a
 * conversation.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { useConfirmPurchase } from "@/components/payment-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Sparkles, AlertTriangle, SlidersHorizontal, RefreshCw, ChevronDown, ChevronRight,
  TrendingUp, Wallet, CircleHelp,
  Scale,
} from "lucide-react";
import { CashCurve } from "./cash-curve";
import { money, simKey, stamp, type Scenario, type SimPayload } from "./business-sim-types";
import type { Baseline, Lever, Verdict } from "@shared/simulation/decision-sim";
import type { BaselineField } from "@shared/simulation/company-baseline";

/** The computed verdicts, and how loudly each is shown. */
const VERDICT_TONE: Record<Verdict, "secondary" | "outline" | "destructive"> = {
  "it pays for itself": "secondary",
  "it works, but it is tight": "outline",
  "it costs more than it brings back": "destructive",
  // A loss in cash bought on purpose, which is not the same warning.
  "it costs money and buys back your time": "outline",
  /*
   * Ahead on the central case and fragile underneath it. Red rather than
   * amber: a plan that falls over one time in four is nearer to the plan that
   * runs you out of money than to the one that is merely tight, and the point
   * of the badge is that nobody has to read down to the eighth bullet to find
   * that out.
   */
  "it works only if little goes wrong": "destructive",
  "it runs you out of money": "destructive",
};

/**
 * Questions worth asking, for a page that is otherwise an empty box.
 *
 * Phrased as an owner would type them rather than as prompts, because they are
 * put straight into the box and run — and one of the things this teaches is
 * that a decision stated with a number in it gets a better answer than one
 * without.
 */
const EXAMPLES = [
  "What happens if I hire 12 people right now?",
  "If I spend 1,000 a month on marketing, what's the projected outcome?",
  "What if I put my prices up 10%?",
  "Can I afford a 60,000 van on finance this year?",
  "What if I took on two more staff and stopped opening on Mondays?",
];

/**
 * The same, for a business with no van and no Mondays.
 *
 * Every example above has premises or a vehicle — a van on finance, two more
 * staff, not opening on Mondays — which is the right list for most of the
 * businesses here and a strange one for a web app sold to the whole world.
 * The decisions a software business actually weighs are the ones the engine
 * grew a subscription lever for: what to charge, how many leave, whether the
 * spend that brings people in pays for itself.
 */
const EXAMPLES_SOFTWARE = [
  "If I spend 1,000 a month getting customers on and they keep paying, where am I in two years?",
  "What if I put my prices up 10% and one in twenty customers leaves?",
  "What happens if 3 in 100 customers leave every month instead of 2?",
  "Can I afford to pay a second developer out of this?",
  "How much would I have to charge for this to pay me a wage?",
];

/**
 * The same, for somebody who hasn't started.
 *
 * The list above is written for a business with money moving through it, and
 * offered to a founder with nothing it is a list of decisions they cannot
 * make: hire twelve people, spend a thousand a month, buy a sixty-thousand
 * van. The questions that matter when you have nothing are about getting the
 * first money at all — a wage put aside, a few hundred spent, a small thing
 * bought on finance — and the engine can answer every one of them.
 */
const EXAMPLES_FROM_NOTHING = [
  "If I keep my job for a year and put 400 a month into it, what can I start with?",
  "What happens if I spend 200 on flyers and it brings in 600 a month by month three?",
  "Can I afford a 1,500 trailer on finance with nothing in the bank?",
  "What if I work part time for six months while it gets going?",
  "How long before this pays me more than my job does?",
];

/** Starting from nothing, with no flyers to print and no trailer to buy. */
const EXAMPLES_SOFTWARE_FROM_NOTHING = [
  "If I keep my job for a year and put 400 a month into it, what can I start with?",
  "What happens if I spend 200 a month on ads and 15 people a month sign up by month three?",
  "What if I charged 9 a month instead of 19 and twice as many signed up?",
  "What if I work part time for six months while it gets going?",
  "How long before this pays me more than my job does?",
];

/** What each of a lever's numbers is called, in the owner's words. */
const LEVER_FIELD_COPY: Record<string, { label: string; unit: "money" | "percent" | "count" }> = {
  people: { label: "How many", unit: "count" },
  monthlyCostEach: { label: "Each costs, a month", unit: "money" },
  monthlyRevenueEach: { label: "Each brings in, a month", unit: "money" },
  rampMonths: { label: "Months to get going", unit: "count" },
  monthlyAmount: { label: "A month", unit: "money" },
  months: { label: "For how many months (0 = the whole time)", unit: "count" },
  monthlyReturnAtFull: { label: "Most it could ever bring in, a month", unit: "money" },
  halfSpend: { label: "Spend that gets half of that", unit: "money" },
  lagMonths: { label: "Months before it shows", unit: "count" },
  changePct: { label: "Price change", unit: "percent" },
  demandChangePct: { label: "What that does to how much you sell", unit: "percent" },
  amount: { label: "Amount", unit: "money" },
  apr: { label: "Interest a year", unit: "percent" },
  termMonths: { label: "Over how many months", unit: "count" },
  monthlyRevenueDelta: { label: "Extra revenue, a month", unit: "money" },
  monthlyCostDelta: { label: "Extra cost, a month", unit: "money" },
  startMonth: { label: "Starts in month", unit: "count" },

  /*
   * The two newest kinds of lever, whose numbers had no copy at all.
   *
   * This map is an allowlist — the editor renders a lever's numeric fields
   * only if they are named here — so the job and subscription levers arrived
   * with every one of their figures invisible. A scenario would hold
   * `monthlyTakeHome 2000, pricePerMonth 49, monthlyChurn 0.03,
   * marketSize 200000` and offer the owner two boxes: how many months, and
   * which month it starts. The line above the editor says "every one of these
   * is a guess — change any of them and run it again", under an answer whose
   * whole shape came from a price and a churn rate they could not reach.
   */
  monthlyTakeHome: { label: "Take-home a month", unit: "money" },
  intoBusiness: { label: "How much of it goes in", unit: "percent" },
  pricePerMonth: { label: "Each pays, a month", unit: "money" },
  monthlyChurn: { label: "Leaving a month", unit: "percent" },
  // Deliberately not "at this budget": on the lever this is the ceiling the
  // saturating curve approaches, and the spend above decides how near it gets.
  // The marketing form asks the friendlier question and converts.
  newCustomersAtFull: { label: "Most new a month, at any spend", unit: "count" },
  newCustomersFromHours: { label: "New a month from your own hours", unit: "count" },
  wordOfMouth: { label: "Each customer brings in, a month", unit: "percent" },
  reinvestShare: { label: "Share of its revenue put back in", unit: "percent" },
  ownerHoursAMonth: { label: "Hours a month it takes you", unit: "count" },
  marketSize: { label: "Customers that exist at all", unit: "count" },
  rivalShare: { label: "Share of them already taken", unit: "percent" },
  priceErosion: { label: "Price falls a year", unit: "percent" },
  ownerHoursFreedEach: { label: "Hours a week each frees up", unit: "count" },
};

/** Percentages are stored as fractions and typed as whole numbers. One conversion, here. */
const toInput = (value: number, unit: "money" | "percent" | "count", asFraction: boolean) =>
  unit === "percent" && asFraction ? Math.round(value * 1000) / 10 : value;
const fromInput = (value: number, unit: "money" | "percent" | "count", asFraction: boolean) =>
  unit === "percent" && asFraction ? value / 100 : value;

/**
 * The lever fields that hold a fraction rather than a percentage figure.
 *
 * `monthlyChurn` and `intoBusiness` are both stored 0–1, so without them here
 * a 3% churn would render as "0.03" in a box labelled "(%)" and anyone
 * correcting it to 3 would have set churn to 300%.
 */
const FRACTION_FIELDS = new Set(["apr", "monthlyChurn", "intoBusiness", "wordOfMouth", "reinvestShare", "rivalShare", "priceErosion"]);

export function DecisionLab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const confirmPurchase = useConfirmPurchase();
  const { data, isLoading } = useQuery<SimPayload>({ queryKey: simKey(projectId) });

  const [question, setQuestion] = useState("");
  const [months, setMonths] = useState(12);
  const [showBaseline, setShowBaseline] = useState(false);

  const run = useMutation({
    mutationFn: async () => {
      /*
       * Asked before it spends, and only for the first question on this
       * project: after that the price is zero and confirmPurchase returns
       * straight away, because comparing one decision against another is the
       * whole feature and charging per comparison would kill it.
       */
      if (!data!.price.unlocked && !(await confirmPurchase("decisionSimulation", {
        title: "Simulate this decision",
        detail: "Bought once for this project. Every question after this one — and the ten-year outlook — is free from then on.",
        projectId,
      }))) return null;
      return apiRequest("POST", `/api/projects/${projectId}/decision-sim/scenarios`, { question, months })
        .then((r) => r.json());
    },
    onSuccess: (result) => {
      if (!result) return;  // They cancelled at the price.
      setQuestion("");
      queryClient.invalidateQueries({ queryKey: simKey(projectId) });
      queryClient.invalidateQueries({ queryKey: ["/api/nova/wallet"] });
    },
    onError: (e) => toast({ title: "Couldn't run that", description: errorText(e), variant: "destructive" }),
  });

  if (isLoading || !data) {
    return <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>;
  }

  /* One question per row, newest first, and a re-run sits with the question it came from. */
  const scenarios = data.scenarios;
  /*
   * Nothing coming in and nothing in the bank: the questions worth offering
   * are a different set. See EXAMPLES_FROM_NOTHING.
   */
  const fromNothing = data.baseline.monthlyRevenue <= 0 && data.baseline.cash <= 0;
  /* A web app is offered software decisions; everything else keeps the van. */
  const examples = data.software
    ? (fromNothing ? EXAMPLES_SOFTWARE_FROM_NOTHING : EXAMPLES_SOFTWARE)
    : (fromNothing ? EXAMPLES_FROM_NOTHING : EXAMPLES);

  return (
    <div className="space-y-4" data-testid="decision-lab">
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Simulate a decision</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Ask what happens if you hire, spend, borrow or change what you charge, and see it month by month on your own
            numbers — three ways it could go, and against doing nothing at all.
          </p>

          <StartingPosition
            projectId={projectId}
            data={data}
            open={showBaseline || !!data.notReady}
            onToggle={() => setShowBaseline((v) => !v)}
          />

          {/* The refusal, named before the button is pressed so nobody pays to be told this. */}
          {data.notReady && (
            <p className="text-sm rounded-md border border-amber-500/40 bg-amber-500/5 p-3 flex gap-2" data-testid="sim-not-ready">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{data.notReady}</span>
            </p>
          )}

          <div className="space-y-2">
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              maxLength={600}
              placeholder="What decisions are you curious about making?"
              data-testid="input-sim-question"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-muted-foreground" htmlFor="sim-horizon">Look ahead</label>
              <select
                id="sim-horizon"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
                data-testid="select-sim-horizon"
              >
                {data.horizons.map((h) => <option key={h} value={h}>{h} months</option>)}
              </select>
              <Button
                size="sm"
                className="ml-auto"
                onClick={() => run.mutate()}
                disabled={run.isPending || question.trim().length < 8 || !!data.notReady || !data.aiAvailable}
                data-testid="button-sim-run"
              >
                {run.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                Run it
                {!data.price.unlocked && <span className="ml-1.5 text-xs opacity-80">{data.price.display}</span>}
              </Button>
            </div>
            {!data.aiAvailable && <p className="text-xs text-muted-foreground">Nova isn't available right now.</p>}
          </div>

          {/* An empty box teaches nobody what to put in it. */}
          {!scenarios.length && (
            <div className="space-y-1.5" data-testid="sim-examples">
              <p className="text-xs text-muted-foreground">Things people ask:</p>
              <div className="flex flex-wrap gap-1.5">
                {examples.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setQuestion(e)}
                    className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted transition-colors"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {scenarios.map((s, i) => (
        <ScenarioCard key={s.id} projectId={projectId} scenario={s} startOpen={i === 0} onAsk={setQuestion} currency={data.currency} />
      ))}
    </div>
  );
}

/**
 * The company as the simulator has it, with every figure editable.
 *
 * Fields the check-ins answered say where they came from; fields the owner has
 * typed are marked as theirs and are never overwritten by a later read of the
 * check-ins. Somebody who corrects their cost base and finds it reset next
 * week will not correct it twice.
 */
function StartingPosition({ projectId, data, open, onToggle }: {
  projectId: string; data: SimPayload; open: boolean; onToggle: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Baseline | null>(null);
  const [touched, setTouched] = useState<Set<BaselineField>>(new Set());
  const values = draft ?? data.baseline;
  const sourceOf = (f: BaselineField) => data.sources.find((s) => s.field === f)?.from ?? null;

  const save = useMutation({
    /*
     * Saving records every number on screen, not only the ones retyped.
     *
     * `overridden` used to be the fields this session touched, which made the
     * displayed zeros unanswerable. The panel says, in as many words, "zero is
     * a real answer — fill one in", and a founder with nothing in the bank and
     * nothing coming in was looking at two fields already reading 0: there was
     * nothing to type. Typing 0 over a 0 fires no change, so the button below
     * stayed disabled and the simulator stayed blocked. The only way through
     * was to type 1 and then 0 — a wrong number, corrected, to say "none".
     *
     * `data.missing` is exactly the set with no source and no answer, so
     * pressing a button labelled "Save these" now means what it says: these
     * are the figures, including the zeros.
     */
    mutationFn: () => apiRequest("PUT", `/api/projects/${projectId}/decision-sim/baseline`, {
      numbers: values,
      overridden: [...new Set([...data.overridden, ...touched, ...data.missing])],
    }).then((r) => r.json()),
    onSuccess: () => {
      setDraft(null);
      setTouched(new Set());
      queryClient.invalidateQueries({ queryKey: simKey(projectId) });
    },
    onError: (e) => toast({ title: "Couldn't save those", description: errorText(e), variant: "destructive" }),
  });

  const set = (field: BaselineField, value: number) => {
    setDraft({ ...values, [field]: value });
    setTouched((t) => new Set([...t, field]));
  };

  return (
    <div className="rounded-lg border border-border" data-testid="sim-baseline">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
        data-testid="button-sim-baseline"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <Wallet className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium">Where you're starting from</span>
        <span className="text-xs text-muted-foreground truncate">
          {money(data.baseline.monthlyRevenue, data.currency)} in, {money(data.baseline.monthlyCosts, data.currency)} out, {money(data.baseline.cash, data.currency)} in the bank
        </span>
        {data.missing.length > 0 && (
          <Badge variant="outline" className="ml-auto text-[10px] shrink-0" data-testid="sim-baseline-missing">
            {data.missing.length} to fill in
          </Badge>
        )}
      </button>

      {open && (
        <div className="border-t border-border p-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Read from your weekly check-ins where they can answer it. The rest — what you owe, what it costs you, who is on
            the payroll — no check-in knows, so fill those in once and every projection after this uses them.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.fields.map((f) => {
              const fraction = f.unit === "percent";
              const from = sourceOf(f.field);
              const mine = data.overridden.includes(f.field) || touched.has(f.field);
              return (
                <div key={f.field} className="space-y-1">
                  <label className="text-xs font-medium flex items-center gap-1.5" htmlFor={`sim-field-${f.field}`}>
                    {f.label}
                    {f.unit === "percent" && <span className="text-muted-foreground">(%)</span>}
                    {mine && <Badge variant="secondary" className="text-[9px] px-1 py-0">yours</Badge>}
                  </label>
                  <Input
                    id={`sim-field-${f.field}`}
                    type="number"
                    inputMode="decimal"
                    className="h-8"
                    value={toInput(values[f.field], f.unit, fraction)}
                    onChange={(e) => set(f.field, fromInput(Number(e.target.value) || 0, f.unit, fraction))}
                    data-testid={`input-sim-${f.field}`}
                  />
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {from ?? f.hint}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            {/* Never disabled for want of an edit: confirming what is already
                shown is the whole point when the true answer is a zero. */}
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-sim-save-baseline">
              {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Save these
            </Button>
            {draft && (
              <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setTouched(new Set()); }}>
                Put them back
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One question and what the arithmetic said about it. */
function ScenarioCard({ projectId, scenario, startOpen, onAsk, currency }: {
  projectId: string; scenario: Scenario; startOpen: boolean; onAsk: (q: string) => void;
  /** The business's own money, so the curve and its key read in it. */
  currency?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(startOpen);
  const [levers, setLevers] = useState<Lever[] | null>(null);
  const result = scenario.result;
  const edited = levers ?? scenario.levers;

  const rerun = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/decision-sim/scenarios/${scenario.id}/rerun`, {
      levers: edited, months: scenario.months,
    }).then((r) => r.json()),
    onSuccess: () => {
      setLevers(null);
      queryClient.invalidateQueries({ queryKey: simKey(projectId) });
    },
    onError: (e) => toast({ title: "Couldn't run that again", description: errorText(e), variant: "destructive" }),
  });

  const setLever = (index: number, key: string, value: number) => {
    const next = edited.map((l, i) => (i === index ? { ...l, [key]: value } : l));
    setLevers(next as Lever[]);
  };

  return (
    <Card data-testid={`sim-scenario-${scenario.id}`}>
      <CardContent className="p-5 space-y-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2 text-left" aria-expanded={open}>
          {open ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" />}
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-medium">{scenario.question}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={VERDICT_TONE[result.verdict]} data-testid="sim-verdict">{result.verdict}</Badge>
              <span className="text-xs text-muted-foreground tabular-nums">
                over {scenario.months} months · {stamp(scenario.createdAt)}
              </span>
              {scenario.rerunOf && <Badge variant="outline" className="text-[10px]">re-run</Badge>}
            </div>
          </div>
        </button>

        {open && (
          <div className="space-y-4">
            {scenario.narrative.headline && (
              <p className="text-sm font-medium leading-relaxed" data-testid="sim-headline">{scenario.narrative.headline}</p>
            )}

            {/*
              * How this one turned out, before anything it predicted is read.
              *
              * Put above the chart deliberately: a projection that has already
              * been shown to run 40% high should be read as a projection that
              * runs 40% high, not discovered to have been one after the
              * pleasant curve has done its work.
              */}
            {scenario.hindsight && (
              <p
                className={`text-sm rounded-md border px-3 py-2 ${
                  scenario.hindsight.lean === "over"
                    ? "border-amber-500/40 bg-amber-500/5"
                    : scenario.hindsight.lean === "under"
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-border bg-muted/40"
                }`}
                data-testid="sim-hindsight"
              >
                {scenario.hindsight.line}
              </p>
            )}

            <CashCurve likely={result.with.likely} cautious={result.with.cautious} bold={result.with.bold} without={result.without} currency={currency} />

            {/*
              * What actually decides this plan.
              *
              * Placed between the chart and the findings on purpose: the chart
              * says what happens, the findings say why, and this says which of
              * the nine numbers underneath it is worth arguing about. Without
              * it a plan is nine things to worry about equally, when in
              * practice one or two carry the whole answer.
              */}
            {scenario.matters && scenario.matters.rows.length > 0 && (
              <div className="rounded-lg border border-border p-3 space-y-2" data-testid="sim-what-matters">
                <div className="flex items-center gap-2">
                  <Scale className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What decides this</p>
                </div>
                {scenario.matters.headline && (
                  <p className="text-sm leading-relaxed">{scenario.matters.headline}</p>
                )}
                {/*
                  * Two groups, never one list. The business's own figures are
                  * usually the biggest movers on the page — a fifth of a large
                  * cost base beats any single decision — so ranking them
                  * together answers "should I do this?" with "your rent is
                  * large". True, and not the question.
                  */}
                {(["decision", "business"] as const).map((scope) => {
                  const group = scenario.matters!.rows.filter((r) => r.scope === scope);
                  if (!group.length) return null;
                  const widest = Math.max(...group.map((r) => r.swing)) || 1;
                  return (
                    <div key={scope} className="space-y-1.5">
                      {scope === "business" && (
                        <p className="text-[11px] font-medium text-muted-foreground pt-1">
                          And underneath it, about the business rather than this decision:
                        </p>
                      )}
                      <ul className="space-y-1.5">
                        {group.map((r) => (
                          <li key={`${r.leverIndex}-${r.field}`} className="space-y-0.5" data-testid={`matters-${r.field}`}>
                            <div className="flex items-baseline gap-2 text-sm">
                              <span className="flex-1">{r.line}</span>
                            </div>
                            {/* The bar is the comparison; the sentence is the detail. */}
                            <div className="h-1 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full ${scope === "decision" ? "bg-primary/60" : "bg-muted-foreground/40"}`}
                                style={{ width: `${Math.max(3, (r.swing / widest) * 100)}%` }}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
                <p className="text-[11px] text-muted-foreground">
                  Each one nudged a fifth either way on its own, everything else held still. Change the ones that matter in the boxes below and run it again — it costs nothing.
                </p>
              </div>
            )}

            {/* The computed findings. These are not Nova's, and they are not negotiable. */}
            <ul className="space-y-1 text-sm" data-testid="sim-facts">
              {result.facts.map((f, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">·</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {scenario.narrative.body && (
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line" data-testid="sim-body">
                {scenario.narrative.body}
              </p>
            )}

            {scenario.narrative.watchFor.length > 0 && (
              <div className="rounded-lg border border-border p-3 space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What has to be true</p>
                <ul className="text-sm space-y-1">
                  {scenario.narrative.watchFor.map((w, i) => (
                    <li key={i} className="flex gap-2"><span className="text-muted-foreground shrink-0">·</span><span>{w}</span></li>
                  ))}
                </ul>
              </div>
            )}

            {/*
              * The assumptions, with the numbers in boxes. The point of the
              * whole screen: an owner who thinks a salesperson brings in three
              * thousand rather than eight can say so and see the answer change,
              * for nothing.
              */}
            <div className="rounded-lg border border-border p-3 space-y-3" data-testid="sim-assumptions">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What this assumed</p>
              </div>
              {scenario.assumptions.length > 0 && (
                <ul className="text-sm text-muted-foreground space-y-1">
                  {scenario.assumptions.map((a, i) => (
                    <li key={i} className="flex gap-2"><span className="shrink-0">·</span><span>{a}</span></li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Every one of these is a guess. Change any of them and run it again — it costs nothing.
              </p>

              {edited.map((lever, index) => (
                <div key={index} className="rounded-md border border-border/60 p-2.5 space-y-2">
                  <p className="text-sm font-medium">{lever.label}</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {Object.entries(lever)
                      .filter(([key, v]) => typeof v === "number" && LEVER_FIELD_COPY[key])
                      .map(([key, v]) => {
                        const copy = LEVER_FIELD_COPY[key];
                        const fraction = FRACTION_FIELDS.has(key);
                        return (
                          <div key={key} className="space-y-1">
                            <label className="text-[11px] text-muted-foreground" htmlFor={`lever-${scenario.id}-${index}-${key}`}>
                              {copy.label}{copy.unit === "percent" ? " (%)" : ""}
                            </label>
                            <Input
                              id={`lever-${scenario.id}-${index}-${key}`}
                              type="number"
                              inputMode="decimal"
                              className="h-8"
                              value={toInput(v as number, copy.unit, fraction)}
                              onChange={(e) => setLever(index, key, fromInput(Number(e.target.value) || 0, copy.unit, fraction))}
                              data-testid={`input-lever-${index}-${key}`}
                            />
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}

              <Button
                size="sm"
                variant={levers ? "default" : "outline"}
                onClick={() => rerun.mutate()}
                disabled={rerun.isPending}
                data-testid="button-sim-rerun"
              >
                {rerun.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Run it again with these
              </Button>
            </div>

            {scenario.narrative.alsoAsk.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5"><CircleHelp className="h-3.5 w-3.5" />Worth asking next:</p>
                <div className="flex flex-wrap gap-1.5">
                  {scenario.narrative.alsoAsk.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => onAsk(q)}
                      className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted transition-colors"
                      data-testid="button-sim-also-ask"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
