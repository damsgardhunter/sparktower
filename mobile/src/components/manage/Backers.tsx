/**
 * Who backed this project, and what the team still owes them — the phone's half
 * of client/src/components/manager/backers-tab.tsx.
 *
 * Read that file first; the reasoning is there. The short version: early access
 * and a personal video thank-you are the two rewards a person has to go and *do*,
 * and nothing recorded whether they had. Everything else a tier promises is true
 * the moment the pledge lands.
 *
 * ## Why this belongs on a phone more than the web half does
 *
 * A thank-you video is recorded on a phone. The web can only take an upload of a
 * file somebody has already moved across; here the camera roll is one tap away,
 * which makes this the surface the feature was actually for. The web tab arrived
 * first because that is where the rest of the manager lives, not because it was
 * the better home.
 *
 * ## What it does not show
 *
 * No email address and no postal address, the same as the web: the route sends
 * neither, because the whole team can open this and nobody needs to read an
 * address by hand. The owner's own list, with both on it, is on the web behind an
 * owner-only route.
 */
import { useState } from "react";
import { Linking, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_URL } from "../../api/client";
import { openWebSignedIn } from "../../networkData";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Avatar, Btn, Empty, Icon, Loading, errText } from "../ui";
import { Callout, TitledCard } from "../MoreKit";
import { Pill } from "../nova/Pill";
import { NoticeBanner, Sheet, useNotice } from "../Sheet";
import { StatBox, StatGrid, text } from "../more/AdminKit";
import { pickPhoto } from "../../photos";
import { uploadFile } from "../../api/client";

interface Task {
  rewardKey: string;
  label: string;
  done: boolean;
  deliveredAt: string | null;
  deliveredByName: string | null;
  note: string | null;
  hasVideo: boolean;
}

interface MerchOrder {
  id: string;
  status: "queued" | "submitted" | "shipped" | "failed" | "canceled";
  items: string[];
  trackingUrl: string | null;
  submittedAt: string | null;
  lastError: string | null;
}

interface Backer {
  backingId: string;
  believerNumber: number | null;
  name: string;
  anonymousOnWall: boolean;
  avatarUrl: string | null;
  amountCents: number;
  tierName: string | null;
  backedAt: string;
  message: string | null;
  tasks: Task[];
  merchPromised: string[];
  merchOrders: MerchOrder[];
  hasShippingAddress: boolean;
}

