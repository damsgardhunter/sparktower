/**
 * What the founders do with their own hands.
 *
 * Every other lever in this engine spends money: brand is bought, quality is
 * bought, service is bought, and a company with nothing in the bank has no way
 * to get better at anything. That is wrong about the thing being simulated. The
 * first version of most products is built by the person who had the idea, at
 * night, for nothing — and that labour is the only asset a founder starts with.
 *
 * So a period's work is a decision. Instead of paying somebody to build the
 * product, the founders build it; instead of paying for a service team, they
 * answer the phone themselves. It costs them the period rather than the money.
 *
 * ## Why the effects are absolute and small
 *
 * A point of quality bought with money scales with the market — `atScale` makes
 * £220,000 mean the same thing everywhere — but a founder's fortnight does not.
 * Two people rewriting the onboarding get the same amount done whether the
 * market is worth a million or four hundred, so these are flat point gains.
 *
 * Which balances itself. Three points of quality is most of what a company with
 * no money can achieve in a year, and a rounding error to one spending two
 * million on engineers — so founder labour is decisive when you are poor and
 * irrelevant when you are rich, which is exactly how it works.
 *
 * ## How many
 *
 * A period's worth, and a period is not always the same length: one in a
 * monthly season, two in a quarterly one, three in a yearly one. The founders
 * are not more productive in a yearly season — there is simply more of it
 * between decisions, and a year in which they could only do one thing would
 * make the annual cadence a worse game than the monthly one for no reason.
 */
import type { Niche } from "./types";
import { periodsPerYear, type Cadence } from "./cadence";

/** What one action item does, and which axis it moves. */
export interface FounderAction {
  id: string;
  /** Said in the market's own words. */
  name: string;
  /** What doing it actually means, for somebody choosing. */
  blurb: string;
  /** Which part of the company it improves. */
  moves: "quality" | "brand" | "service" | "efficiency" | "reach";
  /**
   * Points on that axis, or for `efficiency` a share taken off the unit cost,
   * and for `reach` a share added to capacity.
   */
  amount: number;
}

/**
 * How many the founders can take on in one period.
 *
 * One a month, two a quarter, three a year — see the note above.
 */
export function actionsForPeriods(periods: number): number {
  if (periods >= 12) return 1;
  if (periods >= 4) return 2;
  return 3;
}

/** The same, said as a cadence, for the places that hold one rather than a count. */
export function actionsPerPeriod(cadence: Cadence | null | undefined): number {
  return actionsForPeriods(periodsPerYear(cadence));
}

/**
 * The nine things a founder can do with a period, generically.
 *
 * Nine so that every cadence has more to choose from than it can take — a list
 * of three in a yearly season is not a decision, it is a checklist. Said in the
 * market's own words by `foundersActions` below.
 *
 * Deliberately not one per axis. Quality gets three because building the thing
 * is what a founder actually spends their nights on, and a list that treated
 * "rewrite the worst part" and "answer the phone yourself" as equally likely
 * would be describing a company nobody runs.
 */
const SLOTS: readonly FounderAction[] = [
  { id: "build", name: "Build the next piece yourself", moves: "quality", amount: 3,
    blurb: "A month of your own evenings on the thing you would otherwise have paid somebody to build." },
  { id: "fix", name: "Fix the worst part of it", moves: "quality", amount: 2,
    blurb: "Not new work — the part you already know is bad, and that every customer mentions." },
  { id: "watch", name: "Watch somebody use it", moves: "quality", amount: 2,
    blurb: "Sit with ten of them and say nothing. Cheaper than research and harder to ignore." },
  { id: "serve", name: "Answer every customer yourself", moves: "service", amount: 3,
    blurb: "No queue, no script, and you hear every complaint first-hand. Does not scale, which is the point of doing it now." },
  { id: "chase", name: "Win back the ones who left", moves: "service", amount: 2,
    blurb: "Ring the people who stopped buying and ask why. Some of them come back and all of them tell you something." },
  { id: "tell", name: "Tell people yourself", moves: "brand", amount: 3,
    blurb: "Knock on doors, post it everywhere, stand in the cold at an event. Free, and it only works while you keep doing it." },
  { id: "story", name: "Get written about", moves: "brand", amount: 2,
    blurb: "One piece in somewhere people in this market actually read, earned rather than bought." },
  { id: "haggle", name: "Renegotiate what you pay", moves: "efficiency", amount: 0.04,
    blurb: "Go through every bill and every supplier yourself. Nobody else will ever care enough to do this properly." },
  { id: "stretch", name: "Work the hours", moves: "reach", amount: 0.12,
    blurb: "Open earlier, close later, take the jobs nobody else will. More people served, out of your own week." },
];

