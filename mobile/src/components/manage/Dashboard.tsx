/**
 * A section's dashboard — Ship, Systemize or Raise — on its own path. It
 * leads with the one next step (or Nova's money-first welcome on business and
 * funding sections), then compact blocks; the project-wide briefing sits last,
 * on the primary section only. The native counterpart of nova-dashboard.tsx,
 * with the onboarding welcome from nova-guide.tsx.
 */
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useEntitlementsQuery } from "../../hooks/useEntitlements";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, Card, Cost, Icon, Meta, NovaGradient, Row } from "../ui";
import { Block, Clamp, useNotify } from "./bits";
import { PathPanel, usePath } from "./PathPanel";
import { IntakeView } from "./WorkView";
import { NovaWelcomeCard } from "./path/NovaGuide";
import { mkey, type ProjectGoal } from "./shared";

interface Briefing {
  completion: number;
  breakdown: { label: string; done: boolean; weight: number }[];
  recommendations: { id: string; title: string; detail?: string; actionLabel: string; credits: number; tab?: string; action?: string; severity: "critical" | "important" | "suggested" }[];
  totalRecommendations: number;
  stats: { phases: number; completedPhases: number; milestones: number; tasks: number; doneTasks: number; openTasks: number; members: number; teamSize: number | null };
}

const SEVERITY: Record<string, string> = { critical: "#E11D48", important: colors.warning, suggested: `${colors.primary}88` };

/** Which mobile tab answers a web tab or a handoff — the same tab set as the web now, bar the Kanban's name. */
const TAB_FOR: Record<string, string> = {
  kanban: "tasks", milestones: "milestones", team: "team", setup: "setup", activity: "activity", roadmap: "roadmap",
  strategy: "strategy", personas: "personas", analytics: "analytics", research: "research", files: "files", codebase: "codebase",
  public: "public", investors: "investors", launch: "launch", support: "support", chat: "chat",
};
const HANDOFF_TAB: Record<string, string> = {
  "roadmap.nextActions": "roadmap", "roadmap.update": "roadmap", "roadmap.rebuild": "roadmap", "kanban.generate": "kanban",
  "personas.generate": "personas", "team.recommendPeople": "team", "strategy.readiness": "strategy", "strategy.pricing": "strategy",
  "analytics.healthCheck": "analytics",
};

const FIRST_STEP: Partial<Record<ProjectGoal, string>> = { systemize_business: "SYS.F1.1", run_company: "RUN.S1.1" };

