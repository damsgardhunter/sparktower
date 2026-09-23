/**
 * Where your company stands, on the screen you arrive at.
 *
 * ## The question the lobby could not answer
 *
 * Once a season was running, this screen said the company's name, what it
 * sells, and "Open your desk". Everything else — which year it is, whether you
 * are winning, whether the year you spent arguing about price did anything —
 * was one more click away on the standings page, and a click away is far
 * enough that most people never went. So five people ran a company for a
 * fortnight and the screen they saw most often told them nothing about how it
 * was going.
 *
 * Three facts fit here and they are the three that matter: **which year it
 * is**, **where you are placed**, and **which way you are moving**. The last
 * one is the reason to come back tomorrow — a rank on its own is a snapshot,
 * and a snapshot cannot tell you whether the thing you tried last year worked.
 *
 * The incumbents are counted in the placing, as they are everywhere else. A
 * table that quietly ranked only the player teams would tell everybody they
 * were doing better than they are, and 4th of 9 is the honest number.
 */
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, Trophy } from "lucide-react";

interface StandingsRow {
  id: string; name: string; kind: "player" | "incumbent";
  customers: number; share: number; reputation: number;
  isYou: boolean; rank: number; founderValue: number;
}
interface Standings {
  year: number; totalYears: number; status: string;
  niche: { id: string; name: string; voice: Record<string, string> } | null;
  rows: StandingsRow[];
  history: { year: number; share: number; customers: number; profit: number; rank: number; founderValue: number | null }[];
}

/** Money, at whatever scale the market happens to run at. The engine's figures are in pounds. */
const compact = (n: number) =>
  n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(1)}m` : n >= 1_000 ? `£${Math.round(n / 1_000)}k` : `£${Math.round(n)}`;

const ordinal = (n: number): string => {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

export function SeasonStanding({ ventureId }: { ventureId: string }) {
  const { data } = useQuery<Standings>({
    queryKey: [`/api/sim/ventures/${ventureId}/standings`],
    // A year turns once a day; this only has to be fresher than that.
    refetchInterval: 60_000,
    staleTime: 0,
  });

  if (!data) return null;
  const you = data.rows.find((r) => r.isYou);
  if (!you) return null;

  /*
   * Last year's rank, from this company's own history, so "up two places" is
   * measured against where it actually was rather than against the row above
   * it. Null in year one, where there is nothing to have moved from — and
   * saying "no change" then would be a claim about a year nobody played.
   */
  const previous = data.history.length >= 2 ? data.history[data.history.length - 2] : null;
  const moved = previous?.rank != null ? previous.rank - you.rank : null;
  const players = data.rows.filter((r) => r.kind === "player").length;

  const Move = moved == null ? Minus : moved > 0 ? TrendingUp : moved < 0 ? TrendingDown : Minus;
  const moveTone = moved == null || moved === 0 ? "text-muted-foreground" : moved > 0 ? "text-emerald-600" : "text-destructive";
  const moveText = moved == null
    ? "first year"
    : moved === 0 ? "holding"
    : moved > 0 ? `up ${moved} place${moved === 1 ? "" : "s"}`
    : `down ${-moved} place${moved === -1 ? "" : "s"}`;

  const progress = data.totalYears > 0 ? Math.min(1, data.year / data.totalYears) : 0;

  return (
    <div className="space-y-3" data-testid="season-standing">
      {/* Which year, and how much of the fortnight is left. */}
      <div className="space-y-1.5">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-semibold" data-testid="text-season-year">
            Year {data.year} of {data.totalYears}
          </p>
          <p className="text-xs text-muted-foreground">
            {data.year >= data.totalYears ? "the last one" : `${data.totalYears - data.year} to go`}
          </p>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      {/* Where you are against everybody — incumbents included, which is the honest count. */}
      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="In the market"
          value={`${ordinal(you.rank)}`}
          hint={`of ${data.rows.length}`}
          testId="stat-rank"
        />
        <Stat
          label="Share"
          value={`${(you.share * 100).toFixed(1)}%`}
          hint={data.niche?.voice?.customers ? `of ${data.niche.voice.customers}` : "of the market"}
          testId="stat-share"
        />
        <Stat
          label="You own"
          value={compact(you.founderValue)}
          hint="what your side holds"
          testId="stat-worth"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`flex items-center gap-1 font-medium ${moveTone}`} data-testid="text-rank-move">
          <Move className="h-3.5 w-3.5" /> {moveText}
        </span>
        <span className="text-muted-foreground">
          · {players} {players === 1 ? "team" : "teams"} playing, {data.rows.length - players} already here
        </span>
        {you.rank === 1 && (
          <Badge variant="secondary" className="gap-1" data-testid="badge-leading">
            <Trophy className="h-3 w-3" /> Leading the market
          </Badge>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint, testId }: { label: string; value: string; hint: string; testId: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5" data-testid={testId}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums leading-tight">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
