/**
 * /invite/:token — where an invite link lands in the app.
 *
 * The same screen the web shows (client/src/pages/invite-accept.tsx): who is
 * inviting you to what, and one button. Signed out it says the same thing and
 * holds the token, because the person an invite is for often doesn't have an
 * account yet — and a link that dead-ends is the end of that referral.
 *
 * Accepting lands on the project's path rather than its member list: the point
 * of joining is the work, and the next step is the first thing on that screen.
 */
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, writePref } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Avatar, Btn, Loading } from "../../src/components/ui";

/** The same key the web uses (shared/invites.ts); mobile can't import from @shared. */
const PENDING_INVITE_KEY = "st_pending_invite";

interface InviteView {
  status: "pending" | "accepted" | "revoked" | "expired";
  role: string;
  expiresAt: string;
  project: { id: string; title: string; oneLiner: string | null; logoUrl: string | null };
  invitedBy: string;
  forEmail: string | null;
  viewerMatches: boolean | null;
}

const UNUSABLE: Record<Exclude<InviteView["status"], "pending">, string> = {
  accepted: "This invite has already been used.",
  revoked: "This invite was cancelled by the project owner.",
  expired: "This invite has expired. Ask whoever sent it for a new one.",
};

export default function InviteAccept() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<InviteView>({
    queryKey: ["invite", token],
    queryFn: () => api<InviteView>(`/api/invites/${encodeURIComponent(String(token))}`),
    enabled: !!token && !authLoading,
    retry: false,
  });

  /*
   * Held on the device, not just in this screen's state: someone signing up
   * from here goes through sign-in and onboarding first, and the link they
   * tapped is long gone by the time they come back.
   */
  useEffect(() => { if (token && !user) writePref(PENDING_INVITE_KEY, String(token)); }, [token, user]);

  const accept = async () => {
    setJoining(true);
    setProblem(null);
    try {
      const res = await api<{ projectId: string }>(`/api/invites/${encodeURIComponent(String(token))}/accept`, { method: "POST", body: {} });
      await writePref(PENDING_INVITE_KEY, null);
      router.replace(`/manage/${res.projectId}?joined=1` as any);
    } catch (e: any) {
      setProblem(e?.body?.message ?? e?.message ?? "Couldn't join that project.");
      setJoining(false);
    }
  };

  const body = () => {
    if (isLoading || authLoading) return <Loading />;
    if (error || !data) {
      return <Text style={s.note}>{(error as any)?.body?.message ?? "This invite link isn't valid."}</Text>;
    }
    return (
      <View style={{ gap: spacing.lg, alignItems: "center" }}>
        <Avatar name={data.project.title} uri={data.project.logoUrl} size={56} />
        <View style={{ gap: 6, alignItems: "center" }}>
          <Text style={s.title}>{data.invitedBy} invited you to {data.project.title}</Text>
          {!!data.project.oneLiner && <Text style={s.note}>{data.project.oneLiner}</Text>}
          <Text style={s.note}>as {data.role}</Text>
        </View>

        {data.status !== "pending" ? (
          <Text style={s.note} testID="invite-unusable">{UNUSABLE[data.status]}</Text>
        ) : !user ? (
          <View style={{ gap: spacing.sm, alignSelf: "stretch" }}>
            <Text style={s.note}>Sign in or create an account to join. We'll bring you back here.</Text>
            <Btn label="Sign in" onPress={() => router.push("/(auth)/sign-in" as any)} testID="invite-sign-in" />
          </View>
        ) : data.viewerMatches === false ? (
          // The invite names an address, and it isn't this account's: joining would silently use the wrong one.
          <Text style={s.note} testID="invite-wrong-account">
            This invite is for {data.forEmail}. Sign in with that account to accept it.
          </Text>
        ) : (
          <View style={{ gap: spacing.sm, alignSelf: "stretch" }}>
            <Btn label={joining ? "Joining…" : "Join the project"} icon="person-add-outline" onPress={accept} disabled={joining} loading={joining} testID="invite-accept" />
            {!!problem && <Text style={[s.note, { color: colors.danger }]}>{problem}</Text>}
          </View>
        )}
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: "Invite" }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xl, gap: spacing.lg }} style={{ backgroundColor: colors.canvas }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.borderSubtle }} testID="invite-accept-card">
          {body()}
        </View>
      </ScrollView>
    </>
  );
}

const s = {
  title: { fontFamily: fontFamily.bold, fontSize: font.lg, color: colors.text, textAlign: "center" as const },
  note: { fontFamily: fontFamily.regular, fontSize: font.sm, color: colors.textSecondary, textAlign: "center" as const, lineHeight: 20 },
};
