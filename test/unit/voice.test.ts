/**
 * Whether the seven markets sound like seven markets.
 *
 * The engine has one vocabulary because the maths is the same everywhere:
 * customers, capacity, quality, price. That is a fact about the code and it is
 * not supposed to be a fact about the game. A player who picks drone delivery
 * should spend a fortnight thinking about weather windows and airspace, and a
 * player who picks a restaurant chain should be thinking about who is cooking
 * on Saturday — not both of them reading the word "units" in a slightly
 * different colour.
 *
 * The same goes for the twenty-eight companies that already own these markets.
 * "Ember, 39%" is a row on a table. Four numbers give a player nothing to feel
 * about taking a point off Ember, and taking a point off Ember is the entire
 * fortnight.
 *
 * A type can insist these fields exist. It cannot insist they are any good, so
 * this does: that the words differ between markets, that they read as the
 * phrases the screens splice them into, that every incumbent's character is
 * the posture made human rather than decoration laid over it, and — the one
 * that matters most — that each of them has a stated way in.
 */
import { describe, it, expect } from "vitest";
import { NICHES } from "@shared/simulation/niches";
import type { NicheVoice, Persona } from "@shared/simulation/types";

const VOICE_FIELDS: (keyof NicheVoice)[] = [
  "customer", "customers", "unit", "per", "capacity", "capacityShort",
  "place", "places", "quality", "brand", "service", "turnedAway", "market", "rivals",
];

const PERSONA_FIELDS: (keyof Persona)[] = ["tagline", "boss", "character", "known", "knock", "voice"];

describe("every market speaks its own trade", () => {
  it("names the things the screens have to name", () => {
    for (const niche of NICHES) {
      for (const field of VOICE_FIELDS) {
        const word = niche.voice[field];
        expect(word, `${niche.id}.voice.${field}`).toBeTruthy();
        expect(word.trim(), `${niche.id}.voice.${field} is not padded`).toBe(word);
      }
    }
  });

  it("writes them as phrases, not sentences", () => {
    /*
     * These are spliced into sentences the screens build — "12,400 diners",
     * "£38 a month", "you turned away 900 people who looked at the queue". A
     * capitalised word or a stray full stop in the middle of that reads as a
     * bug, and it is the kind that only ever shows up in a screenshot.
     */
    for (const niche of NICHES) {
      for (const field of VOICE_FIELDS) {
        const word = niche.voice[field];
        expect(word, `${niche.id}.voice.${field} does not end in a full stop`).not.toMatch(/\.$/);
        expect(word[0], `${niche.id}.voice.${field} starts lower case`).toBe(word[0].toLowerCase());
      }
    }
  });

  it("does not call two different trades the same thing", () => {
    /*
     * The test that stops this becoming decoration. If six markets say
     * "customers" then the vocabulary is a lookup table doing nothing, and the
     * honest thing would be to delete it rather than pretend.
     *
     * Not every field can be unique — "region" is genuinely the right word in
     * four of these — so the bar is that the distinctly-shaped fields differ,
     * and that no two markets share a whole vocabulary.
     */
    for (const field of ["customers", "capacity", "capacityShort", "turnedAway", "quality"] as const) {
      const said = NICHES.map((n) => n.voice[field].toLowerCase());
      expect(new Set(said).size, `every market has its own word for ${field}: ${said.join(" / ")}`)
        .toBe(NICHES.length);
    }

    const whole = NICHES.map((n) => VOICE_FIELDS.map((f) => n.voice[f]).join("|"));
    expect(new Set(whole).size, "no two markets share a vocabulary").toBe(NICHES.length);
  });
});

