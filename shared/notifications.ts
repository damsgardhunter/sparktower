/**
 * How a notification reads and where it goes. Shared, so the web bell and the
 * mobile inbox say the same thing and open the same place.
 */
import type { NotificationKind } from "./schema";
import type { ProjectGoal } from "./goals";

export interface NotificationShape {
  kind: NotificationKind;
  actorId: string;
  actorName: string;
  postId: string | null;
  projectId: string | null;
  projectTitle: string | null;
  /** For a path notification: the section its step is on, when known. */
  section?: ProjectGoal | null;
  /** For a path notification: what to bring into view — see PATH_FOCUS. */
  focus?: string | null;
}

/**
 * What a path link brings into view on the project's dashboard.
 *
 * `next`: the section's Next Step card. `weekly`: the card, with the weekly
 * update open. Anything else is the milestone id the notification was about
 * (`SHIP.M1.2`): the card again, and if that step has been finished since,
 * a word that this is the one after it.
 */
export const PATH_FOCUS = { next: "next", weekly: "weekly" } as const;

/** The project's dashboard, on a section, focused on its next step. */
export function pathHref(projectId: string, opts: { section?: ProjectGoal | null; focus?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (opts.section) params.set("section", opts.section);
  params.set("tab", "nova");
  params.set("focus", opts.focus || PATH_FOCUS.next);
  return `/projects/${projectId}/manage?${params.toString()}`;
}

export function notificationText(n: NotificationShape): string {
  const who = n.actorName;
  switch (n.kind) {
    case "followed_post": return n.projectTitle ? `${who} posted an update on ${n.projectTitle}` : `${who} posted an update`;
    case "comment": return `${who} commented on your post`;
    case "reply": return `${who} replied to your comment`;
    case "post_reaction": return `${who} reacted to your post`;
    case "comment_reaction": return `${who} reacted to your comment`;
    case "mention": return `${who} mentioned you`;
    case "follow": return `${who} started following you`;
    case "project_follow": return n.projectTitle ? `${who} followed ${n.projectTitle}` : `${who} followed your project`;
    case "connection_request": return `${who} wants to connect`;
    case "connection_accepted": return `${who} accepted your connection request`;
    case "path_step_done": return n.projectTitle ? `${who} finished a step on ${n.projectTitle}` : `${who} finished a step on your path`;
    case "next_step": return n.projectTitle ? `Your next step on ${n.projectTitle} is ready` : "Your next step is ready";
    case "artifact_signup": return `${who} joined SparkTower from your artifact`;
    case "invite_accepted": return n.projectTitle ? `${who} accepted your invite to ${n.projectTitle}` : `${who} accepted your invite`;
    case "weekly_update": return n.projectTitle ? `Share this week's progress on ${n.projectTitle}` : "Share this week's progress";
    case "feedback_used": return n.projectTitle ? `${who} used your feedback in an update on ${n.projectTitle}` : `${who} used your feedback in an update`;
    default: return `${who} did something`;
  }
}

/** Where tapping it goes: the post for anything about a post, the person or project otherwise. */
export function notificationHref(n: Pick<NotificationShape, "kind" | "actorId" | "postId" | "projectId" | "section" | "focus">): string {
  if (n.postId) return `/posts/${n.postId}`;
  // The path lives on the project's dashboard: straight to the section the step is on, with its Next Step card in view.
  if ((n.kind === "path_step_done" || n.kind === "next_step") && n.projectId) return pathHref(n.projectId, { section: n.section, focus: n.focus });
  if (n.kind === "weekly_update" && n.projectId) return pathHref(n.projectId, { section: n.section, focus: PATH_FOCUS.weekly });
  if (n.kind === "artifact_signup" && n.projectId) return `/projects/${n.projectId}/manage`;
  if (n.kind === "project_follow" && n.projectId) return `/projects/${n.projectId}`;
  if (n.kind === "invite_accepted" && n.projectId) return `/projects/${n.projectId}/manage?tab=team`;
  if (n.kind === "connection_request") return "/profile";
  return `/profile/${n.actorId}`;
}
