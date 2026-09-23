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

export const assetUri = (uri?: string | null): string | null =>
  !uri ? null : /^https?:\/\//.test(uri) || uri.startsWith("data:") ? uri : `${API_URL}${uri.startsWith("/") ? "" : "/"}${uri}`;
