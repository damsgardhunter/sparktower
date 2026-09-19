/**
 * The decks the middle rounds are played with.
 *
 * Cards rather than text boxes, because "who is this for?" typed into an empty
 * field gets you "everyone" or "young professionals" — an answer that sounds
 * like a customer and commits to nothing. A card forces a choice with edges:
 * picking night-shift nurses means not picking commuting students, and the
 * argument about which one is the game.
 *
 * ## What makes a good card here
 *
 * Every card is **specific enough to be wrong**. That is the whole design
 * rule. "Small businesses" is not a card; "family restaurants that still take
 * bookings by phone" is, because you can immediately tell whether your idea
 * fits it, and so can the stranger you are arguing with.
 *
 * Each also carries a plain consequence — what picking it actually does to the
 * company — so that a player with no startup experience is choosing between
 * described trade-offs rather than guessing which card the game wants.
 *
 * Players can always invent their own; see `customCard`. The deck is a prompt,
 * not a cage.
 */

export interface Card {
  id: string;
  /** Short enough to read at a glance on a phone. */
  label: string;
  /** The specific version of the label — what actually distinguishes them. */
  detail: string;
  /** What picking this does to the company, in plain words. */
  consequence: string;
  /** Grouping for the deck UI, so twenty cards don't read as a wall. */
  group: string;
}

// ─── Round 2: who is it for ──────────────────────────────────────────────────

/**
 * Customers.
 *
 * Deliberately weighted away from the default startup answer, which is "people
 * like me": one deck of eighteen where only a couple are young urban
 * professionals with disposable income. Most businesses that make money serve
 * somebody the people building them would never have thought of.
 */
export const CUSTOMER_CARDS: Card[] = [
  // People at work
  {
    id: "night-nurses", label: "Night-shift nurses", group: "At work",
    detail: "Three twelve-hour nights a week, phone in a pocket, no time to learn anything.",
    consequence: "Brutal reliability bar and no patience for onboarding — but they tell each other everything, so one ward adopting you takes the rest.",
  },
  {
    id: "phone-restaurants", label: "Restaurants that still take bookings by phone", group: "At work",
    detail: "Family-run, one manager, a paper diary by the till.",
    consequence: "Cheap to reach and desperate for help, but they will not pay much and they churn when the manager's nephew builds something free.",
  },
  {
    id: "site-foremen", label: "Construction foremen", group: "At work",
    detail: "Runs a site of thirty people from a truck, gloves on, signal patchy.",
    consequence: "Real budget and real urgency. Needs to work offline and survive being dropped in mud.",
  },
  {
    id: "indie-truckers", label: "Owner-operator truckers", group: "At work",
    detail: "Owns one lorry, is the driver, the dispatcher and the accountant.",
    consequence: "Pays for anything that saves a night away from home. Almost impossible to reach except through other truckers.",
  },
  {
    id: "school-admins", label: "School office administrators", group: "At work",
    detail: "The one person who knows where everything is, in a building of six hundred.",
    consequence: "Enormous loyalty and a nine-month sales cycle that only opens twice a year.",
  },
  {
    id: "salon-owners", label: "Independent salon owners", group: "At work",
    detail: "Two chairs, a booking book, and a following that moves with them.",
    consequence: "Fast to say yes, fast to leave, and their clients are a free distribution channel if you earn it.",
  },

  // People at home
  {
    id: "new-parents", label: "Parents in the first year", group: "At home",
    detail: "Sleep-deprived, suddenly spending money they used to save.",
    consequence: "Will buy almost anything that promises an hour back. Grows out of you in about eighteen months.",
  },
  {
    id: "carers", label: "People caring for a parent", group: "At home",
    detail: "Holding down a job while managing somebody else's appointments and medication.",
    consequence: "Deep, unmet need and very little time to evaluate you. Word of mouth through support groups is everything.",
  },
  {
    id: "renters-moving", label: "People moving flat every year", group: "At home",
    detail: "Twenties, third address in four years, owns nothing heavy.",
    consequence: "Cheap to acquire, moves fast, and genuinely churns — the problem disappears the moment they settle down.",
  },
  {
    id: "allotment-growers", label: "Allotment and smallholding growers", group: "At home",
    detail: "Grows more food than they can eat, gives the rest away.",
    consequence: "Passionate, organised into local groups, and constitutionally opposed to paying subscriptions.",
  },
  {
    id: "hobby-restorers", label: "People restoring one old thing", group: "At home",
    detail: "A motorbike, a boat, a house. Years into it. Knows more than you.",
    consequence: "Will spend serious money on the right part and will publicly destroy you if the quality is off.",
  },
  {
    id: "retired-tinkerers", label: "The recently retired", group: "At home",
    detail: "Time, some savings, and a strong preference for talking to a person.",
    consequence: "High trust once earned, expensive to support, and almost never churns.",
  },

  // People in trouble
  {
    id: "first-landlords", label: "Accidental landlords", group: "Out of their depth",
    detail: "Inherited or couldn't sell. Now legally responsible for a building they don't understand.",
    consequence: "Pays for someone to tell them they are not about to be fined. Small market, high willingness to pay.",
  },
  {
    id: "small-importers", label: "One-person importers", group: "Out of their depth",
    detail: "Buys forty crates of something abroad and sells it here, alone.",
    consequence: "Cash-flow fragile and paperwork-drowned. If you fix the paperwork they will never leave.",
  },
  {
    id: "new-managers", label: "First-time managers", group: "Out of their depth",
    detail: "Was good at the job, now responsible for six people and nobody told them how.",
    consequence: "Their employer has the budget, which means selling to a company while serving a person.",
  },
  {
    id: "recent-migrants", label: "People who arrived last year", group: "Out of their depth",
    detail: "Rebuilding a credit history, a network and a set of documents from nothing.",
    consequence: "Urgent need, thin wallets, and a community that spreads what works faster than any advertising.",
  },

  // The ones everybody picks
  {
    id: "young-professionals", label: "Young professionals in big cities", group: "The obvious ones",
    detail: "Salaried, app-literate, already subscribed to eleven things.",
    consequence: "Easy to reach and easy to sell to, which is exactly why your acquisition costs will be bid up by everyone else chasing them.",
  },
  {
    id: "small-startups", label: "Startups under ten people", group: "The obvious ones",
    detail: "Will try anything once, can't pay much, may not exist next year.",
    consequence: "Fast feedback and fast growth on paper. A customer base that evaporates in a downturn.",
  },
];

