/**
 * Push, as far as it can be checked without a phone.
 *
 * Three different things here, and the middle one is why the file exists.
 *
 * **Which kinds push.** A list in `shared/notifications.ts`, held to being a
 * strict subset with the two deliberate exclusions named, so that neither
 * "everything pushes" nor "nothing does" can arrive by accident.
 *
 * **The app's wiring.** The phone cannot import `@shared` — Metro will not
 * resolve the alias — so every constant and interface on it is a copy that
 * drifts silently. Worse here than elsewhere: push has no screen to look wrong.
 * A token that is never registered, a `data` key the server stopped sending, a
 * sign-out that forgets the device *after* dropping the session — each of those
 * typechecks, runs, and simply means nobody is ever told anything.
 *
 * **The dependencies and the config.** `expo-notifications` with no plugin
 * entry builds an app whose Android notifications have no icon, and a missing
 * EAS project id means no token can be issued at all.
 */
import { describe, it, expect } from "vitest";
import { readSource, withoutComments } from "../helpers/source-parity";
import { NOTIFICATION_KINDS } from "@shared/schema";
import { PUSHABLE_KINDS, isPushableKind } from "@shared/notifications";

/**
 * One exported function's body, by brace depth.
 *
 * A claim about what a function does has to be checked against that function. A
 * file-wide `toContain` passes on the same words appearing anywhere else in the
 * file, which is exactly how a guard can be deleted with the test still green.
 */
