import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, HandCoins, Layers, Loader2, Rocket, Sparkles, Store, User, Users, type LucideIcon } from "lucide-react";
import { FeaturedContestCard } from "@/components/featured-contest-card";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

interface Community {
  id: string; slug: string; name: string; tagline: string; description: string;
  icon: string; color: string; members: number; joined: boolean;
}

const ICONS: Record<string, LucideIcon> = { user: User, sparkles: Sparkles, layers: Layers, rocket: Rocket, "hand-coins": HandCoins, store: Store };

/**
 * Contests and Communities: the main contest — the $50 Billion Challenge,
 * announced and not yet open — and below it, communities people can join
 * around what they're building.
 */
export default function Contests() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: communities, isLoading } = useQuery<Community[]>({ queryKey: ["/api/communities"] });

  const toggle = useMutation({
    mutationFn: async (c: Community) => (await apiRequest(c.joined ? "DELETE" : "POST", `/api/communities/${c.slug}/join`)).json() as Promise<Community>,
    onSuccess: (updated) => {
      queryClient.setQueryData<Community[]>(["/api/communities"], (list) => list?.map((c) => (c.id === updated.id ? updated : c)));
      toast({ title: updated.joined ? `Joined ${updated.name}` : `Left ${updated.name}` });
    },
    onError: () => toast({ title: "Couldn't update that community", variant: "destructive" }),
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <header className="pb-4 border-b border-border">
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-contests-title">Contests and Communities</h1>
          <p className="text-sm text-muted-foreground mt-1">Build challenges with prizes and badges, and find people building what you're building.</p>
        </header>

        <section className="pt-6" aria-labelledby="contests-heading">
          <h2 id="contests-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contests</h2>
          <div className="pt-4 pb-10">
            <FeaturedContestCard />
          </div>
        </section>

        <section className="pt-6 border-t border-border" aria-labelledby="communities-heading" data-testid="section-communities">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="communities-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Communities</h2>
            {communities && <span className="text-xs text-muted-foreground">{communities.filter((c) => c.joined).length} joined</span>}
          </div>

          {isLoading ? (
            <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !communities?.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No communities yet.</p>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {communities.map((c) => {
                const Icon = ICONS[c.icon] ?? Users;
                const busy = toggle.isPending && toggle.variables?.id === c.id;
                return (
                  <li key={c.id} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3" data-testid={`community-${c.slug}`}>
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 shrink-0 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${c.color}1A`, color: c.color }}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold leading-tight">{c.name}</h3>
                        <p className="text-sm text-muted-foreground leading-snug">{c.tagline}</p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />{c.members.toLocaleString()} {c.members === 1 ? "member" : "members"}
                      </span>
                      {user && (
                        <Button size="sm" variant={c.joined ? "outline" : "default"} disabled={busy} onClick={() => toggle.mutate(c)} data-testid={`button-join-${c.slug}`}>
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : c.joined ? <><Check className="h-4 w-4 mr-1" />Joined</> : "Join"}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
