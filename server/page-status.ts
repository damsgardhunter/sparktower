/**
 * The status code the single-page shell is served with.
 *
 * Everything that isn't an API route falls through to index.html, and both
 * responders — the dev one in server/vite.ts and the built one in
 * server/static.ts — used to hard-code 200. That is right for the app's own
 * routes, whose content the browser fetches afterwards, and wrong for the one
 * kind of page rendered for people with no account: `/a/:id`. A link to an
 * artifact that was never published, or taken down, answered 200 with an empty
 * shell, so a crawler indexed it as a real page and a link checker called the
 * dead link healthy.
 *
 * A route that knows better sets `res.locals.pageStatus` on its way past. The
 * shell is served either way — the page explains itself to whoever followed
 * the link — and only the number changes.
 */
import type { Response } from "express";

export function pageStatus(res: Response): number {
  const asked = Number(res.locals.pageStatus);
  return Number.isInteger(asked) && asked >= 200 && asked < 600 ? asked : 200;
}
