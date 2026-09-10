/**
 * The live-database read, against the test database itself, and the
 * data-source setting: owner only, sealed, never echoed.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { introspectDataShape, compareWithCode } from "../../server/data-shape";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
async function signedIn(app: any, tag: string) {
  const agent = request.agent(app);
  const email = `ds-${tag}-${Date.now()}@example.test`;
  await agent.post("/api/auth/register").send({ email, password });
  return { agent, email };
}

describe("introspectDataShape", () => {
  it("reads tables, keys and exact row counts from the database it is given", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app, "rows");
    for (const title of ["One", "Two"]) await agent.post("/api/projects").send({ title, description: `Project ${title} for counting rows in tables.`, category: "saas", goal: "ship_mvp", subcategory: "saas" }).expect(200);

    const shape = await introspectDataShape(process.env.DATABASE_URL!, "self");
    expect(shape.error).toBeUndefined();
    const by = Object.fromEntries(shape.tables.map((t) => [t.name, t]));
    expect(by.users.rows).toBe(1);
    expect(by.projects).toMatchObject({ rows: 2, exact: true });
    expect(by.projects.columns.find((c) => c.name === "id")?.pk).toBe(true);
    expect(by.projects.foreignKeys).toContainEqual({ column: "owner_id", refTable: "users", refColumn: "id" });
    expect(by.users.inbound).toBeGreaterThan(5);
    expect(by.path_pace.rows).toBe(0);
    expect(shape.totals.tables).toBeGreaterThan(50);
    expect(shape.totals.emptyTables).toBeGreaterThan(10);

    const compared = compareWithCode(shape, [{ name: "users" }, { name: "projects" }, { name: "somethingNotMigrated" }]);
    expect(compared.compare!.inCodeNotInDb).toEqual(["somethingNotMigrated"]);
    expect(compared.compare!.inDbNotInCode).toContain("path_pace");
  });

  it("fails soft on a database it cannot reach", async () => {
    const shape = await introspectDataShape(["postgresql://nobody", "nothing@203.0.113.9:5432/nowhere"].join(":"), "connection", { ssl: false });
    expect(shape.tables).toEqual([]);
    expect(shape.error).toBeTruthy();
  }, 20_000);
});

describe("the data source setting", () => {
  it("is owner-only, sealed at rest, never echoed, and refuses private hosts and 'self' for non-owners", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app, "owner");
    const { agent: other } = await signedIn(app, "other");
    const created = await agent.post("/api/projects").send({ title: "DS", description: "A project whose data source is being configured.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(200);
    const id = created.body.id;

    expect((await agent.get(`/api/projects/${id}/data-source`)).body).toEqual({ configured: false, kind: null });
    expect((await other.get(`/api/projects/${id}/data-source`)).status).toBe(403);
    expect((await other.put(`/api/projects/${id}/data-source`).send({ url: ["postgresql://a", "b@db.example.com/x"].join(":") })).status).toBe(403);
    expect((await agent.put(`/api/projects/${id}/data-source`).send({ url: ["postgresql://a", "b@localhost/x"].join(":") })).body.code).toBe("invalid_input");
    expect((await agent.put(`/api/projects/${id}/data-source`).send({ url: "self" })).body.code).toBe("self_not_allowed");

    const ok = await agent.put(`/api/projects/${id}/data-source`).send({ url: ["postgresql://ro", "stand-in@db.example.com:5432/app"].join(":") });
    expect(ok.body).toMatchObject({ configured: true, kind: "connection" });
    // An unreachable host reads soft: the source is saved, the shape carries the error.
    expect(ok.body.shape?.error).toBeTruthy();
    const { db } = await import("../../server/db");
    const { projects } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select({ ds: projects.dataSource }).from(projects).where(eq(projects.id, id));
    expect(row.ds).toMatch(/^v1\./);
    expect(row.ds).not.toContain("stand-in");
    expect((await agent.get(`/api/projects/${id}`)).body.dataSource).toBeUndefined();
    // A plain patch can't touch it.
    await agent.patch(`/api/projects/${id}`).send({ dataSource: "self" });
    expect((await db.select({ ds: projects.dataSource }).from(projects).where(eq(projects.id, id)))[0].ds).toMatch(/^v1\./);
    expect((await agent.put(`/api/projects/${id}/data-source`).send({ url: null })).body).toMatchObject({ configured: false, kind: null, shape: null });
  });
});

describe("saving a source reads the database right then", () => {
  it("returns the shape on save for the platform owner's 'self', serves it to members, and re-reads on demand", async () => {
    const app = await getTestApp();
    const { agent, email } = await signedIn(app, "platform-owner");
    const { agent: member } = await signedIn(app, "member");
    const { agent: stranger } = await signedIn(app, "stranger");
    const id = (await agent.post("/api/projects").send({ title: "Self", description: "The platform owner's own project reading its own database.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body.id;
    const memberId = (await member.get("/api/auth/user")).body.id;
    const { db } = await import("../../server/db");
    const { projectMembers } = await import("@shared/schema");
    await db.insert(projectMembers).values({ projectId: id, userId: memberId, role: "member" } as any);

    const prev = process.env.PLATFORM_OWNER_EMAIL;
    process.env.PLATFORM_OWNER_EMAIL = email;
    try {
      const saved = await agent.put(`/api/projects/${id}/data-source`).send({ url: "self" });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ configured: true, kind: "self" });
      expect(saved.body.shape.totals.tables).toBeGreaterThan(50);
      expect(saved.body.shape.tables.find((t: any) => t.name === "projects").rows).toBe(1);
    } finally { process.env.PLATFORM_OWNER_EMAIL = prev; }

    const forMember = await member.get(`/api/projects/${id}/data-shape`);
    expect(forMember.status).toBe(200);
    expect(forMember.body.shape.totals.tables).toBeGreaterThan(50);
    expect((await stranger.get(`/api/projects/${id}/data-shape`)).status).toBe(403);
    expect((await member.post(`/api/projects/${id}/data-shape/refresh`)).status).toBe(403);
    const again = await agent.post(`/api/projects/${id}/data-shape/refresh`);
    expect(again.status).toBe(200);
    expect(again.body.shape.totals.tables).toBeGreaterThan(50);

    // Removing the source removes the map.
    await agent.put(`/api/projects/${id}/data-source`).send({ url: null }).expect(200);
    expect((await agent.get(`/api/projects/${id}/data-shape`)).body.shape).toBeNull();
    expect((await agent.post(`/api/projects/${id}/data-shape/refresh`)).body.code).toBe("no_data_source");
  });
});
