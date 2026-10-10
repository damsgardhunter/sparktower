/**
 * Publishing a simulation: the agreement, the price, and the button.
 *
 * The agreement is the screen rather than a checkbox above the button. Six
 * plain statements, each one something the platform will actually act on — a
 * person who reads them knows what happens if their listing is reported, and a
 * person who does not has still been shown them rather than a link. Consent
 * that cannot be evidenced is worth nothing, so the version is sent back with
 * the acceptance and a stale tab cannot agree to text it never displayed.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, ShieldCheck, ArrowLeft, Check } from "lucide-react";

interface Terms {
  version: number;
  terms: { id: string; heading: string; body: string }[];
  current: boolean;
}

export default function SimulationPublishPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [agreed, setAgreed] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [pricing, setPricing] = useState<"free" | "perSeat">("free");
  const [dollars, setDollars] = useState("3.00");

  const { data: terms } = useQuery<Terms>({ queryKey: ["/api/sim-market/seller-terms"] });
  const { data: mine } = useQuery<{ listings: { id: string; title: string; status: string }[] }>({
    queryKey: ["/api/sim-market/me"],
  });

  const accept = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/sim-market/seller-terms", { version: terms?.version }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/sim-market/seller-terms"] });
      toast({ title: "Agreement accepted", description: "You can publish simulations now." });
    },
    onError: (e: any) => toast({
      title: "Couldn't record that",
      description: e?.message ?? "The terms may have changed — reload and read them again.",
      variant: "destructive",
    }),
  });

  const drafts = (mine?.listings ?? []).filter((l) => l.status === "draft");

  const publish = useMutation({
    mutationFn: async (listingId: string) => apiRequest("POST", `/api/sim-market/listings/${listingId}/publish`, {
      title: title.trim(),
      summary: summary.trim(),
      pricing,
      seatPriceCents: Math.round(Number(dollars) * 100),
    }),
    onSuccess: async (res: any) => {
      const body = await res.json();
      setLocation(`/simulations/market/${body.listing.id}`);
    },
    onError: (e: any) => toast({ title: "Couldn't publish", description: e?.message ?? "Check the details", variant: "destructive" }),
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => setLocation("/simulations/market")}>
        <ArrowLeft className="mr-1 h-4 w-4" /> Marketplace
      </Button>

      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Publish a simulation</h1>
      <p className="mt-2 text-secondary">
        Let other people play a market you built, free or for a price per seat.
      </p>

      {/* The agreement, first and at full size, because it is what is being agreed to. */}
      <Card className="mt-6 nova-ring-soft border-0">
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" /> Seller agreement
            </h2>
            {terms?.current && (
              <Badge variant="secondary" className="gap-1" data-testid="badge-terms-accepted">
                <Check className="h-3 w-3" /> Accepted
              </Badge>
            )}
          </div>

          <div className="mt-4 space-y-4">
            {terms?.terms.map((term) => (
              <div key={term.id}>
                <p className="text-sm font-medium">{term.heading}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-secondary">{term.body}</p>
              </div>
            ))}
          </div>

          {!terms?.current && (
            <div className="mt-5 border-t border-border pt-4">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} data-testid="checkbox-agree" />
                <span className="text-sm text-secondary">
                  I have read these and they are true of what I am publishing.
                </span>
              </label>
              <Button
                className="mt-3"
                disabled={!agreed || accept.isPending}
                onClick={() => accept.mutate()}
                data-testid="button-accept-terms"
              >
                {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept and continue"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/*
        * The listing details, dimmed until the agreement is accepted rather
        * than hidden. Somebody deciding whether to sell here wants to see what
        * selling involves before they commit to the terms.
        */}
      <Card className={`mt-5 nova-ring-soft border-0 ${terms?.current ? "" : "pointer-events-none opacity-50"}`}>
        <CardContent className="space-y-4 p-5 sm:p-6">
          <h2 className="font-semibold">The listing</h2>

          {drafts.length === 0 ? (
            <p className="text-sm text-secondary">
              You have no draft simulations yet. Build a market from one of your projects first — a draft is private
              and costs nothing.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="title">Name</Label>
                <Input
                  id="title" value={title} maxLength={80}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={drafts[0]?.title ?? "Veterinary scheduling"}
                  data-testid="input-listing-title"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="summary">What a table is walking into</Label>
                <Textarea
                  id="summary" value={summary} maxLength={400} rows={3}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Two incumbents hold most of it and the way in is narrower than it looks."
                  data-testid="input-listing-summary"
                />
                <p className="text-xs text-tertiary">{summary.length}/400 — this is the sentence on the card.</p>
              </div>

              <div className="space-y-2">
                <Label>Price</Label>
                <RadioGroup value={pricing} onValueChange={(v) => setPricing(v as "free" | "perSeat")}>
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <RadioGroupItem value="free" data-testid="radio-free" />
                    <span className="text-sm">Free — anybody can play it</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <RadioGroupItem value="perSeat" data-testid="radio-per-seat" />
                    <span className="text-sm">A price per seat</span>
                  </label>
                </RadioGroup>
                {pricing === "perSeat" && (
                  <div className="pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-tertiary">$</span>
                      <Input
                        value={dollars} onChange={(e) => setDollars(e.target.value)}
                        className="w-24" inputMode="decimal" data-testid="input-seat-price"
                      />
                      <span className="text-sm text-tertiary">a seat</span>
                    </div>
                    {/*
                      * What they will actually receive, worked out here rather
                      * than left for them to do. A seller who discovers the
                      * platform's share only on their first payout has been
                      * told, but not in time to decide.
                      */}
                    <p className="mt-1.5 text-xs text-tertiary">
                      A table of five pays ${(Number(dollars) * 5 || 0).toFixed(2)}; you keep{" "}
                      ${((Number(dollars) * 5 || 0) * 0.85).toFixed(2)} of it, released 14 days after the sale.
                    </p>
                  </div>
                )}
              </div>

              <Button
                className="w-full"
                disabled={!terms?.current || publish.isPending || !drafts[0]}
                onClick={() => drafts[0] && publish.mutate(drafts[0].id)}
                data-testid="button-publish"
              >
                {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Publish to the marketplace"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
