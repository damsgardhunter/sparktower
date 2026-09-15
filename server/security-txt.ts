/**
 * /.well-known/security.txt (RFC 9116): where a researcher who found a hole
 * finds out how to tell us. Served by a route rather than from the static
 * folder, because the static server ignores dot-directories and the dev server
 * would hand back the web app instead.
 *
 * `Expires` is required by the RFC and deliberately fixed: a stale file is a
 * sign nobody is reading the inbox. test/integration/security-txt.test.ts fails
 * a month before it lapses, which is the reminder to check the contacts and
 * move the date on. SECURITY.md carries the full policy.
 */
import type { Express } from "express";

export const SECURITY_CONTACT_EMAIL = "security@sparktower.app";
export const SECURITY_TXT_EXPIRES = "2027-09-01T00:00:00.000Z";

export function securityTxt(): string {
  return [
    `Contact: mailto:${SECURITY_CONTACT_EMAIL}`,
    "Contact: https://github.com/damsgardhunter/sparktower/security/advisories/new",
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    "Preferred-Languages: en",
    "Canonical: https://sparktower.app/.well-known/security.txt",
    "Policy: https://github.com/damsgardhunter/sparktower/blob/main/SECURITY.md",
    "",
  ].join("\n");
}

export function registerSecurityTxt(app: Express) {
  app.get("/.well-known/security.txt", (_req, res) => {
    res.type("text/plain; charset=utf-8").set("Cache-Control", "public, max-age=86400").send(securityTxt());
  });
  // The RFC's legacy location.
  app.get("/security.txt", (_req, res) => res.redirect(301, "/.well-known/security.txt"));
}
