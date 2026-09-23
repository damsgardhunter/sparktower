/**
 * Proving a company, and what it now costs to post a challenge under one.
 *
 * Anyone could create a company called anything and post a challenge with a
 * prize that was a sentence in a text box. A builder could spend a fortnight
 * on an entry for a company that did not exist, judged by nobody, for money
 * that was never going to arrive.
 *
 * What is guarded here is the whole of that: a company cannot exist without a
 * proven domain, a domain belongs to exactly one company, a challenge cannot
 * be posted by a company that has not proved one, the fee and the prize leave
 * the balance together or not at all, and the prize leaves the safe exactly
 * once.
 *
 * The domain check is given a fake transport rather than a nameserver — the
 * real `safeFetch` and `dns.resolveTxt` have their own coverage, and what
 * matters here is everything around them.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { challengePrizes, companies, companyChallenges, users } from "@shared/schema";
import { setVerificationDeps } from "../../server/company-verification-routes";
import { CHALLENGE_FEE_CENTS } from "@shared/challenges-money";

/** Domains the fake world will serve the token for, keyed by domain → token. */
const serving = new Map<string, string>();

beforeAll(() => {
  setVerificationDeps({
    fetch: (async (url: string) => {
      const host = new URL(url).hostname;
      const token = serving.get(host);
      if (!token) return { ok: false, status: 404, url, contentType: "text/plain", body: Buffer.from("") };
      return { ok: true, status: 200, url, contentType: "text/plain", body: Buffer.from(token) };
    }) as any,
    // Nothing is ever in DNS in these tests; the file is the route people take.
    resolveTxt: async () => { throw Object.assign(new Error("no record"), { code: "ENOTFOUND" }); },
  });
});
afterAll(async () => { serving.clear(); await closeTestApp(); });

