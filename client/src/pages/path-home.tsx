/**
 * Path home: every project's next step, on one screen.
 *
 * The home feed has the same list behind a toggle and each project's dashboard
 * has its own path, but neither is a place you can be sent to — and "come back
 * and pick up where you left off" is the whole retention loop. So this is the
 * address for that: what's waiting, across everything, with the way into each.
 *
 * It renders the same row as the home card (NextStepRow) rather than its own,
 * because two answers to "what should I do next" would disagree within a week.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { NextStepRow, ShareStepDialog, WeeklyUpdateDialog, type NextStepItem } from "@/components/continue-path-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Compass, Loader2, Plus } from "lucide-react";

export default function PathHome() {
  const { data, isLoading } = useQuery<{ items: NextStepItem[] }>({ queryKey: ["/api/me/next-steps"] });
  const [sharing, setSharing] = useState<NextStepItem | null>(null);
  const [weekly, setWeekly] = useState<NextStepItem | null>(null);
  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 space-y-4" data-testid="path-home">
      <div className="flex items-center gap-2">
        <Compass className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">Your path</h1>
        {items.length > 0 && (
          <span className="rounded-full bg-primary/10 text-primary px-2 py-px text-xs font-medium" data-testid="path-home-count">{items.length}</span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        /*
         * Nothing waiting means one of two things — no project yet, or every
         * path finished — and both are answered the same way: start one.
         */
        <Card data-testid="path-home-empty">
          <CardContent className="p-6 text-center space-y-3">
            <p className="font-medium">Nothing waiting on a path right now.</p>
            <p className="text-sm text-muted-foreground">
              A project's path is the sequence Nova works out with you — one step at a time, each with something to show at the end of it.
            </p>
            <Button asChild data-testid="button-path-home-new-project">
              <Link href="/projects/new"><Plus className="h-4 w-4 mr-1" /> Start a project</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-lg border-primary/30">
          <CardContent className="p-0 text-[13px]">
            <ul className="divide-y divide-border/60">
              {items.map((item) => (
                <NextStepRow key={`${item.project.id}:${item.track?.goal ?? ""}`} item={item} onShare={setSharing} onWeekly={setWeekly} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {weekly?.weekly && (
        <WeeklyUpdateDialog projectId={weekly.project.id} projectTitle={weekly.project.title} steps={weekly.weekly.steps} open onClose={() => setWeekly(null)} />
      )}
      {sharing?.lastDone && (
        <ShareStepDialog
          projectId={sharing.project.id} projectTitle={sharing.project.title}
          step={sharing.lastDone} open onClose={() => setSharing(null)}
        />
      )}
    </div>
  );
}
