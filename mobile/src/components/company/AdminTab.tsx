/**
 * The leaders' console on a phone — client/src/components/company/admin-tab.tsx:
 * adding people, giving them powers, changing roles, removing people, and the
 * record of all of it.
 *
 * Only somebody who can manage the team sees the controls; everyone else is
 * told who the leaders are, so they know whom to ask. Every control mirrors a
 * rule the server enforces anyway — something is disabled here only to save
 * somebody a refusal, and it says why, through `blockedOn`, which is the web's
 * sentence for the server's rule.
 *
 * Changing a role and changing powers are deliberately not one control. The
 * server treats them as different decisions with different gates — a member who
 * manages the team may hand out powers but never change a role — and a single
 * combined control would have to grey out half of itself.
 */
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Avatar, Btn, Field, Icon, Loading, Row, errText, timeAgo } from "../ui";
import { Callout, TitledCard } from "../MoreKit";
import { Pill } from "../nova/Pill";
import { text } from "../more/AdminKit";
import { Sheet, type Notice } from "../Sheet";
import {
  COMPANY_PERMISSIONS, COMPANY_ROLES, blockedOn, canActOn, hasPower, isLeader, powerLabel,
  type CompanyPermission, type CompanyRole,
} from "../../companies";
import { companyKey, memberName, type CompanyMember, type CompanyView } from "./kit";

