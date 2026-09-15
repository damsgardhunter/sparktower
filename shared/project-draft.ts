/**
 * The project-setup form and Nova, sharing it.
 *
 * Nova suggests a name, a description, a stack; the builder edits any of it.
 * Two rules keep the builder's word final: Nova's later updates never
 * overwrite a field the builder typed, and a name the builder changed comes
 * out of the text Nova wrote under the old one.
 */

/**
 * The line that tells Nova what the product is called. A description or brief
 * field written before the builder renamed the project can still carry the old
 * name; the title wins. Empty when there's no title.
 */
export function productNameNote(title: string | null | undefined): string {
  const name = (title ?? "").toString().trim();
  return name ? `The product is called "${name}". Use that name, even where older text below calls it something else.` : "";
}

/** Nova's suggested updates, minus every field the builder has edited by hand. */
export function withoutEdited(updates: Record<string, unknown> | null | undefined, edited: Iterable<string>): Record<string, unknown> {
  const skip = new Set(edited);
  return Object.fromEntries(Object.entries(updates ?? {}).filter(([key]) => !skip.has(key)));
}

/**
 * `oldName` replaced by `newName` in `text` — whole words only, any case,
 * possessives kept ("EdgeGrid's" → "Saturday Sharp's"). Nothing changes when
 * either name is empty or they're the same name.
 */
export function renameInText(text: string, oldName: string, newName: string): string {
  const from = (oldName ?? "").trim();
  const to = (newName ?? "").trim();
  if (!text || !from || !to || from.toLowerCase() === to.toLowerCase()) return text;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), to);
}
