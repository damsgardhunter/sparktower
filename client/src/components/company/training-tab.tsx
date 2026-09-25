/**
 * Private training seasons: the market simulation, run for the company's own
 * people.
 *
 * Admins set one up (which market, how long a year lasts), hand out the join
 * link, and — once it is running — can end a year early and read the staff
 * report. Everyone in the company sees the seasons and can join one.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, FastForward, FileText, Loader2, Play, Plus, Send, Sparkles } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SCOPES } from "@shared/simulation/geography";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CompanyView } from "@/pages/company";
import { SeatsNotice, useSeats } from "@/components/company/simulation-seats";
import { PERIOD_NAME, type Cadence } from "@shared/simulation/cadence";

interface SeasonRow {
  id: string;
  name: string;
  status: "forming" | "running" | "finished" | "abandoned";
  niche: { id: string; name: string };
  year: number;
  totalYears: number;
  /** What `year` counts: years times the cadence. See the seasons route. */
  totalPeriods?: number;
  periodMinutes: number | null;
  cadence: string | null;
  nextTickAt: string | null;
  rooms: number;
  roomsReady: number;
  players: number;
  /** Which seat this season costs: one of our markets, or one Nova built. */
  seatKind: "play" | "nova";
  bots: number;
  inviteCode: string | null;
  joinUrl: string | null;
  myVentureId: string | null;
}

interface StaffRow {
  userId: string; name: string; roleTitle: string | null; teamName: string | null;
  yearsFiled: number; yearsPlayed: number; filedThisYear: boolean;
  challenges: { met: number; partial: number; missed: number };
  rank: number | null; companiesInMarket: number | null; marketShare: number | null;
  founderValue: number | null; profit: number | null; read: string;
}

/**
 * The lengths offered for one decision. A day is the public game's pace; the
 * rest are for a workshop that only has an afternoon.
 *
 * This is how much *real* time a table gets, which is a separate question
 * from how much simulated time passes — a monthly season still gets a day per
 * decision, it just covers a month of trading instead of a year.
 */
const PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: "10", label: "10 minutes" },
  { value: "15", label: "15 minutes" },
  { value: "20", label: "20 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
  { value: "240", label: "4 hours" },
  { value: "day", label: "A day (like the public game)" },
];

/** How often the table decides, and what that costs a seat. */
const CADENCE_OPTIONS = [
  { value: "yearly", label: "Once a year", note: "The classic season. Fourteen years of trading." },
  { value: "quarterly", label: "Every quarter", note: "Four decisions a year — you see a bad year in time to fix it. $6 a seat." },
  { value: "monthly", label: "Every month", note: "Twelve decisions a year, and the most news. $10 a seat." },
] as const;

/** Simulated years on offer, which narrows as the cadence gets finer. */
const YEARS_FOR: Record<string, number[]> = {
  yearly: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  quarterly: [1, 2, 3, 4, 5, 6],
  monthly: [1, 2],
};

const PERIOD_WORD: Record<string, { one: string; many: string }> = {
  yearly: { one: "year", many: "years" },
  quarterly: { one: "quarter", many: "quarters" },
  monthly: { one: "month", many: "months" },
};

