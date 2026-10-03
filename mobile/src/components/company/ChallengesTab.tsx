/**
 * The challenges a company sponsors — the phone's half of
 * client/src/components/company/challenges-tab.tsx.
 *
 * The founder's side was already here (`app/challenges.tsx`): browse them,
 * enter one, change or withdraw an entry. The company's side was not, so all
 * seven of the sponsor's routes had no phone caller — a company could not see
 * its own entries, let alone shortlist one.
 *
 * The judging half is what a phone is actually for. Reading entries, closing
 * them, shortlisting and announcing are decisions somebody makes in gaps
 * between other things, and they move no money.
 *
 * Posting is here too, with one thing worth knowing: the server's refusal for
 * an unaffordable challenge is a 402 carrying `insufficient_balance`, and the
 * app's global paywall only opens for `payment_required`. So this does not
 * assume a paywall appears — it shows the server's sentence, which already
 * says what posting needs, what the balance is, and what to do.
 */
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Btn, Field, Loading, Row, errText, timeAgo } from "../ui";
import { Callout, TitledCard } from "../MoreKit";
import { Pill } from "../nova/Pill";
import { text } from "../more/AdminKit";
import { Sheet, type Notice } from "../Sheet";
import { hasPower } from "../../companies";
import { CHALLENGE_LIMITS, ENTRY_LIMITS, CHALLENGE_FEE_CENTS, money } from "../../challenges";
import { companyKey, type CompanyView } from "./kit";

interface Challenge {
  id: string; title: string; brief: string; criteria: string | null; prize: string | null;
  terms: string; industry: string | null; deadline: string; status: "open" | "judging" | "closed";
  acceptingEntries: boolean; entryCount: number;
}

interface Entry {
  id: string; userId: string; title: string; pitch: string; link: string | null;
  status: "entered" | "shortlisted" | "winner" | "withdrawn";
  feedback: string | null; entrantName: string; createdAt: string;
  project: { id: string; title: string | null } | null;
}

const STATUS_TONE = { open: "good", judging: "warn", closed: "neutral" } as const;

export function ChallengesTab({ companyId, notify }: { companyId: string; notify: (n: Notice) => void }) {
  const { data: view } = useQuery<CompanyView>({ queryKey: companyKey(companyId) });
  const [posting, setPosting] = useState(false);
  const [open, setOpen] = useState<Challenge | null>(null);

  const key = ["company-challenges", companyId];
  const q = useQuery({ queryKey: key, queryFn: () => api<Challenge[]>(`/api/companies/${companyId}/challenges`) });

  if (!view) return null;
  const mayRun = hasPower(view.me, "challenges");
  const verified = !!view.company.verifiedDomain;

  return (
    <View style={{ gap: spacing.md }}>
      {!verified ? (
        <Callout
          icon="alert-circle"
          tone="warn"
          title="Verify the domain first"
          body="Only a company that has proved its website can post a challenge. That is the surface where being able to check who is asking is the whole of the protection."
        />
      ) : null}
      {verified && !mayRun ? (
        <Callout icon="eye" tone="info" body="You can read the challenges and the entries. Posting and judging need the Run challenges power." />
      ) : null}

      <TitledCard icon="trophy" title={`Challenges · ${q.data?.length ?? 0}`}>
        {q.isLoading ? <Loading /> : null}
        {q.data && !q.data.length ? <Text style={text.small}>None posted yet.</Text> : null}
        {(q.data ?? []).map((c) => (
          <Pressable
            key={c.id}
            onPress={() => setOpen(c)}
            testID={`challenge-${c.id}`}
            style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border, gap: 3 }}
          >
            <Row between center>
              <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }} numberOfLines={1}>{c.title}</Text>
              <Pill label={c.status} tone={STATUS_TONE[c.status]} />
            </Row>
            <Text style={{ color: colors.textTertiary, fontSize: font.xs }}>
              {c.entryCount} {c.entryCount === 1 ? "entry" : "entries"}
              {c.acceptingEntries ? ` · open until ${new Date(c.deadline).toLocaleDateString()}` : ` · deadline ${timeAgo(c.deadline)}`}
            </Text>
          </Pressable>
        ))}
        {mayRun && verified ? (
          <Btn label="Post a challenge" onPress={() => setPosting(true)} testID="post-challenge" style={{ marginTop: spacing.sm }} />
        ) : null}
      </TitledCard>

      {posting ? <PostChallenge companyId={companyId} onClose={() => setPosting(false)} notify={notify} /> : null}
      {open ? <ChallengeSheet companyId={companyId} challenge={open} mayRun={mayRun} onClose={() => setOpen(null)} notify={notify} /> : null}
    </View>
  );
}

