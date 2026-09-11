/**
 * The drafts a message opens with. They're the whole point of the composer —
 * an empty box is where a new connection stalls — so what they say is worth
 * pinning down: the match reason when there is one, and never a paragraph.
 */
import { describe, it, expect } from "vitest";
import { messageTemplates } from "../../client/src/lib/message-templates";
import { messageTemplates as mobileTemplates } from "../../mobile/src/messageTemplates";

describe("messageTemplates", () => {
  it("opens with why Nova matched you, as the end of a sentence", () => {
    const [opener, short] = messageTemplates({ name: "Bea Builder", reason: "You both ship MVPs in public." });
    expect(opener.body).toBe("Hi Bea — Nova matched us because you both ship MVPs in public. Would you be up for a quick call this week to swap notes?");
    expect(short.body).toBe("Hey Bea! Want to do a quick feedback swap on what we're each shipping?");
  });

  it("leans on the topic for the short one", () => {
    expect(messageTemplates({ name: "Cai", reason: "Raising a pre-seed round" })[1].body).toBe("Hey Cai! Happy to trade feedback on each other's pitch?");
    expect(messageTemplates({ name: "Cai", reason: "Loves design systems" })[1].body).toBe("Hey Cai! What are you working on right now?");
  });

  it("falls back to what they're building, then to hello", () => {
    expect(messageTemplates({ name: "Dee", headline: "Building a habit tracker" })[0].body).toContain('"Building a habit tracker" caught my eye');
    expect(messageTemplates({ name: "Dee" })[0].id).toBe("hello");
  });

  it("keeps a long reason to a sentence", () => {
    const [opener] = messageTemplates({ name: "Eli", reason: "x".repeat(400) });
    expect(opener.body.length).toBeLessThan(260);
    expect(opener.body).toContain("…");
  });
});

describe("the mobile copy", () => {
  // Mobile can't import the web module, so it carries its own. This is what
  // stops the two from quietly drifting: same inputs, same drafts, or it fails.
  it("says exactly what the web version says", () => {
    const subjects = [
      { name: "Bea Builder", reason: "You both ship MVPs in public." },
      { name: "Cai", reason: "Raising a pre-seed round" },
      { name: "Cai", reason: "Loves design systems" },
      { name: "Dee", headline: "Building a habit tracker" },
      { name: "Dee" },
      { name: "  ", reason: "x".repeat(400) },
    ];
    for (const subject of subjects) expect(mobileTemplates(subject)).toEqual(messageTemplates(subject));
  });
});
