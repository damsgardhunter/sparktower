/**
 * One of the four people you are doing this with, opened by tapping their name.
 *
 * The desk used to say "Omar · Chief Marketing Officer · still deciding" and
 * that was the whole relationship. You could see that somebody had not filed
 * and you could do nothing about it but wait, which for a game played over a
 * fortnight by five people who mostly are not in the same room is the wrong
 * way round: the most common thing anybody wants to do is chase a teammate,
 * and it was the one thing there was no button for.
 *
 * ## What is on it
 *
 * **What they have committed**, which the whole table can already see on the
 * desk as a total and could not see broken down. Five people privately making
 * reasonable decisions that are collectively ruinous is the failure this game
 * is built around; the defence is being able to look at what somebody has
 * actually filed while there is still time to argue about it.
 *
 * **Whether they turn up**, counted rather than felt. A teammate who missed
 * one year and a teammate who has never opened the app are different problems
 * — one wants a nudge, the other wants the chief executive to dissolve the
 * seat and get the salary back — and nobody can tell them apart by memory.
 *
 * **A nudge**, once per person per year. Not a message box: what people want
 * here is a tap, and anything they have to compose is a thing they close.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { Loader2, CheckCircle2, Circle, Bell, Target, CalendarCheck } from "lucide-react";

export interface TeammateProfileData {
  userId: string;
  name: string;
  headline: string | null;
  avatarUrl: string | null;
  isBot: boolean;
  isYou: boolean;
  role: string | null;
  title: string | null;
  levers: string[];
  dissolved: boolean;
  year: number;
  filed: boolean;
  decision: Record<string, unknown> | null;
  filedAt: string | null;
  turnout: { filed: number; of: number; missedRunning: number };
  challenges: { year: number; title: string | null; brief: string | null; met: boolean | null }[];
  niche: { id: string; name: string; voice: Record<string, string> };
}

/**
 * A filed decision, in words.
 *
 * The payload is the engine's shape — `brandSpend`, `unitCost`, `positioning`
 * — and showing it raw would be showing somebody a database row about their
 * colleague. The names are spelled out and the money is formatted, and
 * anything the engine added that this does not know about is still shown
 * rather than dropped, because a lever quietly missing from a teammate's
 * summary is worse than one labelled awkwardly.
 */
const LABELS: Record<string, string> = {
  price: "Price",
  brandSpend: "Brand marketing",
  performanceSpend: "Performance marketing",
  sponsorship: "Sponsorship",
  cities: "Where it sells",
  borrow: "Borrowing",
  repay: "Repaying",
  raise: "Raising",
  cashBuffer: "Cash held back",
  reporting: "What is reported",
  productSpend: "Product",
  research: "Research",
  techDebtPaydown: "Paying down technical debt",
  capacitySpend: "Capacity",
  serviceSpend: "Support",
  unitCost: "Cost per unit",
  headcount: "Headcount",
  supply: "Supply agreement",
  focus: "Where the effort goes",
  positioning: "Who the company is for",
  rehire: "Rehiring",
};

const pretty = (key: string) =>
  LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

function value(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "nowhere new";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    if (key === "price" || key === "unitCost") return `£${v.toLocaleString()}`;
    if (v >= 1000) return `£${v.toLocaleString()}`;
    return String(v);
  }
  return String(v);
}

