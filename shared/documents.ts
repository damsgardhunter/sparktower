/**
 * The document model, shared by the builder UI, the Nova planning routes and
 * the PDF renderer.
 *
 * A document is pages; a page is a grid; a grid holds blocks. Nova plans the
 * grid and writes a headline for every block before any prose exists, so the
 * builder can approve or rearrange the *shape* of the document before paying
 * to fill it. Getting a 30-page business plan written and only then finding the
 * structure wrong is the failure mode this model exists to prevent.
 */

/** How a block renders. Kind drives both the editor affordance and the PDF. */
export const BLOCK_KINDS = [
  "heading",
  "text",
  "bullets",
  "numbered",
  "table",
  "callout",
  "metrics",
  "quote",
  "spacer",
] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  heading: "Heading",
  text: "Paragraphs",
  bullets: "Bullet list",
  numbered: "Numbered list",
  table: "Table",
  callout: "Callout",
  metrics: "Metrics row",
  quote: "Pull quote",
  spacer: "Spacer",
};

/** What each kind's `content` is expected to look like, for the fill prompt. */
export const BLOCK_KIND_CONTENT_RULES: Record<BlockKind, string> = {
  heading: "A single short line. No markdown syntax, no trailing punctuation.",
  text: "1-4 short paragraphs of prose, separated by a blank line. No headings.",
  bullets: "Markdown bullet lines starting with '- '. 3-7 items, one line each.",
  numbered: "Markdown ordered lines starting with '1. '. Steps in order.",
  table: "A GitHub-flavoured markdown table with a header row and 2-6 body rows.",
  callout: "1-2 sentences that matter more than the surrounding prose. No heading.",
  metrics: "One 'Label: value' per line, 2-4 lines. Values must be concrete.",
  quote: "A single sentence, attributed with an em dash if there's a source.",
  spacer: "Leave empty.",
};

/** A page's grid is this many columns wide. Kept small so pages read cleanly. */
export const MIN_GRID_COLUMNS = 1;
export const MAX_GRID_COLUMNS = 4;
/** Guardrails so a plan can't produce something unrenderable. */
export const MAX_PAGES = 40;
export const MAX_BLOCKS_PER_PAGE = 14;

