import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { toApiError } from "./api-error";
import { OUT_OF_CREDITS } from "@shared/credits";

/** Mirrors CREDITS_EVENT in components/upgrade-to-keep-generating (kept here so this file imports no UI). */
const CREDITS_EVENT = "sparktower:credits";
/** Mirrors PAYMENT_EVENT in components/payment-dialog, for the same reason. */
const PAYMENT_EVENT = "sparktower:payment";

/**
 * The request a 402 refused, kept so the dialog can finish it.
 *
 * Someone who has just paid for a codebase audit should get the audit, not a
 * closed dialog and the job of remembering which button they pressed. The
 * dialog replays exactly this and then invalidates, which is the only way the
 * screen behind it can show the result of a call it never made itself.
 */
export interface FailedRequest { method: string; url: string; data?: unknown }

async function throwIfResNotOk(res: Response, request?: FailedRequest) {
  // An ApiError, so screens can say what the server said (see errorText).
  if (!res.ok) {
    const error = await toApiError(res);
    // Anything priced, anywhere: one dialog, whatever the screen does with the error.
    if (error.code === "payment_required" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(PAYMENT_EVENT, { detail: { body: error.body, request } }));
    }
    // Out of AI credits, anywhere: offer the upgrade, whatever the screen does with the error.
    if (error.code === OUT_OF_CREDITS && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(CREDITS_EVENT, {
        detail: { state: "out", message: error.body?.message, cost: error.body?.cost, creditsRemaining: error.body?.creditsRemaining },
      }));
    }
    throw error;
  }
}

/**
 * The credit count follows spending: after a write goes through, the sidebar and
 * low-credits notice re-read it.
 *
 * Writes that cannot have changed it are skipped, which is not a
 * micro-optimisation at the one moment it matters. Playing a simulation is all
 * writes — a filing per seat per period — and a period deadline has every table
 * filing inside the same minute. At 200 people that was 200 extra reads of
 * `/api/subscription` arriving together, and a 200-person load run measured them
 * at p95 2.5s purely from queueing behind each other. The endpoint itself is
 * 17ms; there was simply no reason for any of those calls to exist.
 *
 * Checked rather than assumed, because skipping a refresh that *was* needed
 * would leave somebody looking at a credit balance that is no longer true: no
 * route under `/api/sim/` spends credits. The one simulation-adjacent charge is
 * building a market with Nova, which lives at
 * `/api/projects/:id/simulation` — a different prefix, and still refreshed.
 */
/**
 * The exceptions: paths under a skipped prefix that *do* charge.
 *
 * `/api/sim/` was a blanket promise that nothing in a season costs anything,
 * and it held until "have Nova plan this year" arrived — a search over the
 * whole company, priced at NOVA_PLAN_ACTIONS of the month's free actions. It
 * sits under the skipped prefix because it is a season route, and it has to be
 * followed because the number in the corner is wrong the moment it returns.
 *
 * Matched as a suffix rather than a whole path, since the venture id is in the
 * middle of it.
 */
export const CHARGES_ANYWAY = [
  "/nova-plan",
];

export const SPENDS_NOTHING = [
  /*
   * Playing a season: joining, claiming a seat, naming the company, filing a
   * year, bidding, trading. The seats a private season needs are bought through
   * `/api/companies/:id/simulation-seats/*`, which is not this prefix.
   */
  "/api/sim/",
];

/**
 * Should a write to this path be followed by a re-read of the credit balance?
 *
 * Exported so the list above is held by a test rather than by a comment:
 * `test/unit/credit-refresh.test.ts` also walks the routes under each prefix
 * and fails if one of them ever starts charging, which is the way this goes
 * wrong — not by the list being wrong today, but by a charge being added later
 * to a route the list promised was free.
 */
export const creditsFollow = (url: string): boolean => {
  if (url.startsWith("/api/subscription")) return false;
  /* An exception beats the prefix: see CHARGES_ANYWAY. */
  if (CHARGES_ANYWAY.some((suffix) => url.endsWith(suffix))) return true;
  return !SPENDS_NOTHING.some((prefix) => url.startsWith(prefix));
};

let refreshCredits: ReturnType<typeof setTimeout> | null = null;
function creditsMayHaveChanged(url: string) {
  if (typeof window === "undefined" || !creditsFollow(url)) return;
  if (refreshCredits) clearTimeout(refreshCredits);
  refreshCredits = setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/subscription"] }), 400);
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res, { method, url, data });
  if (method !== "GET") creditsMayHaveChanged(url);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
