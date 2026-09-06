import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, radius, spacing, postTypeColors } from "../../src/theme";
import {
  Avatar, Body, Btn, Card, Chip, Empty, ErrorNote, H1, H2, Label, Loading,
  Meta, Row, Screen, Segments, timeAgo, plain, errText,
} from "../../src/components/ui";
import { Discussion } from "../../src/components/Discussion";

type Tab = "overview" | "updates" | "roadmap" | "milestones" | "team" | "roles" | "discussion";

const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "updates", label: "Updates" },
  { value: "roadmap", label: "Roadmap" },
  { value: "milestones", label: "Milestones" },
  { value: "team", label: "Team" },
  { value: "roles", label: "Open Roles" },
  { value: "discussion", label: "Discussion" },
];

/**
 * A project's public social page — the native counterpart of the web's
 * ProjectSocialTabs. Milestones and roadmap phases carry their own threads.
 */
export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<any>(`/api/projects/${id}`),
    enabled: !!id,
  });

  const { data: members } = useQuery({
    queryKey: ["project", id, "members"],
    queryFn: () => api<any[]>(`/api/projects/${id}/members`),
    enabled: !!id,
  });

  const { data: counts } = useQuery({
    queryKey: ["project", id, "comment-counts"],
    queryFn: () => api<Record<string, number>>(`/api/projects/${id}/comment-counts`),
    enabled: !!id,
  });

  const { data: follow } = useQuery({
    queryKey: ["project", id, "follow-status"],
    queryFn: () => api<{ following: boolean; count: number }>(`/api/projects/${id}/follow-status`),
    enabled: !!id,
  });

  const toggleFollow = useMutation({
    mutationFn: () => api(`/api/projects/${id}/follow`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", id, "follow-status"] }),
  });

  if (isLoading) return <Loading />;
  if (!project) return <Screen><Empty title="Project not found" /></Screen>;

  // A private project the viewer can't access returns only the title.
  if (project.restricted) {
    return (
      <>
        <Stack.Screen options={{ title: "Private" }} />
        <Screen contentStyle={{ flex: 1, justifyContent: "center" }}>
          <View style={{ alignItems: "center", gap: spacing.md }}>
            <Text style={{ fontSize: 40 }}>🔒</Text>
            <H1 style={{ textAlign: "center" }}>{project.title}</H1>
            <Body muted style={{ textAlign: "center" }}>This is a private project.</Body>
            <Meta style={{ textAlign: "center", maxWidth: 260 }}>
              Only the owner and their team can view it. If you should have access, ask them to add you.
            </Meta>
            <Btn label="Go back" variant="outline" small onPress={() => router.back()} />
          </View>
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: project.title }} />
      <Screen>
        <View style={{ gap: spacing.sm }}>
          <Row gap={spacing.sm} wrap center>
            <Chip label={project.status} small active />
            <Meta>{project.category}</Meta>
            {project.isPrivate && <Chip label="🔒 Private" small />}
          </Row>
          <H1>{project.title}</H1>
          {project.oneLiner && <Body muted>{project.oneLiner}</Body>}
          <Row gap={spacing.sm}>
            <Btn
              label={follow?.following ? `Following${follow.count ? ` · ${follow.count}` : ""}` : "Follow"}
              variant={follow?.following ? "primary" : "outline"}
              small
              loading={toggleFollow.isPending}
              onPress={() => toggleFollow.mutate()}
            />
          </Row>
        </View>

        <Segments options={TABS} value={tab} onChange={setTab} />

        {tab === "overview" && <Overview project={project} />}
        {tab === "updates" && <Updates projectId={id!} />}
        {tab === "roadmap" && <Roadmap projectId={id!} counts={counts} />}
        {tab === "milestones" && <Milestones projectId={id!} counts={counts} />}
        {tab === "team" && <Team members={members || []} onOpen={(uid) => router.push(`/user/${uid}`)} />}
        {tab === "roles" && <Roles project={project} members={members || []} />}
        {tab === "discussion" && (
          <Card>
            <H2>Project discussion</H2>
            <Meta>Ask questions, offer help, or share what you'd want from this.</Meta>
            <Discussion projectId={id!} targetType="project" targetId={id!} />
          </Card>
        )}
      </Screen>
    </>
  );
}

