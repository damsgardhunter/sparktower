/**
 * The Nova look, as components.
 *
 * Everything here came out of the Codebase tab, which is the screen this
 * product got right: it says what the machine is doing while it does it, it
 * answers "where am I and what now" in one strip, and it is short. The rest of
 * the site is being brought to the same shape — docs/ui-consistency.md tracks
 * which screens have been and which have not.
 */
export { NOVA_GRADIENT, NOVA_GRADIENT_BR, NOVA_TINT, GLANCE_LABEL } from "./tokens";
export { LiveDot } from "./live-dot";
export { Working, Loading, type WorkingStage, type WorkingProps } from "./working";
export { Glance, GlanceStat, GlanceAction } from "./glance";
export { Pill, PILL_TONE, type PillTone } from "./pill";
export { Block } from "./block";
export { Field, NovaInput, NovaTextarea, NOVA_FIELD_CLASS, type FieldProps } from "./field";
