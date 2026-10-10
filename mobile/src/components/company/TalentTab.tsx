/**
 * Recruiting, from the company's side — the phone's half of
 * client/src/components/company/talent-tab.tsx.
 *
 * The person being recruited already had their half on the phone
 * (`app/talent.tsx`): they could open their profile to companies and answer an
 * invitation. The company's half was web-only, so the search, the track record
 * behind a name and the invitation itself could only be done at a desk.
 *
 * Which is the right way round for the *decision* — you choose who to approach
 * with a track record open in front of you — but not for the moment somebody
 * says "look them up" in a corridor.
 *
 * Reading the pool needs only "view". Asking somebody to talk needs the
 * `recruit` power, and the server checks it again.
 */
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Avatar, Btn, Field, Loading, Row, errText, timeAgo } from "../ui";
import { Callout, TitledCard } from "../MoreKit";
import { Pill } from "../nova/Pill";
import { text } from "../more/AdminKit";
import { Sheet, type Notice } from "../Sheet";
import { hasPower } from "../../companies";
import { companyKey, type CompanyView } from "./kit";

/** What the server says MESSAGE_MIN and MESSAGE_MAX are, in server/talent-routes.ts. */
const MESSAGE_MIN = 20;
const MESSAGE_MAX = 800;

interface Candidate {
  userId: string;
  name: string;
  avatarUrl: string | null;
  headline: string | null;
  roles: string[];
  location: string | null;
  remote: boolean | null;
  record: { seasonsPlayed: number; strengths: string[]; bestFinish: unknown; averagePercentile: number | null; empty: boolean } | null;
  invite: string | null;
}

interface TalentInvite {
  id: string; userId: string; name: string; role: string | null;
  status: string; createdAt: string; answeredAt: string | null;
}

export function TalentTab({ companyId, notify }: { companyId: string; notify: (n: Notice) => void }) {
  const { data: view } = useQuery<CompanyView>({ queryKey: companyKey(companyId) });
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  /*
   * The query string is part of the key, so going back to an earlier search
   * shows it instantly instead of asking again. `minSeasons` is deliberately
   * not a control: the server accepts it, and a phone with four filters is a
   * phone nobody searches on.
   */
  const search = useQuery({
    queryKey: ["company-talent", companyId, q],
    queryFn: () => api<{ candidates: Candidate[] }>(`/api/companies/${companyId}/talent${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`),
  });

  const asked = useQuery({
    queryKey: ["company-talent-invites", companyId],
    queryFn: () => api<{ invites: TalentInvite[] }>(`/api/companies/${companyId}/talent-invites`),
  });

  if (!view) return null;
  const mayRecruit = hasPower(view.me, "recruit");
  const candidates = search.data?.candidates ?? [];

  return (
    <View style={{ gap: spacing.md }}>
      {!view.company.verifiedAt ? (
        <Callout icon="alert-circle" tone="warn" title="Not verified yet" body="A company has to have a verified domain before it can approach anybody." />
      ) : null}
      {!mayRecruit ? (
        <Callout icon="eye" tone="info" body="You can read the pool. Asking somebody to talk needs the Recruit power — an owner or admin can give it to you." />
      ) : null}

      <TitledCard icon="search" title="Open to companies">
        <Text style={text.meta}>
          People who have opened their profile to companies. Ordered by what they have actually done in a season, not by what they say.
        </Text>
        <Field
          label="Search"
          value={q}
          onChangeText={setQ}
          placeholder="a name, a role, a place"
          autoCapitalize="none"
          maxLength={80}
          testID="talent-search"
        />
        {search.isLoading ? <Loading /> : null}
        {!search.isLoading && !candidates.length ? (
          <Text style={text.small}>{q.trim() ? "Nobody open to companies matches that." : "Nobody has opened their profile to companies yet."}</Text>
        ) : null}
        {candidates.map((c) => (
          <Pressable
            key={c.userId}
            onPress={() => setOpen(c.userId)}
            testID={`candidate-${c.userId}`}
            style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border }}
          >
            <Avatar name={c.name} uri={c.avatarUrl} size={34} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }} numberOfLines={1}>{c.name}</Text>
              <Text style={{ color: colors.textTertiary, fontSize: font.xs }} numberOfLines={1}>
                {c.headline || c.roles.slice(0, 2).join(", ") || "No headline"}
              </Text>
              <Text style={{ color: colors.textTertiary, fontSize: font.xs }} numberOfLines={1}>
                {c.record?.empty
                  ? "Nothing on record yet"
                  : `${c.record?.seasonsPlayed ?? 0} season${(c.record?.seasonsPlayed ?? 0) === 1 ? "" : "s"}${c.record?.strengths?.length ? ` · ${c.record.strengths.slice(0, 2).join(", ")}` : ""}`}
              </Text>
            </View>
            {/* Already asked, so the row says so rather than offering again: once per company per person, ever. */}
            {c.invite ? <Pill label={c.invite} tone={c.invite === "accepted" ? "good" : c.invite === "declined" ? "bad" : "neutral"} /> : null}
          </Pressable>
        ))}
      </TitledCard>

      <TitledCard icon="paper-plane" title="Who you've asked">
        {asked.isLoading ? <Loading /> : null}
        {!asked.isLoading && !asked.data?.invites?.length ? <Text style={text.small}>Nobody yet.</Text> : null}
        {(asked.data?.invites ?? []).map((i) => (
          <View key={i.id} testID={`talent-invite-${i.id}`}>
            <Row between center style={{ paddingVertical: 6 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontSize: font.sm }} numberOfLines={1}>{i.name}</Text>
                <Text style={{ color: colors.textTertiary, fontSize: font.xs }}>
                  {i.role ? `${i.role} · ` : ""}asked {timeAgo(i.createdAt)}
                </Text>
              </View>
              <Pill label={i.status} tone={i.status === "accepted" ? "good" : i.status === "declined" ? "bad" : "neutral"} />
            </Row>
          </View>
        ))}
      </TitledCard>

      {open ? (
        <CandidateSheet
          companyId={companyId}
          userId={open}
          mayRecruit={mayRecruit && !!view.company.verifiedAt}
          onClose={() => setOpen(null)}
          notify={notify}
        />
      ) : null}
    </View>
  );
}

