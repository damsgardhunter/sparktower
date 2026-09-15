import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import { Loader2, ToggleLeft, Users, AlertTriangle } from "lucide-react";
import {
  SURFACE_CLASS_LABEL, SURFACE_SEQUENCE_LABEL, WEDGE_PROOF, type SurfaceClass, type SurfaceDef, type SurfaceSequence,
} from "@shared/surfaces";

type Row = SurfaceDef & { enabled: boolean };

const ORDER: SurfaceClass[] = ["core", "momentum", "later", "network", "off"];

/**
 * Turning feature areas on and off, without a deploy.
 *
 * The reason this is a page rather than an environment variable: the point of
 * a kill switch is that it can be pulled in the moment something is going
 * wrong, or flipped the afternoon a surface finally has enough people to work.
 * A switch that needs a release is a plan, not a switch.
 */
export default function AdminSurfaces() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isReviewer = user
    && ((user as any).platformRole === "reviewer" || (user as any).platformRole === "admin");

  const { data, isLoading } = useQuery<{ surfaces: Row[] }>({
    queryKey: ["/api/admin/surfaces"],
    enabled: !!isReviewer,
  });

  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/surfaces/${id}`, { enabled });
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({ title: `${r.label} ${r.enabled ? "on" : "off"}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/surfaces"] });
      queryClient.invalidateQueries({ queryKey: ["/api/surfaces"] });
      // A switch is an action the safety review measures, and changes what it lists as off.
      queryClient.invalidateQueries({ queryKey: ["/api/admin/safety/review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/safety/status"] });
    },
    onError: () => toast({ title: "Couldn't change that", variant: "destructive" }),
  });

  if (authLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!isReviewer) return <NotFound />;

  const rows = data?.surfaces ?? [];
  const onCount = rows.filter((r) => r.enabled).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6" data-testid="admin-surfaces">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ToggleLeft className="h-5 w-5 text-primary" /> Feature areas
        </h1>
        <p className="text-sm text-muted-foreground">
          What's reachable in the product. Switching one off hides its nav, blocks its routes and
          refuses its API — nothing is deleted, so anything here comes back with one click.
        </p>
        {rows.length > 0 && (
          <p className="text-xs text-muted-foreground">{onCount} of {rows.length} on.</p>
        )}
      </header>

      {/* The sequencing decision, where the switches are: what the work is for, and what waits. */}
      <Card className="border-primary/40" data-testid="surface-sequencing">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sequencing: the path loops first</CardTitle>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The three path loops — Ship, Systemize, Raise — are the wedge. New work goes to them and to what they need.
            Everything marked <span className="font-medium">after the wedge</span> stays built, tested and switchable, but sits in the secondary nav and gets no new work until this is true:
          </p>
          <p className="text-xs font-medium leading-relaxed" data-testid="wedge-proof">{WEDGE_PROOF}</p>
          <p className="text-[11px] text-muted-foreground">The decision and how to revisit it: docs/decisions/0001-path-loops-first.md</p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5 text-[11px]">
          {(["wedge", "supports", "after-wedge"] as SurfaceSequence[]).map((seq) => (
            <span key={seq} className="rounded-full border border-border px-2 py-0.5">
              {SURFACE_SEQUENCE_LABEL[seq]}: {rows.filter((r) => r.sequence === seq).length}
            </span>
          ))}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        ORDER.map((cls) => {
          const group = rows.filter((r) => r.cls === cls);
          if (group.length === 0) return null;
          return (
            <Card key={cls}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{SURFACE_CLASS_LABEL[cls]}</CardTitle>
                {cls === "network" && (
                  <p className="text-xs text-muted-foreground">
                    These need other people to do anything. The number beside each one is roughly how
                    many active accounts it takes before it stops feeling empty.
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {group.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-start justify-between gap-3 rounded-md border border-border/60 p-2.5"
                    data-testid={`surface-${s.id}`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{s.label}</span>
                        {s.needsPeople != null && (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Users className="h-2.5 w-2.5" /> {s.needsPeople}+
                          </Badge>
                        )}
                        {s.enabled !== s.defaultEnabled && (
                          <Badge variant="secondary" className="text-[10px]">changed</Badge>
                        )}
                        <Badge variant={s.sequence === "after-wedge" ? "outline" : "secondary"} className="text-[10px]" data-testid={`sequence-${s.id}`}>
                          {s.sequence === "wedge" ? "Wedge" : s.sequence === "supports" ? "Supports the wedge" : "After the wedge"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{s.note}</p>
                      {s.unlocksWhen && <p className="text-[11px] text-muted-foreground"><span className="font-medium">Unlocks when:</span> {s.unlocksWhen}</p>}
                    </div>
                    <Switch
                      checked={s.enabled}
                      disabled={toggle.isPending}
                      onCheckedChange={(v) => toggle.mutate({ id: s.id, enabled: v })}
                      data-testid={`toggle-${s.id}`}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })
      )}

      <p className="text-xs text-muted-foreground flex items-start gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
        Turning a surface off returns 404 rather than 403, so a disabled area is indistinguishable
        from one that was never built. Anyone already on that page sees it disappear on their next
        request.
      </p>
    </div>
  );
}
