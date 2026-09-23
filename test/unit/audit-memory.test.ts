/**
 * An area is re-read only when its bytes have changed.
 *
 * The fingerprint is the whole safety argument. Wrong in one direction it
 * costs a re-read nobody needed; wrong in the other it reports a verdict
 * about code that no longer exists, which is the one thing an audit must
 * never do. So these tests are mostly about what *must* invalidate it.
 */
import { describe, it, expect } from "vitest";
import { fingerprintOf } from "../../server/audit-memory";

const f = (path: string, text: string) => ({ path, text });

describe("what an area remembers", () => {
  it("is the same for the same files, whatever order they arrive in", () => {
    const a = fingerprintOf([f("a.ts", "one"), f("b.ts", "two")]);
    const b = fingerprintOf([f("b.ts", "two"), f("a.ts", "one")]);
    expect(a).toBe(b);
  });

  it("changes when a file's content changes", () => {
    const before = fingerprintOf([f("a.ts", "one"), f("b.ts", "two")]);
    expect(fingerprintOf([f("a.ts", "one!"), f("b.ts", "two")])).not.toBe(before);
  });

  it("changes when a file joins or leaves the selection", () => {
    const base = [f("a.ts", "one"), f("b.ts", "two")];
    expect(fingerprintOf([...base, f("c.ts", "three")])).not.toBe(fingerprintOf(base));
    expect(fingerprintOf([f("a.ts", "one")])).not.toBe(fingerprintOf(base));
  });

  it("changes when content moves between files, not just within them", () => {
    /*
     * The obvious cheap hash — concatenate everything and hash once — treats
     * these as identical, because the bytes are the same overall. They are
     * not: which file a mechanism lives in is half of what an audit reports.
     */
    const a = fingerprintOf([f("a.ts", "alpha"), f("b.ts", "beta")]);
    const b = fingerprintOf([f("a.ts", "beta"), f("b.ts", "alpha")]);
    expect(a).not.toBe(b);
  });

  it("is not fooled by a path that contains the separator", () => {
    // Two different selections that a naive join would render identically.
    const a = fingerprintOf([f("a", "x"), f("b", "y")]);
    const b = fingerprintOf([f("a\u0000b", "x"), f("", "y")]);
    expect(a).not.toBe(b);
  });

  it("is stable across calls, so a repeat audit actually hits it", () => {
    const files = [f("server/routes.ts", "a".repeat(1000)), f("shared/schema.ts", "b".repeat(1000))];
    expect(fingerprintOf(files)).toBe(fingerprintOf(files));
  });

  it("has a fingerprint for reading nothing, rather than throwing", () => {
    expect(typeof fingerprintOf([])).toBe("string");
    expect(fingerprintOf([])).not.toBe(fingerprintOf([f("a.ts", "")]));
  });
});
