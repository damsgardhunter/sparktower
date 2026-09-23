/**
 * "Back this project" — the campaign, its tiers, the backer wall, and a pledge.
 *
 * The native counterpart of client/src/components/backing-panel.tsx. Returns
 * nothing when the project isn't running a campaign, except for the owner. The
 * pledge starts a Stripe Checkout session on the server and opens its URL in
 * the in-app browser; the backing itself is written by Stripe's webhook, so
 * the panel just re-reads when the browser closes.
 */
import { useMemo, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL, api } from "../api/client";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Avatar, Body, Btn, ErrorNote, Field, Icon, Meta, Progress, Row, assetUri, errText } from "./ui";
import { Block, Tag } from "./ProjectBits";
import { CheckRow, FormGroup, ProjectFormSheet } from "./ProjectFormSheet";
import {
  BADGE_LEVELS, BELIEVER_TAGLINE, DIGITAL_REWARD_LABELS, MERCH_LABELS, MIN_PLEDGE_CENTS, TIP_PRESET_PERCENTS,
  badgeLevelForAmount, formatBelieverNumber, money, tierForAmount,
} from "../projectData";
import type { Notice } from "./Sheet";

interface PublicTier {
  id: string;
  amountCents: number;
  name: string;
  description: string | null;
  digitalRewards: string[] | null;
  merchProducts: string[] | null;
  maxBackers: number | null;
  badgeLevel?: string;
  claimed: number;
  soldOut: boolean;
}

interface PublicCampaign {
  campaign: { headline: string | null; story: string | null; goalCents: number | null; fundsHeld: boolean };
  tiers: PublicTier[];
  badgePreviews?: Record<string, string>;
  badgeLogoUrl?: string | null;
  wall: { believerNumber: number | null; name: string; image: string | null; message: string | null; tierName: string | null }[];
  raisedCents: number;
  backers: number;
  defaultTipPercent: number;
  refundWindowDays: number;
}

function TierBadge({ levelKey, previews, logoUrl, size = 44 }: { levelKey?: string; previews: Record<string, string>; logoUrl: string | null; size?: number }) {
  const level = BADGE_LEVELS.find((l) => l.key === levelKey) ?? BADGE_LEVELS[0];
  const img = assetUri(previews[level.key]) ?? null;
  const logo = assetUri(logoUrl);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: level.hex, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised }}>
      {img ? <Image source={{ uri: assetUri(img)! }} style={{ width: size, height: size }} resizeMode="contain" />
        : logo ? <Image source={{ uri: assetUri(logo)! }} style={{ width: size * 0.6, height: size * 0.6 }} resizeMode="contain" />
        : <Icon name="heart" size={size * 0.38} color={level.hex} />}
    </View>
  );
}

function Rewards({ tier }: { tier: Pick<PublicTier, "merchProducts" | "digitalRewards"> }) {
  const merch = tier.merchProducts || [];
  const digital = tier.digitalRewards || [];
  if (!merch.length && !digital.length) return null;
  return (
    <Row wrap gap={4}>
      {merch.map((k) => <Tag key={k} icon="shirt-outline" tone="primary" label={MERCH_LABELS[k] || k} />)}
      {digital.map((k) => <Tag key={k} label={DIGITAL_REWARD_LABELS[k] || k} />)}
    </Row>
  );
}

