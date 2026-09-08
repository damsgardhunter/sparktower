import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, AlertTriangle, ImageIcon } from "lucide-react";
import { BADGE_LEVELS } from "@shared/backing";

const money = (cents: number) => `$${cents / 100}`;

/**
 * What a backer's badge will look like, before anyone has backed.
 *
 * Built through the same server function that produces a real badge, so this
 * can't drift from what actually gets handed out — the creator is choosing a
 * logo partly on the strength of this picture.
 *
 * One level at a time, on request. Four model calls to fill this card is a
 * real cost, and most creators only need to see one to know whether their
 * logo works.
 */
export function BadgePreviewCard({
  projectId, previews, projectLogoUrl,
}: {
  projectId: string;
  previews: Record<string, string>;
  projectLogoUrl: string | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const generate = useMutation({
    mutationFn: async (level: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/backing/badge-preview`, { level });
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({
        title: `${r.level} badge ready`,
        description: r.usedLogo ? undefined : "Made without a logo — upload one for a badge that looks like you.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "backing"] });
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const start = raw.indexOf("{");
      let description = "Try again in a moment.";
      if (start >= 0) {
        try { description = JSON.parse(raw.slice(start)).message || description; } catch { /* keep */ }
      }
      toast({ title: "Couldn't make that preview", description, variant: "destructive" });
    },
  });

  const pending = generate.isPending ? (generate.variables as string) : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Backer badges
        </CardTitle>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Everyone who backs you earns a badge built from your logo, and pins it to their profile.
          The metal is set by how much they gave. This is the reward that costs you nothing and
          gets carried around the longest.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/*
          * Shows the logo rather than claiming one exists. An earlier version
          * only printed a warning, so a creator who had uploaded a logo was
          * told they hadn't — with nothing on screen to contradict it.
          */}
        {projectLogoUrl ? (
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 p-2">
            <img
              src={projectLogoUrl} alt=""
              className="h-8 w-8 rounded object-contain bg-background shrink-0"
              data-testid="badge-source-logo"
            />
            <p className="text-xs text-muted-foreground">
              Badges are built from this logo.
            </p>
          </div>
        ) : (
          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            No logo yet. Badges will use a generic emblem until you add one at the top of Setup.
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {BADGE_LEVELS.map((level) => {
            const img = previews[level.key];
            return (
              <div key={level.key} className="space-y-1.5" data-testid={`badge-preview-${level.key}`}>
                <div
                  className="aspect-square rounded-full border-2 overflow-hidden bg-muted/30 flex items-center justify-center relative"
                  style={{ borderColor: level.hex }}
                >
                  {img
                    ? <img src={img} alt={`${level.label} badge`} className="w-full h-full object-contain" />
                    : <ImageIcon className="h-6 w-6 text-muted-foreground/40" />}
                  {pending === level.key && (
                    <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <p className="text-xs font-medium" style={{ color: level.hex }}>{level.label}</p>
                  <p className="text-[10px] text-muted-foreground">{money(level.minCents)}+</p>
                </div>
                <Button
                  variant="outline" size="sm" className="w-full h-7 text-[11px]"
                  disabled={generate.isPending}
                  onClick={() => generate.mutate(level.key)}
                  data-testid={`button-preview-${level.key}`}
                >
                  {pending === level.key ? "Drawing…" : img ? "Redo" : "Preview"}
                </Button>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Each one takes about a minute to draw. Previews are yours only — a backer's badge is
          generated fresh when they pledge. Change your logo and these go stale, so redo one to check.
        </p>
      </CardContent>
    </Card>
  );
}
