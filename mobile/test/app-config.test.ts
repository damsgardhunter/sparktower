/**
 * The app config a native build is actually made from.
 *
 * Three features in this app only work because of something in `app.json`, and all
 * three fail *silently* when it is missing — the build succeeds, ships, and the
 * feature does nothing:
 *
 *  - **Push** needs `extra.eas.projectId`. Without it `getExpoPushTokenAsync`
 *    cannot issue a token at all, so no device ever registers and no notification
 *    is ever sent to anybody.
 *  - **Saving a picture to the camera roll** needs `expo-media-library`'s
 *    `savePhotosPermission`. Without the string iOS has nothing to show in the
 *    dialog and refuses the save.
 *  - **Choosing a photo to upload** needs `expo-image-picker`'s `photosPermission`,
 *    for the same reason — which has bitten this project once already.
 *
 * And a config-schema error fails `expo-doctor`, which is the check that tells you
 * a build is going to behave unexpectedly: `newArchEnabled` sat in here after SDK
 * 53 removed it, so that check failed on every run and stopped being read.
 *
 * `app.config.js` is evaluated rather than the JSON read, because the config a
 * build uses is its output: it drops any plugin whose module is not installed, and
 * a dropped plugin is exactly this failure with no error anywhere.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const here = (p: string) => resolve(import.meta.dirname, "..", p);
const req = createRequire(here("package.json"));

/** The config as a build sees it: app.config.js, evaluated. */
const resolved = (() => {
  const make = req("../mobile/app.config.js") as () => Record<string, any>;
  return make();
})();

const plugins: (string | [string, Record<string, any>])[] = resolved.plugins ?? [];
const named = (name: string) => plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);
const options = (name: string): Record<string, any> | null => {
  const found = named(name);
  return Array.isArray(found) ? found[1] : null;
};

describe("the config a build is made from", () => {
  it("carries the EAS project id, without which no push token can be issued", () => {
    expect(resolved.extra?.eas?.projectId, "push registration is impossible without this").toBeTruthy();
  });

  it("names both store identities", () => {
    expect(resolved.ios?.bundleIdentifier).toBe("com.sparktower.app");
    expect(resolved.android?.package).toBe("com.sparktower.app");
  });

  it("has no property the schema rejects", () => {
    /*
     * One failing schema check makes `expo-doctor` useless, because a check that is
     * always red is a check nobody reads. `newArchEnabled` is the one that was here:
     * removed from the schema in SDK 53 when the New Architecture became the
     * default, so setting it was both invalid and redundant.
     */
    expect("newArchEnabled" in resolved, "removed from the config schema in SDK 53").toBe(false);
  });
});

describe("the plugins the native features need", () => {
  /** Each module that must be listed, and the option that makes it work. */
  const REQUIRED = [
    {
      module: "expo-notifications",
      why: "the Android notification icon; without it a notification arrives as a white square",
      options: ["icon", "color"],
    },
    {
      module: "expo-media-library",
      why: "the iOS add-to-photos permission string; without it saving a picture is refused",
      options: ["savePhotosPermission"],
    },
    {
      module: "expo-image-picker",
      why: "the iOS photo-library permission string; without it the picker is refused",
      options: ["photosPermission"],
    },
    { module: "expo-apple-authentication", why: "the Sign in with Apple entitlement", options: [] },
    { module: "expo-secure-store", why: "where the session tokens live", options: [] },
    { module: "expo-router", why: "the whole navigation tree", options: [] },
    { module: "expo-splash-screen", why: "otherwise a build opens on a blank white screen", options: ["image"] },
  ] as const;

  for (const entry of REQUIRED) {
    it(`lists ${entry.module} — ${entry.why}`, () => {
      expect(named(entry.module), `${entry.module} is not in the resolved plugins`).toBeTruthy();
      for (const option of entry.options) {
        const value = options(entry.module)?.[option];
        expect(value, `${entry.module} needs ${option}: ${entry.why}`).toBeTruthy();
      }
    });
  }

  it("drops nothing, because every plugin it names is installed", () => {
    /*
     * `app.config.js` filters out any `expo-*` plugin whose module cannot be
     * resolved, and warns. That exists so a mid-install checkout can still run
     * Expo commands — but on a machine that *has* installed, a dropped plugin means
     * a build missing a permission string with nothing but a warning to say so.
     */
    const declared = (JSON.parse(readFileSync(here("app.json"), "utf8")).expo.plugins ?? [])
      .map((p: unknown) => (Array.isArray(p) ? p[0] : p));
    const kept = plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    expect(kept, "app.config.js dropped a plugin, so a module is not installed").toEqual(declared);
  });

  it("asks for nothing it does not use", () => {
    /*
     * An unused permission is a question at review with no good answer. Reading
     * somebody's photo library is deliberately off on media-library — the app only
     * ever adds to it — and the camera is off on image-picker, since nothing here
     * takes a picture.
     */
    expect(options("expo-media-library")?.photosPermission).toBe(false);
    expect(options("expo-image-picker")?.cameraPermission).toBe(false);
  });
});

describe("the modules those plugins come from", () => {
  it("are all installed, at a version the SDK expects", () => {
    /*
     * `expo install --check` is the authority on the versions and runs in CI's
     * mobile job; this is the narrower thing a test can state — that the module
     * behind every plugin resolves at all, so none of them can be filtered out.
     */
    for (const name of plugins.map((p) => (Array.isArray(p) ? p[0] : p))) {
      if (typeof name !== "string" || !name.startsWith("expo-")) continue;
      expect(() => req.resolve(name), `${name} is named in app.json but not installed`).not.toThrow();
    }
  });
});
