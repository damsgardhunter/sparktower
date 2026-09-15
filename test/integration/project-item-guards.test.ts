/**
 * Decisions, files and links are changed by their own id. Only a member of the
 * project they belong to may change or delete them — a signed-in stranger who
 * learns an id gets a 403 and the item stays as it was.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${120 + n}`)
    .send({ email: `items-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: `I${n}`, lastName: "Guard" });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}

describe("project decisions, files and links", () => {
  it("only the project's members can change or delete them", async () => {
    const app = await getTestApp();
    const [owner, stranger] = [await person(app), await person(app)];
    const project = (await owner.agent.post("/api/projects").send({
      title: "Guarded Items", description: "A project whose decisions, files and links a stranger must not touch.", category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body.id as string;

    const decision = await owner.agent.post(`/api/projects/${project}/decisions`).send({ title: "Use Postgres", decision: "We use Postgres." });
    expect(decision.status).toBe(200);
    const file = await owner.agent.post(`/api/projects/${project}/files`).send({ name: "plan.md", url: "https://example.com/plan.md", fileType: "document" });
    expect(file.status).toBe(200);
    const link = await owner.agent.post(`/api/projects/${project}/links`).send({ label: "Repo", url: "https://example.com/repo", category: "repo" });
    expect(link.status).toBe(200);

    expect((await stranger.agent.patch(`/api/decisions/${decision.body.id}`).send({ title: "Hijacked" })).status).toBe(403);
    expect((await stranger.agent.delete(`/api/decisions/${decision.body.id}`)).status).toBe(403);
    expect((await stranger.agent.delete(`/api/files/${file.body.id}`)).status).toBe(403);
    expect((await stranger.agent.delete(`/api/links/${link.body.id}`)).status).toBe(403);
    expect((await stranger.agent.delete(`/api/files/does-not-exist`)).status).toBe(404);

    const decisions = (await owner.agent.get(`/api/projects/${project}/decisions`)).body;
    expect(decisions.find((d: any) => d.id === decision.body.id)?.title).toBe("Use Postgres");
    expect((await owner.agent.get(`/api/projects/${project}/files`)).body.some((f: any) => f.id === file.body.id)).toBe(true);
    expect((await owner.agent.get(`/api/projects/${project}/links`)).body.some((l: any) => l.id === link.body.id)).toBe(true);

    // The owner still can — and can't move a decision to another project by PATCHing projectId.
    const edited = await owner.agent.patch(`/api/decisions/${decision.body.id}`).send({ status: "accepted", projectId: "elsewhere" });
    expect(edited.status).toBe(200);
    expect(edited.body.projectId).toBe(project);
    expect((await owner.agent.delete(`/api/links/${link.body.id}`)).status).toBe(200);
    expect((await owner.agent.delete(`/api/files/${file.body.id}`)).status).toBe(200);
    expect((await owner.agent.delete(`/api/decisions/${decision.body.id}`)).status).toBe(200);
  });
});
