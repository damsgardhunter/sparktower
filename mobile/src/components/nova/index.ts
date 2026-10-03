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
 *   - **Block.** The phone's titled-section-with-an-action is `ProjectSection` in
 *     `ProjectBits` now — renamed on 2026-10-03, because four components shared
 *     the word: that one, another in `manage/bits` taking different props, and the
 *     web's `section/block` (a surface primitive) and `nova/block` (a counted
 *     panel). `manage/bits`'s keeps the name for the moment, with thirty-six files
 *     importing it. Still not merged with the web's: a titled section and a
 *     surface primitive are not the same kind of thing.
 *   - **tokens.** The web's are Tailwind class strings, which mean nothing here.
 *     The phone's equivalents are `colors.novaGreen/Emerald/Purple` in the
 *     theme, held to the web's values by `nova-gradient-parity.test.ts`.
 */
export { LiveDot } from "./LiveDot";
export { NovaRing } from "./NovaRing";
export { Pill, PILL_TONE, type PillTone } from "./Pill";
export { Glance, GlanceStat, GlanceAction } from "./Glance";
export { NovaIntro } from "./NovaIntro";
export { Working, type WorkingStage } from "../Working";
export { Field, Loading } from "../ui";
