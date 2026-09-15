import { ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { colors, font, fontFamily, radius, spacing } from "../src/theme";
import { Btn, Empty, Icon, Loading, NovaGradient, type IconName } from "../src/components/ui";
import { FeaturedContestCard } from "../src/components/FeaturedContest";

interface Community {
  id: string; slug: string; name: string; tagline: string; description: string;
  icon: string; color: string; members: number; joined: boolean;
}

const ICONS: Record<string, IconName> = { user: "person", sparkles: "sparkles", layers: "layers", rocket: "rocket", "hand-coins": "cash", store: "storefront" };
const KEY = ["communities"];

/**
 * Contests and Communities — the web's /contests. Contests are empty on purpose
 * for now; below them, communities to join around what you're building.
 */
export default function ContestsAndCommunities() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: communities, isLoading } = useQuery({ queryKey: KEY, queryFn: () => api<Community[]>("/api/communities") });
  const toggle = useMutation({
    mutationFn: (c: Community) => api<Community>(`/api/communities/${c.slug}/join`, { method: c.joined ? "DELETE" : "POST" }),
    onSuccess: (updated) => qc.setQueryData<Community[]>(KEY, (list) => list?.map((c) => (c.id === updated.id ? updated : c))),
  });
  const label = { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold, letterSpacing: 0.8, textTransform: "uppercase" as const };

  return (
    <>
      <Stack.Screen options={{ title: "Contests and Communities" }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ paddingBottom: spacing.xxl * 2, gap: spacing.lg }}>
        <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border }}>
          <NovaGradient style={{ height: 4 }} />
          <View style={{ padding: spacing.lg, flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Icon name="trophy" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold }}>Contests and Communities</Text>
              <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular }}>Build against a brief, and find people building what you're building.</Text>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.lg }}>
          <Text style={label}>Contests</Text>
          <View style={{ paddingTop: spacing.md, paddingBottom: spacing.md }}>
            <FeaturedContestCard />
          </View>
        </View>

        <View testID="section-communities" style={{ paddingHorizontal: spacing.lg, gap: spacing.md, borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.lg }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={label}>Communities</Text>
            {communities ? <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>{communities.filter((c) => c.joined).length} joined</Text> : null}
          </View>
          {isLoading ? <Loading /> : !communities?.length ? (
            <Empty icon="people-outline" title="No communities yet" body="Communities will show up here." />
          ) : communities.map((c) => {
            const busy = toggle.isPending && toggle.variables?.id === c.id;
            return (
              <View key={c.id} testID={`community-${c.slug}`} style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm }}>
                <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
                  <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: `${c.color}1A`, alignItems: "center", justifyContent: "center" }}>
                    <Icon name={ICONS[c.icon] ?? "people"} size={20} color={c.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{c.name}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular }}>{c.tagline}</Text>
                  </View>
                </View>
                <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>{c.description}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs }}>
                  <Text style={{ color: colors.textTertiary, fontSize: font.xs + 1, fontFamily: fontFamily.regular }}>{c.members.toLocaleString()} {c.members === 1 ? "member" : "members"}</Text>
                  {user ? <Btn small label={c.joined ? "Joined" : "Join"} icon={c.joined ? "checkmark" : undefined} variant={c.joined ? "outline" : "primary"} loading={busy} onPress={() => toggle.mutate(c)} /> : null}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </>
  );
}
