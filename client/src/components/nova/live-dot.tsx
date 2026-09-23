/**
 * The dot that says this screen is watching something.
 *
 * A ping ring behind a solid dot: it reads as "live" at a glance without a
 * word, which is the whole job. Inactive, it stops moving and goes quiet
 * rather than disappearing — a screen that was live a moment ago and is now
 * silent should say so, not leave a gap where the signal was.
 *
 * ## Why it takes props at all
 *
 * It was hand-written in five places before this, and no two were the same:
 * dots of 2 and 2.5, rings at 40%, 60% and 75% opacity, and three different
 * greens. None of those differences meant anything — they were the accidents
 * of five people eyeballing the same idea. The two that *did* mean something
 * are here as props: how big, and whether the thing being watched is healthy.
 * Everything else is fixed, so a live dot is a live dot.
 */
import { NOVA_GRADIENT } from "./tokens";

export interface LiveDotProps {
  /** Pinging, or quiet. Off is a real state: watched, and nothing happening. */
  active?: boolean;
  /**
   * `sm` (2) inline with small print, `md` (2.5) as a standalone indicator.
   * Nothing bigger: past this it stops reading as a status light.
   */
  size?: "sm" | "md";
  /**
   * `warn` for a screen that is still watching but has stopped getting
   * answers. Amber rather than the gradient, because a live dot in Nova's
   * colours on a feed that is failing to refresh is the screen claiming to be
   * fine while it is not.
   */
  tone?: "nova" | "warn";
  className?: string;
  "aria-label"?: string;
}

export function LiveDot({ active = true, size = "sm", tone = "nova", className = "", ...rest }: LiveDotProps) {
  const box = size === "md" ? "h-2.5 w-2.5" : "h-2 w-2";
  const fill = tone === "warn" ? "bg-amber-500" : active ? NOVA_GRADIENT : "bg-muted-foreground/40";
  const ring = tone === "warn" ? "bg-amber-400" : "bg-emerald-400";

  return (
    <span className={`relative flex ${box} shrink-0 ${className}`} {...rest}>
      {/*
        * Only while active: a permanently pinging dot on a stalled screen is a
        * lie, and it costs battery to tell.
        */}
      {active && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${ring} opacity-60`} />}
      <span className={`relative inline-flex ${box} rounded-full ${fill}`} />
    </span>
  );
}
