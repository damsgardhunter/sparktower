/**
 * The rules for who may do what in a company: `hasPower` and `canActOn` from
 * shared/companies.ts, and `mayActOn`, the server's reading of the second one.
 */
import { describe, it, expect, vi } from "vitest";

// company-access imports the database; these rules never touch it.
vi.mock("../../server/db", () => ({ db: {} }));
import { hasPower, canActOn, COMPANY_PERMISSION_IDS } from "@shared/companies";
import { mayActOn } from "../../server/company-access";

const owner = { role: "owner" as const, permissions: [], userId: "o" };
const admin = { role: "admin" as const, permissions: [], userId: "a" };
const manager = { role: "member" as const, permissions: ["manage_team" as const], userId: "m" };
const plain = { role: "member" as const, permissions: [], userId: "p" };

describe("hasPower", () => {
  it("gives leaders everything and members only what they were given", () => {
    for (const p of COMPANY_PERMISSION_IDS) {
      expect(hasPower(owner, p)).toBe(true);
      expect(hasPower(admin, p)).toBe(true);
      expect(hasPower(plain, p)).toBe(false);
    }
    expect(hasPower({ role: "member", permissions: ["recruit"] }, "recruit")).toBe(true);
    expect(hasPower({ role: "member", permissions: ["recruit"] }, "scouting")).toBe(false);
    expect(hasPower(null, "recruit")).toBe(false);
  });
});

describe("canActOn", () => {
  it("keeps roles and the team power to leaders", () => {
    expect(canActOn(manager, plain, "role")).toBe(false);
    expect(canActOn(manager, null, "grant_manage_team")).toBe(false);
    expect(canActOn(admin, plain, "role")).toBe(true);
    expect(canActOn(admin, null, "grant_manage_team")).toBe(true);
  });
  it("needs the team power to add, and never reaches up", () => {
    expect(canActOn(plain, null, "add")).toBe(false);
    expect(canActOn(manager, null, "add")).toBe(true);
    expect(canActOn(admin, owner, "remove")).toBe(false);
    expect(canActOn(manager, admin, "remove")).toBe(false);
    expect(canActOn(owner, admin, "remove")).toBe(true);
  });
});

describe("mayActOn", () => {
  it("lets a member who manages the team look after other members, and one admin another", () => {
    expect(mayActOn(manager, plain, "remove")).toBe(true);
    expect(mayActOn(manager, plain, "powers")).toBe(true);
    expect(mayActOn(admin, { ...admin, userId: "a2" }, "remove")).toBe(true);
  });
  it("still never reaches up, and nobody changes their own powers", () => {
    expect(mayActOn(manager, admin, "remove")).toBe(false);
    expect(mayActOn(admin, owner, "remove")).toBe(false);
    expect(mayActOn(plain, { ...plain, userId: "p2" }, "remove")).toBe(false);
    expect(mayActOn(manager, manager, "powers")).toBe(false);
    expect(mayActOn(owner, owner, "powers")).toBe(false);
  });
});
