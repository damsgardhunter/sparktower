/**
 * One training season, from the front of the room.
 *
 * Four of the eleven season routes are here, and they are the four a
 * facilitator uses while a session is happening: tell colleagues there is a
 * seat, start year one, end this year now rather than at its time, and watch
 * who has filed. The staff report is the fifth, read afterwards.
 *
 * ## Why start is a button and not a clock
 *
 * The server's own note: a public season starts itself once every room is out
 * of the lobby, and a training season used to as well — but a workshop's tables
 * fill with bots after a minute, so the first table to sit down could be
 * "ready" and the season under way while half the room was still typing in the
 * link. The person running the session knows when everyone is in; the clock
 * does not. So the button says how many tables are ready, and the wait is
 * visible.
 *
 * ## What the watch view will not show
 *
 * A facilitator who is also playing does not see anyone's filed decision. The
 * server withholds it — asked of the season rather than of one table, because a
 * seat anywhere in it would make every other table's plan an unfair advantage.
 * The phone shows "filed" either way, which is the thing being looked for.
 */
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Avatar, Btn, Loading, Row, errText, timeAgo } from "../ui";
import { Callout, TitledCard } from "../MoreKit";
import { Pill } from "../nova/Pill";
import { text } from "../more/AdminKit";
import { Sheet, type Notice } from "../Sheet";
import { PERIOD_NAME, type Cadence } from "../sim/period";
import { canStart, type SeasonRow, type StaffReport, type WatchTable } from "./seasons";
import { memberName, type CompanyMember } from "./kit";

export function SeasonSheet({
  companyId, season, mayRun, members, onClose, onChanged, notify,
}: {
  companyId: string;
  season: SeasonRow;
  mayRun: boolean;
  members: CompanyMember[];
  onClose: () => void;
  onChanged: () => void;
  notify: (n: Notice) => void;
}) {
  const base = `/api/companies/${companyId}/seasons/${season.id}`;
  const [inviting, setInviting] = useState(false);
  const period = PERIOD_NAME[(season.cadence ?? "yearly") as Cadence];

  /*
   * Only while it is running, and only for somebody who may run it — the watch
   * route asks for `run_seasons` and would 403 for anyone else, so asking at
   * all would be a failed request on every render.
   */
  const watch = useQuery({
    queryKey: ["season-watch", season.id],
    queryFn: () => api<{ tables: WatchTable[] }>(`${base}/watch`),
    enabled: mayRun && season.status === "running",
    refetchInterval: 10_000,
  });

  const report = useQuery({
    queryKey: ["season-report", season.id],
    queryFn: () => api<StaffReport>(`${base}/report`),
    enabled: mayRun && season.status !== "lobby" && season.status !== "draft",
  });

  const start = useMutation({
    mutationFn: () => api(`${base}/start`, { method: "POST", body: {} }),
    onSuccess: () => { onChanged(); notify({ text: "Year one is under way.", tone: "success" }); },
    /*
     * The seat gate answers here. The server's message says how many sat down,
     * how many are paid for and which kind — all of which somebody needs at the
     * moment they press start in front of a room.
     */
    onError: (e) => notify({ text: errText(e, "Couldn't start it."), tone: "error" }),
  });

  const resolveNow = useMutation({
    mutationFn: () => api(`${base}/resolve-year-now`, { method: "POST", body: {} }),
    onSuccess: () => { onChanged(); void watch.refetch(); /* Capitalised here rather than in PERIOD_NAME: the vocabulary has one lower-case form and a sentence needs it either way. */
      notify({ text: `That ${period.one} is resolved.`, tone: "success" }); },
    onError: (e) => notify({ text: errText(e, "Couldn't end it early."), tone: "error" }),
  });

  return (
    <Sheet
      visible
      onClose={onClose}
      title={season.name}
      subtitle={[season.niche.name, season.status === "running" ? `${period.one} ${season.year} of ${season.totalPeriods}` : season.status].filter(Boolean).join(" · ")}
    >
      <View style={{ gap: spacing.md }}>
        {mayRun && canStart(season) ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={text.meta}>
              {season.rooms
                ? `${season.roomsReady} of ${season.rooms} ${season.rooms === 1 ? "table is" : "tables are"} out of the lobby. Starting will not start a table that is still choosing seats — a year cannot begin for a team with no chief executive.`
                : "Nobody has joined yet. Read the code out first."}
            </Text>
            <Row gap={spacing.sm} wrap>
              <Btn
                label={`Start — ${season.roomsReady}/${season.rooms} ready`}
                loading={start.isPending}
                disabled={!season.roomsReady}
                testID="start-season"
                onPress={() => Alert.alert(
                  "Start the season?",
                  "Seats are charged for the people who actually sat down. Stand-ins are not charged for.",
                  [{ text: "Wait", style: "cancel" }, { text: "Start", onPress: () => start.mutate() }],
                )}
              />
              <Btn small variant="outline" label="Offer colleagues a seat" onPress={() => setInviting(true)} testID="invite-colleagues" />
            </Row>
          </View>
        ) : null}

        {mayRun && season.status === "running" ? (
          <TitledCard icon="people" title="Tables">
            {watch.isLoading ? <Loading /> : null}
            {(watch.data?.tables ?? []).map((t) => (
              <View key={t.ventureId} style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border, gap: 3 }} testID={`table-${t.ventureId}`}>
                <Row between center>
                  <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }} numberOfLines={1}>
                    {t.name || "An unnamed table"}
                  </Text>
                  <Pill label={`${t.filed}/${t.of} filed`} tone={t.filed === t.of ? "good" : "warn"} />
                </Row>
                {t.empty ? (
                  <Text style={{ color: colors.warning, fontSize: font.xs }}>
                    {t.empty} {t.empty === 1 ? "chair" : "chairs"} nobody has taken — this table cannot start.
                  </Text>
                ) : null}
                {/* The sentence a facilitator is actually after: whose turn it is to be chased. */}
                {t.waitingOn.length ? (
                  <Text style={{ color: colors.textSecondary, fontSize: font.xs }}>Waiting on {t.waitingOn.join(", ")}</Text>
                ) : (
                  <Text style={{ color: colors.textTertiary, fontSize: font.xs }}>Everyone has filed.</Text>
                )}
                <Row wrap gap={4}>
                  {t.chairs.map((c) => (
                    <Pill
                      key={c.userId}
                      label={`${c.name}${c.roleTitle ? ` · ${c.roleTitle}` : ""}`}
                      tone={c.filed ? "good" : c.isBot ? "neutral" : "warn"}
                    />
                  ))}
                </Row>
              </View>
            ))}
            <Btn
              small
              variant="outline"
              label={`End this ${period.one} now`}
              loading={resolveNow.isPending}
              testID="resolve-year-now"
              style={{ marginTop: spacing.sm }}
              onPress={() => Alert.alert(
                `End the ${period.one} now?`,
                "It resolves with whatever has been filed. Anyone who has not filed gets no decision this time.",
                [{ text: "Wait", style: "cancel" }, { text: "End it", onPress: () => resolveNow.mutate() }],
              )}
            />
          </TitledCard>
        ) : null}

        {mayRun && report.data ? <StaffReportCard report={report.data} /> : null}

        {!mayRun ? (
          <Callout icon="eye" tone="info" body="Running a season needs the Run training seasons power. You can still join one you have a seat in." />
        ) : null}

        {inviting ? (
          <InviteColleagues
            base={base}
            members={members}
            onClose={() => setInviting(false)}
            notify={notify}
          />
        ) : null}
      </View>
    </Sheet>
  );
}

