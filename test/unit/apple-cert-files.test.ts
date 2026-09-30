/**
 * The certificates the Apple receipt check trusts have to come from the folder
 * that holds them.
 *
 * ## What this is, and what it is not
 *
 * A security review flagged `server/apple-iap.ts` for "a request-derived file
 * path that can escape its folder". It is not one. The names come from
 * `readdirSync`, which returns base names from the filesystem, and the only
 * thing that route takes from a caller is the signed receipt — a string handed
 * to Apple's verifier that never reaches a filesystem call. There was no way in.
 *
 * The containment check exists anyway, and so does this, for two reasons worth
 * writing down rather than arguing in a review thread:
 *
 *   - these files are the trust anchors the entire receipt check rests on, and
 *     `objectStorage` applies the identical check to the paths that *are*
 *     caller-supplied, calling it belt and braces;
 *   - "readdirSync only returns base names" is a claim in a comment. This is
 *     the same claim as something that fails if it stops being true — if that
 *     listing is ever replaced by a configured directory, an environment
 *     variable or anything else a person can influence, the guard is already
 *     there and already tested.
 *
 * So these cases are deliberately impossible today. That is the point of them.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { certFilesIn } from "../../server/apple-iap";

const DIR = path.resolve("/tmp/apple-certs");

describe("which files the Apple receipt check will trust", () => {
  it("takes the certificates sitting in the folder", () => {
    expect(certFilesIn(["AppleRootCA-G3.cer", "AppleComputerRootCertificate.der"], DIR))
      .toEqual(["AppleRootCA-G3.cer", "AppleComputerRootCertificate.der"]);
  });

  it("ignores anything that is not a certificate", () => {
    expect(certFilesIn(["README.md", "notes.txt", ".DS_Store", "cert.cer.bak", ""], DIR)).toEqual([]);
  });

  it("refuses a name that climbs out of the folder", () => {
    const escapes = [
      "../secrets.cer",
      "../../etc/shadow.cer",
      "..%2Fsecrets.cer".replace("%2F", "/"),
      "subdir/evil.cer",
      "/etc/passwd.cer",
      "..\\windows\\evil.cer",
      ".",
      "..",
    ];
    for (const name of escapes) {
      expect(certFilesIn([name], DIR), `escaped the folder: ${name}`).toEqual([]);
    }
  });

  /*
   * The one that matters most if this ever stops being a fixed listing: a name
   * that looks ordinary and resolves somewhere else. Both halves of the check
   * are needed — the separator test catches it before resolution, and the
   * dirname test would catch it after.
   */
  it("refuses a climb hidden in the middle of a name", () => {
    expect(certFilesIn(["certs/../../root.cer"], DIR)).toEqual([]);
    expect(certFilesIn(["./../../root.der"], DIR)).toEqual([]);
  });

  it("keeps a name with dots in it that goes nowhere", () => {
    expect(certFilesIn(["Apple.Root.CA.G3.cer"], DIR)).toEqual(["Apple.Root.CA.G3.cer"]);
  });
});
