/**
 * What each market actually sells, when something comes up for sale.
 *
 * Every market used to be offered the same nine things. A dating app bidding
 * for a "Sports federation licence" or a "Second operations centre" was being
 * asked to argue over an object that means nothing in its world, so the
 * marketplace read as a spreadsheet with the labels left on rather than as
 * part of the business being run.
 *
 * ## Re-skinned, not rebalanced
 *
 * Each market gets its own nine, but slot for slot they are the same nine
 * underneath: same price, same lifespan, same effect. A dating app's
 * moderation centre does exactly what the old operations centre did, because
 * in a dating app that is what an operations centre *is*. So this change moves
 * the words and nothing else — every balance number in `assets.ts` stands, and
 * the tests that pin them still hold.
 *
 * Order matters: entry *n* here is slot *n* in `SLOTS` in `assets.ts`. The test
 * in `test/unit/catalogues.test.ts` holds the two to the same length and the
 * same kinds, so a catalogue cannot quietly drift out of step with its slots.
 */
import type { CompanyAsset } from "./types";

export interface CatalogueEntry {
  /** Must match the slot's kind — a licence cannot be re-skinned as a facility. */
  kind: CompanyAsset["kind"];
  name: string;
  /** One line a player can decide from. */
  blurb: string;
}

/**
 * Slot order, for reference while writing a catalogue:
 *   0 distribution — reach, some brand, 4 years
 *   1 distribution — more reach, more brand, 3 years, expensive
 *   2 celebrity    — a lot of brand, 3 years
 *   3 patent       — quality and cheaper units, forever
 *   4 patent       — quality, forever
 *   5 facility     — capacity, service, slightly cheaper units, 6 years
 *   6 facility     — capacity, much cheaper units, 5 years
 *   7 licence      — brand and a little service, 4 years
 *   8 licence      — a little brand, 3 years
 */
