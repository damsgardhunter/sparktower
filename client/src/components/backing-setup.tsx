import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { MerchPreview } from "@/components/merch-preview";
import { ImageUploadField } from "@/components/image-upload-field";
import { BackerRecords } from "@/components/backer-records";
import { BadgePreviewCard } from "@/components/badge-preview-card";
import {
  Loader2, Heart, Plus, Trash2, Pencil, Shirt, ShieldCheck, AlertTriangle,
  CheckCircle2, Clock, Sparkles, Lock, ExternalLink,
} from "lucide-react";
import {
  DIGITAL_REWARDS, MERCH_PRODUCTS, DEFAULT_MERCH_CONFIG, BELIEVER_TAGLINE,
  PLATFORM_FEE_PERCENT, REFUND_WINDOW_DAYS, merchProduct, formatBelieverNumber,
  type MerchConfig,
} from "@shared/backing";

interface Tier {
  id: string;
  amountCents: number;
  name: string;
  description: string | null;
  digitalRewards: string[] | null;
  merchProducts: string[] | null;
  maxBackers: number | null;
  sortOrder: number;
  isActive: boolean;
}

interface BackingSetup {
  campaign: {
    id: string;
    enabled: boolean;
    headline: string | null;
    story: string | null;
    goalCents: number | null;
    startedAt: string | null;
    reviewStatus: "not_submitted" | "pending" | "approved" | "rejected";
    reviewNotes: string | null;
    believerCount: number;
  };
  tiers: Tier[];
  merchConfig: MerchConfig;
  payouts: {
    connectAccountId: string | null;
    heldCents: number;
    releasedCents: number;
    backers: number;
  };
  signals: {
    codeAudit: { completionPercent: number | null; stage: string | null } | null;
    completedTasks: number;
    profileCompleteness: number;
    hasRepoUrl: boolean;
    hasLiveUrl: boolean;
    stripeAccount: { detailsSubmitted: boolean; chargesEnabled: boolean; payoutsEnabled: boolean } | null;
  } | null;
  badgePreviews: Record<string, string>;
  projectLogoUrl: string | null;
  printfulReady: boolean;
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const REVIEW_STATE: Record<string, { label: string; icon: typeof Clock; className: string; blurb: string }> = {
  not_submitted: {
    label: "Not submitted",
    icon: Lock,
    className: "text-muted-foreground",
    blurb: "You can collect pledges now. They're held by SparkTower until a human has looked at your project.",
  },
  pending: {
    label: "In review",
    icon: Clock,
    className: "text-amber-500",
    blurb: "We're looking at it. Pledges keep coming in and stay held until this clears.",
  },
  approved: {
    label: "Approved for payouts",
    icon: CheckCircle2,
    className: "text-emerald-500",
    blurb: "Held funds can be released to your Stripe account, and merch orders now ship as they come in.",
  },
  rejected: {
    label: "Not approved",
    icon: AlertTriangle,
    className: "text-rose-500",
    blurb: "Read the note below, fix what it says, and submit again.",
  },
};

/**
 * Donations, tiers and merch, set up by the creator.
 *
 * The order of the cards is the order of the decisions: switch it on, build
 * the ladder, decide what the merch says, then deal with getting paid. Payouts
 * come last on purpose — it's the part with a person in the loop, and putting
 * it first makes the whole feature feel like a bank form.
 */
export function BackingSetup({ projectId, projectTitle }: { projectId: string; projectTitle: string }) {
  const { toast } = useToast();
  const [editingTier, setEditingTier] = useState<Partial<Tier> | null>(null);
  const [campaignForm, setCampaignForm] = useState({ headline: "", story: "", goal: "" });
  const [campaignDirty, setCampaignDirty] = useState(false);

  const { data, isLoading } = useQuery<BackingSetup>({
    queryKey: ["/api/projects", projectId, "backing"],
    enabled: !!projectId,
  });

  // Seed the copy fields from the server, but never over the top of something
  // half-typed — the same trap the brief form fell into.
  useEffect(() => {
    if (!data || campaignDirty) return;
    setCampaignForm({
      headline: data.campaign.headline || "",
      story: data.campaign.story || "",
      goal: data.campaign.goalCents ? String(data.campaign.goalCents / 100) : "",
    });
  }, [data, campaignDirty]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "backing"] });

  const describeError = (err: any, fallback: string) => {
    const raw = err?.message || "";
    const start = raw.indexOf("{");
    if (start >= 0) {
      try { return JSON.parse(raw.slice(start)).message || fallback; } catch { /* keep */ }
    }
    return fallback;
  };

  const saveCampaign = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/backing`, patch);
      return res.json();
    },
    onSuccess: () => { setCampaignDirty(false); invalidate(); },
    onError: (err) => toast({
      title: "Couldn't save that",
      description: describeError(err, "Try again."),
      variant: "destructive",
    }),
  });

  const applyTemplate = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/backing/tiers/apply-template`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Five rungs added", description: "Now rename them in your own voice." });
      invalidate();
    },
    onError: (err) => toast({
      title: "Couldn't add the tiers",
      description: describeError(err, "Try again."),
      variant: "destructive",
    }),
  });

  const saveTier = useMutation({
    mutationFn: async (tier: Partial<Tier>) => {
      const body = {
        name: tier.name,
        description: tier.description,
        amountCents: tier.amountCents,
        digitalRewards: tier.digitalRewards || [],
        merchProducts: tier.merchProducts || [],
        maxBackers: tier.maxBackers ?? null,
      };
      const res = tier.id
        ? await apiRequest("PATCH", `/api/backing-tiers/${tier.id}`, body)
        : await apiRequest("POST", `/api/projects/${projectId}/backing/tiers`, body);
      return res.json();
    },
    onSuccess: () => { setEditingTier(null); invalidate(); },
    onError: (err) => toast({
      title: "Couldn't save that tier",
      description: describeError(err, "Try again."),
      variant: "destructive",
    }),
  });

  const deleteTier = useMutation({
    mutationFn: async (tierId: string) => {
      const res = await apiRequest("DELETE", `/api/backing-tiers/${tierId}`);
      return res.json();
    },
    onSuccess: (result: any) => {
      toast({
        title: result?.retired ? "Tier retired" : "Tier removed",
        description: result?.retired
          ? "People have already backed this rung, so it's hidden rather than deleted — their receipts still point at it."
          : undefined,
      });
      invalidate();
    },
    onError: (err) => toast({
      title: "Couldn't remove that",
      description: describeError(err, "Try again."),
      variant: "destructive",
    }),
  });

  const submitReview = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/backing/submit-review`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sent for review", description: "We'll look at it and get back to you." });
      invalidate();
    },
    onError: (err) => toast({
      title: "Couldn't submit",
      description: describeError(err, "Try again."),
      variant: "destructive",
    }),
  });

  const connectStripe = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/stripe/connect-account");
      const res = await apiRequest("GET", "/api/stripe/connect-onboarding");
      const body = await res.json();
      if (body.url) window.location.href = body.url;
    },
    onError: (err) => toast({
      title: "Couldn't start Stripe onboarding",
      description: describeError(err, "Try again."),
      variant: "destructive",
    }),
  });

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }
  if (!data) return null;

  const { campaign, tiers, merchConfig, payouts, signals } = data;
  const config: MerchConfig = { ...DEFAULT_MERCH_CONFIG, ...merchConfig };
  const review = REVIEW_STATE[campaign.reviewStatus];
  const ReviewIcon = review.icon;
  const activeTiers = tiers.filter((t) => t.isActive);

  const patchMerch = (patch: Partial<MerchConfig>) =>
    saveCampaign.mutate({ merchConfig: { ...config, ...patch } });

  return (
    <div className="space-y-4" data-testid="backing-setup">
      {/* ---------------------------------------------------------- campaign */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1 min-w-0">
              <CardTitle className="text-lg flex items-center gap-2">
                <Heart className="h-4 w-4 text-primary" /> Backing &amp; rewards
              </CardTitle>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Let people put money behind you and get something back for it. Merch reads
                "{BELIEVER_TAGLINE}" — past tense, because it's a receipt for showing up early.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Label htmlFor="backing-enabled" className="text-xs">
                {campaign.enabled ? "Open" : "Closed"}
              </Label>
              <Switch
                id="backing-enabled"
                checked={campaign.enabled}
                onCheckedChange={(v) => saveCampaign.mutate({ enabled: v })}
                data-testid="switch-backing-enabled"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!campaign.enabled && activeTiers.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Add at least one tier before you can open your campaign.
            </p>
          )}

          <div className="space-y-2">
            <Label className="text-xs">Headline</Label>
            <Input
              value={campaignForm.headline}
              onChange={(e) => { setCampaignForm({ ...campaignForm, headline: e.target.value }); setCampaignDirty(true); }}
              placeholder="e.g. Help me get this in front of the first hundred people"
              maxLength={140}
              data-testid="input-backing-headline"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Why you're asking</Label>
            <Textarea
              value={campaignForm.story}
              onChange={(e) => { setCampaignForm({ ...campaignForm, story: e.target.value }); setCampaignDirty(true); }}
              placeholder="What the money does. Be specific — 'server costs for six months' beats 'support development'."
              className="min-h-[90px]"
              maxLength={4000}
              data-testid="textarea-backing-story"
            />
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-2">
              <Label className="text-xs">Goal (optional)</Label>
              <Input
                type="number" min="0" className="w-36"
                value={campaignForm.goal}
                onChange={(e) => { setCampaignForm({ ...campaignForm, goal: e.target.value }); setCampaignDirty(true); }}
                placeholder="2500"
                data-testid="input-backing-goal"
              />
            </div>
            <Button
              size="sm"
              disabled={!campaignDirty || saveCampaign.isPending}
              onClick={() => saveCampaign.mutate({
                headline: campaignForm.headline,
                story: campaignForm.story,
                goalCents: campaignForm.goal ? Math.round(parseFloat(campaignForm.goal) * 100) : null,
              })}
              data-testid="button-save-campaign"
            >
              {saveCampaign.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------- tiers */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <CardTitle className="text-base">Tiers</CardTitle>
              <p className="text-xs text-muted-foreground">
                Five rungs works better than three or eight. Rename them in your own voice —
                "Believer", "Ride or die", "Absolute unit". The naming is half the appeal.
              </p>
            </div>
            <Button
              size="sm" variant="outline" className="gap-1.5 shrink-0"
              onClick={() => setEditingTier({ amountCents: 500, name: "", digitalRewards: [], merchProducts: [] })}
              data-testid="button-add-tier"
            >
              <Plus className="h-4 w-4" /> Add tier
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {tiers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                No tiers yet. Start from the five-rung ladder and edit from there.
              </p>
              <Button
                size="sm" className="gap-1.5"
                disabled={applyTemplate.isPending}
                onClick={() => applyTemplate.mutate()}
                data-testid="button-apply-tier-template"
              >
                {applyTemplate.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Sparkles className="h-4 w-4" />}
                Use the five-rung starter
              </Button>
            </div>
          ) : (
            tiers.map((tier) => (
              <div
                key={tier.id}
                className={`rounded-lg border border-border/60 p-3 ${tier.isActive ? "" : "opacity-50"}`}
                data-testid={`tier-${tier.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{money(tier.amountCents)}</span>
                      <span className="text-sm">{tier.name}</span>
                      {!tier.isActive && <Badge variant="secondary" className="text-[10px]">Retired</Badge>}
                      {tier.maxBackers != null && (
                        <Badge variant="outline" className="text-[10px]">Limit {tier.maxBackers}</Badge>
                      )}
                    </div>
                    {tier.description && (
                      <p className="text-xs text-muted-foreground leading-relaxed">{tier.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {(tier.merchProducts || []).map((key) => (
                        <Badge key={key} className="text-[10px] gap-1">
                          <Shirt className="h-2.5 w-2.5" />{merchProduct(key)?.label || key}
                        </Badge>
                      ))}
                      {(tier.digitalRewards || []).map((key) => (
                        <Badge key={key} variant="secondary" className="text-[10px]">
                          {DIGITAL_REWARDS.find((r) => r.key === key)?.label || key}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => setEditingTier(tier)}
                      data-testid={`button-edit-tier-${tier.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                      onClick={() => deleteTier.mutate(tier.id)}
                      data-testid={`button-delete-tier-${tier.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* -------------------------------------------------------------- merch */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What the merch says</CardTitle>
          <p className="text-xs text-muted-foreground">
            The tagline is fixed. What you choose is whether the back carries your logo,
            your name, or both — and the date, which is what separates early backers from late ones.
          </p>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">On the back</Label>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={config.showLogo}
                    onCheckedChange={(v) => patchMerch({ showLogo: Boolean(v) })}
                    data-testid="checkbox-merch-logo"
                  />
                  Logo
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={config.showName}
                    onCheckedChange={(v) => patchMerch({ showName: Boolean(v) })}
                    data-testid="checkbox-merch-name"
                  />
                  Project name
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={config.showDatestamp}
                    onCheckedChange={(v) => patchMerch({ showDatestamp: Boolean(v) })}
                    data-testid="checkbox-merch-datestamp"
                  />
                  Date
                </label>
              </div>
            </div>

            <ImageUploadField
              label="Logo"
              value={config.logoUrl}
              onChange={(p) => patchMerch({ logoUrl: p })}
              hint="Transparent PNG prints best. Leave empty to use your project logo."
              testId="upload-merch-logo"
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">Name on merch</Label>
                <Input
                  defaultValue={config.displayName || ""}
                  onBlur={(e) => {
                    if (e.target.value !== (config.displayName || "")) patchMerch({ displayName: e.target.value });
                  }}
                  placeholder={projectTitle}
                  data-testid="input-merch-name"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Colour</Label>
                <Select value={config.colorway} onValueChange={(v) => patchMerch({ colorway: v as MerchConfig["colorway"] })}>
                  <SelectTrigger data-testid="select-merch-color"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="black">Black</SelectItem>
                    <SelectItem value="white">White</SelectItem>
                    <SelectItem value="heather">Heather grey</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={config.creatorShirt}
                onCheckedChange={(v) => patchMerch({ creatorShirt: Boolean(v) })}
                data-testid="checkbox-creator-shirt"
              />
              Make me the "They believed in me." shirt
            </label>

            <div className="space-y-2">
              <Label className="text-xs">Products you'll offer</Label>
              <div className="grid gap-1.5">
                {MERCH_PRODUCTS.map((p) => (
                  <label key={p.key} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={config.enabledProducts.includes(p.key)}
                      onCheckedChange={(v) => patchMerch({
                        enabledProducts: v
                          ? [...config.enabledProducts, p.key]
                          : config.enabledProducts.filter((k) => k !== p.key),
                      })}
                      data-testid={`checkbox-product-${p.key}`}
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{p.label}</span>
                      <span className="text-muted-foreground"> · ~{money(p.estimatedCostCents)} to make</span>
                      <span className="block text-xs text-muted-foreground leading-relaxed">{p.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* The preview above is for the creator's eyes. A press needs the
                back as one composed high-resolution file, and nothing here can
                burn text into an image — so when the back carries a name or a
                date, the creator supplies the finished artwork. */}
            {/*
              * Optional override. SparkTower composes the back automatically
              * from the logo, name and date above — this is for creators who
              * want their own art on it instead.
              */}
            <ImageUploadField
              label="Custom back artwork (optional)"
              value={config.backArtworkUrl}
              onChange={(p) => patchMerch({ backArtworkUrl: p })}
              hint="Overrides the generated back. 4500×5400px transparent PNG."
              testId="upload-back-artwork"
            />

            {!data.printfulReady && (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                Printing isn't connected yet (no PRINTFUL_API_KEY). You can design and sell now —
                orders queue up and go out once it's wired in.
              </p>
            )}
          </div>

          <div>
            <MerchPreview projectId={projectId} config={config} />
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ payouts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Getting paid
          </CardTitle>
          <p className="text-xs text-muted-foreground leading-relaxed">
            SparkTower holds every pledge until a person has checked the project is real. It's
            what makes the money trustworthy to give — and it's why nobody can raise here on a
            project that doesn't exist. Backers who aren't paid out within {REFUND_WINDOW_DAYS} days
            get their choice of a refund. SparkTower keeps {PLATFORM_FEE_PERCENT}%.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Backers", value: String(payouts.backers) },
              { label: "Held", value: money(payouts.heldCents) },
              { label: "Paid out", value: money(payouts.releasedCents) },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-border/60 p-3">
                <p className="text-[11px] text-muted-foreground">{s.label}</p>
                <p className="text-lg font-semibold">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
            <ReviewIcon className={`h-4 w-4 shrink-0 mt-0.5 ${review.className}`} />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">{review.label}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{review.blurb}</p>
              {campaign.reviewNotes && (
                <p className="text-xs leading-relaxed border-l-2 border-border pl-2 mt-1">
                  {campaign.reviewNotes}
                </p>
              )}
            </div>
          </div>

          {/* The same signals the reviewer sees. Hiding them just produces
              support tickets asking why an approval didn't come through. */}
          {signals && (
            <div className="space-y-1.5">
              <Label className="text-xs">What a reviewer looks at</Label>
              <div className="grid gap-1 sm:grid-cols-2">
                {[
                  {
                    label: "Codebase audit",
                    ok: (signals.codeAudit?.completionPercent ?? 0) > 0,
                    detail: signals.codeAudit?.completionPercent != null
                      ? `${signals.codeAudit.completionPercent}% complete`
                      : "Not run",
                  },
                  {
                    label: "Tasks finished",
                    ok: signals.completedTasks > 0,
                    detail: `${signals.completedTasks} done`,
                  },
                  {
                    label: "Your profile",
                    ok: signals.profileCompleteness >= 80,
                    detail: `${signals.profileCompleteness}% filled in`,
                  },
                  {
                    label: "Something to show",
                    ok: signals.hasRepoUrl || signals.hasLiveUrl,
                    detail: signals.hasRepoUrl || signals.hasLiveUrl ? "Repo or live URL set" : "No repo or live URL",
                  },
                  {
                    label: "Identity verified",
                    ok: Boolean(signals.stripeAccount?.detailsSubmitted),
                    detail: signals.stripeAccount?.detailsSubmitted ? "Stripe verified" : "Not yet",
                  },
                ].map((s) => (
                  <div key={s.label} className="flex items-center gap-2 text-sm">
                    {s.ok
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      : <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />}
                    <span>{s.label}</span>
                    <span className="text-xs text-muted-foreground">· {s.detail}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground pt-1">
                None of these decide it on their own — an early project can look thin and still be
                real. They're what a person reads before making the call.
              </p>
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            {!payouts.connectAccountId ? (
              <Button
                size="sm" className="gap-1.5"
                disabled={connectStripe.isPending}
                onClick={() => connectStripe.mutate()}
                data-testid="button-connect-stripe"
              >
                {connectStripe.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <ExternalLink className="h-4 w-4" />}
                Connect Stripe to get paid
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={submitReview.isPending || campaign.reviewStatus === "pending" || campaign.reviewStatus === "approved"}
                onClick={() => submitReview.mutate()}
                data-testid="button-submit-review"
              >
                {submitReview.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {campaign.reviewStatus === "approved"
                  ? "Approved"
                  : campaign.reviewStatus === "pending"
                    ? "In review"
                    : "Submit for payout review"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Logo falls back to the merch config, so a logo set only under Merch —
          or an older server response missing projectLogoUrl — still resolves. */}
      <BadgePreviewCard
        projectId={projectId}
        previews={data.badgePreviews || {}}
        projectLogoUrl={data.projectLogoUrl ?? config.logoUrl ?? null}
      />

      {/* Renders nothing until someone has actually backed. */}
      <BackerRecords projectId={projectId} />

      <TierDialog
        tier={editingTier}
        onClose={() => setEditingTier(null)}
        onSave={(t) => saveTier.mutate(t)}
        saving={saveTier.isPending}
      />
    </div>
  );
}

/** Create or edit one rung. */
function TierDialog({
  tier, onClose, onSave, saving,
}: {
  tier: Partial<Tier> | null;
  onClose: () => void;
  onSave: (tier: Partial<Tier>) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Partial<Tier>>({});
  useEffect(() => { if (tier) setForm(tier); }, [tier]);

  if (!tier) return null;
  const amount = form.amountCents ?? 500;
  const merch = form.merchProducts || [];
  const digital = form.digitalRewards || [];

  // A rung that costs more to fulfil than it brings in is the single most
  // common way a well-meaning campaign loses money.
  const merchCost = merch.reduce((sum, key) => sum + (merchProduct(key)?.estimatedCostCents ?? 0), 0);
  const underwater = merchCost > 0 && merchCost >= amount * 0.6;

  const toggle = (list: string[], key: string) =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit tier" : "New tier"}</DialogTitle>
          <DialogDescription>
            Name it the way you'd say it out loud. "Believer" beats "Tier 2".
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 -mx-1 px-1">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label className="text-xs">Amount ($)</Label>
              <Input
                type="number" min="1"
                value={amount / 100}
                onChange={(e) => setForm({ ...form, amountCents: Math.round(parseFloat(e.target.value || "0") * 100) })}
                data-testid="input-tier-amount"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label className="text-xs">Name</Label>
              <Input
                value={form.name || ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ride or die"
                maxLength={40}
                data-testid="input-tier-name"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">What they get, in your words</Label>
            <Textarea
              value={form.description || ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="The shirt, plus I record you a thank-you with my actual face."
              className="min-h-[60px]"
              maxLength={300}
              data-testid="textarea-tier-description"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Digital rewards — free to fulfil</Label>
            <div className="grid gap-1.5">
              {DIGITAL_REWARDS.map((r) => (
                <label key={r.key} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={digital.includes(r.key)}
                    onCheckedChange={() => setForm({ ...form, digitalRewards: toggle(digital, r.key) })}
                    data-testid={`checkbox-reward-${r.key}`}
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{r.label}</span>
                    {r.fulfilledBy === "creator" && (
                      <Badge variant="outline" className="ml-1.5 text-[9px]">you do this one</Badge>
                    )}
                    <span className="block text-xs text-muted-foreground leading-relaxed">{r.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Physical rewards — these ship</Label>
            <div className="grid gap-1.5">
              {MERCH_PRODUCTS.map((p) => (
                <label key={p.key} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={merch.includes(p.key)}
                    onCheckedChange={() => setForm({ ...form, merchProducts: toggle(merch, p.key) })}
                    data-testid={`checkbox-merch-${p.key}`}
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{p.label}</span>
                    <span className="text-muted-foreground"> · ~{money(p.estimatedCostCents)}</span>
                    {amount < p.suggestedMinCents && (
                      <span className="text-amber-600 dark:text-amber-400"> · usually {money(p.suggestedMinCents)}+</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {underwater && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              About {money(merchCost)} of this {money(amount)} goes on making and posting the reward.
              Either raise the price or move something to a higher rung.
            </p>
          )}

          <div className="space-y-2">
            <Label className="text-xs">Limit (optional)</Label>
            <Input
              type="number" min="1" className="w-32"
              value={form.maxBackers ?? ""}
              onChange={(e) => setForm({ ...form, maxBackers: e.target.value ? parseInt(e.target.value, 10) : null })}
              placeholder="unlimited"
              data-testid="input-tier-limit"
            />
            <p className="text-[11px] text-muted-foreground">
              "Only 50 of these" is real scarcity. {formatBelieverNumber(47)} is the free kind — every
              backer gets one automatically.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!form.name?.trim() || saving}
            onClick={() => onSave(form)}
            data-testid="button-save-tier"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save tier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
