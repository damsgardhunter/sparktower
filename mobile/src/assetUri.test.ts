/**
 * Every picture in the app is a relative path until something makes it absolute.
 *
 * The server stores and returns `/objects/uploads/<id>` — a logo, an avatar, a
 * cover, a post's media, anything Nova drew. A browser resolves that against
 * the page it came from, so the web app can put it straight into an <img> and
 * it works. React Native has no page to resolve against: `<Image source={{ uri:
 * "/objects/uploads/x" }} />` renders nothing at all. Not a broken-image icon,
 * not an error — blank space, silently, which is why the app could go so long
 * showing no logos, no covers and no profile pictures anywhere.
 *
 * So `assetUri` is the one place that turns what the API said into something
 * the phone can fetch, and these are its rules.
 */
import { describe, it, expect } from "vitest";
import { assetUri } from "./assetUri";
import { API_URL } from "./api/client";

describe("assetUri", () => {
  it("makes the server's own paths absolute, which is the whole job", () => {
    expect(assetUri("/objects/uploads/abc123")).toBe(`${API_URL}/objects/uploads/abc123`);
  });

  it("copes with a path that arrives without its leading slash", () => {
    expect(assetUri("objects/uploads/abc123")).toBe(`${API_URL}/objects/uploads/abc123`);
  });

  it("leaves a URL that is already a URL alone", () => {
    // Google avatars, and anything else somebody's provider hosts.
    expect(assetUri("https://lh3.googleusercontent.com/a/x")).toBe("https://lh3.googleusercontent.com/a/x");
    expect(assetUri("http://localhost:5001/objects/x")).toBe("http://localhost:5001/objects/x");
  });

  it("leaves an inline image alone", () => {
    expect(assetUri("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("says nothing rather than something broken when there is no picture", () => {
    expect(assetUri(null)).toBeNull();
    expect(assetUri(undefined)).toBeNull();
    expect(assetUri("")).toBeNull();
  });
});
