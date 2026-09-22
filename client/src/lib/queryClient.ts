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

/** The credit count follows spending: after a write goes through, the sidebar and low-credits notice re-read it. */
let refreshCredits: ReturnType<typeof setTimeout> | null = null;
function creditsMayHaveChanged(url: string) {
  if (url.startsWith("/api/subscription") || typeof window === "undefined") return;
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