// ─── Round 3: how it makes money ─────────────────────────────────────────────

/**
 * Business models.
 *
 * The consequences here are where most of the game's teaching happens. Almost
 * every pair reaches for a subscription because that is the model they have
 * seen; the card says plainly what that costs you, and the ones next to it
 * make the alternatives legible rather than exotic.
 */
export const MODEL_CARDS: Card[] = [
  {
    id: "subscription", label: "Monthly subscription", group: "They pay you regularly",
    detail: "A flat fee every month, cancel any time.",
    consequence: "Predictable revenue and a valuation multiple to match — if people stay. Every month you must re-earn it, and churn quietly eats growth.",
  },
  {
    id: "annual-contract", label: "Annual contract", group: "They pay you regularly",
    detail: "Paid up front for the year, signed by somebody senior.",
    consequence: "Cash on day one and a customer who can't drift away. Months of selling before a penny arrives.",
  },
  {
    id: "usage", label: "Pay for what you use", group: "They pay you regularly",
    detail: "Metered — per message, per delivery, per gigabyte.",
    consequence: "Grows by itself when customers grow, and collapses with them. Nobody can predict next quarter, including you.",
  },
  {
    id: "marketplace", label: "Take a cut", group: "You sit in the middle",
    detail: "Buyers and sellers meet on you; you keep a percentage.",
    consequence: "Enormous if it works, because both sides pull each other in. You have to solve two cold starts at once, and both sides will try to go around you.",
  },
  {
    id: "lead-gen", label: "Sell the introduction", group: "You sit in the middle",
    detail: "Free for the customer; businesses pay for the qualified lead.",
    consequence: "Revenue before you have a product. Your incentives and your users' quietly diverge from day one.",
  },
  {
    id: "ads", label: "Advertising", group: "You sit in the middle",
    detail: "Free to use, funded by people who want your users' attention.",
    consequence: "No price objection, ever. Needs a scale most companies never reach, and until you do you earn approximately nothing.",
  },
  {
    id: "hardware-consumable", label: "Cheap device, expensive refills", group: "They buy a thing",
    detail: "Sell the machine near cost, make it on what it eats.",
    consequence: "Beautiful margins locked in for years. Enormous up-front cost, and somebody will make a cheaper refill.",
  },
  {
    id: "one-off", label: "Buy it once", group: "They buy a thing",
    detail: "A price, a purchase, it's theirs.",
    consequence: "Honest and easy to sell. You start every year at zero, and investors will mark you down for it.",
  },
  {
    id: "wholesale", label: "Sell through other shops", group: "They buy a thing",
    detail: "Retailers buy from you in bulk and mark it up.",
    consequence: "Volume without building an audience. You lose the customer relationship, the margin, and any idea of who is actually buying.",
  },
  {
    id: "freemium", label: "Free, with a paid tier", group: "Free first",
    detail: "Most people never pay. A few pay for the part that matters to them.",
    consequence: "Growth without a sales team. You fund everyone who never pays, and the free tier competes with the paid one forever.",
  },
  {
    id: "licensing", label: "License it to bigger companies", group: "Free first",
    detail: "You build the thing; somebody else's brand is on the front.",
    consequence: "Few customers, large cheques, small team. Two of them leaving is an extinction event.",
  },
  {
    id: "services-first", label: "Do it by hand, charge properly", group: "Free first",
    detail: "Sell the outcome as a service now; automate it behind the scenes later.",
    consequence: "Profitable almost immediately and teaches you exactly what to build. Very hard to stop doing, and it does not look like a startup to anybody funding one.",
  },
];

