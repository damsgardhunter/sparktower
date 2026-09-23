/**
 * Recruiting from track records, against a real database.
 *
 * The boundary under test is consent. A person who has not opened their
 * profile must be invisible to every company read — absent from search, 404
 * on their page, impossible to invite — and a company's private training
 * season must never show up in anybody's public record. Then the invitation
 * itself: once per company per person, it reaches the person, and a yes
 * reaches the sender and opens a conversation.
 *
 * Companies are inserted directly: their own routes belong to another file.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import {
  companies, companyMembers, notifications, recruitInvites, directMessages,
  simSeasons, simVentures, simSeats, simDecisions, simReports, simChallenges,
  startupGames, startupGameVerdicts,
} from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

/* A range no other spec uses: registering counts against a per-address budget. */
let n = 0;
async function person(app: any, first: string) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.190.${(n % 200) + 20}`;
  const email = `talent-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: first });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

async function company(name: string, owner: string, members: { id: string; role: "admin" | "member" }[] = []) {
  const [c] = await db.insert(companies).values({
    name, slug: `${name.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`, createdBy: owner, createdAt: new Date(),
  }).returning();
  await db.insert(companyMembers).values([
    { companyId: c.id, userId: owner, role: "owner", joinedAt: new Date() },
    ...members.map((m) => ({ companyId: c.id, userId: m.id, role: m.role, joinedAt: new Date() })),
  ]);
  return c;
}

/**
 * A season this person played as `role`, written straight into the tables the
 * record reads: `years` resolved years, filing `filed` of them, finishing
 * `rank` in a field of `field`.
 */
async function season(userId: string, opts: { role: string; years: number; filed: number; rank: number; field: number; companyId?: string; status?: "finished" | "running"; met?: number }) {
  const [s] = await db.insert(simSeasons).values({
    nicheId: "podcasts", name: opts.companyId ? "Private away day" : "Public spring", status: opts.status ?? "finished",
    year: opts.years + 1, totalYears: opts.years, companyId: opts.companyId ?? null,
  }).returning();
  const [v] = await db.insert(simVentures).values({ seasonId: s.id, name: "Northbound", phase: "running" }).returning();
  await db.insert(simSeats).values({ ventureId: v.id, userId, role: opts.role });
  for (let y = 1; y <= opts.years; y++) {
    // The whole field reports each year, so field size is counted rather than assumed.
    for (let i = 0; i < opts.field; i++) {
      const mine = i === 0;
      await db.insert(simReports).values({
        seasonId: s.id, ventureId: mine ? v.id : null, companyId: mine ? v.id : `incumbent-${i}`, year: y,
        report: { rank: mine ? opts.rank : i + (i >= opts.rank ? 1 : 0), marketShare: 0.1 },
      });
    }
    if (y <= opts.filed) await db.insert(simDecisions).values({ ventureId: v.id, userId, role: opts.role, year: y, payload: {} });
    await db.insert(simChallenges).values({
      ventureId: v.id, userId, role: opts.role, year: y, challenge: {}, outcome: y <= (opts.met ?? 0) ? "met" : "missed",
    });
  }
  return s;
}

