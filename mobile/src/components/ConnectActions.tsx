/**
 * Connect, Message and Follow — the mobile side of the cards' quick actions.
 *
 * The same flow as the web app's (client/src/components/discover-actions.tsx),
 * against the same endpoints:
 *
 *  - Message only once you're connected, because the server only lets
 *    connected people message each other. Offering it earlier is a button that
 *    always fails — which this screen used to do.
 *  - Connect asks first, with room for a note: the one thing you can say before
 *    they accept. The card says "Requested" at once.
 *  - The composer opens already written from why you matched; one tap sends.
 *  - Follow flips at once, sends the state it wants rather than a toggle, and
 *    goes back if the server refuses.
 *
 * Every outcome is a notice, success or not. What sticks is what the server
 * has — a returning screen re-reads it, so nothing here is kept on the phone.
 */
import { useState } from "react";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { spacing } from "../theme";
import { Btn, Chip, Field, Meta, Row } from "./ui";
import { Sheet, type Notice } from "./Sheet";
import { messageTemplates } from "../messageTemplates";

/** Restated from shared/moderation.ts, where the server enforces it. */
export const CONNECTION_NOTE_MAX = 280;

export type ConnectionStateName = "none" | "requested" | "incoming" | "connected" | "declined";
export interface ConnectionState { state: ConnectionStateName; connectionId: string | null }

/** Where you stand with everyone on the screen, in one request. */
export function useConnectionStates(userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean))).sort().slice(0, 100);
  return useQuery({
    queryKey: ["connection-states", ids.join(",")],
    queryFn: () => api<Record<string, ConnectionState>>(`/api/connections/statuses?ids=${encodeURIComponent(ids.join(","))}`),
    enabled: ids.length > 0,
  });
}

