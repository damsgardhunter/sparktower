/**
 * The audit's claims, checked against the repository before anyone reads them.
 *
 * Every sentence in here was said by this codebase's own audit about this
 * codebase, and every one of them was wrong in the same direction: something
 * the audit couldn't see became something that didn't exist. The examples are
 * kept verbatim because a paraphrase would be easier to catch than the real
 * thing.
 */
import { describe, it, expect } from "vitest";
import { buildClaimIndex, contradictions, correct, verifyFindings, sanitizeRisks, sanitizeMissing, downgradeUnreadCapabilities, noteUnreadRecommendations } from "../../server/audit-claims";
import { capabilityCounts, renderCapabilities, type CapabilityEntry } from "@shared/capabilities";

const index = buildClaimIndex(
  [
    { path: "server/artifact-routes.ts" },
    { path: "server/index.ts" },
    { path: "client/src/components/continue-path-card.tsx" },
    { path: "test/integration/path-return.test.ts" },
    { path: "docs/moderation-e2e.md" },
  ],
  [
    { method: "POST", path: "/api/artifacts/:id/publish", file: "server/artifact-routes.ts", mounted: true },
    { method: "POST", path: "/api/artifacts/:id/unpublish", file: "server/artifact-routes.ts", mounted: true },
    { method: "POST", path: "/api/projects/:id/path/tasks/:taskId/artifact", file: "server/artifact-routes.ts", mounted: true },
    { method: "PATCH", path: "/api/kanban/:taskId", file: "server/routes.ts", mounted: true },
    { method: "POST", path: "/api/planned/but/never/mounted", file: "server/draft.ts", mounted: false },
  ] as any,
);

describe("claims the repository contradicts", () => {
  it("catches the one that cost an afternoon", () => {
    const claim = "Step 3: artifact capture is referenced by the loop UI (PublishArtifactDialog calls POST /api/artifacts/:id/publish) and the loop writing names /api/artifacts/, but /api/artifacts/ is NOT REGISTERED anywhere in this repository.";
    const [found] = contradictions(claim, index);
    expect(found.claimed).toBe("/api/artifacts/");
    expect(found.found).toContain("2 routes are registered under it");
    expect(found.found).toContain("server/artifact-routes.ts");
  });

  it("answers a wildcard as the family it is", () => {
    const [found] = contradictions("the repository registers no /api/artifacts/* routes", index);
    expect(found.found).toContain("2 routes are registered under it");
  });

  it("corrects the route, not the file that merely mentions it", () => {
    // The file is the scene, not the subject. Annotating it is noise on top of a real finding.
    const claim = "Publishing is referenced in client/src/components/continue-path-card.tsx via POST /api/artifacts/:id/publish, but /api/artifacts/ is NOT REGISTERED in this repository.";
    const claimed = contradictions(claim, index).map((c) => c.claimed);
    expect(claimed).toContain("/api/artifacts/");
    expect(claimed).not.toContain("client/src/components/continue-path-card.tsx");
  });

  it("says a file exists when the audit says it couldn't see one", () => {
    // "Referenced but not present in the provided files" reads as "doesn't exist" to everyone.
    const [found] = contradictions(`"test/integration/path-return.test.ts" is referenced but not present in the provided files.`, index);
    expect(found.found).toBe("test/integration/path-return.test.ts is in the repository");
  });
});

