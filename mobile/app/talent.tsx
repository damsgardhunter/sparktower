import { useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../src/theme";
import { Btn, Empty, Loading, Screen, errText } from "../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../src/components/MoreKit";
import { Pill } from "../src/components/nova/Pill";
import { NoticeBanner, useNotice } from "../src/components/Sheet";

/**
 * Being scouted, and answering — the phone's half of
 * `client/src/pages/talent.tsx`, and the first slice of the Companies surface
 * to reach the phone.
 *
 * The Companies surface is 55 routes across seven files: company accounts,
 * private training seasons, sponsored challenges, scouting, domain
 * verification. None of it was on the phone. This is the slice that stands on
 * its own, because it is the only part that does not need a company page to
 * exist first — you do not run a company to be recruited by one.
 *
 * It is also the half that is actually phone-shaped. A company decides to
 * recruit somebody at a desk, with a track record open in front of them. The
 * person being recruited gets a notification and answers it from wherever they
 * are, and until now they could not: the invite existed, the route existed, and
 * the phone had no way to see or answer it.
 *
 * Two things, in the order they matter:
 *
 *   - **your answer to an invitation**, because somebody is waiting on it;
 *   - **whether you can be found at all**, which is a privacy control and reads
 *     as one: off by default on the server (`open: row?.open ?? false`), so
 *     nobody is in a recruiting pool they did not opt into.
 */

interface Profile {
  open: boolean;
  headline: string | null;
  roles: string[];
  location: string | null;
  remote: boolean;
  updatedAt: string | null;
}
interface Invite {
  id: string;
  role: string | null;
  message: string | null;
  status: "sent" | "accepted" | "declined" | string;
  createdAt: string;
  answeredAt: string | null;
  sentBy: string | null;
  company: { id: string; name: string; logoUrl?: string | null } | null;
}

const TITLE = "Being scouted";

export default function Talent() {
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();

  const me = useQuery<{ profile: Profile; record: unknown }>({
    queryKey: ["talent-me"],
    queryFn: () => api<{ profile: Profile; record: unknown }>("/api/talent/me"),
  });
  const invites = useQuery<{ invites: Invite[] }>({
    queryKey: ["talent-invites"],
    queryFn: () => api<{ invites: Invite[] }>("/api/talent/invites"),
  });

  const [headline, setHeadline] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (patch: Partial<Pick<Profile, "open" | "headline" | "remote">>) =>
      api("/api/talent/me", { method: "PUT", body: patch }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["talent-me"] });
      show({ text: "Saved.", tone: "success" });
    },
    onError: (e) => show({ text: errText(e, "Couldn't save that."), tone: "error" }),
  });

  const answer = useMutation({
    /* The route takes a boolean and nothing else: "Say yes or no." */
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      api(`/api/talent/invites/${id}/answer`, { method: "POST", body: { accept } }),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ["talent-invites"] });
      show({ text: v.accept ? "Accepted — they can message you now." : "Declined.", tone: "success" });
    },
    /* 409 when it has already been answered, which two taps can produce. */
    onError: (e) => show({ text: errText(e, "Couldn't send that answer."), tone: "error" }),
  });

  if (me.isLoading || !me.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: TITLE }} />
        <Loading />
      </View>
    );
  }

  const p = me.data.profile;
  const waiting = (invites.data?.invites ?? []).filter((i) => i.status === "sent");
  const answered = (invites.data?.invites ?? []).filter((i) => i.status !== "sent");

  return (
    <>
      <Screen>
        <Stack.Screen options={{ title: TITLE }} />
        <PageIntro
          icon="people"
          title={TITLE}
          body="Companies can find builders by what they have actually done. This is whether they can find you, and who has asked."
          right={waiting.length > 0 ? <Pill label={`${waiting.length} waiting`} tone="info" /> : undefined}
        />

        {/* Somebody is waiting on an answer, so it goes first. */}
        <TitledCard icon="mail" title={waiting.length ? "Waiting on you" : "Invitations"}>
          {invites.isLoading ? <Loading /> : waiting.length === 0 ? (
            <Text style={{ color: colors.textSecondary, fontSize: font.sm }}>
              Nothing waiting. {p.open ? "Companies can find you." : "Companies can't find you yet — the switch below."}
            </Text>
          ) : waiting.map((i) => (
            <View key={i.id} style={{ gap: 6, paddingVertical: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
              <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>
                {i.company?.name ?? "A company"}
              </Text>
              {i.role ? <Pill label={i.role} tone="info" /> : null}
              {i.message ? <Text style={{ color: colors.textSecondary, fontSize: font.sm }}>{i.message}</Text> : null}
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: 4 }}>
                <Btn
                  label="Accept"
                  style={{ flex: 1 }}
                  loading={answer.isPending && answer.variables?.id === i.id && answer.variables.accept}
                  onPress={() => answer.mutate({ id: i.id, accept: true })}
                  testID={`accept-${i.id}`}
                />
                <Btn
                  label="Decline"
                  variant="outline"
                  style={{ flex: 1 }}
                  loading={answer.isPending && answer.variables?.id === i.id && !answer.variables.accept}
                  onPress={() => answer.mutate({ id: i.id, accept: false })}
                  testID={`decline-${i.id}`}
                />
              </View>
              {/*
                * Said before the tap, not after: accepting opens a direct
                * conversation, which is a different thing from being on a list.
                */}
              <Text style={{ color: colors.textTertiary, fontSize: font.xs }}>
                Accepting lets them message you directly.
              </Text>
            </View>
          ))}
        </TitledCard>

        {/* The privacy control, and it reads as one. */}
        <TitledCard icon="eye" title="Can companies find you?">
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
            <Text style={{ color: colors.text, fontSize: font.sm, flex: 1 }}>
              {p.open ? "Yes — companies can see your track record and ask." : "No. Nobody can find you here."}
            </Text>
            <Switch
              value={p.open}
              disabled={save.isPending}
              onValueChange={(open) => save.mutate({ open })}
              trackColor={{ true: colors.primary, false: colors.border }}
              testID="switch-talent-open"
            />
          </View>
          <Text style={{ color: colors.textTertiary, fontSize: font.xs, marginTop: 6 }}>
            Off unless you turn it on. What a company sees is what you have actually finished — not
            a CV you wrote.
          </Text>
        </TitledCard>

        {p.open ? (
          <TitledCard icon="create" title="What they see first">
            <TextInput
              value={headline ?? p.headline ?? ""}
              onChangeText={setHeadline}
              placeholder="One line: what you build"
              placeholderTextColor={colors.textTertiary}
              maxLength={140}
              style={{
                backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
                paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text,
                fontSize: font.sm, fontFamily: fontFamily.regular,
              }}
              testID="input-talent-headline"
            />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm }}>
              <Text style={{ color: colors.text, fontSize: font.sm }}>Open to remote</Text>
              <Switch
                value={p.remote}
                disabled={save.isPending}
                onValueChange={(remote) => save.mutate({ remote })}
                trackColor={{ true: colors.primary, false: colors.border }}
                testID="switch-talent-remote"
              />
            </View>
            {headline != null && headline !== (p.headline ?? "") ? (
              <Btn
                label="Save headline"
                style={{ marginTop: spacing.sm }}
                loading={save.isPending}
                onPress={() => save.mutate({ headline })}
                testID="save-talent-headline"
              />
            ) : null}
            {p.roles.length ? (
              <Text style={{ color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.sm }}>
                Roles: {p.roles.join(", ")}. Editing the list is on the web.
              </Text>
            ) : null}
          </TitledCard>
        ) : null}

        {answered.length ? (
          <TitledCard icon="time" title="Already answered">
            {answered.map((i) => (
              <View key={i.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 }}>
                <Pill label={i.status} tone={i.status === "accepted" ? "good" : "neutral"} />
                <Text style={{ color: colors.textSecondary, fontSize: font.sm, flex: 1 }} numberOfLines={1}>
                  {i.company?.name ?? "A company"}
                </Text>
              </View>
            ))}
          </TitledCard>
        ) : null}

        <Callout
          icon="desktop"
          tone="info"
          body="Running a company — seasons, challenges, scouting and members — is on the web. This screen is the other side of it: whether you can be found, and answering when you are."
        />
        <View style={{ height: spacing.xl }} />
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
