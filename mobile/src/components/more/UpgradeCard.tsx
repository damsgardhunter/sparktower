/**
 * Shown in place of a gated feature — the phone's version of the web's
 * client/src/components/upgrade-prompt.tsx. It names the plan that unlocks the
 * feature (from GET /api/plans) rather than a generic "upgrade required", and
 * sends you to Plans & credits, which keeps iOS off Stripe checkout.
 */
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, Icon } from "../ui";
import { Pill } from "../MoreKit";

export function UpgradeCard({ tier, title, description }: {
  /** The plan to pitch: "starter", "builder" or "pro". */
  tier: string;
  title: string;
  description: string;
}) {
  const router = useRouter();
  const { data } = useQuery({ queryKey: ["plans"], queryFn: () => api<any>("/api/plans"), staleTime: 5 * 60_000 });
  const plan = (data?.plans ?? []).find((p: any) => p.tier === tier);
  return (
    <View style={{
      backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border,
      padding: spacing.lg, alignItems: "center", gap: spacing.sm,
    }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
        <Icon name="sparkles" size={20} color={colors.primary} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap", justifyContent: "center" }}>
        <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{title}</Text>
        {plan ? <Pill label={plan.name} color={colors.textSecondary} /> : null}
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular, textAlign: "center" }}>{description}</Text>
      <Btn label={plan?.cta ?? "See plans"} icon="sparkles" onPress={() => router.push("/pricing")} style={{ marginTop: spacing.xs }} />
      {plan && plan.price > 0 ? (
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>${Number(plan.price).toFixed(2)}/month · cancel anytime</Text>
      ) : null}
    </View>
  );
}
