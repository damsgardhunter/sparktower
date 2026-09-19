/**
 * Buying somebody's company, and being offered money for yours.
 *
 * ## The thing this screen must not do
 *
 * It must never read like an elimination notice.
 *
 * An acquisition here buys the business, not the people: the customers, the
 * assets and the debts move, and the team that sold keeps its company, every
 * seat, its reputation and a great deal of cash. They carry on. Selling can be
 * the right move — cashing out of a position you cannot defend and rebuilding
 * with more money than anyone else in the market has got.
 *
 * If this screen framed an incoming offer as a threat, players would decline
 * on instinct and the most interesting decision in the game would never get
 * made. So the offer is shown as what it is: a number, against what the
 * business is actually worth, with what you would keep spelled out beside it.
 *
 * ## Both sides see the same arithmetic
 *
 * The valuation is published to the buyer and the seller alike, deliberately.
 * A negotiation where only one side can do the maths is a trick played on
 * whoever is newer to the game. The interesting argument is not what a company
 * is worth — that is arithmetic — but what it is worth *to you*, and that one
 * only starts once the boring part is settled.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Handshake, Check, X, Info } from "lucide-react";
import { SimHeader } from "@/components/sim/sim-header";

interface Target {
  id: string; name: string; customers: number; distress: string;
  revenue: number; assets: number; debt: number; fair: number; notes: string[]; hollow: boolean;
}
interface Received {
  id: string; from: string; fromId: string; amount: number; message: string | null; status: string;
  fair: number; ratio: number; verdict: "generous" | "fair" | "low" | "insulting"; note: string;
}
interface Offers {
  year: number; totalYears: number; yourRole: string | null; resolvesAt: string | null;
  you: { name: string; revenue: number; assets: number; debt: number; fair: number; notes: string[] };
  reach: number;
  targets: Target[];
  made: { id: string; to: string; toId: string; amount: number; message: string | null; status: string }[];
  received: Received[];
}

const compact = (n: number) =>
  n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(1)}m` : n >= 1_000 ? `£${Math.round(n / 1_000)}k` : `£${Math.round(n)}`;

export default function SimulationOffersPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<Offers>({
    queryKey: [`/api/sim/ventures/${id}/offers`],
    refetchInterval: 15_000,
  });

  if (isLoading || !data) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const isCeo = data.yourRole === "ceo";
  const live = data.received.filter((o) => o.status === "pending");

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-4">
      <SimHeader icon={Handshake} title="The boardroom" onBack={() => navigate(`/simulation/${id}`)}>
        <p className="text-sm text-muted-foreground mt-1">
          A company can be bought and sold here. What changes hands is the business — customers, what it owns, what it
          owes. What the seller keeps is the company, every seat, their reputation and the money.
        </p>
        <div className="mt-3 text-sm">
          <p><span className="text-muted-foreground">{data.you.name} is worth about </span>
            <span className="font-semibold tabular-nums" data-testid="text-your-value">{compact(data.you.fair)}</span></p>
          <p className="text-xs text-muted-foreground mt-0.5">{data.you.notes.join(" ")}</p>
          <p className="text-xs text-muted-foreground mt-1">You can back an offer up to {compact(data.reach)}, counting credit.</p>
        </div>
      </SimHeader>

      {!isCeo && (
        <Card className="rounded-2xl nova-ring-soft">
          <CardContent className="p-4 text-sm text-muted-foreground flex gap-2">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            Buying and selling the company is the chief executive's call. You can see everything here — worth a conversation
            with them before anybody answers anything.
          </CardContent>
        </Card>
      )}

      {live.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold px-1">On the table for you</h2>
          {live.map((offer) => <ReceivedCard key={offer.id} offer={offer} ventureId={id} isCeo={isCeo} />)}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold px-1">Who you could buy</h2>
        {data.targets.length === 0 && (
          <Card className="rounded-2xl nova-ring-soft"><CardContent className="p-5 text-sm text-muted-foreground">
            Nobody else is running a company in this market. The incumbents are not for sale — they were here before you
            and they intend to be here after.
          </CardContent></Card>
        )}
        {data.targets.map((target) => (
          <TargetCard
            key={target.id}
            target={target}
            ventureId={id}
            isCeo={isCeo}
            reach={data.reach}
            existing={data.made.find((m) => m.toId === target.id && m.status === "pending")}
          />
        ))}
      </div>

      {data.made.filter((m) => m.status !== "pending").length > 0 && (
        <Card className="rounded-2xl nova-ring-soft">
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-2">What happened to your offers</h2>
            {data.made.filter((m) => m.status !== "pending").map((m) => (
              <p key={m.id} className="text-sm text-muted-foreground">
                {compact(m.amount)} for {m.to} — {m.status === "accepted" ? "accepted." : m.status === "declined" ? "declined." : m.status === "lapsed" ? "never answered, and it lapsed when the year resolved." : "withdrawn."}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReceivedCard({ offer, ventureId, isCeo }: { offer: Received; ventureId: string; isCeo: boolean }) {
  const { toast } = useToast();

  const respond = useMutation({
    mutationFn: (accept: boolean) =>
      apiRequest("POST", `/api/sim/ventures/${ventureId}/offers/${offer.id}/respond`, { accept }),
    onSuccess: async (res: any) => {
      toast({ title: res?.status === "accepted" ? "Agreed" : "Declined", description: res?.message });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/offers`] });
    },
    onError: (err: any) => toast({ title: "Couldn't answer", description: err?.body?.message ?? "Try again.", variant: "destructive" }),
  });

  const tone = offer.verdict === "generous" ? "border-primary"
    : offer.verdict === "fair" ? "border-border"
    : "border-amber-500/60";

  return (
    <Card className={tone}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{offer.from} wants to buy the business</p>
            <p className="text-3xl font-bold tabular-nums mt-1" data-testid={`text-offer-${offer.id}`}>{compact(offer.amount)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Against roughly {compact(offer.fair)} of business. <span className="text-foreground">{offer.note}</span>
            </p>
          </div>
          <Badge variant={offer.verdict === "generous" ? "default" : "secondary"} className="shrink-0">{offer.verdict}</Badge>
        </div>

        {offer.message && (
          <p className="text-sm mt-3 rounded-lg bg-muted p-3 italic">“{offer.message}”</p>
        )}

        {/*
          * What selling actually means, said before anybody presses anything.
          * Without this an offer reads as a threat, people decline on instinct,
          * and the most interesting decision in the game never gets made.
          */}
        <div className="mt-4 rounded-lg border border-border p-3">
          <p className="text-xs font-medium">If you take it</p>
          <p className="text-xs text-muted-foreground mt-1">
            The customers, what you own and what you owe all go to them. You keep the company, every seat, your
            reputation, and {compact(offer.amount)} in cash — more than anyone else in this market. You are not out of
            the season; you would be starting again, from in front.
          </p>
        </div>

        {isCeo ? (
          <div className="flex gap-2 mt-4">
            <Button size="sm" onClick={() => respond.mutate(true)} disabled={respond.isPending} data-testid={`button-accept-${offer.id}`}>
              <Check className="h-4 w-4 mr-1.5" /> Take it
            </Button>
            <Button size="sm" variant="outline" onClick={() => respond.mutate(false)} disabled={respond.isPending} data-testid={`button-decline-${offer.id}`}>
              <X className="h-4 w-4 mr-1.5" /> Decline
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mt-3">Only your chief executive can answer this.</p>
        )}
      </CardContent>
    </Card>
  );
}