// ─── Round 5: where the million goes ─────────────────────────────────────────

export interface SpendOption {
  id: string;
  label: string;
  detail: string;
  /** What this buys, and what skipping it costs. */
  consequence: string;
  group: "Hiring" | "Product" | "Getting customers" | "Keeping it standing";
  /** Sensible granularity for the slider, in dollars. */
  step: number;
  /** Below this it doesn't buy anything real — a quarter-hire is not a hire. */
  minimumUseful: number;
}

/**
 * Where a million dollars can go in a first year.
 *
 * The amounts are real enough to teach: a senior engineer for a year genuinely
 * is a sixth of this budget, and finding that out by watching the bar move is
 * the point of the round. Every option carries what *not* funding it costs,
 * because a budget screen where every choice sounds good is a slot machine.
 */
export const SPEND_OPTIONS: SpendOption[] = [
  {
    id: "first-engineer", label: "A senior engineer", group: "Hiring",
    detail: "One person who can build the whole thing and has done it before.",
    consequence: "The fastest way to a product that exists. Also the single most expensive line on this page.",
    step: 10_000, minimumUseful: 120_000,
  },
  {
    id: "junior-team", label: "Two juniors", group: "Hiring",
    detail: "Cheaper, keen, and needing somebody to tell them what to do.",
    consequence: "More hands for the money. Costs you the senior person's time, which is the resource you have least of.",
    step: 10_000, minimumUseful: 90_000,
  },
  {
    id: "designer", label: "A designer", group: "Hiring",
    detail: "Someone who decides what it looks like and how it works before it is built.",
    consequence: "Cuts the amount you build twice. Hard to justify on day one and obvious in hindsight.",
    step: 10_000, minimumUseful: 70_000,
  },
  {
    id: "salesperson", label: "A salesperson", group: "Hiring",
    detail: "Someone whose entire job is talking to people who might pay you.",
    consequence: "The only line here that brings money back in year one. Useless if the product isn't ready for them to sell.",
    step: 10_000, minimumUseful: 80_000,
  },
  {
    id: "ops-hire", label: "An operations hire", group: "Hiring",
    detail: "The person who makes the delivering, supporting and invoicing actually happen.",
    consequence: "Buys back the founders' week. Invisible on a pitch deck and the reason companies stop falling over.",
    step: 10_000, minimumUseful: 60_000,
  },

  {
    id: "build-product", label: "Building the product", group: "Product",
    detail: "Contractors, tools, infrastructure — the cost of the thing existing.",
    consequence: "Nothing else on this page matters if there is nothing to sell. Overspend and you have a beautiful product nobody has heard of.",
    step: 10_000, minimumUseful: 50_000,
  },
  {
    id: "rnd", label: "Research into the hard part", group: "Product",
    detail: "The bit nobody has solved, that your whole advantage rests on.",
    consequence: "If it works, it is the reason you are worth anything in ten years. It may simply not work.",
    step: 10_000, minimumUseful: 60_000,
  },
  {
    id: "assets", label: "Premises and equipment", group: "Product",
    detail: "Land, a unit, machines — things you own rather than rent.",
    consequence: "Real assets on the balance sheet and a moat competitors have to fund too. Money you cannot get back quickly if you are wrong.",
    step: 25_000, minimumUseful: 100_000,
  },

  {
    id: "marketing", label: "Marketing", group: "Getting customers",
    detail: "Advertising, content, whatever it takes to be findable.",
    consequence: "The fastest way to find out whether anybody wants this. Also the fastest way to spend a million dollars on nothing.",
    step: 10_000, minimumUseful: 40_000,
  },
  {
    id: "community", label: "Building a community", group: "Getting customers",
    detail: "Events, a forum, showing up where your customers already are.",
    consequence: "Slow, cheap, and the only acquisition channel that gets cheaper over time rather than more expensive.",
    step: 5_000, minimumUseful: 20_000,
  },
  {
    id: "pilots", label: "Paid pilots", group: "Getting customers",
    detail: "Subsidising the first handful of customers to use it properly.",
    consequence: "Turns strangers into references, which is how you sell to everyone after them. You are paying people to be your customer.",
    step: 10_000, minimumUseful: 30_000,
  },

  {
    id: "legal", label: "Legal and compliance", group: "Keeping it standing",
    detail: "Incorporation, contracts, licences, whatever your industry demands.",
    consequence: "Deeply boring and the difference between a company and a hobby. Skipping it in a regulated market ends the story early.",
    step: 5_000, minimumUseful: 25_000,
  },
  {
    id: "ip", label: "Protecting what you invent", group: "Keeping it standing",
    detail: "Patents, trademarks, the paperwork that makes an idea yours.",
    consequence: "Worth a great deal at an acquisition and nothing at all before one. Money spent on a future you may not reach.",
    step: 5_000, minimumUseful: 20_000,
  },
  {
    id: "runway", label: "Keep it in the bank", group: "Keeping it standing",
    detail: "Unspent. Months of survival if the first plan is wrong.",
    consequence: "The least exciting square on this board and the reason some companies get a second attempt.",
    step: 10_000, minimumUseful: 0,
  },
];