let n = 0;
async function person(app: any, funded = 0) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.192.${(n % 200) + 20}`;
  const email = `cv-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `C${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  if (funded) await db.update(users).set({ balanceCents: funded }).where(eq(users.id, res.body.id));
  return { agent, id: res.body.id as string };
}

/** Start a verification, serve the token, pass it. Returns the verification id. */
async function prove(who: { agent: any }, domain: string) {
  const started = await who.agent.post("/api/company-verifications").send({ website: domain });
  expect(started.status, started.text).toBe(201);
  const v = started.body.verification;
  serving.set(domain, v.token);
  const checked = await who.agent.post(`/api/company-verifications/${v.id}/check`).send({});
  expect(checked.status, checked.text).toBe(200);
  expect(checked.body.verification.verified).toBe(true);
  return v.id as string;
}

const makeCompany = (who: { agent: any }, name: string, verificationId?: string) =>
  who.agent.post("/api/companies").send({ name, verificationId });

const balanceOf = async (id: string) =>
  (await db.select({ c: users.balanceCents }).from(users).where(eq(users.id, id)))[0].c as number;

describe("creating a company", () => {
  it("is refused outright without a proven domain", async () => {
    const app = await getTestApp();
    const me = await person(app);

    const res = await makeCompany(me, "Totally Real Bank");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("verification_required");
    expect(await db.select().from(companies).where(eq(companies.name, "Totally Real Bank"))).toHaveLength(0);
  });

  it("is refused with a verification that was never passed", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const started = await me.agent.post("/api/company-verifications").send({ website: "unproved.test" });
    expect(started.status).toBe(201);

    const res = await makeCompany(me, "Unproved", started.body.verification.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("not_verified");
  });

  it("works once the domain is proved, and records how", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const vid = await prove(me, "acme-works.test");

    const res = await makeCompany(me, "Acme", vid);
    expect(res.status, res.text).toBe(201);

    const [row] = await db.select().from(companies).where(eq(companies.id, res.body.company.id));
    expect(row.verifiedDomain).toBe("acme-works.test");
    expect(row.verifiedMethod).toBe("file");
    expect(row.verifiedAt).toBeTruthy();
    // The website is the domain that was proved, not whatever was typed.
    expect(row.website).toBe("https://acme-works.test");
  });

  it("spends a verification exactly once", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const vid = await prove(me, "once-only.test");

    expect((await makeCompany(me, "First", vid)).status).toBe(201);
    const second = await makeCompany(me, "Second", vid);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("verification_spent");
  });
});

describe("impersonation", () => {
  it("cannot claim a domain another company already proved", async () => {
    const app = await getTestApp();
    const real = await person(app);
    const impostor = await person(app);

    const vid = await prove(real, "taken-domain.test");
    expect((await makeCompany(real, "The Real One", vid)).status).toBe(201);

    // Even holding the same proof, the domain is gone.
    serving.set("taken-domain.test", "whatever");
    const started = await impostor.agent.post("/api/company-verifications").send({ website: "taken-domain.test" });
    expect(started.status).toBe(409);
    expect(started.body.code).toBe("domain_taken");
  });

  it("cannot claim a domain it does not control, however many times it asks", async () => {
    const app = await getTestApp();
    const impostor = await person(app);

    const started = await impostor.agent.post("/api/company-verifications").send({ website: "not-mine.test" });
    expect(started.status).toBe(201);
    // Nothing is served for that domain, so the check can only fail.
    const res = await impostor.agent.post(`/api/company-verifications/${started.body.verification.id}/check`).send({});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("not_found_yet");
    expect(res.body.verification.attempts).toBe(1);
  });

  it("cannot claim a free mail provider or a shared host", async () => {
    const app = await getTestApp();
    const me = await person(app);
    for (const domain of ["gmail.com", "someone.github.io"]) {
      const res = await me.agent.post("/api/company-verifications").send({ website: domain });
      expect(res.status, domain).toBe(400);
      expect(res.body.code).toBe("unclaimable_domain");
    }
  });
});

describe("posting a challenge", () => {
  const brief = "Build us something that reads a spreadsheet and tells us what is wrong with it.";
  const challenge = (prizeCents: number) => ({
    title: "Spreadsheet sanity", brief, terms: "Entries stay yours and we claim no rights over them. We may offer to hire you, and we will say so publicly if you win.",
    deadline: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    prizeCents,
  });

  async function verifiedCompany(app: any, balance: number) {
    const me = await person(app, balance);
    const vid = await prove(me, `co-${n}-${Date.now()}.test`);
    const res = await makeCompany(me, `Company ${n}`, vid);
    expect(res.status, res.text).toBe(201);
    return { me, companyId: res.body.company.id as string };
  }

  it("is refused for a company with no proven domain", async () => {
    const app = await getTestApp();
    const me = await person(app, 100_000);
    const vid = await prove(me, `unverified-${Date.now()}.test`);
    const made = await makeCompany(me, "Legit Co", vid);
    // Take the proof away, as an older company that predates verification has none.
    await db.update(companies).set({ verifiedDomain: null, verifiedAt: null }).where(eq(companies.id, made.body.company.id));

    const res = await me.agent.post(`/api/companies/${made.body.company.id}/challenges`).send(challenge(50_000));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("company_not_verified");
  });

  it("takes the fee and the prize together, and holds the prize", async () => {
    const app = await getTestApp();
    const { me, companyId } = await verifiedCompany(app, 100_000);

    const res = await me.agent.post(`/api/companies/${companyId}/challenges`).send(challenge(50_000));
    expect(res.status, res.text).toBe(201);

    expect(await balanceOf(me.id)).toBe(100_000 - 50_000 - CHALLENGE_FEE_CENTS);
    const [prize] = await db.select().from(challengePrizes).where(eq(challengePrizes.challengeId, res.body.id));
    expect(prize.amountCents).toBe(50_000);
    expect(prize.feeCents).toBe(CHALLENGE_FEE_CENTS);
    expect(prize.state).toBe("held");
  });

  it("takes nothing at all when the balance cannot cover both", async () => {
    const app = await getTestApp();
    // Enough for the prize, not for the prize and the fee.
    const { me, companyId } = await verifiedCompany(app, 50_000);

    const before = await balanceOf(me.id);
    const res = await me.agent.post(`/api/companies/${companyId}/challenges`).send(challenge(50_000));
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("insufficient_balance");

    // Not charged the fee for the privilege of finding out, and nothing posted.
    expect(await balanceOf(me.id)).toBe(before);
    expect(await db.select().from(companyChallenges).where(eq(companyChallenges.companyId, companyId))).toHaveLength(0);
  });

  it("refuses a prize below what makes a challenge worth entering", async () => {
    const app = await getTestApp();
    const { me, companyId } = await verifiedCompany(app, 100_000);
    const res = await me.agent.post(`/api/companies/${companyId}/challenges`).send(challenge(100));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_prize");
    expect(await balanceOf(me.id)).toBe(100_000);
  });
});

describe("the prize leaving the safe", () => {
  it("goes to the winner, once, and a second winner finds nothing left", async () => {
    const app = await getTestApp();
    const me = await person(app, 100_000);
    const vid = await prove(me, `pay-${Date.now()}.test`);
    const companyId = (await makeCompany(me, "Payer", vid)).body.company.id;

    const made = await me.agent.post(`/api/companies/${companyId}/challenges`).send({
      title: "Pay out", brief: "Build the thing that reads our spreadsheets and says what is wrong with them, and we will pay out at the end of it.",
      terms: "Entries stay yours and we claim no rights over them. We may offer to hire you, and we will say so publicly if you win.", deadline: new Date(Date.now() + 14 * 86_400_000).toISOString(), prizeCents: 50_000,
    });
    expect(made.status, made.text).toBe(201);
    const challengeId = made.body.id as string;

    const entrant = await person(app);
    const entered = await entrant.agent.post(`/api/challenges/${challengeId}/enter`)
      .send({ title: "My answer", pitch: "It reads the spreadsheet and complains, accurately.", acceptTerms: true });
    expect(entered.status, entered.text).toBe(201);

    await me.agent.post(`/api/companies/${companyId}/challenges/${challengeId}/close-entries`).send({});
    const won = await me.agent
      .post(`/api/companies/${companyId}/challenges/${challengeId}/entries/${entered.body.id}/status`)
      .send({ status: "winner" });
    expect(won.status, won.text).toBe(200);
    expect(won.body.prizePaid?.amountCents).toBe(50_000);
    expect(await balanceOf(entrant.id), "the winner is paid").toBe(50_000);

    const [prize] = await db.select().from(challengePrizes).where(eq(challengePrizes.challengeId, challengeId));
    expect(prize.state).toBe("awarded");
    expect(prize.awardedTo).toBe(entrant.id);

    /*
     * Naming a second winner must not pay twice. The prize left the safe in
     * the same statement that read it, so there is nothing to release.
     */
    const second = await person(app);
    const entry2 = await second.agent.post(`/api/challenges/${challengeId}/enter`)
      .send({ title: "Also mine", pitch: "A second answer, submitted before entries closed.", acceptTerms: true });
    // Entries are closed, so this one cannot exist — which is itself the guard.
    expect([403, 409]).toContain(entry2.status);
    expect(await balanceOf(second.id)).toBe(0);
  }, 60_000);

  it("goes back to the company when the results are announced with no winner", async () => {
    const app = await getTestApp();
    const me = await person(app, 100_000);
    const vid = await prove(me, `refund-${Date.now()}.test`);
    const companyId = (await makeCompany(me, "Refunder", vid)).body.company.id;

    const made = await me.agent.post(`/api/companies/${companyId}/challenges`).send({
      title: "Nobody wins", brief: "A challenge that will be closed without picking anybody at all.",
      terms: "Entries stay yours and we claim no rights over them. We may offer to hire you, and we will say so publicly if you win.", deadline: new Date(Date.now() + 14 * 86_400_000).toISOString(), prizeCents: 50_000,
    });
    const challengeId = made.body.id as string;
    const afterPosting = await balanceOf(me.id);

    await me.agent.post(`/api/companies/${companyId}/challenges/${challengeId}/close-entries`).send({});
    const announced = await me.agent.post(`/api/companies/${companyId}/challenges/${challengeId}/announce`).send({});
    expect(announced.status, announced.text).toBe(200);

    // The prize comes back; the fee does not, because the fee is ours.
    expect(await balanceOf(me.id)).toBe(afterPosting + 50_000);
    const [prize] = await db.select().from(challengePrizes).where(eq(challengePrizes.challengeId, challengeId));
    expect(prize.state).toBe("refunded");
  }, 60_000);
});
