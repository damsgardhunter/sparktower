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
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Gamepad2, ArrowRight, Users, ChevronRight, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSurfaces } from "@/hooks/use-surfaces";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { businessMoney } from "@shared/currency";
import { SIM_GAMES } from "@/pages/project-sim";
import { PERIOD_NAME } from "@shared/simulation/cadence";

interface ProjectCompany {
  company: { id: string; name: string } | null;
  role?: string | null;
  powers?: string[];
  /** What the project's company holds of each kind of seat. */
  seats?: Record<string, number>;
  seatPrices?: Record<string, number>;
  /** The seasons this project has, newest first. */
  seasons?: {
    id: string; name: string; status: string; cadence: string;
    year: number; totalYears: number;
    solo: boolean; seatCount: number; seatKind: string;
    joinUrl: string | null; ventureId: string | null;
  }[];
  /** Markets this project already had written, each replayable for nothing. */
  replayable?: {
    seasonId: string; name: string; cadence: string; status: string;
    createdAt: string; marketName: string | null; rivals: string[]; plays: number;
    lastFinish: { rank: number; field: number; marketShare: number; profitable: boolean; bankrupt: boolean; year: number } | null;
  }[];
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

  const business = <BusinessSims projectId={projectId} />;
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

/**
 * The three business simulations, as somewhere to choose from.
 *
 * They used to be stacked here, one under the other, each with its own inputs
 * and its own long form — so opening this tab meant meeting all three at once
 * and scrolling past two to reach the one you came for. Now each is a page,
 * and this is the door to it.
 *
 * The cards carry the Nova ring, which is what this product uses for the
 * things Nova itself does. Lit on hover rather than always, because three
 * glowing cards is not emphasis, it is wallpaper.
 */
function BusinessSims({ projectId }: { projectId: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="business-sims">
      {Object.values(SIM_GAMES).map((game) => (
        <Link key={game.slug} href={`/projects/${projectId}/simulate/${game.slug}`}>
          <Card
            className="nova-ring nova-hover-glow h-full cursor-pointer"
            data-testid={`card-sim-${game.slug}`}
          >
            <CardContent className="flex h-full flex-col gap-2 p-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl nova-chip">
                <game.icon className="h-4 w-4" />
              </span>
              <p className="font-semibold leading-tight">{game.title}</p>
              <p className="flex-1 text-sm text-muted-foreground">{game.blurb}</p>
              <span className="flex items-center gap-1 text-sm font-medium text-primary">
                Open <ChevronRight className="h-4 w-4" />
              </span>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

/** The fortnight-long market game, and the three honest answers about who can run one. */
function MarketSeason({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery<ProjectCompany>({ queryKey: [`/api/projects/${projectId}/company`] });
  /*
   * Held here rather than inside the thing that built it.
   *
   * Building a season creates the company, and this component switches on
   * whether a company exists — so the moment the build succeeded, the branch
   * flipped, `FromThisProject` unmounted, and the market it had just written
   * went with it. You pressed the button, waited half a minute for four
   * competitors and a market of your own, and landed on a seasons list with
   * no idea whether it had worked.
   */
  const [built, setBuilt] = useState<BuiltMarket | null>(null);

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  const company = data?.company ?? null;
  const canRun = !!data?.powers?.includes("run_seasons");

  /*
   * No company yet, which is most projects — and where this used to give up.
   *
   * The old card explained the rule ("private seasons belong to a company")
   * and offered two doors out of it: pick one of the seven markets, or go and
   * fill in a form about an organisation that does not exist. Neither is the
   * thing somebody standing on their own project's page wanted, which was a
   * season about *this*. `FromThisProject` is that, and it was written and
   * then left unreachable — the merge kept the component and never wired it
   * to the branch that renders.
   */
  if (built) return <SeasonBuilt built={built} onDismiss={() => setBuilt(null)} />;
  if (!company) return <FromThisProject projectId={projectId} onBuilt={setBuilt} replayable={data?.replayable ?? []} />;

  /*
   * The project's own seasons, in the project's own tab.
   *
   * Building a season creates a company to hold it, which is an implementation
   * detail of how seats and markets are stored — and it used to take over the
   * screen. The moment a market was built, this panel switched to the
   * company's training page: "a season for X's people", a link out to the
   * company, and a list written for an HR administrator running an away day.
   * Somebody who pressed "have Nova customise my season" for their own
   * business was shown a staff training programme and a door out of their
   * project.
   *
   * So the seasons are listed here instead, and the company is not mentioned.
   * Nothing moved in the database: the same rows, read by the project that
   * owns them.
   */
  return (
    <div className="space-y-4" data-testid="simulations-panel">
      {(data?.seasons ?? []).length > 0 && (
        <Card className="nova-ring">
          <CardContent className="p-5 space-y-3">
            <p className="text-sm font-medium">This project's seasons</p>
            {(data?.seasons ?? []).map((sn) => (
              <div key={sn.id} className="flex items-center gap-3 rounded-xl border p-3" data-testid={`season-${sn.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium truncate">{sn.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {sn.solo ? "You, on your own — every desk" : `${sn.seatCount} seats`}
                    {" · "}
                    {sn.status === "running"
                      ? `${(PERIOD_NAME as Record<string, { one: string }>)[sn.cadence]?.one ?? "Year"} ${sn.year} of ${sn.totalYears}`
                      : sn.status === "forming" ? "Not started yet" : sn.status}
                  </span>
                </span>
                {sn.ventureId
                  ? <Link href={`/sim/${sn.ventureId}`}>
                      <Button size="sm" data-testid={`button-open-${sn.id}`}>Open the desk <ArrowRight className="h-4 w-4 ml-1" /></Button>
                    </Link>
                  : sn.joinUrl
                    ? <Link href={sn.joinUrl}>
                        <Button size="sm" variant="outline" data-testid={`button-take-seat-${sn.id}`}>Take your seat</Button>
                      </Link>
                    : null}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {canRun && <FromThisProject projectId={projectId} onBuilt={setBuilt} replayable={data?.replayable ?? []} />}

      {/*
        * More chairs, for the people this founder actually wants at the table.
        * Only where somebody can act on it — being shown a price you have no
        * power to pay is worse than not being shown one.
        */}
      {canRun && company && (
        <BuySeats
          companyId={company.id}
          projectId={projectId}
          held={data?.seats ?? {}}
          prices={data?.seatPrices ?? {}}
          seasons={data?.seasons ?? []}
        />
      )}
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
    rivals: { name: string; knock: string; share: number; posture: string }[];
    /** What no rival holds. The only part of the market year one can actually win. */
    openShare: number;
  };
  /** How often the table decides, and what one of those is called. */
  cadence: string;
  periodName: string;
  /** True when this was a market played again rather than written afresh. */
  replayed: boolean;
  /** Seats the company holds for this shape of season, and what the next one costs. */
  seatsHeld: number;
  seatPriceCents: number;
  /** The opening bank, at the scale of the market Nova wrote. */
  openingCash: number;
  currency: string;
  /** Whether the other four seats are Nova's or need four more people. */
  solo: boolean;
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

/**
 * The market Nova just wrote, read before anybody plays it.
 *
 * Its own component because the panel around it changes underneath it: the
 * build creates the company, so the branch that rendered the button is gone
 * by the time there is anything to show. Rendered from state the panel holds
 * rather than state this owns — see `built` in MarketSeason.
 */
function SeasonBuilt({ built, onDismiss }: { built: BuiltMarket; onDismiss: () => void }) {
  const [, navigate] = useLocation();
    const m = built.market;
    /*
     * The opening bank, in the money the project counts in. `businessMoney`
     * rounds the way a business says a number out loud — "$60k", not
     * "$60,000.00" — which is how this figure gets talked about.
     */
    const openingText = businessMoney(built.openingCash, built.currency);
    return (
      <Card data-testid="simulations-built">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <p className="text-lg font-semibold">{m.name}</p>
            {m.written
              ? <Badge variant="secondary" data-testid="badge-written">Written for you</Badge>
              : <Badge variant="outline" data-testid="badge-nearest">Closest market we had</Badge>}
            {built.replayed && <Badge variant="outline" data-testid="badge-replayed">Played again · free</Badge>}
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">{m.premise}</p>

          {built.fellBack && (
            <p className="text-xs text-amber-600 max-w-2xl" data-testid="text-fell-back">
              Nova couldn't write a market for this one, so this is the nearest of ours. It plays properly —
              it just isn't yours.
            </p>
          )}

          <WhoHoldsIt rivals={m.rivals} open={m.openShare} opening={openingText} />

          <div className="grid sm:grid-cols-2 gap-4">
            <Dimension title="Who buys" items={m.segments.map((x) => ({ head: x.name, body: x.description }))} />
            <Dimension title="Where" items={m.regions.map((x) => ({ head: x.name, body: x.note }))} />
          </div>

          <div className="rounded-xl nova-ring px-3 py-2 text-sm text-muted-foreground" data-testid="text-how-you-start">
            You start with <span className="font-medium text-foreground">{openingText}</span> in the bank, and decide
            once a <span className="font-medium text-foreground">{built.periodName}</span>.
            {built.replayed && " Played again from a market you already had written, so nothing was charged and Nova wasn't asked."}
            {" "}Your seat is included{built.seatsHeld > 1 ? `, and you hold ${built.seatsHeld}` : ""} — bringing
            somebody else to the table is {businessMoney(built.seatPriceCents / 100, built.currency)} a seat, once, and
            the seat stays with the company for every season after it.
            {built.solo
              ? " You take a seat and Nova plays the other four, reading this market — so you can begin on your own."
              : " Five of you take the seats of one company; any seat nobody takes, Nova plays."}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={() => navigate(`/companies/${built.companyId}?tab=training`)} data-testid="button-open-season">
              Open the season <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
            <Button size="sm" variant="outline" onClick={onDismiss} data-testid="button-built-done">Not now</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {built.companyName} now exists as a company, owned by you, with this project attached — so the
            seats, the team and every season after this one are already there.
          </p>
        </CardContent>
      </Card>
    );
}

/**
 * How often the table decides, said in the terms a founder thinks in.
 *
 * The engine has run on periods rather than years for a long time and company
 * seasons could already choose; a season built from a project always quietly
 * took yearly, which is the least useful of the three for somebody rehearsing
 * a business they are running this month.
 */
/** "1st", "2nd", "5th" — a finishing position reads as a place, not a number. */
const ordinal = (n: number): string => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

const CADENCE_CHOICES = [
  { id: "monthly", label: "Every month", note: "Closest to your actual week. Two simulated years of decisions." },
  { id: "quarterly", label: "Every quarter", note: "A planning rhythm. Four years, sixteen decisions." },
  { id: "yearly", label: "Every year", note: "The long view: strategy, and living with it. Eight years." },
] as const;

function FromThisProject({ projectId, onBuilt, replayable }: {
  projectId: string;
  onBuilt: (m: BuiltMarket) => void;
  replayable: NonNullable<ProjectCompany["replayable"]>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [cadence, setCadence] = useState<string>("quarterly");
  /** Which market is being played again, so only that row shows a spinner. */
  const [replaying, setReplaying] = useState<string | null>(null);

  const build = useMutation({
    mutationFn: (fromSeasonId?: string) =>
      apiRequest("POST", `/api/projects/${projectId}/simulation`, { cadence, ...(fromSeasonId ? { fromSeasonId } : {}) }),
    onSuccess: async (res: any) => {
      const body = await res.json() as BuiltMarket;
      onBuilt(body);
      setError(null);
      // The panel's own question — "does this project have a company?" — just changed.
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/company`] });
    },
    onError: (e: unknown) => setError(errorText(e, "Couldn't build that. Try again in a moment.")),
    onSettled: () => setReplaying(null),
  });


  return (
    <Card className="nova-ring" data-testid="simulations-no-company">
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl nova-chip">
            <Gamepad2 className="h-4 w-4" />
          </span>
          <p className="text-lg font-semibold">Run a season built around this project</p>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Nova reads what this project is — who it is for, what it sells, how far it has got — and writes the
          market it is actually in: who buys and what they weigh, where they are, and the four companies that
          already have them. Every seat, every lever and every decision is set to that market rather than to
          one of ours.
        </p>
        <ul className="text-sm text-muted-foreground max-w-2xl space-y-1">
          <li>· Four real competitors, laid out with the share each holds and what is left for you.</li>
          <li>· Sized to a business at your stage, so the opening move is one you could actually make.</li>
          <li>· The seats you don't take are played by Nova, reading your market — so you can start alone.</li>
        </ul>
        {replayable.length > 0 && (
          /*
           * What this project has already paid for, offered back for nothing.
           * A written market cannot be regenerated — press build again and you
           * get a different world — so the one they learned from has to be
           * playable again, or every season is a one-off.
           */
          <div className="rounded-xl border p-3 space-y-2" data-testid="replayable-markets">
            <p className="text-xs font-medium">Markets you've already had written</p>
            {replayable.map((r) => (
              <div key={r.seasonId} className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium truncate">{r.marketName ?? r.name}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">
                    {r.rivals.join(" · ") || "Your own market"}
                    {r.plays > 1 && ` · played ${r.plays} times`}
                  </span>
                  {r.lastFinish && (
                    /*
                     * How it went, not just that it happened. A list of things
                     * you have already done that will not say how they went is
                     * a list nobody reads twice.
                     */
                    <span className="block text-[11px] text-muted-foreground" data-testid={`finish-${r.seasonId}`}>
                      Last time:{" "}
                      {r.lastFinish.bankrupt
                        ? <span className="text-destructive">went under in year {r.lastFinish.year}</span>
                        : <>
                            {r.lastFinish.rank > 0 && `${ordinal(r.lastFinish.rank)} of ${r.lastFinish.field}`}
                            {` · ${(r.lastFinish.marketShare * 100).toFixed(1)}% of the market · `}
                            {r.lastFinish.profitable ? "making money" : "not yet profitable"}
                          </>}
                    </span>
                  )}
                </span>
                <Button
                  size="sm" variant="outline"
                  disabled={build.isPending}
                  onClick={() => { setReplaying(r.seasonId); build.mutate(r.seasonId); }}
                  data-testid={`button-replay-${r.seasonId}`}
                >
                  {replaying === r.seasonId
                    ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Setting it up…</>
                    : "Play it again — free"}
                </Button>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              The same rivals and the same shares, every time. Costs nothing and asks Nova nothing —
              pick a different rhythm below if you want the same market decided more often.
            </p>
          </div>
        )}
        <div className="pt-1">
          <p className="text-xs font-medium mb-1.5">How often you decide</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {CADENCE_CHOICES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCadence(c.id)}
                disabled={build.isPending}
                data-testid={`cadence-${c.id}`}
                aria-pressed={cadence === c.id}
                className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${
                  cadence === c.id ? "nova-ring bg-primary/5" : "border-border hover:border-primary/40"
                }`}
              >
                <span className="block text-[13px] font-medium">{c.label}</span>
                <span className="block text-[11px] text-muted-foreground leading-snug">{c.note}</span>
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-destructive" data-testid="text-build-error">{error}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" className="nova-hover-glow" onClick={() => build.mutate(undefined)} disabled={build.isPending} data-testid="button-customize-season">
            {build.isPending
              ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Nova is building your market…</>
              : <><Sparkles className="h-4 w-4 mr-1.5" /> Have Nova Customize my Season</>}
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

/**
 * More seats, several at a time, out of the balance.
 *
 * Seats were the one priced thing in the product that could only be bought
 * with a card: a project with money on its account still had to go through
 * Stripe to put a second person at its own table. The kind is not a choice
 * offered here — it is whatever the seasons this project has actually need,
 * because the four balances do not substitute for each other and picking the
 * wrong one buys a seat that cannot be spent.
 */
function BuySeats({ companyId, projectId, held, prices, seasons }: {
  companyId: string;
  projectId: string;
  held: Record<string, number>;
  prices: Record<string, number>;
  seasons: NonNullable<ProjectCompany["seasons"]>;
}) {
  /* The kind this project's newest season is played on, so the money lands where it is spent. */
  const kind = seasons[0]?.seatKind ?? "nova";
  const [seats, setSeats] = useState(1);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const price = prices[kind] ?? 0;

  const buy = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/simulation-seats/buy`, { seats, kind }),
    onSuccess: async (res: any) => {
      const body = await res.json();
      setError(null);
      setDone(`${body.seats} more ${body.seats === 1 ? "seat" : "seats"} — the table now holds ${body.held}.`);
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/company`] });
      queryClient.invalidateQueries({ queryKey: ["/api/nova/wallet"] });
    },
    onError: (e: unknown) => { setDone(null); setError(errorText(e, "Couldn't buy those seats.")); },
  });

  return (
    <Card className="nova-ring" data-testid="buy-seats">
      <CardContent className="p-5 space-y-3">
        <div>
          <p className="text-sm font-medium">Bring someone else to the table</p>
          <p className="text-sm text-muted-foreground">
            A seat is one person for the life of a season, and it stays with this project for every season
            after it. You hold {held[kind] ?? 0}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              size="sm" variant="outline" aria-label="One fewer seat"
              disabled={seats <= 1 || buy.isPending}
              onClick={() => setSeats((n) => Math.max(1, n - 1))}
              data-testid="button-seats-fewer"
            >–</Button>
            <span className="w-12 text-center text-sm font-medium tabular-nums" data-testid="text-seats">{seats}</span>
            <Button
              size="sm" variant="outline" aria-label="One more seat"
              disabled={seats >= 250 || buy.isPending}
              onClick={() => setSeats((n) => Math.min(250, n + 1))}
              data-testid="button-seats-more"
            >+</Button>
          </div>
          <Button
            size="sm" className="nova-hover-glow"
            disabled={buy.isPending}
            onClick={() => buy.mutate()}
            data-testid="button-buy-seats"
          >
            {buy.isPending
              ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Buying…</>
              : <>Buy {seats} {seats === 1 ? "seat" : "seats"} — ${((seats * price) / 100).toFixed(2)}</>}
          </Button>
          <span className="text-xs text-muted-foreground">Comes off your balance.</span>
        </div>
        {done && <p className="text-sm text-primary" data-testid="text-seats-bought">{done}</p>}
        {error && <p className="text-sm text-destructive" data-testid="text-seats-error">{error}</p>}
      </CardContent>
    </Card>
  );
}

/** One of the three things a market is made of, listed plainly. */
/**
 * Who holds this market, and what is left — as a bar rather than a paragraph.
 *
 * The one screen somebody reads before they decide to play, so it answers the
 * only question they have at that moment: is there room for me? Four rivals
 * with their share, and the slice nobody holds sitting at the end of the same
 * bar, because "38% is open" means nothing until it is next to the 22% the
 * biggest incumbent has.
 *
 * The numbers are the engine's own (`marketShares`), not a summary of them, so
 * the bar and the first year agree.
 */
function WhoHoldsIt({ rivals, open, opening }: {
  rivals: { name: string; knock: string; share: number; posture: string }[];
  open: number;
  /** The opening bank, already formatted in the project's own currency. */
  opening: string;
}) {
  if (!rivals.length) return null;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <div className="space-y-3" data-testid="market-shares">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium">Who already has this market</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-primary" data-testid="text-open-share">{pct(open)}</span> is open
        </p>
      </div>

      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        {rivals.map((r, i) => (
          <div
            key={r.name}
            className="h-full border-r border-background last:border-r-0"
            style={{ width: `${r.share * 100}%`, background: `hsl(var(--primary) / ${0.85 - i * 0.15})` }}
          />
        ))}
        <div className="h-full flex-1 bg-primary/10" />
      </div>

      <ul className="space-y-2">
        {rivals.map((r) => (
          <li key={r.name} className="flex gap-3" data-testid={`rival-${r.name}`}>
            <span className="w-10 shrink-0 text-[13px] font-semibold tabular-nums">{pct(r.share)}</span>
            <span className="min-w-0">
              <span className="text-[13px] font-medium leading-tight">{r.name}</span>
              <span className="ml-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{r.posture}</span>
              <p className="text-[11px] text-muted-foreground leading-snug">{r.knock}</p>
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-muted-foreground">
        These four are the whole competition — nobody else is seated. Each one's weak spot is the way in,
        and you go at it with {opening} in the bank.
      </p>
    </div>
  );
}

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
