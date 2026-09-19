/**
 * The team: members with their availability and task load, the owner's
 * edits, applications to join (accept or reject), and Nova's people
 * recommendations.
 */
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Avatar, Body, Btn, Card, Chip, Cost, Divider, Empty, Icon, Label, Loading, Meta, Row, timeAgo } from "../ui";
import { Bubble, EditorSheet, Line, Tag, Well, shareText, useNotify, type Notify } from "./bits";

import { mkey } from "./shared";

interface Member {
  id: string; userId: string; role: string; timezone: string | null; availability: string | null; hoursPerWeek: number | null; skills: string[] | null;
  user: { id: string; firstName?: string | null; lastName?: string | null; email?: string | null };
  profile?: { displayName?: string | null; avatarUrl?: string | null; headline?: string | null };
}
interface Application {
  id: string; userId: string; status: "pending" | "accepted" | "rejected"; message: string | null; answers: any; resumeUrl: string | null; createdAt: string;
  user?: { firstName?: string | null; lastName?: string | null; email?: string | null };
  profile?: { displayName?: string | null; avatarUrl?: string | null; headline?: string | null };
}

const nameOf = (x: { user?: any; profile?: any }) =>
  x.profile?.displayName || [x.user?.firstName, x.user?.lastName].filter(Boolean).join(" ") || x.user?.email || "Member";

/** The roles an invite can carry — the same list the server validates against (shared/invites.ts). */
const INVITE_ROLES = ["Collaborator", "Cofounder", "Engineer", "Designer", "Marketer", "Advisor"];

/**
 * Inviting someone from the phone.
 *
 * The web has had this since invites existed; the app could only be invited,
 * never invite — which quietly ended the referral loop for anyone who works
 * from their phone. Anyone on the team can send one (server/invite-routes.ts).
 *
 * The link is the thing that matters: an address is optional, and with email
 * unconfigured on a development server nothing is sent at all, so the link is
 * always shown and always shareable rather than assumed delivered.
 */
function InviteSheet({ projectId, projectTitle, visible, onClose, onNotice }: {
  projectId: string; projectTitle: string; visible: boolean; onClose: () => void; onNotice: Notify;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(INVITE_ROLES[0]);
  const [created, setCreated] = useState<{ url: string; email: string | null; emailStatus: string | null } | null>(null);
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: () => api<{ invite: { email: string | null; emailStatus: string | null }; url: string }>(`/api/projects/${projectId}/invites`, {
      method: "POST",
      body: { email: email.trim() || undefined, role },
    }),
    onSuccess: (r) => {
      setCreated({ url: r.url, email: r.invite.email, emailStatus: r.invite.emailStatus });
      qc.invalidateQueries({ queryKey: mkey(projectId, "invites") });
    },
    onError: (e: any) => onNotice(e?.body?.message ?? "Couldn't create that invite.", "error"),
  });

  const close = () => { setEmail(""); setRole(INVITE_ROLES[0]); setCreated(null); onClose(); };

  return (
    <EditorSheet
      visible={visible}
      onClose={close}
      title={created ? "Invite ready" : `Invite someone to ${projectTitle}`}
      subtitle={created
        ? "Anyone with this link can join once, and it expires in a week."
        : "You'll get a link to share. Add their email and we'll send it too — only that account can accept."}
      action={created ? undefined : { label: "Create", onPress: () => create.mutate(), disabled: create.isPending, loading: create.isPending }}
    >
      {created ? (
        <View style={{ gap: spacing.md }}>
          <Well tone="primary"><Body>{created.url}</Body></Well>
          <Btn label="Share the link" icon="share-outline" onPress={() => shareText(`Join ${projectTitle} on SparkTower: ${created.url}`)} testID="button-share-invite" />
          {created.email && (
            <Meta>
              {created.emailStatus === "sent"
                ? `Emailed to ${created.email}.`
                : `Nothing was sent to ${created.email} — email isn't set up on this server, so send them the link yourself.`}
            </Meta>
          )}
          <Btn variant="ghost" label="Done" onPress={close} />
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          <View style={{ gap: 6 }}>
            <Label>Their email (optional)</Label>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="them@example.com"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              keyboardType="email-address"
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, fontFamily: fontFamily.regular, fontSize: font.sm, color: colors.text, backgroundColor: colors.surface }}
              testID="input-invite-email"
            />
          </View>
          <View style={{ gap: 6 }}>
            <Label>Joining as</Label>
            <Row wrap gap={6}>
              {INVITE_ROLES.map((r) => (
                <Chip key={r} label={r} active={r === role} onPress={() => setRole(r)} />
              ))}
            </Row>
          </View>
        </View>
      )}
    </EditorSheet>
  );
}

