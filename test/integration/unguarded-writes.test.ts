/**
 * The writes an audit flagged as reachable without auth, each checked for
 * what actually stands in front of it.
 *
 * - The MCP write routes: a token guard on the whole /api/mcp prefix. Nothing
 *   gets through without a token, and a session cookie isn't one.
 * - /api/seed: removed. It created demo users and projects for anyone.
 * - The development upload: the issued id is the credential, and now a size
 *   cap too — declared or streamed.
 * - Logout: no auth guard on purpose, but another site can't sign you out.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { existsSync } from "fs";
import { join } from "path";
import { inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users } from "@shared/schema";
import { LOCAL_UPLOAD_MAX_BYTES } from "../../server/replit_integrations/object_storage/local-uploads";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function signedIn(app: any) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${230 + n}`)
    .send({ email: `ug-${Date.now()}-${n}@example.test`, password: "Testpass123!" });
  expect(res.status).toBe(201);
  return agent;
}

describe("the MCP write surface", () => {
  it("refuses every flagged route without a token — and a session cookie isn't one", async () => {
    const app = await getTestApp();
    const agent = await signedIn(app);
    const pid = "any-project";
    const calls: [string, string][] = [
      ["post", `/api/mcp/projects/${pid}/loops`],
      ["delete", `/api/mcp/projects/${pid}/loops/some-task`],
      ["post", `/api/mcp/projects/${pid}/loops/some-task/steps`],
      ["post", `/api/mcp/projects/${pid}/mark`],
      ["get", "/api/mcp/projects"],
    ];
    for (const [method, url] of calls) {
      const anonymous = await (request(app) as any)[method](url).send({});
      expect(anonymous.status, `${method} ${url}`).toBe(401);
      expect(anonymous.body.code).toBe("token_required");
      const withSession = await (agent as any)[method](url).send({});
      expect(withSession.status, `${method} ${url} with a session`).toBe(401);
    }
  });
});

describe("/api/seed", () => {
  it("is gone, and creates nothing", async () => {
    const app = await getTestApp();
    const res = await request(app).post("/api/seed").set("x-forwarded-for", "198.51.100.250").send({});
    expect(res.status).toBe(404);
    expect(await db.select().from(users).where(inArray(users.id, ["user1", "user2", "user3"]))).toHaveLength(0);
  });
});

describe("the development upload", () => {
  const presign = async (agent: any, name: string) => {
    const res = await agent.post("/api/uploads/request-url").send({ name });
    expect(res.status).toBe(200);
    const path = new URL(res.body.uploadURL).pathname;
    return { path, id: path.split("/").pop()! };
  };

  it("refuses a body over the cap, declared or streamed, and keeps none of it", async () => {
    const app = await getTestApp();
    const agent = await signedIn(app);

    // Declared too big: refused on the header alone, before the id is spent — so
    // the real upload still works. Only a byte is sent, since the body is never
    // read; it's sent as a file because a text body would be held by the form
    // parser, waiting for bytes that never come.
    const first = await presign(agent, "big.png");
    const declared = await request(app).put(first.path)
      .set("Content-Type", "application/octet-stream")
      .set("Content-Length", String(LOCAL_UPLOAD_MAX_BYTES + 1))
      .send(Buffer.from("x"));
    expect(declared.status).toBe(413);
    expect((await request(app).put(first.path).send(Buffer.from("small"))).status).toBe(200);

    // Streamed with no declared length: counted as it arrives, and the partial file removed.
    const second = await presign(agent, "stream.png");
    const put = request(app).put(second.path);
    const mb = Buffer.alloc(1024 * 1024);
    for (let i = 0; i <= LOCAL_UPLOAD_MAX_BYTES / mb.length; i++) put.write(mb);
    expect((await put).status).toBe(413);
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(process.env.LOCAL_OBJECT_ROOT!, "uploads", second.id))).toBe(false);
  }, 60_000);
});

describe("logout", () => {
  const signedInNow = async (agent: any) => (await agent.get("/api/auth/user")).status === 200;

  it("another site can't sign you out; this site, a typed URL, and the app can", async () => {
    const app = await getTestApp();
    const agent = await signedIn(app);
    expect(await signedInNow(agent)).toBe(true);

    expect((await agent.get("/api/logout").set("Sec-Fetch-Site", "cross-site")).status).toBe(302);
    expect((await agent.post("/api/logout").set("Sec-Fetch-Site", "cross-site")).body.code).toBe("cross_site");
    expect((await agent.post("/api/logout").set("Sec-Fetch-Site", "same-site")).status).toBe(403);
    expect(await signedInNow(agent)).toBe(true);

    expect((await agent.get("/api/logout").set("Sec-Fetch-Site", "same-origin")).status).toBe(302);
    expect(await signedInNow(agent)).toBe(false);

    // No header at all — the mobile app, an older browser — still signs out.
    const other = await signedIn(app);
    expect((await other.post("/api/logout")).status).toBe(200);
    expect(await signedInNow(other)).toBe(false);
  });
});
