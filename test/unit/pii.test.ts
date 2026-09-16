/**
 * Personal data that's sealed before it's stored: a home address, a phone
 * number. The sealed form must be unreadable, the round trip exact, and a row
 * written before sealing must still read back — otherwise deploying this would
 * turn every existing address into null and break fulfilment.
 */
import { describe, it, expect } from "vitest";
import { openPii, sealPii } from "../../server/pii";

const address = { line1: "12 Example Street", line2: "Flat 3", city: "Lisbon", postalCode: "1100-001", country: "PT", name: "Casey Builder" };

describe("sealed personal data", () => {
  it("stores nothing readable, and comes back exactly as it went in", () => {
    const sealed = sealPii(address)!;
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("Example Street");
    expect(sealed).not.toContain("Lisbon");
    expect(openPii(sealed)).toEqual(address);
    // A string value (a phone number) round-trips as a string, not as JSON.
    const phone = sealPii("+351 912 345 678")!;
    expect(phone).not.toContain("912");
    expect(openPii(phone)).toBe("+351 912 345 678");
  });

  it("reads a row written before any of this existed", () => {
    // jsonb object, as the column used to hold it.
    expect(openPii(address)).toEqual(address);
    // A plain text column.
    expect(openPii("+351 912 345 678")).toBe("+351 912 345 678");
  });

  it("treats nothing as nothing, rather than sealing a blank", () => {
    expect(sealPii(null)).toBeNull();
    expect(sealPii(undefined)).toBeNull();
    expect(sealPii("")).toBeNull();
    expect(sealPii("   ")).toBeNull();
    expect(openPii(null)).toBeNull();
    expect(openPii(undefined)).toBeNull();
  });

  it("returns nothing for a sealed value it can't open, rather than a guess", () => {
    // Tampered ciphertext (a rotated SESSION_SECRET looks the same way).
    const sealed = sealPii(address)!;
    const broken = `${sealed.slice(0, -4)}AAAA`;
    expect(openPii(broken)).toBeNull();
  });
});
