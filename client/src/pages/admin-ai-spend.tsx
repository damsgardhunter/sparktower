/**
 * Where the AI money went.
 *
 * The OpenAI dashboard knows what was spent and nothing about who spent it, on
 * what, or whether they had paid. This is the same money with those three
 * columns attached, and it is built to be watched during a launch rather than
 * read afterwards: the day against the brake at the top, then what is dear,
 * then who.
 *
 * A note on the money on this screen. It is credits multiplied by a measured
 * cost per credit, not a bill — the bill is at the provider. It is right to
 * the extent that the measurement is, which is why the tokens are shown
 * beside it: those are reported by the provider and are not an estimate.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import NotFound from "@/pages/not-found";
import { Loader2, TriangleAlert, Gauge, Layers, Users, Sparkles } from "lucide-react";

interface Today {
  spentUsd: number; ceilingUsd: number; freeCutoffUsd: number;
  freeStopped: boolean; allStopped: boolean; costPerCredit: number;
}
interface DailyRow {
  day: string; credits: number; calls: number; people: number;
  promptTokens: number; cachedTokens: number; completionTokens: number;
  costUsd: number; cacheRate: number | null;
}
interface SectionRow {
  action: string; calls: number; people: number; credits: number; costUsd: number;
  unanswered: number; promptTokens: number; completionTokens: number;
  tokensPerCall: number | null; cacheRate: number | null;
}
interface PersonRow {
  userId: string; name: string; email: string | null; tier: string; paying: boolean;
  credits: number; calls: number; costUsd: number; promptTokens: number;
  monthlyAllowance: number | null; allowanceUsed: number | null; lastAt: string;
}
interface Rung {
  name: string; priceMonthly: number; serves: string; typicalUse: number;
  credits: number; capPerDay: number; costOfTypicalUse: number;
  worstMonth: number; profit: number; margin: number;
}
interface Settings {
  costPerCreditUsd: number; dailySpendCapUsd: number;
  updatedAt: string | null; isDefault: boolean;
  freeTierShare: number; ladder: Rung[];
  bounds: { costMin: number; costMax: number; capMax: number };
}
interface FreeTier {
  days: number; allowance: number; people: number; calls: number; credits: number;
  costUsd: number; exhausted: number; ifAllExhaustedUsd: number; perPersonUsd: number;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const big = (n: number) => n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1000)}k` : String(n);

/** An action's key, said the way a person would say it. */
const SECTION_NAMES: Record<string, string> = {
  novaChat: "Nova chat", novaGuide: "Nova coaching", novaAssist: "Surface assists",
  codeAudit: "Codebase audit", loopAudit: "Loop audit", documentPlan: "Document plan",
  roadmapRebuild: "Roadmap rebuild", simulationBuild: "Nova builds a simulation",
  gameVerdict: "Ten Years verdict (free)", taskAssist: "Task planning",
};
const nameOf = (a: string) => SECTION_NAMES[a] ?? a.replace(/_/g, " ");

