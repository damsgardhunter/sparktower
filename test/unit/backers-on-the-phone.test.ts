/**
 * The Backers tab on the phone, and the one thing it has that the web does not.
 *
 * The web tab came first because that is where the rest of the manager lives. But
 * a thank-you video is *recorded* on a phone, so the camera roll being one tap
 * away is what the feature was actually for — the web can only take a file
 * somebody has already moved across.
 *
 * What this holds is the shape of that, and the two mistakes that are easy to make
 * in it: a video route opened without a session, and an address rendered on a
 * screen the whole team can open.
 */
import { describe, it, expect } from "vitest";
import { readSource, withoutComments, withoutInterfaces } from "../helpers/source-parity";

const phone = readSource("mobile/src/components/manage/Backers.tsx");
const chrome = readSource("mobile/src/components/manage/SectionChrome.tsx");
const screen = readSource("mobile/app/manage/[id].tsx");
const web = readSource("client/src/components/manager/backers-tab.tsx");
const routes = readSource("server/backer-fulfilment-routes.ts");

describe("where it lives on the phone", () => {
  it("is a tab in the manager, declared and rendered", () => {
    /* A tab declared and not rendered opens on an empty screen. */
    expect(withoutComments(chrome)).toMatch(/value: "backers"/);
    expect(withoutComments(chrome), "the Tab union has to admit it").toMatch(/\| "backers"/);
    expect(withoutComments(screen)).toMatch(/tab === "backers"[\s\S]{0,80}<Backers/);
  });

  it("is open to the team, like the web's", () => {
    /*
     * Not `ownerOnly`, unlike Investors beside it. The route sends no email and no
     * address precisely so that this can be true.
     */
    const def = withoutComments(chrome).match(/\{[^}]*value: "backers"[^}]*\}/);
    expect(def, "the tab definition has moved").not.toBeNull();
    expect(def![0]).not.toContain("ownerOnly");
  });
});

describe("calling the same routes as the web", () => {
  it("reads the list, marks done, and undoes", () => {
    const declared = [...withoutComments(routes)
      .matchAll(/app\.\w+\("(\/api\/projects\/:id\/backing\/fulfilment[^"]*)"/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThanOrEqual(3);

    const code = withoutComments(phone);
    for (const path of declared) {
      const pattern = path.split("/").map((seg) =>
        seg.startsWith(":") ? "(?:\\$\\{[^}]*\\}|[\\w.-]+)" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/");
      expect(new RegExp(pattern).test(code), `the phone never calls ${path}`).toBe(true);
    }
  });

  it("picks the video from the camera roll, which is the point of being here", () => {
    const code = withoutComments(phone);
    expect(code).toMatch(/pickPhoto\(\{\s*videos:\s*true\s*\}\)/);
    expect(code, "and uploads it before naming it to the server").toContain("uploadFile(");
  });

  it("opens the video through the signed hand-off, not a bare URL", () => {
    /*
     * The video route requires a session and a browser opened from the app has
     * none, so `Linking.openURL` on it would have shown a 401 to the person who
     * recorded the thing. Every other phone-to-web link here goes through
     * `openWebSignedIn`, which trades the app's token for a web session first.
     */
    const code = withoutComments(phone);
    const watch = code.match(/label="Watch"[\s\S]{0,700}?testID=\{`watch-/);
    expect(watch, "the watch button has moved").not.toBeNull();
    expect(watch![0]).toContain("openWebSignedIn");
    expect(watch![0], "a relative path cannot resolve on a phone").toContain("API_URL");
    expect(watch![0]).not.toMatch(/Linking\.openURL/);
  });

  it("lets somebody mark a video done without attaching one", () => {
    /*
     * Deliberate on both clients: plenty of people will send the video another way
     * and still want the list to be true.
     */
    expect(withoutComments(phone)).toMatch(/assetPath: assetPath \?\? undefined/);
    expect(withoutComments(phone)).toMatch(/Mark done/);
  });
});

describe("what it does not show", () => {
  it("renders no address and no email, the same as the web", () => {
    /*
     * The whole team can open this. The route sends neither, so there is nothing
     * to filter — but a screen that reached for `.shippingAddress` would be a
     * screen expecting them back.
     */
    const code = withoutInterfaces(withoutComments(phone));
    expect(code).not.toMatch(/\.shippingAddress\b/);
    expect(code).not.toMatch(/\.email\b/);
    /* It does say whether one is on file, which is the thing worth chasing. */
    expect(code).toContain("hasShippingAddress");
  });

  it("names an anonymous backer and marks them, as the web does", () => {
    const code = withoutComments(phone);
    expect(code).toContain("anonymousOnWall");
  });
});

describe("the two halves agreeing", () => {
  it("order the list the same way: outstanding first", () => {
    /* The question is "what do I have to do today" on either screen. */
    for (const [name, source] of [["the web", web], ["the phone", phone]] as const) {
      const code = withoutComments(source);
      expect(code, `${name} does not separate the outstanding`).toMatch(/const outstanding = /);
      expect(code, `${name} does not keep the rest`).toMatch(/const settled = /);
    }
  });

  it("use the same words for a merch order's state", () => {
    /*
     * A phone saying "With the printer" where the web says something else about
     * the same order is the kind of difference somebody screenshots.
     */
    const statuses = ["queued", "submitted", "shipped", "failed", "canceled"] as const;
    const labelsOf = (source: string) => {
      const table = source.match(/MERCH[^=]*=\s*\{[\s\S]*?\n\};/);
      expect(table, "the merch table has moved").not.toBeNull();
      return Object.fromEntries(
        [...table![0].matchAll(/(\w+): \{ label: "([^"]+)"/g)].map((m) => [m[1], m[2]]),
      );
    };
    const onWeb = labelsOf(web);
    const onPhone = labelsOf(phone);
    for (const status of statuses) {
      expect(onPhone[status], `the phone has no label for ${status}`).toBeTruthy();
      expect(onPhone[status], `${status} reads differently on the two`).toBe(onWeb[status]);
    }
  });
});
