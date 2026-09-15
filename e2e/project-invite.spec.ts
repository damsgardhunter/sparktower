/**
 * Inviting a collaborator in a real browser: the owner opens "Invite
 * collaborator", gets a link (and, with an address, a logged email), the invite
 * is in the database, and a signed-out browser opens the link onto the accept
 * screen, signs up, and joins the project. API-level: test/integration/invites.test.ts.
 */
import { test, expect } from "@playwright/test";
import pg from "pg";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";
import { createHash } from "node:crypto";

loadEnvFile();
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test("an owner invites a collaborator by link; a stranger opens it signed out, signs up and joins", async ({ browser }) => {
  test.setTimeout(180_000);
  const ownerContext = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.150" } });
  const api = ownerContext.request;
  await api.get("/");
  const inviteeEmail = `e2e-invitee-${stamp()}@example.test`;
  expect((await api.post("/api/auth/register", { data: { email: `e2e-owner-${stamp()}@example.test`, password: "Testpass123!", firstName: "Olive", lastName: "Owner" } })).ok()).toBeTruthy();
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: "Olive Owner", headline: "Building", bio: "Inviting a teammate." } })).ok()).toBeTruthy();
  const project = await (await api.post("/api/projects", { data: { title: `Team Up ${stamp()}`, description: "A project that invites a collaborator.", category: "saas", goal: "ship_mvp", subcategory: "saas" } })).json();

  // 1. The modal: an email, a role, a link to copy, and what happened to the email.
  const page = await ownerContext.newPage();
  await page.goto(`/projects/${project.id}/manage?tab=team`);
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 10_000 }).catch(() => {});
  await page.getByTestId("button-invite-collaborator").click();
  const dialog = page.getByTestId("invite-dialog");
  await dialog.getByTestId("input-invite-email").fill(inviteeEmail);
  await dialog.getByTestId("select-invite-role").selectOption("Engineer");
  await dialog.getByTestId("button-create-invite").click();
  const link = await dialog.getByTestId("invite-link").inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
  await expect(dialog.getByTestId("invite-email-status")).toContainText("Email isn't set up here");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("pending-invites")).toContainText(inviteeEmail);

  // 2. It's in the database: the hash of the token, never the token.
  const token = link.split("/invite/")[1];
  const db = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await db.connect();
  const { rows } = await db.query("select email, role, token_hash, expires_at, created_by_id, accepted_at from project_invites where project_id = $1", [project.id]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ email: inviteeEmail, role: "Engineer", token_hash: createHash("sha256").update(token).digest("hex"), accepted_at: null });

  // 3. A signed-out browser (a fresh context, like incognito) opens the link onto the accept screen.
  const stranger = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.151" } });
  const guest = await stranger.newPage();
  await guest.goto(new URL(link).pathname);
  await expect(guest.getByTestId("invite-project-title")).toHaveText(project.title);
  await expect(guest.getByTestId("invite-role")).toHaveText("Engineer");
  await expect(guest.getByText("Olive Owner")).toBeVisible();

  // 4. Sign up from it, come straight back, and join.
  await guest.getByTestId("button-invite-signup").click();
  await guest.getByTestId("input-signup-firstname").fill("Ian");
  await guest.getByTestId("input-signup-lastname").fill("Invitee");
  await guest.getByTestId("input-signup-email").fill(inviteeEmail);
  await guest.getByTestId("input-signup-password").fill("Testpass123!");
  await guest.getByTestId("input-signup-confirm").fill("Testpass123!");
  await guest.getByTestId("button-submit-signup").click();
  await expect(guest).toHaveURL(new RegExp(`/invite/${token}$`));
  await guest.getByTestId("button-accept-invite").click();
  // A member now, with the invite's role (the owner has their own row from creating the project).
  await expect.poll(async () => (await db.query("select m.role from project_members m join users u on u.id = m.user_id where m.project_id = $1 and u.email = $2", [project.id, inviteeEmail])).rows.map((r) => r.role)).toEqual(["Engineer"]);
  expect((await db.query("select accepted_at from project_invites where project_id = $1", [project.id])).rows[0].accepted_at).not.toBeNull();
  await db.end();

  // The owner's list shows it accepted.
  await page.reload();
  await expect(page.getByTestId("pending-invites")).toContainText("accepted");
  await Promise.all([ownerContext.close(), stranger.close()]);
});
