/**
 * Starting a section asks one thing — what kind of project it is for that
 * path — then starts it. Members can start one as well as the owner.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { subcategoriesFor, type ProjectGoal } from "@shared/goals";
import { sectionDef } from "@/lib/sections";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Loader2 } from "lucide-react";
import { NOVA_GRADIENT } from "./tabs";

export function StartSectionDialog({ projectId, goal, open, onOpenChange, onStarted }: {
  projectId: string;
  goal: ProjectGoal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted?: (goal: ProjectGoal) => void;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<string | null>(null);
  useEffect(() => { if (open) setKind(null); }, [open, goal]);

  const start = useMutation({
    mutationFn: async (vars: { goal: ProjectGoal; subcategory: string }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/tracks`, vars);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "tracks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "path"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "milestones"] });
      toast({ title: `${sectionDef(vars.goal).label} started` });
      onStarted?.(vars.goal);
      onOpenChange(false);
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      let description = "Try again in a moment.";
      const i = raw.indexOf("{");
      if (i >= 0) { try { description = JSON.parse(raw.slice(i)).message || description; } catch { /* keep */ } }
      toast({ title: "Couldn't start that section", description, variant: "destructive" });
    },
  });

  if (!goal) return null;
  const def = sectionDef(goal);
  const Icon = def.icon;
  const kinds = subcategoriesFor(goal);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="start-section-dialog">
        <DialogHeader>
          <div className={`h-11 w-11 rounded-xl ${NOVA_GRADIENT} text-white flex items-center justify-center mb-1`}>
            <Icon className="h-5 w-5" />
          </div>
          <DialogTitle>Start {def.label}</DialogTitle>
          <DialogDescription>{def.blurb}</DialogDescription>
        </DialogHeader>
        <div className="border-t border-border pt-4 space-y-2">
          <p className="text-sm font-medium">What kind of project?</p>
          <div className="grid grid-cols-2 gap-2">
            {kinds.map((k) => {
              const on = kind === k.id;
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKind(k.id)}
                  aria-pressed={on}
                  className={`relative rounded-lg border-2 px-3 py-3 text-left text-sm font-medium transition-colors ${
                    on ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10" : "border-border hover:border-emerald-300"
                  }`}
                  data-testid={`start-kind-${k.id}`}
                >
                  {k.label}
                  {on && <Check className="absolute top-2 right-2 h-4 w-4 text-emerald-600" />}
                </button>
              );
            })}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Not now</Button>
          <Button
            disabled={!kind || start.isPending}
            onClick={() => kind && start.mutate({ goal, subcategory: kind })}
            className="gap-2"
            data-testid="button-start-section"
          >
            {start.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
