/**
 * The Explore loop's action step, recorded where it happens.
 *
 * Follow, connect and message are writes, so the endpoint that performs one is
 * the only witness that can't miss it: web, mobile, a retry, a blocked tracker
 * — the row exists exactly when the follow does. The client contributes what
 * only it can see (the page, the card's position, time since opening
 * Discover) as `explore` in the request body, held to the same boundary as
 * anything else arriving from outside. See CLIENT_EXPLORE_EVENT_NAMES.
 *
 * The row lands in the requester's visit — the `st_sid` cookie, or the
 * mobile app's session header — so it sits in the same session as the
 * "opened Discover" that led to it, and the funnel and cycle counts join up.
 */
import { recordActivity } from "./analytics";
import {
  EXPLORE_EVENTS, sanitizeExploreProps, type ExploreMatchType,
} from "@shared/explore-events";

type ActionName = typeof EXPLORE_EVENTS.follow | typeof EXPLORE_EVENTS.connectRequest | typeof EXPLORE_EVENTS.messageSent;

/** Records one action. Fire-and-forget, like all analytics: never fails the request. */
export function recordExploreAction(
  req: any, name: ActionName, target: { matchType: ExploreMatchType; targetId: string },
): void {
  const context = sanitizeExploreProps(req.body?.explore);
  const props = sanitizeExploreProps({
    matchType: target.matchType,
    targetId: target.targetId,
    source: context.source,
    rankPosition: context.rankPosition,
    timeToActionMs: context.timeToActionMs,
  });
  void recordActivity({
    name,
    userId: req.user?.id ?? null,
    visitorId: req.visitorId || "unknown",
    sessionId: req.sessionId || "unknown",
    path: req.originalUrl || req.path || "/",
    userAgent: req.headers?.["user-agent"],
    props: { ...props },
  });
}
