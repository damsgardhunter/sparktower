/**
 * What a contest is allowed to say about itself.
 *
 * Shared because the admin form and the route that accepts it have to agree.
 * A contest is the one object on the site that an administrator creates *for*
 * other people: it appears in everyone's main navigation, invites entries, and
 * promises a prize. So the checks here are less about malformed input than
 * about a contest that cannot be run — a window that ends before it starts, a
 * maximum of nobody, a judging deadline with no entrants possible.
 */

export const CONTEST_DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
export type ContestDifficulty = (typeof CONTEST_DIFFICULTIES)[number];

export const CONTEST_STATUSES = ["upcoming", "active", "judging", "completed"] as const;
export type ContestStatus = (typeof CONTEST_STATUSES)[number];

export const CONTEST_TITLE_MAX = 120;
export const CONTEST_DESCRIPTION_MAX = 4000;
export const CONTEST_PRIZE_MAX = 200;
export const CONTEST_CATEGORY_MAX = 60;
/** A ceiling on `maxParticipants`, so a typo can't make a contest that never fills. */
export const CONTEST_MAX_PARTICIPANTS = 10_000;

export interface ContestInput {
  title: string;
  description: string;
  category: string;
  difficulty: ContestDifficulty;
  status: ContestStatus;
  prize: string | null;
  badgeId: string | null;
  startDate: Date;
  endDate: Date;
  maxParticipants: number | null;
  promoted: boolean;
}

export type ContestValidation =
  | { ok: true; value: ContestInput }
  | { ok: false; message: string; field: string };

const text = (v: unknown) => (v == null ? "" : String(v)).trim();

const asDate = (v: unknown): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function validateContestInput(raw: Record<string, unknown>): ContestValidation {
  const title = text(raw.title);
  if (!title) return { ok: false, message: "Give the contest a name.", field: "title" };
  if (title.length > CONTEST_TITLE_MAX) return { ok: false, message: `Keep the name under ${CONTEST_TITLE_MAX} characters.`, field: "title" };

  const description = text(raw.description);
  if (!description) return { ok: false, message: "Say what entrants are being asked to do.", field: "description" };
  if (description.length > CONTEST_DESCRIPTION_MAX) return { ok: false, message: `That's longer than ${CONTEST_DESCRIPTION_MAX} characters.`, field: "description" };

  const category = text(raw.category);
  if (!category) return { ok: false, message: "Pick a category.", field: "category" };
  if (category.length > CONTEST_CATEGORY_MAX) return { ok: false, message: "That category is too long.", field: "category" };

  const difficulty = text(raw.difficulty) || "intermediate";
  if (!(CONTEST_DIFFICULTIES as readonly string[]).includes(difficulty)) {
    return { ok: false, message: "Pick a difficulty.", field: "difficulty" };
  }
  const status = text(raw.status) || "upcoming";
  if (!(CONTEST_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, message: "Pick a status.", field: "status" };
  }

  const startDate = asDate(raw.startDate);
  if (!startDate) return { ok: false, message: "Say when it opens.", field: "startDate" };
  const endDate = asDate(raw.endDate);
  if (!endDate) return { ok: false, message: "Say when it closes.", field: "endDate" };
  /*
   * The check that matters. A contest whose window is backwards is accepted
   * happily by the database and then behaves like a contest that is
   * permanently over: the page shows it, people can still join it, and nobody
   * can work out why it never opens.
   */
  if (endDate.getTime() <= startDate.getTime()) {
    return { ok: false, message: "It has to close after it opens.", field: "endDate" };
  }

  const prizeText = text(raw.prize);
  if (prizeText.length > CONTEST_PRIZE_MAX) return { ok: false, message: "Keep the prize line short.", field: "prize" };

  let maxParticipants: number | null = null;
  if (raw.maxParticipants != null && text(raw.maxParticipants) !== "") {
    const n = Number(raw.maxParticipants);
    if (!Number.isInteger(n) || n < 1 || n > CONTEST_MAX_PARTICIPANTS) {
      return { ok: false, message: `A cap has to be between 1 and ${CONTEST_MAX_PARTICIPANTS}, or left empty for no cap.`, field: "maxParticipants" };
    }
    maxParticipants = n;
  }

  return {
    ok: true,
    value: {
      title, description, category,
      difficulty: difficulty as ContestDifficulty,
      status: status as ContestStatus,
      prize: prizeText || null,
      badgeId: text(raw.badgeId) || null,
      startDate, endDate, maxParticipants,
      promoted: raw.promoted === true || raw.promoted === "true",
    },
  };
}
