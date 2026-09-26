/**
 * The marketplace: three things a year, and a number nobody else can see.
 *
 * ## The screen is built around not knowing
 *
 * Every instinct in an auction interface is to show you where you stand —
 * the current high bid, how many people are watching, whether you have been
 * outbid. All of it is deliberately absent, because the server does not send
 * it and the design depends on it not existing.
 *
 * A visible high bid turns this into a countdown won by whoever is awake at
 * the end of it, which in a game played across time zones for a fortnight
 * means the marketplace belongs to whoever sleeps least. Sealed, the question
 * is the interesting one instead: what is this worth to *us*, and how badly
 * does the team two seats over want it?
 *
 * So the screen's job is to make that judgement easy — what the thing does,
 * how long it lasts, what it would cost, what the company can afford — and
 * then to get out of the way. The blank where the competition would be is the
 * feature.
 *
 * ## Why what you own is on the same page
 *
 * A team in trouble sells to a team that is not, and both of those are moves
 * on this screen. Putting holdings beside listings means the trade is visible
 * as a trade: this is what we would get for the distribution deal, and that is
 * what the patent across the page would cost us.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText, isYearClosing } from "@/lib/api-error";
import { Loader2, Store, Gavel, Package, Info } from "lucide-react";
import { SimHeader } from "@/components/sim/sim-header";
import { DeskCurrency, DeskPeriod, lastsFor, useMoney, usePeriod } from "@/components/sim/desk-currency";

interface Effect { brand?: number; quality?: number; service?: number; capacity?: number; unitCost?: number }
interface Listing {
  id: string; name: string; kind: string; blurb: string; effect: Effect;
  expiresIn: number | null; reserve: number; seller: string | null; yourBid: number | null;
}
interface Holding {
  id: string; name: string; kind: string; effect: Effect; expiresIn: number | null;
  bookValue: number; willingSale: number; forcedSale: number;
}
/** Where this company stands on each axis a lot can move. */
interface You {
  quality: number; brand: number; service: number; capacity: number; unitCost: number;
}

interface Market {
  year: number;
  you?: You | null;
  /** What one decision is called here, and how many make a year. */
  period?: { one: string; many: string; of: string };
  periods?: number;
  currency?: string;
  yourRole: string;
  funds: number;
  listings: Listing[];
  holdings: Holding[];
  selling: { id: string; name: string; reserve: number; status: string }[];
}



/** What an asset does, in the words a player would use rather than as a field dump. */
/**
 * What a lot would do, said against the company that might buy it.
 *
 * "+6 quality" and "+4,038 capacity" are what the asset adds to somebody. The
 * decision is what they make *this* company, and answering that meant holding
 * two numbers from two screens in your head — a founder said so. Where the
 * company's own standing is known the line reads "quality 54 → 60", and where
 * it is not it falls back to the bare addition rather than inventing one.
 *
 * Capacity deliberately counts what the company's existing assets already
 * add, because that is what "your room" means everywhere else on the desk; a
 * number here that disagreed with the one there would be worse than no number.
 */
function describe(effect: Effect, you?: You | null): string[] {
  const parts: string[] = [];
  const move = (label: string, add: number, from: number | undefined) =>
    from === undefined
      ? `+${add.toLocaleString()} ${label}`
      : `${label} ${Math.round(from).toLocaleString()} → ${Math.round(from + add).toLocaleString()}`;

  if (effect.brand) parts.push(move("brand", effect.brand, you?.brand));
  if (effect.quality) parts.push(move("quality", effect.quality, you?.quality));
  if (effect.service) parts.push(move("service", effect.service, you?.service));
  if (effect.capacity) parts.push(move("room", effect.capacity, you?.capacity));
  if (effect.unitCost && effect.unitCost !== 1) {
    const off = `${Math.round((1 - effect.unitCost) * 100)}% off every unit`;
    parts.push(you?.unitCost ? `${off} — ${you.unitCost} → ${Math.round(you.unitCost * effect.unitCost * 100) / 100}` : off);
  }
  return parts;
}