export interface DocumentBlock {
  id: string;
  kind: BlockKind;
  /** Nova's one-line plan for the block, written before any content exists. */
  headline: string;
  /** What Nova intends to put here. Drives the fill, shown as a hint. */
  intent: string;
  /** Markdown. Empty until filled. */
  content: string;
  /** Zero-based grid placement. */
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

export interface DocumentPage {
  id: string;
  title: string;
  /** What this page is for — steers the fill and shows in the outline. */
  purpose: string;
  /** Grid width. Nova picks the smallest that reads well. */
  columns: number;
  /** Renders as a chapter divider rather than a content page. */
  isChapterPage?: boolean;
  blocks: DocumentBlock[];
}

export interface DocumentSettings {
  /** Repeated at the top of every page except the title page. */
  header: string;
  /** Repeated at the bottom. */
  footer: string;
  showPageNumbers: boolean;
  /** A dedicated title page, for anything long enough to need one. */
  titlePage: boolean;
  subtitle: string;
  /** Hex, used for rules and headings in both the editor and the PDF. */
  accentColor: string;
}

export const DEFAULT_SETTINGS: DocumentSettings = {
  header: "",
  footer: "",
  showPageNumbers: true,
  titlePage: false,
  subtitle: "",
  accentColor: "#6366f1",
};

/** A one-line plan per page, produced before the blocks are laid out. */
export interface DocumentOutlineEntry {
  title: string;
  purpose: string;
}

/**
 * Coerces a block's content into the shape its kind can actually render.
 *
 * The fill prompt states the rules, but a model will still hand back three
 * paragraphs for a heading, and a heading block draws its content at heading
 * size — so an unenforced rule shows up as a page with a wall of 15pt text.
 * Applied on every write path, not just on fill, so hand edits and re-plans
 * get the same treatment.
 */
export function normalizeBlockContent(kind: BlockKind, content: string): string {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return "";

  switch (kind) {
    case "heading": {
      // First non-empty line, stripped of markdown emphasis and list markers.
      const line = trimmed.split("\n").map((l) => l.trim()).find(Boolean) || "";
      return line
        .replace(/^#+\s*/, "")
        .replace(/^\s*(?:[-*+]|\d+\.)\s*/, "")
        .replace(/\*\*|__|\*|_|`/g, "")
        .replace(/[:.]\s*$/, "")
        .slice(0, 200);
    }
    case "quote":
      // One sentence, no block quote marker.
      return trimmed.replace(/^>\s*/gm, "").split("\n").map((l) => l.trim()).filter(Boolean).join(" ").slice(0, 600);
    case "spacer":
      return "";
    case "bullets":
    case "numbered": {
      let lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);

      /*
       * A model sometimes returns a whole list on one line — "1) do this 2)
       * then this" — and one line means one item, so the entire list rendered
       * as a single giant bullet. Split inline enumerations back out.
       */
      if (lines.length === 1) {
        const inline = lines[0];
        const byNumber = inline.split(/\s*(?=\b\d{1,2}[.)]\s)/).map((x) => x.trim()).filter(Boolean);
        if (byNumber.length > 1) {
          lines = byNumber;
        } else {
          const byBullet = inline.split(/\s*(?=[\u2022]\s)|\s+(?=-\s)/).map((x) => x.trim()).filter(Boolean);
          if (byBullet.length > 1) lines = byBullet;
          else {
            // Last resort: a long single line of semicolon-separated clauses.
            const bySemicolon = inline.split(/;\s+/).map((x) => x.trim()).filter(Boolean);
            if (bySemicolon.length > 2 && inline.length > 160) lines = bySemicolon;
          }
        }
      }

      return lines
        .map((l, i) => {
          const bare = l.replace(/^\s*(?:[-*+\u2022]|\d{1,2}[.)])\s*/, "");
          return kind === "numbered" ? `${i + 1}. ${bare}` : `- ${bare}`;
        })
        .join("\n");
    }
    default:
      return trimmed;
  }
}

// ---------------------------------------------------------------------------
// Grid helpers — shared so the editor, the validator and the PDF agree on
// exactly what a layout means.
// ---------------------------------------------------------------------------

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/**
 * Forces a page's blocks into a legal, non-overlapping grid.
 *
 * Both Nova and drag-and-drop can produce overlaps, out-of-range columns and
 * gaps. Rather than rejecting those, this normalises them: blocks keep their
 * requested position where it's free, and get pushed to the next free slot
 * where it isn't. That makes every layout renderable, which matters because
 * the same function runs before saving and before printing.
 */
export function normalizePage(page: DocumentPage): DocumentPage {
  const columns = clampInt(page.columns, MIN_GRID_COLUMNS, MAX_GRID_COLUMNS, 1);
  const blocks = (page.blocks || []).slice(0, MAX_BLOCKS_PER_PAGE);

  // Occupancy grid, grown as needed.
  const taken = new Set<string>();
  const key = (r: number, c: number) => `${r}:${c}`;
  const fits = (row: number, col: number, colSpan: number, rowSpan: number) => {
    if (col + colSpan > columns) return false;
    for (let r = row; r < row + rowSpan; r++) {
      for (let c = col; c < col + colSpan; c++) {
        if (taken.has(key(r, c))) return false;
      }
    }
    return true;
  };
  const occupy = (row: number, col: number, colSpan: number, rowSpan: number) => {
    for (let r = row; r < row + rowSpan; r++) {
      for (let c = col; c < col + colSpan; c++) taken.add(key(r, c));
    }
  };

  // Order by requested position so the author's intent survives normalisation.
  const ordered = [...blocks].sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.col ?? 0) - (b.col ?? 0));

  const placed: DocumentBlock[] = [];
  for (const raw of ordered) {
    const colSpan = clampInt(raw.colSpan, 1, columns, 1);
    const rowSpan = clampInt(raw.rowSpan, 1, 4, 1);
    let row = clampInt(raw.row, 0, 200, 0);
    let col = clampInt(raw.col, 0, columns - 1, 0);

    // Walk forward from the requested slot to the first that fits.
    let guard = 0;
    while (!fits(row, col, colSpan, rowSpan) && guard++ < 1000) {
      col++;
      if (col + colSpan > columns) { col = 0; row++; }
    }

    occupy(row, col, colSpan, rowSpan);
    placed.push({
      id: raw.id,
      kind: BLOCK_KINDS.includes(raw.kind) ? raw.kind : "text",
      headline: String(raw.headline ?? "").slice(0, 200),
      intent: String(raw.intent ?? "").slice(0, 600),
      content: normalizeBlockContent(
        BLOCK_KINDS.includes(raw.kind) ? raw.kind : "text",
        String(raw.content ?? "").slice(0, 20_000),
      ),
      col, row, colSpan, rowSpan,
    });
  }

  // Close vertical gaps left by removed blocks so the page has no blank bands.
  const usedRows = [...new Set(placed.map((b) => b.row))].sort((a, b) => a - b);
  const rowRemap = new Map(usedRows.map((r, i) => [r, i]));
  for (const b of placed) b.row = rowRemap.get(b.row) ?? b.row;

  return {
    id: page.id,
    title: String(page.title ?? "").slice(0, 200),
    purpose: String(page.purpose ?? "").slice(0, 600),
    columns,
    isChapterPage: page.isChapterPage === true,
    blocks: placed.sort((a, b) => a.row - b.row || a.col - b.col),
  };
}

/**
 * Roughly how many words fit in a block, from the area it occupies.
 *
 * A one-page document that filled five printed pages wasn't a layout bug, it
 * was a length bug: nothing told the model how much room it had. This turns
 * the grid into a word budget so the instruction can be concrete — "at most 76
 * words" lands where "be concise" does not.
 *
 * Derived from the renderer's own geometry rather than guessed. At 10pt
 * Helvetica across the full 504pt text column, a line holds about 17 words and
 * occupies 13.8pt, which is ~0.00244 words per square point. Multiplying by a
 * block's area gives its capacity; the per-kind factors discount for chrome —
 * a table spends most of its height on cell padding and row rules, so the same
 * area holds far fewer words than prose does.
 *
 * Calibrated against a real render: a heading + 7-step list + 3-column table +
 * 4 bullets came to ~360 words on one page, and this returns 363 for that
 * layout.
 */
const WORDS_PER_SQ_POINT = 17 / (13.8 * 504);
/** Letter portrait with 54pt margins. */
const USABLE_WIDTH = 504;
const USABLE_HEIGHT = 684;
/** A page title and its rule. */
const TITLE_RESERVE = 70;
/** Matches ROW_GAP in the renderer. */
const ROW_GAP_POINTS = 16;

/** Capacity relative to plain prose, discounting each kind's chrome. */
const KIND_CAPACITY: Record<BlockKind, number> = {
  heading: 0,   // handled as a flat allowance
  text: 0.92,   // paragraph gaps
  bullets: 0.72,
  numbered: 0.72,
  table: 0.4,   // header, cell padding, row rules
  callout: 0.8,
  metrics: 0.35,
  quote: 0.55,
  spacer: 0,
};

export function blockWordBudget(page: DocumentPage, block: DocumentBlock): number {
  if (block.kind === "spacer") return 0;
  if (block.kind === "heading") return 8;

  const rows = Math.max(1, pageRowCount(page));
  const columns = Math.max(1, page.columns);
  const contentHeight = Math.max(120, USABLE_HEIGHT - TITLE_RESERVE - ROW_GAP_POINTS * rows);

  const blockWidth = (USABLE_WIDTH / columns) * Math.min(columns, block.colSpan);
  const blockHeight = contentHeight * Math.min(1, block.rowSpan / rows);

  /*
   * A safety factor, because the budget is a ceiling the model drifts above
   * and because inter-block chrome (rules, callout padding, list markers) costs
   * more than the flat estimate. Measured: a 367-word budget for a
   * heading/list/table/bullets/callout page still needed two printed pages,
   * while 285 words fitted comfortably.
   */
  const SAFETY = 0.78;
  const words = blockWidth * blockHeight * WORDS_PER_SQ_POINT * KIND_CAPACITY[block.kind] * SAFETY;
  // A floor, or a small block gets an instruction it can't say anything in.
  return Math.max(18, Math.round(words));
}

/** Total word budget for a page, for the fill prompt's page-level framing. */
export function pageWordBudget(page: DocumentPage): number {
  return page.blocks.reduce((n, b) => n + blockWordBudget(page, b), 0);
}

/** Rows a page occupies, for sizing the editor grid. */
export function pageRowCount(page: DocumentPage): number {
  return page.blocks.reduce((max, b) => Math.max(max, b.row + b.rowSpan), 0);
}

/** Blocks with no content yet — what a "fill" run has to work through. */
export function emptyBlocks(pages: DocumentPage[]): { pageIndex: number; block: DocumentBlock }[] {
  const out: { pageIndex: number; block: DocumentBlock }[] = [];
  pages.forEach((page, pageIndex) => {
    for (const block of page.blocks) {
      if (block.kind !== "spacer" && !block.content.trim()) out.push({ pageIndex, block });
    }
  });
  return out;
}

/** Rough word count, for showing document weight without rendering it. */
export function documentWordCount(pages: DocumentPage[]): number {
  return pages.reduce(
    (n, p) => n + p.blocks.reduce((m, b) => m + (b.content.trim() ? b.content.trim().split(/\s+/).length : 0), 0),
    0,
  );
}
