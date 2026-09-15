/**
 * The manager's tabs that stay on the website — too dense to half-build on a
 * phone. Each keeps its place in the tab strip, says what it does in the
 * web's words, and opens the web manager on that tab.
 */
import { Text, View } from "react-native";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Btn, Card, Icon, Meta, type IconName } from "../ui";
import { openWeb } from "./bits";

export type WebOnlyTab = "codebase" | "research" | "strategy" | "launch" | "analytics" | "support";

export const WEB_TABS: Record<WebOnlyTab, { icon: IconName; title: string; body: string; points: string[] }> = {
  codebase: {
    icon: "scan-outline", title: "Codebase", body: "Connect a repo, audit it, and review the changes Nova proposes.",
    points: ["Connect GitHub or the editor bridge", "Run an audit and read the findings", "Approve or reject proposed changes"],
  },
  research: {
    icon: "flask-outline", title: "Research", body: "User interviews and experiments.",
    points: ["Plan and log user interviews", "Track experiments and what they taught you"],
  },
  strategy: {
    icon: "locate-outline", title: "Strategy", body: "Pricing, legal basics and the business model.",
    points: ["Readiness check", "Pricing strategy", "Business model and legal basics"],
  },
  launch: {
    icon: "rocket-outline", title: "Launch", body: "Launch checklist, landing copy and go-to-market.",
    points: ["Launch checklist", "Landing page copy", "Go-to-market plan"],
  },
  analytics: {
    icon: "bar-chart-outline", title: "Analytics", body: "Metrics, activation events and the health check.",
    points: ["Metrics and activation events", "Project health check"],
  },
  support: {
    icon: "headset-outline", title: "Support", body: "Support workflow and FAQs.",
    points: ["Support workflow", "FAQs for your users"],
  },
};

export function WebTools({ projectId, tab }: { projectId: string; tab: WebOnlyTab }) {
  const t = WEB_TABS[tab];
  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
          <Icon name={t.icon} size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color: colors.text }}>{t.title}</Text>
          <Meta style={{ fontSize: font.sm }}>{t.body}</Meta>
        </View>
      </View>
      <View style={{ gap: 6 }}>
        {t.points.map((p) => (
          <View key={p} style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
            <Icon name="checkmark-circle-outline" size={16} color={colors.textTertiary} />
            <Text style={{ fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.regular }}>{p}</Text>
          </View>
        ))}
      </View>
      <Meta>This tool works best on a bigger screen, so it opens your project on the website.</Meta>
      <Btn icon="open-outline" label={`Open ${t.title} on the web`} onPress={() => openWeb(`/projects/${projectId}/manage?tab=${tab}`)} />
    </Card>
  );
}
