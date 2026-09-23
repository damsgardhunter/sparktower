/**
 * Startups the company keeps an eye on.
 *
 * Three parts: the industries it watches (new public projects in them arrive
 * as notifications), the projects it follows (each one moving arrives as a
 * notification too), and suggestions — public projects in the watched
 * industries it isn't following yet. Only public projects ever appear here.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Eye, Loader2, Plus, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { INDUSTRIES } from "@shared/companies";

interface ProjectSummary {
  id: string; title: string; category: string; goal: string; status: string; logoUrl: string | null;
  description: string; ownerName: string; lastActivityAt: string;
}
interface Followed extends ProjectSummary {
  note: string | null; followedAt: string; milestonesDone: number; milestonesTotal: number | null;
}
interface Scouting {
  watches: string[];
  follows: Followed[];
  suggestions: ProjectSummary[];
}

const GOAL_LABEL: Record<string, string> = {
  ship_mvp: "Shipping a product",
  systemize_business: "Systemizing a business",
  run_company: "Running a company",
};

/** "3 days ago", roughly — the question is "is this alive", not the exact minute. */
function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

function ProjectLine({ p, children }: { p: ProjectSummary; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {p.logoUrl ? <img src={p.logoUrl} alt="" className="h-9 w-9 rounded object-cover shrink-0" /> : <div className="h-9 w-9 rounded bg-muted shrink-0" />}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
          <Badge variant="outline">{p.category}</Badge>
          <span className="text-xs text-muted-foreground capitalize">{GOAL_LABEL[p.goal] ?? p.goal} · {p.status}</span>
        </div>
        {p.description && <p className="text-sm text-muted-foreground line-clamp-2">{p.description}</p>}
        <p className="text-xs text-muted-foreground">By {p.ownerName} · last active {ago(p.lastActivityAt)}</p>
        {children}
      </div>
    </div>
  );
}

export function ScoutingTab({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const { toast } = useToast();
  const key = [`/api/companies/${companyId}/scouting`];
  const { data, isLoading } = useQuery<Scouting>({ queryKey: key });
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => { if (data) setPicked(data.watches); }, [data?.watches.join("|")]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const fail = (title: string) => (e: unknown) => toast({ title, description: errorText(e), variant: "destructive" });

  const saveWatches = useMutation({
    mutationFn: async () => (await apiRequest("PUT", `/api/companies/${companyId}/watches`, { industries: picked })).json(),
    onSuccess: () => { refresh(); setEditing(false); toast({ title: "Watching updated", description: "Everyone in the company hears about new public projects in these industries." }); },
    onError: fail("Couldn't save"),
  });
  const follow = useMutation({
    mutationFn: async (projectId: string) => (await apiRequest("POST", `/api/companies/${companyId}/follows/${projectId}`, {})).json(),
    onSuccess: () => { refresh(); toast({ title: "Following", description: "Your company will hear when it moves." }); },
    onError: fail("Couldn't follow it"),
  });
  const unfollow = useMutation({
    mutationFn: async (projectId: string) => (await apiRequest("DELETE", `/api/companies/${companyId}/follows/${projectId}`)).json(),
    onSuccess: refresh,
    onError: fail("Couldn't stop following"),
  });

  if (isLoading || !data) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  const toggle = (i: string) => setPicked((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));

  return (
    <div className="space-y-6 pt-2">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Industries you watch</h3>
          {canManage && !editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="button-edit-watches">Change</Button>}
        </div>
        <p className="text-sm text-muted-foreground">When someone starts a public project in one of these, everyone in your company gets a notification.</p>
        {editing ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {INDUSTRIES.map((i) => (
                <button key={i} type="button" onClick={() => toggle(i)} data-testid={`toggle-industry-${i}`}>
                  <Badge variant={picked.includes(i) ? "default" : "outline"} className="cursor-pointer">{i}</Badge>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => saveWatches.mutate()} disabled={saveWatches.isPending} data-testid="button-save-watches">
                {saveWatches.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setPicked(data.watches); setEditing(false); }}>Cancel</Button>
            </div>
          </div>
        ) : data.watches.length ? (
          <div className="flex flex-wrap gap-1.5">{data.watches.map((i) => <Badge key={i} variant="secondary">{i}</Badge>)}</div>
        ) : (
          <p className="text-sm text-muted-foreground italic">None yet.{canManage ? " Pick some to get suggestions below." : ""}</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Projects you follow</h3>
        {!data.follows.length ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Follow a project to hear when it finishes a milestone or posts an update.
          </p>
        ) : (
          <div className="space-y-2">
            {data.follows.map((p) => (
              <Card key={p.id} data-testid={`card-follow-${p.id}`}>
                <CardContent className="p-4">
                  <ProjectLine p={p}>
                    <p className="text-xs text-muted-foreground">
                      {p.milestonesTotal ? `${p.milestonesDone} of ${p.milestonesTotal} milestones done` : `${p.milestonesDone} milestones done`}
                      {" · "}followed {ago(p.followedAt)}
                    </p>
                    {p.note && <p className="text-xs border-l-2 pl-2 mt-1">{p.note}</p>}
                  </ProjectLine>
                  {canManage && (
                    <div className="flex justify-end mt-2">
                      <Button size="sm" variant="ghost" onClick={() => unfollow.mutate(p.id)} disabled={unfollow.isPending} data-testid={`button-unfollow-${p.id}`}>
                        <X className="h-3.5 w-3.5 mr-1" />Stop following
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold flex items-center gap-2"><Eye className="h-4 w-4" />Worth a look</h3>
        <p className="text-sm text-muted-foreground">The newest public projects in the industries you watch that you don't follow yet.</p>
        {!data.watches.length ? (
          <p className="text-sm text-muted-foreground italic">Watch an industry to see suggestions here.</p>
        ) : !data.suggestions.length ? (
          <p className="text-sm text-muted-foreground italic">Nothing new in those industries right now.</p>
        ) : (
          <div className="space-y-2">
            {data.suggestions.map((p) => (
              <Card key={p.id} data-testid={`card-suggestion-${p.id}`}>
                <CardContent className="p-4 flex items-start gap-2">
                  <div className="flex-1 min-w-0"><ProjectLine p={p} /></div>
                  {canManage && (
                    <Button size="sm" variant="outline" onClick={() => follow.mutate(p.id)} disabled={follow.isPending} data-testid={`button-follow-${p.id}`}>
                      <Plus className="h-3.5 w-3.5 mr-1" />Follow
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
