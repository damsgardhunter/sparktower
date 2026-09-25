/**
 * A season from a project, for somebody who has no company.
 *
 * The bug this closes: the Simulations tab told most people the truth and
 * left them nowhere to go — private seasons belong to a company, this project
 * belongs to a person, so set up a company account. A form about an
 * organisation that does not exist, standing between somebody and the thing
 * they came for.
 *
 * The model is not called here. What is under test is everything around it:
 * who may press the button, what gets created, and that pressing it twice
 * does not leave somebody with two companies.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { companies, companyMembers, projects, simSeasons, simVentures, users } from "@shared/schema";
import { startReadySeasons } from "../../server/simulation-tick";
import { advanceVenture } from "../../server/simulation-routes";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.122.${20 + (n++ % 200)}`;

async function person(app: any, first = "Builder") {
  n += 1;
  const agent = request.agent(app);
  const email = `proj-sim-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email, password: "a-good-passphrase-here", firstName: first });
  expect(res.status, res.text?.slice(0, 200)).toBe(201);
  await verifyEmail(app, email, ip());
  return { agent, id: res.body.id as string, email };
}

async function aProject(ownerId: string, over: Record<string, unknown> = {}) {
  const [project] = await db.insert(projects).values({
    ownerId,
    title: "Clinic Scheduler",
    description: "Scheduling and reminders for small veterinary practices, sold per clinic.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
    ...over,
  } as any).returning();
  return project;
}

describe("running a market from a project", () => {
  it("is refused to anyone but the project's owner", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const stranger = await person(app, "Stranger");
    const project = await aProject(owner.id);

    const res = await stranger.agent.post(`/api/projects/${project.id}/simulation`).send({});
    expect(res.status, "a stranger cannot stand up a company on somebody else's project").toBe(403);
    expect(res.body.code).toBe("not_yours");

    // And nothing was created on the way to refusing.
    const made = await db.select().from(companies).where(eq(companies.projectId, project.id));
    expect(made).toHaveLength(0);
  }, 120_000);

  it("tells somebody who is not signed in nothing at all", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Quiet");
    const project = await aProject(owner.id);
    expect((await request(app).post(`/api/projects/${project.id}/simulation`).send({})).status).toBe(401);
  }, 120_000);

  it("404s a project that does not exist", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const res = await me.agent.post("/api/projects/00000000-0000-4000-8000-000000000000/simulation").send({});
    expect(res.status).toBe(404);
  }, 120_000);

  it("reuses the company when the project already has one, rather than making a second", async () => {
    /*
     * The double-click case. Standing a company up is the whole point of the
     * button, and doing it twice would leave somebody owning two companies
     * with the same name and one project between them.
     */
    const app = await getTestApp();
    const owner = await person(app, "Twice");
    const project = await aProject(owner.id);

    const [existing] = await db.insert(companies).values({
      name: "Already Here", slug: `already-${Date.now()}`,
      projectId: project.id, createdBy: owner.id, createdAt: new Date(),
    } as any).returning();
    await db.insert(companyMembers).values({ companyId: existing.id, userId: owner.id, role: "owner", joinedAt: new Date() });

    /*
     * The route needs a model, which this suite has no key for, so it refuses
     * at the gate. What matters is which gate: not a 500, and no second
     * company either way.
     */
    const res = await owner.agent.post(`/api/projects/${project.id}/simulation`).send({});
    expect([201, 402, 429, 503], `unexpected ${res.status}: ${res.text?.slice(0, 200)}`).toContain(res.status);

    const all = await db.select().from(companies).where(eq(companies.projectId, project.id));
    expect(all, "still one company for this project").toHaveLength(1);
    expect(all[0].id).toBe(existing.id);
  }, 120_000);

  it("charges nothing when Nova is not configured", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Nokey");
    const project = await aProject(owner.id);

    const res = await owner.agent.post(`/api/projects/${project.id}/simulation`).send({});
    if (res.status === 503) {
      expect(res.body.code).toBe("nova_unavailable");
      // Refused before anything was built, so there is nothing to clean up.
      expect(await db.select().from(companies).where(eq(companies.projectId, project.id))).toHaveLength(0);
      expect(await db.select().from(simSeasons).where(eq(simSeasons.companyId, project.id))).toHaveLength(0);
    }
  }, 120_000);
});

