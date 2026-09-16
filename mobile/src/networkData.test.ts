/** A web notification link opens the matching screen in the app, keeping where it points inside it. */
import { describe, it, expect } from "vitest";
import { appHref } from "./networkData";

describe("appHref", () => {
  it("keeps the manager's section, tab and focus", () => {
    expect(appHref("/projects/p1/manage?section=raise_funding&tab=nova&focus=FUND.M1.2", "u1")).toBe("/manage/p1?section=raise_funding&tab=nova&focus=FUND.M1.2");
    expect(appHref("/projects/p1/manage", "u1")).toBe("/manage/p1");
    expect(appHref("/projects/p1/manage?tab=team#x", "u1")).toBe("/manage/p1?tab=team");
  });
  it("still maps everything else", () => {
    expect(appHref("/posts/abc", "u1")).toBe("/post/abc");
    expect(appHref("/projects/p1", "u1")).toBe("/project/p1");
    expect(appHref("/profile/u2", "u1")).toBe("/user/u2");
    expect(appHref(null, "u1")).toBe("/user/u1");
  });
});
