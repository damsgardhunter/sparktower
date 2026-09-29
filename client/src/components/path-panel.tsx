/**
 * A section's path as its dashboard shows it, one shape for every section:
 * the one next step first, then progress, the section's own block (loops for
 * Ship, fundability for Systemize), the codebase link, recent activity and the
 * whole path — each block between thin rules, words kept to labels.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { refreshPath, useFail } from "@/components/path-work";
import { LoopTree } from "@/components/loop-tree";
import { CapitalProfileCard } from "@/components/capital-profile-card";
import { sectionDef } from "@/lib/sections";
import type { ProjectGoal } from "@shared/goals";
import { Block, Blocks } from "@/components/section/block";
import { useLivePath, useOpenMilestoneRequests, SyncDot } from "@/components/section/live";
import { NextStep } from "@/components/section/next-step";
import { NovaBuildsBusiness } from "@/components/section/nova-builds-business";
import { ProgressStats, ProgressStrip, NovaRead } from "@/components/section/progress";
import { CodebaseSync } from "@/components/section/codebase";
import { RecentActivity } from "@/components/section/activity";
import { PathMap } from "@/components/section/path-map";
import { TakeItAway } from "@/components/section/take-it-away";
import { NOVA_GRADIENT, plural, type PathStatus } from "@/components/section/path-types";
import { Activity, ChevronDown, ChevronUp, Code2, Compass, FileDown, GitBranch, ListTree, Loader2, LogOut, Map as MapIcon, Play, Repeat, Sparkles, TrendingUp, HandCoins } from "lucide-react";

export type { PathStatus, NoPath, PathResponse } from "@/components/section/path-types";

export function PathPanel({ projectId, goal, onNavigate, onStartSection, isPrimary = false }: {
  projectId: string; goal: ProjectGoal; onNavigate: (tab: string) => void; onStartSection?: () => void; isPrimary?: boolean;
}) {
  const { toast } = useToast();
  const fail = useFail();
  const { data: raw, isLoading, isFetching, isError, dataUpdatedAt, flash } = useLivePath(projectId, goal);
  const [showMap, setShowMap] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const def = sectionDef(goal);

  useOpenMilestoneRequests((id) => { setShowMap(true); setOpen(id); });

  const refresh = () => refreshPath(projectId);
  const adopt = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/path/adopt`, { goal }).then((r) => r.json()),
    onSuccess: (r: any) => {
      refresh();
      const bits = [
        r.recognised?.length ? `${r.recognised.length} marked done` : null,
        r.filled?.length ? `${r.filled.length} written in` : null,
        r.loops?.created?.length ? `${plural(r.loops.created.length, "loop")} found` : null,
        r.plan && r.plan.loops > 1 ? `${Math.round(r.plan.authoredDays / 7)}-week plan` : null,
      ].filter(Boolean);
      toast({ title: bits.length ? `Nova re-read your project: ${bits.join(", ")}` : (r.built ? "Your project is on its path" : "Nothing new — the path already matches"), description: r.read || undefined });
    },
    onError: fail,
  });
  const branch = useMutation({
    mutationFn: (b: { phaseId: string | null; extend?: boolean }) => apiRequest("POST", `/api/projects/${projectId}/path/branch`, { ...b, goal }).then((r) => r.json()),
    onSuccess: (r: any, b) => { refresh(); toast({ title: b.phaseId ? (b.extend ? `Extending — round ${r.round}` : "Keep building it is") : "Back on the main line" }); },
    onError: fail,
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (!raw) return null;

  if (!raw.adopted) {
    const Icon = def.icon;
    if (raw.started === false) {
      return (
        <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center space-y-4" data-testid="section-not-started">
          <span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${NOVA_GRADIENT}`}><Icon className="h-5 w-5 text-white" /></span>
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">{def.label}</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto line-clamp-2">{raw.promise || def.blurb}</p>
          </div>
          {onStartSection && (
            <Button onClick={onStartSection} className="gap-1.5" data-testid="button-start-section"><Play className="h-4 w-4" />Start {def.short}</Button>
          )}
        </div>
      );
    }
    // Made before paths existed. Offer the path, and Nova's read of where the work already is.
    return (
      <div className="rounded-xl border border-primary/40 p-5 space-y-3" data-testid="path-adopt">
        <div className="space-y-1">
          <p className="font-semibold">Put {def.short} on its path</p>
          <p className="text-sm text-muted-foreground">{raw.existingDone}/{raw.existingTasks} tasks already done — Nova marks what's finished.</p>
        </div>
        <Button size="sm" onClick={() => adopt.mutate()} disabled={adopt.isPending} data-testid="button-adopt-path">
          {adopt.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
          {adopt.isPending ? "Nova is reading…" : "Start the path"}
        </Button>
      </div>
    );
  }

  const data: PathStatus = raw;

  const loopsWritten = data.loopTree ? data.loopTree.loops.filter((l) => l.written).length : 0;

  return (
    <Blocks className="" >
      <Block title="Next step" icon={Compass} testid="path-panel">
        <NextStep projectId={projectId} data={data} onNavigate={onNavigate} />

        {/* Nova doing the whole path at once, and what it's doing while it does. */}
        <NovaBuildsBusiness projectId={projectId} />

        {/* The fork: keep building, or go to users. Chosen, never drifted into. */}
        {data.offer && (
          <div className="rounded-lg border border-primary/30 p-3 flex items-center gap-3 flex-wrap" data-testid="branch-offer">
            <GitBranch className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug">{data.offer.title}</p>
              <p className="text-xs text-muted-foreground" title="Nova sorts what's left into what serves the loop, you pick a length, and the date moves live. Extending is activity — no penalty.">Main thing works. Extend, or move on.</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={branch.isPending} onClick={() => branch.mutate({ phaseId: data.offer!.phaseId })} data-testid="button-keep-building"><GitBranch className="h-3.5 w-3.5 mr-1.5" />Keep building</Button>
              <Button size="sm" variant="outline" onClick={() => toast({ title: "On to " + data.current.title })} data-testid="button-go-main">Move on</Button>
            </div>
          </div>
        )}
        {data.branch?.open && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap" data-testid="branch-strip">
            <GitBranch className="h-3.5 w-3.5 text-primary" /><span>Extending{data.branch.round > 1 ? ` · round ${data.branch.round}` : ""}</span>
            <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={branch.isPending} onClick={() => branch.mutate({ phaseId: data.branch!.phaseId, extend: true })} data-testid="button-extend-again"><Repeat className="h-3 w-3 mr-1" />Extend again</Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={branch.isPending} onClick={() => branch.mutate({ phaseId: null })} data-testid="button-leave-branch"><LogOut className="h-3 w-3 mr-1" />Go to users</Button>
          </div>
        )}
      </Block>

      {/*
        * How far along, in one line, directly under the step. The four tiles
        * and Nova's read of the pace are the same information at length, and
        * they are one click down rather than a quarter of the first screen.
        */}
      <Block title="Progress" icon={TrendingUp} collapsible defaultOpen={false} summary={<ProgressStrip data={data} />} testid="block-progress">
        <ProgressStats data={data} />
        <NovaRead projectId={projectId} data={data} adopting={adopt.isPending} onReevaluate={() => adopt.mutate()} />
      </Block>

      {data.loopTree && (
        <Block
          title={`Loops · ${data.loopTree.loops.length}`} icon={ListTree} testid="loop-tree-section"
          collapsible defaultOpen={false}
          summary={`${loopsWritten} of ${data.loopTree.loops.length} written`}
        >
          <LoopTree projectId={projectId} tree={data.loopTree} />
        </Block>
      )}

      {data.capital && data.capital.answered > 0 && (
        <Block
          title="Fundability" icon={HandCoins} testid="block-fundability"
          collapsible defaultOpen={false}
          summary={`${data.capital.score}/100 · ${data.capital.band.label}`}
        >
          <CapitalProfileCard capital={data.capital} />
        </Block>
      )}

      <Block
        title="Codebase" icon={Code2} testid="block-codebase"
        collapsible defaultOpen={false}
        summary={data.auditUpdate?.at ? "Read by Nova" : "Not read yet"}
        right={<SyncDot updatedAt={dataUpdatedAt} fetching={isFetching} error={isError} />}
      >
        <CodebaseSync projectId={projectId} data={data} onNavigate={onNavigate} />
      </Block>

      {/* What the path has written, as a file — see section/take-it-away.tsx. */}
      <Block title="Take it away" icon={FileDown} testid="block-export" collapsible defaultOpen={false} summary="PDF or Markdown">
        <TakeItAway projectId={projectId} goal={goal} />
      </Block>

      {data.events.length > 0 && (
        <Block
          title="Recent activity" icon={Activity} testid="block-activity"
          collapsible defaultOpen={false}
          summary={data.events[0]?.title}
        >
          <RecentActivity events={data.events} />
        </Block>
      )}

      {/*
        * The map had its own Show/Hide button inside a block that was always
        * open — two controls doing one job. The block's own collapse is the
        * control now, and `showMap` follows it so a milestone opened from a
        * notification still brings the map up with it.
        */}
      <Block
        title={`Whole path · ${data.phases.length} phases`}
        icon={MapIcon}
        testid="block-whole-path"
        collapsible
        /*
         * Keyed on `showMap` so that asking to open a milestone — from a
         * notification, say — remounts this block open. `defaultOpen` is read
         * once, by design: everywhere else the block should remember what the
         * person did with it.
         */
        key={showMap ? "map-open" : "map-closed"}
        defaultOpen={showMap}
        summary={data.promise}
      >
        <PathMap projectId={projectId} goal={goal} data={data} flash={flash} openId={open} onOpen={setOpen} isPrimary={isPrimary} />
      </Block>
    </Blocks>
  );
}
