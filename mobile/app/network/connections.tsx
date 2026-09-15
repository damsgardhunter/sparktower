import { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { Pressable, Text, TextInput, View, Platform } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Empty, Icon, IconButton, Loading, Row, Screen, Segments, timeAgo } from "../../src/components/ui";
import { NoticeBanner, Sheet, useNotice } from "../../src/components/Sheet";
import { NetworkBlock, PersonRowItem, networkStyles } from "../../src/components/NetworkCards";
import {
  CONNECTIONS_KEY, personAvatar, personName, useConnectionRequests, useConnections, type ConnectionRow,
} from "../../src/networkData";

/**
 * Manage my network: everyone you're connected with — message them, or
 * remove the connection — and the way to invitations waiting on you.
 */
export default function Connections() {
  const router = useRouter();
  const qc = useQueryClient();
  const connections = useConnections();
  const requests = useConnectionRequests();
  const { notice, show, clear } = useNotice();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [removing, setRemoving] = useState<{ row: ConnectionRow; name: string } | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/connections/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      show({ text: `Removed ${removing?.name ?? "the connection"}.`, tone: "info" });
      setRemoving(null);
    },
    onError: (error: any) => show({ text: error?.message || "Couldn't remove that connection.", tone: "error" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: CONNECTIONS_KEY });
      void qc.invalidateQueries({ queryKey: ["connection-states"] });
    },
  });

  const needle = q.trim().toLowerCase();
  const rows = (connections.data ?? [])
    .map((row) => ({ row, name: personName(row.user, row.profile) }))
    .filter(({ row, name }) => !needle || name.toLowerCase().includes(needle) || (row.profile?.headline ?? "").toLowerCase().includes(needle))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : Date.parse(b.row.createdAt) - Date.parse(a.row.createdAt));
  const pending = requests.data?.length ?? 0;

  return (
    <>
      <Stack.Screen options={{ title: "My network" }} />
      <Screen canvas onRefresh={connections.refetch} refreshing={connections.isRefetching} contentStyle={{ padding: 0, gap: spacing.sm }}>
        <View style={{ backgroundColor: colors.surface }}>
          <Pressable
            onPress={() => router.push("/network/invitations")}
            style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }, pressed && { backgroundColor: colors.surfaceRaised }]}
          >
            <Icon name="mail-unread-outline" size={22} color={colors.textSecondary} />
            <Text style={[networkStyles.rowTitle, { flex: 1 }]}>Invitations</Text>
            {pending > 0 && (
              <View style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 }}>
                <Text style={{ color: colors.primaryText, fontSize: font.xs, fontFamily: fontFamily.bold }}>{pending}</Text>
              </View>
            )}
            <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>
        </View>

        <NetworkBlock title={connections.data ? `${connections.data.length} connection${connections.data.length === 1 ? "" : "s"}` : "Connections"} flush>
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xs, gap: spacing.sm }}>
            <Row center gap={spacing.sm}>
              <Text style={networkStyles.meta}>Sort by</Text>
              <Segments options={[{ value: "recent" as const, label: "Recently added" }, { value: "name" as const, label: "Name" }]} value={sort} onChange={setSort} />
            </Row>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 38 }}>
              <Icon name="search" size={16} color={colors.textTertiary} />
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Search connections"
                placeholderTextColor={colors.textTertiary}
                style={[{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular }, Platform.OS === "web" && ({ outlineWidth: 0, outlineStyle: "none" } as object)]}
                autoCapitalize="none"
              />
            </View>
          </View>
          {connections.isLoading ? <Loading /> : !rows.length ? (
            <Empty
              icon="people-outline"
              title={needle ? "No one by that name" : "No connections yet"}
              body={needle ? undefined : "Connect with builders from the Network tab — once they accept, you can message each other."}
              action={needle ? undefined : "Find people"}
              onAction={() => router.push("/(tabs)/discover")}
            />
          ) : rows.map(({ row, name }, i) => {
            const otherId = row.user.id;
            return (
              <View key={row.id}>
                {i > 0 && <View style={networkStyles.divider} />}
                <PersonRowItem
                  name={name}
                  headline={row.profile?.headline}
                  meta={`Connected ${timeAgo(row.createdAt)}`}
                  avatarUrl={personAvatar(row.user, row.profile)}
                  onOpen={() => router.push(`/user/${otherId}`)}
                  right={
                    <Row center gap={spacing.xs}>
                      <Btn label="Message" small variant="outline" onPress={() => router.push(`/chat/${otherId}`)} />
                      <IconButton name="ellipsis-horizontal" label={`More for ${name}`} onPress={() => setRemoving({ row, name })} />
                    </Row>
                  }
                />
              </View>
            );
          })}
        </NetworkBlock>
      </Screen>

      <Sheet
        visible={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name ?? ""}?`}
        subtitle="They won't be told. You won't be able to message each other until one of you connects again."
      >
        <Row gap={spacing.sm}>
          <Btn label="Cancel" small variant="ghost" onPress={() => setRemoving(null)} />
          <Btn label="Remove connection" small variant="danger" loading={remove.isPending} onPress={() => removing && remove.mutate(removing.row.id)} />
        </Row>
      </Sheet>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
