import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { spacing } from "../../src/theme";
import {
  Body, Btn, Card, Chip, Cost, Empty, ErrorNote, H2, Label, Loading, Meta,
  Row, Screen, Segments, errText, timeAgo,
} from "../../src/components/ui";

const DURATIONS = [
  { value: "24h" as const, label: "24 hours" },
  { value: "72h" as const, label: "72 hours" },
];

/** Sprint hub: your sprints, the matchmaking queue, and practice with Nova. */
export default function Sprints() {
  const router = useRouter();
  const qc = useQueryClient();
  const [duration, setDuration] = useState<"24h" | "72h">("24h");
  const [error, setError] = useState<string | null>(null);

  const { data: sprints, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["sprints"],
    queryFn: () => api<any[]>("/api/sprints"),
  });

  const { data: queue } = useQuery({
    queryKey: ["sprint-queue"],
    queryFn: () => api<any>("/api/sprints/queue/status"),
    // Polling doubles as the heartbeat that keeps the queue row alive.
    refetchInterval: 5_000,
  });

  const { data: projects } = useQuery({
    queryKey: ["feed", "my-projects"],
    queryFn: () => api<any[]>("/api/feed/my-projects"),
  });

  const [projectId, setProjectId] = useState<string | undefined>();

  const join = useMutation({
    mutationFn: () => api<any>("/api/sprints/queue", { method: "POST", body: { duration, projectId } }),
    onSuccess: (r) => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["sprint-queue"] });
      if (r.matched && r.sprint) router.push(`/sprint/${r.sprint.id}`);
    },
    onError: (e) => setError(errText(e, "Couldn't join the queue.")),
  });

  const leave = useMutation({
    mutationFn: () => api("/api/sprints/queue", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sprint-queue"] }),
  });

  // A match made by the other side arrives on our next poll.
  if (queue?.matched && queue.sprint) {
    router.push(`/sprint/${queue.sprint.id}`);
  }

  if (isLoading) return <Loading />;

  const active = (sprints ?? []).filter((s) => s.status !== "completed");
  const done = (sprints ?? []).filter((s) => s.status === "completed");

  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      {queue?.inQueue ? (
        <Card accent="#4ADE80">
          <H2>Looking for a partner…</H2>
          <Meta>
            #{queue.position ?? "—"} in line · {queue.waiting ?? 0} waiting ·{" "}
            {Math.floor((queue.waitingSeconds ?? 0) / 60)}m {(queue.waitingSeconds ?? 0) % 60}s
          </Meta>
          <Row gap={spacing.sm}>
            <Chip label={queue.entry?.duration} small active />
            <Btn label="Leave queue" variant="ghost" small loading={leave.isPending} onPress={() => leave.mutate()} />
          </Row>
          <Btn
            label="Practice with Nova instead"
            variant="outline"
            small
            onPress={() => router.push("/sprint/practice")}
          />
        </Card>
      ) : (
        <Card>
          <H2>Start a Sprint</H2>
          <Meta>Build something with a stranger in 24 or 72 hours — or rehearse with Nova.</Meta>
          <Label>How long?</Label>
          <Segments options={DURATIONS} value={duration} onChange={setDuration} />
          {(projects?.length ?? 0) > 0 && (
            <>
              <Label>Build what?</Label>
              <Row wrap gap={spacing.xs}>
                <Chip label="A fresh idea" small active={!projectId} onPress={() => setProjectId(undefined)} />
                {projects!.map((p) => (
                  <Chip
                    key={p.id}
                    label={p.title}
                    small
                    active={projectId === p.id}
                    onPress={() => setProjectId(p.id)}
                  />
                ))}
              </Row>
            </>
          )}
          {error && <ErrorNote message={error} />}
          <Btn label="Find a partner" loading={join.isPending} onPress={() => join.mutate()} />
          <Btn
            label="Practice with Nova"
            variant="outline"
            onPress={() => router.push("/sprint/practice")}
          />
        </Card>
      )}

      {active.length > 0 && (
        <>
          <Label>Active</Label>
          {active.map((s) => (
            <Card key={s.id} onPress={() => router.push(`/sprint/${s.id}`)}>
              <Row between>
                <Body style={{ fontWeight: "700", flex: 1 }} numberOfLines={1}>
                  {s.productName || "Unnamed sprint"}
                </Body>
                <Chip label={s.status} small active />
              </Row>
              <Meta>
                {s.duration}{s.isPractice ? " · practice with Nova" : ""} · started {timeAgo(s.createdAt)}
              </Meta>
            </Card>
          ))}
        </>
      )}

      {done.length > 0 && (
        <>
          <Label>Completed</Label>
          {done.map((s) => (
            <Card key={s.id} onPress={() => router.push(`/sprint/${s.id}`)}>
              <Body style={{ fontWeight: "700" }} numberOfLines={1}>{s.productName || "Sprint"}</Body>
              <Meta>{s.duration}{s.isPractice ? " · practice" : ""} · {timeAgo(s.completedAt || s.createdAt)}</Meta>
            </Card>
          ))}
        </>
      )}

      {!active.length && !done.length && !queue?.inQueue && (
        <Empty title="No sprints yet" body="Find a partner or practise with Nova to get started." />
      )}
    </Screen>
  );
}
