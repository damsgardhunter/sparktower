/**
 * Sponsored challenges, for founders: real problems companies have put up,
 * each with a stated prize.
 *
 * The list is what the server calls open — status open *and* before the
 * deadline — so a challenge whose clock ran out never shows here as something
 * you can still enter.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Building2, CalendarClock, Loader2, ShieldCheck, Trophy, Users } from "lucide-react";
import { formatPrize } from "@shared/challenges-money";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INDUSTRIES } from "@shared/companies";
import { deadlineLabel, CHALLENGE_DISCLAIMER } from "@shared/challenges";

interface ChallengeCard {
  id: string; title: string; brief: string; prize: string | null; industry: string | null;
  /** What is actually in the safe, from the row rather than from the company. */
  prizeHeld: { amountCents: number; state: string } | null;
  deadline: string; status: "open" | "judging" | "closed"; acceptingEntries: boolean;
  company: { id: string; name: string; industry: string | null; website: string | null; verifiedDomain: string | null };
  entryCount: number; entered: boolean; myEntryStatus: string | null;
}

const ALL = "all";

export default function ChallengesPage() {
  const [industry, setIndustry] = useState<string>(ALL);
  const params = new URLSearchParams({ status: "open" });
  if (industry !== ALL) params.set("industry", industry);
  const { data, isLoading, isError } = useQuery<ChallengeCard[]>({ queryKey: [`/api/challenges?${params}`] });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <header className="pb-4 border-b border-border">
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-challenges-title">Challenges</h1>
          <p className="text-sm text-muted-foreground mt-1">Real problems companies want solved, each with a prize. Answer one with what you're building.</p>
          <p className="text-xs text-muted-foreground mt-2">{CHALLENGE_DISCLAIMER}</p>
        </header>

        <div className="flex items-center justify-between gap-3 pt-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Open now</span>
          <Select value={industry} onValueChange={setIndustry}>
            <SelectTrigger className="w-48" data-testid="select-industry"><SelectValue placeholder="Any industry" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any industry</SelectItem>
              {INDUSTRIES.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="py-16 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : isError ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Challenges couldn't be loaded. Try again in a moment.</p>
        ) : !data?.length ? (
          <p className="py-16 text-center text-sm text-muted-foreground" data-testid="text-no-challenges">
            {industry === ALL ? "No open challenges right now. Check back soon." : `No open challenges in ${industry} right now.`}
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {data.map((c) => (
              <li key={c.id}>
                <Link href={`/challenges/${c.id}`} className="block h-full rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-colors" data-testid={`card-challenge-${c.id}`}>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" />
                    <span className="truncate">{c.company.name}</span>
                    {/* The domain, because a name can be anything and a domain has been checked. */}
                    {c.company.verifiedDomain && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-emerald-700 dark:text-emerald-400" title={`${c.company.verifiedDomain} — verified`}>
                        <ShieldCheck className="h-3 w-3" />
                        <span className="hidden sm:inline">{c.company.verifiedDomain}</span>
                      </span>
                    )}
                    {c.industry && <Badge variant="outline" className="ml-auto">{c.industry}</Badge>}
                  </div>
                  <h2 className="mt-2 font-semibold leading-snug">{c.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{c.brief}</p>
                  {c.prizeHeld?.state === "held" && (
                    /*
                      * The money, and the fact that it is already paid in. A
                      * stated prize and a held one look the same on a card
                      * unless the card says which it is — and the whole reason
                      * the escrow exists is so this one can.
                      */
                    <p className="mt-3 inline-flex flex-wrap items-center gap-1.5 text-sm font-medium" data-testid={`prize-held-${c.id}`}>
                      <Trophy className="h-4 w-4 text-amber-500" />
                      {formatPrize(c.prizeHeld.amountCents)}
                      <span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-700 dark:text-emerald-400">
                        <ShieldCheck className="h-3 w-3" />held by SparkTower
                      </span>
                    </p>
                  )}
                  {c.prize && (
                    <p className="mt-1 text-sm text-muted-foreground inline-flex items-center gap-1.5">{c.prize}</p>
                  )}
                  <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{deadlineLabel(c.deadline, Date.now())}</span>
                    <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{c.entryCount} {c.entryCount === 1 ? "entry" : "entries"}</span>
                    {c.entered && <Badge className="ml-auto" data-testid={`badge-entered-${c.id}`}>Entered</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
