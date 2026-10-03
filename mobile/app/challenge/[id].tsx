import { useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Loading, Screen, errText } from "../../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../../src/components/MoreKit";
import { Pill } from "../../src/components/nova/Pill";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { NotFoundScreen, isNotFound, text } from "../../src/components/more/AdminKit";

/**
 * One challenge, and entering it.
 *
 * `shared/challenges.ts`, restated — Metro will not resolve `@shared`, and
 * `mobile-restatements.test.ts` reads both sides. These matter: a pitch one
 * character under the minimum is a 400 the entrant reads as "couldn't send
 * that", so the form has to enforce the same floor the server does and say so
 * before the tap rather than after.
 */
const ENTRY_LIMITS = {
  title: { min: 3, max: 120 },
  pitch: { min: 50, max: 3000 },
  link: { max: 500 },
} as const;

interface Entry {
  id: string; title: string; pitch: string; link: string | null; projectId: string | null;
  status: string; feedback: string | null; createdAt: string;
}
interface Detail {
  id: string; title: string; brief: string; criteria: string | null; prize: string | null;
  terms: string | null; industry: string | null; deadline: string; createdAt: string;
  status: "open" | "judging" | "closed";
  acceptingEntries: boolean;
  company: { id: string; name: string; industry: string | null; website: string | null; verifiedDomain: string | null };
  entryCount: number;
  myEntry: Entry | null;
  isSponsor: boolean;
  winners: unknown[];
  prizeHeld: { amountCents: number; state: string } | null;
}

