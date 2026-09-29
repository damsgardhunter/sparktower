import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import { useConfirmPurchase } from "@/components/payment-dialog";
import { money } from "./business-sim-types";
import { OUTCOME_COPY, OUTCOME_PRICE_CENTS, formatMoney } from "@shared/plans";
import { Loader2, Megaphone, Play, Sparkles } from "lucide-react";

/**
 * A marketing scheme, read and then tested.
 *
 * The simulator next to this answers "what if I spend a thousand a month on
 * marketing". This answers the question a marketer has instead: is *this plan*
 * any good — and then lets a plan worth testing be run for a year on the
 * business's own numbers, so a claim becomes a curve somebody can argue with.
 *
 * The score is five dimensions averaged on the server, never a number the model
 * was asked for, and the bar for testing is fixed. A plan below it is told what
 * to fix rather than given a projection, because a curve drawn on a plan with
 * no audience lends weight to the thing that most needed changing.
 */
interface Dimension { id: string; label: string; blurb: string }
interface Scheme {
  id: string;
  scheme: string;
  monthlyBudget: number;
  months: number;
  expectedMonthlyReturn: number;
  score: number;
  worthTesting: boolean;
  evaluation: {
    scores: Record<string, number>;
    notes: Record<string, string>;
    restated: string;
    fix: string;
    assumptions: string[];
    arithmetic?: { warnings: string[]; paybackMonths: number | null; multiple: number | null };
  };
  test: { verdict: string; facts: string[]; ranAt: string; monthlySupport?: number; supportMonths?: number } | null;
  createdAt: string;
}
interface SchemesPayload {
  dimensions: Dimension[];
  worthTestingAt: number;
  currency: string;
  /** Whether to offer a software worked example rather than a door-to-door one. */
  software: boolean;
  unlocked: boolean;
  aiAvailable: boolean;
  schemes: Scheme[];
}

/**
 * What a scheme looks like written down, for an empty box.
 *
 * Two, because the one there was described a doorstep round — 200 flats on a
 * street in Leeds, a card through every door, £2 a crate — and it was shown to
 * every project, including a web app whose market is the whole world. The
 * example is the strongest instruction on the page: it is what people copy the
 * shape of. Both name an audience, an offer, a channel, what it costs and what
 * gets counted, because that is what the five dimensions score.
 */
const DOORSTEP_PLACEHOLDER = "e.g. Aimed at the 200 flats on Kirkgate. A card through every door offering the first collection free, then £2 a crate. Runs for six weeks, and I count how many of the 200 book once and how many book twice.";
const SOFTWARE_PLACEHOLDER = "e.g. Aimed at solo bookkeepers who already pay for Xero. A post in the two forums they actually read, offering the first month free and an import of last year's ledger done for them. 400 a month on it, and I count signups, how many are still paying at day 60, and how many import anything at all.";

const schemesKey = (projectId: string) => ["/api/projects", projectId, "marketing-schemes"];