describe("the person's side", () => {
  it("starts closed, shows my own record as the preview, and leaves private training out of it", async () => {
    const app = await getTestApp();
    const me = await person(app, "Priya");
    const boss = await person(app, "Boss");
    const employer = await company("Acme", boss.id);

    await season(me.id, { role: "cfo", years: 4, filed: 4, rank: 2, field: 6, met: 3 });
    await season(me.id, { role: "ceo", years: 5, filed: 1, rank: 1, field: 6, companyId: employer.id });
    const [game] = await db.insert(startupGames).values({ player1Id: me.id, player2Id: boss.id, round: "verdict" }).returning();
    await db.insert(startupGameVerdicts).values({ gameId: game.id, growth: 1, capital: 1, product: 1, acquisition: 1, risk: 1, overall: 740, tenYear: 1, peak: 1, peakYear: 1, summary: "x" });
    const [fallback] = await db.insert(startupGames).values({ player1Id: me.id, player2Id: boss.id, round: "verdict" }).returning();
    await db.insert(startupGameVerdicts).values({ gameId: fallback.id, growth: 1, capital: 1, product: 1, acquisition: 1, risk: 1, overall: 100, tenYear: 1, peak: 1, peakYear: 1, summary: "x", fromModel: false });

    const mine = (await me.agent.get("/api/talent/me").expect(200)).body;
    expect(mine.profile).toMatchObject({ open: false, roles: [], remote: true });
    // The private season is nowhere: one season, as CFO, four of four filed, second of six.
    expect(mine.record).toMatchObject({
      seasonsPlayed: 1, yearsPlayed: 4, yearsFiled: 4, turnout: 1,
      seats: [{ role: "cfo", count: 1 }],
      bestFinish: { rank: 2, of: 6, role: "cfo" },
      objectives: { met: 3, missed: 1, total: 4 },
      // Only the model's verdict counts, not the fallback.
      startupGames: { scored: 1, average: 740, best: 740 },
    });
    expect(mine.record.seasons.map((s: any) => s.seasonName)).toEqual(["Public spring"]);
    expect(mine.record.strengths).toEqual(expect.arrayContaining(["Files every year (4 of 4)", "Finished top 3 once as Chief Financial Officer"]));

    const saved = await me.agent.put("/api/talent/me").send({ open: true, headline: "  Finance lead who likes a hard market ", roles: ["Finance", "finance", "Operations"], location: "Leeds", remote: false }).expect(200);
    expect(saved.body.profile).toMatchObject({ open: true, headline: "Finance lead who likes a hard market", roles: ["finance", "operations"], location: "Leeds", remote: false });
    // Changing one thing leaves the rest.
    const again = await me.agent.put("/api/talent/me").send({ open: false }).expect(200);
    expect(again.body.profile).toMatchObject({ open: false, headline: "Finance lead who likes a hard market", location: "Leeds" });
    expect((await me.agent.put("/api/talent/me").send({ open: "yes" })).status).toBe(400);
  });
});

