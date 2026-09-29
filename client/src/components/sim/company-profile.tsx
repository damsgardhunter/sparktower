/**
 * A rival, opened by tapping their name.
 *
 * Before this, a company in this game was a row: "Ember — 39% — £47". Which is
 * everything the engine knows about Ember and nothing a person can do anything
 * with. You cannot decide how to attack a percentage. You can decide how to
 * attack a nine-year-old market leader that spends on safety instead of being
 * fun and has not changed its product since 2019 — and that is the same
 * company, described so somebody can plan against it.
 *
 * ## What is on it, in the order it is read
 *
 * **Who they are** first, because that is what the tap was asking. Then
 * **where they stand**, which is the numbers the row already showed. Then the
 * two things the row could never show: **how they compare with you**, in
 * words, and **where the two of you are fighting** — segment by segment, with
 * whether each one is a door or a wall.
 *
 * The weakness is given its own place near the bottom and is not a joke at
 * their expense. It is the plan. Every incumbent in this game is beatable in a
 * way you can name, and this is where they are named.
 *
 * ## Why it is an overlay
 *
 * Reading about a rival is something you do in the middle of deciding, with a
 * half-filled form behind you. A route change would throw that away and make
 * looking things up cost something, and a player who is charged for curiosity
 * stops being curious.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown, Minus, DoorOpen, Swords, Quote, Users } from "lucide-react";

export interface CompanyProfileData {
  id: string;
  name: string;
  kind: "player" | "incumbent";
  isYou: boolean;
  product: string | null;
  persona: {
    tagline: string; boss: string; character: string;
    known: string; knock: string; voice: string;
  } | null;
  posture: string | null;
  posturedAs: string | null;
  voice: Record<string, string>;
  standing: {
    rank: number; of: number; customers: number; share: number;
    revenue: number; price: number; founderValue: number;
    soldBusinessIn: number | null; bankrupt: boolean;
  };
  reads: { label: string; verdict: string; edge: "them" | "you" | "level" }[];
  contested: { id: string; name: string; loyalty: number; yours: number; theirs: number; note: string }[];
  history: { year: number; share: number; shareChange: number; customers: number; note: string | null }[];
  /** Who is at this table. Empty for an incumbent — nobody is behind them. */
  roster: {
    userId: string; name: string; headline: string | null; avatarUrl: string | null;
    isBot: boolean; isYou: boolean; role: string | null; title: string | null;
  }[];
}