export default function SimulationMarketPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: market, isLoading } = useQuery<Market>({
    queryKey: [`/api/sim/ventures/${id}/market`],
    refetchInterval: 15_000,
    /*
     * The app default is `staleTime: Infinity`: after a year resolved this
     * showed listings that had already sold at the tick, with bid buttons on
     * them. Always refetch on arrival; the poll carries it from there.
     */
    staleTime: 0,
    refetchOnMount: "always",
  });

  /*
   * Above the early return, because these are hooks.
   *
   * They used to sit below it, so the first render — the loading one — called
   * two fewer hooks than every render after it. React matches hooks by call
   * order, and a component whose hook count changes between renders is the one
   * thing the rules exist to prevent: it works until something makes the
   * spinner render and the loaded render share a mount, and then it throws
   * "rendered more hooks than during the previous render" somewhere else
   * entirely. Both take an optional argument and fall back to the context, so
   * moving them costs nothing while the payload is still in flight.
   */
  const period = usePeriod(market?.period ? { ...market.period, perYear: market.periods } : undefined);
  const { compact } = useMoney(market?.currency as any);

  if (isLoading || !market) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const isCeo = market.yourRole === "ceo";
  const Period = period.one.charAt(0).toUpperCase() + period.one.slice(1);

  return (
    <DeskCurrency.Provider value={(market.currency as any) ?? "USD"}>
    <DeskPeriod.Provider value={period}>
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-4">
      <SimHeader icon={Store} title="The market" onBack={() => navigate(`/simulation/${id}`)}>
        <p className="text-sm text-muted-foreground mt-1">
          {Period} {market.year}. Bids are sealed — nobody sees anyone else's, including you, until the {period.one} resolves.
          The highest offer over the reserve takes it and pays what they bid.
        </p>
        {!isCeo && (
          <p className="text-sm mt-3 rounded-lg bg-muted/60 px-3 py-2 text-muted-foreground" data-testid="text-bidding-is-ceos">
            Bidding is the chief executive's call. You can see what has been bid and what it would buy, and argue for it
            before the year resolves.
          </p>
        )}
        <p className="text-sm mt-3">
          <span className="text-muted-foreground">{isCeo ? "You can back bids up to " : "The company can back bids up to "}</span>
          <span className="font-semibold tabular-nums" data-testid="text-funds">{compact(market.funds)}</span>
          <span className="text-muted-foreground"> — cash plus what is still borrowable.</span>
        </p>
      </SimHeader>

      {market.listings.length === 0 ? (
        <Card className="rounded-2xl nova-ring-soft"><CardContent className="p-6 text-sm text-muted-foreground">Nothing is for sale this year.</CardContent></Card>
      ) : (
        market.listings.map((listing) => <ListingCard key={listing.id} listing={listing} ventureId={id} funds={market.funds} isCeo={isCeo} you={market.you} />)
      )}

      <Card className="rounded-2xl nova-ring-soft">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">What you own</h2>
          </div>

          {market.holdings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet. Everything above is somebody else's advantage until it isn't.</p>
          ) : (
            <div className="space-y-4">
              {market.holdings.map((holding) => (
                <HoldingRow key={holding.id} holding={holding} ventureId={id} listed={market.selling} />
              ))}
            </div>
          )}

          {market.selling.length > 0 && (
            <div className="mt-4 border-t border-border pt-3 space-y-1.5">
              {market.selling.map((s) => (
                <p key={s.id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{s.name}</span> is up for sale at {compact(s.reserve)} ({s.status}).
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </DeskPeriod.Provider>
    </DeskCurrency.Provider>
  );
}

function ListingCard({ listing, ventureId, funds, isCeo, you }: {
  listing: Listing; ventureId: string; funds: number; isCeo: boolean;
  /** This company's own standing, so the lot can say what it would make it. */
  you?: You | null;
}) {
  const { compact } = useMoney();
  const period = usePeriod();
  const { toast } = useToast();
  const [amount, setAmount] = useState<string>(String(listing.yourBid ?? listing.reserve));

  const bid = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sim/ventures/${ventureId}/bids`, { listingId: listing.id, amount: Number(amount) }),
    onSuccess: () => {
      toast({ title: "Bid placed", description: "Nobody else can see it. You can change it until the year resolves." });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/market`] });
    },
    onError: (err) => refusal(err, "Couldn't bid", toast, () =>
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/market`] })),
  });

  const withdraw = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/sim/ventures/${ventureId}/bids/${listing.id}`, undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/market`] }),
    /*
     * It used to fail in silence — the listing had settled, or the season
     * ended, and the button just stopped doing anything. Say why, and refetch
     * so the card shows what actually happened to the bid.
     */
    onError: (err) => refusal(err, "Couldn't withdraw the bid", toast, () =>
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/market`] })),
  });

  const n = Number(amount);
  const underReserve = Number.isFinite(n) && n < listing.reserve;
  const beyondMeans = Number.isFinite(n) && n > funds;

  return (
    <Card className="rounded-2xl nova-ring-soft">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold">{listing.name}</h3>
              <Badge variant="outline" className="text-[10px]">{listing.kind.replace(/_/g, " ")}</Badge>
              {listing.seller && <Badge variant="secondary" className="text-[10px]">from {listing.seller}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground mt-1">{listing.blurb}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">Reserve</p>
            <p className="font-semibold tabular-nums">{compact(listing.reserve)}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {describe(listing.effect, you).map((part) => (
            <span key={part} className="text-xs rounded-full bg-primary/10 text-primary px-2 py-0.5">{part}</span>
          ))}
          <span className="text-xs rounded-full bg-muted text-muted-foreground px-2 py-0.5">
            {listing.expiresIn ? lastsFor(listing.expiresIn, period) : "never expires"}
          </span>
        </div>

        {isCeo && (
          <div className="mt-4 flex flex-wrap gap-2 items-center">
            <Input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-40 tabular-nums"
              data-testid={`input-bid-${listing.id}`}
            />
            <Button size="sm" onClick={() => bid.mutate()} disabled={bid.isPending} data-testid={`button-bid-${listing.id}`}>
              <Gavel className="h-3.5 w-3.5 mr-1.5" />
              {listing.yourBid !== null ? "Change your bid" : "Bid"}
            </Button>
            {listing.yourBid !== null && (
              <Button size="sm" variant="ghost" onClick={() => withdraw.mutate()} data-testid={`button-withdraw-${listing.id}`}>
                Withdraw
              </Button>
            )}
          </div>
        )}

        {/*
          * The bid is the company's, so every seat sees it — what was offered
          * and what it would buy — while the chair that answers for the
          * company's money is the one that files it.
          */}
        {listing.yourBid !== null && (
          <p className="text-xs text-muted-foreground mt-2" data-testid={`text-your-bid-${listing.id}`}>
            {isCeo ? "Your bid" : "Your chief executive has bid"}:{" "}
            <span className="tabular-nums font-medium text-foreground">{compact(listing.yourBid)}</span>. Sealed until the year resolves.
          </p>
        )}
        {!isCeo && listing.yourBid === null && (
          <p className="text-xs text-muted-foreground mt-2" data-testid={`text-no-bid-${listing.id}`}>
            Nothing bid on this yet.
          </p>
        )}
        {underReserve && <p className="text-xs text-amber-600 mt-1">Under the reserve — this would buy nothing.</p>}
        {beyondMeans && <p className="text-xs text-destructive mt-1">More than the company can back. It would lose at settlement.</p>}
      </CardContent>
    </Card>
  );
}

