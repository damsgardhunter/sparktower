/**
 * The people side of a profile: Follow and Connect for someone else's, and
 * for your own the Connections, Following, Earnings and Behaviour tabs.
 *
 * The web keeps these in the profile's tabs (client/src/pages/profile.tsx) and
 * FollowBuilderButton (client/src/components/discover-actions.tsx); this is the
 * same copy and the same endpoints, laid out for a phone.
 */
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_URL } from "../api/client";
import { exploreContext, markSeen } from "../explore";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Avatar, Btn, Icon, Meta, Row } from "./ui";
import type { Notice } from "./Sheet";
import { ProjectCardLite } from "./ProfileSections";
import { CountBubble, EmptyCard, GUTTER, Heading, OutlineButton, PCard, Pill, StrongTitle } from "./profile/kit";

const personName = (c: any) => c?.profile?.displayName || c?.user?.firstName || "User";

/** Everything a connection change can move. */
function useRefreshNetwork() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["connections"] });
    void qc.invalidateQueries({ queryKey: ["connection-requests"] });
    void qc.invalidateQueries({ queryKey: ["connection-status"] });
    void qc.invalidateQueries({ queryKey: ["connection-states"] });
    void qc.invalidateQueries({ queryKey: ["profile-summary"] });
  };
}

export const REQUESTS_KEY = ["connections", "requests"];
export const MY_CONNECTIONS_KEY = ["connections", "mine"];

export function useMyConnections(enabled: boolean) {
  return useQuery({ queryKey: MY_CONNECTIONS_KEY, queryFn: () => api<any[]>("/api/connections"), enabled });
}
export function useConnectionRequests(enabled: boolean) {
  return useQuery({ queryKey: REQUESTS_KEY, queryFn: () => api<any[]>("/api/connections/requests"), enabled });
}
export function useFollowedProjects(enabled: boolean) {
  return useQuery({ queryKey: ["followed-projects"], queryFn: () => api<any[]>("/api/user/followed-projects"), enabled });
}

// --- Someone else's profile ------------------------------------------------------

