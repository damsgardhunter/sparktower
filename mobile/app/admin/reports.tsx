import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Card, Empty, Loading, Screen, Segments, errText } from "../../src/components/ui";
import { PageIntro, Pill } from "../../src/components/MoreKit";
import { NoticeBanner, Sheet, useNotice, type Notice } from "../../src/components/Sheet";
import {
  ChoiceList, ConfirmSheet, LinkPill, NotFoundScreen, gateView, blockedView, isNotFound, text, useReviewer,
} from "../../src/components/more/AdminKit";

// --- shared/moderation.ts, restated ----------------------------------------

const TARGET_LABEL: Record<string, string> = {
  check_in: "Check-in (retired)", comment: "Comment", feed_post: "Post", feed_comment: "Comment", project: "Project", user: "Person",
};
const REPORT_REASONS: Record<string, string> = {
  spam: "Spam or advertising", abuse: "Harassment or abuse", misleading: "Misleading or fake",
  inappropriate: "Sexual or graphic content", other: "Something else",
};
const reportReasonLabel = (id: string) => REPORT_REASONS[id] ?? id;

type ModerationAction = "remove" | "shadow_hide" | "ban" | "dismiss";
const MODERATION_ACTIONS: { id: ModerationAction; label: string; detail: string }[] = [
  { id: "remove", label: "Remove", detail: "Hidden from everyone, its author included." },
  { id: "shadow_hide", label: "Shadow-hide", detail: "Hidden from everyone but its author, who still sees it as posted." },
  { id: "ban", label: "Ban author", detail: "Suspends the author's account and removes the comment." },
  { id: "dismiss", label: "Dismiss", detail: "No rule broken. The comment stays; the report closes." },
];
const REASON_CODES = [
  { id: "spam", label: "Spam or advertising", kind: "violation" },
  { id: "harassment", label: "Harassment or abuse", kind: "violation" },
  { id: "hate", label: "Hate or slurs", kind: "violation" },
  { id: "sexual", label: "Sexual or graphic content", kind: "violation" },
  { id: "misleading", label: "Misleading or a scam", kind: "violation" },
  { id: "off_topic", label: "Off-topic or disruptive", kind: "violation" },
  { id: "no_violation", label: "No rule broken", kind: "dismissal" },
  { id: "duplicate", label: "Already handled", kind: "dismissal" },
  { id: "insufficient_context", label: "Not enough to act on", kind: "dismissal" },
] as const;
const reasonCodesFor = (action: ModerationAction) =>
  REASON_CODES.filter((r) => r.kind === (action === "dismiss" ? "dismissal" : "violation")).map((r) => ({ id: r.id as string, label: r.label }));
const moderationReasonLabel = (id: string | null | undefined) =>
  REASON_CODES.find((r) => r.id === id)?.label ?? (id || "No reason code");

/** How a log entry reads in the history list. */
const ACTION_WORDS: Record<string, string> = {
  comment_remove: "Removed", comment_shadow_hide: "Shadow-hidden", comment_ban: "Author banned, comment removed",
  comment_dismiss: "Dismissed", content_hidden: "Taken down", content_restored: "Restored",
};

type Status = "open" | "actioned" | "dismissed";
const TABS: { value: Status; label: string }[] = [
  { value: "open", label: "Open" }, { value: "actioned", label: "Actioned" }, { value: "dismissed", label: "Dismissed" },
];

interface Report {
  id: string;
  targetType: string;
  targetId: string;
  targetPostId?: string | null;
  targetHidden?: boolean | null;
  targetHiddenMode?: string | null;
  projectId: string | null;
  reason: string;
  note: string | null;
  snapshot: string | null;
  status: Status;
  createdAt: string;
  reporterName: string;
  ownerName: string | null;
  ownerId: string | null;
  ownerSuspended: boolean;
  actionable?: boolean;
}

/** Where a reported thing lives in the app, so a moderator can go and look at it. */
function targetRoute(r: Report): string | null {
  // Check-ins are retired: old reports keep their label but have nowhere to go.
  if (r.targetType === "check_in") return null;
  if (r.targetPostId) return `/post/${r.targetPostId}`;
  if (r.targetType === "project") return `/project/${r.targetId}`;
  if (r.targetType === "user") return `/user/${r.targetId}`;
  if (r.projectId) return `/project/${r.projectId}`;
  return null;
}

