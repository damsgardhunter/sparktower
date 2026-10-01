/**
 * Nova's kit on the phone, named as the web names it
 * (`client/src/components/nova/index.ts`), so a component that exists on both
 * is imported by the same name from the same place.
 *
 * `Working`, `Loading` and `Field` already existed in the phone's own kit and
 * are re-exported rather than moved: the import path becomes the web's without
 * touching the forty call sites that use the old one.
 *
 * Deliberately not here, and why — `nova-kit-parity.test.ts` holds this list so
 * it cannot quietly become untrue:
 *
 *   - **Pill.** The web's takes a `tone` of good / warn / bad / info / neutral /
 *     unknown. The phone has *three* components called Pill — in `MoreKit`,
 *     `FeaturedContest` and `profile/kit` — and none of them has a tone system;
 *     they take a colour, a variant or a `gold` flag. Exporting one of them as
 *     "the" Pill would be picking a winner by import order. The fix is one Pill
 *     with the web's tones and three call sites migrated onto it, which is a
 *     change worth making on its own rather than inside this one.
 *   - **Block.** The phone's lives in `ProjectBits` and is a titled section with
 *     an action, where the web's is a surface primitive. Same word, different
 *     component; checking which of the two is wanted is the work.
 *   - **tokens.** The web's are Tailwind class strings, which mean nothing here.
 *     The phone's equivalents are `colors.novaGreen/Emerald/Purple` in the
 *     theme, held to the web's values by `nova-gradient-parity.test.ts`.
 */
export { LiveDot } from "./LiveDot";
export { NovaRing } from "./NovaRing";
export { Glance, GlanceStat, GlanceAction } from "./Glance";
export { NovaIntro } from "./NovaIntro";
export { Working, type WorkingStage } from "../Working";
export { Field, Loading } from "../ui";
