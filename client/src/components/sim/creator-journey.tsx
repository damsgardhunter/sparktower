/**
 * A channel's journey: where it is, what is next, and where the money came from.
 *
 * In a market that earns from an audience the desk's usual headline — customers
 * served, customers turned away — is the wrong story. A creator watches three
 * things: the subscriber count against the next milestone, the views, and
 * which of the three kinds of money has switched on. This card is those three,
 * read from the last period's report (`report.creator`, see
 * shared/simulation/creator.ts).
 */
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Eye, Handshake, Lock, PlayCircle, Users } from "lucide-react";
import { useMoney } from "@/components/sim/desk-currency";
import { cn } from "@/lib/utils";

export interface Milestone { at: number; name: string; means: string }
export interface DeskAudience {
  partnerAt: number;
  sponsorsFrom: number;
  milestones: Milestone[];
  words: { views: string; upload: string; uploads: string; members: string; read: string };
  sponsors: { name: string; sells: string; segment: string }[];
  subscribers: number;
}
export interface CreatorFigures {
  subscribers: number; views: number; discovered: number; breakouts: number; viewsPerUpload: number;
  uploads: number; reads: number; adRevenue: number; sponsorRevenue: number; memberRevenue: number;
  breakout?: { tier: string; views: number };
  members: number; monetised: boolean; sponsored: boolean; stretched: number;
  deals: { name: string; sells: string; amount: number; reads: number }[];
  milestones: Milestone[];
  next: Milestone | null;
}

const count = (n: number) => Math.round(n).toLocaleString();

export function CreatorJourney({ audience, last, customers, periodName }: {
  audience: DeskAudience;
  /** The last period's creator figures, or null before the first one has run. */
  last: CreatorFigures | null;
  /** What the voice calls them: "subscribers", "listeners". */
  customers: string;
  /** "month", "quarter", "year". */
  periodName: string;
}) {
  const { compact } = useMoney();
  const subs = last?.subscribers ?? audience.subscribers;
  const ladder = [...audience.milestones].sort((a, b) => a.at - b.at);
  const next = ladder.find((m) => m.at > subs) ?? null;
  const prev = [...ladder].reverse().find((m) => m.at <= subs) ?? null;
  const from = prev?.at ?? 0;
  const progress = next ? Math.min(100, Math.max(0, ((subs - from) / (next.at - from)) * 100)) : 100;
  const w = audience.words;
  /* The three kinds of money, each switched on by the journey. */
  const streams = [
    { label: "Ads", value: last?.adRevenue ?? 0, on: subs >= audience.partnerAt, gate: `${count(audience.partnerAt)} ${customers}` },
    { label: "Sponsors", value: last?.sponsorRevenue ?? 0, on: subs >= audience.sponsorsFrom, gate: `${count(audience.sponsorsFrom)} ${customers}` },
    { label: "Memberships", value: (last?.memberRevenue ?? 0), on: true, gate: "" },
  ];
  const memberPeriodValue = streams[2].value;
  const total = streams[0].value + streams[1].value + memberPeriodValue;

  return (
    <Card className="rounded-2xl nova-ring-soft" data-testid="card-creator-journey">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">The journey</p>
            <p className="text-2xl font-semibold tabular-nums" data-testid="text-creator-subscribers">
              {count(subs)} <span className="text-base font-normal text-muted-foreground">{customers}</span>
            </p>
          </div>
          {last?.breakout && (
            <Badge className="gap-1 font-normal" data-testid="badge-creator-breakout">
              <PlayCircle className="h-3 w-3" /> A video broke out: {count(last.breakout.views)} {w.views}
            </Badge>
          )}
          {last && last.discovered > 0 && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <Users className="h-3 w-3" /> +{count(last.discovered)} found you this {periodName}
            </Badge>
          )}
        </div>

        {/* The next milestone, as a bar — what the channel is growing towards. */}
        <div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">{prev ? prev.name : "Starting out"}</span>
            <span className="font-medium">{next ? `${next.name} at ${count(next.at)}` : "Every milestone reached"}</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          {next && <p className="mt-1 text-xs text-muted-foreground">{next.means}</p>}
        </div>

        <ol className="flex flex-wrap gap-1.5" aria-label="Milestones">
          {ladder.map((m) => {
            const reached = subs >= m.at;
            return (
              <li
                key={m.at}
                className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", reached ? "border-primary/50 text-foreground" : "text-muted-foreground")}
                data-testid={`milestone-${m.at}`}
              >
                {reached ? <Check className="h-3 w-3 text-primary" /> : <Lock className="h-3 w-3" />}
                {m.name}
              </li>
            );
          })}
        </ol>

        {last && (
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="flex items-center gap-1 text-xs text-muted-foreground"><Eye className="h-3 w-3" /> {w.views} this {periodName}</p>
              <p className="font-medium tabular-nums">{count(last.views)}</p>
            </div>
            <div>
              <p className="flex items-center gap-1 text-xs text-muted-foreground"><PlayCircle className="h-3 w-3" /> per {w.upload}</p>
              <p className="font-medium tabular-nums">{count(last.viewsPerUpload)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{w.members}</p>
              <p className="font-medium tabular-nums">{count(last.members)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Earned this {periodName}</p>
              <p className="font-medium tabular-nums">{compact(total)}</p>
            </div>
          </div>
        )}

        {/* Where the money came from, and what is still locked. */}
        <div className="space-y-1.5" data-testid="creator-streams">
          {streams.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-3 text-sm">
              <span className={cn("flex items-center gap-1.5", !s.on && "text-muted-foreground")}>
                {s.on ? <Check className="h-3.5 w-3.5 text-primary" /> : <Lock className="h-3.5 w-3.5" />}
                {s.label}
                {!s.on && <span className="text-xs">· from {s.gate}</span>}
              </span>
              <span className="tabular-nums">{s.on && last ? compact(s.value) : "—"}</span>
            </div>
          ))}
        </div>

        {last && last.stretched < 0.9 && (
          <p className="rounded-lg bg-muted/60 p-2.5 text-xs">
            The audience has outgrown what you can make: each of them saw about {Math.round(last.stretched * 100)}% of what they
            would have. More production turns straight into {w.views}.
          </p>
        )}

        {/* The sponsors: who chose you, and who is out there. */}
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium"><Handshake className="h-4 w-4" /> Sponsors</p>
          {last && last.deals.length > 0 ? (
            <ul className="mt-1.5 space-y-1 text-sm" data-testid="list-creator-deals">
              {last.deals.map((d) => (
                <li key={d.name} className="flex justify-between gap-3">
                  <span>{d.name} <span className="text-xs text-muted-foreground">· {d.sells}</span></span>
                  <span className="tabular-nums">{compact(d.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {subs < audience.sponsorsFrom
                ? `None yet — sponsors look at channels from ${count(audience.sponsorsFrom)} ${customers}.`
                : last && last.reads === 0
                  ? `You are running no ${w.read}s, so no sponsor can buy one.`
                  : "None chose you last time: they went to channels with more views per video, or a closer fit for their buyers."}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            In this market: {audience.sponsors.map((sp) => `${sp.name} (${sp.sells}, for ${sp.segment.toLowerCase()})`).join("; ")}.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
