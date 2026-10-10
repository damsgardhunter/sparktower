import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Empty, Field, Loading, Row, Screen, errText } from "../../src/components/ui";
import { PageIntro, TitledCard } from "../../src/components/MoreKit";
import { Pill } from "../../src/components/nova/Pill";
import { NoticeBanner, Sheet, useNotice } from "../../src/components/Sheet";
import { blockedView, gateView, text, useReviewer } from "../../src/components/more/AdminKit";
import {
  CONTEST_CATEGORY_MAX, CONTEST_DESCRIPTION_MAX, CONTEST_DIFFICULTIES,
  CONTEST_PRIZE_MAX, CONTEST_STATUSES, CONTEST_TITLE_MAX,
} from "../../src/contests";

/**
 * The contests put in front of the whole site — the web's /admin/contests.
 *
 * This and promotions were the two admin consoles the mobile survey never
 * looked at: it was built from a chosen five and then reasoned about as if that
 * were the whole set. Listing the web's admin pages rather than re-reading the
 * table found them.
 *
 * Making and editing are both here, unlike the consoles where acting stays on
 * the web. The difference is what the action does: a grant moves money and a
 * suspension takes somebody's account away, whereas a contest is a page of
 * text with two dates on it, and the thing most likely to need changing in a
 * hurry is a date or a status — exactly the edit somebody makes from a phone
 * when a contest should have opened an hour ago and has not.
 *
 * Every change is in the moderation log, which is append-only by database
 * rule: "who put this in front of the whole site, and when" stays answerable.
 */

interface Contest {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: string;
  status: string;
  prize: string | null;
  startDate: string;
  endDate: string;
  promoted: boolean;
  badgeId: string | null;
  participantCount: number;
}

const STATUS_TONE: Record<string, "good" | "warn" | "neutral" | "info"> = {
  active: "good", upcoming: "warn", judging: "info", completed: "neutral",
};

/** A date somebody can type on a phone, and the ISO the route wants. */
const asDay = (iso: string) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
const fromDay = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export default function AdminContests() {
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const { loading, isReviewer } = useReviewer();
  const [editing, setEditing] = useState<Contest | "new" | null>(null);

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin-contests"],
    queryFn: () => api<{ contests: Contest[]; badges: { id: string; name: string }[] }>("/api/admin/contests"),
    enabled: isReviewer,
    retry: false,
  });

  const gate = gateView("Contests", loading, isReviewer);
  if (gate) return gate;
  const blocked = blockedView("Contests", error);
  if (blocked) return blocked;

  const rows = data?.contests ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <Stack.Screen options={{ title: "Contests" }} />
      <Screen canvas onRefresh={() => refetch()} refreshing={isRefetching}>
        <PageIntro
          icon="trophy"
          title="Contests"
          body="What the whole site is invited to enter. Promoted ones lead the contests page; the window decides whether anybody can join."
        />

        {isLoading ? <View style={{ height: 200 }}><Loading /></View>
          : error ? <Empty icon="cloud-offline-outline" title="Couldn't load the contests" body={errText(error)} action="Try again" onAction={() => refetch()} />
          : (
            <>
              <Btn label="Make one" icon="add" onPress={() => setEditing("new")} testID="new-contest" />
              {!rows.length ? <Text style={text.small}>None yet.</Text> : null}
              {rows.map((c) => (
                <TitledCard key={c.id} title={c.title} icon={c.promoted ? "star" : "trophy-outline"}>
                  <Row wrap gap={6} center>
                    <Pill label={c.status} tone={STATUS_TONE[c.status] ?? "neutral"} />
                    <Pill label={c.difficulty} tone="neutral" />
                    {c.promoted ? <Pill label="promoted" tone="info" /> : null}
                    <Text style={text.small}>
                      {c.participantCount} {c.participantCount === 1 ? "entrant" : "entrants"}
                    </Text>
                  </Row>
                  <Text style={text.small} numberOfLines={3}>{c.description}</Text>
                  <Text style={text.small}>
                    {asDay(c.startDate)} → {asDay(c.endDate)}
                    {c.prize ? ` · ${c.prize}` : ""}
                  </Text>
                  <Btn small variant="outline" label="Edit" onPress={() => setEditing(c)} testID={`edit-contest-${c.id}`} />
                </TitledCard>
              ))}
            </>
          )}
      </Screen>

      {editing ? (
        <ContestForm
          contest={editing === "new" ? null : editing}
          badges={data?.badges ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { void qc.invalidateQueries({ queryKey: ["admin-contests"] }); setEditing(null); }}
          notify={show}
        />
      ) : null}
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}

