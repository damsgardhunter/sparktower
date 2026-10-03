/**
 * The other half of the backer tab: what a backer sees of a reward that has
 * actually been delivered.
 *
 * The manager now lets a team record a thank-you video on a phone. Until this,
 * the person it was recorded *for* could only watch it on the web — the card
 * with the player lived in client/src/components/backer-credits.tsx and had no
 * native counterpart, so the app could take the video and not hand it over.
 *
 * Read against the source rather than rendered, like the rest of the mobile
 * parity suite: Metro will not resolve `@shared`, so every phone copy of a
 * web interface is a copy that can drift, and the test's job is to notice.
 *
 * Every assertion here is about *usage*, not presence. A field named in an
 * interface declaration is not a field anybody reads.
 */
import { describe, it, expect } from "vitest";
import { interfaceFields, readSource, withoutComments, withoutInterfaces } from "../helpers/source-parity";

const phone = readSource("mobile/src/components/ProfileBadges.tsx");
const web = readSource("client/src/components/backer-credits.tsx");
const save = readSource("mobile/src/saveImage.ts");
const routes = readSource("server/backer-fulfilment-routes.ts");

/** The body of `BackerCredits` on the phone, with comments stripped. */
const phoneCard = (() => {
  const from = phone.indexOf("export function BackerCredits");
  expect(from).toBeGreaterThan(-1);
  return withoutComments(withoutInterfaces(phone.slice(from)));
})();
const webCode = withoutComments(withoutInterfaces(web));

describe("a delivered reward, on the backer's own phone", () => {
  it("asks the route that says what was delivered", () => {
    expect(phoneCard).toContain("/api/me/rewards");
  });

  it("only on your own profile", () => {
    /*
     * The query is `enabled: isOwn`, and the list it feeds is gated again when
     * it is read. Either alone would be enough; both is the shape the web has,
     * and a note somebody wrote you is not for a stranger scrolling past.
     */
    const query = phoneCard.slice(phoneCard.indexOf("/api/me/rewards"));
    expect(query.slice(0, 200)).toMatch(/enabled:\s*isOwn/);
    expect(phoneCard).toMatch(/const delivered = isOwn \?/);
  });

  it("draws the card for a reward even when no pledge is listed", () => {
    /*
     * The bug this closes on both sides: `visible` leaves out a backing that
     * has converted to equity, so a backer whose only pledge converted saw the
     * card return null and the video with it.
     */
    for (const [name, code] of [["phone", phoneCard], ["web", webCode]] as const) {
      const guard = /if \(!data\?\.length && !visible\.length && !delivered\.length\) return null;/;
      expect(code, `${name} guard counts delivered rewards`).toMatch(guard);
    }
  });

  it("plays it through the signed-in hand-off, not a bare URL", () => {
    /*
     * The video route needs a session, and the in-app browser does not share
     * the app's token: opening the URL directly is a 401 where a video should
     * be. `Linking.openURL` would do exactly that.
     */
    expect(phoneCard).toContain("openWebSignedIn");
    expect(phoneCard).toMatch(/openWebSignedIn\(`\$\{API_URL\}\$\{r\.videoUrl\}`/);
    expect(phoneCard).not.toContain("Linking.openURL");
  });

  it("keeps a copy as a video, named with the extension the server sent", () => {
    const keep = phoneCard.slice(phoneCard.indexOf("saveFile({"));
    expect(keep.slice(0, 300)).toMatch(/kind:\s*"video"/);
    /* Without this the local file is named .mp4 and iOS refuses a .mov. */
    expect(keep.slice(0, 300)).toMatch(/extension:\s*r\.videoExt/);
  });

  it("restates the web's reward shape, and nothing the web does not send", () => {
    const phoneFields = interfaceFields(phone, "MyReward");
    const webFields = interfaceFields(web, "MyReward");
    /* `videoExt` is the one addition: a browser reads a file's type from the
     * response, a camera roll reads it from the name. */
    expect(phoneFields).toEqual([...webFields, "videoExt"].sort());
  });
});

describe("the server's side of it", () => {
  it("sends the extension the phone needs", () => {
    const handler = withoutComments(routes.slice(routes.indexOf('app.get("/api/me/rewards"')));
    expect(handler).toMatch(/videoExt:\s*videoExtension\(/);
  });

  it("does not hand the object path itself to the client", () => {
    const handler = withoutComments(
      routes.slice(routes.indexOf('app.get("/api/me/rewards"'), routes.indexOf("const VIDEO_EXTENSIONS")),
    );
    /* `assetPath` is read to decide whether there is a video; it is never a field. */
    expect(handler).not.toMatch(/assetPath:/);
  });

  it("allow-lists the extension rather than trusting whatever is in the path", () => {
    const fn = withoutComments(routes.slice(routes.indexOf("const VIDEO_EXTENSIONS")));
    expect(fn).toMatch(/VIDEO_EXTENSIONS\.includes\(/);
    expect(fn).toMatch(/: "mp4"/);
  });
});

describe("the save plumbing, now that it carries two kinds of file", () => {
  it("still exports saveImage, so no existing caller changed", () => {
    expect(save).toMatch(/export const saveImage = /);
    expect(save).toMatch(/saveFile\(\{ \.\.\.input, kind: "image" \}\)/);
  });

  it("offers the share sheet the file's own type", () => {
    /* Hardcoded image/png was fine while only pictures came through here; a
     * .mov offered as image/png opens in nothing. */
    expect(save).not.toContain('mimeType: "image/png", dialogTitle');
    expect(save).toMatch(/shareAsync\(uri, \{ mimeType, dialogTitle/);
  });

  it("names the thing it failed to save", () => {
    /* "Couldn't save that image" under a video is the kind of wrong wording
     * that makes somebody think they tapped the wrong button. */
    const body = withoutComments(save);
    expect(body).not.toMatch(/Couldn't save that image\./);
    expect(body).toMatch(/\$\{kind\.noun\}/);
  });
});
