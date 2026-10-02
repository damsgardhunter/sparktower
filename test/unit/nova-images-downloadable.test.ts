/**
 * Every picture the product draws can be taken away, on either client.
 *
 * All of it is paid for — a logo, the cover built from it, the five visuals drawn
 * from both, a storyboard frame, a backer badge — and none of it could be got off
 * the screen. The mechanism is one query parameter on the URL each image is
 * already served from, so this file's job is the boring half: that each surface
 * which *shows* a generated image also offers to save it, and that the phone's
 * copy of the naming rule has not drifted from the server's.
 *
 * The surfaces are listed by hand on purpose. A test that discovered them would
 * discover whatever exists and prove nothing; a list is a decision about what
 * counts, and a new generator added later has to be added here — which is the
 * moment to notice it needs a download too.
 */
import { describe, it, expect } from "vitest";
import { readSource, withoutComments } from "../helpers/source-parity";
import { downloadName } from "../../server/download-name";
import { fileName } from "../../mobile/src/imageFileName";

/** Each generator, the client file that shows its output, and what to look for. */
const SURFACES = [
  {
    what: "the logo and cover",
    web: "client/src/components/brand-kit-card.tsx",
    phone: "mobile/src/components/manage/Setup.tsx",
  },
  {
    what: "the five project-page visuals",
    web: "client/src/components/profile-visuals-button.tsx",
    phone: "mobile/src/components/manage/Setup.tsx",
  },
  {
    what: "a storyboard frame",
    web: "client/src/components/storyboard-slideshow.tsx",
    phone: "mobile/app/project/storyboards.tsx",
  },
  {
    what: "a backer badge preview",
    web: "client/src/components/badge-preview-card.tsx",
    /* No phone counterpart: setting up backing is a desk job and the previews live there. */
    phone: null,
  },
] as const;

describe("every generated image offers a way to keep it", () => {
  for (const surface of SURFACES) {
    it(`${surface.what} can be downloaded on the web`, () => {
      const code = withoutComments(readSource(surface.web));
      /*
       * Either the component or the url helper — the tiles use the helper
       * directly so the download matches the other actions in the hover wash.
       */
      expect(
        /DownloadImage|downloadUrl\(/.test(code),
        `${surface.web} shows a generated image and offers no download`,
      ).toBe(true);
    });

    if (surface.phone) {
      it(`${surface.what} can be saved on the phone`, () => {
        const code = withoutComments(readSource(surface.phone));
        expect(code, `${surface.phone} shows a generated image and offers no save`).toContain("SaveImage");
      });
    }
  }

  it("saves whatever the phone's lightbox has open", () => {
    /* One wiring point that covers any image somebody opened full-screen. */
    expect(withoutComments(readSource("mobile/src/components/ProjectPageTabs.tsx"))).toContain("SaveImage");
  });
});

describe("the two halves agree on what a file is called", () => {
  it("the phone's rule matches the server's, case for case", () => {
    /*
     * The real function, imported — not a regex over its source and not an eval
     * of it, which is what this did first and which could not parse TypeScript.
     * `mobile/src/imageFileName.ts` exists with no imports precisely so this
     * comparison can be the functions themselves.
     */
    const cases = [
      "Quill & Co — Logo", "Dana's Café", "  spaced  out  ", "", "日本語",
      "a--b", "-trim-", "../../etc/passwd", 'x"; filename="evil.exe', "x".repeat(400),
    ];
    for (const name of cases) {
      expect(fileName(name), `the two disagree about "${name}"`).toBe(downloadName(name, "png"));
    }
  });
});

describe("the web's link", () => {
  const helper = readSource("client/src/components/download-image.tsx");

  it("asks the server for an attachment rather than building a blob", () => {
    /*
     * A link means the browser does the progress, the downloads shelf and "Save
     * link as". Fetching into a blob and clicking a synthetic anchor is more code
     * that is worse at all three.
     */
    const code = withoutComments(helper);
    expect(code).toMatch(/params\.set\("download", "1"\)/);
    expect(code, "no blob plumbing").not.toMatch(/createObjectURL|new Blob/);
  });

  it("drops a width, so a saved logo is the file and not a tile", () => {
    expect(withoutComments(helper)).toContain('params.delete("w")');
  });

  it("does not open a tab that would sit there empty", () => {
    /*
     * An attachment response does not navigate, so `target="_blank"` opens a blank
     * tab that never closes — which is what makes a download look broken.
     */
    expect(withoutComments(helper)).not.toContain('target="_blank"');
  });
});

describe("the server", () => {
  const route = withoutComments(readSource("server/replit_integrations/object_storage/routes.ts"));

  it("only attaches when asked, or every avatar becomes a download", () => {
    expect(route).toMatch(/req\.query\?\.download === "1"/);
  });

  it("handles the storyboard frame that never became an object", () => {
    /*
     * An early scene is held inline as a data URL, so it never passes through the
     * objects route and needs the header set where it is sent.
     */
    const routes = withoutComments(readSource("server/routes.ts"));
    const scene = routes.match(/scenes\/:index\/image[\s\S]*?inlineImage[\s\S]{0,800}?Content-Disposition/);
    expect(scene, "an inline scene cannot be downloaded").not.toBeNull();
  });
});