/**
 * One candidate, whole, with the way to ask them.
 *
 * Fetched rather than passed down: the list carries a summary, and the whole
 * track record is the thing somebody wants before they write to a stranger.
 */
function CandidateSheet({
  companyId, userId, mayRecruit, onClose, notify,
}: {
  companyId: string; userId: string; mayRecruit: boolean; onClose: () => void; notify: (n: Notice) => void;
}) {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [role, setRole] = useState("");

  const q = useQuery({
    queryKey: ["company-candidate", companyId, userId],
    queryFn: () => api<Candidate & { record: any }>(`/api/companies/${companyId}/talent/${userId}`),
  });

  const invite = useMutation({
    mutationFn: () => api(`/api/companies/${companyId}/talent/${userId}/invite`, {
      method: "POST",
      body: { message: message.trim(), role: role.trim() || undefined },
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["company-talent", companyId] });
      void qc.invalidateQueries({ queryKey: ["company-talent-invites", companyId] });
      notify({ text: "Asked. They decide whether to reply.", tone: "success" });
      onClose();
    },
    /* "Your company has already asked them." is the server's, and it is the answer. */
    onError: (e) => notify({ text: errText(e, "Couldn't ask them."), tone: "error" }),
  });

  const c = q.data;
  const tooShort = message.trim().length < MESSAGE_MIN;

  return (
    <Sheet visible onClose={onClose} title={c?.name ?? "Candidate"} subtitle={c?.headline ?? undefined}>
      {q.isLoading ? <Loading /> : null}
      {c ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={text.meta}>
            {[c.location, c.remote ? "open to remote" : null].filter(Boolean).join(" · ") || "No location given"}
          </Text>
          {c.roles?.length ? (
            <Row wrap gap={6}>{c.roles.map((r) => <Pill key={r} label={r} tone="neutral" />)}</Row>
          ) : null}
          {c.record?.empty ? (
            <Text style={text.small}>Nothing on record yet — they have not finished a season.</Text>
          ) : (
            <View style={{ gap: 2 }}>
              <Text style={{ color: colors.text, fontSize: font.sm }}>
                {c.record.seasonsPlayed} season{c.record.seasonsPlayed === 1 ? "" : "s"}, {c.record.yearsFiled ?? 0} year{(c.record.yearsFiled ?? 0) === 1 ? "" : "s"} filed
              </Text>
              {c.record.strengths?.length ? (
                <Text style={{ color: colors.textTertiary, fontSize: font.xs }}>Strengths: {c.record.strengths.join(", ")}</Text>
              ) : null}
              {c.record.averagePercentile != null ? (
                <Text style={{ color: colors.textTertiary, fontSize: font.xs }}>Finishes in the top {100 - Math.round(c.record.averagePercentile)}% on average</Text>
              ) : null}
            </View>
          )}

          {c.invite ? (
            <Callout icon="information-circle" tone="info" body={`Your company has already asked them — they ${c.invite === "sent" ? "have not answered" : c.invite}.`} />
          ) : mayRecruit ? (
            <View style={{ gap: spacing.sm }}>
              <Field label="The role, if you have one in mind" value={role} onChangeText={setRole} placeholder="Head of operations" maxLength={80} testID="invite-role" />
              <Field
                label="What you'd like to talk about"
                value={message}
                onChangeText={setMessage}
                placeholder="Who you are, and why you're writing to them."
                multiline
                maxLength={MESSAGE_MAX}
                testID="invite-message"
              />
              <Text style={text.small}>
                {tooShort
                  ? `At least ${MESSAGE_MIN} characters — a one-line approach to a stranger reads as a mailshot.`
                  : `${message.trim().length} of ${MESSAGE_MAX}.`}
              </Text>
              <Btn label="Ask them to talk" loading={invite.isPending} disabled={tooShort} onPress={() => invite.mutate()} testID="send-invite" />
            </View>
          ) : (
            <Text style={text.small}>Asking somebody to talk needs the Recruit power and a verified domain.</Text>
          )}
        </View>
      ) : null}
    </Sheet>
  );
}
