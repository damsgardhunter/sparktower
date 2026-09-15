import { Stack, useRouter } from "expo-router";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { colors, spacing } from "../src/theme";
import { Avatar, Body, Btn, Card, Empty, Loading, Meta, Row, Screen, timeAgo } from "../src/components/ui";

interface NotificationItem {
  id: string;
  kind: string;
  createdAt: string;
  read: boolean;
  actor: { id: string; name: string; avatarUrl: string | null };
  project: { id: string; title: string | null } | null;
  excerpt: string | null;
  text: string;
}

/**
 * Where a notification opens in the app. The app has no single-post screen
 * yet, so anything about a post opens its project (or its author).
 */
function hrefFor(n: NotificationItem): string {
  if (n.kind === "follow" || n.kind === "connection_request" || n.kind === "connection_accepted") return `/user/${n.actor.id}`;
  if (n.project?.id) return `/project/${n.project.id}`;
  if (n.kind === "followed_post") return `/user/${n.actor.id}`;
  return "/(tabs)/feed";
}

/**
 * The way back into the Explore loop, on the phone: progress from people you
 * follow, replies and reactions to what you post, follows and connections.
 * Same list as the web bell — it's recorded on the server.
 */
export default function Notifications() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ items: NotificationItem[] }>("/api/notifications"),
  });
  const read = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => api("/api/notifications/read", { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notification-count"] });
    },
  });

  const items = data?.items ?? [];
  return (
    <>
      <Stack.Screen options={{ title: "Notifications" }} />
      <Screen onRefresh={refetch} refreshing={isRefetching}>
        {isLoading ? <Loading /> : !items.length ? (
          <Empty title="Nothing yet" body="Follow builders and projects, and their progress shows up here — along with replies and reactions to what you post." />
        ) : (
          <>
            {items.some((n) => !n.read) && <Btn label="Mark all read" variant="ghost" small onPress={() => read.mutate({ all: true })} />}
            {items.map((n) => (
              <Card
                key={n.id}
                accent={n.read ? undefined : colors.primary}
                onPress={() => {
                  if (!n.read) read.mutate({ ids: [n.id] });
                  router.push(hrefFor(n) as any);
                }}
              >
                <Row center gap={spacing.md}>
                  <Avatar name={n.actor.name} uri={n.actor.avatarUrl} size={36} />
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: n.read ? "400" : "700" }}>{n.text}</Body>
                    {n.excerpt ? <Meta numberOfLines={1}>"{n.excerpt}"</Meta> : null}
                    <Meta>{timeAgo(n.createdAt)}</Meta>
                  </View>
                </Row>
              </Card>
            ))}
          </>
        )}
      </Screen>
    </>
  );
}
