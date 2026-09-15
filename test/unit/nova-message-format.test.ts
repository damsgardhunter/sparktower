/**
 * Nova chat messages are rendered as React nodes, not HTML. A message carrying
 * markup — from the model, or a user's own message echoed back — must come out
 * as visible text, with only **bold** and line breaks turned into elements.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
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
