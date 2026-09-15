import { projectVisual, PROJECT_VISUAL_SLOTS, type ProjectVisualSlot } from "@shared/project-visuals";

/**
 * One AI visual on the public project page, or nothing when that slot hasn't
 * been drawn. Placed inline beside the text it illustrates, so it can sit in
 * the markup unconditionally.
 */
export function ProjectVisual({ visuals, slot, className = "" }: {
  visuals: unknown;
  slot: ProjectVisualSlot;
  className?: string;
}) {
  const src = projectVisual(visuals, slot);
  if (!src) return null;
  const wide = PROJECT_VISUAL_SLOTS.find((s) => s.slot === slot)?.shape === "wide";
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={`w-full rounded-xl border border-border/60 bg-muted/30 object-cover ${wide ? "aspect-[3/2]" : "aspect-square"} ${className}`}
      data-testid={`project-visual-${slot}`}
    />
  );
}