/**
 * A market you paid to have written is yours, and the table is what is sold.
 *
 * Two rules that have to hold together, because each is what makes the other
 * fair. Replaying costs nothing — a written market cannot be regenerated, so
 * if it were charged for, the season somebody learned from would be stranded
 * the moment it ended and no two teams could ever be compared on the same
 * world. Bringing somebody else to it does cost, per seat, once.
 */
describe("playing a market again, and filling the table", () => {
  /** A season with a market of its own, written straight into the database. */
  async function seasonWithMarket(ownerId: string, projectId: string) {
    const [company] = await db.insert(companies).values({
      name: "Clinic Scheduler", slug: `cs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      projectId, createdBy: ownerId, createdAt: new Date(),
    } as any).returning();
    await db.insert(companyMembers).values({ companyId: company.id, userId: ownerId, role: "owner", joinedAt: new Date() });
    const market = {
      id: "vet_rota", name: "Vet rota software", premise: "Scheduling for clinics.",
      baseUnitCost: 20, innovationPace: 1,
      voice: { customer: "clinic", customers: "clinics", unit: "licence", per: "a month", capacity: "seats", place: "region", places: "regions", quality: "polish", brand: "name" },
      segments: [
        { id: "single", name: "Single-site", description: "One vet.", size: 9_000, growth: 0.04, priceSensitivity: 0.6, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.7, loyalty: 0.4, referencePrice: 90 },
        { id: "groups", name: "Groups", description: "Five sites.", size: 3_000, growth: 0.07, priceSensitivity: 0.4, qualityFocus: 0.7, brandFocus: 0.5, serviceFocus: 0.6, loyalty: 0.6, referencePrice: 220 },
      ],
      cities: [
        { id: "n", name: "North", weight: 0.4, entryCost: 14_000, note: "" },
        { id: "s", name: "South", weight: 0.35, entryCost: 16_000, note: "" },
        { id: "e", name: "East", weight: 0.25, entryCost: 11_000, note: "" },
      ],
      incumbents: [
        { id: "a", name: "Alpha", posture: "fortress", startingShare: 0.3, quality: 65, brand: 60, service: 55, priceIndex: 1.1, persona: { tagline: "", boss: "", character: "", known: "", knock: "Slow", voice: "" } },
        { id: "b", name: "Beta", posture: "coaster", startingShare: 0.2, quality: 50, brand: 45, service: 40, priceIndex: 0.9, persona: { tagline: "", boss: "", character: "", known: "", knock: "Dated", voice: "" } },
      ],
    };
    const [season] = await db.insert(simSeasons).values({
      nicheId: market.id, name: "Vet rota software — season one", status: "forming",
      totalYears: 4, companyId: company.id, inviteCode: `RP${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      createdAt: new Date(), scope: "home", botTeams: 0, origin: "nova", cadence: "quarterly",
      customMarket: market,
    } as any).returning();
    return { company, season, market };
  }

  it("replays the same market without asking Nova or charging for it", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const project = await aProject(owner.id);
    const { season, market } = await seasonWithMarket(owner.id, project.id);

    const before = (await owner.agent.get("/api/nova/wallet")).body.wallet.allowanceUsed;
    const res = await owner.agent.post(`/api/projects/${project.id}/simulation`)
      .send({ fromSeasonId: season.id, cadence: "monthly" });

    expect(res.status, res.text?.slice(0, 300)).toBe(201);
    expect(res.body.replayed, "said plainly, because it changes what it cost").toBe(true);
    /*
     * The point of a replay: the same world, provably. Not a market that
     * resembles the old one — the same rivals, in the same order.
     */
    expect(res.body.market.rivals.map((r: any) => r.name)).toEqual(market.incumbents.map((i) => i.name));
    expect(res.body.cadence, "the rhythm may change; the market may not").toBe("monthly");

    const after = (await owner.agent.get("/api/nova/wallet")).body.wallet.allowanceUsed;
    expect(after, "a replay is not a model call, so it is not an action either").toBe(before);
  }, 60_000);

  it("will not replay a market belonging to somebody else's project", async () => {
    const app = await getTestApp();
    const mine = await person(app, "Mine");
    const theirs = await person(app, "Theirs");
    const myProject = await aProject(mine.id);
    const theirProject = await aProject(theirs.id, { title: "Not yours" });
    const { season } = await seasonWithMarket(theirs.id, theirProject.id);

    const res = await mine.agent.post(`/api/projects/${myProject.id}/simulation`).send({ fromSeasonId: season.id });
    expect(res.status, "a season id is not a secret; the market behind it is").toBe(404);
    expect(res.body.code).toBe("no_such_season");
  }, 60_000);

  it("says there is nothing to replay when the season plays one of ours", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const project = await aProject(owner.id);
    const { company } = await seasonWithMarket(owner.id, project.id);
    const [plain] = await db.insert(simSeasons).values({
      nicheId: "dating_apps", name: "A catalogue season", status: "forming", totalYears: 4,
      companyId: company.id, inviteCode: `PL${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      createdAt: new Date(), scope: "home", botTeams: 0, origin: "catalogue",
    } as any).returning();

    const res = await owner.agent.post(`/api/projects/${project.id}/simulation`).send({ fromSeasonId: plain.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("nothing_to_replay");
  }, 60_000);

  it("lists each market once, however many times it has been played", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const project = await aProject(owner.id);
    const { season } = await seasonWithMarket(owner.id, project.id);
    await owner.agent.post(`/api/projects/${project.id}/simulation`).send({ fromSeasonId: season.id });
    await owner.agent.post(`/api/projects/${project.id}/simulation`).send({ fromSeasonId: season.id });

    const res = await owner.agent.get(`/api/projects/${project.id}/company`);
    expect(res.status).toBe(200);
    expect(res.body.replayable, "three seasons, one market").toHaveLength(1);
    expect(res.body.replayable[0].plays, "and the count is the fact about it").toBe(3);
  }, 60_000);

  it("gives the builder a seat, so what they made is theirs to play", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const project = await aProject(owner.id);
    const { season, company } = await seasonWithMarket(owner.id, project.id);

    await owner.agent.post(`/api/projects/${project.id}/simulation`).send({ fromSeasonId: season.id, cadence: "quarterly" });
    const [after] = await db.select().from(companies).where(eq(companies.id, company.id));
    expect(after.simQuarterlySeatsPaid, "one seat, for the person who built it").toBe(1);

    // And a second build does not quietly hand out a second.
    await owner.agent.post(`/api/projects/${project.id}/simulation`).send({ fromSeasonId: season.id, cadence: "quarterly" });
    const [again] = await db.select().from(companies).where(eq(companies.id, company.id));
    expect(again.simQuarterlySeatsPaid, "the table is what is sold, not the market").toBe(1);
  }, 60_000);

  /*
   * A solo project is one chair.
   *
   * `soloMode` existed and meant the opposite of this: it only changed the
   * wording on the panel, promising that "the seats fill themselves" — which
   * is to say that a founder rehearsing their own business was given four
   * executives they had not hired, at $140,000 each. A startup cannot carry
   * $700,000 of officers, so every season a solo founder played was a story
   * about a payroll they would never have.
   */
  it("gives a solo project one chair, and everyone else five", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const solo = await aProject(owner.id, { soloMode: true });
    const { season } = await seasonWithMarket(owner.id, solo.id);

    const made = await owner.agent.post(`/api/projects/${solo.id}/simulation`).send({ fromSeasonId: season.id });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const [built] = await db.select().from(simSeasons).where(eq(simSeasons.id, made.body.seasonId));
    expect(built.seatCount, "one founder, one chair").toBe(1);

    const team = await person(app, "Team");
    const shared = await aProject(team.id);
    const pair = await seasonWithMarket(team.id, shared.id);
    const five = await team.agent.post(`/api/projects/${shared.id}/simulation`).send({ fromSeasonId: pair.season.id });
    expect(five.status, JSON.stringify(five.body)).toBe(201);
    const [table] = await db.select().from(simSeasons).where(eq(simSeasons.id, five.body.seasonId));
    expect(table.seatCount, "a project with a team keeps the five desks").toBe(5);
  }, 60_000);

  /*
   * A solo season starts itself.
   *
   * `startReadySeasons` only ever looked at seasons with no company, because
   * a company's season is started by its organiser — who knows when the room
   * is full, which the clock does not. Every project season has a company, so
   * nothing in the product would start one: the founder took their chair,
   * watched the lobby say it was ready, opened the desk and sat on "Waiting
   * for year one" indefinitely. There is nobody for a table of one to wait
   * for, which is the whole of why it is safe to start it.
   */
  it("starts a solo season by itself, with the founder's own company name", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const solo = await aProject(owner.id, { soloMode: true });
    const { season, company } = await seasonWithMarket(owner.id, solo.id);

    const made = await owner.agent.post(`/api/projects/${solo.id}/simulation`).send({ fromSeasonId: season.id });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const seasonId = made.body.seasonId as string;

    // The founder takes their chair. One chair is the whole table, so the
    // room needs nothing else to be ready.
    const joined = await owner.agent.post("/api/sim/join-code").send({ code: made.body.inviteCode });
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    await advanceVenture(joined.body.ventureId);

    const [room] = await db.select().from(simVentures).where(eq(simVentures.id, joined.body.ventureId));
    expect(room.phase, "one chair, nothing to claim and nothing to name").toBe("running");
    expect(room.name, "their own company, not an invented one").toBe(company.name);

    expect(await startReadySeasons(), "nobody is coming, so nothing is waited for").toContain(seasonId);
    const [started] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(started.status).toBe("running");
  }, 60_000);

  /*
   * Nobody's chair is filled by Nova before they get there.
   *
   * The public market tops a room up to five a minute after the last person
   * arrives, which is right when somebody pressed play and is owed a game.
   * It is wrong for a season whose seats were bought for named people: a team
   * of four turns up to find three of them already being played.
   */
  it("never fills a project's season with bots", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const project = await aProject(owner.id);
    const { season } = await seasonWithMarket(owner.id, project.id);

    const made = await owner.agent.post(`/api/projects/${project.id}/simulation`).send({ fromSeasonId: season.id });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const [built] = await db.select().from(simSeasons).where(eq(simSeasons.id, made.body.seasonId));
    expect(built.botFill, "these seats were bought for people who are on their way").toBe(false);
  }, 60_000);
});

/**
 * A market built from a project is a priced outcome, and was not one.
 *
 * The route named an `action` and no `outcome`, and `requireCredits` only
 * takes money when there is an outcome — so the largest single piece of
 * writing Nova does came off the month's free allowance of small actions, the
 * same allowance a chat turn uses. The hold is settled only when a market was
 * actually written: a build that fell back to one of the seven, or replayed a
 * market this project already owns, calls no model and is not charged.
 */
describe("what a custom market costs", () => {
  it("asks for ten dollars, and says so when the balance is short", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const project = await aProject(owner.id);
    await db.update(users).set({ balanceCents: 0, devUnlimited: false }).where(eq(users.id, owner.id));

    const res = await owner.agent.post(`/api/projects/${project.id}/simulation`).send({});
    /*
     * 503 when this machine has no model configured — the route refuses before
     * it charges, which is correct and is tested above. Everywhere else it is
     * the price.
     */
    if (res.status === 503) {
      expect(res.body.code).toBe("nova_unavailable");
      return;
    }
    expect(res.status, JSON.stringify(res.body)).toBe(402);
    expect(res.body.price?.cents, "ten dollars").toBe(1_000);
    expect(res.body.outcome).toBe("customSeason");
  }, 60_000);

  /*
   * Replaying is covered where the replay lives — "replays the same market
   * without asking Nova or charging for it" — which already asserts that no
   * model is called and nothing is taken.
   */
});