/**
 * Posting one. Three gates on the server and each closes a different half of
 * the same hole: a verified domain, a fee so it is a decision rather than a
 * reflex, and the prize taken up front so an entrant is told "already paid in"
 * rather than "the company says".
 *
 * Validated here against the same limits, so the long fields are not typed
 * twice. The server validates again and its message wins.
 */
function PostChallenge({ companyId, onClose, notify }: { companyId: string; onClose: () => void; notify: (n: Notice) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: "", brief: "", criteria: "", prize: "", terms: "", prizeCents: "" });
  const [days, setDays] = useState("30");

  const set = (k: keyof typeof f) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));

  const post = useMutation({
    mutationFn: () => {
      const deadline = new Date(Date.now() + Math.max(1, Number(days) || 30) * 86_400_000).toISOString();
      return api(`/api/companies/${companyId}/challenges`, {
        method: "POST",
        body: {
          title: f.title.trim(), brief: f.brief.trim(), terms: f.terms.trim(),
          criteria: f.criteria.trim() || undefined, prize: f.prize.trim() || undefined,
          prizeCents: Math.round((Number(f.prizeCents) || 0) * 100),
          deadline,
        },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["company-challenges", companyId] });
      notify({ text: "Posted. The prize is held until you announce.", tone: "success" });
      onClose();
    },
    /*
     * The server's sentence, kept. For an unaffordable challenge it says what
     * posting needs, what the fee is, what is held for the prize and what the
     * balance is — and it is a 402 the global paywall does not open for,
     * because that only fires on `payment_required`.
     */
    onError: (e) => notify({ text: errText(e, "Couldn't post that."), tone: "error" }),
  });

  const short = (v: string, lim: { min: number; max: number }) => v.trim().length < lim.min;
  const incomplete = short(f.title, CHALLENGE_LIMITS.title) || short(f.brief, CHALLENGE_LIMITS.brief) || short(f.terms, CHALLENGE_LIMITS.terms);

  return (
    <Sheet visible onClose={onClose} title="Post a challenge" subtitle={`${money(CHALLENGE_FEE_CENTS)} to post, plus the prize held until you announce`}>
      <View style={{ gap: spacing.sm }}>
        <Field label="Title" value={f.title} onChangeText={set("title")} maxLength={CHALLENGE_LIMITS.title.max} testID="challenge-title" />
        <Field label="The brief" value={f.brief} onChangeText={set("brief")} multiline maxLength={CHALLENGE_LIMITS.brief.max} placeholder="What you want solved, and why." testID="challenge-brief" />
        <Field label="How you'll judge it (optional)" value={f.criteria} onChangeText={set("criteria")} multiline maxLength={CHALLENGE_LIMITS.criteria.max} testID="challenge-criteria" />
        <Field label="Terms" value={f.terms} onChangeText={set("terms")} multiline maxLength={CHALLENGE_LIMITS.terms.max} placeholder="What entrants are agreeing to with your company." testID="challenge-terms" />
        <Field label="Prize in dollars" value={f.prizeCents} onChangeText={set("prizeCents")} numeric testID="challenge-prize-cents" />
        <Field label="Anything the money can't say (optional)" value={f.prize} onChangeText={set("prize")} maxLength={CHALLENGE_LIMITS.prize.max} placeholder="and a call with our CTO" testID="challenge-prize-words" />
        <Field label="Days until the deadline" value={days} onChangeText={setDays} numeric testID="challenge-days" />
        <Text style={text.small}>
          At most {CHALLENGE_LIMITS.maxDeadlineDays} days. The brief and the terms both need at least {CHALLENGE_LIMITS.brief.min} characters.
        </Text>
        <Btn label="Post it" loading={post.isPending} disabled={incomplete} onPress={() => post.mutate()} testID="submit-challenge" />
      </View>
    </Sheet>
  );
}