function TargetCard({ target, ventureId, isCeo, reach, existing }: {
  target: Target; ventureId: string; isCeo: boolean; reach: number;
  existing?: { id: string; amount: number };
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(String(existing?.amount ?? target.fair));
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);

  const offer = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sim/ventures/${ventureId}/offers`, {
      targetId: target.id, amount: Number(amount), message,
    }),
    onSuccess: () => {
      toast({ title: "Offer made", description: `${target.name} decides before the year resolves.` });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/offers`] });
      setOpen(false);
    },
    onError: (err: any) => toast({ title: "Couldn't make that offer", description: err?.body?.message ?? "Try again.", variant: "destructive" }),
  });

  const withdraw = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/sim/ventures/${ventureId}/offers/${existing!.id}`, undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/offers`] }),
  });

  return (
    <Card className="rounded-2xl nova-ring-soft">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold">{target.name}</h3>
              {target.distress !== "healthy" && (
                <Badge variant="secondary" className="text-[10px]">
                  {target.distress === "insolvent" ? "insolvent" : target.distress === "distressed" ? "in trouble" : "stretched"}
                </Badge>
              )}
              {target.hollow && <Badge variant="outline" className="text-[10px]">already sold</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{target.notes.join(" ")}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">Worth about</p>
            <p className="font-semibold tabular-nums">{compact(target.fair)}</p>
          </div>
        </div>

        {existing ? (
          <div className="mt-4 rounded-lg border border-border p-3">
            <p className="text-sm">Your offer of <span className="font-medium tabular-nums">{compact(existing.amount)}</span> is with them.</p>
            <p className="text-xs text-muted-foreground mt-1">They decide before the year resolves. Unanswered, it lapses.</p>
            {isCeo && (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => withdraw.mutate()} data-testid={`button-withdraw-offer-${target.id}`}>
                Take it back
              </Button>
            )}
          </div>
        ) : isCeo && !target.hollow ? (
          open ? (
            <div className="mt-4 space-y-2">
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular-nums"
                data-testid={`input-offer-${target.id}`}
              />
              <Textarea
                placeholder="Say something to them. This is a negotiation between people."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                maxLength={280}
                data-testid={`input-message-${target.id}`}
              />
              {Number(amount) > reach && (
                <p className="text-xs text-destructive">More than you can back. An offer you can't pay wastes their day.</p>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => offer.mutate()} disabled={offer.isPending} data-testid={`button-offer-${target.id}`}>
                  Make the offer
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setOpen(true)} data-testid={`button-open-offer-${target.id}`}>
              Offer to buy them
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
