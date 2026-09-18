/**
 * The lobby's data: the markets, the room, and the clock that ticks between
 * polls.
 *
 * ## Why the room polls, and why not every second
 *
 * The room is the only screen in this app where five people look at the same
 * thing while it changes under all of them. There is no socket, and there
 * doesn't need to be: the server advances the phase *on read* (see `advance()`
 * in server/simulation-routes.ts), so polling isn't just how this screen finds
 * out what happened — it is what makes it happen. A room nobody is looking at
 * is a room whose clock isn't running, and that is fine, because there is
 * nobody to show it to.
 *
 * Two and a half seconds is the whole budget. Every second would be five
 * requests a second per room for a number the phone can work out itself, and
 * slower than that a seat someone took is theirs for long enough that a second
 * person reaches for it. So: poll on a short interval for the truth, and
 * interpolate the countdown locally in between.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { formatCountdown, remainingSeconds, type NichesResponse, type VentureView } from "./lobby";

/** Short enough that a claimed seat shows up before someone else reaches for it. */
export const ROOM_POLL_MS = 2_500;

/** The markets, and what each of the five seats controls. Static for a session. */
export function useNiches() {
  return useQuery({
    queryKey: ["sim-niches"],
    queryFn: () => api<NichesResponse>("/api/sim/niches"),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/**
 * The room, as it stands, re-asked every couple of seconds.
 *
 * Polling stops once the phase can't change again — a running or retired
 * venture is a final answer, and a screen that keeps asking for it is a
 * battery bill for nothing.
 */
export function useVenture(id: string | undefined) {
  return useQuery({
    queryKey: ["sim-venture", id],
    queryFn: () => api<VentureView>(`/api/sim/ventures/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const phase = query.state.data?.phase;
      return phase === "running" || phase === "retired" ? false : ROOM_POLL_MS;
    },
    // The point of this query is that it is never stale for long; React
    // Query's default window would swallow a refetch triggered by a claim.
    staleTime: 0,
    retry: false,
  });
}

/**
 * The countdown, re-anchored on every poll.
 *
 * `secondsLeft` is the server's, and `anchoredAt` is when it landed — pass
 * React Query's `dataUpdatedAt` so that a poll returning the *same* number
 * (which happens whenever two polls land inside the same server second) still
 * resets the local clock instead of letting it carry on drifting.
 *
 * The one-second tick only forces a re-render; the value itself is computed
 * from `Date.now()` at render, so a render caused by anything else — a poll, a
 * claim — shows the right number rather than the one the last tick left.
 */
export function useCountdown(secondsLeft: number | undefined, anchoredAt: number): { seconds: number; text: string } {
  const [, tick] = useState(0);

  useEffect(() => {
    if (secondsLeft == null) return;
    const timer = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, [secondsLeft == null]);

  const seconds = secondsLeft == null ? 0 : remainingSeconds({ secondsLeft, atMs: anchoredAt }, Date.now());
  return { seconds, text: formatCountdown(seconds) };
}
