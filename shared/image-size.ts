/**
 * Asking for a picture at the size it will be drawn.
 *
 * The server keeps one resized copy per width (server/image-derivatives.ts),
 * so a caller adds `?w=` and gets back a file that fits the space instead of
 * whatever came off somebody's phone. An avatar drawn 40 pixels across was a
 * four-megabyte photograph until this existed.
 *
 * Shared because the two clients have to ask for the same widths or each one
 * warms its own set of copies in the bucket, and because the list here has to
 * stay the list the server will build — asking for 300 gets the original back,
 * silently, which is the failure this file exists to keep visible.
 */

/** Kept in step with ALLOWED_WIDTHS in server/image-derivatives.ts. */
export const IMAGE_WIDTHS = [96, 256, 640, 1280] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];

/**
 * The same address with a width on it.
 *
 * Left alone when there is nothing to ask — no picture, or one hosted
 * somewhere else (a Google avatar), where the parameter would mean nothing and
 * might not even be ignored politely.
 */
export function sized(url: string | null | undefined, width: ImageWidth): string | null {
  if (!url) return null;
  if (!url.startsWith("/objects/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=${width}`;
}
