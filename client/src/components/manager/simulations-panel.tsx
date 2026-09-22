/**
 * The manager's Simulations tab: a market season for the people on this
 * project.
 *
 * It sits under Team in the rail because that is what it is — the team you
 * were just looking at, taking the five seats of one company and running it
 * for a fortnight. A company runs these for its own staff: five of them argue
 * over one price, one hiring plan and one factory, and find out on the same
 * day what it cost. That is a different lesson from reading about it, and it
 * is the reason to have your people here rather than on a course.
 *
 * The rail belongs to every project, and most projects belong to nobody but
 * their builder. So this panel answers honestly in three states rather than
 * appearing broken in two of them:
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
import { TrainingTab } from "@/components/company/training-tab";

interface ProjectCompany {
  company: { id: string; name: string } | null;
  role?: string | null;
  powers?: string[];
}

export function SimulationsPanel({ projectId }: { projectId: string }) {
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
