/**
 * Backing, at the foot of Setup as on the web — the native BackingSetup
 * (client/src/components/backing-setup.tsx), in its order of decisions:
 * switch it on and write the ask, build the tier ladder, decide what the
 * merch says, get paid (Stripe Connect opens in the browser), preview the
 * backer badges, and see who backed you.
 *
 * No money moves here: this is the creator's setup. Pledges are made on the
 * project page, and Stripe onboarding is Stripe's own page.
 */
import { useEffect, useMemo, useState } from "react";
import { Image, Switch, Text, View } from "react-native";
import { pickPhoto } from "../../photos";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL, api, uploadFile } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, Card, ErrorNote, Icon, Label, Loading, Meta, Row, assetUri, errText, type IconName } from "../ui";
import { BADGE_LEVELS, BELIEVER_TAGLINE, formatBelieverNumber, money } from "../../projectData";
import { EditorSheet, Tag, Well, useNotify } from "./bits";
import { mkey } from "./shared";
import { CheckRow, Choice, Input, RowAction } from "./tools/kit";

// --- shared/backing.ts, restated ----------------------------------------------

const CREATOR_TAGLINE = "They believed in me.";
const PLATFORM_FEE_PERCENT = 10;
const REFUND_WINDOW_DAYS = 90;

const DIGITAL_REWARDS: { key: string; label: string; description: string; fulfilledBy: "platform" | "creator" }[] = [
  { key: "backer_wall", label: "Name on the backer wall", description: "Their name listed on the project's public page.", fulfilledBy: "platform" },
  { key: "believer_number", label: "Believer number", description: "Backer #0047. A low number costs you nothing and people genuinely care.", fulfilledBy: "platform" },
  { key: "digital_badge", label: "Digital badge", description: "A badge on their account showing they backed you, and how early.", fulfilledBy: "platform" },
  { key: "profile_frame", label: "Profile frame", description: "A ring around their avatar in your project's colours.", fulfilledBy: "platform" },
  { key: "wallpaper", label: "Wallpaper", description: "Downloadable wallpaper with your logo and the tagline.", fulfilledBy: "platform" },
  { key: "certificate", label: "Printable certificate", description: "A dated certificate they can actually print and pin up.", fulfilledBy: "platform" },
  { key: "founding_believer", label: "Founding believer credit", description: "A permanent marker on their profile naming them as an early backer.", fulfilledBy: "platform" },
  { key: "early_access", label: "Early access", description: "First through the door on whatever you ship next.", fulfilledBy: "creator" },
  { key: "video_thankyou", label: "Personal video thank-you", description: "You record and send a short personal thank-you. This one is real work — don't put it on a rung you'll regret.", fulfilledBy: "creator" },
];
const MERCH_PRODUCTS: { key: string; label: string; description: string; estimatedCostCents: number; suggestedMinCents: number }[] = [
  { key: "sticker_pack", label: "Sticker pack", description: "Kiss-cut vinyl. The cheapest thing that still feels like a real object.", estimatedCostCents: 450, suggestedMinCents: 1500 },
  { key: "believer_card", label: "\"I believe'd in them\" card", description: "A printed card with nothing on it but the tagline. Made to be handed to someone.", estimatedCostCents: 350, suggestedMinCents: 1500 },
  { key: "mug", label: "Mug", description: "11oz. Logo one side, tagline the other.", estimatedCostCents: 1200, suggestedMinCents: 2500 },
  { key: "pin", label: "Enamel pin", description: "Small, cheap to post, disproportionately loved.", estimatedCostCents: 700, suggestedMinCents: 2000 },
  { key: "patch", label: "Embroidered patch", description: "Iron-on. Reads as earned rather than bought.", estimatedCostCents: 800, suggestedMinCents: 2000 },
  { key: "shirt", label: "The shirt", description: "Tagline on the front, your logo and the date on the back.", estimatedCostCents: 2200, suggestedMinCents: 3500 },
  { key: "tote", label: "Tote bag", description: "Eco cotton. Walks around advertising you for years.", estimatedCostCents: 1600, suggestedMinCents: 3000 },
];
const merchProduct = (key: string) => MERCH_PRODUCTS.find((p) => p.key === key);

interface MerchConfig {
  showLogo: boolean; showName: boolean; displayName: string | null; logoUrl: string | null;
  colorway: "black" | "white" | "heather"; showDatestamp: boolean; enabledProducts: string[]; creatorShirt: boolean; backArtworkUrl: string | null;
}
const DEFAULT_MERCH_CONFIG: MerchConfig = {
  showLogo: true, showName: true, displayName: null, logoUrl: null, colorway: "black", showDatestamp: true,
  enabledProducts: ["sticker_pack", "shirt"], creatorShirt: true, backArtworkUrl: null,
};

