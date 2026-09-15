/**
 * The AI visuals on a project page: who can draw them, what they need first,
 * and that a patch can't smuggle image paths onto someone's page.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

let address = 60;
async function signUp(app: any, name: string) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.113.${address++}`)
    .send({ email: `pv-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: name });
  return agent;
}

describe("project page visuals", () => {
  it("are the owner's to draw, upload, hide and clear, need a logo to draw, and can't be patched in", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Owner");
    const stranger = await signUp(app, "Stranger");
    const project = (await owner.post("/api/projects").send({
      title: "Visual Project", description: "A project that wants some pictures on its page.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;

    const before = (await owner.get("/api/subscription")).body;

    expect((await stranger.post(`/api/projects/${project.id}/visuals`).send({})).status).toBe(403);
    expect((await stranger.delete(`/api/projects/${project.id}/visuals`)).status).toBe(403);

    // No logo: refused before any credit check or model call.
    const noLogo = await owner.post(`/api/projects/${project.id}/visuals`).send({});
    expect(noLogo.status).toBe(400);
    expect(noLogo.body.code).toBe("logo_required");
    const after = (await owner.get("/api/subscription")).body;
    if (before?.creditsUsed != null) expect(after.creditsUsed).toBe(before.creditsUsed);

    // A plain project patch ignores the field — only generation writes it.
    await owner.patch(`/api/projects/${project.id}`).send({ profileVisuals: { oneLiner: "https://evil.example/x.png" } });
    const fetched = (await owner.get(`/api/projects/${project.id}`)).body;
    expect(fetched.profileVisuals?.oneLiner).toBeUndefined();

    // Redo one slot: the slot is checked, and with no logo it's refused the same way.
    expect((await owner.post(`/api/projects/${project.id}/visuals`).send({ slot: "nope" })).status).toBe(400);
    expect((await owner.post(`/api/projects/${project.id}/visuals`).send({ slot: "about" })).body.code).toBe("logo_required");

    // The owner's own image: uploads only, never an outside link, and never someone else's page.
    const own = "/objects/uploads/0b1d2c3e-own-image";
    expect((await owner.put(`/api/projects/${project.id}/visuals/about`).send({ imageUrl: "https://evil.example/x.png" })).body.code).toBe("upload_required");
    expect((await stranger.put(`/api/projects/${project.id}/visuals/about`).send({ imageUrl: own })).status).toBe(403);
    const put = await owner.put(`/api/projects/${project.id}/visuals/about`).send({ imageUrl: own });
    expect(put.status).toBe(200);
    expect(put.body.visuals.about).toBe(own);

    // Hiding keeps the image; the public page drops it; replacing it shows it again.
    expect((await stranger.patch(`/api/projects/${project.id}/visuals/about`).send({ hidden: true })).status).toBe(403);
    const hide = await owner.patch(`/api/projects/${project.id}/visuals/about`).send({ hidden: true });
    expect(hide.body.visuals).toMatchObject({ about: own, hidden: ["about"] });
    const again = await owner.patch(`/api/projects/${project.id}/visuals/about`).send({ hidden: true });
    expect(again.body.visuals.hidden).toEqual(["about"]);
    const reput = await owner.put(`/api/projects/${project.id}/visuals/about`).send({ imageUrl: own });
    expect(reput.body.visuals.hidden).toEqual([]);

    const cleared = await owner.delete(`/api/projects/${project.id}/visuals`);
    expect(cleared.status).toBe(200);
    expect(cleared.body.visuals).toEqual({});
  });
});
