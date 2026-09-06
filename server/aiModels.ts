/**
 * Central model IDs for OpenAI calls.
 *
 * Every value is env-overridable so models can be bumped without a code change
 * (useful when an account doesn't yet have access to the newest model, or when
 * a newer one ships).
 */

/** Text/reasoning model used for storyboards, briefs, and scene planning. */
export const TEXT_MODEL = process.env.AI_DEFAULT_MODEL || "gpt-5.2";

/**
 * Model used for Pro's "priority AI processing" — the stronger/faster tier.
 * Defaults to the same model so priority is a no-op until a distinct model is
 * configured; set AI_PRIORITY_MODEL to differentiate.
 */
export const PRIORITY_TEXT_MODEL = process.env.AI_PRIORITY_MODEL || TEXT_MODEL;

/**
 * Newest GPT image-generation model. `gpt-image-1` is OpenAI's current
 * flagship image model; set AI_IMAGE_MODEL to override (e.g. `gpt-image-1-mini`
 * for cheaper/faster generation).
 */
export const IMAGE_MODEL = process.env.AI_IMAGE_MODEL || "gpt-image-1";

/** Size for generated showcase imagery — 3:2 landscape reads well in the gallery. */
export const IMAGE_SIZE = (process.env.AI_IMAGE_SIZE || "1536x1024") as
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "auto";

/** Rendering quality for generated imagery. */
export const IMAGE_QUALITY = (process.env.AI_IMAGE_QUALITY || "medium") as
  | "low"
  | "medium"
  | "high"
  | "auto";