export function BackingCard({ projectId, projectTitle, isOwner, notify }: {
  projectId: string;
  projectTitle: string;
  isOwner: boolean;
  notify: (n: Notice) => void;
}) {
  const router = useRouter();
  const [pledgeTier, setPledgeTier] = useState<PublicTier | null>(null);
  const [pledgeOpen, setPledgeOpen] = useState(false);

  const { data, isError } = useQuery({
    queryKey: ["project", projectId, "backing", "public"],
    queryFn: () => api<PublicCampaign>(`/api/projects/${projectId}/backing/public`),
    retry: false,
  });

  if (isError && !data) {
    if (!isOwner) return null;
    return (
      <Block title="Let people back this" icon="heart-outline">
        <Body muted>
          Set up tiers and merch and people can put money behind you. Held by SparkTower until the project is reviewed, so backers know it's safe to give.
        </Body>
        <Btn label="Set up backing" variant="outline" small icon="settings-outline" style={{ alignSelf: "flex-start" }}
          onPress={() => router.push(`/manage/${projectId}?tab=setup` as any)} />
      </Block>
    );
  }
  if (!data) return null;

  const { campaign, tiers, wall } = data;
  const previews = data.badgePreviews || {};
  const logoUrl = data.badgeLogoUrl ?? null;
  const progress = campaign.goalCents ? Math.min(100, Math.round((data.raisedCents / campaign.goalCents) * 100)) : null;

  const openPledge = (tier: PublicTier | null) => { setPledgeTier(tier); setPledgeOpen(true); };

  return (
    <>
      <Block title="Back this project" icon="heart">
        {campaign.headline ? <Body muted>{campaign.headline}</Body> : null}
        <View style={{ gap: 6 }}>
          <Row between>
            <Text style={{ fontFamily: fontFamily.bold, fontSize: font.xxl, color: colors.text }}>{money(data.raisedCents)}</Text>
            <Meta style={{ fontSize: font.sm }}>{data.backers} {data.backers === 1 ? "believer" : "believers"}</Meta>
          </Row>
          {progress !== null && (
            <>
              <Progress value={progress} />
              <Meta>{progress}% of {money(campaign.goalCents!)}</Meta>
            </>
          )}
        </View>
        {campaign.story ? <Body>{campaign.story}</Body> : null}
        {tiers.length > 0 && (
          <Meta>Every backer earns a badge built from this project's logo to show on their profile. The more you give, the rarer the metal.</Meta>
        )}

        <View style={{ gap: spacing.sm }}>
          {tiers.map((tier) => {
            const left = tier.maxBackers != null ? tier.maxBackers - tier.claimed : null;
            const level = BADGE_LEVELS.find((l) => l.key === tier.badgeLevel) ?? badgeLevelForAmount(tier.amountCents);
            return (
              <Pressable
                key={tier.id}
                disabled={tier.soldOut || isOwner}
                onPress={() => openPledge(tier)}
                style={({ pressed }) => [{
                  borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md,
                  flexDirection: "row", gap: spacing.md, opacity: tier.soldOut ? 0.5 : 1,
                }, pressed && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Row center wrap gap={6}>
                    <Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>{money(tier.amountCents)} · {tier.name}</Text>
                    {tier.soldOut ? <Tag label="Sold out" /> : left != null && left <= 10 ? <Tag tone="warning" label={`${left} left`} /> : null}
                  </Row>
                  {tier.description ? <Meta style={{ fontSize: font.sm, lineHeight: 18 }}>{tier.description}</Meta> : null}
                  <Rewards tier={tier} />
                </View>
                <View style={{ alignItems: "center", gap: 2 }}>
                  <TierBadge levelKey={level.key} previews={previews} logoUrl={logoUrl} />
                  <Text style={{ fontSize: 9, fontFamily: fontFamily.semibold, color: level.hex }}>{level.label} badge</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {isOwner ? (
          <Meta>This is how backers see your campaign. You can't back your own project.</Meta>
        ) : (
          <Btn label={tiers.length ? "Pledge a custom amount" : "Back this project"} variant="outline" icon="heart-outline" onPress={() => openPledge(tiers[0] ?? null)} />
        )}

        <View style={{ flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.md }}>
          <Icon name="shield-checkmark-outline" size={18} color={colors.primary} />
          <Meta style={{ flex: 1, lineHeight: 16 }}>
            {campaign.fundsHeld
              ? `SparkTower holds your money until a person has checked this project is real. If that hasn't happened in ${data.refundWindowDays} days, you get your choice of a refund.`
              : "This project has been reviewed and approved for payouts."}
          </Meta>
        </View>

        {wall.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <Row center gap={6}>
              <Icon name="people-outline" size={15} color={colors.textSecondary} />
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>The backer wall</Text>
            </Row>
            {wall.slice(0, 12).map((w, i) => (
              <Row key={i} gap={spacing.sm} style={{ alignItems: "flex-start" }}>
                <Avatar name={w.name} uri={w.image} size={28} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: font.sm, color: colors.text, fontFamily: fontFamily.semibold }}>
                    {w.name}
                    <Text style={{ color: colors.textTertiary, fontFamily: fontFamily.regular }}>
                      {w.believerNumber != null ? ` ${formatBelieverNumber(w.believerNumber)}` : ""}{w.tierName ? ` · ${w.tierName}` : ""}
                    </Text>
                  </Text>
                  {w.message ? <Meta style={{ fontSize: font.sm }}>{w.message}</Meta> : null}
                </View>
              </Row>
            ))}
          </View>
        )}
      </Block>

      <PledgeSheet
        visible={pledgeOpen}
        onClose={() => setPledgeOpen(false)}
        projectId={projectId}
        projectTitle={projectTitle}
        data={data}
        initialTier={pledgeTier}
        notify={notify}
      />
    </>
  );
}

function PledgeSheet({ visible, onClose, projectId, projectTitle, data, initialTier, notify }: {
  visible: boolean;
  onClose: () => void;
  projectId: string;
  projectTitle: string;
  data: PublicCampaign;
  initialTier: PublicTier | null;
  notify: (n: Notice) => void;
}) {
  const qc = useQueryClient();
  const [amountInput, setAmountInput] = useState("");
  const [tipPercent, setTipPercent] = useState<number>(data.defaultTipPercent);
  const [message, setMessage] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [unclaimed, setUnclaimed] = useState<"refund" | "donate_platform">("refund");
  const [error, setError] = useState<string | null>(null);

  const available = data.tiers.filter((t) => !t.soldOut);
  const amountCents = useMemo(() => {
    if (amountInput.trim()) return Math.round(parseFloat(amountInput) * 100) || 0;
    return initialTier?.amountCents ?? 0;
  }, [amountInput, initialTier]);
  const earned = tierForAmount(available, amountCents);
  const tipCents = Math.round(amountCents * (tipPercent / 100));
  const level = badgeLevelForAmount(amountCents);
  const needsShipping = (earned?.merchProducts?.length ?? 0) > 0;

  const close = () => { setAmountInput(""); setError(null); onClose(); };

  const checkout = useMutation({
    mutationFn: () => api<{ url?: string }>(`/api/projects/${projectId}/backing/checkout`, {
      method: "POST",
      body: { amountCents, tipCents, message, isAnonymous, unclaimedPreference: unclaimed },
    }),
    onSuccess: async (body) => {
      if (!body?.url) { setError("No checkout link came back. Try again."); return; }
      close();
      await WebBrowser.openBrowserAsync(body.url).catch(() => notify({ text: "Couldn't open the payment page.", tone: "error" }));
      // Whatever happened in the browser, the webhook has the answer; read it again.
      void qc.invalidateQueries({ queryKey: ["project", projectId, "backing", "public"] });
    },
    onError: (e) => setError(errText(e, "Couldn't start that pledge.")),
  });

  return (
    <ProjectFormSheet
      visible={visible}
      onClose={close}
      title={`Back ${projectTitle}`}
      subtitle={`${BELIEVER_TAGLINE}. Past tense, on purpose.`}
      action={`Continue to payment · ${money(amountCents + tipCents)}`}
      actionIcon="lock-closed"
      actionDisabled={amountCents < MIN_PLEDGE_CENTS}
      actionLoading={checkout.isPending}
      onAction={() => checkout.mutate()}
      footerNote={error ? <ErrorNote message={error} /> : null}
    >
      <FormGroup label="Amount">
        {available.length > 0 && (
          <Row wrap gap={spacing.xs + 2}>
            {available.map((t) => (
              <Btn key={t.id} small label={money(t.amountCents)} variant={amountCents === t.amountCents ? "primary" : "outline"}
                onPress={() => setAmountInput(String(t.amountCents / 100))} />
            ))}
          </Row>
        )}
        <Field value={amountInput || (initialTier ? String(initialTier.amountCents / 100) : "")} onChangeText={(v) => setAmountInput(v.replace(/[^0-9.]/g, ""))}
          placeholder="Or type an amount in dollars" keyboardType="numeric" />
      </FormGroup>

      {earned && (
        <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft, padding: spacing.md, gap: spacing.sm }}>
          <Row center gap={6}>
            <Icon name="checkmark" size={16} color={colors.primary} />
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>You get: {earned.name}</Text>
          </Row>
          <Row center gap={spacing.sm}>
            <TierBadge levelKey={level.key} previews={data.badgePreviews || {}} logoUrl={data.badgeLogoUrl ?? null} size={36} />
            <Meta style={{ flex: 1, fontSize: font.sm }}>A <Text style={{ color: level.hex, fontFamily: fontFamily.semibold }}>{level.label}</Text> backer badge for your profile.</Meta>
          </Row>
          {needsShipping && (
            <Row gap={spacing.sm}>
              {(["front", "back"] as const).map((face) => (
                <View key={face} style={{ flex: 1, gap: 2 }}>
                  <Image source={{ uri: `${API_URL}/api/projects/${projectId}/merch/preview.png?face=${face}&width=400` }}
                    style={{ width: "100%", aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.surface }} resizeMode="contain" />
                  <Meta style={{ textAlign: "center", textTransform: "uppercase" }}>{face}</Meta>
                </View>
              ))}
            </Row>
          )}
          <Rewards tier={earned} />
          {needsShipping && <Meta>Stripe will ask for your shipping address on the next screen.</Meta>}
        </View>
      )}

      <FormGroup label="Tip SparkTower" hint={`SparkTower is free for backers. A tip keeps it that way — it goes to us, not to the project, and ${money(amountCents)} still reaches the creator either way.`}>
        <Row wrap gap={spacing.xs + 2}>
          {TIP_PRESET_PERCENTS.map((p) => (
            <Btn key={p} small label={p === 0 ? "None" : `${p}%`} variant={tipPercent === p ? "primary" : "outline"} onPress={() => setTipPercent(p)} />
          ))}
        </Row>
      </FormGroup>

      <FormGroup label="Say something (optional)">
        <Field value={message} onChangeText={setMessage} multiline maxLength={280} placeholder="Goes on the backer wall." />
        <CheckRow checked={isAnonymous} onChange={setIsAnonymous} label="Back anonymously" />
      </FormGroup>

      <FormGroup label="If the project isn't confirmed" hint={`Your money is held until someone at SparkTower confirms this project is real. If that hasn't happened within ${data.refundWindowDays} days:`}>
        <CheckRow checked={unclaimed === "refund"} onChange={() => setUnclaimed("refund")} label="Refund me" />
        <CheckRow checked={unclaimed === "donate_platform"} onChange={() => setUnclaimed("donate_platform")} label="Keep it — put it toward SparkTower" />
      </FormGroup>

      <Row between style={{ borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingTop: spacing.md }}>
        <Meta style={{ fontSize: font.sm }}>Total today</Meta>
        <Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg, color: colors.text }}>{money(amountCents + tipCents)}</Text>
      </Row>
    </ProjectFormSheet>
  );
}