/**
 * The moderation queue — the web's /admin/reports. Every report carries the
 * snapshot taken when it was filed; comments are decided with an action and a
 * reason code, everything else with the older resolve / take down / suspend.
 */
export default function AdminReports() {
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const router = useRouter();
  const { loading, isReviewer } = useReviewer();
  const [tab, setTab] = useState<Status>("open");
  const [kind, setKind] = useState<"all" | "comment">("all");

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin-reports", tab, kind],
    queryFn: () => api<Report[]>(`/api/admin/reports?status=${tab}${kind === "all" ? "" : `&type=${kind}`}`),
    enabled: isReviewer,
    retry: false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-reports"] });
    qc.invalidateQueries({ queryKey: ["admin-moderation-log"] });
    // Every decision is an action the safety review measures and a report it no longer counts.
    qc.invalidateQueries({ queryKey: ["safety-review"] });
    qc.invalidateQueries({ queryKey: ["safety-status"] });
  };

  const gate = gateView("Reports", loading, isReviewer);
  if (gate) return gate;
  // Locked behind a second factor, or simply not this account's page (src/components/more/AdminKit.tsx).
  const blocked = blockedView("Reports", error);
  if (blocked) return blocked;

  const list = data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <Stack.Screen options={{ title: "Reports" }} />
      <Screen canvas onRefresh={() => refetch()} refreshing={isRefetching}>
        <PageIntro
          icon="shield-half"
          title="Reports"
          body="Everything people have flagged. Nothing is removed automatically — this queue is the only thing that acts."
        />
        <View style={{ flexDirection: "row" }}>
          <LinkPill label="Daily safety review" onPress={() => router.push("/admin/safety" as any)} />
        </View>

        <Segments options={TABS} value={tab} onChange={setTab} />
        <Segments options={[{ value: "all", label: "All kinds" }, { value: "comment", label: "Comments" }]} value={kind} onChange={setKind} />

        {isLoading ? <View style={{ height: 200 }}><Loading /></View>
          : error ? <Empty icon="cloud-offline-outline" title="Couldn't load the queue" body={errText(error)} action="Try again" onAction={() => refetch()} />
          : list.length === 0 ? (
            <Card>
              <Empty icon="flag-outline" title={`Nothing ${tab}`} body={tab === "open" ? "No reports waiting." : `No ${tab} reports.`} />
            </Card>
          ) : list.map((r) => <ReportCard key={r.id} report={r} onDone={refresh} show={show} />)}
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}

