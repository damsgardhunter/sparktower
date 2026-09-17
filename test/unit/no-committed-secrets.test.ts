/**
 * Nothing in this repository is shaped like a credential.
 *
 * Not because a fake key is dangerous — the one this replaced was
 * `sk_live_abcd1234…`, which nobody could mistake for real — but because every
 * scanner, every audit and every new reader has to stop and prove that, one at
 * a time, forever. A test that needs a key-shaped value builds it from parts
 * (test/helpers/fake-secrets.ts), so the prefix never sits next to a body in a
 * committed line and there is nothing to rule out.
 *
 * This runs the same detector the codebase audit runs, over every tracked file.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "fs";
import { execSync } from "child_process";
import { detectSecrets } from "../../server/code-digest";
import { FAKE_STRIPE_LIVE_KEY, FAKE_STRIPE_TEST_KEY, fakeWebhookSecret } from "../helpers/fake-secrets";

const tracked = () => execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter((p) => p && existsSync(p) && statSync(p).isFile())
  .map((path) => ({ path, content: readFileSync(path, "utf8"), size: statSync(path).size }));

describe("committed credentials", () => {
  it("are nowhere in the repository, tests included", () => {
    const found = detectSecrets(tracked() as any);
    // Each entry is a file and what it looks like — fix the file, don't relax this.
    expect(found).toEqual([]);
  });

  it("gives tests a key-shaped value that no scanner can mistake for one", () => {
    // Right shape for the code under test…
    expect(FAKE_STRIPE_LIVE_KEY).toMatch(/^sk_live_/);
    expect(FAKE_STRIPE_TEST_KEY).toMatch(/^sk_test_/);
    expect(fakeWebhookSecret("x")).toMatch(/^whsec_/);
    // …and built at runtime, so the file that defines them holds no such literal either.
    const helper = readFileSync("test/helpers/fake-secrets.ts", "utf8");
    expect(helper).not.toMatch(/sk_live_\w/);
    expect(helper).not.toMatch(/sk_test_\w/);
    expect(helper).not.toMatch(/whsec_\w/);
    // And the detector agrees the helper is clean.
    expect(detectSecrets([{ path: "test/helpers/fake-secrets.ts", content: helper, size: helper.length }] as any)).toEqual([]);
  });

  it("would still catch a real one", () => {
    // The guard is only worth having if it fails when it should: a key-shaped literal in a file.
    const planted = `const key = "${["sk", "live", "51H8vQ2eZvKYlo2C0aBcDeFgHiJkLmNoPq"].join("_")}";`;
    expect(detectSecrets([{ path: "server/payments.ts", content: planted, size: planted.length }] as any).length).toBeGreaterThan(0);
  });
});