/** The slots, for the test that holds the per-market lists in step with them. */
export const ACTION_SLOTS = SLOTS;

/**
 * The nine said in this market's own words, where it has its own.
 *
 * Same shape as `templatesFor` in `assets.ts` and for the same reason: a
 * founder rehearsing a bakery should be offered "work the hours" as something a
 * bakery does, not as generic advice. A market that brought its own list wins
 * over the generic one; a market that did not gets the generic one with its own
 * vocabulary dropped in, which is still better than somebody else's trade.
 */
export function foundersActions(niche: Pick<Niche, "id" | "voice" | "actions">): FounderAction[] {
  /*
   * The season's own list first, then the built-in market's, then generic.
   *
   * In that order because a custom season Nova wrote is the most specific
   * thing anyone has said about this market, and a built-in id is the next
   * most. `WRITTEN_ACTIONS` is declared below this function, which is fine —
   * it is a `const` read at call time, not at module load.
   */
  const written = niche.actions?.length ? niche.actions : WRITTEN_ACTIONS[niche.id];
  if (!written?.length) {
    return SLOTS.map((slot) => ({
      ...slot,
      blurb: slot.blurb
        .replace(/\bcustomers?\b/g, niche.voice?.customers ?? "customers")
        .replace(/\bbuy(ing)?\b/g, "buying"),
    }));
  }

  /*
   * Taken by position against the slots, so a written list keeps each slot's
   * economics under its own name. An entry that is missing falls back to the
   * generic one rather than shifting every later entry onto the wrong effect —
   * the same failure `templatesFor` guards against, where a patent's economics
   * end up under a warehouse's name.
   */
  return SLOTS.map((slot, i) => {
    const said = written[i];
    if (!said?.name) return slot;
    return { ...slot, name: said.name, blurb: said.blurb || slot.blurb };
  });
}

/**
 * How much of the company the founders' own hands actually are.
 *
 * Flat points alone were not enough, and the measurement said so. Held against
 * a funded plan over eight quarters, two action items moved the company
 * spending £300,000 a quarter by 30.9% and the company spending nothing by
 * 28.1% — the opposite of the claim this file is built on. Absolute effects are
 * necessary for that claim but not sufficient: they are free, so a large
 * company collects the same three points of quality every period for nothing,
 * and three points converts *better* there because quality nobody has heard of
 * moves nothing and a funded company has bought the awareness to convert it.
 *
 * What was missing is that a fortnight of founder labour is a smaller and
 * smaller share of the work being done as the company hires. Three people
 * rewriting the onboarding *is* the engineering department at five staff and
 * is a rounding error at five hundred — so the effect is diluted by the
 * founders' share of the labour, and it is the hiring that dilutes it rather
 * than the market's size (`atScale`) or the balance sheet.
 *
 * `DILUTE` below 1 because a founder's period is not interchangeable with an
 * employee's: it is the period spent on whatever matters most this month,
 * without a handover, by the person who decides. At 0.25 a team of five keeps
 * about seven tenths of it, twenty staff keeps under half, and five hundred
 * keeps two per cent.
 */
const DILUTE = 0.25;

/**
 * A year holds a year of founder work however often the table files.
 *
 * The allowance is one a month, two a quarter, three a year — which is the
 * right *number* of decisions and the wrong amount of work. Counted straight,
 * a monthly season gives the founders twelve action items a year against three
 * in a yearly one: four times the labour out of the same calendar, by nobody's
 * choice but the cadence. It showed up as soon as it was measured — opened at
 * £60,000 and played monthly for two years, the free lever was worth +226% in
 * dating apps, +286% in drone delivery and +204% in MMOs, and it carried two
 * markets that went bankrupt without it. A lever that costs nothing cannot be
 * the strongest lever in the game.
 *
 * So the count stays and the amount is divided by it. Three actions a year is
 * the reference — the yearly season plays at full strength — and every other
 * cadence is scaled so a year of founder labour is the same year of labour:
 * a monthly action is a quarter of one, a quarterly action three eighths.
 *
 * Which is also the honest reading of what a period's work *is*. A founder
 * choosing one thing to do this month is choosing where a month goes; choosing
 * three things for the year ahead is choosing where a year goes. The decision
 * is the same shape and the fortnight is not twelve fortnights.
 */