/** Follow a builder: a heart, the follower count beside it, put back if the server refuses. */
export function FollowBuilderButton({ userId, name, notify }: { userId: string; name: string; notify: (n: Notice) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const key = ["user-follow", userId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api<{ following: boolean; followers: number }>(`/api/users/${userId}/follow-status`).catch(() => ({ following: false, followers: 0 })),
  });
  const following = !!data?.following;

  const follow = useMutation({
    mutationFn: (want: boolean) => api<{ following: boolean; followers: number }>(`/api/users/${userId}/follow`, {
      method: "POST", body: { following: want, explore: exploreContext("profile_page") },
    }),
    onMutate: async (want) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<{ following: boolean; followers: number }>(key);
      qc.setQueryData(key, { following: want, followers: Math.max(0, (before?.followers ?? 0) + (want ? 1 : -1)) });
      return { before };
    },
    onError: (e: any, _want, ctx) => {
      qc.setQueryData(key, ctx?.before);
      notify({ text: e?.message || "Couldn't update. Try again.", tone: "error" });
    },
    onSuccess: (_r, want) => {
      if (!want) { notify({ text: `Unfollowed ${name}`, tone: "info" }); return; }
      markSeen("builder", userId);
      notify({
        text: `Following ${name}. Their updates now show in your Following feed.`, tone: "success",
        action: { label: "Open Following", onPress: () => router.push("/(tabs)/feed") },
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  return (
    <OutlineButton
      icon={following ? "heart" : "heart-outline"}
      label={`${following ? "Following" : "Follow"}${data?.followers ? ` (${data.followers})` : ""}`}
      active={following}
      onPress={() => follow.mutate(!following)}
    />
  );
}

/** Connect, Request Sent, Accept / Decline, or Connected + Message — the web profile's connection button. */
export function ConnectionButton({ userId, name, notify }: { userId: string; name: string; notify: (n: Notice) => void }) {
  const router = useRouter();
  const refresh = useRefreshNetwork();
  const { data: status, refetch } = useQuery({
    queryKey: ["connection-status", userId],
    queryFn: () => api<any>(`/api/connections/status/${userId}`).catch(() => ({ status: "none" })),
  });
  const done = () => { void refetch(); refresh(); };

  const connect = useMutation({
    mutationFn: () => api("/api/connections/request", { method: "POST", body: { userId, explore: exploreContext("profile_page") } }),
    onSuccess: () => { notify({ text: "Connection request sent", tone: "success" }); done(); },
    onError: (e: any) => notify({ text: e?.message || "Couldn't send the request.", tone: "error" }),
  });
  const accept = useMutation({
    mutationFn: (id: string) => api(`/api/connections/${id}/accept`, { method: "POST" }),
    onSuccess: () => { notify({ text: `Connection accepted. You can message ${name} now.`, tone: "success" }); done(); },
    onError: (e: any) => notify({ text: e?.message || "Couldn't accept.", tone: "error" }),
  });
  const reject = useMutation({
    mutationFn: (id: string) => api(`/api/connections/${id}/reject`, { method: "POST" }),
    onSuccess: () => { notify({ text: "Connection rejected", tone: "info" }); done(); },
    onError: (e: any) => notify({ text: e?.message || "Couldn't decline.", tone: "error" }),
  });

  const s = status?.status;
  if (s === "accepted") {
    return (
      <Row center gap={spacing.sm}>
        <Pill label="Connected" icon="checkmark-circle-outline" style={{ paddingVertical: 4 }} />
        <Btn label="Message" icon="chatbubble-outline" small onPress={() => router.push(`/chat/${userId}`)} />
      </Row>
    );
  }
  if (s === "pending") {
    // The request is theirs to answer when it came from you.
    if (status.requesterId !== userId) {
      return <Pill label="Request Sent" icon="time-outline" variant="secondary" style={{ paddingVertical: 4, alignSelf: "center" }} />;
    }
    return (
      <Row center gap={spacing.sm}>
        <Btn label="Accept" small loading={accept.isPending} onPress={() => accept.mutate(status.id)} />
        <OutlineButton label="Decline" disabled={reject.isPending} onPress={() => reject.mutate(status.id)} />
      </Row>
    );
  }
  return <OutlineButton label="Connect" icon="person-add-outline" disabled={connect.isPending} onPress={() => connect.mutate()} />;
}

// --- Your Connections tab ------------------------------------------------------------

export function ConnectionsTab({ notify }: { notify: (n: Notice) => void }) {
  const router = useRouter();
  const refresh = useRefreshNetwork();
  const [search, setSearch] = useState("");
  const { data: requests } = useConnectionRequests(true);
  const { data: connections, isLoading } = useMyConnections(true);

  const accept = useMutation({
    mutationFn: (id: string) => api(`/api/connections/${id}/accept`, { method: "POST" }),
    onSuccess: () => { notify({ text: "Connection accepted", tone: "success" }); refresh(); },
    onError: (e: any) => notify({ text: e?.message || "Couldn't accept.", tone: "error" }),
  });
  const reject = useMutation({
    mutationFn: (id: string) => api(`/api/connections/${id}/reject`, { method: "POST" }),
    onSuccess: () => { notify({ text: "Connection rejected", tone: "info" }); refresh(); },
    onError: (e: any) => notify({ text: e?.message || "Couldn't decline.", tone: "error" }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/connections/${id}`, { method: "DELETE" }),
    onSuccess: () => { notify({ text: "Connection removed", tone: "info" }); refresh(); },
    onError: (e: any) => notify({ text: e?.message || "Couldn't remove.", tone: "error" }),
  });

  const filtered = (connections ?? []).filter((c) => !search || personName(c).toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      {(requests?.length ?? 0) > 0 && (
        <PCard>
          <Row center gap={spacing.sm}>
            <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>Pending Requests</Text>
            <CountBubble n={requests!.length} />
          </Row>
          {requests!.map((r) => (
            <View key={r.id} style={{ backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.md, gap: spacing.sm }}>
              <Pressable onPress={() => router.push(`/user/${r.user.id}`)} style={{ flexDirection: "row", gap: spacing.md, alignItems: "flex-start" }}>
                <Avatar name={personName(r)} uri={r.profile?.avatarUrl} size={40} />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{personName(r)}</Text>
                  {r.profile?.headline ? <Meta numberOfLines={2}>{r.profile.headline}</Meta> : null}
                  {/* The note they sent with it — the only thing they could say before you accept. */}
                  {r.note ? <Text style={{ fontSize: font.sm, fontFamily: fontFamily.regular, fontStyle: "italic", color: colors.text, marginTop: 4 }}>“{r.note}”</Text> : null}
                </View>
              </Pressable>
              <Row gap={spacing.sm} style={{ justifyContent: "flex-end" }}>
                <Btn label="Accept" small disabled={accept.isPending} onPress={() => accept.mutate(r.id)} />
                <OutlineButton label="Decline" disabled={reject.isPending} onPress={() => reject.mutate(r.id)} />
              </Row>
            </View>
          ))}
        </PCard>
      )}

      <Heading>My Connections</Heading>
      <View style={{ marginHorizontal: GUTTER, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 40 }}>
        <Icon name="search" size={16} color={colors.textTertiary} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search connections..." placeholderTextColor={colors.textTertiary}
          style={{ flex: 1, fontFamily: fontFamily.regular, fontSize: font.sm, color: colors.text }} />
      </View>

      {isLoading ? (
        <PCard><Meta>Loading connections…</Meta></PCard>
      ) : filtered.length > 0 ? (
        filtered.map((c) => (
          <PCard key={c.id} style={{ padding: spacing.md }}>
            <Pressable onPress={() => router.push(`/user/${c.user.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Avatar name={personName(c)} uri={c.profile?.avatarUrl} size={48} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }} numberOfLines={1}>{personName(c)}</Text>
                {c.profile?.headline ? <Meta numberOfLines={1}>{c.profile.headline}</Meta> : null}
              </View>
            </Pressable>
            <Row gap={spacing.sm}>
              <OutlineButton label="Message" icon="chatbubble-outline" style={{ flex: 1 }} onPress={() => router.push(`/chat/${c.user.id}`)} />
              <Pressable onPress={() => remove.mutate(c.id)} disabled={remove.isPending} accessibilityLabel={`Remove ${personName(c)}`}
                style={({ pressed }) => [{ width: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill }, pressed && { backgroundColor: colors.surfaceRaised }]}>
                <Icon name="person-remove-outline" size={16} color={colors.danger} />
              </Pressable>
            </Row>
          </PCard>
        ))
      ) : (
        <EmptyCard icon="people-outline" text={search ? "No connections match your search." : "No connections yet."}
          action={search ? undefined : "Discover People"} onAction={() => router.push("/(tabs)/discover")} />
      )}
    </>
  );
}

// --- Following tab -----------------------------------------------------------------------

export function FollowingTab() {
  const router = useRouter();
  const { data: followed, isLoading } = useFollowedProjects(true);
  return (
    <>
      <Heading icon="heart-outline">Projects You Follow</Heading>
      {isLoading ? (
        <PCard><Meta>Loading…</Meta></PCard>
      ) : (followed ?? []).length > 0 ? (
        followed!.map((f) => {
          const p = f.project || f;
          const owner = p.profile?.displayName || [p.owner?.firstName, p.owner?.lastName].filter(Boolean).join(" ") || "A builder";
          return <ProjectCardLite key={p.id || f.id} project={p} ownerName={owner} ownerAvatar={p.profile?.avatarUrl} />;
        })
      ) : (
        <EmptyCard icon="heart-outline" text="You haven't followed any projects yet." action="Discover Projects" onAction={() => router.push("/(tabs)/discover")} />
      )}
    </>
  );
}

// --- Earnings tab ---------------------------------------------------------------------------

export function EarningsTab({ notify }: { notify: (n: Notice) => void }) {
  const { data: payouts, isLoading } = useQuery({ queryKey: ["payouts"], queryFn: () => api<any>("/api/payouts") });
  const openStripe = useMutation({
    mutationFn: async (hasAccount: boolean) => {
      if (!hasAccount) await api("/api/stripe/connect-account", { method: "POST" });
      const { url } = await api<{ url?: string }>(hasAccount ? "/api/stripe/connect-dashboard" : "/api/stripe/connect-onboarding");
      if (!url) throw new Error("Stripe didn't return a link.");
      await WebBrowser.openBrowserAsync(url);
    },
    onError: (e: any) => notify({ text: e?.message || "Couldn't open Stripe.", tone: "error" }),
  });
  const donations: any[] = payouts?.donations ?? [];

  return (
    <>
      <PCard style={{ gap: spacing.lg }}>
        <StrongTitle icon="cash-outline">Donation Earnings</StrongTitle>
        <Row gap={spacing.xl} style={{ alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 30, fontFamily: fontFamily.bold, color: colors.text }}>${((payouts?.totalEarnings || 0) / 100).toFixed(2)}</Text>
            <Meta style={{ fontSize: font.sm }}>Total earned from donations</Meta>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: font.lg, fontFamily: fontFamily.semibold, color: colors.text }}>{donations.length}</Text>
            <Meta style={{ fontSize: font.sm }}>Donations received</Meta>
          </View>
        </Row>
        {isLoading ? null : !payouts?.connectAccountId ? (
          <View style={{ gap: spacing.sm, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.sm, padding: spacing.lg }}>
            <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>Connect your bank account to receive payouts</Text>
            <Meta style={{ fontSize: font.xs + 1, lineHeight: 17 }}>Set up a Stripe Connect account to securely receive donation payouts directly to your bank account or card.</Meta>
            <Btn label="Connect Bank Account" small loading={openStripe.isPending} onPress={() => openStripe.mutate(false)} style={{ alignSelf: "flex-start" }} />
          </View>
        ) : (
          <OutlineButton label="Stripe Dashboard" icon="open-outline" disabled={openStripe.isPending} onPress={() => openStripe.mutate(true)} style={{ alignSelf: "flex-start" }} />
        )}
      </PCard>

      {donations.length > 0 && (
        <PCard>
          <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.4 }}>Recent Donations</Text>
          {donations.slice(0, 10).map((d, i) => (
            <Row key={d.id} between style={[{ paddingVertical: spacing.sm }, i < Math.min(donations.length, 10) - 1 && { borderBottomWidth: 1, borderColor: colors.borderSubtle }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>${(d.amount / 100).toFixed(2)}</Text>
                {d.message ? <Meta numberOfLines={2}>{d.message}</Meta> : null}
              </View>
              <Meta>{new Date(d.createdAt).toLocaleDateString()}</Meta>
            </Row>
          ))}
        </PCard>
      )}
    </>
  );
}

