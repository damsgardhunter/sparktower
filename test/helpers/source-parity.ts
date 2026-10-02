/**
 * Reading one file's source against another's.
 *
 * The phone cannot import `@shared` — Metro will not resolve the alias — so
 * every interface and constant on the phone is a *copy* of the server's, and a
 * copy drifts silently: it typechecks perfectly while describing a response the
 * server stopped sending. Comparing the two sources is the only thing that
 * notices, so several suites do it, and these are the parts they share.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** A repo file's text, by its path from the repo root. */
export const readSource = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");

/**
 * The top-level field names of a TypeScript interface, sorted.
 *
 * Nested objects are flattened to a placeholder first, so `bank: { connected }`
 * contributes `bank` and not `connected` — a nested shape is its own
 * comparison, and mixing the two levels makes a mismatch unreadable.
 */
export function interfaceFields(source: string, name: string): string[] {
  const at = source.indexOf(`interface ${name} {`);
  if (at < 0) throw new Error(`interface ${name} is not in that source`);
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf("{", at); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) { end = i; break; }
  }
  const body = source.slice(source.indexOf("{", at) + 1, end);
  let flat = body;
  let previous: string;
  do { previous = flat; flat = flat.replace(/\{[^{}]*\}/g, "OBJ"); } while (flat !== previous);
  return [...flat.matchAll(/(?:^|\n)\s*(\w+)\??\s*:/g)].map((m) => m[1]).sort();
}

/**
 * Source with comments removed.
 *
 * Four tests of mine have passed on a string that only appeared in a comment —
 * including one that still passed with the bug deliberately put back. A test
 * that means "this screen calls that route" has to look at the code.
 */
export const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Source with every `interface` block removed, leaving only code that runs.
 *
 * A field name appears twice in a file that uses it: once where it is declared
 * and once where it is read. A test meaning "this screen acts on that field"
 * will pass on the declaration alone — which is how a test of mine passed with
 * the behaviour it was guarding deliberately removed. Checking against this
 * strips the half that proves nothing.
 */
export function withoutInterfaces(source: string): string {
  let out = source;
  for (;;) {
    const at = out.search(/\binterface\s+\w+[^{]*\{/);
    if (at < 0) return out;
    const open = out.indexOf("{", at);
    let depth = 0;
    let end = -1;
    for (let i = open; i < out.length; i++) {
      if (out[i] === "{") depth++;
      else if (out[i] === "}" && --depth === 0) { end = i; break; }
    }
    if (end < 0) return out;
    out = out.slice(0, at) + out.slice(end + 1);
  }
}
