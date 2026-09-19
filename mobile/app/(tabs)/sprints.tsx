/**
 * Sprints & simulations, on a phone.
 *
 * Two things live here: a half-hour game two people play to invent a startup,
 * and a fortnight-long market simulation five people run a company in.
 *
 * ## What used to be here
 *
 * The co-founder sprint — a 24-to-72-hour questionnaire two strangers filled
 * in, mostly alone. It is retired. Ten Years From Now replaces it with the
 * same intent, done as a series of decisions you have to agree on rather than
 * paragraphs typed into separate boxes.
 */
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, spacing } from "../../src/theme";
import { Btn, Card, Empty, Loading, Screen } from "../../src/components/ui";
import { Group, MenuRow, PageIntro, isSwitchedOff } from "../../src/components/MoreKit";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { useVentures } from "../../src/components/sim/useSim";
import { liveVentures, ventureRoute, ventureTitle } from "../../src/components/sim/lobby";

export default function Sprints() {
  const router = useRouter();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();

  /* A game you walked away from is the first thing this screen should offer. */
  const { data: active, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: ["games-active"],
    queryFn: () => api<{ games: { id: string }[] }>("/api/games/active"),
  });

  const { data: ventures } = useVentures();
  const simVentures = liveVentures((ventures as any)?.ventures ?? []);

  const start = useMutation({
    mutationFn: () => api<{ id: string }>("/api/games/solo", { method: "POST", body: {} }),
    onSuccess: (game) => {
      qc.invalidateQueries({ queryKey: ["games-active"] });
      router.push(`/game/${game.id}` as any);
    },
    onError: (err: any) => {
      // Already playing: take them there rather than refusing.
      const existing = err?.body?.gameId;
      if (existing) return router.push(`/game/${existing}` as any);
      show(err?.body?.message ?? "Couldn't start a game.");
    },
  });

  if (isLoading) return <Loading />;
  if (error && isSwitchedOff(error)) {
    return (
      <Screen canvas>
        <Empty
          icon="pause-circle-outline"
          title="Paused"
          body="This part of the app is switched off right now. Check back soon."
        />
      </Screen>
    );
  }

  const inProgress = active?.games?.[0];

  return (
    <View style={{ flex: 1 }}>
      <Screen canvas onRefresh={refetch} refreshing={isRefetching}>
        <Card>
          <PageIntro
            icon="planet"
            title="Ten Years From Now"
            body="Invent a startup with someone in five rounds — the idea, the customer, the money, the product, and how you spend your first million. Then find out what an AI thinks it's worth in a decade."
          />
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs }}>
            {inProgress ? (
              <Btn
                label="Back to your game"
                icon="play"
                style={{ flex: 1 }}
                onPress={() => router.push(`/game/${inProgress.id}` as any)}
                testID="button-resume-game"
              />
            ) : (
              <Btn
                label={start.isPending ? "Starting…" : "Play now"}
                icon="play"
                style={{ flex: 1 }}
                disabled={start.isPending}
                onPress={() => start.mutate()}
                testID="button-start-game"
              />
            )}
            <Btn
              label="Leaderboards"
              icon="trophy-outline"
              variant="outline"
              style={{ flex: 1 }}
              onPress={() => router.push("/game/boards" as any)}
              testID="button-game-boards"
            />
          </View>
        </Card>

        {/* The market simulation. Its own thing — five strangers and a
            fortnight, not two people and half an hour — but this is the tab
            people come to when they want to build with strangers, so it is the
            honest place to reach it from. */}
        <Group>
          <MenuRow
            icon="trending-up"
            title="Market simulation"
            subtitle={
              simVentures.length === 1
                ? `${ventureTitle(simVentures[0])} — pick up where you left off`
                : simVentures.length > 1
                  ? `${simVentures.length} companies running — pick one up`
                  : "Five strangers, one company, fourteen years"
            }
            tint={colors.novaEmerald}
            onPress={() => router.push((simVentures.length === 1 ? ventureRoute(simVentures[0]) : "/sim") as any)}
            testID="sprints-market-simulation"
          />
        </Group>
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}
