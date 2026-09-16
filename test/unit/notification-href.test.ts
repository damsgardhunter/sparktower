/**
 * Where a notification opens: path notifications go to the section their step
 * is on with the Next Step card in focus, the same link on web and mobile.
 */
import { describe, it, expect } from "vitest";
import { notificationHref, pathHref, PATH_FOCUS } from "@shared/notifications";
import { sectionOfTask } from "@shared/goals";

const base = { actorId: "u1", postId: null, projectId: "p1" } as const;

describe("path notification links", () => {
  it("land on the step's section, dashboard tab, focused", () => {
    expect(notificationHref({ ...base, kind: "path_step_done", section: "raise_funding", focus: PATH_FOCUS.next })).toBe("/projects/p1/manage?section=raise_funding&tab=nova&focus=next");
    expect(notificationHref({ ...base, kind: "next_step", section: "ship_mvp", focus: "SHIP.M1.2" })).toBe("/projects/p1/manage?section=ship_mvp&tab=nova&focus=SHIP.M1.2");
    expect(notificationHref({ ...base, kind: "weekly_update" })).toBe("/projects/p1/manage?tab=nova&focus=weekly");
    // Without a known section, the manager opens its remembered one — still on the card.
    expect(notificationHref({ ...base, kind: "path_step_done" })).toBe("/projects/p1/manage?tab=nova&focus=next");
    // A post always wins: feedback on a shared step opens the post.
    expect(notificationHref({ ...base, kind: "path_step_done", postId: "post1", section: "ship_mvp" })).toBe("/posts/post1");
    expect(pathHref("p9")).toBe("/projects/p9/manage?tab=nova&focus=next");
  });

  it("find a task's section from its tags", () => {
    expect(sectionOfTask(["backbone:FUND.M2.1"], "ship_mvp")).toBe("raise_funding");
    expect(sectionOfTask(["parent:SYS.M1.1", "actor:user-does"], "ship_mvp")).toBe("systemize_business");
    expect(sectionOfTask(["track:raise_funding", "backbone:SHIP.M1.1"], "ship_mvp")).toBe("raise_funding");
    expect(sectionOfTask(["injected:x"], "systemize_business")).toBe("systemize_business");
    expect(sectionOfTask(["custom"], "ship_mvp")).toBeNull();
  });
});