export function AdminTab({ companyId, notify }: { companyId: string; notify: (n: Notice) => void }) {
  const { data } = useQuery<CompanyView>({ queryKey: companyKey(companyId) });
  if (!data) return null;
  const { me, members } = data;

  if (!hasPower(me, "manage_team")) {
    const leaders = members.filter((m) => isLeader(m.role));
    return (
      <View style={{ gap: spacing.md }}>
        <Callout
          icon="shield-checkmark"
          tone="info"
          title="You don't manage the team"
          body={leaders.length
            ? `Ask one of them: ${leaders.map(memberName).join(", ")}.`
            : "Ask an owner or admin."}
        />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <AddPerson companyId={companyId} me={me} notify={notify} />
      <TitledCard icon="key" title="Who can do what">
        <Text style={text.meta}>
          Owners and admins hold every power by their role, so there is nothing to tick for them.
        </Text>
        {members.map((m) => <MemberControls key={m.userId} companyId={companyId} me={me} member={m} notify={notify} />)}
      </TitledCard>
      <Activity companyId={companyId} />
    </View>
  );
}

/** Add somebody already on SparkTower, by email or username, with the powers they start with. */
function AddPerson({ companyId, me, notify }: { companyId: string; me: CompanyView["me"]; notify: (n: Notice) => void }) {
  const qc = useQueryClient();
  const [identifier, setIdentifier] = useState("");
  const [perms, setPerms] = useState<CompanyPermission[]>([]);

  const add = useMutation({
    mutationFn: () => api(`/api/companies/${companyId}/members`, { method: "POST", body: { identifier: identifier.trim(), permissions: perms } }),
    onSuccess: () => {
      setIdentifier("");
      setPerms([]);
      void qc.invalidateQueries({ queryKey: companyKey(companyId) });
      notify({ text: "They're in", tone: "success" });
    },
    /*
     * The server's own words. "They're already in this company" and "No account
     * with that email" are both answers somebody can act on, and replacing them
     * with "Couldn't add that person" would throw the answer away.
     */
    onError: (e) => notify({ text: errText(e, "Couldn't add that person."), tone: "error" }),
  });

  /* Handing out "manage the team" is a leader's call, which the server checks again. */
  const mayGrantManageTeam = canActOn(me, null, "grant_manage_team");

  return (
    <TitledCard icon="person-add" title="Add someone">
      <Text style={text.meta}>They need a SparkTower account already. Type the email or username they use.</Text>
      <Field
        label="Email or username"
        value={identifier}
        onChangeText={setIdentifier}
        placeholder="someone@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
        maxLength={254}
        testID="add-member-identifier"
      />
      <Text style={[text.small, { marginTop: spacing.xs }]}>They join as a member. Powers are optional and can change later.</Text>
      <PowerTicks
        value={perms}
        onChange={setPerms}
        disabledPower={mayGrantManageTeam ? null : "manage_team"}
        disabledReason="Only an owner or admin can let someone manage the team."
        testIDPrefix="add"
      />
      <Btn
        label="Add them"
        loading={add.isPending}
        disabled={identifier.trim().length < 2}
        onPress={() => add.mutate()}
        testID="add-member"
        style={{ marginTop: spacing.sm }}
      />
    </TitledCard>
  );
}

/** The checkboxes, shared by "add someone" and "change what they can do". */
function PowerTicks({
  value, onChange, disabledPower, disabledReason, testIDPrefix,
}: {
  value: CompanyPermission[];
  onChange: (next: CompanyPermission[]) => void;
  disabledPower: CompanyPermission | null;
  disabledReason: string;
  testIDPrefix: string;
}) {
  return (
    <View style={{ gap: 2, marginTop: spacing.xs }}>
      {COMPANY_PERMISSIONS.map((p) => {
        const on = value.includes(p.id);
        const off = disabledPower === p.id;
        return (
          <Pressable
            key={p.id}
            disabled={off}
            testID={`${testIDPrefix}-power-${p.id}`}
            onPress={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
            style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: 6, opacity: off ? 0.45 : 1 }}
          >
            <Icon name={on ? "checkbox" : "square-outline"} size={18} color={on ? colors.primary : colors.textTertiary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>{p.label}</Text>
              <Text style={{ color: colors.textTertiary, fontSize: font.xs }}>{off ? disabledReason : p.help}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One member, with the three things a leader can do to them. */
function MemberControls({
  companyId, me, member, notify,
}: {
  companyId: string; me: CompanyView["me"]; member: CompanyMember; notify: (n: Notice) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [perms, setPerms] = useState<CompanyPermission[]>(member.permissions ?? []);
  const blocked = blockedOn(me, member);
  const refresh = () => qc.invalidateQueries({ queryKey: companyKey(companyId) });

  const savePowers = useMutation({
    mutationFn: () => api(`/api/companies/${companyId}/members/${member.userId}/permissions`, { method: "PUT", body: { permissions: perms } }),
    onSuccess: () => { setEditing(false); void refresh(); notify({ text: "Powers saved", tone: "success" }); },
    onError: (e) => notify({ text: errText(e, "Couldn't change those powers."), tone: "error" }),
  });

  const setRole = useMutation({
    mutationFn: (role: CompanyRole) => api(`/api/companies/${companyId}/members/${member.userId}`, { method: "PATCH", body: { role } }),
    onSuccess: () => { void refresh(); notify({ text: "Role changed", tone: "success" }); },
    /* "Every company needs an owner. Make someone else an owner first." is the server's, and it says what to do. */
    onError: (e) => notify({ text: errText(e, "Couldn't change that role."), tone: "error" }),
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/companies/${companyId}/members/${member.userId}`, { method: "DELETE" }),
    onSuccess: () => { void refresh(); notify({ text: "Removed", tone: "success" }); },
    onError: (e) => notify({ text: errText(e, "Couldn't remove them."), tone: "error" }),
  });

  const leader = isLeader(member.role);
  const mayChangeRole = canActOn(me, member, "role") && member.userId !== me.userId;

  return (
    <View style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border }} testID={`admin-member-${member.userId}`}>
      <Row gap={spacing.sm} center>
        <Avatar name={memberName(member)} uri={member.avatarUrl} size={30} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }} numberOfLines={1}>{memberName(member)}</Text>
          <Text style={{ color: colors.textTertiary, fontSize: font.xs }} numberOfLines={2}>
            {leader
              ? "Holds every power by their role"
              : member.permissions?.length
                ? member.permissions.map(powerLabel).join(", ")
                : "No extra powers"}
          </Text>
        </View>
        <Pill label={member.role} tone={member.role === "owner" ? "good" : "neutral"} />
      </Row>

      {blocked ? (
        <Text style={[text.small, { marginTop: 4 }]} testID={`blocked-${member.userId}`}>{blocked}</Text>
      ) : (
        <Row gap={spacing.sm} wrap style={{ marginTop: 6 }}>
          {/* Nothing to tick for a leader: they hold everything by role, and a stored list against them would mislead whoever read it. */}
          {leader ? null : (
            <Btn small variant="outline" label="Powers" onPress={() => { setPerms(member.permissions ?? []); setEditing(true); }} testID={`edit-powers-${member.userId}`} />
          )}
          {mayChangeRole ? (
            <Btn
              small
              variant="outline"
              label="Role"
              testID={`edit-role-${member.userId}`}
              onPress={() => Alert.alert(
                `${memberName(member)}'s role`,
                "A new role starts with no powers of its own.",
                [
                  ...COMPANY_ROLES.filter((r) => r !== member.role).map((r) => ({ text: `Make ${r === "admin" ? "an admin" : r === "owner" ? "an owner" : "a member"}`, onPress: () => setRole.mutate(r) })),
                  { text: "Cancel", style: "cancel" as const },
                ],
              )}
            />
          ) : null}
          <Btn
            small
            variant="danger"
            label="Remove"
            testID={`remove-${member.userId}`}
            loading={remove.isPending}
            onPress={() => Alert.alert(`Remove ${memberName(member)}?`, "They lose access to everything in this company.", [
              { text: "Keep them", style: "cancel" },
              { text: "Remove", style: "destructive", onPress: () => remove.mutate() },
            ])}
          />
        </Row>
      )}

      <Sheet visible={editing} onClose={() => setEditing(false)} title={memberName(member)} subtitle="What they can do in this company">
        {/*
          * The whole list is sent, not a change to it — the server's own
          * reason: two leaders editing at once end with what the last one saw
          * and chose, rather than a merge neither saw.
          */}
        <PowerTicks
          value={perms}
          onChange={setPerms}
          disabledPower={canActOn(me, member, "grant_manage_team") ? null : "manage_team"}
          disabledReason="Only an owner or admin can let someone manage the team."
          testIDPrefix={`member-${member.userId}`}
        />
        <Btn label="Save" loading={savePowers.isPending} onPress={() => savePowers.mutate()} testID={`save-powers-${member.userId}`} />
      </Sheet>
    </View>
  );
}

interface AuditEntry {
  id: string; action: string; actorName: string; targetName: string | null;
  detail: Record<string, any> | null; createdAt: string;
}

/**
 * One line of plain English per entry, word for word the web's `describe`.
 *
 * An unknown action still says who did something and when, rather than being
 * hidden: a log that silently drops what it does not recognise is worse than
 * one that prints an unfamiliar word.
 */
export function describeAudit(e: AuditEntry): string {
  const who = e.targetName ?? "someone";
  const d = e.detail ?? {};
  const list = (xs: unknown) => (Array.isArray(xs) && xs.length ? xs.map(powerLabel).join(", ").toLowerCase() : "no extra powers");
  switch (e.action) {
    case "member_added": return `added ${who}${Array.isArray(d.permissions) && d.permissions.length ? ` with ${list(d.permissions)}` : ""}`;
    case "member_joined": return `joined with an invite link as ${d.role === "admin" ? "an admin" : "a member"}`;
    case "member_removed": return `removed ${who}`;
    case "member_left": return "left the company";
    case "role_changed": return `made ${who} ${d.to === "admin" ? "an admin" : d.to === "owner" ? "an owner" : "a member"}${d.from ? ` (was ${d.from})` : ""}`;
    case "permissions_changed": return `changed ${who}'s powers to ${list(d.after)}`;
    case "season_created": return `set up the training season "${d.name ?? ""}"`;
    case "season_started": return `started the training season "${d.name ?? ""}"`;
    case "candidate_invited": return `invited ${who} to talk`;
    case "challenge_posted": return `posted the challenge "${d.title ?? ""}"`;
    case "challenge_announced": return `announced the results of "${d.title ?? ""}"`;
    case "post_published": return "posted on the feed as the company";
    case "invite_links_reset": return "reset the invite links, so every earlier link stopped working";
    case "owner_succeeded": return `${who} became an owner when the last owner closed their account`;
    default: return e.action.replace(/_/g, " ");
  }
}

/** Everything that has been done to this company's team, newest first. */
function Activity({ companyId }: { companyId: string }) {
  const log = useInfiniteQuery({
    queryKey: ["company-audit", companyId],
    queryFn: ({ pageParam }) =>
      api<{ entries: AuditEntry[]; nextBefore: string | null }>(
        `/api/companies/${companyId}/audit?limit=25${pageParam ? `&before=${pageParam}` : ""}`,
      ),
    initialPageParam: "" as string,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });

  const entries = log.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <TitledCard icon="time" title="Activity">
      {log.isLoading ? <Loading /> : null}
      {!log.isLoading && !entries.length ? <Text style={text.small}>Nothing has been done to this team yet.</Text> : null}
      {entries.map((e) => (
        <View key={e.id} style={{ paddingVertical: 6, gap: 1 }} testID={`audit-${e.id}`}>
          <Text style={{ color: colors.text, fontSize: font.sm }}>
            <Text style={{ fontFamily: fontFamily.medium }}>{e.actorName}</Text> {describeAudit(e)}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: font.xs }}>{timeAgo(e.createdAt)}</Text>
        </View>
      ))}
      {log.hasNextPage ? (
        <Btn small variant="ghost" label="Older" loading={log.isFetchingNextPage} onPress={() => void log.fetchNextPage()} testID="audit-more" />
      ) : null}
    </TitledCard>
  );
}
