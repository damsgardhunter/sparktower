/**
 * What's new with the builders and projects you've looked at, since you did.
 *
 * Read once per visit to the page, from what was remembered before this visit
 * began — so opening something now doesn't erase the news you came back for.
 * At most three get a badge: the point is "look here", and ten badges say
 * nothing.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { seenTokens } from "@/lib/seen";

export interface ExploreUpdate {
  kind: "builder" | "project";
  id: string;
  name: string;
  newPosts: number;
  /** At least this many; the server stops counting at a handful. */
  more: boolean;
  latestAt: string;
}

const MAX_BADGES = 3;

export const updateLabel = (update: ExploreUpdate) =>
  `${update.newPosts}${update.more ? "+" : ""} new post${update.newPosts === 1 && !update.more ? "" : "s"}`;

export function useExploreUpdates() {
  const [tokens] = useState(() => seenTokens());
  const { data } = useQuery<{ updates: ExploreUpdate[] }>({
    queryKey: ["/api/discover/updates", tokens.join(",")],
    queryFn: async () => {
      const res = await fetch(`/api/discover/updates?t=${encodeURIComponent(tokens.join(","))}`, { credentials: "include" });
      return res.ok ? res.json() : { updates: [] };
    },
    enabled: tokens.length > 0,
    staleTime: 0,
  });
  const updates = [...(data?.updates ?? [])]
    .sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt))
    .slice(0, MAX_BADGES);
  const byKey = new Map(updates.map((u) => [`${u.kind}:${u.id}`, u]));
  return { updates, byKey };
}