const periodLength = (minutes: number | null) =>
  minutes == null ? "a day" : minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`;

const STATUS_LABEL: Record<SeasonRow["status"], string> = {
  forming: "Waiting for players",
  running: "Running",
  finished: "Finished",
  abandoned: "Closed",
};

const money = (n: number | null) =>
  n == null ? "—" : `${n < 0 ? "−" : ""}£${Math.abs(n) >= 1_000_000 ? `${(Math.abs(n) / 1_000_000).toFixed(1)}m` : `${Math.round(Math.abs(n) / 1000)}k`}`;

export function TrainingTab({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const key = [`/api/companies/${companyId}/seasons`];
  const { data, isLoading } = useQuery<{ seasons: SeasonRow[] }>({ queryKey: key, refetchInterval: 30_000 });
  const [creating, setCreating] = useState(false);
  const [novaBuilding, setNovaBuilding] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-2xl">
          A private season of the business simulation, just for your people. Teams of five each run a company in the
          same market, competing with each other and with established rivals. You choose how long each year lasts, so
          a season can fit in an afternoon.
        </p>
        {canManage && !creating && (
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setNovaBuilding(true)} data-testid="button-nova-build">
              <Sparkles className="h-4 w-4 mr-1.5" /> Let Nova Build My Simulation
            </Button>
            <Button variant="outline" onClick={() => setCreating(true)} data-testid="button-new-season">
              <Plus className="h-4 w-4 mr-1.5" /> New season
            </Button>
          </div>
        )}
      </div>

      {novaBuilding && <NovaBuild companyId={companyId} onDone={() => setNovaBuilding(false)} />}
      {creating && <CreateSeason companyId={companyId} onDone={() => setCreating(false)} />}

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : !data?.seasons.length ? (
        !creating && (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            {canManage ? "No training seasons yet. Set one up and share the link with your team." : "No training seasons yet. An admin can set one up."}
          </CardContent></Card>
        )
      ) : (
        data.seasons.map((s) => <SeasonCard key={s.id} companyId={companyId} season={s} canManage={canManage} />)
      )}
    </div>
  );
}

/**
 * Nova builds it.
 *
 * The questions a first-time company cannot answer — which of seven markets is
 * shaped like ours, how much of the world, how many rivals, how many years —
 * answered from the project this company is already running here. The brief
 * comes back before anything is shared, because the mapping is the thing worth
 * arguing with: a team that disagrees with "your capacity is your delivery
 * team" has learned something about their business.
 */
function NovaBuild({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const [, navigate] = useLocation();
  const { data: seats } = useSeats(companyId);
  const [built, setBuilt] = useState<NovaBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsSeats, setNeedsSeats] = useState(false);

  const build = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/seasons/nova`, {}),
    onSuccess: async (res: any) => {
      const body = await res.json();
      setBuilt(body.brief as NovaBrief);
      setError(null);
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/seasons`] });
    },
    onError: (err: any) => {
      if (err?.body?.code === "seats_required") { setNeedsSeats(true); setError(err.body.message); return; }
      setError(err?.body?.message ?? "Nova couldn't build that. Try again.");
    },
  });

  return (
    <Card data-testid="card-nova-build">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Nova builds your simulation</h3>
        </div>

        {!built && (
          <p className="text-sm text-muted-foreground">
            Nova reads what this company is building — the project, the path, how far it has got — and sets up the
            market closest in shape to yours, with the rivals and the reach you are really up against. It will say
            what in the game stands for what in your business, and you can argue with it before anyone plays.
          </p>
        )}

        {seats && !built && (
          <SeatsNotice companyId={companyId} kind="nova" seats={seats} onError={setError} />
        )}

        {built && (
          <div className="space-y-3" data-testid="nova-brief">
            <div>
              <p className="text-sm font-medium">{built.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {built.marketName} · {built.totalYears} years · {built.botTeams} rival{built.botTeams === 1 ? "" : "s"}
              </p>
            </div>
            <p className="text-sm">{built.why}</p>
            {built.mapping.length > 0 && (
              <div className="rounded-lg border p-3">
                <p className="text-xs font-medium mb-1.5">In the game → in your business</p>
                {built.mapping.map((m) => (
                  <p key={m.inTheGame} className="text-[11px] text-muted-foreground">
                    <span className="text-foreground font-medium">{m.inTheGame}</span> — {m.inYourBusiness}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive" data-testid="text-nova-error">{error}</p>}

        <div className="flex gap-2 flex-wrap">
          {needsSeats ? null : built ? (
            <Button onClick={() => { onDone(); navigate(`/companies/${companyId}`); }} data-testid="button-brief-done">
              Done
            </Button>
          ) : (
            <Button onClick={() => build.mutate()} disabled={build.isPending} data-testid="button-nova-go">
              {build.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Build it
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onDone}>{built ? "Close" : "Cancel"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface NovaBrief {
  name: string;
  marketName: string;
  totalYears: number;
  botTeams: number;
  why: string;
  mapping: { inTheGame: string; inYourBusiness: string }[];
}

function CreateSeason({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const { data: niches } = useQuery<{ niches: { id: string; name: string; premise: string }[] }>({ queryKey: ["/api/sim/niches"] });
  const [nicheId, setNicheId] = useState("");
  const [name, setName] = useState("");
  const [period, setPeriod] = useState("30");
  const [cadence, setCadence] = useState("yearly");
  const [totalYears, setTotalYears] = useState("6");
  /*
   * A finer cadence covers fewer simulated years, so the span on offer moves
   * under the choice. Snap to something legal rather than letting the form
   * post a number the server will reject.
   */
  const yearsOnOffer = YEARS_FOR[cadence] ?? YEARS_FOR.yearly;
  const years = yearsOnOffer.includes(Number(totalYears)) ? totalYears : String(yearsOnOffer[yearsOnOffer.length - 1]);
  const word = PERIOD_WORD[cadence] ?? PERIOD_WORD.yearly;
  /*
   * How much of the world, and who else is in it. Both open on the game every
   * public season plays, because a company that just wants a season should get
   * one without deciding anything about continents.
   */
  const [scope, setScope] = useState<string>("home");
  const [botTeams, setBotTeams] = useState("0");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/seasons`, {
      nicheId, name, totalYears: Number(years), periodMinutes: period === "day" ? null : Number(period),
      cadence, scope, botTeams: Number(botTeams),
    }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/seasons`] });
      onDone();
    },
    onError: (e) => setError(errorText(e, "Couldn't create the season.")),
  });

  const picked = niches?.niches.find((n) => n.id === nicheId);
  const minutes = period === "day" ? null : Number(period);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">New training season</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate(); }}>
          <div>
            <Label>Market</Label>
            <Select value={nicheId} onValueChange={setNicheId}>
              <SelectTrigger data-testid="select-niche"><SelectValue placeholder="Choose a market" /></SelectTrigger>
              <SelectContent>
                {niches?.niches.map((n) => <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {picked && <p className="text-xs text-muted-foreground mt-1">{picked.premise}</p>}
          </div>
          <div>
            <Label htmlFor="season-name">Name</Label>
            <Input id="season-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Leadership away day, March" data-testid="input-season-name" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>The table decides</Label>
              <Select value={cadence} onValueChange={setCadence}>
                <SelectTrigger data-testid="select-cadence"><SelectValue /></SelectTrigger>
                <SelectContent>{CADENCE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">{CADENCE_OPTIONS.find((o) => o.value === cadence)?.note}</p>
            </div>
            <div>
              <Label>Each {word.one} lasts</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger data-testid="select-period-length"><SelectValue /></SelectTrigger>
                <SelectContent>{PERIOD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">How long the table gets to file, in real time.</p>
            </div>
            <div>
              <Label>Years of trading</Label>
              <Select value={years} onValueChange={setTotalYears}>
                <SelectTrigger data-testid="select-total-years"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {yearsOnOffer.map((y) => <SelectItem key={y} value={String(y)}>{y} {y === 1 ? "year" : "years"}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {Number(years) * (cadence === "monthly" ? 12 : cadence === "quarterly" ? 4 : 1)} {word.many} of decisions
                {period === "day" ? ", one a day" : ""}.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Where they compete</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger data-testid="select-scope"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCOPES.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1" data-testid="text-scope-blurb">
                {SCOPES.find((o) => o.id === scope)?.blurb}
              </p>
            </div>
            <div>
              <Label>Rival companies</Label>
              <Select value={botTeams} onValueChange={setBotTeams}>
                <SelectTrigger data-testid="select-bot-teams"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Only the teams you invite</SelectItem>
                  {[1, 2, 3, 5, 8, 12, 20, 35, 50].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} run by Nova</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                {botTeams === "0"
                  ? "A season with one table in it is a company with no competition."
                  : `${botTeams} companies that price, build and bid against yours from year one.`}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {minutes == null
              ? `About ${totalYears} days of play once the teams are ready.`
              : `About ${Math.round((minutes * Number(totalYears)) / 6) / 10} hours of play once the teams are ready. You can also end a year early.`}
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={!nicheId || create.isPending} data-testid="button-create-season">
              {create.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Create season
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SeasonCard({ companyId, season, canManage }: { companyId: string; season: SeasonRow; canManage: boolean }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [showReport, setShowReport] = useState(false);
  // Only the people who can start it are shown the price of starting it.
  const { data: seats } = useSeats(canManage ? companyId : "");

  const fullLink = season.joinUrl ? `${window.location.origin}${season.joinUrl}` : null;
  const copy = async () => {
    if (!fullLink) return;
    try { await navigator.clipboard.writeText(fullLink); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { toast({ title: "Copy this link", description: fullLink }); }
  };

  const resolve = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/seasons/${season.id}/resolve-year-now`, {}).then((r) => r.json()),
    onSuccess: (res: { resolvedYear: number }) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/seasons`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/seasons/${season.id}/report`] });
      toast({ title: `Year ${res.resolvedYear} is done`, description: "Everyone can now read their results." });
    },
    onError: (e) => toast({ title: "Couldn't end the year", description: errorText(e), variant: "destructive" }),
  });

  /*
   * The company starts its own season: it knows when the workshop is all in,
   * and the clock does not (see server/company-season-routes.ts). Offered only
   * once every table is ready, since the server would refuse it before then.
   */
  const start = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/seasons/${season.id}/start`, {}).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/seasons`] });
      toast({ title: "The season has started", description: "Year one opens in a couple of minutes." });
    },
    onError: (e) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/seasons`] });
      toast({ title: "Couldn't start the season", description: errorText(e), variant: "destructive" });
    },
  });
  const allReady = season.rooms > 0 && season.roomsReady === season.rooms;

  const progress =
    /*
     * Counted in decisions, because `year` is a period counter: a four-year
     * quarterly season showed "Year 5 of 4" once it passed its first year.
     */
    season.status === "running" ? `${PERIOD_NAME[(season.cadence ?? "yearly") as Cadence].one.replace(/^./, (ch: string) => ch.toUpperCase())} ${season.year} of ${season.totalPeriods ?? season.totalYears}`
    : season.status === "finished" ? `All ${season.totalPeriods ?? season.totalYears} ${PERIOD_NAME[(season.cadence ?? "yearly") as Cadence].many} played`
    : `${season.totalYears} years`;

  return (
    <Card data-testid={`season-${season.id}`}>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{season.name}</span>
              <Badge variant={season.status === "running" ? "default" : "secondary"}>{STATUS_LABEL[season.status]}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {season.niche.name} · {progress} · each {PERIOD_WORD[season.cadence ?? "yearly"]?.one ?? "year"} lasts {periodLength(season.periodMinutes)}
            </p>
            <p className="text-xs text-muted-foreground">
              {season.players} {season.players === 1 ? "person" : "people"} at {season.rooms} {season.rooms === 1 ? "table" : "tables"}
              {season.bots > 0 && ` (plus ${season.bots} computer-run ${season.bots === 1 ? "seat" : "seats"})`}
              {season.status === "forming" && season.rooms > 0 && ` · ${season.roomsReady} of ${season.rooms} ready`}
              {season.status === "running" && season.nextTickAt && ` · this year ends ${new Date(season.nextTickAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {season.myVentureId ? (
              <Button size="sm" onClick={() => navigate(`/simulation?room=${season.myVentureId}`)}>Go to your table</Button>
            ) : season.status === "forming" && season.joinUrl ? (
              <Button size="sm" onClick={() => navigate(season.joinUrl!)} data-testid={`button-join-${season.id}`}>Join</Button>
            ) : null}
          </div>
        </div>

        {season.status === "forming" && fullLink && (
          <div className="flex gap-2 items-center">
            <Input readOnly value={fullLink} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button variant="outline" size="sm" onClick={copy} data-testid={`button-copy-${season.id}`}>
              {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />} {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        )}

        {canManage && season.status === "forming" && season.players > 0 && (
          <SeatsNotice companyId={companyId} kind={season.seatKind} seats={seats} />
        )}

        {canManage && (
          <div className="flex gap-2 flex-wrap">
            {season.status === "forming" && (
              <Button
                size="sm" disabled={!allReady || start.isPending}
                onClick={() => { if (confirm("Start the season? Nobody can join once it has started.")) start.mutate(); }}
                data-testid={`button-start-${season.id}`}
              >
                {start.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Play className="h-4 w-4 mr-1.5" />}
                Start the season{season.rooms > 0 && ` (${season.roomsReady} of ${season.rooms} ${season.rooms === 1 ? "table" : "tables"} ready)`}
              </Button>
            )}
            {season.status === "forming" && (
              <Button variant="outline" size="sm" onClick={() => setInviting(true)}><Send className="h-4 w-4 mr-1.5" /> Invite people</Button>
            )}
            {season.status === "running" && (
              <Button
                variant="outline" size="sm" disabled={resolve.isPending}
                onClick={() => { if (confirm(`End year ${season.year} now? Anyone who hasn't filed their decisions will have them made for them.`)) resolve.mutate(); }}
                data-testid={`button-resolve-${season.id}`}
              >
                {resolve.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <FastForward className="h-4 w-4 mr-1.5" />} End this year now
              </Button>
            )}
            {season.status !== "forming" && (
              <Button variant="outline" size="sm" onClick={() => setShowReport((v) => !v)} data-testid={`button-report-${season.id}`}>
                <FileText className="h-4 w-4 mr-1.5" /> {showReport ? "Hide staff report" : "Staff report"}
              </Button>
            )}
          </div>
        )}

        {season.status === "forming" && season.rooms > 0 && (
          <p className="text-xs text-muted-foreground">
            {allReady
              ? canManage
                ? "Every table is ready. Start the season when everyone who's coming has sat down — nobody can join after."
                : "Every table is ready. The season starts when an admin starts it."
              : canManage
                ? "You can start the season once every table has chosen its roles and named its company."
                : "The season starts once every table is ready and an admin starts it."}
          </p>
        )}

        {showReport && <StaffReport companyId={companyId} seasonId={season.id} />}
        {inviting && <InviteDialog companyId={companyId} season={season} onClose={() => setInviting(false)} />}
      </CardContent>
    </Card>
  );
}

function InviteDialog({ companyId, season, onClose }: { companyId: string; season: SeasonRow; onClose: () => void }) {
  const { data } = useQuery<CompanyView>({ queryKey: [`/api/companies/${companyId}`] });
  const { user } = useAuth();
  const { toast } = useToast();
  const others = (data?.members ?? []).filter((m) => m.userId !== user?.id);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const send = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/seasons/${season.id}/invite`, { userIds: [...picked] }).then((r) => r.json()),
    onSuccess: (res: { invited: number }) => {
      toast({ title: `Invited ${res.invited} ${res.invited === 1 ? "person" : "people"}`, description: "They'll get a notification with the join link." });
      onClose();
    },
    onError: (e) => toast({ title: "Couldn't send the invites", description: errorText(e), variant: "destructive" }),
  });

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite people to {season.name}</DialogTitle></DialogHeader>
        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody else is in the company yet. Invite colleagues from the Team tab first.</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            <button
              type="button" className="text-xs text-primary hover:underline"
              onClick={() => setPicked(picked.size === others.length ? new Set() : new Set(others.map((m) => m.userId)))}
            >
              {picked.size === others.length ? "Clear" : "Select everyone"}
            </button>
            {others.map((m) => (
              <label key={m.userId} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={picked.has(m.userId)} onCheckedChange={() => toggle(m.userId)} />
                {m.name}
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => send.mutate()} disabled={picked.size === 0 || send.isPending}>
            {send.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Send invites
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StaffReport({ companyId, seasonId }: { companyId: string; seasonId: string }) {
  const { data, isLoading, error } = useQuery<{
    season: { yearsResolved: number; status: string };
    players: StaffRow[];
    notPlaying: { userId: string; name: string }[];
  }>({ queryKey: [`/api/companies/${companyId}/seasons/${seasonId}/report`] });

  if (isLoading) return <div className="py-4"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>;
  if (error || !data) return <p className="text-sm text-destructive">{errorText(error, "Couldn't load the report.")}</p>;
  if (data.players.length === 0) return <p className="text-sm text-muted-foreground">Nobody from the company played in this season.</p>;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Seat</TableHead>
              <TableHead>Team</TableHead>
              <TableHead className="text-right">Years filed</TableHead>
              <TableHead className="text-right">Objectives met</TableHead>
              <TableHead className="text-right">Team rank</TableHead>
              <TableHead className="text-right">Market share</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">Founders' value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.players.map((p) => (
              <TableRow key={p.userId} data-testid={`report-row-${p.userId}`}>
                <TableCell>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground max-w-xs">{p.read}</div>
                </TableCell>
                <TableCell>{p.roleTitle ?? "—"}</TableCell>
                <TableCell>{p.teamName ?? "—"}</TableCell>
                <TableCell className="text-right">{p.yearsFiled} of {p.yearsPlayed}</TableCell>
                <TableCell className="text-right">
                  {p.challenges.met + p.challenges.partial + p.challenges.missed === 0 ? "—" : `${p.challenges.met} of ${p.challenges.met + p.challenges.partial + p.challenges.missed}`}
                </TableCell>
                <TableCell className="text-right">{p.rank == null ? "—" : `${p.rank} of ${p.companiesInMarket}`}</TableCell>
                <TableCell className="text-right">{p.marketShare == null ? "—" : `${(p.marketShare * 100).toFixed(1)}%`}</TableCell>
                <TableCell className="text-right">{money(p.profit)}</TableCell>
                <TableCell className="text-right">{money(p.founderValue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {data.notPlaying.length > 0 && (
        <p className="text-xs text-muted-foreground">Not playing: {data.notPlaying.map((p) => p.name).join(", ")}.</p>
      )}
    </div>
  );
}
