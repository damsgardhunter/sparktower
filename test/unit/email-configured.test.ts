/**
 * The warning that says nobody can use the site.
 *
 * Email carries the confirmation link, and confirming is what lets a new
 * account post, comment, message or invite. Unset in production, every signup
 * lands in a product they can't use and the screen says nothing. This is the
 * one place that notices, so it's worth holding to its word.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { warnIfEmailUnconfigured } from "../../server/email";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; vi.restoreAllMocks(); });

const capture = () => {
  const lines: { level: string; text: string }[] = [];
  vi.spyOn(console, "error").mockImplementation((...a) => lines.push({ level: "error", text: a.join(" ") }));
  vi.spyOn(console, "log").mockImplementation((...a) => lines.push({ level: "log", text: a.join(" ") }));
  return lines;
};

describe("email configuration at boot", () => {
  it("says loudly in production what the consequence is, naming what's missing", () => {
    process.env.NODE_ENV = "production";
    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_FROM = "SparkTower <hello@example.com>";
    const lines = capture();
    warnIfEmailUnconfigured();
    expect(lines).toHaveLength(1);
    expect(lines[0].level, "a silent site with nobody able to post is not a console.log").toBe("error");
    expect(lines[0].text).toContain("RESEND_API_KEY");
    expect(lines[0].text).not.toContain("EMAIL_FROM");
    // It says what it costs, not just what's unset.
    expect(lines[0].text).toMatch(/post, comment, message or invite/);
  });

  it("is a quiet note in development, where the log is the inbox", () => {
    process.env.NODE_ENV = "development";
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    const lines = capture();
    warnIfEmailUnconfigured();
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("log");
    expect(lines[0].text).toContain("/api/dev/outbox");
    expect(lines[0].text).toContain("RESEND_API_KEY and EMAIL_FROM");
  });

  it("says nothing when email is configured", () => {
    process.env.NODE_ENV = "production";
    process.env.RESEND_API_KEY = "re_fake_for_this_test";
    process.env.EMAIL_FROM = "SparkTower <hello@example.com>";
    const lines = capture();
    warnIfEmailUnconfigured();
    expect(lines).toEqual([]);
  });
});
