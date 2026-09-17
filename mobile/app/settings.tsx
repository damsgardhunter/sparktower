import { useState } from "react";
import { Linking, Pressable, ScrollView, Share, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { api, API_URL, fetchMe } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { useEntitlementsQuery } from "../src/hooks/useEntitlements";
import { colors, font, fontFamily, spacing } from "../src/theme";
import { Btn, Chip, ErrorNote, Field, Icon, errText, type IconName } from "../src/components/ui";
import { Group, MenuRow } from "../src/components/MoreKit";
import { NoticeBanner, Sheet, useNotice, type Notice } from "../src/components/Sheet";

/** What someone new usually asks, answered in a line each. */
const HELP = [
  { icon: "rocket" as const, q: "Projects", a: "Start one from the + button. Nova turns the idea into a brief, a roadmap and the roles you need." },
  { icon: "flash" as const, q: "Credits", a: "Nova's work — chat, roadmaps, reports — costs credits. Your plan sets how many you get each month." },
  { icon: "people" as const, q: "Sprints", a: "A 24 or 72 hour trial build with a possible co-founder, or a practice run with Nova." },
  { icon: "chatbox-ellipses" as const, q: "Updates and feedback", a: "Post what shipped as an update and add the questions you want answered. Replies land in your project's Feedback inbox." },
  { icon: "flag" as const, q: "Reporting", a: "Every post, comment and profile has a report option. A person reads every report." },
];

/**
 * Settings and help. The web app has no settings page — account actions live
 * in the sidebar and the profile — so this gathers the ones a phone needs:
 * who you're signed in as, your plan, and signing out here or everywhere.
 */
export default function Settings() {
  const router = useRouter();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const helpOnly = section === "help";
  const { signOut } = useAuth();
  const ent = useEntitlementsQuery();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const [confirmAll, setConfirmAll] = useState(false);
  const [closing, setClosing] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [keepPosts, setKeepPosts] = useState(true);
  const { notice, show, clear } = useNotice();
  const [error, setError] = useState<string | null>(null);

  const logoutAll = useMutation({
    mutationFn: () => api("/api/auth/logout-all", { method: "POST" }),
    onSuccess: async () => { setConfirmAll(false); await signOut(); },
    onError: (e) => setError(errText(e, "Couldn't sign out everywhere. Try again.")),
  });

  /** Everything on the account, handed to the phone's share sheet — mail it to yourself, or save it to Files. */
  const exportData = useMutation({
    mutationFn: () => api<Record<string, unknown>>("/api/account/export"),
    onSuccess: async (data) => {
      await Share.share({ title: "My SparkTower data", message: JSON.stringify(data, null, 2) });
    },
    onError: (e) => setError(errText(e, "Couldn't build your export. Try again in a minute.")),
  });

  const closeAccount = useMutation({
    mutationFn: () => api("/api/account/delete", { method: "POST", body: { password, code: code.trim(), keepPosts } }),
    onSuccess: async () => { setClosing(false); await signOut(); },
    onError: (e) => setError(errText(e, "Couldn't close the account. Nothing was changed.")),
  });

  const { data: plans } = useQuery({ queryKey: ["plans"], queryFn: () => api<any>("/api/plans") });
  const planName = (plans?.plans ?? []).find((p: any) => p.tier === ent.tier)?.name
    ?? ent.tier.charAt(0).toUpperCase() + ent.tier.slice(1);

  const user = me?.user;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || me?.profile?.displayName || "—";
  const version = Constants.expoConfig?.version ?? "dev";
  const go = (href: string) => router.push(href as any);

  const help = (
    <>
      <Group title="How SparkTower works">
        {HELP.map((h) => (
          <View key={h.q} style={{ flexDirection: "row", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg }}>
            <View style={{ width: 32, alignItems: "center", paddingTop: 2 }}>
              <MenuIcon name={h.icon} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{h.q}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>{h.a}</Text>
            </View>
          </View>
        ))}
      </Group>
      <Group footer={`SparkTower for ${Constants.platform?.ios ? "iOS" : Constants.platform?.android ? "Android" : "mobile"} · version ${version}`}>
        <MenuRow icon="globe-outline" title="Open SparkTower on the web" subtitle="Everything here, on a bigger screen" tint={colors.textSecondary} onPress={() => Linking.openURL(API_URL)} right={<MenuIcon name="open-outline" />} />
        <MenuRow icon="sparkles" title="Tell Nova where you want to go" subtitle="Start a project" onPress={() => go("/project/new")} />
      </Group>
    </>
  );

  return (
    <>
      <Stack.Screen options={{ title: helpOnly ? "Help & about" : "Settings" }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ paddingVertical: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.lg }}>
        {helpOnly ? help : (
          <>
            <Group title="Account">
              <MenuRow icon="person" title="Name" subtitle={name} right={<View />} />
              <MenuRow icon="mail" title="Email" subtitle={user?.email ?? "—"} right={<View />} />
              <MenuRow icon="card" title="Plan" subtitle={ent.isUnlimited ? `${planName} · unlimited` : `${planName} · ${ent.creditsRemaining} credits left this month`} onPress={() => go("/pricing")} />
              {["reviewer", "admin"].includes(user?.platformRole) && (
                <MenuRow icon="shield-checkmark" title="Platform role" subtitle={user.platformRole} tint={colors.success} right={<View />} />
              )}
            </Group>

            <Group title="Profile">
              <MenuRow icon="person-circle" title="Your profile" subtitle="How other builders see you" onPress={() => go("/(tabs)/profile")} />
              <MenuRow icon="options" title="Profile details" subtitle="Skills, interests, links and co-founder preferences" tint={colors.info} onPress={() => go("/welcome")} />
              <MenuRow icon="document-text" title="Build my profile from a résumé" tint={colors.info} onPress={() => go("/profile-builder")} />
            </Group>

            <Group title="Security" footer="Signing out everywhere ends every web session and every signed-in phone, including this one. Use it for a lost phone or a shared computer.">
              <MenuRow icon="shield-checkmark" title="Two-factor authentication" subtitle={user?.mfaEnabledAt ? "On" : "Off — an extra code at sign-in"} tint={user?.mfaEnabledAt ? colors.success : colors.textSecondary} onPress={() => go("/security")} testID="settings-security" />
              <MenuRow icon="log-out-outline" title="Sign out" tint={colors.textSecondary} onPress={() => { void signOut(); }} />
              <MenuRow icon="phone-portrait-outline" title="Sign out everywhere" danger onPress={() => { setError(null); setConfirmAll(true); }} />
            </Group>

            <Group title="Your data" footer="Closing an account can't be undone. A project with other members is handed to another member; a project nobody else is on is deleted with everything in it.">
              <MenuRow icon="download-outline" title="Download my data" subtitle="Your account, profile, projects and posts, as a file" tint={colors.info} onPress={() => { setError(null); exportData.mutate(); }} testID="settings-export-data" />
              <MenuRow icon="trash-outline" title="Delete my account" danger onPress={() => { setError(null); setPassword(""); setCode(""); setClosing(true); }} testID="settings-delete-account" />
            </Group>

            {/*
              * Apple requires the privacy policy to be reachable from inside
              * the app, not only from the App Store listing (guideline
              * 5.1.1(i)); Google asks for the same link in the Data safety
              * form. Both open on the web, where the policy lives — the same
              * URL the store listings point at, so there is one document
              * rather than a copy that drifts.
              */}
            <Group title="Legal">
              <MenuRow icon="lock-closed-outline" title="Privacy policy" subtitle="What's collected, who sees it, how to delete it" tint={colors.textSecondary} onPress={() => Linking.openURL(`${API_URL}/privacy`)} right={<MenuIcon name="open-outline" />} testID="settings-privacy" />
              <MenuRow icon="document-text-outline" title="Terms of service" tint={colors.textSecondary} onPress={() => Linking.openURL(`${API_URL}/terms`)} right={<MenuIcon name="open-outline" />} testID="settings-terms" />
            </Group>

            {__DEV__ && <DevTiers plans={plans?.plans ?? []} tier={ent.tier} used={ent.creditsUsed} limit={ent.isUnlimited ? "∞" : ent.creditsLimit} show={show} />}

            {help}
          </>
        )}
      </ScrollView>

      <Sheet visible={confirmAll} onClose={() => setConfirmAll(false)} title="Sign out everywhere?"
        subtitle="Every browser and phone signed in to your account is signed out, this one included.">
        {error && <ErrorNote message={error} />}
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Btn label="Cancel" variant="outline" style={{ flex: 1 }} onPress={() => setConfirmAll(false)} />
          <Btn label="Sign out all" variant="danger" style={{ flex: 1 }} loading={logoutAll.isPending} onPress={() => logoutAll.mutate()} />
        </View>
      </Sheet>
      <Sheet visible={closing} onClose={() => setClosing(false)} title="Delete your account?"
        subtitle="This can't be undone. Every device is signed out, and your profile and personal data are removed.">
        {error && <ErrorNote message={error} />}
        <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Your password" autoCapitalize="none" />
        {!!user?.mfaEnabledAt && (
          <Field label="Authenticator code" value={code} onChangeText={setCode} numeric placeholder="123456" />
        )}
        <Pressable onPress={() => setKeepPosts((v) => !v)} style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", paddingVertical: spacing.sm }} testID="settings-keep-posts">
          <Icon name={keepPosts ? "checkbox" : "square-outline"} size={20} color={keepPosts ? colors.primary : colors.textTertiary} />
          <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular, lineHeight: 19 }}>
            Leave my posts and comments up, shown as "Deleted account". Untick to delete them too.
          </Text>
        </Pressable>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Btn label="Cancel" variant="outline" style={{ flex: 1 }} onPress={() => setClosing(false)} />
          <Btn label="Delete account" variant="danger" style={{ flex: 1 }} loading={closeAccount.isPending} onPress={() => closeAccount.mutate()} />
        </View>
      </Sheet>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}

