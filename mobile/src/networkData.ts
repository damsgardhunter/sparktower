/**
 * Data helpers for the Network tab, search, notifications and messages —
 * the pieces those screens share that aren't drawing.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";

/** What the server returns for a person, in the several shapes it comes in. */
export interface PersonLike {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  profileImageUrl?: string | null;
}
export interface ProfileLike {
  displayName?: string | null;
  headline?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  username?: string | null;
  location?: string | null;
  skills?: string[] | null;
}

/** A person's name as the web shows it: display name, then full name. Never an email on a phone screen. */
export function personName(user?: PersonLike | null, profile?: ProfileLike | null, fallback = "Builder"): string {
  const full = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return profile?.displayName?.trim() || full || fallback;
}

export const personAvatar = (user?: PersonLike | null, profile?: ProfileLike | null) =>
  profile?.avatarUrl || user?.profileImageUrl || null;

// --- What's new with what you've looked at ------------------------------

/** The counterpart of client/src/hooks/use-explore-updates.ts. */
export interface ExploreUpdate {
  kind: "builder" | "project";
  id: string;
  name: string;
  newPosts: number;
  more: boolean;
  latestAt: string;
}

/** At most three badges: the point is "look here", and ten badges say nothing. */
const MAX_BADGES = 3;

export const updateLabel = (u: Pick<ExploreUpdate, "newPosts" | "more">) =>
  `${u.newPosts}${u.more ? "+" : ""} new post${u.newPosts === 1 && !u.more ? "" : "s"}`;

export const DISCOVER_UPDATES_KEY = ["discover-updates"];

export function useExploreUpdates() {
  const query = useQuery({
    queryKey: DISCOVER_UPDATES_KEY,
    queryFn: () => api<{ updates: ExploreUpdate[] }>("/api/discover/updates").catch(() => ({ updates: [] as ExploreUpdate[] })),
    staleTime: 0,
  });
  const updates = [...(query.data?.updates ?? [])]
    .sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt))
    .slice(0, MAX_BADGES);
  const byKey = new Map(updates.map((u) => [`${u.kind}:${u.id}`, u]));
  return { updates, byKey, refetch: query.refetch };
}

// --- Connections -----------------------------------------------------------

export interface ConnectionRow {
  id: string;
  requesterId: string;
  receiverId: string;
  status: "pending" | "accepted" | "rejected";
  note?: string | null;
  createdAt: string;
  user: PersonLike & { id: string };
  profile?: ProfileLike | null;
}

export const CONNECTION_REQUESTS_KEY = ["connection-requests"];
export const CONNECTIONS_KEY = ["connections"];

export const useConnectionRequests = () =>
  useQuery({ queryKey: CONNECTION_REQUESTS_KEY, queryFn: () => api<ConnectionRow[]>("/api/connections/requests") });

export const useConnections = (enabled = true) =>
  useQuery({ queryKey: CONNECTIONS_KEY, queryFn: () => api<ConnectionRow[]>("/api/connections"), enabled });

/**
 * Accept or ignore a received request, from wherever it's shown: the list
 * drops it at once and puts it back if the server refuses.
 */
export function useInvitationActions(notify: (n: { text: string; tone: "success" | "error" | "info" }) => void) {
  const qc = useQueryClient();
  const settle = () => Promise.all([
    qc.invalidateQueries({ queryKey: CONNECTION_REQUESTS_KEY }),
    qc.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
    qc.invalidateQueries({ queryKey: ["connection-states"] }),
    qc.invalidateQueries({ queryKey: ["notifications"] }),
  ]);
  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; name: string; accept: boolean }) =>
      api(`/api/connections/${id}/${accept ? "accept" : "reject"}`, { method: "POST" }),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: CONNECTION_REQUESTS_KEY });
      const before = qc.getQueryData<ConnectionRow[]>(CONNECTION_REQUESTS_KEY);
      qc.setQueryData<ConnectionRow[]>(CONNECTION_REQUESTS_KEY, (rows) => rows?.filter((r) => r.id !== id));
      return { before };
    },
    onSuccess: (_r, { name, accept }) => notify(accept
      ? { text: `You're connected with ${name}. You can message each other now.`, tone: "success" }
      : { text: `Ignored ${name}'s request.`, tone: "info" }),
    onError: (error: any, _v, context) => {
      qc.setQueryData(CONNECTION_REQUESTS_KEY, context?.before);
      notify({ text: error?.message || "Couldn't answer that request.", tone: "error" });
    },
    onSettled: settle,
  });
  return {
    accept: (row: { id: string; name: string }) => respond.mutate({ ...row, accept: true }),
    ignore: (row: { id: string; name: string }) => respond.mutate({ ...row, accept: false }),
    busyId: respond.isPending ? respond.variables?.id : undefined,
  };
}

// --- Notifications ---------------------------------------------------------

/**
 * The server's `href` is a web path. The app's screens are named differently,
 * so translate: a post opens the post, a project its page (or its path), a
 * connection request the invitations list, anything else the person.
 */
export function appHref(webHref: string | null | undefined, actorId: string): string {
  const href = webHref || "";
  let m: RegExpExecArray | null;
  if ((m = /^\/posts\/([^/?#]+)/.exec(href))) return `/post/${m[1]}`;
  if ((m = /^\/projects\/([^/?#]+)\/manage/.exec(href))) return `/manage/${m[1]}`;
  if ((m = /^\/projects\/([^/?#]+)/.exec(href))) return `/project/${m[1]}`;
  if (href === "/profile") return "/network/invitations";
  if ((m = /^\/profile\/([^/?#]+)/.exec(href))) return `/user/${m[1]}`;
  return actorId ? `/user/${actorId}` : "/(tabs)/feed";
}

// --- Time ------------------------------------------------------------------

/** A conversation row's time, as the web's inbox shows it: 3:40 PM, Yesterday, Tue, Sep 2. */
export function inboxTime(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (date.getTime() >= startOfToday) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.getTime() >= startOfToday - day) return "Yesterday";
  if (date.getTime() >= startOfToday - 6 * day) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function dayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return "Today";
  if (date.getTime() >= startOfToday - 24 * 60 * 60 * 1000) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

/** A steady tint for a name, so a project's tile is the same colour everywhere. */
const TILE_COLORS = ["#9745B5", "#2563EB", "#0891B2", "#16A34A", "#D97706", "#E11D48", "#7C3AED", "#64748B"];
export function tintFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}