describe("claims it leaves alone", () => {
  it("says nothing about a route that really isn't mounted", () => {
    expect(contradictions("POST /api/planned/but/never/mounted is not registered.", index)).toEqual([]);
    expect(contradictions("POST /api/nothing/like/this does not exist.", index)).toEqual([]);
  });

  it("doesn't touch judgement, only existence", () => {
    // Every one of these is a fair thing to say about a route that exists.
    for (const fair of [
      "POST /api/artifacts/:id/publish has no test naming it.",
      "POST /api/artifacts/:id/publish is not rate limited, which is a risk on a write.",
      "PATCH /api/kanban/:taskId is missing an authorisation check for non-members.",
      "server/artifact-routes.ts is thin on error handling.",
    ]) {
      expect(contradictions(fair, index), fair).toEqual([]);
    }
  });

  it("knows when the subject is a pronoun, not the nearest path", () => {
    // The things missing here are the environment variables, not the file.
    const claim = "Boot requirements are specified in docs (DATABASE_URL, SESSION_SECRET) but server/index.ts does not itself refuse to boot when they are missing.";
    expect(contradictions(claim, index)).toEqual([]);
  });

  it("keeps one sentence's claim out of another's", () => {
    const claim = "POST /api/artifacts/:id/publish is registered and tested. Separately, POST /api/nothing/here does not exist.";
    expect(contradictions(claim, index)).toEqual([]);
  });

  it("ignores prose with no claim in it at all", () => {
    expect(contradictions("The revenue loop closes through renewals.", index)).toEqual([]);
    expect(contradictions("", index)).toEqual([]);
    expect(contradictions(undefined, index)).toEqual([]);
  });
});

describe("what the builder ends up reading", () => {
  it("keeps the finding and attaches the fact", () => {
    const { text, corrections } = correct("/api/artifacts/ is NOT REGISTERED anywhere in this repository.", index);
    expect(corrections).toHaveLength(1);
    // The claim survives — it may be badly worded rather than wrong — with the check beside it.
    expect(text).toContain("NOT REGISTERED");
    expect(text).toContain("CHECKED AGAINST THE REPOSITORY");
    expect(text).toContain("Confirm before writing anything new.");
  });

  it("walks a whole findings object, wherever the claim is hiding", () => {
    const findings = {
      missing: [{ item: "Artifact publishing: /api/artifacts/ is NOT REGISTERED.", matters: "The growth loop can't close." }],
      capabilities: [{ area: "ai", detail: { gaps: [{ item: "POST /api/artifacts/:id/publish does not exist.", severity: "high" }], coverage: "fine" } }],
      loops: [{ breaksAt: "Step 3: /api/artifacts/* is NOT REGISTERED.", stages: [{ step: "Publish", status: "partial" }] }],
      nextThreeThings: ["Register the missing /api/artifacts/ routes."],
      // Untouched: not a claim field, and not a claim.
      repo: { name: "sparktower" },
    };
    const { corrected } = verifyFindings(findings, index);
    expect(corrected).toBeGreaterThanOrEqual(3);
    expect(findings.missing[0].item).toContain("CHECKED AGAINST THE REPOSITORY");
    expect(findings.capabilities[0].detail.gaps[0].item).toContain("CHECKED AGAINST THE REPOSITORY");
    expect(findings.loops[0].breaksAt).toContain("CHECKED AGAINST THE REPOSITORY");
    expect(findings.repo.name).toBe("sparktower");
  });
});

/**
 * The other half of the same failure: not a sentence that names something
 * present, but a verdict on files the audit never opened. Every case here is
 * one of this week's: a wedge that shipped, an admin loop with every route and
 * test in place, tables declared in shared/schema.ts — all reported missing by
 * an audit that had read a fraction of the tree.
 */
