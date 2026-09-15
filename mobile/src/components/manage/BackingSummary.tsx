/**
 * Backing, at the foot of Setup as on the web (client/src/components/
 * backing-setup.tsx): open or close the campaign, where review stands, and
 * the numbers. Building tiers, merch and Stripe payouts stays on the website.
 */
import { Switch, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Btn, Card, Icon, Loading, Meta, Row, type IconName } from "../ui";
import { money } from "../../projectData";
import { openWeb, useNotify } from "./bits";
import { mkey } from "./shared";

interface BackingSetupData {
  campaign: { enabled: boolean; reviewStatus: "not_submitted" | "pending" | "approved" | "rejected"; reviewNotes: string | null; believerCount: number };
  tiers: { id: string; isActive: boolean }[];
  payouts: { heldCents: number; releasedCents: number; backers: number };
}

const REVIEW: Record<string, { label: string; icon: IconName; color: string; blurb: string }> = {
  not_submitted: { label: "Not submitted", icon: "lock-closed-outline", color: colors.textTertiary, blurb: "You can collect pledges now. They're held by SparkTower until a human has looked at your project." },
  pending: { label: "In review", icon: "time-outline", color: "#F59E0B", blurb: "We're looking at it. Pledges keep coming in and stay held until this clears." },
  approved: { label: "Approved for payouts", icon: "checkmark-circle", color: "#10B981", blurb: "Held funds can be released to your Stripe account, and merch orders now ship as they come in." },
  rejected: { label: "Not approved", icon: "warning-outline", color: "#F43F5E", blurb: "Read the note below, fix what it says, and submit again." },
};

export function BackingSummary({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { fail } = useNotify();
  const key = mkey(projectId, "backing");
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api<BackingSetupData>(`/api/projects/${projectId}/backing`), retry: false });
  const save = useMutation({
    mutationFn: (enabled: boolean) => api(`/api/projects/${projectId}/backing`, { method: "PATCH", body: { enabled } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ["project", projectId, "backing", "public"] }); },
    onError: (e) => fail(e, "Couldn't save that"),
  });

  if (isLoading) return <Card><Loading /></Card>;
  if (!data) return null;
  const review = REVIEW[data.campaign.reviewStatus] ?? REVIEW.not_submitted;

  return (
    <Card>
      <Row between>
        <Row center gap={spacing.sm} style={{ flex: 1 }}>
          <Icon name="heart" size={17} color={colors.primary} />
          <Text style={{ fontSize: font.lg, fontFamily: fontFamily.semibold, color: colors.text }}>Backing</Text>
        </Row>
        <Meta>{data.campaign.enabled ? "Open" : "Closed"}</Meta>
        <Switch value={data.campaign.enabled} onValueChange={(v) => save.mutate(v)} disabled={save.isPending}
          trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#FFFFFF" accessibilityLabel="Backing open" />
      </Row>
      <Meta style={{ fontSize: font.sm, lineHeight: 19 }}>Donations, tiers and merch. Every backer earns a badge built from your logo.</Meta>
      <Row center gap={6}>
        <Icon name={review.icon} size={15} color={review.color} />
        <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: review.color }}>{review.label}</Text>
      </Row>
      <Meta style={{ lineHeight: 17 }}>{review.blurb}</Meta>
      {data.campaign.reviewNotes ? <Meta style={{ color: colors.text }}>{data.campaign.reviewNotes}</Meta> : null}
      <Row gap={spacing.sm}>
        {[
          ["Tiers", String(data.tiers.filter((t) => t.isActive).length)],
          ["Believers", String(data.campaign.believerCount ?? data.payouts.backers ?? 0)],
          ["Held", money(data.payouts.heldCents ?? 0)],
          ["Released", money(data.payouts.releasedCents ?? 0)],
        ].map(([label, value]) => (
          <View key={label} style={{ flex: 1, backgroundColor: colors.surfaceRaised, borderRadius: 8, padding: spacing.sm, gap: 2 }}>
            <Meta>{label}</Meta>
            <Text style={{ fontSize: font.sm, fontFamily: fontFamily.bold, color: colors.text }}>{value}</Text>
          </View>
        ))}
      </Row>
      <Btn small variant="outline" icon="open-outline" label="Tiers, merch & payouts on the web" style={{ alignSelf: "flex-start" }}
        onPress={() => openWeb(`/projects/${projectId}/manage`)} />
    </Card>
  );
}
