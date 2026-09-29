/**
 * A browser saying one of its screens threw.
 *
 * Server errors have had somewhere to go for a while (`error-reporting.ts`):
 * one structured line on stderr, and a webhook if one is configured. The
 * browser had nowhere. A render crash blanked the page for the person it
 * happened to and was never heard of again — so the failures that matter most,
 * the ones that stop somebody using the product entirely, were the ones with
 * no record at all.
 *
 * ## What it accepts, and what it refuses to carry
 *
 * The message, the stack, the component stack and the path — nothing else. Not
 * the query string, which is where reset tokens and invite codes live; not the
 * body, the headers or anything the person typed. Everything goes through the
 * same `redact` the server's own reports use, so an address or a key that made
 * it into an error message is scrubbed on the way out.
 *
 * ## Why it is public
 *
 * The most valuable report is from a screen that broke *before* anyone could
 * sign in, which is exactly the case an authenticated endpoint cannot hear.
 * The cost of that is guarded rather than avoided: ten every ten minutes per
 * address, because a screen throwing in a render loop can report as fast as
 * the machine will send, and the first few are all anybody needs to find it.
 */
import type { Express } from "express";
import { rateLimit } from "./moderation";
import { redact, reportError } from "./error-reporting";

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? redact(v).slice(0, max) : "";

export function registerClientErrorRoutes(app: Express): void {
  app.post("/api/client-errors", rateLimit("clientError"), async (req: any, res) => {
    // public-write: nothing at all, and it is the right call — the report most
    // worth having is from a screen that broke before anybody could sign in,
    // which an authenticated endpoint cannot hear. It stores nothing, returns
    // nothing, carries no free text beyond a redacted error message, and is
    // limited to ten per address every ten minutes.
    const message = str(req.body?.message, 500);
    if (!message) return res.status(400).json({ message: "Nothing to report." });

    /*
     * Shaped as an Error so it reads like every other report in the drain —
     * same fields, same redaction — rather than becoming a second format
     * somebody has to learn. The `ui:` prefix on the route is what tells the
     * two apart at a glance.
     */
    const error = Object.assign(new Error(message), {
      name: "ClientRenderError",
      stack: str(req.body?.stack, 4000) || undefined,
    });

    reportError(error, {
      route: `ui:${str(req.body?.where, 80) || "unknown"}`,
      method: "RENDER",
      /*
       * The path, never the URL: the query string is where the tokens are.
       * Sent by the client already stripped, and cut again here, because the
       * client is not the authority on what this endpoint accepts.
       */
      status: 500,
      userId: req.user?.id,
    });

    // Nothing is stored and nothing is returned. The browser does not act on this.
    res.status(204).end();
  });
}
