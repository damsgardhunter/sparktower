/**
 * Round five: spending the first million.
 *
 * The round the valuation leans on hardest and the one that has to feel best,
 * because it is the only place in the game where a decision has a visible
 * price. Everything here is built around one idea: **the money should always
 * be visible, and it should always be moving.**
 *
 * ## What the screen is doing
 *
 * A single bar across the top holds the whole million. As you fund things it
 * fills with the colour of whichever group you are spending on, so the shape
 * of your company appears in it — a bar that is four-fifths hiring looks very
 * different from one that is half marketing, and you can see that before
 * anybody tells you.
 *
 * The number that stays largest on the screen is what is *left*, not what is
 * spent. Spending a million is easy and slightly thrilling; watching the
 * remainder fall towards zero is the part that makes people stop and think,
 * which is the point of the round.
 *
 * Lines funded below what they actually cost are called out rather than
 * silently counted — half a senior engineer is not half a product, it is an
 * unfilled role and a hole in the bank, and "we funded seven things badly" is
 * the commonest way a first million disappears.
 */
import { useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle, Undo2 } from "lucide-react";
import {
  BUDGET_TOTAL, money, summariseBudget, unallocated, type Allocation,
} from "@shared/sprints/budget";
import { SPEND_OPTIONS, type SpendOption } from "@shared/sprints/cards";

/**
 * A colour per group.
 *
 * Four groups, four hues, held constant across the bar, the legend and every
 * row — the bar is only readable at a glance if the colour that means "hiring"
 * there means "hiring" everywhere else too.
 */
const GROUP_COLOURS: Record<string, string> = {
  Hiring: "bg-violet-500",
  Product: "bg-sky-500",
  "Getting customers": "bg-emerald-500",
  "Keeping it standing": "bg-amber-500",
};

const GROUP_TEXT: Record<string, string> = {
  Hiring: "text-violet-500",
  Product: "text-sky-500",
  "Getting customers": "text-emerald-500",
  "Keeping it standing": "text-amber-500",
};

const GROUPS = ["Hiring", "Product", "Getting customers", "Keeping it standing"];

