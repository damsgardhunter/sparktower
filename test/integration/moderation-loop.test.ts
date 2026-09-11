/**
 * The moderation loop for comments, end to end through the API:
 * create → report → queue → decide (action + reason code) → visibility
 * changes → an audit entry with who, what, when, why and the state before.
 *
 * The named risk is a reviewer's mistake. So the checks that matter most are
 * the ones that make a mistake recoverable: nothing happens without a reason
 * code, every entry carries the exact prior state, a report can't be decided
 * twice, and the log itself can't be edited or deleted — not through the app,
 * and not through the database.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { moderationLog, users } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${10 + (n % 200)}`)
    .send({ email: `mod-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: first });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}

/** An author with a comment on their own public check-in, a stranger, and a reviewer. */
async function scene(app: any, content = "You're an idiot and this project is a joke") {
  const author = await person(app, "Author");
  const stranger = await person(app, "Stranger");
  const mod = await person(app, "Reviewer");
  await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, mod.id));

  const project = await author.agent.post("/api/projects").send({ title: "Loop", description: "A project with a comment that gets reported and moderated.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
  const projectId = project.body.id as string;
  const checkIn = await author.agent.post(`/api/projects/${projectId}/check-ins`).send({ goal: "Ship the thing", proof: "Shipped it, honestly", nextStep: "Tell people", needsFeedback: true, visibility: "public" });
  expect(checkIn.status).toBe(200);
  const checkInId = checkIn.body.id as string;
  const url = `/api/projects/${projectId}/comments?targetType=check_in&targetId=${checkInId}`;
  expect((await author.agent.post(`/api/projects/${projectId}/comments`).send({ targetType: "check_in", targetId: checkInId, content })).status).toBeLessThan(300);
  const commentId = ((await author.agent.get(url)).body as any[]).find((c) => c.content === content).id as string;

  const sees = async (who: { agent: request.SuperAgentTest }) => ((await who.agent.get(url)).body as any[]).some((c) => c.id === commentId);
  const report = async () => {
    expect((await stranger.agent.post("/api/reports").send({ targetType: "comment", targetId: commentId, reason: "abuse", note: "Insulting the builder" })).status).toBe(200);
    const queue = (await mod.agent.get("/api/admin/reports?status=open&type=comment")).body as any[];
    return queue.find((r) => r.targetId === commentId);
  };
  const audit = async () => (await mod.agent.get(`/api/admin/moderation-log?targetType=comment&targetId=${commentId}`)).body as any[];
  return { app, author, stranger, mod, commentId, checkInId, sees, report, audit };
}

describe("the comment moderation loop", () => {
  it("report → queue → remove with a reason code → gone for everyone → an audit entry with the state before", async () => {
    const s = await scene(await getTestApp());
    expect(await s.sees(s.stranger)).toBe(true);

    const report = await s.report();
    expect(report).toMatchObject({ status: "open", reason: "abuse", note: "Insulting the builder", actionable: true, targetHiddenMode: null });
    expect(report.snapshot).toContain("You're an idiot");
    const act = (body: object, who = s.mod) => who.agent.post(`/api/admin/reports/${report.id}/act`).send(body);

    // Nothing happens without a reason code — or with one that doesn't fit the action.
    expect((await act({ action: "remove" })).body).toMatchObject({ code: "invalid_input", field: "reasonCode" });
    expect((await act({ action: "remove", reasonCode: "no_violation" })).body).toMatchObject({ field: "reasonCode" });
    expect((await act({ action: "delete_everything", reasonCode: "spam" })).body).toMatchObject({ field: "action" });
    // Not a reviewer: the route doesn't exist, as far as they can tell.
    expect((await act({ action: "remove", reasonCode: "harassment" }, s.stranger)).status).toBe(404);
    expect(await s.audit()).toHaveLength(0);

    const done = await act({ action: "remove", reasonCode: "harassment", note: "Personal attack" });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ ok: true, reportStatus: "actioned" });

    // Visibility: gone for the stranger and, being a removal, for its author too.
    expect(await s.sees(s.stranger)).toBe(false);
    expect(await s.sees(s.author)).toBe(false);

    // The queue: out of Open, into Actioned, marked removed; and it can't be decided twice.
    expect(((await s.mod.agent.get("/api/admin/reports?status=open")).body as any[]).some((r) => r.id === report.id)).toBe(false);
    const actioned = ((await s.mod.agent.get("/api/admin/reports?status=actioned&type=comment")).body as any[]).find((r) => r.id === report.id);
    expect(actioned.targetHiddenMode).toBe("removed");
    expect((await act({ action: "dismiss", reasonCode: "no_violation" })).body.code).toBe("already_resolved");

    // The audit: who, what, when, why, and the state before and after.
    const entries = await s.audit();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toMatchObject({
      action: "comment_remove", actorId: s.mod.id, actorName: "Reviewer", targetUserId: s.author.id,
      targetType: "comment", targetId: s.commentId, reasonCode: "harassment", reason: "Personal attack",
      details: { reportId: report.id, reportReason: "abuse" },
      previousState: { report: { status: "open" }, comment: { hiddenAt: null, hiddenMode: null, hiddenById: null, hiddenReason: null } },
      resultingState: { report: { status: "actioned" }, comment: { hiddenMode: "removed", hiddenById: s.mod.id, hiddenReason: "Harassment or abuse" } },
    });
    expect(entry.resultingState.comment.hiddenAt).toBeTruthy();
    expect(new Date(entry.createdAt).toString()).not.toBe("Invalid Date");
    expect(entry.id).toBe(done.body.logId);
  });

  it("shadow-hide: gone for everyone but its author, who still sees it as posted", async () => {
    const s = await scene(await getTestApp());
    const report = await s.report();
    expect((await s.mod.agent.post(`/api/admin/reports/${report.id}/act`).send({ action: "shadow_hide", reasonCode: "spam" })).status).toBe(200);
    expect(await s.sees(s.stranger)).toBe(false);
    expect(await s.sees(s.author)).toBe(true);
    expect((await s.audit())[0]).toMatchObject({ action: "comment_shadow_hide", resultingState: { comment: { hiddenMode: "shadow" } } });
  });

  it("ban: suspends the author and removes the comment, keeping the account's prior state", async () => {
    const s = await scene(await getTestApp());
    const report = await s.report();
    expect((await s.mod.agent.post(`/api/admin/reports/${report.id}/act`).send({ action: "ban", reasonCode: "hate" })).status).toBe(200);
    expect(await s.sees(s.stranger)).toBe(false);
    // The suspension is real: the author can't write.
    const blocked = await s.author.agent.post("/api/projects").send({ title: "Again", description: "Trying to post again after being banned.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("account_suspended");
    const [entry] = await s.audit();
    expect(entry).toMatchObject({
      action: "comment_ban", reasonCode: "hate",
      previousState: { author: { suspendedAt: null, suspendedReason: null } },
      resultingState: { author: { suspendedReason: "Hate or slurs" }, comment: { hiddenMode: "removed" } },
    });
  });

  it("dismiss: needs a dismissal code, changes nothing but the report, and is still recorded", async () => {
    const s = await scene(await getTestApp(), "I think the pricing page is confusing");
    const report = await s.report();
    expect((await s.mod.agent.post(`/api/admin/reports/${report.id}/act`).send({ action: "dismiss", reasonCode: "spam" })).body.field).toBe("reasonCode");
    expect((await s.mod.agent.post(`/api/admin/reports/${report.id}/act`).send({ action: "dismiss", reasonCode: "no_violation" })).status).toBe(200);
    expect(await s.sees(s.stranger)).toBe(true);
    const [entry] = await s.audit();
    expect(entry).toMatchObject({ action: "comment_dismiss", reasonCode: "no_violation", resultingState: { report: { status: "dismissed" }, comment: { hiddenAt: null } } });
  });
});

describe("the log", () => {
  it("refuses edits and deletes in the database itself", async () => {
    const s = await scene(await getTestApp());
    const report = await s.report();
    await s.mod.agent.post(`/api/admin/reports/${report.id}/act`).send({ action: "remove", reasonCode: "spam" }).expect(200);
    const [entry] = await s.audit();

    // Drizzle wraps the database's error; the trigger's own words are on `cause`.
    const refusal = async (query: PromiseLike<unknown>) => {
      try { await query; return "allowed"; } catch (e: any) { return String(e?.cause?.message ?? e?.message); }
    };
    expect(await refusal(db.update(moderationLog).set({ reasonCode: "no_violation" }).where(eq(moderationLog.id, entry.id))))
      .toBe("moderation_log is append-only: UPDATE refused");
    expect(await refusal(db.delete(moderationLog).where(eq(moderationLog.id, entry.id))))
      .toBe("moderation_log is append-only: DELETE refused");
    const [still] = await db.select().from(moderationLog).where(eq(moderationLog.id, entry.id));
    expect(still.reasonCode).toBe("spam");
  });

  it("records the state before on the older actions too — takedown, restore, suspend", async () => {
    const s = await scene(await getTestApp());
    await s.mod.agent.post(`/api/admin/content/comment/${s.commentId}/hide`).send({ reason: "Rude", reasonCode: "harassment" }).expect(200);
    await s.mod.agent.post(`/api/admin/content/comment/${s.commentId}/restore`).send({}).expect(200);
    expect(await s.sees(s.stranger)).toBe(true);
    await s.mod.agent.post(`/api/admin/users/${s.author.id}/suspend`).send({ suspended: true, reason: "Repeated abuse" }).expect(200);

    const [restored, hidden] = await s.audit();
    expect(hidden).toMatchObject({ action: "content_hidden", reasonCode: "harassment", previousState: { hiddenAt: null, hiddenMode: null }, resultingState: { hiddenMode: "removed" } });
    expect(restored).toMatchObject({ action: "content_restored", previousState: { hiddenMode: "removed" }, resultingState: { hiddenAt: null, hiddenMode: null } });
    const suspension = ((await s.mod.agent.get(`/api/admin/moderation-log?action=suspend&targetId=${s.author.id}`)).body as any[])[0];
    expect(suspension).toMatchObject({ previousState: { suspendedAt: null }, resultingState: { suspendedReason: "Repeated abuse" } });
  });
});
