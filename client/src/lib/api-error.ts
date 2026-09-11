/**
 * API errors, read once.
 *
 * `apiRequest` used to throw `Error("429: {…json…}")`, and twenty screens put
 * that string straight into a toast — so being rate-limited read as a status
 * code and a blob of JSON. Now it throws an ApiError carrying what the server
 * said, and `errorText` is how any screen turns an error into words: the
 * server's own message, plus when to try again if it's a rate limit.
 *
 * The message keeps its old "status: body" form, because `isUnauthorizedError`
 * and a few callers still match on it.
 */
import { RATE_LIMITED } from "@shared/moderation";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    raw: string,
    /** The parsed JSON body, when there was one. */
    readonly body: Record<string, unknown> | null,
    /** From the body, else the Retry-After header. */
    readonly retryAfterSeconds: number | null,
  ) {
    super(`${status}: ${raw}`);
    this.name = "ApiError";
  }

  get code(): string | null {
    return typeof this.body?.code === "string" ? this.body.code : null;
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function toApiError(res: Response): Promise<ApiError> {
  const raw = (await res.text()) || res.statusText;
  const body = parseJson(raw);
  const fromBody = Number(body?.retryAfterSeconds);
  const fromHeader = Number(res.headers.get("Retry-After"));
  const wait = Number.isFinite(fromBody) && fromBody > 0 ? fromBody : Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : null;
  return new ApiError(res.status, raw, body, wait);
}

/** "about 40 seconds", "about a minute", "about 3 minutes". */
export function waitPhrase(seconds: number): string {
  if (seconds < 55) return `about ${Math.max(1, Math.round(seconds / 5) * 5 || 1)} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}

/** Any error as words a person can act on. */
export function errorText(error: unknown, fallback = "Something went wrong. Try again."): string {
  if (error instanceof ApiError) {
    const message = typeof error.body?.message === "string" ? error.body.message : null;
    if (error.code === RATE_LIMITED && error.retryAfterSeconds) {
      return `${message ?? "Too many requests."} Ready again in ${waitPhrase(error.retryAfterSeconds)}.`;
    }
    // No message means a stack page or nothing — neither is for a person.
    return message ?? fallback;
  }
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  // Errors built the old way: "429: {json}".
  const body = /^\d{3}:\s*([\s\S]*)$/.exec(raw)?.[1];
  if (body !== undefined) {
    const parsed = parseJson(body);
    return typeof parsed?.message === "string" ? parsed.message : fallback;
  }
  return raw || fallback;
}
