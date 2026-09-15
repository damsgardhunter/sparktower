/**
 * Applications to invest, end to end: the founder writes the ask and opens
 * applications; an investor applies from the public page; the founder reviews
 * it with the investor's contact; the investor can withdraw. And the lines:
 * no applying to your own project, no second open application, nothing on a
 * private or closed project, and only the founder reads the inbox.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { projects } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let address = 150;
async function person(app: any, name: string) {
  const agent = request.agent(app);
  const email = `inv-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${address++}`).send({ email, password: "Testpass123!", firstName: name });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string, email };
}
const application = {
  amount: "25k_100k", instrument: "profit_share", investorType: "angel", accredited: "yes",
  message: "I've backed two local service businesses and know this market well.", phone: "+1 (918) 555-0142",
  linkedinUrl: "https://www.linkedin.com/in/someone", consent: true,
};

describe("investment applications", () => {
  it("go from the public page to the founder's inbox, and back to the investor as a status", async () => {
    const app = await getTestApp();
    const [founder, investor, stranger] = [await person(app, "Founder"), await person(app, "Investor"), await person(app, "Stranger")];
    const project = (await founder.agent.post("/api/projects").send({
      title: "Brightside", description: "A commercial cleaning company growing across the city.", category: "services", goal: "raise_funding", subcategory: "other",
    })).body;
    const url = `/api/projects/${project.id}/investment`;

    // Closed by default; opening needs a headline.
    expect((await request(app).get(url)).body).toMatchObject({ open: false, isOwner: false });
    expect((await investor.agent.post(`${url}/applications`).send(application)).body.code).toBe("not_open");
    expect((await founder.agent.patch(url).send({ open: true })).body.field).toBe("headline");
    expect((await investor.agent.patch(url).send({ open: true, ask: { headline: "Mine now" } })).status).toBe(403);
    const opened = await founder.agent.patch(url).send({ open: true, ask: { headline: "Raising $250k to buy a second route", amount: "100k_250k", minimum: "10k_25k", instruments: ["profit_share", "nonsense"], useOfFunds: "Equipment and the first six months of payroll" } });
    expect(opened.status).toBe(200);
    expect(opened.body.ask.instruments).toEqual(["profit_share"]);

    const visible = (await investor.agent.get(url)).body;
    expect(visible).toMatchObject({ open: true, isOwner: false, mine: null, ask: { headline: "Raising $250k to buy a second route" } });
    expect(visible.disclaimer).toMatch(/nothing here is an offer or sale of securities/);

    // The application's lines.
    expect((await investor.agent.post(`${url}/applications`).send({ ...application, consent: false })).body.field).toBe("consent");
    expect((await investor.agent.post(`${url}/applications`).send({ ...application, message: "Hi" })).body.field).toBe("message");
    expect((await investor.agent.post(`${url}/applications`).send({ ...application, instrument: "tulips" })).body.field).toBe("instrument");
    expect((await investor.agent.post(`${url}/applications`).send({ ...application, linkedinUrl: "https://evil.example" })).body.field).toBe("linkedinUrl");
    expect((await founder.agent.post(`${url}/applications`).send(application)).status).toBe(400);
    expect((await request(app).post(`${url}/applications`).send(application)).status).toBe(401);

    const sent = await investor.agent.post(`${url}/applications`).send(application);
    expect(sent.status).toBe(201);
    expect((await investor.agent.post(`${url}/applications`).send(application)).body.code).toBe("already_applied");
    expect((await investor.agent.get(url)).body.mine).toMatchObject({ status: "new" });

    // The founder's inbox, with the contact the investor agreed to share. Nobody else's.
    expect((await stranger.agent.get(`${url}/applications`)).status).toBe(403);
    const inbox = (await founder.agent.get(`${url}/applications`)).body;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ status: "new", amount: "25k_100k", investor: { id: investor.id, name: "Investor", email: investor.email, phone: "+1 (918) 555-0142" } });

    // Reviewing: the founder marks and notes; nobody else can, and the investor can only withdraw.
    const appUrl = `/api/investment-applications/${inbox[0].id}`;
    expect((await stranger.agent.patch(appUrl).send({ status: "accepted" })).status).toBe(403);
    expect((await investor.agent.patch(appUrl).send({ status: "accepted" })).status).toBe(400);
    expect((await founder.agent.patch(appUrl).send({ status: "withdrawn" })).status).toBe(400);
    const accepted = await founder.agent.patch(appUrl).send({ status: "accepted", ownerNote: "Call Tuesday" });
    expect(accepted.body).toMatchObject({ status: "accepted", ownerNote: "Call Tuesday" });
    expect((await investor.agent.get(url)).body.mine.status).toBe("accepted");
    expect((await investor.agent.get(url)).body.ownerNote).toBeUndefined();

    // Withdrawn: the contact goes private again, and the founder can't reopen it.
    expect((await investor.agent.patch(appUrl).send({ status: "withdrawn" })).body.status).toBe("withdrawn");
    const after = (await founder.agent.get(`${url}/applications`)).body[0];
    expect(after.investor).toMatchObject({ email: null, phone: null });
    expect((await founder.agent.patch(appUrl).send({ status: "reviewing" })).body.code).toBe("withdrawn");
    // …and a withdrawn application doesn't block applying again.
    expect((await investor.agent.post(`${url}/applications`).send(application)).status).toBe(201);
  });

  it("aren't taken by a private project", async () => {
    const app = await getTestApp();
    const founder = await person(app, "Quiet");
    const project = (await founder.agent.post("/api/projects").send({
      title: "Quiet Co", description: "A private project that shouldn't be taking investment applications.", category: "services", goal: "raise_funding", subcategory: "other",
    })).body;
    // Private projects are a paid plan; set it directly rather than buy one.
    await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, project.id));
    const res = await founder.agent.patch(`/api/projects/${project.id}/investment`).send({ open: true, ask: { headline: "Raising" } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/private project/);
    expect((await request(app).get(`/api/projects/${project.id}/investment`)).status).toBe(404);
  });
});
