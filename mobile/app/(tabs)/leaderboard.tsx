import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { spacing, colors } from "../../src/theme";
import {
  Avatar, Body, Card, Chip, Empty, H2, Loading, Meta, Row, Screen, Segments,
} from "../../src/components/ui";

type Board = "views" | "donations" | "reputation";

export default function Leaderboard() {
  const router = useRouter();
  const [board, setBoard] = useState<Board>("views");

  const { data: projects, isLoading } = useQuery({
    queryKey: ["leaderboard", board],
    queryFn: () => api<any[]>(`/api/leaderboard?sortBy=${board}&limit=25`),
    enabled: board !== "reputation",
  });

  const { data: builders, isLoading: buildersLoading } = useQuery({
    queryKey: ["leaderboard", "reputation"],
    queryFn: () => api<any[]>("/api/leaderboard/reputation"),
    enabled: board === "reputation",
  });

  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`);

  return (
    <Screen>
      <Segments
        options={[
          { value: "views" as Board, label: "Most viewed" },
          { value: "donations" as Board, label: "Most funded" },
          { value: "reputation" as Board, label: "Builder Index" },
        ]}
        value={board}
        onChange={setBoard}
      />

      {board === "reputation" ? (
        buildersLoading ? <Loading /> : !builders?.length ? <Empty title="No rankings yet" /> : (
          <View style={{ gap: spacing.sm }}>
            {builders.map((b: any, i: number) => {
              const name = b.profile?.displayName || b.user?.firstName || "Builder";
              return (
                <Card key={b.userId || b.id} onPress={() => router.push(`/user/${b.userId}`)}>
                  <Row center gap={spacing.md}>
                    <Body style={{ width: 28, fontWeight: "800" }}>{medal(i)}</Body>
                    <Avatar name={name} size={36} />
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontWeight: "700" }}>{name}</Body>
                      {b.profile?.headline && <Meta numberOfLines={1}>{b.profile.headline}</Meta>}
                    </View>
                    <Chip label={`${b.builderIndex ?? 0}`} small active />
                  </Row>
                </Card>
              );
            })}
          </View>
        )
      ) : isLoading ? <Loading /> : !projects?.length ? <Empty title="No projects ranked yet" /> : (
        <View style={{ gap: spacing.sm }}>
          {projects.map((p: any, i: number) => (
            <Card key={p.id} onPress={() => router.push(`/project/${p.id}`)}>
              <Row center gap={spacing.md}>
                <Body style={{ width: 28, fontWeight: "800" }}>{medal(i)}</Body>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: "700" }} numberOfLines={1}>
                    {p.isPrivate ? "🔒 " : ""}{p.title}
                  </Body>
                  <Meta>by {p.owner?.firstName || p.owner?.email || "a builder"}</Meta>
                </View>
                <Chip
                  label={board === "views" ? `${p.views} views` : `$${((p.totalDonations || 0) / 100).toFixed(0)}`}
                  small
                />
              </Row>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
