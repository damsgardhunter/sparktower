/**
 * Contests: joining one, submitting to it, and the refusals in between.
 *
 * The screens exist on the web and the phone, the routes exist, and until now
 * nothing drove them: `contests` and `contest_participants` were named by no
 * test, so "built but unused" was as much as anyone could say. Unused is fine —
 * nobody has run a contest yet. Unproven isn't: the first contest is the worst
 * moment to find out that joining it doesn't work.
 *
 * The fixtures build contests with SQL rather than through the admin routes,
 * so these tests stay about joining and submitting; the admin routes have
 * their own test (contest-admin.test.ts).
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { contests, contestParticipants } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.117.${20 + (n++ % 200)}`;
const day = 86_400_000;

async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `contest-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  expect((await agent.post("/api/auth/register").set("x-forwarded-for", ip()).send({ email, password: "Testpass123!", firstName: first })).status).toBe(201);
  await verifyEmail(app, email, ip());
  return { agent, email };
}

async function contest(fields: Partial<typeof contests.$inferInsert> = {}) {
  const [row] = await db.insert(contests).values({
    title: `Ship in a weekend ${Date.now()}`,
    description: "Build and publish something in 48 hours.",
    category: "saas",
    status: "active",
    startDate: new Date(Date.now() - day),
    endDate: new Date(Date.now() + day),
    ...fields,
  } as any).returning();
  return row;
}

describe("joining a contest", () => {
  it("shows up in the list, adds the person, and says so on the way back", async () => {
    const app = await getTestApp();
    const builder = await person(app, "Builder");
    const live = await contest();

    // Signed out, the list is readable and nobody is a participant.
    const anonymous = await request(app).get("/api/contests");
    expect(anonymous.status).toBe(200);
    expect((anonymous.body as any[]).find((c) => c.id === live.id)).toMatchObject({ isParticipant: false });

    const joined = await builder.agent.post(`/api/contests/${live.id}/join`).set("x-forwarded-for", ip()).send({});
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);

    // The contest now knows them — in the list, on the contest, and in its participants.
    const listed = ((await builder.agent.get("/api/contests")).body as any[]).find((c) => c.id === live.id);
    expect(listed.isParticipant).toBe(true);
    expect((await builder.agent.get(`/api/contests/${live.id}`)).body.isParticipant).toBe(true);
    const participants = await builder.agent.get(`/api/contests/${live.id}/participants`);
    expect(participants.status).toBe(200);
    expect((participants.body as any[]).length).toBe(1);
    expect((await db.select().from(contestParticipants).where(eq(contestParticipants.contestId, live.id)))).toHaveLength(1);
  });

  it("refuses a second join, a contest that's over, a full one, and one that doesn't exist", async () => {
    const app = await getTestApp();
    const builder = await person(app, "Twice");
    const live = await contest();

    expect((await builder.agent.post(`/api/contests/${live.id}/join`).set("x-forwarded-for", ip()).send({})).status).toBe(200);
    const again = await builder.agent.post(`/api/contests/${live.id}/join`).set("x-forwarded-for", ip()).send({});
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/already joined/i);

    // Judging has started: no more entrants.
    const closed = await contest({ status: "judging" });
    expect((await builder.agent.post(`/api/contests/${closed.id}/join`).set("x-forwarded-for", ip()).send({})).status).toBe(400);

    // Full: the cap is the cap.
    const small = await contest({ maxParticipants: 1 });
    const first = await person(app, "First");
    expect((await first.agent.post(`/api/contests/${small.id}/join`).set("x-forwarded-for", ip()).send({})).status).toBe(200);
    const late = await person(app, "Late");
    const full = await late.agent.post(`/api/contests/${small.id}/join`).set("x-forwarded-for", ip()).send({});
    expect(full.status).toBe(400);
    expect(full.body.message).toMatch(/full/i);

    expect((await builder.agent.post("/api/contests/00000000-0000-4000-8000-000000000001/join").set("x-forwarded-for", ip()).send({})).status).toBe(404);
    // And signing in is the price of entry.
    expect((await request(app).post(`/api/contests/${live.id}/join`).set("x-forwarded-for", ip()).send({})).status).toBe(401);
  });
});

describe("submitting to a contest", () => {
  it("takes the entry from someone who joined, and refuses everyone else", async () => {
    const app = await getTestApp();
    const entrant = await person(app, "Entrant");
    const bystander = await person(app, "Bystander");
    const live = await contest();

    // Not joined yet: there's nothing to submit to.
    const early = await entrant.agent.post(`/api/contests/${live.id}/submit`).set("x-forwarded-for", ip()).send({ submissionUrl: "https://example.test/build" });
    expect(early.status).toBe(400);
    /*
     * The `code`, not the sentence. This asserted /join/i and broke when the
     * message was reworded to "Enter the contest first." — which is the word the
     * product uses everywhere else for a contest, so the prose was right to
     * change and the test was reading the wrong thing.
     */
    expect(early.body.code).toBe("not_entered");

    expect((await entrant.agent.post(`/api/contests/${live.id}/join`).set("x-forwarded-for", ip()).send({})).status).toBe(200);

    // A submission needs somewhere to look.
    expect((await entrant.agent.post(`/api/contests/${live.id}/submit`).set("x-forwarded-for", ip()).send({})).status).toBe(400);

    const sent = await entrant.agent.post(`/api/contests/${live.id}/submit`).set("x-forwarded-for", ip())
      .send({ submissionUrl: "https://example.test/build", submissionNote: "Built it in a weekend." });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);

    const [row] = await db.select().from(contestParticipants).where(eq(contestParticipants.contestId, live.id));
    expect(row.submissionUrl).toBe("https://example.test/build");
    expect(row.submissionNote).toBe("Built it in a weekend.");

    // Someone who never joined can't submit to it either.
    const outside = await bystander.agent.post(`/api/contests/${live.id}/submit`).set("x-forwarded-for", ip()).send({ submissionUrl: "https://example.test/theirs" });
    expect(outside.status).toBe(400);

    // Once judging starts, entries close — the entry already in stays as it was.
    await db.update(contests).set({ status: "judging" }).where(eq(contests.id, live.id));
    const late = await entrant.agent.post(`/api/contests/${live.id}/submit`).set("x-forwarded-for", ip()).send({ submissionUrl: "https://example.test/late" });
    expect(late.status).toBe(400);
    const [unchanged] = await db.select().from(contestParticipants).where(eq(contestParticipants.contestId, live.id));
    expect(unchanged.submissionUrl).toBe("https://example.test/build");
  });

  it("refuses something that isn't a link, and says what is wrong with it", async () => {
    /*
     * `submissionUrl` used to be a truthiness test, so "asdf" and a thousand
     * characters of pasted prose were both accepted — and the judge was the one
     * who found out. The entry *is* the link; it is worth checking.
     */
    const app = await getTestApp();
    const entrant = await person(app, "Typo");
    const live = await contest();
    expect((await entrant.agent.post(`/api/contests/${live.id}/join`).set("x-forwarded-for", ip()).send({})).status).toBe(200);

    for (const bad of ["asdf", "example.test/build", "javascript:alert(1)", " ", "x".repeat(2100)]) {
      const res = await entrant.agent.post(`/api/contests/${live.id}/submit`).set("x-forwarded-for", ip()).send({ submissionUrl: bad });
      expect(res.status, `"${bad.slice(0, 20)}" should be refused`).toBe(400);
      expect(res.body.field).toBe("submissionUrl");
    }

    /* Nothing was written by any of those. */
    const [row] = await db.select().from(contestParticipants).where(eq(contestParticipants.contestId, live.id));
    expect(row.submissionUrl).toBeNull();
  });

  it("tells somebody entered in an unopened contest that they are in and may file later", async () => {
    /*
     * Joining takes `upcoming`; submitting does not. The old message said
     * "Contest is not accepting submissions" for this *and* for a closed one,
     * which told neither person which way it was shut.
     */
    const app = await getTestApp();
    const early = await person(app, "Early");
    const soon = await contest({ status: "upcoming" });
    expect((await early.agent.post(`/api/contests/${soon.id}/join`).set("x-forwarded-for", ip()).send({})).status).toBe(200);

    const res = await early.agent.post(`/api/contests/${soon.id}/submit`).set("x-forwarded-for", ip()).send({ submissionUrl: "https://example.test/early" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("contest_closed");
    expect(res.body.message).toMatch(/hasn't opened yet/);
    expect(res.body.message, "and it should say they are already entered").toMatch(/you're entered/i);
  });

  it("tells the viewer about their own entry, and about nobody else's", async () => {
    /*
     * The gap that made entering a dead end on both clients: the list carried
     * `isParticipant` and nothing else, so no screen could tell somebody who had
     * joined from somebody who had filed — and so no screen offered to file.
     */
    const app = await getTestApp();
    const mine = await person(app, "Mine");
    const theirs = await person(app, "Theirs");
    const live = await contest();

    for (const who of [mine, theirs]) {
      expect((await who.agent.post(`/api/contests/${live.id}/join`).set("x-forwarded-for", ip()).send({})).status).toBe(200);
    }
    await theirs.agent.post(`/api/contests/${live.id}/submit`).set("x-forwarded-for", ip())
      .send({ submissionUrl: "https://example.test/theirs", submissionNote: "secret sauce" }).expect(200);

    /* Joined, not filed: a submission of null is what offers the button. */
    const before = (await mine.agent.get("/api/contests")).body.find((c: any) => c.id === live.id);
    expect(before.isParticipant).toBe(true);
    expect(before.submission).toBeNull();

    /* And the other person's entry is not in it — entries are not public before judging. */
    expect(JSON.stringify(before)).not.toContain("secret sauce");

    await mine.agent.post(`/api/contests/${live.id}/submit`).set("x-forwarded-for", ip())
      .send({ submissionUrl: "https://example.test/mine", submissionNote: "mine" }).expect(200);

    const after = (await mine.agent.get("/api/contests")).body.find((c: any) => c.id === live.id);
    expect(after.submission).toEqual({ url: "https://example.test/mine", note: "mine" });

    /* The detail route agrees with the list, since the phone reads both. */
    const one = (await mine.agent.get(`/api/contests/${live.id}`)).body;
    expect(one.submission).toEqual({ url: "https://example.test/mine", note: "mine" });

    /* Signed out, the key is present and null rather than missing. */
    const anon = (await request(app).get("/api/contests")).body.find((c: any) => c.id === live.id);
    expect(anon.isParticipant).toBe(false);
    expect(anon.submission).toBeNull();
  });
});
