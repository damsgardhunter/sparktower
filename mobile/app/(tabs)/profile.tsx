import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, radius, spacing } from "../../src/theme";

export default function Profile() {
  const { user, profile, signOut } = useAuth();
  const router = useRouter();

  const { data: sub } = useQuery({
    queryKey: ["subscription"],
    queryFn: () => api<any>("/api/subscription"),
  });

  const name =
    profile?.displayName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.email ||
    "You";

  const skills: string[] = profile?.skills ?? [];
  const unlimited = sub?.unlimited;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>{name}</Text>
        {profile?.headline && <Text style={styles.headline}>{profile.headline}</Text>}
      </View>

      {profile?.novaSummary ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Nova's read</Text>
          <Text style={styles.body}>{profile.novaSummary}</Text>
          <Pressable onPress={() => router.push("/profile-builder")}>
            <Text style={styles.link}>Re-read my résumé →</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
          onPress={() => router.push("/profile-builder")}
        >
          <Text style={styles.cardLabel}>Build my profile</Text>
          <Text style={styles.body}>
            Upload your résumé and Nova fills in your experience, education, projects,
            and skills.
          </Text>
          <Text style={styles.link}>Upload a résumé →</Text>
        </Pressable>
      )}

      {sub && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Plan</Text>
          <View style={styles.planRow}>
            <Text style={styles.planName}>{sub.tier}</Text>
            <Text style={styles.meta}>
              {unlimited
                ? `${sub.creditsUsed} actions used · unlimited`
                : `${sub.creditsUsed} / ${sub.creditsLimit} credits used`}
            </Text>
          </View>
        </View>
      )}

      {skills.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Skills</Text>
          <View style={styles.chips}>
            {skills.map((s) => (
              // flexShrink + wrapping text so long résumé skills don't
              // overflow, the same bug that hit the web app.
              <View key={s} style={styles.chip}>
                <Text style={styles.chipText}>{s}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {(profile?.experience?.length ?? 0) > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Experience</Text>
          {profile.experience.map((e: any, i: number) => (
            <View key={i} style={styles.expRow}>
              <Text style={styles.expTitle}>{e.title}</Text>
              {e.company && <Text style={styles.expCompany}>{e.company}</Text>}
              <Text style={styles.meta}>
                {[e.startDate, e.current ? "Present" : e.endDate].filter(Boolean).join(" – ")}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Pressable
        onPress={signOut}
        style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  headerCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.xl, alignItems: "center", gap: spacing.sm,
  },
  avatar: {
    width: 72, height: 72, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: colors.text, fontSize: font.xxl, fontWeight: "800" },
  name: { color: colors.text, fontSize: font.xl, fontWeight: "800" },
  headline: { color: colors.textSecondary, fontSize: font.sm, textAlign: "center" },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, gap: spacing.sm,
  },
  cardLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  body: { color: colors.text, fontSize: font.sm, lineHeight: 20 },
  planRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  planName: { color: colors.text, fontSize: font.base, fontWeight: "700", textTransform: "capitalize" },
  meta: { color: colors.textTertiary, fontSize: font.xs },
  link: { color: colors.primary, fontSize: font.sm, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    backgroundColor: colors.surfaceRaised, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 4, flexShrink: 1, maxWidth: "100%",
  },
  chipText: { color: colors.text, fontSize: font.xs, flexShrink: 1 },
  expRow: { gap: 2, paddingVertical: spacing.xs },
  expTitle: { color: colors.text, fontSize: font.sm, fontWeight: "600" },
  expCompany: { color: colors.textSecondary, fontSize: font.sm },
  signOut: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm,
  },
  signOutText: { color: colors.danger, fontSize: font.base, fontWeight: "600" },
});