function ReportCard({ report: r, onDone, show }: { report: Report; onDone: () => void; show: (n: Notice) => void }) {
  const nav = useRouter();
  const link = targetRoute(r);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [confirm, setConfirm] = useState<null | "takedown" | "restore" | "suspend" | "reinstate">(null);

  const resolve = useMutation({
    mutationFn: (status: "actioned" | "dismissed") =>
      api(`/api/admin/reports/${r.id}`, { method: "PATCH", body: { status, note } }),
    onSuccess: (_x, status) => {
      show({ tone: "success", text: status === "actioned" ? "Marked actioned" : "Dismissed" });
      setNote(""); setNoteOpen(false);
      onDone();
    },
    onError: (e) => show({ tone: "error", text: errText(e, "Couldn't update that") }),
  });

  const takedown = useMutation({
    mutationFn: (hide: boolean) =>
      api<{ hidden: boolean }>(`/api/admin/content/${r.targetType}/${r.targetId}/${hide ? "hide" : "restore"}`, { method: "POST", body: { reason: note.trim() || undefined } }),
    onSuccess: (res) => {
      setConfirm(null);
      show({ tone: "success", text: res.hidden ? "Taken down — hidden from everyone but its author" : "Restored" });
      onDone();
    },
    onError: (e) => { setConfirm(null); show({ tone: "error", text: errText(e) }); },
  });

  const suspend = useMutation({
    mutationFn: (suspended: boolean) =>
      api<{ suspended: boolean }>(`/api/admin/users/${r.ownerId}/suspend`, { method: "POST", body: { suspended, reason: note.trim() || undefined } }),
    onSuccess: (res) => {
      setConfirm(null);
      show({ tone: "success", text: res.suspended ? "Account suspended" : "Account reinstated" });
      onDone();
    },
    onError: (e) => { setConfirm(null); show({ tone: "error", text: `Couldn't change that account. ${errText(e, "Try again.")}` }); },
  });

  const canHide = r.targetHidden !== null && r.targetHidden !== undefined;

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Pill label={TARGET_LABEL[r.targetType] ?? r.targetType} color={colors.textSecondary} />
            <Pill label={reportReasonLabel(r.reason)} solid />
            {r.targetHiddenMode ? <Pill label={r.targetHiddenMode === "shadow" ? "shadow-hidden" : "removed"} color={colors.info} /> : null}
            {r.ownerSuspended ? <Pill label="author suspended" icon="person-remove" color={colors.danger} solid /> : null}
          </View>
          <Text style={text.small}>
            Reported by {r.reporterName}{r.ownerName ? ` · author ${r.ownerName}` : ""} · {new Date(r.createdAt).toLocaleString()}
          </Text>
        </View>
        {link ? <Btn label="Open" icon="open-outline" small variant="outline" onPress={() => nav.push(link as any)} /> : null}
      </View>

      {r.note ? (
        <Text style={text.body}><Text style={{ color: colors.textSecondary, fontFamily: fontFamily.regular }}>They said: </Text>{r.note}</Text>
      ) : null}

      {/* Kept at report time, so a deletion can't erase the evidence. */}
      {r.snapshot ? (
        <View style={{ borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, padding: spacing.sm, gap: 4 }}>
          <Text style={text.over}>What was reported</Text>
          <Text style={[text.small, { color: colors.text }]} numberOfLines={6}>{r.snapshot}</Text>
        </View>
      ) : null}

      {r.actionable && r.status === "open" ? (
        <View style={{ borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm }}>
          <Btn label="Decide" icon="hammer-outline" small onPress={() => setDeciding(true)} style={{ alignSelf: "flex-start" }} />
        </View>
      ) : null}
      {r.actionable ? <History targetType={r.targetType} targetId={r.targetId} /> : null}

      {!r.actionable && r.status === "open" ? (
        <View style={{ borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm, gap: spacing.sm }}>
          {noteOpen ? (
            <NoteInput value={note} onChange={setNote} placeholder="Note for the record — and the reason shown to the author if you suspend." />
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Btn label="Actioned" icon="checkmark" small disabled={resolve.isPending} onPress={() => resolve.mutate("actioned")} />
            <Btn label="Dismiss" icon="close" small variant="outline" disabled={resolve.isPending} onPress={() => resolve.mutate("dismissed")} />
            {!noteOpen ? <Btn label="Add a note" small variant="ghost" onPress={() => setNoteOpen(true)} /> : null}
            {canHide ? (
              <Btn
                label={r.targetHidden ? "Restore content" : "Take down"}
                small
                variant={r.targetHidden ? "outline" : "danger"}
                disabled={takedown.isPending}
                onPress={() => setConfirm(r.targetHidden ? "restore" : "takedown")}
              />
            ) : null}
            {r.ownerId ? (
              <Btn
                label={r.ownerSuspended ? "Reinstate author" : "Suspend author"}
                icon={r.ownerSuspended ? "person-add-outline" : "person-remove-outline"}
                small
                variant={r.ownerSuspended ? "outline" : "danger"}
                disabled={suspend.isPending}
                onPress={() => setConfirm(r.ownerSuspended ? "reinstate" : "suspend")}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {deciding ? <DecideSheet report={r} onClose={() => setDeciding(false)} onDone={onDone} show={show} /> : null}

      {confirm === "takedown" || confirm === "restore" ? (
        <ConfirmSheet
          visible
          onClose={() => setConfirm(null)}
          title={confirm === "takedown" ? "Take this down?" : "Restore this content?"}
          body={confirm === "takedown"
            ? "It's hidden from everyone but its author, who sees why. Say why — the author sees it, and so does the log."
            : "It goes back to being visible to everyone."}
          confirmLabel={confirm === "takedown" ? "Take down" : "Restore"}
          danger={confirm === "takedown"}
          loading={takedown.isPending}
          disabled={confirm === "takedown" && !note.trim()}
          onConfirm={() => takedown.mutate(confirm === "takedown")}
        >
          {confirm === "takedown" ? <NoteInput value={note} onChange={setNote} placeholder="Why it's coming down (required)" /> : null}
        </ConfirmSheet>
      ) : null}

      {confirm === "suspend" || confirm === "reinstate" ? (
        <ConfirmSheet
          visible
          onClose={() => setConfirm(null)}
          title={confirm === "suspend" ? `Suspend ${r.ownerName ?? "this author"}?` : `Reinstate ${r.ownerName ?? "this author"}?`}
          body={confirm === "suspend"
            ? "Separate from resolving the report. The note below is the reason shown to them."
            : "Their account works again straight away."}
          confirmLabel={confirm === "suspend" ? "Suspend" : "Reinstate"}
          danger={confirm === "suspend"}
          loading={suspend.isPending}
          onConfirm={() => suspend.mutate(confirm === "suspend")}
        >
          {confirm === "suspend" ? <NoteInput value={note} onChange={setNote} placeholder="Reason shown to the author (optional)" /> : null}
        </ConfirmSheet>
      ) : null}
    </Card>
  );
}

/**
 * Deciding a reported comment: an action and a reason code, both required.
 * The code is what makes a mistake findable later; the server keeps what the
 * comment looked like before, so it can be put back.
 */
function DecideSheet({ report, onClose, onDone, show }: { report: Report; onClose: () => void; onDone: () => void; show: (n: Notice) => void }) {
  const nav = useRouter();
  const [action, setAction] = useState<ModerationAction | "">("");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const chosen = MODERATION_ACTIONS.find((a) => a.id === action);

  const act = useMutation({
    mutationFn: () => api<{ logId?: string }>(`/api/admin/reports/${report.id}/act`, {
      method: "POST", body: { action, reasonCode, note: note.trim() || undefined },
    }),
    onSuccess: (res) => {
      onClose();
      show({
        tone: "success",
        text: `${chosen?.label ?? "Done"} — ${moderationReasonLabel(reasonCode)}. Recorded in the moderation log.`,
        action: res?.logId ? { label: "See impact", onPress: () => nav.push("/admin/safety" as any) } : undefined,
      });
      onDone();
    },
    onError: (e) => show({ tone: "error", text: `Couldn't apply that. ${errText(e)}` }),
  });

  return (
    <Sheet visible onClose={onClose} title="Decide this report" subtitle={`${TARGET_LABEL[report.targetType] ?? "Comment"} · ${reportReasonLabel(report.reason)}`}>
      {!action ? (
        <>
          <Text style={text.over}>Action</Text>
          <ChoiceList options={MODERATION_ACTIONS} value={action} onChange={(v) => { setAction(v); setReasonCode(""); }} />
        </>
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={text.over}>Action</Text>
              <Text style={text.strong}>{chosen?.label}</Text>
              <Text style={text.small}>{chosen?.detail}</Text>
            </View>
            <Btn label="Change" small variant="ghost" onPress={() => { setAction(""); setReasonCode(""); }} />
          </View>
          <Text style={text.over}>Reason code</Text>
          <ChoiceList options={reasonCodesFor(action)} value={reasonCode} onChange={setReasonCode} />
          <NoteInput value={note} onChange={setNote} placeholder="Note for the log (optional)" />
          <Btn
            label="Apply"
            loading={act.isPending}
            disabled={!reasonCode}
            onPress={() => act.mutate()}
            style={action !== "dismiss" ? { backgroundColor: colors.danger } : undefined}
          />
        </>
      )}
    </Sheet>
  );
}

/** What has been done to one reported thing, from the moderation log. */
function History({ targetType, targetId }: { targetType: string; targetId: string }) {
  const { data } = useQuery({
    queryKey: ["admin-moderation-log", targetType, targetId],
    queryFn: () => api<any[]>(`/api/admin/moderation-log?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`).catch(() => []),
  });
  if (!data?.length) return null;
  return (
    <View style={{ borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: 4 }}>
      <Text style={text.over}>History</Text>
      {data.map((e) => (
        <Text key={e.id} style={[text.small, { color: colors.text }]}>
          <Text style={{ fontFamily: fontFamily.semibold }}>{ACTION_WORDS[e.action] ?? e.action}</Text>
          {" · "}{moderationReasonLabel(e.reasonCode)}{" · "}{e.actorName ?? "a reviewer"}{" · "}{new Date(e.createdAt).toLocaleString()}
          {e.reason ? <Text style={{ color: colors.textTertiary }}> — “{e.reason}”</Text> : null}
        </Text>
      ))}
    </View>
  );
}

function NoteInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      multiline
      maxLength={500}
      placeholder={placeholder}
      placeholderTextColor={colors.textTertiary}
      style={{
        minHeight: 56, textAlignVertical: "top", backgroundColor: colors.surfaceRaised, borderRadius: radius.sm,
        borderWidth: 1, borderColor: colors.border, padding: spacing.sm, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular,
      }}
    />
  );
}
