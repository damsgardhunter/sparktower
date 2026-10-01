import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, spacing } from "../../src/theme";
import { Empty, Loading, Screen, errText } from "../../src/components/ui";
import { PageIntro, TitledCard } from "../../src/components/MoreKit";
import { Pill } from "../../src/components/nova/Pill";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { ChoiceList, NotFoundScreen, gateView, isNotFound, text, useReviewer } from "../../src/components/more/AdminKit";

/**
 * What people have told us is broken — the phone's half of
 * `client/src/pages/admin-problems.tsx`.
 *
 * Deliberately not the content-report console (`admin/reports.tsx`): that one
 * is about people and posts and ends in a moderation decision, this is about
 * the product and ends in a fix. They are read by different people looking for
 * different things, and putting a screen that will not load in the same queue
 * as an abuse report is how both get read badly.
 *
 * A list of sentences with the page each came from. No assignment, no priority,
 * no severity — four states and a note, because a triage system with more
 * moving parts than reports is a way of not reading them. That restraint is the
 * design, so the phone keeps it rather than adding a filter nobody asked for.
 */

/**
 * `shared/problem-reports.ts`, restated — Metro will not resolve `@shared`.
 * `mobile-restatements.test.ts` reads both and fails when they disagree, which
 * matters here because a status the server does not know is a 400 the admin
 * sees as "couldn't update that".
 */
const PROBLEM_STATUSES = ["new", "looking", "fixed", "not-a-bug"] as const;
type ProblemStatus = (typeof PROBLEM_STATUSES)[number];
const PROBLEM_STATUS_COPY: Record<ProblemStatus, { label: string; blurb: string }> = {
  new: { label: "New", blurb: "Nobody has read this yet." },
  looking: { label: "Looking", blurb: "Someone is on it." },
  fixed: { label: "Fixed", blurb: "Shipped, or was never broken again." },
  "not-a-bug": { label: "Not a bug", blurb: "Working as intended, or too little to act on." },
};

const TONE: Record<ProblemStatus, "info" | "warn" | "good" | "neutral"> = {
  new: "info", looking: "warn", fixed: "good", "not-a-bug": "neutral",
};

interface ProblemRow {
  id: string;
  message: string;
  path: string | null;
  userAgent: string | null;
  status: ProblemStatus;
  note: string | null;
  createdAt: string;
  handledAt: string | null;
  userId: string | null;
  email: string | null;
}

const TITLE = "Problem reports";

export default function AdminProblems() {
  const { loading, isReviewer } = useReviewer();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const [open, setOpen] = useState<string | null>(null);

  /*
   * `{ reports, counts }` — not `{ rows }`. The route sends per-status counts
   * alongside the list, which is where the "N new" above comes from rather than
   * from counting the page we happen to have been given.
   */
  const list = useQuery<{ reports: ProblemRow[]; counts: Record<ProblemStatus, number> }>({
    queryKey: ["admin-problems"],
    queryFn: () => api<{ reports: ProblemRow[]; counts: Record<ProblemStatus, number> }>("/api/admin/problem-reports"),
    retry: false,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProblemStatus }) =>
      api(`/api/admin/problem-reports/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ["admin-problems"] });
      show({ text: `Marked ${PROBLEM_STATUS_COPY[v.status].label.toLowerCase()}.`, tone: "success" });
    },
    onError: (e) => show({ text: errText(e, "Couldn't update that report."), tone: "error" }),
  });

  const gate = gateView(TITLE, loading, isReviewer);
  if (gate) return gate;
  if (isNotFound(list.error)) return <NotFoundScreen title={TITLE} />;

  const rows = list.data?.reports ?? [];
  const unread = list.data?.counts?.new ?? 0;

  return (
    <>
      <Screen>
        <Stack.Screen options={{ title: TITLE }} />
        <PageIntro
          icon="warning"
          title={TITLE}
          body="What people have told us is broken. Four states and a note — this ends in a fix, not a moderation decision."
          right={unread > 0 ? <Pill label={`${unread} new`} tone="info" /> : undefined}
        />

        {list.isLoading ? <Loading /> : rows.length === 0 ? (
          <Empty icon="checkmark-circle-outline" title="Nothing reported" body="Nobody has told us anything is broken." />
        ) : rows.map((r) => {
          const copy = PROBLEM_STATUS_COPY[r.status] ?? { label: r.status, blurb: "" };
          const isOpen = open === r.id;
          return (
            <TitledCard
              key={r.id}
              title={new Date(r.createdAt).toLocaleDateString()}
              action={<Pill label={copy.label} tone={TONE[r.status] ?? "neutral"} />}
            >
              <Text style={[text.body, { fontFamily: fontFamily.medium }]} testID={`problem-message-${r.id}`}>
                {r.message}
              </Text>

              {/*
                * The page it came from is most of the triage. A sentence like
                * "it won't load" is a different report depending on which
                * screen said it.
                */}
              {r.path ? <Text style={text.small}>on {r.path}</Text> : null}
              {r.email ? <Text style={text.small}>from {r.email}</Text> : null}
              {r.note ? <Text style={[text.meta, { marginTop: 4 }]}>Note: {r.note}</Text> : null}

              {isOpen ? (
                <View style={{ marginTop: spacing.sm, gap: 6 }}>
                  <Text style={text.small}>{copy.blurb}</Text>
                  <ChoiceList
                    options={PROBLEM_STATUSES.map((s) => ({
                      id: s,
                      label: PROBLEM_STATUS_COPY[s].label,
                      detail: PROBLEM_STATUS_COPY[s].blurb,
                    }))}
                    value={r.status}
                    onChange={(status) => setStatus.mutate({ id: r.id, status })}
                    disabled={setStatus.isPending}
                  />
                  {/*
                    * Writing a note is on the web. The field is a paragraph of
                    * explanation for whoever picks the report up, and a phone
                    * keyboard over a list is the wrong place to write one.
                    */}
                  <Text style={text.small}>Adding a note is on the web console.</Text>
                </View>
              ) : null}

              <Pressable onPress={() => setOpen(isOpen ? null : r.id)} testID={`problem-toggle-${r.id}`}>
                <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.medium, marginTop: spacing.sm }}>
                  {isOpen ? "Done" : "Change state"}
                </Text>
              </Pressable>
            </TitledCard>
          );
        })}

        <View style={{ height: spacing.xl }} />
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
