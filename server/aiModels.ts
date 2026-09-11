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
 * The model that writes code: Nova's build packets, and nothing else.
 *
 * A coding model rather than the general one, because a build packet is
 * complete files for someone's real repository — the one place in the product
 * where a weaker answer isn't a blander sentence but a broken build. OpenAI's
 * Codex models are served on the Responses API, not Chat Completions, and
 * don't take a temperature; `produceWork` handles both, and falls back to
 * TEXT_MODEL when this one is refused, so an account without access still
 * gets a packet rather than an error.
 */
export const CODE_MODEL = process.env.AI_CODE_MODEL || "gpt-5.3-codex";

/**
 * How hard the code model thinks before answering. `medium` because a packet
 * is a few whole files, not a one-liner, and `high` roughly doubles the wait
 * for someone watching a progress bar.
 */
export const CODE_REASONING_EFFORT = (["low", "medium", "high"].includes(process.env.AI_CODE_REASONING ?? "")
  ? process.env.AI_CODE_REASONING
  : "medium") as "low" | "medium" | "high";

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
