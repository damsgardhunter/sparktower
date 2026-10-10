/**
 * A project's brand kit, end to end: saved over several sittings, refused when
 * a value is present and wrong, warned about when two values fight each other,
 * and invisible to anyone not on the team.
 *
 * Worth an integration test rather than a unit one because the thing that was
 * broken was never the validator. `validateBrandKit` worked and nothing could
 * reach it, so the first adverts this product made had no brand in them. What
 * these assert is that a brand kit can exist for a real project.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { BRAND_FALLBACK } from "@shared/ad-brand";

afterAll(async () => { await closeTestApp(); });

let address = 60;
async function signUp(app: any, name: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.115.${address++}`)
    .send({ email: `brand-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: name });
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBeLessThan(300);
  await verifyEmail(app, res.body.email, `203.0.116.${address++}`);
  return agent;
}

const newProject = async (agent: any, title: string) => (await agent.post("/api/projects").send({
  title, description: "A small-batch coffee roaster that delivers the week it roasts.",
  category: "saas", goal: "ship_mvp", subcategory: "saas",
})).body;

describe("a project's advert brand kit", () => {
  it("starts empty, resolves to the fallbacks, and fills in over several saves", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Owner");
    const project = await newProject(owner, "Ember Roast");

    const empty = await owner.get(`/api/projects/${project.id}/ad-brand`);
    expect(empty.status).toBe(200);
    expect(empty.body.kit, "no kit yet — not an empty object pretending to be one").toBeNull();
    /*
     * The fallbacks come from the server, so a screen never guesses the colour
     * the compositor is actually going to draw.
     */
    expect(empty.body.resolved.primaryColor).toBe(BRAND_FALLBACK.primaryColor);
    expect(empty.body.suggestedDisplayName, "better than an empty field").toBe("Ember Roast");
    expect(empty.body.voices.length, "the list comes from the server, so no screen hardcodes a renamed voice").toBeGreaterThan(0);

    // Colours this sitting.
    const first = await owner.put(`/api/projects/${project.id}/ad-brand`)
      .send({ primaryColor: "#1a2b3c", backgroundColor: "#FFFFFF" });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.kit.primaryColor, "normalised, so two spellings of one colour are one colour").toBe("#1A2B3C");
    const before = first.body.completeness.done;

    // The words next sitting, sent with the colours, because a PUT replaces.
    const second = await owner.put(`/api/projects/${project.id}/ad-brand`)
      .send({ primaryColor: "#1A2B3C", backgroundColor: "#FFFFFF", displayName: "Ember Roast", voice: "warm", callToAction: "Order at ember.test" });
    expect(second.status).toBe(200);
    expect(second.body.kit.primaryColor).toBe("#1A2B3C");
    expect(second.body.completeness.done).toBeGreaterThan(before);

    // Saving twice makes one kit, not two.
    const read = await owner.get(`/api/projects/${project.id}/ad-brand`);
    expect(read.body.kit.callToAction).toBe("Order at ember.test");
    expect(read.body.kit.voice).toBe("warm");
  });

  it("replaces the whole kit, the same way for every field", async () => {
    /*
     * This is the bug the first version of these routes had. The validator
     * returns the fields it was given, plus the free-text ones which it nulls
     * when absent — so omitting displayName cleared the name while omitting
     * primaryColor left the colour alone. One request, two behaviours, and the
     * only difference between the two fields is which branch of the validator
     * they go down. A client cannot predict that.
     */
    const app = await getTestApp();
    const owner = await signUp(app, "Replace");
    const project = await newProject(owner, "Whole Kit");

    await owner.put(`/api/projects/${project.id}/ad-brand`).send({
      primaryColor: "#1A2B3C", accentColor: "#FF8800", displayName: "Ember Roast",
      voice: "warm", callToAction: "Order at ember.test", avoidWords: ["cheap"],
    });

    // One field sent. Everything else was left out, so everything else is cleared.
    const after = await owner.put(`/api/projects/${project.id}/ad-brand`).send({ displayName: "Ember" });
    expect(after.status).toBe(200);
    expect(after.body.kit.displayName).toBe("Ember");
    for (const field of ["primaryColor", "accentColor", "voice", "callToAction", "avoidWords"]) {
      expect(after.body.kit[field], `${field} survived a replace`).toBeNull();
    }
  });

  it("refuses a value that is present and wrong, and names the field", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Picky");
    const project = await newProject(owner, "Bad Values");

    const colour = await owner.put(`/api/projects/${project.id}/ad-brand`).send({ primaryColor: "#abc" });
    expect(colour.status, "three-digit hex would be drawn as something else entirely").toBe(400);
    expect(colour.body.field, "so the form can put the message under the right input").toBe("primaryColor");

    expect((await owner.put(`/api/projects/${project.id}/ad-brand`).send({ voice: "sarcastic" })).body.field).toBe("voice");
    expect((await owner.put(`/api/projects/${project.id}/ad-brand`).send({ websiteUrl: "http://ember.test" })).body.field).toBe("websiteUrl");
    /* A logo the renderer would fetch from an address a user chose. */
    expect((await owner.put(`/api/projects/${project.id}/ad-brand`).send({ logoPath: "https://evil.test/logo.png" })).body.field).toBe("logoPath");

    // None of those wrote anything.
    expect((await owner.get(`/api/projects/${project.id}/ad-brand`)).body.kit).toBeNull();
  });

  it("warns about colours that will not show up, without refusing them", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Pale");
    const project = await newProject(owner, "Low Contrast");

    const res = await owner.put(`/api/projects/${project.id}/ad-brand`)
      .send({ primaryColor: "#FAFAFA", backgroundColor: "#FFFFFF", accentColor: "#FAFAFA" });

    expect(res.status, "their colours are their own — a refusal here is a form that rejects a real brand").toBe(200);
    const fields = res.body.warnings.map((w: any) => w.field);
    expect(fields).toContain("primaryColor");
    expect(fields, "an accent equal to the primary is the primary twice").toContain("accentColor");

    // And the warning is still there on a later read, not just on the save.
    expect((await owner.get(`/api/projects/${project.id}/ad-brand`)).body.warnings.length).toBeGreaterThan(0);
  });

  it("is invisible to someone not on the team, and says 404 rather than 403", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Mine");
    const stranger = await signUp(app, "Theirs");
    const project = await newProject(owner, "Private Brand");
    await owner.put(`/api/projects/${project.id}/ad-brand`).send({ primaryColor: "#1A2B3C" });

    const read = await stranger.get(`/api/projects/${project.id}/ad-brand`);
    expect(read.status, "a 403 would confirm the project exists to somebody guessing ids").toBe(404);
    expect(JSON.stringify(read.body), "and leaks nothing of the kit").not.toContain("1A2B3C");

    const write = await stranger.put(`/api/projects/${project.id}/ad-brand`).send({ primaryColor: "#FF0000" });
    expect(write.status).toBe(404);
    expect((await owner.get(`/api/projects/${project.id}/ad-brand`)).body.kit.primaryColor).toBe("#1A2B3C");
  });

  it("will not read a logo from anywhere but our own uploads", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Palette");
    const project = await newProject(owner, "Logo Reader");

    const nothing = await owner.post(`/api/projects/${project.id}/ad-brand/palette`).send({});
    expect(nothing.status, "no logo saved and none supplied").toBe(400);
    expect(nothing.body.field).toBe("logoPath");

    /*
     * The path is opened by this server. A request that can name the file is a
     * request that can ask the server to read something that is not a logo.
     */
    for (const path of ["https://evil.test/logo.png", "/etc/passwd", "../../etc/passwd", "file:///etc/passwd"]) {
      const res = await owner.post(`/api/projects/${project.id}/ad-brand/palette`).send({ logoPath: path });
      expect(res.status, `accepted ${path}`).toBe(400);
    }
  });

  it("needs an account at all", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Signed");
    const project = await newProject(owner, "Anon Check");
    expect((await request(app).get(`/api/projects/${project.id}/ad-brand`)).status).toBe(401);
    expect((await request(app).put(`/api/projects/${project.id}/ad-brand`).send({ primaryColor: "#1A2B3C" })).status).toBe(401);
  });
});