/**
 * A refusal, said the way it deserves.
 *
 * `year_closing` is not a failure: the request was fine and arrived during
 * the seconds a year is being resolved. The server marks it specially so a
 * screen can say "a moment" instead of going red, and every screen that
 * forgets to check turns that care back into an error message.
 */
function refusal(err: unknown, title: string, toast: (o: any) => void, refetch: () => void) {
  if (isYearClosing(err)) {
    toast({ title: "That year just closed", description: "Next year is opening now — the market is catching up." });
  } else {
    toast({ title, description: errorText(err, "Try again."), variant: "destructive" });
  }
  refetch();
}

function HoldingRow({ holding, ventureId, listed }: {
  holding: Holding; ventureId: string; listed: { id: string; name: string; status: string }[];
}) {
  const { compact } = useMoney();
  const period = usePeriod();
  const { toast } = useToast();
  const [reserve, setReserve] = useState(String(holding.willingSale));
  const [selling, setSelling] = useState(false);
  /*
   * The listing this holding is, if it is up. Kept whole rather than reduced
   * to a yes/no, because taking it down needs its id — which the screen was
   * already being sent and was throwing away, which is why the web could put
   * something up for sale and never take it down again while the phone could.
   */
  const up = listed.find((l) => l.name === holding.name) ?? null;

  const list = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sim/ventures/${ventureId}/listings`, { assetId: holding.id, reserve: Number(reserve) }),
    onSuccess: () => {
      toast({ title: "Up for sale", description: "Every other team in the season can bid on it." });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/market`] });
      setSelling(false);
    },
    onError: (err) => refusal(err, "Couldn't list it", toast, () =>
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/market`] })),
  });

  const withdraw = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/sim/ventures/${ventureId}/listings/${up!.id}`),
    onSuccess: () => {
      toast({ title: "Taken off the market", description: "Nobody can bid on it now." });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/market`] });
    },
    onError: (err) => refusal(err, "Couldn't withdraw it", toast, () =>
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/market`] })),
  });

  return (
    <div className="border-b border-border last:border-0 pb-3 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{holding.name}</p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {describe(holding.effect).map((part) => (
              <span key={part} className="text-xs text-muted-foreground">{part}</span>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {holding.expiresIn ? `${lastsFor(holding.expiresIn, period)} left` : "Yours permanently"} · cost {compact(holding.bookValue)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">Worth now</p>
          <p className="text-sm font-semibold tabular-nums">{compact(holding.willingSale)}</p>
          <p className="text-[11px] text-muted-foreground">{compact(holding.forcedSale)} in a hurry</p>
        </div>
      </div>

      {up ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">Up for sale.</p>
          <Button
            size="sm" variant="ghost" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}
            data-testid={`button-withdraw-${holding.id}`}
          >
            {withdraw.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Take it down
          </Button>
        </div>
      ) : selling ? (
        <div className="mt-2 flex flex-wrap gap-2 items-center">
          <Input type="number" value={reserve} onChange={(e) => setReserve(e.target.value)} className="w-36 tabular-nums" data-testid={`input-reserve-${holding.id}`} />
          <Button size="sm" onClick={() => list.mutate()} disabled={list.isPending} data-testid={`button-list-${holding.id}`}>Put it up</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelling(false)}>Cancel</Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => setSelling(true)} data-testid={`button-sell-${holding.id}`}>
          Sell it
        </Button>
      )}

      {selling && (
        <p className="text-xs text-muted-foreground mt-1.5 flex gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          Set what you will not go below. Nobody has to meet it — a reserve nobody meets is its own answer.
        </p>
      )}
    </div>
  );
}
