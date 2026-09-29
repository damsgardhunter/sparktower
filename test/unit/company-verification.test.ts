/**
 * The rules that decide whether a domain can be claimed, and by whom.
 *
 * All of this is the anti-impersonation machinery, so the edges are the point:
 * the whole defence is that `WWW.Acme.com/` and `acme.com` are the same string
 * to the uniqueness check, and that nobody can claim gmail.com.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_CHECK_ATTEMPTS, TOKEN_PREFIX, VERIFICATION_PATH, isVerificationToken,
  normaliseDomain, unclaimableReason, verificationSteps,
} from "@shared/company-verification";

describe("reading a domain", () => {
  it("takes what people actually paste", () => {
    expect(normaliseDomain("acme.com")).toBe("acme.com");
    expect(normaliseDomain("https://acme.com")).toBe("acme.com");
    expect(normaliseDomain("https://www.acme.com/about?x=1")).toBe("acme.com");
    expect(normaliseDomain("  HTTPS://WWW.Acme.COM/  ")).toBe("acme.com");
    expect(normaliseDomain("acme.com.")).toBe("acme.com");
    expect(normaliseDomain("acme.co.uk")).toBe("acme.co.uk");
    // A subdomain is a different company's problem, and is kept as given.
    expect(normaliseDomain("careers.acme.com")).toBe("careers.acme.com");
  });

  it("collapses the spellings that would otherwise be two companies", () => {
    const spellings = ["acme.com", "ACME.com", "www.acme.com", "https://www.ACME.com/", "acme.com."];
    expect(new Set(spellings.map(normaliseDomain)).size, "every spelling is one domain").toBe(1);
  });

  it("refuses what is not a registrable domain, rather than guessing", () => {
    expect(normaliseDomain("")).toBeNull();
    expect(normaliseDomain("localhost")).toBeNull();
    expect(normaliseDomain("203.0.113.4")).toBeNull();
    // A port would let acme.com:8080 become a second acme.com.
    expect(normaliseDomain("acme.com:8080")).toBeNull();
    expect(normaliseDomain("acme")).toBeNull();
    expect(normaliseDomain("-acme.com")).toBeNull();
    expect(normaliseDomain("acme..com")).toBeNull();
    expect(normaliseDomain("acme.123")).toBeNull();
    expect(normaliseDomain(null)).toBeNull();
  });
});

describe("domains nobody may claim", () => {
  it("refuses personal email providers, where controlling an address proves nothing", () => {
    for (const d of ["gmail.com", "outlook.com", "icloud.com", "proton.me"]) {
      expect(unclaimableReason(d), d).toBeTruthy();
    }
  });

  it("refuses hosts that hand subdomains to anybody, and the parent too", () => {
    // Claiming the parent would let the first comer lock out everyone on it.
    expect(unclaimableReason("github.io")).toBeTruthy();
    expect(unclaimableReason("someone.github.io")).toBeTruthy();
    expect(unclaimableReason("my-shop.myshopify.com")).toBeTruthy();
    expect(unclaimableReason("acme.vercel.app")).toBeTruthy();
  });

  it("allows an ordinary company domain", () => {
    expect(unclaimableReason("acme.com")).toBeNull();
    expect(unclaimableReason("acme.co.uk")).toBeNull();
    // A domain that merely contains a blocked name is not the blocked name.
    expect(unclaimableReason("gmail.com.acme.com")).toBeNull();
  });
});

describe("the token", () => {
  it("announces what it is, so one found in the wild is obviously ours", () => {
    expect(isVerificationToken(`${TOKEN_PREFIX}abc123def456ghi789jkl012`)).toBe(true);
  });

  it("refuses anything that isn't one", () => {
    expect(isVerificationToken("hello")).toBe(false);
    expect(isVerificationToken(`${TOKEN_PREFIX}short`)).toBe(false);
    expect(isVerificationToken(`${TOKEN_PREFIX}has spaces in it and more`)).toBe(false);
    expect(isVerificationToken(null)).toBe(false);
  });
});

describe("what somebody is told to do", () => {
  it("names the literal path and record the checker looks for", () => {
    const steps = verificationSteps("acme.com", `${TOKEN_PREFIX}tokentokentokentoken1234`);
    // If the instructions and the checker ever disagree, people follow the
    // instructions and the checker says no for ever.
    expect(steps.file.steps.join(" ")).toContain(`https://acme.com${VERIFICATION_PATH}`);
    expect(steps.dns.steps.join(" ")).toContain("_sparktower.acme.com");
    expect(steps.file.steps.join(" ")).toContain(TOKEN_PREFIX);
  });
});

describe("the attempt ceiling", () => {
  it("is low enough that a token can't be ground against somebody else's site", () => {
    expect(MAX_CHECK_ATTEMPTS).toBeLessThanOrEqual(25);
    expect(MAX_CHECK_ATTEMPTS).toBeGreaterThan(3);
  });
});
