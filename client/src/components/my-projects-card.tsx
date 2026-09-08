import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { RailCard, RailHeader } from "@/components/rail-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckInComposer } from "@/components/check-in-composer";
import { Eye, Plus, Check, Flame, Settings2, PenLine } from "lucide-react";

interface ProjectStatus {
  id: string;
  title: string;
  logoUrl: string | null;
  views: number;
  checkedIn: boolean;
  checkIn: { id: string; goal: string } | null;
  lastNextStep: string | null;
  streak: number;
}

/**
 * Your projects, on the home page, with the week's check-in in reach.
 *
 * The loop only works if the prompt to write one is where you land. Before
 * this, a check-in was six clicks inside a project's Manage screen and the
 * landing page pointed at discovery rails instead — so the habit the product
 * is built on was the hardest thing on it to do.
 *
 * Projects needing a check-in sort to the top, and their button breathes until
 * it's done.
 */
export function MyProjectsCard() {
  const [, setLocation] = useLocation();
  const [composingFor, setComposingFor] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ weekStart: string; projects: ProjectStatus[] }>({
    queryKey: ["/api/me/check-in-status"],
  });

  if (isLoading) {
    return (
      <RailCard>
        <RailHeader title="Your projects" />
        <div className="space-y-2 pt-1">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </RailCard>
    );
  }

  const projects = data?.projects ?? [];

  if (projects.length === 0) {
    return (
      <RailCard>
        <RailHeader title="Your projects" />
        <div className="pt-1 space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Start one, then post a check-in each week — what you aimed for, what shipped,
            what's next.
          </p>
          <Button asChild size="sm" variant="outline" className="w-full gap-1.5">
            <Link href="/projects/new" data-testid="rail-create-project">
              <Plus className="h-3.5 w-3.5" /> Create project
            </Link>
          </Button>
        </div>
      </RailCard>
    );
  }

  // Anything still owed this week comes first; the rest is history.
  const sorted = [...projects].sort((a, b) => Number(a.checkedIn) - Number(b.checkedIn));

  return (
    <>
      <RailCard>
        <RailHeader title="Your projects" href="/projects" />
        <div className="space-y-2.5 pt-1">
          {sorted.map((p) => (
            <div key={p.id} className="space-y-1.5" data-testid={`rail-project-${p.id}`}>
              <div className="flex items-start gap-2">
                {p.logoUrl ? (
                  <img
                    src={p.logoUrl} alt=""
                    className="h-8 w-8 rounded-md object-contain border border-border/60 bg-background p-0.5 shrink-0"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0 text-[11px] font-semibold text-muted-foreground">
                    {p.title.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/projects/${p.id}`}
                    className="text-sm font-medium leading-tight hover:underline block truncate"
                  >
                    {p.title}
                  </Link>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1 tabular-nums">
                      <Eye className="h-3 w-3" />{p.views.toLocaleString()}
                    </span>
                    {p.streak > 0 && (
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
                        <Flame className="h-3 w-3" />{p.streak}w
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-1.5">
                <Button
                  size="sm" variant={p.checkedIn ? "ghost" : "outline"}
                  className="btn-checkin flex-1 h-7 text-[11px] gap-1"
                  data-due={p.checkedIn ? "false" : "true"}
                  onClick={() => setComposingFor(p.id)}
                  data-testid={`rail-checkin-${p.id}`}
                >
                  {p.checkedIn
                    ? <><Check className="h-3 w-3" /> Checked in</>
                    : <><PenLine className="h-3 w-3" /> Check in</>}
                </Button>
                <Button
                  size="sm" variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setLocation(`/projects/${p.id}/manage`)}
                  title="Manage project"
                  data-testid={`rail-manage-${p.id}`}
                >
                  <Settings2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </RailCard>

      {composingFor && (
        <CheckInComposer
          projectId={composingFor}
          open
          onClose={() => setComposingFor(null)}
        />
      )}
    </>
  );
}