interface Tier { id: string; amountCents: number; name: string; description: string | null; digitalRewards: string[] | null; merchProducts: string[] | null; maxBackers: number | null; isActive: boolean }
interface BackingSetupData {
  campaign: { enabled: boolean; headline: string | null; story: string | null; goalCents: number | null; reviewStatus: "not_submitted" | "pending" | "approved" | "rejected"; reviewNotes: string | null; believerCount: number };
  tiers: Tier[];
  merchConfig: MerchConfig;
  payouts: { connectAccountId: string | null; heldCents: number; releasedCents: number; backers: number };
  signals: { codeAudit: { completionPercent: number | null } | null; completedTasks: number; profileCompleteness: number; hasRepoUrl: boolean; hasLiveUrl: boolean; stripeAccount: { detailsSubmitted: boolean } | null } | null;
  badgePreviews: Record<string, string>;
  projectLogoUrl: string | null;
  printfulReady: boolean;
}

const REVIEW: Record<string, { label: string; icon: IconName; color: string; blurb: string }> = {
  not_submitted: { label: "Not submitted", icon: "lock-closed-outline", color: colors.textTertiary, blurb: "You can collect pledges now. They're held by SparkTower until a human has looked at your project." },
  pending: { label: "In review", icon: "time-outline", color: "#F59E0B", blurb: "We're looking at it. Pledges keep coming in and stay held until this clears." },
  approved: { label: "Approved for payouts", icon: "checkmark-circle", color: "#10B981", blurb: "Held funds can be released to your Stripe account, and merch orders now ship as they come in." },
  rejected: { label: "Not approved", icon: "warning-outline", color: "#F43F5E", blurb: "Read the note below, fix what it says, and submit again." },
};

const Title = ({ icon, children }: { icon?: IconName; children: string }) => (
  <Row center gap={spacing.sm}>
    {icon && <Icon name={icon} size={17} color={colors.primary} />}
    <Text style={{ fontSize: font.lg, fontFamily: fontFamily.semibold, color: colors.text }}>{children}</Text>
  </Row>
);
const Blurb = ({ children }: { children: React.ReactNode }) => <Meta style={{ fontSize: font.xs + 1, lineHeight: 17 }}>{children}</Meta>;