// --- Behaviour tab (site owner only) ---------------------------------------------------------

export function BehaviourTab() {
  const { data } = useQuery({
    queryKey: ["analytics-peek", 7],
    queryFn: () => api<any>("/api/admin/analytics/summary?days=7"),
    refetchInterval: 30_000,
  });
  const stat = (value: any, label: string, big?: boolean) => (
    <View style={{ minWidth: "28%" }}>
      <Text style={{ fontSize: big ? 30 : font.lg, fontFamily: fontFamily.bold, color: colors.text }}>{value ?? "—"}</Text>
      <Meta style={{ fontSize: font.sm }}>{label}</Meta>
    </View>
  );
  return (
    <PCard style={{ gap: spacing.lg }}>
      <StrongTitle icon="pulse-outline">Behaviour</StrongTitle>
      <Row wrap gap={spacing.xl} style={{ alignItems: "flex-end" }}>
        {stat(data?.onlineNow, "On the site right now", true)}
        {stat(data?.totals?.visitors, "People this week")}
        {stat(data?.totals?.actions, "Actions taken")}
      </Row>
      <Btn label="Open the live console" icon="open-outline" small style={{ alignSelf: "flex-start" }}
        onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/admin/analytics`)} />
      <Meta style={{ lineHeight: 16 }}>
        Only this account can see any of this. Page views and actions are recorded — never the contents of what anyone writes.
      </Meta>
    </PCard>
  );
}