interface Fulfilment {
  rewards: { key: string; label: string; description: string }[];
  backers: Backer[];
  owed: number;
  done: number;
  merchInFlight: number;
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

/** How a merch order reads, and whether it is somebody's problem. Mirrors the web's. */
const MERCH: Record<MerchOrder["status"], { label: string; tone: "neutral" | "warn" | "good" | "bad" }> = {
  queued: { label: "Waiting to go out", tone: "warn" },
  submitted: { label: "With the printer", tone: "warn" },
  shipped: { label: "Shipped", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  canceled: { label: "Canceled", tone: "neutral" },
};

export function Backers({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const key = ["project", projectId, "fulfilment"];

  const q = useQuery<Fulfilment>({
    queryKey: key,
    queryFn: () => api<Fulfilment>(`/api/projects/${projectId}/backing/fulfilment`),
    enabled: !!projectId,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: key });

  /* The video being sent, if any: one sheet for whichever backer was picked. */
  const [sending, setSending] = useState<{ backer: Backer; task: Task } | null>(null);
  const [assetPath, setAssetPath] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [picking, setPicking] = useState(false);

  const openSheet = (backer: Backer, task: Task) => {
    setAssetPath(null);
    setPicked(null);
    setNote("");
    setSending({ backer, task });
  };

  const mark = useMutation({
    mutationFn: (body: { backingId: string; rewardKey: string; assetPath?: string; note?: string }) =>
      api(`/api/projects/${projectId}/backing/fulfilment`, { method: "POST", body }),
    onSuccess: () => {
      setSending(null);
      refresh();
      /* Said out loud, because the backer is told too and whoever pressed it should know. */
      show({ text: "Marked done — the backer has been told.", tone: "success" });
    },
    onError: (e) => show({ text: errText(e, "Couldn't record that."), tone: "error" }),
  });

  const undo = useMutation({
    mutationFn: (body: { backingId: string; rewardKey: string }) =>
      api(`/api/projects/${projectId}/backing/fulfilment/${body.backingId}/${body.rewardKey}`, { method: "DELETE" }),
    onSuccess: () => { refresh(); show({ text: "Back on the list.", tone: "info" }); },
    onError: (e) => show({ text: errText(e, "Couldn't undo that."), tone: "error" }),
  });

  const pick = async () => {
    try {
      setPicking(true);
      /*
       * The camera roll, which is the point of doing this here: a thank-you is
       * recorded on a phone and is already sitting in it.
       */
      const file = await pickPhoto({ videos: true });
      if (!file) return;
      setAssetPath(await uploadFile(file));
      setPicked(file.name);
    } catch (e) {
      show({ text: errText(e, "Couldn't use that video."), tone: "error" });
    } finally {
      setPicking(false);
    }
  };

  if (q.isLoading) return <Loading />;
  if (!q.data?.backers.length) {
    return (
      <Empty
        icon="heart-outline"
        title="Nobody has backed this project yet"
        body="When they do, this is where you'll see what each tier promised them and tick it off as you do it. Setting the tiers up is on the web."
      />
    );
  }

  const d = q.data;
  /*
   * Outstanding first. The question is "what do I have to do today", and a list
   * ordered by who paid most buries the person still waiting three weeks later.
   */
  const outstanding = d.backers.filter((b) => b.tasks.some((t) => !t.done) || b.merchOrders.some((o) => o.status === "failed"));
  const settled = d.backers.filter((b) => !outstanding.includes(b));
  const busy = mark.isPending || undo.isPending;

  return (
    <>
      <View style={{ gap: spacing.md }}>
        <StatGrid>
          <StatBox label="Backers" value={d.backers.length} />
          <StatBox label="Still to do" value={d.owed} state={d.owed ? "warn" : "good"} />
          <StatBox label="Done" value={d.done} state={d.done ? "good" : undefined} />
          <StatBox label="Merch on its way" value={d.merchInFlight} state={d.merchInFlight ? "warn" : undefined} />
        </StatGrid>

        {d.owed === 0 ? (
          <Text style={text.meta} testID="text-all-done">
            Nothing outstanding. Everything your tiers promise that a person has to do has been done.
          </Text>
        ) : null}

        {outstanding.length ? (
          <TitledCard icon="alert-circle" title="Still to do" tint={colors.warning}>
            {outstanding.map((b) => (
              <BackerRow key={b.backingId} backer={b} busy={busy} projectId={projectId}
                onDo={(task) => (task.rewardKey === "video_thankyou"
                  ? openSheet(b, task)
                  : mark.mutate({ backingId: b.backingId, rewardKey: task.rewardKey }))}
                onUndo={(task) => undo.mutate({ backingId: b.backingId, rewardKey: task.rewardKey })} />
            ))}
          </TitledCard>
        ) : null}

        {settled.length ? (
          <TitledCard icon="checkmark-done" title="Everyone else">
            {settled.map((b) => (
              <BackerRow key={b.backingId} backer={b} busy={busy} projectId={projectId}
                onDo={(task) => (task.rewardKey === "video_thankyou"
                  ? openSheet(b, task)
                  : mark.mutate({ backingId: b.backingId, rewardKey: task.rewardKey }))}
                onUndo={(task) => undo.mutate({ backingId: b.backingId, rewardKey: task.rewardKey })} />
            ))}
          </TitledCard>
        ) : null}

        <Callout
          icon="desktop"
          tone="info"
          body="Setting up the tiers and what each one promises is on the web. Addresses are too — the printer is handed them directly, and this list is open to the whole team."
        />
      </View>

      {/* Sending the video. A link and a sentence; the file is optional on purpose. */}
      <Sheet
        visible={!!sending}
        onClose={() => setSending(null)}
        title={`Send ${sending?.backer.name ?? "them"} their video`}
        subtitle="They're told as soon as you do, and can watch it on their profile."
      >
        <Btn
          label={picked ?? "Choose a video"}
          icon="videocam-outline"
          variant="outline"
          loading={picking}
          onPress={() => void pick()}
          testID="pick-video"
        />
        <Text style={[text.small, { marginTop: spacing.xs }]}>
          {/*
            * Marking it done with no file is allowed on purpose: plenty of people
            * will send the video another way and still want the list to be true.
            */}
          Record it and pick it from your camera roll. You can also mark this done
          without a file if you sent it some other way.
        </Text>

        <Text style={[text.small, { marginTop: spacing.md }]}>A line to go with it (optional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={1000}
          placeholder="Thanks for being one of the first."
          placeholderTextColor={colors.textTertiary}
          style={{
            backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, borderWidth: 1,
            borderColor: colors.border, padding: spacing.md, minHeight: 60,
            color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular,
          }}
          testID="input-video-note"
        />

        <Btn
          label={assetPath ? "Send it" : "Mark done"}
          style={{ marginTop: spacing.lg }}
          loading={mark.isPending}
          onPress={() => sending && mark.mutate({
            backingId: sending.backer.backingId,
            rewardKey: sending.task.rewardKey,
            assetPath: assetPath ?? undefined,
            note: note.trim() || undefined,
          })}
          testID="send-video"
        />
      </Sheet>

      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}

function BackerRow({ backer, onDo, onUndo, busy, projectId }: {
  backer: Backer;
  onDo: (task: Task) => void;
  onUndo: (task: Task) => void;
  busy: boolean;
  projectId: string;
}) {
  return (
    <View style={{ paddingVertical: spacing.sm, borderTopWidth: 1, borderColor: colors.border, gap: 6 }} testID={`backer-${backer.backingId}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Avatar uri={backer.avatarUrl} name={backer.name} size={30} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[text.body, { fontFamily: fontFamily.semibold }]}>
            {backer.name}{backer.believerNumber != null ? ` · #${backer.believerNumber}` : ""}
          </Text>
          <Text style={text.small}>
            {money(backer.amountCents)}{backer.tierName ? ` · ${backer.tierName}` : ""} · {when(backer.backedAt)}
          </Text>
        </View>
        {/*
          * Said, not hidden. They are anonymous on the public wall, and whoever is
          * recording them a video still has to know who it is for.
          */}
        {backer.anonymousOnWall ? <Pill label="anon" tone="neutral" /> : null}
      </View>

      {backer.message ? <Text style={[text.small, { fontStyle: "italic" }]}>“{backer.message}”</Text> : null}

      {backer.tasks.length === 0 && backer.merchPromised.length === 0 ? (
        <Text style={text.small}>Their tier promises nothing you have to do by hand.</Text>
      ) : null}

      {backer.tasks.map((task) => (
        <View key={task.rewardKey} style={{ gap: 4 }} testID={`task-${backer.backingId}-${task.rewardKey}`}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon
              name={task.rewardKey === "video_thankyou" ? "videocam-outline" : "log-in-outline"}
              size={15}
              color={task.done ? colors.success : colors.warning}
            />
            <Text style={[text.body, { flex: 1 }]}>{task.label}</Text>
            <Pill label={task.done ? "done" : "owed"} tone={task.done ? "good" : "warn"} />
          </View>
          {task.done ? (
            <Text style={text.small}>
              {when(task.deliveredAt)}{task.deliveredByName ? ` · ${task.deliveredByName}` : ""}
              {task.note ? ` · “${task.note}”` : ""}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {task.done ? (
              <Btn label="Undo" small variant="ghost" disabled={busy} onPress={() => onUndo(task)} testID={`undo-${backer.backingId}-${task.rewardKey}`} />
            ) : (
              <Btn
                label={task.rewardKey === "video_thankyou" ? "Send a video" : "Mark done"}
                small variant="outline" disabled={busy}
                onPress={() => onDo(task)}
                testID={`do-${backer.backingId}-${task.rewardKey}`}
              />
            )}
            {task.done && task.hasVideo ? (
              <Btn
                label="Watch"
                small variant="ghost"
                /*
                 * Through the signed hand-off, not a bare URL. The video route
                 * requires a session, and a browser opened from here has none —
                 * so a plain `openURL` would have shown a 401 to the person who
                 * recorded it. `openWebSignedIn` trades the app's token for a
                 * short-lived web session first, which is what every other
                 * phone-to-web link in this app does.
                 */
                onPress={() => void openWebSignedIn(
                  `${API_URL}/api/projects/${projectId}/backing/fulfilment/${backer.backingId}/${task.rewardKey}/video`,
                  (url) => WebBrowser.openBrowserAsync(url),
                ).catch(() => {})}
                testID={`watch-${backer.backingId}`}
              />
            ) : null}
          </View>
        </View>
      ))}

      {backer.merchPromised.length || backer.merchOrders.length ? (
        <View style={{ backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.sm, gap: 4 }} testID={`merch-${backer.backingId}`}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="cube-outline" size={14} color={colors.textSecondary} />
            <Text style={[text.small, { fontFamily: fontFamily.semibold }]}>
              {backer.merchPromised.join(", ") || "Merch"}
            </Text>
          </View>
          {backer.merchOrders.length === 0 ? (
            <Text style={text.small}>No order yet — one is created once the project has been approved.</Text>
          ) : backer.merchOrders.map((order) => (
            <View key={order.id} style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <Pill label={MERCH[order.status].label} tone={MERCH[order.status].tone} />
              {order.items.length ? <Text style={text.small}>{order.items.join(", ")}</Text> : null}
              {order.submittedAt ? <Text style={text.small}>sent {when(order.submittedAt)}</Text> : null}
              {order.trackingUrl ? (
                <Btn label="Track it" small variant="ghost" onPress={() => void Linking.openURL(order.trackingUrl!)} testID={`tracking-${order.id}`} />
              ) : null}
              {order.lastError ? <Text style={[text.small, { color: colors.danger }]}>{order.lastError}</Text> : null}
            </View>
          ))}
          {/*
            * The one shipping problem a person has to chase. The address itself is
            * not here — see the file's own note.
            */}
          {!backer.hasShippingAddress ? (
            <Text style={[text.small, { color: colors.danger }]} testID={`no-address-${backer.backingId}`}>
              No address on file — ask them for one.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