export function BackingSummary({ projectId, projectTitle }: { projectId: string; projectTitle?: string }) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const key = mkey(projectId, "backing");
  const { data, isLoading, isError } = useQuery({ queryKey: key, queryFn: () => api<BackingSetupData>(`/api/projects/${projectId}/backing`), retry: false });
  const [form, setForm] = useState({ headline: "", story: "", goal: "" });
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<Partial<Tier> | null>(null);
  const invalidate = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ["project", projectId, "backing", "public"] }); };

  // Seed from the server, never over something half-typed.
  useEffect(() => {
    if (!data || dirty) return;
    setForm({ headline: data.campaign.headline || "", story: data.campaign.story || "", goal: data.campaign.goalCents ? String(data.campaign.goalCents / 100) : "" });
  }, [data, dirty]);

  const saveCampaign = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api(`/api/projects/${projectId}/backing`, { method: "PATCH", body: patch }),
    onSuccess: () => { setDirty(false); invalidate(); },
    onError: (e) => fail(e, "Couldn't save that"),
  });
  const applyTemplate = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/backing/tiers/apply-template`, { method: "POST" }),
    onSuccess: () => { notify("Five rungs added — now rename them in your own voice."); invalidate(); },
    onError: (e) => fail(e, "Couldn't add the tiers"),
  });
  const deleteTier = useMutation({
    mutationFn: (id: string) => api<{ retired?: boolean }>(`/api/backing-tiers/${id}`, { method: "DELETE" }),
    onSuccess: (r) => { notify(r?.retired ? "Tier retired — people already backed it, so it's hidden rather than deleted." : "Tier removed", "info"); invalidate(); },
    onError: (e) => fail(e, "Couldn't remove that"),
  });
  const submitReview = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/backing/submit-review`, { method: "POST" }),
    onSuccess: () => { notify("Sent for review — we'll look at it and get back to you."); invalidate(); },
    onError: (e) => fail(e, "Couldn't submit"),
  });
  const connectStripe = useMutation({
    mutationFn: async () => {
      await api("/api/stripe/connect-account", { method: "POST" });
      const { url } = await api<{ url?: string }>("/api/stripe/connect-onboarding");
      if (!url) throw new Error("Stripe didn't return a link.");
      await WebBrowser.openBrowserAsync(url);
    },
    onSettled: invalidate,
    onError: (e) => fail(e, "Couldn't start Stripe onboarding"),
  });

  if (isLoading) return <Card><Loading /></Card>;
  // The server 404s the whole area while the backing kill switch is off — say so rather than vanish.
  if (isError || !data) {
    return (
      <Card style={{ gap: 4 }}>
        <Title icon="heart">Backing, merch & badges</Title>
        <Blurb>Backing isn't available right now — it's switched off for the whole site. An admin can turn it back on under Admin → Surfaces.</Blurb>
      </Card>
    );
  }

  const { campaign, tiers, payouts, signals } = data;
  const config: MerchConfig = { ...DEFAULT_MERCH_CONFIG, ...data.merchConfig };
  const review = REVIEW[campaign.reviewStatus] ?? REVIEW.not_submitted;
  const activeTiers = tiers.filter((t) => t.isActive);
  const patchMerch = (patch: Partial<MerchConfig>) => saveCampaign.mutate({ merchConfig: { ...config, ...patch } });

  return (
    <View style={{ gap: spacing.md }}>
      {/* --- Campaign --- */}
      <Card style={{ gap: spacing.md }}>
        <Row between>
          <View style={{ flex: 1 }}><Title icon="heart">Backing & rewards</Title></View>
          <Meta>{campaign.enabled ? "Open" : "Closed"}</Meta>
          <Switch value={campaign.enabled} onValueChange={(v) => saveCampaign.mutate({ enabled: v })} disabled={saveCampaign.isPending}
            trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#FFFFFF" accessibilityLabel="Backing open" />
        </Row>
        <Meta style={{ fontSize: font.sm, lineHeight: 19 }}>Let people put money behind you and get something back for it. Merch reads "{BELIEVER_TAGLINE}" — past tense, because it's a receipt for showing up early.</Meta>
        {!campaign.enabled && activeTiers.length === 0 && <Blurb>Add at least one tier before you can open your campaign.</Blurb>}
        <Input label="Headline" value={form.headline} maxLength={140} placeholder="e.g. Help me get this in front of the first hundred people"
          onChangeText={(v) => { setForm({ ...form, headline: v }); setDirty(true); }} />
        <Input label="Why you're asking" value={form.story} maxLength={4000} multiline rows={4}
          placeholder="What the money does. Be specific — 'server costs for six months' beats 'support development'."
          onChangeText={(v) => { setForm({ ...form, story: v }); setDirty(true); }} />
        <Row gap={spacing.md} style={{ alignItems: "flex-end" }}>
          <View style={{ width: 140 }}>
            <Input label="Goal (optional)" value={form.goal} numeric placeholder="2500" onChangeText={(v) => { setForm({ ...form, goal: v.replace(/[^0-9.]/g, "") }); setDirty(true); }} />
          </View>
          <Btn small label="Save" disabled={!dirty} loading={saveCampaign.isPending} onPress={() => saveCampaign.mutate({
            headline: form.headline, story: form.story, goalCents: form.goal ? Math.round(parseFloat(form.goal) * 100) : null,
          })} />
        </Row>
      </Card>

      {/* --- Tiers --- */}
      <Card style={{ gap: spacing.md }}>
        <Row between style={{ alignItems: "flex-start", gap: spacing.sm }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Title>Tiers</Title>
            <Blurb>Five rungs works better than three or eight. Rename them in your own voice — "Believer", "Ride or die", "Absolute unit". The naming is half the appeal.</Blurb>
          </View>
          <Btn small variant="outline" icon="add" label="Add tier" onPress={() => setEditing({ amountCents: 500, name: "", digitalRewards: [], merchProducts: [] })} />
        </Row>
        {tiers.length === 0 ? (
          <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, alignItems: "center", gap: spacing.md }}>
            <Meta style={{ textAlign: "center", fontSize: font.sm }}>No tiers yet. Start from the five-rung ladder and edit from there.</Meta>
            <Btn small icon="sparkles" label="Use the five-rung starter" loading={applyTemplate.isPending} onPress={() => applyTemplate.mutate()} />
          </View>
        ) : tiers.map((tier) => (
          <View key={tier.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 5, opacity: tier.isActive ? 1 : 0.5 }}>
            <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Row wrap center gap={6}>
                  <Text style={{ fontSize: font.base, fontFamily: fontFamily.bold, color: colors.text }}>{money(tier.amountCents)}</Text>
                  <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{tier.name}</Text>
                  {!tier.isActive && <Tag label="Retired" color={colors.textSecondary} />}
                  {tier.maxBackers != null && <Tag label={`Limit ${tier.maxBackers}`} color={colors.textSecondary} />}
                </Row>
                {!!tier.description && <Blurb>{tier.description}</Blurb>}
                <Row wrap gap={4}>
                  {(tier.merchProducts || []).map((k) => <Tag key={k} solid label={merchProduct(k)?.label || k} />)}
                  {(tier.digitalRewards || []).map((k) => <Tag key={k} color={colors.textSecondary} label={DIGITAL_REWARDS.find((r) => r.key === k)?.label || k} />)}
                </Row>
              </View>
              <RowAction icon="create-outline" label="Edit tier" onPress={() => setEditing(tier)} />
              <RowAction icon="trash-outline" color={colors.danger} label="Delete tier" onPress={() => deleteTier.mutate(tier.id)} />
            </Row>
          </View>
        ))}
      </Card>

      {/* --- Merch --- */}
      <Card style={{ gap: spacing.md }}>
        <View style={{ gap: 2 }}>
          <Title>What the merch says</Title>
          <Blurb>The tagline is fixed. What you choose is whether the back carries your logo, your name, or both — and the date, which is what separates early backers from late ones.</Blurb>
        </View>
        <MerchPreview projectId={projectId} config={config} />
        <View style={{ gap: spacing.xs }}>
          <Label>On the back</Label>
          <Row wrap gap={spacing.lg}>
            <CheckRow on={config.showLogo} title="Logo" onPress={() => patchMerch({ showLogo: !config.showLogo })} />
            <CheckRow on={config.showName} title="Project name" onPress={() => patchMerch({ showName: !config.showName })} />
            <CheckRow on={config.showDatestamp} title="Date" onPress={() => patchMerch({ showDatestamp: !config.showDatestamp })} />
          </Row>
        </View>
        <ImageField label="Logo" value={config.logoUrl} hint="Transparent PNG prints best. Leave empty to use your project logo." onChange={(p) => patchMerch({ logoUrl: p })} />
        <MerchName initial={config.displayName || ""} placeholder={projectTitle} onCommit={(v) => { if (v !== (config.displayName || "")) patchMerch({ displayName: v }); }} />
        <Choice label="Colour" value={config.colorway} onChange={(v) => patchMerch({ colorway: v })}
          options={[{ value: "black", label: "Black" }, { value: "white", label: "White" }, { value: "heather", label: "Heather grey" }]} />
        <CheckRow on={config.creatorShirt} title={`Make me the "${CREATOR_TAGLINE}" shirt`} onPress={() => patchMerch({ creatorShirt: !config.creatorShirt })} />
        <View style={{ gap: spacing.xs }}>
          <Label>Products you'll offer</Label>
          {MERCH_PRODUCTS.map((p) => {
            const on = config.enabledProducts.includes(p.key);
            return (
              <CheckRow key={p.key} on={on} title={p.label} hint={p.description}
                right={<Text style={{ color: colors.textTertiary, fontFamily: fontFamily.regular }}> · ~{money(p.estimatedCostCents)} to make</Text>}
                onPress={() => patchMerch({ enabledProducts: on ? config.enabledProducts.filter((k) => k !== p.key) : [...config.enabledProducts, p.key] })} />
            );
          })}
        </View>
        <ImageField label="Custom back artwork (optional)" value={config.backArtworkUrl} hint="Overrides the generated back. 4500×5400px transparent PNG." onChange={(p) => patchMerch({ backArtworkUrl: p })} />
        {!data.printfulReady && (
          <Row gap={6} style={{ alignItems: "flex-start" }}>
            <Icon name="warning-outline" size={14} color={colors.warning} />
            <Meta style={{ flex: 1, color: colors.warning }}>Printing isn't connected yet. You can design and sell now — orders queue up and go out once it's wired in.</Meta>
          </Row>
        )}
      </Card>

      {/* --- Getting paid --- */}
      <Card style={{ gap: spacing.md }}>
        <View style={{ gap: 2 }}>
          <Title icon="shield-checkmark-outline">Getting paid</Title>
          <Blurb>SparkTower holds every pledge until a person has checked the project is real. It's what makes the money trustworthy to give — and it's why nobody can raise here on a project that doesn't exist. Backers who aren't paid out within {REFUND_WINDOW_DAYS} days get their choice of a refund. SparkTower keeps {PLATFORM_FEE_PERCENT}%.</Blurb>
        </View>
        <Row gap={spacing.sm}>
          {[["Backers", String(payouts.backers)], ["Held", money(payouts.heldCents)], ["Paid out", money(payouts.releasedCents)]].map(([label, value]) => (
            <View key={label} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm + 2 }}>
              <Meta>{label}</Meta>
              <Text style={{ fontSize: font.lg, fontFamily: fontFamily.semibold, color: colors.text }}>{value}</Text>
            </View>
          ))}
        </Row>
        <Row gap={spacing.sm} style={{ alignItems: "flex-start", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.md }}>
          <Icon name={review.icon} size={16} color={review.color} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{review.label}</Text>
            <Blurb>{review.blurb}</Blurb>
            {!!campaign.reviewNotes && <View style={{ borderLeftWidth: 2, borderColor: colors.border, paddingLeft: spacing.sm }}><Meta style={{ color: colors.text }}>{campaign.reviewNotes}</Meta></View>}
          </View>
        </Row>
        {signals && (
          <View style={{ gap: 5 }}>
            <Label>What a reviewer looks at</Label>
            {[
              { label: "Codebase audit", ok: (signals.codeAudit?.completionPercent ?? 0) > 0, detail: signals.codeAudit?.completionPercent != null ? `${signals.codeAudit.completionPercent}% complete` : "Not run" },
              { label: "Tasks finished", ok: signals.completedTasks > 0, detail: `${signals.completedTasks} done` },
              { label: "Your profile", ok: signals.profileCompleteness >= 80, detail: `${signals.profileCompleteness}% filled in` },
              { label: "Something to show", ok: signals.hasRepoUrl || signals.hasLiveUrl, detail: signals.hasRepoUrl || signals.hasLiveUrl ? "Repo or live URL set" : "No repo or live URL" },
              { label: "Identity verified", ok: !!signals.stripeAccount?.detailsSubmitted, detail: signals.stripeAccount?.detailsSubmitted ? "Stripe verified" : "Not yet" },
            ].map((s) => (
              <Row key={s.label} center gap={6}>
                <Icon name={s.ok ? "checkmark-circle" : "warning-outline"} size={14} color={s.ok ? "#10B981" : `${colors.textTertiary}88`} />
                <Text style={{ fontSize: font.sm, color: colors.text, fontFamily: fontFamily.regular }}>{s.label}</Text>
                <Meta>· {s.detail}</Meta>
              </Row>
            ))}
            <Blurb>None of these decide it on their own — an early project can look thin and still be real. They're what a person reads before making the call.</Blurb>
          </View>
        )}
        {!payouts.connectAccountId ? (
          <Btn small icon="open-outline" label="Connect Stripe to get paid" loading={connectStripe.isPending} onPress={() => connectStripe.mutate()} style={{ alignSelf: "flex-start" }} />
        ) : (
          <Btn small label={campaign.reviewStatus === "approved" ? "Approved" : campaign.reviewStatus === "pending" ? "In review" : "Submit for payout review"}
            disabled={campaign.reviewStatus === "pending" || campaign.reviewStatus === "approved"} loading={submitReview.isPending}
            onPress={() => submitReview.mutate()} style={{ alignSelf: "flex-start" }} />
        )}
      </Card>

      <BadgePreviews projectId={projectId} previews={data.badgePreviews || {}} logoUrl={data.projectLogoUrl ?? config.logoUrl ?? null} onChanged={invalidate} />
      <BackerRecords projectId={projectId} />

      <TierSheet tier={editing} onClose={() => setEditing(null)} projectId={projectId} onSaved={() => { setEditing(null); invalidate(); }} />
    </View>
  );
}

