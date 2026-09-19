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
import { NOVA_GRADIENT_CSS } from "@shared/backing";
import { Loader2, ArrowLeft, Store, Gavel, Package, Info } from "lucide-react";

interface Effect { brand?: number; quality?: number; service?: number; capacity?: number; unitCost?: number }
interface Listing {
  id: string; name: string; kind: string; blurb: string; effect: Effect;
  expiresIn: number | null; reserve: number; seller: string | null; yourBid: number | null;
}
interface Holding {
  id: string; name: string; kind: string; effect: Effect; expiresIn: number | null;
  bookValue: number; willingSale: number; forcedSale: number;
}
interface Market {
  year: number;
  funds: number;
  listings: Listing[];
  holdings: Holding[];
  selling: { id: string; name: string; reserve: number; status: string }[];
}

const compact = (n: number) =>
  n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(1)}m` : n >= 1_000 ? `£${Math.round(n / 1_000)}k` : `£${Math.round(n)}`;

/** What an asset does, in the words a player would use rather than as a field dump. */
function describe(effect: Effect): string[] {
  const parts: string[] = [];
  if (effect.brand) parts.push(`+${effect.brand} brand`);
  if (effect.quality) parts.push(`+${effect.quality} quality`);
  if (effect.service) parts.push(`+${effect.service} service`);
  if (effect.capacity) parts.push(`+${effect.capacity.toLocaleString()} capacity`);
  if (effect.unitCost && effect.unitCost !== 1) {
    parts.push(`${Math.round((1 - effect.unitCost) * 100)}% off every unit`);
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
  });

  if (isLoading || !market) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-4">
      <div className="rounded-2xl p-[2px]" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>
        <div className="rounded-[calc(1rem-1px)] bg-background p-6">
          <button onClick={() => navigate(`/simulation/${id}`)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2" data-testid="button-back-desk">
            <ArrowLeft className="h-3 w-3" /> Back to your desk
          </button>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" /> The market
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Year {market.year}. Bids are sealed — nobody sees anyone else's, including you, until the year resolves.
            The highest offer over the reserve takes it and pays what they bid.
          </p>
          <p className="text-sm mt-3">
            <span className="text-muted-foreground">You can back bids up to </span>
            <span className="font-semibold tabular-nums" data-testid="text-funds">{compact(market.funds)}</span>
            <span className="text-muted-foreground"> — cash plus what is still borrowable.</span>
          </p>
        </div>
      </div>

      {market.listings.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Nothing is for sale this year.</CardContent></Card>
      ) : (
        market.listings.map((listing) => <ListingCard key={listing.id} listing={listing} ventureId={id} funds={market.funds} />)
      )}

      <Card>
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
  );
}

function ListingCard({ listing, ventureId, funds }: { listing: Listing; ventureId: string; funds: number }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState<string>(String(listing.yourBid ?? listing.reserve));

  const bid = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sim/ventures/${ventureId}/bids`, { listingId: listing.id, amount: Number(amount) }),
    onSuccess: () => {
      toast({ title: "Bid placed", description: "Nobody else can see it. You can change it until the year resolves." });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/market`] });
    },
    onError: (err: any) => toast({ title: "Couldn't bid", description: err?.body?.message ?? "Try again.", variant: "destructive" }),
  });

  const withdraw = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/sim/ventures/${ventureId}/bids/${listing.id}`, undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/market`] }),
  });

  const n = Number(amount);
  const underReserve = Number.isFinite(n) && n < listing.reserve;
  const beyondMeans = Number.isFinite(n) && n > funds;

  return (
    <Card>
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
          {describe(listing.effect).map((part) => (
            <span key={part} className="text-xs rounded-full bg-primary/10 text-primary px-2 py-0.5">{part}</span>
          ))}
          <span className="text-xs rounded-full bg-muted text-muted-foreground px-2 py-0.5">
            {listing.expiresIn ? `${listing.expiresIn} years` : "never expires"}
          </span>
        </div>

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

        {listing.yourBid !== null && (
          <p className="text-xs text-muted-foreground mt-2" data-testid={`text-your-bid-${listing.id}`}>
            Your bid: <span className="tabular-nums font-medium text-foreground">{compact(listing.yourBid)}</span>. Sealed until the year resolves.
          </p>
        )}
        {underReserve && <p className="text-xs text-amber-600 mt-1">Under the reserve — this would buy nothing.</p>}
        {beyondMeans && <p className="text-xs text-destructive mt-1">More than the company can back. It would lose at settlement.</p>}
      </CardContent>
    </Card>
  );
}

function HoldingRow({ holding, ventureId, listed }: {
  holding: Holding; ventureId: string; listed: { name: string }[];
}) {
  const { toast } = useToast();
  const [reserve, setReserve] = useState(String(holding.willingSale));
  const [selling, setSelling] = useState(false);
  const alreadyUp = listed.some((l) => l.name === holding.name);

  const list = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sim/ventures/${ventureId}/listings`, { assetId: holding.id, reserve: Number(reserve) }),
    onSuccess: () => {
      toast({ title: "Up for sale", description: "Every other team in the season can bid on it." });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/market`] });
      setSelling(false);
    },
    onError: (err: any) => toast({
      title: "Couldn't list it",
      description: err?.body?.message ?? "Try again.",
      variant: "destructive",
    }),
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
            {holding.expiresIn ? `${holding.expiresIn} years left` : "Yours permanently"} · cost {compact(holding.bookValue)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">Worth now</p>
          <p className="text-sm font-semibold tabular-nums">{compact(holding.willingSale)}</p>
          <p className="text-[11px] text-muted-foreground">{compact(holding.forcedSale)} in a hurry</p>
        </div>
      </div>

      {alreadyUp ? (
        <p className="text-xs text-muted-foreground mt-2">Already up for sale.</p>
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
