/**
 * No client code renders unsanitised HTML.
 *
 * The Nova guide used to build its chat bubbles as an HTML string and hand
 * them to `dangerouslySetInnerHTML`; a model reply — or a user's own message
 * echoed back — carrying `<img src=x onerror=...>` ran in every visitor's
 * session. That was fixed by routing every message through `formatMessage`
 * (client/src/lib/nova-format.ts), which builds React nodes with
 * `createElement`, so text can never become markup. Nothing stopped the next
 * person from reaching for the string again.
 *
 * This is that stop. Every HTML sink in client/src has to be listed here with
 * a reason someone wrote down, which means adding one is a decision rather
 * than an afternoon's convenience. Without the guard, the next raw-HTML
 * render in production is a stored XSS on whatever text feeds it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const CLIENT = join(import.meta.dirname, "..", "..", "client", "src");

/*
 * The sinks. `dangerouslySetInnerHTML` is the React one; the three DOM ones
 * are how the same hole gets dug outside JSX, usually in a ref callback or a
 * one-off effect. All of them take a string and parse it as markup.
 */
const SINKS: { name: string; pattern: RegExp }[] = [
  { name: "dangerouslySetInnerHTML", pattern: /dangerouslySetInnerHTML/ },
  { name: "innerHTML assignment", pattern: /\.innerHTML\s*=(?!=)/ },
  { name: "outerHTML assignment", pattern: /\.outerHTML\s*=(?!=)/ },
  { name: "insertAdjacentHTML", pattern: /\.insertAdjacentHTML\s*\(/ },
];

/*
 * The allowlist. One entry per file, each with the reason it is safe — not
 * "it's vendored" or "it's been there a while", but why the interpolated
 * values cannot carry anything a user typed. An entry with no such reason
 * doesn't belong here; delete the sink instead.
 */
const ALLOWED: Record<string, string> = {
  "components/ui/chart.tsx":
    "shadcn's chart wrapper writes a <style> block of CSS custom properties. " +
    "Everything interpolated into it is authored in code, not received: the " +
    "selector id is `chart-` plus either a literal `id` prop or React's own " +
    "useId with colons stripped, and each `--color-<key>: <value>` pair comes " +
    "from the `config` object a developer passes to <ChartContainer>. No " +
    "request, route param or API response reaches it — and the file has no " +
    "call sites at all today (asserted below), so there is nowhere for user " +
    "data to enter. If a chart is ever configured from server data, this " +
    "entry stops being true: the keys and colours would need escaping first.",
};

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|jsx)$/.test(name) ? [p] : [];
});

const files = walk(CLIENT).map((path) => ({
  rel: relative(CLIENT, path).split("\\").join("/"),
  content: readFileSync(path, "utf8"),
}));

describe("no unsanitised HTML in the client", () => {
  it("finds every HTML sink in the allowlist, with a written reason", () => {
    const offenders = files.flatMap((f) =>
      SINKS.filter((s) => s.pattern.test(f.content) && !(f.rel in ALLOWED)).map((s) => `${f.rel}: ${s.name}`),
    );
    expect(offenders, [
      "A client file renders a string as HTML. Text that reaches one of these",
      "sinks stops being text: <script>, an onerror attribute or a javascript:",
      "href all execute. Render React nodes instead (see lib/nova-format.ts for",
      "the pattern), or — if markup is genuinely required — sanitise it and add",
      "the file to ALLOWED in this test with the reason it cannot carry user input.",
    ].join(" ")).toEqual([]);
  });

  it("keeps the allowlist honest — no entries for files that no longer use a sink", () => {
    /*
     * A stale entry is a licence nobody reviewed: the sink gets removed, the
     * reason stays, and the next person to add one back inherits an approval
     * that was written about different code.
     */
    const stale = Object.keys(ALLOWED).filter((rel) => {
      const f = files.find((x) => x.rel === rel);
      return !f || !SINKS.some((s) => s.pattern.test(f.content));
    });
    expect(stale, "Allowlisted files that no longer render HTML — delete the entry.").toEqual([]);
  });

  it("the one allowlisted file is still uncalled, so its config can't come from user data", () => {
    /*
     * The chart allowlist rests on the config being written by hand. The
     * moment someone mounts <ChartContainer> the argument needs re-checking,
     * so make mounting it fail here rather than silently inherit the reason.
     */
    const callers = files.filter((f) => f.rel !== "components/ui/chart.tsx" && /ChartContainer|ChartStyle|components\/ui\/chart/.test(f.content)).map((f) => f.rel);
    expect(callers, [
      "components/ui/chart.tsx is allowlisted for dangerouslySetInnerHTML only",
      "because nothing renders it. If you're using it now, check where the chart",
      "config comes from: keys and colours are interpolated into a <style> block",
      "unescaped, so a key from server data is a script tag waiting to happen.",
      "Then update the ALLOWED reason to say what you checked.",
    ].join(" ")).toEqual([]);
  });
});