function MenuIcon({ name }: { name: IconName }) {
  return <Icon name={name} size={18} color={colors.textTertiary} />;
}

const TIER_IDS = ["free", "starter", "builder", "pro"] as const;

/**
 * The web sidebar's development-only tier override (client/src/components/
 * tier-switcher.tsx), so plan gating can be tried on the phone without a
 * Stripe subscription. Only in development builds; the /api/dev routes 404 in
 * production and refuse while a real subscription exists.
 */
function DevTiers({ plans, tier, used, limit, show }: { plans: any[]; tier: string; used: number; limit: number | string; show: (n: Notice) => void }) {
  const qc = useQueryClient();
  const nameOf = (t: string) => plans.find((p) => p.tier === t)?.name ?? t;
  const setTier = useMutation({
    mutationFn: (next: string) => api<{ tier: string }>("/api/dev/set-tier", { method: "POST", body: { tier: next } }),
    // Entitlements affect nearly every query, so clear the whole cache.
    onSuccess: (r) => { show({ tone: "success", text: `Now on ${nameOf(r.tier)}. Dev override, not a real subscription.` }); void qc.invalidateQueries(); },
    onError: (e) => show({ tone: "error", text: errText(e, "Couldn't switch tier.") }),
  });
  const reset = useMutation({
    mutationFn: () => api("/api/dev/reset-credits", { method: "POST" }),
    onSuccess: () => { show({ tone: "success", text: "Credits reset to 0 used" }); void qc.invalidateQueries(); },
    onError: () => show({ tone: "error", text: "Couldn't reset credits" }),
  });
  return (
    <Group title="Dev: test tiers" footer="Development builds only. Locked while you have a real Stripe subscription.">
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
          {TIER_IDS.map((t) => (
            <Chip key={t} label={nameOf(t)} active={tier === t} onPress={setTier.isPending || tier === t ? undefined : () => setTier.mutate(t)} />
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>{used} / {limit} used</Text>
          <Btn label="Reset credits" icon="refresh" small variant="ghost" loading={reset.isPending} onPress={() => reset.mutate()} />
        </View>
      </View>
    </Group>
  );
}
