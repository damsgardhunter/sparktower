/**
 * The parts of your own profile only you see: analytics, connection requests,
 * your connections, the projects you follow, and donation earnings.
 *
 * The web keeps these in the profile's Connections, Following and Earnings
 * tabs (client/src/pages/profile.tsx); on the phone they're rows that open a
 * sheet, so the profile itself stays the thing other people see.
 */
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Avatar, Body, Btn, Divider, Icon, IconButton, ListItem, Meta, Row, Section, type IconName } from "./ui";
import { Sheet, type Notice } from "./Sheet";

const personName = (c: any) => c?.profile?.displayName || [c?.user?.firstName, c?.user?.lastName].filter(Boolean).join(" ") || "Builder";

/** LinkedIn's "Analytics · Private to you", from /api/profile/summary. */
export function ProfileAnalytics({ stats }: { stats?: any }) {
  if (!stats) return null;
  const tiles: { icon: IconName; value: string | number; label: string }[] = [
    { icon: "eye-outline", value: stats.projectViews ?? 0, label: "project views" },
    { icon: "rocket-outline", value: stats.projects ?? 0, label: stats.projects === 1 ? "project" : "projects" },
    { icon: "checkmark-done-outline", value: stats.tasksCompleted ?? 0, label: "tasks done" },
  ];
  return (
    <Section title="Analytics">
      <Row center gap={4} style={{ marginTop: -spacing.sm }}>
        <Icon name="eye-off-outline" size={13} color={colors.textTertiary} />
        <Meta style={{ fontSize: font.sm }}>Private to you</Meta>
      </Row>
      <Row gap={spacing.sm}>
        {tiles.map((t) => (
          <View key={t.label} style={{ flex: 1, gap: 2 }}>
            <Row center gap={6}>
              <Icon name={t.icon} size={16} color={colors.textSecondary} />
              <Text style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color: colors.text }}>{t.value}</Text>
            </Row>
            <Meta style={{ fontSize: font.sm }}>{t.label}</Meta>
          </View>
        ))}
      </Row>
    </Section>
  );
}

