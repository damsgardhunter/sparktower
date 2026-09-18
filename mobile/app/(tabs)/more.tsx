import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, fetchMe } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { useEntitlementsQuery } from "../../src/hooks/useEntitlements";
import { colors, font, fontFamily, spacing } from "../../src/theme";
import { Avatar, Icon, NovaGradient, Progress, TAB_BAR_SPACE } from "../../src/components/ui";
import { Group, MenuRow, Pill, useSurfaces } from "../../src/components/MoreKit";

/**
 * Everything that doesn't earn a tab — the phone's version of the web sidebar.
 *
 * Laid out the way a professional network's "Me" menu is: who you are at the
 * top, your plan and credits, then grouped rows. Items tied to a kill switch
 * (GET /api/surfaces) disappear when it's off, exactly as the sidebar does.
 */
export default function More() {
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

  // Analytics is the platform owner's alone; the server answers { owner } (and 404s every analytics route otherwise).
  const { data: access } = useQuery({
    queryKey: ["analytics-access"],
    queryFn: () => api<{ owner: boolean }>("/api/admin/analytics/access"),
    enabled: isReviewer,
    retry: false,
  });

  const name = me?.profile?.displayName
    || [me?.user?.firstName, me?.user?.lastName].filter(Boolean).join(" ")
    || me?.user?.email || "You";
  const headline = me?.profile?.headline;
  const avatar = me?.profile?.avatarUrl ?? me?.user?.profileImageUrl;

  const planList: any[] = plans?.plans ?? [];
  const plan = planList.find((p) => p.tier === ent.tier);
  const builderPromise = planList.find((p) => p.tier === "builder")?.promise;
  const pct = ent.isUnlimited || ent.creditsLimit <= 0 ? 0 : Math.min(100, (ent.creditsUsed / ent.creditsLimit) * 100);
  const go = (href: string) => router.push(href as any);

  return (
    <>
      {/* A tab now, so the title and header come from the tabs layout — and the
          floating bar sits over the scene, so the list ends above it. */}
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE, gap: spacing.lg }}>
        {/* Who you are, linking to the profile. */}
        <Pressable
          onPress={() => go("/(tabs)/profile")}
          testID="more-profile"
          style={({ pressed }) => [{ backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border }, pressed && { opacity: 0.85 }]}
        >
          <NovaGradient style={{ height: 56 }} />
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, marginTop: -30 }}>
            <Avatar name={name} uri={avatar} size={64} ring />
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }} numberOfLines={1}>{name}</Text>
                {headline ? (
                  <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular }} numberOfLines={2}>{headline}</Text>
                ) : (
                  <Text style={{ color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.regular }}>Add a headline so builders know what you do</Text>
                )}
                <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold, marginTop: 4 }}>View profile</Text>
              </View>
              <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
            </View>
          </View>
        </Pressable>

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
          {on("sprints") && <MenuRow icon="people" title="Sprints" subtitle="Co-founder trial sprints and matchmaking" onPress={() => go("/(tabs)/sprints")} testID="more-sprints" />}
          {on("sprints") && <MenuRow icon="school" title="Practice sprint" subtitle="Rehearse the whole sprint with Nova" tint={colors.novaEmerald} onPress={() => go("/sprint/practice")} />}
          {on("contests") && <MenuRow icon="ribbon" title="Contests and Communities" subtitle="Compete, and join people building like you" tint="#E11D48" onPress={() => go("/contests")} testID="more-contests" />}
          <MenuRow icon="document-text" title="Build my profile" subtitle="Let Nova read your résumé" tint={colors.info} onPress={() => go("/profile-builder")} />
          <MenuRow icon="options" title="Profile details" subtitle="Skills, interests and co-founder preferences" tint={colors.info} onPress={() => go("/welcome")} />
        </Group>

        <Group title="Community">
          {on("matches") && <MenuRow icon="people-circle" title="Matches" subtitle="Builders who fit what you're looking for" tint={colors.primary} onPress={() => go("/matches")} testID="more-matches" />}
          {on("leaderboard") && <MenuRow icon="trophy" title="Leaderboard" subtitle="Builder Index and top projects" tint="#CA8A04" onPress={() => go("/(tabs)/leaderboard")} testID="more-leaderboard" />}
          {on("messages") && <MenuRow icon="chatbubbles" title="Messages" subtitle="Your conversations" tint={colors.info} onPress={() => go("/(tabs)/messages")} />}
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
          </Group>
        )}

        <Group title="Account">
          <MenuRow icon="card" title="Plans & credits" subtitle={plan ? `You're on ${plan.name}` : "Compare plans"} onPress={() => go("/pricing")} testID="more-pricing" />
          <MenuRow icon="settings" title="Settings" subtitle="Account, security and sign-in" tint={colors.textSecondary} onPress={() => go("/settings")} testID="more-settings" />
          <MenuRow icon="help-circle" title="Help & about" subtitle="How SparkTower works" tint={colors.textSecondary} onPress={() => go("/settings?section=help")} />
        </Group>

        <Group>
          <MenuRow icon="log-out-outline" title="Sign out" danger onPress={() => { void signOut(); }} testID="more-sign-out" />
        </Group>
      </ScrollView>
    </>
  );
}
