/**
 * The rules of a sponsored challenge, without a database.
 *
 * The one worth the most attention is the deadline: nothing moves a challenge
 * out of "open" when its clock runs out, so every "can I still enter?" answer
 * has to come from comparing the deadline itself. A rule that read the status
 * alone would keep the door open forever.
 */
import { describe, it, expect } from "vitest";
import {
  acceptsEntries, canAnnounce, canCloseEntries, canEditChallenge, canJudge, checkDeadline, daysLeft,
  effectiveStatus, resultExcerpt, safeUrl, validateChallenge, validateEntry,
} from "@shared/challenges";

const NOW = Date.UTC(2026, 8, 19, 12);
const DAY = 86_400_000;
const good = {
  title: "Cut our returns rate",
  brief: "We ship furniture and a fifth of it comes back. Show us a way to cut that without cutting sales.",
  criteria: "Evidence it works on real customers.",
  prize: "$5,000 and a paid pilot",
  terms: "Winners are paid within 30 days of the announcement. Entrants keep their own IP unless a pilot is agreed.",
  industry: "E-Commerce",
  deadline: new Date(NOW + 30 * DAY).toISOString(),
};

describe("a new challenge", () => {
  it("accepts a well-formed one", () => {
    const r = validateChallenge(good, NOW);
    expect(r.ok).toBe(true);
  });

  it("holds each field to its length", () => {
    expect(validateChallenge({ ...good, title: "abc" }, NOW).ok).toBe(false);
    expect(validateChallenge({ ...good, title: "x".repeat(121) }, NOW).ok).toBe(false);
    expect(validateChallenge({ ...good, brief: "too short" }, NOW).ok).toBe(false);
    expect(validateChallenge({ ...good, terms: "" }, NOW).ok).toBe(false);
    expect(validateChallenge({ ...good, prize: "x".repeat(201) }, NOW).ok).toBe(false);
    expect(validateChallenge({ ...good, criteria: "x".repeat(2001) }, NOW).ok).toBe(false);
  });

  it("allows no industry, but not a made-up one", () => {
    expect(validateChallenge({ ...good, industry: undefined }, NOW).ok).toBe(true);
    expect(validateChallenge({ ...good, industry: "Space piracy" }, NOW).ok).toBe(false);
  });

  it("wants a deadline in the future and within a year", () => {
    expect(checkDeadline(new Date(NOW - 1000).toISOString(), NOW).ok).toBe(false);
    expect(checkDeadline(new Date(NOW + 366 * DAY).toISOString(), NOW).ok).toBe(false);
    expect(checkDeadline("not a date", NOW).ok).toBe(false);
    expect(checkDeadline(undefined, NOW).ok).toBe(false);
    expect(checkDeadline(new Date(NOW + 364 * DAY).toISOString(), NOW).ok).toBe(true);
  });

  it("an edit checks only what it sends", () => {
    const r = validateChallenge({ brief: good.brief + " More detail." }, NOW, { partial: true });
    expect(r.ok && Object.keys(r.value)).toEqual(["brief"]);
    expect(validateChallenge({ deadline: new Date(NOW - DAY).toISOString() }, NOW, { partial: true }).ok).toBe(false);
  });
});

describe("an entry", () => {
  const entry = { title: "Fit before you buy", pitch: "A room scanner that tells a customer whether the sofa fits before they order it, not after." };

  it("needs a title and a real pitch", () => {
    expect(validateEntry(entry).ok).toBe(true);
    expect(validateEntry({ ...entry, pitch: "short" }).ok).toBe(false);
    expect(validateEntry({ ...entry, title: "" }).ok).toBe(false);
  });

  it("takes only web links", () => {
    expect(validateEntry({ ...entry, link: "https://example.com/demo" }).ok).toBe(true);
    expect(validateEntry({ ...entry, link: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateEntry({ ...entry, link: "ftp://example.com" }).ok).toBe(false);
    expect(safeUrl("")).toBeNull();
  });
});

describe("where a challenge is", () => {
  const open = { status: "open", deadline: new Date(NOW + DAY) };
  const expired = { status: "open", deadline: new Date(NOW - 1) };

  it("stops taking entries at the deadline even while still marked open", () => {
    expect(acceptsEntries(open, NOW)).toBe(true);
    expect(acceptsEntries(expired, NOW)).toBe(false);
    expect(effectiveStatus(expired, NOW)).toBe("judging");
    expect(acceptsEntries({ status: "judging", deadline: new Date(NOW + DAY) }, NOW)).toBe(false);
  });

  it("is judged only in judging, edited only while open, announced once", () => {
    expect(canJudge("open")).toBe(false);
    expect(canJudge("judging")).toBe(true);
    expect(canJudge("closed")).toBe(false);
    expect(canEditChallenge("open")).toBe(true);
    expect(canEditChallenge("judging")).toBe(false);
    expect(canCloseEntries("judging")).toBe(false);
    expect(canAnnounce("judging")).toBe(true);
    expect(canAnnounce("closed")).toBe(false);
  });

  it("counts days left up, and never below zero", () => {
    expect(daysLeft(new Date(NOW + 1.5 * DAY), NOW)).toBe(2);
    expect(daysLeft(new Date(NOW - DAY), NOW)).toBe(0);
  });

  it("tells each entrant their own outcome", () => {
    expect(resultExcerpt("Acme", "Returns", "winner")).toContain("You won");
    expect(resultExcerpt("Acme", "Returns", "shortlisted")).toContain("shortlisted");
    expect(resultExcerpt("Acme", "Returns", "entered")).toContain("Not picked");
    expect(resultExcerpt("Acme", "Returns", "entered")).toContain("Acme");
  });
});