describe("the company's side", () => {
  it("finds only open people, invites once, and a yes reaches the sender with a conversation", async () => {
    const app = await getTestApp();
    const open = await person(app, "Olu");
    const closed = await person(app, "Cass");
    const owner = await person(app, "Owen");
    const member = await person(app, "Mina");
    const stranger = await person(app, "Stan");
    const acme = await company("Acme", owner.id, [{ id: member.id, role: "member" }]);

    await season(open.id, { role: "cfo", years: 3, filed: 3, rank: 1, field: 5 });
    await season(closed.id, { role: "ceo", years: 3, filed: 3, rank: 1, field: 5 });
    await open.agent.put("/api/talent/me").send({ open: true, headline: "Numbers person", roles: ["finance"] }).expect(200);
    // Closed: filled in, but never opened.
    await closed.agent.put("/api/talent/me").send({ headline: "Should never be seen", roles: ["finance"] }).expect(200);

    // Search: members can read it; only the open person is there.
    const found = (await member.agent.get(`/api/companies/${acme.id}/talent`).expect(200)).body.candidates;
    expect(found.map((c: any) => c.userId)).toEqual([open.id]);
    expect(found[0]).toMatchObject({ name: "Olu", headline: "Numbers person", roles: ["finance"], invite: null, record: { seasonsPlayed: 1, bestFinish: { rank: 1, of: 5 } } });
    expect(found[0].record).not.toHaveProperty("seasons");
    expect((await member.agent.get(`/api/companies/${acme.id}/talent?minSeasons=2`)).body.candidates).toEqual([]);
    expect((await member.agent.get(`/api/companies/${acme.id}/talent?role=marketing`)).body.candidates).toEqual([]);
    expect((await member.agent.get(`/api/companies/${acme.id}/talent?q=numbers`)).body.candidates).toHaveLength(1);

    // Detail: the open person whole, the closed one indistinguishable from nobody.
    const detail = (await member.agent.get(`/api/companies/${acme.id}/talent/${open.id}`).expect(200)).body;
    expect(detail.record.seasons).toHaveLength(1);
    expect((await member.agent.get(`/api/companies/${acme.id}/talent/${closed.id}`)).status).toBe(404);
    expect((await member.agent.get(`/api/companies/${acme.id}/talent/no-such-user`)).status).toBe(404);

    // A stranger learns nothing about the company; a member may look but not approach.
    expect((await stranger.agent.get(`/api/companies/${acme.id}/talent`)).status).toBe(404);
    expect((await stranger.agent.post(`/api/companies/${acme.id}/talent/${open.id}/invite`).send({ message: "We would love to talk to you about finance." })).status).toBe(404);
    expect((await member.agent.post(`/api/companies/${acme.id}/talent/${open.id}/invite`).send({ message: "We would love to talk to you about finance." })).status).toBe(403);

    // The closed person can't be invited either, and the message has to say something.
    expect((await owner.agent.post(`/api/companies/${acme.id}/talent/${closed.id}/invite`).send({ message: "We would love to talk to you about finance." })).status).toBe(404);
    expect((await owner.agent.post(`/api/companies/${acme.id}/talent/${open.id}/invite`).send({ message: "Hi" })).status).toBe(400);

    const sent = await owner.agent.post(`/api/companies/${acme.id}/talent/${open.id}/invite`)
      .send({ role: "Head of finance", message: "We'd like to talk about running our finance team.\nWe saw your season as CFO." });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    const inviteId = sent.body.invite.id;
    const again = await owner.agent.post(`/api/companies/${acme.id}/talent/${open.id}/invite`).send({ message: "Asking a second time, just in case you missed it." });
    expect(again.status).toBe(409);

    const [told] = await db.select().from(notifications).where(and(eq(notifications.recipientId, open.id), eq(notifications.kind, "recruit_invite")));
    expect(told).toMatchObject({ actorId: owner.id, targetId: `${acme.id}:${inviteId}`, excerpt: "Acme: We'd like to talk about running our finance team." });

    expect((await member.agent.get(`/api/companies/${acme.id}/talent`)).body.candidates[0].invite).toBe("sent");
    const list = (await member.agent.get(`/api/companies/${acme.id}/talent-invites`).expect(200)).body.invites;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ userId: open.id, name: "Olu", role: "Head of finance", status: "sent", sentBy: { id: owner.id, name: "Owen" } });

    // The person sees it, and nobody else can answer it.
    const inbox = (await open.agent.get("/api/talent/invites").expect(200)).body.invites;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ id: inviteId, status: "sent", company: { id: acme.id, name: "Acme" } });
    expect((await closed.agent.post(`/api/talent/invites/${inviteId}/answer`).send({ accept: true })).status).toBe(404);

    const yes = await open.agent.post(`/api/talent/invites/${inviteId}/answer`).send({ accept: true });
    expect(yes.status, JSON.stringify(yes.body)).toBe(200);
    expect(yes.body).toMatchObject({ invite: { status: "accepted" }, conversationWith: owner.id });
    expect((await open.agent.post(`/api/talent/invites/${inviteId}/answer`).send({ accept: false })).status).toBe(409);

    const [answer] = await db.select().from(notifications).where(and(eq(notifications.recipientId, owner.id), eq(notifications.kind, "recruit_answer")));
    expect(answer).toMatchObject({ actorId: open.id, targetId: `${acme.id}:${inviteId}` });

    // The conversation is open, with the company's message as its first line.
    const [dm] = await db.select().from(directMessages).where(and(eq(directMessages.senderId, owner.id), eq(directMessages.receiverId, open.id)));
    expect(dm.content).toMatch(/^Acme: We'd like to talk/);
    expect((await open.agent.get(`/api/messages/${owner.id}`)).status).toBe(200);
    expect((await open.agent.post(`/api/messages/${owner.id}`).send({ content: "Happy to talk." })).status).toBe(200);
  });

  it("a no is recorded but tells nobody, and closing the profile hides the person again", async () => {
    const app = await getTestApp();
    const cand = await person(app, "Dee");
    const owner = await person(app, "Ola");
    const acme = await company("Beta", owner.id);
    await cand.agent.put("/api/talent/me").send({ open: true }).expect(200);
    const sent = await owner.agent.post(`/api/companies/${acme.id}/talent/${cand.id}/invite`).send({ message: "Would you like to talk about a role with us?" }).expect(201);

    await cand.agent.post(`/api/talent/invites/${sent.body.invite.id}/answer`).send({ accept: false }).expect(200);
    const [row] = await db.select().from(recruitInvites).where(eq(recruitInvites.id, sent.body.invite.id));
    expect(row.status).toBe("declined");
    expect(await db.select().from(notifications).where(eq(notifications.kind, "recruit_answer"))).toHaveLength(0);

    await cand.agent.put("/api/talent/me").send({ open: false }).expect(200);
    expect((await owner.agent.get(`/api/companies/${acme.id}/talent`)).body.candidates).toEqual([]);
    expect((await owner.agent.get(`/api/companies/${acme.id}/talent/${cand.id}`)).status).toBe(404);
  });
});
