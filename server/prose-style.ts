/**
 * Plain prose out of a model that would rather write a report.
 *
 * Almost nothing in this product renders Markdown. One component does —
 * document blocks, through ReactMarkdown — and the other two dozen places
 * Nova's writing appears put it in a `<p>` with `whitespace-pre-wrap`. So a
 * model that answers with `## Decision`, `### Why this decision exists` and
 * `**Evidence:**` is not producing formatting, it is producing literal hashes
 * and asterisks on the screen, and a builder reading their own answer has to
 * step over the punctuation to find the sentence.
 *
 * Two things are done about that, and both are needed:
 *
 *   - `PROSE_STYLE_RULE` goes in the prompts, so the model stops.
 *   - `tidyProse` runs on what comes back, because it won't always stop.
 *
 * The prompt alone is not enough — a model under a long instruction reverts to
 * its house style, and the tenth section of a long answer is where it happens.
 * The filter alone is not enough either: stripping `##` off the front of a
 * line leaves the wordiness underneath, and only the prompt can shorten that.
 *
 * ## What is deliberately left alone
 *
 * Code. Fenced blocks pass through untouched, and so does anything in a
 * backtick span: `**kwargs`, a shell line with `*.ts` in it, an `__init__`.
 * A filter that tidies someone's code is worse than the asterisks it removed.
 * Documents are also left alone at the call site — they are the one surface
 * where Markdown is rendered as Markdown, so there the hashes are headings.
 */

/** The house style, in the words the prompts use, so every surface asks for the same thing. */
export const PROSE_STYLE_RULE =
  "Write plainly, as you would to one person. No Markdown headings, no bold, no italics, " +
  "no horizontal rules — this is displayed as plain text, so a '##' or a '**' is read as " +
  "punctuation, not formatting. Use short paragraphs; where a list genuinely helps, use '- ' " +
  "and keep each line to one thought. Say the thing rather than announcing a section and then " +
  "saying it: 'Deploy the API first, because the web build needs its URL' beats a heading " +
  "reading 'Sequence' above the same sentence.";

/** A line of only -, * or _ — a horizontal rule, which reads as three stray characters. */
const RULE_LINE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

/** Fenced blocks and backtick spans, longest-first so a fence never parses as a span. */
const CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*`+/g;
/* A character that cannot survive a round trip through a model's output. */
const MARK = "\u0000";

/**
 * Markdown decoration out, sentences in.
 *
 * Headings lose their hashes and keep their words — the line was usually a
 * real sentence with `###` in front of it. Bold and italic markers go. List
 * markers are normalised to `- ` so a mixed answer doesn't alternate between
 * three bullet characters. Blank runs collapse.
 *
 * Emphasis is stripped only where the markers hug their text (`**like this**`,
 * never `2 * 3 * 4`), and underscores are left entirely alone outside of a
 * paired `__bold__`, because `snake_case` is far more common in what this
 * product writes about than italics are.
 *
 * Code is taken out of the text before any of that runs and put back
 * afterwards, rather than the transforms being taught to step around it. The
 * first attempt split the string on its code spans and cleaned each piece,
 * which quietly ate the space in "Call `__init__` first" — the space was at
 * the end of a piece, and trailing whitespace is one of the things being
 * cleaned. Masking keeps every line whole, which is what the line-anchored
 * rules need.
 */
export function tidyProse(raw: unknown): string {
  const text = String(raw ?? "");
  if (!text) return "";

  const code: string[] = [];
  const masked = text.replace(CODE, (match) => {
    code.push(match);
    return `${MARK}${code.length - 1}${MARK}`;
  });

  const cleaned = masked
    // "### 1) Deploy web + API" -> "1) Deploy web + API"
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    // A heading that closes its hashes: "## Decision ##"
    .replace(/[ \t]+#+[ \t]*$/gm, "")
    .replace(/\*\*([^\s*][^*]*?)\*\*/g, "$1")
    .replace(/__([^\s_][^_]*?)__/g, "$1")
    .replace(/(^|[\s(])\*([^\s*][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    // "* item" and "+ item" -> "- item", at any indent.
    .replace(/^([ \t]*)[*+][ \t]+/gm, "$1- ")
    .split("\n")
    .filter((line) => !RULE_LINE.test(line))
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    /*
     * Blank lines off each end, not whitespace — a plain `.trim()` also took
     * the indent off the first line, so a run whose first line was a nested
     * bullet came back unnested.
     */
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/\s+$/, "");

  return cleaned.replace(new RegExp(`${MARK}(\\d+)${MARK}`, "g"), (_, i) => code[Number(i)]);
}