/** The name on the merch saves when you leave the field, like the web's onBlur. */
function MerchName({ initial, placeholder, onCommit }: { initial: string; placeholder?: string; onCommit: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  const dirty = value !== initial;
  return (
    <Row gap={spacing.sm} style={{ alignItems: "flex-end" }}>
      <View style={{ flex: 1 }}><Input label="Name on merch" value={value} onChangeText={setValue} placeholder={placeholder} /></View>
      {dirty && <Btn small variant="outline" label="Save" onPress={() => onCommit(value)} />}
    </Row>
  );
}

function ImageField({ label, value, hint, onChange }: { label: string; value: string | null; hint: string; onChange: (path: string | null) => void }) {
  const { fail } = useNotify();
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    try {
      const f = await pickPhoto();
      if (!f) return;
      setBusy(true);
      onChange(await uploadFile(f));
    } catch (e) { fail(e, "Upload failed"); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: spacing.xs }}>
      <Label>{label}</Label>
      <Row center gap={spacing.md}>
        <View style={{ width: 56, height: 56, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
          {value ? <Image source={{ uri: assetUri(value)! }} style={{ width: 56, height: 56 }} resizeMode="contain" /> : <Icon name="image-outline" size={20} color={colors.textTertiary} />}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Row gap={spacing.sm}>
            <Btn small variant="outline" icon="cloud-upload-outline" label={value ? "Replace" : "Upload"} loading={busy} onPress={pick} />
            {value && <Btn small variant="ghost" label="Remove" onPress={() => onChange(null)} />}
          </Row>
          <Meta>{hint}</Meta>
        </View>
      </Row>
    </View>
  );
}

const GARMENT: Record<MerchConfig["colorway"], string> = { black: "#17171b", white: "#f7f7f6", heather: "#a1a1aa" };

/** The server-rendered artwork on the garment colour — the same render as the print file. */
function MerchPreview({ projectId, config }: { projectId: string; config: MerchConfig }) {
  const version = useMemo(() => {
    const k = JSON.stringify([config.showLogo, config.showName, config.showDatestamp, config.displayName, config.logoUrl, config.colorway]);
    let h = 0;
    for (let i = 0; i < k.length; i++) h = (Math.imul(31, h) + k.charCodeAt(i)) | 0;
    return String(h >>> 0);
  }, [config.showLogo, config.showName, config.showDatestamp, config.displayName, config.logoUrl, config.colorway]);
  const src = (face: string) => `${API_URL}/api/projects/${projectId}/merch/preview.png?face=${face}&width=700&v=${version}`;
  const garment = (face: string, label: string, size?: number) => (
    <View style={{ flex: size ? undefined : 1, width: size, gap: 4 }}>
      <View style={{ aspectRatio: 200 / 224, borderRadius: radius.md, backgroundColor: GARMENT[config.colorway], borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", padding: "18%" }}>
        <Image source={{ uri: assetUri(src(face))! }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
      </View>
      {!!label && <Text style={{ fontSize: 10, color: colors.textTertiary, textAlign: "center", fontFamily: fontFamily.medium, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</Text>}
    </View>
  );
  return (
    <View style={{ gap: spacing.sm }}>
      <Row gap={spacing.md}>{garment("front", "front")}{garment("back", "back")}</Row>
      {!config.showLogo && !config.showName && !config.showDatestamp && <Meta style={{ color: colors.warning }}>With the logo, name and date all off, the back is blank. Turn one on.</Meta>}
      {config.creatorShirt && (
        <Row center gap={spacing.md} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm }}>
          {garment("creator", "", 56)}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: colors.text }}>Your shirt: "{CREATOR_TAGLINE}"</Text>
            <Meta>The counterpart to what your backers wear. One photo of the pair sells the whole thing.</Meta>
          </View>
        </Row>
      )}
      <Meta>This is the real artwork, rendered by the same code that generates the print file.</Meta>
    </View>
  );
}

function BadgePreviews({ projectId, previews, logoUrl, onChanged }: { projectId: string; previews: Record<string, string>; logoUrl: string | null; onChanged: () => void }) {
  const { notify, fail } = useNotify();
  const generate = useMutation({
    mutationFn: (level: string) => api<{ level: string; usedLogo: boolean }>(`/api/projects/${projectId}/backing/badge-preview`, { method: "POST", body: { level } }),
    onSuccess: (r) => { notify(`${r.level} badge ready${r.usedLogo ? "" : " — made without a logo; upload one for a badge that looks like you."}`); onChanged(); },
    onError: (e) => fail(e, "Couldn't make that preview. Try again in a moment."),
  });
  const pending = generate.isPending ? generate.variables : null;
  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ gap: 2 }}>
        <Title icon="sparkles">Backer badges</Title>
        <Blurb>Everyone who backs you earns a badge built from your logo, and pins it to their profile. The metal is set by how much they gave. This is the reward that costs you nothing and gets carried around the longest.</Blurb>
      </View>
      {logoUrl ? (
        <Row center gap={spacing.sm} style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.sm }}>
          <Image source={{ uri: assetUri(logoUrl)! }} style={{ width: 32, height: 32, borderRadius: 4, backgroundColor: colors.surface }} resizeMode="contain" />
          <Meta>Badges are built from this logo.</Meta>
        </Row>
      ) : (
        <Row gap={6} style={{ alignItems: "flex-start" }}>
          <Icon name="warning-outline" size={14} color={colors.warning} />
          <Meta style={{ flex: 1, color: colors.warning }}>No logo yet. Badges will use a generic emblem until you add one at the top of Setup.</Meta>
        </Row>
      )}
      <Row wrap gap={spacing.md}>
        {BADGE_LEVELS.map((level) => {
          const img = previews[level.key];
          return (
            <View key={level.key} style={{ width: "46%", flexGrow: 1, gap: 6, alignItems: "center" }}>
              <View style={{ width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: level.hex, overflow: "hidden", backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" }}>
                {pending === level.key ? <Loading /> : img ? <Image source={{ uri: assetUri(img)! }} style={{ width: 96, height: 96 }} resizeMode="contain" /> : <Icon name="image-outline" size={24} color={`${colors.textTertiary}66`} />}
              </View>
              <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: level.hex }}>{level.label}</Text>
              <Meta style={{ fontSize: 10 }}>${level.minCents / 100}+</Meta>
              <Btn small variant="outline" label={pending === level.key ? "Drawing…" : img ? "Redo" : "Preview"} disabled={generate.isPending} onPress={() => generate.mutate(level.key)} />
            </View>
          );
        })}
      </Row>
      <Blurb>Each one takes about a minute to draw. Previews are yours only — a backer's badge is generated fresh when they pledge. Change your logo and these go stale, so redo one to check.</Blurb>
    </Card>
  );
}

