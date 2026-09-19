/**
 * /.well-known/security.txt (RFC 9116): where a researcher who found a hole
 * finds out how to tell us. Served by a route rather than from the static
 * folder, because the static server ignores dot-directories and the dev server
 * would hand back the web app instead.
 *
 * `Expires` is required by the RFC and deliberately fixed: a stale file is a
 * sign nobody is reading the inbox. test/integration/security-txt.test.ts fails
 * a month before it lapses, which is the reminder to check the contacts and
 * move the date on.
 *
 * Every address here has to be reachable by a stranger, which is the whole
 * point of the file. It used to name a GitHub advisory form and SECURITY.md in
 * the repository; both stopped resolving for outsiders the moment the
 * repository went private, leaving a disclosure path that 404s — worse than
 * not publishing one, because a researcher who hits it concludes nobody is
 * listening. The policy is served by the app instead (/security), where its
 * reachability doesn't depend on a repository setting. SECURITY.md stays as
 * the copy for people working in the repository.
 */
import type { Express } from "express";

export const SECURITY_CONTACT_EMAIL = "security@sparktower.app";
export const SECURITY_TXT_EXPIRES = "2027-09-01T00:00:00.000Z";

export function securityTxt(): string {
  return [
    `Contact: mailto:${SECURITY_CONTACT_EMAIL}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    "Preferred-Languages: en",
    "Canonical: https://sparktower.app/.well-known/security.txt",
    "Policy: https://sparktower.app/security",
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
