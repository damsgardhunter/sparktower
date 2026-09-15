import { useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { api, API_URL, fetchMe } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { useEntitlementsQuery } from "../src/hooks/useEntitlements";
import { colors, font, fontFamily, spacing } from "../src/theme";
import { Btn, ErrorNote, Icon, errText, type IconName } from "../src/components/ui";
import { Group, MenuRow } from "../src/components/MoreKit";
import { Sheet } from "../src/components/Sheet";

/** What someone new usually asks, answered in a line each. */
const HELP = [
  { icon: "rocket" as const, q: "Projects", a: "Start one from the + button. Nova turns the idea into a brief, a roadmap and the roles you need." },
  { icon: "flash" as const, q: "Credits", a: "Nova's work — chat, roadmaps, reports — costs credits. Your plan sets how many you get each month." },
  { icon: "people" as const, q: "Sprints", a: "A 24 or 72 hour trial build with a possible co-founder, or a practice run with Nova." },
  { icon: "chatbox-ellipses" as const, q: "Check-ins and feedback", a: "Post what shipped each week. Ask for a read and it lands in Needs feedback for other builders." },
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
  const [error, setError] = useState<string | null>(null);

  const logoutAll = useMutation({
    mutationFn: () => api("/api/auth/logout-all", { method: "POST" }),
    onSuccess: async () => { setConfirmAll(false); await signOut(); },
    onError: (e) => setError(errText(e, "Couldn't sign out everywhere. Try again.")),
  });

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
              <MenuRow icon="card" title="Plan" subtitle={ent.isUnlimited ? `${ent.tier} · unlimited` : `${ent.tier} · ${ent.creditsRemaining} credits left this month`} onPress={() => go("/pricing")} />
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
              <MenuRow icon="log-out-outline" title="Sign out" tint={colors.textSecondary} onPress={() => { void signOut(); }} />
              <MenuRow icon="phone-portrait-outline" title="Sign out everywhere" danger onPress={() => { setError(null); setConfirmAll(true); }} />
            </Group>

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
    </>
  );
}

function MenuIcon({ name }: { name: IconName }) {
  return <Icon name={name} size={18} color={colors.textTertiary} />;
}
