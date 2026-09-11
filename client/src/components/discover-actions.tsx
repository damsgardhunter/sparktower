/**
 * Follow, Connect and Message, on the cards where people find each other.
 *
 * Adapted from a packet Nova wrote, which had the right flow and a fake API
 * under it — a simulator with success and failure flags, and state kept in the
 * browser. The flow is kept; the fake isn't. Everything here talks to the real
 * endpoints, so "survives navigation" is just the server remembering, and a
 * failure is a real one, reverted and said out loud.
 *
 *  - Follow flips instantly and sends the state it wants, not a toggle, so a
 *    retry or a double tap can't undo itself. A refusal puts it back.
 *  - Connect asks first, with room for a note — the only thing someone can say
 *    before the other person accepts, because messages wait for that.
 *  - Message appears once you're connected, opens already written from why you
 *    were matched, and sends in one tap.
 *
 * Every success is also an Explore event (shared/explore-events.ts), with the
 * page and the card's position, so the loop's numbers count these too.
 */
import { errorText } from "@/lib/api-error";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Check, Heart, Loader2, MessageSquare, UserPlus } from "lucide-react";
import { trackExplore } from "@/lib/explore";
import { messageTemplates } from "@/lib/message-templates";
import { markSeen } from "@/lib/seen";
import { EXPLORE_EVENTS, type ExploreSource } from "@shared/explore-events";
import { CONNECTION_NOTE_MAX } from "@shared/moderation";

export type ConnectionStateName = "none" | "requested" | "incoming" | "connected" | "declined";
export interface ConnectionState { state: ConnectionStateName; connectionId: string | null }
type ExploreContext = { source: ExploreSource; rankPosition?: number };

/** Where you stand with everyone on the page, in one request. */
export function useConnectionStates(userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean))).sort().slice(0, 100);
  return useQuery<Record<string, ConnectionState>>({
    queryKey: ["/api/connections/statuses", ids.join(",")],
    queryFn: async () => {
      const res = await fetch(`/api/connections/statuses?ids=${encodeURIComponent(ids.join(","))}`, { credentials: "include" });
      return res.ok ? res.json() : {};
    },
    enabled: ids.length > 0,
  });
}

const FOLLOWED = ["/api/user/followed-projects"];

/** The projects you follow, as a set of ids — the same cache every Follow button writes to. */
export function useFollowedProjectIds(): ReadonlySet<string> {
  const { data } = useQuery<{ projectId: string }[]>({ queryKey: FOLLOWED });
  return new Set((data ?? []).map((row) => row.projectId));
}

/** An API error in words: the server's own message when it sent one. */
function readable(error: unknown, fallback: string): string {
  return errorText(error, fallback);
}