/** One challenge: its entries, and the three moves a sponsor makes. */
function ChallengeSheet({
  companyId, challenge, mayRun, onClose, notify,
}: {
  companyId: string; challenge: Challenge; mayRun: boolean; onClose: () => void; notify: (n: Notice) => void;
}) {
  const qc = useQueryClient();
  const [judging, setJudging] = useState<Entry | null>(null);
  const base = `/api/companies/${companyId}/challenges/${challenge.id}`;

  const entries = useQuery({
    queryKey: ["company-challenge-entries", companyId, challenge.id],
    queryFn: () => api<Entry[]>(`${base}/entries`),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["company-challenges", companyId] });
    void qc.invalidateQueries({ queryKey: ["company-challenge-entries", companyId, challenge.id] });
  };

  const closeEntries = useMutation({
    mutationFn: () => api(`${base}/close-entries`, { method: "POST", body: {} }),
    onSuccess: () => { refresh(); notify({ text: "Entries closed. Judging now.", tone: "success" }); },
    onError: (e) => notify({ text: errText(e, "Couldn't close entries."), tone: "error" }),
  });

  const announce = useMutation({
    mutationFn: () => api(`${base}/announce`, { method: "POST", body: {} }),
    onSuccess: (r: any) => {
      refresh();
      notify({ text: `Results out. ${r?.notified ?? 0} told.`, tone: "success" });
      onClose();
    },
    onError: (e) => notify({ text: errText(e, "Couldn't announce the results."), tone: "error" }),
  });

  const extend = useMutation({
    mutationFn: (deadline: string) => api(base, { method: "PATCH", body: { deadline } }),
    onSuccess: () => { refresh(); notify({ text: "Deadline moved", tone: "success" }); },
    onError: (e) => notify({ text: errText(e, "Couldn't change that."), tone: "error" }),
  });

  const live = entries.data?.filter((e) => e.status !== "withdrawn") ?? [];

  return (
    <Sheet visible onClose={onClose} title={challenge.title} subtitle={`${challenge.status} · ${challenge.entryCount} ${challenge.entryCount === 1 ? "entry" : "entries"}`}>
      <View style={{ gap: spacing.sm }}>
        <Text style={text.meta} numberOfLines={6}>{challenge.brief}</Text>

        {entries.isLoading ? <Loading /> : null}
        {!entries.isLoading && !live.length ? <Text style={text.small}>No entries yet.</Text> : null}
        {live.map((e) => (
          <Pressable
            key={e.id}
            disabled={!mayRun || challenge.status !== "judging"}
            onPress={() => setJudging(e)}
            testID={`entry-${e.id}`}
            style={{ paddingVertical: 7, borderTopWidth: 1, borderColor: colors.border, gap: 2 }}
          >
            <Row between center>
              <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }} numberOfLines={1}>{e.title}</Text>
              <Pill label={e.status} tone={e.status === "winner" ? "good" : e.status === "shortlisted" ? "info" : "neutral"} />
            </Row>
            <Text style={{ color: colors.textTertiary, fontSize: font.xs }} numberOfLines={1}>
              {e.entrantName}{e.project?.title ? ` · ${e.project.title}` : ""}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: font.xs }} numberOfLines={3}>{e.pitch}</Text>
          </Pressable>
        ))}

        {mayRun ? (
          <Row gap={spacing.sm} wrap style={{ marginTop: spacing.sm }}>
            {challenge.status === "open" ? (
              <>
                <Btn
                  small
                  variant="outline"
                  label="Close entries"
                  loading={closeEntries.isPending}
                  testID="close-entries"
                  onPress={() => Alert.alert("Close entries?", "Nobody else can enter after this, and you can start judging.", [
                    { text: "Not yet", style: "cancel" },
                    { text: "Close them", onPress: () => closeEntries.mutate() },
                  ])}
                />
                <Btn
                  small
                  variant="ghost"
                  label="Two more weeks"
                  loading={extend.isPending}
                  testID="extend-deadline"
                  onPress={() => extend.mutate(new Date(new Date(challenge.deadline).getTime() + 14 * 86_400_000).toISOString())}
                />
              </>
            ) : null}
            {challenge.status === "judging" ? (
              <Btn
                small
                label="Announce the results"
                loading={announce.isPending}
                testID="announce"
                onPress={() => Alert.alert(
                  "Announce the results?",
                  "Everyone still in hears their own result. If nobody was made the winner, the prize goes back to your balance.",
                  [{ text: "Not yet", style: "cancel" }, { text: "Announce", onPress: () => announce.mutate() }],
                )}
              />
            ) : null}
            {challenge.status === "judging" && !live.some((e) => e.status === "winner") ? (
              <Text style={text.small}>Tap an entry to shortlist it or make it the winner.</Text>
            ) : null}
          </Row>
        ) : null}

        {judging ? (
          <JudgeEntry
            base={base}
            entry={judging}
            onClose={() => setJudging(null)}
            onJudged={() => { refresh(); setJudging(null); }}
            notify={notify}
          />
        ) : null}
      </View>
    </Sheet>
  );
}

