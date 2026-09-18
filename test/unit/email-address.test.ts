/**
 * What an address has to look like before anything is sent to it.
 *
 * Registration accepted anything non-empty. `notanemail`, `a@b`, `x@@y.com`
 * and `spaces here@x.com` all made accounts — each one starting a confirmation
 * email to an address that cannot receive one. A bounce is not just a wasted
 * message: it is counted against the sending domain by the providers deciding
 * whether the next invite reaches an inbox.
 */
import { describe, it, expect } from "vitest";
import { checkEmailShape, normalizeEmail, suggestAddress } from "@shared/email-address";

const refuses = (email: string) => checkEmailShape(email)?.message ?? null;

describe("addresses a provider could have issued", () => {
  it("accepts the ordinary ones, including the awkward-but-legal", () => {
    for (const ok of [
      "casey@example.com",
      "casey.mixed+tag@example.co.uk",
      "c@x.io",
      "first.last@sub.domain.example.com",
      "a_b-c'd@example.com",
      "  Casey@Example.COM  ", // trimmed and lowercased before judging
    ]) {
      expect(checkEmailShape(ok), ok).toBeNull();
    }
  });

  it("refuses the five that were making accounts an hour ago", () => {
    expect(refuses("notanemail")).toMatch(/missing the @/);
    expect(refuses("a@b")).toMatch(/needs a dot/);
    expect(refuses("x@@y.com")).toMatch(/more than one @/);
    expect(refuses("spaces here@x.com")).toMatch(/can't contain spaces/);
    expect(refuses("")).toMatch(/Enter your email/);
  });

  it("refuses the shapes no mailbox has", () => {
    expect(refuses("@example.com")).toMatch(/nothing before the @/);
    expect(refuses("casey@")).toMatch(/nothing after the @/);
    expect(refuses(".casey@example.com")).toMatch(/start, end, or run two dots/);
    expect(refuses("casey.@example.com")).toMatch(/start, end, or run two dots/);
    expect(refuses("ca..sey@example.com")).toMatch(/start, end, or run two dots/);
    expect(refuses("casey@example..com")).toMatch(/isn't a domain name/);
    expect(refuses("casey@-example.com")).toMatch(/isn't a domain name/);
    expect(refuses("casey@example.c0m")).toMatch(/domain ending/);
    expect(refuses(`${"a".repeat(65)}@example.com`)).toMatch(/before the @ is too long/);
    expect(refuses(`casey@${"a".repeat(250)}.com`)).toMatch(/too long/);
  });

  it("says what somebody meant, when it is obvious", () => {
    // gmial.com resolves and even runs a mail server, so no DNS check would
    // catch this one. Only knowing the name does.
    expect(refuses("casey@gmial.com")).toBe("Did you mean casey@gmail.com?");
    expect(suggestAddress("casey@hotmial.com")).toBe("casey@hotmail.com");
    expect(suggestAddress("casey@yaho.com")).toBe("casey@yahoo.com");
    // And it stays quiet when it would be guessing.
    expect(suggestAddress("casey@mycompany.io")).toBeNull();
    expect(suggestAddress("casey@gmail.com")).toBeNull();
  });

  it("normalises to one thing", () => {
    expect(normalizeEmail("  Casey@Example.COM ")).toBe("casey@example.com");
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });
});
