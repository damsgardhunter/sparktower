/**
 * "What would it take?" in the Run section: pick a size, see the route there.
 *
 * Four targets across the top, the chosen one's roadmap underneath. Three
 * things about the layout are deliberate.
 *
 * The plain-English note on what each size of company *is* sits on the target
 * itself, before anything is generated and whether or not it ever is. The
 * decision this screen exists to inform is often made in the first ten
 * seconds — "oh, $100m means a management team and dozens of sites" — and
 * charging someone credits to find that out would be a poor trade.
 *
 * The computed multiple is shown next to Nova's words, not instead of them.
 * Nova writes the paragraphs; the gap, the stages and the verdict are worked
 * out from the company's numbers before Nova is asked (server/what-would-it-take.ts),
 * and the badge showing "26,000×" is the part that cannot be talked around.
 *
 * And the figures it was built from are always on screen with the date. A
 * roadmap generated in March against $19k a week is a different claim from one
 * generated today, and the whole reason runs are kept is so the two can be
 * compared — so the screen never shows an answer without showing what it was
 * an answer to.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { useConfirmPurchase } from "@/components/payment-dialog";
import { useOpenSurface } from "@/components/section/live";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Sparkles, TrendingUp, AlertTriangle, ArrowRight, ListChecks, Clock, Wrench, Scale, RefreshCw, GitCompare,
} from "lucide-react";
import { formatValue } from "@shared/company-rhythm";
import { showMultiple as times } from "@shared/what-would-it-take";
import type { Gap, WwitGrounding, WwitMovement, WwitRoadmapBody, WwitTargetId, WwitVerdict } from "@shared/what-would-it-take";

interface TargetView {
  id: WwitTargetId; revenue: number; label: string; short: string;
  whatItIs: string; worth: string; howMany: string | null;
}
interface StoredRoadmap {
  id: string; target: WwitTargetId; generatedAt: string; annualRevenue: number | null;
  grounding: WwitGrounding; roadmap: { gap: Gap | null; body: WwitRoadmapBody };
}
interface TargetSlot {
  latest: StoredRoadmap | null;
  previous: StoredRoadmap | null;
  runs: number;
  movement: WwitMovement | null;
}
interface WwitPayload {
  today: string;
  subcategory: string;
  targets: TargetView[];
  price: { cents: number; display: string; unlocked: boolean };
  aiAvailable: boolean;
  grounding: WwitGrounding;
  notReady: string | null;
  roadmaps: Record<WwitTargetId, TargetSlot>;
}

const wwitKey = (projectId: string) => ["/api/projects", projectId, "what-would-it-take"];

const VERDICT_TONE: Record<WwitVerdict, string> = {
  reachable: "secondary",
  "a stretch": "outline",
  "a different business": "destructive",
};

/** "22 Sep 2026, 14:03" — a roadmap's date matters to the hour when two were run the same day. */
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function WhatWouldItTake({ projectId }: { projectId: string }) {
  // RUN.S4.5's card sends people here rather than offering to write an answer onto the step.
  const surface = useOpenSurface("wwit");
  const { data, isLoading } = useQuery<WwitPayload>({ queryKey: wwitKey(projectId) });
  const [chosen, setChosen] = useState<WwitTargetId>("m1");
  const [comparing, setComparing] = useState<WwitTargetId | null>(null);

  /*
   * Open on a target that already has a roadmap, so coming back shows the work
   * rather than an empty picker. Runs once data arrives; after that the
   * person's choice wins, or every refetch would drag them back.
   */
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!data || opened) return;
    const withOne = data.targets.find((t) => data.roadmaps[t.id]?.latest);
    if (withOne) setChosen(withOne.id);
    setOpened(true);
  }, [data, opened]);

  if (isLoading || !data) {
    return <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>;
  }

  const target = data.targets.find((t) => t.id === chosen) ?? data.targets[0];
  const slot = data.roadmaps[target.id];
  const compareSlot = comparing ? data.roadmaps[comparing] : null;
  const compareTarget = comparing ? data.targets.find((t) => t.id === comparing) ?? null : null;

  return (
    <Card ref={surface.ref} className={surface.asked ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : undefined} data-testid="wwit">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">What would it take?</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Pick a size and Nova works out the route there from your own check-in numbers — the gap, the stages, what breaks first, and whether it is reachable from where you are. It will tell you when it isn't.
        </p>

        {/* The four sizes. Each says what that size of company is before anyone spends anything. */}
        <div className="grid gap-2 sm:grid-cols-2" data-testid="wwit-targets">
          {data.targets.map((t) => {
            const has = !!data.roadmaps[t.id]?.latest;
            const on = t.id === target.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setChosen(t.id)}
                aria-pressed={on}
                className={`text-left rounded-lg border p-3 transition-colors ${on ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                data-testid={`wwit-target-${t.id}`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{t.label}</span>
                  {has && <Badge variant="secondary" className="text-[10px]">Built</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t.whatItIs}</p>
              </button>
            );
          })}
        </div>

        <TargetPanel
          projectId={projectId}
          data={data}
          target={target}
          slot={slot}
          onCompare={() => setComparing(comparing ? null : data.targets.find((t) => t.id !== target.id && data.roadmaps[t.id]?.latest)?.id ?? null)}
          canCompare={data.targets.some((t) => t.id !== target.id && data.roadmaps[t.id]?.latest)}
          comparing={!!comparing}
        />

        {/* Two targets side by side: the same business, two ambitions, so the difference is the ambition. */}
        {compareSlot?.latest && compareTarget && (
          <div className="rounded-lg border border-border p-4 space-y-2" data-testid="wwit-compare">
            <div className="flex items-center gap-2 flex-wrap">
              <GitCompare className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-sm font-semibold">Next to {compareTarget.label}</p>
              <select
                className="ml-auto h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={comparing ?? ""}
                onChange={(e) => setComparing((e.target.value || null) as WwitTargetId | null)}
                data-testid="select-wwit-compare"
              >
                {data.targets.filter((t) => t.id !== target.id && data.roadmaps[t.id]?.latest).map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
            <VerdictLine body={compareSlot.latest.roadmap.body} gap={compareSlot.latest.roadmap.gap} />
            <ul className="text-sm text-muted-foreground space-y-1">
              {compareSlot.latest.roadmap.body.arithmetic.slice(0, 3).map((l, i) => <li key={i}>{l}</li>)}
            </ul>
            <p className="text-xs text-muted-foreground">Built {stamp(compareSlot.latest.generatedAt)}.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VerdictLine({ body, gap }: { body: WwitRoadmapBody; gap: Gap | null }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge variant={VERDICT_TONE[body.verdict] as any} data-testid="wwit-verdict">{body.verdict}</Badge>
      {gap && <span className="text-sm tabular-nums text-muted-foreground" data-testid="wwit-multiple">{times(gap.multiple)} where you are</span>}
      {/* A verdict the margin made harder says so, or it reads as an arbitrary judgement. */}
      {body.tightenedByMargin && (
        <span className="text-xs text-muted-foreground" data-testid="wwit-tightened">on revenue alone, "{body.verdictOnRevenueAlone}"</span>
      )}
    </div>
  );
}

function TargetPanel({ projectId, data, target, slot, onCompare, canCompare, comparing }: {
  projectId: string; data: WwitPayload; target: TargetView; slot: TargetSlot | undefined;
  onCompare: () => void; canCompare: boolean; comparing: boolean;
}) {
  const { toast } = useToast();
  const confirmPurchase = useConfirmPurchase();
  const latest = slot?.latest ?? null;

  const build = useMutation({
    mutationFn: async () => {
      /*
       * Asked before it spends, like every other priced outcome. Only on the
       * first one for this project: after that the price is zero and
       * confirmPurchase returns straight away, because re-running it to see
       * whether the gap moved is the whole point and charging for that would
       * be charging somebody to check.
       */
      if (!data.price.unlocked && !(await confirmPurchase("whatWouldItTake", {
        title: `What would it take to reach ${target.label}?`,
        detail: "Built once for this project. Re-running it — for this size or any of the other three — is free from then on.",
        projectId,
      }))) return null;
      return apiRequest("POST", `/api/projects/${projectId}/what-would-it-take/${target.id}`, {}).then((r) => r.json());
    },
    onSuccess: (result) => {
      if (!result) return;  // They cancelled at the price.
      queryClient.invalidateQueries({ queryKey: wwitKey(projectId) });
      // The generation closes a Run path step and takes the money; both are shown elsewhere.
      queryClient.invalidateQueries({ queryKey: ["/api/nova/wallet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "path"] });
    },
    onError: (e) => toast({ title: "Couldn't build that roadmap", description: errorText(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4 space-y-3" data-testid={`wwit-panel-${target.id}`}>
        <div className="flex items-start gap-2 flex-wrap">
          <div className="flex-1 min-w-[12rem] space-y-1">
            <p className="font-semibold">{target.label}</p>
            <p className="text-xs text-muted-foreground flex items-start gap-1.5"><Scale className="h-3.5 w-3.5 mt-0.5 shrink-0" />{target.worth}</p>
            {target.howMany && <p className="text-xs text-muted-foreground">{target.howMany}</p>}
          </div>
          <div className="flex items-center gap-2">
            {canCompare && (
              <Button size="sm" variant="ghost" onClick={onCompare} data-testid="button-wwit-compare">
                <GitCompare className="h-3.5 w-3.5 mr-1.5" />{comparing ? "Hide" : "Compare"}
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => build.mutate()}
              disabled={build.isPending || !!data.notReady || !data.aiAvailable}
              data-testid="button-wwit-build"
            >
              {build.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                : latest ? <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
              {latest ? "Run it again" : "Build the roadmap"}
              {/* Free once this project has one: the price is for the first, not for checking again. */}
              {!data.price.unlocked && <span className="ml-1.5 text-xs opacity-80">{data.price.display}</span>}
            </Button>
          </div>
        </div>

        {/* The refusal. Named before the button is pressed, so nobody pays to be told this. */}
        {data.notReady && (
          <p className="text-sm rounded-md border border-amber-500/40 bg-amber-500/5 p-3 flex gap-2" data-testid="wwit-not-ready">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <span>{data.notReady}</span>
          </p>
        )}
        {!data.notReady && !latest && (
          <p className="text-xs text-muted-foreground" data-testid="wwit-will-use">
            It will be built from {data.grounding.revenueFrom ?? "your check-ins"} — about {formatValue(data.grounding.annualRevenue, "money")} a year.
          </p>
        )}
        {!data.aiAvailable && <p className="text-xs text-muted-foreground">Nova isn't available right now.</p>}
      </div>

      {latest && <Roadmap projectId={projectId} stored={latest} movement={slot?.movement ?? null} runs={slot?.runs ?? 1} />}
    </div>
  );
}

function Roadmap({ projectId, stored, movement, runs }: {
  projectId: string; stored: StoredRoadmap; movement: WwitMovement | null; runs: number;
}) {
  const { toast } = useToast();
  const body = stored.roadmap.body;
  const gap = stored.roadmap.gap;

  const toBoard = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/what-would-it-take/${stored.id}/to-board`, {}).then((r) => r.json()),
    onSuccess: (r: { created: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] });
      toast({ title: `${r.created} step${r.created === 1 ? "" : "s"} on the board`, description: "They're in the Run section, ready to pick up." });
    },
    onError: (e) => toast({ title: "Couldn't send those to the board", description: errorText(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-4" data-testid="wwit-roadmap">
      <div className="space-y-2">
        <VerdictLine body={body} gap={gap} />
        <p className="text-sm font-medium leading-relaxed" data-testid="wwit-headline">{body.headline}</p>
      </div>

      {/* What it was built from, with the date. Never an answer without its question. */}
      <p className="text-xs text-muted-foreground" data-testid="wwit-built-from">
        Built {stamp(stored.generatedAt)} from {stored.grounding.revenueFrom ?? "your check-ins"}
        {stored.annualRevenue != null && ` — about ${formatValue(stored.annualRevenue, "money")} a year`}
        {` · ${stored.grounding.checkinsOnFile} check-in${stored.grounding.checkinsOnFile === 1 ? "" : "s"} on file`}
        {runs > 1 && ` · run ${runs} times`}
      </p>

      {/* How the gap moved since last time: the reason every run is kept. */}
      {movement && (
        <p className="text-sm rounded-md border border-border bg-muted/40 p-3" data-testid="wwit-movement">{movement.text}</p>
      )}

      <div className="space-y-1" data-testid="wwit-arithmetic">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">The arithmetic</p>
        <ul className="text-sm space-y-1">
          {body.arithmetic.map((l, i) => <li key={i} className="text-muted-foreground">{l}</li>)}
        </ul>
      </div>

      <div className="space-y-2" data-testid="wwit-stages">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">The stages</p>
        {body.stages.map((s) => (
          <div key={s.number} className="rounded-lg border border-border p-3 space-y-2" data-testid={`wwit-stage-${s.number}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">{s.number}. {s.title}</span>
              <Badge variant="outline" className="tabular-nums">{times(s.multiple)}</Badge>
              <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{s.howLong}</span>
              <span className="text-xs text-muted-foreground tabular-nums ml-auto">to {formatValue(s.endsAt, "money")} a year</span>
            </div>
            {s.mustBeTrue.length > 0 && (
              <ul className="text-sm space-y-1 list-disc pl-5 text-muted-foreground">
                {s.mustBeTrue.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            )}
            {s.breaksFirst && (
              <p className="text-sm flex gap-2"><Wrench className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" /><span><span className="text-muted-foreground">Breaks first: </span>{s.breaksFirst}{s.costToFix && <> <span className="text-muted-foreground">Fixing it: </span>{s.costToFix}</>}</span></p>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-2" data-testid="wwit-first90">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">The first 90 days</p>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => toBoard.mutate()} disabled={toBoard.isPending} data-testid="button-wwit-to-board">
            {toBoard.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5 mr-1.5" />}
            Send to the board
          </Button>
        </div>
        <ol className="space-y-2">
          {body.first90.map((s, i) => (
            <li key={i} className="flex gap-2 text-sm" data-testid={`wwit-step-${i}`}>
              <ArrowRight className="h-3.5 w-3.5 mt-1 shrink-0 text-primary" />
              <span><span className="font-medium">{s.title}</span>{s.why && <span className="text-muted-foreground"> — {s.why}</span>}</span>
            </li>
          ))}
        </ol>
      </div>

      {/*
        * What the business keeps, said whether or not anybody has filed it.
        * Revenue is not money kept, and an owner reading a roadmap about
        * turnover has to be told which of the two is on the screen.
        */}
      {body.marginNote && (
        <p className="text-sm rounded-md border border-border bg-muted/40 p-3" data-testid="wwit-margin-note">{body.marginNote}</p>
      )}

      <div className="space-y-1" data-testid="wwit-verdict-text">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Honestly</p>
        <p className="text-sm whitespace-pre-line leading-relaxed">{body.verdictText}</p>
        <p className="text-xs text-muted-foreground pt-1">{body.worth}</p>
      </div>
    </div>
  );
}
