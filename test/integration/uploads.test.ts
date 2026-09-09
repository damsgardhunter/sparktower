/**
 * Uploads: getting a presigned URL, and getting the object back afterwards.
 *
 * No cloud writes. With no bucket configured and NODE_ENV "test", the storage
 * service uses its local-disk fallback — the same path a developer without a
 * bucket already runs on — so CI needs no credentials and nothing is written to
 * anyone's storage. The route, the URL normalisation, the ACL check and the
 * serving handler are all the real ones; only the destination is a temp
 * directory instead of a bucket.
 *
 * The security-relevant claims here are that an anonymous caller can't ask for
 * an upload URL at all, and that an object marked private isn't served to
 * anyone else — the second being the one that fails quietly, since an
 * over-permissive object looks exactly like a working one.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import fs from "fs/promises";
import path from "path";
import { getTestApp, closeTestApp } from "../helpers/app";
import { ObjectStorageService } from "../../server/replit_integrations/object_storage/objectStorage";
import { setObjectAclPolicy } from "../../server/replit_integrations/object_storage/objectAcl";

const OBJECT_ROOT = process.env.LOCAL_OBJECT_ROOT!;

beforeAll(async () => {
  await fs.mkdir(path.join(OBJECT_ROOT, "uploads"), { recursive: true });
});

afterAll(async () => {
  await closeTestApp();
  // The scratch directory is disposable; leaving it behind would make the next
  // run's "object not found" assertions depend on what this one uploaded.
  await fs.rm(OBJECT_ROOT, { recursive: true, force: true }).catch(() => {});
});

const password = "Testpass123!";
const newEmail = () => `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signedIn(app: any) {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/register")
    .send({ email: newEmail(), password, firstName: "Uploader", lastName: "Tester" });
  expect(res.status).toBe(201);
  return { agent, userId: res.body.id as string };
}

/** Asks for a URL, then actually puts bytes at it. Returns the object path. */
async function upload(app: any, agent: any, body: Buffer, name = "photo.png") {
  const presign = await agent
    .post("/api/uploads/request-url")
    .send({ name, size: body.length, contentType: "image/png" });
  expect(presign.status).toBe(200);

  const uploadPath = new URL(presign.body.uploadURL).pathname;
  await request(app).put(uploadPath).send(body).expect(200);

  return presign.body.objectPath as string;
}

describe("requesting a presigned upload URL", () => {
  it("refuses an anonymous caller", async () => {
    const app = await getTestApp();
    const res = await request(app)
      .post("/api/uploads/request-url")
      .send({ name: "photo.png", size: 1024, contentType: "image/png" });

    expect(res.status).toBe(401);
    expect(res.body.uploadURL).toBeUndefined();
  });

  it("returns a URL and the object path it will resolve to", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app);

    const res = await agent
      .post("/api/uploads/request-url")
      .send({ name: "photo.png", size: 2048, contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.uploadURL).toBeTruthy();

    /*
     * The two have to agree, and this is the assertion that catches it when
     * they drift: `objectPath` is derived from `uploadURL` by a separate
     * function, so a change to how URLs are built silently breaks every
     * upload's stored path unless something checks the round trip.
     */
    expect(res.body.objectPath).toMatch(/^\/objects\/uploads\/[0-9a-f-]{36}$/i);
    const id = res.body.objectPath.split("/").pop();
    expect(res.body.uploadURL).toContain(id);

    // Metadata is echoed for the client, not trusted for anything.
    expect(res.body.metadata).toEqual({ name: "photo.png", size: 2048, contentType: "image/png" });
  });

  it("requires a name", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app);

    const res = await agent.post("/api/uploads/request-url").send({ size: 10, contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.uploadURL).toBeUndefined();
  });

  it("hands out a different object id every time", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app);

    const a = await agent.post("/api/uploads/request-url").send({ name: "a.png" });
    const b = await agent.post("/api/uploads/request-url").send({ name: "b.png" });

    // A shared id would mean two uploads overwriting each other.
    expect(a.body.objectPath).not.toBe(b.body.objectPath);
  });
});

describe("serving an uploaded object", () => {
  it("resolves the path the presign handed back", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app);

    const bytes = Buffer.from("the contents of a small file", "utf8");
    const objectPath = await upload(app, agent, bytes);

    const served = await request(app).get(objectPath);
    expect(served.status).toBe(200);
    expect(Buffer.from(served.body).toString("utf8")).toBe(bytes.toString("utf8"));
  });

  it("404s for an object that was never uploaded", async () => {
    const app = await getTestApp();
    const res = await request(app).get("/objects/uploads/00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
  });

  it("serves an object with no ACL policy to anyone", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app);
    const objectPath = await upload(app, agent, Buffer.from("public bytes"));

    /*
     * Deliberate, and worth pinning: uploads predating ACLs — including
     * project logos and cover images, which are meant to be visible — carry no
     * policy. Failing closed here would blank every existing image on the site.
     */
    await request(app).get(objectPath).expect(200);
  });

  it("does not serve a private object to a stranger, or to nobody", async () => {
    const app = await getTestApp();
    const owner = await signedIn(app);
    const stranger = await signedIn(app);

    const objectPath = await upload(app, owner.agent, Buffer.from("private bytes"));

    // Mark it private, owned by the uploader — what an upload flow does once
    // it knows who the file belongs to.
    const storage = new ObjectStorageService();
    const file = await storage.getObjectEntityFile(objectPath);
    await setObjectAclPolicy(file as any, { owner: owner.userId, visibility: "private" });

    // The owner still gets it.
    await owner.agent.get(objectPath).expect(200);

    /*
     * Everyone else gets 404, not 403. A 403 confirms the object is there,
     * which turns a guessable path into a way of proving what someone uploaded
     * even when you cannot read it.
     */
    expect((await stranger.agent.get(objectPath)).status).toBe(404);
    expect((await request(app).get(objectPath)).status).toBe(404);
  });

  it("serves an object explicitly marked public to a stranger", async () => {
    const app = await getTestApp();
    const owner = await signedIn(app);
    const stranger = await signedIn(app);

    const objectPath = await upload(app, owner.agent, Buffer.from("public bytes"));
    const storage = new ObjectStorageService();
    const file = await storage.getObjectEntityFile(objectPath);
    await setObjectAclPolicy(file as any, { owner: owner.userId, visibility: "public" });

    // The control for the test above: without this, "stranger gets 404" would
    // also pass if the ACL check refused everyone unconditionally.
    await stranger.agent.get(objectPath).expect(200);
  });
});