export function ConnectActions({ userId, name, reason, headline, connection, notify }: {
  userId: string;
  name: string;
  reason?: string | null;
  headline?: string | null;
  connection?: ConnectionState;
  notify: (notice: Notice) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();

  // What the button shows while the server catches up; its answer wins once it lands.
  const [pending, setPending] = useState<ConnectionStateName | null>(null);
  const state: ConnectionStateName = pending ?? connection?.state ?? "none";

  const [connectOpen, setConnectOpen] = useState(false);
  const [note, setNote] = useState("");
  const templates = messageTemplates({ name, reason, headline });
  const [messageOpen, setMessageOpen] = useState(false);
  const [templateId, setTemplateId] = useState(templates[0].id);
  const [draft, setDraft] = useState(templates[0].body);

  const settle = async () => {
    await qc.invalidateQueries({ queryKey: ["connection-states"] });
    setPending(null);
  };

  const connect = useMutation({
    mutationFn: () => api("/api/connections/request", { method: "POST", body: { userId, note: note.trim() || undefined } }),
    onMutate: () => { setPending("requested"); setConnectOpen(false); },
    onSuccess: () => {
      notify({ text: note.trim() ? `Request sent to ${name}, with your note.` : `Request sent to ${name}.`, tone: "success" });
      setNote("");
    },
    onError: (error: any) => {
      // Already asked, one way or the other: a state to show, not a failure.
      if (/already exists/i.test(String(error?.message ?? ""))) {
        notify({ text: `You and ${name} already have a request between you.`, tone: "info" });
        return;
      }
      setPending(null);
      notify({ text: error?.message || "Couldn't send the request.", tone: "error" });
    },
    onSettled: settle,
  });

  const accept = useMutation({
    mutationFn: () => api(`/api/connections/${connection?.connectionId}/accept`, { method: "POST" }),
    onMutate: () => setPending("connected"),
    onSuccess: () => notify({ text: `You're connected with ${name}. You can message each other now.`, tone: "success" }),
    onError: (error: any) => {
      setPending(null);
      notify({ text: error?.message || "Couldn't accept.", tone: "error" });
    },
    onSettled: settle,
  });

  const send = useMutation({
    mutationFn: (content: string) => api(`/api/messages/${userId}`, { method: "POST", body: { content } }),
    onSuccess: () => {
      setMessageOpen(false);
      notify({ text: `Sent to ${name}.`, tone: "success", action: { label: "Open chat", onPress: () => router.push(`/chat/${userId}`) } });
    },
    // The sheet stays open with the draft in it, so a failed send costs nothing to retry.
    onError: (error: any) => notify({ text: error?.message || "Message not sent.", tone: "error" }),
  });

  const openComposer = () => {
    setTemplateId(templates[0].id);
    setDraft(templates[0].body);
    setMessageOpen(true);
  };

  return (
    <>
      <Row gap={spacing.sm} center wrap>
        {state === "connected" ? (
          <Btn label="Message" small onPress={openComposer} />
        ) : state === "incoming" ? (
          <Btn label="Accept request" small loading={accept.isPending} disabled={!connection?.connectionId} onPress={() => accept.mutate()} />
        ) : state === "requested" ? (
          <>
            <Btn label="Requested" small variant="ghost" disabled />
            <Meta>You can message once they accept</Meta>
          </>
        ) : state === "declined" ? null : (
          <Btn label="Connect" small onPress={() => setConnectOpen(true)} />
        )}
      </Row>

      <Sheet
        visible={connectOpen}
        onClose={() => setConnectOpen(false)}
        title={`Connect with ${name}?`}
        subtitle="They'll get a request. Once they accept, you can message each other."
      >
        <Field
          value={note}
          onChangeText={(value) => setNote(value.slice(0, CONNECTION_NOTE_MAX))}
          placeholder="Optional — say why you'd like to connect"
          multiline
          maxLength={CONNECTION_NOTE_MAX}
        />
        <Meta style={{ textAlign: "right" }}>{note.length}/{CONNECTION_NOTE_MAX}</Meta>
        <Row gap={spacing.sm}>
          <Btn label="Cancel" small variant="ghost" onPress={() => setConnectOpen(false)} />
          <Btn label="Send request" small loading={connect.isPending} onPress={() => connect.mutate()} />
        </Row>
      </Sheet>

      <Sheet
        visible={messageOpen}
        onClose={() => setMessageOpen(false)}
        title={`Message ${name}`}
        subtitle="Already written from why you matched — edit it or send it as it is."
      >
        <Row wrap gap={spacing.xs}>
          {templates.map((t) => (
            <Chip key={t.id} label={t.label} active={t.id === templateId} onPress={() => { setTemplateId(t.id); setDraft(t.body); }} />
          ))}
        </Row>
        <Field value={draft} onChangeText={setDraft} multiline />
        <Row gap={spacing.sm}>
          <Btn label="Cancel" small variant="ghost" onPress={() => setMessageOpen(false)} />
          <Btn label="Send" small loading={send.isPending} disabled={!draft.trim()} onPress={() => send.mutate(draft.trim())} />
        </Row>
      </Sheet>
    </>
  );
}

const FOLLOWED = ["followed-projects"];

/** Follow in place: instant, explicit, and put back if the server says no. */
export function FollowButton({ projectId, title, following, notify }: {
  projectId: string;
  title: string;
  following: boolean;
  notify: (notice: Notice) => void;
}) {
  const qc = useQueryClient();
  const follow = useMutation({
    mutationFn: (want: boolean) => api<{ following: boolean }>(`/api/projects/${projectId}/follow`, { method: "POST", body: { following: want } }),
    onMutate: async (want) => {
      await qc.cancelQueries({ queryKey: FOLLOWED });
      const before = qc.getQueryData<{ projectId: string }[]>(FOLLOWED);
      qc.setQueryData<{ projectId: string }[]>(FOLLOWED, (rows = []) =>
        want ? [...rows.filter((r) => r.projectId !== projectId), { projectId }] : rows.filter((r) => r.projectId !== projectId));
      return { before };
    },
    onError: (error: any, _want, context) => {
      qc.setQueryData(FOLLOWED, context?.before);
      notify({ text: error?.message || "Couldn't update that.", tone: "error" });
    },
    onSuccess: (_result, want) => notify({ text: want ? `Following ${title}.` : `Unfollowed ${title}.`, tone: "success" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: FOLLOWED });
      void qc.invalidateQueries({ queryKey: ["project", projectId, "follow-status"] });
    },
  });
  return (
    <Btn label={following ? "Following" : "Follow"} small variant={following ? "ghost" : "primary"} onPress={() => follow.mutate(!following)} />
  );
}
