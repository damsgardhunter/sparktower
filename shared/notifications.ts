/**
 * How a notification reads and where it goes. Shared, so the web bell and the
 * mobile inbox say the same thing and open the same place.
 */
import type { NotificationKind } from "./schema";

export interface NotificationShape {
  kind: NotificationKind;
  actorId: string;
  actorName: string;
  postId: string | null;
  projectId: string | null;
  projectTitle: string | null;
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
    case "weekly_update": return n.projectTitle ? `Share this week's progress on ${n.projectTitle}` : "Share this week's progress";
    case "feedback_used": return n.projectTitle ? `${who} used your feedback in an update on ${n.projectTitle}` : `${who} used your feedback in an update`;
    default: return `${who} did something`;
  }
}

/** Where tapping it goes: the post for anything about a post, the person or project otherwise. */
export function notificationHref(n: Pick<NotificationShape, "kind" | "actorId" | "postId" | "projectId">): string {
  if (n.postId) return `/posts/${n.postId}`;
  // The path lives on the project's own screen, where the next step is the first thing shown.
  if ((n.kind === "path_step_done" || n.kind === "next_step" || n.kind === "weekly_update") && n.projectId) return `/projects/${n.projectId}/manage`;
  if (n.kind === "project_follow" && n.projectId) return `/projects/${n.projectId}`;
  if (n.kind === "connection_request") return "/profile";
  return `/profile/${n.actorId}`;
}
