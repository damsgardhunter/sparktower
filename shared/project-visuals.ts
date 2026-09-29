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
  /**
   * How many times each slot has been drawn, which decides the next one's
   * treatment. See VISUAL_TAKES: without it a redraw with the same logo and
   * the same brief builds the same prompt and gets the same picture back.
   */
  takes?: Partial<Record<ProjectVisualSlot, number>>;
};

/**
 * A different picture on every press.
 *
 * The prompt is built from the project — its logo, its brief, the slot's
 * subject — and none of that changes when somebody presses redraw. So the
 * model was handed an identical prompt and, reasonably, handed back an
 * almost identical image: "redo" looked broken because nothing about the
 * request said it was a second attempt.
 *
 * These are the part that changes. Each is a genuinely different photograph
 * of the same subject — where the camera is, how it is lit, how the frame is
 * arranged — rather than a different subject or a different brand. The
 * palette, the logo and what the image is *of* stay fixed, because those are
 * the things the builder chose; only the take changes.
 *
 * Rotated by the slot's draw count rather than picked at random, so pressing
 * redraw twice can never land on the same take twice, and a sixth press comes
 * back round to the first having been five real attempts away from it.
 */
export const VISUAL_TAKES: readonly string[] = [
  "Take: a wide establishing shot with generous negative space, the subject small in the frame, soft daylight.",
  "Take: close and tight on the detail that matters, shallow depth of field, the background falling away.",
  "Take: a high three-quarter view looking down on an arranged scene, everything laid out and legible.",
  "Take: dramatic low-key lighting from one side, deep shadow, a single bright accent in the brand's colour.",
  "Take: flat-on and symmetrical, graphic and poster-like, bold blocks of the brand's palette.",
  "Take: a candid moment slightly off-centre, natural light, motion implied rather than posed.",
] as const;

/** The take for the nth draw of a slot (0-based), cycling. */
export const takeFor = (draws: number): string =>
  VISUAL_TAKES[((draws % VISUAL_TAKES.length) + VISUAL_TAKES.length) % VISUAL_TAKES.length];

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