export function BuilderActions({ userId, name, reason, headline, connection, explore, moreLikeThis }: {
  userId: string;
  name: string;
  reason?: string | null;
  headline?: string | null;
  connection?: ConnectionState;
  explore?: ExploreContext;
  /** Where "More like this" goes after an action — Discover searched by their top skill. */
  moreLikeThis?: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  // What the button shows while the server catches up; the server's answer wins once it lands.
  const [pending, setPending] = useState<ConnectionStateName | null>(null);
  const state: ConnectionStateName = pending ?? connection?.state ?? "none";

  const [connectOpen, setConnectOpen] = useState(false);
  const [note, setNote] = useState("");
  const templates = messageTemplates({ name, reason, headline });
  const [messageOpen, setMessageOpen] = useState(false);
  const [templateId, setTemplateId] = useState(templates[0].id);
  const [draft, setDraft] = useState(templates[0].body);

  const target = { matchType: "builder" as const, targetId: userId, source: explore?.source, rankPosition: explore?.rankPosition };
  const settle = async () => {
    await qc.invalidateQueries({ queryKey: ["/api/connections/statuses"] });
    setPending(null);
  };

  const connect = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/connections/request", { userId, note: note.trim() || undefined })).json(),
    onMutate: () => { setPending("requested"); setConnectOpen(false); },
    onSuccess: () => {
      if (explore) trackExplore(EXPLORE_EVENTS.connectRequest, target);
      markSeen("builder", userId);
      // The nudge: right after acting is when "more like this" is a real offer.
      toast({
        title: `Request sent to ${name}`,
        description: note.trim() ? "Your note goes with it. Want more like this?" : "Want more like this?",
        action: moreLikeThis
          ? <ToastAction altText="See more builders like this" onClick={() => setLocation(moreLikeThis)} data-testid="toast-more-like-this">More like this</ToastAction>
          : undefined,
      });
      setNote("");
    },
    onError: (error) => {
      const message = readable(error, "Couldn't send the request.");
      // Already asked, one way or the other: not a failure, just a state to show.
      if (/already exists/i.test(message)) {
        toast({ title: "Already requested", description: `You and ${name} already have a request between you.` });
        return;
      }
      setPending(null);
      toast({ title: "Request not sent", description: message, variant: "destructive" });
    },
    onSettled: settle,
  });

  const accept = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/connections/${connection?.connectionId}/accept`)).json(),
    onMutate: () => setPending("connected"),
    onSuccess: () => toast({ title: `You're connected with ${name}`, description: "You can message each other now." }),
    onError: (error) => {
      setPending(null);
      toast({ title: "Couldn't accept", description: readable(error, "Try again."), variant: "destructive" });
    },
    onSettled: async () => {
      void qc.invalidateQueries({ queryKey: ["/api/connections/requests"] });
      await settle();
    },
  });

  const send = useMutation({
    mutationFn: async (content: string) => (await apiRequest("POST", `/api/messages/${userId}`, { content })).json(),
    onSuccess: () => {
      if (explore) trackExplore(EXPLORE_EVENTS.messageSent, target);
      markSeen("builder", userId);
      setMessageOpen(false);
      void qc.invalidateQueries({ queryKey: ["/api/messages", userId] });
      toast({
        title: `Sent to ${name}`,
        action: <ToastAction altText="Open the conversation" onClick={() => setLocation(`/messages?with=${userId}`)}>Open</ToastAction>,
      });
    },
    // The draft stays in the box, so a failed send costs nothing to retry.
    onError: (error) => toast({ title: "Message not sent", description: readable(error, "Try again."), variant: "destructive" }),
  });

  const openComposer = () => {
    setTemplateId(templates[0].id);
    setDraft(templates[0].body);
    setMessageOpen(true);
  };

  return (
    // The card underneath navigates on click. Nothing in here should — including
    // the dialogs, whose clicks bubble through React to this div despite the portal.
    <div className="flex flex-wrap items-center gap-2 pt-3" onClick={(e) => e.stopPropagation()} data-testid={`actions-user-${userId}`}>
      {state === "connected" ? (
        <Button size="sm" onClick={openComposer} data-testid={`button-message-${userId}`}>
          <MessageSquare className="h-3.5 w-3.5 mr-1.5" /> Message
        </Button>
      ) : state === "incoming" ? (
        <Button size="sm" onClick={() => accept.mutate()} disabled={accept.isPending || !connection?.connectionId} data-testid={`button-accept-${userId}`}>
          {accept.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1.5" />} Accept request
        </Button>
      ) : state === "requested" ? (
        <>
          <Button size="sm" variant="secondary" disabled data-testid={`button-requested-${userId}`}>
            <Check className="h-3.5 w-3.5 mr-1.5" /> Requested
          </Button>
          <span className="text-[11px] text-muted-foreground">You can message once they accept</span>
        </>
      ) : state === "declined" ? null : (
        <Button size="sm" variant="outline" onClick={() => setConnectOpen(true)} data-testid={`button-connect-${userId}`}>
          <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Connect
        </Button>
      )}

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect with {name}?</DialogTitle>
            <DialogDescription>They'll get a request. Once they accept, you can message each other.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, CONNECTION_NOTE_MAX))}
              placeholder="Optional — say why you'd like to connect"
              rows={3}
              data-testid="input-connect-note"
            />
            <p className="text-[11px] text-muted-foreground text-right">{note.length}/{CONNECTION_NOTE_MAX}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConnectOpen(false)}>Cancel</Button>
            <Button onClick={() => connect.mutate()} disabled={connect.isPending} data-testid="button-send-connect">Send request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Message {name}</DialogTitle>
            <DialogDescription>Already written from why you matched — edit it or send it as it is.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <Button
                key={t.id} size="sm" variant={templateId === t.id ? "default" : "secondary"}
                onClick={() => { setTemplateId(t.id); setDraft(t.body); }}
                data-testid={`button-template-${t.id}`}
              >
                {t.label}
              </Button>
            ))}
          </div>
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} data-testid="input-message-draft" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMessageOpen(false)}>Cancel</Button>
            <Button onClick={() => send.mutate(draft.trim())} disabled={send.isPending || !draft.trim()} data-testid="button-send-message">
              {send.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />} Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ProjectFollowButton({ projectId, title, following, explore, moreLikeThis }: {
  projectId: string;
  title: string;
  following: boolean;
  explore?: ExploreContext;
  /** Where "More like this" goes after following — the project list, filtered to its category. */
  moreLikeThis?: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const follow = useMutation({
    mutationFn: async (want: boolean) =>
      (await apiRequest("POST", `/api/projects/${projectId}/follow`, { following: want })).json() as Promise<{ following: boolean }>,
    // Instant: the followed list is changed now, and put back if the server refuses.
    onMutate: async (want) => {
      await qc.cancelQueries({ queryKey: FOLLOWED });
      const before = qc.getQueryData<{ projectId: string }[]>(FOLLOWED);
      qc.setQueryData<{ projectId: string }[]>(FOLLOWED, (rows = []) =>
        want ? [...rows.filter((r) => r.projectId !== projectId), { projectId }] : rows.filter((r) => r.projectId !== projectId));
      return { before };
    },
    onError: (error, _want, context) => {
      qc.setQueryData(FOLLOWED, context?.before);
      toast({ title: "Couldn't update", description: readable(error, "Try again."), variant: "destructive" });
    },
    onSuccess: (_result, want) => {
      if (!want) {
        toast({ title: `Unfollowed ${title}` });
        return;
      }
      if (explore) {
        trackExplore(EXPLORE_EVENTS.follow, { matchType: "project", targetId: projectId, source: explore.source, rankPosition: explore.rankPosition });
      }
      markSeen("project", projectId);
      toast({
        title: `Following ${title}`,
        description: "Want more like this?",
        action: moreLikeThis
          ? <ToastAction altText="See more projects like this" onClick={() => setLocation(moreLikeThis)} data-testid="toast-more-like-this">More like this</ToastAction>
          : undefined,
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: FOLLOWED });
      void qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "follow-status"] });
      // The Following feed changes the moment something is followed; say so to it.
      void qc.invalidateQueries({ queryKey: ["/api/feed"] });
    },
  });

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Button
        size="sm" variant={following ? "secondary" : "outline"} aria-pressed={following}
        onClick={() => follow.mutate(!following)}
        data-testid={`button-follow-${projectId}`}
      >
        <Heart className={`h-3.5 w-3.5 mr-1.5 ${following ? "fill-current" : ""}`} /> {following ? "Following" : "Follow"}
      </Button>
    </div>
  );
}

