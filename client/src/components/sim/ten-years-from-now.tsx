/**
 * "Ten years from now", asked of a company that actually exists.
 *
 * The game of the same name gives two strangers half an hour to invent a
 * startup over five rounds — the idea, the customer, the money, the product,
 * and where the first million goes — and then values what they made up.
 *
 * Four of those five rounds are already answered for a real project. The idea,
 * the customer, the model and the product are the business, and its weekly
 * numbers say more about them than any round of a game could. So this asks the
 * one round that is left, and it is the one that carries the most information
 * anyway: **you have a million dollars and a year. Where does it go?**
 *
 * That question is not decoration. It is the only thing on this screen the
 * owner has just decided, and a million dollars spent on seven things badly is
 * the most common way a good business stops being one — which is why a line
 * funded below what it costs is shown as buying nothing rather than quietly
 * counted.
 *
 * The verdict is the game's own shape and goes through the game's own cleaning
 * (shared/sprints/scoring.ts), so a company's 780 and a game's 780 mean the
 * same thing and neither invents its own scale.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { useConfirmPurchase } from "@/components/payment-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, Hourglass, AlertTriangle } from "lucide-react";
import { money, simKey, stamp, type Outlook, type SimPayload } from "./business-sim-types";
import type { Allocation } from "@shared/sprints/budget";
import type { SpendOption } from "@shared/sprints/cards";

/** A valuation is a big number and always reads better rounded to its own scale. */
function valuation(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}bn`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  return money(n);
}

export function TenYearsFromNow({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const confirmPurchase = useConfirmPurchase();
  const { data, isLoading } = useQuery<SimPayload>({ queryKey: simKey(projectId) });
  const [allocation, setAllocation] = useState<Allocation>({});

  const spent = useMemo(
    () => Object.values(allocation).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0),
    [allocation],
  );

  const value = useMutation({
    mutationFn: async () => {
      if (!data!.price.unlocked && !(await confirmPurchase("tenYearOutlook", {
        title: "Ten years from now",
        detail: "Bought once for this project. Running it again — and every decision you simulate — is free from then on.",
      }))) return null;
      return apiRequest("POST", `/api/projects/${projectId}/decision-sim/ten-years`, { allocation })
        .then((r) => r.json());
    },
    onSuccess: (result) => {
      if (!result) return;  // They cancelled at the price.
      queryClient.invalidateQueries({ queryKey: simKey(projectId) });
      queryClient.invalidateQueries({ queryKey: ["/api/nova/wallet"] });
    },
    onError: (e) => toast({ title: "Couldn't value that", description: errorText(e), variant: "destructive" }),
  });

  if (isLoading || !data) {
    return <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>;
  }

  const { budget, options, outlooks } = data.tenYears;
  const left = budget - spent;
  const groups = [...new Set(options.map((o) => o.group))];

  return (
    <div className="space-y-4" data-testid="ten-years">
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Hourglass className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ten years from now</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Everything Nova needs about your business is already here — what it sells, who to, what it takes and what it
            keeps. So there is only one question: <span className="text-foreground font-medium">you have been lent a
            million dollars and a year. Where does it go?</span> Then it says where that puts you in ten years.
          </p>

          <div className="flex items-center gap-3 flex-wrap rounded-lg border border-border px-3 py-2">
            <span className="text-sm font-semibold tabular-nums" data-testid="ty-left">{money(left)}</span>
            <span className="text-xs text-muted-foreground">left of {money(budget)}</span>
            <div className="ml-auto h-1.5 w-32 rounded-full bg-muted overflow-hidden" aria-hidden>
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${Math.min(100, Math.max(0, (spent / budget) * 100))}%` }}
              />
            </div>
          </div>
          {left < 0 && (
            <p className="text-sm rounded-md border border-amber-500/40 bg-amber-500/5 p-3 flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <span>That's {money(-left)} more than you have. Anything over the million is taken off the biggest lines before it is valued.</span>
            </p>
          )}

          {groups.map((group) => (
            <div key={group} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {options.filter((o) => o.group === group).map((option) => (
                  <SpendRow
                    key={option.id}
                    option={option}
                    amount={allocation[option.id] ?? 0}
                    onChange={(n) => setAllocation((a) => ({ ...a, [option.id]: n }))}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={() => value.mutate()}
              disabled={value.isPending || spent <= 0 || !data.aiAvailable}
              data-testid="button-ty-value"
            >
              {value.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
              Where does this put us in ten years?
              {!data.price.unlocked && <span className="ml-1.5 text-xs opacity-80">{data.price.display}</span>}
            </Button>
            {spent <= 0 && <span className="text-xs text-muted-foreground">Put the million somewhere first.</span>}
            {!data.aiAvailable && <span className="text-xs text-muted-foreground">Nova isn't available right now.</span>}
          </div>
        </CardContent>
      </Card>

      {outlooks.map((o) => <OutlookCard key={o.id} outlook={o} data={data} />)}
    </div>
  );
}

/**
 * One line of the budget.
 *
 * The consequence of funding it is on the card, always, because a budget
 * screen where every choice sounds good is a slot machine. The warning about
 * underfunding appears the moment it applies rather than at the end, since by
 * the end the money is gone.
 */
function SpendRow({ option, amount, onChange }: { option: SpendOption; amount: number; onChange: (n: number) => void }) {
  const underfunded = amount > 0 && amount < option.minimumUseful;
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${amount > 0 ? "border-primary/40 bg-primary/5" : "border-border"}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{option.label}</p>
          <p className="text-[11px] text-muted-foreground leading-snug">{option.detail}</p>
        </div>
        <Input
          type="number"
          inputMode="numeric"
          step={option.step}
          min={0}
          className="h-8 w-28 shrink-0"
          value={amount || ""}
          placeholder="0"
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          aria-label={`Dollars into ${option.label}`}
          data-testid={`input-ty-${option.id}`}
        />
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">{option.consequence}</p>
      {underfunded && (
        <p className="text-[11px] text-amber-600" data-testid={`ty-underfunded-${option.id}`}>
          Below {money(option.minimumUseful)} this buys nothing real — and it will be valued that way.
        </p>
      )}
    </div>
  );
}

/** One valuation: the number, the five scores, and what would raise it. */
function OutlookCard({ outlook, data }: { outlook: Outlook; data: SimPayload }) {
  const { verdict } = outlook;
  const options = data.tenYears.options;
  const funded = Object.entries(outlook.allocation)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));

  return (
    <Card data-testid={`ty-outlook-${outlook.id}`}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <p className="text-3xl font-semibold tabular-nums" data-testid="ty-value">{valuation(verdict.tenYear)}</p>
            <p className="text-xs text-muted-foreground">what it's worth in ten years</p>
          </div>
          <div className="pb-1">
            <p className="text-sm tabular-nums">{valuation(verdict.peak)} <span className="text-muted-foreground">at its peak, in year {verdict.peakYear}</span></p>
          </div>
          <Badge variant="secondary" className="ml-auto" data-testid="ty-band">{outlook.band} · {outlook.overall}/1000</Badge>
        </div>

        {verdict.summary && <p className="text-sm leading-relaxed" data-testid="ty-summary">{verdict.summary}</p>}

        <div className="grid gap-2 sm:grid-cols-2">
          {data.tenYears.dimensions.map((d) => (
            <div key={d.id} className="rounded-lg border border-border p-3 space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium flex-1">{d.title}</p>
                <span className="text-sm tabular-nums" data-testid={`ty-score-${d.id}`}>{verdict.scores[d.id]}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden>
                <div className="h-full bg-primary" style={{ width: `${(verdict.scores[d.id] / 1000) * 100}%` }} />
              </div>
              {verdict.notes[d.id] && <p className="text-[11px] text-muted-foreground leading-snug">{verdict.notes[d.id]}</p>}
            </div>
          ))}
        </div>

        {verdict.advice.length > 0 && (
          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What would raise it</p>
            <ul className="text-sm space-y-1">
              {verdict.advice.map((a, i) => (
                <li key={i} className="flex gap-2"><span className="text-muted-foreground shrink-0">·</span><span>{a}</span></li>
              ))}
            </ul>
          </div>
        )}

        {/* The budget it was an answer to. Never a verdict without its question. */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>The million went:</p>
          <p>
            {funded.map(([id, n]) => `${money(n ?? 0)} on ${options.find((o) => o.id === id)?.label ?? id}`).join(" · ") || "nowhere"}
          </p>
          <p>Valued {stamp(outlook.createdAt)}.</p>
        </div>
      </CardContent>
    </Card>
  );
}