export function Team({ projectId, project, members, isOwner }: { projectId: string; project: any; members: Member[]; isOwner: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const solo = !!project?.soloMode;
  const [editing, setEditing] = useState<{ userId: string; timezone: string; availability: string; hoursPerWeek: string; skills: string } | null>(null);
  const [showDecided, setShowDecided] = useState(false);
  const [inviting, setInviting] = useState(false);

  const { data: tasks } = useQuery({ queryKey: mkey(projectId, "kanban"), queryFn: () => api<any[]>(`/api/projects/${projectId}/kanban`) });
  const { data: inviteList } = useQuery({
    queryKey: mkey(projectId, "invites"),
    queryFn: () => api<{ invites: { id: string; email: string | null; role: string; status: string; invitedByName: string | null }[] }>(`/api/projects/${projectId}/invites`),
    enabled: !solo,
  });
  const invites = inviteList?.invites ?? [];

  const { data: apps, isLoading: appsLoading } = useQuery({
    queryKey: mkey(projectId, "applications"),
    queryFn: () => api<Application[]>(`/api/projects/${projectId}/applications`),
    enabled: isOwner && !solo,
  });

  const saveMember = useMutation({
    mutationFn: (e: NonNullable<typeof editing>) => api(`/api/projects/${projectId}/members/${e.userId}`, {
      method: "PATCH",
      body: {
        timezone: e.timezone || null, availability: e.availability || null,
        hoursPerWeek: e.hoursPerWeek ? parseInt(e.hoursPerWeek, 10) || null : null,
        skills: e.skills ? e.skills.split(",").map((s) => s.trim()).filter(Boolean) : null,
      },
    }),
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: mkey(projectId, "members") }); notify("Member updated"); },
    onError: (e) => fail(e),
  });
  const decide = useMutation({
    mutationFn: (b: { id: string; accept: boolean }) => api(`/api/applications/${b.id}/${b.accept ? "accept" : "reject"}`, { method: "POST", body: {} }),
    onSuccess: (_r, b) => {
      qc.invalidateQueries({ queryKey: mkey(projectId, "applications") });
      qc.invalidateQueries({ queryKey: mkey(projectId, "members") });
      notify(b.accept ? "Accepted — they're on the team" : "Application declined");
    },
    onError: (e) => fail(e),
  });
  const recommend = useMutation({
    mutationFn: () => api<any>(`/api/projects/${projectId}/recommend-people`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subscription"] }),
    onError: (e) => fail(e, "Nova couldn't find matches."),
  });

  const stats = (userId: string) => {
    const mine = (tasks ?? []).filter((t) => t.assigneeId === userId);
    return { total: mine.length, done: mine.filter((t) => t.status === "done").length, doing: mine.filter((t) => t.status === "in-progress").length };
  };
  const pending = (apps ?? []).filter((a) => a.status === "pending");
  const decided = (apps ?? []).filter((a) => a.status !== "pending");

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <Row between>
          <View>
            <Row center gap={6}>
              <Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg, color: colors.text }}>Team</Text>
              {solo && <Tag label="Solo Builder" />}
            </Row>
            <Meta>{members.length} member{members.length === 1 ? "" : "s"}{isOwner && !solo && pending.length ? ` · ${pending.length} waiting to join` : ""}</Meta>
          </View>
          {/* Anyone on the team can bring the next person in, not only the owner (server/invite-routes.ts). */}
          {!solo && <Btn small icon="person-add-outline" label="Invite" onPress={() => setInviting(true)} testID="button-invite-collaborator" />}
        </Row>
        {solo && (
          <Well tone="primary">
            <Body>You're building this one solo. Teammates can't be invited and applications are off — it's just you and Nova. Solo Builder Mode is locked in at creation.</Body>
          </Well>
        )}
      </Card>

      {/* Invites anyone on the team sent, and what became of them — the web's list, on the phone. */}
      {!solo && invites.length > 0 && (
        <Card style={{ gap: spacing.sm }}>
          <Row center gap={6}><Icon name="mail-outline" size={17} color={colors.primary} /><Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>Invites</Text></Row>
          {invites.map((i) => (
            <Row key={i.id} between gap={spacing.sm} style={{ borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{i.email ?? "Link invite"}</Text>
                <Meta>{i.role}{i.invitedByName ? ` · from ${i.invitedByName}` : ""}</Meta>
              </View>
              <Tag label={i.status} />
            </Row>
          ))}
        </Card>
      )}

      {isOwner && !solo && (
        <Card style={{ gap: spacing.md }}>
          <Row between>
            <Row center gap={6}><Icon name="mail-unread-outline" size={17} color={colors.primary} /><Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>Applications</Text></Row>
            {pending.length > 0 && <Tag label={`${pending.length} new`} solid />}
          </Row>
          {appsLoading ? <View style={{ height: 60 }}><Loading /></View> : pending.length === 0 ? (
            <Meta>No one is waiting. People apply from your project page when you list roles you need.</Meta>
          ) : pending.map((a) => (
            <View key={a.id} style={{ gap: spacing.sm }}>
              <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
                <Avatar name={nameOf(a)} uri={a.profile?.avatarUrl} size={44} />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm + 1, color: colors.text }}>{nameOf(a)}</Text>
                  {!!a.profile?.headline && <Meta numberOfLines={2}>{a.profile.headline}</Meta>}
                  <Meta>Applied {timeAgo(a.createdAt)}</Meta>
                </View>
              </Row>
              {!!a.message && <Body>{a.message}</Body>}
              {Array.isArray(a.answers) && a.answers.length > 0 && (
                <Well>
                  {a.answers.map((x: any, i: number) => (
                    <View key={i} style={{ gap: 1 }}>
                      <Meta>{x?.question ?? x?.questionId ?? `Question ${i + 1}`}</Meta>
                      <Body>{typeof x === "string" ? x : x?.answer ?? ""}</Body>
                    </View>
                  ))}
                </Well>
              )}
              <Row gap={spacing.sm}>
                <Btn small icon="checkmark" label="Accept" style={{ flex: 1 }} loading={decide.isPending && decide.variables?.id === a.id && decide.variables.accept} onPress={() => decide.mutate({ id: a.id, accept: true })} />
                <Btn small variant="outline" label="Decline" style={{ flex: 1 }} loading={decide.isPending && decide.variables?.id === a.id && !decide.variables.accept} onPress={() => decide.mutate({ id: a.id, accept: false })} />
                <Btn small variant="ghost" icon="person-outline" label="Profile" onPress={() => router.push(`/user/${a.userId}` as any)} />
              </Row>
              <Divider />
            </View>
          ))}
          {decided.length > 0 && (
            <>
              <Btn small variant="ghost" label={showDecided ? "Hide past applications" : `Past applications (${decided.length})`} onPress={() => setShowDecided(!showDecided)} style={{ alignSelf: "flex-start" }} />
              {showDecided && decided.map((a) => (
                <Row key={a.id} center gap={spacing.sm}>
                  <Avatar name={nameOf(a)} uri={a.profile?.avatarUrl} size={28} />
                  <Body style={{ flex: 1 }}>{nameOf(a)}</Body>
                  <Tag label={a.status === "accepted" ? "Accepted" : "Declined"} color={a.status === "accepted" ? colors.success : colors.textTertiary} />
                </Row>
              ))}
            </>
          )}
        </Card>
      )}

      {members.length === 0 ? <Card><Empty icon="people-outline" title="No members yet" /></Card> : (
        <Card style={{ gap: 0, paddingVertical: spacing.xs }}>
          {members.map((m, i) => {
            const s = stats(m.userId);
            const isEditing = editing?.userId === m.userId;
            return (
              <View key={m.id} style={{ paddingVertical: spacing.md, gap: spacing.sm, borderTopWidth: i === 0 ? 0 : 1, borderColor: colors.borderSubtle }}>
                <Row gap={spacing.md} style={{ alignItems: "flex-start" }}>
                  <Avatar name={nameOf(m)} uri={m.profile?.avatarUrl} size={48} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Row center gap={6}>
                      <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text, flexShrink: 1 }} numberOfLines={1}>{nameOf(m)}</Text>
                      {m.userId === project?.ownerId && <Tag label="Owner" />}
                    </Row>
                    <Meta style={{ textTransform: "capitalize" }}>{m.role}</Meta>
                    {(m.timezone || m.availability || m.hoursPerWeek) && (
                      <Meta>{[m.timezone, m.availability, m.hoursPerWeek ? `${m.hoursPerWeek}h/week` : null].filter(Boolean).join(" · ")}</Meta>
                    )}
                    {(m.skills ?? []).length > 0 && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
                        {(m.skills ?? []).map((sk) => <Chip key={sk} label={sk} small />)}
                      </View>
                    )}
                    <Meta>{s.done} done · {s.doing} in progress · {s.total} tasks</Meta>
                  </View>
                  {isOwner && !isEditing && (
                    <Btn small variant="ghost" label="Edit" onPress={() => setEditing({ userId: m.userId, timezone: m.timezone ?? "", availability: m.availability ?? "", hoursPerWeek: m.hoursPerWeek?.toString() ?? "", skills: (m.skills ?? []).join(", ") })} />
                  )}
                </Row>
                {isEditing && (
                  <View style={{ gap: spacing.sm, paddingLeft: 60 }}>
                    <Label>Availability</Label>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {["", "full-time", "part-time", "occasional"].map((a) => <Bubble key={a || "none"} small label={a || "Not set"} on={editing.availability === a} onPress={() => setEditing({ ...editing, availability: a })} />)}
                    </View>
                    <Row gap={spacing.sm}>
                      <View style={{ flex: 1 }}><Line value={editing.timezone} onChangeText={(v) => setEditing({ ...editing, timezone: v })} placeholder="Timezone" /></View>
                      <View style={{ width: 90 }}><Line value={editing.hoursPerWeek} onChangeText={(v) => setEditing({ ...editing, hoursPerWeek: v.replace(/\D/g, "") })} placeholder="hrs/wk" numeric /></View>
                    </Row>
                    <Line value={editing.skills} onChangeText={(v) => setEditing({ ...editing, skills: v })} placeholder="Skills (comma-separated)" />
                    <Row gap={spacing.sm}>
                      <Btn small label="Save" loading={saveMember.isPending} onPress={() => saveMember.mutate(editing)} />
                      <Btn small variant="ghost" label="Cancel" onPress={() => setEditing(null)} />
                    </Row>
                  </View>
                )}
              </View>
            );
          })}
        </Card>
      )}

      {!solo && (
        <Card>
          <Row center gap={6}><Icon name="person-add-outline" size={17} color={colors.primary} /><Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>People Nova recommends</Text></Row>
          <Meta>Nova looks through the community for people who fit the roles you need.</Meta>
          <Row center gap={spacing.sm}>
            <Btn small icon="sparkles" label={recommend.isPending ? "Finding matches…" : "Find team members"} loading={recommend.isPending} onPress={() => recommend.mutate()} />
            <Cost credits={1} />
          </Row>
          {(recommend.data?.recommendations ?? []).map((r: any, i: number) => (
            <Row key={i} gap={spacing.sm} style={{ alignItems: "flex-start", paddingTop: spacing.sm }}>
              <Avatar name={r.displayName || r.username} uri={r.avatarUrl} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{r.displayName || r.username || "Builder"}</Text>
                <Meta>{r.reason || r.matchReason}</Meta>
              </View>
              {r.score ? <Tag label={`${r.score}%`} /> : null}
            </Row>
          ))}
        </Card>
      )}
      <InviteSheet
        projectId={projectId}
        projectTitle={project?.title ?? "this project"}
        visible={inviting}
        onClose={() => setInviting(false)}
        onNotice={notify}
      />
    </View>
  );
}
