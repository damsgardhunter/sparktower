import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { colors, font, fontFamily, spacing } from "../src/theme";
import { Btn, Empty, Loading, Screen, errText } from "../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../src/components/MoreKit";
import { Pill } from "../src/components/nova/Pill";
import { CountRow } from "../src/components/more/AdminKit";
import { NoticeBanner, useNotice } from "../src/components/Sheet";

/**
 * The companies you act for — the phone's half of `client/src/pages/companies.tsx`.
 *
 * The second slice of the Companies surface, and the one everything else needs:
 * seasons, challenges, scouting and members all hang off a company, and until
 * there is a list there is nowhere for any of them to be reached from.
 *
 * Deliberately a list and a page, not a console. Creating a company, editing
 * it, managing members and running a season are desk jobs — they are forms with
 * consequences, and the web has them. What a phone is for is knowing which
 * companies you are in, who else is in them, and whether the one you lead can
 * actually do things yet, which is the verification state.
 */

interface CompanyRow {
  id: string; name: string; slug: string;
  website: string | null; industry: string | null; size: string | null;
  description: string | null; projectId: string | null;
  verifiedDomain: string | null; verifiedAt: string | null; verifiedMethod: string | null;
  role: string; memberCount: number;
}

const TITLE = "Companies";

/** What `POST /api/company-invites/accept` answers with — see server/company-routes.ts. */
interface AcceptedInvite {
  companyId: string;
  name: string;
  role: string;
  alreadyMember: boolean;
}

export default function Companies() {
  const router = useRouter();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  /*
   * `?invite=<token>` is the web's own URL for this (`/companies?invite=…`), so
   * a link a company sends works the same whichever thing opens it — and a
   * deep link into the app lands on the screen that can accept it rather than
   * on a page that cannot.
   */
  const { invite } = useLocalSearchParams<{ invite?: string }>();
  const [pasted, setPasted] = useState("");

  const list = useQuery<{ companies: CompanyRow[] }>({
    queryKey: ["companies"],
    queryFn: () => api<{ companies: CompanyRow[] }>("/api/companies"),
  });

  /*
   * The token is signed rather than stored, so the server is the only thing
   * that can say whether it is good — and it carries the company, the role and
   * an expiry inside it. The phone sends it and reads the answer.
   */
  const accept = useMutation({
    mutationFn: (token: string) =>
      api<AcceptedInvite>("/api/company-invites/accept", { method: "POST", body: { token } }),
    onSuccess: (r) => {
      setPasted("");
      void qc.invalidateQueries({ queryKey: ["companies"] });
      // A link clicked twice, or one sent to somebody already on the team: the
      // server says so rather than treating it as a failure, and so do we.
      show({
        text: r.alreadyMember ? `You're already in ${r.name}.` : `You've joined ${r.name}.`,
        tone: "success",
      });
      if (r.companyId) router.replace(`/company/${r.companyId}`);
    },
    onError: (e) => show({ text: errText(e, "That invitation isn't valid any more."), tone: "error" }),
  });

  if (list.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: TITLE }} />
        <Loading />
      </View>
    );
  }

  const rows = list.data?.companies ?? [];

  return (
    <>
    <Screen>
      <Stack.Screen options={{ title: TITLE }} />
      <PageIntro icon="business" title={TITLE} body="The companies you act for, and what each one can do." />

      {/* An invitation that arrived as a link, offered before the list. */}
      {invite ? (
        <TitledCard icon="mail-open" title="You've been invited to a company">
          <Text style={{ color: colors.textSecondary, fontSize: font.sm }}>
            Accepting adds you to it with the role the invitation carries.
          </Text>
          <Btn
            label="Accept the invitation"
            style={{ marginTop: spacing.sm }}
            loading={accept.isPending}
            onPress={() => accept.mutate(String(invite))}
            testID="accept-company-invite"
          />
        </TitledCard>
      ) : (
        <TitledCard icon="mail" title="Been sent an invitation?">
          <Text style={{ color: colors.textSecondary, fontSize: font.sm }}>
            Paste the invitation link or code.
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
            <TextInput
              value={pasted}
              onChangeText={setPasted}
              placeholder="Invitation link or code"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                flex: 1, backgroundColor: colors.surfaceRaised, borderRadius: 8, borderWidth: 1,
                borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
                color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular,
              }}
              testID="input-company-invite"
            />
            <Btn
              label="Join"
              small
              loading={accept.isPending}
              disabled={!pasted.trim() || accept.isPending}
              /*
               * A whole link pasted, not just the token — somebody copies what
               * they were sent. The token is the last thing after `invite=`.
               */
              onPress={() => accept.mutate(pasted.trim().split("invite=").pop()!.trim())}
              testID="join-company-by-token"
            />
          </View>
        </TitledCard>
      )}

      {rows.length === 0 ? (
        <Empty
          icon="business-outline"
          title="No companies"
          body="A company is how a team runs training seasons, posts challenges and recruits. Starting one is on the web."
        />
      ) : rows.map((c) => (
        <TitledCard
          key={c.id}
          icon="business"
          title={c.name}
          action={<Pill label={c.role} tone={c.role === "owner" ? "good" : "neutral"} />}
        >
          {c.description ? (
            <Text style={{ color: colors.textSecondary, fontSize: font.sm }} numberOfLines={2}>{c.description}</Text>
          ) : null}
          <CountRow label="Members" value={c.memberCount} />
          {/*
            * The verification state, on the list rather than only on the page.
            * `publicCompany` puts it on the wire for a reason worth repeating:
            * without it "no screen can say what is missing, and a leader whose
            * company cannot post challenges has no way to find out why".
            */}
          <CountRow
            label="Domain"
            value={c.verifiedAt ? (c.verifiedDomain ?? "verified") : "not verified"}
            leading={<Pill label={c.verifiedAt ? "verified" : "unverified"} tone={c.verifiedAt ? "good" : "unknown"} />}
          />
          <Text
            onPress={() => router.push(`/company/${c.id}`)}
            style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.medium, marginTop: spacing.sm }}
            testID={`open-company-${c.id}`}
          >
            Open
          </Text>
        </TitledCard>
      ))}

      <Callout
        icon="desktop"
        tone="info"
        body="Starting a company, editing it, running a season and posting a challenge are on the web. They are forms with consequences and they want a keyboard."
      />
      <View style={{ height: spacing.xl }} />
    </Screen>
    <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
