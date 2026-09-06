import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { spacing } from "../../src/theme";
import {
  Avatar, Body, Btn, Card, Chip, Empty, Field, H2, Loading, Meta, Row, Screen, Segments,
} from "../../src/components/ui";

type Mode = "people" | "looking";

/** Find collaborators: AI matches, a name search, and who's openly looking. */
export default function Discover() {
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("people");
  const [q, setQ] = useState("");

  const { data: matches, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["matches"],
    queryFn: () => api<any[]>("/api/matches"),
    enabled: mode === "people",
  });

  const { data: search } = useQuery({
    queryKey: ["users", "search", q],
    queryFn: () => api<any[]>(`/api/users/search?q=${encodeURIComponent(q)}`),
    enabled: mode === "people" && q.trim().length > 1,
  });

  const { data: looking, isLoading: lookingLoading } = useQuery({
    queryKey: ["looking-for"],
    queryFn: () => api<any[]>("/api/looking-for"),
    enabled: mode === "looking",
  });

  const generate = useMutation({
    mutationFn: () => api("/api/matches/generate", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["matches"] }),
  });

  const showing = q.trim().length > 1 ? search : matches;

  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      <Segments
        options={[{ value: "people" as Mode, label: "People" }, { value: "looking" as Mode, label: "Who's looking" }]}
        value={mode}
        onChange={setMode}
      />

      {mode === "people" ? (
        <>
          <Field value={q} onChangeText={setQ} placeholder="Search builders by name" autoCapitalize="none" />
          {q.trim().length <= 1 && (
            <Btn
              label="Generate AI matches"
              variant="outline"
              small
              loading={generate.isPending}
              onPress={() => generate.mutate()}
            />
          )}
          {isLoading ? <Loading /> : !showing?.length ? (
            <Empty title="No one yet" body="Generate matches to find collaborators." />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {showing.map((m: any) => {
                const user = m.matchedUser || m;
                const profile = m.matchedProfile || m.profile;
                const name = profile?.displayName || user?.firstName || user?.email || "Builder";
                return (
                  <Card key={m.id || user.id} onPress={() => router.push(`/user/${user.id}`)}>
                    <Row center gap={spacing.md}>
                      <Avatar name={name} />
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontWeight: "700" }}>{name}</Body>
                        {profile?.headline && <Meta numberOfLines={1}>{profile.headline}</Meta>}
                        {m.score != null && <Meta>{m.score}% match</Meta>}
                      </View>
                    </Row>
                    {(profile?.skills?.length ?? 0) > 0 && (
                      <Row wrap gap={spacing.xs}>
                        {profile.skills.slice(0, 4).map((s: string) => <Chip key={s} label={s} small />)}
                      </Row>
                    )}
                    {(m.reasons?.length ?? 0) > 0 && <Meta>{m.reasons[0]}</Meta>}
                  </Card>
                );
              })}
            </View>
          )}
        </>
      ) : lookingLoading ? (
        <Loading />
      ) : !looking?.length ? (
        <Empty title="Nobody's posted an open call yet" />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {looking.map((p: any) => {
            const lf = p.lookingFor || {};
            const name = p.displayName || p.user?.firstName || "Builder";
            return (
              <Card key={p.userId} onPress={() => router.push(`/user/${p.userId}`)}>
                <Row center gap={spacing.md}>
                  <Avatar name={name} />
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{name}</Body>
                    <Meta>Looking for {lf.role}</Meta>
                  </View>
                </Row>
                <Row wrap gap={spacing.xs}>
                  {(lf.industries || []).map((i: string) => <Chip key={i} label={i} small />)}
                  {lf.commitment && <Chip label={lf.commitment} small />}
                  {lf.stage && <Chip label={lf.stage} small />}
                  {lf.equityAvailable === true && <Chip label="Equity available" small />}
                </Row>
                {lf.details && <Body muted>{lf.details}</Body>}
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