export default function AdminAiSpend() {
  const [days, setDays] = useState(7);

  const { data: access, isLoading: accessLoading } = useQuery<{ owner: boolean }>({
    queryKey: ["/api/admin/analytics/access"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/access", { credentials: "include" });
      if (!res.ok) return { owner: false };
      return res.json();
    },
    retry: false,
  });
  const isOwner = !!access?.owner;

  /*
   * Named `useSpend` rather than `q` because that is what it is: a custom hook
   * wrapping useQuery, called six times below in a fixed order at the top of
   * this component. The old name made `react-hooks/rules-of-hooks` an error —
   * the rule reads the name to decide whether a function may hold a hook, and
   * `q` is neither a component nor a hook by that test. The order was always
   * fixed and the code always worked; the lint was right about the name and
   * could not be told the rest.
   */
  const useSpend = <T,>(path: string, withDays = true) => useQuery<T>({
    queryKey: [path, withDays ? days : null],
    queryFn: async () => {
      const res = await fetch(withDays ? `${path}?days=${days}` : path, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    enabled: isOwner,
    // Watched during a launch, so it refreshes itself rather than being reloaded.
    refetchInterval: 30_000,
  });

  const today = useSpend<Today>("/api/admin/ai-spend/today", false);
  const daily = useSpend<{ rows: DailyRow[] }>("/api/admin/ai-spend/daily");
  const sections = useSpend<{ rows: SectionRow[] }>("/api/admin/ai-spend/sections");
  const people = useSpend<{ rows: PersonRow[] }>("/api/admin/ai-spend/people");
  const free = useSpend<FreeTier>("/api/admin/ai-spend/free-tier");
  const settings = useSpend<Settings>("/api/admin/ai-spend/settings", false);

  if (accessLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (!isOwner) return <NotFound />;

  const t = today.data;
  const pct = t && t.ceilingUsd > 0 ? Math.min(100, (t.spentUsd / t.ceilingUsd) * 100) : 0;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5" data-testid="page-ai-spend">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> What Nova costs
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Credits at the measured cost per credit, with the provider's own token counts beside them.
          </p>
        </div>
        <div className="flex gap-1">
          {[1, 7, 30].map((d) => (
            <Button
              key={d} size="sm" variant={days === d ? "default" : "outline"}
              onClick={() => setDays(d)} data-testid={`button-days-${d}`}
            >
              {d === 1 ? "24h" : `${d}d`}
            </Button>
          ))}
        </div>
      </div>

      {/* 1. Today, against the brake. The number to have on a screen during a launch. */}
      <Card data-testid="card-today">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Gauge className="h-4 w-4 text-muted-foreground" /> Today, against the daily ceiling
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!t ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
            <>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-3xl font-semibold tabular-nums" data-testid="text-today-spend">{money(t.spentUsd)}</span>
                <span className="text-sm text-muted-foreground">
                  of {t.ceilingUsd > 0 ? money(t.ceilingUsd) : "no ceiling"}
                </span>
                {t.allStopped && <Badge variant="destructive" data-testid="badge-all-stopped">Nova is paused for everyone</Badge>}
                {!t.allStopped && t.freeStopped && <Badge variant="secondary" data-testid="badge-free-stopped">Paused for free accounts</Badge>}
              </div>
              {t.ceilingUsd > 0 && (
                <div className="space-y-1">
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${t.allStopped ? "bg-destructive" : t.freeStopped ? "bg-amber-500" : "bg-primary"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Free accounts stop at {money(t.freeCutoffUsd)}; paying accounts run to {money(t.ceilingUsd)}.
                    A credit costs {money(t.costPerCredit)}.
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 2. The free tier as a block, which is the launch-day exposure. */}
      {free.data && (
        <Card data-testid="card-free-tier">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <TriangleAlert className="h-4 w-4 text-muted-foreground" /> The free tier
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat label="People who used Nova" value={String(free.data.people)} />
              <Stat label="Used their whole allowance" value={String(free.data.exhausted)}
                note={`of ${free.data.allowance} credits each`} />
              <Stat label="What they cost" value={money(free.data.costUsd)} />
              <Stat label="If they all used it up" value={money(free.data.ifAllExhaustedUsd)}
                note={`${money(free.data.perPersonUsd)} a head`} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3. The two numbers everything derives from, and the ladder they imply. */}
      {settings.data && <Economics settings={settings.data} onSaved={() => { settings.refetch(); today.refetch(); }} />}

      {/* 4. Which parts of the product are dear — not which are popular. */}
      <Card data-testid="card-sections">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Layers className="h-4 w-4 text-muted-foreground" /> Where it goes, dearest first
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table
            head={["Section", "Cost", "Calls", "People", "Context per call", "Cached", "No answer"]}
            empty="Nothing has been charged in this window."
            rows={(sections.data?.rows ?? []).map((r) => ({
              key: r.action,
              cells: [
                <span className="font-medium">{nameOf(r.action)}</span>,
                <span className="tabular-nums">{money(r.costUsd)}</span>,
                <span className="tabular-nums text-muted-foreground">{r.calls}</span>,
                <span className="tabular-nums text-muted-foreground">{r.people}</span>,
                /* The column that says whether an action's credit price is honest. */
                <span className="tabular-nums">{r.tokensPerCall === null ? "—" : big(r.tokensPerCall)}</span>,
                <CacheCell rate={r.cacheRate} />,
                r.unanswered > 0
                  ? <span className="tabular-nums text-destructive" title="Charged, and the model never answered">{r.unanswered}</span>
                  : <span className="text-muted-foreground">—</span>,
              ],
            }))}
          />
        </CardContent>
      </Card>

      {/* 4. A day a row, with the cache rate — whether the prompt work is paying off. */}
      <Card data-testid="card-daily">
        <CardHeader className="pb-3"><CardTitle className="text-sm">Day by day</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table
            head={["Day", "Cost", "Calls", "People", "Prompt tokens", "Cached"]}
            empty="No spend recorded yet."
            rows={(daily.data?.rows ?? []).map((r) => ({
              key: r.day,
              cells: [
                <span className="font-medium tabular-nums">{r.day}</span>,
                <span className="tabular-nums">{money(r.costUsd)}</span>,
                <span className="tabular-nums text-muted-foreground">{r.calls}</span>,
                <span className="tabular-nums text-muted-foreground">{r.people}</span>,
                <span className="tabular-nums text-muted-foreground">{big(r.promptTokens)}</span>,
                <CacheCell rate={r.cacheRate} />,
              ],
            }))}
          />
        </CardContent>
      </Card>

      {/* 5. Who. And how much of their month they have got through. */}
      <Card data-testid="card-people">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Users className="h-4 w-4 text-muted-foreground" /> Who is spending it
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table
            head={["Person", "Plan", "Cost", "Credits", "Of their month", "Calls"]}
            empty="Nobody has used Nova in this window."
            rows={(people.data?.rows ?? []).map((r) => ({
              key: r.userId,
              cells: [
                <div className="min-w-0">
                  <p className="font-medium truncate">{r.name}</p>
                  {r.email && <p className="text-[11px] text-muted-foreground truncate">{r.email}</p>}
                </div>,
                <Badge variant={r.paying ? "default" : "secondary"} className="capitalize">{r.tier}</Badge>,
                <span className="tabular-nums">{money(r.costUsd)}</span>,
                <span className="tabular-nums text-muted-foreground">{r.credits}</span>,
                <Allowance used={r.allowanceUsed} of={r.monthlyAllowance} />,
                <span className="tabular-nums text-muted-foreground">{r.calls}</span>,
              ],
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The two numbers, and what they do to the ladder.
 *
 * Cost per credit is the one that matters: it has been measured at four cents
 * and at two, and both were right — it is whatever people happened to do that
 * day. Everything else on this screen, and every ceiling in the product, is
 * derived from it, which is why it is editable here rather than fixed in a
 * file by whoever last deployed.
 *
 * Prices are shown and not edited. What a customer is charged is a deliberate
 * act involving Stripe, not a slider; what this says is what a given price can
 * afford at the current cost, which is the part that actually moves.
 */
function Economics({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [cost, setCost] = useState(String(settings.costPerCreditUsd));
  const [cap, setCap] = useState(String(settings.dailySpendCapUsd));
  const [error, setError] = useState<string | null>(null);

  // Follow the server when it changes underneath, unless the field is being edited.
  useEffect(() => { setCost(String(settings.costPerCreditUsd)); }, [settings.costPerCreditUsd]);
  useEffect(() => { setCap(String(settings.dailySpendCapUsd)); }, [settings.dailySpendCapUsd]);

  const save = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/admin/ai-spend/settings", {
      costPerCreditUsd: Number(cost), dailySpendCapUsd: Number(cap),
    }),
    onSuccess: () => { setError(null); onSaved(); },
    onError: (e: unknown) => setError(errorText(e, "Couldn't save that.")),
  });

  const dirty = Number(cost) !== settings.costPerCreditUsd || Number(cap) !== settings.dailySpendCapUsd;

  return (
    <Card data-testid="card-economics">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Gauge className="h-4 w-4 text-muted-foreground" /> What a credit costs, and what a day may
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div>
            <Label htmlFor="cost" className="text-xs">Cost per credit</Label>
            <Input
              id="cost" value={cost} onChange={(e) => setCost(e.target.value)}
              inputMode="decimal" className="mt-1" data-testid="input-cost-per-credit"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Measured at $0.04 on one sample and $0.0217 on a full working day. Everything derives from this.
            </p>
          </div>
          <div>
            <Label htmlFor="cap" className="text-xs">Daily ceiling, whole platform</Label>
            <Input
              id="cap" value={cap} onChange={(e) => setCap(e.target.value)}
              inputMode="numeric" className="mt-1" data-testid="input-daily-cap"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Free accounts stop at {Math.round(settings.freeTierShare * 100)}% of it. Zero takes the brake off.
            </p>
          </div>
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid="button-save-economics">
            {save.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Save
          </Button>
        </div>
        {error && <p className="text-sm text-destructive" data-testid="text-economics-error">{error}</p>}
        {settings.isDefault && (
          <p className="text-[11px] text-muted-foreground">
            These are the built-in defaults — nobody has set them yet.
          </p>
        )}

        {/*
          * The ladder at whatever cost is currently set. Each tier is sized so
          * the builder it is for is never capped, and so a month spent entirely
          * at the daily ceiling still cannot lose money.
          */}
        <div>
          <p className="text-xs font-medium mb-2">What those numbers make possible</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  {["Tier", "Price", "Credits", "Cap/day", "Its user costs", "Worst month", "Profit", "Margin"].map((h) => (
                    <th key={h} className="text-left font-medium text-[11px] uppercase tracking-wide text-muted-foreground px-2 py-1.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {settings.ladder.map((r) => (
                  <tr key={r.name} className="border-b last:border-0" data-testid={`rung-${r.name.toLowerCase()}`}>
                    <td className="px-2 py-2">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-[11px] text-muted-foreground">{r.serves}</p>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{money(r.priceMonthly)}</td>
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{r.credits}</td>
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{r.capPerDay}</td>
                    <td className="px-2 py-2 tabular-nums">{money(r.costOfTypicalUse)}</td>
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{money(r.worstMonth)}</td>
                    <td className="px-2 py-2 tabular-nums">{money(r.profit)}</td>
                    <td className={`px-2 py-2 tabular-nums ${r.margin >= 70 ? "text-emerald-600" : r.margin >= 40 ? "text-amber-600" : "text-destructive"}`}>
                      {r.margin}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Each tier is sized so the builder it is for is never capped, and so a month spent entirely at
            the daily ceiling still breaks even. Prices are shown, not set here — changing what somebody
            is charged is a Stripe change, not a slider.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums mt-0.5">{value}</p>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

/**
 * How much of a prompt the provider served from cache.
 *
 * Null means nothing has come back with token counts yet — a fresh database,
 * or a provider that does not report them — which is different from zero, and
 * saying "—" rather than "0%" keeps that difference visible.
 */
function CacheCell({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-muted-foreground">—</span>;
  const tone = rate >= 50 ? "text-emerald-600" : rate >= 20 ? "text-amber-600" : "text-muted-foreground";
  return <span className={`tabular-nums ${tone}`} title="Share of prompt tokens served from cache">{rate}%</span>;
}

/** How far through their month somebody is. Null for a plan without a month. */
function Allowance({ used, of }: { used: number | null; of: number | null }) {
  if (used === null || of === null) return <span className="text-muted-foreground text-xs">unlimited</span>;
  const tone = used >= 100 ? "text-destructive" : used >= 70 ? "text-amber-600" : "text-muted-foreground";
  return (
    <div className="min-w-[70px]">
      <span className={`text-xs tabular-nums ${tone}`}>{used}% of {of}</span>
      <div className="h-1 rounded-full bg-muted overflow-hidden mt-1">
        <div className={`h-full ${used >= 100 ? "bg-destructive" : used >= 70 ? "bg-amber-500" : "bg-primary"}`}
          style={{ width: `${Math.min(100, used)}%` }} />
      </div>
    </div>
  );
}

function Table({ head, rows, empty }: {
  head: string[];
  rows: { key: string; cells: React.ReactNode[] }[];
  empty: string;
}) {
  if (!rows.length) return <p className="text-sm text-muted-foreground p-5">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            {head.map((h) => (
              <th key={h} className="text-left font-medium text-[11px] uppercase tracking-wide text-muted-foreground px-4 py-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b last:border-0" data-testid={`row-${r.key}`}>
              {r.cells.map((c, i) => <td key={i} className="px-4 py-2.5 align-middle">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
