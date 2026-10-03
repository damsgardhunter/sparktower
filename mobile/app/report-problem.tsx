import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { colors, spacing } from "../src/theme";
import { Body, Btn, Field, H1, Meta, Section } from "../src/components/ui";
import { NoticeBanner, useNotice } from "../src/components/Sheet";
import { PROBLEM_MESSAGE_MAX, readProblemMessage, readProblemPath } from "../src/problemReport";

/**
 * "Is there a problem? Report it" — the phone's half of the web's report button.
 *
 * The web puts this in every footer and on every screen. The phone has no footer,
 * so it lives in the More menu and takes a `path` so a caller can say where the
 * person was: `/report-problem?path=/project/123` keeps the one fact that makes a
 * report reproducible without having to ask.
 *
 * ## Signed out as well as in
 *
 * `POST /api/problem-reports` deliberately takes no session — the person best
 * placed to tell you the sign-in screen is broken is the one who cannot get past
 * it. So this screen does not check for a user, and `api` is used without a token
 * on purpose. It sends a message and a path and nothing else.
 */
export default function ReportProblemScreen() {
  const params = useLocalSearchParams<{ path?: string }>();
  const [message, setMessage] = useState("");
  const { notice, show, clear } = useNotice();

  /*
   * Checked here against the phone's mirror of the server's rule
   * (`src/problemReport.ts`) so a message too short to be useful does not cost a
   * round trip to be told so — which, on a bad connection, is where a report gets
   * abandoned. The server still checks.
   */
  const read = readProblemMessage(message);

  const send = useMutation({
    mutationFn: async () => {
      if (!read.ok) throw new Error(read.reason);
      await api("/api/problem-reports", {
        method: "POST",
        body: { message: read.message, path: readProblemPath(params.path) || undefined },
      });
    },
    onSuccess: () => {
      show({ text: "Thank you — that's in the queue.", tone: "success" });
      setMessage("");
      /* Back where they were, rather than leaving them on a form they have finished with. */
      setTimeout(() => router.canGoBack() && router.back(), 900);
    },
    onError: (e: any) => show({ text: e?.message || "Couldn't send that. Try again in a moment.", tone: "error" }),
  });

  return (
    <>
      <Stack.Screen options={{ title: "Report a problem" }} />
      <NoticeBanner notice={notice} onDismiss={clear} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
        keyboardShouldPersistTaps="handled"
      >
        <H1>Is there a problem? Report it</H1>
        <Body style={{ marginTop: spacing.sm, color: colors.textSecondary }}>
          Tell us what went wrong — a sentence is plenty. It goes straight to a queue we read,
          and you do not need an account to send one.
        </Body>

        <Section>
          <Field
            label="What happened"
            value={message}
            onChangeText={setMessage}
            multiline
            placeholder="The Save button on my project does nothing, and nothing appears in the feed."
            maxLength={PROBLEM_MESSAGE_MAX}
            testID="input-problem-message"
          />
          <Meta style={{ textAlign: "right", marginTop: -spacing.sm }}>
            {message.trim().length}/{PROBLEM_MESSAGE_MAX}
          </Meta>
        </Section>

        {readProblemPath(params.path) ? (
          <Meta style={{ marginTop: spacing.sm }}>
            Sent with the screen you came from ({readProblemPath(params.path)}), so we can
            reproduce it.
          </Meta>
        ) : null}

        <View style={{ marginTop: spacing.lg }}>
          <Btn
            label={send.isPending ? "Sending…" : "Send report"}
            onPress={() => send.mutate()}
            /*
             * Disabled on the mirrored rule rather than on length alone, so the
             * button and the server agree about what counts as a report.
             */
            disabled={!read.ok || send.isPending}
            testID="button-send-problem"
          />
        </View>
      </ScrollView>
    </>
  );
}
