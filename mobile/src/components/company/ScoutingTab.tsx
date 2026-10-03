/**
 * Startups a company keeps an eye on — the phone's half of
 * client/src/components/company/scouting-tab.tsx.
 *
 * Three parts, the web's: the industries it watches, the projects it follows
 * with a note on why, and suggestions — the newest public projects in those
 * industries it is not following yet. Only public projects ever appear here;
 * the server filters private and hidden ones out, and a note in it records
 * that scouting once went on recommending a project a reviewer had taken down.
 *
 * Reading needs "view"; changing any of it needs the `scouting` power, which
 * the server checks again.
 */
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, Field, Icon, Loading, Row, errText, timeAgo } from "../ui";
import { Callout, TitledCard } from "../MoreKit";
import { Pill } from "../nova/Pill";
import { text } from "../more/AdminKit";
import { Sheet, type Notice } from "../Sheet";
import { hasPower } from "../../companies";
import { PROJECT_CATEGORIES } from "../../projectData";
import { companyKey, type CompanyView } from "./kit";

/** The server's NOTE_MAX, in server/scouting-routes.ts. */
const NOTE_MAX = 280;

interface Followed {
  id: string; title: string; category: string | null; ownerName?: string | null;
  note: string | null; followedAt: string; lastActivityAt: string;
  milestonesDone: number; milestonesTotal: number | null;
}
interface Suggestion { id: string; title: string; category: string | null; lastActivityAt: string }
interface Scouting { watches: string[]; follows: Followed[]; suggestions: Suggestion[] }

export function ScoutingTab({ companyId, notify }: { companyId: string; notify: (n: Notice) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: view } = useQuery<CompanyView>({ queryKey: companyKey(companyId) });
  const [editingWatches, setEditingWatches] = useState(false);
  const [noteFor, setNoteFor] = useState<{ id: string; title: string; note: string } | null>(null);

  const key = ["company-scouting", companyId];
  const q = useQuery({ queryKey: key, queryFn: () => api<Scouting>(`/api/companies/${companyId}/scouting`) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const follow = useMutation({
    mutationFn: ({ projectId, note }: { projectId: string; note?: string }) =>
      api(`/api/companies/${companyId}/follows/${projectId}`, { method: "POST", body: note ? { note } : {} }),
    onSuccess: () => { void refresh(); setNoteFor(null); notify({ text: "Following", tone: "success" }); },
    onError: (e) => notify({ text: errText(e, "Couldn't follow that."), tone: "error" }),
  });

  const unfollow = useMutation({
    mutationFn: (projectId: string) => api(`/api/companies/${companyId}/follows/${projectId}`, { method: "DELETE" }),
    onSuccess: () => { void refresh(); notify({ text: "Stopped following", tone: "success" }); },
    onError: (e) => notify({ text: errText(e, "Couldn't stop following that."), tone: "error" }),
  });

  if (!view) return null;
  const mayScout = hasPower(view.me, "scouting");
  const data = q.data;

  return (
    <View style={{ gap: spacing.md }}>
      {!mayScout ? (
        <Callout icon="eye" tone="info" body="You can see what the company watches and follows. Changing it needs the Scout startups power." />
      ) : null}

      <TitledCard icon="radio" title="Industries watched">
        <Text style={text.meta}>Everyone in the company hears about new public projects in these.</Text>
        {q.isLoading ? <Loading /> : null}
        {data ? (
          data.watches.length ? (
            <Row wrap gap={6} style={{ marginTop: 4 }}>
              {data.watches.map((w) => <Pill key={w} label={w} tone="info" />)}
            </Row>
          ) : (
            <Text style={text.small}>None yet.{mayScout ? " Pick some to get suggestions below." : ""}</Text>
          )
        ) : null}
        {mayScout ? (
          <Btn
            small
            variant="outline"
            label={data?.watches?.length ? "Change what you watch" : "Pick industries"}
            onPress={() => setEditingWatches(true)}
            testID="edit-watches"
            style={{ marginTop: spacing.sm }}
          />
        ) : null}
      </TitledCard>

      <TitledCard icon="eye" title={`Following · ${data?.follows?.length ?? 0}`}>
        {data && !data.follows.length ? <Text style={text.small}>Not following anything yet.</Text> : null}
        {(data?.follows ?? []).map((f) => (
          <View key={f.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border, gap: 3 }} testID={`follow-${f.id}`}>
            <Pressable onPress={() => router.push(`/project/${f.id}`)}>
              <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }} numberOfLines={1}>{f.title}</Text>
            </Pressable>
            <Text style={{ color: colors.textTertiary, fontSize: font.xs }}>
              {[f.category, f.milestonesTotal ? `${f.milestonesDone}/${f.milestonesTotal} milestones` : null, `active ${timeAgo(f.lastActivityAt)}`]
                .filter(Boolean).join(" · ")}
            </Text>
            {f.note ? <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontStyle: "italic" }}>“{f.note}”</Text> : null}
            {mayScout ? (
              <Row gap={spacing.sm} style={{ marginTop: 2 }}>
                <Btn small variant="ghost" label={f.note ? "Edit note" : "Add a note"} onPress={() => setNoteFor({ id: f.id, title: f.title, note: f.note ?? "" })} testID={`note-${f.id}`} />
                <Btn
                  small
                  variant="danger"
                  label="Stop"
                  testID={`unfollow-${f.id}`}
                  onPress={() => Alert.alert(`Stop following ${f.title}?`, "The note goes with it.", [
                    { text: "Keep", style: "cancel" },
                    { text: "Stop following", style: "destructive", onPress: () => unfollow.mutate(f.id) },
                  ])}
                />
              </Row>
            ) : null}
          </View>
        ))}
      </TitledCard>

      <TitledCard icon="sparkles" title="Suggestions">
        <Text style={text.meta}>The newest public projects in the industries you watch that you don't follow yet.</Text>
        {data && !data.watches.length ? <Text style={text.small}>Watch an industry to see suggestions here.</Text> : null}
        {data && data.watches.length && !data.suggestions.length ? <Text style={text.small}>Nothing new in those industries.</Text> : null}
        {(data?.suggestions ?? []).map((s) => (
          <Row key={s.id} between center style={{ paddingVertical: 7, borderTopWidth: 1, borderColor: colors.border }}>
            <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => router.push(`/project/${s.id}`)} testID={`suggestion-${s.id}`}>
              <Text style={{ color: colors.text, fontSize: font.sm }} numberOfLines={1}>{s.title}</Text>
              <Text style={{ color: colors.textTertiary, fontSize: font.xs }}>
                {[s.category, `active ${timeAgo(s.lastActivityAt)}`].filter(Boolean).join(" · ")}
              </Text>
            </Pressable>
            {mayScout ? (
              <Btn small variant="outline" label="Follow" loading={follow.isPending} onPress={() => follow.mutate({ projectId: s.id })} testID={`follow-suggestion-${s.id}`} />
            ) : null}
          </Row>
        ))}
      </TitledCard>

      {editingWatches ? (
        <WatchPicker
          companyId={companyId}
          current={data?.watches ?? []}
          onClose={() => setEditingWatches(false)}
          onSaved={() => { void refresh(); setEditingWatches(false); }}
          notify={notify}
        />
      ) : null}

      {noteFor ? (
        <Sheet visible onClose={() => setNoteFor(null)} title={noteFor.title} subtitle="Why you're watching them">
          <Field
            label="Note"
            value={noteFor.note}
            onChangeText={(note) => setNoteFor({ ...noteFor, note })}
            placeholder="What you want to remember about them."
            multiline
            maxLength={NOTE_MAX}
            testID="follow-note"
          />
          <Btn
            label="Save the note"
            loading={follow.isPending}
            onPress={() => follow.mutate({ projectId: noteFor.id, note: noteFor.note.trim() })}
            testID="save-follow-note"
          />
        </Sheet>
      ) : null}
    </View>
  );
}