/** The whole million, as one bar. */
function BudgetBar({ allocation }: { allocation: Allocation }) {
  const summary = useMemo(() => summariseBudget(allocation), [allocation]);
  const left = BUDGET_TOTAL - summary.total;

  return (
    <div className="space-y-2">
      <div className="flex h-6 w-full overflow-hidden rounded-full bg-muted" data-testid="budget-bar">
        {GROUPS.map((group) => {
          const amount = summary.byGroup.find((g) => g.group === group)?.amount ?? 0;
          if (amount <= 0) return null;
          return (
            <div
              key={group}
              className={cn("transition-all duration-300 ease-out", GROUP_COLOURS[group])}
              style={{ width: `${(amount / BUDGET_TOTAL) * 100}%` }}
              title={`${group}: ${money(amount)}`}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {GROUPS.map((group) => {
          const amount = summary.byGroup.find((g) => g.group === group)?.amount ?? 0;
          return (
            <span key={group} className={cn("flex items-center gap-1.5", amount > 0 ? "" : "opacity-40")}>
              <span className={cn("h-2 w-2 rounded-full", GROUP_COLOURS[group])} />
              <span className="text-muted-foreground">{group}</span>
              <span className="font-medium tabular-nums">{money(amount)}</span>
            </span>
          );
        })}
        <span className={cn("flex items-center gap-1.5", left > 0 ? "" : "opacity-40")}>
          <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
          <span className="text-muted-foreground">Unspent</span>
          <span className="font-medium tabular-nums">{money(left)}</span>
        </span>
      </div>
    </div>
  );
}

/** One thing you can put money into. */
function SpendRow({
  option, amount, remaining, onChange,
}: {
  option: SpendOption; amount: number; remaining: number; onChange: (n: number) => void;
}) {
  const ceiling = amount + remaining;
  const underfunded = amount > 0 && amount < option.minimumUseful;
  const share = amount / BUDGET_TOTAL;

  return (
    <div
      data-testid={`spend-${option.id}`}
      className={cn(
        "rounded-xl border p-4 transition-colors",
        amount > 0 ? "border-border bg-card" : "border-border/60 bg-card/50",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", GROUP_COLOURS[option.group])} />
            <span className="font-medium leading-snug">{option.label}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{option.detail}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn(
            "text-lg font-semibold tabular-nums transition-colors",
            amount > 0 ? GROUP_TEXT[option.group] : "text-muted-foreground/40",
          )}>
            {money(amount)}
          </div>
          {amount > 0 && (
            <div className="text-[11px] text-muted-foreground tabular-nums">
              {(share * 100).toFixed(0)}% of the million
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Slider
          value={[amount]}
          min={0}
          max={Math.max(option.step, Math.floor(ceiling / option.step) * option.step)}
          step={option.step}
          onValueChange={([n]) => onChange(n)}
          aria-label={option.label}
          className="flex-1"
        />
        {amount > 0 && (
          <Button
            type="button" variant="ghost" size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            onClick={() => onChange(0)}
            aria-label={`Clear ${option.label}`}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground/90">{option.consequence}</p>

      {/*
        * Said out loud rather than counted silently. A line funded below what
        * it costs bought nothing, and the player should find that out here
        * rather than in the valuation.
        */}
      {underfunded && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            Under {money(option.minimumUseful)} this doesn't buy the thing it names — it's an unfilled
            role and a hole in the bank.
          </span>
        </p>
      )}
    </div>
  );
}

export function BudgetRound({
  allocation, onChange, onCommit, committed, partnerTotal, busy,
}: {
  allocation: Allocation;
  onChange: (next: Allocation) => void;
  onCommit: () => void;
  committed: boolean;
  /** What your partner has put in so far, if anything. */
  partnerTotal: number | null;
  busy?: boolean;
}) {
  const left = unallocated(allocation);
  const spent = BUDGET_TOTAL - left;

  const set = (id: string, n: number) => onChange({ ...allocation, [id]: n });

  return (
    <div className="space-y-5">
      {/*
        * What's left, not what's spent, is the big number. Spending a million
        * is easy and slightly thrilling; watching the remainder fall towards
        * zero is what makes somebody stop and think.
        */}
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Left to spend</p>
            <p
              data-testid="budget-remaining"
              className={cn(
                "text-4xl font-semibold tabular-nums tracking-tight transition-colors",
                left === 0 ? "text-primary" : left < 100_000 ? "text-amber-500" : "",
              )}
            >
              {money(left)}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="text-muted-foreground">Committed</p>
            <p className="text-lg font-medium tabular-nums">{money(spent)}</p>
          </div>
        </div>

        <div className="mt-4">
          <BudgetBar allocation={allocation} />
        </div>

        {/*
          * The committed budget is the average of both, so knowing they've put
          * something in — and roughly how much — is what turns this into a
          * negotiation rather than two people filling in a form.
          */}
        {partnerTotal !== null && (
          <p className="mt-3 text-xs text-muted-foreground">
            Your partner has committed {money(partnerTotal)}. What gets spent is the average of
            your two budgets, so talk to them.
          </p>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {GROUPS.map((group) => (
          <div key={group} className="space-y-3">
            <h3 className={cn("flex items-center gap-2 text-sm font-semibold", GROUP_TEXT[group])}>
              <span className={cn("h-2.5 w-2.5 rounded-full", GROUP_COLOURS[group])} />
              {group}
            </h3>
            {SPEND_OPTIONS.filter((o) => o.group === group).map((option) => (
              <SpendRow
                key={option.id}
                option={option}
                amount={allocation[option.id] ?? 0}
                remaining={left}
                onChange={(n) => set(option.id, n)}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
        <div className="text-sm">
          {left === BUDGET_TOTAL
            ? <span className="text-muted-foreground">Put the money somewhere.</span>
            : <span><span className="font-medium tabular-nums">{money(spent)}</span> committed, <span className="tabular-nums">{money(left)}</span> left</span>}
        </div>
        <Button onClick={onCommit} disabled={busy || left === BUDGET_TOTAL} data-testid="button-commit-budget">
          {committed ? "Update my budget" : "Lock in my budget"}
        </Button>
      </div>
    </div>
  );
}

export { GROUP_COLOURS, GROUP_TEXT, GROUPS };
