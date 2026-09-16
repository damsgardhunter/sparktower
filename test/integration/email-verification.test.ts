/**
 * Confirming the address someone signed up with.
 *
 * Signing up works at once — nobody waits at the door — but until the address
 * is confirmed, nothing this account writes reaches another person. That's the
 * whole guarantee, so it's checked from both sides: the blocked paths are
 * actually refused, the rest of the app still works, and the link confirms
 * once, expires, and can't be reused or aimed at a different address.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { emailVerificationTokens, users } from "@shared/schema";
import { devOutbox } from "../../server/email";
import { sendVerificationEmail, confirmVerification } from "../../server/email-verification";
import { sweepFinishedRecords } from "../../server/retention";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const password = "Testpass123!";
async function signUp(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `verify-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${60 + (n % 150)}`)
    .send({ email, password, firstName: first });
  expect(res.status).toBe(201);
  return { agent, email, id: res.body.id as string };
}
/** The token from the link that was sent, as the person would get it from their inbox. */
const linkToken = (email: string): string | null => {
  const mail = devOutbox().find((m) => m.to === email && m.tag === "verify-email");
  return /verify-email\?token=([^\s&]+)/.exec(mail?.text ?? "")?.[1] ?? null;
};

describe("a new account", () => {
  it("is created unconfirmed, with a link on its way", async () => {
    const app = await getTestApp();
    const person = await signUp(app, "Fresh");
    const [row] = await db.select().from(users).where(eq(users.id, person.id));
    expect(row.emailVerifiedAt).toBeNull();
    expect(linkToken(person.email), "a verification link was sent").toBeTruthy();
    // The account works: they're signed in, and can set up their own project.
    expect((await person.agent.get("/api/auth/user")).status).toBe(200);
    const project = await person.agent.post("/api/projects").send({ title: "Unconfirmed", description: "A project someone starts before confirming their address.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
    expect(project.status).toBe(200);
  });

  it("can't reach other people until the address is confirmed, and can as soon as it is", async () => {
    const app = await getTestApp();
    const person = await signUp(app, "Quiet");
    const other = await signUp(app, "Other");
    const projectId = (await person.agent.post("/api/projects").send({ title: "Quiet Project", description: "Somewhere to try posting from before confirming.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body.id;

    const blocked = [
      ["a public post", () => person.agent.post("/api/feed").send({ postType: "looking_for_help", content: "Anyone around to look at this early build of mine?" })],
      ["a message", () => person.agent.post(`/api/messages/${other.id}`).send({ content: "Hello there, have you got a minute?" })],
      ["an invite", () => person.agent.post(`/api/projects/${projectId}/invites`).send({ email: "someone@example.test", role: "Engineer" })],
      ["a connection request", () => person.agent.post("/api/connections/request").send({ userId: other.id })],
      ["a report", () => person.agent.post("/api/reports").send({ targetType: "comment", targetId: "00000000-0000-0000-0000-000000000000", reason: "spam" })],
      ["a project comment", () => person.agent.post(`/api/projects/${projectId}/comments`).send({ targetType: "project", targetId: projectId, content: "Commenting before confirming." })],
      // Publishing puts a page on the open internet; applying is a message to an owner; a reaction notifies an author.
      ["publishing an artifact", () => person.agent.post("/api/artifacts/00000000-0000-0000-0000-000000000000/publish").send({})],
      ["publishing a document", () => person.agent.post("/api/documents/00000000-0000-0000-0000-000000000000/publish").send({})],
      ["applying to a project", () => person.agent.post(`/api/projects/${projectId}/apply`).send({ message: "I'd like to help with this." })],
      ["reacting to a post", () => person.agent.post("/api/feed/00000000-0000-0000-0000-000000000000/react").send({ reaction: "like" })],
      ["a sprint message", () => person.agent.post("/api/sprints/00000000-0000-0000-0000-000000000000/messages").send({ content: "Hello partner." })],
    ] as const;
    for (const [what, call] of blocked) {
      const res = await call();
      expect(res.status, what).toBe(403);
      expect(res.body.code, what).toBe("email_unverified");
    }
    // Nothing went out.
    expect((await request(app).get("/api/feed?limit=50")).body.posts.some((p: any) => p.content?.includes("early build of mine"))).toBe(false);

    // The link from the inbox. It confirms without needing to be signed in as anyone.
    const token = linkToken(person.email)!;
    const confirmed = await request(app).post("/api/auth/verify-email").set("x-forwarded-for", "198.51.100.230").send({ token });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body).toMatchObject({ ok: true, userId: person.id });

    // Now everything works, on the same session as before.
    const post = await person.agent.post("/api/feed").send({ postType: "looking_for_help", content: "Anyone around to look at this early build of mine?" });
    expect(post.status, JSON.stringify(post.body)).toBe(200);
    // Messaging needs an accepted connection of its own, so the request is the thing to check here.
    const connect = await person.agent.post("/api/connections/request").send({ userId: other.id });
    expect(connect.status, JSON.stringify(connect.body)).toBeLessThan(300);
    const stillGated = await person.agent.post(`/api/messages/${other.id}`).send({ content: "Hello there, have you got a minute?" });
    expect(stillGated.body.code).not.toBe("email_unverified");
  });

  it("spends a link once, refuses an expired or altered one, and lets another be sent", async () => {
    const app = await getTestApp();
    const person = await signUp(app, "Links");
    const first = linkToken(person.email)!;

    // A second link doesn't kill the first: people click whichever they find.
    const again = await person.agent.post("/api/auth/verify-email/send");
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ ok: true, sentTo: person.email });
    const links = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, person.id));
    expect(links).toHaveLength(2);

    const bad = await request(app).post("/api/auth/verify-email").set("x-forwarded-for", "198.51.100.231").send({ token: `${first}x` });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("invalid");

    // Expired links are refused with something better than "invalid".
    await db.update(emailVerificationTokens).set({ expiresAt: sql`now() - interval '1 hour'` })
      .where(eq(emailVerificationTokens.id, links[1].id));
    const stale = await request(app).post("/api/auth/verify-email").set("x-forwarded-for", "198.51.100.232").send({ token: linkToken(person.email)! });
    expect(stale.body.code).toBe("expired");

    expect((await request(app).post("/api/auth/verify-email").set("x-forwarded-for", "198.51.100.233").send({ token: first })).status).toBe(200);
    // Spent: the same link a second time is not a way in.
    const reused = await request(app).post("/api/auth/verify-email").set("x-forwarded-for", "198.51.100.234").send({ token: first });
    expect(reused.status).toBe(200); // already confirmed, and nothing changes
    const [row] = await db.select().from(users).where(eq(users.id, person.id));
    const usedRows = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, person.id));
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(usedRows.find((r) => r.id === links[0].id)?.usedAt).not.toBeNull();

    // Once confirmed, asking again just says so.
    expect((await person.agent.post("/api/auth/verify-email/send")).body).toMatchObject({ alreadyVerified: true });
  });

  it("won't confirm an address the account no longer uses", async () => {
    const app = await getTestApp();
    const person = await signUp(app, "Moved");
    const token = linkToken(person.email)!;
    await db.update(users).set({ email: `moved-${Date.now()}@example.test` }).where(eq(users.id, person.id));
    const res = await request(app).post("/api/auth/verify-email").set("x-forwarded-for", "198.51.100.235").send({ token });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("address_changed");
  });

  it("sweeps spent and expired links, and leaves live ones alone", async () => {
    const app = await getTestApp();
    const person = await signUp(app, "Sweep");
    const [live] = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, person.id));
    await sendVerificationEmail({ id: person.id, email: person.email, firstName: "Sweep" });
    const rows = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, person.id));
    const old = rows.find((r) => r.id !== live.id)!;
    await db.update(emailVerificationTokens).set({ expiresAt: sql`now() - interval '30 days'` }).where(eq(emailVerificationTokens.id, old.id));

    await sweepFinishedRecords();
    const left = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, person.id));
    expect(left.map((r) => r.id)).toEqual([live.id]);
    // And the helper says no when there's nothing to confirm with.
    expect(await confirmVerification("")).toMatchObject({ ok: false, reason: "invalid" });
  });
});