const A_YEAR_OF_IT = 3;

export function founderPace(periods: number): number {
  const each = Math.max(1, periods);
  return A_YEAR_OF_IT / (actionsForPeriods(each) * each);
}

export function founderShare(officers: number, staff: number): number {
  const mine = Math.max(1, officers);
  return mine / (mine + Math.max(0, staff) * DILUTE);
}

/**
 * What a period of founder work does to the company.
 *
 * Returns the points to add and the shares to apply, rather than a company, so
 * `resolveYear` can fold it in beside everything else that lands this period
 * and the lags stay in one place.
 *
 * `share` is `founderShare` above: one for a company that is only its founders,
 * falling as it hires.
 */
export function founderEffects(actions: FounderAction[], share = 1): {
  quality: number; brand: number; service: number;
  /** Multiplier on unit cost: 0.96 is four per cent off. */
  unitCost: number;
  /** Multiplier on capacity. */
  capacity: number;
} {
  const held = Math.max(0, Math.min(1, share));
  let quality = 0, brand = 0, service = 0, unitCost = 1, capacity = 1;
  for (const a of actions) {
    const amount = a.amount * held;
    if (a.moves === "quality") quality += amount;
    else if (a.moves === "brand") brand += amount;
    else if (a.moves === "service") service += amount;
    else if (a.moves === "efficiency") unitCost *= 1 - amount;
    else if (a.moves === "reach") capacity *= 1 + amount;
  }
  return { quality, brand, service, unitCost, capacity };
}

/**
 * The ones actually taken this period, from what was chosen.
 *
 * Cleaned here rather than trusted: the allowance is a rule of the game, so a
 * filing that names five actions in a monthly season takes the first one and
 * not all five. Unknown ids are dropped, and the same id twice counts once —
 * a founder cannot do the same fortnight's work twice over.
 */
export function actionsTaken(
  chosen: readonly string[] | undefined,
  niche: Pick<Niche, "id" | "voice" | "actions">,
  /** Periods in a year, as `resolveYear` is given it — 12, 4 or 1. */
  periods: number,
): FounderAction[] {
  if (!chosen?.length) return [];
  const available = foundersActions(niche);
  const seen = new Set<string>();
  const taken: FounderAction[] = [];
  for (const id of chosen) {
    if (seen.has(id)) continue;
    const found = available.find((a) => a.id === id);
    if (!found) continue;
    seen.add(id);
    taken.push(found);
    if (taken.length >= actionsForPeriods(periods)) break;
  }
  return taken;
}

/**
 * What the founders of each built-in market actually do with a fortnight.
 *
 * Kept here rather than in `niches.ts` — which is already eight hundred lines
 * of market data — and keyed by niche id, exactly as `CATALOGUES` keys the
 * asset shelf. A custom market Nova writes brings its own list on
 * `niche.actions` and never reaches this table.
 *
 * **By position**, like `templatesFor`: entry *n* takes slot *n*'s economics
 * and only renames it. So the order is load-bearing, and a test holds every
 * list at nine entries against `ACTION_SLOTS`. Reordering one of these lists
 * does not reorder its effects — it moves a market's "answer every customer
 * yourself" onto "renegotiate what you pay", which is the bug that note in
 * `assets.ts` exists to prevent.
 *
 * The point of writing them out is that generic advice is not a decision. "Get
 * written about" is a thing a founder could do anywhere; "get the restaurant
 * reviewed by somebody people in this city actually read" is a thing somebody
 * rehearsing a restaurant recognises as their own week.
 */