function Overview({ project }: { project: any }) {
  const brief: [string, string | null][] = [
    ["The problem", project.problemStatement],
    ["Who it's for", project.targetUser],
    ["Value proposition", project.valueProposition],
    ["Target customer", project.targetCustomerProfile],
    ["What success looks like", project.successMetrics],
  ];
  const scope = project.scope || {};
  return (
    <View style={{ gap: spacing.md }}>
      {project.mission && (
        <Card>
          <Label>Mission</Label>
          <Body>{project.mission}</Body>
        </Card>
      )}
      {project.description && (
        <Card>
          <Label>About</Label>
          <Body>{project.description}</Body>
        </Card>
      )}
      {brief.filter(([, v]) => v).map(([label, value]) => (
        <Card key={label}>
          <Label>{label}</Label>
          <Body>{value}</Body>
        </Card>
      ))}
      {(scope.mvp?.length || scope.niceToHave?.length) > 0 && (
        <Card>
          <Label>Roadmap scope</Label>
          {scope.mvp?.length > 0 && (
            <>
              <Meta>Building now</Meta>
              {scope.mvp.map((x: string, i: number) => <Body key={i}>· {x}</Body>)}
            </>
          )}
          {scope.niceToHave?.length > 0 && (
            <>
              <Meta style={{ marginTop: spacing.sm }}>Exploring next</Meta>
              <Row wrap gap={spacing.xs}>
                {scope.niceToHave.map((x: string) => <Chip key={x} label={x} small />)}
              </Row>
            </>
          )}
        </Card>
      )}
      {(project.techStack?.length ?? 0) > 0 && (
        <Card>
          <Label>Tech stack</Label>
          <Row wrap gap={spacing.xs}>
            {project.techStack.map((t: string) => <Chip key={t} label={t} small />)}
          </Row>
        </Card>
      )}
    </View>
  );
}

function Updates({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["feed", "project", projectId],
    queryFn: () => api<{ posts: any[] }>(`/api/feed?projectId=${projectId}&limit=20`),
  });
  if (isLoading) return <Loading />;
  if (!data?.posts?.length) return <Empty title="No updates yet" />;
  return (
    <View style={{ gap: spacing.md }}>
      {data.posts.map((p) => {
        const accent = postTypeColors[p.postType] || colors.info;
        const name = p.profile?.displayName || p.author?.firstName || "Someone";
        return (
          <Card key={p.id} accent={accent}>
            <Row center gap={spacing.sm}>
              <Avatar name={name} size={32} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>{name}</Body>
                <Meta>{timeAgo(p.createdAt)}</Meta>
              </View>
            </Row>
            <Body>{plain(p.content)}</Body>
            <Meta>👍 {p.reactionCount} · 💬 {p.commentCount}</Meta>
          </Card>
        );
      })}
    </View>
  );
}

