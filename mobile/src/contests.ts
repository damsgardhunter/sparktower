/**
 * The limits a contest is held to, restated for the phone.
 *
 * A copy of the parts of `shared/contests.ts` the admin screen needs, because
 * Metro will not resolve `@shared`.
 * `test/unit/admin-contests-and-promotions-on-the-phone.test.ts` holds them
 * against the originals.
 */
export const CONTEST_DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
export const CONTEST_STATUSES = ["upcoming", "active", "judging", "completed"] as const;
export const CONTEST_TITLE_MAX = 120;
export const CONTEST_DESCRIPTION_MAX = 4000;
export const CONTEST_PRIZE_MAX = 200;
export const CONTEST_CATEGORY_MAX = 60;
