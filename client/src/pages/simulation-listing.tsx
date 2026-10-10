/**
 * One simulation's own page: what it is, what it costs, and the button.
 *
 * The hard part of this screen is that it has to sell something it must not
 * show. The market is the product — anything that renders it hands a paying
 * listing to anyone who opens the page — so what stands in for it is the
 * description, the settings that make it a particular contest, and the honest
 * admission that you are buying a thing you cannot inspect first. That is why
 * the refund terms sit beside the button rather than behind a link.
 */
import { useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { priceLabel, type ListingCard } from "@/components/simulation-listing-card";
import { Loader2, CalendarClock, Users, Play, ShieldCheck, ArrowLeft, UserPlus, User } from "lucide-react";
import { ReportButton } from "@/components/report-button";
import { isLive, type StartedSeason } from "@/components/simulation-library";
import { ShareLinks } from "@/components/sim/share-links";

interface Detail extends ListingCard {
  description: string | null;
}

/**
 * A key for one buying attempt. `randomUUID` where it exists, and a good enough
 * fallback where it does not — an older browser should not be the reason
 * somebody gets charged twice.
 */
const newAttemptKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

export default function SimulationListingPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [seats, setSeats] = useState(5);

  const { data, isLoading } = useQuery<{
    listing: Detail;
    youOwn: { seats: number; purchases: number; seasons: StartedSeason[] };
    isAuthor: boolean;
  }>({ queryKey: [`/api/sim-market/listings/${id}`] });

  const { data: terms } = useQuery<{ version: number; disclosure: string[]; refundWindowDays: number }>({
    queryKey: ["/api/sim-market/buyer-terms"],
  });

  /*
   * One key for one buying attempt, so a retry cannot buy twice.
   *
   * Held in a ref rather than state: it must survive re-renders without
   * causing any, and it must be the *same* key for the second tap of a
   * double-tap. A fresh one is minted after a purchase lands, because somebody
   * deliberately buying more seats a minute later is a new attempt and should
   * be charged for it.
   */
  const attemptKey = useRef<string>(newAttemptKey());

  const buy = useMutation({
    /*
     * The version of the terms this page actually rendered goes with the
     * purchase, and the server refuses a mismatch. Without it a tab left open
     * across a terms change buys under terms it never showed anybody — which is
     * the one thing recording consent server-side cannot catch on its own.
     */
    mutationFn: async () => apiRequest("POST", `/api/sim-market/listings/${id}/buy`, {
      seats,
      acceptedTermsVersion: terms?.version,
      idempotencyKey: attemptKey.current,
    }),
    onSuccess: async (res: any) => {
      /* That attempt is spent either way; the next press is a new one. */
      attemptKey.current = newAttemptKey();
      qc.invalidateQueries({ queryKey: [`/api/sim-market/listings/${id}`] });
      /*
       * `repeated` means the server recognised this attempt and charged
       * nothing. Saying "bought" again would tell somebody they had paid twice.
       */
      const body = await res.json().catch(() => ({}));
      if (body?.repeated) {
        toast({ title: "Already bought", description: "That purchase had already gone through — you've only been charged once." });
        return;
      }
      toast({ title: `${seats} seat${seats === 1 ? "" : "s"} bought`, description: "Start a season whenever you're ready." });
    },
    onError: (e: any) => toast({ title: "Couldn't buy those seats", description: e?.message ?? "Try again", variant: "destructive" }),
  });

  /*
   * On your own: a table of one, rivals seated, year one running.
   *
   * The same route the `/try/:id` link uses, because it is the same thing —
   * one person meeting their market with nothing to wait for. Kept distinct
   * from `play` so the destination can be the desk rather than a lobby.
   */
  const solo = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/sim-market/listings/${id}/try`, {})).json(),
    onSuccess: (body: { deskPath?: string; ventureId?: string }) => {
      qc.invalidateQueries({ queryKey: [`/api/sim-market/listings/${id}`] });
      qc.invalidateQueries({ queryKey: ["/api/sim-market/me"] });
      setLocation(body.deskPath ?? (body.ventureId ? `/simulation/${body.ventureId}` : "/simulations/market"));
    },
    onError: (e: any) => toast({
      title: "Couldn't start it",
      description: e?.message ?? "Try again",
      variant: "destructive",
    }),
  });

  const play = useMutation({
    mutationFn: async (withTeam: boolean) => apiRequest("POST", `/api/sim-market/listings/${id}/play`, { withTeam }),
    onSuccess: async (res: any) => {
      const body = await res.json();
      /*
       * The listing is refetched before we leave, so the season is on the page
       * behind them. It used to only be in this response — somebody who came
       * back got the buy panel again and no sign of the game they had just
       * started with a seat they had just spent.
       */
      qc.invalidateQueries({ queryKey: [`/api/sim-market/listings/${id}`] });
      qc.invalidateQueries({ queryKey: ["/api/sim-market/me"] });
      setLocation(body.joinUrl ?? "/simulation");
    },
    onError: (e: any) => toast({ title: "Couldn't start it", description: e?.message ?? "Try again", variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="mx-auto max-w-4xl px-4 py-8"><Skeleton className="h-64 rounded-xl" /></div>;
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <p className="font-medium">That simulation isn't here</p>
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/simulations/market")}>Back to the marketplace</Button>
      </div>
    );
  }

  const { listing, youOwn, isAuthor } = data;
  const free = listing.pricing === "free";
  const canPlay = isAuthor || youOwn.seats > 0;
  const total = free ? 0 : listing.seatPriceCents * seats;
  /* Finished and abandoned seasons are history, not somewhere to go back to. */
  const live = (youOwn.seasons ?? []).filter(isLive);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => setLocation("/simulations/market")}>
        <ArrowLeft className="mr-1 h-4 w-4" /> Marketplace
      </Button>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{listing.title}</h1>
          <div className="mt-3 flex items-center gap-2">
            <UserAvatar src={listing.author.avatarUrl ?? undefined} name={listing.author.name ?? "A builder"} className="h-7 w-7" />
            <span className="text-sm text-secondary">{listing.author.name ?? "A builder"}</span>
          </div>

          <p className="mt-5 text-lg text-secondary">{listing.summary}</p>

          {/*
            * Reporting sits with the author rather than beside the buy button.
            * It is about who made this, not about the transaction, and putting
            * it next to the price makes "report" look like one of the things a
            * buyer might be about to do. The author's own listing shows none —
            * reporting yourself is not a thing anybody needs.
            */}
          {!isAuthor && (
            <div className="mt-2">
              <ReportButton targetType="simulation_listing" targetId={listing.id} variant="action" />
            </div>
          )}

          {listing.description && (
            <div className="mt-5 space-y-3 text-secondary">
              {listing.description.split(/\n\n+/).map((para, i) => <p key={i}>{para}</p>)}
            </div>
          )}

          {/*
            * The settings, as facts rather than a spec table. These are what
            * make it a particular contest, and they are also the only concrete
            * thing a buyer can judge before paying — so they are given room
            * rather than squeezed into chips at the bottom.
            */}
          <Card className="mt-6 nova-ring-soft border-0">
            <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
              <div>
                <p className="flex items-center gap-1.5 text-xs text-tertiary"><CalendarClock className="h-3.5 w-3.5" /> Decisions</p>
                <p className="mt-1 font-medium capitalize">{listing.cadence}</p>
                <p className="text-xs text-tertiary">over {listing.totalYears} years</p>
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-xs text-tertiary"><Users className="h-3.5 w-3.5" /> Rivals</p>
                <p className="mt-1 font-medium">{listing.botSkill === "survivor" ? "Play to win" : "Fill the seats"}</p>
                <p className="text-xs text-tertiary">
                  {listing.botSkill === "survivor" ? "They work out what to charge" : "They file the obvious number"}
                </p>
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-xs text-tertiary"><Play className="h-3.5 w-3.5" /> Played by</p>
                {/*
                  * Different people, not seasons started — one buyer replaying
                  * their own seats is not evidence anybody else chose this.
                  */}
                <p className="mt-1 font-medium">
                  {listing.players > 0 ? `${listing.players} ${listing.players === 1 ? "person" : "people"}` : "Not yet"}
                </p>
                {listing.seasonsStarted > 0 && (
                  <p className="text-xs text-tertiary">
                    {listing.seasonsStarted} season{listing.seasonsStarted === 1 ? "" : "s"} started
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* The buying side, sticky on a wide screen because it is what the page is for. */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card className="nova-ring-soft border-0">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-bold">{priceLabel(listing)}</span>
                {isAuthor && <Badge variant="secondary">Yours</Badge>}
              </div>

              {/*
                * Anything already running, above the button that would start
                * another one. Somebody with a season in progress who lands
                * here is far more likely to be looking for it than to want a
                * second — and before this row existed, the page could not show
                * it to them at all.
                */}
              {live.length > 0 && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p className="text-xs font-medium text-secondary">
                    {live.length === 1 ? "You have one running" : `You have ${live.length} running`}
                  </p>
                  {live.map((season) => (
                    <Button
                      key={season.seasonId}
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => season.joinUrl && setLocation(season.joinUrl)}
                      disabled={!season.joinUrl}
                      data-testid={`button-resume-${season.seasonId}`}
                    >
                      <Play className="mr-2 h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{season.name?.trim() || listing.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-tertiary">
                        {season.status === "forming" ? "Waiting" : `Year ${season.year ?? 1}`}
                      </span>
                    </Button>
                  ))}
                </div>
              )}

              {canPlay ? (
                <>
                  <Button className="w-full" onClick={() => play.mutate(false)} disabled={play.isPending} data-testid="button-start-season">
                    {play.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : live.length > 0 ? "Start another" : "Start a season"}
                  </Button>
                  {/*
                    * Solo or for a table, said here rather than guessed.
                    *
                    * Nova fills a waiting room a minute after it opens, which
                    * is right for one person and ruinous for a team: the buyer
                    * who starts the season first comes back to find Nova
                    * playing three of their colleagues. It cannot be inferred
                    * from the seat count — five seats is equally five solo
                    * runs — so it is a second button rather than a guess.
                    */}
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => play.mutate(true)}
                    disabled={play.isPending}
                    data-testid="button-start-for-team"
                  >
                    <UserPlus className="mr-1.5 h-4 w-4" /> Start one and hold the seats
                  </Button>
                  {/*
                    * And a third shape, which the page could not make before.
                    *
                    * Both buttons above make a table of five. Somebody who
                    * wants to play it alone had no way to say so: they started
                    * a five-seat room, were told four more people were needed,
                    * and watched a countdown to strangers filling the chairs.
                    * A solo season is its own shape rather than a smaller
                    * version of the same game — one person holding every lever,
                    * drawing one salary instead of five — so it is `/try`,
                    * which seats them against the rivals and starts year one.
                    */}
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => solo.mutate()}
                    disabled={solo.isPending}
                    data-testid="button-start-solo"
                  >
                    {solo.isPending
                      ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      : <User className="mr-1.5 h-4 w-4" />}
                    Play it on your own
                  </Button>
                  <p className="text-xs text-tertiary">
                    {isAuthor
                      ? "Yours to play as often as you like."
                      : `${youOwn.seats} seat${youOwn.seats === 1 ? "" : "s"} left. Starting a season uses one.`}
                    {" "}Holding the seats keeps Nova out of the empty chairs until your table arrives.
                  </p>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="seats">Seats</Label>
                    <Input
                      id="seats" type="number" min={1} max={50} value={seats}
                      onChange={(e) => setSeats(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                      data-testid="input-seats"
                    />
                    <p className="text-xs text-tertiary">One per person at the table.</p>
                  </div>
                  <Button className="w-full" onClick={() => buy.mutate()} disabled={buy.isPending} data-testid="button-buy-seats">
                    {buy.isPending ? <Loader2 className="h-4 w-4 animate-spin" />
                      : free ? "Get it, free" : `Buy ${seats} seat${seats === 1 ? "" : "s"} — $${(total / 100).toFixed(2)}`}
                  </Button>
                </>
              )}

              {/*
                * The terms beside the button, not behind a link. "You are
                * buying a licence to run seasons, refundable for fourteen days
                * on seats you have not used" is the thing somebody needs
                * before paying, and a page that puts it after is a page that
                * has decided they will not read it.
                */}
              {terms && !canPlay && (
                <div className="space-y-2 border-t border-border pt-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                    <ShieldCheck className="h-3.5 w-3.5" /> Before you buy
                  </p>
                  <ul className="space-y-1.5">
                    {terms.disclosure.map((line) => (
                      <li key={line} className="text-xs leading-relaxed text-tertiary">{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/*
            * Sending it to one person, which is the author's alternative to
            * publishing. Author only — it mints links to their own listing —
            * and below the buying card because a listing is read before it is
            * sent.
            */}
          {isAuthor && <ShareLinks listingId={listing.id} />}
        </div>
      </div>
    </div>
  );
}
