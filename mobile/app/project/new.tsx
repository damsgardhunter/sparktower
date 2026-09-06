import { useState } from "react";
import { View } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { useEntitlementsQuery } from "../../src/hooks/useEntitlements";
import { spacing } from "../../src/theme";
import {
  Body, Btn, Card, Chip, ErrorNote, Field, H2, Label, Meta, Row, Screen, errText,
} from "../../src/components/ui";

const CATEGORIES = [
  "Web App", "Mobile App", "AI/ML", "SaaS", "Fintech", "Education",
  "Healthcare", "E-Commerce", "Gaming", "Social Media", "Other",
];
const ROLES = [
  "Frontend Developer", "Backend Developer", "Full Stack Developer",
  "UI/UX Designer", "Product Manager", "Data Scientist", "Marketing Specialist",
];

/** Create a project. Deliberately simpler than the web's Nova chat flow. */
export default function NewProject() {
  const router = useRouter();
  const { canCreatePrivate, privateLimit } = useEntitlementsQuery();
  const [title, setTitle] = useState("");
  const [oneLiner, setOneLiner] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Web App");
  const [roles, setRoles] = useState<string[]>([]);
  const [teamSize, setTeamSize] = useState("2");
  const [weeks, setWeeks] = useState("8");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api<any>("/api/projects", {
      method: "POST",
      body: {
        title: title.trim(),
        oneLiner: oneLiner.trim() || undefined,
        description: description.trim(),
        category,
        rolesNeeded: roles,
        teamSize: Number(teamSize) || 1,
        estimatedWeeks: Number(weeks) || 4,
        isPrivate,
      },
    }),
    onSuccess: (p) => router.replace(`/project/${p.id}`),
    onError: (e) => setError(errText(e, "Couldn't create the project.")),
  });

  const valid = title.trim().length > 2 && description.trim().length > 10;

  return (
    <>
      <Stack.Screen options={{ title: "New Project" }} />
      <Screen>
        <Card>
          <H2>Start something</H2>
          <Meta>
            You can flesh out the brief, roadmap, and roles afterwards — Nova will help.
          </Meta>
        </Card>

        <Field label="Project name" value={title} onChangeText={setTitle} placeholder="StudyBuddy Match" />
        <Field label="One-liner" value={oneLiner} onChangeText={setOneLiner}
          placeholder="Find the right study partner in minutes." />
        <Field label="Description" value={description} onChangeText={setDescription} multiline
          placeholder="What are you building, and who is it for?" />

        <Label>Category</Label>
        <Row wrap gap={spacing.xs}>
          {CATEGORIES.map((c) => (
            <Chip key={c} label={c} small active={category === c} onPress={() => setCategory(c)} />
          ))}
        </Row>

        <Label>Roles you need</Label>
        <Row wrap gap={spacing.xs}>
          {ROLES.map((r) => (
            <Chip
              key={r}
              label={r}
              small
              active={roles.includes(r)}
              onPress={() => setRoles((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r])}
            />
          ))}
        </Row>

        <Row gap={spacing.sm}>
          <View style={{ flex: 1 }}>
            <Field label="Team size" value={teamSize} onChangeText={setTeamSize} numeric />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Weeks" value={weeks} onChangeText={setWeeks} numeric />
          </View>
        </Row>

        <Label>Visibility</Label>
        <Row gap={spacing.xs}>
          <Chip label="Public" small active={!isPrivate} onPress={() => setIsPrivate(false)} />
          <Chip
            label="🔒 Private"
            small
            active={isPrivate}
            onPress={() => canCreatePrivate && setIsPrivate(true)}
          />
        </Row>
        {!canCreatePrivate && (
          <Meta>
            {privateLimit === 0
              ? "Private projects are on Starter and above."
              : `You've used all ${privateLimit} private projects.`}
          </Meta>
        )}

        {error && <ErrorNote message={error} />}
        <Btn label="Create project" disabled={!valid} loading={create.isPending}
          onPress={() => create.mutate()} />
      </Screen>
    </>
  );
}
