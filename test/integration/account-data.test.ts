/**
 * Your data: take a copy, or leave.
 *
 * The assertions worth having are the ones nobody checks by hand: that an
 * export holds this account's rows and nobody else's, that it never carries a
 * credential, that leaving actually removes the personal rows rather than
 * hiding them, and that it can't take another member's project down with it.
 *
 * The last test is the one that keeps the other tests honest as the schema
 * grows: every table with a user column has to be listed in
 * server/account-data.ts, so a new table can't quietly escape both.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { readFileSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { passMfa, codeFor } from "../helpers/mfa";
import { verifyEmail } from "../helpers/verify-email";
import { db, pool } from "../../server/db";
import { users } from "@shared/schema";
import { MINE, CHOICE, KEPT } from "../../server/account-data";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
let n = 0;
const ip = () => `198.51.108.${20 + (n++ % 200)}`;

async function person(app: any, first: string) {
  const agent = request.agent(app);
  const email = `account-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip()).send({ email, password, firstName: first, lastName: "Data" });
  expect(res.status).toBe(201);
  await verifyEmail(app, email, ip());
  await agent.post("/api/profile/complete-onboarding").send({ displayName: `${first} Data`, headline: "Here", bio: "Testing data rights." });
  return { agent, id: res.body.id as string, email };
}

const newProject = (title: string) => ({ title, description: "A project for the data-rights tests to work with.", category: "saas", goal: "ship_mvp", subcategory: "saas" });

describe("exporting your data", () => {
  it("returns this account's rows as a file, never another account's, and never a credential", async () => {
    const app = await getTestApp();
    const me = await person(app, "Mine");
    const stranger = await person(app, "Stranger");
    await me.agent.post("/api/projects").send(newProject("My Export"));
    await stranger.agent.post("/api/projects").send(newProject("Not Mine"));
    const mine = await me.agent.post("/api/feed").send({ postType: "project_update", content: `A post of my own ${Date.now()}` });
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    const theirs = await stranger.agent.post("/api/feed").send({ postType: "project_update", content: `A post that is not mine ${Date.now()}` });

    await passMfa(me.agent);
    const res = await me.agent.get("/api/account/export");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="sparktower-export-\d{4}-\d{2}-\d{2}\.json"/);
    const data = JSON.parse(res.text);

    expect(data.account.email).toBe(me.email);
    expect(data.projects.map((p: any) => p.title)).toEqual(["My Export"]);
    // Their own posts — the one written here, plus whatever the app posted as them (a new project announces itself).
    const postIds = data.feed_posts.map((p: any) => p.id);
    expect(postIds).toContain(mine.body.id);
    expect(data.feed_posts.every((p: any) => p.author_id === me.id)).toBe(true);
    expect(data.user_profiles[0].display_name).toBe("Mine Data");
    expect(data.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Nothing of the stranger's, and nothing that could be used to sign in.
    const text = JSON.stringify(data);
    expect(text).not.toContain(stranger.id);
    expect(text).not.toContain(theirs.body.id);
    // Both spellings: an ORM row would say passwordHash, a SQL row password_hash, and the first draft leaked the camelCase one.
    expect(text).not.toMatch(/password_hash|mfa_secret|mfa_pending_secret|mfa_recovery_codes|token_hash|stripe_customer_id/i);
    expect(text).not.toMatch(/passwordHash|mfaSecret|mfaRecoveryCodes|tokenHash|stripeCustomerId/);
    expect(Object.keys(data.account)).toContain("email");
    // 2FA is on for this account, and the export says so without saying what the secret is.
    expect(data.account.mfa_enabled_at).toBeTruthy();
  });

  it("is refused without a session", async () => {
    const app = await getTestApp();
    expect((await request(app).get("/api/account/export")).status).toBe(401);
  });
});

describe("closing your account", () => {
  it("asks for the password, and for a code when 2FA is on", async () => {
    const app = await getTestApp();
    const me = await person(app, "Careful");
    const { secret } = await passMfa(me.agent);

    const noPassword = await me.agent.post("/api/account/delete").send({});
    expect(noPassword.status).toBe(401);
    expect(noPassword.body.code).toBe("bad_password");

    const wrongCode = await me.agent.post("/api/account/delete").send({ password, code: "000000" });
    expect(wrongCode.status).toBe(401);
    expect(wrongCode.body.code).toBe("mfa_invalid_code");

    // Still there, still signed in.
    expect((await me.agent.get("/api/auth/user")).status).toBe(200);

    const done = await me.agent.post("/api/account/delete").send({ password, code: codeFor(secret, 1), keepPosts: false });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await me.agent.get("/api/auth/user")).status).toBe(401);
  });

  it("removes the personal rows, signs every device out, and refuses the password afterwards — and the address can sign up again", async () => {
    const app = await getTestApp();
    const me = await person(app, "Leaving");
    await me.agent.post("/api/projects").send(newProject("Leaving Solo"));
    await me.agent.post("/api/feed").send({ postType: "project_update", content: `Goodbye ${Date.now()}` });
    const mobile = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", ip()).send({ email: me.email, password, device: "Phone" });
    expect(mobile.body.accessToken).toBeTruthy();

    const res = await me.agent.post("/api/account/delete").send({ password, keepPosts: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.posts).toBe("deleted");

    // The profile and the posts are gone, not hidden.
    const profile = await pool.query("SELECT 1 FROM user_profiles WHERE user_id = $1", [me.id]);
    expect(profile.rowCount).toBe(0);
    const posts = await pool.query("SELECT 1 FROM feed_posts WHERE author_id = $1", [me.id]);
    expect(posts.rowCount).toBe(0);
    const projects = await pool.query("SELECT 1 FROM projects WHERE owner_id = $1", [me.id]);
    expect(projects.rowCount).toBe(0);

    // The row is a tombstone: scrubbed, closed, unusable.
    const [row] = await db.select().from(users).where(eq(users.id, me.id));
    expect(row.deletedAt).toBeTruthy();
    expect(row.email).not.toBe(me.email);
    expect(row.passwordHash).toBeNull();
    expect(row.firstName).toBe("Deleted");

    // Every way back in is shut.
    expect((await me.agent.get("/api/auth/user")).status).toBe(401);
    const signIn = await request(app).post("/api/auth/login").set("x-forwarded-for", ip()).send({ email: me.email, password });
    expect(signIn.status).toBe(401);
    expect((await request(app).get("/api/auth/mobile/me").set("Authorization", `Bearer ${mobile.body.accessToken}`)).status).toBe(401);
    expect((await request(app).post("/api/auth/mobile/refresh").set("x-forwarded-for", ip()).send({ refreshToken: mobile.body.refreshToken })).status).toBe(401);
    const tokens = await pool.query("SELECT 1 FROM mobile_refresh_tokens WHERE user_id = $1", [me.id]);
    expect(tokens.rowCount).toBe(0);

    // And the address is free again: closing an account isn't a ban.
    const again = await request(app).post("/api/auth/register").set("x-forwarded-for", ip()).send({ email: me.email, password, firstName: "Back" });
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(me.id);
  });

  it("keeps the posts, under a closed account, when that's what they chose", async () => {
    const app = await getTestApp();
    const me = await person(app, "Quiet");
    const post = await me.agent.post("/api/feed").send({ postType: "project_update", content: `Something worth keeping ${Date.now()}` });
    expect(post.status).toBe(200);

    const res = await me.agent.post("/api/account/delete").send({ password, keepPosts: true });
    expect(res.body.posts).toBe("kept-anonymous");

    const kept = await pool.query("SELECT author_id FROM feed_posts WHERE id = $1", [post.body.id]);
    expect(kept.rows[0].author_id).toBe(me.id);
    // The author it points at has no name left to show.
    const [row] = await db.select().from(users).where(eq(users.id, me.id));
    expect(row.firstName).toBe("Deleted");
    expect(row.lastName).toBe("account");
    // The profile behind it is gone all the same.
    expect((await pool.query("SELECT 1 FROM user_profiles WHERE user_id = $1", [me.id])).rowCount).toBe(0);
  });

  it("hands a shared project to another member instead of taking it with them", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const mate = await person(app, "Mate");
    const shared = await owner.agent.post("/api/projects").send(newProject("Shared Work"));
    const solo = await owner.agent.post("/api/projects").send(newProject("Solo Work"));
    await pool.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'member')", [shared.body.id, mate.id]);

    const res = await owner.agent.post("/api/account/delete").send({ password, keepPosts: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.transferred).toEqual([{ projectId: shared.body.id, title: "Shared Work", newOwnerId: mate.id }]);
    expect(res.body.deletedProjects).toEqual([{ projectId: solo.body.id, title: "Solo Work" }]);

    // The mate now owns it, and can still open it.
    const owned = await pool.query("SELECT owner_id FROM projects WHERE id = $1", [shared.body.id]);
    expect(owned.rows[0].owner_id).toBe(mate.id);
    expect((await mate.agent.get(`/api/projects/${shared.body.id}`)).status).toBe(200);
    // The solo one is gone, and so is everything under it.
    expect((await pool.query("SELECT 1 FROM projects WHERE id = $1", [solo.body.id])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM project_kanban_tasks WHERE project_id = $1", [solo.body.id])).rowCount).toBe(0);
  });
});

describe("what the lists cover", () => {
  it("names a real table and column every time — a typo here is a row that never gets deleted", async () => {
    await getTestApp();
    const { rows } = await pool.query("SELECT table_name, column_name FROM information_schema.columns");
    const have = new Set(rows.map((r: any) => `${r.table_name}.${r.column_name}`));
    const missing = [...MINE, ...CHOICE, ...KEPT].map((o) => `${o.table}.${o.column}`).filter((k) => !have.has(k));
    expect(missing, "listed in server/account-data.ts but not in the database").toEqual([]);
  });

  it("every table with a user column is listed as mine, a choice, or kept", async () => {
    const listed = new Set([...MINE, ...CHOICE, ...KEPT].map((o) => `${o.table}.${o.column}`));
    const schema = readFileSync(join(__dirname, "..", "..", "shared", "schema.ts"), "utf8");
    const userColumn = /^(user_id|owner_id|author_id|actor_id|recipient_id|sender_id|backer_id|follower_id|followee_id|target_user_id)$/;
    const missing: string[] = [];
    for (const table of schema.matchAll(/export const \w+ = pgTable\(\s*"([\w_]+)"([\s\S]*?)\n\}/g)) {
      for (const col of table[2].matchAll(/\w+:\s*\w+\("([\w_]+)"/g)) {
        if (!userColumn.test(col[1])) continue;
        const key = `${table[1]}.${col[1]}`;
        // A project's owner is handled by the transfer step, not by a list.
        if (key === "projects.owner_id" || listed.has(key)) continue;
        missing.push(key);
      }
    }
    expect(missing, "a table keyed to a user that account export and deletion both ignore — add it to MINE, CHOICE or KEPT in server/account-data.ts").toEqual([]);
  });
});