export const WRITTEN_ACTIONS: Record<string, { name: string; blurb?: string }[]> = {
  dating_apps: [
    { name: "Write the matching yourself", blurb: "Your own nights on the one thing the whole app is: who it puts in front of whom." },
    { name: "Fix the part everyone screenshots", blurb: "The bug in the chat, the photo that won't upload — the thing already in every one-star review." },
    { name: "Sit with ten subscribers while they swipe", blurb: "Say nothing and watch. You will learn more in an afternoon than from a quarter of analytics." },
    { name: "Moderate the reports yourself", blurb: "Every safety report, read by you, answered by you. Horrible, and the fastest way to find out what your app is actually like." },
    { name: "Ring the people who deleted it", blurb: "Ask the ones who left why. Some reinstall, and all of them tell you something analytics never will." },
    { name: "Be in the bars on a Friday", blurb: "Hand out codes, buy a round, get it onto phones in front of you. Free, and it stops the day you stop." },
    { name: "Get one honest write-up", blurb: "One piece somewhere single people in this city actually read, earned rather than bought." },
    { name: "Renegotiate the cloud bill", blurb: "Go through every line of the infrastructure and SMS spend yourself. Nobody else will care enough to." },
    { name: "Run the Friday nights yourself", blurb: "Be on the servers at peak, by hand, every week. More people matched than the system could hold on its own." },
  ],
  drone_delivery: [
    { name: "Build the airframe fix yourself", blurb: "Your own evenings in the workshop on the thing you would otherwise have paid an engineer for." },
    { name: "Fix whatever keeps dropping", blurb: "Not new work — the failure mode you already know about, that every customer has had once." },
    { name: "Ride along on ten drops", blurb: "Follow the van, watch the handover, see where it actually goes wrong. Nothing in the telemetry shows you this." },
    { name: "Take the missing-drop calls yourself", blurb: "The day a parcel vanishes, you are the one on the phone. No script, no queue, no excuses passed along." },
    { name: "Win back the accounts that stopped", blurb: "Drive out to the ones who went quiet and ask why. Some come back and all of them tell you something." },
    { name: "Knock on the clinics' doors", blurb: "Pharmacies, surgeries, farm offices — in person, with a drone in the van. Free, and it only works while you keep going." },
    { name: "Get the local paper on a landing", blurb: "One piece about the village that now gets its prescriptions in nine minutes. Earned, not bought." },
    { name: "Renegotiate the insurance and the batteries", blurb: "Every premium and every supplier, line by line, by you. This is where the margin actually is." },
    { name: "Fly the weekends yourself", blurb: "Take the slots nobody else will, in weather nobody else likes. More drops a week, out of your own." },
  ],
  podcasts: [
    { name: "Cut the next episode yourself", blurb: "Your own nights in the edit instead of an editor's invoice. The show gets better where it is actually made." },
    { name: "Re-cut the worst ten minutes", blurb: "You know which stretch people skip. Fix that before you make anything new." },
    { name: "Read the drop-off graphs properly", blurb: "Sit with where listeners stop, episode by episode, and change the thing that loses them." },
    { name: "Answer every listener yourself", blurb: "Every email, every review, every message. They talk about shows that talk back." },
    { name: "Call the hosts who drifted off", blurb: "Ring the talent and the brands who stopped returning calls and ask what went wrong." },
    { name: "Go on everybody else's show", blurb: "Twenty guest spots on other people's feeds. Costs nothing but your weeks, and it is how podcasts actually grow." },
    { name: "Get into one newsletter that matters", blurb: "A single recommendation somewhere podcast listeners read, earned on the strength of the work." },
    { name: "Renegotiate hosting and the ad network", blurb: "Go through the CPM splits and the hosting tiers yourself. Nobody is going to offer you a better deal." },
    { name: "Record two at a time", blurb: "Double up the studio days and work the weekends. More shows made, out of your own hours." },
  ],
  restaurant_chain: [
    { name: "Develop the menu yourself", blurb: "Your own mornings in the kitchen on the dishes you would otherwise have paid a consultant to write." },
    { name: "Fix the dish everyone sends back", blurb: "You know which one it is. Every review mentions it and it is still on the menu." },
    { name: "Work the floor on a Saturday", blurb: "Watch forty tables eat without saying anything. Cheaper than a mystery shopper and much harder to ignore." },
    { name: "Take every complaint yourself", blurb: "Be the one who goes to the table when something is wrong. Does not scale, which is why it is worth doing now." },
    { name: "Call the regulars who stopped coming", blurb: "The ones who were in every week and have not been for two months. Ask, and some come back." },
    { name: "Feed people who have never heard of you", blurb: "Markets, street stalls, tastings, standing in the cold. Free, and it only works while you keep showing up." },
    { name: "Get reviewed by somebody local", blurb: "One write-up from a critic people in this city actually follow, earned rather than paid for." },
    { name: "Renegotiate with every supplier", blurb: "Produce, meat, linen, waste — every invoice, by you. This is where a restaurant's margin lives or dies." },
    { name: "Open the shifts nobody wants", blurb: "Early breakfasts, late kitchens, Sunday nights. More covers served, out of your own week." },
  ],
  construction: [
    { name: "Run the detailing yourself", blurb: "Your own evenings on the drawings and the method statements instead of paying it out to a consultant." },
    { name: "Put right the snag that keeps recurring", blurb: "The defect that comes back on every job. You already know what it is." },
    { name: "Walk ten finished jobs with the client", blurb: "Go back six months later and look at the work with the person paying for it. Nothing teaches faster." },
    { name: "Answer every client yourself", blurb: "One number, yours, answered on site. Turning up and still picking up is most of what this trade is judged on." },
    { name: "Chase the clients who never came back", blurb: "Ring the ones who used you once. Ask why it was only once." },
    { name: "Get in front of the people who award work", blurb: "Trade mornings, council tenders, quantity surveyors' offices. Shoe leather, and it only works while you do it." },
    { name: "Get one job into the trade press", blurb: "A single piece of work written up where developers in this region read it. Earned on the work itself." },
    { name: "Renegotiate materials and plant hire", blurb: "Every hire rate and every merchant account, gone through by you. Nobody else will push this hard." },
    { name: "Run the extra site yourself", blurb: "Take the job that needs a manager you cannot afford, and be the manager. More work in hand, out of your own hours." },
  ],
  project_saas: [
    { name: "Ship the next release yourself", blurb: "Your own nights on the roadmap instead of a contractor's rate card. Founders write the first good version of everything." },
    { name: "Fix what breaks on Monday morning", blurb: "The thing that falls over at nine with two hundred people in it. You already know which thing." },
    { name: "Watch ten teams onboard", blurb: "Sit in on the first hour of ten new accounts and say nothing. Every drop-off becomes obvious." },
    { name: "Take the support queue yourself", blurb: "Every ticket, answered by the person who can fix it. No tier one, no macros, and you hear everything first." },
    { name: "Call the accounts that churned", blurb: "Ring every team that left and ask what happened. Some renew, and the rest tell you what to build." },
    { name: "Sell it yourself", blurb: "Cold outreach, demos, conference hallways, your own calendar. Free, and it stops the week you stop." },
    { name: "Get written up where buyers read", blurb: "One piece somewhere the people who sign for software actually look. Earned rather than sponsored." },
    { name: "Renegotiate every SaaS bill you pay", blurb: "Cloud, tooling, seats you forgot about. Go through the card statement line by line yourself." },
    { name: "Onboard the accounts nobody has time for", blurb: "Do the migrations yourself, at night. More seats live than the team could carry alone." },
  ],
  mmos: [
    { name: "Build the next content patch yourself", blurb: "Your own nights on the endgame instead of another contract designer. The best systems in this genre were made this way." },
    { name: "Fix the thing the forums will not stop about", blurb: "You know the exploit, the dead zone, the class nobody plays. Fix that before shipping anything new." },
    { name: "Play with ten of them, unannounced", blurb: "Roll an alt and group up with strangers for a weekend. You will learn what your game actually feels like." },
    { name: "Answer the tickets yourself", blurb: "Every rollback, every ban appeal, every lost item, by you. Brutal, and nothing else tells you this much." },
    { name: "Win back the ones who quit", blurb: "Message the lapsed accounts yourself and ask why they stopped. Some come back, and they all tell you something." },
    { name: "Be in the community yourself", blurb: "Discords, subreddits, streams, replies at two in the morning. Free, and it only works while you keep turning up." },
    { name: "Get one creator to cover it honestly", blurb: "A single video or piece from somebody this audience trusts, earned rather than paid for." },
    { name: "Renegotiate the server bill", blurb: "Go through the hosting, the bandwidth and the middleware licences yourself. Nobody else will read the contract." },
    { name: "Hold the launch weekend open yourself", blurb: "Be on the shards at peak, bringing capacity up by hand. More players held than the system manages alone." },
  ],
};