/**
 * Who played, and how.
 *
 * Everything in it is counted from what was stored — decisions filed,
 * objectives marked, the engine's own year reports — and the server assembles
 * the one line of prose from those numbers. It is shown as sent, because a
 * second sentence written here could say something the numbers do not.
 */
function StaffReportCard({ report }: { report: StaffReport }) {
  return (
    <TitledCard icon="document-text" title="The staff report">
      <Text style={text.meta}>
        {report.season.yearsResolved} of {report.season.totalYears} resolved. Counted from what was filed, not from anybody's impression.
      </Text>
      {report.players.map((p) => (
        <View key={p.userId} style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border, gap: 2 }} testID={`report-${p.userId}`}>
          <Row gap={spacing.sm} center>
            <Avatar name={p.name} uri={p.avatarUrl} size={28} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }} numberOfLines={1}>{p.name}</Text>
              <Text style={{ color: colors.textTertiary, fontSize: font.xs }} numberOfLines={1}>
                {[p.roleTitle, p.teamName].filter(Boolean).join(" · ")}
              </Text>
            </View>
            {p.rank != null ? <Pill label={`${p.rank} of ${p.companiesInMarket ?? "?"}`} tone={p.rank === 1 ? "good" : "neutral"} /> : null}
          </Row>
          <Text style={{ color: colors.textSecondary, fontSize: font.xs }}>{p.read}</Text>
        </View>
      ))}
      {/*
        * Named rather than counted. "Four people did not play" is a number
        * somebody has to go and work out; the names are the thing a manager
        * reading this does something about.
        */}
      {report.notPlaying.length ? (
        <Text style={[text.small, { marginTop: 4 }]} testID="report-not-playing">
          Did not play: {report.notPlaying.map((m) => m.name).join(", ")}.
        </Text>
      ) : null}
    </TitledCard>
  );
}

/**
 * Telling colleagues there is a seat.
 *
 * The server skips anybody not in the company rather than failing, "since the
 * list comes from a screen that may be a moment out of date" — so this sends
 * who it has and does not try to re-check membership first.
 */
function InviteColleagues({
  base, members, onClose, notify,
}: {
  base: string; members: CompanyMember[]; onClose: () => void; notify: (n: Notice) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);

  const invite = useMutation({
    mutationFn: () => api(`${base}/invite`, { method: "POST", body: { userIds: picked } }),
    onSuccess: () => { notify({ text: "Told them there's a seat.", tone: "success" }); onClose(); },
    /* "This season has already started, so there are no seats left to offer." */
    onError: (e) => notify({ text: errText(e, "Couldn't tell them."), tone: "error" }),
  });

  return (
    <Sheet visible onClose={onClose} title="Offer a seat" subtitle="Everyone you pick hears there is a place for them">
      <Text style={text.small}>
        Inviting somebody is a promise that there is a place for them, so pick the people you actually expect.
      </Text>
      {members.map((m) => {
        const on = picked.includes(m.userId);
        return (
          <Pressable
            key={m.userId}
            testID={`invite-${m.userId}`}
            onPress={() => setPicked(on ? picked.filter((x) => x !== m.userId) : [...picked, m.userId])}
            style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 7 }}
          >
            <Avatar name={memberName(m)} uri={m.avatarUrl} size={28} />
            <Text style={{ flex: 1, color: colors.text, fontSize: font.sm }} numberOfLines={1}>{memberName(m)}</Text>
            <Pill label={on ? "will be told" : "no"} tone={on ? "good" : "neutral"} />
          </Pressable>
        );
      })}
      <Btn
        label={picked.length ? `Tell ${picked.length}` : "Pick somebody"}
        loading={invite.isPending}
        disabled={!picked.length}
        onPress={() => invite.mutate()}
        testID="send-season-invites"
      />
    </Sheet>
  );
}
