/**
 * The desk: one seat's year, and what the other four are doing to it.
 *
 * This is the screen people open every day for a fortnight, so the order of it
 * matters more than anything else on it. Top to bottom:
 *
 *   1. **What happened yesterday.** Nobody decides this year's marketing
 *      before finding out how last year's went. Putting the form first would
 *      be asking for a decision from someone who does not yet know where they
 *      are.
 *   2. **Where the company stands** — the numbers that decision is against.
 *   3. **Your levers**, with what the table has committed pinned beside them.
 *   4. **Everyone else** — who has filed, and what the market looks like.
 *
 * ## Why the money total follows the form as you type
 *
 * The failure this whole screen is built around is five people privately
 * making reasonable decisions that are collectively ruinous. That only gets
 * caught if the total moves while a hand is still on the slider — a number
 * that updates after you submit is a post-mortem. So the commitment is
 * recomputed locally on every keystroke from the same shared function the
 * server uses, and the server's copy replaces it on the next poll.
 *
 * ## Nothing here is optimistic
 *
 * Five people are filing into the same year. The screen shows what the server
 * last confirmed, and a submit that fails puts the message under the field
 * that caused it rather than in a toast that scrolls away.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { symbolOf, DEFAULT_CURRENCY, type CurrencyCode } from "@shared/currency";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { DeskCurrency, DeskPeriod, useMoney, usePeriod } from "@/components/sim/desk-currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { NOVA_GRADIENT_CSS } from "@shared/backing";
import { longCountdown } from "@shared/simulation/lobby-copy";
import { commitment, type LeverField } from "@shared/simulation/levers";
import { leverOutcome, optionOutcome, type Outcome } from "@shared/simulation/lever-outcomes";
import { saturate } from "@shared/simulation/market";
import type { Role } from "@shared/simulation/types";
import { CompanyProfile } from "@/components/sim/company-profile";
import { TeammateProfile } from "@/components/sim/teammate-profile";
import { lookOf } from "@/components/sim/market-look";
import { capacityRisk, type Forecast } from "@shared/simulation/forecast";
import { ProjectionPanel } from "@/components/sim/projection-panel";
import { ProjectionRail, ProjectionBar } from "@/components/sim/projection-dock";
import { NOVA_GRADIENT } from "@/components/manager/tabs";
import { AdvanceYearCard } from "@/components/sim/advance-year";
import {
  Loader2, Clock, TrendingUp, TrendingDown, Minus, AlertTriangle, Info,
  CheckCircle2, Circle, Users, ArrowLeft, Target, LifeBuoy, Store, Handshake, Trophy, Newspaper, ChevronDown, Gauge, History, SlidersHorizontal, Telescope,
  Crosshair,
  ArrowUpRight, ArrowDownRight,
} from "lucide-react";

import { WhatTheTableDecided, WhereTheMarketSits, type AuctionRow, type Standing } from "@/components/sim/past-year";
import { ExpansionVote, type ExpansionVoteData } from "@/components/sim/expansion-vote";

interface Desk {
  phase: "not_started" | "over" | "running" | "finished";
  ventureId: string;
  name: string | null;
  product: string | null;
  niche: { id: string; name: string; premise: string; voice: Record<string, string> };
  /**
   * What one decision is called in this season: a year, a quarter or a month.
   *
   * Sent by the server so the desk and the engine cannot disagree about what a
   * quarter is called. Optional because a desk from before this existed has no
   * opinion, and "year" is what it always meant.
   */
  period?: { one: string; many: string; of: string };
  cadence?: string;
  /** What this company counts its money in — the project's currency, or the default. */
  currency?: CurrencyCode;
  year: number;
  totalYears: number;
  resolvesAt: string | null;
  seasonId?: string;
  /** Set only for developers and for companies running this season. */
  canAdvance?: "developer" | "dev_flag" | "company" | null;
  yourRole: Role | null;
  yourTitle: string | null;
  /** Only before year one: how many rooms in this market are still in a lobby. */
  roomsStillChoosing?: number;
  /** One chair at this table: every desk is yours, and nobody else is arriving. */
  solo?: boolean;
  yourRoomReady?: boolean;
  yourLevers: string[];
  fields: LeverField[];
  /** The levers this seat gets next year, by name. */
  arrivingNextYear?: string[];
  /** The product's risks and its bets. */
  productRisk?: ProductRisk;
  /** What one unit of capacity costs to build, and to lease for a year, in this market. */
  prices?: { build: number; lease: number };
  draft: Record<string, any> | null;
  submitted: boolean;
  company: {
    cash: number; debt: number; creditLimit: number; reputation: number;
    quality: number; brand: number; service: number; capacity: number;
    /** Room the company's assets add on top of what it built. */
    assetCapacity?: number;
    unitCost: number; price: number; customers: number; bankruptSince: number | null;
    founderShare: number; pipeline: number; positioning: string | null;
    pipelineLater?: number; brandPipeline?: number; staff?: number;
    /** The seats the company still has; a dissolved one is gone from here. */
    seats?: Role[];
    /** How many of those chairs are actually paid for. One, for a solo founder holding all five. */
    officers?: number;
    /** The size of this company's market, which every fixed cost is charged at. */
    scale?: number;
    techDebt: number; techDebtCost: { product: number; unitCost: number };
  };
  segments: {
    id: string; name: string; description: string; referencePrice: number; loyalty: number; yours: number;
    weights: { price: number; quality: number; brand: number; service: number };
    taste: string;
    floors: { axis: "quality" | "service"; atLeast: number }[];
    priceCeiling: number;
    shortOf: { axis: string; by: number }[];
  }[];
  forecast: Forecast | null;
  idleCostPerUnit: number;
  cities: { id: string; name: string; weight: number; entryCost: number; note: string; open: boolean }[];
  dissolvedSeats: string[];
  economy: { demand: number; interestRate: number; costIndex: number; outlook: string; outlookMeans: string };
  /** What the company is worth today — what a raise is priced against. */
  valuation: number;
  /** How fast this market's products move, which scales what research buys. */
  innovationPace: number;
  /** The niche this table went and found, if they have one. */
  ours: {
    id: string; name: string; foundInYear: number; from: string; people: number;
    premium: number; headStartLeft: number; sharedWith: string[]; held: number;
  } | null;
  /** The region operations may put to the table this year, and where the vote stands. */
  expansion: ExpansionVoteData | null;
  table: {
    userId: string; name: string; role: Role | null; title: string | null; filed: boolean; isYou: boolean;
    /** For putting a face against a vote. */
    avatarUrl?: string | null;
    /** The chair's standing with the room. Not tracked for the chief executive. */
    person?: { loyalty: number; skill: number; stretch: "easy" | "fair" | "aggressive"; warning: boolean } | null;
  }[];
  filed: Record<string, any>;
  preview: {
    commitment: { spend: number; fixed: number; available: number; ratio: number; bySeat: { role: Role; spend: number }[]; openingCost: number };
    notes: string[];
    warnings: string[];
  };
  lastYear: {
    year: number; customers: number; marketShare: number; shareChange: number; turnedAway: number;
    revenue: number; costs: number; profit: number; cash: number; debt: number;
    reputation: number; reputationChange: number; rank: number; notes: string[]; bankrupt: boolean;
    market?: { kind: "won" | "lost" | "sold" | "unsold"; text: string }[];
    auctions?: AuctionRow[];
    event?: { headline: string; body: string; advice: string; scope: "market" | "company"; mine: boolean };
    founderValue?: number; founderShare?: number;
  } | null;
  rivals: { id: string; name: string; kind: string; price: number; customers: number; posture: string | null; posturedAs: string | null }[];
  /** Every company in the market, placed — for the map on the Past tab. */
  standing?: Standing[];
  /** What the table filed last year, which is the only record of it anywhere. */
  lastFiled?: { decisions: Record<string, any>; filedBy: Record<string, string> } | null;
  challenge: Challenge | null;
  lastChallenge: ChallengeResult | null;
  distress: {
    level: "healthy" | "strained" | "distressed" | "insolvent";
    title: string;
    body: string;
    options: { kind: string; title: string; body: string; cost: string; raises: number }[];
    covenant: { since: number; spendCap: number; met: number; rateRelief: number } | null;
    filed: { kind: string; seat: string | null } | null;
  };
}

interface Target { id: string; label: string; goal: number; compare: "at_least" | "at_most"; metric: string }
interface Challenge {
  id: string; role: Role; year: number; title: string; brief: string;
  targets: Target[];
  reward: { kind: string; amount: number; label: string };
  partialReward: { kind: string; amount: number; label: string };
}
interface ChallengeResult {
  outcome: "met" | "partial" | "missed";
  targets: (Target & { actual: number; met: boolean })[];
  note: string;
}

/** A market's noun as a column heading: "subscribers" → "Subscribers". */
const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * What the season counts in, for every figure on this desk.
 *
 * Both formatters had a pound sign written into them, so a company built from
 * a project that counts in dollars was still priced in sterling on every
 * screen of the game it was rehearsing. The desk now says which currency it
 * is (`currency` on its payload) and a context carries it, because the
 * figures are drawn by six components and threading a prop through all of
 * them would be six chances to miss one.
 */