export const CATALOGUES: Record<string, CatalogueEntry[]> = {
  dating_apps: [
    { kind: "distribution", name: "Freshers' week partnership",
      blurb: "Every new student in six universities gets a premium code in their welcome pack. More people nearby on a Friday night, without you building anything." },
    { kind: "distribution", name: "App store featuring deal",
      blurb: "The front page of the app store for three years. Expensive, short, and very hard to argue with while it lasts." },
    { kind: "celebrity", name: "Reality-show couple as ambassadors",
      blurb: "The couple everybody watched fall in love on television. Works immediately — and leaves with them if they split up." },
    { kind: "patent", name: "Matching algorithm patent",
      blurb: "The part that decides who sees whom, yours permanently and not theirs. The rare thing here that does not expire." },
    { kind: "patent", name: "Video first-date patents",
      blurb: "A fence around the feature people actually use before they agree to meet." },
    { kind: "facility", name: "Trust & safety moderation centre",
      blurb: "Real people who review a report within the hour. More members can join without the app starting to feel unsafe." },
    { kind: "facility", name: "Own matching compute cluster",
      blurb: "Your own servers rather than renting them. Cuts what every premium month costs to run, for as long as you keep it on." },
    { kind: "brand_licence", name: "Relationships charity endorsement",
      blurb: "Borrowed credibility with the people who care most about whether a dating app is safe." },
    { kind: "brand_licence", name: "Agony-aunt podcast sponsorship",
      blurb: "A quieter voice than a celebrity, and she does not date on camera." },
  ],

  drone_delivery: [
    { kind: "distribution", name: "Supermarket rooftop landing rights",
      blurb: "Somebody else's roofs to land on. More addresses in range without building a single pad." },
    { kind: "distribution", name: "Exclusive retailer delivery contract",
      blurb: "Every order from one big retailer comes to you for three years. Expensive, short, and very hard to argue with." },
    { kind: "celebrity", name: "Celebrity chef who swears by it",
      blurb: "A face people trust with their dinner. Works immediately and leaves when the contract does." },
    { kind: "patent", name: "Hot-swap battery patent",
      blurb: "Drones back in the air in ninety seconds, and nobody else is allowed to do it that way. Never expires." },
    { kind: "patent", name: "Collision-avoidance patents",
      blurb: "A fence around the part regulators and neighbours care about most." },
    { kind: "facility", name: "Second drone hub",
      blurb: "Room to fly more orders and a control room to answer from when one goes astray." },
    { kind: "facility", name: "Automated charging depot",
      blurb: "Robots swap and charge the batteries. Cuts what every delivery costs for as long as it runs." },
    { kind: "brand_licence", name: "Air-ambulance charity partnership",
      blurb: "Borrowed credibility with the people most worried about things flying over their gardens." },
    { kind: "brand_licence", name: "Local council green-transport badge",
      blurb: "A quieter endorsement than a celebrity, printed on every parcel." },
  ],

  podcasts: [
    { kind: "distribution", name: "Smart-speaker default slot",
      blurb: "Ask a kitchen speaker for a podcast and it plays you. More listeners reach you without you building anything." },
    { kind: "distribution", name: "Car dashboard pre-install",
      blurb: "Already on the screen of every new car from one maker for three years. Expensive, and very hard to argue with." },
    { kind: "celebrity", name: "A famous host, signed for three years",
      blurb: "A voice people already follow. Works immediately and walks out the door when the deal ends." },
    { kind: "patent", name: "Recommendation engine patent",
      blurb: "The part that decides what plays next, yours permanently. The rare thing here that does not expire." },
    { kind: "patent", name: "Searchable-transcript patents",
      blurb: "A fence around the feature listeners actually use to find the bit they wanted." },
    { kind: "facility", name: "Second studio complex",
      blurb: "Room to record more shows, and a team to answer listeners and advertisers." },
    { kind: "facility", name: "Automated editing suite",
      blurb: "Machines do the first cut. Cuts what every episode costs to make, for as long as it runs." },
    { kind: "brand_licence", name: "Public broadcaster archive licence",
      blurb: "Borrowed credibility with the listeners who care most about quality." },
    { kind: "brand_licence", name: "Newspaper partnership",
      blurb: "A quieter name than a celebrity, and it does not have opinions in public." },
  ],

  restaurant_chain: [
    { kind: "distribution", name: "Delivery-app priority placement",
      blurb: "Top of the list on the apps people order from. More diners reach you without opening a site." },
    { kind: "distribution", name: "Motorway services concession",
      blurb: "The only hot food for forty miles, for three years. Expensive, short, and very hard to argue with." },
    { kind: "celebrity", name: "A television chef, signed for three years",
      blurb: "A face people already trust with their food. Works immediately and leaves with them when it ends." },
    { kind: "patent", name: "Signature recipe and process",
      blurb: "The dish people come back for, and the way it is made, yours permanently. Never expires." },
    { kind: "patent", name: "Ordering-kiosk design rights",
      blurb: "A fence around the part customers actually touch before they eat." },
    { kind: "facility", name: "Second central kitchen",
      blurb: "Room to feed more people, and somewhere for the complaints to be answered from." },
    { kind: "facility", name: "Automated prep line",
      blurb: "Machines do the chopping. Cuts what every plate costs for as long as it runs." },
    { kind: "brand_licence", name: "Football stadium catering licence",
      blurb: "Borrowed credibility with fifty thousand hungry people every other Saturday." },
    { kind: "brand_licence", name: "Food critic column partnership",
      blurb: "A quieter name than a celebrity, and a better-written one." },
  ],

  construction: [
    { kind: "distribution", name: "Council framework agreement",
      blurb: "A place on the list the council calls first. More jobs reach you without chasing them." },
    { kind: "distribution", name: "Housing-association panel seat",
      blurb: "First refusal on a housing association's building work for three years. Expensive, and very hard to argue with." },
    { kind: "celebrity", name: "Home-renovation TV presenter",
      blurb: "A face people trust in their own houses. Works immediately and leaves when the series does." },
    { kind: "patent", name: "Modular build system patent",
      blurb: "Houses assembled in weeks, a way nobody else is allowed to do it. Never expires." },
    { kind: "patent", name: "Site-scheduling software rights",
      blurb: "A fence around the part clients see when they ask when it will be finished." },
    { kind: "facility", name: "Second prefabrication yard",
      blurb: "Room to take on more jobs, and a site office to answer clients from." },
    { kind: "facility", name: "Automated steel-cutting line",
      blurb: "Machines cut the frames. Cuts what every job costs for as long as it runs." },
    { kind: "brand_licence", name: "Building-standards accreditation",
      blurb: "Borrowed credibility with the clients most afraid of cowboys." },
    { kind: "brand_licence", name: "Trade-press partnership",
      blurb: "A quieter name than a celebrity, read by the people who hire you." },
  ],

  project_saas: [
    { kind: "distribution", name: "Office-suite marketplace listing",
      blurb: "One click to install from the software everybody already uses at work. More teams reach you without a sales call." },
    { kind: "distribution", name: "Bundled with a laptop maker's business range",
      blurb: "Pre-installed on every business laptop from one maker for three years. Expensive, and very hard to argue with." },
    { kind: "celebrity", name: "A well-known founder as advocate",
      blurb: "Somebody every startup follows, saying they run on you. Works immediately and leaves when the deal ends." },
    { kind: "patent", name: "Scheduling engine patent",
      blurb: "The part that works out who does what when, yours permanently. Never expires." },
    { kind: "patent", name: "Interface patent portfolio",
      blurb: "A fence around the part customers actually touch." },
    { kind: "facility", name: "Second data-centre region",
      blurb: "Room for more customers, closer to them, and a support desk in their time zone." },
    { kind: "facility", name: "Automated support tooling",
      blurb: "The routine tickets answer themselves. Cuts what every seat costs to serve for as long as it runs." },
    { kind: "brand_licence", name: "Security certification",
      blurb: "Borrowed credibility with the buyers whose first question is about their data." },
    { kind: "brand_licence", name: "Business-school partnership",
      blurb: "A quieter name than a celebrity, taught to next year's managers." },
  ],

  mmos: [
    { kind: "distribution", name: "Console store featuring",
      blurb: "The front of the console store. More players reach you without you building anything." },
    { kind: "distribution", name: "Bundled with a new console",
      blurb: "In the box with a new console for three years. Expensive, short, and very hard to argue with." },
    { kind: "celebrity", name: "A top streamer, signed for three years",
      blurb: "The person millions watch play. Works immediately and leaves with them when the deal ends." },
    { kind: "patent", name: "Netcode patent",
      blurb: "The part that makes a thousand players in one place feel smooth, yours permanently. Never expires." },
    { kind: "patent", name: "Character-creator patents",
      blurb: "A fence around the part players spend their first hour in." },
    { kind: "facility", name: "Second server region",
      blurb: "Room for more players, lower lag for them, and a support team awake in their evening." },
    { kind: "facility", name: "Automated anti-cheat farm",
      blurb: "Machines catch the cheaters. Cuts what every player costs to keep for as long as it runs." },
    { kind: "brand_licence", name: "Fantasy novel series licence",
      blurb: "Borrowed credibility with the players who care most about the world being real." },
    { kind: "brand_licence", name: "Esports league partnership",
      blurb: "A quieter name than a celebrity, on screen every weekend." },
  ],
};
