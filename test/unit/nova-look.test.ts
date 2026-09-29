/**
 * The Nova look stays one thing.
 *
 * This product got one screen right — the Codebase tab — and the shape of it
 * then spread by copy and paste: the gradient was written out by hand in four
 * files, the live dot twice, the staged progress bar twice and already
 * diverging. That is how a design system dies before it exists, and none of it
 * shows up as a broken build.
 *
 * So this reads the source. It is not a style opinion; it is the one rule that
 * keeps the opinion enforceable — there is a single definition of each of
 * these, and new screens import it rather than retyping it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..", "..", "client", "src");
const KIT = join(root, "components", "nova");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};

const sources = walk(root)
  .filter((p) => /\.tsx?$/.test(p))
  .map((p) => ({ path: p.slice(root.length + 1), body: readFileSync(p, "utf8") }));

/** Files inside the kit itself are where these things are allowed to be defined. */
const outsideKit = sources.filter((f) => !join(root, f.path).startsWith(KIT));

describe("the gradient", () => {
  it("is defined once, in the kit", () => {
    const defines = outsideKit.filter((f) => /(?:const|let)\s+NOVA_GRADIENT\s*=/.test(f.body));
    expect(
      defines.map((f) => f.path),
      "re-export it from components/nova/tokens.ts instead of writing the classes out again",
    ).toEqual([]);
  });

  /*
   * Inline uses are not banned — a keyline, a chip and a blurred glow each want
   * the colours in a different Tailwind shape, and forcing those through one
   * constant would be worse. What is pinned is the count: it only goes down
   * from here, and a new one has to be a deliberate edit to this number with a
   * reason. docs/ui-consistency.md lists which files they are.
   */
  it("is inlined in no more files than the ones already listed as needing conversion", () => {
    const inline = outsideKit.filter((f) => /from-green-400 via-emerald-500 to-purple-500/.test(f.body));
    expect(inline.length, `files still writing the gradient by hand:\n  ${inline.map((f) => f.path).join("\n  ")}`)
      .toBeLessThanOrEqual(6);
  });
});

describe("the live dot and the progress bar", () => {
  it("are not re-implemented outside the kit", () => {
    const dots = outsideKit.filter((f) => /function LiveDot\b/.test(f.body));
    expect(dots.map((f) => f.path), "import { LiveDot } from '@/components/nova'").toEqual([]);
  });

  /**
   * The ping belongs to the live dot.
   *
   * One exception, and it is a real one: the path strip's "Here" marker is a
   * position on a map, not a status light — a ring around a hollow pin with a
   * label under it. Forcing it through LiveDot would mean a LiveDot with a
   * hole in it, which is how a shared component turns into a pile of props
   * nobody can read.
   */
  const NOT_A_STATUS_LIGHT = ["components/section-path-strip.tsx"];

  it("has one animate-ping, in the live dot", () => {
    const pings = outsideKit
      .filter((f) => /animate-ping/.test(f.body))
      .filter((f) => !NOT_A_STATUS_LIGHT.includes(f.path));
    expect(
      pings.map((f) => f.path),
      "a pinging ring is the live dot; use <LiveDot /> so 'live' looks the same everywhere",
    ).toEqual([]);
  });
});

describe("the kit itself", () => {
  it("says what the machine is doing rather than only that something is", () => {
    const working = readFileSync(join(KIT, "working.tsx"), "utf8");
    // The three things a spinner refuses to answer, all present.
    expect(working).toContain("aria-live");
    expect(working).toMatch(/stages/);
    expect(working).toMatch(/meta/);
  });

  it("keeps 'nobody checked' visually apart from 'this is broken'", () => {
    const pill = readFileSync(join(KIT, "pill.tsx"), "utf8");
    const unknown = pill.match(/unknown:\s*"([^"]+)"/)?.[1] ?? "";
    const bad = pill.match(/bad:\s*"([^"]+)"/)?.[1] ?? "";
    expect(unknown).not.toBe(bad);
    // Blue and dashed, not red: an unanswered question is not a failure.
    expect(unknown).toContain("dashed");
    expect(unknown).not.toContain("rose");
  });
});
