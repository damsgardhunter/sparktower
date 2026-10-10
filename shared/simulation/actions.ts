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

/** What a period of the founders' own work does to the company. */
export interface FounderEffects {
  quality: number;
  brand: number;
  service: number;
  reputation: number;
  /** Multiplier on unit cost: 0.96 is four per cent off. */
  unitCost: number;
  /** Multiplier on capacity. */
  capacity: number;
}

/**
 * The week the founders actually have.
 *
 * Sixty hours, which is what somebody starting a business works and is a
 * number they recognise. It replaces an allowance of one action a month, two a
 * quarter, three a year — a reasonable rule that taught the wrong thing: it
 * said "pick the one thing you will do", when the decision a founder really
 * makes is how to carve up a week that is already full. Sixty hours across
 * three things is three things done two thirds as well, and that trade is the
 * lever.
 *
 * It also fixes the thing the allowance could not express. A founder who wants
 * to pour everything into the product can now put all sixty hours there and
 * get a full week's worth, where before a month bought one action at a quarter
 * strength and no amount of determination changed it.
 */
export const HOURS_A_WEEK = 60;

/** What one action item does, and which axis it moves. */
export interface FounderAction {
  id: string;
  /** Said in the market's own words. */
  name: string;
  /** What doing it actually means, for somebody choosing. */
  blurb: string;
  /**
   * Which part of the company it improves.
   *
   * One axis per part, because the first set had three of nine moving quality
   * and nothing at all moving reputation — so three different weeks of work
   * were the same decision wearing different words. Standing is a real stat in
   * this engine (`reputation` sets the credit line and what a shock costs) and
   * no amount of a founder's own effort could touch it.
   */
  moves: "quality" | "brand" | "service" | "reputation" | "efficiency" | "reach";
  /**
   * Points on that axis for a whole week of it, or for `efficiency` a share
   * taken off the unit cost and for `reach` a share added to capacity.
   */
  amount: number;
  /**
   * A second, smaller thing it does, where the work genuinely does two things.
   *
   * Promoting the business yourself is the case that forced this: a month of
   * knocking on doors is supposed to bring people in, and brand alone does not
   * — it raises how well known you are and leaves the room to serve them
   * unchanged, so the customers it won were turned away. Going out and winning
   * people is both.
   */
  also?: { moves: FounderAction["moves"]; amount: number };
  /**
   * For a make-it-yourself option: the hours a week it is asking for.
   *
   * Absent on the nine standing actions, which take whatever is given them
   * and are worth proportionally more or less for it. A build has a size.
   */
  asks?: number;
}


/**
 * The nine things a founder can do with a period, generically.
 *
 * Nine so that every cadence has more to choose from than it can take — a list
 * of three in a yearly season is not a decision, it is a checklist. Said in the
 * market's own words by `foundersActions` below.
 *
 * ## Why these numbers, and why they were doubled
 *
 * The first set — three points for building, two for the rest — was too quiet
 * to notice. On a monthly season `founderPace` scales an action to a quarter of
 * a slot, so "build the next piece yourself" moved quality by 0.75 of a point
 * in a month against decay of about the same: a founder who did the work
 * themselves every month for a year watched their product go sideways. That is
 * not what that year is like, and it is not worth a decision.
 *
 * Doubled here rather than in `founderPace`, which was tried first and is the
 * wrong place: that function exists to make a year of work the same at every
 * cadence, and raising it to six made a yearly season play at twice strength
 * and broke its own invariant (its guard caught exactly that). Strength is what
 * an action is worth; pace is a correction. They are different numbers.
 *
 * Deliberately not one per axis. Quality gets three because building the thing
 * is what a founder actually spends their nights on, and a list that treated
 * "rewrite the worst part" and "answer the phone yourself" as equally likely
 * would be describing a company nobody runs.
 */
