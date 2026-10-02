/**
 * The phone's copy of `shared/backing.ts`'s reward catalogue.
 *
 * Its own module, with no imports, so `test/unit/mobile-mirror.test.ts` can check
 * the two agree about which rewards exist — `BackingSummary.tsx`, where this
 * lived, reaches for React Native and the test runner cannot parse that.
 *
 * `available: false` marks a reward the platform cannot deliver. Two are: a
 * wallpaper and a profile frame, both declared as things *we* generate, with
 * nothing anywhere that does. Kept rather than deleted because tiers saved while
 * they were on the menu still name them, and a key the catalogue has never heard
 * of renders to a backer as the raw string.
 */

export const DIGITAL_REWARDS: { key: string; label: string; description: string; fulfilledBy: "platform" | "creator"; available?: boolean }[] = [
  { key: "backer_wall", label: "Name on the backer wall", description: "Their name listed on the project's public page.", fulfilledBy: "platform" },
  { key: "believer_number", label: "Believer number", description: "Backer #0047. A low number costs you nothing and people genuinely care.", fulfilledBy: "platform" },
  { key: "digital_badge", label: "Digital badge", description: "A badge on their account showing they backed you, and how early.", fulfilledBy: "platform" },
  { key: "profile_frame", label: "Profile frame", description: "A ring around their avatar in your project's colours.", fulfilledBy: "platform", available: false },
  { key: "wallpaper", label: "Wallpaper", description: "Downloadable wallpaper with your logo and the tagline.", fulfilledBy: "platform", available: false },
  { key: "certificate", label: "Printable certificate", description: "A dated certificate they can actually print and pin up.", fulfilledBy: "platform", available: false },
  { key: "founding_believer", label: "Founding believer credit", description: "A permanent marker on their profile naming them as an early backer.", fulfilledBy: "platform" },
  { key: "early_access", label: "Early access", description: "First through the door on whatever you ship next.", fulfilledBy: "creator" },
  { key: "video_thankyou", label: "Personal video thank-you", description: "You record and send a short personal thank-you. This one is real work — don't put it on a rung you'll regret.", fulfilledBy: "creator" },
];

/** The ones a creator may still offer. */
export const OFFERABLE_DIGITAL_REWARDS = DIGITAL_REWARDS.filter((r) => r.available !== false);

/** Whether a key still names something a backer would receive. */
export const isRewardAvailable = (key: string): boolean =>
  DIGITAL_REWARDS.find((r) => r.key === key)?.available !== false;

/** A saved tier's rewards with the withdrawn ones dropped, so no undeliverable promise is advertised. */
export const deliverableRewards = (keys: readonly string[] | null | undefined): string[] =>
  (keys ?? []).filter(isRewardAvailable);