export default function ChallengeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();

  const q = useQuery<Detail>({
    queryKey: ["challenge", id],
    queryFn: () => api<Detail>(`/api/challenges/${id}`),
    enabled: !!id,
    retry: false,
  });

  const [title, setTitle] = useState("");
  const [pitch, setPitch] = useState("");
  const [link, setLink] = useState("");
  const [accepted, setAccepted] = useState(false);

  const enter = useMutation({
    mutationFn: () =>
      api(`/api/challenges/${id}/enter`, {
        method: "POST",
        body: { acceptTerms: true, title, pitch, link: link.trim() || undefined },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["challenge", id] });
      void qc.invalidateQueries({ queryKey: ["challenges"] });
      show({ text: "Entered.", tone: "success" });
    },
    onError: (e) => show({ text: errText(e, "Couldn't enter that."), tone: "error" }),
  });

  const withdraw = useMutation({
    mutationFn: () => api(`/api/challenges/${id}/entry`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["challenge", id] });
      show({ text: "Entry withdrawn.", tone: "success" });
    },
    onError: (e) => show({ text: errText(e, "Couldn't withdraw that."), tone: "error" }),
  });

  if (isNotFound(q.error)) return <NotFoundScreen title="Challenge" />;
  if (q.isLoading || !q.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: "Challenge" }} />
        <Loading />
      </View>
    );
  }

  const c = q.data;
  const titleOk = title.trim().length >= ENTRY_LIMITS.title.min && title.trim().length <= ENTRY_LIMITS.title.max;
  const pitchLen = pitch.trim().length;
  const pitchOk = pitchLen >= ENTRY_LIMITS.pitch.min && pitchLen <= ENTRY_LIMITS.pitch.max;
  const canSend = titleOk && pitchOk && accepted && !enter.isPending;

  const field = {
    backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text,
    fontSize: font.sm, fontFamily: fontFamily.regular,
  } as const;

  return (
    <>
      <Screen>
        <Stack.Screen options={{ title: c.title }} />
        <PageIntro
          icon="trophy"
          title={c.title}
          body={c.prize ? `Prize: ${c.prize}` : undefined}
          right={<Pill label={c.status} tone={c.acceptingEntries ? "info" : "neutral"} />}
        />

        {/* Who is asking. A domain has been checked; a name has not. */}
        <TitledCard icon="business" title={c.company.name}>
          {c.company.verifiedDomain
            ? <Pill label={c.company.verifiedDomain} icon="checkmark-circle" tone="good" />
            : <Pill label="domain not verified" tone="unknown" />}
          {/*
            * The money as it actually stands, not as the company described it.
            * This is the claim the escrow exists to let a screen make.
            */}
          {c.prizeHeld ? (
            <Text style={[text.body, { marginTop: 6 }]}>
              Prize held in escrow: ${(c.prizeHeld.amountCents / 100).toFixed(2)} ({c.prizeHeld.state})
            </Text>
          ) : (
            <Text style={[text.small, { marginTop: 6 }]}>No prize is held in escrow for this one.</Text>
          )}
        </TitledCard>

        <TitledCard icon="document-text" title="The brief">
          <Text style={text.body}>{c.brief}</Text>
          {c.criteria ? (
            <>
              <Text style={[text.small, { marginTop: spacing.sm }]}>How it will be judged</Text>
              <Text style={text.body}>{c.criteria}</Text>
            </>
          ) : null}
          <Text style={text.small}>
            {c.entryCount} {c.entryCount === 1 ? "entry" : "entries"} · closes {new Date(c.deadline).toLocaleDateString()}
          </Text>
        </TitledCard>

        {c.myEntry ? (
          <TitledCard icon="checkmark-circle" title="Your entry" action={<Pill label={c.myEntry.status} tone="good" />}>
            <Text style={[text.body, { fontFamily: fontFamily.medium }]}>{c.myEntry.title}</Text>
            <Text style={text.body}>{c.myEntry.pitch}</Text>
            {c.myEntry.feedback ? (
              <Callout icon="chatbubble" tone="info" title="Feedback from the company" body={c.myEntry.feedback} />
            ) : null}
            {c.acceptingEntries ? (
              <Btn
                label="Withdraw"
                variant="outline"
                style={{ marginTop: spacing.sm }}
                loading={withdraw.isPending}
                onPress={() => withdraw.mutate()}
                testID="withdraw-entry"
              />
            ) : (
              <Text style={text.small}>Entries are closed, so this one stays as it is. Editing it is on the web.</Text>
            )}
          </TitledCard>
        ) : c.isSponsor ? (
          <Callout icon="information-circle" body="You act for the company running this, so you can't enter it." />
        ) : !c.acceptingEntries ? (
          <Callout icon="time" body="This one is no longer taking entries." />
        ) : (
          <TitledCard icon="create" title="Enter">
            <Text style={text.small}>A title</Text>
            <TextInput value={title} onChangeText={setTitle} maxLength={ENTRY_LIMITS.title.max}
              placeholder="What you are putting forward" placeholderTextColor={colors.textTertiary}
              style={field} testID="input-entry-title" />

            <Text style={[text.small, { marginTop: spacing.sm }]}>Your pitch</Text>
            <TextInput value={pitch} onChangeText={setPitch} multiline maxLength={ENTRY_LIMITS.pitch.max}
              placeholder="What you would do, and why you" placeholderTextColor={colors.textTertiary}
              style={[field, { minHeight: 120 }]} testID="input-entry-pitch" />
            {/*
              * The floor, before the tap. The server refuses a pitch under
              * fifty characters and the entrant would read that refusal as
              * "couldn't send that".
              */}
            <Text style={[text.small, pitchLen > 0 && !pitchOk ? { color: colors.danger } : null]}>
              {pitchLen < ENTRY_LIMITS.pitch.min
                ? `${ENTRY_LIMITS.pitch.min - pitchLen} more characters needed`
                : `${pitchLen} of ${ENTRY_LIMITS.pitch.max}`}
            </Text>

            <Text style={[text.small, { marginTop: spacing.sm }]}>A link (optional)</Text>
            <TextInput value={link} onChangeText={setLink} maxLength={ENTRY_LIMITS.link.max}
              autoCapitalize="none" keyboardType="url"
              placeholder="Something to look at" placeholderTextColor={colors.textTertiary}
              style={field} testID="input-entry-link" />

            {/*
              * The terms are the company's, and the server refuses an entry
              * that has not accepted them. Shown rather than linked, because
              * accepting something you were not given is not accepting.
              */}
            {c.terms ? (
              <View style={{ marginTop: spacing.md, gap: 6 }}>
                <Text style={text.small}>The company's terms for this challenge</Text>
                <Text style={[text.body, { color: colors.textSecondary }]}>{c.terms}</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }}>
              <Switch value={accepted} onValueChange={setAccepted} trackColor={{ true: colors.primary, false: colors.border }} testID="switch-accept-terms" />
              <Text style={[text.body, { flex: 1 }]}>I accept these terms</Text>
            </View>

            <Btn
              label="Enter"
              style={{ marginTop: spacing.md }}
              loading={enter.isPending}
              disabled={!canSend}
              onPress={() => enter.mutate()}
              testID="submit-entry"
            />
          </TitledCard>
        )}

        <View style={{ height: spacing.xl }} />
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
