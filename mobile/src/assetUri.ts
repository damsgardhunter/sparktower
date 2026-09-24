/**
 * What the API said, turned into something the phone can fetch.
 *
 * Every picture in the product is stored as a path — `/objects/uploads/<id>`
 * — and returned that way: logos, avatars, covers, post media, anything Nova
 * drew. A browser resolves that against the page it came from, so the web app
 * puts it straight into an <img> and it works. React Native has no page to
 * resolve against, and `<Image source={{ uri: "/objects/uploads/x" }} />`
 * renders nothing: not a broken-image icon, not an error, just blank space.
 * That is how the app went so long with no logos, no covers and no profile
 * pictures anywhere, while the same account looked fine on the web.
 *
 * Its own file rather than a line in ui.tsx, because a pure function living
 * inside a module full of JSX is a pure function nothing can test.
 */
import { API_URL } from "./api/client";

/**
 * The widths the server keeps a copy at (server/image-derivatives.ts, and
 * shared/image-size.ts for the web). Restated here because Metro can't resolve
 * the @shared alias; test/unit/mobile-restatements.test.ts fails when the two
 * lists drift, because asking for a width the server doesn't build gets the
 * full-size original back without saying so.
 */
export const IMAGE_WIDTHS = [96, 256, 640, 1280] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];

/**
 * `width` asks the server for a copy that fits the space it is drawn in. An
 * avatar in a 34-point circle is a 96-pixel file rather than whatever came off
 * somebody's phone, which on a phone is the difference between a list that
 * appears and one that fills in over a few seconds of somebody's data.
 */
export const assetUri = (uri?: string | null, width?: ImageWidth): string | null => {
  if (!uri) return null;
  if (/^https?:\/\//.test(uri) || uri.startsWith("data:")) return uri;
  const absolute = `${API_URL}${uri.startsWith("/") ? "" : "/"}${uri}`;
  if (!width || !uri.startsWith("/objects/")) return absolute;
  return `${absolute}${absolute.includes("?") ? "&" : "?"}w=${width}`;
};
