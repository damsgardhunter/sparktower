import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Loader2, Heart, Shirt, ShieldCheck, Lock, Check, Users,
} from "lucide-react";
import {
  BELIEVER_TAGLINE, DIGITAL_REWARDS, TIP_PRESET_PERCENTS, MIN_PLEDGE_CENTS,
  merchProduct, formatBelieverNumber, tierForAmount, tierNeedsShipping,
  type MerchConfig,
} from "@shared/backing";

interface PublicTier {
  id: string;
  amountCents: number;
  name: string;
  description: string | null;
  digitalRewards: string[] | null;
  merchProducts: string[] | null;
  maxBackers: number | null;
  claimed: number;
  soldOut: boolean;
}

interface PublicCampaign {
  campaign: {
    headline: string | null;
    story: string | null;
    goalCents: number | null;
    startedAt: string | null;
    merchConfig: MerchConfig;
    fundsHeld: boolean;
  };
  tiers: PublicTier[];
  wall: {
    believerNumber: number | null;
    name: string;
    image: string | null;
    message: string | null;
    tierName: string | null;
  }[];
  raisedCents: number;
  backers: number;
  defaultTipPercent: number;
  refundWindowDays: number;
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2,
  })}`;

/**
 * The backer's side of a campaign.
 *
 * Returns null when the project isn't running one, so the page can drop it in
 * unconditionally. Everything money-related is stated plainly rather than in
 * fine print: what's held, why, and what happens if the creator never earns it
 * out. Being upfront about the tip is the only reason people tip.
 */
export function BackingPanel({
  projectId, projectTitle, isOwner,
}: {
  projectId: string;
  projectTitle: string;
  isOwner: boolean;
}) {
  const { toast } = useToast();
  const [checkoutTier, setCheckoutTier] = useState<PublicTier | null>(null);

  const { data, isError } = useQuery<PublicCampaign>({
    queryKey: ["/api/projects", projectId, "backing", "public"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/backing/public`, { credentials: "include" });
      if (!res.ok) throw new Error("no campaign");
      return res.json();
    },
    enabled: !!projectId,
    retry: false,
  });

  /*
   * No campaign. Visitors see nothing — an unopened campaign isn't news — but
   * the owner gets pointed at it, because the old always-on Donate button used
   * to be here and its absence would otherwise read as a missing feature
   * rather than as something they haven't switched on yet.
   */
  if (isError && !data) {
    if (!isOwner) return null;
    return (
      <Card data-testid="backing-panel-empty">
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-medium flex items-center gap-2">
            <Heart className="h-4 w-4 text-primary" /> Let people back this
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Set up tiers and merch and people can put money behind you. Held by SparkTower
            until the project is reviewed, so backers know it's safe to give.
          </p>
          <Button
            size="sm" variant="outline" className="w-full"
            onClick={() => { window.location.href = `/projects/${projectId}/manage`; }}
            data-testid="button-setup-backing"
          >
            Set up backing
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;
  const { campaign, tiers, wall } = data;
  const progress = campaign.goalCents
    ? Math.min(100, Math.round((data.raisedCents / campaign.goalCents) * 100))
    : null;

  return (
    <>
      <Card data-testid="backing-panel">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Heart className="h-4 w-4 text-primary fill-current" /> Back this project
          </CardTitle>
          {campaign.headline && (
            <p className="text-sm text-secondary leading-relaxed">{campaign.headline}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-2xl font-bold">{money(data.raisedCents)}</span>
              <span className="text-sm text-muted-foreground">
                {data.backers} {data.backers === 1 ? "believer" : "believers"}
              </span>
            </div>
            {progress !== null && (
              <>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {progress}% of {money(campaign.goalCents!)}
                </p>
              </>
            )}
          </div>

          {campaign.story && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{campaign.story}</p>
          )}

          <div className="space-y-2">
            {tiers.map((tier) => {
              const left = tier.maxBackers != null ? tier.maxBackers - tier.claimed : null;
              return (
                <button
                  key={tier.id}
                  type="button"
                  disabled={tier.soldOut || isOwner}
                  onClick={() => setCheckoutTier(tier)}
                  className="w-full text-left rounded-lg border border-border/60 p-3 transition-colors hover:border-primary/60 disabled:opacity-50 disabled:hover:border-border/60"
                  data-testid={`public-tier-${tier.id}`}
                >
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="font-semibold">
                      {money(tier.amountCents)} · {tier.name}
                    </span>
                    {tier.soldOut
                      ? <Badge variant="secondary" className="text-[10px]">Sold out</Badge>
                      : left != null && left <= 10 && (
                        <Badge variant="outline" className="text-[10px]">{left} left</Badge>
                      )}
                  </div>
                  {tier.description && (
                    <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                      {tier.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(tier.merchProducts || []).map((k) => (
                      <Badge key={k} className="text-[10px] gap-1">
                        <Shirt className="h-2.5 w-2.5" />{merchProduct(k)?.label || k}
                      </Badge>
                    ))}
                    {(tier.digitalRewards || []).map((k) => (
                      <Badge key={k} variant="secondary" className="text-[10px]">
                        {DIGITAL_REWARDS.find((r) => r.key === k)?.label || k}
                      </Badge>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          {isOwner ? (
            <p className="text-xs text-muted-foreground">
              This is how backers see your campaign. You can't back your own project.
            </p>
          ) : (
            <Button
              variant="outline" className="w-full"
              onClick={() => setCheckoutTier(tiers[0] ?? null)}
              disabled={tiers.length === 0}
              data-testid="button-open-backing"
            >
              Pledge a custom amount
            </Button>
          )}

          {/* Said plainly, because "funds are held in escrow" in 9pt grey is
              how you lose the trust the holding was meant to buy. */}
          <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 p-2.5">
            <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {campaign.fundsHeld
                ? `SparkTower holds your money until a person has checked this project is real. If that hasn't happened in ${data.refundWindowDays} days, you get your choice of a refund.`
                : "This project has been reviewed and approved for payouts."}
            </p>
          </div>

          {wall.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <Label className="text-xs">The backer wall</Label>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {wall.map((w, i) => (
                  <div key={i} className="flex items-start gap-2" data-testid={`wall-entry-${i}`}>
                    <Avatar className="h-6 w-6 shrink-0">
                      {w.image && <AvatarImage src={w.image} />}
                      <AvatarFallback className="text-[9px]">{w.name.slice(0, 2)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-xs">
                        <span className="font-medium">{w.name}</span>
                        {w.believerNumber != null && (
                          <span className="text-muted-foreground font-mono">
                            {" "}{formatBelieverNumber(w.believerNumber)}
                          </span>
                        )}
                        {w.tierName && <span className="text-muted-foreground"> · {w.tierName}</span>}
                      </p>
                      {w.message && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{w.message}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <PledgeDialog
        open={!!checkoutTier}
        onClose={() => setCheckoutTier(null)}
        projectId={projectId}
        projectTitle={projectTitle}
        tiers={tiers}
        initialTier={checkoutTier}
        defaultTipPercent={data.defaultTipPercent}
        refundWindowDays={data.refundWindowDays}
        onError={(m) => toast({ title: "Couldn't start that pledge", description: m, variant: "destructive" })}
      />
    </>
  );
}

function PledgeDialog({
  open, onClose, projectId, projectTitle, tiers, initialTier,
  defaultTipPercent, refundWindowDays, onError,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectTitle: string;
  tiers: PublicTier[];
  initialTier: PublicTier | null;
  defaultTipPercent: number;
  refundWindowDays: number;
  onError: (message: string) => void;
}) {
  const [amountInput, setAmountInput] = useState("");
  const [tipPercent, setTipPercent] = useState(defaultTipPercent);
  const [message, setMessage] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [unclaimed, setUnclaimed] = useState<"refund" | "donate_platform">("refund");

  // Reset to the clicked rung each time the dialog opens.
  const amountCents = useMemo(() => {
    if (amountInput.trim()) return Math.round(parseFloat(amountInput) * 100) || 0;
    return initialTier?.amountCents ?? 0;
  }, [amountInput, initialTier]);

  // The rung is earned by the amount, not the button — someone who types $40
  // gets the $35 shirt, which is what they already think they're buying.
  const earned = tierForAmount(tiers.filter((t) => !t.soldOut), amountCents);
  const tipCents = Math.round(amountCents * (tipPercent / 100));
  const needsShipping = earned ? tierNeedsShipping({ merchProducts: earned.merchProducts }) : false;

  const checkout = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/backing/checkout`, {
        amountCents, tipCents, message, isAnonymous, unclaimedPreference: unclaimed,
      });
      const body = await res.json();
      if (!body.url) throw new Error("No checkout URL returned");
      window.location.href = body.url;
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const start = raw.indexOf("{");
      let description = "Please try again.";
      if (start >= 0) {
        try { description = JSON.parse(raw.slice(start)).message || description; } catch { /* keep */ }
      }
      onError(description);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Back {projectTitle}</DialogTitle>
          <DialogDescription>{BELIEVER_TAGLINE}. Past tense, on purpose.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 -mx-1 px-1">
          <div className="space-y-2">
            <Label className="text-xs">Amount</Label>
            <div className="flex flex-wrap gap-1.5">
              {tiers.filter((t) => !t.soldOut).map((t) => (
                <Button
                  key={t.id}
                  type="button"
                  size="sm"
                  variant={amountCents === t.amountCents ? "default" : "outline"}
                  onClick={() => setAmountInput(String(t.amountCents / 100))}
                  data-testid={`pledge-preset-${t.id}`}
                >
                  {money(t.amountCents)}
                </Button>
              ))}
            </div>
            <Input
              type="number" min={MIN_PLEDGE_CENTS / 100} step="1"
              value={amountInput || (initialTier ? String(initialTier.amountCents / 100) : "")}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="Or type an amount"
              data-testid="input-pledge-amount"
            />
          </div>

          {earned && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-2.5 space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-primary" /> You get: {earned.name}
              </p>

              {/*
                * The actual artwork, not a description of it. Rendered by the
                * same code that generates the print file, so what the backer
                * agrees to here is what arrives in the post.
                */}
              {needsShipping && (
                <div className="grid grid-cols-2 gap-2">
                  {(["front", "back"] as const).map((face) => (
                    <div key={face} className="space-y-0.5">
                      <img
                        src={`/api/projects/${projectId}/merch/preview.png?face=${face}&width=400`}
                        alt={`${face} of the shirt you'll receive`}
                        className="w-full rounded border border-border/60 bg-muted/30"
                        loading="lazy"
                      />
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground text-center">
                        {face}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-1">
                {(earned.merchProducts || []).map((k) => (
                  <Badge key={k} className="text-[10px] gap-1">
                    <Shirt className="h-2.5 w-2.5" />{merchProduct(k)?.label || k}
                  </Badge>
                ))}
                {(earned.digitalRewards || []).map((k) => (
                  <Badge key={k} variant="secondary" className="text-[10px]">
                    {DIGITAL_REWARDS.find((r) => r.key === k)?.label || k}
                  </Badge>
                ))}
              </div>
              {needsShipping && (
                <p className="text-[11px] text-muted-foreground">
                  Stripe will ask for your shipping address on the next screen.
                </p>
              )}
            </div>
          )}

          {/* Tip: named, explained, and easy to set to zero. Hiding any of
              those three is what makes people resent it. */}
          <div className="space-y-2">
            <Label className="text-xs">Tip SparkTower</Label>
            <div className="flex flex-wrap gap-1.5">
              {TIP_PRESET_PERCENTS.map((p) => (
                <Button
                  key={p} type="button" size="sm"
                  variant={tipPercent === p ? "default" : "outline"}
                  onClick={() => setTipPercent(p)}
                  data-testid={`tip-${p}`}
                >
                  {p === 0 ? "None" : `${p}%`}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              SparkTower is free for backers. A tip keeps it that way — it goes to us, not to
              the project, and {money(amountCents)} still reaches the creator either way.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Say something (optional)</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Goes on the backer wall."
              maxLength={280}
              className="min-h-[60px]"
              data-testid="textarea-pledge-message"
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={isAnonymous}
                onCheckedChange={(v) => setIsAnonymous(Boolean(v))}
                data-testid="checkbox-anonymous"
              />
              Back anonymously
            </label>
          </div>

          <div className="space-y-2 rounded-md border border-border/60 p-2.5">
            <div className="flex items-start gap-2">
              <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your money is held until someone at SparkTower confirms this project is real.
                If that hasn't happened within {refundWindowDays} days:
              </p>
            </div>
            <RadioGroup
              value={unclaimed}
              onValueChange={(v) => setUnclaimed(v as typeof unclaimed)}
              className="gap-1.5 pl-5"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="refund" data-testid="radio-refund" />
                Refund me
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="donate_platform" data-testid="radio-donate" />
                Keep it — put it toward SparkTower
              </label>
            </RadioGroup>
          </div>

          <div className="flex items-baseline justify-between text-sm border-t border-border/60 pt-3">
            <span className="text-muted-foreground">Total today</span>
            <span className="font-semibold text-base">{money(amountCents + tipCents)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="gap-2"
            disabled={amountCents < MIN_PLEDGE_CENTS || checkout.isPending}
            onClick={() => checkout.mutate()}
            data-testid="button-pledge-checkout"
          >
            {checkout.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Redirecting…</>
              : <><Heart className="h-4 w-4" /> Continue to payment</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