export default function SimulationDeskPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  /* Which tab: in the address (?tab=past|future), Decisions when it isn't. */
  const search = useSearch();
  const asked = new URLSearchParams(search).get("tab");
  const tabParam: DeskTab | null = asked === "past" || asked === "future" || asked === "decisions" ? asked : null;
  const setTab = (t: DeskTab) => navigate(`/simulation/${id}${t === "decisions" ? "" : `?tab=${t}`}`, { replace: true });

  const { data: desk, isLoading } = useQuery<Desk>({
    queryKey: [`/api/sim/ventures/${id}/desk`],
    // Slower than the lobby: a year lasts a day, and the thing worth noticing
    // is a teammate filing rather than a seat being taken out from under you.
    refetchInterval: 8000,
  });

  /*
   * Read off the payload rather than the context, because this component
   * renders the providers: a hook called here would read the fallback and
   * format a dollar company in pounds, or call a quarter a year.
   */
  const { money, compact } = useMoney(desk?.currency);
  const period = usePeriod(desk?.period);

  const [draft, setDraft] = useState<Record<string, any> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  /*
   * The server's draft seeds the form once, and then stops touching it. A poll
   * that overwrote the field someone was mid-way through typing into would be
   * the screen arguing with its own user.
   */
  const seededYear = useRef<number | null>(null);
  useEffect(() => {
    if (!desk?.draft) return;
    /*
     * ...except when the year turns underneath the open page (the overnight
     * tick, or somebody ending the year early). The draft then belongs to a
     * year that has already resolved, and leaving it would re-file last
     * year's numbers — a two-million borrow taken twice. The phone does the
     * same (mobile/app/sim/desk/[id].tsx).
     */
    if (draft !== null && seededYear.current === desk.year) return;
    seededYear.current = desk.year;
    setDraft(desk.draft);
    setErrors({});
  }, [desk?.draft, desk?.year, draft]);

  const submit = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sim/ventures/${id}/decisions`, { decision: draft }),
    onSuccess: () => {
      setErrors({});
      toast({ title: "Filed", description: "You can still change it until the year resolves." });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${id}/desk`] });
    },
    onError: (err: any) => {
      const body = err?.body ?? err?.response ?? {};
      if (body?.errors) { setErrors(body.errors); return; }
      /*
       * The year turned over while they were typing.
       *
       * `YEAR_CLOSING` exists precisely so this can say "a moment" rather
       * than "something went wrong" — and nothing checked for it, so the one
       * refusal the server went out of its way to make gentle arrived as a
       * red error about a failure that had not happened. The desk is also a
       * year out of date at this point, so it refetches: what they typed was
       * for a year that has closed, and next year's screen is the one to be
       * looking at.
       */
      if (body?.code === "year_closing") {
        toast({ title: "That year just closed", description: "Next year is opening now — your screen is catching up." });
        queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${id}/desk`] });
        return;
      }
      toast({ title: "Couldn't file that", description: body?.message ?? "Try again.", variant: "destructive" });
    },
  });

  /* A local countdown so the deadline moves between polls. */
  const [now, setNow] = useState(Date.now());
  /*
   * Which overlay is open, held here rather than in the cards that open them.
   * A rival can be tapped from the list at the bottom and a teammate from the
   * table above it, and both have to be able to close the other.
   */
  const [openCompany, setOpenCompany] = useState<string | null>(null);
  const [openSeat, setOpenSeat] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  /*
   * The table's commitment, recomputed as this seat types.
   *
   * Same function the server runs, so the number cannot drift from the one
   * that will actually be charged — and immediate, which is the only way it
   * changes anybody's mind.
   */
  const live = useMemo(() => {
    /*
     * Optional all the way down, because a desk before its season starts has
     * no preview at all.
     *
     * `not_started` sends a handful of fields and nothing else, so reading
     * `desk.preview.commitment` threw — and this runs before the early return
     * that handles that phase, so the whole screen went white for every team
     * between naming their company and the job starting the season. That is
     * the first thing anybody does after the lobby.
     */
    if (!desk || desk.phase !== "running" || !desk.yourRole || !draft) return desk?.preview?.commitment ?? null;
    try {
      const decisions: any = { ...desk.filed, companyId: desk.ventureId, [desk.yourRole]: draft };
      /*
       * The market's shape matters to this sum twice over: the fixed bill
       * scales with how much of the country the company sells in, and opening
       * somewhere new is the largest single cash movement a marketing seat can
       * make. Without it the meter ignored both — it sat unmoved while a city
       * worth a million was selected, which is precisely the moment it exists
       * to say something.
       */
      const market: any = { cities: desk.cities, segments: desk.segments };
      // Capacity priced as the server priced it: the desk's segments carry no sizes to price it from.
      return commitment(desk.company as any, decisions, desk.economy, market, desk.prices ?? null);
    } catch {
      /*
       * Fall back to the server's own figure rather than taking the screen
       * down with us.
       *
       * This is not hypothetical: the arithmetic needs `company.seats`, the
       * payload did not carry it, and the whole desk rendered as a white
       * screen — a total loss of the page over a number that was *already in
       * the response* next to it. A live total is a nicety; the last year's
       * results, the form and the deadline are not, and none of them should
       * depend on it.
       */
      return desk.preview.commitment;
    }
  }, [desk, draft]);

  if (isLoading || !desk) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (desk.phase === "over") {
    return (
      <Shell title={desk.name ?? "Your company"} subtitle="This one didn't start">
        <Card><CardContent className="p-6 space-y-3" data-testid="card-season-over">
          <p className="text-sm">
            Not enough people made it into this market in time, so the season closed instead of starting. Nothing you
            did — rooms need three players to be a company, and this one didn't get there.
          </p>
          <p className="text-sm text-muted-foreground">
            Joining again puts you in a fresh room, and one that has been waiting a minute fills itself so you are
            never the only one at the table.
          </p>
          <Button size="sm" onClick={() => navigate("/simulation")} data-testid="button-pick-market">Pick a market</Button>
        </CardContent></Card>
      </Shell>
    );
  }

  if (desk.phase === "not_started") {
    const waiting = desk.roomsStillChoosing ?? 0;
    return (
      <Shell title={desk.name ?? "Your company"} subtitle="Waiting for year one">
        <Card><CardContent className="p-6 space-y-2" data-testid="card-not-started">
          <p className="text-sm">
            {desk.solo
              ? "Your company is set up. Year one starts in a few seconds — this page will move on by itself."
              : waiting === 0
                ? "Every room in this market has its seats. Year one starts within the minute — this page will move on by itself."
                : `The company exists. Year one begins once the ${waiting === 1 ? "one room" : `${waiting} rooms`} still choosing seats ${waiting === 1 ? "has" : "have"} finished — usually a minute or two, and never more than twenty.`}
          </p>
          <p className="text-sm text-muted-foreground">
            {/*
              * Two different promises, because two different things are true.
              * The public market fills a waiting room with players the product
              * runs. A season built from a project does not — its seats were
              * bought for named people — and a solo founder has no empty seats
              * at all, so saying either to them is a lie about their own table.
              */}
            {desk.solo
              ? "Every desk is yours: nobody else is coming, and nobody else is being paid. Nothing is lost by closing this; the season will be here when it starts."
              : <>
                  {desk.yourTitle ? `You have the ${desk.yourTitle.toLowerCase()}'s chair. ` : ""}
                  You don't need anyone else to turn up: a room that has been waiting a minute is filled out with players the
                  product runs, so a season never depends on five strangers arriving at once. Nothing is lost by closing
                  this; the season will be here when it starts.
                </>}
          </p>
        </CardContent></Card>
      </Shell>
    );
  }

  const c = desk.company;
  /*
   * This market's words. Held in a short name because it is spliced into
   * labels all over the screen and `desk.niche.voice.capacityShort` inside a
   * template literal is unreadable.
   */
  const v = desk.niche.voice;
  // Once the season is over there is nothing to decide, so it opens on how it went.
  const tab: DeskTab = tabParam ?? (desk.phase === "finished" ? "past" : "decisions");
  const secondsLeft = desk.resolvesAt ? Math.max(0, Math.round((new Date(desk.resolvesAt).getTime() - now) / 1000)) : null;

  return (
    <DeskCurrency.Provider value={desk.currency ?? DEFAULT_CURRENCY}>
    <DeskPeriod.Provider value={desk.period ?? { one: "year", many: "years", of: "this year" }}>
    <Shell
      title={desk.name ?? "Your company"}
      subtitle={`${desk.niche.name} · Year ${desk.year} of ${desk.totalYears}`}
      nicheId={desk.niche.id}
      onBack={() => navigate("/simulation")}
      clock={desk.phase === "finished" ? "Season over" : secondsLeft !== null ? `${longCountdown(secondsLeft)} until this year resolves` : null}
      year={desk.year}
      totalYears={desk.totalYears}
      tabs={(compact) => (
        <DeskTabs
          tab={tab}
          onChange={setTab}
          ventureId={desk.ventureId}
          lastYear={desk.lastYear?.year ?? null}
          year={desk.year}
          filed={!!desk.submitted}
          compact={compact}
        />
      )}
      rail={desk.phase !== "finished" ? (
        <ProjectionRail
          ventureId={id!}
          draft={draft}
          filedStamp={JSON.stringify(desk.filed ?? {})}
          live={live ?? null}
          customersWord={v.customers}
          warnings={desk.preview.warnings}
          top={156}
        />
      ) : undefined}
      bottom={desk.phase !== "finished" ? (
        <ProjectionBar
          ventureId={id!}
          draft={draft}
          filedStamp={JSON.stringify(desk.filed ?? {})}
          live={live ?? null}
          customersWord={v.customers}
          warnings={desk.preview.warnings}
        />
      ) : undefined}
    >
      {/*
        * Three tabs, in the order a seat thinks: what just happened, what to
        * do about it, and where that leads. The pinned header switches them,
        * and the tab is in the address so a reload keeps it.
        */}
      {tab === "past" && (
        <>
        {/* 1. What happened last year, before anyone is asked to decide this one. */}
        {desk.lastYear ? <LastYear report={desk.lastYear} voice={v} onOpen={() => navigate(`/simulation/${desk.ventureId}/report/${desk.lastYear!.year}`)} /> : (
          <Card><CardContent className="p-5">
            <p className="text-sm font-medium">Year one</p>
            <p className="text-sm text-muted-foreground mt-1">
              {desk.niche.premise} Nobody has heard of you yet — that is the first problem to solve.
            </p>
          </CardContent></Card>
        )}

        {/* What happened to the market, which is the thing people talk about. */}
        {desk.lastYear?.event && <EventCard event={desk.lastYear.event} />}

        {/*
          * And then the two that say why: what the five of you actually filed
          * and what it bought, and where that left everybody on the map. Both
          * only exist once there is a year behind you.
          */}
        {desk.lastYear && (
          <WhatTheTableDecided
            year={desk.lastYear.year}
            seats={desk.table.map((t) => ({ userId: t.userId, name: t.name, role: t.role, title: t.title, isYou: t.isYou }))}
            filed={desk.lastFiled?.decisions ?? null}
            auctions={desk.lastYear.auctions ?? []}
            standing={desk.standing ?? []}
            onOpen={() => navigate(`/simulation/${desk.ventureId}/report/${desk.lastYear!.year}`)}
          />
        )}
        {desk.lastYear && (desk.standing?.length ?? 0) > 0 && (
          <WhereTheMarketSits
            standing={desk.standing!}
            segments={desk.segments}
            cities={desk.cities}
            voice={desk.niche.voice}
          />
        )}
        {/*
          * 2. Where the company stands, as KPIs rather than a grid of equal
          * labels. Grouped by the question each answers — the money, the
          * customers, how good the product is, what is already on its way — so
          * a seat reads four things instead of fourteen, and the scores out of
          * a hundred get a bar, because "89" means more drawn against 100.
          */}
        <Card className="rounded-2xl nova-ring-soft" data-testid="card-company-kpis">
          <CardContent className="space-y-4 p-5">
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <Kpi label="Cash" value={compact(c.cash)} tone={c.cash < 0 ? "bad" : "plain"} />
              <Kpi label="Debt" value={compact(c.debt)} sub={`limit ${compact(c.creditLimit)}`} tone={c.debt > c.creditLimit * 0.8 ? "warn" : "plain"} />
              <Kpi
                label="You own"
                value={`${Math.round(c.founderShare * 100)}%`}
                sub={c.founderShare < 1 ? "the rest was sold to investors" : "nobody else has a claim"}
                tone={c.founderShare < 0.6 ? "warn" : "plain"}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {/* Customers against room, room including what the company owns (server's assetCapacity). */}
              <div className="rounded-xl border border-border bg-background/70 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{title(v.customers)}</p>
                <p className="text-xl sm:text-2xl font-extrabold tracking-tight tabular-nums">{c.customers.toLocaleString()}</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full nova-chip" style={{ width: `${Math.min(100, (c.customers / Math.max(1, c.capacity + (c.assetCapacity ?? 0))) * 100)}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {c.assetCapacity
                    ? `${v.capacityShort} ${(c.capacity + c.assetCapacity).toLocaleString()} (${c.assetCapacity.toLocaleString()} from what you own)`
                    : `${v.capacityShort} ${c.capacity.toLocaleString()}`}
                </p>
              </div>
              <Kpi
                label={`Price ${v.per}`}
                value={money(c.price)}
                sub={`costs ${money(c.unitCost)} each · ${money(Math.max(0, c.price - c.unitCost))} margin`}
                tone={c.price < c.unitCost ? "bad" : "plain"}
              />
            </div>

            {/*
              * Quality, brand and service are the engine's three words for three
              * things every market has and no market calls that. The number is
              * the same; the label under it is the market's own.
              */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Score label="Reputation" value={c.reputation} />
              <Score label="Quality" value={c.quality} sub={v.quality} />
              <Score label="Brand" value={c.brand} sub={v.brand} />
              <Score label="Service" value={c.service} sub={v.service} />
            </div>

            {c.bankruptSince !== null && (
              <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                Insolvent since year {c.bankruptSince}. The season does not end here — sell assets, cut seats, restructure, or take an offer.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold">Who you're up against</h3>
            <p className="text-xs text-muted-foreground mb-3">Open any of them to read who they are and where they can be taken.</p>
            <div className="space-y-3">
              {desk.rivals.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setOpenCompany(r.id)}
                  className="w-full flex items-start justify-between gap-4 text-left rounded-md -mx-2 px-2 py-1.5 hover-elevate active-elevate-2"
                  data-testid={`button-company-${r.id}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {r.name}
                      {r.kind === "player" && <Badge variant="outline" className="ml-2 text-[10px]">a team</Badge>}
                    </p>
                    {r.posturedAs && <p className="text-xs text-muted-foreground">{r.posturedAs}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm tabular-nums">{r.customers.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">at {money(r.price)}</p>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold">The market</h3>
            <p className="text-xs text-muted-foreground mb-3">What each segment weighs when it chooses, and what it expects of you this year.</p>
            <div className="space-y-3">
              {desk.segments.map((s) => (
                <div key={s.id}>
                  <div className="flex justify-between gap-3">
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="text-sm tabular-nums shrink-0">{s.yours.toLocaleString()} yours</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{s.description}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Pays around {money(s.referencePrice)} · {s.loyalty > 0.7 ? "very hard to move once settled" : s.loyalty > 0.4 ? "will switch for a reason" : "switches easily"}
                  </p>
                  <Criteria segment={s} company={c} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        </>
      )}

      {tab === "decisions" && (
        <>
        {/* Only for developers and for companies running their own season. */}
        {desk.canAdvance && desk.phase !== "finished" && desk.seasonId && (
          <AdvanceYearCard
            seasonId={desk.seasonId}
            ventureId={desk.ventureId}
            year={desk.year}
            totalYears={desk.totalYears}
            as={desk.canAdvance}
          />
        )}
        {/* When things are going badly, this is the most important thing on the page. */}
        {desk.distress.level !== "healthy" && (
          <DistressCard
            distress={desk.distress}
            isCeo={desk.yourRole === "ceo"}
            // The company's seats, not the people: a seat already dissolved still has somebody in the table list.
            seats={(desk.company.seats ?? desk.table.map((s) => s.role).filter(Boolean)) as Role[]}
            ventureId={desk.ventureId}
          />
        )}
        {/* Your own thing to win, and how last year's went. */}
        {desk.challenge && <ChallengeCard challenge={desk.challenge} last={desk.lastChallenge} />}
        {/* What the year's research bought, if this table went looking. */}
        {desk.ours && <OurNiche niche={desk.ours} customersWord={v.customers} />}

        {/*
          * The region on the table. Shown to every seat, not only the one
          * whose lever it is, because it is the one decision here the five of
          * them settle between them.
          */}
        {desk.expansion && <ExpansionVote data={desk.expansion} seats={desk.table} />}
        {/* 3. The decision. */}
        {desk.phase === "finished" ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">
            The season is over. Nothing left to decide — the last year's result is under Past.
          </CardContent></Card>
        ) : desk.yourRole && draft ? (
          <div className="space-y-3">
            {/* Yours: the one card on the desk that is this seat's to change, so it carries the ring. */}
            <Card className="rounded-2xl nova-ring" data-testid="card-your-decision">
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{desk.yourTitle}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{desk.yourLevers.join(" · ")}</p>
                    <NewLeversLine
                      fresh={desk.fields.filter((f) => f.unlocksIn === desk.year).map((f) => f.label)}
                      coming={desk.arrivingNextYear ?? []}
                    />
                    {desk.yourRole === "cto" && desk.productRisk && <ProductRiskLine risk={desk.productRisk} />}
                  </div>
                  {desk.submitted && (
                    <Badge variant="secondary" className="shrink-0" data-testid="badge-filed">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Filed
                    </Badge>
                  )}
                </div>

                <div className="mt-5 space-y-5">
                  {desk.fields.map((field) => (
                    <Field
                      key={field.id}
                      field={field}
                      role={desk.yourRole}
                      value={draft[field.id]}
                      error={errors[field.id]}
                      onChange={(v) => setDraft((d) => ({ ...d!, [field.id]: v }))}
                      cities={desk.cities}
                      isNew={field.unlocksIn === desk.year}
                      listPrice={field.kind === "tiers" ? Number(draft.price) : undefined}
                    />
                  ))}
                </div>

                {desk.yourRole === "cfo" && Number(draft.raiseAmount) > 0 && (
                  <p className="text-xs text-amber-600 mt-4" data-testid="text-dilution">
                    Raising {compact(Number(draft.raiseAmount))} against a company worth about {compact(desk.valuation)} leaves the
                    founders with roughly {Math.round((desk.company.founderShare * desk.valuation / (desk.valuation + Number(draft.raiseAmount))) * 100)}%
                    of whatever this becomes. It never has to be repaid, and it never comes back.
                  </p>
                )}
                {desk.yourRole === "cto" && desk.company.techDebt > 40 && (
                  <p className="text-xs text-amber-600 mt-4" data-testid="text-tech-debt">
                    The product owes itself {desk.company.techDebt}. Everything spent here buys{" "}
                    {desk.company.techDebtCost.product}% less than it would, and every unit costs{" "}
                    {desk.company.techDebtCost.unitCost}% more. Paying it down shows up in no number this year and in
                    every number after it.
                  </p>
                )}
                {desk.yourRole === "cto" && Number(draft.researchSpend) > 0 && (
                  <p className="text-xs text-muted-foreground mt-4" data-testid="text-research">
                    Roughly +{(saturate(Number(draft.researchSpend), 150_000) * 24 * desk.innovationPace).toFixed(1)} quality,
                    landing in two years. Shipping lands next year; research the year after — and buys more for the wait.
                  </p>
                )}

                <Button
                  className="w-full mt-6"
                  onClick={() => submit.mutate()}
                  disabled={submit.isPending}
                  data-testid="button-file-decision"
                >
                  {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {desk.submitted ? `Update ${period.of}'s decision` : `File ${period.of}'s decision`}
                </Button>
                <p className="text-[11px] text-muted-foreground text-center mt-2">
                  Changeable until the year resolves. Nothing is locked in before then.
                </p>
              </CardContent>
            </Card>

            {/* Notes on the draft stay with the form; the money and the warnings are pinned in the dock. */}
            {desk.preview.notes.map((note, i) => (
              <div key={i} className="rounded-lg bg-muted p-3 flex gap-2">
                <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">{note}</p>
              </div>
            ))}
          </div>
        ) : null}
        {/* The three rooms off this one: buying things, buying companies, and where you stand. */}
        <div className="grid gap-3 sm:grid-cols-3">
          {/* A whole card to press, like the manager's rail: the chip says what it is, the ring that it goes somewhere. */}
          <button
            type="button"
            onClick={() => navigate(`/simulation/${desk.ventureId}/market`)}
            className="group rounded-2xl nova-ring-soft nova-hover-glow p-4 text-left"
            data-testid="button-open-market"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl nova-chip"><Store className="h-4 w-4" /></span>
            <h3 className="mt-3 text-sm font-bold">The market</h3>
            <p className="mt-1 text-xs text-muted-foreground">Five things a {period.one}, and everyone bids blind.</p>
            <p className="mt-2 text-xs font-semibold text-primary group-hover:underline">Open →</p>
          </button>
          {/* A whole card to press, like the manager's rail: the chip says what it is, the ring that it goes somewhere. */}
          <button
            type="button"
            onClick={() => navigate(`/simulation/${desk.ventureId}/offers`)}
            className="group rounded-2xl nova-ring-soft nova-hover-glow p-4 text-left"
            data-testid="button-open-offers"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl nova-chip"><Handshake className="h-4 w-4" /></span>
            <h3 className="mt-3 text-sm font-bold">The boardroom</h3>
            <p className="mt-1 text-xs text-muted-foreground">Buy a rival, or take the money for yours.</p>
            <p className="mt-2 text-xs font-semibold text-primary group-hover:underline">Open →</p>
          </button>
          {/* A whole card to press, like the manager's rail: the chip says what it is, the ring that it goes somewhere. */}
          <button
            type="button"
            onClick={() => navigate(`/simulation/${desk.ventureId}/standings`)}
            className="group rounded-2xl nova-ring-soft nova-hover-glow p-4 text-left"
            data-testid="button-open-standings"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl nova-chip"><Trophy className="h-4 w-4" /></span>
            <h3 className="mt-3 text-sm font-bold">Standings</h3>
            <p className="mt-1 text-xs text-muted-foreground">Where you actually stand, incumbents included.</p>
            <p className="mt-2 text-xs font-semibold text-primary group-hover:underline">Open →</p>
          </button>
        </div>
        {/* 4. Everyone else. */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">The table</h3>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {desk.table.map((seat) => (
                /*
                 * A whole row, not a name with a link in it. The thing being
                 * asked for is "tell me about this person", and on a phone a
                 * four-character first name is not a target.
                 */
                <button
                  key={seat.userId}
                  type="button"
                  onClick={() => setOpenSeat(seat.userId)}
                  className="flex items-center gap-2.5 text-sm text-left rounded-md -mx-1.5 px-1.5 py-1 hover-elevate active-elevate-2"
                  data-testid={`button-seat-${seat.userId}`}
                >
                  {seat.filed
                    ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span className="font-medium truncate">{seat.isYou ? "You" : seat.name}</span>
                  <span className="text-muted-foreground text-xs truncate">{seat.title ?? "no seat"}</span>
                  {seat.person && (
                    <span
                      className={`text-[11px] tabular-nums shrink-0 ${seat.person.warning ? "text-amber-600" : "text-muted-foreground"}`}
                      title={seat.person.warning ? "Thinking about leaving. At 15 they resign." : "Loyalty: how far their decisions go."}
                      data-testid={`text-loyalty-${seat.role}`}
                    >
                      {seat.person.warning ? "⚠ " : ""}loyalty {seat.person.loyalty}
                    </span>
                  )}
                  {!seat.filed && <span className="text-xs text-muted-foreground ml-auto shrink-0">still deciding</span>}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
        </>
      )}

      {tab === "future" && (
        <>
        {/*
          * How many people will want you this year, next to the number that has
          * to be right about it. Shown to every seat, because the forecast is
          * the thing marketing moves and operations builds to — and the argument
          * between them is the one this card exists to have before the tick.
          */}
        {/*
          * The year as it stands — revenue, costs, profit, cash — redrawn as
          * teammates file and as this seat edits, with what the unfiled draft
          * here is doing to each number. Keyed on the table's filings so it
          * re-runs exactly when somebody files.
          */}
        <ProjectionPanel
          ventureId={id!}
          draft={draft}
          filedStamp={JSON.stringify(desk.filed ?? {})}
        />

        {desk.forecast && (
          <ForecastCard
            forecast={desk.forecast}
            voice={v}
            price={Number(desk.yourRole === "cmo" && draft ? draft.price : (desk.filed as any)?.cmo?.price ?? c.price)}
            /*
             * The room the company actually has this year. Capacity ordered now
             * opens next year, so the lever's value is next year's room — set
             * against next year's demand in the projection above, not here.
             * A cut is immediate, so the smaller of the two is what serves.
             */
            capacity={Math.min(c.capacity, Number(desk.yourRole === "coo" && draft ? draft.capacityTarget : (desk.filed as any)?.coo?.capacityTarget ?? c.capacity)) + (c.assetCapacity ?? 0)}
            idleCostPerUnit={desk.idleCostPerUnit}
            yours={desk.yourRole === "coo" ? "capacity" : desk.yourRole === "cmo" ? "price" : null}
          />
        )}
        {/* What is already in motion: the economy's turn, and the work that lands later (lag.ts). */}
        <Card className="rounded-2xl nova-ring-soft" data-testid="card-coming">
          <CardContent className="space-y-4 p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg nova-chip"><Telescope className="h-3.5 w-3.5" /></span>
              What's coming
            </h3>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="text-outlook">
              <span className="rounded-full nova-chip px-2.5 py-0.5 text-xs font-bold">Next year: {desk.economy.outlook}</span>
              {desk.economy.outlookMeans}
            </p>
            {/* What is already on its way — the lag made visible (lag.ts) — as a table rather than more tiles. */}
            {(c.pipeline > 0 || (c.pipelineLater ?? 0) > 0 || (c.brandPipeline ?? 0) > 0 || c.techDebt > 0) && (
              <div className="overflow-hidden rounded-xl border border-border bg-background/70" data-testid="table-on-its-way">
                <p className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">On its way</p>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    {c.pipeline > 0 && <WayRow label="Quality" value={`+${c.pipeline}`} when="lands next year" />}
                    {(c.pipelineLater ?? 0) > 0 && <WayRow label="Research" value={`+${c.pipelineLater}`} when="lands in two years" />}
                    {(c.brandPipeline ?? 0) > 0 && <WayRow label="Brand" value={`+${c.brandPipeline}`} when="the rest of this year's campaign" />}
                    {c.techDebt > 0 && (
                      <WayRow
                        label="Technical debt"
                        value={`${c.techDebt}`}
                        when={c.techDebtCost.product > 0 ? `product work buys ${c.techDebtCost.product}% less` : "nothing to worry about yet"}
                        warn={c.techDebt > 55}
                      />
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {!(c.pipeline > 0 || (c.pipelineLater ?? 0) > 0 || (c.brandPipeline ?? 0) > 0 || c.techDebt > 0) && (
              <p className="text-xs text-muted-foreground">Nothing already paid for is still on its way. What gets decided this year is what lands next.</p>
            )}
          </CardContent>
        </Card>
        </>
      )}

      <CompanyProfile ventureId={desk.ventureId} companyId={openCompany} onClose={() => setOpenCompany(null)} />
      <TeammateProfile ventureId={desk.ventureId} userId={openSeat} onClose={() => setOpenSeat(null)} />
    </Shell>
    </DeskPeriod.Provider>
    </DeskCurrency.Provider>
  );
}

/**
 * The seat's own objective, and how the last one went.
 *
 * Placed above the company's numbers rather than below the form, because this
 * is the one thing on the page that belongs to the person reading it. In a
 * five-person team the company's result is four other people too; this is what
 * tells them whether *they* played well.
 */
function ChallengeCard({ challenge, last }: { challenge: Challenge; last: ChallengeResult | null }) {
  const period = usePeriod();
  const { money, compact } = useMoney();
  return (
    <Card className="rounded-2xl nova-ring-soft">
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Yours {period.of}</p>
        </div>
        <h2 className="font-semibold text-lg mt-1.5" data-testid="text-challenge-title">{challenge.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{challenge.brief}</p>

        <div className="mt-4 space-y-2">
          {challenge.targets.map((t) => (
            <div key={t.id} className="flex items-start gap-2.5 text-sm">
              <Circle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
              <span>{t.label}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground mt-4 border-t border-border pt-3">
          <span className="font-medium text-foreground">If you do it: </span>{challenge.reward.label}
          {" "}Everyone on the team gets it — that is why they want you to win yours.
        </p>

        {last && (
          <div className="mt-3 rounded-lg bg-muted p-3">
            <p className="text-xs font-medium flex items-center gap-1.5">
              {last.outcome === "met" ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                : last.outcome === "partial" ? <Minus className="h-3.5 w-3.5 text-amber-600" />
                : <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />}
              Last year
            </p>
            <p className="text-xs text-muted-foreground mt-1">{last.note}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Where the company stands when it is not standing well, and what can be done.
 *
 * Every option states its cost before it is chosen, because all of them are
 * trades and a rescue that looked free would make the careful teams' caution
 * pointless. Shown to the whole table rather than only to the chief executive:
 * the person deciding how much to spend this year needs to know there is less
 * than a year of costs in reach, even though only one of them can act on it.
 */
function DistressCard({ distress, isCeo, seats, ventureId }: {
  distress: Desk["distress"]; isCeo: boolean; seats: Role[]; ventureId: string;
}) {
  const { money, compact } = useMoney();
  const { toast } = useToast();
  const [seat, setSeat] = useState<Role | "">("");

  const file = useMutation({
    mutationFn: (body: { kind: string; seat?: string }) =>
      apiRequest("POST", `/api/sim/ventures/${ventureId}/recovery`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/desk`] }),
    onError: (err: any) => toast({
      title: "Couldn't commit to that",
      description: err?.body?.message ?? "Try again.",
      variant: "destructive",
    }),
  });
  const clear = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/sim/ventures/${ventureId}/recovery`, undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/desk`] }),
    onError: (err) => {
      toast({ title: "Couldn't take that back", description: errorText(err), variant: "destructive" });
      // Whatever the server now holds is what the card should show.
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/desk`] });
    },
  });

  const severe = distress.level === "insolvent" || distress.level === "distressed";

  return (
    <Card className={severe ? "border-destructive" : "border-amber-500/60"}>
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <LifeBuoy className={`h-4 w-4 ${severe ? "text-destructive" : "text-amber-600"}`} />
          <h2 className="font-semibold" data-testid="text-distress">{distress.title}</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1.5">{distress.body}</p>

        {distress.covenant && (
          <div className="mt-3 rounded-lg bg-muted p-3">
            <p className="text-xs font-medium">The creditor's terms</p>
            <p className="text-xs text-muted-foreground mt-1">
              Spending capped at {compact(distress.covenant.spendCap)}. {distress.covenant.met} of 2 clear years —
              {distress.covenant.met >= 1 ? " one more and it lifts." : " two and it lifts."}
            </p>
          </div>
        )}

        {distress.filed ? (
          <div className="mt-4 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Committed: {distress.filed.kind.replace(/_/g, " ")}{distress.filed.seat ? ` (${distress.filed.seat})` : ""}</p>
            <p className="text-xs text-muted-foreground mt-1">It takes effect when the year resolves, before the year runs.</p>
            {isCeo && (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => clear.mutate()} data-testid="button-clear-recovery">
                Change your mind
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {distress.options.map((option) => (
              <div key={option.kind} className="rounded-lg border border-border p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">{option.title}</p>
                  <p className="text-xs text-muted-foreground tabular-nums shrink-0">frees ~{compact(option.raises)}</p>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{option.body}</p>
                <p className="text-xs text-destructive mt-1.5">{option.cost}</p>

                {isCeo && option.kind === "dissolve_seat" && (
                  <select
                    className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    value={seat}
                    onChange={(e) => setSeat(e.target.value as Role)}
                    data-testid="select-dissolve-seat"
                  >
                    <option value="">Which seat…</option>
                    {seats.filter((s) => s !== "ceo").map((s) => (
                      <option key={s} value={s}>{s.toUpperCase()}</option>
                    ))}
                  </select>
                )}

                {isCeo ? (
                  <Button
                    size="sm"
                    variant={option.kind === "rescue_raise" ? "destructive" : "outline"}
                    className="mt-2"
                    disabled={file.isPending || (option.kind === "dissolve_seat" && !seat)}
                    onClick={() => file.mutate({ kind: option.kind, seat: option.kind === "dissolve_seat" ? seat : undefined })}
                    data-testid={`button-recovery-${option.kind}`}
                  >
                    Commit to this
                  </Button>
                ) : null}
              </div>
            ))}
            {!isCeo && (
              <p className="text-xs text-muted-foreground">
                These change what the company is, so they are the chief executive's call. Worth a conversation.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The year's news.
 *
 * Above the company's own numbers, because it is the thing a team messages
 * each other about and the reason a plan made on day three has to survive day
 * seven. The advice is shown as prominently as the headline: an event a team
 * can do nothing about is a punishment, and every one of these has an answer.
 */
function EventCard({ event }: { event: NonNullable<Desk["lastYear"]>["event"] }) {
  if (!event) return null;
  return (
    <Card className={event.mine && event.scope === "company" ? "border-primary/50" : ""}>
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-muted-foreground" />
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {event.scope === "market" ? "The market, last year" : "About you, last year"}
          </p>
        </div>
        <h2 className="font-semibold text-lg mt-1.5" data-testid="text-event">{event.headline}</h2>
        <p className="text-sm text-muted-foreground mt-1">{event.body}</p>
        <p className="text-sm mt-3 border-t border-border pt-3">{event.advice}</p>
        <p className="text-[11px] text-muted-foreground mt-2">
          Things like this are drawn from where a company already stood. The year chose which one arrived, not whether one was owed.
        </p>
      </CardContent>
    </Card>
  );
}

type DeskTab = "past" | "decisions" | "future";

/**
 * The desk's three tabs, as the same tiles as a project's Ship / Systemize /
 * Funding bar (manager/section-bar.tsx): the open one filled with the nova
 * gradient, the others plain in a quiet border, each a big symbol with its
 * word. At the top of the page they are full tiles; once the desk scrolls they
 * fold to a slim row, because they ride in the pinned header and a hundred
 * pixels of tile on every screen of a long form is a hundred pixels of form.
 *
 * Past carries a dot until the seat has opened a year's result, because a year
 * resolves overnight and "something new is in there" is the one thing the
 * switch has to say by itself.
 */
function DeskTabs({ tab, onChange, ventureId, lastYear, year, filed, compact }: {
  tab: DeskTab; onChange: (t: DeskTab) => void; ventureId: string; lastYear: number | null;
  year: number; filed: boolean; compact: boolean;
}) {
  const key = `sim-desk-seen-${ventureId}`;
  const [seen, setSeen] = useState<number>(() => {
    try { return Number(localStorage.getItem(key) ?? 0); } catch { return 0; }
  });
  useEffect(() => {
    if (tab !== "past" || lastYear === null || seen >= lastYear) return;
    setSeen(lastYear);
    try { localStorage.setItem(key, String(lastYear)); } catch { /* private window: the dot just comes back */ }
  }, [tab, lastYear, seen, key]);
  const fresh = lastYear !== null && seen < lastYear && tab !== "past";
  const items: { id: DeskTab; label: string; sub: string; Icon: typeof History }[] = [
    { id: "past", label: "Past", sub: lastYear !== null ? `Year ${lastYear} results` : "Nothing yet", Icon: History },
    { id: "decisions", label: "Decisions", sub: filed ? "Filed" : `Year ${year} to file`, Icon: SlidersHorizontal },
    { id: "future", label: "Future", sub: "Projections", Icon: Telescope },
  ];
  return (
    <div role="tablist" aria-label="Desk" className="grid grid-cols-3 gap-2 sm:gap-3" data-testid="desk-tabs">
      {items.map(({ id, label, sub, Icon }) => {
        const active = tab === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={`group relative rounded-xl p-[2px] transition-shadow ${active ? "bg-background shadow-md shadow-emerald-500/15" : "bg-neutral-200 hover:bg-emerald-300 dark:bg-neutral-800"}`}
            data-testid={`tab-${id}`}
          >
            <div
              className={`flex h-full rounded-[10px] transition-all ${active ? NOVA_GRADIENT : "bg-background"} ${
                compact ? "items-center justify-center gap-1.5 px-2 py-1.5" : "min-h-[84px] flex-col items-center justify-center gap-1 px-2 py-2 sm:min-h-[96px]"
              }`}
            >
              <Icon
                className={`shrink-0 transition-all ${compact ? "h-4 w-4" : "h-7 w-7 sm:h-9 sm:w-9"} ${active ? "text-white drop-shadow-sm" : "text-muted-foreground group-hover:text-emerald-600"}`}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span className={`font-semibold leading-4 ${compact ? "text-xs sm:text-sm" : "text-xs sm:text-sm"} ${active ? "text-white drop-shadow-sm" : "text-foreground"}`}>{label}</span>
              {!compact && (
                <span className={`hidden text-[11px] leading-4 sm:block ${active ? "text-white/85" : "text-muted-foreground"}`}>{sub}</span>
              )}
            </div>
            {id === "past" && fresh && (
              <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-[#a855f7] ring-2 ring-background" aria-label="new result" data-testid="dot-past-new" />
            )}
          </button>
        );
      })}
    </div>
  );
}

function Shell({ title, subtitle, clock, onBack, nicheId, year, totalYears, tabs, rail, bottom, children }: {
  title: string; subtitle: string; clock?: string | null; onBack?: () => void; nicheId?: string;
  /** Past / Decisions / Future, under the company's name; told when the desk has scrolled, to fold. */
  tabs?: (compact: boolean) => React.ReactNode;
  /** For the season bar along the header's foot. */
  year?: number; totalYears?: number;
  /** Pinned beside the desk on a wide screen (the projection dock). */
  rail?: React.ReactNode;
  /** Pinned along the bottom on a phone. */
  bottom?: React.ReactNode;
  children: React.ReactNode;
}) {
  const look = nicheId ? lookOf(nicheId) : null;
  /*
   * Scrolled or not, from a sentinel above the header rather than a scroll
   * listener: the app scrolls inside its own panel, not the window, and an
   * observer sees the sentinel clipped out of that panel all the same.
   */
  const [compact, setCompact] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const seasonPct = year && totalYears ? Math.min(100, Math.max(0, ((year - 1) / totalYears) * 100)) : null;
  return (
    <div className={`mx-auto px-4 pb-8 ${rail ? "max-w-6xl" : "max-w-4xl"}`}>
      {/*
        * Pinned. Which company, which market, which year and how long is left
        * are the four things a seat needs on every screen of a long desk, and
        * they used to scroll away with the first swipe. Sticks to the top of
        * the scrolling panel, just under the app bar.
        */}
      <div ref={sentinel} className="h-px" aria-hidden />
      <header className="sticky top-0 z-30 -mx-4 bg-background/85 px-4 pb-3 pt-4 backdrop-blur-md" data-testid="desk-header">
        <div className="relative overflow-hidden rounded-2xl nova-ring-page nova-glow px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            {onBack && (
              <button onClick={onBack} className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="All companies" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {look && (
              <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl nova-chip sm:flex">
                <look.Icon className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-extrabold tracking-tight sm:text-xl" data-testid="text-company-name">{title}</h1>
              {/*
                * The market's mark next to its name. Fourteen days of opening
                * the same screen is a long time to be unsure at a glance which
                * of seven worlds you are in — and somebody may well be in two.
                */}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
                {look && <look.Icon className={`h-3.5 w-3.5 shrink-0 sm:hidden ${look.ink}`} />}
                <span className="truncate">{subtitle}</span>
              </p>
            </div>
            {clock && (
              <p className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-1 text-[11px] font-semibold tabular-nums sm:text-xs" data-testid="text-resolves">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="hidden sm:inline">{clock}</span>
                <span className="sm:hidden">{clock.replace(/ until this year resolves$/, "")}</span>
              </p>
            )}
          </div>
          {tabs && <div className={compact ? "mt-2" : "mt-3"}>{tabs(compact)}</div>}
          {/* How far through the season, as a line along the card's foot. */}
          {seasonPct !== null && (
            <div className="absolute inset-x-0 bottom-0 h-[3px] bg-muted/60" aria-hidden>
              <div className="h-full nova-chip" style={{ width: `${Math.max(seasonPct, 2)}%` }} />
            </div>
          )}
        </div>
      </header>

      <div className={rail ? "grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]" : undefined}>
        <div className="min-w-0 space-y-4">
          {children}
          {bottom}
        </div>
        {rail}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone = "plain" }: { label: string; value: string; sub?: string; tone?: "plain" | "warn" | "bad" }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600" : ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** A headline number, in the KPI cards. */
function Kpi({ label, value, sub, tone = "plain" }: { label: string; value: string; sub?: string; tone?: "plain" | "warn" | "bad" }) {
  return (
    <div className="rounded-xl border border-border bg-background/70 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl sm:text-2xl font-extrabold tracking-tight tabular-nums ${tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600" : ""}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** A score out of 100, drawn against the 100. */
function Score({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/70 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-lg font-extrabold tabular-nums">{value}</p>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full nova-chip" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      {sub && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** One row of "on its way". */
function WayRow({ label, value, when, warn }: { label: string; value: string; when: string; warn?: boolean }) {
  return (
    <tr>
      <td className="px-3 py-2 font-medium">{label}</td>
      <td className={`px-3 py-2 text-right font-bold tabular-nums ${warn ? "text-amber-600" : ""}`}>{value}</td>
      <td className="px-3 py-2 text-right text-xs text-muted-foreground">{when}</td>
    </tr>
  );
}

/** Last year, said plainly, with the engine's own explanation of why. */
function LastYear({ report, voice, onOpen }: { report: NonNullable<Desk["lastYear"]>; voice: Record<string, string>; onOpen: () => void }) {
  const { money, compact } = useMoney();
  const up = report.shareChange > 0.001;
  const down = report.shareChange < -0.001;
  return (
    <Card data-testid="card-last-year">
      <CardContent className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold" data-testid="text-last-year">Year {report.year}</h2>
          <Badge variant={report.rank <= 3 ? "default" : "secondary"} data-testid="text-last-rank">#{report.rank} in the market</Badge>
        </div>
        {/*
          * The way into the whole year. This card is the summary; the report
          * is where a team finds out which line lost the money and who took
          * the customers, which is what the next decision should be made on.
          */}
        <Button variant="outline" size="sm" className="mt-3 w-full sm:w-auto" onClick={onOpen} data-testid="button-open-report">
          Read the full year — the accounts, the cash, and who took whom
        </Button>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
          <Stat
            label="Share"
            value={`${(report.marketShare * 100).toFixed(1)}%`}
            sub={up ? `up ${(report.shareChange * 100).toFixed(1)}` : down ? `down ${Math.abs(report.shareChange * 100).toFixed(1)}` : "flat"}
          />
          <Stat label="Revenue" value={compact(report.revenue)} />
          <Stat label="Profit" value={compact(report.profit)} tone={report.profit < 0 ? "bad" : "plain"} />
          {/*
            * The number nobody wants to see, named as the thing it actually
            * was: orders refused for want of an airframe, people who looked at
            * the queue and left, players who sat in a login queue and refunded.
            */}
          <Stat
            label="Turned away"
            value={report.turnedAway.toLocaleString()}
            sub={report.turnedAway > 0 ? voice.turnedAway : undefined}
            tone={report.turnedAway > 0 ? "warn" : "plain"}
          />
        </div>

        <YearDetails report={report} up={up} down={down} />
      </CardContent>
    </Card>
  );
}

/**
 * What happened, line by line: the market's wins and losses, the engine's own
 * explanation of the year, what expired, how each seat's objective went.
 *
 * Folded away until asked for. It is a dozen sentences, all true and all
 * worth reading once — but it sat between the year's numbers and the decision
 * about next year, so everyone scrolled past it every day to get to the form.
 * The count says how much is in there without anyone having to open it.
 */
function YearDetails({ report, up, down }: { report: NonNullable<Desk["lastYear"]>; up: boolean; down: boolean }) {
  const { money, compact } = useMoney();
  const [open, setOpen] = useState(false);
  const market = report.market ?? [];
  /*
   * Who didn't file (absenceNote, season.ts) stays out of the fold. It is about
   * the table rather than the market, and the seat it most needs to reach is
   * the one that would never think to open "what happened".
   */
  const absent = report.notes.filter((n) => /^(No decisions came in from|Nobody filed decisions)/.test(n));
  const notes = report.notes.filter((n) => !absent.includes(n));
  const count = market.length + notes.length;
  const absentLines = absent.map((note, i) => (
    <p key={i} className="mt-4 flex gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400" data-testid="text-absent-seats">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {note}
    </p>
  ));
  if (count === 0) return <>{absentLines}<p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">A quiet year.</p></>;
  return (
    <>
    {absentLines}
    <div className={`mt-4 rounded-xl ${open ? "nova-ring-soft" : "border border-border"}`} data-testid="year-details">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
        aria-expanded={open}
        data-testid="button-year-details"
      >
        <span className="text-sm font-semibold">What happened in Year {report.year}</span>
        <span className="flex items-center gap-2">
          <span className="rounded-full nova-chip px-2 py-0.5 text-[11px] font-bold tabular-nums">{count}</span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-3">
          {market.length > 0 && (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Store className="h-3.5 w-3.5" /> At the market</p>
              {market.map((m, i) => (
                <p key={i} className={`text-sm ${m.kind === "won" || m.kind === "sold" ? "text-foreground" : "text-muted-foreground"}`} data-testid={`text-market-${m.kind}`}>
                  {m.text}
                </p>
              ))}
            </div>
          )}
          {notes.length > 0 && (
            <div className="space-y-2">
              {notes.map((note, i) => (
                <p key={i} className="flex gap-2 text-sm text-muted-foreground">
                  {up ? <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    : down ? <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    : <Minus className="mt-0.5 h-4 w-4 shrink-0" />}
                  {note}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}

/**
 * One lever.
 *
 * Money fields get step buttons as well as a box. Typing "2000000" on a phone
 * is miserable and error-prone in a way that matters here — a stray zero is
 * a decision nobody meant to make.
 */
/**
 * What a decision gives you, and what it takes.
 *
 * The marketplace in this same game already reads `+6 brand`, `+231,600
 * capacity`, `12% off every unit`, and you can compare two listings in a
 * second. The decision desk had a paragraph per lever instead, and people
 * could not answer the one question they were actually asking: if I do this,
 * what happens? So the consequences get the marketplace's treatment — short
 * lines, scannable, two columns of meaning.
 *
 * The difference from the marketplace is that both halves are always drawn.
 * A shop sells you upside; a seat at this table is a trade every time, and
 * hiding the cost under the fold would make this a worse screen than the
 * paragraph it replaced. `shared/simulation/lever-outcomes.ts` holds the
 * copy, and a test there refuses a lever that claims to cost nothing.
 */
function Trade({ outcome, tight }: { outcome: Outcome | null; tight?: boolean }) {
  if (!outcome) return null;
  return (
    <div className={tight ? "mt-1.5 space-y-0.5" : "mt-2 mb-2 space-y-0.5"} data-testid="lever-trade">
      {outcome.up.map((line) => (
        <p key={line} className={`flex items-start gap-1.5 ${tight ? "text-[11px]" : "text-xs"} text-emerald-700 dark:text-emerald-400`}>
          <ArrowUpRight className="h-3 w-3 mt-[3px] shrink-0" />
          <span>{line}</span>
        </p>
      ))}
      {outcome.down.map((line) => (
        <p key={line} className={`flex items-start gap-1.5 ${tight ? "text-[11px]" : "text-xs"} text-amber-700 dark:text-amber-500`}>
          <ArrowDownRight className="h-3 w-3 mt-[3px] shrink-0" />
          <span>{line}</span>
        </p>
      ))}
    </div>
  );
}

function Field({ field, role, value, error, onChange, cities, isNew, listPrice }: {
  field: LeverField; role: Role | null; value: any; error?: string; onChange: (v: any) => void;
  cities?: Desk["cities"];
  /** Arrived this year (see UNLOCKS in shared/simulation/responsibilities.ts). */
  isNew?: boolean;
  /** For price tiers: what a segment with no tier pays. */
  listPrice?: number;
}) {
  const { money, compact } = useMoney();
  const badge = isNew ? <Badge variant="secondary" className="ml-2 text-[10px] align-middle" data-testid={`badge-new-${field.id}`}>New this year</Badge> : null;

  /*
   * A number for each of several things: a price per segment, or a share of
   * the budget per seat. For tiers an empty row is a real answer — that
   * segment pays the list price — and nought is a free tier, so the two are
   * never confused. For the split, the rows are summed where they are typed,
   * because the one rule is that they cannot come to more than 100%.
   */
  /*
   * One answer per seat — easy, fair or aggressive — for the chief
   * executive's targets. Each seat's row says how loyal it is, because that
   * is what an aggressive target is spending.
   */
  if (field.kind === "levels") {
    const map: Record<string, string> = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return (
      <div>
        <Label className="text-sm font-medium">{field.label}{badge}</Label>
        <p className="text-xs text-muted-foreground mt-0.5">{field.help}</p>
        <Trade outcome={leverOutcome(role, field.id)} />
        <div className="space-y-2">
          {(field.options ?? []).map((o) => (
            <div key={o.value} className="rounded-lg border p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{o.label}</p>
                  <p className="text-[11px] text-muted-foreground">{o.help}</p>
                  <Trade outcome={optionOutcome(role, field.id, o.value)} tight />
                </div>
                <div className="flex gap-1" role="radiogroup" aria-label={`${field.label}: ${o.label}`}>
                  {(field.choices ?? []).map((c) => {
                    const chosen = (map[o.value] ?? field.defaultChoice) === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        role="radio"
                        aria-checked={chosen}
                        title={c.help}
                        onClick={() => onChange({ ...map, [o.value]: c.value })}
                        className={`rounded-md border px-2.5 py-1 text-xs transition ${chosen ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground hover:border-muted-foreground/40"}`}
                        data-testid={`level-${field.id}-${o.value}-${c.value}`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
        {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
      </div>
    );
  }

  if (field.kind === "tiers" || field.kind === "allocation") {
    const map: Record<string, any> = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const tiers = field.kind === "tiers";
    const total = Object.values(map).reduce((sum: number, v) => sum + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
    const set = (key: string, raw: string) => {
      const next = { ...map };
      if (raw === "") delete next[key];
      else next[key] = Math.max(0, Math.min(field.max ?? Infinity, Number(raw)));
      onChange(next);
    };
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <Label className="text-sm font-medium">{field.label}{badge}</Label>
          {!tiers && (
            <span className={`text-xs tabular-nums ${total > 100 ? "text-destructive" : "text-muted-foreground"}`} data-testid={`text-${field.id}-total`}>
              {Math.round(total)}% of 100%
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{field.help}</p>
        <Trade outcome={leverOutcome(role, field.id)} />
        <div className="space-y-2">
          {(field.options ?? []).map((o) => {
            const has = map[o.value] !== undefined && map[o.value] !== "";
            return (
              <div key={o.value} className="flex items-center gap-3 rounded-lg border p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{o.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {tiers
                      ? has
                        ? Number(map[o.value]) === 0 ? "Free: advertising money and word of mouth, and every paying tier leaks towards it." : o.help
                        : `No tier: pays the list price${Number.isFinite(listPrice) ? ` of ${money(listPrice!)}` : ""}.`
                      : o.help}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={has ? map[o.value] : ""}
                    placeholder={tiers ? "list" : "0"}
                    min={0}
                    max={field.max}
                    step={field.step ?? 1}
                    onChange={(e) => set(o.value, e.target.value)}
                    className="w-24 tabular-nums"
                    aria-label={`${field.label}: ${o.label}`}
                    data-testid={`input-${field.id}-${o.value}`}
                  />
                  <span className="w-3 text-xs text-muted-foreground">{tiers ? "" : "%"}</span>
                </div>
              </div>
            );
          })}
        </div>
        {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
      </div>
    );
  }

  if (field.kind === "cities") {
    const open = new Set<string>(Array.isArray(value) ? value : []);
    return (
      <div>
        <Label className="text-sm font-medium">{field.label}</Label>
        <p className="text-xs text-muted-foreground mt-0.5">{field.help}</p>
        <Trade outcome={leverOutcome(role, field.id)} />
        <div className="space-y-1.5">
          {(cities ?? []).map((city) => {
            const selected = open.has(city.id);
            return (
              <button
                key={city.id}
                type="button"
                onClick={() => {
                  const next = new Set(open);
                  // Somewhere you already sell cannot be closed — the customers
                  // are there and leaving them is not a lever this game offers.
                  if (city.open) return;
                  selected ? next.delete(city.id) : next.add(city.id);
                  onChange(Array.from(next));
                }}
                className={`w-full text-left rounded-lg border p-2.5 transition ${selected ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"} ${city.open ? "opacity-90" : ""}`}
                data-testid={`city-${city.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{city.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {city.open ? "already open" : `${compact(city.entryCost)} to open`} · {Math.round(city.weight * 100)}% of the market
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{city.note}</p>
              </button>
            );
          })}
        </div>
        {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
      </div>
    );
  }

  if (field.kind === "segment" || field.kind === "choice") {
    return (
      <div>
        <Label className="text-sm font-medium">{field.label}{badge}</Label>
        <p className="text-xs text-muted-foreground mt-0.5">{field.help}</p>
        <Trade outcome={leverOutcome(role, field.id)} />
        {(field.options?.length ?? 0) === 0 && (
          /*
           * Why there is nothing to choose, in this lever's own words. Every
           * empty choice used to say "every seat is filled" — which is true of
           * bringing a seat back and nonsense under "Answer the shock", where
           * it read as though the game had lost track of itself.
           */
          <p className="text-xs text-muted-foreground">
            {field.id === "rehire" ? "Nothing to choose here — every seat is filled."
              : field.id === "shockAnswer" ? "Nothing happened this year that needs an answer."
                : field.id === "overrule" ? "Nothing to overrule — every seat's own decision stands."
                  : field.id === "replaceSeat" ? "Nobody to replace — the table is as you want it."
                    : field.id === "deals" ? "No offers on the table this year."
                      : field.id === "expand" ? "Nowhere new announced this year, or you are already committed to one."
                        : field.id === "expandVote" ? "No region on the table — operations has to put one up."
                      : "Nothing to choose here this year."}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {field.options?.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={`text-left rounded-lg border p-3 transition ${value === o.value ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"}`}
              data-testid={`option-${field.id}-${o.value}`}
            >
              <p className="text-sm font-medium">{o.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{o.help}</p>
              <Trade outcome={optionOutcome(role, field.id, o.value)} tight />
            </button>
          ))}
        </div>
        {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
      </div>
    );
  }

  const step = field.step ?? 1;
  const n = Number(value ?? 0);
  const nudge = (by: number) => onChange(Math.max(field.min ?? 0, Math.min(field.max ?? Infinity, n + by)));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-sm font-medium" htmlFor={`field-${field.id}`}>{field.label}{badge}</Label>
        {field.kind === "percent"
          ? <span className="text-xs text-muted-foreground tabular-nums">{n}%</span>
          : field.kind !== "count" && <span className="text-xs text-muted-foreground tabular-nums">{compact(n)}</span>}
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">{field.help}</p>
        <Trade outcome={leverOutcome(role, field.id)} />
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => nudge(-step)} data-testid={`button-${field.id}-down`}>−</Button>
        <Input
          id={`field-${field.id}`}
          type="number"
          inputMode="numeric"
          value={value ?? 0}
          min={field.min}
          max={field.max}
          step={step}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
          className="tabular-nums"
          data-testid={`input-${field.id}`}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => nudge(step)} data-testid={`button-${field.id}-up`}>+</Button>
      </div>
      {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
    </div>
  );
}


/**
 * What a segment weighs, and whether you clear what it expects.
 *
 * The weights are the engine's own — the exponents it chooses by — shown as one
 * bar so the shape is readable at a glance: a segment that is mostly price is
 * mostly one colour. Beneath them, this year's floors with a tick or a cross,
 * because "long-haulers expect quality of 55" means nothing until it sits next
 * to "you have 41".
 */
function Criteria({ segment: s, company: c }: {
  segment: Desk["segments"][number];
  company: Desk["company"];
}) {
  const { money, compact } = useMoney();
  const parts: { key: keyof typeof s.weights; label: string; tone: string }[] = [
    { key: "price", label: "price", tone: "bg-sky-500" },
    { key: "quality", label: "quality", tone: "bg-violet-500" },
    { key: "brand", label: "brand", tone: "bg-amber-500" },
    { key: "service", label: "service", tone: "bg-emerald-500" },
  ];
  return (
    <div className="mt-2 space-y-1.5" data-testid={`criteria-${s.id}`}>
      <div className="flex h-2 rounded-full overflow-hidden" aria-hidden>
        {parts.map((p) => <div key={p.key} className={p.tone} style={{ width: `${s.weights[p.key]}%` }} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-full ${p.tone}`} /> {p.label} {s.weights[p.key]}%
          </span>
        ))}
      </div>
      <p className="text-xs">{s.taste}</p>
      <div className="flex flex-wrap gap-1.5">
        {s.floors.map((f) => {
          const have = c[f.axis];
          const ok = have >= f.atLeast;
          return (
            <Badge key={f.axis} variant={ok ? "secondary" : "destructive"} className="text-[10px] font-normal" data-testid={`floor-${s.id}-${f.axis}`}>
              expects {f.axis} {f.atLeast}+ · you {have} {ok ? "✓" : "✗"}
            </Badge>
          );
        })}
        <Badge variant={c.price <= s.priceCeiling ? "outline" : "destructive"} className="text-[10px] font-normal">
          stops listening above {money(s.priceCeiling)} · you {money(c.price)}
        </Badge>
      </div>
    </div>
  );
}

/**
 * The forecast, and the bet capacity makes against it.
 *
 * Demand is read off the forecast's price curve at whatever price is on the
 * table — the marketing seat's draft as they type, everyone else's view of
 * what marketing filed — so moving the price moves the range while a hand is
 * still on the lever. The capacity verdict is then priced both ways, in money:
 * what the empty shelves cost if the year comes in low, and what walks to a
 * rival if it comes in high. That is the whole decision, and until now it had
 * no cost on one side.
 */
function ForecastCard({ forecast, voice, price, capacity, idleCostPerUnit, yours }: {
  forecast: Forecast; voice: Record<string, string>; price: number; capacity: number; idleCostPerUnit: number;
  yours: "capacity" | "price" | null;
}) {
  const { money, compact } = useMoney();
  const curve = [...forecast.curve].sort((a, b) => a.price - b.price);
  const at = (p: number): number => {
    if (!Number.isFinite(p) || curve.length === 0) return forecast.likely;
    if (p <= curve[0].price) return curve[0].likely;
    if (p >= curve[curve.length - 1].price) return curve[curve.length - 1].likely;
    for (let i = 1; i < curve.length; i++) {
      if (p <= curve[i].price) {
        const a = curve[i - 1], b = curve[i];
        const t = (p - a.price) / Math.max(1, b.price - a.price);
        return Math.round(a.likely + (b.likely - a.likely) * t);
      }
    }
    return forecast.likely;
  };
  const likely = at(price);
  const live: Forecast = {
    ...forecast,
    likely,
    low: Math.round(likely * (1 - forecast.band)),
    high: Math.round(likely * (1 + forecast.band)),
  };
  const risk = capacityRisk({ capacity, forecast: live, price, idleCostPerUnit });
  /*
   * The verdict in two words and a line, with an icon: colour is never the
   * only thing saying whether this is fine.
   */
  const verdict = {
    short: { label: "Short", text: "Even an ordinary year turns people away.", tone: "bad" },
    tight: { label: "Tight", text: "A good year will outrun it.", tone: "warn" },
    balanced: { label: "Built for the range", text: "Room for most of what the year could bring.", tone: "good" },
    generous: { label: "Generous", text: "Room for a great year, paid for in an ordinary one.", tone: "warn" },
    idle: { label: "Far too much", text: "Most of it will sit empty and cost money.", tone: "bad" },
  }[risk.verdict];
  const toneClass = { good: "text-primary", warn: "text-amber-600", bad: "text-destructive" }[verdict.tone];
  const VerdictIcon = verdict.tone === "good" ? CheckCircle2 : AlertTriangle;

  /*
   * One scale for the range bar and the capacity marker. When the room is far
   * past anything the year could bring, a shared scale squashes the range into
   * a sliver at the left; zoom to the range instead and pin the room marker to
   * the edge, labelled as off the scale.
   */
  const roomOffScale = capacity > live.high * 2.5;
  const top = (roomOffScale ? live.high * 1.25 : Math.max(live.high, capacity) * 1.1) || 1;
  const x = (n: number) => `${Math.min(100, (n / top) * 100)}%`;

  /*
   * Said with numbers rather than sentences. It used to be four paragraphs
   * around three figures; the figures are the forecast, so they lead, and the
   * explanations became a legend, two tiles and one line of small print.
   */
  return (
    <Card className="rounded-2xl nova-ring-soft" data-testid="card-forecast">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg nova-chip"><Gauge className="h-3.5 w-3.5" /></span>
            The forecast
          </h3>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums">at {money(price)} {voice.per}</span>
        </div>

        <div>
          <p className="text-3xl font-extrabold tracking-tight tabular-nums" data-testid="text-forecast-likely">{live.likely.toLocaleString()}</p>
          <p className="text-sm text-muted-foreground" data-testid="text-forecast-range">
            {voice.customers} most likely · between {live.low.toLocaleString()} and {live.high.toLocaleString()} {voice.customers}
          </p>
        </div>

        <div>
          <div className="relative h-9" aria-hidden>
            <div className="absolute top-3.5 h-2.5 w-full rounded-full bg-muted" />
            <div className="absolute top-3.5 h-2.5 rounded-full nova-chip opacity-70" style={{ left: x(live.low), width: `calc(${x(live.high)} - ${x(live.low)})` }} />
            <div className="absolute top-2.5 h-[18px] w-[3px] rounded-full bg-foreground/80" style={{ left: x(live.likely) }} />
            <div className={`absolute top-0 h-9 w-0.5 ${roomOffScale ? "bg-foreground/40" : "bg-foreground"}`} style={roomOffScale ? { right: 0 } : { left: x(capacity) }} />
          </div>
          {/* The legend, where the paragraph explaining the bar used to be. */}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full nova-chip opacity-70" /> likely range</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-[3px] rounded-full bg-foreground/80" /> most likely</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-foreground" /> your room: {Math.round(capacity).toLocaleString()}{roomOffScale && " (off the scale)"}</span>
          </div>
          {yours === "capacity" && (
            <p className="mt-1 text-[11px] text-muted-foreground">Room you order now opens next year — size it to next year's demand.</p>
          )}
        </div>

        <p className={`flex flex-wrap items-center gap-1.5 text-sm ${toneClass}`} data-testid="text-capacity-verdict">
          <VerdictIcon className="h-4 w-4 shrink-0" />
          <span className="font-bold">{verdict.label}.</span>
          <span className="text-muted-foreground">{verdict.text}</span>
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-background/70 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">If the year comes in low</p>
            <p className="mt-0.5 text-lg font-extrabold tabular-nums">{risk.idleAtLow.toLocaleString()} <span className="text-xs font-medium text-muted-foreground">idle</span></p>
            <p className="text-xs text-muted-foreground">costing {money(risk.idleCostAtLow)}</p>
          </div>
          <div className="rounded-xl border border-border bg-background/70 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">If the year comes in high</p>
            <p className="mt-0.5 text-lg font-extrabold tabular-nums">{risk.shortAtHigh.toLocaleString()} <span className="text-xs font-medium text-muted-foreground">turned away</span></p>
            <p className="text-xs text-muted-foreground">{money(risk.revenueLostAtHigh)} of sales to {voice.rivals}</p>
          </div>
        </div>

        {/* The price curve, so "what if we charged a bit more" is answered before anyone asks. */}
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">At other prices</p>
          <div className="flex gap-1.5 overflow-x-auto">
            {curve.map((pt) => {
              const here = Math.abs(pt.price - price) < 1;
              return (
                <div key={pt.price} className={`shrink-0 rounded-lg px-2.5 py-1.5 text-center text-[11px] ${here ? "nova-chip" : "border border-border"}`}>
                  <p className={here ? "font-semibold" : "text-muted-foreground"}>{money(pt.price)}</p>
                  <p className="font-bold tabular-nums">{pt.likely.toLocaleString()}</p>
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">A range, because it can't see what the other teams decide tonight.</p>
      </CardContent>
    </Card>
  );
}

/**
 * What arrived on this seat this year, and what arrives next. A new control
 * that simply appears is easy to scroll past; one announced a year ahead is
 * one the table has already started arguing about.
 */
function NewLeversLine({ fresh, coming }: { fresh: string[]; coming: string[] }) {
  if (fresh.length === 0 && coming.length === 0) return null;
  const list = (xs: string[]) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  return (
    <p className="text-xs mt-1.5" data-testid="text-new-levers">
      {fresh.length > 0 && <span className="font-medium text-primary">New this year: {list(fresh)}. </span>}
      {coming.length > 0 && <span className="text-muted-foreground">Next year this seat also gets {list(coming)}.</span>}
    </p>
  );
}

interface ProductRisk {
  security: number;
  data: number;
  breachChance: number;
  outageChance: number;
  features: { id: string; name: string; live: boolean; flopped: boolean; lands: number }[];
}

/**
 * What the technology seat is carrying: how exposed the company is, and what
 * its bets have come to. A breach that didn't happen gets nobody any credit,
 * so the odds are said out loud where the seat that lowers them can see them.
 */
function ProductRiskLine({ risk }: { risk: ProductRisk }) {
  const live = risk.features.filter((f) => f.live).map((f) => f.name);
  const coming = risk.features.filter((f) => !f.live && !f.flopped).map((f) => f.name);
  return (
    <p className="text-xs text-muted-foreground mt-1.5" data-testid="text-product-risk">
      Security {risk.security} · data {risk.data} · breach chance {risk.breachChance}% · outage chance {risk.outageChance}%
      {live.length > 0 && <> · live: {live.join(", ")}</>}
      {coming.length > 0 && <> · coming: {coming.join(", ")}</>}
    </p>
  );
}


/**
 * The niche this table went and found.
 *
 * A year of research money bought these people, and until now nothing on the
 * screen said so. Three things it has to answer, in the order a table asks
 * them: who are they, how long do we have them to ourselves, and has anybody
 * else turned up.
 *
 * The last one is the one that stings, so it is said plainly rather than
 * buried: somebody thinking the same thing at the same time is the most
 * ordinary event in a market and the most surprising one to be on the
 * receiving end of.
 */
function OurNiche({ niche, customersWord }: {
  niche: NonNullable<Desk["ours"]>;
  customersWord: string;
}) {
  const { money, compact } = useMoney();
  const shared = niche.sharedWith.length > 0;
  return (
    <Card className="rounded-2xl" data-testid="card-our-niche">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Crosshair className="h-4 w-4 text-muted-foreground shrink-0" />
              <h2 className="font-semibold truncate">{niche.name}</h2>
              {shared
                ? <Badge variant="secondary" data-testid="badge-niche-shared">Shared</Badge>
                : niche.headStartLeft > 0
                  ? <Badge data-testid="badge-niche-yours">Yours for now</Badge>
                  : <Badge variant="outline" data-testid="badge-niche-open">Everybody knows</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Found in year {niche.foundInYear}, inside {niche.from.toLowerCase()}.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
          <Stat label={`These ${customersWord}`} value={compact(niche.people)} />
          <Stat label="Yours" value={compact(niche.held)}
            sub={niche.people > 0 ? `${Math.round((niche.held / niche.people) * 100)}% of them` : undefined} />
          <Stat label="They pay" value={`+${niche.premium}%`} sub="against the segment they came from" />
          <Stat
            label="Head start"
            value={niche.headStartLeft > 0 ? `${niche.headStartLeft} year${niche.headStartLeft === 1 ? "" : "s"}` : "Gone"}
            sub={niche.headStartLeft > 0 ? "before everybody notices" : "an ordinary segment now"}
          />
        </div>

        {shared && (
          <p className="text-xs text-amber-600 mt-3" data-testid="text-niche-shared">
            {niche.sharedWith.join(" and ")} went looking in the same place and came back with the same
            people. Neither of you has a head start on the other — you are both selling to them now.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

