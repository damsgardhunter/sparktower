import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { spacing, colors } from "../../src/theme";
import { Avatar, Body, Card, Empty, Loading, Meta, Row, Screen, timeAgo } from "../../src/components/ui";

export default function Messages() {
  const router = useRouter();
  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api<any[]>("/api/messages/conversations"),
    // Chat lists go stale fast; poll while the screen is open.
    refetchInterval: 15_000,
  });

  if (isLoading) return <Loading />;

  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      {!data?.length ? (
        <Empty title="No conversations yet" body="Message someone from their profile to start talking." />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {data.map((c: any) => {
            const other = c.user || c.otherUser;
            const name = c.profile?.displayName || other?.firstName || other?.email || "Someone";
            const unread = c.unreadCount ?? 0;
            return (
              <Card key={other?.id || c.id} onPress={() => router.push(`/chat/${other?.id}`)}>
                <Row center gap={spacing.md}>
                  <Avatar name={name} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Row between>
                      <Body style={{ fontWeight: unread ? "800" : "700", flex: 1 }} numberOfLines={1}>
                        {name}
                      </Body>
                      <Meta>{timeAgo(c.lastMessage?.createdAt || c.createdAt)}</Meta>
                    </Row>
                    <Body muted numberOfLines={1}>
                      {c.lastMessage?.content || "No messages yet"}
                    </Body>
                  </View>
                  {unread > 0 && (
                    <View style={{
                      backgroundColor: colors.primary, minWidth: 20, height: 20,
                      borderRadius: 10, alignItems: "center", justifyContent: "center",
                    }}>
                      <Body style={{ color: colors.primaryText, fontSize: 11, fontWeight: "800" }}>
                        {unread}
                      </Body>
                    </View>
                  )}
                </Row>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
