/**
 * Which header a tab wears, and the room a screen leaves for it.
 *
 * These two facts used to live in different files with nothing keeping them in
 * step, and the header floats over the scene — so a screen that leaves the
 * wrong amount of room does not look slightly off. It draws its first rows
 * underneath the header, where nobody can reach them, for ever. Simulations,
 * the leaderboard and your own profile were all in that state: about sixteen
 * points of room left for a header two hundred and twenty tall.
 *
 * Pure, so it runs without a simulator: the list is data, and the two
 * consumers read the same data.
 */
import { describe, it, expect } from "vitest";
import { PLAIN_HEADER_TABS, PLAIN_HEADER_TITLES, usesPlainHeader } from "./header-kind";

describe("which tabs wear the plain header", () => {
  it("keeps the profile header for Home, and takes it off the screens that are not about you", () => {
    // Home is what the profile header is the top of. It stays.
    expect(usesPlainHeader("feed")).toBe(false);

    // The four the user goes to in order to do something else.
    expect(usesPlainHeader("messages")).toBe(true);
    expect(usesPlainHeader("sprints")).toBe(true);
    expect(usesPlainHeader("more")).toBe(true);
    // Reached by the bell *inside* the profile header, so showing it again is a loop.
    expect(usesPlainHeader("notifications")).toBe(true);
    // Your cover and face, above a screen whose first element is your cover and face.
    expect(usesPlainHeader("profile")).toBe(true);
  });

  it("answers no for anything it has never heard of, rather than guessing", () => {
    expect(usesPlainHeader(undefined)).toBe(false);
    expect(usesPlainHeader("")).toBe(false);
    expect(usesPlainHeader("some-new-tab")).toBe(false);
  });

  it("has a title for every tab on the list", () => {
    // A tab on the list with no title would render its route name as a heading.
    for (const tab of PLAIN_HEADER_TABS) {
      expect(PLAIN_HEADER_TITLES[tab], `${tab} needs a title`).toBeTruthy();
    }
  });

  it("titles them in the words the product uses, not the route names", () => {
    // The route is `sprints` for URL compatibility; the feature is Simulations.
    expect(PLAIN_HEADER_TITLES.sprints).toBe("Simulations");
    expect(PLAIN_HEADER_TITLES.more).toBe("Menu");
  });
});