function ContestForm({
  contest, badges, onClose, onSaved, notify,
}: {
  contest: Contest | null;
  badges: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
  notify: (n: { text: string; tone: "success" | "error" | "info" }) => void;
}) {
  const [f, setF] = useState({
    title: contest?.title ?? "",
    description: contest?.description ?? "",
    category: contest?.category ?? "",
    prize: contest?.prize ?? "",
    difficulty: contest?.difficulty ?? "intermediate",
    status: contest?.status ?? "upcoming",
    startDate: asDay(contest?.startDate ?? ""),
    endDate: asDay(contest?.endDate ?? ""),
    promoted: contest?.promoted ?? false,
    badgeId: contest?.badgeId ?? null as string | null,
  });
  const set = (k: keyof typeof f) => (v: any) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        prize: f.prize.trim() || null,
        startDate: fromDay(f.startDate),
        endDate: fromDay(f.endDate),
      };
      return contest
        ? api(`/api/admin/contests/${contest.id}`, { method: "PUT", body })
        : api("/api/admin/contests", { method: "POST", body });
    },
    onSuccess: () => { notify({ text: contest ? "Saved" : "Contest made", tone: "success" }); onSaved(); },
    /*
     * The server's words. "A contest can't close before it opens" is the one
     * that matters — a backwards window is accepted happily by the database and
     * then behaves like a contest that is permanently over, which nobody can
     * work out from the page.
     */
    onError: (e) => notify({ text: errText(e, "Couldn't save that contest."), tone: "error" }),
  });

  const Choice = ({ options, value, onPick, prefix }: { options: readonly string[]; value: string; onPick: (v: string) => void; prefix: string }) => (
    <Row wrap gap={6}>
      {options.map((o) => (
        <Pressable
          key={o}
          onPress={() => onPick(o)}
          testID={`${prefix}-${o}`}
          style={{
            paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1,
            borderColor: value === o ? colors.primary : colors.border,
            backgroundColor: value === o ? colors.primarySoft : "transparent",
          }}
        >
          <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: value === o ? colors.primary : colors.textSecondary }}>{o}</Text>
        </Pressable>
      ))}
    </Row>
  );

  return (
    <Sheet visible onClose={onClose} title={contest ? "Edit the contest" : "A new contest"} subtitle="Everyone on the site can see this">
      <View style={{ gap: spacing.sm }}>
        <Field label="Name" value={f.title} onChangeText={set("title")} maxLength={CONTEST_TITLE_MAX} testID="contest-title" />
        <Field label="What entrants are asked to do" value={f.description} onChangeText={set("description")} multiline maxLength={CONTEST_DESCRIPTION_MAX} testID="contest-description" />
        <Field label="Category" value={f.category} onChangeText={set("category")} maxLength={CONTEST_CATEGORY_MAX} testID="contest-category" />
        <Field label="Prize (optional)" value={f.prize} onChangeText={set("prize")} maxLength={CONTEST_PRIZE_MAX} testID="contest-prize" />

        <Text style={text.small}>Difficulty</Text>
        <Choice options={CONTEST_DIFFICULTIES} value={f.difficulty} onPick={set("difficulty")} prefix="difficulty" />
        <Text style={text.small}>Status</Text>
        <Choice options={CONTEST_STATUSES} value={f.status} onPick={set("status")} prefix="status" />

        <Field label="Opens (YYYY-MM-DD)" value={f.startDate} onChangeText={set("startDate")} placeholder="2026-11-01" autoCapitalize="none" testID="contest-start" />
        <Field label="Closes (YYYY-MM-DD)" value={f.endDate} onChangeText={set("endDate")} placeholder="2026-12-01" autoCapitalize="none" testID="contest-end" />

        <Pressable onPress={() => set("promoted")(!f.promoted)} testID="contest-promoted" style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 }}>
          <Pill label={f.promoted ? "promoted" : "not promoted"} tone={f.promoted ? "info" : "neutral"} />
          <Text style={[text.small, { flex: 1 }]}>A promoted contest leads the contests page.</Text>
        </Pressable>

        {badges.length ? (
          <>
            <Text style={text.small}>Badge for the winner (optional)</Text>
            <Row wrap gap={6}>
              <Pressable
                onPress={() => set("badgeId")(null)}
                testID="contest-badge-none"
                style={{
                  paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1,
                  borderColor: !f.badgeId ? colors.primary : colors.border,
                  backgroundColor: !f.badgeId ? colors.primarySoft : "transparent",
                }}
              >
                <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: !f.badgeId ? colors.primary : colors.textSecondary }}>none</Text>
              </Pressable>
              {badges.slice(0, 20).map((b) => (
                <Pressable
                  key={b.id}
                  onPress={() => set("badgeId")(b.id)}
                  testID={`contest-badge-${b.id}`}
                  style={{
                    paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1,
                    borderColor: f.badgeId === b.id ? colors.primary : colors.border,
                    backgroundColor: f.badgeId === b.id ? colors.primarySoft : "transparent",
                  }}
                >
                  <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: f.badgeId === b.id ? colors.primary : colors.textSecondary }}>{b.name}</Text>
                </Pressable>
              ))}
            </Row>
          </>
        ) : null}

        <Btn
          label={contest ? "Save" : "Make it"}
          loading={save.isPending}
          disabled={!f.title.trim() || !f.description.trim() || !f.category.trim() || !f.startDate || !f.endDate}
          onPress={() => save.mutate()}
          testID="save-contest"
        />
      </View>
    </Sheet>
  );
}
