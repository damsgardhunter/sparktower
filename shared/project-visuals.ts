/**
 * AI visuals for the public project page.
 *
 * A project page is mostly prose. These are five images, drawn from the
 * project's own logo (the main reference) and cover, each placed next to a
 * block of text so the page reads as a page rather than a document.
 *
 * The slot is where the image sits, and it also decides what the image is
 * *of* — the one under the one-liner illustrates the pitch, the one under
 * "What Success Looks Like" illustrates the outcome — so the pictures belong
 * to the words beside them instead of being five interchangeable banners.
 */

export type ProjectVisualSlot = "oneLiner" | "about" | "success" | "railTop" | "railBottom";

export interface ProjectVisualSlotDef {
  slot: ProjectVisualSlot;
  /** Where it sits, for the owner. */
  label: string;
  /** The rail is a third of the page wide, so those are square. */
  shape: "wide" | "square";
  /** What this picture should show. The brief text is appended by the server. */
  subject: string;
  /** Which brief fields ground this picture, most relevant first. */
  briefKeys: string[];
}

export const PROJECT_VISUAL_SLOTS: ProjectVisualSlotDef[] = [
  {
    slot: "oneLiner",
    label: "Below the one-liner",
    shape: "wide",
    subject: "A bold hero illustration of the product's core promise, the brand mark as the centrepiece of the scene.",
    briefKeys: ["oneLiner", "valueProposition"],
  },
  {
    slot: "about",
    label: "Below About this project",
    shape: "wide",
    subject: "The product in use: the people it serves, in the setting where they'd reach for it, with the brand's colours carried through the scene.",
    briefKeys: ["description", "targetUser", "problemStatement"],
  },
  {
    slot: "success",
    label: "Below What Success Looks Like",
    shape: "wide",
    subject: "The outcome achieved: an optimistic, forward-looking scene of the project having succeeded, the brand mark present as a quiet signature.",
    briefKeys: ["successMetrics", "mission"],
  },
  {
    slot: "railTop",
    label: "Right side, first",
    shape: "square",
    subject: "A clean brand emblem composition: the logo rendered as a dimensional object on a backdrop in the brand's palette.",
    briefKeys: ["mission", "oneLiner"],
  },
  {
    slot: "railBottom",
    label: "Right side, second",
    shape: "square",
    subject: "A close, textured detail shot that feels like the brand — materials, pattern and colour drawn from the logo, suggesting the craft behind the project.",
    briefKeys: ["valueProposition", "targetCustomerProfile"],
  },
];

export const PROJECT_VISUAL_SLOT_KEYS = PROJECT_VISUAL_SLOTS.map((s) => s.slot);

/**
 * Stored on `projects.profile_visuals`: slot → object path, plus the slots the
 * owner has hidden. Hiding keeps the image so showing it again is free — the
 * picture may be one they generated and liked, or one they uploaded.
 */
export type ProjectVisuals = Partial<Record<ProjectVisualSlot, string>> & {
  hidden?: ProjectVisualSlot[];
};

export const isProjectVisualSlot = (v: unknown): v is ProjectVisualSlot =>
  typeof v === "string" && (PROJECT_VISUAL_SLOT_KEYS as string[]).includes(v);

/** The stored image for one slot, hidden or not. For the owner's editor. */
export function projectVisualSource(visuals: unknown, slot: ProjectVisualSlot): string | null {
  if (!visuals || typeof visuals !== "object") return null;
  const url = (visuals as Record<string, unknown>)[slot];
  return typeof url === "string" && url ? url : null;
}

/** Whether the owner has hidden this slot from the public page. */
export function isProjectVisualHidden(visuals: unknown, slot: ProjectVisualSlot): boolean {
  const hidden = (visuals as { hidden?: unknown } | null)?.hidden;
  return Array.isArray(hidden) && hidden.includes(slot);
}

/** The image the public page shows for one slot, or null (none, or hidden). */
export function projectVisual(visuals: unknown, slot: ProjectVisualSlot): string | null {
  return isProjectVisualHidden(visuals, slot) ? null : projectVisualSource(visuals, slot);
}