export function Dashboard({ projectId, project, goal, isPrimary, onNavigate, onOpenNova, onStartSection }: {
  projectId: string; project: any; goal: ProjectGoal; isPrimary: boolean; onNavigate: (tab: string) => void;
  /** Opens Nova's conversation, optionally sending a quick reply. */
  onOpenNova?: (message?: string) => void;
  onStartSection?: () => void;
}) {
  const qc = useQueryClient();
  const { fail } = useNotify();
  const { data: path, isLoading: pathLoading } = usePath(projectId, goal);

  const completeOnboarding = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/nova-guide/complete-onboarding`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: mkey(projectId, "project") }),
    onError: (e) => fail(e),
  });

  // A business starts with money: on the systemize and funding sections, Nova's
  // first screen is the first step's bubbles, until onboarding is done.
  const firstStep = FIRST_STEP[goal];
  const moneyStep = !project?.novaOnboardingComplete && firstStep && path?.adopted && path.next?.id === firstStep && path.next.workTaskId && path.next.intake?.length
    ? { taskId: path.next.workTaskId, questions: path.next.intake }
    : null;

  // The primary section opens on Nova's welcome until setup is done or skipped (nova-guide.tsx's overlay).
  const welcome = isPrimary && !project?.novaOnboardingComplete && !moneyStep && !pathLoading && !!onOpenNova;

  return (
    <View style={{ gap: spacing.md }}>
      {moneyStep && (
        <View style={{ borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <NovaGradient style={{ padding: spacing.lg, gap: 6 }}>
            <Row center gap={spacing.sm}>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" }}>
                <Icon name="sparkles" size={16} color="#FFFFFF" />
              </View>
              <Text style={{ color: "#FFFFFF", fontFamily: fontFamily.semibold, fontSize: font.sm }}>Nova · your project partner</Text>
            </Row>
            <Text style={{ color: "#FFFFFF", fontFamily: fontFamily.bold, fontSize: font.lg, lineHeight: 23 }}>
              {goal === "run_company" ? "Let's get your week under control." : "Starting a business can be scary, but you're not doing it alone."}
            </Text>
          </NovaGradient>
          <View style={{ padding: spacing.lg, gap: spacing.lg }}>
            <Clamp color={colors.text} text={goal === "run_company"
              ? "I'm Nova. You already have a business, so we don't start from zero — we start from this week. A quick picture of the company first, then the five numbers worth watching, and from there a check-in every week and a report every month on what improved. Start with where it stands. Tap what fits."
              : "I'm Nova. The first thing that decides what's possible is money, so that's where we start — what it'll cost, where it comes from, and what gets you there, even from zero. Tap the ranges that fit you. There are no wrong answers, and $0 is a real starting point."} />
            <IntakeView projectId={projectId} taskId={moneyStep.taskId} questions={moneyStep.questions} work={null} done={false} onSaved={() => completeOnboarding.mutate()} />
            <Btn small variant="ghost" label="Skip for now" onPress={() => completeOnboarding.mutate()} style={{ alignSelf: "flex-start" }} />
          </View>
        </View>
      )}

      {!moneyStep && <PathPanel projectId={projectId} goal={goal} isPrimary={isPrimary} onNavigate={onNavigate} onStartSection={onStartSection} />}

      {/* The next step stays first; Nova's welcome waits under the path until setup is done or skipped. */}
      {welcome && <NovaWelcomeCard onOpen={(m) => onOpenNova!(m)} onSkip={() => completeOnboarding.mutate()} skipping={completeOnboarding.isPending} />}

      {/* The project-wide briefing belongs to the project, not a path: the primary section only. */}
      {isPrimary && <ProjectBriefing projectId={projectId} onNavigate={onNavigate} />}
    </View>
  );
}

/**
 * Nova's project-wide suggestions as a short list. The briefing is free;
 * acting on one costs credits, and the row shows the price.
 */
function ProjectBriefing({ projectId, onNavigate }: { projectId: string; onNavigate: (tab: string) => void }) {
  const { creditsRemaining, isUnlimited } = useEntitlementsQuery();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { data } = useQuery({
    queryKey: mkey(projectId, "briefing"),
    queryFn: () => api<Briefing>(`/api/projects/${projectId}/nova-briefing`),
  });
  if (!data) return null;
  const recs = showAll ? data.recommendations : data.recommendations.slice(0, 3);

  return (
    <Card style={{ paddingVertical: 0, gap: 0 }}>
      <Block
        title="Project setup"
        icon="bulb-outline"
        testID="project-briefing"
        right={
          <Pressable onPress={() => setShowBreakdown(!showBreakdown)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Text style={{ fontSize: font.sm, fontFamily: fontFamily.bold, color: colors.text }}>{data.completion}%</Text>
            <Icon name={showBreakdown ? "chevron-up" : "chevron-down"} size={13} color={colors.textTertiary} />
          </Pressable>
        }
      >
        {showBreakdown && (
          <View style={{ gap: 4 }}>
            {data.breakdown.map((b) => (
              <Row key={b.label} center gap={spacing.sm}>
                <Icon name={b.done ? "checkmark-circle" : "ellipse-outline"} size={14} color={b.done ? colors.success : colors.textTertiary} />
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.regular, color: b.done ? colors.text : colors.textTertiary }}>{b.label}</Text>
              </Row>
            ))}
          </View>
        )}
        {data.recommendations.length === 0 ? (
          <Row center gap={6}><Icon name="checkmark-circle" size={15} color={colors.success} /><Meta>All set.</Meta></Row>
        ) : (
          <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm }}>
            {recs.map((rec, i) => {
              const cantAfford = !isUnlimited && rec.credits > 0 && creditsRemaining < rec.credits;
              const webTab = rec.action ? HANDOFF_TAB[rec.action] : rec.tab;
              const dest = webTab ? TAB_FOR[webTab] ?? webTab : null;
              return (
                <Pressable
                  key={rec.id}
                  disabled={cantAfford || !dest}
                  onPress={() => dest && onNavigate(dest)}
                  style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.sm + 2, borderTopWidth: i ? 1 : 0, borderColor: colors.borderSubtle }, pressed && { opacity: 0.6 }]}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: SEVERITY[rec.severity] }} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={2} style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{rec.title}</Text>
                    {cantAfford && <Meta style={{ color: colors.danger }}>Needs {rec.credits} credits</Meta>}
                  </View>
                  {rec.credits > 0 && <Cost credits={rec.credits} />}
                  <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: dest && !cantAfford ? colors.primary : colors.textTertiary }}>{rec.actionLabel}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {data.recommendations.length > 3 && (
          <Pressable onPress={() => setShowAll(!showAll)} hitSlop={6}>
            <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: colors.primary }}>{showAll ? "Show less" : `+${data.recommendations.length - 3} more`}</Text>
          </Pressable>
        )}
      </Block>
    </Card>
  );
}
