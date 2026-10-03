/**
 * The people who act for a company — the phone's half of
 * client/src/components/company/team-tab.tsx.
 *
 * The everyday view: who is in it, what each of them may do, and the way out.
 * Everyone sees the list and can leave; whoever manages the team also gets the
 * invite link. Adding people, powers, roles and removals are on the Admin tab,
 * the same split the web makes, so there is one place to look for them.
 *
 * The last owner cannot leave, and the server's own refusal is shown as-is
 * because it says what to do instead ("Make someone else an owner first").
 */
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Avatar, Btn, Icon, Row, errText } from "../ui";
import { Callout, TitledCard } from "../MoreKit";
import { Pill } from "../nova/Pill";
import { text } from "../more/AdminKit";
import type { Notice } from "../Sheet";
import { ROLE_HELP, hasPower, isLeader, powerLabel } from "../../companies";
import { companyKey, memberName, type CompanyView } from "./kit";

export function TeamTab({ companyId, notify }: { companyId: string; notify: (n: Notice) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useQuery<CompanyView>({ queryKey: companyKey(companyId) });

  const leave = useMutation({
    mutationFn: (userId: string) => api(`/api/companies/${companyId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["companies"] });
      /* Gone, not stale: going Back would otherwise show the company as it was, with tabs that now refuse you. */
      qc.removeQueries({ queryKey: companyKey(companyId) });
      router.replace("/companies");
    },
    onError: (e) => notify({ text: errText(e, "Couldn't leave."), tone: "error" }),
  });

  if (!data) return null;
  const { me, members, company } = data;
  const managesTeam = hasPower(me, "manage_team");

  return (
    <View style={{ gap: spacing.md }}>
      {managesTeam ? <InviteLink companyId={companyId} canInviteAdmins={isLeader(me.role)} notify={notify} /> : null}

      {/*
        * The people are here, so the thing you do with them is one tap away: a
        * training season is played by this team, and looking them up and then
        * hunting for where to start one is two jobs for one thought.
        */}
      {/*
        * Plain `/sim`, with no company in the link. The web navigates to its
        * own training tab; the phone's season surface is being built under
        * `app/sim/` by somebody else and does not read a company parameter
        * yet, and a link carrying one it ignores is a link that looks like it
        * works. When that surface lands this should point into it.
        */}
      <Callout icon="game-controller" tone="info" body="Run a market simulation for these people: five of them take the seats of one company for a fortnight.">
        <Btn small variant="outline" label="Simulations" onPress={() => router.push("/sim")} testID="go-simulations" />
      </Callout>

      <TitledCard icon="people" title={`People · ${members.length}`}>
        {members.map((m) => {
          const you = m.userId === me.userId;
          const leader = isLeader(m.role);
          return (
            <View key={m.userId} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 7 }} testID={`member-${m.userId}`}>
              <Avatar name={memberName(m)} uri={m.avatarUrl} size={32} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }} numberOfLines={1}>
                  {memberName(m)}{you ? <Text style={{ color: colors.textTertiary, fontFamily: fontFamily.regular }}> (you)</Text> : null}
                </Text>
                <Text style={{ color: colors.textTertiary, fontSize: font.xs }} numberOfLines={2}>
                  {leader || !m.permissions?.length
                    ? ROLE_HELP[m.role]
                    : `Can also: ${m.permissions.map(powerLabel).join(", ").toLowerCase()}`}
                </Text>
              </View>
              <Pill label={m.role} tone={m.role === "owner" ? "good" : "neutral"} />
              {you ? (
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Leave this company"
                  testID="leave-company"
                  disabled={leave.isPending}
                  onPress={() => Alert.alert(`Leave ${company.name}?`, "You lose access to everything in it.", [
                    { text: "Stay", style: "cancel" },
                    { text: "Leave", style: "destructive", onPress: () => leave.mutate(m.userId) },
                  ])}
                >
                  <Icon name="log-out-outline" size={18} color={colors.danger} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </TitledCard>
    </View>
  );
}

/**
 * A link handed to a colleague.
 *
 * Shown once and kept nowhere — the server's own comment says it keeps
 * nothing — so it goes straight to the clipboard, which on a phone is what
 * "copy this link" means. The role is chosen before it is made, because the
 * link *is* the role: the token carries it.
 */
function InviteLink({ companyId, canInviteAdmins, notify }: { companyId: string; canInviteAdmins: boolean; notify: (n: Notice) => void }) {
  const [role, setRole] = useState<"member" | "admin">("member");
  const [made, setMade] = useState<{ url: string; expiresAt: string } | null>(null);

  const make = useMutation({
    mutationFn: () => api<{ url: string; role: string; expiresAt: string }>(`/api/companies/${companyId}/invite-link`, { method: "POST", body: { role } }),
    onSuccess: async (r) => {
      setMade({ url: r.url, expiresAt: r.expiresAt });
      await Clipboard.setStringAsync(r.url).catch(() => {});
      notify({ text: "Invite link copied", tone: "success" });
    },
    onError: (e) => notify({ text: errText(e, "Couldn't make a link."), tone: "error" }),
  });

  const reset = useMutation({
    mutationFn: () => api(`/api/companies/${companyId}/invite-link/reset`, { method: "POST", body: {} }),
    onSuccess: () => {
      setMade(null);
      notify({ text: "Every link handed out so far has stopped working", tone: "success" });
    },
    onError: (e) => notify({ text: errText(e, "Couldn't reset the links."), tone: "error" }),
  });

  return (
    <TitledCard icon="link" title="Invite link">
      <Text style={text.meta}>Anyone with the link joins this company. It is shown once — the server keeps nothing.</Text>

      {canInviteAdmins ? (
        <Row gap={6} style={{ marginTop: spacing.xs }}>
          {(["member", "admin"] as const).map((r) => (
            <Pressable
              key={r}
              onPress={() => setRole(r)}
              testID={`invite-role-${r}`}
              style={{
                paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.sm, borderWidth: 1,
                borderColor: role === r ? colors.primary : colors.border,
                backgroundColor: role === r ? colors.primarySoft ?? "transparent" : "transparent",
              }}
            >
              <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: role === r ? colors.primary : colors.textSecondary }}>
                joins as {r}
              </Text>
            </Pressable>
          ))}
        </Row>
      ) : (
        <Text style={text.small}>Links you make join people as members. Only an owner or admin can make an admin link.</Text>
      )}

      {made ? (
        <View style={{ gap: 4, marginTop: spacing.xs }}>
          <Text style={{ color: colors.text, fontSize: font.xs, fontFamily: fontFamily.medium }} numberOfLines={2} testID="invite-url">{made.url}</Text>
          <Text style={text.small}>Copied. Works until {new Date(made.expiresAt).toLocaleDateString()}.</Text>
        </View>
      ) : null}

      <Row gap={spacing.sm} style={{ marginTop: spacing.sm }}>
        <Btn
          small
          label={made ? "New link" : "Make a link"}
          loading={make.isPending}
          onPress={() => make.mutate()}
          testID="make-invite-link"
        />
        <Btn
          small
          variant="danger"
          label="Stop all links"
          loading={reset.isPending}
          testID="reset-invite-links"
          onPress={() => Alert.alert(
            "Stop every invite link?",
            "Links already in chats and inboxes stop working. Anyone who still needs one has to be sent a new one.",
            [{ text: "Keep them", style: "cancel" }, { text: "Stop them", style: "destructive", onPress: () => reset.mutate() }],
          )}
        />
      </Row>
    </TitledCard>
  );
}
