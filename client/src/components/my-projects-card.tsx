import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { RailCard, RailHeader } from "@/components/rail-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { NextStepItem } from "@/components/continue-path-card";
import type { Project } from "@shared/schema";
import { Eye, Plus, Settings2 } from "lucide-react";

/**
 * Your projects, on the home rail, each with the next step on its path.
 *
 * The list comes from your projects; the next step comes from the same
 * next-steps feed "Continue your path" uses, matched by project. A project
 * with no started path just links to its manage page.
 */
export function MyProjectsCard() {
  const { data: projects, isLoading } = useQuery<Project[]>({ queryKey: ["/api/user/projects"] });
  const { data: steps } = useQuery<{ items: NextStepItem[] }>({ queryKey: ["/api/me/next-steps"] });

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

  const list = projects ?? [];

  if (list.length === 0) {
    return (
      <RailCard>
        <RailHeader title="Your projects" />
        <div className="pt-1 space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Start a project and Nova lays out the path to ship it.
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

  // The primary section's item for each project, else its first.
  const nextByProject = new Map<string, NextStepItem>();
  for (const item of steps?.items ?? []) {
    const existing = nextByProject.get(item.project.id);
    if (!existing || (item.track?.primary && !existing.track?.primary)) nextByProject.set(item.project.id, item);
  }

  // Projects with a path, most recently worked first (the feed's order), then the rest.
  const order = new Map((steps?.items ?? []).map((it, i) => [it.project.id, i] as const));
  const sorted = [...list].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));

  return (
    <RailCard>
      <RailHeader title="Your projects" href="/projects?view=mine" />
      <div className="space-y-2.5 pt-1">
        {sorted.slice(0, 5).map((p) => {
          const item = nextByProject.get(p.id);
          const nextLabel = item?.next ? (item.next.step ?? item.next.title) : null;
          return (
            <div key={p.id} className="flex items-start gap-2" data-testid={`rail-project-${p.id}`}>
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
                <p className="text-[11px] text-muted-foreground truncate" data-testid={`rail-project-next-${p.id}`}>
                  {nextLabel
                    ? <>Next: <span className="text-foreground">{nextLabel}</span></>
                    : item
                      ? "Main line done"
                      : <span className="inline-flex items-center gap-1 tabular-nums"><Eye className="h-3 w-3" />{(p.views ?? 0).toLocaleString()}</span>}
                </p>
              </div>
              <Button
                asChild size="sm" variant="ghost"
                className="h-7 w-7 p-0 shrink-0"
                title="Manage project"
                data-testid={`rail-manage-${p.id}`}
              >
                <Link href={item?.track ? `/projects/${p.id}/manage?section=${item.track.goal}` : `/projects/${p.id}/manage`}>
                  <Settings2 className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          );
        })}
      </div>
    </RailCard>
  );
}
