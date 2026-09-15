/**
 * The manager's big tools that stay on the website — too dense to half-build
 * on a phone. Each row opens the web manager, where the tab is one tap away.
 */
import { View } from "react-native";
import { spacing } from "../../theme";
import { Card, Divider, Meta } from "../ui";
import { WebToolRow } from "./bits";
import type { IconName } from "../ui";

const TOOLS: { icon: IconName; title: string; subtitle: string; tab: string }[] = [
  { icon: "document-text-outline", title: "Files & Nova documents", subtitle: "Upload files and build business documents page by page", tab: "files" },
  { icon: "scan-outline", title: "Codebase audit", subtitle: "Connect a repo, audit it, and review the changes it proposes", tab: "codebase" },
  { icon: "bar-chart-outline", title: "Analytics", subtitle: "Metrics, activation events and the health check", tab: "analytics" },
  { icon: "flask-outline", title: "Research", subtitle: "User interviews and experiments", tab: "research" },
  { icon: "locate-outline", title: "Strategy", subtitle: "Pricing, legal basics and the business model", tab: "strategy" },
  { icon: "rocket-outline", title: "Launch", subtitle: "Launch checklist, landing copy and go-to-market", tab: "launch" },
  { icon: "person-circle-outline", title: "Personas", subtitle: "The people you're building for", tab: "personas" },
  { icon: "pulse-outline", title: "Activity & decisions", subtitle: "The project log and the decisions behind it", tab: "activity" },
  { icon: "headset-outline", title: "Support", subtitle: "Support workflow and FAQs", tab: "support" },
  { icon: "chatbubbles-outline", title: "Team chat", subtitle: "The project's live chat", tab: "chat" },
];

export function WebTools({ projectId }: { projectId: string }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Meta style={{ paddingHorizontal: 2 }}>These tools work best on a bigger screen. Each one opens your project on the website.</Meta>
      <Card style={{ gap: 0, paddingVertical: spacing.xs }}>
        {TOOLS.map((t, i) => (
          <View key={t.tab}>
            {i > 0 && <Divider />}
            <WebToolRow icon={t.icon} title={t.title} subtitle={t.subtitle} path={`/projects/${projectId}/manage?tab=${t.tab}`} />
          </View>
        ))}
      </Card>
    </View>
  );
}