function fnBody(source: string, name: string): string {
  const at = source.search(new RegExp(`(export )?(async )?function ${name}\\b`));
  expect(at, `${name} is gone from that source`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

const push = readSource("mobile/src/push.ts");
const hook = readSource("mobile/src/hooks/usePush.ts");
const auth = readSource("mobile/src/auth/AuthContext.tsx");
const offer = readSource("mobile/src/components/PushOffer.tsx");

describe("which notifications earn a buzz", () => {
  it("is a strict subset of the kinds that exist", () => {
    for (const kind of PUSHABLE_KINDS) expect(NOTIFICATION_KINDS).toContain(kind);
    expect(PUSHABLE_KINDS.length).toBeGreaterThan(0);
    expect(
      PUSHABLE_KINDS.length,
      "if everything pushes, people turn push off and the ones that mattered stop arriving too",
    ).toBeLessThan(NOTIFICATION_KINDS.length);
  });

  it("buzzes for the three things worth interrupting somebody over", () => {
    /* Needs an answer, is money, or is time-boxed. */
    for (const kind of ["connection_request", "season_invite", "project_application"]) expect(isPushableKind(kind)).toBe(true);
    for (const kind of ["pledge_received", "pledge_refunded", "campaign_decision"]) expect(isPushableKind(kind)).toBe(true);
    for (const kind of ["job_due", "checkin_due", "sim_nudge", "nova_build_done"]) expect(isPushableKind(kind)).toBe(true);
  });

  it("leaves acknowledgements in the bell", () => {
    for (const kind of ["post_reaction", "comment_reaction", "follow", "project_follow", "followed_post", "path_step_done"]) {
      expect(isPushableKind(kind), `${kind} is an acknowledgement and should not interrupt anybody`).toBe(false);
    }
  });

  it("keeps the two exclusions that look like oversights", () => {
    /*
     * Both are deliberate and both are argued for in the list's own comment.
     * Asserted here so that flipping either is a decision somebody makes rather
     * than a tidy-up: being turned down should not arrive on a lock screen, and
     * a permission adjusted inside a company can wait.
     */
    expect(isPushableKind("application_accepted")).toBe(true);
    expect(isPushableKind("application_rejected")).toBe(false);
    expect(isPushableKind("company_added")).toBe(true);
    expect(isPushableKind("company_powers")).toBe(false);
  });

  it("has no duplicates", () => {
    expect(new Set(PUSHABLE_KINDS).size).toBe(PUSHABLE_KINDS.length);
  });
});

describe("the phone's side of it", () => {
  it("calls every route the server offers, and no other", () => {
    const routes = [...withoutComments(readSource("server/push-routes.ts"))
      .matchAll(/app\.\w+\("(\/api\/push[^"]*)"/g)].map((m) => m[1]);
    expect(new Set(routes)).toEqual(new Set(["/api/push/token", "/api/push/state"]));

    const app = withoutComments(push + hook + offer);
    for (const route of routes) expect(app, `nothing on the phone calls ${route}`).toContain(route);
  });

  it("registers on every launch, not once", () => {
    /*
     * An Expo push token can be reissued — a restored backup, a reinstall — and
     * a stale one is an address that reaches nobody while everything looks
     * fine. The hook runs registration whenever the signed-in person changes,
     * and the server upserts, so repeating it is free.
     */
    const code = withoutComments(hook);
    expect(code).toContain("registerForPush");
    expect(code, "registration should be keyed on who is signed in").toMatch(/\[userId\]/);
  });

  it("never asks for permission as a side effect of launching", () => {
    /*
     * iOS allows the dialog once. A "no" is permanent until somebody finds the
     * switch in Settings, which they do not — so asking has to come from a tap,
     * and the launch path must only ever *check*.
     */
    expect(withoutComments(hook), "the launch hook must not request permission").not.toContain("requestPermissions");
    expect(withoutComments(hook)).toContain("pushPermission");
    /* Asking lives in askForPush, which only the offer card calls. */
    expect(withoutComments(push)).toContain("requestPermissionsAsync");
    expect(withoutComments(offer)).toContain("askForPush");
  });

  it("tells the server to forget the device before dropping the session", () => {
    /*
     * Order is the whole point: forgetting a device is an authenticated request,
     * so doing it after `apiLogout` sends an unauthenticated call that quietly
     * does nothing and leaves the phone registered to somebody who has signed
     * out of it.
     */
    const signOut = withoutComments(auth).match(/const signOut = useCallback\([\s\S]*?\}, \[forgetEverything\]\);/);
    expect(signOut, "signOut has moved").not.toBeNull();
    const body = signOut![0];
    expect(body).toContain("forgetPush");
    expect(body).toContain("apiLogout");
    expect(
      body.indexOf("forgetPush"),
      "forgetPush must come first, while the session still exists",
    ).toBeLessThan(body.indexOf("apiLogout"));
  });

  it("reads the same data keys the server sends", () => {
    /* The phone's copy of the push payload, against what notify() builds. */
    const server = withoutComments(readSource("server/notifications.ts"));
    const sent = server.match(/data:\s*\{([^}]*)\}/);
    expect(sent, "notify() no longer attaches data to a push").not.toBeNull();
    const keys = [...sent![1].matchAll(/(\w+):/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(["actorId", "href"]);
    for (const key of keys) expect(withoutComments(hook), `the phone ignores data.${key}`).toContain(key);
  });

  it("sends a tap to the same screen the inbox row goes to", () => {
    /*
     * `appHref` is the inbox's own mapping from the web's href to a screen here,
     * and it is already tested against the web's URLs. Reimplementing it for
     * push would be a second mapping to keep in step.
     */
    const code = withoutComments(hook);
    expect(code).toContain("appHref");
    expect(code, "a notification about something the phone has no screen for opens the web page").toContain("openWebSignedIn");
  });

  it("handles the notification that launched the app, which no listener sees", () => {
    /*
     * A tap on a notification while the app is not running is delivered once,
     * before any listener exists. Without this it is dropped and the app opens
     * on whatever screen it was last on — the single most visible way push can
     * feel broken.
     */
    expect(withoutComments(hook)).toContain("getLastNotificationResponseAsync");
  });

  it("shows a foreground notification rather than swallowing it", () => {
    expect(withoutComments(push)).toContain("setNotificationHandler");
  });

  it("creates an Android channel, without which the OS drops the notification", () => {
    expect(withoutComments(push)).toContain("setNotificationChannelAsync");
  });

  it("does not try to register a simulator, which has no push service", () => {
    /*
     * Scoped to the function, not the file. `Device.isDevice` also appears in
     * `pushPermission`, so a file-wide check passes with the guard taken out of
     * the one place it stops a confusing error — which is how a test of mine
     * passed with the behaviour removed.
     */
    const body = fnBody(push, "registerForPush");
    expect(body).toContain("Device.isDevice");
    const asking = fnBody(push, "askForPush");
    expect(asking, "and asking must not produce a dialog on something that cannot receive").toContain("Device.isDevice");
  });

  it("offers permission on the one screen where it makes sense", () => {
    const tab = withoutComments(readSource("mobile/app/(tabs)/notifications.tsx"));
    expect(tab, "the offer belongs where somebody can see what they would have missed").toContain("<PushOffer />");
  });

  it("puts the account-level switch in Settings", () => {
    const settings = withoutComments(readSource("mobile/app/settings.tsx"));
    expect(settings).toContain("<PushSettingsRow />");
  });
});

describe("the build", () => {
  it("has the dependencies, in the app and not in the server", () => {
    const mobile = JSON.parse(readSource("mobile/package.json"));
    expect(mobile.dependencies["expo-notifications"]).toBeTruthy();
    expect(mobile.dependencies["expo-device"]).toBeTruthy();

    /*
     * The server talks to Expo over fetch. `expo-server-sdk` would be a
     * dependency for chunking and a regex, and would not do the part that
     * actually needs care — reading the receipts.
     */
    const server = JSON.parse(readSource("package.json"));
    expect({ ...server.dependencies, ...server.devDependencies }["expo-server-sdk"]).toBeUndefined();
  });

  it("registers the config plugin, so Android has an icon to draw", () => {
    const app = JSON.parse(readSource("mobile/app.json"));
    const entry = app.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-notifications");
    expect(entry, "expo-notifications is installed but not in app.json's plugins").toBeTruthy();
    expect(entry[1].icon, "Android draws a silhouette; with no icon it draws nothing useful").toBeTruthy();
    expect(entry[1].color).toBeTruthy();
  });

  it("still has the EAS project id a token cannot be issued without", () => {
    const app = JSON.parse(readSource("mobile/app.json"));
    expect(app.expo.extra?.eas?.projectId).toBeTruthy();
    expect(withoutComments(push), "and the app has to pass it to Expo").toContain("projectId");
  });
});
