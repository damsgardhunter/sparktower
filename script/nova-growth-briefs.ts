/**
 * Nine projects to build seasons around: three channels, three SaaS startups,
 * three restaurants.
 *
 * Separate from the harness so the briefs can be read and changed without
 * touching the measurement, and so a diff to one is obvious. Three of each
 * category rather than one because a single generated market tells you about
 * that market and nothing about the category — the first YouTube season Nova
 * wrote had quality floors a year-one company could not reach, and only a
 * second and third showed whether that was the category or the dice.
 */
export interface Brief {
  id: string;
  category: "channel" | "saas" | "restaurant";
  project: {
    title: string;
    description: string;
    goal: string;
    category: string;
    subcategory: string;
  };
}

export const BRIEFS: Brief[] = [
  {
    id: "channel-golf",
    category: "channel",
    project: {
      title: "Fairway Fools",
      description: "A comedy-first golf YouTube channel: two friends playing municipal courses badly, with challenges, trick shots that fail, and guest rounds with other creators. Fast editing, in-jokes, no instruction.",
      goal: "Get to a living wage from ads, memberships and one sponsor a month.",
      category: "Media", subcategory: "channel",
    },
  },
  {
    id: "channel-repair",
    category: "channel",
    project: {
      title: "Second Life Workshop",
      description: "A repair channel: dead appliances, tools and consoles brought back on camera, with the real cost and the real failures left in. Long-form, quiet, heavy on process.",
      goal: "Build an audience that trusts the work enough to buy a parts kit.",
      category: "Media", subcategory: "channel",
    },
  },
  {
    id: "channel-cooking",
    category: "channel",
    project: {
      title: "One Pan, One Pay Cheque",
      description: "Cooking for people who are broke: every recipe under four pounds a head, shot in a real rented kitchen, with the shopping receipt on screen.",
      goal: "Enough of an audience to sell a book and take brand deals that fit.",
      category: "Media", subcategory: "channel",
    },
  },
  {
    id: "saas-rota",
    category: "saas",
    project: {
      title: "Shiftwise",
      description: "Rota software for small hospitality: pubs, cafes and one-site restaurants. Build a week's shifts in ten minutes, let staff swap on their phones, and push the hours straight into payroll.",
      goal: "Two hundred paying sites and a renewal rate that lets us hire.",
      category: "Software", subcategory: "saas",
    },
  },
  {
    id: "saas-invoice",
    category: "saas",
    project: {
      title: "Chaseless",
      description: "Invoice chasing for tradespeople: it watches the bank feed, works out who has not paid, and sends the polite reminder you were never going to write. One screen, no accounting jargon.",
      goal: "Enough recurring revenue to stop contracting.",
      category: "Software", subcategory: "saas",
    },
  },
  {
    id: "saas-clinic",
    category: "saas",
    project: {
      title: "Waitless",
      description: "Booking and reminders for independent clinics — physio, dental, veterinary. Cuts no-shows with a text that is actually readable, and books the gap it just made.",
      goal: "Sell to a hundred clinics and prove the no-show numbers.",
      category: "Software", subcategory: "saas",
    },
  },
  {
    id: "restaurant-pizza",
    category: "restaurant",
    project: {
      title: "Dough & Co",
      description: "One shopfront pizzeria on a high street: sourdough bases, six toppings, a counter and twelve covers. Takeaway at the window, delivery through one app only.",
      goal: "Fill the room on weekends and open a second site.",
      category: "Food", subcategory: "food",
    },
  },
  {
    id: "restaurant-brunch",
    category: "restaurant",
    project: {
      title: "The Long Table",
      description: "An all-day brunch room in a converted unit: thirty covers, one menu, everything made in-house. Queues at the weekend and dead on a Tuesday, which is the problem to solve.",
      goal: "Trade profitably midweek and stop losing the Tuesday rent.",
      category: "Food", subcategory: "food",
    },
  },
  {
    id: "restaurant-curry",
    category: "restaurant",
    project: {
      title: "Amma's",
      description: "A family South Indian storefront: dosa and tiffin, eight tables, counter service, and a weekend queue down the pavement. No alcohol, no delivery apps yet.",
      goal: "Get the weekday lunch trade the office block above us should be giving.",
      category: "Food", subcategory: "food",
    },
  },
];
