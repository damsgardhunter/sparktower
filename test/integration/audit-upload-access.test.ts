/**
 * Whose codebase is that zip?
 *
 * The audit can be pointed at an uploaded archive, and the path to it arrives
 * in the request body: `{ objectPath: "/objects/uploads/<uuid>" }`. Traversal
 * out of the bucket was already blocked. Ownership was never asked — so anyone
 * holding somebody else's upload path could have the server unzip it and hand
 * back the file listing, the per-file verdicts, and the names of the files that
 * look like they hold secrets.
 *
 * The second half is worse and is the reason the first half mattered. Audit
 * zips are uploaded through the generic presigned-URL route, which sets no ACL
 * policy at all, and an object with no policy is served by `GET /objects/...`
 * to anyone who asks — no account, no session, nothing but the URL. A zip of a
 * whole codebase was relying on a UUID being hard to guess. Unguessable is not
 * private, and source code is the last thing that should turn on the
 * difference, so the audit claims the object for the caller and marks it
 * private on the way past.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import request from "supertest";
import fs from "fs/promises";
import path from "path";

vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async () => ({ choices: [{ message: { content: "{}" } }] }) } };
    responses = { create: async () => ({ output_text: "{}", output: [] }) };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { users } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { ObjectStorageService } = await import("../../server/replit_integrations/object_storage/objectStorage");
const { getObjectAclPolicy, setObjectAclPolicy } = await import("../../server/replit_integrations/object_storage/objectAcl");

const OBJECT_ROOT = process.env.LOCAL_OBJECT_ROOT!;

beforeAll(async () => { await fs.mkdir(path.join(OBJECT_ROOT, "uploads"), { recursive: true }); });
afterAll(async () => {
  await closeTestApp();
  await fs.rm(OBJECT_ROOT, { recursive: true, force: true }).catch(() => {});
});

let n = 0;
async function builder(app: any, name: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `zip-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.113.${100 + n}`)
    .send({ email, password: "Testpass123!", firstName: name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  // The audit is a paid feature; without this the route refuses before it ever
  // looks at the object, and the test would pass for the wrong reason.
  await db.update(users).set({ subscriptionTier: "pro" }).where(eq(users.email, email));
  const project = (await agent.post("/api/projects").send({
    title: `Zip ${name}`, description: "A project to hang an audit off.", category: "saas", goal: "ship_mvp", subcategory: "saas",
  })).body;
  return { agent, email, projectId: project.id as string, id: res.body.id as string };
}

/** Puts bytes where the local-disk fallback looks, and answers with its object path. */
async function putObject(contents: string): Promise<string> {
  const id = `audit-zip-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(path.join(OBJECT_ROOT, "uploads", id), contents);
  return `/objects/uploads/${id}`;
}

describe("auditing an uploaded archive", () => {
  it("will not read an upload that belongs to somebody else", async () => {
    const app = await getTestApp();
    const owner = await builder(app, "Owner");
    const stranger = await builder(app, "Stranger");

    const objectPath = await putObject("PK-not-really-a-zip");
    const objectFile = await new ObjectStorageService().getObjectEntityFile(objectPath);
    await setObjectAclPolicy(objectFile, { owner: owner.id, visibility: "private" });

    // Their own project, their own credits, somebody else's file.
    const refused = await stranger.agent.post(`/api/projects/${stranger.projectId}/code-audit`).send({ objectPath, fileName: "theirs.zip" });
    expect(refused.status, JSON.stringify(refused.body)).toBe(404);
    // 404 and a shared message, so an object path can't be confirmed by the answer.
    expect(JSON.stringify(refused.body)).not.toMatch(/private|permission|owner|forbidden/i);
  }, 120_000);

  it("makes an upload with no policy private to the person auditing it", async () => {
    const app = await getTestApp();
    const owner = await builder(app, "Claimer");

    const objectPath = await putObject("not a zip either");
    const objectFile = await new ObjectStorageService().getObjectEntityFile(objectPath);
    expect(await getObjectAclPolicy(objectFile).catch(() => null), "starts world-readable").toBeFalsy();

    // The archive is nonsense, so the run ends at the unzip — after the object
    // has been claimed, which is the part under test.
    const res = await owner.agent.post(`/api/projects/${owner.projectId}/code-audit`).send({ objectPath, fileName: "mine.zip" });
    expect(res.status).toBe(400);

    const policy = await getObjectAclPolicy(objectFile);
    expect(policy).toMatchObject({ owner: owner.id, visibility: "private" });
  }, 120_000);
});