function Roadmap({ projectId, counts }: { projectId: string; counts?: Record<string, number> }) {
  const { data, isLoading } = useQuery({
    queryKey: ["project", projectId, "roadmap"],
    queryFn: () => api<any>(`/api/projects/${projectId}/roadmap`),
  });
  if (isLoading) return <Loading />;
  if (!data?.roadmap) return <Empty title="No public roadmap yet" />;
  const done = data.roadmap.phases.filter((p: any) => p.status === "completed").length;
  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <Label>The goal</Label>
        <H2>{data.roadmap.goal}</H2>
        {data.roadmap.summary && <Body muted>{data.roadmap.summary}</Body>}
        <Meta>{done} of {data.roadmap.phases.length} phases complete</Meta>
      </Card>
      {data.roadmap.phases.map((phase: any, i: number) => (
        <Card key={phase.id}>
          <Row center gap={spacing.sm}>
            <Text style={{ fontSize: 16 }}>
              {phase.status === "completed" ? "✅" : phase.status === "in-progress" ? "🔵" : "⚪️"}
            </Text>
            <H2 style={{ flex: 1 }}>{phase.title}</H2>
          </Row>
          {phase.estimatedDuration && <Meta>{phase.estimatedDuration}</Meta>}
          {phase.description && <Body muted>{phase.description}</Body>}
          {(phase.skillsNeeded?.length ?? 0) > 0 && (
            <Row wrap gap={spacing.xs}>
              {phase.skillsNeeded.map((sk: string) => <Chip key={sk} label={sk} small />)}
            </Row>
          )}
          <Discussion
            projectId={projectId}
            targetType="roadmap_phase"
            targetId={phase.id}
            compact={(counts?.[`roadmap_phase:${phase.id}`] || 0) === 0}
          />
        </Card>
      ))}
    </View>
  );
}

function Milestones({ projectId, counts }: { projectId: string; counts?: Record<string, number> }) {
  const { data, isLoading } = useQuery({
    queryKey: ["project", projectId, "milestones"],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/milestones`),
  });
  if (isLoading) return <Loading />;
  if (!data?.length) return <Empty title="No milestones yet" />;
  return (
    <View style={{ gap: spacing.md }}>
      {data.map((m) => (
        <Card key={m.id}>
          <Row center gap={spacing.sm}>
            <Text style={{ fontSize: 16 }}>
              {m.status === "completed" ? "✅" : m.status === "in-progress" ? "🔵" : "⚪️"}
            </Text>
            <H2 style={{ flex: 1 }}>{m.title}</H2>
          </Row>
          {m.description && <Body muted>{m.description}</Body>}
          {m.targetDate && <Meta>Target {new Date(m.targetDate).toLocaleDateString()}</Meta>}
          {/* Anyone can congratulate or offer help — building in public. */}
          <Discussion
            projectId={projectId}
            targetType="milestone"
            targetId={m.id}
            compact={(counts?.[`milestone:${m.id}`] || 0) === 0}
          />
        </Card>
      ))}
    </View>
  );
}

function Team({ members, onOpen }: { members: any[]; onOpen: (id: string) => void }) {
  if (!members.length) return <Empty title="No team members listed" />;
  return (
    <View style={{ gap: spacing.sm }}>
      {members.map((m) => {
        const name = m.profile?.displayName || m.user?.firstName || m.user?.email || "Member";
        return (
          <Card key={m.id} onPress={() => onOpen(m.userId)}>
            <Row center gap={spacing.md}>
              <Avatar name={name} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>{name}</Body>
                <Meta>{m.role}</Meta>
                {m.profile?.headline && <Meta numberOfLines={1}>{m.profile.headline}</Meta>}
              </View>
            </Row>
          </Card>
        );
      })}
    </View>
  );
}

function Roles({ project, members }: { project: any; members: any[] }) {
  // A Solo Builder project isn't recruiting, even if rolesNeeded still has
  // entries left over from before the toggle was flipped.
  if (project.soloMode) {
    return <Empty title="Solo Builder project — the owner isn't recruiting teammates" />;
  }
  const filled = new Set(members.map((m) => (m.role || "").toLowerCase()));
  const open = (project.rolesNeeded || []).filter((r: string) => !filled.has(r.toLowerCase()));
  if (!open.length) {
    return <Empty title={project.rolesNeeded?.length ? "Every role is filled" : "No open roles listed"} />;
  }
  return (
    <View style={{ gap: spacing.sm }}>
      <Meta>{open.length} role{open.length === 1 ? "" : "s"} still open.</Meta>
      {open.map((r: string) => (
        <Card key={r}>
          <Body style={{ fontWeight: "700" }}>{r}</Body>
          <Meta>{project.estimatedWeeks ? `~${project.estimatedWeeks} week project` : "Open-ended"}</Meta>
        </Card>
      ))}
    </View>
  );
}
