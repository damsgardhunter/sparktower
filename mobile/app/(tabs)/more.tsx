import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, fetchMe } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { useEntitlementsQuery } from "../../src/hooks/useEntitlements";
import { colors, font, fontFamily, spacing } from "../../src/theme";
import { Icon, Progress, TAB_BAR_SPACE } from "../../src/components/ui";
import { GlossyButton } from "../../src/components/feed/Box";
import { Group, MenuRow, Pill, useSurfaces } from "../../src/components/MoreKit";
import { ContinuePathCard } from "../../src/components/feed/ContinuePathCard";
// The header floats over the scene, so this screen leaves its room in the scroll content.
import { usePlainHeaderSpace } from "../../src/components/AppHeader";

/**
 * Everything that doesn't earn a tab — the phone's version of the web sidebar.
 *
 * Laid out the way a professional network's "Me" menu is: who you are at the
 * top, your plan and credits, then grouped rows. Items tied to a kill switch
 * (GET /api/surfaces) disappear when it's off, exactly as the sidebar does.
 */
export default function More() {
  const headerSpace = usePlainHeaderSpace({ subtitle: true });
  const router = useRouter();
  const { signOut } = useAuth();
  const { on } = useSurfaces();
  const ent = useEntitlementsQuery();

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const { data: plans } = useQuery({ queryKey: ["plans"], queryFn: () => api<any>("/api/plans") });

  const isReviewer = ["reviewer", "admin"].includes(me?.user?.platformRole);
  const { data: safety } = useQuery({
    queryKey: ["safety-status"],
    queryFn: () => api<{ reviewDue: boolean; alerts: number }>("/api/admin/safety/status"),
    enabled: isReviewer,
    refetchInterval: 5 * 60_000,
  });

  /*
   * Just the count, for the badge on "Being scouted". The screen itself reads
   * the invitations; this is the one number the menu needs.
   */
  const { data: scouting } = useQuery({
    queryKey: ["talent-waiting"],
    queryFn: async () => {
      const r = await api<{ invites: { status: string }[] }>("/api/talent/invites");
      return { waiting: (r.invites ?? []).filter((i) => i.status === "sent").length };
    },
  });

  // Analytics is the platform owner's alone; the server answers { owner } (and 404s every analytics route otherwise).
  const { data: access } = useQuery({
    queryKey: ["analytics-access"],
    queryFn: () => api<{ owner: boolean }>("/api/admin/analytics/access"),
    enabled: isReviewer,
    retry: false,
  });


  const planList: any[] = plans?.plans ?? [];
  const plan = planList.find((p) => p.tier === ent.tier);
  const builderPromise = planList.find((p) => p.tier === "builder")?.promise;
  const pct = ent.isUnlimited || ent.creditsLimit <= 0 ? 0 : Math.min(100, (ent.creditsUsed / ent.creditsLimit) * 100);
  const go = (href: string) => router.push(href as any);

  return (
    <>
      {/* A tab now, so the title and header come from the tabs layout — and the
          floating bar sits over the scene, so the list ends above it. */}
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ paddingTop: headerSpace, paddingBottom: TAB_BAR_SPACE, gap: spacing.lg }}>
        {/*
          * What you are in the middle of, at the top of the menu.
          *
          * This spot held the profile block, then the create button. Neither
          * was what somebody opening this screen was looking for — the profile
          * has since left this screen altogether, and creating a project is
          * the one thing you do before you have any of these and rarely after. The
          * work in progress is the thing worth a tap, and it is the same card
          * Home uses, from the same endpoint — so it is recognisably the same
          * list rather than a second opinion about what you should do next.
          *
          * It renders nothing when there are no projects, which is exactly
          * when the create button below should be the first thing on screen.
          */}
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ContinuePathCard />
        </View>

        <View style={{ paddingHorizontal: spacing.lg }}>
          <GlossyButton
            label="Create Project"
            icon="add"
            onPress={() => go("/project/new")}
            testID="button-create-project-more"
          />
        </View>

        {/* Plan and credits, as in the web sidebar's footer. */}
        {!ent.isLoading && (
          <Pressable onPress={() => go("/pricing")} testID="more-credits"
            style={({ pressed }) => [{ backgroundColor: colors.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm }, pressed && { opacity: 0.85 }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Icon name="flash" size={16} color={colors.primary} />
              <Text style={{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>
                {plan?.name ?? (ent.tier.charAt(0).toUpperCase() + ent.tier.slice(1))} plan
              </Text>
              {ent.isUnlimited ? (
                <Pill label="Unlimited" icon="sparkles" />
              ) : (
                <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.medium }}>
                  {ent.creditsRemaining} of {ent.creditsLimit} credits left
                </Text>
              )}
            </View>
            {!ent.isUnlimited && <Progress value={pct} />}
            {ent.tier === "free" && builderPromise ? (
              <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{builderPromise}</Text>
            ) : ent.tier !== "pro" ? (
              <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>Compare plans</Text>
            ) : null}
          </Pressable>
        )}

        <Group title="Build">
          {/*
            * The path is the retention loop's home, and the phone had the list
            * (ContinuePathCard on the feed) with nowhere to be sent to — behind
            * whatever else was on the feed that day, and hidden entirely when
            * empty. This is its address.
            */}
          <MenuRow icon="compass" title="Your path" subtitle="Every project's next step, on one screen" tint={colors.primary} onPress={() => go("/path")} testID="more-path" />
          {on("sprints") && <MenuRow icon="people" title="Simulations" subtitle="Invent a company in half an hour, or run one for a fortnight" onPress={() => go("/(tabs)/sprints")} testID="more-sprints" />}
          {/*
            * "Practice sprint" used to sit here, pointing at /sprint/practice.
            * There is no app/sprint/ directory any more — the screen was never
            * ported — so the row opened expo-router's "unmatched route" page.
            * A menu item that leads nowhere is worse than a missing one: it
            * reads as the app being broken rather than the feature being
            * absent. Sprints themselves are the row above.
            */}
          {on("contests") && <MenuRow icon="ribbon" title="Contests and Communities" subtitle="Compete, and join people building like you" tint="#E11D48" onPress={() => go("/contests")} testID="more-contests" />}
          {/*
            * "Build my profile" and "Profile details" used to sit here. Both
            * were the onboarding a person has already either done or declined,
            * offered again in a menu for the rest of the account's life — and
            * both are editing work that is easier on a keyboard. Editing a
            * profile is still one tap away, from the profile itself.
            */}
        </Group>

        <Group title="Community">
          {on("matches") && <MenuRow icon="people-circle" title="Matches" subtitle="Builders who fit what you're looking for" tint={colors.primary} onPress={() => go("/matches")} testID="more-matches" />}
          {on("leaderboard") && <MenuRow icon="trophy" title="Leaderboard" subtitle="Builder Index and top projects" tint="#CA8A04" onPress={() => go("/(tabs)/leaderboard")} testID="more-leaderboard" />}
          {on("messages") && <MenuRow icon="chatbubbles" title="Messages" subtitle="Your conversations" tint={colors.info} onPress={() => go("/(tabs)/messages")} />}
          {/*
            * Behind the `companies` switch, because being scouted is the other
            * side of a company recruiting and that switch covers `/api/talent`.
            * Badged when somebody is waiting on an answer: an invitation nobody
            * sees is the thing this screen exists to prevent.
            */}
          {on("companies") && (
            <MenuRow
              icon="trophy"
              title="Challenges"
              subtitle="Briefs companies posted, with a prize"
              tint="#CA8A04"
              onPress={() => go("/challenges")}
              testID="more-challenges"
            />
          )}
          {on("companies") && (
            <MenuRow
              icon="business"
              title="Companies"
              subtitle="The companies you act for, and what each can do"
              tint={colors.primary}
              onPress={() => go("/companies")}
              testID="more-companies"
            />
          )}
          {on("companies") && (
            <MenuRow
              icon="people"
              title="Being scouted"
              subtitle="Whether companies can find you, and who has asked"
              tint={colors.novaEmerald}
              badge={scouting?.waiting ? scouting.waiting : null}
              onPress={() => go("/talent")}
              testID="more-talent"
            />
          )}
        </Group>

        {isReviewer && (
          <Group title="Admin">
            <MenuRow icon="shield-checkmark" title="Safety review" subtitle="Reports, limits and the daily checklist" tint={colors.success}
              badge={safety ? (safety.alerts > 0 ? safety.alerts : safety.reviewDue ? "Due" : null) : null}
              onPress={() => go("/admin/safety")} testID="more-safety" />
            <MenuRow icon="flag" title="Reports" subtitle="What people reported, and what was done" tint={colors.danger} onPress={() => go("/admin/reports")} testID="more-reports" />
            <MenuRow icon="cash" title="Backing review" subtitle="Campaigns waiting on a decision and payouts" tint={colors.warning} onPress={() => go("/admin/backing")} />
            <MenuRow icon="toggle" title="Surfaces" subtitle="Kill switches for each feature area" tint={colors.textSecondary} onPress={() => go("/admin/surfaces")} />
            {access?.owner && <MenuRow icon="analytics" title="Analytics" subtitle="Visits, signups and what people do" tint={colors.novaPurple} onPress={() => go("/admin/analytics")} />}
            {/*
              * Owner-only, like Analytics and for the same reason: the route
              * answers 404 to anybody else, so showing the row to a reviewer
              * would be offering a door that opens onto "not found".
              */}
            {access?.owner && <MenuRow icon="wallet" title="Revenue" subtitle="Collected, owed, and what's actually ours" tint={colors.success} onPress={() => go("/admin/revenue")} testID="more-revenue" />}
            {access?.owner && <MenuRow icon="flash" title="AI spend" subtitle="What the model costs, and against what brake" tint={colors.novaEmerald} onPress={() => go("/admin/ai-spend")} testID="more-ai-spend" />}
            {/* requireAdmin, not requireOwner — a reviewer may look somebody up. */}
            <MenuRow icon="search" title="Support console" subtitle="Look somebody up, and what was done to them" tint={colors.info} onPress={() => go("/admin/console")} testID="more-console" />
            <MenuRow icon="warning" title="Problem reports" subtitle="What people told us is broken" tint={colors.warning} onPress={() => go("/admin/problems")} testID="more-problems" />
            <MenuRow icon="shield-checkmark" title="Security" subtitle="Who has power, and whether they are protected" tint={colors.danger} onPress={() => go("/admin/security")} testID="more-security" />
          </Group>
        )}

        <Group title="Account">
          <MenuRow icon="cash" title="Earnings" subtitle="What you've earned, and where the next of it goes" tint={colors.success} onPress={() => go("/earnings")} testID="more-earnings" />
          <MenuRow icon="card" title="Plans & credits" subtitle={plan ? `You're on ${plan.name}` : "Compare plans"} onPress={() => go("/pricing")} testID="more-pricing" />
          <MenuRow icon="settings" title="Settings" subtitle="Account, security and sign-in" tint={colors.textSecondary} onPress={() => go("/settings")} testID="more-settings" />
          <MenuRow icon="help-circle" title="Help & about" subtitle="How SparkTower works" tint={colors.textSecondary} onPress={() => go("/settings?section=help")} />
          {/*
            * The web puts this in every footer; the phone has no footer, so it
            * sits here. Not behind a surface flag: a way to say "this is broken"
            * that can itself be switched off is the one feature you want left on
            * when something is.
            */}
          <MenuRow icon="bug" title="Report a problem" subtitle="Something broken? Tell us" tint={colors.warning} onPress={() => go("/report-problem")} testID="more-report-problem" />
        </Group>

        <Group>
          <MenuRow icon="log-out-outline" title="Sign out" danger onPress={() => { void signOut(); }} testID="more-sign-out" />
        </Group>
      </ScrollView>
    </>
  );
}