export function YourNetwork({ notify, connectionCount, followingCount }: { notify: (n: Notice) => void; connectionCount?: number; followingCount?: number }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<null | "connections" | "following" | "earnings">(null);
  const [search, setSearch] = useState("");

  const { data: requests } = useQuery({ queryKey: ["connections", "requests"], queryFn: () => api<any[]>("/api/connections/requests") });
  const { data: connections } = useQuery({ queryKey: ["connections", "list"], queryFn: () => api<any[]>("/api/connections"), enabled: sheet === "connections" });
  const { data: followed } = useQuery({ queryKey: ["followed-projects"], queryFn: () => api<any[]>("/api/user/followed-projects"), enabled: sheet === "following" });
  const { data: payouts } = useQuery({ queryKey: ["payouts"], queryFn: () => api<any>("/api/payouts"), enabled: sheet === "earnings" });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["connections"] });
    void qc.invalidateQueries({ queryKey: ["connection-states"] });
    void qc.invalidateQueries({ queryKey: ["profile-summary"] });
  };
  const accept = useMutation({
    mutationFn: (id: string) => api(`/api/connections/${id}/accept`, { method: "POST" }),
    onSuccess: () => { notify({ text: "Connection accepted.", tone: "success" }); refresh(); },
    onError: (e: any) => notify({ text: e?.message || "Couldn't accept.", tone: "error" }),
  });
  const reject = useMutation({
    mutationFn: (id: string) => api(`/api/connections/${id}/reject`, { method: "POST" }),
    onSuccess: () => { notify({ text: "Request declined.", tone: "info" }); refresh(); },
    onError: (e: any) => notify({ text: e?.message || "Couldn't decline.", tone: "error" }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/connections/${id}`, { method: "DELETE" }),
    onSuccess: () => { notify({ text: "Connection removed.", tone: "info" }); refresh(); },
    onError: (e: any) => notify({ text: e?.message || "Couldn't remove.", tone: "error" }),
  });

  const openStripe = useMutation({
    mutationFn: async (hasAccount: boolean) => {
      if (!hasAccount) await api("/api/stripe/connect-account", { method: "POST" });
      const { url } = await api<{ url?: string }>(hasAccount ? "/api/stripe/connect-dashboard" : "/api/stripe/connect-onboarding");
      if (!url) throw new Error("Stripe didn't return a link.");
      await WebBrowser.openBrowserAsync(url);
    },
    onError: (e: any) => notify({ text: e?.message || "Couldn't open Stripe.", tone: "error" }),
  });

  const go = (path: string) => { setSheet(null); router.push(path as any); };
  const filtered = (connections ?? []).filter((c) => !search || personName(c).toLowerCase().includes(search.toLowerCase()));

  return (
    <Section title="Your network">
      {(requests?.length ?? 0) > 0 && (
        <View style={{ gap: spacing.md }}>
          <Row center gap={6}>
            <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>Invitations</Text>
            <View style={{ backgroundColor: colors.danger, borderRadius: radius.pill, paddingHorizontal: 6 }}>
              <Text style={{ color: "#FFFFFF", fontSize: font.xs, fontFamily: fontFamily.bold }}>{requests!.length}</Text>
            </View>
          </Row>
          {requests!.map((r) => (
            <View key={r.id} style={{ flexDirection: "row", gap: spacing.md, alignItems: "flex-start" }}>
              <Pressable onPress={() => router.push(`/user/${r.user.id}`)}>
                <Avatar name={personName(r)} uri={r.profile?.avatarUrl} size={48} />
              </Pressable>
              <View style={{ flex: 1, gap: 2 }}>
                <Body style={{ fontFamily: fontFamily.semibold }}>{personName(r)}</Body>
                {r.profile?.headline ? <Meta style={{ fontSize: font.sm }} numberOfLines={2}>{r.profile.headline}</Meta> : null}
                {r.note ? <Body muted style={{ fontStyle: "italic" }}>"{r.note}"</Body> : null}
              </View>
              <Row gap={spacing.sm} center>
                <Pressable onPress={() => reject.mutate(r.id)} accessibilityLabel="Decline" style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: colors.textTertiary, alignItems: "center", justifyContent: "center" }}>
                  <Icon name="close" size={18} color={colors.textSecondary} />
                </Pressable>
                <Pressable onPress={() => accept.mutate(r.id)} accessibilityLabel="Accept" style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
                  <Icon name="checkmark" size={18} color={colors.primary} />
                </Pressable>
              </Row>
            </View>
          ))}
          <Divider style={{ marginHorizontal: -spacing.lg }} />
        </View>
      )}

      <View style={{ marginHorizontal: -spacing.lg, marginVertical: -spacing.sm }}>
        <ListItem icon="people-outline" title="Connections" subtitle={connectionCount != null ? `${connectionCount} connection${connectionCount === 1 ? "" : "s"}` : undefined} onPress={() => setSheet("connections")} />
        <ListItem icon="heart-outline" title="Projects you follow" subtitle={followingCount != null ? `${followingCount} project${followingCount === 1 ? "" : "s"}` : undefined} onPress={() => setSheet("following")} />
        <ListItem icon="cash-outline" title="Earnings" subtitle="Donations and payouts" onPress={() => setSheet("earnings")} />
      </View>

      <Sheet visible={sheet === "connections"} onClose={() => setSheet(null)} title="Connections">
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 38 }}>
          <Icon name="search" size={16} color={colors.textTertiary} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search connections" placeholderTextColor={colors.textTertiary}
            style={{ flex: 1, fontFamily: fontFamily.regular, fontSize: font.sm, color: colors.text }} />
        </View>
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.md }}>
          {filtered.length === 0 ? (
            <View style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg }}>
              <Icon name="people-outline" size={32} color={colors.textTertiary} />
              <Body muted>{search ? "No connections match your search." : "No connections yet."}</Body>
              {!search && <Btn label="Discover people" small variant="outline" onPress={() => go("/(tabs)/discover")} />}
            </View>
          ) : filtered.map((c) => (
            <Row key={c.id} center gap={spacing.md}>
              <Pressable onPress={() => go(`/user/${c.user.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 }}>
                <Avatar name={personName(c)} uri={c.profile?.avatarUrl} size={44} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontFamily: fontFamily.semibold }} numberOfLines={1}>{personName(c)}</Body>
                  {c.profile?.headline ? <Meta numberOfLines={1}>{c.profile.headline}</Meta> : null}
                </View>
              </Pressable>
              <IconButton name="chatbubble-outline" label="Message" color={colors.primary} onPress={() => go(`/chat/${c.user.id}`)} />
              <IconButton name="person-remove-outline" label="Remove connection" color={colors.danger} onPress={() => remove.mutate(c.id)} />
            </Row>
          ))}
        </ScrollView>
      </Sheet>

      <Sheet visible={sheet === "following"} onClose={() => setSheet(null)} title="Projects you follow">
        <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: spacing.md }}>
          {(followed ?? []).length === 0 ? (
            <View style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg }}>
              <Icon name="heart-outline" size={32} color={colors.textTertiary} />
              <Body muted>You haven't followed any projects yet.</Body>
              <Btn label="Discover projects" small variant="outline" onPress={() => go("/(tabs)/discover")} />
            </View>
          ) : followed!.map((f) => {
            const p = f.project || f;
            return (
              <Pressable key={p.id} onPress={() => go(`/project/${p.id}`)} style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
                <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                  <Icon name="rocket" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontFamily: fontFamily.semibold }} numberOfLines={1}>{p.title}</Body>
                  {(p.oneLiner || p.description) ? <Meta numberOfLines={1}>{p.oneLiner || p.description}</Meta> : null}
                </View>
                <Icon name="chevron-forward" size={16} color={colors.textTertiary} />
              </Pressable>
            );
          })}
        </ScrollView>
      </Sheet>

      <Sheet visible={sheet === "earnings"} onClose={() => setSheet(null)} title="Donation earnings">
        <Row gap={spacing.xl}>
          <View>
            <Text style={{ fontSize: 28, fontFamily: fontFamily.bold, color: colors.text }}>${((payouts?.totalEarnings || 0) / 100).toFixed(2)}</Text>
            <Meta style={{ fontSize: font.sm }}>Total earned</Meta>
          </View>
          <View>
            <Text style={{ fontSize: 28, fontFamily: fontFamily.bold, color: colors.text }}>{payouts?.donations?.length || 0}</Text>
            <Meta style={{ fontSize: font.sm }}>Donations</Meta>
          </View>
        </Row>
        {payouts && !payouts.connectAccountId ? (
          <View style={{ gap: spacing.sm, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }}>
            <Body style={{ fontFamily: fontFamily.semibold }}>Connect your bank account to receive payouts</Body>
            <Meta style={{ fontSize: font.sm }}>Set up a Stripe Connect account to receive donation payouts to your bank account or card.</Meta>
            <Btn label="Connect bank account" small loading={openStripe.isPending} onPress={() => openStripe.mutate(false)} style={{ alignSelf: "flex-start" }} />
          </View>
        ) : payouts ? (
          <Btn label="Stripe dashboard" icon="open-outline" variant="outline" small loading={openStripe.isPending} onPress={() => openStripe.mutate(true)} style={{ alignSelf: "flex-start" }} />
        ) : null}
        {(payouts?.donations?.length ?? 0) > 0 && (
          <ScrollView style={{ maxHeight: 220 }}>
            {payouts.donations.slice(0, 10).map((d: any) => (
              <Row key={d.id} between style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colors.borderSubtle }}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontFamily: fontFamily.semibold }}>${(d.amount / 100).toFixed(2)}</Body>
                  {d.message ? <Meta numberOfLines={2}>{d.message}</Meta> : null}
                </View>
                <Meta>{new Date(d.createdAt).toLocaleDateString()}</Meta>
              </Row>
            ))}
          </ScrollView>
        )}
      </Sheet>
    </Section>
  );
}
