import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, RefreshCw, Check, Zap, Users2, Lightbulb } from "lucide-react";
import { CREDIT_COSTS } from "@shared/plans";

export interface SprintIdea {
  name: string;
  tagline: string;
  pitch: string;
  twist: string;
  whoItsFor: string;
  vibe: string;
}

interface SprintIdeaPickerProps {
  productStyle: string;
  /** Included so ideas can lean on both builders' interests. */
  partnerId?: string;
  onChoose: (idea: SprintIdea) => void;
  /** Disables the cards while the parent is saving the choice. */
  isSubmitting?: boolean;
  chosenName?: string | null;
}

/**
 * Three fun sprint ideas to pick from.
 *
 * Each card is laid out as a short hierarchy — name, hook, two-sentence pitch,
 * then twist and audience as labelled rows — because the previous single
 * auto-generated paragraph was a dense wall of tech jargon nobody could parse.
 */
export function SprintIdeaPicker({
  productStyle, partnerId, onChoose, isSubmitting, chosenName,
}: SprintIdeaPickerProps) {
  const { toast } = useToast();
  const [ideas, setIdeas] = useState<SprintIdea[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sprints/idea-options", { productStyle, partnerId });
      return res.json();
    },
    onSuccess: (data: { ideas: SprintIdea[] }) => {
      setIdeas(data.ideas || []);
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const start = raw.indexOf("{");
      let description = "Nova couldn't come up with ideas right now.";
      if (start >= 0) {
        try { description = JSON.parse(raw.slice(start)).message || description; } catch { /* keep */ }
      }
      toast({ title: "No ideas yet", description, variant: "destructive" });
    },
  });

  if (ideas.length === 0) {
    return (
      <Card className="border-dashed" data-testid="card-idea-picker-empty">
        <CardContent className="p-6 flex flex-col items-center text-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Lightbulb className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-1">
            <p className="font-medium">Need something to build?</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Nova will pitch you three ideas for this style. Pick whichever one sounds most fun —
              you can reshuffle if none land.
            </p>
          </div>
          <Button
            className="gap-2 mt-1"
            disabled={generateMutation.isPending}
            onClick={() => generateMutation.mutate()}
            data-testid="button-generate-ideas"
          >
            {generateMutation.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Nova is thinking…</>
              : <><Sparkles className="h-4 w-4" /> Show me 3 ideas</>}
          </Button>
          <p className="text-xs text-muted-foreground">
            {CREDIT_COSTS.sprintIdeaSuggestion} credit for all three
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-testid="idea-picker">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Pick the one you'd actually enjoy building</p>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs shrink-0"
          disabled={generateMutation.isPending || isSubmitting}
          onClick={() => generateMutation.mutate()}
          data-testid="button-reshuffle-ideas"
        >
          {generateMutation.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5" />}
          Reshuffle ({CREDIT_COSTS.sprintIdeaSuggestion})
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
        {ideas.map((idea) => {
          const isSelected = selected === idea.name;
          const isChosen = chosenName === idea.name;
          return (
            <Card
              key={idea.name}
              className={`cursor-pointer transition-all h-full ${
                isSelected || isChosen ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/40"
              }`}
              onClick={() => !isSubmitting && setSelected(idea.name)}
              data-testid={`card-idea-${idea.name}`}
            >
              <CardContent className="p-4 space-y-3">
                {/* Name + hook: the only two things you need to decide. */}
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-base leading-tight" data-testid={`text-idea-name-${idea.name}`}>
                      {idea.name}
                    </h3>
                    {(isSelected || isChosen) && (
                      <div className="bg-primary text-primary-foreground rounded-full p-0.5 shrink-0">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                  </div>
                  {idea.vibe && (
                    <Badge variant="secondary" className="text-[10px] font-normal capitalize">{idea.vibe}</Badge>
                  )}
                  {idea.tagline && (
                    <p className="text-sm text-primary font-medium leading-snug">{idea.tagline}</p>
                  )}
                </div>

                <p className="text-sm text-secondary leading-relaxed">{idea.pitch}</p>

                {/* Labelled rows rather than one run-on paragraph. */}
                <div className="space-y-2 pt-1 border-t border-border/50">
                  {idea.twist && (
                    <div className="flex items-start gap-2">
                      <Zap className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">The twist</p>
                        <p className="text-xs leading-relaxed">{idea.twist}</p>
                      </div>
                    </div>
                  )}
                  {idea.whoItsFor && (
                    <div className="flex items-start gap-2">
                      <Users2 className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Who it's for</p>
                        <p className="text-xs leading-relaxed">{idea.whoItsFor}</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Button
        className="w-full gap-2"
        disabled={!selected || isSubmitting || generateMutation.isPending}
        onClick={() => {
          const idea = ideas.find((i) => i.name === selected);
          if (idea) onChoose(idea);
        }}
        data-testid="button-confirm-idea"
      >
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {selected ? `Build "${selected}"` : "Pick an idea above"}
      </Button>
    </div>
  );
}