/** Shortlist it, make it the winner, or take a shortlisting back — with feedback. */
function JudgeEntry({
  base, entry, onClose, onJudged, notify,
}: {
  base: string; entry: Entry; onClose: () => void; onJudged: () => void; notify: (n: Notice) => void;
}) {
  const [feedback, setFeedback] = useState(entry.feedback ?? "");

  const judge = useMutation({
    mutationFn: (status: "entered" | "shortlisted" | "winner") =>
      api(`${base}/entries/${entry.id}/status`, { method: "POST", body: { status, feedback: feedback.trim() } }),
    onSuccess: () => { notify({ text: "Saved", tone: "success" }); onJudged(); },
    onError: (e) => notify({ text: errText(e, "Couldn't judge that."), tone: "error" }),
  });

  return (
    <Sheet visible onClose={onClose} title={entry.title} subtitle={entry.entrantName}>
      <View style={{ gap: spacing.sm }}>
        <Text style={text.meta}>{entry.pitch}</Text>
        {entry.link ? <Text style={{ color: colors.primary, fontSize: font.xs }} numberOfLines={1}>{entry.link}</Text> : null}
        <Field
          label="Feedback (optional)"
          value={feedback}
          onChangeText={setFeedback}
          multiline
          maxLength={ENTRY_LIMITS.feedback.max}
          placeholder="What they did well, or what was missing."
          testID="entry-feedback"
        />
        <Row gap={spacing.sm} wrap>
          {/* "entered" is in the list so a shortlisting can be taken back. */}
          <Btn small variant="outline" label="Shortlist" loading={judge.isPending} onPress={() => judge.mutate("shortlisted")} testID="judge-shortlist" />
          <Btn small label="Make winner" loading={judge.isPending} onPress={() => judge.mutate("winner")} testID="judge-winner" />
          {entry.status !== "entered" ? (
            <Btn small variant="ghost" label="Undo" loading={judge.isPending} onPress={() => judge.mutate("entered")} testID="judge-undo" />
          ) : null}
        </Row>
      </View>
    </Sheet>
  );
}
