/**
 * Sponsored challenges against a real database.
 *
 * Most of what matters is who may do what, and when. A stranger must not learn
 * a company exists from its management routes; a plain member can look but not
 * judge; the company's own people can't enter the challenge they judge; and
 * the deadline closes the door on its own, even though nothing moves the
 * stored status when the clock runs out. That last one is the easiest to break
 * quietly, so it is tested by writing a past deadline straight into the row.
 *
 * Companies are inserted directly: their own routes belong to another feature,
 * and this file is about challenges.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { companies, companyMembers, companyChallenges, challengeEntries, notifications, projects, users } from "@shared/schema";
import { CHALLENGE_FEE_CENTS, MIN_PRIZE_CENTS } from "@shared/challenges-money";

afterAll(async () => { await closeTestApp(); });

/* A range no other spec uses: registering counts against a per-address budget. */
let n = 0;
async function person(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.171.${(n % 200) + 20}`;
  const email = `chal-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `C${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

async function company(ownerId: string, others: { userId: string; role: "admin" | "member" }[] = []) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [c] = await db.insert(companies).values({
    name: `Acme ${suffix}`, slug: `acme-${suffix}`, industry: "E-Commerce", createdBy: ownerId, createdAt: new Date(),
    /*
     * Proved, because a company that has not proved a domain cannot put a
     * challenge in front of strangers — that is the whole point of the check
     * and it is tested where it belongs, in company-verification.test.ts. The
     * rows are written straight in here rather than through the route, so the
     * proof has to be written in too.
     */
    verifiedDomain: `acme-${suffix}.test`, verifiedAt: new Date(), verifiedMethod: "file",
  }).returning();
  await db.insert(companyMembers).values([
    { companyId: c.id, userId: ownerId, role: "owner", joinedAt: new Date() },
    ...others.map((o) => ({ companyId: c.id, userId: o.userId, role: o.role, joinedAt: new Date() })),
  ]);
  return c;
}

const DAY = 86_400_000;
const brief = {
  title: "Cut our returns rate",
  brief: "We ship furniture and a fifth of it comes back. Show us a way to cut that without cutting sales.",
  criteria: "Evidence it works on real customers.",
  /* The words, for anything the money cannot say. */
  prize: "$5,000 and a paid pilot",
  /*
   * And the money itself, which is now held by SparkTower until a winner is
   * picked. In the shared brief rather than passed at each call site so that
   * every test expecting a 400 still gets it for the reason it names — a
   * missing prize would refuse them all first and quietly stop them testing
   * the title, the deadline and the industry at all.
   */
  prizeCents: MIN_PRIZE_CENTS,
  terms: "Winners are paid within 30 days of the announcement. Entrants keep their own IP unless a pilot is agreed.",
  industry: "E-Commerce",
};
const inAMonth = () => new Date(Date.now() + 30 * DAY).toISOString();
const entry = (extra: Record<string, unknown> = {}) => ({
  title: "Fit before you buy",
  pitch: "A room scanner that tells a customer whether the sofa fits before they order it, not after.",
  acceptTerms: true,
  ...extra,
});

let app: any;
let owner: Awaited<ReturnType<typeof person>>;
let member: Awaited<ReturnType<typeof person>>;
let stranger: Awaited<ReturnType<typeof person>>;
let acme: Awaited<ReturnType<typeof company>>;

/*
 * Every test starts from an empty database (test/setup/each-test.ts truncates
 * before each one), so the cast is built again inside each test.
 */
beforeEach(async () => {
  app = await getTestApp();
  owner = await person(app);
  member = await person(app);
  stranger = await person(app);
  acme = await company(owner.id, [{ userId: member.id, role: "member" }]);
});

async function newChallenge(extra: Record<string, unknown> = {}) {
  /*
   * The fee and the prize leave the balance together, so whoever posts has to
   * have the money. Topped up here rather than in every caller: what this file
   * is about is who may post and what they may write, not the escrow, which
   * company-verification.test.ts covers.
   */
  await db.update(users).set({ balanceCents: CHALLENGE_FEE_CENTS + MIN_PRIZE_CENTS * 4 }).where(eq(users.id, owner.id));
  const res = await owner.agent.post(`/api/companies/${acme.id}/challenges`).send({ ...brief, deadline: inAMonth(), ...extra });
  expect(res.status, res.text).toBe(201);
  return res.body as { id: string };
}

describe("posting a challenge", () => {
  it("checks what the company writes", async () => {
    const base = `/api/companies/${acme.id}/challenges`;
    // Enough for the one that is meant to succeed at the end of this.
    await db.update(users).set({ balanceCents: CHALLENGE_FEE_CENTS + MIN_PRIZE_CENTS * 4 }).where(eq(users.id, owner.id));
    expect((await owner.agent.post(base).send({ ...brief, deadline: inAMonth(), title: "x" })).status).toBe(400);
    expect((await owner.agent.post(base).send({ ...brief, deadline: inAMonth(), brief: "too short" })).status).toBe(400);
    expect((await owner.agent.post(base).send({ ...brief, deadline: inAMonth(), terms: "" })).status).toBe(400);
    expect((await owner.agent.post(base).send({ ...brief, deadline: new Date(Date.now() - DAY).toISOString() })).status).toBe(400);
    expect((await owner.agent.post(base).send({ ...brief, deadline: new Date(Date.now() + 400 * DAY).toISOString() })).status).toBe(400);
    expect((await owner.agent.post(base).send({ ...brief, deadline: inAMonth(), industry: "Space piracy" })).status).toBe(400);
    const ok = await owner.agent.post(base).send({ ...brief, deadline: inAMonth() });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe("open");
  });

  it("is hidden from strangers and closed to plain members", async () => {
    const base = `/api/companies/${acme.id}/challenges`;
    expect((await stranger.agent.post(base).send({ ...brief, deadline: inAMonth() })).status).toBe(404);
    expect((await stranger.agent.get(base)).status).toBe(404);
    expect((await member.agent.post(base).send({ ...brief, deadline: inAMonth() })).status).toBe(403);
    expect((await member.agent.get(base)).status).toBe(200);
    const c = await newChallenge();
    expect((await member.agent.post(`${base}/${c.id}/close-entries`)).status).toBe(403);
    expect((await stranger.agent.post(`${base}/${c.id}/close-entries`)).status).toBe(404);
    expect((await member.agent.patch(`${base}/${c.id}`).send({ prize: "More" })).status).toBe(403);
  });

  it("can be edited only while open, never into the past, and the deal holds still once someone's in", async () => {
    const c = await newChallenge();
    const url = `/api/companies/${acme.id}/challenges/${c.id}`;
    expect((await owner.agent.patch(url).send({ deadline: new Date(Date.now() - DAY).toISOString() })).status).toBe(400);
    expect((await owner.agent.patch(url).send({ prize: "$6,000" })).status).toBe(200);
    const founder = await person(app);
    expect((await founder.agent.post(`/api/challenges/${c.id}/enter`).send(entry())).status).toBe(201);
    expect((await owner.agent.patch(url).send({ prize: "$50" })).status).toBe(409);
    // What entrants answered holds still too: the brief and the criteria.
    expect((await owner.agent.patch(url).send({ criteria: "Clearer criteria now." })).status).toBe(409);
    expect((await owner.agent.patch(url).send({ brief: `${brief.brief} Also, do it by Friday.` })).status).toBe(409);
    // More time is fine; less is not.
    expect((await owner.agent.patch(url).send({ deadline: new Date(Date.now() + 40 * DAY).toISOString() })).status).toBe(200);
    expect((await owner.agent.patch(url).send({ deadline: new Date(Date.now() + 10 * DAY).toISOString() })).status).toBe(409);
    await owner.agent.post(`${url}/close-entries`);
    expect((await owner.agent.patch(url).send({ criteria: "Too late." })).status).toBe(409);
  });

  it("won't move a deadline that has already passed, so an expired challenge can't be quietly reopened", async () => {
    const c = await newChallenge();
    await db.update(companyChallenges).set({ deadline: new Date(Date.now() - 1000) }).where(eq(companyChallenges.id, c.id));
    const moved = await owner.agent.patch(`/api/companies/${acme.id}/challenges/${c.id}`).send({ deadline: inAMonth() });
    expect(moved.status).toBe(409);
    expect(moved.body.code).toBe("deadline_passed");
    expect((await stranger.agent.get(`/api/challenges/${c.id}`)).body.acceptingEntries).toBe(false);
  });
});

describe("the public list and results", () => {
  it("finds live challenges even behind hundreds of expired ones", async () => {
    const past = new Date(Date.now() - DAY);
    await db.insert(companyChallenges).values(Array.from({ length: 205 }, (_, i) => ({
      companyId: acme.id, title: `Old ${i}`, brief: brief.brief, terms: brief.terms, deadline: past,
      status: "open" as const, createdBy: owner.id, createdAt: new Date(),
    })));
    const live = await newChallenge();
    const open = (await stranger.agent.get("/api/challenges?status=open")).body.map((c: any) => c.id);
    expect(open).toEqual([live.id]);
    const judging = (await stranger.agent.get("/api/challenges?status=judging")).body;
    expect(judging.length).toBeGreaterThan(0);
    expect(judging.map((c: any) => c.id)).not.toContain(live.id);
  });

  it("names a winning project only if the project is public", async () => {
    const c = await newChallenge();
    const [pub, priv] = [await person(app), await person(app)];
    const [open] = await db.insert(projects).values({ title: "Open Fit", description: "Public.", category: "SaaS", ownerId: pub.id, isPrivate: false } as any).returning();
    const [secret] = await db.insert(projects).values({ title: "Stealth Fit", description: "Private.", category: "SaaS", ownerId: priv.id, isPrivate: true } as any).returning();
    const a = await pub.agent.post(`/api/challenges/${c.id}/enter`).send(entry({ projectId: open.id }));
    const b = await priv.agent.post(`/api/challenges/${c.id}/enter`).send(entry({ projectId: secret.id }));
    expect([a.status, b.status]).toEqual([201, 201]);
    const base = `/api/companies/${acme.id}/challenges/${c.id}`;
    await owner.agent.post(`${base}/close-entries`).expect(200);
    await owner.agent.post(`${base}/entries/${a.body.id}/status`).send({ status: "winner" }).expect(200);
    await owner.agent.post(`${base}/entries/${b.body.id}/status`).send({ status: "winner" }).expect(200);
    await owner.agent.post(`${base}/announce`).expect(200);

    const winners = (await stranger.agent.get(`/api/challenges/${c.id}`)).body.winners;
    const byEntry = new Map(winners.map((w: any) => [w.entryId, w]));
    expect((byEntry.get(a.body.id) as any).project).toEqual({ id: open.id, title: "Open Fit" });
    expect((byEntry.get(b.body.id) as any).project).toBeNull();
    expect(JSON.stringify(winners)).not.toContain("Stealth Fit");
  });
});

describe("entering", () => {
  it("needs the company's terms accepted, and once per person", async () => {
    const c = await newChallenge();
    const founder = await person(app);
    const url = `/api/challenges/${c.id}/enter`;
    expect((await founder.agent.post(url).send(entry({ acceptTerms: false }))).status).toBe(400);
    expect((await founder.agent.post(url).send(entry({ acceptTerms: undefined }))).status).toBe(400);
    expect((await founder.agent.post(url).send(entry({ link: "javascript:alert(1)" }))).status).toBe(400);
    const first = await founder.agent.post(url).send(entry({ link: "https://example.com/demo" }));
    expect(first.status, first.text).toBe(201);
    expect((await founder.agent.post(url).send(entry())).status).toBe(409);

    const edit = await founder.agent.patch(`/api/challenges/${c.id}/entry`).send({ title: "Fit first" });
    expect(edit.status).toBe(200);
    expect(edit.body.title).toBe("Fit first");

    const view = await founder.agent.get(`/api/challenges/${c.id}`);
    expect(view.body.myEntry.title).toBe("Fit first");
    expect(view.body.terms).toBe(brief.terms);

    // Withdrawing, then coming back, is allowed while it's open.
    expect((await founder.agent.delete(`/api/challenges/${c.id}/entry`)).body.status).toBe("withdrawn");
    expect((await founder.agent.post(url).send(entry())).status).toBe(201);
  });

  it("tells the company's admins, not its plain members", async () => {
    const c = await newChallenge();
    const founder = await person(app);
    const res = await founder.agent.post(`/api/challenges/${c.id}/enter`).send(entry());
    await new Promise((r) => setTimeout(r, 100));
    const target = `${acme.id}:${res.body.id}`;
    const rows = await db.select().from(notifications)
      .where(and(eq(notifications.kind, "challenge_entry"), eq(notifications.targetId, target)));
    expect(rows.map((r) => r.recipientId)).toEqual([owner.id]);
    expect(rows[0].excerpt).toBe(brief.title);
  });

  it("is closed to the sponsoring company's own people", async () => {
    const c = await newChallenge();
    expect((await member.agent.post(`/api/challenges/${c.id}/enter`).send(entry())).status).toBe(403);
    expect((await owner.agent.post(`/api/challenges/${c.id}/enter`).send(entry())).status).toBe(403);
  });

  it("is refused after the deadline, even while the challenge still says open", async () => {
    const c = await newChallenge();
    await db.update(companyChallenges).set({ deadline: new Date(Date.now() - 60_000) }).where(eq(companyChallenges.id, c.id));
    const founder = await person(app);
    const res = await founder.agent.post(`/api/challenges/${c.id}/enter`).send(entry());
    expect(res.status).toBe(409);
    const [row] = await db.select().from(companyChallenges).where(eq(companyChallenges.id, c.id));
    expect(row.status).toBe("open");
    expect((await founder.agent.get(`/api/challenges/${c.id}`)).body.acceptingEntries).toBe(false);
  });

  it("only with a project the entrant is part of", async () => {
    const c = await newChallenge();
    const founder = await person(app);
    const other = await person(app);
    const [theirs] = await db.insert(projects).values({ title: "Not mine", description: "Someone else's project.", category: "SaaS", ownerId: other.id } as any).returning();
    const [mine] = await db.insert(projects).values({ title: "Mine", description: "My own project.", category: "SaaS", ownerId: founder.id } as any).returning();
    expect((await founder.agent.post(`/api/challenges/${c.id}/enter`).send(entry({ projectId: theirs.id }))).status).toBe(403);
    const ok = await founder.agent.post(`/api/challenges/${c.id}/enter`).send(entry({ projectId: mine.id }));
    expect(ok.status).toBe(201);
    expect(ok.body.projectId).toBe(mine.id);
  });
});

describe("judging and announcing", () => {
  it("changes statuses only in judging, and tells each entrant their own result", async () => {
    const c = await newChallenge();
    const base = `/api/companies/${acme.id}/challenges/${c.id}`;
    const [a, b, d, gone] = [await person(app), await person(app), await person(app), await person(app)];
    const ids: Record<string, string> = {};
    for (const [name, p] of Object.entries({ a, b, d, gone })) {
      const r = await p.agent.post(`/api/challenges/${c.id}/enter`).send(entry());
      expect(r.status).toBe(201);
      ids[name] = r.body.id;
    }
    await gone.agent.delete(`/api/challenges/${c.id}/entry`);

    // Not while entries are still coming in.
    expect((await owner.agent.post(`${base}/entries/${ids.a}/status`).send({ status: "winner" })).status).toBe(409);
    expect((await owner.agent.post(`${base}/announce`)).status).toBe(409);

    expect((await owner.agent.post(`${base}/close-entries`)).body.status).toBe("judging");
    expect((await owner.agent.post(`${base}/close-entries`)).status).toBe(409);
    // A new entry now is refused.
    const late = await person(app);
    expect((await late.agent.post(`/api/challenges/${c.id}/enter`).send(entry())).status).toBe(409);

    const list = await member.agent.get(`${base}/entries`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(4);
    expect(list.body[0].entrantName).toBeTruthy();
    expect(list.body[0]).not.toHaveProperty("email");

    expect((await member.agent.post(`${base}/entries/${ids.a}/status`).send({ status: "winner" })).status).toBe(403);
    expect((await owner.agent.post(`${base}/entries/${ids.a}/status`).send({ status: "bogus" })).status).toBe(400);
    expect((await owner.agent.post(`${base}/entries/${ids.gone}/status`).send({ status: "winner" })).status).toBe(409);
    const won = await owner.agent.post(`${base}/entries/${ids.a}/status`).send({ status: "winner", feedback: "Clear and tested." });
    expect(won.status).toBe(200);
    expect(won.body.feedback).toBe("Clear and tested.");
    expect((await owner.agent.post(`${base}/entries/${ids.b}/status`).send({ status: "shortlisted" })).status).toBe(200);

    // Winners aren't public before the announcement.
    expect((await d.agent.get(`/api/challenges/${c.id}`)).body.winners).toEqual([]);

    const ann = await owner.agent.post(`${base}/announce`);
    expect(ann.status).toBe(200);
    expect(ann.body.status).toBe("closed");
    expect(ann.body.notified).toBe(3);
    expect((await owner.agent.post(`${base}/announce`)).status).toBe(409);
    expect((await owner.agent.post(`${base}/entries/${ids.b}/status`).send({ status: "winner" })).status).toBe(409);

    const results = await db.select().from(notifications).where(eq(notifications.kind, "challenge_result"));
    const forEntry = (id: string) => results.find((r) => r.targetId === `${c.id}:${id}`);
    expect(forEntry(ids.a)?.recipientId).toBe(a.id);
    expect(forEntry(ids.a)?.excerpt).toContain("You won");
    expect(forEntry(ids.a)?.excerpt).toContain(acme.name);
    expect(forEntry(ids.b)?.excerpt).toContain("shortlisted");
    expect(forEntry(ids.d)?.excerpt).toContain("Not picked");
    expect(forEntry(ids.gone)).toBeUndefined();

    const view = await d.agent.get(`/api/challenges/${c.id}`);
    expect(view.body.status).toBe("closed");
    expect(view.body.winners.map((w: any) => w.entryId)).toEqual([ids.a]);
    const aView = await a.agent.get(`/api/challenges/${c.id}`);
    expect(aView.body.myEntry.status).toBe("winner");
    expect(aView.body.myEntry.feedback).toBe("Clear and tested.");
  });
});

describe("browsing", () => {
  it("shows open challenges only under open, with counts and my own entries marked", async () => {
    const live = await newChallenge({ industry: "Fintech" });
    const expired = await newChallenge({ industry: "Fintech" });
    await db.update(companyChallenges).set({ deadline: new Date(Date.now() - 60_000) }).where(eq(companyChallenges.id, expired.id));
    const judged = await newChallenge({ industry: "Fintech" });
    await owner.agent.post(`/api/companies/${acme.id}/challenges/${judged.id}/close-entries`);
    const done = await newChallenge({ industry: "Fintech" });
    await owner.agent.post(`/api/companies/${acme.id}/challenges/${done.id}/close-entries`);
    await owner.agent.post(`/api/companies/${acme.id}/challenges/${done.id}/announce`);

    const founder = await person(app);
    await founder.agent.post(`/api/challenges/${live.id}/enter`).send(entry());

    const open = await founder.agent.get("/api/challenges?industry=Fintech&status=open");
    expect(open.status).toBe(200);
    const ids = open.body.map((c: any) => c.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(expired.id);
    expect(ids).not.toContain(judged.id);
    expect(ids).not.toContain(done.id);
    const card = open.body.find((c: any) => c.id === live.id);
    expect(card.entered).toBe(true);
    expect(card.entryCount).toBe(1);
    expect(card.company.name).toBe(acme.name);
    expect(card.prize).toBe(brief.prize);

    // Filtered by industry: a non-Fintech open challenge doesn't show.
    const other = await newChallenge({ industry: "Gaming" });
    expect((await founder.agent.get("/api/challenges?industry=Fintech")).body.map((c: any) => c.id)).not.toContain(other.id);

    const judging = (await founder.agent.get("/api/challenges?status=judging")).body.map((c: any) => c.id);
    expect(judging).toEqual(expect.arrayContaining([expired.id, judged.id]));
    const closed = (await founder.agent.get("/api/challenges?status=closed")).body.map((c: any) => c.id);
    expect(closed).toContain(done.id);

    const companyList = await owner.agent.get(`/api/companies/${acme.id}/challenges`);
    expect(companyList.body.find((c: any) => c.id === live.id).entryCount).toBe(1);
    // An entry row exists for the live one.
    const rows = await db.select().from(challengeEntries).where(eq(challengeEntries.challengeId, live.id));
    expect(rows).toHaveLength(1);
  });
});
