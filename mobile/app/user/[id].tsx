import { View } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { spacing } from "../../src/theme";
import {
  Avatar, Body, Btn, Card, Chip, Empty, H1, H2, Label, Loading, Meta, Row, Screen,
} from "../../src/components/ui";

/** Another builder's public profile. */
export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ["user", id],
    queryFn: () => api<any>(`/api/users/${id}`),
    enabled: !!id,
  });

  const connect = useMutation({
    mutationFn: () => api("/api/connections/request", { method: "POST", body: { userId: id } }),
  });

  if (isLoading) return <Loading />;
  if (!data) return <Screen><Empty title="Profile not found" /></Screen>;

  const p = data.profile || {};
  const name = p.displayName || data.user?.firstName || "Builder";
  const lf = p.lookingFor;

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <Screen>
        <Card>
          <Row center gap={spacing.md}>
            <Avatar name={name} size={64} />
            <View style={{ flex: 1 }}>
              <H1>{name}</H1>
              {p.headline && <Body muted>{p.headline}</Body>}
              {p.location && <Meta>{p.location}</Meta>}
            </View>
          </Row>
          <Row gap={spacing.sm}>
            <Btn label="Connect" small variant="outline" loading={connect.isPending}
              onPress={() => connect.mutate()} />
            <Btn label="Message" small onPress={() => router.push(`/chat/${id}`)} />
          </Row>
        </Card>

        {lf?.isActive && (
          <Card accent="#4ADE80">
            <Label>Looking for</Label>
            <H2>{lf.role}</H2>
            <Row wrap gap={spacing.xs}>
              {(lf.industries || []).map((i: string) => <Chip key={i} label={i} small />)}
              {lf.commitment && <Chip label={lf.commitment} small />}
              {lf.stage && <Chip label={lf.stage} small />}
              {lf.equityAvailable === true && <Chip label="Equity available" small />}
            </Row>
            {lf.details && <Body muted>{lf.details}</Body>}
          </Card>
        )}

        {p.novaSummary && (
          <Card>
            <Label>Nova's read</Label>
            <Body>{p.novaSummary}</Body>
          </Card>
        )}

        {p.bio && (
          <Card>
            <Label>About</Label>
            <Body>{p.bio}</Body>
          </Card>
        )}

        {(p.skills?.length ?? 0) > 0 && (
          <Card>
            <Label>Skills</Label>
            <Row wrap gap={spacing.xs}>
              {p.skills.map((s: string) => <Chip key={s} label={s} small />)}
            </Row>
          </Card>
        )}

        {(p.experience?.length ?? 0) > 0 && (
          <Card>
            <Label>Experience</Label>
            {p.experience.map((e: any, i: number) => (
              <View key={i} style={{ gap: 2, marginTop: i ? spacing.sm : 0 }}>
                <Body style={{ fontWeight: "700" }}>{e.title}</Body>
                {e.company && <Body muted>{e.company}</Body>}
                <Meta>{[e.startDate, e.current ? "Present" : e.endDate].filter(Boolean).join(" – ")}</Meta>
              </View>
            ))}
          </Card>
        )}

        {(p.education?.length ?? 0) > 0 && (
          <Card>
            <Label>Education</Label>
            {p.education.map((e: any, i: number) => (
              <View key={i} style={{ gap: 2, marginTop: i ? spacing.sm : 0 }}>
                <Body style={{ fontWeight: "700" }}>{e.school}</Body>
                <Meta>{[e.degree, e.field].filter(Boolean).join(", ")}</Meta>
              </View>
            ))}
          </Card>
        )}

        {(data.projects?.length ?? 0) > 0 && (
          <>
            <Label>Building</Label>
            {data.projects.map((pr: any) => (
              <Card key={pr.id} onPress={() => router.push(`/project/${pr.id}`)}>
                <Body style={{ fontWeight: "700" }}>{pr.title}</Body>
                <Body muted numberOfLines={2}>{pr.oneLiner || pr.description}</Body>
              </Card>
            ))}
          </>
        )}
      </Screen>
    </>
  );
}