const SLOTS: readonly FounderAction[] = [
  { id: "build", name: "Build the next piece yourself", moves: "quality", amount: 20,
    blurb: "Your own evenings on the thing you would otherwise have paid somebody to build." },
  { id: "watch", name: "Watch somebody use it", moves: "quality", amount: 12,
    blurb: "Sit with ten of them and say nothing. Cheaper than research and much harder to ignore." },
  { id: "serve", name: "Answer every customer yourself", moves: "service", amount: 20,
    blurb: "No queue, no script, and you hear every complaint first-hand. It does not scale, which is the point of doing it now." },
  { id: "fix", name: "Put right what went wrong", moves: "reputation", amount: 18,
    /*
     * Reputation rather than quality, and it is the distinction the first set
     * missed: making the product better and being known as the company that
     * owns its mistakes are different weeks and different stats.
     */
    blurb: "Go back to everyone you let down, in public, and make it right. Costs nothing but your name is worth more afterwards." },
  { id: "chase", name: "Win back the ones who left", moves: "reputation", amount: 10,
    also: { moves: "service", amount: 6 },
    blurb: "Ring the people who stopped buying and ask why. Some come back, and all of them tell you something." },
  { id: "tell", name: "Tell people yourself", moves: "brand", amount: 20,
    /*
     * And the room for them. A month spent promoting that raised awareness and
     * not capacity won customers the company then turned away — the owner's
     * point exactly: hard work should put people through the door.
     */
    also: { moves: "reach", amount: 0.45 },
    blurb: "Knock on doors, post it everywhere, stand in the cold at an event. It brings people in, and it stops the day you stop." },
  { id: "story", name: "Get written about", moves: "brand", amount: 12,
    blurb: "One piece somewhere the people in this market actually read, earned rather than bought." },
  { id: "haggle", name: "Renegotiate what you pay", moves: "efficiency", amount: 0.18,
    blurb: "Go through every bill and every supplier yourself. Nobody else will ever care enough to do it properly." },
  { id: "stretch", name: "Work the hours", moves: "reach", amount: 0.7,
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
 * Why an action's `amount` is a *year* of it, and the period takes its share.
 *
 * A week's work has to mean the same amount of progress whether the table
 * files monthly, quarterly or yearly, or the cadence silently sets the
 * difficulty — and it did: counted straight, one action a month was twelve a
 * year against three in a yearly season, four times the work out of the same
 * calendar. Measured at £60,000 over two monthly years, the free lever was
 * worth +226% in dating apps and carried two markets that went bankrupt
 * without it.
 *
 * So each `amount` below is what a **year** of giving it the whole sixty hours
 * buys, and a period gets its share (`per`). A month of total dedication to
 * the product is a twelfth of forty points; twelve of them is forty. The
 * arithmetic is the same at every cadence and the numbers are readable as
 * "what a year of this is worth", which is the thing anyone balancing it
 * actually wants to know.
 */

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
export function founderEffects(
  /** Hours a week against each action's id — see `HOURS_A_WEEK`. */
  hours: Readonly<Record<string, number>>,
  niche: Pick<Niche, "id" | "voice" | "actions">,
  /** Periods in a year, as `resolveYear` is given it — 12, 4 or 1. */
  periods: number,
  share = 1,
): FounderEffects {
  const per = 1 / Math.max(1, periods);
  const held = Math.max(0, Math.min(1, share));
  const out: FounderEffects = { quality: 0, brand: 0, service: 0, reputation: 0, unitCost: 1, capacity: 1 };
  if (held <= 0) return out;

  const apply = (moves: FounderAction["moves"], amount: number) => {
    if (amount <= 0) return;
    if (moves === "quality") out.quality += amount;
    else if (moves === "brand") out.brand += amount;
    else if (moves === "service") out.service += amount;
    else if (moves === "reputation") out.reputation += amount;
    else if (moves === "efficiency") out.unitCost *= 1 - amount;
    else if (moves === "reach") out.capacity *= 1 + amount;
  };

  for (const action of foundersActions(niche)) {
    const put = Math.max(0, hours[action.id] ?? 0);
    if (put <= 0) continue;
    /*
     * An action's `amount` is what a whole week of nothing else buys. Half a
     * week buys half of it, which is what makes this a redistribution rather
     * than a checklist: sixty hours is sixty hours however it is cut up.
     */
    const of = (put / HOURS_A_WEEK) * per * held;
    apply(action.moves, action.amount * of);
    if (action.also) apply(action.also.moves, action.also.amount * of);
  }
  return out;
}

/**
 * The shelf's own lots, as things the week can go into.
 *
 * The owner's ask, and it is a better mechanic than it first looks: a founder
 * staring at a $27,500 edit bay they cannot afford has a third option besides
 * buying it and going without, which is building it. So every lot on this
 * period's shelf that `byHand` says is work becomes an option in the week
 * beside "build the next piece yourself", priced in hours instead of money.
 *
 * Ids are prefixed so they cannot collide with the nine standing actions and
 * so the engine can tell, from the id alone, that hours against this one are
 * going into a thing rather than into a stat.
 */
export const BUILD_PREFIX = "make:";

export const isBuild = (id: string): boolean => id.startsWith(BUILD_PREFIX);
export const buildListingId = (id: string): string => id.slice(BUILD_PREFIX.length);

export function buildableActions(
  shelf: readonly { id: string; asset: { name: string }; reserve: number; byHand?: { hoursAWeek: number } }[],
  money: (n: number) => string = (n) => `$${Math.round(n).toLocaleString()}`,
): FounderAction[] {
  return shelf
    .filter((l) => (l.byHand?.hoursAWeek ?? 0) > 0)
    .map((l) => ({
      id: `${BUILD_PREFIX}${l.id}`,
      name: `Make it yourself: ${l.asset.name}`,
      /*
       * The hours it wants and what it would otherwise cost, in one line,
       * because the decision is exactly that trade and nothing else.
       */
      blurb: `About ${l.byHand!.hoursAWeek} hours a week for a month and it is yours, instead of ${money(l.reserve)}. Give it more and it lands sooner and better; give it less and it takes longer and comes out simpler.`,
      /*
       * The axes are the asset's, not a slot's, so these carry no `moves` of
       * their own — the engine reads the listing. `quality` at nought keeps
       * the type honest without claiming an effect this does not have.
       */
      moves: "quality",
      amount: 0,
      asks: l.byHand!.hoursAWeek,
    }));
}

/**
 * The hours actually worked, from whatever was filed.
 *
 * Cleaned here rather than trusted, because the week is a rule of the game: a
 * filing claiming ninety hours on the product is scaled back to sixty, not
 * rejected and not honoured. Unknown ids are dropped, negatives and nonsense
 * read as nothing, and the total is capped — so neither a hand-written filing
 * nor a bot can work a hundred-hour week.
 *
 * Scaled down in proportion when over, rather than truncated in whatever order
 * the keys happen to be in: somebody who asks for forty hours on two things
 * meant an even split, and taking the first forty and discarding the rest
 * would be the engine picking for them.
 */
export function hoursTaken(
  filed: unknown,
  niche: Pick<Niche, "id" | "voice" | "actions">,
  /**
   * This period's make-it-yourself options, which are not standing actions —
   * they come and go with the shelf. Absent means none are on offer, so hours
   * filed against one buy nothing, which is the right answer for a filing that
   * names a lot that is no longer there.
   */
  builds: readonly string[] = [],
): Record<string, number> {
  const offered = new Set([...foundersActions(niche).map((a) => a.id), ...builds]);
  const out: Record<string, number> = {};
  if (!filed || typeof filed !== "object" || Array.isArray(filed)) return out;

  let total = 0;
  for (const [id, raw] of Object.entries(filed as Record<string, unknown>)) {
    if (!offered.has(id)) continue;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    out[id] = n;
    total += n;
  }
  if (total <= HOURS_A_WEEK) return out;

  const scale = HOURS_A_WEEK / total;
  for (const id of Object.keys(out)) out[id] = out[id] * scale;
  return out;
}

/** The hours on offer, as the desk hands them out: all of them, on nothing yet. */
export const noHours = (): Record<string, number> => ({});

/**
 * What the founders of each built-in market actually do with their week.
 *
 * Kept here rather than in `niches.ts` — already eight hundred lines of market
 * data — and keyed by niche id, exactly as `CATALOGUES` keys the asset shelf. A
 * custom market Nova writes brings its own list on `niche.actions` and never
 * reaches this table.
 *
 * **By position**, like `templatesFor`: entry *n* takes slot *n*'s economics and
 * only renames it. So the order is load-bearing, and a test holds every list at
 * nine entries against `ACTION_SLOTS`. Reordering one of these lists does not
 * reorder its effects — it moves a market's "answer every customer yourself"
 * onto "renegotiate what you pay", which is the bug the note in `assets.ts`
 * exists to prevent. These were reordered once, deliberately, when the slots
 * were rebuilt so that no two of them moved the same stat; the fourth entry in
 * every market was rewritten at the same time, because that slot stopped being
 * about the product and became about standing.
 *
 * The point of writing them out is that generic advice is not a decision. "Get
 * written about" is a thing a founder could do anywhere; "get the restaurant
 * reviewed by somebody people in this city actually read" is a thing somebody
 * rehearsing a restaurant recognises as their own week.
 */
export const WRITTEN_ACTIONS: Record<string, { name: string; blurb?: string }[]> = {
  dating_apps: [
    { name: "Write the matching yourself", blurb: "Your own nights on the one thing the whole app is: who it puts in front of whom." },
    { name: "Sit with ten subscribers while they swipe", blurb: "Say nothing and watch. You will learn more in an afternoon than from a quarter of analytics." },
    { name: "Moderate the reports yourself", blurb: "Every safety report, read by you, answered by you. Horrible, and the fastest way to find out what your app is actually like." },
    { name: "Go back to everyone you matched badly", blurb: "Message the people who had a bad time on your app, personally, and sort it out. They tell everyone either way." },
    { name: "Ring the people who deleted it", blurb: "Ask the ones who left why. Some reinstall, and all of them tell you something analytics never will." },
    { name: "Be in the bars on a Friday", blurb: "Hand out codes, buy a round, get it onto phones in front of you. Free, and it stops the day you stop." },
    { name: "Get one honest write-up", blurb: "One piece somewhere single people in this city actually read, earned rather than bought." },
    { name: "Renegotiate the cloud bill", blurb: "Go through every line of the infrastructure and SMS spend yourself. Nobody else will care enough to." },
    { name: "Run the Friday nights yourself", blurb: "Be on the servers at peak, by hand, every week. More people matched than the system could hold on its own." },
  ],
  drone_delivery: [
    { name: "Build the airframe fix yourself", blurb: "Your own evenings in the workshop on the thing you would otherwise have paid an engineer for." },
    { name: "Ride along on ten drops", blurb: "Follow the van, watch the handover, see where it actually goes wrong. Nothing in the telemetry shows you this." },
    { name: "Take the missing-drop calls yourself", blurb: "The day a parcel vanishes, you are the one on the phone. No script, no queue, no excuses passed along." },
    { name: "Make good on every drop you lost", blurb: "Turn up at the door, replace it yourself, apologise in person. Word travels in a village faster than any advert." },
    { name: "Win back the accounts that stopped", blurb: "Drive out to the ones who went quiet and ask why. Some come back and all of them tell you something." },
    { name: "Knock on the clinics' doors", blurb: "Pharmacies, surgeries, farm offices — in person, with a drone in the van. Free, and it only works while you keep going." },
    { name: "Get the local paper on a landing", blurb: "One piece about the village that now gets its prescriptions in nine minutes. Earned, not bought." },
    { name: "Renegotiate the insurance and the batteries", blurb: "Every premium and every supplier, line by line, by you. This is where the margin actually is." },
    { name: "Fly the weekends yourself", blurb: "Take the slots nobody else will, in weather nobody else likes. More drops a week, out of your own." },
  ],
  podcasts: [
    { name: "Cut the next episode yourself", blurb: "Your own nights in the edit instead of an editor's invoice. The show gets better where it is actually made." },
    { name: "Read the drop-off graphs properly", blurb: "Sit with where listeners stop, episode by episode, and change the thing that loses them." },
    { name: "Answer every listener yourself", blurb: "Every email, every review, every message. They talk about shows that talk back." },
    { name: "Own the episode you got wrong", blurb: "Say it on the feed, correct it properly, and credit whoever pulled you up. Listeners forgive it once you do." },
    { name: "Call the hosts who drifted off", blurb: "Ring the talent and the brands who stopped returning calls and ask what went wrong." },
    { name: "Go on everybody else's show", blurb: "Twenty guest spots on other people's feeds. Costs nothing but your weeks, and it is how podcasts actually grow." },
    { name: "Get into one newsletter that matters", blurb: "A single recommendation somewhere podcast listeners read, earned on the strength of the work." },
    { name: "Renegotiate hosting and the ad network", blurb: "Go through the CPM splits and the hosting tiers yourself. Nobody is going to offer you a better deal." },
    { name: "Record two at a time", blurb: "Double up the studio days and work the weekends. More shows made, out of your own hours." },
  ],
  restaurant_chain: [
    { name: "Develop the menu yourself", blurb: "Your own mornings in the kitchen on the dishes you would otherwise have paid a consultant to write." },
    { name: "Work the floor on a Saturday", blurb: "Watch forty tables eat without saying anything. Cheaper than a mystery shopper and much harder to ignore." },
    { name: "Take every complaint yourself", blurb: "Be the one who goes to the table when something is wrong. Does not scale, which is why it is worth doing now." },
    { name: "Go back to every table you got wrong", blurb: "Ring them, feed them again on you, and fix the thing in the kitchen. A bad night told well becomes a regular." },
    { name: "Call the regulars who stopped coming", blurb: "The ones who were in every week and have not been for two months. Ask, and some come back." },
    { name: "Feed people who have never heard of you", blurb: "Markets, street stalls, tastings, standing in the cold. Free, and it only works while you keep showing up." },
    { name: "Get reviewed by somebody local", blurb: "One write-up from a critic people in this city actually follow, earned rather than paid for." },
    { name: "Renegotiate with every supplier", blurb: "Produce, meat, linen, waste — every invoice, by you. This is where a restaurant's margin lives or dies." },
    { name: "Open the shifts nobody wants", blurb: "Early breakfasts, late kitchens, Sunday nights. More covers served, out of your own week." },
  ],
  construction: [
    { name: "Run the detailing yourself", blurb: "Your own evenings on the drawings and the method statements instead of paying it out to a consultant." },
    { name: "Walk ten finished jobs with the client", blurb: "Go back six months later and look at the work with the person paying for it. Nothing teaches faster." },
    { name: "Answer every client yourself", blurb: "One number, yours, answered on site. Turning up and still picking up is most of what this trade is judged on." },
    { name: "Put right every snag on your name", blurb: "Go back to the jobs you left imperfect, at your own cost, and finish them properly. This trade runs on who did that." },
    { name: "Chase the clients who never came back", blurb: "Ring the ones who used you once. Ask why it was only once." },
    { name: "Get in front of the people who award work", blurb: "Trade mornings, council tenders, quantity surveyors' offices. Shoe leather, and it only works while you do it." },
    { name: "Get one job into the trade press", blurb: "A single piece of work written up where developers in this region read it. Earned on the work itself." },
    { name: "Renegotiate materials and plant hire", blurb: "Every hire rate and every merchant account, gone through by you. Nobody else will push this hard." },
    { name: "Run the extra site yourself", blurb: "Take the job that needs a manager you cannot afford, and be the manager. More work in hand, out of your own hours." },
  ],
  project_saas: [
    { name: "Ship the next release yourself", blurb: "Your own nights on the roadmap instead of a contractor's rate card. Founders write the first good version of everything." },
    { name: "Watch ten teams onboard", blurb: "Sit in on the first hour of ten new accounts and say nothing. Every drop-off becomes obvious." },
    { name: "Take the support queue yourself", blurb: "Every ticket, answered by the person who can fix it. No tier one, no macros, and you hear everything first." },
    { name: "Own every outage in public", blurb: "Write the post-mortem yourself, tell them what broke and what you changed. Buyers read those before they sign." },
    { name: "Call the accounts that churned", blurb: "Ring every team that left and ask what happened. Some renew, and the rest tell you what to build." },
    { name: "Sell it yourself", blurb: "Cold outreach, demos, conference hallways, your own calendar. Free, and it stops the week you stop." },
    { name: "Get written up where buyers read", blurb: "One piece somewhere the people who sign for software actually look. Earned rather than sponsored." },
    { name: "Renegotiate every SaaS bill you pay", blurb: "Cloud, tooling, seats you forgot about. Go through the card statement line by line yourself." },
    { name: "Onboard the accounts nobody has time for", blurb: "Do the migrations yourself, at night. More seats live than the team could carry alone." },
  ],
  mmos: [
    { name: "Build the next content patch yourself", blurb: "Your own nights on the endgame instead of another contract designer. The best systems in this genre were made this way." },
    { name: "Play with ten of them, unannounced", blurb: "Roll an alt and group up with strangers for a weekend. You will learn what your game actually feels like." },
    { name: "Answer the tickets yourself", blurb: "Every rollback, every ban appeal, every lost item, by you. Brutal, and nothing else tells you this much." },
    { name: "Make good after the bad patch", blurb: "Say what went wrong, restore what it cost people, and do it before they ask. The forums remember who did." },
    { name: "Win back the ones who quit", blurb: "Message the lapsed accounts yourself and ask why they stopped. Some come back, and they all tell you something." },
    { name: "Be in the community yourself", blurb: "Discords, subreddits, streams, replies at two in the morning. Free, and it only works while you keep turning up." },
    { name: "Get one creator to cover it honestly", blurb: "A single video or piece from somebody this audience trusts, earned rather than paid for." },
    { name: "Renegotiate the server bill", blurb: "Go through the hosting, the bandwidth and the middleware licences yourself. Nobody else will read the contract." },
    { name: "Hold the launch weekend open yourself", blurb: "Be on the shards at peak, bringing capacity up by hand. More players held than the system manages alone." },
  ],
};
