/**
 * "No logo yet? Nova can draw a placeholder" — under the two upload fields in
 * the project's Setup tab.
 *
 * Read shared/brand-kit.ts for why there are four styles and why the cover is
 * drawn from the logo. Three things about this screen in particular:
 *
 * **It sits under the uploads, not instead of them.** Somebody who has a logo
 * should upload their logo. This is for the project page that has been sitting
 * there with two grey squares on it for a fortnight, and the order on the page
 * says so.
 *
 * **It says placeholder every time it says logo.** A dollar buys a stand-in
 * until there is a designer, and the copy has to carry that or the product is
 * selling a brand for a dollar.
 *
 * **Replacing is offered as undo, not as a warning.** The old logo and cover
 * are object-storage paths that still resolve after they have been replaced, so
 * the server hands them back and this keeps them long enough to put them back
 * in one press. That is a better answer than a confirmation dialog: it costs
 * nothing to say yes and nothing to change your mind.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import { Loader2, Sparkles, Undo2, Wand2 } from "lucide-react";
import type { Project } from "@shared/schema";
import { formatMoney, OUTCOME_PRICE_CENTS } from "@shared/plans";
import { LOGO_STYLES, type LogoStyleId } from "@shared/brand-kit";
import { cn } from "@/lib/utils";

interface Drawn {
  style: LogoStyleId;
  logoUrl: string | null;
  coverUrl: string | null;
  replaced: { logoUrl: string | null; coverUrl: string | null };
  coverFailed: boolean;
  paidCents: number;
  covered: boolean;
}

export function BrandKitCard({ project }: { project: Project }) {
  const { toast } = useToast();
  const [style, setStyle] = useState<LogoStyleId>("name");
  /** What was there before the last draw, kept only until the page is left. */
  const [undoTo, setUndoTo] = useState<Drawn["replaced"] | null>(null);

  /*
   * Whether this project's outcomes are already paid for. Read from the wallet
   * rather than passed in, because the price on the button is the one thing
   * here that must not be wrong: quoting a dollar to somebody who bought the
   * whole business for $14.99 — which explicitly includes this — reads as being
   * charged twice, and they would be right to think so.
   */
  const { data: wallet } = useQuery<{ buildPasses?: string[] }>({ queryKey: ["/api/nova/wallet"] });
  const covered = !!wallet?.buildPasses?.includes(project.id);
  const price = formatMoney(OUTCOME_PRICE_CENTS.brand);

  const hasBrief = !!(project.oneLiner?.trim() || project.description?.trim() || project.problemStatement?.trim());

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/projects", project.id] });
    queryClient.invalidateQueries({ queryKey: ["/api/nova/wallet"] });
  };

  const draw = useMutation({
    mutationFn: async (): Promise<Drawn> =>
      (await apiRequest("POST", `/api/projects/${project.id}/brand-kit`, { style })).json(),
    onSuccess: (result) => {
      refresh();
      setUndoTo(result.replaced.logoUrl || result.replaced.coverUrl ? result.replaced : null);
      toast({
        title: result.coverFailed ? "Logo drawn — the cover didn't come out" : "Logo and cover drawn",
        description: result.coverFailed
          ? "The logo is on your project. Try the cover again, or pick a different look."
          : result.paidCents === 0
            ? "Included in your build — nothing was charged."
            : `${formatMoney(result.paidCents)} from your balance. Replace them whenever you have the real thing.`,
      });
    },
    onError: (err) => toast({
      title: "Couldn't draw it",
      description: errorText(err, "Try again in a moment."),
      variant: "destructive",
    }),
  });

  const putBack = useMutation({
    mutationFn: async () =>
      (await apiRequest("PATCH", `/api/projects/${project.id}`, {
        logoUrl: undoTo?.logoUrl ?? null,
        coverUrl: undoTo?.coverUrl ?? null,
      })).json(),
    onSuccess: () => { refresh(); setUndoTo(null); toast({ title: "Put your own images back" }); },
    onError: (err) => toast({
      title: "Couldn't put them back",
      description: errorText(err, "Your old images are still stored — try again."),
      variant: "destructive",
    }),
  });

  const busy = draw.isPending || putBack.isPending;

  return (
    <div
      className="sm:col-span-2 space-y-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4"
      data-testid="brand-kit"
    >
      <div className="space-y-0.5">
        <p className="text-sm font-medium flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          {project.logoUrl ? "Draw a different placeholder logo" : "No logo yet? Nova can draw a placeholder"}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Nova draws a logo from your brief in the look you pick, then a cover image built around that
          logo so the two match. A stand-in until you have a designer — {covered
            ? "included in your build"
            : `${price}, once`}.
        </p>
      </div>

      {/*
        * Four looks, as a grid rather than a dropdown. The difference between
        * them is the only choice being made here, and a dropdown hides three of
        * the four behind a press — which, for somebody who does not know what
        * "symmetric" means until they read the line under it, is the wrong way
        * round.
        */}
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What the logo should look like">
        {LOGO_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={style === s.id}
            disabled={busy}
            onClick={() => setStyle(s.id)}
            className={cn(
              "text-left rounded-md border p-2.5 transition disabled:opacity-60",
              style === s.id
                ? "border-primary bg-background ring-1 ring-primary"
                : "border-border/70 bg-background/60 hover:border-primary/50",
            )}
            data-testid={`button-logo-style-${s.id}`}
          >
            <span className="block text-xs font-medium">{s.label}</span>
            <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5">{s.blurb}</span>
          </button>
        ))}
      </div>

      {!hasBrief && (
        <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-brand-kit-needs-brief">
          Write a one-liner or a description in your brief first — the logo is drawn from what the business does.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="gap-2"
          disabled={!hasBrief || busy}
          onClick={() => draw.mutate()}
          data-testid="button-draw-brand-kit"
        >
          {draw.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {draw.isPending
            ? "Drawing…"
            : covered
              ? "Draw my logo & cover"
              : `Draw my logo & cover · ${price}`}
        </Button>

        {undoTo && !draw.isPending && (
          <Button
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
            disabled={busy}
            onClick={() => putBack.mutate()}
            data-testid="button-undo-brand-kit"
          >
            <Undo2 className="h-3.5 w-3.5" /> Put back the ones I had
          </Button>
        )}
      </div>
    </div>
  );
}
