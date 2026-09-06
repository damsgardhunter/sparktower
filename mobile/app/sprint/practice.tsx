import { useState } from "react";
import { View } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { spacing } from "../../src/theme";
import {
  Body, Btn, Card, Chip, Cost, ErrorNote, H2, Label, Meta, Row, Screen, Segments, errText,
} from "../../src/components/ui";

const DURATIONS = [
  { value: "24h" as const, label: "24 hours" },
  { value: "72h" as const, label: "72 hours" },
];
const STYLES = [
  { value: "past" as const, label: "Reimagined Classic" },
  { value: "modern" as const, label: "Modern Innovation" },
  { value: "futuristic" as const, label: "Future Vision" },
];

interface Idea {
  name: string; tagline: string; pitch: string; twist: string; whoItsFor: string; vibe: string;
}

/** Practice sprint setup: duration, style, then pick one of three Nova ideas. */
export default function PracticeSprint() {
  const router = useRouter();
  const [duration, setDuration] = useState<"24h" | "72h">("24h");
  const [style, setStyle] = useState<"past" | "modern" | "futuristic">("modern");
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchIdeas = useMutation({
    mutationFn: () => api<{ ideas: Idea[] }>("/api/sprints/idea-options", {
      method: "POST",
      body: { productStyle: style },
    }),
    onSuccess: (r) => { setIdeas(r.ideas); setPicked(null); setError(null); },
    onError: (e) => setError(errText(e, "Nova couldn't come up with ideas.")),
  });

  const create = useMutation({
    mutationFn: (idea?: Idea) => api<any>("/api/sprints/practice", {
      method: "POST",
      body: { duration, productStyle: style, idea },
    }),
    onSuccess: (sprint) => router.replace(`/sprint/${sprint.id}`),
    onError: (e) => setError(errText(e, "Couldn't create the practice sprint.")),
  });

  return (
    <>
      <Stack.Screen options={{ title: "Practice Sprint" }} />
      <Screen>
        <Card>
          <H2>Practice with Nova</H2>
          <Meta>
            Nova pitches you ideas, talks through the product, answers the ideation
            questions as your partner, and gives feedback at the end.
          </Meta>
        </Card>

        <Label>How long?</Label>
        <Segments options={DURATIONS} value={duration} onChange={setDuration} />

        <Label>Product style</Label>
        <Segments options={STYLES} value={style} onChange={setStyle} />

        {ideas.length === 0 ? (
          <Card>
            <H2>Need something to build?</H2>
            <Meta>Nova will pitch three ideas. Pick whichever sounds most fun.</Meta>
            <Btn
              label="Show me 3 ideas"
              loading={fetchIdeas.isPending}
              onPress={() => fetchIdeas.mutate()}
            />
            <Btn
              label="Surprise me instead"
              variant="outline"
              small
              loading={create.isPending}
              onPress={() => create.mutate(undefined)}
            />
          </Card>
        ) : (
          <View style={{ gap: spacing.md }}>
            <Row between>
              <Label>Pick one</Label>
              <Btn
                label="Reshuffle"
                variant="ghost"
                small
                loading={fetchIdeas.isPending}
                onPress={() => fetchIdeas.mutate()}
              />
            </Row>
            {ideas.map((idea) => (
              <Card
                key={idea.name}
                onPress={() => setPicked(idea.name)}
                accent={picked === idea.name ? "#4ADE80" : undefined}
              >
                <Row between>
                  <H2 style={{ flex: 1 }}>{idea.name}</H2>
                  {idea.vibe ? <Chip label={idea.vibe} small /> : null}
                </Row>
                {idea.tagline ? <Body style={{ fontWeight: "600" }}>{idea.tagline}</Body> : null}
                <Body muted>{idea.pitch}</Body>
                {idea.twist ? (
                  <View style={{ gap: 2 }}>
                    <Label>The twist</Label>
                    <Meta>{idea.twist}</Meta>
                  </View>
                ) : null}
                {idea.whoItsFor ? (
                  <View style={{ gap: 2 }}>
                    <Label>Who it's for</Label>
                    <Meta>{idea.whoItsFor}</Meta>
                  </View>
                ) : null}
              </Card>
            ))}
            <Btn
              label={picked ? `Build "${picked}"` : "Pick an idea above"}
              disabled={!picked}
              loading={create.isPending}
              onPress={() => create.mutate(ideas.find((i) => i.name === picked))}
            />
          </View>
        )}

        {error && <ErrorNote message={error} />}
      </Screen>
    </>
  );
}
