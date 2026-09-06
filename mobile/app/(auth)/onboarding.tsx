import { useState } from "react";
import { View } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { spacing } from "../../src/theme";
import {
  Body, Btn, Card, Chip, ErrorNote, Field, H1, Label, Meta, Row, Screen, errText,
} from "../../src/components/ui";

const SKILLS = [
  "React", "TypeScript", "Node.js", "Python", "Design", "UI/UX",
  "Marketing", "Sales", "Data", "Mobile", "DevOps", "Product",
];
const INTERESTS = [
  "AI/ML", "Fintech", "Education", "Health", "Climate", "Gaming",
  "Social", "Developer tools", "E-commerce", "Creator tools",
];

/** First-run profile setup, so a new account isn't empty. */
export default function Onboarding() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [headline, setHeadline] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api("/api/profile", {
      method: "POST",
      body: {
        displayName: displayName.trim(),
        headline: headline.trim(),
        skills,
        interests,
        isOnboarded: true,
      },
    }),
    onSuccess: async () => {
      await refreshUser();
      router.replace("/(tabs)/feed");
    },
    onError: (e) => setError(errText(e, "Couldn't save your profile.")),
  });

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  return (
    <>
      <Stack.Screen options={{ title: "Set up" }} />
      <Screen>
        <View style={{ gap: spacing.xs }}>
          <H1>Tell us who you are</H1>
          <Body muted>This is what other builders see. You can change it any time.</Body>
        </View>

        <Field label="Display name" value={displayName} onChangeText={setDisplayName} placeholder="Your name" />
        <Field label="Headline" value={headline} onChangeText={setHeadline}
          placeholder="Frontend engineer who likes shipping fast" />

        <Label>What are you good at?</Label>
        <Row wrap gap={spacing.xs}>
          {SKILLS.map((s) => (
            <Chip key={s} label={s} small active={skills.includes(s)}
              onPress={() => toggle(skills, setSkills, s)} />
          ))}
        </Row>

        <Label>What are you into?</Label>
        <Row wrap gap={spacing.xs}>
          {INTERESTS.map((i) => (
            <Chip key={i} label={i} small active={interests.includes(i)}
              onPress={() => toggle(interests, setInterests, i)} />
          ))}
        </Row>

        {error && <ErrorNote message={error} />}
        <Btn label="Continue" disabled={!displayName.trim()} loading={save.isPending}
          onPress={() => save.mutate()} />
        <Btn label="Skip for now" variant="ghost" small onPress={() => router.replace("/(tabs)/feed")} />
      </Screen>
    </>
  );
}
