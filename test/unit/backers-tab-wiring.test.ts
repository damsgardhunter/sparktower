/**
 * The Backers tab, and the two things about it that are decisions rather than code.
 *
 * It is a tab in the manager's More menu, it is open to the whole team rather than
 * the owner alone, and it deliberately carries no email address and no postal
 * address — because the owner-only list in Settings exists for those, and this one
 * does not need them: Printful is handed the address directly.
 */
import { describe, it, expect } from "vitest";
import { readSource, withoutComments, withoutInterfaces } from "../helpers/source-parity";
import { MORE_TABS, isTabId } from "../../client/src/components/manager/tabs";
import { DIGITAL_REWARDS } from "@shared/backing";

const tab = readSource("client/src/components/manager/backers-tab.tsx");
const routes = readSource("server/backer-fulfilment-routes.ts");
const manager = readSource("client/src/pages/project-manager.tsx");

describe("where it lives", () => {
  it("is in the More menu, where it was asked for", () => {
    const def = MORE_TABS.find((t) => t.id === "backers");
    expect(def, "there is no Backers tab in MORE_TABS").toBeTruthy();
    expect(isTabId("backers")).toBe(true);
  });

  it("is open to the team, not only the owner", () => {
    /*
     * Recording thank-you videos is exactly the work a team splits up. Investors
     * beside it is owner-only; this is the deliberate difference, and the route
     * sends no personal data because of it.
     */
    expect(MORE_TABS.find((t) => t.id === "backers")?.ownerOnly).toBeFalsy();
    expect(withoutComments(routes), "the route should admit any project member").toContain("memberProject");
    expect(withoutComments(routes), "and not be gated on ownership").not.toMatch(/ownerId === (req\.user\.id|userId)\s*\)\s*\|\|\s*res\.status\(403/);
  });

  it("is behind the backing switch, so a project without backing never shows it", () => {
    expect(MORE_TABS.find((t) => t.id === "backers")?.surface).toBe("backing");
  });

  it("is actually rendered, not just listed", () => {
    /* A tab in the menu with no branch opens on an empty page. */
    expect(withoutComments(manager)).toMatch(/activeTab === "backers"[\s\S]{0,120}BackersTab/);
  });
});

describe("what it shows", () => {
  it("lists only the rewards a person has to go and do", () => {
    /*
     * The platform's own rewards are true the moment the pledge lands. On a to-do
     * list they would be items that can never be ticked, so the server filters on
     * `fulfilledBy` and the client renders what it is given.
     */
    const creatorKeys = DIGITAL_REWARDS.filter((r) => r.fulfilledBy === "creator").map((r) => r.key);
    expect(creatorKeys.sort()).toEqual(["early_access", "video_thankyou"]);
    expect(withoutComments(routes)).toMatch(/fulfilledBy === "creator"/);
    /* And the client has an icon for each, or one of them renders as a tick. */
    for (const key of creatorKeys) expect(tab, `no icon for ${key}`).toContain(key);
  });

  it("puts what is outstanding before the roll call", () => {
    /*
     * The question is "what do I have to do today". Sorted by who paid most, the
     * one person still waiting three weeks later sits behind thirty who are owed
     * nothing.
     */
    const code = withoutComments(tab);
    expect(code).toMatch(/const outstanding = /);
    expect(code.indexOf("outstanding-heading")).toBeLessThan(code.indexOf("settled-heading"));
  });

  it("says when, if and how merch is arriving", () => {
    /* Status, the date it went, and the tracking link — all three, or "how" is unanswered. */
    const code = withoutComments(tab);
    expect(code).toContain("trackingUrl");
    expect(code).toContain("submittedAt");
    expect(code, "a failed order should say why, not just that it failed").toContain("lastError");
    /* Every status the table can hold has a sentence, or one of them renders undefined. */
    const statuses = ["queued", "submitted", "shipped", "failed", "canceled"];
    for (const status of statuses) expect(code, `no label for ${status}`).toMatch(new RegExp(`${status}:`));
  });

  it("flags a shipping reward with no address, which is the one thing to chase", () => {
    expect(withoutComments(tab)).toContain("hasShippingAddress");
    expect(withoutComments(routes)).toMatch(/hasShippingAddress: !!row\.backing\.shippingAddress/);
  });
});

describe("what it deliberately does not show", () => {
  it("never asks for or renders an address or an email", () => {
    /*
     * The whole team can open this. The owner's list in Settings has both, behind
     * an owner-only route; this one does not send them at all, so there is nothing
     * to filter per role and nothing to leak by rendering the wrong field.
     */
    const serverCode = withoutComments(routes);
    expect(serverCode, "the route must not select an email").not.toMatch(/users\.email/);
    expect(serverCode, "nor put the address on the wire").not.toMatch(/shippingAddress: row\.backing\.shippingAddress/);

    const clientCode = withoutInterfaces(withoutComments(tab));
    expect(clientCode).not.toMatch(/\.email/);
    expect(clientCode, "the client has no address to render").not.toMatch(/\.shippingAddress\b/);
  });

  it("names a backer who is anonymous publicly, and marks them", () => {
    /*
     * Anonymity governs the public wall, not whether the person recording a video
     * knows who it is for. Hiding the name here would break fulfilment; showing it
     * without the marker would look like the promise was broken.
     */
    const code = withoutComments(tab);
    expect(code).toContain("anonymousOnWall");
    expect(code).toMatch(/anonymous publicly/);
  });
});

describe("the backer's side", () => {
  const credits = readSource("client/src/components/backer-credits.tsx");

  it("gives them somewhere to watch it", () => {
    /* A video the creator uploaded and nobody can play is a file in a bucket. */
    expect(withoutComments(credits)).toContain("/api/me/rewards");
    expect(withoutComments(credits)).toMatch(/<video/);
  });

  it("only on their own profile", () => {
    /* Somebody else's personal video is nobody else's business. */
    expect(withoutComments(credits)).toMatch(/isOwnProfile && rewards/);
  });

  it("lets them keep a copy", () => {
    expect(withoutComments(credits)).toContain("download=1");
  });
});
