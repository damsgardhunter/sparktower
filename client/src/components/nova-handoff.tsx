import { createContext, useContext, useEffect, useRef } from "react";
import type { NovaHandoff } from "@shared/nova-handoff";

/**
 * Carries a job from a Nova dashboard recommendation to the tab that runs it.
 *
 * A context rather than props because the destinations are nested — the
 * pricing analysis lives two levels down inside the Strategy tab, the health
 * check inside Analytics — and threading `autoRun` through every intermediate
 * tab would put a prop on components that have nothing to do with it.
 *
 * The state itself is owned by the project manager page, which already owns
 * the active tab; navigating and handing over are one decision, so they should
 * be one piece of state.
 */
export interface NovaHandoffValue {
  pending: NovaHandoff | null;
  request: (action: NovaHandoff) => void;
  clear: () => void;
}

const NovaHandoffContext = createContext<NovaHandoffValue>({
  pending: null,
  request: () => {},
  clear: () => {},
});

export const NovaHandoffProvider = NovaHandoffContext.Provider;

/** Hand a job to whichever tab claims it. Pair with navigating there. */
export function useRequestNovaHandoff() {
  return useContext(NovaHandoffContext).request;
}

/**
 * Read the pending job without taking it.
 *
 * For containers that have to get out of the way first — the Strategy tab
 * switches to its pricing section so the section that actually claims
 * `strategy.pricing` is mounted to claim it.
 */
export function useNovaHandoffPending(): NovaHandoff | null {
  return useContext(NovaHandoffContext).pending;
}

/**
 * Runs `run` once when `action` is handed to this component, then clears it.
 *
 * `ready` holds the job until the component can actually do it — a roadmap
 * rebuild can't open its dialog before the roadmap has loaded. The job waits
 * rather than being dropped, so arriving on a still-loading tab doesn't
 * silently swallow what the builder clicked.
 */
export function useNovaHandoff(action: NovaHandoff, run: () => void, ready = true) {
  const { pending, clear } = useContext(NovaHandoffContext);
  // Kept in a ref so a fresh closure each render doesn't re-fire the effect —
  // these jobs cost credits, and running one twice charges twice.
  const runRef = useRef(run);
  runRef.current = run;
  const takenRef = useRef<NovaHandoff | null>(null);

  useEffect(() => {
    if (pending === null) {
      takenRef.current = null;
      return;
    }
    if (pending !== action || !ready || takenRef.current === pending) return;
    takenRef.current = pending;
    clear();
    runRef.current();
  }, [pending, action, ready, clear]);
}