describe("the companies that already own the market", () => {
  const everyone = NICHES.flatMap((n) => n.incumbents.map((i) => ({ niche: n.id, ...i })));

  it("gives all twenty-eight of them somebody to be", () => {
    expect(everyone.length).toBe(28);
    for (const company of everyone) {
      for (const field of PERSONA_FIELDS) {
        expect(company.persona[field], `${company.id}.persona.${field}`).toBeTruthy();
      }
    }
  });

  it("says enough to be worth reading, and not so much nobody reads it", () => {
    /*
     * `character` is the two or three sentences a player opens a profile for;
     * anything under a couple of hundred characters is a label pretending to
     * be a personality. `known` and `knock` sit on chips and in tight columns,
     * so they have a ceiling rather than a floor.
     */
    for (const company of everyone) {
      expect(company.persona.character.length, `${company.id} has a real character`).toBeGreaterThan(200);
      expect(company.persona.known.length, `${company.id}.known fits a chip`).toBeLessThan(60);
      expect(company.persona.knock.length, `${company.id}.knock stays a sentence or two`).toBeLessThan(220);
      expect(company.persona.tagline.length, `${company.id}.tagline is a tagline`).toBeLessThan(70);
    }
  });

  it("gives every one of them a door", () => {
    /*
     * The design commitment underneath all of this. A market of four
     * unassailable companies is a market with no game in it, so every
     * incumbent states the thing it is bad at — and states it as something a
     * team could actually go after, which is why `knock` is prose and not an
     * adjective.
     *
     * Checked as a floor on length because the failure mode is not an empty
     * string, it is somebody writing "expensive" and moving on.
     */
    for (const company of everyone) {
      expect(company.persona.knock.length, `${company.id} has a way in worth describing`).toBeGreaterThan(60);
      expect(company.persona.knock, `${company.id}'s weakness is a sentence`).toMatch(/\.$|\.\s|\?$/);
    }
  });

  it("is nobody twice", () => {
    const names = everyone.map((c) => c.name);
    expect(new Set(names).size, "every company has its own name").toBe(names.length);
    const taglines = everyone.map((c) => c.persona.tagline);
    expect(new Set(taglines).size, "and its own line").toBe(taglines.length);
    const bosses = everyone.map((c) => c.persona.boss);
    expect(new Set(bosses).size, "and its own boss").toBe(bosses.length);
  });

  it("matches the personality to the behaviour the engine will actually show", () => {
    /*
     * The one that keeps this honest rather than decorative.
     *
     * A player reads the profile and then watches the company act. If a
     * `brawler` is written as a proud premium house, the profile has told them
     * a lie that the next four years will slowly expose — worse than no
     * profile at all, because they will have planned around it.
     *
     * So the posture has to be legible in the writing. Checked loosely, on
     * vocabulary rather than on phrasing, because the point is to catch a
     * persona pasted onto the wrong company — not to dictate the prose.
     */
    const expected: Record<string, RegExp> = {
      // Will follow you down on price and keep going.
      brawler: /cheap|pric|undercut|discount|rates|less|free|value|money/i,
      // Defends what is loyal, at a price, and will not be hurried.
      fortress: /loyal|relationship|trust|renew|standard|habit|never leave|will not|reliab|safety|support|moat|defend/i,
      // Better than everybody and cannot reach anybody.
      innovator: /best|extraordinar|ambitious|new idea|craft|engineer|better|comes close|nobody else|nothing else/i,
      // Living off something somebody else built.
      coaster: /maintenance|coasting|nobody|has not|stopped|tired|habit|becalmed|four years|since/i,
    };

    for (const company of everyone) {
      const written = `${company.persona.character} ${company.persona.known} ${company.persona.knock}`;
      expect(written, `${company.id} is written like the ${company.posture} the engine will play`)
        .toMatch(expected[company.posture]);
    }
  });

  it("puts one of each posture in every market", () => {
    /*
     * Not a writing rule — a design one, and this is the cheapest place to
     * hold it. Four companies that all defend the same way is one puzzle
     * printed seven times; the reason a market is worth re-entering is that
     * the price war and the siege are going on in it at once.
     */
    for (const niche of NICHES) {
      const postures = niche.incumbents.map((i) => i.posture).sort();
      expect(postures, `${niche.id} has one of each`).toEqual(["brawler", "coaster", "fortress", "innovator"]);
    }
  });
});