/** Who backed you and what you owe them. Renders nothing until someone has. */
function BackerRecords({ projectId }: { projectId: string }) {
  const { data } = useQuery({ queryKey: mkey(projectId, "backing", "backers"), queryFn: () => api<any[]>(`/api/projects/${projectId}/backing/backers`), retry: false });
  if (!data?.length) return null;
  const owed = {
    shipping: data.filter((b) => b.merch).length,
    video: data.filter((b) => b.entitlements?.videoThankYou).length,
    founding: data.filter((b) => b.entitlements?.foundingBeliever).length,
  };
  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ gap: 2 }}>
        <Title icon="people-outline">Your backers</Title>
        <Blurb>Everyone who's put money in, and what each of them is owed.</Blurb>
      </View>
      <Row wrap gap={spacing.sm}>
        {[["Backers", data.length], ["To ship", owed.shipping], ["Videos owed", owed.video], ["Founding", owed.founding]].map(([label, value]) => (
          <View key={label} style={{ width: "46%", flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm + 2 }}>
            <Meta>{label}</Meta>
            <Text style={{ fontSize: font.lg, fontFamily: fontFamily.semibold, color: colors.text }}>{value}</Text>
          </View>
        ))}
      </Row>
      {data.map((b) => {
        const level = BADGE_LEVELS.find((l) => l.key === b.badge?.level);
        return (
          <View key={b.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm + 2, gap: 5 }}>
            <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>
                  {b.believerNumber != null ? <Text style={{ fontSize: font.xs, color: colors.textTertiary }}>{formatBelieverNumber(b.believerNumber)}  </Text> : null}
                  {b.name}
                </Text>
                {b.anonymousOnWall && <Tag label="anonymous publicly" color={colors.textSecondary} />}
                {!!b.message && <Meta>"{b.message}"</Meta>}
              </View>
              <View style={{ alignItems: "flex-end", gap: 3 }}>
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{money(b.amountCents)}</Text>
                <Tag label={b.status} color={colors.textSecondary} />
              </View>
            </Row>
            <Row wrap gap={4}>
              {!!b.tierName && <Tag label={b.tierName} color={colors.textSecondary} />}
              {level && <Tag label={level.label} color={level.hex} />}
              {b.entitlements?.foundingBeliever && <Tag solid label="Founding" />}
              {b.entitlements?.earlyAccess && <Tag label="Early access" color={colors.textSecondary} />}
              {b.entitlements?.videoThankYou && <Tag label="Video owed" color={colors.textSecondary} />}
              {b.entitlements?.wallpaper && <Tag label="Wallpaper" color={colors.textSecondary} />}
              {b.merch && <Tag solid label={`${(b.merch.products || []).join(" + ")} · ${b.merch.status ?? "queued"}`} />}
            </Row>
          </View>
        );
      })}
      <Blurb>Addresses are collected by Stripe; the CSV export with them is on the web. Backers marked anonymous are hidden from the public wall only — you still know who to post to.</Blurb>
    </Card>
  );
}