describe("what the audit did not read", () => {
  const caps = () => ([
    { area: "auth", status: "built", summary: "Passport sessions", evidence: [{ file: "server/index.ts" }] },
    { area: "payments", status: "missing", summary: "No payment provider found", evidence: [] },
    { area: "mobile", status: "missing", summary: "No app", evidence: [], note: "Earlier note." },
    { area: "tests", status: "partial", summary: "Some", evidence: [{ file: "server/index.ts" }] },
  ] as any as CapabilityEntry[]);

  it("holds a partial read's 'missing' as unknown, with the reason on the entry", () => {
    const { capabilities, downgraded } = downgradeUnreadCapabilities(caps(), { partial: true, fileCount: 900, readCount: 120 });
    const by = Object.fromEntries(capabilities.map((c) => [c.area, c]));
    expect(downgraded.map((d) => d.area).sort()).toEqual(["mobile", "payments"]);
    expect(by.payments.status).toBe("unknown");
    expect(by.payments.note).toMatch(/read 120 of 900 files/);
    expect(by.payments.note).toMatch(/not the same as it not being there/);
    // An existing note is kept, not replaced.
    expect(by.mobile.note).toMatch(/^Earlier note\./);
    // Verdicts about code that WAS read are untouched.
    expect(by.auth.status).toBe("built");
    expect(by.tests.status).toBe("partial");
  });

  it("leaves 'missing' alone when the whole codebase was read", () => {
    const { capabilities, downgraded } = downgradeUnreadCapabilities(caps(), { partial: false, fileCount: 900, readCount: 900 });
    expect(downgraded).toEqual([]);
    expect(capabilities.find((c) => c.area === "payments")!.status).toBe("missing");
  });

  it("never lets an unknown count as a gap", () => {
    const { capabilities } = downgradeUnreadCapabilities(caps(), { partial: true, fileCount: 900, readCount: 120 });
    const counts = capabilityCounts(capabilities);
    expect(counts.unknown).toBe(2);
    expect(counts.missing).toBe(0);
    // partial only: the two unknowns are questions, not outstanding work.
    expect(counts.gaps).toBe(1);
    // …and a later plan reading the inventory is told so in words.
    expect(renderCapabilities(capabilities)).toMatch(/UNKNOWN \(not found in what this audit read — NOT a gap/);
  });

  it("turns 'build it' into 'confirm whether it exists' for an area it could not read", () => {
    const findings: any = {
      nextThreeThings: ["Add Stripe checkout and a billing page", "Write the onboarding copy"],
      risks: [{ area: "Payments", finding: "No billing", recommendation: "Build subscription billing before launch." }],
      missing: [{ item: "Billing", matters: "Nothing charges anyone: there is no checkout." }],
    };
    const noted = noteUnreadRecommendations(findings, ["payments"]);
    expect(noted).toBe(3);
    expect(findings.nextThreeThings[0]).toMatch(/Confirm whether this exists first — Payments & billing is UNKNOWN in this audit, not missing/);
    // Untouched: it says nothing about the area the audit couldn't read.
    expect(findings.nextThreeThings[1]).toBe("Write the onboarding copy");
    expect(findings.risks[0].recommendation).toMatch(/could not read it|never covered it/);
    expect(noteUnreadRecommendations(findings, [])).toBe(0);
  });
});

/**
 * The three ways an absence claim used to get past this, all found by reading
 * the audits this project has already been given.
 */
describe("the ways absence was written that nothing checked", () => {
  it("catches a file named without its directory", () => {
    // "the artifact-routes.ts file does not exist" — the same claim as the one
    // with the path in front of it, and it used to sail through.
    const [found] = contradictions("The publish step has no handler: artifact-routes.ts does not exist.", index);
    expect(found?.claimed).toBe("artifact-routes.ts");
    expect(found?.found).toBe("server/artifact-routes.ts is in the repository");
  });

  it("catches the phrases whose subject comes after them", () => {
    for (const claim of [
      "There is no server/artifact-routes.ts in this project.",
      "I found no client/src/components/continue-path-card.tsx anywhere in the tree.",
      "No trace of test/integration/path-return.test.ts.",
      "Could not find such a file: server/index.ts",
    ]) {
      const [found] = contradictions(claim, index);
      expect(found, claim).toBeTruthy();
    }
  });

  it("does not read backwards from them, which would contradict every judgement", () => {
    /*
     * The name before "there is no" is where the audit looked, not what it
     * says is missing. Reading backwards would turn every honest finding about
     * a file that exists into a correction, which is the failure this whole
     * module is built to avoid.
     */
    for (const fine of [
      "In server/index.ts there is no check that refuses to boot when the bucket is unset.",
      "There is no rate limit on the publish route in server/artifact-routes.ts.",
      "I found no test naming docs/moderation-e2e.md.",
    ]) {
      expect(contradictions(fine, index), fine).toEqual([]);
    }
  });

  it("stays quiet on an ambiguous bare name", () => {
    // Two files called index.ts: the sentence doesn't say which, so this can't
    // know it is wrong, and a correction that might be wrong is not worth one
    // that is right.
    const ambiguous = buildClaimIndex(
      [{ path: "server/index.ts" }, { path: "client/src/index.ts" }, { path: "server/only-one.ts" }],
      [] as any,
    );
    expect(contradictions("index.ts does not exist", ambiguous)).toEqual([]);
    expect(contradictions("only-one.ts does not exist", ambiguous)).toHaveLength(1);
  });
});

/**
 * The two lists that asserted things and cited nothing — risks, and the
 * missing list — now held to the same standard as everything else on the page.
 */
describe("risks, held to the repository", () => {
  const real = (p: string) => ["server/artifact-routes.ts", "server/index.ts"].includes(p);

  it("drops a path that isn't there and says the risk cited nothing real", () => {
    const [risk] = sanitizeRisks(
      [{ area: "Security", severity: "high", finding: "Uploads are unauthenticated.", evidence: ["server/upload-handler.ts"], recommendation: "Guard it." }],
      real,
    );
    expect(risk.evidence, "a builder can't open a file that doesn't exist").toEqual([]);
    expect(risk.finding).toContain("server/upload-handler.ts");
    expect(risk.finding).toMatch(/not in this repository/);
  });

  it("will not let an unevidenced risk sort above one that names code", () => {
    const [unevidenced] = sanitizeRisks([{ severity: "high", finding: "X", evidence: ["nope.ts"] }], real);
    expect(unevidenced.severity, "high is what puts a finding at the top of the page").toBe("medium");
    const [evidenced] = sanitizeRisks([{ severity: "high", finding: "Y", evidence: ["server/index.ts"] }], real);
    expect(evidenced.severity).toBe("high");
    expect(evidenced.finding, "and a real one is left exactly as it was written").toBe("Y");
  });

  it("leaves a risk that cited nothing at all alone", () => {
    // "This project has no CI" cites no file because there is no file to cite.
    // That is a fair way to say it, and not the failure this guards against.
    const [risk] = sanitizeRisks([{ severity: "high", finding: "No CI pipeline runs the tests.", evidence: [] }], real);
    expect(risk.severity).toBe("high");
    expect(risk.finding).toBe("No CI pipeline runs the tests.");
  });
});

describe("the missing list, made falsifiable", () => {
  const real = (p: string) => p === "server/email.ts";

  it("keeps where it looked when the places are real", () => {
    const [entry] = sanitizeMissing(
      [{ item: "Password reset", matters: "Nobody locked out can get back in.", searched: ["server/email.ts", "the route list", "server/invented.ts"] }],
      real,
    );
    expect(entry.searched).toEqual(["server/email.ts", "the route list"]);
    expect(entry.matters, "nothing appended: it said where it looked").toBe("Nobody locked out can get back in.");
  });

  it("says on its face when it looked nowhere", () => {
    const [entry] = sanitizeMissing([{ item: "Password reset", matters: "It blocks sign-in recovery." }], real);
    expect(entry.searched).toEqual([]);
    expect(entry.matters).toMatch(/did not say where it looked/);
    expect(entry.item, "the finding itself is kept — it may well be right").toBe("Password reset");
  });
});

describe("the fields a claim can hide in", () => {
  it("reads the sentence a builder acts on, not only the one that states the finding", () => {
    const findings = {
      risks: [{ finding: "Publishing is unreachable.", recommendation: "Register POST /api/artifacts/:id/publish — no such endpoint today." }],
      security: { plan: [{ title: "Create server/index.ts, which is not present", fix: "Add a boot file." }] },
    };
    const { corrected } = verifyFindings(findings, index);
    expect(corrected, "recommendation and title were both unread until now").toBe(2);
    expect(findings.risks[0].recommendation).toMatch(/CHECKED AGAINST THE REPOSITORY/);
    expect(findings.security.plan[0].title).toMatch(/CHECKED AGAINST THE REPOSITORY/);
  });
});