// ─── Cards players invent ────────────────────────────────────────────────────

/** How many of their own a pair may add to a deck. */
export const MAX_CUSTOM_CARDS = 4;

export const CUSTOM_CARD_PREFIX = "custom:";

export const isCustomCard = (id: string) => id.startsWith(CUSTOM_CARD_PREFIX);

/**
 * A card the players wrote.
 *
 * The deck is a prompt, not a cage: the best answer is often somebody the
 * people playing actually know and nobody writing a deck would think of. Kept
 * to the same shape as a dealt card so everything downstream — the vote, the
 * settlement, what gets sent to the valuation — cannot tell the difference.
 */
export function customCard(input: {
  label: string;
  detail?: string;
  index: number;
  /**
   * Who invented it. Part of the id, and not optional.
   *
   * Without it both players' first invention was `custom:0`. The round settles
   * by comparing card ids, so one player writing "my old football coach" and
   * the other writing "my landlord" read as the same pick: the round closed as
   * *agreed*, on a customer neither of them had chosen, and the screen told
   * them they had both gone for it. Two people inventing different people must
   * never collide.
   */
  owner: string;
}): Card {
  const label = input.label.trim().slice(0, 80);
  return {
    id: `${CUSTOM_CARD_PREFIX}${input.owner}:${input.index}`,
    label,
    detail: (input.detail ?? "").trim().slice(0, 200),
    consequence: "Your own. The valuation will take it as seriously as the rest.",
    group: "Yours",
  };
}

export const cardById = (deck: readonly Card[], id: string): Card | undefined =>
  deck.find((c) => c.id === id);

/** The decks, by the round that uses them. */
export const DECKS = {
  customer: CUSTOMER_CARDS,
  model: MODEL_CARDS,
} as const;