export function MarketingSchemes({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const confirmPurchase = useConfirmPurchase();
  const { data } = useQuery<SchemesPayload>({ queryKey: schemesKey(projectId) });

  const [scheme, setScheme] = useState("");
  const [budget, setBudget] = useState("");
  const [expected, setExpected] = useState("");
  /*
   * For a scheme where customers keep paying. Filled in, the scheme is tested
   * as a subscriber base that stacks up instead of a campaign that holds a
   * level of trade — and "whether it can pay" stops being a judgement and
   * becomes what a customer costs against what they are worth.
   */
  const [recurring, setRecurring] = useState(false);
  const [price, setPrice] = useState("");
  const [churn, setChurn] = useState("");
  const [signups, setSignups] = useState("");
  const [market, setMarket] = useState("");

  const write = useMutation({
    mutationFn: async () => {
      // The first scheme on a project is the purchase; every one after is free.
      if (!data?.unlocked && !(await confirmPurchase("marketingScheme", {
        title: OUTCOME_COPY.marketing.name,
        detail: OUTCOME_COPY.marketing.blurb,
        projectId,
      }))) return null;
      return (await apiRequest("POST", `/api/projects/${projectId}/marketing-schemes`, {
        scheme, monthlyBudget: Number(budget) || 0, expectedMonthlyReturn: Number(expected) || 0, months: 12,
        ...(recurring ? {
          pricePerMonth: Number(price) || 0,
          monthlyChurnPct: Number(churn) || 0,
          newCustomersAtFull: Number(signups) || 0,
          marketSize: Number(market) || 0,
        } : {}),
      })).json();
    },
    onSuccess: (r) => {
      if (!r) return;
      /*
       * All of it, not three of the eight.
       *
       * This cleared the description, the budget and the expected return and
       * left the price, the churn, the signups, the market size and the "they
       * keep paying" tick exactly as they were — so the next scheme started
       * half-filled with the last one's economics, above a box that read as
       * empty. Either every field survives a submit or none does; a form that
       * keeps the numbers you cannot see is the one that quietly scores the
       * wrong thing.
       */
      setScheme(""); setBudget(""); setExpected("");
      setRecurring(false); setPrice(""); setChurn(""); setSignups(""); setMarket("");
      void queryClient.invalidateQueries({ queryKey: schemesKey(projectId) });
    },
    onError: (e) => toast({ title: "Couldn't read that scheme", description: errorText(e), variant: "destructive" }),
  });

  /*
   * What is paying for the scheme while it runs. A scheme tested against a
   * business with nothing in the bank always came back "it runs you out of
   * money" — true, and about the funding rather than the scheme.
   */
  const [support, setSupport] = useState("");
  const [supportMonths, setSupportMonths] = useState("12");

  const test = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/projects/${projectId}/marketing-schemes/${id}/test`, {
      monthlySupport: Number(support) || 0,
      supportMonths: Number(supportMonths) || 0,
    })).json(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: schemesKey(projectId) }),
    onError: (e) => toast({ title: "Couldn't run that", description: errorText(e), variant: "destructive" }),
  });

  if (!data) return null;
  const ready = scheme.trim().length >= 40 && Number(budget) > 0;

  return (
    <Card data-testid="marketing-schemes">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Megaphone className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Test a marketing scheme</p>
          {!data.unlocked && (
            <Badge variant="outline" className="ml-auto text-[10px]" data-testid="marketing-price">
              {formatMoney(OUTCOME_PRICE_CENTS.marketing)} once for this project
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          For a product that already exists. Write the plan — who it is for, where it runs, what it offers, and how you
          would know it worked — and Nova scores it against your own figures. A scheme worth testing can then be run for
          a year in the simulator. It is tested as a campaign: if your customers sign up and keep paying, ask the
          simulator above instead, where the answer compounds.
        </p>

        <Textarea
          rows={5}
          maxLength={4000}
          value={scheme}
          onChange={(e) => setScheme(e.target.value)}
          placeholder={data.software ? SOFTWARE_PLACEHOLDER : DOORSTEP_PLACEHOLDER}
          data-testid="input-marketing-scheme"
        />
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs text-muted-foreground">
            Budget a month
            <input
              className="mt-1 block w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ""))}
              data-testid="input-marketing-budget"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            You expect back, a month
            <input
              className="mt-1 block w-36 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              inputMode="numeric" value={expected} onChange={(e) => setExpected(e.target.value.replace(/[^\d]/g, ""))}
              data-testid="input-marketing-expected"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} data-testid="toggle-marketing-recurring" />
          They keep paying — a subscription, retainer or standing order
        </label>

        {recurring && (
          <div className="flex flex-wrap gap-3 items-end rounded-md border border-border p-3" data-testid="marketing-recurring-fields">
            <label className="text-xs text-muted-foreground">
              Each pays, a month
              <input className="mt-1 block w-28 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
                data-testid="input-marketing-price" />
            </label>
            <label className="text-xs text-muted-foreground">
              Leaving a month (%)
              <input className="mt-1 block w-28 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                inputMode="decimal" value={churn} onChange={(e) => setChurn(e.target.value.replace(/[^\d.]/g, ""))}
                data-testid="input-marketing-churn" />
            </label>
            <label className="text-xs text-muted-foreground">
              New ones a month, at this budget
              <input className="mt-1 block w-36 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                inputMode="numeric" value={signups} onChange={(e) => setSignups(e.target.value.replace(/[^\d]/g, ""))}
                data-testid="input-marketing-signups" />
            </label>
            <label className="text-xs text-muted-foreground">
              Customers that exist at all
              <input className="mt-1 block w-36 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                inputMode="numeric" value={market} onChange={(e) => setMarket(e.target.value.replace(/[^\d]/g, ""))}
                data-testid="input-marketing-market" />
            </label>
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-end">
          <Button size="sm" disabled={!ready || write.isPending} onClick={() => write.mutate()} data-testid="button-marketing-run">
            {write.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            Have Nova read it
          </Button>
        </div>

        {data.schemes.some((s) => s.worthTesting) && (
          <div className="flex flex-wrap gap-3 items-end rounded-md border border-dashed border-border p-3" data-testid="marketing-support">
            <p className="w-full text-xs text-muted-foreground">
              Paying for it while it runs — savings, a wage, a partner's money. Leave it at nothing to test the scheme
              against the business exactly as it stands.
            </p>
            <label className="text-xs text-muted-foreground">
              Going in, a month
              <input className="mt-1 block w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                inputMode="numeric" value={support} onChange={(e) => setSupport(e.target.value.replace(/[^\d]/g, ""))}
                data-testid="input-marketing-support" />
            </label>
            <label className="text-xs text-muted-foreground">
              For how many months
              <input className="mt-1 block w-28 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                inputMode="numeric" value={supportMonths} onChange={(e) => setSupportMonths(e.target.value.replace(/[^\d]/g, ""))}
                data-testid="input-marketing-support-months" />
            </label>
          </div>
        )}

        {data.schemes.map((s) => (
          <SchemeCard
            key={s.id} scheme={s} dimensions={data.dimensions} bar={data.worthTestingAt} currency={data.currency}
            onTest={() => test.mutate(s.id)} testing={test.isPending}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function SchemeCard({ scheme, dimensions, bar, currency, onTest, testing }: {
  scheme: Scheme; dimensions: Dimension[]; bar: number; currency: string;
  onTest: () => void; testing: boolean;
}) {
  const e = scheme.evaluation;
  return (
    <div className="rounded-lg border border-border p-3 space-y-3" data-testid={`marketing-scheme-${scheme.id}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-lg font-semibold tabular-nums" data-testid="marketing-score">{scheme.score}</span>
        <span className="text-xs text-muted-foreground">/ 100</span>
        <Badge variant={scheme.worthTesting ? "secondary" : "destructive"} data-testid="marketing-verdict">
          {scheme.worthTesting ? "worth testing" : `below ${bar} — fix it first`}
        </Badge>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {money(scheme.monthlyBudget, currency)}/mo → {money(scheme.expectedMonthlyReturn, currency)}/mo claimed
        </span>
      </div>

      {e.restated && <p className="text-sm">{e.restated}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {dimensions.map((d) => (
          <div key={d.id} className="flex items-baseline gap-2 text-xs" title={d.blurb}>
            <span className="tabular-nums w-8 shrink-0 font-medium" data-testid={`marketing-score-${d.id}`}>{e.scores?.[d.id] ?? 0}</span>
            <span className="text-muted-foreground shrink-0">{d.label}</span>
            {e.notes?.[d.id] && <span className="text-muted-foreground/80 truncate" title={e.notes[d.id]}>— {e.notes[d.id]}</span>}
          </div>
        ))}
      </div>

      {/* What the numbers said before anybody read the words. */}
      {!!e.arithmetic?.warnings?.length && (
        <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5 list-disc pl-4" data-testid="marketing-warnings">
          {e.arithmetic.warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}

      {e.fix && <p className="text-sm"><span className="text-muted-foreground">The one change: </span>{e.fix}</p>}

      {scheme.worthTesting && !scheme.test && (
        <Button size="sm" variant="outline" disabled={testing} onClick={onTest} data-testid="button-marketing-test">
          {testing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
          Run it for a year — free
        </Button>
      )}

      {scheme.test && (
        <div className="rounded-md bg-muted/50 p-3 space-y-1" data-testid="marketing-test">
          <p className="text-sm font-medium" data-testid="marketing-test-verdict">{scheme.test.verdict}</p>
          {!!scheme.test.monthlySupport && (
            <p className="text-xs text-muted-foreground" data-testid="marketing-test-support">
              Tested with {money(scheme.test.monthlySupport, currency)} a month going in
              {scheme.test.supportMonths ? ` for ${scheme.test.supportMonths} months` : ""}.
            </p>
          )}
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {scheme.test.facts.map((f, i) => <li key={i}>· {f}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