export function TeammateProfile({ ventureId, userId, onClose }: {
  ventureId: string;
  userId: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  /*
   * Said in the dialog, not only in a toast.
   *
   * The confirmation used to live in a toast alone, and a toast is its own
   * dismissable layer sitting on top of the dialog — so the natural next
   * move, pressing Escape to close the dialog, closed the toast instead and
   * left the dialog standing, apparently ignoring the key. Showing the result
   * where the button was means the dialog is complete on its own, and the
   * toast is only a courtesy.
   */
  const [nudgedFor, setNudgedFor] = useState<string | null>(null);
  const { data, isLoading } = useQuery<TeammateProfileData>({
    queryKey: [`/api/sim/ventures/${ventureId}/seats/${userId}`],
    enabled: !!userId,
  });

  const nudge = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/sim/ventures/${ventureId}/nudge`, { userId }),
    onSuccess: () => {
      setNudgedFor(userId);
      toast({ title: "Told them", description: "They will see it next time they open the app." });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/seats/${userId}`] });
    },
    onError: (err: any) => {
      /*
       * The refusals here are all informative — already filed, a stand-in, no
       * seat — so the message is the point rather than a generic failure.
       * Which means it has to be the server's sentence: `err.message` on an
       * ApiError is `409: {"message":…,"code":…}`, so reading it directly put
       * a line of JSON in front of the person. `errorText` unwraps the body.
       */
      toast({ title: "No need", description: errorText(err, "Couldn't send that."), variant: "destructive" });
    },
  });

  const entries = data?.decision ? Object.entries(data.decision).filter(([k]) => k !== "companyId") : [];

  return (
    <Dialog open={!!userId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto" data-testid="dialog-teammate-profile">
        {isLoading || !data ? (
          <div className="py-16 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <DialogHeader className="space-y-1 text-left">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-xl" data-testid="text-teammate-name">
                  {data.isYou ? "You" : data.name}
                </DialogTitle>
                {data.isBot && <Badge variant="outline" className="text-[10px]">a stand-in</Badge>}
                {data.dissolved && <Badge variant="secondary" className="text-[10px]">seat dissolved</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{data.title ?? "no seat yet"}</p>
              {data.headline && <p className="text-xs text-muted-foreground">{data.headline}</p>}
            </DialogHeader>

            {/* Have they filed. The reason anybody opens this. */}
            <div className="flex items-center gap-2.5 rounded-lg border border-border p-3" data-testid="text-teammate-filed">
              {data.filed
                ? <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                : <Circle className="h-5 w-5 text-muted-foreground shrink-0" />}
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {data.filed ? `Filed for year ${data.year}` : `Has not filed for year ${data.year}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {data.filed
                    ? "Changeable right up to the tick, like everyone's."
                    : data.isBot
                      ? "A stand-in files every year without being asked."
                      : "Their part of the year runs on last year's plan at a caretaker's pace until they do."}
                </p>
              </div>
            </div>

            {/* What they committed. */}
            {entries.length > 0 && (
              <section className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">What they committed</p>
                {entries.map(([key, v]) => (
                  <div key={key} className="flex items-baseline justify-between gap-3 text-sm" data-testid={`row-decision-${key}`}>
                    <span className="text-muted-foreground">{pretty(key)}</span>
                    <span className="tabular-nums text-right">{value(key, v)}</span>
                  </div>
                ))}
              </section>
            )}

            {/* What the seat is for, when they have not filed and you are wondering what it even does. */}
            {!data.filed && data.levers.length > 0 && (
              <section className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground">What this seat decides</p>
                {data.levers.map((lever) => (
                  <p key={lever} className="text-sm text-muted-foreground">· {lever}</p>
                ))}
              </section>
            )}

            {/* Whether they turn up, which is the thing a chief executive acts on. */}
            <section className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-semibold flex items-center gap-1.5 mb-1">
                <CalendarCheck className="h-3.5 w-3.5" /> Turning up
              </p>
              <p className="text-sm" data-testid="text-teammate-turnout">
                Filed in {data.turnout.filed} of {data.turnout.of} year{data.turnout.of === 1 ? "" : "s"}.
              </p>
              {data.turnout.missedRunning >= 2 && !data.isBot && (
                <p className="text-xs text-destructive mt-1">
                  {data.turnout.missedRunning} years running without a decision. The chief executive can dissolve the
                  seat and take the salary back — it is not a punishment, it is what stops a missing person costing
                  the other four a wage.
                </p>
              )}
            </section>

            {/* Their own thing to win. */}
            {data.challenges.length > 0 && (
              <section className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5" /> Their own objective
                </p>
                {data.challenges.map((c) => (
                  <div key={c.year} className="flex items-baseline gap-2 text-sm">
                    <span className="text-muted-foreground shrink-0 text-xs">Year {c.year}</span>
                    <span className="truncate">{c.title ?? "—"}</span>
                    {c.met === true && <Badge variant="default" className="text-[10px] ml-auto shrink-0">done</Badge>}
                    {c.met === false && <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">missed</Badge>}
                  </div>
                ))}
              </section>
            )}

            {/* The tap. */}
            {!data.isYou && !data.isBot && !data.filed && nudgedFor === data.userId && (
              <p className="text-sm text-center text-muted-foreground flex items-center justify-center gap-1.5" data-testid="text-nudged">
                <Bell className="h-4 w-4" /> Reminded. They will see it next time they open the app.
              </p>
            )}
            {!data.isYou && !data.isBot && !data.filed && nudgedFor !== data.userId && (
              <Button
                className="w-full"
                onClick={() => nudge.mutate()}
                disabled={nudge.isPending}
                data-testid="button-nudge"
              >
                {nudge.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <><Bell className="h-4 w-4 mr-2" /> Remind them to make a move</>}
              </Button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
