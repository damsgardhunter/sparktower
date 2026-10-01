/**
 * Searching your connections for somebody to message.
 *
 * The Messages tab could tell you that you had no messages and offer no way to
 * send one: the only route to a new conversation was finding the person's
 * profile and pressing Message there, which the empty inbox said out loud. So
 * there is now a picker over your connections — connections rather than every
 * account, because `POST /api/messages/:userId` answers 403 to anyone you are
 * not connected to, and a picker whose results the next screen refuses is worse
 * than no picker.
 *
 * This is the matching, which is the part that fails quietly: a search that has
 * stopped looking at usernames returns nothing for a handle somebody typed from
 * memory, and "no connection matches" is indistinguishable from "that person
 * never connected with you".
 */
import { describe, it, expect } from "vitest";
import { connectionName, searchConnections } from "../../client/src/lib/connection-search";

type Row = Parameters<typeof searchConnections>[0][number];

const row = (over: {
  id?: string; firstName?: string; lastName?: string; email?: string;
  displayName?: string; username?: string; headline?: string;
}): Row => ({
  id: over.id ?? `c-${over.username ?? over.email ?? over.displayName ?? "x"}`,
  user: {
    id: `u-${over.username ?? over.email ?? over.displayName ?? "x"}`,
    firstName: over.firstName, lastName: over.lastName, email: over.email,
  } as any,
  profile: (over.displayName || over.username || over.headline)
    ? { displayName: over.displayName, username: over.username, headline: over.headline } as any
    : undefined,
});

describe("what a connection is called", () => {
  it("prefers the name they chose over the one they signed up with", () => {
    expect(connectionName(row({ displayName: "Ada M.", firstName: "Adaline", lastName: "Marchetti" }))).toBe("Ada M.");
  });

  it("falls back through the account name, then the email", () => {
    expect(connectionName(row({ firstName: "Nils", lastName: "Ferreira" }))).toBe("Nils Ferreira");
    expect(connectionName(row({ firstName: "Nils" })), "a missing surname leaves no trailing space").toBe("Nils");
    expect(connectionName(row({ email: "quinn@example.test" })), "an address beats 'User'").toBe("quinn@example.test");
  });

  it("never returns an empty string to render", () => {
    expect(connectionName(row({}))).toBe("User");
    expect(connectionName(row({ firstName: "   " })).trim()).not.toBe("");
  });
});

describe("searching your connections", () => {
  const people = [
    row({ displayName: "Zara Ferreira", username: "zaraf", headline: "Designer, mostly mobile" }),
    row({ displayName: "Ada Marchetti", username: "adam", headline: "Backend and data" }),
    row({ firstName: "Nils", lastName: "Ferreira", email: "nils@example.test" }),
    row({ displayName: "Quinn", username: "qq", headline: "Design systems" }),
  ];

  it("lists everybody, by name, when nothing is typed", () => {
    expect(searchConnections(people, "").map(connectionName))
      .toEqual(["Ada Marchetti", "Nils Ferreira", "Quinn", "Zara Ferreira"]);
  });

  it("treats a query of only spaces as nothing typed", () => {
    expect(searchConnections(people, "   ")).toHaveLength(people.length);
  });

  it("matches a name, whatever case it was typed in", () => {
    expect(searchConnections(people, "ada").map(connectionName)).toEqual(["Ada Marchetti"]);
    expect(searchConnections(people, "ADA MARCH").map(connectionName)).toEqual(["Ada Marchetti"]);
  });

  /*
   * The three fields beyond the name, each of which is how somebody actually
   * remembers a person they met here.
   */
  it("matches a username, which is often all you remember", () => {
    expect(searchConnections(people, "zaraf").map(connectionName)).toEqual(["Zara Ferreira"]);
  });

  it("matches what they say they do, so you can search for the designer", () => {
    expect(searchConnections(people, "design").map(connectionName), "both of them, in name order")
      .toEqual(["Quinn", "Zara Ferreira"]);
  });

  /*
   * Deliberately not the email. `stripOthersAccountFields` redacts `email` from
   * anybody else's account before the payload leaves the server, so for everyone
   * but a reviewer or an admin this would be a search over a field that is never
   * there — failing by returning nothing, which reads as "not connected to you".
   */
  it("does not pretend to match an email, which is redacted before it arrives", () => {
    expect(searchConnections(people, "nils@example")).toEqual([]);
  });

  it("matches part of a surname shared by two people", () => {
    expect(searchConnections(people, "ferreira").map(connectionName)).toEqual(["Nils Ferreira", "Zara Ferreira"]);
  });

  it("returns nothing rather than everything when there is no match", () => {
    expect(searchConnections(people, "nobody-by-that-name")).toEqual([]);
  });

  /* A row with no profile at all must not throw — plenty of accounts have none. */
  it("survives a connection with no profile", () => {
    const bare = [row({ email: "bare@example.test" })];
    expect(() => searchConnections(bare, "bare")).not.toThrow();
    expect(searchConnections(bare, "bare")).toHaveLength(1);
    expect(searchConnections(bare, "design"), "no profile means nothing to match on").toEqual([]);
  });

  /* Sorting must not mutate what it was handed; the query cache owns that array. */
  it("does not reorder the caller's array", () => {
    const original = [...people];
    searchConnections(people, "");
    expect(people).toEqual(original);
  });
});
