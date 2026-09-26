/**
 * Things that exist in the code and are not ready for people yet.
 *
 * The editor bridge — the MCP tokens that connect VS Code, Claude Code or
 * Cursor to Nova — works well enough to demonstrate and not well enough to
 * hand to somebody who will then depend on it. Offering it anyway costs more
 * than hiding it: a person who connects their editor, builds a session's work
 * around it and watches it misbehave does not conclude "that one feature is
 * early", they conclude the product is unreliable.
 *
 * So the entry points say "coming soon" instead, which is the honest version
 * of the same message and sets no expectation that is about to be broken.
 *
 * ## Why a flag rather than deleting the screens
 *
 * Because the work is nearly there, and deleting a nearly-finished feature
 * means writing it twice. One constant switched to `true` brings back every
 * entry point at once, and there is exactly one place to look for what is
 * hidden and why.
 *
 * ## What this deliberately does not do
 *
 * It does not turn off the API. Anyone who already connected an editor keeps
 * working, and — more importantly — keeps being able to revoke the token they
 * already have. Hiding the screen that lists somebody's live credentials would
 * leave them holding access they can see no way to withdraw, which is a worse
 * problem than the one this solves. `server/surfaces.ts` has the `mcp` kill
 * switch for the day the API itself needs to stop.
 */

/** Flip to `true` when the editor bridge is ready for people to rely on. */
export const EDITOR_BRIDGE_READY = false;

/** What every hidden entry point says, so they cannot drift apart. */
export const COMING_SOON = "Coming soon";
export const EDITOR_BRIDGE_SOON =
  "Connecting VS Code, Claude Code or Cursor to Nova is nearly ready — we're finishing it off before opening it up.";
