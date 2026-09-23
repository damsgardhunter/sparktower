/**
 * The manager's Simulations tab: two very different simulations of the same
 * company, and the difference between them is the point.
 *
 * **Your business** is the one an owner opens first. It runs *their* company —
 * their revenue, their cost base, their loan — month by month, and answers
 * "what happens if I hire twelve people right now?" with a cash curve rather
 * than an opinion. Alongside it, "ten years from now": the company valued a
 * decade out, on the strength of where the next million would go.
 *
 * **A market season** is the other one, and it was here first. Five people
 * take the five seats of one company in an invented market and run it for a
 * fortnight, a day to a year. Nothing in it is anybody's real numbers, which
 * is exactly what makes it safe to lose — it is how a team learns that
 * marketing a product you cannot deliver buys churn, without finding out on
 * their own customers.
 *
 * They sit behind two tabs rather than on one page because they answer to
 * different people. The first belongs to whoever owns the business; the second
 * belongs to a company with staff to train, and most projects here belong to
 * nobody but their builder. So the season side answers honestly in three
 * states rather than appearing broken in two of them:
 *
 *   - A company's project, and you may run seasons: the company's own season
 *     list, from the same component the company page uses. One panel, one set
 *     of bugs, and a season started here is the same season there.
 *   - A company's project, but the power to run seasons isn't yours: what is
 *     running, and who to ask. Watching is not nothing — a season in progress
 *     is the thing you would want to join.
 *   - Nobody's company: the public market, which anybody can join alone and
 *     which fills the empty seats for you.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Gamepad2, ArrowRight, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSurfaces } from "@/hooks/use-surfaces";
import { TrainingTab } from "@/components/company/training-tab";
import { DecisionLab } from "@/components/sim/decision-lab";
import { TenYearsFromNow } from "@/components/sim/ten-years-from-now";

interface ProjectCompany {
  company: { id: string; name: string } | null;
  role?: string | null;
  powers?: string[];
}

export function SimulationsPanel({ projectId }: { projectId: string }) {
  const { on: surfaceOn } = useSurfaces();
  /*
   * The season half only. It is the one that needs five other people, so it is
   * the one the `sprints` kill switch is for; an owner's own projections stay
   * whatever that switch is doing, and with the season gone there is nothing
   * to put behind a second tab.
   */
  const seasons = surfaceOn("sprints");

  const business = (
    <div className="space-y-4">
      <DecisionLab projectId={projectId} />
      <TenYearsFromNow projectId={projectId} />
    </div>
  );
  if (!seasons) return business;

  return (
    <Tabs defaultValue="business" className="space-y-4">
      <TabsList data-testid="simulations-tabs">
        <TabsTrigger value="business" data-testid="tab-sim-business">Your business</TabsTrigger>
        <TabsTrigger value="market" data-testid="tab-sim-market">Market season</TabsTrigger>
      </TabsList>
      <TabsContent value="business">{business}</TabsContent>
      <TabsContent value="market">
        <MarketSeason projectId={projectId} />
      </TabsContent>
    </Tabs>
  );
}

/** The fortnight-long market game, and the three honest answers about who can run one. */
function MarketSeason({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery<ProjectCompany>({ queryKey: [`/api/projects/${projectId}/company`] });

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  const company = data?.company ?? null;
  const canRun = !!data?.powers?.includes("run_seasons");

  if (!company) {
    return (
      <Card data-testid="simulations-no-company">
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center gap-2">
            <Gamepad2 className="h-5 w-5 text-primary" />
            <p className="text-lg font-semibold">Run a market against other people</p>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Private seasons — your own people, your own market, a year as short as you like — belong to a company
            account. This project isn't one company's, so there's nobody to run a season for here.
          </p>
          <p className="text-sm text-muted-foreground max-w-2xl">
            You can still play the public market on your own: five strangers take the seats of one company, and any
            seat nobody takes is filled a minute later so you're never left waiting.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href="/simulation">
              <Button size="sm" data-testid="button-public-market">Pick a market <ArrowRight className="h-4 w-4 ml-1" /></Button>
            </Link>
            <Link href="/companies">
              <Button size="sm" variant="outline" data-testid="button-company-account">Set up a company account</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="simulations-panel">
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
        <Users className="h-4 w-4 text-primary shrink-0" />
        <span className="flex-1">
          {canRun
            ? <>A season for {company.name}'s people — the same team as this project. Everyone here can join with the code.</>
            : <>{company.name} runs these. You can join a season that's open; starting one needs the "run training seasons" power.</>}
        </span>
        <Link href={`/companies/${company.id}?tab=team`}>
          <Button size="sm" variant="outline" data-testid="button-company-team">The team</Button>
        </Link>
      </div>
      {/*
        * The company page's own panel, not a copy of it. A second
        * implementation of "start a season" is a second set of rules about who
        * may, and they drift.
        */}
      <TrainingTab companyId={company.id} canManage={canRun} />
    </div>
  );
}
