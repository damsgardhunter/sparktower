/**
 * Nova chat messages are rendered as React nodes, not HTML. A message carrying
 * markup — from the model, or a user's own message echoed back — must come out
 * as visible text, with only **bold** and line breaks turned into elements.
 */
import { describe, it, expect } from "vitest";
import { Fragment, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMessage } from "@/lib/nova-format";

const render = (s: string) => renderToStaticMarkup(createElement("div", null, formatMessage(s)));

describe("Nova message formatting", () => {
  it("keeps markup as text", () => {
    const html = render(`<img src=x onerror="alert(1)"> and <script>alert(2)</script>`);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=");
  });

  it("still renders bold, bullets and line breaks", () => {
    expect(render("**Next:** ship it\n- one\n- two")).toBe("<div><strong>Next:</strong> ship it<br/>• one<br/>• two</div>");
  });

  it("doesn't let markup ride inside bold", () => {
    expect(render("**<b onclick=x>hi</b>**")).toBe("<div><strong>&lt;b onclick=x&gt;hi&lt;/b&gt;</strong></div>");
  });
});

/*
 * Regression coverage for the actual bug. Nova's bubbles were once built as an
 * HTML string, so any of these payloads arriving in a model reply — or in a
 * user's own message echoed back into the transcript — executed. The tests
 * above check the rendered markup; these check the React tree itself, which is
 * the stronger statement: renderToStaticMarkup escaping a string proves React
 * escaped it on the way out, while walking the tree proves the payload never
 * became an element or a prop in the first place. A future formatter that
 * returns, say, an <a> built from a link's href would pass the markup tests
 * and fail these.
 *
 * The formatter's whole grammar is **bold**, "- " bullets and newlines (see
 * lib/nova-format.ts) — no code spans, no links — so those are the wrappers a
 * payload can hide in.
 */
type Walked = { types: string[]; propNames: string[]; text: string };

/** Every element type, every prop name and all the literal text in the tree. */
function walk(node: ReactNode, into: Walked = { types: [], propNames: [], text: "" }): Walked {
  if (node === null || node === undefined || typeof node === "boolean") return into;
  if (typeof node === "string" || typeof node === "number") { into.text += String(node); return into; }
  if (Array.isArray(node)) { for (const child of node) walk(child, into); return into; }
  if (isValidElement(node)) {
    const { type, props } = node as ReactElement<Record<string, unknown>>;
    into.types.push(type === Fragment ? "Fragment" : typeof type === "string" ? type : "component");
    for (const name of Object.keys(props)) if (name !== "children") into.propNames.push(name);
    walk((props as { children?: ReactNode }).children ?? null, into);
    return into;
  }
  // Anything else (a portal, an iterable) would be a formatter we don't understand.
  throw new Error(`unexpected node in formatMessage output: ${String(node)}`);
}

const tree = (s: string) => walk(formatMessage(s));

/** Only these can ever appear. A payload that became markup shows up as a new type. */
const ALLOWED_TYPES = ["Fragment", "br", "strong"];

const PAYLOADS: [name: string, payload: string][] = [
  ["a script tag", `<script>alert(1)</script>`],
  ["an onerror attribute", `<img src=x onerror=alert(1)>`],
  ["a javascript: link", `<a href="javascript:alert(document.cookie)">click</a>`],
  ["an svg onload", `<svg/onload=alert(1)>`],
  // The same payloads inside each piece of syntax the formatter does act on.
  ["a script tag inside bold", `**<script>alert(1)</script>**`],
  ["an onerror image in a bullet", `here:\n- <img src=x onerror=alert(1)>`],
  ["a link split across lines", `<a href="javascript:alert(1)">\nclick</a>`],
];

describe("Nova formatting: XSS payloads stay text", () => {
  for (const [name, payload] of PAYLOADS) {
    it(`renders ${name} as literal text, never as an element`, () => {
      const { types, propNames, text } = tree(payload);

      // Nothing new was constructed: no <script>, <img>, <a> or <svg> element.
      expect(types.filter((t) => !ALLOWED_TYPES.includes(t))).toEqual([]);

      // And no attribute either — onerror, onload, src and href are all props,
      // so an empty prop list is the proof that none of them got through.
      expect(propNames.filter((p) => p !== "key")).toEqual([]);

      /*
       * The payload survives intact as text. Two things are being asserted at
       * once: it wasn't executed, and it wasn't silently swallowed — a
       * formatter that stripped tags would be safe but would be quietly
       * eating the user's words, and we'd want to know.
       */
      for (const line of payload.split("\n")) {
        expect(text).toContain(line.replace(/\*\*/g, "").replace(/^- /, "• "));
      }
    });
  }

  it("never yields an href or any other URL-bearing prop", () => {
    // A link is the payload that doesn't look like markup: `javascript:` in an
    // href executes on click with no tag of its own.
    const { propNames, text } = tree(`[click](javascript:alert(1)) and <a href='javascript:alert(2)'>x</a>`);
    expect(propNames.filter((p) => p !== "key")).toEqual([]);
    expect(text).toContain("javascript:alert(1)");
    expect(text).toContain("javascript:alert(2)");
  });

  it("keeps bold working, so the escaping isn't just 'formats nothing'", () => {
    // The guard above is only meaningful if the formatter still does its job:
    // a formatMessage that returned the input verbatim would pass everything.
    const { types, text } = tree("**Next:** <b>ship</b>");
    expect(types).toContain("strong");
    expect(text).toContain("<b>ship</b>");
  });
});
