/**
 * Every write that could reach another person is either behind the email gate
 * or written down here with why it isn't.
 *
 * The gate is a list of paths (server/email-verification.ts), and a list is
 * only as good as its upkeep: a social route added next month doesn't match a
 * regex nobody updated, and an unconfirmed address quietly gets a way to put
 * words in front of people again. So the families that tend to reach someone —
 * posts, comments, reactions, messages, invites, applications, reports,
 * publishing — are swept from the route table, and each one must be in the
 * gate or in the exceptions below.
 *
 * Adding a route means one line: gate it, or say who it doesn't reach.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { buildRouteCoverage } from "../../server/route-coverage";
import { REACHES_OTHERS } from "../../server/email-verification";
import { serverSourceFiles } from "../helpers/server-files";

/** Paths that look social but stay inside the account's own work, and why. */
const DOESNT_REACH_ANYONE: Record<string, string> = {
  "POST /api/artifacts/:id/unpublish": "takes a page down — the safe direction",
  "POST /api/projects/:id/backing/tiers/apply-template": "fills in the project's own tier template",
  "POST /api/code-audits/:auditId/apply": "applies an audit's changes to their own board",
  "POST /api/communities/:slug/join": "joining a community notifies nobody",
  "DELETE /api/communities/:slug/join": "leaving notifies nobody",
  "DELETE /api/feed/:id": "removing their own post",
  "DELETE /api/feed/comments/:commentId": "removing their own comment",
  "DELETE /api/project-comments/:commentId": "removing their own comment",
  "POST /api/projects/:id/feedback/seen": "marks feedback read, for them",
  "POST /api/feed/comments/:commentId/apply": "turns feedback into a task on their board",
  "POST /api/me/feedback-used/seen": "marks their own notice read",
  "PATCH /api/investment-applications/:id": "the owner deciding on an application they received",
  "DELETE /api/projects/:id/invites/:inviteId": "withdrawing an invite",
  "POST /api/invites/:token/accept": "joining — often the first thing a new account does, and the invite was addressed to them",
  "POST /api/mcp/projects/:projectId/apply": "applies operations to their own board through the editor bridge",
  "POST /api/admin/reports/:id/act": "a reviewer deciding; reviewers are confirmed accounts with 2FA",
  "PATCH /api/admin/reports/:id": "a reviewer deciding",
  "POST /api/projects/:id/nova/apply": "applies Nova's suggestion to their own project",
  "POST /api/feed/image": "generates an image for a draft; posting it is gated",
  "POST /api/profile/apply-resume-draft": "fills in their own profile",
  "POST /api/applications/:id/accept": "the owner deciding on an application they received",
  "POST /api/applications/:id/reject": "the owner deciding on an application they received",
  "POST /api/projects/:id/follow": "following is how discovery works, and it carries no words of theirs",
  "POST /api/users/:id/follow": "following is how discovery works, and it carries no words of theirs",
  "DELETE /api/connections/:id": "ending a connection",
  "POST /api/connections/:id/accept": "answering a request that was sent to them",
  "POST /api/connections/:id/reject": "answering a request that was sent to them",
  "POST /api/messages/:userId/read": "marks a conversation read, for them",
  "POST /api/contests/:id/join": "entering a contest",
  "POST /api/games/:id/submit": "a decision inside a game the two of them already share",
  "POST /api/games/:id/leave": "walking out of a game they are already in",
  "POST /api/contests/:id/submit": "a contest entry, judged by the organiser",
  "POST /api/documents/:docId/unpublish": "takes a page down — the safe direction",
  "POST /api/projects/:id/tasks/nova-assist/apply": "applies Nova's help to their own board",
  "POST /api/projects/:id/application-questions": "sets the questions on their own project",
  "POST /api/projects/:id/health-findings/feedback": "rates a finding Nova gave them, seen by nobody else",
  "DELETE /api/health-findings/feedback/:feedbackId": "removing their own rating",
  "POST /api/company-invites/accept": "joining a company whose admin sent them the link",
  "POST /api/talent/invites/:id/answer": "answering an invitation that was sent to them",
  "POST /api/companies/:id/invite-link/reset": "retires the company's own invite links; tells nobody",
  "POST /api/companies/:id/follows/:projectId": "following is how scouting works, and it carries no words of theirs",
  "DELETE /api/companies/:id/follows/:projectId": "unfollowing",
  "POST /api/projects/:id/health-check/apply": "applies a health check to their own board",
};

/** Route families that tend to put something in front of someone else. */
const SOCIAL = /feed|comment|message|invite|report|connection|publish|apply|application|react|follow|contest|communit|discussion|games\/.*(submit|leave)/i;

describe("writes that reach other people", () => {
  it("are gated on a confirmed email, or named here with why they aren't", () => {
    // What is on disk, not what git tracks — see test/helpers/server-files.ts.
    const rows = buildRouteCoverage(serverSourceFiles().map((f) => ({ ...f, size: 1 })) as any).rows
      .filter((r) => r.write && r.auth && r.mounted !== false && SOCIAL.test(r.path));
    expect(rows.length).toBeGreaterThan(20);

    const undecided = rows
      .filter((r) => !REACHES_OTHERS.some((re) => re.test(r.path)))
      .map((r) => `${r.method} ${r.path}`)
      .filter((key) => !(key in DOESNT_REACH_ANYONE));
    // Each of these needs a decision: add it to REACHES_OTHERS, or to DOESNT_REACH_ANYONE with the reason.
    expect(undecided).toEqual([]);
  });

  it("gate the ones that carry someone's words or publish a page", () => {
    const gated = (path: string) => REACHES_OTHERS.some((re) => re.test(path));
    for (const path of [
      "/api/feed", "/api/feed/abc/comments", "/api/projects/p1/comments", "/api/messages/u1",
      "/api/connections/request", "/api/reports", "/api/projects/p1/invites",
      "/api/projects/p1/apply", "/api/projects/p1/investment/applications",
      "/api/artifacts/a1/publish", "/api/documents/d1/publish",
      "/api/feed/p1/react", "/api/feed/comments/c1/react", "/api/project-comments/c1/react",
      "/api/games/g1/messages", "/api/companies/c1/members",
    ]) expect(gated(path), path).toBe(true);

    // And leave alone what stays inside their own work.
    for (const path of ["/api/projects/p1/kanban", "/api/projects/p1", "/api/invites/tok/accept", "/api/feed/p1", "/api/projects/p1/follow",
      // Changing a colleague's powers or removing them stays inside the company.
      "/api/companies/c1/members/u1", "/api/companies/c1/members/u1/permissions"]) {
      expect(gated(path), path).toBe(false);
    }
  });
});
