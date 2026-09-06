import { View } from "react-native";
import { Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { spacing } from "../src/theme";
import {
  Body, Btn, Card, Chip, Empty, H2, Label, Loading, Meta, Row, Screen,
} from "../src/components/ui";

export default function Contests() {
  const qc = useQueryClient();
  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["contests"],
    queryFn: () => api<any[]>("/api/contests"),
  });

  const join = useMutation({
    mutationFn: (contestId: string) => api(`/api/contests/${contestId}/join`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contests"] }),
  });

  if (isLoading) return <Loading />;

  const byStatus = (s: string) => (data ?? []).filter((c) => c.status === s);

  return (
    <>
      <Stack.Screen options={{ title: "Contests" }} />
      <Screen onRefresh={refetch} refreshing={isRefetching}>
        {!data?.length ? (
          <Empty title="No contests yet" body="Check back soon." />
        ) : (
          (["active", "upcoming", "judging", "completed"] as const).map((status) => {
            const list = byStatus(status);
            if (!list.length) return null;
            return (
              <View key={status} style={{ gap: spacing.sm }}>
                <Label>{status}</Label>
                {list.map((c) => (
                  <Card key={c.id}>
                    <Row between>
                      <H2 style={{ flex: 1 }}>{c.title}</H2>
                      <Chip label={c.difficulty} small />
                    </Row>
                    <Body muted numberOfLines={3}>{c.description}</Body>
                    <Row wrap gap={spacing.xs}>
                      <Chip label={c.category} small />
                      {c.prize && <Chip label={`🏆 ${c.prize}`} small />}
                    </Row>
                    <Meta>
                      {new Date(c.startDate).toLocaleDateString()} – {new Date(c.endDate).toLocaleDateString()}
                    </Meta>
                    {status === "active" && (
                      <Btn
                        label="Join contest"
                        small
                        loading={join.isPending}
                        onPress={() => join.mutate(c.id)}
                      />
                    )}
                  </Card>
                ))}
              </View>
            );
          })
        )}
      </Screen>
    </>
  );
}