/** Create or edit one rung. */
function TierSheet({ tier, onClose, projectId, onSaved }: { tier: Partial<Tier> | null; onClose: () => void; projectId: string; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<Tier>>({});
  const [amountText, setAmountText] = useState("5");
  const [limitText, setLimitText] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!tier) return;
    setForm(tier); setError(null);
    setAmountText(String((tier.amountCents ?? 500) / 100));
    setLimitText(tier.maxBackers != null ? String(tier.maxBackers) : "");
  }, [tier]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name, description: form.description, amountCents: Math.round(parseFloat(amountText || "0") * 100),
        digitalRewards: form.digitalRewards || [], merchProducts: form.merchProducts || [],
        maxBackers: limitText ? parseInt(limitText, 10) : null,
      };
      return form.id
        ? api(`/api/backing-tiers/${form.id}`, { method: "PATCH", body })
        : api(`/api/projects/${projectId}/backing/tiers`, { method: "POST", body });
    },
    onSuccess: onSaved,
    onError: (e) => setError(errText(e, "Couldn't save that tier. Try again.")),
  });

  const amount = Math.round(parseFloat(amountText || "0") * 100);
  const merch = form.merchProducts || [];
  const digital = form.digitalRewards || [];
  const merchCost = merch.reduce((sum, k) => sum + (merchProduct(k)?.estimatedCostCents ?? 0), 0);
  const underwater = merchCost > 0 && merchCost >= amount * 0.6;
  const toggle = (list: string[], k: string) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);

  return (
    <EditorSheet visible={!!tier} onClose={onClose} title={form.id ? "Edit tier" : "New tier"} subtitle={`Name it the way you'd say it out loud. "Believer" beats "Tier 2".`}
      action={{ label: "Save tier", onPress: () => save.mutate(), disabled: !form.name?.trim(), loading: save.isPending }}>
      {error ? <ErrorNote message={error} /> : null}
      <Row gap={spacing.md}>
        <View style={{ width: 110 }}><Input label="Amount ($)" value={amountText} numeric onChangeText={(v) => setAmountText(v.replace(/[^0-9.]/g, ""))} /></View>
        <View style={{ flex: 1 }}><Input label="Name" value={form.name || ""} maxLength={40} placeholder="Ride or die" onChangeText={(v) => setForm({ ...form, name: v })} /></View>
      </Row>
      <Input label="What they get, in your words" value={form.description || ""} maxLength={300} multiline rows={3}
        placeholder="The shirt, plus I record you a thank-you with my actual face." onChangeText={(v) => setForm({ ...form, description: v })} />
      <View style={{ gap: spacing.xs }}>
        <Label>Digital rewards — free to fulfil</Label>
        {DIGITAL_REWARDS.map((r) => (
          <CheckRow key={r.key} on={digital.includes(r.key)} title={r.label} hint={r.description}
            right={r.fulfilledBy === "creator" ? <Text style={{ color: colors.warning, fontSize: font.xs, fontFamily: fontFamily.medium }}>  you do this one</Text> : undefined}
            onPress={() => setForm({ ...form, digitalRewards: toggle(digital, r.key) })} />
        ))}
      </View>
      <View style={{ gap: spacing.xs }}>
        <Label>Physical rewards — these ship</Label>
        {MERCH_PRODUCTS.map((p) => (
          <CheckRow key={p.key} on={merch.includes(p.key)} title={p.label}
            right={<Text style={{ color: amount < p.suggestedMinCents ? colors.warning : colors.textTertiary, fontFamily: fontFamily.regular }}> · ~{money(p.estimatedCostCents)}{amount < p.suggestedMinCents ? ` · usually ${money(p.suggestedMinCents)}+` : ""}</Text>}
            onPress={() => setForm({ ...form, merchProducts: toggle(merch, p.key) })} />
        ))}
      </View>
      {underwater && (
        <Well tone="warning">
          <Meta style={{ color: colors.text }}>About {money(merchCost)} of this {money(amount)} goes on making and posting the reward. Either raise the price or move something to a higher rung.</Meta>
        </Well>
      )}
      <View style={{ gap: spacing.xs }}>
        <View style={{ width: 140 }}><Input label="Limit (optional)" value={limitText} numeric placeholder="unlimited" onChangeText={(v) => setLimitText(v.replace(/[^0-9]/g, ""))} /></View>
        <Meta>"Only 50 of these" is real scarcity. {formatBelieverNumber(47)} is the free kind — every backer gets one automatically.</Meta>
      </View>
    </EditorSheet>
  );
}