const money = (n: number) =>
  n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(1)}m`
  : n >= 1_000 ? `£${(n / 1_000).toFixed(0)}k`
  : `£${Math.round(n)}`;

export function CompanyProfile({ ventureId, companyId, onClose }: {
  ventureId: string;
  companyId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<CompanyProfileData>({
    queryKey: [`/api/sim/ventures/${ventureId}/companies/${companyId}`],
    enabled: !!companyId,
  });

  return (
    <Dialog open={!!companyId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-company-profile">
        {isLoading || !data ? (
          <div className="py-16 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <DialogHeader className="space-y-1.5 text-left">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-xl" data-testid="text-profile-name">{data.name}</DialogTitle>
                {data.isYou && <Badge variant="default" className="text-[10px]">You</Badge>}
                {data.kind === "player" && !data.isYou && <Badge variant="outline" className="text-[10px]">a team</Badge>}
                {data.standing.bankrupt && <Badge variant="destructive" className="text-[10px]">insolvent</Badge>}
              </div>
              {data.persona && (
                <p className="text-sm italic text-muted-foreground" data-testid="text-profile-tagline">
                  “{data.persona.tagline}”
                </p>
              )}
              {data.product && !data.persona && (
                <p className="text-sm text-muted-foreground">{data.product}</p>
              )}
            </DialogHeader>

            {/* Where they stand. The row you tapped, kept in view. */}
            <div className="grid grid-cols-3 gap-3 rounded-lg border border-border p-3">
              <Figure label="Share" value={`${(data.standing.share * 100).toFixed(1)}%`} />
              <Figure label={`#${data.standing.rank} of ${data.standing.of}`} value={money(data.standing.founderValue)} sub="owners hold" />
              <Figure label={`per ${data.voice.per ?? "sale"}`} value={money(data.standing.price)} />
            </div>

            {/* Who they are. */}
            {data.persona && (
              <section className="space-y-3">
                <p className="text-sm leading-relaxed" data-testid="text-profile-character">{data.persona.character}</p>
                <p className="text-xs text-muted-foreground">{data.persona.boss}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="text-[11px] font-normal">{data.persona.known}</Badge>
                  {data.posturedAs && <Badge variant="outline" className="text-[11px] font-normal">{data.posturedAs}</Badge>}
                </div>
              </section>
            )}

            {/*
             * Who is actually at the other table.
             *
             * A rival team used to be a name and a share, which is everything
             * the engine knows and nothing the game is about: five people are
             * sitting behind that share and there was no way to find out who.
             * Each name goes to that person's real profile, which is where
             * following or connecting with them happens — the same page you
             * would reach from anywhere else on SparkTower, rather than a
             * second, lesser version of it inside the game.
             */}
            {data.roster.length > 0 && (
              <section data-testid="section-company-roster">
                <p className="text-xs font-semibold flex items-center gap-1.5 mb-2">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" /> Who's at this table
                </p>
                <div className="space-y-1">
                  {data.roster.map((person) => (
                    <RosterRow key={person.userId} person={person} />
                  ))}
                </div>
              </section>
            )}

            {/*
             * The way in. Deliberately the loudest thing on the page after the
             * name — a market of four unassailable companies is a market with
             * no game in it, and this is where each of them stops being one.
             */}
            {data.persona && !data.isYou && (
              <section className="rounded-lg border border-primary/30 bg-primary/5 p-3.5" data-testid="text-profile-knock">
                <p className="text-xs font-semibold flex items-center gap-1.5 mb-1.5">
                  <DoorOpen className="h-3.5 w-3.5 text-primary" /> The way in
                </p>
                <p className="text-sm leading-relaxed">{data.persona.knock}</p>
              </section>
            )}

            {/* How they measure up, in words rather than two numbers side by side. */}
            {data.reads.length > 0 && (
              <section className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">Against you</p>
                {data.reads.map((read) => (
                  <div key={read.label} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-muted-foreground capitalize">{read.label}</span>
                    <span className={
                      read.edge === "them" ? "text-destructive text-right"
                      : read.edge === "you" ? "text-primary text-right"
                      : "text-right"
                    }>{read.verdict}</span>
                  </div>
                ))}
              </section>
            )}

            {/* Where the fight actually is. */}
            {data.contested.length > 0 && (
              <section className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Swords className="h-3.5 w-3.5" /> Where you meet them
                </p>
                {data.contested.map((s) => (
                  <div key={s.id} className="rounded-lg bg-muted/50 p-2.5" data-testid={`row-contested-${s.id}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">{s.name}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {s.theirs.toLocaleString()} to their name{s.yours > 0 ? `, ${s.yours.toLocaleString()} to yours` : ""}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{s.note}</p>
                  </div>
                ))}
              </section>
            )}

            {/* What the season has done to them so far. */}
            {data.history.length > 0 && (
              <section className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">The season so far</p>
                {data.history.map((h) => (
                  <div key={h.year} className="flex items-start gap-2 text-sm">
                    {h.shareChange > 0.001 ? <TrendingUp className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                      : h.shareChange < -0.001 ? <TrendingDown className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
                      : <Minus className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />}
                    <span className="text-muted-foreground shrink-0">Year {h.year}</span>
                    <span className="tabular-nums shrink-0">{(h.share * 100).toFixed(1)}%</span>
                    {h.note && <span className="text-xs text-muted-foreground truncate">{h.note}</span>}
                  </div>
                ))}
              </section>
            )}

            {/* And what they would say about you, which is the fun of it. */}
            {data.persona && !data.isYou && (
              <p className="text-sm italic text-muted-foreground flex gap-2 border-t border-border pt-3">
                <Quote className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {data.persona.voice}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground truncate">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/**
 * One person on a roster.
 *
 * A link for anybody real and plain text for a bot, because a bot's profile
 * page is an empty room and sending somebody to one teaches them the link is
 * not worth pressing.
 */
function RosterRow({ person }: {
  person: { userId: string; name: string; headline: string | null; avatarUrl: string | null; isBot: boolean; isYou: boolean; title: string | null };
}) {
  const inside = (
    <>
      <Avatar className="h-7 w-7">
        {person.avatarUrl && <AvatarImage src={person.avatarUrl} alt="" />}
        <AvatarFallback className="text-[10px]">{person.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{person.name}</span>
          {person.isYou && <Badge variant="default" className="text-[10px]">You</Badge>}
          {person.isBot && <Badge variant="outline" className="text-[10px]">bot</Badge>}
        </span>
        <span className="block text-xs text-muted-foreground truncate">
          {person.title ?? "No seat yet"}{person.headline && !person.isBot ? ` · ${person.headline}` : ""}
        </span>
      </span>
    </>
  );

  if (person.isBot) {
    return <div className="flex items-center gap-2.5 rounded-md p-1.5" data-testid={`roster-${person.userId}`}>{inside}</div>;
  }
  return (
    <Link
      href={`/profile/${person.userId}`}
      className="flex items-center gap-2.5 rounded-md p-1.5 hover:bg-accent transition-colors"
      data-testid={`roster-${person.userId}`}
    >
      {inside}
    </Link>
  );
}