/**
 * The industries, as a whole set.
 *
 * What is sent is what is watched — the server replaces the lot in one
 * transaction, so there is no "add this one" to get half-applied.
 */
function WatchPicker({
  companyId, current, onClose, onSaved, notify,
}: {
  companyId: string; current: string[]; onClose: () => void; onSaved: () => void; notify: (n: Notice) => void;
}) {
  const [picked, setPicked] = useState<string[]>(current);

  const save = useMutation({
    mutationFn: () => api(`/api/companies/${companyId}/watches`, { method: "PUT", body: { industries: picked } }),
    onSuccess: () => {
      notify({ text: "Everyone in the company hears about new public projects in these", tone: "success" });
      onSaved();
    },
    onError: (e) => notify({ text: errText(e, "Couldn't save that."), tone: "error" }),
  });

  return (
    <Sheet visible onClose={onClose} title="Industries to watch" subtitle="New public projects in these are worth a look">
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {PROJECT_CATEGORIES.map((c) => {
          const on = picked.includes(c);
          return (
            <Pressable
              key={c}
              testID={`watch-${c}`}
              onPress={() => setPicked(on ? picked.filter((x) => x !== c) : [...picked, c])}
              style={{
                flexDirection: "row", alignItems: "center", gap: 4,
                paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm,
                borderWidth: 1, borderColor: on ? colors.primary : colors.border,
                backgroundColor: on ? colors.primarySoft : "transparent",
              }}
            >
              {on ? <Icon name="checkmark" size={12} color={colors.primary} /> : null}
              <Text style={{ fontSize: font.xs, fontFamily: fontFamily.medium, color: on ? colors.primary : colors.textSecondary }}>{c}</Text>
            </Pressable>
          );
        })}
      </View>
      <Btn label={picked.length ? `Watch ${picked.length}` : "Watch nothing"} loading={save.isPending} onPress={() => save.mutate()} testID="save-watches" />
    </Sheet>
  );
}
