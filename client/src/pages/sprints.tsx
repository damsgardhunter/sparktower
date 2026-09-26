/**
 * Simulations: the two games anyone can play here, free.
 *
 * ## Two doors, side by side
 *
 * They are genuinely different things and the page used to hide that by
 * stacking them: one tall card, then another tall card, and on a laptop the
 * second was below the fold — so "the simulations page" was, in practice, the
 * page with one game on it.
 *
 * They are a pair now, two columns from `lg` up and stacked on a phone, with
 * the same shape each: what it is, how long it takes, how many people, one
 * button, and underneath it whatever you have already got going. Put next to
 * each other the choice is legible in about three seconds — half an hour alone
 * with a verdict at the end, or a fortnight with four other people.
 *
 * ## What used to be here
 *
 * The co-founder sprint — a 24-to-72-hour questionnaire two strangers filled
 * in, mostly alone. It is retired. It asked a reasonable set of questions and
 * was a poor thing to do with another person: everyone typed paragraphs into
 * their own boxes, nobody read the other's, and the collaboration was two
 * documents side by side. Ten Years From Now replaces it with the same
 * intent — find out what somebody is like to build with — done as a series of
 * decisions you have to agree on.
 *
 * The old data is still in the database and nothing has been dropped; there is
 * simply no longer a way to start one, and the old URLs redirect here. The
 * address is still `/sprints` because links to it exist.
 */
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, ArrowRight, Clock } from "lucide-react";
import { GameEntry } from "@/components/game/entry";

interface Venture {
  id: string;
  name: string | null;
  phase: string;
  role: string | null;
  roleTitle: string | null;
  niche: { name: string };
  year: number | null;
  totalYears: number | null;
}

/**
 * The market simulation: what it is, and whatever you already have running.
 *
 * A running company shows the year it is on. Without it a list of companies is
 * a list of identical rows, and the one fact that decides whether you open it
 * today — nine years in, or one — was the one fact missing.
 */
function SimulationEntry() {
  const [, navigate] = useLocation();
  const { data } = useQuery<{ ventures: Venture[] }>({ queryKey: ["/api/sim/ventures"] });

  const running = data?.ventures?.filter((v) => v.phase !== "retired") ?? [];

  return (
    <Card className="nova-ring-soft overflow-hidden" data-testid="card-simulation-entry">
      <CardContent className="space-y-4 p-4 sm:p-5">
        {/* Same shape as the game card: copy across the full width, button under it. */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="nova-chip flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
              <Building2 className="h-4 w-4" />
            </span>
            <h3 className="text-lg font-semibold">Market simulation</h3>
            <Badge variant="secondary">a fortnight</Badge>
            <Badge variant="outline" className="gap-1 font-normal">
              <Users className="h-3 w-3" /> five people
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Five of you run one company. A day is a year, against incumbents holding nine tenths of the market.
          </p>
        </div>

        <Button className="w-full sm:w-auto" onClick={() => navigate("/simulation")} data-testid="button-open-simulation">
          {running.length ? "Join another market" : "Join a market"}
        </Button>

        {running.length > 0 && (
          <div className="border-t border-border/60 pt-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {running.length === 1 ? "Your company" : "Your companies"}
            </p>
            <div className="space-y-2">
              {running.map((venture) => (
                <button
                  key={venture.id}
                  onClick={() => navigate(venture.phase === "running" ? `/simulation/${venture.id}` : `/simulation?room=${venture.id}`)}
                  className="w-full rounded-xl border border-border p-3 text-left transition hover:border-primary/50 hover:bg-muted/40"
                  data-testid={`button-resume-${venture.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{venture.name ?? "Your company"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {venture.niche?.name}
                        {venture.roleTitle && ` · you're the ${venture.roleTitle}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {venture.phase === "running" && venture.year != null && venture.totalYears != null ? (
                        <>
                          <p className="text-sm font-semibold tabular-nums" data-testid={`text-venture-year-${venture.id}`}>
                            Year {venture.year}
                          </p>
                          <p className="text-[11px] text-muted-foreground">of {venture.totalYears}</p>
                        </>
                      ) : (
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" /> in the room
                        </p>
                      )}
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  {/* How far through the fortnight, as a bar, so a glance answers it. */}
                  {venture.phase === "running" && venture.year != null && venture.totalYears ? (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.min(100, (venture.year / venture.totalYears) * 100)}%` }}
                      />
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Sprints() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" data-testid="text-sprints-title">
            Simulations
          </h1>
          <p className="mt-1 text-muted-foreground">
            Invent a company in half an hour, or run one for a fortnight. Both free.
          </p>
        </header>

        {/*
          * `items-start` matters: without it the grid stretches both cards to
          * the taller one's height, and the game card — which grows with your
          * history — would leave the market card with a foot of empty space
          * under its button.
          */}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <GameEntry />
          <SimulationEntry />
        </div>
      </div>
    </div>
  );
}
