/**
 * Sprints & simulations.
 *
 * Two things live here now: a half-hour game two people play to invent a
 * startup, and a fortnight-long market simulation five people run a company
 * in.
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
 * simply no longer a way to start one, and the old URLs redirect here.
 */
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Building2 } from "lucide-react";
import { GameEntry } from "@/components/game/entry";

function SimulationEntry() {
  const [, navigate] = useLocation();
  const { data } = useQuery<{ ventures: { id: string; name: string | null; phase: string; role: string | null; niche: { name: string } }[] }>({
    queryKey: ["/api/sim/ventures"],
  });

  const running = data?.ventures?.filter((v) => v.phase !== "retired") ?? [];

  return (
    <section className="mb-8">
      <Card className="border-primary/30" data-testid="card-simulation-entry">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" /> Market simulations
              </h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                Five people run one company between them — marketing, finance, product, operations and the chief
                executive's chair. One real day is one year of trading, over a fortnight, against four companies that
                already hold ninety per cent of the market.
              </p>
            </div>
            {running.length === 0 && (
              <Button onClick={() => navigate("/simulation")} data-testid="button-open-simulation">
                Join a market
              </Button>
            )}
          </div>

          {running.length > 0 && (
            <div className="mt-4 space-y-2">
              {running.map((venture) => (
                <button
                  key={venture.id}
                  onClick={() => navigate(venture.phase === "running" ? `/simulation/${venture.id}` : "/simulation")}
                  className="w-full text-left rounded-lg border border-border hover:border-primary/50 p-3 transition"
                  data-testid={`button-resume-${venture.id}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{venture.name ?? "Your company"}</p>
                      <p className="text-xs text-muted-foreground">
                        {venture.niche?.name}
                        {venture.role && ` · you have the ${venture.role.toUpperCase()} chair`}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {venture.phase === "running" ? "Open your desk" : "Back to the room"}
                    </span>
                  </div>
                </button>
              ))}
              <Button variant="outline" size="sm" onClick={() => navigate("/simulation")} data-testid="button-open-simulation">
                Join another market
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export default function Sprints() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-sprints-title">
            Sprints &amp; simulations
          </h1>
          <p className="mt-1 text-muted-foreground">
            Build something with a stranger in half an hour, or run a company for a fortnight.
          </p>
        </div>

        <GameEntry />
        <SimulationEntry />
      </div>
    </div>
  );
}
