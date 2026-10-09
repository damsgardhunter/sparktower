/**
 * "Have Nova give me the best outlook" — one press, the year filed.
 *
 * ## What is behind the button
 *
 * Not a language model. `shared/simulation/optimiser.ts` plays the whole
 * company against the forecast a year out, handing one budget out a slice at a
 * time to whichever lever is worth most at the margin. It had been written,
 * benchmarked and never called by anything. So "best outlook" here is meant
 * literally: it is the best plan the engine can find, not a guess at numbers by
 * something that cannot run the engine.
 *
 * ## Why it sits at the top
 *
 * Because of who it is for. Somebody handed a link to a simulation of their own
 * business does not arrive wanting to set eleven levers; they arrive wanting to
 * know whether any of this is worth their afternoon. One press that fills a
 * year and shows what it would do is the answer to that, and it has to be the
 * first thing on the tab or it is not an answer at all.
 *
 * It does not hide the form. The filing is a real filing — editable right up to
 * the tick, like any other — so the normal path after pressing this is to look
 * at what Nova did and change the two things you disagree with.
 */
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEntitlements } from "@/hooks/use-entitlements";
import { NOVA_PLAN_ACTIONS } from "@shared/plans";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { useMoney } from "@/components/sim/desk-currency";

export function NovaPlanCard({ ventureId, year, soloSeason, filed }: {
  ventureId: string;
  year: number;
  /** One chair means all five desks get filled by one press. */
  soloSeason: boolean;
  /** Whether this seat has already filed, which changes the verb and nothing else. */
  filed: boolean;
}) {
  const { toast } = useToast();
  const { creditsRemaining, isUnlimited } = useEntitlements();
  const { compact } = useMoney();
  /** "+£40k" / "−£12k", or nothing when the move is too small to be worth a word. */
  const signed = (n: number | undefined) => n == null || Math.abs(n) < 1 ? null : `${n > 0 ? "+" : ""}${compact(n)}`;

  const plan = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sim/ventures/${ventureId}/nova-plan`, {});
      return res.json();
    },
    onSuccess: (body: any) => {
      /*
       * The desk, the projection and the allowance all moved. Refetching the
       * desk is what puts Nova's numbers in the form — without it the person
       * is told their year is filed while looking at the draft they had
       * before, which reads as the button having done nothing.
       */
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/desk`] });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/projection`] });
      queryClient.invalidateQueries({ queryKey: ["sim-projection", ventureId] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      const chairs = Array.isArray(body?.filled) ? body.filled.length : 1;
      /*
       * What the press actually changed, against the year as it stood a moment
       * before. Without this a chief executive could press it, watch the desk
       * refill, and have no way to tell whether a single number had moved.
       */
      const c = body?.changed;
      const moved = c ? [
        signed(c.profit) && `profit ${signed(c.profit)} this year`,
        signed(c.nextProfit) && `${signed(c.nextProfit)} next year`,
        Math.abs(c.customers ?? 0) >= 1 && `${c.customers > 0 ? "+" : ""}${Math.round(c.customers).toLocaleString()} customers`,
      ].filter(Boolean) : [];
      toast({
        title: chairs > 1 ? `Year ${year} filed, all ${chairs} desks` : `Year ${year} filed`,
        description: `${moved.length
          ? `Nova's plan moves the forecast: ${moved.join(", ")}.`
          : "Nova's plan matches what was already filed — nothing better was found."} See what each desk is doing under the forecast. Change anything you disagree with until the year turns.`,
      });
    },
    onError: (e: any) => toast({
      title: "Nova couldn't plan this year",
      description: errorText(e),
      variant: "destructive",
    }),
  });

  /*
   * Short of the allowance, said before the press rather than after.
   *
   * The server refuses with the shortfall either way, but a button that takes
   * a tap to tell you it cannot work is a worse button than one that says so
   * while you are deciding.
   */
  const short = !isUnlimited && creditsRemaining < NOVA_PLAN_ACTIONS;

  return (
    <Card className="rounded-2xl nova-ring-soft" data-testid="card-nova-plan">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="nova-chip flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                <Wand2 className="h-4 w-4" />
              </span>
              <h2 className="font-semibold">Have Nova give me the best outlook</h2>
              <Badge variant="outline" className="font-normal" data-testid="badge-nova-plan-cost">
                {NOVA_PLAN_ACTIONS} free actions
              </Badge>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {soloSeason
                /*
                 * Two different sentences because they are two different
                 * offers, and the five-seat one must not imply it fills the
                 * table. It plans the whole company and files your chair.
                 */
                ? `Nova plans the whole company for year ${year} and fills all five desks. You can change any of it afterwards.`
                : `Nova plans the whole company for year ${year} and fills your desk with its part. The other four stay your table's.`}
              {!isUnlimited && (
                <> {creditsRemaining} free action{creditsRemaining === 1 ? "" : "s"} left this month.</>
              )}
            </p>
          </div>
          <Button
            className="shrink-0"
            onClick={() => plan.mutate()}
            disabled={plan.isPending || short}
            data-testid="button-nova-plan"
          >
            {plan.isPending
              ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Planning the year</>
              : <><Sparkles className="mr-1.5 h-4 w-4" /> {filed ? "Replan the year" : "Plan the year"}</>}
          </Button>
        </div>
        {short && (
          <p className="mt-3 text-xs text-muted-foreground" data-testid="text-nova-plan-short">
            This costs {NOVA_PLAN_ACTIONS} free actions and you have {creditsRemaining} left. Your allowance resets at
            the start of next month, or you can top up on the pricing page.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
