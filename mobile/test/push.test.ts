/**
 * That the push module can be imported at all, in Node.
 *
 * `src/push.ts` calls `setNotificationHandler` at import time, which it has to:
 * a notification can arrive before any screen has mounted. The consequence is
 * that importing it — or importing anything that reaches it, which `AuthContext`
 * now does — executes a native call. Without the stand-ins in `test/stubs` that
 * is a crash during module loading, and the test that trips over it will be one
 * about something else entirely, failing with a message about Expo.
 *
 * So this is the canary. It is cheap, and it fails in the one place where the
 * cause is obvious.
 */
import { describe, it, expect } from "vitest";

describe("the push module, in Node", () => {
  it("imports without touching anything native", async () => {
    const mod = await import("../src/push");
    expect(typeof mod.registerForPush).toBe("function");
    expect(typeof mod.forgetPush).toBe("function");
    expect(typeof mod.askForPush).toBe("function");
  });

  it("declines a runner with no push service rather than erroring", async () => {
    const { pushPermission, registerForPush } = await import("../src/push");
    /*
     * `Device.isDevice` is false here, as it is on a simulator. The code treats
     * that as "unsupported" so the offer card stays hidden instead of asking for
     * something that cannot work.
     */
    expect(await pushPermission()).toBe("unsupported");
    expect(await registerForPush()).toBe(false);
  });
});
