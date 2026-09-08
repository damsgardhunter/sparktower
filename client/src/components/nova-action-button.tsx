import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/use-entitlements";
import { Loader2, Sparkles, Wand2, Check, Lock, ArrowLeft } from "lucide-react";
import { CREDIT_COSTS } from "@shared/plans";
import { NOVA_SURFACES, type NovaSurfaceId } from "@shared/nova-surfaces";

interface Suggestion {
  surface: string;
  summary: string;
  items: { label: string; detail: string }[];
  operations: unknown[];
  creditsCharged: number;
}

/**
 * "Ask Nova" for one surface.
 *
 * Deliberately one component for every tab. The alternative — a bespoke panel
 * per surface — meant the same preview-then-apply flow reimplemented six times,
 * drifting apart as each got tweaked. Here the surface only supplies its
 * presets and its copy; the flow, the gating, the error handling and the cache
 * invalidation are shared.
 */
export function NovaActionButton({
  projectId, surface, entityId, entityLabel, variant = "default", size = "sm", className, label,
}: {
  projectId: string;
  surface: NovaSurfaceId;
  /** Set when opened against a specific milestone, phase or task. */
  entityId?: string;
  entityLabel?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "icon";
  className?: string;
  label?: string;
}) {
  const { toast } = useToast();
  const { can, creditsRemaining, isUnlimited } = useEntitlements();
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  const config = NOVA_SURFACES[surface];
  const isBuilder = can("aiMilestones");
  const notEnoughCredits = !isUnlimited && creditsRemaining < CREDIT_COSTS.novaAssist;

  const describeError = (err: any, fallback: string) => {
    const raw = err?.message || "";
    const jsonStart = raw.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const body = JSON.parse(raw.slice(jsonStart));
        return { message: body.message || fallback, upgrade: body.code === "upgrade_required" };
      } catch { /* keep */ }
    }
    return { message: fallback, upgrade: false };
  };

  const suggestMutation = useMutation({
    mutationFn: async (question: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/nova/suggest`, {
        surface, ask: question, entityId,
      });
      return res.json() as Promise<Suggestion>;
    },
    onSuccess: (result) => {
      setSuggestion(result);
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    },
    onError: (err: any) => {
      const { message, upgrade } = describeError(err, "Nova couldn't help with that.");
      toast({
        title: upgrade ? "Builder plan needed" : "Nova couldn't help",
        description: message,
        variant: upgrade ? "default" : "destructive",
      });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/nova/apply`, {
        operations: suggestion?.operations || [],
      });
      return res.json() as Promise<{ changes: { description: string }[]; skipped: string[] }>;
    },
    onSuccess: (result) => {
      toast({
        title: `Applied — ${result.changes.length} change${result.changes.length === 1 ? "" : "s"}`,
        description: result.skipped.length ? `${result.skipped.length} item(s) skipped.` : undefined,
      });
      // Each surface declares what it touches, plus the project itself.
      for (const key of config.invalidates) {
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, key] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      close();
    },
    onError: (err: any) => toast({
      title: "Couldn't apply that",
      description: describeError(err, "Try again.").message,
      variant: "destructive",
    }),
  });

  const close = () => {
    setOpen(false);
    setSuggestion(null);
    setAsk("");
  };

  const presets = config.presets.filter((p) => !p.needsEntity || entityId);

  return (
    <>
      <Button
        variant={variant} size={size} className={`gap-1.5 ${className || ""}`}
        onClick={() => setOpen(true)}
        title={`Ask Nova about ${config.label.toLowerCase()}`}
        data-testid={`button-nova-${surface}${entityId ? `-${entityId}` : ""}`}
      >
        <Sparkles className={size === "icon" ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {size !== "icon" && (label ?? "Ask Nova")}
      </Button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Nova · {config.label}
            </DialogTitle>
            <DialogDescription>
              {suggestion
                ? "Nothing has been saved yet. Read it over, then apply."
                : config.blurb}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
            {/* The gate lands on the ask, not the door — the capability stays
                visible to the people who'd upgrade for it. */}
            {!isBuilder && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 mb-4">
                <Lock className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                <div className="text-sm">
                  <p className="font-medium">Nova's assistant is on the Builder plan</p>
                  <p className="text-muted-foreground text-xs">Asking will tell you what to upgrade to.</p>
                </div>
              </div>
            )}

            {!suggestion ? (
              <div className="space-y-4">
                {entityLabel && (
                  <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Working on
                    </p>
                    <p className="text-sm font-medium">{entityLabel}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-xs">Common asks</Label>
                  <div className="grid gap-2">
                    {presets.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        className="text-left rounded-md border border-border/60 p-2.5 text-sm hover:border-primary/60 transition-colors disabled:opacity-50"
                        disabled={suggestMutation.isPending}
                        onClick={() => { setAsk(preset.ask); suggestMutation.mutate(preset.ask); }}
                        data-testid={`preset-${surface}-${preset.label.slice(0, 14).replace(/\s+/g, "-").toLowerCase()}`}
                      >
                        <span className="flex items-center gap-2">
                          <Wand2 className="h-3.5 w-3.5 text-primary shrink-0" />
                          {preset.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Or ask for something specific</Label>
                  <Textarea
                    value={ask}
                    onChange={(e) => setAsk(e.target.value)}
                    placeholder={config.placeholder}
                    className="min-h-[90px]"
                    data-testid={`textarea-nova-${surface}`}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {suggestion.summary && (
                  <p className="text-sm text-secondary leading-relaxed" data-testid="text-nova-summary">
                    {suggestion.summary}
                  </p>
                )}

                {suggestion.items.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">What Nova would change</Label>
                      <Badge variant="secondary" className="text-[10px]">{suggestion.items.length}</Badge>
                    </div>
                    {suggestion.items.map((item, i) => (
                      <div
                        key={i}
                        className="rounded-md border border-border/60 p-2.5 space-y-0.5"
                        data-testid={`nova-item-${i}`}
                      >
                        <p className="text-sm font-medium flex items-start gap-2">
                          <span className="h-4 w-4 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          {item.label}
                        </p>
                        {item.detail && (
                          <p className="text-xs text-muted-foreground pl-6">{item.detail}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nova didn't propose any changes for that — read the note above.
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            {suggestion ? (
              <>
                <Button
                  variant="ghost" className="mr-auto gap-2"
                  onClick={() => setSuggestion(null)}
                  data-testid="button-nova-back"
                >
                  <ArrowLeft className="h-4 w-4" /> Ask something else
                </Button>
                <Button variant="outline" onClick={close}>Discard</Button>
                <Button
                  className="gap-2"
                  disabled={applyMutation.isPending || suggestion.operations.length === 0}
                  onClick={() => applyMutation.mutate()}
                  data-testid="button-nova-apply"
                >
                  {applyMutation.isPending
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Applying…</>
                    : <><Check className="h-4 w-4" /> Apply</>}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={close}>Cancel</Button>
                <Button
                  className="gap-2"
                  disabled={!ask.trim() || suggestMutation.isPending || notEnoughCredits}
                  onClick={() => suggestMutation.mutate(ask)}
                  data-testid="button-nova-ask"
                >
                  {suggestMutation.isPending
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Nova is thinking…</>
                    : <><Sparkles className="h-4 w-4" /> Ask Nova ({CREDIT_COSTS.novaAssist})</>}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
