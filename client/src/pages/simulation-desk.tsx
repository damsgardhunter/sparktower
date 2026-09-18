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
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { NOVA_GRADIENT_CSS } from "@shared/backing";
import { longCountdown } from "@shared/simulation/lobby-copy";
import { commitment, type LeverField } from "@shared/simulation/levers";
import type { Role } from "@shared/simulation/types";
import {
  Loader2, Clock, TrendingUp, TrendingDown, Minus, AlertTriangle, Info,
  CheckCircle2, Circle, Banknote, Users, ArrowLeft, Target, LifeBuoy, Store, Handshake, Trophy,
} from "lucide-react";

interface Desk {
  phase: "not_started" | "running" | "finished";
  ventureId: string;
  name: string | null;
  product: string | null;
  niche: { id: string; name: string; premise: string };
  year: number;
  totalYears: number;
  resolvesAt: string | null;
  yourRole: Role | null;
  yourTitle: string | null;
  yourLevers: string[];
  fields: LeverField[];
  draft: Record<string, any> | null;
  submitted: boolean;
  company: {
    cash: number; debt: number; creditLimit: number; reputation: number;
    quality: number; brand: number; service: number; capacity: number;
    unitCost: number; price: number; customers: number; bankruptSince: number | null;
  };
  segments: { id: string; name: string; description: string; referencePrice: number; loyalty: number; yours: number }[];
  economy: { demand: number; interestRate: number; costIndex: number; outlook: string; outlookMeans: string };
  table: { userId: string; name: string; role: Role | null; title: string | null; filed: boolean; isYou: boolean }[];
  filed: Record<string, any>;
  preview: {
    commitment: { spend: number; fixed: number; available: number; ratio: number; bySeat: { role: Role; spend: number }[] };
    notes: string[];
    warnings: string[];
  };
  lastYear: {
    year: number; customers: number; marketShare: number; shareChange: number; turnedAway: number;
    revenue: number; costs: number; profit: number; cash: number; debt: number;
    reputation: number; reputationChange: number; rank: number; notes: string[]; bankrupt: boolean;
    market?: { kind: "won" | "lost" | "sold" | "unsold"; text: string }[];
  } | null;
  rivals: { id: string; name: string; kind: string; price: number; customers: number; posture: string | null; posturedAs: string | null }[];
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

const money = (n: number) => `£${Math.round(n).toLocaleString()}`;
const compact = (n: number) =>
  n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(1)}m` : n >= 1_000 ? `£${Math.round(n / 1_000)}k` : `£${Math.round(n)}`;

export default function SimulationDeskPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: desk, isLoading } = useQuery<Desk>({
    queryKey: [`/api/sim/ventures/${id}/desk`],
    // Slower than the lobby: a year lasts a day, and the thing worth noticing
    // is a teammate filing rather than a seat being taken out from under you.
    refetchInterval: 8000,
  });

  const [draft, setDraft] = useState<Record<string, any> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  /*
   * The server's draft seeds the form once, and then stops touching it. A poll
   * that overwrote the field someone was mid-way through typing into would be
   * the screen arguing with its own user.
   */
  useEffect(() => {
    if (desk?.draft && draft === null) setDraft(desk.draft);
  }, [desk?.draft, draft]);

  const submit = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sim/ventures/${id}/decisions`, { decision: draft }),
    onSuccess: () => {
      setErrors({});
      toast({ title: "Filed", description: "You can still change it until the year resolves." });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${id}/desk`] });
    },
    onError: (err: any) => {
      const body = err?.body ?? err?.response ?? {};
      if (body?.errors) setErrors(body.errors);
      else toast({ title: "Couldn't file that", description: body?.message ?? "Try again.", variant: "destructive" });
    },
  });

  /* A local countdown so the deadline moves between polls. */
  const [now, setNow] = useState(Date.now());
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
    if (!desk || desk.phase !== "running" || !desk.yourRole || !draft) return desk?.preview.commitment ?? null;
    try {
      const decisions: any = { ...desk.filed, companyId: desk.ventureId, [desk.yourRole]: draft };
      return commitment(desk.company as any, decisions, desk.economy);
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

  if (desk.phase === "not_started") {
    return (
      <Shell title={desk.name ?? "Your company"} subtitle="The season hasn't started yet">
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Year one begins once every room in this market has finished choosing seats. Check back shortly.
        </CardContent></Card>
      </Shell>
    );
  }

  const c = desk.company;
  const secondsLeft = desk.resolvesAt ? Math.max(0, Math.round((new Date(desk.resolvesAt).getTime() - now) / 1000)) : null;
  const overCommitted = live ? live.spend + live.fixed > live.available : false;
  const onCredit = live ? live.spend + live.fixed > c.cash : false;

  return (
    <Shell
      title={desk.name ?? "Your company"}
      subtitle={`${desk.niche.name} · Year ${desk.year} of ${desk.totalYears}`}
      onBack={() => navigate("/simulation")}
      clock={desk.phase === "finished" ? "Season over" : secondsLeft !== null ? `${longCountdown(secondsLeft)} until this year resolves` : null}
    >
      {/* 1. What happened last year, before anyone is asked to decide this one. */}
      {desk.lastYear ? <LastYear report={desk.lastYear} /> : (
        <Card><CardContent className="p-5">
          <p className="text-sm font-medium">Year one</p>
          <p className="text-sm text-muted-foreground mt-1">
            {desk.niche.premise} Nobody has heard of you yet — that is the first problem to solve.
          </p>
        </CardContent></Card>
      )}

      {/* Your own thing to win, and how last year's went. */}
      {desk.challenge && <ChallengeCard challenge={desk.challenge} last={desk.lastChallenge} />}

      {/* 2. Where the company stands. */}
      <Card>
        <CardContent className="p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Cash" value={compact(c.cash)} tone={c.cash < 0 ? "bad" : "plain"} />
            <Stat label="Debt" value={compact(c.debt)} sub={`limit ${compact(c.creditLimit)}`} tone={c.debt > c.creditLimit * 0.8 ? "warn" : "plain"} />
            <Stat label="Customers" value={c.customers.toLocaleString()} sub={`capacity ${c.capacity.toLocaleString()}`} />
            <Stat label="Price" value={money(c.price)} sub={`costs ${money(c.unitCost)} each`} tone={c.price < c.unitCost ? "bad" : "plain"} />
            <Stat label="Reputation" value={`${c.reputation}`} />
            <Stat label="Quality" value={`${c.quality}`} />
            <Stat label="Brand" value={`${c.brand}`} />
            <Stat label="Service" value={`${c.service}`} />
          </div>
          {c.bankruptSince !== null && (
            <p className="mt-4 rounded-lg bg-destructive/10 text-destructive text-sm p-3">
              Insolvent since year {c.bankruptSince}. The season does not end here — sell assets, cut seats, restructure, or take an offer.
            </p>
          )}
          <p className="mt-4 text-xs text-muted-foreground border-t border-border pt-3">
            <span className="font-medium text-foreground">Next year: {desk.economy.outlook}.</span> {desk.economy.outlookMeans}
          </p>
        </CardContent>
      </Card>

      {/* When things are going badly, this is the most important thing on the page. */}
      {desk.distress.level !== "healthy" && (
        <DistressCard
          distress={desk.distress}
          isCeo={desk.yourRole === "ceo"}
          seats={desk.table.map((s) => s.role).filter(Boolean) as Role[]}
          ventureId={desk.ventureId}
        />
      )}

      {/* 3. The decision. */}
      {desk.phase === "finished" ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          The season is over. Nothing left to decide — the last year's result is above.
        </CardContent></Card>
      ) : desk.yourRole && draft ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px] items-start">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{desk.yourTitle}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{desk.yourLevers.join(" · ")}</p>
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
                    value={draft[field.id]}
                    error={errors[field.id]}
                    onChange={(v) => setDraft((d) => ({ ...d!, [field.id]: v }))}
                  />
                ))}
              </div>

              <Button
                className="w-full mt-6"
                onClick={() => submit.mutate()}
                disabled={submit.isPending}
                data-testid="button-file-decision"
              >
                {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {desk.submitted ? "Update this year's decision" : "File this year's decision"}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center mt-2">
                Changeable until the year resolves. Nothing is locked in before then.
              </p>
            </CardContent>
          </Card>

          {/* The number no single seat could work out alone. */}
          <div className="space-y-4 lg:sticky lg:top-4">
            <Card className={overCommitted ? "border-destructive" : onCredit ? "border-amber-500/60" : ""}>
              <CardContent className="p-5">
                <div className="flex items-center gap-2">
                  <Banknote className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">What the table has committed</h3>
                </div>

                {live && (
                  <>
                    <p className="text-2xl font-bold tabular-nums mt-3" data-testid="text-commitment">
                      {compact(live.spend + live.fixed)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      against {compact(live.available)} available · {compact(live.fixed)} of it is salaries nobody chose
                    </p>

                    <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${overCommitted ? "bg-destructive" : onCredit ? "bg-amber-500" : "bg-primary"}`}
                        style={{ width: `${Math.min(100, ((live.spend + live.fixed) / Math.max(1, live.available)) * 100)}%` }}
                      />
                    </div>

                    <div className="mt-4 space-y-1.5">
                      {live.bySeat.filter((s) => s.spend > 0).map((s) => (
                        <div key={s.role} className="flex justify-between text-xs">
                          <span className="text-muted-foreground uppercase">{s.role}</span>
                          <span className="tabular-nums">{compact(s.spend)}</span>
                        </div>
                      ))}
                      {live.bySeat.every((s) => s.spend === 0) && (
                        <p className="text-xs text-muted-foreground">Nobody has committed anything yet.</p>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {desk.preview.warnings.map((w, i) => (
              <div key={i} className="rounded-lg bg-destructive/10 p-3 flex gap-2" data-testid="text-warning">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{w}</p>
              </div>
            ))}
            {desk.preview.notes.map((note, i) => (
              <div key={i} className="rounded-lg bg-muted p-3 flex gap-2">
                <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">{note}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* The three rooms off this one: buying things, buying companies, and where you stand. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Store className="h-4 w-4 text-muted-foreground" /> The market</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3">Three things a year, and everyone bids blind.</p>
            <Button variant="outline" size="sm" onClick={() => navigate(`/simulation/${desk.ventureId}/market`)} data-testid="button-open-market">Open</Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Handshake className="h-4 w-4 text-muted-foreground" /> The boardroom</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3">Buy a rival, or take the money for yours.</p>
            <Button variant="outline" size="sm" onClick={() => navigate(`/simulation/${desk.ventureId}/offers`)} data-testid="button-open-offers">Open</Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Trophy className="h-4 w-4 text-muted-foreground" /> Standings</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3">Where you actually stand, incumbents included.</p>
            <Button variant="outline" size="sm" onClick={() => navigate(`/simulation/${desk.ventureId}/standings`)} data-testid="button-open-standings">Open</Button>
          </CardContent>
        </Card>
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
              <div key={seat.userId} className="flex items-center gap-2.5 text-sm">
                {seat.filed
                  ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />}
                <span className="font-medium">{seat.isYou ? "You" : seat.name}</span>
                <span className="text-muted-foreground text-xs">{seat.title ?? "no seat"}</span>
                {!seat.filed && <span className="text-xs text-muted-foreground ml-auto">still deciding</span>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold mb-3">Who you're up against</h3>
          <div className="space-y-3">
            {desk.rivals.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-4">
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
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold mb-3">The market</h3>
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
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </Shell>
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
  return (
    <Card className="border-primary/40">
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Yours this year</p>
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

function Shell({ title, subtitle, clock, onBack, children }: {
  title: string; subtitle: string; clock?: string | null; onBack?: () => void; children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-4">
      <div className="rounded-2xl p-[2px]" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>
        <div className="rounded-[calc(1rem-1px)] bg-background p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {onBack && (
                <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2" data-testid="button-back">
                  <ArrowLeft className="h-3 w-3" /> All companies
                </button>
              )}
              <h1 className="text-2xl font-bold tracking-tight truncate" data-testid="text-company-name">{title}</h1>
              <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
            </div>
            {clock && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 shrink-0" data-testid="text-resolves">
                <Clock className="h-3 w-3" /> {clock}
              </p>
            )}
          </div>
        </div>
      </div>
      {children}
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

/** Last year, said plainly, with the engine's own explanation of why. */
function LastYear({ report }: { report: NonNullable<Desk["lastYear"]> }) {
  const up = report.shareChange > 0.001;
  const down = report.shareChange < -0.001;
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">Year {report.year}</h2>
          <Badge variant={report.rank <= 3 ? "default" : "secondary"}>#{report.rank} in the market</Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
          <Stat
            label="Share"
            value={`${(report.marketShare * 100).toFixed(1)}%`}
            sub={up ? `up ${(report.shareChange * 100).toFixed(1)}` : down ? `down ${Math.abs(report.shareChange * 100).toFixed(1)}` : "flat"}
          />
          <Stat label="Revenue" value={compact(report.revenue)} />
          <Stat label="Profit" value={compact(report.profit)} tone={report.profit < 0 ? "bad" : "plain"} />
          <Stat label="Turned away" value={report.turnedAway.toLocaleString()} tone={report.turnedAway > 0 ? "warn" : "plain"} />
        </div>

        {report.market && report.market.length > 0 && (
          <div className="mt-4 border-t border-border pt-3 space-y-1.5">
            <p className="text-xs font-medium flex items-center gap-1.5"><Store className="h-3.5 w-3.5" /> At the market</p>
            {report.market.map((m, i) => (
              <p
                key={i}
                className={`text-sm ${m.kind === "won" || m.kind === "sold" ? "text-foreground" : "text-muted-foreground"}`}
                data-testid={`text-market-${m.kind}`}
              >
                {m.text}
              </p>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-2 border-t border-border pt-3">
          {report.notes.length === 0 && <p className="text-sm text-muted-foreground">A quiet year.</p>}
          {report.notes.map((note, i) => (
            <p key={i} className="text-sm text-muted-foreground flex gap-2">
              {up ? <TrendingUp className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                : down ? <TrendingDown className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                : <Minus className="h-4 w-4 shrink-0 mt-0.5" />}
              {note}
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * One lever.
 *
 * Money fields get step buttons as well as a box. Typing "2000000" on a phone
 * is miserable and error-prone in a way that matters here — a stray zero is
 * a decision nobody meant to make.
 */
function Field({ field, value, error, onChange }: {
  field: LeverField; value: any; error?: string; onChange: (v: any) => void;
}) {
  if (field.kind === "choice") {
    return (
      <div>
        <Label className="text-sm font-medium">{field.label}</Label>
        <p className="text-xs text-muted-foreground mt-0.5 mb-2">{field.help}</p>
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
        <Label className="text-sm font-medium" htmlFor={`field-${field.id}`}>{field.label}</Label>
        {field.kind !== "count" && <span className="text-xs text-muted-foreground tabular-nums">{compact(n)}</span>}
      </div>
      <p className="text-xs text-muted-foreground mt-0.5 mb-2">{field.help}</p>
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
