/**
 * The manager's landing tab: greeting and completion, Nova's money-first
 * welcome on business and funding paths, the path, the numbers, and Nova's
 * recommendations. The native counterpart of nova-dashboard.tsx, with the
 * onboarding welcome from nova-guide.tsx.
 */
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { useEntitlementsQuery } from "../../hooks/useEntitlements";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Body, Btn, Card, Cost, Icon, Loading, Meta, NovaGradient, Progress, Row, type IconName } from "../ui";
import { useNotify } from "./bits";
import { PathPanel, usePath } from "./PathPanel";
import { IntakeView } from "./WorkView";
import { NovaWelcomeCard } from "./path/NovaGuide";
import { mkey } from "./shared";

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
  public: "public", investors: "investors", launch: "launch", support: "support", chat: "chat", checkins: "checkins",
};
const HANDOFF_TAB: Record<string, string> = {
  "roadmap.nextActions": "roadmap", "roadmap.update": "roadmap", "roadmap.rebuild": "roadmap", "kanban.generate": "kanban",
  "personas.generate": "personas", "team.recommendPeople": "team", "strategy.readiness": "strategy", "strategy.pricing": "strategy",
  "analytics.healthCheck": "analytics", "activity.checkIn": "checkins",
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const FIRST_STEP: Record<string, string> = { systemize_business: "SYS.F1.1", raise_funding: "FUND.C1.1" };

export function Dashboard({ projectId, project, onNavigate, onOpenNova }: {
  projectId: string; project: any; onNavigate: (tab: string) => void;
  /** Opens Nova's conversation, optionally sending a quick reply. */
  onOpenNova?: (message?: string) => void;
}) {
  const { user } = useAuth();
  const { creditsRemaining, isUnlimited } = useEntitlementsQuery();
  const qc = useQueryClient();
  const { fail } = useNotify();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: mkey(projectId, "briefing"),
    queryFn: () => api<Briefing>(`/api/projects/${projectId}/nova-briefing`),
  });
  const { data: path, isLoading: pathLoading } = usePath(projectId);

  const completeOnboarding = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/nova-guide/complete-onboarding`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: mkey(projectId, "project") }),
    onError: (e) => fail(e),
  });

  if (isLoading) return <View style={{ height: 240 }}><Loading /></View>;

  // A business starts with money: on the systemize and funding paths, Nova's
  // first screen is the first step's bubbles, until onboarding is done.
  const firstStep = FIRST_STEP[project?.goal ?? ""];
  const moneyStep = !project?.novaOnboardingComplete && firstStep && path?.adopted && path.next?.id === firstStep && path.next.workTaskId && path.next.intake?.length
    ? { taskId: path.next.workTaskId, questions: path.next.intake }
    : null;

  // Every other project opens on Nova's welcome until setup is done or skipped (nova-guide.tsx's overlay).
  const welcome = !project?.novaOnboardingComplete && !moneyStep && !pathLoading && !!onOpenNova;

  const stats = data?.stats;
  const tiles: { icon: IconName; label: string; value: string; tab: string }[] = stats ? [
    { icon: "map-outline", label: "Phases done", value: `${stats.completedPhases}/${stats.phases}`, tab: "roadmap" },
    { icon: "flag-outline", label: "Milestones", value: String(stats.milestones), tab: "milestones" },
    { icon: "checkbox-outline", label: "Tasks done", value: `${stats.doneTasks}/${stats.tasks}`, tab: "tasks" },
    { icon: "people-outline", label: "Team", value: `${stats.members}/${stats.teamSize ?? "?"}`, tab: "team" },
  ] : [];

  return (
    <View style={{ gap: spacing.md }}>
      {data && (
        <Card style={{ gap: spacing.sm }}>
          <Text style={{ fontSize: font.xl, fontFamily: fontFamily.bold, color: colors.text, letterSpacing: -0.3 }}>{greeting()}, {user?.firstName || "there"}</Text>
          <Body muted style={{ fontSize: font.base }}>Your project is <Text style={{ color: colors.text, fontFamily: fontFamily.bold }}>{data.completion}% complete</Text></Body>
          <Progress value={data.completion} />
          <Pressable onPress={() => setShowBreakdown(!showBreakdown)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name={showBreakdown ? "chevron-up" : "chevron-down"} size={13} color={colors.textTertiary} />
            <Meta>{showBreakdown ? "Hide" : "What's counted"}</Meta>
          </Pressable>
          {showBreakdown && (
            <View style={{ gap: 5 }}>
              {data.breakdown.map((b) => (
                <Row key={b.label} center gap={spacing.sm}>
                  <Icon name={b.done ? "checkmark-circle" : "ellipse-outline"} size={15} color={b.done ? colors.success : colors.textTertiary} />
                  <Body muted={!b.done}>{b.label}</Body>
                </Row>
              ))}
            </View>
          )}
        </Card>
      )}

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
              {project.goal === "raise_funding" ? "Let's find the money for your business." : "Starting a business can be scary, but you're not doing it alone."}
            </Text>
          </NovaGradient>
          <View style={{ padding: spacing.lg, gap: spacing.lg }}>
            {project.goal === "raise_funding" ? (
              <Body>I'm Nova. First I'll get to know what you want from owning a business and where you stand, then build your capital profile — with a score for how fundable you are today and exactly what raises it — and map every route to the money. Start with why. Pick everything that's true.</Body>
            ) : (
              <Body>I'm Nova. The first thing that decides what's possible is money, so that's where we start — what it'll cost, where it comes from, and what gets you there, even from zero. Tap the ranges that fit you. There are no wrong answers, and <Text style={{ fontFamily: fontFamily.bold }}>$0</Text> is a real starting point.</Body>
            )}
            <IntakeView projectId={projectId} taskId={moneyStep.taskId} questions={moneyStep.questions} work={null} done={false} onSaved={() => completeOnboarding.mutate()} />
            <Btn small variant="ghost" label="Skip for now" onPress={() => completeOnboarding.mutate()} style={{ alignSelf: "flex-start" }} />
          </View>
        </View>
      )}

      {welcome && <NovaWelcomeCard onOpen={(m) => onOpenNova!(m)} onSkip={() => completeOnboarding.mutate()} skipping={completeOnboarding.isPending} />}

      {!moneyStep && <PathPanel projectId={projectId} onNavigate={onNavigate} />}

      {tiles.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {tiles.map((t) => (
            <Pressable key={t.label} onPress={() => onNavigate(t.tab)} style={({ pressed }) => [{ width: "48%", flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 2 }, pressed && { opacity: 0.7 }]}>
              <Row center gap={5}><Icon name={t.icon} size={14} color={colors.textTertiary} /><Meta>{t.label}</Meta></Row>
              <Text style={{ fontSize: font.xl, fontFamily: fontFamily.bold, color: colors.text }}>{t.value}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {data && (
        <View style={{ gap: spacing.sm }}>
          <Row center gap={6} style={{ paddingHorizontal: 2 }}>
            <Icon name="sparkles" size={15} color={colors.primary} />
            <Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>Nova recommends</Text>
            {data.totalRecommendations > data.recommendations.length && <Meta>+{data.totalRecommendations - data.recommendations.length} more</Meta>}
          </Row>
          {data.recommendations.length === 0 ? (
            <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
              <Icon name="checkmark-circle" size={32} color={colors.success} />
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>Nothing needs your attention</Text>
              <Meta style={{ textAlign: "center" }}>Your brief, roadmap, tasks and team are all in good shape. Keep shipping.</Meta>
            </Card>
          ) : data.recommendations.map((rec, i) => {
            const cantAfford = !isUnlimited && rec.credits > 0 && creditsRemaining < rec.credits;
            const webTab = rec.action ? HANDOFF_TAB[rec.action] : rec.tab;
            const dest = webTab ? TAB_FOR[webTab] ?? webTab : null;
            return (
              <Card key={rec.id} accent={SEVERITY[rec.severity]}>
                <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.textTertiary }}>{i + 1}.</Text>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm + 1, color: colors.text, lineHeight: 20 }}>{rec.title}</Text>
                    {!!rec.detail && <Meta>{rec.detail}</Meta>}
                    {cantAfford && <Meta style={{ color: colors.danger }}>Needs {rec.credits} credits, you have {creditsRemaining}</Meta>}
                    <Row center gap={spacing.sm} style={{ marginTop: 2 }}>
                      <Btn small icon="arrow-forward" variant={rec.severity === "critical" ? "primary" : "outline"} label={rec.actionLabel}
                        disabled={cantAfford || !dest} onPress={() => dest && onNavigate(dest)} />
                      {rec.credits > 0 && <Cost credits={rec.credits} />}
                    </Row>
                  </View>
                </Row>
              </Card>
            );
          })}
          <Meta style={{ paddingHorizontal: 2 }}>Recommendations are free — you only spend credits when you run one.</Meta>
        </View>
      )}
    </View>
  );
}
