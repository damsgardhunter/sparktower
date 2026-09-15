import { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Avatar, Empty, Loading, Screen, TabStrip, timeAgo } from "../../src/components/ui";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { InvitationRow, NetworkBlock, networkStyles } from "../../src/components/NetworkCards";
import {
  SENT_REQUESTS_KEY, personAvatar, personName, useConnectionRequests, useInvitationActions, useSentRequests, type ConnectionRow,
} from "../../src/networkData";

type Tab = "received" | "sent";

/**
 * Connection requests, LinkedIn-style: the ones waiting on you, with the note
 * that came with them, and the ones you've sent that haven't been answered.
 * Accepting opens messaging between you; ignoring is quiet — they aren't told.
 * Withdrawing a sent request removes it before they answer.
 */
export default function Invitations() {
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("received");
  const requests = useConnectionRequests();
  const sent = useSentRequests();
  const { notice, show, clear } = useNotice();
  const invites = useInvitationActions(show);
  const rows = requests.data ?? [];
  const sentRows = sent.data ?? [];

  const withdraw = useMutation({
    mutationFn: (row: { id: string; name: string }) => api(`/api/connections/${row.id}`, { method: "DELETE" }),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: SENT_REQUESTS_KEY });
      const before = qc.getQueryData<ConnectionRow[]>(SENT_REQUESTS_KEY);
      qc.setQueryData<ConnectionRow[]>(SENT_REQUESTS_KEY, (r) => r?.filter((x) => x.id !== id));
      return { before };
    },
    onSuccess: (_r, { name }) => show({ text: `Withdrew your request to ${name}.`, tone: "info" }),
    onError: (e: any, _v, ctx) => {
      qc.setQueryData(SENT_REQUESTS_KEY, ctx?.before);
      show({ text: e?.message || "Couldn't withdraw that request.", tone: "error" });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: SENT_REQUESTS_KEY });
      void qc.invalidateQueries({ queryKey: ["connection-states"] });
    },
  });

  const refetch = () => Promise.all([requests.refetch(), sent.refetch()]);

  return (
    <>
      <Stack.Screen options={{ title: "Invitations" }} />
      <View style={{ backgroundColor: colors.surface }}>
        <TabStrip<Tab>
          options={[{ value: "received", label: `Received (${rows.length})` }, { value: "sent", label: `Sent (${sentRows.length >= 200 ? "200+" : sentRows.length})` }]}
          value={tab} onChange={setTab}
        />
      </View>
      <Screen canvas onRefresh={refetch} refreshing={requests.isRefetching || sent.isRefetching} contentStyle={{ padding: 0, gap: spacing.sm }}>
        {tab === "received" ? (
          requests.isLoading ? <Loading /> : (
            <NetworkBlock title={`Received (${rows.length})`} subtitle="People who'd like to connect with you" flush>
              {!rows.length ? (
                <Empty icon="mail-open-outline" title="No pending invitations" body="When someone asks to connect, it shows up here with their note." />
              ) : rows.map((r, i) => {
                const name = personName(r.user, r.profile);
                return (
                  <View key={r.id}>
                    {i > 0 && <View style={networkStyles.divider} />}
                    <InvitationRow
                      name={name}
                      headline={r.profile?.headline}
                      avatarUrl={personAvatar(r.user, r.profile)}
                      note={r.note}
                      createdAt={r.createdAt}
                      busy={invites.busyId === r.id}
                      onOpen={() => router.push(`/user/${r.requesterId}`)}
                      onAccept={() => invites.accept({ id: r.id, name })}
                      onIgnore={() => invites.ignore({ id: r.id, name })}
                    />
                  </View>
                );
              })}
            </NetworkBlock>
          )
        ) : sent.isLoading ? <Loading /> : (
          <NetworkBlock title={`Sent (${sentRows.length})`} subtitle="Requests waiting for an answer" flush>
            {!sentRows.length ? (
              <Empty icon="paper-plane-outline" title="No sent invitations" body="Requests you send stay here until the other person answers." />
            ) : sentRows.map((r, i) => {
              const name = personName(r.user, r.profile);
              const busy = withdraw.isPending && withdraw.variables?.id === r.id;
              return (
                <View key={r.id}>
                  {i > 0 && <View style={networkStyles.divider} />}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
                    <Pressable onPress={() => router.push(`/user/${r.receiverId}`)} accessibilityLabel={`Open ${name}'s profile`}>
                      <Avatar name={name} uri={personAvatar(r.user, r.profile)} size={56} />
                    </Pressable>
                    <Pressable onPress={() => router.push(`/user/${r.receiverId}`)} style={{ flex: 1, gap: 2, minWidth: 0 }}>
                      <Text style={{ fontSize: font.base, fontFamily: fontFamily.semibold, color: colors.text }} numberOfLines={1}>{name}</Text>
                      {r.profile?.headline ? <Text style={{ fontSize: font.sm, fontFamily: fontFamily.regular, color: colors.textSecondary }} numberOfLines={2}>{r.profile.headline}</Text> : null}
                      <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.regular, color: colors.textTertiary }}>Sent {timeAgo(r.createdAt)}</Text>
                    </Pressable>
                    <Pressable onPress={() => withdraw.mutate({ id: r.id, name })} disabled={busy} accessibilityLabel={`Withdraw request to ${name}`}
                      style={({ pressed }) => ({ borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6, opacity: busy ? 0.5 : pressed ? 0.7 : 1 })}>
                      <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.textSecondary }}>Withdraw</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </NetworkBlock>
        )}
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
