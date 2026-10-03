/**
 * Watching a whole-business build, on the phone.
 *
 * The counterpart of `client/src/lib/build-status.ts`'s `useBuildStatus`. The
 * phone could start a build and then showed nothing: the button fired, one toast
 * said "Nova is building it", and after that the app was silent for the length of
 * a forty-step job — no stage, no step count, no completion, and no error if the
 * run died. From the person's side that is indistinguishable from a fourteen-
 * dollar outcome that silently failed.
 *
 * Polled rather than pushed, and at the web's two rates: a run in flight changes
 * every few seconds and is worth asking about often; an idle project is worth
 * asking about rarely, because this screen is open while somebody reads it.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "./api/client";
import type { BuildRunStatus } from "./buildStages";

/** The same two intervals the web uses, for the same reasons. */
export const RUNNING_POLL_MS = 3_000;
export const IDLE_POLL_MS = 30_000;

export const buildStatusKey = (projectId: string | undefined) => ["project", projectId, "nova-build"];

export function useBuildStatus(projectId: string | undefined, opts: { expectRunning?: boolean } = {}) {
  const query = useQuery({
    queryKey: buildStatusKey(projectId),
    queryFn: () => api<BuildRunStatus>(`/api/projects/${projectId}/nova-build`),
    enabled: !!projectId,
    /*
     * `expectRunning` is for the gap between pressing the button and the run row
     * existing. Without it the first poll after starting a build would be thirty
     * seconds away, and the screen would look like nothing had happened at the
     * one moment somebody is watching hardest.
     */
    refetchInterval: (q) => (opts.expectRunning || q.state.data?.running ? RUNNING_POLL_MS : IDLE_POLL_MS),
    staleTime: 1_500,
  });
  return { ...query, running: query.data?.running ?? null, last: query.data?.last ?? null };
}
