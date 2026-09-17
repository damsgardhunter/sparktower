/**
 * Researchers can find out how to report a vulnerability: security.txt is
 * served where RFC 9116 says, with the fields it requires, and it matches the
 * contacts in SECURITY.md. It also fails a month before the file expires —
 * that's the prompt to confirm the inbox is still watched and move the date.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { readFileSync } from "fs";
import { getTestApp, closeTestApp } from "../helpers/app";
import { SECURITY_CONTACT_EMAIL, SECURITY_TXT_EXPIRES } from "../../server/security-txt";

afterAll(async () => { await closeTestApp(); });

describe("security.txt", () => {
  it("is served as plain text with the required fields", async () => {
    const app = await getTestApp();
    const res = await request(app).get("/.well-known/security.txt");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
    expect(res.text).toMatch(new RegExp(`^Contact: mailto:${SECURITY_CONTACT_EMAIL}$`, "m"));
    expect(res.text).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/m);
    /*
     * A policy a stranger can actually open. It used to be the SECURITY.md blob
     * on GitHub, which 404s for everyone outside a private repository — which
     * is everyone this file is written for. So the rule is now the one that
     * matters: an absolute https URL, and not one that depends on access to the
     * repository (server/security-txt.ts).
     */
    expect(res.text).toMatch(/^Policy: https:\/\/\S+$/m);
    expect(res.text).not.toMatch(/^Policy: https:\/\/github\.com\//m);

    const legacy = await request(app).get("/security.txt");
    expect(legacy.status).toBe(301);
    expect(legacy.headers.location).toBe("/.well-known/security.txt");
  });

  it("agrees with SECURITY.md", () => {
    const policy = readFileSync("SECURITY.md", "utf8");
    expect(policy).toContain(SECURITY_CONTACT_EMAIL);
    expect(policy).toContain("/.well-known/security.txt");
  });

  it("isn't about to expire", () => {
    const daysLeft = (Date.parse(SECURITY_TXT_EXPIRES) - Date.now()) / 86_400_000;
    expect(daysLeft, "security.txt expires within 30 days: confirm the contacts still work and move SECURITY_TXT_EXPIRES on (at most a year out)").toBeGreaterThan(30);
    expect(daysLeft, "RFC 9116 recommends Expires no more than a year ahead").toBeLessThanOrEqual(366);
  });
});
