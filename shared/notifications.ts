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
  /**
   * What the notification is about, when that isn't a post or a project — a
   * sprint, for instance. Carried so the link can reach the thing itself
   * rather than dropping the reader on a list to find it again.
   */
  targetId?: string | null;
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
    // Not "cancelled": one person left, and the other is being told, not blamed.
    case "sprint_left": return `${who} left your sprint`;
    /*
     * A teammate in a simulated season tapped "remind them". Phrased as the
     * company waiting rather than the person nagging, because it is — four
     * other people's year resolves tonight either way, and the one who filed
     * is not the villain of the sentence.
     */
    case "sim_nudge": return `${who} is waiting on your seat this year`;
    /*
     * The company-side notifications. The excerpt, shown under the headline,
     * carries the company's name and the thing itself; the headline says what
     * kind of thing it is.
     */
    case "recruit_invite": return `${who} would like to talk to you about a role`;
    case "recruit_answer": return `${who} answered your invitation to talk`;
    case "season_invite": return `${who} invited you to a private training season`;
    case "challenge_entry": return `${who} entered your challenge`;
    case "challenge_result": return "There's news on your challenge entry";
    case "scout_update": return n.projectTitle ? `${n.projectTitle} moved` : "A project you follow moved";
    case "scout_new_project": return "A new project in an industry you watch";
    case "company_added": return `${who} added you to their company`;
    case "company_powers": return `${who} changed what you can do for the company`;
    case "job_due": return "A recurring job of yours is due";
    case "checkin_due": return "It's check-in day";
    case "pledge_received": return n.projectTitle ? `${who} backed ${n.projectTitle}` : `${who} backed your project`;
    case "campaign_decision": return n.projectTitle ? `There's a decision on backing for ${n.projectTitle}` : "There's a decision on your backing campaign";
    case "pledge_refunding": return n.projectTitle ? `${n.projectTitle} wasn't approved — your pledge is being refunded` : "Your pledge is being refunded";
    case "pledge_released": return n.projectTitle ? `Your pledge went to ${n.projectTitle}` : "Your pledge went to the project";
    case "pledge_refunded": return "Your pledge was refunded";
    case "project_application": return n.projectTitle ? `${who} applied to join ${n.projectTitle}` : `${who} applied to join your project`;
    case "application_accepted": return n.projectTitle ? `You're on the team: ${who} accepted your application to ${n.projectTitle}` : `${who} accepted your application`;
    // Plain, and not dressed up: they asked, and this is the answer.
    case "application_rejected": return n.projectTitle ? `Your application to ${n.projectTitle} wasn't accepted` : "Your application wasn't accepted";
    case "project_removed": return n.projectTitle ? `You're no longer on the team for ${n.projectTitle}` : "You were removed from a project's team";
    default: return `${who} did something`;
  }
}

/** Where tapping it goes: the post for anything about a post, the person or project otherwise. */
export function notificationHref(n: Pick<NotificationShape, "kind" | "actorId" | "postId" | "projectId" | "section" | "focus" | "targetId">): string {
  if (n.postId) return `/posts/${n.postId}`;
  // The path lives on the project's dashboard: straight to the section the step is on, with its Next Step card in view.
  if ((n.kind === "path_step_done" || n.kind === "next_step") && n.projectId) return pathHref(n.projectId, { section: n.section, focus: n.focus });
  if (n.kind === "weekly_update" && n.projectId) return pathHref(n.projectId, { section: n.section, focus: PATH_FOCUS.weekly });
  if (n.kind === "artifact_signup" && n.projectId) return `/projects/${n.projectId}/manage`;
  if (n.kind === "project_follow" && n.projectId) return `/projects/${n.projectId}`;
  if (n.kind === "invite_accepted" && n.projectId) return `/projects/${n.projectId}/manage?tab=team`;
  // The owner decides on the Team tab, where the application is waiting with its buttons.
  if (n.kind === "project_application" && n.projectId) return `/projects/${n.projectId}/manage?tab=team`;
  // Accepted: straight into the project they just joined. Declined or removed: its public page, which they can still see.
  if (n.kind === "application_accepted" && n.projectId) return `/projects/${n.projectId}/manage`;
  if ((n.kind === "application_rejected" || n.kind === "project_removed") && n.projectId) return `/projects/${n.projectId}`;
  // Straight to the sprint, so the partner sees the state rather than hunting the list.
  if (n.kind === "sprint_left") return n.targetId ? `/sprints/${n.targetId}` : "/sprints";
  /*
   * Straight to the desk with the form on it. The target carries the year as
   * `venture:year` so one nudge a year is distinct; only the venture is needed
   * to open the right screen, and the desk already knows which year it is on.
   */
  if (n.kind === "sim_nudge") return n.targetId ? `/simulation/${n.targetId.split(":")[0]}` : "/simulation";
  /*
   * Company notifications carry `kind:id` targets. The person being recruited
   * goes to their invitations; everything a company does lands on the
   * company's own page, on the tab it is about.
   */
  if (n.kind === "recruit_invite") return "/talent";
  if (n.kind === "recruit_answer") return n.targetId ? `/companies/${n.targetId.split(":")[0]}?tab=talent` : "/companies";
  if (n.kind === "season_invite") return n.targetId ? `/join-season/${n.targetId.split(":")[1] ?? ""}` : "/simulation";
  if (n.kind === "challenge_entry") return n.targetId ? `/companies/${n.targetId.split(":")[0]}?tab=challenges` : "/companies";
  if (n.kind === "challenge_result") return n.targetId ? `/challenges/${n.targetId.split(":")[0]}` : "/challenges";
  if (n.kind === "scout_update" || n.kind === "scout_new_project") return n.projectId ? `/projects/${n.projectId}` : "/companies";
  // `companyId:…` targets: the company's page, on the tab the change was about.
  if (n.kind === "company_added" || n.kind === "company_powers") return n.targetId ? `/companies/${n.targetId.split(":")[0]}` : "/companies";
  // The Run section of the project, where the jobs and the check-in live.
  // Money: the project it was about, where the backing panel and its updates are.
  if (n.kind === "pledge_received" || n.kind === "campaign_decision") return n.projectId ? `/projects/${n.projectId}/manage?tab=setup` : "/";
  if (n.kind === "pledge_refunding" || n.kind === "pledge_released" || n.kind === "pledge_refunded") return n.projectId ? `/projects/${n.projectId}` : "/";
  if (n.kind === "job_due" || n.kind === "checkin_due") return n.projectId ? `/projects/${n.projectId}/manage?section=run_company` : "/";
  if (n.kind === "connection_request") return "/profile";
  return `/profile/${n.actorId}`;
}
