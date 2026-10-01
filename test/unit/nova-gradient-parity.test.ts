/**
 * The Nova gradient, on the web and on the phone.
 *
 * The outline the project manager is built from is three stops — green,
 * emerald, purple — defined twice: in `client/src/index.css` as `.nova-ring`,
 * and in `mobile/src/theme.ts` as three palette entries, because Metro cannot
 * resolve the web's `@shared` alias and React Native has no CSS to share.
 *
 * Two definitions of one brand colour is exactly the shape that drifts. It
 * drifts quietly, too: nothing breaks, nothing fails, the phone simply stops
 * being the same product as the website by a shade at a time, and the only
 * detection is somebody holding the two next to each other.
 *
 * So this is `mobile-restatements.test.ts` applied to a colour: read both
 * sides, fail when they disagree. It checks the values rather than the
 * mechanism — the web will always use a CSS gradient border and the phone will
 * always use a padded gradient view, and that difference is fine. What is not
 * fine is a different green.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(import.meta.dirname, "../..", p), "utf8");
const css = read("client/src/index.css");
const theme = read("mobile/src/theme.ts");

/**
 * The three stops in a `linear-gradient(90deg, …)` inside the named rule.
 *
 * Scanned rather than matched with a regex: the soft ring's stops are
 * `rgb(74 222 128 / 0.45)`, so the gradient's own closing bracket is not the
 * first one after it. An earlier version of this used a regex and read the soft
 * rule as a single stop with no alpha — which the test below caught, since it
 * knows what it is looking for.
 */
function webStops(rule: string): string[] {
  const block = new RegExp(String.raw`\.${rule}\s*\{([\s\S]*?)\n\}`).exec(css);
  expect(block, `${rule} is no longer in client/src/index.css`).toBeTruthy();
  const body = block![1];
  const at = body.indexOf("linear-gradient(90deg,");
  expect(at, `${rule} no longer carries a 90deg gradient`).toBeGreaterThanOrEqual(0);

  let depth = 0;
  let end = -1;
  for (let i = body.indexOf("(", at); i < body.length; i++) {
    if (body[i] === "(") depth++;
    else if (body[i] === ")" && --depth === 0) { end = i; break; }
  }
  expect(end, `${rule}'s gradient is not closed`).toBeGreaterThan(at);

  const inner = body.slice(body.indexOf("(", at) + 1, end).replace(/^\s*90deg\s*,/, "");
  /* Split on commas at depth zero, so a stop's own commas stay inside it. */
  const stops: string[] = [];
  let current = "";
  let d = 0;
  for (const ch of inner) {
    if (ch === "(") d++;
    if (ch === ")") d--;
    if (ch === "," && d === 0) { stops.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) stops.push(current.trim());
  return stops;
}

describe("the gradient the web and the phone both draw", () => {
  it("is the same three colours on both", () => {
    const web = webStops("nova-ring").map((c) => c.toLowerCase());
    expect(web, "the ring is three stops").toHaveLength(3);

    const phone = ["novaGreen", "novaEmerald", "novaPurple"].map((name) => {
      const m = new RegExp(`${name}:\\s*"(#[0-9a-fA-F]{6})"`).exec(theme);
      expect(m, `${name} is no longer in mobile/src/theme.ts`).toBeTruthy();
      return m![1].toLowerCase();
    });

    expect(phone, "the phone's Nova gradient has drifted from the web's").toEqual(web);
  });

  /*
   * Both palettes, because the phone resolves `colors` once from the system
   * scheme — so a value corrected in one palette and not the other is a
   * gradient that is right in daylight and wrong at night.
   */
  it("is the same in the phone's light and dark palettes", () => {
    for (const name of ["novaGreen", "novaEmerald", "novaPurple"]) {
      const found = [...theme.matchAll(new RegExp(`${name}:\\s*"(#[0-9a-fA-F]{6})"`, "g"))].map((m) => m[1].toLowerCase());
      expect(found.length, `${name} should be defined in both palettes`).toBe(2);
      expect(new Set(found).size, `${name} differs between light and dark`).toBe(1);
    }
  });

  /*
   * The quieter ring is the same gradient at 45%. The number is the design,
   * not an accident — a soft ring at a different alpha reads as a different
   * component rather than a quieter one.
   */
  it("fades to the same strength for secondary cards", () => {
    const soft = webStops("nova-ring-soft");
    const alphas = soft.map((c) => /\/\s*([\d.]+)\s*\)/.exec(c)?.[1]);
    expect(alphas, "the web's soft ring is three translucent stops").toEqual(["0.45", "0.45", "0.45"]);

    const box = read("mobile/src/components/feed/Box.tsx");
    const phoneAlphas = [...box.matchAll(/rgba\(\s*[\d\s,]+?,\s*([\d.]+)\s*\)/g)].map((m) => m[1]);
    expect(phoneAlphas.length, "the phone's soft ring is three translucent stops").toBeGreaterThanOrEqual(3);
    expect(new Set(phoneAlphas.slice(0, 3)), "the phone's soft ring is a different strength").toEqual(new Set(["0.45"]));
  });
});

/**
 * The path card wears it on both.
 *
 * Asked for on 2026-10-01: the gradient outline around the path sections on the
 * phone, which the web has had and the phone did not — it carried a flat border
 * tinted to 30% primary, the nearest a plain border gets.
 */
describe("the Continue your path card", () => {
  it("has the gradient outline on the web", () => {
    expect(read("client/src/components/continue-path-card.tsx")).toMatch(/nova-ring/);
  });

  it("has it on the phone too", () => {
    const card = read("mobile/src/components/feed/ContinuePathCard.tsx");
    expect(card, "the phone's path card should take the ring Box offers").toMatch(/ring="(nova|soft)"/);
  });
});