/**
 * Follow a builder: one-way and instant, unlike Connect, which waits on them.
 *
 * The step's named risk was that following changes nothing you can see. So a
 * follow updates the button at once, tells the feed to re-read, and the
 * notification says where their updates now appear — with the way there.
 */
export function FollowBuilderButton({ userId, source = "profile_page" }: { userId: string; source?: ExploreSource }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const key = ["/api/users", userId, "follow-status"];

  const { data } = useQuery<{ following: boolean; followers: number }>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/follow-status`, { credentials: "include" });
      return res.ok ? res.json() : { following: false, followers: 0 };
    },
  });
  // The same cache the profile and messages pages read a person from.
  const { data: person } = useQuery<{ firstName?: string | null; profile?: { displayName?: string | null } | null }>({
    queryKey: ["/api/users", userId],
  });
  const name = person?.profile?.displayName || person?.firstName || "them";
  const following = !!data?.following;

  const follow = useMutation({
    mutationFn: async (want: boolean) =>
      (await apiRequest("POST", `/api/users/${userId}/follow`, { following: want })).json() as Promise<{ following: boolean; followers: number }>,
    onMutate: async (want) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData(key);
      qc.setQueryData(key, (old: { followers?: number } | undefined) => ({
        following: want, followers: Math.max(0, (old?.followers ?? 0) + (want ? 1 : -1)),
      }));
      return { before };
    },
    onError: (error, _want, context) => {
      qc.setQueryData(key, context?.before);
      toast({ title: "Couldn't update", description: readable(error, "Try again."), variant: "destructive" });
    },
    onSuccess: (_result, want) => {
      if (!want) {
        toast({ title: `Unfollowed ${name}` });
        return;
      }
      trackExplore(EXPLORE_EVENTS.follow, { matchType: "builder", targetId: userId, source });
      markSeen("builder", userId);
      toast({
        title: `Following ${name}`,
        description: "Their updates now show in your Following feed.",
        action: <ToastAction altText="Open your Following feed" onClick={() => setLocation("/?feed=following")} data-testid="toast-open-following">Open Following</ToastAction>,
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["/api/feed"] });
    },
  });

  return (
    <Button
      size="sm" variant={following ? "secondary" : "outline"} className="gap-2" aria-pressed={following}
      onClick={(e) => { e.stopPropagation(); follow.mutate(!following); }}
      data-testid={`button-follow-user-${userId}`}
    >
      <Heart className={`h-4 w-4 ${following ? "fill-current" : ""}`} /> {following ? "Following" : "Follow"}
      {!!data?.followers && <span className="text-xs">({data.followers})</span>}
    </Button>
  );
}
