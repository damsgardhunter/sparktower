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
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Gamepad2, ArrowRight, Users, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
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

  if (!company) return <FromThisProject projectId={projectId} />;

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


interface BuiltMarket {
  companyId: string;
  companyName: string;
  seasonId: string;
  joinUrl: string | null;
  market: {
    name: string; premise: string; written: boolean;
    segments: { name: string; description: string; size: number }[];
    regions: { name: string; note: string }[];
    rivals: { name: string; knock: string }[];
  };
  fellBack: boolean;
}

/**
 * The answer for somebody who has a project and no company.
 *
 * What used to be here was true and useless: private seasons belong to a
 * company, this project belongs to a person, so there is nothing for you —
 * set up a company account. A form, about an organisation that does not
 * exist, standing between somebody and the thing they came for.
 *
 * A project is already a business with a name, a description and a path
 * through it. So the offer is to run a season in the market that business is
 * actually in, with the company stood up behind it rather than asked for.
 * The public market stays on the page, because playing five strangers is a
 * real answer too and a cheaper one.
 */
function FromThisProject({ projectId }: { projectId: string }) {
  const [, navigate] = useLocation();
  const [built, setBuilt] = useState<BuiltMarket | null>(null);
  const [error, setError] = useState<string | null>(null);

  const build = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/simulation`, {}),
    onSuccess: async (res: any) => {
      const body = await res.json() as BuiltMarket;
      setBuilt(body);
      setError(null);
      // The panel's own question — "does this project have a company?" — just changed.
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/company`] });
    },
    onError: (e: unknown) => setError(errorText(e, "Couldn't build that. Try again in a moment.")),
  });

  if (built) {
    const m = built.market;
    return (
      <Card data-testid="simulations-built">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <p className="text-lg font-semibold">{m.name}</p>
            {m.written
              ? <Badge variant="secondary" data-testid="badge-written">Written for you</Badge>
              : <Badge variant="outline" data-testid="badge-nearest">Closest market we had</Badge>}
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">{m.premise}</p>

          {built.fellBack && (
            <p className="text-xs text-amber-600 max-w-2xl" data-testid="text-fell-back">
              Nova couldn't write a market for this one, so this is the nearest of ours. It plays properly —
              it just isn't yours.
            </p>
          )}

          <div className="grid sm:grid-cols-3 gap-4">
            <Dimension title="Who buys" items={m.segments.map((x) => ({ head: x.name, body: x.description }))} />
            <Dimension title="Where" items={m.regions.map((x) => ({ head: x.name, body: x.note }))} />
            <Dimension title="Who's already there" items={m.rivals.map((x) => ({ head: x.name, body: x.knock }))} />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={() => navigate(`/companies/${built.companyId}?tab=training`)} data-testid="button-open-season">
              Open the season <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBuilt(null)} data-testid="button-built-done">Not now</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {built.companyName} now exists as a company, owned by you, with this project attached — so the
            seats, the team and every season after this one are already there.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="simulations-no-company">
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Gamepad2 className="h-5 w-5 text-primary" />
          <p className="text-lg font-semibold">Run a market against other people</p>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Nova reads what this project is — who it is for, what it sells, how far it has got — and writes the
          market it is actually in: who buys and what they weigh, where they are, and who already has them.
          Then five of you take the seats of one company and run it.
        </p>
        <p className="text-sm text-muted-foreground max-w-2xl">
          A company gets stood up behind it, named after this project, so you never fill in a form about an
          organisation that doesn't exist yet.
        </p>
        {error && <p className="text-sm text-destructive" data-testid="text-build-error">{error}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={() => build.mutate()} disabled={build.isPending} data-testid="button-build-from-project">
            {build.isPending
              ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Writing your market…</>
              : <>Create a company and run a simulation <ArrowRight className="h-4 w-4 ml-1" /></>}
          </Button>
          <Link href="/simulation">
            <Button size="sm" variant="outline" data-testid="button-public-market">Play the public market instead</Button>
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          The public market is five strangers taking one company's seats, with any empty seat filled a minute
          later. It costs nothing and starts now.
        </p>
      </CardContent>
    </Card>
  );
}

/** One of the three things a market is made of, listed plainly. */
function Dimension({ title, items }: { title: string; items: { head: string; body: string }[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-medium mb-1.5">{title}</p>
      <ul className="space-y-1.5">
        {items.slice(0, 5).map((i) => (
          <li key={i.head}>
            <p className="text-[13px] font-medium leading-tight">{i.head}</p>
            <p className="text-[11px] text-muted-foreground leading-snug">{i.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
